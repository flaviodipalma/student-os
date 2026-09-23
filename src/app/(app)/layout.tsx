import { connection } from "next/server"
import { redirect } from "next/navigation"
import { AppProviders } from "@/components/app-shell/app-providers"
import { Brand } from "@/components/app-shell/brand"
import { DatabaseError } from "@/components/app-shell/database-error"
import { MobileNav } from "@/components/app-shell/mobile-nav"
import { Sidebar } from "@/components/app-shell/sidebar"
import { loadSignedInApp } from "@/server/app-loader"

// Shell for every signed-in page: sidebar on desktop, top bar + slide-out menu on mobile.
// It checks who is signed in, then loads that student's data from the database once;
// every page reads it from the app store. New students go through onboarding first.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always render per request: these pages depend on who is signed in.
  await connection()
  const app = await loadSignedInApp()
  if (!app) return <DatabaseError />
  if (!app.data.student.onboardingCompleted) redirect("/onboarding")

  const account = { firstName: app.data.student.firstName, email: app.user.email ?? "" }

  return (
    <AppProviders data={app.data} today={app.today} serverNow={app.now.getTime()}>
      <div className="flex min-h-svh">
        <Sidebar account={account} />
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur lg:hidden">
            <MobileNav account={account} />
            <Brand />
          </header>
          <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
            <div className="mx-auto w-full max-w-5xl">{children}</div>
          </main>
        </div>
      </div>
    </AppProviders>
  )
}
