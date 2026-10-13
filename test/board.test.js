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
  return [...app.document.querySelectorAll(".menu-pop button")];
}
const menuItem = (buttons, re) => buttons.find((b) => re.test(b.textContent));

/* The board's own toolbar is gone: zoom lives in the header ⋮ menu now, and
   the percentage is on the viewport rather than in a label. */
const zoomOf = (app) => parseInt(app.document.getElementById("canvasViewport").getAttribute("data-zoom"), 10);
function headerMenu(app) {
  app.click("headerMenuBtn");
  return [...app.document.querySelectorAll(".menu-pop button")];
}
/* ctrl+wheel is the desktop pinch. The menu's zoom rows are gone: the fingers
   and the trackpad already do it better than two more menu items. */
function wheelZoom(app, dir) {
  const ev = new app.window.Event("wheel", { bubbles: true, cancelable: true });
  ev.ctrlKey = true; ev.deltaY = dir * 100; ev.clientX = 100; ev.clientY = 100;
  app.document.getElementById("canvasViewport").dispatchEvent(ev);
}
function headerMenuDo(app, re) {
  const b = menuItem(headerMenu(app), re);
  assert.ok(b, "no header menu item matching " + re);
  b.click();
}

/* ---------------- the tab ---------------- */

test("Tasks and Workflow are the first two tabs, before Today", () => {
  const app = loadApp({ fetchImpl: idle });
  const labels = [...app.document.querySelectorAll("#tabs button")].map((b) => b.getAttribute("data-nav"));
  assert.equal(labels[0], "tasks");
  assert.equal(labels[1], "workflow");
  assert.equal(labels[2], "today");
  assert.equal(labels.includes("settings"), false, "Settings lives in the header menu now");
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

const doneToggle = (col) => col.querySelector(".board-done-toggle");

test("ticking a task folds it away under Show completed", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Errands");
  ["First", "Second", "Third"].forEach((t) => addTaskTo(app, colNamed(app, "Errands"), t));
  assert.equal(doneToggle(colNamed(app, "Errands")), null, "nothing done, nothing to show");

  tasksIn(colNamed(app, "Errands"))[0].querySelector("input[type=checkbox]").click();
  assert.deepEqual(titles(colNamed(app, "Errands")), ["Second", "Third"], "gone from the list at once");
  assert.equal(doneToggle(colNamed(app, "Errands")).textContent, "Show completed (1)");
  assert.match(colNamed(app, "Errands").querySelector(".board-n").textContent, /2\/3/);

  doneToggle(colNamed(app, "Errands")).click();
  assert.deepEqual(titles(colNamed(app, "Errands")), ["Second", "Third", "First"], "shown below the open ones");
  assert.equal(doneToggle(colNamed(app, "Errands")).textContent, "Hide completed (1)");
  assert.equal(doneToggle(colNamed(app, "Errands")).getAttribute("aria-expanded"), "true");

  // Open stays open while you keep ticking: the next one joins the shown list.
  tasksIn(colNamed(app, "Errands"))[0].querySelector("input[type=checkbox]").click();
  assert.deepEqual(titles(colNamed(app, "Errands")), ["Third", "First", "Second"]);
  assert.equal(doneToggle(colNamed(app, "Errands")).textContent, "Hide completed (2)");

  // Unticking a shown one brings it back to the open list.
  tasksIn(colNamed(app, "Errands"))[1].querySelector("input[type=checkbox]").click();
  assert.deepEqual(titles(colNamed(app, "Errands")).slice(0, 2).sort(), ["First", "Third"]);

  doneToggle(colNamed(app, "Errands")).click();
  assert.deepEqual(titles(colNamed(app, "Errands")).sort(), ["First", "Third"], "folded again");
});

test("Show completed is per card, and folded again after a reload", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "A"); addTaskTo(app, colNamed(app, "A"), "A1");
  newProject(app, "B"); addTaskTo(app, colNamed(app, "B"), "B1");
  tasksIn(colNamed(app, "A"))[0].querySelector("input[type=checkbox]").click();
  tasksIn(colNamed(app, "B"))[0].querySelector("input[type=checkbox]").click();
  assert.equal(colNamed(app, "A").querySelector(".board-empty").textContent, "All done.");

  doneToggle(colNamed(app, "A")).click();
  assert.deepEqual(titles(colNamed(app, "A")), ["A1"]);
  assert.deepEqual(titles(colNamed(app, "B")), [], "the other card stays folded");

  const again = openBoard(loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: app.window.localStorage.getItem(MAIN_KEY) } }));
  assert.deepEqual(titles(colNamed(again, "A")), [], "a view of the moment, not a stored preference");
  assert.equal(doneToggle(colNamed(again, "A")).textContent, "Show completed (1)");
});

test("Mark as done from the menu folds the task away too", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "P"); addTaskTo(app, colNamed(app, "P"), "Keep"); addTaskTo(app, colNamed(app, "P"), "Finish");
  menuItem(openTaskMenu(app, colNamed(app, "P"), "Finish"), /Mark as done/).click();
  assert.deepEqual(titles(colNamed(app, "P")), ["Keep"]);
  assert.equal(doneToggle(colNamed(app, "P")).textContent, "Show completed (1)");
});

test("deleting a project takes its tasks with it, as tombstones rather than gaps", () => {
  // A row that simply disappeared would be pushed back by the next device
  // that still holds it.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Old"), "Something");
  app.window.confirm = () => true;

  colNamed(app, "Old").querySelector(".btask-menu").click();
  menuItem([...app.document.querySelectorAll(".menu-pop button")], /Delete project/).click();

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
  menuItem([...app.document.querySelectorAll(".menu-pop button")], /House/).click();

  assert.deepEqual(titles(colNamed(app, "Inbox")), []);
  assert.deepEqual(titles(colNamed(app, "House")), ["Fix the tap"]);
});

