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
/* The same drag the board's task rows use: a grip, pointer events, and a drop
   above or below whichever row you release over. jsdom has no layout, so the
   two browser primitives a drag needs - elementFromPoint and
   getBoundingClientRect - are stubbed, the same way fetch is. Everything else
   is the app's own code path. */

const period = (app, i) => [...app.document.querySelectorAll("#dhikrBox .subcard")][i];
const dhikrLabels = (app, i) =>
  [...period(app, i).querySelectorAll(".chk .lbl")].map((e) => e.textContent);
const dhikrRow = (app, i, label) =>
  [...period(app, i).querySelectorAll(".chk")]
    .find((r) => r.querySelector(".lbl").textContent === label);

function pointer(app, type, y) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.clientX = 10; ev.clientY = y;
  return ev;
}
function dragDhikr(app, i, fromLabel, toLabel, before) {
  dhikrRow(app, i, fromLabel).querySelector(".drag-grip")
    .dispatchEvent(pointer(app, "pointerdown", 0));
  const dst = dhikrRow(app, i, toLabel);
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  app.document.dispatchEvent(pointer(app, "pointermove", before ? 110 : 130));
  app.document.dispatchEvent(pointer(app, "pointerup", before ? 110 : 130));
}

test("every dhikr row has a drag grip - sorting is not behind a mode", () => {
  const app = loadApp({});
  assert.equal(app.document.querySelectorAll("#dhikrBox .drag-grip").length, 21,
    "7 items x 3 periods");
  assert.equal(app.document.getElementById("dhikrReorderBtn"), null,
    "the arrow pair it replaced is gone");
});

test("dragging a dhikr item onto the top half of another drops it above", () => {
  const app = loadApp({});
  const before = dhikrLabels(app, 0);
  dragDhikr(app, 0, before[2], before[0], true);
  assert.deepEqual(dhikrLabels(app, 0).slice(0, 3), [before[2], before[0], before[1]]);
});

test("the bottom half drops it below, so either end of a row is reachable", () => {
  const app = loadApp({});
  const before = dhikrLabels(app, 0);
  dragDhikr(app, 0, before[0], before[2], false);
  assert.deepEqual(dhikrLabels(app, 0).slice(0, 3), [before[1], before[2], before[0]]);
});

test("each period is its own list - morning can't be dropped into evening", () => {
  const app = loadApp({});
  const morning = dhikrLabels(app, 0);
  const evening = dhikrLabels(app, 2);

  // The grip belongs to the morning list, so a row in the evening list is not
  // a drop target for it: the selector is scoped by data-droplist.
  dhikrRow(app, 0, morning[0]).querySelector(".drag-grip")
    .dispatchEvent(pointer(app, "pointerdown", 0));
  const dst = dhikrRow(app, 2, evening[2]);
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  app.document.dispatchEvent(pointer(app, "pointermove", 110));
  app.document.dispatchEvent(pointer(app, "pointerup", 110));

  assert.deepEqual(dhikrLabels(app, 0), morning, "morning is untouched");
  assert.deepEqual(dhikrLabels(app, 2), evening, "and so is evening");
});

test("reordering rides the synced profile, and never ticks the item off", () => {
  // The row is a <label> wrapping the checkbox, so a click inside it would
  // otherwise tick the item as well as moving it.
  const app = loadApp({});
  const before = (app.state() && app.state().profile.updated_at) || 0;
  const labels = dhikrLabels(app, 0);
  dragDhikr(app, 0, labels[1], labels[0], true);

  const s = app.state();
  assert.ok(s.profile.updated_at > before, "stamped, or the change never pushes");
  assert.ok(Array.isArray(s.profile.dhikr.morning), "the order lives on the profile");
  Object.values(s.days).forEach((d) => {
    Object.values(d.dhikr || {}).forEach((p) =>
      assert.deepEqual(Object.values(p).filter(Boolean), [], "nothing got ticked"));
  });
});

test("a drag that ends on nothing changes nothing", () => {
  const app = loadApp({});
  const before = dhikrLabels(app, 0);
  dhikrRow(app, 0, before[1]).querySelector(".drag-grip")
    .dispatchEvent(pointer(app, "pointerdown", 0));
  app.document.elementFromPoint = () => null;
  app.document.dispatchEvent(pointer(app, "pointermove", 110));
  app.document.dispatchEvent(pointer(app, "pointerup", 110));
  assert.deepEqual(dhikrLabels(app, 0), before);
});
