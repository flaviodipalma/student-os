"use client"

import { useRef, useState } from "react"
import { CircleAlertIcon, CopyIcon, PlusIcon, Trash2Icon } from "lucide-react"
import { SimpleSelect } from "@/components/form-fields"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { useCourses } from "@/lib/course-store"
import { useAppStore } from "@/lib/app-store"
import { checkDraft, toImportRequest, type ImportRequest, type ImportResult } from "@/lib/syllabus/import"
import {
  blankReviewItem,
  defaultEstimateMinutes,
  findDraftDuplicates,
  type ReviewDraft,
  type ReviewItem,
} from "@/lib/syllabus/review"
import { syllabusItemTypes } from "@/lib/syllabus/schema"
import { useTasks } from "@/lib/task-store"
import { formatDue, priorities, priorityLabel, typeLabel } from "@/lib/tasks"
import type { Priority, Task, TaskType } from "@/lib/types"
import { cn } from "@/lib/utils"

const typeOptions = syllabusItemTypes.map((type) => ({ value: type as TaskType, label: typeLabel[type] }))
const priorityOptions = priorities.map((value) => ({ value, label: priorityLabel[value] }))

export function ReviewPanel({
  initialDraft,
  source,
  onCancel,
  onImported,
}: {
  initialDraft: ReviewDraft
  source: ImportRequest["source"]
  onCancel: () => void
  onImported: (result: ImportResult) => void
}) {
  const { courses, getCourse } = useCourses()
  const { tasks, today } = useTasks()
  const { importSyllabus } = useAppStore()
  const [draft, setDraft] = useState(initialDraft)
  const [tried, setTried] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  // Guards against a double click, and remembers what was sent for retries.
  const savingRef = useRef(false)
  const sentRef = useRef<{ draft: ReviewDraft; request: ImportRequest } | null>(null)

  const problems = checkDraft(draft)
  const problemKeys = new Set(problems.map((p) => p.itemKey).filter(Boolean))
  const duplicates = findDraftDuplicates(draft, tasks)
  const selected = draft.items.filter((item) => item.selected).length
  const existing = draft.target.kind === "existing" ? getCourse(draft.target.courseId) : undefined

  const updateItem = (key: string, changes: Partial<ReviewItem>) =>
    setDraft((d) => ({ ...d, items: d.items.map((item) => (item.key === key ? { ...item, ...changes } : item)) }))
  const removeItem = (key: string) => setDraft((d) => ({ ...d, items: d.items.filter((item) => item.key !== key) }))
  const setAll = (value: boolean) => setDraft((d) => ({ ...d, items: d.items.map((item) => ({ ...item, selected: value })) }))

  // The student confirmed: save the course and tasks (one database transaction).
  // A retry of the same, unchanged review resends the same request (same task
  // ids), so a save that went through before a dropped connection isn't doubled.
  async function handleImport() {
    setTried(true)
    if (problems.length > 0 || savingRef.current) return
    if (sentRef.current?.draft !== draft) {
      const request = toImportRequest(draft, true, source)
      sentRef.current = request ? { draft, request } : null
    }
    const request = sentRef.current?.request
    if (!request) return
    savingRef.current = true
    setSaving(true)
    setSaveError(null)
    const result = await importSyllabus(request)
    savingRef.current = false
    setSaving(false)
    if (!result.ok) return setSaveError(result.error)
    onImported({
      courseId: result.data.course.id,
      taskCount: result.data.tasks.length,
      createdCourse: result.data.createdCourse,
    })
  }

  const targetOptions = [
    { value: "new", label: "Create a new course" },
    ...courses.map((course) => ({ value: course.id, label: `Add to ${course.code} · ${course.name}` })),
  ]

  return (
    <section aria-labelledby="review-title" className="space-y-6 pb-28">
      <header>
        <h1 id="review-title" className="text-2xl font-semibold tracking-tight md:text-3xl">
          Review before importing
        </h1>
        <p className="mt-1.5 text-muted-foreground">
          Check each item against your syllabus. Fix anything that&apos;s wrong, remove what you don&apos;t need, and add
          anything missing. Nothing is added until you import.
        </p>
        <p className="mt-1 text-sm text-muted-foreground">
          Time estimates the syllabus doesn&apos;t give are filled with a typical length for that kind of work (shown in
          grey). Change them if you know better; you can also edit them later.
        </p>
      </header>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Course</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5 sm:max-w-sm">
            <Label htmlFor="review-target">Import into</Label>
            <SimpleSelect
              id="review-target"
              value={draft.target.kind === "existing" ? draft.target.courseId : "new"}
              onChange={(value) =>
                setDraft((d) => ({ ...d, target: value === "new" ? { kind: "new" } : { kind: "existing", courseId: value } }))
              }
              options={targetOptions}
            />
          </div>
          {existing ? (
            <p className="text-sm text-muted-foreground">
              Items will be added to <span className="font-medium text-foreground">{existing.code} · {existing.name}</span>.
              The course&apos;s details stay as they are.
            </p>
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <TextField id="course-code" label="Course code" value={draft.course.code} required tried={tried}
                onChange={(code) => setDraft((d) => ({ ...d, course: { ...d.course, code } }))} />
              <TextField id="course-name" label="Course name" value={draft.course.name} required tried={tried}
                onChange={(name) => setDraft((d) => ({ ...d, course: { ...d.course, name } }))} />
              <TextField id="course-professor" label="Professor" value={draft.course.professor}
                placeholder="Not found in the syllabus"
                onChange={(professor) => setDraft((d) => ({ ...d, course: { ...d.course, professor } }))} />
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="course-description">Description</Label>
                <Textarea id="course-description" rows={2} value={draft.course.description}
                  onChange={(e) => setDraft((d) => ({ ...d, course: { ...d.course, description: e.target.value } }))} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Academic items</CardTitle>
          <CardDescription>
            {selected} of {draft.items.length} selected.{" "}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setAll(true)}>
              Select all
            </button>
            {" · "}
            <button type="button" className="font-medium text-primary hover:underline" onClick={() => setAll(false)}>
              Select none
            </button>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {draft.items.length === 0 && (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              No items yet. Add them below.
            </p>
          )}
          <ul className="space-y-3">
            {draft.items.map((item) => (
              <ItemRow
                key={item.key}
                item={item}
                today={today}
                duplicate={duplicates.get(item.key)}
                invalid={tried && problemKeys.has(item.key)}
                onChange={(changes) => updateItem(item.key, changes)}
                onRemove={() => removeItem(item.key)}
              />
            ))}
          </ul>
          <Button variant="outline" onClick={() => setDraft((d) => ({ ...d, items: [...d.items, blankReviewItem()] }))}>
            <PlusIcon data-icon="inline-start" />
            Add missing item
          </Button>
        </CardContent>
      </Card>

      <div className="fixed inset-x-0 bottom-0 z-30 border-t bg-background/95 backdrop-blur lg:left-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-6 lg:px-10">
          <div className="min-w-0 text-sm" aria-live="polite">
            {saveError ? (
              <p className="flex items-start gap-1.5 text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {saveError}
              </p>
            ) : tried && problems.length > 0 ? (
              <p className="flex items-start gap-1.5 text-destructive">
                <CircleAlertIcon aria-hidden className="mt-0.5 size-4 shrink-0" />
                {problems[0].message}
                {problems.length > 1 && ` (+${problems.length - 1} more)`}
              </p>
            ) : (
              <p className="text-muted-foreground">
                {selected} {selected === 1 ? "item" : "items"} will become tasks
                {draft.target.kind === "new" ? " in a new course" : ""}.
              </p>
            )}
          </div>
          <div className="flex gap-2">
            <Button size="lg" variant="ghost" onClick={onCancel}>
              Cancel
            </Button>
            <Button size="lg" onClick={handleImport} disabled={saving || (tried && problems.length > 0)}>
              {saving ? "Importing…" : "Import into Student OS"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}

function TextField({
  id,
  label,
  value,
  onChange,
  required,
  tried,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (value: string) => void
  required?: boolean
  tried?: boolean
  placeholder?: string
}) {
  const missing = required && tried && !value.trim()
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Input id={id} value={value} placeholder={placeholder} aria-invalid={missing || undefined}
        onChange={(e) => onChange(e.target.value)} />
    </div>
  )
}

function ItemRow({
  item,
  today,
  duplicate,
  invalid,
  onChange,
  onRemove,
}: {
  item: ReviewItem
  today: string
  duplicate?: Task
  invalid: boolean
  onChange: (changes: Partial<ReviewItem>) => void
  onRemove: () => void
}) {
  const id = (field: string) => `${item.key}-${field}`
  const label = item.title.trim() || "new item"

  return (
    <li
      className={cn(
        "rounded-lg border p-3 transition-colors",
        !item.selected && "bg-muted/40",
        invalid && item.selected && "border-destructive/60",
        item.needsReview && item.selected && !invalid && "border-warning-border"
      )}
    >
      <div className="flex items-start gap-3">
        <Checkbox
          checked={item.selected}
          onCheckedChange={(checked) => onChange({ selected: checked })}
          aria-label={`Import ${label}`}
          className="mt-7 size-5 rounded-md"
        />
        <div className={cn("grid min-w-0 flex-1 gap-3", !item.selected && "opacity-60")}>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_11rem]">
            <MiniField id={id("title")} label="Title">
              <Input id={id("title")} value={item.title} placeholder="e.g. Assignment 3"
                aria-invalid={(invalid && !item.title.trim()) || undefined}
                onChange={(e) => onChange({ title: e.target.value })} />
            </MiniField>
            <MiniField id={id("type")} label="Type">
              <SimpleSelect id={id("type")} value={item.type} options={typeOptions} onChange={(type) => onChange({ type })} />
            </MiniField>
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <MiniField id={id("date")} label="Due date">
              <Input id={id("date")} type="date" value={item.dueDate}
                aria-invalid={(invalid && !item.dueDate) || undefined}
                onChange={(e) => onChange({ dueDate: e.target.value })} />
            </MiniField>
            <MiniField id={id("time")} label="Time (optional)">
              <Input id={id("time")} type="time" value={item.dueTime} onChange={(e) => onChange({ dueTime: e.target.value })} />
            </MiniField>
            <MiniField id={id("estimate")} label={item.estimateFromSyllabus ? "Minutes (from syllabus)" : "Minutes"}>
              <Input id={id("estimate")} type="number" inputMode="numeric" min={5} step={5} value={item.estimateMinutes}
                placeholder={`${defaultEstimateMinutes[item.type]} (default)`}
                onChange={(e) => onChange({ estimateMinutes: e.target.value, estimateFromSyllabus: false })} />
            </MiniField>
            <MiniField id={id("priority")} label="Priority">
              <SimpleSelect id={id("priority")} value={item.priority} options={priorityOptions}
                onChange={(priority: Priority) => onChange({ priority })} />
            </MiniField>
          </div>
          <MiniField id={id("notes")} label="Notes (optional)">
            <Textarea id={id("notes")} rows={1} value={item.description} className="min-h-8"
              onChange={(e) => onChange({ description: e.target.value })} />
          </MiniField>

          {item.sourceDate && (
            <p className="text-xs text-muted-foreground">
              Syllabus says: <span className="font-medium text-foreground">&ldquo;{item.sourceDate}&rdquo;</span>
            </p>
          )}
          {(item.needsReview || duplicate) && (
            <ul className="space-y-1 text-xs">
              {item.needsReview && (
                <li className="flex items-start gap-1.5 text-warning">
                  <CircleAlertIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                  <span>
                    Check this{item.reviewReason ? `: ${item.reviewReason}` : "."}
                  </span>
                </li>
              )}
              {duplicate && (
                <li className="flex items-start gap-1.5 text-muted-foreground">
                  <CopyIcon aria-hidden className="mt-px size-3.5 shrink-0" />
                  <span>
                    Looks like &ldquo;{duplicate.title}&rdquo;, already in Student OS (due {formatDue(duplicate, today)}).
                    Importing it would create a duplicate.
                  </span>
                </li>
              )}
            </ul>
          )}
        </div>
        <Button variant="ghost" size="icon-sm" className="mt-6" onClick={onRemove} aria-label={`Remove ${label}`}>
          <Trash2Icon />
        </Button>
      </div>
    </li>
  )
}

function MiniField({ id, label, children }: { id: string; label: string; children: React.ReactNode }) {
  return (
    <div className="grid min-w-0 gap-1">
      <Label htmlFor={id} className="text-xs font-normal text-muted-foreground">
        {label}
      </Label>
      {children}
    </div>
  )
}
