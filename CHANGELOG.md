# Changelog

## 1.42.0

**Notes** — the last piece of the project rework. **Journal** now has two sub-tabs: **📓 Journal** (unchanged) and **🗒️ Notes**.

A note is a title and a body, kept for as long as you want it — not tied to a day the way a journal entry is. Tap one to open it, tap it again to fold it away; **+ New** starts one; **Search notes…** looks through titles and bodies alike.

**Tasks link to notes.** From a task's ⋮ menu: **Link a note…** → either **New note from this task** (which makes one titled after the task and drops you straight into it) or pick an existing one. A linked task shows the note as a link on its own line — tap it and you land in the note. The note, in turn, shows a badge with how many tasks point at it and lists them under **Linked from**.

Notes are their own synced rows, like projects and tasks, so they merge per note across your devices rather than one device overwriting another. Deleting a note lets go of every task that pointed at it, rather than leaving a link to something that isn't there.

Deliberately *not* Obsidian's `[[wikilinks]]`: a link by id survives renaming the note, needs no parser, and can't end up "unresolved".

## 1.41.0

**Dhikr sorts by dragging**, the same way tasks used to. Every row has a ⠿ grip: pick it up and drop it above or below another row. The ▲▼ arrows and the Reorder button are gone. The order rides your synced profile, and each period is its own list — a morning item can't be dropped into the evening.

**Board tasks drag too.** Same grip, same behaviour, so you can put a task where you want it in terms of priority instead of taking whatever order it was added in. A hand-picked position beats any date rule; ticked tasks still gather at the bottom.

**The 📅 button opens a real picker.** It was asking you to type a date into a browser prompt. It's now a proper popup with a date-and-time field and how long the thing runs. If the task is already on your calendar it offers **Reschedule** and **Take off the calendar** — and rescheduling now *edits* the existing event rather than quietly creating a second one and leaving the first behind.

**Marking a task done on the timeline crosses its bar out at once.** It was redrawing only the board, so the bar sat there uncrossed until you reloaded.

**Bars can be moved and stretched on the timeline.** Hold a bar for half a second (a mouse drags straight away) and slide it to any day of any week — the columns are weeks but placement is by the day, so you can land on a Wednesday. Drag the right-hand end of a bar to extend how long it runs; the start stays put.

**Edit what's on a card, from the ⋮ menu.** Alongside *Rearrange cards* there's now **Edit what's on these cards**: the medicines, supplements and dhikr lists become editable in place — rename anything, delete anything, add a new one — without going into Settings. It's the same editor Settings uses, so the two can't drift apart, and the outlined cards make it obvious you're in edit mode.

## 1.40.0

**A ⋮ menu in the header, on every tab.** The controls that apply wherever you are used to be spread between one tab's toolbar and three screens deep in Settings. They're all in one place now:

- **Text size** — the five steps, with the current one marked.
- **Dark / light appearance.**
- **Sync now.** If cloud sync is off it says so and takes you to the switch rather than silently doing nothing.
- **Rearrange cards on this tab** — offered on Today, Prayers, Journal, Progress and Settings. Calendar is a grid of hours and Misc is three sub-panels, so neither is a list of cards to reorder.
- **Zoom in / out / Fit**, and **Full screen**, when you're on the Tasks tab.
- **Export a backup**, and a shortcut to Settings.

**The board's toolbar is gone.** Adding a project is now a floating **+** in the bottom-right corner of the canvas; zoom moved into the header menu. That row cost a whole line of the height the board is short of, and on a phone it was pushing the count off the end anyway.

**The timeline's name column is solid.** Bars scrolling past used to show through the lower half of each row and overlap the task names. The column is `position:sticky`, and once it is, the rule that was sizing it to the full row height stops applying — so the box was only as tall as its text.

**Dhikr can be reordered where you read it.** ↕️ **Reorder** on the Dhikr card gives every row a ▲▼ pair and opens all three periods (you can't move an item past a row that isn't on screen). The order rides your synced profile, so it follows you to your other devices. Moving an item never ticks it off — the row is a label wrapping the checkbox, which it would otherwise have done.

## 1.39.0

**A better board, and a timeline that isn't boxed in.**

- **The Workflow timeline is week by week, and scrolls as far as you like** — a year back, two years forward. A project runs for weeks, and a day-wide column meant scrolling for an hour to see a month. The ‹ › arrows now scroll rather than page a fixed window, and **Today** brings you back.
- **Every project has its own colour**, on its timeline bars *and* as a band across the top of its card on the board, so a card and its bars are recognisable as the same thing. New projects get an unused colour automatically; **⋮ → Colour…** changes it.
- **Full screen.** The ⛶ button at the top of the Tasks tab hides the header and the bottom bar so the board or the timeline gets the whole screen. Tap ✕ (or press Escape) to come back; leaving the tab drops out of it too.
- **Scrolling the timeline sideways no longer jumps to the next tab**, same as the board.
- **The hint line under the board is gone.**
- **Dragging a card needs a short hold now** (about half a second with a finger; a mouse still drags straight away). Brushing a card header while moving around the board used to pick it up. The card squeezes slightly while you hold, then lifts.
- **The card you drag comes to the front**, and stays there — which card sits on top is part of the board, so it syncs with the position.
- **"on calendar" is gone from task rows.** The green ring on the 📅 button already says it, and the extra label was squeezing the title — the same collapse that was fixed on the old Today card.

Two things a real browser caught that the tests could not: the today line on the timeline was drawn a gutter's width to the left of where it belonged, and the leftmost week heading slid out from under the pinned task names with nothing behind it. Both fixed, and both now pinned by tests.

## 1.38.0

**The board is a real canvas now**, not a row of fixed columns.

- **Pinch to zoom** in and out, or use **− / +**, or **Fit** to frame everything at once. Trackpad pinch works too.
- **Drag a card anywhere** — grab it by its header (the project name included) and put it where you like.
- **Resize from the bottom-right corner.**
- **Drag the background to pan.**

Where each card sits and how big it is **syncs** — how you've arranged a board *is* the board, so it should look the same on your phone and your laptop. The zoom and pan are per-device, like the UI scale: those are how you're looking at it, not what it is.

**Three other fixes you asked for:**

- **Swiping sideways on the Tasks tab no longer jumps to the next tab.** The canvas owns its gestures now.
- **The ⋮ menu opens right where you tapped**, like a desktop context menu, instead of sliding up from the bottom. It flips left or up near an edge so it's never half off-screen.
- **The 📅 calendar button is back on every task row**, with the green ring when something's on your calendar — same as it was on the old Today card.

One bug worth mentioning because only a real browser caught it: the project name button covers nearly the whole card header, so my first version — which ignored drags starting on a button — left about four pixels of grabbable header. The jsdom test passed anyway, because it aimed at the header directly rather than at what a finger actually lands on. Dragging by the name now works, and tapping it still renames.

## 1.37.0

**The Workflow timeline** — second slice of the project rework. A **Board / Workflow** switch at the top of the Tasks tab.

Workflow is a Gantt across a fortnight: task names pinned in a left gutter, a column per day scrolling sideways, and a bar for each task spanning its dates. Project headings group the rows, today's column is marked, and weekends are shaded.

- **Tasks now have a start and an end.** Set them from **⋮ → Set dates…**, or from the timeline. An end before a start is swapped rather than refused.
- **Bars read at a glance**: green for open, **red when overdue**, grey and struck through when done.
- **"Not on the timeline"** lists everything open without dates, with a Dates… button on each. A fresh board has no dates at all, so without this the timeline would be an empty grid with no way in.
- **‹ ›** page a week at a time; **Today** comes back. A span running past the window is clamped to the edge rather than disappearing.
- The board rows now show the span (`7 Sept → 9 Sept`) instead of a single date.

