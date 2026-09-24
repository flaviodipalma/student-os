import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import { NextRequest } from "next/server"
import { authErrorFromCode, firstNameFrom, isPrivateRelayEmail, loginMethodOf, safeNextPath, socialProviders } from "@/lib/auth-providers"
import type { Database } from "@/server/db/types"
import { createTestDb } from "@/server/test-utils/test-db"

// Sign-in with email, Google, Microsoft and Apple; adding and removing login
// methods; the OAuth callback; protected routes. Supabase Auth and the providers
// are test doubles: no real credentials or network. The database is real (PGlite).

const mocks = vi.hoisted(() => ({
  db: null as unknown,
  user: null as { id: string; email: string | null } | null,
  cookies: new Map<string, string>(),
  cookieSet: vi.fn(),
  auth: {} as Record<string, ReturnType<typeof vi.fn>>,
  claims: null as { sub: string } | null,
}))
vi.mock("@/server/db", () => ({ getDb: () => mocks.db }))
vi.mock("@/server/auth", () => ({
  getCurrentUser: async () => mocks.user,
  createSupabaseServerClient: async () => ({ auth: mocks.auth }),
}))
vi.mock("next/headers", () => ({
  headers: async () => new Headers({ origin: "http://localhost:3000" }),
  cookies: async () => ({ set: mocks.cookieSet, get: (name: string) => (mocks.cookies.has(name) ? { value: mocks.cookies.get(name) } : undefined) }),
}))
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw new Error(`REDIRECT ${url}`)
  },
}))
vi.mock("@supabase/ssr", () => ({ createServerClient: () => ({ auth: { getClaims: async () => ({ data: { claims: mocks.claims } }) } }) }))

const actions = await import("./auth")
const { GET: callback } = await import("@/app/auth/callback/route")
const { proxy } = await import("@/proxy")
const { resetEnabledProvidersCache } = await import("@/server/social-auth")
const { ensureProfile, getProfile, completeOnboarding } = await import("@/server/services/profiles")
const { createCourse } = await import("@/server/services/courses")
const { loadAppData } = await import("@/server/services/app-data")

let t: Awaited<ReturnType<typeof createTestDb>>
let enabled: Record<string, boolean>
beforeAll(async () => {
  t = await createTestDb()
  mocks.db = t.db as Database
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.test"
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = "sb_publishable_test"
})
afterAll(() => t.close())
beforeEach(() => {
  enabled = { google: true, azure: true, apple: true, email: true }
  resetEnabledProvidersCache()
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify({ external: enabled }), { status: 200 }))
  )
  mocks.auth = {}
  mocks.user = null
  mocks.cookies.clear()
  mocks.cookieSet.mockClear()
})
afterEach(() => vi.unstubAllGlobals())

const form = (values: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(values)) data.set(key, value)
  return data
}
const redirectOf = (promise: Promise<unknown>) => promise.then(() => null, (error: Error) => error.message.replace(/^REDIRECT /, ""))
const callbackRequest = (query: string, intent?: object) =>
  new NextRequest(`http://localhost:3000/auth/callback${query}`, intent ? { headers: { cookie: `sos-auth-intent=${encodeURIComponent(JSON.stringify(intent))}` } } : {})
const location = (response: Response) => {
  const url = new URL(response.headers.get("location")!)
  return url.pathname + url.search + url.hash
}

describe("provider configuration", () => {
  it("Google, Microsoft (Entra ID) and Apple, asking for identity only", () => {
    expect(socialProviders.google.supabaseId).toBe("google")
    expect(socialProviders.microsoft).toEqual({ name: "Microsoft", supabaseId: "azure", scopes: "openid email profile" })
    expect(socialProviders.apple.supabaseId).toBe("apple")
    // No calendar or mail access with login.
    expect(JSON.stringify(socialProviders)).not.toMatch(/calendar|mail\.|Calendars|offline_access/i)
  })

  it("helpers: login method names, Apple relay emails, first names, safe redirects, error codes", () => {
    expect(loginMethodOf("azure")).toBe("microsoft")
    expect(loginMethodOf("email")).toBe("email")
    expect(loginMethodOf("github")).toBeNull()
    expect(isPrivateRelayEmail("abc123@privaterelay.appleid.com")).toBe(true)
    expect(isPrivateRelayEmail("alex@gmail.com")).toBe(false)
    expect(firstNameFrom({ given_name: "Alex", name: "Alex Kim" })).toBe("Alex")
    expect(firstNameFrom({ full_name: "Sam Lee" })).toBe("Sam")
    expect(firstNameFrom({ name: "sam@school.edu" })).toBe("")
    expect(firstNameFrom({})).toBe("")
    expect(safeNextPath("/planner?date=2026-09-22")).toBe("/planner?date=2026-09-22")
    for (const bad of ["//evil.com", "https://evil.com", "/\\evil.com", "planner", null]) expect(safeNextPath(bad)).toBeNull()
    expect(authErrorFromCode("access_denied")).toBe("cancelled")
    expect(authErrorFromCode("identity_already_exists")).toBe("already-used")
    expect(authErrorFromCode("bad_oauth_state")).toBe("expired")
    expect(authErrorFromCode("something_new")).toBe("failed")
  })
})

