import { NotificationBell } from "@/components/notifications/notification-center"
import { ThemeMenu } from "@/components/theme/theme-menu"
import { AccountSection, type Account } from "./account-section"
import { Brand } from "./brand"
import { NavLinks } from "./nav-links"

// Desktop-only sidebar. On small screens the same links live in <MobileNav />.
export function Sidebar({ account }: { account: Account }) {
  return (
    <aside className="sticky top-0 hidden h-svh w-64 shrink-0 flex-col border-r bg-sidebar lg:flex">
      <div className="flex h-16 items-center justify-between gap-2 pr-3 pl-5">
        <Brand />
        <div className="flex items-center">
          <ThemeMenu />
          <NotificationBell />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto px-3 py-2">
        <NavLinks />
      </div>
      <AccountSection account={account} />
    </aside>
  )
}
