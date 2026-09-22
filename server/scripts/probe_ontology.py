import argparse
import asyncio
import hashlib
import json
import os
import re
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Literal

from probe_runtime import budgeted_requests, preflight
from pydantic import BaseModel

ONTOLOGY = Path(__file__).with_name("fixtures") / "course_ontology.owl"
RELATIONS = ("prerequisite_of", "builds_on", "related_to", "introduced_in")
CORPUS = """# Week3
Week3 is a Topic. BaseCase, Recursion and StackFrames are Concepts introduced_in Week3.
BaseCase is a prerequisite_of Recursion. Recursion builds_on BaseCase.
Recursion is related_to StackFrames. BaseCase means the stopping condition of recursion.
StackFrames store the state of active function calls.
"""
EXPECTED_NODES = {
    "Week3": "Topic",
    "BaseCase": "Concept",
    "Recursion": "Concept",
    "StackFrames": "Concept",
}
EXPECTED_EDGES = [
    ["BaseCase", "prerequisite_of", "Recursion"],
    ["Recursion", "builds_on", "BaseCase"],
    ["Recursion", "related_to", "StackFrames"],
    *[[concept, "introduced_in", "Week3"] for concept in ("BaseCase", "Recursion", "StackFrames")],
]


class CourseNode(BaseModel):
    id: str
    name: str
    type: Literal["Concept", "Topic"]
    description: str


class CourseEdge(BaseModel):
    source_node_id: str
    target_node_id: str
    relationship_name: Literal["prerequisite_of", "builds_on", "related_to", "introduced_in"]
    description: str | None = None


def specification(variant: str, ontology_mode: str) -> dict:
    tree = ET.parse(ONTOLOGY)
    individuals = tree.findall(".//{http://www.w3.org/2002/07/owl#}NamedIndividual")
    return {
        "executed": False,
        "variant": variant,
        "ontology_mode": ontology_mode if variant == "owl" else None,
        "corpus_sha256": hashlib.sha256(CORPUS.encode()).hexdigest(),
        "expected_nodes": EXPECTED_NODES,
        "expected_edges": EXPECTED_EDGES,
        "relationship_vocabulary": RELATIONS,
        "ontology_contains_individuals": bool(individuals),
        "node_schema": CourseNode.model_json_schema(),
        "edge_schema": CourseEdge.model_json_schema(),
    }


def normalized(value) -> str:
    return re.sub(r"[^a-z0-9]", "", str(value or "").lower())


async def operation_metrics() -> list[dict]:
    from cognee.infrastructure.databases.relational import get_relational_engine
    from cognee.modules.pipelines.models import PipelineRun
    from sqlalchemy import select

    async with get_relational_engine().get_async_session() as session:
        rows = await session.execute(
            select(
                PipelineRun.pipeline_run_id,
                PipelineRun.operation_name,
                PipelineRun.dataset_id,
                PipelineRun.started_at,
                PipelineRun.ended_at,
                PipelineRun.tokens_in,
                PipelineRun.tokens_out,
                PipelineRun.outcome,
            ).where(
                PipelineRun.operation_name.isnot(None), PipelineRun.parent_operation_id.is_(None)
            )
        )
        return [dict(row) for row in rows.mappings()]


