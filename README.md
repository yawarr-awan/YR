<p align="center">
  <img src="icons/logo.png" width="120" alt="YR logo">
</p>

<h1 align="center">YR</h1>

<p align="center">
  A private, offline-first daily wellness tracker — diet plan, quick halal recipes,
  gentle joint-friendly exercises, supplements, medicines, prayers, water, weight and
  progress. <b>All your data is stored on your own device.</b>
</p>

<p align="center">
  <b>Live app:</b> <code>https://yr-wellness.yawar-awan.workers.dev</code> — gated by
  Cloudflare Access, restricted to one email. This is the canonical, private deployment;
  the old public GitHub Pages copy has been retired since it has no way to require sign-in.
</p>

---

## ✨ Features

- **Today's Brief** — an AI summary of your day at the top of the Today tab, generated from every Google calendar you have access to plus your Google Tasks due today, via Gemini, automatically each morning.
- **Task list** — quick-add a task at the top of the Today tab. It shows the few most pressing ones and expands to the full list in place; each task has a 📅 button to pick a time and put it straight on your Google Calendar.
- **Google Tasks on the calendar** — anything in Google Tasks with a due date shows on that day, alongside your events and your own scheduled tasks. A task with a time sits at that time; one with only a date sits in the all-day row. Tap it to mark it complete, and it completes in Google Tasks itself.
- **Calendar tab** — one day at a time, full width, across all your Google calendars, with every hour tinted by whichever prayer's time window it falls in. Swipe to slide between days (the next day follows your finger into view); a week strip above jumps to any day, and the ‹ › buttons move a week at a time.
- **Schedule from the calendar** — tap an empty hour to add something at that time, or tap anything already there to change it, move it, or delete it. Your scheduled tasks show up on the grid too, marked as tasks, and can be edited or ticked off from there. Events on calendars you can only read open read-only.
- **Opening reminders** — when you open the app it nudges you about the prayer you're currently in if it isn't ticked yet, and about any scheduled task that's due and still open (all-day items excluded, since they aren't due at a moment).
- **Made-up (qada) prayers** — record prayers you've since made up and they come off your outstanding count, without rewriting the history of what you prayed on the day.
- **Built for a phone** — four bottom tabs (Today, Calendar, Others, Progress), swipe between them, and collapsible cards (each showing its progress in the heading) so the day fits on one screen. It remembers which tab you were on across a refresh.
- **Progress trend** — a daily completion chart showing what percentage of each day you ticked off, with a 7-day average line, alongside the weight trend.
- **Live prayer times** — opt-in location-based prayer times, served by the app's own Worker (UmmahAPI, falling back to Aladhan automatically), with a next-prayer countdown and each prayer's time on the checklist. The same colours tint the Calendar tab's hours, and every prayer's colour can be changed.
- **Prayer clock** — a chip in the header and on the Prayers tab shows the window you're in and how long is left; tapping it opens a spiral dial of the whole day with an analog face inside it, along with your calculation method, madhab (Hanafi/Maliki/Shafi'i/Hanbali), whether the dial starts at now or at Fajr, your saved location and the per-prayer colours.
- **Dhikr tracker** — a morning/afternoon/evening checklist alongside your prayers.
- **In-app reminders** — optional browser notifications (while the app is open) for prayer times, dhikr periods, and scheduled task due times, plus a notification bell in the header keeping a log of them all — including when the browser won't let the app raise a real one.
- **Today dashboard** — one screen for your whole day, with a completion ring.
- **Diet plan** — a tasty 7-day halal rotation (~1,300–1,400 kcal/day incl. supplements), high-protein and anti-inflammatory. Each meal name links to its full recipe.
- **Recipe library** — 20+ quick recipes (10–20 min) with ingredients, method, calories and protein.
- **Gentle exercises** — 5 arthritis-safe sessions, each under 15 minutes, with a **Watch a demo on YouTube** link.
- **Daily supplements & drinks** — collagen, whey, creatine, milk and milk tea.
- **Medicines** — pre-breakfast, after breakfast, after dinner.
- **Prayer tracker** — all 5 daily prayers, plus a **missed-prayer summary** in Progress.
- **Body & wellbeing** — water, weight, sleep, steps, and joint-pain & energy sliders.
- **Progress** — weight trend, daily completion trend, prayer summary and made-up prayers.
- **Light / dark theme** toggle.
- **Backup & restore** — export/import your data as a JSON file.
- **Installable as a real app** — a service worker caches the app shell for offline loads; the Progress tab has a working "Install app" button on Chrome/Edge/Android, and Share → Add to Home Screen guidance on iOS.

