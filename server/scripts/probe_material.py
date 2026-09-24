import argparse
import asyncio
import hashlib
import json
import os
import posixpath
import re
import tempfile
import time
import xml.etree.ElementTree as ET
from pathlib import Path
from zipfile import ZipFile

from probe_ontology import operation_metrics
from probe_runtime import budgeted_requests, preflight
from pypdf import PdfReader


def normalized_text(text: str) -> str:
    return " ".join(re.findall(r"\w+", text.lower()))


def read_slides(path: Path) -> tuple[list[str], list[int]]:
    namespaces = {
        "p": "http://schemas.openxmlformats.org/presentationml/2006/main",
        "a": "http://schemas.openxmlformats.org/drawingml/2006/main",
        "r": "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
    }
    slides, hidden = [], []
    with ZipFile(path) as archive:
        presentation = ET.fromstring(archive.read("ppt/presentation.xml"))
        relationships = ET.fromstring(archive.read("ppt/_rels/presentation.xml.rels"))
        targets = {
            item.attrib["Id"]: item.attrib["Target"]
            for item in relationships
            if item.attrib.get("Type", "").endswith("/slide")
            and item.attrib.get("TargetMode") != "External"
        }
        for index, slide in enumerate(presentation.findall("p:sldIdLst/p:sldId", namespaces), 1):
            target = targets[slide.attrib[f"{{{namespaces['r']}}}id"]]
            target = posixpath.normpath(
                target.lstrip("/") if target.startswith("/") else posixpath.join("ppt", target)
            )
            if not target.startswith("ppt/slides/") or not target.endswith(".xml"):
                raise ValueError("Unexpected slide relationship target.")
            root = ET.fromstring(archive.read(target))
            if root.attrib.get("show") in {"0", "false"}:
                hidden.append(index)
            slides.append(
                "\n".join(
                    "".join(node.text or "" for node in paragraph.findall(".//a:t", namespaces))
                    for paragraph in root.findall(".//a:p", namespaces)
                )
            )
    return slides, hidden


def inspect_material(path: Path) -> tuple[dict, list[str]]:
    unit, extra = "page", {}
    if path.suffix.lower() == ".pdf":
        pages = [page.extract_text() or "" for page in PdfReader(path).pages]
    elif path.suffix.lower() == ".pptx":
        unit = "slide"
        pages, hidden = read_slides(path)
        extra = {
            "hidden_slides": hidden,
            "text_scope": "slide-local text and tables; excludes masters, notes and images",
        }
    else:
        raise ValueError("The probe accepts PDF and PPTX Materials.")
    normalized = [normalized_text(page) for page in pages]
    anchors = []
    if pages:
        candidates = sorted(
            {
                1,
                len(pages) // 2,
                len(pages) - 1,
                max(range(len(pages)), key=lambda i: len(pages[i])),
            }
        )
        for index in candidates:
            if not 0 <= index < len(pages):
                continue
            words = normalized[index].split()
            for start in range(0, max(0, len(words) - 11), 6):
                text = " ".join(words[start : start + 12])
                if sum(text in page for page in normalized) == 1:
                    anchors.append({unit: index + 1, "text": text})
                    break
    return {
        "executed": False,
        "material": path.name,
        "sha256": hashlib.sha256(path.read_bytes()).hexdigest(),
        "unit": unit,
        f"{unit}_count": len(pages),
        "extracted_characters": sum(map(len, pages)),
        f"empty_{unit}s": [index + 1 for index, text in enumerate(pages) if not text.strip()],
        **extra,
        "anchors": anchors,
        "ready_to_cognify": bool(anchors),
    }, pages


