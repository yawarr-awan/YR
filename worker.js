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
/* Tried in order when the one before it is overloaded. Google returns 503
   "This model is currently experiencing high demand" often enough that a
   single attempt is not a real attempt - it is the single most common reason
   a brief fails. The alias and the pinned model are different pools. */
const GEMINI_FALLBACK_MODELS = ["gemini-flash-latest", "gemini-2.5-flash", "gemini-flash-lite-latest"];
/* Overloaded, rate-limited or a transient server fault - worth trying again.
   Anything else (400 bad request, 403 bad key) will fail identically forever,
   so retrying it just delays the error. */
const GEMINI_RETRY_STATUS = [429, 500, 502, 503, 504];
const GEMINI_RETRY_DELAYS_MS = [700, 2500];

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

/** The day after a `YYYY-MM-DD`, done in UTC so no local DST shift can move
 * it. Date arithmetic on the string itself would break across month ends. */
function nextDay(day) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/** Which local calendar day something falls on in `timeZone`. An all-day
 * item already carries a bare date and is used as-is - parsing one as a Date
 * reads it as UTC midnight and can land on the wrong day. */
function localDayOf(timeZone, when) {
  const s = String(when || "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })
      .formatToParts(d).map((x) => [x.type, x.value])
  );
  return `${p.year}-${p.month}-${p.day}`;
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
async function fetchTasks(accessToken, day, tomorrow) {
  const out = { dueToday: [], dueTomorrow: [], overdue: [], undatedCount: 0, error: null };
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
        else if (tomorrow && dueDay === tomorrow) out.dueTomorrow.push(entry);
        /* Anything further out is beyond what the brief covers. */
      }
    }
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

/* How much journal the brief is allowed to see. Both caps exist to bound the
   Gemini prompt: a year of entries would be most of the request, and one very
   long entry could crowd out every other one. */
/* The journal reaches back as far as the budget allows rather than a fixed
   fortnight: an entry from two months ago is exactly the kind of thing worth
   being reminded of. Two caps, both needed for different reasons -
   JOURNAL_MAX_CHARS stops one enormous entry crowding out every other, and
   JOURNAL_TOTAL_CHARS bounds the prompt however long the record gets. Entries
   are taken newest-first, so the budget is always spent on the freshest. */
const JOURNAL_DAYS = 120;
const JOURNAL_MAX_CHARS = 900;
const JOURNAL_TOTAL_CHARS = 14000;

/** The user's journal - today's entry, then as far back as the budget goes.
 *
 * Read straight out of the synced `days` table rather than being posted up
 * by the browser, because the brief is generated by a cron with no browser
 * involved. The entry is the day record's `notes` field, which is the same
 * field the Journal tab writes, so nothing extra had to be stored.
 *
 * Like fetchTasks, this never throws: the journal enriches the brief, it is
 * not the brief. A failure is reported so "why did it ignore what I wrote?"
 * is answerable rather than looking the same as "you wrote nothing". */
