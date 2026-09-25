import { describe, expect, it } from "vitest"
import { courseOptions, groupByTerm, initialSelection, isCurrent } from "./courses"

// Choosing courses: TEST FIXTURES shaped after Canvas courses with include[]=term.

const NOW = Date.parse("2026-09-24T12:00:00Z")
const fall = { id: 11, name: "Fall 2026", start_at: "2026-08-25T04:00:00Z", end_at: "2026-12-20T05:00:00Z" }
const spring = { id: 10, name: "Spring 2026", start_at: "2026-01-15T05:00:00Z", end_at: "2026-05-15T04:00:00Z" }
const defaultTerm = { id: 1, name: "Default Term", start_at: null, end_at: null }

const canvasCourses = [
  { id: 215, name: "Data Structures", course_code: "CSC 215", term: fall },
  { id: 141, name: "Calculus I", course_code: "MAT 141", term: fall },
  { id: 101, name: "Intro to Psychology", course_code: "PSY 101", term: spring },
  { id: 5, name: "Quinnipiac Orientation", course_code: "Quinnipiac Orientation", term: defaultTerm },
  { id: 6, name: "Hidden", term: fall, access_restricted_by_date: true },
  { id: 7, name: "", course_code: "" },
]

describe("courseOptions", () => {
  it("labels courses by code and name, and leaves out ones Student OS wouldn't import", () => {
    const options = courseOptions(canvasCourses)
    expect(options.map((o) => o.label)).toEqual([
      "CSC 215 · Data Structures",
      "MAT 141 · Calculus I",
      "PSY 101 · Intro to Psychology",
      "Quinnipiac Orientation",
    ])
    expect(options[0]).toMatchObject({ id: "215", term: { key: "11", name: "Fall 2026" } })
  })
})

describe("isCurrent", () => {
  const [dataStructures, , psychology, orientation] = courseOptions(canvasCourses)

  it("uses the term's dates", () => {
    expect(isCurrent(dataStructures, NOW)).toBe(true)
    expect(isCurrent(psychology, NOW)).toBe(false)
  })

  it("falls back to the course's own dates, and treats no dates as not current", () => {
    expect(isCurrent(orientation, NOW)).toBe(false)
    const [ownDates] = courseOptions([{ id: 9, name: "Lab", term: defaultTerm, start_at: "2026-09-01T00:00:00Z", end_at: "2026-10-30T00:00:00Z" }])
    expect(isCurrent(ownDates, NOW)).toBe(true)
    const [openEnded] = courseOptions([{ id: 9, name: "Lab", start_at: "2026-09-01T00:00:00Z" }])
    expect(isCurrent(openEnded, NOW)).toBe(true)
  })
})

describe("groupByTerm", () => {
  it("current semester first, then newest to oldest, then other courses", () => {
    const groups = groupByTerm(courseOptions(canvasCourses), NOW)
    expect(groups.map((g) => [g.name, g.current, g.courses.length])).toEqual([
      ["Fall 2026", true, 2],
      ["Spring 2026", false, 1],
      ["Other courses", false, 1],
    ])
  })

  it("orders past semesters by start date", () => {
    const older = { id: 9, name: "Fall 2025", start_at: "2025-08-25T04:00:00Z", end_at: "2025-12-20T05:00:00Z" }
    const groups = groupByTerm(courseOptions([{ id: 1, name: "A", term: older }, { id: 2, name: "B", term: spring }]), NOW)
    expect(groups.map((g) => g.name)).toEqual(["Spring 2026", "Fall 2025"])
  })
})

describe("initialSelection", () => {
  const options = courseOptions(canvasCourses)

  it("first time: current-semester courses checked, and the list is shown", () => {
    const { selected, needsReview } = initialSelection(options, null, NOW)
    expect([...selected].sort()).toEqual(["141", "215"])
    expect(needsReview).toBe(true)
  })

  it("later: the saved choice, without asking again", () => {
    const saved = { selected: ["215", "101"], seen: options.map((o) => o.id) }
    const { selected, needsReview } = initialSelection(options, saved, NOW)
    expect([...selected].sort()).toEqual(["101", "215"])
    expect(needsReview).toBe(false)
  })

  it("a course Canvas didn't have before brings the list back; new current ones are checked", () => {
    const saved = { selected: ["101"], seen: ["101", "5"] }
    const { selected, needsReview } = initialSelection(options, saved, NOW)
    expect(needsReview).toBe(true)
    expect([...selected].sort()).toEqual(["101", "141", "215"])
  })

  it("courses no longer in Canvas drop out of the choice", () => {
    const saved = { selected: ["215", "999"], seen: [...options.map((o) => o.id), "999"] }
    expect([...initialSelection(options, saved, NOW).selected]).toEqual(["215"])
  })
})
