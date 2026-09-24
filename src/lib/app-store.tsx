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
import {
  completeOnboardingAction,
  createCommitmentAction,
  deleteCommitmentAction,
  resetLearningAction,
  saveOnboardingAction,
  updateCommitmentAction,
  updateLearningAction,
  updatePreferencesAction,
  updateProfileAction,
} from "@/app/actions/settings"
import { setExternalEventHiddenAction } from "@/app/actions/integrations"
import { importSyllabusAction } from "@/app/actions/syllabus"
import type { ActionResult } from "@/lib/action-result"
import { externalEventsAsCalendarItems } from "@/lib/calendar/external-events"
import { sessionsAsCalendarItems } from "@/lib/calendar-items"
import { pickCourseColor } from "@/lib/course-colors"
import { useNow } from "@/lib/clock"
import { useFeedback } from "@/lib/feedback"
import { toDateKey } from "@/lib/format"
import { scheduleBetween } from "@/lib/recurring"
import {
  DEFAULT_LEARNING_SETTINGS,
  type CalendarEvent,
  type Course,
  type CourseInput,
  type EventInput,
  type ExternalEventRecord,
  type LearningSettings,
  type ProfileInput,
  type RecurringCommitment,
  type RecurringCommitmentInput,
  type StudentPreferences,
  type StudySessionRecord,
  type Student,
  type Task,
  type TaskInput,
  type TaskStatus,
} from "@/lib/types"
import type { AppData } from "@/server/services/app-data"
import type { OnboardingDetails, OnboardingSaved } from "@/server/services/onboarding"
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
  preferences: StudentPreferences
  // Adaptive planning on/off, and since when history counts.
  learning: LearningSettings
  recurringCommitments: RecurringCommitment[]
  // Read-only copies of Canvas / Blackboard calendar events (hidden ones included).
  externalEvents: ExternalEventRecord[]
  // The student's time zone (external events are shown at local times in it).
  timeZone: string | undefined
  // Events, visible external events and study sessions as calendar items (one-time things).
  calendarItems: CalendarEvent[]
  // Everything on the student's schedule from `from` to `to` (inclusive):
  // calendarItems plus that range's weekly commitment occurrences.
  scheduleBetween: (from: string, to: string) => CalendarEvent[]
  getCommitment: (id: string) => RecurringCommitment | undefined
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
  // After an LMS sync: the saved courses and tasks, as the server has them now.
  replaceCoursesAndTasks: (courses: Course[], tasks: Task[]) => void
  replaceExternalEvents: (events: ExternalEventRecord[]) => void
  // After the server saved something for the student (e.g. a change confirmed in
  // the Assistant): the saved tasks and study sessions, added or replaced by id.
  applySaved: (saved: { tasks: Task[]; studySessions: StudySessionRecord[]; learning?: LearningSettings }) => void
  // Local only: the event stays in Canvas / Blackboard.
  setExternalEventHidden: (id: string, hidden: boolean) => void
  // Profile, preferences and weekly commitments. These return the result so
  // forms can show validation messages next to the fields.
  updateProfile: (input: ProfileInput) => Promise<ActionResult<Student>>
  updatePreferences: (input: StudentPreferences) => Promise<ActionResult<StudentPreferences>>
  // Personalization: switches, mode, preferred times, corrections; and "Reset
  // learning" (tasks and sessions stay). `message` confirms the change.
  updateLearning: (changes: Partial<Omit<LearningSettings, "since">>, message?: string) => Promise<ActionResult<LearningSettings>>
  resetLearning: () => Promise<ActionResult<LearningSettings>>
  addCommitment: (input: RecurringCommitmentInput) => Promise<ActionResult<RecurringCommitment>>
  // Replaces the whole rule, so the edit applies to every week.
  updateCommitment: (id: string, input: RecurringCommitmentInput) => Promise<ActionResult<RecurringCommitment>>
  deleteCommitment: (id: string) => void
  saveOnboarding: (details: OnboardingDetails) => Promise<ActionResult<OnboardingSaved>>
  completeOnboarding: () => Promise<ActionResult<null>>
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

// Confirmation when a study session is stored with this status.
const sessionMessage: Record<StudySessionRecord["status"], string | undefined> = {
  scheduled: "Study session added to your calendar.",
  completed: "Study session completed. Nice work!",
  skipped: undefined, // shown in "Removed from this plan"; no toast needed
}

const NETWORK_ERROR: ActionResult<never> = {
  ok: false,
  error: "We couldn't save that. Check your connection and try again.",
  code: "database",
}

