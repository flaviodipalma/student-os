"use client"

import { ErrorPanel } from "@/components/app-shell/error-panel"

// Anything else that crashes (including the signed-in app's layout).
export default function RootError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <ErrorPanel {...props} />
    </main>
  )
}
