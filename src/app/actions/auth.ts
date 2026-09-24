"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { authErrorFromCode, authErrorMessages, isSocialProvider, safeNextPath, socialProviders } from "@/lib/auth-providers"
import { createSupabaseServerClient, getCurrentUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { ensureProfile } from "@/server/services/profiles"
import { authCallbackUrl, enabledSocialProviders, rememberAuthIntent } from "@/server/social-auth"
import { logger } from "@/server/log"

// Sign up, log in and log out with Supabase Auth: email + password, or Google /
// Microsoft / Apple (OAuth / OpenID Connect, run by Supabase). Every method
// signs in the same kind of Student OS user; social sign-in never connects a
// calendar.

export type AuthFormState = { error?: string; notice?: string }

const signUpSchema = z.object({
  firstName: z.string().trim().min(1, "Add your first name.").max(80, "That name is too long."),
  email: z.email("Enter a valid email address."),
  password: z
    .string()
    .min(8, "Use at least 8 characters for your password.")
    .max(72, "Passwords can be at most 72 characters."),
})

const logInSchema = z.object({
  email: z.email("Enter a valid email address."),
  password: z.string().min(1, "Enter your password."),
})

// Only allow redirects to paths inside this app.
function safeNext(value: FormDataEntryValue | null): string {
  return safeNextPath(value) ?? "/dashboard"
}

const signUpErrors: Record<string, string> = {
  user_already_exists: "An account with this email already exists. Log in instead.",
  email_exists: "An account with this email already exists. Log in instead.",
  weak_password: "That password is too weak. Try a longer one.",
  email_address_invalid: "That email address isn't valid.",
  over_email_send_rate_limit: "Too many sign-up attempts. Please wait a minute and try again.",
  over_request_rate_limit: "Too many attempts. Please wait a minute and try again.",
  signup_disabled: "Sign-ups are turned off right now.",
}

export async function signUpAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = signUpSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }
  const { firstName, email, password } = parsed.data

  const origin = (await headers()).get("origin") ?? ""
  let needsConfirmation = false
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { first_name: firstName }, emailRedirectTo: `${origin}/auth/callback` },
    })
    if (error) {
      return { error: (error.code && signUpErrors[error.code]) || "We couldn't create your account. Please try again." }
    }
    // With email confirmation on, an existing address comes back with no identities
    // (Supabase doesn't reveal whether the email is registered).
    if (data.user && data.user.identities?.length === 0) {
      return { notice: "Check your email to finish signing up, then log in." }
    }
    if (data.user) await ensureProfile(getDb(), data.user.id, firstName)
    needsConfirmation = !data.session
  } catch (error) {
    logger.error("auth", "sign-up failed", { name: error instanceof Error ? error.name : typeof error })
    return { error: "We couldn't create your account right now. Please try again." }
  }

  if (needsConfirmation) return { notice: "Check your email to confirm your account, then log in." }
  // New accounts start with onboarding.
  redirect("/onboarding")
}

export async function logInAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const parsed = logInSchema.safeParse(Object.fromEntries(formData))
  if (!parsed.success) return { error: parsed.error.issues[0]?.message }

  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signInWithPassword(parsed.data)
    if (error) {
      if (error.code === "email_not_confirmed") return { error: "Confirm your email first, then log in." }
      if (error.code === "over_request_rate_limit") return { error: "Too many attempts. Please wait a minute." }
      return { error: "Email or password is incorrect." }
    }
    // Accounts created outside the app (e.g. in the Supabase dashboard) get a profile too.
    const firstName = data.user.user_metadata?.first_name
    await ensureProfile(getDb(), data.user.id, typeof firstName === "string" ? firstName : "")
  } catch (error) {
    logger.error("auth", "log-in failed", { name: error instanceof Error ? error.name : typeof error })
    return { error: "We couldn't log you in right now. Please try again." }
  }
  redirect(safeNext(formData.get("next")))
}

export async function logOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch (error) {
    logger.error("auth", "log-out failed", { name: error instanceof Error ? error.name : typeof error })
  }
  redirect("/login")
}

// ---- Google / Microsoft / Apple

// "Continue with Google" (sign in, or sign up: new students then go through
// onboarding). Sends the browser to the provider; Supabase handles state and
// PKCE, and the provider sends the student back to /auth/callback.
export async function continueWithProviderAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const provider = formData.get("provider")
  if (!isSocialProvider(provider)) return { error: authErrorMessages.failed }
  if (!(await enabledSocialProviders()).includes(provider)) return { error: authErrorMessages["not-configured"] }

  let url: string
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: socialProviders[provider].supabaseId,
      options: { redirectTo: await authCallbackUrl(), scopes: socialProviders[provider].scopes, skipBrowserRedirect: true },
    })
    if (error || !data.url) return { error: authErrorMessages[authErrorFromCode(error?.code)] }
    url = data.url
    await rememberAuthIntent({ kind: "sign-in", next: safeNextPath(formData.get("next")) ?? undefined })
  } catch (error) {
    logger.error("auth", "social sign-in failed to start", { provider, name: error instanceof Error ? error.name : typeof error })
    return { error: authErrorMessages.unavailable }
  }
  redirect(url)
}

// Settings > Account: add Google / Microsoft / Apple to the signed-in account.
// Only a signed-in student can add a login method, so nobody can claim an
// account just by having the same email address.
export async function linkLoginMethodAction(_previous: AuthFormState, formData: FormData): Promise<AuthFormState> {
  const provider = formData.get("provider")
  if (!isSocialProvider(provider)) return { error: authErrorMessages.failed }
  if (!(await getCurrentUser())) redirect("/login?next=/settings")
  if (!(await enabledSocialProviders()).includes(provider)) return { error: authErrorMessages["not-configured"] }

  let url: string
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.linkIdentity({
      provider: socialProviders[provider].supabaseId,
      options: { redirectTo: await authCallbackUrl(), scopes: socialProviders[provider].scopes, skipBrowserRedirect: true },
    })
    if (error || !data.url) {
      if (error?.code === "manual_linking_disabled") return { error: "Adding login methods isn't turned on for this Student OS server yet." }
      return { error: authErrorMessages[authErrorFromCode(error?.code)] }
    }
    url = data.url
    await rememberAuthIntent({ kind: "link", provider })
  } catch (error) {
    logger.error("auth", "linking failed to start", { provider, name: error instanceof Error ? error.name : typeof error })
    return { error: authErrorMessages.unavailable }
  }
  redirect(url)
}

// Settings > Account: remove a login method. The last one can't be removed (the
// student would be locked out), and only the signed-in student's own.
export async function unlinkLoginMethodAction(identityId: unknown): Promise<ActionResult<null>> {
  if (typeof identityId !== "string" || !identityId) return { ok: false, code: "validation", error: "That login method wasn't found." }
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.getUserIdentities()
    if (error || !data) return { ok: false, code: "unauthorized", error: "Your session has expired. Please log in again." }
    const identity = data.identities.find((item) => item.identity_id === identityId)
    if (!identity) return { ok: false, code: "not-found", error: "That login method wasn't found." }
    if (data.identities.length < 2) {
      return { ok: false, code: "validation", error: "This is your only way to log in. Add another method before removing it." }
    }
    const result = await supabase.auth.unlinkIdentity(identity)
    if (result.error) return { ok: false, code: "database", error: "We couldn't remove that login method. Please try again." }
    return { ok: true, data: null }
  } catch (error) {
    logger.error("auth", "unlink failed", { name: error instanceof Error ? error.name : typeof error })
    return { ok: false, code: "database", error: "We couldn't remove that login method. Please try again." }
  }
}
