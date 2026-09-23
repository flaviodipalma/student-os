import "server-only"

import { allowedHostsFrom, parseLmsBaseUrl } from "../base-url"

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
  return allowedHostsFrom(process.env.CANVAS_ALLOWED_HOSTS, "*.instructure.com")
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

// The student's Canvas address -> "https://host". Every school has its own
// Canvas (e.g. https://quinnipiac.instructure.com), so it's entered per
// connection. It has to be checked carefully: during sign-in the server sends
// the client secret to this address, so it may only ever be an allowed Canvas
// host, over HTTPS (no IP addresses, ports, credentials or local names).
export function parseCanvasBaseUrl(input: string, allowedHosts: string[]): string {
  return parseLmsBaseUrl(input, allowedHosts, {
    invalid: "Enter your school's Canvas address, like school.instructure.com.",
    notAllowed: (host) => `Student OS can't connect to ${host} yet. Check the address, or ask your admin to allow it.`,
  })
}
