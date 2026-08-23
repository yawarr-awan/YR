"use strict";
/*
 * Meals and snacks added by hand, and the calorie trend they feed.
 *
 * The three planned meals and the supplements list already carried their own
 * kcal; what was missing was the things that are not on the plan. The chart is
 * asserted on through its summary line, since jsdom has no 2D context.
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
    exercise: false, notes: "", food: [], updated_at: 1,
  }, extra || {});
}
function seed(days) {
  return { [MAIN_KEY]: JSON.stringify({
    schema: 4,
    profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 1 },
    days, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
  }) };
}
function addVia(app, kind, name, kcal) {
  const p = kind === "meal" ? "meal" : "snack";
  app.document.getElementById(p + "NameIn").value = name;
  app.document.getElementById(p + "KcalIn").value = String(kcal);
  app.click(p + "AddBtn");
}
const rows = (app, boxId) => [...app.document.querySelectorAll("#" + boxId + " .food-row")];

/* ---------------- adding ---------------- */

test("an extra meal can be added with its calories, and shows under Today's Meals", () => {
  const app = loadApp({ fetchImpl: idle });
  addVia(app, "meal", "Biryani at Adnan's", 850);

  const r = rows(app, "mealAddedBox");
  assert.equal(r.length, 1);
  assert.match(r[0].textContent, /Biryani at Adnan's/);
  assert.match(r[0].textContent, /850 kcal/);

  const stored = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  const food = stored.days[dayKeyBack(0)].food;
  assert.equal(food.length, 1);
  assert.equal(food[0].kind, "meal");
  assert.equal(food[0].kcal, 850);
  assert.ok(stored.days[dayKeyBack(0)].updated_at > 1, "stamped, so it syncs");
});

test("a snack goes in the supplements card, and the two lists stay apart", () => {
  const app = loadApp({ fetchImpl: idle });
  addVia(app, "meal", "Leftover curry", 500);
  addVia(app, "snack", "Two dates", 60);

  assert.equal(rows(app, "mealAddedBox").length, 1);
  assert.equal(rows(app, "snackAddedBox").length, 1);
  assert.match(rows(app, "snackAddedBox")[0].textContent, /Two dates/);
  assert.match(rows(app, "mealAddedBox")[0].textContent, /Leftover curry/);
});

test("that card is now called Supplements, Drinks & Snacks", () => {
  const app = loadApp({ fetchImpl: idle });
  const head = app.document.querySelector('[data-card="extras"] h3').textContent;
  assert.match(head, /Supplements, Drinks & Snacks/);
});

test("the inputs clear after adding, and a nameless entry is refused", () => {
  const app = loadApp({ fetchImpl: idle });
  addVia(app, "meal", "Toast", 200);
  assert.equal(app.document.getElementById("mealNameIn").value, "");
  assert.equal(app.document.getElementById("mealKcalIn").value, "");

  addVia(app, "meal", "   ", 300);
  assert.equal(rows(app, "mealAddedBox").length, 1, "a blank name adds nothing");
});

test("a missing or silly calorie count is stored as zero rather than as nonsense", () => {
  const app = loadApp({ fetchImpl: idle });
  addVia(app, "meal", "Something I forgot to weigh", "");
  addVia(app, "snack", "Impossible", 999999);

  const days = JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).days[dayKeyBack(0)];
  assert.equal(days.food[0].kcal, 0);
  assert.equal(days.food[1].kcal, 0, "beyond any real day's intake, so not trusted");
});

test("Enter adds it too, without reaching for the button", () => {
  const app = loadApp({ fetchImpl: idle });
  const name = app.document.getElementById("snackNameIn");
  name.value = "Apple";
  app.document.getElementById("snackKcalIn").value = "80";
  const ev = new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true });
  name.dispatchEvent(ev);
  assert.equal(rows(app, "snackAddedBox").length, 1);
});

