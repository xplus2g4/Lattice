/** Server-only auth: the Google handshake, the session cookie, and minting the
 * Lattice Bearer token the API verifies. Imported by the /auth/* server routes and
 * dynamically by the server functions in ./auth.ts — never by client code. */
import { createHash, randomBytes } from 'node:crypto'

import { SignJWT, createRemoteJWKSet, jwtVerify } from 'jose'
import { useSession } from '@tanstack/react-start/server'

export interface SessionData {
  sub: string
  email: string
  name?: string
  picture?: string
  oauthState?: string
  codeVerifier?: string
  pendingInvite?: string
}

const API_URL: string = import.meta.env.VITE_API_URL ?? 'http://localhost:8000'
const TOKEN_TTL_S = 12 * 3600

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
)

function env(name: string): string {
  const value = process.env[name]
  if (!value) throw new Error(`${name} is not set`)
  return value
}

export function session() {
  return useSession<SessionData>({
    name: 'lattice',
    password: env('SESSION_SECRET'),
    maxAge: 7 * 24 * 3600,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
    },
  })
}

export function pkce() {
  const verifier = randomBytes(32).toString('base64url')
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

export function googleAuthUrl(state: string, challenge: string): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: env('GOOGLE_CLIENT_ID'),
    redirect_uri: env('GOOGLE_REDIRECT_URI'),
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  }).toString()
  return url.toString()
}

export async function exchangeCode(
  code: string,
  verifier: string,
): Promise<{ id_token: string }> {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: env('GOOGLE_CLIENT_ID'),
      client_secret: env('GOOGLE_CLIENT_SECRET'),
      redirect_uri: env('GOOGLE_REDIRECT_URI'),
      grant_type: 'authorization_code',
      code_verifier: verifier,
    }),
  })
  if (!res.ok) throw new Error(`token exchange failed: ${res.status}`)
  return res.json()
}

export async function verifyGoogleId(idToken: string) {
  const { payload } = await jwtVerify(idToken, GOOGLE_JWKS, {
    issuer: ['https://accounts.google.com', 'accounts.google.com'],
    audience: env('GOOGLE_CLIENT_ID'),
  })
  if (payload.email_verified !== true || typeof payload.email !== 'string')
    throw new Error('google account has no verified email')
  return {
    sub: payload.sub!,
    email: payload.email,
    name: typeof payload.name === 'string' ? payload.name : undefined,
    picture: typeof payload.picture === 'string' ? payload.picture : undefined,
  }
}

/** The token the API trusts: HS256, shared TOKEN_SECRET. The API checks nothing else. */
export async function mintToken(user: {
  sub: string
  email: string
  name?: string
}): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Math.floor(Date.now() / 1000) + TOKEN_TTL_S
  const token = await new SignJWT({ email: user.email, name: user.name })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.sub)
    .setIssuedAt()
    .setExpirationTime(expiresAt)
    .sign(new TextEncoder().encode(env('TOKEN_SECRET')))
  return { token, expiresAt }
}

/** `Response.redirect` makes an immutable header set, which the header merge that
 * attaches the session cookie cannot write to — build the 302 by hand. */
export function redirect(location: string): Response {
  return new Response(null, { status: 302, headers: { Location: location } })
}

/** A server-side call to the Lattice API with the caller's Bearer token. */
export function apiCall(path: string, token: string, init?: RequestInit) {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: { ...init?.headers, Authorization: `Bearer ${token}` },
  })
}
