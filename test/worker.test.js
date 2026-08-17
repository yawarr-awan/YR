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
  assert.match(geminiPrompt, /no greeting/i, "the format rules still ban a time-of-day greeting");
});

test("generateBrief: the prompt carries every calendar and all three task buckets", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  let prompt = null;
  let calendarListUrl = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) {
      calendarListUrl = u;
      return jsonResponse(200, { items: [
        { id: "primary", summary: "Yawar", primary: true },
        { id: "family@group.calendar.google.com", summary: "Family" },
      ] });
    }
    if (u.includes("calendars/primary/events")) return jsonResponse(200, { items: [{ summary: "Standup", start: { dateTime: "2026-08-09T18:00:00+01:00" }, end: { dateTime: "2026-08-09T18:30:00+01:00" } }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [{ summary: "Family dinner", start: { dateTime: "2026-08-09T19:00:00+01:00" }, end: { dateTime: "2026-08-09T20:00:00+01:00" } }] });
    if (u.includes("users/@me/lists")) return jsonResponse(200, { items: [{ id: "l1", title: "My Tasks" }] });
    if (u.includes("/tasks?")) return jsonResponse(200, { items: [
      { title: "Pay rent", status: "needsAction", due: "2026-08-09T00:00:00.000Z" },
      { title: "Chase invoice", status: "needsAction", due: "2026-08-01T00:00:00.000Z" },
      { title: "Read that book", status: "needsAction" },
    ] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("All good."); }
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");

  // Hidden/secondary calendars are exactly the ones that were going missing.
  assert.match(calendarListUrl, /showHidden=true/);
  assert.match(prompt, /Standup/);
  assert.match(prompt, /Family dinner/);
  assert.match(prompt, /Tasks due today:\n- Pay rent/);
  assert.match(prompt, /Overdue tasks:\n- Chase invoice/);
  assert.doesNotMatch(prompt, /Read that book/, "a task with no due date stays out of the brief");
  assert.match(prompt, /1 further task\(s\) have no due date/);
  assert.match(prompt, /Cover every calendar and task list/);
});

