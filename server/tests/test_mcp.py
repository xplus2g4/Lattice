import asyncio
import hashlib
from contextlib import asynccontextmanager
from unittest.mock import AsyncMock

import httpx
import pytest
import pytest_asyncio
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client

from lattice.config import Settings
from lattice.main import create_app as create_api
from lattice.mcp import create_app
from lattice.note_review import ClaimSet
from lattice.retrieval import TierResult
from tests.test_materials import BOB, join, upload

CONTENT = b"Sign extension repeats the sign bit."
ANCHOR = {
    "course": "cs2100",
    "filename": "lecture.md",
    "page_number": 1,
    "material_id": hashlib.sha256(CONTENT).hexdigest(),
}
pytestmark = pytest.mark.asyncio


@pytest_asyncio.fixture
async def mcp_app(student, settings, sessionmaker, app):
    await join(student, "cs2100")
    await join(student, "cs101")
    await upload(student, content=CONTENT, filename="lecture.md", course="cs2100")
    await student.post("/enrolments.join", json={"course": "cs2100"}, headers=BOB)
    from lattice.api.deps import get_session

    lock = asyncio.Lock()

    async def serialized_session():
        async with lock, sessionmaker() as session, session.begin():
            yield session

    app.dependency_overrides[get_session] = serialized_session
    mcp = create_app(settings.model_copy(update={"mcp_enabled": True}))
    lifespan = mcp.router.lifespan_context

    @asynccontextmanager
    async def connected_lifespan(instance):
        async with (
            lifespan(instance),
            httpx.AsyncClient(
                transport=httpx.ASGITransport(app=app), base_url="http://api"
            ) as client,
        ):
            instance.state.api_client = client
            yield

    mcp.router.lifespan_context = connected_lifespan
    return mcp


@asynccontextmanager
async def mcp_session(app, user="ada@example.com"):
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


async def test_mcp_discovers_page_tools_and_persists_notes(mcp_app, student):
    async with mcp_app.router.lifespan_context(mcp_app), mcp_session(mcp_app) as client:
        tools = (await client.list_tools()).tools
        assert {t.name for t in tools} == {
            "get_material_context",
            "get_page_note",
            "upsert_page_note",
            "review_note",
            "ask_course",
        }
        for tool in tools:
            assert (
                not {"owner", "email", "dataset_id"} & tool.inputSchema.get("properties", {}).keys()
            )
        context = await client.call_tool(
            "get_material_context", {"course": "cs2100", "filename": "lecture.md"}
        )
        assert not context.isError
        assert context.structuredContent["page_count"] == 1
        saved = await client.call_tool(
            "upsert_page_note", {"anchor": ANCHOR, "body_md": "My thought", "expected_revision": 0}
        )
        assert not saved.isError
        assert saved.structuredContent["revision"] == 1
        loaded = await client.call_tool("get_page_note", {"anchor": ANCHOR})
        assert loaded.structuredContent["body_md"] == "My thought"
        conflict = await client.call_tool(
            "upsert_page_note", {"anchor": ANCHOR, "body_md": "Stale edit", "expected_revision": 0}
        )
        assert conflict.isError
        invalid = await client.call_tool("get_page_note", {"anchor": {**ANCHOR, "page_number": 2}})
        assert invalid.isError
    rows = (await student.get("/notes.list", params={"course": "cs2100"})).json()
    assert [(n["id"], n["body_md"]) for n in rows] == [
        (saved.structuredContent["id"], "My thought")
    ]


async def test_concurrent_mcp_callers_have_separate_private_notes(mcp_app):
    async def caller(user, body):
        async with mcp_session(mcp_app, user) as client:
            empty = await client.call_tool("get_page_note", {"anchor": ANCHOR})
            assert empty.structuredContent["body_md"] == ""
            saved = await client.call_tool(
                "upsert_page_note", {"anchor": ANCHOR, "body_md": body, "expected_revision": 0}
            )
            assert not saved.isError
            loaded = await client.call_tool("get_page_note", {"anchor": ANCHOR})
            assert loaded.structuredContent["body_md"] == body
            assert loaded.structuredContent["owner"] == user

    async with mcp_app.router.lifespan_context(mcp_app):
        await asyncio.gather(
            caller("ada@example.com", "Ada's private thought"),
            caller("bob@example.com", "Bob's private thought"),
        )


