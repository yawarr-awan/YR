"use strict";
/*
 * A tiny in-memory stand-in for worker.js's /api/sync semantics, used to
 * test the CLIENT's sync engine (this repo) against realistic server
 * behaviour without a live Worker/D1 instance. worker.js has its own
 * tests against the live D1 instance per CLAUDE.md; this mirrors just the
 * upsert-if-newer + since-bounded-pull contract described there and in
 * worker.js's handleSync, so client-side merge logic is exercised
 * end-to-end (push, pull, true last-write-wins).
 */
function createMockServer() {
  const days = {}; // day -> {data, updated_at}
  let profile = null; // {data, updated_at}

  return {
    _days: days,
    get _profile() { return profile; },
    seedDay(day, data, updated_at) { days[day] = { data, updated_at }; },
    seedProfile(data, updated_at) { profile = { data, updated_at }; },
    handle(body) {
      const since = Number.isFinite(body.since) ? body.since : 0;
      const incoming = (body.days && typeof body.days === "object") ? body.days : {};
      let applied = 0;
      const skipped = [];

      Object.keys(incoming).forEach((day) => {
        const rec = incoming[day];
        const ts = Number(rec && rec.updated_at);
        if (!rec || typeof rec.data !== "string" || !Number.isFinite(ts) || ts <= 0) {
          skipped.push(day);
          return;
        }
        const existing = days[day];
        if (!existing || ts > existing.updated_at) {
          days[day] = { data: rec.data, updated_at: ts };
        }
        applied++;
      });

      if (body.profile && typeof body.profile.data === "string") {
        const ts = Number(body.profile.updated_at);
        if (Number.isFinite(ts) && ts > 0 && (!profile || ts > profile.updated_at)) {
          profile = { data: body.profile.data, updated_at: ts };
        }
      }

      const allMatching = Object.keys(days)
        .filter((d) => days[d].updated_at > since)
        .sort((a, b) => days[a].updated_at - days[b].updated_at);
      const limited = allMatching.slice(0, 1000);
      const outDays = {};
      limited.forEach((d) => { outDays[d] = days[d]; });

      const outProfile = (profile && profile.updated_at > since) ? profile : null;

      return {
        now: Date.now(),
        days: outDays,
        profile: outProfile,
        applied,
        skipped,
        more: allMatching.length > limited.length,
      };
    },
  };
}

function fetchImplFor(server, { failWith } = {}) {
  return async (url, options) => {
    if (failWith) throw failWith;
    // The page also fetches /api/brief unconditionally, unrelated to sync -
    // give it a harmless "not connected" response rather than letting a
    // sync-shaped mock choke on a bodyless GET.
    if (!String(url).includes("/api/sync")) {
      return { ok: true, status: 200, json: async () => ({ connected: false, status: "not_connected" }) };
    }
    const body = JSON.parse(options.body);
    const result = server.handle(body);
    return {
      ok: true,
      status: 200,
      json: async () => result,
    };
  };
}

module.exports = { createMockServer, fetchImplFor };
