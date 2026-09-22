import { connection } from "next/server"
import { Brand } from "@/components/app-shell/brand"
import { MobileNav } from "@/components/app-shell/mobile-nav"
import { Sidebar } from "@/components/app-shell/sidebar"
import { ClockProvider } from "@/lib/clock"
import { buildMockEvents } from "@/lib/data/events"
import { buildMockTasks } from "@/lib/data/tasks"
import { EventStoreProvider } from "@/lib/event-store"
import { toDateKey } from "@/lib/format"
import { PlannerStoreProvider } from "@/lib/planner-store"
import { TaskStoreProvider } from "@/lib/task-store"

// Shared shell for every main section: sidebar on desktop, top bar + slide-out menu on mobile.
// It also holds the app's shared data (tasks, events, planner, clock), so every page
// sees the same state.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Work out "today" per request, not once at build time.
  await connection()
  const now = new Date()
  const today = toDateKey(now)

  return (
    <ClockProvider serverNow={now.getTime()}>
      <TaskStoreProvider initialTasks={buildMockTasks(today)} today={today}>
        <EventStoreProvider initialEvents={buildMockEvents(today)}>
          <PlannerStoreProvider>
            <div className="flex min-h-svh">
              <Sidebar />
              <div className="flex min-w-0 flex-1 flex-col">
                <header className="sticky top-0 z-40 flex h-14 items-center gap-2 border-b bg-background/80 px-3 backdrop-blur lg:hidden">
                  <MobileNav />
                  <Brand />
                </header>
                <main className="flex-1 px-4 py-6 sm:px-6 lg:px-10 lg:py-10">
                  <div className="mx-auto w-full max-w-5xl">{children}</div>
                </main>
              </div>
            </div>
          </PlannerStoreProvider>
        </EventStoreProvider>
      </TaskStoreProvider>
    </ClockProvider>
  )
}
