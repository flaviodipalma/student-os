import "server-only"

import { and, eq } from "drizzle-orm"
import type { LmsCredentials } from "@/lib/lms/types"
import { lmsProviderNames, type LmsProviderId } from "@/lib/types"
import { lmsConnectionMethod, lmsConnections } from "../../db/schema"
import type { Database } from "../../db/types"
import { NotFoundError } from "../../errors"
import { credentialContext, CredentialVaultError, type CredentialVault } from "./credential-vault"
import { LmsError, type LmsTokenSet } from "./provider"
import { listLmsProviders } from "./registry"

// A student's LMS connections. Every function takes the signed-in student's id
// (from the verified session, never from the request) and only touches that
// student's row. Tokens go in encrypted and only come out through
// loadLmsCredentials, for the sync service on the server.

// "oauth" (signed in with the LMS), "calendar_feed" (the student's feed link) or
// "extension" (the browser extension imports with the student's own LMS session).
export type LmsConnectionMethod = (typeof lmsConnectionMethod.enumValues)[number]

// What the app may show about a connection: no tokens, no ids from the LMS.
export type LmsConnectionSummary = {
  provider: LmsProviderId
  method: LmsConnectionMethod
  status: "connected" | "needs_reauth" | "error"
  connectedAt: string
  lastSyncedAt: string | null
  lastSyncError: string | null
}

// Each provider, for the Settings page: whether it can be connected yet, and
// the student's connection if there is one.
export type LmsIntegrationStatus = {
  provider: LmsProviderId
  name: string
  // False until the adapter is built ("coming soon").
  available: boolean
  // The server has the provider's OAuth app settings.
  configured: boolean
  connection: LmsConnectionSummary | null
}

// A saved connection that can't be decrypted (e.g. the server's encryption key
// was replaced) can't be used again: the student reconnects, nothing else breaks.
function openSaved<T>(provider: LmsProviderId, read: () => T): T {
  try {
    return read()
  } catch (error) {
    if (!(error instanceof CredentialVaultError)) throw error
    const name = lmsProviderNames[provider]
    throw new LmsError(`Student OS can't use your saved ${name} connection anymore. Please connect ${name} again.`, "connection", true)
  }
}

const connectionFor = (userId: string, provider: LmsProviderId) =>
  and(eq(lmsConnections.userId, userId), eq(lmsConnections.provider, provider))

export async function listLmsConnections(db: Database, userId: string): Promise<LmsConnectionSummary[]> {
  const rows = await db
    .select({
      provider: lmsConnections.provider,
      method: lmsConnections.method,
      status: lmsConnections.status,
      createdAt: lmsConnections.createdAt,
      lastSyncedAt: lmsConnections.lastSyncedAt,
      lastSyncError: lmsConnections.lastSyncError,
    })
    .from(lmsConnections)
    .where(eq(lmsConnections.userId, userId))
  return rows.map((row) => ({
    provider: row.provider,
    method: row.method,
    status: row.status,
    connectedAt: row.createdAt.toISOString(),
    lastSyncedAt: row.lastSyncedAt?.toISOString() ?? null,
    lastSyncError: row.lastSyncError,
  }))
}

export async function getLmsIntegrationStatus(db: Database, userId: string): Promise<LmsIntegrationStatus[]> {
  const connections = await listLmsConnections(db, userId)
  return listLmsProviders().map((provider) => ({
    provider: provider.id,
    name: provider.name,
    available: provider.available,
    configured: provider.available && provider.isConfigured(),
    connection: connections.find((c) => c.provider === provider.id) ?? null,
  }))
}

// Stores (or replaces) a connection after a successful OAuth callback.
// Called only by the server-side callback handler, never with tokens from the browser.
export async function saveLmsConnection(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  tokens: LmsTokenSet & { baseUrl: string | null },
  vault: CredentialVault
): Promise<LmsConnectionSummary> {
  const context = credentialContext(userId, provider)
  const values = {
    method: "oauth" as const,
    externalUserId: tokens.externalUserId,
    baseUrl: tokens.baseUrl,
    accessTokenEncrypted: vault.seal(tokens.accessToken, context),
    refreshTokenEncrypted: tokens.refreshToken ? vault.seal(tokens.refreshToken, context) : null,
    tokenExpiresAt: tokens.expiresAt,
    // Signing in replaces a calendar-feed connection.
    feedUrlEncrypted: null,
    status: "connected" as const,
    lastSyncError: null,
  }
  await db
    .insert(lmsConnections)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [lmsConnections.userId, lmsConnections.provider], set: values })
  const summary = (await listLmsConnections(db, userId)).find((c) => c.provider === provider)
  if (!summary) throw new NotFoundError("LMS connection")
  return summary
}

