/**
 * YR Wellness Tracker - Service Worker
 *
 * Exists so the app satisfies install criteria and keeps working offline
 * once installed. Deliberately narrow scope: it only ever caches the
 * static app shell (index.html, manifest, icons). It never touches
 * /api/* — those requests must always hit the network untouched, so
 * Cloudflare Access auth and the sync logic behave exactly as if this
 * file didn't exist. Caching a stale sync response, or a stale
 * auth-required page, would be worse than no offline support at all.
 */
var CACHE_NAME = "yr-wellness-shell-v1";
var SHELL_ASSETS = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./favicon.ico",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/apple-touch-icon.png",
];

self.addEventListener("install", function (event) {
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
    })
  );
});

self.addEventListener("fetch", function (event) {
  var req = event.request;
  if (req.method !== "GET") return;                 // never intercept writes
  var url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return;      // never cache the API

  event.respondWith(
    caches.match(req).then(function (cached) {
      var network = fetch(req).then(function (res) {
        if (res && res.status === 200 && res.type === "basic") {
          var copy = res.clone();
          caches.open(CACHE_NAME).then(function (cache) { cache.put(req, copy); });
        }
        return res;
      }).catch(function () { return cached; });
      return cached || network;
    })
  );
});
