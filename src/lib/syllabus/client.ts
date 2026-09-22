import { SyllabusImportError, syllabusErrorMessages, type SyllabusErrorCode } from "./errors"
import type { ImportStage } from "./importer"
import { MAX_FILE_BYTES } from "./limits"
import type { ExtractMessage } from "./protocol"
import type { SyllabusExtraction } from "./schema"

// Browser side of the upload: sends the PDF to the server and reads the
// progress messages it streams back. Returns the extraction for review.

// Quick checks before uploading, with the same messages the server uses.
export function checkFileInBrowser(file: File): SyllabusErrorCode | null {
  if (file.size === 0) return "empty-file"
  if (file.size > MAX_FILE_BYTES) return "file-too-large"
  if (file.type !== "application/pdf" && !file.name.toLowerCase().endsWith(".pdf")) return "invalid-file-type"
  return null
}

const CLIENT_TIMEOUT_MS = 5 * 60 * 1000

export async function requestExtraction(
  file: File,
  today: string,
  { signal, onStage }: { signal: AbortSignal; onStage: (stage: ImportStage) => void }
): Promise<{ extraction: SyllabusExtraction; pageCount: number }> {
  const body = new FormData()
  body.set("file", file)
  body.set("today", today)

  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS)
  let response: Response
  try {
    response = await fetch("/api/syllabus/extract", {
      method: "POST",
      body,
      signal: AbortSignal.any([signal, timeout]),
    })
  } catch (error) {
    if (signal.aborted) throw error
    throw new SyllabusImportError(timeout.aborted ? "ai-timeout" : "network", { cause: error })
  }

  if (!response.body) throw new SyllabusImportError("network")
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ""
  try {
    while (true) {
      const { value, done } = await reader.read()
      if (value) buffer += value
      const lines = buffer.split("\n")
      buffer = done ? "" : (lines.pop() ?? "")
      for (const line of lines) {
        if (!line.trim()) continue
        const message = JSON.parse(line) as ExtractMessage
        if (message.type === "stage") onStage(message.stage)
        else if (message.type === "result") return { extraction: message.extraction, pageCount: message.pageCount }
        else if (message.type === "error") {
          throw new SyllabusImportError(message.code in syllabusErrorMessages ? message.code : "ai-failed")
        }
      }
      if (done) break
    }
  } catch (error) {
    if (error instanceof SyllabusImportError || signal.aborted) throw error
    throw new SyllabusImportError(timeout.aborted ? "ai-timeout" : "network", { cause: error })
  }
  // The stream ended without a result.
  throw new SyllabusImportError("network")
}
