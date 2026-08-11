"use strict";
/*
 * Rearranging the cards: which tab each one sits on, in what order, and
 * which are put away. Real index.html, real DOM.
 *
 * The arrangement lives in its own localStorage key rather than the synced
 * profile, for the same reason the fold state does - where a card sits is a
 * display preference, and nothing about how the app is laid out belongs in
 * a health record. These tests hold that line.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

function cardsOn(app, view) {
  return [...app.document.querySelectorAll("#view-" + view + " > .grid > .card[data-card]")]
    .map((c) => c.getAttribute("data-card"));
}
function edit(app) {
  app.goTo("settings");
  app.click("layoutEditBtn");
}
function toolbar(app, key) {
  return app.document.querySelector('.card[data-card="' + key + '"] .card-tools');
}

test("every rearrangeable tab is one container of keyed cards", () => {
  const app = loadApp({ fetchImpl: idle });
  // A card can only be moved if its tab is a single list of cards. The
  // calendar is a grid of hours and Misc is three sub-panels, so neither is
  // offered - and neither should sprout a container by accident.
  ["today", "prayers", "progress", "settings"].forEach((v) => {
    assert.ok(cardsOn(app, v).length > 0, `${v} should have keyed cards`);
    assert.equal(app.document.querySelectorAll("#view-" + v + " > .card").length, 0,
      `${v} has a card outside its grid, which could never be reordered`);
  });
  assert.equal(app.document.querySelector("#view-calendar > .grid"), null);
});

test("the toolbars appear only while editing", () => {
  const app = loadApp({ fetchImpl: idle });
  assert.equal(app.document.querySelectorAll(".card-tools").length, 0);

  edit(app);
  assert.ok(app.document.body.classList.contains("editing"));
  assert.ok(app.document.querySelectorAll(".card-tools").length > 5);
  assert.equal(app.document.getElementById("layoutEditBtn").textContent, "Done");

  app.click("layoutEditBtn");
  assert.equal(app.document.querySelectorAll(".card-tools").length, 0);
  assert.equal(app.document.body.classList.contains("editing"), false);
});

test("a card can be nudged up the tab, and stays there next time", () => {
  const app = loadApp({ fetchImpl: idle });
  const before = cardsOn(app, "today");
  edit(app);

  // Move the third card up one place.
  const key = before[2];
  [...toolbar(app, key).querySelectorAll("button")].find((b) => b.textContent === "↑").click();

  const after = cardsOn(app, "today");
  assert.equal(after[1], key);
  assert.deepEqual(after.slice().sort(), before.slice().sort(), "nothing gained or lost, only reordered");

  const reopened = loadApp({
    fetchImpl: idle,
    localStorageSeed: { yawarLayout: app.window.localStorage.getItem("yawarLayout") },
  });
  assert.deepEqual(cardsOn(reopened, "today"), after);
});

test("the first card can't be moved up and the last can't be moved down", () => {
  const app = loadApp({ fetchImpl: idle });
  const keys = cardsOn(app, "today");
  edit(app);
  const btn = (key, glyph) => [...toolbar(app, key).querySelectorAll("button")].find((b) => b.textContent === glyph);
  assert.equal(btn(keys[0], "↑").disabled, true);
  assert.equal(btn(keys[0], "↓").disabled, false);
  assert.equal(btn(keys[keys.length - 1], "↓").disabled, true);
});

test("a card can be sent to another tab", () => {
  const app = loadApp({ fetchImpl: idle });
  edit(app);

  const sel = toolbar(app, "weight").querySelector("select");
  assert.equal(sel.value, "today");
  sel.value = "progress";
  sel.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  assert.equal(cardsOn(app, "today").includes("weight"), false);
  assert.equal(cardsOn(app, "progress").includes("weight"), true);

  const reopened = loadApp({
    fetchImpl: idle,
    localStorageSeed: { yawarLayout: app.window.localStorage.getItem("yawarLayout") },
  });
  assert.equal(cardsOn(reopened, "progress").includes("weight"), true);
  assert.equal(cardsOn(reopened, "today").includes("weight"), false);
});

test("a card can be put away, and added back to any tab", () => {
  const app = loadApp({ fetchImpl: idle });
  edit(app);

  [...toolbar(app, "pain").querySelectorAll("button")].find((b) => b.textContent === "Remove").click();
  assert.equal(app.document.querySelector('.card[data-card="pain"]').hidden, true);
  assert.equal(toolbar(app, "pain"), null, "a card that isn't on a tab has nothing to reorder");

  // It turns up in the put-away list, with somewhere to send it back to.
  const row = app.document.querySelector('#hiddenCards [data-card-hidden="pain"]');
  assert.ok(row);
  assert.match(row.querySelector(".hc-name").textContent, /Joint Pain/i);

  row.querySelector("select").value = "prayers";
  row.querySelector("button").click();
  assert.equal(app.document.querySelector('.card[data-card="pain"]').hidden, false);
  assert.equal(cardsOn(app, "prayers").includes("pain"), true);
  assert.equal(app.document.querySelector('#hiddenCards [data-card-hidden="pain"]'), null);
});

test("a put-away card stays away across a reload", () => {
  const app = loadApp({ fetchImpl: idle });
  edit(app);
  [...toolbar(app, "pain").querySelectorAll("button")].find((b) => b.textContent === "Remove").click();

  const reopened = loadApp({
    fetchImpl: idle,
    localStorageSeed: { yawarLayout: app.window.localStorage.getItem("yawarLayout") },
  });
  assert.equal(reopened.document.querySelector('.card[data-card="pain"]').hidden, true);
  assert.ok(reopened.document.querySelector('#hiddenCards [data-card-hidden="pain"]'));
});

test("the arrangement is per device - it never enters the synced record", () => {
  const app = loadApp({ fetchImpl: idle });
  edit(app);
  const sel = toolbar(app, "weight").querySelector("select");
  sel.value = "settings";
  sel.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  [...toolbar(app, "pain").querySelectorAll("button")].find((b) => b.textContent === "Remove").click();

  assert.ok(app.window.localStorage.getItem("yawarLayout"), "it is stored on its own");
  const synced = JSON.stringify(app.state() || {});
  assert.equal(/yawarLayout|"hidden"|weighttrend/.test(synced), false,
    "where a card sits must not ride the sync protocol");
});

test("a card the stored layout has never heard of keeps its place rather than vanishing", () => {
  // What a layout saved by an older version looks like once a card is added.
  const partial = JSON.stringify({ order: { today: ["water", "brief"] }, hidden: [] });
  const app = loadApp({ fetchImpl: idle, localStorageSeed: { yawarLayout: partial } });

  const today = cardsOn(app, "today");
  assert.equal(today[today.length - 2], "water", "the two it names are placed...");
  assert.equal(today[today.length - 1], "brief");
  ["tasks", "extras", "meals", "meds", "move", "weight", "pain"].forEach((k) => {
    assert.ok(today.includes(k), `${k} must survive a layout that predates it`);
  });
});

test("Reset puts everything back", () => {
  const app = loadApp({ fetchImpl: idle });
  edit(app);
  [...toolbar(app, "pain").querySelectorAll("button")].find((b) => b.textContent === "Remove").click();
  const sel = toolbar(app, "weight").querySelector("select");
  sel.value = "progress";
  sel.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  app.click("layoutResetBtn");
  assert.equal(app.document.querySelector('.card[data-card="pain"]').hidden, false);
  assert.equal(JSON.parse(app.window.localStorage.getItem("yawarLayout")).hidden.length, 0);
  assert.deepEqual(JSON.parse(app.window.localStorage.getItem("yawarLayout")).order, {});
});

test("a card keeps its folded state when it moves tab", () => {
  const app = loadApp({ fetchImpl: idle });
  const card = () => app.document.querySelector('.card[data-card="weight"]');
  card().querySelector("h3").click();
  assert.ok(card().classList.contains("collapsed"));

  edit(app);
  const sel = toolbar(app, "weight").querySelector("select");
  sel.value = "prayers";
  sel.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  const reopened = loadApp({
    fetchImpl: idle,
    localStorageSeed: {
      yawarLayout: app.window.localStorage.getItem("yawarLayout"),
      yawarCollapsed: app.window.localStorage.getItem("yawarCollapsed"),
    },
  });
  // Both are keyed on the card, not on where it sits.
  assert.equal(cardsOn(reopened, "prayers").includes("weight"), true);
  assert.ok(reopened.document.querySelector('.card[data-card="weight"]').classList.contains("collapsed"));
});
