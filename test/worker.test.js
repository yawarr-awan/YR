"use strict";
/*
 * Unit tests for the Google Calendar + Gemini daily-brief logic added to
 * worker.js. Loads the real, unmodified worker.js (see workerLib.js for
 * why a data: URL import) and drives its named-exported functions
 * directly with a fake D1 (fakeD1.js) and a mocked global fetch -
 * verifyAccess/handleSync are unchanged and out of scope here.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadWorker } = require("./workerLib.js");
const { createFakeD1 } = require("./fakeD1.js");

const EMAIL = "yawar.awan@gmail.com";

function jsonResponse(status, body, extraText) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => (extraText !== undefined ? extraText : JSON.stringify(body)),
  };
}

function installFetch(t, impl) {
  const original = global.fetch;
  global.fetch = impl;
  t.after(() => { global.fetch = original; });
}

function geminiOk(text) {
  return jsonResponse(200, { candidates: [{ content: { parts: [{ text }] } }] });
}

/**
 * A realistic router for the Google APIs generateBrief/handleGetCalendarEvents
 * actually call in sequence: calendarList -> events per calendar -> Tasks
 * lists -> tasks per list -> Gemini. Distinguishes each sub-endpoint by URL
 * shape, unlike a single catch-all "any calendar/v3 URL" mock, so these
 * tests exercise the real multi-calendar/multi-list fan-out instead of
 * passing by coincidence.
 */
function googleApiMocks({ calendars = [], eventsByCalendar = {}, taskLists = [], tasksByList = {}, geminiText = "OK." } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: calendars });
    const calMatch = u.match(/calendars\/([^/]+)\/events/);
    if (calMatch) return jsonResponse(200, { items: eventsByCalendar[decodeURIComponent(calMatch[1])] || [] });
    if (u.includes("tasks.googleapis.com/tasks/v1/users/@me/lists")) return jsonResponse(200, { items: taskLists });
    const listMatch = u.match(/tasks\/v1\/lists\/([^/]+)\/tasks/);
    if (listMatch) return jsonResponse(200, { items: tasksByList[decodeURIComponent(listMatch[1])] || [] });
    if (u.includes("generativelanguage")) return geminiOk(geminiText);
    throw new Error("unexpected fetch " + u);
  };
}

test("localDayBounds / utcOffsetMinutes track Europe/London across DST with no manual offset table", async () => {
  const { localDayBounds, utcOffsetMinutes } = await loadWorker();
  const summer = new Date("2026-08-09T10:00:00Z"); // BST -> UTC+1
  const winter = new Date("2026-01-09T10:00:00Z"); // GMT -> UTC+0

  assert.equal(utcOffsetMinutes("Europe/London", summer), 60);
  assert.equal(utcOffsetMinutes("Europe/London", winter), 0);

  const b = localDayBounds("Europe/London", summer);
  assert.equal(b.day, "2026-08-09");
  assert.equal(b.timeMin, "2026-08-09T00:00:00+01:00");
  assert.equal(b.timeMax, "2026-08-09T23:59:59+01:00");

  const w = localDayBounds("Europe/London", winter);
  assert.equal(w.timeMin, "2026-01-09T00:00:00+00:00");
});

test("getGoogleAccessToken: no row at all means not connected, no network call", async (t) => {
  const { getGoogleAccessToken } = await loadWorker();
  const { env } = createFakeD1();
  let fetched = false;
  installFetch(t, async () => { fetched = true; return jsonResponse(200, {}); });

  const result = await getGoogleAccessToken(env, EMAIL);
  assert.deepEqual(result, { error: "not_connected" });
  assert.equal(fetched, false);
});

test("getGoogleAccessToken: a cached, unexpired access token is reused without a network call", async (t) => {
  const { getGoogleAccessToken } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "cached-token", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let fetched = false;
  installFetch(t, async () => { fetched = true; return jsonResponse(200, {}); });

  const result = await getGoogleAccessToken(d1.env, EMAIL);
  assert.deepEqual(result, { accessToken: "cached-token" });
  assert.equal(fetched, false);
});

