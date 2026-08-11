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

function loadServiceWorker({ fetchImpl, staleCacheNames, cached } = {}) {
  const listeners = {};
  const calls = { skipWaiting: 0, claim: 0 };
  const selfMock = {
    addEventListener(type, fn) { (listeners[type] = listeners[type] || []).push(fn); },
    skipWaiting() { calls.skipWaiting++; },
    clients: { claim: async () => { calls.claim++; } },
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
    // Top-level CacheStorage.match() — a miss unless a test seeds one.
    match: async () => cached,
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
    cacheAddAllCalls, cachePuts, fetchCalls, deletedCaches, calls,
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

/* The three below are the fix for a real failure: renaming the app to "YR"
   and replacing its icon changed nothing on an installed Android copy, even
   after uninstalling and reinstalling it. */

test("install calls skipWaiting, so a new worker never waits for the old one to be released", async () => {
  const sw = loadServiceWorker();
  let waited;
  sw.dispatch("install", { waitUntil: (p) => { waited = p; } });
  await waited;
  assert.equal(sw.calls.skipWaiting, 1);
});

test("activate claims the open clients, so the new worker controls them immediately", async () => {
  const sw = loadServiceWorker();
  let waited;
  sw.dispatch("activate", { waitUntil: (p) => { waited = p; } });
  await waited;
  assert.equal(sw.calls.claim, 1);
});

test("the shell is network-first: a renamed manifest or new icon is never served stale", async () => {
  const stale = { status: 200, type: "basic", body: "old", clone: () => ({}) };
  const fresh = { status: 200, type: "basic", body: "new", clone: () => ({}) };
  const sw = loadServiceWorker({ cached: stale, fetchImpl: async () => fresh });
  const ev = makeFetchEvent({ method: "GET", mode: "no-cors", url: "https://yr-wellness.yawar-awan.workers.dev/manifest.webmanifest" });

  sw.dispatch("fetch", ev);
  const res = await ev.response;
  assert.equal(res.body, "new", "the cached copy must not win while the network is reachable");
});

test("offline, the cached copy is still served", async () => {
  const stale = { status: 200, type: "basic", body: "old", clone: () => ({}) };
  const sw = loadServiceWorker({ cached: stale, fetchImpl: async () => { throw new Error("offline"); } });
  const ev = makeFetchEvent({ method: "GET", mode: "no-cors", url: "https://yr-wellness.yawar-awan.workers.dev/icons/icon-192.png" });

  sw.dispatch("fetch", ev);
  const res = await ev.response;
  assert.equal(res.body, "old", "the cache is what makes the app work offline");
});

test("the installed app is not locked to portrait", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "manifest.webmanifest"), "utf8"));
  // "portrait" stops an installed copy rotating at all. Stated explicitly
  // rather than left out: an installed Android copy is a WebAPK whose
  // orientation was baked in at install time, and Chrome only rebuilds it
  // when it notices the manifest differ - so the value should be unmissable.
  assert.equal(manifest.orientation, "any");
});

/* Every asset the worker precaches has to actually be in the repo: addAll()
 * rejects the whole install if a single entry 404s, which would leave the app
 * with no offline shell at all. The manifest gets the same check, since a
 * missing icon there is what an install reads. */
test("every precached asset and every manifest icon exists on disk", () => {
  const root = path.join(__dirname, "..");
  const listed = SW_SOURCE.match(/var SHELL_ASSETS = \[([\s\S]*?)\]/)[1]
    .match(/"([^"]+)"/g).map((s) => s.slice(1, -1).replace(/^\.\//, ""));
  assert.ok(listed.length >= 8, "expected the shell list to still be populated");
  listed.forEach((rel) => {
    assert.ok(fs.existsSync(path.join(root, rel)), rel + " is precached but missing");
  });

  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.webmanifest"), "utf8"));
  manifest.icons.forEach((icon) => {
    assert.ok(fs.existsSync(path.join(root, icon.src)), icon.src + " is in the manifest but missing");
    assert.ok(listed.includes(icon.src), icon.src + " should be precached too");
  });
  const anySizes = manifest.icons.filter((i) => i.purpose === "any").map((i) => i.sizes);
  assert.ok(anySizes.includes("1024x1024"),
    "keep a 1024 icon: the Android splash scales the largest 'any' icon up, and 512 was being blurred");
});
