"use strict";
/*
 * Client-side sync layer coverage required by CLAUDE.md: first sync from
 * empty, conflicting edits arriving from two "devices", and the server
 * being unreachable. Sync must stay opt-in and never touch local data on
 * failure.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, SCHEMA } = require("./lib.js");
const { createMockServer, fetchImplFor, DEFAULT_ACCOUNT } = require("./mockServer.js");
after(closeAllApps);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("sync is on by default, and an existing install that had it off is switched on once", () => {
  // It is not really optional: this app is one person's record across their
  // own devices behind their own sign-in, and a device that is not syncing is
  // quietly keeping a diverging copy.
  const fresh = loadApp({ fetchImpl: async () => ({ ok: true, json: async () => ({ now: 1, days: {}, profile: null, more: false }) }) });
  fresh.goTo("settings");
  assert.equal(fresh.document.getElementById("syncEnabled").checked, true);
  assert.equal(fresh.document.getElementById("syncNowBtn").disabled, false);

  const old = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 3,
        profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 0 },
        days: {},
        sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
      }),
    },
    fetchImpl: async () => ({ ok: true, json: async () => ({ now: 1, days: {}, profile: null, more: false }) }),
  });
  assert.equal(old.state().sync.enabled, true, "the upgrade turns it on");
  assert.equal(old.state().schema, SCHEMA, "and records that it has done so");
});

test("turning sync off still sticks - the upgrade runs once, not on every load", () => {
  const impl = async () => ({ ok: true, json: async () => ({ now: 1, days: {}, profile: null, more: false }) });
  const app = loadApp({ fetchImpl: impl });
  app.goTo("settings");
  app.check("syncEnabled", false);
  assert.equal(app.state().sync.enabled, false);

  const again = loadApp({ localStorageSeed: { [MAIN_KEY]: app.rawMain() }, fetchImpl: impl });
  assert.equal(again.state().sync.enabled, false, "a deliberate opt-out must not be undone on the next load");
  again.goTo("settings");
  assert.equal(again.document.getElementById("syncEnabled").checked, false);
});

test("first sync from empty: local history pushes up and populates an empty server", async () => {
  const server = createMockServer();
  const seed = {
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 0 },
    days: {
      "2026-03-01": { meds: {}, prayers: { fajr: true }, meals: {}, extras: {}, water: 3, weight: "106", sleep: "7", steps: "", jointPain: 2, energy: 7, exercise: false, notes: "", updated_at: 42 },
      "2026-03-02": { meds: {}, prayers: {}, meals: {}, extras: {}, water: 5, weight: "105.5", sleep: "", steps: "", jointPain: null, energy: null, exercise: true, notes: "", updated_at: 43 },
    },
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
  };
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) },
    fetchImpl: fetchImplFor(server),
  });

  app.goTo("progress");
  app.check("syncEnabled", true); // opting in triggers the first sync
  await app.flush();

  assert.equal(Object.keys(server._days).length, 2, "both existing local days should have pushed to the empty server");
  assert.equal(JSON.parse(server._days["2026-03-01"].data).weight, "106");

  const s = app.state();
  assert.equal(s.sync.enabled, true);
  assert.equal(s.sync.lastError, null);
  // Deliberately NOT a moving watermark any more - see the skew test below.
  assert.equal(s.sync.since, 0, "every sync reconciles the full set");
  assert.match(app.syncStatusText(), /last synced/i);
});

test("a device whose clock lags the server still pushes its own edits and pulls the other device's", async () => {
  // The regression: `since` was set from the SERVER clock but compared against
  // `updated_at` stamped by each DEVICE clock. A device running even slightly
  // behind had its edits silently skipped on push, and rows written by a
  // lagging device were silently skipped on pull. Both looked like "sync says
  // it worked but my other device still shows the old data".
  const server = createMockServer();
  const LAG = 10 * 60 * 1000; // this device's clock is ten minutes behind
  const serverNow = Date.now();

  // Another device already wrote a day, stamped with ITS lagging clock.
  server._days["2026-03-05"] = { data: JSON.stringify({ meds: {}, prayers: {}, meals: {}, extras: {}, water: 7, weight: "101", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: serverNow - LAG }), updated_at: serverNow - LAG };

  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 3,
        profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: serverNow - LAG },
        days: {
          "2026-03-06": { meds: {}, prayers: {}, meals: {}, extras: {}, water: 2, weight: "104", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: serverNow - LAG },
        },
        // Pretend a previous sync had already advanced the watermark to server time.
        sync: { enabled: true, since: serverNow, lastSyncAt: serverNow, lastError: null },
    account: DEFAULT_ACCOUNT,
      }),
    },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();
  await app.flush();

  assert.ok(server._days["2026-03-06"], "this device's own edit must reach the server despite the stale watermark");
  assert.equal(app.state().days["2026-03-05"].weight, "101", "and the other device's day must come down");
});

test("conflicting edits from two devices resolve by true last-write-wins", async () => {
  const server = createMockServer();
  const T0 = 1700000000000;
  const baselineDay = () => ({ meds: {}, prayers: {}, meals: {}, extras: {}, water: 2, weight: "100", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: T0 });
  server.seedDay("2026-04-01", JSON.stringify(baselineDay()), T0);

  const seedFor = () => JSON.stringify({
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 0 },
    days: { "2026-04-01": baselineDay() },
    sync: { enabled: true, since: T0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
  });

  const deviceA = loadApp({ localStorageSeed: { [MAIN_KEY]: seedFor() }, fetchImpl: fetchImplFor(server) });
  const deviceB = loadApp({ localStorageSeed: { [MAIN_KEY]: seedFor() }, fetchImpl: fetchImplFor(server) });

  // Device A edits first and syncs.
  deviceA.pickDate("2026-04-01");
  deviceA.setInput("weightIn", "105");
  deviceA.click("syncNowBtn");
  await deviceA.flush();
  const afterA = deviceA.state();
  assert.equal(afterA.days["2026-04-01"].weight, "105");
  assert.equal(JSON.parse(server._days["2026-04-01"].data).weight, "105");

  await sleep(5); // guarantee device B's edit gets a strictly later updated_at

  // Device B edits the SAME day differently, without having seen A's change yet, then syncs.
  deviceB.pickDate("2026-04-01");
  deviceB.setInput("weightIn", "110");
  deviceB.click("syncNowBtn");
  await deviceB.flush();
  const afterB = deviceB.state();
  assert.equal(afterB.days["2026-04-01"].weight, "110", "device B's own newer edit must survive its own sync");
  assert.equal(JSON.parse(server._days["2026-04-01"].data).weight, "110", "the newer edit must win on the server");

  // Device A syncs again and must pick up B's newer edit — not keep its own older one.
  deviceA.click("syncNowBtn");
  await deviceA.flush();
  const afterA2 = deviceA.state();
  assert.equal(afterA2.days["2026-04-01"].weight, "110", "true LWW: device A must adopt the strictly newer remote edit");
});

test("server unreachable: local data is left completely untouched and the error is surfaced, not swallowed", async () => {
  const seed = {
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 0 },
    days: { "2026-05-01": { meds: {}, prayers: {}, meals: {}, extras: {}, water: 6, weight: "104", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "still here", updated_at: 99 } },
    sync: { enabled: true, since: 50, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
  };
  const before = JSON.stringify(seed);
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: before },
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });

  app.goTo("progress");
  app.click("syncNowBtn");
  await app.flush();

  const s = app.state();
  assert.equal(s.days["2026-05-01"].weight, "104", "an unreachable server must not corrupt or blank local data");
  assert.equal(s.days["2026-05-01"].notes, "still here");
  assert.equal(s.sync.since, 50, "since must not advance on a failed sync");
  assert.ok(s.sync.lastError, "the failure must be recorded, not silently ignored");
  assert.match(app.syncStatusText(), /sync failed/i);
  assert.match(app.syncStatusText(), /untouched/i);
});

test("a non-OK HTTP response is treated as a failure, not applied as if it were data", async () => {
  const seed = {
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 0 },
    days: { "2026-05-02": { meds: {}, prayers: {}, meals: {}, extras: {}, water: 1, weight: "103", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 77 } },
    sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
  };
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) },
    fetchImpl: async () => ({ ok: false, status: 401, json: async () => ({ error: "unauthorized" }) }),
  });

  app.goTo("progress");
  app.click("syncNowBtn");
  await app.flush();

  const s = app.state();
  assert.equal(s.days["2026-05-02"].weight, "103");
  assert.ok(s.sync.lastError);
  assert.match(app.syncStatusText(), /sync failed/i);
});

test("tasks push as their own rows, not inside the profile blob", async () => {
  /* They started at the top level and were never in the payload, then moved
     onto the profile - which the server silently drops above 20KB, and which
     is last-write-wins as a whole. A board needs neither of those, so tasks
     are their own rows with a per-item merge. */
  const server = createMockServer();
  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 3,
        profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 1 },
        days: {},
        sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null },
        account: DEFAULT_ACCOUNT,
      }),
    },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();

  app.goTo("tasks");
  app.click("projectAddBtn");
  const add = app.document.querySelector(".board-add input");
  add.value = "Call the pharmacy";
  add.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));

  app.goTo("settings");
  app.click("syncNowBtn");
  await app.flush();
  await app.flush();

  const names = Object.values(server._items.projects).map((r) => JSON.parse(r.data).name);
  assert.deepEqual(names, ["New project"], "the project went up as its own row");
  const titles = Object.values(server._items.tasks).map((r) => JSON.parse(r.data).title);
  assert.deepEqual(titles, ["Call the pharmacy"], "and so did its task");
  const pushedProfile = JSON.parse(server._profile.data);
  assert.ok(!pushedProfile.projects, "the board is not stuffed into the profile blob");
});

