"use strict";
/*
 * Calendar tab coverage: day-agenda rendering from /api/calendar/events,
 * connect/reconnect/error states, date navigation, and the prayer-time
 * overlay (colored rows sharing the same colors as the Today-tab clock).
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function jsonRes(body) { return { ok: true, status: 200, json: async () => body }; }

function fetchRouter(routes) {
  return async (url) => {
    const u = String(url);
    for (const [pattern, handler] of routes) if (u.includes(pattern)) return handler(u);
    throw new Error("unexpected fetch " + u);
  };
}

test("not connected: agenda is empty with a clear connect prompt", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: false, status: "not_connected", day: "2026-08-09", events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  assert.match(app.document.getElementById("calStatus").textContent, /connect google calendar/i);
  assert.match(app.document.getElementById("calAgenda").textContent, /nothing scheduled/i);
});

test("renders events sorted with time and calendar/location metadata, colored by source calendar", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({
      connected: true, status: "ok", day: "2026-08-09",
      events: [
        { title: "Dentist", start: "2026-08-09T15:00:00+01:00", allDay: false, location: "High St", calendar: "Yawar", color: "#4285F4" },
        { title: "Standup", start: "2026-08-09T09:00:00+01:00", allDay: false, calendar: "Yawar", color: "#4285F4" },
        { title: "Mum's birthday", start: "2026-08-09", allDay: true, calendar: "Family", color: "#0B8043" },
      ],
    })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const rows = app.document.querySelectorAll("#calAgenda .agenda-row");
  assert.equal(rows.length, 3);
  // All-day (sort key "00:00") and 09:00 standup should both precede the 15:00 dentist visit.
  assert.match(rows[2].querySelector(".agenda-title").textContent, /Dentist/);
  assert.match(rows[2].querySelector(".agenda-meta").textContent, /High St/);
  assert.equal(rows[0].style.borderInlineStartColor, "rgb(11, 128, 67)");
});

test("reconnect_required and calendar_error show distinct, specific messages", async () => {
  const reconnect = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "reconnect_required", day: "2026-08-09", events: [] })]]),
  });
  reconnect.goTo("calendar");
  await reconnect.flush();
  assert.match(reconnect.document.getElementById("calStatus").textContent, /expired/i);

  const errored = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "calendar_error", day: "2026-08-09", events: [] })]]),
  });
  errored.goTo("calendar");
  await errored.flush();
  assert.match(errored.document.getElementById("calStatus").textContent, /couldn't load/i);
});

test("prayer times overlay the agenda as colored rows when a location is saved", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: "2026-08-09", events: [] })],
      ["api.aladhan.com", () => jsonRes({ data: { timings: { Fajr: "04:45", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } } })],
    ]),
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();

  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const prayerRows = app.document.querySelectorAll("#calAgenda .agenda-prayer");
  assert.equal(prayerRows.length, 5);
  assert.match(prayerRows[0].textContent, /Fajr/);
});

test("date navigation (prev/today/next) refetches the agenda for the new day", async () => {
  const requestedDates = [];
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", (u) => {
      requestedDates.push((String(u).match(/date=([^&]+)/) || [])[1]);
      return jsonRes({ connected: true, status: "ok", day: "x", events: [] });
    }]]),
  });
  app.goTo("calendar");
  await app.flush();
  const today = requestedDates[requestedDates.length - 1];

  app.click("calPrevDay");
  await app.flush();
  const prev = requestedDates[requestedDates.length - 1];
  assert.notEqual(prev, today);

  app.click("calJumpToday");
  await app.flush();
  assert.equal(requestedDates[requestedDates.length - 1], today);
});
