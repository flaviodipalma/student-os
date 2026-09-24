"use client"

import { useState } from "react"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { useAppStore } from "@/lib/app-store"
import { MODE_LABELS } from "@/lib/planner/modes"
import { useAdaptiveContext } from "@/lib/planner-store"
import { planningModes, studyPeriods, type LearningSettings, type PlanningMode, type StudyPeriod } from "@/lib/types"
import { cn } from "@/lib/utils"

// Settings > Personalization. The student's own choices first (planning mode,
// preferred study times: explicit, always win), then what Student OS may learn
// from their history (each signal can be switched off), what it learned (each
// pattern can be turned off) and "Reset learning". Nothing here changes tasks,
// estimates or the calendar.

const modeHints: Record<PlanningMode, string> = {
  balanced: "Deadlines, priorities and a sustainable pace.",
  "deadline-focus": "What's due in the next 3 days first.",
  "exam-focus": "Exams and quizzes in the next 10 days first.",
  "light-day": "About half your usual study; urgent work still fits.",
  custom: "Only your own settings: nothing learned is used.",
}
const periodLabels: Record<StudyPeriod, string> = { morning: "Morning", afternoon: "Afternoon", evening: "Evening", night: "Late night" }

export function LearningCard() {
  const { learning, updateLearning, resetLearning } = useAppStore()
  const adaptive = useAdaptiveContext()
  const [saving, setSaving] = useState(false)
  const [confirmReset, setConfirmReset] = useState(false)

  async function save(changes: Partial<Omit<LearningSettings, "since">>, message: string) {
    setSaving(true)
    await updateLearning(changes, message)
    setSaving(false)
  }

  const insights = learning.enabled ? (adaptive?.insights ?? []) : []
  const adjusted = learning.enabled ? Object.keys(adaptive?.estimates ?? {}).length : 0
  const togglePeriod = (period: StudyPeriod, on: boolean) =>
    save(
      { preferredPeriods: on ? [...learning.preferredPeriods, period] : learning.preferredPeriods.filter((p) => p !== period) },
      "Preferred study times saved. Your plan uses them now."
    )
  const switches: { key: "useEstimates" | "useStudyTimes" | "useWorkload"; label: string; hint: string }[] = [
    { key: "useEstimates", label: "Learned task durations", hint: "Plan tasks for as long as similar ones really took you." },
    { key: "useStudyTimes", label: "Learned study times", hint: "Use times you often miss last (never blocked)." },
    { key: "useWorkload", label: "Learned daily pace", hint: "Plan non-urgent work near what you usually finish in a day." },
  ]

  return (
    <Card id="personalization">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Personalization</CardTitle>
        <CardDescription>
          How Student OS plans for you. Your own choices always come first; learning from your history only adjusts the
          details and never changes your tasks, estimates, limits or calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <fieldset>
          <legend className="mb-2 text-sm font-medium">Planning mode</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {planningModes.map((mode) => (
              <label
                key={mode}
                className={cn(
                  "flex cursor-pointer flex-col rounded-lg border px-3 py-2 text-sm has-[:focus-visible]:ring-3 has-[:focus-visible]:ring-ring/50",
                  learning.planningMode === mode ? "border-primary bg-primary-soft text-primary-soft-foreground" : "hover:border-border-strong"
                )}
              >
                <input
                  type="radio"
                  name="planning-mode"
                  value={mode}
                  checked={learning.planningMode === mode}
                  disabled={saving}
                  onChange={() => save({ planningMode: mode }, `Planning mode: ${MODE_LABELS[mode]}. Your plan uses it now.`)}
                  className="sr-only"
                />
                <span className="font-medium">{MODE_LABELS[mode]}</span>
                <span className="text-xs text-muted-foreground">{modeHints[mode]}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="text-sm font-medium">Times I prefer to study</legend>
          <p className="mb-2 text-xs text-muted-foreground">
            Optional. The Planner uses free time in these first, inside your study window. This beats anything learned.
          </p>
          <div className="flex flex-wrap gap-x-5 gap-y-2">
            {studyPeriods.map((period) => (
              <div key={period} className="flex items-center gap-2">
                <Checkbox
                  id={`prefer-${period}`}
                  checked={learning.preferredPeriods.includes(period)}
                  disabled={saving}
                  onCheckedChange={(value) => togglePeriod(period, value === true)}
                />
                <Label htmlFor={`prefer-${period}`}>{periodLabels[period]}</Label>
              </div>
            ))}
          </div>
        </fieldset>

        <fieldset className="space-y-3">
          <legend className="text-sm font-medium">Learning from my planning history</legend>
          <div className="flex items-start gap-3">
            <Checkbox
              id="adaptive-enabled"
              checked={learning.enabled}
              disabled={saving}
              onCheckedChange={(value) =>
                save({ enabled: value === true }, value === true ? "Learning is on." : "Learning is off. Your plan uses only your own settings.")
              }
              className="mt-0.5"
            />
            <div className="grid gap-0.5">
              <Label htmlFor="adaptive-enabled">Learn from my history</Label>
              <p className="text-xs text-muted-foreground">Off: the Planner uses only your own estimates and settings.</p>
            </div>
          </div>
          <div className="grid gap-2 border-l pl-4 sm:ml-2">
            {switches.map((s) => (
              <div key={s.key} className="flex items-start gap-3">
                <Checkbox
                  id={`learn-${s.key}`}
                  checked={learning.enabled && learning[s.key]}
                  disabled={saving || !learning.enabled}
                  onCheckedChange={(value) => save({ [s.key]: value === true }, `${s.label}: ${value === true ? "on" : "off"}.`)}
                  className="mt-0.5"
                />
                <div className="grid gap-0.5">
                  <Label htmlFor={`learn-${s.key}`} className={!learning.enabled ? "text-muted-foreground" : undefined}>
                    {s.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{s.hint}</p>
                </div>
              </div>
            ))}
          </div>
        </fieldset>

        {learning.enabled && (
          <section aria-labelledby="learned-heading" className="rounded-lg border bg-muted/30 p-4">
            <h3 id="learned-heading" className="text-sm font-medium">
              Learned from your planning history
            </h3>
            {insights.length === 0 ? (
              <p className="mt-1 text-sm text-muted-foreground">
                Not enough history yet. Finish tasks and mark study sessions done, and patterns will show up here.
              </p>
            ) : (
              <ul className="mt-2 space-y-2 text-sm">
                {insights.map((insight) => {
                  const canTurnOff = /^(estimate|avoid):|^workload$/.test(insight.id)
                  return (
                    <li key={insight.id} className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                      <span className={cn("flex min-w-0 flex-1 gap-2", insight.dismissed && "text-muted-foreground line-through")}>
                        <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                        <span>
                          {insight.text}
                          {insight.confidence === "low" && <span className="text-muted-foreground"> (still learning)</span>}
                        </span>
                      </span>
                      {canTurnOff && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          disabled={saving}
                          aria-label={insight.dismissed ? `Use again: ${insight.text}` : `Don't use: ${insight.text}`}
                          onClick={() =>
                            save(
                              {
                                dismissedPatterns: insight.dismissed
                                  ? learning.dismissedPatterns.filter((id) => id !== insight.id)
                                  : [...learning.dismissedPatterns, insight.id],
                              },
                              insight.dismissed ? "The Planner uses that pattern again." : "The Planner won't use that pattern."
                            )
                          }
                        >
                          {insight.dismissed ? "Use again" : "Don't use"}
                        </Button>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
            {adjusted > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {adjusted === 1 ? "1 open task is" : `${adjusted} open tasks are`} planned with a learned duration; the task
                shows why.
              </p>
            )}
            {learning.since && <p className="mt-2 text-xs text-muted-foreground">Learning from history since {learning.since}.</p>}
          </section>
        )}

        <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmReset(true)}>
          Reset learning
        </Button>
      </CardContent>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset what Student OS learned?</AlertDialogTitle>
            <AlertDialogDescription>
              Learned durations and patterns start over from today, and your plan goes back to your own estimates. Your
              planning mode, preferred times, tasks, courses, study sessions and calendar stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => resetLearning()}>Reset learning</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
