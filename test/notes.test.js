"use strict";
/*
 * Notes: a sub-tab of Journal, and the task-to-note link.
 *
 * Notes are their own synced rows on the same generic item path as projects
 * and tasks - not a field on a day, because a note outlives the day it was
 * written on. A task points at one by id, which is what makes the link
 * survive a rename and travel between devices.
 *
 * Deliberately not [[wikilinks]]: agreed scope is task-to-note links only.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, SCHEMA } = require("./lib.js");
after(closeAllApps);

const idle = async () => ({ ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) });

function openNotes(app) {
  app.goTo("journal");
  app.document.querySelector('[data-jsub="notes"]').click();
  return app;
}
const noteCards = (app) => [...app.document.querySelectorAll("#noteBox .note-card")];
const noteTitles = (app) => noteCards(app).map((c) => c.querySelector(".note-title").textContent);
const openCard = (app) => app.document.querySelector("#noteBox .note-card.is-open");

function newNote(app, title, body) {
  app.click("noteAddBtn");
  const card = openCard(app);
  const t = card.querySelector(".note-title-in");
  t.value = title;
  t.dispatchEvent(new app.window.Event("input", { bubbles: true }));
  if (body !== undefined) {
    const b = card.querySelector("textarea");
    b.value = body;
    b.dispatchEvent(new app.window.Event("input", { bubbles: true }));
  }
  return card;
}

/* Board helpers - a task is what a note gets linked to. */
function newProject(app, name) {
  app.goTo("tasks");
  app.click("projectAddBtn");
  const col = [...app.document.querySelectorAll("#board .board-col")].pop();
  app.window.prompt = () => name;
  col.querySelector(".board-name").click();
  return [...app.document.querySelectorAll("#board .board-col")]
    .find((c) => c.querySelector(".board-name").textContent === name);
}
function addTask(app, col, title) {
  const input = col.querySelector(".board-add input");
  input.value = title;
  input.dispatchEvent(new app.window.KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }));
}
function taskMenu(app) {
  app.document.querySelector(".btask .btask-menu").click();
  return [...app.document.querySelectorAll(".menu-pop button")];
}
const pick = (buttons, re) => buttons.find((b) => re.test(b.textContent));

/* ---------------- the tab ---------------- */

test("Notes is a sub-tab of Journal, not a tab of its own", () => {
  const app = loadApp({ fetchImpl: idle });
  const bar = [...app.document.querySelectorAll("#tabs button")].map((b) => b.getAttribute("data-nav"));
  assert.equal(bar.includes("notes"), false, "the bottom bar is already full");

  app.goTo("journal");
  assert.ok(app.document.querySelector('#journalSubTabs [data-jsub="notes"]'));
  assert.ok(app.document.getElementById("jsub-journal").classList.contains("active"),
    "the journal is what the tab opens on");

  app.document.querySelector('[data-jsub="notes"]').click();
  assert.ok(app.document.getElementById("jsub-notes").classList.contains("active"));
  assert.ok(!app.document.getElementById("jsub-journal").classList.contains("active"));
});

test("the sub-tab you were last on is remembered, per device", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  assert.equal(app.window.localStorage.getItem("yawarLastJournalSub"), "notes");
  assert.ok(!JSON.stringify(app.state() || {}).includes("yawarLastJournalSub"),
    "where you were looking is not part of the health record");

  const again = loadApp({ fetchImpl: idle, localStorageSeed: {
    yawarLastJournalSub: "notes", yawarLastTab: "journal" } });
  assert.ok(again.document.getElementById("jsub-notes").classList.contains("active"));
});

test("the journal's cards can still be rearranged, now they sit in a sub-view", () => {
  // layoutGrid looks one level into a sub-view for exactly this reason.
  const app = loadApp({ fetchImpl: idle });
  const grid = app.document.querySelector("#view-journal > .subview > .grid");
  assert.ok(grid, "the cards are still one grid");
  assert.ok(grid.querySelectorAll(":scope > .card[data-card]").length >= 2);
});

/* ---------------- writing a note ---------------- */

