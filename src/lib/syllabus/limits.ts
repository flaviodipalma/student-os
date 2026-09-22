// Upload limits, shared by the browser check and the server.
export const MAX_FILE_BYTES = 10 * 1024 * 1024 // 10 MB

// Plenty for any syllabus (roughly 40 pages of dense text). Longer input is
// rejected rather than silently cut off, so no deadlines go missing unnoticed.
export const MAX_TEXT_CHARS = 150_000
