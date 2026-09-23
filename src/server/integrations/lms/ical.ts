import "server-only"

import { wallClockIn } from "@/lib/time-zone"

// A small iCalendar (RFC 5545) reader: just what's needed to read an LMS
// calendar feed (Canvas, Blackboard). Handles folded lines, escaped text, and
// the kinds of start time they write: UTC ("...Z" or TZID=UTC), another TZID
// (Blackboard: TZID=America/New_York), and all-day dates (VALUE=DATE).

export type IcsStart = { kind: "date"; date: string } | { kind: "instant"; instant: Date }

export type IcsEvent = {
  uid: string | null
  summary: string | null
  description: string | null
  url: string | null
  start: IcsStart | null
}

type Property = { name: string; params: Record<string, string>; value: string }

// Lines that start with a space or tab continue the previous line (RFC 5545 3.1).
function unfold(text: string): string[] {
  const lines: string[] = []
  for (const raw of text.split(/\r?\n/)) {
    if ((raw.startsWith(" ") || raw.startsWith("\t")) && lines.length > 0) lines[lines.length - 1] += raw.slice(1)
    else lines.push(raw)
  }
  return lines
}

function parseLine(line: string): Property | null {
  // NAME;PARAM=value;PARAM="quoted:value":VALUE  (the first colon outside quotes ends the name part)
  let inQuotes = false
  let colon = -1
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') inQuotes = !inQuotes
    else if (line[i] === ":" && !inQuotes) {
      colon = i
      break
    }
  }
  if (colon <= 0) return null
  const [name, ...paramParts] = line.slice(0, colon).split(";")
  const params: Record<string, string> = {}
  for (const part of paramParts) {
    const eq = part.indexOf("=")
    if (eq > 0) params[part.slice(0, eq).toUpperCase()] = part.slice(eq + 1).replace(/^"|"$/g, "")
  }
  return { name: name.toUpperCase(), params, value: line.slice(colon + 1) }
}

// TEXT values escape \\ \; \, and newlines (\n or \N).
export function unescapeText(value: string): string {
  return value.replace(/\\([\\;,nN])/g, (_, char: string) => (char === "n" || char === "N" ? "\n" : char))
}

// Wall-clock time in a time zone -> the instant it happened.
function zonedToInstant(parts: number[], timeZone: string): Date | null {
  const [y, mo, d, h, mi, s] = parts
  const asUtc = Date.UTC(y, mo, d, h, mi, s)
  try {
    // The zone's offset at that moment, then corrected once for DST edges.
    let guess = asUtc
    for (let i = 0; i < 2; i++) {
      const [wy, wmo, wd, wh, wmi, ws] = wallClockIn(timeZone, new Date(guess))
      guess -= Date.UTC(wy, wmo, wd, wh, wmi, ws) - asUtc
    }
    return new Date(guess)
  } catch {
    return null
  }
}

function parseStart(property: Property): IcsStart | null {
  const value = property.value.trim()
  const date = value.match(/^(\d{4})(\d{2})(\d{2})$/)
  if (property.params.VALUE === "DATE" || date) {
    return date ? { kind: "date", date: `${date[1]}-${date[2]}-${date[3]}` } : null
  }
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/)
  if (!match) return null
  const parts = [Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6])]
  const tzid = property.params.TZID
  if (match[7] === "Z" || !tzid || /^(UTC|Etc\/UTC|GMT|Z)$/i.test(tzid)) {
    const instant = new Date(Date.UTC(parts[0], parts[1], parts[2], parts[3], parts[4], parts[5]))
    return Number.isNaN(instant.getTime()) ? null : { kind: "instant", instant }
  }
  const instant = zonedToInstant(parts, tzid)
  return instant ? { kind: "instant", instant } : null
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = []
  let current: IcsEvent | null = null
  for (const line of unfold(text)) {
    const property = parseLine(line)
    if (!property) continue
    if (property.name === "BEGIN" && property.value.trim().toUpperCase() === "VEVENT") {
      current = { uid: null, summary: null, description: null, url: null, start: null }
    } else if (property.name === "END" && property.value.trim().toUpperCase() === "VEVENT") {
      if (current) events.push(current)
      current = null
    } else if (current) {
      if (property.name === "UID") current.uid = property.value.trim()
      else if (property.name === "SUMMARY") current.summary = unescapeText(property.value)
      else if (property.name === "DESCRIPTION") current.description = unescapeText(property.value)
      else if (property.name === "URL") current.url = property.value.trim()
      else if (property.name === "DTSTART") current.start = parseStart(property)
    }
  }
  return events
}

// Quick check that a response looks like a calendar at all.
export function looksLikeIcs(text: string): boolean {
  return /^\s*BEGIN:VCALENDAR/i.test(text)
}
