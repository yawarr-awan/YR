"use strict";
/*
 * The Tasks board: a canvas of project columns, each holding its own tasks.
 *
 * Projects and tasks are their own synced rows rather than fields on the
 * profile blob. That matters twice over: the profile is pushed as one JSON
 * string the server silently drops above 20KB, and it merges as a whole, so
 * two devices editing different projects would lose one side's work.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, SCHEMA } = require("./lib.js");
after(closeAllApps);

const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

function openBoard(app) { app.goTo("tasks"); return app; }
const cols = (app) => [...app.document.querySelectorAll("#board .board-col")];
const colNamed = (app, name) => cols(app).find((c) => c.querySelector(".board-name").textContent === name);
const tasksIn = (col) => [...col.querySelectorAll(".btask")];
const titles = (col) => tasksIn(col).map((r) => r.querySelector(".btask-title").textContent);

function newProject(app, name) {
  app.click("projectAddBtn");
  if (name) {
    const col = cols(app)[cols(app).length - 1];
    app.window.prompt = () => name;
    col.querySelector(".board-name").click();
  }
  return colNamed(app, name || "New project");
}
function addTaskTo(app, col, title) {
  const input = col.querySelector(".board-add input");
  input.value = title;
  input.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
  return colNamed(app, col.querySelector(".board-name").textContent);
}
function openTaskMenu(app, col, title) {
  tasksIn(col).find((r) => r.querySelector(".btask-title").textContent === title)
    .querySelector(".btask-menu").click();
  return [...app.document.querySelectorAll(".menu-sheet button")];
}
const menuItem = (buttons, re) => buttons.find((b) => re.test(b.textContent));

/* ---------------- the tab ---------------- */

test("Tasks is the first tab, before Today", () => {
  const app = loadApp({ fetchImpl: idle });
  const labels = [...app.document.querySelectorAll("#tabs button")].map((b) => b.getAttribute("data-nav"));
  assert.equal(labels[0], "tasks");
  assert.equal(labels[1], "today");
});

test("the Today tab no longer carries a task card", () => {
  // Tasks live in one place now.
  const app = loadApp({ fetchImpl: idle });
  assert.equal(app.document.getElementById("taskCard"), null);
  assert.equal(app.document.getElementById("taskList"), null);
  assert.equal(app.document.querySelector('#view-today [data-card="tasks"]'), null);
});

/* ---------------- projects ---------------- */

test("a project can be added, renamed and given tasks", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  assert.equal(cols(app).length, 0, "nothing to begin with");

  const col = newProject(app, "House move");
  assert.ok(col, "the project appears as a column");
  addTaskTo(app, col, "Book the van");
  addTaskTo(app, colNamed(app, "House move"), "Cancel the broadband");

  assert.deepEqual(titles(colNamed(app, "House move")), ["Book the van", "Cancel the broadband"]);
  assert.match(colNamed(app, "House move").querySelector(".board-n").textContent, /2\/2/);
});

test("projects and their tasks are their own synced rows, stamped and un-deleted", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Work"), "Write the report");

  const s = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  assert.equal(s.schema, SCHEMA);
  const project = Object.values(s.projects)[0];
  const task = Object.values(s.tasks)[0];
  assert.equal(project.name, "Work");
  assert.equal(task.title, "Write the report");
  assert.equal(task.projectId, project.id);
  [project, task].forEach((it) => {
    assert.ok(it.updated_at > 0, "stamped, so it syncs");
    assert.equal(it.deleted, 0);
  });
  assert.ok(!s.profile.projects, "and none of it is on the profile blob");
});

test("ticking a task sinks it below the open ones", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const col = newProject(app, "Errands");
  ["First", "Second", "Third"].forEach((t) => addTaskTo(app, colNamed(app, "Errands"), t));

  tasksIn(colNamed(app, "Errands"))[0].querySelector("input[type=checkbox]").click();
  assert.deepEqual(titles(colNamed(app, "Errands")), ["Second", "Third", "First"]);
  assert.match(colNamed(app, "Errands").querySelector(".board-n").textContent, /2\/3/);
});

test("deleting a project takes its tasks with it, as tombstones rather than gaps", () => {
  // A row that simply disappeared would be pushed back by the next device
  // that still holds it.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Old"), "Something");
  app.window.confirm = () => true;

  colNamed(app, "Old").querySelector(".btask-menu").click();
  menuItem([...app.document.querySelectorAll(".menu-sheet button")], /Delete project/).click();

  assert.equal(cols(app).length, 0, "gone from the board");
  const s = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  assert.equal(Object.values(s.projects)[0].deleted, 1, "kept as a tombstone");
  assert.equal(Object.values(s.tasks)[0].deleted, 1, "and so are its tasks");
});

