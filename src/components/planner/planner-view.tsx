"use client"

import { useState } from "react"
import {
  AlertTriangleIcon,
  CalendarClockIcon,
  CheckIcon,
  CircleDashedIcon,
  MoreHorizontalIcon,
  ChevronDownIcon,
  CircleCheckBigIcon,
  ExternalLinkIcon,
  InfoIcon,
  RotateCcwIcon,
  SparklesIcon,
  XIcon,
} from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { PriorityBadge } from "@/components/tasks/task-badges"
import { TaskFormDialog } from "@/components/tasks/task-form-dialog"
import { AskAssistantLink } from "@/components/assistant/ask-assistant-link"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { useCourses } from "@/lib/course-store"
import { useEvents } from "@/lib/event-store"
import { toMinutes } from "@/lib/events"
import { addDays, formatDuration, formatRelativeDay, fromDateKey } from "@/lib/format"
import {
  buildDayTimeline,
  type DailyPlan,
  type PlannerWarning,
  type RecommendedStudySession,
  type StudySession,
} from "@/lib/planner"
import { usePlan, usePlanActions } from "@/lib/planner-store"
import { useTasks } from "@/lib/task-store"
import { formatDue } from "@/lib/tasks"
import type { Task } from "@/lib/types"
import { cn } from "@/lib/utils"
import { DayTimeline } from "./day-timeline"
import { PartlyDoneDialog, RescheduleDialog } from "./session-dialogs"
import { WhatNowCard } from "./what-now-card"

// The Planner page: "What should I do today?" It only renders the DailyPlan the
// planner produced (src/lib/planner); no planning happens in here.
//
//   What should I do now?  (today only)
//   Summary                (sessions, study time vs limit, free time)
//   Your day               (one timeline; each study session has its reasons and actions)
//   Needs attention        (warnings, work that didn't fit, removed sessions)

const sessionMinutes = (s: StudySession) => toMinutes(s.endTime) - toMinutes(s.startTime)
const isRecommended = (s: StudySession): s is RecommendedStudySession => s.status === "suggested"

