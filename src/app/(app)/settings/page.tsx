import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { IntegrationsCard } from "@/components/settings/integrations-card"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { requireUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { getLmsIntegrationStatus, type LmsIntegrationStatus } from "@/server/integrations/lms/connections"

const section = getNavItem("/settings")

export const metadata: Metadata = { title: section.title }

export default async function SettingsPage() {
  // The signed-in student's own integrations (from the session, never the request).
  const user = await requireUser()
  let integrations: LmsIntegrationStatus[] | null = null
  try {
    integrations = await getLmsIntegrationStatus(getDb(), user.id)
  } catch (error) {
    console.error("[settings] couldn't load integrations", { name: error instanceof Error ? error.name : typeof error })
  }

  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <div className="space-y-6">
        <SettingsView />
        <IntegrationsCard integrations={integrations} />
      </div>
    </>
  )
}
