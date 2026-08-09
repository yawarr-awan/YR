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

test("generateBrief: a calendar fetch failure is recorded against today, not silently dropped", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async (url) => {
    assert.match(String(url), /calendar\/v3/);
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
    if (String(url).includes("calendar/v3")) return jsonResponse(200, { items: [] });
    if (String(url).includes("generativelanguage")) return jsonResponse(503, {}, "overloaded");
    throw new Error("unexpected fetch " + url);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "gemini_error");
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).status, "gemini_error");
});

test("generateBrief: end to end success persists the Gemini summary for today", async (t) => {
  const { generateBrief } = await loadWorker();
  const d1 = createFakeD1();
  d1.seedToken(EMAIL, { access_token: "tok", access_token_expires_at: Date.now() + 10 * 60 * 1000 });
  installFetch(t, async (url) => {
    if (String(url).includes("calendar/v3")) {
      return jsonResponse(200, { items: [{ summary: "Standup", start: { dateTime: "2026-08-09T09:00:00+01:00" } }] });
    }
    if (String(url).includes("generativelanguage")) return geminiOk("A light day with just a morning standup.");
    throw new Error("unexpected fetch " + url);
  });

  const result = await generateBrief(d1.env, EMAIL, new Date("2026-08-09T10:00:00Z"));
  assert.equal(result.status, "ok");
  assert.equal(result.summary, "A light day with just a morning standup.");
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).summary, "A light day with just a morning standup.");
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
  let calendarCalls = 0;
  installFetch(t, async (url) => {
    if (String(url).includes("calendar/v3")) { calendarCalls++; return jsonResponse(200, { items: [] }); }
    if (String(url).includes("generativelanguage")) return geminiOk("Nothing scheduled today.");
    throw new Error("unexpected fetch " + url);
  });

  const sevenAmBst = new Date("2026-08-09T06:30:00Z"); // 7:30am BST
  await handleScheduled(d1.env, sevenAmBst);
  assert.equal(calendarCalls, 1);
  assert.equal(d1.dailyBrief.get(`${EMAIL}|2026-08-09`).status, "ok");

  // Firing again in the same 7am hour must not regenerate an already-ok brief.
  await handleScheduled(d1.env, sevenAmBst);
  assert.equal(calendarCalls, 1, "already-generated-today briefs must not be recomputed");
});
