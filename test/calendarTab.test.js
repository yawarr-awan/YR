"use strict";
/*
 * Calendar tab coverage: one full-width day at a time, with its two
 * neighbours rendered either side so a swipe reveals the real adjacent day
 * and costs no round trip. Also the week strip, the ‹ › week jumps, and the
 * prayer-window colour bands.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

/** The header chip is the only way into the prayer screen now, and the
 * location button lives there rather than on the Prayers tab. */
function useMyLocation(app) {
  app.click("headerChip");
  app.click("pmLocBtn");
}

const SLIDE_MS = 600; // the day slide plus its re-render

function jsonRes(body) { return { ok: true, status: 200, json: async () => body }; }

function fetchRouter(routes) {
  return async (url) => {
    const u = String(url);
    for (const [pattern, handler] of routes) if (u.includes(pattern)) return handler(u);
    throw new Error("unexpected fetch " + u);
  };
}

function keyOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function todayKey() { return keyOf(new Date()); }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function thisMonday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function atToday(h, m) {
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toISOString();
}

function windowTracker(events) {
  const seen = [];
  const route = ["/api/calendar/events", (u) => {
    const s = String(u);
    seen.push({ date: (s.match(/date=([^&]+)/) || [])[1], end: (s.match(/end=([^&]+)/) || [])[1] });
    return jsonRes({ connected: true, status: "ok", events: events || [] });
  }];
  return { seen, route, count: () => seen.length, last: () => seen[seen.length - 1] };
}

const panels = (app) => ["calDayPrev", "calDayCur", "calDayNext"].map((id) => app.document.getElementById(id));
// The all-day row is also an `is-main` cell, so "hours" excludes it.
const curHours = (app) => app.document.querySelectorAll("#calDayCur .cal-cell.is-main:not(.cal-allday)");
const heading = (app) => app.document.getElementById("calDayHeading").textContent;

test("shows one full day at a time, with the previous and next day rendered either side", async () => {
  const app = loadApp({ fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })]]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const [prev, cur, next] = panels(app);
  [prev, cur, next].forEach((p) => assert.equal(p.querySelectorAll(".cal-cell.is-main").length, 24, "each panel is a whole day"));
  assert.equal(curHours(app)[0].querySelector(".cal-hour-label").textContent, "12 AM");
  assert.equal(curHours(app)[23].querySelector(".cal-hour-label").textContent, "11 PM");
  assert.match(heading(app), /Today/);
  // The neighbours exist so a drag reveals a real day, not a blank panel.
  assert.ok(prev.querySelector(".cal-cell.is-main"));
  assert.ok(next.querySelector(".cal-cell.is-main"));
});

test("fetches a padded window once, so moving day costs no round trip", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  assert.equal(tracker.count(), 1);
  assert.ok(tracker.last().date < todayKey(), "the window starts before today");
  assert.ok(tracker.last().end > todayKey(), "and ends after it");

  app.swipe("calGrid", -80, 0);
  await app.wait(SLIDE_MS);
  assert.equal(tracker.count(), 1, "the next day was already loaded");
});

test("swiping slides one day and the day actually changes", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const track = app.document.getElementById("calTrack");
  const tomorrow = keyOf(addDays(new Date(), 1));

  app.swipe("calGrid", -90, 0);
  // Mid-flight the track is animating toward the next panel, which is
  // already on screen - nothing is refetched or rebuilt during the slide.
  assert.match(track.style.transform, /-66\.6667%/);

  await app.wait(SLIDE_MS);
  assert.equal(app.document.getElementById("calDatePick").value, tomorrow);
  assert.match(track.style.transform, /-33\.3333%/, "re-centred once the new day is in the middle");
  assert.doesNotMatch(heading(app), /Today/);

  app.swipe("calGrid", 90, 0);
  await app.wait(SLIDE_MS);
  assert.equal(app.document.getElementById("calDatePick").value, todayKey());
  assert.match(heading(app), /Today/);
});

test("dragging moves the track with the finger, and a short drag springs back", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const track = app.document.getElementById("calTrack");
  const view = app.document.getElementById("calGrid");

  const start = new app.window.Event("touchstart", { bubbles: true });
  start.touches = [{ clientX: 200, clientY: 300 }];
  view.dispatchEvent(start);
  const move = new app.window.Event("touchmove", { bubbles: true });
  move.touches = [{ clientX: 160, clientY: 302 }];
  view.dispatchEvent(move);
  assert.match(track.style.transform, /-40px/, "the track follows the finger, so you see the next day coming");

  const end = new app.window.Event("touchend", { bubbles: true });
  end.changedTouches = [{ clientX: 175, clientY: 302 }];  // only -25px: not enough
  view.dispatchEvent(end);
  await app.wait(SLIDE_MS);
  assert.equal(app.document.getElementById("calDatePick").value, todayKey(), "a short drag does not change day");
  assert.match(track.style.transform, /-33\.3333%/);
});

