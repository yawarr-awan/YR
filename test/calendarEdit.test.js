"use strict";
/*
 * Scheduling from the calendar itself: tapping an empty hour opens an
 * editor prefilled with that slot, tapping an entry opens it for editing or
 * deleting, and scheduled tasks appear on the grid alongside real events -
 * merged with the Google event they created rather than drawn twice.
 * Real index.html, real DOM; only the network boundary is mocked.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function jsonRes(body) { return { ok: true, status: 200, json: async () => body }; }

function keyOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function atToday(h, m) {
  const d = new Date();
  d.setHours(h, m || 0, 0, 0);
  return d.toISOString();
}

/** Routes the three endpoints the calendar touches, recording every write. */
function calendarBackend({ events = [], writeStatus = "ok" } = {}) {
  const writes = [];
  const impl = async (url, opts) => {
    const u = String(url);
    const method = (opts && opts.method) || "GET";
    if (u.includes("/api/google/calendar/events")) {
      writes.push({ method, url: u, body: opts && opts.body ? JSON.parse(opts.body) : null });
      return jsonRes({ status: writeStatus, eventId: "new-evt" });
    }
    if (u.includes("/api/calendar/events")) return jsonRes({ connected: true, status: "ok", events });
    return jsonRes({ connected: false, status: "not_connected" });
  };
  return { impl, writes };
}

async function openCalendar(app) {
  app.goTo("calendar");
  await app.flush();
  await app.flush();
  await app.flush();
}

const mainCells = (app) => app.document.querySelectorAll("#calDayCur .cal-cell.is-main:not(.cal-allday)");
const chips = (app) => app.document.querySelectorAll("#calDayCur .cal-chip");
const editorOpen = (app) => app.document.getElementById("overlay").classList.contains("open");
const editorField = (app, label) => {
  const labels = app.document.querySelectorAll("#modalBody .field");
  for (const l of labels) {
    if (l.querySelector("span").textContent === label) return l.querySelector("input,select,textarea");
  }
  return null;
};
const editorButton = (app, text) =>
  Array.from(app.document.querySelectorAll("#modalBody .actions button")).find((b) => b.textContent === text);

test("tapping an empty hour opens the editor prefilled with that day and hour", async () => {
  const app = loadApp({ fetchImpl: calendarBackend().impl });
  await openCalendar(app);

  mainCells(app)[9].click();
  assert.ok(editorOpen(app), "the editor should open on an empty slot");
  assert.match(app.document.querySelector("#modalBody h2").textContent, /New event/);
  assert.equal(editorField(app, "Starts").value, keyOf(new Date()) + "T09:00");
  assert.equal(editorField(app, "Title").value, "", "a new event starts blank");
});

test("an empty hour advertises itself as tappable", async () => {
  const app = loadApp({ fetchImpl: calendarBackend().impl });
  await openCalendar(app);
  assert.ok(mainCells(app)[9].querySelector(".cal-slot-hint"), "an empty hour should show an add hint");
});

test("saving a new event posts it and refetches the day", async () => {
  const backend = calendarBackend();
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  mainCells(app)[14].click();
  editorField(app, "Title").value = "Physio";
  editorField(app, "Length").value = "60";
  editorField(app, "Location").value = "Clinic";
  editorButton(app, "Add to calendar").click();
  await app.flush();
  await app.flush();

  const post = backend.writes.find((w) => w.method === "POST");
  assert.ok(post, "expected a POST to create the event");
  assert.equal(post.body.title, "Physio");
  assert.equal(post.body.durationMinutes, 60);
  assert.equal(post.body.location, "Clinic");
  assert.equal(new Date(post.body.start).getHours(), 14);
  assert.equal(editorOpen(app), false, "the editor closes once the write lands");
});

test("a blank title is refused without touching the network", async () => {
  const backend = calendarBackend();
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  mainCells(app)[8].click();
  editorButton(app, "Add to calendar").click();
  await app.flush();

  assert.equal(backend.writes.length, 0, "nothing should be sent without a title");
  assert.match(app.document.getElementById("calEditStatus").textContent, /title/i);
  assert.ok(editorOpen(app), "the editor stays open so the title can be typed");
});

test("tapping an event opens it filled in, and saving patches that exact event", async () => {
  const backend = calendarBackend({
    events: [{
      id: "evt1", calendarId: "primary", writable: true, title: "Lunch",
      start: atToday(12, 0), end: atToday(13, 0), calendar: "Yawar", location: "Cafe", notes: "with Sam",
    }],
  });
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  const chip = chips(app)[0];
  assert.match(chip.textContent, /Lunch/);
  chip.click();

  assert.ok(editorOpen(app));
  assert.equal(editorField(app, "Title").value, "Lunch");
  assert.equal(editorField(app, "Length").value, "60", "the length comes from the event's own end time");
  assert.equal(editorField(app, "Location").value, "Cafe");
  assert.equal(editorField(app, "Notes").value, "with Sam");

  editorField(app, "Title").value = "Lunch with Sam";
  editorButton(app, "Save").click();
  await app.flush();
  await app.flush();

  const patch = backend.writes.find((w) => w.method === "PATCH");
  assert.ok(patch, "expected a PATCH");
  assert.equal(patch.body.eventId, "evt1");
  assert.equal(patch.body.calendarId, "primary");
  assert.equal(patch.body.title, "Lunch with Sam");
});

