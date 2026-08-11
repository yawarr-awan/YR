/**
 * YR - Service Worker
 *
 * Exists so the app satisfies install criteria and keeps working offline
 * once installed. Deliberately narrow scope: it only ever caches static
 * sub-resources (manifest, icons, favicon). It never intercepts:
 *   - /api/* — those requests must always hit the network untouched, so
 *     Cloudflare Access auth and the sync logic behave exactly as if this
 *     file didn't exist.
 *   - navigations (mode: "navigate") — every page load, including the
 *     app's own start_url. Two reasons, either one alone is enough:
 *     (1) fetch() cannot be called with a Request whose mode is
 *     "navigate" — it throws, which is exactly the bug this file used to
 *     have: it broke the app shell with ERR_FAILED, since the thrown
 *     exception rejected the promise fed to respondWith(). (2) Cloudflare
 *     Access protects the whole origin, not just /api/*, so a navigation
 *     can be redirected to Access's login page at any time; that redirect
 *     must run as a normal top-level browser navigation, not a fetch()
 *     mediated by this worker.
 *
 * Two rules here exist because of a real, user-visible failure: renaming the
 * app to "YR" and replacing its icon changed nothing on an installed Android
 * copy, even after uninstalling and reinstalling it.
 *
 *   1. skipWaiting + clients.claim. Without them a new worker sits in
 *      "waiting" until every client of the old one is gone. Uninstalling a
 *      PWA does not unregister its service worker or clear Cache Storage, so
 *      the old worker kept control and kept answering from the old cache.
 *   2. Network-first for the shell. These files are a few KB and the cache
 *      is here for offline, not for speed - serving them cache-first meant
 *      the manifest's name and the icons were whatever was cached when the
 *      worker last changed. Network-first makes an identity change land on
 *      the next load even if this file is untouched.
 */
var CACHE_NAME = "yr-shell-v23";
var SHELL_ASSETS = [
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-1024.png",
  "./icons/apple-touch-icon.png",
  "./icons/icon-maskable-512.png",
  "./icons/icon-maskable-1024.png",
  "./icons/favicon-32.png",
];

self.addEventListener("install", function (event) {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(function (cache) {
      return cache.addAll(SHELL_ASSETS);
    })
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(
        names.filter(function (n) { return n !== CACHE_NAME; })
             .map(function (n) { return caches.delete(n); })
      );
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;                 // never intercept writes
  if (req.mode === "navigate") return;               // never intercept page loads
  var url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;      // never cache the API

  event.respondWith(
    fetch(req).then(function (res) {
      if (res && res.status === 200 && res.type === "basic") {
        var copy = res.clone();
        caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
      }
      return res;
    }).catch(function () {
      // Offline: whatever we last saw is better than nothing.
      return caches.match(req);
    })
  );
});