test("Duplicate to leaves the original and makes an independent copy", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "Inbox"), "Call the bank");
  newProject(app, "Money");

  menuItem(openTaskMenu(app, colNamed(app, "Inbox"), "Call the bank"), /Duplicate to/).click();
  menuItem([...app.document.querySelectorAll(".menu-pop button")], /Money/).click();

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
  menuItem([...app.document.querySelectorAll(".menu-pop button")], /^B$/).click();

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
  // The board has no status line of its own now; it uses the app status bar.
  assert.match(app.statusText(), /nowhere else/i);
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
  assert.deepEqual(titles(col), ["Bank statements for donations"], "the open one on show");
  assert.equal(col.querySelector(".board-done-toggle").textContent, "Show completed (1)", "the done one folded away");
  col.querySelector(".board-done-toggle").click();
  assert.deepEqual(titles(colNamed(app, "General")), ["Bank statements for donations", "Do FX expenses"],
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

/* ---------------- the Workflow tab ---------------- */

/* The tab is the Planner since 1.51.0; its own behaviour is covered in
   test/planner.test.js. What stays here is how the board reaches it. */
const plannerBar = (app, id) => app.document.querySelector('#wfp .gantt-bar[data-id="' + id + '"]');
function openWorkflow(app) {
  app.goTo("workflow");
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

test("Workflow is its own tab, beside Tasks rather than inside it", () => {
  // The board and the timeline are two ways of working, not two views of one
  // screen - and the sub-tab row cost a line of height on both. It fits
  // because Settings gave up its slot; eight tabs still measure 48px each at
  // 390px, which is the floor for a tappable label.
  const app = loadApp({ fetchImpl: idle });
  const bar = [...app.document.querySelectorAll("#tabs button")].map((b) => b.dataset.nav);
  assert.equal(bar.length, 8);
  assert.ok(bar.includes("workflow"));
  assert.equal(app.document.getElementById("taskSubTabs"), null, "no sub-tab row left");

  openWorkflow(app);
  assert.ok(app.document.getElementById("view-workflow").classList.contains("active"));
  assert.ok(!app.document.getElementById("view-tasks").classList.contains("active"));
});

test("giving a task dates from the board's menu puts it on the Workflow chart", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([{ title: "Plot me" }]) });
  openWorkflow(app);
  assert.equal(plannerBar(app, "t1"), null);
  openBoard(app);
  menuItem(openTaskMenu(app, cols(app)[0], "Plot me"), /Add to the workflow/).click();
  const inputs = [...app.document.querySelectorAll(".menu-pop input[type=date]")];
  inputs[0].value = dayKeyFrom(1);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-pop button")].find((b) => b.textContent === "Save").click();

  const t = Object.values(app.state().tasks)[0];
  assert.equal(t.start, dayKeyFrom(1));
  assert.equal(t.end, dayKeyFrom(2));
  assert.ok(t.updated_at > 1, "stamped, so it syncs");
  openWorkflow(app);
  assert.ok(plannerBar(app, "t1"), "and the Workflow chart draws it");
});

test("an end before a start is swapped rather than refused", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([{ title: "Backwards" }]) });
  openBoard(app);
  menuItem(openTaskMenu(app, cols(app)[0], "Backwards"), /Add to the workflow/).click();
  const inputs = [...app.document.querySelectorAll(".menu-pop input[type=date]")];
  inputs[0].value = dayKeyFrom(5);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-pop button")].find((b) => b.textContent === "Save").click();

  const t = Object.values(app.state().tasks)[0];
  assert.equal(t.start, dayKeyFrom(2), "the earlier date is the start");
  assert.equal(t.end, dayKeyFrom(5));
});

test("a dated task's title on the board opens the Workflow tab", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Spanned", start: dayKeyFrom(1), end: dayKeyFrom(3) }]) });
  openBoard(app);
  app.document.querySelector(".btask .btask-wf").click();
  assert.equal(app.document.querySelector(".view.active").id, "view-workflow");
  assert.ok(plannerBar(app, "t1"), "with the task on the chart");
});

test("the board row shows the span, and the menu offers to change it", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Spanned", start: dayKeyFrom(1), end: dayKeyFrom(3) }]) });
  openBoard(app);

  const meta = app.document.querySelector(".btask .btask-meta").textContent;
  assert.match(meta, /→/, "start and end, not just one date");

  app.document.querySelector(".btask .btask-menu").click();
  const items = [...app.document.querySelectorAll(".menu-pop button")].map((b) => b.textContent);
  // Named for what it does - giving a task a span is putting it on the
  // workflow, which "Set dates…" never said.
  assert.ok(items.some((t) => /Change workflow dates/.test(t)),
    "already dated, so it offers a change");
  assert.equal(items.some((t) => /Add to the workflow/.test(t)), false);
});

test("a device that remembers the old Workflow sub-tab lands on the new tab", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: { yawarLastTaskSub: "workflow", yawarLastTab: "tasks" } });
  assert.equal(app.document.querySelector(".view.active").id, "view-workflow");
});

/* ---------------- the canvas ---------------- */

const viewport = (app) => app.document.getElementById("canvasViewport");
const plane = (app) => app.document.getElementById("board");
/* pointerType matters: a card only drags straight away under a mouse. With a
   finger it has to be held first (see the hold tests below), so a synthetic
   event with no type at all would silently take the wrong path. */
function pointer(app, type, id, x, y, target, pointerType) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.pointerId = id; ev.clientX = x; ev.clientY = y;
  ev.pointerType = pointerType || "mouse";
  (target || viewport(app)).dispatchEvent(ev);
  return ev;
}
function touch(app, type, id, x, y, target) {
  return pointer(app, type, id, x, y, target, "touch");
}

/* The board lays its cards out for the screen (1.52.0): columns that fill
   the width, top-left anchored, scrolling down only. jsdom has no layout, so
   the app falls back to the window's size and to an estimated card height -
   which is what these numbers come from: a 390px window is a 362px board, one
   column 338px wide at 100%, and a card with no tasks is 140px tall. */
const cardBox = (col) => ({ x: parseFloat(col.style.left), y: parseFloat(col.style.top), w: parseFloat(col.style.width) });
const colsOf = (app) => Number(viewport(app).getAttribute("data-cols"));
const orderOf = (app) => cols(app).map((c) => c.querySelector(".board-name").textContent);
function boardWith(names, opts) {
  const projects = {};
  names.forEach((n, i) => { projects["p" + i] = { id: "p" + i, name: n, color: "", order: i, updated_at: 1, deleted: 0 }; });
  return openBoard(loadApp(Object.assign({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: JSON.stringify({
    schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] }, days: {},
    projects, tasks: {}, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com",
  }) } }, opts || {})));
}
/** Drag a card by its header from one screen point to another. */
function dragCard(app, name, from, to, pointerType) {
  const head = colNamed(app, name).querySelector(".board-col-head");
  pointer(app, "pointerdown", 1, from[0], from[1], head, pointerType);
  pointer(app, "pointermove", 1, to[0], to[1], app.document, pointerType);
  pointer(app, "pointerup", 1, to[0], to[1], app.document, pointerType);
}

test("on a phone the cards fill the width in one column, one under another", () => {
  const app = boardWith(["One", "Two"]);
  const [a, b] = cols(app);
  assert.equal(colsOf(app), 1);
  assert.equal(cardBox(a).x, 12, "pinned to the left edge");
  assert.equal(cardBox(a).y, 12, "and to the top");
  assert.equal(cardBox(b).x, 12);
  assert.ok(cardBox(b).y > cardBox(a).y + 100, "the next card sits under the first");
  assert.equal(cardBox(a).w, 338, "as wide as the screen allows");
  assert.equal(app.window.getComputedStyle(a).position, "absolute");
});

