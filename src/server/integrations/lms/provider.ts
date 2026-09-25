import "server-only"

import { AppError } from "../../errors"

// Safe, student-facing LMS problems. `scope` says how much failed: one course
// (the sync skips it and carries on) or the whole connection.
export class LmsError extends AppError {
  constructor(
    message: string,
    readonly scope: "course" | "connection" = "connection"
  ) {
    super("validation", message)
    this.name = "LmsError"
  }
}
