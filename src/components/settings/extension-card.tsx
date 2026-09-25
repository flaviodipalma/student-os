import { PuzzleIcon } from "lucide-react"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"

// Integrations > Browser extension: what the Student OS extension does and how to
// use it. It syncs to the Student OS account logged in in that browser, so there's
// nothing to set up here.
export function ExtensionCard() {
  return (
    <Card id="browser-extension">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Browser extension</CardTitle>
        <CardDescription>
          Sync Canvas with your own Canvas login: no school approval needed. The extension brings in the courses you
          choose, their assignments, and what you&apos;ve already turned in.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <ol className="list-inside list-decimal space-y-1.5 text-sm">
          <li>Install the Student OS extension in Chrome.</li>
          <li>Stay logged in to Student OS in the same browser: the extension syncs to this account.</li>
          <li>
            Open your Canvas, click <PuzzleIcon aria-label="the extension" className="inline size-4 align-text-bottom" />{" "}
            Student OS, then <span className="font-medium">Sync now</span>, and choose your courses.
          </li>
        </ol>
      </CardContent>
    </Card>
  )
}
