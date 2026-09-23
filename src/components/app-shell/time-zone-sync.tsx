"use client"

import { useEffect } from "react"
import { useRouter } from "next/navigation"
import { TIME_ZONE_COOKIE } from "@/lib/time-zone"

// Tells the server the browser's time zone (a cookie), so "today" and "now" on
// server-rendered pages are the student's. If it was missing or changed (e.g.
// after travelling), the page is refreshed once with the right dates.
export function TimeZoneSync() {
  const router = useRouter()
  useEffect(() => {
    const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!timeZone) return
    const current = document.cookie
      .split("; ")
      .find((part) => part.startsWith(`${TIME_ZONE_COOKIE}=`))
      ?.slice(TIME_ZONE_COOKIE.length + 1)
    if (current && decodeURIComponent(current) === timeZone) return
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(timeZone)}; path=/; max-age=31536000; samesite=lax`
    router.refresh()
  }, [router])
  return null
}
