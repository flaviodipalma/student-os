import type { Metadata } from "next"
import { connection } from "next/server"
import { AuthForm } from "@/components/auth/auth-form"
import { visibleSocialProviders } from "@/server/social-auth"

export const metadata: Metadata = { title: "Sign up" }

export default async function SignupPage() {
  // Per request: which sign-in methods are on can change.
  await connection()
  return <AuthForm mode="signup" providers={await visibleSocialProviders()} />
}
