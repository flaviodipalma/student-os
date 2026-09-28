import "server-only"

import { extractPdfText } from "@/lib/syllabus/pdf"
import { FetchRefused, type FetchedPage, type PageFetcher } from "./safe-fetch"

// Finds a school's academic calendar on its own website (and its subdomains, like
// registrar.school.edu), without a search engine:
//   1. the site's robots.txt and sitemaps, for pages about the academic calendar
//   2. links whose text says "Academic calendar" on the school's and the registrar's
//      home pages
//   3. otherwise the usual addresses (/academic-calendar, /registrar/academic-calendar…)
//   4. on the best page, links to this and next semester's pages (many schools have
//      one page per term, e.g. .../2026-27-academic-calendar/fall-2026/)
// Returns the pages' text for the AI to read, or null when nothing was found. Only
// pages on the school's domain are read, and at most MAX_FETCHES of them.

export type FoundCalendar = { sources: string[]; text: string }

const MAX_FETCHES = 30
const MAX_TEXT_CHARS = 60_000
const MONTHS = "(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*"
const DATE_LIKE = new RegExp(`\\b${MONTHS}\\.?\\s+\\d{1,2}\\b|\\b\\d{1,2}/\\d{1,2}(?:/\\d{2,4})?\\b`, "gi")
const COMMON_PATHS = [
  "/academic-calendar/",
  "/academics/academic-calendar/",
  "/registrar/academic-calendar/",
  "/calendars/academic-calendar/",
  "/academic-calendars/",
  "/calendars/",
  "/calendar/",
]
// Where a registrar usually lives, besides the main site.
const REGISTRAR_HOSTS = ["registrar", "ro", "reg"]
// Link text that points at the academic calendar.
const CALENDAR_LINK_TEXT = /academic\s+calendars?|calendar\s+of\s+(important\s+)?dates|important\s+dates|academic\s+dates/i

// Words in addresses for the current academic year and the semesters around today:
// in September 2026, "2026-27", "2026-2027", "fall-2026", "spring-2027"…
export function termHints(today: string): { current: string[]; old: string[] } {
  const year = Number(today.slice(0, 4))
  const start = Number(today.slice(5, 7)) >= 6 ? year : year - 1
  const next = start + 1
  const yy = (y: number) => String(y % 100).padStart(2, "0")
  const current = [
    `${start}-${yy(next)}`,
    `${start}-${next}`,
    `${start}${yy(next)}`,
    `fall-${start}`,
    `fall${start}`,
    `${start}-fall`,
    `spring-${next}`,
    `spring${next}`,
    `${next}-spring`,
    `january-${next}`,
    `winter-${next}`,
    `summer-${next}`,
  ]
  const old = [`${start - 1}-${yy(start)}`, `${start - 2}-${yy(start - 1)}`, `fall-${start - 1}`, `spring-${start}`, "archive", "past"]
  return { current, old }
}