test("events land in their hour with time, calendar and location", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({
      connected: true, status: "ok",
      events: [
        { title: "Physio", start: atToday(14, 30), allDay: false, location: "Clinic", calendar: "Yawar", color: "#4285f4" },
        { title: "Mum's birthday", start: todayKey(), allDay: true, calendar: "Family", color: "#0b8043" },
      ],
    })]]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const hours = curHours(app);
  const chip = hours[14].querySelector(".cal-chip");
  assert.ok(chip, "a 14:30 event sits in the 2 PM row");
  assert.match(chip.textContent, /2:30 PM/, "times read as AM/PM everywhere");
  assert.match(chip.textContent, /Physio/);
  assert.match(chip.querySelector(".cal-chip-meta").textContent, /Yawar · Clinic/);
  assert.equal(chip.style.borderInlineStartColor, "rgb(66, 133, 244)");

  // All-day items get their own row above the hours rather than being
  // buried in 00:00, which is the part of the grid nobody scrolls back to.
  const allDay = app.document.querySelector("#calDayCur .cal-cell.is-main.cal-allday");
  assert.ok(allDay, "an all-day event gives the day an all-day row");
  assert.match(allDay.textContent, /All day/);
  assert.match(allDay.textContent, /Mum's birthday/);
  assert.equal(hours[0].textContent.includes("Mum's birthday"), false, "and it is not also in 00:00");
});

test("prayer windows tint all 24 hours of the day with no gaps", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
    ]),
  });
  useMyLocation(app);
  await app.flush();
  await app.flush();

  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const hours = curHours(app);
  assert.equal(hours.length, 24);
  hours.forEach((h) => assert.notEqual(h.style.background, "", "every hour is tinted"));
  assert.match(hours[6].style.background, /--sunrise/);
  assert.match(hours[14].style.background, /--dhuhr/);
  // Overnight either side of midnight belongs to Isha's window.
  assert.match(hours[0].style.background, /--isha/);
  assert.match(hours[23].style.background, /--isha/);
});

test("the prayer window happening now is ringed in the calendar, in its own colour", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
    ]),
  });
  useMyLocation(app);
  await app.flush();
  await app.flush();
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const hours = [...curHours(app)];
  const inWindow = hours.filter((h) => h.classList.contains("in-prayer"));
  assert.ok(inWindow.length >= 1, "whatever the hour, today is inside some prayer window");

  // A run of consecutive hours, ringed as one box: only the first draws a
  // top edge and only the last a bottom one.
  const idx = inWindow.map((h) => hours.indexOf(h));
  idx.forEach((n, i) => { if (i) assert.equal(n, idx[i - 1] + 1, "the ringed hours are consecutive"); });
  assert.equal(hours[idx[0]].classList.contains("win-first"), true);
  assert.equal(hours[idx[idx.length - 1]].classList.contains("win-last"), true);
  if (idx.length > 2) {
    assert.equal(hours[idx[1]].classList.contains("win-first"), false, "the middle draws sides only");
  }

  // Its own colour, not the brand's - the same one tinting those hours.
  const pc = hours[idx[0]].style.getPropertyValue("--pc");
  assert.match(pc, /--(fajr|sunrise|dhuhr|asr|maghrib|isha)|#/, `a prayer colour, got: ${pc}`);
  assert.ok(hours[idx[0]].style.background.includes(pc.trim()), "the ring matches the tint");

  // Only today. The neighbouring columns have no "now" to be inside of.
  const others = app.document.querySelectorAll("#calDayCur .cal-cell:not(.is-main).in-prayer");
  assert.equal(others.length, 0);
});

test("the current hour is marked, with a now-line, only on today", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const marked = app.document.querySelectorAll("#calDayCur .cal-cell.is-main.current-hour");
  assert.equal(marked.length, 1);
  const h = new Date().getHours();
  assert.equal(marked[0].querySelector(".cal-hour-label").textContent,
    (h % 12 === 0 ? 12 : h % 12) + " " + (h < 12 ? "AM" : "PM"));
  assert.ok(marked[0].querySelector(".cal-nowline"));

  app.swipe("calGrid", -90, 0);
  await app.wait(SLIDE_MS);
  assert.equal(app.document.querySelectorAll("#calDayCur .cal-cell.is-main.current-hour").length, 0,
    "tomorrow has no 'now'");
});

