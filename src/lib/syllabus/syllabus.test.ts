import { describe, expect, it, vi } from "vitest"
import type { SyllabusAIService } from "@/lib/ai/syllabus-ai-service"
import { MockSyllabusService } from "@/lib/ai/mock-syllabus-service"
import { generatePlan } from "@/lib/planner"
import type { Course, Task, TaskInput } from "@/lib/types"
import { findDuplicateTask, titlesSimilar } from "./duplicates"
import { SyllabusImportError } from "./errors"
import { buildImportPlan, checkDraft, importReviewedSyllabus, type ImportServices } from "./import"
import { processSyllabus, type ImportStage } from "./importer"
import { extractPdfText, MAX_FILE_BYTES } from "./pdf"
import { blankReviewItem, buildReviewDraft, findDraftDuplicates } from "./review"
import type { SyllabusExtraction } from "./schema"
import { makeBlankPdf, makeTextPdf } from "./test-utils/make-pdf"
import { validateExtraction } from "./validate"

const TODAY = "2026-09-22"

// A well-formed AI answer, as the model is asked to return it.
function aiOutput(overrides: Partial<SyllabusExtraction> = {}): SyllabusExtraction {
  return {
    course: {
      courseCode: "CSC 215",
      courseName: "Data Structures",
      professor: "John Smith",
      description: "Lists, trees and graphs.",
      term: "Fall 2026",
    },
    items: [
      item({ title: "Assignment 1", dueDate: "2026-09-25", dueTime: "23:59" }),
      item({ title: "Assignment 2", dueDate: "2026-10-02" }),
      item({ title: "Midterm Exam", type: "exam", dueDate: "2026-10-14", estimatedMinutes: 75, priority: "high" }),
    ],
    warnings: [],
    ...overrides,
  }
}

function item(overrides: Partial<SyllabusExtraction["items"][number]> = {}): SyllabusExtraction["items"][number] {
  return {
    title: "Item",
    type: "assignment",
    dueDate: "2026-10-01",
    dueTime: null,
    dateText: null,
    description: null,
    estimatedMinutes: null,
    priority: null,
    needsReview: false,
    reviewReason: null,
    ...overrides,
  }
}

const csc215: Course = {
  id: "csc215",
  code: "CSC215",
  name: "Data Structures",
  professor: "Prof. Elena Marsh",
  description: "",
  color: "sky",
}

function existingTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "t-a2",
    courseId: "csc215",
    title: "Assignment #2: Linked Lists",
    description: "",
    type: "assignment",
    dueDate: "2026-10-02",
    priority: "high",
    estimateMinutes: 90,
    status: "not_started",
    ...overrides,
  }
}

// In-memory stand-ins for the course and task stores.
function fakeServices() {
  const courses: (Course & { id: string })[] = []
  const tasks: Task[] = []
  const services: ImportServices = {
    addCourse: (input) => {
      const course = { ...input, id: `course-${courses.length + 1}`, color: "sky" as const }
      courses.push(course)
      return course
    },
    addTask: (input: TaskInput) => {
      tasks.push({ ...input, id: `task-${tasks.length + 1}` })
    },
  }
  return { courses, tasks, services }
}

function expectImportError(fn: () => unknown, code: SyllabusImportError["code"]) {
  try {
    fn()
  } catch (error) {
    expect(error).toBeInstanceOf(SyllabusImportError)
    expect((error as SyllabusImportError).code).toBe(code)
    return
  }
  throw new Error(`expected ${code}`)
}

