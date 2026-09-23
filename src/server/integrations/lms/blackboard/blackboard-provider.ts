import "server-only"

import { z } from "zod"
import type { LmsAssignment, LmsCourse, LmsSubmissionStatus } from "@/lib/lms/types"
import { sameOriginUrl } from "../base-url"
import { LmsError, type LmsAccess, type LmsProvider, type LmsTokenSet } from "../provider"
import { BlackboardApiClient } from "./api-client"
import { blackboardConfig, type BlackboardConfig } from "./config"
import {
  attemptsStatus,
  blackboardAssignmentToLms,
  blackboardCourseToLms,
  gradedColumns,
  isAttemptColumn,
  parseBlackboardColumn,
  type BlackboardColumn,
} from "./mapping"
import { blackboardAuthorizationUrl, exchangeBlackboardCode, refreshBlackboardToken, type Fetch } from "./oauth"

// Blackboard Learn adapter: three-legged OAuth 2.0 + the read-only Learn REST
// API calls Student OS needs, as the signed-in student (so Learn only returns
// what that student may see). It never writes to Blackboard.
//
//   the student   GET v1/users/uuid:{user_id}?fields=id            once, when connecting
//   courses       GET v1/users/{id}/courses?expand=course         their course memberships
//   assignments   GET v2/courses/{id}/gradebook/columns           gradable items + due dates
//   status        GET v2/courses/{id}/gradebook/users/{id}        their grades (one call per course)
//                 GET v2/courses/{id}/gradebook/columns/{id}/attempts?userId={id}
//                     their attempts, only for ungraded attempt-based items due recently
//                     or later (at most MAX_ATTEMPT_LOOKUPS per course, to stay well
//                     inside Blackboard's daily API limits)
//
// Calendar items (GET v1/calendars/items) aren't imported: for students they
// only repeat the gradebook columns above (type GradebookColumn) or are
// institution/personal events, and Learn serves them in 16-week windows only.
//
// Needs an app registered on the Anthology Developer Portal, approved by the
// student's school (see README.md "Blackboard setup").

const ATTEMPT_WINDOW_DAYS = 30
const MAX_ATTEMPT_LOOKUPS = 25

const userResponse = z.object({ id: z.string().regex(/^_\d+_\d+$/) })

export class BlackboardProvider implements LmsProvider {
  readonly id = "blackboard" as const
  readonly name = "Blackboard"
  readonly available = true

  // Course page links found by getCourses, per sync (one LmsAccess per sync),
  // so assignments can link to their course without another request.
  private readonly courseUrls = new WeakMap<LmsAccess, Map<string, string | null>>()

  constructor(
    private readonly options: { fetch?: Fetch; config?: () => BlackboardConfig | null; now?: () => Date } = {}
  ) {}

  private config(): BlackboardConfig {
    const config = (this.options.config ?? blackboardConfig)()
    if (!config) throw new LmsError("Blackboard isn't set up on this server yet.")
    return config
  }

  isConfigured(): boolean {
    return (this.options.config ?? blackboardConfig)() !== null
  }

  getAuthorizationUrl(request: { baseUrl: string; state: string; codeVerifier: string }): string {
    return blackboardAuthorizationUrl(this.config(), request.baseUrl, request.state, request.codeVerifier)
  }

  async exchangeCode(request: { baseUrl: string; code: string; codeVerifier: string }): Promise<LmsTokenSet> {
    const tokens = await exchangeBlackboardCode(this.config(), request.baseUrl, request.code, request.codeVerifier, this.options.fetch)
    // The token names the student by UUID; the REST API works with the primary id.
    if (!tokens.externalUserId) throw new LmsError("Blackboard didn't say who signed in. Please try again.")
    const access: LmsAccess = {
      baseUrl: request.baseUrl,
      timeZone: undefined,
      externalUserId: null,
      getAccessToken: async () => tokens.accessToken,
      refreshAccessToken: async () => {
        throw new LmsError("Your Blackboard connection expired. Please reconnect.", "connection", true)
      },
    }
    const user = userResponse.safeParse(
      await this.client(access).getOne(`v1/users/uuid:${encodeURIComponent(tokens.externalUserId)}`, [["fields", "id"]])
    )
    if (!user.success) throw new LmsError("Blackboard sent a response Student OS couldn't read.")
    return { ...tokens, externalUserId: user.data.id }
  }

  refreshTokens(request: { baseUrl: string; refreshToken: string }): Promise<LmsTokenSet> {
    return refreshBlackboardToken(this.config(), request.baseUrl, request.refreshToken, this.options.fetch)
  }

  // Learn's public API has no token revocation. Disconnecting deletes the tokens
  // from Student OS; the access token expires within the hour.
  async revokeTokens(): Promise<void> {}

  private client(access: LmsAccess) {
    return new BlackboardApiClient(access, { fetch: this.options.fetch })
  }