// Decrypted credentials for the student's own connection. Server-side only:
// never return these from a server action or put them in the page.
export async function loadLmsCredentials(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  vault: CredentialVault
): Promise<LmsCredentials> {
  const [row] = await db.select().from(lmsConnections).where(connectionFor(userId, provider))
  if (!row?.accessTokenEncrypted) throw new NotFoundError("LMS connection")
  const context = credentialContext(userId, provider)
  return {
    ...openSaved(provider, () => ({
      accessToken: vault.open(row.accessTokenEncrypted as string, context),
      refreshToken: row.refreshTokenEncrypted ? vault.open(row.refreshTokenEncrypted, context) : null,
    })),
    expiresAt: row.tokenExpiresAt,
    baseUrl: row.baseUrl,
    externalUserId: row.externalUserId,
  }
}

export async function recordLmsSync(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  outcome: { syncedAt: Date } | { error: string; reconnect?: boolean }
): Promise<void> {
  await db
    .update(lmsConnections)
    .set(
      "error" in outcome
        ? { status: outcome.reconnect ? "needs_reauth" : "error", lastSyncError: outcome.error }
        : { status: "connected", lastSyncedAt: outcome.syncedAt, lastSyncError: null }
    )
    .where(connectionFor(userId, provider))
}

// Disconnecting deletes the connection and its tokens. Courses and tasks
// imported from the LMS stay: they're the student's data now.
export async function disconnectLms(db: Database, userId: string, provider: LmsProviderId): Promise<void> {
  const deleted = await db.delete(lmsConnections).where(connectionFor(userId, provider)).returning({ id: lmsConnections.id })
  if (deleted.length === 0) throw new NotFoundError("LMS connection")
}

// A refreshed access token (the refresh token stays the same unless the provider sends a new one).
export async function updateLmsAccessToken(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  tokens: { accessToken: string; refreshToken: string | null; expiresAt: Date | null },
  vault: CredentialVault
): Promise<void> {
  const context = credentialContext(userId, provider)
  await db
    .update(lmsConnections)
    .set({
      accessTokenEncrypted: vault.seal(tokens.accessToken, context),
      ...(tokens.refreshToken ? { refreshTokenEncrypted: vault.seal(tokens.refreshToken, context) } : {}),
      tokenExpiresAt: tokens.expiresAt,
      status: "connected",
    })
    .where(connectionFor(userId, provider))
}

// The provider rejected the tokens for good: the student has to reconnect.
export async function markLmsNeedsReauth(db: Database, userId: string, provider: LmsProviderId, message: string) {
  await db.update(lmsConnections).set({ status: "needs_reauth", lastSyncError: message }).where(connectionFor(userId, provider))
}

// ---- Calendar-feed connections ------------------------------------------------------

// The feed link is bound to its student like a token ("<user>:<provider>:feed").
const feedContext = (userId: string, provider: LmsProviderId) => `${credentialContext(userId, provider)}:feed`

// Stores (or replaces) a calendar-feed connection. Replaces any OAuth tokens.
export async function saveLmsFeedConnection(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  feed: { baseUrl: string; feedUrl: string },
  vault: CredentialVault
): Promise<LmsConnectionSummary> {
  const values = {
    method: "calendar_feed" as const,
    baseUrl: feed.baseUrl,
    feedUrlEncrypted: vault.seal(feed.feedUrl, feedContext(userId, provider)),
    externalUserId: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
    status: "connected" as const,
    lastSyncError: null,
  }
  await db
    .insert(lmsConnections)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [lmsConnections.userId, lmsConnections.provider], set: values })
  const summary = (await listLmsConnections(db, userId)).find((c) => c.provider === provider)
  if (!summary) throw new NotFoundError("LMS connection")
  return summary
}

// ---- Browser-extension connections --------------------------------------------------

// Records (or switches to) a connection through the Student OS browser extension.
// The server holds no LMS secret for it: the extension reads the LMS with the
// student's own browser session and sends the data. Replaces OAuth tokens or a feed link.
export async function saveLmsExtensionConnection(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  baseUrl: string
): Promise<void> {
  const values = {
    method: "extension" as const,
    baseUrl,
    feedUrlEncrypted: null,
    externalUserId: null,
    accessTokenEncrypted: null,
    refreshTokenEncrypted: null,
    tokenExpiresAt: null,
  }
  await db
    .insert(lmsConnections)
    .values({ userId, provider, ...values })
    .onConflictDoUpdate({ target: [lmsConnections.userId, lmsConnections.provider], set: values })
}

// The student's own feed link, decrypted on the server for a sync. Never returned to the browser.
export async function loadLmsFeed(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  vault: CredentialVault
): Promise<{ baseUrl: string; feedUrl: string }> {
  const [row] = await db.select().from(lmsConnections).where(connectionFor(userId, provider))
  if (!row?.feedUrlEncrypted || !row.baseUrl) throw new NotFoundError("LMS connection")
  const encrypted = row.feedUrlEncrypted
  return { baseUrl: row.baseUrl, feedUrl: openSaved(provider, () => vault.open(encrypted, feedContext(userId, provider))) }
}

export async function getLmsConnectionMethod(
  db: Database,
  userId: string,
  provider: LmsProviderId
): Promise<LmsConnectionMethod> {
  const [row] = await db
    .select({ method: lmsConnections.method })
    .from(lmsConnections)
    .where(connectionFor(userId, provider))
  if (!row) throw new NotFoundError("LMS connection")
  return row.method
}