test("an old device's local tasks travel all the way to the board", () => {
  /* Two migrations in a row: 2 -> 3 moved the list off the top level onto the
     synced profile, and 4 -> 5 copies it into the board's own item store.
     profile.tasks is deliberately kept behind as a backstop rather than
     deleted - it is a couple of KB, and it is the only copy if the board
     migration ever got something wrong. */
  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 2,
        profile: { startWeight: 108, targetWeight: 88, updated_at: 5 },
        days: {},
        tasks: [{ id: "t1", title: "Old local task", due: null, done: false, scheduled: false, created_at: 1, updated_at: 1 }],
        sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
      }),
    },
  });
  const s = app.state();
  assert.equal(s.schema, SCHEMA);
  assert.deepEqual(s.profile.tasks.map((t) => t.title), ["Old local task"],
    "kept on the profile as a backstop");

  const board = Object.values(s.tasks);
  assert.equal(board.length, 1, "and copied onto the board");
  assert.equal(board[0].title, "Old local task");
  assert.ok(board[0].updated_at > 0, "stamped, so it syncs");
  assert.equal(board[0].deleted, 0);

  const projects = Object.values(s.projects).filter((p) => !p.deleted);
  assert.equal(projects.length, 1, "into a project of their own");
  assert.equal(projects[0].name, "General");
  assert.equal(board[0].projectId, projects[0].id);
});

