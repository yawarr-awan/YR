"use strict";
/*
 * The app shell: bottom icon nav, swiping between tabs, and collapsible
 * cards (including that their folded/unfolded state is remembered per
 * device and kept out of the synced state object).
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, SCHEMA } = require("./lib.js");
after(closeAllApps);

const COLLAPSE_KEY = "yawarCollapsed";
const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

test("nav sits at the bottom of the page as icons, and the Guide tab is gone", () => {
  const app = loadApp({ fetchImpl: idle });
  const tabs = app.document.getElementById("tabs");

  assert.equal(tabs.parentElement, app.document.body, "the bar is page-level, not inside the scrolling header");
  assert.equal(app.document.querySelector("header .tabs"), null, "and no longer in the header");

  const labels = Array.from(tabs.querySelectorAll("button")).map((b) => b.getAttribute("data-nav"));
  assert.deepEqual(labels, ["tasks", "workflow", "today", "prayers", "calendar", "journal", "others", "progress"]);
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
  assert.equal(activeView(), "view-prayers");

  app.swipe(".wrap", 120, 0);
  assert.equal(activeView(), "view-today");

  // Tasks and Workflow both sit before Today now.
  app.swipe(".wrap", 120, 0);
  assert.equal(activeView(), "view-workflow");
  app.swipe(".wrap", 120, 0);
  assert.equal(activeView(), "view-tasks");

  // Already on the first tab: swiping further right must not wrap around.
  app.swipe(".wrap", 120, 0);
  assert.equal(activeView(), "view-tasks");

  // A mostly-vertical drag is a scroll, not a tab change - so we stay put.
  app.swipe(".wrap", 30, 200);
  assert.equal(activeView(), "view-tasks");
});

test("meals, recipes and movement share one Others tab with its own sub-tabs", () => {
  const app = loadApp({ fetchImpl: idle });
  // They are no longer top-level views.
  ["view-plan", "view-recipes", "view-exercises"].forEach((id) => assert.equal(app.document.getElementById(id), null));

  app.goTo("others");
  assert.equal(app.document.querySelector(".view.active").id, "view-others");

  const subs = Array.from(app.document.querySelectorAll("#subTabs button"));
  assert.deepEqual(subs.map((b) => b.getAttribute("data-sub")), ["plan", "recipes", "exercises", "duas"]);
  assert.equal(app.document.querySelector(".subview.active").id, "sub-plan");
  assert.ok(app.document.getElementById("planBox").textContent.length, "the meal plan still renders");

  subs[2].click();
  assert.equal(app.document.querySelector(".subview.active").id, "sub-exercises");
  assert.ok(subs[2].classList.contains("active"));
  assert.ok(app.document.getElementById("exercisesBox").textContent.length);
});

test("inside Others a swipe steps through the sub-tabs before leaving the tab", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("others");
  const activeSub = () => app.document.querySelector(".subview.active").id;
  const activeView = () => app.document.querySelector(".view.active").id;

  app.swipe(".wrap", -120, 0);
  assert.equal(activeSub(), "sub-recipes");
  app.swipe(".wrap", -120, 0);
  assert.equal(activeSub(), "sub-exercises");
  app.swipe(".wrap", -120, 0);
  assert.equal(activeSub(), "sub-duas");
  assert.equal(activeView(), "view-others", "still inside Others");

  // Nowhere further to go inside the tab, so now it moves on.
  app.swipe(".wrap", -120, 0);
  assert.equal(activeView(), "view-progress");
});

test("prayer tracking and settings each have their own tab", () => {
  const app = loadApp({ fetchImpl: idle });

  app.goTo("prayers");
  assert.equal(app.document.querySelector(".view.active").id, "view-prayers");
  ["prayBox", "dhikrBox", "praySummary", "qadaBox"].forEach((id) => {
    assert.ok(app.document.querySelector("#view-prayers #" + id), id + " belongs on the Prayers tab");
  });
  assert.equal(app.document.querySelector("#view-today #prayBox"), null, "and no longer on Today");

  app.goTo("settings");
  ["syncEnabled", "installCard", "notifyCard", "exportBtn", "medsEditBox", "briefPromptIn"].forEach((id) => {
    assert.ok(app.document.querySelector("#view-settings #" + id), id + " belongs in Settings");
  });
  assert.equal(app.document.querySelector("#view-progress #syncEnabled"), null, "moved out of Progress");
});

test("a tab remembered from when Meals was top-level lands on the right sub-tab", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: { yawarLastTab: "recipes" } });
  assert.equal(app.document.querySelector(".view.active").id, "view-others");
  assert.equal(app.document.querySelector(".subview.active").id, "sub-recipes");
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

test("the tab you were on is remembered, so a refresh doesn't dump you back on Today", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("progress");
  assert.equal(app.window.localStorage.getItem("yawarLastTab"), "progress");

  const reopened = loadApp({
    fetchImpl: idle,
    localStorageSeed: { yawarLastTab: "progress" },
  });
  assert.equal(reopened.document.querySelector(".view.active").id, "view-progress");
  assert.ok(reopened.document.querySelector('#tabs [data-nav="progress"]').classList.contains("active"));
});

test("a stale or unknown remembered tab falls back to Today rather than showing nothing", () => {
  const onTodayByDefault = loadApp({ fetchImpl: idle });
  assert.equal(onTodayByDefault.document.querySelector(".view.active").id, "view-today");

  // "guide" was a real tab once; a device that still has it stored must not break.
  const stale = loadApp({ fetchImpl: idle, localStorageSeed: { yawarLastTab: "guide" } });
  assert.equal(stale.document.querySelector(".view.active").id, "view-today");
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

test("the theme toggle lives in Settings, not the header", () => {
  const app = loadApp({});
  const btn = app.document.getElementById("themeToggle");
  assert.ok(btn, "the toggle still exists");
  assert.equal(btn.closest("header.top"), null, "but not in the header any more");
  assert.ok(btn.closest("#view-settings"), "it belongs in Settings");
  assert.match(btn.textContent, /switch to/i, "and it says what it does, rather than being a bare glyph");
});

test("the header carries a notification bell that opens a panel", () => {
  const app = loadApp({});
  const bell = app.document.getElementById("notifyBell");
  assert.ok(bell, "expected a bell in the header");
  assert.ok(bell.closest("header.top"));
  assert.equal(app.document.getElementById("notifPanel").hidden, true, "closed until asked for");

  app.click("notifyBell");
  assert.equal(app.document.getElementById("notifPanel").hidden, false);
  assert.equal(bell.getAttribute("aria-expanded"), "true");
});

test("clicking away closes the notification panel", () => {
  const app = loadApp({});
  app.click("notifyBell");
  assert.equal(app.document.getElementById("notifPanel").hidden, false);

  app.document.body.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true }));
  assert.equal(app.document.getElementById("notifPanel").hidden, true);
});

test("switching the theme still works from its new home", () => {
  const app = loadApp({});
  const before = app.document.documentElement.getAttribute("data-theme");
  app.click("themeToggle");
  const after = app.document.documentElement.getAttribute("data-theme");
  assert.notEqual(after, before);
  assert.ok(after === "dark" || after === "light");
});

test("the header is the logo, the prayer countdown, the completion square and the bell", () => {
  const app = loadApp({});
  const header = app.document.querySelector("header.top");
  assert.ok(header.querySelector(".brand-badge"), "the logo stays");
  assert.ok(header.querySelector("#headerChip"), "the prayer countdown");
  assert.ok(header.querySelector("#dayRing"), "the completion square");
  assert.ok(header.querySelector("#notifyBell"), "and the bell");

  assert.equal(header.querySelector("#savedTag"), null,
    "the saved time is gone - Settings -> Sync already says when it last saved");
  assert.equal(header.querySelector(".brand-title"), null, "the wordmark is gone");
  assert.equal(header.querySelector(".brand-sub"), null, "so is the strapline");
  assert.equal(/Saved \d/.test(header.textContent), false, "and no leftover timestamp");
});

test("the completion indicator sits beside the bell, and is a rounded square like it", () => {
  const app = loadApp({});
  const kids = Array.from(app.document.querySelector(".top-inner").children);
  assert.equal(kids[kids.length - 1].id, "headerMenuBtn", "the ⋮ menu ends the row");
  assert.equal(kids[kids.length - 2].id, "notifyBell");
  assert.equal(kids[kids.length - 3].id, "dayRing", "right next to the bell");

  const styles = app.document.querySelector("style").textContent;
  const ring = styles.match(/\.ring\{[^}]*\}/)[0];
  assert.doesNotMatch(ring, /border-radius:50%/, "not a circle any more");
  assert.match(ring, /border-radius:12px/, "the same rounded square as the bell");
  assert.match(ring, /conic-gradient/, "and it still carries the percentage");
});

test("the header is the same surface as the page, in either theme", () => {
  const app = loadApp({});
  const styles = app.document.querySelector("style").textContent;
  assert.match(styles, /header\.top\{[^}]*background:var\(--bg\)/, "the header must not be its own colour");
  assert.equal(/--hdr-bg/.test(styles), false, "no separate header palette any more");
});

test("the Android status-bar colour follows the theme rather than sitting at one value", () => {
  const app = loadApp({});
  const meta = app.document.querySelector('meta[name="theme-color"]');
  const before = meta.getAttribute("content");
  assert.ok(before, "a theme-color must be declared - Android reads the status bar from it");

  app.goTo("settings");
  app.click("themeToggle");
  const after = meta.getAttribute("content");
  assert.notEqual(after, before, "switching theme must repaint the status bar too");

  const dark = app.document.documentElement.getAttribute("data-theme") === "dark";
  assert.equal(after, dark ? "#0f1420" : "#f4f6fb");
});

test("the notes-for-the-day card is gone from Today, and past notes are left untouched", () => {
  const seed = {
    schema: 3,
    profile: { startWeight: "", targetWeight: "", updated_at: 1, tasks: [] },
    days: {},
  };
  const today = new Date();
  const key = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  seed.days[key] = { meds: {}, prayers: {}, meals: {}, extras: {}, dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "felt okay", updated_at: 1 };

  const app = loadApp({ localStorageSeed: { yawarWellness_v1: JSON.stringify(seed) } });
  assert.equal(app.document.getElementById("notesIn"), null, "the card is gone");
  assert.equal(app.document.querySelector('[data-collapse="notes"]'), null);
  // Removing a card must not quietly delete what was written in it.
  assert.equal(app.state().days[key].notes, "felt okay", "the stored note survives");
});

test("Today's cards run in the order the day does, with medicines after the meals", () => {
  const app = loadApp({});
  const order = Array.from(app.document.querySelectorAll("#view-today .card.collapsible"))
    .map((c) => c.getAttribute("data-collapse"));
  // The medicines are taken around the food - pre-breakfast, after-breakfast,
  // after-dinner - so the card belongs below it, not above.
  assert.ok(order.indexOf("meds") > order.indexOf("meals"),
    `medicines should follow the meals, got: ${order.join(", ")}`);
  assert.ok(order.indexOf("extras") < order.indexOf("meals"), "supplements still lead");
});

test("a wide window fills its columns instead of leaving holes", () => {
  const app = loadApp({});
  const styles = app.document.querySelector("style").textContent;

  // Spanning every column forced Today's Meals onto a row of its own.
  const meals = app.document.querySelector('.card[data-collapse="meals"]');
  assert.equal(/grid-column/.test(meals.getAttribute("style") || ""), false);

  // Cards flow down columns rather than across grid rows: a grid row is as
  // tall as its tallest card, so a short one left a hole nothing could fill.
  ["today", "prayers", "progress", "settings"].forEach((v) => {
    const box = app.document.querySelector("#view-" + v + " > .grid");
    assert.ok(box.classList.contains("cards"), `${v} should use the column flow`);
  });
  assert.match(styles, /\.cards\{display:block;columns:1/);
  assert.match(styles, /\.cards>\.card\{break-inside:avoid/, "a card must not be split across columns");
  assert.match(styles, /@media\(min-width:1100px\)\{\.cards\{columns:3\}\}/);
  assert.match(styles, /@media\(min-width:1560px\)\{\.cards\{columns:4\}\}/);

  // The inner grid inside "Your targets" is a plain two-up and must not have
  // been turned into a column layout with it.
  const inner = app.document.querySelector('.card[data-card="targets"] .grid');
  assert.ok(inner);
  assert.equal(inner.classList.contains("cards"), false);

  // And the page uses the width a monitor has rather than stopping at 1024.
  assert.match(styles, /\.wrap\{max-width:1480px/);
  assert.match(styles, /\.top-inner\{max-width:1480px/, "the header has to line up with it");
});

test("the whole interface can be scaled from Settings", () => {
  const app = loadApp({});
  app.goTo("settings");

  const seg = app.document.getElementById("scaleSeg");
  const opts = [...seg.querySelectorAll("button")].map((b) => b.getAttribute("data-scale"));
  assert.deepEqual(opts, ["13", "15", "17", "19", "21"]);
  assert.equal(seg.querySelector("button.on").getAttribute("data-scale"), "15", "default to begin with");

  seg.querySelector('button[data-scale="19"]').click();
  // Everything in the app is sized in rem off the root, so this one number
  // scales the lot.
  assert.equal(app.document.documentElement.style.fontSize, "19px");
  assert.equal(seg.querySelector("button.on").getAttribute("data-scale"), "19");
  assert.equal(app.window.localStorage.getItem("yawarScale"), "19");

  const reopened = loadApp({ localStorageSeed: { yawarScale: "19" } });
  assert.equal(reopened.document.documentElement.style.fontSize, "19px");
  // Per device, like the other display preferences.
  assert.equal(/yawarScale/.test(JSON.stringify(reopened.state() || {})), false);
});

test("a nonsense stored scale falls back to the default rather than breaking the page", () => {
  const app = loadApp({ localStorageSeed: { yawarScale: "999" } });
  assert.equal(app.document.documentElement.style.fontSize, "15px");
});

test("the app never touches screen orientation - the device decides", () => {
  // 1.24.1 called screen.orientation.unlock() at startup and declared
  // orientation:"any" in the manifest. Both overshoot: a WebAPK turns "any"
  // into a sensor mode that follows the accelerometer even when the phone's
  // own rotation lock is on, and asking to be unlocked is still asking for
  // something. Saying nothing is what respects the system setting.
  let touched = false;
  const app = loadApp({
    beforeRun: (window) => {
      window.screen.orientation = {
        type: "portrait-primary",
        unlock: () => { touched = true; },
        lock: () => { touched = true; return Promise.resolve(); },
      };
    },
  });
  assert.equal(touched, false, "neither locked nor unlocked");
  assert.ok(app.document.getElementById("dayRing"), "and the app still booted");
});

test("a browser with no screen.orientation at all still starts", () => {
  // Safari has no screen.orientation.unlock; nothing here may assume it.
  const app = loadApp({ beforeRun: (window) => { delete window.screen.orientation; } });
  assert.ok(app.document.getElementById("dayRing"));
});

/* ---------------- the header ⋮ menu ---------------- */
/* The view controls that apply wherever you are: text size, appearance, sync,
   and rearranging this tab's cards. They used to be spread between Settings
   and one tab's own toolbar. */