test("generateBrief: a Tasks failure is recorded next to a successful summary, not swallowed", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(403, {}, "Google Tasks API has not been used in project 123 before or it is disabled");
    if (u.includes("generativelanguage")) return geminiOk("A quiet day.");
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok", "the brief still generates - tasks are an enrichment");
  assert.match(result.error, /HTTP 403/);
  const saved = d1.dailyBrief.get(`${EMAIL}|2026-08-09`);
  assert.equal(saved.summary, "A quiet day.");
  assert.match(saved.error, /has not been used/, "so 'where are my tasks?' is answerable later");
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

test("handleScheduled: a no-op outside the midnight London hour, regardless of connected users", async (t) => {
  const { handleScheduled } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let fetched = false;
  installFetch(t, async () => { fetched = true; return jsonResponse(200, {}); });

  await handleScheduled(d1.env, new Date("2026-08-09T10:00:00Z")); // 11am London (BST)
  assert.equal(fetched, false);
  assert.equal(d1.dailyBrief.size, 0);

  // Midnight UTC is 1am London in summer, which is the trap this guards:
  // the cron fires hourly precisely because cron itself is evaluated in UTC.
  await handleScheduled(d1.env, new Date("2026-08-09T00:01:00Z"));
  assert.equal(fetched, false, "00:01 UTC is 01:01 London in BST - not the hour");
});

test("handleScheduled: at midnight London, generates once and skips a user already done for today", async (t) => {
  const { handleScheduled } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let calendarListCalls = 0;
  const baseMock = googleApiMocks({ calendars: [{ id: "primary", summary: "Primary" }], geminiText: "Nothing scheduled today." });
  installFetch(t, async (url) => {
    if (String(url).includes("calendarList")) calendarListCalls++;
    return baseMock(url);
  });

  const oneMinutePastMidnightBst = new Date("2026-08-09T23:01:00Z"); // 00:01 on the 10th, London
  await handleScheduled(d1.env, oneMinutePastMidnightBst);
  assert.equal(calendarListCalls, 1);
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-10`).status, "ok",
    "the brief is filed against the day that has just started, not the one that ended");

  // Firing again in the same hour must not regenerate an already-ok brief.
  await handleScheduled(d1.env, oneMinutePastMidnightBst);
  assert.equal(calendarListCalls, 1, "already-generated-today briefs must not be recomputed");
});

test("listCalendars: maps calendarList items, defaulting missing color/name sensibly", async (t) => {
  const { listCalendars } = await loadWorker();
  installFetch(t, googleApiMocks({
    calendars: [
      { id: "primary", summary: "Yawar", backgroundColor: "#4285F4", primary: true, accessRole: "owner" },
      { id: "family@group.calendar.google.com", summaryOverride: "Family (shared)", accessRole: "writer" },
      { id: "no-color@group.calendar.google.com", summary: "No Color Cal", accessRole: "reader" },
    ],
  }));

  const calendars = await listCalendars("tok");
  assert.equal(calendars.length, 3);
  assert.deepEqual(calendars[0], { id: "primary", name: "Yawar", color: "#4285F4", primary: true, writable: true });
  assert.equal(calendars[1].name, "Family (shared)", "summaryOverride wins over summary when both are present");
  assert.equal(calendars[1].writable, true, "a writer calendar can be edited");
  assert.equal(calendars[2].color, "#4285F4", "a calendar with no backgroundColor falls back to a sane default");
  assert.equal(calendars[2].writable, false, "a read-only calendar must not offer editing");
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

test("fetchTasks: buckets open tasks into due-today / overdue / undated, dropping completed ones", async (t) => {
  const { fetchTasks } = await loadWorker();
  installFetch(t, googleApiMocks({
    taskLists: [{ id: "list1", title: "My Tasks" }],
    tasksByList: {
      list1: [
        { title: "Pay rent", status: "needsAction", due: "2026-08-09T00:00:00.000Z" },
        { title: "Chase invoice", status: "needsAction", due: "2026-08-04T00:00:00.000Z" },
        { title: "Read that book", status: "needsAction" },
        { title: "Next week thing", status: "needsAction", due: "2026-08-20T00:00:00.000Z" },
        { title: "Already done", status: "completed", due: "2026-08-09T00:00:00.000Z" },
      ],
    },
  }));

  const tasks = await fetchTasks("tok", "2026-08-09");
  assert.equal(tasks.error, null);
  assert.deepEqual(tasks.dueToday.map((x) => x.title), ["Pay rent"]);
  assert.deepEqual(tasks.overdue.map((x) => x.title), ["Chase invoice"], "an overdue task is worth surfacing, not filtering away");
  assert.equal(tasks.undatedCount, 1, "undated tasks are counted, not listed - they aren't part of today");
  assert.equal(tasks.dueToday[0].list, "My Tasks");
});

test("fetchTasks: asks for every open task rather than filtering server-side on the due date", async (t) => {
  const { fetchTasks } = await loadWorker();
  let tasksUrl = null;
  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("users/@me/lists")) return jsonResponse(200, { items: [{ id: "list1", title: "My Tasks" }] });
    tasksUrl = u;
    return jsonResponse(200, { items: [] });
  });

  await fetchTasks("tok", "2026-08-09");
  // A dueMin/dueMax window silently drops undated and overdue work.
  assert.doesNotMatch(tasksUrl, /dueMin|dueMax/);
  assert.match(tasksUrl, /showCompleted=false/);
  assert.match(tasksUrl, /maxResults=100/, "the API default of 20 would truncate a real list");
});

test("fetchTasks: reports why it is empty instead of silently looking like 'no tasks'", async (t) => {
  const { fetchTasks } = await loadWorker();

  // This is exactly what an unenabled Tasks API looks like.
  installFetch(t, async () => jsonResponse(403, {}, "Google Tasks API has not been used in project 123 before or it is disabled"));
  const denied = await fetchTasks("tok", "2026-08-09");
  assert.deepEqual(denied.dueToday, []);
  assert.match(denied.error, /HTTP 403/);
  assert.match(denied.error, /has not been used/);
});

test("fetchTasks: a network failure still never throws", async (t) => {
  const { fetchTasks } = await loadWorker();
  installFetch(t, async () => { throw new TypeError("network down"); });
  const tasks = await fetchTasks("tok", "2026-08-09");
  assert.deepEqual(tasks.dueToday, []);
  assert.match(tasks.error, /network down/);
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

test("handleGetCalendarEvents: an `end` date widens the window to one ranged fetch, not one per day", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  let eventsUrl = null;
  let calendarListCalls = 0;
  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) { calendarListCalls++; return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] }); }
    if (u.includes("calendars/primary/events")) { eventsUrl = u; return jsonResponse(200, { items: [] }); }
    throw new Error("unexpected fetch " + u);
  });

  const req = new Request("https://x/api/calendar/events?date=2026-08-03&end=2026-08-09");
  const body = await (await handleGetCalendarEvents(req, d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"))).json();

  assert.equal(body.day, "2026-08-03");
  assert.equal(body.end, "2026-08-09");
  assert.equal(calendarListCalls, 1, "calendars are listed once for the whole range");
  assert.match(decodeURIComponent(eventsUrl), /timeMin=2026-08-03T00:00:00\+01:00/);
  assert.match(decodeURIComponent(eventsUrl), /timeMax=2026-08-09T23:59:59\+01:00/);
});

test("handleGetCalendarEvents: a malformed or backwards `end` falls back to a single day", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  const urls = [];
  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    // The handler also asks Google Tasks now; only the events requests carry
    // the time range this test is about.
    if (u.includes("/events?")) urls.push(decodeURIComponent(u));
    return jsonResponse(200, { items: [] });
  });
  const now = new Date("2026-08-09T10:00:00Z");

  const junk = await (await handleGetCalendarEvents(new Request("https://x/api/calendar/events?date=2026-08-09&end=nope"), d1.env, EMAIL, now)).json();
  assert.equal(junk.end, "2026-08-09");

  const backwards = await (await handleGetCalendarEvents(new Request("https://x/api/calendar/events?date=2026-08-09&end=2026-08-01"), d1.env, EMAIL, now)).json();
  assert.equal(backwards.end, "2026-08-09", "an end before the start is ignored rather than inverting the range");
  urls.forEach((u) => assert.match(u, /timeMax=2026-08-09T23:59:59/));
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

test("fetchEventsForRange: carries the ids and writability an editor needs", async (t) => {
  const { fetchEventsForRange } = await loadWorker();
  installFetch(t, googleApiMocks({
    eventsByCalendar: {
      primary: [{ id: "evt1", summary: "Lunch", start: { dateTime: "2026-08-09T12:00:00+01:00" }, end: { dateTime: "2026-08-09T13:00:00+01:00" }, description: "with Sam" }],
      "shared@group.calendar.google.com": [{ id: "evt2", summary: "Team sync", start: { dateTime: "2026-08-09T14:00:00+01:00" } }],
    },
  }));
  const events = await fetchEventsForRange("tok", [
    { id: "primary", name: "Yawar", color: "#4285F4", writable: true },
    { id: "shared@group.calendar.google.com", name: "Shared", color: "#0B8043", writable: false },
  ], "2026-08-09T00:00:00+01:00", "2026-08-09T23:59:59+01:00");

  assert.equal(events[0].id, "evt1");
  assert.equal(events[0].calendarId, "primary");
  assert.equal(events[0].writable, true);
  assert.equal(events[0].notes, "with Sam");
  assert.equal(events[0].end, "2026-08-09T13:00:00+01:00", "the end is what gives the editor its duration");
  assert.equal(events[1].writable, false, "a read-only calendar's events must say so");
});

test("handleCreateCalendarEvent: honours an explicit calendarId and location", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let seenUrl = null, sentBody = null;
  installFetch(t, async (url, opts) => {
    seenUrl = String(url);
    sentBody = JSON.parse(opts.body);
    return jsonResponse(200, { id: "evt9" });
  });

  const req = { json: async () => ({ title: "Gym", start: "2026-08-09T18:00:00.000Z", calendarId: "other@group.calendar.google.com", location: "Leisure centre" }) };
  const resp = await (await handleCreateCalendarEvent(req, d1.env, EMAIL)).json();
  assert.equal(resp.status, "ok");
  assert.equal(resp.calendarId, "other@group.calendar.google.com");
  assert.match(seenUrl, /calendars\/other%40group\.calendar\.google\.com\/events/);
  assert.equal(sentBody.location, "Leisure centre");
});

test("handleUpdateCalendarEvent: sends only the fields given, so a rename can't disturb the time", async (t) => {
  const { handleUpdateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let method = null, sentBody = null, seenUrl = null;
  installFetch(t, async (url, opts) => {
    seenUrl = String(url); method = opts.method; sentBody = JSON.parse(opts.body);
    return jsonResponse(200, { id: "evt1" });
  });

  const req = { json: async () => ({ calendarId: "primary", eventId: "evt1", title: "Lunch with Sam" }) };
  const resp = await (await handleUpdateCalendarEvent(req, d1.env, EMAIL)).json();
  assert.equal(resp.status, "ok");
  assert.equal(method, "PATCH");
  assert.match(seenUrl, /calendars\/primary\/events\/evt1/);
  assert.deepEqual(sentBody, { summary: "Lunch with Sam" }, "no start/end means the event keeps its time");
});

test("handleUpdateCalendarEvent: moving an event rewrites both ends from the duration", async (t) => {
  const { handleUpdateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let sentBody = null;
  installFetch(t, async (url, opts) => { sentBody = JSON.parse(opts.body); return jsonResponse(200, { id: "evt1" }); });

  const req = { json: async () => ({ calendarId: "primary", eventId: "evt1", start: "2026-08-09T15:00:00.000Z", durationMinutes: 90 }) };
  await handleUpdateCalendarEvent(req, d1.env, EMAIL);
  assert.equal(sentBody.start.dateTime, "2026-08-09T15:00:00.000Z");
  assert.equal(sentBody.end.dateTime, "2026-08-09T16:30:00.000Z");
});

test("handleUpdateCalendarEvent: rejects a missing eventId or an empty patch before the network", async (t) => {
  const { handleUpdateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  installFetch(t, async () => { throw new Error("must not touch the network on a validation failure"); });

  const noId = await (await handleUpdateCalendarEvent({ json: async () => ({ title: "x" }) }, d1.env, EMAIL)).json();
  assert.match(noId.error, /eventId/i);

  const empty = await (await handleUpdateCalendarEvent({ json: async () => ({ eventId: "evt1" }) }, d1.env, EMAIL)).json();
  assert.match(empty.error, /nothing to update/i);
});

test("handleUpdateCalendarEvent: a 404 says so rather than reading as a generic failure", async (t) => {
  const { handleUpdateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async () => jsonResponse(404, {}, "Not Found"));

  const req = { json: async () => ({ eventId: "gone", title: "x" }) };
  const resp = await (await handleUpdateCalendarEvent(req, d1.env, EMAIL)).json();
  assert.equal(resp.status, "not_found");
});

test("handleDeleteCalendarEvent: deletes by calendar + event id, and 410 counts as gone", async (t) => {
  const { handleDeleteCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let method = null, seenUrl = null;
  installFetch(t, async (url, opts) => {
    seenUrl = String(url); method = opts.method;
    return new Response(null, { status: 204 });
  });

  const ok = await (await handleDeleteCalendarEvent(
    { url: "https://x/api/google/calendar/events?calendarId=primary&eventId=evt1" }, d1.env, EMAIL)).json();
  assert.equal(ok.status, "ok");
  assert.equal(method, "DELETE");
  assert.match(seenUrl, /calendars\/primary\/events\/evt1/);

  installFetch(t, async () => new Response(null, { status: 410 }));
  const gone = await (await handleDeleteCalendarEvent(
    { url: "https://x/api/google/calendar/events?calendarId=primary&eventId=evt1" }, d1.env, EMAIL)).json();
  assert.equal(gone.status, "ok", "already deleted is the same outcome as deleting it");
});

test("handleDeleteCalendarEvent: requires an eventId", async (t) => {
  const { handleDeleteCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  installFetch(t, async () => { throw new Error("must not touch the network on a validation failure"); });
  const resp = await (await handleDeleteCalendarEvent(
    { url: "https://x/api/google/calendar/events?calendarId=primary" }, d1.env, EMAIL)).json();
  assert.match(resp.error, /eventId/i);
});

test("calendar writes: an old read-only token surfaces as reconnect_required on update and delete too", async (t) => {
  const { handleUpdateCalendarEvent, handleDeleteCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async () => jsonResponse(403, {}, JSON.stringify({ error: { message: "Insufficient Permission" } })));

  const upd = await (await handleUpdateCalendarEvent({ json: async () => ({ eventId: "evt1", title: "x" }) }, d1.env, EMAIL)).json();
  assert.equal(upd.status, "reconnect_required");

  const del = await (await handleDeleteCalendarEvent(
    { url: "https://x/api/google/calendar/events?eventId=evt1" }, d1.env, EMAIL)).json();
  assert.equal(del.status, "reconnect_required");
});

test("fetchTasksInRange: returns dated open tasks inside the window, bucketed by their due date", async (t) => {
  const { fetchTasksInRange } = await loadWorker();
  installFetch(t, googleApiMocks({
    taskLists: [{ id: "list1", title: "My Tasks" }],
    tasksByList: {
      list1: [
        { id: "t1", title: "Renew passport", due: "2026-08-10T00:00:00.000Z" },
        { id: "t2", title: "Too early", due: "2026-08-01T00:00:00.000Z" },
        { id: "t3", title: "Too late", due: "2026-08-30T00:00:00.000Z" },
        { id: "t4", title: "No due date at all" },
        { id: "t5", title: "Already done", due: "2026-08-11T00:00:00.000Z", status: "completed" },
        { id: "t6", title: "Deleted", due: "2026-08-11T00:00:00.000Z", deleted: true },
      ],
    },
  }));

  const out = await fetchTasksInRange("tok", "2026-08-05", "2026-08-15");
  assert.equal(out.error, null);
  assert.deepEqual(out.tasks.map((x) => x.title), ["Renew passport"]);
  assert.equal(out.tasks[0].due, "2026-08-10T00:00:00.000Z", "the whole timestamp travels, not just its date");
  assert.equal(out.tasks[0].allDay, true, "midnight UTC is how Google spells a date-only task");
  assert.equal(out.tasks[0].list, "My Tasks");
});

test("fetchTasksInRange: a task given a time of day is not all-day", async (t) => {
  // Truncating due to its date prefix made every task look all-day, so a
  // task set for 1pm sat in the all-day row instead of at 13:00.
  const { fetchTasksInRange } = await loadWorker();
  installFetch(t, googleApiMocks({
    taskLists: [{ id: "list1", title: "My Tasks" }],
    tasksByList: { list1: [{ id: "t1", title: "Call the bank", due: "2026-08-10T12:00:00.000Z" }] },
  }));

  const out = await fetchTasksInRange("tok", "2026-08-05", "2026-08-15");
  assert.equal(out.tasks[0].allDay, false);
  assert.equal(out.tasks[0].due, "2026-08-10T12:00:00.000Z");
});

test("isDateOnlyDue distinguishes a dated task from a timed one", async () => {
  const { isDateOnlyDue } = await loadWorker();
  assert.equal(isDateOnlyDue("2026-08-10T00:00:00.000Z"), true);
  assert.equal(isDateOnlyDue("2026-08-10T12:00:00.000Z"), false);
  assert.equal(isDateOnlyDue(undefined), true, "no due date at all reads as all-day, not as midnight");
});

test("handleUpdateGoogleTask: ticks a task off in Google Tasks", async (t) => {
  const { handleUpdateGoogleTask } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  let seenUrl = null, method = null, body = null;
  installFetch(t, async (url, opts) => {
    seenUrl = String(url); method = opts.method; body = JSON.parse(opts.body);
    return jsonResponse(200, { id: "t1", status: "completed" });
  });

  const resp = await (await handleUpdateGoogleTask(
    { json: async () => ({ listId: "list1", taskId: "t1", completed: true }) }, d1.env, EMAIL)).json();
  assert.equal(resp.status, "ok");
  assert.equal(method, "PATCH");
  assert.match(seenUrl, /tasks\/v1\/lists\/list1\/tasks\/t1/);
  assert.deepEqual(body, { status: "completed" });
});

test("handleUpdateGoogleTask: reopening clears the completion stamp, not just the status", async (t) => {
  const { handleUpdateGoogleTask } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  let body = null;
  installFetch(t, async (url, opts) => { body = JSON.parse(opts.body); return jsonResponse(200, {}); });

  await handleUpdateGoogleTask({ json: async () => ({ listId: "l", taskId: "t", completed: false }) }, d1.env, EMAIL);
  assert.deepEqual(body, { status: "needsAction", completed: null },
    "leaving the timestamp behind keeps the task hidden in Google's own UI");
});

test("handleUpdateGoogleTask: requires both ids, and maps an old read-only token to reconnect_required", async (t) => {
  const { handleUpdateGoogleTask } = await loadWorker();
  const d1 = createFakeD1();
  installFetch(t, async () => { throw new Error("must not touch the network on a validation failure"); });
  const bad = await (await handleUpdateGoogleTask({ json: async () => ({ taskId: "t" }) }, d1.env, EMAIL)).json();
  assert.match(bad.error, /listId and taskId/);

  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  installFetch(t, async () => jsonResponse(403, {}, JSON.stringify({ error: { message: "Insufficient Permission" } })));
  const denied = await (await handleUpdateGoogleTask(
    { json: async () => ({ listId: "l", taskId: "t", completed: true }) }, d1.env, EMAIL)).json();
  assert.equal(denied.status, "reconnect_required");
});

test("fetchTasksInRange: reports a failure instead of looking like an empty task list", async (t) => {
  const { fetchTasksInRange } = await loadWorker();
  installFetch(t, async () => jsonResponse(403, {}, "Tasks API has not been used in project"));
  const out = await fetchTasksInRange("tok", "2026-08-05", "2026-08-15");
  assert.deepEqual(out.tasks, []);
  assert.match(out.error, /403/);
});

test("handleGetCalendarEvents: returns Google Tasks alongside the events", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  installFetch(t, googleApiMocks({
    calendars: [{ id: "primary", summary: "Yawar", primary: true, accessRole: "owner" }],
    eventsByCalendar: { primary: [{ id: "e1", summary: "Lunch", start: { dateTime: "2026-08-09T12:00:00+01:00" } }] },
    taskLists: [{ id: "list1", title: "My Tasks" }],
    tasksByList: { list1: [{ id: "t1", title: "Renew passport", due: "2026-08-09T00:00:00.000Z" }] },
  }));

  const body = await (await handleGetCalendarEvents(
    new Request("https://x/api/calendar/events?date=2026-08-09"), d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"))).json();
  assert.equal(body.status, "ok");
  assert.equal(body.events.length, 1);
  assert.equal(body.tasks.length, 1);
  assert.equal(body.tasks[0].title, "Renew passport");
  assert.equal(body.tasksError, null);
});

test("handleGetCalendarEvents: a Tasks failure never costs the user their agenda", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("tasks.googleapis.com")) return jsonResponse(403, {}, "Tasks API disabled");
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", accessRole: "owner" }] });
    return jsonResponse(200, { items: [{ id: "e1", summary: "Lunch", start: { dateTime: "2026-08-09T12:00:00+01:00" } }] });
  });

  const body = await (await handleGetCalendarEvents(
    new Request("https://x/api/calendar/events?date=2026-08-09"), d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"))).json();
  assert.equal(body.status, "ok", "the calendar still loaded");
  assert.equal(body.events.length, 1);
  assert.deepEqual(body.tasks, []);
  assert.match(body.tasksError, /403/, "but the reason is reported rather than swallowed");
});

test("nextDay / localDayOf: the day after, and which local day something falls on", async () => {
  const { nextDay, localDayOf } = await loadWorker();
  assert.equal(nextDay("2026-08-09"), "2026-08-10");
  assert.equal(nextDay("2026-08-31"), "2026-09-01", "month ends must not break it");
  assert.equal(nextDay("2026-12-31"), "2027-01-01");

  assert.equal(localDayOf("Europe/London", "2026-08-09T23:30:00+01:00"), "2026-08-09");
  assert.equal(localDayOf("Europe/London", "2026-08-09T23:30:00Z"), "2026-08-10", "00:30 BST is the next day");
  assert.equal(localDayOf("Europe/London", "2026-08-09"), "2026-08-09", "an all-day date is used as-is");
});

test("generateBrief: tomorrow's events and tasks reach the prompt, in their own section", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  let prompt = null, eventsUrl = null, calendarListCalls = 0;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) { calendarListCalls++; return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] }); }
    if (u.includes("/events")) {
      eventsUrl = decodeURIComponent(u);
      return jsonResponse(200, { items: [
        { summary: "Afternoon call", start: { dateTime: "2026-08-09T15:00:00+01:00" }, end: { dateTime: "2026-08-09T15:30:00+01:00" } },
        { summary: "Dentist", start: { dateTime: "2026-08-10T11:00:00+01:00" }, end: { dateTime: "2026-08-10T11:30:00+01:00" } },
      ] });
    }
    if (u.includes("users/@me/lists")) return jsonResponse(200, { items: [{ id: "l1", title: "My Tasks" }] });
    if (u.includes("/tasks?")) return jsonResponse(200, { items: [
      { title: "Pay rent", status: "needsAction", due: "2026-08-09T00:00:00.000Z" },
      { title: "Renew passport", status: "needsAction", due: "2026-08-10T00:00:00.000Z" },
      { title: "Next week thing", status: "needsAction", due: "2026-08-20T00:00:00.000Z" },
    ] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("Today\n- 15:00 Afternoon call"); }
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");

  // One ranged fetch covering both days, and the calendars listed only once.
  assert.equal(calendarListCalls, 1);
  assert.match(eventsUrl, /timeMin=2026-08-09T00:00:00/);
  assert.match(eventsUrl, /timeMax=2026-08-10T23:59:59/, "the range must reach the end of tomorrow");

  assert.match(prompt, /TODAY \(2026-08-09\)/);
  assert.match(prompt, /TOMORROW \(2026-08-10\)/);
  // Each event under the right heading.
  const todayPart = prompt.slice(prompt.indexOf("TODAY"), prompt.indexOf("TOMORROW"));
  const tomorrowPart = prompt.slice(prompt.indexOf("TOMORROW"));
  assert.match(todayPart, /Afternoon call/);
  assert.doesNotMatch(todayPart, /Dentist/, "tomorrow's event must not be listed under today");
  assert.match(tomorrowPart, /Dentist/);
  assert.match(todayPart, /Pay rent/);
  assert.match(tomorrowPart, /Renew passport/);
  assert.doesNotMatch(prompt, /Next week thing/, "the brief covers two days, not the whole month");
});

test("generateBrief: tomorrow is never filtered by the current time", async (t) => {
  // Today's already-finished events are dropped; tomorrow's must survive even
  // though their clock time is earlier than now.
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [
      { summary: "This morning", start: { dateTime: "2026-08-09T09:00:00+01:00" }, end: { dateTime: "2026-08-09T09:30:00+01:00" } },
      { summary: "Early tomorrow", start: { dateTime: "2026-08-10T08:00:00+01:00" }, end: { dateTime: "2026-08-10T08:30:00+01:00" } },
    ] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("ok"); }
    throw new Error("unexpected fetch " + u);
  });

  await generateBrief(d1.env, EMAIL, new Date("2026-08-09T18:00:00Z"));
  assert.doesNotMatch(prompt, /This morning/, "today's finished event is dropped");
  assert.match(prompt, /Early tomorrow/, "tomorrow has not happened yet, whatever the clock says");
});

test("the default prompt asks for a prose opener, then a bulleted Today/Tomorrow list", async () => {
  const { DEFAULT_BRIEF_PROMPT } = await loadWorker();
  assert.match(DEFAULT_BRIEF_PROMPT, /Today/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Tomorrow/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Nothing scheduled/i, "an empty section still needs a bullet");
  // The opener is the only prose in it, and it is pinned to the figures.
  assert.match(DEFAULT_BRIEF_PROMPT, /two or three sentences, prose/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Never bullet it/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Never invent, recompute, estimate or round a figure/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Then the schedule, and nothing else/);
  /* The no-invention rule must bind numbers only. Phrased as "never comment on
     anything HISTORY does not measure" it also suppressed the journal, which
     is how a written-down commitment to watch calories never reached a brief:
     there is no calorie figure, so the model stayed silent about it. */
  assert.match(DEFAULT_BRIEF_PROMPT, /governs numbers only/);
  assert.match(DEFAULT_BRIEF_PROMPT, /worth writing about whether or not HISTORY measures it/);
  // And a commitment the writer made has to outrank a drifting statistic.
  assert.match(DEFAULT_BRIEF_PROMPT, /What the writer told themselves to do/);
  assert.match(DEFAULT_BRIEF_PROMPT, /asked to be reminded/);
  assert.match(DEFAULT_BRIEF_PROMPT, /A commitment from the journal outranks a drifting figure/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Honour any date they attached/);
});

/* ---------- prayer times ---------- */

test("toHHMM copes with every shape a provider might use", async () => {
  const { toHHMM } = await loadWorker();
  assert.equal(toHHMM("05:12"), "05:12");
  assert.equal(toHHMM("05:12 (BST)"), "05:12", "Aladhan tags the zone on the end");
  assert.equal(toHHMM("5:12 am"), "05:12");
  assert.equal(toHHMM("7:05 PM"), "19:05");
  assert.equal(toHHMM("12:30 am"), "00:30", "midnight is 00, not 12");
  assert.equal(toHHMM("12:30 pm"), "12:30", "noon stays 12");
  // An ISO stamp is read textually: parsing it as a Date would convert to UTC
  // and shift the time the provider meant.
  assert.equal(toHHMM("2026-08-10T05:12:00+01:00"), "05:12");
  assert.equal(toHHMM("nonsense"), null);
  assert.equal(toHHMM(null), null);
});

test("findTimings pulls the six prayers out of whatever shape they arrive in", async () => {
  const { findTimings } = await loadWorker();

  // Flat, lowercase.
  assert.deepEqual(
    findTimings({ fajr: "04:00", sunrise: "05:30", dhuhr: "13:00", asr: "17:00", maghrib: "20:30", isha: "22:00" }),
    { Fajr: "04:00", Sunrise: "05:30", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" });

  // Nested, capitalised, with the Aladhan-style zone suffix.
  const aladhanish = { code: 200, data: { timings: { Fajr: "04:00 (BST)", Sunrise: "05:30 (BST)", Dhuhr: "13:00 (BST)", Asr: "17:00 (BST)", Maghrib: "20:30 (BST)", Isha: "22:00 (BST)" } } };
  assert.equal(findTimings(aladhanish).Dhuhr, "13:00");

  // Alternative spellings, and times wrapped in an object.
  const alt = { result: { prayers: { Fajr: { time: "2026-08-10T04:00:00+01:00" }, Shurooq: { time: "05:30" }, Zuhr: { time: "13:00" }, Asr: { time: "17:00" }, Maghrib: { time: "20:30" }, Ishaa: { time: "22:00" } } } };
  const got = findTimings(alt);
  assert.equal(got.Fajr, "04:00");
  assert.equal(got.Sunrise, "05:30", "shurooq is sunrise");
  assert.equal(got.Dhuhr, "13:00", "zuhr is dhuhr");

  // Not a timings object.
  assert.equal(findTimings({ meta: { method: "MWL" }, note: "fajr is early" }), null);
});

test("asrSchool: only Hanafi shifts Asr", async () => {
  const { asrSchool } = await loadWorker();
  assert.equal(asrSchool("hanafi"), 1);
  assert.equal(asrSchool("Hanafi"), 1);
  assert.equal(asrSchool("shafii"), 0);
  assert.equal(asrSchool("maliki"), 0);
  assert.equal(asrSchool("hanbali"), 0);
  assert.equal(asrSchool(undefined), 0);
});

test("handlePrayerDay: UmmahAPI answers and is reported as the source", async (t) => {
  const { handlePrayerDay } = await loadWorker();
  let seen = null;
  installFetch(t, async (url) => {
    seen = String(url);
    return jsonResponse(200, { data: { fajr: "04:05", sunrise: "05:35", dhuhr: "13:05", asr: "17:05", maghrib: "20:35", isha: "22:05" } });
  });

  const body = await (await handlePrayerDay(
    new Request("https://x/api/prayer?lat=51.5&lng=-0.12&method=3&madhab=hanafi&timezone=Europe/London"),
    {}, new Date("2026-08-10T10:00:00Z"))).json();

  assert.equal(body.source, "ummahapi");
  assert.equal(body.day, "2026-08-10");
  assert.equal(body.timings.Fajr, "04:05");
  assert.match(seen, /ummahapi\.com/);
  // UmmahAPI names its methods and spells the Asr rules "Hanafi"/"Shafi";
  // the client stores Aladhan's numbers and our own lowercase madhabs.
  assert.match(seen, /method=MuslimWorldLeague/);
  assert.match(seen, /madhab=Hanafi/);
  assert.equal(body.warning, undefined, "nothing to warn about when the primary worked");
});

test("handlePrayerDay: a method UmmahAPI doesn't know goes straight to Aladhan", async (t) => {
  const { handlePrayerDay } = await loadWorker();
  const hits = [];
  installFetch(t, async (url) => {
    hits.push(String(url));
    return jsonResponse(200, { data: { timings: { Fajr: "04:10", Sunrise: "05:40", Dhuhr: "13:10", Asr: "17:10", Maghrib: "20:40", Isha: "22:10" } } });
  });

  // 8 is Aladhan's "Gulf Region", one of the four with no adhan equivalent.
  // Asking UmmahAPI anyway would get the parameter ignored and Muslim World
  // League times back under Gulf's name - right-looking and wrong, with no
  // fallback to correct it.
  const body = await (await handlePrayerDay(
    new Request("https://x/api/prayer?lat=25&lng=55&method=8"), {}, new Date("2026-08-10T10:00:00Z"))).json();

  assert.equal(body.source, "aladhan");
  assert.equal(hits.length, 1, "UmmahAPI is not asked at all");
  assert.match(hits[0], /aladhan/);
  assert.match(hits[0], /method=8/, "and Aladhan gets the number it defined");
  assert.match(body.warning, /no UmmahAPI equivalent/);
});

test("ummahMethod/ummahMadhab: the numbers the client stores become names the provider knows", async () => {
  const { ummahMethod, ummahMadhab } = await loadWorker();
  assert.equal(ummahMethod(3), "MuslimWorldLeague");
  assert.equal(ummahMethod("4"), "UmmAlQura");
  assert.equal(ummahMethod(2), "NorthAmerica");
  assert.equal(ummahMethod(1), "Karachi");
  assert.equal(ummahMethod(5), "Egyptian");
  assert.equal(ummahMethod(7), "Tehran");
  assert.equal(ummahMethod(9), "Kuwait");
  assert.equal(ummahMethod(10), "Qatar");
  assert.equal(ummahMethod(11), "Singapore");
  assert.equal(ummahMethod(13), "Turkey");
  assert.equal(ummahMethod(16), "Dubai");
  // The one the comparison turned on: Aladhan calls it "Moonsighting
  // Committee Worldwide", adhan and UmmahAPI call it this.
  assert.equal(ummahMethod(15), "MoonsightingCommittee");
  assert.equal(ummahMethod(null), "MuslimWorldLeague", "no method asked for is the provider's own default");
  // The four Aladhan methods with no adhan equivalent: Jafari, Gulf Region,
  // France (UOIF) and Russia. These must never be guessed at.
  [0, 8, 12, 14].forEach((m) => {
    assert.equal(ummahMethod(m), null, `method ${m} must not be guessed at`);
  });

  assert.equal(ummahMadhab("hanafi"), "Hanafi");
  ["shafii", "maliki", "hanbali", null, undefined].forEach((m) => {
    assert.equal(ummahMadhab(m), "Shafi", `${m} uses the standard Asr rule`);
  });
});

test("handlePrayerDay: falls back to Aladhan, and says why", async (t) => {
  const { handlePrayerDay } = await loadWorker();
  const called = [];
  installFetch(t, async (url) => {
    const u = String(url);
    called.push(u);
    if (u.includes("ummahapi")) return jsonResponse(503, {}, "upstream down");
    return jsonResponse(200, { data: { timings: { Fajr: "04:05 (BST)", Sunrise: "05:35 (BST)", Dhuhr: "13:05 (BST)", Asr: "17:05 (BST)", Maghrib: "20:35 (BST)", Isha: "22:05 (BST)" } } });
  });

  const body = await (await handlePrayerDay(
    new Request("https://x/api/prayer?lat=51.5&lng=-0.12&madhab=hanafi"), {}, new Date("2026-08-10T10:00:00Z"))).json();

  assert.equal(body.source, "aladhan");
  assert.equal(body.timings.Asr, "17:05");
  assert.match(body.warning, /ummahapi.*503/, "a silent downgrade would be worse than a noisy one");
  assert.match(called[1], /school=1/, "hanafi must reach Aladhan as school=1");
});

test("handlePrayerDay: an unreadable primary response reports the payload's real keys", async (t) => {
  // The whole point of the diagnostic: fix the shape from one look, rather
  // than guessing at an API whose body we could not inspect.
  const { handlePrayerDay } = await loadWorker();
  installFetch(t, async (url) => {
    if (String(url).includes("ummahapi")) return jsonResponse(200, { status: "ok", payload: { salah: [] } });
    return jsonResponse(500, {}, "aladhan down too");
  });

  const res = await handlePrayerDay(new Request("https://x/api/prayer?lat=51.5&lng=-0.12"), {}, new Date("2026-08-10T10:00:00Z"));
  const body = await res.json();
  assert.equal(res.status, 502);
  assert.equal(body.error, "prayer_unavailable");
  assert.match(body.warning, /unrecognised response/);
  assert.match(body.warning, /status, payload/, "the actual keys, so the parser can be corrected");
});

test("handlePrayerDay: lat/lng are required", async (t) => {
  const { handlePrayerDay } = await loadWorker();
  installFetch(t, async () => { throw new Error("must not call a provider without coordinates"); });
  const res = await handlePrayerDay(new Request("https://x/api/prayer"), {}, new Date());
  assert.equal(res.status, 400);
});

test("handlePrayerMonth: folds either provider's month into one date map", async (t) => {
  const { handlePrayerMonth } = await loadWorker();

  // UmmahAPI-ish: keyed by date.
  installFetch(t, async () => jsonResponse(200, {
    days: {
      "2026-08-01": { fajr: "04:00", sunrise: "05:30", dhuhr: "13:00", asr: "17:00", maghrib: "20:30", isha: "22:00" },
      "2026-08-02": { fajr: "04:02", sunrise: "05:32", dhuhr: "13:00", asr: "17:00", maghrib: "20:28", isha: "21:58" },
    },
  }));
  let body = await (await handlePrayerMonth(
    new Request("https://x/api/prayer/month?lat=51.5&lng=-0.12&month=8&year=2026"), {}, new Date("2026-08-10T10:00:00Z"))).json();
  assert.equal(body.source, "ummahapi");
  assert.equal(Object.keys(body.days).length, 2);
  assert.equal(body.days["2026-08-02"].Fajr, "04:02");

  // Aladhan-ish: an array, each entry carrying its own gregorian date.
  installFetch(t, async (url) => {
    if (String(url).includes("ummahapi")) return jsonResponse(500, {}, "down");
    return jsonResponse(200, { data: [
      { timings: { Fajr: "04:00 (BST)", Sunrise: "05:30", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:30", Isha: "22:00" }, date: { gregorian: { date: "01-08-2026" } } },
      { timings: { Fajr: "04:02 (BST)", Sunrise: "05:32", Dhuhr: "13:00", Asr: "17:00", Maghrib: "20:28", Isha: "21:58" }, date: { gregorian: { date: "02-08-2026" } } },
    ] });
  });
  body = await (await handlePrayerMonth(
    new Request("https://x/api/prayer/month?lat=51.5&lng=-0.12&month=8&year=2026"), {}, new Date("2026-08-10T10:00:00Z"))).json();
  assert.equal(body.source, "aladhan");
  assert.equal(body.days["2026-08-01"].Fajr, "04:00", "DD-MM-YYYY must be flipped, not used as-is");
  assert.equal(body.days["2026-08-02"].Isha, "21:58");
});

test("handlePrayerMonth: passes the timezone through, same as the day endpoint", async (t) => {
  const { handlePrayerMonth } = await loadWorker();
  const seen = [];
  installFetch(t, async (url) => {
    seen.push(String(url));
    return jsonResponse(200, { days: { "2026-08-01": { fajr: "04:00", sunrise: "05:30", dhuhr: "13:00", asr: "17:00", maghrib: "20:30", isha: "22:00" } } });
  });
  await handlePrayerMonth(
    new Request("https://x/api/prayer/month?lat=51.5&lng=-0.12&month=8&year=2026&timezone=Asia%2FKarachi"), {}, new Date("2026-08-10T10:00:00Z"));
  // Without this a month's times can disagree with the same day fetched on
  // its own - and the client prefers the month cache.
  assert.match(seen[0], /timezone=Asia(%2F|\/)Karachi/);
});

test("handleGetCalendarEvents: sends the calendar list so the editor can offer a choice", async (t) => {
  const { handleGetCalendarEvents } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, googleApiMocks({
    calendars: [
      { id: "me@x", summary: "Personal", primary: true, accessRole: "owner", backgroundColor: "#4285F4" },
      { id: "fam@g", summary: "Family", accessRole: "writer", backgroundColor: "#0B8043" },
      { id: "hol@g", summary: "UK holidays", accessRole: "reader", backgroundColor: "#616161" },
    ],
  }));

  const req = { url: "https://x/api/calendar/events?date=2026-08-11" };
  const resp = await (await handleGetCalendarEvents(req, d1.env, EMAIL)).json();

  // Derived from the events instead, a calendar with nothing on it that week
  // would be invisible - which is exactly when you'd want to add to it.
  assert.deepEqual(resp.calendars.map((c) => [c.name, c.writable]),
    [["Personal", true], ["Family", true], ["UK holidays", false]]);
  assert.equal(resp.calendars[0].primary, true);
});

test("handleCreateCalendarEvent: an all-day event is a date range, with an exclusive end", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let sent = null;
  installFetch(t, async (url, opts) => {
    sent = JSON.parse(opts.body);
    return jsonResponse(200, { id: "evt-1", htmlLink: "https://cal/evt-1" });
  });

  const req = new Request("https://x/api/google/calendar/events", {
    method: "POST",
    body: JSON.stringify({ title: "Birthday", allDay: true, day: "2026-08-15", calendarId: "fam@g" }),
  });
  const resp = await (await handleCreateCalendarEvent(req, d1.env, EMAIL)).json();

  assert.equal(resp.status, "ok");
  // Google spells all-day as `date`, and its end is EXCLUSIVE - a single day
  // runs to the following morning. A day out here shows on the wrong dates.
  assert.deepEqual(sent.start, { date: "2026-08-15" });
  assert.deepEqual(sent.end, { date: "2026-08-16" });
  assert.equal(sent.start.dateTime, undefined);
});

test("handleCreateCalendarEvent: an all-day event without a day is refused, not guessed at", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async () => { throw new Error("must not reach Google without a date"); });

  const req = new Request("https://x/api/google/calendar/events", {
    method: "POST",
    body: JSON.stringify({ title: "Birthday", allDay: true }),
  });
  const resp = await handleCreateCalendarEvent(req, d1.env, EMAIL);
  assert.equal(resp.status, 400);
  assert.match((await resp.json()).error, /day/);
});

test("handleCreateCalendarEvent: a timed event is still a dateTime range", async (t) => {
  const { handleCreateCalendarEvent } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  let sent = null;
  installFetch(t, async (url, opts) => {
    sent = JSON.parse(opts.body);
    return jsonResponse(200, { id: "evt-2" });
  });

  const req = new Request("https://x/api/google/calendar/events", {
    method: "POST",
    body: JSON.stringify({ title: "Physio", start: "2026-08-15T14:00:00.000Z", durationMinutes: 45 }),
  });
  await handleCreateCalendarEvent(req, d1.env, EMAIL);
  assert.equal(sent.start.dateTime, "2026-08-15T14:00:00.000Z");
  assert.equal(sent.end.dateTime, "2026-08-15T14:45:00.000Z");
  assert.equal(sent.start.date, undefined);
});

/* ---------- du'as ----------
 * Pictures of du'as, linked to a dhikr item. They live in D1 because the link
 * rides the synced profile, so a second device has to be able to fetch the
 * picture the link points at.
 */
const PNG_1PX = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function duaReq(body) {
  return { json: async () => body };
}

test("a du'a is stored, listed and served back as image bytes", async () => {
  const worker = await loadWorker();
  const { env } = createFakeD1();

  const created = await (await worker.handleCreateDua(duaReq({ name: "Morning", dataUrl: PNG_1PX }), env, EMAIL)).json();
  assert.ok(created.dua.id, "it comes back with an id to link against");
  assert.equal(created.dua.name, "Morning");

  const listed = await (await worker.handleListDuas(env, EMAIL)).json();
  assert.equal(listed.duas.length, 1);
  assert.equal(listed.duas[0].name, "Morning");
  assert.equal(listed.duas[0].data, undefined, "the list must not carry the bytes");

  const res = await worker.handleGetDua(env, EMAIL, created.dua.id);
  assert.equal(res.headers.get("content-type"), "image/png");
  assert.match(res.headers.get("cache-control"), /private/, "someone's du'as are not for a shared cache");
  assert.ok((await res.arrayBuffer()).byteLength > 0);
});

test("another sign-in cannot read or list a du'a that isn't theirs", async () => {
  const worker = await loadWorker();
  const { env } = createFakeD1();
  const created = await (await worker.handleCreateDua(duaReq({ dataUrl: PNG_1PX }), env, EMAIL)).json();

  const res = await worker.handleGetDua(env, "someone.else@example.com", created.dua.id);
  assert.equal(res.status, 404);
  const listed = await (await worker.handleListDuas(env, "someone.else@example.com")).json();
  assert.equal(listed.duas.length, 0);
});

test("anything that isn't a base64 image is refused", async () => {
  const worker = await loadWorker();
  const { env } = createFakeD1();
  for (const bad of [{}, { dataUrl: "" }, { dataUrl: "https://example.com/a.png" },
                     { dataUrl: "data:text/html;base64,PHNjcmlwdD4=" },
                     { dataUrl: "data:application/pdf;base64,JVBERi0=" }]) {
    const res = await worker.handleCreateDua(duaReq(bad), env, EMAIL);
    assert.equal(res.status, 400, JSON.stringify(bad) + " should be refused");
  }
  assert.equal((await (await worker.handleListDuas(env, EMAIL)).json()).duas.length, 0);
});

test("an image over the ceiling is refused rather than truncated", async () => {
  const worker = await loadWorker();
  const { env } = createFakeD1();
  const huge = "data:image/jpeg;base64," + "A".repeat(1000000);
  const res = await worker.handleCreateDua(duaReq({ dataUrl: huge }), env, EMAIL);
  assert.equal(res.status, 413);
  assert.match((await res.json()).error, /too large/);
});

test("removing a du'a takes it out of the list and stops serving it", async () => {
  const worker = await loadWorker();
  const { env } = createFakeD1();
  const created = await (await worker.handleCreateDua(duaReq({ dataUrl: PNG_1PX }), env, EMAIL)).json();

  await worker.handleDeleteDua(env, EMAIL, created.dua.id);
  assert.equal((await (await worker.handleListDuas(env, EMAIL)).json()).duas.length, 0);
  assert.equal((await worker.handleGetDua(env, EMAIL, created.dua.id)).status, 404);
});

/* ---------- the journal in the brief ---------- */

test("fetchJournal returns today's entry and the recent ones, skipping days with nothing written", async () => {
  const { fetchJournal } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedDay(EMAIL, "2026-08-09", { notes: "Long day. Finally booked the car service." });
  d1.seedDay(EMAIL, "2026-08-08", { notes: "  Slept badly.  " });
  d1.seedDay(EMAIL, "2026-08-07", { notes: "" });          // logged, but nothing written
  d1.seedDay(EMAIL, "2026-08-06", { weight: "104" });      // no notes field at all
  d1.seedDay(EMAIL, "2026-08-05", { notes: "Started the new routine." });
  d1.seedDay(EMAIL, "2026-08-10", { notes: "Tomorrow's entry." }); // must not leak backwards

  const j = await fetchJournal(d1.env, EMAIL, "2026-08-09");
  assert.equal(j.error, null);
  assert.deepEqual(j.today, { day: "2026-08-09", text: "Long day. Finally booked the car service." });
  assert.deepEqual(j.earlier.map((e) => e.day), ["2026-08-08", "2026-08-05"], "newest first, blanks skipped");
  assert.equal(j.earlier[0].text, "Slept badly.", "trimmed");
});

test("fetchJournal caps how far back it looks and how long one entry can be", async () => {
  const { fetchJournal } = await loadWorker();
  const d1 = createFakeD1();
  // 20 consecutive entries, and one of them far longer than the per-entry cap.
  for (let i = 0; i < 20; i++) {
    const day = "2026-08-" + String(20 - i).padStart(2, "0");
    d1.seedDay(EMAIL, day, { notes: i === 1 ? "x".repeat(5000) : "entry " + i });
  }
  const j = await fetchJournal(d1.env, EMAIL, "2026-08-20", 5);
  assert.equal(j.earlier.length, 5, "the window is bounded, not the whole history");
  assert.ok(j.earlier[0].text.length < 1200, "one enormous entry cannot crowd out the rest");
  assert.ok(j.earlier[0].text.endsWith("…"), "and it says it was cut");
});

test("fetchJournal reports a database failure instead of pretending nothing was written", async () => {
  const { fetchJournal } = await loadWorker();
  const env = { DB: { prepare() { throw new Error("no such table: days"); } } };
  const j = await fetchJournal(env, EMAIL, "2026-08-09");
  assert.match(j.error, /no such table/);
  assert.equal(j.today, null);
  assert.deepEqual(j.earlier, []);
});

test("generateBrief feeds the journal to Gemini as context for the opening paragraph", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  d1.seedDay(EMAIL, "2026-08-09", { notes: "Meant to call the garage and forgot again." });
  d1.seedDay(EMAIL, "2026-08-08", { notes: "Third short night this week." });

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("Today\n- Nothing scheduled"); }
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");
  assert.match(prompt, /\nJOURNAL \(the writer's own words/);
  assert.match(prompt, /Meant to call the garage/);
  assert.match(prompt, /Third short night this week/, "previous entries go in too, not just today's");
  assert.match(prompt, /What the writer told themselves to do/);
  assert.match(prompt, /Never quote the journal back word for word/);
});

test("generateBrief leaves the JOURNAL heading out entirely when nothing has been written", async (t) => {
  // An empty heading is an invitation to invent an entry.
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("ok"); }
    throw new Error("unexpected fetch " + u);
  });

  await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  // The instructions mention JOURNAL; it is the data section that must be absent.
  assert.doesNotMatch(prompt, /\nJOURNAL \(the writer's own words/);
});

test("a journal read failure is recorded beside the summary, and never blocks the brief", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  const realPrepare = d1.env.DB.prepare;
  d1.env.DB.prepare = (sql) => {
    if (/FROM days/.test(sql)) throw new Error("d1 unavailable");
    return realPrepare(sql);
  };

  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) return geminiOk("A quiet day.");
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok", "the brief still generates - the journal is an enrichment");
  assert.match(result.error, /d1 unavailable/);
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).summary, "A quiet day.");
});

/* ---------- the whole record, reduced to figures ---------- */

/** A day record with only the fields the history summary reads. */
function hday(o) {
  return { prayers: o.prayers || {}, sleep: o.sleep ?? "", weight: o.weight ?? "", exercise: !!o.exercise, notes: o.notes || "" };
}
const ALL5 = { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true };

test("summariseHistory counts prayers over every date in range, not just the days with a record", async () => {
  // The same rule prayerHistoryDays() uses on the client. A date nobody
  // opened the app on is five missed, not a day that never happened - if the
  // two disagree the brief contradicts the app's own prayer summary.
  const { summariseHistory } = await loadWorker();
  const rows = [
    { day: "2026-08-01", prayers: ALL5, sleep: null, weight: null, exercise: false },
    // 08-02 and 08-03 have no record at all: ten missed.
    { day: "2026-08-04", prayers: { fajr: true }, sleep: null, weight: null, exercise: false },
  ];
  const text = summariseHistory(rows, {}, "2026-08-05"); // yesterday is 08-04

  assert.match(text, /Tracking since 2026-08-01 - 4 day\(s\) of history/);
  assert.match(text, /Prayers: 6 of 20 prayed \(30%\)/);
  assert.match(text, /Most often missed: Dhuhr \(3 times\)/);
});

test("summariseHistory subtracts what has already been made up from the qada owed", async () => {
  const { summariseHistory } = await loadWorker();
  const rows = [
    { day: "2026-08-01", prayers: {}, sleep: null, weight: null, exercise: false },
    { day: "2026-08-02", prayers: {}, sleep: null, weight: null, exercise: false },
  ];
  const text = summariseHistory(rows, { qada: { fajr: 2, dhuhr: 5 } }, "2026-08-03");
  assert.match(text, /Qada still owed[^\n]*Asr 2/);
  assert.doesNotMatch(text, /Qada still owed[^\n]*Fajr/, "both Fajrs already made up");
  assert.doesNotMatch(text, /Qada still owed[^\n]*Dhuhr/, "more made up than missed never goes negative");
});

test("summariseHistory averages only the nights actually logged", async () => {
  const { summariseHistory } = await loadWorker();
  const rows = [
    { day: "2026-08-01", prayers: {}, sleep: "8", weight: null, exercise: false },
    { day: "2026-08-02", prayers: {}, sleep: "", weight: null, exercise: false },   // not zero hours
    { day: "2026-08-03", prayers: {}, sleep: "6", weight: null, exercise: false },
    { day: "2026-08-04", prayers: {}, sleep: "5.5", weight: null, exercise: false },
  ];
  const text = summariseHistory(rows, {}, "2026-08-05");
  assert.match(text, /Sleep: 6\.5h average across 3 logged night\(s\)/);
  assert.match(text, /2 of those 3 were under 7h/);
  assert.match(text, /Nothing logged on 1 of the 4 day\(s\)/);
});

test("summariseHistory reports weight against the start and the goal, and says which way it is moving", async () => {
  const { summariseHistory } = await loadWorker();
  const rows = [
    { day: "2026-08-01", prayers: {}, sleep: null, weight: "106", exercise: false },
    { day: "2026-08-04", prayers: {}, sleep: null, weight: "104.2", exercise: false },
  ];
  const text = summariseHistory(rows, { startWeight: 108, targetWeight: 88 }, "2026-08-05");
  assert.match(text, /Weight: 104\.2kg on 2026-08-04 \(2 logged\)/);
  assert.match(text, /−3\.8kg against a start of 108\.0kg/);
  assert.match(text, /16\.2kg still to go to 88\.0kg/);
  assert.match(text, /−1\.8kg across 2 weigh-ins in the last 4 days/);
});

test("summariseHistory says nothing rather than guessing when a thing has never been logged", async () => {
  const { summariseHistory } = await loadWorker();
  const rows = [{ day: "2026-08-01", prayers: ALL5, sleep: null, weight: null, exercise: false }];
  const text = summariseHistory(rows, { startWeight: 108, targetWeight: 88 }, "2026-08-03");
  assert.match(text, /Sleep: nothing logged at all\./);
  assert.match(text, /Weight: nothing logged\./);
  assert.doesNotMatch(text, /average/, "no invented averages from no data");
});

test("summariseHistory returns nothing at all before there is a completed day", async () => {
  // Today is not history: it isn't finished, so there is nothing to judge.
  const { summariseHistory } = await loadWorker();
  assert.equal(summariseHistory([], {}, "2026-08-05"), null);
  assert.equal(summariseHistory([{ day: "2026-08-05", prayers: ALL5 }], {}, "2026-08-05"), null);
});

test("fetchTrends reads the whole record out of D1 and hands back computed figures", async () => {
  const { fetchTrends } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedProfile(EMAIL, { startWeight: 108, targetWeight: 88, qada: { fajr: 1 } });
  d1.seedDay(EMAIL, "2026-08-01", hday({ prayers: ALL5, sleep: "7", weight: "106", exercise: true }));
  d1.seedDay(EMAIL, "2026-08-02", hday({ prayers: { fajr: true, dhuhr: true }, sleep: "5" }));
  d1.seedDay(EMAIL, "2026-08-03", hday({ prayers: ALL5, sleep: "8", weight: "105" }));

  const trends = await fetchTrends(d1.env, EMAIL, "2026-08-04");
  assert.equal(trends.error, null);
  assert.match(trends.text, /Prayers: 12 of 15 prayed \(80%\)/);
  assert.match(trends.text, /Sleep: 6\.7h average across 3 logged night\(s\)/);
  assert.match(trends.text, /Weight: 105\.0kg on 2026-08-03/);
  assert.match(trends.text, /Exercise: done on 1 of 3 day\(s\)/);
});

test("fetchTrends reports a failure instead of blocking the brief", async () => {
  const { fetchTrends } = await loadWorker();
  const env = { DB: { prepare() { throw new Error("d1 unavailable"); } } };
  const trends = await fetchTrends(env, EMAIL, "2026-08-04");
  assert.match(trends.error, /d1 unavailable/);
  assert.equal(trends.text, null);
});

test("generateBrief puts the computed history in front of the schedule and asks for a prose opener", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  d1.seedProfile(EMAIL, { startWeight: 108, targetWeight: 88 });
  d1.seedDay(EMAIL, "2026-08-07", hday({ prayers: ALL5, sleep: "5", weight: "106" }));
  d1.seedDay(EMAIL, "2026-08-08", hday({ prayers: { fajr: true }, sleep: "5.5", notes: "Skipped the gym again." }));

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("Sleep is the one to watch.\n\nToday\n- Nothing scheduled"); }
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");
  assert.match(prompt, /HISTORY \(already computed from the full record/);
  assert.match(prompt, /Prayers: 6 of 10 prayed/);
  assert.match(prompt, /Sleep: 5\.3h average/);
  assert.match(prompt, /short paragraph - two or three sentences, prose/);
  assert.match(prompt, /never recompute one/);
  // The history has to come before the day's events, or the opener is written
  // about today instead of about the trend.
  assert.ok(prompt.indexOf("HISTORY") < prompt.indexOf("TODAY (2026-08-09)"));
  // The journal is context for that paragraph now, not a section of its own.
  assert.match(prompt, /Skipped the gym again/);
  assert.doesNotMatch(prompt, /"Notes" section/);
});

test("a history read failure is recorded beside the summary and never blocks the brief", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  const realPrepare = d1.env.DB.prepare;
  d1.env.DB.prepare = (sql) => {
    if (/FROM profile/.test(sql)) throw new Error("profile unreadable");
    return realPrepare(sql);
  };

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("Today\n- Nothing scheduled"); }
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");
  assert.match(result.error, /profile unreadable/);
  assert.doesNotMatch(prompt, /HISTORY \(already computed/, "no half-built history block");
  assert.match(prompt, /If both HISTORY and JOURNAL are absent, skip the paragraph/);
});

test("fetchJournal reaches well past a fortnight, and says how far back it went", async () => {
  // An intention from two months ago that never happened is worth more to the
  // opening paragraph than yesterday's weather, so the window is a budget
  // rather than a fixed fortnight.
  const { fetchJournal } = await loadWorker();
  const d1 = createFakeD1();
  for (let i = 0; i < 40; i++) {
    const d = new Date("2026-08-16T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    d1.seedDay(EMAIL, d.toISOString().slice(0, 10), { notes: "entry " + i });
  }
  const j = await fetchJournal(d1.env, EMAIL, "2026-08-16");
  assert.equal(j.earlier.length, 39, "not truncated at 14");
  assert.equal(j.oldest, "2026-07-08");
  assert.equal(j.omitted, 0);
});

test("fetchJournal spends its character budget newest-first and reports what it dropped", async () => {
  const { fetchJournal } = await loadWorker();
  const d1 = createFakeD1();
  // Each entry is clipped to 900 chars, so ~16 of them fill a 14000 budget.
  for (let i = 0; i < 40; i++) {
    const d = new Date("2026-08-16T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    d1.seedDay(EMAIL, d.toISOString().slice(0, 10), { notes: "e" + i + " " + "x".repeat(2000) });
  }
  const j = await fetchJournal(d1.env, EMAIL, "2026-08-16");

  assert.ok(j.earlier.length > 5 && j.earlier.length < 40, "bounded, but not to a handful");
  assert.ok(j.omitted > 0, "and it knows how many it left out");
  assert.equal(j.earlier[0].day, "2026-08-15", "the freshest entries are the ones kept");
  const spent = (j.today ? j.today.text.length : 0) + j.earlier.reduce((a, e) => a + e.text.length, 0);
  assert.ok(spent <= 14000 + 901, "the whole block stays inside the budget");
});

test("today's entry is never dropped for budget, however much history there is", async () => {
  const { fetchJournal } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedDay(EMAIL, "2026-08-16", { notes: "what happened today" });
  for (let i = 1; i < 60; i++) {
    const d = new Date("2026-08-16T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - i);
    d1.seedDay(EMAIL, d.toISOString().slice(0, 10), { notes: "x".repeat(2000) });
  }
  const j = await fetchJournal(d1.env, EMAIL, "2026-08-16");
  assert.equal(j.today.text, "what happened today");
});

test("the prompt tells the model how far the journal reaches, and to use any of it", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  d1.seedDay(EMAIL, "2026-06-02", { notes: "Said I would sort the garage out." });
  d1.seedDay(EMAIL, "2026-08-08", { notes: "Still haven't." });

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("ok"); }
    throw new Error("unexpected fetch " + u);
  });

  await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.match(prompt, /every entry back to 2026-06-02/);
  assert.match(prompt, /Said I would sort the garage out/, "an entry from two months ago is in there");
  assert.match(prompt, /Draw on any entry, however old/);
});

/* ---------- the brief survives a busy Gemini ---------- */

test("callGemini retries a 503 instead of giving up on the first one", async (t) => {
  // Google answers 503 "experiencing high demand" regularly, and its own
  // message says to try again later. One attempt was not really an attempt -
  // it was the single commonest reason a brief failed.
  const { callGemini } = await loadWorker();
  const seen = [];
  installFetch(t, async (url) => {
    seen.push(String(url).match(/models\/([^:]+):/)[1]);
    if (seen.length < 3) return jsonResponse(503, {}, "This model is currently experiencing high demand.");
    return geminiOk("Here is your brief.");
  });

  const text = await callGemini({ GEMINI_API_KEY: "k" }, "prompt", { delays: [0, 0] });
  assert.equal(text, "Here is your brief.");
  assert.ok(seen.length >= 3, "it kept trying");
  assert.ok(new Set(seen).size > 1, "and moved to another model rather than hammering one");
});

test("callGemini gives up immediately on an error that will never come good", async (t) => {
  // A bad key or a malformed request fails identically forever; retrying it
  // only delays telling the user.
  const { callGemini } = await loadWorker();
  let calls = 0;
  installFetch(t, async () => { calls++; return jsonResponse(403, {}, "API key not valid"); });

  await assert.rejects(
    callGemini({ GEMINI_API_KEY: "bad" }, "prompt", { delays: [0, 0] }),
    /HTTP 403/
  );
  assert.equal(calls, 1, "no pointless retries");
});

test("callGemini surfaces the real reason once every attempt is spent", async (t) => {
  const { callGemini } = await loadWorker();
  installFetch(t, async () => jsonResponse(503, {}, "high demand"));
  await assert.rejects(
    callGemini({ GEMINI_API_KEY: "k" }, "prompt", { delays: [0] }),
    /HTTP 503.*high demand/
  );
});

test("a failed refresh keeps the brief that already worked, rather than replacing it with an error", async (t) => {
  // This is what made Refresh the thing most likely to lose you your brief:
  // both failure paths wrote summary = NULL over a perfectly good summary.
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  d1.seedBrief(EMAIL, "2026-08-09", { summary: "Today\n- 14:00 Clinic", status: "ok", generated_at: 111 });

  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) return jsonResponse(503, {}, "high demand");
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok", "the card still shows a brief");
  assert.equal(result.summary, "Today\n- 14:00 Clinic", "the earlier one, kept");
  assert.equal(result.stale, true, "flagged, so the card can say it is the earlier one");
  assert.match(result.error, /couldn't refresh \(gemini_error\)/);

  const saved = d1.dailyBrief.get(`${EMAIL}|2026-08-09`);
  assert.equal(saved.summary, "Today\n- 14:00 Clinic", "and it is still in the database");
  assert.equal(saved.status, "ok");
});

test("with nothing to fall back on, a failure is still reported as a failure", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  installFetch(t, async (url) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) return jsonResponse(503, {}, "high demand");
    throw new Error("unexpected fetch " + u);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "gemini_error");
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).summary, null);
});

test("handleGetBrief tells the card when what it holds is the earlier brief", async (t) => {
  const { handleGetBrief } = await loadWorker();
  installFetch(t, async () => { throw new Error("handleGetBrief must never touch the network"); });
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, {});
  d1.seedBrief(EMAIL, "2026-08-09", {
    summary: "Today\n- 14:00 Clinic", status: "ok",
    error: "couldn't refresh (gemini_error): HTTP 503 high demand",
  });

  const body = await (await handleGetBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"))).json();
  assert.equal(body.status, "ok");
  assert.equal(body.stale, true);

  // A Tasks failure alongside a good summary is a different thing, and must
  // not be reported as staleness.
  d1.seedBrief(EMAIL, "2026-08-09", { summary: "x", status: "ok", error: "task lists unavailable: HTTP 403" });
  const other = await (await handleGetBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"))).json();
  assert.equal(other.stale, false);
});

test("a dated commitment in the journal reaches the prompt, with the weekday needed to resolve it", async (t) => {
  /* The real failure this pins: an entry saying "remind me from Thursday
     onwards to be conscious about calorie intake" was in D1, was in the
     prompt, and the brief still said nothing about it - because a rule meant
     to stop invented numbers ("never comment on something HISTORY does not
     measure") also suppressed every subject HISTORY has no column for.
     Nothing here can prove what the model writes, so it pins the two things
     that were actually missing: the instruction, and the weekday without
     which "from Thursday" cannot be placed against today. */
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });
  d1.seedDay(EMAIL, "2026-08-17", {
    notes: "To remind me from Thursday onwards I need to be conscious about the calories intake.",
    prayers: { fajr: true, dhuhr: true, asr: true, maghrib: true, isha: true },
  });

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [{ id: "primary", summary: "Yawar", primary: true }] });
    if (u.includes("/events")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("ok"); }
    throw new Error("unexpected fetch " + u);
  });

  // 2026-08-18 is a Tuesday; the commitment starts that Thursday.
  await generateBrief(d1.env, EMAIL, new Date("2026-08-18T08:00:00Z"));

  assert.match(prompt, /conscious about the calories intake/, "the entry is in the prompt");
  assert.match(prompt, /on Tuesday 2026-08-18/, "and today is named, not just dated");
  assert.match(prompt, /Tomorrow is Wednesday/);
  assert.match(prompt, /Honour any date they attached to it/);
  assert.match(prompt, /governs numbers only/,
    "the no-invention rule must not suppress a subject HISTORY has no column for");
});

test("the weekday is the local day's own name, not whatever UTC midnight lands on", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 600000 });

  let prompt = null;
  installFetch(t, async (url, opts) => {
    const u = String(url);
    if (u.includes("calendarList")) return jsonResponse(200, { items: [] });
    if (u.includes("tasks.googleapis.com")) return jsonResponse(200, { items: [] });
    if (u.includes("generativelanguage")) { prompt = JSON.parse(opts.body).contents[0].parts[0].text; return geminiOk("ok"); }
    throw new Error("unexpected fetch " + u);
  });

  // 23:30 London on a Sunday in BST is already Monday in UTC. The brief is
  // about the local day, so it must still say Sunday.
  await generateBrief(d1.env, EMAIL, new Date("2026-08-16T22:30:00Z"));
  assert.match(prompt, /on Sunday 2026-08-16/);
  assert.match(prompt, /Tomorrow is Monday/);
});
