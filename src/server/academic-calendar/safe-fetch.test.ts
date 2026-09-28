import { describe, expect, it } from "vitest"
import { checkUrl, FetchRefused, isPublicAddress } from "./safe-fetch"

// Only public HTTPS pages can be fetched (the addresses come from outside).

describe("addresses", () => {
  it.each([
    ["8.8.8.8", true],
    ["151.101.1.69", true],
    ["2606:4700::6810:85e5", true],
    ["10.0.0.5", false],
    ["127.0.0.1", false],
    ["169.254.169.254", false],
    ["172.16.4.1", false],
    ["172.32.0.1", true],
    ["192.168.1.1", false],
    ["100.64.0.1", false],
    ["0.0.0.0", false],
    ["224.0.0.1", false],
    ["::1", false],
    ["fd00::1", false],
    ["fe80::1", false],
    ["::ffff:10.0.0.1", false],
    ["::ffff:8.8.8.8", true],
    ["not an ip", false],
  ])("%s public: %s", (address, expected) => {
    expect(isPublicAddress(address)).toBe(expected)
  })
})

describe("which links can be read", () => {
  it("https pages by name; on a school's site, only its domain and subdomains", () => {
    expect(checkUrl("https://www.qu.edu/academics/academic-calendar/", "qu.edu").hostname).toBe("www.qu.edu")
    expect(checkUrl("https://registrar.qu.edu/calendar", "qu.edu").hostname).toBe("registrar.qu.edu")
    expect(checkUrl("https://qu.edu/x#part").toString()).toBe("https://qu.edu/x")
    for (const [url, domain] of [
      ["http://www.qu.edu/", undefined],
      ["https://127.0.0.1/", undefined],
      ["https://[::1]/", undefined],
      ["https://localhost/", undefined],
      ["https://intranet/", undefined],
      ["https://printer.local/", undefined],
      ["https://www.qu.edu:8443/", undefined],
      ["https://user:pass@www.qu.edu/", undefined],
      ["https://evil.com/qu.edu", "qu.edu"],
      ["https://notqu.edu/", "qu.edu"],
      ["ftp://qu.edu/", undefined],
      ["not a url", undefined],
    ] as const) {
      expect(() => checkUrl(url, domain), url).toThrow(FetchRefused)
    }
  })
})
