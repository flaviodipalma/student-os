import "server-only"

import { and, asc, eq, gte } from "drizzle-orm"
import { addDays, toDateKey } from "@/lib/format"
import type { AnnouncementFinding, ClassCancellation, Task, TaskType } from "@/lib/types"
import { announcementFindings, classCancellations } from "../db/schema"
import type { Database } from "../db/types"
import { NotFoundError } from "../errors"
import { createTask } from "./tasks"

// Suggestions from course announcements (a quiz, an exam, a deadline, no class) and
// cancelled classes. Suggestions come from the AI (src/server/integrations/lms/
// course-extras.ts); nothing changes in the student's plan until they accept one:
//   exam / quiz / deadline -> a task in that course, due that day
//   no_class               -> that course's classes skip that day (a class cancellation)
// Every query is scoped to the signed-in student.

type FindingRow = typeof announcementFindings.$inferSelect
type CancellationRow = typeof classCancellations.$inferSelect

const toFinding = (row: FindingRow): AnnouncementFinding => ({
  id: row.id,
  courseId: row.courseId,
  kind: row.kind,
  title: row.title,
  date: row.date,
  ...(row.time ? { time: row.time.slice(0, 5) } : {}),
  ...(row.quote ? { quote: row.quote } : {}),
  status: row.status,
})

const toCancellation = (row: CancellationRow): ClassCancellation => ({ id: row.id, courseId: row.courseId, date: row.date, source: row.source })

// Suggestions still waiting, soonest first (a day of slack for time zones; the
// Dashboard hides past ones in the student's own time zone).
export async function listAnnouncementFindings(db: Database, userId: string, now = new Date()): Promise<AnnouncementFinding[]> {
  const rows = await db
    .select()
    .from(announcementFindings)
    .where(
      and(
        eq(announcementFindings.userId, userId),
        eq(announcementFindings.status, "pending"),
        gte(announcementFindings.date, addDays(toDateKey(now), -1))
      )
    )
    .orderBy(asc(announcementFindings.date), asc(announcementFindings.createdAt))
  return rows.map(toFinding)
}

export async function listClassCancellations(db: Database, userId: string): Promise<ClassCancellation[]> {
  const rows = await db.select().from(classCancellations).where(eq(classCancellations.userId, userId)).orderBy(asc(classCancellations.date))
  return rows.map(toCancellation)
}

const TASK_TYPE: Record<"exam" | "quiz" | "deadline", TaskType> = { exam: "exam", quiz: "quiz", deadline: "assignment" }

// Accepts a suggestion: the task it becomes, or the class cancellation. In one transaction.
export async function acceptFinding(
  db: Database,
  userId: string,
  findingId: string
): Promise<{ finding: AnnouncementFinding; task?: Task; cancellation?: ClassCancellation }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(announcementFindings)
      .where(and(eq(announcementFindings.id, findingId), eq(announcementFindings.userId, userId), eq(announcementFindings.status, "pending")))
      .for("update")
    if (!row) throw new NotFoundError("suggestion")

    if (row.kind === "no_class") {
      const [inserted] = await tx
        .insert(classCancellations)
        .values({ userId, courseId: row.courseId, date: row.date, source: "announcement", findingId: row.id })
        .onConflictDoNothing()
        .returning()
      const cancellation =
        inserted ??
        (await tx
          .select()
          .from(classCancellations)
          .where(and(eq(classCancellations.userId, userId), eq(classCancellations.courseId, row.courseId), eq(classCancellations.date, row.date))))[0]
      const [updated] = await tx.update(announcementFindings).set({ status: "accepted" }).where(eq(announcementFindings.id, row.id)).returning()
      return { finding: toFinding(updated), cancellation: toCancellation(cancellation) }
    }

    const task = await createTask(tx, userId, {
      courseId: row.courseId,
      title: row.title,
      description: "",
      type: TASK_TYPE[row.kind],
      dueDate: row.date,
      ...(row.time ? { dueTime: row.time.slice(0, 5) } : {}),
      priority: row.kind === "exam" ? "high" : "medium",
      estimateMinutes: null,
      status: "not_started",
      ...(row.quote ? { notes: `From an announcement: "${row.quote}"` } : {}),
    })
    const [updated] = await tx.update(announcementFindings).set({ status: "accepted", taskId: task.id }).where(eq(announcementFindings.id, row.id)).returning()
    return { finding: toFinding(updated), task }
  })
}

export async function dismissFinding(db: Database, userId: string, findingId: string): Promise<void> {
  const [row] = await db
    .update(announcementFindings)
    .set({ status: "dismissed" })
    .where(and(eq(announcementFindings.id, findingId), eq(announcementFindings.userId, userId), eq(announcementFindings.status, "pending")))
    .returning({ id: announcementFindings.id })
  if (!row) throw new NotFoundError("suggestion")
}

// Takes a cancelled class back (Undo): the class meets again that day. A suggestion it
// came from goes back to waiting, so it can be accepted again later.
export async function removeClassCancellation(db: Database, userId: string, cancellationId: string): Promise<{ finding: AnnouncementFinding | null }> {
  return db.transaction(async (tx) => {
    const [row] = await tx
      .delete(classCancellations)
      .where(and(eq(classCancellations.id, cancellationId), eq(classCancellations.userId, userId)))
      .returning()
    if (!row) throw new NotFoundError("cancelled class")
    if (!row.findingId) return { finding: null }
    const [finding] = await tx
      .update(announcementFindings)
      .set({ status: "pending" })
      .where(and(eq(announcementFindings.id, row.findingId), eq(announcementFindings.userId, userId)))
      .returning()
    return { finding: finding ? toFinding(finding) : null }
  })
}
