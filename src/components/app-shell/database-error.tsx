import { DatabaseIcon } from "lucide-react"
import { logOutAction } from "@/app/actions/auth"

// Shown instead of the app when the database can't be reached. Logging out is
// always possible from here, so nobody is stuck on this page.
export function DatabaseError() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-muted/40 px-4">
      <div className="max-w-sm rounded-xl bg-card p-8 text-center ring-1 ring-border">
        <DatabaseIcon aria-hidden className="mx-auto size-8 text-muted-foreground" />
        <h1 className="mt-4 text-lg font-semibold">We can&apos;t load your data right now</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Quadernio couldn&apos;t reach its database. Please try again in a moment.
        </p>
        <div className="mt-5 flex items-center justify-center gap-4 text-sm font-medium">
          <a href="" className="text-primary hover:underline">
            Try again
          </a>
          <form action={logOutAction}>
            <button type="submit" className="text-muted-foreground hover:text-foreground hover:underline">
              Log out
            </button>
          </form>
        </div>
      </div>
    </main>
  )
}