**Scheduling keeps the two views honest**: putting a task on the calendar moves its end date to that day, so the timeline and the calendar can't disagree about when something is due. Reminders still read the precise instant.

Workflow is a sub-tab rather than a ninth tab in the bottom bar — eight already measure 48px each at phone width, which is the floor for a tappable label.

**Still to come:** the Notes sub-tab under Journal, with task↔note linking.

## 1.36.0

**A Tasks board — the first slice of the project-management rework.**

A new **Tasks** tab, first in the bar, holding a canvas of project cards you scroll sideways through. Each project has its own task list. Your 12 existing tasks arrive as a **General** project.

- **⋮ on every task**: mark done, rename, add to / reschedule on calendar, **Move to…**, **Duplicate to…**, delete. Move and Duplicate open a picker of your projects — no clipboard to hold in your head across screens.
- **⋯ on every project**: rename, move left/right, delete (with its tasks).
- Ticking a task sinks it below the open ones. Done/total shows on each card.
- **The Today tab's Tasks card is gone.** Tasks live in one place now. The calendar and both reminder paths were repointed at the board, so a task scheduled from either place still behaves the same.

**Underneath: projects and tasks are their own synced rows, not fields on the profile.** Two reasons, and the first is a live hazard I found while planning this:

- The profile is pushed as a single JSON string and **silently dropped above 20,000 bytes** — no error, no warning, the app reports a successful sync. Yours is already 8,939 bytes. A board would have grown past that and quietly stopped syncing.
- The profile merges as a *whole*, so two devices editing different projects lose one side's work. A row per item merges per item, which is what a board across three people's devices needs. Deletes travel as tombstones, so deleting on one device isn't undone by another pushing it back.

Your old `profile.tasks` list is **kept, unread**, as a backstop in case the migration got anything wrong. It can be dropped in a later version.

**Still to come** (agreed order): the Workflow/Gantt view, and the Notes sub-tab with task↔note linking.

## 1.35.0

**Du'as are now a shared library.** All 19 pictures are visible to both accounts, and an upload or a deletion by either of you shows up for both. Everything else stays private per account — days, meals, calories, journal, prayers, weight, calendar, tasks, the daily brief.

- A picture someone else added is marked **shared** in its heading, so it's clear where it came from.
- **The links stay personal.** Which dhikr item a du'a is attached to rides your own profile, so you can each link the same picture to different items — or not at all.
- If one of you deletes a picture the other had linked, that link quietly stops being a link rather than opening an empty popup. A link is never cleaned up on a *failed* fetch, so a device that opens offline doesn't lose its links.

Worth being explicit: anyone on the Cloudflare Access policy can now see and delete these pictures. That's what "shared" means, and it's fine for the two of you — but a third person added to that policy would get the same library.

## 1.34.0

**Calorie tracking.**

- **Add another meal, with its calories** — a name-and-kcal row at the bottom of Today's Meals, for anything that wasn't on the plan. ✕ removes it. Enter adds it without reaching for the button.
- **Supplements & Drinks is now Supplements, Drinks & Snacks**, with the same add-a-snack row.
- **A Calories chart on Progress**, with a 7-day average once there's a week of it.

The number in the Meals heading has changed meaning, and for the better: it used to show the *plan's* calories including every supplement — the same figure every day, whether you ate any of it or not. It now shows **what you actually logged**: the planned meals you ticked, the supplements you ticked, and anything you added by hand. So it moves as your day does.

Two deliberate choices worth knowing:

- **A day with nothing logged is left off the chart, not drawn as zero.** That's missing data, not a day of fasting — the same call the sleep chart makes.
- **Adding food never moves the completion ring.** These are things you happened to eat, not a checklist you set out to finish; counting them would make the ring *fall* as you logged more of your day.

There's no target line on the chart, because the app has never been told your target. Say the word and I'll add one you can set.

## 1.33.0

**Groundwork for a second person using the app.** The server was already fully multi-user — every one of the 25 database queries is keyed on the email from your verified Access token — but the *browser* wasn't. The local store carried no record of whose data it held, and sync pushes everything it holds. So opening the app on a browser containing someone else's data would have filed their days and journal under whoever was signed in.

- **The local store now knows whose it is.** Every sync declares the account, and the server **refuses a push that doesn't match** the signed-in email — nothing gets written.
- **When a different person signs in, the browser starts clean for them** and pulls their own data. The previous occupant's copy is *parked*, not deleted: it stays in the browser under its own key, so nothing is ever lost to a mistaken comparison.
- **A store that predates this change pulls before it pushes.** It can't be told apart from someone else's by looking at it, so it never pushes on the round that first attributes it — and a snapshot is kept at that moment too.

Two honest notes. The account tag is device-local and never travels as synced data — where a store lives is nobody's health record. And on a refused push the data does reach the Worker before being rejected; it's never stored, but if you'd rather it never left the device at all, say so and I'll add a confirm-first round.

## 1.32.1

**Fixed the model dropdown.** It was an `<input list=…>` (an HTML datalist), which only filters as you type and whose arrow frequently opens nothing at all on Chrome for Android — so it read as broken, correctly.

- **It's a real dropdown now**, listing *Automatic* (follow Google's current Flash model), each known model, and **Something else…** which reveals a text box for a model Google adds after this list was written. A saved model that isn't in the list shows as what's actually in use rather than silently reading as "Automatic".
- **Two links added**: Google's model list, and where API keys live.
- **On keys, plainly:** you don't need a new one to change model. A single Google AI Studio key covers every Gemini model and YR already has one. If it ever needs replacing it's a Worker secret (`GEMINI_API_KEY`) set in the Cloudflare dashboard — the app can't change it, and neither can Claude.

Only the four model names I could actually verify are listed. I left out one I couldn't confirm exists — pinning a name I'd guessed at is precisely what broke the brief yesterday.

## 1.32.0

**The brief stopped generating, and the cause was a model I had pinned.** Today's brief failed with:

> `HTTP 404: This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.6-flash`

Google retired `gemini-2.5-flash`, which was sitting in the Worker's fallback list. Two fixes, and the second matters more than the first:

- **A dead model no longer takes the healthy ones with it.** The retry logic threw on any non-retryable answer — so a 404 from the *second* model in the list aborted before the third was ever tried. One retired name was enough to stop the brief entirely. A dead model is now dropped from the rotation and the next one is tried immediately; only a key or permission problem stops everything, since no model would help there.
- **The list leads with aliases, not pinned versions.** `gemini-flash-latest` is hot-swapped by Google and can't rot; a pinned name is a dated liability. `gemini-2.5-flash` is gone, `gemini-3.7-flash` and `gemini-3.6-flash` are in behind the alias.
- When everything does fail, the error now names **what each model said** rather than only whichever failed last — which is what made this one slower to diagnose than it should have been.

**You can now pick the model yourself** — Settings → *Today's Brief model*. Leave it blank to follow Google's current Flash model automatically, which is right almost always. If Google retires another one and the brief starts failing, you can point it somewhere else without waiting for a code change. A name that's wrong or retired costs one wasted request; the built-in list stays behind your choice as a fallback, so a typo can't break the brief.

## 1.31.2

**Fixed the brief ignoring your journal.** You wrote *"remind me from Thursday onwards to be conscious about the calories intake"* and the brief said nothing about it.