describe("Continue with Google / Microsoft / Apple", () => {
  it("sends the browser to the provider through Supabase (PKCE), remembering where to go next", async () => {
    mocks.auth.signInWithOAuth = vi.fn(async () => ({ data: { url: "https://project.supabase.test/auth/v1/authorize?provider=azure" }, error: null }))
    const to = await redirectOf(actions.continueWithProviderAction({}, form({ provider: "microsoft", next: "/planner" })))
    expect(to).toBe("https://project.supabase.test/auth/v1/authorize?provider=azure")
    expect(mocks.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "azure",
      options: { redirectTo: "http://localhost:3000/auth/callback", scopes: "openid email profile", skipBrowserRedirect: true },
    })
    // Where to go next: an HTTP-only cookie limited to the callback.
    const [name, value, options] = mocks.cookieSet.mock.calls[0]
    expect(name).toBe("sos-auth-intent")
    expect(JSON.parse(value)).toEqual({ kind: "sign-in", next: "/planner" })
    expect(options).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/auth/callback" })
  })

  it("an unsafe next path is dropped", async () => {
    mocks.auth.signInWithOAuth = vi.fn(async () => ({ data: { url: "https://provider.test" }, error: null }))
    await redirectOf(actions.continueWithProviderAction({}, form({ provider: "google", next: "//evil.com" })))
    expect(JSON.parse(mocks.cookieSet.mock.calls[0][1])).toEqual({ kind: "sign-in" })
  })

  it("a provider the Supabase project hasn't turned on explains itself (no broken redirect)", async () => {
    enabled.apple = false
    mocks.auth.signInWithOAuth = vi.fn()
    const state = await actions.continueWithProviderAction({}, form({ provider: "apple" }))
    expect(state).toEqual({ error: "That sign-in method isn't set up yet. Use another method for now." })
    expect(mocks.auth.signInWithOAuth).not.toHaveBeenCalled()
  })

  it("unknown providers, Supabase errors and outages are friendly messages", async () => {
    expect(await actions.continueWithProviderAction({}, form({ provider: "github" }))).toEqual({ error: "We couldn't sign you in. Please try again." })
    mocks.auth.signInWithOAuth = vi.fn(async () => ({ data: { url: null }, error: { code: "provider_disabled", message: "secret internals" } }))
    expect((await actions.continueWithProviderAction({}, form({ provider: "google" }))).error).toBe(
      "That sign-in method isn't set up yet. Use another method for now."
    )
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.auth.signInWithOAuth = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })
    expect((await actions.continueWithProviderAction({}, form({ provider: "google" }))).error).toBe(
      "The sign-in service didn't respond. Please try again in a moment."
    )
  })

  it("if Supabase's settings can't be read, no provider is offered", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("down", { status: 503 })))
    vi.spyOn(console, "warn").mockImplementation(() => {})
    mocks.auth.signInWithOAuth = vi.fn()
    expect((await actions.continueWithProviderAction({}, form({ provider: "google" }))).error).toMatch(/isn't set up yet/)
  })
})

