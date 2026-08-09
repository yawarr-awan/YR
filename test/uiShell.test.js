"use strict";
/*
 * The app shell: bottom icon nav, swiping between tabs, and collapsible
 * cards (including that their folded/unfolded state is remembered per
 * device and kept out of the synced state object).
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY } = require("./lib.js");
after(closeAllApps);

const COLLAPSE_KEY = "yawarCollapsed";
const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

test("nav sits at the bottom of the page as icons, and the Guide tab is gone", () => {
  const app = loadApp({ fetchImpl: idle });
  const tabs = app.document.getElementById("tabs");

  assert.equal(tabs.parentElement, app.document.body, "the bar is page-level, not inside the scrolling header");
  assert.equal(app.document.querySelector("header .tabs"), null, "and no longer in the header");

  const labels = Array.from(tabs.querySelectorAll("button")).map((b) => b.getAttribute("data-nav"));
  assert.deepEqual(labels, ["today", "calendar", "plan", "recipes", "exercises", "progress"]);
  assert.equal(app.document.getElementById("view-guide"), null, "the Guide view is removed too");
  tabs.querySelectorAll("button").forEach((b) => {
    assert.ok(b.querySelector("i"), "each tab renders an icon above its label");
  });
});

test("tapping a tab's icon switches tab, not just tapping the button itself", () => {
  // On a phone the icon is the obvious thing to hit, and it's a child element -
  // the delegated handler has to resolve it back to the button that owns it.
  const app = loadApp({ fetchImpl: idle });
  const icon = app.document.querySelector('#tabs [data-nav="progress"] i');
  icon.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));

  assert.equal(app.document.querySelector(".view.active").id, "view-progress");
  assert.ok(app.document.querySelector('#tabs [data-nav="progress"]').classList.contains("active"));
});

test("swiping left/right moves through the tabs in bottom-bar order, stopping at the ends", () => {
  const app = loadApp({ fetchImpl: idle });
  const activeView = () => app.document.querySelector(".view.active").id;
  assert.equal(activeView(), "view-today");

  app.swipe(".wrap", -120, 0);
  assert.equal(activeView(), "view-calendar");

  app.swipe(".wrap", 120, 0);
  assert.equal(activeView(), "view-today");

  // Already on the first tab: swiping further right must not wrap around.
  app.swipe(".wrap", 120, 0);
  assert.equal(activeView(), "view-today");

  // A mostly-vertical drag is a scroll, not a tab change.
  app.swipe(".wrap", 30, 200);
  assert.equal(activeView(), "view-today");
});

test("a swipe meant for the calendar grid changes the day, never the tab", async () => {
  const app = loadApp({
    fetchImpl: async (url) => {
      if (String(url).includes("/api/calendar/events")) return { ok: true, status: 200, json: async () => ({ connected: true, status: "ok", day: "x", events: [] }) };
      return idle();
    },
  });
  app.goTo("calendar");
  await app.flush();

  app.swipe("calGrid", -120, 0);
  await app.wait(500);
  assert.equal(app.document.querySelector(".view.active").id, "view-calendar", "still on the calendar tab");
});

test("tapping a card heading folds it away and the choice survives a reload", () => {
  const app = loadApp({ fetchImpl: idle });
  const card = app.document.querySelector('.card.collapsible[data-collapse="meds"]');
  assert.equal(card.classList.contains("collapsed"), false, "medicines start open");

  card.querySelector("h3").click();
  assert.ok(card.classList.contains("collapsed"));
  assert.equal(JSON.parse(app.window.localStorage.getItem(COLLAPSE_KEY)).meds, true);

  // A second app instance seeded with the same storage should honour it.
  const reopened = loadApp({
    fetchImpl: idle,
    localStorageSeed: {
      [COLLAPSE_KEY]: app.window.localStorage.getItem(COLLAPSE_KEY),
      [MAIN_KEY]: app.window.localStorage.getItem(MAIN_KEY),
    },
  });
  assert.ok(reopened.document.querySelector('.card.collapsible[data-collapse="meds"]').classList.contains("collapsed"));
});

test("collapsed state is a display preference only - it never enters the synced state", () => {
  const app = loadApp({ fetchImpl: idle });
  app.document.querySelector('.card.collapsible[data-collapse="meds"]').querySelector("h3").click();

  // Folding a card touches the preferences key and nothing else - on a fresh
  // install it doesn't even cause the health record to be written.
  assert.ok(app.window.localStorage.getItem(COLLAPSE_KEY), "the preference itself is stored");
  assert.equal(app.rawMain(), null, "no write to the synced store at all");

  // And with real data already present, folding leaves that record byte-identical.
  const withData = loadApp({ fetchImpl: idle });
  withData.setInput("weightIn", "101.5");
  const before = withData.rawMain();
  withData.document.querySelector('.card.collapsible[data-collapse="meds"]').querySelector("h3").click();
  assert.equal(withData.rawMain(), before);
  assert.doesNotMatch(before || "", /collapsed/i);
});

test("a folded card still reports its progress in the heading", () => {
  const app = loadApp({ fetchImpl: idle });
  assert.equal(app.document.getElementById("medsCount").textContent, "0/3");

  const firstMed = app.document.getElementById("medsBox").querySelector("input[type=checkbox]");
  firstMed.checked = true;
  firstMed.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.equal(app.document.getElementById("medsCount").textContent, "1/3");
});

test("dhikr is three collapsible sub-cards, each with its own count, collapsed by default", () => {
  const app = loadApp({ fetchImpl: idle });
  const cards = app.document.querySelectorAll("#dhikrBox .subcard");
  assert.equal(cards.length, 3);
  assert.deepEqual(
    Array.from(cards).map((c) => c.querySelector("button").firstChild.textContent),
    ["Morning", "Afternoon", "Evening"]
  );
  cards.forEach((c) => assert.ok(c.classList.contains("collapsed"), "dhikr starts folded so Today stays short"));
  assert.equal(cards[0].querySelector(".count").textContent, "0/7");

  cards[0].querySelector("button").click();
  assert.equal(app.document.querySelectorAll("#dhikrBox .subcard")[0].classList.contains("collapsed"), false);

  const cb = app.document.querySelectorAll("#dhikrBox .subcard")[0].querySelector("input[type=checkbox]");
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  const morning = app.document.querySelectorAll("#dhikrBox .subcard")[0];
  assert.equal(morning.querySelector(".count").textContent, "1/7");
  assert.equal(morning.classList.contains("collapsed"), false, "ticking an item must not re-fold the card");
  assert.equal(app.document.getElementById("dhikrCount").textContent, "1/21");
});
