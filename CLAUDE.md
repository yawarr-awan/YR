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

## Repeating events (1.47.0)
- **The client sends a structured repeat, never an RRULE.** `buildRecurrenceRule
  (rec, allDay)` in worker.js turns `{freq, interval?, byDay?, count?, until?}`
  into the one RRULE line. A rule is interpolated into what Google stores and
  re-serves, so it is validated where the checks cannot be skipped - a raw
  string is rejected outright (`must be an object`). Validation runs **before**
  the token fetch, so a bad repeat is a 400 naming the problem rather than
  whatever Google says about a rule we should never have sent.
- **Two RFC 5545 rules that are easy to get wrong and hard to notice:**
  - **`UNTIL` must be the same value type as `DTSTART`.** A timed event's
    DTSTART is a DATE-TIME, so UNTIL is `20261231T235959Z` (UTC); an all-day
    event's is a DATE, so UNTIL is a bare `20261231` with no time at all.
    Mixing them gives a series that either runs forever or stops immediately.
    `allDay` is a parameter of the builder for exactly this reason.
  - **COUNT and UNTIL are mutually exclusive.** Both set is an error here, not
    a guess about which wins.
- `BYDAY` is **weekly-only** (rejected on the other frequencies, and the client
  hides the picker to match) and is emitted in **week order**, not tap order -
  the rule is stored and re-read, and `MO,WE,FR` should read as a schedule.
  `INTERVAL=1` is the spec default and is left out.
- **Repeat is offered on create only.** `fetchEventsForRange` asks for
  `singleEvents`, so **every event the client holds is an instance** - a repeat
  control on an existing one would silently rewrite one occurrence. The event
  now carries `recurringEventId` and the editor says which it is. Same call as
  "moving between calendars is `events.move`, so don't offer a select".
- The presets are relabelled from the chosen date (`refresh()`), wired to both
  the `datetime-local` and the all-day `date` input - otherwise "Weekly on Tue"
  survives a change of start and describes the wrong day.
- **`calApi` resolves a 400 instead of throwing it.** It threw on every non-ok
  status, so the Worker's own "here is what is wrong" body was discarded and
  the user was told to try again later - advice for something that would fail
  identically forever. 400 resolves and the caller reads `error`; everything
  else still throws.
- Test note: `test/calendarEdit.test.js` reaches the hidden panels through
  `.closest(".field").parentNode`, since the wrapper is what carries `hidden`.

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

## Rotation: say nothing at all (1.25.5, supersedes 1.24.1 below)
**`orientation: "any"` is not "no opinion" - it is an opinion.** A WebAPK
translates the manifest's orientation into an Android activity orientation,
and `any` becomes a **sensor** mode that follows the accelerometer *even when
the phone's own rotation lock is on*. That is what the user reported after
1.24.1. `screen.orientation.unlock()` at startup was the same mistake in
JavaScript: asking to be unlocked is still asking for something.

Both are removed. The manifest declares **no `orientation` key**, which leaves
the activity unspecified - the only value that defers to the system setting -
and nothing in `index.html` touches `screen.orientation`. `test/sw.test.js`
asserts the key is absent and `test/uiShell.test.js` asserts neither `lock()`
nor `unlock()` is ever called. **Don't "fix" rotation by adding either back.**
The WebAPK rebuild caveat below still applies to any manifest change.

## Rotation on an installed Android copy (1.24.1)
Same family as the stale name/icon bug above, and worth knowing before
"fixing" it again. An installed Android PWA is a **WebAPK**, and its
orientation is an Android activity property decided at install time.
Changing `orientation` in the manifest does not reach an installed copy
until Chrome rebuilds the WebAPK: it notices `ORIENTATION_DIFFERS`, then
waits for **every window of the app to be closed, the device charging and on
Wi-Fi**. A day or two is normal.

- (Both of this version's mechanisms were **reverted in 1.25.5** - see above.
  `"orientation": "any"` and `screen.orientation.unlock()` between them made
  the app rotate regardless of the phone's rotation lock.)
- **The reliable fix for a user is reinstalling**, which rebuilds the WebAPK
  immediately. Don't go looking for a CSS or layout cause first.

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

## Rearranging the cards (1.24.0)
- **Every rearrangeable view is one `> .grid` of `.card[data-card]`.** That
  is the whole precondition, and it is why Today's date bar moved above the
  Brief (so brief/tasks could join the grid), why the prayer summary and qada
  moved into the prayers grid, and why Settings and Progress got a grid at
  all. A card outside its view's grid can never be reordered - `layout.test.js`
  asserts there are none.
- `LAYOUT_VIEWS` is the four that qualify. **Calendar and Others cannot join**:
  one is a grid of hours, the other three sub-panels. Neither is a list of
  cards.
- `data-card` is the key, separate from `data-collapse` - Progress's cards
  are movable but not collapsible. Where a card sits and whether it is folded
  are both keyed on the card, so a card keeps its fold state when it changes
  tab.
- **`applyLayout()` only places keys it recognises**; a card the stored order
  has never heard of keeps its markup position rather than disappearing.
  That is what makes it safe to add a card in a later version.
- Storage is `yawarLayout` (its own key, per device) - same reasoning as
  `yawarCollapsed`. **Don't move it onto the synced profile**: where a card
  sits is a display preference and has no business in a health record.
- Dragging is **pointer events, not HTML5 drag-and-drop**, which does not
  fire on touch at all - the same gesture has to work on the phone and in a
  desktop window. The card is not moved during the drag; only the card under
  the pointer is outlined, and the drop lands before or after it depending on
  which half was released over.

## Filling the desktop (1.24.2)
- **The card views are a column flow, not a grid** (`.cards{display:block;
  columns:N}` with `.cards>.card{break-inside:avoid}`). A grid row is as tall
  as its tallest card, so a short card left a hole beneath it that nothing
  could fill - and these cards vary enormously in height. Columns pack each
  card directly under the previous one in the same column instead.
  Breakpoints: 2 at 721px, 3 at 1100px, 4 at 1560px.
- The four views keep `class="grid cards"` so `LAYOUT_VIEWS`/`applyLayout()`
  still find `> .grid` - **the layout editor's precondition is unchanged**,
  and reordering still works because column flow follows DOM order. The inner
  `.grid` inside the "Your targets" card is deliberately *not* `.cards`: it is
  a two-field form, not a list of cards.
- `.wrap` and `.top-inner` are `max-width:1480px` (was 1024). The header has
  to match the page or the logo and bell sit inboard of the cards.
- **UI scale** is `yawarScale` (its own localStorage key - same reasoning as
  `yawarCollapsed`/`yawarLayout`, never synced, never in the health record).
  `SCALES` is five steps 13-21px and `applyScale()` writes
  `documentElement.style.fontSize`; **everything else in the app is in rem**,
  which is what makes one knob enough. It also re-runs `syncHeaderHeight()`,
  because `--hdr-h` is a *measured* value and the header grows with the text.
  `applyScale(currentScale())` runs at load, before first paint.

## Icon rasterisation + task order (1.24.3)
- **The icons are traced, not resampled.** The 1.16.1 pass downsampled the
  4306px master directly, so the PNGs carried the artwork's own soft
  antialiasing (a ~3px edge ramp at 512) and an alpha channel that had been
  hard-thresholded (`0,3,0,63,255` across an edge - noise, not a ramp).
  Now the tile is drawn analytically and the glyph is potrace'd from the
  master, both rasterised at 8x and box-filtered down: the ramp is a clean
  `0,128,255`. Shape unchanged - the new 512 disagrees with the old on 1.3%
  of the tile mask and 3% of the glyph, all of it sub-pixel.
- **The generator is scratch-only**, like its predecessors; the PNGs are the
  artefact. Three traps it had to handle, worth knowing before rerunning it:
  the master has the transparency **checkerboard baked in as real pixels**
  and its white squares are the same value as the tile, so the tile edge is
  found by run length (the checker squares are ~110px; a real edge is the
  first white run that lasts 300px). `potrace.Bitmap()` **thresholds a
  non-bool array at 127 and then inverts**, so a 0/1 mask traces the whole
  frame - pass `~mask` as bool. And PIL's ICO writer ignores `append_images`
  here, so `favicon.ico` is assembled by hand from per-size renders rather
  than one image downsampled five times.
- The fit says the artwork's corner is `r/w=0.235`, but the shipped icons
  render it at `0.2074` (1.16.1 eroded the silhouette to trim the baked drop
  shadow, and eroding shrinks a corner). **The shipped value is kept** - this
  pass is about sharpness, not about redrawing the mark.
- **`icon-1024.png` and `icon-maskable-1024.png` are new.** Nothing bigger
  than 512 existed, and the Android splash scales the largest `any` icon up,
  which is where the softness was most obvious. `test/sw.test.js` now asserts
  every precached/manifest icon exists on disk and that a 1024 `any` icon is
  among them - `cache.addAll()` rejects the entire install if one entry 404s.
- **Tasks carry `order`** (schema-free: assigned lazily by `ensureTaskOrder()`
  in the order they were already showing, so nothing jumps on first load).
  `sortedTasks()` sorts done-last, then `order` - **a hand-picked position
  outranks the due-date rule**, which is the whole point of being able to
  move a row. It rides `profile.tasks`, so it syncs; every move must stamp
  `profile.updated_at` or it never pushes.
- `_tasksReorder` is a mode, not a preference (never persisted), mirroring the
  card layout editor: `#taskReorderBtn` reveals a stacked `.task-move` pair
  per row and **forces the full list open** - you cannot move a task past a
  row that is not on screen. The pair is stacked so it costs one button's
  width at 390px, where the row already holds a checkbox, title, date and two
  buttons.

## Sync redraw, du'as, task dragging, week calendar (1.25.0)
- **The sync bug the user reported as "the prayer summary doesn't match" was a
  *render* bug, not a data one.** `runSync()` redrew `renderToday`,
  `renderProgress` and `renderTasks` only, so a pulled change never reached
  the prayer summary, the qada card, or any Settings editor (the medicine /
  extras / dhikr lists live on the **synced profile**). The data was in
  `state` and in localStorage; the screen was stale until a tab change or a
  reload. `renderAll()` is now the single redraw for "the whole store was
  replaced under the UI" - sync and backup-restore both call it. **Add new
  views to `renderAll`, not to `runSync`.** `test/sync.test.js` pins it: the
  test fails if `runSync` goes back to redrawing three things.
- `onResume()` also syncs (`RESUME_SYNC_MS`, 60s, throttled). An installed app
  is resumed rather than reloaded, so the startup sync could be days old.
- **The remaining sync caveat is real and unfixed**: last-write-wins is per
  *day*, so two devices editing the same day concurrently lose one side's
  edit, and the comparison is on each device's own clock. A per-field merge or
  a server-assigned sequence would be needed; see the 1.11.0 note.
- **Du'as** (`/api/duas`, `dua_images` table, created lazily with
  `CREATE TABLE IF NOT EXISTS` like `user_settings`). The picture is in D1
  rather than on the device **because the link rides the synced profile** -
  `profile.duaLinks["<period>|<item key>"] = <dua id>` - so any device that
  pulls the link must be able to fetch what it points at. Keyed on the dhikr
  item's *key*, never its label, so renaming an item in Settings keeps its
  du'a. `MAX_DUA_BYTES` is 900KB and the client downscales on a canvas first
  (`DUA_MAX_PX` 1600, JPEG); D1 is not a blob store, so an oversize image is
  refused rather than truncated. Deleting a du'a clears every link to it.
  A dhikr item already linked to another du'a is **left out of that du'a's
  picker** rather than shown unticked - ticking it would have moved the link
  silently. It stays, ticked, on its own picture, which is where it is
  released. `renderDuas()` paints the held list and **always refetches** - a du'a added
  on another device would otherwise never appear. A linked dhikr item renders
  its own label as a `.linklike` button (same treatment as a recipe or an
  exercise) rather than carrying a separate icon; it must `stopPropagation`,
  because the row is a `<label>` wrapping the checkbox. The link picker is
  folded behind `.dua-linktoggle` (`_duaLinksOpen`, one at a time) - 21 dhikr
  rows open under every picture buried the pictures - and a fresh upload opens
  its own.
