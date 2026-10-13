"use strict";
/*
 * The Workflow Planner, ported from the workflow-porting package and run here
 * as the real index.html in jsdom with nothing injected. The tests follow the
 * package's own ACCEPTANCE-CHECKLIST.md, plus what is different by design:
 * the planner's tasks are the board's own synced rows, not a store of its own.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, SCHEMA } = require("./lib.js");
after(closeAllApps);

const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

/** A YYYY-MM-DD key n days from today, in local time like the app's own. */
function dayKey(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function task(id, projectId, title, s, e, extra) {
  return Object.assign({ id, projectId, title, done: false, order: 0, due: null,
    start: s == null ? null : dayKey(s), end: e == null ? null : dayKey(e),
    calendarEventId: null, scheduled: false, noteId: null, updated_at: 1, deleted: 0 }, extra || {});
}
const P1 = { id: "p1", name: "Website", color: "#a78bfa", order: 0, updated_at: 1, deleted: 0 };
const P2 = { id: "p2", name: "Ops", color: "#fb7185", order: 1, updated_at: 1, deleted: 0 };
/** The board as most tests want it: a dependency chain with a milestone in
 * one project, and in the other a weekly task, an overdue one, an undated one
 * and a finished one. */
function standardTasks() {
  return [
    task("a1", "p1", "Define requirements", -2, 1, { progress: 65, order: 0 }),
    task("a2", "p1", "Approve design", 2, 4, { progress: 20, dependencies: ["a1"], order: 1 }),
    task("a3", "p1", "Launch", 6, 6, { milestone: true, dependencies: ["a2"], order: 2 }),
    task("b1", "p2", "Weekly review", 0, 0, { recurrence: "weekly", seriesId: "b1", order: 0 }),
    task("b2", "p2", "Invoice run", -5, -3, { progress: 40, order: 1 }),
    task("b4", "p2", "Renew insurance", null, null, { order: 2 }),
    task("b5", "p2", "Old filing", -20, -18, { done: true, progress: 100, completedAt: "2026-01-02T10:00:00.000Z", order: 3 }),
  ];
}
function seed(tasks, projects, extraKeys) {
  const pmap = {};
  (projects || [P1, P2]).forEach((p) => { pmap[p.id] = Object.assign({}, p); });
  const tmap = {};
  (tasks || standardTasks()).forEach((t) => { tmap[t.id] = t; });
  return Object.assign({ [MAIN_KEY]: JSON.stringify({
    schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] },
    days: {}, projects: pmap, tasks: tmap,
    sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com",
  }) }, extraKeys || {});
}
function load(tasks, projects, opts) {
  return loadApp(Object.assign({ fetchImpl: idle, localStorageSeed: seed(tasks, projects) }, opts || {}));
}
function openPlanner(app) {
  app.goTo("workflow");
  fire(app, app.document.querySelector('[data-wsub="planner"]'));
  return app;
}

const $ = (app, sel) => app.document.querySelector(sel);
const $$ = (app, sel) => [...app.document.querySelectorAll(sel)];
function fire(app, el, init) {
  el.dispatchEvent(new app.window.MouseEvent("click", Object.assign({ bubbles: true, cancelable: true }, init || {})));
}
function pointer(app, type, target, x, y, pointerType) {
  const ev = new app.window.Event(type, { bubbles: true, cancelable: true });
  ev.pointerId = 7; ev.clientX = x; ev.clientY = y || 10; ev.pointerType = pointerType || "mouse";
  target.dispatchEvent(ev);
  return ev;
}
const bars = (app, id) => $$(app, `#wfp .gantt-bar[data-id="${id}"]`);
const label = (app, id) => $(app, `#wfp .gantt-task-label[data-task-id="${id}"]`);
const stored = (app, id) => app.state().tasks[id];
const dialog = (app) => $(app, "#wfpDialog");
const dialogOpen = (app) => dialog(app).hasAttribute("open");
function openTaskMenu(app, id) { fire(app, label(app, id).querySelector(".more-btn")); }
function openProjectMenu(app, pid) {
  fire(app, $(app, `#wfp .gantt-project-row[data-project="${pid}"] .more-btn`));
}
function menuItem(app, text) {
  const b = $$(app, ".wfp-pop button").find((x) => x.textContent === text || x.textContent.startsWith(text));
  assert.ok(b, `menu item "${text}" - have: ${$$(app, ".wfp-pop button").map((x) => x.textContent).join(" | ")}`);
  return b;
}
function setVal(app, id, value, type) {
  const el = app.document.getElementById(id);
  el.value = value;
  el.dispatchEvent(new app.window.Event(type || "change", { bubbles: true }));
}

