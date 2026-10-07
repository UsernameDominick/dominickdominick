// Simulations (/simulations): the admin's circuit builder as a page of the site, for every visitor (built on public/app-kit.js). The
// opening screen is a shelf of the visitor's own circuits (kept in this browser, never sent to the site): New circuit, Open a circuit
// file, and a card per circuit (a little picture of its parts and wires, open, Copy, Delete). The builder opens in place under the
// site's nav; Circuits goes back to the shelf, saving first.
(function () {
  "use strict";
  if (!window.SiteAppKit || window.siteInitSimulations) return;
  window.siteInitSimulations = true;
  const K = window.SiteAppKit;
  const $ = (id) => document.getElementById(id);
  const esc = K.esc;
  const KEY = "simulations.circuits.v1";
  const TEMPLATES_KEY = "simulations.templates.v1";
  const MAX = 200;
  const MAX_BYTES = 1000000;
  let shelf = null;
  let lib = null; // the Library panel on a wide screen
  let openId = null; // the saved circuit the builder has open (null: a new one that was never saved)
  const START_KEY = "simulations.start";

  // ---------- the builder's calls, answered from this browser ----------
  const checkData = (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw K.fail("Simulation data must be an object.");
    if (JSON.stringify(data).length > MAX_BYTES) throw K.fail("This circuit is too large to save (over 1 MB of data).");
  };
  const full = "This browser has no room left to keep circuits. Delete one, or export it to a file first.";
  K.addApi((p, method, body, query) => {
    if (p === "/simulations" && method === "GET") {
      return K.readList(KEY).map((s) => ({ id: s.id, name: s.name, is_published: false, updated_at: s.updated_at })).sort((a, b) => a.name.localeCompare(b.name));
    }
    if (p === "/simulations" && method === "POST") {
      const list = K.readList(KEY);
      if (list.length >= MAX) throw K.fail("That is as many circuits as this browser keeps. Delete one first.");
      const name = K.cleanName(body && body.name);
      if (!name) throw K.fail("Name is required");
      checkData(body.data);
      const id = K.nextId(list);
      list.push({ id, name, data: body.data, updated_at: K.now() });
      K.writeList(KEY, list, full);
      openId = id; // a new circuit saved for the first time is the open one
      return { id };
    }
    const one = /^\/simulations\/(\d+)(\/duplicate|\/publish|\/unpublish)?$/.exec(p);
    if (one) {
      const id = Number(one[1]);
      const list = K.readList(KEY);
      const at = list.findIndex((s) => s.id === id);
      if (at < 0) throw K.fail("Simulation not found", 404);
      if (!one[2] && method === "GET") {
        openId = id;
        return Object.assign({ is_published: false }, list[at]);
      }
      if (!one[2] && method === "PATCH") {
        if (body && body.name !== undefined) {
          const name = K.cleanName(body.name);
          if (!name) throw K.fail("Name is required");
          list[at].name = name;
        }
        if (body && body.data !== undefined) {
          checkData(body.data);
          list[at].data = body.data;
        }
        list[at].updated_at = K.now();
        K.writeList(KEY, list, full);
        return list[at];
      }
      if (!one[2] && method === "DELETE") {
        list.splice(at, 1);
        K.writeList(KEY, list, full);
        return { ok: true };
      }
      if (one[2] === "/duplicate" && method === "POST") {
        if (list.length >= MAX) throw K.fail("That is as many circuits as this browser keeps. Delete one first.");
        const copy = { id: K.nextId(list), name: K.cleanName(list[at].name + " (copy)"), data: JSON.parse(JSON.stringify(list[at].data)), updated_at: K.now() };
        list.push(copy);
        K.writeList(KEY, list, full);
        return { id: copy.id };
      }
      if (one[2]) throw K.fail("Circuits made here stay in this browser: there is nothing to publish.", 404);
    }
    if (p === "/templates") {
      const kind = (query && query.get("kind")) || (body && body.kind) || "simulation";
      if (kind !== "simulation") return undefined;
      if (method === "GET") return K.readList(TEMPLATES_KEY);
      if (method === "POST") {
        const list = K.readList(TEMPLATES_KEY);
        const name = K.cleanName(body && body.name);
        if (!name) throw K.fail("Name is required");
        checkData(body.data);
        list.push({ id: K.nextId(list), kind: "simulation", name, data: body.data });
        K.writeList(TEMPLATES_KEY, list, full);
        return { id: list[list.length - 1].id };
      }
    }
    return undefined;
  });
  // What a new circuit starts from: an empty board, or one of the visitor's own templates.
  const startOptions = () => [{ value: "", label: "An empty board" }].concat(K.readList(TEMPLATES_KEY).map((t) => ({ value: String(t.id), label: "Template: " + t.name })));
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  // The builder takes its templates from its own (hidden) list; make sure it has loaded them, then start a circuit from the chosen one.
  async function newCircuit() {
    openId = null;
    $("simulations-btn").click();
    const want = 1 + K.readList(TEMPLATES_KEY).length;
    for (let i = 0; i < 60 && $("sim-template-picker").options.length < want; i++) await sleep(30);
    $("sim-template-picker").value = K.startChoice(START_KEY, startOptions(), "");
    $("new-simulation-btn").click();
    $("simulations-modal").hidden = true;
  }
  // A circuit with changes not yet saved is saved before the builder moves on (it costs nothing here).
  async function saveFirst() {
    if (editor().hidden) return;
    if (!/^Unsaved/.test((($("sim-save-status") || {}).textContent || "").trim())) return;
    const name = $("simulation-name");
    if (name && !name.value.trim()) name.value = "New circuit";
    $("save-simulation").click();
    for (let i = 0; i < 60 && /^Unsaved/.test((($("sim-save-status") || {}).textContent || "").trim()); i++) await sleep(50);
  }
  window.refreshSimulationOptions = () => {};
  window.showContentUsage = window.showContentUsage || (() => {});

  // ---------- the shelf ----------
  // A circuit's card shows where its parts sit on the board and how they are wired: one box per part, a line per wire.
  function circuitPicture(data) {
    const comps = (data && Array.isArray(data.components) ? data.components : []).filter((c) => c && Number.isFinite(c.x) && Number.isFinite(c.y));
    if (!comps.length) return `<svg viewBox="0 0 300 140" aria-hidden="true" focusable="false"><text x="150" y="76" text-anchor="middle" class="sim-card-empty">Empty board</text></svg>`;
    const xs = comps.map((c) => c.x);
    const ys = comps.map((c) => c.y);
    const minX = Math.min(...xs) - 30;
    const minY = Math.min(...ys) - 30;
    const w = Math.max(240, Math.max(...xs) - minX + 110);
    const h = Math.max(110, Math.max(...ys) - minY + 90);
    const at = {};
    comps.forEach((c) => { at[c.id] = c; });
    const centre = (c) => [c.x + 30, c.y + 20];
    const wires = (data.wires || [])
      .map((wr) => {
        const a = wr && wr.from && at[wr.from.compId];
        const b = wr && wr.to && at[wr.to.compId];
        if (!a || !b) return "";
        const [x1, y1] = centre(a);
        const [x2, y2] = centre(b);
        return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`;
      })
      .join("");
    const parts = comps.map((c) => `<rect x="${c.x}" y="${c.y}" width="60" height="40" rx="8" class="sim-card-${String(c.type).replace(/[^a-z0-9-]/gi, "")}"/>`).join("");
    return `<svg viewBox="${minX} ${minY} ${w} ${h}" aria-hidden="true" focusable="false" preserveAspectRatio="xMidYMid meet"><g class="sim-card-wires">${wires}</g><g class="sim-card-parts">${parts}</g></svg>`;
  }
  function buildShelf() {
    const el = document.createElement("section");
    el.className = "studio-shelf app-shelf sim-shelf";
    el.setAttribute("aria-labelledby", "sim-shelf-title");
    el.innerHTML = `<header class="shelf-head">
        <div><h2 id="sim-shelf-title" class="shelf-title">Simulations</h2><p class="shelf-lede">Build a circuit on a breadboard: batteries, LEDs, switches, resistors, meters, logic gates and more, and see what lights up. Your circuits stay in this browser.</p></div>
        <div class="shelf-new"><button type="button" class="btn btn-accent" id="sim-shelf-new">New circuit</button></div>
      </header>
      <div class="shelf-start-slot"></div>
      <div class="shelf-bar"><h3 class="shelf-sub">Your circuits <span class="shelf-count"></span></h3><div class="shelf-files"><button type="button" id="sim-shelf-open">Open a circuit file…</button><input type="file" id="sim-shelf-file" accept="application/json,.json" hidden></div></div>
      <p class="shelf-status" role="status"></p>
      <div class="shelf-grid sim-grid"></div>`;
    return el;
  }
  const say = (text) => {
    const s = shelf && shelf.querySelector(".shelf-status");
    if (s) s.textContent = text || "";
  };
  function renderShelf() {
    if (!shelf) return;
    const list = K.readList(KEY).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const grid = shelf.querySelector(".shelf-grid");
    grid.innerHTML = list.length
      ? list
          .map((s) => {
            const n = s.data && Array.isArray(s.data.components) ? s.data.components.length : 0;
            return `<article class="shelf-card sim-card" data-id="${s.id}">
              <button type="button" class="shelf-open" data-act="open" aria-label="Open ${esc(s.name)}">
                <span class="sim-thumb">${circuitPicture(s.data)}</span>
                <span class="shelf-name">${esc(s.name)}</span>
                <span class="shelf-when">${n} part${n === 1 ? "" : "s"} · ${esc(K.whenEdited(s.updated_at))}</span>
              </button>
              <span class="shelf-actions"><button type="button" data-act="copy" aria-label="Make a copy of ${esc(s.name)}">Copy</button><button type="button" data-act="delete" class="shelf-delete" aria-label="Delete ${esc(s.name)}">Delete</button></span>
            </article>`;
          })
          .join("")
      : `<p class="shelf-empty">No circuits yet. Start one: press Save in the builder (or come back here) and it is kept in this browser.</p>`;
    shelf.querySelector(".shelf-count").textContent = list.length ? `${list.length} circuit${list.length === 1 ? "" : "s"}` : "";
  }
  // The builder opens a circuit from its own list (kept hidden): make sure it lists this one, then press its Edit.
  async function openCircuit(id) {
    $("simulations-btn").click();
    for (let i = 0; i < 60; i++) {
      const edit = document.querySelector(`#simulations-list .edit-simulation[data-id="${id}"]`);
      if (edit) return edit.click();
      await new Promise((r) => setTimeout(r, 30));
    }
    say("That circuit could not be opened.");
  }
  function wireShelf() {
    shelf.querySelector("#sim-shelf-new").addEventListener("click", () => newCircuit());
    shelf.querySelector("#sim-shelf-open").addEventListener("click", () => shelf.querySelector("#sim-shelf-file").click());
    shelf.querySelector("#sim-shelf-file").addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const parsed = JSON.parse(await file.text());
        const data = parsed && parsed.data && Array.isArray(parsed.data.components) ? parsed.data : parsed;
        if (!data || !Array.isArray(data.components)) throw new Error("That file is not a circuit (export one from the builder with Export).");
        const name = K.cleanName((parsed && parsed.name) || file.name.replace(/\.json$/i, "")) || "Imported circuit";
        const res = await window.adminApi("/simulations", { method: "POST", body: JSON.stringify({ name, data }) });
        say("");
        await openCircuit(res.id);
      } catch (err) {
        say(err.message);
      }
    });
    shelf.querySelector(".shelf-grid").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      const card = e.target.closest(".sim-card");
      if (!btn || !card) return;
      const id = Number(card.dataset.id);
      const s = K.readList(KEY).find((x) => x.id === id);
      if (!s) return renderShelf();
      try {
        if (btn.dataset.act === "open") return openCircuit(id);
        if (btn.dataset.act === "copy") {
          await window.adminApi(`/simulations/${id}/duplicate`, { method: "POST" });
          return renderShelf();
        }
        if (btn.dataset.act === "delete") {
          if (!window.confirm(`Delete "${s.name}" from this browser? This can't be undone.`)) return;
          await window.adminApi(`/simulations/${id}`, { method: "DELETE" });
          return renderShelf();
        }
      } catch (err) {
        say(err.message);
      }
    });
  }
  // "Circuits" saves an unsaved circuit first (it costs nothing here), then goes back to the shelf.
  function saveBeforeShelf(close) {
    let passing = false;
    close.addEventListener("click", (e) => {
      if (passing) return;
      const status = (($("sim-save-status") || {}).textContent || "").trim();
      if (!/^Unsaved/.test(status)) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      const name = $("simulation-name");
      if (name && !name.value.trim()) name.value = "New circuit";
      $("save-simulation").click();
      let tries = 0;
      (function wait() {
        const now = (($("sim-save-status") || {}).textContent || "").trim();
        if (/^Unsaved/.test(now) && tries++ < 60) return setTimeout(wait, 50);
        passing = true;
        close.click();
        passing = false;
      })();
    }, true);
  }

  // ---------- the Library panel ----------
  function buildLibrary(inner) {
    const cfg = {
      id: "sim", host: inner, title: "Circuits", noun: "circuit", newLabel: "New circuit", startKey: START_KEY, startLabel: "New circuits start from", startOptions,
      items: () => K.readList(KEY).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))).map((s) => {
        const n = s.data && Array.isArray(s.data.components) ? s.data.components.length : 0;
        return { id: String(s.id), name: s.name, meta: `${n} part${n === 1 ? "" : "s"} · ${K.whenEdited(s.updated_at)}`, thumb: `<span class="sim-thumb">${circuitPicture(s.data)}</span>` };
      }),
      isOpen: (id) => !editor().hidden && openId !== null && String(openId) === id,
      async onNew() { await saveFirst(); await newCircuit(); },
      async onOpen(id) { await saveFirst(); await openCircuit(Number(id)); },
      async onCopy(id) { await window.adminApi(`/simulations/${id}/duplicate`, { method: "POST" }); },
      async onDelete(id) {
        const s = K.readList(KEY).find((x) => String(x.id) === id);
        if (!s || !window.confirm(`Delete "${s.name}" from this browser? This can't be undone.`)) return;
        await window.adminApi(`/simulations/${id}`, { method: "DELETE" });
        if (openId === s.id) { openId = null; editor().hidden = true; }
      },
      onStartChange() { fillShelfStart(); },
    };
    lib = K.library(cfg);
    shelfStart = K.startSelect(Object.assign({}, cfg, { onStartChange() { lib.render(); } }));
    shelf.querySelector(".shelf-start-slot").appendChild(shelfStart.el);
    // The panel follows the builder's own save indicator and the circuit's name.
    const status = $("sim-save-status");
    if (status) new MutationObserver(() => lib.refresh()).observe(status, { childList: true, characterData: true, subtree: true });
  }
  let shelfStart = null;
  const fillShelfStart = () => { if (shelfStart) shelfStart.fill(); };

  const editor = () => $("simulation-builder-modal");
  K.register({
    name: "simulations",
    mountId: "simulations-mount",
    shellClass: "sim-native",
    loadingText: "Loading Simulations…",
    scripts: ["/sim-buzzer.js", "/admin/sim-solver.js", "/admin/sim-schematic.js", "/admin/sim-components.js", "/admin/sim-sweep.js", "/admin/simulation-builder.js"],
    dialogs: ["simulations-modal", "simulation-builder-modal", "sim-checklist-modal", "sim-model-modal", "sim-warnings-modal", "sim-connect-modal", "sim-sweep-modal"],
    editor,
    // The builder's list stays hidden (the shelf stands for it); the builder listens to a button that opens it, so it must be there first.
    prepare(inner) {
      const listBtn = document.createElement("button");
      listBtn.type = "button";
      listBtn.id = "simulations-btn";
      listBtn.hidden = true;
      listBtn.tabIndex = -1;
      inner.appendChild(listBtn);
    },
    build(inner) {
      const close = $("close-simulation-builder");
      close.textContent = "Circuits";
      close.classList.add("app-back");
      close.setAttribute("aria-label", "Back to your circuits");
      saveBeforeShelf(close);
      // Back on the shelf the builder's own list must not show: the shelf is the list here.
      close.addEventListener("click", () => setTimeout(() => { $("simulations-modal").hidden = true; }, 0));
      K.wireSubDialogs(["sim-checklist-modal", "sim-model-modal", "sim-warnings-modal", "sim-connect-modal", "sim-sweep-modal"]);
      shelf = buildShelf();
      inner.prepend(shelf);
      buildLibrary(inner);
      wireShelf();
      renderShelf();
    },
    // The page opens on an empty board (or the template chosen in the panel), not on a shelf asking for a new circuit.
    openStart() { return editor().hidden ? newCircuit() : undefined; },
    shown(open) {
      if (shelf) {
        shelf.hidden = open;
        if (!open) renderShelf();
      }
      if (lib) lib.render();
    },
  });
})();
