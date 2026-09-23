import { connection } from "next/server"
import { redirect } from "next/navigation"
import { AppProviders } from "@/components/app-shell/app-providers"
import { DatabaseError } from "@/components/app-shell/database-error"
import { loadSignedInApp } from "@/server/app-loader"

// First-time setup, outside the app shell (no sidebar). Signed-in students who
// already finished it go straight to the Dashboard.
export default async function OnboardingLayout({ children }: LayoutProps<"/onboarding">) {
  await connection()
  const app = await loadSignedInApp()
  if (!app) return <DatabaseError />
  if (app.data.student.onboardingCompleted) redirect("/dashboard")

  return (
    <AppProviders data={app.data} today={app.today} serverNow={app.now.getTime()}>
      <main className="min-h-svh bg-muted/40 px-4 py-8 sm:py-12">{children}</main>
    </AppProviders>
  )
}
