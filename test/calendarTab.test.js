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

/** An instant `days` days from today, at the given local time. */
function atDay(days, h, m) {
  const d = new Date();
  d.setDate(d.getDate() + days);
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

// The all-day row is also an `is-main` cell, so "hours" excludes it.
const curHours = (app) => app.document.querySelectorAll("#calDayCur .cal-cell.is-main:not(.cal-allday)");
const gutterHours = (app) => app.document.querySelectorAll("#calDayCur .cal-gutter:not(.cal-allday):not(.cal-gutter-head)");
// The gutter's own heading is a .cal-gutter, not a .cal-gh, so these are
// exactly the seven day headings.
const dayHeads = (app) => Array.from(app.document.querySelectorAll("#calDayCur .cal-gh"));
const dayCols = (app) => Array.from(new Set(Array.from(
  app.document.querySelectorAll("#calDayCur .cal-cell[data-day]")).map((c) => c.getAttribute("data-day")))).sort();
const heading = (app) => app.document.getElementById("calDayHeading").textContent;

test("shows a whole Monday-to-Sunday week in one grid", async () => {
  const app = loadApp({ fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })]]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  assert.deepEqual(dayCols(app), Array.from({ length: 7 }, (_, i) => keyOf(addDays(thisMonday(), i))),
    "Monday through Sunday, whatever day is focused");
  assert.equal(curHours(app).length, 24, "the focused day is a whole day");
  // The hour labels live in a gutter column of their own, because the focused
  // day is somewhere inside the week rather than at its left edge.
  assert.equal(gutterHours(app)[0].textContent, "12 AM");
  assert.equal(gutterHours(app)[23].textContent, "11 PM");
  assert.match(heading(app), /Today/);
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

test("the day headings are the only date row, and tapping one focuses it", async () => {
  // There used to be a separate week strip above the grid saying the same
  // thing in columns that did not line up with the grid's own.
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  assert.equal(app.document.getElementById("calStrip"), null, "no duplicate strip");
  const heads = dayHeads(app);
  assert.equal(heads.length, 7);
  assert.deepEqual(heads.map((h) => h.querySelector("b").textContent),
    Array.from({ length: 7 }, (_, i) => String(addDays(thisMonday(), i).getDate())));

  const todayIdx = (new Date().getDay() + 6) % 7;
  assert.ok(heads[todayIdx].classList.contains("is-today"));
  assert.ok(heads[todayIdx].classList.contains("is-focus"));

  const otherIdx = todayIdx === 0 ? 4 : 0;
  dayHeads(app)[otherIdx].dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await app.flush();
  await app.flush();

  assert.equal(app.document.getElementById("calDatePick").value, keyOf(addDays(thisMonday(), otherIdx)));
  assert.ok(dayHeads(app)[otherIdx].classList.contains("is-focus"));
  assert.ok(dayHeads(app)[todayIdx].classList.contains("is-today"), "today is still flagged");
});

test("a sideways drag on the grid never changes tab - the week scrolls instead", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  app.swipe("calGrid", -140, 0);
  await app.flush();
  assert.equal(app.document.querySelector(".view.active").id, "view-calendar");
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
  assert.ok(allDay, "an all-day event gives the week an all-day row");
  assert.match(allDay.textContent, /Mum's birthday/);
  // The row is labelled once, in the hour gutter, rather than in every column.
  assert.match(app.document.querySelector("#calDayCur .cal-gutter.cal-allday").textContent, /All day/);
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

test("the current hour is marked, with a now-line, and only on today's column", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  const marked = app.document.querySelectorAll("#calDayCur .cal-cell.current-hour");
  assert.equal(marked.length, 1, "one hour, in one column, out of the whole week");
  assert.equal(marked[0].getAttribute("data-day"), todayKey());
  const h = new Date().getHours();
  assert.equal(gutterHours(app)[h].textContent,
    (h % 12 === 0 ? 12 : h % 12) + " " + (h < 12 ? "AM" : "PM"));
  assert.ok(marked[0].querySelector(".cal-nowline"));
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

test("the date bar stays pinned while the week scrolls past it", async () => {
  const tracker = windowTracker();
  const app = loadApp({ fetchImpl: fetchRouter([tracker.route]) });
  app.goTo("calendar");
  await app.flush();

  const sticky = app.document.querySelector("#view-calendar .cal-sticky");
  assert.ok(sticky, "the date bar is in a pinned wrapper");
  assert.ok(sticky.querySelector("#calDateLabel"), "and it is the date bar that is pinned");
  assert.equal(sticky.querySelector("#calStrip"), null, "the duplicate week strip is gone");
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

/* --- the wide (week) layout -------------------------------------------- */

test("on a desktop every one of the seven days is tinted, including the Monday", async () => {
  // The prayer-times range used to be derived as calCur-1 .. calCur+N, which
  // is right for the phone's day-plus-two panel but wrong for a Monday-start
  // week: the first column can be six days *before* calCur, so it got no
  // times and rendered as the one white column in a tinted grid.
  const app = loadApp({
    innerWidth: 1280,
    localStorageSeed: {
      yawarWellness_v1: JSON.stringify({
        schema: 4,
        profile: { startWeight: "", targetWeight: "", updated_at: 1, tasks: [], prayerLoc: { lat: 51.5, lon: -0.12 } },
        days: {},
      }),
    },
    fetchImpl: fetchRouter([
      ["/api/prayer", () => jsonRes({ source: "test", timings: { Fajr: "04:45", Sunrise: "05:50", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" } })],
      ["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })],
    ]),
  });
  app.goTo("calendar");
  for (let i = 0; i < 8; i++) await app.flush();

  const days = Array.from(new Set(
    Array.from(app.document.querySelectorAll("#calDayCur .cal-cell[data-day]")).map((c) => c.getAttribute("data-day"))
  )).sort();
  assert.equal(days.length, 7, "a whole week of columns");

  days.forEach((day) => {
    const tinted = Array.from(app.document.querySelectorAll(`#calDayCur .cal-cell[data-day="${day}"]`))
      .filter((c) => c.style.background);
    assert.ok(tinted.length > 0, day + " has no prayer tint at all");
  });
});

test("on a desktop every column carries readable chips, not colour blocks", async () => {
  // A 74px peek column can only hold a colour bar; a 170px desktop column can
  // hold the title, and rendering a bar there throws away the screen.
  const start = atToday(9, 0);
  // The panel is a Monday-Sunday week, so "the next day" is only in it when
  // today isn't Sunday - on a Sunday it belongs to next week and the column
  // genuinely isn't there. Step towards the middle of the week instead of
  // assuming +1, or this test fails once every seven days.
  const otherDay = new Date().getDay() === 1 ? 1 : -1;
  const app = loadApp({
    innerWidth: 1280,
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({
      connected: true, status: "ok",
      events: [
        { title: "Physio", start, allDay: false, calendar: "Yawar", color: "#4285f4" },
        { title: "Standup", start: atDay(otherDay, 9, 0), allDay: false, calendar: "Work", color: "#0b8043" },
      ],
    })]]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  assert.equal(app.document.querySelectorAll("#calDayCur .cal-mini").length, 0,
    "no colour-block minis anywhere in the week layout");
  const titles = Array.from(app.document.querySelectorAll("#calDayCur .cal-chip-title")).map((n) => n.textContent);
  assert.ok(titles.includes("Physio"), "the focused day reads");
  assert.ok(titles.includes("Standup"), "and so does a day that is not focused");
});

test("on a phone the week keeps its column width and scrolls sideways", async () => {
  // Shrinking columns to fit is what made it unreadable. The grid keeps a
  // fixed column width and the card scrolls instead.
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })]]),
  });
  app.goTo("calendar");
  await app.flush();
  await app.flush();

  assert.equal(dayCols(app).length, 7, "the whole week is there to scroll through");
  const group = app.document.querySelector("#calDayCur .cal-daygroup");
  assert.ok(group.classList.contains("is-week"));
  assert.ok(!group.classList.contains("is-wide"), "and it is not the fitted desktop layout");
  // Fixed widths, not fractions of the screen - and the day you are on is
  // the wide one, the way it is on a desktop.
  const tpl = group.style.gridTemplateColumns;
  assert.equal((tpl.match(/var\(--cal-col\)/g) || []).length, 6);
  assert.equal((tpl.match(/var\(--cal-col-focus\)/g) || []).length, 1);
  const cols = tpl.split(" ").slice(1);
  assert.equal(cols[(new Date().getDay() + 6) % 7], "var(--cal-col-focus)",
    "the focused column is the wide one, wherever it falls in the week");
});

test("the grid is its own scrollport, so the dates and the hours can stay put", () => {
  // Sticky can only stick to a scrollport. With a horizontal scroller in the
  // way the page is no longer the scrollport for anything inside the grid, so
  // the grid has to scroll in both directions itself.
  const app = loadApp({ fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })]]) });
  const css = app.document.querySelector("style").textContent;
  assert.match(css, /\.cal-viewport\{[^}]*overflow:auto/, "both axes, not just x");
  assert.match(css, /\.cal-viewport\{[^}]*max-height:var\(--cal-h\)/, "and a height to scroll within");
  assert.match(css, /\.cal-daygroup\.is-week \.cal-gh\{position:sticky;top:0/, "the date row stays at the top");
  assert.match(css, /\.cal-gutter\{position:sticky;inset-inline-start:0/, "the hours stay at the left");
});

test("opening the tab scrolls the week sideways to the focused day", async () => {
  // The week starts on Monday, so opening on a Thursday would otherwise show
  // three days already gone. The earlier days stay a scroll to the left.
  //
  // jsdom reports every offset as 0, so this can only check that the grid is
  // positioned at all, not where it lands. Where it lands was measured in
  // Chromium: today's column sits against the gutter.
  const app = loadApp({ fetchImpl: fetchRouter([["/api/calendar/events", () => jsonRes({ connected: true, status: "ok", events: [] })]]) });
  const view = app.document.getElementById("calGrid");
  let writes = 0;
  Object.defineProperty(view, "scrollLeft", {
    set() { writes++; }, get() { return 0; }, configurable: true,
  });

  app.goTo("calendar");
  await app.flush();
  await app.flush();
  assert.ok(writes > 0, "the grid is scrolled to the focused day when the tab opens");
});