/* ---------------- the switch, and what the planner reads ---------------- */

test("Workflow carries a Timeline | Planner switch, remembered per device and never in the record", () => {
  const app = load();
  app.goTo("workflow");
  assert.ok($(app, "#wsub-timeline").classList.contains("active"), "the original Timeline is what opens first");
  assert.ok(!$(app, "#wsub-planner").classList.contains("active"));

  fire(app, $(app, '[data-wsub="planner"]'));
  assert.ok($(app, "#wsub-planner").classList.contains("active"));
  assert.equal(app.window.localStorage.getItem("yawarLastWorkflowSub"), "planner");
  assert.doesNotMatch(app.rawMain(), /planner|yawarLast/, "which sub-tab is showing is a display preference");

  const again = loadApp({ fetchImpl: idle, localStorageSeed: seed(null, null,
    { yawarLastTab: "workflow", yawarLastWorkflowSub: "planner" }) });
  assert.ok(again.document.getElementById("wsub-planner").classList.contains("active"), "and it reopens there");
});

test("the planner draws the board's own rows: dated tasks as bars, undated ones listed, done ones archived", () => {
  const app = openPlanner(load());
  assert.equal(bars(app, "a1").length, 1);
  assert.equal(bars(app, "b2").length, 1);
  assert.equal(bars(app, "b4").length, 0, "an undated task has nothing to plot");
  assert.equal(bars(app, "b5").length, 0, "a finished task has left the chart");
  assert.ok($(app, '#wfpUndated [data-task="b4"]'), "...but is listed as not on the timeline");
  assert.ok($(app, '#wfpArchive [data-task="b5"]'), "...and the finished one is in the archive");
  assert.equal($(app, '#wfp .gantt-project-row[data-project="p1"] .gantt-project-title').textContent, "Website",
    "project names are the board's");
});

test("nothing is drawn while the planner is hidden, and showing it draws it", () => {
  const app = load();
  app.goTo("workflow");
  assert.equal($(app, "#wfpChart").children.length, 0, "a cell per day per row is not built for a hidden tab");
  fire(app, $(app, '[data-wsub="planner"]'));
  assert.ok(bars(app, "a1").length);
});

test("a task ticked done on the board leaves the planner's chart for its archive", () => {
  const app = openPlanner(load());
  assert.equal(bars(app, "a1").length, 1);
  app.goTo("tasks");
  const row = $$(app, "#board .btask").find((r) => r.textContent.includes("Define requirements"));
  const cb = row.querySelector("input[type=checkbox]");
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  app.goTo("workflow");
  assert.equal(bars(app, "a1").length, 0);
  assert.ok($(app, '#wfpArchive [data-task="a1"]'));
});

/* ---------------- adding and editing ---------------- */

test("a task added in the planner is a board task", () => {
  const app = openPlanner(load());
  fire(app, $(app, '#wfp [data-wfp="add-task"]'));
  assert.ok(dialogOpen(app));
  assert.equal($(app, "#wfpDialogTitle").textContent, "Add workflow task");
  assert.equal($(app, "#wfpDialogStart").value, dayKey(0), "a new task starts today");
  $(app, "#wfpDialogName").value = "Write copy";
  setVal(app, "wfpDialogProject", "p1");
  $(app, "#wfpDialogStart").value = dayKey(1);
  $(app, "#wfpDialogEnd").value = dayKey(3);
  setVal(app, "wfpDialogProgress", "30", "input");
  fire(app, $(app, '[data-wfp="dialog-save"]'));

  assert.equal(dialogOpen(app), false);
  const t = Object.values(app.state().tasks).find((x) => x.title === "Write copy");
  assert.ok(t, "it is a row in the board's own store");
  assert.equal(t.projectId, "p1");
  assert.equal(t.start, dayKey(1));
  assert.equal(t.end, dayKey(3));
  assert.equal(t.progress, 30);
  assert.equal(t.deleted, 0);
  app.goTo("tasks");
  assert.ok($$(app, "#board .btask").some((r) => r.textContent.includes("Write copy")), "and the board shows it");
});

