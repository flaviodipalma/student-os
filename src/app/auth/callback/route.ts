import { NextResponse, type NextRequest } from "next/server"
import { authErrorFromCode, firstNameFrom, isSocialProvider, safeNextPath, type AuthErrorCode } from "@/lib/auth-providers"
import { createSupabaseServerClient } from "@/server/auth"
import { getDb } from "@/server/db"
import { ensureProfile, getProfile } from "@/server/services/profiles"
import { AUTH_INTENT_COOKIE, type AuthIntent } from "@/server/social-auth"

// Where Supabase sends the student back after:
//   - Google / Microsoft / Apple sign-in (or sign-up),
//   - adding one of those to their account (Settings > Account),
//   - the "confirm your email" link (when email confirmation is on).
// Exchanges the one-time code for a session (Supabase checks the OAuth state and
// the PKCE verifier), makes sure the Student OS profile exists, then opens
// onboarding (new students), the page they wanted, or Settings.

function readIntent(request: NextRequest): AuthIntent {
  try {
    const value = JSON.parse(request.cookies.get(AUTH_INTENT_COOKIE)?.value ?? "null") as AuthIntent | null
    if (value?.kind === "link" && isSocialProvider(value.provider)) return value
    if (value?.kind === "sign-in") return { kind: "sign-in", next: safeNextPath(value.next) ?? undefined }
  } catch {
    // A malformed cookie is treated as a plain sign-in.
  }
  return { kind: "sign-in" }
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams
  const intent = readIntent(request)
  const to = (path: string) => {
    const response = NextResponse.redirect(new URL(path, request.url))
    response.cookies.delete({ name: AUTH_INTENT_COOKIE, path: "/auth/callback" })
    return response
  }
  const fail = (code: AuthErrorCode) =>
    intent.kind === "link" ? to(`/settings?login=${code}#account`) : to(`/login?error=${code}`)

  // The provider or Supabase reported a problem (e.g. the student pressed Cancel).
  const providerError = params.get("error_code") ?? params.get("error")
  if (providerError) return fail(authErrorFromCode(providerError))

  const code = params.get("code")
  if (!code) return fail(intent.kind === "link" ? "failed" : "confirmation")

  let userId: string
  let firstName: string
  try {
    const supabase = await createSupabaseServerClient()
    const { data, error } = await supabase.auth.exchangeCodeForSession(code)
    if (error || !data.user) return fail(authErrorFromCode(error?.code))
    userId = data.user.id
    firstName = firstNameFrom(data.user.user_metadata)
  } catch (error) {
    console.error("[auth] callback failed", { name: error instanceof Error ? error.name : typeof error })
    return fail("unavailable")
  }

  // Added a login method: same user, same data; back to Settings.
  if (intent.kind === "link") return to(`/settings?login=linked&provider=${intent.provider}#account`)

  try {
    // First sign-in with a provider: the Student OS profile (same id as the
    // Supabase user, so all their data hangs off it). Never overwrites a name.
    const db = getDb()
    await ensureProfile(db, userId, firstName)
    const profile = await getProfile(db, userId)
    if (!profile.onboardingCompleted) return to("/onboarding")
  } catch (error) {
    console.error("[auth] couldn't prepare the profile", { name: error instanceof Error ? error.name : typeof error })
    // Signed in anyway; the app shows its own database message.
  }
  return to(intent.next ?? "/dashboard")
}
