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
 * Two things are supplied that a real browser has but jsdom does not ship
 * out of the box, and both are environment gaps, not app bugs:
 *   - Canvas 2D context (jsdom needs the native "canvas" package for this,
 *     which isn't installed here). We stub just enough of the drawing API
 *     as no-ops so drawChart() can run without crashing; we never assert
 *     on canvas output.
 *   - window.fetch (jsdom's window has no fetch at all, even though Node
 *     itself does). For sync tests we install a controllable fetch mock —
 *     this is deliberately mocking the network boundary, exactly as one
 *     would mock a real backend in any test.
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const HTML_PATH = path.join(__dirname, "..", "index.html");
const MAIN_KEY = "yawarWellness_v1";
const BAK_KEY = "yawarWellness_v1_bak";

function stubCanvas(window) {
  const noop = function () {};
  window.HTMLCanvasElement.prototype.getContext = function () {
    return {
      clearRect: noop, beginPath: noop, moveTo: noop, lineTo: noop,
      stroke: noop, fillText: noop, fillRect: noop, arc: noop, fill: noop,
      setLineDash: noop,
      fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textAlign: "",
    };
  };
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
  });
  const window = dom.window;
  stubCanvas(window);

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
  };
}

module.exports = { loadApp, MAIN_KEY, BAK_KEY };