test("a new project typed into the editor is created only once the save succeeds", () => {
  const app = openPlanner(load());
  fire(app, $(app, '#wfp [data-wfp="new-project"]'));
  assert.equal($(app, "#wfpDialogProject").value, "__new__");
  assert.equal($(app, "#wfpDialogNewProject").hidden, false);
  $(app, "#wfpDialogNewProject").value = "Garden";
  fire(app, $(app, '[data-wfp="dialog-save"]'));   // no task name yet
  assert.ok(dialogOpen(app), "refused");
  assert.match(app.statusText(), /task name/);
  assert.ok(!Object.values(app.state().projects).some((p) => p.name === "Garden"),
    "a refused save leaves no empty project on the board");

  $(app, "#wfpDialogName").value = "Plant bulbs";
  fire(app, $(app, '[data-wfp="dialog-save"]'));
  const p = Object.values(app.state().projects).find((x) => x.name === "Garden");
  assert.ok(p, "now it exists, as a board project");
  assert.equal(Object.values(app.state().tasks).find((t) => t.title === "Plant bulbs").projectId, p.id);
});

test("the editor refuses a finish before the start", () => {
  const app = openPlanner(load());
  fire(app, $(app, '#wfp [data-wfp="add-task"]'));
  $(app, "#wfpDialogName").value = "Backwards";
  $(app, "#wfpDialogStart").value = dayKey(3);
  $(app, "#wfpDialogEnd").value = dayKey(1);
  fire(app, $(app, '[data-wfp="dialog-save"]'));
  assert.ok(dialogOpen(app));
  assert.match(app.statusText(), /Finish must be on or after the start/);
  assert.ok(!Object.values(app.state().tasks).some((t) => t.title === "Backwards"));
});

test("editing a task writes back to its row, and 100% on a one-off completes it", () => {
  const app = openPlanner(load());
  fire(app, bars(app, "a2")[0]);
  assert.ok(dialogOpen(app));
  assert.equal($(app, "#wfpDialogName").value, "Approve design");
  $(app, "#wfpDialogName").value = "Approve final design";
  fire(app, $(app, '[data-wfp="dialog-save"]'));
  assert.equal(stored(app, "a2").title, "Approve final design");
  assert.ok(stored(app, "a2").updated_at > 1, "stamped, so it syncs");

  fire(app, bars(app, "a2")[0]);
  setVal(app, "wfpDialogProgress", "100", "input");
  fire(app, $(app, '[data-wfp="dialog-save"]'));
  assert.equal(stored(app, "a2").done, true);
  assert.equal(bars(app, "a2").length, 0);
  assert.match(app.statusText(), /moved to Archive/);
});

test("Set dates on an undated task opens the editor on today and puts it on the timeline", () => {
  const app = openPlanner(load());
  fire(app, $(app, '#wfpUndated [data-wfp="set-dates"][data-id="b4"]'));
  assert.ok(dialogOpen(app));
  assert.equal($(app, "#wfpDialogStart").value, dayKey(0));
  assert.equal($(app, "#wfpDialogEnd").value, dayKey(0));
  fire(app, $(app, '[data-wfp="dialog-save"]'));
  assert.equal(stored(app, "b4").start, dayKey(0));
  assert.equal(bars(app, "b4").length, 1);
  assert.equal($(app, '#wfpUndated [data-task="b4"]'), null);
});

/* ---------------- the chart ---------------- */

