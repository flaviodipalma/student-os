import "server-only"

// True if at least one field would actually change (Drizzle rejects empty updates).
export function hasChanges(values: Record<string, unknown>): boolean {
  return Object.values(values).some((value) => value !== undefined)
}