export function AppStoreProvider({
  initial,
  timeZone,
  children,
}: {
  initial: AppData
  timeZone?: string
  children: React.ReactNode
}) {
  // The student's local date, from the shared clock: it moves on at midnight
  // even if the page stays open.
  const today = toDateKey(useNow())
  const { showError, showSuccess } = useFeedback()
  const router = useRouter()
  const [courses, setCourses] = useState(initial.courses)
  const [tasks, setTasks] = useState(initial.tasks)
  const [events, setEvents] = useState(initial.events)
  const [studySessions, setStudySessions] = useState(initial.studySessions)
  const [student, setStudent] = useState(initial.student)
  const [preferences, setPreferences] = useState(initial.preferences)
  const [learning, setLearning] = useState(initial.learning ?? DEFAULT_LEARNING_SETTINGS)
  const [recurringCommitments, setRecurringCommitments] = useState(initial.recurringCommitments)
  const [externalEvents, setExternalEvents] = useState(initial.externalEvents ?? [])

  // Awaits a server action; runs onOk with the saved record (and confirms with
  // `success`, if given), or undoes the change and explains why.
  async function save<T>(
    request: Promise<ActionResult<T>>,
    onOk: (data: T) => void,
    undo: () => void,
    success?: string
  ) {
    const result = await request.catch(() => NETWORK_ERROR)
    if (result.ok) {
      if (success) showSuccess(success)
      return onOk(result.data)
    }
    undo()
    if (result.code === "unauthorized") router.push("/login")
    else showError(result.error)
  }

  const calendarItems = useMemo(
    () => [
      ...events,
      ...externalEventsAsCalendarItems(externalEvents, timeZone),
      ...sessionsAsCalendarItems(studySessions, tasks, courses),
    ],
    [events, externalEvents, timeZone, studySessions, tasks, courses]
  )

  // For saves where the form needs the outcome: returns it, and handles expired sessions.
  async function call<T>(request: Promise<ActionResult<T>>): Promise<ActionResult<T>> {
    const result = await request.catch(() => NETWORK_ERROR)
    if (!result.ok && result.code === "unauthorized") router.push("/login")
    return result
  }

  const store: AppStore = {
    today,
    student,
    preferences,
    learning,
    recurringCommitments,
    courses,
    tasks,
    events,
    studySessions,
    externalEvents,
    timeZone,
    calendarItems,
    scheduleBetween: (from, to) => scheduleBetween(calendarItems, recurringCommitments, from, to),
    getCommitment: (id) => recurringCommitments.find((commitment) => commitment.id === id),
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
        () => setCourses((prev) => withoutId(prev, id)),
        "Course created."
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
        () => setCourses((prev) => replaceById(prev, before)),
        "Course updated."
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
        },
        "Course deleted."
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
        () => setTasks((prev) => withoutId(prev, id)),
        "Task created."
      )
    },
    updateTask: (id, changes) => {
      const before = tasks.find((task) => task.id === id)
      if (!before) return
      setTasks((prev) => replaceById(prev, { ...before, ...changes }))
      // Only an edit gets a message; ticking a task off shows on the checkbox itself.
      const statusOnly = Object.keys(changes).length === 1 && "status" in changes
      save(
        updateTaskAction(id, withClears(changes, ["dueTime", "plannedDate"])),
        (task) => setTasks((prev) => replaceById(prev, task)),
        () => setTasks((prev) => replaceById(prev, before)),
        statusOnly ? (changes.status === "completed" ? "Task completed." : undefined) : "Task updated."
      )
    },
    // Deleting a task deletes its study sessions too.
    deleteTask: (id) => {
      const before = { tasks, studySessions }
      setTasks((prev) => withoutId(prev, id))
      setStudySessions((prev) => prev.filter((session) => session.taskId !== id))
      save(
        deleteTaskAction(id),
        () => {},
        () => {
          setTasks(before.tasks)
          setStudySessions(before.studySessions)
        },
        "Task deleted."
      )
    },
    setStatus: (id, status) => store.updateTask(id, { status }),

    // ---- Events
    addEvent: (input) => {
      const id = crypto.randomUUID()
      setEvents((prev) => [...prev, { ...input, id }])
      save(
        createEventAction({ ...input, id }),
        (event) => setEvents((prev) => replaceById(prev, event)),
        () => setEvents((prev) => withoutId(prev, id)),
        "Event saved."
      )
    },
    updateEvent: (id, changes) => {
      const before = events.find((event) => event.id === id)
      if (!before) return
      setEvents((prev) => replaceById(prev, { ...before, ...changes }))
      save(
        updateEventAction(id, withClears(changes, ["description", "courseId"])),
        (event) => setEvents((prev) => replaceById(prev, event)),
        () => setEvents((prev) => replaceById(prev, before)),
        "Event saved."
      )
    },
    deleteEvent: (id) => {
      const before = events.find((event) => event.id === id)
      if (!before) return
      setEvents((prev) => withoutId(prev, id))
      save(deleteEventAction(id), () => {}, () => setEvents((prev) => [...prev, before]), "Event deleted.")
    },

    // ---- Study sessions
    addStudySession: (input) => {
      const id = crypto.randomUUID()
      setStudySessions((prev) => [...prev, { ...input, id }])
      save(
        createStudySessionAction({ ...input, id }),
        (session) => setStudySessions((prev) => replaceById(prev, session)),
        () => setStudySessions((prev) => withoutId(prev, id)),
        sessionMessage[input.status]
      )
    },
    updateStudySession: (id, changes) => {
      const before = studySessions.find((session) => session.id === id)
      if (!before) return
      setStudySessions((prev) => replaceById(prev, { ...before, ...changes }))
      save(
        updateStudySessionAction(id, changes),
        (session) => setStudySessions((prev) => replaceById(prev, session)),
        () => setStudySessions((prev) => replaceById(prev, before)),
        // Undoing "done" (back to scheduled) needs no message.
        changes.status === "scheduled" ? undefined : changes.status ? sessionMessage[changes.status] : "Study session moved."
      )
    },
    deleteStudySession: (id) => {
      const before = studySessions.find((session) => session.id === id)
      if (!before) return
      setStudySessions((prev) => withoutId(prev, id))
      save(deleteStudySessionAction(id), () => {}, () => setStudySessions((prev) => [...prev, before]))
    },

    // ---- Profile, preferences, weekly commitments
    updateProfile: async (input) => {
      const result = await call(updateProfileAction(input))
      if (result.ok) setStudent(result.data)
      return result
    },
    updatePreferences: async (input) => {
      const result = await call(updatePreferencesAction(input))
      if (result.ok) {
        setPreferences(result.data)
        showSuccess("Preferences updated. Your plan uses them now.")
      }
      return result
    },
    updateLearning: async (changes, message) => {
      const result = await call(updateLearningAction(changes))
      if (result.ok) {
        setLearning(result.data)
        if (message) showSuccess(message)
      } else {
        showError(result.error)
      }
      return result
    },
    resetLearning: async () => {
      const result = await call(resetLearningAction())
      if (result.ok) {
        setLearning(result.data)
        // The recorded moves were cleared on the server too.
        setStudySessions((prev) => prev.map((s) => ({ ...s, rescheduleCount: 0, firstDate: null, firstStartTime: null })))
        showSuccess("Learning reset. Your tasks and sessions are unchanged.")
      }
      return result
    },
    addCommitment: async (input) => {
      const result = await call(createCommitmentAction({ ...input, id: crypto.randomUUID() }))
      if (result.ok) {
        setRecurringCommitments((prev) => [...prev, result.data])
        showSuccess("Recurring commitment added.")
      }
      return result
    },
    updateCommitment: async (id, input) => {
      // Optional fields left empty are cleared (null), not kept.
      const changes = {
        ...input,
        description: input.description ?? null,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
      }
      const result = await call(updateCommitmentAction(id, changes))
      if (result.ok) {
        setRecurringCommitments((prev) => replaceById(prev, result.data))
        showSuccess("Recurring commitment updated.")
      }
      return result
    },
    deleteCommitment: (id) => {
      const before = recurringCommitments.find((commitment) => commitment.id === id)
      if (!before) return
      setRecurringCommitments((prev) => withoutId(prev, id))
      save(
        deleteCommitmentAction(id),
        () => {},
        () => setRecurringCommitments((prev) => [...prev, before]),
        "Recurring commitment deleted."
      )
    },
    saveOnboarding: async (details) => {
      const result = await call(saveOnboardingAction(details))
      if (result.ok) {
        setStudent(result.data.student)
        setPreferences(result.data.preferences)
        setRecurringCommitments(result.data.recurringCommitments)
      }
      return result
    },
    completeOnboarding: async () => {
      const result = await call(completeOnboardingAction())
      if (result.ok) setStudent((prev) => ({ ...prev, onboardingCompleted: true }))
      return result
    },

    replaceCoursesAndTasks: (nextCourses, nextTasks) => {
      setCourses(nextCourses)
      setTasks(nextTasks)
    },
    replaceExternalEvents: setExternalEvents,
    applySaved: (saved) => {
      const upsert = <T extends { id: string }>(prev: T[], items: T[]) => {
        const ids = new Set(items.map((item) => item.id))
        return [...prev.filter((x) => !ids.has(x.id)), ...items]
      }
      if (saved.tasks.length) setTasks((prev) => upsert(prev, saved.tasks))
      if (saved.studySessions.length) setStudySessions((prev) => upsert(prev, saved.studySessions))
      if (saved.learning) setLearning(saved.learning)
    },
    setExternalEventHidden: (id, hidden) => {
      const before = externalEvents.find((event) => event.id === id)
      if (!before) return
      const toggle = (value: boolean) =>
        setExternalEvents((prev) => prev.map((event) => (event.id === id ? { ...event, hidden: value } : event)))
      toggle(hidden)
      save(
        setExternalEventHiddenAction(id, hidden),
        (saved) => setExternalEvents((prev) => replaceById(prev, saved)),
        () => toggle(before.hidden),
        hidden ? "Hidden from Student OS." : "Event restored."
      )
    },

    // ---- Syllabus import (saved first, then shown: it's one confirmed step)
    importSyllabus: async (request) => {
      const result = await importSyllabusAction(request).catch(() => NETWORK_ERROR)
      if (result.ok) {
        // Merged by id: a retried import that was already saved never shows twice.
        const { course, tasks: created } = result.data
        setCourses((prev) => (prev.some((c) => c.id === course.id) ? replaceById(prev, course) : [...prev, course]))
        const createdIds = new Set(created.map((task) => task.id))
        setTasks((prev) => [...prev.filter((task) => !createdIds.has(task.id)), ...created])
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