test("on a laptop as many columns fit as the width allows, filling it edge to edge", () => {
  const app = boardWith(["A", "B", "C", "D", "E"], { innerWidth: 1280 });
  assert.equal(colsOf(app), 4);
  const boxes = cols(app).map(cardBox);
  assert.deepEqual(boxes.slice(0, 4).map((b) => b.y), [12, 12, 12, 12], "the first row reads across, in order");
  assert.ok(boxes[0].x < boxes[1].x && boxes[1].x < boxes[2].x && boxes[2].x < boxes[3].x);
  const right = boxes[3].x + boxes[3].w + 12;
  assert.ok(Math.abs(right - 1252) < 1, "the last column ends at the right edge, got " + right);
  assert.equal(boxes[4].x, boxes[0].x, "and the fifth card starts the next row");
  assert.ok(boxes[4].y > 12);
});

test("old hand-placed positions are ignored, not rewritten", () => {
  // A free-canvas board stored x/y on each project. The layout reads none of
  // it, and leaves the rows alone - nothing is restamped or pushed for it.
  const seed = {
    schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] }, days: {},
    projects: { p1: { id: "p1", name: "Old", color: "", order: 0, x: 900, y: -400, w: 500, h: 700, z: 3, updated_at: 1, deleted: 0 } },
    tasks: {}, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com",
  };
  const app = openBoard(loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) } }));
  const box = cardBox(cols(app)[0]);
  assert.equal(box.x, 12);
  assert.equal(box.y, 12);
  assert.equal(cols(app)[0].style.height, "", "as tall as its tasks, not a stored height");
  assert.equal(app.state().projects.p1.updated_at, 1, "the row is not touched");
  const fresh = newProject(app, "New");
  assert.ok(fresh);
  const made = Object.values(app.state().projects).find((p) => p.name === "New");
  assert.equal(made.x, undefined, "and a new project carries no position at all");
});

test("dragging a card by its header gives it another place in the order", () => {
  const app = boardWith(["First", "Second", "Third"]);
  // One column: First at y 12, Second at 168, Third at 324 (140px cards).
  dragCard(app, "Third", [100, 330], [100, 40]);
  assert.deepEqual(orderOf(app), ["Third", "First", "Second"], "dropped on the first slot, it takes it");
  const ps = app.state().projects;
  assert.deepEqual([ps.p2.order, ps.p0.order, ps.p1.order], [0, 1, 2]);
  assert.ok(ps.p2.updated_at > 1, "stamped, so the new order syncs");
  assert.equal(cardBox(colNamed(app, "Third")).y, 12, "and the layout follows it");

  dragCard(app, "Third", [100, 20], [100, 340]);
  assert.deepEqual(orderOf(app), ["First", "Second", "Third"], "dragged down past the others, it goes after");
});

test("the order a card is dragged into is the order the Workflow planner lists", () => {
  const app = boardWith(["First", "Second"]);
  app.state().tasks = app.state().tasks;   // nothing to seed beyond the projects
  dragCard(app, "Second", [100, 174], [100, 20]);
  const ps = app.state().projects;
  assert.ok(ps.p1.order < ps.p0.order, "one order, shared by both tabs");
});

test("a card is as tall as its tasks: no resize corner, and nothing scrolls inside it", () => {
  // One scroll - the board's - is what a swipe anywhere on a card should move.
  const app = boardWith(["Tall"]);
  addTaskTo(app, colNamed(app, "Tall"), "One");
  addTaskTo(app, colNamed(app, "Tall"), "Two");
  assert.equal(app.document.querySelector(".card-resize"), null);
  const css = app.document.querySelector("style").textContent;
  assert.match(css, /\.board-tasks\{flex:none;/);
  assert.doesNotMatch(css.match(/\.board-tasks\{[^}]*\}/)[0], /overflow-y:auto/);
});

test("a tap that doesn't move the card doesn't rewrite it", () => {
  // Otherwise every tap on a heading would push a sync.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Still");
  const before = Object.values(app.state().projects)[0].updated_at;

  const head = cols(app)[0].querySelector(".board-col-head");
  pointer(app, "pointerdown", 1, 100, 100, head);
  pointer(app, "pointerup", 1, 101, 100, app.document);
  assert.equal(Object.values(app.state().projects)[0].updated_at, before);
});

test("zoomed out, a drop still lands on the card under the pointer", () => {
  // Screen pixels are canvas pixels times the zoom - get this wrong and a
  // drop lands a card or two away from where the finger let go.
  const app = boardWith(["A", "B", "C"], { innerWidth: 1280 });
  for (let i = 0; i < 4; i++) wheelZoom(app, 1);
  const z = zoomOf(app) / 100;
  assert.ok(z < 1, "zoomed out");
  assert.ok(colsOf(app) > 4, "so more columns fit");
  const c = cardBox(colNamed(app, "C"));
  dragCard(app, "A", [20, 20], [(c.x + 20) * z, (c.y + 20) * z]);
  assert.deepEqual(orderOf(app), ["B", "C", "A"]);
});

test("zoom is clamped, shown, and remembered per device rather than synced", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Anything");   // so there is a saved store to inspect
  assert.equal(zoomOf(app), 100);

  for (let i = 0; i < 20; i++) wheelZoom(app, -1);
  assert.ok(zoomOf(app) <= 250, "there is a ceiling");
  for (let i = 0; i < 40; i++) wheelZoom(app, 1);
  assert.ok(zoomOf(app) >= 35, "and a floor");

  assert.ok(app.window.localStorage.getItem("yawarBoardView"), "kept per device");
  assert.ok(!JSON.stringify(app.state()).includes("yawarBoardView"));
  assert.equal(app.state().zoom, undefined, "the view is not part of the synced record");
});

test("dragging the board scrolls it down - never sideways - and stops at both ends", () => {
  const app = boardWith(["1", "2", "3", "4", "5", "6", "7", "8"]);
  pointer(app, "pointerdown", 1, 200, 400);
  pointer(app, "pointermove", 1, 260, 200);
  pointer(app, "pointerup", 1, 260, 200);
  assert.match(plane(app).style.transform, /^translate\(0px, ?-200px\) scale\(1\)$/, "down by the drag, not across");

  pointer(app, "pointerdown", 1, 200, 100);
  pointer(app, "pointermove", 1, 200, 2000);
  pointer(app, "pointerup", 1, 200, 2000);
  assert.match(plane(app).style.transform, /^translate\(0px, ?0px\)/, "the top is fixed: no pulling past it");

  pointer(app, "pointerdown", 1, 200, 2000);
  pointer(app, "pointermove", 1, 200, -5000);
  pointer(app, "pointerup", 1, 200, -5000);
  const y = parseFloat(plane(app).style.transform.match(/, ?(-?[\d.]+)px\)/)[1]);
  const last = cardBox(cols(app)[7]);
  // 568 is the fallback viewport height on jsdom's 768px window.
  assert.ok(Math.abs(y - (568 - (last.y + 140 + 12))) < 1, "and the bottom stops at the last card, got " + y);
});

