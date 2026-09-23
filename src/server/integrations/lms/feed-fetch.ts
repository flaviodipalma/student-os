import "server-only"

import { looksLikeIcs } from "./ical"
import { LmsError } from "./provider"

// Downloads a student's private LMS calendar feed (Canvas Calendar Feed,
// Blackboard "Share Calendar" link). The link works like a password, so it's
// only ever fetched here, by the server: size- and time-limited, redirects not
// followed, and never logged.

export type Fetch = typeof fetch

const MAX_BYTES = 5 * 1024 * 1024
const TIMEOUT_MS = 15_000

export type FeedMessages = {
  // e.g. "Canvas is temporarily unavailable. Please try again."
  unavailable: string
  // The link was rejected (revoked or mistyped): the student needs a new one.
  linkBroken: string
  unreadable: string
  tooLarge: string
  notACalendar: string
}

export async function fetchIcsFeed(feedUrl: string, messages: FeedMessages, fetchImpl: Fetch = fetch): Promise<string> {
  let response: Response
  try {
    response = await fetchImpl(feedUrl, {
      headers: { Accept: "text/calendar" },
      redirect: "error",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
  } catch {
    throw new LmsError(messages.unavailable)
  }
  if (response.status === 404 || response.status === 401 || response.status === 403) {
    throw new LmsError(messages.linkBroken, "connection", true)
  }
  if (!response.ok) throw new LmsError(messages.unavailable)

  // Read at most MAX_BYTES.
  const reader = response.body?.getReader()
  if (!reader) throw new LmsError(messages.unreadable)
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_BYTES) {
      await reader.cancel()
      throw new LmsError(messages.tooLarge)
    }
    chunks.push(value)
  }
  const text = new TextDecoder().decode(Buffer.concat(chunks))
  if (!looksLikeIcs(text)) throw new LmsError(messages.notACalendar)
  return text
}
