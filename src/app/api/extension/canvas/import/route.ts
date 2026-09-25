import { getDb } from "@/server/db"
import { AppError, toAppError } from "@/server/errors"
import { importCanvasFromExtension, MAX_IMPORT_BYTES } from "@/server/integrations/extension/canvas-import"
import { extensionJson as json, extensionUser } from "@/server/integrations/extension/http"
import { errorName, logger } from "@/server/log"
import { RATE_LIMITS, RATE_LIMITED_MESSAGE, takeRateLimit } from "@/server/rate-limit"
import { readLimited } from "@/server/read-limited"

// POST /api/extension/canvas/import: the Student OS browser extension sends the
// student's Canvas courses and assignments (read with their own Canvas login), for
// the Student OS account logged in in that browser.
//
//   X-Student-OS-Extension: 1          (plus the Student OS login cookies)
//   { "baseUrl": "https://school.instructure.com", "timeZone": "America/New_York",
//     "courses": [...Canvas courses], "assignments": { "<course id>": [...Canvas assignments] } }
//
// -> 200 { "result": LmsSyncResult }, or { "error": "<safe message>" } with 400 / 401
// (logged out) / 403 (not the extension) / 413 / 429 / 503. No CORS headers: the
// extension's host permission covers it; websites get nothing. See http.ts.

const TOO_LARGE = "That's more Canvas data than Student OS can take at once."

export async function POST(request: Request) {
  try {
    const owner = await extensionUser(request)
    if (owner instanceof Response) return owner
    const db = getDb()

    // Shares the student's sync allowance with "Sync now" on the Integrations page.
    if (!takeRateLimit(`sync:${owner.userId}`, RATE_LIMITS.sync).ok) return json({ error: RATE_LIMITED_MESSAGE }, 429)

    const declared = Number(request.headers.get("content-length"))
    if (declared > MAX_IMPORT_BYTES) return json({ error: TOO_LARGE }, 413)
    const body = await readLimited(request, MAX_IMPORT_BYTES)
    if (body === "too-large") return json({ error: TOO_LARGE }, 413)
    let payload: unknown
    try {
      payload = JSON.parse(new TextDecoder().decode(body))
    } catch {
      return json({ error: "That doesn't look like Canvas data. Update the extension and try again." }, 400)
    }

    const result = await importCanvasFromExtension(db, owner.userId, payload)
    return json({ result })
  } catch (error) {
    const appError = toAppError(error)
    if (!(error instanceof AppError)) logger.error("extension-import", "failed", { name: errorName(error) })
    return json({ error: appError.message }, appError.code === "validation" ? 400 : 503)
  }
}
