import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { IntegrationsCard } from "@/components/settings/integrations-card"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { requireUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { getLmsIntegrationStatus, type LmsIntegrationStatus } from "@/server/integrations/lms/connections"
import { getStudentTimeZone } from "@/server/student-clock"

const section = getNavItem("/settings")

export const metadata: Metadata = { title: section.title }

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  // The signed-in student's own integrations (from the session, never the request).
  const user = await requireUser()
  let integrations: LmsIntegrationStatus[] | null = null
  try {
    integrations = await getLmsIntegrationStatus(getDb(), user.id)
  } catch (error) {
    console.error("[settings] couldn't load integrations", { name: error instanceof Error ? error.name : typeof error })
  }

  // Where Canvas's sign-in sent the student back to: a short outcome code, never data.
  const canvas = (await searchParams).canvas
  const canvasOutcome = typeof canvas === "string" ? canvas : null

  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <div className="space-y-6">
        <SettingsView />
        <IntegrationsCard
          integrations={integrations}
          canvasOutcome={canvasOutcome}
          timeZone={await getStudentTimeZone()}
        />
      </div>
    </>
  )
}
