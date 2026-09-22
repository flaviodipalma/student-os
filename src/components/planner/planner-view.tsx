"use client"

import { useState } from "react"
import { CheckIcon, RotateCcwIcon, SparklesIcon, XIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useCourses } from "@/lib/course-store"
import { useEvents } from "@/lib/event-store"
import { eventsOn, toMinutes } from "@/lib/events"
import { addDays, formatDuration, formatRelativeDay, formatTime, fromDateKey } from "@/lib/format"
import { buildDayTimeline, urgencyReasons, type DailyPlan, type StudySession } from "@/lib/planner"
import { usePlan, usePlanActions } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import { formatDue } from "@/lib/tasks"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"
import { DayTimeline } from "./day-timeline"

const sessionMinutes = (s: StudySession) => toMinutes(s.endTime) - toMinutes(s.startTime)

export function PlannerView() {
  const { tasks, today } = useTasks()
  const { events } = useEvents()
  const [date, setDate] = useState(today)
  const plan = usePlan(date)
  const tomorrow = addDays(today, 1)

  // "today", "tomorrow", "Friday", "Wed, Oct 1"
  const dayWord = date === today ? "today" : date === tomorrow ? "tomorrow" : formatRelativeDay(fromDateKey(date), fromDateKey(today))
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const dayEvents = eventsOn(events, date)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Your plan</h1>
          <p className="mt-1.5 text-muted-foreground">Here&apos;s what Student OS recommends for {dayWord}.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Plan for" className="inline-flex rounded-lg bg-muted p-1">
            {[
              { label: "Today", value: today },
              { label: "Tomorrow", value: tomorrow },
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={date === option.value}
                onClick={() => setDate(option.value)}
                className={cn(
                  "rounded-md px-3 py-1 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                  date === option.value ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
          <Input
            type="date"
            aria-label="Plan a specific date"
            value={date}
            min={today}
            onChange={(e) => e.target.value && setDate(e.target.value)}
            className="w-auto"
          />
        </div>
      </header>

      <PlanSummary plan={plan} dayEventsMinutes={dayEvents.filter((e) => e.type !== "study").reduce((sum, e) => sum + toMinutes(e.endTime) - toMinutes(e.startTime), 0)} />

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem] xl:items-start">
        <Card>
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Your day</CardTitle>
            <CardDescription>Fixed events and recommended study, in order.</CardDescription>
            <Legend />
          </CardHeader>
          <CardContent>
            {dayEvents.length === 0 && plan.suggestions.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Nothing on the calendar for {dayWord}.</p>
            ) : (
              <DayTimeline date={date} items={buildDayTimeline(plan, dayEvents)} />
            )}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Recommended plan={plan} taskById={taskById} dayWord={dayWord} />
          <NeedsAttention plan={plan} taskById={taskById} dayWord={dayWord} today={today} />
        </div>
      </div>
    </div>
  )
}

function Legend() {
  const keys = [
    { label: "Fixed event", swatch: "bg-teal-100 border-l-[3px] border-teal-500" },
    { label: "Suggested", swatch: "border border-dashed border-primary/60 bg-primary/5" },
    { label: "Scheduled study", swatch: "bg-indigo-100 border-l-[3px] border-indigo-600" },
    { label: "Done", swatch: "border border-foreground/15 bg-muted" },
  ]
  return (
    <ul aria-label="Legend" className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
      {keys.map((key) => (
        <li key={key.label} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn("h-3 w-4 rounded-sm", key.swatch)} />
          {key.label}
        </li>
      ))}
    </ul>
  )
}

function PlanSummary({ plan, dayEventsMinutes }: { plan: DailyPlan; dayEventsMinutes: number }) {
  const suggestedMinutes = plan.suggestions.reduce((sum, s) => sum + sessionMinutes(s), 0)
  const stays = Math.max(0, plan.freeMinutes - suggestedMinutes)
  const percent = Math.min(100, Math.round((plan.studyMinutes / plan.studyLimit) * 100))
  const count = plan.suggestions.length

  return (
    <section
      aria-label="Plan summary"
      className="grid gap-5 rounded-xl bg-primary/[0.05] p-5 ring-1 ring-primary/15 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <SparklesIcon className="size-4.5" />
        </span>
        <div>
          <p className="font-semibold">
            {count > 0
              ? `${count} study ${count === 1 ? "session" : "sessions"} suggested`
              : plan.status === "past"
                ? "This day has passed"
                : "No new sessions to suggest"}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            Planned around your fixed events, with breaks and free time left over.
          </p>
        </div>
      </div>
      <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
        <div>
          <dt className="text-muted-foreground">Study</dt>
          <dd className="mt-0.5 font-semibold">
            {formatDuration(plan.studyMinutes)}
            <span className="font-normal text-muted-foreground"> / {formatDuration(plan.studyLimit)}</span>
          </dd>
          <Progress value={percent} aria-label="Study planned against the daily limit" className="mt-1.5 w-24" />
        </div>
        <div>
          <dt className="text-muted-foreground">Commitments</dt>
          <dd className="mt-0.5 font-semibold">{formatDuration(dayEventsMinutes)}</dd>
        </div>
        <div>
          <dt className="text-muted-foreground">Stays free</dt>
          <dd className="mt-0.5 font-semibold">{formatDuration(stays)}</dd>
        </div>
      </dl>
    </section>
  )
}

const emptyMessage: Record<DailyPlan["status"], (day: string) => string> = {
  ok: () => "Nothing new to suggest. Your tasks are already covered.",
  past: () => "This day has already passed.",
  "no-tasks": () => "No tasks need to be scheduled.",
  "no-time": (day) => `You don't have enough free time ${day}.`,
  "limit-reached": (day) => `You already have a full day of study on the calendar ${day}.`,
}

