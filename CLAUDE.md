# YR Wellness Dashboard — Project Context

## What this is
A personal, single-user wellness tracker. NOT related to AyahInk in any way.

- Repo: yawarr-awan/YR (public, personal GitHub account)
- Live app: https://yr-wellness.yawar-awan.workers.dev (Cloudflare Worker + D1, gated by
  Cloudflare Access restricted to one email) — this is now the canonical, private
  deployment and current source of truth.
- Retired: https://yawarr-awan.github.io/YR/ (GitHub Pages). It was the source of truth
  before the Worker went live, but static hosting has no server-side way to require
  sign-in, so it could never actually be made private. GitHub Pages has been disabled
  for this repo.

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
Commit to a feature branch and open a PR — still do this for every change, so
there's always a reviewable diff and a clean revert point. Do not push
directly to `main`. This project's only copy of real historical data is the
localStorage on Yawar's phone and laptop (exported backups exist on both) — a
broken direct commit to `main` is a worse failure mode here than in most
projects, because `main` is what auto-deploys.

**Merging (as of 2026-08-09, per Yawar):** once tests pass, merge the PR
directly — don't stop to ask for merge approval on each one. Report what
shipped after the fact instead. This applies to routine merges for work
Yawar asked for. It does NOT extend to genuinely risky or ambiguous calls —
e.g. anything touching the Cloudflare account/Access config, anything that
could affect the AyahInk boundary, or a change you're not confident is
correct — those still get flagged before acting, same as always.

## Known external issue
Claude Code's web repo picker has an open upstream bug where personal-account
GitHub repos don't index correctly (org repos work fine) —
anthropics/claude-code #57161, #18467, #27155, #57396, #60637. If a session
can't see this repo in the web picker, that's this bug, not a permissions
problem. The CLI run locally works around it since it uses git directly.

## Client-side sync layer — built (PR #1, merged)
Every day's record and the profile get `updated_at` on modification. A
one-time schema 1 → 2 migration stamps pre-existing days/profile and persists
immediately (not just in memory) so a corrupt-main-key recovery or a stale
migration can't silently sit unsaved. An opt-in "Enable cloud sync" toggle
lives in the Progress tab (off by default, never auto-enabled); when on, it
POSTs to `/api/sync` with `{since, days, profile}` and merges the response
with true last-write-wins. A failed/unreachable/erroring sync never touches
local state. Test coverage lives in `test/` (`npm test`, jsdom, real DOM,
nothing injected) — see CHANGELOG 1.2.0 for the full scenario list.

## Access + hosting — settled
`yr-wellness.yawar-awan.workers.dev` is the canonical, private deployment:
Cloudflare Access (team domain `yawar-awan`) restricts it to one email,
covering the whole site (static assets + `/api/*`), confirmed via the
Access application's "Manage policy" screen. The old public GitHub Pages
copy (`yawarr-awan.github.io/YR/`) has been retired and disabled, since
static hosting has no server-side way to require sign-in.

## Current data state
Yawar's full history (32 days + profile, as of the first real sync) has been
pushed from his primary device into D1 (`yr-wellness-sync`, EU jurisdiction)
via the sync toggle. Verified directly against the database: schema intact
(`days`/`profile`/`meta` tables), row counts match, `user_email` matches his
sign-in address. Any other device should enable sync too so it pulls this
same history down before it accumulates independent local-only entries.

## Honest caveat
The "Client-side sync layer," "Access + hosting," and "Current data state"
sections above were re-verified live in this session (2026-08-09): read
worker.js/wrangler.jsonc directly, confirmed the deployed Worker code matches
the repo byte-for-byte, queried the D1 schema and row counts directly, and
checked the Access application's policy screen. Everything above that point
matched. Earlier sections of this file predate that verification pass — if
something here seems off, re-check the live repo/dashboard/D1 before trusting
it, the same way this pass did.
