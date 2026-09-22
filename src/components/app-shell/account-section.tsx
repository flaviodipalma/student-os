import { LogOutIcon } from "lucide-react"
import { logOutAction } from "@/app/actions/auth"

export type Account = { firstName: string; email: string }

// Who is signed in, and the log-out button. Shown at the bottom of the navigation.
export function AccountSection({ account }: { account: Account }) {
  const initial = (account.firstName || account.email || "?").charAt(0).toUpperCase()
  return (
    <div className="flex items-center gap-3 border-t px-4 py-3">
      <span
        aria-hidden
        className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary"
      >
        {initial}
      </span>
      <div className="min-w-0 flex-1">
        {account.firstName && <p className="truncate text-sm font-medium">{account.firstName}</p>}
        <p className="truncate text-xs text-muted-foreground">{account.email}</p>
      </div>
      <form action={logOutAction}>
        <button
          type="submit"
          aria-label="Log out"
          title="Log out"
          className="flex size-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-sidebar-accent hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          <LogOutIcon className="size-4" />
        </button>
      </form>
    </div>
  )
}
