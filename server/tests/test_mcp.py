import asyncio
import hashlib
from contextlib import asynccontextmanager
from types import SimpleNamespace
from unittest.mock import AsyncMock
from uuid import UUID

import httpx
import pytest
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from lattice.config import Settings
from lattice.main import create_app
from lattice.note_review import ClaimSet
from lattice.registry import TierResult

CONTENT = b"Sign extension repeats the sign bit."
ANCHOR = {
    "course": "cs2100",
    "filename": "lecture.md",
    "page_number": 1,
    "material_id": hashlib.sha256(CONTENT).hexdigest(),
}


@pytest.fixture
def mcp_app(tmp_path):
    folder = tmp_path / "u" / "cs2100"
    folder.mkdir(parents=True)
    (folder / "lecture.md").write_bytes(CONTENT)
    app = create_app(
        Settings(
            _env_file=None,
            dev_header_auth=True,
            mcp_enabled=True,
            cognee_root=tmp_path / "c",
            uploads_dir=tmp_path / "u",
        )
    )
    app.state.engine.start = AsyncMock()
    app.state.engine.cognify_note = AsyncMock()
    return app


@asynccontextmanager
async def session(app, user="alice@example.com"):
    transport = httpx.ASGITransport(app=app, client=("127.0.0.1", 12345))
    async with httpx.AsyncClient(transport=transport, headers={"X-User": user}, timeout=10) as http:
        async with streamable_http_client("http://localhost/mcp/", http_client=http) as (
            read,
            write,
            _,
        ):
            async with ClientSession(read, write) as client:
                await client.initialize()
                yield client


def test_mcp_discovers_page_tools_and_persists_notes(mcp_app):
    async def exercise():
        async with mcp_app.router.lifespan_context(mcp_app), session(mcp_app) as client:
            tools = (await client.list_tools()).tools
            assert {t.name for t in tools} == {
                "get_material_context",
                "get_page_note",
                "upsert_page_note",
                "review_note",
                "ask_course",
            }
            for tool in tools:
                assert "owner" not in tool.inputSchema.get("properties", {})
                assert "email" not in tool.inputSchema.get("properties", {})
                assert "dataset_id" not in tool.inputSchema.get("properties", {})
            context = await client.call_tool(
                "get_material_context", {"course": "cs2100", "filename": "lecture.md"}
            )
            assert context.isError is False
            assert context.structuredContent["page_count"] == 1
            saved = await client.call_tool(
                "upsert_page_note",
                {"anchor": ANCHOR, "body_md": "My thought", "expected_revision": 0},
            )
            assert saved.isError is False
            assert saved.structuredContent["revision"] == 1
            loaded = await client.call_tool("get_page_note", {"anchor": ANCHOR})
            assert loaded.structuredContent["body_md"] == "My thought"
            conflict = await client.call_tool(
                "upsert_page_note",
                {"anchor": ANCHOR, "body_md": "Stale edit", "expected_revision": 0},
            )
            assert conflict.isError is True
            invalid = await client.call_tool(
                "get_page_note", {"anchor": {**ANCHOR, "page_number": 2}}
            )
            assert invalid.isError is True

    asyncio.run(exercise())


def test_concurrent_mcp_callers_have_separate_private_notes(mcp_app):
    async def caller(user, body):
        async with session(mcp_app, user) as client:
            empty = await client.call_tool("get_page_note", {"anchor": ANCHOR})
            assert empty.structuredContent["body_md"] == ""
            saved = await client.call_tool(
                "upsert_page_note",
                {"anchor": ANCHOR, "body_md": body, "expected_revision": 0},
            )
            assert saved.isError is False
            loaded = await client.call_tool("get_page_note", {"anchor": ANCHOR})
            assert loaded.structuredContent["body_md"] == body
            assert loaded.structuredContent["owner"] == user

    async def exercise():
        async with mcp_app.router.lifespan_context(mcp_app):
            await asyncio.gather(
                caller("alice@example.com", "Alice's private thought"),
                caller("bob@example.com", "Bob's private thought"),
            )

    asyncio.run(exercise())


