"use strict";
/*
 * AI plans (1.57.0): a prompt on the Misc tab's Meals, Recipes or Movement
 * card asks the Worker for a new plan (Gemini, JSON mode); the client
 * previews it, and only "Use this plan" puts it in force - as a synced
 * `plans` row, a version effective from today, so past days keep the plan
 * (and the calories) they had.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps, MAIN_KEY, SCHEMA } = require("./lib.js");
const { loadWorker } = require("./workerLib.js");
const { createFakeD1 } = require("./fakeD1.js");
after(closeAllApps);

const EMAIL = "yawar.awan@gmail.com";

function keyOf(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}
const todayKey = () => keyOf(new Date());
const yesterdayKey = () => { const d = new Date(); d.setDate(d.getDate() - 1); return keyOf(d); };

/* What the Worker returns after normalising - the client's input. */
const MEALS = {
  summary: "Vegetarian on weekdays, chicken at the weekend; about 1,050 kcal a day from meals.",
  days: Array.from({ length: 7 }, (_, i) => ({ breakfast: "oats", lunch: i < 5 ? "daal" : "chicken", dinner: "paneer" })),
  recipes: {
    oats: { title: "Spiced Oats", meal: "Breakfast", time: "10 min", kcal: 300, protein: 15, ing: ["40 g oats", "Cinnamon"], steps: ["Simmer the oats.", "Spice and serve."], note: "Warm and filling." },
    daal: { title: "Red Lentil Daal", meal: "Lunch", time: "20 min", kcal: 400, protein: 22, ing: ["Red lentils"], steps: ["Boil the lentils."], note: "Plant protein." },
    chicken: { title: "Chicken Tikka Salad", meal: "Lunch", time: "15 min", kcal: 420, protein: 40, ing: ["Chicken"], steps: ["Grill."], note: "Lean." },
    paneer: { title: "Paneer Bhurji", meal: "Dinner", time: "15 min", kcal: 350, protein: 25, ing: ["Paneer"], steps: ["Scramble."], note: "Quick." },
    chickpeas: { title: "Roasted Chickpeas", meal: "Snack", time: "25 min", kcal: 150, protein: 8, ing: ["Chickpeas"], steps: ["Roast."], note: "Crunchy." },
  },
};
const MOVE = {
  summary: "Longer walks and two swims.",
  week: ["walk", "swim", "walk", "stretch", "walk", "swim", "stretch"],
  exercises: {
    walk: { title: "Brisk Walk", time: "20 min", focus: "Cardio", steps: ["Walk briskly."], safety: "Stop if a joint hurts.", vid: "brisk walking" },
    swim: { title: "Easy Swim", time: "25 min", focus: "Joint-free cardio", steps: ["Swim gently."], safety: "Rest between lengths.", vid: "easy swimming" },
    stretch: { title: "Evening Stretch", time: "10 min", focus: "Flexibility", steps: ["Stretch."], safety: "Never to pain.", vid: "gentle stretch" },
  },
};

function jsonRes(body, status) {
  return { ok: (status || 200) < 300, status: status || 200, json: async () => body };
}
function aiApp(opts) {
  const o = opts || {};
  const calls = [];
  const app = loadApp(Object.assign({
    fetchImpl: async (url, init) => {
      const u = String(url);
      if (u.includes("/api/plan/generate")) {
        const body = JSON.parse(init.body);
        calls.push(body);
        if (o.reply) return o.reply(body);
        return jsonRes({ ok: true, kind: body.kind, plan: body.kind === "meals" ? MEALS : MOVE });
      }
      if (o.other) { const r = o.other(u, init); if (r) return r; }
      return jsonRes({ connected: false, status: "not_connected" });
    },
  }, o.load || {}));
  app.calls = calls;
  return app;
}
const $ = (app, sel) => app.document.querySelector(sel);
const text = (app, sel) => ($(app, sel) || { textContent: "" }).textContent;
function sub(app, name) {
  app.goTo("others");
  $(app, `#subTabs [data-sub="${name}"]`).click();
}
async function makePlan(app, spot, prompt) {
  $(app, `#${spot} [data-plan-ai]`).click();
  const ta = $(app, "#planAiPrompt");
  ta.value = prompt;
  ta.dispatchEvent(new app.window.Event("input", { bubbles: true }));
  $(app, "#planAiGo").click();
  await app.wait(20);
}
const plansIn = (app) => Object.values(JSON.parse(app.window.localStorage.getItem(MAIN_KEY)).plans || {});

