"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { calendarProviderIds, calendarProviderNames, type ExternalEventRecord } from "@/lib/types"
import { limitRate, parse, runAction } from "@/server/actions"
import { getCurrentUser } from "@/server/auth"
import type { CalendarSyncResult } from "@/server/integrations/calendar/calendar-sync"
import {
  deleteCalendarConnection,
  getCalendarIntegrationStatus,
  loadCalendarCredentials,
  type CalendarIntegrationStatus,
} from "@/server/integrations/calendar/connections"
import { CalendarProviderError } from "@/server/integrations/calendar/provider"
import { getCalendarProvider } from "@/server/integrations/calendar/registry"
import { syncCalendarConnection } from "@/server/integrations/calendar/sync-connection"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import {
  createOAuthState,
  OAUTH_STATE_MAX_AGE_SECONDS,
  oauthCookiePath,
  oauthStateCookieName,
  pkceChallenge,
} from "@/server/integrations/lms/oauth-state"
import { RATE_LIMITS } from "@/server/rate-limit"
import { deleteExternalEventsFrom, listExternalEvents } from "@/server/services/external-events"

// Integrations > Calendars: connect, sync and disconnect Google
// Calendar and Outlook. Separate from login: these ask Google / Microsoft for
// read-only calendar access, for the signed-in student only. No user id or token
// is ever accepted from, or returned to, the browser.

const providerSchema = z.enum(calendarProviderIds)

function vault() {
  try {
    return getCredentialVault()
  } catch {
    throw new CalendarProviderError("not-configured", "Calendar connections")
  }
}

export type ConnectCalendarState = { error: string | null }

// Sends the student to Google / Microsoft to approve read-only calendar access,
// with a single-use state (and PKCE verifier) in an HttpOnly cookie scoped to the callback.
export async function connectCalendarAction(_previous: ConnectCalendarState, form: FormData): Promise<ConnectCalendarState> {
  const parsed = providerSchema.safeParse(form.get("provider"))
  if (!parsed.success) return { error: "Choose a calendar to connect." }
  const user = await getCurrentUser()
  if (!user) redirect("/login?next=/integrations")
  const provider = getCalendarProvider(parsed.data)

  let url: string
  try {
    if (!provider.isConfigured()) throw new CalendarProviderError("not-configured", provider.name)
    const { state, codeVerifier, cookieValue } = createOAuthState({ provider: provider.flow, userId: user.id, baseUrl: "" }, vault())
    ;(await cookies()).set(oauthStateCookieName(provider.flow), cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: oauthCookiePath(provider.flow),
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    })
    url = provider.authorizationUrl({ state, codeChallenge: pkceChallenge(codeVerifier) })
  } catch (error) {
    return { error: error instanceof CalendarProviderError ? error.message : `We couldn't start connecting ${provider.name}. Please try again.` }
  }
  redirect(url)
}

export type CalendarSyncOutcome = {
  result: CalendarSyncResult
  // The student's external events after the sync (for the app store), and the connection's new state.
  externalEvents: ExternalEventRecord[]
  status: CalendarIntegrationStatus[]
}

export async function syncCalendarAction(provider: unknown): Promise<ActionResult<CalendarSyncOutcome>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    limitRate(userId, "sync", RATE_LIMITS.sync)
    const keys = vault()
    const result = await syncCalendarConnection(db, userId, getCalendarProvider(id), keys)
    const [externalEvents, status] = await Promise.all([listExternalEvents(db, userId), getCalendarIntegrationStatus(db, userId, true)])
    return { result, externalEvents, status }
  })
}

// Revokes the access at Google (best effort; Microsoft has no revocation
// endpoint), deletes the tokens and this calendar's copied events. Only
// this calendar: Student OS events, Canvas / Blackboard, tasks, courses and
// study sessions are untouched.
export async function disconnectCalendarAction(provider: unknown): Promise<ActionResult<{ externalEvents: ExternalEventRecord[] }>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    const calendar = getCalendarProvider(id)
    try {
      const credentials = await loadCalendarCredentials(db, userId, id, vault())
      await calendar.revoke(credentials)
    } catch {
      // Revoking is a courtesy; the tokens are deleted below regardless.
    }
    if (!(await deleteCalendarConnection(db, userId, id))) {
      throw new CalendarProviderError("failed", calendarProviderNames[id])
    }
    await deleteExternalEventsFrom(db, userId, id)
    return { externalEvents: await listExternalEvents(db, userId) }
  })
}