The entry had synced fine and was in the prompt — I checked both. The bug was a rule I'd written into the prompt itself: *"never comment on something HISTORY does not measure."* It was meant to stop the AI inventing statistics, and it did that — but it also silenced every subject the app has no column for. There is no calorie figure, so it stayed quiet about calories. Your journal was being read and then overruled.

- **That rule now governs numbers only.** A subject you raised in your journal is worth writing about whether or not the app measures it.
- **What you tell yourself to do now comes first**, ahead of the statistics. A commitment, a rule you set, or a "remind me to…" is treated as the closest thing to an instruction — and it outranks a drifting figure if only one will fit.
- **Dates you attach are honoured.** Before the date it says the thing is coming; on and after it, it says it applies today. It keeps carrying it until you write that it's done or abandoned. The brief is now told the weekday as well as the date, which is what makes "from Thursday" resolvable at all.

**Hit Refresh on the brief to see it applied.**

## 1.31.1

**Fixed the brief failing on Refresh.** Two separate causes, both now gone:

- **Gemini was answering "this model is currently experiencing high demand" (HTTP 503) and the Worker gave up on the first try** — even though Google's own message says to retry. It now retries through a short backoff and moves between models rather than hammering one, so a busy moment no longer costs you the brief. Errors that will never come good (a bad key, a malformed request) still fail straight away instead of stalling.
- **A failed refresh was throwing away a brief that had already generated fine.** Both failure paths wrote an empty summary over the good one, which made Refresh the thing most likely to lose you your brief. Now the earlier brief is kept and the card says *"Couldn't refresh just now, so this is the brief from earlier"* — you never end up with less than you had.

Also fixed a test that failed roughly one run in sixty depending on the time of day: the prayer fixture was built one minute ahead of the clock, so a minute rolling over mid-test turned it into a different scenario.

## 1.31.0

**Reading and searching the journal.**

- **Tapping an old entry expands it where it is, to read** — the full text, its own paragraph breaks intact — rather than dropping you into editing it. Tap again to fold it. **✏️ Edit this entry** underneath is the only way into the writing box, so a tap meant as "let me look at that" can't change anything.
- **A 🔍 search icon** on the Earlier entries card. It searches every entry you've ever written, not just the ten on screen, and highlights the hit. The preview is centred on the match rather than the top of the entry, since that's rarely where the thing you searched for is. Case-insensitive, and punctuation is searched literally.
- Each entry now shows its word count next to the date.
- **Journal moved next to Calendar** in the bottom bar.

**The brief reads further back.** The journal window was a fixed fortnight; it's now as far back as the prompt budget allows — up to 120 entries or ~14,000 characters, newest first, with today's entry never dropped. The prompt is told how far back it reaches and explicitly to draw on any entry, not just recent ones: an intention from two months ago that never happened is worth more than yesterday's weather.

## 1.30.1

**Fixed the mangled task titles.** A scheduled task's title was wrapping to one character per line. The cause: the title, the due date and the "On calendar" chip were all competing for one row's width, and the date is `white-space: nowrap` — a flex item won't shrink below its own text, so the date and the chip kept their full size while the title (which *can* wrap anywhere) absorbed the entire shortfall.

- **The "On calendar" chip is gone.** A scheduled task is now shown by a **green ring around its 📅 button** — said by the button that put it there, and costing the title no width at all.
- **The title and its date stack** in one column instead of fighting over the row. Measured in Chromium at 390px: the title went from ~1 character wide to 188px, so "Bank statements for donations" reads across two lines instead of twenty-nine.

## 1.30.0

**The brief now reads your whole record, and opens by telling you what to focus on.**

Above the Today/Tomorrow bullets there's now a short paragraph — two or three sentences, no bullets — naming at most two things that are slipping, with the figure that shows it, plus one thing going well. It's judged against the **entire history**, not yesterday: prayers, sleep, weight against your goal, exercise, and your journal entries.

Run over your actual record just now, the figures it gets are:

> Tracking since 2026-07-06 — 42 days. Prayers: 137 of 210 (65%), but 34 of 35 over the last week; most often missed Fajr. Sleep 7.7h average across 16 logged nights — with nothing logged on 26 of the 42. Weight 104.5kg, −3.5kg overall, **+0.7kg across the last month's weigh-ins**. Exercise on 9 of 42 days, 5 of the last 7.

Two things worth knowing about how it works:

- **The numbers are computed here, not by the AI.** Given 400 raw days and asked for an average, a language model produces a plausible number rather than the right one. Everything above is worked out in the Worker and handed over as fact, with the model explicitly told never to recompute one — so the brief can't contradict what the Progress tab shows.
- **Prayers are counted over dates, not records** — the same rule the prayer summary and qada debt use, so all three agree. A day you never opened the app on is five missed.

Also: the separate "Notes" section added yesterday is gone. Your journal now feeds that opening paragraph instead of getting a bulleted list of its own, which is what you asked for.

**To see it today**, hit Refresh on the brief card — it otherwise regenerates at 12:01am.

## 1.29.0

**Two new charts on Progress, and a Journal tab.**

- **Prayers chart.** Prayed-per-day out of five, over every date since your first record — with a 7-day average once there's enough history. It counts *dates*, not just days that happen to have a record, so it agrees exactly with the prayer summary and the qada debt (a date you never opened the app on is five missed, not a missing point). Today is left off, because it isn't finished.
- **Sleep chart.** Hours per night, with your logged nights as the points and a 7h reference line. A night you didn't log is left out rather than drawn as zero — that's missing data, not no sleep. The summary line gives you the average, shortest, longest, and how many nights hit 7h.
- **Journal tab.** A text box for each day, with the same ‹ › Today date bar as Prayers, saved as you type. Underneath it, every earlier entry newest-first — tap one to jump to that day. It writes into the day record's existing `notes` field, so anything you'd already written in the old "Notes for the day" card is still there, and entries sync between devices like everything else.
- **The daily brief reads your journal.** Today's entry plus your recent ones (up to a fortnight) go to the brief, which now ends with a short **Notes** section: things left unfinished, things you said you'd do, patterns across several days. No entries means no Notes section at all.

  **Worth knowing:** this means your journal text is sent to Google's Gemini API when the brief is generated, the same way your calendar events and tasks already are. If you'd rather it didn't, say so and I'll put it behind a switch.

  A journal or task read failing never stops the brief — it's recorded alongside the summary so "why did it ignore what I wrote?" is answerable.

## 1.28.1

**Dhikr is worth three items now, not thirty-seven** — one for morning, one for afternoon, one for evening. A period counts once every item in it is ticked, so finishing a period is the unit rather than each individual phrase. Dhikr no longer dominates the day's score, and the ring goes back to reading like an overall day rather than a dhikr tracker.

## 1.28.0

- **Dhikr counts towards the day now.** Every item across morning, afternoon and evening is part of the completion ring and the Progress trend, so a day with the dhikr left undone reads as unfinished — which is the point of the number.

  Two consequences worth knowing. Dhikr is the biggest list you have, so it now carries most of the score. And because "a full day" is always measured against your *current* routine, past days on the Progress chart are re-scored against it too — so the whole line drops. Say the word if you'd rather each period counted as one item instead of each dhikr counting separately.
- **The bell folds repeats.** The same reminder firing again — an unticked prayer raised in a later window, or reopening the app — updates the row that's already there and restamps it, with a ×N badge, instead of adding another copy. Six identical rows used to push everything else off the list. Different reminders stay separate rows.
- **Clear closes the panel**, rather than leaving it open on an empty list.