test("day view: today is two cells wide, and a click maps to the right date either side of it", () => {
  const app = openPlanner(load());
  const today = $(app, "#wfp .gantt-day.today");
  assert.equal(today.style.width, "144px");
  assert.equal($(app, "#wfp .gantt-day:not(.today)").style.width, "72px");

  const track = $(app, '#wfp .gantt-track[data-project="p2"]');
  const ti = Number(track.getAttribute("data-today-index"));
  track.getBoundingClientRect = () => ({ left: 0, right: 5000, top: 0, bottom: 52, width: 5000, height: 52 });
  const clickAt = (x) => {
    const cell = track.querySelectorAll(".gantt-cell")[0];
    fire(app, cell, { clientX: x });
    const v = $(app, "#wfpDialogStart").value;
    fire(app, $(app, '#wfpDialog [data-wfp="dialog-close"]'));
    return v;
  };
  assert.equal(clickAt((ti - 1) * 72 + 5), dayKey(-1), "the cell before today");
  assert.equal(clickAt(ti * 72 + 100), dayKey(0), "the second half of today's double cell is still today");
  assert.equal(clickAt(ti * 72 + 144 + 10), dayKey(1), "past today, the extra cell is accounted for");
  fire(app, track.querySelectorAll(".gantt-cell")[0], { clientX: ti * 72 + 10 });
  assert.equal($(app, "#wfpDialogProject").value, "p2", "and the row's project is preselected");
});

test("week and month views render, and the choice is kept per device, not in the record", () => {
  const app = openPlanner(load());
  setVal(app, "wfpZoomSelect", "week");
  assert.equal($(app, "#wfp .gantt-day.today").style.width, "48px");
  setVal(app, "wfpZoomSelect", "month");
  assert.equal($(app, "#wfp .gantt-day.today").style.width, "18px");
  assert.equal(JSON.parse(app.window.localStorage.getItem("yawarPlannerView")).zoom, "month");
  assert.doesNotMatch(app.rawMain(), /"zoom"|labelWidth/);
});

test("a weekly task draws an occurrence per week", () => {
  const app = openPlanner(load());
  assert.ok(bars(app, "b1").length >= 8, "eight weeks ahead at least, as the reference draws");
  const occ = bars(app, "b1").map((b) => b.getAttribute("data-occurrence"));
  assert.equal(occ[0], dayKey(0));
  assert.equal(occ[1], dayKey(7));
});

test("milestones are diamonds, and the critical path is the longest dependent chain", () => {
  const app = openPlanner(load());
  assert.ok($(app, '#wfp .gantt-milestone[data-id="a3"]'));
  assert.equal(bars(app, "a3").length, 0);
  ["a1", "a2", "a3"].forEach((id) => assert.ok(label(app, id).classList.contains("critical"), id));
  assert.ok(!label(app, "b2").classList.contains("critical"));
});

/* ---------------- moving bars ---------------- */

test("dragging a bar moves both dates by whole days; the grip moves only the finish", () => {
  const app = openPlanner(load());
  let bar = bars(app, "b2")[0];
  pointer(app, "pointerdown", bar, 100);
  pointer(app, "pointermove", bar, 100 + 72 * 3);
  pointer(app, "pointerup", bar, 100 + 72 * 3);
  assert.equal(stored(app, "b2").start, dayKey(-2));
  assert.equal(stored(app, "b2").end, dayKey(0));
  assert.match(app.statusText(), /dates moved/);

  bar = bars(app, "b2")[0];
  const grip = bar.querySelector(".gantt-resize");
  pointer(app, "pointerdown", grip, 300);
  pointer(app, "pointermove", grip, 300 - 72 * 10);
  pointer(app, "pointerup", grip, 300 - 72 * 10);
  assert.equal(stored(app, "b2").start, dayKey(-2), "the start never moves on a stretch");
  assert.equal(stored(app, "b2").end, dayKey(-2), "and the finish cannot go before it");
});