describe("validateExtraction", () => {
  it("accepts well-formed AI output", () => {
    const result = validateExtraction(aiOutput(), TODAY)
    expect(result.course.courseCode).toBe("CSC 215")
    expect(result.items.map((i) => i.title)).toEqual(["Assignment 1", "Assignment 2", "Midterm Exam"])
    expect(result.items[2]).toMatchObject({ estimatedMinutes: 75, priority: "high", needsReview: false })
  })

  it("rejects output that doesn't match the schema", () => {
    expectImportError(() => validateExtraction("Here are the deadlines: ...", TODAY), "ai-invalid-response")
    expectImportError(() => validateExtraction({ ...aiOutput(), items: "none" }, TODAY), "ai-invalid-response")
    expectImportError(
      () => validateExtraction(aiOutput({ items: [{ ...item(), type: "homework" as never }] }), TODAY),
      "ai-invalid-response"
    )
  })

  it("rejects output with missing required fields", () => {
    const withoutCourse: Record<string, unknown> = { ...aiOutput() }
    delete withoutCourse.course
    expectImportError(() => validateExtraction(withoutCourse, TODAY), "ai-invalid-response")
    const itemWithoutFlag: Record<string, unknown> = { ...item() }
    delete itemWithoutFlag.needsReview
    expectImportError(() => validateExtraction({ ...aiOutput(), items: [itemWithoutFlag] }, TODAY), "ai-invalid-response")
  })

  it("clears bad values and flags the item instead of trusting them", () => {
    const result = validateExtraction(
      aiOutput({
        items: [
          item({ title: "Impossible date", dueDate: "2026-02-30" }),
          item({ title: "Bad time", dueTime: "25:99" }),
          item({ title: "Silly duration", estimatedMinutes: 100000 }),
          item({ title: "Wrong year?", dueDate: "2019-10-01" }),
          item({ title: "No date", dueDate: null }),
          item({ title: "   " }),
        ],
      }),
      TODAY
    )
    const byTitle = Object.fromEntries(result.items.map((i) => [i.title, i]))
    expect(byTitle["Impossible date"]).toMatchObject({ dueDate: null, needsReview: true })
    expect(byTitle["Bad time"].dueTime).toBeNull()
    expect(byTitle["Silly duration"].estimatedMinutes).toBeNull()
    expect(byTitle["Wrong year?"].needsReview).toBe(true)
    expect(byTitle["No date"]).toMatchObject({ dueDate: null, needsReview: true })
    expect(result.items).toHaveLength(5) // the blank title is dropped
  })

  it("drops exact repeats and reports when nothing useful was found", () => {
    const twice = validateExtraction(aiOutput({ items: [item({ title: "Quiz 1" }), item({ title: "Quiz 1" })] }), TODAY)
    expect(twice.items).toHaveLength(1)

    const empty = aiOutput({
      course: { courseCode: null, courseName: null, professor: null, description: null, term: null },
      items: [],
    })
    expectImportError(() => validateExtraction(empty, TODAY), "not-a-syllabus")
  })
})

describe("duplicate detection", () => {
  it("matches similar titles but keeps different numbers apart", () => {
    expect(titlesSimilar("Assignment 2", "Assignment #2: Linked Lists")).toBe(true)
    expect(titlesSimilar("assignment #2", "Assignment No. 2")).toBe(true)
    expect(titlesSimilar("Quiz 1", "Quiz 10")).toBe(false)
    expect(titlesSimilar("Midterm Exam", "Final Exam")).toBe(false)
  })

  it("finds a task with the same course, similar title and same due date", () => {
    const tasks = [existingTask()]
    expect(findDuplicateTask({ title: "Assignment 2", dueDate: "2026-10-02" }, "csc215", tasks)?.id).toBe("t-a2")
    expect(findDuplicateTask({ title: "Assignment 2", dueDate: "2026-10-03" }, "csc215", tasks)).toBeUndefined()
    expect(findDuplicateTask({ title: "Assignment 2", dueDate: "2026-10-02" }, "ser225", tasks)).toBeUndefined()
  })

  it("matches the course by code and leaves likely duplicates unselected", () => {
    const draft = buildReviewDraft(validateExtraction(aiOutput(), TODAY), [csc215], [existingTask()])

    expect(draft.target).toEqual({ kind: "existing", courseId: "csc215" }) // "CSC 215" = "CSC215"
    const duplicates = findDraftDuplicates(draft, [existingTask()])
    const a2 = draft.items.find((i) => i.title === "Assignment 2")!
    expect(duplicates.get(a2.key)?.id).toBe("t-a2")
    expect(a2.selected).toBe(false)
    expect(draft.items.filter((i) => i.selected).map((i) => i.title)).toEqual(["Assignment 1", "Midterm Exam"])
  })
})

