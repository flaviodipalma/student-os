import { connection } from "next/server"
import { Brand } from "@/components/app-shell/brand"
import { MobileNav } from "@/components/app-shell/mobile-nav"
import { Sidebar } from "@/components/app-shell/sidebar"
import { buildMockTasks } from "@/lib/data/tasks"
import { toDateKey } from "@/lib/format"
import { TaskStoreProvider } from "@/lib/task-store"

// Shared shell for every main section: sidebar on desktop, top bar + slide-out menu on mobile.
// It also holds the app's task data, so every page sees the same tasks.
export default async function AppLayout({ children }: LayoutProps<"/">) {
  // Work out "today" per request, not once at build time.
  await connection()
  const today = toDateKey(new Date())

  return (
    <TaskStoreProvider initialTasks={buildMockTasks(today)} today={today}>
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
    </TaskStoreProvider>
  )
}
