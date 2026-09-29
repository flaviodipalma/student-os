import { timingSafeEqual } from "node:crypto"
import { getDb } from "@/server/db"
import { logger } from "@/server/log"
import { runReminderJob } from "@/server/push/reminders-job"

// Runs the push reminders job (src/server/push/reminders-job.ts). Called by a
// scheduler every few minutes (see docs/deployment.md), never by browsers:
//   Authorization: Bearer <CRON_SECRET>
// GET and POST both work (Vercel Cron uses GET). Without CRON_SECRET set, it's off.

export const maxDuration = 300

function authorized(request: Request): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < 32) return false
  const given = request.headers.get("authorization") ?? ""
  const expected = `Bearer ${secret}`
  return given.length === expected.length && timingSafeEqual(Buffer.from(given), Buffer.from(expected))
}

async function run(request: Request) {
  if (!process.env.CRON_SECRET) return Response.json({ error: "CRON_SECRET isn't set: the reminders job is off." }, { status: 503 })
  if (!authorized(request)) return Response.json({ error: "Not allowed." }, { status: 401 })
  const result = await runReminderJob(getDb())
  logger.info("push", "reminders job", result)
  return Response.json(result, { headers: { "Cache-Control": "no-store" } })
}

export const GET = run
export const POST = run
