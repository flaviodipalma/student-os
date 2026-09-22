import type { SyllabusErrorCode } from "./errors"
import type { ImportStage } from "./importer"
import type { SyllabusExtraction } from "./schema"

// Messages streamed from POST /api/syllabus/extract, one JSON object per line.
export type ExtractMessage =
  | { type: "stage"; stage: ImportStage }
  | { type: "result"; extraction: SyllabusExtraction; pageCount: number }
  | { type: "error"; code: SyllabusErrorCode; message: string }