test("a note can be written, and it is its own synced row", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  assert.match(app.document.getElementById("noteBox").textContent, /No notes yet/);

  newNote(app, "Move plan", "Van at 9, keys back by 5.");

  const s = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  const note = Object.values(s.notes)[0];
  assert.equal(s.schema, SCHEMA);
  assert.equal(note.title, "Move plan");
  assert.equal(note.body, "Van at 9, keys back by 5.");
  assert.ok(note.updated_at > 0, "stamped, so it syncs");
  assert.equal(note.deleted, 0);
  assert.ok(!s.profile.notes, "and none of it is on the profile blob");
  assert.equal(Object.keys(s.days).length === 0 || !JSON.stringify(s.days).includes("Move plan"), true,
    "a note is not a day's entry");
});

test("a note with no title is listed by its first line rather than as Untitled", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "", "Ask about the boiler service\nand the meter reading");
  openCard(app).querySelector(".note-head").click();      // fold it
  assert.deepEqual(noteTitles(app), ["Ask about the boiler service"]);
});

test("notes are listed most-recently-touched first", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "First", "a");
  openCard(app).querySelector(".note-head").click();
  newNote(app, "Second", "b");
  openCard(app).querySelector(".note-head").click();
  assert.deepEqual(noteTitles(app), ["Second", "First"]);
});

test("tapping a note opens it; tapping it again folds it away", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Something", "body text");
  const head = openCard(app).querySelector(".note-head");
  head.click();
  assert.equal(openCard(app), null, "folded");
  assert.match(app.document.getElementById("noteBox").textContent, /body text/, "with a preview");

  noteCards(app)[0].querySelector(".note-head").click();
  assert.ok(openCard(app), "and open again");
});

test("search filters on the title and the body alike", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Boiler", "annual service due");
  openCard(app).querySelector(".note-head").click();
  newNote(app, "Van hire", "book for Saturday");
  openCard(app).querySelector(".note-head").click();

  app.setInput("noteSearch", "service");
  assert.deepEqual(noteTitles(app), ["Boiler"]);

  app.setInput("noteSearch", "saturday");
  assert.deepEqual(noteTitles(app), ["Van hire"], "and it is not case sensitive");

  app.setInput("noteSearch", "nothing here");
  assert.match(app.document.getElementById("noteBox").textContent, /Nothing matches/);
});

test("deleting a note leaves a tombstone rather than a gap", () => {
  // A row that simply disappeared would be pushed back by the next device
  // that still holds it.
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Old thing", "");
  app.window.confirm = () => true;
  [...openCard(app).querySelectorAll("button")].find((b) => /Delete note/.test(b.textContent)).click();

  assert.equal(noteCards(app).length, 0);
  const stored = Object.values(JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).notes)[0];
  assert.equal(stored.deleted, 1);
});

test("an open note is not rebuilt under the cursor by a sync redraw", () => {
  // renderAll() runs after a sync pull replaces the whole store, and this is
  // one of the places you might be mid-sentence.
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Draft", "");
  const body = openCard(app).querySelector("textarea");
  body.focus();
  body.value = "half a sentence";
  body.dispatchEvent(new app.window.Event("input", { bubbles: true }));

  app.window.renderAll ? app.window.renderAll() : null;
  assert.equal(app.document.activeElement, body, "the same element is still focused");
  assert.equal(body.value, "half a sentence", "and still holds what was typed");
});

/* ---------------- linking a task to a note ---------------- */

test("a task can be given a new note made from its own title", () => {
  const app = loadApp({ fetchImpl: idle });
  addTask(app, newProject(app, "House"), "Chase the surveyor");

  pick(taskMenu(app), /Link a note/).click();
  pick([...app.document.querySelectorAll(".menu-pop button")], /New note from this task/).click();

  // It lands you in the note, with the task's title already in it.
  assert.equal(app.document.querySelector(".view.active").id, "view-journal");
  assert.ok(app.document.getElementById("jsub-notes").classList.contains("active"));
  assert.equal(openCard(app).querySelector(".note-title-in").value, "Chase the surveyor");

  const s = JSON.parse(app.window.localStorage.getItem(MAIN_KEY));
  const note = Object.values(s.notes)[0];
  const task = Object.values(s.tasks)[0];
  assert.equal(task.noteId, note.id, "the link lives on the task, by id");
});

test("a task can be linked to a note that already exists, and unlinked again", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Reference", "the useful bit");
  addTask(app, newProject(app, "Work"), "Write it up");

  pick(taskMenu(app), /Link a note/).click();
  pick([...app.document.querySelectorAll(".menu-pop button")], /Reference/).click();

  const linkedId = Object.values(app.state().tasks)[0].noteId;
  assert.ok(linkedId, "linked");
  assert.equal(app.state().notes[linkedId].title, "Reference");

  // The menu now names the note it is on, and offers to let go of it.
  const items = taskMenu(app);
  assert.ok(pick(items, /Note: .*Reference/), "the ⋮ menu says which note");
  pick(items, /Note: /).click();
  pick([...app.document.querySelectorAll(".menu-pop button")], /Unlink/).click();
  assert.equal(Object.values(app.state().tasks)[0].noteId, null);
});