test("a press that does not move is not a scroll, so the button under it still works", () => {
  const app = boardWith(["Tap my menu"]);
  pointer(app, "pointerdown", 1, 200, 30, colNamed(app, "Tap my menu").querySelector(".btask-menu"), "touch");
  pointer(app, "pointerup", 1, 200, 31, app.document, "touch");
  colNamed(app, "Tap my menu").querySelector(".btask-menu").click();
  assert.ok(app.document.querySelector(".menu-pop"), "the menu opened");
});

test("a second finger pinches instead of scrolling", () => {
  const app = boardWith(["Pinch me", "And me"], { innerWidth: 1280 });
  assert.equal(zoomOf(app), 100);
  const before = colsOf(app);

  pointer(app, "pointerdown", 1, 100, 300);
  pointer(app, "pointerdown", 2, 200, 300);   // 100px apart
  pointer(app, "pointermove", 1, 50, 300);
  pointer(app, "pointermove", 2, 250, 300);   // now 200px apart
  pointer(app, "pointerup", 1, 50, 300);
  pointer(app, "pointerup", 2, 250, 300);

  assert.ok(zoomOf(app) > 150, "spreading two fingers zoomed in, got " + zoomOf(app));
  assert.ok(colsOf(app) < before, "and the bigger cards are fewer to a row");
});

test("zooming in stops once one card fills the screen", () => {
  // A phone: the width is what runs out first, so the ceiling is one card
  // across - and from there the cards are simply one under another.
  const phone = boardWith(["A", "B", "C"]);
  for (let i = 0; i < 30; i++) wheelZoom(phone, -1);
  const zp = zoomOf(phone) / 100;
  assert.ok(zp > 1.2 && zp < 1.3, "about 127%, got " + zp);
  assert.equal(colsOf(phone), 1);
  assert.ok(cardBox(cols(phone)[0]).w * zp <= 362, "the card is no wider than the screen");

  // A laptop: there the height runs out first - one card, 300 tall, fits.
  const laptop = boardWith(["A", "B", "C"], { innerWidth: 1280 });
  for (let i = 0; i < 30; i++) wheelZoom(laptop, -1);
  const zl = zoomOf(laptop) / 100;
  assert.ok(Math.abs(zl - 568 / 324) < 0.02, "a card's height fits the screen, got " + zl);
  assert.ok(300 * zl <= 568);
});

test("the canvas keeps its own gestures, so a pan never changes tab", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("tasks");
  app.swipe("canvasViewport", -160, 0);
  assert.equal(app.document.querySelector(".view.active").id, "view-tasks");
});

test("scrolling the Workflow chart sideways never changes tab either", () => {
  // The Gantt is a long horizontal scroll; a drag along it is a scroll
  // through the days, not a request for the next tab.
  const app = openWorkflow(loadApp({ fetchImpl: idle }));
  app.swipe(app.document.querySelector("#wfp .gantt-scroll"), -180, 0);
  assert.equal(app.document.querySelector(".view.active").id, "view-workflow");
});

test("the board has no toolbar - just the picker, the board and one + button", () => {
  // The row above the canvas cost a whole line of the height the board is
  // short of; zoom moved to the header menu with the other view controls.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  assert.equal(app.document.querySelector(".board-bar"), null);
  assert.equal(app.document.getElementById("zoomInBtn"), null);
  assert.equal(app.document.getElementById("zoomFitBtn"), null);
  assert.equal(app.document.getElementById("boardCount"), null);

  const fab = app.document.getElementById("projectAddBtn");
  assert.ok(fab, "adding a project is the one thing still one tap away");
  // It floats in the fixed cluster with the full-screen button rather than
  // inside the canvas, so the two share a bottom offset by construction.
  assert.equal(fab.closest(".fab-stack")?.id, "fabStack");
  assert.equal(app.window.getComputedStyle(app.document.getElementById("fabStack")).position, "fixed");

  fab.click();
  assert.equal(cols(app).length, 1, "and it still adds one");
});

test("a picker above the board lists every project, and choosing one shows only that card", () => {
  const app = boardWith(["Home", "Work", "Money"], { innerWidth: 1280 });
  const pick = app.document.getElementById("boardPick");
  assert.ok(pick.closest("#view-tasks"), "at the top of the Tasks tab");
  assert.deepEqual([...pick.options].map((o) => o.textContent), ["All projects (3)", "Home", "Work", "Money"]);

  pick.value = "p1";
  pick.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.deepEqual(orderOf(app), ["Work"], "just that card");
  assert.equal(colsOf(app), 1);
  assert.equal(cardBox(cols(app)[0]).w, 720, "at a reading width, not a quarter of the screen");
  assert.ok(pick.classList.contains("is-on"), "and the picker says a filter is on");
  assert.equal(JSON.parse(app.window.localStorage.getItem("yawarBoardView")).only, "p1", "remembered on this device");
  assert.doesNotMatch(app.rawMain(), /"only"/, "never in the synced record");

  const again = openBoard(loadApp({ fetchImpl: idle, innerWidth: 1280, localStorageSeed: {
    [MAIN_KEY]: app.rawMain(), yawarBoardView: app.window.localStorage.getItem("yawarBoardView") } }));
  assert.deepEqual(orderOf(again), ["Work"], "and still showing after a reload");

  pick.value = "";
  pick.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.deepEqual(orderOf(app), ["Home", "Work", "Money"], "All projects brings every card back");
});

test("on a phone the chosen card fills the width", () => {
  const app = boardWith(["Home", "Work"]);
  const pick = app.document.getElementById("boardPick");
  pick.value = "p0";
  pick.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.equal(cardBox(cols(app)[0]).w, 338);
});

test("a chosen project that has been deleted falls back to showing them all", () => {
  const app = boardWith(["Home", "Work"]);
  const seeded = openBoard(loadApp({ fetchImpl: idle, localStorageSeed: {
    [MAIN_KEY]: app.rawMain(), yawarBoardView: JSON.stringify({ z: 1, y: 0, only: "gone" }) } }));
  assert.deepEqual(orderOf(seeded), ["Home", "Work"]);
  assert.equal(seeded.document.getElementById("boardPick").value, "");
});

test("the board hint is gone - the gestures are not worth a permanent caption", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Anything");
  assert.equal(app.document.getElementById("canvasHint"), null);
  assert.equal(app.document.querySelector(".canvas-hint"), null);
});

/* ---------------- colour, stacking, full screen ---------------- */

