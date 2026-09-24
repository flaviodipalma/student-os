import type { Instrumentation } from "next"

// Runs once when a server instance starts, and on every unexpected server error.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { checkEnv, isDeployment } = await import("./server/env")
  const { logger } = await import("./server/log")
  const { errors, warnings } = checkEnv()
  for (const warning of warnings) logger.warn("env", warning)
  for (const error of errors) logger.error("env", error)
  // In a real deployment (APP_ENV=production) a broken configuration stops the
  // server here, with the reasons above, instead of failing on a student's request.
  if (errors.length > 0 && isDeployment()) {
    throw new Error(`Student OS can't start: ${errors.length} environment problem(s). See the log above (npm run check:env).`)
  }
}

// Every error Next catches on the server (pages, route handlers, server actions,
// the proxy) as one structured log line: what failed and where, never the error
// message (it can contain SQL, URLs or tokens). Error monitoring (e.g. Sentry)
// plugs in here; see docs/deployment.md.
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return
  const { logger } = await import("./server/log")
  logger.error("request", "unexpected server error", {
    type: error instanceof Error ? error.name : typeof error,
    digest: typeof error === "object" && error !== null && "digest" in error ? String(error.digest) : undefined,
    method: request.method,
    // The route, not the full path (paths can contain ids).
    route: context.routePath,
    routeType: context.routeType,
  })
}
