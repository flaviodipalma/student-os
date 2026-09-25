import { describe, expect, it } from "vitest"
import { MAX_SCHOOL_SUGGESTIONS, normalizeSchoolText, searchSchools } from "./search"

// The School field's suggestions, against the real list (schools.json).

const names = (query: string, country?: string) => searchSchools(query, { country }).map((school) => school.name)

describe("searchSchools", () => {
  it("'q' in the US: US schools starting with q first, Quinnipiac among them", () => {
    const found = searchSchools("q", { country: "US" })
    expect(found).toHaveLength(MAX_SCHOOL_SUGGESTIONS)
    expect(found.every((school) => school.name.toLowerCase().startsWith("q"))).toBe(true)
    expect(found.slice(0, 5).every((school) => school.country === "US")).toBe(true)
    expect(found.map((school) => school.name)).toContain("Quinnipiac University")
  })

  it("names that start with the text come before names with a word that does", () => {
    const found = names("state", "US")
    expect(found[0].toLowerCase().startsWith("state")).toBe(true)
    const firstWordMatch = found.findIndex((name) => !name.toLowerCase().startsWith("state"))
    if (firstWordMatch >= 0) expect(found.slice(firstWordMatch).every((name) => !name.toLowerCase().startsWith("state"))).toBe(true)
    expect(names("ohio state", "US")).toContain("Ohio State University-Main Campus")
  })

  it("official, current US names, with the school's web domain", () => {
    expect(searchSchools("quinnipiac", { country: "US" })[0]).toEqual({ name: "Quinnipiac University", domain: "qu.edu", country: "US" })
    expect(names("quinnipiac")).not.toContain("Quinnipiac College") // the outdated name
  })

  it("schools outside the US too; the student's country first", () => {
    const italy = searchSchools("universita", { country: "IT" })
    expect(italy.length).toBeGreaterThan(0)
    expect(italy[0].country).toBe("IT")
  })

  it("case, accents and punctuation don't matter", () => {
    expect(names("QUINNIPIAC")).toEqual(names("quinnipiac"))
    expect(normalizeSchoolText("Universidad de Córdoba")).toBe("universidad de cordoba")
    expect(names("cordoba").length).toBeGreaterThan(0)
    expect(names("st. john's", "US").length).toBeGreaterThan(0)
  })

  it("nothing typed or nothing found: no suggestions", () => {
    expect(searchSchools("")).toEqual([])
    expect(searchSchools("   ")).toEqual([])
    expect(searchSchools("zzzzqqqq")).toEqual([])
  })
})
