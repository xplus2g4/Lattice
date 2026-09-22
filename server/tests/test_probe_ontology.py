import json
import subprocess
import sys
from pathlib import Path


def test_ontology_dry_run_declares_expectations_without_paid_work(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "probe_ontology.py"
    result = subprocess.run(
        [sys.executable, str(script), "--variant", "pydantic"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["executed"] is False
    assert ["BaseCase", "prerequisite_of", "Recursion"] in report["expected_edges"]
    assert report["expected_nodes"]["Week3"] == "Topic"
    assert report["ontology_contains_individuals"] is False
    assert set(report["relationship_vocabulary"]) == {
        "prerequisite_of",
        "builds_on",
        "related_to",
        "introduced_in",
    }
    assert list(tmp_path.iterdir()) == []


def test_live_probe_rejects_a_missing_output_directory_before_spending(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "probe_ontology.py"
    result = subprocess.run(
        [
            sys.executable,
            str(script),
            "--variant",
            "default",
            "--run",
            "--ledger",
            str(tmp_path / "budget.sqlite3"),
            "--output",
            str(tmp_path / "missing" / "result.json"),
        ],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 2
    assert "output directory" in result.stderr
    assert list(tmp_path.iterdir()) == []


def test_storage_preflight_checks_real_scoped_cypher_without_llm(tmp_path):
    script = Path(__file__).resolve().parents[1] / "scripts" / "probe_ontology.py"
    result = subprocess.run(
        [sys.executable, str(script), "--variant", "pydantic", "--storage-check"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-4000:]
    report = json.loads(result.stdout.strip().splitlines()[-1])
    assert report["storage_check"] == "passed"
    assert report["cypher_rows"] == [["basecase", "prerequisite_of", "recursion"]]
    assert report["paid_requests"] == 0
