"use server"

import type { ActionResult } from "@/lib/action-result"
import type { CalendarEvent, Course, RecurringCommitment, StudySessionRecord, Task } from "@/lib/types"
import {
  classTimesSchema,
  createCourseSchema,
  createEventSchema,
  createSessionSchema,
  createTaskSchema,
  idSchema,
  updateCourseSchema,
  updateEventSchema,
  updateSessionSchema,
  updateTaskSchema,
} from "@/lib/validation"
import { parse, runAction } from "@/server/actions"
import { createCourse, deleteCourse, listCourses, updateCourse } from "@/server/services/courses"
import { createEvent, deleteEvent, updateEvent } from "@/server/services/events"
import { setClassTimes } from "@/server/services/recurring-commitments"
import { createStudySession, deleteStudySession, updateStudySession } from "@/server/services/study-sessions"
import { createTask, deleteTask, listTasks, updateTask } from "@/server/services/tasks"

// Server actions for everything the student edits. Each one runs on the server,
// finds the signed-in user from the verified session, validates the input and only
// touches that user's rows. Arguments are typed `unknown` on purpose: anything can
// arrive from the browser, so nothing is trusted until it's parsed.

// ---- Courses

export async function createCourseAction(input: unknown): Promise<ActionResult<Course>> {
  return runAction(({ db, userId }) => createCourse(db, userId, parse(createCourseSchema, input)))
}

export async function updateCourseAction(id: unknown, changes: unknown): Promise<ActionResult<Course>> {
  return runAction(({ db, userId }) => updateCourse(db, userId, parse(idSchema, id), parse(updateCourseSchema, changes)))
}

export async function deleteCourseAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await deleteCourse(db, userId, parse(idSchema, id))
    return null
  })
}

// The student's courses and tasks as saved now (e.g. after the extension imported some).
export async function loadCoursesAction(): Promise<ActionResult<{ courses: Course[]; tasks: Task[] }>> {
  return runAction(async ({ db, userId }) => ({ courses: await listCourses(db, userId), tasks: await listTasks(db, userId) }))
}

// A course's class times, all together (an empty list takes the course off the calendar).
export async function setClassTimesAction(courseId: unknown, times: unknown): Promise<ActionResult<RecurringCommitment[]>> {
  return runAction(({ db, userId }) => setClassTimes(db, userId, parse(idSchema, courseId), parse(classTimesSchema, times)))
}

// ---- Tasks

export async function createTaskAction(input: unknown): Promise<ActionResult<Task>> {
  return runAction(({ db, userId }) => createTask(db, userId, parse(createTaskSchema, input)))
}

export async function updateTaskAction(id: unknown, changes: unknown): Promise<ActionResult<Task>> {
  return runAction(({ db, userId }) => updateTask(db, userId, parse(idSchema, id), parse(updateTaskSchema, changes)))
}

export async function deleteTaskAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await deleteTask(db, userId, parse(idSchema, id))
    return null
  })
}

// ---- Events

export async function createEventAction(input: unknown): Promise<ActionResult<CalendarEvent>> {
  return runAction(({ db, userId }) => createEvent(db, userId, parse(createEventSchema, input)))
}

export async function updateEventAction(id: unknown, changes: unknown): Promise<ActionResult<CalendarEvent>> {
  return runAction(({ db, userId }) => updateEvent(db, userId, parse(idSchema, id), parse(updateEventSchema, changes)))
}

export async function deleteEventAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await deleteEvent(db, userId, parse(idSchema, id))
    return null
  })
}

// ---- Study sessions

export async function createStudySessionAction(input: unknown): Promise<ActionResult<StudySessionRecord>> {
  return runAction(({ db, userId }) => createStudySession(db, userId, parse(createSessionSchema, input)))
}

export async function updateStudySessionAction(id: unknown, changes: unknown): Promise<ActionResult<StudySessionRecord>> {
  return runAction(({ db, userId }) =>
    updateStudySession(db, userId, parse(idSchema, id), parse(updateSessionSchema, changes))
  )
}

export async function deleteStudySessionAction(id: unknown): Promise<ActionResult<null>> {
  return runAction(async ({ db, userId }) => {
    await deleteStudySession(db, userId, parse(idSchema, id))
    return null
  })
}
