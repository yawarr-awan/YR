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
