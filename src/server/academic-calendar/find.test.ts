import { describe, expect, it } from "vitest"
import { findSchoolCalendar, htmlToCalendarText, scoreUrl, termHints } from "./find"
import type { FetchedPage, PageFetcher } from "./safe-fetch"

// Finding a school's academic calendar on fake websites (no network).

const TODAY = "2026-09-28"
const calendarHtml = (term: string) => `<html><head><style>.x{}</style><script>var a = "Sep 1"</script></head><body>
<nav><a href="/">Home</a></nav>
<h1>Academic Calendar: ${term}</h1>
<ul>
  <li>Classes begin<br>Monday, August 24, 2026</li>
  <li>Labor Day: University holiday<br>Monday, September 7, 2026</li>
  <li>Last day to withdraw<br>Monday, November 2, 2026</li>
  <li>Thanksgiving recess<br>Wednesday, November 25, 2026 - Sunday, November 29, 2026</li>
  <li>Final examinations<br>Monday, December 14, 2026 - Friday, December 18, 2026</li>
</ul></body></html>`

function site(pages: Record<string, string>): { fetch: PageFetcher; asked: { url: string; domain?: string }[] } {
  const asked: { url: string; domain?: string }[] = []
  const fetch: PageFetcher = async (url, options) => {
    asked.push({ url, domain: options?.domain })
    const body = pages[url]
    if (body === undefined) return null
    const contentType = url.endsWith(".xml") ? "application/xml" : url.endsWith(".txt") ? "text/plain" : "text/html"
    return { url, contentType, body: Buffer.from(body) } satisfies FetchedPage
  }
  return { fetch, asked }
}

describe("finding the calendar", () => {
  it("from the sitemap, reading this year's term pages (a site laid out like qu.edu)", async () => {
    const base = "https://www.qu.edu/academics/academic-calendar"
    const { fetch, asked } = site({
      "https://www.qu.edu/robots.txt": "User-agent: *\nSitemap: https://www.qu.edu/sitemap.xml",
      "https://www.qu.edu/sitemap.xml": `<urlset>
        <url><loc>https://www.qu.edu/about/</loc></url>
        <url><loc>${base}/2025-26-academic-calendar/fall-2025/</loc></url>
        <url><loc>${base}/2026-27-academic-calendar/</loc></url>
        <url><loc>${base}/2026-27-academic-calendar/fall-2026/</loc></url>
        <url><loc>${base}/2026-27-academic-calendar/spring-2027/</loc></url>
        <url><loc>https://www.qu.edu/school-of-law/academic-calendar/2026-27/</loc></url>
      </urlset>`,
      [`${base}/2026-27-academic-calendar/fall-2026/`]: calendarHtml("Fall 2026"),
      [`${base}/2026-27-academic-calendar/spring-2027/`]: calendarHtml("Spring 2027"),
      [`${base}/2026-27-academic-calendar/`]: `<a href="fall-2026/">Fall 2026</a>`,
    })
    const found = await findSchoolCalendar("qu.edu", TODAY, fetch)
    expect(found?.sources).toEqual([`${base}/2026-27-academic-calendar/fall-2026/`, `${base}/2026-27-academic-calendar/spring-2027/`])
    expect(found?.text).toMatch(/Thanksgiving recess\nWednesday, November 25, 2026 - Sunday, November 29, 2026/)
    // Menus and scripts are left out; last year's and the law school's pages aren't read.
    expect(found?.text).not.toMatch(/var a|Home/)
    expect(asked.some((a) => /fall-2025|school-of-law/.test(a.url))).toBe(false)
    // Every request stayed on the school's domain.
    expect(asked.every((a) => a.domain === "qu.edu")).toBe(true)
  })

  it("from an 'Academic Calendar' link on the registrar's site", async () => {
    const { fetch } = site({
      "https://registrar.state.edu/": `<a href="/dates/current">Academic Calendar</a> <a href="/forms">Forms</a>`,
      "https://registrar.state.edu/dates/current": calendarHtml("2026-2027"),
    })
    const found = await findSchoolCalendar("state.edu", TODAY, fetch)
    expect(found?.sources).toEqual(["https://registrar.state.edu/dates/current"])
  })

  it("at a usual address when nothing links to it", async () => {
    const { fetch } = site({ "https://www.college.edu/academic-calendar/": calendarHtml("Fall 2026") })
    expect((await findSchoolCalendar("college.edu", TODAY, fetch))?.sources).toEqual(["https://www.college.edu/academic-calendar/"])
  })

  it("nothing found: null, after a limited number of requests", async () => {
    const { fetch, asked } = site({ "https://www.nowhere.edu/academic-calendar/": "<p>Coming soon</p>" })
    expect(await findSchoolCalendar("nowhere.edu", TODAY, fetch)).toBeNull()
    expect(asked.length).toBeLessThanOrEqual(30)
  })
})

describe("helpers", () => {
  it("this academic year's words; last year's and professional schools rank lower", () => {
    expect(termHints(TODAY).current).toEqual(expect.arrayContaining(["2026-27", "2026-2027", "fall-2026", "spring-2027"]))
    expect(termHints("2027-02-10").current).toEqual(expect.arrayContaining(["2026-27", "spring-2027"]))
    const url = (path: string) => `https://www.school.edu/${path}`
    expect(scoreUrl(url("academic-calendar/2026-27/"), TODAY)).toBeGreaterThan(scoreUrl(url("academic-calendar/2025-26/"), TODAY))
    expect(scoreUrl(url("academic-calendar/"), TODAY)).toBeGreaterThan(scoreUrl(url("school-of-law/academic-calendar/"), TODAY))
    expect(scoreUrl(url("news/calendar-of-events"), TODAY)).toBe(0)
  })

  it("page text keeps lines and table cells, without markup", () => {
    expect(htmlToCalendarText("<table><tr><td>Classes begin</td><td>Aug&nbsp;24</td></tr></table>\r\n<p>Fall&nbsp;&amp;&nbsp;Winter</p>")).toBe(
      "Classes begin | Aug 24 |\n\nFall & Winter"
    )
  })
})
