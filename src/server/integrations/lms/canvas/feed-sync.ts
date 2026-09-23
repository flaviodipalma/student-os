import "server-only"

import { toDateKey } from "@/lib/format"
import type { LmsSyncResult } from "@/lib/lms/types"
import { dateFromWallClock, wallClockIn } from "@/lib/time-zone"
import type { Database } from "../../../db/types"
import { loadLmsFeed } from "../connections"
import type { CredentialVault } from "../credential-vault"
import { runSync } from "../sync"
import { canvasFeedToLms, fetchCanvasFeed } from "./feed"
import type { Fetch } from "./oauth"

// Syncs a Canvas calendar-feed connection: download the feed once, turn it into
// normalized courses and assignments, then the same sync as every LMS source
// (matching, three-way merge, no duplicates, nothing deleted).
export async function syncCanvasFeed(
  db: Database,
  userId: string,
  vault: CredentialVault,
  options: { now?: Date; timeZone?: string; fetch?: Fetch } = {}
): Promise<LmsSyncResult> {
  const now = options.now ?? new Date()
  // The student's today: the feed may leave out older items, so only tasks due
  // from today on can be reported as "no longer in Canvas".
  const today = toDateKey(dateFromWallClock(wallClockIn(options.timeZone, now)))
  return runSync(db, userId, { provider: "canvas", name: "Canvas" }, options, async () => {
    const feed = await loadLmsFeed(db, userId, "canvas", vault)
    const data = canvasFeedToLms(await fetchCanvasFeed(feed.feedUrl, options.fetch), {
      baseUrl: feed.baseUrl,
      timeZone: options.timeZone,
    })
    return {
      provider: "canvas",
      name: "Canvas",
      missingFrom: today,
      getCourses: async () => data.courses,
      getAssignments: async (courseId) => data.assignments.filter((a) => a.courseExternalId === courseId),
    }
  })
}
