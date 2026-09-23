import "server-only"

import { and, eq } from "drizzle-orm"
import type { LmsCredentials } from "@/lib/lms/types"
import type { LmsProviderId } from "@/lib/types"
import { lmsConnections } from "../../db/schema"
import type { Database } from "../../db/types"
import { NotFoundError } from "../../errors"
import { credentialContext, type CredentialVault } from "./credential-vault"
import type { LmsTokenSet } from "./provider"
import { listLmsProviders } from "./registry"

// A student's LMS connections. Every function takes the signed-in student's id
// (from the verified session, never from the request) and only touches that
// student's row. Tokens go in encrypted and only come out through
// loadLmsCredentials, for the sync service on the server.

// What the app may show about a connection: no tokens, no ids from the LMS.
export type LmsConnectionSummary = {
  provider: LmsProviderId
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
  connection: LmsConnectionSummary | null
}

const connectionFor = (userId: string, provider: LmsProviderId) =>
  and(eq(lmsConnections.userId, userId), eq(lmsConnections.provider, provider))

export async function listLmsConnections(db: Database, userId: string): Promise<LmsConnectionSummary[]> {
  const rows = await db
    .select({
      provider: lmsConnections.provider,
      status: lmsConnections.status,
      createdAt: lmsConnections.createdAt,
      lastSyncedAt: lmsConnections.lastSyncedAt,
      lastSyncError: lmsConnections.lastSyncError,
    })
    .from(lmsConnections)
    .where(eq(lmsConnections.userId, userId))
  return rows.map((row) => ({
    provider: row.provider,
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
    available: provider.available && provider.isConfigured(),
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
    externalUserId: tokens.externalUserId,
    baseUrl: tokens.baseUrl,
    accessTokenEncrypted: vault.seal(tokens.accessToken, context),
    refreshTokenEncrypted: tokens.refreshToken ? vault.seal(tokens.refreshToken, context) : null,
    tokenExpiresAt: tokens.expiresAt,
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
    accessToken: vault.open(row.accessTokenEncrypted, context),
    refreshToken: row.refreshTokenEncrypted ? vault.open(row.refreshTokenEncrypted, context) : null,
    expiresAt: row.tokenExpiresAt,
    baseUrl: row.baseUrl,
  }
}

export async function recordLmsSync(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  outcome: { syncedAt: Date } | { error: string }
): Promise<void> {
  await db
    .update(lmsConnections)
    .set(
      "error" in outcome
        ? { status: "error", lastSyncError: outcome.error }
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
