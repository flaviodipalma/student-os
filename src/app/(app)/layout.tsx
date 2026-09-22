import { connection } from "next/server"
import { Brand } from "@/components/app-shell/brand"
import { DatabaseError } from "@/components/app-shell/database-error"
import { MobileNav } from "@/components/app-shell/mobile-nav"
import { Sidebar } from "@/components/app-shell/sidebar"
import { AppStoreProvider } from "@/lib/app-store"
import { ClockProvider } from "@/lib/clock"
import { FeedbackProvider } from "@/lib/feedback"
import { toDateKey } from "@/lib/format"
import { requireUser } from "@/server/auth"
import { getDb } from "@/server/db"
import { loadAppData, type AppData } from "@/server/services/app-data"
import { ensureProfile } from "@/server/services/profiles"

// Shell for every signed-in page: sidebar on desktop, top bar + slide-out menu on mobile.
// It checks who is signed in, then loads that student's data from the database once;
// every page reads it from the app store.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Always render per request: these pages depend on who is signed in.
  await connection()
  const user = await requireUser()
  const now = new Date()
  const today = toDateKey(now)

  let data: AppData
  try {
    const db = getDb()
    await ensureProfile(db, user.id)
    data = await loadAppData(db, user.id)
  } catch (error) {
    console.error("[app] couldn't load user data", { name: error instanceof Error ? error.name : typeof error })
    return <DatabaseError />
  }

  const account = { firstName: data.student.firstName, email: user.email ?? "" }

  return (
    <ClockProvider serverNow={now.getTime()}>
      <FeedbackProvider>
        <AppStoreProvider initial={data} today={today}>
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
        </AppStoreProvider>
      </FeedbackProvider>
    </ClockProvider>
  )
}
