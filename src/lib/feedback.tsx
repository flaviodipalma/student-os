"use client"

import { createContext, use, useCallback, useEffect, useState } from "react"
import { CircleAlertIcon, XIcon } from "lucide-react"

// A small message at the bottom of the screen, used when saving something fails.

type Feedback = { showError: (message: string) => void }

const FeedbackContext = createContext<Feedback | null>(null)

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<string | null>(null)
  const showError = useCallback((next: string) => setMessage(next), [])

  useEffect(() => {
    if (!message) return
    const timer = setTimeout(() => setMessage(null), 7000)
    return () => clearTimeout(timer)
  }, [message])

  return (
    <FeedbackContext value={{ showError }}>
      {children}
      <div aria-live="assertive" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex justify-center px-4">
        {message && (
          <div
            role="alert"
            className="pointer-events-auto flex max-w-md items-start gap-2 rounded-lg bg-foreground px-4 py-3 text-sm text-background shadow-lg"
          >
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            <span className="flex-1">{message}</span>
            <button type="button" onClick={() => setMessage(null)} aria-label="Dismiss" className="opacity-70 hover:opacity-100">
              <XIcon className="size-4" />
            </button>
          </div>
        )}
      </div>
    </FeedbackContext>
  )
}

export function useFeedback(): Feedback {
  const feedback = use(FeedbackContext)
  if (!feedback) throw new Error("useFeedback must be used inside FeedbackProvider")
  return feedback
}
