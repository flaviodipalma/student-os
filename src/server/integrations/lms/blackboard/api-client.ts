import "server-only"

import { LmsError, type LmsAccess } from "../provider"
import type { Fetch } from "./oauth"

// A small, read-only client for the Blackboard Learn REST API (/learn/api/public).
//
// - Authorization: Bearer <token> header (never a query parameter)
// - Pagination: Learn returns { results, paging: { nextPage } }, where nextPage is
//   a path on the same server; it's followed only while it stays on the student's
//   own Learn address, up to a page limit
// - 401: refresh the token once through LmsAccess and retry
// - 429 (rate limit), timeouts, outages and unreadable responses become safe LmsErrors
// - Redirects aren't followed, so the token only ever goes to the Learn address

export type BlackboardClientOptions = {
  fetch?: Fetch
  timeoutMs?: number
  // Stops after this many pages (100 items each).
  maxPages?: number
}

type Scope = "course" | "connection"

const LIMIT = "100"
const API_PREFIX = "/learn/api/public/"

export class BlackboardApiClient {
  private readonly fetchImpl: Fetch
  private readonly timeoutMs: number
  private readonly maxPages: number

  constructor(
    private readonly access: LmsAccess,
    options: BlackboardClientOptions = {}
  ) {
    this.fetchImpl = options.fetch ?? fetch
    this.timeoutMs = options.timeoutMs ?? 15_000
    this.maxPages = options.maxPages ?? 50
  }

  // Every item of a paginated list. `path` starts after /learn/api/public/ (e.g. "v1/users/_1_1/courses").
  async getAll(path: string, params: [string, string][] = [], scope: Scope = "connection"): Promise<unknown[]> {
    const first = this.url(path, params)
    first.searchParams.set("limit", LIMIT)

    const items: unknown[] = []
    let url: string | null = first.toString()
    for (let page = 0; url && page < this.maxPages; page++) {
      const body = (await this.request(url, scope)) as { results?: unknown; paging?: { nextPage?: unknown } } | undefined
      if (!body || !Array.isArray(body.results)) throw new LmsError("Blackboard sent a response Student OS couldn't read.", scope)
      items.push(...body.results)
      url = this.nextPage(body.paging?.nextPage)
    }
    return items
  }

  async getOne(path: string, params: [string, string][] = [], scope: Scope = "connection"): Promise<unknown> {
    const body = await this.request(this.url(path, params).toString(), scope)
    if (!body || typeof body !== "object") throw new LmsError("Blackboard sent a response Student OS couldn't read.", scope)
    return body
  }

  private url(path: string, params: [string, string][]): URL {
    const url = new URL(`${API_PREFIX}${path}`, this.access.baseUrl)
    for (const [key, value] of params) url.searchParams.append(key, value)
    return url
  }

  // The next page, only on the student's own Learn and inside the public API.
  private nextPage(next: unknown): string | null {
    if (typeof next !== "string" || !next) return null
    try {
      const url = new URL(next, this.access.baseUrl)
      return url.origin === this.access.baseUrl && url.pathname.startsWith(API_PREFIX) ? url.toString() : null
    } catch {
      return null
    }
  }

  private async request(url: string, scope: Scope, retried = false): Promise<unknown> {
    const token = retried ? await this.access.refreshAccessToken() : await this.access.getAccessToken()
    let response: Response
    try {
      response = await this.fetchImpl(url, {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        redirect: "error",
        signal: AbortSignal.timeout(this.timeoutMs),
      })
    } catch {
      throw new LmsError("Blackboard is temporarily unavailable. Please try again.")
    }
    if (response.ok) return response.json().catch(() => undefined)

    if (response.status === 401) {
      // An expired token: refresh once and try again. A second 401 means reconnect.
      if (!retried) return this.request(url, scope, true)
      throw new LmsError("Your Blackboard connection expired. Please reconnect.", "connection", true)
    }
    if (response.status === 429) throw new LmsError("Blackboard is busy right now. Please try again in a few minutes.")
    if (response.status === 403) {
      throw new LmsError(
        scope === "course"
          ? "Blackboard didn't allow Student OS to read this course."
          : "Blackboard didn't allow Student OS to read your courses. Try reconnecting.",
        scope
      )
    }
    if (response.status === 404) {
      throw new LmsError(
        scope === "course" ? "This course wasn't found in Blackboard." : "Blackboard wasn't found at that address.",
        scope
      )
    }
    throw new LmsError("Blackboard is temporarily unavailable. Please try again.")
  }
}
