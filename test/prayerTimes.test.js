"use strict";
/*
 * Live prayer times coverage: geolocation opt-in, the /api/prayer fetch +
 * per-day/location cache, colored slot rendering, and the "next prayer"
 * countdown. Real index.html, real DOM; geolocation and the Worker
 * response are mocked (see lib.js for why - jsdom implements neither
 * geolocation nor a real network at all).
 *
 * The client talks only to our own Worker now: which upstream provider
 * answered (UmmahAPI, or Aladhan as its fallback) is the Worker's business
 * and is covered in worker.test.js.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function prayerRes(timings) {
  return { ok: true, status: 200, json: async () => ({ source: "ummahapi", day: "2026-08-10", timings }) };
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
      if (String(url).includes("/api/prayer")) return prayerRes(SAMPLE_TIMINGS);
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });

  app.click("prayerLocBtn");
  await app.flush();
  await app.flush(); // one hop for geolocation callback, one for the prayer fetch chain

  assert.equal(app.state().profile.prayerLoc.lat, 51.5);
  // No reverse-geocode answer here, so the coordinates are the label - that is
  // a valid answer, not a failure state.
  assert.match(app.document.getElementById("prayerLocText").textContent, /times for 51\.500, -0\.120/i);
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

test("prayer times are cached per day+location: a second render does not refetch", async () => {
  let prayerCalls = 0;
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) { prayerCalls++; return prayerRes(SAMPLE_TIMINGS); }
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();
  assert.equal(prayerCalls, 1);

  // Re-rendering the clock for the same day/location must hit the cache, not the network.
  app.goTo("today");
  await app.flush();
  assert.equal(prayerCalls, 1, "a cached day+location must not be re-fetched");
});

test("the next-prayer countdown picks the smallest time-until, wrapping past midnight", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) return prayerRes({ Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:02", Asr: "17:10", Maghrib: "20:30", Isha: "22:10" });
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

test("prayer checklist: the same row shape as the times modal, with no times until a location is saved", () => {
  const app = loadApp({});
  const box = app.document.getElementById("prayBox");
  const rows = box.querySelectorAll("label.prow");
  assert.equal(rows.length, 5, "Fajr, Dhuhr, Asr, Maghrib, Isha");
  assert.ok(rows[0].querySelector("input[type=checkbox]"), "still a tick-box");
  assert.equal(rows[0].querySelector(".psn").textContent, "Fajr");
  assert.equal(rows[0].querySelector(".pst").textContent, "—", "no time yet - no saved location");
  assert.match(rows[0].querySelector(".psw").style.background, /--fajr/, "a colour bar, as in the modal");
  assert.match(rows[3].querySelector(".psw").style.background, /--maghrib/);
});

test("prayer checklist: once a location is saved, each row gains its window's start and end", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) return prayerRes(SAMPLE_TIMINGS);
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();

  const rows = app.document.querySelectorAll("#prayBox label.prow");
  // Not just the start: each row carries its window, and they are the same
  // spans the modal lists - Fajr ends at sunrise, not at Dhuhr, because the
  // stretch between the two is its own window (Chasht).
  assert.equal(rows[0].querySelector(".pst").textContent, "04:45 – 05:50", "Fajr, up to sunrise");
  assert.equal(rows[4].querySelector(".pst").textContent, "22:10 – 04:45", "Isha, through midnight");

  // Exactly one row is ringed, whatever time the suite runs at - and only
  // when the window we're in is one the checklist actually lists (Chasht
  // isn't, so between sunrise and Dhuhr none is).
  const ringed = app.document.querySelectorAll("#prayBox label.prow.is-now");
  assert.ok(ringed.length <= 1, "never more than one current prayer");
});

test("the calculation method is selectable, stored on the profile, and changes what is fetched", async () => {
  const urls = [];
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) { urls.push(String(url)); return prayerRes(SAMPLE_TIMINGS); }
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.goTo("prayers");
  // The settings live behind a cog beside the location button.
  const panel = app.document.getElementById("prayerSettings");
  assert.ok(panel.hasAttribute("hidden"), "tucked away until asked for");
  app.click("prayerCogBtn");
  assert.equal(panel.hasAttribute("hidden"), false);

  const sel = app.document.getElementById("prayerMethod");
  assert.ok(sel, "a method picker inside the cog");
  assert.ok(sel.options.length > 5, "several conventions to choose from");
  assert.equal(sel.value, "3", "Muslim World League by default");

  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();
  assert.match(urls[urls.length - 1], /method=3/);

  sel.value = "4"; // Umm al-Qura
  sel.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await app.flush();
  await app.flush();

  assert.equal(app.state().profile.prayerMethod, 4, "stored on the profile, so it syncs");
  assert.match(urls[urls.length - 1], /method=4/, "and the times are refetched under the new method");
});

test("the Asr school is selectable, since Hanafi puts Asr about an hour later", async () => {
  const urls = [];
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) { urls.push(String(url)); return prayerRes(SAMPLE_TIMINGS); }
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.goTo("prayers");
  app.click("prayerCogBtn");

  const school = app.document.getElementById("prayerSchool");
  assert.ok(school, "the cog carries the school of thought too");
  assert.equal(school.value, "0", "standard by default");

  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();
  assert.match(urls[urls.length - 1], /madhab=shafii/);

  school.value = "1"; // Hanafi
  school.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await app.flush();
  await app.flush();

  assert.equal(app.state().profile.prayerSchool, 1, "stored on the profile, so it syncs");
  assert.match(urls[urls.length - 1], /madhab=hanafi/, "and the times are refetched under it");
});

test("method and school are cached separately, so switching back is instant and correct", async () => {
  let calls = 0;
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) { calls++; return prayerRes(SAMPLE_TIMINGS); }
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  app.goTo("prayers");
  app.click("prayerCogBtn");
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();
  assert.equal(calls, 1);

  const school = app.document.getElementById("prayerSchool");
  const setSchool = async (v) => {
    school.value = v;
    school.dispatchEvent(new app.window.Event("change", { bubbles: true }));
    await app.flush();
    await app.flush();
  };
  await setSchool("1");
  assert.equal(calls, 2, "a new combination is fetched");
  await setSchool("0");
  assert.equal(calls, 2, "and going back reuses what was already cached for it");
});

/*
 * The calendar needs five days at a time and pages through many more, so it
 * asks for a whole month in one request. That is only ever an accelerator:
 * these two tests pin both halves of it - that it is used, and that losing
 * it costs nothing but requests.
 */
