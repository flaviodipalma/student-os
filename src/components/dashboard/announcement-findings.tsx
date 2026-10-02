"use client"

import { useState } from "react"
import { CalendarClockIcon, CalendarOffIcon, ClipboardCheckIcon, GraduationCapIcon, MegaphoneIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { useAppStore } from "@/lib/app-store"
import { fromDateKey } from "@/lib/format"
import type { AnnouncementFinding, AnnouncementFindingKind } from "@/lib/types"

// "From your announcements" on the Dashboard: what the AI found in the courses'
// recent announcements (a quiz, an exam, a deadline, no class), each with the
// announcement's own words. Nothing changes until the student accepts one. Below
// them, upcoming cancelled classes, each with Undo. Hidden when there's nothing.

const KIND: Record<AnnouncementFindingKind, { label: string; icon: typeof MegaphoneIcon; accept: string }> = {
  exam: { label: "Exam", icon: GraduationCapIcon, accept: "Add to tasks" },
  quiz: { label: "Quiz", icon: ClipboardCheckIcon, accept: "Add to tasks" },
  deadline: { label: "Due", icon: CalendarClockIcon, accept: "Add to tasks" },
  no_class: { label: "No class", icon: CalendarOffIcon, accept: "Take off my schedule" },
}

const day = (key: string) => fromDateKey(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
const clock = (time: string) => fromDateKey("2000-01-01", time).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })

export function AnnouncementFindings({ className }: { className?: string }) {
  const { announcementFindings, classCancellations, courses, today, getCourse, acceptFinding, dismissFinding, undoClassCancellation } = useAppStore()
  const [working, setWorking] = useState<string | null>(null)
  const findings = announcementFindings.filter((finding) => finding.status === "pending" && finding.date >= today && getCourse(finding.courseId))
  const cancelled = classCancellations.filter((cancellation) => cancellation.date >= today && getCourse(cancellation.courseId)).sort((a, b) => a.date.localeCompare(b.date))
  if (findings.length === 0 && cancelled.length === 0) return null

  async function accept(finding: AnnouncementFinding) {
    setWorking(finding.id)
    await acceptFinding(finding.id)
    setWorking(null)
  }

  return (
    <Card className={className} aria-labelledby="announcement-findings-title">
      <CardHeader>
        <CardTitle id="announcement-findings-title" className="flex items-center gap-2 text-lg font-semibold">
          <MegaphoneIcon className="size-4.5 text-muted-foreground" aria-hidden />
          From your announcements
        </CardTitle>
        <CardDescription>
          {findings.length > 0
            ? "Found in your courses' recent announcements. Nothing changes until you add it."
            : "Classes your professors cancelled."}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {findings.length > 0 && (
          <ul className="divide-y rounded-lg ring-1 ring-border">
            {findings.map((finding) => {
              const course = getCourse(finding.courseId)!
              const kind = KIND[finding.kind]
              const Icon = kind.icon
              return (
                <li key={finding.id} className="flex flex-wrap items-start gap-x-3 gap-y-2 px-4 py-3">
                  <span className="mt-0.5 flex shrink-0 items-center gap-1 rounded-md bg-primary-soft px-2 py-0.5 text-xs font-medium text-primary-soft-foreground">
                    <Icon className="size-3.5" aria-hidden />
                    {kind.label}
                  </span>
                  <div className="min-w-0 flex-1 basis-56">
                    <p className="flex flex-wrap items-center gap-x-2 text-sm font-medium">
                      <CourseTag code={course.code} color={course.color} />
                      {finding.title}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {day(finding.date)}
                      {finding.time ? ` · ${clock(finding.time)}` : ""}
                    </p>
                    {finding.quote && <p className="mt-1 text-xs text-muted-foreground italic">“{finding.quote}”</p>}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <Button size="sm" onClick={() => void accept(finding)} disabled={working === finding.id}>
                      {kind.accept}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => dismissFinding(finding.id)} disabled={working === finding.id}>
                      Dismiss
                    </Button>
                  </div>
                </li>
              )
            })}
          </ul>
        )}
        {cancelled.length > 0 && (
          <div>
            <h3 className="mb-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">Cancelled classes</h3>
            <ul className="grid gap-2">
              {cancelled.map((cancellation) => {
                const course = courses.find((item) => item.id === cancellation.courseId)!
                return (
                  <li key={cancellation.id} className="flex items-center gap-3 text-sm">
                    <CalendarOffIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{course.code}</span> · No class {day(cancellation.date)}
                      <span className="text-muted-foreground"> · from {cancellation.source === "calendar" ? "the course calendar" : "an announcement"}</span>
                    </span>
                    <Button size="sm" variant="ghost" onClick={() => undoClassCancellation(cancellation.id)}>
                      Undo
                    </Button>
                  </li>
                )
              })}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