- **Task dragging** replaced the ▲▼ pair. Pointer events, not HTML5 DnD (which
  never fires on touch); `pointermove`/`pointerup` are bound to the
  **document**, not the grip, because grabbing a grip expands a collapsed list
  and that replaces the element the gesture started on. `.task-grip` needs
  `touch-action:none` or the browser claims the gesture as a scroll.
  `reorderTask()` is an insertion and renumbers everything; the done-last sort
  is stable, so dropping an open task among the ticked ones lands it at the
  end of the open block instead of pretending it is done.
- **The calendar is a Mon-Sun week at >=`CAL_WIDE_MIN` (900px)**, three days
  below it. `calCols()` is the one switch; the focused column is
  `CAL_WIDE_FOCUS_FR` (2fr) and is **not necessarily the first**, which is why
  the wide layout has a `.cal-gutter` column for the hour labels - they used
  to live inside the `.is-main` cell and would otherwise appear mid-grid.
  `ensureCalWindow`/`renderCalPanels` derive their day range from `calCols()`,
  and `CAL_WINDOW_PAD` is 10 to cover it. A resize only rebuilds when the
  column count actually changed.
- **jsdom's `innerWidth` is 1024, i.e. a desktop to this app.** `test/lib.js`
  now pins it to 390 unless a test asks otherwise - without that, every
  calendar test silently started asserting against the week layout.
- **Chips carry no clock time** and are sized from their slot
  (`--chip-rows` set by `placeByTime`, `font-size:clamp(...)`). A chip may
  never grow to fit its text - its height is how long the event runs - so the
  text shrinks instead. Under 1.6 rows it also drops the meta line.
- `.cal-cell.current-hour` **keeps the class and loses the outline**: the class
  is what the tab scrolls to on open, the ring was noise over the now-line.

## Sync is on by default (1.25.1)
- `freshState()` ships `sync.enabled = true`, and **schema 3 -> 4 turns it on
  once** for an existing install. Keyed on the schema, deliberately: forcing
  it true on every load would mean a deliberate opt-out never stuck.
  `test/sync.test.js` pins both halves.
- The reasoning, per Yawar: sync is not optional here. One person, one record,
  their own devices, their own Access sign-in - a device that is not syncing
  is a device holding a diverging copy, which is exactly what produced the
  mismatched prayer summaries. The toggle is kept for deliberately stopping
  it, not as an opt-in gate.
- The Settings copy no longer says "optional, off by default" or "your data
  stays local-only until you turn this on" - both are now false.

## The prayer history is a date range, not a set of records (1.25.2)
**Two devices legitimately disagreed about the qada debt. Two causes, both
real, and neither was the sync protocol.**
- `dayData(k)` creates a record for any date that is merely **rendered** -
  looking at a past date is enough. `blankDay()` sets no `updated_at`.
- `renderPraySummary`/`missedByPrayer` iterated `Object.keys(state.days)`, so
  a look-only record counted as **five missed prayers** while a day never
  opened at all was **absent from the history**. Which blank days each device
  held was accidental, so the totals diverged by exactly 5 per day.
- `dayChunks()` filtered on `updated_at`, so those same records **could never
  be pushed** - the divergence could not heal itself either.

Fixes:
- `prayerHistoryDays()` walks **dates** from `prayerHistoryStart()` (the
  earliest key on record) to yesterday, and a date with no record is treated
  as all-missed. Every device now reaches the same answer from the same
  dates, whatever blank records it happens to hold. **Don't reintroduce
  `Object.keys(state.days)` here.** This raises the outstanding count against
  the old behaviour - unlogged days now count - which was flagged to Yawar.
- `dayChunks()` stamps an unstamped day **only if `dayHasContent(d)`**, then
  pushes it. Stamping everything was tried first and pushes a blank record for
  today on every sync, which spreads the phantom-day problem instead of
  fixing it.
- `PRAY_SUMMARY_ROWS` (14) with a "Show all N days since <date>" toggle -
  the memory is kept in full, but a year of rows is not the default view.

## Making the desktop calendar readable (1.26.0)
- **The wide layout draws a text chip in every column**, not only the focused
  one. `calMini` exists for a 74px phone peek column; at 170px it was throwing
  the screen away. The cell-building branch is now `isMain||wide`, and
  `.cal-daygroup.is-week .cal-cell` gets the same flex/`overflow:visible`
  treatment `.is-main` had.
- **`--cal-row` is 62px in `.is-week`** (34px on the phone). This is not just
  taste: a chip's font-size is `clamp(...)` off `--cal-row * --chip-rows`,
  because a chip may never grow to fit its text - so a short row *forces*
  small text. Measured in Chromium: 10.2px -> 14.25px for a one-hour event.
- **`--cal-tint` drops to 16%** in `.is-week`. 30% over a 1900px grid is what
  turned the whole calendar into colour bands.
- **`calSpan(centre)` replaced the ad-hoc `centre-1 .. centre+cols+1` range**
  used by both `ensureCalWindow` and `renderCalPanels`. The wide layout starts
  each panel on its week's **Monday**, which can be six days before the
  panel's own date, so the old range missed it. The only visible symptom was
  the first column having no prayer tint - `test/calendarTab.test.js` now
  asserts every one of the seven `data-day` columns is tinted.
- Cells carry `data-day` purely so that is testable without re-deriving the
  column order from DOM position.

