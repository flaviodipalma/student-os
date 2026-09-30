import Link from "next/link"
import { GraduationCapIcon } from "lucide-react"

// Privacy Policy and Terms: open to everyone, signed in or not (src/proxy.ts).
export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-14 max-w-2xl items-center px-4">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-4" aria-hidden />
            </span>
            <span className="font-semibold tracking-tight">Quadernio</span>
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 md:py-14">{children}</main>
      <footer className="border-t border-border-subtle">
        <nav aria-label="Legal" className="mx-auto flex max-w-2xl gap-4 px-4 py-6 text-xs text-muted-foreground">
          <Link href="/privacy" className="hover:text-foreground hover:underline">
            Privacy Policy
          </Link>
          <Link href="/terms" className="hover:text-foreground hover:underline">
            Terms of Service
          </Link>
        </nav>
      </footer>
    </div>
  )
}
