import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { AccountCard } from "@/components/settings/account-card"
import { LearningCard } from "@/components/settings/learning-card"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { enabledSocialProviders, getAccountDetails } from "@/server/social-auth"

const section = getNavItem("/settings")

// In the order they appear on the page. The theme lives in the header's theme menu,
// and connected services have their own page (/integrations).
const sections = [
  { id: "profile", label: "Profile" },
  { id: "study-preferences", label: "Study preferences" },
  { id: "recurring-commitments", label: "Recurring commitments" },
  { id: "notifications", label: "Notifications" },
  { id: "personalization", label: "Personalization" },
  { id: "account", label: "Account" },
]

export const metadata: Metadata = { title: section.title }

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams

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
        <LearningCard />
        <AccountCard
          account={await getAccountDetails()}
          available={await enabledSocialProviders()}
          outcome={typeof params.login === "string" ? { code: params.login, provider: typeof params.provider === "string" ? params.provider : undefined } : undefined}
        />
      </div>
    </>
  )
}
