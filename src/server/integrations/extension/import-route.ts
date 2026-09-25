import "server-only"

import type { LmsSyncResult } from "@/lib/lms/types"
import { getDb } from "../../db"
import type { Database } from "../../db/types"
import { AppError, toAppError } from "../../errors"
import { errorName, logger } from "../../log"
import { RATE_LIMITS, RATE_LIMITED_MESSAGE, takeRateLimit } from "../../rate-limit"
import { readLimited } from "../../read-limited"
import { extensionJson as json, extensionUser } from "./http"

// The browser extension's import endpoints (/api/extension/<lms>/import) share one
// shape: the Student OS login plus the extension check (http.ts), the student's Sync
// now allowance, a size limit, JSON, then the LMS's own import. Answers
// 200 { result: LmsSyncResult }, or { error } with 400 / 401 (logged out) /
// 403 (not the extension) / 413 / 429 / 503.

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024

type Importer = (db: Database, userId: string, payload: unknown) => Promise<LmsSyncResult>

export function extensionImportRoute(lmsName: string, importer: Importer) {
  const tooLarge = `That's more ${lmsName} data than Student OS can take at once.`
  const notData = `That doesn't look like ${lmsName} data. Update the extension and try again.`

  return async function POST(request: Request): Promise<Response> {
    try {
      const owner = await extensionUser(request)
      if (owner instanceof Response) return owner
      const db = getDb()

      // Shares the student's sync allowance with "Sync now" on the Integrations page.
      if (!takeRateLimit(`sync:${owner.userId}`, RATE_LIMITS.sync).ok) return json({ error: RATE_LIMITED_MESSAGE }, 429)

      const declared = Number(request.headers.get("content-length"))
      if (declared > MAX_IMPORT_BYTES) return json({ error: tooLarge }, 413)
      const body = await readLimited(request, MAX_IMPORT_BYTES)
      if (body === "too-large") return json({ error: tooLarge }, 413)
      let payload: unknown
      try {
        payload = JSON.parse(new TextDecoder().decode(body))
      } catch {
        return json({ error: notData }, 400)
      }

      return json({ result: await importer(db, owner.userId, payload) })
    } catch (error) {
      const appError = toAppError(error)
      if (!(error instanceof AppError)) logger.error("extension-import", "failed", { lms: lmsName, name: errorName(error) })
      return json({ error: appError.message }, appError.code === "validation" ? 400 : 503)
    }
  }
}
