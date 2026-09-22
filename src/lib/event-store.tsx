"use client"

import { createContext, use, useState } from "react"
import type { CalendarEvent, EventInput } from "@/lib/types"

// The single source of calendar events for the whole app. The Calendar and the
// Dashboard both read and update events through useEvents().
//
// Like tasks, events live in memory for now: changes survive moving between
// pages but reset on a full reload. The database will replace this later.

type EventStore = {
  events: CalendarEvent[]
  addEvent: (input: EventInput) => void
  updateEvent: (id: string, changes: Partial<EventInput>) => void
  deleteEvent: (id: string) => void
}

const EventStoreContext = createContext<EventStore | null>(null)

export function EventStoreProvider({
  initialEvents,
  children,
}: {
  initialEvents: CalendarEvent[]
  children: React.ReactNode
}) {
  const [events, setEvents] = useState(initialEvents)

  const store: EventStore = {
    events,
    addEvent: (input) => setEvents((prev) => [...prev, { ...input, id: crypto.randomUUID() }]),
    updateEvent: (id, changes) =>
      setEvents((prev) => prev.map((event) => (event.id === id ? { ...event, ...changes } : event))),
    deleteEvent: (id) => setEvents((prev) => prev.filter((event) => event.id !== id)),
  }

  return <EventStoreContext value={store}>{children}</EventStoreContext>
}

export function useEvents(): EventStore {
  const store = use(EventStoreContext)
  if (!store) throw new Error("useEvents must be used inside EventStoreProvider")
  return store
}
