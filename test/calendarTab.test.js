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
  // The chip carries no time: where it sits in the grid says when it is, and
  // those characters were the difference between a title that reads and one
  // that is cut off in a narrow column. The tooltip still has it.
  assert.doesNotMatch(chip.textContent, /2:30/, "the chip shows no clock time");
  assert.match(chip.title, /2:30 PM/, "but the tooltip does, in AM/PM like everywhere else");
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

test("a prayer window changes the colour at its exact minute, not at the hour", async () => {
  // Maghrib at 20:34 and Isha at 21:38: both start mid-hour, so both hours
  // have to carry two colours split at the right point.
  const app = loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "03:52", Sunrise: "05:36", Dhuhr: "13:09", Asr: "18:11", Maghrib: "20:34", Isha: "21:38" } })],
    ]),
  });
  useMyLocation(app);
  await app.flush();
  await app.flush();
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const hours = curHours(app);

  // 20:00-20:34 is Asr, 20:34-21:00 is Maghrib. 34/60 = 56.667%.
  const eight = hours[20].style.background;
  assert.match(eight, /^linear-gradient/, "an hour a window starts in carries both colours");
  assert.match(eight, /--asr/);
  assert.match(eight, /--maghrib/);
  assert.match(eight, /56\.667%/, `the split lands on the minute, got: ${eight}`);

  // 21:38 -> 38/60 = 63.333%.
  const nine = hours[21].style.background;
  assert.match(nine, /--maghrib/);
  assert.match(nine, /--isha/);
  assert.match(nine, /63\.333%/, `got: ${nine}`);

  // An hour wholly inside one window stays a flat colour - no pointless gradient.
  assert.doesNotMatch(hours[15].style.background, /linear-gradient/);
  assert.match(hours[15].style.background, /--dhuhr/);
});

test("the split moves with the times, rather than snapping to the same slot", async () => {
  const at = (maghrib) => loadApp({
    geolocation: { lat: 51.5, lon: -0.12 },
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "03:52", Sunrise: "05:36", Dhuhr: "13:09", Asr: "18:11", Maghrib: maghrib, Isha: "21:38" } })],
    ]),
  });
  const read = async (app) => {
    useMyLocation(app);
    await app.flush();
    await app.flush();
    app.goTo("calendar");
    await app.flush();
    await app.flush();
    return curHours(app)[20].style.background;
  };

  // A minute's drift in the times has to be a minute's drift in the colour;
  // both of these used to tint the whole 20:00 hour identically.
  const early = await read(at("20:02"));
  const late = await read(at("20:58"));
  assert.match(early, /3\.333%/, `20:02 is 2/60 of the way down, got: ${early}`);
  assert.match(late, /96\.667%/, `20:58 is 58/60 of the way down, got: ${late}`);
});