async def run_probe(
    path: Path, report: dict, pages: list[str], root: Path, preconvert: bool
) -> dict:
    import cognee
    from cognee.modules.data.methods import get_dataset_data
    from cognee.modules.search.types import SearchType
    from cognee.tasks.ingestion.data_item import DataItem

    from lattice.config import Settings
    from lattice.engine import Engine

    engine = Engine(Settings(_env_file=None, cognee_root=root / "c", uploads_dir=root / "u"))
    await engine.start()
    student = await engine.principal("student@example.com")
    instructor = await engine.instructor()
    dataset, _ = await engine.enrol("cs2100", student)
    unit = report["unit"]
    input_path = path
    if preconvert:
        input_path = root / f"lecture.{unit}s.md"
        input_path.write_text(
            "\n\n".join(
                f"# {unit.title()} {number}\n\n{text}" for number, text in enumerate(pages, 1)
            ),
            encoding="utf-8",
        )
    metadata = {"material_id": report["sha256"], "week": 3, "lecture_no": 1}
    await cognee.add(
        DataItem(str(input_path), external_metadata=metadata),
        dataset_id=dataset.id,
        user=instructor,
        node_set=["provenance-probe"],
    )
    await cognee.cognify(datasets=[dataset.id], user=instructor, chunks_per_batch=1)
    stored_metadata = [
        getattr(item, "external_metadata", None) for item in await get_dataset_data(dataset.id)
    ]
    samples = []
    chunks = {}
    for anchor in report["anchors"]:
        raw = await cognee.search(
            anchor["text"],
            query_type=SearchType.CHUNKS,
            user=student,
            dataset_ids=[dataset.id],
            verbose=True,
            include_references=True,
        )
        matching = []
        for result in raw:
            if str(result.get("dataset_id")) != str(dataset.id):
                raise RuntimeError("Unexpected dataset in provenance results.")
            for chunk in result.get("text_result") or []:
                text = chunk.get("text", "")
                chunk_id = str(chunk.get("id") or chunk.get("chunk_id") or chunk.get("chunk_index"))
                chunks[chunk_id] = {
                    key: chunk.get(key)
                    for key in (
                        "id",
                        "chunk_id",
                        "chunk_index",
                        "document_id",
                        "document_name",
                        "page",
                        "slide",
                    )
                } | {
                    f"{unit}_headers_in_text": sorted(
                        set(map(int, re.findall(rf"\b{unit.title()}\s+(\d+)\b", text)))
                    ),
                    f"matched_anchor_{unit}s": [
                        sample[unit]
                        for sample in report["anchors"]
                        if sample["text"] in normalized_text(text)
                    ],
                }
                if anchor["text"] in normalized_text(text):
                    matching.append(chunk_id)
        samples.append({**anchor, "matching_chunk_ids": matching})
    count = await cognee.search(
        "MATCH (n) WHERE n.type = 'DocumentChunk' RETURN count(n) AS chunk_count",
        query_type=SearchType.CYPHER,
        user=student,
        dataset_ids=[dataset.id],
        verbose=True,
    )
    citations = await cognee.search(
        report["anchors"][0]["text"],
        query_type=SearchType.GRAPH_COMPLETION,
        only_context=True,
        user=student,
        dataset_ids=[dataset.id],
        verbose=True,
        include_references=True,
    )
    return {
        "cognee_version": cognee.__version__,
        "input_format": f"markdown-{unit}-headers"
        if preconvert
        else f"native-{path.suffix[1:].lower()}",
        "stored_material_metadata": stored_metadata,
        "anchor_results": samples,
        "chunks": list(chunks.values()),
        "chunk_count_results": [result.get("objects_result") for result in count],
        "evidence": [evidence for result in citations for evidence in result.get("evidence") or []],
        "operations": await operation_metrics(),
    }


