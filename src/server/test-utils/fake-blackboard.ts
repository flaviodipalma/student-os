// Blackboard Learn TEST FIXTURES: hand-written objects shaped after the Learn REST
// API spec (Course Memberships, Gradebook Columns). They are not real Blackboard
// data and no Blackboard is ever contacted.

export const BLACKBOARD_BASE = "https://school.blackboard.com"
export const BLACKBOARD_USER_ID = "_42_1"

// A course membership (GET v1/users/{id}/courses?expand=course).
export const bbMembership = (id: string, overrides: Record<string, unknown> = {}, course: Record<string, unknown> = {}) => ({
  id: `_m${id}`,
  userId: BLACKBOARD_USER_ID,
  courseId: id,
  courseRoleId: "Student",
  availability: { available: "Yes" },
  course: {
    id,
    courseId: `BIO-${id.replace(/\D/g, "")}`,
    name: `Course ${id}`,
    description: "<p>Intro course</p>",
    organization: false,
    availability: { available: "Yes" },
    externalAccessUrl: `${BLACKBOARD_BASE}/ultra/courses/${id}/outline`,
    ...course,
  },
  ...overrides,
})

// A grade column (GET v2/courses/{id}/gradebook/columns).
export const bbColumn = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  name: `Assignment ${id}`,
  description: "<p>Read <b>chapter 3</b> &amp; answer</p>",
  externalGrade: false,
  contentId: `_c${id}`,
  scoreProviderHandle: "resource/x-bb-assignment",
  availability: { available: "Yes" },
  grading: { type: "Attempts", due: "2026-09-26T03:59:00.000Z" }, // Friday 11:59 PM in New York
  ...overrides,
})
