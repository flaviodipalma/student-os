"use client"

import { Field } from "@/components/form-fields"
import { Input } from "@/components/ui/input"
import type { ProfileInput } from "@/lib/types"
import { SchoolField } from "./school-field"

// Name and school. Used by onboarding and Settings.
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
      <div className="sm:col-span-2">
        <SchoolField value={{ schoolName: value.schoolName, schoolDomain: value.schoolDomain }} onChange={set} />
      </div>
    </div>
  )
}
