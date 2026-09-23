"use client"

import { Field, SimpleSelect } from "@/components/form-fields"
import { Input } from "@/components/ui/input"
import type { AcademicYear, ProfileInput } from "@/lib/types"

const NOT_SET = "not-set"
const yearOptions = [
  { value: NOT_SET, label: "Prefer not to say" },
  { value: "freshman", label: "Freshman (1st year)" },
  { value: "sophomore", label: "Sophomore (2nd year)" },
  { value: "junior", label: "Junior (3rd year)" },
  { value: "senior", label: "Senior (4th year)" },
  { value: "graduate", label: "Graduate student" },
  { value: "other", label: "Other" },
]

// Name, term and year in school. Used by onboarding and Settings.
export function ProfileFields({ value, onChange }: { value: ProfileInput; onChange: (value: ProfileInput) => void }) {
  const set = (changes: Partial<ProfileInput>) => onChange({ ...value, ...changes })
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="First name" htmlFor="profile-first-name">
        <Input
          id="profile-first-name"
          autoComplete="given-name"
          value={value.firstName}
          onChange={(e) => set({ firstName: e.target.value })}
        />
      </Field>
      <Field label="Last name" htmlFor="profile-last-name" optional>
        <Input
          id="profile-last-name"
          autoComplete="family-name"
          value={value.lastName}
          onChange={(e) => set({ lastName: e.target.value })}
        />
      </Field>
      <Field label="Current term" htmlFor="profile-term" optional>
        <Input
          id="profile-term"
          placeholder="e.g. Fall 2026"
          value={value.academicTerm}
          onChange={(e) => set({ academicTerm: e.target.value })}
        />
      </Field>
      <Field label="Year in school" htmlFor="profile-year" optional>
        <SimpleSelect
          id="profile-year"
          value={value.academicYear ?? NOT_SET}
          options={yearOptions}
          onChange={(year) => set({ academicYear: year === NOT_SET ? null : (year as AcademicYear) })}
        />
      </Field>
    </div>
  )
}
