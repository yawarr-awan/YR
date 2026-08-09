# Changelog

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
