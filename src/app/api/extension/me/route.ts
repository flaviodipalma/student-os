import { getDb } from "@/server/db"
import { toAppError } from "@/server/errors"
import { extensionJson as json, extensionUser } from "@/server/integrations/extension/http"
import { getProfile } from "@/server/services/profiles"

// GET /api/extension/me: who the extension will sync to (the Student OS account
// logged in in this browser). -> 200 { "firstName": "Alex" }, 401 { loggedOut: true }
// when nobody is, or 403 when the request isn't from the extension. Nothing else
// about the student is returned.
export async function GET(request: Request) {
  try {
    const owner = await extensionUser(request)
    if (owner instanceof Response) return owner
    const profile = await getProfile(getDb(), owner.userId)
    return json({ firstName: profile.firstName })
  } catch (error) {
    return json({ error: toAppError(error).message }, 503)
  }
}
