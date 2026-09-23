import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { IntegrationsCard, type IntegrationOutcomes } from "@/components/settings/integrations-card"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { lmsProviderIds } from "@/lib/types"
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

  // Where an LMS sign-in sent the student back to (?canvas=connected, ?blackboard=denied):
  // a short outcome code, never data.
  const params = await searchParams
  const outcomes: IntegrationOutcomes = {}
  for (const provider of lmsProviderIds) {
    const outcome = params[provider]
    if (typeof outcome === "string") outcomes[provider] = outcome
  }

  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <div className="space-y-6">
        <SettingsView />
        <IntegrationsCard
          integrations={integrations}
          outcomes={outcomes}
          timeZone={await getStudentTimeZone()}
        />
      </div>
    </>
  )
}
