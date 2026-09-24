"use client"

import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { ArrowUpIcon, CheckIcon, Loader2Icon, RotateCcwIcon, XIcon } from "lucide-react"
import { askAssistantAction, confirmAssistantAction } from "@/app/actions/assistant"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Textarea } from "@/components/ui/textarea"
import { useAppStore } from "@/lib/app-store"
import {
  ASSISTANT_ERROR_MESSAGE,
  MAX_HISTORY,
  MAX_MESSAGE_LENGTH,
  type AssistantPageContext,
  type ChatTurn,
  type PendingAction,
} from "@/lib/assistant"
import { formatRelativeDay, fromDateKey } from "@/lib/format"
import { cn } from "@/lib/utils"

// The Assistant page: a conversation with Student OS about the student's own
// plan, deadlines and schedule. Answers come from the server (the Assistant
// service and its tools); this component only shows them. A change the
// Assistant proposes is saved only when the student presses Confirm (or types
// "yes" while it's waiting).
//
// The conversation is kept for this browser tab (sessionStorage), so leaving
// the page and coming back doesn't lose it.

type Entry = {
  id: string
  role: "user" | "assistant"
  content: string
  pending?: PendingAction
  // What happened to the proposal.
  outcome?: "confirmed" | "cancelled" | "failed"
}

type Saved = { entries: Entry[]; focusTaskId?: string }

const STORAGE_KEY = "student-os.assistant"
const YES = /^(yes|yeah|yep|yup|y|sure|ok|okay|confirm|do it|go ahead|please do)[\s.!]*$/i
const NO = /^(no|nope|n|cancel|don'?t|stop|never ?mind)[\s.!]*$/i

const SUGGESTIONS = [
  "What should I work on right now?",
  "What do I have due this week?",
  "Why am I behind?",
  "How busy is my week?",
  "Show me my most important deadlines.",
  "I have one hour tonight. What should I work on?",
]

function load(): Saved {
  try {
    const saved = JSON.parse(sessionStorage.getItem(STORAGE_KEY) ?? "null") as Saved | null
    return saved && Array.isArray(saved.entries) ? saved : { entries: [] }
  } catch {
    return { entries: [] }
  }
}

function store(saved: Saved) {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(saved))
  } catch {
    // Private mode or storage full: the conversation just isn't kept.
  }
}

const newId = () => crypto.randomUUID()

