"use client"

import { useEffect } from "react"
import { CircleAlertIcon } from "lucide-react"
import { Button } from "@/components/ui/button"

// What a student sees if a page crashes unexpectedly: a plain message and a way
// to try again. Technical details stay out of the page (they're in the console
// and, for server errors, the server logs under `digest`).
export function ErrorPanel({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  useEffect(() => {
    console.error("[app] page error", error.digest ?? error.name)
  }, [error])

  return (
    <div role="alert" className="mx-auto max-w-sm rounded-xl bg-card p-8 text-center ring-1 ring-border">
      <CircleAlertIcon aria-hidden className="mx-auto size-8 text-muted-foreground" />
      <h1 className="mt-4 text-lg font-semibold">Something went wrong</h1>
      <p className="mt-1 text-sm text-muted-foreground">
        This page couldn&apos;t be shown. Your data is safe. Please try again.
      </p>
      <Button className="mt-5" onClick={() => retry()}>
        Try again
      </Button>
    </div>
  )
}
