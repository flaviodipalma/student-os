import { and, asc, eq } from "drizzle-orm"
import type { RecurringCommitment, RecurringCommitmentInput } from "@/lib/types"
import { recurringCommitments } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"
import { hasChanges } from "./util"

const hhmm = (time: string) => time.slice(0, 5)

function toCommitment(row: typeof recurringCommitments.$inferSelect): RecurringCommitment {
  return {
    id: row.id,
    title: row.title,
    daysOfWeek: [...row.daysOfWeek].sort((a, b) => a - b),
    startTime: hhmm(row.startTime),
    endTime: hhmm(row.endTime),
    type: row.type,
  }
}

export async function listRecurringCommitments(db: Database, userId: string): Promise<RecurringCommitment[]> {
  const rows = await db
    .select()
    .from(recurringCommitments)
    .where(eq(recurringCommitments.userId, userId))
    .orderBy(asc(recurringCommitments.startTime), asc(recurringCommitments.createdAt))
  return rows.map(toCommitment)
}

export async function createRecurringCommitment(
  db: Database,
  userId: string,
  input: RecurringCommitmentInput & { id?: string }
): Promise<RecurringCommitment> {
  const [row] = await db
    .insert(recurringCommitments)
    .values({ ...input, id: input.id, userId })
    .returning()
  return toCommitment(row)
}

export async function updateRecurringCommitment(
  db: Database,
  userId: string,
  commitmentId: string,
  changes: Partial<RecurringCommitmentInput>
): Promise<RecurringCommitment> {
  const where = and(eq(recurringCommitments.id, commitmentId), eq(recurringCommitments.userId, userId))
  if (!hasChanges(changes)) {
    const [existing] = await db.select().from(recurringCommitments).where(where)
    if (!existing) throw new NotFoundError("weekly commitment")
    return toCommitment(existing)
  }
  const [row] = await db.update(recurringCommitments).set(changes).where(where).returning()
  if (!row) throw new NotFoundError("weekly commitment")
  return toCommitment(row)
}

export async function deleteRecurringCommitment(db: Database, userId: string, commitmentId: string): Promise<void> {
  const deleted = await db
    .delete(recurringCommitments)
    .where(and(eq(recurringCommitments.id, commitmentId), eq(recurringCommitments.userId, userId)))
    .returning({ id: recurringCommitments.id })
  if (deleted.length === 0) throw new NotFoundError("weekly commitment")
}

// Replaces all of a student's weekly commitments (used when onboarding saves its list).
export async function replaceRecurringCommitments(
  db: Database,
  userId: string,
  commitments: RecurringCommitmentInput[]
): Promise<RecurringCommitment[]> {
  await db.delete(recurringCommitments).where(eq(recurringCommitments.userId, userId))
  if (commitments.length > 0) {
    await db.insert(recurringCommitments).values(commitments.map((commitment) => ({ ...commitment, userId })))
  }
  return listRecurringCommitments(db, userId)
}
