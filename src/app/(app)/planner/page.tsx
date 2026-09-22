import type { Metadata } from "next"
import { ComingSoon } from "@/components/coming-soon"
import { PageHeader } from "@/components/app-shell/page-header"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/planner")

export const metadata: Metadata = { title: section.title }

export default function PlannerPage() {
  return (
    <>
      <PageHeader title={section.title} description={section.description} />
      <ComingSoon
        icon={section.icon}
        title={section.title}
        planned={[
          "Turn your tasks and free time into a day-by-day plan",
          "Rebalance the week when something changes",
        ]}
      />
    </>
  )
}
