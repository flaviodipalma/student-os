import "server-only"

import { LmsError } from "../provider"

// Canvas settings, all server-only environment variables (see .env.example):
//
//   CANVAS_CLIENT_ID, CANVAS_CLIENT_SECRET  from the Canvas developer key
//   CANVAS_REDIRECT_URI                     .../api/integrations/canvas/callback, exactly
//                                           as entered on the developer key
//   CANVAS_ALLOWED_HOSTS                    which Canvas addresses students may connect to
//                                           (default "*.instructure.com")
//   CANVAS_REQUEST_SCOPES                   "false" for developer keys without enforced scopes

export type CanvasConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  allowedHosts: string[]
  scopes: string[]
}

// Read-only: the only Canvas API endpoints Student OS uses. With "Enforce Scopes"
// on the developer key, tokens can't do anything else.
export const CANVAS_SCOPES = ["url:GET|/api/v1/courses", "url:GET|/api/v1/courses/:course_id/assignments"]

// Canvas addresses students may connect to (OAuth or calendar feed).
export function canvasAllowedHosts(): string[] {
  return (process.env.CANVAS_ALLOWED_HOSTS ?? "*.instructure.com")
    .split(",")
    .map((host) => host.trim().toLowerCase())
    .filter(Boolean)
}

// OAuth settings; null until a developer key is configured. (The calendar
// feed doesn't need these.)
export function canvasConfig(): CanvasConfig | null {
  const clientId = process.env.CANVAS_CLIENT_ID?.trim()
  const clientSecret = process.env.CANVAS_CLIENT_SECRET?.trim()
  const redirectUri = process.env.CANVAS_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  return {
    clientId,
    clientSecret,
    redirectUri,
    allowedHosts: canvasAllowedHosts(),
    scopes: process.env.CANVAS_REQUEST_SCOPES === "false" ? [] : CANVAS_SCOPES,
  }
}

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((pattern) =>
    pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : host === pattern
  )
}

// The student's Canvas address -> "https://host". Every school has its own
// Canvas (e.g. https://quinnipiac.instructure.com), so it's entered per
// connection. It has to be checked carefully: during sign-in the server sends
// the client secret to this address, so it may only ever be an allowed Canvas
// host, over HTTPS (no IP addresses, ports, credentials or local names).
export function parseCanvasBaseUrl(input: string, allowedHosts: string[]): string {
  const invalid = new LmsError("Enter your school's Canvas address, like school.instructure.com.")
  const raw = input.trim()
  if (!raw || raw.length > 255) throw invalid
  let url: URL
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`)
  } catch {
    throw invalid
  }
  const host = url.hostname.toLowerCase()
  if (url.protocol !== "https:" || url.username || url.password || (url.port && url.port !== "443")) throw invalid
  if (!host.includes(".") || IPV4.test(host) || host.startsWith("[") || host.endsWith(".local")) throw invalid
  if (!hostAllowed(host, allowedHosts)) {
    throw new LmsError(`Student OS can't connect to ${host} yet. Check the address, or ask your admin to allow it.`)
  }
  return `https://${host}`
}
