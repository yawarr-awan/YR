"use strict";
/*
 * The Journal tab, and the two new Progress charts (prayers and sleep).
 *
 * The charts are asserted on through their summary lines rather than their
 * pixels: jsdom has no 2D context, so the canvas is stubbed in lib.js. The
 * note under each chart is the same data the drawing uses, which is why it
 * exists in the app at all - it is the chart in words.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY } = require("./lib.js");
after(closeAllApps);

const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

function dayKeyBack(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function blank(extra) {
  return Object.assign({
    meds: {}, prayers: {}, meals: {}, extras: {},
    dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null,
    exercise: false, notes: "", updated_at: 1,
  }, extra || {});
}

function seed(days) {
  return {
    [MAIN_KEY]: JSON.stringify({
      schema: 4,
      profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] },
      days,
      sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    }),
  };
}

/* ---------------- the tab itself ---------------- */

test("Journal is a tab of its own, between Progress and Settings", () => {
  const app = loadApp({ fetchImpl: idle });
  const labels = Array.from(app.document.querySelectorAll("#tabs button")).map((b) => b.getAttribute("data-nav"));
  assert.equal(labels.indexOf("journal"), labels.indexOf("progress") + 1);
  assert.equal(labels.indexOf("journal"), labels.indexOf("settings") - 1);

  app.goTo("journal");
  assert.equal(app.document.querySelector(".view.active").id, "view-journal");
  assert.ok(app.document.getElementById("jrnText"), "with a box to write in");
});

test("typing an entry saves it into the day record, with no Save button to press", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("journal");
  const ta = app.document.getElementById("jrnText");
  ta.value = "Walked to the park. Long call with Mum.";
  ta.dispatchEvent(new app.window.Event("input", { bubbles: true }));

  const stored = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  assert.equal(stored.days[dayKeyBack(0)].notes, "Walked to the park. Long call with Mum.");
  assert.ok(stored.days[dayKeyBack(0)].updated_at > 1, "stamped, so it actually syncs");
  assert.match(app.document.getElementById("jrnCount").textContent, /^8 words$/);
});

test("an entry written before the tab existed is still there", () => {
  // The field is the day record's `notes`, which has been in blankDay() from
  // the start and was kept when the Today tab's notes card was removed.
  const days = {};
  days[dayKeyBack(0)] = blank({ notes: "Written by the old Notes card." });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("journal");
  assert.equal(app.document.getElementById("jrnText").value, "Written by the old Notes card.");
});

test("the date bar moves the entry, and Today comes back to today", () => {
  const days = {};
  days[dayKeyBack(0)] = blank({ notes: "today's entry" });
  days[dayKeyBack(1)] = blank({ notes: "yesterday's entry" });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("journal");
  assert.equal(app.document.getElementById("jrnText").value, "today's entry");
  assert.match(app.document.getElementById("jrnDateLabel").textContent, /^Today · /);

  app.document.getElementById("jrnPrevDay").click();
  assert.equal(app.document.getElementById("jrnText").value, "yesterday's entry");
  assert.doesNotMatch(app.document.getElementById("jrnDateLabel").textContent, /^Today · /);

  app.document.getElementById("jrnJumpToday").click();
  assert.equal(app.document.getElementById("jrnText").value, "today's entry");
});

test("earlier entries are listed newest first, exclude the day on screen, and jump to their day", () => {
  const days = {};
  days[dayKeyBack(0)] = blank({ notes: "today" });
  days[dayKeyBack(1)] = blank({ notes: "yesterday" });
  days[dayKeyBack(2)] = blank({ notes: "" });          // nothing written: not an entry
  days[dayKeyBack(3)] = blank({ notes: "three days ago" });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("journal");

  const rows = Array.from(app.document.querySelectorAll("#jrnPastBox .jrn-past"));
  assert.equal(rows.length, 2, "today is the one on screen, and the blank day is not an entry");
  assert.match(rows[0].textContent, /yesterday/);
  assert.match(rows[1].textContent, /three days ago/);
  assert.equal(app.document.getElementById("jrnPastCount").textContent, "2");

  rows[1].click();
  assert.equal(app.document.getElementById("jrnText").value, "three days ago");
});

