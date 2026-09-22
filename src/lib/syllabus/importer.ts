import type { SyllabusAIService } from "@/lib/ai/syllabus-ai-service"
import { SyllabusImportError } from "./errors"
import { checkUpload, extractPdfText, type PdfText, type Upload } from "./pdf"
import type { SyllabusExtraction } from "./schema"
import { validateExtraction } from "./validate"

// The server side of the importer, one step at a time:
//   check the upload -> extract PDF text -> AI structured extraction -> validation
// It returns data for the student to review; it never creates courses or tasks.

export type ImportStage = "reading" | "analyzing" | "checking"

export type ProcessDeps = {
  ai: SyllabusAIService
  today: string
  // Swappable for tests.
  extractText?: (bytes: Uint8Array) => Promise<PdfText>
  onStage?: (stage: ImportStage) => void
}

export type ProcessResult = { extraction: SyllabusExtraction; pageCount: number }

export async function processSyllabus(upload: Upload, deps: ProcessDeps): Promise<ProcessResult> {
  checkUpload(upload)

  deps.onStage?.("reading")
  const { text, pageCount } = await (deps.extractText ?? extractPdfText)(upload.bytes)

  deps.onStage?.("analyzing")
  let raw: unknown
  try {
    raw = await deps.ai.extractSyllabusData(text, { today: deps.today })
  } catch (error) {
    throw error instanceof SyllabusImportError ? error : new SyllabusImportError("ai-failed", { cause: error })
  }

  deps.onStage?.("checking")
  return { extraction: validateExtraction(raw, deps.today), pageCount }
}
