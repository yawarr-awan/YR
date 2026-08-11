# YR Wellness Dashboard — Project Context

## What this is
A personal, single-user wellness tracker. NOT related to AyahInk in any way.

- Repo: yawarr-awan/YR (public, personal GitHub account)
- Live app: https://yr-wellness.yawar-awan.workers.dev (Cloudflare Worker + D1, gated by
  Cloudflare Access restricted to one email) — this is now the canonical, private
  deployment and current source of truth.
- Retired: https://yawarr-awan.github.io/YR/ (GitHub Pages). It was the source of truth
  before the Worker went live, but static hosting has no server-side way to require
  sign-in, so it could never actually be made private. GitHub Pages has been disabled
  for this repo.

## Hard boundary — read this first
This project's infrastructure lives EXCLUSIVELY in the personal Cloudflare account
(Yawar.awan@gmail.com). It must NEVER touch the AyahInk Cloudflare account, which is
shared with a co-founder (Faisal). This is not a style preference — an earlier mistake
put this project's database in the AyahInk account by accident; it was caught, verified
empty, and deleted before any health data reached it. Do not repeat that. If anything
about a task implies AyahInk infrastructure, stop and ask.

## Architecture as it stands today

**index.html** — the entire frontend, one file, no build step, no dependencies.
- localStorage key: `yawarWellness_v1`, rolling backup: `yawarWellness_v1_bak`
- Durability hardening already in place: write verification via read-back, a
  corruption guard (`SAFE` flag that blocks writes if both the main key and the
  backup fail to parse, so a corrupt store is never silently overwritten with
  blank state), a visible "Saved HH:MM" tag, and `window.__YRdump()` as a console
  escape hatch. `schema: 1` field exists for future migrations.
- State shape: `{ schema, profile: {startWeight, targetWeight}, days: { "YYYY-MM-DD": {...} } }`
- **Not yet built**: any sync logic. The app is currently localStorage-only.

**worker.js** — Cloudflare Worker, deployed as `yr-wellness`.
- Serves the static app (via ASSETS binding) and handles `/api/*`
- `/api/health` — unauthenticated, returns `{ok, configured}`
- `/api/sync` (POST) and `/api/stats` (GET) — require a valid Cloudflare Access JWT
- JWT verification is done properly: RSA signature checked against Cloudflare's
  JWKS endpoint, plus `aud`, `iss`, `exp` checks. It does NOT trust the
  `Cf-Access-Authenticated-User-Email` header alone — that header is meaningless
  without signature verification, since the workers.dev URL could otherwise be
  hit directly bypassing Access.
- Sync logic is last-write-wins per day, keyed on a client-supplied `updated_at`.
  Delta pulls via a `since` timestamp. Bounded: 500 days per push, 1000 rows
  returned per pull, 20KB per day. All of this is tested against the live D1
  instance (stale writes rejected, newer writes applied, malformed input
  skipped without crashing).

**D1 database**: `yr-wellness-sync`, personal Cloudflare account, EU jurisdiction
(hard placement guarantee, not just a location hint — deliberate for health data).
Tables: `days(user_email, day, data, updated_at, deleted)`, `profile(user_email,
data, updated_at)`, `meta(k, v)`.

**wrangler.jsonc**: name `yr-wellness` (must match the Worker name in the
Cloudflare dashboard or Workers Builds fails), assets served from `./`, D1
binding `DB`. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker **secrets**, not
vars — `wrangler deploy` overwrites dashboard-set vars from the config file on
every deploy, so anything in `vars` would get wiped. Secrets persist.

**Cloudflare Access**: team domain `yawar-awan`. Both the production
(`yr-wellness.yawar-awan.workers.dev`) and preview (`*-yr-wellness...`) URLs are
set to Restricted, each with its own AUD tag. Non-production branch builds are
disabled, since this is single-branch and previews add public surface with no
benefit.

**Deploys**: Workers Builds is connected to `yawarr-awan/YR`. Every push to
`main` auto-deploys. This is git-based now — no manual dashboard edits needed
for code changes.

## Testing requirement — non-negotiable
A prior session broke production for ~6 minutes by editing `index.html` and
testing the change with a harness that supplied a missing variable itself. The
test passed because it silently patched over the exact bug it should have
caught. The fix: **always test by executing the actual file in a real DOM
(jsdom), with nothing injected.** Any change to index.html needs to pass, at
minimum: fresh browser (no localStorage), existing good data, corrupt main key
with good backup, BOTH corrupt (must not wipe data, must show an error, must
leave raw storage untouched), and storage writes blocked (quota/private mode).

## Git workflow
Commit to a feature branch and open a PR — still do this for every change, so
there's always a reviewable diff and a clean revert point. Do not push
directly to `main`. This project's only copy of real historical data is the
localStorage on Yawar's phone and laptop (exported backups exist on both) — a
broken direct commit to `main` is a worse failure mode here than in most
projects, because `main` is what auto-deploys.

**Merging (as of 2026-08-09, per Yawar):** once tests pass, merge the PR
directly — don't stop to ask for merge approval on each one. Report what
shipped after the fact instead. This applies to routine merges for work
Yawar asked for. It does NOT extend to genuinely risky or ambiguous calls —
e.g. anything touching the Cloudflare account/Access config, anything that
could affect the AyahInk boundary, or a change you're not confident is
correct — those still get flagged before acting, same as always.

## Known external issue
Claude Code's web repo picker has an open upstream bug where personal-account
GitHub repos don't index correctly (org repos work fine) —
anthropics/claude-code #57161, #18467, #27155, #57396, #60637. If a session
can't see this repo in the web picker, that's this bug, not a permissions
problem. The CLI run locally works around it since it uses git directly.

## Client-side sync layer — built (PR #1, merged)
Every day's record and the profile get `updated_at` on modification. A
one-time schema 1 → 2 migration stamps pre-existing days/profile and persists
immediately (not just in memory) so a corrupt-main-key recovery or a stale
migration can't silently sit unsaved. An opt-in "Enable cloud sync" toggle
lives in the Progress tab (off by default, never auto-enabled); when on, it
POSTs to `/api/sync` with `{since, days, profile}` and merges the response
with true last-write-wins. A failed/unreachable/erroring sync never touches
local state. Test coverage lives in `test/` (`npm test`, jsdom, real DOM,
nothing injected) — see CHANGELOG 1.2.0 for the full scenario list.

## Access + hosting — settled
`yr-wellness.yawar-awan.workers.dev` is the canonical, private deployment:
Cloudflare Access (team domain `yawar-awan`) restricts it to one email,
covering the whole site (static assets + `/api/*`), confirmed via the
Access application's "Manage policy" screen. The old public GitHub Pages
copy (`yawarr-awan.github.io/YR/`) has been retired and disabled, since
static hosting has no server-side way to require sign-in.

## Current data state
Yawar's full history (32 days + profile, as of the first real sync) has been
pushed from his primary device into D1 (`yr-wellness-sync`, EU jurisdiction)
via the sync toggle. Verified directly against the database: schema intact
(`days`/`profile`/`meta` tables), row counts match, `user_email` matches his
sign-in address. Any other device should enable sync too so it pulls this
same history down before it accumulates independent local-only entries.

## Today's Brief — Google Calendar + Gemini (built)
A card at the top of the Today tab shows an AI summary of the day, sourced
from Google Calendar only (deliberately **not** Gmail — see below) and
generated via the Gemini API.