/* ---------------- the three-dot menu ---------------- */

test("Move to sends the task to another project and leaves nothing behind", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Inbox"), "Fix the tap");
  newProject(app, "House");

  menuItem(openTaskMenu(app, colNamed(app, "Inbox"), "Fix the tap"), /Move to/).click();
  menuItem([...app.document.querySelectorAll(".menu-sheet button")], /House/).click();

  assert.deepEqual(titles(colNamed(app, "Inbox")), []);
  assert.deepEqual(titles(colNamed(app, "House")), ["Fix the tap"]);
});

test("Duplicate to leaves the original and makes an independent copy", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Inbox"), "Call the bank");
  newProject(app, "Money");

  menuItem(openTaskMenu(app, colNamed(app, "Inbox"), "Call the bank"), /Duplicate to/).click();
  menuItem([...app.document.querySelectorAll(".menu-sheet button")], /Money/).click();

  assert.deepEqual(titles(colNamed(app, "Inbox")), ["Call the bank"], "the original stays");
  assert.deepEqual(titles(colNamed(app, "Money")), ["Call the bank"]);

  const live = Object.values(JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).tasks)
    .filter((t) => !t.deleted);
  assert.equal(live.length, 2);
  assert.notEqual(live[0].id, live[1].id, "two rows, so they diverge from here");
});

test("a duplicate never inherits the calendar event", () => {
  // Two tasks pointing at one Google event would fight over it.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "A"), "Dentist");
  newProject(app, "B");

  const s = app.state();
  const original = Object.values(s.tasks)[0];
  original.calendarEventId = "evt-1";
  original.scheduled = true;

  menuItem(openTaskMenu(app, colNamed(app, "A"), "Dentist"), /Duplicate to/).click();
  menuItem([...app.document.querySelectorAll(".menu-sheet button")], /^B$/).click();

  const copy = Object.values(app.state().tasks).find((t) => t.projectId !== original.projectId);
  assert.equal(copy.calendarEventId, null);
  assert.equal(copy.scheduled, false);
});

test("deleting one task leaves a tombstone and the rest alone", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const col = newProject(app, "List");
  ["Keep", "Drop"].forEach((t) => addTaskTo(app, colNamed(app, "List"), t));

  menuItem(openTaskMenu(app, colNamed(app, "List"), "Drop"), /^Delete$/).click();
  assert.deepEqual(titles(colNamed(app, "List")), ["Keep"]);
  const rows = Object.values(app.state().tasks);
  assert.equal(rows.filter((t) => t.deleted).length, 1);
  assert.equal(rows.filter((t) => !t.deleted).length, 1);
});

test("Move to says so when there is nowhere else to go", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Only"), "Alone");
  menuItem(openTaskMenu(app, colNamed(app, "Only"), "Alone"), /Move to/).click();
  assert.match(app.document.getElementById("boardCount").textContent, /nowhere else/i);
});

/* ---------------- migration ---------------- */

test("the old Today task list arrives as a General project", () => {
  const app = loadApp({
    fetchImpl: idle,
    localStorageSeed: { [MAIN_KEY]: JSON.stringify({
      schema: 4,
      profile: { startWeight: 108, targetWeight: 88, updated_at: 1,
        tasks: [
          { id: "a", title: "Bank statements for donations", done: false, order: 0, updated_at: 1 },
          { id: "b", title: "Do FX expenses", done: true, order: 1, updated_at: 1 },
        ] },
      days: {}, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
    }) },
  });
  openBoard(app);

  const col = colNamed(app, "General");
  assert.ok(col, "into a project of their own");
  assert.deepEqual(titles(col), ["Bank statements for donations", "Do FX expenses"],
    "done last, but both there");
  assert.match(col.querySelector(".board-n").textContent, /1\/2/);
  assert.deepEqual(app.state().profile.tasks.map((t) => t.title),
    ["Bank statements for donations", "Do FX expenses"],
    "the old list is kept as a backstop, not deleted");
});

test("the migration runs once, not on every load", () => {
  const seed = JSON.stringify({
    schema: 4,
    profile: { startWeight: 108, targetWeight: 88, updated_at: 1,
      tasks: [{ id: "a", title: "Only once", done: false, order: 0, updated_at: 1 }] },
    days: {}, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null },
  });
  const first = loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: seed } });
  const migrated = first.window.localStorage.getItem(MAIN_KEY);

  const second = loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: migrated } });
  openBoard(second);
  assert.deepEqual(titles(colNamed(second, "General")), ["Only once"], "not duplicated on reload");
});
