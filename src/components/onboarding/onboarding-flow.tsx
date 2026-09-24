"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { BookOpenIcon, CheckIcon, CircleAlertIcon, FileUpIcon, GraduationCapIcon } from "lucide-react"
import { CourseTag } from "@/components/course-tag"
import { CourseFormDialog } from "@/components/courses/course-form-dialog"
import { CommitmentsEditor, type EditableCommitment } from "@/components/preferences/commitments-editor"
import { ProfileFields } from "@/components/preferences/profile-fields"
import { StudyPreferencesFields } from "@/components/preferences/study-preferences-fields"
import { SyllabusImporter } from "@/components/syllabus/syllabus-importer"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/app-store"
import { DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { ProfileInput, StudentPreferences } from "@/lib/types"
import { cn } from "@/lib/utils"
import { firstIssue, preferencesSchema, profileSchema } from "@/lib/validation"

// First-time setup, four short steps. Everything entered is kept while moving
// back and forth. Steps 1-3 are saved together when leaving step 3 (so they
// survive a reload); Finish marks onboarding complete. Uses the same fields,
// validation and server actions as the Settings page.

const steps = [
  { title: "About you", description: "So Student OS knows what to call you." },
  { title: "Study preferences", description: "When and how you like to study. The defaults work for most students." },
  {
    title: "Recurring commitments",
    description: "Things you do every week, like practice, work or clubs. The Planner keeps these times free.",
  },
  { title: "Courses", description: "Add your classes now, or skip and do it later." },
]

export function OnboardingFlow() {
  const store = useAppStore()
  const router = useRouter()
  const [step, setStep] = useState(0)
  const [profile, setProfile] = useState<ProfileInput>({
    firstName: store.student.firstName,
    lastName: store.student.lastName,
    academicTerm: store.student.academicTerm,
    academicYear: store.student.academicYear,
  })
  const [preferences, setPreferences] = useState<StudentPreferences>(store.preferences)
  const [commitments, setCommitments] = useState<EditableCommitment[]>(store.recurringCommitments)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [courseDialogOpen, setCourseDialogOpen] = useState(false)
  const [importing, setImporting] = useState(false)

  const go = (to: number) => {
    setError(null)
    setStep(to)
    window.scrollTo({ top: 0 })
  }

  function nextFromProfile() {
    const parsed = profileSchema.safeParse(profile)
    if (!parsed.success) return setError(firstIssue(parsed.error))
    go(1)
  }

  function nextFromPreferences() {
    const parsed = preferencesSchema.safeParse(preferences)
    if (!parsed.success) return setError(firstIssue(parsed.error))
    go(2)
  }

  // Leaving step 3: save steps 1-3 together.
  async function saveDetails() {
    const parsedProfile = profileSchema.safeParse(profile)
    const parsedPreferences = preferencesSchema.safeParse(preferences)
    if (!parsedProfile.success) return (go(0), setError(firstIssue(parsedProfile.error)))
    if (!parsedPreferences.success) return (go(1), setError(firstIssue(parsedPreferences.error)))
    setBusy(true)
    const result = await store.saveOnboarding({
      profile: parsedProfile.data,
      preferences: parsedPreferences.data,
      commitments: commitments.map(({ title, daysOfWeek, startTime, endTime, type }) => ({
        title,
        daysOfWeek,
        startTime,
        endTime,
        type,
      })),
    })
    setBusy(false)
    if (!result.ok) return setError(result.error)
    setCommitments(result.data.recurringCommitments) // now with their saved ids
    go(3)
  }

  async function finish() {
    setBusy(true)
    const result = await store.completeOnboarding()
    if (!result.ok) {
      setBusy(false)
      return setError(result.error)
    }
    router.push("/dashboard")
  }

  const current = steps[step]

  return (
    <div className="mx-auto w-full max-w-2xl">
      <div className="mb-6 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCapIcon className="size-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight">Student OS</span>
      </div>

      <Progress step={step} />

      <section aria-labelledby="onboarding-title" className="mt-6 rounded-xl bg-card p-5 ring-1 ring-foreground/10 sm:p-8">
        <p className="text-sm font-medium text-primary">
          Step {step + 1} of {steps.length}
        </p>
        <h1 id="onboarding-title" className="mt-1 text-2xl font-semibold tracking-tight">
          {step === 0 ? `Welcome${profile.firstName.trim() ? `, ${profile.firstName.trim()}` : ""}!` : current.title}
        </h1>
        <p className="mt-1 text-muted-foreground">{current.description}</p>
        {step === 0 && (
          <div className="mt-4 rounded-lg bg-primary/[0.06] px-4 py-3 text-sm">
            <p className="font-semibold">You don&apos;t organize college. Student OS does.</p>
            <p className="mt-1 text-muted-foreground">
              Add your classes and deadlines, and Student OS plans your study time around your schedule, and tells you
              what to work on right now. Four quick steps; skip anything you don&apos;t need yet.
            </p>
          </div>
        )}

        <div className="mt-6">
          {step === 0 && <ProfileFields value={profile} onChange={setProfile} />}
          {step === 1 && <StudyPreferencesFields value={preferences} onChange={setPreferences} />}
          {step === 2 && (
            <CommitmentsEditor
              commitments={commitments}
              onAdd={(input) => {
                setCommitments((prev) => [...prev, { ...input, id: crypto.randomUUID() }])
                return null
              }}
              onUpdate={(id, input) => {
                setCommitments((prev) => prev.map((c) => (c.id === id ? { ...input, id } : c)))
                return null
              }}
              onDelete={(id) => setCommitments((prev) => prev.filter((c) => c.id !== id))}
            />
          )}
          {step === 3 &&
            (importing ? (
              <div className="space-y-4">
                <button
                  type="button"
                  className="text-sm font-medium text-muted-foreground hover:text-foreground"
                  onClick={() => setImporting(false)}
                >
                  ← Back to course options
                </button>
                <SyllabusImporter onFinished={() => setImporting(false)} />
              </div>
            ) : (
              <CourseStep onAddCourse={() => setCourseDialogOpen(true)} onImport={() => setImporting(true)} />
            ))}
        </div>

        {error && (
          <p role="alert" className="mt-5 flex items-start gap-2 text-sm font-medium text-destructive">
            <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
            {error}
          </p>
        )}

        {!importing && (
          <div className="mt-8 flex flex-wrap items-center justify-between gap-3 border-t pt-5">
            {/* No "Back" on the first step (there's nothing to go back to). */}
            {step > 0 ? (
              <Button variant="ghost" onClick={() => go(step - 1)} disabled={busy}>
                Back
              </Button>
            ) : (
              <span />
            )}
            <div className="flex flex-wrap gap-2">
              {step === 1 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    setPreferences(DEFAULT_STUDENT_PREFERENCES)
                    go(2)
                  }}
                >
                  Use defaults
                </Button>
              )}
              {step === 0 && <Button onClick={nextFromProfile}>Continue</Button>}
              {step === 1 && <Button onClick={nextFromPreferences}>Continue</Button>}
              {step === 2 && (
                <Button onClick={saveDetails} disabled={busy}>
                  {busy ? "Saving…" : commitments.length === 0 ? "Skip for now" : "Save and continue"}
                </Button>
              )}
              {step === 3 && (
                <Button onClick={finish} disabled={busy}>
                  {busy ? "Finishing…" : store.courses.length === 0 ? "Skip and finish" : "Finish setup"}
                </Button>
              )}
            </div>
          </div>
        )}
      </section>

      <CourseFormDialog open={courseDialogOpen} onOpenChange={setCourseDialogOpen} />
    </div>
  )
}

