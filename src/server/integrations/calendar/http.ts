import { CalendarProviderError, type CalendarAccess, type CalendarTokens } from "./provider"

// HTTP for the calendar providers: only HTTPS to the provider's own hosts, no
// redirects, a timeout, the token only in the Authorization header, and errors
// turned into CalendarProviderError kinds (the provider's error text is dropped).

const TIMEOUT_MS = 15_000

function checkedUrl(url: string, allowedHosts: string[], name: string): URL {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new CalendarProviderError("failed", name)
  }
  if (parsed.protocol !== "https:" || !allowedHosts.includes(parsed.hostname) || parsed.username || parsed.password) {
    throw new CalendarProviderError("failed", name)
  }
  return parsed
}

async function send(url: URL, init: RequestInit, name: string): Promise<Response> {
  try {
    return await fetch(url, { ...init, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "no-store" })
  } catch {
    // Network failure or timeout.
    throw new CalendarProviderError("unavailable", name)
  }
}

async function errorReason(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { errors?: { reason?: string }[]; code?: string } | string }
    if (typeof body.error === "string") return body.error
    return body.error?.errors?.[0]?.reason ?? body.error?.code ?? ""
  } catch {
    return ""
  }
}

// GET JSON with the student's access token; after a 401, one retry with a refreshed token.
export async function getJson<T>(
  access: CalendarAccess,
  url: string,
  options: { allowedHosts: string[]; name: string; headers?: Record<string, string> }
): Promise<T> {
  const target = checkedUrl(url, options.allowedHosts, options.name)
  let token = await access.getAccessToken()
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await send(target, { headers: { ...options.headers, Authorization: `Bearer ${token}`, Accept: "application/json" } }, options.name)
    if (response.ok) {
      try {
        return (await response.json()) as T
      } catch {
        throw new CalendarProviderError("failed", options.name)
      }
    }
    if (response.status === 401 && attempt === 0) {
      token = await access.refreshAccessToken()
      continue
    }
    if (response.status === 401) throw new CalendarProviderError("reconnect", options.name)
    if (response.status === 429) throw new CalendarProviderError("rate-limited", options.name)
    if (response.status === 403) {
      // Google reports quota problems as 403 with a reason.
      const reason = await errorReason(response)
      throw new CalendarProviderError(/rate|quota/i.test(reason) ? "rate-limited" : "permission", options.name)
    }
    if (response.status >= 500) throw new CalendarProviderError("unavailable", options.name)
    throw new CalendarProviderError("failed", options.name)
  }
  throw new CalendarProviderError("reconnect", options.name)
}

// The OAuth token endpoint (code exchange or refresh). A rejected grant means
// the student has to connect again.
export async function postTokenForm(
  url: string,
  params: Record<string, string>,
  options: { allowedHosts: string[]; name: string }
): Promise<CalendarTokens> {
  const target = checkedUrl(url, options.allowedHosts, options.name)
  const response = await send(
    target,
    { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams(params) },
    options.name
  )
  if (!response.ok) {
    const reason = await errorReason(response)
    if (response.status >= 500) throw new CalendarProviderError("unavailable", options.name)
    if (response.status === 429) throw new CalendarProviderError("rate-limited", options.name)
    if (reason === "invalid_client" || reason === "unauthorized_client") throw new CalendarProviderError("not-configured", options.name)
    // invalid_grant: expired, revoked or already used.
    throw new CalendarProviderError("reconnect", options.name)
  }
  let body: { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown }
  try {
    body = await response.json()
  } catch {
    throw new CalendarProviderError("failed", options.name)
  }
  if (typeof body.access_token !== "string" || !body.access_token) throw new CalendarProviderError("failed", options.name)
  return {
    accessToken: body.access_token,
    refreshToken: typeof body.refresh_token === "string" && body.refresh_token ? body.refresh_token : null,
    expiresAt: typeof body.expires_in === "number" ? new Date(Date.now() + body.expires_in * 1000) : null,
    scopes: typeof body.scope === "string" ? body.scope : null,
  }
}

// Only links to the provider's own calendar pages are kept (https, known host).
export function safeProviderLink(url: unknown, allowedHosts: string[]): string | null {
  if (typeof url !== "string") return null
  try {
    const parsed = new URL(url)
    return parsed.protocol === "https:" && allowedHosts.includes(parsed.hostname) && !parsed.username && !parsed.password ? parsed.toString() : null
  } catch {
    return null
  }
}
