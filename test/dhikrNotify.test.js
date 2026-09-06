"use strict";
/*
 * Dhikr checklist (Today tab) and in-app notification opt-in (Progress
 * tab) coverage. Notifications are foreground-only by design - see
 * CLAUDE.md - so this only covers the permission toggle and the reminder
 * scheduler's own logic, not real OS-level delivery.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

test("dhikr checklist renders three periods with the same items in each, all unchecked by default", () => {
  const app = loadApp({});
  const box = app.document.getElementById("dhikrBox");
  assert.match(box.textContent, /Morning/);
  assert.match(box.textContent, /Afternoon/);
  assert.match(box.textContent, /Evening/);
  const checkboxes = box.querySelectorAll("input[type=checkbox]");
  assert.equal(checkboxes.length, 21, "7 items x 3 periods");
  checkboxes.forEach((cb) => assert.equal(cb.checked, false));
});

test("checking a dhikr item persists under the right period, independent of the others", () => {
  const app = loadApp({});
  const box = app.document.getElementById("dhikrBox");
  const firstCb = box.querySelector("input[type=checkbox]");
  firstCb.checked = true;
  firstCb.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  const today = new Date();
  const key = today.getFullYear() + "-" + String(today.getMonth() + 1).padStart(2, "0") + "-" + String(today.getDate()).padStart(2, "0");
  const saved = app.state().days[key].dhikr;
  assert.equal(saved.morning.istighfar, true);
  assert.equal(saved.afternoon.istighfar, undefined, "other periods must be untouched");
});

test("notifications: unsupported browser hides the button with an explanatory message", () => {
  const app = loadApp({});
  app.goTo("progress");
  assert.equal(app.document.getElementById("notifyBtn").style.display, "none");
  assert.match(app.document.getElementById("notifyText").textContent, /doesn't support/i);
});

test("notifications: default permission shows an enable button; clicking it requests permission", () => {
  const app = loadApp({ notificationPermission: "default" });
  app.goTo("progress");
  const btn = app.document.getElementById("notifyBtn");
  assert.equal(btn.disabled, false);
  assert.match(btn.textContent, /enable reminders/i);

  btn.click();
  assert.equal(app.window.Notification.permission, "granted");
});

test("notifications: already granted shows an enabled, disabled state (nothing left to click)", () => {
  const app = loadApp({ notificationPermission: "granted" });
  app.goTo("progress");
  const btn = app.document.getElementById("notifyBtn");
  assert.equal(btn.disabled, true);
  assert.match(btn.textContent, /enabled/i);
});

test("notifications: denied permission is shown distinctly from 'not asked yet'", () => {
  const app = loadApp({ notificationPermission: "denied" });
  app.goTo("progress");
  const btn = app.document.getElementById("notifyBtn");
  assert.equal(btn.disabled, true);
  assert.match(btn.textContent, /blocked/i);
});

/* ---------------- reordering a period's list ---------------- */

const dhikrLabels = (app, period) =>
  [...[...app.document.querySelectorAll("#dhikrBox .subcard")][period]
    .querySelectorAll(".chk .lbl")].map((e) => e.textContent);

test("the dhikr list can be reordered where you read it, not only in Settings", () => {
  const app = loadApp({});
  assert.equal(app.document.querySelectorAll("#dhikrBox .dhikr-move").length, 0,
    "the arrows only appear in reorder mode");

  app.click("dhikrReorderBtn");
  assert.ok(app.document.querySelectorAll("#dhikrBox .dhikr-move").length >= 21,
    "a pair on every row");
  // You cannot move an item past a row that isn't on screen.
  [...app.document.querySelectorAll("#dhikrBox .subcard")].forEach((c) =>
    assert.ok(!c.classList.contains("collapsed"), "every period is opened"));

  const before = dhikrLabels(app, 0);
  const rows = [...app.document.querySelectorAll("#dhikrBox .subcard")][0]
    .querySelectorAll(".chk");
  rows[0].querySelector(".dhikr-move button:last-child").click();   // ▼

  const after = dhikrLabels(app, 0);
  assert.equal(after[0], before[1]);
  assert.equal(after[1], before[0]);
});

test("reordering rides the synced profile, and never ticks the item off", () => {
  // The row is a <label> wrapping the checkbox, so a click inside it would
  // otherwise tick the item as well as moving it.
  const app = loadApp({});
  app.click("dhikrReorderBtn");
  // Nothing has been written yet on a fresh app, so there is no stored state.
  const before = (app.state() && app.state().profile.updated_at) || 0;

  [...app.document.querySelectorAll("#dhikrBox .subcard")][0]
    .querySelector(".chk .dhikr-move button:last-child").click();

  const s = app.state();
  assert.ok(s.profile.updated_at > before, "stamped, or the change never pushes");
  assert.ok(Array.isArray(s.profile.dhikr.morning), "the order lives on the profile");
  Object.values(s.days).forEach((d) => {
    Object.values(d.dhikr || {}).forEach((p) =>
      assert.deepEqual(Object.values(p).filter(Boolean), [], "nothing got ticked"));
  });
});

test("the first item cannot move up, nor the last down", () => {
  const app = loadApp({});
  app.click("dhikrReorderBtn");
  const before = dhikrLabels(app, 0);
  const rows = [...[...app.document.querySelectorAll("#dhikrBox .subcard")][0]
    .querySelectorAll(".chk")];
  rows[0].querySelector(".dhikr-move button:first-child").click();          // ▲
  rows[rows.length - 1].querySelector(".dhikr-move button:last-child").click();  // ▼
  assert.deepEqual(dhikrLabels(app, 0), before, "both are no-ops, not a wrap-around");
});

test("reorder is a mode, not a stored preference", () => {
  const app = loadApp({});
  app.click("dhikrReorderBtn");
  const stored = JSON.stringify(Object.entries(app.window.localStorage));
  assert.ok(!/dhikrReorder/.test(stored));
  app.click("dhikrReorderBtn");
  assert.equal(app.document.querySelectorAll("#dhikrBox .dhikr-move").length, 0);
});
