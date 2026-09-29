// GET /api/health: liveness. "The Quadernio server is running." No dependencies
// are checked (use /api/health/ready for that), no data or configuration is
// returned. For the hosting platform's uptime checks.
export const dynamic = "force-dynamic"

export function GET() {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } })
}
