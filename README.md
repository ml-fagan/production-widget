# Decor Production Feed

A live, installable desktop feed of the factory production schedule. Reads
**Production Schedule 2026 Current.xlsx** from SharePoint via Microsoft Graph
and renders it as a clean table: CRM, project, dispatch date, and lead time,
with stat cards, a filter box, dispatch/lead sort, and overdue flags.

Colleagues open a link, click **Install**, and get a desktop icon that opens a
live feed refreshing itself each morning (and every 15 minutes while open, and
whenever the window regains focus). No login for them — the app reads the file
with its own read-only service-principal access.

## How it works

- `lib/graph.js` — authenticates to Graph with the service principal (client
  credentials) and downloads the schedule file as bytes.
- `lib/parseSchedule.js` — parses the workbook into clean job rows. It finds
  columns by header text (survives column moves), reads both the MDF and the
  in-house fibre-cement blocks (FC jobs flagged), handles both dd/mm/yy and
  mm/dd/yyyy dates, and marks a job overdue when its committed date has passed
  with no actual-completion date.
- `app/api/schedule/route.js` — server route that reads fresh and returns JSON.
  Never cached.
- `app/page.js` — the branded UI (Lyphex warm off-white, Inter, green #408152,
  blue #004CFB). Auto-refreshes.
- `public/manifest.webmanifest` + icons — makes it installable as a desktop PWA.

The download-and-parse approach (rather than the live Excel workbook API) is
deliberate: app-only access to the workbook API is unreliable for files the app
doesn't own, whereas reading the driveItem content stream works cleanly under
`Sites.Selected`.

## One-time setup

1. **IT registers the app** (see `IT_REQUEST.md`). You receive three values:
   tenant ID, client ID, client secret.

2. **Deploy to Vercel** on a new subdomain, e.g. `production.lyphex.com`:
   - Push this folder to a GitHub repo (`ml-fagan/production-feed`).
   - Import it in Vercel, same team as your other Lyphex apps.
   - Add the subdomain under the project's Domains.

3. **Add environment variables** in Vercel (Project → Settings → Environment
   Variables), from `.env.example`:
   - `AZURE_TENANT_ID`
   - `AZURE_CLIENT_ID`
   - `AZURE_CLIENT_SECRET`
   - `FEED_PASSWORD` — the shared password staff type once to unlock.
   Paste the secret without surrounding quotes (same as the Firebase key).

4. **Redeploy.** Visit the subdomain. If the schedule loads, you're done.

## Local development

```bash
cp .env.example .env.local   # fill in the three Azure values
npm install
npm run dev                  # http://localhost:3000
```

Without credentials the page renders and shows a clear "couldn't load" message
from `/api/schedule` — useful for checking the UI before IT approval lands.

## If the file moves or is renamed

Edit `SITE_PATH` and `FILE_PATH` at the top of `lib/graph.js`. Nothing else.

## Notes

- The feed reflects the sheet as-is. If a job's committed/lead cells are blank,
  they show as "—".
- "Dispatch" = the committed completion date column, not actual dispatch.
## Password gate

The feed is locked to Decor Systems staff with a single shared password, set via
the `FEED_PASSWORD` env var. First visit shows a branded unlock screen; entering
the password sets a signed, HTTP-only cookie that lasts 30 days, so the team
types it once and the desktop app just opens after that.

- The password is checked server-side; it never ships to the browser. The cookie
  holds a signed marker, not the password.
- `middleware.js` protects every route (page + schedule API). Only the unlock
  screen, the login endpoint, and static assets are public.
- To change the password, update `FEED_PASSWORD` in Vercel and redeploy. Existing
  cookies stop validating immediately, so everyone re-enters the new one.
- If `FEED_PASSWORD` is left unset, the gate fails open (no lock) — so set it
  before sharing the link.
- This is a shared password, not per-person accounts: it controls access, not
  who's who. If you later want named logins, swap in the Decordigest
  Firebase-Google-auth gate.

You can also layer Vercel's own Password Protection on top (Pro plan) if you
prefer a platform-level wall as well.
