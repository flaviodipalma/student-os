// Every way a syllabus import can fail, with a message that's safe to show a student.
// Internal details (stack traces, API errors) are never passed to the browser.

export type SyllabusErrorCode =
  | "invalid-file-type"
  | "file-too-large"
  | "empty-file"
  | "no-text"
  | "pdf-unreadable"
  | "too-long"
  | "not-a-syllabus"
  | "ai-not-configured"
  | "ai-failed"
  | "ai-busy"
  | "ai-timeout"
  | "ai-invalid-response"
  | "network"
  | "unauthorized"

export const syllabusErrorMessages: Record<SyllabusErrorCode, string> = {
  "invalid-file-type": "That file isn't a PDF. Please upload your syllabus as a PDF.",
  "file-too-large": "That PDF is too large. Please upload a file under 10 MB.",
  "empty-file": "That file is empty. Please choose your syllabus PDF again.",
  "no-text":
    "We couldn't extract readable text from this PDF. It may be a scan or a photo. Try uploading a text-based syllabus.",
  "pdf-unreadable": "We couldn't open this PDF. It may be damaged or password-protected.",
  "too-long": "This PDF has more text than a syllabus usually does. Try uploading just the syllabus pages.",
  "not-a-syllabus": "We couldn't find any course details or deadlines in this PDF. Is it a syllabus?",
  "ai-not-configured": "Syllabus import isn't set up yet on this server.",
  "ai-failed": "Something went wrong while reading your syllabus. Please try again.",
  "ai-busy": "The syllabus reader is busy right now. Please try again in a minute.",
  "ai-timeout": "Reading your syllabus took too long. Please try again.",
  "ai-invalid-response": "We couldn't make sense of the results for this syllabus. Please try again.",
  network: "We couldn't reach the server. Check your connection and try again.",
  unauthorized: "Your session has expired. Please log in again.",
}

export class SyllabusImportError extends Error {
  readonly code: SyllabusErrorCode

  constructor(code: SyllabusErrorCode, options?: { cause?: unknown }) {
    super(syllabusErrorMessages[code], options)
    this.name = "SyllabusImportError"
    this.code = code
  }

  get userMessage(): string {
    return syllabusErrorMessages[this.code]
  }
}
