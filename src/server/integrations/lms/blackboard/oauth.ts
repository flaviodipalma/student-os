import "server-only"

import { z } from "zod"
import { pkceChallenge } from "../oauth-state"
import { LmsError, LmsNotApprovedError, type LmsTokenSet } from "../provider"
import type { BlackboardConfig } from "./config"

// Blackboard Learn three-legged OAuth 2.0 ("3LO"), per the Learn REST docs
// (Getting Started > 3-Legged OAuth, Basic Authentication) and the Learn API spec:
//
//   GET  {learn}/learn/api/public/v1/oauth2/authorizationcode
//        ?redirect_uri&response_type=code&client_id=<app key>&scope&state
//        &code_challenge&code_challenge_method=S256          the student signs in and approves
//   POST {learn}/learn/api/public/v1/oauth2/token
//        ?grant_type=authorization_code&code&redirect_uri&code_verifier    code -> tokens
//        ?grant_type=refresh_token&refresh_token&redirect_uri              refresh ("offline" scope)
//        The app authenticates with HTTP Basic (key:secret), sent only to the
//        validated Learn address, from the server.
//
// Access tokens last about an hour. The token response names the student by
// UUID (user_id); the REST API's own primary id ("_123_1") is looked up once,
// right after signing in. Learn has no public endpoint for revoking a token.

export type Fetch = typeof fetch
const TIMEOUT_MS = 15_000
const TOKEN_PATH = "/learn/api/public/v1/oauth2/token"

export function blackboardAuthorizationUrl(
  config: BlackboardConfig,
  baseUrl: string,
  state: string,
  codeVerifier: string
): string {
  const url = new URL("/learn/api/public/v1/oauth2/authorizationcode", baseUrl)
  url.searchParams.set("redirect_uri", config.redirectUri)
  url.searchParams.set("response_type", "code")
  url.searchParams.set("client_id", config.clientId)
  url.searchParams.set("scope", "read offline")
  url.searchParams.set("state", state)
  url.searchParams.set("code_challenge", pkceChallenge(codeVerifier))
  url.searchParams.set("code_challenge_method", "S256")
  return url.toString()
}

// Learn's token response (only the fields Student OS uses).
const tokenResponse = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  user_id: z.string().min(1).optional(),
})

const unavailable = () => new LmsError("Blackboard is temporarily unavailable. Please try again.")

async function tokenRequest(
  config: BlackboardConfig,
  baseUrl: string,
  params: Record<string, string>,
  fetchImpl: Fetch,
  now: Date
): Promise<LmsTokenSet> {
  const url = new URL(TOKEN_PATH, baseUrl)
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
  const basic = Buffer.from(`${config.clientId}:${config.clientSecret}`).toString("base64")
  let response: Response
  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basic}`,
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({ grant_type: params.grant_type }),
      // Never follow a redirect with the app's credentials.
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw unavailable()
  }
  if (response.status === 401) {
    // "Invalid client credentials, or no access granted to this Learn server":
    // Blackboard doesn't know Student OS at this school (not approved, or removed).
    throw new LmsNotApprovedError(
      "Your school hasn't enabled Student OS in Blackboard. Ask your Blackboard administrator to approve it."
    )
  }
  // 400: the code or refresh token was rejected (expired, used, or revoked).
  if (response.status === 400) throw new LmsError("Your Blackboard connection expired. Please reconnect.", "connection", true)
  if (response.status === 429) throw new LmsError("Blackboard is busy right now. Please try again in a few minutes.")
  if (!response.ok) throw unavailable()
  const parsed = tokenResponse.safeParse(await response.json().catch(() => null))
  if (!parsed.success) throw new LmsError("Blackboard sent a sign-in response Student OS couldn't read.")
  const data = parsed.data
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? null,
    expiresAt: data.expires_in ? new Date(now.getTime() + data.expires_in * 1000) : null,
    // A UUID here; replaced by the primary id after sign-in (see resolveBlackboardUserId).
    externalUserId: data.user_id ?? null,
  }
}

export function exchangeBlackboardCode(
  config: BlackboardConfig,
  baseUrl: string,
  code: string,
  codeVerifier: string,
  fetchImpl: Fetch = fetch,
  now = new Date()
): Promise<LmsTokenSet> {
  return tokenRequest(
    config,
    baseUrl,
    { grant_type: "authorization_code", code, redirect_uri: config.redirectUri, code_verifier: codeVerifier },
    fetchImpl,
    now
  )
}

export async function refreshBlackboardToken(
  config: BlackboardConfig,
  baseUrl: string,
  refreshToken: string,
  fetchImpl: Fetch = fetch,
  now = new Date()
): Promise<LmsTokenSet> {
  const tokens = await tokenRequest(
    config,
    baseUrl,
    { grant_type: "refresh_token", refresh_token: refreshToken, redirect_uri: config.redirectUri },
    fetchImpl,
    now
  )
  // Keep the current refresh token unless Learn issues a new one.
  return { ...tokens, refreshToken: tokens.refreshToken ?? refreshToken }
}
