"use client"

import { useSyncExternalStore } from "react"

// Courses the student has already been asked about class times (saved them, or
// skipped after the warning), so the "add your class times" notice doesn't keep
// asking. Kept in this browser only: it's a convenience; the course page always
// shows whether a course has class times.

const KEY = "student-os:class-times-asked"
const EVENT = "student-os:class-times-asked"

function read(): string {
  try {
    return localStorage.getItem(KEY) ?? "[]"
  } catch {
    return "[]"
  }
}

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange)
  window.addEventListener(EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(EVENT, onChange)
  }
}

function parse(raw: string): string[] {
  try {
    const value: unknown = JSON.parse(raw)
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : []
  } catch {
    return []
  }
}

// null while rendering on the server (nothing is known there yet).
export function useAskedCourseIds(): Set<string> | null {
  const raw = useSyncExternalStore(subscribe, read, () => null)
  return raw === null ? null : new Set(parse(raw))
}

export function markCoursesAsked(ids: string[]) {
  const next = [...new Set([...parse(read()), ...ids])].slice(-500)
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    // Storage blocked: the notice may ask again, which is harmless.
  }
  window.dispatchEvent(new Event(EVENT))
}