test("an entry can be removed again", () => {
  const app = loadApp({ fetchImpl: idle });
  addVia(app, "meal", "Ordered in", 900);
  rows(app, "mealAddedBox")[0].querySelector("button.icon-btn.danger").click();
  assert.equal(rows(app, "mealAddedBox").length, 0);
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).days[dayKeyBack(0)].food, []);
});

test("entries belong to their own day", () => {
  const app = loadApp({ fetchImpl: idle });
  addVia(app, "meal", "Today's extra", 400);
  app.click("prevDay");
  assert.equal(rows(app, "mealAddedBox").length, 0, "yesterday has its own list");
  app.click("jumpToday");
  assert.equal(rows(app, "mealAddedBox").length, 1);
});

/* ---------------- what a day came to ---------------- */

test("the day's total counts what was ticked, not what the plan offered", () => {
  // The plan's calories are what is on offer; totalling those would report an
  // identical number every day and say nothing about the day you had.
  const app = loadApp({ fetchImpl: idle });
  const kcalLine = () => app.document.getElementById("mealKcal").textContent;
  assert.match(kcalLine(), /\b0 kcal logged/, "nothing ticked, nothing counted");

  addVia(app, "meal", "Something", 300);
  assert.match(kcalLine(), /\b300 kcal logged/);

  // Ticking a planned meal adds that recipe's calories on top.
  const box = app.document.getElementById("mealsBox");
  box.querySelector("input[type=checkbox]").click();
  const shown = Number(kcalLine().match(/(\d+) kcal/)[1]);
  assert.ok(shown > 300, "the ticked planned meal counts too, was " + shown);
});

test("adding food never makes the day's completion ring go backwards", () => {
  // These are things you happened to eat, not a checklist you set out to
  // finish - counting them in the total would make the ring fall as you
  // logged more of the day, which is the wrong way round.
  const app = loadApp({ fetchImpl: idle });
  const ring = () => app.document.getElementById("dayRingTxt").textContent;
  const before = ring();
  addVia(app, "meal", "Crisps", 300);
  addVia(app, "snack", "More crisps", 300);
  assert.equal(ring(), before);
});

/* ---------------- the chart ---------------- */

const note = (app) => app.document.getElementById("calorieNote").textContent;

test("the calorie chart plots the days with something logged", () => {
  const days = {};
  days[dayKeyBack(2)] = blank({ food: [{ id: "a", kind: "meal", name: "x", kcal: 2000 }] });
  days[dayKeyBack(1)] = blank({ food: [{ id: "b", kind: "snack", name: "y", kcal: 1000 }] });
  days[dayKeyBack(0)] = blank({ food: [{ id: "c", kind: "meal", name: "z", kcal: 1500 }] });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("progress");

  assert.match(note(app), /^3 day\(s\) logged/);
  assert.match(note(app), /average 1500 kcal/);
  assert.match(note(app), /lowest 1000 · highest 2000/);
});

test("a day with nothing logged is left out, not drawn as zero", () => {
  // Missing data, not a day of fasting - the same call the sleep chart makes.
  const days = {};
  days[dayKeyBack(2)] = blank({ food: [{ id: "a", kind: "meal", name: "x", kcal: 2000 }] });
  days[dayKeyBack(1)] = blank();
  days[dayKeyBack(0)] = blank({ food: [{ id: "c", kind: "meal", name: "z", kcal: 1000 }] });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: seed(days) });
  app.goTo("progress");

  assert.match(note(app), /^2 day\(s\) logged/);
  assert.match(note(app), /average 1500 kcal/, "the blank day is absent, not averaged in as a zero");
});

test("with barely anything logged the chart says so instead of drawing a line", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("progress");
  assert.match(note(app), /at least two days/i);
});

test("the chart is a movable card on the Progress tab like the others", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("progress");
  assert.ok(app.document.getElementById("calorieChart"));
  assert.ok(app.document.querySelector('#view-progress > .grid > .card[data-card="calorietrend"]'));
});
