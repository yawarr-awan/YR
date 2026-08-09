"use strict";
/*
 * The daily-completion trend on the Progress tab, which replaced the
 * per-day history table. The canvas itself is stubbed in this environment
 * (jsdom has no 2D context), so these assert on the data the chart is built
 * from and the summary line underneath it - not on pixels.
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

const MEDS = ["pre", "after", "dinner"];
const PRAYERS = ["fajr", "dhuhr", "asr", "maghrib", "isha"];
const MEALS = ["breakfast", "lunch", "dinner"];
const EXTRAS = ["collagen", "whey", "creatine", "milk", "milktea"];

/** A day with `n` of the 18 tracked items ticked, in a fixed order. */
function dayWith(n) {
  const d = {
    meds: {}, prayers: {}, meals: {}, extras: {},
    dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 1,
  };
  let left = n;
  const take = (bag, keys) => keys.forEach((k) => { if (left > 0) { bag[k] = true; left--; } });
  take(d.meds, MEDS);
  take(d.prayers, PRAYERS);
  take(d.meals, MEALS);
  take(d.extras, EXTRAS);
  if (left > 0) { d.exercise = true; left--; }
  if (left > 0) { d.water = 8; left--; }
  return d;
}

function seed(daysBackToItems) {
  const days = {};
  Object.keys(daysBackToItems).forEach((back) => {
    days[dayKeyBack(Number(back))] = dayWith(daysBackToItems[back]);
  });
  return {
    [MAIN_KEY]: JSON.stringify({
      schema: 2,
      profile: { startWeight: 108, targetWeight: 88, updated_at: 1 },
      days, tasks: [],
      sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    }),
  };
}

const note = (app) => app.document.getElementById("completionNote").textContent;

test("the per-day history table is gone, replaced by a completion chart above the targets", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("progress");

  assert.equal(app.document.getElementById("historyBox"), null, "no more day-by-day table");
  const canvas = app.document.getElementById("completionChart");
  assert.ok(canvas, "there is a completion chart");

  // It sits right after the weight trend, before the targets card.
  const cards = Array.from(app.document.querySelectorAll("#view-progress .card"));
  const idxOf = (id) => cards.findIndex((c) => c.querySelector("#" + id));
  assert.ok(idxOf("weightChart") >= 0);
  assert.equal(idxOf("completionChart"), idxOf("weightChart") + 1, "directly after the weight chart");
  assert.ok(idxOf("startWeightIn") > idxOf("completionChart"), "and before the targets");
});

// Opening the app creates today's (empty) record, so every seed below includes
// day 0 explicitly and the counts are exact.
test("with barely any history it says so instead of drawing a meaningless line", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed({}) });
  app.goTo("progress");
  assert.match(note(app), /couple of days/i);
});

test("a full day counts as 100% and the summary reports the average, best and full days", () => {
  // 18/18, 9/18 and 0/18 -> 100%, 50%, 0% -> average 50%, best 100%, 1 full day.
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed({ 2: 18, 1: 9, 0: 0 }) });
  app.goTo("progress");

  assert.match(note(app), /^3 day\(s\) logged/);
  assert.match(note(app), /average 50%/);
  assert.match(note(app), /best 100%/);
  assert.match(note(app), /1 full day\(s\)/);
});

test("the trend grows with the days logged, and mentions the 7-day average once there is one", () => {
  const short = loadApp({ fetchImpl: idle, localStorageSeed: seed({ 2: 18, 1: 18, 0: 18 }) });
  short.goTo("progress");
  assert.match(note(short), /^3 day\(s\) logged/);
  assert.doesNotMatch(note(short), /7-day average/, "too little history for a rolling average to mean anything");

  const wide = {};
  for (let i = 0; i <= 9; i++) wide[i] = 18;
  const long = loadApp({ fetchImpl: idle, localStorageSeed: seed(wide) });
  long.goTo("progress");
  assert.match(note(long), /^10 day\(s\) logged/, "every logged day is on the chart, not just a recent window");
  assert.match(note(long), /7-day average/);
});

test("the ring and the chart agree on what a day was worth", () => {
  // A day with 9 of 18 items is 50% on both.
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed({ 0: 9, 1: 9 }) });
  assert.equal(app.document.getElementById("dayRingTxt").textContent, "50%");
  app.goTo("progress");
  assert.match(note(app), /average 50%/);
});
