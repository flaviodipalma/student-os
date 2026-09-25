"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import type { LmsSyncResult } from "@/lib/lms/types"
import { lmsProviderIds, type Course, type ExternalEventRecord, type LmsProviderId, type Task } from "@/lib/types"
import { limitRate, parse, runAction } from "@/server/actions"
import { getCurrentUser } from "@/server/auth"
import { blackboardAllowedHosts, parseBlackboardBaseUrl } from "@/server/integrations/lms/blackboard/config"
import { fetchBlackboardFeed, parseBlackboardFeedUrl } from "@/server/integrations/lms/blackboard/feed"
import { syncBlackboardFeed } from "@/server/integrations/lms/blackboard/feed-sync"
import { canvasAllowedHosts, parseCanvasBaseUrl } from "@/server/integrations/lms/canvas/config"
import { canvasFeedToLms, fetchCanvasFeed, parseCanvasFeedUrl } from "@/server/integrations/lms/canvas/feed"
import { syncCanvasFeed } from "@/server/integrations/lms/canvas/feed-sync"
import {
  disconnectLms,
  getLmsConnectionMethod,
  loadLmsCredentials,
  saveLmsFeedConnection,
} from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import {
  createOAuthState,
  OAUTH_STATE_MAX_AGE_SECONDS,
  oauthCookiePath,
  oauthStateCookieName,
} from "@/server/integrations/lms/oauth-state"
import { LmsError } from "@/server/integrations/lms/provider"
import { getLmsProvider } from "@/server/integrations/lms/registry"
import { syncLms } from "@/server/integrations/lms/sync"
import { listCourses } from "@/server/services/courses"
import { listExternalEvents, removeExternalEventsFrom, setExternalEventHidden } from "@/server/services/external-events"
import { listTasks } from "@/server/services/tasks"
import { RATE_LIMITS } from "@/server/rate-limit"
import { getStudentTimeZone } from "@/server/student-clock"
import { logger } from "@/server/log"

// Server actions for LMS integrations (the Integrations page). The student is
// always the signed-in user from the session; no user id or token is ever
// accepted from, or returned to, the browser.

const providerSchema = z.enum(lmsProviderIds)

// The encryption key is required for anything involving tokens.
function vault() {
  try {
    return getCredentialVault()
  } catch {
    throw new LmsError("Integrations aren't set up on this server yet.")
  }
}

export type ConnectLmsState = { error: string | null }
export type ConnectCanvasState = ConnectLmsState

// Starts signing in with an LMS: checks the school's address, remembers a
// single-use OAuth state (and PKCE verifier) in an HttpOnly cookie scoped to
// the callback, and sends the student to the LMS.
async function startOAuth(provider: LmsProviderId, parseBaseUrl: () => string): Promise<ConnectLmsState> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  const lms = getLmsProvider(provider)
  if (!lms.isConfigured()) return { error: `${lms.name} isn't set up on this server yet.` }

  let authorizationUrl: string
  try {
    const baseUrl = parseBaseUrl()
    const { state, codeVerifier, cookieValue } = createOAuthState({ provider, userId: user.id, baseUrl }, vault())
    ;(await cookies()).set(oauthStateCookieName(provider), cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: oauthCookiePath(provider),
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    })
    authorizationUrl = lms.getAuthorizationUrl({ baseUrl, state, codeVerifier })
  } catch (error) {
    if (error instanceof LmsError) return { error: error.message }
    logger.error(`${provider}`, `couldn't start connecting`, { name: error instanceof Error ? error.name : typeof error })
    return { error: `We couldn't start connecting to ${lms.name}. Please try again.` }
  }
  // Outside the try: redirect() works by throwing.
  redirect(authorizationUrl)
}

// "Connect Canvas" (sign in with Canvas, where the school has a developer key).
export async function connectCanvasAction(_previous: ConnectLmsState, form: FormData): Promise<ConnectLmsState> {
  return startOAuth("canvas", () => parseCanvasBaseUrl(String(form.get("canvasUrl") ?? ""), canvasAllowedHosts()))
}

// "Connect Blackboard" (Blackboard Learn three-legged OAuth, where the school has approved Student OS).
export async function connectBlackboardAction(_previous: ConnectLmsState, form: FormData): Promise<ConnectLmsState> {
  return startOAuth("blackboard", () =>
    parseBlackboardBaseUrl(String(form.get("blackboardUrl") ?? ""), blackboardAllowedHosts())
  )
}