test("with a finger a bar must be held before it moves - a quick swipe is a scroll", async () => {
  const app = openPlanner(load());
  let bar = bars(app, "b2")[0];
  pointer(app, "pointerdown", bar, 100, 10, "touch");
  pointer(app, "pointermove", bar, 100 + 72 * 3, 10, "touch");
  pointer(app, "pointerup", bar, 100 + 72 * 3, 10, "touch");
  assert.equal(stored(app, "b2").start, dayKey(-5), "a swipe across a bar does not move its dates");

  bar = bars(app, "b2")[0];
  pointer(app, "pointerdown", bar, 100, 10, "touch");
  await app.wait(450);
  assert.ok(bar.classList.contains("dragging"), "held long enough, it lifts");
  pointer(app, "pointermove", bar, 100 + 72 * 2, 10, "touch");
  pointer(app, "pointerup", bar, 100 + 72 * 2, 10, "touch");
  assert.equal(stored(app, "b2").start, dayKey(-3));
});

test("a tap opens the editor on the click, and the click after a drag opens nothing", () => {
  const app = openPlanner(load());
  let bar = bars(app, "b2")[0];
  pointer(app, "pointerdown", bar, 100, 10, "touch");
  pointer(app, "pointerup", bar, 100, 10, "touch");
  assert.equal(dialogOpen(app), false,
    "not on pointerup - the click that follows would land inside the editor");
  fire(app, bar);
  assert.ok(dialogOpen(app));
  assert.equal($(app, "#wfpDialogName").value, "Invoice run");
  fire(app, $(app, '#wfpDialog [data-wfp="dialog-close"]'));
  assert.equal(dialogOpen(app), false);

  bar = bars(app, "b2")[0];
  pointer(app, "pointerdown", bar, 100);
  pointer(app, "pointermove", bar, 100 + 72);
  pointer(app, "pointerup", bar, 100 + 72);
  fire(app, bar);
  assert.equal(dialogOpen(app), false, "a drag is not also a tap");
});

test("tasks reorder by their handle, including into another project", () => {
  const app = openPlanner(load());
  const target = label(app, "b2");
  target.getBoundingClientRect = () => ({ top: 100, height: 40, bottom: 140, left: 0, right: 200, width: 200 });
  app.document.elementFromPoint = () => target;
  const handle = label(app, "a1").querySelector("[data-wfp-task-drag]");
  pointer(app, "pointerdown", handle, 10, 50);
  pointer(app, "pointermove", handle, 10, 130);
  assert.ok(target.classList.contains("reorder-after"));
  pointer(app, "pointerup", handle, 10, 130);
  const t = stored(app, "a1");
  assert.equal(t.projectId, "p2", "it moved project");
  assert.equal(t.order, stored(app, "b2").order + 1, "directly after the row it was dropped on");
});

/* ---------------- completion, recurrence, dependencies ---------------- */

test("completing a one-off archives it; restoring brings it back", () => {
  const app = openPlanner(load());
  openTaskMenu(app, "b2");
  fire(app, menuItem(app, "Mark complete"));
  const t = stored(app, "b2");
  assert.equal(t.done, true, "completed is the board's own done");
  assert.ok(t.completedAt);
  assert.equal(bars(app, "b2").length, 0);
  fire(app, $(app, '#wfpArchive [data-wfp="restore-task"][data-id="b2"]'));
  assert.equal(stored(app, "b2").done, false);
  assert.equal(stored(app, "b2").progress, 0);
  assert.equal(bars(app, "b2").length, 1);
});

test("an archived completion still satisfies what depends on it", () => {
  const app = openPlanner(load());
  assert.match(label(app, "a2").textContent, /Blocked/);
  openTaskMenu(app, "a1");
  fire(app, menuItem(app, "Mark complete"));
  assert.doesNotMatch(label(app, "a2").textContent, /Blocked/);
});

test("a weekly task keeps its series when an occurrence is done, and one occurrence can be reopened", () => {
  const app = openPlanner(load());
  openTaskMenu(app, "b1");
  fire(app, menuItem(app, "Mark next occurrence complete"));
  let t = stored(app, "b1");
  assert.deepEqual(t.completedOccurrences, [dayKey(0)]);
  assert.equal(t.done, false, "the series stays active");
  assert.ok(bars(app, "b1")[0].classList.contains("completed"));
  assert.ok(!bars(app, "b1")[1].classList.contains("completed"));

  openTaskMenu(app, "b1");
  fire(app, menuItem(app, "Reopen completed occurrence"));
  fire(app, menuItem(app, "Reopen "));
  t = stored(app, "b1");
  assert.deepEqual(t.completedOccurrences, []);
});

