# Student OS design system

Clean, calm, quietly premium. The polish comes from hierarchy, spacing,
typography and restraint, not decoration.

## Tokens (src/app/globals.css)

Every color is a semantic token with a Light and a Dark value. Components use
the token names; **never raw palette classes** (`bg-emerald-50`, `text-red-700`).

| Group | Tokens (Tailwind classes) | Use |
| --- | --- | --- |
| Surfaces | `bg-background` < `bg-card` < `bg-popover`, `bg-muted`, `bg-sidebar` | app, cards, menus/dialogs, quiet fills |
| Text | `text-foreground`, `text-muted-foreground`, `text-subtle-foreground` | primary, secondary, captions |
| Lines | `border-border-subtle`, `border-border`, `border-border-strong`, `ring-ring` | dividers, outlines, focus |
| Accent | `bg-primary` (`hover:bg-primary-hover`), `bg-primary-soft` + `text-primary-soft-foreground` | actions, selected states |
| Status | `text-success/warning/danger/info`, `bg-*-soft`, `ring-*-border`, `bg-danger-solid` | badges, notices, overdue |
| Calendar | `bg-event-<type>-bg`, `text-event-<type>-fg`, `border-event-<type>` (`class`, `study`, `sports`, `work`, `personal`, `other`) | event blocks and swatches (`components/calendar/event-style.ts`) |
| Courses | `bg-course-<color>` | the dot next to a course code (`CourseTag`) |
| Elevation | `shadow-xs` (cards), `shadow-md` (the hero), `shadow-lg` (dialogs, menus) | quiet; in Dark, depth comes from lighter surfaces |
| Radius | `rounded-md` (badges, small controls), `rounded-lg` (buttons, inputs, rows), `rounded-xl` (cards, dialogs), `rounded-full` (pills, dots) | one radius language |

Light: a cool off-white app, white cards, ink text. Dark: layered blue-black
surfaces (never pure black), softened white text, lighter surfaces for depth.
Every text/background pair meets WCAG AA in both (checked in the browser audit).

## Theme: Light / Dark / System

- `src/lib/theme.ts`: preferences, the `sos-theme` cookie, `THEME_SCRIPT` (runs in
  `<head>` before the first paint: no flash), `applyTheme`, the device listener.
- `components/theme/theme-provider.tsx`: `useTheme()`; follows the device live
  while the choice is System; `SavedThemeSync` applies a signed-in student's saved
  choice (`student_preferences.theme`, null = never chosen) on a new device.
- The theme menu in the header (`components/theme/theme-menu.tsx`): applies at
  once and saves to the account.
- Switching disables transitions for a frame (no half-finished color fades);
  `prefers-reduced-motion` turns animations and transitions off everywhere.

## Components and patterns

- Buttons (`components/ui/button.tsx`): default (primary), outline, secondary,
  ghost, destructive, link. One set everywhere; loading = spinner + "…ing" label + disabled.
- Cards (`components/ui/card.tsx`): surface + hairline ring + `shadow-xs`. Not
  everything is a card: lists inside a card are rows with dividers.
- "What should I do now?" is the only hero: elevated surface, a soft wash of the
  accent, the largest task title on the page, one primary action.
- Status is never color alone: priority badges have an icon and a word
  (`PriorityBadge`), notices have an icon, "Urgent"/"Heads up" is written out,
  external events say their source ("from Google Calendar").
- Icons: lucide only, outline style, `size-4` in text, `aria-hidden` when decorative.
- Type: Geist. Page title `text-2xl md:text-3xl font-semibold tracking-tight`;
  card title `text-lg font-semibold`; body `text-sm`; captions `text-xs text-muted-foreground`.
