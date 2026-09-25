import "server-only"

import rawSchools from "./schools.json"

// Suggestions for the School field (profile). The list (schools.json, ~12,000
// schools: official US names from IPEDS, the rest from the "world universities and
// domains" list; see NOTICE.txt and scripts/build-school-list.mjs) stays on the
// server; the browser only ever gets the few matches.
//
// Order: names starting with what was typed, then names with a word starting with
// it; within each, the student's country first (a hint from their browser's
// language), then A-Z. Case and accents don't matter.

export type School = { name: string; domain: string | null; country: string }

// "Córdoba" -> "cordoba"; punctuation becomes spaces, so words can be matched.
export const normalizeSchoolText = (text: string) =>
  text
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()

const schools = (rawSchools as [string, string | null, string][]).map(([name, domain, country]) => ({
  school: { name, domain, country } satisfies School,
  // Spaces around it: " <words> ", so " q" finds a word starting with q.
  search: ` ${normalizeSchoolText(name)} `,
}))

export const MAX_SCHOOL_SUGGESTIONS = 8

export function searchSchools(query: string, options: { country?: string; limit?: number } = {}): School[] {
  const q = normalizeSchoolText(query.slice(0, 100))
  if (!q) return []
  const limit = options.limit ?? MAX_SCHOOL_SUGGESTIONS
  const starts: typeof schools = []
  const words: typeof schools = []
  for (const entry of schools) {
    if (entry.search.startsWith(` ${q}`)) starts.push(entry)
    else if (entry.search.includes(` ${q}`)) words.push(entry)
  }
  const byCountry = (a: (typeof schools)[number], b: (typeof schools)[number]) =>
    Number(b.school.country === options.country) - Number(a.school.country === options.country) || a.school.name.localeCompare(b.school.name)
  return [...starts.sort(byCountry), ...words.sort(byCountry)].slice(0, limit).map((entry) => entry.school)
}
