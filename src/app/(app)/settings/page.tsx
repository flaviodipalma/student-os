import type { Metadata } from "next"
import { ComingSoon } from "@/components/coming-soon"
import { PageHeader } from "@/components/app-shell/page-header"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/settings")

export const metadata: Metadata = { title: section.title }

export default function SettingsPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <ComingSoon
        icon={section.icon}
        title={section.title}
        planned={[
          "Your profile and account",
          "Study hours and planner preferences",
        ]}
      />
    </>
  )
}
