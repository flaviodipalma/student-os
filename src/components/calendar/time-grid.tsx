"use client"

import { useEffect, useRef } from "react"
import { formatTime, formatWeekday, fromDateKey } from "@/lib/format"
import { eventTypeLabel, eventsOn, layoutDay, toMinutes } from "@/lib/events"
import type { CalendarEvent } from "@/lib/types"
import { cn } from "@/lib/utils"
import { eventStyle } from "./event-style"

const HOUR_PX = 52
const HOURS = Array.from({ length: 24 }, (_, hour) => hour)
// Scroll to this hour when the grid first shows (unless something starts earlier).
const DEFAULT_SCROLL_HOUR = 7

function hourLabel(hour: number): string {
  if (hour === 0) return ""
  return formatTime(fromDateKey("2000-01-01", `${String(hour).padStart(2, "0")}:00`)).replace(":00", "")
}

// Days side by side, hours down the side, events placed by their start and end times.
export function TimeGrid({
  days,
  events,
  today,
  nowMinutes,
  onSelectDay,
  onSelectSlot,
  onSelectEvent,
}: {
  days: string[]
  events: CalendarEvent[]
  today: string
  nowMinutes: number
  onSelectDay?: (date: string) => void
  onSelectSlot: (date: string, startTime: string) => void
  onSelectEvent: (event: CalendarEvent) => void
}) {
  const scrollerRef = useRef<HTMLDivElement>(null)
  const isWeek = days.length > 1
  const visible = events.filter((event) => days.includes(event.date))
  const firstKey = days[0]

  // When the visible range changes, scroll to the morning (or the earliest event),
  // and on narrow screens bring today's column into view.
  useEffect(() => {
    const scroller = scrollerRef.current
    if (!scroller) return
    const earliest = Math.min(...visible.map((event) => toMinutes(event.startTime) / 60), DEFAULT_SCROLL_HOUR)
    scroller.scrollTop = Math.max(0, Math.floor(earliest) * HOUR_PX - 12)
    const todayColumn = scroller.querySelector<HTMLElement>("[data-today]")
    const gutter = scroller.querySelector<HTMLElement>("[data-gutter]")
    scroller.scrollLeft = todayColumn ? todayColumn.offsetLeft - (gutter?.offsetWidth ?? 0) : 0
    // Only when the range changes, not on every event edit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstKey, days.length])

  const columns = { gridTemplateColumns: `3.5rem repeat(${days.length}, minmax(0, 1fr))` }

  return (
    <div
      ref={scrollerRef}
      className="h-[calc(100svh-15rem)] min-h-[28rem] overflow-auto rounded-xl bg-card ring-1 ring-foreground/10"
    >
      <div className={cn(isWeek && "min-w-[46rem]")}>
        {/* Day headers */}
        <div className="sticky top-0 z-20 grid border-b bg-card/95 backdrop-blur" style={columns}>
          <div data-gutter className="sticky left-0 z-10 bg-card" />
          {days.map((date) => {
            const isToday = date === today
            const label = (
              <>
                <span className="text-xs font-medium text-muted-foreground">
                  {formatWeekday(fromDateKey(date), "short")}
                </span>
                <span
                  className={cn(
                    "flex size-8 items-center justify-center rounded-full text-lg font-semibold",
                    isToday && "bg-primary text-primary-foreground"
                  )}
                >
                  {fromDateKey(date).getDate()}
                </span>
              </>
            )
            return (
              <div key={date} className="flex justify-center border-l py-2">
                {onSelectDay ? (
                  <button
                    type="button"
                    onClick={() => onSelectDay(date)}
                    aria-label={`View ${formatWeekday(fromDateKey(date))} ${fromDateKey(date).getDate()}`}
                    className="flex flex-col items-center gap-0.5 rounded-lg px-2 py-0.5 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    {label}
                  </button>
                ) : (
                  <div className="flex flex-col items-center gap-0.5">{label}</div>
                )}
              </div>
            )
          })}
        </div>

        {/* Hours and events */}
        <div className="grid" style={columns}>
          <div className="sticky left-0 z-10 bg-card" style={{ height: 24 * HOUR_PX }}>
            {HOURS.map((hour) => (
              <div
                key={hour}
                className="relative pr-2 text-right text-[11px] text-muted-foreground"
                style={{ height: HOUR_PX }}
              >
                <span className="absolute -top-2 right-2">{hourLabel(hour)}</span>
              </div>
            ))}
          </div>

          {days.map((date) => (
            <DayColumn
              key={date}
              date={date}
              events={eventsOn(visible, date)}
              isToday={date === today}
              nowMinutes={nowMinutes}
              onSelectSlot={onSelectSlot}
              onSelectEvent={onSelectEvent}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function DayColumn({
  date,
  events,
  isToday,
  nowMinutes,
  onSelectSlot,
  onSelectEvent,
}: {
  date: string
  events: CalendarEvent[]
  isToday: boolean
  nowMinutes: number
  onSelectSlot: (date: string, startTime: string) => void
  onSelectEvent: (event: CalendarEvent) => void
}) {
  // Clicking empty space starts a new event at that half hour.
  function handleClick(e: React.MouseEvent<HTMLDivElement>) {
    if (e.target !== e.currentTarget) return
    const y = e.clientY - e.currentTarget.getBoundingClientRect().top
    const minutes = Math.min(Math.floor((y / HOUR_PX) * 2) * 30, 23 * 60)
    const h = String(Math.floor(minutes / 60)).padStart(2, "0")
    const m = String(minutes % 60).padStart(2, "0")
    onSelectSlot(date, `${h}:${m}`)
  }

  return (
    <div
      data-today={isToday || undefined}
      onClick={handleClick}
      className={cn("relative cursor-cell border-l", isToday && "bg-primary/[0.025]")}
      style={{
        height: 24 * HOUR_PX,
        backgroundImage: `repeating-linear-gradient(to bottom, var(--border) 0 1px, transparent 1px ${HOUR_PX}px)`,
      }}
    >
      {layoutDay(events).map(({ event, column, columns }) => {
        const start = toMinutes(event.startTime)
        const end = toMinutes(event.endTime)
        const height = Math.max(((end - start) / 60) * HOUR_PX - 2, 20)
        const compact = height < 40
        const time = `${formatTime(fromDateKey(date, event.startTime))} – ${formatTime(fromDateKey(date, event.endTime))}`
        const academic = event.type === "class" || event.type === "study"
        return (
          <button
            key={event.id}
            type="button"
            onClick={() => onSelectEvent(event)}
            aria-label={`${event.title}, ${time}, ${eventTypeLabel[event.type]}${event.completed ? ", done" : ""}`}
            className={cn(
              "absolute overflow-hidden rounded-md border-l-[3px] px-1.5 py-1 text-left text-xs leading-tight shadow-xs outline-none transition-colors focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50",
              eventStyle[event.type].block,
              columns > 1 && "ring-1 ring-card",
              event.completed && "line-through opacity-60"
            )}
            style={{
              top: (start / 60) * HOUR_PX + 1,
              height,
              left: `calc(${(column / columns) * 100}% + 2px)`,
              width: `calc(${100 / columns}% - 4px)`,
            }}
          >
            {compact ? (
              <p className="truncate">
                <span className={cn(academic ? "font-semibold" : "font-medium")}>{event.title}</span>
                <span className="opacity-75"> · {formatTime(fromDateKey(date, event.startTime))}</span>
              </p>
            ) : (
              <>
                <p className={cn("line-clamp-2", academic ? "font-semibold" : "font-medium")}>{event.title}</p>
                <p className="mt-0.5 truncate opacity-75">{time}</p>
              </>
            )}
          </button>
        )
      })}

      {isToday && (
        <div
          aria-hidden
          className="pointer-events-none absolute inset-x-0 z-10 flex items-center"
          style={{ top: (nowMinutes / 60) * HOUR_PX - 4 }}
        >
          <span className="-ml-1 size-2 rounded-full bg-red-500" />
          <span className="h-0.5 flex-1 bg-red-500" />
        </div>
      )}
    </div>
  )
}
