<p align="center">
  <img src="icons/logo.png" width="120" alt="Wellness Tracker logo">
</p>

<h1 align="center">Wellness Tracker</h1>

<p align="center">
  A private, offline-first daily wellness tracker — diet plan, quick halal recipes,
  gentle joint-friendly exercises, supplements, medicines, prayers, water, weight and
  progress. <b>All your data is stored on your own device.</b>
</p>

---

## ✨ Features

- **Today dashboard** — one screen for your whole day, with a completion ring.
- **Diet plan** — a tasty 7-day halal rotation (~1,300–1,400 kcal/day incl. supplements), high-protein and anti-inflammatory. Each meal name links to its full recipe.
- **Recipe library** — 20+ quick recipes (10–20 min) with ingredients, method, calories and protein.
- **Gentle exercises** — 5 arthritis-safe sessions, each under 15 minutes, with a **Watch a demo on YouTube** link.
- **Daily supplements & drinks** — collagen, whey, creatine, milk and milk tea.
- **Medicines** — pre-breakfast, after breakfast, after dinner.
- **Prayer tracker** — all 5 daily prayers, plus a **missed-prayer summary** in Progress.
- **Body & wellbeing** — water, weight, sleep, steps, and joint-pain & energy sliders.
- **Progress** — weight-trend chart, prayer summary, history table, and streak-style completion.
- **Light / dark theme** toggle.
- **Backup & restore** — export/import your data as a JSON file.

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

**Option A — just open it.** Double-click `index.html` (or open it in any browser). It works fully offline; your data saves automatically.

**Option B — host it on GitHub Pages** (recommended, so you can add it to your phone):

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

## 🩺 Health disclaimer

This app is a personal wellbeing tool and **is not medical advice**. The calorie targets are intentionally aggressive; combined with arthritis and regular medication, please have a **GP, pharmacist or dietitian** review the plan before and while you follow it. If you feel dizzy, very fatigued or unwell, eat more and seek advice. Exercise only within a comfortable, pain-free range.

## 📄 License

Released under the [MIT License](LICENSE).