const headerMenu = (app) => {
  app.click("headerMenuBtn");
  return [...app.document.querySelectorAll(".menu-pop button")];
};
const item = (buttons, re) => buttons.find((b) => re.test(b.textContent));

test("the ⋮ menu is in the header on every tab, not only one", () => {
  const app = loadApp({});
  ["today", "prayers", "calendar", "journal", "progress", "settings"].forEach((v) => {
    app.goTo(v);
    const items = headerMenu(app);
    assert.ok(item(items, /Text size/), v + ": text size");
    assert.ok(item(items, /appearance/i), v + ": appearance");
    assert.ok(item(items, /Sync now/), v + ": sync");
    app.document.querySelector(".menu-backdrop")
      .dispatchEvent(new app.window.Event("pointerdown", { bubbles: true }));
  });
});

test("text size is set from the menu, and remembered per device", () => {
  const app = loadApp({});
  const root = app.document.documentElement;
  item(headerMenu(app), /Text size/).click();          // opens a submenu
  const sizes = [...app.document.querySelectorAll(".menu-pop button")];
  assert.ok(sizes.some((b) => /●/.test(b.textContent)), "the current size is marked");
  item(sizes, /Large\b/).click();

  assert.equal(root.style.fontSize, "17px");
  assert.equal(app.window.localStorage.getItem("yawarScale"), "17");
  assert.ok(!JSON.stringify(app.state() || {}).includes("yawarScale"),
    "a display preference, never part of the health record");
});

