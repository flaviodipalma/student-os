// D2L Brightspace TEST FIXTURES: hand-written objects shaped after D2L's Valence API
// reference (MyOrgUnitInfo, DropboxFolder, QuizReadData, EntityDropbox). They are
// not real Brightspace data and no Brightspace is ever contacted.

export const BRIGHTSPACE_BASE = "https://school.brightspace.com"

// One enrollment (GET /d2l/api/lp/{v}/enrollments/myenrollments/), with the course
// offering's dates the extension adds.
export const bsEnrollment = (
  id: number,
  orgUnit: Record<string, unknown> = {},
  access: Record<string, unknown> = {},
  offering: Record<string, unknown> | null = null
) => ({
  OrgUnit: { Id: id, Name: `Course ${id}`, Code: `CRS${id}`, HomeUrl: `/d2l/home/${id}`, Type: { Id: 3, Code: "Course Offering" }, ...orgUnit },
  Access: { IsActive: true, CanAccess: true, ClasslistRoleName: "Student", LISRoles: ["urn:lti:role:ims/lis/Learner"], ...access },
  ...(offering ? { Offering: offering } : {}),
})

// An assignment folder (GET /d2l/api/le/{v}/{orgUnitId}/dropbox/folders/).
export const bsFolder = (id: number, fields: Record<string, unknown> = {}) => ({
  Id: id,
  Name: `Assignment ${id}`,
  CustomInstructions: { Text: "Upload a PDF.", Html: "<p>Upload a PDF.</p>" },
  DueDate: "2026-09-26T03:59:00.000Z",
  IsHidden: false,
  ...fields,
})

// A quiz (GET /d2l/api/le/{v}/{orgUnitId}/quizzes/).
export const bsQuiz = (id: number, fields: Record<string, unknown> = {}) => ({
  QuizId: id,
  Name: `Quiz ${id}`,
  IsActive: true,
  DueDate: "2026-09-30T16:00:00.000Z",
  Description: { Text: { Text: "Chapters 1-3", Html: "" } },
  ...fields,
})

// The student's submission record for a folder (…/submissions/mysubmissions/).
export const bsSubmitted = { Status: 1, Submissions: [{ SubmissionDate: "2026-09-20T15:00:00.000Z" }] }
export const bsNotSubmitted = { Status: 0, Submissions: [] }
