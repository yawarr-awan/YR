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

test("a bar is as wide as the span is long, in weeks", () => {
  // Columns are weeks now: a project runs for weeks, and a day-wide column
  // meant scrolling for an hour to see a month.
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Short", start: dayKeyFrom(1), end: dayKeyFrom(2) },
    { title: "Long", start: dayKeyFrom(1), end: dayKeyFrom(29) },
  ]) });
  openWorkflow(app);

  const bars = wfBars(app);
  assert.equal(bars.length, 2);
  // A short bar carries no text, so a bar is addressed by its title.
  const named = (t) => bars.find((b) => b.title.indexOf(t) === 0);
  const w = (title) => parseFloat(named(title).style.width);
  assert.ok(w("Long") > w("Short") * 5, "a month reads as far longer than two days");
  assert.match(bars[0].title, /→/, "and each says its span on hover");
});

test("even a single-day task is wide enough to see and tap", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Dentist", start: dayKeyFrom(2), end: dayKeyFrom(2) }]) });
  openWorkflow(app);
  assert.ok(parseFloat(wfBars(app)[0].style.width) >= 18, "not a zero-width sliver");
});

test("each project's bars carry its own colour", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: (() => {
    const seed = JSON.parse(boardSeed([{ title: "A", start: dayKeyFrom(0), end: dayKeyFrom(1) }])[MAIN_KEY]);
    seed.projects.p2 = { id: "p2", name: "Work", color: "", order: 1, updated_at: 1, deleted: 0 };
    seed.tasks.t2 = { id: "t2", projectId: "p2", title: "B", done: false, order: 0, due: null,
      start: dayKeyFrom(0), end: dayKeyFrom(1), calendarEventId: null, scheduled: false,
      noteId: null, updated_at: 1, deleted: 0 };
    return { [MAIN_KEY]: JSON.stringify(seed) };
  })() });
  openWorkflow(app);

  const bars = wfBars(app);
  const a = bars.find((b) => b.title.indexOf("A") === 0).style.background;
  const b = bars.find((b) => b.title.indexOf("B") === 0).style.background;
  assert.ok(a, "a bar is coloured by its project");
  assert.notEqual(a, b, "and two projects do not look alike");
});

test("an overdue task reads differently from a finished one", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Late thing", start: dayKeyFrom(-3), end: dayKeyFrom(-1) },
    { title: "Done thing", start: dayKeyFrom(-3), end: dayKeyFrom(-1), done: true },
  ]) });
  openWorkflow(app);

  const late = wfBars(app).find((b) => b.title.indexOf("Late thing") === 0);
  const done = wfBars(app).find((b) => b.title.indexOf("Done thing") === 0);
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
  const inputs = [...app.document.querySelectorAll(".menu-pop input[type=date]")];
  inputs[0].value = dayKeyFrom(1);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-pop button")].find((b) => b.textContent === "Save").click();

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
  const inputs = [...app.document.querySelectorAll(".menu-pop input[type=date]")];
  inputs[0].value = dayKeyFrom(5);
  inputs[1].value = dayKeyFrom(2);
  [...app.document.querySelectorAll(".menu-pop button")].find((b) => b.textContent === "Save").click();

  const t = Object.values(app.state().tasks)[0];
  assert.equal(t.start, dayKeyFrom(2), "the earlier date is the start");
  assert.equal(t.end, dayKeyFrom(5));
});

test("the timeline is a long scroll, not a fortnight window", () => {
  /* It used to page a fortnight at a time, which made planning anything
     further out feel boxed in. The grid now spans years and simply scrolls. */
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Way back", start: dayKeyFrom(-200), end: dayKeyFrom(-190) },
    { title: "Far ahead", start: dayKeyFrom(300), end: dayKeyFrom(330) },
  ]) });
  openWorkflow(app);

  const bars = wfBars(app);
  assert.equal(bars.length, 2, "both ends of the year are on the same timeline");
  const left = (t) => parseFloat(bars.find((b) => b.textContent === t).style.left);
  assert.ok(left("Far ahead") > left("Way back"), "laid out in order");

  const grid = app.document.getElementById("wfGrid");
  assert.ok(parseFloat(grid.style.width) > 5000, "and it is genuinely long, so it scrolls");
});

