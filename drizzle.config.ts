import { existsSync } from "node:fs"
import { defineConfig } from "drizzle-kit"

// drizzle-kit doesn't read .env.local on its own.
if (existsSync(".env.local")) process.loadEnvFile(".env.local")

// Migrations: `npm run db:generate` writes SQL to ./drizzle from the schema,
// `npm run db:migrate` applies it to DATABASE_URL.
export default defineConfig({
  schema: "./src/server/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  // Only manage our tables; Supabase owns the auth schema.
  schemaFilter: ["public"],
  dbCredentials: { url: process.env.DATABASE_URL ?? "" },
})
