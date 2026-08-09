# Changelog

## 1.7.0

A mobile-first pass over the whole app: less scrolling, fewer taps, everything reachable with a thumb.

- **Navigation moved to a bottom icon bar** and you can now **swipe left/right between tabs** in the same order. The **Guide tab has been removed**.
- **Collapsible cards throughout.** Every card on the Today tab (and the prayer/qada cards in Progress) folds away from its heading, and each heading shows its own progress (`2/3`, `0/8`…) so a folded card still tells you whether it needs attention. Joint Pain and Notes start folded. What you fold is remembered per device — it's a display preference, deliberately kept out of the synced record.
- **Dhikr is now three collapsible sub-cards** (Morning / Afternoon / Evening), each with its own count, folded by default instead of one 21-row list.
- **All the tips and explanatory notes are gone from the Today dashboard.** (The data-safety wording in Progress — cloud sync, backups, clearing data — is kept, along with the exercise safety warning, since those aren't dashboard clutter.)
- **Slightly smaller base text size** across the app for a more compact phone layout, and the date bar now stays on one line instead of wrapping to four.
- **Tasks reworked:** adding a task now asks only for a title — no more time field. Every task row has a **📅 button** that opens an inline time picker, and only then does it go on your Google Calendar. The **Today tab shows just the top 3** tasks with a pointer to the rest; the **Calendar tab is now the full task repository**, and can add tasks too.
- **Calendar rebuilt as a single 24-hour column** (was two side-by-side columns), and **swiping between days is now an animated slide** — the outgoing day is pushed off in the direction of travel and the new one slides in behind it, tracking your finger as you drag, instead of snapping straight to the next day.
- **Made-up (qada) prayers:** a new Progress card lets you record prayers you've since made up, per prayer. Each one comes off the outstanding count in the prayer summary. The count is capped at the number actually missed, and it never rewrites the historical record of what was prayed on a given day — it lives on your profile and syncs with it.
- **Fix:** tapping a bottom-bar tab's *icon* did nothing, because the delegated click handler read the attribute off the literal click target rather than the button that owns it. Since the icon is the obvious thing to tap on a phone, this made most tab taps miss.

## 1.6.0

- **Fix:** removed the "Grant new permissions" link from the Today's Brief card now that reconnecting has actually been done - it was a one-time fix for the 1.5.0 scope expansion, not something that needed to stay visible permanently.
- **Fix:** refreshing the Today's Brief now only tells Gemini about events/tasks still *remaining* for the day - anything already finished is dropped before the prompt is built, and the prompt is explicitly told the current time and told not to open with a time-of-day greeting ("Good morning" etc.) that may no longer be accurate.
- **Prayers (Salah) checklist:** each tick-box row is now colored to match its prayer (same colors as the live clock/Calendar tab), and once a location is saved, shows that prayer's actual time next to its name.
- **Calendar tab rebuilt as a full 24-hour, two-column day view** (00:00-11:59 / 12:00-23:59 side by side) instead of a scrolling agenda list - every hour of the day is visible at once, no scrolling required to see the whole day.
  - Each event appears in its starting hour's slot, colored by source calendar, with its location shown inline.
  - Every hour is tinted with the color of whichever prayer's *window* it falls in - Fajr through Sunrise, Sunrise through Dhuhr, and so on, including overnight (Isha's window correctly spans across midnight into Fajr the next morning) - so the whole day is covered with no gaps, not just single colored dots at prayer times.
  - Swipe left/right on the grid moves to the next/previous day, same as the new "›" next-day button (previously there was only "‹" for previous day).
  - Opening the tab automatically highlights the current hour in whichever column (AM/PM) it falls in and scrolls it into view - no extra tap needed to see "now."

## 1.5.1

- **Fix:** after the 1.5.0 OAuth scope expansion, there was no way to actually re-grant the new permissions from the UI. A refresh token from before the scope change keeps working for its *original* scopes — Google doesn't invalidate it — so the Today's Brief card kept reporting `ok` and never showed the "Reconnect" button; the only place that button appears is the `not_connected`/`reconnect_required` states. The Today's Brief card now always offers a "🔗 Grant new permissions" link (re-runs Google's consent screen) alongside Refresh/Generate-now, even while already connected and working, so upgrading to newly-added scopes doesn't require waiting for something to fail first.

## 1.5.0

