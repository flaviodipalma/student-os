"use client"

import dynamic from "next/dynamic"
import type { AssistantPageContext } from "@/lib/assistant"

// The conversation is kept in the browser tab (sessionStorage), so the page is
// rendered in the browser only: no flash of an empty conversation.
const AssistantView = dynamic(() => import("./assistant-view").then((m) => m.AssistantView), {
  ssr: false,
  loading: () => (
    <div className="space-y-4" aria-busy>
      <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Assistant</h1>
      <div className="h-80 animate-pulse rounded-xl bg-muted" />
    </div>
  ),
})

export function AssistantLoader({ context }: { context: AssistantPageContext }) {
  return <AssistantView initialContext={context} />
}
