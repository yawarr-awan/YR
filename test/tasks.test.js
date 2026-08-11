"use strict";
/*
 * Task list coverage. Adding a task never asks for a time - a task is just
 * a task until you deliberately schedule it with the 📅 button on its row,
 * which opens an inline date picker and POSTs to
 * /api/google/calendar/events. The Today tab shows only the top few; the
 * Calendar tab holds the full list. Real index.html, real DOM, network
 * boundary mocked.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY } = require("./lib.js");
after(closeAllApps);

function jsonRes(body) { return { ok: true, status: 200, json: async () => body }; }
const briefIdle = async () => jsonRes({ connected: false, status: "not_connected" });

function addTasks(app, titles, inputId = "taskTitleIn", btnId = "taskAddBtn") {
  titles.forEach((title) => {
    app.setInput(inputId, title);
    app.click(btnId);
  });
}

function schedButton(app, listId, index = 0) {
  const rows = app.document.querySelectorAll("#" + listId + " .task-row");
  return Array.from(rows[index].querySelectorAll("button")).find((b) => b.textContent === "📅");
}

test("adding a task takes only a title - there is no time field on the add form", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  assert.equal(app.document.getElementById("taskWhenIn"), null, "the datetime input must be gone from the add row");

  addTasks(app, ["Water the plants"]);
  assert.match(app.document.getElementById("taskList").textContent, /Water the plants/);
  assert.equal(app.state().profile.tasks[0].due, null, "a new task carries no due time");
});

test("every task row has a calendar button, whether or not it has a time yet", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["Pay rent"]);
  assert.ok(schedButton(app, "taskList"), "expected a 📅 button on the row itself");
});

test("the calendar button opens an inline time picker; confirming schedules it and stores the time", async () => {
  let sentBody = null;
  const app = loadApp({
    fetchImpl: async (url, opts) => {
      if (String(url).includes("/api/google/calendar/events")) {
        sentBody = JSON.parse(opts.body);
        return jsonRes({ status: "ok", eventId: "evt1" });
      }
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  addTasks(app, ["Dentist"]);

  assert.equal(app.document.querySelector("#taskList .task-sched"), null, "picker stays closed until asked for");
  schedButton(app, "taskList").click();

  const panel = app.document.querySelector("#taskList .task-sched");
  assert.ok(panel, "expected an inline scheduling panel");
  const when = panel.querySelector("input[type=datetime-local]");
  assert.ok(when.value, "the picker should be pre-filled with a sensible default time");
  when.value = "2026-08-10T09:00";
  Array.from(panel.querySelectorAll("button")).find((b) => /add to calendar/i.test(b.textContent)).click();
  await app.flush();

  assert.equal(sentBody.title, "Dentist");
  assert.equal(new Date(sentBody.start).getTime(), new Date("2026-08-10T09:00").getTime());
  assert.match(app.document.getElementById("taskStatus").textContent, /added to your google calendar/i);
  assert.match(app.document.getElementById("taskList").textContent, /on calendar/i);
  assert.equal(app.state().profile.tasks[0].scheduled, true);
  assert.ok(app.state().profile.tasks[0].due, "the chosen time is stored on the task");
});

test("a schedule attempt that needs reconnecting says so, and leaves the task unscheduled", async () => {
  const app = loadApp({
    fetchImpl: async (url) => {
      if (String(url).includes("/api/google/calendar/events")) return jsonRes({ status: "reconnect_required" });
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  addTasks(app, ["Dentist"]);
  schedButton(app, "taskList").click();
  const panel = app.document.querySelector("#taskList .task-sched");
  panel.querySelector("input[type=datetime-local]").value = "2026-08-10T09:00";
  Array.from(panel.querySelectorAll("button")).find((b) => /add to calendar/i.test(b.textContent)).click();
  await app.flush();

  assert.match(app.document.getElementById("taskStatus").textContent, /connect google calendar/i);
  assert.equal(app.state().profile.tasks[0].scheduled, false);
});

test("checking a task marks it done and persists; deleting removes it from storage", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["Buy groceries"]);

  const cb = app.document.getElementById("taskList").querySelector("input[type=checkbox]");
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.ok(app.document.getElementById("taskList").querySelector(".task-row").classList.contains("done"));
  assert.equal(app.state().profile.tasks[0].done, true);

  app.document.getElementById("taskList").querySelector("button.icon-btn.danger").click();
  assert.doesNotMatch(app.document.getElementById("taskList").textContent, /Buy groceries/);
  assert.equal(app.state().profile.tasks.length, 0);
});

function moreButton(app) {
  return Array.from(app.document.querySelectorAll("#taskList button")).find((b) => b.classList.contains("task-more"));
}

test("Today shows only the top three tasks by default", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three", "Four", "Five"]);

  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 3, "Today is a dashboard, not the whole backlog");
  assert.match(moreButton(app).textContent, /\+2 more/i);
  assert.equal(app.state().profile.tasks.length, 5, "the other two still exist, they're just not shown yet");
});

test("tapping '+N more' expands the full list in place on the Today tab, and folds back again", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three", "Four", "Five"]);

  moreButton(app).click();
  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 5, "all of them, still on Today");
  assert.match(app.document.getElementById("taskList").textContent, /Five/);
  assert.match(moreButton(app).textContent, /show fewer/i);

  moreButton(app).click();
  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 3);
  assert.match(moreButton(app).textContent, /\+2 more/i);
});

test("with three or fewer tasks there is nothing to expand", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  assert.equal(moreButton(app), undefined);
});

test("an expanded list stays expanded while you work in it", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three", "Four", "Five"]);
  moreButton(app).click();

  const cb = app.document.querySelectorAll("#taskList .task-row input[type=checkbox]")[4];
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 5, "ticking a task must not re-collapse the list");
});

/* --- rearranging ---------------------------------------------------------
 * Ordering a task list by due date is a rule; moving a row by hand is an
 * instruction. The instruction has to win, and it has to survive a reload,
 * which means the position rides the synced profile like the rest of a task.
 */
