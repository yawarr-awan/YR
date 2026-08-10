"use strict";
/*
 * Opening-the-app reminders: the prayer whose window we're currently in, if
 * it isn't ticked yet, and any scheduled task that's due and still open.
 * All-day items are deliberately excluded - they aren't due at a moment, so
 * treating them as overdue would nag on every single open.
 *
 * The app reads the real clock, so the mocked prayer times here are built
 * relative to "now" rather than hardcoded, which keeps these deterministic
 * whatever time of day the suite runs at.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function keyOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
function hhmm(mins) {
  const m = Math.max(0, Math.min(1439, Math.round(mins)));
  return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0");
}
function nowMinutes() {
  const d = new Date();
  return d.getHours() * 60 + d.getMinutes();
}

/** Every prayer already behind us, so the current window is Isha. Clamping
 * at 0 keeps this valid even a minute after midnight. */
function timingsAllPast() {
  const n = nowMinutes();
  const at = (back) => hhmm(n - back);
  return { Fajr: at(6), Sunrise: at(5), Dhuhr: at(4), Asr: at(3), Sunset: at(2), Maghrib: at(2), Isha: at(1) };
}

/** Every prayer still ahead of us, so we're before Fajr and the window we're
 * in is last night's Isha. */
function timingsAllFuture() {
  const n = nowMinutes();
  const at = (fwd) => hhmm(n + fwd);
  return { Fajr: at(1), Sunrise: at(2), Dhuhr: at(3), Asr: at(4), Sunset: at(5), Maghrib: at(5), Isha: at(6) };
}

function backend(timings) {
  return async (url) => {
    const u = String(url);
    if (u.includes("api.aladhan.com")) return { ok: true, status: 200, json: async () => ({ data: { timings } }) };
    return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
  };
}

function seedWith(extra) {
  return JSON.stringify(Object.assign({
    schema: 3,
    profile: { startWeight: "", targetWeight: "", updated_at: 1, prayerLoc: { lat: 51.5, lon: -0.12 }, tasks: [] },
    days: {},
  }, extra || {}));
}

function withProfile(extraProfile, extraTop) {
  const base = JSON.parse(seedWith(extraTop));
  Object.assign(base.profile, extraProfile);
  return JSON.stringify(base);
}

const prayerNotes = (app) => app.notifications.filter((n) => /not marked yet/.test(n.title));
const taskNotes = (app) => app.notifications.filter((n) => /task/i.test(n.title));

test("opening the app nudges about the prayer we're currently in when it isn't ticked", async () => {
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  const notes = prayerNotes(app);
  assert.equal(notes.length, 1, "expected exactly one prayer nudge");
  assert.match(notes[0].title, /^Isha/, "the current window is the last prayer already begun");
});

test("a prayer already marked done is not brought up again", async () => {
  const today = keyOf(new Date());
  const days = {};
  days[today] = { meds: {}, prayers: { isha: true }, meals: {}, extras: {}, dhikr: { morning: {}, afternoon: {}, evening: {} }, water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 1 };
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith({ days }) },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 0, "a ticked prayer needs no reminder");
});

test("before Fajr the window we're in is still last night's Isha, and it's checked against yesterday", async () => {
  /* Needs a Fajr that's later today than "now"; after 23:00 there is no such
     time, so the scenario itself can't exist then. */
  if (nowMinutes() >= 1380) return;
  const yesterday = keyOf(new Date(Date.now() - 86400000));
  const days = {};
  days[yesterday] = { meds: {}, prayers: { isha: true }, meals: {}, extras: {}, dhikr: { morning: {}, afternoon: {}, evening: {} }, water: 0, weight: "", sleep: "", steps: "", jointPain: null, energy: null, exercise: false, notes: "", updated_at: 1 };

  const marked = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith({ days }) },
    fetchImpl: backend(timingsAllFuture()),
  });
  await marked.flush();
  await marked.flush();
  assert.equal(prayerNotes(marked).length, 0, "yesterday's Isha was ticked, so nothing to say");

  const unmarked = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllFuture()),
  });
  await unmarked.flush();
  await unmarked.flush();
  const notes = prayerNotes(unmarked);
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /^Isha/);
});

test("no location means no prayer nudge and no attempt to fetch times", async () => {
  let aladhanCalls = 0;
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: JSON.stringify({ schema: 3, profile: { startWeight: "", targetWeight: "", updated_at: 1, tasks: [] }, days: {} }) },
    fetchImpl: async (url) => {
      if (String(url).includes("api.aladhan.com")) aladhanCalls++;
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 0);
  assert.equal(aladhanCalls, 0);
});

test("a scheduled task that's due and not done is raised on open", async () => {
  const due = new Date(Date.now() - 3600000).toISOString();
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: {
      yawarWellness_v1: withProfile({ tasks: [{ id: "t1", title: "Call the GP", due, done: false, scheduled: true, calendarEventId: null, updated_at: 1 }] }),
    },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  const notes = taskNotes(app);
  assert.equal(notes.length, 1);
  assert.match(notes[0].body, /Call the GP/);
});

test("several due tasks are one notification, not a pile of them", async () => {
  const due = new Date(Date.now() - 3600000).toISOString();
  const tasks = ["Call the GP", "Pay rent", "Book MOT"].map((title, i) =>
    ({ id: "t" + i, title, due, done: false, scheduled: true, calendarEventId: null, updated_at: 1 }));
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: withProfile({ tasks }) },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  const notes = taskNotes(app);
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /3 tasks due/);
  assert.match(notes[0].body, /Call the GP/);
  assert.match(notes[0].body, /Book MOT/);
});

test("a done task, a task with no time yet, and an all-day task are all left alone", async () => {
  const past = new Date(Date.now() - 3600000).toISOString();
  const tasks = [
    { id: "t1", title: "Already done", due: past, done: true, scheduled: true, calendarEventId: null, updated_at: 1 },
    { id: "t2", title: "Not scheduled", due: null, done: false, scheduled: false, calendarEventId: null, updated_at: 1 },
    { id: "t3", title: "All-day thing", due: keyOf(new Date()), done: false, scheduled: true, calendarEventId: null, updated_at: 1 },
    { id: "t4", title: "Later today", due: new Date(Date.now() + 3600000).toISOString(), done: false, scheduled: true, calendarEventId: null, updated_at: 1 },
  ];
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: withProfile({ tasks }) },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  assert.equal(taskNotes(app).length, 0, "none of these are a due, timed, open task");
});

test("nothing at all fires without notification permission", async () => {
  const due = new Date(Date.now() - 3600000).toISOString();
  const app = loadApp({
    notificationPermission: "default",
    localStorageSeed: {
      yawarWellness_v1: withProfile({ tasks: [{ id: "t1", title: "Call the GP", due, done: false, scheduled: true, calendarEventId: null, updated_at: 1 }] }),
    },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  assert.equal(app.notifications.length, 0);
});

test("coming back into view counts as opening, but the same prayer isn't repeated", async () => {
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();
  assert.equal(prayerNotes(app).length, 1);

  app.document.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.flush();
  await app.flush();
  assert.equal(prayerNotes(app).length, 1, "re-opening inside the same window stays quiet");
});
