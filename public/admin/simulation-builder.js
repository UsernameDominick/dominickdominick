(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const REG = window.SIM_COMPONENTS;

  let simulations = [];
  let currentSimId = null;
  let simData = { components: [], wires: [] };
  let selected = null; // { kind: "component" | "wire", id }
  let wireStart = null; // { compId, pin }
  // ---------- Continuity tester ----------
  // A toggle mode rather than a modifier key or separate always-on tool,
  // matching showDisconnected/showGhostWires elsewhere in this file --
  // pin clicks otherwise always mean "start/finish a wire," so this needs
  // an explicit mode switch rather than trying to layer a second meaning
  // onto the same click.
  let continuityMode = false;
  let continuityProbe = null; // { compId, pin, node }
  // Deliberately stores the raw probed endpoints, not a cached net/result --
  // a critic pass found that caching the computed net Set (and the
  // "Connected" text) at click time went stale the moment simData changed
  // out from under it (undo, redo, reset-to-saved, checkpoint restore,
  // deleting the very component/wire involved, import -- eight separate
  // mutation sites, all of which already call renderBuilder() but none of
  // which knew to also invalidate a continuity result). Storing only the
  // two endpoint identifiers and recomputing connectivity fresh in
  // renderBuilder() on every render makes the result self-healing after
  // ANY mutation, present or future, instead of requiring every current
  // and future simData-mutating call site to remember to also clear this.
  let continuityLastProbe = null; // { compIdA, pinA, nodeA, compIdB, pinB, nodeB }
  let previewOn = false;
  let localIdCounter = 1;
  let placeX = 20;
  let placeY = 20;
  const PLACE_ROW_HEIGHT = 70;
  const PLACE_CANVAS_WIDTH = 1500;
  // Snapshot taken right after openBuilder() loads/creates simData, so
  // "Reset" can discard every in-progress edit and go back to exactly
  // what was last saved (or the template/blank state a new simulation
  // started from) -- same idea as the Photo Editor's "Reset" button and
  // its originalSnapshot.
  let initialSimSnapshot = null;

  // Named checkpoints -- unlike the undo stack (in-memory only, wiped the
  // moment the builder closes), these persist with the simulation across
  // saves/reloads, for "I want to try something risky but come back to
  // this exact point later" rather than "undo my last few actions."
  // Deliberately kept OUT of simData itself (only merged in at save time,
  // split back out on load) rather than storing them as a `checkpoints`
  // key inside simData: pushHistory() snapshots the whole of simData on
  // every single edit, so if checkpoints (each one a full circuit
  // snapshot) lived inside simData, every undo-stack entry would carry a
  // redundant copy of every checkpoint too, multiplying memory use by the
  // checkpoint count on every edit. Keeping them separate means the undo
  // stack only ever holds actual circuit state.
  let simCheckpoints = [];
  const CHECKPOINT_LIMIT = 20;

  // ---------- Undo / redo ----------
  // Snapshot-based rather than diff-based: simData is a small plain-JSON
  // object, so cloning it whole on every mutation is simpler and cheap
  // enough at this scale, and it doesn't need to know what changed.
  const HISTORY_LIMIT = 50;
  let undoStack = [];
  let redoStack = [];

  function pushHistory() {
    undoStack.push(JSON.stringify(simData));
    if (undoStack.length > HISTORY_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
  }

  function updateHistoryButtons() {
    $("sim-undo").disabled = undoStack.length === 0;
    $("sim-redo").disabled = redoStack.length === 0;
  }

  function undoHistory() {
    if (!undoStack.length) return;
    redoStack.push(JSON.stringify(simData));
    simData = JSON.parse(undoStack.pop());
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
  }

  function redoHistory() {
    if (!redoStack.length) return;
    undoStack.push(JSON.stringify(simData));
    simData = JSON.parse(redoStack.pop());
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
  }

  function resetSimToInitial() {
    if (!initialSimSnapshot) return;
    if (!confirm("Discard all edits and go back to the last saved state?")) return;
    pushHistory();
    simData = JSON.parse(initialSimSnapshot);
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
  }

  $("sim-undo").addEventListener("click", undoHistory);
  $("sim-redo").addEventListener("click", redoHistory);

  // ---------- Named checkpoints ----------
  function renderCheckpointSelect() {
    const select = $("sim-checkpoint-select");
    select.innerHTML =
      `<option value="">Checkpoints…</option>` +
      simCheckpoints.map((cp, i) => `<option value="${i}">${escapeHtmlLite(cp.name)}</option>`).join("");
    $("sim-checkpoint-restore").disabled = true;
    $("sim-checkpoint-delete").disabled = true;
  }
  function escapeHtmlLite(s) {
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  // Number("") is 0, not NaN -- a plain Number(select.value) can't tell
  // "nothing selected" (the blank placeholder option) apart from "index 0
  // selected," so a caller relying only on `!simCheckpoints[i]` to no-op
  // would silently act on checkpoint 0 instead. In today's UI this never
  // fires (the select always resets to blank and both buttons disable
  // together on every render), but the guard itself should be correct on
  // its own rather than only correct because something else happens to
  // keep it from being reached.
  function selectedCheckpointIndex() {
    const raw = $("sim-checkpoint-select").value;
    return raw === "" ? -1 : Number(raw);
  }
  $("sim-checkpoint-select").addEventListener("change", (e) => {
    const has = e.target.value !== "";
    $("sim-checkpoint-restore").disabled = !has;
    $("sim-checkpoint-delete").disabled = !has;
  });
  $("sim-checkpoint-save").addEventListener("click", () => {
    const name = prompt("Name this checkpoint:", `Checkpoint ${simCheckpoints.length + 1}`);
    if (!name || !name.trim()) return;
    simCheckpoints.push({
      name: name.trim(),
      createdAt: new Date().toISOString(),
      data: { components: JSON.parse(JSON.stringify(simData.components)), wires: JSON.parse(JSON.stringify(simData.wires)) },
    });
    // Oldest checkpoints drop first once the cap is hit — a runaway
    // number of full-circuit snapshots piling up in one row's JSON blob
    // isn't something an admin is likely to notice happening, so this
    // caps it automatically rather than needing manual cleanup.
    if (simCheckpoints.length > CHECKPOINT_LIMIT) simCheckpoints = simCheckpoints.slice(simCheckpoints.length - CHECKPOINT_LIMIT);
    renderCheckpointSelect();
  });
  $("sim-checkpoint-restore").addEventListener("click", () => {
    const i = selectedCheckpointIndex();
    const cp = simCheckpoints[i];
    if (!cp) return;
    if (!confirm(`Discard all current edits and restore the checkpoint "${cp.name}"?`)) return;
    pushHistory();
    simData = { components: JSON.parse(JSON.stringify(cp.data.components)), wires: JSON.parse(JSON.stringify(cp.data.wires)) };
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
  });
  $("sim-checkpoint-delete").addEventListener("click", () => {
    const i = selectedCheckpointIndex();
    const cp = simCheckpoints[i];
    if (!cp) return;
    if (!confirm(`Delete the checkpoint "${cp.name}"? This can't be undone (checkpoints aren't part of the undo history).`)) return;
    simCheckpoints.splice(i, 1);
    renderCheckpointSelect();
  });

  // Where the next palette-added part lands — walks left to right, wrapping
  // to a new row by actual part width so a 340px breadboard doesn't overlap
  // the very next (tiny) part the way a fixed-step stagger would.
  function nextPlacement(def) {
    if (placeX + def.w > PLACE_CANVAS_WIDTH) {
      placeX = 20;
      placeY += PLACE_ROW_HEIGHT;
    }
    const pos = { x: placeX, y: placeY };
    placeX += def.w + 20;
    return pos;
  }

  function escapeXml(s) {
    const d = document.createElement("div");
    d.textContent = s == null ? "" : String(s);
    // A critic pass found this only ever escaped &/</> -- correct for the
    // SVG text-node uses this function was originally written for, but
    // this same helper is also used to build HTML attribute values (e.g.
    // wire/component label <input value="...">), where an unescaped "
    // breaks out of the attribute and injects live markup. .innerHTML's
    // text-node serialization never escapes quotes (they only matter in
    // attribute-value context, which this function has no way to know
    // it's being used for), so they're escaped explicitly here instead.
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // escapeXml() alone stops HTML injection but a href value is still live
  // even after escaping -- "javascript:alert(1)" has nothing to escape, so
  // it would run as-is on click. A component's datasheet-link field is
  // exactly this "user-supplied URL that becomes a real clickable href"
  // shape, reachable here via the JSON import feature the same way this
  // file's other recent critic findings were.
  //
  // A critic pass found a first version of this that denylisted
  // "javascript:"/"data:"/"vbscript:" via a regex tested against the raw,
  // merely-.trim()'d string had a real, browser-confirmed bypass: a tab or
  // newline embedded INSIDE the scheme name (e.g. "java\tscript:alert(1)")
  // doesn't match the anchored regex, since .trim() only strips leading/
  // trailing whitespace, not embedded -- but the browser's own URL parser
  // strips ALL ASCII tab/newline characters anywhere in the string before
  // ever looking at the scheme, so the href actually resolves to a real
  // "javascript:" URL despite passing the regex check. Same story for a
  // leading C0 control character, which .trim() also doesn't strip but the
  // URL parser does. A denylist regex on a string the browser will further
  // normalize afterward is the wrong shape of check.
  //
  // Fixed by actually parsing the URL the same way the browser will (via
  // the real URL parser, not a hand-rolled approximation of it) and
  // allowlisting the resulting protocol instead of denylisting the raw
  // input text -- this is correct by construction: whatever value ends up
  // in `.protocol` after parsing IS what the browser will actually
  // navigate as, so there's no gap between what this function checks and
  // what happens on click. `location.href` as the base lets a relative
  // path or bare domain-without-scheme still parse (resolving to this
  // admin page's own origin) while a URL with its own explicit scheme
  // parses to that scheme regardless of what it's relative to.
  function safeHref(url) {
    const trimmed = String(url == null ? "" : url).trim();
    if (!trimmed) return "#";
    try {
      const parsed = new URL(trimmed, location.href);
      const allowedProtocols = ["http:", "https:", "mailto:", "tel:"];
      return allowedProtocols.includes(parsed.protocol) ? trimmed : "#";
    } catch {
      return "#";
    }
  }

  function newLocalId(prefix) {
    return `${prefix}_${Date.now().toString(36)}_${localIdCounter++}`;
  }

  // ---------- Multi-select helpers ----------
  function selectedIds() {
    if (!selected) return [];
    if (selected.kind === "component") return [selected.id];
    if (selected.kind === "multi") return selected.ids;
    return [];
  }
  function isCompSelected(compId) {
    return selectedIds().includes(compId);
  }
  // Collapses to the simplest shape for however many ids end up selected —
  // a bare component selection for exactly one, multi for more, null for
  // none — so the rest of the code only has to handle "component"/"wire"/
  // "multi"/null instead of a multi-selection of size 0 or 1 as a special case.
  function setMultiSelection(ids) {
    if (ids.length === 0) selected = null;
    else if (ids.length === 1) selected = { kind: "component", id: ids[0] };
    else selected = { kind: "multi", ids };
  }

  // ---------- List modal ----------
  async function loadSimulationsList() {
    simulations = await window.adminApi("/simulations");
    renderSimulationsList();
  }

  function renderSimulationsList() {
    $("simulations-list").innerHTML =
      simulations
        .map(
          (s) =>
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><a href="/simulation/${
              s.id
            }" target="_blank" class="view-simulation-link">View ↗</a><button type="button" class="usage-simulation" data-id="${
              s.id
            }" data-name="${escapeXml(s.name)}" title="See which pages/projects use this simulation">Usage</button><button type="button" class="duplicate-simulation" data-id="${
              s.id
            }">Duplicate</button><button type="button" class="edit-simulation" data-id="${
              s.id
            }">Edit</button><button type="button" class="delete-simulation" data-id="${s.id}">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No simulations yet.</p>";

    $("simulations-list")
      .querySelectorAll(".edit-simulation")
      .forEach((btn) => btn.addEventListener("click", () => openBuilder(Number(btn.dataset.id))));
    $("simulations-list")
      .querySelectorAll(".usage-simulation")
      .forEach((btn) => btn.addEventListener("click", () => window.showContentUsage("simulation", btn.dataset.id, btn.dataset.name)));
    $("simulations-list")
      .querySelectorAll(".duplicate-simulation")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          await window.adminApi(`/simulations/${btn.dataset.id}/duplicate`, { method: "POST" });
          await loadSimulationsList();
        })
      );
    $("simulations-list")
      .querySelectorAll(".delete-simulation")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          const usage = await window.adminApi(`/content-usage?type=simulation&id=${btn.dataset.id}`).catch(() => []);
          const msg = usage.length
            ? `This simulation is used in: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those blocks will show "not found".`
            : "Delete this simulation? This can't be undone.";
          if (!confirm(msg)) return;
          await window.adminApi(`/simulations/${btn.dataset.id}`, { method: "DELETE" });
          await loadSimulationsList();
        })
      );
  }

  // ---------- Templates ----------
  let simTemplates = [];
  async function loadSimTemplates() {
    try {
      simTemplates = await window.adminApi("/templates?kind=simulation");
    } catch {
      simTemplates = [];
    }
    $("sim-template-picker").innerHTML =
      `<option value="">Blank</option>` + simTemplates.map((t) => `<option value="${t.id}">${escapeXml(t.name)}</option>`).join("");
  }

  $("save-sim-template-btn").addEventListener("click", async () => {
    const name = prompt("Template name:");
    if (!name) return;
    try {
      await window.adminApi("/templates", { method: "POST", body: JSON.stringify({ kind: "simulation", name, data: simData }) });
      await loadSimTemplates();
    } catch (err) {
      alert(err.message);
    }
  });

  $("simulations-btn").addEventListener("click", async () => {
    $("simulations-modal").hidden = false;
    await loadSimulationsList();
    await loadSimTemplates();
  });
  $("close-simulations").addEventListener("click", () => ($("simulations-modal").hidden = true));
  $("new-simulation-btn").addEventListener("click", () => {
    const templateId = Number($("sim-template-picker").value) || null;
    openBuilder(null, templateId);
  });

  // ---------- Open / close builder ----------
  async function openBuilder(id, templateId) {
    currentSimId = id;
    selected = null;
    wireStart = null;
    previewOn = false;
    showDisconnected = false;
    showGhostWires = false;
    canvasSearchQuery = "";
    $("sim-canvas-search").value = "";
    gridSnapSize = 5;
    $("sim-grid-snap").value = "5";
    continuityMode = false;
    continuityProbe = null;
    continuityLastProbe = null;
    $("sim-continuity-result").textContent = "";
    $("sim-continuity-result").classList.remove("sim-continuity-yes", "sim-continuity-no");
    zoomLevel = defaultZoomLevel();
    placeX = 20;
    placeY = 20;
    undoStack = [];
    redoStack = [];
    renderRecentPalette();
    if (id) {
      const sim = await window.adminApi(`/simulations/${id}`);
      $("simulation-name").value = sim.name;
      const components = sim.data && Array.isArray(sim.data.components) ? sim.data.components : [];
      const wires = sim.data && Array.isArray(sim.data.wires) ? sim.data.wires : [];
      simData = { components, wires };
      simCheckpoints = sim.data && Array.isArray(sim.data.checkpoints) ? sim.data.checkpoints : [];
      $("sim-poster-url").value = (sim.data && sim.data.og_image) || "";
    } else if (templateId) {
      const t = simTemplates.find((x) => x.id === templateId);
      $("simulation-name").value = "New simulation";
      simData = t && Array.isArray(t.data.components) ? JSON.parse(JSON.stringify({ components: t.data.components, wires: t.data.wires || [] })) : { components: [], wires: [] };
      simCheckpoints = [];
      // A template is a fresh starting point -- its own poster/share image
      // (if the simulation it was saved from had one) shouldn't carry over
      // into every new simulation created from it, same reasoning already
      // applied to not carrying over checkpoints from a template.
      $("sim-poster-url").value = "";
    } else {
      $("simulation-name").value = "New simulation";
      simData = { components: [], wires: [] };
      simCheckpoints = [];
      $("sim-poster-url").value = "";
    }
    initialSimSnapshot = JSON.stringify(simData);
    $("simulations-modal").hidden = true;
    $("simulation-builder-modal").hidden = false;
    $("sim-palette-search").value = "";
    document.querySelectorAll(".sim-palette-btn").forEach((btn) => btn.classList.remove("is-hidden-by-search"));
    updateHistoryButtons();
    renderCheckpointSelect();
    renderInspector();
    renderBuilder();
  }

  $("close-simulation-builder").addEventListener("click", () => {
    $("simulation-builder-modal").hidden = true;
    $("simulations-modal").hidden = false;
    // The list behind the builder was last loaded before this edit/create —
    // refresh it so a just-saved simulation actually shows up (and any
    // action taken on the list, like Duplicate, targets current rows).
    loadSimulationsList().catch(() => {});
  });

  // ---------- Rendering the live builder SVG ----------
  function pinPosition(comp, pinId) {
    const def = REG[comp.type];
    const pin = def.pins.find((p) => p.id === pinId);
    return pin ? { x: comp.x + pin.x, y: comp.y + pin.y } : null;
  }

  function renderComponentSvg(comp, poweredComps, analysis) {
    const def = REG[comp.type];
    if (!def) return "";
    const sel = isCompSelected(comp.id);
    const info = analysis[comp.id];
    const damaged = info && (info.status === "burnt" || info.status === "overheating");
    const searchMatch = componentMatchesSearch(comp);
    // The label field is already captioned "(for your own reference)" for
    // every component except the Teensy (where it's printed directly on
    // the part) -- but "for your own reference" only actually held for a
    // Teensy before this, since nothing else ever displayed it anywhere
    // except the inspector's own text input. A native <title> gives every
    // other component type the same hover-visible reference its caption
    // already implied, with no new field duplicating what `label` already
    // is. Skipped for mcu_teensy specifically -- it already prints the
    // same text as visible SVG <text>, so a tooltip repeating it would
    // just be redundant (a critic pass found this).
    const titleSvg = comp.label && comp.type !== "mcu_teensy" ? `<title>${escapeXml(comp.label)}</title>` : "";
    return `<g class="sim-comp sim-comp-${comp.type}${sel ? " sim-selected" : ""}${damaged ? " sim-damaged" : ""}${
      searchMatch ? " sim-search-match" : ""
    }" data-id="${escapeXml(
      comp.id
    )}" data-powered="${poweredComps.has(comp.id) ? "true" : "false"}" transform="translate(${comp.x},${
      comp.y
    })">${titleSvg}${def.render(comp)}${sel ? `<rect class="sim-select-box" x="-4" y="-4" width="${def.w + 8}" height="${def.h + 8}" />` : ""}${
      searchMatch ? `<rect class="sim-search-match-box" x="-6" y="-6" width="${def.w + 12}" height="${def.h + 12}" />` : ""
    }</g>`;
  }

  function renderWireSvg(wire, poweredWires, netNodeIds, ghost) {
    const fromComp = simData.components.find((c) => c.id === wire.from.compId);
    const toComp = simData.components.find((c) => c.id === wire.to.compId);
    if (!fromComp || !toComp) return "";
    const p1 = pinPosition(fromComp, wire.from.pin);
    const p2 = pinPosition(toComp, wire.to.pin);
    if (!p1 || !p2) return "";
    // A part snapped directly onto a breadboard hole has a zero-length
    // "wire" (its pin and the hole are the same point) -- it's plugged in
    // physically, not cabled, so there's nothing to draw. The public-
    // facing render (worker/simulation-render.js) already has this guard;
    // a critic pass found the admin builder's own copy of this function
    // never did, which was harmless before labels existed (an invisible
    // zero-length path is a no-op either way) but would render an
    // orphaned floating label with no visible wire under it once a
    // degenerate wire like this (reachable via JSON import, or in
    // principle the breadboard auto-snap path) is given a label.
    if (Math.hypot(p2.x - p1.x, p2.y - p1.y) < 0.5) return "";
    const d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
    // The ghost pass is a purely visual second copy drawn on top of
    // components -- deliberately NOT given the .sim-wire class (so
    // attachBuilderEvents()'s click-to-select wiring never binds to it,
    // avoiding a confusing "clicking near a component actually selected
    // a wire" surprise) and explicitly non-interactive either way.
    if (ghost) {
      return `<path class="sim-wire-ghost" d="${d}"/>`;
    }
    const sel = selected && selected.kind === "wire" && selected.id === wire.id;
    const inNet = netNodeIds && netNodeIds.has(window.simNodeId(fromComp, wire.from.pin));
    // Positioned at the wire's midpoint with a small upward offset, the
    // same "text sits just above the thing it labels" convention the
    // breadboard's own rail labels and each part's own body label already
    // use elsewhere in this file, rather than inventing a new placement
    // rule just for wires.
    const labelSvg = wire.label
      ? `<text class="sim-wire-label" x="${(p1.x + p2.x) / 2}" y="${(p1.y + p2.y) / 2 - 6}" text-anchor="middle">${escapeXml(
          wire.label
        )}</text>`
      : "";
    // Whitelisted to the two values the wire-kind <select> can actually
    // produce, same reasoning as renderComponentSvg()'s implicit
    // comp.type whitelisting (the REG[comp.type] lookup there) -- a critic
    // pass found `wire.id`/`comp.id` interpolated unescaped into attribute
    // values elsewhere in this function and fixed those, but `wire.kind`
    // has the identical exposure (JSON import performs no field
    // validation) and was building a CSS class name, not just any
    // attribute, from a value that was otherwise never constrained.
    const kind = wire.kind === "hdmi" ? "hdmi" : "wire";
    // Same whitelist-not-denylist reasoning as `kind` just above: a
    // multiplier keyed off a validated string, never a number read
    // straight from JSON-import-controlled data, so there's no numeric
    // field here that could ever need a plausibility bound the way image
    // dimensions elsewhere in this codebase did.
    const thicknessMultiplier = { thin: 0.6, thick: 1.7 }[wire.thickness] || 1;
    // Base widths mirror the plain CSS defaults for each kind (public/
    // style.css's .sim-wire/.sim-wire-shine/.sim-wire-hdmi/.sim-wire-shine-
    // hdmi) -- only emitted as an inline style at all when the multiplier
    // isn't 1, so the overwhelming common "Normal" case keeps relying on
    // the plain CSS class with no per-wire override cluttering the markup.
    // Rounded to 2 decimal places -- a critic pass found 1.5 * 0.6 (the
    // HDMI-style shine stroke at Thin) is 0.8999999999999999 in floating
    // point, which would otherwise render as that exact ugly literal in
    // the SVG markup. Purely cosmetic (identical to the eye either way),
    // but cheap to avoid.
    const roundPx = (n) => Math.round(n * 100) / 100;
    const strokeStyle =
      thicknessMultiplier === 1 ? "" : ` style="stroke-width:${roundPx((kind === "hdmi" ? 5 : 4) * thicknessMultiplier)}px"`;
    const shineStrokeStyle =
      thicknessMultiplier === 1 ? "" : ` style="stroke-width:${roundPx((kind === "hdmi" ? 1.5 : 1.2) * thicknessMultiplier)}px"`;
    return `<path class="sim-wire sim-wire-${kind}${sel ? " sim-selected" : ""}${
      inNet ? " sim-net-highlight" : ""
    }" data-id="${escapeXml(wire.id)}" data-animated="${
      poweredWires.has(wire.id) ? "true" : "false"
    }" d="${d}"${strokeStyle}/><path class="sim-wire-shine sim-wire-shine-${kind}" d="${d}"${shineStrokeStyle}/>${labelSvg}`;
  }

  // "Net" here means the set of pins tied to the same electrical point by
  // wires alone -- deliberately NOT the same as the power-flow graph
  // computeSimPoweredSet()/window.simNodeId's own callers build (which
  // also links a resistor/LED's two legs as "connected" for current-flow
  // purposes, since current can flow through a component). Two ends of a
  // resistor are NOT the same node -- a voltage drop happens across it --
  // so reusing that broader graph here would incorrectly highlight both
  // legs of every component along the way as one giant "net" instead of
  // just the wire-tied group a real net actually is. Reuses window.simNodeId
  // (so breadboard rail/rows still correctly count as one shared node,
  // same as everywhere else in this file) and a plain BFS, just over a
  // wires-only adjacency built fresh here instead of the shared
  // component-conducting one in sim-components.js.
  function wireOnlyNetNodes(startNode) {
    const adjacency = new Map();
    const link = (a, b) => {
      if (!adjacency.has(a)) adjacency.set(a, new Set());
      if (!adjacency.has(b)) adjacency.set(b, new Set());
      adjacency.get(a).add(b);
      adjacency.get(b).add(a);
    };
    simData.wires.forEach((w) => {
      const fromComp = simData.components.find((c) => c.id === w.from.compId);
      const toComp = simData.components.find((c) => c.id === w.to.compId);
      if (!fromComp || !toComp) return;
      link(window.simNodeId(fromComp, w.from.pin), window.simNodeId(toComp, w.to.pin));
    });
    const visited = new Set([startNode]);
    const queue = [startNode];
    while (queue.length) {
      const cur = queue.shift();
      (adjacency.get(cur) || new Set()).forEach((n) => {
        if (!visited.has(n)) {
          visited.add(n);
          queue.push(n);
        }
      });
    }
    return visited;
  }

  // A component just placed with no wires yet is completely normal mid-
  // build, so this is an on-demand toggle rather than an always-on
  // overlay that would just be noisy for any circuit still in progress.
  let showDisconnected = false;
  // Same reasoning for keeping this a toggle rather than always-on: most
  // wires are never actually hidden under anything, so a permanent
  // dashed duplicate over every single wire would just be visual clutter.
  let showGhostWires = false;
  // Empty string means "no active search" -- kept lowercase-trimmed here
  // (once, on input) rather than re-normalizing it on every component's
  // match check during every render.
  let canvasSearchQuery = "";
  function componentMatchesSearch(comp) {
    if (!canvasSearchQuery) return false;
    const def = REG[comp.type];
    const haystacks = [comp.label, def && def.label, comp.type];
    return haystacks.some((s) => s && String(s).toLowerCase().includes(canvasSearchQuery));
  }
  function isPinConnected(compId, pinId) {
    return simData.wires.some(
      (w) => (w.from.compId === compId && w.from.pin === pinId) || (w.to.compId === compId && w.to.pin === pinId)
    );
  }
  function countDisconnectedPins() {
    let n = 0;
    simData.components.forEach((c) => {
      const def = REG[c.type];
      if (!def) return;
      def.pins.forEach((p) => {
        if (!isPinConnected(c.id, p.id)) n++;
      });
    });
    return n;
  }

  function renderPinDots(comp, netNodeIds) {
    const def = REG[comp.type];
    return def.pins
      .map((p) => {
        const active =
          (wireStart && wireStart.compId === comp.id && wireStart.pin === p.id) ||
          (continuityProbe && continuityProbe.compId === comp.id && continuityProbe.pin === p.id);
        const disconnected = showDisconnected && !isPinConnected(comp.id, p.id);
        const inNet = netNodeIds && netNodeIds.has(window.simNodeId(comp, p.id));
        return `<circle class="sim-pin${active ? " sim-pin-active" : ""}${
          disconnected ? " sim-pin-disconnected" : ""
        }${inNet ? " sim-net-highlight" : ""}" data-comp="${escapeXml(comp.id)}" data-pin="${p.id}" cx="${comp.x + p.x}" cy="${
          comp.y + p.y
        }" r="5"/>`;
      })
      .join("");
  }

  function renderBuilder() {
    const { poweredComps, poweredWires } = window.computeSimPoweredSet(simData);
    const analysis = window.computeSimElectricalAnalysis(simData);
    // Selecting a wire highlights the whole wire-tied net it belongs to,
    // not just that one segment -- clicking any wire is a cheap, already-
    // familiar way to trigger this without a new interaction mode that
    // would compete with a pin click already meaning "start a new wire."
    let netNodeIds = null;
    if (selected && selected.kind === "wire") {
      const w = simData.wires.find((x) => x.id === selected.id);
      const fromComp = w && simData.components.find((c) => c.id === w.from.compId);
      if (fromComp) netNodeIds = wireOnlyNetNodes(window.simNodeId(fromComp, w.from.pin));
    } else if (continuityLastProbe) {
      // Re-derived from the raw probed endpoints on every render (see the
      // comment on continuityLastProbe's declaration) rather than a
      // cached result, so undo/redo/delete/import/checkpoint-restore --
      // any of which can change whether these two pins are still
      // connected, or make one of them not exist at all -- can't leave a
      // stale "Connected" verdict on screen.
      const compA = simData.components.find((c) => c.id === continuityLastProbe.compIdA);
      const compB = simData.components.find((c) => c.id === continuityLastProbe.compIdB);
      if (!compA || !compB) {
        continuityLastProbe = null;
        $("sim-continuity-result").textContent = "";
        $("sim-continuity-result").classList.remove("sim-continuity-yes", "sim-continuity-no");
      } else {
        const netNodes = wireOnlyNetNodes(continuityLastProbe.nodeA);
        const isConnected = netNodes.has(continuityLastProbe.nodeB);
        $("sim-continuity-result").textContent = isConnected ? "Connected" : "Not connected";
        $("sim-continuity-result").classList.toggle("sim-continuity-yes", isConnected);
        $("sim-continuity-result").classList.toggle("sim-continuity-no", !isConnected);
        if (isConnected) netNodeIds = netNodes;
      }
    }
    const wiresSvg = simData.wires.map((w) => renderWireSvg(w, poweredWires, netNodeIds)).join("");
    const compsSvg = simData.components.map((c) => renderComponentSvg(c, poweredComps, analysis)).join("");
    const pinsSvg = simData.components.map((c) => renderPinDots(c, netNodeIds)).join("");
    // Wires render BEFORE components in normal SVG paint order, so a wire
    // routed underneath an opaque part (most commonly a breadboard, the
    // widest/tallest body on the canvas) is genuinely invisible with
    // nothing else on screen hinting it's there. Rather than computing
    // which specific wires are actually occluded (a bounding-box
    // intersection test against every component, for a purely cosmetic
    // debug aid), this just redraws every wire a second time on TOP of
    // components as a dashed "ghost" outline when toggled on -- the data
    // needed is exactly the same `simData.wires` already rendered once,
    // no new tracking required.
    const ghostWiresSvg = showGhostWires
      ? simData.wires.map((w) => renderWireSvg(w, poweredWires, netNodeIds, true)).join("")
      : "";
    $("sim-builder-canvas").innerHTML = `<svg id="sim-builder-svg" viewBox="0 0 1500 700" xmlns="http://www.w3.org/2000/svg" class="sim-svg${
      previewOn ? " is-on" : ""
    }">${window.SIM_DEFS_SVG}${wiresSvg}${compsSvg}${ghostWiresSvg}${pinsSvg}</svg>`;
    attachBuilderEvents();
    applyZoom();
    if (showDisconnected) {
      const n = countDisconnectedPins();
      $("sim-show-disconnected").textContent = n ? `Disconnected pins: ${n}` : "No disconnected pins";
    } else {
      $("sim-show-disconnected").textContent = "Show disconnected pins";
    }
    $("sim-show-disconnected").classList.toggle("is-active", showDisconnected);
    // Synced here (not just in the click handler) so opening a different
    // simulation -- which resets showGhostWires but never touches this
    // button's DOM class on its own -- can't leave a stale "active" look
    // on a toggle that's actually back off.
    $("sim-show-ghost-wires").classList.toggle("is-active", showGhostWires);
    $("sim-continuity-test").classList.toggle("is-active", continuityMode);
  }

  $("sim-canvas-search").addEventListener("input", (e) => {
    canvasSearchQuery = e.target.value.trim().toLowerCase();
    renderBuilder();
  });

  $("sim-show-disconnected").addEventListener("click", () => {
    showDisconnected = !showDisconnected;
    renderBuilder();
  });

  $("sim-show-ghost-wires").addEventListener("click", () => {
    showGhostWires = !showGhostWires;
    renderBuilder();
  });

  // No renderBuilder() needed -- this only affects the snap math read
  // during the next drag, not anything currently on screen.
  $("sim-grid-snap").addEventListener("change", (e) => {
    gridSnapSize = Number(e.target.value) || 0;
  });

  $("sim-continuity-test").addEventListener("click", () => {
    continuityMode = !continuityMode;
    // Clearing wireStart too: leaving a half-drawn wire in progress while
    // switching into continuity mode would mean the next pin click (now
    // interpreted as a continuity probe) never finishes that wire, but
    // the stale wireStart would still render its own "active" highlight
    // on the original pin, which is confusing next to a mode that no
    // longer draws wires at all.
    wireStart = null;
    continuityProbe = null;
    continuityLastProbe = null;
    $("sim-continuity-result").textContent = "";
    $("sim-continuity-result").classList.remove("sim-continuity-yes", "sim-continuity-no");
    renderBuilder();
  });

  function svgPoint(evt) {
    const svg = $("sim-builder-svg");
    const pt = svg.createSVGPoint();
    pt.x = evt.clientX;
    pt.y = evt.clientY;
    const ctm = svg.getScreenCTM();
    if (!ctm) return { x: 0, y: 0 };
    const p = pt.matrixTransform(ctm.inverse());
    return { x: p.x, y: p.y };
  }

  // A drag on empty canvas draws a rubber-band rectangle; anything it
  // overlaps on release becomes the new selection. A plain click (no real
  // drag distance) clears the selection instead. Both cases are decided
  // and applied entirely within this one pointerdown/move/up sequence —
  // deliberately NOT via a separate trailing "click" listener, since
  // renderBuilder() replaces the whole <svg> synchronously inside onUp,
  // and the browser's own synthetic click after a drag can't reliably
  // reach a DOM subtree that no longer exists by the time it fires.
  const DRAG_SELECT_MIN_DIST = 4;

  function onCanvasBackgroundPointerDown(e) {
    const svg = $("sim-builder-svg");
    if (e.target !== svg) return;
    const start = svgPoint(e);
    const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    rect.setAttribute("class", "sim-select-rect");
    rect.setAttribute("x", start.x);
    rect.setAttribute("y", start.y);
    rect.setAttribute("width", 0);
    rect.setAttribute("height", 0);
    svg.appendChild(rect);
    let moved = false;

    function onMove(ev) {
      const p = svgPoint(ev);
      const x = Math.min(start.x, p.x);
      const y = Math.min(start.y, p.y);
      const w = Math.abs(p.x - start.x);
      const h = Math.abs(p.y - start.y);
      if (w > DRAG_SELECT_MIN_DIST || h > DRAG_SELECT_MIN_DIST) moved = true;
      rect.setAttribute("x", x);
      rect.setAttribute("y", y);
      rect.setAttribute("width", w);
      rect.setAttribute("height", h);
    }
    function onUp() {
      svg.removeEventListener("pointermove", onMove);
      svg.removeEventListener("pointerup", onUp);
      const x = Number(rect.getAttribute("x"));
      const y = Number(rect.getAttribute("y"));
      const w = Number(rect.getAttribute("width"));
      const h = Number(rect.getAttribute("height"));
      rect.remove();
      if (!moved) {
        // A plain click on empty canvas — deselect, same as before.
        selected = null;
        wireStart = null;
        continuityProbe = null;
        renderInspector();
        renderBuilder();
        return;
      }
      const hitIds = simData.components
        .filter((c) => {
          const def = REG[c.type];
          if (!def) return false;
          return c.x < x + w && c.x + def.w > x && c.y < y + h && c.y + def.h > y;
        })
        .map((c) => c.id);
      setMultiSelection(hitIds);
      renderInspector();
      renderBuilder();
    }
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", onUp);
  }

  function attachBuilderEvents() {
    const svg = $("sim-builder-svg");
    svg.querySelectorAll(".sim-comp").forEach((g) => g.addEventListener("pointerdown", onComponentPointerDown));
    svg.querySelectorAll(".sim-pin").forEach((dot) => dot.addEventListener("click", onPinClick));
    svg.querySelectorAll(".sim-wire").forEach((path) =>
      path.addEventListener("click", (e) => {
        e.stopPropagation();
        selected = { kind: "wire", id: path.dataset.id };
        renderInspector();
        renderBuilder();
      })
    );
    svg.addEventListener("pointerdown", onCanvasBackgroundPointerDown);
  }

  function updateWiresForComponent(compId) {
    const svg = $("sim-builder-svg");
    simData.wires.forEach((wire) => {
      if (wire.from.compId !== compId && wire.to.compId !== compId) return;
      const path = svg.querySelector(`path[data-id="${wire.id}"]`);
      if (!path) return;
      const fromComp = simData.components.find((c) => c.id === wire.from.compId);
      const toComp = simData.components.find((c) => c.id === wire.to.compId);
      const p1 = pinPosition(fromComp, wire.from.pin);
      const p2 = pinPosition(toComp, wire.to.pin);
      if (p1 && p2) path.setAttribute("d", `M${p1.x},${p1.y} L${p2.x},${p2.y}`);
    });
    const dots = svg.querySelectorAll(`circle[data-comp="${compId}"]`);
    const comp = simData.components.find((c) => c.id === compId);
    const def = comp && REG[comp.type];
    if (def) {
      dots.forEach((dot) => {
        const pinDef = def.pins.find((p) => p.id === dot.dataset.pin);
        if (pinDef) {
          dot.setAttribute("cx", comp.x + pinDef.x);
          dot.setAttribute("cy", comp.y + pinDef.y);
        }
      });
    }
  }

  // Parts that physically plug into a breadboard, Tinkercad-style, rather
  // than dangling on a cable to it. Their lead spacing is deliberately a
  // multiple of the hole grid (see SIM_COMPONENTS), so once the first leg
  // snaps to a hole, every other leg lands exactly on a real neighboring
  // hole too — not just one anchor pin dragging the rest along for show.
  const SNAP_TO_BREADBOARD_TYPES = new Set(["led", "resistor", "switch"]);
  const SNAP_THRESHOLD = 18; // magnetic pull radius while dragging
  const SNAP_EXACT_TOLERANCE = 4; // how close a non-anchor leg must land to also count as plugged in
  // Everything else just snaps to a light alignment grid while dragging.
  // Configurable via the "Snap" dropdown -- 5px is the long-standing
  // default, 0 means no snapping at all (handled as a no-op guard below
  // rather than a divide-by-zero, since rounding to the nearest multiple
  // of 0 is undefined).
  let gridSnapSize = 5;

  function findNearestHole(x, y, excludeCompId, threshold) {
    let best = null;
    simData.components.forEach((c) => {
      if (c.type !== "breadboard" || c.id === excludeCompId) return;
      REG.breadboard.pins.forEach((pin) => {
        const hx = c.x + pin.x;
        const hy = c.y + pin.y;
        const dist = Math.hypot(hx - x, hy - y);
        if (dist <= threshold && (!best || dist < best.dist)) {
          best = { breadboardId: c.id, holeId: pin.id, x: hx, y: hy, dist };
        }
      });
    });
    return best;
  }

  function onComponentPointerDown(e) {
    e.stopPropagation();
    const g = e.currentTarget;
    const compId = g.dataset.id;
    const comp = simData.components.find((c) => c.id === compId);
    if (!comp) return;

    // Shift+click only toggles this part's membership in the selection —
    // it doesn't also start a drag, so building up a multi-selection with
    // several shift-clicks in a row can't accidentally nudge a part.
    if (e.shiftKey) {
      const ids = selectedIds();
      const i = ids.indexOf(compId);
      if (i === -1) ids.push(compId);
      else ids.splice(i, 1);
      setMultiSelection(ids);
      renderInspector();
      renderBuilder();
      return;
    }

    // Clicking a part that's already part of a multi-selection drags the
    // whole group together; clicking anything else collapses to selecting
    // just that one part (the normal, non-multi case).
    const groupIds = selected && selected.kind === "multi" && selected.ids.includes(compId) ? selected.ids : [compId];
    if (groupIds.length === 1) selected = { kind: "component", id: compId };
    renderInspector();
    document.querySelectorAll(".sim-select-box").forEach((n) => n.remove());
    g.classList.add("sim-selected");

    const start = svgPoint(e);
    const startPositions = new Map(groupIds.map((id) => {
      const c = simData.components.find((x) => x.id === id);
      return [id, { x: c.x, y: c.y }];
    }));
    g.setPointerCapture(e.pointerId);
    let historySaved = false;

    // Breadboard auto-snap only applies to a single-part drag — snapping
    // several independently-positioned parts to holes at once as a rigid
    // group doesn't make physical sense, so a group drag is a plain,
    // grid-snapped move instead.
    const isGroup = groupIds.length > 1;
    const canSnap = !isGroup && SNAP_TO_BREADBOARD_TYPES.has(comp.type);
    const anchorPin = canSnap ? REG[comp.type].pins[0] : null;
    let snapTargets = {}; // pinId -> { breadboardId, holeId }

    function onMove(ev) {
      if (!historySaved) {
        pushHistory();
        historySaved = true;
      }
      const p = svgPoint(ev);
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (!canSnap && gridSnapSize > 0) {
        dx = Math.round((startPositions.get(compId).x + dx) / gridSnapSize) * gridSnapSize - startPositions.get(compId).x;
        dy = Math.round((startPositions.get(compId).y + dy) / gridSnapSize) * gridSnapSize - startPositions.get(compId).y;
      }
      groupIds.forEach((id) => {
        const c = simData.components.find((x) => x.id === id);
        const startPos = startPositions.get(id);
        if (!c || !startPos) return;
        c.x = startPos.x + dx;
        c.y = startPos.y + dy;
      });
      if (canSnap) {
        // The first leg gets a generous magnetic pull toward the nearest
        // hole, snapping the whole part into place...
        const anchorAbs = { x: comp.x + anchorPin.x, y: comp.y + anchorPin.y };
        const hole = findNearestHole(anchorAbs.x, anchorAbs.y, compId, SNAP_THRESHOLD);
        if (hole) {
          comp.x += hole.x - anchorAbs.x;
          comp.y += hole.y - anchorAbs.y;
        }
        // ...then every leg (the anchor included) is checked for landing
        // exactly on a real hole — since lead spacing matches the hole
        // grid, a correctly-oriented part's other leg(s) plug in for
        // real too, not just the one being dragged.
        snapTargets = {};
        REG[comp.type].pins.forEach((pin) => {
          const abs = { x: comp.x + pin.x, y: comp.y + pin.y };
          const h = findNearestHole(abs.x, abs.y, compId, hole ? SNAP_EXACT_TOLERANCE : SNAP_THRESHOLD);
          if (h) snapTargets[pin.id] = h;
        });
        g.classList.toggle("sim-snapped", Object.keys(snapTargets).length > 0);
      }
      groupIds.forEach((id) => {
        const c = simData.components.find((x) => x.id === id);
        if (!c) return;
        if (id === compId) g.setAttribute("transform", `translate(${c.x},${c.y})`);
        else {
          const otherG = $("sim-builder-svg").querySelector(`.sim-comp[data-id="${id}"]`);
          if (otherG) otherG.setAttribute("transform", `translate(${c.x},${c.y})`);
        }
        updateWiresForComponent(id);
      });
    }
    function onUp() {
      g.removeEventListener("pointermove", onMove);
      g.removeEventListener("pointerup", onUp);
      if (!historySaved && comp.type === "switch") {
        // A plain click (no drag) on a switch toggles it, like flipping one for real.
        pushHistory();
        comp.closed = comp.closed === false;
        renderInspector();
      }
      if (canSnap) {
        const pinIds = new Set(REG[comp.type].pins.map((p) => p.id));
        simData.wires = simData.wires.filter(
          (w) => !(w.auto && ((w.from.compId === compId && pinIds.has(w.from.pin)) || (w.to.compId === compId && pinIds.has(w.to.pin))))
        );
        Object.entries(snapTargets).forEach(([pinId, target]) => {
          simData.wires.push({
            id: newLocalId("wire"),
            from: { compId, pin: pinId },
            to: { compId: target.breadboardId, pin: target.holeId },
            kind: "wire",
            auto: true,
          });
        });
      }
      renderBuilder();
    }
    g.addEventListener("pointermove", onMove);
    g.addEventListener("pointerup", onUp);
  }

  // A thin wrapper around the same wire-tied-net BFS wireOnlyNetNodes()
  // already computes for the wire-selection highlight -- "continuity"
  // between two probed pins is exactly "are they in the same wire-only
  // net," no separate solver logic needed.
  function handleContinuityClick(compId, pin) {
    const comp = simData.components.find((c) => c.id === compId);
    if (!comp) return;
    const node = window.simNodeId(comp, pin);
    if (!continuityProbe) {
      continuityProbe = { compId, pin, node };
      continuityLastProbe = null;
      $("sim-continuity-result").textContent = "Probe set on one pin -- click a second pin to test continuity.";
      $("sim-continuity-result").classList.remove("sim-continuity-yes", "sim-continuity-no");
      renderBuilder();
      return;
    }
    if (continuityProbe.compId === compId && continuityProbe.pin === pin) {
      // Clicking the same pin twice cancels the probe rather than
      // reporting "connected to itself," which isn't a meaningful
      // continuity result.
      continuityProbe = null;
      $("sim-continuity-result").textContent = "";
      $("sim-continuity-result").classList.remove("sim-continuity-yes", "sim-continuity-no");
      renderBuilder();
      return;
    }
    // The actual Connected/Not-connected text and net highlight are
    // derived fresh in renderBuilder() from this pair of endpoints on
    // every render -- not computed here -- so the result can never go
    // stale relative to whatever simData looks like at render time.
    continuityLastProbe = { compIdA: continuityProbe.compId, pinA: continuityProbe.pin, nodeA: continuityProbe.node, compIdB: compId, pinB: pin, nodeB: node };
    continuityProbe = null;
    renderBuilder();
  }

  function onPinClick(e) {
    e.stopPropagation();
    const dot = e.currentTarget;
    const compId = dot.dataset.comp;
    const pin = dot.dataset.pin;
    if (continuityMode) {
      handleContinuityClick(compId, pin);
      return;
    }
    if (!wireStart) {
      wireStart = { compId, pin };
      renderBuilder();
      return;
    }
    if (wireStart.compId === compId && wireStart.pin === pin) {
      wireStart = null;
      renderBuilder();
      return;
    }
    pushHistory();
    simData.wires.push({
      id: newLocalId("wire"),
      from: { compId: wireStart.compId, pin: wireStart.pin },
      to: { compId, pin },
      kind: "wire",
    });
    wireStart = null;
    renderBuilder();
  }

  // ---------- Palette ----------
  const DEFAULT_CONTENT_BY_TYPE = {
    resistor: { resistance: 220 },
    battery: { voltage: 9 },
    power_supply: { outputVoltage: 5 },
    led: { color: "red" },
    switch: { closed: true },
  };

  // ---------- Recently-used parts ----------
  // A localStorage list rather than per-simulation state -- "what did I
  // just reach for" is a builder-wide habit, not something tied to one
  // circuit, so it should carry over between simulations the same way a
  // real toolbox's most-used bin would.
  const RECENT_TYPES_KEY = "sim_recent_component_types";
  const MAX_RECENT_TYPES = 6;
  function getRecentTypes() {
    try {
      const raw = JSON.parse(localStorage.getItem(RECENT_TYPES_KEY) || "[]");
      // Filters out any type from an older session that no longer exists
      // in the current component registry (e.g. after a component type is
      // ever removed) -- a stale localStorage entry would otherwise
      // silently show a recent-part button that does nothing when clicked.
      // A critic pass found a plain truthy `REG[t]` check doesn't
      // distinguish an own property from one inherited via the prototype
      // chain -- REG is a plain object literal, so a tampered (devtools,
      // or a hypothetical future XSS on this origin) localStorage value
      // like "constructor" or "toString" would resolve to a real,
      // truthy Object.prototype method and pass this filter as if it
      // were a real component type, then crash the whole builder canvas
      // the moment it's placed (every render path assumes REG[comp.type]
      // is a real component definition with .pins/.render, which a bare
      // function has neither of). hasOwnProperty + a string-type check
      // closes that off entirely.
      return Array.isArray(raw) ? raw.filter((t) => typeof t === "string" && Object.prototype.hasOwnProperty.call(REG, t)) : [];
    } catch {
      return [];
    }
  }
  function recordRecentType(type) {
    const list = getRecentTypes().filter((t) => t !== type);
    list.unshift(type);
    try {
      localStorage.setItem(RECENT_TYPES_KEY, JSON.stringify(list.slice(0, MAX_RECENT_TYPES)));
    } catch {
      // localStorage can throw in a private-browsing/storage-blocked
      // context -- recent-parts is a convenience, not a feature anything
      // else depends on, so failing silently here is correct.
    }
  }
  function renderRecentPalette() {
    const container = $("sim-palette-recent");
    const recent = getRecentTypes();
    container.hidden = recent.length === 0;
    container.innerHTML =
      `<h3>Recently used</h3>` +
      recent
        .map((type) => `<button type="button" class="sim-palette-recent-btn" data-sim-type="${escapeXml(type)}">${escapeXml(REG[type].label)}</button>`)
        .join("");
    container.querySelectorAll(".sim-palette-recent-btn").forEach((btn) => {
      btn.addEventListener("click", () => addComponentFromPalette(btn.dataset.simType));
    });
  }

  function addComponentFromPalette(type) {
    pushHistory();
    const def = REG[type];
    const pos = nextPlacement(def);
    simData.components.push({
      id: newLocalId(type),
      type,
      x: pos.x,
      y: pos.y,
      label: def.label,
      ...(DEFAULT_CONTENT_BY_TYPE[type] || {}),
    });
    recordRecentType(type);
    renderRecentPalette();
    renderBuilder();
  }

  document.querySelectorAll(".sim-palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => addComponentFromPalette(btn.dataset.simType));
  });

  $("sim-palette-search").addEventListener("input", (e) => {
    const q = e.target.value.trim().toLowerCase();
    document.querySelectorAll(".sim-palette-btn").forEach((btn) => {
      btn.classList.toggle("is-hidden-by-search", q.length > 0 && !btn.textContent.toLowerCase().includes(q));
    });
  });

  // ---------- Inspector ----------
  function renderInspector() {
    const box = $("sim-inspector");
    if (!selected) {
      box.innerHTML =
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Click a part or a wire to edit it. Click a pin, then another pin, to wire them. Shift+click parts, or drag a box over empty canvas, to select several at once.</p>" +
        "<p style='color:var(--text-dim);font-size:0.85rem;'>The breadboard is a real 30-column layout with independent power rails on both the top AND bottom edges (each rail line is one long connection), plus a terminal strip split by the center gutter — each of its 30 columns is its own independent connection, so plugging into the same column connects things, different columns don't. The top rails and bottom rails aren't connected to each other either. Wire outlet → power supply → a rail → a column → resistor bridging to another column → LED → back to the other rail.</p>" +
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Power needs a complete loop, and the numbers matter now: too little resistance burns out an LED, no resistor at all is a dead short, and wiring straight to the Wall Outlet (120V) destroys anything downstream — it must go through a Power Supply first. A backwards LED won't light even on an otherwise-complete loop, same as a real one.</p>";
      return;
    }
    if (selected.kind === "component") {
      const comp = simData.components.find((c) => c.id === selected.id);
      if (!comp) return;
      const def = REG[comp.type];
      const { poweredComps, poweredNodes } = window.computeSimPoweredSet(simData);
      const analysis = window.computeSimElectricalAnalysis(simData);
      const info = analysis[comp.id];
      const isPowered = poweredComps.has(comp.id);
      let statusLine;
      if (def.isSource) {
        statusLine = "⚡ Power source";
      } else if (isPowered) {
        statusLine = "⚡ Part of a complete circuit";
      } else if (def.polarity) {
        const posNode = window.simNodeId(comp, def.polarity.pos);
        const negNode = window.simNodeId(comp, def.polarity.neg);
        const bothReached = poweredNodes.has(posNode) && poweredNodes.has(negNode);
        statusLine = bothReached ? "Both legs reach power, but wired backwards" : "Not part of a complete circuit yet";
      } else {
        statusLine = "Not part of a complete circuit yet";
      }

      let electricalHtml = "";
      if (info) {
        const ma = info.currentMa === Infinity ? "∞" : info.currentMa.toFixed(1);
        if (info.kind === "led") {
          const messages = {
            burnt: info.dangerous
              ? `🔥 Destroyed instantly — ${info.voltage}V mains has no business touching an LED directly. Route it through a Power Supply.`
              : `🔥 Burnt out — ${ma}mA is way more current than an LED can take (safe is under 30mA). Add a bigger resistor.`,
            overdriven: `⚠ Overdriven at ${ma}mA — it'll be too bright and won't last (safe is under 30mA).`,
            "unlit-low-voltage": "Not enough voltage in this loop to light it.",
            dim: `Barely lit — only ${ma}mA is flowing. Try a smaller resistor.`,
            normal: `✓ ${ma}mA — a healthy, safe current.`,
          };
          electricalHtml = `<p class="sim-power-status ${info.status === "normal" ? "is-powered" : "is-danger"}">${messages[info.status] || ""}</p>`;
        } else if (info.kind === "resistor") {
          if (info.dangerous) {
            electricalHtml = `<p class="sim-power-status is-danger">🔥 Charred instantly — this loop is running straight off 120V mains.</p>`;
          } else if (info.status === "overheating") {
            electricalHtml = `<p class="sim-power-status is-danger">🔥 Overheating — dissipating ${info.watts.toFixed(2)}W, more than a typical 1/4W resistor can handle.</p>`;
          } else {
            electricalHtml = `<p class="sim-power-status is-powered">✓ ${ma}mA flowing, dissipating ${info.watts.toFixed(2)}W — well within its rating.</p>`;
          }
        } else if (info.kind === "teensy") {
          electricalHtml = info.dangerous
            ? `<p class="sim-power-status is-danger">🔥 Destroyed instantly — 120V mains directly to a microcontroller.</p>`
            : `<p class="sim-power-status is-powered">Drawing ~${ma}mA at ${info.voltage}V.</p>`;
        }
      }

      let extraFieldsHtml = "";
      // Coerced through Number() (falling back to the same default the
      // field already used for "unset") rather than just escaped -- these
      // are semantically numeric fields, so a non-numeric value can only
      // ever have gotten here via unvalidated JSON import, and a critic
      // pass found the previous version interpolated it straight into
      // value="..." with no escaping at all, letting a crafted string
      // (e.g. `1" autofocus onfocus=alert(1) x="`) break out of the
      // attribute. Number()'s output can never contain HTML-significant
      // characters, so this closes the injection and fixes the
      // semantically-wrong display (a stray string) in one step.
      if (comp.type === "resistor") {
        extraFieldsHtml = `<label>Resistance (ohms)<input id="sim-comp-resistance" type="number" min="1" value="${Number(comp.resistance) || 220}"></label>`;
      } else if (comp.type === "battery") {
        extraFieldsHtml = `<label>Voltage (V)<input id="sim-comp-voltage" type="number" min="0.1" step="0.1" value="${Number(comp.voltage) || 9}"></label>`;
      } else if (comp.type === "power_supply") {
        extraFieldsHtml = `<label>Output voltage<select id="sim-comp-output-voltage">${[3.3, 5, 9, 12]
          .map((v) => `<option value="${v}" ${Number(comp.outputVoltage) === v ? "selected" : ""}>${v}V DC</option>`)
          .join("")}</select></label>`;
      } else if (comp.type === "led") {
        extraFieldsHtml = `<label>Color<select id="sim-comp-led-color">${Object.entries(window.LED_COLORS)
          .map(([key, c]) => `<option value="${key}" ${(comp.color || "red") === key ? "selected" : ""}>${c.label}</option>`)
          .join("")}</select></label>`;
      } else if (comp.type === "switch") {
        const closed = comp.closed !== false;
        extraFieldsHtml = `<label><input type="checkbox" id="sim-comp-switch-closed" ${closed ? "checked" : ""}> Closed (conducting) — click the part on the canvas to flip it too</label>`;
      } else if (comp.type === "outlet") {
        extraFieldsHtml = `<p style="color:var(--text-dim);font-size:0.8rem;">Fixed 120V AC, like a real wall outlet. Never wire it directly to a breadboard part — it must go through a Power Supply, or everything downstream is destroyed instantly.</p>`;
      }

      box.innerHTML = `
        <p><strong>${escapeXml(def.label)}</strong></p>
        <p class="sim-power-status ${isPowered || def.isSource ? "is-powered" : ""}">${statusLine}</p>
        ${electricalHtml}
        ${extraFieldsHtml}
        <label>Label${comp.type === "mcu_teensy" ? " (shown on the part)" : " (shown as a hover tooltip, including on the public embed)"}<input id="sim-comp-label" type="text" value="${escapeXml(comp.label || "")}"></label>
        <label>Datasheet link (for your own reference -- admin only, not shown on the public embed)<input id="sim-comp-datasheet" type="url" placeholder="https://…" value="${escapeXml(comp.datasheetUrl || "")}"></label>
        <a id="sim-datasheet-link" class="sim-datasheet-link" href="${escapeXml(safeHref(comp.datasheetUrl || ""))}" target="_blank" rel="noopener noreferrer" ${
          comp.datasheetUrl ? "" : "hidden"
        }>Open datasheet ↗</a>
        <button type="button" id="sim-duplicate-selected">Duplicate part</button>
        <button type="button" id="sim-delete-selected" class="danger">Delete part</button>
      `;

      const resistanceInput = $("sim-comp-resistance");
      if (resistanceInput) {
        resistanceInput.addEventListener("change", () => {
          pushHistory();
          comp.resistance = Math.max(1, Number(resistanceInput.value) || 220);
          renderInspector();
          renderBuilder();
        });
      }
      const voltageInput = $("sim-comp-voltage");
      if (voltageInput) {
        voltageInput.addEventListener("change", () => {
          pushHistory();
          comp.voltage = Math.max(0.1, Number(voltageInput.value) || 9);
          renderInspector();
          renderBuilder();
        });
      }
      const outputVoltageInput = $("sim-comp-output-voltage");
      if (outputVoltageInput) {
        outputVoltageInput.addEventListener("change", () => {
          pushHistory();
          comp.outputVoltage = Number(outputVoltageInput.value);
          renderInspector();
          renderBuilder();
        });
      }
      const ledColorInput = $("sim-comp-led-color");
      if (ledColorInput) {
        ledColorInput.addEventListener("change", () => {
          pushHistory();
          comp.color = ledColorInput.value;
          renderInspector();
          renderBuilder();
        });
      }
      const switchClosedInput = $("sim-comp-switch-closed");
      if (switchClosedInput) {
        switchClosedInput.addEventListener("change", () => {
          pushHistory();
          comp.closed = switchClosedInput.checked;
          renderInspector();
          renderBuilder();
        });
      }
      const labelInput = $("sim-comp-label");
      let labelHistorySaved = false;
      labelInput.addEventListener("input", () => {
        if (!labelHistorySaved) {
          pushHistory();
          labelHistorySaved = true;
        }
        comp.label = labelInput.value;
        renderBuilder();
      });
      labelInput.addEventListener("blur", () => {
        labelHistorySaved = false;
      });
      const datasheetInput = $("sim-comp-datasheet");
      const datasheetLink = $("sim-datasheet-link");
      let datasheetHistorySaved = false;
      datasheetInput.addEventListener("input", () => {
        if (!datasheetHistorySaved) {
          pushHistory();
          datasheetHistorySaved = true;
        }
        comp.datasheetUrl = datasheetInput.value;
        // Updates the link's own attributes directly instead of a full
        // renderInspector() call -- a critic pass found the original
        // blur-triggered re-render replaced the ENTIRE inspector panel's
        // innerHTML, including the anchor itself, so clicking the just-
        // appeared "Open datasheet" link (which fires a blur on the input
        // first) tore down and rebuilt the very element being clicked out
        // from under the in-flight click, silently swallowing that first
        // click. Setting the href/hidden state directly on every
        // keystroke keeps the same element alive throughout, so it's
        // always immediately clickable with no rebuild in the way.
        datasheetLink.href = safeHref(comp.datasheetUrl) || "#";
        datasheetLink.hidden = !comp.datasheetUrl;
      });
      datasheetInput.addEventListener("blur", () => {
        datasheetHistorySaved = false;
      });
      $("sim-duplicate-selected").addEventListener("click", () => {
        pushHistory();
        const clone = JSON.parse(JSON.stringify(comp));
        clone.id = newLocalId(comp.type);
        clone.x = comp.x + 20;
        clone.y = comp.y + 20;
        simData.components.push(clone);
        selected = { kind: "component", id: clone.id };
        renderInspector();
        renderBuilder();
      });
      $("sim-delete-selected").addEventListener("click", () => {
        pushHistory();
        simData.components = simData.components.filter((c) => c.id !== comp.id);
        simData.wires = simData.wires.filter((w) => w.from.compId !== comp.id && w.to.compId !== comp.id);
        selected = null;
        renderInspector();
        renderBuilder();
      });
    } else if (selected.kind === "multi") {
      const ids = new Set(selected.ids);
      box.innerHTML = `
        <p><strong>${ids.size} parts selected</strong></p>
        <p style="color:var(--text-dim);font-size:0.85rem;">Drag any one of them to move the whole group. Shift+click a part to remove it from the selection.</p>
        <button type="button" id="sim-duplicate-selected">Duplicate all</button>
        <button type="button" id="sim-delete-selected" class="danger">Delete all</button>
      `;
      $("sim-duplicate-selected").addEventListener("click", () => {
        pushHistory();
        const idMap = new Map();
        const clones = selected.ids.map((id) => {
          const src = simData.components.find((c) => c.id === id);
          const clone = JSON.parse(JSON.stringify(src));
          clone.id = newLocalId(clone.type);
          clone.x = src.x + 20;
          clone.y = src.y + 20;
          idMap.set(id, clone.id);
          return clone;
        });
        simData.components.push(...clones);
        // Wires between two components that were BOTH selected get cloned
        // along with them, so a duplicated sub-circuit stays wired to
        // itself instead of landing as disconnected loose parts.
        simData.wires.forEach((w) => {
          if (idMap.has(w.from.compId) && idMap.has(w.to.compId)) {
            simData.wires.push({
              id: newLocalId("wire"),
              from: { compId: idMap.get(w.from.compId), pin: w.from.pin },
              to: { compId: idMap.get(w.to.compId), pin: w.to.pin },
              kind: w.kind,
            });
          }
        });
        setMultiSelection(clones.map((c) => c.id));
        renderInspector();
        renderBuilder();
      });
      $("sim-delete-selected").addEventListener("click", () => {
        pushHistory();
        simData.components = simData.components.filter((c) => !ids.has(c.id));
        simData.wires = simData.wires.filter((w) => !ids.has(w.from.compId) && !ids.has(w.to.compId));
        selected = null;
        renderInspector();
        renderBuilder();
      });
    } else if (selected.kind === "wire") {
      const wire = simData.wires.find((w) => w.id === selected.id);
      if (!wire) return;
      const { poweredWires } = window.computeSimPoweredSet(simData);
      const isPowered = poweredWires.has(wire.id);
      box.innerHTML = `
        <p><strong>Wire</strong></p>
        <p class="sim-power-status ${isPowered ? "is-powered" : ""}">${isPowered ? "⚡ Carries power" : "Not carrying power"}</p>
        <label>Style
          <select id="sim-wire-kind">
            <option value="wire" ${wire.kind === "wire" ? "selected" : ""}>Wire</option>
            <option value="hdmi" ${wire.kind === "hdmi" ? "selected" : ""}>Cable (HDMI-style)</option>
          </select>
        </label>
        <label>Thickness
          <select id="sim-wire-thickness">
            <option value="thin" ${wire.thickness === "thin" ? "selected" : ""}>Thin</option>
            <option value="normal" ${wire.thickness === "thick" || wire.thickness === "thin" ? "" : "selected"}>Normal</option>
            <option value="thick" ${wire.thickness === "thick" ? "selected" : ""}>Thick</option>
          </select>
        </label>
        <label>Label (shown on the canvas, e.g. "GND" or "5V")<input id="sim-wire-label" type="text" value="${escapeXml(
          wire.label || ""
        )}"></label>
        <button type="button" id="sim-delete-selected" class="danger">Delete wire</button>
      `;
      $("sim-wire-kind").addEventListener("change", (e) => {
        pushHistory();
        wire.kind = e.target.value;
        renderBuilder();
      });
      $("sim-wire-thickness").addEventListener("change", (e) => {
        pushHistory();
        // "normal" is stored as the field simply being absent/undefined
        // (matching every other wire that predates this feature and never
        // set a thickness at all) rather than the literal string "normal"
        // -- one less state a future reader has to remember is equivalent
        // to "unset".
        wire.thickness = e.target.value === "normal" ? undefined : e.target.value;
        renderBuilder();
      });
      const wireLabelInput = $("sim-wire-label");
      let wireLabelHistorySaved = false;
      wireLabelInput.addEventListener("input", () => {
        if (!wireLabelHistorySaved) {
          pushHistory();
          wireLabelHistorySaved = true;
        }
        wire.label = wireLabelInput.value;
        renderBuilder();
      });
      wireLabelInput.addEventListener("blur", () => {
        wireLabelHistorySaved = false;
      });
      $("sim-delete-selected").addEventListener("click", () => {
        pushHistory();
        simData.wires = simData.wires.filter((w) => w.id !== wire.id);
        selected = null;
        renderInspector();
        renderBuilder();
      });
    }
  }

  // ---------- Zoom ----------
  // On a wide screen, 100% fits the container (CSS width:100%) — the
  // board is comfortably readable shrunk to fit. On a phone, fitting a
  // 1500-unit-wide board into a ~390px screen shrinks pins/holes past the
  // point of being tappable, which is the opposite of what "100%" should
  // mean there — so on mobile, every zoom level (100% included) renders
  // at a real, explicit pixel size instead, and the wrapping
  // .sim-builder-canvas (overflow: auto) becomes a pannable scroll area,
  // the way Tinkercad's own mobile view works: you scroll/pinch around a
  // true-size board rather than seeing a tiny whole board at once.
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  const isMobileBuilder = () => window.matchMedia("(max-width: 860px)").matches;
  // A phone's starting zoom is deliberately below 1 — big enough to
  // actually tap a pin, small enough that getting oriented doesn't take
  // several screens of scrolling before you've placed a single part.
  const defaultZoomLevel = () => (isMobileBuilder() ? 0.5 : 1);
  let zoomLevel = 1;

  function applyZoom() {
    const svg = $("sim-builder-svg");
    if (svg) {
      if (zoomLevel === 1 && !isMobileBuilder()) {
        svg.style.width = "";
        svg.style.height = "";
      } else {
        svg.style.width = `${1500 * zoomLevel}px`;
        svg.style.height = `${700 * zoomLevel}px`;
      }
    }
    $("sim-zoom-reset").textContent = `${Math.round(zoomLevel * 100)}%`;
  }

  function stepZoom(dir) {
    const i = ZOOM_STEPS.indexOf(zoomLevel);
    const next = ZOOM_STEPS[Math.max(0, Math.min(ZOOM_STEPS.length - 1, (i === -1 ? 2 : i) + dir))];
    zoomLevel = next;
    applyZoom();
  }

  $("sim-zoom-in").addEventListener("click", () => stepZoom(1));
  $("sim-zoom-out").addEventListener("click", () => stepZoom(-1));
  $("sim-zoom-reset").addEventListener("click", () => {
    zoomLevel = defaultZoomLevel();
    applyZoom();
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    if ($("simulation-builder-modal").hidden) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const isTyping = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redoHistory();
      else undoHistory();
      return;
    }
    if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redoHistory();
      return;
    }
    if (isTyping) return;
    if ((e.key === "Delete" || e.key === "Backspace") && selected) {
      e.preventDefault();
      const btn = $("sim-delete-selected");
      if (btn) btn.click();
    }
  });

  // ---------- Export / Import ----------
  $("sim-export").addEventListener("click", () => {
    const name = ($("simulation-name").value || "simulation").trim().replace(/[^a-z0-9-_]+/gi, "-");
    const blob = new Blob([JSON.stringify(simData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${name || "simulation"}.json`;
    a.click();
    URL.revokeObjectURL(url);
  });

  $("sim-import").addEventListener("click", () => $("sim-import-file").click());
  $("sim-import-file").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.components) || !Array.isArray(parsed.wires)) {
        throw new Error("That file doesn't look like a circuit export (expected components/wires arrays).");
      }
      pushHistory();
      simData = parsed;
      selected = null;
      wireStart = null;
      renderInspector();
      renderBuilder();
    } catch (err) {
      alert(`Couldn't import that file: ${err.message}`);
    }
  });

  // ---------- Preview power toggle ----------
  $("sim-preview-power").addEventListener("click", () => {
    previewOn = !previewOn;
    $("sim-preview-power").textContent = previewOn ? "Power off" : "Preview: power on";
    renderBuilder();
  });

  // ---------- Save ----------
  $("save-simulation").addEventListener("click", async () => {
    const name = $("simulation-name").value.trim();
    if (!name) return alert("Name is required.");
    // Checkpoints ride along inside the saved `data` blob (so they
    // persist across reloads) but are kept out of `simData` itself the
    // rest of the time, purely to avoid every undo-stack entry
    // duplicating every checkpoint's full circuit snapshot -- see the
    // comment on simCheckpoints above. The poster/share image is a plain
    // string read straight from its own input at save time, same as the
    // name field -- not part of simData/undo history either, since it's
    // page-level metadata, not circuit state.
    const payloadData = { ...simData, checkpoints: simCheckpoints, og_image: $("sim-poster-url").value.trim() || null };
    try {
      if (currentSimId) {
        await window.adminApi(`/simulations/${currentSimId}`, { method: "PATCH", body: JSON.stringify({ name, data: payloadData }) });
      } else {
        const res = await window.adminApi("/simulations", { method: "POST", body: JSON.stringify({ name, data: payloadData }) });
        currentSimId = res.id;
      }
      // Keeps "Reset" meaning "back to the last save" rather than "back to
      // whatever this modal loaded with" -- the modal stays open after a
      // save, so without this a Reset later in the same session would
      // silently discard already-saved work, not just this session's
      // in-progress edits.
      initialSimSnapshot = JSON.stringify(simData);
      alert("Saved.");
      if (window.refreshSimulationOptions) window.refreshSimulationOptions();
    } catch (err) {
      alert(err.message);
    }
  });

  $("sim-reset").addEventListener("click", resetSimToInitial);
})();
