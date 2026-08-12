"use strict";
/*
 * Du'as: pictures the user uploads in Misc → Duas and links to a dhikr item.
 * The picture lives behind /api/duas (the link rides the synced profile, so a
 * second device has to be able to fetch what the link points at); the link
 * itself is profile.duaLinks["<period>|<item key>"].
 *
 * Real index.html in a real DOM, with only the network boundary mocked.
 */
const test = require("node:test");
const { after } = require("node:test");
const assert = require("node:assert/strict");
const { loadApp, closeAllApps } = require("./lib.js");
after(closeAllApps);

function jsonRes(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

/* One dua on the server, plus the idle brief every load asks for. */
function backend(duas = [], opts = {}) {
  const posted = [];
  const deleted = [];
  const impl = async (url, init) => {
    const u = String(url);
    if (u.startsWith("/api/duas") && init && init.method === "POST") {
      const body = JSON.parse(init.body);
      posted.push(body);
      if (opts.rejectUpload) return jsonRes({ error: "that image is too large" }, 413);
      const dua = { id: "d" + (duas.length + 1), name: body.name || "Du'a", created_at: Date.now() };
      duas.push(dua);
      return jsonRes({ dua });
    }
    if (u.startsWith("/api/duas/") && init && init.method === "DELETE") {
      const id = u.slice("/api/duas/".length);
      deleted.push(id);
      const at = duas.findIndex((d) => d.id === id);
      if (at >= 0) duas.splice(at, 1);
      return jsonRes({ ok: true });
    }
    if (u === "/api/duas") {
      if (opts.listFails) return jsonRes({ error: "nope" }, 500);
      return jsonRes({ duas: duas.slice() });
    }
    return jsonRes({ connected: false, status: "not_connected" });
  };
  impl.posted = posted;
  impl.deleted = deleted;
  return impl;
}

async function openDuas(app) {
  app.goTo("others");
  app.document.querySelector('[data-sub="duas"]').click();
  await app.flush();
  await app.flush();
}

function duaCards(app) {
  return Array.from(app.document.querySelectorAll("#duasBox .dua-card"));
}

/* The picker is folded by default - 21 dhikr rows under every picture buries
 * the pictures - so a test that links something has to open it first. */
function openPicker(app, index = 0) {
  // Idempotent: the toggle is a toggle, and a re-render keeps the picker
  // open, so clicking again would close it.
  if (!duaCards(app)[index].querySelector(".dua-links")) {
    duaCards(app)[index].querySelector(".dua-linktoggle").click();
  }
  return duaCards(app)[index].querySelector(".dua-links");
}
function togglePicker(app, index = 0) {
  duaCards(app)[index].querySelector(".dua-linktoggle").click();
}
function linkFirstItem(app) {
  const cb = openPicker(app).querySelector("input[type=checkbox]");
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
}

test("Duas is a sub-tab of Misc and lists what the server holds", async () => {
  const app = loadApp({ fetchImpl: backend([{ id: "d1", name: "Morning du'a", created_at: 1 }]) });
  await openDuas(app);

  assert.equal(app.document.querySelector(".subview.active").id, "sub-duas");
  const cards = duaCards(app);
  assert.equal(cards.length, 1);
  assert.match(cards[0].textContent, /Morning du'a/);
  assert.equal(cards[0].querySelector("img.dua-thumb").getAttribute("src"), "/api/duas/d1",
    "the picture is fetched from the server, not carried in the list");
});

test("with nothing uploaded it says so rather than showing an empty box", async () => {
  const app = loadApp({ fetchImpl: backend([]) });
  await openDuas(app);
  assert.match(app.document.getElementById("duasBox").textContent, /Nothing here yet/i);
});

test("a server that won't answer is reported, and does not leave it loading forever", async () => {
  const app = loadApp({ fetchImpl: backend([], { listFails: true }) });
  await openDuas(app);
  assert.doesNotMatch(app.document.getElementById("duasBox").textContent, /Loading/);
  assert.match(app.document.getElementById("duaStatus").textContent, /couldn't load/i);
});

test("linking a du'a to a dhikr item stores it on the synced profile", async () => {
  const app = loadApp({ fetchImpl: backend([{ id: "d1", name: "Morning du'a", created_at: 1 }]) });
  await openDuas(app);

  const before = (app.state() && app.state().profile.updated_at) || 0;
  assert.equal(duaCards(app)[0].querySelector(".dua-links"), null, "the picker starts folded");
  const box = openPicker(app);
  const first = box.querySelector("input[type=checkbox]");
  assert.ok(first, "every dhikr item is offered as a link target");
  first.checked = true;
  first.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  const links = app.state().profile.duaLinks;
  const keys = Object.keys(links);
  assert.equal(keys.length, 1);
  assert.equal(links[keys[0]], "d1");
  assert.match(keys[0], /^morning\|/, "keyed by period and the item's key, not its label");
  assert.ok(app.state().profile.updated_at >= before, "a link must stamp the profile or it never syncs");
});

test("a linked dhikr item grows a button that opens the picture", async () => {
  const app = loadApp({ fetchImpl: backend([{ id: "d1", name: "Morning du'a", created_at: 1 }]) });
  await openDuas(app);
  linkFirstItem(app);

  app.goTo("prayers");
  const opener = app.document.querySelector("#dhikrBox .dua-open");
  assert.ok(opener, "the linked item offers a way in");
  assert.ok(opener.classList.contains("linklike"), "it reads as a link, like a recipe or an exercise");
  assert.equal(opener.textContent, opener.closest(".chk").querySelector(".lbl").textContent,
    "the item's own name is the link - there is no extra icon beside it");

  opener.dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.ok(app.document.getElementById("overlay").classList.contains("open"), "it opens the modal");
  assert.equal(app.document.querySelector("#modalBody img.dua-full").getAttribute("src"), "/api/duas/d1");
});

test("opening the du'a does not also tick the dhikr item off", async () => {
  const app = loadApp({ fetchImpl: backend([{ id: "d1", name: "Morning du'a", created_at: 1 }]) });
  await openDuas(app);
  linkFirstItem(app);

  app.goTo("prayers");
  const row = app.document.querySelector("#dhikrBox .chk");
  row.querySelector(".dua-open").dispatchEvent(new app.window.MouseEvent("click", { bubbles: true, cancelable: true }));
  assert.equal(row.querySelector("input[type=checkbox]").checked, false,
    "the row is a label wrapping the checkbox, so the button has to stop the click");
});

test("an unlinked dhikr item has no opener", async () => {
  const app = loadApp({ fetchImpl: backend([]) });
  app.goTo("prayers");
  assert.equal(app.document.querySelector("#dhikrBox .dua-open"), null);
});

test("removing a du'a also removes every link pointing at it", async () => {
  const impl = backend([{ id: "d1", name: "Morning du'a", created_at: 1 }]);
  const app = loadApp({ fetchImpl: impl });
  await openDuas(app);
  linkFirstItem(app);
  assert.equal(Object.keys(app.state().profile.duaLinks).length, 1);

  Array.from(duaCards(app)[0].querySelectorAll("button"))
    .find((b) => /remove/i.test(b.textContent)).click();
  await app.flush();
  await app.flush();

  assert.deepEqual(impl.deleted, ["d1"]);
  assert.deepEqual(app.state().profile.duaLinks, {}, "a link to a deleted picture would open nothing");
  assert.equal(app.document.querySelector("#dhikrBox .dua-open"), null);
});

test("uploading sends a resized data URL, and a refusal is reported", async () => {
  const impl = backend([], { rejectUpload: true });
  const app = loadApp({ fetchImpl: impl });
  await openDuas(app);

  // jsdom has no real file picker; this is the shape the change event leaves.
  const file = new app.window.File(["x"], "Ayat al-Kursi.png", { type: "image/png" });
  Object.defineProperty(app.document.getElementById("duaFile"), "files", { value: [file], configurable: true });
  app.click("duaAddBtn");
  await app.flush();
  await app.flush();
  await app.flush();

  assert.equal(impl.posted.length, 1, "one upload attempt");
  assert.equal(impl.posted[0].name, "Ayat al-Kursi", "the extension is not part of the name");
  assert.match(impl.posted[0].dataUrl, /^data:image\//);
  assert.match(app.document.getElementById("duaStatus").textContent, /couldn't add it/i);
});

test("the picker's summary line says what it is linked to without opening it", async () => {
  const app = loadApp({ fetchImpl: backend([{ id: "d1", name: "Morning du'a", created_at: 1 }]) });
  await openDuas(app);

  const toggle = () => duaCards(app)[0].querySelector(".dua-linktoggle");
  assert.match(toggle().textContent, /not linked/i);

  linkFirstItem(app);
  assert.match(toggle().textContent, /Linked to Morning · /,
    "the summary names the item, so the answer is visible while it is folded");
});

test("only one picker is open at a time, and it folds again", async () => {
  const app = loadApp({
    fetchImpl: backend([{ id: "d1", name: "One", created_at: 1 }, { id: "d2", name: "Two", created_at: 2 }]),
  });
  await openDuas(app);

  togglePicker(app, 0);
  assert.ok(duaCards(app)[0].querySelector(".dua-links"));
  assert.equal(duaCards(app)[1].querySelector(".dua-links"), null);

  togglePicker(app, 1);
  assert.equal(duaCards(app)[0].querySelector(".dua-links"), null, "opening one closes the other");
  assert.ok(duaCards(app)[1].querySelector(".dua-links"));

  togglePicker(app, 1);
  assert.equal(duaCards(app)[1].querySelector(".dua-links"), null, "and tapping it again folds it");
});

test("a freshly uploaded du'a opens its picker, since linking is the point", async () => {
  const impl = backend([]);
  const app = loadApp({ fetchImpl: impl });
  await openDuas(app);

  const file = new app.window.File(["x"], "Ayat al-Kursi.png", { type: "image/png" });
  Object.defineProperty(app.document.getElementById("duaFile"), "files", { value: [file], configurable: true });
  app.click("duaAddBtn");
  await app.flush();
  await app.flush();
  await app.flush();

  assert.equal(duaCards(app).length, 1);
  assert.ok(duaCards(app)[0].querySelector(".dua-links"), "the new card is open on its picker");
});

test("an item linked to one du'a disappears from every other du'a's list", async () => {
  const app = loadApp({
    fetchImpl: backend([{ id: "d1", name: "One", created_at: 1 }, { id: "d2", name: "Two", created_at: 2 }]),
  });
  await openDuas(app);

  const labels = (i) => Array.from(openPicker(app, i).querySelectorAll(".lbl")).map((n) => n.textContent);
  const before = labels(0);
  const first = before[0];

  const cb = duaCards(app)[0].querySelector(".dua-links input[type=checkbox]");
  cb.checked = true;
  cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));

  assert.deepEqual(labels(1), before.slice(1),
    "the taken item is gone from the other picture's list, and nothing else moved");
  assert.ok(labels(0).includes(first),
    "but it is still on its own picture, so the link can be released again");
});

test("unlinking puts the item back in everyone else's list", async () => {
  const app = loadApp({
    fetchImpl: backend([{ id: "d1", name: "One", created_at: 1 }, { id: "d2", name: "Two", created_at: 2 }]),
  });
  await openDuas(app);
  const all = Array.from(openPicker(app, 0).querySelectorAll(".lbl")).map((n) => n.textContent);

  const tick = (i, checked) => {
    const cb = openPicker(app, i).querySelector("input[type=checkbox]");
    cb.checked = checked;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  };

  tick(0, true);
  tick(0, false);

  const after = Array.from(openPicker(app, 1).querySelectorAll(".lbl")).map((n) => n.textContent);
  assert.deepEqual(after, all, "released, it is offered everywhere again");
});

test("with every item spoken for, the list says so instead of being blank", async () => {
  const app = loadApp({ fetchImpl: backend([{ id: "d1", name: "One", created_at: 1 }, { id: "d2", name: "Two", created_at: 2 }]) });
  await openDuas(app);

  // Hand d1 every dhikr item there is.
  const picker = openPicker(app, 0);
  const count = picker.querySelectorAll("input[type=checkbox]").length;
  for (let i = 0; i < count; i++) {
    const cb = duaCards(app)[0].querySelector(".dua-links input[type=checkbox]:not(:checked)");
    if (!cb) break;
    cb.checked = true;
    cb.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  }

  const other = openPicker(app, 1);
  assert.equal(other.querySelectorAll("input[type=checkbox]").length, 0);
  assert.match(other.textContent, /already has a du'a/i);
});
