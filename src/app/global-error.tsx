"use client"

import "./globals.css"
import { THEME_SCRIPT } from "@/lib/theme"

// The last line of defense: the root layout itself failed, so this page brings
// its own document (and the theme, so it isn't a white flash in dark mode). No
// details are shown; the reference matches the server log (onRequestError).
export default function GlobalError({ error, retry }: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
        <title>Something went wrong · Student OS</title>
      </head>
      <body className="flex min-h-svh items-center justify-center bg-background px-4 font-sans text-foreground antialiased">
        <main className="max-w-sm space-y-4 text-center">
          <h1 className="text-xl font-semibold tracking-tight">Student OS couldn&apos;t load</h1>
          <p className="text-sm text-muted-foreground">
            Something went wrong on our side. Your data is safe. Please try again in a moment.
          </p>
          <button
            type="button"
            onClick={() => retry()}
            className="inline-flex h-9 items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground outline-none hover:bg-primary-hover focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            Try again
          </button>
          {error.digest && <p className="text-xs text-subtle-foreground">Reference: {error.digest}</p>}
        </main>
      </body>
    </html>
  )
}