describe("importing a reviewed syllabus", () => {
  it("creates the course and its tasks when confirmed", () => {
    const draft = buildReviewDraft(validateExtraction(aiOutput(), TODAY), [], [])
    const { courses, tasks, services } = fakeServices()

    const result = importReviewedSyllabus(draft, true, services)

    expect(result).toEqual({ courseId: "course-1", taskCount: 3, createdCourse: true })
    expect(courses).toEqual([
      expect.objectContaining({ code: "CSC 215", name: "Data Structures", professor: "John Smith" }),
    ])
    expect(tasks.map((t) => [t.title, t.courseId, t.dueDate, t.type])).toEqual([
      ["Assignment 1", "course-1", "2026-09-25", "assignment"],
      ["Assignment 2", "course-1", "2026-10-02", "assignment"],
      ["Midterm Exam", "course-1", "2026-10-14", "exam"],
    ])
    // Stated duration kept; no duration -> the visible per-type default, never an AI guess.
    expect(tasks[2].estimateMinutes).toBe(75)
    expect(tasks[0].estimateMinutes).toBe(90)
    expect(tasks[0]).toMatchObject({ dueTime: "23:59", status: "not_started", priority: "medium" })
  })

  it("adds to an existing course instead of creating a second one", () => {
    const draft = buildReviewDraft(validateExtraction(aiOutput(), TODAY), [csc215], [existingTask()])
    const { courses, tasks, services } = fakeServices()

    const result = importReviewedSyllabus(draft, true, services)

    expect(courses).toHaveLength(0)
    expect(result).toMatchObject({ courseId: "csc215", taskCount: 2, createdCourse: false })
    expect(tasks.every((t) => t.courseId === "csc215")).toBe(true)
  })

  it("respects the student's edits and selections", () => {
    const draft = buildReviewDraft(validateExtraction(aiOutput(), TODAY), [], [])
    draft.course.name = "Data Structures & Algorithms"
    draft.items[0] = { ...draft.items[0], title: "Homework 1", estimateMinutes: "45", priority: "critical" }
    draft.items[1] = { ...draft.items[1], selected: false }
    draft.items.push({ ...blankReviewItem(), title: "Final Project", type: "project", dueDate: "2026-12-05" })
    const { courses, tasks, services } = fakeServices()

    importReviewedSyllabus(draft, true, services)

    expect(courses[0].name).toBe("Data Structures & Algorithms")
    expect(tasks.map((t) => t.title)).toEqual(["Homework 1", "Midterm Exam", "Final Project"])
    expect(tasks[0]).toMatchObject({ estimateMinutes: 45, priority: "critical" })
    expect(tasks[2].estimateMinutes).toBe(240)
  })

  it("creates nothing without confirmation", () => {
    const draft = buildReviewDraft(validateExtraction(aiOutput(), TODAY), [], [])
    const { courses, tasks, services } = fakeServices()
    const addCourse = vi.spyOn(services, "addCourse")
    const addTask = vi.spyOn(services, "addTask")

    expect(importReviewedSyllabus(draft, false, services)).toBeNull()
    expect(addCourse).not.toHaveBeenCalled()
    expect(addTask).not.toHaveBeenCalled()
    expect(courses).toHaveLength(0)
    expect(tasks).toHaveLength(0)
  })

  it("blocks the import until required information is filled in", () => {
    const draft = buildReviewDraft(
      validateExtraction(
        aiOutput({
          course: { courseCode: null, courseName: "Biology", professor: null, description: null, term: null },
          items: [item({ title: "Lab report", dueDate: null })],
        }),
        TODAY
      ),
      [],
      []
    )
    expect(checkDraft(draft).map((p) => p.message)).toEqual(["Add the course code.", "Lab report needs a due date."])
    expect(() => buildImportPlan(draft)).toThrow()

    const { services, tasks } = fakeServices()
    expect(() => importReviewedSyllabus(draft, true, services)).toThrow()
    expect(tasks).toHaveLength(0)

    // Deselecting the undated item and adding the code makes it valid.
    draft.course.code = "BIO101"
    draft.items[0].selected = false
    expect(checkDraft(draft)).toEqual([])
  })
})

describe("imported tasks and the Planner", () => {
  it("are planned like any other task, and completed ones are left out", () => {
    const draft = buildReviewDraft(validateExtraction(aiOutput(), TODAY), [], [])
    const { tasks, services } = fakeServices()
    importReviewedSyllabus(draft, true, services)

    const now = new Date(2026, 8, 22, 8, 0)
    const plan = generatePlan({ date: TODAY, tasks, events: [], now })
    const planned = new Set(plan.suggestions.map((s) => s.taskId))
    expect(planned.has(tasks[0].id)).toBe(true) // Assignment 1, due in 3 days

    const withDone = tasks.map((t, i) => (i === 0 ? { ...t, status: "completed" as const } : t))
    const after = generatePlan({ date: TODAY, tasks: withDone, events: [], now })
    expect(after.suggestions.some((s) => s.taskId === tasks[0].id)).toBe(false)
  })
})