/* A sync that pulls another device's data has to redraw the tab you are
 * looking at. This was a real bug: sync redrew Today, Progress and the tasks
 * only, so the Prayers tab kept showing this device's stale summary and it
 * read exactly like sync not working. */
test("a pulled edit reaches the tab you are on, not just the stored state", async () => {
  const server = createMockServer();
  const T0 = 1700000000000;
  const day = (over) => Object.assign({
    meds: {}, prayers: {}, meals: {}, extras: {},
    dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null,
    exercise: false, notes: "", updated_at: T0,
  }, over || {});

  // The other device has ticked all five prayers on a day this one has blank.
  server.seedDay("2026-04-01", JSON.stringify(day({
    prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
    updated_at: T0 + 5000,
  })), T0 + 5000);

  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 2,
        profile: { startWeight: 108, targetWeight: 88, updated_at: 0 },
        days: { "2026-04-01": day() },
        sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
      }),
      yawarLastTab: "prayers",
    },
    fetchImpl: fetchImplFor(server),
  });

  app.goTo("prayers");
  app.pickDate("2026-04-01");
  const summaryBefore = app.document.getElementById("praySummary").textContent;

  app.click("syncNowBtn");
  await app.flush();
  await app.flush();

  const stored = app.state().days["2026-04-01"].prayers;
  assert.equal(stored.fajr, true, "the pull landed in storage");
  assert.notEqual(app.document.getElementById("praySummary").textContent, summaryBefore,
    "and the prayer summary on screen was redrawn to match");
  assert.equal(app.document.querySelectorAll("#prayBox input[type=checkbox]:checked").length, 5,
    "the checklist too");
});

/* A day record is created merely by *looking* at a date, and those records
 * carry no updated_at - so dayChunks() skipped them and they could never
 * reach another device. A record with real content in it must always push;
 * a still-empty one must not, or the phantom day spreads instead. */
test("a day holding real data always pushes, even if it somehow lost its stamp", async () => {
  const server = createMockServer();
  const withContent = {
    meds: {}, prayers: { fajr: true }, meals: {}, extras: {},
    dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null,
    exercise: false, notes: "",
  };                                            // no updated_at at all
  const blank = Object.assign({}, withContent, { prayers: {} });

  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 4,
        profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 1 },
        days: { "2026-05-01": withContent, "2026-05-02": blank },
        sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null },
    account: DEFAULT_ACCOUNT,
      }),
    },
    fetchImpl: fetchImplFor(server),
  });

  app.goTo("settings");
  app.click("syncNowBtn");
  await app.flush();
  await app.flush();

  assert.ok(server._days["2026-05-01"], "the day with a tick on it reached the server");
  assert.equal(JSON.parse(server._days["2026-05-01"].data).prayers.fajr, true);
  assert.ok(app.state().days["2026-05-01"].updated_at > 0, "and was stamped on the way out");
  assert.equal(server._days["2026-05-02"], undefined,
    "a day that only ever got looked at says nothing and must not be spread to other devices");
});