test("an event on a calendar you can only read opens without a Save or Delete button", async () => {
  const backend = calendarBackend({
    events: [{ id: "e9", calendarId: "shared@g", writable: false, title: "Team sync", start: atToday(10, 0), calendar: "Shared" }],
  });
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  chips(app)[0].click();
  assert.ok(editorOpen(app));
  assert.equal(editorButton(app, "Save"), undefined, "a read-only calendar must not offer saving");
  assert.equal(editorButton(app, "Delete"), undefined);
  assert.match(app.document.querySelector("#modalBody").textContent, /only read/i);
});

test("deleting an event sends the calendar and event ids", async () => {
  const backend = calendarBackend({
    events: [{ id: "evt7", calendarId: "primary", writable: true, title: "Old meeting", start: atToday(11, 0) }],
  });
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  chips(app)[0].click();
  editorButton(app, "Delete").click();
  await app.flush();
  await app.flush();

  const del = backend.writes.find((w) => w.method === "DELETE");
  assert.ok(del, "expected a DELETE");
  assert.match(del.url, /eventId=evt7/);
  assert.match(del.url, /calendarId=primary/);
});

test("a write the server refuses leaves the editor open and says why", async () => {
  const backend = calendarBackend({ writeStatus: "reconnect_required" });
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  mainCells(app)[7].click();
  editorField(app, "Title").value = "Walk";
  editorButton(app, "Add to calendar").click();
  await app.flush();
  await app.flush();

  assert.ok(editorOpen(app), "a refused write must not look like it worked");
  assert.match(app.document.getElementById("calEditStatus").textContent, /Connect Google Calendar/i);
});

/* ---------- scheduled tasks on the grid ---------- */

test("a scheduled task shows on the calendar even when its event isn't in the feed", async () => {
  const app = loadApp({ fetchImpl: calendarBackend().impl });
  app.setInput("taskTitleIn", "Call the GP");
  app.click("taskAddBtn");
  const rows = app.document.querySelectorAll("#taskList .task-row");
  Array.from(rows[0].querySelectorAll("button")).find((b) => b.textContent === "📅").click();
  const when = app.document.querySelector("#taskList .task-sched input");
  const at = new Date();
  at.setHours(16, 0, 0, 0);
  when.value = keyOf(at) + "T16:00";
  Array.from(app.document.querySelectorAll("#taskList .task-sched button")).find((b) => /Add to calendar/.test(b.textContent)).click();
  await app.flush();
  await app.flush();

  await openCalendar(app);
  const taskChips = app.document.querySelectorAll("#calDayCur .cal-chip.is-task");
  assert.equal(taskChips.length, 1, "the scheduled task belongs on the grid");
  assert.match(taskChips[0].textContent, /Call the GP/);
  assert.match(taskChips[0].textContent, /Task/, "it should read as a task, not as a meeting");
});

test("a task and the Google event it created are one chip, not two", async () => {
  const at = atToday(16, 0);
  const seed = {
    schema: 3,
    profile: {
      startWeight: "", targetWeight: "", updated_at: 1,
      tasks: [{ id: "t1", title: "Call the GP", due: at, done: false, scheduled: true, calendarEventId: "evt-task", updated_at: 1 }],
    },
    days: {},
  };
  const backend = calendarBackend({
    events: [{ id: "evt-task", calendarId: "primary", writable: true, title: "Call the GP", start: at, end: atToday(16, 30), calendar: "Yawar" }],
  });
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: JSON.stringify(seed) }, fetchImpl: backend.impl });
  await openCalendar(app);

  const all = app.document.querySelectorAll("#calDayCur .cal-chip");
  assert.equal(all.length, 1, "the event and the task it came from are the same thing");
  assert.ok(all[0].classList.contains("is-task"), "and it should be marked as a task");
});

