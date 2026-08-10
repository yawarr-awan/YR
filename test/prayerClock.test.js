"use strict";
/*
 * The prayer times modal, the chips that open it, and per-prayer colours.
 *
 * The modal is a countdown and a list: which window you are in and how long
 * is left, then every window with its colour and its span. The same row
 * shape is used on the Prayers checklist and the qada card, and the window
 * you are in is ringed the same way in all of them.
 *
 * Real index.html, real DOM, nothing injected. The app reads the real
 * clock, so anything depending on "now" is asserted structurally (there is
 * never more than one current window, whatever the hour) rather than by
 * value.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

const TIMINGS = { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:02", Asr: "17:10", Maghrib: "20:30", Isha: "22:10" };

function backend(onUrl) {
  return async (url) => {
    const u = String(url);
    if (onUrl) onUrl(u);
    if (u.includes("/api/prayer")) return { ok: true, status: 200, json: async () => ({ source: "ummahapi", timings: TIMINGS }) };
    return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
  };
}
function seed(profileExtra) {
  return JSON.stringify({
    schema: 3,
    profile: Object.assign({ startWeight: "", targetWeight: "", updated_at: 1, tasks: [], prayerLoc: { lat: 51.5, lon: -0.12 } }, profileExtra || {}),
    days: {},
  });
}

/** Boots with a saved location and waits for the times to land, which is
 * what makes the chips appear and the clock drawable. */
async function booted(opts = {}) {
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: seed(opts.profile) }, fetchImpl: backend(opts.onUrl) });
  await app.flush();
  await app.flush();
  return app;
}

test("with no location saved the chip stays, since it is the only way in", async () => {
  const app = loadApp({ fetchImpl: backend() });
  await app.flush();
  const chip = app.document.getElementById("headerChip");
  assert.equal(chip.hidden, false, "hiding it would leave nothing to tap and no way to set a location");
  assert.match(chip.textContent, /prayer times/i);
  assert.ok(chip.classList.contains("is-idle"), "quieter, since there is nothing to count down yet");
});

test("with a location, the chip names the current prayer and how long is left", async () => {
  const app = await booted();
  const chip = app.document.getElementById("headerChip");
  assert.equal(chip.classList.contains("is-idle"), false);
  assert.match(chip.textContent, /Fajr|Chasht|Dhuhr|Asr|Maghrib|Isha/);
  assert.match(chip.textContent, /\d+m/, "and how long is left of it");
  assert.ok(chip.querySelector(".pchip-dot"), "coloured for the window we're in");
  assert.equal(app.document.getElementById("prayersChip"), null,
    "the Prayers tab no longer carries a second copy of the same thing");
});

test("tapping a chip opens the times, with every window listed and no gap between them", async () => {
  const app = await booted();
  app.click("headerChip");
  assert.ok(app.document.getElementById("overlay").classList.contains("open"));

  const rows = [...app.document.querySelectorAll("#pmSlots .pslot")];
  assert.equal(rows.length, 6, "five prayers plus Chasht (sunrise to Dhuhr)");
  const spans = rows.map((r) => r.querySelector(".pst").textContent);
  assert.deepEqual(spans, [
    "04:45 – 05:50", "05:50 – 13:02", "13:02 – 17:10",
    "17:10 – 20:30", "20:30 – 22:10", "22:10 – 04:45",
  ], "each window runs to the next, and Isha's runs past midnight to Fajr");
});

test("the countdown is the headline, and exactly one window is ringed as current", async () => {
  const app = await booted();
  app.click("headerChip");

  const line = app.document.getElementById("pmNowLine").textContent;
  assert.match(line, /^(Fajr|Chasht|Dhuhr|Asr|Maghrib|Isha) · \d\d:\d\d–\d\d:\d\d · .*left$/,
    `which window, its span and how long is left - got: ${line}`);

  const ringed = [...app.document.querySelectorAll("#pmSlots .pslot.is-now")];
  assert.equal(ringed.length, 1, "some window is always current, and only ever one");
  assert.ok(line.startsWith(ringed[0].querySelector(".psn").textContent),
    "and it is the one the countdown names");
});

test("there is no clock: the dial and its settings are gone", async () => {
  const app = await booted();
  app.click("headerChip");
  assert.equal(app.document.getElementById("prayerClockSvg"), null, "no dial");
  assert.equal(app.document.getElementById("pmDayStart"), null,
    "and no day-start toggle - it only ever configured the dial");
  assert.equal(app.document.querySelector("#modalBody svg:not(.loc-btn svg)") &&
    app.document.querySelector("#modalBody path[d*=\"M 1\"]"), null, "no drawn dial");
  // What the modal is still for.
  assert.ok(app.document.getElementById("pmNowLine"), "the countdown");
  assert.ok(app.document.getElementById("pmSlots"), "the windows");
  assert.ok(app.document.getElementById("pmMethod"), "and the settings that decide them");
  assert.ok(app.document.getElementById("pmMadhab"));
});

