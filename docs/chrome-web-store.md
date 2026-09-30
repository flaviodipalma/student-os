# Publishing the extension on the Chrome Web Store

Everything the Chrome Web Store developer console asks for, ready to paste. Keep it in
line with the extension's code (`extension/README.md`) and the Privacy Policy
(`src/app/(legal)/privacy/page.tsx`): reviewers compare them.

## 1. Build the package

```
npm run build:extension:store
```

Uploads `extension/quadernio-extension-<version>.zip` (not committed). The store build
talks to `https://quadernio.com` out of the box and asks only for that site; the
development build (`npm run build:extension`) keeps using localhost. For an update, raise
`version` in `extension/manifest.json` first (the store refuses a version it already has).

## 2. Store listing tab

**Name:** Quadernio (from the manifest)

**Summary** (from the manifest, max 132 characters):
> Brings your Canvas and Blackboard courses and assignments into Quadernio, using your own school login.

**Description:**

> Quadernio is a planner for college students: your courses, deadlines, classes and study time in one place, with a plan for what to do next.
>
> This extension connects Quadernio to your school's Canvas or Blackboard, with no setup from your school and no passwords to share.
>
> How it works
> • Log in to Quadernio (quadernio.com) and to your Canvas or Blackboard in Chrome.
> • Open Canvas or Blackboard, click the Quadernio icon, and press Sync now.
> • Choose your courses. Their assignments and due dates appear in Quadernio as tasks, and the ones you've already submitted are marked done.
> • Optional: turn on automatic sync, and your courses update whenever you open Canvas or Blackboard (at most every 30 minutes).
>
> Private by design
> • Your school login never leaves your browser. The extension reads Canvas or Blackboard in your own tab, the same way the page does.
> • Only your courses, assignments, due dates and submission status are sent, to your own Quadernio account. Nothing else.
> • Quadernio's servers never contact your school's systems, and nothing is ever changed in Canvas or Blackboard.
>
> Quadernio isn't affiliated with or endorsed by Instructure (Canvas) or Anthology (Blackboard).
>
> Questions: hello@quadernio.com · Privacy Policy: https://quadernio.com/privacy

**Category:** Education · **Language:** English

**Graphics:**
- Store icon: `extension/icons/icon-128.png`
- Screenshots (1280×800): `docs/chrome-web-store/screenshot-1-choose-courses.png`,
  `docs/chrome-web-store/screenshot-2-synced.png`
- Small promo tile (440×280): `docs/chrome-web-store/promo-small-440x280.png`
- Marquee promo tile (1400×560): `docs/chrome-web-store/promo-marquee-1400x560.png`

All are 24-bit PNGs without transparency, as the store requires.

**Additional fields:** Official URL / homepage `https://quadernio.com` · Support URL: `mailto:hello@quadernio.com`
(or leave empty and use the contact email on the account).

## 3. Privacy practices tab

**Single purpose:**
> Import the student's own courses and assignments from Canvas or Blackboard into their Quadernio planner account.

**Permission justifications:**

| Permission | Justification to paste |
| --- | --- |
| `activeTab` | When the student clicks the extension on their Canvas or Blackboard page, it reads that one tab to find their courses and assignments. No access to any tab without that click. |
| `scripting` | Runs the reader in the Canvas or Blackboard tab the student chose (it calls the LMS's own API with the student's existing session), and marks Quadernio's own pages so the site can tell the extension is installed. |
| `storage` | Remembers, on this computer only, the Quadernio address, which courses the student chose, and whether automatic sync is on. |
| Host permission `https://quadernio.com/*` | Sends the imported courses and assignments to the student's Quadernio account and asks Quadernio who is logged in. Chrome includes the student's Quadernio login only because of this permission. |
| Optional host permission `https://*/*` | Never granted at install. Requested for one address at a time, only when the student turns on automatic sync for their school's Canvas or Blackboard (schools host these on their own domains, so the address can't be listed in advance). Turning automatic sync off removes it. |

**Remote code:** No, I am not using remote code. (All code is in the package; the
extension only exchanges JSON data with quadernio.com and the student's LMS.)

**Data usage:** check **Website content** only (course names, assignment titles, due dates
and submission status read from the student's LMS). Leave everything else unchecked:
the extension collects no personally identifiable information, authentication
credentials, location, web history or activity beyond that.

Then check all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- I do not use or transfer user data to determine creditworthiness or for lending purposes

**Privacy policy URL:** `https://quadernio.com/privacy`

## 4. Distribution tab

Visibility **Public** (or **Unlisted** for a quiet beta: only people with the link can
install it). Regions: all.

## 5. After uploading

The extension's id (32 letters) shows in the developer console as soon as the item is
created. In Vercel (Project → Settings → Environment Variables), add:

- `QUADERNIO_EXTENSION_IDS` = that id (only this extension may use a student's login)
- `NEXT_PUBLIC_EXTENSION_STORE_URL` = `https://chromewebstore.google.com/detail/<id>`
  (onboarding's "Add to Chrome" button)

then redeploy. Until the review passes, testers can load `extension/dist-store`
unpacked (`chrome://extensions` → Developer mode → Load unpacked); an unpacked copy has
a different id, so set `QUADERNIO_EXTENSION_IDS` only once everyone uses the store
version (or list both ids, comma-separated).