/* --- whose data is this? -------------------------------------------------
 * The app is used by more than one person now, each behind their own Access
 * sign-in. The local store is per-browser, sync pushes everything it holds,
 * and it used to carry no record of whose it was - so opening the app on a
 * browser holding someone else's data would have filed their days and journal
 * under whoever happened to be signed in.
 */
const HERS = "wife@example.com";

function seedFor(account, days) {
  return JSON.stringify({
    schema: 4,
    profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 5 },
    days: days || {},
    sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null },
    account,
  });
}
function dayRec(weight, updated_at) {
  return { meds: {}, prayers: {}, meals: {}, extras: {}, dhikr: { morning: {}, afternoon: {}, evening: {} },
    water: 0, weight, sleep: "", steps: "", jointPain: null, energy: null, exercise: false,
    notes: "his private journal entry", updated_at };
}

test("signing in as someone else never pushes this browser's data into their account", async () => {
  // The whole point of the guard.
  const server = createMockServer({ account: HERS });
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: seedFor("yawar@example.com", { "2026-03-01": dayRec("106", 42) }) },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();
  await app.flush();
  await app.flush();

  assert.deepEqual(Object.keys(server._days), [], "not one of his days reached her account");
  assert.equal(server._profile, null, "and not his profile either");
});

test("...and the browser starts clean for the new account, without destroying the old store", async () => {
  const server = createMockServer({ account: HERS });
  server.seedDay("2026-04-01", JSON.stringify(dayRec("70", 99)), 99);
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: seedFor("yawar@example.com", { "2026-03-01": dayRec("106", 42) }) },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();
  await app.flush();
  await app.flush();

  const s = app.state();
  assert.equal(s.account, HERS, "the store now belongs to whoever is signed in");
  assert.ok(!s.days["2026-03-01"], "his day is gone from the live store");
  assert.ok(s.days["2026-04-01"], "and hers was pulled down in its place");

  // Nothing was thrown away - his copy is parked under its own key.
  const parked = app.window.localStorage.getItem("yawarWellness_v1_foreign:yawar@example.com");
  assert.ok(parked, "his store was kept");
  assert.match(parked, /his private journal entry/);
});

test("an unattributed store pulls before it pushes, and keeps a snapshot when it is attributed", async () => {
  // A device that predates the guard has data but no account. It cannot be
  // told apart from someone else's store by looking at it, so it never pushes
  // on the round that attributes it.
  const server = createMockServer();
  const seed = JSON.parse(seedFor("x", { "2026-03-01": dayRec("106", 42) }));
  delete seed.account;
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();
  await app.flush();

  assert.equal(app.state().account, server.account, "it learned whose it is");
  assert.ok(app.window.localStorage.getItem("yawarWellness_v1_foreign:unattributed"),
    "with a snapshot taken before anyone was credited with it");
});

test("once attributed, the same device pushes normally", async () => {
  const server = createMockServer();
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: seedFor(server.account, { "2026-03-01": dayRec("106", 42) }) },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();
  await app.flush();

  assert.deepEqual(Object.keys(server._days), ["2026-03-01"], "its own account gets its data");
  assert.equal(JSON.parse(server._days["2026-03-01"].data).weight, "106");
});

test("the account is declared on every push, so the server can refuse a mismatch", async () => {
  const sent = [];
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: seedFor("yawar@example.com", { "2026-03-01": dayRec("106", 42) }) },
    fetchImpl: async (url, options) => {
      if (!String(url).includes("/api/sync")) {
        return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
      }
      sent.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ now: 1, email: "yawar@example.com", days: {}, profile: null, more: false }) };
    },
  });
  await app.flush();
  await app.flush();

  assert.ok(sent.length, "it synced");
  assert.equal(sent[0].account, "yawar@example.com");
});

test("the account never rides along as synced data", async () => {
  // Where a store belongs is not part of anyone's health record.
  const sent = [];
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: seedFor("yawar@example.com", { "2026-03-01": dayRec("106", 42) }) },
    fetchImpl: async (url, options) => {
      if (!String(url).includes("/api/sync")) {
        return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
      }
      sent.push(JSON.parse(options.body));
      return { ok: true, status: 200, json: async () => ({ now: 1, email: "yawar@example.com", days: {}, profile: null, more: false }) };
    },
  });
  await app.flush();
  await app.flush();

  const pushed = sent[0];
  assert.ok(pushed.profile, "the profile did go up");
  assert.ok(!("account" in JSON.parse(pushed.profile.data)), "but not carrying the account inside it");
  Object.keys(pushed.days).forEach((d) => {
    assert.ok(!("account" in JSON.parse(pushed.days[d].data)), d + " must not carry it either");
  });
});
