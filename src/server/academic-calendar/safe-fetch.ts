import "server-only"

import { lookup as dnsLookup, type LookupAddress } from "node:dns"
import { request } from "node:https"
import { isIP } from "node:net"
import type { LookupFunction } from "node:net"

// Fetching pages from the public web for the academic calendar (a school's website,
// or a link the student pasted). The addresses come from outside, so every request:
//   - is HTTPS, on port 443, to a host name (never an IP address or "localhost")
//   - connects only to public IP addresses: the check runs on the address actually
//     connected to (so a name can't be pointed at an internal address later)
//   - follows at most 4 redirects, each checked the same way (and, for a school's
//     site, kept on the school's domain)
//   - stops after 10 seconds, or once the body passes the size limit
// Only the page is read: no cookies are sent and nothing is posted.

export class FetchRefused extends Error {}

export type FetchedPage = { url: string; contentType: string; body: Buffer }

const TIMEOUT_MS = 10_000
const MAX_REDIRECTS = 4
const USER_AGENT = "StudentOS-AcademicCalendar/1.0 (finds a school's public academic calendar for its students)"

// ---- Addresses --------------------------------------------------------------------------

// Private, loopback, link-local, shared, multicast and reserved ranges are refused.
export function isPublicAddress(address: string): boolean {
  const version = isIP(address)
  if (version === 4) {
    const [a, b] = address.split(".").map(Number)
    if (a === 0 || a === 10 || a === 127 || a >= 224) return false
    if (a === 100 && b >= 64 && b <= 127) return false // carrier-grade NAT
    if (a === 169 && b === 254) return false // link-local (cloud metadata)
    if (a === 172 && b >= 16 && b <= 31) return false
    if (a === 192 && (b === 168 || (b === 0 && address.startsWith("192.0.0.")) || (b === 0 && address.startsWith("192.0.2.")))) return false
    if (a === 198 && (b === 18 || b === 19)) return false
    return true
  }
  if (version === 6) {
    const v6 = address.toLowerCase()
    if (v6 === "::" || v6 === "::1") return false
    // IPv4-mapped (::ffff:10.0.0.1): judge the IPv4 part.
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6)
    if (mapped) return isPublicAddress(mapped[1])
    if (/^f[cd]/.test(v6)) return false // unique local
    if (/^fe[89ab]/.test(v6)) return false // link-local
    if (v6.startsWith("ff")) return false // multicast
    return true
  }
  return false
}

// DNS lookup for the connection itself: every answer must be public.
const publicLookup: LookupFunction = (hostname, options, callback) => {
  dnsLookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) return callback(error, "", 4)
    const list = addresses as LookupAddress[]
    if (list.length === 0 || !list.every((entry) => isPublicAddress(entry.address))) {
      return callback(new FetchRefused("That address isn't on the public internet."), "", 4)
    }
    if ((options as { all?: boolean }).all) return (callback as unknown as (e: null, a: LookupAddress[]) => void)(null, list)
    callback(null, list[0].address, list[0].family)
  })
}

// ---- URLs ---------------------------------------------------------------------------------

// `domain`: when set, the host must be it or one of its subdomains (a school's site).
export function checkUrl(raw: string, domain?: string): URL {
  let url: URL
  try {
    url = new URL(raw)
  } catch {
    throw new FetchRefused("That isn't a web address.")
  }
  if (url.protocol !== "https:") throw new FetchRefused("Only https:// addresses can be read.")
  if (url.username || url.password) throw new FetchRefused("Addresses with a login in them can't be read.")
  if (url.port && url.port !== "443") throw new FetchRefused("Only the standard https port can be used.")
  const host = url.hostname.toLowerCase()
  if (isIP(host.replace(/^\[|\]$/g, "")) || !host.includes(".") || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new FetchRefused("That address can't be read.")
  }
  if (domain && host !== domain && !host.endsWith(`.${domain}`)) throw new FetchRefused(`Only pages on ${domain} are read.`)
  url.hash = ""
  return url
}

// ---- Fetching ------------------------------------------------------------------------------

function getOnce(url: URL, maxBytes: number): Promise<{ status: number; location?: string; contentType: string; body: Buffer }> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "GET",
        lookup: publicLookup,
        timeout: TIMEOUT_MS,
        headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/xhtml+xml,application/pdf,text/calendar,text/plain;q=0.8,application/xml;q=0.7,*/*;q=0.1" },
      },
      (res) => {
        const status = res.statusCode ?? 0
        const contentType = String(res.headers["content-type"] ?? "").toLowerCase()
        if (status >= 300 && status < 400) {
          res.resume()
          return resolve({ status, location: res.headers.location, contentType, body: Buffer.alloc(0) })
        }
        const declared = Number(res.headers["content-length"] ?? 0)
        if (declared > maxBytes) {
          res.destroy()
          return reject(new FetchRefused("That page is too large to read."))
        }
        const chunks: Buffer[] = []
        let size = 0
        res.on("data", (chunk: Buffer) => {
          size += chunk.length
          if (size > maxBytes) {
            res.destroy()
            reject(new FetchRefused("That page is too large to read."))
          } else chunks.push(chunk)
        })
        res.on("end", () => resolve({ status, contentType, body: Buffer.concat(chunks) }))
        res.on("error", reject)
      }
    )
    const timer = setTimeout(() => req.destroy(new FetchRefused("That site took too long to answer.")), TIMEOUT_MS)
    req.on("timeout", () => req.destroy(new FetchRefused("That site took too long to answer.")))
    req.on("error", (error) => {
      clearTimeout(timer)
      reject(error)
    })
    req.on("close", () => clearTimeout(timer))
    req.end()
  })
}

// Fetches a page (following checked redirects). Null for a missing page (4xx/5xx);
// throws FetchRefused for addresses that aren't allowed.
export async function safeFetch(raw: string, options: { domain?: string; maxBytes?: number } = {}): Promise<FetchedPage | null> {
  const maxBytes = options.maxBytes ?? 3 * 1024 * 1024
  let url = checkUrl(raw, options.domain)
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await getOnce(url, maxBytes)
    if (response.status >= 300 && response.status < 400) {
      if (!response.location) return null
      const next = new URL(response.location, url)
      // Some sites redirect to plain http: ask for the same page over https instead.
      if (next.protocol === "http:") next.protocol = "https:"
      url = checkUrl(next.toString(), options.domain)
      continue
    }
    if (response.status !== 200) return null
    return { url: url.toString(), contentType: response.contentType, body: response.body }
  }
  throw new FetchRefused("That address redirects too many times.")
}

export type PageFetcher = (url: string, options?: { domain?: string; maxBytes?: number }) => Promise<FetchedPage | null>