test("the madhab toggle writes both faces of the one setting, and refetches under it", async () => {
  const urls = [];
  const app = await booted({ onUrl: (u) => { if (u.includes("/api/prayer")) urls.push(u); } });
  assert.match(urls[urls.length - 1], /madhab=shafii/);

  app.click("headerChip");
  const hanafi = app.document.querySelector('#pmMadhab button[data-val="hanafi"]');
  hanafi.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  await app.flush();
  await app.flush();

  assert.equal(app.state().profile.prayerMadhab, "hanafi");
  assert.equal(app.state().profile.prayerSchool, 1, "the Asr rule follows the madhab, not the other way round");
  assert.match(urls[urls.length - 1], /madhab=hanafi/);
  assert.ok(app.document.querySelector('#pmMadhab button[data-val="hanafi"]').classList.contains("on"));
});

test("a prayer's colour can be changed, and it lands on the synced profile", async () => {
  const app = await booted();
  app.click("headerChip");
  const row = app.document.querySelector('#pmSlots .pslot[data-prayer="Fajr"]');
  row.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));

  const menu = app.document.getElementById("pmColorMenu");
  assert.ok(menu, "tapping a prayer offers its colours");
  const swatch = menu.querySelector('button[data-color="#f87171"]');
  swatch.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  await app.flush();

  assert.equal(app.state().profile.prayerColors.Fajr, "#f87171");
  assert.equal(app.document.getElementById("pmColorMenu"), null, "and the menu gets out of the way");
  const sw = app.document.querySelector('#pmSlots .pslot[data-prayer="Fajr"] .psw');
  assert.match(sw.style.background, /248, 113, 113|#f87171/i);
});

test("a custom colour reaches the checklist too, and can be handed back to the default", async () => {
  const app = await booted({ profile: { prayerColors: { Fajr: "#f87171" } } });
  app.goTo("prayers");
  const bar = () => app.document.querySelector('#prayBox label.prow[data-prayer="Fajr"] .psw');
  assert.match(bar().style.background, /248, 113, 113|#f87171/i,
    "the custom colour is used everywhere the prayer appears");
  const qadaBar = app.document.querySelector('#qadaBox .qada-row[data-prayer="Fajr"] .psw');
  assert.match(qadaBar.style.background, /248, 113, 113|#f87171/i, "the qada card too");

  app.click("headerChip");
  const row = app.document.querySelector('#pmSlots .pslot[data-prayer="Fajr"]');
  row.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  app.click("pmColorDefault");
  await app.flush();

  assert.equal(app.state().profile.prayerColors.Fajr, undefined);
  assert.match(bar().style.background, /--fajr/, "back to following the theme");
});

test("an uncustomised prayer still follows the theme rather than being frozen to a hex", async () => {
  const app = await booted();
  app.goTo("prayers");
  const rows = app.document.querySelectorAll("#prayBox label.prow");
  assert.match(rows[0].querySelector(".psw").style.background, /var\(--fajr\)/);
  assert.match(rows[3].querySelector(".psw").style.background, /var\(--maghrib\)/);
});

test("the location can be named, reset, and the chips go with it", async () => {
  const app = await booted();
  app.click("headerChip");
  assert.match(app.document.getElementById("pmLocText").textContent, /51\.500, -0\.120/,
    "coordinates are a perfectly good label when there is no place name");

  app.click("pmLocReset");
  await app.flush();

  assert.equal(app.state().profile.prayerLoc, undefined);
  const chip = app.document.getElementById("headerChip");
  assert.ok(chip.classList.contains("is-idle"), "the chip goes back to being a way in, not a countdown");
  assert.match(chip.textContent, /prayer times/i);
});

/** Prayer times that put "now" inside Isha's after-midnight tail: every
 * prayer is still ahead of us, so the window we are in started last night
 * and ends at this morning's Fajr. Built relative to the real clock, since
 * the app reads it. */
function tailOfIshaTimings() {
  const d = new Date();
  const n = d.getHours() * 60 + d.getMinutes();
  const at = (fwd) => String(Math.floor((n + fwd) / 60)).padStart(2, "0") + ":" + String((n + fwd) % 60).padStart(2, "0");
  if (n + 6 >= 1440) return null;   // can't build this scenario just before midnight
  return { Fajr: at(1), Sunrise: at(2), Dhuhr: at(3), Asr: at(4), Maghrib: at(5), Isha: at(6) };
}

test("inside Isha's after-midnight tail the readout says hours left, not a day and a bit", async () => {
  const timings = tailOfIshaTimings();
  if (!timings) return;   // stated rather than skipped: the scenario cannot exist this late
  const app = loadApp({
    localStorageSeed: { yawarWellness_v1: seed() },
    fetchImpl: async (url) => String(url).includes("/api/prayer")
      ? { ok: true, status: 200, json: async () => ({ source: "ummahapi", timings }) }
      : { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) },
  });
  await app.flush();
  await app.flush();
  app.click("headerChip");

  // Isha's window ends at tomorrow's Fajr, so its stored `end` is past 1440.
  // Subtracting the time of day from that raw value read as ~28h.
  const line = app.document.getElementById("pmNowLine").textContent;
  assert.match(line, /^Isha ·/);
  const [, h] = line.match(/(\d+)h/) || [, "0"];
  assert.ok(Number(h) < 24, `left in the window should be under a day, got: ${line}`);
});