test("a circular dependency is refused, in the menu and in the editor", () => {
  const app = openPlanner(load());
  openTaskMenu(app, "a1");
  fire(app, menuItem(app, "Dependencies"));
  fire(app, menuItem(app, "Website — Approve design"));
  assert.deepEqual(stored(app, "a1").dependencies || [], []);
  assert.match(app.statusText(), /circular/);

  fire(app, bars(app, "a1")[0]);
  const box = $(app, '#wfpDialogDependencies input[value="a2"]');
  assert.ok(box.disabled);
  assert.match(box.parentNode.textContent, /circular/);
});

test("deleting a task asks first, and strips it from whatever depended on it", () => {
  const app = openPlanner(load());
  app.window.confirm = () => false;
  openTaskMenu(app, "a1");
  fire(app, menuItem(app, "Delete task"));
  assert.equal(stored(app, "a1").deleted, 0, "declined");
  app.window.confirm = () => true;
  openTaskMenu(app, "a1");
  fire(app, menuItem(app, "Delete task"));
  assert.equal(stored(app, "a1").deleted, 1, "a tombstone, not a removal, so sync carries it");
  assert.deepEqual(stored(app, "a2").dependencies, []);
});

/* ---------------- projects ---------------- */

test("rename, colour, archive and restore all land on the board's own project row", () => {
  const app = openPlanner(load());
  app.window.prompt = () => "Website v2";
  openProjectMenu(app, "p1");
  fire(app, menuItem(app, "Rename project"));
  assert.equal(app.state().projects.p1.name, "Website v2");

  openProjectMenu(app, "p1");
  fire(app, menuItem(app, "Project colour"));
  fire(app, $(app, '.wfp-pop [data-wfp="set-colour"][data-colour="#4F8CFF"]'));
  assert.equal(app.state().projects.p1.color, "#4F8CFF", "the same colour the board's card uses");

  openProjectMenu(app, "p1");
  fire(app, menuItem(app, "Archive project"));
  assert.equal(app.state().projects.p1.archived, true);
  assert.equal(bars(app, "a1").length, 0);
  assert.ok($(app, '#wfpArchive [data-project="p1"]'));
  fire(app, $(app, '#wfpArchive [data-wfp="restore-project"]'));
  assert.equal(app.state().projects.p1.archived, false);
  assert.equal(bars(app, "a1").length, 1);
});

test("projects reorder by the menu, swapping only the two that moved", () => {
  const app = openPlanner(load());
  openProjectMenu(app, "p2");
  fire(app, menuItem(app, "Move up"));
  const ps = app.state().projects;
  assert.ok(ps.p2.order < ps.p1.order);
  const rows = $$(app, "#wfp .gantt-project-row").map((r) => r.getAttribute("data-project"));
  assert.deepEqual(rows, ["p2", "p1"]);
});

test("deleting a project asks first and takes its tasks with it", () => {
  const extra = task("c1", "p2", "Needs a1", 3, 4, { dependencies: ["a1"] });
  const app = openPlanner(load(standardTasks().concat([extra])));
  app.window.confirm = () => false;
  openProjectMenu(app, "p1");
  fire(app, menuItem(app, "Delete project and tasks"));
  assert.equal(app.state().projects.p1.deleted, 0);
  app.window.confirm = () => true;
  openProjectMenu(app, "p1");
  fire(app, menuItem(app, "Delete project and tasks"));
  const s = app.state();
  assert.equal(s.projects.p1.deleted, 1);
  ["a1", "a2", "a3"].forEach((id) => assert.equal(s.tasks[id].deleted, 1, id));
  assert.deepEqual(s.tasks.c1.dependencies, [], "nothing is left depending on a deleted task");
});

/* ---------------- filters and metrics ---------------- */

