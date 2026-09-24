import type { Metadata } from "next"
import { LogOutIcon } from "lucide-react"
import { logOutAction } from "@/app/actions/auth"
import { PageHeader } from "@/components/app-shell/page-header"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { IntegrationsCard, type IntegrationOutcomes } from "@/components/settings/integrations-card"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { lmsProviderIds } from "@/lib/types"
import { requireUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { getLmsIntegrationStatus, type LmsIntegrationStatus } from "@/server/integrations/lms/connections"
import { getStudentTimeZone } from "@/server/student-clock"

const section = getNavItem("/settings")

// In the order they appear on the page.
const sections = [
  { id: "profile", label: "Profile" },
  { id: "study-preferences", label: "Study preferences" },
  { id: "recurring-commitments", label: "Recurring commitments" },
  { id: "notifications", label: "Notifications" },
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
        <IntegrationsCard
          integrations={integrations}
          outcomes={outcomes}
          timeZone={await getStudentTimeZone()}
        />
        <Card id="account">
          <CardHeader>
            <CardTitle className="text-lg font-semibold">Account</CardTitle>
            <CardDescription>You&apos;re signed in as {user.email ?? "your account"}.</CardDescription>
          </CardHeader>
          <CardContent>
            <form action={logOutAction}>
              <Button type="submit" variant="outline">
                <LogOutIcon data-icon="inline-start" />
                Log out
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </>
  )
}
