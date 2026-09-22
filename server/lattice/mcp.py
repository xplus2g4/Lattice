import asyncio
from ipaddress import ip_address
from typing import Annotated
from urllib.parse import urlsplit

from fastapi import Request
from fastapi.responses import PlainTextResponse
from mcp.server.fastmcp import Context, FastMCP
from mcp.server.fastmcp.exceptions import ToolError
from mcp.server.transport_security import TransportSecuritySettings
from mcp.types import ToolAnnotations
from pydantic import Field

from lattice.config import Settings
from lattice.db.repo import courses, users
from lattice.note_review import NoteReview, NoteReviewer
from lattice.page_notes import (
    Course,
    Filename,
    MaterialContext,
    NoteText,
    PageAnchor,
    PageNote,
    PageNotes,
    RevisionConflict,
)
from lattice.study import AskRequest, AskResponse, QueryType, SessionAccessError, ask_course


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


async def checked(operation):
    try:
        async with asyncio.timeout(125):
            return await operation
    except (RevisionConflict, SessionAccessError, courses.CourseAccessError) as exc:
        raise ToolError(str(exc)) from None
    except ValueError:
        raise ToolError(
            "Invalid input or Material/Page context; refresh context and retry"
        ) from None
    except Exception:
        raise ToolError("Operation could not be completed; please retry") from None


def create_mcp(app, settings: Settings) -> FastMCP:
    async def transact(ctx: Context, operation):
        async with app.state.database.sessionmaker() as session, session.begin():
            return await operation(session, caller(ctx))

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
        return await checked(
            transact(
                ctx,
                lambda session, owner: PageNotes(session, settings).context(
                    owner, course, filename
                ),
            )
        )

    @mcp.tool(
        description=(
            "Read your private Note for a validated Material/Page. Revision zero means no Note yet."
        ),
        annotations=read_only,
    )
    async def get_page_note(anchor: PageAnchor, ctx: Context) -> PageNote:
        return await checked(
            transact(ctx, lambda session, owner: PageNotes(session, settings).get(owner, anchor))
        )

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
        return await checked(
            transact(
                ctx,
                lambda session, owner: PageNotes(session, settings).upsert(
                    owner, anchor, body_md, expected_revision=expected_revision
                ),
            )
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
        async def authorize(session, owner):
            user = await users.get_or_create(session, owner)
            await courses.require_enrolment(session, user, course)
            return user.email

        owner = await checked(transact(ctx, authorize))
        reviewer = NoteReviewer(app.state.engine.retrieve_official, app.state.engine.generate)
        return await checked(reviewer.review(course, owner, body_md))

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
        return await checked(
            transact(
                ctx,
                lambda session, owner: ask_course(
                    app.state.engine,
                    session,
                    course,
                    owner,
                    AskRequest(question=question, session_id=session_id, query_type=query_type),
                ),
            )
        )

    return mcp
