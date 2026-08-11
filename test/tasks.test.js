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
function moveButtons(app, index) {
  const rows = app.document.querySelectorAll("#taskList .task-row");
  return Array.from(rows[index].querySelectorAll(".task-move-btn"));
}

test("the move buttons only appear once you ask to reorder", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  assert.equal(app.document.querySelector("#taskList .task-move"), null, "rows stay uncluttered by default");

  app.click("taskReorderBtn");
  assert.equal(app.document.querySelectorAll("#taskList .task-move").length, 2);
  assert.equal(app.document.getElementById("taskReorderBtn").getAttribute("aria-pressed"), "true");

  app.click("taskReorderBtn");
  assert.equal(app.document.querySelector("#taskList .task-move"), null, "and the toggle turns them off again");
});

test("a task moves up and down, and the order is what the list then renders", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three"]);
  app.click("taskReorderBtn");
  assert.deepEqual(titles(app), ["One", "Two", "Three"]);

  moveButtons(app, 2)[0].click();                 // Three up
  assert.deepEqual(titles(app), ["One", "Three", "Two"]);

  moveButtons(app, 0)[1].click();                 // One down
  assert.deepEqual(titles(app), ["Three", "One", "Two"]);
});

test("the ends of the list cannot be moved off it", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  app.click("taskReorderBtn");
  assert.equal(moveButtons(app, 0)[0].disabled, true, "nothing above the first row");
  assert.equal(moveButtons(app, 1)[1].disabled, true, "nothing below the last");
});

test("a ticked task is its own block - a move never crosses the divide", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two"]);
  const cb = app.document.querySelectorAll("#taskList .task-row input[type=checkbox]")[0];
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  app.click("taskReorderBtn");
  assert.deepEqual(titles(app), ["Two", "One"], "ticked tasks still sink");

  assert.equal(moveButtons(app, 0)[1].disabled, true, "cannot push an open task into the done block");
  assert.equal(moveButtons(app, 1)[0].disabled, true, "nor pull a done one out of it");
});

test("reordering shows the whole list, not the three Today keeps", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three", "Four", "Five"]);
  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 3);

  app.click("taskReorderBtn");
  assert.equal(app.document.querySelectorAll("#taskList .task-row").length, 5,
    "you cannot move a task past a row that is not on screen");
});

test("a hand-picked order rides the synced profile and survives a reload", () => {
  const app = loadApp({ fetchImpl: briefIdle });
  addTasks(app, ["One", "Two", "Three"]);
  app.click("taskReorderBtn");
  const before = app.state().profile.updated_at;
  moveButtons(app, 2)[0].click();
  assert.ok(app.state().profile.updated_at >= before, "a move must stamp the profile or it never pushes");
  assert.deepEqual(app.state().profile.tasks.map((t) => typeof t.order), ["number", "number", "number"]);

  const again = loadApp({ fetchImpl: briefIdle, localStorageSeed: { [MAIN_KEY]: app.rawMain() } });
  assert.deepEqual(titles(again).slice(0, 3), ["One", "Three", "Two"]);
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