test("a card carries its project's colour, and no two new projects share one", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "One");
  newProject(app, "Two");
  const [a, b] = Object.values(app.state().projects);
  assert.ok(a.color, "given a colour at creation, so reordering cannot repaint it");
  assert.notEqual(a.color, b.color);

  const painted = cols(app).map((c) => c.style.getPropertyValue("--proj"));
  assert.ok(painted.every(Boolean), "and the card is painted with it");
  assert.notEqual(painted[0], painted[1]);
});

test("the colour a project is given is the colour its Workflow bars use", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const col = newProject(app, "Coloured");
  addTaskTo(app, col, "Dated");
  const p = Object.values(app.state().projects)[0];
  assert.equal(col.style.getPropertyValue("--proj"), p.color);
  const t = Object.values(app.state().tasks)[0];
  menuItem(openTaskMenu(app, colNamed(app, "Coloured"), "Dated"), /Add to the workflow/).click();
  const inputs = [...app.document.querySelectorAll(".menu-pop input[type=date]")];
  inputs[0].value = dayKeyFrom(0);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-pop button")].find((b) => b.textContent === "Save").click();
  openWorkflow(app);
  assert.equal(plannerBar(app, t.id).style.getPropertyValue("--project-color").toLowerCase(), p.color.toLowerCase());
});

test("Move left and Move right in a card's menu move it through the same order", () => {
  const app = boardWith(["Left", "Right"], { innerWidth: 1280 });
  colNamed(app, "Right").querySelector(".btask-menu").click();
  menuItem([...app.document.querySelectorAll(".menu-pop button")], /Move left/).click();
  assert.deepEqual(orderOf(app), ["Right", "Left"]);
  assert.ok(cardBox(colNamed(app, "Right")).x < cardBox(colNamed(app, "Left")).x, "and it is drawn there");
});

test("a tap on a card still doesn't rewrite it, front or not", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Still");
  const before = Object.values(app.state().projects)[0].updated_at;
  const head = cols(app)[0].querySelector(".board-col-head");
  pointer(app, "pointerdown", 1, 100, 100, head);
  pointer(app, "pointerup", 1, 100, 100, app.document);
  assert.equal(Object.values(app.state().projects)[0].updated_at, before);
});

test("full screen is one button beside the +, and the same button comes back", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const body = app.document.body;
  const btn = app.document.getElementById("fullBtn");
  assert.ok(btn, "a button rather than a menu row");
  assert.equal(btn.closest(".fab-stack")?.id, "fabStack", "in the floating cluster");
  assert.equal(app.window.getComputedStyle(app.document.getElementById("fabStack")).position, "fixed");
  assert.equal(menuItem(headerMenu(app), /Full screen/), undefined, "and gone from the menu");
  app.document.querySelector(".menu-backdrop")
    .dispatchEvent(new app.window.Event("pointerdown", { bubbles: true }));

  btn.click();
  assert.ok(body.classList.contains("tasks-full"), "the chrome is out of the way");
  assert.equal(btn.textContent, "✕", "the same button is the way back");
  assert.match(btn.getAttribute("aria-label"), /leave full screen/i);

  btn.click();
  assert.ok(!body.classList.contains("tasks-full"));
  assert.equal(btn.textContent, "⛶");
});

test("full screen is offered on Workflow and the calendar, and survives moving between them", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  // The buttons live in one fixed cluster, so it is the cluster that is
  // shown or hidden - they cannot drift apart that way.
  const shown = () => app.window.getComputedStyle(app.document.getElementById("fabStack")).display;
  assert.notEqual(shown(), "none", "on the board");

  app.document.getElementById("fullBtn").click();
  app.goTo("workflow");
  assert.ok(app.document.body.classList.contains("tasks-full"),
    "the panes worth filling are one set for this");
  assert.notEqual(shown(), "none");

  app.goTo("calendar");
  assert.ok(app.document.body.classList.contains("tasks-full"));
  assert.notEqual(shown(), "none", "the calendar has a pane worth filling too");
});

test("the buttons are not offered on a view that is just a list of cards", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("today");
  assert.equal(app.window.getComputedStyle(app.document.getElementById("fabStack")).display, "none");
});

test("+ is only on the board; full screen is on all three", () => {
  const app = loadApp({ fetchImpl: idle });
  const add = () => app.window.getComputedStyle(app.document.getElementById("projectAddBtn")).display;
  openBoard(app);
  assert.notEqual(add(), "none", "adding a project means something here");
  app.goTo("workflow");
  assert.equal(add(), "none", "and nothing on the timeline");
  app.goTo("calendar");
  assert.equal(add(), "none");
});

test("leaving those panes leaves full screen with it", () => {
  // Otherwise the header and the bottom bar stay hidden on a view that has no
  // button to bring them back.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  app.document.getElementById("fullBtn").click();
  app.goTo("today");
  assert.ok(!app.document.body.classList.contains("tasks-full"));
});

test("full screen is a mode, not a remembered preference", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Anything");
  app.document.getElementById("fullBtn").click();
  assert.ok(!JSON.stringify(app.state()).includes("tasks-full"));
  const stored = JSON.stringify(Object.entries(app.window.localStorage));
  assert.ok(!/tasksFull|tasks-full/.test(stored), "not written to storage at all");
});

/* ---------------- the menu, and the calendar button ---------------- */

test("the menu opens beside what was tapped, not as a sheet at the bottom", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "P"), "Something");

  const btn = app.document.querySelector(".btask .btask-menu");
  const ev = new app.window.MouseEvent("click", { bubbles: true, cancelable: true, clientX: 140, clientY: 260 });
  btn.dispatchEvent(ev);

  const pop = app.document.querySelector(".menu-pop");
  assert.ok(pop, "a popup, not a bottom sheet");
  assert.equal(app.document.querySelector(".menu-sheet"), null);
  assert.equal(app.window.getComputedStyle(pop).position, "fixed",
    "fixed, so the canvas transform can neither move nor clip it");
  assert.ok(parseInt(pop.style.left, 10) > 0 || parseInt(pop.style.top, 10) > 0,
    "placed where the tap was");
});

test("tapping outside closes the menu", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "P"), "Something");
  app.document.querySelector(".btask .btask-menu").click();
  assert.ok(app.document.querySelector(".menu-pop"));

  const back = app.document.querySelector(".menu-backdrop");
  back.dispatchEvent(new app.window.Event("pointerdown", { bubbles: true }));
  assert.equal(app.document.querySelector(".menu-pop"), null);
});