test("the appearance item flips the theme and names the one you'd get", () => {
  const app = loadApp({});
  const themeNow = () => app.document.documentElement.getAttribute("data-theme");
  const first = item(headerMenu(app), /appearance/i);
  const wanted = /Dark/.test(first.textContent) ? "dark" : "light";
  first.click();
  assert.equal(themeNow(), wanted, "it offers what you'd switch to, not what you're on");

  const back = item(headerMenu(app), /appearance/i);
  assert.ok(!new RegExp(wanted, "i").test(back.textContent), "and now offers the other one");
});

test("Rearrange cards is offered only where there are cards to rearrange", () => {
  // Calendar is a grid of hours and Others is three sub-panels; neither is a
  // list of cards, so neither can be reordered.
  const app = loadApp({});
  app.goTo("today");
  assert.ok(item(headerMenu(app), /Rearrange cards/), "Today is a card view");
  app.document.querySelector(".menu-backdrop")
    .dispatchEvent(new app.window.Event("pointerdown", { bubbles: true }));

  app.goTo("calendar");
  assert.equal(item(headerMenu(app), /Rearrange cards/), undefined);
});

test("Rearrange cards from the header puts the tab you're on into edit mode", () => {
  const app = loadApp({});
  app.goTo("prayers");
  item(headerMenu(app), /Rearrange cards/).click();
  assert.ok(app.document.body.classList.contains("editing"));
  assert.ok(app.document.querySelector("#view-prayers .card-tools"),
    "the tools are on this tab's cards");

  item(headerMenu(app), /Done rearranging/).click();
  assert.ok(!app.document.body.classList.contains("editing"));
});