describe("PDF text extraction", () => {
  it("reads the text layer of a PDF", async () => {
    const pdf = makeTextPdf(["CSC 215 — Data Structures", "Assignment 1 — September 25", "Midterm Exam — October 14"])
    const { text, pageCount } = await extractPdfText(pdf)
    expect(pageCount).toBe(1)
    expect(text).toContain("Assignment 1 — September 25")
    expect(text).toContain("Midterm Exam")
  })

  it("rejects a PDF with no text layer (a scan)", async () => {
    await expect(extractPdfText(makeBlankPdf())).rejects.toMatchObject({ code: "no-text" })
  })

  it("rejects bytes that aren't a readable PDF", async () => {
    const broken = Uint8Array.from("%PDF-1.4\nthis is not really a pdf", (c) => c.charCodeAt(0))
    await expect(extractPdfText(broken)).rejects.toMatchObject({ code: "pdf-unreadable" })
  })
})

describe("processSyllabus (with a mocked AI service)", () => {
  const syllabusPdf = makeTextPdf([
    "CSC 215 — Data Structures, Fall 2026",
    "Instructor: John Smith",
    "Assignment 1 — September 25",
    "Midterm Exam — October 14",
  ])
  const upload = (bytes: Uint8Array, name = "syllabus.pdf", type = "application/pdf") => ({
    name,
    type,
    size: bytes.length,
    bytes,
  })

  it("runs extract -> AI -> validate and never calls the real API", async () => {
    const ai: SyllabusAIService = { extractSyllabusData: vi.fn().mockResolvedValue(aiOutput()) }
    const stages: ImportStage[] = []

    const result = await processSyllabus(upload(syllabusPdf), { ai, today: TODAY, onStage: (s) => stages.push(s) })

    expect(stages).toEqual(["reading", "analyzing", "checking"])
    expect(ai.extractSyllabusData).toHaveBeenCalledWith(expect.stringContaining("Assignment 1 — September 25"), {
      today: TODAY,
    })
    expect(result.extraction.items).toHaveLength(3)
  })

  it("rejects bad uploads before any AI call", async () => {
    const ai: SyllabusAIService = { extractSyllabusData: vi.fn() }
    const run = (u: ReturnType<typeof upload>) => processSyllabus(u, { ai, today: TODAY })

    await expect(run(upload(syllabusPdf, "notes.docx", "application/msword"))).rejects.toMatchObject({
      code: "invalid-file-type",
    })
    const fakePdf = Uint8Array.from("hello", (c) => c.charCodeAt(0))
    await expect(run(upload(fakePdf))).rejects.toMatchObject({ code: "invalid-file-type" })
    await expect(run(upload(new Uint8Array()))).rejects.toMatchObject({ code: "empty-file" })
    await expect(run({ ...upload(syllabusPdf), size: MAX_FILE_BYTES + 1 })).rejects.toMatchObject({
      code: "file-too-large",
    })
    await expect(run(upload(makeBlankPdf()))).rejects.toMatchObject({ code: "no-text" })
    expect(ai.extractSyllabusData).not.toHaveBeenCalled()
  })

  it("turns AI failures into friendly errors", async () => {
    const crashing: SyllabusAIService = { extractSyllabusData: vi.fn().mockRejectedValue(new Error("socket hang up")) }
    const error = await processSyllabus(upload(syllabusPdf), { ai: crashing, today: TODAY }).catch((e) => e)
    expect(error).toBeInstanceOf(SyllabusImportError)
    expect(error.code).toBe("ai-failed")
    expect(error.userMessage).not.toContain("socket")

    const timeout: SyllabusAIService = {
      extractSyllabusData: vi.fn().mockRejectedValue(new SyllabusImportError("ai-timeout")),
    }
    await expect(processSyllabus(upload(syllabusPdf), { ai: timeout, today: TODAY })).rejects.toMatchObject({
      code: "ai-timeout",
    })

    const garbage: SyllabusAIService = { extractSyllabusData: vi.fn().mockResolvedValue({ deadlines: "soon" }) }
    await expect(processSyllabus(upload(syllabusPdf), { ai: garbage, today: TODAY })).rejects.toMatchObject({
      code: "ai-invalid-response",
    })
  })

  it("works end to end with the local mock provider", async () => {
    const result = await processSyllabus(upload(syllabusPdf), { ai: new MockSyllabusService(), today: TODAY })
    expect(result.extraction.course).toMatchObject({ courseCode: "CSC215", professor: "John Smith" })
    expect(result.extraction.items.map((i) => [i.title, i.type, i.dueDate])).toEqual([
      ["Assignment 1", "assignment", "2026-09-25"],
      ["Midterm Exam", "exam", "2026-10-14"],
    ])
  })
})
