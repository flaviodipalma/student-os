"use client"

import { useActionState, useState } from "react"
import Link from "next/link"
import { CircleAlertIcon, MailIcon } from "lucide-react"
import { logInAction, signUpAction, type AuthFormState } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import type { SocialProviderId } from "@/lib/auth-providers"
import { SocialButtons } from "./social-buttons"

// Log in / sign up: Google, Microsoft and Apple first (the ones this server has
// set up), then email and password. Every method leads to the same kind of
// Student OS account; new accounts go through onboarding.
export function AuthForm({
  mode,
  next,
  notice,
  error,
  providers = [],
}: {
  mode: "login" | "signup"
  next?: string
  notice?: string
  // Why the last sign-in didn't work (from the callback), already in plain words.
  error?: string
  providers?: SocialProviderId[]
}) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(
    mode === "login" ? logInAction : signUpAction,
    {}
  )
  const isSignup = mode === "signup"
  // Kept in state so what the student typed survives a failed attempt.
  const [firstName, setFirstName] = useState("")
  const [email, setEmail] = useState("")

  return (
    <div>
      <h1 className="text-xl font-semibold tracking-tight">{isSignup ? "Create your Student OS account" : "Welcome back"}</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        {isSignup ? "Your courses, deadlines and plan, in one place." : "Log in to see what's next today."}
      </p>

      {(state.notice ?? notice) && (
        <p role="status" className="mt-4 flex items-start gap-2 rounded-lg bg-primary/10 px-3 py-2 text-sm text-primary">
          <MailIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.notice ?? notice}
        </p>
      )}

      {error && !state.error && (
        <p role="alert" className="mt-4 flex items-start gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {error}
        </p>
      )}

      {providers.length > 0 && (
        <>
          <div className="mt-6">
            <SocialButtons providers={providers} next={next} />
          </div>
          <div className="mt-6 flex items-center gap-3 text-xs text-muted-foreground">
            <span className="h-px flex-1 bg-border" />
            {isSignup ? "or create an account with email" : "or continue with email"}
            <span className="h-px flex-1 bg-border" />
          </div>
        </>
      )}

      <form action={formAction} className={providers.length > 0 ? "mt-4 grid gap-4" : "mt-6 grid gap-4"}>
        {next && <input type="hidden" name="next" value={next} />}
        {isSignup && (
          <div className="grid gap-1.5">
            <Label htmlFor="firstName">First name</Label>
            <Input
              id="firstName"
              name="firstName"
              autoComplete="given-name"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
              required
            />
          </div>
        )}
        <div className="grid gap-1.5">
          <Label htmlFor="email">Email</Label>
          <Input
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="password">Password</Label>
          <Input
            id="password"
            name="password"
            type="password"
            autoComplete={isSignup ? "new-password" : "current-password"}
            minLength={isSignup ? 8 : undefined}
            required
          />
          {isSignup && <p className="text-xs text-muted-foreground">At least 8 characters.</p>}
        </div>

        {state.error && (
          <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {state.error}
          </p>
        )}

        <Button type="submit" size="lg" disabled={pending}>
          {pending ? (isSignup ? "Creating account…" : "Logging in…") : isSignup ? "Create account with email" : "Log in"}
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-muted-foreground">
        {isSignup ? "Already have an account? " : "New to Student OS? "}
        <Link href={isSignup ? "/login" : "/signup"} className="font-medium text-primary hover:underline">
          {isSignup ? "Log in" : "Create an account"}
        </Link>
      </p>
    </div>
  )
}
