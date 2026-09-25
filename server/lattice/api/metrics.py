"""Telemetry in Prometheus text format. Nothing scrapes it until compose exists.

Hidden until `METRICS_TOKEN` is set (404, not 401, so the endpoint does not announce
itself), then guarded by `Authorization: Bearer <token>`. Kept out of the OpenAPI document:
it is an operator surface, not part of the app's contract.
"""

import secrets

from fastapi import APIRouter, HTTPException, Request, Response

from lattice import telemetry
from lattice.api.deps import SettingsDep

router = APIRouter()


@router.get("/metrics", include_in_schema=False)
def metrics(request: Request, settings: SettingsDep) -> Response:
    if settings.metrics_token is None:
        raise HTTPException(404, "Not Found")
    scheme, _, token = request.headers.get("authorization", "").partition(" ")
    if scheme.lower() != "bearer" or not secrets.compare_digest(token, settings.metrics_token):
        raise HTTPException(401, "invalid metrics token", headers={"WWW-Authenticate": "Bearer"})
    return Response(telemetry.render(), media_type=telemetry.CONTENT_TYPE)
