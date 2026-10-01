// Which school system (LMS) is this tab, and is the student logged in to it? Runs
// inside the tab when the popup opens (chrome.scripting.executeScript, so it must be
// self-contained), with the student's own session, like each LMS's own pages. It only
// asks the questions the readers ask first, and reads no course data:
//   Canvas       GET /api/v1/users/self            200 (logged in) or 401 with Canvas's JSON
//   Blackboard   GET /learn/api/public/v1/users/me 200 with a Learn id, or 401 with Learn's JSON
//   Brightspace  GET /d2l/api/versions/ (public), then lp/{v}/users/whoami
// origin and fetchFn exist for tests.

export type LmsKind = "canvas" | "blackboard" | "brightspace"
// loggedIn null: it's this LMS, but whether the student is logged in couldn't be told
// (e.g. a Brightspace that only accepts tokens); Sync finds out.
export type Detected = { lms: LmsKind; loggedIn: boolean | null } | { lms: null }

export async function identifyLms(origin: string = location.origin, fetchFn: typeof fetch = fetch): Promise<Detected> {
  const record = (value: unknown): Record<string, unknown> =>
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}

  // Status and JSON body (Canvas may prefix its JSON with "while(1);"); null if unreachable.
  async function ask(path: string): Promise<{ status: number; body: unknown } | null> {
    try {
      const response = await fetchFn(`${origin}${path}`, { credentials: "same-origin", headers: { Accept: "application/json" } })
      const text = await response.text()
      let body: unknown = null
      try {
        body = JSON.parse(text.replace(/^while\(1\);/, ""))
      } catch {
        // Not JSON: an HTML page, so not this API.
      }
      return { status: response.status, body }
    } catch {
      return null
    }
  }

  const canvas = async (): Promise<Detected | null> => {
    const answer = await ask("/api/v1/users/self")
    if (answer?.status === 200 && record(answer.body).id !== undefined) return { lms: "canvas", loggedIn: true }
    // Canvas's own answer when logged out: { status: "unauthenticated", errors: [...] }.
    if (answer?.status === 401 && (record(answer.body).status === "unauthenticated" || Array.isArray(record(answer.body).errors))) {
      return { lms: "canvas", loggedIn: false }
    }
    return null
  }

  const blackboard = async (): Promise<Detected | null> => {
    const answer = await ask("/learn/api/public/v1/users/me?fields=id")
    if (answer?.status === 200 && /^_\d+_\d+$/.test(String(record(answer.body).id))) return { lms: "blackboard", loggedIn: true }
    // Learn's own answer when logged out: { status: 401, message: "API request is not authenticated." }.
    if (answer?.status === 401 && record(answer.body).status === 401) return { lms: "blackboard", loggedIn: false }
    return null
  }

  const brightspace = async (): Promise<Detected | null> => {
    const answer = await ask("/d2l/api/versions/")
    if (answer?.status !== 200 || !Array.isArray(answer.body)) return null
    const lp = answer.body.map(record).find((product) => product.ProductCode === "lp")
    if (!lp || typeof lp.LatestVersion !== "string" || !/^\d+\.\d+$/.test(lp.LatestVersion)) return null
    const me = await ask(`/d2l/api/lp/${lp.LatestVersion}/users/whoami`)
    return { lms: "brightspace", loggedIn: me?.status === 200 ? true : me?.status === 401 ? false : null }
  }

  // All three at once (a tab is at most one of them); the first that recognizes it wins.
  const found = await Promise.all([canvas(), blackboard(), brightspace()])
  return found.find((item): item is Detected => item !== null) ?? { lms: null }
}