test("search, project and status filters combine; a metric card toggles back to All", () => {
  const app = openPlanner(load());
  setVal(app, "wfpSearch", "approve", "input");
  assert.equal($(app, "#wfpShownCount").textContent, "1 task shown");
  setVal(app, "wfpSearch", "", "input");
  setVal(app, "wfpProjectFilter", "p2");
  assert.equal($(app, "#wfpShownCount").textContent, "2 tasks shown");
  setVal(app, "wfpProjectFilter", "all");

  const overdue = $(app, '#wfp [data-wfp="set-status"][data-status="overdue"]');
  fire(app, overdue);
  assert.equal($(app, "#wfpStatusFilter").value, "overdue");
  assert.ok($(app, '#wfp [data-status="overdue"]').classList.contains("wfp-on"));
  assert.deepEqual($$(app, "#wfp .gantt-task-label").map((l) => l.getAttribute("data-task-id")), ["b2"]);
  fire(app, $(app, '#wfp [data-wfp="set-status"][data-status="overdue"]'));
  assert.equal($(app, "#wfpStatusFilter").value, "all", "pressing the active card again shows everything");
});

test("the 3-day and 7-day rings count occurrences, finished ones included", () => {
  const app = openPlanner(load([
    task("x1", "p1", "Due today", -1, 0),
    task("x2", "p1", "Done, due tomorrow", 0, 1, { done: true, progress: 100 }),
    task("x3", "p1", "Due in five", 2, 5),
    task("x4", "p1", "Weekly", 0, 0, { recurrence: "weekly", completedOccurrences: [dayKey(0)] }),
  ]));
  // 3 days: x1 (today), x4 today (done), x2 (tomorrow, done) -> 2 of 3.
  assert.equal($(app, "#wfpFocusCount").textContent, "3");
  assert.equal($(app, "#wfpFocusPct").textContent, "67%");
  assert.equal($(app, "#wfpFocusMeta").textContent, "2 today · 1 tomorrow · 0 day after");
  // 7 days: those three, x3, and x4's next occurrence -> 2 of 5.
  assert.equal($(app, "#wfpWeekCount").textContent, "5");
  assert.equal($(app, "#wfpWeekPct").textContent, "40%");
});

test("at risk counts blocked work and nearly-due slow work, as a share of what is open", () => {
  const app = openPlanner(load([
    task("r1", "p1", "Close and slow", 0, 2, { progress: 10 }),
    task("r2", "p1", "Far off", 0, 10),
    task("r3", "p1", "Waiting on r2", 0, 20, { dependencies: ["r2"] }),
  ]));
  assert.equal($(app, "#wfpRisk").textContent, "2");
  assert.equal($(app, "#wfpRiskPct").textContent, "67%");
  assert.equal($(app, "#wfpRiskMeta").textContent, "2 of 3 open tasks");
});

/* ---------------- focus, theme, isolation, persistence ---------------- */

test("Focus is the app's full screen, and is never persisted", () => {
  const app = openPlanner(load());
  fire(app, $(app, '#wfp [data-wfp="focus"]'));
  assert.ok(app.document.body.classList.contains("tasks-full"));
  assert.equal($(app, "#wfpFocusBtn").textContent, "Exit focus");
  fire(app, $(app, '#wfp [data-wfp="focus"]'));
  assert.ok(!app.document.body.classList.contains("tasks-full"));
  const keys = Object.keys(app.window.localStorage);
  assert.ok(!keys.some((k) => /focus/i.test(k)), keys.join(","));
});

test("the planner's palette follows the app's own light/dark switch", () => {
  const app = openPlanner(load());
  app.document.documentElement.setAttribute("data-theme", "dark");
  app.goTo("settings");
  app.click("themeToggle");
  assert.equal(app.document.documentElement.getAttribute("data-theme"), "light");
  assert.ok($(app, "#wfp").classList.contains("wfp-light"));
  app.click("themeToggle");
  assert.ok(!$(app, "#wfp").classList.contains("wfp-light"));
});

test("the planner never wears this app's generic classes, so neither side's styles reach the other", () => {
  const app = openPlanner(load());
  for (const cls of ["card", "btn", "stat", "grid", "count", "muted", "active"]) {
    assert.equal(app.document.querySelectorAll("#wfp ." + cls).length, 0, "." + cls);
  }
  openTaskMenu(app, "a1");
  assert.ok($(app, ".wfp-pop").parentNode === app.document.body, "menus sit outside the scroll box");
});