## 📦 What's in here

```
wellness-tracker/
├── index.html              # the app (open it directly, or host it)
├── manifest.webmanifest    # PWA metadata (installable to home screen)
├── favicon.ico             # browser tab icon
├── icons/                  # app icons (16–512px, apple-touch, logo)
├── README.md
├── LICENSE
├── CHANGELOG.md
├── .gitignore
└── .nojekyll               # tells GitHub Pages to serve files as-is
```

## 🚀 Use it

For this deployment, just open `https://yr-wellness.yawar-awan.workers.dev`, sign in via
Cloudflare Access, and **Add to Home Screen** — it installs like an app. The options
below are for anyone hosting their own copy of this app elsewhere.

**Option A — just open it.** Double-click `index.html` (or open it in any browser). It works fully offline; your data saves automatically.

**Option B — host it on GitHub Pages** (works, but note: GitHub Pages is fully public and cannot require sign-in — there is no server to check a password against. For anything private, put it behind Cloudflare Access instead, as this deployment does):

1. Create a new repository on GitHub (e.g. `wellness-tracker`).
2. Upload these files (or push them — see below).
3. Repo **Settings → Pages → Build and deployment → Source: Deploy from a branch**, pick `main` / root, **Save**.
4. After a minute your app is live at `https://<your-username>.github.io/wellness-tracker/`.
5. On your phone, open that link and **Add to Home Screen** — it installs like an app.

### Push from your computer

```bash
git remote add origin https://github.com/<your-username>/wellness-tracker.git
git branch -M main
git push -u origin main
```

## 💾 Your data & privacy

- Everything you log is saved **only on your device**, in your browser's `localStorage`. By default nothing is uploaded anywhere — there is no server and no account.
- **Yes, it saves your progress when hosted on GitHub Pages too** — because it uses the same on-device storage, tied to the page's web address.
- Because it's device-side storage, please note:
  - **Per device + per browser.** Your phone and your laptop keep *separate* logs unless you turn on cloud sync (below). Use **Export / Import** (Progress tab) to move data between them or to keep a backup either way.
  - **Don't use "Clear browsing data / site data"** for this site, or your history will be wiped.
  - **On iPhone/Safari:** add the app to your **Home Screen**. Safari can clear a website's storage after ~7 days of not visiting it, but a home-screen (installed) app is far more durable. Export a backup now and then to be safe.
- **Optional cloud sync.** The Progress tab has an off-by-default "Enable cloud sync" toggle. Turning it on backs your data up to a private Cloudflare backend and lets your devices share one history via last-write-wins merging. It stays off until you switch it on — no data leaves your device otherwise.
- **This deployment is private.** `yr-wellness.yawar-awan.workers.dev` sits behind Cloudflare Access, restricted to one email — visiting it requires signing in first. The old public GitHub Pages copy has been retired for the same reason: static hosting has no server-side way to check a password or session, so it could never actually be made private.
- **Optional Google Calendar connection.** The "Today's Brief" card, the Calendar tab, and "Schedule to Calendar" are off until you click "Connect Google Calendar." Once connected, the server reads events across all calendars you have access to and your Google Tasks (never Gmail, never anything else in your Google account) to generate a short AI summary via the Gemini API, and can create new calendar events when you explicitly schedule a task. Nothing is read or written unless you connect it, and disconnecting is as simple as revoking access at [myaccount.google.com/permissions](https://myaccount.google.com/permissions).
- **Live prayer times require your location.** Nothing is fetched until you tap "Use my location". Your coordinates are saved locally and sent to this app's own Worker, which passes them to a free prayer-times API (UmmahAPI, or Aladhan if that doesn't answer). They are also sent once to a keyless reverse-geocoding endpoint purely to turn them into a place name for display; if that fails, the coordinates are shown instead and nothing else changes.
- **Notifications are foreground-only.** Reminders only fire while the app tab is open; there is no push notification server and nothing is sent off your device for this feature.
- **Tasks are currently local-only** — they are not yet included in cloud sync, so a task list is per-device until that's added.

## 🩺 Health disclaimer

This app is a personal wellbeing tool and **is not medical advice**. The calorie targets are intentionally aggressive; combined with arthritis and regular medication, please have a **GP, pharmacist or dietitian** review the plan before and while you follow it. If you feel dizzy, very fatigued or unwell, eat more and seek advice. Exercise only within a comfortable, pain-free range.

## 📄 License

Released under the [MIT License](LICENSE).