test("today is marked, and the view opens near it", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Now", start: dayKeyFrom(0), end: dayKeyFrom(2) }]) });
  openWorkflow(app);
  assert.ok(app.document.querySelector("#wfGrid .wf-now"), "a line marking today");
  assert.ok(app.document.querySelector("#wfGrid .wf-wk.is-thisweek"), "and this week's heading stands out");

  /* The line and the bars must share one coordinate system. They did not: the
     rows start after the name gutter and the line is a child of the grid, so
     it marked a week earlier until it was given the same offset. */
  const bar = app.document.querySelector("#wfGrid .wf-bar");
  assert.equal(app.document.querySelector("#wfGrid .wf-now").style.left, bar.style.left,
    "a task starting today begins exactly at the today line");
});

test("the name gutter is solid all the way down its rows", () => {
  /* It is position:sticky, and the base rule's inset-block:0 stops being
     sizing once it is - so the label shrank to its text and a bar scrolling
     past showed through the rest of the row. Reported as bars overlapping the
     first column. */
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Now", start: dayKeyFrom(0), end: dayKeyFrom(9) }]) });
  openWorkflow(app);

  const styles = app.document.querySelector("style").textContent;
  const rule = styles.match(/\.wf-row \.wf-rowlabel\{[^}]*\}/)[0];
  assert.match(rule, /position:sticky/);
  assert.match(rule, /height:100%/, "or the box is only as tall as its text");

  const label = app.document.querySelector("#wfGrid .wf-row .wf-rowlabel");
  const cs = app.window.getComputedStyle(label);
  assert.notEqual(cs.background + cs.backgroundColor, "", "and it is opaque");
  const bar = app.document.querySelector("#wfGrid .wf-bar");
  assert.ok(parseInt(app.window.getComputedStyle(label).zIndex, 10)
    > parseInt(app.window.getComputedStyle(bar).zIndex, 10), "bars pass underneath it");
});

test("the week headings have a corner over the name gutter to scroll under", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Now", start: dayKeyFrom(0), end: dayKeyFrom(2) }]) });
  openWorkflow(app);
  assert.ok(app.document.querySelector("#wfGrid .wf-head-row .wf-corner"),
    "otherwise the leftmost week label slides out from behind the names");
});

test("a bar too short to hold its title carries none - the name is in the gutter", () => {
  const app = loadApp({ fetchImpl: idle, localStorageSeed: boardSeed([
    { title: "Two days", start: dayKeyFrom(0), end: dayKeyFrom(1) },
    { title: "Two months", start: dayKeyFrom(0), end: dayKeyFrom(60) },
  ]) });
  openWorkflow(app);

  const bars = wfBars(app);
  const short = bars.find((b) => /Two days/.test(b.title));
  const long = bars.find((b) => /Two months/.test(b.title));
  assert.equal(short.textContent, "", "clipped to one letter would be worse than blank");
  assert.equal(long.textContent, "Two months");
  assert.match(short.title, /Two days/, "the full detail is still on the element");
});

test("the board row shows the span, and the menu offers to change it", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Spanned", start: dayKeyFrom(1), end: dayKeyFrom(3) }]) });
  openBoard(app);

  const meta = app.document.querySelector(".btask .btask-meta").textContent;
  assert.match(meta, /→/, "start and end, not just one date");

  app.document.querySelector(".btask .btask-menu").click();
  const items = [...app.document.querySelectorAll(".menu-pop button")].map((b) => b.textContent);
  assert.ok(items.some((t) => /Change dates/.test(t)), "already dated, so it offers a change");
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

test("cards are placed on a canvas, each with its own position and size", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "One");
  newProject(app, "Two");

  const [a, b] = cols(app);
  assert.equal(app.window.getComputedStyle(a).position, "absolute");
  assert.notEqual(a.style.left + a.style.top, b.style.left + b.style.top,
    "a new card is laid beside the last, not on top of it");

  const stored = Object.values(app.state().projects);
  stored.forEach((p) => {
    assert.equal(typeof p.x, "number");
    assert.equal(typeof p.y, "number");
    assert.ok(p.w > 0 && p.h > 0);
  });
});

