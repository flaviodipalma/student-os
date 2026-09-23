import { createHash } from "node:crypto"

// A fake Blackboard Learn server for tests. It serves TEST FIXTURES: hand-written
// responses shaped after the Learn REST API spec (OAuth2 token, Users, Course
// Memberships, Gradebook Columns / Grades / Attempts). They are not real
// Blackboard data and no real Blackboard is ever contacted.

export const BLACKBOARD_BASE = "https://school.blackboard.com"
export const BLACKBOARD_TEST_APP = { clientId: "test-bb-key", clientSecret: "test-bb-secret" }
// The student, as the token names them (UUID) and as the REST API does (primary id).
export const BLACKBOARD_USER_UUID = "9a8b7c6d5e4f40a1b2c3d4e5f6a7b8c9"
export const BLACKBOARD_USER_ID = "_42_1"

type Recorded = { method: string; url: URL; headers: Headers; body: string }

export type FakeBlackboardFixture = {
  memberships?: unknown[]
  // Per course id: its grade columns, or an HTTP status to answer with.
  columns?: Record<string, unknown[] | number>
  // Per course id: the student's grades, or an HTTP status.
  grades?: Record<string, unknown[] | number>
  // Per column id: the student's attempts, or an HTTP status.
  attempts?: Record<string, unknown[] | number>
  pageSize?: number
  validTokens?: string[]
  // False: Learn answers the token endpoint with 401 (the school hasn't approved the app).
  approved?: boolean
  // The PKCE verifier the authorization code was issued for.
  codeVerifier?: string
}

export function fakeBlackboard(fixture: FakeBlackboardFixture = {}) {
  const requests: Recorded[] = []
  const state = {
    memberships: fixture.memberships ?? [],
    columns: fixture.columns ?? {},
    grades: fixture.grades ?? {},
    attempts: fixture.attempts ?? {},
    validTokens: new Set(fixture.validTokens ?? ["bb-access-1"]),
    approved: fixture.approved ?? true,
    issued: 1,
  }
  const pageSize = fixture.pageSize ?? 100
  const challenge = fixture.codeVerifier
    ? createHash("sha256").update(fixture.codeVerifier).digest("base64url")
    : null
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  const error = (status: number) => json({ status, message: "Fixture error" }, status)

  // Learn's paging: { results, paging: { nextPage: "/learn/api/public/...?offset=N" } }.
  function page(url: URL, items: unknown[]) {
    const offset = Number(url.searchParams.get("offset") ?? "0")
    const limit = Math.min(Number(url.searchParams.get("limit") ?? pageSize), pageSize)
    const body: { results: unknown[]; paging?: { nextPage: string } } = { results: items.slice(offset, offset + limit) }
    if (offset + limit < items.length) {
      const next = new URL(url)
      next.searchParams.set("offset", String(offset + limit))
      body.paging = { nextPage: next.pathname + next.search }
    }
    return json(body)
  }
  const listOr = (value: unknown[] | number | undefined, url: URL) =>
    typeof value === "number" ? error(value) : page(url, value ?? [])

  const fetchImpl = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input))
    const headers = new Headers(init.headers)
    const body = init.body ? String(init.body) : ""
    requests.push({ method: init.method ?? "GET", url, headers, body })
    if (url.origin !== BLACKBOARD_BASE) throw new TypeError("fetch failed")
    const path = url.pathname.replace(/^\/learn\/api\/public\//, "")

    if (path === "v1/oauth2/token" && init.method === "POST") {
      const basic = Buffer.from(`${BLACKBOARD_TEST_APP.clientId}:${BLACKBOARD_TEST_APP.clientSecret}`).toString("base64")
      if (!state.approved || headers.get("authorization") !== `Basic ${basic}`) {
        return json({ error: "invalid_client", error_description: "Invalid client credentials, or no access granted to this Learn server." }, 401)
      }
      const params = url.searchParams
      const grant = params.get("grant_type") ?? new URLSearchParams(body).get("grant_type")
      if (grant === "authorization_code" && params.get("code") === "good-code") {
        const verifier = params.get("code_verifier")
        if (challenge && (!verifier || createHash("sha256").update(verifier).digest("base64url") !== challenge)) {
          return json({ error: "invalid_grant" }, 400)
        }
        return json({
          access_token: "bb-access-1",
          token_type: "bearer",
          expires_in: 3599,
          refresh_token: "bb-refresh",
          scope: "read offline",
          user_id: BLACKBOARD_USER_UUID,
        })
      }
      if (grant === "refresh_token" && params.get("refresh_token") === "bb-refresh") {
        const token = `bb-access-${++state.issued}`
        state.validTokens.add(token)
        return json({ access_token: token, token_type: "bearer", expires_in: 3599, scope: "read offline", user_id: BLACKBOARD_USER_UUID })
      }
      return json({ error: "invalid_grant" }, 400)
    }

    const token = headers.get("authorization")?.replace(/^Bearer /, "")
    if (!token || !state.validTokens.has(token)) return json({ status: 401, message: "Bearer token is invalid" }, 401)

    if (path === `v1/users/uuid:${BLACKBOARD_USER_UUID}`) return json({ id: BLACKBOARD_USER_ID })
    if (path === `v1/users/${BLACKBOARD_USER_ID}/courses`) return page(url, state.memberships)
    let match = path.match(/^v2\/courses\/([^/]+)\/gradebook\/columns$/)
    if (match) return listOr(state.columns[decodeURIComponent(match[1])], url)
    match = path.match(/^v2\/courses\/([^/]+)\/gradebook\/users\/([^/]+)$/)
    if (match) return match[2] === BLACKBOARD_USER_ID ? listOr(state.grades[decodeURIComponent(match[1])], url) : error(403)
    match = path.match(/^v2\/courses\/([^/]+)\/gradebook\/columns\/([^/]+)\/attempts$/)
    if (match) {
      if (url.searchParams.get("userId") !== BLACKBOARD_USER_ID) return error(403)
      return listOr(state.attempts[decodeURIComponent(match[2])], url)
    }
    match = path.match(/^v3\/courses\/([^/]+)$/)
    if (match) return json({ externalAccessUrl: `${BLACKBOARD_BASE}/ultra/courses/${match[1]}/outline` })
    return error(404)
  }) as typeof fetch

  return { fetch: fetchImpl, requests, state }
}

// A course membership (GET v1/users/{id}/courses?expand=course).
export const bbMembership = (id: string, overrides: Record<string, unknown> = {}, course: Record<string, unknown> = {}) => ({
  id: `_m${id}`,
  userId: BLACKBOARD_USER_ID,
  courseId: id,
  courseRoleId: "Student",
  availability: { available: "Yes" },
  course: {
    id,
    courseId: `BIO-${id.replace(/\D/g, "")}`,
    name: `Course ${id}`,
    description: "<p>Intro course</p>",
    organization: false,
    availability: { available: "Yes" },
    externalAccessUrl: `${BLACKBOARD_BASE}/ultra/courses/${id}/outline`,
    ...course,
  },
  ...overrides,
})

// A grade column (GET v2/courses/{id}/gradebook/columns).
export const bbColumn = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Assignment ${id}`,
  description: "<p>Read <b>chapter 3</b> &amp; answer</p>",
  externalGrade: false,
  contentId: `_c${id}`,
  scoreProviderHandle: "resource/x-bb-assignment",
  availability: { available: "Yes" },
  grading: { type: "Attempts", due: "2026-09-26T03:59:00.000Z" }, // Friday 11:59 PM in New York
  ...overrides,
})
