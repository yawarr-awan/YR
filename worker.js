/**
 * YR Wellness Tracker - Worker
 *
 * Serves the static app and a small sync API backed by D1.
 * Every /api/* request must carry a valid Cloudflare Access JWT.
 *
 * Required vars (set in the Cloudflare dashboard, not secrets - neither is sensitive):
 *   ACCESS_TEAM_DOMAIN  e.g. "yawar" for https://yawar.cloudflareaccess.com
 *   ACCESS_AUD          the Application Audience tag from the Access app
 *
 * Required secrets for the daily Calendar + Gemini brief (Settings ->
 * Variables and secrets, same place as the two above):
 *   GOOGLE_CLIENT_ID      OAuth 2.0 Web application client ID
 *   GOOGLE_CLIENT_SECRET  its client secret
 *   GEMINI_API_KEY        Gemini API key from Google AI Studio
 */

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
};

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

/* ---------- Access JWT verification ---------- */

let keyCache = { at: 0, keys: null, domain: null };

async function getKeys(teamDomain) {
  const fresh = Date.now() - keyCache.at < 60 * 60 * 1000;
  if (fresh && keyCache.keys && keyCache.domain === teamDomain) return keyCache.keys;

  const url = `https://${teamDomain}.cloudflareaccess.com/cdn-cgi/access/certs`;
  const res = await fetch(url, { cf: { cacheTtl: 3600 } });
  if (!res.ok) throw new Error(`certs fetch failed: ${res.status}`);
  const { keys } = await res.json();

  const imported = {};
  for (const jwk of keys) {
    imported[jwk.kid] = await crypto.subtle.importKey(
      "jwk",
      jwk,
      { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
      false,
      ["verify"]
    );
  }
  keyCache = { at: Date.now(), keys: imported, domain: teamDomain };
  return imported;
}

function b64urlToBytes(s) {
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64urlToJson(s) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(s)));
}

/**
 * Verifies the Access JWT and returns the authenticated email.
 * Throws on any failure. Never trust the CF-Access-Authenticated-User-Email
 * header on its own: it is only meaningful once the signature is checked.
 */
async function verifyAccess(request, env) {
  if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD) {
    throw new Error("Access not configured");
  }

  const token =
    request.headers.get("Cf-Access-Jwt-Assertion") ||
    (request.headers.get("cookie") || "").match(/CF_Authorization=([^;]+)/)?.[1];
  if (!token) throw new Error("no token");

  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("malformed token");
  const [h, p, sig] = parts;

  const header = b64urlToJson(h);
  const payload = b64urlToJson(p);

  const keys = await getKeys(env.ACCESS_TEAM_DOMAIN);
  const key = keys[header.kid];
  if (!key) throw new Error("unknown kid");

  const ok = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(sig),
    new TextEncoder().encode(`${h}.${p}`)
  );
  if (!ok) throw new Error("bad signature");

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp && payload.exp < now) throw new Error("expired");
  if (payload.nbf && payload.nbf > now + 60) throw new Error("not yet valid");

  const aud = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!aud.includes(env.ACCESS_AUD)) throw new Error("aud mismatch");

  const issuer = `https://${env.ACCESS_TEAM_DOMAIN}.cloudflareaccess.com`;
  if (payload.iss !== issuer) throw new Error("iss mismatch");

  const email = payload.email || payload.common_name;
  if (!email) throw new Error("no subject");
  return String(email).toLowerCase();
}

/* ---------- sync ---------- */

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DAYS_PER_PUSH = 500;
const MAX_DAY_BYTES = 20000;

/**
 * POST /api/sync
 * in : { since: number, days: { "YYYY-MM-DD": { data, updated_at } }, profile?: { data, updated_at } }
 * out: { now, days: {...}, profile, applied, skipped }
 *
 * Last-write-wins per day on updated_at. Server never deletes; the client
 * is authoritative about what it sends and we only ever move forward.
 */
