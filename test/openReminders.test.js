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
    if (u.includes("/api/prayer")) return { ok: true, status: 200, json: async () => ({ source: "ummahapi", timings }) };
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
  let prayerCalls = 0;
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: JSON.stringify({ schema: 3, profile: { startWeight: "", targetWeight: "", updated_at: 1, tasks: [] }, days: {} }) },
    fetchImpl: async (url) => {
      if (String(url).includes("/api/prayer")) prayerCalls++;
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    },
  });
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 0);
  assert.equal(prayerCalls, 0);
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

/* ---------- how a notification actually gets delivered ---------- */

test("with a service worker registration, notifications go through showNotification", async () => {
  /* Chrome on Android throws "Illegal constructor" on `new Notification()`,
     so the reminder silently never appeared there. */
  const app = loadApp({
    notificationPermission: "granted",
    serviceWorkerNotifications: true,
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();
  await app.flush();

  assert.equal(app.notifications.length, 0, "the constructor path must not be used when a registration exists");
  const notes = app.swNotifications.filter((n) => /not marked yet/.test(n.title));
  assert.equal(notes.length, 1);
  assert.match(notes[0].title, /^Isha/);
});

test("without a service worker it still falls back to the Notification constructor", async () => {
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 1);
});

test("granting permission later still gets you the current nudge, not silence", async () => {
  /* notifyOnce used to burn its key even when it wasn't allowed to send, so
     enabling reminders mid-session left everything already "seen" suppressed
     until the next reload. */
  const app = loadApp({
    notificationPermission: "default",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();
  assert.equal(app.notifications.length, 0, "nothing may fire before permission is given");

  app.goTo("settings");
  app.click("notifyBtn");
  await app.flush();
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 1, "the nudge should arrive once reminders are enabled");
  assert.match(app.document.getElementById("notifyBtn").textContent, /enabled/i);
});

/* ---------- the in-app notification centre ---------- */

const bellPanel = (app) => app.document.getElementById("notifPanel");
const bellItems = (app) => app.document.querySelectorAll("#notifList .notif-item");

test("the bell records reminders even when the browser won't let us raise one", async () => {
  /* Exactly when there's no OS notification is when having somewhere to look
     matters most. */
  const due = new Date(Date.now() - 3600000).toISOString();
  const app = loadApp({
    notificationPermission: "denied",
    localStorageSeed: {
      yawarWellness_v1: withProfile({ tasks: [{ id: "t1", title: "Call the GP", due, done: false, scheduled: true, calendarEventId: null, updated_at: 1 }] }),
    },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  assert.equal(app.notifications.length, 0, "nothing may reach the OS");
  app.click("notifyBell");
  const items = bellItems(app);
  assert.ok(items.length >= 1, "but the bell should still have it");
  assert.match(app.document.getElementById("notifList").textContent, /Call the GP/);
});

test("the bell shows an unread dot until it's opened, and Clear empties it", async () => {
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  assert.equal(app.document.getElementById("bellDot").hidden, false, "an unread reminder shows a dot");
  app.click("notifyBell");
  assert.equal(bellPanel(app).hidden, false);
  assert.equal(app.document.getElementById("bellDot").hidden, true, "opening it clears the dot");

  app.click("notifClear");
  assert.equal(bellItems(app).length, 0);
  assert.match(app.document.getElementById("notifList").textContent, /Nothing yet/);
  assert.equal(bellPanel(app).hidden, true,
    "with nothing left to read, the panel closes rather than sitting open on an empty list");
});

test("the notification log is per device — it never enters the synced state", async () => {
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();

  const stored = app.state();
  assert.equal(stored.notifs, undefined, "reminders are not health data and must not sync");
  assert.ok(app.window.localStorage.getItem("yawarNotifs"), "they live in their own key");
});

test("coming back from the bfcache re-raises the current prayer instead of staying silent", async () => {
  /* The in-memory "already said that" marks made every resume silent, so
     reminders only ever appeared after a manual refresh. A bfcache restore
     re-runs no scripts at all, so it is always treated as a fresh open. */
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();
  assert.equal(prayerNotes(app).length, 1);

  const ev = new app.window.Event("pageshow");
  Object.defineProperty(ev, "persisted", { value: true });
  app.window.dispatchEvent(ev);
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 2, "the nudge speaks again on a resume");
});

test("a quick flick away and back stays quiet", async () => {
  const app = loadApp({
    notificationPermission: "granted",
    localStorageSeed: { yawarWellness_v1: seedWith() },
    fetchImpl: backend(timingsAllPast()),
  });
  await app.flush();
  await app.flush();
  assert.equal(prayerNotes(app).length, 1);

  Object.defineProperty(app.document, "hidden", { value: true, configurable: true });
  app.document.dispatchEvent(new app.window.Event("visibilitychange"));
  Object.defineProperty(app.document, "hidden", { value: false, configurable: true });
  app.document.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.flush();
  await app.flush();

  assert.equal(prayerNotes(app).length, 1, "a glance away is not a fresh open");
});


/* The same reminder legitimately fires more than once - the minute tick
 * raises an unticked prayer again, and reopening the app re-raises whatever
 * is still outstanding. Six identical rows push everything else off the bell,
 * so a repeat updates the row that is already there. */
// Title alone is not the subject: morning and evening dhikr are two genuinely
// different reminders that share the title "Dhikr reminder" and differ in the
// body. What the user sees as "the same notification" is both lines together.
const bellTitles = (app) =>
  Array.from(app.document.querySelectorAll("#notifList .notif-item")).map((r) => {
    const t = r.querySelector(".t").firstChild.textContent;
    const b = r.querySelector(".b");
    return b ? t + " — " + b.textContent : t;
  });

test("reopening never puts the same reminder in the bell twice", async () => {
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
  app.click("notifyBell");

  const before = bellTitles(app);
  assert.ok(before.length >= 1, "something was logged");
  assert.equal(new Set(before).size, before.length, "no duplicates to begin with");

  // Away long enough to count as a fresh open, which re-raises whatever is
  // still outstanding - the exact path that used to stack duplicates.
  Object.defineProperty(app.document, "hidden", { value: true, configurable: true });
  app.document.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.flush();
  Object.defineProperty(app.document, "hidden", { value: false, configurable: true });
  app.document.dispatchEvent(new app.window.Event("visibilitychange"));
  await app.flush();
  await app.flush();

  const after = bellTitles(app);
  assert.equal(new Set(after).size, after.length,
    "still one row per subject after reopening: " + after.join(" | "));
  before.forEach((t) => assert.ok(after.includes(t), t + " should still be there, once"));
});

test("different reminders stay different rows", async () => {
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
  app.click("notifyBell");

  const titles = bellTitles(app);
  assert.ok(titles.length >= 2, "a prayer and a task are separate subjects: " + titles.join(" | "));
  assert.equal(new Set(titles).size, titles.length, "and neither folded into the other");
});
