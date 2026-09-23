import "server-only"

import { LmsError, type LmsAccess } from "../provider"
import type { Fetch } from "./oauth"

// A small, read-only client for the Canvas REST API (/api/v1).
//
// - Authorization: Bearer <token> header (never a query parameter)
// - Pagination: follows the Link header's rel="next" URL (treated as opaque),
//   only while it stays on the student's own Canvas address, up to a page limit
// - 401: refresh the token once through LmsAccess and retry
// - Rate limiting (429, or Canvas's "403 Forbidden (Rate Limit Exceeded)"),
//   timeouts, outages and unreadable responses become safe LmsErrors
// - Redirects aren't followed, so the token only ever goes to the Canvas address

export type CanvasClientOptions = {
  fetch?: Fetch
  timeoutMs?: number
  // Stops after this many pages (100 items each).
  maxPages?: number
}

const PER_PAGE = "100"

// The rel="next" URL from a Link header, if any.
export function nextPageUrl(linkHeader: string | null): string | null {
  if (!linkHeader) return null
  for (const part of linkHeader.split(",")) {
    const match = part.match(/<([^>]+)>\s*;\s*rel="?([^";]+)"?/i)
    if (match && match[2].trim().toLowerCase() === "next") return match[1]
  }
  return null
}

export class CanvasApiClient {
  private readonly fetchImpl: Fetch
  private readonly timeoutMs: number
  private readonly maxPages: number

  constructor(
    private readonly access: LmsAccess,
    options: CanvasClientOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxPages = options.maxPages ?? 50
  }

  // Every item of a paginated list. `scope` says whether a 403/404 means the
  // whole connection is unusable or just this one course.
  async getAll(path: string, params: [string, string][] = [], scope: "course" | "connection" = "connection"): Promise<unknown[]> {
    const first = new URL(`/api/v1${path}`, this.access.baseUrl)
    for (const [key, value] of params) first.searchParams.append(key, value)
    first.searchParams.set("per_page", PER_PAGE)

    const items: unknown[] = []
    let url: string | null = first.toString()
    for (let page = 0; url && page < this.maxPages; page++) {
      const response = await this.request(url, scope)
      const body = await response.json().catch(() => undefined)
      if (!Array.isArray(body)) throw new LmsError("Canvas sent a response Student OS couldn't read.", scope)
      items.push(...body)
      const next = nextPageUrl(response.headers.get("link"))
      // The token must never be sent anywhere but the student's Canvas.
      url = next && new URL(next).origin === this.access.baseUrl ? next : null
    }
    return items
  }

  async getOne(path: string, params: [string, string][] = [], scope: "course" | "connection" = "connection"): Promise<unknown> {
    const url = new URL(`/api/v1${path}`, this.access.baseUrl)
    for (const [key, value] of params) url.searchParams.append(key, value)
    const response = await this.request(url.toString(), scope)
    const body = await response.json().catch(() => undefined)
    if (!body || typeof body !== "object") throw new LmsError("Canvas sent a response Student OS couldn't read.", scope)
    return body
  }

  private async request(url: string, scope: "course" | "connection", retried = false): Promise<Response> {
    const token = retried ? await this.access.refreshAccessToken() : await this.access.getAccessToken()
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new LmsError("Canvas is temporarily unavailable. Please try again.")
    }
    if (response.ok) return response

    if (response.status === 401) {
      // An expired token: refresh once and try again. A second 401 means reconnect.
      if (!retried) return this.request(url, scope, true)
      throw new LmsError("Your Canvas connection expired. Please reconnect.", "connection", true)
    }
    const text = await response.text().catch(() => "")
    if (response.status === 429 || (response.status === 403 && /rate limit exceeded/i.test(text))) {
      throw new LmsError("Canvas is busy right now. Please try again in a few minutes.")
    }
    if (response.status === 403) {
      throw new LmsError(
        scope === "course"
          ? "Canvas didn't allow Student OS to read this course."
          : "Canvas didn't allow Student OS to read your courses. Try reconnecting.",
        scope
      )
    }
    if (response.status === 404) {
      throw new LmsError(scope === "course" ? "This course wasn't found in Canvas." : "Canvas wasn't found at that address.", scope)
    }
    throw new LmsError("Canvas is temporarily unavailable. Please try again.")
  }
}
