import type { NextRequest } from "next/server"
import { handleLmsCallback } from "@/server/integrations/lms/oauth-callback"

// GET /api/integrations/blackboard/callback: where Blackboard Learn sends the
// student back after they sign in and approve (or cancel). See oauth-callback.ts.
export function GET(request: NextRequest) {
  return handleLmsCallback(request, "blackboard")
}