test("removing a scheduled task from the calendar unschedules it but keeps the task", async () => {
  const at = atToday(16, 0);
  const seed = {
    schema: 3,
    profile: {
      startWeight: "", targetWeight: "", updated_at: 1,
      tasks: [{ id: "t1", title: "Call the GP", due: at, done: false, scheduled: true, calendarEventId: "evt-task", updated_at: 1 }],
    },
    days: {},
  };
  const backend = calendarBackend({
    events: [{ id: "evt-task", calendarId: "primary", writable: true, title: "Call the GP", start: at, end: atToday(16, 30), calendar: "Yawar" }],
  });
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: JSON.stringify(seed) }, fetchImpl: backend.impl });
  await openCalendar(app);

  app.document.querySelectorAll("#calDayCur .cal-chip")[0].click();
  const remove = editorButton(app, "Remove from calendar");
  assert.ok(remove, "a task offers unscheduling rather than deletion");
  remove.click();
  await app.flush();
  await app.flush();

  const tasks = app.state().profile.tasks;
  assert.equal(tasks.length, 1, "the task itself survives");
  assert.equal(tasks[0].due, null);
  assert.equal(tasks[0].scheduled, false);
  assert.equal(tasks[0].calendarEventId, null);
});

test("editing a scheduled task from the calendar renames the task too", async () => {
  const at = atToday(16, 0);
  const seed = {
    schema: 3,
    profile: {
      startWeight: "", targetWeight: "", updated_at: 1,
      tasks: [{ id: "t1", title: "Call the GP", due: at, done: false, scheduled: true, calendarEventId: "evt-task", updated_at: 1 }],
    },
    days: {},
  };
  const backend = calendarBackend({
    events: [{ id: "evt-task", calendarId: "primary", writable: true, title: "Call the GP", start: at, end: atToday(16, 30), calendar: "Yawar" }],
  });
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: JSON.stringify(seed) }, fetchImpl: backend.impl });
  await openCalendar(app);

  app.document.querySelectorAll("#calDayCur .cal-chip")[0].click();
  editorField(app, "Title").value = "Call the GP about results";
  editorButton(app, "Save").click();
  await app.flush();
  await app.flush();

  assert.equal(app.state().profile.tasks[0].title, "Call the GP about results");
});

test("ticking a task from the calendar marks it done on the list", async () => {
  const at = atToday(16, 0);
  const seed = {
    schema: 3,
    profile: {
      startWeight: "", targetWeight: "", updated_at: 1,
      tasks: [{ id: "t1", title: "Call the GP", due: at, done: false, scheduled: true, calendarEventId: null, updated_at: 1 }],
    },
    days: {},
  };
  const app = loadApp({ localStorageSeed: { yawarWellness_v1: JSON.stringify(seed) }, fetchImpl: calendarBackend().impl });
  await openCalendar(app);

  app.document.querySelectorAll("#calDayCur .cal-chip")[0].click();
  const done = app.document.querySelector("#modalBody .chk input[type=checkbox]");
  done.checked = true;
  done.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  assert.equal(app.state().profile.tasks[0].done, true);
});

test("a swipe that pages the day does not also open the editor under the finger", async () => {
  const app = loadApp({ fetchImpl: calendarBackend().impl });
  await openCalendar(app);

  const cell = mainCells(app)[9];
  app.swipe("calGrid", -120, 0);
  cell.click();                      /* the click a real touch device fires next */
  assert.equal(editorOpen(app), false, "a swipe is not a tap");
});

test("a read-only event's fields are disabled, not merely unsaveable", async () => {
  const backend = calendarBackend({
    events: [{ id: "e9", calendarId: "shared@g", writable: false, title: "Team sync", start: atToday(10, 0), calendar: "Shared" }],
  });
  const app = loadApp({ fetchImpl: backend.impl });
  await openCalendar(app);

  chips(app)[0].click();
  assert.equal(editorField(app, "Title").disabled, true);
  assert.equal(editorField(app, "Location").disabled, true);
});

/* ---------- Google Tasks on the grid ---------- */

function backendWithTasks(tasks, opts) {
  const events = (opts && opts.events) || [];
  const tasksError = (opts && opts.tasksError) || null;
  return async (url) => {
    const u = String(url);
    if (u.includes("/api/calendar/events")) {
      return jsonRes({ connected: true, status: "ok", events, tasks, tasksError });
    }
    return jsonRes({ connected: false, status: "not_connected" });
  };
}

test("a dateless Google Task due that day shows on the calendar as an all-day entry", async () => {
  const today = keyOf(new Date());
  const app = loadApp({
    fetchImpl: backendWithTasks([{ id: "gt1", title: "Renew passport", due: today, allDay: true, list: "My Tasks", notes: "form C1" }]),
  });
  await openCalendar(app);

  const gchips = app.document.querySelectorAll("#calDayCur .cal-chip.is-gtask");
  assert.equal(gchips.length, 1);
  assert.match(gchips[0].textContent, /Renew passport/);
  assert.match(gchips[0].textContent, /Google Task/);
  assert.match(gchips[0].textContent, /My Tasks/, "the list it came from is worth knowing");
  assert.match(gchips[0].textContent, /All day/, "Google Tasks carry a date, not a time");
});

