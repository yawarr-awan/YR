/**
 * YR Wellness Tracker - Worker
 *
 * Serves the static app and a small sync API backed by D1.
 * Every /api/* request must carry a valid Cloudflare Access JWT.
 *
 * Required vars (set in the Cloudflare dashboard, not secrets - neither is sensitive):
 *   ACCESS_TEAM_DOMAIN  e.g. "yawar" for https://yawar.cloudflareaccess.com
 *   ACCESS_AUD          the Application Audience tag from the Access app
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
    } catch (e) {
      return json({ error: "server error", detail: String(e.message || e) }, 500);
    }

    return json({ error: "not found" }, 404);
  },
};