async function fetchJournal(env, email, day, limit) {
  const out = { today: null, earlier: [], omitted: 0, oldest: null, error: null };
  const clip = (s) => (s.length > JOURNAL_MAX_CHARS ? s.slice(0, JOURNAL_MAX_CHARS) + "…" : s);
  const cap = limit || JOURNAL_DAYS;
  try {
    /* Filtered in SQL so the row budget is spent on days that actually have
       an entry - a run of logged-but-unwritten days would otherwise push
       every real entry out of the window. */
    const res = await env.DB.prepare(
      `SELECT day, data FROM days
        WHERE user_email = ?1 AND deleted = 0 AND day <= ?2
          AND COALESCE(TRIM(json_extract(data, '$.notes')), '') <> ''
        ORDER BY day DESC
        LIMIT ?3`
    ).bind(email, day, cap + 1).all();

    let budget = JOURNAL_TOTAL_CHARS;
    for (const row of res.results || []) {
      let notes = "";
      try { notes = String(JSON.parse(row.data || "{}").notes || "").trim(); } catch (e) { continue; }
      if (!notes) continue;
      const entry = { day: row.day, text: clip(notes) };
      /* Today's entry is never dropped for budget - it is the one the day is
         actually about. */
      if (row.day === day) { out.today = entry; budget -= entry.text.length; continue; }
      if (out.earlier.length >= cap || entry.text.length > budget) { out.omitted++; continue; }
      budget -= entry.text.length;
      out.earlier.push(entry);
      out.oldest = entry.day;
    }
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

/* A sanity backstop, not a window: five and a half years of daily records.
   The whole history is summarised, but it is summarised *here* - the prompt
   carries a fixed handful of figures however long the record gets, so the
   brief costs the same on day 2000 as on day 20. */
const HISTORY_MAX_ROWS = 2000;
const PRAYER_KEYS = [["fajr", "Fajr"], ["dhuhr", "Dhuhr"], ["asr", "Asr"], ["maghrib", "Maghrib"], ["isha", "Isha"]];
const SLEEP_TARGET_H = 7;
/* "Recently" for the trend-against-trend comparisons. Long enough to be a
   pattern rather than one bad night, short enough to still be news. */
const TREND_WINDOW = 7;

/** The day before `day`, as YYYY-MM-DD. UTC arithmetic, like nextDay, so no
 * DST shift can move it. */
function prevDay(day) {
  const d = new Date(day + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Every date from `from` to `to` inclusive. */
function dateRange(from, to) {
  const out = [];
  let d = from;
  while (d <= to && out.length < HISTORY_MAX_ROWS + 366) { out.push(d); d = nextDay(d); }
  return out;
}

const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
};
const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const kg = (n) => (n >= 0 ? "+" : "−") + Math.abs(n).toFixed(1) + "kg";

/** Turn the whole record into the handful of lines the brief actually needs.
 *
 * Everything here is computed, never asked of the model: an LLM given 400
 * raw days and told to work out an average will produce a plausible number
 * rather than the right one, and the figures have to match what the Progress
 * tab shows or the brief is contradicting the app. */
function summariseHistory(rows, profile, day) {
  const yesterday = prevDay(day);
  const byDay = new Map(rows.map((r) => [r.day, r]));
  const first = rows.length ? rows[0].day : null;
  if (!first || first > yesterday) return null;

  const lines = [];
  const past = dateRange(first, yesterday);
  lines.push(`Tracking since ${first} - ${past.length} day(s) of history, up to and including ${yesterday}.`);

  /* --- prayers ---
     Counted over the date *range*, not over the rows that happen to exist:
     a date with no record is five missed, not a day that never happened.
     This is the same rule prayerHistoryDays() uses on the client, and the
     two must agree or the brief contradicts the app's own summary. */
  const missedBy = {};
  let prayed = 0;
  PRAYER_KEYS.forEach(([k]) => { missedBy[k] = 0; });
  const recent = past.slice(-TREND_WINDOW);
  const isRecent = new Set(recent);
  let recentPrayed = 0;
  past.forEach((d) => {
    const p = byDay.get(d)?.prayers || {};
    PRAYER_KEYS.forEach(([k]) => {
      if (p[k]) { prayed++; if (isRecent.has(d)) recentPrayed++; } else missedBy[k]++;
    });
  });
  const total = past.length * PRAYER_KEYS.length;
  const worst = PRAYER_KEYS.slice().sort((a, b) => missedBy[b[0]] - missedBy[a[0]])[0];
  const pct = (n, of) => (of ? Math.round((n / of) * 100) : 0);
  lines.push(
    `Prayers: ${prayed} of ${total} prayed (${pct(prayed, total)}%). ` +
    `Last ${recent.length} day(s): ${recentPrayed} of ${recent.length * PRAYER_KEYS.length} ` +
    `(${pct(recentPrayed, recent.length * PRAYER_KEYS.length)}%). ` +
    (missedBy[worst[0]] ? `Most often missed: ${worst[1]} (${missedBy[worst[0]]} times).` : "None missed.")
  );
  const qada = profile.qada || {};
  const owed = PRAYER_KEYS
    .map(([k, label]) => [label, Math.max(0, missedBy[k] - (parseInt(qada[k], 10) || 0))])
    .filter(([, n]) => n > 0);
  if (owed.length) {
    lines.push(`Qada still owed after what has been made up: ${owed.map(([l, n]) => `${l} ${n}`).join(", ")}.`);
  }

  /* --- sleep --- only the nights with a number. An unlogged night is
     missing data, not zero hours - the same call the Progress chart makes. */
  const nights = past.map((d) => [d, num(byDay.get(d)?.sleep)]).filter(([, h]) => h !== null && h > 0 && h <= 24);
  if (nights.length >= 2) {
    const all = nights.map(([, h]) => h);
    const last = all.slice(-TREND_WINDOW);
    const short = last.filter((h) => h < SLEEP_TARGET_H).length;
    lines.push(
      `Sleep: ${avg(all).toFixed(1)}h average across ${all.length} logged night(s); ` +
      `${avg(last).toFixed(1)}h across the last ${last.length}. ` +
      `${short} of those ${last.length} were under ${SLEEP_TARGET_H}h. ` +
      `Nothing logged on ${past.length - all.length} of the ${past.length} day(s).`
    );
  } else if (nights.length) {
    lines.push(`Sleep: only one night logged (${nights[0][1]}h) - not enough for a pattern.`);
  } else {
    lines.push("Sleep: nothing logged at all.");
  }

  /* --- weight --- */
  const weights = past.map((d) => [d, num(byDay.get(d)?.weight)]).filter(([, w]) => w !== null && w > 0);
  const start = num(profile.startWeight);
  const target = num(profile.targetWeight);
  if (weights.length) {
    const [lastDay, latest] = weights[weights.length - 1];
    const bits = [`Weight: ${latest.toFixed(1)}kg on ${lastDay} (${weights.length} logged)`];
    if (start !== null) bits.push(`${kg(latest - start)} against a start of ${start.toFixed(1)}kg`);
    if (target !== null) {
      bits.push(latest > target ? `${(latest - target).toFixed(1)}kg still to go to ${target.toFixed(1)}kg`
                                : `already at or under the ${target.toFixed(1)}kg goal`);
    }
    /* Movement over the last month, which is what says whether it is going
       anywhere - the overall figure can look fine while nothing has shifted
       for weeks. */
    const monthStart = past.slice(-30)[0];
    const monthAgo = weights.filter(([d]) => d >= monthStart);
    if (monthAgo.length >= 2) bits.push(`${kg(latest - monthAgo[0][1])} across ${monthAgo.length} weigh-ins in the last ${Math.min(30, past.length)} days`);
    lines.push(bits.join("; ") + ".");
  } else if (start !== null && target !== null) {
    lines.push(`Weight: nothing logged. Start ${start.toFixed(1)}kg, goal ${target.toFixed(1)}kg.`);
  }

  /* --- movement --- */
  const moved = past.filter((d) => byDay.get(d)?.exercise).length;
  const movedRecent = recent.filter((d) => byDay.get(d)?.exercise).length;
  lines.push(`Exercise: done on ${moved} of ${past.length} day(s); ${movedRecent} of the last ${recent.length}.`);

  return lines.join("\n");
}

/** The whole record, reduced to figures. Never throws, for the same reason
 * fetchTasks and fetchJournal don't: it enriches the brief rather than being
 * it, and a brief with no trends still beats no brief. */
async function fetchTrends(env, email, day) {
  const out = { text: null, error: null };
  try {
    /* The fields are pulled out in SQL rather than shipping every day's full
       JSON blob back: a year of records is a few KB this way and hundreds of
       KB the other. */
    const [res, prof] = await Promise.all([
      env.DB.prepare(
        `SELECT day,
                json_extract(data,'$.weight')   AS weight,
                json_extract(data,'$.sleep')    AS sleep,
                json_extract(data,'$.exercise') AS exercise,
                json_extract(data,'$.prayers')  AS prayers
           FROM days
          WHERE user_email = ?1 AND deleted = 0 AND day <= ?2
          ORDER BY day
          LIMIT ?3`
      ).bind(email, day, HISTORY_MAX_ROWS).all(),
      env.DB.prepare(`SELECT data FROM profile WHERE user_email = ?1`).bind(email).first(),
    ]);
    const rows = (res.results || []).map((r) => {
      let prayers = {};
      try { prayers = r.prayers ? JSON.parse(r.prayers) : {}; } catch (e) { prayers = {}; }
      return { day: r.day, weight: r.weight, sleep: r.sleep, exercise: Boolean(r.exercise), prayers };
    });
    let profile = {};
    try { profile = prof && prof.data ? JSON.parse(prof.data) : {}; } catch (e) { profile = {}; }
    out.text = summariseHistory(rows, profile, day);
  } catch (e) {
    out.error = String(e.message || e);
  }
  return out;
}

const DEFAULT_BRIEF_PROMPT =
  "Open with a short paragraph - two or three sentences, prose, no heading and no bullets - " +
  "saying what to focus on today.\n\n" +
  "Build it from two things, in this order of priority:\n" +
  "1. What the writer told themselves to do, in JOURNAL. If they made a commitment, set " +
  "themselves a rule, or asked to be reminded of something, that belongs in the paragraph - " +
  "it is the closest thing to an instruction you will get. Honour any date they attached " +
  "to it: before that date say it is coming, on and after it say it applies today. Keep " +
  "carrying it until they write that it is done or abandoned.\n" +
  "2. What the record shows, in HISTORY. Name at most two things that are slipping and " +
  "quote the figure that shows it, and say one thing that is going well.\n\n" +
  "A commitment from the journal outranks a drifting figure: if you can only fit one, use " +
  "theirs. No greeting, no pep talk.\n\n" +
  "Then the schedule, and nothing else. Use exactly this shape:\n" +
  "Today\n" +
  "- 09:30 Standup [Work]\n" +
  "- 14:00 Donation collection [Family]\n" +
  "- Cancel Uber 1 (overdue)\n" +
  "\n" +
  "Tomorrow\n" +
  "- 11:00 Dentist\n" +
  "- All day Internet bill [My Tasks]\n\n" +
  "Rules:\n" +
  "- The opening paragraph is prose. Never bullet it and never give it a heading.\n" +
  "- Never invent, recompute, estimate or round a figure. Every number you give must appear " +
  "verbatim in HISTORY. This governs numbers only - a subject the writer raised in JOURNAL " +
  "is worth writing about whether or not HISTORY measures it.\n" +
  "- Never quote the journal back word for word, and never give it bullets of its own. " +
  "Draw on any entry, however old, not just the most recent - an intention from months ago " +
  "that never happened is worth more than yesterday's weather.\n" +
  "- If both HISTORY and JOURNAL are absent, skip the paragraph entirely and start at " +
  "\"Today\".\n" +
  "- One bullet per calendar event and per task. Never merge two into one line.\n" +
  "- Start each bullet with its time exactly as given, or \"All day\" if it has none.\n" +
  "- Then the name, then its calendar or task list in square brackets if one is given.\n" +
  "- Order each section by time; items with no time go last.\n" +
  "- Overdue tasks belong under Today, marked (overdue), and come first in that section.\n" +
  "- Always print both the Today and Tomorrow headings. If a section has nothing, its only " +
  "bullet is \"- Nothing scheduled\".\n" +
  "- Events that already finished today were removed on purpose; do not mention them.\n" +
  "- Cover every calendar and task list shown below, however short. Invent nothing.";

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

/* ---------- duas ----------
 *
 * Scans of du'as the user uploads and links to a dhikr item. They live in D1
 * rather than on the device because the link is stored on the synced profile,
 * so a phone that pulls the link has to be able to fetch the picture too.
 *
 * The bytes are held as a data: URL string, which is what the client already
 * has after downscaling on a canvas. D1 is not a blob store, hence the hard
 * ceiling below - the client resizes to well under it, and a file that still
 * comes in over is refused rather than truncated.
 */
const MAX_DUA_BYTES = 900000;
const DUA_MIME = /^image\/(png|jpeg|webp|gif)$/;

async function ensureDuaTable(env) {
  await env.DB.prepare(
    `CREATE TABLE IF NOT EXISTS dua_images (
       user_email TEXT NOT NULL,
       id TEXT NOT NULL,
       name TEXT,
       mime TEXT,
       data TEXT,
       created_at INTEGER,
       PRIMARY KEY (user_email, id)
     )`
  ).run();
}

async function handleListDuas(env, email) {
  await ensureDuaTable(env);
  const { results } = await env.DB.prepare(
    `SELECT id, name, created_at FROM dua_images WHERE user_email = ?1 ORDER BY created_at ASC`
  ).bind(email).all();
  return json({ duas: results || [] });
}

async function handleCreateDua(request, env, email) {
  let body;
  try { body = await request.json(); } catch { return json({ error: "invalid json" }, 400); }

  const dataUrl = typeof body.dataUrl === "string" ? body.dataUrl : "";
  const m = /^data:([^;,]+);base64,/.exec(dataUrl);
  if (!m || !DUA_MIME.test(m[1])) return json({ error: "expected a base64 image data URL" }, 400);
  if (dataUrl.length > MAX_DUA_BYTES) {
    return json({ error: "that image is too large even after resizing — try a smaller one" }, 413);
  }

  const name = (typeof body.name === "string" ? body.name.trim() : "").slice(0, 120) || "Du'a";
  const id = "d" + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const created = Date.now();
  await ensureDuaTable(env);
  await env.DB.prepare(
    `INSERT INTO dua_images (user_email, id, name, mime, data, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`
  ).bind(email, id, name, m[1], dataUrl, created).run();
  return json({ dua: { id, name, created_at: created } });
}

/* The image itself. Served as bytes rather than JSON so an <img src> can point
   straight at it, and marked private so only this browser's cache keeps it. */
async function handleGetDua(env, email, id) {
  await ensureDuaTable(env);
  const row = await env.DB.prepare(
    `SELECT mime, data FROM dua_images WHERE user_email = ?1 AND id = ?2`
  ).bind(email, id).first();
  if (!row) return json({ error: "not found" }, 404);

  const base64 = String(row.data).slice(String(row.data).indexOf(",") + 1);
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Response(bytes, {
    headers: {
      "content-type": row.mime || "image/jpeg",
      "cache-control": "private, max-age=86400",
    },
  });
}

async function handleDeleteDua(env, email, id) {
  await ensureDuaTable(env);
  await env.DB.prepare(`DELETE FROM dua_images WHERE user_email = ?1 AND id = ?2`).bind(email, id).run();
  return json({ ok: true });
}

/* Enough moving parts now that positional arguments stopped being readable -
   `ctx` carries the day, the two days' events, the tasks, the journal and the
   computed history. */
async function summarizeWithGemini(env, ctx) {
  if (!env.GEMINI_API_KEY) throw new Error("Gemini API key not configured");
  const { day, events, tasks, now, instructions, tomorrow, journal, trends } = ctx;

  const nowLabel = (now || new Date()).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: BRIEF_TIMEZONE });
  /* The weekday, so a journal line like "from Thursday onwards" can actually
     be resolved against today. Noon UTC is used to name the day because it is
     the same calendar date in every timezone the app is used from. */
  const weekday = (d) => new Date(d + "T12:00:00Z").toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });

  const eventBlock = (list, emptyText) => (list && list.length
    ? list.map((e) => {
        const when = e.allDay
          ? "All day"
          : new Date(e.start).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: BRIEF_TIMEZONE });
        const cal = e.calendar ? ` [${e.calendar}]` : "";
        return `- ${when}: ${e.title}${e.location ? ` (${e.location})` : ""}${cal}`;
      }).join("\n")
    : emptyText);

  const t = tasks || { dueToday: [], dueTomorrow: [], overdue: [], undatedCount: 0 };
  const taskBlock = (label, list, cap) => {
    if (!list || !list.length) return `${label}:\n(none)`;
    const shown = cap ? list.slice(0, cap) : list;
    const lines = shown.map((x) => `- ${x.title}${x.list ? ` [${x.list}]` : ""}`).join("\n");
    const more = list.length > shown.length ? `\n- (+${list.length - shown.length} more)` : "";
    return `${label}:\n${lines}${more}`;
  };

  /* The journal is appended last, and only when there is something in it -
     an empty "JOURNAL" heading is an invitation to invent one. */
  const j = journal || {};
  const journalBlock = (() => {
    const parts = [];
    if (j.today) parts.push(`Today (${j.today.day}):\n${j.today.text}`);
    (j.earlier || []).forEach((e) => parts.push(`${e.day}:\n${e.text}`));
    if (!parts.length) return "";
    /* Saying how far back this reaches is what lets the opener draw on
       something from months ago rather than treating it as only recent. */
    const span = j.oldest ? ` - every entry back to ${j.oldest}` : "";
    const more = j.omitted ? ` ${j.omitted} older entr(y/ies) are not shown.` : "";
    /* The header used to say "context only", which quietly contradicted the
       instruction above it to treat a commitment here as the first thing the
       paragraph is built from. */
    return `\n\nJOURNAL (the writer's own words${span} - what they commit to here is the point; never quote it back verbatim)${more}\n${parts.join("\n\n")}`;
  })();

  /* The computed record goes in ahead of the day's schedule: it is what the
     opening paragraph is judged against, and burying it under the events
     invites the model to write about today instead of about the trend. */
  const historyBlock = trends && trends.text
    ? `\nHISTORY (already computed from the full record - use these figures as given, never recompute one)\n${trends.text}\n`
    : "";

  const tm = tomorrow || {};
  const prompt =
    `${(instructions || DEFAULT_BRIEF_PROMPT)}\n\n` +
    `It is currently ${nowLabel} on ${weekday(day)} ${day}. Tomorrow is ${weekday(tm.day || nextDay(day))}.\n` +
    `${historyBlock}\n` +
    `TODAY (${day})\n` +
    `Remaining events:\n${eventBlock(events, "(No calendar events remaining today.)")}\n\n` +
    `${taskBlock("Tasks due today", t.dueToday)}\n\n` +
    `${taskBlock("Overdue tasks", t.overdue, 10)}\n\n` +
    `TOMORROW (${tm.day || nextDay(day)})\n` +
    `Events:\n${eventBlock(tm.events, "(No calendar events tomorrow.)")}\n\n` +
    `${taskBlock("Tasks due tomorrow", t.dueTomorrow)}` +
    (t.undatedCount ? `\n\n(${t.undatedCount} further task(s) have no due date and belong to neither day.)` : "") +
    journalBlock;

  return callGemini(env, prompt);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** One prompt to Gemini, retried through the transient failures.
 *
 * Google answers 503 "experiencing high demand" regularly, and its own
 * message says to try again later - so a single attempt was not really an
 * attempt at all, and it was by far the commonest reason a brief failed. Each
 * pass walks the model list, then waits and walks it again. A non-retryable
 * status (400, 403) fails immediately: it would fail the same way forever. */
