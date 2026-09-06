"use strict";
/*
 * The verse of the day, and the workflow reaching the daily brief.
 *
 * The rule the ayah feature is built around: **the model never supplies the
 * verse.** Arabic and translation are fetched from a canonical source and
 * handed to Gemini as fixed text it may only comment on. A misquoted Qur'an
 * is not a rounding error, so a failed fetch is an error state - never a
 * generated verse. These tests hold that line.
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const { createFakeD1 } = require("./fakeD1.js");

const worker = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "worker.js"), "utf8");
const load = () => import("data:text/javascript;base64," + Buffer.from(worker).toString("base64"));

const EMAIL = "yawar@example.com";
const GEMINI_OK = { candidates: [{ content: { parts: [{ text: "A reflection about the day." }] } }] };

/* createFakeD1 hands back a ready-made env with realistic secrets. */
const env = (d1) => d1.env;
/** Routes by URL so a test can fail one source and not another. */
function router(routes) {
  return async (url) => {
    const u = String(url);
    for (const [pattern, res] of routes) {
      if (u.includes(pattern)) return typeof res === "function" ? res(u) : res;
    }
    throw new Error("unexpected fetch " + u);
  };
}
const ok = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
const alquranOk = (u) => ok({ data: [
  { text: "فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا", edition: { language: "ar", identifier: "quran-uthmani" },
    surah: { englishName: "Ash-Sharh" } },
  { text: "For indeed, with hardship [will be] ease.", edition: { language: "en", identifier: "en.sahih" } },
] });

/* ---------------- which verse, and how it is addressed ---------------- */

test("the rotation is a curated list of references, not a random ayah", async () => {
  const { AYAH_REFS, ayahRefForDay } = await load();
  assert.ok(AYAH_REFS.length >= 20, "enough for a rotation of several weeks");
  AYAH_REFS.forEach((r) => assert.match(r, /^\d+:\d+(-\d+)?$/, r + " is a reference"));
  // A verse pulled at random out of 6236 is routinely a fragment mid-narrative,
  // which is not something to hand someone as a morning reflection.
  assert.equal(new Set(AYAH_REFS).size, AYAH_REFS.length, "and no duplicates");
});

test("a day gets three different verses, the same three every time", async () => {
  const { ayahRefsForDay, AYAH_PER_DAY } = await load();
  const a = ayahRefsForDay("2026-09-06");
  assert.equal(a.length, AYAH_PER_DAY);
  assert.equal(new Set(a).size, a.length, "a day never repeats itself");
  assert.deepEqual(ayahRefsForDay("2026-09-06"), a, "stable within a day");
  assert.notDeepEqual(ayahRefsForDay("2026-09-07"), a);
});

test("consecutive days do not overlap, and the list is walked in turn", async () => {
  const { ayahRefsForDay, AYAH_REFS, AYAH_PER_DAY } = await load();
  const seen = [];
  // Whole days only: the list need not divide evenly by three.
  for (let i = 0; i < Math.floor(AYAH_REFS.length / AYAH_PER_DAY); i++) {
    const d = new Date(Date.UTC(2026, 8, 6 + i)).toISOString().slice(0, 10);
    seen.push(...ayahRefsForDay(d));
  }
  assert.equal(new Set(seen).size, seen.length, "a full turn repeats nothing");
});

test("a range expands to its ayahs, and nonsense expands to nothing", async () => {
  const { expandRef } = await load();
  assert.deepEqual(expandRef("94:5-6"), [{ surah: 94, ayah: 5 }, { surah: 94, ayah: 6 }]);
  assert.deepEqual(expandRef("2:255"), [{ surah: 2, ayah: 255 }]);
  assert.deepEqual(expandRef("not a ref"), []);
});

/* ---------------- fetching the text ---------------- */