test("the calendar has no ring around the current prayer window - the tint is enough", async () => {
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

  // A border on top of a tint that already says the same thing was noise.
  assert.equal(app.document.querySelectorAll("#calDayCur .in-prayer").length, 0);
  assert.equal(app.document.querySelectorAll("#calDayCur .win-first, #calDayCur .win-last").length, 0);
  const styles = app.document.querySelector("style").textContent;
  assert.equal(/\.cal-cell\.in-prayer/.test(styles), false, "and the rule is gone, not just unused");

  // What does still mark the calendar: the tint, the hour it is now, and the
  // now-line. Only the window ring went.
  const hours = curHours(app);
  hours.forEach((h) => assert.notEqual(h.style.background, "", "every hour is still tinted"));
  assert.equal(app.document.querySelectorAll("#calDayCur .cal-cell.current-hour").length, 1);
  assert.ok(app.document.querySelector("#calDayCur .cal-nowline"));

  // And the window you're in is still called out where it belongs.
  app.goTo("prayers");
  await app.flush();
  assert.ok(app.document.querySelectorAll("#prayBox label.prow.is-now").length <= 1);
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

test("the grid is on screen before the network answers, not after", async () => {
  // Nothing here ever resolves: the calendar must not be waiting on it. The
  // hours, the layout and the prayer tints are all local - only the events
  // come from Google, and they arrive into a grid that is already drawn.
  let asked = 0;
  const app = loadApp({
    localStorageSeed: {
      yawarWellness_v1: JSON.stringify({
        schema: 3,
        profile: { startWeight: "", targetWeight: "", updated_at: 1, tasks: [], prayerLoc: { lat: 51.5, lon: -0.12 } },
        days: {},
      }),
      // A prayer day already in cache, so the tints are there on the first
      // frame too - which is the point of consulting the cache first.
      [`yawarPrayerCache_${todayKey()}|51.50|-0.12|3|shafii`]: JSON.stringify({
        at: Date.now(),
        times: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" },
      }),
    },
    fetchImpl: () => { asked++; return new Promise(() => {}); },
  });

  app.goTo("calendar");
  await app.flush();

  const hours = curHours(app);
  assert.equal(hours.length, 24, "the whole day is drawn with every request still in flight");
  assert.match(hours[14].style.background, /--dhuhr/,
    "and a cached day is tinted straight away rather than after a round trip");
  assert.ok(asked > 0, "the fetches did go out - they just aren't blocking the paint");
});

test("a peek column draws an event to its real length, not as a fixed label", async () => {
  const at = (offset, h, m) => { const d = addDays(new Date(), offset); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
  const app = loadApp({
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [
        { id: "e1", calendarId: "p", title: "Obstetric appointment", start: at(1, 9, 0), end: at(1, 10, 0), writable: true, calendar: "Family" },
        { id: "e2", calendarId: "p", title: "Quick sync", start: at(1, 9, 30), end: at(1, 9, 45), writable: true, calendar: "Work" },
        { id: "e3", calendarId: "p", title: "Workshop", start: at(2, 14, 30), end: at(2, 17, 0), writable: true, calendar: "Work" },
      ] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
    ]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const mini = (title) => [...app.document.querySelectorAll("#calDayCur .cal-mini")]
    .find((m) => m.textContent === title);

  // An hour long, starting on the hour.
  // Measured in rows, not percentages: a percentage resolves against the
  // cell's content box, which is a border and two paddings shorter than the
  // row, so a four-hour event came out three rows tall.
  const rows = (v) => Number((String(v).match(/var\(--cal-row\) \* ([\d.]+)/) || [])[1]);
  const ob = mini("Obstetric appointment");
  assert.ok(ob.classList.contains("is-timed"));
  assert.equal(rows(ob.style.top), 0);
  assert.equal(rows(ob.style.height), 1, "an hour should be one row");

  // A quarter of an hour, starting halfway down it - and beside the other
  // one rather than on top of it, since both are positioned now.
  const qs = mini("Quick sync");
  assert.equal(rows(qs.style.top), 0.5);
  assert.equal(rows(qs.style.height), 0.25);
  assert.notEqual(qs.style.insetInlineStart, ob.style.insetInlineStart);

  // Two and a half hours: it runs past its own cell into the ones it covers.
  assert.equal(rows(mini("Workshop").style.height), 2.5);
  assert.equal(rows(mini("Workshop").style.top), 0.5);
});

test("an all-day chip is not positioned by time - there is no time to position it by", async () => {
  const day = todayKey();
  const app = loadApp({
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [
        { id: "e1", calendarId: "p", title: "Bank holiday", start: day, allDay: true, writable: true, calendar: "Personal" },
      ] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
    ]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const all = [...app.document.querySelectorAll("#calDayCur .cal-allday .cal-mini")];
  all.forEach((m) => {
    assert.equal(m.classList.contains("is-timed"), false);
    assert.equal(m.style.height, "");
  });
});

test("the legend calls the sunrise window Chasht, the way everything else does", async () => {
  const app = loadApp({ fetchImpl: fetchRouter([[ "/api", () => jsonRes({ connected: false, status: "not_connected" }) ]]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const legend = app.document.getElementById("calLegend").textContent;
  assert.match(legend, /Chasht/);
  assert.doesNotMatch(legend, /Sunrise/, "the legend was the last place still naming the astronomical event");
});

test("the focused column sizes an event by its length too, not just the peeks", async () => {
  const at = (h, m) => { const d = new Date(); d.setHours(h, m || 0, 0, 0); return d.toISOString(); };
  const app = loadApp({
    fetchImpl: fetchRouter([
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [
        { id: "e1", calendarId: "p", title: "Birthday", start: at(17, 0), end: at(21, 0), writable: true, calendar: "Family" },
        { id: "e2", calendarId: "p", title: "Cancel membership", start: at(16, 0), end: at(16, 30), writable: true, calendar: "Family" },
      ] })],
      ["/api/prayer", () => jsonRes({ source: "ummahapi", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
    ]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const chip = (title) => [...app.document.querySelectorAll("#calDayCur .cal-chip")]
    .find((c) => c.querySelector(".cal-chip-title").textContent === title);
  const rows = (v) => Number((String(v).match(/var\(--cal-row\) \* ([\d.]+)/) || [])[1]);

  // Four hours is four rows. It was one, the height coming from how much
  // text happened to fit rather than from when the event ends.
  const bday = chip("Birthday");
  assert.ok(bday.classList.contains("is-timed"));
  assert.equal(rows(bday.style.height), 4);

  // Half an hour is half a row - it must not stretch to fit its own text.
  assert.equal(rows(chip("Cancel membership").style.height), 0.5);

  // Inside .cal-hour-events, so it cancels that box's top padding to line up
  // with the top of its hour; a peek chip sits against the cell and doesn't.
  assert.match(bday.style.top, /var\(--cal-pad-t\)/);
});
