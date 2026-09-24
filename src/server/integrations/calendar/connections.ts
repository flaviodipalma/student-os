import "server-only"

import { and, eq } from "drizzle-orm"
import { calendarProviderIds, calendarProviderNames, type CalendarProviderId } from "@/lib/types"
import { calendarConnections } from "../../db/schema"
import type { Database } from "../../db/types"
import { credentialContext, CredentialVaultError, type CredentialVault } from "../lms/credential-vault"
import { CalendarProviderError, type CalendarAccess, type CalendarAccount, type CalendarProvider, type CalendarTokens } from "./provider"
import { getCalendarProvider } from "./registry"

// A student's personal calendar connections (Google Calendar, Outlook). Every
// function takes the signed-in student's id (from the session, never the
// request) and only touches that student's rows. Tokens are sealed with the same
// credential vault as LMS tokens, bound to "<user id>:calendar:<provider>", and
// only opened here, on the server, for a sync or a disconnect.

// What the browser may see: no tokens, no provider ids.
export type CalendarConnectionSummary = {
  status: "connected" | "needs_reauth" | "error"
  accountEmail: string | null
  connectedAt: string
  lastSyncedAt: string | null
  lastSyncError: string | null
}

export type CalendarIntegrationStatus = {
  provider: CalendarProviderId
  name: string
  // The server has the provider's OAuth app settings (and the encryption key).
  configured: boolean
  connection: CalendarConnectionSummary | null
}

const context = (userId: string, provider: CalendarProviderId) => credentialContext(userId, `calendar:${provider}`)
const connectionFor = (userId: string, provider: CalendarProviderId) =>
  and(eq(calendarConnections.userId, userId), eq(calendarConnections.provider, provider))

export async function getCalendarIntegrationStatus(db: Database, userId: string, vaultReady: boolean): Promise<CalendarIntegrationStatus[]> {
  const rows = await db
    .select({
      provider: calendarConnections.provider,
      status: calendarConnections.status,
      accountEmail: calendarConnections.accountEmail,
      createdAt: calendarConnections.createdAt,
      lastSyncedAt: calendarConnections.lastSyncedAt,
      lastSyncError: calendarConnections.lastSyncError,
    })
    .from(calendarConnections)
    .where(eq(calendarConnections.userId, userId))
  return calendarProviderIds.map((provider) => {
    const row = rows.find((r) => r.provider === provider)
    return {
      provider,
      name: calendarProviderNames[provider],
      configured: vaultReady && getCalendarProvider(provider).isConfigured(),
      connection: row
        ? {
            status: row.status,
            accountEmail: row.accountEmail,
            connectedAt: row.createdAt.toISOString(),
            lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
            lastSyncError: row.lastSyncError,
          }
        : null,
    }
  })
}

// After the student approves: one connection per provider (connecting again replaces it).
export async function saveCalendarConnection(
  db: Database,
  userId: string,
  provider: CalendarProviderId,
  tokens: CalendarTokens,
  account: CalendarAccount,
  vault: CredentialVault
): Promise<void> {
  const values = {
    externalAccountId: account.externalAccountId,
    accountEmail: account.email,
    accessTokenEncrypted: vault.seal(tokens.accessToken, context(userId, provider)),
    refreshTokenEncrypted: tokens.refreshToken ? vault.seal(tokens.refreshToken, context(userId, provider)) : null,
    tokenExpiresAt: tokens.expiresAt,
    scopes: tokens.scopes,
    status: "connected" as const,
    lastSyncError: null,
  }
  await db
    .insert(calendarConnections)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [calendarConnections.userId, calendarConnections.provider], set: { ...values, updatedAt: new Date() } })
}

type Credentials = { accessToken: string; refreshToken: string | null; expiresAt: Date | null }