function titles(app) {
  return Array.from(app.document.querySelectorAll("#taskList .task-row .task-title")).map((n) => n.textContent);
}


/* jsdom has no layout, so the two browser primitives a drag depends on -
 * elementFromPoint and getBoundingClientRect - are stubbed, the same way
 * fetch is. Everything else is the app's own code path: a real pointerdown
 * on the grip, pointermove over a row, pointerup. The drag was also checked
 * end to end in Chromium, where those primitives are real. */
function row(app, title) {
  return Array.from(app.document.querySelectorAll("#taskList .task-row"))
    .find((r) => r.querySelector(".task-title").textContent === title);
}
function pointer(app, type, y) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.clientX = 10;
  ev.clientY = y;
  return ev;
}
function drag(app, fromTitle, toTitle, before) {
  const src = row(app, fromTitle);
  src.querySelector(".task-grip").dispatchEvent(pointer(app, "pointerdown", 0));
  const dst = row(app, toTitle);           // re-read: grabbing may have expanded the list
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  app.document.dispatchEvent(pointer(app, "pointermove", before ? 110 : 130));
  app.document.dispatchEvent(pointer(app, "pointerup", before ? 110 : 130));
}

test("every row has a drag grip - reordering is not behind a mode", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  assert.equal(app.document.querySelectorAll("#taskList .task-grip").length, 2);
});

test("dragging a task onto the top half of another drops it above", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three"]);
  assert.deepEqual(titles(app), ["One", "Two", "Three"]);

  drag(app, "Three", "One", true);
  assert.deepEqual(titles(app), ["Three", "One", "Two"]);
});

test("the bottom half drops it below, so either end of a row is reachable", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three"]);
  drag(app, "One", "Two", false);
  assert.deepEqual(titles(app), ["Two", "One", "Three"]);
});

test("a drag is an insertion, not a swap - the rows between shuffle up", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three", "Four"]);
  drag(app, "One", "Four", false);
  assert.deepEqual(titles(app), ["Two", "Three", "Four", "One"]);
});

test("a ticked task keeps its own block however it is dropped", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  const cb = app.document.querySelectorAll("#taskList .task-row input[type=checkbox]")[0];
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.deepEqual(titles(app), ["Two", "One"], "ticked tasks sink");

  drag(app, "Two", "One", false);
  assert.deepEqual(titles(app), ["Two", "One"], "an open task cannot be dropped below a done one");
});

test("a drag that ends on nothing changes nothing", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  const src = row(app, "Two");
  src.querySelector(".task-grip").dispatchEvent(pointer(app, "pointerdown", 0));
  app.document.elementFromPoint = () => null;
  app.document.dispatchEvent(pointer(app, "pointermove", 500));
  app.document.dispatchEvent(pointer(app, "pointerup", 500));
  assert.deepEqual(titles(app), ["One", "Two"]);
  assert.equal(app.document.querySelector("#taskList .task-row.is-dragging"), null, "and the row stops looking dragged");
});

test("grabbing a grip opens a collapsed list, so there is somewhere to drop", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three", "Four", "Five"]);
  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 3);

  app.document.querySelector("#taskList .task-grip")
    .dispatchEvent(pointer(app, "pointerdown", 0));
  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 5,
    "you cannot drop onto a row that is not on screen");
});

test("a hand-picked order rides the synced profile and survives a reload", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three"]);
  const before = app.state().profile.updated_at;
  drag(app, "Three", "One", true);
  assert.ok(app.state().profile.updated_at >= before, "a move must stamp the profile or it never pushes");
  assert.deepEqual(app.state().profile.tasks.map((t) => typeof t.order), ["number", "number", "number"]);

  const again = loadApp({ fetchImpl: briefIdle, localStorageSeed: { [MAIN_KEY]: app.rawMain() } });
  assert.deepEqual(titles(again).slice(0, 3), ["Three", "One", "Two"]);
});

test("tasks saved before ordering existed keep the order they were showing in", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["Later", "Sooner"]);
  const raw = JSON.parse(app.rawMain());
  raw.profile.tasks.forEach((t) => { delete t.order; });
  raw.profile.tasks[0].due = "2030-02-02T09:00:00.000Z";
  raw.profile.tasks[1].due = "2030-01-01T09:00:00.000Z";

  const again = loadApp({ fetchImpl: briefIdle, localStorageSeed: { [MAIN_KEY]: JSON.stringify(raw) } });
  assert.deepEqual(titles(again), ["Sooner", "Later"], "the due-date order they already had");
});
