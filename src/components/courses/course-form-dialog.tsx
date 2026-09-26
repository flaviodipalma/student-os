"use client"

import { useState } from "react"
import { Field, useFieldErrors } from "@/components/form-fields"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { checkDraft, ClassTimesFields, draftFrom } from "./class-times"
import { useAppStore } from "@/lib/app-store"
import { markCoursesAsked } from "@/lib/class-times-asked"
import { useCourses } from "@/lib/course-store"
import { useFeedback } from "@/lib/feedback"
import { normalizeCourseCode } from "@/lib/syllabus/duplicates"
import type { Course } from "@/lib/types"
import { courseFields } from "@/lib/validation"

// Create a course (no `course`), with its class times, or edit one (pass `course`;
// its class times are edited on the course page).
export function CourseFormDialog({
  open,
  onOpenChange,
  course,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  course?: Course
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{course ? "Edit course" : "New course"}</DialogTitle>
          <DialogDescription>
            {course ? "Update this course's details." : "Add a class you're taking this term."}
          </DialogDescription>
        </DialogHeader>
        <CourseForm course={course} onDone={() => onOpenChange(false)} />
      </DialogContent>
    </Dialog>
  )
}

function CourseForm({ course, onDone }: { course?: Course; onDone: () => void }) {
  const { courses, addCourse, updateCourse } = useCourses()
  const { today, setClassTimes } = useAppStore()
  const { showError } = useFeedback()
  const [classTimes, setClassTimesDraft] = useState(() => draftFrom([], today))
  const [code, setCode] = useState(course?.code ?? "")
  const [name, setName] = useState(course?.name ?? "")
  const [professor, setProfessor] = useState(course?.professor ?? "")
  const [description, setDescription] = useState(course?.description ?? "")
  const [error, setError] = useState<string | null>(null)
  const fields = useFieldErrors({
    code: "course-form-code",
    name: "course-form-name",
    professor: "course-form-professor",
    description: "course-form-description",
  })

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    // The same rules the server checks (src/lib/validation.ts).
    const parsed = courseFields.safeParse({ code, name, professor, description })
    if (!parsed.success) return setError(fields.show(parsed.error))
    const clash = courses.find(
      (other) => other.id !== course?.id && normalizeCourseCode(other.code) === normalizeCourseCode(code)
    )
    if (clash) return fields.set("code", `You already have a course with the code ${clash.code}.`)
    const checkedTimes = checkDraft(classTimes, today)
    if (!course && !checkedTimes.ok) return setError(checkedTimes.error)
    setError(null)

    const input = parsed.data
    if (course) updateCourse(course.id, input)
    else void addWithClassTimes(input, checkedTimes.ok ? checkedTimes.times : [])
    onDone()
  }

  async function addWithClassTimes(input: Parameters<typeof addCourse>[0], times: Parameters<typeof setClassTimes>[1]) {
    const saved = await addCourse(input)
    if (!saved) return
    // The class times question was answered here (with or without times).
    markCoursesAsked([saved.id])
    if (times.length === 0) return
    const result = await setClassTimes(saved.id, times, { quiet: true })
    if (!result.ok) showError(`The course was added, but its class times weren't saved: ${result.error}`)
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
        <Field label="Course code" htmlFor="course-form-code" error={fields.errors.code}>
          <Input
            id="course-form-code"
            value={code}
            onChange={(e) => {
              setCode(e.target.value)
              fields.clear("code")
            }}
            placeholder="CSC215"
            autoFocus
          />
        </Field>
        <Field label="Course name" htmlFor="course-form-name" error={fields.errors.name}>
          <Input
            id="course-form-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value)
              fields.clear("name")
            }}
            placeholder="Data Structures"
          />
        </Field>
      </div>
      <Field label="Professor" htmlFor="course-form-professor" optional>
        <Input id="course-form-professor" value={professor} onChange={(e) => setProfessor(e.target.value)} />
      </Field>
      <Field label="Description" htmlFor="course-form-description" optional>
        <Textarea
          id="course-form-description"
          rows={2}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
        />
      </Field>
      {!course && (
        <div className="grid gap-2">
          <p className="text-sm font-medium">
            Class times <span className="font-normal text-muted-foreground">(optional)</span>
          </p>
          <p className="text-sm text-muted-foreground">
            When the class meets each week. Without them, the course isn&apos;t on your calendar and the Planner may
            schedule study time during class.
          </p>
          <ClassTimesFields id="course-form-class-times" value={classTimes} onChange={setClassTimesDraft} />
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm font-medium text-destructive">
          {error}
        </p>
      )}
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit">{course ? "Save changes" : "Add course"}</Button>
      </DialogFooter>
    </form>
  )
}