export type ConnectCanvasFeedState = { error: string | null; connected: boolean }

// Connects Canvas through the student's private Calendar Feed link: no
// developer key needed. The link is checked (a Canvas feed on an allowed host),
// downloaded once to make sure it works, and stored encrypted. It's never sent
// back to the browser.
export async function connectCanvasFeedAction(
  _previous: ConnectCanvasFeedState,
  form: FormData
): Promise<ConnectCanvasFeedState> {
  const result = await runAction(async ({ db, userId }) => {
    const feed = parseCanvasFeedUrl(String(form.get("feedUrl") ?? ""), canvasAllowedHosts())
    const text = await fetchCanvasFeed(feed.feedUrl)
    canvasFeedToLms(text, { baseUrl: feed.baseUrl, timeZone: await getStudentTimeZone() })
    await saveLmsFeedConnection(db, userId, "canvas", feed, vault())
    return null
  })
  return result.ok ? { error: null, connected: true } : { error: result.error, connected: false }
}

export type ConnectBlackboardFeedState = ConnectCanvasFeedState

// Connects Blackboard through the student's private calendar link (Share
// Calendar): no administrator approval needed. Checked (a Blackboard calendar
// link on an allowed host), downloaded once to make sure it works, and stored
// encrypted. It's never sent back to the browser.
export async function connectBlackboardFeedAction(
  _previous: ConnectBlackboardFeedState,
  form: FormData
): Promise<ConnectBlackboardFeedState> {
  const result = await runAction(async ({ db, userId }) => {
    const feed = parseBlackboardFeedUrl(String(form.get("feedUrl") ?? ""), blackboardAllowedHosts())
    await fetchBlackboardFeed(feed.feedUrl)
    await saveLmsFeedConnection(db, userId, "blackboard", feed, vault())
    return null
  })
  return result.ok ? { error: null, connected: true } : { error: result.error, connected: false }
}

export type LmsSyncOutcome = {
  result: LmsSyncResult
  // The student's courses, tasks and external calendar events after the sync,
  // so the app shows them at once.
  courses: Course[]
  tasks: Task[]
  externalEvents: ExternalEventRecord[]
}

export async function syncLmsAction(provider: unknown): Promise<ActionResult<LmsSyncOutcome>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    limitRate(userId, "sync", RATE_LIMITS.sync)
    const options = { timeZone: await getStudentTimeZone() }
    // The student's own connection decides how to read: calendar feed or OAuth.
    const method = await getLmsConnectionMethod(db, userId, id)
    const result =
      method === "calendar_feed"
        ? id === "canvas"
          ? await syncCanvasFeed(db, userId, vault(), options)
          : await syncBlackboardFeed(db, userId, vault(), options)
        : await syncLms(db, userId, getLmsProvider(id), vault(), options)
    const [courses, tasks, externalEvents] = await Promise.all([
      listCourses(db, userId),
      listTasks(db, userId),
      listExternalEvents(db, userId),
    ])
    return { result, courses, tasks, externalEvents }
  })
}

// Disconnects: asks the LMS to revoke the token (best effort), then deletes the
// connection and its tokens. Imported courses and tasks stay; the LMS's calendar
// events stop showing (kept, and back if the calendar is connected again).
export async function disconnectLmsAction(provider: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    const lms = getLmsProvider(id)
    try {
      const credentials = await loadLmsCredentials(db, userId, id, vault())
      if (credentials.baseUrl) await lms.revokeTokens({ baseUrl: credentials.baseUrl, accessToken: credentials.accessToken })
    } catch {
      // Revoking is a courtesy; the tokens are deleted below regardless.
    }
    await disconnectLms(db, userId, id)
    await removeExternalEventsFrom(db, userId, id)
    return null
  })
}

// "Hide from Student OS" / "Restore" for an external calendar event: a local
// flag on the student's own copy. Nothing is sent to Canvas or Blackboard.
const eventIdSchema = z.string().uuid()

export async function setExternalEventHiddenAction(id: unknown, hidden: unknown): Promise<ActionResult<ExternalEventRecord>> {
  return runAction(async ({ db, userId }) => setExternalEventHidden(db, userId, parse(eventIdSchema, id), parse(z.boolean(), hidden)))
}
