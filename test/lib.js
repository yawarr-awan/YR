"use strict";
/*
 * Test harness: loads the REAL index.html into a jsdom window and executes
 * its actual inline <script> unmodified — nothing about the app's own
 * logic is stubbed, injected, or patched. All interaction happens the way
 * a real user or browser would trigger it: clicking buttons, dispatching
 * change/input events, reading localStorage and the rendered DOM. The
 * whole app runs inside a single top-level IIFE, so there is no
 * `window.state` to reach into even if we wanted to — which keeps tests
 * honest black-box checks of behaviour, not internals.
 *
 * Several things are supplied that a real browser has but jsdom does not
 * ship out of the box, and all of them are environment gaps, not app bugs:
 *   - Canvas 2D context (jsdom needs the native "canvas" package for this,
 *     which isn't installed here). We stub just enough of the drawing API
 *     as no-ops so drawChart() can run without crashing; we never assert
 *     on canvas output.
 *   - window.fetch (jsdom's window has no fetch at all, even though Node
 *     itself does). For sync tests we install a controllable fetch mock —
 *     this is deliberately mocking the network boundary, exactly as one
 *     would mock a real backend in any test.
 *   - navigator.serviceWorker and the beforeinstallprompt/appinstalled
 *     events (jsdom implements neither at all). For install tests we stub
 *     navigator.serviceWorker.register so it's observable, and dispatch
 *     synthetic events shaped like the real browser ones.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const MAIN_KEY = "yawarWellness_v1";
const BAK_KEY = "yawarWellness_v1_bak";

// The app runs a real setInterval() for foreground reminders (prayer/task/
// dhikr checks) - exactly as it should in a browser tab, which cleans up
// its timers when the tab closes. jsdom's window.close() does the same,
// but nothing calls it by default, so every loadApp() would otherwise
// leave a live interval behind - harmless individually, but it piles up
// across a whole test run and stops the process from exiting on its own.
// Each test file should register `after(closeAllApps)` once (from
// node:test) so this happens automatically.
const openWindows = [];
function closeAllApps() {
  while (openWindows.length) {
    const w = openWindows.pop();
    try { w.close(); } catch (e) { /* already closed */ }
  }
}

function stubCanvas(window) {
  const noop = function () {};
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      stroke: noop, fillText: noop, fillRect: noop, arc: noop, fill: noop,
      setLineDash: noop, drawImage: noop,
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    };
  };
  // jsdom decodes no images, so toDataURL has nothing real to give back.
  // A recognisable stub is enough: the tests care that a data: URL of the
  // right type is what gets sent, not what the pixels are.
  window.HTMLCanvasElement.prototype.toDataURL = function (type) {
    return "data:" + (type || "image/png") + ";base64,c3R1Yg==";
  };
  // Likewise <img>: jsdom never fires load for a data: URL, so anything
  // waiting on onload would hang forever.
  class StubImage {
    constructor() { this.naturalWidth = 2400; this.naturalHeight = 1800; }
    set src(v) { this._src = v; if (this.onload) setTimeout(() => this.onload(), 0); }
    get src() { return this._src; }
  }
  window.Image = StubImage;
}

function fireClick(window, el) {
  el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
}
function fireEvent(window, el, type) {
  el.dispatchEvent(new window.Event(type, { bubbles: true }));
}

