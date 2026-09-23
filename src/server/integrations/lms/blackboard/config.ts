import "server-only"

import { allowedHostsFrom, parseLmsBaseUrl } from "../base-url"

// Blackboard Learn settings, all server-only environment variables (see .env.example):
//
//   BLACKBOARD_CLIENT_ID       the application KEY from the Anthology Developer Portal
//                              (not the Application ID, which is what the school's
//                              admin enters to approve the app)
//   BLACKBOARD_CLIENT_SECRET   the application secret
//   BLACKBOARD_REDIRECT_URI    .../api/integrations/blackboard/callback, exactly as
//                              registered on the Developer Portal
//   BLACKBOARD_ALLOWED_HOSTS   which Learn addresses students may connect to, comma
//                              separated, "*." for subdomains (default "*.blackboard.com").
//                              Schools on their own domain (learn.school.edu) are added here.

export type BlackboardConfig = {
  clientId: string
  clientSecret: string
  redirectUri: string
  allowedHosts: string[]
}

// Read-only access, plus "offline" for a refresh token (so the student doesn't
// have to sign in to Blackboard on every sync).
export const BLACKBOARD_SCOPES = ["read", "offline"]

export function blackboardAllowedHosts(): string[] {
  return allowedHostsFrom(process.env.BLACKBOARD_ALLOWED_HOSTS, "*.blackboard.com")
}

// Null until the app's Developer Portal credentials are configured.
export function blackboardConfig(): BlackboardConfig | null {
  const clientId = process.env.BLACKBOARD_CLIENT_ID?.trim()
  const clientSecret = process.env.BLACKBOARD_CLIENT_SECRET?.trim()
  const redirectUri = process.env.BLACKBOARD_REDIRECT_URI?.trim()
  if (!clientId || !clientSecret || !redirectUri) return null
  return { clientId, clientSecret, redirectUri, allowedHosts: blackboardAllowedHosts() }
}

// The student's Blackboard Learn address -> "https://host" (see base-url.ts for
// why it's checked this strictly: the client secret is sent there).
export function parseBlackboardBaseUrl(input: string, allowedHosts: string[]): string {
  return parseLmsBaseUrl(input, allowedHosts, {
    invalid: "Enter your school's Blackboard address, like school.blackboard.com.",
    notAllowed: (host) => `Student OS can't connect to ${host} yet. Check the address, or ask your admin to allow it.`,
  })
}
