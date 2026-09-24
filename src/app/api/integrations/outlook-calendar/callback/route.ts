import type { NextRequest } from "next/server"
import { handleCalendarCallback } from "@/server/integrations/calendar/oauth-callback"

// GET /api/integrations/outlook-calendar/callback: see oauth-callback.ts.
export function GET(request: NextRequest) {
  return handleCalendarCallback(request, "outlook")
}