/**
 * @param {object} opts
 * @param {object} [opts.localStorageSeed] - raw string values to pre-seed,
 *   keyed by localStorage key (e.g. {[MAIN_KEY]: "..."})
 * @param {boolean} [opts.blockStorage] - simulate quota-exceeded / private
 *   mode by making localStorage.setItem throw
 * @param {function} [opts.fetchImpl] - (url, options) => Promise<Response-like>
 * @param {string} [opts.userAgent] - override navigator.userAgent (e.g. to simulate iOS)
 * @param {boolean} [opts.standalone] - simulate navigator.standalone (already installed, iOS)
 * @param {boolean} [opts.stubServiceWorker] - install a fake navigator.serviceWorker.register
 * @param {boolean} [opts.serviceWorkerNotifications] - also stub
 *   navigator.serviceWorker.ready with a recording showNotification, which is
 *   the path Android requires and the app therefore prefers
 * @param {object} [opts.geolocation] - {lat, lon} to succeed with, or {error: "message"} to fail
 * @param {string} [opts.notificationPermission] - "granted" | "denied" | "default"; installs window.Notification
 * @param {function} [opts.beforeRun] - (window) => void, called after the
 *   environment is seeded but before the app's own script runs. For browser
 *   capabilities jsdom doesn't implement at all, like screen.orientation.
 * @param {number} [opts.innerWidth] - viewport width the app should read.
 *   jsdom defaults to 1024, which is a *desktop* to this app - the calendar
 *   lays out a whole week there. Tests about the phone layout must say so.
 */
