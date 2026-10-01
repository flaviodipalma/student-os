# Google verification for calendar access

Google Calendar uses two **sensitive** scopes, so the Google Cloud project
"Quadernio" must be verified before the "Google hasn't verified this app" warning
and the 100-user cap go away. Sensitive (not restricted) scopes need no paid
security assessment: Google reviews the homepage, the Privacy Policy, the scope
justifications and a demo video. It usually takes a few weeks; Google writes to
the project's contact email and may ask follow-up questions.

What Google checks, and where it is:

| Requirement | Where |
| --- | --- |
| Domain ownership of quadernio.com | Google Search Console (DNS TXT record at IONOS), same Google account as the Cloud project |
| Public homepage describing the app, linking the Privacy Policy | https://quadernio.com (`src/app/page.tsx`) |
| Privacy Policy on the same domain, with Google data use and the Limited Use statement | https://quadernio.com/privacy (`src/app/(legal)/privacy/page.tsx`) |
| Only the narrowest scopes | `calendar.calendarlist.readonly`, `calendar.events.readonly` (`src/server/integrations/calendar/google/google-calendar.ts`) |
| Demo video | below |
| Scope justifications | below |

## Scope justifications (paste in Data Access, one per scope)

**`https://www.googleapis.com/auth/calendar.calendarlist.readonly`**

> Quadernio is a study planner for college students. When a student connects Google Calendar, Quadernio reads their calendar list (read-only) to find which calendars they show in Google Calendar (the "selected" calendars and their primary calendar), so it only reads events from calendars the student actually uses, and to show which Google account is connected. Quadernio never creates, changes or deletes calendars. The narrower calendar.events.readonly scope alone doesn't tell which of the student's calendars are visible to them.

**`https://www.googleapis.com/auth/calendar.events.readonly`**

> Quadernio reads the events of the student's visible calendars (read-only: title, time, location, description and link) to treat them as busy time: its Planner schedules study sessions around them, and they are shown in Quadernio's calendar next to the student's class deadlines so the student sees their whole week in one place. Events are never created, changed, deleted or shared; disconnecting deletes the copied events and revokes access. A read-only scope is the narrowest that lets the Planner avoid the student's existing commitments.

## Demo video (2-3 minutes, YouTube, "Unlisted")

Record the screen with **⌘ Shift 5** (macOS screen recording), in a Chrome window whose
**language is English** (Google's reviewers need the consent screen in English: Chrome >
Settings > Languages, move English to the top, or use a Google account set to English).
Captions or a voice-over are welcome but not required. Show, in this order:

1. **The homepage** https://quadernio.com: scroll to "Your data stays yours" (5-10 s).
2. **Log in** to Quadernio with a test account that has a few events in Google Calendar.
3. **Integrations > Calendars > Connect Google Calendar.**
4. **Google's consent screen.** Click the address bar and slowly show the whole URL, so the
   `client_id=...` is readable (it must match the "Quadernio calendar" OAuth client). Show the
   app name and the two permissions listed, then allow. (If the "unverified app" warning
   appears first, show it and continue through Advanced.)
5. **Back in Quadernio:** Integrations shows Google Calendar connected with the account's
   email (calendar list scope).
6. **Calendar:** the Google events appear in Quadernio's week view, labeled "from Google
   Calendar"; open one to show it's read-only ("Open in Google Calendar", no edit form)
   (events scope).
7. **Planner / Dashboard:** study sessions are placed around those events (why the data is
   needed).
8. **Disconnect** in Integrations: the Google events disappear from Quadernio.

Upload to YouTube as **Unlisted** and paste the link in the verification form.

## Submitting

Google Auth Platform > **Verification Center** (or Data Access, which prompts for it):
confirm the branding (app name "Quadernio", homepage, privacy policy, terms, authorized
domain quadernio.com), paste the two justifications and the video link, and submit. Reply
to Google's emails at the project's contact address promptly; reviews pause while waiting.
