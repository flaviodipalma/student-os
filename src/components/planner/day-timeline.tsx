"use client"

import { CircleCheckIcon, RepeatIcon, SparklesIcon } from "lucide-react"
import { eventStyle } from "@/components/calendar/event-style"
import { CourseTag } from "@/components/course-tag"
import { useNow } from "@/lib/clock"
import { useCourses } from "@/lib/course-store"
import { eventTypeLabel, toMinutes } from "@/lib/events"
import { formatDuration, formatTime, fromDateKey, toDateKey } from "@/lib/format"
import { partOfDay, type PartOfDay, type StudySession, type TimelineItem } from "@/lib/planner"
import { useTasks } from "@/lib/task-store"
import { cn } from "@/lib/utils"

const partLabel: Record<PartOfDay, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening" }

// One day as a vertical list: fixed events, study sessions (recommended,
// scheduled or done), free time and breaks. `grouped` splits it into Morning,
// Afternoon and Evening (by start time). `sessionDetails` adds extra content
// (e.g. the Planner's reasons and actions) under each study session.
export function DayTimeline({
  date,
  items,
  grouped = false,
  sessionDetails,
}: {
  date: string
  items: TimelineItem[]
  grouped?: boolean
  sessionDetails?: (session: StudySession) => React.ReactNode
}) {
  const now = useNow()
  const { tasks } = useTasks()
  const { getCourse } = useCourses()
  const isToday = date === toDateKey(now)
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const time = (hhmm: string) => formatTime(fromDateKey(date, hhmm))

  const statusOf = (item: TimelineItem) => {
    if (!isToday) return "later"
    if (toMinutes(item.end) <= nowMinutes) return "past"
    if (toMinutes(item.start) <= nowMinutes) return "now"
    return "later"
  }
  const nextKey = isToday
    ? items.find((item) => item.kind !== "break" && toMinutes(item.start) > nowMinutes)?.key
    : undefined

  const renderItem = (item: TimelineItem) => {
    const status = statusOf(item)
    const minutes = toMinutes(item.end) - toMinutes(item.start)

    if (item.kind === "break") {
      return (
        <li key={item.key} className="grid gap-3 text-xs text-muted-foreground sm:grid-cols-[4.25rem_minmax(0,1fr)]">
          <span className="hidden sm:block" />
          <span className="pl-3">{formatDuration(minutes)} break</span>
        </li>
      )
    }

    let title: React.ReactNode
    let meta: React.ReactNode[] = [formatDuration(minutes), `until ${time(item.end)}`]
    let badge: React.ReactNode = null
    let blockClass: string

    if (item.kind === "free") {
      title = "Free time"
      blockClass = "border-dashed border-foreground/15 text-muted-foreground"
    } else if (item.kind === "event") {
      title = item.event.commitmentId ? (
        <span className="inline-flex items-start gap-1.5">
          <RepeatIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 opacity-70" />
          {item.event.title}
        </span>
      ) : (
        item.event.title
      )
      meta = [
        ...meta,
        eventTypeLabel[item.event.type],
        item.event.commitmentId && "Repeats weekly",
        item.event.description,
      ]
      blockClass = cn("border-transparent border-l-[3px]", eventStyle[item.event.type].block)
    } else {
      const task = tasks.find((t) => t.id === item.session.taskId)
      const course = task ? getCourse(task.courseId) : undefined
      const state = item.session.status
      title = (
        <span className="inline-flex items-start gap-1.5">
          {state === "suggested" && <SparklesIcon aria-hidden className="mt-0.5 size-3.5 shrink-0 text-primary" />}
          {state === "completed" && <CircleCheckIcon aria-hidden className="mt-0.5 size-3.5 shrink-0" />}
          <span className={cn(state === "completed" && "line-through decoration-foreground/30")}>
            {task ? `Study — ${task.title}` : (item.event?.title ?? "Study session")}
          </span>
        </span>
      )
      meta = [...meta, course && <CourseTag key="course" code={course.code} color={course.color} />]
      badge = (
        <span
          className={cn(
            "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-medium",
            state === "suggested" && "bg-primary/10 text-primary",
            state === "scheduled" && "bg-background/70 text-indigo-900",
            state === "completed" && "bg-background text-muted-foreground"
          )}
        >
          {state === "suggested" ? "Recommended" : state === "scheduled" ? "Scheduled" : "Done"}
        </span>
      )
      blockClass =
        state === "suggested"
          ? "border-dashed border-primary/45 bg-primary/[0.04]"
          : state === "scheduled"
            ? cn("border-transparent border-l-[3px]", eventStyle.study.block)
            : "border-foreground/10 bg-muted/50 text-muted-foreground"
    }

    return (
      <li
        key={item.key}
        aria-current={status === "now" ? "time" : undefined}
        // Phones: the time sits above the block, so long titles get the full width.
        className={cn(
          "grid gap-1 sm:grid-cols-[4.25rem_minmax(0,1fr)] sm:gap-3",
          status === "past" && "opacity-55"
        )}
      >
        <p className="text-xs font-medium text-muted-foreground tabular-nums sm:pt-2 sm:text-right sm:text-sm sm:text-foreground">
          {time(item.start)}
        </p>
        <div className={cn("rounded-lg border px-3 py-2", blockClass, status === "now" && "ring-2 ring-primary/30")}>
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium leading-snug">{title}</p>
            <div className="flex shrink-0 items-center gap-1">
              {status === "now" && (
                <span className="rounded-full bg-primary px-2 py-0.5 text-[11px] font-semibold text-primary-foreground">
                  Now
                </span>
              )}
              {item.key === nextKey && (
                <span className="rounded-full bg-background/70 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  Up next
                </span>
              )}
              {badge}
            </div>
          </div>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs opacity-80">
            {meta.filter(Boolean).map((part, i) => (
              <span key={i} className="inline-flex items-center gap-1.5">
                {i > 0 && <span aria-hidden>·</span>}
                {part}
              </span>
            ))}
          </p>
          {item.kind === "session" && sessionDetails?.(item.session)}
        </div>
      </li>
    )
  }

  if (!grouped) return <ol className="space-y-2">{items.map(renderItem)}</ol>

  const parts: PartOfDay[] = ["morning", "afternoon", "evening"]
  return (
    <div className="space-y-5">
      {parts.map((part) => {
        const inPart = items.filter((item) => partOfDay(item.start) === part)
        // A part with only free time or breaks isn't worth a heading.
        if (!inPart.some((item) => item.kind === "event" || item.kind === "session")) return null
        return (
          <section key={part} aria-labelledby={`part-${part}`}>
            <h3 id={`part-${part}`} className="mb-2 text-xs font-semibold tracking-wide text-muted-foreground uppercase">
              {partLabel[part]}
            </h3>
            <ol className="space-y-2">{inPart.map(renderItem)}</ol>
          </section>
        )
      })}
    </div>
  )
}