test("a board made before the canvas gets positions once, and keeps them", () => {
  const seed = {
    schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] }, days: {},
    projects: { p1: { id: "p1", name: "Old", color: "", order: 0, updated_at: 1, deleted: 0 } },
    tasks: {}, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com",
  };
  const app = openBoard(loadApp({ fetchImpl: idle, localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) } }));

  const p = Object.values(app.state().projects)[0];
  assert.equal(typeof p.x, "number", "given a place on the canvas");
  assert.ok(p.updated_at > 1, "and stamped, so every device agrees where it sits");

  const again = openBoard(loadApp({ fetchImpl: idle,
    localStorageSeed: { [MAIN_KEY]: app.window.localStorage.getItem(MAIN_KEY) } }));
  assert.equal(Object.values(again.state().projects)[0].x, p.x, "not reshuffled on reload");
});

test("dragging a card by its header moves it, and the move is stored", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Movable");
  const before = Object.values(app.state().projects)[0];
  const startX = before.x, startY = before.y;

  const head = cols(app)[0].querySelector(".board-col-head");
  pointer(app, "pointerdown", 1, 100, 100, head);
  pointer(app, "pointermove", 1, 180, 160, app.document);
  pointer(app, "pointerup", 1, 180, 160, app.document);

  const after = Object.values(app.state().projects)[0];
  assert.equal(after.x, startX + 80);
  assert.equal(after.y, startY + 60);
  assert.ok(after.updated_at > before.updated_at || after.x !== startX, "stamped for sync");
});

test("dragging the corner resizes, and never below a usable size", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Sizable");
  const grip = cols(app)[0].querySelector(".card-resize");
  assert.ok(grip, "there is a corner to grab");

  pointer(app, "pointerdown", 1, 300, 300, grip);
  pointer(app, "pointermove", 1, 380, 400, app.document);
  pointer(app, "pointerup", 1, 380, 400, app.document);
  let p = Object.values(app.state().projects)[0];
  assert.equal(p.w, 260 + 80);
  assert.equal(p.h, 300 + 100);

  // Now drag it far smaller than is usable.
  pointer(app, "pointerdown", 1, 300, 300, cols(app)[0].querySelector(".card-resize"));
  pointer(app, "pointermove", 1, -900, -900, app.document);
  pointer(app, "pointerup", 1, -900, -900, app.document);
  p = Object.values(app.state().projects)[0];
  assert.ok(p.w >= 180 && p.h >= 140, "clamped to something you can still use");
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

test("dragging at half zoom moves the card by half as many canvas pixels", () => {
  // Screen pixels are canvas pixels divided by the zoom - get this wrong and
  // the card runs away from the finger.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Zoomed");
  for (let i = 0; i < 4; i++) headerMenuDo(app, /Zoom out/);
  const z = zoomOf(app) / 100;
  assert.ok(z < 1, "we are zoomed out");

  const start = Object.values(app.state().projects)[0].x;
  const head = cols(app)[0].querySelector(".board-col-head");
  pointer(app, "pointerdown", 1, 100, 100, head);
  pointer(app, "pointermove", 1, 200, 100, app.document);
  pointer(app, "pointerup", 1, 200, 100, app.document);

  const moved = Object.values(app.state().projects)[0].x - start;
  assert.ok(Math.abs(moved - 100 / z) < 2, `expected ~${Math.round(100 / z)} canvas px, got ${moved}`);
});

test("zoom is clamped, shown, and remembered per device rather than synced", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Anything");   // so there is a saved store to inspect
  assert.equal(zoomOf(app), 100);

  for (let i = 0; i < 20; i++) headerMenuDo(app, /Zoom in/);
  assert.ok(zoomOf(app) <= 250, "there is a ceiling");
  for (let i = 0; i < 40; i++) headerMenuDo(app, /Zoom out/);
  assert.ok(zoomOf(app) >= 35, "and a floor");

  assert.ok(app.window.localStorage.getItem("yawarBoardView"), "kept per device");
  assert.ok(!JSON.stringify(app.state()).includes("yawarBoardView"));
  assert.equal(app.state().zoom, undefined, "the view is not part of the synced record");
});

