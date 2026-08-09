"use strict";
/*
 * "Install as an app" coverage: the Progress tab card, beforeinstallprompt
 * capture, the iOS text fallback, and the service worker registration
 * guard. Same rule as everywhere else in this suite: execute the real
 * index.html in a real DOM, nothing about the app's own logic injected.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { loadApp } = require("./lib.js");

const IOS_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15";

test("install card is hidden entirely when already running standalone", () => {
  const app = loadApp({ standalone: true });
  app.goTo("progress");
  assert.equal(app.installCardVisible(), false);
});

test("default desktop browser with no install prompt available: generic bookmark guidance, no button", () => {
  const app = loadApp({});
  app.goTo("progress");
  assert.equal(app.installCardVisible(), true);
  assert.equal(app.installButtonVisible(), false);
  assert.match(app.installText(), /bookmark|install app/i);
});

test("iOS Safari: shows Share -> Add to Home Screen guidance, no button (no beforeinstallprompt exists on iOS)", () => {
  const app = loadApp({ userAgent: IOS_UA });
  app.goTo("progress");
  assert.equal(app.installCardVisible(), true);
  assert.equal(app.installButtonVisible(), false);
  assert.match(app.installText(), /share/i);
  assert.match(app.installText(), /add to home screen/i);
});

test("beforeinstallprompt: shows a real install button; clicking it calls prompt() on the captured event", async () => {
  const app = loadApp({});
  const ev = app.fireBeforeInstallPrompt();
  app.goTo("progress");
  assert.equal(app.installButtonVisible(), true);

  app.click("installBtn");
  assert.equal(ev.promptCalled, true, "clicking the custom button must call prompt() on the deferred event");

  await app.flush();
  assert.equal(app.installButtonVisible(), false, "the button should not offer to prompt() the same event twice");
});

test("appinstalled: clears the deferred prompt so the button disappears again", () => {
  const app = loadApp({});
  app.fireBeforeInstallPrompt();
  app.goTo("progress");
  assert.equal(app.installButtonVisible(), true);

  app.fireAppInstalled();
  app.goTo("progress");
  assert.equal(app.installButtonVisible(), false);
});

test("service worker registration is attempted, and only ever at the root-relative sw.js", async () => {
  const app = loadApp({ stubServiceWorker: true });
  await app.flush(); // registration is deferred to the window "load" event
  assert.deepEqual(app.serviceWorkerCalls, ["sw.js"]);
});