test("a long history folds behind a Show all, same as the prayer summary", () => {
  const days = {};
  for (let i = 0; i <= 14; i++) days[dayKeyBack(i)] = blank({ notes: "entry " + i });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("journal");

  assert.equal(app.document.querySelectorAll("#jrnPastBox .jrn-past").length, 10);
  const more = app.document.querySelector("#jrnPastBox .linklike");
  assert.match(more.textContent, /Show all 14 entries/);
  more.click();
  assert.equal(app.document.querySelectorAll("#jrnPastBox .jrn-past").length, 14);
});

test("a sync pull never overwrites the box while it is being typed in", () => {
  // renderAll() runs after a pull replaces the whole store. Every keystroke is
  // already in state, so a focused box is never stale - but it must not be
  // rewritten under the cursor either.
  const app = loadApp({ fetchImpl: idle });
  app.goTo("journal");
  const ta = app.document.getElementById("jrnText");
  ta.focus();
  ta.value = "half a sen";
  ta.dispatchEvent(new app.window.Event("input", { bubbles: true }));
  ta.value = "half a sentence still being ty";
  assert.equal(ta.value, "half a sentence still being ty",
    "renderJournalPast ran on that keystroke and left the box alone");
});

/* ---------------- the prayer chart ---------------- */

const prayerNote = (app) => app.document.getElementById("prayerChartNote").textContent;

test("the prayer chart counts every date since the first record, not only the days with one", () => {
  // Same range as the prayer summary and the qada debt: a date with no record
  // is a day none were prayed, and leaving it out drew a flattering line that
  // disagreed with the numbers right next to it.
  const days = {};
  days[dayKeyBack(3)] = blank({ prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true } });
  days[dayKeyBack(1)] = blank({ prayers: { fajr: true } });
  days[dayKeyBack(0)] = blank({ prayers: { fajr: true, dhuhr: true } });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("progress");

  // Three completed days: -3 (five), -2 (no record at all, so zero), -1 (one).
  assert.match(prayerNote(app), /^3 completed day\(s\) since /);
  assert.match(prayerNote(app), /average 2\.0 of 5/);
  assert.match(prayerNote(app), /1 full day\(s\)/);
  assert.match(prayerNote(app), /9 missed in total/, "the unlogged day counts as five missed");
});

test("today is left off the prayer chart, because it isn't finished", () => {
  const all = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };
  const days = {};
  days[dayKeyBack(2)] = blank({ prayers: all });
  days[dayKeyBack(1)] = blank({ prayers: all });
  days[dayKeyBack(0)] = blank({ prayers: { fajr: true } });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("progress");
  assert.match(prayerNote(app), /^2 completed day/);
  assert.match(prayerNote(app), /average 5\.0 of 5/, "today's single prayer would have dragged this down");
  assert.match(prayerNote(app), /0 missed in total/);
});

test("with no completed days the prayer chart says so instead of drawing a line", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("progress");
  assert.match(prayerNote(app), /couple of completed days/i);
});

/* ---------------- the sleep chart ---------------- */

const sleepNote = (app) => app.document.getElementById("sleepChartNote").textContent;

test("the sleep chart plots the nights actually logged, and an unlogged night is not zero hours", () => {
  const days = {};
  days[dayKeyBack(3)] = blank({ sleep: "8" });
  days[dayKeyBack(2)] = blank({ sleep: "" });     // nothing logged: missing, not zero
  days[dayKeyBack(1)] = blank({ sleep: "5" });
  days[dayKeyBack(0)] = blank({ sleep: "6.5" });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("progress");

  assert.match(sleepNote(app), /^3 night\(s\) logged/);
  assert.match(sleepNote(app), /average 6\.5h/, "the blank night is absent, not averaged in as a zero");
  assert.match(sleepNote(app), /shortest 5h · longest 8h/);
  assert.match(sleepNote(app), /1 night\(s\) at 7h or more/);
});

test("one night is not a pattern, and the sleep chart says so", () => {
  const days = {};
  days[dayKeyBack(0)] = blank({ sleep: "7" });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("progress");
  assert.match(sleepNote(app), /at least two nights/i);
});

test("both new charts sit on the Progress tab as cards of their own", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("progress");
  assert.ok(app.document.getElementById("prayerChart"));
  assert.ok(app.document.getElementById("sleepChart"));
  // Movable like every other card on the tab (see LAYOUT_VIEWS).
  ["prayertrend", "sleeptrend"].forEach((k) => {
    assert.ok(app.document.querySelector('#view-progress > .grid > .card[data-card="' + k + '"]'),
      k + " is a direct child card of the view's grid, so it can be rearranged");
  });
});
