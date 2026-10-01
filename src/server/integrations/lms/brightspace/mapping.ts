import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSubmissionStatus } from "@/lib/lms/types"
import { sameOriginUrl } from "../base-url"
import { htmlToText, termDates, utcToLocalDue } from "../normalize"

// D2L Brightspace (Valence API) objects -> Quadernio's normalized LMS types. Only
// the fields Quadernio uses are read (per D2L's API reference), each one checked.
// Anything malformed is left out rather than guessed.
//
//   enrollment   (GET /d2l/api/lp/{v}/enrollments/myenrollments/)  -> LmsCourse
//     + the course offering (GET /d2l/api/lp/{v}/courses/{orgUnitId}) for its semester dates
//   dropbox folder (GET /d2l/api/le/{v}/{orgUnitId}/dropbox/folders/) -> LmsAssignment
//     + the student's own submissions (…/folders/{id}/submissions/mysubmissions/)
//   quiz         (GET /d2l/api/le/{v}/{orgUnitId}/quizzes/)          -> LmsAssignment
//
// Ids are D2L's numeric ids as strings. A dropbox folder and a quiz can share a
// number, so task ids are prefixed: "dropbox:123", "quiz:456".

const text = z.string().nullish()
const id = z.union([z.number().int().positive(), z.string().regex(/^\d{1,18}$/)]).transform(String)
const richText = z.object({ Text: text, Html: text }).partial().nullish()

const enrollment = z.object({
  OrgUnit: z.object({
    Id: id,
    Name: text,
    Code: text,
    HomeUrl: text,
    Type: z.object({ Id: z.number().nullish(), Code: text }).partial().nullish(),
  }),
  Access: z
    .object({
      IsActive: z.boolean().nullish(),
      CanAccess: z.boolean().nullish(),
      StartDate: text,
      EndDate: text,
      ClasslistRoleName: text,
      LISRoles: z.array(z.string()).nullish(),
    })
    .partial()
    .nullish(),
  // Added by the Quadernio extension from the course offering, when readable.
  Offering: z
    .object({ StartDate: text, EndDate: text, Semester: z.object({ Identifier: text, Name: text }).partial().nullish() })
    .partial()
    .nullish(),
})

const dropboxFolder = z.object({
  Id: id,
  Name: text,
  CustomInstructions: richText,
  DueDate: text,
  IsHidden: z.boolean().nullish(),
})

const quiz = z.object({
  QuizId: id,
  Name: text,
  Description: z.object({ Text: richText }).partial().nullish(),
  DueDate: text,
  IsActive: z.boolean().nullish(),
})

const isLearner = (role: string) => /learner|student/i.test(role)
const isTeaching = (role: string) => /instructor|teacher|teaching\s*assistant|administrator|mentor|content\s*developer|designer/i.test(role)

// Courses Quadernio imports: course offerings the student takes and can open.
// Brightspace roles are named by each school, so the standard LIS roles decide
// when present: someone who only teaches or assists is left out.
export function brightspaceCourseToLms(raw: unknown, baseUrl: string, timeZone?: string): LmsCourse | null {
  const parsed = enrollment.safeParse(raw)
  if (!parsed.success) return null
  const { OrgUnit: unit, Access: access, Offering: offering } = parsed.data
  // Type 3 is a course offering (others: the organization, departments, semesters, groups).
  if (unit.Type?.Id != null && unit.Type.Id !== 3) return null
  if (access?.CanAccess === false || access?.IsActive === false) return null
  const roles = [...(access?.LISRoles ?? []), access?.ClasslistRoleName ?? ""].filter(Boolean)
  if (roles.length > 0 && !roles.some(isLearner) && roles.some(isTeaching)) return null
  const name = unit.Name?.trim() || unit.Code?.trim()
  if (!name) return null
  const homeUrl = unit.HomeUrl?.trim() || `/d2l/home/${unit.Id}`
  return {
    provider: "brightspace",
    externalId: unit.Id,
    courseCode: unit.Code?.trim() || null,
    courseName: name,
    description: null,
    // Brightspace's class list (instructors) isn't open to students at most schools.
    instructor: null,
    url: sameOriginUrl(new URL(homeUrl, baseUrl).href, baseUrl),
    ...(termDates(offering?.StartDate ?? access?.StartDate, offering?.EndDate ?? access?.EndDate, timeZone) ?? {}),
  }
}

