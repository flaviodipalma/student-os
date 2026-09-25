// Checks the server's environment variables (see .env.example and
// docs/deployment.md). Runs when the server starts (src/instrumentation.ts) and
// with `npm run check:env` before a deploy.
//
//   errors    the app can't work (or would be unsafe): in production the server
//             refuses to start, with a clear message
//   warnings  a feature is off or set up for development only
//
// Only variable NAMES and problems are reported, never values.
//
// "Production" means a real deployment: APP_ENV=production (set on the host).
// NODE_ENV=production alone (e.g. `npm run build && npm start` on a laptop) keeps
// the development rules, so a local production build still runs on localhost.

export type EnvReport = { errors: string[]; warnings: string[] }

type Env = Record<string, string | undefined>

const isUrl = (value: string, protocols: string[]) => {
  try {
    return protocols.includes(new URL(value).protocol)
  } catch {
    return false
  }
}

// A group of variables that only works when all are set (e.g. one OAuth app).
function group(env: Env, report: EnvReport, feature: string, names: string[]) {
  const set = names.filter((name) => env[name])
  if (set.length > 0 && set.length < names.length) {
    report.errors.push(`${feature}: set all of ${names.join(", ")} (missing ${names.filter((n) => !env[n]).join(", ")}).`)
  } else if (set.length === 0) {
    report.warnings.push(`${feature} is off (${names.join(", ")} not set).`)
  }
  return set.length === names.length
}

export const isDeployment = (env: Env = process.env) => env.APP_ENV === "production"

export function checkEnv(env: Env = process.env, production = isDeployment(env)): EnvReport {
  const report: EnvReport = { errors: [], warnings: [] }

  if (env.APP_ENV && !["development", "test", "production"].includes(env.APP_ENV)) {
    report.errors.push("APP_ENV must be development, test or production.")
  }

  // ---- Required everywhere
  if (!env.NEXT_PUBLIC_SUPABASE_URL || !isUrl(env.NEXT_PUBLIC_SUPABASE_URL, ["https:", "http:"])) {
    report.errors.push("NEXT_PUBLIC_SUPABASE_URL must be your Supabase project URL.")
  }
  if (!env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) report.errors.push("NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required (sign-in).")
  if (!env.DATABASE_URL || !isUrl(env.DATABASE_URL, ["postgres:", "postgresql:"])) {
    report.errors.push("DATABASE_URL must be a postgres:// connection string (server-only).")
  }
  // A secret must never be given a public name (NEXT_PUBLIC_* is sent to browsers).
  for (const name of Object.keys(env)) {
    if (name.startsWith("NEXT_PUBLIC_") && /SECRET|SERVICE_ROLE|DATABASE|API_KEY|ENCRYPTION|PASSWORD/i.test(name)) {
      report.errors.push(`${name} looks like a secret but has the public NEXT_PUBLIC_ prefix. Rename it.`)
    }
  }

  // ---- Token encryption (integrations)
  if (env.LMS_TOKEN_ENCRYPTION_KEY) {
    if (Buffer.from(env.LMS_TOKEN_ENCRYPTION_KEY, "base64").length !== 32) {
      report.errors.push("LMS_TOKEN_ENCRYPTION_KEY must be 32 random bytes, base64 (openssl rand -base64 32).")
    }
  } else {
    report.warnings.push("LMS_TOKEN_ENCRYPTION_KEY isn't set: Google Calendar and Outlook can't be connected.")
  }

  // ---- AI
  for (const [name, feature] of [
    ["SYLLABUS_AI_PROVIDER", "Syllabus import"],
    ["ASSISTANT_AI_PROVIDER", "The Assistant"],
  ] as const) {
    if (env[name] === "mock") {
      ;(production ? report.errors : report.warnings).push(`${feature} uses the MOCK provider (${name}=mock): not real AI. Not allowed in production.`)
    }
  }
  const aiNeedsKey = env.SYLLABUS_AI_PROVIDER !== "mock" || (env.ASSISTANT_AI_PROVIDER ?? env.SYLLABUS_AI_PROVIDER) !== "mock"
  if (aiNeedsKey && !env.ANTHROPIC_API_KEY && !env.ANTHROPIC_AUTH_TOKEN) {
    ;(production ? report.errors : report.warnings).push("ANTHROPIC_API_KEY isn't set: syllabus import and the Assistant won't work.")
  }

  // ---- Integrations (each is optional; if configured, fully and safely)
  const redirects: string[] = []
  if (group(env, report, "Google Calendar", ["GOOGLE_CALENDAR_CLIENT_ID", "GOOGLE_CALENDAR_CLIENT_SECRET", "GOOGLE_CALENDAR_REDIRECT_URI"])) redirects.push("GOOGLE_CALENDAR_REDIRECT_URI")
  if (group(env, report, "Outlook", ["OUTLOOK_CALENDAR_CLIENT_ID", "OUTLOOK_CALENDAR_CLIENT_SECRET", "OUTLOOK_CALENDAR_REDIRECT_URI"])) redirects.push("OUTLOOK_CALENDAR_REDIRECT_URI")

  // ---- Browser extension: which Chrome extensions may use a student's login
  // (src/server/integrations/extension/http.ts). Unset = any extension.
  const extensionIds = (env.STUDENT_OS_EXTENSION_IDS ?? "").split(",").map((id) => id.trim()).filter(Boolean)
  if (extensionIds.some((id) => !/^[a-p]{32}$/.test(id))) {
    report.errors.push("STUDENT_OS_EXTENSION_IDS must be Chrome extension ids (32 letters a-p), comma-separated.")
  } else if (production && extensionIds.length === 0) {
    report.warnings.push("STUDENT_OS_EXTENSION_IDS isn't set: any Chrome extension can ask to sync with a student's login. Set it to the published extension's id.")
  }

  // ---- Production URLs: HTTPS, the real domain, no localhost
  if (production) {
    if (!env.SITE_URL) report.warnings.push("SITE_URL isn't set: sign-in redirects use each request's own address. Set it to https://<your domain>.")
    else if (!env.SITE_URL.startsWith("https://")) report.errors.push("SITE_URL must use https:// in production.")
    const site = env.SITE_URL ? new URL(env.SITE_URL).host : null
    for (const name of redirects) {
      const value = env[name] ?? ""
      if (!value.startsWith("https://") || /localhost|127\.0\.0\.1/.test(value)) {
        report.errors.push(`${name} must be an https:// URL on your production domain (not localhost).`)
      } else if (site && new URL(value).host !== site) {
        report.warnings.push(`${name} isn't on SITE_URL's domain (${site}). Check the provider's redirect settings.`)
      }
    }
  }
  return report
}