function loadApp(opts = {}) {
  const html = fs.readFileSync(HTML_PATH, "utf8");

  const virtualConsole = new VirtualConsole();
  // Deliberately silent: jsdom's "not implemented" noise (canvas, confirm,
  // matchMedia) is an expected environment gap here, not a test signal.

  const dom = new JSDOM(html, {
    url: "https://yr-wellness.yawar-awan.workers.dev/",
    runScripts: "outside-only",
    virtualConsole,
    // jsdom 30 moved userAgent under `resources`; passing it top-level is
    // silently ignored. `resources` must stay undefined otherwise (an
    // object here also flips on subresource fetching), so only set it
    // when a custom UA is actually requested.
    ...(opts.userAgent ? { resources: { userAgent: opts.userAgent } } : {}),
  });
  const window = dom.window;
  openWindows.push(window);
  stubCanvas(window);
  // jsdom's innerWidth is a plain getter, so it has to be redefined rather
  // than assigned. Default to a phone: most of this suite is about the phone.
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    value: opts.innerWidth || 390,
  });

  if (opts.localStorageSeed) {
    Object.keys(opts.localStorageSeed).forEach((k) => {
      window.localStorage.setItem(k, opts.localStorageSeed[k]);
    });
  }

  if (opts.blockStorage) {
    window.Storage.prototype.setItem = function () {
      throw new Error("QuotaExceededError: storage is full or blocked");
    };
  }

  if (opts.fetchImpl) window.fetch = opts.fetchImpl;
  if (opts.standalone) window.navigator.standalone = true;

  // jsdom implements neither the Geolocation nor Notification APIs at all -
  // both are real browser capabilities the app depends on, stubbed the
  // same way fetch/canvas/serviceWorker are above.
  if (opts.geolocation) {
    window.navigator.geolocation = {
      getCurrentPosition: (success, error) => {
        if (opts.geolocation.error) error({ message: opts.geolocation.error });
        else success({ coords: { latitude: opts.geolocation.lat, longitude: opts.geolocation.lon } });
      },
    };
  }
  const notifications = [];
  if (opts.notificationPermission) {
    function NotificationStub(title, options) { notifications.push({ title, ...options }); }
    NotificationStub.permission = opts.notificationPermission;
    NotificationStub.requestPermission = () => {
      NotificationStub.permission = "granted";
      return Promise.resolve("granted");
    };
    window.Notification = NotificationStub;
  }

  const serviceWorkerCalls = [];
  const swNotifications = [];
  if (opts.stubServiceWorker || opts.serviceWorkerNotifications) {
    window.navigator.serviceWorker = {
      register: function (url) { serviceWorkerCalls.push(url); return Promise.resolve({}); },
    };
    // Chrome on Android refuses `new Notification()` and requires the
    // registration's showNotification instead, so the app prefers it when a
    // registration is available. jsdom has no service worker at all, so the
    // registration - and its ready promise - are stubbed here to make that
    // path observable.
    if (opts.serviceWorkerNotifications) {
      window.navigator.serviceWorker.ready = Promise.resolve({
        showNotification: function (title, options) {
          swNotifications.push({ title, ...options });
          return Promise.resolve();
        },
      });
    }
  }

  if (opts.beforeRun) opts.beforeRun(window);

  // runScripts:"outside-only" means the page's own <script> tag did not
  // auto-execute during parsing; we run its exact, unmodified source now
  // that localStorage/fetch are seeded, same code a browser would run.
  const scriptEl = window.document.querySelector("script");
  window.eval(scriptEl.textContent);

  const rawMain = () => { try { return window.localStorage.getItem(MAIN_KEY); } catch (e) { return undefined; } };
  const rawBackup = () => { try { return window.localStorage.getItem(BAK_KEY); } catch (e) { return undefined; } };

  return {
    window,
    document: window.document,
    rawMain,
    rawBackup,
    state: () => { const raw = rawMain(); return raw ? JSON.parse(raw) : null; },
    statusText: () => { const el = window.document.getElementById("statusBar"); return el ? el.textContent : ""; },
    statusKind: () => { const el = window.document.getElementById("statusBar"); return el ? el.className : ""; },
    syncStatusText: () => { const el = window.document.getElementById("syncStatus"); return el ? el.textContent : ""; },
    goTo: (view) => fireClick(window, window.document.querySelector(`[data-nav="${view}"]`)),
    click: (id) => fireClick(window, window.document.getElementById(id)),
    check: (id, val) => { const el = window.document.getElementById(id); el.checked = val; fireEvent(window, el, "change"); },
    setInput: (id, val) => { const el = window.document.getElementById(id); el.value = val; fireEvent(window, el, "input"); },
    pickDate: (dateStr) => { const el = window.document.getElementById("datePick"); el.value = dateStr; fireEvent(window, el, "change"); },
    flush: () => new Promise((resolve) => setTimeout(resolve, 0)),
    serviceWorkerCalls,
    notifications,
    swNotifications,
    installCardVisible: () => window.document.getElementById("installCard").style.display !== "none",
    installButtonVisible: () => window.document.getElementById("installBtn").style.display !== "none",
    installText: () => window.document.getElementById("installText").textContent,
    // Mirrors the shape of a real BeforeInstallPromptEvent: cancelable, plus
    // a prompt() method and a userChoice promise, neither of which jsdom
    // implements since it has no concept of this event at all.
    fireBeforeInstallPrompt: () => {
      const ev = new window.Event("beforeinstallprompt", { cancelable: true });
      ev.promptCalled = false;
      ev.prompt = function () { ev.promptCalled = true; };
      ev.userChoice = Promise.resolve({ outcome: "accepted" });
      window.dispatchEvent(ev);
      return ev;
    },
    fireAppInstalled: () => window.dispatchEvent(new window.Event("appinstalled")),
    // jsdom has no TouchEvent constructor at all - the app only ever reads
    // e.touches[0]/e.changedTouches[0], so a plain Event with those arrays
    // attached is indistinguishable to it from a real touch gesture.
    swipe: (idOrEl, dx, dy) => {
      const targetEl = typeof idOrEl === "string"
        ? (window.document.getElementById(idOrEl) || window.document.querySelector(idOrEl))
        : idOrEl;
      const startX = 200, startY = 200;
      const start = new window.Event("touchstart", { bubbles: true });
      start.touches = [{ clientX: startX, clientY: startY }];
      targetEl.dispatchEvent(start);
      const move = new window.Event("touchmove", { bubbles: true });
      move.touches = [{ clientX: startX + (dx || 0), clientY: startY + (dy || 0) }];
      targetEl.dispatchEvent(move);
      const end = new window.Event("touchend", { bubbles: true });
      end.changedTouches = [{ clientX: startX + (dx || 0), clientY: startY + (dy || 0) }];
      targetEl.dispatchEvent(end);
    },
    // The calendar's day paging is a real two-phase slide animation, so tests
    // that page a day have to wait it out rather than a single microtask.
    wait: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
    close: () => window.close(),
  };
}

module.exports = { loadApp, closeAllApps, MAIN_KEY, BAK_KEY };
