"use client"

import { useState } from "react"
import { MenuIcon } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet"
import { AccountSection, type Account } from "./account-section"
import { Brand } from "./brand"
import { NavLinks } from "./nav-links"

export function MobileNav({ account }: { account: Account }) {
  const [open, setOpen] = useState(false)

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger
        render={<Button variant="ghost" size="icon" />}
        aria-label="Open navigation"
      >
        <MenuIcon className="size-5" />
      </SheetTrigger>
      <SheetContent side="left" className="w-72 bg-sidebar p-0">
        <SheetHeader className="border-b px-4 py-3">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <Brand />
        </SheetHeader>
        <div className="flex-1 px-3">
          <NavLinks onNavigate={() => setOpen(false)} />
        </div>
        <AccountSection account={account} />
      </SheetContent>
    </Sheet>
  )
}