test("getGoogleAccessToken: expired access token triggers a refresh and persists the new one", async (t) => {
  const { getGoogleAccessToken } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "stale-token", access_token_expires_at: Date.now() - 1000 });
  installFetch(t, async (url) => {
    assert.match(String(url), /oauth2\.googleapis\.com\/token/);
    return jsonResponse(200, { access_token: "fresh-token", expires_in: 3600 });
  });

  const result = await getGoogleAccessToken(d1.env, EMAIL);
  assert.deepEqual(result, { accessToken: "fresh-token" });
  assert.equal(d1.googleTokens.get(EMAIL).access_token, "fresh-token");
});

test("getGoogleAccessToken: invalid_grant on refresh means reconnect, not a generic failure", async (t) => {
  const { getGoogleAccessToken } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: null, access_token_expires_at: null });
  installFetch(t, async () => jsonResponse(400, { error: "invalid_grant" }, JSON.stringify({ error: "invalid_grant" })));

  const result = await getGoogleAccessToken(d1.env, EMAIL);
  assert.deepEqual(result, { error: "reconnect_required" });
});

test("getGoogleAccessToken: any other refresh failure is refresh_failed", async (t) => {
  const { getGoogleAccessToken } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: null, access_token_expires_at: null });
  installFetch(t, async () => jsonResponse(500, {}, "server error"));

  const result = await getGoogleAccessToken(d1.env, EMAIL);
  assert.deepEqual(result, { error: "refresh_failed" });
});

test("generateBrief: not connected short-circuits before any network call", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  let fetched = false;
  installFetch(t, async () => { fetched = true; return jsonResponse(200, {}); });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "not_connected");
  assert.equal(fetched, false);
  assert.equal(d1.dailyBrief.size, 0, "no day is known yet when we're not even connected");
});

test("generateBrief: a calendar list failure is recorded against today, not silently dropped", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async (url) => {
    assert.match(String(url), /calendarList/);
    return jsonResponse(500, {}, "backend error");
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "calendar_error");
  const saved = d1.dailyBrief.get(`${EMAIL}|2026-08-09`);
  assert.equal(saved.status, "calendar_error");
  assert.equal(saved.summary, null);
});

test("generateBrief: calendar succeeds but Gemini fails is a distinct, recorded status", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Primary" }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) return jsonResponse(503, {}, "overloaded");
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "gemini_error");
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).status, "gemini_error");
});

test("generateBrief: end to end success across two calendars, tagged and merged, plus a due task", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, googleApiMocks({
    calendars: [
      { id: "primary", summary: "Yawar", backgroundColor: "#4285F4", primary: true },
      { id: "family@group.calendar.google.com", summary: "Family" },
    ],
    eventsByCalendar: {
      primary: [{ summary: "Standup", start: { dateTime: "2026-08-09T09:00:00+01:00" } }],
      "family@group.calendar.google.com": [{ summary: "Mum's birthday", start: { date: "2026-08-09" } }],
    },
    taskLists: [{ id: "list1", title: "My Tasks" }],
    tasksByList: { list1: [{ title: "Pay rent", status: "needsAction", due: "2026-08-09T00:00:00.000Z" }] },
    geminiText: "A light day with a morning standup and Mum's birthday.",
  }));

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");
  assert.equal(result.summary, "A light day with a morning standup and Mum's birthday.");
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).summary, result.summary);
});

