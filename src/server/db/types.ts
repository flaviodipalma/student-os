import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core"
import type * as schema from "./schema"

// Any Drizzle Postgres database or transaction with our schema. The app uses
// postgres-js (Supabase); tests use PGlite, an in-process Postgres.
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>
