// Login methods for Student OS accounts (authentication only).
//
// Signing in with Google, Microsoft or Apple proves who the student is; it does
// NOT connect Google Calendar, Outlook or anything else. Calendar and LMS
// connections are separate (src/server/integrations) and are never requested here.
//
// Supabase Auth runs the OAuth / OpenID Connect flows (PKCE, state, token
// exchange) and keeps each login method as an "identity" of the one Supabase
// user, whose id is the Student OS user id. See docs/authentication.md.

export const socialProviderIds = ["google", "microsoft", "apple"] as const
export type SocialProviderId = (typeof socialProviderIds)[number]

export const socialProviders: Record<
  SocialProviderId,
  {
    name: string
    // Supabase's name for the provider ("azure" = Microsoft Entra ID / Microsoft accounts).
    supabaseId: "google" | "azure" | "apple"
    // Sign-in scopes only: who the student is, never calendar or mail access.
    scopes?: string
  }
> = {
  google: { name: "Google", supabaseId: "google" },
  // Microsoft needs "email" asked for explicitly (Supabase requires the address).
  microsoft: { name: "Microsoft", supabaseId: "azure", scopes: "openid email profile" },
  apple: { name: "Apple", supabaseId: "apple" },
}

export function isSocialProvider(value: unknown): value is SocialProviderId {
  return typeof value === "string" && (socialProviderIds as readonly string[]).includes(value)
}

// Supabase's identity provider name -> the login method students see.
export function loginMethodOf(supabaseProvider: string): SocialProviderId | "email" | null {
  if (supabaseProvider === "email") return "email"
  const found = socialProviderIds.find((id) => socialProviders[id].supabaseId === supabaseProvider)
  return found ?? null
}

// Apple's "Hide My Email" gives each app a relay address that forwards to the
// student. It's a real, working address, just not their personal one.
export function isPrivateRelayEmail(email: string | null | undefined): boolean {
  return Boolean(email && /@privaterelay\.appleid\.com$/i.test(email))
}

// A first name from what the provider shared (Google: given_name; Microsoft:
// name; Apple: often nothing after the first sign-in). Empty if unknown:
// onboarding asks for it.
export function firstNameFrom(metadata: Record<string, unknown> | undefined): string {
  if (!metadata) return ""
  const text = (key: string) => (typeof metadata[key] === "string" ? (metadata[key] as string).trim() : "")
  const first = text("first_name") || text("given_name")
  if (first) return first.slice(0, 80)
  const full = text("full_name") || text("name")
  // Not an email address used as a name.
  return full && !full.includes("@") ? full.split(/\s+/)[0].slice(0, 80) : ""
}

// Only paths inside this app (never "//evil.com" or "https://...").
export function safeNextPath(value: unknown): string | null {
  return typeof value === "string" && value.startsWith("/") && !value.startsWith("//") && !value.startsWith("/\\") ? value : null
}

// Why a sign-in didn't work, as a short code in the URL (?error=<code>), and
// what the student sees for it. Never provider messages, tokens or internals.
export const authErrorMessages = {
  confirmation: "That confirmation link didn't work. Try logging in, or sign up again.",
  cancelled: "Sign-in was cancelled. You can try again or use another method.",
  "not-configured": "That sign-in method isn't set up yet. Use another method for now.",
  unavailable: "The sign-in service didn't respond. Please try again in a moment.",
  expired: "That sign-in took too long or was already used. Please try again.",
  "email-exists":
    "An account with this email already exists. Log in with your usual method, then add this one in Settings → Account.",
  "already-used": "That account is already connected to a different Student OS account.",
  failed: "We couldn't sign you in. Please try again.",
} as const
export type AuthErrorCode = keyof typeof authErrorMessages

export function isAuthErrorCode(value: unknown): value is AuthErrorCode {
  return typeof value === "string" && value in authErrorMessages
}

// Supabase / OAuth error codes (from the callback URL or the code exchange) -> ours.
export function authErrorFromCode(code: string | null | undefined): AuthErrorCode {
  switch (code) {
    case "access_denied":
    case "user_cancelled_login":
    case "user_cancelled_authorize":
    case "consent_required":
      return "cancelled"
    case "identity_already_exists":
      return "already-used"
    case "email_exists":
    case "user_already_exists":
      return "email-exists"
    case "bad_oauth_state":
    case "bad_oauth_callback":
    case "flow_state_not_found":
    case "flow_state_expired":
    case "bad_code_verifier":
      return "expired"
    case "provider_disabled":
    case "oauth_provider_not_supported":
    case "manual_linking_disabled":
      return "not-configured"
    case "server_error":
    case "temporarily_unavailable":
    case "request_timeout":
      return "unavailable"
    default:
      return "failed"
  }
}
