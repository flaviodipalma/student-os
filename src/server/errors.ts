import { logger } from "@/server/log"

// Errors the server can report to a student, and the safe message for each.
// Database errors, SQL and stack traces are logged on the server only.

export class AppError extends Error {
  constructor(
    readonly code: "not-found" | "validation" | "duplicate" | "unauthorized" | "database" | "unavailable",
    message: string
  ) {
    super(message)
    this.name = "AppError"
  }
}

export class NotFoundError extends AppError {
  // Same message whether the record doesn't exist or belongs to someone else,
  // so an id can't be used to probe other users' data.
  constructor(what = "item") {
    super("not-found", `That ${what} doesn't exist or was already removed.`)
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super("validation", message)
  }
}

export class DuplicateError extends AppError {
  constructor(message: string) {
    super("duplicate", message)
  }
}

export class UnauthorizedError extends AppError {
  constructor() {
    super("unauthorized", "Your session has expired. Please log in again.")
  }
}

// Too many expensive requests (AI, external syncs) in a short time.
export class RateLimitedError extends AppError {
  constructor() {
    super("unavailable", "You're doing that a lot right now. Please wait a few minutes and try again.")
  }
}

export class DatabaseUnavailableError extends AppError {
  constructor() {
    super("database", "We couldn't reach the database. Please try again in a moment.")
  }
}

// Postgres error codes: https://www.postgresql.org/docs/current/errcodes-appendix.html
function postgresCode(error: unknown): string | undefined {
  const withCode = (value: unknown) =>
    typeof value === "object" && value !== null && "code" in value && typeof value.code === "string"
      ? value.code
      : undefined
  // Drizzle wraps driver errors; the Postgres error is the cause.
  return withCode(error) ?? (error instanceof Error ? withCode(error.cause) : undefined)
}

// Turns anything thrown by a service into an AppError with a safe message.
export function toAppError(error: unknown): AppError {
  if (error instanceof AppError) return error
  const code = postgresCode(error)
  if (code === "23505") return new DuplicateError("That already exists.")
  if (code === "23503") return new NotFoundError()
  if (code === "23514" || code === "22P02" || code === "22007" || code === "22008") {
    return new ValidationError("Some of the details aren't valid. Please check them and try again.")
  }
  // Connection problems, timeouts and anything unexpected.
  logger.error("db", "unexpected error", { code: code ?? (error instanceof Error ? error.name : typeof error) })
  return new DatabaseUnavailableError()
}
