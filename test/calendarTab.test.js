"use strict";
/*
 * Calendar tab coverage: the single-column 24h day grid fed by
 * /api/calendar/events, connect/reconnect/error states, day paging (buttons
 * + swipe, both of which run a real slide animation, hence the waits), and
 * the full-window prayer color bands that tint every hour of the day.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

// The grid slides out and back in; a day change is settled after both halves.
const PAGE_MS = 500;

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

function dateTracker() {
  const seen = [];
  const route = ["/api/calendar/events", (u) => {
    seen.push((String(u).match(/date=([^&]+)/) || [])[1]);
    return jsonRes({ connected: true, status: "ok", day: "x", events: [] });
  }];
  return { seen, route, last: () => seen[seen.length - 1] };
}

test("not connected: shows a connect prompt, but the full 24-hour grid still renders in one column", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: false, status: "not_connected", day: todayKey(), events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  assert.match(app.document.getElementById("calStatus").textContent, /connect google calendar/i);
  const hours = app.document.querySelectorAll("#calHours .cal-hour");
  assert.equal(hours.length, 24, "one column covering the whole day");
  assert.equal(hours[0].querySelector(".cal-hour-label").textContent, "00:00");
  assert.equal(hours[23].querySelector(".cal-hour-label").textContent, "23:00");
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

  const hours = app.document.querySelectorAll("#calHours .cal-hour");
  assert.match(hours[0].querySelector(".cal-hour-events").textContent, /Mum's birthday/, "all-day event lands in the 00:00 slot");
  assert.match(hours[8].querySelector(".cal-hour-events").textContent, /Standup/);

  const dentistChip = hours[14].querySelector(".cal-event");
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

  const hours = app.document.querySelectorAll("#calHours .cal-hour");
  assert.equal(hours.length, 24);
  hours.forEach((hourEl) => {
    assert.notEqual(hourEl.style.background, "", `hour ${hourEl.querySelector(".cal-hour-label").textContent} should be tinted`);
  });
  assert.match(hours[6].style.background, /--sunrise/);
  assert.match(hours[14].style.background, /--dhuhr/);
  // Overnight either side of midnight both belong to Isha's window.
  assert.match(hours[0].style.background, /--isha/);
  assert.match(hours[23].style.background, /--isha/);
});

test("date navigation buttons (prev/next/today) refetch the grid for the new day", async () => {
  const tracker = dateTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  const today = tracker.last();

  app.click("calNextDay");
  await app.wait(PAGE_MS);
  assert.notEqual(tracker.last(), today);

  app.click("calPrevDay");
  await app.wait(PAGE_MS);
  assert.equal(tracker.last(), today, "back to the day we started on");

  app.click("calJumpToday");
  await app.flush();
  assert.equal(tracker.last(), today);
});

test("swiping the grid pages a day and animates it, rather than jumping straight there", async () => {
  const tracker = dateTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  const today = tracker.last();
  const grid = app.document.getElementById("calGrid");

  app.swipe("calGrid", -80, 0); // swipe left -> next day
  // Mid-flight the outgoing day is pushed off-screen, and the new day has
  // NOT been fetched yet - that's what makes it read as a stack, not a jump.
  assert.match(grid.style.transform, /translateX\(-100%\)/);
  assert.equal(tracker.last(), today, "the new day is fetched after the slide-out, not before");

  await app.wait(PAGE_MS);
  assert.notEqual(tracker.last(), today);
  assert.equal(grid.style.transform, "", "settles back to its resting position");

  app.swipe("calGrid", 80, 0); // swipe right -> back again
  await app.wait(PAGE_MS);
  assert.equal(tracker.last(), today);

  // A short / mostly-vertical drag is a scroll, not a page turn.
  const before = tracker.seen.length;
  app.swipe("calGrid", 10, 60);
  await app.wait(PAGE_MS);
  assert.equal(tracker.seen.length, before, "no extra fetch from a non-swipe touch");
});

test("opening the calendar tab highlights the current hour", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: todayKey(), events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const currentHourEls = app.document.querySelectorAll("#calHours .cal-hour.current-hour");
  assert.equal(currentHourEls.length, 1, "exactly one hour cell should be marked current");
  assert.equal(currentHourEls[0].querySelector(".cal-hour-label").textContent,
    String(new Date().getHours()).padStart(2, "0") + ":00");
});