  private userId(access: LmsAccess): string {
    // Saved when connecting; a connection without it has to be made again.
    if (!access.externalUserId || !/^_\d+_\d+$/.test(access.externalUserId)) {
      throw new LmsError("Please reconnect Blackboard.", "connection", true)
    }
    return access.externalUserId
  }

  async getCourses(access: LmsAccess): Promise<LmsCourse[]> {
    const raw = await this.client(access).getAll(`v1/users/${this.userId(access)}/courses`, [
      ["expand", "course"],
      [
        "fields",
        "courseId,courseRoleId,availability.available,course.id,course.courseId,course.name,course.description,course.organization,course.availability.available,course.externalAccessUrl",
      ],
    ])
    const courses = raw
      .map((item) => blackboardCourseToLms(item, access.baseUrl))
      .filter((course): course is LmsCourse => course !== null)
    this.courseUrls.set(access, new Map(courses.map((course) => [course.externalId, course.url])))
    return courses
  }

  async getCourseDetails(access: LmsAccess, courseExternalId: string): Promise<LmsCourse> {
    const course = (await this.getCourses(access)).find((c) => c.externalId === courseExternalId)
    if (!course) throw new LmsError("This course isn't available in Blackboard.", "course")
    return course
  }

  private async courseUrl(access: LmsAccess, courseExternalId: string): Promise<string | null> {
    const known = this.courseUrls.get(access)?.get(courseExternalId)
    if (known !== undefined) return known
    const raw = (await this.client(access).getOne(
      `v3/courses/${encodeURIComponent(courseExternalId)}`,
      [["fields", "externalAccessUrl"]],
      "course"
    )) as { externalAccessUrl?: unknown }
    return typeof raw.externalAccessUrl === "string" ? sameOriginUrl(raw.externalAccessUrl, access.baseUrl) : null
  }

  async getAssignments(access: LmsAccess, courseExternalId: string): Promise<LmsAssignment[]> {
    const userId = this.userId(access)
    const course = encodeURIComponent(courseExternalId)
    const client = this.client(access)
    const columns = (
      await client.getAll(
        `v2/courses/${course}/gradebook/columns`,
        [
          [
            "fields",
            "id,name,displayName,description,externalGrade,contentId,scoreProviderHandle,availability.available,grading.type,grading.due",
          ],
        ],
        "course"
      )
    )
      .map(parseBlackboardColumn)
      .filter((column): column is BlackboardColumn => column !== null)
    if (columns.length === 0) return []

    const courseUrl = await this.courseUrl(access, courseExternalId)
    const statuses = await this.submissionStatuses(client, course, userId, columns)
    return columns.map((column) =>
      blackboardAssignmentToLms(column, courseExternalId, {
        timeZone: access.timeZone,
        courseUrl,
        submissionStatus: statuses.get(column.id) ?? "unknown",
      })
    )
  }

  // Conservative: "graded" only with a real grade, "submitted" only with a
  // turned-in attempt, "unknown" whenever Blackboard didn't say. A course whose
  // grades can't be read still imports, with every status unknown.
  private async submissionStatuses(
    client: BlackboardApiClient,
    course: string,
    userId: string,
    columns: BlackboardColumn[]
  ): Promise<Map<string, LmsSubmissionStatus>> {
    const statuses = new Map<string, LmsSubmissionStatus>()
    let graded: Set<string>
    try {
      graded = gradedColumns(await client.getAll(`v2/courses/${course}/gradebook/users/${userId}`, [["fields", "columnId,score,text"]], "course"))
    } catch (error) {
      if (error instanceof LmsError && error.scope === "course") return statuses
      throw error
    }
    for (const id of graded) statuses.set(id, "graded")

    const now = (this.options.now ?? (() => new Date()))().getTime()
    const from = now - ATTEMPT_WINDOW_DAYS * 24 * 60 * 60 * 1000
    const toCheck = columns
      .filter((column) => isAttemptColumn(column) && !graded.has(column.id) && column.grading?.due)
      .map((column) => ({ column, due: new Date(column.grading?.due as string).getTime() }))
      .filter(({ due }) => !Number.isNaN(due) && due >= from)
      .sort((a, b) => Math.abs(a.due - now) - Math.abs(b.due - now))
      .slice(0, MAX_ATTEMPT_LOOKUPS)
    for (const { column } of toCheck) {
      try {
        const attempts = await client.getAll(
          `v2/courses/${course}/gradebook/columns/${encodeURIComponent(column.id)}/attempts`,
          [
            ["userId", userId],
            ["fields", "status"],
          ],
          "course"
        )
        statuses.set(column.id, attemptsStatus(attempts))
      } catch (error) {
        // e.g. anonymous grading not yet released: this one stays unknown.
        if (!(error instanceof LmsError) || error.scope !== "course") throw error
      }
    }
    return statuses
  }
}
