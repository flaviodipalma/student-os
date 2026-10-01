import type { Metadata } from "next"
import Link from "next/link"
import {
  BellRingIcon,
  CalendarCheck2Icon,
  CalendarDaysIcon,
  ClockIcon,
  FileTextIcon,
  GraduationCapIcon,
  RefreshCwIcon,
  ShieldCheckIcon,
  SparklesIcon,
} from "lucide-react"
import { buttonVariants } from "@/components/ui/button"
import { LEGAL_CONTACT_EMAIL } from "@/lib/legal"

export const metadata: Metadata = {
  title: { absolute: "Quadernio · Your semester, planned" },
  description:
    "A free planner for college students: your Canvas and Blackboard deadlines, classes and calendar in one place, with a plan for what to study next.",
}

// The public homepage. Signed-in students never see it: src/proxy.ts sends them to
// the Dashboard. Keep what it says in line with the Privacy Policy (Google's review
// of calendar access reads both).
export default function HomePage() {
  return (
    <div className="flex min-h-svh flex-col bg-background">
      <header className="border-b border-border-subtle">
        <div className="mx-auto flex h-16 max-w-5xl items-center gap-3 px-4">
          <Link href="/" className="flex items-center gap-2.5 rounded-lg">
            <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <GraduationCapIcon className="size-4.5" aria-hidden />
            </span>
            <span className="text-base font-semibold tracking-tight">Quadernio</span>
          </Link>
          <nav className="ml-auto flex items-center gap-2" aria-label="Account">
            <Link href="/login" className={buttonVariants({ variant: "ghost" })}>
              Log in
            </Link>
            <Link href="/signup" className={buttonVariants()}>
              Sign up
            </Link>
          </nav>
        </div>
      </header>

      <main className="flex-1">
        <section className="mx-auto grid max-w-5xl items-center gap-12 px-4 py-16 md:grid-cols-[1.1fr_1fr] md:py-24">
          <div>
            <h1 className="text-4xl font-semibold tracking-tight text-balance md:text-5xl">Your semester, planned for you.</h1>
            <p className="mt-5 max-w-lg text-lg leading-8 text-muted-foreground">
              Quadernio brings your Canvas and Blackboard deadlines, your classes and your calendar into one place, and
              tells you what to study next.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/signup" className={buttonVariants({ size: "lg" })}>
                Create your free account
              </Link>
              <Link href="/login" className={buttonVariants({ size: "lg", variant: "outline" })}>
                Log in
              </Link>
            </div>
            <p className="mt-4 text-sm text-muted-foreground">Free for students. No ads.</p>
          </div>
          <TodayPreview />
        </section>

        <section aria-labelledby="features" className="border-t border-border-subtle bg-muted/40">
          <div className="mx-auto max-w-5xl px-4 py-16 md:py-20">
            <h2 id="features" className="text-2xl font-semibold tracking-tight md:text-3xl">
              Everything for your classes, in one plan
            </h2>
            <div className="mt-10 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              <Feature icon={RefreshCwIcon} title="Canvas and Blackboard, synced">
                The Quadernio browser extension imports your courses, assignments and due dates with your own school
                login. Submitted work is marked done.
              </Feature>
              <Feature icon={FileTextIcon} title="Syllabus import">
                Upload a syllabus PDF and Quadernio finds the exams, papers and readings, so nothing is only in a
                document you forgot about.
              </Feature>
              <Feature icon={CalendarCheck2Icon} title="A plan for every day">
                The Planner fits study time around your classes, work and commitments, and learns how long your tasks
                really take.
              </Feature>
              <Feature icon={CalendarDaysIcon} title="Your calendars, included">
                Connect Google Calendar or Outlook so study time never lands on top of your events. Your school&apos;s
                academic calendar is added too.
              </Feature>
              <Feature icon={BellRingIcon} title="Reminders that reach you">
                Get a heads-up on your phone or computer before deadlines and study sessions, even when Quadernio is
                closed.
              </Feature>
              <Feature icon={SparklesIcon} title="An assistant that knows your week">
                Ask what to do next or when you&apos;re free. It suggests changes; nothing happens until you confirm.
              </Feature>
            </div>
          </div>
        </section>

        <section aria-labelledby="privacy" className="mx-auto max-w-5xl px-4 py-16 md:py-20">
          <div className="grid gap-8 md:grid-cols-[auto_1fr]">
            <span className="flex size-12 items-center justify-center rounded-xl bg-primary-soft text-primary-soft-foreground">
              <ShieldCheckIcon className="size-6" aria-hidden />
            </span>
            <div className="max-w-3xl">
              <h2 id="privacy" className="text-2xl font-semibold tracking-tight md:text-3xl">
                Your data stays yours
              </h2>
              <ul className="mt-6 space-y-4 text-base leading-7 text-muted-foreground">
                <li>
                  <strong className="font-semibold text-foreground">Google Calendar and Outlook are read-only.</strong>{" "}
                  If you connect them, Quadernio reads your events only to plan your study time around them and show
                  them next to your deadlines. It never creates, changes or deletes anything in your calendar, and
                  disconnecting deletes the copied events.
                </li>
                <li>
                  <strong className="font-semibold text-foreground">Your school login stays in your browser.</strong>{" "}
                  The extension reads Canvas or Blackboard in your own tab and sends only your courses and deadlines to
                  your account.
                </li>
                <li>
                  <strong className="font-semibold text-foreground">No ads, no selling, no tracking.</strong> Your data
                  is used only to run Quadernio for you, and you can delete your account and everything in it at any
                  time.
                </li>
              </ul>
              <p className="mt-6 text-sm">
                <Link href="/privacy" className="font-medium text-primary hover:underline">
                  Read the Privacy Policy
                </Link>
              </p>
            </div>
          </div>
        </section>

        <section className="border-t border-border-subtle bg-muted/40">
          <div className="mx-auto flex max-w-5xl flex-col items-start gap-5 px-4 py-14 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-2xl font-semibold tracking-tight">Start this semester organized.</h2>
              <p className="mt-2 text-muted-foreground">It takes a few minutes to set up.</p>
            </div>
            <Link href="/signup" className={buttonVariants({ size: "lg" })}>
              Create your free account
            </Link>
          </div>
        </section>
      </main>

      <footer className="border-t border-border-subtle">
        <div className="mx-auto flex max-w-5xl flex-col gap-3 px-4 py-8 text-xs text-muted-foreground sm:flex-row sm:items-center">
          <p>© 2026 Quadernio</p>
          <nav aria-label="Legal" className="flex flex-wrap gap-x-4 gap-y-2 sm:ml-auto">
            <Link href="/privacy" className="hover:text-foreground hover:underline">
              Privacy Policy
            </Link>
            <Link href="/terms" className="hover:text-foreground hover:underline">
              Terms of Service
            </Link>
            <a href={`mailto:${LEGAL_CONTACT_EMAIL}`} className="hover:text-foreground hover:underline">
              {LEGAL_CONTACT_EMAIL}
            </a>
          </nav>
        </div>
        <p className="mx-auto max-w-5xl px-4 pb-8 text-xs text-subtle-foreground">
          Quadernio isn&apos;t affiliated with or endorsed by Instructure (Canvas), Anthology (Blackboard), Google or
          Microsoft.
        </p>
      </footer>
    </div>
  )
}

