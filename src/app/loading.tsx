import { GraduationCapIcon } from "lucide-react"

// Shown instantly while a page loads, e.g. while the signed-in app fetches the
// student's data for the first time.
export default function Loading() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4" aria-busy="true">
      <div role="status" className="flex flex-col items-center gap-3 text-center">
        <span className="flex size-10 animate-pulse items-center justify-center rounded-xl bg-primary text-primary-foreground">
          <GraduationCapIcon aria-hidden className="size-5" />
        </span>
        <p className="text-sm font-medium text-muted-foreground">Loading Student OS…</p>
      </div>
    </main>
  )
}