test("Sync now says so rather than doing nothing when sync is off", () => {
  const app = loadApp({ localStorageSeed: { [MAIN_KEY]: JSON.stringify({
    schema: SCHEMA, profile: {}, days: {}, sync: { enabled: false, since: 0 },
  }) } });
  item(headerMenu(app), /Sync now/).click();
  assert.match(app.statusText(), /sync is off/i);
  assert.equal(app.document.querySelector(".view.active").id, "view-settings",
    "and takes you to where the switch is");
});

/* ---------------- editing what is on a card ---------------- */
/* Medicines, supplements and dhikr are lists on the synced profile. They used
   to be editable only in Settings; edit mode renders the same editors in
   place on the cards they drive. */

test("Edit is offered where a card has a list you can change", () => {
  const app = loadApp({});
  app.goTo("today");
  assert.ok(item(headerMenu(app), /Edit what/), "Today has medicines and supplements");
  app.document.querySelector(".menu-backdrop")
    .dispatchEvent(new app.window.Event("pointerdown", { bubbles: true }));

  app.goTo("progress");
  assert.equal(item(headerMenu(app), /Edit what/), undefined, "charts have nothing to edit");
});

test("edit mode turns the checklists into the Settings editors, in place", () => {
  const app = loadApp({});
  app.goTo("today");
  const meds = app.document.getElementById("medsBox");
  assert.ok(meds.querySelector("input[type=checkbox]"), "a checklist to begin with");

  item(headerMenu(app), /Edit what/).click();
  assert.equal(meds.querySelector("input[type=checkbox]"), null, "not a checklist any more");
  assert.ok(meds.querySelector("input[type=text]"), "the name is editable in place");
  assert.ok([...meds.querySelectorAll("button")].some((b) => /Add/.test(b.textContent)),
    "and you can add one without going to Settings");
  assert.ok(app.document.body.classList.contains("editing-items"), "and it is visibly a mode");
});

