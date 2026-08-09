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
const { loadApp, closeAllApps, MAIN_KEY } = require("./lib.js");
const { createMockServer, fetchImplFor } = require("./mockServer.js");
after(closeAllApps);

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

test("sync stays off until explicitly enabled, even with existing local data", () => {
  const seed = {
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 0 },
    days: { "2026-03-01": { meds: {}, prayers: {}, meals: {}, extras: {}, water: 1, weight: "", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 10 } },
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
  };
  let syncCalled = false;
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) },
    // The page also fetches /api/brief unconditionally (that feature has
    // its own opt-in gate: nothing happens until Google is connected) -
    // this test only cares whether /api/sync specifically gets hit.
    fetchImpl: async (url) => {
      if (String(url).includes("/api/sync")) syncCalled = true;
      return { ok: true, json: async () => ({ now: 1, days: {}, profile: null, applied: 0, skipped: [], more: false, status: "not_connected" }) };
    },
  });
  app.goTo("progress");
  assert.equal(syncCalled, false, "loading with sync disabled must never call /api/sync");
  assert.equal(app.document.getElementById("syncEnabled").checked, false);
  assert.equal(app.document.getElementById("syncNowBtn").disabled, true);
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

test("tasks ride the synced profile, so they reach every device", async () => {
  // They used to sit at the top level of state and were never in the payload
  // at all - which is why a task added on the phone never showed on the desktop.
  const server = createMockServer();
  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 3,
        profile: { startWeight: 108, targetWeight: 88, tasks: [], updated_at: 1 },
        days: {},
        sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null },
      }),
    },
    fetchImpl: fetchImplFor(server),
  });
  await app.flush();

  app.setInput("taskTitleIn", "Call the pharmacy");
  app.click("taskAddBtn");
  app.click("syncNowBtn");
  await app.flush();
  await app.flush();

  assert.ok(server._profile, "the profile went up");
  const pushed = JSON.parse(server._profile.data);
  assert.deepEqual(pushed.tasks.map((t) => t.title), ["Call the pharmacy"]);
});

test("a device upgrading from the old layout carries its local tasks into the synced profile", () => {
  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: JSON.stringify({
        schema: 2,
        profile: { startWeight: 108, targetWeight: 88, updated_at: 5 },
        days: {},
        tasks: [{ id: "t1", title: "Old local task", due: null, done: false, scheduled: false, created_at: 1, updated_at: 1 }],
        sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
      }),
    },
  });
  const s = app.state();
  assert.equal(s.schema, 3);
  assert.deepEqual(s.profile.tasks.map((t) => t.title), ["Old local task"], "nothing is dropped in the move");
  assert.equal(s.tasks, undefined, "and it no longer lives at the top level");
  assert.match(app.document.getElementById("taskList").textContent, /Old local task/);
});
