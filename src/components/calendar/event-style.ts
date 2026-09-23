import type { EventType } from "@/lib/types"

// Colors per event type, shared by the Calendar and the Dashboard.
// Classes and study sessions (the academic work) get a stronger fill than the rest.
// Palette checked for color-blind separation; every block also shows its type as text.
export const eventStyle: Record<EventType, { block: string; swatch: string }> = {
  class: {
    block: "border-teal-500 bg-teal-100/80 text-teal-950 hover:bg-teal-100",
    swatch: "bg-teal-500",
  },
  study: {
    block: "border-indigo-600 bg-indigo-100/80 text-indigo-950 hover:bg-indigo-100",
    swatch: "bg-indigo-600",
  },
  sports: {
    block: "border-amber-500 bg-amber-50 text-amber-950 hover:bg-amber-100/70",
    swatch: "bg-amber-500",
  },
  work: {
    block: "border-sky-500 bg-sky-50 text-sky-950 hover:bg-sky-100/70",
    swatch: "bg-sky-500",
  },
  personal: {
    block: "border-pink-500 bg-pink-50 text-pink-950 hover:bg-pink-100/70",
    swatch: "bg-pink-500",
  },
  // External calendar events of unknown kind: neutral.
  other: {
    block: "border-slate-400 bg-slate-100/80 text-slate-900 hover:bg-slate-100",
    swatch: "bg-slate-400",
  },
}