async def run_probe(variant: str, ontology_mode: str, root: Path) -> dict:
    import cognee
    from cognee.memify_pipelines.create_triplet_embeddings import create_triplet_embeddings
    from cognee.modules.ontology.rdf_xml.RDFLibOntologyResolver import RDFLibOntologyResolver
    from cognee.modules.search.types import SearchType
    from cognee.modules.users.exceptions import PermissionDeniedError
    from cognee.shared.data_models import KnowledgeGraph

    from lattice.config import Settings
    from lattice.engine import Engine

    class CourseGraph(KnowledgeGraph):
        nodes: list[CourseNode]
        edges: list[CourseEdge]

    engine = Engine(Settings(_env_file=None, cognee_root=root / "c", uploads_dir=root / "u"))
    await engine.start()
    student = await engine.principal("bob@example.com")
    alice = await engine.principal("alice@example.com")
    instructor = await engine.instructor()
    course, _ = await engine.enrol("cs101", student)
    foreign, _ = await engine.enrol("cs202", student)
    private = await engine.private_dataset("cs101", alice)
    options = {"graph_model": CourseGraph} if variant == "pydantic" else {}
    if variant == "owl":
        options["config"] = {
            "ontology_config": {
                "ontology_resolver": RDFLibOntologyResolver(ontology_file=str(ONTOLOGY)),
                "ontology_mode": ontology_mode,
            }
        }
    for dataset, owner, content in (
        (course, instructor, CORPUS),
        (foreign, instructor, "ForeignCourseSentinel is a Concept introduced_in the Topic Week9."),
        (private, alice, "PrivateNoteSentinel is a Concept introduced_in the Topic Week8."),
    ):
        await cognee.add(content, dataset_id=dataset.id, user=owner)
        await cognee.cognify(datasets=[dataset.id], user=owner, chunks_per_batch=1, **options)

    async def search(query, query_type, dataset=course, principal=student):
        return await cognee.search(
            query,
            query_type=query_type,
            dataset_ids=[dataset.id],
            user=principal,
            verbose=True,
            include_references=True,
        )

    async def rows(query, columns, dataset=course, principal=student):
        raw = await search(query, SearchType.CYPHER, dataset, principal)
        return [
            dict(zip(columns, row, strict=True))
            for result in raw
            for row in result.get("objects_result") or []
        ]

    nodes_query = "MATCH (n) RETURN n.id AS id, n.name AS name, n.type AS type"
    edges_query = (
        "MATCH (a)-[r]->(b) RETURN a.id AS source_id, a.name AS source, "
        "r.relationship_name AS relationship, b.id AS target_id, b.name AS target"
    )
    node_columns = ("id", "name", "type")
    nodes = await rows(nodes_query, node_columns)
    edges = await rows(edges_query, ("source_id", "source", "relationship", "target_id", "target"))
    names = {normalized(node.get("name")) for node in nodes}
    triples = {
        tuple(normalized(edge.get(key)) for key in ("source", "relationship", "target"))
        for edge in edges
    }
    missing = [edge for edge in EXPECTED_EDGES if tuple(map(normalized, edge)) not in triples]
    chunk_ids = {str(node["id"]) for node in nodes if node.get("type") == "DocumentChunk"}
    checks = {
        "missing_expected_nodes": [
            name for name in EXPECTED_NODES if normalized(name) not in names
        ],
        "missing_expected_edges": missing,
        "expected_type_matches": {
            name: (normalized(name), "isa", normalized(kind)) in triples
            for name, kind in EXPECTED_NODES.items()
        },
        "chunk_outgoing_relationships": sorted(
            {str(edge["relationship"]) for edge in edges if str(edge["source_id"]) in chunk_ids}
        ),
        "foreign_course_excluded": normalized("ForeignCourseSentinel") not in names,
        "private_note_excluded": normalized("PrivateNoteSentinel") not in names,
    }
    foreign_nodes = await rows(nodes_query, node_columns, foreign)
    private_nodes = await rows(nodes_query, node_columns, private, alice)
    checks["foreign_control_present"] = any(
        normalized(node.get("name")) == normalized("ForeignCourseSentinel")
        for node in foreign_nodes
    )
    checks["private_control_present"] = any(
        normalized(node.get("name")) == normalized("PrivateNoteSentinel") for node in private_nodes
    )
    try:
        await rows(nodes_query, node_columns, private, student)
    except PermissionDeniedError:
        checks["private_direct_read_refused"] = True
    else:
        checks["private_direct_read_refused"] = False

    modes = {}
    try:
        await create_triplet_embeddings(user=instructor, dataset=course.name)
        modes["triplet_embeddings"] = "created"
    except Exception as error:
        modes["triplet_embeddings"] = {"error_class": type(error).__name__}
    for query_type in (SearchType.TRIPLET_COMPLETION, SearchType.GRAPH_REPORT):
        try:
            raw = await search("What is a prerequisite of Recursion?", query_type)
            modes[query_type.value] = [
                {"answer": result.get("text_result"), "evidence": result.get("evidence")}
                for result in raw
            ]
        except Exception as error:
            modes[query_type.value] = {"error_class": type(error).__name__}
    for depth in (1, 2):
        try:
            modes[f"cypher_{depth}_hop"] = await rows(
                f"MATCH (a)-[r*1..{depth}]->(b) WHERE a.name = 'recursion' "
                "RETURN DISTINCT b.name AS name, b.type AS type",
                ("name", "type"),
            )
        except Exception as error:
            modes[f"cypher_{depth}_hop"] = {"error_class": type(error).__name__}
    return {
        "cognee_version": cognee.__version__,
        "nodes": nodes,
        "edges": edges,
        "checks": checks,
        "retrieval_modes": modes,
        "operations": await operation_metrics(),
    }


