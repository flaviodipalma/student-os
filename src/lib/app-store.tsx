"use client"

import { createContext, use, useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import {
  createCourseAction,
  createEventAction,
  createStudySessionAction,
  createTaskAction,
  deleteCourseAction,
  deleteEventAction,
  deleteStudySessionAction,
  deleteTaskAction,
  updateCourseAction,
  updateEventAction,
  updateStudySessionAction,
  updateTaskAction,
} from "@/app/actions/data"
import { importSyllabusAction } from "@/app/actions/syllabus"
import type { ActionResult } from "@/lib/action-result"
import { sessionsAsCalendarItems } from "@/lib/calendar-items"
import { pickCourseColor } from "@/lib/course-colors"
import { useFeedback } from "@/lib/feedback"
import type {
  CalendarEvent,
  Course,
  CourseInput,
  EventInput,
  StudySessionRecord,
  Student,
  Task,
  TaskInput,
  TaskStatus,
} from "@/lib/types"
import type { AppData } from "@/server/services/app-data"
import type { SyllabusImportRequest, SyllabusImportSaved } from "@/server/services/syllabus"

// The app's data in the browser: the signed-in user's courses, tasks, events and
// study sessions, loaded from the database by the (app) layout.
//
// Every change shows up immediately, then is saved through a server action. If
// saving fails, the change is undone and a message explains what happened.
// There is no other copy of the data: Dashboard, Calendar, Tasks, Courses and
// Planner all read from here.

type NewSession = Omit<StudySessionRecord, "id">

type AppStore = {
  today: string
  student: Student
  courses: Course[]
  tasks: Task[]
  events: CalendarEvent[]
  studySessions: StudySessionRecord[]
  // Events plus study sessions shown as study blocks.
  calendarItems: CalendarEvent[]
  getCourse: (id: string) => Course | undefined
  addCourse: (input: CourseInput) => Promise<Course | null>
  updateCourse: (id: string, changes: Partial<CourseInput>) => void
  deleteCourse: (id: string) => Promise<boolean>
  addTask: (input: TaskInput) => void
  updateTask: (id: string, changes: Partial<TaskInput>) => void
  deleteTask: (id: string) => void
  setStatus: (id: string, status: TaskStatus) => void
  addEvent: (input: EventInput) => void
  updateEvent: (id: string, changes: Partial<EventInput>) => void
  deleteEvent: (id: string) => void
  addStudySession: (input: NewSession) => void
  updateStudySession: (id: string, changes: Partial<NewSession>) => void
  deleteStudySession: (id: string) => void
  importSyllabus: (request: SyllabusImportRequest) => Promise<ActionResult<SyllabusImportSaved>>
}

const AppStoreContext = createContext<AppStore | null>(null)

const replaceById = <T extends { id: string }>(list: T[], item: T) => list.map((x) => (x.id === item.id ? item : x))
const withoutId = <T extends { id: string }>(list: T[], id: string) => list.filter((x) => x.id !== id)

// Optional fields left out of an edit mean "clear it": the server needs null for that.
function withClears<T extends object>(changes: T, clearable: string[]): T {
  const out = { ...changes } as Record<string, unknown>
  for (const key of clearable) if (key in out && out[key] === undefined) out[key] = null
  return out as T
}

const NETWORK_ERROR: ActionResult<never> = {
  ok: false,
  error: "We couldn't save that. Check your connection and try again.",
  code: "database",
}

export function AppStoreProvider({
  initial,
  today,
  children,
}: {
  initial: AppData
  today: string
  children: React.ReactNode
}) {
  const { showError } = useFeedback()
  const router = useRouter()
  const [courses, setCourses] = useState(initial.courses)
  const [tasks, setTasks] = useState(initial.tasks)
  const [events, setEvents] = useState(initial.events)
  const [studySessions, setStudySessions] = useState(initial.studySessions)

  // Awaits a server action; runs onOk with the saved record, or undoes the change.
  async function save<T>(request: Promise<ActionResult<T>>, onOk: (data: T) => void, undo: () => void) {
    const result = await request.catch(() => NETWORK_ERROR)
    if (result.ok) return onOk(result.data)
    undo()
    if (result.code === "unauthorized") router.push("/login")
    else showError(result.error)
  }

  const calendarItems = useMemo(
    () => [...events, ...sessionsAsCalendarItems(studySessions, tasks, courses)],
    [events, studySessions, tasks, courses]
  )

  const store: AppStore = {
    today,
    student: initial.student,
    courses,
    tasks,
    events,
    studySessions,
    calendarItems,
    getCourse: (id) => courses.find((course) => course.id === id),

    // ---- Courses
    addCourse: async (input) => {
      const id = crypto.randomUUID()
      setCourses((prev) => [...prev, { ...input, id, color: pickCourseColor(prev) }])
      let saved: Course | null = null
      await save(
        createCourseAction({ ...input, id }),
        (course) => {
          saved = course
          setCourses((prev) => replaceById(prev, course))
        },
        () => setCourses((prev) => withoutId(prev, id))
      )
      return saved
    },
    updateCourse: (id, changes) => {
      const before = courses.find((course) => course.id === id)
      if (!before) return
      setCourses((prev) => replaceById(prev, { ...before, ...changes }))
      save(
        updateCourseAction(id, changes),
        (course) => setCourses((prev) => replaceById(prev, course)),
        () => setCourses((prev) => replaceById(prev, before))
      )
    },
    // Deleting a course deletes its tasks and their study sessions too.
    deleteCourse: async (id) => {
      const snapshot = { courses, tasks, studySessions, events }
      const taskIds = new Set(tasks.filter((task) => task.courseId === id).map((task) => task.id))
      setCourses((prev) => withoutId(prev, id))
      setTasks((prev) => prev.filter((task) => task.courseId !== id))
      setStudySessions((prev) => prev.filter((session) => !taskIds.has(session.taskId)))
      setEvents((prev) => prev.map((event) => (event.courseId === id ? { ...event, courseId: undefined } : event)))
      let ok = false
      await save(
        deleteCourseAction(id),
        () => (ok = true),
        () => {
          setCourses(snapshot.courses)
          setTasks(snapshot.tasks)
          setStudySessions(snapshot.studySessions)
          setEvents(snapshot.events)
        }
      )
      return ok
    },

    // ---- Tasks
    addTask: (input) => {
      const id = crypto.randomUUID()
      setTasks((prev) => [...prev, { ...input, id }])
      save(
        createTaskAction({ ...input, id }),
        (task) => setTasks((prev) => replaceById(prev, task)),
        () => setTasks((prev) => withoutId(prev, id))
      )
    },
    updateTask: (id, changes) => {
      const before = tasks.find((task) => task.id === id)
      if (!before) return
      setTasks((prev) => replaceById(prev, { ...before, ...changes }))
      save(
        updateTaskAction(id, withClears(changes, ["dueTime", "plannedDate"])),
        (task) => setTasks((prev) => replaceById(prev, task)),
        () => setTasks((prev) => replaceById(prev, before))
      )
    },
    // Deleting a task deletes its study sessions too.
    deleteTask: (id) => {
      const before = { tasks, studySessions }
      setTasks((prev) => withoutId(prev, id))
      setStudySessions((prev) => prev.filter((session) => session.taskId !== id))
      save(deleteTaskAction(id), () => {}, () => {
        setTasks(before.tasks)
        setStudySessions(before.studySessions)
      })
    },
    setStatus: (id, status) => store.updateTask(id, { status }),

    // ---- Events
    addEvent: (input) => {
      const id = crypto.randomUUID()
      setEvents((prev) => [...prev, { ...input, id }])
      save(
        createEventAction({ ...input, id }),
        (event) => setEvents((prev) => replaceById(prev, event)),
        () => setEvents((prev) => withoutId(prev, id))
      )
    },
    updateEvent: (id, changes) => {
      const before = events.find((event) => event.id === id)
      if (!before) return
      setEvents((prev) => replaceById(prev, { ...before, ...changes }))
      save(
        updateEventAction(id, withClears(changes, ["description", "courseId"])),
        (event) => setEvents((prev) => replaceById(prev, event)),
        () => setEvents((prev) => replaceById(prev, before))
      )
    },
    deleteEvent: (id) => {
      const before = events.find((event) => event.id === id)
      if (!before) return
      setEvents((prev) => withoutId(prev, id))
      save(deleteEventAction(id), () => {}, () => setEvents((prev) => [...prev, before]))
    },

    // ---- Study sessions
    addStudySession: (input) => {
      const id = crypto.randomUUID()
      setStudySessions((prev) => [...prev, { ...input, id }])
      save(
        createStudySessionAction({ ...input, id }),
        (session) => setStudySessions((prev) => replaceById(prev, session)),
        () => setStudySessions((prev) => withoutId(prev, id))
      )
    },
    updateStudySession: (id, changes) => {
      const before = studySessions.find((session) => session.id === id)
      if (!before) return
      setStudySessions((prev) => replaceById(prev, { ...before, ...changes }))
      save(
        updateStudySessionAction(id, changes),
        (session) => setStudySessions((prev) => replaceById(prev, session)),
        () => setStudySessions((prev) => replaceById(prev, before))
      )
    },
    deleteStudySession: (id) => {
      const before = studySessions.find((session) => session.id === id)
      if (!before) return
      setStudySessions((prev) => withoutId(prev, id))
      save(deleteStudySessionAction(id), () => {}, () => setStudySessions((prev) => [...prev, before]))
    },

    // ---- Syllabus import (saved first, then shown: it's one confirmed step)
    importSyllabus: async (request) => {
      const result = await importSyllabusAction(request).catch(() => NETWORK_ERROR)
      if (result.ok) {
        const { course, createdCourse, tasks: created } = result.data
        if (createdCourse) setCourses((prev) => [...prev, course])
        setTasks((prev) => [...prev, ...created])
      } else if (result.code === "unauthorized") {
        router.push("/login")
      }
      return result
    },
  }

  return <AppStoreContext value={store}>{children}</AppStoreContext>
}

export function useAppStore(): AppStore {
  const store = use(AppStoreContext)
  if (!store) throw new Error("useAppStore must be used inside AppStoreProvider")
  return store
}
