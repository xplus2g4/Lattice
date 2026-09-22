import json
import subprocess
import sys
from pathlib import Path
from zipfile import ZipFile

from pypdf import PdfWriter


def test_material_dry_run_detects_pages_without_extractable_text(tmp_path):
    material = tmp_path / "blank.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.add_blank_page(width=600, height=800)
    writer.write(material)
    script = Path(__file__).resolve().parents[1] / "scripts" / "probe_material.py"
    result = subprocess.run(
        [sys.executable, str(script), "--material", str(material)],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["executed"] is False
    assert report["page_count"] == 2
    assert report["empty_pages"] == [1, 2]
    assert report["anchors"] == []
    assert report["ready_to_cognify"] is False
    assert sorted(path.name for path in tmp_path.iterdir()) == ["blank.pdf"]


def test_pptx_inspection_respects_slide_order_and_excludes_notes(tmp_path):
    material = tmp_path / "ordered.pptx"
    presentation_ns = "http://schemas.openxmlformats.org/presentationml/2006/main"
    drawing_ns = "http://schemas.openxmlformats.org/drawingml/2006/main"
    rel_ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships"
    with ZipFile(material, "w") as archive:
        archive.writestr(
            "ppt/presentation.xml",
            f'''
            <p:presentation xmlns:p="{presentation_ns}" xmlns:r="{rel_ns}">
              <p:sldIdLst><p:sldId id="300" r:id="first"/>
              <p:sldId id="301" r:id="second"/><p:sldId id="302" r:id="blank"/></p:sldIdLst>
            </p:presentation>''',
        )
        archive.writestr(
            "ppt/_rels/presentation.xml.rels",
            f'''
            <Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
              <Relationship Id="first" Type="{rel_ns}/slide" Target="slides/slide10.xml"/>
              <Relationship Id="second" Type="{rel_ns}/slide" Target="slides/slide2.xml"/>
              <Relationship Id="blank" Type="{rel_ns}/slide" Target="slides/slide3.xml"/>
            </Relationships>''',
        )
        for name, text, hidden in (
            (
                "slide10",
                "first alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu",
                False,
            ),
            (
                "slide2",
                "second one two three four five six seven eight nine ten eleven twelve",
                True,
            ),
            ("slide3", "", False),
        ):
            archive.writestr(
                f"ppt/slides/{name}.xml",
                f'''
                <p:sld xmlns:p="{presentation_ns}" xmlns:a="{drawing_ns}" show="{int(not hidden)}">
                <p:cSld><a:p><a:r><a:t>{text}</a:t></a:r></a:p></p:cSld></p:sld>''',
            )
        archive.writestr("ppt/notesSlides/notesSlide1.xml", "speaker-note-sentinel")
    script = Path(__file__).resolve().parents[1] / "scripts" / "probe_material.py"
    result = subprocess.run(
        [sys.executable, str(script), "--material", str(material)],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr
    report = json.loads(result.stdout)
    assert report["slide_count"] == 3
    assert report["empty_slides"] == [3]
    assert report["hidden_slides"] == [2]
    assert report["anchors"][0]["slide"] == 1
    assert report["anchors"][0]["text"].startswith("first alpha")
    assert report["anchors"][1]["slide"] == 2
    assert "speaker-note-sentinel" not in result.stdout
    chunked = subprocess.run(
        [sys.executable, str(script), "--material", str(material), "--chunking-only"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert chunked.returncode == 0, chunked.stderr[-2000:]
    comparison = json.loads(chunked.stdout)
    assert comparison["paid_requests"] == 0
    assert "native_page_headers" not in comparison["chunking_comparison"]
    assert comparison["chunking_comparison"]["markdown_slide_headers"][0]["slide_headers"] == [
        1,
        2,
        3,
    ]


def test_chunking_comparison_uses_no_provider_requests(tmp_path):
    material = tmp_path / "blank.pdf"
    writer = PdfWriter()
    writer.add_blank_page(width=600, height=800)
    writer.write(material)
    script = Path(__file__).resolve().parents[1] / "scripts" / "probe_material.py"
    result = subprocess.run(
        [sys.executable, str(script), "--material", str(material), "--chunking-only"],
        cwd=tmp_path,
        text=True,
        capture_output=True,
        check=False,
    )
    assert result.returncode == 0, result.stderr[-2000:]
    report = json.loads(result.stdout)
    assert report["paid_requests"] == 0
    assert report["max_chunk_tokens"] > 0
    assert report["chunking_comparison"]["native_page_headers"] == []
    assert report["chunking_comparison"]["markdown_page_headers"][0]["page_headers"] == [1]
