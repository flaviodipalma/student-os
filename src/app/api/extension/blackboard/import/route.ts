import { importBlackboardFromExtension } from "@/server/integrations/extension/blackboard-import"
import { extensionImportRoute } from "@/server/integrations/extension/import-route"

// POST /api/extension/blackboard/import: the Student OS browser extension sends the
// student's Blackboard courses, grade columns, grades and recent attempts (read with
// their own Blackboard login), for the Student OS account logged in in that browser.
//
//   X-Student-OS-Extension: 1          (plus the Student OS login cookies)
//   { "baseUrl": "https://school.blackboard.com", "timeZone": "America/New_York",
//     "courses": [...memberships with course expanded],
//     "columns": { "<course id>": [...grade columns] },
//     "grades": { "<course id>": [...the student's grades] },
//     "attempts": { "<column id>": [...the student's attempts] } }
//
// Checks, limits and answers: src/server/integrations/extension/import-route.ts.
export const POST = extensionImportRoute("Blackboard", importBlackboardFromExtension)
