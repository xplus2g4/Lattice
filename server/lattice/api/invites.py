from datetime import timedelta
from typing import Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from lattice.api.deps import (
    CurrentIdentity,
    CurrentUser,
    SessionDep,
    SettingsDep,
)
from lattice.api.schemas import InviteOut, InviteSummaryOut, UserOut
from lattice.db.repo import invites, users

router = APIRouter(tags=["invites"])


class CreateInvite(BaseModel):
    role: Literal["student", "instructor", "admin"] = "student"
    expires_in_days: int = Field(default=7, ge=1, le=90)


class RedeemInvite(BaseModel):
    token: str = Field(min_length=4, max_length=256)


@router.post("/invites.create", status_code=201)
async def create_invite(user: CurrentUser, body: CreateInvite, session: SessionDep) -> InviteOut:
    """Mint an access ticket. The raw token is returned once; only its hash is stored."""
    if user.role not in ("instructor", "admin"):
        raise HTTPException(403, "only instructors and admins may create invites")
    invite, token = await invites.create(
        session,
        role=body.role,
        ttl=timedelta(days=body.expires_in_days),
        created_by=user.id,
    )
    return InviteOut(
        token=token,
        role=invite.role,
        expires_at=invite.expires_at,
        created_at=invite.created_at,
    )


@router.get("/invites.list")
async def list_invites(user: CurrentUser, session: SessionDep) -> list[InviteSummaryOut]:
    """Every invite minted, with status. Never returns a token — those are one-time."""
    if user.role not in ("instructor", "admin"):
        raise HTTPException(403, "only instructors and admins may view invites")
    rows = await invites.list_all(session)
    ids = {i for r in rows for i in (r.created_by, r.used_by) if i is not None}
    emails = {u.id: u.email for u in await users.by_ids(session, ids)}
    return [
        InviteSummaryOut(
            id=r.id,
            role=r.role,
            expires_at=r.expires_at,
            created_at=r.created_at,
            created_by_email=emails.get(r.created_by) if r.created_by else None,
            used_at=r.used_at,
            used_by_email=emails.get(r.used_by) if r.used_by else None,
        )
        for r in rows
    ]


@router.post("/invites.redeem")
async def redeem_invite(
    identity: CurrentIdentity,
    body: RedeemInvite,
    session: SessionDep,
    settings: SettingsDep,
) -> UserOut:
    """First-sight account creation: the invite is the only way in, and it burns on use."""
    user = await users.by_email(session, identity.email)
    if user is not None:
        return UserOut.model_validate(user)
    if (
        settings.dev_header_auth
        and settings.dev_invite_code
        and body.token == settings.dev_invite_code
    ):
        # Dev door: the fixed code lets local setups in without minting invites.
        user = await users.create(session, identity.email, role="student")
        return UserOut.model_validate(user)
    invite = await invites.by_token(session, body.token)
    if not invites.usable(invite):
        raise HTTPException(403, "invite is invalid, expired or already used")
    user = await users.create(session, identity.email, role=invite.role)
    await invites.burn(session, invite, user)
    return UserOut.model_validate(user)
