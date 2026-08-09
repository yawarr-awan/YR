"use strict";
/*
 * "Today's Brief" card coverage: the Today-tab UI that talks to
 * /api/brief and /api/brief/refresh. Same rule as the rest of this
 * suite - the real index.html, executed in a real DOM, nothing injected.
 * The network boundary (fetch) is mocked, same as the sync tests.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function briefResponse(overrides) {
  return { connected: false, day: "2026-08-09", summary: null, status: "not_connected", error: null, generated_at: null, ...overrides };
}

function fetchRouter(routes) {
  return async (url, options) => {
    const u = String(url);
    for (const [pattern, handler] of routes) {
      if (u.includes(pattern)) return handler(u, options);
    }
    throw new Error("unexpected fetch " + u);
  };
}

function jsonRes(body) {
  return { ok: true, status: 200, json: async () => body };
}

test("not connected: shows a Connect Google Calendar link pointing at the OAuth start endpoint", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/brief", () => jsonRes(briefResponse())]]),
  });
  await app.flush();

  assert.match(app.document.getElementById("briefText").textContent, /connect your google calendar/i);
  const link = app.document.querySelector("#briefActions a");
  assert.ok(link, "expected a Connect Google Calendar link");
  assert.equal(link.getAttribute("href"), "/api/google/connect");
});

test("connected but no brief yet: shows a Generate now button", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/brief", () => jsonRes(briefResponse({ connected: true, status: "pending" }))]]),
  });
  await app.flush();

  assert.match(app.document.getElementById("briefText").textContent, /7am london time/i);
  const btn = app.document.querySelector("#briefActions button");
  assert.match(btn.textContent, /generate now/i);
});

test("connected with a ready brief: shows the summary text and a Refresh button", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/brief", () => jsonRes(briefResponse({
      connected: true, status: "ok", summary: "A quiet day with one call at 2pm.", generated_at: 1700000000000,
    }))]]),
  });
  await app.flush();

  assert.equal(app.document.getElementById("briefText").textContent, "A quiet day with one call at 2pm.");
  const btn = app.document.querySelector("#briefActions button");
  assert.match(btn.textContent, /refresh/i);
  assert.match(app.document.getElementById("briefMeta").textContent, /generated/i);
});

test("expired Google connection: shows a Reconnect link, not a generic error", async () => {
  const app = loadApp({
    fetchImpl: fetchRouter([["/api/brief", () => jsonRes(briefResponse({ connected: true, status: "reconnect_required" }))]]),
  });
  await app.flush();

  assert.match(app.document.getElementById("briefText").textContent, /expired/i);
  const link = app.document.querySelector("#briefActions a");
  assert.equal(link.getAttribute("href"), "/api/google/connect");
});

test("network failure loading /api/brief degrades gracefully, no crash", async () => {
  const app = loadApp({
    fetchImpl: async () => { throw new TypeError("Failed to fetch"); },
  });
  await app.flush();

  assert.match(app.document.getElementById("briefText").textContent, /couldn't load/i);
  // The rest of the Today tab must still be intact.
  assert.match(app.document.getElementById("dateLabel").textContent, /\w/);
});

test("clicking Refresh calls POST /api/brief/refresh and re-renders with the new result", async () => {
  let refreshCalled = false;
  const app = loadApp({
    fetchImpl: fetchRouter([
      ["/api/brief/refresh", (u, opts) => { refreshCalled = true; assert.equal(opts.method, "POST");
        return jsonRes(briefResponse({ connected: true, status: "ok", summary: "Freshly generated.", generated_at: 1700000000000 })); }],
      ["/api/brief", () => jsonRes(briefResponse({ connected: true, status: "ok", summary: "Old summary.", generated_at: 1699999999000 }))],
    ]),
  });
  await app.flush();
  assert.equal(app.document.getElementById("briefText").textContent, "Old summary.");

  const btn = app.document.querySelector("#briefActions button");
  btn.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  await app.flush();

  assert.equal(refreshCalled, true);
  assert.equal(app.document.getElementById("briefText").textContent, "Freshly generated.");
});
