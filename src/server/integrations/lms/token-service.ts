import "server-only"

import type { Database } from "../../db/types"
import { loadLmsCredentials, markLmsNeedsReauth, updateLmsAccessToken } from "./connections"
import type { CredentialVault } from "./credential-vault"
import { LmsError, type LmsAccess, type LmsProvider } from "./provider"

// Token management for one student's connection, for the length of a request.
// The only code that decrypts, refreshes or re-stores tokens; adapters just ask
// LmsAccess for a valid access token. Tokens stay in server memory for the
// request and are never returned, logged or put in URLs.
//
//   getAccessToken      the current token, refreshed first if it expires within a minute
//   refreshAccessToken  a forced refresh (e.g. after a 401); stores the new token
//   On a failed refresh the connection is marked "needs_reauth" and the student
//   is asked to reconnect.

const EXPIRY_MARGIN_MS = 60_000

export async function createLmsAccess(
  db: Database,
  userId: string,
  provider: LmsProvider,
  vault: CredentialVault,
  options: { timeZone?: string; now?: () => Date } = {}
): Promise<LmsAccess> {
  const now = options.now ?? (() => new Date())
  const credentials = await loadLmsCredentials(db, userId, provider.id, vault)
  if (!credentials.baseUrl) throw new LmsError(`Please reconnect ${provider.name}.`, "connection", true)
  const baseUrl = credentials.baseUrl
  let accessToken = credentials.accessToken
  let expiresAt = credentials.expiresAt
  let refreshing: Promise<string> | null = null
  // A token refreshed during this request is used as-is (no clock-skew loops).
  let fresh = false

  async function refresh(): Promise<string> {
    const reconnect = `Your ${provider.name} connection expired. Please reconnect.`
    if (!credentials.refreshToken) {
      await markLmsNeedsReauth(db, userId, provider.id, reconnect)
      throw new LmsError(reconnect, "connection", true)
    }
    let tokens
    try {
      tokens = await provider.refreshTokens({ baseUrl, refreshToken: credentials.refreshToken })
    } catch (error) {
      // An LMS outage isn't a reason to reconnect; a rejected refresh token is.
      if (error instanceof LmsError && !error.reconnect) throw error
      await markLmsNeedsReauth(db, userId, provider.id, reconnect)
      throw new LmsError(reconnect, "connection", true)
    }
    accessToken = tokens.accessToken
    expiresAt = tokens.expiresAt
    fresh = true
    await updateLmsAccessToken(db, userId, provider.id, tokens, vault)
    return accessToken
  }

  // One refresh at a time, even if several requests hit a 401 together.
  const refreshOnce = () => {
    refreshing ??= refresh().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  return {
    baseUrl,
    timeZone: options.timeZone,
    async getAccessToken() {
      if (!fresh && expiresAt && expiresAt.getTime() - EXPIRY_MARGIN_MS <= now().getTime()) return refreshOnce()
      return accessToken
    },
    refreshAccessToken: refreshOnce,
  }
}
