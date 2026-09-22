# Student OS

A planner for college students that answers "What should I do today?", built with
Next.js, TypeScript, Tailwind, Supabase (Postgres + Auth) and Drizzle.

## Setup

1. **Install:** `npm install`
2. **Create a Supabase project** (free) at [supabase.com](https://supabase.com).
3. **Environment:** copy `.env.example` to `.env.local` and fill in:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (Project Settings > API)
   - `DATABASE_URL`: the connection pooler URI (Connect > ORMs, transaction mode, port 6543) with your database password
   - `ANTHROPIC_API_KEY` for syllabus import (optional)
4. **For local development**, turn off email confirmation so sign-up logs you straight in:
   Authentication > Sign In / Providers > Email > "Confirm email" off.
5. **Create the tables:** `npm run db:migrate`
6. **Run:** `npm run dev` and open [http://localhost:3000](http://localhost:3000). Sign up to create your account.

Optional: `npm run db:seed` fills a separate dev account (`DEV_SEED_EMAIL` / `DEV_SEED_PASSWORD`)
with sample data. Real accounts always start empty.

## How it fits together

- **Login:** Supabase Auth (email + password). `src/proxy.ts` refreshes the session and
  redirects signed-out visitors; `src/server/auth.ts` verifies the user on every data load and action.
- **Data:** `src/server/db/schema.ts` (Drizzle schema), migrations in `./drizzle`.
  `src/server/services/` holds all queries, each scoped to the signed-in user's id.
  `src/app/actions/` are the server actions the UI calls.
- **Browser state:** `src/lib/app-store.tsx` starts from the user's data and saves every change
  through a server action.

## Database changes

Edit `src/server/db/schema.ts`, then `npm run db:generate` (writes a migration to `./drizzle`)
and `npm run db:migrate` (applies it).

## Checks

```bash
npx tsc --noEmit   # types
npm run lint       # lint
npm test           # unit + database tests (Vitest, in-process Postgres; no setup needed)
npm run build      # production build
```