test("generateBrief: a refresh mid-day only tells Gemini about what's still remaining, and bans time-of-day greetings", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });

  let geminiPrompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("calendars/primary/events")) {
      return jsonResponse(200, { items: [
        { summary: "Morning standup", start: { dateTime: "2026-08-09T09:00:00+01:00" }, end: { dateTime: "2026-08-09T09:30:00+01:00" } },
        { summary: "Afternoon call", start: { dateTime: "2026-08-09T15:00:00+01:00" }, end: { dateTime: "2026-08-09T15:30:00+01:00" } },
      ] });
    }
    if (u.includes("tasks.googleapis.com/tasks/v1/users/@me/lists")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) {
      geminiPrompt = JSON.parse(opts.body).contents[0].parts[0].text;
      return geminiOk("Just the afternoon call left.");
    }
    throw new Error("unexpected fetch " + u);
  });

  // "Now" is midday London time: the 09:00 standup has already finished, the 15:00 call has not.
  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T11:00:00Z"));
  assert.equal(result.status, "ok");
  assert.doesNotMatch(geminiPrompt, /Morning standup/, "an already-finished event must not be sent to Gemini");
  assert.match(geminiPrompt, /Afternoon call/);
  assert.match(geminiPrompt, /currently 12:00/, "London is BST (+1) in August, so 11:00Z is 12:00 local");
  assert.match(geminiPrompt, /Do not open with a time-of-day greeting/i);
});

test("handleGetBrief reflects not_connected / pending / ok correctly", async (t) => {
  const { handleGetBrief } = await loadWorker();
  installFetch(t, async () => { throw new Error("handleGetBrief must never touch the network itself"); });
  const now = new Date("2026-08-09T10:00:00Z");

  const d1a = createFakeD1();
  const notConnected = await (await handleGetBrief(d1a.env, EMAIL, now)).json();
  assert.equal(notConnected.connected, false);
  assert.equal(notConnected.status, "not_connected");

  const d1b = createFakeD1();
  d1b.seedToken(EMAIL, {});
  const pending = await (await handleGetBrief(d1b.env, EMAIL, now)).json();
  assert.equal(pending.connected, true);
  assert.equal(pending.status, "pending");

  const d1c = createFakeD1();
  d1c.seedToken(EMAIL, {});
  d1c.seedBrief(EMAIL, "2026-08-09", { summary: "All clear today.", status: "ok" });
  const ok = await (await handleGetBrief(d1c.env, EMAIL, now)).json();
  assert.equal(ok.status, "ok");
  assert.equal(ok.summary, "All clear today.");
});

test("handleScheduled: a no-op outside the 7am London hour, regardless of connected users", async (t) => {
  const { handleScheduled } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let fetched = false;
  installFetch(t, async () => { fetched = true; return jsonResponse(200, {}); });

  await handleScheduled(d1.env, new Date("2026-08-09T10:00:00Z")); // 11am London (BST)
  assert.equal(fetched, false);
  assert.equal(d1.dailyBrief.size, 0);
});

test("handleScheduled: at 7am London, generates once and skips a user already done for today", async (t) => {
  const { handleScheduled } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let calendarListCalls = 0;
  const baseMock = googleApiMocks({ calendars: [{ id: "primary", summary: "Primary" }], geminiText: "Nothing scheduled today." });
  installFetch(t, async (url) => {
    if (String(url).includes("calendarList")) calendarListCalls++;
    return baseMock(url);
  });

  const sevenAmBst = new Date("2026-08-09T06:30:00Z"); // 7:30am BST
  await handleScheduled(d1.env, sevenAmBst);
  assert.equal(calendarListCalls, 1);
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).status, "ok");

  // Firing again in the same 7am hour must not regenerate an already-ok brief.
  await handleScheduled(d1.env, sevenAmBst);
  assert.equal(calendarListCalls, 1, "already-generated-today briefs must not be recomputed");
});

