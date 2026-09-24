// Server logs for Student OS (see docs/security.md, "Logging").
//
// One line per event: JSON in production (so the hosting platform / a log
// service can search and alert on it), readable text in development.
//
//   logger.error("calendar:google", "sync failed", { kind: "rate-limited" })
//   -> {"level":"error","time":"…","scope":"calendar:google","msg":"sync failed","kind":"rate-limited"}
//
// Fields are for diagnosis only: error types, codes, providers, sizes, timings.
// Never tokens, passwords, keys, event contents, syllabus text or conversations.
// As a safety net, fields whose names look secret are replaced, and long
// strings are cut.

type Level = "debug" | "info" | "warn" | "error"
type Fields = Record<string, unknown>

const SECRET_NAME = /token|secret|password|passwd|authorization|cookie|api[-_]?key|credential|session|code_verifier|refresh/i
const MAX_STRING = 200

function clean(fields: Fields | undefined): Fields {
  const out: Fields = {}
  for (const [key, value] of Object.entries(fields ?? {})) {
    if (SECRET_NAME.test(key)) out[key] = "[redacted]"
    else if (typeof value === "string") out[key] = value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value
    else if (value instanceof Error) out[key] = value.name
    else if (value === null || ["number", "boolean", "undefined"].includes(typeof value)) out[key] = value
    // Objects and arrays aren't logged (they're where private data hides).
    else out[key] = `[${Array.isArray(value) ? "array" : typeof value}]`
  }
  return out
}

function write(level: Level, scope: string, msg: string, fields?: Fields) {
  if (level === "debug" && process.env.NODE_ENV === "production") return
  const safe = clean(fields)
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log
  if (process.env.NODE_ENV === "production") {
    sink(JSON.stringify({ level, time: new Date().toISOString(), scope, msg, ...safe }))
  } else {
    sink(`[${scope}] ${msg}`, ...(Object.keys(safe).length ? [safe] : []))
  }
}

export const logger = {
  debug: (scope: string, msg: string, fields?: Fields) => write("debug", scope, msg, fields),
  info: (scope: string, msg: string, fields?: Fields) => write("info", scope, msg, fields),
  warn: (scope: string, msg: string, fields?: Fields) => write("warn", scope, msg, fields),
  error: (scope: string, msg: string, fields?: Fields) => write("error", scope, msg, fields),
}

// The safe description of something thrown: its type, never its message (which
// can contain SQL, URLs or tokens).
export const errorName = (error: unknown) => (error instanceof Error ? error.name : typeof error)