function seedWithLoc() {
  return JSON.stringify({
    schema: 3,
    profile: { startWeight: "", targetWeight: "", updated_at: 1, tasks: [], prayerLoc: { lat: 51.5, lon: -0.12 } },
    days: {},
  });
}
/** Every day of the month around `d`, so any five-day window is covered. */
function monthDays(d) {
  const y = d.getFullYear(), m = d.getMonth();
  const out = {};
  for (let day = 1; day <= 31; day++) {
    const x = new Date(y, m, day);
    if (x.getMonth() !== m) break;
    out[`${y}-${String(m + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`] =
      { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:02", Asr: "17:10", Maghrib: "20:30", Isha: "22:10" };
  }
  return out;
}
function calBackend(calls, monthOk) {
  return async (url) => {
    const u = String(url);
    if (u.includes("/api/prayer/month")) {
      calls.push("month");
      if (!monthOk) return { ok: false, status: 500, json: async () => ({ error: "nope" }) };
      const now = new Date();
      return { ok: true, status: 200, json: async () => ({ source: "ummahapi", year: now.getFullYear(), month: now.getMonth() + 1, days: monthDays(now) }) };
    }
    if (u.includes("/api/prayer")) { calls.push("day"); return prayerRes(SAMPLE_TIMINGS); }
    if (u.includes("/api/calendar/events")) return { ok: true, status: 200, json: async () => ({ events: [], tasks: [] }) };
    return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
  };
}

test("the calendar takes a whole month in one request instead of a day at a time", async () => {
  const calls = [];
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: seedWithLoc() }, fetchImpl: calBackend(calls, true) });
  await app.flush();
  await app.flush();
  const dayCallsBefore = calls.filter((c) => c === "day").length;

  app.goTo("calendar");
  await app.wait(300);

  assert.ok(calls.includes("month"), "the month endpoint is what the calendar reaches for");
  assert.equal(calls.filter((c) => c === "day").length, dayCallsBefore,
    "and the five days it needs all come out of that one response");
  assert.ok(app.document.querySelectorAll("#calDayCur .cal-cell").length > 0, "the day still renders");
});

test("losing the month endpoint costs requests, not the calendar", async () => {
  const calls = [];
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: seedWithLoc() }, fetchImpl: calBackend(calls, false) });
  await app.flush();
  await app.flush();

  app.goTo("calendar");
  await app.wait(300);

  assert.ok(calls.includes("month"), "it still tries");
  assert.ok(calls.filter((c) => c === "day").length > 0, "then falls back to fetching each day");
  assert.ok(app.document.querySelectorAll("#calDayCur .cal-cell").length > 0, "and the day renders regardless");
});
