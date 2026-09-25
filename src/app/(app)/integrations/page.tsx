import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import type { CalendarOutcomes } from "@/components/settings/calendar-connections"
import { IntegrationsCard } from "@/components/settings/integrations-card"
import { getNavItem } from "@/lib/navigation"
import { calendarProviderIds } from "@/lib/types"
import { requireUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { getCalendarIntegrationStatus, type CalendarIntegrationStatus } from "@/server/integrations/calendar/connections"
import { getCalendarProvider } from "@/server/integrations/calendar/registry"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { getLmsIntegrationStatus, type LmsIntegrationStatus } from "@/server/integrations/lms/connections"
import { getStudentTimeZone } from "@/server/student-clock"
import { logger } from "@/server/log"

const section = getNavItem("/integrations")

export const metadata: Metadata = { title: section.title }

export default async function IntegrationsPage({ searchParams }: PageProps<"/integrations">) {
  // The signed-in student's own integrations (from the session, never the request).
  const user = await requireUser()
  let integrations: LmsIntegrationStatus[] | null = null
  try {
    integrations = await getLmsIntegrationStatus(getDb(), user.id)
  } catch (error) {
    logger.error("integrations", "couldn't load integrations", { name: error instanceof Error ? error.name : typeof error })
  }
  let calendars: CalendarIntegrationStatus[] | null = null
  try {
    let vaultReady = true
    try {
      getCredentialVault()
    } catch {
      vaultReady = false
    }
    calendars = await getCalendarIntegrationStatus(getDb(), user.id, vaultReady)
  } catch (error) {
    logger.error("integrations", "couldn't load calendar connections", { name: error instanceof Error ? error.name : typeof error })
  }

  // Where a calendar sign-in sent the student back to (?google-calendar=connected):
  // a short outcome code, never data.
  const params = await searchParams
  const calendarOutcomes: CalendarOutcomes = {}
  for (const provider of calendarProviderIds) {
    const outcome = params[getCalendarProvider(provider).flow]
    if (typeof outcome === "string") calendarOutcomes[provider] = outcome
  }

  const timeZone = await getStudentTimeZone()

  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <div className="space-y-6">
        <IntegrationsCard
          integrations={integrations}
          timeZone={timeZone}
          calendars={calendars}
          calendarOutcomes={calendarOutcomes}
        />
      </div>
    </>
  )
}
