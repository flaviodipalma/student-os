// Light / Dark / System.
//
// The choice is kept in a cookie (so the page is painted in the right theme
// before any JavaScript runs: THEME_SCRIPT, from the root layout) and, for a
// signed-in student, in their preferences (so it follows them to other devices).
// "system" follows the device's setting, live. The whole app changes through
// the `dark` class on <html> and the CSS variables in globals.css; no component
// switches colors by itself.

export const themePreferences = ["light", "dark", "system"] as const
export type ThemePreference = (typeof themePreferences)[number]
export type ResolvedTheme = "light" | "dark"

export const THEME_COOKIE = "sos-theme"
const DARK_QUERY = "(prefers-color-scheme: dark)"

export function isThemePreference(value: unknown): value is ThemePreference {
  return typeof value === "string" && (themePreferences as readonly string[]).includes(value)
}

export function resolveTheme(preference: ThemePreference, systemDark: boolean): ResolvedTheme {
  return preference === "system" ? (systemDark ? "dark" : "light") : preference
}

// Runs in <head> before the first paint (and does nothing else). Kept tiny and
// self-contained: it can't import anything.
export const THEME_SCRIPT = `(function(){try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark|system)(?:;|$)/);var p=m?m[1]:"system";var d=p==="dark"||(p==="system"&&window.matchMedia("${DARK_QUERY}").matches);var e=document.documentElement;e.classList.toggle("dark",d);e.style.colorScheme=d?"dark":"light";e.setAttribute("data-theme-preference",p)}catch(x){}})()`

// ---- In the browser

export function readThemeCookie(): ThemePreference {
  if (typeof document === "undefined") return "system"
  const match = new RegExp(`(?:^|; )${THEME_COOKIE}=([^;]*)`).exec(document.cookie)
  return isThemePreference(match?.[1]) ? match[1] : "system"
}

export function systemPrefersDark(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia(DARK_QUERY).matches
}

// Applies a preference now: the class on <html>, the cookie (a year), without
// half-finished color transitions.
export function applyTheme(preference: ThemePreference): ResolvedTheme {
  const resolved = resolveTheme(preference, systemPrefersDark())
  const root = document.documentElement
  root.classList.add("theme-switching")
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
  root.setAttribute("data-theme-preference", preference)
  document.cookie = `${THEME_COOKIE}=${preference}; path=/; max-age=31536000; SameSite=Lax`
  // Transitions come back on the next frame.
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove("theme-switching")))
  return resolved
}

// Calls back when the device switches between light and dark. Returns the unsubscribe.
export function onSystemThemeChange(callback: () => void): () => void {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return () => {}
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener("change", callback)
  return () => query.removeEventListener("change", callback)
}
