// DEVELOPMENT SEED: fills ONE dev test account with sample data.
//
//   npm run db:seed
//
// Uses DEV_SEED_EMAIL / DEV_SEED_PASSWORD from .env.local. Signs that account in
// (or signs it up), deletes that account's existing data, and adds the sample
// courses, tasks, events and study sessions from src/server/seed. Real accounts
// are never touched: every query is scoped to the dev account's user id.

import { createClient } from "@supabase/supabase-js"
import { eq } from "drizzle-orm"
import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { toDateKey } from "@/lib/format"
import * as schema from "@/server/db/schema"
import type { Database } from "@/server/db/types"
import { buildMockEvents } from "@/server/seed/events"
import { seedCourses } from "@/server/seed/courses"
import { buildMockTasks } from "@/server/seed/tasks"
import { createCourse } from "@/server/services/courses"
import { createEvent } from "@/server/services/events"
import { ensureProfile } from "@/server/services/profiles"
import { createStudySession } from "@/server/services/study-sessions"
import { createTask } from "@/server/services/tasks"

function need(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing ${name} in .env.local (see .env.example).`)
    process.exit(1)
  }
  return value
}

async function main() {
  if (process.env.NODE_ENV === "production") {
    console.error("Refusing to seed with NODE_ENV=production. The seed is for development only.")
    process.exit(1)
  }
  const email = need("DEV_SEED_EMAIL")
  const password = need("DEV_SEED_PASSWORD")
  const supabase = createClient(need("NEXT_PUBLIC_SUPABASE_URL"), need("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"), {
    auth: { persistSession: false },
  })

  // 1. The dev account: sign in, or create it.
  let userId: string
  const signIn = await supabase.auth.signInWithPassword({ email, password })
  if (signIn.data.user) {
    userId = signIn.data.user.id
  } else {
    const signUp = await supabase.auth.signUp({ email, password, options: { data: { first_name: "Flavio" } } })
    if (signUp.error || !signUp.data.user) {
      console.error(`Couldn't create the dev account: ${signUp.error?.message ?? "unknown error"}`)
      process.exit(1)
    }
    if (!signUp.data.session) {
      console.error(
        "Created the dev account, but Supabase wants the email confirmed first.\n" +
          "Turn off 'Confirm email' (Authentication > Sign In / Providers > Email) for development, or confirm it, then run this again."
      )
      process.exit(1)
    }
    userId = signUp.data.user.id
  }

  const sql = postgres(need("DATABASE_URL"), { prepare: false, max: 1 })
  const db = drizzle(sql, { schema }) as unknown as Database
  const today = toDateKey(new Date())

  try {
    // 2. Start the dev account from a clean slate (only this account's rows).
    await ensureProfile(db, userId, "Flavio")
    await db.delete(schema.events).where(eq(schema.events.userId, userId))
    await db.delete(schema.syllabusImports).where(eq(schema.syllabusImports.userId, userId))
    await db.delete(schema.courses).where(eq(schema.courses.userId, userId)) // also deletes tasks + sessions

    // 3. Sample data. Seed files use readable ids ("csc215"); the database gets real ones.
    const courseIds = new Map<string, string>()
    for (const course of seedCourses) {
      const saved = await createCourse(db, userId, course)
      courseIds.set(course.id, saved.id)
    }
    const taskIds = new Map<string, string>()
    for (const task of buildMockTasks(today)) {
      const saved = await createTask(db, userId, { ...task, courseId: courseIds.get(task.courseId)! })
      taskIds.set(task.id, saved.id)
    }
    let events = 0
    let sessions = 0
    for (const event of buildMockEvents(today)) {
      const courseId = event.courseId ? courseIds.get(event.courseId) : undefined
      const taskId = event.taskId ? taskIds.get(event.taskId) : undefined
      if (taskId) {
        // Study time for a specific task is a study session, not an event.
        await createStudySession(db, userId, {
          taskId,
          date: event.date,
          startTime: event.startTime,
          endTime: event.endTime,
          status: event.completed ? "completed" : "scheduled",
        })
        sessions++
      } else {
        await createEvent(db, userId, {
          title: event.title,
          date: event.date,
          startTime: event.startTime,
          endTime: event.endTime,
          type: event.type,
          description: event.description,
          courseId,
        })
        events++
      }
    }
    console.log(
      `Seeded ${email}: ${courseIds.size} courses, ${taskIds.size} tasks, ${events} events, ${sessions} study sessions.`
    )
  } finally {
    await sql.end()
  }
}

main().catch((error) => {
  console.error("Seeding failed:", error instanceof Error ? error.message : error)
  process.exit(1)
})
