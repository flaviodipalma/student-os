// Runs the push reminders job once, like the scheduler does in production:
//   npm run reminders:run            (the dev server at http://localhost:3000)
//   npm run reminders:run -- <url>   (another address, e.g. http://localhost:3001)
// Reads CRON_SECRET from the environment (.env.local via --env-file).
const base = (process.argv[2] ?? process.env.SITE_URL ?? "http://localhost:3000").replace(/\/+$/, "")
if (!process.env.CRON_SECRET) {
  console.error("CRON_SECRET isn't set (add it to .env.local).")
  process.exit(1)
}
const response = await fetch(`${base}/api/cron/reminders`, { method: "POST", headers: { Authorization: `Bearer ${process.env.CRON_SECRET}` } })
console.log(response.status, await response.text())
process.exit(response.ok ? 0 : 1)