async def compare_chunking(pages: list[str], anchors: list[dict], unit: str = "page") -> dict:
    from cognee.infrastructure.llm import get_max_chunk_tokens
    from cognee.modules.chunking.TextChunker import TextChunker
    from cognee.modules.data.processing.document_types.Document import Document

    limit = await get_max_chunk_tokens()
    variants = {}
    if unit == "page":
        variants["native_page_headers"] = "\n".join(
            f"Page {number}:\n{text}\n" for number, text in enumerate(pages, 1) if text.strip()
        )
    variants[f"markdown_{unit}_headers"] = "\n\n".join(
        f"# {unit.title()} {number}\n\n{text}" for number, text in enumerate(pages, 1)
    )
    comparisons, split_anchors = {}, {}
    for name, text in variants.items():

        async def get_text(value=text):
            yield value

        material = Document(
            name=name,
            raw_data_location=f"memory://{name}",
            external_metadata=None,
            mime_type="text/plain",
        )
        chunks = [chunk async for chunk in TextChunker(material, get_text, limit).read()]
        comparisons[name] = [
            {
                "chunk_index": chunk.chunk_index,
                "chunk_size": chunk.chunk_size,
                f"{unit}_headers": sorted(
                    set(map(int, re.findall(rf"\b{unit.title()}\s+(\d+)\b", chunk.text)))
                ),
                f"matched_anchor_{unit}s": [
                    anchor[unit]
                    for anchor in anchors
                    if anchor["text"] in normalized_text(chunk.text)
                ],
            }
            for chunk in chunks
        ]
        split_anchors[name] = [
            anchor[unit]
            for anchor in anchors
            if not any(anchor["text"] in normalized_text(c.text) for c in chunks)
            and any(
                anchor["text"] in normalized_text(a.text + b.text)
                for a, b in zip(chunks, chunks[1:], strict=False)
            )
        ]
    return {
        "max_chunk_tokens": limit,
        "chunking_comparison": comparisons,
        "anchors_crossing_chunk_boundaries": split_anchors,
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Measure PDF/PPTX Chunk provenance and Cognify usage."
    )
    inputs = parser.add_mutually_exclusive_group(required=True)
    inputs.add_argument("--material", type=Path)
    inputs.add_argument("--directory", type=Path)
    modes = parser.add_mutually_exclusive_group()
    modes.add_argument("--run", action="store_true")
    modes.add_argument("--chunking-only", action="store_true")
    parser.add_argument("--preconvert", action="store_true")
    parser.add_argument("--ledger", type=Path)
    parser.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.directory:
        if args.run:
            parser.error("Choose one Material for a paid run, not a whole directory.")
        print(
            json.dumps(
                [
                    {
                        key: value
                        for key, value in inspect_material(path)[0].items()
                        if key != "anchors"
                    }
                    for path in sorted(args.directory.iterdir())
                    if path.suffix.lower() in {".pdf", ".pptx"}
                ],
                indent=2,
            )
        )
        return 0
    report, pages = inspect_material(args.material)
    if args.chunking_only:
        from decimal import Decimal

        if args.output and (args.output.exists() or not args.output.parent.is_dir()):
            parser.error("Choose a new output in an existing output directory.")
        os.environ["COGNEE_LOG_FILE"] = "false"
        os.environ["TELEMETRY_DISABLED"] = "1"
        os.environ["LOG_LEVEL"] = "ERROR"
        with tempfile.TemporaryDirectory(prefix="lat") as workspace:
            with budgeted_requests(Path(workspace) / "budget.db", Decimal("0.30")) as ledger:
                report.update(
                    asyncio.run(compare_chunking(pages, report["anchors"], report["unit"]))
                )
                report["paid_requests"] = len(ledger.report()["requests"])
        if args.output:
            with args.output.open("x", encoding="utf-8") as output:
                json.dump(report, output, indent=2)
                output.write("\n")
        print(json.dumps(report, indent=2))
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
    if not report["ready_to_cognify"]:
        parser.error("No distinctive extractable text; do not spend an LLM call on this input.")
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
        before = len(ledger.report()["requests"])
        with tempfile.TemporaryDirectory(prefix="lat", ignore_cleanup_errors=True) as workspace:
            try:
                report.update(
                    asyncio.run(
                        run_probe(
                            args.material.resolve(),
                            report,
                            pages,
                            Path(workspace),
                            args.preconvert,
                        )
                    )
                )
            except Exception as error:
                report["error_class"] = type(error).__name__
                code = 1
        budget = ledger.report()
        report.update(
            executed=True,
            elapsed_seconds=time.monotonic() - started,
            requests_for_this_run=budget["requests"][before:],
            budget=budget,
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