test("dragging the background pans the canvas", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Anything");
  const before = plane(app).style.transform;

  pointer(app, "pointerdown", 1, 200, 200);
  pointer(app, "pointermove", 1, 260, 240);
  pointer(app, "pointerup", 1, 260, 240);

  assert.notEqual(plane(app).style.transform, before);
  assert.match(plane(app).style.transform, /translate\(/);
});

test("a second finger pinches instead of panning", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Pinch me");
  assert.equal(zoomOf(app), 100);

  pointer(app, "pointerdown", 1, 100, 300);
  pointer(app, "pointerdown", 2, 200, 300);   // 100px apart
  pointer(app, "pointermove", 1, 50, 300);
  pointer(app, "pointermove", 2, 250, 300);   // now 200px apart
  pointer(app, "pointerup", 1, 50, 300);
  pointer(app, "pointerup", 2, 250, 300);

  assert.ok(zoomOf(app) > 150, "spreading two fingers zoomed in, got " + zoomOf(app));
});

test("the canvas keeps its own gestures, so a pan never changes tab", () => {
  const app = loadApp({ fetchImpl: idle });
  app.goTo("tasks");
  app.swipe("canvasViewport", -160, 0);
  assert.equal(app.document.querySelector(".view.active").id, "view-tasks");
});

test("scrolling the timeline sideways never changes tab either", () => {
  // The Gantt is a long horizontal scroll; a drag along it is a scroll
  // through the weeks, not a request for the next tab.
  const app = openWorkflow(loadApp({ fetchImpl: idle }));
  app.swipe("wfScroll", -180, 0);
  assert.equal(app.document.querySelector(".view.active").id, "view-workflow");
});

test("the board has no toolbar - just the canvas and one + button", () => {
  // The row above the canvas cost a whole line of the height the board is
  // short of; zoom moved to the header menu with the other view controls.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  assert.equal(app.document.querySelector(".board-bar"), null);
  assert.equal(app.document.getElementById("zoomInBtn"), null);
  assert.equal(app.document.getElementById("zoomFitBtn"), null);
  assert.equal(app.document.getElementById("boardCount"), null);

  const fab = app.document.getElementById("projectAddBtn");
  assert.ok(fab, "adding a project is the one thing still one tap away");
  assert.equal(fab.closest(".canvas-viewport")?.id, "canvasViewport", "floating over the board");
  assert.equal(app.window.getComputedStyle(fab).position, "absolute");

  fab.click();
  assert.equal(cols(app).length, 1, "and it still adds one");
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

test("the colour a project is given is the colour its timeline bars use", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const col = newProject(app, "Coloured");
  const p = Object.values(app.state().projects)[0];
  assert.equal(col.style.getPropertyValue("--proj"), p.color);
});

test("dragging a card brings it to the front, and that is part of the board", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Under");
  newProject(app, "Over");
  const under = colNamed(app, "Under");

  pointer(app, "pointerdown", 1, 100, 100, under.querySelector(".board-col-head"));
  pointer(app, "pointermove", 1, 150, 140, app.document);
  pointer(app, "pointerup", 1, 150, 140, app.document);

  const moved = Object.values(app.state().projects).find((p) => p.name === "Under");
  const other = Object.values(app.state().projects).find((p) => p.name === "Over");
  assert.ok((moved.z || 0) > (other.z || 0), "the one you handled is on top");
  // Painted by DOM order, so the drag class's own z-index still wins mid-drag.
  const order = cols(app).map((c) => c.querySelector(".board-name").textContent);
  assert.equal(order[order.length - 1], "Under");
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

test("full screen hides the header and the bottom bar, and can be left again", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  const body = app.document.body;
  assert.ok(!body.classList.contains("tasks-full"));

  headerMenuDo(app, /Full screen/);
  assert.ok(body.classList.contains("tasks-full"), "the chrome is out of the way");

  // A floating ✕ is the way back: there is no toolbar left to put one in.
  const exit = app.document.getElementById("fsExitBtn");
  assert.ok(exit, "and something to tap to come back");
  assert.equal(app.window.getComputedStyle(exit).position, "fixed");
  exit.click();
  assert.ok(!body.classList.contains("tasks-full"));
});

test("full screen is offered on the timeline too, and survives moving between them", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  headerMenuDo(app, /Full screen/);
  app.goTo("workflow");
  assert.ok(app.document.body.classList.contains("tasks-full"),
    "the board and the timeline are one pair for this");
  assert.ok(menuItem(headerMenu(app), /Leave full screen/), "and it is offered here as well");
});

