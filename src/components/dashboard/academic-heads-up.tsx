"use client"

import Link from "next/link"
import { academicKindStyle } from "@/components/calendar/academic-style"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { academicHeadsUp, academicKindLabel, type AcademicHeadsUp as HeadsUp } from "@/lib/academic-calendar"
import { useAppStore } from "@/lib/app-store"
import { fromDateKey } from "@/lib/format"
import { cn } from "@/lib/utils"

// "At school" on the Dashboard: from the academic calendar, what's going on now (a
// break, the exam period) and in the next two weeks (breaks, exams, deadlines, a
// semester starting or ending). Hidden when there's nothing to say.

const day = (key: string) => fromDateKey(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })

export function headsUpWhen(item: HeadsUp): string {
  const range = item.startDate === item.endDate ? day(item.startDate) : `${day(item.startDate)} – ${day(item.endDate)}`
  if (item.when === "now") {
    if (item.kind === "exams") return item.days === 0 ? "Exams end today" : `Until ${day(item.endDate)}`
    return item.days === 0 ? "No classes today" : `No classes until ${day(item.endDate)}`
  }
  if (item.when === "ends") return item.days === 0 ? "Last day today" : `Ends ${day(item.endDate)} · in ${item.days} ${item.days === 1 ? "day" : "days"}`
  if (item.days === 0) return `Today · ${range}`
  if (item.days === 1) return `Tomorrow · ${range}`
  return `In ${item.days} days · ${range}`
}

export function AcademicHeadsUp({ className }: { className?: string }) {
  const { academicEvents, today, student } = useAppStore()
  const items = academicHeadsUp(academicEvents, today)
  if (items.length === 0) return null

  return (
    <Card className={className}>
      <CardHeader className="flex flex-row flex-wrap items-baseline justify-between gap-2">
        <div>
          <CardTitle className="text-lg font-semibold">At school</CardTitle>
          <CardDescription>{student.schoolName ? `${student.schoolName}, the next two weeks` : "The next two weeks"}</CardDescription>
        </div>
        <Link href="/calendar?view=academic" className="text-sm font-medium text-primary hover:underline">
          Academic calendar
        </Link>
      </CardHeader>
      <CardContent>
        <ul className="grid gap-2">
          {items.map((item) => (
            <li key={`${item.id}-${item.when}`} className="flex items-center gap-3">
              <span className={cn("shrink-0 rounded-md px-2 py-0.5 text-xs font-medium", academicKindStyle[item.kind])}>
                {academicKindLabel[item.kind]}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{item.when === "soon" && item.kind === "term" ? `${item.title} begins` : item.title}</p>
                <p className="text-xs text-muted-foreground">{headsUpWhen(item)}</p>
              </div>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