function Feature({ icon: Icon, title, children }: { icon: typeof ClockIcon; title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-xl bg-card p-6 shadow-xs ring-1 ring-border">
      <span className="flex size-10 items-center justify-center rounded-lg bg-primary-soft text-primary-soft-foreground">
        <Icon className="size-5" aria-hidden />
      </span>
      <h3 className="mt-4 text-base font-semibold">{title}</h3>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">{children}</p>
    </div>
  )
}

// A static picture of the Dashboard's "What should I do now?" card (made-up example).
function TodayPreview() {
  return (
    <div aria-hidden className="relative">
      <div className="rounded-2xl bg-card p-6 shadow-md ring-1 ring-border">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">What should I do now?</p>
        <p className="mt-3 text-xl font-semibold tracking-tight">Finish the CSC215 lab report</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm text-muted-foreground">
          <ClockIcon className="size-4" /> 45 min · due tomorrow at 11:59 PM
        </p>
        <div className="mt-5 flex gap-2">
          <span className={buttonVariants({ size: "sm" })}>Start now</span>
          <span className={buttonVariants({ size: "sm", variant: "outline" })}>Later</span>
        </div>
      </div>
      <div className="mt-4 space-y-2 rounded-2xl bg-card p-5 shadow-xs ring-1 ring-border">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">Today</p>
        {[
          ["10:00", "MAT141 · Calculus I", "Class"],
          ["13:30", "Study: PSY101 reading", "Study"],
          ["17:00", "Work shift", "Work"],
        ].map(([time, title, kind]) => (
          <div key={time} className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm">
            <span className="w-12 shrink-0 text-muted-foreground tabular-nums">{time}</span>
            <span className="min-w-0 flex-1 truncate font-medium">{title}</span>
            <span className="rounded-md bg-muted px-2 py-0.5 text-xs text-muted-foreground">{kind}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