/* ---------------- the client ---------------- */

test("Meals, Recipes and Movement each have an AI card", () => {
  const app = aiApp();
  const kinds = ["planAi", "recipesAi", "exAi"].map((id) => $(app, `#${id} [data-plan-ai]`).getAttribute("data-plan-ai"));
  assert.deepEqual(kinds, ["meals", "meals", "movement"], "Recipes drives the meal plan - its meals are made of them");
  assert.match(text(app, "#planAi"), /Make a new meal plan with AI/);
  assert.match(text(app, "#exAi"), /Make a new movement plan with AI/);
});

test("a meal plan from a prompt is previewed first, and only used when chosen", async () => {
  const app = aiApp();
  sub(app, "plan");
  const before = text(app, "#planBox");
  await makePlan(app, "planAi", "Vegetarian on weekdays");

  // What went to the Worker: the request, and the current plan in short.
  assert.equal(app.calls.length, 1);
  const sent = app.calls[0];
  assert.equal(sent.kind, "meals");
  assert.equal(sent.prompt, "Vegetarian on weekdays");
  assert.equal(sent.current.days.length, 7);
  assert.match(sent.current.days[0].breakfast, /kcal/);
  assert.equal(typeof sent.current.extrasKcal, "number");
  assert.ok(sent.current.targets, "with the weight targets");

  // The preview: a row per day, the summary, and nothing changed yet.
  assert.equal(app.document.querySelectorAll("#planAiOut .plan-ai-day").length, 7);
  assert.match(text(app, "#planAiOut"), /Vegetarian on weekdays, chicken at the weekend/);
  assert.match(text(app, "#planAiOut"), /Spiced Oats/);
  assert.equal(text(app, "#planBox"), before, "the dashboard is untouched until Use this plan");
  assert.equal(plansIn(app).length, 0);

  $(app, "#planAiUse").click();
  assert.equal($(app, "#overlay").classList.contains("open"), false, "the dialog closes");
  assert.match(text(app, "#planBox"), /Spiced Oats/);
  assert.match(text(app, "#planBox"), /Red Lentil Daal/);
  assert.equal($(app, "#planNote").hidden, true, "the built-in plan's description is put away");
  assert.match(text(app, "#planAi"), /Your AI meal plan/);
  assert.match(text(app, "#planAi"), /You asked: “Vegetarian on weekdays”/);

  const rows = plansIn(app);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, "meals");
  assert.equal(rows[0].from, todayKey());
  assert.ok(rows[0].updated_at > 0, "stamped, so it syncs");
  assert.match(app.statusText(), /in use from today/);
});

test("the new plan reaches Today and the recipe library", async () => {
  const app = aiApp();
  sub(app, "plan");
  await makePlan(app, "planAi", "Vegetarian on weekdays");
  $(app, "#planAiUse").click();

  app.goTo("today");
  assert.match(text(app, "#mealsBox"), /Spiced Oats/);
  assert.match(text(app, "#mealsBox"), /Paneer Bhurji/);

  sub(app, "recipes");
  assert.match(text(app, "#recipesBox"), /Red Lentil Daal/);
  assert.match(text(app, "#recipesBox"), /Optional light snacks[\s\S]*Roasted Chickpeas/);
  assert.equal($(app, "#recipesNote").hidden, true);
  // A recipe of the AI plan opens with its own ingredients and method.
  [...app.document.querySelectorAll("#recipesBox [data-recipe]")].find((b) => b.textContent === "Spiced Oats").click();
  assert.match(text(app, "#modalBody"), /40 g oats/);
  assert.match(text(app, "#modalBody"), /Simmer the oats/);
});

