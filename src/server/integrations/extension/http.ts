import "server-only"

import { getCurrentUser } from "../../auth"

// Shared by the browser extension's endpoints (/api/extension/...). The extension
// uses the student's own Student OS login: Chrome sends the login cookies with the
// extension's requests, because the extension has permission for this site.
//
// Other websites can't use that login to call these endpoints (cross-site requests):
//   1. the login cookies are SameSite=Lax, so browsers leave them off such requests;
//   2. a custom header is required, which a website can't add to a cross-site request
//      without CORS permission (and these endpoints send no CORS headers);
//   3. a request that carries an Origin must come from a Chrome extension (and, when
//      STUDENT_OS_EXTENSION_IDS is set, from one of those). Chrome leaves Origin off
//      the extension's GETs (it has permission for this site), so a GET may have none;
//      a POST from a website always has one.

export const EXTENSION_HEADER = "x-student-os-extension"

export const extensionJson = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } })

// "abcdefghijklmnopabcdefghijklmnop, ..." (the published extension's id) -> allowed ids;
// empty = any extension (development, where the unpacked extension's id varies).
function allowedExtensionIds(): string[] {
  return (process.env.STUDENT_OS_EXTENSION_IDS ?? "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
}

export function fromStudentOsExtension(request: Request): boolean {
  if (request.headers.get(EXTENSION_HEADER) !== "1") return false
  const origin = request.headers.get("origin")
  if (origin === null) return request.method === "GET" || request.method === "HEAD"
  const extensionId = origin.match(/^chrome-extension:\/\/([a-p]{32})$/)?.[1]
  if (!extensionId) return false
  const allowed = allowedExtensionIds()
  return allowed.length === 0 || allowed.includes(extensionId)
}

// The signed-in student, or the response to send instead.
export async function extensionUser(request: Request): Promise<{ userId: string } | Response> {
  if (!fromStudentOsExtension(request)) return extensionJson({ error: "Only the Student OS extension can do this." }, 403)
  const user = await getCurrentUser()
  if (!user) return extensionJson({ error: "Log in to Student OS in this browser, then try again.", loggedOut: true }, 401)
  return { userId: user.id }
}
