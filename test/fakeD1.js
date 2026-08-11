"use strict";
/*
 * A tiny in-memory stand-in for the D1 binding, scoped to exactly the
 * queries worker.js's Google Calendar / Gemini brief code issues against
 * google_tokens and daily_brief. Not a general SQL engine - it pattern
 * matches on the SQL text the same way test/mockServer.js's fake server
 * mirrors worker.js's sync semantics, so the real query shapes are
 * exercised without needing an actual SQLite instance in the test run.
 */
function createFakeD1() {
  const googleTokens = new Map(); // user_email -> row
  const dailyBrief = new Map(); // `${email}|${day}` -> row
  const duas = new Map(); // `${email}|${id}` -> row

  // Real D1 statements support .first()/.all()/.run() directly on the
  // prepared statement (no bind() needed when there are nothing to bind),
  // as well as after .bind(...). Both shapes must work identically.
  function statement(sql, args) {
    return {
      bind(...boundArgs) { return statement(sql, boundArgs); },
      async first() {
        if (/SELECT 1 AS present FROM google_tokens/.test(sql)) {
          return googleTokens.has(args[0]) ? { present: 1 } : null;
        }
        if (/FROM google_tokens/.test(sql)) {
          return googleTokens.get(args[0]) || null;
        }
        if (/FROM daily_brief/.test(sql)) {
          const [email, day] = args;
          return dailyBrief.get(`${email}|${day}`) || null;
        }
        if (/FROM dua_images/.test(sql)) {
          const [email, id] = args;
          return duas.get(`${email}|${id}`) || null;
        }
        return null;
      },
      async all() {
        if (/FROM google_tokens/.test(sql)) {
          return { results: Array.from(googleTokens.keys()).map((user_email) => ({ user_email })) };
        }
        if (/FROM dua_images/.test(sql)) {
          const email = args[0];
          return {
            results: Array.from(duas.values())
              .filter((r) => r.user_email === email)
              .sort((a, b) => a.created_at - b.created_at)
              .map(({ id, name, created_at }) => ({ id, name, created_at })),
          };
        }
        return { results: [] };
      },
      async run() {
        if (/INSERT INTO google_tokens/.test(sql)) {
          const [email, refresh_token, access_token, access_token_expires_at, updated_at] = args;
          googleTokens.set(email, { refresh_token, access_token, access_token_expires_at, updated_at });
        } else if (/UPDATE google_tokens SET access_token/.test(sql)) {
          const [access_token, access_token_expires_at, updated_at, email] = args;
          const row = googleTokens.get(email) || {};
          googleTokens.set(email, { ...row, access_token, access_token_expires_at, updated_at });
        } else if (/INSERT INTO dua_images/.test(sql)) {
          const [user_email, id, name, mime, data, created_at] = args;
          duas.set(`${user_email}|${id}`, { user_email, id, name, mime, data, created_at });
        } else if (/DELETE FROM dua_images/.test(sql)) {
          duas.delete(`${args[0]}|${args[1]}`);
        } else if (/INSERT INTO daily_brief/.test(sql)) {
          const [email, day, summary, status, error, generated_at] = args;
          dailyBrief.set(`${email}|${day}`, { summary, status, error, generated_at });
        }
        return { success: true };
      },
    };
  }

  function prepare(sql) {
    return statement(sql, []);
  }

  return {
    // Realistic-shaped secrets by default, matching a fully-configured
    // Worker - tests for the "not configured" case can override/delete
    // these explicitly rather than every other test having to supply them.
    env: {
      DB: { prepare },
      GOOGLE_CLIENT_ID: "test-client-id",
      GOOGLE_CLIENT_SECRET: "test-client-secret",
      GEMINI_API_KEY: "test-gemini-key",
    },
    googleTokens,
    dailyBrief,
    seedToken(email, row) {
      googleTokens.set(email, {
        refresh_token: row.refresh_token || "seed-refresh-token",
        access_token: row.access_token ?? null,
        access_token_expires_at: row.access_token_expires_at ?? null,
        updated_at: row.updated_at ?? Date.now(),
      });
    },
    seedBrief(email, day, row) {
      dailyBrief.set(`${email}|${day}`, {
        summary: row.summary ?? null,
        status: row.status ?? "ok",
        error: row.error ?? null,
        generated_at: row.generated_at ?? Date.now(),
      });
    },
  };
}

module.exports = { createFakeD1 };