def test_mcp_ask_preserves_rest_shape_and_rejects_foreign_sessions(mcp_app):
    engine = mcp_app.state.engine
    engine.principal = AsyncMock(return_value=SimpleNamespace(id=UUID(int=3)))
    engine.enrol = AsyncMock(
        return_value=(SimpleNamespace(id=UUID(int=1)), SimpleNamespace(id=UUID(int=2)))
    )
    engine.search = AsyncMock(
        return_value=[
            TierResult(
                tier="course", dataset_name="cs2100-global", answer="Official answer", evidence=[]
            )
        ]
    )

    async def exercise():
        async with mcp_app.router.lifespan_context(mcp_app):
            async with session(mcp_app) as alice:
                answer = await alice.call_tool(
                    "ask_course", {"course": "cs2100", "question": "Explain"}
                )
                assert answer.isError is False
                body = answer.structuredContent
                assert body["turn"]["results"][0]["answer"] == "Official answer"
                assert body["turn"]["used_notes"] is False
                wrong_course = await alice.call_tool(
                    "ask_course",
                    {"course": "cs101", "question": "Explain", "session_id": body["session_id"]},
                )
                assert wrong_course.isError is True
            async with session(mcp_app, "bob@example.com") as bob:
                refused = await bob.call_tool(
                    "ask_course",
                    {"course": "cs2100", "question": "Explain", "session_id": body["session_id"]},
                )
                assert refused.isError is True

    asyncio.run(exercise())


def test_mcp_review_does_not_save_and_sanitizes_provider_errors(mcp_app):
    engine = mcp_app.state.engine
    engine.generate = AsyncMock(return_value=ClaimSet(claims=[], has_more=False))
    engine.retrieve_official = AsyncMock(return_value=[])

    async def exercise():
        async with mcp_app.router.lifespan_context(mcp_app), session(mcp_app) as client:
            reviewed = await client.call_tool(
                "review_note", {"course": "cs2100", "body_md": "My draft"}
            )
            assert reviewed.isError is False
            assert (
                reviewed.structuredContent["draft_hash"] == hashlib.sha256(b"My draft").hexdigest()
            )
            empty = await client.call_tool("get_page_note", {"anchor": ANCHOR})
            assert empty.structuredContent["revision"] == 0
            engine.generate.side_effect = RuntimeError("sensitive-provider-diagnostic")
            failed = await client.call_tool(
                "review_note", {"course": "cs2100", "body_md": "My draft"}
            )
            assert failed.isError is True
            assert "sensitive-provider-diagnostic" not in failed.model_dump_json()

    asyncio.run(exercise())


@pytest.mark.parametrize(
    "address,headers,status",
    [
        ("127.0.0.1", {}, 401),
        ("127.0.0.1", {"X-User": "not-an-email"}, 401),
        ("203.0.113.1", {"X-User": "alice@example.com"}, 403),
        ("127.0.0.1", {"X-User": "alice@example.com", "Host": "untrusted.example"}, 403),
        ("127.0.0.1", {"X-User": "alice@example.com", "Origin": "https://untrusted.example"}, 403),
        ("127.0.0.1", {"X-User": "alice@example.com", "X-Forwarded-For": "127.0.0.1"}, 403),
    ],
)
def test_mcp_rejects_untrusted_requests(mcp_app, address, headers, status):
    async def exercise():
        transport = httpx.ASGITransport(app=mcp_app, client=(address, 12345))
        async with httpx.AsyncClient(transport=transport) as http:
            response = await http.post("http://localhost/mcp/", headers=headers, json={})
            assert response.status_code == status

    asyncio.run(exercise())


def test_mcp_is_disabled_by_default_and_requires_dev_identity(tmp_path):
    settings = Settings(
        _env_file=None, cognee_root=tmp_path / "c", dev_header_auth=False, mcp_enabled=False
    )
    app = create_app(settings)

    async def exercise():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as http:
            assert (await http.post("http://localhost/mcp/", json={})).status_code == 404

    asyncio.run(exercise())
    settings.mcp_enabled = True
    with pytest.raises(ValueError, match="development"):
        create_app(settings)