// `initialDate` (from /planner?date=YYYY-MM-DD, e.g. a study session reminder) opens that day.
export function PlannerView({ initialDate }: { initialDate?: string }) {
  const { tasks, today } = useTasks()
  const { scheduleOn } = useEvents()
  const [date, setDate] = useState(initialDate ?? today)
  const [openTask, setOpenTask] = useState<Task | null>(null)
  const plan = usePlan(date)
  const tomorrow = addDays(today, 1)

  // "today", "tomorrow", "Friday", "Wed, Oct 1"
  const dayWord = date === today ? "today" : date === tomorrow ? "tomorrow" : formatRelativeDay(fromDateKey(date), fromDateKey(today))
  const taskById = new Map(tasks.map((task) => [task.id, task]))
  const dayEvents = scheduleOn(date)
  const showTask = (taskId: string) => setOpenTask(taskById.get(taskId) ?? null)

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Your plan for {dayWord}</h1>
          <p className="mt-1.5 text-muted-foreground">
            Recommended study around your classes and commitments. You decide what to keep.
          </p>
          <AskAssistantLink date={date} className="mt-2 text-primary">
            Ask Student OS about this plan
          </AskAssistantLink>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div role="group" aria-label="Plan for" className="inline-flex rounded-lg bg-muted p-1">
            {[
              { label: "Today", value: today },
              { label: "Tomorrow", value: tomorrow },
              // The next few days (planned ahead: long work is spread over them).
              ...[2, 3, 4].map((offset) => {
                const day = addDays(today, offset)
                return { label: fromDateKey(day).toLocaleDateString("en-US", { weekday: "short" }), value: day }
              }),
            ].map((option) => (
              <button
                key={option.label}
                type="button"
                aria-pressed={date === option.value}
                onClick={() => setDate(option.value)}
                className={cn(
                  "rounded-md px-3 py-1.5 max-sm:py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
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

      {date === today && <WhatNowCard onOpenTask={(task) => setOpenTask(task)} />}

      <PlanSummary
        plan={plan}
        dayWord={dayWord}
        commitmentMinutes={dayEvents
          .filter((e) => e.type !== "study")
          .reduce((sum, e) => sum + toMinutes(e.endTime) - toMinutes(e.startTime), 0)}
      />

      {/* Phones and tablets: "Needs attention" comes before the (long) day timeline. */}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem] xl:items-start">
        <Card className="order-2 xl:order-none">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Your day</CardTitle>
            <CardDescription>Fixed events and study sessions, in order. Accept the ones you&apos;ll do.</CardDescription>
            <Legend />
          </CardHeader>
          <CardContent>
            {dayEvents.length === 0 && plan.suggestions.length === 0 ? (
              <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                {headline(plan, dayWord).title}
              </p>
            ) : (
              <DayTimeline
                date={date}
                items={buildDayTimeline(plan, dayEvents)}
                grouped
                sessionDetails={(session) => {
                  const task = taskById.get(session.taskId)
                  return task ? <SessionDetails session={session} task={task} onShowTask={() => showTask(task.id)} /> : null
                }}
              />
            )}
          </CardContent>
        </Card>

        <div className="order-1 space-y-6 xl:order-none">
          <NeedsAttention
            plan={plan}
            taskById={taskById}
            today={today}
            onShowTask={showTask}
            onPlanNextDay={() => setDate(addDays(date, 1))}
          />
          <RemovedFromPlan plan={plan} taskById={taskById} />
        </div>
      </div>

      {openTask && (
        <TaskFormDialog
          key={openTask.id}
          open
          onOpenChange={(open) => !open && setOpenTask(null)}
          task={openTask}
        />
      )}
    </div>
  )
}

// ---- One study session's reasons and actions (inside the timeline) ----------

function SessionDetails({
  session,
  task,
  onShowTask,
}: {
  session: StudySession
  task: Task
  onShowTask: () => void
}) {
  const actions = usePlanActions()
  const { today } = useTasks()
  const [whyOpen, setWhyOpen] = useState(false)
  const [partlyOpen, setPartlyOpen] = useState(false)
  const [rescheduleOpen, setRescheduleOpen] = useState(false)
  const state = session.status
  const reasons = isRecommended(session) ? session.reasons : []
  const whyId = `why-${session.id}`
  const important = task.priority === "high" || task.priority === "critical"

  return (
    <div className="mt-2 space-y-2">
      {(important || reasons.length > 0) && (
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {important && <PriorityBadge priority={task.priority} />}
          {reasons.length > 0 && (
            <button
              type="button"
              aria-expanded={whyOpen}
              aria-controls={whyId}
              onClick={() => setWhyOpen((open) => !open)}
              className="inline-flex min-h-8 items-center gap-1 rounded-sm font-medium text-primary outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              Why this? <span className="font-normal text-muted-foreground">{reasons[0]}</span>
              <ChevronDownIcon aria-hidden className={cn("size-3.5 transition-transform", whyOpen && "rotate-180")} />
            </button>
          )}
        </div>
      )}
      {whyOpen && (
        <ul id={whyId} className="space-y-0.5 text-xs text-muted-foreground">
          {reasons.map((reason) => (
            <li key={reason} className="flex items-start gap-1.5">
              <CheckIcon aria-hidden className="mt-0.5 size-3 shrink-0 text-primary" />
              {reason}
            </li>
          ))}
        </ul>
      )}
      {state === "missed" && (
        <p className="text-xs text-muted-foreground">
          This session ended without being marked done, so its work is back in your plan. Mark it done if you studied.
        </p>
      )}
      {/* The main actions as buttons; the rest in a menu, so each session stays compact. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {state === "suggested" && (
          <Button size="sm" onClick={() => actions.accept(session)}>
            <CheckIcon data-icon="inline-start" />
            Accept
          </Button>
        )}
        {state !== "completed" ? (
          <Button size="sm" variant="outline" onClick={() => actions.complete(session)}>
            <CircleCheckBigIcon data-icon="inline-start" />
            Done
          </Button>
        ) : (
          <Button size="sm" variant="outline" onClick={() => actions.undoComplete(session)}>
            <RotateCcwIcon data-icon="inline-start" />
            Undo
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger render={<Button size="sm" variant="ghost" />} aria-label={`More actions for ${task.title}`}>
            <MoreHorizontalIcon data-icon="inline-start" />
            More
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            {state !== "completed" && (
              <>
                <DropdownMenuItem onClick={() => setPartlyOpen(true)}>
                  <CircleDashedIcon />
                  Partly done…
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setRescheduleOpen(true)}>
                  <CalendarClockIcon />
                  {state === "suggested" ? "Schedule at another time…" : "Reschedule…"}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => actions.remove(session)}>
                  <XIcon />
                  Skip for this day
                </DropdownMenuItem>
              </>
            )}
            <DropdownMenuItem onClick={onShowTask}>
              <ExternalLinkIcon />
              Open task
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      {partlyOpen && <PartlyDoneDialog session={session} taskTitle={task.title} open onOpenChange={setPartlyOpen} />}
      {rescheduleOpen && (
        <RescheduleDialog session={session} taskTitle={task.title} minDate={today} open onOpenChange={setRescheduleOpen} />
      )}
    </div>
  )
}

// Tasks the student skipped for this day; they come back on other days, or now with Restore.
function RemovedFromPlan({ plan, taskById }: { plan: DailyPlan; taskById: Map<string, Task> }) {
  const actions = usePlanActions()
  if (plan.skippedTaskIds.length === 0) return null
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Skipped for this day</CardTitle>
        <CardDescription>These won&apos;t be recommended again today. They come back on other days.</CardDescription>
      </CardHeader>
      <CardContent>
        <ul className="space-y-1">
          {plan.skippedTaskIds.map((taskId) => (
            <li key={taskId} className="flex items-center justify-between gap-2 text-sm">
              <span className="truncate">{taskById.get(taskId)?.title ?? "Task"}</span>
              <Button size="sm" variant="ghost" onClick={() => actions.restore(taskId, plan.date)}>
                Restore
              </Button>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function Legend() {
  const keys = [
    { label: "Fixed event", swatch: "bg-teal-100 border-l-[3px] border-teal-500" },
    { label: "Recommended", swatch: "border border-dashed border-primary/60 bg-primary/5" },
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

// The one-line answer for the day, for each plan status.
function headline(plan: DailyPlan, dayWord: string): { title: string; detail: string } {
  const count = plan.suggestions.length
  if (count > 0) {
    const minutes = plan.suggestions.reduce((sum, s) => sum + sessionMinutes(s), 0)
    return {
      title: `${count} study ${count === 1 ? "session" : "sessions"} recommended (${formatDuration(minutes)})`,
      detail: "Planned around your fixed events, with breaks and free time left over.",
    }
  }
  switch (plan.status) {
    case "past":
      return { title: "This day has passed", detail: "Pick today or a later day to see a plan." }
    case "no-tasks":
      return { title: "You're all caught up.", detail: "Add a task or import a syllabus, and your plan will appear here." }
    case "all-done":
      return { title: "All your tasks are done. Nice work!", detail: "Enjoy the free time, or add what's coming up next." }
    case "covered":
      return {
        title: `Nothing new to plan ${dayWord}`,
        detail: "Your open tasks are already planned or on your calendar.",
      }
    case "no-time":
      return {
        title: `You don't have any available study time ${dayWord}.`,
        detail: "No study sessions were added. See below for what needs attention.",
      }
    case "limit-reached":
      return {
        title: `You've reached your daily study limit ${dayWord}`,
        detail: "You can change the limit in Settings.",
      }
    default:
      return { title: "No new sessions to recommend", detail: "The free time left is too short for a study block." }
  }
}

function PlanSummary({ plan, dayWord, commitmentMinutes }: { plan: DailyPlan; dayWord: string; commitmentMinutes: number }) {
  const suggestedMinutes = plan.suggestions.reduce((sum, s) => sum + sessionMinutes(s), 0)
  // Study on this day: done (minutes actually worked) and still to do, against the daily limit.
  const doneMinutes = plan.existingSessions
    .filter((s) => s.status === "completed")
    .reduce((sum, s) => sum + (s.completedMinutes ?? sessionMinutes(s)), 0)
  const roomLeft = Math.max(0, plan.studyLimit - plan.studyMinutes)
  const stays = Math.max(0, plan.freeMinutes - suggestedMinutes)
  const percent = Math.min(100, Math.round((plan.studyMinutes / plan.studyLimit) * 100))
  const { title, detail } = headline(plan, dayWord)
  const happy = plan.status === "all-done" || plan.status === "no-tasks"

  return (
    <section
      aria-label="Plan summary"
      className="grid gap-5 rounded-xl bg-primary/[0.05] p-5 ring-1 ring-primary/15 md:grid-cols-[minmax(0,1fr)_auto] md:items-center"
    >
      <div className="flex items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          {happy ? <CircleCheckBigIcon className="size-4.5" /> : <SparklesIcon className="size-4.5" />}
        </span>
        <div>
          <p className="font-semibold" aria-live="polite">
            {title}
          </p>
          <p className="mt-0.5 text-sm text-muted-foreground">{detail}</p>
        </div>
      </div>
      {plan.status !== "past" && (
        <dl className="grid grid-cols-3 gap-x-6 gap-y-2 text-sm">
          <div>
            <dt className="text-muted-foreground">Study</dt>
            <dd className="mt-0.5 font-semibold">
              {formatDuration(plan.studyMinutes)}
              <span className="font-normal text-muted-foreground"> / {formatDuration(plan.studyLimit)}</span>
            </dd>
            <Progress value={percent} aria-label="Study planned against the daily limit" className="mt-1.5 w-24" />
            <p className="mt-1 text-xs text-muted-foreground">
              {formatDuration(doneMinutes)} done · {formatDuration(roomLeft)} room left
            </p>
          </div>
          <div>
            <dt className="text-muted-foreground">Commitments</dt>
            <dd className="mt-0.5 font-semibold">{formatDuration(commitmentMinutes)}</dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Stays free</dt>
            <dd className="mt-0.5 font-semibold">{formatDuration(stays)}</dd>
          </div>
        </dl>
      )}
    </section>
  )
}

function NeedsAttention({
  plan,
  taskById,
  today,
  onShowTask,
  onPlanNextDay,
}: {
  plan: DailyPlan
  taskById: Map<string, Task>
  today: string
  onShowTask: (taskId: string) => void
  onPlanNextDay: () => void
}) {
  if (plan.warnings.length === 0) return null
  const nextDay = plan.date === today ? "Plan for tomorrow" : "See the next day"

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Needs attention</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="space-y-4">
          {plan.warnings.map((warning) => (
            <li key={warning.id} className="flex gap-3">
              <WarningIcon warning={warning} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium leading-snug">{warning.message}</p>
                {warning.kind === "unscheduled" && (
                  <UnscheduledList plan={plan} taskById={taskById} today={today} onShowTask={onShowTask} />
                )}
                {warning.kind !== "unscheduled" && warning.taskIds.length > 1 && (
                  <ul className="mt-1 space-y-0.5 text-sm text-muted-foreground">
                    {warning.taskIds.slice(0, 5).map((taskId) => (
                      <li key={taskId}>
                        <button
                          type="button"
                          onClick={() => onShowTask(taskId)}
                          className="rounded-sm text-left outline-none hover:text-foreground hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
                        >
                          {taskById.get(taskId)?.title ?? "Task"}
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                {warning.action && (
                  <Button
                    size="xs"
                    variant="outline"
                    className="mt-2"
                    onClick={() => (warning.action === "view-task" ? onShowTask(warning.taskIds[0]) : onPlanNextDay())}
                  >
                    {warning.action === "view-task" ? "View task" : nextDay}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}

function WarningIcon({ warning }: { warning: PlannerWarning }) {
  const Icon = warning.severity === "low" ? InfoIcon : AlertTriangleIcon
  return (
    <Icon
      aria-hidden
      className={cn(
        "mt-0.5 size-4 shrink-0",
        warning.severity === "high" ? "text-red-600" : warning.severity === "medium" ? "text-amber-600" : "text-muted-foreground"
      )}
    />
  )
}

function UnscheduledList({
  plan,
  taskById,
  today,
  onShowTask,
}: {
  plan: DailyPlan
  taskById: Map<string, Task>
  today: string
  onShowTask: (taskId: string) => void
}) {
  const { getCourse } = useCourses()
  return (
    <ul className="mt-2 space-y-2">
      {plan.unscheduled.filter((item) => item.atRisk).map((item) => {
        const task = taskById.get(item.taskId)
        if (!task) return null
        const course = getCourse(task.courseId)
        return (
          <li key={item.taskId} className="rounded-md bg-muted/50 px-2.5 py-2">
            <div className="flex items-start justify-between gap-2">
              <button
                type="button"
                onClick={() => onShowTask(task.id)}
                className="rounded-sm text-left text-sm font-medium leading-snug outline-none hover:underline focus-visible:ring-3 focus-visible:ring-ring/50"
              >
                {task.title}
              </button>
              <span className={cn("shrink-0 text-xs font-medium", item.atRisk ? "text-red-700" : "text-muted-foreground")}>
                {item.atRisk ? "At risk" : "Can wait"}
              </span>
            </div>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
              {course && <CourseTag code={course.code} color={course.color} />}
              <span>Due {formatDue(task, today)}</span>
              <span>
                {item.scheduledMinutes > 0
                  ? `${formatDuration(item.scheduledMinutes)} planned, ${formatDuration(item.missingMinutes)} more needed`
                  : `Needs ${formatDuration(item.missingMinutes)}`}
                {item.reason === "daily-limit" ? " · daily limit reached" : " · not enough free time"}
              </span>
            </p>
          </li>
        )
      })}
    </ul>
  )
}