async function handleSync(request, env, email) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const since = Number.isFinite(body.since) ? body.since : 0;
  const incoming = body.days && typeof body.days === "object" ? body.days : {};
  const dayKeys = Object.keys(incoming);

  if (dayKeys.length > MAX_DAYS_PER_PUSH) {
    return json({ error: `too many days in one push (max ${MAX_DAYS_PER_PUSH})` }, 413);
  }

  let applied = 0;
  const skipped = [];
  const stmts = [];

  for (const day of dayKeys) {
    const rec = incoming[day];
    if (!DAY_RE.test(day) || !rec || typeof rec.data !== "string") {
      skipped.push(day);
      continue;
    }
    if (rec.data.length > MAX_DAY_BYTES) {
      skipped.push(day);
      continue;
    }
    const ts = Number(rec.updated_at);
    if (!Number.isFinite(ts) || ts <= 0) {
      skipped.push(day);
      continue;
    }
    stmts.push(
      env.DB.prepare(
        `INSERT INTO days (user_email, day, data, updated_at, deleted)
         VALUES (?1, ?2, ?3, ?4, 0)
         ON CONFLICT(user_email, day) DO UPDATE SET
           data = excluded.data,
           updated_at = excluded.updated_at
         WHERE excluded.updated_at > days.updated_at`
      ).bind(email, day, rec.data, ts)
    );
    applied++;
  }

  if (body.profile && typeof body.profile.data === "string") {
    const ts = Number(body.profile.updated_at);
    if (Number.isFinite(ts) && ts > 0 && body.profile.data.length <= MAX_DAY_BYTES) {
      stmts.push(
        env.DB.prepare(
          `INSERT INTO profile (user_email, data, updated_at)
           VALUES (?1, ?2, ?3)
           ON CONFLICT(user_email) DO UPDATE SET
             data = excluded.data,
             updated_at = excluded.updated_at
           WHERE excluded.updated_at > profile.updated_at`
        ).bind(email, body.profile.data, ts)
      );
    }
  }

  if (stmts.length) await env.DB.batch(stmts);

  // Pull anything the client has not seen. Bounded so a huge history
  // cannot blow the response up in one go.
  const { results } = await env.DB.prepare(
    `SELECT day, data, updated_at FROM days
     WHERE user_email = ?1 AND updated_at > ?2 AND deleted = 0
     ORDER BY updated_at ASC LIMIT 1000`
  )
    .bind(email, since)
    .all();

  const days = {};
  for (const r of results) days[r.day] = { data: r.data, updated_at: r.updated_at };

  const prof = await env.DB.prepare(
    `SELECT data, updated_at FROM profile WHERE user_email = ?1 AND updated_at > ?2`
  )
    .bind(email, since)
    .first();

  return json({
    now: Date.now(),
    days,
    profile: prof ? { data: prof.data, updated_at: prof.updated_at } : null,
    applied,
    skipped,
    more: results.length === 1000,
  });
}

async function handleStats(env, email) {
  const row = await env.DB.prepare(
    `SELECT COUNT(*) AS n, MAX(updated_at) AS last FROM days WHERE user_email = ?1 AND deleted = 0`
  )
    .bind(email)
    .first();
  return json({ email, days: row?.n ?? 0, lastUpdate: row?.last ?? null });
}

/* ---------- Google Calendar + Gemini daily brief ---------- */

const GOOGLE_SCOPE = [
  "https://www.googleapis.com/auth/calendar.readonly",
  "https://www.googleapis.com/auth/calendar.events", // write - lets scheduled tasks create real events
  // Write, so a Google Task can be ticked off from the Calendar tab. Google
  // does not revoke a refresh token when the app later asks for more, but the
  // existing one keeps its original scopes - so an established connection has
  // to be re-consented once, which surfaces as reconnect_required.
  "https://www.googleapis.com/auth/tasks",
].join(" ");
const BRIEF_TIMEZONE = "Europe/London";
const GEMINI_MODEL = "gemini-flash-latest"; // Google-maintained alias for their current default Flash model

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function htmlMessage(msg, ok) {
  return new Response(
    `<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;padding:40px;text-align:center;max-width:480px;margin:0 auto">
     <h2>${ok ? "✅" : "⚠️"} ${escapeHtml(msg)}</h2>
     <p><a href="/">Back to the app</a></p></body>`,
    { headers: { "content-type": "text/html; charset=utf-8" } }
  );
}

function googleRedirectUri(url) {
  return `${url.protocol}//${url.host}/api/google/callback`;
}

/**
 * GET /api/google/connect - redirects to Google's consent screen.
 * access_type=offline + prompt=consent guarantee a refresh_token comes
 * back even on a re-connect, which a bare "offline" request would skip
 * if the user had already granted consent once before.
 */