test("leaving both panes leaves full screen with it", () => {
  // Otherwise the header and the bottom bar stay hidden on a view that has no
  // button to bring them back.
  const app = openBoard(loadApp({ fetchImpl: idle }));
  headerMenuDo(app, /Full screen/);
  app.goTo("today");
  assert.ok(!app.document.body.classList.contains("tasks-full"));
});

test("full screen is a mode, not a remembered preference", () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Anything");
  headerMenuDo(app, /Full screen/);
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
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Grab me");
  const before = Object.values(app.state().projects)[0];
  const name = cols(app)[0].querySelector(".board-name");

  pointer(app, "pointerdown", 1, 100, 100, name);
  pointer(app, "pointermove", 1, 170, 150, app.document);
  pointer(app, "pointerup", 1, 170, 150, app.document);

  const after = Object.values(app.state().projects)[0];
  assert.equal(after.x, before.x + 70, "it moved, even though the name was the target");
  assert.equal(after.y, before.y + 50);
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
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Held");
  const before = Object.values(app.state().projects)[0];
  const head = cols(app)[0].querySelector(".board-col-head");

  touch(app, "pointerdown", 1, 100, 100, head);
  await app.wait(500);                       // held past the threshold
  touch(app, "pointermove", 1, 180, 160, app.document);
  touch(app, "pointerup", 1, 180, 160, app.document);

  const after = Object.values(app.state().projects)[0];
  assert.equal(after.x, before.x + 80, "held, so it dragged");
  assert.equal(after.y, before.y + 60);
});

test("a finger that moves before the hold completes does not drag the card", async () => {
  const app = openBoard(loadApp({ fetchImpl: idle }));
  newProject(app, "Brushed");
  const before = Object.values(app.state().projects)[0];
  const head = cols(app)[0].querySelector(".board-col-head");

  touch(app, "pointerdown", 1, 100, 100, head);
  touch(app, "pointermove", 1, 160, 100, app.document);   // moved straight away
  await app.wait(500);                                    // past the threshold
  touch(app, "pointermove", 1, 220, 140, app.document);
  touch(app, "pointerup", 1, 220, 140, app.document);

  const after = Object.values(app.state().projects)[0];
  assert.equal(after.x, before.x, "the card stayed put");
  assert.equal(after.y, before.y);
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

/* ---------------- moving and stretching a bar ---------------- */

function barPointer(app, type, x, ptype) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.clientX = x; ev.clientY = 50; ev.pointerType = ptype || "mouse";
  return ev;
}
const theBar = (app, id) => app.document.querySelector('#wfGrid .wf-bar[data-task="' + id + '"]');
const storedTask = (app, id) => JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).tasks[id];

