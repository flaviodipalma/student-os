"use server"

import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import type { LmsSyncResult } from "@/lib/lms/types"
import { lmsProviderIds, type Course, type Task } from "@/lib/types"
import { parse, runAction } from "@/server/actions"
import { getCurrentUser } from "@/server/auth"
import { canvasAllowedHosts, canvasConfig, parseCanvasBaseUrl } from "@/server/integrations/lms/canvas/config"
import { canvasFeedToLms, fetchCanvasFeed, parseCanvasFeedUrl } from "@/server/integrations/lms/canvas/feed"
import { syncCanvasFeed } from "@/server/integrations/lms/canvas/feed-sync"
import {
  disconnectLms,
  getLmsConnectionMethod,
  loadLmsCredentials,
  saveLmsFeedConnection,
} from "@/server/integrations/lms/connections"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { createOAuthState, OAUTH_STATE_MAX_AGE_SECONDS, oauthStateCookieName } from "@/server/integrations/lms/oauth-state"
import { LmsError } from "@/server/integrations/lms/provider"
import { getLmsProvider } from "@/server/integrations/lms/registry"
import { syncLms } from "@/server/integrations/lms/sync"
import { listCourses } from "@/server/services/courses"
import { listTasks } from "@/server/services/tasks"
import { getStudentTimeZone } from "@/server/student-clock"

// Server actions for LMS integrations (Settings > Integrations). The student is
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

export type ConnectCanvasState = { error: string | null }

// Starts "Connect Canvas": checks the school's Canvas address, remembers a
// single-use OAuth state in an HttpOnly cookie, and sends the student to Canvas.
export async function connectCanvasAction(_previous: ConnectCanvasState, form: FormData): Promise<ConnectCanvasState> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  const provider = getLmsProvider("canvas")
  const config = canvasConfig()
  if (!config) return { error: "Canvas isn't set up on this server yet." }

  let authorizationUrl: string
  try {
    const baseUrl = parseCanvasBaseUrl(String(form.get("canvasUrl") ?? ""), config.allowedHosts)
    const { state, cookieValue } = createOAuthState({ provider: "canvas", userId: user.id, baseUrl }, vault())
    ;(await cookies()).set(oauthStateCookieName("canvas"), cookieValue, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/api/integrations/canvas",
      maxAge: OAUTH_STATE_MAX_AGE_SECONDS,
    })
    authorizationUrl = provider.getAuthorizationUrl({ baseUrl, state })
  } catch (error) {
    if (error instanceof LmsError) return { error: error.message }
    console.error("[canvas] couldn't start connecting", { name: error instanceof Error ? error.name : typeof error })
    return { error: "We couldn't start connecting to Canvas. Please try again." }
  }
  // Outside the try: redirect() works by throwing.
  redirect(authorizationUrl)
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

export type LmsSyncOutcome = {
  result: LmsSyncResult
  // The student's courses and tasks after the sync, so the app shows them at once.
  courses: Course[]
  tasks: Task[]
}

export async function syncLmsAction(provider: unknown): Promise<ActionResult<LmsSyncOutcome>> {
  return runAction(async ({ db, userId }) => {
    const id = parse(providerSchema, provider)
    const options = { timeZone: await getStudentTimeZone() }
    // The student's own connection decides how to read: calendar feed or OAuth.
    const method = await getLmsConnectionMethod(db, userId, id)
    const result =
      id === "canvas" && method === "calendar_feed"
        ? await syncCanvasFeed(db, userId, vault(), options)
        : await syncLms(db, userId, getLmsProvider(id), vault(), options)
    const [courses, tasks] = await Promise.all([listCourses(db, userId), listTasks(db, userId)])
    return { result, courses, tasks }
  })
}

// Disconnects: asks the LMS to revoke the token (best effort), then deletes the
// connection and its tokens. Imported courses and tasks stay.
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
    return null
  })
}
