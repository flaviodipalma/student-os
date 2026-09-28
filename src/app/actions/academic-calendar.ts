"use server"

import type { ActionResult } from "@/lib/action-result"
import type { AcademicEvent } from "@/lib/types"
import { academicEventSchema, academicEventsSchema, createAcademicEventSchema, idSchema } from "@/lib/validation"
import { parse, runAction } from "@/server/actions"
import { createAcademicEvent, deleteAcademicEvent, replaceAcademicEvents, updateAcademicEvent } from "@/server/services/academic-calendar"

// The academic calendar in Settings: add, change or remove a date. The student is
// always the signed-in one (from the session).

export async function createAcademicEventAction(input: unknown): Promise<ActionResult<AcademicEvent>> {
  return runAction(({ db, userId }) => createAcademicEvent(db, userId, parse(createAcademicEventSchema, input)))
}

export async function updateAcademicEventAction(id: unknown, input: unknown): Promise<ActionResult<AcademicEvent>> {
  return runAction(({ db, userId }) => updateAcademicEvent(db, userId, parse(idSchema, id), parse(academicEventSchema, input)))
}

export async function deleteAcademicEventAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await deleteAcademicEvent(db, userId, parse(idSchema, id))
    return null
  })
}

// The student confirmed a calendar (found on their school's website, or read from a
// link or PDF): it replaces their academic calendar.
export async function confirmAcademicCalendarAction(events: unknown): Promise<ActionResult<AcademicEvent[]>> {
  return runAction(({ db, userId }) => replaceAcademicEvents(db, userId, parse(academicEventsSchema, events)))
}
