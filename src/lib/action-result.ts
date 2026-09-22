// What every server action returns. Errors carry a message that's safe to show.
export type ActionResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; code: "not-found" | "validation" | "duplicate" | "unauthorized" | "database" }
