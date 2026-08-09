"use strict";
/*
 * Calendar tab coverage: the seven-day week grid fed by a single ranged
 * /api/calendar/events request, the focused day being several times wider
 * than the rest, connect/reconnect/error states, sliding between days
 * within a week, week paging via the arrows (a real slide animation, hence
 * the waits), and the prayer-window colour bands.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

// The grid slides out and back in; a week change is settled after both halves.
const PAGE_MS = 500;

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
/** Monday-start week containing today, same rule the app uses. */
function thisMonday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x; }
function atHourToday(h) {
  const d = new Date();
  d.setHours(h, 0, 0, 0);
  return d.toISOString();
}

function rangeTracker(events) {
  const seen = [];
  const route = ["/api/calendar/events", (u) => {
    const s = String(u);
    seen.push({
      date: (s.match(/date=([^&]+)/) || [])[1],
      end: (s.match(/end=([^&]+)/) || [])[1],
    });
    return jsonRes({ connected: true, status: "ok", day: "x", events: events || [] });
  }];
  return { seen, route, last: () => seen[seen.length - 1] };
}

test("renders a Monday-start week: an hour gutter plus seven day columns, 24 rows deep", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: "x", events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const grid = app.document.getElementById("calWeek");
  assert.equal(grid.querySelectorAll(".cal-wk-head").length, 7, "seven day headings");
  assert.equal(grid.querySelectorAll(".cal-cell").length, 24 * 7, "24 hours across 7 days");
  // 1 gutter cell in the header row + one per hour row.
  assert.equal(grid.querySelectorAll(".cal-wk-gutter").length, 25);

  const heads = Array.from(grid.querySelectorAll(".cal-wk-head"));
  assert.deepEqual(heads.map((h) => h.textContent.replace(/^\d+/, "")), ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  const monday = thisMonday();
  assert.equal(heads[0].querySelector("b").textContent, String(monday.getDate()));
  assert.equal(heads[6].querySelector("b").textContent, String(addDays(monday, 6).getDate()));
});

test("fetches the whole week in one ranged request, not seven day requests", async () => {
  const tracker = rangeTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();

  assert.equal(tracker.seen.length, 1, "one call covers the week");
  assert.equal(tracker.last().date, keyOf(thisMonday()));
  assert.equal(tracker.last().end, keyOf(addDays(thisMonday(), 6)));
});

test("today's column is the wide one and is marked, and tapping another day widens that one instead", async () => {
  const tracker = rangeTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();

  const grid = () => app.document.getElementById("calWeek");
  const todayIdx = (new Date().getDay() + 6) % 7;
  // minmax(0,4fr) / minmax(0,1fr) per day, after the fixed hour-gutter track.
  const cols = () => (grid().style.gridTemplateColumns.match(/minmax\([^)]*\)/g) || []);

  assert.equal(cols().length, 7);
  assert.equal(cols()[todayIdx], "minmax(0,4fr)", "the day in focus is several times wider");
  assert.equal(cols().filter((c) => c === "minmax(0,4fr)").length, 1, "and only that one");
  assert.ok(grid().querySelectorAll(".cal-wk-head")[todayIdx].classList.contains("is-today"));

  // Pick a different day of the same week.
  const otherIdx = todayIdx === 0 ? 3 : 0;
  grid().querySelectorAll(".cal-wk-head")[otherIdx].click();
  await app.flush();

  assert.equal(cols()[otherIdx], "minmax(0,4fr)");
  assert.equal(cols()[todayIdx], "minmax(0,1fr)");
  assert.ok(grid().querySelectorAll(".cal-wk-head")[otherIdx].classList.contains("is-sel"));
  assert.ok(grid().querySelectorAll(".cal-wk-head")[todayIdx].classList.contains("is-today"),
    "the real today is still flagged even when another day is expanded");
});

test("each event lands in its own day column and hour row, coloured by source calendar", async () => {
  const monday = thisMonday();
  const wed = addDays(monday, 2);
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({
      connected: true, status: "ok", day: "x",
      events: [
        { title: "Standup", start: new Date(monday.getFullYear(), monday.getMonth(), monday.getDate(), 9, 0).toISOString(), allDay: false, calendar: "Yawar", color: "#4285f4" },
        { title: "Physio", start: new Date(wed.getFullYear(), wed.getMonth(), wed.getDate(), 14, 30).toISOString(), allDay: false, location: "Clinic", calendar: "Yawar", color: "#4285f4" },
        { title: "Mum's birthday", start: keyOf(wed), allDay: true, calendar: "Family", color: "#0b8043" },
      ],
    })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const cells = app.document.querySelectorAll("#calWeek .cal-cell");
  const cellAt = (dayIdx, hour) => cells[hour * 7 + dayIdx];

  // Narrow days show a colour bar per event; you slide to a day to read it.
  assert.equal(cellAt(0, 9).querySelectorAll(".cal-bar").length, 1, "Monday 09:00");
  assert.equal(cellAt(2, 14).querySelectorAll(".cal-bar").length, 1, "Wednesday 14:00");
  assert.equal(cellAt(2, 0).querySelectorAll(".cal-bar").length, 1, "an all-day event sits in that day's 00:00 row");
  assert.equal(cellAt(0, 10).children.length, 0, "hours with nothing on stay empty");
  assert.equal(cellAt(2, 0).querySelector(".cal-bar").style.background, "rgb(11, 128, 67)");
  assert.match(cellAt(2, 14).querySelector(".cal-bar").title, /Physio/, "the full detail is still reachable");

  // Focusing Wednesday turns its bars into readable chips.
  app.document.querySelectorAll("#calWeek .cal-wk-head")[2].click();
  const chip = cellAt(2, 14).querySelector(".cal-chip");
  assert.ok(chip, "the focused day renders text, not bars");
  assert.match(chip.textContent, /Physio/);
  assert.match(chip.textContent, /Clinic/);
  assert.equal(cellAt(2, 14).querySelector(".cal-bar"), null);
});

