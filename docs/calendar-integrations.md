# Calendar integrations: Google Calendar and Outlook

Students can bring their personal calendars into Student OS. Events show up in
the one Student OS calendar next to their own events, weekly commitments, study
sessions and Canvas / Blackboard events, and the Planner, the Dashboard, "What
should I do now?" and reminders all treat them as busy time.

**Read-only.** Student OS never creates, changes or deletes a Google or Outlook
event. External events open a details dialog with **Open in Google Calendar /
Open in Outlook**, never the edit form.

## Login is not a calendar connection

| | Login providers | Calendar connections |
| --- | --- | --- |
| What | Google, Microsoft, Apple, email | Google Calendar, Outlook (and Canvas, Blackboard) |
| Where | Log in / Sign up; Settings > Account | Integrations > Calendars |
| Who runs OAuth | Supabase Auth | Student OS (`src/server/integrations/calendar`) |
| Permissions | identity only (`openid email profile`) | read-only calendar access |
| Stored | Supabase `auth.identities` (no tokens) | `calendar_connections` (tokens encrypted) |

Logging in with Google never connects Google Calendar, and logging in with
Microsoft never connects Outlook. Any combination works: log in with Apple and
connect both calendars; log in with Google and connect only Outlook; and so on.
The two use **different OAuth apps** (Supabase's login apps vs. the calendar apps
below).

## Architecture

```
Integrations > Calendars (Connect / Sync now / Disconnect)
  -> app/actions/calendar-integrations.ts        signed-in student only
  -> CalendarProvider (integrations/calendar/provider.ts)
       google/google-calendar.ts    Calendar API v3
       outlook/outlook-calendar.ts  Microsoft Graph v1.0
  -> ExternalCalendarEvent (normalized, src/lib/calendar/external-events.ts)
  -> syncExternalCalendar (calendar-sync.ts, shared with Canvas / Blackboard)
  -> external_calendar_events (one row per student + source + external id)
  -> Calendar, Dashboard, Planner, "What should I do now?", reminders
```

Reused from the LMS integrations: the credential vault (AES-256-GCM, key
`LMS_TOKEN_ENCRYPTION_KEY`), the single-use OAuth state + PKCE cookie, the
calendar sync service and the external events table. Pages never call Google or
Microsoft: they read the synced copies from the database.

## Database

- `calendar_connections`: one row per student and provider (`google` | `outlook`):
  account id and email, access + refresh tokens (**encrypted**, bound to
  `<user id>:calendar:<provider>`), expiry, granted scopes, status
  (`connected` / `needs_reauth` / `error`), last sync time and a safe error message.
  Row Level Security on, no policies (like every table).
- `external_calendar_events.source` is now `canvas | blackboard | google | outlook`
  (migration `0009_calendar_connections`).

## Sync

**Sync now** (and a first sync right after connecting):

1. A valid access token: refreshed if it expires within a minute, and once after
   a 401. A rejected refresh token marks the connection **Needs attention** and
   asks the student to reconnect.
2. Events in the sync window (`src/lib/calendar/sync-window.ts`: 7 days back, 8
   weeks ahead), all pages. Recurring events come back as their occurrences
   (Google `singleEvents=true`, Graph `calendarView`); they stay Google/Outlook
   events and never become Student OS weekly commitments.
3. Normalized: title, description (text), start/end as real instants, location,
   a link to the event (Google/Outlook hosts only). Skipped, not guessed:
   cancelled events, events the student declined, events shown as **free**
   (and Google working-location / birthday entries), all-day events (the calendar
   has no all-day row yet), events without a time or longer than 7 days.
4. Saved by the shared sync: same source + external id -> same row (no
   duplicates, changes updated in place); gone from the provider -> marked removed.
5. The summary: events added / updated / removed / not shown.

External ids: Google uses the event's iCalUID (so an invitation in two of the
student's calendars is copied once), plus the original start for an occurrence
of a recurring event; Outlook uses the occurrence's event id.

**Which calendars:** Google: every calendar the student shows in Google Calendar
(up to 15). Outlook: the student's default calendar.

**Time zones:** Google gives RFC 3339 times with offsets; Graph is asked for
UTC. Both are stored as instants and shown in the student's time zone with the
zone's own rules (daylight saving time included).

**Errors:** one calendar failing never affects the others. Expired or revoked
access, missing permission, rate limits (429 / Google quota 403), outages and
network errors each give a plain message on that connection; its events stay as
they were until a sync succeeds. Provider responses are never shown or logged.

## Disconnect

Revokes the token at Google (Microsoft has no endpoint for this: students can
remove access at account.microsoft.com/privacy/app-access or myapps.microsoft.com),
deletes the connection and its tokens, and **deletes that calendar's copied
events** (they can be private appointments; connecting again downloads them
again). Nothing else changes: Student OS events, Canvas / Blackboard events,
tasks, courses and study sessions stay.

## Security

