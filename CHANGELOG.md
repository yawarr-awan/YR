# Changelog

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
