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
  "https://www.googleapis.com/auth/tasks.readonly", // Google Tasks, for the brief only
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
  const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader", {
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
  }));
}

/** Events across every given calendar, tagged with their source
 * calendar's name/color so the UI can tell them apart. One unreachable
 * calendar (revoked share, deleted, etc.) is skipped rather than failing
 * the whole fetch - better to show the rest than nothing. */
async function fetchEventsForRange(accessToken, calendars, timeMin, timeMax) {
  const all = [];
  for (const cal of calendars) {
    const params = new URLSearchParams({ timeMin, timeMax, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
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
        title: e.summary || "(no title)",
        start: e.start?.dateTime || e.start?.date,
        end: e.end?.dateTime || e.end?.date,
        allDay: !e.start?.dateTime,
        location: e.location || null,
        calendar: cal.name,
        color: cal.color,
      });
    }
  }
  all.sort((a, b) => new Date(a.start) - new Date(b.start));
  return all;
}

/** Today's not-yet-completed Google Tasks, across every task list. Tasks
 * are a bonus enrichment for the brief, never its critical path - any
 * failure here (not connected with the tasks scope yet, API hiccup,
 * network error) returns an empty list rather than breaking the brief. */
async function fetchTodayTasks(accessToken, day) {
  try {
    const listsRes = await fetch("https://tasks.googleapis.com/tasks/v1/users/@me/lists", {
      headers: { authorization: `Bearer ${accessToken}` },
    });
    if (!listsRes.ok) return [];
    const listsData = await listsRes.json();

    const tasks = [];
    for (const list of listsData.items || []) {
      const params = new URLSearchParams({
        showCompleted: "false",
        dueMin: `${day}T00:00:00Z`,
        dueMax: `${day}T23:59:59Z`,
      });
      const res = await fetch(
        `https://tasks.googleapis.com/tasks/v1/lists/${encodeURIComponent(list.id)}/tasks?${params}`,
        { headers: { authorization: `Bearer ${accessToken}` } }
      );
      if (!res.ok) continue;
      const data = await res.json();
      for (const t of data.items || []) {
        if (t.status === "completed") continue;
        tasks.push({ title: t.title || "(untitled task)", due: t.due || null, list: list.title || null });
      }
    }
    return tasks;
  } catch {
    return [];
  }
}

async function summarizeWithGemini(env, day, events, tasks, now) {
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

  const taskLines = tasks && tasks.length
    ? tasks.map((t) => `- ${t.title}${t.list ? ` [${t.list}]` : ""}`).join("\n")
    : "(No tasks still due today.)";

  const prompt =
    `You are a concise personal daily-briefing assistant. It is currently ` +
    `${nowLabel} on ${day}. The events and tasks below are only what's ` +
    `still remaining today - anything already finished has been left out ` +
    `on purpose, so do not imply the day is just starting. Given this ` +
    `remaining schedule (events span all of the person's calendars, ` +
    `including shared/family ones - the bracketed tag names the source ` +
    `calendar), write a short, friendly summary (3-5 sentences max) of ` +
    `what's left: any tight back-to-back meetings, free stretches, and ` +
    `anything still due. Do not open with a time-of-day greeting like ` +
    `"Good morning" or "Good evening" - go straight into the summary. Do ` +
    `not invent events or tasks not listed. Plain text, no markdown.\n\n` +
    `Remaining events today:\n${eventLines}\n\nTasks still due today:\n${taskLines}`;

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

  const tasks = await fetchTodayTasks(tokenResult.accessToken, day);

  let summary;
  try {
    summary = await summarizeWithGemini(env, day, events, tasks, effectiveNow);
  } catch (e) {
    const detail = String(e.message || e);
    await saveBriefStatus(env, email, day, "gemini_error", null, detail);
    return { status: "gemini_error", day, error: detail };
  }

  const generatedAt = Date.now();
  await saveBriefStatus(env, email, day, "ok", summary, null);
  return { status: "ok", day, summary, generated_at: generatedAt };
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

/**
 * GET /api/calendar/events?date=YYYY-MM-DD - raw (non-summarized) events
 * across every calendar the user can read, for the Calendar tab's day
 * agenda view. Defaults to today (Europe/London) if `date` is missing or
 * malformed.
 */
async function handleGetCalendarEvents(request, env, email, now) {
  const url = new URL(request.url);
  const dateParam = url.searchParams.get("date");
  const day = dateParam && DAY_RE.test(dateParam) ? dateParam : localDayBounds(BRIEF_TIMEZONE, now || new Date()).day;
  const { timeMin, timeMax } = dayBoundsForDate(BRIEF_TIMEZONE, day);

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ connected: false, status: tokenResult.error, day, events: [] });

  try {
    const calendars = await listCalendars(tokenResult.accessToken);
    const events = await fetchEventsForRange(tokenResult.accessToken, calendars, timeMin, timeMax);
    return json({ connected: true, status: "ok", day, events });
  } catch (e) {
    return json({ connected: true, status: "calendar_error", day, events: [], error: String(e.message || e) });
  }
}

/**
 * POST /api/google/calendar/events - creates a real event on the user's
 * primary calendar, e.g. when scheduling a local task. Requires the
 * calendar.events (write) scope; a token granted only the older
 * read-only scope surfaces as reconnect_required, not a generic error.
 * body: { title, start (ISO datetime), durationMinutes?, notes? }
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

  const res = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
    method: "POST",
    headers: { authorization: `Bearer ${tokenResult.accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      summary: title,
      description: typeof body.notes === "string" ? body.notes : undefined,
      start: { dateTime: startDate.toISOString() },
      end: { dateTime: endDate.toISOString() },
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    // An old read-only-scope token (pre-reconnect) can't create events -
    // Google surfaces that as 403 insufficientPermissions. Map it to
    // reconnect_required so the UI can prompt exactly that.
    if (res.status === 403 && /insufficient/i.test(detail)) {
      return json({ status: "reconnect_required" });
    }
    return json({ status: "error", error: `HTTP ${res.status} ${detail.slice(0, 200)}` });
  }
  const created = await res.json();
  return json({ status: "ok", eventId: created.id, htmlLink: created.htmlLink || null });
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
  fetchTodayTasks,
  generateBrief,
  handleGetBrief,
  handleRefreshBrief,
  handleGetCalendarEvents,
  handleCreateCalendarEvent,
  handleGoogleConnect,
  handleGoogleCallback,
  handleScheduled,
};
