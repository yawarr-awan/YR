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
  const days = new Map(); // `${email}|${day}` -> row
  const profiles = new Map(); // user_email -> data JSON string
  const profileRows = new Map(); // user_email -> { data, updated_at }
  const settings = new Map(); // user_email -> { brief_prompt, brief_model }
  /* The board's own tables, keyed `${email}|${id}` like the rest. */
  const boardItems = { projects: new Map(), tasks: new Map() };

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
        if (/FROM profile/.test(sql)) {
          if (/updated_at > \?2/.test(sql)) {
            const r = profileRows.get(args[0]);
            return r && r.updated_at > args[1] ? r : null;
          }
          const row = profiles.get(args[0]);
          return row ? { data: row } : null;
        }
        if (/FROM user_settings/.test(sql)) {
          return settings.get(args[0]) || null;
        }
        if (/FROM dua_images/.test(sql)) {
          /* The shared library is addressed by id alone - no user_email in the
             statement any more, so none in the bindings either. */
          const [id] = args;
          for (const row of duas.values()) if (row.id === id) return row;
          return null;
        }
        return null;
      },
      async all() {
        if (/FROM google_tokens/.test(sql)) {
          return { results: Array.from(googleTokens.keys()).map((user_email) => ({ user_email })) };
        }
        if (/FROM days/.test(sql)) {
          const [email, day, limit] = args;
          const upTo = Array.from(days.values())
            .filter((r) => r.user_email === email && !r.deleted && r.day <= day);
          const parse = (r) => { try { return JSON.parse(r.data || "{}"); } catch (e) { return null; } };

          /* Two different statements read this table. The journal's asks for
             the days with something written, newest first; the trends one
             asks for a few fields off every day, oldest first. They are told
             apart the same way the real SQL differs. */
          /* handleSync's pull: everything newer than a watermark, oldest
             first. Told apart from the other two `days` statements by asking
             for updated_at, which neither of them does. */
          if (/updated_at > \?2/.test(sql)) {
            const [email, since] = args;
            return {
              results: Array.from(days.values())
                .filter((r) => r.user_email === email && !r.deleted && r.updated_at > since)
                .sort((a, b) => a.updated_at - b.updated_at)
                .map(({ day: d, data, updated_at }) => ({ day: d, data, updated_at })),
            };
          }
          if (/\$\.notes/.test(sql)) {
            return {
              results: upTo
                .filter((r) => String(parse(r)?.notes || "").trim() !== "")
                .sort((a, b) => (a.day < b.day ? 1 : -1))
                .slice(0, limit)
                .map(({ day: d, data }) => ({ day: d, data })),
            };
          }
          return {
            results: upTo
              .sort((a, b) => (a.day > b.day ? 1 : -1))
              .slice(0, limit)
              .map((r) => {
                const d = parse(r) || {};
                /* json_extract returns the value, or NULL when the path is
                   absent - and a JSON boolean comes back as 1/0. */
                return {
                  day: r.day,
                  weight: d.weight ?? null,
                  sleep: d.sleep ?? null,
                  exercise: d.exercise ? 1 : 0,
                  prayers: d.prayers ? JSON.stringify(d.prayers) : null,
                };
              }),
          };
        }
        if (/FROM (projects|tasks)\b/.test(sql)) {
          const table = /FROM projects/.test(sql) ? "projects" : "tasks";
          const [email, since] = args;
          return {
            results: Array.from(boardItems[table].values())
              .filter((r) => r.user_email === email && r.updated_at > since)
              .sort((a, b) => a.updated_at - b.updated_at)
              .map(({ id, data, updated_at, deleted }) => ({ id, data, updated_at, deleted })),
          };
        }
        if (/FROM dua_images/.test(sql)) {
          /* Every picture, whoever uploaded it - the library is shared. */
          return {
            results: Array.from(duas.values())
              .sort((a, b) => a.created_at - b.created_at)
              .map(({ id, name, created_at, user_email }) => ({ id, name, created_at, user_email })),
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
          /* By id, whoever uploaded it. */
          for (const [k, row] of duas) if (row.id === args[0]) duas.delete(k);
        } else if (/CREATE TABLE IF NOT EXISTS (projects|tasks)/.test(sql)) {
          /* no-op: the maps are the tables */
        } else if (/INSERT INTO (projects|tasks)/.test(sql)) {
          const table = /INSERT INTO projects/.test(sql) ? "projects" : "tasks";
          const [email, id, data, updated_at, deleted] = args;
          const key = `${email}|${id}`;
          const prev = boardItems[table].get(key);
          /* Mirrors the real ON CONFLICT ... WHERE excluded.updated_at > ... */
          if (!prev || updated_at > prev.updated_at) {
            boardItems[table].set(key, { user_email: email, id, data, updated_at, deleted: deleted ? 1 : 0 });
          }
        } else if (/CREATE TABLE IF NOT EXISTS user_settings/.test(sql)) {
          /* no-op: the map is the table */
        } else if (/ALTER TABLE user_settings ADD COLUMN/.test(sql)) {
          /* The real statement throws once the column exists, and the Worker
             swallows that. Nothing to do here either way. */
        } else if (/INSERT INTO user_settings/.test(sql)) {
          /* Which column is written depends on the statement, exactly as in
             worker.js - the prompt and the model are set independently and
             neither may clobber the other. */
          const [email, value] = args;
          const row = settings.get(email) || { brief_prompt: null, brief_model: null };
          if (/brief_model/.test(sql)) row.brief_model = value;
          else row.brief_prompt = value;
          settings.set(email, row);
        } else if (/UPDATE daily_brief SET error/.test(sql)) {
          const [email, day, error] = args;
          const row = dailyBrief.get(`${email}|${day}`);
          if (row) dailyBrief.set(`${email}|${day}`, { ...row, error });
        } else if (/INSERT INTO days/.test(sql)) {
          /* Mirrors the real ON CONFLICT ... WHERE excluded.updated_at >
             days.updated_at - a stale write must be dropped, not applied. */
          const [email, day, data, updated_at] = args;
          const key = `${email}|${day}`;
          const prev = days.get(key);
          if (!prev || updated_at > prev.updated_at) {
            days.set(key, { user_email: email, day, data, updated_at, deleted: 0 });
          }
        } else if (/INSERT INTO profile/.test(sql)) {
          const [email, data, updated_at] = args;
          const prev = profileRows.get(email);
          if (!prev || updated_at > prev.updated_at) {
            profileRows.set(email, { data, updated_at });
            profiles.set(email, data);
          }
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
      /* Real D1 batches an array of prepared statements; each one already
         knows its own SQL and bindings, so running them in order is faithful
         enough for these tests. */
      DB: { prepare, batch: async (stmts) => Promise.all(stmts.map((st) => st.run())) },
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
    seedDay(email, day, data, opts) {
      days.set(`${email}|${day}`, {
        user_email: email, day,
        data: typeof data === "string" ? data : JSON.stringify(data),
        updated_at: (opts && opts.updated_at) ?? Date.now(),
        deleted: (opts && opts.deleted) ? 1 : 0,
      });
    },
    settings,
    days,
    seedProfile(email, data) {
      profiles.set(email, typeof data === "string" ? data : JSON.stringify(data));
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
