import { PlugZapIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import type { LmsIntegrationStatus } from "@/server/integrations/lms/connections"

// Settings > Integrations: learning management systems. Rendered on the server
// from each provider's status (no tokens ever reach this component). Until an
// adapter is built, its row says "coming soon" and the button is disabled.
export function IntegrationsCard({ integrations }: { integrations: LmsIntegrationStatus[] | null }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Integrations</CardTitle>
        <CardDescription>
          Learning management systems. Once connected, your courses and assignments will come into Student OS as
          normal courses and tasks, and your Planner will use them.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {integrations === null ? (
          <p className="text-sm text-muted-foreground">We couldn&apos;t load your integrations right now. Please try again later.</p>
        ) : (
          <ul className="divide-y rounded-lg ring-1 ring-foreground/10">
            {integrations.map((integration) => {
              const comingSoon = !integration.available
              const statusId = `lms-${integration.provider}-status`
              return (
                <li key={integration.provider} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <span
                    aria-hidden
                    className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-muted text-sm font-semibold text-muted-foreground"
                  >
                    {integration.name[0]}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 font-medium">
                      {integration.name}
                      {comingSoon && (
                        <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                          Coming soon
                        </span>
                      )}
                    </p>
                    <p id={statusId} className="text-sm text-muted-foreground">
                      {comingSoon
                        ? `${integration.name} integration coming soon.`
                        : integration.connection
                          ? "Connected."
                          : "Not connected."}
                    </p>
                  </div>
                  {/* Not a working button until the integration exists: disabled and labelled as such. */}
                  <Button variant="outline" disabled={comingSoon} aria-describedby={statusId} className="disabled:cursor-not-allowed">
                    <PlugZapIcon data-icon="inline-start" />
                    {comingSoon ? "Connect (coming soon)" : "Connect"}
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          Student OS will connect through your school&apos;s official sign-in (OAuth). It will never ask for your LMS
          password.
        </p>
      </CardContent>
    </Card>
  )
}
