import { describe, expect, it } from "vitest"
import { courseNameWithoutCode, shortCourseCode, tidyCourseCode } from "./course-code"

// Imported course codes, shortened to subject + course number.

describe("shortCourseCode", () => {
  it.each([
    ["PS28301_26/FA", "PS283"],
    ["CSC 215-02 FA26", "CSC215"],
    ["BIO-101-02_FA26", "BIO101"],
    ["2026FA-MAT141-03", "MAT141"],
    ["FALL 2026 CSC 215", "CSC215"],
    ["csc215", "CSC215"],
    ["BIO101L", "BIO101L"],
    ["MA1410", "MA1410"],
    ["ENG201101_26/FA", "ENG2011"],
    ["CSC 215", "CSC215"],
  ])("%s -> %s", (code, short) => {
    expect(shortCourseCode(code)).toBe(short)
  })

  it("codes without a clear subject and number stay as they are", () => {
    expect(shortCourseCode("Quinnipiac Orientation")).toBe("Quinnipiac Orientation")
    expect(shortCourseCode(" Honors Seminar ")).toBe("Honors Seminar")
    expect(shortCourseCode("12345")).toBe("12345")
  })
})

describe("tidyCourseCode", () => {
  it("codes typed with a space or dash, or in lowercase, become letters + number", () => {
    expect(tidyCourseCode("CSC 215")).toBe("CSC215")
    expect(tidyCourseCode("csc-215")).toBe("CSC215")
    expect(tidyCourseCode(" bio 101l ")).toBe("BIO101L")
    expect(tidyCourseCode("PS283")).toBe("PS283")
  })

  it("anything else is left as typed", () => {
    expect(tidyCourseCode("Honors Seminar")).toBe("Honors Seminar")
    expect(tidyCourseCode("PS28301_26/FA")).toBe("PS28301_26/FA")
    expect(tidyCourseCode("CSC 215-02")).toBe("CSC 215-02")
  })
})

describe("courseNameWithoutCode", () => {
  it("drops the code in brackets at the end of a name", () => {
    expect(courseNameWithoutCode("Intro to Forensic Psyc (PS28301_26/FA)")).toBe("Intro to Forensic Psyc")
    expect(courseNameWithoutCode("Introduction to Cybersecurity (CYB505DE_CSC240DE_26/FA)")).toBe("Introduction to Cybersecurity")
    expect(courseNameWithoutCode("Data Structures [CSC-215-02]")).toBe("Data Structures")
  })

  it("keeps brackets that aren't a code, and never leaves a name empty", () => {
    expect(courseNameWithoutCode("Calculus (Honors)")).toBe("Calculus (Honors)")
    expect(courseNameWithoutCode("Chemistry (Lab Section B)")).toBe("Chemistry (Lab Section B)")
    expect(courseNameWithoutCode("Data Structures")).toBe("Data Structures")
    expect(courseNameWithoutCode("(PS28301_26/FA)")).toBe("(PS28301_26/FA)")
  })
})