function Progress({ step }: { step: number }) {
  return (
    <ol aria-label="Setup progress" className="grid grid-cols-4 gap-2">
      {steps.map((s, index) => {
        const done = index < step
        const active = index === step
        return (
          <li key={s.title} aria-current={active ? "step" : undefined}>
            <span className={cn("block h-1.5 rounded-full", done || active ? "bg-primary" : "bg-foreground/10")} />
            <span
              className={cn(
                "mt-2 hidden items-center gap-1 text-xs sm:flex",
                active ? "font-medium text-foreground" : "text-muted-foreground"
              )}
            >
              {done && <CheckIcon aria-hidden className="size-3" />}
              {s.title}
            </span>
          </li>
        )
      })}
    </ol>
  )
}

function CourseStep({ onAddCourse, onImport }: { onAddCourse: () => void; onImport: () => void }) {
  const { courses } = useAppStore()
  return (
    <div className="space-y-5">
      {courses.length > 0 && (
        <div>
          <p className="text-sm font-medium">Your courses</p>
          <ul className="mt-2 flex flex-wrap gap-2">
            {courses.map((course) => (
              <li key={course.id} className="rounded-md bg-muted px-2.5 py-1 text-sm">
                <CourseTag code={course.code} color={course.color} />
                <span className="text-muted-foreground"> · {course.name}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        <OptionCard
          icon={<BookOpenIcon className="size-5" />}
          title="Add courses manually"
          description="Type in each class: code, name and professor."
          action="Add a course"
          onClick={onAddCourse}
        />
        <OptionCard
          icon={<FileUpIcon className="size-5" />}
          title="Import a syllabus"
          description="Upload a PDF and we'll add the course and its deadlines. You review everything first."
          action="Import a syllabus"
          onClick={onImport}
        />
      </div>
      <p className="text-sm text-muted-foreground">You can always add more courses later from the Courses page.</p>
    </div>
  )
}

function OptionCard({
  icon,
  title,
  description,
  action,
  onClick,
}: {
  icon: React.ReactNode
  title: string
  description: string
  action: string
  onClick: () => void
}) {
  return (
    <div className="flex flex-col rounded-lg border p-4">
      <span className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">{icon}</span>
      <h2 className="mt-3 font-medium">{title}</h2>
      <p className="mt-1 flex-1 text-sm text-muted-foreground">{description}</p>
      <Button variant="outline" className="mt-4 w-fit" onClick={onClick}>
        {action}
      </Button>
    </div>
  )
}
