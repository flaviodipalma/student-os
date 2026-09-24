import type { EventType } from "@/lib/types"

// Colors per event type, shared by the Calendar and the Dashboard. The values are
// theme tokens (--event-<type>, globals.css), so Light and Dark each get their own.
// Classes and study sessions (the academic work) get a stronger fill than the rest.
// Palette checked for color-blind separation; every block also shows its type as text.
export const eventStyle: Record<EventType, { block: string; swatch: string }> = {
  class: {
    block: "border-event-class bg-event-class-bg text-event-class-fg hover:brightness-[0.97] dark:hover:brightness-110",
    swatch: "bg-event-class",
  },
  study: {
    block: "border-event-study bg-event-study-bg text-event-study-fg hover:brightness-[0.97] dark:hover:brightness-110",
    swatch: "bg-event-study",
  },
  sports: {
    block: "border-event-sports bg-event-sports-bg text-event-sports-fg hover:brightness-[0.97] dark:hover:brightness-110",
    swatch: "bg-event-sports",
  },
  work: {
    block: "border-event-work bg-event-work-bg text-event-work-fg hover:brightness-[0.97] dark:hover:brightness-110",
    swatch: "bg-event-work",
  },
  personal: {
    block: "border-event-personal bg-event-personal-bg text-event-personal-fg hover:brightness-[0.97] dark:hover:brightness-110",
    swatch: "bg-event-personal",
  },
  // External calendar events of unknown kind: neutral.
  other: {
    block: "border-event-other bg-event-other-bg text-event-other-fg hover:brightness-[0.97] dark:hover:brightness-110",
    swatch: "bg-event-other",
  },
}
