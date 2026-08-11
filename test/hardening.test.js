"use strict";
/*
 * Durability + migration coverage required by CLAUDE.md's testing rule:
 * every change to index.html must be exercised, in a real jsdom DOM with
 * nothing injected, against: fresh browser, existing good data, corrupt
 * main key with good backup, both corrupt, and storage writes blocked.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, BAK_KEY } = require("./lib.js");
after(closeAllApps);

// Mirrors index.html's keyOf(): local-time Y-M-D, not UTC.
function localTodayKey() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

test("fresh browser: no localStorage, no crash, nothing written until an edit happens", () => {
  const app = loadApp({});
  assert.equal(app.rawMain(), null);
  assert.equal(app.rawBackup(), null);
  // Today tab should have rendered without throwing.
  assert.match(app.document.getElementById("dateLabel").textContent, /\w/);
  assert.doesNotMatch(app.statusKind(), /\bbad\b/);
});

test("existing good (legacy, pre-sync) data loads, migrates to the current schema, and keeps every field", () => {
  const legacy = {
    schema: 1,
    profile: { startWeight: 120, targetWeight: 90 },
    days: {
      "2026-01-01": {
        meds: { pre: true }, prayers: { fajr: true }, meals: { b: true },
        extras: {}, water: 4, weight: "119.5", sleep: "7", steps: "3000",
        jointPain: 3, energy: 6, exercise: true, notes: "felt okay",
      },
    },
  };
  const app = loadApp({ localStorageSeed: { [MAIN_KEY]: JSON.stringify(legacy) } });

  const s = app.state();
  assert.equal(s.schema, 4, "migration should bump the schema and persist it immediately");
  const d = s.days["2026-01-01"];
  assert.equal(d.weight, "119.5");
  assert.equal(d.notes, "felt okay");
  assert.equal(d.jointPain, 3);
  assert.ok(d.updated_at && d.updated_at > 0, "migration must stamp updated_at on pre-existing days");
  assert.ok(s.profile.updated_at && s.profile.updated_at > 0, "migration must stamp profile.updated_at too");
  assert.equal(s.profile.startWeight, 120);
  assert.deepEqual(s.sync, { enabled: true, since: 0, lastSyncAt: null, lastError: null },
    "sync is on by default now - a device that isn't syncing holds a diverging copy");
});

test("corrupt main key with a good backup: silently recovers from backup and re-saves safely", () => {
  const good = {
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 5 },
    days: { "2026-02-02": { meds: {}, prayers: {}, meals: {}, extras: {}, water: 2, weight: "107", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 5 } },
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
  };
  const app = loadApp({
    localStorageSeed: {
      [MAIN_KEY]: "{ this is not valid json",
      [BAK_KEY]: JSON.stringify(good),
    },
  });

  assert.match(app.statusText(), /restored from the automatic backup/i);
  const s = app.state(); // state() reads MAIN_KEY, which save() should have rewritten from the backup immediately
  assert.equal(s.days["2026-02-02"].weight, "107");
  assert.notEqual(app.rawMain(), "{ this is not valid json", "the corrupt main key must be healed once a good backup is found");

  // Saving must still work normally after a successful recovery — and the
  // recovered history must not be disturbed by an unrelated new edit.
  app.click("waterPlus");
  const after = app.state();
  assert.equal(after.days["2026-02-02"].weight, "107", "recovered history must survive further edits untouched");
  assert.equal(after.days[localTodayKey()].water, 1);
});

test("both main and backup corrupt: refuses to overwrite, shows a sticky error, leaves raw storage untouched", () => {
  const corruptMain = "{ not json at all";
  const corruptBackup = "also not json";
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: corruptMain, [BAK_KEY]: corruptBackup },
  });

  assert.match(app.statusText(), /could not be read/i);
  assert.match(app.statusText(), /do not clear this site/i);
  assert.match(app.statusKind(), /\bbad\b/);
  assert.match(app.statusKind(), /\bshow\b/, "the warning must be sticky, not auto-dismiss");

  // The raw corrupt bytes must survive completely untouched.
  assert.equal(app.rawMain(), corruptMain);
  assert.equal(app.rawBackup(), corruptBackup);

  // Any further attempt to save must be refused, not silently blank the slate.
  app.click("waterPlus");
  assert.equal(app.rawMain(), corruptMain, "a blocked save must not touch storage at all");
  assert.match(app.statusText(), /saving is paused/i);
});

test("storage writes blocked (quota exceeded / private mode): edits are not lost silently, existing data survives", () => {
  const good = {
    schema: 2,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 5 },
    days: {},
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
  };
  const seededRaw = JSON.stringify(good);
  const app = loadApp({
    localStorageSeed: { [MAIN_KEY]: seededRaw },
    blockStorage: true,
  });

  // Reading still works even though writes are blocked. The stored copy is
  // still the seeded schema 2: the app migrates in memory, but the migration
  // write was refused like every other write - it must not half-apply.
  assert.equal(app.state().schema, 2);

  app.click("waterPlus");
  assert.match(app.statusText(), /save failed/i);
  assert.match(app.statusKind(), /\bbad\b/);
  // The write must have been refused outright — the stored bytes are exactly what they were.
  assert.equal(app.rawMain(), seededRaw);
});
