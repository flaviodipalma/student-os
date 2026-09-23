"use client"

import { Field, SimpleSelect } from "@/components/form-fields"
import { Input } from "@/components/ui/input"
import { formatDuration } from "@/lib/format"
import { BREAK_OPTIONS, STUDY_BLOCK_OPTIONS } from "@/lib/preferences"
import type { StudentPreferences } from "@/lib/types"
import { cn } from "@/lib/utils"

const breakOptions = BREAK_OPTIONS.map((minutes) => ({
  value: String(minutes),
  label: minutes === 0 ? "No break" : `${minutes} minutes`,
}))

// Study window, daily maximum, block length and breaks. Used by onboarding and Settings.
export function StudyPreferencesFields({
  value,
  onChange,
}: {
  value: StudentPreferences
  onChange: (value: StudentPreferences) => void
}) {
  const set = (changes: Partial<StudentPreferences>) => onChange({ ...value, ...changes })
  return (
    <div className="grid gap-5">
      <div className="grid grid-cols-2 gap-4">
        <Field label="Start studying from" htmlFor="pref-start">
          <Input id="pref-start" type="time" value={value.studyStart} onChange={(e) => set({ studyStart: e.target.value })} />
        </Field>
        <Field label="Stop studying by" htmlFor="pref-end">
          <Input id="pref-end" type="time" value={value.studyEnd} onChange={(e) => set({ studyEnd: e.target.value })} />
        </Field>
      </div>

      <Field label="Most study time in a day (minutes)" htmlFor="pref-max">
        <div className="flex items-center gap-3">
          <Input
            id="pref-max"
            type="number"
            inputMode="numeric"
            min={15}
            max={720}
            step={15}
            className="w-28"
            value={Number.isNaN(value.maxStudyMinutesPerDay) ? "" : value.maxStudyMinutesPerDay}
            onChange={(e) => set({ maxStudyMinutesPerDay: e.target.value === "" ? NaN : Number(e.target.value) })}
          />
          <span className="text-sm text-muted-foreground">
            {value.maxStudyMinutesPerDay > 0 ? `= ${formatDuration(value.maxStudyMinutesPerDay)}` : ""}
          </span>
        </div>
      </Field>

      <div className="grid gap-1.5">
        <span id="pref-block-label" className="text-sm font-medium">
          Preferred study block
        </span>
        <div role="radiogroup" aria-labelledby="pref-block-label" className="inline-flex w-fit rounded-lg bg-muted p-1">
          {STUDY_BLOCK_OPTIONS.map((minutes) => (
            <button
              key={minutes}
              type="button"
              role="radio"
              aria-checked={value.preferredBlockMinutes === minutes}
              onClick={() => set({ preferredBlockMinutes: minutes })}
              className={cn(
                "rounded-md px-3 py-1 max-sm:py-2 text-sm font-medium transition-colors outline-none focus-visible:ring-3 focus-visible:ring-ring/50",
                value.preferredBlockMinutes === minutes
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {minutes} min
            </button>
          ))}
        </div>
      </div>

      <Field label="Break between blocks" htmlFor="pref-break">
        <div className="w-44">
          <SimpleSelect
            id="pref-break"
            value={String(value.breakMinutes)}
            options={breakOptions}
            onChange={(minutes) => set({ breakMinutes: Number(minutes) })}
          />
        </div>
      </Field>
    </div>
  )
}