test("listCalendars: maps calendarList items, defaulting missing color/name sensibly", async (t) => {
  const { listCalendars } = await loadWorker();
  installFetch(t, googleApiMocks({
    calendars: [
      { id: "primary", summary: "Yawar", backgroundColor: "#4285F4", primary: true },
      { id: "family@group.calendar.google.com", summaryOverride: "Family (shared)" },
      { id: "no-color@group.calendar.google.com", summary: "No Color Cal" },
    ],
  }));

  const calendars = await listCalendars("tok");
  assert.equal(calendars.length, 3);
  assert.deepEqual(calendars[0], { id: "primary", name: "Yawar", color: "#4285F4", primary: true });
  assert.equal(calendars[1].name, "Family (shared)", "summaryOverride wins over summary when both are present");
  assert.equal(calendars[2].color, "#4285F4", "a calendar with no backgroundColor falls back to a sane default");
});

test("listCalendars: a non-OK response throws (this is on the critical path, unlike tasks)", async (t) => {
  const { listCalendars } = await loadWorker();
  installFetch(t, async () => jsonResponse(401, {}, "unauthorized"));
  await assert.rejects(() => listCalendars("tok"));
});

test("fetchEventsForRange: merges and time-sorts events across calendars, tagging each with its source", async (t) => {
  const { fetchEventsForRange } = await loadWorker();
  installFetch(t, googleApiMocks({
    eventsByCalendar: {
      primary: [{ summary: "Lunch", start: { dateTime: "2026-08-09T12:00:00+01:00" }, location: "Cafe" }],
      "family@group.calendar.google.com": [{ summary: "Mum's birthday", start: { date: "2026-08-09" } }],
    },
  }));
  const calendars = [
    { id: "primary", name: "Yawar", color: "#4285F4" },
    { id: "family@group.calendar.google.com", name: "Family", color: "#0B8043" },
  ];

  const events = await fetchEventsForRange("tok", calendars, "2026-08-09T00:00:00+01:00", "2026-08-09T23:59:59+01:00");
  assert.equal(events.length, 2);
  // The all-day "family" event has an earlier sort key ("2026-08-09") than the dateTime one, so it sorts first.
  assert.equal(events[0].calendar, "Family");
  assert.equal(events[0].allDay, true);
  assert.equal(events[1].title, "Lunch");
  assert.equal(events[1].calendar, "Yawar");
  assert.equal(events[1].location, "Cafe");
});

test("fetchEventsForRange: one unreachable calendar is skipped, the rest still come back", async (t) => {
  const { fetchEventsForRange } = await loadWorker();
  installFetch(t, async (url) => {
    if (String(url).includes("broken-cal")) return jsonResponse(403, {}, "revoked");
    return jsonResponse(200, { items: [{ summary: "Still here", start: { dateTime: "2026-08-09T10:00:00+01:00" } }] });
  });
  const calendars = [
    { id: "broken-cal", name: "Revoked", color: "#000" },
    { id: "primary", name: "Yawar", color: "#4285F4" },
  ];

  const events = await fetchEventsForRange("tok", calendars, "2026-08-09T00:00:00+01:00", "2026-08-09T23:59:59+01:00");
  assert.equal(events.length, 1);
  assert.equal(events[0].title, "Still here");
});

test("fetchTodayTasks: filters out completed tasks and never throws on failure (a bonus, not the critical path)", async (t) => {
  const { fetchTodayTasks } = await loadWorker();
  installFetch(t, googleApiMocks({
    taskLists: [{ id: "list1", title: "My Tasks" }],
    tasksByList: {
      list1: [
        { title: "Pay rent", status: "needsAction", due: "2026-08-09T00:00:00.000Z" },
        { title: "Already done", status: "completed", due: "2026-08-09T00:00:00.000Z" },
      ],
    },
  }));

  const tasks = await fetchTodayTasks("tok", "2026-08-09");
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Pay rent");
  assert.equal(tasks[0].list, "My Tasks");
});

test("fetchTodayTasks: a network failure returns an empty list, never throws", async (t) => {
  const { fetchTodayTasks } = await loadWorker();
  installFetch(t, async () => { throw new TypeError("network down"); });
  const tasks = await fetchTodayTasks("tok", "2026-08-09");
  assert.deepEqual(tasks, []);
});