test("the week strip shows the surrounding week and jumps to a tapped day", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const buttons = () => app.document.querySelectorAll("#calStrip button");
  assert.equal(buttons().length, 7);
  const todayIdx = (new Date().getDay() + 6) % 7;
  assert.ok(buttons()[todayIdx].classList.contains("is-today"));
  assert.ok(buttons()[todayIdx].classList.contains("is-sel"));

  const otherIdx = todayIdx === 0 ? 4 : 0;
  buttons()[otherIdx].click();
  await app.flush();
  await app.flush();

  assert.equal(app.document.getElementById("calDatePick").value, keyOf(addDays(thisMonday(), otherIdx)));
  assert.ok(buttons()[otherIdx].classList.contains("is-sel"));
  assert.ok(buttons()[todayIdx].classList.contains("is-today"), "today is still flagged");
});

test("the arrows jump a week, and Today comes back", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  app.click("calNextDay");
  await app.flush();
  await app.flush();
  assert.equal(app.document.getElementById("calDatePick").value, keyOf(addDays(new Date(), 7)));

  app.click("calJumpToday");
  await app.flush();
  await app.flush();
  assert.equal(app.document.getElementById("calDatePick").value, todayKey());
  assert.match(heading(app), /Today/);
});

test("connect / reconnect / error / empty each say something specific", async () => {
  const cases = [
    [{ connected: false, status: "not_connected" }, /connect google calendar/i],
    [{ connected: true, status: "reconnect_required" }, /expired/i],
    [{ connected: true, status: "calendar_error" }, /couldn't load/i],
    [{ connected: true, status: "ok" }, /nothing scheduled/i],
  ];
  for (const [body, expected] of cases) {
    const app = loadApp({
      fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes(Object.assign({ events: [] }, body))]]),
    });
    app.goTo("calendar");
    await app.flush();
    await app.flush();
    assert.match(app.document.getElementById("calStatus").textContent, expected);
  }
});

test("the next two days are full day columns beside today, not summaries", async () => {
  const tomorrow = addDays(new Date(), 1);
  const dayAfter = addDays(new Date(), 2);
  const at = (d, h) => { const x = new Date(d); x.setHours(h, 0, 0, 0); return x.toISOString(); };
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({
      connected: true, status: "ok",
      events: [
        { title: "Physio", start: at(new Date(), 14), allDay: false, calendar: "Yawar", color: "#4285f4" },
        { title: "School run", start: at(tomorrow, 8), allDay: false, calendar: "Family", color: "#0b8043" },
        { title: "Dentist", start: at(dayAfter, 11), allDay: false, calendar: "Yawar", color: "#4285f4" },
      ],
    })]]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const cells = app.document.querySelectorAll("#calDayCur .cal-cell");
  assert.equal(cells.length, 24 * 3, "three columns of 24 hours, sharing one grid so the rows line up");
  const cellAt = (col, hour) => cells[hour * 3 + col];

  // Each event sits in its own column at its own hour - a real day, not a list.
  assert.match(cellAt(0, 14).textContent, /Physio/);
  assert.match(cellAt(1, 8).textContent, /School run/);
  assert.match(cellAt(2, 11).textContent, /Dentist/);
  assert.equal(cellAt(1, 9).textContent, "", "empty hours stay empty in the narrow columns too");

  // Headings name each day; the neighbours are tappable to bring into focus.
  const heads = app.document.querySelectorAll("#calDayCur .cal-gh");
  assert.equal(heads.length, 3);
  assert.equal(heads[1].querySelector("b").textContent, String(tomorrow.getDate()));
  heads[2].click();
  await app.flush();
  await app.flush();
  assert.equal(app.document.getElementById("calDatePick").value, keyOf(dayAfter));
});

test("the narrow columns get the same prayer-window colours as the focused day", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
    ]),
  });
  useMyLocation(app);
  await app.flush();
  await app.flush();
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const cells = app.document.querySelectorAll("#calDayCur .cal-cell");
  cells.forEach((c) => assert.notEqual(c.style.background, "", "every hour of every column is tinted"));
  const cellAt = (col, hour) => cells[hour * 3 + col];
  [0, 1, 2].forEach((col) => {
    assert.match(cellAt(col, 14).style.background, /--dhuhr/);
    assert.match(cellAt(col, 0).style.background, /--isha/);
  });
});

test("the date bar and week strip stay pinned while the day scrolls past", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const sticky = app.document.querySelector("#view-calendar .cal-sticky");
  assert.ok(sticky, "the dates live in their own pinned strip");
  assert.ok(sticky.querySelector("#calDatePick"), "the date bar is inside it");
  assert.ok(sticky.querySelector("#calStrip"), "and so is the week strip");
  // The day itself must not scroll internally - the page scrolls instead.
  assert.equal(app.document.querySelector(".cal-hours"), null);
});
