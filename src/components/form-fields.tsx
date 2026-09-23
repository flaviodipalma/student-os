"use client"

import { cloneElement, isValidElement, useState } from "react"
import type { z } from "zod"
import { Label } from "@/components/ui/label"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

// Small form building blocks shared by the app's forms (tasks, courses, events,
// settings). Validation messages show right under the field they're about.

export type Option<T extends string> = { value: T; label: string }

export function Field({
  label,
  htmlFor,
  optional,
  error,
  children,
}: {
  label: string
  htmlFor: string
  optional?: boolean
  // A problem with this field, shown under it (and linked for screen readers).
  error?: string
  children: React.ReactNode
}) {
  const errorId = `${htmlFor}-error`
  const control =
    error && isValidElement<Record<string, unknown>>(children)
      ? cloneElement(children, { "aria-invalid": true, "aria-describedby": errorId })
      : children
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={htmlFor}>
        {label}
        {optional && <span className="font-normal text-muted-foreground">(optional)</span>}
      </Label>
      {control}
      {error && (
        <p id={errorId} className="text-xs font-medium text-destructive">
          {error}
        </p>
      )}
    </div>
  )
}

// Per-field validation messages for a form, from the same Zod rules the server
// checks. `show` sets them and moves focus to the first problem; editing a
// field clears its message.
export function useFieldErrors<K extends string>(ids: Record<K, string>) {
  const [errors, setErrors] = useState<Partial<Record<K, string>>>({})
  return {
    errors,
    // Returns a message for problems that don't belong to a field (or null).
    show(error: z.ZodError): string | null {
      const next: Partial<Record<K, string>> = {}
      let general: string | null = null
      for (const issue of error.issues) {
        const key = String(issue.path[0] ?? "") as K
        if (key in ids) next[key] ??= issue.message
        else general ??= issue.message
      }
      setErrors(next)
      const first = (Object.keys(ids) as K[]).find((key) => next[key])
      if (first) document.getElementById(ids[first])?.focus()
      return general
    },
    set(key: K, message: string) {
      setErrors((prev) => ({ ...prev, [key]: message }))
      document.getElementById(ids[key])?.focus()
    },
    clear(key: K) {
      setErrors((prev) => (prev[key] ? { ...prev, [key]: undefined } : prev))
    },
    reset() {
      setErrors({})
    },
  }
}

export function SimpleSelect<T extends string>({
  id,
  value,
  onChange,
  options,
}: {
  id: string
  value: T
  onChange: (value: T) => void
  options: Option<T>[]
}) {
  return (
    <Select items={options} value={value} onValueChange={(next) => next && onChange(next as T)}>
      <SelectTrigger id={id} className="w-full">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
