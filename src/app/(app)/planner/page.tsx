import type { Metadata } from "next"
import { PlannerView } from "@/components/planner/planner-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/planner")

export const metadata: Metadata = { title: section.title }

export default function PlannerPage() {
  return <PlannerView />
}