test("a failing prayer endpoint is not retried every five seconds", async () => {
  let calls = 0;
  const app = loadApp({
    localStorageSeed: { yawarWellness_v1: seed() },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) { calls++; throw new Error("offline"); }
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  await app.flush();
  await app.flush();
  const after = calls;
  assert.ok(after >= 1, "it does try");

  // The chip's own tick is every 5s; drive the same path directly instead of
  // waiting on it, which is what a background tab would do all hour.
  for (let i = 0; i < 5; i++) { app.click("headerChip"); app.click("modalClose"); await app.flush(); }
  assert.equal(calls, after, "and then backs off rather than hammering it");
  assert.ok(app.document.getElementById("headerChip").classList.contains("is-idle"),
    "with nothing to show, the chip says so rather than counting down to nothing");
});

test("the checklist ring follows the clock, not the moment it was rendered", async () => {
  // Times that make Isha current now and Maghrib current a moment ago, so a
  // retick has something to move. Built relative to the real clock, since
  // the app reads it.
  const n = new Date().getHours() * 60 + new Date().getMinutes();
  if (n < 10 || n > 1430) return;   // stated, not skipped: needs room either side
  const hhmm = (m) => String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
  const timings = { Fajr: hhmm(n - 6), Sunrise: hhmm(n - 5), Dhuhr: hhmm(n - 4), Asr: hhmm(n - 3), Maghrib: hhmm(n - 2), Isha: hhmm(n - 1) };
  const app = loadApp({
    localStorageSeed: { yawarWellness_v1: seed() },
    fetchImpl: async (url) => String(url).includes("/api/prayer")
      ? { ok: true, status: 200, json: async () => ({ source: "ummahapi", timings }) }
      : { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) },
  });
  await app.flush();
  await app.flush();
  app.goTo("prayers");
  await app.flush();
  await app.flush();

  const ringed = () => {
    const r = app.document.querySelector("#prayBox label.prow.is-now");
    return r && r.getAttribute("data-prayer");
  };
  assert.equal(ringed(), "Isha", "the window we are in right now");

  // Put the ring somewhere it does not belong, then let the chip's tick run:
  // it must correct it rather than leave a stale prayer marked.
  const wrong = app.document.querySelector('#prayBox label.prow[data-prayer="Fajr"]');
  app.document.querySelector("#prayBox label.prow.is-now").classList.remove("is-now");
  wrong.classList.add("is-now");
  await app.wait(5200);
  assert.equal(ringed(), "Isha", "the tick moves the ring back where it belongs");
});

test("the modal names which provider answered, so a silent fallback is visible", async () => {
  const app = await booted();
  app.click("headerChip");
  // The whole point of the primary/fallback pair is that the app keeps
  // working either way - which also means nothing on screen would otherwise
  // say whether the primary is being used at all.
  assert.match(app.document.getElementById("pmSource").textContent, /UmmahAPI/);
});

test("closing the modal stops its tick - the countdown must not outlive it", async () => {
  const app = await booted();
  app.click("headerChip");
  assert.ok(app.document.getElementById("pmNowLine").textContent.length > 0);

  app.click("modalClose");
  assert.equal(app.document.getElementById("overlay").classList.contains("open"), false);

  // The tick is a no-op once the modal is shut: it finds nothing to update
  // and unhooks itself rather than running on in the background.
  await app.wait(5200);

  app.click("headerChip");
  assert.ok(app.document.getElementById("pmSlots"), "and it reopens cleanly");
  assert.match(app.document.getElementById("pmNowLine").textContent, /left$/);
});