test("adding from a card writes to the same synced list Settings edits", () => {
  const app = loadApp({});
  app.goTo("today");
  item(headerMenu(app), /Edit what/).click();

  const meds = app.document.getElementById("medsBox");
  const add = meds.querySelector(".task-sched input");
  add.value = "Vitamin D";
  [...meds.querySelectorAll("button")].find((b) => /Add/.test(b.textContent)).click();

  const s = app.state();
  assert.ok(s.profile.meds.some((m) => m[1] === "Vitamin D"));
  assert.ok(s.profile.updated_at > 1, "stamped, or it never pushes");
  // And the Settings editor is looking at the very same list.
  app.goTo("settings");
  assert.ok([...app.document.querySelectorAll("#medsEditBox input[type=text]")]
    .some((i) => i.value === "Vitamin D"), "one list, two ways in");
});

test("renaming on the card renames it for good", () => {
  const app = loadApp({});
  app.goTo("today");
  item(headerMenu(app), /Edit what/).click();

  const first = app.document.querySelector("#medsBox input[type=text]");
  first.value = "Renamed thing";
  first.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  assert.equal(app.state().profile.meds[0][1], "Renamed thing");
  item(headerMenu(app), /Done editing/).click();
  assert.match(app.document.getElementById("medsBox").textContent, /Renamed thing/,
    "and the checklist shows the new name");
});

test("edit mode reaches the dhikr card on the Prayers tab too", () => {
  const app = loadApp({});
  app.goTo("today");
  item(headerMenu(app), /Edit what/).click();
  app.goTo("prayers");
  assert.ok(app.document.querySelector("#dhikrBox input[type=text]"),
    "the same mode, on every card that has a list");
});

