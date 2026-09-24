import { connection } from "next/server"
import { GraduationCapIcon } from "lucide-react"
import { supabaseEnv } from "@/lib/supabase/env"

// Sign-in pages: no sidebar, just a centered card.
export default async function AuthLayout({ children }: { children: React.ReactNode }) {
  // Rendered per request, so the setup notice reflects the current settings.
  await connection()
  return (
    <main className="flex min-h-svh flex-col items-center justify-center bg-muted/40 px-4 py-10">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex size-9 items-center justify-center rounded-lg bg-primary text-primary-foreground">
          <GraduationCapIcon className="size-5" />
        </span>
        <span className="text-lg font-semibold tracking-tight">Student OS</span>
      </div>
      <p className="mb-6 max-w-sm text-center text-sm text-muted-foreground">
        You don&apos;t organize college. Student OS does: it plans your study time around your classes and deadlines.
      </p>
      <div className="w-full max-w-sm rounded-xl bg-card p-6 shadow-sm ring-1 ring-border sm:p-8">
        {!supabaseEnv() && (
          <p role="alert" className="mb-4 rounded-lg bg-warning-soft px-3 py-2 text-sm text-warning">
            Sign-in isn&apos;t set up yet: add the Supabase settings to .env.local (see .env.example).
          </p>
        )}
        {children}
      </div>
    </main>
  )
}
