import "server-only"

import { UnavailableLmsProvider } from "../provider"

// Canvas LMS adapter. NOT IMPLEMENTED YET: every method throws
// LmsNotAvailableError and no request is ever sent to Canvas.
//
// When it's built, it will:
// - use Canvas's OAuth2 flow with a developer key issued by the student's
//   institution (CANVAS_CLIENT_ID / CANVAS_CLIENT_SECRET), against the
//   school's own Canvas address (e.g. https://school.instructure.com);
// - read the student's courses and each course's assignments through the
//   Canvas REST API, following pagination;
// - convert them to LmsCourse / LmsAssignment (src/lib/lms/types.ts),
//   including due timestamps -> the student's local date and time.
export class CanvasProvider extends UnavailableLmsProvider {
  readonly id = "canvas" as const
  readonly name = "Canvas"

  isConfigured(): boolean {
    return Boolean(process.env.CANVAS_CLIENT_ID && process.env.CANVAS_CLIENT_SECRET)
  }
}