test("a Google Task due another day does not appear on this one", async () => {
  const other = keyOf(new Date(Date.now() + 3 * 86400000));
  const app = loadApp({ fetchImpl: backendWithTasks([{ id: "gt1", title: "Renew passport", due: other, allDay: true, list: "My Tasks" }]) });
  await openCalendar(app);
  assert.equal(app.document.querySelectorAll("#calDayCur .cal-chip.is-gtask").length, 0);
});

test("a Google Task with a time sits at that hour, not in the all-day row", async () => {
  // A 1pm task was landing in the all-day row because its due timestamp was
  // being truncated to a date.
  const app = loadApp({
    fetchImpl: backendWithTasks([{ id: "gt1", title: "Call the bank", due: atToday(13, 0), allDay: false, list: "My Tasks" }]),
  });
  await openCalendar(app);

  const hour13 = mainCells(app)[13].querySelector(".cal-chip.is-gtask");
  assert.ok(hour13, "expected it in the 13:00 row");
  assert.match(hour13.textContent, /13:00/);
  assert.equal(app.document.querySelectorAll("#calDayCur .cal-allday .cal-chip.is-gtask").length, 0);
});

test("tapping a Google Task shows its details, which stay Google's to edit", async () => {
  const today = keyOf(new Date());
  const app = loadApp({
    fetchImpl: backendWithTasks([{ id: "gt1", title: "Renew passport", due: today, allDay: true, list: "My Tasks", notes: "form C1" }]),
  });
  await openCalendar(app);

  app.document.querySelector("#calDayCur .cal-chip.is-gtask").click();
  assert.ok(editorOpen(app));
  assert.match(app.document.querySelector("#modalBody h2").textContent, /Google Task/);
  assert.equal(editorField(app, "Title").value, "Renew passport");
  assert.equal(editorField(app, "Title").disabled, true, "the title belongs to Google Tasks");
  assert.equal(editorField(app, "Notes").value, "form C1");
  assert.equal(editorButton(app, "Save"), undefined);
  assert.equal(editorButton(app, "Delete"), undefined);
  assert.match(app.document.querySelector("#modalBody").textContent, /My Tasks/);
});

test("a Google Task can be ticked off, and the tick is sent to Google", async () => {
  const today = keyOf(new Date());
  const writes = [];
  const app = loadApp({
    fetchImpl: async (url, opts) => {
      const u = String(url);
      if (u.includes("/api/google/tasks")) {
        writes.push({ method: opts.method, body: JSON.parse(opts.body) });
        return jsonRes({ status: "ok" });
      }
      if (u.includes("/api/calendar/events")) {
        return jsonRes({ connected: true, status: "ok", events: [],
          tasks: [{ id: "gt1", title: "Renew passport", due: today, allDay: true, list: "My Tasks", listId: "list1" }] });
      }
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  await openCalendar(app);

  app.document.querySelector("#calDayCur .cal-chip.is-gtask").click();
  const done = app.document.getElementById("calGtaskDone");
  assert.ok(done, "a Google Task offers a completion tick");
  assert.equal(done.disabled, false, "and it must stay usable even though the rest is read-only");
  done.checked = true;
  done.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await app.flush();
  await app.flush();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].method, "PATCH");
  assert.deepEqual(writes[0].body, { listId: "list1", taskId: "gt1", completed: true });
});

test("a refused tick puts the checkbox back rather than pretending it worked", async () => {
  const today = keyOf(new Date());
  const app = loadApp({
    fetchImpl: async (url) => {
      const u = String(url);
      if (u.includes("/api/google/tasks")) return jsonRes({ status: "reconnect_required" });
      if (u.includes("/api/calendar/events")) {
        return jsonRes({ connected: true, status: "ok", events: [],
          tasks: [{ id: "gt1", title: "Renew passport", due: today, allDay: true, list: "My Tasks", listId: "list1" }] });
      }
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  await openCalendar(app);

  app.document.querySelector("#calDayCur .cal-chip.is-gtask").click();
  const done = app.document.getElementById("calGtaskDone");
  done.checked = true;
  done.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  await app.flush();
  await app.flush();

  assert.equal(done.checked, false, "the tick must come back off");
  assert.match(app.document.getElementById("calEditStatus").textContent, /Reconnect Google/i);
});

test("a Google Tasks failure is reported without breaking the agenda", async () => {
  const app = loadApp({
    fetchImpl: backendWithTasks([], {
      events: [{ id: "e1", calendarId: "primary", writable: true, title: "Lunch", start: atToday(12, 0), calendar: "Yawar" }],
      tasksError: "task lists unavailable: HTTP 403",
    }),
  });
  await openCalendar(app);

  assert.equal(chips(app).length, 1, "the calendar still renders");
  assert.match(app.document.getElementById("calStatus").textContent, /Google Tasks couldn't be read/);
});
