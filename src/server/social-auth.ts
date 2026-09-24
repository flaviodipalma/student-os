import "server-only"

import { cookies, headers } from "next/headers"
import { loginMethodOf, socialProviderIds, socialProviders, type SocialProviderId } from "@/lib/auth-providers"
import { supabaseEnv } from "@/lib/supabase/env"
import { createSupabaseServerClient } from "./auth"

// Server helpers for Google / Microsoft / Apple sign-in through Supabase Auth.
// The providers' client ids and secrets live in the Supabase project
// (Authentication > Sign In / Providers), never in this app or the browser.

// Which login methods the Supabase project has turned on (its public auth
// settings). Cached for a minute; none if Supabase can't be reached.
let cached: { at: number; enabled: SocialProviderId[] } | null = null

export async function enabledSocialProviders(): Promise<SocialProviderId[]> {
  const env = supabaseEnv()
  if (!env) return []
  if (cached && Date.now() - cached.at < 60_000) return cached.enabled
  try {
    const response = await fetch(`${env.url}/auth/v1/settings`, {
      headers: { apikey: env.publishableKey },
      signal: AbortSignal.timeout(5_000),
      cache: "no-store",
    })
    if (!response.ok) throw new Error(`status ${response.status}`)
    const settings = (await response.json()) as { external?: Record<string, boolean> }
    const enabled = socialProviderIds.filter((id) => settings.external?.[socialProviders[id].supabaseId] === true)
    cached = { at: Date.now(), enabled }
    return enabled
  } catch (error) {
    console.warn("[auth] couldn't read the enabled sign-in methods", { name: error instanceof Error ? error.name : typeof error })
    return []
  }
}

// Only for tests.
export function resetEnabledProvidersCache() {
  cached = null
}

// Where the provider sends the student back to. SITE_URL pins it in production;
// Supabase also checks it against the project's allowed Redirect URLs.
export async function authCallbackUrl(): Promise<string> {
  const origin = process.env.SITE_URL?.replace(/\/+$/, "") || (await headers()).get("origin") || ""
  return `${origin}/auth/callback`
}

// What the callback should do once the provider sends the student back: sign in
// (and then open `next`), or add a login method to the signed-in account. Kept
// in a short-lived, HTTP-only cookie rather than the redirect URL.
export const AUTH_INTENT_COOKIE = "sos-auth-intent"
export type AuthIntent = { kind: "sign-in"; next?: string } | { kind: "link"; provider: SocialProviderId }

export async function rememberAuthIntent(intent: AuthIntent) {
  ;(await cookies()).set(AUTH_INTENT_COOKIE, JSON.stringify(intent), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/auth/callback",
    maxAge: 10 * 60,
  })
}

// The buttons to show on the log-in and sign-up pages: the methods the Supabase
// project has turned on. In development all three show, so the page can be
// checked before the providers are set up (an unconfigured one explains itself).
export async function visibleSocialProviders(): Promise<SocialProviderId[]> {
  return process.env.NODE_ENV === "production" ? enabledSocialProviders() : [...socialProviderIds]
}

// Settings > Account: who the student is and how they can log in. No tokens:
// Supabase keeps identities (provider + the provider's account id), and this
// only reads their names and emails.
export type LoginMethod = {
  identityId: string
  method: SocialProviderId | "email"
  email: string | null
  addedAt: string | null
}
export type AccountDetails = { email: string | null; createdAt: string | null; loginMethods: LoginMethod[] }

export async function getAccountDetails(): Promise<AccountDetails | null> {
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUser()
    if (error || !data.user) return null
    const loginMethods = (data.user.identities ?? []).flatMap((identity): LoginMethod[] => {
      const method = loginMethodOf(identity.provider)
      if (!method) return []
      const email = identity.identity_data?.email
      return [{ identityId: identity.identity_id, method, email: typeof email === "string" ? email : null, addedAt: identity.created_at ?? null }]
    })
    return { email: data.user.email ?? null, createdAt: data.user.created_at ?? null, loginMethods }
  } catch (error) {
    console.error("[auth] couldn't load account details", { name: error instanceof Error ? error.name : typeof error })
    return null
  }
}
