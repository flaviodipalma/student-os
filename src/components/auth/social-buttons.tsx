"use client"

import { useActionState, useState } from "react"
import { CircleAlertIcon, Loader2Icon } from "lucide-react"
import { continueWithProviderAction, type AuthFormState } from "@/app/actions/auth"
import { Button } from "@/components/ui/button"
import { socialProviders, type SocialProviderId } from "@/lib/auth-providers"

// "Continue with Google / Microsoft / Apple". Each button posts to a server
// action that sends the browser to the provider (through Supabase). The same
// buttons sign in existing students and sign up new ones.

export function ProviderIcon({ provider, className = "size-4" }: { provider: SocialProviderId; className?: string }) {
  if (provider === "google") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className={className}>
        <path fill="#4285F4" d="M23.5 12.3c0-.8-.1-1.6-.2-2.3H12v4.5h6.5a5.6 5.6 0 0 1-2.4 3.6v3h3.9c2.3-2.1 3.5-5.2 3.5-8.8z" />
        <path fill="#34A853" d="M12 24c3.2 0 6-1.1 8-2.9l-3.9-3c-1.1.7-2.5 1.2-4.1 1.2-3.1 0-5.8-2.1-6.7-5H1.3v3.1A12 12 0 0 0 12 24z" />
        <path fill="#FBBC05" d="M5.3 14.3a7.2 7.2 0 0 1 0-4.6V6.6h-4a12 12 0 0 0 0 10.8l4-3.1z" />
        <path fill="#EA4335" d="M12 4.8c1.8 0 3.3.6 4.6 1.8l3.4-3.4A12 12 0 0 0 1.3 6.6l4 3.1c.9-2.9 3.6-4.9 6.7-4.9z" />
      </svg>
    )
  }
  if (provider === "microsoft") {
    return (
      <svg aria-hidden viewBox="0 0 24 24" className={className}>
        <path fill="#F25022" d="M1 1h10.5v10.5H1z" />
        <path fill="#7FBA00" d="M12.5 1H23v10.5H12.5z" />
        <path fill="#00A4EF" d="M1 12.5h10.5V23H1z" />
        <path fill="#FFB900" d="M12.5 12.5H23V23H12.5z" />
      </svg>
    )
  }
  return (
    <svg aria-hidden viewBox="0 0 24 24" className={className} fill="currentColor">
      <path d="M16.4 12.7c0-2.6 2.1-3.8 2.2-3.9-1.2-1.8-3.1-2-3.7-2-1.6-.2-3.1.9-3.9.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.5-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.3.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.7-1-2.7-4zM13.9 5.1c.7-.9 1.2-2 1-3.2-1 0-2.3.7-3 1.6-.7.8-1.3 2-1.1 3.1 1.2.1 2.3-.6 3.1-1.5z" />
    </svg>
  )
}

export function SocialButtons({ providers, next }: { providers: SocialProviderId[]; next?: string }) {
  const [state, formAction, pending] = useActionState<AuthFormState, FormData>(continueWithProviderAction, {})
  const [chosen, setChosen] = useState<SocialProviderId | null>(null)
  if (providers.length === 0) return null

  return (
    <div className="grid gap-2.5">
      {providers.map((provider) => (
        <form key={provider} action={formAction} onSubmit={() => setChosen(provider)}>
          <input type="hidden" name="provider" value={provider} />
          {next && <input type="hidden" name="next" value={next} />}
          <Button type="submit" variant="outline" size="lg" className="w-full" disabled={pending}>
            {pending && chosen === provider ? (
              <Loader2Icon data-icon="inline-start" className="animate-spin" />
            ) : (
              <ProviderIcon provider={provider} />
            )}
            {pending && chosen === provider ? `Opening ${socialProviders[provider].name}…` : `Continue with ${socialProviders[provider].name}`}
          </Button>
        </form>
      ))}
      {state.error && (
        <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
          <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
          {state.error}
        </p>
      )}
    </div>
  )
}