test("every task row carries a calendar button, ringed when it is scheduled", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Booked", scheduled: true },
    { title: "Not booked" },
  ]) });
  openBoard(app);

  const rows = [...app.document.querySelectorAll(".btask")];
  const cal = (r) => r.querySelector(".icon-btn");
  rows.forEach((r) => assert.ok(cal(r), "every row has one"));

  const booked = rows.find((r) => r.textContent.includes("Booked"));
  const free = rows.find((r) => r.textContent.includes("Not booked"));
  assert.ok(cal(booked).classList.contains("is-on"), "green ring when on the calendar");
  assert.ok(!cal(free).classList.contains("is-on"));
  assert.match(cal(booked).title, /on your calendar/i);

  /* The ring is the whole point - a second "on calendar" label beside the
     title is the 1.30.1 collapse all over again. */
  const meta = booked.querySelector(".btask-meta");
  assert.ok(!meta || !/on calendar/i.test(meta.textContent));
});

test("a drag that starts on the project name still moves the card", () => {
  /* The name button is flex:1 and covers nearly the whole header, so in a real
     browser it - not the header - is what the pointer lands on. Dispatching at
     the header instead passes whatever the handler does, which is how the
     original bug got through. */
  const app = boardWith(["First", "Grab me"]);
  const name = colNamed(app, "Grab me").querySelector(".board-name");
  pointer(app, "pointerdown", 1, 100, 174, name);
  pointer(app, "pointermove", 1, 100, 30, app.document);
  pointer(app, "pointerup", 1, 100, 30, app.document);
  assert.deepEqual(orderOf(app), ["Grab me", "First"], "it moved, even though the name was the target");
});

test("a drag that started on the name does not also open the rename prompt", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Keep my name");
  let asked = false;
  app.window.prompt = () => { asked = true; return "Renamed"; };

  const name = cols(app)[0].querySelector(".board-name");
  pointer(app, "pointerdown", 1, 100, 100, name);
  pointer(app, "pointermove", 1, 190, 160, app.document);
  pointer(app, "pointerup", 1, 190, 160, app.document);
  name.click();          // the click a real drag leaves behind

  assert.equal(asked, false, "a drag is not a rename");
  assert.equal(Object.values(app.state().projects)[0].name, "Keep my name");
});

test("a finger has to hold the header before the card moves", async () => {
  /* Otherwise brushing a heading while scrolling the board drags the card. */
  const app = boardWith(["First", "Held"]);
  const head = colNamed(app, "Held").querySelector(".board-col-head");
  touch(app, "pointerdown", 1, 100, 174, head);
  await app.wait(500);                       // held past the threshold
  touch(app, "pointermove", 1, 100, 30, app.document);
  touch(app, "pointerup", 1, 100, 30, app.document);
  assert.deepEqual(orderOf(app), ["Held", "First"], "held, so it dragged");
});

test("a finger that moves before the hold completes scrolls the board instead", async () => {
  const app = boardWith(["1", "2", "3", "4", "5", "6", "7", "8"]);
  const head = colNamed(app, "3").querySelector(".board-col-head");
  // The moves go to the board, which is where a finger's events land.
  touch(app, "pointerdown", 1, 100, 330, head);
  touch(app, "pointermove", 1, 100, 230);   // moved straight away
  await app.wait(500);                      // past the threshold
  touch(app, "pointermove", 1, 100, 130);
  touch(app, "pointerup", 1, 100, 130);
  assert.deepEqual(orderOf(app), ["1", "2", "3", "4", "5", "6", "7", "8"], "the card stayed in its place");
  assert.match(plane(app).style.transform, /translate\(0px, ?-200px\)/, "and the swipe scrolled the board");
});

test("tapping the name without moving still renames", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Old name");
  app.window.prompt = () => "New name";

  const name = cols(app)[0].querySelector(".board-name");
  pointer(app, "pointerdown", 1, 100, 100, name);
  pointer(app, "pointerup", 1, 100, 100, app.document);
  name.click();

  assert.equal(Object.values(app.state().projects)[0].name, "New name");
});

/* ---------------- reordering tasks by dragging ---------------- */
/* The same grip and the same code path the dhikr list uses. jsdom has no
   layout, so elementFromPoint and getBoundingClientRect are stubbed - the
   drag itself is the app's own. */

function rowPointer(app, type, y) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.clientX = 10; ev.clientY = y;
  return ev;
}
function dragTask(app, col, fromTitle, toTitle, before) {
  const row = (title) => [...col.querySelectorAll(".btask")]
    .find((r) => r.querySelector(".btask-title").textContent === title);
  row(fromTitle).querySelector(".drag-grip").dispatchEvent(rowPointer(app, "pointerdown", 0));
  const dst = row(toTitle);
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  app.document.dispatchEvent(rowPointer(app, "pointermove", before ? 110 : 130));
  app.document.dispatchEvent(rowPointer(app, "pointerup", before ? 110 : 130));
}

test("every task row has a grip, and dragging one puts it where you drop it", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const col = newProject(app, "Errands");
  ["One", "Two", "Three"].forEach((t) => addTaskTo(app, colNamed(app, "Errands"), t));
  assert.equal(colNamed(app, "Errands").querySelectorAll(".drag-grip").length, 3);

  dragTask(app, colNamed(app, "Errands"), "Three", "One", true);
  assert.deepEqual(titles(colNamed(app, "Errands")), ["Three", "One", "Two"]);

  dragTask(app, colNamed(app, "Errands"), "Three", "Two", false);
  assert.deepEqual(titles(colNamed(app, "Errands")), ["One", "Two", "Three"]);
});

test("a hand-picked order rides the synced rows, and survives a reload", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Errands");
  ["One", "Two", "Three"].forEach((t) => addTaskTo(app, colNamed(app, "Errands"), t));
  dragTask(app, colNamed(app, "Errands"), "Three", "One", true);

  const stored = app.window.localStorage.getItem(MAIN_KEY);
  const byTitle = {};
  Object.values(JSON.parse(stored).tasks).forEach((t) => { byTitle[t.title] = t; });
  assert.equal(byTitle.Three.order, 0);
  assert.ok(byTitle.Three.updated_at > 1, "stamped, or the move never pushes");

  const again = openBoard(loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: stored } }));
  assert.deepEqual(titles(colNamed(again, "Errands")), ["Three", "One", "Two"]);
});

test("a task cannot be dragged into another project's list", () => {
  // Each list is addressed by its own data-droplist, so a row in the other
  // card is simply not a drop target.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "A"); addTaskTo(app, colNamed(app, "A"), "Mine");
  newProject(app, "B"); addTaskTo(app, colNamed(app, "B"), "Theirs");

  colNamed(app, "A").querySelector(".drag-grip").dispatchEvent(rowPointer(app, "pointerdown", 0));
  const dst = colNamed(app, "B").querySelector(".btask");
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  app.document.dispatchEvent(rowPointer(app, "pointermove", 110));
  app.document.dispatchEvent(rowPointer(app, "pointerup", 110));

  assert.deepEqual(titles(colNamed(app, "A")), ["Mine"]);
  assert.deepEqual(titles(colNamed(app, "B")), ["Theirs"]);
});

/* ---------------- scheduling onto the calendar ---------------- */

