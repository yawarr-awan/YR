"use strict";
/*
 * Made-up (qada) prayers: recording prayers you've since made up should pay
 * down the missed-prayer count in the Progress tab rather than editing the
 * historical record of which prayers were prayed on the day.
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

/** Two completed past days with nothing ticked => 2 missed of each prayer. */
function seedWithMissedPrayers(extra) {
  const blank = () => ({ meds: {}, prayers: {}, meals: {}, extras: {}, dhikr: { morning: {}, afternoon: {}, evening: {} }, water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 1 });
  const days = {};
  days[dayKeyBack(1)] = blank();
  days[dayKeyBack(2)] = blank();
  return {
    [MAIN_KEY]: JSON.stringify({
      schema: 2,
      profile: Object.assign({ startWeight: 108, targetWeight: 88, updated_at: 1 }, extra || {}),
      days,
      tasks: [],
      sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    }),
  };
}

function qadaRows(app) {
  return Array.from(app.document.querySelectorAll("#qadaBox .qada-row"));
}

test("with nothing made up, each prayer shows its full outstanding count", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seedWithMissedPrayers() });
  app.goTo("prayers");

  const rows = qadaRows(app);
  assert.equal(rows.length, 5, "one row per prayer");
  assert.match(rows[0].textContent, /Fajr/);
  rows.forEach((r) => assert.match(r.querySelector(".qada-owed").textContent, /^2 owed/));
  assert.match(app.document.getElementById("praySummary").textContent, /10 prayer\(s\) still to make up/);
});

test("the per-prayer breakdown lives only in the qada card, not duplicated above it", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seedWithMissedPrayers() });
  app.goTo("prayers");

  // The summary keeps the overall sentence but no longer repeats a chip per prayer.
  const summary = app.document.getElementById("praySummary");
  assert.equal(summary.querySelector(".pill-row"), null);
  assert.equal((summary.textContent.match(/Fajr/g) || []).length, 0);
  // ...because the card below already says it, and lets you change it.
  assert.equal((app.document.getElementById("qadaBox").textContent.match(/Fajr/g) || []).length, 1);
});

test("recording a made-up prayer reduces what's owed without rewriting that day's history", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seedWithMissedPrayers() });
  app.goTo("prayers");

  const fajr = qadaRows(app)[0];
  Array.from(fajr.querySelectorAll("button")).find((b) => b.textContent === "+").click();

  assert.match(qadaRows(app)[0].querySelector(".qada-owed").textContent, /^1 owed/);
  assert.match(app.document.getElementById("praySummary").textContent, /9 prayer\(s\) still to make up/);
  assert.match(app.document.getElementById("praySummary").textContent, /1 made up so far/);

  const saved = app.state();
  assert.equal(saved.profile.qada.fajr, 1, "the count lives on the profile, which syncs");
  assert.equal(saved.days[dayKeyBack(1)].prayers.fajr, undefined, "the day itself is untouched");
});

test("the made-up count is a debt repayment: it cannot exceed what was actually missed", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seedWithMissedPrayers() });
  app.goTo("prayers");

  const plus = () => Array.from(qadaRows(app)[0].querySelectorAll("button")).find((b) => b.textContent === "+");
  plus().click();
  plus().click();
  plus().click(); // one more than the 2 that were ever missed

  assert.equal(app.state().profile.qada.fajr, 2, "clamped at the number missed");
  assert.match(qadaRows(app)[0].querySelector(".qada-owed").textContent, /^0 owed/);
});

test("the minus button and direct entry both work, and never go negative", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seedWithMissedPrayers({ qada: { fajr: 2 } }) });
  app.goTo("prayers");

  const fajr = () => qadaRows(app)[0];
  assert.equal(fajr().querySelector("input[type=number]").value, "2", "a stored count is shown on load");

  Array.from(fajr().querySelectorAll("button")).find((b) => b.textContent === "−").click();
  assert.equal(app.state().profile.qada.fajr, 1);

  const input = fajr().querySelector("input[type=number]");
  input.value = "-5";
  input.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.equal(app.state().profile.qada.fajr, 0);
});

test("clearing the whole backlog reads as nothing outstanding, not as never having missed any", () => {
  const app = loadApp({
    fetchImpl: idle,
    localStorageSeed: seedWithMissedPrayers({ qada: { fajr: 2, dhuhr: 2, asr: 2, maghrib: 2, isha: 2 } }),
  });
  app.goTo("prayers");

  const summary = app.document.getElementById("praySummary").textContent;
  assert.match(summary, /nothing outstanding/i);
  assert.match(summary, /10 made up so far/);
});

/* --- the history is a run of dates, not a set of records --------------------
 * Two devices disagreed about how many prayers were owed because the summary
 * was built from Object.keys(state.days). A record gets created merely by
 * *looking* at a date, so which blank days each device held was accidental -
 * and a blank day counted as five missed prayers. It is a date range now.
 */
function seedWith(days, extra) {
  return JSON.stringify(Object.assign({
    schema: 4,
    profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 1 },
    days,
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
  }, extra || {}));
}
function dayRec(over) {
  return Object.assign({
    meds: {}, prayers: {}, meals: {}, extras: {},
    dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null,
    exercise: false, notes: "", updated_at: 1,
  }, over || {});
}
function ago(n) {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

test("a day with no record at all still counts against the history", () => {
  // Ten days ago is the start; only it and yesterday have records. The eight
  // days between were never opened, and are missed, not absent.
  const days = {};
  days[ago(10)] = dayRec({ prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true } });
  days[ago(1)] = dayRec({ prayers: { fajr: true } });

  const app = loadApp({ localStorageSeed: { [MAIN_KEY]: seedWith(days) }, fetchImpl: idle });
  app.goTo("prayers");

  const note = app.document.querySelector("#praySummary .note").textContent;
  assert.match(note, /across 10 completed day\(s\)/, "ten days from the first record to yesterday");
  // 10 days x 5 = 50 prayers; 5 + 1 were prayed.
  assert.match(note, /44 prayer\(s\) still to make up/);
  assert.match(note, /1 day\(s\) had all 5/);
});

test("the table shows the unlogged days too, and can open the whole history", () => {
  const days = {};
  days[ago(20)] = dayRec({ prayers: { fajr: true } });
  const app = loadApp({ localStorageSeed: { [MAIN_KEY]: seedWith(days) }, fetchImpl: idle });
  app.goTo("prayers");

  const rows = () => app.document.querySelectorAll("#praySummary tbody tr").length;
  assert.equal(rows(), 14, "a recent window by default");

  const more = Array.from(app.document.querySelectorAll("#praySummary button"))
    .find((b) => /show all/i.test(b.textContent));
  assert.ok(more, "with a way to see the rest");
  assert.match(more.textContent, new RegExp("since " + ago(20)));
  more.click();
  assert.equal(rows(), 21, "twenty days plus today - nothing since the start is dropped");
});

test("qada owed follows the same continuous history", () => {
  const days = {};
  days[ago(3)] = dayRec({ prayers: {} });
  const app = loadApp({ localStorageSeed: { [MAIN_KEY]: seedWith(days) }, fetchImpl: idle });
  app.goTo("prayers");

  const owed = Array.from(app.document.querySelectorAll("#qadaBox .qada-owed")).map((n) => n.textContent);
  assert.deepEqual(owed, ["3 owed", "3 owed", "3 owed", "3 owed", "3 owed"],
    "three past days, none prayed, whether or not each has a record");
});
