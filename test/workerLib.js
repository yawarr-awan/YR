"use strict";
/*
 * Loads the REAL worker.js (unmodified) for direct unit testing of its
 * Google Calendar / Gemini brief logic. worker.js is an ES module
 * (export default + named exports) but the project has no
 * "type": "module" in package.json - deliberately, since every other test
 * file here is CommonJS and there's no reason to disrupt that. A `data:`
 * URL import sidesteps the mismatch: Node always parses a data: URL as
 * ESM regardless of file extension or package.json, so this loads the
 * exact same source Cloudflare deploys, with nothing rewritten.
 */
const fs = require("fs");
const path = require("path");

const WORKER_PATH = path.join(__dirname, "..", "worker.js");

async function loadWorker() {
  const source = fs.readFileSync(WORKER_PATH, "utf8");
  const url = "data:text/javascript;base64," + Buffer.from(source).toString("base64");
  return import(url);
}

module.exports = { loadWorker };