test("the calendar button opens a date-and-time picker, not a text prompt", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "P"), "Dentist");
  let prompted = false;
  app.window.prompt = () => { prompted = true; return null; };

  app.document.querySelector(".btask .icon-btn").click();
  const pop = app.document.querySelector(".menu-pop");
  assert.ok(pop, "a popup beside the button");
  assert.equal(prompted, false, "and never a typed-out date string");
  assert.ok(pop.querySelector('input[type="datetime-local"]'), "a real picker");
  assert.ok(pop.querySelector('input[type="number"]'), "and how long it runs");
  assert.match(pop.textContent, /Add to calendar/);
});

test("an already-scheduled task offers to move it or take it off", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Booked", scheduled: true, calendarEventId: "evt-1",
      due: new Date(Date.now() + 3600000).toISOString() },
  ]) });
  openBoard(app);
  app.document.querySelector(".btask .icon-btn").click();

  const pop = app.document.querySelector(".menu-pop");
  assert.match(pop.textContent, /Reschedule/);
  assert.match(pop.textContent, /Take off the calendar/);
});

test("rescheduling patches the event it already owns rather than making a second", async () => {
  // The old code always POSTed, so "Reschedule" quietly left the first event
  // behind on the calendar.
  const calls = [];
  const app = loadApp({
    fetchImpl: async (url, opts) => {
      calls.push({ url: String(url), method: (opts && opts.method) || "GET" });
      return { ok: true, status: 200, json: async () => ({ status: "ok", eventId: "evt-1" }) };
    },
    localStorageSeed: boardSeed([
      { title: "Booked", scheduled: true, calendarEventId: "evt-1",
        due: new Date(Date.now() + 3600000).toISOString() },
    ]),
  });
  openBoard(app);
  app.document.querySelector(".btask .icon-btn").click();
  [...app.document.querySelectorAll(".menu-pop button")]
    .find((b) => /Reschedule/.test(b.textContent)).click();
  await app.flush();

  const write = calls.find((c) => /calendar\/events/.test(c.url) && c.method !== "GET");
  assert.equal(write.method, "PATCH");
});

/* ---------------- the workflow sheet on the board ---------------- */

test("an undated task is offered the workflow by name, not by its fields", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  addTaskTo(app, newProject(app, "P"), "Not plotted");
  const items = openTaskMenu(app, colNamed(app, "P"), "Not plotted").map((b) => b.textContent);
  assert.ok(items.some((t) => /Add to the workflow/.test(t)));
  assert.equal(items.some((t) => /Set dates/.test(t)), false, "the old wording is gone");
});

test("the sheet offers to take a plotted task back off the workflow", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Plotted", start: dayKeyFrom(1), end: dayKeyFrom(4) }]) });
  openBoard(app);
  menuItem(openTaskMenu(app, cols(app)[0], "Plotted"), /Change workflow dates/).click();

  const pop = app.document.querySelector(".menu-pop");
  const off = [...pop.querySelectorAll("button")].find((b) => /Take off the workflow/.test(b.textContent));
  assert.ok(off, "and says so, rather than 'Clear dates'");
  off.click();

  const t = JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).tasks.t1;
  assert.equal(t.start, null);
  assert.equal(t.end, null);
  assert.equal(app.document.querySelector(".btask .btask-title").tagName, "SPAN",
    "and the title stops reading as a link to it");
});

/* ---------------- YR / EY: one filter, both tabs ---------------- */

const catBtn = (app, cat) => app.document.querySelector('#boardCats [data-board-cat="' + cat + '"]');
const pickOptions = (app) => [...app.document.querySelectorAll("#boardPick option")].map((o) => o.textContent);
function categorised() {
  // "EY" by name, "Audit" by an explicit choice, "Home" personal by default.
  const app = boardWith(["Home", "EY", "Audit", "Gym"]);
  const s = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  s.projects.p2.category = "EY";
  return openBoard(loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: JSON.stringify(s) } }));
}

test("the Tasks tab has the planner's YR and EY buttons, and they filter the cards", () => {
  const app = categorised();
  assert.deepEqual(orderOf(app), ["Home", "EY", "Audit", "Gym"], "everything to begin with");
  assert.equal(catBtn(app, "YR").getAttribute("aria-pressed"), "false");

  catBtn(app, "EY").click();
  assert.deepEqual(orderOf(app), ["EY", "Audit"], "work only");
  assert.equal(catBtn(app, "EY").classList.contains("is-on"), true);
  assert.deepEqual(pickOptions(app), ["All EY projects (2)", "EY", "Audit"], "and the picker lists only those");

  catBtn(app, "YR").click();
  assert.deepEqual(orderOf(app), ["Home", "Gym"], "a press on the other switches");

  catBtn(app, "YR").click();
  assert.deepEqual(orderOf(app), ["Home", "EY", "Audit", "Gym"], "the lit one again shows both");
});

test("it is the same setting as the Workflow tab's, whichever tab sets it", () => {
  const app = categorised();
  // Set on the Workflow tab...
  app.goTo("workflow");
  app.document.querySelector('#wfp [data-wfp="category"][data-cat="EY"]').click();
  openBoard(app);
  assert.deepEqual(orderOf(app), ["EY", "Audit"], "the board follows the planner");
  assert.equal(catBtn(app, "EY").getAttribute("aria-pressed"), "true");
  // ...and back the other way.
  catBtn(app, "EY").click();
  app.goTo("workflow");
  const ey = app.document.querySelector('#wfp [data-wfp="category"][data-cat="EY"]');
  assert.equal(ey.getAttribute("aria-pressed"), "false", "the planner follows the board");
  assert.equal(JSON.parse(app.window.localStorage.getItem("yawarPlannerView")).category, "all");
  // Per device, like the rest of the view: never in the synced store.
  assert.equal(JSON.stringify(app.state()).includes('"category":"all"'), false);
});

test("a project chosen in the picker but filtered out is let go, not left showing", () => {
  const app = categorised();
  const pick = app.document.getElementById("boardPick");
  pick.value = "p0";   // Home, a YR project
  pick.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.deepEqual(orderOf(app), ["Home"]);
  catBtn(app, "EY").click();
  assert.deepEqual(orderOf(app), ["EY", "Audit"]);
  assert.equal(pick.value, "");
});

test("a project added while EY is lit is an EY project, so it stays on the board", () => {
  const app = categorised();
  catBtn(app, "EY").click();
  app.click("projectAddBtn");
  assert.deepEqual(orderOf(app), ["EY", "Audit", "New project"]);
  const made = Object.values(app.state().projects).find((p) => p.name === "New project");
  assert.equal(made.category, "EY");
  assert.ok(made.updated_at > 1, "stamped, so the category syncs");
});

/* ---------------- scrolling from anywhere on a card ---------------- */
/* Measured in Chromium with real touches before the fix: a swipe that began
   on a tick box, a task's grip or the "Add a task" box did not move the board
   at all - between them most of each row's left side. */