test("marking a task done from the timeline crosses its bar out at once", () => {
  // It used to redraw only the board, so the bar stayed uncrossed until a
  // reload - the two views are of one set of rows.
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Thing", start: dayKeyFrom(0), end: dayKeyFrom(3) }]) });
  openWorkflow(app);
  assert.ok(!theBar(app, "t1").classList.contains("is-done"));

  theBar(app, "t1").click();
  [...app.document.querySelectorAll(".menu-pop button")]
    .find((b) => /Mark as done/.test(b.textContent)).click();

  assert.ok(theBar(app, "t1").classList.contains("is-done"), "crossed out without a reload");
});

test("dragging a bar sideways moves the whole span, by the day", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Thing", start: dayKeyFrom(0), end: dayKeyFrom(3) }]) });
  openWorkflow(app);
  const before = storedTask(app, "t1");

  const bar = theBar(app, "t1");
  bar.dispatchEvent(barPointer(app, "pointerdown", 0));
  app.document.dispatchEvent(barPointer(app, "pointermove", (92 / 7) * 5));
  app.document.dispatchEvent(barPointer(app, "pointerup", (92 / 7) * 5));

  const after = storedTask(app, "t1");
  assert.equal(after.start, dayKeyFrom(5), "columns are weeks, but you place it by day");
  assert.equal(after.end, dayKeyFrom(8), "and the span keeps its length");
  assert.ok(after.updated_at > before.updated_at, "stamped, or the move never pushes");
});

test("dragging the end of a bar stretches it and leaves the start alone", () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Thing", start: dayKeyFrom(0), end: dayKeyFrom(3) }]) });
  openWorkflow(app);

  const grip = theBar(app, "t1").querySelector(".wf-bar-grip");
  assert.ok(grip, "there is an end to grab");
  grip.dispatchEvent(barPointer(app, "pointerdown", 0));
  app.document.dispatchEvent(barPointer(app, "pointermove", (92 / 7) * 7));
  app.document.dispatchEvent(barPointer(app, "pointerup", (92 / 7) * 7));

  const after = storedTask(app, "t1");
  assert.equal(after.start, dayKeyFrom(0), "the start does not move");
  assert.equal(after.end, dayKeyFrom(10));
});

test("a finger has to hold a bar before it moves, or every swipe would drag one", async () => {
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Thing", start: dayKeyFrom(0), end: dayKeyFrom(3) }]) });
  openWorkflow(app);

  // Straight into a sideways move: that is a scroll through the weeks.
  theBar(app, "t1").dispatchEvent(barPointer(app, "pointerdown", 0, "touch"));
  app.document.dispatchEvent(barPointer(app, "pointermove", 60, "touch"));
  await app.wait(500);
  app.document.dispatchEvent(barPointer(app, "pointermove", 120, "touch"));
  app.document.dispatchEvent(barPointer(app, "pointerup", 120, "touch"));
  assert.equal(storedTask(app, "t1").start, dayKeyFrom(0), "nothing moved");

  // Held first, then moved.
  theBar(app, "t1").dispatchEvent(barPointer(app, "pointerdown", 0, "touch"));
  await app.wait(500);
  app.document.dispatchEvent(barPointer(app, "pointermove", (92 / 7) * 2, "touch"));
  app.document.dispatchEvent(barPointer(app, "pointerup", (92 / 7) * 2, "touch"));
  assert.equal(storedTask(app, "t1").start, dayKeyFrom(2), "held, so it moved");
});

test("a press that moves nothing still opens the task menu", () => {
  // The end of a drag re-renders, which would replace the bar before the
  // click that follows a plain press - and that click is the menu.
  const app = loadApp({ fetchImpl: idle,
    localStorageSeed: boardSeed([{ title: "Thing", start: dayKeyFrom(0), end: dayKeyFrom(3) }]) });
  openWorkflow(app);

  const bar = theBar(app, "t1");
  bar.dispatchEvent(barPointer(app, "pointerdown", 0));
  app.document.dispatchEvent(barPointer(app, "pointerup", 0));
  bar.click();
  assert.ok(app.document.querySelector(".menu-pop"), "the menu still opens");
});
