import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"
import { redirect } from "next/navigation"
import { createServerClient } from "@supabase/ssr"
import { supabaseEnv } from "@/lib/supabase/env"

// Authentication for server code (pages, layouts, server actions, route handlers).
// Supabase Auth handles sign-up, passwords and sessions; the session lives in
// cookies. This is the "data access layer" check: every data load and every
// server action calls getCurrentUser(), so security never depends on the proxy alone.

export type SessionUser = { id: string; email: string | null }

export async function createSupabaseServerClient() {
  const env = supabaseEnv()
  if (!env) throw new Error("Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.")
  const cookieStore = await cookies()
  return createServerClient(env.url, env.publishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) cookieStore.set(name, value, options)
        } catch {
          // Called from a Server Component, where cookies are read-only. The proxy
          // refreshes the session on every request, so this is safe to ignore.
        }
      },
    },
  })
}

// The signed-in user, or null. getClaims() verifies the session token's signature,
// so a forged cookie is rejected. Cached for the rest of the request.
export const getCurrentUser = cache(async (): Promise<SessionUser | null> => {
  if (!supabaseEnv()) return null
  const supabase = await createSupabaseServerClient()
  const { data, error } = await supabase.auth.getClaims()
  const claims = data?.claims
  if (error || !claims?.sub) return null
  return { id: claims.sub, email: typeof claims.email === "string" ? claims.email : null }
})

// For pages and layouts: the signed-in user, or a redirect to the login page.
export async function requireUser(): Promise<SessionUser> {
  const user = await getCurrentUser()
  if (!user) redirect("/login")
  return user
}
