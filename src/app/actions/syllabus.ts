"use server"

import { z } from "zod"
import type { ActionResult } from "@/lib/action-result"
import { courseFields, idSchema, taskFields } from "@/lib/validation"
import { parse, runAction } from "@/server/actions"
import { saveSyllabusImport, type SyllabusImportSaved } from "@/server/services/syllabus"

// Saves a syllabus import the student has reviewed and confirmed. Only called from
// the review screen's "Import into Student OS" button.

const importRequestSchema = z.object({
  course: z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("new"), fields: courseFields }),
    z.object({ kind: z.literal("existing"), courseId: idSchema }),
  ]),
  tasks: z.array(taskFields.omit({ courseId: true }).extend({ id: idSchema })).max(300),
  source: z.object({
    fileName: z.string().trim().min(1).max(255),
    itemsFound: z.int().min(0).max(1000),
  }),
})

export async function importSyllabusAction(request: unknown): Promise<ActionResult<SyllabusImportSaved>> {
  return runAction(({ db, userId }) => saveSyllabusImport(db, userId, parse(importRequestSchema, request)))
}