## 1.27.1

- **The dates stay on screen.** The day headings are pinned to the top of the grid, and the hour labels to the left, so scrolling down or across never loses track of which day or hour you're looking at. (The grid now scrolls inside itself rather than with the page — that's what makes pinning possible once it scrolls sideways.)
- **Today is the wide column on the phone too**, roughly twice the width of the other days, which are a little narrower to pay for it.
- **It opens on today.** The week runs Monday to Sunday, so opening the tab on a Thursday used to start you three days in the past. Today's column now sits against the left edge; earlier days are a scroll to the left.
- **The phone view is back to its previous size** — hours are compact again rather than the taller desktop spacing.

## 1.27.0

**The calendar is one thing now, on every screen: a Monday–Sunday week.**

- **The colours are the prayer colours.** They were being mixed 30% into the page background, which in dark mode turned them into murky olive and navy. They're now the same colours you see on the swatches in the prayer-times panel — gold for Chasht, cyan for Dhuhr, green for Asr, and so on. Events sit on top as their own cards, so nothing became harder to read.
- **One date row, and it lines up with the columns.** There were two: a week strip above the grid, and the grid's own headings — saying the same thing in columns that didn't match, because the strip's buttons were equal width while the focused column is wider. The strip is gone. Tap any day's heading to focus it.
- **On a phone, the week scrolls sideways.** Columns keep a fixed, readable width and you scroll to reach the rest of the week, instead of the day-plus-two view where swiping resized the columns under you. The hour labels stay pinned to the left edge while you scroll.
- **On a desktop or tablet it still fits**, with the focused day about twice the width of the others.

The day-carousel — swipe to page one day, with the neighbours pre-rendered either side — is gone, along with its drag-and-spring-back machinery. The **‹ ›** arrows page a week, the date picker jumps anywhere, and **Today** comes back.

## 1.26.0

**The desktop calendar is readable without zooming.** Three things were making it unreadable, and only one of them was the type size:

- **Six of the seven days weren't showing text at all.** Only the focused day drew a proper chip; the other six got the narrow colour-block treatment built for a 74px column on a phone. At 170px there's room for the title, so every column now carries one.
- **An hour was 34px tall**, which caps how big the text in a chip can be — a chip is sized to how long the event runs, so a short row means small text. An hour is now **62px** on a desktop or tablet, and the title reads at ~14px instead of ~10px.
- **The prayer tint was doing too much.** The same 30% wash that works on a phone turns a 1900px grid into colour bands. It's 16% in the week layout — still clearly the prayer window, just quieter behind everything else.

Fixed on the way: **the Monday column had no prayer colour.** The times were fetched for the focused day and the days after it, which is right for the phone's day-plus-two view but wrong for a Monday-start week — the first column can be six days *before* the focused one, so it never got any times and rendered as the one white column in a tinted grid.

**Nothing about the phone layout changed.**

## 1.25.5

- **A dhikr item that already has a du'a no longer appears in any other du'a's list.** An item points at one picture, so offering it elsewhere only invited you to silently take the link off the picture that had it. It still shows, ticked, on its own picture, so you can release it there and give it to another. If every item is spoken for, the list says so rather than looking broken.
- **Rotation follows your phone's rotation lock again.** The 1.24.1 fix overshot: `orientation: "any"` in the manifest makes an installed Android copy follow the accelerometer *whether or not* your rotation lock is on, and the app was also releasing the orientation lock itself at startup. Both are gone — the app now says nothing at all about orientation, which is the only setting that defers to the phone.

  As before, an installed copy keeps the old behaviour until Chrome rebuilds the app (all windows closed, charging, on Wi-Fi) — **reinstalling applies it immediately**.

## 1.25.4

**The daily brief is generated at 00:01 instead of 7am**, so it's waiting for you the moment the day starts. It covers the day that has just begun, and nothing is filtered out as "already over" at that hour.

The cron fires at one minute past every hour and the Worker acts only during the midnight London hour. Cron alone can't express this: cron is evaluated in UTC, and London is an hour off UTC for half the year — a fixed `1 0 * * *` would drift to 01:01 every summer.

## 1.25.3

- **A dhikr item with a du'a on it is now a link**, the way a recipe or an exercise is — tap its name to open the picture. The separate 📿 button next to it is gone.
- **The dhikr list on a du'a folds away.** Uploading a picture no longer drops twenty-one checkboxes under it. There's a summary line instead — *"Linked to Morning · Ayat al-Kursi"*, or *"Not linked to a dhikr item yet"* — that opens the list when you tap it and closes it again afterwards. A picture you've just uploaded opens on its list, since choosing where it belongs is the next thing you'd do.

## 1.25.2

**Two devices could genuinely disagree about your prayer history, and one of them was right by accident.** Two separate causes, both fixed:

- **The summary counted records, not days.** It listed only dates that had a record — and a record gets created just by *looking* at a date. So a day you opened the app on but ticked nothing became a permanent "0/5 missed", while a day you never opened at all vanished from the history entirely. Which of those each device happened to hold was arbitrary, so the totals differed. **The history is now a continuous run of dates**, from the first day you have any record for up to yesterday, gaps included. Both devices now reach the same answer from the same dates.
- **Some days could never sync.** Those look-only records carry no modification stamp, and the sync skipped anything unstamped. A record holding real data is now stamped and pushed on the next sync; a record that is still genuinely empty is left alone, so a phantom day isn't spread to your other devices instead.

**This changes your outstanding count.** Days you never opened the app on now count as missed, where before they were simply absent — so the number is higher, and it is the honest one. Tell me if you would rather unlogged days stayed out of it.

**The whole history is reachable.** The table still shows the recent two weeks, with **Show all N days since &lt;date&gt;** underneath to open every day since you started.

## 1.25.1

**Cloud sync is on by default now.** It isn't really optional: this is one record across your own devices, behind your own sign-in, and a device that isn't syncing is quietly keeping a different copy — which is how the prayer summaries came to disagree in the first place. Any device still running with it switched off turns it on once when it updates. The switch stays in Settings, so you can still stop it deliberately, and stopping it sticks.

## 1.25.0

**Sync was pulling your other device's data and then not showing it.** This is the bug behind "the prayer summary doesn't match". A sync redrew the Today tab, Progress and the task list — and nothing else. So a device that pulled another's edits kept showing its own stale prayer summary, qada card, medicine and dhikr lists until you navigated away and came back or reloaded the app. The data had arrived; the screen hadn't been told. Everything that reads your record is now redrawn after a sync, and after restoring a backup.

**It also syncs when you come back to it.** An installed app is resumed rather than reloaded, so the sync it does at startup could be days old and you had to remember to press *Sync now*. Returning to the app after a minute away now syncs on its own.

**Du'as.** Misc → **Duas**: upload a photo or scan of a du'a and tick which dhikr items it belongs to. Those items grow a 📿 button on the Prayers tab that opens the picture full size. Pictures are stored in your own database, so they reach every device you sign in on, and the links ride your synced profile. Pictures are resized in the browser before being sent, and removing one clears every link pointing at it so nothing opens a blank.

**Drag a task where you want it.** The ▲▼ buttons are gone; every task now has a **⠿** grip. Drag it and drop it above or below any other row — grabbing one opens the whole list, since you can't drop onto a row that isn't on screen. Works with a finger and with a mouse.

**Calendar**