- Tokens: encrypted at rest, only decrypted on the server for a sync or a
  disconnect, only sent in the `Authorization` header to Google / Microsoft API
  hosts over HTTPS. Never returned by a server action, rendered, put in URLs,
  stored in the browser or logged.
- OAuth: random single-use state bound to the signed-in student and provider (10
  minutes, HttpOnly cookie on the callback path), PKCE (S256), code exchanged on
  the server; the redirect URI and client secret come from server config.
- Least privilege: Google `calendar.calendarlist.readonly` +
  `calendar.events.readonly`; Microsoft `Calendars.Read` + `offline_access`. If the
  student unticks calendar access, nothing is saved.
- Every query uses the session's user id. Paging links and event links are only
  followed / kept on the provider's own hosts.

## Setup: Google Calendar

1. [Google Cloud Console](https://console.cloud.google.com/): create (or pick) a
   project. **APIs & Services > Library > Google Calendar API > Enable**.
2. **OAuth consent screen**: app name "Student OS", support email, and the scopes
   `.../auth/calendar.calendarlist.readonly` and `.../auth/calendar.events.readonly`
   (Google lists them as sensitive: while the app is in **Testing**, add each
   Google account that may connect as a test user; for everyone, submit it for
   verification).
3. **Credentials > Create credentials > OAuth client ID**, type **Web application**.
   Authorized redirect URIs:
   - Development: `http://localhost:3000/api/integrations/google-calendar/callback`
   - Production: `https://<your-domain>/api/integrations/google-calendar/callback`
4. Server env (`.env.local`, or your host's secrets in production):
   ```
   LMS_TOKEN_ENCRYPTION_KEY=<openssl rand -base64 32, if not set already>
   GOOGLE_CALENDAR_CLIENT_ID=...
   GOOGLE_CALENDAR_CLIENT_SECRET=...
   GOOGLE_CALENDAR_REDIRECT_URI=http://localhost:3000/api/integrations/google-calendar/callback
   ```
   (In production, the same with the production redirect URI.) This is a
   different OAuth client from the one in Supabase for "Continue with Google".

## Setup: Outlook (Microsoft Graph)

1. [Microsoft Entra admin center](https://entra.microsoft.com/) > Identity >
   Applications > **App registrations > New registration**: "Student OS Calendar".
   - Supported account types: **Accounts in any organizational directory and
     personal Microsoft accounts**.
   - Redirect URI (platform **Web**):
     - Development: `http://localhost:3000/api/integrations/outlook-calendar/callback`
     - Production: `https://<your-domain>/api/integrations/outlook-calendar/callback`
       (add under **Authentication** after creating it).
2. **API permissions > Add a permission > Microsoft Graph > Delegated**:
   `Calendars.Read` and `offline_access` (User.Read, added by default, can stay
   or be removed; Student OS doesn't use it). Some schools require an admin to
   consent before students can connect.
3. **Certificates & secrets > New client secret**: copy the **Value**. It
   expires: note the date and replace it before then.
4. Server env:
   ```
   OUTLOOK_CALENDAR_CLIENT_ID=<Application (client) ID>
   OUTLOOK_CALENDAR_CLIENT_SECRET=<secret value>
   OUTLOOK_CALENDAR_REDIRECT_URI=http://localhost:3000/api/integrations/outlook-calendar/callback
   # optional: OUTLOOK_CALENDAR_TENANT=common
   ```
   This can be the same Entra app as "Continue with Microsoft" only if you add
   this redirect URI and permissions to it; a separate app keeps login and
   calendar access clearly apart (recommended).

Then run `npm run db:migrate` once and restart the server. The Integrations page (Calendars) shows **Connect Google Calendar** / **Connect Outlook**
once a provider's settings are present (otherwise "isn't set up on this server yet").

## Tests

No real accounts or credentials: Google and Microsoft are fakes shaped like
their APIs.

- `integrations/calendar/providers.test.ts`: OAuth URLs and scopes, code
  exchange and refresh, granted-scope checks, pagination, recurring occurrences,
  skips, time zones, links, error kinds.
- `integrations/calendar/calendar-connections.test.ts` (real Postgres): encrypted
  storage, sync (add / no duplicates / update / remove), token refresh and 401
  retry, revoked access, rate limits and outages, all four sources together, one
  provider failing, disconnect, user isolation, time zones, Dashboard schedule,
  Planner busy time, "What should I do now?", reminders.
- `app/actions/calendar-integrations.test.ts`: Connect, the OAuth callback (state,
  CSRF, cancel, permissions, first sync), Sync now, Disconnect, isolation.
- `components/settings/calendar-connections.test.tsx`,
  `components/calendar/calendar-view.test.tsx`: the Integrations rows and the calendar.

## Limitations

- Manual sync only (plus the first sync on connect); no background sync or
  push notifications yet. Each sync re-reads the window (no incremental sync tokens).
- All-day events aren't shown yet (the calendar has no all-day row).
- Outlook: the default calendar only. Google: calendars shown in Google, up to 15.
- Event types aren't known from the providers, so they're "Other".
- Events shown as free, declined or cancelled are skipped (they don't take time).
