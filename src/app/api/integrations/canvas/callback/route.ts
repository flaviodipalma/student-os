import type { NextRequest } from "next/server"
import { handleLmsCallback } from "@/server/integrations/lms/oauth-callback"

// GET /api/integrations/canvas/callback: where Canvas sends the student back
// after they approve (or cancel) the connection. See oauth-callback.ts.
export function GET(request: NextRequest) {
  return handleLmsCallback(request, "canvas")
}
