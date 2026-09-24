import "server-only"

import { NextResponse, type NextRequest } from "next/server"
import type { CalendarProviderId } from "@/lib/types"
import { getCurrentUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { getCredentialVault } from "../lms/credential-vault"
import { oauthCookiePath, oauthStateCookieName, verifyOAuthState } from "../lms/oauth-state"
import { createCalendarAccess, saveCalendarConnection } from "./connections"
import { CalendarProviderError } from "./provider"
import { getCalendarProvider } from "./registry"
import { syncCalendarConnection } from "./sync-connection"

// GET /api/integrations/<google|outlook>-calendar/callback: where Google or
// Microsoft sends the student back after they approve (or cancel) calendar
// access. Same checks as the LMS callback:
//   1. signed in (the same student who started)
//   2. the OAuth state matches the single-use cookie (CSRF), with its PKCE verifier
//   3. the code is exchanged on the server; tokens stored encrypted
//   4. a first sync, so the events show straight away (a failure there is
//      shown on the connection, not as a failed connection)
// The student lands on Settings with a short outcome code, never a token.

export async function handleCalendarCallback(request: NextRequest, providerId: CalendarProviderId): Promise<NextResponse> {
  const provider = getCalendarProvider(providerId)
  const cookie = oauthStateCookieName(provider.flow)
  const backToSettings = (outcome: string) => {
    const response = NextResponse.redirect(new URL(`/settings?${provider.flow}=${outcome}#integrations`, request.url))
    response.cookies.set(cookie, "", { path: oauthCookiePath(provider.flow), maxAge: 0 })
    return response
  }

  const user = await getCurrentUser()
  if (!user) return NextResponse.redirect(new URL("/login", request.url))

  const params = request.nextUrl.searchParams
  const error = params.get("error")
  if (error) return backToSettings(error === "access_denied" || error === "consent_required" ? "denied" : "error")

  let vault
  try {
    vault = getCredentialVault()
  } catch {
    return backToSettings("not_configured")
  }
  const verified = verifyOAuthState(
    { provider: provider.flow, userId: user.id, state: params.get("state"), cookieValue: request.cookies.get(cookie)?.value },
    vault
  )
  if (!verified) return backToSettings("invalid_state")
  const code = params.get("code")
  if (!code) return backToSettings("error")

  const db = getDb()
  try {
    const tokens = await provider.exchangeCode({ code, codeVerifier: verified.codeVerifier })
    // Whose calendar it is, with the new token (before anything is saved).
    const account = await provider.getAccount({ getAccessToken: async () => tokens.accessToken, refreshAccessToken: async () => {
      throw new CalendarProviderError("reconnect", provider.name)
    } })
    await saveCalendarConnection(db, user.id, provider.id, tokens, account, vault)
    // Proves the stored tokens decrypt for this student.
    await createCalendarAccess(db, user.id, provider, vault)
  } catch (error) {
    console.error(`[calendar:${provider.id}] connecting failed`, { name: error instanceof Error ? error.name : typeof error })
    if (error instanceof CalendarProviderError && error.kind === "permission") return backToSettings("permission")
    if (error instanceof CalendarProviderError && error.kind === "not-configured") return backToSettings("not_configured")
    return backToSettings("error")
  }
  await syncCalendarConnection(db, user.id, provider, vault).catch(() => {})
  return backToSettings("connected")
}
