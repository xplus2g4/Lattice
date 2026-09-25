# The API trusts a Lattice-minted Bearer token, not Google's id_token

The web app runs the Google OAuth code flow itself, verifies the `id_token` once at callback, keeps the identity in its session cookie, and mints a short-lived HS256 JWT (`TOKEN_SECRET`, shared web↔API) that the browser sends as `Authorization: Bearer`. The API verifies that token locally; it never talks to Google.

Passing Google's `id_token` through to the API was rejected: it would put a Google JWKS fetch and an hourly-expiry refresh problem on every API call, for no gain — the web app already established who the user is when it set the session cookie. The cost is that `TOKEN_SECRET` can now mint anyone, so it is a deploy secret on both sides, and the invite gate (a `users` row or a single-use Invite) is what actually admits strangers.

## Consequences

- Account admission lives at `current_user` in `server/lattice/api/deps.py`: a valid token whose email has no `users` row gets 403 "invite required".
- `X-User` stays behind `DEV_HEADER_AUTH` for tests and local dev; production Bearer auth and the header path never overlap.
- Rotating `TOKEN_SECRET` invalidates every minted token at once, which is a feature: sessions survive (the web app re-mints), leaked tokens die.