- **A whole week on a tablet or desktop.** Monday to Sunday in one grid, lined up with the week strip above it, with the day you're on about twice the width of the rest. The phone keeps the day-plus-two view it had. Rotating a tablet switches between them.
- **The bright outline around the current hour is gone.** The red now-line already marks it, and the ring on top was noise — the same reason the prayer-window ring went in 1.21.1.
- **Chips fit their slot.** The clock time has been dropped from the chip — where it sits in the grid already says when it is — and the text is sized to the height of the slot, so a one-hour appointment shows its whole title instead of "Obstetric appo…". The exact times are still in the tooltip and in the editor.

## 1.24.3

**The icon is sharp now.** It was soft — most visible on the splash screen, where Android scales it up. Two causes, both fixed:

- The icons were resampled straight from the artwork, so they carried its own soft edges, and the tile's silhouette had been cut with a hard threshold that left it slightly ragged. They are now redrawn: the tile as an exact shape, the letters traced to outlines from the 4306px master and rasterised at four times the size before being scaled down. Same mark, same colours, same proportions — only the edges change.
- There was nothing bigger than 512px to scale up from. There is now a **1024px** icon (and a 1024px maskable one), so the splash has something to work with.

**Rearrange your tasks.** The **⇅** button next to *Add* turns on reordering: every task grows a ▲▼ pair, and the whole list opens up so you can move a task anywhere in it, not just among the three Today shows. The order you set is the order it keeps — it outranks the due-date sorting, rides your synced profile, and reaches your other devices. Ticked tasks still gather at the bottom, and a move won't push a task across that line.

## 1.24.2

**The desktop no longer wastes half the screen.** Three things were leaving gaps:

- **Holes under short cards.** The cards sat in a grid, and a grid row is as tall as its tallest card — so a short card left dead space beneath it that nothing could fill. They now flow down columns instead, so each card starts immediately under the one above it and the columns pack tight. Up to **two columns** from 721px, **three** from 1100px and **four** from 1560px.
- **Space down both sides.** The page was capped at 1024px wide however big the window was. That cap is now 1480px, for the page and the header alike.
- **Everything small on a big screen.** Settings → **Appearance → Size** now has five steps, from *Small* to *Largest*. It scales the whole app — text, cards, spacing and controls together — because every measurement in the app is relative to one root size. The choice is remembered on that device and, like the theme and the card layout, is never synced or stored with your health record.

## 1.24.1

**If the installed app still won't rotate, it's the install, not the app.** Removing the portrait lock from the manifest in 1.23.1 was the right fix, but an installed Android copy is a WebAPK whose orientation was decided when it was installed. Chrome only rebuilds that after it notices the manifest differ — and it waits until every window of the app is closed, the phone is charging and on Wi‑Fi, which can easily take a day or two.

- The app now **releases the orientation lock itself on startup**, which can take effect straight away where the manifest hasn't caught up yet.
- The manifest says `"orientation": "any"` outright rather than leaving it out, so there's no ambiguity about what's being asked for.

**If it still won't turn, uninstall and reinstall it** — that rebuilds the WebAPK immediately rather than waiting for Chrome. (Check the phone's own rotation lock isn't on, too.)

## 1.24.0

**Arrange the cards yourself.** Settings → *Arrange your cards* → **Rearrange cards**, and every card grows a small toolbar:

- **⠿ drag it** to a new position — a real drag, on the phone as well as with a mouse.
- **↑ ↓ nudge it** up or down, for when dragging is fiddly.
- **Send it to another tab** — Today, Prayers, Progress and Settings can all take any card.
- **Remove it.** Anything put away is listed under *Put away* in the same place, with a tab to send it back to.

**Reset to default** puts everything back. Your arrangement is kept on the device, like the folded/unfolded state — how the app is laid out never travels with your health data.

Two consequences worth knowing: the date bar on Today now sits above the Brief rather than below it, so the whole tab is one list that can be rearranged; and the Settings cards are in the same grid as everywhere else, so a wide window shows them in columns.

The Calendar and Misc tabs aren't rearrangeable — one is a grid of hours and the other is three sub-panels, so neither is a list of cards that could take one.

## 1.23.1

- **The desktop layout uses the width it has.** Today's Meals was set to span every column, which forced it onto a row of its own and left the space beside Supplements & Drinks empty. It sits beside it now, and a window wider than 1200px gets three columns instead of two. Cards no longer stretch to match the tallest one in their row.
- **The installed app can rotate.** It was pinned to portrait in the manifest, so it wouldn't turn on a tablet or in a desktop window.

## 1.23.0

- **The focused day sizes an event by its length**, like the two peek columns already did. A four-hour birthday is four rows tall instead of one — an event's height came from how much of its title happened to fit, not from when it ends. Half-hour things are half a row and don't stretch to fit their own text, because a chip that grew would be lying about when the event finishes.
- **All-day events can be created.** Tick "All day" when adding something and the time and length give way to a plain date. It goes to Google as a real all-day event, not a timed one with the clock ignored.

Fixed on the way: the "All day" tick appeared to do nothing in a real browser. The `hidden` attribute is only `display:none` from the browser's own stylesheet, so the app's own `display:flex` on that row beat it and the time fields stayed put.

## 1.22.0

- **Pick which calendar a new event goes on.** Adding something from the calendar now offers your writable calendars — Personal, Family, and anything else you can edit — instead of always using the primary one. Calendars you can only read aren't offered, since nothing can be put on them. With just one writable calendar there's no picker, because there's no choice to make.
- **It remembers where you put the last one**, so a run of family events doesn't mean re-picking every time. That preference rides your synced profile, so it follows you between devices. Scheduling a task from the Today list uses the same default rather than quietly disagreeing.
- An **existing** event still says which calendar it's on but doesn't offer to move it — moving between calendars is a different Google operation, and a picker that silently did nothing would be worse than none.

## 1.21.2

- **The next two days draw an event to its real length.** A one-hour appointment in a peek column was a small fixed-size label, the same size as a five-minute one and shorter than the slot it takes up. Each now starts at its own minute within the hour and runs the length of the event — past the cell and into the hours it covers, if it's long enough. Two things at the same hour sit side by side instead of on top of each other.
- **The calendar legend says "Chasht"**, not "Sunrise". It was the last place still naming that window after the astronomical event it starts at.

## 1.21.1

- **The border around the current prayer window is gone from the calendar.** The tint already says which window every minute belongs to, so a second outline on top of it was just noise. The window you're in is still ringed on the Prayers checklist and named on the chip.

Still on the calendar: the coloured hours, the outline on the hour it is now, and the red now-line — only the prayer-window border went.

- **Every card in Settings folds now**, not just the four editors. Google, Cloud sync, Install, Appearance, Reminders and Your data all collapse from their heading, so the tab can be a short index instead of a long scroll. What's folded is remembered per device and, like the other display preferences, never touches your synced record.

## 1.21.0

- **Prayer colours change at the exact minute in the calendar.** A window starting at 8:34 PM now changes the colour 34 minutes down the 8 PM cell, instead of tinting the whole hour with whichever prayer happened to own the half-past mark. As the times drift through the year the boundary drifts with them, minute by minute, rather than jumping an hour at a time. The ring around the window you're in follows the same edges.
- **The Calendar tab opens straight away.** It was sitting blank for seconds on the first visit because it waited for Google's events, then a month of prayer times, then each day's — three round trips in a row — before drawing anything. The grid needs none of that to exist, so it's drawn immediately from what's already stored and fills in as the answers arrive. On a slow connection: **3.9 seconds to first paint, now 0.1**.

## 1.20.5

