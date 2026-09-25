import { importCanvasFromExtension } from "@/server/integrations/extension/canvas-import"
import { extensionImportRoute } from "@/server/integrations/extension/import-route"

// POST /api/extension/canvas/import: the Student OS browser extension sends the
// student's Canvas courses and assignments (read with their own Canvas login), for
// the Student OS account logged in in that browser.
//
//   X-Student-OS-Extension: 1          (plus the Student OS login cookies)
//   { "baseUrl": "https://school.instructure.com", "timeZone": "America/New_York",
//     "courses": [...Canvas courses], "assignments": { "<course id>": [...Canvas assignments] } }
//
// Checks, limits and answers: src/server/integrations/extension/import-route.ts.
// No CORS headers: the extension's host permission covers it; websites get nothing.
export const POST = extensionImportRoute("Canvas", importCanvasFromExtension)
