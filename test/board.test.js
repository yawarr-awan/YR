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

/* ---------------- the Workflow timeline ---------------- */

const wfCells = (app) => [...app.document.querySelectorAll("#wfGrid .wf-cell")];
const wfBars = (app) => [...app.document.querySelectorAll("#wfGrid .wf-bar")];
function openWorkflow(app) {
  app.goTo("tasks");
  app.document.querySelector('[data-tsub="workflow"]').click();
  return app;
}
function dayKeyFrom(offset) {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
/** A board with one project and the given tasks, seeded straight into state. */
function boardSeed(tasks) {
  const projects = { p1: { id: "p1", name: "House move", color: "", order: 0, updated_at: 1, deleted: 0 } };
  const out = {};
  tasks.forEach((t, i) => {
    const id = "t" + (i + 1);
    out[id] = Object.assign({ id, projectId: "p1", title: "Task " + (i + 1), done: false, order: i,
      due: null, start: null, end: null, calendarEventId: null, scheduled: false, noteId: null,
      updated_at: 1, deleted: 0 }, t);
  });
  return { [MAIN_KEY]: JSON.stringify({
    schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] },
    days: {}, projects, tasks: out,
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com",
  }) };
}

test("Workflow is a sub-tab of Tasks, not a ninth tab in the bar", () => {
  // Eight tabs already measure 48px each at 390px.
  const app = loadApp({ fetchImpl: idle });
  const bar = [...app.document.querySelectorAll("#tabs button")].map((b) => b.dataset.nav);
  assert.equal(bar.length, 8);
  assert.ok(!bar.includes("workflow"));

  openWorkflow(app);
  assert.ok(app.document.getElementById("tsub-workflow").classList.contains("active"));
  assert.ok(!app.document.getElementById("tsub-board").classList.contains("active"));
});

test("a task with a start and an end gets a bar spanning those days", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Book the van", start: dayKeyFrom(1), end: dayKeyFrom(3) }]) });
  openWorkflow(app);

  const bars = wfBars(app);
  assert.equal(bars.length, 1);
  assert.equal(bars[0].textContent, "Book the van");
  assert.match(bars[0].style.width, /3 \* var\(--wf-day\)/, "three days wide");
  assert.match(bars[0].title, /→/, "and says its span on hover");
});

test("a single-day task is one column wide", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Dentist", start: dayKeyFrom(2), end: dayKeyFrom(2) }]) });
  openWorkflow(app);
  assert.match(wfBars(app)[0].style.width, /1 \* var\(--wf-day\)/);
});

test("an overdue task reads differently from a finished one", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Late thing", start: dayKeyFrom(-3), end: dayKeyFrom(-1) },
    { title: "Done thing", start: dayKeyFrom(-3), end: dayKeyFrom(-1), done: true },
  ]) });
  openWorkflow(app);

  const late = wfBars(app).find((b) => b.textContent === "Late thing");
  const done = wfBars(app).find((b) => b.textContent === "Done thing");
  assert.ok(late.classList.contains("is-late"));
  assert.ok(!done.classList.contains("is-late"), "finished work is not overdue");
  assert.ok(done.classList.contains("is-done"));
});

test("undated tasks are listed separately so they can be given dates", () => {
  // A fresh board has no dates at all, so the timeline would otherwise be an
  // empty grid with no way in.
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "No dates yet" },
    { title: "Has dates", start: dayKeyFrom(0), end: dayKeyFrom(1) },
  ]) });
  openWorkflow(app);

  const rows = [...app.document.querySelectorAll("#wfUndated .wf-undated-row")];
  assert.equal(rows.length, 1);
  assert.match(rows[0].textContent, /No dates yet/);
  assert.match(rows[0].textContent, /House move/, "and says which project it is from");
  assert.equal(app.document.getElementById("wfUndatedCount").textContent, "1");
});

test("setting dates from the sheet plots the task", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([{ title: "Plot me" }]) });
  openWorkflow(app);
  assert.equal(wfBars(app).length, 0);

  app.document.querySelector("#wfUndated .wf-undated-row .btn").click();
  const inputs = [...app.document.querySelectorAll(".menu-sheet input[type=date]")];
  inputs[0].value = dayKeyFrom(1);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-sheet button")].find((b) => b.textContent === "Save").click();

  assert.equal(wfBars(app).length, 1);
  assert.equal(app.document.getElementById("wfUndatedCount").textContent, "0");
  const t = Object.values(app.state().tasks)[0];
  assert.equal(t.start, dayKeyFrom(1));
  assert.equal(t.end, dayKeyFrom(2));
  assert.ok(t.updated_at > 1, "stamped, so it syncs");
});

test("an end before a start is swapped rather than refused", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([{ title: "Backwards" }]) });
  openWorkflow(app);
  app.document.querySelector("#wfUndated .wf-undated-row .btn").click();
  const inputs = [...app.document.querySelectorAll(".menu-sheet input[type=date]")];
  inputs[0].value = dayKeyFrom(5);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-sheet button")].find((b) => b.textContent === "Save").click();

  const t = Object.values(app.state().tasks)[0];
  assert.equal(t.start, dayKeyFrom(2), "the earlier date is the start");
  assert.equal(t.end, dayKeyFrom(5));
});

test("paging moves the window a week at a time, and Today comes back", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "This week", start: dayKeyFrom(0), end: dayKeyFrom(1) }]) });
  openWorkflow(app);
  assert.equal(wfBars(app).length, 1);
  const label = () => app.document.getElementById("wfLabel").textContent;
  const first = label();

  app.click("wfNext");
  app.click("wfNext");
  assert.notEqual(label(), first, "the window moved");
  assert.equal(wfBars(app).length, 0, "and the task is behind us");

  app.click("wfToday");
  assert.equal(label(), first);
  assert.equal(wfBars(app).length, 1);
});

test("a span running past the window is clamped, not dropped", () => {
  // A bar that vanished when you paged would be worse than one visibly cut off.
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Long haul", start: dayKeyFrom(-40), end: dayKeyFrom(40) }]) });
  openWorkflow(app);
  assert.equal(wfBars(app).length, 1, "still on the timeline");
});

test("the board row shows the span, and the menu offers to change it", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Spanned", start: dayKeyFrom(1), end: dayKeyFrom(3) }]) });
  openBoard(app);

  const meta = app.document.querySelector(".btask .btask-meta").textContent;
  assert.match(meta, /→/, "start and end, not just one date");

  app.document.querySelector(".btask .btask-menu").click();
  const items = [...app.document.querySelectorAll(".menu-sheet button")].map((b) => b.textContent);
  assert.ok(items.some((t) => /Change dates/.test(t)), "already dated, so it offers a change");
});

test("the remembered sub-tab comes back", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: { yawarLastTaskSub: "workflow" } });
  app.goTo("tasks");
  assert.ok(app.document.getElementById("tsub-workflow").classList.contains("active"));
});
