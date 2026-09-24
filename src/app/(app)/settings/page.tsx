import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { AccountCard } from "@/components/settings/account-card"
import { AppearanceCard } from "@/components/settings/appearance-card"
import type { CalendarOutcomes } from "@/components/settings/calendar-connections"
import { IntegrationsCard, type IntegrationOutcomes } from "@/components/settings/integrations-card"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { calendarProviderIds, lmsProviderIds } from "@/lib/types"
import { requireUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { getCalendarIntegrationStatus, type CalendarIntegrationStatus } from "@/server/integrations/calendar/connections"
import { getCalendarProvider } from "@/server/integrations/calendar/registry"
import { getCredentialVault } from "@/server/integrations/lms/credential-vault"
import { getLmsIntegrationStatus, type LmsIntegrationStatus } from "@/server/integrations/lms/connections"
import { enabledSocialProviders, getAccountDetails } from "@/server/social-auth"
import { getStudentTimeZone } from "@/server/student-clock"

const section = getNavItem("/settings")

// In the order they appear on the page.
const sections = [
  { id: "profile", label: "Profile" },
  { id: "study-preferences", label: "Study preferences" },
  { id: "recurring-commitments", label: "Recurring commitments" },
  { id: "notifications", label: "Notifications" },
  { id: "appearance", label: "Appearance" },
  { id: "integrations", label: "Integrations" },
  { id: "account", label: "Account" },
]

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
    console.error("[settings] couldn't load calendar connections", { name: error instanceof Error ? error.name : typeof error })
  }

  // Where an LMS sign-in sent the student back to (?canvas=connected, ?blackboard=denied):
  // a short outcome code, never data.
  const params = await searchParams
  const outcomes: IntegrationOutcomes = {}
  for (const provider of lmsProviderIds) {
    const outcome = params[provider]
    if (typeof outcome === "string") outcomes[provider] = outcome
  }
  const calendarOutcomes: CalendarOutcomes = {}
  for (const provider of calendarProviderIds) {
    const outcome = params[getCalendarProvider(provider).flow]
    if (typeof outcome === "string") calendarOutcomes[provider] = outcome
  }

  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <nav aria-label="Settings sections" className="-mt-2 mb-6 flex flex-wrap gap-2">
        {sections.map((item) => (
          <a
            key={item.id}
            href={`#${item.id}`}
            className="rounded-full bg-muted px-3 py-1.5 text-sm font-medium text-muted-foreground outline-none hover:bg-muted/70 hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {item.label}
          </a>
        ))}
      </nav>
      <div className="space-y-6">
        <SettingsView />
        <AppearanceCard />
        <IntegrationsCard
          integrations={integrations}
          outcomes={outcomes}
          timeZone={await getStudentTimeZone()}
          calendars={calendars}
          calendarOutcomes={calendarOutcomes}
        />
        <AccountCard
          account={await getAccountDetails()}
          available={await enabledSocialProviders()}
          outcome={typeof params.login === "string" ? { code: params.login, provider: typeof params.provider === "string" ? params.provider : undefined } : undefined}
        />
      </div>
    </>
  )
}