test("a past day keeps the meals - and the calories - it had", async () => {
  // Breakfast ticked yesterday and today, before any AI plan.
  const seed = { schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] },
    days: {}, sync: { enabled: false, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com" };
  [yesterdayKey(), todayKey()].forEach((k) => { seed.days[k] = { meals: { breakfast: true }, extras: {}, food: [], updated_at: 1 }; });
  const app = aiApp({ load: { localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) } } });
  $(app, "#prevDay").click();
  const oldBreakfast = text(app, "#mealsBox");
  const oldKcal = text(app, "#mealKcal");
  $(app, "#jumpToday").click();

  sub(app, "plan");
  await makePlan(app, "planAi", "Vegetarian on weekdays");
  $(app, "#planAiUse").click();

  app.goTo("today");
  assert.equal(text(app, "#mealKcal"), "· 300 kcal logged", "today's ticked breakfast is now the AI one");
  $(app, "#prevDay").click();
  assert.equal(text(app, "#mealsBox"), oldBreakfast, "yesterday still shows yesterday's meals");
  assert.equal(text(app, "#mealKcal"), oldKcal, "and adds up to what it did");
  assert.doesNotMatch(text(app, "#mealsBox"), /Spiced Oats/);
});

test("Back to the original puts the built-in plan back from today", async () => {
  const app = aiApp();
  sub(app, "plan");
  const original = text(app, "#planBox");
  await makePlan(app, "planAi", "Vegetarian on weekdays");
  $(app, "#planAiUse").click();
  app.window.confirm = () => true;
  [...app.document.querySelectorAll("#planAi button")].find((b) => /Back to the original/.test(b.textContent)).click();

  assert.equal(text(app, "#planBox"), original);
  assert.equal($(app, "#planNote").hidden, false);
  assert.match(text(app, "#planAi"), /Make a new meal plan with AI/);
  // The AI version chosen earlier today can never be used by any day now:
  // it is a tombstone, and carries no plan to ride every sync.
  const rows = plansIn(app);
  const ai = rows.find((r) => !r.builtin);
  assert.equal(ai.deleted, 1);
  assert.equal(ai.plan, undefined);
  assert.equal(rows.find((r) => r.builtin).from, todayKey());
});

test("a movement plan reaches the Today tab's movement card", async () => {
  const app = aiApp();
  sub(app, "exercises");
  await makePlan(app, "exAi", "Add swimming twice a week");
  assert.equal(app.calls[0].kind, "movement");
  assert.equal(app.calls[0].current.week.length, 7);
  $(app, "#planAiUse").click();

  const mon = (new Date().getDay() + 6) % 7;
  const title = MOVE.exercises[MOVE.week[mon]].title;
  assert.match(text(app, "#exercisesBox"), /Brisk Walk[\s\S]*Easy Swim[\s\S]*Evening Stretch/);
  const week = [...app.document.querySelectorAll("#exWeekBox tr")].map((r) => r.textContent);
  assert.equal(week.length, 7);
  assert.match(week[0], /^Monday.*Brisk Walk/, "Monday first");
  assert.match(week[1], /^Tuesday.*Easy Swim/);

  app.goTo("today");
  assert.match(text(app, "#moveBox"), new RegExp(title));
  $(app, "#moveBox [data-exercise]").click();
  assert.match(text(app, "#modalBody"), new RegExp(MOVE.exercises[MOVE.week[mon]].safety));
});

