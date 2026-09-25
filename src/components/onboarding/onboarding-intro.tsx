"use client"

import { useEffect, useRef, useState } from "react"
import { cn } from "@/lib/utils"

// The first thing a new student sees: "Welcome to Student OS!" fades in, then gives
// way to "Let's get started", which fades into setup. Each stays for 3 seconds (about
// 7 in all, with the fades); a click or any key skips it. With reduced motion the
// words just change, without fading.

const TIMELINE = [
  // [time (ms), stage]. Fades take 0.7 s (duration-700).
  [80, "welcome"],
  [3080, "between"],
  [3580, "started"],
  [6580, "leaving"],
  [7080, "done"],
] as const

type Stage = "start" | (typeof TIMELINE)[number][1]

export function OnboardingIntro({ onDone }: { onDone: () => void }) {
  const [stage, setStage] = useState<Stage>("start")
  const finished = useRef(false)
  const done = useRef(onDone)
  useEffect(() => {
    done.current = onDone
  })

  useEffect(() => {
    const finish = () => {
      if (finished.current) return
      finished.current = true
      done.current()
    }
    const timers = TIMELINE.map(([at, next]) => setTimeout(() => (next === "done" ? finish() : setStage(next)), at))
    const skip = () => finish()
    window.addEventListener("keydown", skip)
    return () => {
      timers.forEach(clearTimeout)
      window.removeEventListener("keydown", skip)
    }
  }, [])

  const showWelcome = stage === "welcome"
  const showStarted = stage === "started"

  return (
    <div
      role="presentation"
      onClick={() => {
        if (!finished.current) {
          finished.current = true
          onDone()
        }
      }}
      className="fixed inset-0 z-50 grid cursor-pointer place-items-center bg-background px-6"
    >
      <div className="relative grid place-items-center text-center" aria-live="polite">
        <h1
          className={cn(
            "col-start-1 row-start-1 text-4xl font-semibold tracking-tight transition-opacity duration-700 ease-out motion-reduce:transition-none sm:text-6xl",
            showWelcome ? "opacity-100" : "opacity-0"
          )}
          aria-hidden={!showWelcome}
        >
          Welcome to Student OS!
        </h1>
        <p
          className={cn(
            "col-start-1 row-start-1 text-3xl font-medium tracking-tight text-muted-foreground transition-opacity duration-700 ease-out motion-reduce:transition-none sm:text-5xl",
            showStarted ? "opacity-100" : "opacity-0"
          )}
          aria-hidden={!showStarted}
        >
          Let&apos;s get started
        </p>
      </div>
      <p className="absolute bottom-8 text-xs text-muted-foreground/70">Click or press any key to skip</p>
    </div>
  )
}