function handleGoogleConnect(request, env) {
  if (!env.GOOGLE_CLIENT_ID) return json({ error: "Google OAuth not configured" }, 500);
  const url = new URL(request.url);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID,
    redirect_uri: googleRedirectUri(url),
    response_type: "code",
    scope: GOOGLE_SCOPE,
    access_type: "offline",
    prompt: "consent",
  });
  return Response.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`, 302);
}

/**
 * GET /api/google/callback - exchanges the auth code for tokens and
 * stores the refresh_token in D1, keyed by the Access-authenticated email
 * (not anything Google told us) - the whole point of Access verification
 * is that we never trust an identity claim we haven't checked ourselves.
 */
async function handleGoogleCallback(request, env, email) {
  const url = new URL(request.url);
  const errParam = url.searchParams.get("error");
  if (errParam) return htmlMessage(`Google sign-in was cancelled or failed: ${errParam}`);

  const code = url.searchParams.get("code");
  if (!code) return htmlMessage("Missing authorization code from Google.");
  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) {
    return htmlMessage("Google OAuth is not configured on the server yet.");
  }

  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      redirect_uri: googleRedirectUri(url),
      grant_type: "authorization_code",
    }),
  });
  if (!tokenRes.ok) {
    return htmlMessage(`Google token exchange failed (HTTP ${tokenRes.status}). Try connecting again.`);
  }
  const tok = await tokenRes.json();
  if (!tok.refresh_token) {
    return htmlMessage(
      "Google didn't return a refresh token. Revoke this app's access at " +
      "https://myaccount.google.com/permissions and try connecting again."
    );
  }

  const now = Date.now();
  const expiresAt = tok.expires_in ? now + tok.expires_in * 1000 : null;
  await env.DB.prepare(
    `INSERT INTO google_tokens (user_email, refresh_token, access_token, access_token_expires_at, updated_at)
     VALUES (?1, ?2, ?3, ?4, ?5)
     ON CONFLICT(user_email) DO UPDATE SET
       refresh_token = excluded.refresh_token,
       access_token = excluded.access_token,
       access_token_expires_at = excluded.access_token_expires_at,
       updated_at = excluded.updated_at`
  ).bind(email, tok.refresh_token, tok.access_token || null, expiresAt, now).run();

  return htmlMessage("Google Calendar connected. You can close this and go back to the app.", true);
}

/**
 * Returns a valid access token for `email`, refreshing it first if it's
 * missing or near expiry. Never throws - callers branch on `.error`
 * instead, since "not connected yet" and "needs reconnecting" are normal,
 * expected states here, not exceptional ones.
 */
async function getGoogleAccessToken(env, email) {
  const row = await env.DB.prepare(
    `SELECT refresh_token, access_token, access_token_expires_at FROM google_tokens WHERE user_email = ?1`
  ).bind(email).first();
  if (!row) return { error: "not_connected" };

  const now = Date.now();
  if (row.access_token && row.access_token_expires_at && row.access_token_expires_at > now + 60000) {
    return { accessToken: row.access_token };
  }

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: row.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // A revoked/expired refresh token (e.g. Google's 7-day Testing-mode
    // limit) surfaces as invalid_grant - that means "reconnect", not a
    // generic failure.
    if (res.status === 400 && /invalid_grant/.test(detail)) return { error: "reconnect_required" };
    return { error: "refresh_failed" };
  }
  const tok = await res.json();
  const expiresAt = tok.expires_in ? now + tok.expires_in * 1000 : null;
  await env.DB.prepare(
    `UPDATE google_tokens SET access_token = ?1, access_token_expires_at = ?2, updated_at = ?3 WHERE user_email = ?4`
  ).bind(tok.access_token, expiresAt, now, email).run();
  return { accessToken: tok.access_token };
}

/** The UTC offset (minutes) of an IANA time zone at a given instant, via
 * Intl only - self-adjusts across DST transitions (BST/GMT) with no
 * manual offset table to maintain. */
function utcOffsetMinutes(timeZone, date) {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" }).formatToParts(date);
  const tzName = parts.find((p) => p.type === "timeZoneName")?.value || "GMT+00:00";
  const m = tzName.match(/GMT([+-])(\d{1,2})(?::?(\d{2}))?/);
  if (!m) return 0;
  const sign = m[1] === "-" ? -1 : 1;
  return sign * (parseInt(m[2], 10) * 60 + parseInt(m[3] || "0", 10));
}

/** Midnight-to-midnight bounds for a specific `YYYY-MM-DD` in `timeZone`,
 * as RFC3339 strings with an explicit offset (required by Calendar's
 * timeMin/timeMax). Looks up the offset at local noon of that day - safe
 * for Europe/London (offset is always 0 or +1h), the only zone this file
 * ever uses; not a general-purpose solution for zones near UTC+/-12. */
function dayBoundsForDate(timeZone, day) {
  const noonGuess = new Date(`${day}T12:00:00Z`);
  const offsetMin = utcOffsetMinutes(timeZone, noonGuess);
  const sign = offsetMin >= 0 ? "+" : "-";
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return { day, timeMin: `${day}T00:00:00${offset}`, timeMax: `${day}T23:59:59${offset}` };
}

/** Local midnight-to-midnight bounds for "now" in `timeZone`. */
function localDayBounds(timeZone, now) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(now).map((p) => [p.type, p.value])
  );
  return dayBoundsForDate(timeZone, `${parts.year}-${parts.month}-${parts.day}`);
}

/** Every calendar the user has read access to - including shared/family
 * calendars, not just their own primary one. */
async function listCalendars(accessToken) {
  /* showHidden matters: a secondary/shared calendar that's been unticked in
     the Google Calendar UI is "hidden", and calendarList leaves those out by
     default - so events on it would silently never reach the brief. */
  const params = new URLSearchParams({ minAccessRole: "reader", showHidden: "true", showDeleted: "false", maxResults: "250" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/users/me/calendarList?${params}`, {
    headers: { authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`calendar list failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  return (data.items || []).map((c) => ({
    id: c.id,
    name: c.summaryOverride || c.summary || c.id,
    color: c.backgroundColor || "#4285F4",
    primary: Boolean(c.primary),
    /* Only writer/owner calendars can be edited. A shared calendar you can
       merely read must not offer a Save button, so this travels with every
       event the UI renders. */
    writable: c.accessRole === "writer" || c.accessRole === "owner",
  }));
}

/** Events across every given calendar, tagged with their source
 * calendar's name/color so the UI can tell them apart. One unreachable
 * calendar (revoked share, deleted, etc.) is skipped rather than failing
 * the whole fetch - better to show the rest than nothing. */
async function fetchEventsForRange(accessToken, calendars, timeMin, timeMax) {
  const all = [];
  for (const cal of calendars) {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "250" });
    const res = await fetch(
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${params}`,
      { headers: { authorization: `Bearer ${accessToken}` } }
    );
    if (!res.ok) {
      console.error(`skipping calendar ${cal.id}: HTTP ${res.status}`);
      continue;
    }
    const data = await res.json();
    for (const e of data.items || []) {
      all.push({
        /* id + calendarId are what make an event editable from the UI -
           Google needs both to address it. */
        id: e.id,
        calendarId: cal.id,
        writable: Boolean(cal.writable),
        title: e.summary || "(no title)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime,
        location: e.location || null,
        notes: e.description || null,
        calendar: cal.name,
        color: cal.color,
      });
    }
  }
  all.sort((a, b) => new Date(a.start) - new Date(b.start));
  return all;
}