test("the verse comes from a canonical source, with a second one behind it", async () => {
  const { fetchAyahText } = await load();
  global.fetch = router([["api.alquran.cloud", alquranOk]]);
  const a = await fetchAyahText("94:5");
  assert.match(a.arabic, /ٱلْعُسْرِ/);
  assert.match(a.translation, /with hardship/);
  assert.match(a.source, /alquran\.cloud/);

  // First source down: the second answers rather than the card going blank.
  global.fetch = router([
    ["api.alquran.cloud", { ok: false, status: 503, json: async () => ({}) }],
    ["api.quran.com", ok({ verse: { text_uthmani: "فَإِنَّ مَعَ ٱلْعُسْرِ يُسْرًا",
      translations: [{ text: "For indeed, with hardship [will be] ease.<sup>1</sup>" }] } })],
  ]);
  const b = await fetchAyahText("94:5");
  assert.match(b.source, /quran\.com/);
  assert.doesNotMatch(b.translation, /<sup>/, "footnote markup is stripped, not shown");
});

test("both sources failing is an error, never an invented verse", async () => {
  // This is the whole point of the feature's design.
  const { fetchAyahText } = await load();
  global.fetch = router([
    ["api.alquran.cloud", { ok: false, status: 500, json: async () => ({}) }],
    ["api.quran.com", { ok: false, status: 500, json: async () => ({}) }],
  ]);
  await assert.rejects(() => fetchAyahText("94:5"), /alquran\.cloud.*quran\.com/s,
    "and it says which sources it tried");
});

/* ---------------- generating, and what is asked of the model ---------------- */

test("the model is given the verse and told never to reproduce it", async () => {
  const db = createFakeD1();
  const prompts = [];
  global.fetch = router([
    ["api.alquran.cloud", alquranOk],
    ["generativelanguage.googleapis.com", (u) => ok(GEMINI_OK)],
  ]);
  const realFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("generativelanguage")) {
      prompts.push(JSON.parse(opts.body).contents[0].parts[0].text);
    }
    return realFetch(url, opts);
  };

  const { generateAyah } = await load();
  const r = await generateAyah(env(db), EMAIL, new Date("2026-09-06T09:00:00Z"));
  assert.equal(r.status, "ok");

  assert.equal(prompts.length, 3, "one reflection per verse");
  const p = prompts[0];
  assert.match(p, /Do NOT reproduce, re-translate, extend, correct or paraphrase/);
  assert.match(p, /do NOT quote or refer to any hadith/i,
    "no canonical hadith text is available to it, so it must not produce any");
  assert.match(p, /not a scholar/i, "reflection, not tafsir and not a ruling");
  assert.match(p, /For indeed, with hardship/, "the verse is given to it as fixed text");
});

test("the verse and the reflection are stored, with the source named", async () => {
  const db = createFakeD1();
  global.fetch = router([
    ["api.alquran.cloud", alquranOk],
    ["generativelanguage.googleapis.com", ok(GEMINI_OK)],
  ]);
  const { generateAyah, handleGetAyah } = await load();
  await generateAyah(env(db), EMAIL, new Date("2026-09-06T09:00:00Z"));

  const res = await handleGetAyah(env(db), EMAIL, new Date("2026-09-06T09:00:00Z"));
  const body = await res.json();
  assert.equal(body.status, "ok");
  assert.equal(body.items.length, 3);
  body.items.forEach((it) => {
    assert.match(it.arabic, /ٱلْعُسْرِ/);
    assert.match(it.translation, /with hardship/);
    assert.equal(it.reflection, "A reflection about the day.");
    assert.match(it.source, /alquran\.cloud/, "so the card can say where the text came from");
  });
  assert.equal(body.error, null);
});

test("a failed reflection keeps the verse; a failed verse keeps nothing", async () => {
  // The reflection is enrichment. The verse is the thing itself.
  const { generateAyah } = await load();

  let db = createFakeD1();
  global.fetch = router([
    ["api.alquran.cloud", alquranOk],
    ["generativelanguage.googleapis.com", { ok: false, status: 403, json: async () => ({}), text: async () => "no" }],
  ]);
  let r = await generateAyah(env(db), EMAIL, new Date("2026-09-06T09:00:00Z"));
  assert.equal(r.status, "ok", "the verses still stand");
  assert.equal(r.items.length, 3);
  assert.match(r.items[0].arabic, /ٱلْعُسْرِ/);
  assert.equal(r.items[0].reflection, null);
  assert.match(r.error, /reflection/, "and why they have none is recorded");

  db = createFakeD1();
  global.fetch = router([
    ["api.alquran.cloud", { ok: false, status: 500, json: async () => ({}) }],
    ["api.quran.com", { ok: false, status: 500, json: async () => ({}) }],
  ]);
  r = await generateAyah(env(db), EMAIL, new Date("2026-09-06T09:00:00Z"));
  assert.equal(r.status, "verse_error");
  assert.deepEqual(r.items, [], "nothing was substituted for the text");
});

