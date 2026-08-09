"use strict";
/*
 * Task list card coverage (Today tab): add/check/delete, and the
 * "Schedule to Calendar" flow that POSTs to /api/google/calendar/events.
 * Real index.html, real DOM, network boundary mocked.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function jsonRes(body) { return { ok: true, status: 200, json: async () => body }; }

test("adding a task with no due date shows it with no Schedule button", () => {
  const app = loadApp({});
  app.setInput("taskTitleIn", "Water the plants");
  app.click("taskAddBtn");

  const list = app.document.getElementById("taskList");
  assert.match(list.textContent, /Water the plants/);
  assert.equal(list.querySelector("button.btn:not(.danger)"), null, "no due date means nothing to schedule yet");
});

test("adding a task with a due date shows a Schedule button", () => {
  const app = loadApp({});
  app.setInput("taskTitleIn", "Pay rent");
  app.setInput("taskWhenIn", "2026-08-09T10:00");
  app.click("taskAddBtn");

  const list = app.document.getElementById("taskList");
  const schedBtn = Array.from(list.querySelectorAll("button")).find((b) => /schedule/i.test(b.textContent));
  assert.ok(schedBtn, "expected a Schedule button once a due date is set");
});

test("checking a task marks it done and it survives a reload (persisted to localStorage)", () => {
  const app = loadApp({});
  app.setInput("taskTitleIn", "Buy groceries");
  app.click("taskAddBtn");
  // app.check() needs an id and this checkbox has none, so toggle it directly.
  const cb = app.document.getElementById("taskList").querySelector("input[type=checkbox]");
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  const row = app.document.getElementById("taskList").querySelector(".task-row");
  assert.ok(row.classList.contains("done"));

  const persisted = app.state().tasks;
  assert.equal(persisted.length, 1);
  assert.equal(persisted[0].done, true);
});

test("deleting a task removes it from the list and from storage", () => {
  const app = loadApp({});
  app.setInput("taskTitleIn", "Temporary task");
  app.click("taskAddBtn");
  assert.match(app.document.getElementById("taskList").textContent, /Temporary task/);

  app.document.getElementById("taskList").querySelector("button.btn.danger").click();
  assert.doesNotMatch(app.document.getElementById("taskList").textContent, /Temporary task/);
  assert.equal(app.state().tasks.length, 0);
});

test("scheduling a task posts to the write endpoint and marks it scheduled on success", async () => {
  let sentBody = null;
  const app = loadApp({
    fetchImpl: async (url, opts) => {
      if (String(url).includes("/api/google/calendar/events")) {
        sentBody = JSON.parse(opts.body);
        return jsonRes({ status: "ok", eventId: "evt1" });
      }
      return jsonRes({ connected: false, status: "not_connected" }); // /api/brief on load
    },
  });
  app.setInput("taskTitleIn", "Dentist");
  app.setInput("taskWhenIn", "2026-08-10T09:00");
  app.click("taskAddBtn");

  const schedBtn = Array.from(app.document.getElementById("taskList").querySelectorAll("button")).find((b) => /schedule/i.test(b.textContent));
  schedBtn.click();
  await app.flush();

  assert.equal(sentBody.title, "Dentist");
  assert.match(app.document.getElementById("taskStatus").textContent, /added to your google calendar/i);
  assert.match(app.document.getElementById("taskList").textContent, /on calendar/i);
  assert.equal(app.state().tasks[0].scheduled, true);
});

test("scheduling a task that needs reconnecting surfaces that clearly, not a generic error", async () => {
  const app = loadApp({
    fetchImpl: async (url) => {
      if (String(url).includes("/api/google/calendar/events")) return jsonRes({ status: "reconnect_required" });
      return jsonRes({ connected: false, status: "not_connected" });
    },
  });
  app.setInput("taskTitleIn", "Dentist");
  app.setInput("taskWhenIn", "2026-08-10T09:00");
  app.click("taskAddBtn");

  const schedBtn = Array.from(app.document.getElementById("taskList").querySelectorAll("button")).find((b) => /schedule/i.test(b.textContent));
  schedBtn.click();
  await app.flush();

  assert.match(app.document.getElementById("taskStatus").textContent, /connect google calendar/i);
  assert.equal(app.state().tasks[0].scheduled, false);
});
