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
