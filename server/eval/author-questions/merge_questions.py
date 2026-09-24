"""Merge per-deck author outputs into `eval/<COURSE>/questions.json`, checking every item.

    uv run python eval/author-questions/merge_questions.py CS4223 [--drafts DIR] [--pages DIR]

Reads `<drafts>/*.json` (one file per author, each `{"questions": [...]}`), checks each
question against the extracted deck pages, and writes the merged set with `reviewed: false`.
Exits non-zero on any error; warnings (key facts that restate the question) are printed for
the human review pass.
"""

import argparse
import json
import re
import sys
from collections import Counter
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[2]
TYPES = {
    "factual",
    "definition",
    "formula",
    "comparison",
    "procedural",
    "cross_lecture",
    "unanswerable",
}
ID = re.compile(r"^[A-Za-z0-9]+-Q\d{2}$")
STOP = {
    "the", "a", "an", "of", "in", "on", "to", "and", "or", "is", "are", "for", "by",
    "with", "that", "this", "it", "its", "as", "at", "what", "which", "who", "when",
    "why", "how", "does", "do", "from", "into", "than", "be", "was", "were", "not",
}  # fmt: skip


def words(text: str) -> set[str]:
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in STOP}


def load_pages(pages_dir: Path) -> dict[str, list[str]]:
    decks = {}
    for path in sorted(pages_dir.glob("*.txt")):
        parts = re.split(r"^===== Page \d+ =====\n", path.read_text(encoding="utf-8"), flags=re.M)
        decks[path.stem] = parts[1:]
    return decks


def check(q: dict, decks: dict[str, list[str]], all_text: str) -> tuple[list[str], list[str]]:
    errors, warnings = [], []
    if not ID.match(q.get("id", "")):
        errors.append("id must look like L03-Q05")
    if q.get("type") not in TYPES:
        errors.append(f"type {q.get('type')!r} not in {sorted(TYPES)}")
    if not q.get("question", "").strip():
        errors.append("question empty")
    if not q.get("reference", "").strip():
        errors.append("reference empty")
    if not q.get("deck"):
        errors.append("deck missing (deck tag, or CROSS)")
    gold = q.get("gold_pages", [])
    if q.get("type") == "unanswerable":
        if gold:
            errors.append("unanswerable question has gold_pages")
        terms = q.get("absent_terms") or []
        if not terms:
            errors.append("unanswerable question needs absent_terms")
        for term in terms:
            if re.search(rf"\b{re.escape(term)}\b", all_text, re.I):
                errors.append(f"absent term {term!r} occurs in the decks")
    else:
        if not gold:
            errors.append("gold_pages empty")
        if gold and not any(g.get("required") for g in gold):
            errors.append("no gold page is required")
        for g in gold:
            pages = decks.get(g.get("deck", ""))
            if pages is None:
                errors.append(f"gold deck {g.get('deck')!r} has no extracted pages")
            elif not 1 <= g.get("page", 0) <= len(pages):
                errors.append(
                    f"gold page {g['deck']} p{g.get('page')} out of range 1..{len(pages)}"
                )
            elif not pages[g["page"] - 1].strip():
                errors.append(f"gold page {g['deck']} p{g['page']} has no text layer")
        if q.get("type") == "cross_lecture" and len({g.get("deck") for g in gold}) < 2:
            errors.append("cross_lecture question must have gold pages in two decks")
        if not q.get("key_facts"):
            errors.append("key_facts empty")
        asked = words(q.get("question", ""))
        for fact in q.get("key_facts", []):
            if words(fact) and words(fact) <= asked:
                warnings.append(f"key fact restates the question: {fact!r}")
    return errors, warnings


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course")
    parser.add_argument("--drafts", type=Path, help="default .scratch/eval/<COURSE>/drafts")
    parser.add_argument("--pages", type=Path, help="default .scratch/eval/<COURSE>/pages")
    parser.add_argument("--out", type=Path, help="default eval/<COURSE>/questions.json")
    args = parser.parse_args(argv)
    course = args.course.upper()
    scratch = SERVER_ROOT.parent / ".scratch" / "eval" / course
    drafts = args.drafts or scratch / "drafts"
    decks = load_pages(args.pages or scratch / "pages")
    if not decks:
        sys.exit("no extracted pages; run extract_pages.py first")
    all_text = "\n".join("\n".join(p) for p in decks.values())

    questions: list[dict] = []
    for path in sorted(drafts.glob("*.json")):
        questions.extend(json.loads(path.read_text(encoding="utf-8"))["questions"])
    if not questions:
        sys.exit(f"no drafts under {drafts}")

    failed = 0
    seen: Counter[str] = Counter(q.get("id") for q in questions)
    for q in questions:
        errors, warnings = check(q, decks, all_text)
        if seen[q.get("id")] > 1:
            errors.append("duplicate id")
        for e in errors:
            print(f"ERROR {q.get('id')}: {e}")
        for w in warnings:
            print(f"warn  {q.get('id')}: {w}")
        failed += bool(errors)
    if failed:
        sys.exit(f"{failed} question(s) failed checks; nothing written")

    keep = (
        "id", "type", "question", "reference", "key_facts", "gold_pages", "absent_terms", "deck"
    )  # fmt: skip
    merged = [{k: q[k] for k in keep if k in q} | {"reviewed": False} for q in questions]
    out = args.out or SERVER_ROOT / "eval" / course / "questions.json"
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text(
        json.dumps({"course": course, "questions": merged}, indent=2, ensure_ascii=False) + "\n",
        encoding="utf-8",
    )
    print(f"wrote {len(merged)} questions to {out}")
    print("by type:", dict(Counter(q["type"] for q in merged)))
    print("by deck:", dict(Counter(q["deck"] for q in merged)))
    return 0


if __name__ == "__main__":
    sys.exit(main())
