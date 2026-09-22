import type { Metadata } from "next"
import { AuthForm } from "@/components/auth/auth-form"

export const metadata: Metadata = { title: "Log in" }

export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const { next, error } = await searchParams
  const notice = error === "confirmation" ? "That confirmation link didn't work. Try logging in, or sign up again." : undefined
  return <AuthForm mode="login" next={typeof next === "string" ? next : undefined} notice={notice} />
}
