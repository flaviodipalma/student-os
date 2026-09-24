import { sql } from "drizzle-orm"
import { getDb } from "@/server/db"
import { errorName, logger } from "@/server/log"

// GET /api/health/ready: readiness. "The server can serve students": the
// database answers within a few seconds. 200 when ready, 503 when not. Only
// "ok" / "unavailable" per check: never hosts, versions, errors or counts.
export const dynamic = "force-dynamic"

const TIMEOUT_MS = 3_000

async function database(): Promise<"ok" | "unavailable"> {
  try {
    const query = getDb().execute(sql`select 1`)
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), TIMEOUT_MS))
    await Promise.race([query, timeout])
    return "ok"
  } catch (error) {
    logger.error("health", "database check failed", { type: errorName(error) })
    return "unavailable"
  }
}

export async function GET() {
  const checks = { database: await database() }
  const ready = Object.values(checks).every((status) => status === "ok")
  return Response.json({ status: ready ? "ok" : "unavailable", checks }, { status: ready ? 200 : 503, headers: { "Cache-Control": "no-store" } })
}