test("today's verse is read back rather than regenerated", async () => {
  const db = createFakeD1();
  let calls = 0;
  global.fetch = router([
    ["api.alquran.cloud", (u) => { calls++; return alquranOk(u); }],
    ["generativelanguage.googleapis.com", ok(GEMINI_OK)],
  ]);
  const { generateAyah, handleGetAyah } = await load();
  const now = new Date("2026-09-06T09:00:00Z");
  await generateAyah(env(db), EMAIL, now);
  await handleGetAyah(env(db), EMAIL, now);
  await handleGetAyah(env(db), EMAIL, now);
  assert.equal(calls, 3, "one fetch per verse, and reading the card costs none");
});

test("a day with nothing prepared reads as pending, not as an error", async () => {
  const db = createFakeD1();
  const { handleGetAyah } = await load();
  const body = await (await handleGetAyah(env(db), EMAIL, new Date("2026-09-06T09:00:00Z"))).json();
  assert.equal(body.status, "pending");
  assert.deepEqual(body.items, []);
});

/* ---------------- the workflow, in the brief ---------------- */

function seedTask(db, id, t) {
  db.seedItem("tasks", EMAIL, id, Object.assign(
    { id, projectId: "p1", title: "Task " + id, done: false }, t));
}

test("the workflow is read straight from D1, so the cron needs no browser", async () => {
  const db = createFakeD1();
  db.seedItem("projects", EMAIL, "p1", { id: "p1", name: "House move" });
  seedTask(db, "t1", { title: "Chase surveyor", start: "2026-09-01", end: "2026-09-04" });   // overdue
  seedTask(db, "t2", { title: "Book the van", start: "2026-09-05", end: "2026-09-09" });     // running
  seedTask(db, "t3", { title: "Cancel broadband", start: "2026-09-09", end: "2026-09-11" }); // soon
  seedTask(db, "t4", { title: "Someday", start: null, end: null });                          // unplotted
  seedTask(db, "t5", { title: "Done thing", start: "2026-09-01", end: "2026-09-02", done: true });

  const { fetchWorkflow } = await load();
  const wf = await fetchWorkflow(env(db), EMAIL, "2026-09-06");
  assert.equal(wf.error, null);
  assert.match(wf.text, /Overdue[\s\S]*Chase surveyor \(House move\)/);
  assert.match(wf.text, /Running today[\s\S]*Book the van/);
  assert.match(wf.text, /Starting within 7 days[\s\S]*Cancel broadband/);
  assert.match(wf.text, /1 open task\(s\) are not on the timeline/);
  assert.doesNotMatch(wf.text, /Done thing/, "finished work is not still running");
});

test("an empty timeline says so rather than sending an empty section", async () => {
  const db = createFakeD1();
  const { fetchWorkflow } = await load();
  const wf = await fetchWorkflow(env(db), EMAIL, "2026-09-06");
  assert.match(wf.text, /Nothing is on the timeline/);
});

test("a workflow read failure never throws, and is reported beside the brief", async () => {
  // Same call fetchTasks and fetchJournal make: it enriches the brief, it is
  // not the brief.
  const db = createFakeD1();
  db.env.DB.prepare = () => { throw new Error("db is down"); };
  const { fetchWorkflow } = await load();
  const wf = await fetchWorkflow(env(db), EMAIL, "2026-09-06");
  assert.equal(wf.text, null);
  assert.match(wf.error, /workflow: .*db is down/);
});

test("the brief's prompt carries a WORKFLOW section and a rule for it", async () => {
  const { DEFAULT_BRIEF_PROMPT } = await load();
  assert.match(DEFAULT_BRIEF_PROMPT, /WORKFLOW\. Anything overdue there is worth a sentence/);
  assert.match(DEFAULT_BRIEF_PROMPT, /Talk about the work, not about the tool/);
});
