import "server-only"

import { randomBytes, timingSafeEqual } from "node:crypto"
import type { LmsProviderId } from "@/lib/types"
import type { CredentialVault } from "./credential-vault"

// OAuth `state` (CSRF protection for the sign-in callback).
//
// Starting a connection creates a random, single-use state. It goes to the LMS
// in the authorization URL, and into an HttpOnly, SameSite=Lax cookie together
// with who started it, which LMS address, and when, encrypted and authenticated
// with the app's key (so it can't be read or forged). The callback accepts only:
//   the same state (compared in constant time), from the same signed-in student,
//   for the same provider, within 10 minutes. The cookie is deleted either way.

export const OAUTH_STATE_MAX_AGE_SECONDS = 600

export const oauthStateCookieName = (provider: LmsProviderId) => `lms_oauth_${provider}`

type Payload = { state: string; userId: string; baseUrl: string; issuedAt: number }

const context = (provider: LmsProviderId) => `oauth-state:${provider}`

export function createOAuthState(
  input: { provider: LmsProviderId; userId: string; baseUrl: string },
  vault: CredentialVault,
  now = new Date()
): { state: string; cookieValue: string } {
  const state = randomBytes(32).toString("base64url")
  const payload: Payload = { state, userId: input.userId, baseUrl: input.baseUrl, issuedAt: now.getTime() }
  return { state, cookieValue: vault.seal(JSON.stringify(payload), context(input.provider)) }
}

// The LMS address the flow was started for, or null if anything doesn't match.
export function verifyOAuthState(
  input: { provider: LmsProviderId; userId: string; state: string | null; cookieValue: string | undefined },
  vault: CredentialVault,
  now = new Date()
): { baseUrl: string } | null {
  if (!input.state || !input.cookieValue) return null
  let payload: Payload
  try {
    payload = JSON.parse(vault.open(input.cookieValue, context(input.provider))) as Payload
  } catch {
    return null
  }
  const expected = Buffer.from(payload.state ?? "")
  const received = Buffer.from(input.state)
  if (expected.length === 0 || expected.length !== received.length || !timingSafeEqual(expected, received)) return null
  if (payload.userId !== input.userId) return null
  if (now.getTime() - payload.issuedAt > OAUTH_STATE_MAX_AGE_SECONDS * 1000 || now.getTime() < payload.issuedAt) return null
  return { baseUrl: payload.baseUrl }
}