test("a failed request says why and changes nothing", async () => {
  const app = aiApp({ reply: () => jsonRes({ error: "gemini_error", detail: "503" }, 502) });
  sub(app, "plan");
  await makePlan(app, "planAi", "More protein");
  assert.match(text(app, "#planAiStatus"), /couldn't be reached/);
  assert.equal($(app, "#planAiUse"), null, "nothing to use");
  assert.equal(plansIn(app).length, 0);
});

test("asking with nothing written never calls the server", async () => {
  const app = aiApp();
  sub(app, "plan");
  await makePlan(app, "planAi", "   ");
  assert.equal(app.calls.length, 0);
  assert.match(text(app, "#planAiStatus"), /Say what you'd like/);
});

test("an AI plan made on another device arrives with a sync and redraws the tab", async () => {
  const row = { id: "pl_remote", kind: "meals", from: "2000-01-01", created: 1, prompt: "From the laptop", plan: MEALS };
  const seed = { schema: SCHEMA, profile: { startWeight: 108, targetWeight: 88, updated_at: 1, tasks: [] },
    days: {}, sync: { enabled: true, since: 0, lastSyncAt: null, lastError: null }, account: "me@example.com" };
  const app = aiApp({
    load: { localStorageSeed: { [MAIN_KEY]: JSON.stringify(seed) } },
    other: (u) => u.includes("/api/sync")
      ? jsonRes({ now: Date.now(), email: "me@example.com", days: {}, profile: null,
          plans: { pl_remote: { data: JSON.stringify(row), updated_at: 5, deleted: 0 } }, applied: 0, skipped: [] })
      : null,
  });
  await app.wait(50);
  sub(app, "plan");
  assert.match(text(app, "#planBox"), /Spiced Oats/);
  assert.match(text(app, "#planAi"), /You asked: “From the laptop”/);
});

/* ---------------- the Worker ---------------- */

function installFetch(t, impl) {
  const original = global.fetch;
  global.fetch = impl;
  t.after(() => { global.fetch = original; });
}
const geminiText = (s) => ({ ok: true, status: 200, json: async () => ({ candidates: [{ content: { parts: [{ text: s }] } }] }), text: async () => s });
const req = (body) => ({ json: async () => body });
const RAW_MEALS = {
  summary: "Lighter weekdays.",
  days: Array.from({ length: 7 }, () => ({ breakfast: "Oats Bowl!", lunch: "daal", dinner: "daal" })),
  recipes: {
    "Oats Bowl!": { title: "Oats", meal: "breakfast", time: "5 min", kcal: 99999, protein: -4, ing: ["oats"], steps: ["mix"], note: "ok", extra: "dropped" },
    daal: { title: "Daal", meal: "Dinner", kcal: 400, protein: 20, ingredients: ["lentils"], method: ["boil"] },
  },
};

test("normalizeMealPlan keeps only known fields, bounds them, and makes keys safe", async () => {
  const { normalizeMealPlan } = await loadWorker();
  const p = normalizeMealPlan(RAW_MEALS);
  assert.equal(p.days.length, 7);
  assert.deepEqual(Object.keys(p.recipes).sort(), ["daal", "oats_bowl"]);
  assert.equal(p.days[0].breakfast, "oats_bowl", "days follow the renamed key");
  assert.equal(p.recipes.oats_bowl.kcal, 2500, "clamped");
  assert.equal(p.recipes.oats_bowl.protein, 0);
  assert.equal(p.recipes.oats_bowl.meal, "Breakfast", "meal names are normalised");
  assert.equal(p.recipes.oats_bowl.extra, undefined);
  assert.deepEqual(p.recipes.daal.ing, ["lentils"], "ingredients/method accepted as synonyms");
  assert.deepEqual(p.recipes.daal.steps, ["boil"]);
});

test("normalizeMealPlan refuses a plan that points at a recipe it never defined, or misses a day", async () => {
  const { normalizeMealPlan } = await loadWorker();
  const dangling = JSON.parse(JSON.stringify(RAW_MEALS));
  dangling.days[3].lunch = "ghost";
  assert.equal(normalizeMealPlan(dangling), null);
  const short = JSON.parse(JSON.stringify(RAW_MEALS));
  short.days = short.days.slice(0, 6);
  assert.equal(normalizeMealPlan(short), null);
  assert.equal(normalizeMealPlan(null), null);
});

test("normalizeMovementPlan does the same for a week of sessions", async () => {
  const { normalizeMovementPlan } = await loadWorker();
  const raw = { summary: "s", week: ["a", "b", "a", "b", "a", "b", "a"],
    exercises: { a: { title: "A", time: "5 min", focus: "f", steps: ["x"], safety: "careful", vid: "v" }, b: { title: "B" } } };
  const p = normalizeMovementPlan(raw);
  assert.deepEqual(p.week, raw.week);
  assert.equal(p.exercises.b.time, "10 min", "a default where the model left one out");
  raw.week[6] = "nope";
  assert.equal(normalizeMovementPlan(raw), null);
});

test("parseJsonLoose reads a fenced or chatty reply", async () => {
  const { parseJsonLoose } = await loadWorker();
  assert.deepEqual(parseJsonLoose('```json\n{"a":1}\n```'), { a: 1 });
  assert.deepEqual(parseJsonLoose('Here you go: {"a":2} hope that helps'), { a: 2 });
  assert.equal(parseJsonLoose("no json here"), null);
});

test("POST /api/plan/generate asks Gemini in JSON mode with the request, the current plan and the rules", async (t) => {
  const { handleGeneratePlan } = await loadWorker();
  const { env } = createFakeD1();
  env.GEMINI_API_KEY = "k";
  let sent = null;
  installFetch(t, async (url, opts) => { sent = JSON.parse(opts.body); return geminiText(JSON.stringify(RAW_MEALS)); });
  const res = await handleGeneratePlan(req({ kind: "meals", prompt: "Vegetarian weekdays",
    current: { days: [{ breakfast: "Masala Omelette (280 kcal)", lunch: "x", dinner: "y" }], extrasKcal: 370,
      targets: { startWeight: 108, targetWeight: 88 } } }), env, EMAIL);
  const body = await res.json();
  assert.equal(res.status, 200);
  assert.equal(body.ok, true);
  assert.equal(body.plan.days.length, 7);
  assert.equal(sent.generationConfig.responseMimeType, "application/json");
  const prompt = sent.contents[0].parts[0].text;
  assert.match(prompt, /Vegetarian weekdays/);
  assert.match(prompt, /halal/);
  assert.match(prompt, /Monday: breakfast Masala Omelette \(280 kcal\)/);
  assert.match(prompt, /about 370 kcal/);
  assert.match(prompt, /aiming for 88 kg/);
});

test("the movement prompt keeps it joint-friendly", async (t) => {
  const { planPrompt } = await loadWorker();
  const p = planPrompt("movement", "more cardio", { week: ["Walk (10 min)"] });
  assert.match(p, /joint-friendly/);
  assert.match(p, /Monday: Walk \(10 min\)/);
  assert.match(p, /GP or physiotherapist/);
});

test("the brief's Gemini call is not put in JSON mode", async (t) => {
  const { callGemini } = await loadWorker();
  let sent = null;
  installFetch(t, async (url, opts) => { sent = JSON.parse(opts.body); return geminiText("prose"); });
  await callGemini({ GEMINI_API_KEY: "k" }, "hello", { delays: [] });
  assert.equal(sent.generationConfig, undefined);
});

test("/api/plan/generate turns away a bad request, a missing key and an unreadable answer", async (t) => {
  const { handleGeneratePlan } = await loadWorker();
  const { env } = createFakeD1();
  env.GEMINI_API_KEY = "";
  assert.equal((await handleGeneratePlan(req({ kind: "diet", prompt: "x" }), env, EMAIL)).status, 400);
  assert.equal((await handleGeneratePlan(req({ kind: "meals", prompt: "  " }), env, EMAIL)).status, 400);
  const nokey = await handleGeneratePlan(req({ kind: "meals", prompt: "x" }), env, EMAIL);
  assert.equal(nokey.status, 503);
  assert.equal((await nokey.json()).error, "not_configured");

  env.GEMINI_API_KEY = "k";
  installFetch(t, async () => geminiText("Sorry, I can't do that."));
  const garbled = await handleGeneratePlan(req({ kind: "meals", prompt: "x" }), env, EMAIL);
  assert.equal(garbled.status, 502);
  assert.equal((await garbled.json()).error, "unreadable");
});

test("a Gemini failure is reported as gemini_error", async (t) => {
  const { handleGeneratePlan } = await loadWorker();
  const { env } = createFakeD1();
  env.GEMINI_API_KEY = "bad";
  installFetch(t, async () => ({ ok: false, status: 403, json: async () => ({}), text: async () => "denied" }));
  const res = await handleGeneratePlan(req({ kind: "movement", prompt: "x" }), env, EMAIL);
  assert.equal(res.status, 502);
  assert.equal((await res.json()).error, "gemini_error");
});

test("plans sync as their own rows, with room for a whole plan that a task row would not get", async () => {
  const { handleSync, ITEM_TABLES } = await loadWorker();
  assert.ok(ITEM_TABLES.includes("plans"));
  const d1 = createFakeD1();
  const big = "x".repeat(30000);
  const now = Date.now();
  const res = await handleSync(req({ since: 0, days: {}, account: EMAIL,
    plans: { pl_a: { data: JSON.stringify({ id: "pl_a", pad: big }), updated_at: now, deleted: 0 } },
    tasks: { t_a: { data: JSON.stringify({ id: "t_a", pad: big }), updated_at: now, deleted: 0 } } }), d1.env, EMAIL);
  const body = await res.json();
  assert.ok(body.skipped.includes("tasks:t_a"), "a 30KB task is still refused");
  assert.ok(!body.skipped.includes("plans:pl_a"), "a 30KB plan is kept");
  assert.ok(body.plans && body.plans.pl_a, "and pulled back like any other row");
});

test("every synced table comes back down - notes included, which used to be pushed and never pulled", async () => {
  const { handleSync, ITEM_TABLES } = await loadWorker();
  const d1 = createFakeD1();
  const now = Date.now();
  const push = { since: 0, days: {}, account: EMAIL };
  ITEM_TABLES.forEach((t) => { push[t] = { [t + "_1"]: { data: JSON.stringify({ id: t + "_1" }), updated_at: now, deleted: 0 } }; });
  await handleSync(req(push), d1.env, EMAIL);
  const pulled = await (await handleSync(req({ since: 0, days: {}, account: EMAIL }), d1.env, EMAIL)).json();
  ITEM_TABLES.forEach((t) => assert.ok(pulled[t] && pulled[t][t + "_1"], t + " is pulled back"));
});

test("a plan belongs to the account that made it: another account never pulls it", async () => {
  /* Three people are on this dashboard. A plan is a row filed under the
     *verified* Access email (never anything the client claims), and a pull
     only ever returns the caller's own rows - so one person's new meal plan
     cannot reach anyone else's Meals tab. */
  const { handleSync } = await loadWorker();
  const d1 = createFakeD1();
  const now = Date.now();
  const row = (id, who) => ({ data: JSON.stringify({ id, kind: "meals", from: "2026-10-13", prompt: who, plan: {} }), updated_at: now, deleted: 0 });
  await handleSync(req({ since: 0, days: {}, account: EMAIL, plans: { pl_mine: row("pl_mine", "mine") } }), d1.env, EMAIL);
  await handleSync(req({ since: 0, days: {}, account: "wife@example.com", plans: { pl_hers: row("pl_hers", "hers") } }), d1.env, "wife@example.com");

  const mine = await (await handleSync(req({ since: 0, days: {}, account: EMAIL }), d1.env, EMAIL)).json();
  const hers = await (await handleSync(req({ since: 0, days: {}, account: "wife@example.com" }), d1.env, "wife@example.com")).json();
  const third = await (await handleSync(req({ since: 0, days: {}, account: "son@example.com" }), d1.env, "son@example.com")).json();
  assert.deepEqual(Object.keys(mine.plans), ["pl_mine"]);
  assert.deepEqual(Object.keys(hers.plans), ["pl_hers"]);
  assert.deepEqual(Object.keys(third.plans), [], "someone who has made no plan still has the built-in one");

  // A push claiming to be someone else is refused outright, as for every table.
  const forged = await handleSync(req({ since: 0, days: {}, account: "wife@example.com", plans: { pl_x: row("pl_x", "x") } }), d1.env, EMAIL);
  assert.equal(forged.status, 409);
});
