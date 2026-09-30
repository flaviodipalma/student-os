import Link from "next/link"
import { LEGAL_CONTACT_EMAIL, LEGAL_UPDATED } from "@/lib/legal"

// Building blocks for the Privacy Policy and Terms: a readable column of plain text.

export function LegalPage({ title, intro, children }: { title: string; intro: React.ReactNode; children: React.ReactNode }) {
  return (
    <article className="space-y-8">
      <header className="space-y-3">
        <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">{title}</h1>
        <p className="text-xs text-muted-foreground">Last updated {LEGAL_UPDATED}</p>
        <div className="text-base leading-7 text-muted-foreground">{intro}</div>
      </header>
      {children}
    </article>
  )
}

export function LegalSection({ id, title, children }: { id: string; title: string; children: React.ReactNode }) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className="scroll-mt-20 space-y-3 text-sm leading-6 text-foreground">
      <h2 id={`${id}-title`} className="text-lg font-semibold tracking-tight">
        {title}
      </h2>
      {children}
    </section>
  )
}

export function LegalList({ children }: { children: React.ReactNode }) {
  return <ul className="list-disc space-y-1.5 pl-5 marker:text-subtle-foreground">{children}</ul>
}

export function ContactEmail() {
  return (
    <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="font-medium text-primary hover:underline">
      {LEGAL_CONTACT_EMAIL}
    </a>
  )
}

export function LegalLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link href={href} className="font-medium text-primary hover:underline">
      {children}
    </Link>
  )
}
