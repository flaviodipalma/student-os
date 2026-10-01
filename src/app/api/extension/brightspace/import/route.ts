import { importBrightspaceFromExtension } from "@/server/integrations/extension/brightspace-import"
import { extensionImportRoute } from "@/server/integrations/extension/import-route"

// POST /api/extension/brightspace/import: the Quadernio browser extension sends the
// student's D2L Brightspace courses, assignment folders, quizzes and their own
// submissions (read with their own Brightspace login), for the Quadernio account
// logged in in that browser.
//
//   X-Quadernio-Extension: 1          (plus the Quadernio login cookies)
//   { "baseUrl": "https://school.brightspace.com", "timeZone": "America/New_York",
//     "courses": [...enrollments with their course offering's dates],
//     "folders": { "<org unit id>": [...dropbox folders] },
//     "quizzes": { "<org unit id>": [...quizzes] },
//     "submissions": { "<folder id>": [...the student's submission records] } }
//
// Checks, limits and answers: src/server/integrations/extension/import-route.ts.
export const POST = extensionImportRoute("Brightspace D2L", importBrightspaceFromExtension)