describe("the sign-in callback", () => {
  it("a new Google user becomes a normal Student OS user and goes to onboarding", async () => {
    const id = crypto.randomUUID()
    await t.client.query("insert into auth.users (id) values ($1)", [id])
    mocks.auth.exchangeCodeForSession = vi.fn(async () => ({ data: { user: { id, user_metadata: { given_name: "Maya", email: "maya@gmail.com" } } }, error: null }))
    const response = await callback(callbackRequest("?code=abc", { kind: "sign-in", next: "/planner" }))
    expect(mocks.auth.exchangeCodeForSession).toHaveBeenCalledWith("abc")
    expect(location(response)).toBe("/onboarding")
    expect(await getProfile(t.db, id)).toMatchObject({ firstName: "Maya", onboardingCompleted: false })
    // The one-time intent cookie is cleared.
    expect(response.headers.get("set-cookie")).toMatch(/sos-auth-intent=;/)
  })

  it("an existing student (any method) keeps the same id and all their data; goes where they wanted", async () => {
    const id = crypto.randomUUID()
    await t.client.query("insert into auth.users (id) values ($1)", [id])
    await ensureProfile(t.db, id, "Jordan")
    await completeOnboarding(t.db, id)
    await createCourse(t.db, id, { code: "CSC215", name: "Databases", professor: "", description: "" })
    // Signs in with Apple, which shares no name this time.
    mocks.auth.exchangeCodeForSession = vi.fn(async () => ({ data: { user: { id, user_metadata: {} } }, error: null }))
    const response = await callback(callbackRequest("?code=xyz", { kind: "sign-in", next: "/planner" }))
    expect(location(response)).toBe("/planner")
    expect((await getProfile(t.db, id)).firstName).toBe("Jordan")
    expect((await loadAppData(t.db, id)).courses.map((c) => c.code)).toEqual(["CSC215"])
    const without = await callback(callbackRequest("?code=xyz"))
    expect(location(without)).toBe("/dashboard")
  })

  it("the student cancels or denies at the provider", async () => {
    mocks.auth.exchangeCodeForSession = vi.fn()
    expect(location(await callback(callbackRequest("?error=access_denied&error_description=User+denied")))).toBe("/login?error=cancelled")
    expect(mocks.auth.exchangeCodeForSession).not.toHaveBeenCalled()
  })

  it("expired / replayed / tampered callbacks and outages never sign anyone in", async () => {
    mocks.auth.exchangeCodeForSession = vi.fn(async () => ({ data: { user: null }, error: { code: "flow_state_not_found" } }))
    expect(location(await callback(callbackRequest("?code=replayed")))).toBe("/login?error=expired")
    expect(location(await callback(callbackRequest("")))).toBe("/login?error=confirmation")
    vi.spyOn(console, "error").mockImplementation(() => {})
    mocks.auth.exchangeCodeForSession = vi.fn(async () => {
      throw new TypeError("fetch failed")
    })
    expect(location(await callback(callbackRequest("?code=abc")))).toBe("/login?error=unavailable")
    // A same-email sign-in Supabase won't link (e.g. unverified): explained, no new account.
    expect(location(await callback(callbackRequest("?error=server_error&error_code=email_exists")))).toBe("/login?error=email-exists")
  })

  it("a malformed intent cookie or an unsafe next path falls back to a plain sign-in", async () => {
    const id = crypto.randomUUID()
    await t.client.query("insert into auth.users (id) values ($1)", [id])
    await ensureProfile(t.db, id, "Kai")
    await completeOnboarding(t.db, id)
    mocks.auth.exchangeCodeForSession = vi.fn(async () => ({ data: { user: { id, user_metadata: {} } }, error: null }))
    expect(location(await callback(callbackRequest("?code=a", { kind: "sign-in", next: "https://evil.com" })))).toBe("/dashboard")
    const bad = new NextRequest("http://localhost:3000/auth/callback?code=a", { headers: { cookie: "sos-auth-intent=%7Bnot-json" } })
    expect(location(await callback(bad))).toBe("/dashboard")
  })
})

