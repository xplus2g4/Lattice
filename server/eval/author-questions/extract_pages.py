"""Write one text file per seed deck, page by page, for question authoring.

    uv run python eval/author-questions/extract_pages.py CS4223 [--source DIR] [--out DIR]

Each deck becomes `<out>/<tag>.txt` with `===== Page N =====` markers, N being the PDF's own
1-based page index: the number that goes into `gold_pages`. The text is `pypdf.extract_text()`,
the same view Cognee's loader has of the deck, so what is absent here (figures, images) is
absent from retrieval too. Prints the deck inventory and writes it to `<out>/decks.json`.
"""

import argparse
import json
import logging
import sys
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[2]


def deck_tag(path: Path) -> str:
    return path.stem.split(" ", 1)[0]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("course")
    parser.add_argument("--source", type=Path, help="seed PDFs (default data/seed/<COURSE>)")
    parser.add_argument("--out", type=Path, help="default .scratch/eval/<COURSE>/pages")
    args = parser.parse_args(argv)

    from pypdf import PdfReader

    logging.getLogger("pypdf").setLevel(logging.ERROR)
    source = args.source or SERVER_ROOT / "data" / "seed" / args.course.upper()
    out = args.out or SERVER_ROOT.parent / ".scratch" / "eval" / args.course.upper() / "pages"
    pdfs = sorted(source.glob("*.pdf"))
    if not pdfs:
        sys.exit(f"no PDFs under {source}")
    out.mkdir(parents=True, exist_ok=True)
    inventory = []
    for path in pdfs:
        pages = [(p.extract_text() or "").strip() for p in PdfReader(str(path)).pages]
        tag = deck_tag(path)
        (out / f"{tag}.txt").write_text(
            "\n".join(f"===== Page {n} =====\n{text}" for n, text in enumerate(pages, 1)) + "\n",
            encoding="utf-8",
        )
        empty = sum(1 for t in pages if not t)
        inventory.append({"tag": tag, "file": path.name, "pages": len(pages), "empty_pages": empty})
        print(f"{tag:<6} {len(pages):>3} pages  {empty:>2} empty  {path.name}")
    (out / "decks.json").write_text(json.dumps(inventory, indent=2), encoding="utf-8")
    print(f"wrote {out}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
