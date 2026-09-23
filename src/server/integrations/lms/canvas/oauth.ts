import "server-only"

import { z } from "zod"
import { LmsError, type LmsTokenSet } from "../provider"
import type { CanvasConfig } from "./config"

// Canvas OAuth 2.0 (authorization code flow), per the Canvas OAuth2 docs:
//   GET    {canvas}/login/oauth2/auth    the student approves Student OS
//   POST   {canvas}/login/oauth2/token   code -> tokens; refresh_token -> new access token
//   DELETE {canvas}/login/oauth2/token   revoke the token (on disconnect)
// Access tokens last about an hour; the refresh token is reused (Canvas doesn't
// return a new one on refresh). The client secret only ever goes to the
// validated Canvas address, from the server.

export type Fetch = typeof fetch
const TIMEOUT_MS = 15_000

export function canvasAuthorizationUrl(config: CanvasConfig, baseUrl: string, state: string): string {
  const url = new URL("/login/oauth2/auth", baseUrl)
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("state", state)
  if (config.scopes.length > 0) url.searchParams.set("scope", config.scopes.join(" "))
  // Shown to the student on Canvas's approval page.
  url.searchParams.set("purpose", "Student OS")
  return url.toString()
}

// Canvas's token response (only the fields Student OS uses).
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  user: z.object({ id: z.union([z.number(), z.string()]) }).partial().optional(),
})

async function tokenRequest(baseUrl: string, body: Record<string, string>, fetchImpl: Fetch, now: Date): Promise<LmsTokenSet> {
  let response: Response
  try {
    response = await fetchImpl(new URL("/login/oauth2/token", baseUrl), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams(body),
      // Never follow a redirect with the client secret in the body.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new LmsError("Canvas is temporarily unavailable. Please try again.")
  }
  // 400/401 from the token endpoint: the code or refresh token was rejected.
  if (response.status === 400 || response.status === 401) {
    throw new LmsError("Your Canvas connection expired. Please reconnect.", "connection", true)
  }
  if (!response.ok) throw new LmsError("Canvas is temporarily unavailable. Please try again.")
  const parsed = tokenResponse.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new LmsError("Canvas sent a sign-in response Student OS couldn't read.")
  const data = parsed.data
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(now.getTime() + data.expires_in * 1000) : null,
    externalUserId: data.user?.id !== undefined ? String(data.user.id) : null,
  }
}

export function exchangeCanvasCode(
  config: CanvasConfig,
  baseUrl: string,
  code: string,
  fetchImpl: Fetch = fetch,
  now = new Date()
): Promise<LmsTokenSet> {
  return tokenRequest(
    baseUrl,
    {
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      code,
    },
    fetchImpl,
    now
  )
}

export async function refreshCanvasToken(
  config: CanvasConfig,
  baseUrl: string,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now = new Date()
): Promise<LmsTokenSet> {
  const tokens = await tokenRequest(
    baseUrl,
    {
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      refresh_token: refreshToken,
    },
    fetchImpl,
    now
  )
  // Canvas keeps the same refresh token.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}

// Best effort: disconnecting in Student OS must work even if Canvas can't be reached.
export async function revokeCanvasToken(baseUrl: string, accessToken: string, fetchImpl: Fetch = fetch): Promise<void> {
  try {
    await fetchImpl(new URL("/login/oauth2/token", baseUrl), {
      method: "DELETE",
      headers: { Authorization: `Bearer ${accessToken}` },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    // Ignored: the token is deleted from Student OS either way, and expires within the hour.
  }
}
