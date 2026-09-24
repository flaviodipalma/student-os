import { extractText, getDocumentProxy } from "unpdf"
import { SyllabusImportError } from "./errors"
import { MAX_FILE_BYTES, MAX_PDF_PAGES, MAX_TEXT_CHARS } from "./limits"

// Step 1 of the pipeline: check the upload and pull the text out of the PDF.
// Runs on the server. The file is only held in memory and never stored.

export { MAX_FILE_BYTES, MAX_TEXT_CHARS }

export type Upload = { name: string; type: string; size: number; bytes: Uint8Array }

export function checkUpload(upload: Upload): void {
  if (upload.size === 0 || upload.bytes.length === 0) throw new SyllabusImportError("empty-file")
  if (upload.size > MAX_FILE_BYTES || upload.bytes.length > MAX_FILE_BYTES) {
    throw new SyllabusImportError("file-too-large")
  }
  const looksLikePdf = upload.type === "application/pdf" || upload.name.toLowerCase().endsWith(".pdf")
  // Every PDF starts with "%PDF-", whatever its name says.
  const header = new TextDecoder().decode(upload.bytes.slice(0, 5))
  if (!looksLikePdf || header !== "%PDF-") throw new SyllabusImportError("invalid-file-type")
}

export type PdfText = { text: string; pageCount: number }

export async function extractPdfText(bytes: Uint8Array): Promise<PdfText> {
  let pages: string[]
  let pageCount: number
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>>
  try {
    // pdf.js may take ownership of the buffer, so give it a copy.
    pdf = await getDocumentProxy(new Uint8Array(bytes))
  } catch (error) {
    throw new SyllabusImportError("pdf-unreadable", { cause: error })
  }
  if (pdf.numPages > MAX_PDF_PAGES) throw new SyllabusImportError("too-long")
  try {
    const result = await extractText(pdf, { mergePages: false })
    pages = result.text
    pageCount = result.totalPages
  } catch (error) {
    throw new SyllabusImportError("pdf-unreadable", { cause: error })
  }

  const text = normalizeText(pages.join("\n\n"))
  // A scanned or image-only PDF has pages but (almost) no text layer.
  const letters = text.replace(/[^\p{L}\p{N}]/gu, "").length
  if (letters < 40 || letters < pageCount * 15) throw new SyllabusImportError("no-text")
  if (text.length > MAX_TEXT_CHARS) throw new SyllabusImportError("too-long")
  return { text, pageCount }
}

// Tidies whitespace while keeping line breaks, which carry table/list structure.
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}
