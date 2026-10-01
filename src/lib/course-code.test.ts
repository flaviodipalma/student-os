import { describe, expect, it } from "vitest"
import { courseNameWithoutCode, friendlyTermName, shortCourseCode, tidyCourseCode } from "./course-code"

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

  it("drops a code at the start of a name (Brightspace, Blackboard)", () => {
    // Brightspace (a real course list): code, section, a dash, then the title.
    expect(courseNameWithoutCode("CS 305 01 - Advanced Computing")).toBe("Advanced Computing")
    expect(courseNameWithoutCode("CS 438 01 - Operating Systems Analysis")).toBe("Operating Systems Analysis")
    expect(courseNameWithoutCode("CS/SE 450 50 - Cyber Security")).toBe("Cyber Security")
    expect(courseNameWithoutCode("CS 492A 01 - Computer Science Senior Project A")).toBe("Computer Science Senior Project A")
    expect(courseNameWithoutCode("PR 461 01 - The Great Recession and the Global Economy")).toBe("The Great Recession and the Global Economy")
    expect(courseNameWithoutCode("CS 499 CALL3 - Independent Study in Computer Science")).toBe("Independent Study in Computer Science")
    // Blackboard styles.
    expect(courseNameWithoutCode("CSC215-01-FA26: Data Structures")).toBe("Data Structures")
    expect(courseNameWithoutCode("2026FA-MAT141-03 Calculus I")).toBe("Calculus I")
    expect(courseNameWithoutCode("BIO-101-02_FA26 – Biology")).toBe("Biology")
    expect(courseNameWithoutCode("PS 283 | Forensic Psychology")).toBe("Forensic Psychology")
  })

  it("drops a code or a semester at the end of a name", () => {
    expect(courseNameWithoutCode("Data Structures - CSC215-01 - Fall 2026")).toBe("Data Structures")
    expect(courseNameWithoutCode("Data Structures - CSC215-01")).toBe("Data Structures")
    expect(courseNameWithoutCode("Calculus I FA26")).toBe("Calculus I")
    expect(courseNameWithoutCode("Biology (Fall 2026)")).toBe("Biology")
    expect(courseNameWithoutCode("Organic Chemistry: Spring 2027")).toBe("Organic Chemistry")
    expect(courseNameWithoutCode("CSC 215 01 - Data Structures (CSC21501_26/FA)")).toBe("Data Structures")
  })

  it("drops Blackboard's year-first semester and a spaced code in brackets", () => {
    // A real Blackboard course list.
    expect(courseNameWithoutCode("Object-Oriented Design - 2026 Spring")).toBe("Object-Oriented Design")
    expect(courseNameWithoutCode("Object Design/Programming Lab - 2026 Spring")).toBe("Object Design/Programming Lab")
    expect(courseNameWithoutCode("Data Structures & Abstr.Lab - 2026 Spring")).toBe("Data Structures & Abstr.Lab")
    expect(courseNameWithoutCode("Intro Discrete Math (CSC 205)")).toBe("Intro Discrete Math")
    expect(courseNameWithoutCode("Biology 26SP")).toBe("Biology")
    expect(courseNameWithoutCode("Course 1026 Spring")).toBe("Course 1026 Spring")
  })

  it("leaves names that only look a bit like codes", () => {
    expect(courseNameWithoutCode("World War II")).toBe("World War II")
    expect(courseNameWithoutCode("Physics 2")).toBe("Physics 2")
    expect(courseNameWithoutCode("Music of the 1960s")).toBe("Music of the 1960s")
    expect(courseNameWithoutCode("Fall 2026")).toBe("Fall 2026")
    expect(courseNameWithoutCode("US History")).toBe("US History")
    expect(courseNameWithoutCode("COVID-19 Biology")).toBe("COVID-19 Biology")
    expect(courseNameWithoutCode("ADVANCED COMPUTING")).toBe("ADVANCED COMPUTING")
    expect(courseNameWithoutCode("CS 305")).toBe("CS 305")
    expect(courseNameWithoutCode("CS 305 - 01")).toBe("CS 305 - 01")
    expect(courseNameWithoutCode("Intro to Data Structures")).toBe("Intro to Data Structures")
  })

  it("keeps brackets that aren't a code, and never leaves a name empty", () => {
    expect(courseNameWithoutCode("Calculus (Honors)")).toBe("Calculus (Honors)")
    expect(courseNameWithoutCode("Chemistry (Lab Section B)")).toBe("Chemistry (Lab Section B)")
    expect(courseNameWithoutCode("Data Structures")).toBe("Data Structures")
    expect(courseNameWithoutCode("(PS28301_26/FA)")).toBe("(PS28301_26/FA)")
  })
})

describe("friendlyTermName", () => {
  it("spells LMS term codes the way students say them", () => {
    expect(friendlyTermName("26SP")).toBe("Spring 2026")
    expect(friendlyTermName("SP26")).toBe("Spring 2026")
    expect(friendlyTermName("2026SP")).toBe("Spring 2026")
    expect(friendlyTermName("2026 Spring")).toBe("Spring 2026")
    expect(friendlyTermName("FA2026")).toBe("Fall 2026")
    expect(friendlyTermName("26-SU")).toBe("Summer 2026")
    expect(friendlyTermName("wi27")).toBe("Winter 2027")
  })

  it("leaves names that are already readable, or aren't a season and year", () => {
    expect(friendlyTermName("Fall 2026")).toBe("Fall 2026")
    expect(friendlyTermName("Default Term")).toBe("Default Term")
    expect(friendlyTermName("Academic Year 2026-27")).toBe("Academic Year 2026-27")
    expect(friendlyTermName("Summer Session II")).toBe("Summer Session II")
  })
})