/** Open Google Tasks across every task list, bucketed relative to `day`.
 *
 * Tasks are an enrichment, never the brief's critical path, so this still
 * never throws - but it now *reports* why it came back empty instead of
 * swallowing it. A silent empty list is indistinguishable from "no tasks",
 * which is exactly how an unenabled Tasks API or a missing scope hid itself.
 *
 * It deliberately asks for everything open rather than filtering server-side
 * on the due date: Google Tasks stores `due` as a date (midnight UTC) and
 * most tasks have no due date at all, so a dueMin/dueMax window silently
 * dropped both undated and overdue work - the very things worth surfacing. */
async function fetchTasks(accessToken, day) {
  const out = { dueToday: [], overdue: [], undatedCount: 0, error: null };
  try {
    const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!listsRes.ok) {
      const detail = await listsRes.text().catch(() => "");
      out.error = `task lists unavailable: HTTP ${listsRes.status} ${detail.slice(0, 300)}`;
      return out;
    }
    const listsData = await listsRes.json();

    for (const list of listsData.items || []) {
      // maxResults defaults to 20, which quietly truncates a real task list.
      const params = new URLSearchParams({ showCompleted: "false", showHidden: "true", maxResults: "100" });
      const res = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
        { headers: { authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        if (!out.error) out.error = `task list "${list.title || list.id}" unavailable: HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      for (const t of data.items || []) {
        if (t.status === "completed" || t.deleted) continue;
        const entry = { title: (t.title || "").trim() || "(untitled task)", due: t.due || null, list: list.title || null };
        /* Undated tasks are deliberately left out of the brief: they are a
           backlog, not part of today. They are still counted so the summary
           can mention how many are sitting there. */
        if (!t.due) { out.undatedCount++; continue; }
        const dueDay = String(t.due).slice(0, 10);
        if (dueDay < day) out.overdue.push(entry);
        else if (dueDay === day) out.dueToday.push(entry);
        /* Later than today: not part of a brief about today. */
      }
    }
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

const DEFAULT_BRIEF_PROMPT =
  "You are a concise personal daily-briefing assistant. Everything below is what is still " +
  "outstanding - events that have already finished were removed on purpose, so do not imply " +
  "the day is just starting.\n\n" +
  "Cover ALL of it: the calendar events AND the Google Tasks. The events span every calendar " +
  "the person can see, including shared, family and secondary ones - the bracketed tag names " +
  "the source calendar or task list. Treat them all as equally real; do not skip a section " +
  "because it is short.\n\n" +
  "Write a clear, friendly summary (up to 6 sentences). Say what is left on the schedule, call " +
  "out any tight back-to-back timings or free stretches, and then say what needs doing - naming " +
  "overdue tasks first, since those are the ones slipping. Do not open with a time-of-day " +
  "greeting like \"Good morning\" or \"Good evening\". Do not invent anything not listed below. " +
  "Plain text, no markdown.";

/* The brief's instructions are user-editable (Settings tab). The data
   sections are always appended by summarizeWithGemini, so a custom prompt
   can change the tone or focus but can never detach the summary from the
   real events and tasks. */
async function ensureSettingsTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS user_settings (
       user_email TEXT PRIMARY KEY,
       brief_prompt TEXT,
       updated_at INTEGER
     )`
  ).run();
}

async function getBriefPrompt(env, email) {
  try {
    await ensureSettingsTable(env);
    const row = await env.DB.prepare(`SELECT brief_prompt FROM user_settings WHERE user_email = ?1`).bind(email).first();
    const p = row && row.brief_prompt ? String(row.brief_prompt).trim() : "";
    return p || null;
  } catch {
    return null;                       /* never block the brief on settings */
  }
}

async function handleGetBriefPrompt(env, email) {
  return json({ prompt: await getBriefPrompt(env, email), default: DEFAULT_BRIEF_PROMPT });
}

async function handlePutBriefPrompt(request, env, email) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }
  const raw = typeof body.prompt === "string" ? body.prompt.trim() : "";
  const prompt = raw.slice(0, 4000) || null;
  await ensureSettingsTable(env);
  await env.DB.prepare(
    `INSERT INTO user_settings (user_email, brief_prompt, updated_at) VALUES (?1, ?2, ?3)
     ON CONFLICT(user_email) DO UPDATE SET brief_prompt = excluded.brief_prompt, updated_at = excluded.updated_at`
  ).bind(email, prompt, Date.now()).run();
  return json({ prompt, default: DEFAULT_BRIEF_PROMPT });
}

