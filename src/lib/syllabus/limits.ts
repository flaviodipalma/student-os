// Upload limits, shared by the browser check and the server.
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

// Plenty for any syllabus (roughly 40 pages of dense text). Longer input is
// rejected rather than silently cut off, so no deadlines go missing unnoticed.
export const MAX_TEXT_CHARS = 150_000

// A syllabus is a few pages; a PDF with hundreds of pages isn't one, and parsing
// it would only cost server time. Checked before any text is extracted.
export const MAX_PDF_PAGES = 100
