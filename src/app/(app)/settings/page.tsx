import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import { SettingsView } from "@/components/settings/settings-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/settings")

export const metadata: Metadata = { title: section.title }

export default function SettingsPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <SettingsView />
    </>
  )
}