export async function loadCalendarCredentials(
  db: Database,
  userId: string,
  provider: CalendarProviderId,
  vault: CredentialVault
): Promise<Credentials> {
  const [row] = await db.select().from(calendarConnections).where(connectionFor(userId, provider))
  const name = calendarProviderNames[provider]
  if (!row) throw new CalendarProviderError("reconnect", name)
  try {
    return {
      accessToken: vault.open(row.accessTokenEncrypted, context(userId, provider)),
      refreshToken: row.refreshTokenEncrypted ? vault.open(row.refreshTokenEncrypted, context(userId, provider)) : null,
      expiresAt: row.tokenExpiresAt,
    }
  } catch (error) {
    // E.g. the server's encryption key was replaced: the student connects again.
    if (error instanceof CredentialVaultError) {
      await markCalendarNeedsReauth(db, userId, provider)
      throw new CalendarProviderError("reconnect", name)
    }
    throw error
  }
}

export async function markCalendarNeedsReauth(db: Database, userId: string, provider: CalendarProviderId) {
  await db
    .update(calendarConnections)
    .set({ status: "needs_reauth", lastSyncError: new CalendarProviderError("reconnect", calendarProviderNames[provider]).message, updatedAt: new Date() })
    .where(connectionFor(userId, provider))
}

export async function recordCalendarSync(
  db: Database,
  userId: string,
  provider: CalendarProviderId,
  outcome: { ok: true; at: Date } | { ok: false; error: CalendarProviderError }
) {
  await db
    .update(calendarConnections)
    .set(
      outcome.ok
        ? { status: "connected", lastSyncedAt: outcome.at, lastSyncError: null, updatedAt: new Date() }
        : { status: outcome.error.kind === "reconnect" ? "needs_reauth" : "error", lastSyncError: outcome.error.message, updatedAt: new Date() }
    )
    .where(connectionFor(userId, provider))
}

// Disconnecting deletes the connection and its tokens (after the caller revokes them).
export async function deleteCalendarConnection(db: Database, userId: string, provider: CalendarProviderId): Promise<boolean> {
  const deleted = await db.delete(calendarConnections).where(connectionFor(userId, provider)).returning({ id: calendarConnections.id })
  return deleted.length > 0
}

// ---- Token management for one request (the only place tokens are refreshed).

const EXPIRY_MARGIN_MS = 60_000

export async function createCalendarAccess(
  db: Database,
  userId: string,
  provider: CalendarProvider,
  vault: CredentialVault,
  now: () => Date = () => new Date()
): Promise<CalendarAccess> {
  const credentials = await loadCalendarCredentials(db, userId, provider.id, vault)
  let accessToken = credentials.accessToken
  let expiresAt = credentials.expiresAt
  let refreshToken = credentials.refreshToken
  let refreshing: Promise<string> | null = null
  let fresh = false

  async function refresh(): Promise<string> {
    if (!refreshToken) {
      await markCalendarNeedsReauth(db, userId, provider.id)
      throw new CalendarProviderError("reconnect", provider.name)
    }
    let tokens: CalendarTokens
    try {
      tokens = await provider.refreshTokens(refreshToken)
    } catch (error) {
      // An outage isn't a reason to reconnect; a rejected refresh token is.
      if (error instanceof CalendarProviderError && error.kind !== "reconnect") throw error
      await markCalendarNeedsReauth(db, userId, provider.id)
      throw new CalendarProviderError("reconnect", provider.name)
    }
    accessToken = tokens.accessToken
    expiresAt = tokens.expiresAt
    // Microsoft sends a new refresh token each time; Google usually doesn't.
    refreshToken = tokens.refreshToken ?? refreshToken
    fresh = true
    await db
      .update(calendarConnections)
      .set({
        accessTokenEncrypted: vault.seal(accessToken, context(userId, provider.id)),
        refreshTokenEncrypted: vault.seal(refreshToken, context(userId, provider.id)),
        tokenExpiresAt: expiresAt,
        updatedAt: new Date(),
      })
      .where(connectionFor(userId, provider.id))
    return accessToken
  }
  const refreshOnce = () => {
    refreshing ??= refresh().finally(() => {
      refreshing = null
    })
    return refreshing
  }

  return {
    async getAccessToken() {
      if (!fresh && expiresAt && expiresAt.getTime() - EXPIRY_MARGIN_MS <= now().getTime()) return refreshOnce()
      return accessToken
    },
    refreshAccessToken: refreshOnce,
  }
}
