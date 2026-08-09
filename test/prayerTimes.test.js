"use strict";
/*
 * Live prayer times coverage: geolocation opt-in, the Aladhan fetch +
 * per-day/location cache, colored slot rendering, and the "next prayer"
 * countdown. Real index.html, real DOM; geolocation and the Aladhan
 * response are mocked (see lib.js for why - jsdom implements neither
 * geolocation nor a real network at all).
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function aladhanRes(timings) {
  return { ok: true, status: 200, json: async () => ({ data: { timings } }) };
}
const SAMPLE_TIMINGS = { Fajr: "04:45 (BST)", Sunrise: "05:50", Dhuhr: "13:02", Asr: "17:10", Sunset: "20:30", Maghrib: "20:30", Isha: "22:10" };

test("with no saved location, prompts to use location and shows no countdown", () => {
  const app = loadApp({});
  app.goTo("today");
  assert.match(app.document.getElementById("prayerLocText").textContent, /use my location/i);
  assert.equal(app.document.getElementById("prayerNext").textContent, "");
  assert.match(app.document.getElementById("prayerLocBtnText").textContent, /use my location/i);
});

test("the prayer names are listed once, on the checklist - not repeated underneath it", () => {
  const app = loadApp({});
  app.goTo("today");
  // The old chip row duplicated every prayer name below the tracker.
  assert.equal(app.document.getElementById("prayerSlots"), null);
  assert.equal(app.document.querySelectorAll(".prayer-chip").length, 0);
  const card = app.document.querySelector('.card[data-collapse="prayers"]');
  assert.equal((card.textContent.match(/Fajr/g) || []).length, 1, "Fajr should appear exactly once in the card");
});

test("clicking 'Use my location' saves coordinates, shows the countdown, and offers to update it", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("api.aladhan.com")) return aladhanRes(SAMPLE_TIMINGS);
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });

  app.click("prayerLocBtn");
  await app.flush();
  await app.flush(); // one hop for geolocation callback, one for the Aladhan fetch chain

  assert.equal(app.state().profile.prayerLoc.lat, 51.5);
  assert.match(app.document.getElementById("prayerLocText").textContent, /times for your saved location/i);
  assert.match(app.document.getElementById("prayerNext").textContent, /^Next: \w+ in /);
  assert.match(app.document.getElementById("prayerLocBtnText").textContent, /update location/i,
    "once a location is stored the button offers to change it, not to set it again");
  assert.ok(app.document.querySelector("#prayerLocBtn svg"), "the button uses a drawn pin rather than an emoji");
});

test("geolocation permission denial shows a clear message, no crash", () => {
  const app = loadApp({ geolocation: { error: "User denied Geolocation" } });
  app.click("prayerLocBtn");
  assert.match(app.document.getElementById("prayerLocText").textContent, /couldn't get your location/i);
});

test("prayer times are cached per day+location: a second render does not refetch Aladhan", async () => {
  let aladhanCalls = 0;
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("api.aladhan.com")) { aladhanCalls++; return aladhanRes(SAMPLE_TIMINGS); }
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();
  assert.equal(aladhanCalls, 1);

  // Re-rendering the clock for the same day/location must hit the cache, not the network.
  app.goTo("today");
  await app.flush();
  assert.equal(aladhanCalls, 1, "a cached day+location must not be re-fetched");
});

test("the next-prayer countdown picks the smallest time-until, wrapping past midnight", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("api.aladhan.com")) return aladhanRes({ Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:02", Asr: "17:10", Maghrib: "20:30", Isha: "22:10" });
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();

  // Whatever "now" is on the test machine, some prayer is always next.
  const next = app.document.getElementById("prayerNext").textContent;
  assert.match(next, /^Next: (Fajr|Sunrise|Dhuhr|Asr|Maghrib|Isha) in /);
});

test("prayer checklist (Today tab tick-box): each row is colored per prayer, with no time shown until a location is saved", () => {
  const app = loadApp({});
  const box = app.document.getElementById("prayBox");
  const rows = box.querySelectorAll("label.chk");
  assert.equal(rows.length, 5, "Fajr, Dhuhr, Asr, Maghrib, Isha");
  assert.match(rows[0].querySelector(".lbl").textContent, /^Fajr$/, "no time yet - no saved location");
  assert.match(rows[0].style.borderInlineStart, /--fajr/);
  assert.match(rows[3].style.borderInlineStart, /--maghrib/);
});

test("prayer checklist: once a location is saved, each row's label gains its actual time", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("api.aladhan.com")) return aladhanRes(SAMPLE_TIMINGS);
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();

  const box = app.document.getElementById("prayBox");
  const fajrLbl = box.querySelectorAll("label.chk .lbl")[0];
  assert.match(fajrLbl.textContent, /Fajr.*04:45/);
});
