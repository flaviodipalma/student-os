import type { LucideIcon } from "lucide-react"
import { Card, CardContent } from "@/components/ui/card"

// Placeholder panel for sections that aren't built yet.
export function ComingSoon({
  icon: Icon,
  title,
  planned,
}: {
  icon: LucideIcon
  title: string
  planned: string[]
}) {
  return (
    <Card className="border border-dashed bg-muted/30 ring-0">
      <CardContent className="flex flex-col items-center py-10 text-center">
        <span className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
          <Icon className="size-6" />
        </span>
        <h2 className="mt-4 text-lg font-semibold">{title} is coming soon</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Here&apos;s what this section will do:
        </p>
        <ul className="mt-4 space-y-1.5 text-sm">
          {planned.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </CardContent>
    </Card>
  )
}
