import "server-only"

import { drizzle } from "drizzle-orm/postgres-js"
import postgres from "postgres"
import { DatabaseUnavailableError } from "../errors"
import * as schema from "./schema"
import type { Database } from "./types"

// The server's connection to Postgres (Supabase). DATABASE_URL is a server-only
// secret: it has no NEXT_PUBLIC_ prefix, so Next.js never sends it to the browser.

const globalForDb = globalThis as unknown as { studentOsSql?: postgres.Sql }

let db: Database | undefined

export function getDb(): Database {
  if (db) return db
  const url = process.env.DATABASE_URL
  if (!url) {
    console.error("[db] DATABASE_URL is not set. Add it to .env.local (see .env.example).")
    throw new DatabaseUnavailableError()
  }
  // Reuse one connection pool across hot reloads in development.
  // prepare: false is required by Supabase's connection pooler (transaction mode).
  const sql = globalForDb.studentOsSql ?? postgres(url, { prepare: false, max: 5, connect_timeout: 10 })
  if (process.env.NODE_ENV !== "production") globalForDb.studentOsSql = sql
  db = drizzle(sql, { schema })
  return db
}