async def test_mcp_ask_persists_sessions_and_rejects_foreign_sessions(mcp_app, engine, student):
    engine.results = [
        TierResult(
            tier="course", dataset_name="cs2100-global", answer="Official answer", evidence=[]
        )
    ]
    async with mcp_app.router.lifespan_context(mcp_app):
        async with mcp_session(mcp_app) as ada:
            answer = await ada.call_tool("ask_course", {"course": "cs2100", "question": "Explain"})
            assert not answer.isError
            body = answer.structuredContent
            assert body["turn"]["results"][0]["answer"] == "Official answer"
            assert body["turn"]["used_notes"] is False
            wrong_course = await ada.call_tool(
                "ask_course",
                {"course": "cs101", "question": "Explain", "session_id": body["session_id"]},
            )
            assert wrong_course.isError
        async with mcp_session(mcp_app, "bob@example.com") as bob:
            refused = await bob.call_tool(
                "ask_course",
                {"course": "cs2100", "question": "Explain", "session_id": body["session_id"]},
            )
            assert refused.isError
    stored = await student.get("/sessions.get", params={"session": body["session_id"]})
    assert [t["role"] for t in stored.json()["turns"]] == ["user", "assistant"]


async def test_mcp_review_does_not_save_and_sanitizes_provider_errors(mcp_app, engine):
    engine.generate = AsyncMock(return_value=ClaimSet(claims=[], has_more=False))
    engine.retrieve_official = AsyncMock(return_value=[])
    async with mcp_app.router.lifespan_context(mcp_app), mcp_session(mcp_app) as client:
        reviewed = await client.call_tool(
            "review_note", {"course": "cs2100", "body_md": "My draft"}
        )
        assert not reviewed.isError
        assert reviewed.structuredContent["draft_hash"] == hashlib.sha256(b"My draft").hexdigest()
        empty = await client.call_tool("get_page_note", {"anchor": ANCHOR})
        assert empty.structuredContent["revision"] == 0
        engine.generate.side_effect = RuntimeError("sensitive-provider-diagnostic")
        failed = await client.call_tool("review_note", {"course": "cs2100", "body_md": "My draft"})
        assert failed.isError
        assert "sensitive-provider-diagnostic" not in failed.model_dump_json()


async def test_mcp_honors_private_note_opt_out(mcp_app, student, engine):
    await student.post("/me.update", json={"notes_opt_out": True})
    async with mcp_app.router.lifespan_context(mcp_app), mcp_session(mcp_app) as client:
        saved = await client.call_tool(
            "upsert_page_note",
            {"anchor": ANCHOR, "body_md": "Keep out of Cognee", "expected_revision": 0},
        )
        assert not saved.isError
        assert saved.structuredContent["status"] == "stored"
        assert saved.structuredContent["cognify_enabled"] is False
        answer = await client.call_tool("ask_course", {"course": "cs2100", "question": "Explain"})
        assert not answer.isError
        assert set(engine.searched[-1].values()) == {"course"}


async def test_mcp_requires_enrolment_for_every_course_operation(mcp_app):
    async with (
        mcp_app.router.lifespan_context(mcp_app),
        mcp_session(mcp_app, "outsider@example.com") as client,
    ):
        for name, args in [
            ("get_material_context", {"course": "cs2100", "filename": "lecture.md"}),
            ("get_page_note", {"anchor": ANCHOR}),
            ("upsert_page_note", {"anchor": ANCHOR, "body_md": "Sneaky", "expected_revision": 0}),
            ("review_note", {"course": "cs2100", "body_md": "Sneaky"}),
            ("ask_course", {"course": "cs2100", "question": "Sneaky"}),
        ]:
            result = await client.call_tool(name, args)
            assert result.isError
            assert "not enrolled" in result.model_dump_json()


@pytest.mark.parametrize(
    "address,headers,status",
    [
        ("127.0.0.1", {}, 401),
        ("127.0.0.1", {"X-User": "not-an-email"}, 401),
        ("203.0.113.1", {"X-User": "ada@example.com"}, 403),
        ("127.0.0.1", {"X-User": "ada@example.com", "Host": "untrusted.example"}, 403),
        ("127.0.0.1", {"X-User": "ada@example.com", "Origin": "https://untrusted.example"}, 403),
        ("127.0.0.1", {"X-User": "ada@example.com", "X-Forwarded-For": "127.0.0.1"}, 403),
    ],
)
async def test_mcp_rejects_untrusted_requests(tmp_path, address, headers, status):
    app = create_app(
        Settings(_env_file=None, cognee_root=tmp_path / "c", dev_header_auth=True, mcp_enabled=True)
    )
    transport = httpx.ASGITransport(app=app, client=(address, 12345))
    async with httpx.AsyncClient(transport=transport) as http:
        response = await http.post("http://localhost/mcp/", headers=headers, json={})
        assert response.status_code == status


