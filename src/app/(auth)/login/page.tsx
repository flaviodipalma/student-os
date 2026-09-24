import type { Metadata } from "next"
import { connection } from "next/server"
import { AuthForm } from "@/components/auth/auth-form"
import { authErrorMessages, isAuthErrorCode } from "@/lib/auth-providers"
import { visibleSocialProviders } from "@/server/social-auth"

export const metadata: Metadata = { title: "Log in" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  // Per request: which sign-in methods are on can change.
  await connection()
  const { next, error } = await searchParams
  // ?error=<code> from the sign-in callback: a known code, shown in plain words.
  const message = isAuthErrorCode(error) ? authErrorMessages[error] : undefined
  return (
    <AuthForm
      mode="login"
      next={typeof next === "string" ? next : undefined}
      error={message}
      providers={await visibleSocialProviders()}
    />
  )
}
