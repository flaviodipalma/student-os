// The contract every syllabus AI provider implements. The rest of the app only
// knows about this interface, so the provider (Claude today) can be swapped
// without touching the importer.

export type SyllabusAIContext = {
  // "YYYY-MM-DD". Lets the model work out a missing year safely.
  today: string
}

export interface SyllabusAIService {
  // Returns the model's structured answer. The result is treated as untrusted:
  // the importer validates it (src/lib/syllabus/validate.ts) before using it.
  // Throws SyllabusImportError for failures the student should hear about.
  extractSyllabusData(text: string, context: SyllabusAIContext): Promise<unknown>
}