async function summarizeWithGemini(env, day, events, tasks, now, instructions) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini API key not configured");

  const nowLabel = (now || new Date()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: BRIEF_TIMEZONE });

  const eventLines = events.length
    ? events.map((e) => {
        const when = e.allDay
          ? "All day"
          : new Date(e.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: BRIEF_TIMEZONE });
        const cal = e.calendar ? ` [${e.calendar}]` : "";
        return `- ${when}: ${e.title}${e.location ? ` (${e.location})` : ""}${cal}`;
      }).join("\n")
    : "(No calendar events remaining today.)";

  const t = tasks || { dueToday: [], overdue: [], undatedCount: 0 };
  const taskBlock = (label, list, cap) => {
    if (!list || !list.length) return `${label}:\n(none)`;
    const shown = cap ? list.slice(0, cap) : list;
    const lines = shown.map((x) => `- ${x.title}${x.list ? ` [${x.list}]` : ""}`).join("\n");
    const more = list.length > shown.length ? `\n- (+${list.length - shown.length} more)` : "";
    return `${label}:\n${lines}${more}`;
  };

  const prompt =
    `${(instructions || DEFAULT_BRIEF_PROMPT)}\n\n` +
    `It is currently ${nowLabel} on ${day}.\n\n` +
    `Remaining events today:\n${eventLines}\n\n` +
    `${taskBlock("Tasks due today", t.dueToday)}\n\n` +
    `${taskBlock("Overdue tasks", t.overdue, 10)}` +
    (t.undatedCount ? `\n\n(${t.undatedCount} further task(s) have no due date and are not part of today.)` : "");

  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${env.GEMINI_API_KEY}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    }
  );
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`gemini call failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || []).map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("gemini returned no text");
  return text;
}

async function saveBriefStatus(env, email, day, status, summary, error) {
  await env.DB.prepare(
    `INSERT INTO daily_brief (user_email, day, summary, status, error, generated_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6)
     ON CONFLICT(user_email, day) DO UPDATE SET
       summary = excluded.summary, status = excluded.status, error = excluded.error, generated_at = excluded.generated_at`
  ).bind(email, day, summary, status, error, Date.now()).run();
}

/** Does the actual work: refresh token -> today's events -> Gemini summary
 * -> persisted to D1. Every failure mode still returns a tagged result
 * instead of throwing, so both the manual-refresh endpoint and the cron
 * handler can report (or log) precisely what happened. */
async function generateBrief(env, email, now) {
  const effectiveNow = now || new Date();
  const { day, timeMin, timeMax } = localDayBounds(BRIEF_TIMEZONE, effectiveNow);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return { status: tokenResult.error, day };

  let events;
  try {
    const calendars = await listCalendars(tokenResult.accessToken);
    const allEvents = await fetchEventsForRange(tokenResult.accessToken, calendars, timeMin, timeMax);
    // A refresh triggered mid-day should talk about what's left, not
    // re-describe meetings that already happened - drop anything whose
    // end time (or start, for events missing one) is already in the past.
    const nowMs = effectiveNow.getTime();
    events = allEvents.filter((e) => {
      const endMs = new Date(e.end || e.start).getTime();
      return !Number.isFinite(endMs) || endMs > nowMs;
    });
  } catch (e) {
    const detail = String(e.message || e);
    await saveBriefStatus(env, email, day, "calendar_error", null, detail);
    return { status: "calendar_error", day, error: detail };
  }

  const tasks = await fetchTasks(tokenResult.accessToken, day);

  let summary;
  try {
    summary = await summarizeWithGemini(env, day, events, tasks, effectiveNow, await getBriefPrompt(env, email));
  } catch (e) {
    const detail = String(e.message || e);
    await saveBriefStatus(env, email, day, "gemini_error", null, detail);
    return { status: "gemini_error", day, error: detail };
  }

  const generatedAt = Date.now();
  /* A Tasks failure doesn't stop the brief, but it is recorded alongside the
     successful summary so "why are none of my tasks in here?" is answerable
     instead of looking identical to "you have no tasks". */
  await saveBriefStatus(env, email, day, "ok", summary, tasks.error);
  return { status: "ok", day, summary, generated_at: generatedAt, error: tasks.error };
}

async function handleGetBrief(env, email, now) {
  const { day } = localDayBounds(BRIEF_TIMEZONE, now || new Date());
  const [tokenRow, briefRow] = await Promise.all([
    env.DB.prepare(`SELECT 1 AS present FROM google_tokens WHERE user_email = ?1`).bind(email).first(),
    env.DB.prepare(
      `SELECT summary, status, error, generated_at FROM daily_brief WHERE user_email = ?1 AND day = ?2`
    ).bind(email, day).first(),
  ]);
  const connected = Boolean(tokenRow);
  return json({
    connected,
    day,
    summary: briefRow?.summary ?? null,
    status: briefRow?.status ?? (connected ? "pending" : "not_connected"),
    error: briefRow?.error ?? null,
    generated_at: briefRow?.generated_at ?? null,
  });
}

async function handleRefreshBrief(env, email, now) {
  const result = await generateBrief(env, email, now);
  return json({
    connected: result.status !== "not_connected" && result.status !== "reconnect_required",
    day: result.day,
    status: result.status,
    summary: result.summary ?? null,
    error: result.error ?? null,
    generated_at: result.generated_at ?? null,
  });
}

/** Open Google Tasks whose due date falls inside [fromDay, toDay], for the
 * Calendar tab. Google Tasks stores `due` as a date (the time part is
 * meaningless), so these are all-day items.
 *
 * The filtering is done here rather than with dueMin/dueMax: those compare
 * full RFC3339 timestamps against a field that is really only a date, which
 * is how tasks went missing from the brief once already. Everything open is
 * fetched and matched on the date prefix instead.
 *
 * Like the brief's task fetch, this never throws - the agenda is worth
 * showing without them - but it does report why it came back empty. */
/** Google sends a date-only Google Task as exact midnight UTC; anything else
 * carries a real time of day. (A task genuinely due at 00:00 UTC is
 * indistinguishable from a dateless one here - it reads as all-day, which is
 * the harmless way round.) */
function isDateOnlyDue(due) {
  const t = String(due || "").slice(11, 19);
  return t === "" || t === "00:00:00";
}

async function fetchTasksInRange(accessToken, fromDay, toDay) {
  const out = { tasks: [], error: null };
  try {
    const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists?maxResults=100", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!listsRes.ok) {
      const detail = await listsRes.text().catch(() => "");
      out.error = `task lists unavailable: HTTP ${listsRes.status} ${detail.slice(0, 300)}`;
      return out;
    }
    const listsData = await listsRes.json();

    for (const list of listsData.items || []) {
      const params = new URLSearchParams({ showCompleted: "false", showHidden: "true", maxResults: "100" });
      const res = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
        { headers: { authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) {
        if (!out.error) out.error = `task list "${list.title || list.id}" unavailable: HTTP ${res.status}`;
        continue;
      }
      const data = await res.json();
      for (const t of data.items || []) {
        if (t.status === "completed" || t.deleted || !t.due) continue;
        const dueDay = String(t.due).slice(0, 10);
        if (dueDay < fromDay || dueDay > toDay) continue;
        out.tasks.push({
          id: t.id,
          title: (t.title || "").trim() || "(untitled task)",
          /* The full timestamp, not just the date: a task given a time of
             day is a 1pm thing, not an all-day thing, and truncating it to
             its date prefix is what made every task look all-day. Google
             sends midnight UTC for a date-only task, which is how the two
             are told apart. */
          due: t.due,
          allDay: isDateOnlyDue(t.due),
          notes: t.notes || null,
          listId: list.id,
          list: list.title || null,
        });
      }
    }
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

/**
 * GET /api/calendar/events?date=YYYY-MM-DD[&end=YYYY-MM-DD] - raw
 * (non-summarized) events across every calendar the user can read, for the
 * Calendar tab. Defaults to today (Europe/London) if `date` is missing or
 * malformed. `end` extends it to an inclusive multi-day range, which is how
 * the week view pulls seven days without listing every calendar seven
 * times; an absent, malformed or backwards `end` just means a single day.
 */
async function handleGetCalendarEvents(request, env, email, now) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const endParam = url.searchParams.get("end");
  const day = dateParam && DAY_RE.test(dateParam) ? dateParam : localDayBounds(BRIEF_TIMEZONE, now || new Date()).day;
  const end = endParam && DAY_RE.test(endParam) && endParam >= day ? endParam : day;
  const { timeMin } = dayBoundsForDate(BRIEF_TIMEZONE, day);
  const { timeMax } = dayBoundsForDate(BRIEF_TIMEZONE, end);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ connected: false, status: tokenResult.error, day, end, events: [] });

  /* Tasks are fetched alongside, not instead: a Tasks failure must not cost
     the user their agenda, so it comes back as a note beside the events. */
  const taskResult = await fetchTasksInRange(tokenResult.accessToken, day, end);

  try {
    const calendars = await listCalendars(tokenResult.accessToken);
    const events = await fetchEventsForRange(tokenResult.accessToken, calendars, timeMin, timeMax);
    return json({ connected: true, status: "ok", day, end, events, tasks: taskResult.tasks, tasksError: taskResult.error });
  } catch (e) {
    return json({
      connected: true, status: "calendar_error", day, end, events: [],
      tasks: taskResult.tasks, tasksError: taskResult.error, error: String(e.message || e),
    });
  }
}

/** Shared failure mapping for the three write paths below. An old
 * read-only-scope token (pre-reconnect) can't write at all, and Google
 * surfaces that as 403 insufficientPermissions - mapped to
 * reconnect_required so the UI can prompt exactly that rather than showing
 * a generic error. A 403 on a calendar the user only reads is a different
 * thing entirely and stays an error. */
async function googleWriteFailure(res) {
  const detail = await res.text().catch(() => "");
  if (res.status === 403 && /insufficient/i.test(detail)) return json({ status: "reconnect_required" });
  if (res.status === 404) return json({ status: "not_found" });
  return json({ status: "error", error: `HTTP ${res.status} ${detail.slice(0, 200)}` });
}

/**
 * POST /api/google/calendar/events - creates a real event, e.g. when
 * scheduling a local task or tapping an empty slot in the Calendar tab.
 * Defaults to the primary calendar. Requires the calendar.events (write)
 * scope.
 * body: { title, start (ISO datetime), durationMinutes?, notes?, location?,
 *         calendarId? }
 */
async function handleCreateCalendarEvent(request, env, email) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title) return json({ error: "title is required" }, 400);
  if (typeof body.start !== "string") return json({ error: "start (ISO datetime) is required" }, 400);
  const startDate = new Date(body.start);
  if (Number.isNaN(startDate.getTime())) return json({ error: "invalid start" }, 400);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ status: tokenResult.error });

  const durationMinutes = Number.isFinite(body.durationMinutes) && body.durationMinutes > 0 ? body.durationMinutes : 30;
  const endDate = new Date(startDate.getTime() + durationMinutes * 60000);
  const calendarId = typeof body.calendarId === "string" && body.calendarId ? body.calendarId : "primary";

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${tokenResult.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: title,
        description: typeof body.notes === "string" ? body.notes : undefined,
        location: typeof body.location === "string" ? body.location : undefined,
        start: { dateTime: startDate.toISOString() },
        end: { dateTime: endDate.toISOString() },
      }),
    }
  );

  if (!res.ok) return await googleWriteFailure(res);
  const created = await res.json();
  return json({ status: "ok", eventId: created.id, calendarId, htmlLink: created.htmlLink || null });
}

/**
 * PATCH /api/google/calendar/events - edits an existing event in place.
 * Only the fields present in the body are sent on, so a rename doesn't
 * disturb the time and vice versa. `start` moves the event, keeping its
 * length unless `durationMinutes` says otherwise.
 * body: { calendarId, eventId, title?, start?, durationMinutes?, location?,
 *         notes? }
 */
async function handleUpdateCalendarEvent(request, env, email) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }

  const calendarId = typeof body.calendarId === "string" && body.calendarId ? body.calendarId : "primary";
  const eventId = typeof body.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId) return json({ error: "eventId is required" }, 400);

  const patch = {};
  if (typeof body.title === "string") {
    if (!body.title.trim()) return json({ error: "title cannot be blank" }, 400);
    patch.summary = body.title.trim();
  }
  if (typeof body.notes === "string") patch.description = body.notes;
  if (typeof body.location === "string") patch.location = body.location;
  if (typeof body.start === "string") {
    const startDate = new Date(body.start);
    if (Number.isNaN(startDate.getTime())) return json({ error: "invalid start" }, 400);
    const durationMinutes =
      Number.isFinite(body.durationMinutes) && body.durationMinutes > 0 ? body.durationMinutes : 30;
    patch.start = { dateTime: startDate.toISOString() };
    patch.end = { dateTime: new Date(startDate.getTime() + durationMinutes * 60000).toISOString() };
  }
  if (!Object.keys(patch).length) return json({ error: "nothing to update" }, 400);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ status: tokenResult.error });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokenResult.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    }
  );

  if (!res.ok) return await googleWriteFailure(res);
  const updated = await res.json();
  return json({ status: "ok", eventId: updated.id, calendarId, htmlLink: updated.htmlLink || null });
}

/**
 * PATCH /api/google/tasks - ticks a Google Task off, or puts it back.
 * body: { listId, taskId, completed: boolean }
 *
 * Needs the full `tasks` scope; a token issued when the app only asked for
 * tasks.readonly comes back as reconnect_required, exactly like the calendar
 * write paths.
 */
async function handleUpdateGoogleTask(request, env, email) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "invalid json" }, 400);
  }
  const listId = typeof body.listId === "string" ? body.listId.trim() : "";
  const taskId = typeof body.taskId === "string" ? body.taskId.trim() : "";
  if (!listId || !taskId) return json({ error: "listId and taskId are required" }, 400);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ status: tokenResult.error });

  /* Reopening a task must clear `completed` as well as the status - leaving
     the completion timestamp behind keeps it hidden in Google's own UI. */
  const patch = body.completed
    ? { status: "completed" }
    : { status: "needsAction", completed: null };

  const res = await fetch(
    `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(listId)}/tasks/${encodeURIComponent(taskId)}`,
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${tokenResult.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify(patch),
    }
  );
  if (!res.ok) return await googleWriteFailure(res);
  return json({ status: "ok" });
}

/**
 * DELETE /api/google/calendar/events?calendarId=&eventId= - removes an
 * event. Google answers 204 with no body on success, and 410 if it was
 * already gone, which is the same outcome from here.
 */
async function handleDeleteCalendarEvent(request, env, email) {
  const url = new URL(request.url);
  const calendarId = url.searchParams.get("calendarId") || "primary";
  const eventId = (url.searchParams.get("eventId") || "").trim();
  if (!eventId) return json({ error: "eventId is required" }, 400);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ status: tokenResult.error });

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
    { method: "DELETE", headers: { authorization: `Bearer ${tokenResult.accessToken}` } }
  );

  if (res.ok || res.status === 410) return json({ status: "ok" });
  return await googleWriteFailure(res);
}

/** Cron entry point. Runs hourly (see wrangler.jsonc) but only actually
 * does anything during the 7am hour in Europe/London - computed fresh via
 * Intl each run, so it self-adjusts across BST/GMT with no DST table to
 * maintain - and only once per day per user, via the daily_brief dedupe
 * check below. */
async function handleScheduled(env, now) {
  now = now || new Date();
  const londonHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: BRIEF_TIMEZONE, hour: "2-digit", hour12: false }).format(now)
  );
  if (londonHour !== 7) return;

  const { day } = localDayBounds(BRIEF_TIMEZONE, now);
  const { results } = await env.DB.prepare(`SELECT user_email FROM google_tokens`).all();
  for (const row of results) {
    const existing = await env.DB.prepare(
      `SELECT status FROM daily_brief WHERE user_email = ?1 AND day = ?2`
    ).bind(row.user_email, day).first();
    if (existing && existing.status === "ok") continue;
    await generateBrief(env, row.user_email, now);
  }
}

/* ---------- router ---------- */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (!url.pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }

    if (url.pathname === "/api/health") {
      return json({ ok: true, configured: Boolean(env.ACCESS_TEAM_DOMAIN && env.ACCESS_AUD) });
    }

    let email;
    try {
      email = await verifyAccess(request, env);
    } catch (e) {
      return json({ error: "unauthorized", reason: String(e.message || e) }, 401);
    }

    try {
      if (url.pathname === "/api/sync" && request.method === "POST") {
        return await handleSync(request, env, email);
      }
      if (url.pathname === "/api/stats" && request.method === "GET") {
        return await handleStats(env, email);
      }
      if (url.pathname === "/api/google/connect" && request.method === "GET") {
        return handleGoogleConnect(request, env);
      }
      if (url.pathname === "/api/google/callback" && request.method === "GET") {
        return await handleGoogleCallback(request, env, email);
      }
      if (url.pathname === "/api/settings/brief-prompt" && request.method === "GET") {
        return await handleGetBriefPrompt(env, email);
      }
      if (url.pathname === "/api/settings/brief-prompt" && request.method === "PUT") {
        return await handlePutBriefPrompt(request, env, email);
      }
      if (url.pathname === "/api/brief" && request.method === "GET") {
        return await handleGetBrief(env, email);
      }
      if (url.pathname === "/api/brief/refresh" && request.method === "POST") {
        return await handleRefreshBrief(env, email);
      }
      if (url.pathname === "/api/calendar/events" && request.method === "GET") {
        return await handleGetCalendarEvents(request, env, email);
      }
      if (url.pathname === "/api/google/calendar/events" && request.method === "POST") {
        return await handleCreateCalendarEvent(request, env, email);
      }
      if (url.pathname === "/api/google/calendar/events" && request.method === "PATCH") {
        return await handleUpdateCalendarEvent(request, env, email);
      }
      if (url.pathname === "/api/google/calendar/events" && request.method === "DELETE") {
        return await handleDeleteCalendarEvent(request, env, email);
      }
      if (url.pathname === "/api/google/tasks" && request.method === "PATCH") {
        return await handleUpdateGoogleTask(request, env, email);
      }
    } catch (e) {
      return json({ error: "server error", detail: String(e.message || e) }, 500);
    }

    return json({ error: "not found" }, 404);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(handleScheduled(env));
  },
};

// Named exports alongside the default: these are the same real functions
// the router above calls, exposed so tests can exercise them directly
// (with a mocked env.DB/fetch) without having to fabricate a signed
// Cloudflare Access JWT for every case - verifyAccess/handleSync's own
// coverage is unchanged and already covered separately.
export {
  localDayBounds,
  dayBoundsForDate,
  utcOffsetMinutes,
  getGoogleAccessToken,
  listCalendars,
  fetchEventsForRange,
  fetchTasks,
  fetchTasksInRange,
  generateBrief,
  handleGetBrief,
  handleRefreshBrief,
  handleGetBriefPrompt,
  handlePutBriefPrompt,
  DEFAULT_BRIEF_PROMPT,
  handleGetCalendarEvents,
  handleCreateCalendarEvent,
  handleUpdateCalendarEvent,
  handleDeleteCalendarEvent,
  handleUpdateGoogleTask,
  isDateOnlyDue,
  handleGoogleConnect,
  handleGoogleCallback,
  handleScheduled,
};
