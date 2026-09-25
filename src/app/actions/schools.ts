"use server"

import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { parse, runAction } from "@/server/actions"
import { searchSchools, type School } from "@/server/schools/search"

// Suggestions for the School field (onboarding and Settings > Profile). `country` is
// a hint from the browser's language (e.g. "US"), so the student's own country comes
// first; anything else is ignored.
export async function searchSchoolsAction(query: unknown, country?: unknown): Promise<ActionResult<School[]>> {
  return runAction(async () => {
    const text = parse(z.string().max(100, "That's too long to search for."), query)
    const hint = z.string().regex(/^[A-Z]{2}$/).safeParse(country)
    return searchSchools(text, { country: hint.success ? hint.data : undefined })
  })
}
