import { getSyllabusAIService } from "@/lib/ai"
import { daysBetween, fromDateKey, toDateKey } from "@/lib/format"
import { SyllabusImportError } from "@/lib/syllabus/errors"
import { processSyllabus } from "@/lib/syllabus/importer"
import { MAX_FILE_BYTES } from "@/lib/syllabus/pdf"
import type { ExtractMessage } from "@/lib/syllabus/protocol"

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
  // Reject oversized uploads before reading them (with room for the form wrapper).
  const declaredSize = Number(request.headers.get("content-length") ?? 0)
  if (declaredSize > MAX_FILE_BYTES + 64 * 1024) return errorResponse(new SyllabusImportError("file-too-large"), 413)

  let file: File
  let today: string
  try {
    const form = await request.formData()
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
        console.warn("[syllabus-import] failed", { code: importError.code, bytes: bytes.length })
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
