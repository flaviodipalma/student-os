import { getSyllabusAIService } from "@/lib/ai"
import { getCurrentUser } from "@/server/auth"
import { RATE_LIMITS, takeRateLimit } from "@/server/rate-limit"
import { daysBetween, fromDateKey, toDateKey } from "@/lib/format"
import { SyllabusImportError } from "@/lib/syllabus/errors"
import { processSyllabus } from "@/lib/syllabus/importer"
import { MAX_FILE_BYTES } from "@/lib/syllabus/pdf"
import type { ExtractMessage } from "@/lib/syllabus/protocol"
import { logger } from "@/server/log"

// POST /api/syllabus/extract (multipart form: "file" = the PDF, "today" = YYYY-MM-DD)
//
// Runs the import pipeline on the server and streams progress back as
// newline-delimited JSON, one message per line:
//   { "type": "stage", "stage": "reading" | "analyzing" | "checking" }
//   { "type": "result", "extraction": {...}, "pageCount": 3 }
//   { "type": "error", "code": "...", "message": "..." }
// Nothing is saved: the PDF is held in memory for this request only, and the
// result goes back to the browser for the student to review.

export const maxDuration = 300

// Room for the multipart wrapper and the "today" field around the PDF.
const FORM_OVERHEAD_BYTES = 64 * 1024

// The request body, read up to `limit` bytes (then abandoned).
async function readLimited(request: Request, limit: number): Promise<Uint8Array<ArrayBuffer> | "too-large"> {
  if (!request.body) return new Uint8Array(new ArrayBuffer(0))
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > limit) {
      await reader.cancel().catch(() => {})
      return "too-large"
    }
    chunks.push(value)
  }
  const body = new Uint8Array(new ArrayBuffer(total))
  let offset = 0
  for (const chunk of chunks) {
    body.set(chunk, offset)
    offset += chunk.byteLength
  }
  return body
}

function errorResponse(error: SyllabusImportError, status: number) {
  const body: ExtractMessage = { type: "error", code: error.code, message: error.userMessage }
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } })
}

// The student's "today" (sent by the browser, so time zones line up), as long as
// it's within a day or two of the server's date. Otherwise the server's date.
function studentToday(value: FormDataEntryValue | null): string {
  const serverToday = toDateKey(new Date())
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return serverToday
  return Math.abs(daysBetween(fromDateKey(serverToday), fromDateKey(value))) <= 2 ? value : serverToday
}

export async function POST(request: Request) {
  // Only signed-in students can use the importer (and the AI budget).
  const user = await getCurrentUser()
  if (!user) return errorResponse(new SyllabusImportError("unauthorized"), 401)
  // Each import is a paid AI request.
  if (!takeRateLimit(`syllabus:${user.id}`, RATE_LIMITS.syllabus).ok) return errorResponse(new SyllabusImportError("rate-limited"), 429)

  // Reject oversized uploads: by the declared size, and by counting the bytes as
  // they arrive (a request without Content-Length can't make the server buffer
  // more than the limit).
  const limit = MAX_FILE_BYTES + FORM_OVERHEAD_BYTES
  const declaredSize = Number(request.headers.get("content-length") ?? 0)
  if (declaredSize > limit) return errorResponse(new SyllabusImportError("file-too-large"), 413)
  const body = await readLimited(request, limit)
  if (body === "too-large") return errorResponse(new SyllabusImportError("file-too-large"), 413)

  let file: File
  let today: string
  try {
    const form = await new Response(body, { headers: { "Content-Type": request.headers.get("content-type") ?? "" } }).formData()
    const entry = form.get("file")
    if (!(entry instanceof File)) return errorResponse(new SyllabusImportError("invalid-file-type"), 400)
    file = entry
    today = studentToday(form.get("today"))
  } catch {
    return errorResponse(new SyllabusImportError("invalid-file-type"), 400)
  }

  const bytes = new Uint8Array(await file.arrayBuffer())
  const encoder = new TextEncoder()

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (message: ExtractMessage) => controller.enqueue(encoder.encode(JSON.stringify(message) + "\n"))
      try {
        const result = await processSyllabus(
          { name: file.name, type: file.type, size: file.size, bytes },
          { ai: getSyllabusAIService(), today, onStage: (stage) => send({ type: "stage", stage }) }
        )
        send({ type: "result", ...result })
      } catch (error) {
        const importError =
          error instanceof SyllabusImportError ? error : new SyllabusImportError("ai-failed", { cause: error })
        // Log the error kind only, never the syllabus contents.
        logger.warn("syllabus-import", "failed", { code: importError.code, bytes: bytes.length })
        send({ type: "error", code: importError.code, message: importError.userMessage })
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-store" },
  })
}
