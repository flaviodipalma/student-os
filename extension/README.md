# Student OS browser extension

Brings Canvas courses and assignments into Student OS using the student's own
Canvas login, with no school-approved API key. It syncs to the Student OS account
logged in in the same browser: there's nothing to pair or paste. The extension reads Canvas's
`/api/v1` in the Canvas tab the student is on, then sends that data to Student OS.
The server validates it and imports it like any other Canvas sync
(`src/server/integrations/extension`).

**Status:** Canvas **Sync now** with course choice works. Blackboard and background syncing are not built yet.

## Try it (development)

1. `npm run build:extension`: type-checks and builds into `extension/dist` (not committed).
2. Chrome → `chrome://extensions` → turn on **Developer mode** → **Load unpacked** → choose `extension/dist`.
3. Log in to Student OS (`npm run dev`) in the same Chrome.
4. Click the Student OS icon in Chrome's toolbar (pin it from the puzzle-piece menu): it says
   "Syncing to <your name>'s account". The address defaults to `http://localhost:3000` (**Change** at the bottom).
5. Open your Canvas (logged in), click the extension, then click **Sync now**. The first time, choose your
   courses (current-semester courses start checked). Later syncs reuse that choice; **Choose courses** changes
   it, and a course you haven't seen before (a new semester) brings the list back. Unchecking a course stops
   syncing it; its tasks stay in Student OS.

After changing the extension's code, run `npm run build:extension` again and click the reload icon on the
extension's card in `chrome://extensions`.

## Permissions

| Permission | Why |
| --- | --- |
| `activeTab`, `scripting` | When you click the extension on a Canvas page, it can read that one tab, with your login, only then. No standing access to any site. |
| `storage` | Remembers the Student OS address and your course choice, on this computer only. |
| `http://localhost/*`, `http://127.0.0.1/*` | Reaching Student OS during development. |
| `https://*/*` (optional) | Asked for only for the Student OS address you enter, when you save it. |

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
| `src/courses.ts` | Choosing courses: grouping by semester (Canvas term), which ones are current, the remembered choice. Tested in `courses.test.ts` |
| `src/student-os.ts` | Talking to Student OS: address and code checks, `GET /api/extension/me`, sending the import, and the summary wording. Tested in `student-os.test.ts` |
| `build.mjs` | esbuild bundle and copy into `dist/` |

Endpoints: `GET /api/extension/me` (who's logged in) and `POST /api/extension/canvas/import` (the import).
Both use the Student OS login and accept only the extension (403 otherwise; 401 when logged out).
