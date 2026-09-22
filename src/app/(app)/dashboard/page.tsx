import type { Metadata } from "next"
import { PageHeader } from "@/components/app-shell/page-header"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { getNavItem } from "@/lib/navigation"

const section = getNavItem("/dashboard")

export const metadata: Metadata = { title: section.title }

// Empty panels that show where each part of the dashboard will go.
const panels = [
  {
    title: "Today's plan",
    description: "What to work on today, in order.",
    empty: "Your plan will appear here once the planner is built.",
    className: "md:col-span-2",
  },
  {
    title: "Due soon",
    description: "Deadlines in the next 7 days.",
    empty: "No deadlines yet.",
  },
  {
    title: "Classes today",
    description: "Where you need to be and when.",
    empty: "No classes yet.",
  },
  {
    title: "This week",
    description: "How your workload is spread out.",
    empty: "Nothing scheduled yet.",
    className: "md:col-span-2",
  },
]

export default function DashboardPage() {
  return (
    <>
      <PageHeader
        title="What should I do today?"
        description="Your deadlines, classes and commitments will come together here."
      />
      <div className="grid gap-4 md:grid-cols-2">
        {panels.map((panel) => (
          <Card key={panel.title} className={panel.className}>
            <CardHeader>
              <CardTitle>{panel.title}</CardTitle>
              <CardDescription>{panel.description}</CardDescription>
            </CardHeader>
            <CardContent>
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                {panel.empty}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>
    </>
  )
}
