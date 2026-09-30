import type { Metadata } from "next"
import Link from "next/link"
import { PageHeader } from "@/components/app-shell/page-header"
import { PageTabs } from "@/components/app-shell/page-tabs"
import { AccountCard } from "@/components/settings/account-card"
import { DeleteAccountCard } from "@/components/settings/delete-account-card"
import { LearningCard } from "@/components/settings/learning-card"
import { NotificationSettings, PlanningSettings, ProfileSettings } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"
import { enabledSocialProviders, getAccountDetails } from "@/server/social-auth"

const section = getNavItem("/settings")

export const metadata: Metadata = { title: section.title }

// Settings in three tabs, each with its own address:
//   /settings                       Profile: about you, the account and ways to log in
//   /settings?tab=planning          Planning: study preferences, weekly commitments, personalization
//   /settings?tab=notifications     Notifications: reminders, push on this and other devices
// The theme lives in the header's theme menu; connected services have their own page
// (/integrations); the academic calendar is in Calendar.
const tabs = [
  { id: "profile", label: "Profile", href: "/settings" },
  { id: "planning", label: "Planning", href: "/settings?tab=planning" },
  { id: "notifications", label: "Notifications", href: "/settings?tab=notifications" },
]

export default async function SettingsPage({ searchParams }: PageProps<"/settings">) {
  const params = await searchParams
  const tab = params.tab === "planning" || params.tab === "notifications" ? params.tab : "profile"

  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <div className="-mt-2 mb-6">
        <PageTabs label="Settings sections" tabs={tabs} current={tab} />
      </div>
      <div className="space-y-6">
        {tab === "profile" && (
          <>
            <ProfileSettings />
            <AccountCard
              account={await getAccountDetails()}
              available={await enabledSocialProviders()}
              outcome={typeof params.login === "string" ? { code: params.login, provider: typeof params.provider === "string" ? params.provider : undefined } : undefined}
            />
            <DeleteAccountCard />
          </>
        )}
        {tab === "planning" && (
          <>
            <PlanningSettings />
            <LearningCard />
          </>
        )}
        {tab === "notifications" && <NotificationSettings />}
      </div>
      <nav aria-label="Legal" className="mt-10 flex gap-4 text-xs text-muted-foreground">
        <Link href="/privacy" className="hover:text-foreground hover:underline">
          Privacy Policy
        </Link>
        <Link href="/terms" className="hover:text-foreground hover:underline">
          Terms of Service
        </Link>
      </nav>
    </>
  )
}