- **Every time in the app is 12-hour now** — prayer windows, the countdown, the calendar's hour column and its event chips, task due dates, reminders, and the last-saved and last-synced lines in Settings. `1:09 PM`, not `13:09`. Midnight reads `12:00 AM` and noon `12:00 PM`, not `0:00`.

Times are still *held* as 24-hour internally and the prayer API still speaks 24-hour — only what you read changed. One formatter does all of it, so nothing can drift into a different style.

## 1.20.4

Prompted by comparing against a friend's UmmahAPI-backed app side by side.

- **The method list is labelled the way the provider names them.** Aladhan calls method 15 "Moonsighting Committee Worldwide"; the provider calls it **"Moonsighting Committee"** — and if you're trying to match what someone else's app is set to, the name has to be the same one they see. All the labels now follow the provider.
- **Eight more methods reach the primary provider.** Tehran, Kuwait, Qatar, Singapore, Turkey (Diyanet) and Dubai were being sent to the Aladhan fallback for no reason. Only four — Gulf Region, France (UOIF), Russia and Jafari — have no equivalent at the primary, and they're now shown in their own "Aladhan only" group so it's clear which those are.
- **The prayer times screen names the convention it used**, not just the provider: *"Times from UmmahAPI · MoonsightingCommittee · Shafi."* Two apps on the same coordinates can differ by minutes purely because they're on different methods, and that line is what makes it checkable against someone else's screen.

**About those differing times:** two apps on the same spot with different methods *should* differ, and the amounts match exactly. Moonsighting Committee adds 5 minutes to Dhuhr and 3 to Maghrib; Muslim World League adds 1 to Dhuhr and nothing to Maghrib. That is precisely the gap between the two screens — 13:04 vs 13:09, 20:31 vs 20:34. Fajr and Isha matched because at 51°N in August real twilight never arrives and both methods fall back to the same high-latitude rule. Nothing was being pulled wrong; the two were simply set to different conventions, which is now visible at a glance.

## 1.20.3

**A real bug in how prayer times were requested.** UmmahAPI identifies calculation methods by **name** (`MuslimWorldLeague`, `UmmAlQura`, …); the app was sending Aladhan's **numbers**. A number where a name is expected isn't rejected — it's ignored, and you get the provider's default, Muslim World League. Since that happens to be Aladhan's method 3, the default looked perfectly right and **every other method was quietly giving Muslim World League times under the wrong name**. The Asr rule had the same problem: UmmahAPI spells it `Hanafi`/`Shafi`, the app was sending its own lowercase spellings.

- Methods and madhabs are now translated for each provider.
- A method UmmahAPI doesn't support — Gulf, Kuwait, Qatar, Singapore, France, Diyanet, Russia, Dubai, Tehran, Jafari — now **skips UmmahAPI entirely** and goes to Aladhan, which defined those numbers. Falling back is a correct answer; asking for a method the provider doesn't know is a wrong one that looks right.
- **The prayer times screen now says which provider answered**, at the foot. Without it there was no way to tell from the app whether UmmahAPI was being used at all, or whether everything had quietly been served by the fallback — which is exactly the question that turned this up.

## 1.20.2

- **Medicines moved below Today's Meals** on the Today tab. They're taken around the food — pre-breakfast, after-breakfast, after-dinner — so the card now follows the meals rather than sitting above them.

## 1.20.1

- **The Prayers card is just the checklist now.** The location line, the "Next: … in …" countdown, the second prayer chip, the "Update location" button and the settings cog are gone from it — every one of them was already behind the chip in the header, so the card was saying the same thing three times.
- **The chip no longer hides itself** when there's no location saved. It reads "Prayer times" instead, because it's now the only way into the screen where a location gets set — and that button has the map pin the Prayers card used to carry.

## 1.20.0

**One look for a prayer, everywhere it appears.**

- **The prayer times screen is a countdown and a list.** The spiral dial is gone — tapping the chip now gives you the window you're in and how long is left, then every window with its colour and its start and end. The "dial starts at now / Fajr" setting went with the dial it configured; the method, madhab, location and colours are all still there.
- **The Prayers checklist matches it**: a colour bar, the prayer, and its window's start and end — with a ring around whichever one you're in, which moves on its own as the day goes by rather than being fixed at whatever it was when the tab opened.
- **The made-up (qada) card matches it too**, same colour bar and same shape.
- **The calendar rings the prayer window you're in**, in that prayer's own colour, as one box around the run of hours rather than a mark on each — with the current hour still outlined inside it.

**A tidier header.**

- **The completion indicator is a rounded square** beside the bell, not a circle floating in the middle. It still fills round as the day gets ticked off.
- **The logo is larger**, so the mark reads as the app rather than as another button.
- **The "Saved HH:MM" tag is gone.** Settings → Sync now says when the last save landed, whether or not cloud sync is on, so the header can stay on the prayer countdown.

## 1.19.0

**A prayer clock, and prayer times that no longer depend on one provider.**

- **Prayer times now come from the app's own Worker**, which asks UmmahAPI first and falls back to Aladhan by itself. The app neither knows nor cares which one answered, so one provider having a bad day no longer shows up as "couldn't load prayer times". Your coordinates go to the Worker, and on to whichever provider answers — same as before, one hop further back.
- **A prayer chip in the header and on the Prayers tab**: which window you're in, and how long is left of it. Both are drawn by the same code, so they can't disagree, and they retick every few seconds.
- **Tap either chip** for the current window, its span, how long is left, and every window of the day with its colour and times. (This shipped as a spiral dial with an analog face; it was replaced in 1.20.0 by the list that is there now.)
- **Your madhab, in full.** Hanafi, Maliki, Shafi'i or Hanbali — the same setting as the Asr selector in the prayer cog, which now says the same thing. (Only the Hanafi position actually moves Asr; the other three are the same calculation.)
- **Every prayer's colour is yours to change.** Tap a prayer in the clock and pick one; it follows through to the checklist, the calendar's hour tints and the chip. "Use the default colour" hands it back to the theme. The choice rides your profile, so it syncs.
- **Your location is named, not numbered** — "London, United Kingdom" rather than a pair of coordinates — looked up in the background so it never delays the times, with the coordinates shown if the lookup doesn't answer. There's a Reset if you want to clear it and start again.
- **The calendar takes a whole month of prayer times in one request** instead of one per day. If that fails it quietly goes back to fetching each day, so it costs requests, never the calendar.

## 1.18.0

**Today's Brief is a schedule, not a paragraph.**

- **It now covers tomorrow as well as today.** Both days' events and tasks are fetched (one ranged call, so the calendars are still only listed once) and given to the summary separately. Today's already-finished events are dropped as before; tomorrow's are never filtered, whatever the time is.
- **The default format is a plain list**: a `Today` heading, one bullet per event and task with its time, then a `Tomorrow` heading and the same. No sentences, no greeting, no commentary. Overdue tasks come first under Today, marked as overdue. An empty day still gets its heading, with "Nothing scheduled".
- The card renders that as real headings and bullet lists rather than one block of text.

**If you've saved your own instructions**, they still win — including the note you added about refreshing after 7pm, which is no longer needed now that tomorrow is always included. Hit **Reset to default** in Settings → Today's Brief instructions to take the new format.

## 1.17.2

- **The header is the same colour as the rest of the screen** — navy in dark, light in light — instead of a white band. Android's status bar above it matches, and now follows the theme when you switch it rather than sitting at one fixed colour.

## 1.17.1

- **The header is white in both themes**, and so is Android's status bar above it. The header carries its own ink, chip and ring-track colours so everything in it stays readable when the rest of the app is dark.
- **The "Notes for the day" card is gone from Today.** Anything you'd already written is untouched — the field is still in each day's record, so old notes are intact in your data and in exports.

