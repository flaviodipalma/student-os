import "server-only"

import { toDateKey } from "@/lib/format"
import type { LmsSyncResult } from "@/lib/lms/types"
import { dateFromWallClock, wallClockIn } from "@/lib/time-zone"
import type { Database } from "../../../db/types"
import { loadLmsFeed } from "../connections"
import type { CredentialVault } from "../credential-vault"
import type { Fetch } from "../feed-fetch"
import { runSync } from "../sync"
import { blackboardFeedToLms, fetchBlackboardFeed } from "./feed"

// Syncs a Blackboard calendar-link connection: download the feed once, turn it
// into normalized data, then the same sync as every LMS source (matching,
// three-way merge, no duplicates, nothing deleted).
export async function syncBlackboardFeed(
  db: Database,
  userId: string,
  vault: CredentialVault,
  options: { now?: Date; timeZone?: string; fetch?: Fetch } = {}
): Promise<LmsSyncResult> {
  const now = options.now ?? new Date()
  // The student's today: only items due from today on are imported, so only
  // those can be reported as "no longer in Blackboard".
  const today = toDateKey(dateFromWallClock(wallClockIn(options.timeZone, now)))
  return runSync(db, userId, { provider: "blackboard", name: "Blackboard" }, options, async () => {
    const feed = await loadLmsFeed(db, userId, "blackboard", vault)
    const data = blackboardFeedToLms(await fetchBlackboardFeed(feed.feedUrl, options.fetch), {
      timeZone: options.timeZone,
      today,
    })
    return {
      provider: "blackboard",
      name: "Blackboard",
      missingFrom: today,
      getCourses: async () => data.courses,
      getAssignments: async (courseId) => data.assignments.filter((a) => a.courseExternalId === courseId),
    }
  })
}