test("edit mode is a mode, not a stored preference", () => {
  const app = loadApp({});
  app.goTo("today");
  item(headerMenu(app), /Edit what/).click();
  const stored = JSON.stringify(Object.entries(app.window.localStorage));
  assert.ok(!/editItems|editing-items/.test(stored));
  assert.ok(!JSON.stringify(app.state() || {}).includes("editItems"));
});

/* ---------------- rearranging the bottom bar ---------------- */

const barOrder = (app) =>
  [...app.document.querySelectorAll("#tabs button")].map((b) => b.getAttribute("data-nav"));

function openBarEditor(app) {
  item(headerMenu(app), /Rearrange the bottom bar/).click();
  return app.document.querySelector(".menu-pop");
}
function dragBarRow(app, from, to, before) {
  const row = (v) => app.document.querySelector('[data-droplist="tabbar"] [data-row="' + v + '"]');
  const ev = (type, y) => {
    const e = new app.window.Event(type, { bubbles: true, cancelable: true });
    e.clientX = 10; e.clientY = y;
    return e;
  };
  row(from).querySelector(".drag-grip").dispatchEvent(ev("pointerdown", 0));
  const dst = row(to);
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  app.document.dispatchEvent(ev("pointermove", before ? 110 : 130));
  app.document.dispatchEvent(ev("pointerup", before ? 110 : 130));
}

test("Settings gave up its slot in the bar - it is in the ⋮ menu instead", () => {
  const app = loadApp({});
  assert.equal(barOrder(app).includes("settings"), false);
  assert.ok(app.document.getElementById("view-settings"), "still a view, just not a button");

  // And the menu is how you get there.
  item(headerMenu(app), /Settings/).click();
  assert.equal(app.document.querySelector(".view.active").id, "view-settings");
});

test("the bar can be rearranged by dragging, and it sticks", () => {
  const app = loadApp({});
  const before = barOrder(app);
  assert.equal(before[0], "tasks");

  openBarEditor(app);
  dragBarRow(app, "progress", "tasks", true);   // drop Progress above Tasks

  const after = barOrder(app);
  assert.equal(after[0], "progress", "the bar itself reordered");
  assert.deepEqual(after.slice().sort(), before.slice().sort(), "nothing gained or lost");

  const reopened = loadApp({ localStorageSeed: {
    yawarTabOrder: app.window.localStorage.getItem("yawarTabOrder") } });
  assert.deepEqual(barOrder(reopened), after, "and it comes back that way");
});

test("a swipe follows the bar's own order, not a fixed one", () => {
  // Otherwise a rearranged bar and the gesture would disagree about which
  // tab sits beside which.
  const app = loadApp({ localStorageSeed: {
    yawarTabOrder: JSON.stringify(["today", "tasks", "workflow", "prayers",
      "calendar", "journal", "others", "progress"]) } });
  assert.equal(app.document.querySelector(".view.active").id, "view-today");

  app.swipe(".wrap", 120, 0);
  assert.equal(app.document.querySelector(".view.active").id, "view-today",
    "Today is first now, so there is nothing to its left");
  app.swipe(".wrap", -120, 0);
  assert.equal(app.document.querySelector(".view.active").id, "view-tasks");
});

test("the bar's order is per device and never rides the sync protocol", () => {
  const app = loadApp({});
  openBarEditor(app);
  dragBarRow(app, "journal", "tasks", true);
  assert.ok(app.window.localStorage.getItem("yawarTabOrder"), "its own key");
  assert.ok(!JSON.stringify(app.state() || {}).includes("yawarTabOrder"),
    "which tabs sit where is a display preference, not a health record");
});

test("Reset puts the bar back, and a tab the stored order never heard of still appears", () => {
  const app = loadApp({ localStorageSeed: {
    // What an order saved before Workflow got its own tab looks like.
    yawarTabOrder: JSON.stringify(["progress", "today"]) } });
  const order = barOrder(app);
  assert.equal(order[0], "progress");
  assert.equal(order[1], "today");
  assert.ok(order.includes("workflow"), "a later tab is appended rather than lost");
  assert.equal(order.length, 8);

  openBarEditor(app);
  [...app.document.querySelectorAll(".menu-pop button")]
    .find((b) => /Reset/.test(b.textContent)).click();
  assert.equal(barOrder(app)[0], "tasks");
  assert.equal(app.window.localStorage.getItem("yawarTabOrder"), null);
});
