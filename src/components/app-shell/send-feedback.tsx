"use client"

import { useState } from "react"
import { usePathname, useRouter } from "next/navigation"
import { Loader2Icon, MessageCircleHeartIcon } from "lucide-react"
import { sendFeedbackAction } from "@/app/actions/feedback"
import { Button } from "@/components/ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useFeedback } from "@/lib/feedback"
import { cn } from "@/lib/utils"

// "Send feedback" (beta): what kind, a message, and the page it's about (sent
// automatically, as a path only). Saved for the signed-in student.

const kinds = [
  { value: "bug", label: "Something's broken" },
  { value: "confusing", label: "Something's confusing" },
  { value: "idea", label: "An idea" },
  { value: "other", label: "Something else" },
] as const

export function SendFeedback({ onOpen }: { onOpen?: () => void }) {
  const pathname = usePathname()
  const router = useRouter()
  const { showSuccess } = useFeedback()
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState<(typeof kinds)[number]["value"]>("confusing")
  const [message, setMessage] = useState("")
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState(false)

  async function send(event: React.FormEvent) {
    event.preventDefault()
    if (!message.trim()) return setError("Write a few words first.")
    setSending(true)
    setError(null)
    const result = await sendFeedbackAction({ kind, message, page: pathname }).catch(() => null)
    setSending(false)
    if (result?.ok) {
      setOpen(false)
      setMessage("")
      showSuccess("Thanks! Your feedback was sent.")
    } else if (result?.code === "unauthorized") {
      router.push("/login")
    } else {
      setError(result?.error ?? "We couldn't send that. Check your connection and try again.")
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          onOpen?.()
          setOpen(true)
        }}
        className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground outline-none hover:bg-sidebar-accent/60 hover:text-sidebar-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
      >
        <MessageCircleHeartIcon aria-hidden className="size-4" />
        Send feedback
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <form onSubmit={send} noValidate className="grid gap-4">
            <DialogHeader>
              <DialogTitle>Send feedback</DialogTitle>
              <DialogDescription>
                Student OS is in beta, and this goes straight to the team. We&apos;ll also see which page you were on.
              </DialogDescription>
            </DialogHeader>
            <fieldset>
              <legend className="mb-2 text-sm font-medium">What is it about?</legend>
              <div className="grid grid-cols-2 gap-2">
                {kinds.map((option) => (
                  <label
                    key={option.value}
                    className={cn(
                      "flex min-h-10 cursor-pointer items-center justify-center rounded-lg border px-2 text-center text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                      kind === option.value ? "border-primary bg-primary-soft text-primary-soft-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    <input type="radio" name="feedback-kind" value={option.value} checked={kind === option.value} onChange={() => setKind(option.value)} className="sr-only" />
                    {option.label}
                  </label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-1.5">
              <Label htmlFor="feedback-message">Message</Label>
              <Textarea
                id="feedback-message"
                value={message}
                maxLength={2000}
                rows={5}
                onChange={(e) => setMessage(e.target.value)}
                placeholder="What happened, or what would make Student OS better for you?"
                aria-invalid={Boolean(error) || undefined}
                aria-describedby={error ? "feedback-error" : undefined}
              />
              {error && (
                <p id="feedback-error" role="alert" className="text-sm text-danger">
                  {error}
                </p>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button type="submit" disabled={sending}>
                {sending && <Loader2Icon data-icon="inline-start" className="animate-spin" />}
                {sending ? "Sending…" : "Send"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  )
}