describe("login methods (Settings > Account)", () => {
  it("only a signed-in student can add one", async () => {
    mocks.auth.linkIdentity = vi.fn()
    expect(await redirectOf(actions.linkLoginMethodAction({}, form({ provider: "google" })))).toBe("/login?next=/settings")
    expect(mocks.auth.linkIdentity).not.toHaveBeenCalled()
  })

  it("adding Google to the signed-in account goes through Supabase's linkIdentity", async () => {
    mocks.user = { id: "u1", email: "alex@school.edu" }
    mocks.auth.linkIdentity = vi.fn(async () => ({ data: { url: "https://project.supabase.test/auth/v1/user/identities/authorize?provider=google" }, error: null }))
    expect(await redirectOf(actions.linkLoginMethodAction({}, form({ provider: "google" })))).toMatch(/identities\/authorize/)
    expect(mocks.auth.linkIdentity).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: "http://localhost:3000/auth/callback", scopes: undefined, skipBrowserRedirect: true },
    })
    expect(JSON.parse(mocks.cookieSet.mock.calls[0][1])).toEqual({ kind: "link", provider: "google" })
  })

  it("linking turned off in Supabase is explained", async () => {
    mocks.user = { id: "u1", email: null }
    mocks.auth.linkIdentity = vi.fn(async () => ({ data: { url: null }, error: { code: "manual_linking_disabled" } }))
    expect((await actions.linkLoginMethodAction({}, form({ provider: "apple" }))).error).toBe(
      "Adding login methods isn't turned on for this Student OS server yet."
    )
  })

  it("back from linking: the same account, now with another method; or why it didn't work", async () => {
    const id = crypto.randomUUID()
    mocks.auth.exchangeCodeForSession = vi.fn(async () => ({ data: { user: { id, user_metadata: {} } }, error: null }))
    expect(location(await callback(callbackRequest("?code=l", { kind: "link", provider: "microsoft" })))).toBe(
      "/settings?login=linked&provider=microsoft#account"
    )
    // A Microsoft account that already belongs to another Student OS account: not moved, not merged.
    expect(location(await callback(callbackRequest("?error=invalid_request&error_code=identity_already_exists", { kind: "link", provider: "microsoft" })))).toBe(
      "/settings?login=already-used#account"
    )
    expect(location(await callback(callbackRequest("?error=access_denied", { kind: "link", provider: "apple" })))).toBe("/settings?login=cancelled#account")
  })

  it("removing: only the student's own methods, and never the last one", async () => {
    const identities = [
      { identity_id: "i-email", provider: "email" },
      { identity_id: "i-google", provider: "google" },
    ]
    mocks.auth.getUserIdentities = vi.fn(async () => ({ data: { identities }, error: null }))
    mocks.auth.unlinkIdentity = vi.fn(async () => ({ data: {}, error: null }))
    expect(await actions.unlinkLoginMethodAction("someone-elses-identity")).toMatchObject({ ok: false, code: "not-found" })
    expect(await actions.unlinkLoginMethodAction("i-google")).toEqual({ ok: true, data: null })
    expect(mocks.auth.unlinkIdentity).toHaveBeenCalledWith(identities[1])

    mocks.auth.getUserIdentities = vi.fn(async () => ({ data: { identities: [identities[0]] }, error: null }))
    mocks.auth.unlinkIdentity.mockClear()
    expect(await actions.unlinkLoginMethodAction("i-email")).toMatchObject({ ok: false, error: "This is your only way to log in. Add another method before removing it." })
    expect(mocks.auth.unlinkIdentity).not.toHaveBeenCalled()

    // Signed out / expired session.
    mocks.auth.getUserIdentities = vi.fn(async () => ({ data: null, error: { code: "session_not_found" } }))
    expect(await actions.unlinkLoginMethodAction("i-email")).toMatchObject({ ok: false, code: "unauthorized" })
  })
})

describe("email and password still work", () => {
  it("log in creates a missing profile and goes to the requested page", async () => {
    const id = crypto.randomUUID()
    await t.client.query("insert into auth.users (id) values ($1)", [id])
    mocks.auth.signInWithPassword = vi.fn(async () => ({ data: { user: { id, user_metadata: { first_name: "Riley" } } }, error: null }))
    expect(await redirectOf(actions.logInAction({}, form({ email: "riley@example.com", password: "pw", next: "/tasks" })))).toBe("/tasks")
    expect((await getProfile(t.db, id)).firstName).toBe("Riley")
    mocks.auth.signInWithPassword = vi.fn(async () => ({ data: { user: null }, error: { code: "invalid_credentials" } }))
    expect(await actions.logInAction({}, form({ email: "riley@example.com", password: "nope" }))).toEqual({ error: "Email or password is incorrect." })
  })

  it("log out signs out and returns to the log-in page", async () => {
    mocks.auth.signOut = vi.fn(async () => ({ error: null }))
    expect(await redirectOf(actions.logOutAction())).toBe("/login")
    expect(mocks.auth.signOut).toHaveBeenCalled()
  })
})

describe("protected routes", () => {
  it("signed out (or an expired session): app pages go to log in; sign-in pages and the callback stay open", async () => {
    mocks.claims = null
    const page = await proxy(new NextRequest("http://localhost:3000/planner?date=2026-09-22"))
    expect(page.headers.get("location")).toBe("http://localhost:3000/login?next=%2Fplanner%3Fdate%3D2026-09-22")
    for (const open of ["/login", "/signup", "/auth/callback?code=x"]) {
      expect((await proxy(new NextRequest(`http://localhost:3000${open}`))).headers.get("location")).toBeNull()
    }
  })

  it("signed in: app pages open; the log-in page goes to the Dashboard", async () => {
    mocks.claims = { sub: "u1" }
    expect((await proxy(new NextRequest("http://localhost:3000/planner"))).headers.get("location")).toBeNull()
    expect((await proxy(new NextRequest("http://localhost:3000/login"))).headers.get("location")).toBe("http://localhost:3000/dashboard")
  })
})
