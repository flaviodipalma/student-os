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
import { useAdaptiveContext } from "@/lib/planner-store"

// Settings > Adaptive planning: learn from my planning history (on/off), what
// was learned (only with enough history), and "Reset learning". The student's
// own settings and estimates are never changed by it.

export function LearningCard() {
  const { learning, setLearningEnabled, resetLearning } = useAppStore()
  const adaptive = useAdaptiveContext()
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [confirmReset, setConfirmReset] = useState(false)

  async function run(work: () => Promise<{ ok: boolean; error?: string }>) {
    setSaving(true)
    setError(null)
    const result = await work()
    setSaving(false)
    if (!result.ok) setError(result.error ?? "We couldn't save that. Try again.")
  }

  const insights = learning.enabled ? (adaptive?.insights ?? []) : []
  const adjusted = learning.enabled ? Object.keys(adaptive?.estimates ?? {}).length : 0

  return (
    <Card id="adaptive-planning">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Adaptive planning</CardTitle>
        <CardDescription>
          Student OS can learn from your own history (how long your tasks really take, when you finish study sessions) to
          plan more realistically. It never changes your estimates, settings or calendar.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-start gap-3">
          <Checkbox
            id="adaptive-enabled"
            checked={learning.enabled}
            disabled={saving}
            onCheckedChange={(value) => run(() => setLearningEnabled(value === true))}
            className="mt-0.5"
          />
          <div className="grid gap-0.5">
            <Label htmlFor="adaptive-enabled">Learn from my planning history</Label>
            <p className="text-xs text-muted-foreground">
              Off: the Planner uses only your own estimates and study preferences.
            </p>
          </div>
        </div>

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
              <ul className="mt-2 space-y-1.5 text-sm">
                {insights.map((insight) => (
                  <li key={insight.id} className="flex gap-2">
                    <span aria-hidden className="mt-2 size-1.5 shrink-0 rounded-full bg-primary" />
                    <span>
                      {insight.text}
                      {insight.confidence === "low" && <span className="text-muted-foreground"> (still learning)</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
            {adjusted > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">
                {adjusted === 1 ? "1 open task is" : `${adjusted} open tasks are`} planned with a learned estimate; the task
                shows why.
              </p>
            )}
            {learning.since && <p className="mt-2 text-xs text-muted-foreground">Learning from history since {learning.since}.</p>}
          </section>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button type="button" variant="outline" disabled={saving} onClick={() => setConfirmReset(true)}>
            Reset learning
          </Button>
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      </CardContent>

      <AlertDialog open={confirmReset} onOpenChange={setConfirmReset}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Reset what Student OS learned?</AlertDialogTitle>
            <AlertDialogDescription>
              Learned estimates and patterns start over from today, and your plan goes back to your own estimates.
              Your tasks, courses, study sessions and calendar stay exactly as they are.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => run(resetLearning)}>Reset learning</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