## The calendar is one scrollable week (1.27.0)
**The day carousel is gone.** No `#calTrack`, no `#calDayPrev`/`Next`, no
`calGoDay` slide, no `attachCalSwipe`, no `_calDragged`. `#calDayCur` is the
only panel and it always holds a Monday-Sunday week (`buildDayPanel` builds
the week containing `dayDate`). `calCols()` is a constant 7; `calIsWide()`
(>=`CAL_WIDE_MIN`, 900px) is the only branch left.
- **Wide**: `grid-template-columns` shares the width, focused column
  `CAL_WIDE_FOCUS_FR` (2fr), `.is-wide` on the group.
- **Narrow**: `repeat(7, var(--cal-col))` (124px) - a fixed width, so the grid
  is wider than the screen and `.cal-viewport{overflow-x:auto}` scrolls it.
  A column resizing under the user while they scrolled is what this replaced.
- **`.cal-daygroup` must not have `overflow:hidden`.** It would become the
  scrollport for the sticky hour gutter and the gutter would never stick -
  the same trap recorded for 1.12.0. The rounded corners lose their clip;
  that is the trade.
- **`attachTabSwipe` ignores touches starting inside `.cal-viewport`**, or the
  page-level tab swipe fights the week's own horizontal scroll.
- `scrollIntoView` on the current hour passes `inline:"nearest"` - the default
  would also scroll the week sideways and hide Monday behind the gutter.
- **The week strip (`#calStrip`, `renderCalStrip`) is deleted.** It duplicated
  the grid's own heading row in columns that could not line up with it, since
  the strip was equal-width buttons and the focused grid column is wider.
  The `.cal-gh` headings are the date row; tapping one sets `calCur`.
- **`--cal-tint` is 82%** in both themes (was 30/34%). At 30% over a dark
  panel the prayer colours came out olive and navy; the user asked for the
  colours shown on the prayer modal's swatches. Chips are opaque cards, so
  legibility comes from the chip, not from a weak tint.
- Chip type is capped at **12px narrow / .95rem wide**: at a 124px column a
  title wraps to two lines whatever the size, so a bigger font only pushes
  the calendar name out of the chip.
- Every hour cell and all-day cell carries `data-day`, which is how tests
  address a column without re-deriving grid order from DOM position.

**Pinned dates + open-on-today (1.27.1).**
- `.cal-viewport` scrolls **both** axes with `max-height:var(--cal-h)`. Sticky
  can only stick to a scrollport, and once the grid scrolls horizontally the
  page is no longer the scrollport for anything inside it - so the grid has to
  own its vertical scrolling too for `.cal-gh{position:sticky;top:0}` to work.
  This is the internal-scroll approach 1.13.0 removed; it is back because a
  fixed date row requires it.
- **The corner is `.cal-gutter-head`, not `.cal-gh:first-child`.** The gutter's
  own heading is a `.cal-gutter`, so pinning the first `.cal-gh` pins the first
  *day's* heading and leaves it floating over the hour labels.
- `scrollCalToFocus()` puts the focused column's left edge against the gutter
  (`offsetLeft - gutterWidth`) and, on today, centres the current hour. The
  week starts on Monday, so without it a Thursday opens three days in the past.
  jsdom reports every offset as 0, so its test only asserts the grid is
  positioned at all - the geometry was measured in Chromium.
- Narrow columns are `--cal-col` 92px with `--cal-col-focus` 172px, and
  `--cal-row` is back to 36px (54px was too tall on a phone).

## Task rows: the title collapse (1.30.1)
- **A flex item will not shrink below its min-content width.** `.task-due` is
  `white-space:nowrap`, so beside a `.task-title` carrying `min-width:0` +
  `overflow-wrap:anywhere` the title absorbed the whole shortfall and rendered
  one character per line. Adding the "On calendar" chip is what pushed it over.
- Fixed by **stacking** title and date in a `.task-main` column
  (`flex:1 1 auto;min-width:0`) rather than refereeing the competition. Don't
  put the date back as a sibling of the title.
- **Scheduled is a state on the button, not a chip**: `.icon-btn.is-on`
  (green ring, `--good`), distinct from `.icon-btn.active` (brand, = the
  inline picker is open). Both can apply at once.
- jsdom has no layout, so `test/tasks.test.js` pins the *structure* that makes
  the geometry impossible (a `.task-main` exists; the title is never a direct
  flex child of the row). The widths were measured in Chromium: 188px per
  title at 390px.

## The board is a canvas (1.38.0)
- **One transform, not layout.** Cards are absolutely positioned in canvas
  coordinates and the whole plane is moved with a single
  `translate(...) scale(...)`, so zoom and pan cost no reflow.
- **`zoomAt(z, px, py)` anchors on a point** - the pinch midpoint, the cursor,
  or the viewport centre for the buttons. Zooming about the origin instead
  makes the board feel like it is running away.
- **Screen pixels ÷ zoom = canvas pixels.** `cardDragMove` divides by
  `_canvas.z`; without it a card at 50% travels twice as far as the finger.
  A test pins this at a zoomed-out scale.
- **Position and size ride the synced project row; zoom and pan do not.** How a
  board is arranged is the board. How you are looking at it is a per-device
  view, so it lives in `yawarBoardView` alongside the other display keys.
- **The whole header drags, name included** - and this is the one real bug the
  browser caught that jsdom could not. `.board-name` is `flex:1`, so
  `elementFromPoint` 40px into the header returns *the button*, not the header;
  the first version bailed on any button and left about four pixels to grab.
  The jsdom test passed because it dispatched at `.board-col-head` directly.
  **When a handler depends on what is under the pointer, aim the test at what
  the pointer really hits.** `_cardDragged` (same pattern as `_calDragged`)
  stops the click a drag leaves behind from also opening the rename.
- `startCardDrag` **does not preventDefault for a move** - the header carries a
  button and suppressing the default takes its click with it. `stopPropagation`
  alone keeps the canvas from panning underneath.
- **Menus are `.menu-pop`, `position:fixed`, appended to the body.** Fixed and
  outside the plane, so the canvas transform can neither move nor clip them;
  `positionMenuPop` flips them left/up near an edge. (1.36.0 used a bottom
  sheet precisely because an in-flow menu got clipped - fixed positioning is
  the better answer and gives the desktop behaviour Yawar asked for.)
- `attachTabSwipe` ignores touches starting in `.canvas-viewport`, same as
  `.cal-viewport`.

## The Workflow icon is drawn, not an emoji (1.45.1)
- 📊, 🗺️, 🧭, ⏳ and a shortlist of eight more were each turned down; what was
  actually wanted was **a Gantt chart**, and no emoji is one. `.ico-gantt` is a
  small inline SVG in the bottom bar - three offset rounded bars in the same
  teal/blue/amber `PROJECT_COLORS` gives a board - so it stays crisp at any
  `yawarScale` and is literally the thing the tab shows.
- The ⋮ menu items lost their icon rather than gaining a second, different
  one: `openMenuSheet` sets `textContent`, so a label cannot hold an SVG, and
  the wording already says "workflow".
- Lesson for the next taste call: after two misses, **render the candidates in
  the real component and show them** rather than guessing again - and read
  "something better" as a hint that the category is wrong, not the choice.

## Verse of the day, and the workflow in the brief (1.45.0)
**The rule the ayah feature exists around: the model never supplies the verse.**
Arabic and translation are fetched from a canonical source and passed to Gemini
as fixed text it may only comment on; `AYAH_REFLECTION_PROMPT` forbids
reproducing, re-translating, extending or paraphrasing either, forbids quoting
any other verse or any hadith, and forbids speaking as a scholar. If both
sources fail the row is `verse_error` and the card says so - **never a
generated verse**. Do not "simplify" this by asking the model for the text.
- **No hadith.** Every free hadith API is either unofficial and unverifiable or
  needs an approved key (sunnah.com, a manual step like the Worker secrets).
  Producing hadith text from an LLM is the one thing this design refuses, so
  the feature is Qur'an-only until a real source is wired in.
- **`AYAH_REFS` is a curated, verified rotation**, not a random ayah out of
  6236: a random verse is routinely a fragment mid-narrative. Each reference
  was checked against canonical text before being listed. Three a day
  (`AYAH_PER_DAY`), consecutive in the list, so a day never repeats itself.
  **100 references as of 1.46.1** (was 28), which is 100 days before a day's
  triple comes round - `gcd(3, 100) = 1`, so the starting index walks the whole
  list rather than cycling early. Verified against Sahih International through
  the Qura_ai MCP, whose grounding rules say plainly that the model must never
  supply this text from memory - that is the same rule the runtime feature is
  built around, and it applies at authoring time too.
  - **The bar is not "does the verse exist" but "does it stand alone on a
    card".** The rejects are listed in the comment above the array so they are
    not re-proposed: mid-narrative fragments opening on a pronoun or a speaker
    (12:87, 15:56, 11:88, 7:156, 2:201, 35:28, 2:83), anything framed by
    warfare even where the lesson is not (2:216, 3:146, 3:173, 8:46, 9:40,
    60:8), a verse needing tafsir to not read alarmingly on a family dashboard
    (64:14), and a famous clause sitting at the tail of a ruling on another
    subject (65:2-3, the "way out" verse, inside divorce law).
  - The list is kept **sorted and non-overlapping**, and `test/ayah.test.js`
    pins both plus the surah/ayah bounds. Sorted is what makes a duplicate
    visible when reading the source; non-overlapping is what stops the same
    verse arriving twice under two references (`17:23-24` and a bare `17:24`).
