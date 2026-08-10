"use strict";
/*
 * The prayer spiral clock, the chips that open it, and per-prayer colours.
 *
 * The whole day is drawn as one turn of a spiral - angle carries the time,
 * radius carries how far through the day you are - so the assertions here
 * are mostly about coverage (every minute belongs to exactly one window)
 * and about the two settings that change what the dial means: where the day
 * starts, and which madhab decides Asr.
 *
 * Real index.html, real DOM, nothing injected. The app reads the real
 * clock, so anything that depends on "now" is asserted structurally (there
 * is exactly one current window, whatever the hour) rather than by value.
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

test("with no location saved, there is no prayer chip to tap", async () => {
  const app = loadApp({ fetchImpl: backend() });
  await app.flush();
  assert.equal(app.document.getElementById("headerChip").hidden, true);
  assert.equal(app.document.getElementById("prayersChip").hidden, true);
});

test("with a location, both chips name the same current prayer and time left", async () => {
  const app = await booted();
  const header = app.document.getElementById("headerChip");
  const tab = app.document.getElementById("prayersChip");
  assert.equal(header.hidden, false);
  assert.equal(tab.hidden, false);
  assert.equal(header.textContent, tab.textContent, "one renderer drives both - they cannot disagree");
  assert.match(header.textContent, /Fajr|Chasht|Dhuhr|Asr|Maghrib|Isha/);
  assert.match(header.textContent, /\d+m/, "and how long is left of it");
  assert.ok(header.querySelector(".pchip-dot"), "coloured for the window we're in");
});

test("tapping a chip opens the clock, with every prayer listed and no gap between them", async () => {
  const app = await booted();
  app.click("headerChip");
  assert.ok(app.document.getElementById("overlay").classList.contains("open"));
  assert.ok(app.document.getElementById("prayerClockSvg"), "the dial itself");

  const rows = [...app.document.querySelectorAll("#pmSlots .pslot")];
  assert.equal(rows.length, 6, "five prayers plus Chasht (sunrise to Dhuhr)");
  const spans = rows.map((r) => r.querySelector(".pst").textContent);
  assert.deepEqual(spans, [
    "04:45 – 05:50", "05:50 – 13:02", "13:02 – 17:10",
    "17:10 – 20:30", "20:30 – 22:10", "22:10 – 04:45",
  ], "each window runs to the next, and Isha's runs past midnight to Fajr");
});

test("the spiral covers the whole day, marks each start, and thickens the window we're in", async () => {
  const app = await booted();
  app.click("headerChip");
  const svg = app.document.getElementById("prayerClockSvg");

  const arcs = [...svg.querySelectorAll("path.pc-arc")];
  const named = new Set(arcs.map((p) => p.getAttribute("data-slot")));
  assert.equal(named.size, 6, "every window is drawn");
  assert.ok(arcs.length >= 6, "the window straddling the start of the dial is drawn as its two pieces");

  assert.equal(svg.querySelectorAll("circle.pc-pip").length, 6, "a pip at each prayer's start");

  const now = arcs.filter((p) => p.classList.contains("is-now"));
  assert.ok(now.length >= 1, "some window is always the current one");
  const nowNames = new Set(now.map((p) => p.getAttribute("data-slot")));
  assert.equal(nowNames.size, 1, "and only ever one");
  const nowWidth = Number(now[0].getAttribute("stroke-width"));
  const other = arcs.find((p) => !p.classList.contains("is-now"));
  assert.ok(nowWidth > Number(other.getAttribute("stroke-width")), "drawn thicker");
  assert.equal(now[0].getAttribute("opacity"), "1");
  assert.equal(other.getAttribute("opacity"), "0.9", "the rest sit back a little");
});

test("the hands are there, and the arcs get a real colour rather than a var() reference", async () => {
  const app = await booted();
  app.click("headerChip");
  const svg = app.document.getElementById("prayerClockSvg");
  assert.equal(svg.querySelectorAll("line.pc-hand").length, 3, "hours, minutes, seconds");
  assert.ok(svg.querySelector("line.pc-sec"), "the seconds hand is why it reticks every second");
  svg.querySelectorAll("path.pc-arc").forEach((p) => {
    assert.doesNotMatch(p.getAttribute("stroke"), /var\(/, "an SVG attribute cannot resolve a custom property");
  });
});

test("starting the dial at Fajr instead of now is stored, and redraws from the top", async () => {
  const app = await booted();
  app.click("headerChip");
  const btn = app.document.querySelector('#pmDayStart button[data-val="fajr"]');
  assert.ok(btn);
  btn.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  await app.flush();

  assert.equal(app.state().profile.prayerDayStart, "fajr", "on the profile, so it syncs");
  assert.ok(app.document.querySelector('#pmDayStart button[data-val="fajr"]').classList.contains("on"));

  const arcs = [...app.document.querySelectorAll("#prayerClockSvg path.pc-arc")];
  assert.equal(arcs.length, 6, "nothing straddles the start any more, so no window is split");
  const fajr = arcs.find((p) => p.getAttribute("data-slot") === "Fajr");
  // Twelve o'clock on the dial, on the spiral's outer edge - asserted as a
  // position rather than a literal so it survives a change of radius.
  const [, x, y] = fajr.getAttribute("d").match(/^M ([\d.]+) ([\d.]+)/).map(Number);
  assert.equal(x, 100, "on the vertical centre line");
  assert.ok(y < 20, `at the top and on the outer edge, got y=${y}`);
});

test("the madhab toggle and the cog's Asr select are one setting, and refetch under it", async () => {
  const urls = [];
  const app = await booted({ onUrl: (u) => { if (u.includes("/api/prayer")) urls.push(u); } });
  assert.match(urls[urls.length - 1], /madhab=shafii/);

  app.click("headerChip");
  const hanafi = app.document.querySelector('#pmMadhab button[data-val="hanafi"]');
  hanafi.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  await app.flush();
  await app.flush();

  assert.equal(app.state().profile.prayerMadhab, "hanafi");
  assert.equal(app.state().profile.prayerSchool, 1, "the Asr school follows the madhab, not the other way round");
  assert.equal(app.document.getElementById("prayerSchool").value, "1", "and the cog agrees with the modal");
  assert.match(urls[urls.length - 1], /madhab=hanafi/);
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
  const fajrRow = app.document.querySelectorAll("#prayBox label.chk")[0];
  assert.match(fajrRow.style.borderInlineStart, /248, 113, 113|#f87171/i,
    "the custom colour is used everywhere the prayer appears");

  app.click("headerChip");
  const row = app.document.querySelector('#pmSlots .pslot[data-prayer="Fajr"]');
  row.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  app.click("pmColorDefault");
  await app.flush();

  assert.equal(app.state().profile.prayerColors.Fajr, undefined);
  const back = app.document.querySelectorAll("#prayBox label.chk")[0];
  assert.match(back.style.borderInlineStart, /--fajr/, "back to following the theme");
});

test("an uncustomised prayer still follows the theme rather than being frozen to a hex", async () => {
  const app = await booted();
  app.goTo("prayers");
  const rows = app.document.querySelectorAll("#prayBox label.chk");
  assert.match(rows[0].style.borderInlineStart, /var\(--fajr\)/);
  assert.match(rows[3].style.borderInlineStart, /var\(--maghrib\)/);
});

test("the location can be named, reset, and the chips go with it", async () => {
  const app = await booted();
  app.click("headerChip");
  assert.match(app.document.getElementById("pmLocText").textContent, /51\.500, -0\.120/,
    "coordinates are a perfectly good label when there is no place name");

  app.click("pmLocReset");
  await app.flush();

  assert.equal(app.state().profile.prayerLoc, undefined);
  assert.equal(app.document.getElementById("headerChip").hidden, true);
  assert.equal(app.document.getElementById("prayersChip").hidden, true);
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
  assert.equal(app.document.getElementById("headerChip").hidden, true, "with nothing to show, the chip stays away");
});

test("closing the clock closes it - the once-a-second redraw must not outlive the modal", async () => {
  const app = await booted();
  app.click("headerChip");
  const svg = app.document.getElementById("prayerClockSvg");
  const before = svg.childNodes.length;
  assert.ok(before > 0);

  app.click("modalClose");
  assert.equal(app.document.getElementById("overlay").classList.contains("open"), false);

  // The tick is a no-op once the modal is shut: the dial it was redrawing
  // is left exactly as it was.
  await app.wait(1100);
  assert.equal(svg.childNodes.length, before);

  app.click("headerChip");
  assert.ok(app.document.getElementById("prayerClockSvg"), "and it reopens cleanly");
});
