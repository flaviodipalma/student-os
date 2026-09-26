"use client"

import { useEffect, useRef, useState } from "react"
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog"
import { useAppStore } from "@/lib/app-store"
import { useAskedCourseIds } from "@/lib/class-times-asked"
import type { Course } from "@/lib/types"
import { ClassTimesSteps } from "./class-times"

// Courses imported by the browser extension show up right away, on whatever page
// the student is on. The extension signals open Student OS tabs after each sync
// (a "student-os-synced" event, extension/src/lms-sync.ts); coming back to the tab
// also checks, at most every 30 seconds, in case the signal didn't reach it. New
// courses that need class times open "Add your class times" straight away.

const FOCUS_CHECK_MS = 30_000

export function LiveCourseSync() {
  const { courses, recurringCommitments, reloadCourses } = useAppStore()
  const asked = useAskedCourseIds()
  const [asking, setAsking] = useState<Course[]>([])
  // The latest values, for the event listeners below (set up once).
  const latest = useRef({ courses, recurringCommitments, asked, reloadCourses })
  useEffect(() => {
    latest.current = { courses, recurringCommitments, asked, reloadCourses }
  })

  useEffect(() => {
    let lastCheck = Date.now()
    let running = false
    async function refresh() {
      if (running) return
      running = true
      lastCheck = Date.now()
      try {
        const before = new Set(latest.current.courses.map((course) => course.id))
        const next = await latest.current.reloadCourses()
        if (!next) return
        const { recurringCommitments: commitments, asked: askedIds } = latest.current
        const withTimes = new Set(commitments.map((commitment) => commitment.courseId))
        const arrived = next.filter(
          (course) => !before.has(course.id) && !course.online && !withTimes.has(course.id) && !askedIds?.has(course.id)
        )
        if (arrived.length > 0) setAsking((current) => (current.length > 0 ? current : arrived))
      } finally {
        running = false
      }
    }
    const onSynced = () => void refresh()
    const onVisible = () => {
      if (document.visibilityState === "visible" && Date.now() - lastCheck > FOCUS_CHECK_MS) void refresh()
    }
    document.addEventListener("student-os-synced", onSynced)
    document.addEventListener("visibilitychange", onVisible)
    return () => {
      document.removeEventListener("student-os-synced", onSynced)
      document.removeEventListener("visibilitychange", onVisible)
    }
  }, [])

  const open = asking.length > 0
  return (
    <Dialog open={open} onOpenChange={(next) => !next && setAsking([])}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>New {asking.length === 1 ? "course" : "courses"}: add class times</DialogTitle>
          <DialogDescription>
            Just imported. When each one meets, so it&apos;s on your calendar and the Planner keeps class time free.
          </DialogDescription>
        </DialogHeader>
        {open && <ClassTimesSteps courses={asking} onDone={() => setAsking([])} />}
      </DialogContent>
    </Dialog>
  )
}
