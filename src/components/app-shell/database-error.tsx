import { DatabaseIcon } from "lucide-react"

// Shown instead of the app when the database can't be reached.
export function DatabaseError() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <div className="max-w-sm rounded-xl bg-card p-8 text-center ring-1 ring-border">
        <DatabaseIcon aria-hidden className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">We can&apos;t load your data right now</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Student OS couldn&apos;t reach its database. Please try again in a moment.
        </p>
        <a href="" className="mt-5 inline-block text-sm font-medium text-primary hover:underline">
          Try again
        </a>
      </div>
    </main>
  )
}
