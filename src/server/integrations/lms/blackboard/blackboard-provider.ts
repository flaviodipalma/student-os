import "server-only"

import { UnavailableLmsProvider } from "../provider"

// Blackboard Learn adapter. NOT IMPLEMENTED YET: every method throws
// LmsNotAvailableError and no request is ever sent to Blackboard.
//
// When it's built, it will:
// - use Blackboard Learn's three-legged OAuth2 flow with an application
//   registered with Blackboard (BLACKBOARD_CLIENT_ID / BLACKBOARD_CLIENT_SECRET)
//   and enabled by the student's institution, against the school's Learn address;
// - read the student's course memberships and each course's gradable items
//   through the Learn REST API, following pagination;
// - convert them to LmsCourse / LmsAssignment (src/lib/lms/types.ts).
export class BlackboardProvider extends UnavailableLmsProvider {
  readonly id = "blackboard" as const
  readonly name = "Blackboard"

  isConfigured(): boolean {
    return Boolean(process.env.BLACKBOARD_CLIENT_ID && process.env.BLACKBOARD_CLIENT_SECRET)
  }
}
