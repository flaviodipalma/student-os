import "server-only"

import { and, eq } from "drizzle-orm"
import { lmsProviderIds, lmsProviderNames, type LmsProviderId } from "@/lib/types"
import { lmsConnections } from "../../db/schema"
import type { Database } from "../../db/types"
import { NotFoundError } from "../../errors"

// A student's Canvas and Blackboard connections. They're made by the Student OS
// browser extension, which reads the LMS with the student's own login: the server
// stores no LMS secret, only where the LMS is and how the last sync went. Every
// function takes the signed-in student's id (from the verified session, never
// from the request) and only touches that student's row.

// What the app may show about a connection.
export type LmsConnectionSummary = {
  provider: LmsProviderId
  status: "connected" | "needs_reauth" | "error"
  connectedAt: string
  lastSyncedAt: string | null
  lastSyncError: string | null
}

// Each LMS, for the Integrations page, with the student's connection if there is one.
export type LmsIntegrationStatus = {
  provider: LmsProviderId
  name: string
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
  return lmsProviderIds.map((provider) => ({
    provider,
    name: lmsProviderNames[provider],
    connection: connections.find((c) => c.provider === provider) ?? null,
  }))
}

// Records (or updates) the connection when the extension imports: which LMS
// address it came from. Nothing secret is stored.
export async function saveLmsExtensionConnection(
  db: Database,
  userId: string,
  provider: LmsProviderId,
  baseUrl: string
): Promise<void> {
  await db
    .insert(lmsConnections)
    .values({ userId, provider, method: "extension", baseUrl })
    .onConflictDoUpdate({ target: [lmsConnections.userId, lmsConnections.provider], set: { method: "extension", baseUrl } })
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

// Disconnecting deletes the connection. Courses and tasks imported from the LMS
// stay: they're the student's data now.
export async function disconnectLms(db: Database, userId: string, provider: LmsProviderId): Promise<void> {
  const deleted = await db.delete(lmsConnections).where(connectionFor(userId, provider)).returning({ id: lmsConnections.id })
  if (deleted.length === 0) throw new NotFoundError("LMS connection")
}
