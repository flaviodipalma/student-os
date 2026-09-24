"use client"

import { useState } from "react"
import { CheckIcon, ChevronDownIcon, CoffeeIcon, ExternalLinkIcon, PlayIcon } from "lucide-react"
import { AskAssistantLink } from "@/components/assistant/ask-assistant-link"
import { Button } from "@/components/ui/button"
import { useCourses } from "@/lib/course-store"
import { formatDuration, formatTime, fromDateKey } from "@/lib/format"
import type { NextStudy, TaskDetails, WhatNow } from "@/lib/planner"
import { usePlanActions, useWhatNow } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import { formatDue, priorityLabel } from "@/lib/tasks"
import { eventSourceNames, type Task } from "@/lib/types"
import { cn } from "@/lib/utils"

// "What should I do now?" on the Dashboard and the Planner page. It only shows
// the planner's answer (whatNow in src/lib/planner/what-now.ts); nothing is decided here.

const time = (date: string, hhmm: string) => formatTime(fromDateKey(date, hhmm))

export function WhatNowCard({ onOpenTask, className }: { onOpenTask: (task: Task) => void; className?: string }) {
  const answer = useWhatNow()
  const { today } = useTasks()
  const actions = usePlanActions()
  const [whyOpen, setWhyOpen] = useState(false)

  return (
    <section aria-labelledby="now-heading" className={cn(
        // The one hero on the page: an elevated surface with a soft wash of the accent, not a solid slab.
        "relative overflow-hidden rounded-xl bg-card p-5 shadow-md ring-1 ring-primary/20 sm:p-6",
        "bg-[radial-gradient(120%_140%_at_0%_0%,var(--primary-soft)_0%,transparent_55%)]",
        className
      )}>
      <h2 id="now-heading" className="flex items-center gap-2 text-xs font-semibold tracking-wide text-primary-soft-foreground uppercase">
        <span aria-hidden className="size-1.5 rounded-full bg-primary" />
        What should I do now?
      </h2>

      {answer.kind === "work" || answer.kind === "studying" ? (
        <div className="mt-2 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-4">
            <div className="min-w-0">
              <p className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">
                {answer.kind === "studying" ? "Keep going: " : "Work on "}
                {answer.task.title}
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {answer.kind === "studying"
                  ? `Your study session runs until ${time(today, answer.until)}.`
                  : `You have ${formatDuration(answer.availableMinutes)} available right now · suggested ${time(today, answer.session.startTime)}–${time(today, answer.session.endTime)}.`}
              </p>
              <TaskLine task={answer.task} details={answer.details} today={today} />
            </div>
            <div className="flex flex-wrap gap-2">
              {answer.session.status === "suggested" ? (
                <Button size="lg" onClick={() => actions.accept(answer.session)}>
                  <PlayIcon data-icon="inline-start" />
                  Start now
                </Button>
              ) : (
                <Button size="lg" onClick={() => actions.complete(answer.session)}>
                  <CheckIcon data-icon="inline-start" />
                  Mark done
                </Button>
              )}
              <Button
                variant="outline"
                size="lg"
                onClick={() => onOpenTask(answer.task)}
              >
                <ExternalLinkIcon data-icon="inline-start" />
                Open task
              </Button>
            </div>
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-x-5 gap-y-1">
              {answer.reasons.length > 0 && (
              <button
                type="button"
                aria-expanded={whyOpen}
                aria-controls="now-why"
                onClick={() => setWhyOpen((open) => !open)}
                className="inline-flex min-h-8 items-center gap-1 rounded-sm text-sm font-medium outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                Why this?
                <ChevronDownIcon aria-hidden className={cn("size-4 transition-transform", whyOpen && "rotate-180")} />
              </button>
              )}
              <AskAssistantLink taskId={answer.task.id} className="min-h-8 text-primary" />
            </div>
              {whyOpen && (
                <ul id="now-why" className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                  {answer.reasons.map((reason) => (
                    <li key={reason} className="flex items-start gap-1.5">
                      <CheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />
                      {reason}
                    </li>
                  ))}
                </ul>
              )}
          </div>
        </div>
      ) : (
        <div className="mt-2 flex items-start gap-3">
          <CoffeeIcon aria-hidden className="mt-1 size-5 shrink-0 text-primary" />
          <div>
            <p className="text-xl font-semibold leading-snug tracking-tight sm:text-2xl">{restHeading(answer, today)}</p>
            <p className="mt-1 text-sm text-muted-foreground">{restDetail(answer, today)}</p>
            <AskAssistantLink className="mt-2 min-h-8 text-primary" />
          </div>
        </div>
      )}
    </section>
  )
}

// "Due Friday · High priority · ~45 min remaining"
function TaskLine({ task, details, today }: { task: Task; details: TaskDetails; today: string }) {
  const { getCourse } = useCourses()
  const course = getCourse(task.courseId)
  const parts = [
    course?.code,
    `Due ${formatDue(task, today)}`,
    task.priority === "high" || task.priority === "critical" ? `${priorityLabel[task.priority]} priority` : null,
    details.remainingMinutes > 0 && `~${formatDuration(details.remainingMinutes)} remaining${details.estimateMissing ? " (estimated)" : ""}`,
  ].filter(Boolean)
  return <p className="mt-1 text-sm text-muted-foreground">{parts.join(" · ")}</p>
}

function restHeading(answer: Exclude<WhatNow, { kind: "work" | "studying" }>, today: string): string {
  switch (answer.kind) {
    case "busy": {
      const source = answer.event.source && answer.event.source !== "student_os" ? ` (${eventSourceNames[answer.event.source]})` : ""
      return `You're busy right now: ${answer.event.title}${source} ends at ${time(today, answer.until)}.`
    }
    case "no-time":
      return answer.reason === "limit-reached"
        ? "You've reached today's study limit."
        : answer.reason === "outside-window"
          ? "It's outside your study hours."
          : "No study time available right now."
    case "done":
      return answer.reason === "covered" ? "Nothing else to plan today." : "You're all caught up."
  }
}

function restDetail(answer: Exclude<WhatNow, { kind: "work" | "studying" }>, today: string): string {
  const next = answer.next
  if (next) return `${answer.kind === "busy" ? "Next recommended" : "Next opportunity"}: ${nextLabel(next, today)}.`
  if (answer.kind === "done" && answer.reason !== "covered") return "Nothing needs planning right now."
  return "Nothing else is planned for now. Enjoy the free time."
}

// "Database Project at 6:00 PM (1h)", "tomorrow at 9:00 AM: Database Project (1h)"
function nextLabel(next: NextStudy, today: string): string {
  const minutes = (fromDateKey(next.date, next.endTime).getTime() - fromDateKey(next.date, next.startTime).getTime()) / 60_000
  const when = next.date === today ? `at ${time(next.date, next.startTime)}` : `tomorrow at ${time(next.date, next.startTime)}`
  return `${next.task.title} ${when} (${formatDuration(minutes)})`
}