- **Calendar tab**: a new day-agenda view (`GET /api/calendar/events`) showing every event across all of your Google calendars for the selected day, sorted by time, color-coded by the calendar it came from (e.g. your primary calendar vs. a shared family calendar), with prev/today/date-pick navigation. Live prayer times overlay the agenda as colored rows using the same colors as the Today-tab prayer clock.
- **Today's Brief now reads every calendar you have access to, plus your Google Tasks due today** — not just your primary calendar's events. Google OAuth scope expanded to `calendar.events` (write, for scheduling below) and `tasks.readonly`; existing connections need to reconnect once to pick up the new scopes (surfaced as `reconnect_required`, same as an expired token). A single unreachable calendar or a Tasks API failure never breaks the rest of the brief — both degrade gracefully (skip-and-continue / empty list) rather than failing the whole summary.
- **Live prayer times**: an opt-in "Use my location" button (browser Geolocation) fetches the day's prayer times from the free Aladhan API (Muslim World League method) and renders them as colored chips on the Today tab, with the next upcoming prayer highlighted and a live countdown. Cached per day + location so it doesn't refetch on every render. The same prayer-time colors are reused in the new Calendar tab.
- **Task list** at the top of the Today tab: quick-add a task with an optional due date/time; check off or delete locally, or hit "Schedule" to create it as a real event on your Google Calendar (`POST /api/google/calendar/events`, needs the write scope above). Tasks are currently local-only — they are not yet part of the `/api/sync` payload, so they don't sync between devices (documented as a known limitation, not silently dropped).
- **Dhikr tracker**: a simple morning/afternoon/evening checklist (istighfar, tasbih, tahmid, takbir, salawat, Ayat al-Kursi, the three protection surahs) alongside the existing Prayers card, saved per day like everything else.
- **In-app notification reminders** (foreground only, by design — no service-worker push): an opt-in "Enable reminders" button in the Progress tab requests browser notification permission, then a lightweight 60-second check surfaces a notification when a prayer time, a dhikr period, or a scheduled task's due time arrives while the tab is open.
- Today-tab layout pass: task list, prayer clock, and Dhikr now sit together with Today's Brief and Prayers in a clearer top-to-bottom flow.
- New Worker exports for testability: `listCalendars`, `fetchEventsForRange`, `fetchTodayTasks`, `handleGetCalendarEvents`, `handleCreateCalendarEvent`, `dayBoundsForDate`.
- Test coverage: `test/worker.test.js` extended (multi-calendar fetch, Tasks integration, both new endpoints, the `reconnect_required` mapping from an insufficient-permission response), plus four new jsdom suites — `test/calendarTab.test.js`, `test/prayerTimes.test.js`, `test/tasks.test.js`, `test/dhikrNotify.test.js`. Fixed a test-suite bug where accumulating `setInterval` timers across jsdom windows (from the new notification-reminder loop) prevented `npm test` from exiting cleanly — every test file using `loadApp` now closes its window in an `after()` hook.

## 1.4.0

- **Today's Brief**: a new card at the top of the Today tab, powered by Google Calendar + Gemini. Connect your Google Calendar (OAuth, `calendar.readonly` only — Gmail was deliberately left out to avoid Google's restricted-scope verification/security-assessment requirements) and a short AI summary of the day's schedule generates automatically every morning at 7am London time (self-adjusts across BST/GMT), plus a manual "Refresh"/"Generate now" button.
- New Worker endpoints: `GET /api/google/connect` and `GET /api/google/callback` (OAuth flow), `GET /api/brief` (read today's cached brief), `POST /api/brief/refresh` (regenerate on demand). A Cloudflare Cron Trigger fires hourly; the handler itself only acts during the target London hour and dedupes against D1, so it stays a once-a-day generation.
- New D1 tables: `google_tokens` (refresh/access tokens, one row per user), `daily_brief` (cached summary per user per day, with a distinct status for not-connected / pending / ok / calendar error / Gemini error / needs-reconnect, so the UI can say something precise instead of a generic failure).
- A failed or unreachable brief never breaks the rest of the Today tab — it's an isolated card with its own error states.
- New required Worker secrets: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GEMINI_API_KEY` (set in the dashboard, same as the Access secrets).
- Added `test/worker.test.js` (loads the real `worker.js` via a `data:` URL import against a fake D1 + mocked `fetch`) and `test/brief.test.js` (jsdom coverage of the new card's states).

## 1.3.1

- **Fix:** `sw.js` broke every page load (`ERR_FAILED`) once installed as an app. Its fetch handler called `fetch()` on every intercepted GET, including the page navigation itself — but the Fetch spec forbids calling `fetch()` with a `Request` whose `mode` is `"navigate"`; it throws, which rejected the promise handed to `respondWith()`. Now navigations are never intercepted at all, same as `/api/*`. This likely also explains why the desktop install prompt never appeared: Chrome's installability check requires a working service worker, and this one was throwing on the very first navigation it saw.
- Added a dedicated unit-test suite for `sw.js` itself (`test/sw.test.js`) that pins this down: asserts `fetch()` is never called with a navigate-mode request, alongside the existing `/api/*` and non-GET exclusions.

## 1.3.0

- Real "Install as an app" support: a service worker (`sw.js`) caches the static app shell for offline loads, and never touches `/api/*` — sync and Cloudflare Access always hit the network untouched.
- New "📲 Install as an app" card in the Progress tab: a working Install button on Chrome/Edge/Android (captures `beforeinstallprompt`), Share → Add to Home Screen guidance on iOS Safari (which has no such prompt), and generic bookmark guidance elsewhere. Hides itself entirely once already running standalone.
- Test coverage for all of the above in the jsdom suite.

## 1.2.0

- Client-side sync layer: every day's record and your profile now carry an `updated_at` stamp, set on every edit.
- One-time migration stamps existing history from before this change, so it participates in sync correctly.
- Opt-in "Enable cloud sync" toggle in the Progress tab (off by default, never auto-enabled) that syncs to the `yr-wellness` Worker backend via `/api/sync`, merging with true last-write-wins.
- A failed or unreachable sync never touches local data — your on-device history stays authoritative either way.
- Added a jsdom-based test suite (`npm test`) covering storage corruption/recovery, the schema migration, and multi-device sync conflicts.

## 1.0.0

Initial release.

- Today dashboard with completion ring: medicines, prayers, meals, supplements, water, movement, weight, sleep, steps, joint-pain & energy, notes.
- 7-day halal meal plan (~1,300–1,400 kcal/day incl. supplements) with a 20+ recipe library; each meal links to its recipe.
- Daily supplements & drinks tracker (collagen, whey, creatine, milk, milk tea).
- 5 gentle, arthritis-safe exercises (each under 15 minutes) with YouTube demo links.
- Prayer tracker for all 5 daily prayers, plus a missed-prayer summary in Progress.
- Weight-trend chart, history table, and progress stats.
- Light / dark theme toggle.
- Export / import backup, and clear-all-data.
- 100% on-device storage (localStorage); works fully offline. Installable as a PWA.