// How promising an address looks for the student's academic calendar.
export function scoreUrl(url: string, today: string): number {
  const lower = url.toLowerCase()
  const { current, old } = termHints(today)
  let score = 0
  if (/academic[-_]?calendar|academiccalendar/.test(lower)) score += 6
  else if (/calendar|important-dates|key-dates/.test(lower) && /registrar|academic|\/\/(ro|reg)\.|\/reg\//.test(lower)) score += 3
  else return 0
  if (current.some((hint) => lower.includes(hint))) score += 4
  if (old.some((hint) => lower.includes(hint))) score -= 5
  // Law, medicine, dental… have their own calendars; the main one is wanted.
  if (/\b(law|medicine|medical|dental|nursing-?school|pharmacy)\b|school-of-(law|medicine)/.test(lower)) score -= 4
  if (/\.(ics|pdf)$/.test(lower)) score += 1
  return score
}

export function htmlToCalendarText(html: string): string {
  return html
    .replace(/\r/g, "")
    .replace(/<(script|style|noscript|svg|nav|header|footer|form)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<(br|\/p|\/li|\/tr|\/h[1-6]|\/div|\/dt|\/dd|\/section|\/article)\b[^>]*>/gi, "\n")
    .replace(/<\/t[dh]>/gi, " | ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&ndash;|&#8211;/gi, "–")
    .replace(/&mdash;|&#8212;/gi, "—")
    .replace(/&#39;|&rsquo;|&#8217;/gi, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/gi, '"')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/[ \t\f\v ]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
}

// Links whose visible text matches (e.g. "Academic Calendar"), as full addresses.
export function linksWithText(html: string, base: string, text: RegExp): string[] {
  const links = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = match[2].replace(/<[^>]+>/g, " ").replace(/\s+/g, " ")
    if (!text.test(label)) continue
    try {
      links.add(new URL(match[1].replace(/&amp;/g, "&"), base).toString())
    } catch {
      // Not an address.
    }
  }
  return [...links]
}

export function linksIn(html: string, base: string): string[] {
  const links = new Set<string>()
  for (const match of html.matchAll(/<a\b[^>]*\bhref\s*=\s*["']([^"'#]+)["']/gi)) {
    try {
      links.add(new URL(match[1].replace(/&amp;/g, "&"), base).toString())
    } catch {
      // Not an address.
    }
  }
  return [...links]
}

const dateCount = (text: string) => (text.match(DATE_LIKE) ?? []).length

export async function pageText(page: FetchedPage): Promise<string> {
  if (page.contentType.includes("pdf") || page.body.subarray(0, 5).toString() === "%PDF-") {
    return (await extractPdfText(new Uint8Array(page.body))).text
  }
  const raw = page.body.toString("utf8")
  if (page.contentType.includes("calendar") || raw.startsWith("BEGIN:VCALENDAR")) return raw
  return htmlToCalendarText(raw)
}

export async function findSchoolCalendar(domain: string, today: string, fetchPage: PageFetcher): Promise<FoundCalendar | null> {
  let fetches = 0
  const tryFetch = async (url: string, maxBytes?: number) => {
    if (fetches >= MAX_FETCHES) return null
    fetches++
    try {
      return await fetchPage(url, { domain, maxBytes })
    } catch (error) {
      if (error instanceof FetchRefused) return null
      return null
    }
  }
  const hosts = [`https://www.${domain}`, `https://${domain}`]

  // 1. Sitemaps (from robots.txt, or the usual place).
  const sitemaps = new Set<string>()
  for (const host of hosts) {
    const robots = await tryFetch(`${host}/robots.txt`, 200_000)
    for (const match of robots?.body.toString("utf8").matchAll(/^\s*sitemap:\s*(\S+)/gim) ?? []) sitemaps.add(match[1])
    if (robots) break
  }
  if (sitemaps.size === 0) hosts.forEach((host) => sitemaps.add(`${host}/sitemap.xml`))
  const candidates = new Set<string>()
  const queue = [...sitemaps].slice(0, 3)
  for (let i = 0; i < queue.length && i < 8; i++) {
    const map = await tryFetch(queue[i], 8 * 1024 * 1024)
    if (!map) continue
    const locs = [...map.body.toString("utf8").matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1].replace(/&amp;/g, "&"))
    for (const loc of locs) {
      // A sitemap index: open the parts most likely to list pages.
      if (/\.xml(\.gz)?$/i.test(loc)) {
        if (!/\.gz$/i.test(loc) && /page|academic|default|main|sitemap-?\d*\.xml$|post/i.test(loc) && queue.length < 8 && !queue.includes(loc)) queue.push(loc)
      } else if (scoreUrl(loc, today) > 0) candidates.add(loc)
    }
  }

  // 2. "Academic calendar" links on the home pages (the school's, the registrar's).
  const linkCandidates = new Set<string>()
  if (candidates.size === 0) {
    const homes = [`${hosts[0]}/`, ...REGISTRAR_HOSTS.map((sub) => `https://${sub}.${domain}/`), `${hosts[0]}/registrar/`]
    for (const home of homes) {
      const page = await tryFetch(home, 3 * 1024 * 1024)
      if (!page || page.contentType.includes("pdf")) continue
      for (const link of linksWithText(page.body.toString("utf8"), page.url, CALENDAR_LINK_TEXT)) linkCandidates.add(link)
      if (linkCandidates.size >= 3) break
    }
    linkCandidates.forEach((link) => candidates.add(link))
  }

  // 3. The usual addresses.
  if (candidates.size === 0) {
    const bases = [...hosts, ...REGISTRAR_HOSTS.map((sub) => `https://${sub}.${domain}`)]
    for (const path of COMMON_PATHS) {
      for (const base of bases) {
        const page = await tryFetch(`${base}${path}`)
        if (page) {
          candidates.add(page.url)
          break
        }
      }
      if (candidates.size > 0) break
    }
  }
  if (candidates.size === 0) return null

  // 4. The best page, and this / next semester's pages linked from it (or in the sitemap).
  // Links found by their text count even if the address says little.
  const rank = (url: string) => scoreUrl(url, today) + (linkCandidates.has(url) ? 6 : 0)
  const ranked = [...candidates].sort((a, b) => rank(b) - rank(a) || a.length - b.length)
  const { current } = termHints(today)
  const termPages = ranked.filter((url) => current.some((hint) => url.toLowerCase().includes(hint)) && /(fall|spring|winter|january|summer)/i.test(url))
  const toRead = [...new Set([...termPages.slice(0, 3), ranked[0]])]
  const sources: string[] = []
  const texts: string[] = []
  const seen = new Set<string>()
  for (let i = 0; i < toRead.length && sources.length < 4; i++) {
    const url = toRead[i]
    if (seen.has(url)) continue
    seen.add(url)
    const page = await tryFetch(url, 10 * 1024 * 1024)
    if (!page || seen.has(`fetched:${page.url}`)) continue
    seen.add(`fetched:${page.url}`)
    let text: string
    try {
      text = await pageText(page)
    } catch {
      continue
    }
    // A hub page (links to each year / term): follow its links for this year's terms.
    if (!page.contentType.includes("pdf")) {
      const raw = page.body.toString("utf8")
      const links = [
        ...linksIn(raw, page.url).filter((link) => scoreUrl(link, today) >= 6 && current.some((hint) => link.toLowerCase().includes(hint))),
        // A page that only links to "the academic calendar" (not a calendar itself).
        ...(dateCount(text) < 5 ? linksWithText(raw, page.url, CALENDAR_LINK_TEXT) : []),
      ]
      for (const link of links.sort((a, b) => scoreUrl(b, today) - scoreUrl(a, today)).slice(0, 4)) if (!seen.has(link)) toRead.push(link)
    }
    if (dateCount(text) >= 5 && !sources.includes(page.url)) {
      sources.push(page.url)
      texts.push(`Source: ${page.url}\n\n${text}`)
    }
  }
  if (texts.length === 0) return null
  // Whole pages only (never cut mid-page): the best ones first, while they fit.
  const kept: string[] = []
  const keptSources: string[] = []
  texts.forEach((text, index) => {
    if (kept.length === 0 || kept.join("").length + text.length <= MAX_TEXT_CHARS) {
      kept.push(text.slice(0, MAX_TEXT_CHARS))
      keptSources.push(sources[index])
    }
  })
  return { sources: keptSources, text: kept.join("\n\n---\n\n") }
}