## 1.17.0

- **The next two days are schedulable too.** Tapping an empty hour in either narrow column now opens the editor for *that* day and hour, exactly as the focused day already did. Tapping something already there still opens it instead.
- **Slimmer header:** just the logo, the completion ring, the saved time and the bell. The name and the "Diet · Movement · Medicine…" strapline are gone.
- **Settings has a Google card**, at the top: whether you're connected, and a button to connect or reconnect, with a note on exactly what the connection covers and where to revoke it. It reads the same status the Today's Brief card does, so the two can't disagree.
- **Google Tasks with a time:** a task set for 1pm still shows in the all-day row, and now says why. Google's Tasks API records **only the date** for a task's due — the time of day is discarded before it ever leaves Google, so there is nothing for the app to place it by. Tapping the task explains this rather than silently pretending it's an all-day item.

## 1.16.1

- **Your own logo is now the app icon**, on navy: the artwork you supplied, with the white field replaced by a navy gradient and the letters inverted to white — black letters on navy would have been unreadable. The letterforms, their size and position, and the corner radius are all exactly as you drew them; only the colours changed. The drop shadow baked into the source was trimmed off the edge so it sits cleanly on any background.
- Android's maskable icon is the wordmark on a flat navy field, since its circular crop would otherwise slice the tile's own corners.

## 1.16.0

**The app name and icon really do change now.** They hadn't, and reinstalling couldn't fix it: the service worker never handed over. A new worker sits in "waiting" until every client of the old one is gone, and uninstalling a PWA doesn't unregister its worker or clear its cache — so the old one kept control and kept serving the old manifest and icons. It now takes over immediately, and the app shell is fetched network-first (the cache is there for offline, not for speed), so an identity change lands on the next load instead of whenever the worker happens to turn over.

- **A new logo.** Redrawn as a monoline YR monogram — the letters are drawn as shapes rather than set in a typeface — on a deep navy field with a gold gradient and a hairline gold border. It's built to survive being 32 pixels wide, which the old bevelled version didn't.
- **Google Tasks can be ticked off from the calendar.** Tap one and mark it complete; it completes in Google Tasks itself. This needs permission the app didn't have before, so **you'll need to reconnect Google once** — it'll say so if you try before then.
- **A Google Task with a time now sits at that time.** One due at 1pm was showing as an all-day item, because its due timestamp was being truncated to just the date.
- **A notification bell in the header**, with everything the app has reminded you about — prayer times, due tasks, dhikr — and a dot when there's something new. It records them even when the browser won't let the app raise a real notification, which is exactly when having somewhere to look matters.
- **Reminders fire when you come back to the app**, not only after a refresh. Returning after more than a minute away counts as opening it afresh; a quick flick away and straight back stays quiet.
- **The light/dark switch moved to Settings**, under Appearance, where it can say what it does instead of being an unlabelled glyph in the header.

## 1.15.0

- **New app icon and name.** The app is now just **YR**, with your logo as the icon everywhere — home screen, browser tab, install prompt and the header. The wordmark was recentred (it sat about 6% low) and enlarged slightly so it holds up at favicon size, and the gold was brightened from a muddy ochre so it reads properly against the navy. Android gets a dedicated maskable icon so its circular crop doesn't slice the letters.
- **Google Tasks now show in the Calendar tab.** Previously they only ever fed Today's Brief — the calendar showed your events and your own scheduled tasks, but nothing from Google Tasks. Anything with a due date now appears on that day, marked as a Google Task with the list it came from. They're read-only here, since the app only asks Google for permission to read them.
- **All-day items get their own row** at the top of the day, under the date headings, instead of being buried in the 00:00 slot at the top of a 24-hour grid nobody scrolls back to. All-day events and Google Tasks both live there.
- If Google Tasks can't be read, the calendar says so rather than just looking empty — the same trap that once hid an unenabled Tasks API. Your agenda still loads either way.

## 1.14.1

- **The prayer settings cog is the right size.** It was a fixed 32px square sitting next to a 44px-tall button; it now matches that button's height, is square, has a larger glyph, and highlights while the panel is open.

**Notifications — checked end-to-end in a real browser, and three things were wrong.**

- **On Android, reminders never appeared at all.** Chrome there refuses `new Notification()` — it throws "Illegal constructor" and requires the service worker's `showNotification()` instead. The throw was being swallowed, so the failure was completely silent. Reminders now go through the service worker registration wherever one exists, falling back to the constructor otherwise.
- **Reminders could be silently skipped.** A reminder only fired if a tick of the once-a-minute timer landed on the exact minute of the prayer or task time. Browsers throttle timers in a backgrounded tab, so a tick arriving even 90 seconds late missed the minute entirely and that reminder was never sent. There's now a five-minute grace window; each reminder still only fires once.
- **Enabling reminders mid-session left you in silence.** The "already told you" marker was being set even when the app wasn't allowed to send anything, so everything it had passed over stayed suppressed until a reload. Turning reminders on now brings up the current prayer straight away.
- Opening the app a minute or two after a prayer began used to say the same thing twice — the "not marked yet" nudge and then "X time". It says it once now.
- Overdue **all-day** tasks are excluded from the minute-tick reminders too, matching the opening ones.

## 1.14.0

**Schedule straight from the calendar.**

- **Tap any empty hour** on the Calendar tab and an editor opens on that slot, prefilled with the day and time. Give it a title, pick a length, and it goes onto your Google Calendar.
- **Tap anything already there** to see it in full and change it — rename it, move it, adjust how long it runs, edit the location or notes — or delete it. An event on a calendar you can only read opens read-only, with its fields disabled and no Save button, rather than a form whose save would always fail.
- **Your scheduled tasks now appear on the calendar** alongside real events, marked as tasks. A task scheduled from this app is also a real calendar event, so the two are shown as one entry rather than duplicated; a task whose event never made it to Google still shows from the local record. Editing one from the calendar renames the task too, and "Remove from calendar" unschedules it without deleting the task itself. You can tick it done straight from there.
- A swipe that pages the day no longer counts as a tap on whatever was under your finger.

**Reminders when you open the app.**

- Opening the app (or coming back to it) now nudges you about **the prayer whose window you're currently in, if it isn't ticked yet** — and before Fajr that's still last night's Isha, checked against yesterday, which is the one most likely to be sitting unmarked.
- It also raises **scheduled tasks that are due and still open**, as one notification rather than a pile of them.
- **All-day items are deliberately left out.** They aren't due at any particular moment, so treating them as overdue would mean a notification every single time. Nothing fires at all unless you've granted notification permission, and returning to the app inside the same prayer window stays quiet.

## 1.13.1