async def test_api_never_mounts_mcp_and_adapter_requires_opt_in(tmp_path):
    settings = Settings(
        _env_file=None, cognee_root=tmp_path / "c", dev_header_auth=False, mcp_enabled=False
    )
    for enabled in (False, True):
        settings.mcp_enabled = enabled
        app = create_api(settings)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app)) as http:
            assert (await http.post("http://localhost/mcp/", json={})).status_code == 404
        with pytest.raises(ValueError, match="development"):
            create_app(settings)
    settings.dev_header_auth = True
    settings.mcp_enabled = False
    with pytest.raises(ValueError, match="MCP_ENABLED"):
        create_app(settings)


async def test_mcp_starts_without_backend_storage_and_handles_api_outage(tmp_path):
    settings = Settings(
        _env_file=None,
        dev_header_auth=True,
        mcp_enabled=True,
        cognee_root=tmp_path / "untouched",
        uploads_dir=tmp_path / "uploads",
        database_url="invalid-unused-url",
    )
    app = create_app(settings)

    def unavailable(request):
        raise httpx.ConnectError("sensitive-connection-diagnostic", request=request)

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.MockTransport(unavailable), base_url="http://api"
        ) as upstream,
    ):
        app.state.api_client = upstream
        async with mcp_session(app) as client:
            assert len((await client.list_tools()).tools) == 5
            result = await client.call_tool("ask_course", {"course": "cs2100", "question": "Why?"})
            assert result.isError
            assert "sensitive-connection-diagnostic" not in result.model_dump_json()
    assert not settings.cognee_root.exists()
    assert not settings.uploads_dir.exists()


@pytest.mark.parametrize(
    "tool,path,arguments,payload",
    [
        (
            "get_material_context",
            "/study/materialContext",
            {"course": "cs2100", "filename": "lecture.md"},
            {"course": "cs2100", "filename": "lecture.md"},
        ),
        ("get_page_note", "/study/pageNote.get", {"anchor": ANCHOR}, ANCHOR),
        (
            "upsert_page_note",
            "/study/pageNote.save",
            {"anchor": ANCHOR, "body_md": "Draft", "expected_revision": 3},
            {"anchor": ANCHOR, "body_md": "Draft", "expected_revision": 3},
        ),
        (
            "review_note",
            "/study/note.review",
            {"course": "cs2100", "body_md": "Draft"},
            {"course": "cs2100", "body_md": "Draft"},
        ),
        (
            "ask_course",
            "/study/ask",
            {"course": "cs2100", "question": "Why?"},
            {
                "course": "cs2100",
                "question": "Why?",
                "session_id": None,
                "query_type": "GRAPH_COMPLETION",
            },
        ),
    ],
)
async def test_tools_forward_each_caller_to_api(tmp_path, tool, path, arguments, payload):
    import json

    app = create_app(
        Settings(
            _env_file=None,
            dev_header_auth=True,
            mcp_enabled=True,
            cognee_root=tmp_path / "unused",
            uploads_dir=tmp_path / "uploads",
        )
    )
    callers = []

    async def upstream(request):
        assert request.url.path == path
        assert json.loads(request.content) == payload
        callers.append(request.headers["X-User"])
        await asyncio.sleep(0)
        return httpx.Response(403, json={"detail": "not enrolled in this course"})

    async def call(user):
        async with mcp_session(app, user) as client:
            result = await client.call_tool(tool, arguments)
            assert result.isError
            assert "not enrolled" in result.model_dump_json()

    async with (
        app.router.lifespan_context(app),
        httpx.AsyncClient(
            transport=httpx.MockTransport(upstream), base_url="http://api"
        ) as api_client,
    ):
        app.state.api_client = api_client
        await asyncio.gather(call("Ada@Example.com"), call("bob@example.com"))
    assert sorted(callers) == ["ada@example.com", "bob@example.com"]
