"use client"

import { ErrorPanel } from "@/components/app-shell/error-panel"

// A page inside the app crashed: keep the sidebar, show a friendly message.
export default function AppError(props: { error: Error & { digest?: string }; retry: () => void }) {
  return (
    <div className="py-10">
      <ErrorPanel {...props} />
    </div>
  )
}