**Why Calendar-only, no Gmail:** Google classifies `gmail.readonly` as a
*restricted* scope. An unverified ("Testing" mode) OAuth app gets refresh
tokens that expire every 7 days regardless of scope; to get indefinite
tokens for a *restricted* scope, the app must pass full Google verification
**including a CASA security assessment** — a multi-week process meant for
real multi-user products, wildly disproportionate for a single-user
dashboard. `calendar.readonly` is merely *sensitive*, not *restricted* —
still needs a verification review to leave Testing mode and get indefinite
tokens, but a much lighter one (no security audit). Yawar chose to build
native Google OAuth into the Worker but skip Gmail entirely for this reason.
Either way (Testing mode with periodic reconnects, or verified), the app
handles an expired/revoked token gracefully — surfaced in the UI as
`reconnect_required`, not a generic failure.

**Architecture:** everything lives in `worker.js`, no separate backend.
- `GET /api/google/connect` → redirects to Google's OAuth consent screen
  (`access_type=offline&prompt=consent`, scope = `calendar.readonly` +
  `calendar.events` (write, added for the task-scheduling feature below) +
  `tasks.readonly`). Still no Gmail. A connection made before the scope was
  expanded needs to reconnect once — surfaces as the same `reconnect_required`
  status as an expired token, no separate code path.
- `GET /api/google/callback` → exchanges the code for tokens, stores the
  refresh token in D1 keyed by the **Access-verified** email (never trusts
  anything Google's redirect claims about identity — same principle as
  `verifyAccess` elsewhere in this file).
- `getGoogleAccessToken()` → returns a cached access token if still valid,
  otherwise refreshes via Google's token endpoint. An `invalid_grant`
  response (revoked/expired refresh token) maps to `reconnect_required`,
  not a generic error.