async def storage_check(root: Path) -> dict:
    import cognee
    from cognee.context_global_variables import set_database_global_context_variables
    from cognee.infrastructure.databases.graph import get_graph_engine
    from cognee.modules.engine.models import Entity
    from cognee.modules.search.types import SearchType

    from lattice.config import Settings
    from lattice.engine import Engine

    engine = Engine(Settings(_env_file=None, cognee_root=root / "c", uploads_dir=root / "u"))
    await engine.start()
    student = await engine.principal("storage-probe@example.com")
    instructor = await engine.instructor()
    course, _ = await engine.enrol("cs101", student)
    base = Entity(name="basecase", description="Stopping condition")
    recursion = Entity(name="recursion", description="Recursive calls")
    async with set_database_global_context_variables(course.id, instructor.id):
        graph = await get_graph_engine()
        await graph.add_nodes([base, recursion])
        await graph.add_edges([(str(base.id), str(recursion.id), "prerequisite_of", {})])
    raw = await cognee.search(
        "MATCH (a)-[r]->(b) RETURN a.name, r.relationship_name, b.name",
        query_type=SearchType.CYPHER,
        user=student,
        dataset_ids=[course.id],
        verbose=True,
    )
    rows = [list(row) for result in raw for row in result.get("objects_result") or []]
    if rows != [["basecase", "prerequisite_of", "recursion"]]:
        raise RuntimeError("Unexpected scoped Cypher result shape.")
    return {"storage_check": "passed", "cypher_rows": rows}


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Compare course ontology options on isolated data."
    )
    parser.add_argument("--variant", choices=("default", "pydantic", "owl"), required=True)
    parser.add_argument("--ontology-mode", choices=("annotate", "strict"), default="annotate")
    parser.add_argument("--run", action="store_true")
    parser.add_argument("--storage-check", action="store_true")
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    report = specification(args.variant, args.ontology_mode)
    if args.storage_check:
        from decimal import Decimal

        check = preflight(storage_only=True)
        if not check["ready"]:
            print(json.dumps(check))
            return 2
        os.environ["COGNEE_LOG_FILE"] = "false"
        os.environ["TELEMETRY_DISABLED"] = "1"
        os.environ["CACHING"] = "false"
        os.environ["AUTO_FEEDBACK"] = "false"
        os.environ["LOG_LEVEL"] = "ERROR"
        with tempfile.TemporaryDirectory(prefix="lat", ignore_cleanup_errors=True) as workspace:
            root = Path(workspace)
            with budgeted_requests(root / "budget.sqlite3", Decimal("0.30")) as ledger:
                result = asyncio.run(storage_check(root))
                result["paid_requests"] = len(ledger.report()["requests"])
        print(json.dumps(result))
        return 0
    if not args.run:
        print(json.dumps(report, indent=2))
        return 0
    if not args.ledger or not args.output:
        parser.error("Live runs require --ledger and --output.")
    if args.output.exists():
        parser.error("Choose a new output path; existing results are never overwritten.")
    if not args.output.parent.is_dir():
        parser.error("The output directory must already exist.")
    check = preflight()
    if not check["ready"]:
        print(json.dumps(check, indent=2))
        return 2
    os.environ["COGNEE_LOG_FILE"] = "false"
    os.environ["TELEMETRY_DISABLED"] = "1"
    os.environ["AUTO_FEEDBACK"] = "false"
    os.environ["CACHING"] = "false"
    os.environ.setdefault("LLM_MAX_COMPLETION_TOKENS", "16384")
    started = time.monotonic()
    code = 0
    with budgeted_requests(args.ledger) as ledger:
        with tempfile.TemporaryDirectory(prefix="lat", ignore_cleanup_errors=True) as workspace:
            try:
                report.update(
                    asyncio.run(run_probe(args.variant, args.ontology_mode, Path(workspace)))
                )
            except Exception as error:
                report["error_class"] = type(error).__name__
                code = 1
        report.update(
            executed=True, elapsed_seconds=time.monotonic() - started, budget=ledger.report()
        )
    with args.output.open("x", encoding="utf-8") as output:
        json.dump(report, output, indent=2, default=str)
        output.write("\n")
    print(
        json.dumps({"output": str(args.output), "error_class": report.get("error_class")}, indent=2)
    )
    return code


if __name__ == "__main__":
    raise SystemExit(main())
