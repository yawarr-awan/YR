"use strict";
/*
 * Calendar tab coverage: the full 24h double-column day grid fed by
 * /api/calendar/events, connect/reconnect/error states, day navigation
 * (buttons + swipe), and the full-window prayer color bands (colored from
 * the start of each prayer's window to the start of the next, sharing the
 * same colors as the Today-tab clock).
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

function todayKey() {
  const d = new Date();
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

test("not connected: shows a connect prompt, but the full 24-hour grid still renders", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: false, status: "not_connected", day: todayKey(), events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  assert.match(app.document.getElementById("calStatus").textContent, /connect google calendar/i);
  const amHours = app.document.querySelectorAll("#calColAMBody .cal-hour");
  const pmHours = app.document.querySelectorAll("#calColPMBody .cal-hour");
  assert.equal(amHours.length, 12, "AM column covers 00:00-11:00");
  assert.equal(pmHours.length, 12, "PM column covers 12:00-23:00");
  assert.equal(amHours[0].querySelector(".cal-hour-label").textContent, "00:00");
  assert.equal(pmHours[0].querySelector(".cal-hour-label").textContent, "12:00");
});

test("places each event in its starting hour cell, colored by source calendar, with location shown", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({
      connected: true, status: "ok", day: "2026-08-09",
      events: [
        { title: "Dentist", start: "2026-08-09T14:00:00Z", allDay: false, location: "High St", calendar: "Yawar", color: "#4285f4" },
        { title: "Standup", start: "2026-08-09T08:00:00Z", allDay: false, calendar: "Yawar", color: "#4285f4" },
        { title: "Mum's birthday", start: "2026-08-09", allDay: true, calendar: "Family", color: "#0b8043" },
      ],
    })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const amHours = app.document.querySelectorAll("#calColAMBody .cal-hour");
  const pmHours = app.document.querySelectorAll("#calColPMBody .cal-hour");

  assert.match(amHours[0].querySelector(".cal-hour-events").textContent, /Mum's birthday/, "all-day event lands in the 00:00 slot");
  assert.match(amHours[8].querySelector(".cal-hour-events").textContent, /Standup/, "08:00 UTC event lands in the 08:00 slot");

  const dentistChip = pmHours[2].querySelector(".cal-event"); // 14:00 -> PM column index 2
  assert.ok(dentistChip, "expected the Dentist event in the 14:00 slot");
  assert.match(dentistChip.textContent, /Dentist/);
  assert.match(dentistChip.textContent, /High St/);
  assert.equal(dentistChip.style.borderInlineStartColor, "rgb(66, 133, 244)");
});

test("reconnect_required and calendar_error show distinct, specific messages", async () => {
  const reconnect = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "reconnect_required", day: todayKey(), events: [] })]]),
  });
  reconnect.goTo("calendar");
  await reconnect.flush();
  assert.match(reconnect.document.getElementById("calStatus").textContent, /expired/i);

  const errored = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "calendar_error", day: todayKey(), events: [] })]]),
  });
  errored.goTo("calendar");
  await errored.flush();
  assert.match(errored.document.getElementById("calStatus").textContent, /couldn't load/i);
});

test("prayer windows tint the whole day as full colored bands, covering all 24 hours with no gaps", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: todayKey(), events: [] })],
      ["api.aladhan.com", () => jsonRes({ data: { timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } } })],
    ]),
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();

  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const allHours = [
    ...app.document.querySelectorAll("#calColAMBody .cal-hour"),
    ...app.document.querySelectorAll("#calColPMBody .cal-hour"),
  ];
  assert.equal(allHours.length, 24);
  // Every single hour must carry a prayer-window tint - nothing left un-colored.
  allHours.forEach((hourEl) => {
    assert.notEqual(hourEl.style.background, "", `hour ${hourEl.querySelector(".cal-hour-label").textContent} should be tinted`);
  });
  // Spot-check a couple of known windows: 06:00 falls in the Sunrise window, 14:00 in Dhuhr.
  assert.match(allHours[6].style.background, /--sunrise/);
  assert.match(allHours[14].style.background, /--dhuhr/);
  // Overnight (00:00 and 23:00) both belong to Isha's window either side of midnight.
  assert.match(allHours[0].style.background, /--isha/);
  assert.match(allHours[23].style.background, /--isha/);
});

test("date navigation buttons (prev/next/today) refetch the grid for the new day", async () => {
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

  app.click("calNextDay");
  await app.flush();
  const next = requestedDates[requestedDates.length - 1];
  assert.notEqual(next, today);

  app.click("calPrevDay");
  await app.flush();
  assert.equal(requestedDates[requestedDates.length - 1], today, "back to the day we started on");

  app.click("calJumpToday");
  await app.flush();
  assert.equal(requestedDates[requestedDates.length - 1], today);
});

test("swiping left/right on the grid pages to the next/previous day, same as the buttons", async () => {
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

  app.swipe("calGrid", -80, 0); // swipe left -> next day
  await app.flush();
  assert.notEqual(requestedDates[requestedDates.length - 1], today);
  const afterLeft = requestedDates[requestedDates.length - 1];

  app.swipe("calGrid", 80, 0); // swipe right -> back to previous day
  await app.flush();
  assert.equal(requestedDates[requestedDates.length - 1], today);

  // A short/mostly-vertical drag is not a page-turn.
  const fetchCountBefore = requestedDates.length;
  app.swipe("calGrid", 10, 5);
  await app.flush();
  assert.equal(requestedDates.length, fetchCountBefore, "no extra fetch from a non-swipe touch");
  assert.notEqual(afterLeft, today);
});

test("opening the calendar tab highlights the current hour in the correct column", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: todayKey(), events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const currentHourEls = app.document.querySelectorAll("#calGrid .cal-hour.current-hour");
  assert.equal(currentHourEls.length, 1, "exactly one hour cell should be marked current");
  const nowHour = new Date().getHours();
  const expectedBody = nowHour < 12 ? "#calColAMBody" : "#calColPMBody";
  assert.ok(app.document.querySelector(`${expectedBody} .cal-hour.current-hour`), "the current hour should be in the AM/PM column matching the clock");
});
