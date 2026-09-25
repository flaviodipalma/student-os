"use client"

import { useEffect, useId, useRef, useState } from "react"
import { searchSchoolsAction } from "@/app/actions/schools"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"

// The School field: type a few letters ("q") and matching schools appear (names
// starting with them first; the list is on the server). Pick one, or keep what you
// typed ("Use …"). An accessible combobox: arrow keys move, Enter picks, Escape closes.

export type SchoolValue = { schoolName: string; schoolDomain: string | null }
type Suggestion = { name: string; domain: string | null; country: string }

// The student's country from their browser's language ("en-US" -> "US"), to list it first.
function countryHint(): string | undefined {
  try {
    return new Intl.Locale(navigator.language).maximize().region
  } catch {
    return undefined
  }
}

export function SchoolField({ value, onChange }: { value: SchoolValue; onChange: (value: SchoolValue) => void }) {
  const id = useId()
  const inputId = `${id}-input`
  const listId = `${id}-list`
  const [open, setOpen] = useState(false)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [active, setActive] = useState(-1)
  const latest = useRef(0)
  const text = value.schoolName

  // Look up matches shortly after typing stops; only the newest answer counts.
  useEffect(() => {
    if (!open || !text.trim()) return
    const request = ++latest.current
    const timer = setTimeout(async () => {
      const result = await searchSchoolsAction(text, countryHint()).catch(() => null)
      if (request !== latest.current) return
      setSuggestions(result?.ok ? result.data : [])
      setActive(-1)
    }, 150)
    return () => clearTimeout(timer)
  }, [text, open])

  const typed = text.trim()
  const exact = suggestions.some((s) => s.name.toLowerCase() === typed.toLowerCase())
  // The options: matches, then "Use what I typed" (when it isn't one of them).
  const options: ({ kind: "school"; school: Suggestion } | { kind: "typed" })[] = [
    ...suggestions.map((school) => ({ kind: "school" as const, school })),
    ...(typed && !exact ? [{ kind: "typed" as const }] : []),
  ]
  const showList = open && typed.length > 0 && options.length > 0

  const choose = (option: (typeof options)[number]) => {
    if (option.kind === "school") onChange({ schoolName: option.school.name, schoolDomain: option.school.domain })
    else onChange({ schoolName: typed, schoolDomain: null })
    setOpen(false)
    setActive(-1)
  }

  return (
    <div className="grid gap-1.5">
      <Label htmlFor={inputId}>
        School<span className="font-normal text-muted-foreground">(optional)</span>
      </Label>
      <div className="relative">
        <Input
          id={inputId}
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 ? `${listId}-${active}` : undefined}
          autoComplete="off"
          placeholder="Start typing, e.g. Quinnipiac"
          value={text}
          onChange={(e) => {
            // Typed text is a school of its own until one is picked from the list.
            onChange({ schoolName: e.target.value, schoolDomain: null })
            setOpen(true)
            if (!e.target.value.trim()) setSuggestions([])
          }}
          onFocus={() => text.trim() && setOpen(true)}
          onBlur={() => setOpen(false)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault()
              setOpen(true)
              setActive((i) => (options.length ? (i + 1) % options.length : -1))
            } else if (e.key === "ArrowUp") {
              e.preventDefault()
              setActive((i) => (options.length ? (i <= 0 ? options.length - 1 : i - 1) : -1))
            } else if (e.key === "Enter" && showList && active >= 0) {
              e.preventDefault()
              choose(options[active])
            } else if (e.key === "Escape" && showList) {
              e.preventDefault()
              setOpen(false)
            }
          }}
        />
        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Schools"
            className="absolute inset-x-0 top-full z-50 mt-1 max-h-72 overflow-y-auto rounded-lg bg-popover p-1 text-sm text-popover-foreground shadow-lg ring-1 ring-border"
          >
            {options.map((option, index) => (
              <li
                key={option.kind === "school" ? `${option.school.name}|${option.school.country}` : "typed"}
                id={`${listId}-${index}`}
                role="option"
                aria-selected={index === active}
                // Keep focus in the field (so the list doesn't close before the click lands).
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(option)}
                onMouseMove={() => setActive(index)}
                className={cn(
                  "flex cursor-pointer items-baseline justify-between gap-3 rounded-md px-2.5 py-2",
                  index === active && "bg-muted",
                  option.kind === "typed" && "border-t border-border-subtle text-muted-foreground"
                )}
              >
                {option.kind === "school" ? (
                  <>
                    <span className="min-w-0">{option.school.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{option.school.country}</span>
                  </>
                ) : (
                  <span>
                    Use &ldquo;<span className="text-foreground">{typed}</span>&rdquo;
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
