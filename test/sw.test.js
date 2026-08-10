"use strict";
/*
 * Direct unit tests for sw.js's own logic. jsdom has no ServiceWorker
 * execution model at all (a service worker runs in its own global scope,
 * not a window), so this loads the real, unmodified sw.js into a small
 * vm context with just the globals a service worker actually has:
 * self, caches, fetch. Nothing about the file's own control flow is
 * stubbed — only the browser primitives it calls out to.
 *
 * This suite exists because of a real regression: the first version of
 * sw.js called fetch(event.request) for every intercepted GET, including
 * navigations. Per the Fetch spec, fetch() cannot be called with a
 * Request whose mode is "navigate" — it throws, which rejected the
 * promise handed to respondWith() and broke every page load with
 * ERR_FAILED. The fix is "never intercept navigations at all"; this file
 * pins that down so it can't silently regress.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SW_PATH = path.join(__dirname, "..", "sw.js");
const SW_SOURCE = fs.readFileSync(SW_PATH, "utf8");

function loadServiceWorker({ fetchImpl, staleCacheNames } = {}) {
  const listeners = {};
  const selfMock = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
  };

  const cacheAddAllCalls = [];
  const cachePuts = [];
  const fakeCache = {
    addAll: async (urls) => { cacheAddAllCalls.push(urls); },
    match: async () => undefined, // always a cache miss in these tests
    put: async (req, res) => { cachePuts.push({ req, res }); },
  };
  const deletedCaches = [];
  const cachesMock = {
    open: async () => fakeCache,
    keys: async () => staleCacheNames || ["yr-wellness-shell-v1"],
    delete: async (name) => { deletedCaches.push(name); return true; },
    match: async () => undefined, // top-level CacheStorage.match() — always a miss in these tests
  };

  const fetchCalls = [];
  const defaultFetchImpl = async () => ({ status: 200, type: "basic", clone: () => ({}) });
  const fetchMock = async (req) => {
    fetchCalls.push(req);
    return (fetchImpl || defaultFetchImpl)(req);
  };

  const sandbox = { self: selfMock, caches: cachesMock, fetch: fetchMock, URL, console };
  vm.createContext(sandbox);
  vm.runInContext(SW_SOURCE, sandbox, { filename: "sw.js" });

  return {
    dispatch(type, event) { (listeners[type] || []).forEach((fn) => fn(event)); },
    cacheAddAllCalls, cachePuts, fetchCalls, deletedCaches,
  };
}

function makeFetchEvent(request) {
  const ev = { request, responded: false, response: null };
  ev.respondWith = (p) => { ev.responded = true; ev.response = p; };
  return ev;
}

test("install pre-caches only static sub-resources, never the navigable HTML shell", async () => {
  const sw = loadServiceWorker();
  let waited;
  sw.dispatch("install", { waitUntil: (p) => { waited = p; } });
  await waited;

  assert.equal(sw.cacheAddAllCalls.length, 1);
  const urls = sw.cacheAddAllCalls[0];
  assert.ok(!urls.includes("./"), "must not pre-cache the navigable root");
  assert.ok(!urls.includes("./index.html"), "must not pre-cache the navigable start_url");
  assert.ok(urls.includes("./manifest.webmanifest"));
  assert.ok(urls.includes("./icons/icon-192.png"));
});

test("activate cleans up caches from older versions of the worker", async () => {
  // Read the live cache name rather than pinning one, so bumping the shell
  // version in sw.js doesn't fail a test about deleting *other* versions.
  const current = require("fs")
    .readFileSync(require("path").join(__dirname, "..", "sw.js"), "utf8")
    .match(/CACHE_NAME\s*=\s*"([^"]+)"/)[1];
  const sw = loadServiceWorker({ staleCacheNames: ["yr-wellness-shell-v0", current] });
  let waited;
  sw.dispatch("activate", { waitUntil: (p) => { waited = p; } });
  await waited;
  assert.deepEqual(sw.deletedCaches.sort(), ["yr-wellness-shell-v0"], "only the stale one goes");
});

test("navigation requests are never intercepted — fetch() is never called with them", () => {
  const sw = loadServiceWorker();
  const req = { method: "GET", mode: "navigate", url: "https://yr-wellness.yawar-awan.workers.dev/index.html" };
  const ev = makeFetchEvent(req);

  sw.dispatch("fetch", ev);

  assert.equal(ev.responded, false, "a navigation must fall through to default browser handling");
  assert.equal(sw.fetchCalls.length, 0, "fetch() must never be called with a navigate-mode request — the spec forbids it and it throws");
});

test("/api/* requests are never intercepted, regardless of method or mode", () => {
  const sw = loadServiceWorker();
  const ev = makeFetchEvent({ method: "GET", mode: "same-origin", url: "https://yr-wellness.yawar-awan.workers.dev/api/sync" });
  sw.dispatch("fetch", ev);
  assert.equal(ev.responded, false);
});

test("non-GET requests (writes) are never intercepted", () => {
  const sw = loadServiceWorker();
  const ev = makeFetchEvent({ method: "POST", mode: "same-origin", url: "https://yr-wellness.yawar-awan.workers.dev/api/sync" });
  sw.dispatch("fetch", ev);
  assert.equal(ev.responded, false);
});

test("static sub-resources are served through the cache/network path and get cached on success", async () => {
  const sw = loadServiceWorker();
  const req = { method: "GET", mode: "no-cors", url: "https://yr-wellness.yawar-awan.workers.dev/icons/icon-192.png" };
  const ev = makeFetchEvent(req);

  sw.dispatch("fetch", ev);
  assert.equal(ev.responded, true);

  const res = await ev.response;
  assert.equal(res.status, 200);
  assert.equal(sw.fetchCalls.length, 1, "a real static asset request should go through fetch()");
  await new Promise((r) => setTimeout(r, 0)); // let the background cache.put settle
  assert.equal(sw.cachePuts.length, 1);
});
