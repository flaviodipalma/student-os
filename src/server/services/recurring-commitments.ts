import "server-only"

import { and, asc, eq } from "drizzle-orm"
import type { RecurringCommitment, RecurringCommitmentInput } from "@/lib/types"
import { recurringCommitments } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError, ValidationError } from "../errors"
import { hasChanges } from "./util"

// Weekly commitments: one row per rule. The weekly occurrences are never stored;
// src/lib/recurring.ts works them out for the Calendar, Dashboard and Planner.

// What an edit can change. null clears an optional field.
export type RecurringCommitmentChanges = Partial<
  Omit<RecurringCommitmentInput, "description" | "startDate" | "endDate">
> & {
  description?: string | null
  startDate?: string | null
  endDate?: string | null
}

const hhmm = (time: string) => time.slice(0, 5)
const orNull = (value: string | undefined) => (value ? value : null)

function toRow(input: RecurringCommitmentInput) {
  return {
    title: input.title,
    daysOfWeek: input.daysOfWeek,
    startTime: input.startTime,
    endTime: input.endTime,
    type: input.type,
    description: orNull(input.description),
    startDate: orNull(input.startDate),
    endDate: orNull(input.endDate),
  }
}

function toCommitment(row: typeof recurringCommitments.$inferSelect): RecurringCommitment {
  return {
    id: row.id,
    title: row.title,
    daysOfWeek: [...row.daysOfWeek].sort((a, b) => a - b),
    startTime: hhmm(row.startTime),
    endTime: hhmm(row.endTime),
    type: row.type,
    description: row.description ?? undefined,
    startDate: row.startDate ?? undefined,
    endDate: row.endDate ?? undefined,
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
    .values({ ...toRow(input), id: input.id, userId })
    .returning()
  return toCommitment(row)
}

export async function updateRecurringCommitment(
  db: Database,
  userId: string,
  commitmentId: string,
  changes: RecurringCommitmentChanges
): Promise<RecurringCommitment> {
  const where = and(eq(recurringCommitments.id, commitmentId), eq(recurringCommitments.userId, userId))
  const [existing] = await db.select().from(recurringCommitments).where(where)
  if (!existing) throw new NotFoundError("recurring commitment")
  const values = {
    ...changes,
    description: changes.description === undefined ? undefined : changes.description || null,
  }
  if (!hasChanges(values)) return toCommitment(existing)

  // Checked against the saved values too, for edits that change only one side.
  const startTime = values.startTime ?? hhmm(existing.startTime)
  const endTime = values.endTime ?? hhmm(existing.endTime)
  if (endTime <= startTime) throw new ValidationError("End time must be after the start time.")
  const startDate = values.startDate === undefined ? existing.startDate : values.startDate
  const endDate = values.endDate === undefined ? existing.endDate : values.endDate
  if (startDate && endDate && endDate < startDate) throw new ValidationError("The end date can't be before the start date.")

  const [row] = await db.update(recurringCommitments).set(values).where(where).returning()
  if (!row) throw new NotFoundError("recurring commitment")
  return toCommitment(row)
}

export async function deleteRecurringCommitment(db: Database, userId: string, commitmentId: string): Promise<void> {
  const deleted = await db
    .delete(recurringCommitments)
    .where(and(eq(recurringCommitments.id, commitmentId), eq(recurringCommitments.userId, userId)))
    .returning({ id: recurringCommitments.id })
  if (deleted.length === 0) throw new NotFoundError("recurring commitment")
}

// Replaces all of a student's weekly commitments (used when onboarding saves its list).
export async function replaceRecurringCommitments(
  db: Database,
  userId: string,
  commitments: RecurringCommitmentInput[]
): Promise<RecurringCommitment[]> {
  await db.delete(recurringCommitments).where(eq(recurringCommitments.userId, userId))
  if (commitments.length > 0) {
    await db.insert(recurringCommitments).values(commitments.map((commitment) => ({ ...toRow(commitment), userId })))
  }
  return listRecurringCommitments(db, userId)
}
