import { PGlite } from "@electric-sql/pglite"
import { drizzle } from "drizzle-orm/pglite"
import { migrate } from "drizzle-orm/pglite/migrator"
import { profiles } from "../db/schema"
import * as schema from "../db/schema"
import type { Database } from "../db/types"

// A real Postgres (PGlite) running in the test process, with the app's actual
// migrations applied. Supabase's auth.users table is stubbed with just an id.
export async function createTestDb() {
  const client = new PGlite()
  await client.exec("create schema auth; create table auth.users (id uuid primary key);")
  const db = drizzle(client, { schema })
  await migrate(db, { migrationsFolder: "drizzle" })

  // A signed-up user: an auth record plus the app's profile.
  async function addUser(firstName = "Test"): Promise<string> {
    const id = crypto.randomUUID()
    await client.query("insert into auth.users (id) values ($1)", [id])
    await db.insert(profiles).values({ id, firstName })
    return id
  }

  return { db: db as unknown as Database, client, addUser, close: () => client.close() }
}