async function callGemini(env, prompt, { models, delays } = {}) {
  const list = models || GEMINI_FALLBACK_MODELS;
  const waits = delays || GEMINI_RETRY_DELAYS_MS;
  const body = JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] });
  let last = null;

  for (let round = 0; round <= waits.length; round++) {
    if (round) await sleep(waits[round - 1]);
    for (const model of list) {
      let res;
      try {
        res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${env.GEMINI_API_KEY}`,
          { method: "POST", headers: { "content-type": "application/json" }, body }
        );
      } catch (e) {
        last = new Error(`gemini call failed: ${String(e.message || e)}`);
        continue;
      }
      if (res.ok) {
        const data = await res.json().catch(() => null);
        const text = ((data && data.candidates?.[0]?.content?.parts) || [])
          .map((p) => p.text || "").join("").trim();
        if (text) return text;
        /* An empty candidate is usually a safety block or a truncation, and
           another model may well answer - so it is retried like a 503 rather
           than thrown straight out. */
        last = new Error("gemini returned no text");
        continue;
      }
      const detail = await res.text().catch(() => "");
      const err = new Error(`gemini call failed: HTTP ${res.status} ${detail.slice(0, 200)}`);
      if (!GEMINI_RETRY_STATUS.includes(res.status)) throw err;
      last = err;
    }
  }
  throw last || new Error("gemini call failed");
}

/** Record a failure without destroying a brief that already worked.
 *
 * Both failure paths used to write summary = NULL, so hitting Refresh while
 * Gemini was busy replaced a perfectly good brief with an error card - the
 * refresh button was the thing most likely to lose you your brief. If today
 * already has a summary it is kept, the status stays "ok", and the reason is
 * recorded alongside it for the card to mention. */
const STALE_PREFIX = "couldn't refresh";
async function saveBriefFailure(env, email, day, status, detail) {
  let existing = null;
  try {
    existing = await env.DB.prepare(
      `SELECT summary, generated_at FROM daily_brief WHERE user_email = ?1 AND day = ?2`
    ).bind(email, day).first();
  } catch (e) { /* the write below is what matters; a failed read just means no rescue */ }

  if (existing && existing.summary) {
    const note = `${STALE_PREFIX} (${status}): ${detail}`;
    await env.DB.prepare(
      `UPDATE daily_brief SET error = ?3 WHERE user_email = ?1 AND day = ?2`
    ).bind(email, day, note).run();
    return {
      status: "ok", day, summary: existing.summary,
      generated_at: existing.generated_at, error: note, stale: true,
    };
  }
  await saveBriefStatus(env, email, day, status, null, detail);
  return { status, day, error: detail };
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

  /* The brief covers today and tomorrow, so both days are fetched in one
     range - listing the calendars twice for two consecutive days would be
     pure waste - and then split by their local date. */
  const tomorrowDay = nextDay(day);
  const { timeMax: tomorrowMax } = dayBoundsForDate(BRIEF_TIMEZONE, tomorrowDay);

  let events, tomorrowEvents;
  try {
    const calendars = await listCalendars(tokenResult.accessToken);
    const allEvents = await fetchEventsForRange(tokenResult.accessToken, calendars, timeMin, tomorrowMax);
    const todayAll = allEvents.filter((e) => localDayOf(BRIEF_TIMEZONE, e.start) === day);
    tomorrowEvents = allEvents.filter((e) => localDayOf(BRIEF_TIMEZONE, e.start) === tomorrowDay);
    // A refresh triggered mid-day should talk about what's left of today, not
    // re-describe meetings that already happened - drop anything whose end
    // time (or start, for events missing one) is already in the past.
    // Tomorrow is never filtered: none of it has happened yet.
    const nowMs = effectiveNow.getTime();
    events = todayAll.filter((e) => {
      const endMs = new Date(e.end || e.start).getTime();
      return !Number.isFinite(endMs) || endMs > nowMs;
    });
  } catch (e) {
    const detail = String(e.message || e);
    return await saveBriefFailure(env, email, day, "calendar_error", detail);
  }

  const tasks = await fetchTasks(tokenResult.accessToken, day, tomorrowDay);
  const [journal, trends] = await Promise.all([
    fetchJournal(env, email, day),
    fetchTrends(env, email, day),
  ]);

  let summary;
  try {
    summary = await summarizeWithGemini(env, {
      day, events, tasks, now: effectiveNow,
      instructions: await getBriefPrompt(env, email),
      tomorrow: { day: tomorrowDay, events: tomorrowEvents },
      journal, trends,
    });
  } catch (e) {
    const detail = String(e.message || e);
    return await saveBriefFailure(env, email, day, "gemini_error", detail);
  }

  const generatedAt = Date.now();
  /* A Tasks failure doesn't stop the brief, but it is recorded alongside the
     successful summary so "why are none of my tasks in here?" is answerable
     instead of looking identical to "you have no tasks". */
  const softError = [tasks.error, journal.error, trends.error].filter(Boolean).join(" · ") || null;
  await saveBriefStatus(env, email, day, "ok", summary, softError);
  return { status: "ok", day, summary, generated_at: generatedAt, error: softError };
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
    /* The brief is real but a later refresh of it failed, so the card can say
       "this is the earlier one" rather than either lying or losing it. */
    stale: String(briefRow?.error || "").startsWith(STALE_PREFIX),
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
    /* The list travels with the events so the editor can offer a choice of
       calendar. Deriving it from the events instead would hide any calendar
       that happens to have nothing on it that week - which is exactly when
       you are most likely to be adding something to it. */
    return json({ connected: true, status: "ok", day, end, events, calendars, tasks: taskResult.tasks, tasksError: taskResult.error });
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

  /* An all-day event is a different shape to Google, not a timed one with
     the clock ignored: `date` rather than `dateTime`, and an END THAT IS
     EXCLUSIVE - a single day runs to the following morning. Get that wrong
     by a day and the event shows on the wrong dates. The client sends the
     local date it means, because deriving one from an instant would land on
     the wrong side of midnight in some zones. */
  const allDay = body.allDay === true;
  let startDate = null;
  if (allDay) {
    if (!DAY_RE.test(String(body.day || ""))) return json({ error: "day (YYYY-MM-DD) is required for an all-day event" }, 400);
  } else {
    if (typeof body.start !== "string") return json({ error: "start (ISO datetime) is required" }, 400);
    startDate = new Date(body.start);
    if (Number.isNaN(startDate.getTime())) return json({ error: "invalid start" }, 400);
  }

  const tokenResult = await getGoogleAccessToken(env, email);
  if (tokenResult.error) return json({ status: tokenResult.error });

  const durationMinutes = Number.isFinite(body.durationMinutes) && body.durationMinutes > 0 ? body.durationMinutes : 30;
  const endDate = allDay ? null : new Date(startDate.getTime() + durationMinutes * 60000);
  const calendarId = typeof body.calendarId === "string" && body.calendarId ? body.calendarId : "primary";
  const when = allDay
    ? { start: { date: body.day }, end: { date: nextDay(body.day) } }
    : { start: { dateTime: startDate.toISOString() }, end: { dateTime: endDate.toISOString() } };

  const res = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`,
    {
      method: "POST",
      headers: { authorization: `Bearer ${tokenResult.accessToken}`, "content-type": "application/json" },
      body: JSON.stringify({
        summary: title,
        description: typeof body.notes === "string" ? body.notes : undefined,
        location: typeof body.location === "string" ? body.location : undefined,
        start: when.start,
        end: when.end,
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

/** Cron entry point. Fires at one minute past every hour (see
 * wrangler.jsonc) but only actually does anything during BRIEF_HOUR in
 * Europe/London - computed fresh via Intl each run, so it self-adjusts
 * across BST/GMT with no DST table to maintain. The cron itself cannot
 * express "00:01 London" because cron is evaluated in UTC and London is an
 * hour off it for half the year; firing hourly and checking the local hour
 * here is what makes the time hold all year. Deduped per user per day
 * against daily_brief below, so it stays a once-a-day brief. */
const BRIEF_HOUR = 0;                       /* midnight, Europe/London */
async function handleScheduled(env, now) {
  now = now || new Date();
  const londonHour = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: BRIEF_TIMEZONE, hour: "2-digit", hour12: false }).format(now)
  );
  if (londonHour !== BRIEF_HOUR) return;

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

/* ---------- prayer times ---------- */

/* The provider is UmmahAPI, with Aladhan as an automatic fallback. Two
 * things make that worth the indirection: prayer times matter enough that a
 * single provider outage should not leave the app blank, and going through
 * the Worker means the client never has to know which one answered.
 *
 * The normaliser below is deliberately shape-tolerant. UmmahAPI's exact
 * response body could not be inspected while this was written, so rather
 * than hard-coding a guess it searches the payload for an object that
 * carries the six prayer names and pulls the times out of that. When it
 * genuinely cannot find them it reports the payload's real keys, so the
 * shape can be fixed from one look at the error instead of a guessing game. */

const PRAYER_ALIASES = {
  Fajr: ["fajr", "fajir"],
  Sunrise: ["sunrise", "shurooq", "shuruq", "shuruk", "ishraq", "chasht"],
  Dhuhr: ["dhuhr", "zuhr", "duhr", "dhuhur", "zohr", "noon"],
  Asr: ["asr", "asar"],
  Maghrib: ["maghrib", "magrib", "maghreb"],
  Isha: ["isha", "ishaa", "esha"],
};
const PRAYER_ORDER = Object.keys(PRAYER_ALIASES);

const norm = (k) => String(k).toLowerCase().replace(/[^a-z]/g, "");

/** "HH:MM" in 24h, from whatever the provider used: a bare time, a time with
 * a suffix ("05:12 (BST)"), a 12-hour time, or an ISO timestamp. An ISO
 * string is read textually rather than through Date - parsing it would
 * convert to UTC and shift the time the provider meant. */
function toHHMM(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (!s) return null;

  const iso = s.match(/^\d{4}-\d{2}-\d{2}[T ](\d{2}):(\d{2})/);
  if (iso) return `${iso[1]}:${iso[2]}`;

  const m = s.match(/(\d{1,2}):(\d{2})/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = parseInt(m[2], 10);
  if (!Number.isFinite(h) || !Number.isFinite(min) || min > 59) return null;
  const ampm = s.match(/\b([ap])\.?m\.?\b/i);
  if (ampm) {
    const pm = ampm[1].toLowerCase() === "p";
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23) return null;
  return `${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`;
}

/** Pulls the six times out of one object, if it looks like it holds them. */
function timingsFromObject(obj) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const byNorm = {};
  for (const k of Object.keys(obj)) byNorm[norm(k)] = obj[k];

  const out = {};
  let found = 0;
  for (const name of PRAYER_ORDER) {
    for (const alias of PRAYER_ALIASES[name]) {
      if (byNorm[alias] === undefined) continue;
      const t = toHHMM(typeof byNorm[alias] === "object" ? (byNorm[alias].time ?? byNorm[alias].start) : byNorm[alias]);
      if (t) { out[name] = t; found++; }
      break;
    }
  }
  // Four of six is enough to call it a prayer-times object; anything less is
  // some other part of the payload that happens to mention a prayer.
  return found >= 4 ? out : null;
}

/** The timings for a single day entry: either the object itself, or one
 * level in (Aladhan wraps them as `{ timings: {...}, date: {...} }`). This is
 * deliberately NOT the recursive finder - run over a map of thirty days, that
 * would match the first day and collapse the month into one entry. */
const TIMINGS_CHILD_KEYS = ["timings", "times", "prayers", "salah", "prayertimes"];
function dayTimings(value) {
  const direct = timingsFromObject(value);
  if (direct) return direct;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  /* Only a child *named* like a timings block counts. Accepting any matching
     child would make a map of thirty dates look like a single day, since its
     first entry is itself a timings object. */
  for (const k of Object.keys(value)) {
    if (TIMINGS_CHILD_KEYS.indexOf(norm(k)) < 0) continue;
    const hit = timingsFromObject(value[k]);
    if (hit) return hit;
  }
  return null;
}

/** Depth-first search for the timings object, wherever the provider nested it. */
function findTimings(payload, depth = 0) {
  if (!payload || typeof payload !== "object" || depth > 6) return null;
  const direct = timingsFromObject(payload);
  if (direct) return direct;
  const values = Array.isArray(payload) ? payload : Object.values(payload);
  for (const v of values) {
    const hit = findTimings(v, depth + 1);
    if (hit) return hit;
  }
  return null;
}

/** What the payload actually contained, for an error worth reading. */
function describeShape(payload) {
  if (payload == null) return "empty body";
  if (typeof payload !== "object") return typeof payload;
  if (Array.isArray(payload)) return `array(${payload.length})`;
  const keys = Object.keys(payload).slice(0, 12);
  return `object keys: ${keys.join(", ") || "(none)"}`;
}

/** Coordinates from the query, or null. Number("") and Number(null) are both
 * 0, so a missing parameter would otherwise read as a valid 0,0. */
function readCoords(url) {
  const rawLat = url.searchParams.get("lat");
  const rawLng = url.searchParams.get("lng");
  if (rawLat === null || rawLng === null || rawLat === "" || rawLng === "") return null;
  const lat = Number(rawLat), lng = Number(rawLng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { accept: "application/json" } });
  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    throw new Error(`HTTP ${res.status} ${detail.slice(0, 160)}`);
  }
  return res.json();
}

/** Aladhan's `school` is the Asr rule: 0 standard, 1 Hanafi. Of the four
 * madhabs only Hanafi differs on Asr, so the other three all map to 0. */
function asrSchool(madhab) {
  return String(madhab || "").toLowerCase() === "hanafi" || String(madhab) === "1" ? 1 : 0;
}

/* UmmahAPI names its calculation methods; the client stores Aladhan's
 * numbers. Sending a number where a name is expected does NOT fail loudly -
 * the parameter is simply ignored and you silently get the provider's
 * default (Muslim World League). Since that happens to be Aladhan's method
 * 3, the default looked correct and every other method was quietly wrong.
 * That is why this table exists.
 *
 * The names are adhan-js's `CalculationMethod` keys, which is what UmmahAPI
 * is built on - confirmed from a real UmmahAPI-backed app showing
 * `MoonsightingCommittee` and `Shafi`/`Hanafi`, and from the differences it
 * produced: adhan gives MoonsightingCommittee a +5 min Dhuhr and +3 min
 * Maghrib adjustment against MuslimWorldLeague's +1 min Dhuhr, which is
 * exactly what two apps on those two methods disagreed by.
 *
 * The four Aladhan methods with no adhan equivalent - Jafari (0), Gulf
 * Region (8), France/UOIF (12) and Russia (14) - deliberately map to
 * nothing, and those requests skip UmmahAPI entirely for Aladhan, which
 * defined them. Falling back is a correct answer; asking UmmahAPI for a
 * method it doesn't know is a wrong one that looks right. */
const UMMAH_METHODS = {
  1: "Karachi",
  2: "NorthAmerica",          // ISNA
  3: "MuslimWorldLeague",
  4: "UmmAlQura",
  5: "Egyptian",
  7: "Tehran",
  9: "Kuwait",
  10: "Qatar",
  11: "Singapore",
  13: "Turkey",               // Diyanet
  15: "MoonsightingCommittee",
  16: "Dubai",
};
function ummahMethod(method) {
  if (method === null || method === undefined || method === "") return "MuslimWorldLeague";
  return UMMAH_METHODS[String(parseInt(method, 10))] || null;
}
/** True when the requested method has no UmmahAPI equivalent, so the whole
 * provider has to be skipped rather than asked the wrong question. */
function unsupportedByUmmah(method) {
  return ummahMethod(method) === null;
}
/** UmmahAPI spells the two Asr rules "Hanafi" and "Shafi". Our four madhabs
 * collapse to those two the same way asrSchool() collapses them for Aladhan. */
function ummahMadhab(madhab) {
  return asrSchool(madhab) === 1 ? "Hanafi" : "Shafi";
}

async function ummahDay({ lat, lng, method, madhab, timezone, highLatitudeRule, date }) {
  const named = ummahMethod(method);
  if (!named) throw new Error(`method ${method} has no UmmahAPI equivalent`);
  const params = new URLSearchParams({ lat: String(lat), lng: String(lng) });
  params.set("method", named);
  params.set("madhab", ummahMadhab(madhab));
  if (timezone) params.set("timezone", String(timezone));
  if (highLatitudeRule) params.set("highLatitudeRule", String(highLatitudeRule));
  if (date) params.set("date", String(date));
  const payload = await fetchJson(`https://ummahapi.com/api/prayer-times?${params}`);
  const timings = findTimings(payload);
  if (!timings) throw new Error(`unrecognised response (${describeShape(payload)})`);
  return timings;
}

async function aladhanDay({ lat, lng, method, madhab, day }) {
  const [y, m, d] = day.split("-");
  const params = new URLSearchParams({
    latitude: String(lat), longitude: String(lng),
    method: String(method || 3), school: String(asrSchool(madhab)),
  });
  const payload = await fetchJson(`https://api.aladhan.com/v1/timings/${d}-${m}-${y}?${params}`);
  const timings = findTimings(payload);
  if (!timings) throw new Error(`unrecognised response (${describeShape(payload)})`);
  return timings;
}

/**
 * GET /api/prayer?lat&lng[&method&madhab&timezone&highLatitudeRule&date]
 * -> { source, day, timings: {Fajr..Isha}, warning? }
 *
 * `warning` is set when the primary provider failed and the fallback
 * answered, so a silent downgrade is still visible.
 */
async function handlePrayerDay(request, env, now) {
  const url = new URL(request.url);
  const coords = readCoords(url);
  if (!coords) return json({ error: "lat and lng are required" }, 400);
  const { lat, lng } = coords;

  const timezone = url.searchParams.get("timezone") || BRIEF_TIMEZONE;
  const dateParam = url.searchParams.get("date");
  const day = dateParam && DAY_RE.test(dateParam) ? dateParam : localDayBounds(timezone, now || new Date()).day;
  const opts = {
    lat, lng, day, date: day, timezone,
    method: url.searchParams.get("method"),
    madhab: url.searchParams.get("madhab"),
    highLatitudeRule: url.searchParams.get("highLatitudeRule"),
  };

  let warning = null;
  try {
    /* `method` is echoed back under the name the provider actually used, so
       the app can show it and be compared against another app on the same
       method - the only way to tell two conventions apart at a glance. */
    return json({ source: "ummahapi", day, method: ummahMethod(opts.method), madhab: ummahMadhab(opts.madhab), timings: await ummahDay(opts) });
  } catch (e) {
    warning = `ummahapi: ${String(e.message || e)}`;
  }
  try {
    return json({ source: "aladhan", day, method: String(opts.method || 3), madhab: String(asrSchool(opts.madhab)), timings: await aladhanDay(opts), warning });
  } catch (e) {
    return json({ error: "prayer_unavailable", day, warning, detail: String(e.message || e) }, 502);
  }
}

/**
 * GET /api/prayer/month?lat&lng&month&year[&method&madhab]
 * -> { source, month, year, days: { "YYYY-MM-DD": {Fajr..Isha} }, warning? }
 *
 * One call for a whole month, which is what the calendar wants rather than
 * thirty separate day requests.
 */
async function handlePrayerMonth(request, env, now) {
  const url = new URL(request.url);
  const coords = readCoords(url);
  if (!coords) return json({ error: "lat and lng are required" }, 400);
  const { lat, lng } = coords;

  const today = localDayBounds(BRIEF_TIMEZONE, now || new Date()).day;
  const month = Number(url.searchParams.get("month")) || Number(today.slice(5, 7));
  const year = Number(url.searchParams.get("year")) || Number(today.slice(0, 4));
  const method = url.searchParams.get("method");
  const madhab = url.searchParams.get("madhab");
  const timezone = url.searchParams.get("timezone") || BRIEF_TIMEZONE;
  const mm = String(month).padStart(2, "0");

  /* Both providers key a month differently, so each result is folded into
     one date -> timings map and the client never sees the difference. */
  const collect = (payload) => {
    const days = {};
    const walk = (node, depth) => {
      if (!node || typeof node !== "object" || depth > 6) return;
      const list = Array.isArray(node) ? node : Object.entries(node);
      for (const item of list) {
        const [key, value] = Array.isArray(node) ? [null, item] : item;
        const timings = dayTimings(value);
        if (timings) {
          let d = null;
          if (key && DAY_RE.test(key)) d = key;
          else if (value && typeof value === "object") {
            const stamp = JSON.stringify(value).match(/(\d{4}-\d{2}-\d{2})/);
            const gregorian = value?.date?.gregorian?.date;      // Aladhan: DD-MM-YYYY
            if (gregorian && /^\d{2}-\d{2}-\d{4}$/.test(gregorian)) {
              const [dd, mo, yy] = gregorian.split("-");
              d = `${yy}-${mo}-${dd}`;
            } else if (stamp) d = stamp[1];
          }
          if (d) days[d] = timings;
          continue;
        }
        walk(value, depth + 1);
      }
    };
    walk(payload, 0);
    return days;
  };

  let warning = null;
  try {
    /* Same named-method rule as the day endpoint: a method UmmahAPI doesn't
       know must skip the provider, not be asked for under a wrong name. */
    const named = ummahMethod(method);
    if (!named) throw new Error(`method ${method} has no UmmahAPI equivalent`);
    const params = new URLSearchParams({ lat: String(lat), lng: String(lng), month: String(month), year: String(year) });
    params.set("method", named);
    params.set("madhab", ummahMadhab(madhab));
    /* Same timezone the day endpoint passes. Without it a month's times can
       disagree with the same day fetched on its own - and the client prefers
       the month cache, so the disagreement would be what it shows. */
    if (timezone) params.set("timezone", String(timezone));
    const payload = await fetchJson(`https://ummahapi.com/api/prayer-times/month?${params}`);
    const days = collect(payload);
    if (!Object.keys(days).length) throw new Error(`unrecognised response (${describeShape(payload)})`);
    return json({ source: "ummahapi", month, year, days });
  } catch (e) {
    warning = `ummahapi: ${String(e.message || e)}`;
  }
  try {
    const params = new URLSearchParams({
      latitude: String(lat), longitude: String(lng),
      method: String(method || 3), school: String(asrSchool(madhab)),
    });
    const payload = await fetchJson(`https://api.aladhan.com/v1/calendar/${year}/${month}?${params}`);
    const days = collect(payload);
    if (!Object.keys(days).length) throw new Error(`unrecognised response (${describeShape(payload)})`);
    return json({ source: "aladhan", month, year, days, warning, mm });
  } catch (e) {
    return json({ error: "prayer_unavailable", month, year, warning, detail: String(e.message || e) }, 502);
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
      if (url.pathname === "/api/duas" && request.method === "GET") {
        return await handleListDuas(env, email);
      }
      if (url.pathname === "/api/duas" && request.method === "POST") {
        return await handleCreateDua(request, env, email);
      }
      if (url.pathname.startsWith("/api/duas/")) {
        const duaId = decodeURIComponent(url.pathname.slice("/api/duas/".length));
        if (!duaId) return json({ error: "not found" }, 404);
        if (request.method === "GET") return await handleGetDua(env, email, duaId);
        if (request.method === "DELETE") return await handleDeleteDua(env, email, duaId);
      }
      if (url.pathname === "/api/brief" && request.method === "GET") {
        return await handleGetBrief(env, email);
      }
      if (url.pathname === "/api/brief/refresh" && request.method === "POST") {
        return await handleRefreshBrief(env, email);
      }
      if (url.pathname === "/api/prayer" && request.method === "GET") {
        return await handlePrayerDay(request, env);
      }
      if (url.pathname === "/api/prayer/month" && request.method === "GET") {
        return await handlePrayerMonth(request, env);
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
  nextDay,
  localDayOf,
  utcOffsetMinutes,
  getGoogleAccessToken,
  listCalendars,
  fetchEventsForRange,
  fetchTasks,
  fetchTasksInRange,
  fetchJournal,
  fetchTrends,
  summariseHistory,
  callGemini,
  generateBrief,
  handleGetBrief,
  handleRefreshBrief,
  handleGetBriefPrompt,
  handlePutBriefPrompt,
  handleListDuas,
  handleCreateDua,
  handleGetDua,
  handleDeleteDua,
  DEFAULT_BRIEF_PROMPT,
  handleGetCalendarEvents,
  handleCreateCalendarEvent,
  handleUpdateCalendarEvent,
  handleDeleteCalendarEvent,
  handleUpdateGoogleTask,
  handlePrayerDay,
  handlePrayerMonth,
  ummahMethod,
  ummahMadhab,
  toHHMM,
  findTimings,
  dayTimings,
  readCoords,
  asrSchool,
  isDateOnlyDue,
  handleGoogleConnect,
  handleGoogleCallback,
  handleScheduled,
};