- Two providers, `alquran.cloud` then `quran.com`, both read **shape-tolerantly**
  - neither contract could be exercised from the build sandbox (its egress
  proxy blocks both), the same position the prayer-time normaliser was in.
  quran.com marks footnotes up in the translation; the markup is stripped.
- `daily_ayah` stores the day's three as **one JSON blob** in `items`. The
  table is created lazily like the others.
- **`weekday()` moved to module scope** - it was local to
  `summarizeWithGemini` and the reflection prompt needs it too. A reflection
  failing does not cost the verse; a verse failing skips that one and the
  others still render.
- **`fetchWorkflow()` reads `projects`/`tasks` straight from D1**, because the
  cron generates all this with no browser involved - the same reason
  `fetchJournal`/`fetchTrends` read `days` directly. Like them it **never
  throws**; its error joins `softError` beside a successful brief. It feeds
  both the brief's `WORKFLOW` block and each ayah reflection.
- The client card is a carousel: `AYAH_ROTATE_MS` (3 min), dots, and
  `attachAyahSwipe()` which **stops touch propagation** so the page-level tab
  swipe never also fires - the same rule the calendar grid follows. A manual
  move restarts the timer, so it cannot slide out from under a finger.
- `test/fakeD1.js` gained `seedItem()` and its board-row read now handles a
  query with no `since` watermark and an explicit `deleted = 0` - the sync
  pull and the brief's workflow read are different shapes over one table.

## Naming the workflow route (1.44.2)
- The ⋮ item is named for **what it does**, not for the fields it shows:
  "🗺️ Add to the workflow…" / "🗺️ Change workflow dates…", and the sheet's
  clear button is "Take off the workflow" once there is a span. Giving a task
  a start and end *is* putting it on the timeline; "Set dates…" never said so.
  There is deliberately **no second one-tap route** - it was built and then
  dropped, because the sheet already is the route and two ways in is clutter.
- `openMenuSheet` now **skips a falsy entry**, so a conditional item can be
  written `cond ? {...} : null` inline instead of building the array in three
  statements.

## What a task title says it is attached to (1.44.1)
- The title is **one link with an order**: a linked note (`.linklike`, brand
  green) **beats** being on the timeline (`.btask-wf`, `--wf-link` blue), and
  a task with neither is a plain `<span>`. `taskTitleLink()` builds all the
  link cases so they can only differ in colour and destination.
- **Why the note wins:** it is somewhere to go and read, where the timeline is
  a state the dates on the line below already spell out. Putting the timeline
  on the *dates* instead was tried first - it lets both show at once, but the
  user asked for one indicator with the note prevailing.
- `--wf-link` is `#2563eb` light / `#60a5fa` dark. It must stay distinct from
  `--brand` in both themes, since the whole point is telling them apart.

## The floating controls, and full screen on the calendar (1.44.0)
- **`.fab-stack` is one fixed cluster holding both floating buttons.** They
  were two separately-positioned fixed elements first and did not line up -
  different sizes and different bottom offsets, each correct on its own. One
  flex row means they share a baseline and a bottom offset by construction
  rather than by two rules agreeing.
- Which buttons show is CSS off **`body[data-view]`**, written by `nav()`:
  the cluster on `tasks`/`workflow`/`calendar`, the `+` on `tasks` alone.
  Note a hidden *parent* does not change a child's computed `display`, so a
  test asking "is this button showing?" must read `#fabStack`, not `#fullBtn`.
- **`FULLSCREEN_VIEWS` includes `calendar`.** `sizeTasksPanes()` gained
  `calGrid`/`--cal-h`, so the calendar is measured like the other two panes
  instead of a `calc()` off `--hdr-h`.
- **`syncHeaderHeight()` forces `--hdr-h:0px` in full screen.** The header is
  `display:none` there, so it measures 0 and the old `if(h.offsetHeight)`
  guard left every sticky offset holding the height of a header that is no
  longer on screen - the calendar's date row floated 66px down.
- Zoom in/out are gone from the header menu; pinch and ctrl+wheel remain, and
  the tests drive the wheel now. `canvasFit` stays in the menu - there is no
  gesture for it.

## A linked task is the link (1.43.1)
- `buildBoardTask` renders the title as a `<button class="btask-title linklike">`
  when `t.noteId` resolves, and a plain `<span>` otherwise. **Same class either
  way**, so `.btask .btask-title` (0,2,0) still wins the font rules over
  `.linklike` (0,1,0) and the link keeps the row's own type - only the colour
  and the underline come from `.linklike`. A done linked task still reads as
  done, because `.btask.done .btask-title`'s line-through outranks it too.
- `button.btask-title` exists only to reset the browser's button metrics; it
  must stay below `.btask .btask-title` in specificity or `font:inherit` would
  take the title's size with it.
- The `.btask-note` second line is gone. The footer is gone from every tab.

## The bar, the Workflow tab, the pinned all-day row (1.43.0)
- **`VIEWS` is every view; `BAR_VIEWS` is what the bottom bar carries.** They
  are not the same list any more: Settings is a view with no button (it lives
  in the header ⋮ menu), and the swipe steps through `tabOrder()`, never
  `VIEWS` - a rearranged bar and the gesture would otherwise disagree about
  which tab sits beside which.
- **`yawarTabOrder` is its own per-device key**, same reasoning as
  `yawarLayout`/`yawarScale`. `tabOrder()` keeps only names it recognises and
  then appends anything the stored order has never heard of, so a tab added by
  a later version appears rather than vanishing. `applyTabOrder()` **moves**
  the existing buttons rather than rebuilding them, so their listeners stay.
- **`goTo()` in `test/lib.js` falls back to a throwaway `[data-nav]` element**
  for a view with no button, dispatched into the app's own delegated handler -
  which keeps the tests on the real code path rather than reaching inside.
- **Workflow is a top-level view**, not a sub-tab: `TASK_SUBVIEWS`/`navTaskSub`
  are gone. A stored `yawarLastTaskSub` of `workflow` is mapped to the new tab
  at startup, the same upgrade path `yawarLastTab` got in 1.10.0.
- **Full screen covers `FULLSCREEN_VIEWS` (tasks + workflow)** and is left only
  when you go somewhere else, so moving between the two keeps it. The way out
  is `#fsExitBtn`, floating **bottom-left** - the timeline's own Today button
  owns the top-right and the board's `+` owns the bottom-right.
- **`.cal-allday` is `position:sticky; top:var(--cal-head-h)`.** `.cal-gh` is
  given that height explicitly rather than measured, because sticky needs a
  number. The trap: a `.cal-daygroup.is-week .cal-allday` copy of the rule
  (0,3,0) outranks `.cal-gutter.cal-allday` (0,2,0), which dropped the "All
  day" label's z-index back to 5 and let the hour gutter scroll over it. Don't
  reintroduce a week-scoped duplicate.
- **`.menu-pop button` is `display:block;width:100%`**, so a `.drag-grip`
  inside a menu row takes the whole width and squeezes its label to nothing.
  `.menu-pop .drag-grip` overrides it.
- The event chip no longer carries `event.calendar`. Which of your own
  calendars something lives on is not what the grid is read for, and at 92px
  it pushed the title out; it stays in the tooltip and the editor.

## Notes (1.42.0)
- **A note is a third `ITEM_STORES`/`ITEM_TABLES` entry**, nothing more - which
  is what the generic item path was built for (1.36.0). One word in each array,
  plus `notes` in `test/fakeD1.js` and `test/mockServer.js`, and it syncs per
  row with tombstones like projects and tasks. **Not a field on a day**: a note
  outlives the day it was written on.
- **`task.noteId` already existed** in the task shape from 1.36.0, unused. The
  link is by **id**, so renaming a note keeps it and it travels between devices.
  Deliberately **not `[[wikilinks]]`** - agreed scope is task-to-note links
  only, and a wiki syntax means a parser, a resolver, an unresolved-link state
  and a rename-rewrites-every-mention rule that a link by id needs none of.
- `tasksLinkedTo()` is the only lookup needed: the link lives on the task, so
  backlinks are a filter and there is nothing to keep in step.
- **Deleting a note clears every link to it** (`t.noteId=null`) - a task
  pointing at a note that is gone renders nothing and reads as broken.
