import type { Metadata } from "next"
import { PlannerView } from "@/components/planner/planner-view"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/planner")

export const metadata: Metadata = { title: section.title }

const DATE = /^\d{4}-\d{2}-\d{2}$/

export default async function PlannerPage({ searchParams }: PageProps<"/planner">) {
  const date = (await searchParams).date
  const initialDate = typeof date === "string" && DATE.test(date) ? date : undefined
  return <PlannerView key={initialDate} initialDate={initialDate} />
}