test("prayer windows tint every hour of every day, with each day using its own times", async () => {
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: "x", events: [] })],
      ["api.aladhan.com", () => jsonRes({ data: { timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } } })],
    ]),
  });
  app.click("prayerLocBtn");
  await app.flush();
  await app.flush();

  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const cells = app.document.querySelectorAll("#calWeek .cal-cell");
  assert.equal(cells.length, 24 * 7);
  cells.forEach((c) => assert.notEqual(c.style.background, "", "every hour of every day is tinted"));

  const cellAt = (dayIdx, hour) => cells[hour * 7 + dayIdx];
  assert.match(cellAt(0, 6).style.background, /--sunrise/);
  assert.match(cellAt(4, 14).style.background, /--dhuhr/);
  // Overnight either side of midnight belongs to Isha's window.
  assert.match(cellAt(3, 0).style.background, /--isha/);
  assert.match(cellAt(3, 23).style.background, /--isha/);
});

test("the current hour is marked once, in today's column only", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: "x", events: [{ title: "Now", start: atHourToday(new Date().getHours()), allDay: false, calendar: "Yawar" }] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  const marked = app.document.querySelectorAll("#calWeek .cal-cell.current-hour");
  assert.equal(marked.length, 1);
  const cells = Array.from(app.document.querySelectorAll("#calWeek .cal-cell"));
  const idx = cells.indexOf(marked[0]);
  assert.equal(idx % 7, (new Date().getDay() + 6) % 7, "in today's column");
  assert.equal(Math.floor(idx / 7), new Date().getHours(), "on the current hour's row");
  assert.ok(marked[0].querySelector(".cal-nowline"), "with a now-line inside it");
});

test("reconnect_required, calendar_error and an empty week each say something specific", async () => {
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

  const empty = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: todayKey(), events: [] })]]),
  });
  empty.goTo("calendar");
  await empty.flush();
  assert.match(empty.document.getElementById("calStatus").textContent, /nothing scheduled this week/i);

  const off = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: false, status: "not_connected", day: todayKey(), events: [] })]]),
  });
  off.goTo("calendar");
  await off.flush();
  assert.match(off.document.getElementById("calStatus").textContent, /connect google calendar/i);
});

test("the prev/next buttons move a whole week at a time, and Today comes back", async () => {
  const tracker = rangeTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  const thisWeek = tracker.last().date;

  app.click("calNextDay");
  await app.wait(PAGE_MS);
  assert.equal(tracker.last().date, keyOf(addDays(thisMonday(), 7)), "a full week forward");

  app.click("calPrevDay");
  await app.wait(PAGE_MS);
  assert.equal(tracker.last().date, thisWeek);

  app.click("calJumpToday");
  await app.flush();
  assert.equal(tracker.last().date, thisWeek);
});

test("swiping slides between days inside the week, without refetching or paging the week", async () => {
  const tracker = rangeTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();

  const heads = () => app.document.querySelectorAll("#calWeek .cal-wk-head");
  const focused = () => Array.from(heads()).findIndex((h) => h.classList.contains("is-sel"));
  const grid = app.document.getElementById("calGrid");

  // Start from midweek so there's room to slide either way regardless of
  // which weekday the suite happens to run on.
  heads()[2].click();
  assert.equal(focused(), 2);
  const fetchesSoFar = tracker.seen.length;

  app.swipe("calGrid", -80, 0); // left -> next day
  assert.equal(focused(), 3);

  app.swipe("calGrid", 80, 0);  // right -> back
  app.swipe("calGrid", 80, 0);  // right again
  assert.equal(focused(), 1);

  assert.equal(tracker.seen.length, fetchesSoFar, "the week is already loaded - no refetching to change day");
  assert.equal(grid.style.transform, "", "the week itself doesn't slide away; only the focus moves");

  // A short / mostly-vertical drag is a scroll, not a slide.
  app.swipe("calGrid", 10, 60);
  assert.equal(focused(), 1);
});

test("swiping past the edge of the week carries on into the next one rather than dead-ending", async () => {
  const tracker = rangeTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  const thisWeek = tracker.last().date;
  const grid = app.document.getElementById("calGrid");

  app.document.querySelectorAll("#calWeek .cal-wk-head")[6].click(); // Sunday
  app.swipe("calGrid", -80, 0);

  // Mid-flight the outgoing week is pushed off and the next one has NOT been
  // fetched yet - that's what makes it read as a stack, not a jump.
  assert.match(grid.style.transform, /translateX\(-100%\)/);
  assert.equal(tracker.last().date, thisWeek);

  await app.wait(PAGE_MS);
  assert.equal(tracker.last().date, keyOf(addDays(thisMonday(), 7)), "landed in the following week");
  assert.equal(grid.style.transform, "", "settles back to its resting position");
  assert.equal(
    Array.from(app.document.querySelectorAll("#calWeek .cal-wk-head")).findIndex((h) => h.classList.contains("is-sel")),
    0, "on the Monday just past the edge we swiped over");
});

test("the Calendar tab no longer carries a task list - it is just the calendar", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", day: "x", events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();

  assert.equal(app.document.getElementById("calTaskList"), null);
  assert.equal(app.document.getElementById("calTaskTitleIn"), null);
  assert.equal(app.document.getElementById("calTaskAddBtn"), null);
});
