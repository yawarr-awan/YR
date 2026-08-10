"use strict";
/*
 * Settings tab: the editable medicine list (which drives the Today
 * checklist and therefore the completion maths) and the editable
 * Today's Brief instructions, which live server-side because the 7am cron
 * generates the brief with no browser involved.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function jsonRes(body) { return { ok: true, status: 200, json: async () => body }; }
const idle = async (url) => {
  if (String(url).includes("/api/settings/brief-prompt")) return jsonRes({ prompt: null, default: "DEFAULT TEXT" });
  return jsonRes({ connected: false, status: "not_connected" });
};

const medRows = (app) => Array.from(app.document.querySelectorAll("#medsEditBox .task-row"));

test("medicines can be renamed, removed and added, and Today follows immediately", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("settings");

  assert.equal(medRows(app).length, 3, "the three defaults to start with");

  // Rename
  const first = medRows(app)[0].querySelector("input[type=text]");
  first.value = "Morning tablet";
  first.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.match(app.document.getElementById("medsBox").textContent, /Morning tablet/);
  assert.equal(app.state().profile.meds[0][1], "Morning tablet", "stored on the profile, so it syncs");

  // Remove
  medRows(app)[0].querySelector("button.icon-btn.danger").click();
  assert.equal(medRows(app).length, 2);
  assert.doesNotMatch(app.document.getElementById("medsBox").textContent, /Morning tablet/);
  assert.equal(app.document.getElementById("medsCount").textContent, "0/2", "the count follows the list");

  // Add
  app.setInput("medNewIn", "Vitamin D");
  app.click("medAddBtn");
  assert.equal(medRows(app).length, 3);
  assert.match(app.document.getElementById("medsBox").textContent, /Vitamin D/);
});

test("removing a medicine changes what a full day means, without touching past records", () => {
  const app = loadApp({ fetchImpl: idle });
  // Tick everything that exists on a default day except the three medicines.
  const tickAll = (boxId) => app.document.querySelectorAll("#" + boxId + " input[type=checkbox]").forEach((cb) => {
    cb.checked = true;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  });
  ["medsBox", "mealsBox", "extrasBox", "moveBox"].forEach(tickAll);
  app.goTo("prayers");
  tickAll("prayBox");
  app.goTo("today");
  for (let i = 0; i < 8; i++) app.click("waterPlus");
  assert.equal(app.document.getElementById("dayRingTxt").textContent, "100%");

  app.goTo("settings");
  medRows(app)[0].querySelector("button.icon-btn.danger").click();
  app.goTo("today");
  // Still 100%: one fewer item to do, and it was already done.
  assert.equal(app.document.getElementById("dayRingTxt").textContent, "100%");
});

test("the brief instructions load from the server, save, and reset back to the default", async () => {
  let stored = null;
  const app = loadApp({
    fetchImpl: async (url, opts) => {
      if (String(url).includes("/api/settings/brief-prompt")) {
        if (opts && opts.method === "PUT") {
          stored = JSON.parse(opts.body).prompt || null;
          return jsonRes({ prompt: stored, default: "DEFAULT TEXT" });
        }
        return jsonRes({ prompt: stored, default: "DEFAULT TEXT" });
      }
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  app.goTo("settings");
  await app.flush();

  const ta = app.document.getElementById("briefPromptIn");
  assert.equal(ta.value, "DEFAULT TEXT", "the default is shown so it can be edited from something");
  assert.match(app.document.getElementById("briefPromptStatus").textContent, /default/i);

  ta.value = "Keep it to two sentences.";
  app.click("briefPromptSave");
  await app.flush();
  assert.equal(stored, "Keep it to two sentences.");
  assert.match(app.document.getElementById("briefPromptStatus").textContent, /saved/i);

  app.click("briefPromptReset");
  await app.flush();
  assert.equal(stored, null, "resetting clears the override rather than storing an empty string");
});

test("a failure loading the brief instructions is reported, not left looking blank", async () => {
  const app = loadApp({
    fetchImpl: async (url) => {
      if (String(url).includes("/api/settings/brief-prompt")) return { ok: false, status: 500, json: async () => ({}) };
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  app.goTo("settings");
  await app.flush();
  assert.match(app.document.getElementById("briefPromptStatus").textContent, /couldn't load/i);
});

const extraRows = (app) => Array.from(app.document.querySelectorAll("#extrasEditBox .task-row"));

test("supplements and drinks can be renamed, re-costed, removed and added", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("settings");

  assert.equal(extraRows(app).length, 5, "the five defaults");

  const first = extraRows(app)[0].querySelector("input[type=text]");
  first.value = "Collagen (evening)";
  first.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.match(app.document.getElementById("extrasBox").textContent, /Collagen \(evening\)/);
  assert.equal(app.state().profile.extras[0].label, "Collagen (evening)");

  // The calorie figure feeds the meal total on Today.
  const kcal = extraRows(app)[0].querySelector("input[type=number]");
  kcal.value = "0";
  kcal.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.equal(app.state().profile.extras[0].kcal, 0);

  extraRows(app)[0].querySelector("button.icon-btn.danger").click();
  assert.equal(extraRows(app).length, 4);
  assert.equal(app.document.getElementById("extrasCount").textContent, "0/4");

  app.setInput("extraNewIn", "Magnesium");
  app.click("extraAddBtn");
  assert.equal(extraRows(app).length, 5);
  assert.match(app.document.getElementById("extrasBox").textContent, /Magnesium/);
});

test("dhikr is editable per period, so morning and evening can differ", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("settings");

  const periods = app.document.querySelectorAll("#dhikrEditBox .subcard");
  assert.equal(periods.length, 3, "morning, afternoon and evening each get their own list");

  const morningRows = () => Array.from(app.document.querySelectorAll("#dhikrEditBox .subcard")[0].querySelectorAll(".task-row"));
  assert.equal(morningRows().length, 7);

  // Remove one from the morning only.
  morningRows()[0].querySelector("button.icon-btn.danger").click();
  assert.equal(morningRows().length, 6);
  assert.equal(app.state().profile.dhikr.morning.length, 6);
  assert.equal(app.state().profile.dhikr.evening.length, 7, "the evening list is untouched");

  // Add one to the evening only.
  const eveningCard = app.document.querySelectorAll("#dhikrEditBox .subcard")[2];
  const addBox = eveningCard.querySelector(".task-sched");
  addBox.querySelector("input").value = "Surah Al-Mulk";
  Array.from(addBox.querySelectorAll("button")).find((b) => /add/i.test(b.textContent)).click();
  assert.equal(app.state().profile.dhikr.evening.length, 8);

  app.goTo("prayers");
  const cards = app.document.querySelectorAll("#dhikrBox .subcard");
  assert.equal(cards[0].querySelector(".count").textContent, "0/6");
  assert.equal(cards[2].querySelector(".count").textContent, "0/8");
  assert.equal(app.document.getElementById("dhikrCount").textContent, "0/21");
  assert.match(cards[2].textContent, /Surah Al-Mulk/);
});

test("Settings has a Google card that offers to connect when you aren't", async () => {
  const app = loadApp({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) }),
  });
  await app.flush();
  await app.flush();
  app.goTo("settings");

  assert.match(app.document.getElementById("googleStatus").textContent, /not connected/i);
  const btn = app.document.querySelector("#googleActions a");
  assert.ok(btn, "expected a connect button");
  assert.match(btn.textContent, /connect google/i);
  assert.equal(btn.getAttribute("href"), "/api/google/connect");
});

test("the Google card offers a reconnect once connected, and says so when the grant is stale", async () => {
  const connected = loadApp({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ connected: true, status: "ok", summary: "All good.", day: "2026-08-10" }) }),
  });
  await connected.flush();
  await connected.flush();
  connected.goTo("settings");
  assert.match(connected.document.getElementById("googleStatus").textContent, /connected/i);
  assert.match(connected.document.querySelector("#googleActions a").textContent, /reconnect/i);

  const stale = loadApp({
    fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "reconnect_required" }) }),
  });
  await stale.flush();
  await stale.flush();
  stale.goTo("settings");
  assert.match(stale.document.getElementById("googleStatus").textContent, /expired|permission/i);
});

test("every card in Settings folds away, and remembers that it was folded", () => {
  const app = loadApp({});
  app.goTo("settings");

  const cards = Array.from(app.document.querySelectorAll("#view-settings .card"));
  assert.ok(cards.length >= 9, `expected the whole tab, got ${cards.length}`);
  cards.forEach((c) => {
    const key = c.getAttribute("data-collapse");
    assert.ok(c.classList.contains("collapsible") && key,
      `a Settings card with no collapse key: ${c.querySelector("h3").textContent}`);
    assert.ok(c.querySelector(".card-body"), `${key} needs its content in a .card-body to fold`);
  });

  // Google reports connection state, so it is expanded to begin with - and it
  // has to fold like the rest.
  const google = app.document.getElementById("googleCard");
  assert.equal(google.classList.contains("collapsed"), false);
  google.querySelector("h3").click();
  assert.ok(google.classList.contains("collapsed"));

  // The preference is per device and must never reach the synced record.
  const reopened = loadApp({ localStorageSeed: { yawarCollapsed: app.window.localStorage.getItem("yawarCollapsed") } });
  reopened.goTo("settings");
  assert.ok(reopened.document.getElementById("googleCard").classList.contains("collapsed"));
  assert.equal(/collapsed|google/.test(JSON.stringify(reopened.state() || {})), false,
    "a display preference must not ride the sync payload");
});
