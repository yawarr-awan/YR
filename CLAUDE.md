# YR Wellness Dashboard — Project Context

## What this is
A personal, single-user wellness tracker. NOT related to AyahInk in any way.

- Repo: yawarr-awan/YR (public, personal GitHub account)
- Live app: https://yawarr-awan.github.io/YR/ (GitHub Pages — current source of truth)
- New backend: https://yr-wellness.yawar-awan.workers.dev (Cloudflare Worker, being brought online)

## Hard boundary — read this first
This project's infrastructure lives EXCLUSIVELY in the personal Cloudflare account
(Yawar.awan@gmail.com). It must NEVER touch the AyahInk Cloudflare account, which is
shared with a co-founder (Faisal). This is not a style preference — an earlier mistake
put this project's database in the AyahInk account by accident; it was caught, verified
empty, and deleted before any health data reached it. Do not repeat that. If anything
about a task implies AyahInk infrastructure, stop and ask.

## Architecture as it stands today

**index.html** — the entire frontend, one file, no build step, no dependencies.
- localStorage key: `yawarWellness_v1`, rolling backup: `yawarWellness_v1_bak`
- Durability hardening already in place: write verification via read-back, a
  corruption guard (`SAFE` flag that blocks writes if both the main key and the
  backup fail to parse, so a corrupt store is never silently overwritten with
  blank state), a visible "Saved HH:MM" tag, and `window.__YRdump()` as a console
  escape hatch. `schema: 1` field exists for future migrations.
- State shape: `{ schema, profile: {startWeight, targetWeight}, days: { "YYYY-MM-DD": {...} } }`
- **Not yet built**: any sync logic. The app is currently localStorage-only.

**worker.js** — Cloudflare Worker, deployed as `yr-wellness`.
- Serves the static app (via ASSETS binding) and handles `/api/*`
- `/api/health` — unauthenticated, returns `{ok, configured}`
- `/api/sync` (POST) and `/api/stats` (GET) — require a valid Cloudflare Access JWT
- JWT verification is done properly: RSA signature checked against Cloudflare's
  JWKS endpoint, plus `aud`, `iss`, `exp` checks. It does NOT trust the
  `Cf-Access-Authenticated-User-Email` header alone — that header is meaningless
  without signature verification, since the workers.dev URL could otherwise be
  hit directly bypassing Access.
- Sync logic is last-write-wins per day, keyed on a client-supplied `updated_at`.
  Delta pulls via a `since` timestamp. Bounded: 500 days per push, 1000 rows
  returned per pull, 20KB per day. All of this is tested against the live D1
  instance (stale writes rejected, newer writes applied, malformed input
  skipped without crashing).

**D1 database**: `yr-wellness-sync`, personal Cloudflare account, EU jurisdiction
(hard placement guarantee, not just a location hint — deliberate for health data).
Tables: `days(user_email, day, data, updated_at, deleted)`, `profile(user_email,
data, updated_at)`, `meta(k, v)`.

**wrangler.jsonc**: name `yr-wellness` (must match the Worker name in the
Cloudflare dashboard or Workers Builds fails), assets served from `./`, D1
binding `DB`. `ACCESS_TEAM_DOMAIN` and `ACCESS_AUD` are Worker **secrets**, not
vars — `wrangler deploy` overwrites dashboard-set vars from the config file on
every deploy, so anything in `vars` would get wiped. Secrets persist.

**Cloudflare Access**: team domain `yawar-awan`. Both the production
(`yr-wellness.yawar-awan.workers.dev`) and preview (`*-yr-wellness...`) URLs are
set to Restricted, each with its own AUD tag. Non-production branch builds are
disabled, since this is single-branch and previews add public surface with no
benefit.

**Deploys**: Workers Builds is connected to `yawarr-awan/YR`. Every push to
`main` auto-deploys. This is git-based now — no manual dashboard edits needed
for code changes.

## Testing requirement — non-negotiable
A prior session broke production for ~6 minutes by editing `index.html` and
testing the change with a harness that supplied a missing variable itself. The
test passed because it silently patched over the exact bug it should have
caught. The fix: **always test by executing the actual file in a real DOM
(jsdom), with nothing injected.** Any change to index.html needs to pass, at
minimum: fresh browser (no localStorage), existing good data, corrupt main key
with good backup, BOTH corrupt (must not wipe data, must show an error, must
leave raw storage untouched), and storage writes blocked (quota/private mode).

## Git workflow
Commit to a feature branch and open a PR for review. Do not push directly to
`main`. This project's only copy of real historical data is the localStorage on
Yawar's phone and laptop (exported backups exist on both) — a broken direct
commit to `main` is a worse failure mode here than in most projects, because
`main` is what auto-deploys.

## Known external issue
Claude Code's web repo picker has an open upstream bug where personal-account
GitHub repos don't index correctly (org repos work fine) —
anthropics/claude-code #57161, #18467, #27155, #57396, #60637. If a session
can't see this repo in the web picker, that's this bug, not a permissions
problem. The CLI run locally works around it since it uses git directly.

## Immediate next task: client-side sync layer
Not yet built. Needs:
- Every day's record gets `updated_at` on modification
- A one-time migration stamping existing days that predate this
- On load (only if the user has opted in — see next point), POST to `/api/sync`
  with `{since, days, profile}`, merge the response using true last-write-wins:
  a server day only overwrites a local day if its `updated_at` is newer
- An opt-in toggle in the Progress tab. Sync stays off until enabled — do not
  auto-enable it, and do not sync anything from the workers.dev origin until
  this exists, since that origin's localStorage is currently empty and syncing
  it now would create a second, divergent history against the real data on
  Yawar's devices
- Full jsdom test coverage per the testing requirement above, including: first
  sync from empty, conflicting edits arriving from two "devices," and the
  server being unreachable
- Branch + PR, not main

## Current data state
Yawar has full history in localStorage on his phone and laptop, both exported
as backup files. The workers.dev deployment is empty. Do not treat these as
the same dataset.

## Honest caveat
This file was written from a separate session's memory of the work, not
re-verified against the live repo at the moment of writing. Before acting on
it, read worker.js and wrangler.jsonc directly and confirm they match what's
described here.
