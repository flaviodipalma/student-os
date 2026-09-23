"use client"

import { useState } from "react"
import { CheckIcon, CircleAlertIcon } from "lucide-react"
import { CommitmentsEditor } from "@/components/preferences/commitments-editor"
import { ProfileFields } from "@/components/preferences/profile-fields"
import { StudyPreferencesFields } from "@/components/preferences/study-preferences-fields"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { ActionResult } from "@/lib/action-result"
import { useAppStore } from "@/lib/app-store"
import { useNotifications } from "@/lib/notification-store"
import { DEFAULT_NOTIFICATION_PREFERENCES, DEFAULT_STUDENT_PREFERENCES } from "@/lib/preferences"
import type { NotificationPreferences, ProfileInput, StudentPreferences } from "@/lib/types"
import { firstIssue, notificationPreferencesSchema, preferencesSchema, profileSchema } from "@/lib/validation"
import { NotificationSettingsFields } from "./notification-settings-fields"

// Profile, study preferences and weekly commitments. Same fields, validation and
// server actions as onboarding; this page just saves each section on its own.
export function SettingsView() {
  const store = useAppStore()
  const [profile, setProfile] = useState<ProfileInput>({
    firstName: store.student.firstName,
    lastName: store.student.lastName,
    academicTerm: store.student.academicTerm,
    academicYear: store.student.academicYear,
  })
  const [preferences, setPreferences] = useState<StudentPreferences>(store.preferences)
  const notificationStore = useNotifications()
  const [notificationPrefs, setNotificationPrefs] = useState<NotificationPreferences>(notificationStore.preferences)

  const toMessage = (result: ActionResult<unknown>) => (result.ok ? null : result.error)

  return (
    <div className="space-y-6">
      <Section
        title="About you"
        description="Your name is used in greetings; term and year help keep things organized."
        onSave={async () => {
          const parsed = profileSchema.safeParse(profile)
          if (!parsed.success) return firstIssue(parsed.error)
          return toMessage(await store.updateProfile(parsed.data))
        }}
      >
        <ProfileFields value={profile} onChange={setProfile} />
      </Section>

      <Section
        title="Study preferences"
        description="The Planner only suggests study time inside your window, up to your daily maximum, in blocks of your preferred length."
        onSave={async () => {
          const parsed = preferencesSchema.safeParse(preferences)
          if (!parsed.success) return firstIssue(parsed.error)
          return toMessage(await store.updatePreferences(parsed.data))
        }}
        extraAction={
          <Button type="button" variant="ghost" onClick={() => setPreferences(DEFAULT_STUDENT_PREFERENCES)}>
            Reset to defaults
          </Button>
        }
      >
        <StudyPreferencesFields value={preferences} onChange={setPreferences} />
      </Section>

      <Section
        id="notifications"
        title="Notifications"
        description="Reminders about deadlines, study sessions and events, in the bell and on your Dashboard."
        onSave={async () => {
          const parsed = notificationPreferencesSchema.safeParse(notificationPrefs)
          if (!parsed.success) return firstIssue(parsed.error)
          return toMessage(await notificationStore.updatePreferences(parsed.data))
        }}
        extraAction={
          <Button type="button" variant="ghost" onClick={() => setNotificationPrefs(DEFAULT_NOTIFICATION_PREFERENCES)}>
            Reset to defaults
          </Button>
        }
      >
        <NotificationSettingsFields value={notificationPrefs} onChange={setNotificationPrefs} />
      </Section>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">Recurring commitments</CardTitle>
          <CardDescription>
            Things you do every week. They show on your calendar, and the Planner never schedules study over them.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <CommitmentsEditor
            commitments={store.recurringCommitments}
            onAdd={async (input) => toMessage(await store.addCommitment(input))}
            onUpdate={async (id, input) => toMessage(await store.updateCommitment(id, input))}
            onDelete={store.deleteCommitment}
            withDates
            confirmDelete
          />
        </CardContent>
      </Card>
    </div>
  )
}

// A settings card with its own Save button and a saved/error message.
function Section({
  id,
  title,
  description,
  onSave,
  extraAction,
  children,
}: {
  id?: string
  title: string
  description: string
  // Returns an error message, or null when saved.
  onSave: () => Promise<string | null>
  extraAction?: React.ReactNode
  children: React.ReactNode
}) {
  const [status, setStatus] = useState<{ saving: boolean; error: string | null; saved: boolean }>({
    saving: false,
    error: null,
    saved: false,
  })

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setStatus({ saving: true, error: null, saved: false })
    const error = await onSave()
    setStatus({ saving: false, error, saved: !error })
  }

  return (
    <Card id={id}>
      <form onSubmit={handleSubmit} onChange={() => status.saved && setStatus((s) => ({ ...s, saved: false }))} noValidate>
        <CardHeader>
          <CardTitle className="text-lg font-semibold">{title}</CardTitle>
          <CardDescription>{description}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-5 pt-5">
          {children}
          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button type="submit" disabled={status.saving}>
              {status.saving ? "Saving…" : "Save"}
            </Button>
            {extraAction}
            {status.saved && (
              <span role="status" className="inline-flex items-center gap-1 text-sm text-emerald-700">
                <CheckIcon aria-hidden className="size-4" />
                Saved
              </span>
            )}
            {status.error && (
              <span role="alert" className="inline-flex items-center gap-1 text-sm font-medium text-destructive">
                <CircleAlertIcon aria-hidden className="size-4" />
                {status.error}
              </span>
            )}
          </div>
        </CardContent>
      </form>
    </Card>
  )
}