export type BrightspaceFolder = z.output<typeof dropboxFolder>
export type BrightspaceQuiz = z.output<typeof quiz>

// Assignment folders the student can see.
export function parseBrightspaceFolder(raw: unknown): BrightspaceFolder | null {
  const parsed = dropboxFolder.safeParse(raw)
  if (!parsed.success || parsed.data.IsHidden || !parsed.data.Name?.trim()) return null
  return parsed.data
}

// Quizzes that are open (active) to the student.
export function parseBrightspaceQuiz(raw: unknown): BrightspaceQuiz | null {
  const parsed = quiz.safeParse(raw)
  if (!parsed.success || parsed.data.IsActive === false || !parsed.data.Name?.trim()) return null
  return parsed.data
}

// The student's own submission records for one folder (EntityDropbox: one per
// student or group) -> graded / submitted / not submitted. Status: 0 unsubmitted,
// 1 submitted, 2 draft, 3 feedback published. Anything unreadable is "unknown".
const entityDropbox = z.object({
  Status: z.number().nullish(),
  CompletionDate: text,
  Submissions: z.array(z.object({ SubmissionDate: text }).partial()).nullish(),
})

export function submissionsStatus(raw: unknown): LmsSubmissionStatus {
  if (!Array.isArray(raw)) return "unknown"
  const entries = raw.map((entry) => entityDropbox.safeParse(entry))
  if (entries.some((entry) => !entry.success)) return "unknown"
  const records = entries.map((entry) => entry.data as z.output<typeof entityDropbox>)
  if (records.some((record) => record.Status === 3)) return "graded"
  const turnedIn = (record: z.output<typeof entityDropbox>) =>
    record.Status === 1 || Boolean(record.CompletionDate) || (record.Submissions ?? []).some((item) => Boolean(item.SubmissionDate))
  return records.some(turnedIn) ? "submitted" : "not_submitted"
}

const plain = (value: { Text?: string | null; Html?: string | null } | null | undefined) =>
  value?.Text?.trim() || (value?.Html ? htmlToText(value.Html) : "") || null

export function brightspaceFolderToLms(
  folder: BrightspaceFolder,
  orgUnitId: string,
  context: { baseUrl: string; timeZone: string | undefined; submissionStatus: LmsSubmissionStatus }
): LmsAssignment {
  // No due date in Brightspace stays no due date (the sync reports it as skipped).
  const due = folder.DueDate ? utcToLocalDue(folder.DueDate, context.timeZone) : null
  return {
    provider: "brightspace",
    externalId: `dropbox:${folder.Id}`,
    courseExternalId: orgUnitId,
    title: (folder.Name as string).trim(),
    description: plain(folder.CustomInstructions),
    dueDate: due?.dueDate ?? null,
    dueTime: due?.dueTime ?? null,
    type: "assignment",
    url: `${context.baseUrl}/d2l/lms/dropbox/user/folder_submit_files.d2l?db=${folder.Id}&ou=${orgUnitId}`,
    estimatedMinutes: null,
    submissionStatus: context.submissionStatus,
  }
}

export function brightspaceQuizToLms(
  item: BrightspaceQuiz,
  orgUnitId: string,
  context: { baseUrl: string; timeZone: string | undefined }
): LmsAssignment {
  const due = item.DueDate ? utcToLocalDue(item.DueDate, context.timeZone) : null
  return {
    provider: "brightspace",
    externalId: `quiz:${item.QuizId}`,
    courseExternalId: orgUnitId,
    title: (item.Name as string).trim(),
    description: plain(item.Description?.Text),
    dueDate: due?.dueDate ?? null,
    dueTime: due?.dueTime ?? null,
    type: "quiz",
    url: `${context.baseUrl}/d2l/lms/quizzing/user/quiz_summary.d2l?qi=${item.QuizId}&ou=${orgUnitId}`,
    estimatedMinutes: null,
    // Students' quiz attempts aren't readable at most schools: left unknown.
    submissionStatus: "unknown",
  }
}