export function AssistantView({ initialContext }: { initialContext: AssistantPageContext }) {
  const router = useRouter()
  const { tasks, today, applySaved } = useAppStore()
  const [saved] = useState(load)
  const [entries, setEntries] = useState<Entry[]>(saved.entries)
  const [focusTaskId, setFocusTaskId] = useState<string | undefined>(initialContext.taskId ?? saved.focusTaskId)
  const [context, setContext] = useState<AssistantPageContext>(initialContext)
  const [draft, setDraft] = useState("")
  const [busy, setBusy] = useState<"thinking" | "saving" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const endRef = useRef<HTMLDivElement>(null)

  const contextTask = context.taskId ? tasks.find((task) => task.id === context.taskId) : undefined
  const open = [...entries].reverse().find((entry) => entry.pending && !entry.outcome)

  useEffect(() => {
    store({ entries, focusTaskId })
  }, [entries, focusTaskId])
  // (In braces: newer browsers return a promise from scrollIntoView, which React would take as a cleanup.)
  useEffect(() => {
    endRef.current?.scrollIntoView({ block: "end", behavior: "smooth" })
  }, [entries.length, busy, error])

  async function ask(history: Entry[]) {
    setBusy("thinking")
    setError(null)
    const messages: ChatTurn[] = history.slice(-MAX_HISTORY).map(({ role, content }) => ({ role, content }))
    const result = await askAssistantAction({ messages, context, focusTaskId }).catch(() => null)
    setBusy(null)
    if (result?.ok) {
      setEntries((prev) => [...prev, { id: newId(), role: "assistant", content: result.data.message, pending: result.data.pending }])
      if (result.data.focusTaskId) setFocusTaskId(result.data.focusTaskId)
    } else if (result?.code === "unauthorized") {
      router.push("/login")
    } else {
      setError(result?.code === "validation" ? result.error : ASSISTANT_ERROR_MESSAGE)
    }
  }

  function send(text: string) {
    const content = text.trim()
    if (!content || busy) return
    setDraft("")
    const user: Entry = { id: newId(), role: "user", content }
    // A short "yes" / "no" answers the change that's waiting.
    if (open && YES.test(content)) return confirm(open, user)
    if (open && NO.test(content)) return cancel(open, user)
    // Anything else leaves an open proposal behind.
    const next = [...entries.map((e) => (e === open ? { ...e, outcome: "cancelled" as const } : e)), user]
    setEntries(next)
    void ask(next)
  }

  async function confirm(entry: Entry, user?: Entry) {
    if (!entry.pending || busy) return
    setEntries((prev) => (user ? [...prev, user] : prev))
    setBusy("saving")
    setError(null)
    const result = await confirmAssistantAction(entry.pending.action).catch(() => null)
    setBusy(null)
    if (result && !result.ok && result.code === "unauthorized") return router.push("/login")
    if (result?.ok) applySaved(result.data)
    const reply = result?.ok ? result.data.message : result?.code === "validation" || result?.code === "not-found" ? result.error : ASSISTANT_ERROR_MESSAGE
    setEntries((prev) => [
      ...prev.map((e) => (e.id === entry.id ? { ...e, outcome: result?.ok ? ("confirmed" as const) : ("failed" as const) } : e)),
      { id: newId(), role: "assistant", content: result?.ok ? reply : `I couldn't save that: ${reply}` },
    ])
  }

  function cancel(entry: Entry, user?: Entry) {
    setEntries((prev) => [
      ...prev.map((e) => (e.id === entry.id ? { ...e, outcome: "cancelled" as const } : e)),
      ...(user ? [user] : []),
      { id: newId(), role: "assistant", content: "Okay, I didn't change anything." },
    ])
  }

  function retry() {
    if (entries.at(-1)?.role === "user") void ask(entries)
  }

  function startOver() {
    setEntries([])
    setFocusTaskId(undefined)
    setContext({})
    setError(null)
    setDraft("")
  }

  const suggestions = contextTask ? [`How much work is left on ${contextTask.title}?`, ...SUGGESTIONS.slice(0, 5)] : SUGGESTIONS

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Assistant</h1>
          <p className="mt-1.5 text-muted-foreground">
            Ask about your plan, deadlines and schedule. Answers come from your Student OS data and your Planner.
          </p>
        </div>
        {entries.length > 0 && (
          <Button variant="outline" onClick={startOver} disabled={busy !== null}>
            <RotateCcwIcon data-icon="inline-start" />
            New conversation
          </Button>
        )}
      </header>

      {(contextTask || context.date) && (
        <p className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/50 py-0.5 pr-1 pl-3">
            <span className="truncate">
              {contextTask
                ? `About: ${contextTask.title}`
                : `From your plan for ${formatRelativeDay(fromDateKey(context.date!), fromDateKey(today)).toLowerCase()}`}
            </span>
            <button
              type="button"
              aria-label="Remove context"
              onClick={() => {
                setContext({})
                setFocusTaskId(undefined)
              }}
              className="rounded-full p-1 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <XIcon aria-hidden className="size-3.5" />
            </button>
          </span>
        </p>
      )}

      <Card className="gap-0 p-0">
        <div className="min-h-[18rem] space-y-4 p-4 sm:p-6" aria-live="polite" aria-busy={busy !== null}>
          {entries.length === 0 && !busy && (
            <div>
              <p className="text-sm font-medium">Try asking</p>
              <ul className="mt-3 grid gap-2 sm:grid-cols-2">
                {suggestions.map((suggestion) => (
                  <li key={suggestion}>
                    <button
                      type="button"
                      onClick={() => send(suggestion)}
                      className="w-full rounded-lg border px-3 py-2.5 text-left text-sm transition-colors outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                      {suggestion}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {entries.map((entry) =>
            entry.role === "user" ? (
              <div key={entry.id} className="flex justify-end">
                <p className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm whitespace-pre-wrap text-primary-foreground">
                  <span className="sr-only">You: </span>
                  {entry.content}
                </p>
              </div>
            ) : (
              <div key={entry.id} className="max-w-[92%] space-y-2">
                <p className="text-sm leading-relaxed whitespace-pre-wrap">
                  <span className="sr-only">Student OS: </span>
                  {entry.content}
                </p>
                {entry.pending && (
                  <ProposalCard
                    pending={entry.pending}
                    outcome={entry.outcome}
                    saving={busy === "saving" && entry === open}
                    disabled={busy !== null}
                    onConfirm={() => confirm(entry)}
                    onCancel={() => cancel(entry)}
                  />
                )}
              </div>
            )
          )}

          {busy === "thinking" && (
            <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2Icon aria-hidden className="size-4 animate-spin" />
              Checking Student OS…
            </p>
          )}
          {error && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm">
              <span className="text-destructive">{error}</span>
              {entries.at(-1)?.role === "user" && (
                <Button size="sm" variant="outline" onClick={retry}>
                  Try again
                </Button>
              )}
            </div>
          )}
          <div ref={endRef} />
        </div>

        <form
          className="flex items-end gap-2 border-t p-3 sm:p-4"
          onSubmit={(event) => {
            event.preventDefault()
            send(draft)
          }}
        >
          <label htmlFor="assistant-input" className="sr-only">
            Message Student OS
          </label>
          <Textarea
            id="assistant-input"
            rows={1}
            value={draft}
            maxLength={MAX_MESSAGE_LENGTH}
            placeholder={open ? "Type yes to confirm, or ask something else" : "Ask about your plan, tasks or schedule"}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault()
                send(draft)
              }
            }}
            className="max-h-40 min-h-10 resize-none"
          />
          <Button type="submit" size="icon" aria-label="Send" disabled={!draft.trim() || busy !== null}>
            <ArrowUpIcon />
          </Button>
        </form>
      </Card>
      <p className="text-xs text-muted-foreground">
        The Assistant reads your Student OS data and explains your Planner. It only changes something after you confirm.
      </p>
    </div>
  )
}

function ProposalCard({
  pending,
  outcome,
  saving,
  disabled,
  onConfirm,
  onCancel,
}: {
  pending: PendingAction
  outcome?: Entry["outcome"]
  saving: boolean
  disabled: boolean
  onConfirm: () => void
  onCancel: () => void
}) {
  return (
    <div className={cn("rounded-lg border p-3 text-sm", !outcome && "border-primary/40 bg-primary/5")}>
      <p className="font-medium">{pending.summary}</p>
      {pending.note && <p className="mt-1 text-warning">{pending.note}</p>}
      {outcome ? (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          {outcome === "confirmed" ? <CheckIcon aria-hidden className="size-3.5" /> : <XIcon aria-hidden className="size-3.5" />}
          {outcome === "confirmed" ? "Confirmed" : outcome === "cancelled" ? "Not changed" : "Couldn't save"}
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          <Button size="sm" onClick={onConfirm} disabled={disabled}>
            {saving ? <Loader2Icon data-icon="inline-start" className="animate-spin" /> : <CheckIcon data-icon="inline-start" />}
            {pending.confirmLabel}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={disabled}>
            Cancel
          </Button>
        </div>
      )}
    </div>
  )
}