- `generateBrief()` → refresh token → fetch today's Calendar events
  (bounds computed via `localDayBounds()`/`utcOffsetMinutes()`, which use
  `Intl.DateTimeFormat` to self-adjust across BST/GMT with no manual DST
  table) → summarize with Gemini (`gemini-flash-latest`, Google's
  self-updating alias so this doesn't need bumping as models rotate) →
  persist to D1. Every failure mode (`calendar_error`, `gemini_error`,
  `reconnect_required`, `not_connected`) is a distinct, persisted status,
  not a single generic "failed" — the whole point is the UI can say
  something precise.
- `GET /api/brief` reads the cached brief for today; `POST
  /api/brief/refresh` regenerates on demand (same `generateBrief()` path).
  A failed/unreachable brief never breaks the rest of the Today tab — it's
  an isolated card with its own error states, same durability philosophy
  as everything else in this file.
- A Cloudflare Cron Trigger (`wrangler.jsonc`, hourly) drives the daily
  refresh. The `scheduled()` handler itself only acts during the 7am
  Europe/London hour (computed fresh each run, so it tracks BST/GMT) and
  dedupes against D1 (skips a user already `ok` for today) — this keeps a
  once-a-day brief despite the hourly trigger, with no separate scheduler
  or timezone table to maintain.

**D1 additions:** `google_tokens(user_email PK, refresh_token, access_token,
access_token_expires_at, updated_at)`, `daily_brief(user_email, day,
summary, status, error, generated_at, PK(user_email, day))`. Created
directly against the live `yr-wellness-sync` database (additive DDL, no
existing data touched).

**Required Worker secrets** (dashboard, same place as the Access secrets):
`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY`. No tool
available to any Claude session can set Worker secrets — this has always
been, and remains, a manual dashboard step for Yawar.

**Testing:** `test/worker.test.js` loads the real `worker.js` via a `data:`
URL import (it's an ES module with no `"type": "module"` in package.json,
by choice — every other test file here is CommonJS and there was no reason
to disrupt that) against a fake D1 (`test/fakeD1.js`) and a mocked global
`fetch`. `test/brief.test.js` covers the Today-tab card's states in jsdom,
same rules as the rest of the suite.

## Calendar tab, live prayer times, task list, Dhikr, notifications — built
Built in response to feedback that the brief only read the primary calendar
and the app had no way to see the calendar itself, schedule things onto it,
or track prayer times/dhikr/reminders day-to-day.

- **Multi-calendar + Tasks brief enrichment:** `listCalendars()` fetches
  `calendarList` (all calendars the account can read, not just primary);
  `fetchEventsForRange()` fetches events across all of them, tagging each
  with its source calendar name/color, and skips a single unreachable
  calendar rather than failing the whole fetch. `fetchTodayTasks()` pulls
  Google Tasks due today and — deliberately, since it's a bonus enrichment
  rather than the critical path — never throws; a Tasks failure just means
  an empty task list in the brief, not a broken brief. `generateBrief()` now
  feeds both into the Gemini prompt.
- **Calendar tab:** `GET /api/calendar/events?date=YYYY-MM-DD` returns the
  raw (non-summarized) day agenda across all calendars via the same
  `listCalendars`/`fetchEventsForRange` path. The tab renders it with
  prev/today/date-pick navigation, color-coded per source calendar, with
  live prayer times overlaid as colored rows using the same colors as the
  Today-tab prayer clock.
- **Task list → real calendar events:** the Today tab has a local quick-add
  task list (title + optional due date). `POST /api/google/calendar/events`
  creates a real event on the primary calendar when a task is scheduled —
  this is why the OAuth scope above now includes write access. A `403` with
  an insufficient-permission body maps to `reconnect_required`, same
  pattern as the read path. **Tasks are local-only for now** — not part of
  the `/api/sync` payload (which only carries `days`/`profile`) — so a task
  list doesn't cross devices yet; this is a known, documented gap, not an
  oversight.
- **Live prayer times:** client-side only, no Worker involvement. An opt-in
  "Use my location" button (browser Geolocation) fetches
  `api.aladhan.com/v1/timings/{DD-MM-YYYY}` (method 3, Muslim World League)
  and caches the result in localStorage per day+location so it isn't
  re-fetched on every render. Colors are CSS custom properties
  (`--fajr`, `--sunrise`, etc.) shared between the Today-tab clock and the
  Calendar-tab overlay so they always match.
- **Dhikr tracker:** a plain per-day checklist (7 items × morning/
  afternoon/evening) stored in `days[day].dhikr`, same durability/migration
  treatment as every other per-day field.
- **In-app notifications — foreground only, by deliberate choice:** an
  opt-in button in the Progress tab requests the browser Notification
  permission; a 60-second interval then checks prayer times, dhikr-anchor
  times, and scheduled-task due times and fires a local `Notification` if
  due. There is no service-worker push subscription and no server-side
  notification dispatch — reminders only fire while the tab is open. If
  real push (closed-tab/background) delivery is ever wanted, that's a
  separate, bigger feature (VAPID keys, push subscriptions stored server-
  side, a Worker-side send path) — not attempted here.
- A jsdom test-suite gotcha worth remembering: the notification interval's
  `setInterval` runs inside every `loadApp()`-created jsdom window, and
  jsdom timers are real Node timers — if a test file never disposes of its
  window, timers accumulate across the whole `npm test` run and the process
  hangs instead of exiting. Every test file using `loadApp` now calls
  `window.close()` in an `after()` hook (`closeAllApps()` in `test/lib.js`)
  to prevent this.
- New Worker exports for testability: `listCalendars`,
  `fetchEventsForRange`, `fetchTodayTasks`, `handleGetCalendarEvents`,
  `handleCreateCalendarEvent`, `dayBoundsForDate`.
- Test coverage: `test/worker.test.js` extended for the above;
  `test/calendarTab.test.js`, `test/prayerTimes.test.js`,
  `test/tasks.test.js`, `test/dhikrNotify.test.js` added — see CHANGELOG
  1.5.0 for the full scenario list.

## Follow-up refinements after initial user feedback (1.6.0)
- The "Grant new permissions" link added to the Brief card in 1.5.1 (to
  work around an old refresh token silently keeping its original scope)
  was removed again once the user actually reconnected — it was a one-time
  fix, not meant to stay visible permanently.
- `generateBrief()`/`summarizeWithGemini()` now take the effective `now`
  and filter events to only those not yet ended (`e.end || e.start` >
  now) before building the Gemini prompt — a mid-day "Refresh" describes
  what's left, not the whole day again. The prompt also states the
  current London time and explicitly forbids a "Good morning"/"Good
  evening" greeting, since a refresh can happen at any hour.
- The Prayers (Salah) checklist on the Today tab (the plain done/not-done
  tracker, distinct from the live prayer clock) now colors each row to
  match that prayer (`PRAYER_COLOR_VAR`, same colors everywhere else) and
  shows the actual time next to the name once a location is saved —
  fetched via the same `fetchPrayerTimes()` used by the clock and
  Calendar tab.
- `fetchPrayerTimes()` gained an in-flight-request map keyed by cache key:
  the clock, the Today checklist, and the Calendar tab can all ask for the
  same day+location within the same tick, before the first request has
  written the cache — without dedup this fired one real Aladhan request
  per caller instead of one for all of them.
- **Calendar tab rebuilt** from a scrolling agenda list into a full
  24-hour, two-column day grid (00:00–11:59 / 12:00–23:59 side by side) —
  the whole day visible without scrolling. `calWindowsForDay()` splits the
  day into consecutive prayer-window segments covering all 1440 minutes
  with no gaps (including overnight — Isha's window correctly spans
  across midnight into the next Fajr), and every hour cell is tinted with
  its window's color. Events render inside their starting hour's cell.
  Swiping left/right on the grid (`attachCalSwipe()`, touchstart/touchend
  delta) pages to the next/previous day, same as the new "›" button
  (previously only "‹" existed). Opening the tab scrolls the current
  hour into view and marks it `.current-hour` automatically.

## Mobile-first shell rework (1.7.0)
Driven by feedback that the Today tab was one very long list and the app
felt built for a desktop.

- **Bottom icon nav + tab swiping.** `nav.tabs` is now `position:fixed` at
  the bottom of `<body>` (outside `header.top`), with `env(safe-area-inset-
  bottom)` padding so an installed iOS app clears the home indicator.
  `VIEWS` is the single source of truth for both the bar's order and the
  order `attachTabSwipe()` moves through; the Guide tab/view is gone.
- **A real bug this surfaced:** the delegated click handler matched
  `data-nav`/`data-recipe`/`data-exercise` on `ev.target` directly. Once
  tabs contained an `<i>` icon, tapping the icon — the obvious target on a
  phone — hit a child with no attribute and did nothing. It now resolves
  via `ev.target.closest("[data-...]")`. jsdom tests missed this entirely
  because `goTo()` dispatches straight at the button; it was only caught by
  rendering the page in real Chromium via Playwright. **Screenshot the app
  after any layout change** — the jsdom suite verifies behaviour, not that
  the thing you need to tap is actually tappable.
- **Collapsible cards.** `.card.collapsible[data-collapse="<key>"]` with the
  content in `.card-body`; `initCollapsibles()` wires the `h3` as the
  toggle. Folded state lives in its own `yawarCollapsed` localStorage key —
  **deliberately not in `state`**, so a display preference never rides the
  sync protocol or lands in the health record. A `.collapsed` class in the
  markup is the default until the user overrides it. Card headings carry a
  `.count` element kept current by `renderDayCounts()`.
- **Dhikr** renders as three `.subcard` collapsibles (one per period),
  folded by default, each with its own count.
- **Text scale**: `html{font-size:15px}` — one knob, since everything else
  is in rem. The date bar is `flex-wrap:nowrap` with an ellipsing label and
  `humanShort()` ("Sun 9 Aug", year only when it isn't the current one),
  because the full form wrapped to four lines at 390px.
- **Tasks**: adding takes a title only (`addTask(inputId)`); scheduling is
  per-row via a 📅 button that opens an inline `datetime-local` panel and
  then calls `scheduleTaskAt(task, iso, statusId)`. Today renders the first
  `TASK_TODAY_LIMIT` (3) with a "+N more" pointer; the Calendar tab renders
  the full list and has its own add box. Still local-only, still not in the
  `/api/sync` payload.
- **Calendar** is one 24-hour column (`#calHours`) inside `.cal-viewport`,
  which clips the slide. `calGoDay(delta, fromX)` animates in two halves of
  `CAL_ANIM_MS`: push the outgoing day off in the direction of travel, then
  swap the data and slide the new day in from the opposite edge.
  `attachCalSwipe()` tracks `touchmove` so the grid follows the finger and
  springs back if the drag falls short, and stops touch propagation so a
  calendar gesture never also triggers the page-level tab swipe. **Tests
  that page a day must wait out the animation** (~500ms) rather than a
  single microtask — `app.wait(ms)` in `test/lib.js`.
- **Made-up (qada) prayers** live on `state.profile.qada` (per prayer key),
  so they sync with the profile and pay down a running debt rather than
  editing any day's `prayers` record. `missedByPrayer()` computes the raw
  miss count; the summary subtracts qada from it. The stored value is
  clamped to the number actually missed — it's a repayment, not a free
  tally.
- Test coverage: `test/uiShell.test.js` (bottom nav, icon-tap regression,
  tab swipe, collapsibles + persistence + the "never enters synced state"
  guarantee, dhikr subcards) and `test/qada.test.js` added;
  `test/tasks.test.js` and `test/calendarTab.test.js` rewritten for the new
  models. See CHANGELOG 1.7.0.

## Week view, in-place task expansion, tab persistence (1.8.0)
- **Tasks stay on Today.** The "+N more" line is a button toggling
  `_tasksExpanded`, which expands the full list in place; the Calendar tab's
  task card is gone entirely (`renderTasks()` now drives one list). Ticking
  a task re-renders but keeps the expanded flag, so the list doesn't
  collapse under you.
- **Calendar is a Monday-start week grid.** `renderWeek()` builds one CSS
  grid: a 26px hour-label gutter track plus seven day tracks, laid out
  row-major (header row, then 24 hour rows × 7 days). The focused day's
  track is `minmax(0,2fr)` against `minmax(0,1fr)` for the rest — **the
  `minmax(0,…)` matters**: a bare `2fr`/`1fr` has an `auto` minimum, so a
  long event title would set the column width and skew the whole week
  instead of being clipped. `calCur` is the focused day (tap a heading to
  move it); today is separately flagged `is-today`. Paging is ±7 days via
  the same `calGoDay()` slide.
- **One ranged fetch per week.** `GET /api/calendar/events` gained an
  optional `end=YYYY-MM-DD`; `handleGetCalendarEvents` takes `timeMin` from
  `date` and `timeMax` from `end`, so `listCalendars()` runs once for the
  week instead of seven times. A missing/malformed/backwards `end` collapses
  to a single day, so the old single-day callers are unaffected. Client-side
  `eventDayKey()` buckets events into columns and deliberately uses an
  all-day event's bare `YYYY-MM-DD` string rather than parsing it as a Date
  (that reads as UTC midnight and lands on the wrong day in some zones).
- **Last tab is remembered** in `yawarLastTab` (localStorage, per device,
  same reasoning as the collapse prefs — not synced). `nav()` writes it;
  init replays it through `nav()` when it's a known view, so a stale value
  like the removed `guide` falls back to Today.
- Prayer times are fetched per day for the week; `fetchPrayerTimes()`'s
  per-day cache and in-flight dedup keep that to at most seven requests once.
- Test coverage: `test/calendarTab.test.js` rewritten for the week grid
  (column widths, day focus, per-day event/hour placement, week paging,
  no-task-card); `test/worker.test.js` gained range-param tests;
  `test/tasks.test.js` and `test/uiShell.test.js` extended. See CHANGELOG
  1.8.0.

## Calendar refinements after feedback (1.8.1)
- **Focus ratio** is `CAL_FOCUS_FR` (4), applied via `calGridCols(selIdx)`.
- **The week's DOM is built once** and kept in `_wkCells`/`_wkHeads`/
  `_wkEvents`/`_wkKeys`; `setCalFocus(idx)` only rewrites the column
  template, the two affected columns' cells and the heading classes. That is
  what lets `transition:grid-template-columns` on `.cal-week` actually
  animate — a full re-render would swap the elements out and kill it — and
  it means changing day costs no refetch.
- **`fillCell()`** renders a text chip in the focused column and a
  `.cal-bar` colour block in the narrow ones (30px can't hold text). Both
  carry the full detail in `title`.
- **Gesture split**: swipe = ±1 day *within* the week (`setCalFocus`);
  ‹ › = ±1 week (`calGoDay(±7)`, the full slide). A swipe past either edge
  falls through to `calGoDay(±1)` so the gesture never dead-ends, landing on
  the adjacent week's edge day.
- **Contrast** is a `--cal-tint` custom property (30% light / 34% dark) fed
  into the `color-mix()` that tints each hour cell — verified in Chromium
  that `color-mix()` accepts a var() percentage.
- The Today prayer card no longer has a `#prayerSlots` chip row; the names
  and times live on the checklist rows only. `renderPrayerClock()` now just
  maintains the location line, the countdown and the button label.

## Calendar as a day carousel + Tasks fixes (1.9.0)
- **The calendar is one day, full width.** `#calTrack` is a 300%-wide flex
  track holding `#calDayPrev`/`#calDayCur`/`#calDayNext`, sitting at
  `translateX(-33.3333%)`. Dragging sets `translateX(calc(-33.3333% + Npx))`
  so the neighbour is genuinely on screen while you swipe; release animates
  to `0%`/`-66.6667%`, then `calGoDay()` moves `calCur`, re-renders all three
  panels and re-centres with the transition off. **Nothing is fetched or
  rebuilt mid-animation** - that was the source of the stutter in 1.8.x,
  where the old implementation slid one panel out, swapped its data, then
  slid it back in.
- **`ensureCalWindow(centre)`** keeps a plus/minus 7-day window of events in
  `_calWin.byDay`, so a day change is a pure transform with no round trip.
  It refetches only when the day either side leaves the window, and guards
  against out-of-order responses with `_calReqId`.
- The arrows call `calJumpDays(+/-7)` (a re-render, not a slide - the track
  only holds adjacent days). `#calStrip` is the compact week strip.
- **Google Tasks were silently missing, for three separate reasons** - all
  worth remembering because each looked like "no tasks":
  1. `dueMin`/`dueMax` filtered server-side, which drops every **undated**
     task (most of them - Tasks stores `due` as a date, and it's optional)
     and every **overdue** one.
  2. `maxResults` defaults to **20** per list.
  3. Every failure returned `[]`. An unenabled Tasks API in the Cloud
     project - the same trap the Calendar API sprang earlier - was therefore
     invisible.
  `fetchTasks()` now pulls all open tasks, buckets them into
  `dueToday`/`overdue`/`undated`, and returns an `error` string that
  `generateBrief` persists into `daily_brief.error` **alongside a successful
  summary**; the UI shows it under the brief.
- **`listCalendars()` now passes `showHidden=true`** - a secondary/shared
  calendar unticked in the Google Calendar UI is "hidden" and was being
  excluded, so events on it never reached the brief.
- Test coverage: `test/calendarTab.test.js` rewritten for the carousel
  (three panels, single padded fetch, finger-tracked drag, spring-back,
  slide completion, week strip, week arrows); `test/worker.test.js` gained
  task-bucketing, no-due-date-filtering, error-reporting and
  prompt-contents tests. See CHANGELOG 1.9.0.

## Others tab + Progress rework (1.10.0)
- **`VIEWS` is now `["today","calendar","others","progress"]`** and
  `SUBVIEWS` (`plan`/`recipes`/`exercises`) lives inside `#view-others`.
  Sub-panels are `.subview` divs with `#sub-<name>` ids (the render targets
  `#planBox`/`#recipesBox`/`#exercisesBox`/`#exWeekBox` are unchanged, so
  the render functions did not move). `navSub()` mirrors `nav()` and stores
  `yawarLastSub`.
- The delegated click handler resolves `data-sub` the same way it resolves
  `data-nav`, via `closest()`.
- `attachTabSwipe()` steps through `SUBVIEWS` first while `currentView` is
  `"others"`, falling through to the next main tab only at the ends - same
  edge-fallthrough pattern used elsewhere.
- **Upgrade path:** a stored `yawarLastTab` of `plan`/`recipes`/`exercises`
  (they were top-level tabs before) is mapped to `others` + that sub-tab.
- **`dayCompletion(d)`** is the single definition of "how much of a day got
  done" (the same 18 items the ring counts); `updateRing()` now calls it, so
  the ring and the Progress chart cannot drift apart.
- `drawCompletionChart(keys)` replaced the per-day history table and sits
  directly under the weight chart. It plots every logged day (not a recent
  window), adds a 7-day rolling average once there are >= 7 days, and writes
  a summary line into `#completionNote` - which is what the tests assert on,
  since jsdom has no canvas.
- The per-prayer chip row is gone from `renderPraySummary()`; the qada card
  below is the only per-prayer breakdown, and it is editable.

## Sync fixes + Prayers/Settings tabs (1.11.0)
- **The `since` watermark was a real, silent data bug.** It was set from
  `resp.now` (the *server's* clock) but compared against `updated_at`
  stamped by each *device's* clock. Any skew meant `pushableDays()` skipped
  the device's own edits and the server's `updated_at > since` filter
  skipped another device's rows - while sync reported success. `runSync()`
  now pushes **every** day it holds (chunked at `SYNC_CHUNK`=400) and always
  pulls from `since: 0`; `state.sync.since` stays 0. The server's
  last-write-wins makes re-sending unchanged days a no-op. Don't reintroduce
  a client-clock watermark without a server-assigned sequence column.
- **Tasks moved to `state.profile.tasks`** (schema 2 -> 3) so they ride the
  profile blob that already syncs. Every task mutation must also stamp
  `state.profile.updated_at`, or the change won't push. Caveat: the profile
  is last-write-wins as a whole, so simultaneous task edits on two devices
  lose one side - acceptable for one user, same as the rest of the profile.
- **`medsList()`** replaces the old `MEDS` constant: the list lives on the
  synced profile and is editable in Settings. `dayTotalItems()` is therefore
  dynamic, so the completion percentage reflects the *current* routine.
- **`VIEWS` is now six**: today, prayers, calendar, others, progress,
  settings. Prayers holds the Salah checklist/times, Dhikr, prayer summary
  and qada; Settings holds sync, install, reminders, data, the medicine
  editor and the brief-prompt editor.
- **Editable brief prompt** lives server-side (`user_settings` table,
  created lazily with `CREATE TABLE IF NOT EXISTS` so no manual DDL was
  needed) behind `GET`/`PUT /api/settings/brief-prompt`. It replaces only
  the *instruction* half of the prompt - `summarizeWithGemini` always
  appends the event/task sections, so a custom prompt cannot detach the
  summary from real data. `getBriefPrompt` swallows errors and falls back to
  `DEFAULT_BRIEF_PROMPT` rather than blocking the brief.
- **Undated Google Tasks are excluded** from the brief now (they're a
  backlog, not today); `fetchTasks` returns `undatedCount` instead of a
  list, and the prompt mentions the count.

## Editable lists + calendar peek columns (1.12.0)
- `medsList()`, `extrasList()` and `dhikrItems(period)` all resolve from the
  synced profile with the hardcoded constants as fallback defaults. All the
  Settings editors go through `listEditorRow()` and `profileChanged()`
  (which stamps `profile.updated_at` - forget that and the edit never syncs).
- **Dhikr is per-period now** (`profile.dhikr = {morning:[], afternoon:[],
  evening:[]}`), so `renderDhikr`/`renderDayCounts` sum the three lists
  rather than multiplying one list by three. `dayTotalItems()` follows
  `extrasList().length`, so the completion percentage tracks the current
  routine.
- **Calendar peek columns**: `buildDayPanel()` now returns a `.cal-daygroup`
  of `buildDayColumn()` (the focused day) plus two `buildPeekColumn()`s for
  the next two days - a mini agenda each, tappable to jump. `ensureCalWindow`
  therefore needs `centre+3` loaded (the *next* panel's peeks reach that far).
- **The day column scrolls inside itself** (`--cal-h`, `.cal-hours{overflow-y:auto}`)
  rather than down the page. `position:sticky` was tried first and cannot
  work: the carousel viewport is `overflow:hidden`, which makes it the
  sticky container and it never scrolls.

## Calendar layout + prayer accuracy (1.13.0)
- The calendar's three columns (focused day + next two) are **one CSS grid**
  laid out row-major, so hours line up across them and the whole thing
  scrolls with the page. The earlier internal-scroll approach
  (`.cal-hours{overflow-y:auto}`) is gone.
- `.cal-sticky` pins the date bar + week strip. Its offset is `--hdr-h`,
  set from `header.top`'s measured `offsetHeight` by `syncHeaderHeight()`
  on init and resize - a hardcoded value is wrong because the header's
  ring/theme row wraps at phone width, roughly doubling its height.
- Prayer colours were re-picked for hue separation between the pairs that
  are adjacent in the grid: Isha->Fajr (violet vs indigo, also split by
  lightness) and Dhuhr->Asr (cyan vs green).
- **Calculation method** is `profile.prayerMethod` (synced), surfaced as a
  `<select>` next to the location button and included in the prayer-times
  cache key, so switching method refetches rather than serving stale times.
  Aladhan is still the provider: accuracy is governed by the method and
  coordinates, not by which service applies them.

## Prayer settings cog (1.13.1)
- The method `<select>` no longer sits inline on the card. `#prayerCogBtn`
  toggles `#prayerSettings`, which holds both the calculation method and a
  new **Asr school** selector (`profile.prayerSchool`, `0` standard / `1`
  Hanafi -> later Asr). `school` goes into the Aladhan request **and** into
  `prayerCacheKey()`, so a method/school change refetches instead of serving
  the previous combination's cached times. `applyPrayerSettingChange()` is
  the shared handler: stamp `profile.updated_at`, save, re-render the clock
  and Today, drop `_calWin` and re-render the calendar if it's showing.

## Choosing the calendar for a new event (1.22.0)
- `handleGetCalendarEvents` returns the `calendars` list it already fetches
  for `fetchEventsForRange`, so this costs **no extra Google call**. Deriving
  the list from the events instead would hide any calendar with nothing on it
  that week - exactly when you are most likely to be adding to it.
- Client: `_calWin.calendars`, `writableCalendars()` (accessRole
  writer/owner only - a read-only calendar is not a destination), and
  `defaultCalendarId()` = last used if still writable, else primary.
- The picker appears **only for a new event, and only when more than one
  calendar is writable**. An existing event says where it lives instead:
  moving between calendars is Google's `events.move`, a different call, and a
  select that silently did nothing would be worse than none.
- `profile.calendarId` remembers the choice (synced). `scheduleTaskAt()`
  uses the same default, so a scheduled task doesn't land somewhere else.

## Scheduling from the calendar + opening reminders (1.14.0)
- **Worker**: `listCalendars()` now carries `writable` (accessRole
  writer/owner), and `fetchEventsForRange()` carries `id`, `calendarId`,
  `writable` and `notes` - without those an event can't be addressed for
  editing. `POST /api/google/calendar/events` takes an optional
  `calendarId`/`location`; `PATCH` (edit) and `DELETE` (remove, by query
  params) were added on the same path. All three share
  `googleWriteFailure()`, which maps 403-insufficient to
  `reconnect_required` and 404 to `not_found`. PATCH sends **only** the
  fields present in the body, so a rename can't disturb the time.
- **Client**: `calDayEntries(dayKey)` is the single source of what belongs on
  a day - Google events plus `profile.tasks` with a `due` - merged on
  `calendarEventId` so a task and the event it created are one chip. Chips
  are buttons; an empty stretch of an hour cell opens `openCalSlot()`.
  `openCalEditor()` covers all three cases (new / event / task) and a
  read-only calendar disables its fields rather than offering a doomed Save.
- **`_calDragged`** exists because a swipe ends by firing a click on whatever
  was under the finger - without it, every page-the-day gesture also opened
  the editor. It's set in `touchmove` and cleared in a `setTimeout(...,0)`
  after `touchend`, i.e. after that click has been and gone.
- **`openingReminders()`** runs at init and on `visibilitychange` (an
  installed app is resumed, not reloaded). It nudges about
  `currentPrayerWindow()` if that prayer isn't ticked - before Fajr that's
  *yesterday's* Isha, checked against yesterday's record - and about due,
  timed, open tasks as one notification. All-day items are excluded on
  purpose: they aren't due at a moment, so they'd nag on every open.
  `notifyOnce` keys per prayer/day and per task+due, so re-opening inside
  the same window is silent.
- Test gotcha: prayer times in `test/openReminders.test.js` are built
  *relative to the real clock* rather than hardcoded, since the app reads
  the real `Date`. The pre-Fajr scenario can't exist after 23:00 and returns
  early there, which is stated in the test.

## Notification delivery — three real bugs (1.14.1)
Found by checking the whole path in real Chromium rather than only jsdom.
- **`new Notification()` is an illegal constructor on Chrome for Android** -
  it throws, and the old `try{}catch{}` swallowed it, so reminders were
  silently dead on that platform. `notifyOnce()` now prefers
  `navigator.serviceWorker.ready -> reg.showNotification()` (the supported
  path everywhere) and falls back to the constructor only when there's no
  registration.
- **Exact-minute matching dropped reminders.** `checkReminders` fired only
  when `minutesOfDay(time) === nowMins`; a throttled background tab can skip
  a minute entirely, so the reminder was never sent. Now `justPassed()` with
  `REMINDER_GRACE_MINS` (5) - `notifyOnce` still keeps it to one.
- **`notifyOnce` marked its key before checking permission**, so enabling
  reminders mid-session left every key it had already passed over
  suppressed. It now returns without marking, and `enableNotifications()`
  re-runs `openingReminders()` once permission lands.
- The on-open nudge also marks the interval's `prayer-<day>-<Name>` key, so
  opening just after a prayer began doesn't say it twice.
- **Testing note:** headless Chromium always reports
  `Notification.permission === "denied"` (even though
  `navigator.permissions.query` says granted), so a real-browser check has
  to stub `window.Notification` and wrap
  `ServiceWorkerRegistration.prototype.showNotification` to observe which
  path ran. `test/lib.js` gained `serviceWorkerNotifications` for the jsdom
  equivalent.

## Icon, name, Google Tasks on the calendar (1.15.0)
- **The app is "YR"** - `<title>`, header, manifest `name`/`short_name`.
- **Icons** are generated from the user's supplied artwork (a navy rounded
  tile with a gold YR). The source arrived as a flattened screenshot with a
  transparency *checkerboard baked in as real pixels*, so the pipeline was:
  crop to the tile, rebuild the background where the letters sat (per-row
  median of non-glyph pixels), recentre + scale the wordmark by 1.10, brighten
  the gold (HSV hue 0.115, V x1.30), then cut the silhouette by per-row
  extents of non-checkerboard pixels. The generation script is scratch-only -
  the committed PNGs are the artefact.
- `icons/icon-maskable-512.png` is a **separate** icon: the wordmark on a flat
  navy field at 60% width, because Android's circular crop would otherwise
  slice the tile's own rounded corners and the letters with them.
- The header badge is an inline base64 84px PNG (quantised to 64 colours,
  ~6KB) so a file-opened `index.html` still shows it.
- **Google Tasks now reach the Calendar tab**, not just the brief:
  `fetchTasksInRange()` in worker.js filters open dated tasks to the window
  **client-side on the date prefix**, not with `dueMin`/`dueMax` - those
  compare full timestamps to what is really a date, which is how tasks went
  missing from the brief once already. `handleGetCalendarEvents` returns
  `tasks`/`tasksError` beside `events`; a Tasks failure never costs the
  agenda but is surfaced in `#calStatus`.
- Client: entries of `kind:"gtask"` are read-only (the OAuth scope is
  `tasks.readonly`, so there is nothing to save back) and always all-day.
- **Both columns draw an event to its length** (peek 1.21.2, focused
  1.23.0), through the shared `placeByTime()`. **The maths is in `--cal-row`
  units, not percentages**: a percentage resolves against the cell's content
  box, which is a border and two paddings shorter than the row, so a
  four-hour event came out three rows tall. A chip inside `.cal-hour-events`
  passes `inset:true` to cancel that box's top padding; a peek chip is
  positioned against the cell and doesn't. Chips are `overflow:hidden` and
  never grow to fit their text - a chip that stretched would be lying about
  when the event ends.
- **`[hidden]{display:none!important}` is load-bearing** (1.23.0). `hidden`
  is only the UA stylesheet's `display:none`, so any author rule with a
  display beats it - `.row2` is a flex row, and the all-day toggle appeared
  to do nothing in Chromium while passing in jsdom, which reads the property
  rather than the cascade. Don't remove it.
- **All-day creation** (1.23.0): the client sends `allDay:true` + a local
  `day`, never an instant - deriving a date from an instant lands on the
  wrong side of midnight in some zones. The Worker sends Google
  `{start:{date}, end:{date}}` with an **exclusive** end (`nextDay()`), which
  is a day out if you forget.
- (superseded) **Peek-column chips are drawn to the event's length** (1.21.2).
  `calMini(x, place)` takes `{hour, index, of}` and sets `top` from the
  start's minute-within-the-hour and `height` from `calEntryDuration()`, both
  as a percentage of one hour. A long event therefore overflows its cell on
  purpose, which is why `.cal-cell:not(.is-main):not(.cal-allday)` stops
  clipping and `.cal-mini.is-timed` carries a `z-index` - later cells'
  backgrounds paint after it otherwise. `index`/`of` share the width so two
  things in one hour don't stack. All-day minis pass no `place` and stay
  static: there is no time to place them by. Percentages resolve against the
  cell's padding box, so the height runs ~1px short per hour against the grid
  row - visible only if you measure it.
- **All-day items have their own grid row** under the headings
  (`.cal-allday`), rather than bucketing into hour 0 - the top of a 24-hour
  grid is exactly where nobody scrolls. Tests that mean "hour cells" must
  select `.cal-cell.is-main:not(.cal-allday)`.
- The palette was briefly changed to navy/gold to match the icon and the user
  asked for the original back; it is reverted byte-for-byte. Don't re-theme
  without being asked.

## Identity, Google Tasks writes, notification centre (1.16.0)
- **Why the rename/re-icon appeared to do nothing** (and reinstalling didn't
  help): `sw.js` had no `skipWaiting`/`clients.claim`, so a new worker stayed
  in *waiting* while the old one kept control - uninstalling a PWA does not
  unregister its service worker or clear Cache Storage. Compounded by
  cache-first shell serving, the old manifest name and icons were what the
  device saw. Fixed with skipWaiting + claim **and** network-first for the
  shell (cache is for offline, not speed). If identity ever looks stale
  again, look here first, not at the manifest.
- **Logo** (superseded in 1.16.1): the monoline SVG monogram was replaced by
  the user's own artwork - see the 1.16.1 note below.
- **OAuth scope widened** `tasks.readonly` -> `tasks`. Google keeps issuing
  the old refresh token with its original scopes, so **an existing connection
  must re-consent once**; that surfaces as the usual `reconnect_required`.
- `isDateOnlyDue()` is how a dated Google Task is told from a timed one:
  Google spells date-only as exact midnight UTC. Truncating `due` to its date
  prefix is what made a 1pm task render all-day - don't reintroduce it.
- `PATCH /api/google/tasks` completes/reopens a task. Reopening must send
  `completed: null` as well as `status: "needsAction"`, or Google's own UI
  keeps it hidden.
- **The bell** (`yawarNotifs`, its own localStorage key - never in `state`,
  same reasoning as the collapse prefs) logs every reminder regardless of
  notification permission. `notifyOnce` therefore keeps *two* marks:
  `_loggedKeys` (bell) and `_notifiedKeys` (OS). `checkReminders` and
  `openingReminders` are no longer gated on permission at all - only delivery
  is.
- **Resume**: `visibilitychange` + `pageshow(persisted)` call `onResume()`,
  which clears the `open-*` marks when away >= `RESUME_FRESH_MS` (60s) so the
  nudges can speak again. Without that, an installed app that is resumed
  rather than reloaded stayed silent forever after the first open.
- The theme toggle now lives in Settings -> Appearance; the header holds the
  bell in its place.

## Logo from supplied artwork (1.16.1)
- The icon is the user's own mark: a rounded white tile with black YR,
  supplied as a flattened screenshot with a transparency checkerboard baked
  in. Pipeline: crop the tile, fit a **rounded-rect** mask (the artwork is
  one, so a fitted shape gives cleaner corners than any per-pixel cut) inset
  ~60px to trim the baked drop shadow, then recolour by luminance - lum >=240
  is the white field, <=25 is the glyph, and the ramp between is its own
  antialiasing, so the letters keep their edges exactly.
- **Black letters on navy are unreadable**, so the letters were inverted to
  white. That was a necessary consequence of "make the background navy", not
  a free choice - three options were shown first and the user picked white.
- Detecting the tile in the source needs care: the checkerboard's *white*
  squares are the same colour as the tile, so bounds come from blurring wider
  than the checker period (GaussianBlur 28) and thresholding for white. A
  naive per-row scan includes checker squares and clips the corners.
- `icons/logo.svg` is gone - there is no vector source for this mark, and a
  stale one would be a lie about where the icons come from. The PNGs are the
  artefact.

## Peek columns, header, Google settings (1.17.0)
- The slot-tap handler is attached to **every** hour cell, not just
  `is-main` ones, so the two peek columns schedule onto their own day. It
  skips `.cal-chip,.cal-mini` so tapping an entry still opens that entry.
- The header is now badge + ring + saved tag + bell only (`flex-wrap:nowrap`);
  `.brand-title`/`.brand-sub` are gone. That shortens the header, which
  `syncHeaderHeight()` already measures, so `--hdr-h` follows on its own.
- `renderGoogleSettings()` is driven by the **same `/api/brief` response** as
  the Today card, so the two can never disagree about connection state.
- **Google Tasks time of day is not available.** The Tasks API documents
  `due` as recording the date only; a task set for 1pm arrives as midnight
  UTC, which is why `isDateOnlyDue()` correctly calls it all-day. This was
  reported as a bug twice - it is an API limitation, not ours. The task
  detail now says so, with the raw value Google sent in the element's
  `title`. Don't "fix" it by inventing a time.
  **Re-checked 2026-08-11** at Yawar's request: still true, and there is no
  way round it. `due` remains date-only (issue tracker 128979662 is the
  long-standing request for a time), and the timed copy that Google
  Calendar's UI shows lives on a "Tasks" calendar the **Calendar API does not
  expose** - it isn't in `calendarList` and can't be queried for events. So
  neither API can reach the time. Don't spend another session looking.

## Header colour (1.17.1 -> 1.17.2)
- 1.17.1 made the header a white band with its own `--hdr-*` palette; the
  user rejected it. The header is now `var(--bg)` - the same surface as the
  page - so it needs no palette of its own, and the `--hdr-*` tokens are
  gone. Don't reintroduce a separate header colour without being asked.
- Android takes the status bar colour from `<meta name="theme-color">`.
  `applyThemeColor()` rewrites that tag from the computed `--bg` whenever the
  theme changes, so the status bar tracks the theme instead of being pinned
  to one value. `THEME_BG` is only a fallback for engines that don't expose
  custom properties to `getComputedStyle`.
- The manifest's `theme_color`/`background_color` are the dark navy. An
  installed copy may keep the previous colour until Chrome re-reads the
  manifest.
- The Today "Notes for the day" card was removed on request. The `notes`
  field stays in every day record and in `blankDay()` - dropping it would
  destroy what was already written and break round-tripping of old exports.

## Two-day brief, list format (1.18.0)
- `generateBrief` fetches **today and tomorrow in one ranged call**
  (`timeMin` = today's start, `timeMax` = tomorrow's end) and splits the
  result with `localDayOf()`; listing the calendars twice for consecutive
  days would be waste. Today is still filtered to what has not ended;
  tomorrow never is.
- `fetchTasks(token, day, tomorrow)` gained a `dueTomorrow` bucket. Anything
  further out is still excluded - the brief covers two days.
- `nextDay()` does the date arithmetic in UTC so no DST shift can move it,
  and `localDayOf()` returns an all-day item's bare date untouched (parsing
  one as a Date reads UTC midnight and can land on the wrong day).
- `DEFAULT_BRIEF_PROMPT` now asks for a **bulleted Today/Tomorrow list with
  no prose**, and the client renders it with `renderBriefBody()`: a short
  line with no terminal punctuation is a heading, `- `/`* `/`• ` lines group
  into a `<ul>`, anything else is a paragraph. That last branch is what keeps
  the status messages ("Connect your Google Calendar…") rendering sensibly.
- **A saved custom prompt still overrides the default**, so changing
  `DEFAULT_BRIEF_PROMPT` does nothing for a user who has one stored in
  `user_settings`; they have to Reset in Settings.

## Prayer times via the Worker + the spiral clock (1.19.0)

**Provider moved behind the Worker.** The client no longer calls Aladhan (or
anything else) directly. `GET /api/prayer` and `GET /api/prayer/month` (both
behind Access) try **UmmahAPI** first and fall back to **Aladhan**
automatically, returning `{source, ..., timings|days, warning?}`.

- **The response normaliser is deliberately shape-tolerant.** UmmahAPI's
  contract could not be verified from the build sandbox - its domain is
  blocked by the egress proxy, `curl` gets a 403 CONNECT and WebFetch is
  `EGRESS_BLOCKED` - so rather than guess, `findTimings()` walks the payload
  for anything that looks like a timings object (`PRAYER_ALIASES` +
  `norm()`), needing **≥4 of the 6** names to accept it. `toHHMM()` handles
  ISO strings (read textually, never parsed as a Date), 12-hour am/pm and
  Aladhan's `"(BST)"` suffix. When nothing parses, `describeShape()` reports
  the payload's **real keys** in the error - a diagnostic, not a shrug.
- **`dayTimings()` exists because `findTimings()` is recursive.** A month
  payload is a map of 30 days; the recursive search matched its *first day*
  and folded the whole month into one entry. The month path therefore only
  accepts a child *named* like timings (`TIMINGS_CHILD_KEYS`).
- **`readCoords()` rejects null/"" explicitly.** `Number(null) === 0`, so a
  missing `lat`/`lng` read as the Gulf of Guinea instead of a 400.
- **This risk was real, and is fixed (1.20.3).** `method` used to be
  forwarded to UmmahAPI as the *Aladhan* number, because that is what the
  client stores. UmmahAPI names its methods (`MuslimWorldLeague`,
  `UmmAlQura`, …) and spells the Asr rules `Hanafi`/`Shafi`. A number where a
  name is expected is **ignored, not rejected**, so the provider silently
  used its own default - Muslim World League - which happens to be Aladhan's
  method 3. The default therefore looked correct and every other method
  returned MWL times under the wrong name, with no fallback and no warning.
  `UMMAH_METHODS`/`ummahMethod()`/`ummahMadhab()` now translate, and a method
  with no equivalent (Jafari 0, Gulf 8, France 12, Russia 14) **skips the
  provider entirely** so Aladhan - which defined those numbers - answers
  instead. Falling back is a correct answer; asking for a method the provider
  doesn't know is a wrong one that looks right. **Don't "simplify" this back
  into passing the number through.**
- **UmmahAPI is adhan-js underneath**, which is how the name table was
  settled (1.20.4): the names are adhan's `CalculationMethod` keys, and its
  `methodAdjustments` explain differences between apps exactly -
  `MoonsightingCommittee` is `{dhuhr:+5, maghrib:+3}` against
  `MuslimWorldLeague`'s `{dhuhr:+1}`, which is precisely what two apps on
  those two methods disagreed by when compared side by side. Reach for
  `npm pack adhan` and read `lib/cjs/CalculationMethod.js` before theorising
  about a timing difference; it is usually the method, not a bug.
- **The client's method labels follow the provider's names, not Aladhan's**
  ("Moonsighting Committee", not Aladhan's "Moonsighting Committee
  Worldwide"). The whole point of the list is being able to match the
  convention another app is on, so the label has to be the one they see. The
  stored value is still Aladhan's number, which addresses both providers.
- **The modal names the answering provider and the convention it used**
  (`#pmSource`, from the response's `source`/`method`/`madhab`). A primary/fallback pair works either way by design, which also
  means nothing on screen would otherwise reveal that the primary had never
  once succeeded. Keep it.
- UmmahAPI's domain is still blocked by this sandbox's egress proxy
  (`curl` gets a 403 CONNECT, WebFetch is `EGRESS_BLOCKED`), so the endpoint
  has never been exercised for real from here - the contract above comes from
  its public docs via WebSearch. The `source` line in the modal is how to
  check it on a device that can reach it.

**Client caching.** `prayerCacheKey()` is
`day|lat(2dp)|lon(2dp)|method|madhab`, TTL 30 min. **Nothing wipes the cache
on a method/madhab change** - the key already carries both, so an old answer
can never be served for a new combination and switching back is free.
`clearPrayerCache()` is kept for resetting the *location*, where the key
alone is not enough (it rounds coordinates). `ensurePrayerMonth()` pulls a
whole month (24 h TTL) and `fetchPrayerTimes()` consults it before going to
the network; the calendar needs five days at a time and pages through many
more, so this is one request instead of five plus one per page. It is
**strictly an accelerator** - a failed month resolves to null and the per-day
path takes over.

**The spiral clock is gone (removed in 1.20.0).** It was a genuine spiral -
one turn for the whole day, angle for time and radius for how far through it
you were - and it worked, but the user asked for the countdown without the
dial. The lessons are recorded here because they apply to any radial
rendering, not because the code still exists: the radial drop had to clear an
arc's width **twice over** or the last hour painted over the first at the
seam; **arcs, then pips, then hands** (drawing each window's pip beside its
own arc let the *next* window's arc paint over it); and **names could not go
on the dial at all** - horizontal text at a radial offset collides with the
band at the left and right and runs off the viewBox, and text curved along
the path reads upside down across the bottom half.

**What the times modal is now** (1.20.0): `prayerNowLine()` at the top -
window, span, time left - then `#pmSlots`, then method/madhab/location/
colours. It reticks every `PC_TICK_MS` (5s) and the tick **updates only what
moves** (the countdown text and which row carries `.is-now`); a full rebuild
would close the colour menu out from under a tap.

**One row shape for a prayer everywhere** (`.prow` / `.pslot`): colour bar,
name, the window's start and end, and `.is-now` for the window you are in.
Used by the modal's list, the Prayers checklist and the qada card.
- `markCurrentPrayerRows()` is called from the **chip tick**, not only from
  the render, so crossing a prayer boundary with the tab open moves the ring
  instead of leaving it on the prayer that just ended. It reads `#prayBox`'s
  `data-day` so it can tell it is looking at today without re-deriving it.
- The calendar legend uses `PRAYER_SHORT`, so it says **Chasht**, not
  "Sunrise" (1.21.2) - it was the last place naming that window after the
  astronomical event rather than the prayer window.
- The **calendar deliberately has no ring around the current window**
  (removed 1.21.1 - it existed for one version). The tint already says which
  window every minute belongs to, so an outline on top of it was noise.
  `current-hour` keeps its own `outline` - that marks the hour it is now, not
  a prayer, and is a different thing.
- **Hour cells are tinted to the minute** (1.21.0). `hourWindowParts()`
  returns every window overlapping an hour as percentages down the cell and
  `calCellBackground()` turns two or more of them into a `linear-gradient`
  with **hard stops** - a soft blend would put the apparent boundary
  somewhere the prayer doesn't start. One window over the whole hour stays a
  flat colour rather than a pointless gradient. The old midpoint test
  (`hourWindowName`, now gone) moved a boundary by up to half an hour, and by
  a different amount each day as the times drifted. (The ring that once used the same
  overlap test is gone; the tint is the only prayer marker here now.)
- The Fajr row ends at **sunrise**, not at Dhuhr - the stretch between is its
  own window (Chasht). Between the two, no checklist row is ringed, because
  Chasht isn't one of the five.

**Every Settings card is collapsible** (1.21.1) - Google, Cloud sync,
Install, Appearance, Reminders and Your data joined the four editors that
already were. A card only folds if its content sits in a `.card-body`;
`initCollapsibles()` needs both that and a `data-collapse` key. None of them
were given `.collapsed` in the markup, so nothing the user could already see
disappeared - they fold it themselves and `yawarCollapsed` remembers.

**The Prayers card is only `#prayBox`** (1.20.1). The location line, the
countdown, a second chip, the location button and the settings cog were all
removed from it - each one already existed behind the header chip, so the
card said the same thing three times. `renderPrayerClock()` and
`renderMethodSelect()` are gone with the elements they maintained;
`requestPrayerLocation()` reports progress and failures through
`prayerLocStatus()` into `#pmLocText`. **The chip must never hide itself**:
it is the only route to the modal, and the modal is where a location gets
set - with no times it renders as an `.is-idle` "Prayer times" instead.

**All clock times are 12-hour** (1.20.5), through `fmtHM(h,m)` -> "1:09 PM"
and `fmtHour(h)` -> "1 PM" for the calendar's narrow hour gutter. `fmtMin()`
(minutes of day) and `fmtClock()` (a timestamp) both go through `fmtHM`, and
every display site routes through one of the three. This is **display only**:
times are still held and compared as minutes of the day, and both prayer
providers still speak 24-hour - don't "convert" a fixture or an API value.
Watch midnight and noon, where a naive `h%12` prints `0:00`.

**The calendar paints before the network** (1.21.0). It used to await
`ensureCalWindow` (Google events), then `ensurePrayerMonth`, then five
`fetchPrayerTimes` calls, before drawing anything - three serialised round
trips, ~3.9s to first paint on a slow connection. `renderCalPanels()` now
calls `paintCalPanels()` immediately with `cachedTimesFor()` (synchronous:
the per-day cache, then the month cache), and only repaints if the fetches
**gain** a day it didn't already have - a repaint tears the panels down and
would interrupt a swipe. `renderCalendarTab()` paints once before awaiting
the events too. Measured in Chromium with every response delayed 1200ms:
3901ms -> 111ms. **Don't put an await back in front of the first paint.**

**Header** (1.20.0): logo (deliberately larger than the 40px controls), a
spacer, the prayer chip, the completion square, the bell. The completion
indicator is a rounded square, not a circle - same size and radius as the
bell so they read as a pair. The `Saved HH:MM` tag is gone; `showSaved()`
now refreshes the **Settings -> Sync** status line instead, which reports the
last local save whether or not cloud sync is on. That line is the only
confirmation a write landed, so don't drop it from `updateSyncUI()`.

**Settings.** `profile.prayerMadhab` (4 schools) and `profile.prayerSchool`
(0/1) are **one setting with two faces** - the cog's `<select>` and the
modal's four buttons both write both, via `setPrayerMadhab()`.
`profile.prayerColors` is a per-prayer hex map. Both ride the synced profile.
(`profile.prayerDayStart` was written by the dial's day-start toggle and is
ignored since 1.20.0 - harmless in an existing profile.)

**Reverse geocoding** is client-side and best-effort: BigDataCloud's keyless
`reverse-geocode-client` endpoint (CORS-enabled, no key), stored as
`prayerLoc.name`. It runs *after* the location is saved and rendered, so it
can never delay the times, and the coordinates are a valid label on their own.

Test coverage: `test/prayerClock.test.js` (chips, the modal's countdown and
list, the ring following the clock, madhab, colours reaching the checklist
and qada card, location reset, the failure backoff, the tick not outliving
the modal); `test/prayerTimes.test.js` for the checklist rows and the month
endpoint; `test/calendarTab.test.js` for the current-window ring;
`test/worker.test.js` for both endpoints. See CHANGELOG 1.19.0 and 1.20.0.

## Honest caveat
The "Client-side sync layer," "Access + hosting," and "Current data state"
sections above were re-verified live in this session (2026-08-09): read
worker.js/wrangler.jsonc directly, confirmed the deployed Worker code matches
the repo byte-for-byte, queried the D1 schema and row counts directly, and
checked the Access application's policy screen. Everything above that point
matched. Earlier sections of this file predate that verification pass — if
something here seems off, re-check the live repo/dashboard/D1 before trusting
it, the same way this pass did.
