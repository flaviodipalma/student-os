"use client"

import { useState } from "react"
import { CircleAlertIcon, Loader2Icon, Trash2Icon } from "lucide-react"
import { deleteAccountAction } from "@/app/actions/auth"
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

// Settings > Profile > Delete account: removes the account and everything in it
// for good. The student types DELETE to confirm; the server checks it again.
export function DeleteAccountCard() {
  const [open, setOpen] = useState(false)
  const [typed, setTyped] = useState("")
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const confirmed = typed.trim().toUpperCase() === "DELETE"

  function changeOpen(next: boolean) {
    if (working) return
    setOpen(next)
    if (!next) {
      setTyped("")
      setError(null)
    }
  }

  async function remove(event: React.FormEvent) {
    event.preventDefault()
    if (!confirmed) return
    setWorking(true)
    setError(null)
    const result = await deleteAccountAction(typed).catch(() => null)
    if (!result?.ok) {
      setWorking(false)
      setError(result?.error ?? "We couldn't delete your account. Please try again.")
      return
    }
    await forgetThisBrowser()
    // A full page load, so nothing from the deleted account stays in memory.
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a soft navigation would keep it
    window.location.assign("/login?deleted=1")
  }

  return (
    <Card id="delete-account">
      <CardHeader>
        <CardTitle className="text-lg font-semibold">Delete account</CardTitle>
        <CardDescription>Permanently delete your Quadernio account and everything in it.</CardDescription>
      </CardHeader>
      <CardContent>
        <Button variant="destructive" onClick={() => setOpen(true)}>
          <Trash2Icon data-icon="inline-start" />
          Delete account…
        </Button>
      </CardContent>

      <AlertDialog open={open} onOpenChange={changeOpen}>
        <AlertDialogContent>
          <form onSubmit={remove} className="contents">
            <AlertDialogHeader>
              <AlertDialogTitle>Delete your account?</AlertDialogTitle>
              <AlertDialogDescription>
                This deletes your courses, tasks, plan, events, reminders and settings right away. It can&apos;t be undone.
                Connected Google Calendar or Outlook access is removed; nothing changes in those calendars, or in Canvas,
                Blackboard or Brightspace D2L.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Label htmlFor="delete-confirm">Type DELETE to confirm</Label>
              <Input
                id="delete-confirm"
                value={typed}
                onChange={(event) => setTyped(event.target.value)}
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                disabled={working}
              />
              {error && (
                <p role="alert" className="flex items-start gap-2 text-sm text-destructive">
                  <CircleAlertIcon className="mt-0.5 size-4" aria-hidden />
                  {error}
                </p>
              )}
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={working}>Cancel</AlertDialogCancel>
              <Button type="submit" variant="destructive" disabled={!confirmed || working}>
                {working ? (
                  <>
                    <Loader2Icon data-icon="inline-start" className="animate-spin" />
                    Deleting…
                  </>
                ) : (
                  "Delete my account"
                )}
              </Button>
            </AlertDialogFooter>
          </form>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}

// Clears what this browser kept for the deleted account: its saved app keys and
// its push subscription (the server's copy is already gone with the account).
async function forgetThisBrowser() {
  for (const storage of ["localStorage", "sessionStorage"] as const) {
    try {
      const store = window[storage]
      for (const key of Object.keys(store)) if (key.startsWith("quadernio")) store.removeItem(key)
    } catch {}
  }
  try {
    const registration = await navigator.serviceWorker?.getRegistration()
    const subscription = await registration?.pushManager.getSubscription()
    await subscription?.unsubscribe()
  } catch {}
}