- **`renderNotes(preserve)`**: only `renderAll()` passes `preserve`, because
  only the sync redraw can arrive while you are mid-sentence. Every other
  caller is a deliberate action (folding, searching, deleting) and *must*
  redraw - guarding all of them left the list stale after a fold, since
  `noteAddBtn` focuses the new note's title and that focus never moves.
- **`layoutGrid()` now looks one level into a `.subview`.** Journal's cards sit
  inside `#jsub-journal` so Notes can be a sub-tab beside them; every other
  view still holds its grid directly. Still exactly one grid per view, which is
  what makes the card reordering well defined.
- `JOURNAL_SUBVIEWS`/`navJournalSub` mirror `TASK_SUBVIEWS`/`navTaskSub`
  exactly, including the `attachTabSwipe` edge-fallthrough and the per-device
  `yawarLastJournalSub`.

## One drag-to-reorder, editing on the card, movable bars (1.41.0)
- **`dragGrip`/`startRowDrag` is the single reorder implementation**, used by
  board task rows and dhikr. It is the pattern the Today card had before 1.36.0
  removed it: pointer events (HTML5 DnD never fires on touch), move/up on the
  **document** rather than the grip (a re-render replaces the element the
  gesture started on), and the row is *not* moved during the drag - only the
  row under the pointer is marked above or below. `insertBeside()` is the
  shared "put it here, not one place over" maths.
  - A list is addressed by **`data-droplist` on the container and `data-row` on
    each row**, which is what stops a morning dhikr item landing in the evening
    or a task in another project. Tests pin both.
  - The grip must `preventDefault`+`stopPropagation` on **click as well as
    pointerdown**: a dhikr row is a `<label>` wrapping its checkbox.
  - jsdom has no layout, so tests stub `elementFromPoint` and
    `getBoundingClientRect` - the same way they stub fetch. The drag itself is
    the app's own code path.
- **`renderTaskViews()` is the redraw for anything that changes a task.** The
  board and the timeline are two views of one set of rows; marking a task done
  from the timeline redrew only the board, so the bar stayed uncrossed until a
  reload. Don't call `renderBoard()` alone from a task mutation.
- **`openTaskSchedule` is a popup, not `window.prompt`.** It carries a
  `datetime-local` and a duration. `scheduleTaskOnCalendar` **PATCHes when the
  task already owns an event** - the old code always POSTed, so "Reschedule"
  left the first event behind and made a second. A `not_found` reply clears
  `calendarEventId` rather than failing forever against a dead id.
- **Gantt bars move and stretch.** `wfDayPx()` is `WF_COL/7`: the columns are
  weeks but placement is by the day, so a bar can land on a Wednesday.
  `beginBarPress` holds for touch (`WF_HOLD_MS` 400) exactly like the board's
  cards, because the timeline is a long horizontal scroll; the `.wf-bar-grip`
  handle has `touch-action:none` and starts immediately, being a deliberate
  target. The bar itself is `touch-action:pan-y` - **not `none`** - so a finger
  on a bar can still scroll the timeline vertically.
  - `barDragEnd` **must not re-render when nothing moved**: it would replace
    the bar before the click that follows a plain press, and that click is what
    opens the task menu. `_wfDragged` suppresses the click after a real drag,
    same pattern as `_cardDragged`/`_calDragged`.
  - `shiftDay()` does the arithmetic in UTC, like `nextDay()`/`prevDay()`.
- **Edit mode renders the Settings editors in place on the card**
  (`_editItems`, `EDITABLE_VIEWS`, `body.editing-items`). `renderMedsEditor`,
  `renderExtrasEditor` and `renderDhikrEditor` all take an optional target box,
  so there is **one implementation** and the card and Settings cannot drift.
  It is a mode, never persisted, and `setEditItems` calls `renderAll()` because
  the three cards it affects live on two different tabs.

## The header menu, and two sticky lessons (1.40.0)
- **`openHeaderMenu()` is built fresh on every open**, because half of it is
  contextual (Rearrange only on a `LAYOUT_VIEWS` tab, zoom/Fit only on the
  board, Full screen only on Tasks). It reuses `openMenuSheet`/`.menu-pop`, so
  it inherits the fixed positioning and edge-flipping.
- The handlers it calls are **extracted functions, not inline listeners**
  (`setScale`, `toggleTheme`, `downloadBackup`) - the Settings controls call the
  same ones, so the two routes cannot drift.
- **The board has no toolbar.** `#projectAddBtn` is a `.fab` floating inside
  `.canvas-viewport`; zoom lives in the header menu. The zoom percentage is
  `data-zoom` on the viewport - nothing displays it, but it stays inspectable
  and the tests read it there. `boardNote()` now goes to the app status bar,
  since `#boardCount` is gone.
- **`position:sticky` makes `inset-block:0` a constraint, not sizing.** The
  Gantt's name gutter is `.wf-rowlabel`, absolutely positioned in its base rule
  and switched to sticky inside a row; the box then collapsed to its text and
  bars scrolling past showed through the rest of the row (reported as the first
  column overlapping). `height:100%` fixes it - both row heights are definite.
  The same trap in a different guise as the 1.12.0/1.27.0 `overflow:hidden`
  notes: sticky is full of these.
- **Dhikr reordering is on the Prayers card, not only in the Settings editor**
  (`_dhikrReorder`, a mode, never persisted). It forces all three periods open -
  you cannot move an item past a row that is not on screen - and every arrow
  must `preventDefault` + `stopPropagation`, because the row is a `<label>`
  wrapping the checkbox and would otherwise tick the item off as well.
  `moveDhikrItem()` writes to `profile.dhikr[period]` and calls
  `profileChanged()`; forget that stamp and the new order never pushes.

## Weeks, colours, full screen (1.39.0)
- **The Gantt's columns are weeks and the window is enormous** (`WF_WEEKS_BACK`
  52, `WF_WEEKS_FWD` 104) - it scrolls rather than pages. The arrows
  `scrollBy`; `wfScrollToToday()` opens near today unless the user has already
  scrolled (`_wfScrolled`). `wfWeekPos(key)` is a **fractional** week from
  `wfOrigin()`, so a bar starts mid-week rather than snapping to Monday.
- **A row is one element, not a cell per week.** The week lines are a
  `repeating-linear-gradient` and the bar is absolutely positioned over it -
  ~150 columns times every task would be thousands of nodes for a grid that is
  mostly empty.
- **Every row and the head row start after the gutter** (`margin-inline-start:
  var(--wf-gutter)`), so anything drawn in grid coordinates needs the same
  offset. `.wf-now` did not have it and marked a week too early; on an
  absolutely positioned element the margin adds to `left`. A test pins that a
  task starting today has the same `left` as the line.
- **`.wf-corner`** is the sticky block above the gutter. Without it the
  leftmost week heading scrolls out from behind the pinned names with nothing
  covering it - same sticky + negative-margin trick the row labels use.
- **A bar under 64px carries no text.** The task's name is already in the
  gutter beside it, and one clipped letter is worse than none. Tests therefore
  address a bar by its `title`, never its text.
- **A project's colour is stored at creation** (`nextProjectColor()` takes the
  first unused one). `projectColor()`'s index fallback exists only for projects
  made before colours - deriving it from `projectList()` order would repaint a
  project whenever the board was reordered. The colour is on the card as a band
  (`--proj`) and on its bars, so the two views agree.
- **Dragging a card needs a hold with a finger** (`beginCardPress`,
  `CARD_HOLD_MS` 400, `CARD_HOLD_SLOP` 8) - a mouse still drags immediately.
  jsdom's synthetic events have no `pointerType`, so `test/lib.js`-style
  helpers must set one or every drag test silently takes the wrong path.
- **Bring-to-front moves the node, then stores `z`.** Re-rendering mid-drag
  would replace the element the gesture is holding; `renderBoard` paints in `z`
  order so DOM order alone decides stacking and `.is-dragging`'s own z-index
  still wins.
- **`sizeTasksPanes()` measures rather than calculates.** `--canvas-h`/`--wf-h`
  used a `calc()` off `--hdr-h`, which is wrong in at least one of: full
  screen, a wrapped toolbar, a changed text scale. It reads the pane's own
  `getBoundingClientRect().top` and subtracts the fixed bottom bar's height (0
  when it is hidden), and bails when the pane measures 0 - a hidden sub-view
  must keep its last good value.
- **Full screen is a mode, never persisted** (`_tasksFull`, `body.tasks-full`),
  same call as `_tasksReorder`: waking with the header and bottom bar gone and
  no memory of asking for it reads as a broken app. The button lives in the
  **sub-tab row**, the one place that survives in full screen, and is marked
  `is-on` rather than `active` because `navTaskSub()` strips `active` from
  every child of that row that is not the current sub-tab. `nav()` drops out of
  full screen on leaving the tab.
- `attachTabSwipe` now also ignores touches starting in `.wf-scroll`.

