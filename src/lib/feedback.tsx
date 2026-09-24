"use client"

import { createContext, use, useCallback, useEffect, useState } from "react"
import { CircleAlertIcon, CircleCheckIcon, XIcon } from "lucide-react"
import { cn } from "@/lib/utils"

// A small message (toast) at the bottom of the screen:
// - showSuccess: a short confirmation once something important is saved
//   ("Task created."). Used sparingly, not for every click.
// - showError: saving failed; the change was undone.

type Toast = { kind: "success" | "error"; message: string; id: number }
type Feedback = { showError: (message: string) => void; showSuccess: (message: string) => void }

const FeedbackContext = createContext<Feedback | null>(null)

let nextId = 0

export function FeedbackProvider({ children }: { children: React.ReactNode }) {
  const [toast, setToast] = useState<Toast | null>(null)
  const showError = useCallback((message: string) => setToast({ kind: "error", message, id: ++nextId }), [])
  const showSuccess = useCallback((message: string) => setToast({ kind: "success", message, id: ++nextId }), [])

  useEffect(() => {
    if (!toast) return
    // Errors stay longer, so there's time to read them.
    const timer = setTimeout(() => setToast(null), toast.kind === "error" ? 7000 : 3000)
    return () => clearTimeout(timer)
  }, [toast])

  const Icon = toast?.kind === "error" ? CircleAlertIcon : CircleCheckIcon
  return (
    <FeedbackContext value={{ showError, showSuccess }}>
      {children}
      {/* Above the mobile tab bar. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-20 z-[60] flex justify-center px-4 lg:bottom-4">
        <div aria-live="polite" className="contents">
          {toast && (
            <div
              key={toast.id}
              role={toast.kind === "error" ? "alert" : "status"}
              className={cn(
                "pointer-events-auto flex max-w-md items-start gap-2 rounded-lg px-4 py-3 text-sm shadow-lg",
                toast.kind === "error" ? "bg-foreground text-background" : "bg-foreground text-background [&>svg:first-child]:text-success"
              )}
            >
              <Icon aria-hidden className="mt-0.5 size-4 shrink-0" />
              <span className="flex-1">{toast.message}</span>
              <button
                type="button"
                onClick={() => setToast(null)}
                aria-label="Dismiss"
                className="-m-1 rounded p-1 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-white/60"
              >
                <XIcon className="size-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </FeedbackContext>
  )
}

export function useFeedback(): Feedback {
  const feedback = use(FeedbackContext)
  if (!feedback) throw new Error("useFeedback must be used inside FeedbackProvider")
  return feedback
}