- **Prayer time settings moved behind a cog** next to "Update location", instead of a picker sitting inline on the card.
- **Asr school of thought is now selectable** — Standard (Shafi'i, Maliki, Hanbali) or Hanafi, which puts Asr roughly an hour later. It's stored on the synced profile and included in the times cache key alongside the calculation method, so changing it refetches rather than showing stale times.

## 1.13.0

- **Renamed to YR Dashboard**, and the "Others" tab is now **Misc** with a new icon.
- **Calendar: the date bar and week strip are pinned.** They stay put while the day scrolls past them — and the day now scrolls with the *page* rather than inside its own box.
- **Calendar: the next two days are full days, not summaries.** All three columns share one grid, so every row is the same hour across them, with the same prayer-window colours; the neighbours are simply narrower. Tap either heading to bring it into focus.
- **Brighter, more distinguishable prayer colours.** Dhuhr and Asr were both blue-ish and Fajr and Isha were both indigo; they're now cyan/green and indigo/violet respectively, and the whole palette is brighter.
- **Prayer calculation method is selectable** — a picker sits next to the location button with the common conventions (Muslim World League, ISNA, Karachi, Umm al-Qura, Egyptian, Diyanet, Moonsighting Committee and more). It's stored on the synced profile, and the times cache per method so switching refetches cleanly.

## 1.12.0

- **Settings: supplements & drinks are now editable** — rename, re-cost (the calorie figure feeds the meal totals), remove or add your own. Like the medicine list, it lives on the synced profile and past days keep whatever they were ticked with.
- **Settings: dhikr is editable per period** — morning, afternoon and evening each have their own list, so they no longer have to be identical. Add or remove whatever you actually recite.
- **Calendar: the next two days now sit beside today** as narrow "what's coming" columns, so you can see what's ahead without swiping. Tap either to jump to it. Today keeps its full-width hour grid, which now scrolls inside its own box so the peek columns stay on screen as you move through the hours.

## 1.11.0

**Two real sync bugs fixed — this is why the desktop was showing stale data.**

- **Tasks never synced at all.** They lived outside the sync payload, so a task added on the phone could never appear anywhere else. They now ride the synced profile, and a device upgrading from the old layout carries its existing local tasks across.
- **Progress could silently stop syncing in both directions.** The `since` watermark was set from the *server's* clock but compared against `updated_at` stamped by each *device's* clock. A few seconds of skew was enough for a device's own edits to be silently skipped on push, and another device's edits to be silently skipped on pull — while sync still reported success. Every sync now reconciles the full set (chunked if large), which removes that entire class of bug. The server still applies last-write-wins, so re-sending unchanged days is a no-op.

**New tabs**

- **Prayers** — the Salah checklist, prayer times, Dhikr, the prayer summary and made-up (qada) prayers all moved here, with their own date bar.
- **Settings** — cloud sync, install as an app, reminders and your data moved out of Progress, joined by two new things below.
- Progress is now just progress: stats, weight trend, completion trend, and **Your targets moved to the end**.

**Settings additions**

- **Your medicines are editable** — rename or remove any of them, add your own. The Today checklist and the completion maths follow immediately, and past days keep whatever they were ticked with, so removing one never rewrites history.
- **Today's Brief instructions are editable.** Change what the summary should do; your calendar events and tasks are always appended below, so a custom prompt can change tone or focus but can't detach the brief from real data. Blank means the default. Stored server-side, since the 7am cron generates the brief with no browser involved.

**Other**

- **The brief no longer pulls tasks with no due date** — those are a backlog, not part of today. It mentions how many are sitting there and leaves it at that.
- Calendar event text is a little larger.

## 1.10.0

- **Meals, Recipes and Movement are now one "Others" tab**, with three sub-tabs across the top to switch between them. The bottom bar is down to four: Today, Calendar, Others, Progress. Swiping inside Others steps through its sub-tabs first and only then moves on to the next tab. A device that still remembers one of the old tabs lands on the matching sub-tab rather than falling back to Today.
- **Progress — prayer summary:** removed the per-prayer chip row above the prayer history. The overall summary sentence stays, but the per-prayer breakdown now lives only in the Made-up (qada) card directly below it, which already shows what each prayer owes *and* lets you adjust it.
- **Progress — the per-day history table is replaced by a Daily completion trend chart**, moved up to sit directly under the weight trend. It plots each logged day's completion as a percentage (a fully ticked day is 100%), with a dashed 7-day average once there's enough history, and grows to include every day you log. Underneath it reports days logged, average, best, and how many full days you've had.
- The completion ring at the top of the app and the new chart now share one calculation, so they can't disagree about what a day was worth.

## 1.9.0

**Calendar rebuilt around a single day.**

- **The day you're on now fills the card** — full-width hour rows with readable event chips (time, title, and the source calendar + location beneath). It is the point of the screen rather than one column among seven.
- **Swiping is a real carousel.** The previous and next day are rendered either side, so dragging slides them into view following your finger — you see the day you're moving to while you move to it. Releasing completes the slide, then the track re-centres silently.
- **No more stutter on swipe.** Events are fetched a padded window at a time (a fortnight around the day in view) and kept in memory, so changing day is a pure transform: nothing is re-fetched or rebuilt mid-animation, which is what was causing the lag and the flicker.
- A compact **week strip** above the day shows where you are and jumps to any day in the week; the **‹ › arrows still move a week at a time**.

**Today's Brief — fixed to actually see everything.**

- **Google Tasks were being dropped.** Three separate causes, all fixed: the request filtered server-side on a due-date window, which silently excluded every task with **no due date** and every **overdue** task; the per-list page size was left at Google's default of 20, truncating longer lists; and every failure was swallowed into an empty list, so a problem was indistinguishable from "you have no tasks". Tasks are now bucketed into **due today / overdue / no due date** and all three go into the summary, overdue first.
- **Hidden and secondary calendars were being missed.** `calendarList` excludes calendars you've unticked in the Google Calendar UI unless `showHidden` is set — so events on a sub-calendar could silently never reach the brief. Now included, and the per-calendar event cap is raised so a busy day isn't truncated.
- The prompt now explicitly asks for **all of it** — every calendar and every task bucket — and to lead with overdue work.
- If Google Tasks specifically fails, the brief still generates but **says so** underneath, with the reason, instead of quietly looking like you have nothing to do.

## 1.8.1

- **Calendar: the focused day is now much bigger** — four times the width of the other days rather than twice, so it's genuinely readable. The narrow days show a coloured bar per event (enough to see that something's on) and you slide to a day to read it.
- **Swiping now slides between days inside the week**, which is what the gesture should do when a week is on screen; the **‹ › arrows move between weeks**. Changing the focused day animates the columns and needs no refetch, since the week's data is already loaded. Swiping past Sunday (or before Monday) carries on into the neighbouring week rather than dead-ending.
- **Stronger colour contrast** on the prayer-window bands and the hour labels, so the day's shape is clear at a glance. The tint is a single `--cal-tint` token, set deeper in dark mode where the palette is paler.
- **Removed the duplicate row of prayer names** under the Today-tab prayer tracker — each prayer's name and time already appear on its own checklist row, so the chips below were saying it twice. The "Next: … in …" countdown stays.
- **Better location button**: a drawn map-pin icon instead of the 📍 emoji, and it reads "Update location" once you've already set one.

## 1.8.0

- **"+N more" on the Today task list is now a button** — tapping it expands the full list in place on the Today tab, and turns into "Show fewer". Expanding stays put while you tick things off. The separate task list has been **removed from the Calendar tab**, which is now just the calendar.
- **Calendar is a full week view.** Seven day columns share one hour-by-hour grid, with the day in focus given **double the width** of the others so it stays readable on a phone — today by default, and tapping any day heading expands that day instead. Prayer-window colour bands are computed per day, and the current hour is marked (with the now-line) in today's column only.
  - Swiping and the ‹ › buttons now move **a week at a time**, with the same sliding transition.
  - The whole week is fetched in **one ranged request** (`GET /api/calendar/events?date=…&end=…`) rather than seven separate ones, so the server lists your calendars once instead of seven times. An absent, malformed or backwards `end` still means a single day, so nothing else changes.
- **The tab you were on is remembered across a refresh.** Reloading (or reopening the installed app) puts you back where you were instead of always on Today; an unrecognised stored tab falls back to Today.

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
