import "server-only"

import { LmsError } from "./provider"

// A school's LMS address, typed by the student ("school.instructure.com",
// "https://learn.school.edu/"), checked and reduced to "https://host".
//
// Every school has its own LMS address, so it's entered per connection and has
// to be checked carefully: during sign-in the server sends the app's client
// secret to this address, and the student's token on every sync. It may only
// ever be an allowed host (from server configuration), over HTTPS, with no IP
// addresses, ports, credentials or local names.

const IPV4 = /^\d{1,3}(\.\d{1,3}){3}$/

// "host" matches exactly; "*.example.com" matches any subdomain (not example.com itself).
export function hostAllowed(host: string, allowed: string[]): boolean {
  return allowed.some((pattern) =>
    pattern.startsWith("*.") ? host.endsWith(pattern.slice(1)) && host.length > pattern.length - 1 : host === pattern
  )
}

// A comma-separated allowlist from the environment ("*.instructure.com, lms.school.edu").
// Forgiving about how it's written: "https://school.blackboard.com/" -> "school.blackboard.com".
export function allowedHostsFrom(value: string | undefined, fallback: string): string[] {
  return (value ?? fallback)
    .split(",")
    .map((host) =>
      host
        .trim()
        .toLowerCase()
        .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
        .replace(/[/?#].*$/, "")
    )
    .filter(Boolean)
}

// `allowedHosts` "any-https": any public HTTPS address (browser-extension imports,
// where the server never contacts it; see src/server/integrations/extension/base-url.ts).
export function parseLmsBaseUrl(
  input: string,
  allowedHosts: string[] | "any-https",
  messages: { invalid: string; notAllowed: (host: string) => string }
): string {
  const invalid = new LmsError(messages.invalid)
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
  if (!host.includes(".") || IPV4.test(host) || host.startsWith("[") || host.endsWith(".local") || host.endsWith(".localhost")) {
    throw invalid
  }
  if (allowedHosts !== "any-https" && !hostAllowed(host, allowedHosts)) throw new LmsError(messages.notAllowed(host))
  return `https://${host}`
}

// Only links to the student's own LMS are kept ("Open in Canvas / Blackboard").
export function sameOriginUrl(url: string | null | undefined, baseUrl: string): string | null {
  if (!url) return null
  try {
    const parsed = new URL(url)
    return parsed.origin === baseUrl && parsed.protocol === "https:" ? parsed.toString() : null
  } catch {
    return null
  }
}