## The Workflow timeline (1.37.0)
- **Two date notions, kept in step on purpose.** `start`/`end` are plain
  `YYYY-MM-DD` (a bar is a span of days); `due` stays a full ISO instant and is
  what the calendar grid and both reminder paths read. `openTaskSchedule` moves
  `end` to the scheduled day - so the timeline and the calendar can never
  disagree - and `setTaskSpan` clears a `due` that would fall outside the new
  span. Don't collapse these into one field: minute precision is wrong for a
  Gantt and day precision is wrong for a reminder.
- `taskStart`/`taskEnd` **fall back** (end -> due's date -> start), so a task
  dated only by being scheduled still plots.
- **A span past the window is clamped, not dropped.** A bar that vanished when
  you paged would be worse than one visibly cut off.
- **`TASK_SUBVIEWS`, not a ninth tab.** Eight bottom-bar tabs already measure
  48.3px each at 390px, measured in Chromium - that is the floor for a
  tappable label. Anything further goes inside a tab.
- **"Not on the timeline" is load-bearing, not a nicety.** A fresh board has no
  dates, so without it the Gantt is an empty grid with no route in.
- The grid is one CSS grid with a **sticky gutter** and a fixed `--wf-day`
  column, so it scrolls rather than squashing - the same call the calendar week
  made in 1.27.0. The gutter's own heading needs `z-index` above both the
  sticky row and the sticky column, or it is painted over when you scroll
  diagonally.
- `wfMonday()` uses `(getDay()+6)%7` because `getDay()` is 0 for Sunday, which
  belongs to the week that began six days earlier.

## The Tasks board (1.36.0)
First slice of the project-management rework. Agreed scope with Yawar: board
first on new storage; Notes = task-to-note links only (no `[[wikilinks]]`);
Move/Duplicate pickers rather than a clipboard; the Today task card removed.

- **Projects and tasks are their own D1 rows** (`projects`, `tasks`, created
  lazily like `user_settings`), NOT fields on the profile. Two reasons:
  1. **`handleSync` silently drops a profile over `MAX_DAY_BYTES` (20000)** -
     no error, no `skipped` entry, the client reports success. Yawar's profile
     was already 8939 bytes. A board on the profile would have stopped syncing
     without saying so. Re-read that branch before ever putting a growing
     structure on the profile again.
  2. The profile is last-write-wins as a **whole**; a row per item merges per
     item, which is what a board across several devices needs.
- **Deletes are tombstones** (`deleted=1`), never removals. Drop the row and
  the next device that still holds it simply pushes it back.
- `ITEM_STORES` / `itemStatements` / `pullItems` are the generic path; adding a
  third table is one entry in the array on both sides.
- **`ensureTasks()` is the one accessor** the rest of the app reads tasks
  through - the calendar grid, `checkReminders`, `openingReminders`. Repointing
  that single function at `liveItems("tasks")` carried all three onto the board
  without touching them. Keep it that way.
- **`profile.tasks` is deliberately kept, unread**, as a backstop for the
  schema 4->5 migration. `localDatetimeValue` had to be rescued out of the
  deleted Today-card block - the calendar editor uses it too, and deleting it
  broke 20 tests with `Cannot set properties of null`.
- The three-dot menu is a **bottom sheet, not an anchored popup**: the board
  scrolls sideways, and an absolutely-positioned menu inside it is clipped at
  the column edge.
- Columns are a **fixed width** (`--board-col`) so the board keeps its shape
  and scrolls, rather than columns shrinking as projects are added - the same
  call the calendar week made in 1.27.0.
- `shiftProject` **swaps the two neighbours' order values** rather than
  renumbering: a full renumber would push every project through sync on every
  nudge.
- A duplicate never inherits `calendarEventId`/`scheduled` - two tasks pointing
  at one Google event would fight over it.
- `test/lib.js` exports **`SCHEMA`** so a schema bump is one edit rather than a
  hunt through three files. `test/tasks.test.js` is gone (its subject is);
  `test/board.test.js` replaces it.

## Du'as are shared; everything else is not (1.35.0)
- **`dua_images` is the one deliberate exception to per-user scoping.** List,
  fetch and delete address a picture **by id alone** - no `user_email`
  predicate, so no `user_email` binding either (getting that wrong is how the
  first attempt failed its own tests). Every other table stays keyed on the
  verified Access email.
- `user_email` is still stored, as provenance. `handleListDuas` turns it into a
  boolean `mine` - **never return the other person's address**; a test pins
  that.
- **The links stay personal**: `profile.duaLinks` rides each person's own
  synced profile, so the same picture can be attached to different dhikr items
  by each of them.
- **`duaFor()` returns null for an id that is not in the loaded list**, and
  `pruneDeadDuaLinks()` drops it - the other person may have deleted the
  picture. Both are gated on `_duas !== null`: **"not fetched yet" must never
  be read as "deleted"**, or a device opening offline would silently unlink
  everything. A test pins the failed-fetch case.
- Consequence to state plainly when asked: anyone on the Access policy can see
  and delete these. A third person on that policy gets the same library.

## Calories (1.34.0)
- **`d.food` is one list per day**, entries `{id, kind:"meal"|"snack", name,
  kcal}`. One shape, one set of functions; `kind` decides which card renders
  it. In `blankDay()` so old exports round-trip, and `dayHasContent()` counts
  it or a food-only day would never push.
- **`dayKcal(d, key)` totals what was *ticked*, not what the plan offers.** The
  planned meals and `extrasList()` already carry `kcal`; summing those
  unconditionally is what `#mealKcal` used to do, and it reported an identical
  number every day. **The key argument is required** - which weekday it was
  decides which `PLAN` meals those ticks refer to, and a day record does not
  carry its own date.
- **Deliberately absent from `dayTotalItems()`/`dayCompletion()`.** Food logged
  is not a checklist item; counting it would make the ring fall as more of the
  day was recorded. `test/calories.test.js` pins that the ring does not move.
- Ticking a planned meal now calls `renderToday()`, not just `updateRing()` -
  the heading's kcal line depends on those ticks. Caught by a test, not by
  reading.
- `drawCalorieChart()` plots **only days with a non-zero total** - an unlogged
  day is missing data, not a fast (same call as `drawSleepChart`, opposite to
  `drawPrayerChart`). **No target line**: nothing in the app stores a calorie
  goal, and drawing one against an invented number is the same sin the brief
  prompt forbids.
- `MAX_KCAL` (20000) clamps a nonsense entry to 0 rather than storing it.
- The `.food-add` row gives the kcal box a fixed `flex:0 0 5rem` and the name
  `flex:1 1 8rem` - the 1.30.1 task-row lesson: don't let a nowrap sibling and
  a wrappable one compete for the same width.

## More than one person (1.33.0)
**The Worker was always multi-tenant; the client was not.** `email` comes from
`verifyAccess` (the signed Access JWT) and every SQL statement is keyed on it -
audited, all of them. `handleScheduled` already loops over every row in
`google_tokens`, so a second user's brief generates on its own with no change.
The gap was that the browser's store carried no account, and `runSync` pushes
everything it holds.
- **`state.account`** is the store's owner. It is top-level in `state` but
  **never pushed** - only `days` and `profile` go up. Where a store lives is
  not part of a health record.
- **The server is the enforcement point.** `handleSync` returns **409
  `account_mismatch`** when `body.account` is set and differs from the verified
  email, and writes nothing. A client-side check alone could not be trusted,
  and nothing downstream can tell contaminated rows apart afterwards.
- **An unattributed store pulls, never pushes** (`known` in `runSync`). It
  cannot be distinguished from someone else's store by inspection, so it is
  not credited to anyone until the server has answered. `adoptAccount` also
  takes a one-time `quarantineLocalStore("unattributed")` snapshot first.
- **`quarantineLocalStore()` parks, it does not delete** - `yawarWellness_v1_
  foreign:<email>`. The alternative is eating someone's journal because an
  email comparison went wrong.
- **The deterministic protection is sequencing**, not code: open the app once
  on each of your own devices (which stamps them) *before* adding a second
  person to the Access policy. Until a store is stamped, the guard has nothing
  to compare against.
- `/api/brief` returns `email` too, so an existing install is stamped at
  startup rather than waiting for a sync.
- **Du'as are still per-user** (`dua_images` is keyed on `user_email`), so a
  second account starts with none. Sharing them was discussed and deliberately
  not built - it would let each person see and delete the other's uploads.
- Adding a second person needs two dashboard steps, both manual: their email on
  the **Access** policy, and their Google account as a **test user** on the
  OAuth consent screen (the project is in Testing mode, so Google refuses
  consent for anyone not listed). Testing mode also means their refresh token
  expires every 7 days, same as the first user's.
- Test note: `test/mockServer.js` mirrors the 409 and reports `email`;
  `test/fakeD1.js` gained `INSERT INTO days`/`profile` with the real
  stale-write guard, the watermark pulls, and `DB.batch`.

## The model picker is a `<select>`, not a datalist (1.32.1)
- **`<input list=…>` is not a dropdown.** A datalist only filters as you type,
  and on Chrome for Android its arrow routinely opens nothing - it shipped that
  way in 1.32.0 and was reported as "the dropdown is not working". A native
  `<select>` is the one control that behaves the same on a phone as on a
  desktop. Don't reach for a datalist for a fixed list of choices.
- `BRIEF_MODEL_CUSTOM` (`"__custom"`) is the free-text escape hatch, revealed
  by `briefModelCustomShown()`; `chosenBriefModel()` is what the two controls
  add up to. **A saved model not in `known` selects "Something else" and
  prefills the box** - otherwise a model Google adds later would display as
  "Automatic" while something else was actually running.
- `hidden` on `#briefModelCustomWrap` relies on the `[hidden]{display:none
  !important}` rule (see the 1.23.0 note) - `.field` is not a flex row, but the
  rule is why toggling it works at all.
- **Only verified model names are listed.** `gemini-pro-latest` was considered
  and left out because a search could not confirm it exists; guessing a name is
  what caused the 1.32.0 outage in the first place.

## A pinned Gemini model retired and stopped the brief (1.32.0)
`daily_brief.error` held `HTTP 404 "This model models/gemini-2.5-flash is no
longer available to new users"`. Read that column first, as ever.
- **`GEMINI_FALLBACK_MODELS` leads with aliases.** `-latest` is hot-swapped by
  Google and cannot rot; a pinned version is a dated liability that will expire
  underneath you. Verified current names by WebSearch (ai.google.dev is
  EGRESS_BLOCKED from this sandbox): `gemini-3.6-flash` released 2026-07-21,
  `gemini-3.7-flash` 2026-08-13, `gemini-flash-latest` is the alias.
- **The worse bug was the control flow.** `callGemini` did
  `if (!GEMINI_RETRY_STATUS.includes(status)) throw` - so a 404 on the *second*
  model aborted the loop before the third was tried, and one retired name took
  the whole rotation down. A non-retryable answer now means **skip this model**
  (`dead` set, dropped from later rounds), never "give up". Only
  `GEMINI_FATAL_STATUS` (400/401/403 - a key or request problem no model can
  fix) stops everything.
- The thrown error now reports **one reason per model** (`why` map). Previously
  only the last failure survived, which hid why the *first* model failed - the
  reason this took longer to diagnose than it should have.
- **`brief_model` in `user_settings`** (added with a lazy
  `ALTER TABLE ... ADD COLUMN` whose duplicate-column error is swallowed, same
  approach as the lazy `CREATE TABLE`). `GET`/`PUT /api/settings/brief-model`.
  `geminiModelList(preferred)` puts the user's choice **first with the built-in
  list still behind it** - a wrong name costs one request, never the brief.
  The id is regex-validated because it is interpolated into a URL path.
- Test note: `test/fakeD1.js` now models `user_settings`, and its INSERT branch
  picks the column from the SQL text - the prompt and the model are written by
  separate statements and neither may clobber the other.

## A saved custom prompt is a snapshot, and it wins (1.46.0)
Reported (again) as "the briefing is still missing bits from my journal". Three
causes, and the third is the one to remember.
- **`JOURNAL_MAX_CHARS` was 900 and was halving real entries** - two of five on
  this record ran past it, while the whole journal came to under 4KB against a
  `JOURNAL_TOTAL_CHARS` of 14000. The per-entry cap exists to stop one enormous
  entry crowding out the rest; the *total* is what bounds the prompt. Now 2500.
- **An undated horizon had no rule.** `DEFAULT_BRIEF_PROMPT` told the model what
  to do with a commitment carrying a date, so "in the coming weeks", "from now
  on", "going forward" fell between the rules and were never live. They are now
  explicitly live from the day written until written off, "a direction of travel
  counts even when it names no task", and the opener has a **floor**: a live
  journal commitment gets at least one sentence.
- **`user_settings.brief_prompt` replaces the default outright**, so a saved
  prompt is frozen at the day it was saved. This user's is a copy of the
  2386-char default from `7f93ed4` and has never heard of WORKFLOW - so the
  whole section shipped in PR #78 reached them in the *data* with nothing in the
  *instructions* telling the model to use it. **Every prompt improvement since
  they pressed Save has silently missed them.** This is the second time the 1.18.0
  note's warning has bitten; it is now structural, not a footnote.
  - **`ALWAYS_RULES` is appended after the instructions (custom or default) and
    before the data.** Deliberately scoped to *not losing information* only: use
    every section present, JOURNAL outranks the rest and an open-ended commitment
    is live until written off, overdue WORKFLOW items deserve a mention, no
    invented figures. Voice, shape and emphasis stay with the instructions, where
    a custom prompt can still override them. **Keep it short and keep it out of
    style** - it is the floor a stale prompt cannot fall through. When a new data
    section is added, a line goes here too, or it reaches nobody who has saved.
  - The Settings card shows `#briefPromptStale` when a prompt is stored, saying
    the built-in ones have moved on and that Reset adopts them. **Nothing clears
    it for the user** - a saved prompt may be hand-written, and eating someone's
    own wording is worse than the staleness.
- Test gotcha: raising the per-entry cap changes what the *budget* test measures.
  Its fixture entries are now 600 chars (inside both caps) so it tests the total,
  not the clip.

## The prompt rule that silenced the journal (1.31.2)
Reported as "it's not reading my journal". It was: the entry was in D1 and in
the prompt (both verified against live D1 and the deployed script). The
suppression was a **rule in `DEFAULT_BRIEF_PROMPT`**:

> "Use only the figures in HISTORY ... and never comment on something it does
> not measure."

Written to stop invented statistics. It also silenced every *subject* HISTORY
has no column for - so a written commitment to watch calorie intake could
never appear, because there is no calorie figure. **Scope a no-invention rule
to the thing being invented.** It now reads "governs numbers only - a subject
the writer raised in JOURNAL is worth writing about whether or not HISTORY
measures it."
- The journal was also structurally subordinate ("context for the opening
  paragraph only", last rule in the list). It is now **priority 1** in the
  paragraph's construction, ahead of HISTORY, and explicitly outranks a
  drifting figure. The `JOURNAL` block header no longer says "context only",
  which contradicted that.
- **Dated intentions need the weekday.** "From Thursday onwards" is
  unresolvable against `2026-08-18` alone, so the prompt now says
  "Tuesday 2026-08-18" and names tomorrow. `weekday()` formats from
  `<day>T12:00:00Z` in UTC - noon is the same calendar date in every zone, so
  the local day never gets renamed by a midnight boundary.
- Debugging order that found it, worth repeating: check the row in `days`,
  check the row's `updated_at` against `daily_brief.generated_at`, then grep
  the **deployed** script (`workers_get_worker_code`) for the feature before
  suspecting the model. Three of those four were fine, which left the prompt.

## The brief's two failure bugs (1.31.1)
Diagnosed from the persisted error, not guessed: `daily_brief.error` held
`HTTP 503 ... "This model is currently experiencing high demand"`. **Read that
column first** whenever a brief is reported as broken - it is why every
failure mode is a distinct persisted status rather than one generic "failed".
- **`callGemini()` retries.** Google returns 503 regularly and its own message
  says to try again later, so one attempt was never really an attempt. Each
  pass walks `GEMINI_FALLBACK_MODELS`, then waits and walks it again. Only
  `GEMINI_RETRY_STATUS` (429/500/502/503/504) is retried - a 400 or 403 fails
  identically forever and retrying it only delays telling the user. An empty
  candidate (safety block, truncation) is retried like a 503, since another
  model may answer.
- **`saveBriefFailure()` never destroys a good summary.** Both failure paths
  used to call `saveBriefStatus(..., null, detail)`, writing NULL over a brief
  that had generated fine - which made **Refresh the button most likely to
  lose you your brief**. If today already has a summary it is kept, the status
  stays `ok`, and the reason is recorded in `error` behind the `STALE_PREFIX`
  marker. Don't "simplify" the two paths back into one.
- `handleGetBrief` derives `stale` from that prefix, so the card can tell a
  failed *refresh* (show the earlier brief, say so) from a failed *enrichment*
  like Google Tasks (show the brief, say the tasks are missing). Two different
  warnings, one `error` column.
- **Test-clock gotcha:** `timingsAllFuture()` in `test/openReminders.test.js`
  built its prayer times one minute ahead of the real clock, so a minute
  rolling over between the fixture and the app's own `Date` read moved Fajr
  into the past and the test asserted the wrong scenario. The offsets are ten
  minutes out now. Time-relative fixtures need a margin bigger than the thing
  they are measuring.

## Journal reading + search (1.31.0)
- **Tapping an entry expands it, and only that.** `_jrnOpen` holds the open
  day; `editJournalDay()` behind the pen is the only route into the textarea.
  This was deliberate: opening straight into an editable box makes it far too
  easy to alter something you meant to read. Don't "simplify" the pen away.
- **Search is a plain substring, not a RegExp** (`journalMatchAt` uses
  `indexOf` on lowercased text). A query of `(` would otherwise throw.
- `journalMarked()` builds the highlight out of **text nodes, never
  innerHTML** - it is the user's own writing, but it is still text being put
  on a page.
- `journalPreview()` centres the preview on the hit. The head of a long entry
  is rarely where the searched word is.
- **A search shows every match** and hides the `Show all` fold - hiding
  matches behind a fold defeats having searched.
- **The caret is captured in `renderJournalPast()`, not in the input's own
  handler.** The list is rebuilt on every keystroke *and* by `renderAll()`
  after a sync pull, and the box being rebuilt is the one being typed in;
  restoring from the render covers both. `restoreJournalCaret()` runs on every
  exit path, early returns included.
- **The brief's journal window is a budget, not a fortnight**: `JOURNAL_DAYS`
  120, `JOURNAL_MAX_CHARS` 900 per entry, `JOURNAL_TOTAL_CHARS` 14000 overall,
  spent newest-first. Today's entry is exempt from the budget. `oldest` and
  `omitted` go into the prompt header so the model knows how far back it can
  reach - without that it treats the block as "recent" and ignores the far end.

## The brief judges the whole record (1.30.0)
- **`summariseHistory()` computes every figure; the model is told never to
  recompute one.** That is the whole design. An LLM handed 400 raw days and
  asked for an average returns a plausible number, not the right one - and the
  brief sits directly above a Progress tab showing the real ones. The prompt
  therefore carries a fixed handful of computed lines however long the record
  gets, so a brief costs the same on day 2000 as on day 20.
- **Prayers are counted over `dateRange(first, yesterday)`, not over the rows
  that exist** - the server-side twin of `prayerHistoryDays()`. Re-read the
  1.25.2 note: if these two ever diverge the brief contradicts the app's own
  prayer summary and qada debt. `prevDay()` is `nextDay()`'s mirror, UTC
  arithmetic for the same reason.
- **Sleep uses only the nights with a number**, weight only the days with one -
  matching `drawSleepChart`'s call, for the same reason. The summary also
  states how many days were *not* logged, which is itself the finding when
  most of them aren't.
- `fetchTrends()` pulls the fields out **in SQL** (`json_extract`), not the
  whole day blob: a year of records is a few KB that way and hundreds of KB
  the other. Like `fetchTasks`/`fetchJournal` it **never throws** and its
  error joins `softError`.
- **`HISTORY` goes in the prompt ahead of the day's events.** Burying it under
  the schedule gets an opener written about today instead of about the trend.
- **The 1.29.0 "Notes" section is gone.** The journal now feeds the opening
  paragraph instead of getting bullets of its own. Its data block is still
  omitted entirely when empty.
- `summarizeWithGemini(env, ctx)` takes an object now - it had reached eight
  positional arguments. It is internal, so nothing outside had to change.
- **Test gotcha:** the instructions themselves now contain the words `HISTORY`
  and `JOURNAL`, so a test asking "is this data section present?" must match
  the section header (`\nJOURNAL (the writer's own words`), never the bare
  word - otherwise it matches the prompt's own rules and always passes.
- `.brief-para:first-child:not(:last-child)` is what makes the opener read as
  a lead paragraph. The `:not(:last-child)` matters: a status message
  ("Connect your Google Calendar…") lands in the same element and must stay
  plain, which it does by being the only child.

## Journal tab + prayer/sleep charts (1.29.0)
- **The journal is the day record's existing `notes` field.** It has been in
  `blankDay()` since the beginning and was kept deliberately when the Today
  tab's "Notes for the day" card was removed in 1.17.2 - so the tab inherits
  every word already written, syncs with everything else, and needed **no
  migration and no schema bump**. Don't add a parallel field for it.
- `renderJournal()` **must not rewrite the textarea while it is focused**
  (`document.activeElement!==ta`). It is called from `renderAll()`, which runs
  after a sync pull replaces the whole store; every keystroke is already in
  `state`, so a focused box is never stale, but overwriting it under the
  cursor would eat what is being typed.
- `journalDays()` is a set of *records* - the opposite of `prayerHistoryDays()`
  next to it, and deliberately. A day nothing was written on is not a gap in
  the story, it is simply not an entry; a day no prayers were logged on is
  five missed.
- `VIEWS` is **seven** now, Journal sitting straight after Calendar (moved
  there in 1.31.0). Measured in Chromium at 390px: 55.1px per tab, no
  label clipped. The `<section id="view-journal">` is still further down the
  markup - order comes from `VIEWS`, never from DOM position. `LAYOUT_VIEWS` gained `journal` too (it is a `> .grid` of
  `.card[data-card]`, which is the whole precondition).
- **`column-span:all` on the journal card at >=721px.** `.cards` is CSS
  columns, not a grid, so a card can span the flow - writing is the point of
  the tab and a third-width box on a desktop was the same waste the calendar
  had.

**The charts.** Both follow `drawCompletionChart`'s shape (canvas + a
`.muted.center` note element, which is what the jsdom tests assert on since
there is no 2D context).
- `drawPrayerChart()` plots over **`prayerHistoryDays()`**, not
  `Object.keys(state.days)` - the same range the prayer summary and the qada
  debt use, so they cannot disagree. Re-read the 1.25.2 note before changing
  this. Today is excluded because it is not finished.
- `drawSleepChart()` plots **only nights with a number logged**. An unlogged
  night is missing data, not zero hours, and drawing it as a trough would be a
  lie - the exact opposite call to the prayer chart's, for the exact opposite
  reason.

**The brief reads the journal.** `fetchJournal(env, email, day)` reads the
synced `days` table directly - the cron generates the brief with no browser
involved, so nothing can be posted up by the client. The `notes` filter is in
SQL (`json_extract(data,'$.notes')`) so the row budget is spent on days that
actually have an entry; a run of logged-but-unwritten days would otherwise
push every real entry out of the window. Bounds: `JOURNAL_DAYS` 14,
`JOURNAL_MAX_CHARS` 900. Like `fetchTasks` it **never throws** - the journal
enriches the brief, it is not the brief - and its error is persisted beside a
successful summary (`softError` joins it with `tasks.error`).
- The `JOURNAL` section is **omitted entirely when there is nothing in it**;
  an empty heading is an invitation to invent an entry.
- `DEFAULT_BRIEF_PROMPT` gained a trailing **Notes** section. Checked against
  live D1 on 2026-08-16: `user_settings.brief_prompt` is NULL for this user,
  so the new default actually applies - a saved custom prompt would have
  overridden it silently (see the 1.18.0 note).
- **Privacy:** journal text now goes to the Gemini API alongside the calendar
  and task data. Flagged to Yawar in the 1.29.0 changelog entry.

## Dhikr in the day's score, folded reminders (1.28.0)
- `dayTotalItems()`/`dayCompletion()` count dhikr as **one item per period**
  (`dhikrTotalItems()`), not one per phrase. Per-phrase was tried first
  (1.28.0) and made the longest list on the app worth two thirds of the day;
  Yawar asked for three. A period only counts once **every** item in it is
  ticked, and a period with no items is in neither the total nor the score.
  Because the total is computed from the *current* lists, past days on the
  Progress chart are re-scored too; that is existing behaviour of a dynamic
  total, not new.
- **`pushNotif(title, body, key)` folds a repeat** into the entry already in
  the bell: it moves that row back to the top, restamps `at`, keeps `firstAt`
  and increments `count` (rendered as a `×N` badge). Without it the same
  unticked prayer, raised again in a later window or on reopening, pushed
  everything else off a 40-row log.
- **`notifSubject(key)` is what "the same thing" means.** A reminder key is per
  prayer *per day* and per task *per due time* - right for firing once, wrong
  for the list, since tomorrow's Asr would be a second row. The date and any
  epoch-millisecond part are stripped. Note titles are **not** unique:
  morning and evening dhikr both say "Dhikr reminder" and differ only in the
  body, which is why folding is keyed rather than title-matched.
- Clearing the bell closes the panel - an empty popup left open reads as
  broken.

## Honest caveat
The "Client-side sync layer," "Access + hosting," and "Current data state"
sections above were re-verified live in this session (2026-08-09): read
worker.js/wrangler.jsonc directly, confirmed the deployed Worker code matches
the repo byte-for-byte, queried the D1 schema and row counts directly, and
checked the Access application's policy screen. Everything above that point
matched. Earlier sections of this file predate that verification pass — if
something here seems off, re-check the live repo/dashboard/D1 before trusting
it, the same way this pass did.
