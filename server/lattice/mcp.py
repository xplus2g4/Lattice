import asyncio
from contextlib import asynccontextmanager
from ipaddress import ip_address
from typing import Annotated
from urllib.parse import urlsplit

import httpx
from fastapi import FastAPI, Request
from fastapi.responses import PlainTextResponse
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field

from lattice.config import Settings, get_settings
from lattice.note_review import NoteReview
from lattice.page_notes import (
    Course,
    Filename,
    MaterialContext,
    NoteText,
    PageAnchor,
    PageNote,
)
from lattice.study import AskResponse, QueryType


class LocalMCP:
    def __init__(self, app, settings: Settings):
        self.app = app
        self.settings = settings

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        request = Request(scope)
        try:
            host = urlsplit(f"//{request.headers.get('host', '')}").hostname
            local = ip_address(request.client.host).is_loopback if request.client else False
            origin = request.headers.get("origin")
            if (
                not local
                or host not in {"localhost", "127.0.0.1", "::1"}
                or any(h == "forwarded" or h.startswith("x-forwarded-") for h in request.headers)
                or len(request.headers.getlist("host")) != 1
                or (
                    origin is not None
                    and origin != f"{request.url.scheme}://{request.headers['host']}"
                )
            ):
                return await PlainTextResponse(
                    "MCP is restricted to local callers", status_code=403
                )(scope, receive, send)
        except ValueError:
            return await PlainTextResponse("Invalid local request", status_code=403)(
                scope, receive, send
            )
        user = request.headers.get("x-user", "").strip().lower()
        if (
            not self.settings.dev_header_auth
            or "@" not in user
            or len(request.headers.getlist("x-user")) != 1
        ):
            return await PlainTextResponse("Development identity required", status_code=401)(
                scope, receive, send
            )
        request.state.lattice_email = user
        return await self.app(scope, receive, send)


def caller(ctx: Context) -> str:
    request = ctx.request_context.request
    email = getattr(request.state, "lattice_email", None) if request else None
    if not email:
        raise ToolError("Development identity required")
    return email


def create_app(settings: Settings | None = None) -> FastAPI:
    """Standalone MCP process; the API owns all persistence and Cognee access."""
    settings = settings or get_settings()
    if not settings.mcp_enabled or not settings.dev_header_auth:
        raise ValueError("MCP requires MCP_ENABLED=true and development header identity")

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        async with httpx.AsyncClient(
            base_url=settings.mcp_api_url,
            timeout=130,
            follow_redirects=False,
            trust_env=False,
        ) as client:
            app.state.api_client = client
            async with mcp.session_manager.run():
                yield

    app = FastAPI(title="Lattice MCP", lifespan=lifespan, docs_url=None, redoc_url=None)
    mcp = create_mcp(app)
    app.mount("/mcp", LocalMCP(mcp.streamable_http_app(), settings))
    return app


def create_mcp(app) -> FastMCP:
    async def request(ctx: Context, path: str, body: dict, response_type):
        try:
            async with asyncio.timeout(135):
                response = await app.state.api_client.post(
                    path, json=body, headers={"X-User": caller(ctx)}
                )
                if response.status_code in {401, 403, 404, 409}:
                    raise ToolError(response.json()["detail"])
                if response.status_code == 422:
                    raise ToolError(
                        "Invalid input or Material/Page context; refresh context and retry"
                    )
                response.raise_for_status()
                return response_type.model_validate(response.json())
        except ToolError:
            raise
        except Exception:
            raise ToolError("Operation could not be completed; please retry") from None

    mcp = FastMCP(
        "Lattice Study Tools",
        host="127.0.0.1",
        stateless_http=True,
        json_response=True,
        streamable_http_path="/",
        max_request_body_size=256_000,
        transport_security=TransportSecuritySettings(
            enable_dns_rebinding_protection=True,
            allowed_hosts=[
                "localhost",
                "localhost:*",
                "127.0.0.1",
                "127.0.0.1:*",
                "[::1]",
                "[::1]:*",
            ],
            allowed_origins=[
                "http://localhost",
                "http://localhost:*",
                "http://127.0.0.1",
                "http://127.0.0.1:*",
            ],
        ),
    )
    read_only = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)

    @mcp.tool(
        description=(
            "Get the content identity and real Page count of a stored course Material. "
            "Markdown/text have one Page; Topic mapping is not available yet."
        ),
        annotations=read_only,
    )
    async def get_material_context(
        course: Course, filename: Filename, ctx: Context
    ) -> MaterialContext:
        return await request(
            ctx, "/study/materialContext", {"course": course, "filename": filename}, MaterialContext
        )

    @mcp.tool(
        description=(
            "Read your private Note for a validated Material/Page. Revision zero means no Note yet."
        ),
        annotations=read_only,
    )
    async def get_page_note(anchor: PageAnchor, ctx: Context) -> PageNote:
        return await request(ctx, "/study/pageNote.get", anchor.model_dump(), PageNote)

    @mcp.tool(
        description=(
            "Persist your private Page Note, using its expected revision to avoid overwriting "
            "newer edits. Use only for an explicitly requested edit; never rewrite student text "
            "without permission. Empty text clears the Note. Cognify is delayed and its status "
            "is separate from saving."
        ),
        annotations=ToolAnnotations(
            readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False
        ),
    )
    async def upsert_page_note(
        anchor: PageAnchor,
        body_md: NoteText,
        expected_revision: Annotated[int, Field(ge=0)],
        ctx: Context,
    ) -> PageNote:
        return await request(
            ctx,
            "/study/pageNote.save",
            {
                "anchor": anchor.model_dump(),
                "body_md": body_md,
                "expected_revision": expected_revision,
            },
            PageNote,
        )

    @mcp.tool(
        description=(
            "Review a supplied Note draft against official course Materials only. Returns "
            "bounded claim-level feedback, retrieved Chunk citations and a draft hash. Does not "
            "save, rewrite or Cognify the draft. Insufficient evidence does not mean incorrect. "
            "Sends draft/evidence to the configured LLM provider."
        ),
        annotations=ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=True),
    )
    async def review_note(course: Course, body_md: NoteText, ctx: Context) -> NoteReview:
        return await request(
            ctx, "/study/note.review", {"course": course, "body_md": body_md}, NoteReview
        )

    @mcp.tool(
        name="ask_course",
        description=(
            "Ask within one course's official Materials and your private Notes. Returns "
            "separate tier answers/evidence and records Session Turns. CHUNKS returns retrieval "
            "without answer generation. Generation uses the configured LLM provider; "
            "no cross-course Sessions."
        ),
        annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, openWorldHint=True),
    )
    async def ask(
        course: Course,
        question: Annotated[str, Field(min_length=1, max_length=2_000)],
        ctx: Context,
        session_id: Annotated[str | None, Field(max_length=64)] = None,
        query_type: QueryType = "GRAPH_COMPLETION",
    ) -> AskResponse:
        return await request(
            ctx,
            "/study/ask",
            {
                "course": course,
                "question": question,
                "session_id": session_id,
                "query_type": query_type,
            },
            AskResponse,
        )

    return mcp


def main() -> None:
    import uvicorn

    uvicorn.run(
        "lattice.mcp:create_app", factory=True, host="127.0.0.1", port=8001, proxy_headers=False
    )


if __name__ == "__main__":
    main()