test("handleGetCalendarEvents: not connected returns an empty agenda, no network call", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  installFetch(t, async () => { throw new Error("must not touch the network when not connected"); });

  const req = { url: "https://x/api/calendar/events?date=2026-08-09" };
  const resp = await (await handleGetCalendarEvents(req, d1.env, EMAIL)).json();
  assert.equal(resp.connected, false);
  assert.equal(resp.status, "not_connected");
  assert.deepEqual(resp.events, []);
});

test("handleGetCalendarEvents: returns the raw (non-summarized) agenda for the requested date", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, googleApiMocks({
    calendars: [{ id: "primary", summary: "Yawar", backgroundColor: "#4285F4" }],
    eventsByCalendar: { primary: [{ summary: "Dentist", start: { dateTime: "2026-08-09T15:00:00+01:00" } }] },
  }));

  const req = { url: "https://x/api/calendar/events?date=2026-08-09" };
  const resp = await (await handleGetCalendarEvents(req, d1.env, EMAIL)).json();
  assert.equal(resp.connected, true);
  assert.equal(resp.status, "ok");
  assert.equal(resp.day, "2026-08-09");
  assert.equal(resp.events.length, 1);
  assert.equal(resp.events[0].title, "Dentist");
});

test("handleGetCalendarEvents: falls back to today when the date param is missing or malformed", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  installFetch(t, async () => { throw new Error("not_connected short-circuits before any fetch"); });

  const now = new Date("2026-08-09T10:00:00Z");
  const resp = await (await handleGetCalendarEvents({ url: "https://x/api/calendar/events?date=not-a-date" }, d1.env, EMAIL, now)).json();
  assert.equal(resp.day, "2026-08-09");
});

test("handleCreateCalendarEvent: rejects a missing title/start before touching the network", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  installFetch(t, async () => { throw new Error("must not touch the network on a validation failure"); });

  const noTitle = await (await handleCreateCalendarEvent({ json: async () => ({ start: "2026-08-09T10:00:00Z" }) }, d1.env, EMAIL)).json();
  assert.match(noTitle.error, /title/i);

  const noStart = await (await handleCreateCalendarEvent({ json: async () => ({ title: "Meeting" }) }, d1.env, EMAIL)).json();
  assert.match(noStart.error, /start/i);
});

test("handleCreateCalendarEvent: creates a real event when connected with write access", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let sentBody = null;
  installFetch(t, async (url, opts) => {
    assert.match(String(url), /calendars\/primary\/events/);
    sentBody = JSON.parse(opts.body);
    return jsonResponse(200, { id: "evt123", htmlLink: "https://calendar.google.com/evt123" });
  });

  const req = { json: async () => ({ title: "Pay rent", start: "2026-08-09T10:00:00.000Z", durationMinutes: 15 }) };
  const resp = await (await handleCreateCalendarEvent(req, d1.env, EMAIL)).json();
  assert.equal(resp.status, "ok");
  assert.equal(resp.eventId, "evt123");
  assert.equal(sentBody.summary, "Pay rent");
  assert.equal(sentBody.start.dateTime, "2026-08-09T10:00:00.000Z");
  assert.equal(sentBody.end.dateTime, "2026-08-09T10:15:00.000Z");
});

test("handleCreateCalendarEvent: an old read-only token surfaces as reconnect_required, not a generic error", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async () => jsonResponse(403, {}, JSON.stringify({ error: { status: "PERMISSION_DENIED", message: "Insufficient Permission" } })));

  const req = { json: async () => ({ title: "Pay rent", start: "2026-08-09T10:00:00.000Z" }) };
  const resp = await (await handleCreateCalendarEvent(req, d1.env, EMAIL)).json();
  assert.equal(resp.status, "reconnect_required");
});
