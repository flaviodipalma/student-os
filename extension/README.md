# Student OS browser extension

Brings Canvas and Blackboard Learn courses and assignments into Student OS using the
student's own login, with no school-approved API key. It syncs to the Student OS account
logged in in the same browser: there's nothing to pair or paste. The extension reads the
LMS's own API (Canvas `/api/v1`, Blackboard `/learn/api/public`) in the tab the student is
on, then sends that data to Student OS, which validates it and imports it like any other
sync (`src/server/integrations/extension`).

**Status:** Canvas and Blackboard: **Sync now** with course choice, and **automatic sync** when
you open them. The popup tells which one the tab is.

## Try it (development)

1. `npm run build:extension`: type-checks and builds into `extension/dist` (not committed).
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `extension/dist`.
3. Log in to Student OS (`npm run dev`) in the same Chrome.
4. Click the Student OS icon in Chrome's toolbar (pin it from the puzzle-piece menu): it says
   "Syncing to <your name>'s account". The address defaults to `http://localhost:3000` (**Change** at the bottom).
5. Open your Canvas or Blackboard (logged in), click the extension, then click **Sync now**. The first time, choose your
   courses (current-semester courses start checked). Later syncs reuse that choice; **Choose courses** changes
   it, and a course you haven't seen before (a new semester) brings the list back. Unchecking a course stops
   syncing it; its tasks stay in Student OS.

6. Optional: turn on **Sync automatically** (one switch per site you've synced). Chrome asks for access to that
   address (its standard wording is "read and change your data on …"; the extension only reads). From then on,
   opening it syncs
   your chosen courses in the background, at most once every 30 minutes. It's quiet: a badge on the icon only
   when something needs you (**!** logged out of Student OS, **New** new courses). Turning it off gives
   the access back.

After changing the extension's code, run `npm run build:extension` again and click the reload icon on the
extension's card in `chrome://extensions`.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | When you click the extension on a Canvas or Blackboard page, it can read that one tab, with your login, only then. No standing access to any site. |
| `storage` | Remembers the Student OS address and your course choice, on this computer only. |
| `http://localhost/*`, `http://127.0.0.1/*` | Reaching Student OS during development. |
| `https://*/*` (optional) | Asked for only for specific addresses: the Student OS address you enter, and your Canvas or Blackboard address when you turn on its automatic sync (so it can read it without a click). |

Having permission for the Student OS address is also what makes Chrome send your Student OS login with the
extension's requests. How other websites are kept from using that login is described in
`src/server/integrations/extension/http.ts`: SameSite login cookies, a required `X-Student-OS-Extension` header,
and a Chrome-extension `Origin` (limited to the published extension with `STUDENT_OS_EXTENSION_IDS`).

## Files

| File | Job |
| --- | --- |
| `manifest.json` | Manifest V3 |
| `src/popup.html`, `popup.css`, `popup.ts` | The toolbar popup: who's logged in, Sync now, choosing courses, the Student OS address |
| `src/canvas.ts` | `readCanvas`: runs **inside the Canvas tab** (copied there by `chrome.scripting.executeScript`, so it must stay self-contained). In two steps: your active courses (with their term), then the assignments of the courses you chose (with submission status). It follows next-page links, reads a few courses at a time, and keeps only the fields Student OS uses (no grades or scores). Tested in `canvas.test.ts` |
| `src/blackboard.ts` | `readBlackboard`: the same for Blackboard Learn, inside the Blackboard tab's main page. Courses you take as a student with their term, then the chosen courses' instructors (names only, for the course's professor), grade columns, your own grades, and recent attempts (at most 25 per course, due within the last 30 days or later). Always full addresses: Ultra sets a `<base href>` to its CDN. Tested in `blackboard.test.ts` |
| `src/background.ts` | The background worker: automatic sync when a known site's tab finishes loading, the badge |
| `src/auto-sync.ts` | Automatic sync, per site: when (30-minute gap, retries, the switch), which courses (exactly the saved choice), the badge, and carrying over the older single-Canvas settings. Tested in `auto-sync.test.ts` |
| `src/lms-sync.ts` | Shared by the popup and the worker: what's stored, one adapter per LMS, telling which LMS a tab is, running the reader in the tab, sending the import, the badge |
| `src/marker.ts` | Runs on Student OS pages only (registered for the Student OS address by the background worker, and added to already-open tabs on install): marks the page with the extension's version, so onboarding moves on by itself once the extension is installed. Reads nothing |
| `src/courses.ts` | Choosing courses: grouping by semester (Canvas term), which ones are current, the remembered choice. Tested in `courses.test.ts` |
| `src/student-os.ts` | Talking to Student OS: address and code checks, `GET /api/extension/me`, sending the import, and the summary wording. Tested in `student-os.test.ts` |
| `build.mjs` | esbuild bundle and copy into `dist/`; inlines the Lucide icons (`<i data-icon="…">` in `popup.html`) from lucide-react's icon data, so the popup ships no React |
| `src/fonts/` | Geist (the app's typeface; SIL Open Font License, `OFL.txt`) |

**Look:** `popup.css` uses the app's design tokens (same Light and Dark values as
`src/app/globals.css`, chosen by the device's setting), the app's radius scale, Geist and Lucide icons.
Depth comes from quiet inner shadows (a light rim on cards, a raised primary button, inset fields).
Only movement animates, never colors, so a theme switch never shows a half-finished fade.

Endpoints: `GET /api/extension/me` (who's logged in) and `POST /api/extension/canvas/import` (the import).
Both use the Student OS login and accept only the extension (403 otherwise; 401 when logged out).
