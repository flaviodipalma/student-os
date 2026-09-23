import "server-only"

import type { LmsAssignment, LmsCourse } from "@/lib/lms/types"
import { LmsError, type LmsAccess, type LmsProvider, type LmsTokenSet } from "../provider"
import { CanvasApiClient } from "./api-client"
import { canvasConfig, type CanvasConfig } from "./config"
import { canvasAssignmentToLms, canvasCourseToLms } from "./mapping"
import { canvasAuthorizationUrl, exchangeCanvasCode, refreshCanvasToken, revokeCanvasToken, type Fetch } from "./oauth"

// Canvas LMS adapter: OAuth 2.0 + the read-only REST API calls Student OS needs.
// It never writes to Canvas (no submissions, grades, comments or edits).
//
//   courses      GET /api/v1/courses?enrollment_type=student&enrollment_state=active
//                &include[]=teachers   (courses the student is actively enrolled in)
//   assignments  GET /api/v1/courses/:id/assignments?include[]=submission&order_by=due_at
//
// Needs a Canvas developer key from the school (see README.md "Canvas setup").
export class CanvasProvider implements LmsProvider {
  readonly id = "canvas" as const
  readonly name = "Canvas"
  readonly available = true

  constructor(private readonly options: { fetch?: Fetch; config?: () => CanvasConfig | null } = {}) {}

  private config(): CanvasConfig {
    const config = (this.options.config ?? canvasConfig)()
    if (!config) throw new LmsError("Canvas isn't set up on this server yet.")
    return config
  }

  isConfigured(): boolean {
    return (this.options.config ?? canvasConfig)() !== null
  }

  getAuthorizationUrl(request: { baseUrl: string; state: string }): string {
    return canvasAuthorizationUrl(this.config(), request.baseUrl, request.state)
  }

  exchangeCode(request: { baseUrl: string; code: string }): Promise<LmsTokenSet> {
    return exchangeCanvasCode(this.config(), request.baseUrl, request.code, this.options.fetch)
  }

  refreshTokens(request: { baseUrl: string; refreshToken: string }): Promise<LmsTokenSet> {
    return refreshCanvasToken(this.config(), request.baseUrl, request.refreshToken, this.options.fetch)
  }

  revokeTokens(request: { baseUrl: string; accessToken: string }): Promise<void> {
    return revokeCanvasToken(request.baseUrl, request.accessToken, this.options.fetch)
  }

  private client(access: LmsAccess) {
    return new CanvasApiClient(access, { fetch: this.options.fetch })
  }

  async getCourses(access: LmsAccess): Promise<LmsCourse[]> {
    const raw = await this.client(access).getAll("/courses", [
      ["enrollment_type", "student"],
      ["enrollment_state", "active"],
      ["include[]", "teachers"],
    ])
    return raw.map((item) => canvasCourseToLms(item, access.baseUrl)).filter((course): course is LmsCourse => course !== null)
  }

  async getCourseDetails(access: LmsAccess, courseExternalId: string): Promise<LmsCourse> {
    const raw = await this.client(access).getOne(`/courses/${encodeURIComponent(courseExternalId)}`, [["include[]", "teachers"]], "course")
    const course = canvasCourseToLms(raw, access.baseUrl)
    if (!course) throw new LmsError("This course isn't available in Canvas.", "course")
    return course
  }

  async getAssignments(access: LmsAccess, courseExternalId: string): Promise<LmsAssignment[]> {
    const raw = await this.client(access).getAll(
      `/courses/${encodeURIComponent(courseExternalId)}/assignments`,
      [
        ["include[]", "submission"],
        ["order_by", "due_at"],
      ],
      "course"
    )
    const context = { baseUrl: access.baseUrl, timeZone: access.timeZone }
    return raw
      .map((item) => canvasAssignmentToLms(item, courseExternalId, context))
      .filter((assignment): assignment is LmsAssignment => assignment !== null)
  }
}
