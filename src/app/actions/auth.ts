"use server"

import { headers } from "next/headers"
import { redirect } from "next/navigation"
import { z } from "zod"
import { createSupabaseServerClient } from "@/server/auth"
import { getDb } from "@/server/db"
import { ensureProfile } from "@/server/services/profiles"

// Sign up, log in and log out, using Supabase Auth (email + password).

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
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") ? value : "/dashboard"
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
    console.error("[auth] sign-up failed", { name: error instanceof Error ? error.name : typeof error })
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
    console.error("[auth] log-in failed", { name: error instanceof Error ? error.name : typeof error })
    return { error: "We couldn't log you in right now. Please try again." }
  }
  redirect(safeNext(formData.get("next")))
}

export async function logOutAction(): Promise<void> {
  try {
    const supabase = await createSupabaseServerClient()
    await supabase.auth.signOut()
  } catch (error) {
    console.error("[auth] log-out failed", { name: error instanceof Error ? error.name : typeof error })
  }
  redirect("/login")
}
