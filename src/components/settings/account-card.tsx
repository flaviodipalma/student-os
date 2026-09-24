"use client"

import { useActionState, useState } from "react"
import { useRouter } from "next/navigation"
import { CircleAlertIcon, CircleCheckIcon, KeyRoundIcon, Loader2Icon, LogOutIcon } from "lucide-react"
import { linkLoginMethodAction, logOutAction, unlinkLoginMethodAction, type AuthFormState } from "@/app/actions/auth"
import { ProviderIcon } from "@/components/auth/social-buttons"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppStore } from "@/lib/app-store"
import { authErrorMessages, isAuthErrorCode, isPrivateRelayEmail, socialProviderIds, socialProviders, type SocialProviderId } from "@/lib/auth-providers"
import type { AccountDetails, LoginMethod } from "@/server/social-auth"

// Settings > Account: profile, login methods and log out. Login methods are
// ways to sign in to this one Student OS account (same data whichever is used);
// they're not calendar connections (those are under Integrations).

export function AccountCard({
  account,
  available,
  outcome,
}: {
  account: AccountDetails | null
  // Login methods this server has set up (others can't be added yet).
  available: SocialProviderId[]
  // Back from adding a login method: ?login=linked&provider=google, or an error code.
  outcome?: { code: string; provider?: string }
}) {
  const { student } = useAppStore()
  const name = [student.firstName, student.lastName].filter(Boolean).join(" ")
  const created = account?.createdAt ? new Date(account.createdAt).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" }) : null
  const methods = account?.loginMethods ?? []
  const byMethod = (method: LoginMethod["method"]) => methods.find((m) => m.method === method)
  const email = byMethod("email")

  const banner =
    outcome?.code === "linked"
      ? { tone: "success" as const, text: `${socialProviders[outcome.provider as SocialProviderId]?.name ?? "That login method"} is now a way to log in to your account.` }
      : outcome && isAuthErrorCode(outcome.code)
        ? { tone: "error" as const, text: authErrorMessages[outcome.code] }
        : null

  return (
    <Card id="account">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Account</CardTitle>
        <CardDescription>Your profile and the ways you can log in.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <dl className="grid gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Name</dt>
            <dd className="font-medium break-words">{name || "Not set"}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Email</dt>
            <dd className="font-medium break-all">{account?.email ?? "Not available"}</dd>
            {isPrivateRelayEmail(account?.email) && <dd className="text-xs text-muted-foreground">Apple private relay address (forwards to you)</dd>}
          </div>
          <div>
            <dt className="text-muted-foreground">Member since</dt>
            <dd className="font-medium">{created ?? "Not available"}</dd>
          </div>
        </dl>

        <section aria-labelledby="login-methods-heading" className="space-y-3">
          <div>
            <h3 id="login-methods-heading" className="text-sm font-semibold">
              Login methods
            </h3>
            <p className="text-sm text-muted-foreground">
              Log in with any of these; it&apos;s always the same account and data. They don&apos;t connect your calendar.
            </p>
          </div>
          {banner && (
            <p
              role={banner.tone === "error" ? "alert" : "status"}
              className={
                banner.tone === "error"
                  ? "flex items-start gap-2 rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger"
                  : "flex items-start gap-2 rounded-lg bg-success-soft px-3 py-2 text-sm text-success"
              }
            >
              {banner.tone === "error" ? <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" /> : <CircleCheckIcon aria-hidden className="mt-0.5 size-4 shrink-0" />}
              {banner.text}
            </p>
          )}
          {!account ? (
            <p role="alert" className="text-sm text-destructive">
              We couldn&apos;t load your login methods. Please reload the page.
            </p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {email && (
                <MethodRow icon={<KeyRoundIcon aria-hidden className="size-4" />} name="Email and password" detail={email.email} method={email} canRemove={methods.length > 1} />
              )}
              {socialProviderIds.map((provider) => {
                const connected = byMethod(provider)
                return connected ? (
                  <MethodRow
                    key={provider}
                    icon={<ProviderIcon provider={provider} />}
                    name={socialProviders[provider].name}
                    detail={isPrivateRelayEmail(connected.email) ? "Private relay address" : connected.email}
                    method={connected}
                    canRemove={methods.length > 1}
                  />
                ) : (
                  <ConnectRow key={provider} provider={provider} available={available.includes(provider)} />
                )
              })}
            </ul>
          )}
        </section>

        <form action={logOutAction}>
          <Button type="submit" variant="outline">
            <LogOutIcon data-icon="inline-start" />
            Log out
          </Button>
        </form>
      </CardContent>
    </Card>
  )
}

function MethodRow({
  icon,
  name,
  detail,
  method,
  canRemove,
}: {
  icon: React.ReactNode
  name: string
  detail: string | null
  method: LoginMethod
  canRemove: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function remove() {
    setWorking(true)
    setError(null)
    const result = await unlinkLoginMethodAction(method.identityId).catch(() => null)
    setWorking(false)
    if (result?.ok) router.refresh()
    else setError(result?.error ?? "We couldn't remove that login method. Please try again.")
  }

  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {name} <span className="ml-1 text-xs font-normal text-success">Connected</span>
        </p>
        {detail && <p className="truncate text-xs text-muted-foreground">{detail}</p>}
        {error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {error}
          </p>
        )}
      </div>
      {canRemove && (
        <Button variant="ghost" size="sm" onClick={() => setOpen(true)} disabled={working} aria-label={`Remove ${name}`}>
          {working && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
          Remove
        </Button>
      )}
      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {name}?</AlertDialogTitle>
            <AlertDialogDescription>
              You won&apos;t be able to log in with {name} anymore. Your account and everything in it stay the same, and you can
              still log in with your other methods.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={remove}>
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </li>
  )
}

function ConnectRow({ provider, available }: { provider: SocialProviderId; available: boolean }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(linkLoginMethodAction, {})
  const name = socialProviders[provider].name
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-3">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-background">
        <ProviderIcon provider={provider} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">
          {name} <span className="ml-1 text-xs font-normal text-muted-foreground">{available ? "Not connected" : "Not available yet"}</span>
        </p>
        {state.error && (
          <p role="alert" className="mt-1 text-xs text-destructive">
            {state.error}
          </p>
        )}
      </div>
      {available && (
        <form action={formAction}>
          <input type="hidden" name="provider" value={provider} />
          <Button type="submit" variant="outline" size="sm" disabled={pending} aria-label={`Connect ${name}`}>
            {pending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
            Connect
          </Button>
        </form>
      )}
    </li>
  )
}