test("a swipe across the phone's metric strip or the chart never changes tab", () => {
  const app = openPlanner(load());
  const strip = $(app, "#wfp .workflow-stats");
  const fireTouch = (type, x) => {
    const ev = new app.window.Event(type, { bubbles: true });
    ev.touches = [{ clientX: x, clientY: 200 }];
    ev.changedTouches = [{ clientX: x, clientY: 200 }];
    strip.dispatchEvent(ev);
  };
  fireTouch("touchstart", 300);
  fireTouch("touchend", 60);
  assert.ok($(app, "#view-workflow").classList.contains("active"));
  assert.ok($(app, "#wsub-planner").classList.contains("active"), "not even across to the Timeline");
});

test("nothing is written under the reference's storage keys, and view settings stay out of the record", () => {
  const app = openPlanner(load());
  setVal(app, "wfpZoomSelect", "week");
  setVal(app, "wfpSearch", "invoice", "input");
  openTaskMenu(app, "b2");
  fire(app, menuItem(app, "Mark complete"));
  const keys = Object.keys(app.window.localStorage);
  assert.ok(!keys.some((k) => k.startsWith("portableWorkflowDemo_")), keys.join(","));
  const raw = app.rawMain();
  assert.doesNotMatch(raw, /workflowTasks|workflowProjectOrder|"search"|"zoom"/);
});

/* ---------------- another tab ---------------- */

test("another tab's newer edit merges in; an older one, or another account's, does not", () => {
  const app = openPlanner(load());
  const send = (mutate) => {
    const other = JSON.parse(app.rawMain());
    mutate(other);
    app.window.dispatchEvent(new app.window.StorageEvent("storage", { key: MAIN_KEY, newValue: JSON.stringify(other) }));
  };
  send((o) => { o.tasks.b2.title = "From the other tab"; o.tasks.b2.updated_at = Date.now() + 1000; });
  assert.match(label(app, "b2").textContent, /From the other tab/);

  send((o) => { o.tasks.b2.title = "Stale"; o.tasks.b2.updated_at = 2; });
  assert.match(label(app, "b2").textContent, /From the other tab/, "an older row never wins");

  send((o) => { o.account = "someone@else.com"; o.tasks.b2.title = "Theirs"; o.tasks.b2.updated_at = Date.now() + 9e6; });
  assert.match(label(app, "b2").textContent, /From the other tab/, "another account's store is not merged");
});

/* ---------------- the durability scenarios every index.html change must pass ---------------- */

test("a fresh browser: an empty planner, and the first task makes the first project", () => {
  const app = openPlanner(loadApp({ fetchImpl: idle }));
  assert.match($(app, "#wfpChart").textContent, /Your Gantt chart will appear here/);
  assert.equal($(app, "#wfpTotal").textContent, "0");
  fire(app, $(app, '#wfp [data-wfp="add-task"]'));
  assert.equal($(app, "#wfpDialogProject").value, "__new__", "with no project, a new one is the only choice");
  $(app, "#wfpDialogName").value = "First task";
  $(app, "#wfpDialogNewProject").value = "First project";
  fire(app, $(app, '[data-wfp="dialog-save"]'));
  const s = app.state();
  const p = Object.values(s.projects).find((x) => x.name === "First project");
  assert.ok(p);
  assert.equal(Object.values(s.tasks).find((t) => t.title === "First task").projectId, p.id);
  assert.equal(bars(app, Object.values(s.tasks)[0].id).length, 1);
});

test("with storage writes blocked the planner still draws and its actions do not throw", () => {
  const app = openPlanner(load(null, null, { blockStorage: true }));
  assert.ok(bars(app, "a1").length);
  openTaskMenu(app, "b2");
  fire(app, menuItem(app, "Mark complete"));
  assert.equal(bars(app, "b2").length, 0, "the change applies on screen even though it could not be saved");
  setVal(app, "wfpZoomSelect", "week");
  assert.equal($(app, "#wfp .gantt-day.today").style.width, "48px");
});