function Recommended({ plan, taskById, dayWord }: { plan: DailyPlan; taskById: Map<string, Task>; dayWord: string }) {
  const actions = usePlanActions()
  const { getCourse } = useCourses()
  const sessions = [...plan.existingSessions, ...plan.suggestions].sort((a, b) => a.startTime.localeCompare(b.startTime))
  const time = (s: StudySession, hhmm: string) => formatTime(fromDateKey(s.date, hhmm))

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Recommended</CardTitle>
        <CardDescription>Study sessions for {dayWord}. Accept them to add them to your calendar.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        {sessions.length === 0 && (
          <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            {emptyMessage[plan.status](dayWord)}
          </p>
        )}
        {sessions.map((session) => {
          const task = taskById.get(session.taskId)
          if (!task) return null
          const course = getCourse(task.courseId)
          const state = session.status
          return (
            <article
              key={session.id}
              className={cn(
                "rounded-lg border p-3",
                state === "suggested" && "border-dashed border-primary/45 bg-primary/[0.03]",
                state === "scheduled" && "border-indigo-200 bg-indigo-50/60",
                state === "completed" && "bg-muted/40 text-muted-foreground"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-xs font-medium text-muted-foreground tabular-nums">
                    {time(session, session.startTime)} – {time(session, session.endTime)} · {formatDuration(sessionMinutes(session))}
                  </p>
                  <h3 className={cn("mt-0.5 font-medium leading-snug", state === "completed" && "line-through decoration-foreground/30")}>
                    {task.title}
                  </h3>
                </div>
                <span
                  className={cn(
                    "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
                    state === "suggested" && "bg-primary/10 text-primary",
                    state === "scheduled" && "bg-indigo-100 text-indigo-900",
                    state === "completed" && "bg-background"
                  )}
                >
                  {state === "suggested" ? "Suggested" : state === "scheduled" ? "On calendar" : "Done"}
                </span>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                {course && <CourseTag code={course.code} color={course.color} />}
                {urgencyReasons(task, session.date).map((reason) => (
                  <span key={reason} className="rounded bg-background px-1.5 py-0.5 ring-1 ring-foreground/10">
                    {reason}
                  </span>
                ))}
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {state === "suggested" && (
                  <Button size="sm" onClick={() => actions.accept(session, task)}>
                    <CheckIcon data-icon="inline-start" />
                    Accept
                  </Button>
                )}
                {state !== "completed" ? (
                  <Button size="sm" variant="outline" onClick={() => actions.complete(session, task)}>
                    Mark done
                  </Button>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => actions.undoComplete(session)}>
                    <RotateCcwIcon data-icon="inline-start" />
                    Undo
                  </Button>
                )}
                {state !== "completed" && (
                  <Button size="sm" variant="ghost" onClick={() => actions.remove(session)} aria-label={`Remove ${task.title} from this plan`}>
                    <XIcon data-icon="inline-start" />
                    Remove
                  </Button>
                )}
              </div>
            </article>
          )
        })}

        {plan.skippedTaskIds.length > 0 && (
          <div className="border-t pt-3">
            <p className="text-xs font-medium text-muted-foreground">Removed from this plan</p>
            <ul className="mt-1.5 space-y-1">
              {plan.skippedTaskIds.map((taskId) => (
                <li key={taskId} className="flex items-center justify-between gap-2 text-sm">
                  <span className="truncate">{taskById.get(taskId)?.title ?? "Task"}</span>
                  <Button size="xs" variant="ghost" onClick={() => actions.restore(taskId, plan.date)}>
                    Restore
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function NeedsAttention({
  plan,
  taskById,
  dayWord,
  today,
}: {
  plan: DailyPlan
  taskById: Map<string, Task>
  dayWord: string
  today: string
}) {
  const { getCourse } = useCourses()
  const count = plan.unscheduled.length
  if (count === 0) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Needs attention</CardTitle>
        <CardDescription>
          {count} {count === 1 ? "task" : "tasks"} could not fit into {dayWord}&apos;s plan.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-3">
          {plan.unscheduled.map((item) => {
            const task = taskById.get(item.taskId)
            if (!task) return null
            const course = getCourse(task.courseId)
            return (
              <li key={item.taskId} className="flex gap-3">
                <span
                  aria-hidden
                  className={cn("mt-1.5 size-2 shrink-0 rounded-full", item.atRisk ? "bg-red-500" : "bg-foreground/20")}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-2">
                    <p className="font-medium leading-snug">{task.title}</p>
                    <span className={cn("shrink-0 text-xs font-medium", item.atRisk ? "text-red-700" : "text-muted-foreground")}>
                      {item.atRisk ? "At risk" : "Can wait"}
                    </span>
                  </div>
                  <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    {course && <CourseTag code={course.code} color={course.color} />}
                    <span>Due {formatDue(task, today)}</span>
                  </p>
                  <p className="mt-1 text-sm">
                    {item.scheduledMinutes > 0
                      ? `${formatDuration(item.scheduledMinutes)} planned, needs ${formatDuration(item.missingMinutes)} more.`
                      : `Needs ${formatDuration(item.missingMinutes)}.`}{" "}
                    <span className="text-muted-foreground">
                      {item.reason === "daily-limit" ? `${dayWord === "today" ? "Today's" : "This"} plan is already full.` : "Not enough free time."}
                    </span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      </CardContent>
    </Card>
  )
}