test("a linked task carries the note as a link, on its own line", () => {
  // Not a chip beside the title: that is the width competition a task row
  // already lost once.
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "The plan", "");
  addTask(app, newProject(app, "P"), "Do the thing");
  pick(taskMenu(app), /Link a note/).click();
  pick([...app.document.querySelectorAll(".menu-pop button")], /The plan/).click();

  const link = app.document.querySelector(".btask .btask-note");
  assert.ok(link, "the row shows its note");
  assert.match(link.textContent, /The plan/);
  assert.equal(link.parentNode.className, "btask-main", "stacked under the title, not beside it");

  link.click();
  assert.equal(app.document.querySelector(".view.active").id, "view-journal");
  assert.equal(openCard(app).querySelector(".note-title-in").value, "The plan");
});

test("a note says which tasks point at it", () => {
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Shared note", "");
  const col = newProject(app, "P");
  addTask(app, col, "One");
  addTask(app, app.document.querySelector(".board-col"), "Two");

  [...app.document.querySelectorAll(".btask")].forEach((row) => {
    row.querySelector(".btask-menu").click();
    pick([...app.document.querySelectorAll(".menu-pop button")], /Link a note|Note: /).click();
    pick([...app.document.querySelectorAll(".menu-pop button")], /Shared note/).click();
  });

  app.goTo("journal");
  app.document.querySelector('[data-jsub="notes"]').click();
  assert.match(noteCards(app)[0].querySelector(".note-badge").textContent, /2 tasks/);

  // It is already open - newNote leaves you in it - so only tap to open it.
  if (!openCard(app)) noteCards(app)[0].querySelector(".note-head").click();
  const links = openCard(app).querySelector(".note-links");
  assert.match(links.textContent, /One/);
  assert.match(links.textContent, /Two/);
});

test("deleting a note lets go of every task that pointed at it", () => {
  // A task linked to a note that no longer exists would render nothing and
  // look broken.
  const app = openNotes(loadApp({ fetchImpl: idle }));
  newNote(app, "Doomed", "");
  addTask(app, newProject(app, "P"), "Attached");
  pick(taskMenu(app), /Link a note/).click();
  pick([...app.document.querySelectorAll(".menu-pop button")], /Doomed/).click();
  assert.ok(Object.values(app.state().tasks)[0].noteId);

  app.goTo("journal");
  app.document.querySelector('[data-jsub="notes"]').click();
  if (!openCard(app)) noteCards(app)[0].querySelector(".note-head").click();
  app.window.confirm = () => true;
  [...openCard(app).querySelectorAll("button")].find((b) => /Delete note/.test(b.textContent)).click();

  const task = Object.values(app.state().tasks)[0];
  assert.equal(task.noteId, null, "the link is let go, not left dangling");
  assert.ok(task.updated_at > 1, "and that is stamped too, so it pushes");
});

test("notes ride the same sync path as projects and tasks", async () => {
  const { createMockServer, fetchImplFor, DEFAULT_ACCOUNT } = require("./mockServer.js");
  const server = createMockServer();
  const app = openNotes(loadApp({ fetchImpl: fetchImplFor(server), localStorageSeed: {
    [MAIN_KEY]: JSON.stringify({ schema: SCHEMA, profile: { updated_at: 1 }, days: {},
      projects: {}, tasks: {}, notes: {}, account: DEFAULT_ACCOUNT,
      sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null } }),
  } }));
  newNote(app, "Pushed", "goes up");
  app.goTo("settings");
  app.click("syncNowBtn");
  await app.flush();

  assert.equal(Object.keys(server._items.notes).length, 1, "the note reached the server");

  // And a note made on another device comes back down.
  server._items.notes.other = { data: JSON.stringify({
    id: "other", title: "From elsewhere", body: "", updated_at: Date.now(), deleted: 0 }),
    updated_at: Date.now(), deleted: 0 };
  app.click("syncNowBtn");
  await app.flush();
  openNotes(app);
  assert.ok(noteTitles(app).includes("From elsewhere"));
});