function tallBoard() {
  const projects = {}, tasks = {};
  for (let i = 0; i < 6; i++) {
    projects["p" + i] = { id: "p" + i, name: "P" + i, color: "", order: i, updated_at: 1, deleted: 0 };
    for (let j = 0; j < 4; j++) {
      const id = "t" + i + j;
      tasks[id] = { id, projectId: "p" + i, title: "P" + i + " task " + j, done: false, order: j, due: null, start: null,
        end: null, calendarEventId: null, scheduled: false, noteId: null, updated_at: 1, deleted: 0 };
    }
  }
  return openBoard(loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: JSON.stringify({
    schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] }, days: {},
    projects, tasks, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com",
  }) } }));
}
const scrollY = (app) => {
  const m = /translate\([^,]+, ?(-?[\d.]+)px\)/.exec(plane(app).style.transform);
  return m ? Number(m[1]) : NaN;
};
/* The finger rests before lifting, so these never fling: a glide still
   running when the next touch lands would (rightly) make that touch a catch
   rather than a tap. The fling has tests of its own below. */
function swipeFrom(app, target, dy) {
  const at = (type, y, ts, t) => {
    const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
    ev.pointerId = 1; ev.clientX = 100; ev.clientY = y; ev.pointerType = "touch";
    Object.defineProperty(ev, "timeStamp", { value: ts });
    (t || viewport(app)).dispatchEvent(ev);
  };
  at("pointerdown", 400, 1000, target);
  at("pointermove", 400 + dy / 2, 1010);
  at("pointermove", 400 + dy, 1020);
  at("pointerup", 400 + dy, 1600);
}

for (const [where, find] of [
  ["a tick box", (col) => col.querySelector(".btask input[type=checkbox]")],
  ["a task's grip", (col) => col.querySelector(".btask .drag-grip")],
  ["the Add a task box", (col) => col.querySelector(".board-add input")],
  ["a task's title", (col) => col.querySelector(".btask .btask-title")],
]) {
  test("a swipe that starts on " + where + " scrolls the board", () => {
    const app = tallBoard();
    const order = JSON.stringify(Object.values(app.state().tasks).map((t) => [t.id, t.order]));
    swipeFrom(app, find(colNamed(app, "P1")), -200);
    assert.equal(scrollY(app), -200);
    assert.equal(JSON.stringify(Object.values(app.state().tasks).map((t) => [t.id, t.order])), order, "nothing reordered");
  });
}

test("the click a swipe leaves on a tick box does not tick it", async () => {
  const app = tallBoard();
  const cb = colNamed(app, "P1").querySelector(".btask input[type=checkbox]");
  swipeFrom(app, cb, -200);
  cb.click();   // what a browser fires on the element the finger started on
  assert.equal(Object.values(app.state().tasks).filter((t) => t.done).length, 0);
  await app.wait(5);   // the swallow lasts one tick; a real tap comes later
  // A plain tap still ticks.
  const again = colNamed(app, "P1").querySelector(".btask input[type=checkbox]");
  touch(app, "pointerdown", 2, 100, 400, again);
  touch(app, "pointerup", 2, 100, 400, again);
  again.click();
  assert.equal(Object.values(app.state().tasks).filter((t) => t.done).length, 1);
});

test("a field being typed in keeps its own gesture", () => {
  const app = tallBoard();
  const input = colNamed(app, "P1").querySelector(".board-add input");
  input.focus();
  swipeFrom(app, input, -200);
  assert.equal(scrollY(app), 0, "selecting text in a focused box is not a scroll");
});

test("a finger held on a task's grip lifts the row and drags it", async () => {
  const app = tallBoard();
  const col = colNamed(app, "P1");
  const row = (title) => [...colNamed(app, "P1").querySelectorAll(".btask")].find((r) => r.querySelector(".btask-title").textContent === title);
  touch(app, "pointerdown", 1, 10, 0, row("P1 task 3").querySelector(".drag-grip"));
  assert.equal(row("P1 task 3").classList.contains("is-holding"), true);
  await app.wait(450);
  const dst = row("P1 task 0");
  dst.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 0, width: 0 });
  app.document.elementFromPoint = () => dst;
  touch(app, "pointermove", 1, 10, 110, app.document);
  touch(app, "pointerup", 1, 10, 110, app.document);
  assert.deepEqual(titles(colNamed(app, "P1")), ["P1 task 3", "P1 task 0", "P1 task 1", "P1 task 2"]);
  assert.equal(scrollY(app), 0, "and the board did not scroll under it");
  assert.ok(col);
});

/* A flick keeps going: real timestamps, since the speed is read from them. */
function timedTouch(app, type, y, ts, target) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.pointerId = 1; ev.clientX = 100; ev.clientY = y; ev.pointerType = "touch";
  Object.defineProperty(ev, "timeStamp", { value: ts });
  (target || viewport(app)).dispatchEvent(ev);
}

test("a quick flick glides on after the finger lifts, and a touch stops it", async () => {
  const app = tallBoard();
  timedTouch(app, "pointerdown", 500, 1000);
  timedTouch(app, "pointermove", 450, 1010);
  timedTouch(app, "pointermove", 400, 1026);
  timedTouch(app, "pointermove", 350, 1042);
  timedTouch(app, "pointerup", 350, 1046);
  assert.equal(scrollY(app), -150, "as far as the finger went");
  await app.wait(120);
  const gliding = scrollY(app);
  assert.ok(gliding < -150, "then further on its own: " + gliding);
  timedTouch(app, "pointerdown", 300, 5000);
  const caught = scrollY(app);
  await app.wait(120);
  assert.equal(scrollY(app), caught, "a touch catches it where it is");
  timedTouch(app, "pointerup", 300, 5010);
});

test("a finger that stops before lifting does not fling", async () => {
  const app = tallBoard();
  timedTouch(app, "pointerdown", 500, 1000);
  timedTouch(app, "pointermove", 450, 1010);
  timedTouch(app, "pointermove", 400, 1026);
  timedTouch(app, "pointerup", 400, 1400);   // held still for a moment first
  await app.wait(120);
  assert.equal(scrollY(app), -100);
});

test("a mouse dragging the board never flings", async () => {
  const app = tallBoard();
  for (const [type, y, ts] of [["pointerdown", 500, 1000], ["pointermove", 450, 1010], ["pointermove", 400, 1026], ["pointerup", 400, 1030]]) {
    const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
    ev.pointerId = 1; ev.clientX = 100; ev.clientY = y; ev.pointerType = "mouse";
    Object.defineProperty(ev, "timeStamp", { value: ts });
    viewport(app).dispatchEvent(ev);
  }
  await app.wait(120);
  assert.equal(scrollY(app), -100);
});
