(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const REG = window.SIM_COMPONENTS;

  let simulations = [];
  let currentSimId = null;
  let openBuilderRequestId = 0;
  let simData = { components: [], wires: [] };
  let selected = null; // { kind: "component" | "wire", id }
  let breadboardResizeNotice = "";
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
    setSnapHoleWarning(0);
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
    setSnapHoleWarning(0);
    undoStack.push(JSON.stringify(simData));
    simData = JSON.parse(redoStack.pop());
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
  }

  function captureInitialSimulationSnapshot() {
    return JSON.stringify({
      simData,
      simCheckpoints,
      name: $("simulation-name").value.trim(),
      posterUrl: $("sim-poster-url").value.trim(),
    });
  }

  function resetSimToInitial() {
    if (!initialSimSnapshot) return;
    if (!confirm("Discard all edits and go back to the last saved state?")) return;
    const initialState = JSON.parse(initialSimSnapshot);
    setSnapHoleWarning(0);
    pushHistory();
    simData = initialState.simData;
    simCheckpoints = initialState.simCheckpoints;
    $("simulation-name").value = initialState.name;
    $("sim-poster-url").value = initialState.posterUrl;
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderCheckpointSelect();
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

  function isValidSimulationBuilderId(value) {
    return (
      typeof value === "string" &&
      value.length > 0 &&
      value.length <= 160 &&
      !Object.prototype.hasOwnProperty.call(Object.prototype, value)
    ) || Number.isSafeInteger(value);
  }

  function normalizeSimulationBuilderIds(data) {
    if (!data || typeof data !== "object" || Array.isArray(data)) return data;
    if (Array.isArray(data.wires)) {
      const usedIds = new Set();
      data.wires.forEach((wire) => {
        if (!wire || typeof wire !== "object" || Array.isArray(wire)) return;
        let key = isValidSimulationBuilderId(wire.id) ? String(wire.id) : "";
        if (!key || usedIds.has(key)) {
          do {
            wire.id = newLocalId("wire");
            key = String(wire.id);
          } while (usedIds.has(key));
        }
        usedIds.add(key);
      });
    }
    if (Array.isArray(data.checkpoints)) {
      data.checkpoints.forEach((checkpoint) => normalizeSimulationBuilderIds(checkpoint && checkpoint.data));
    }
    return data;
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
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><small class="simulation-publication-status">${
              s.is_published ? "Published" : "Draft"
            }</small>${s.is_published ? `<a href="/simulation/${s.id}" target="_blank" rel="noopener" class="view-simulation-link">View ↗</a>` : ""}<button type="button" class="publish-simulation" data-id="${
              s.id
            }" aria-label="${s.is_published ? "Publish updates for" : "Publish"} ${escapeXml(s.name)}">${s.is_published ? "Publish updates" : "Publish"}</button>${s.is_published ? `<button type="button" class="unpublish-simulation" data-id="${s.id}" aria-label="Unpublish ${escapeXml(s.name)}">Unpublish</button>` : ""}<button type="button" class="usage-simulation" data-id="${
              s.id
            }" data-name="${escapeXml(s.name)}" title="See which pages/projects use this simulation">Usage</button><button type="button" class="duplicate-simulation" data-id="${
              s.id
            }">Duplicate</button><button type="button" class="edit-simulation" data-id="${
              s.id
            }">Edit</button><button type="button" class="delete-simulation" data-id="${s.id}">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No simulations yet.</p>";

    $("simulations-list")
      .querySelectorAll(".publish-simulation")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          const simulation = simulations.find((item) => item.id === Number(btn.dataset.id));
          const action = simulation && simulation.is_published ? "Publish the saved draft changes" : "Publish this simulation";
          if (!confirm(`${action}? Visitors will see this version publicly.`)) return;
          try {
            await window.adminApi(`/simulations/${btn.dataset.id}/publish`, { method: "POST" });
            await loadSimulationsList();
            $("simulations-list").querySelector(`.publish-simulation[data-id="${Number(btn.dataset.id)}"]`)?.focus();
            if (window.refreshSimulationOptions) window.refreshSimulationOptions();
          } catch (err) {
            alert(err.message);
          }
        })
      );
    $("simulations-list")
      .querySelectorAll(".unpublish-simulation")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          const simulation = simulations.find((item) => item.id === Number(btn.dataset.id));
          if (!confirm(`Unpublish ${simulation ? `“${simulation.name}”` : "this simulation"}? Visitors will no longer see it.`)) return;
          try {
            await window.adminApi(`/simulations/${btn.dataset.id}/unpublish`, { method: "POST" });
            await loadSimulationsList();
            $("simulations-list").querySelector(`.publish-simulation[data-id="${Number(btn.dataset.id)}"]`)?.focus();
            if (window.refreshSimulationOptions) window.refreshSimulationOptions();
          } catch (err) {
            alert(err.message);
          }
        })
      );
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
            ? `This simulation is used in: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those blocks will be omitted from public pages until replaced.`
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
  $("close-simulations").addEventListener("click", () => { openBuilderRequestId++; $("simulations-modal").hidden = true; });
  $("new-simulation-btn").addEventListener("click", () => {
    const templateId = Number($("sim-template-picker").value) || null;
    openBuilder(null, templateId);
  });

  // ---------- Open / close builder ----------
  async function openBuilder(id, templateId) {
    const requestId = ++openBuilderRequestId;
    setSnapHoleWarning(0);
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
      let sim;
      try {
        sim = await window.adminApi(`/simulations/${id}`);
      } catch (err) {
        if (requestId !== openBuilderRequestId) return;
        currentSimId = null;
        alert(`Couldn't load that simulation: ${err.message || "Request failed"}`);
        return;
      }
      if (requestId !== openBuilderRequestId) return;
      const savedData = sim && sim.data ? sim.data : { components: [], wires: [] };
      try {
        normalizeSimulationBuilderIds(savedData);
        validateSimulationStructure(savedData);
      } catch (err) {
        currentSimId = null;
        alert(`Couldn't open that simulation: ${err.message}`);
        return;
      }
      $("simulation-name").value = sim && sim.name ? sim.name : "Simulation";
      const components = Array.isArray(savedData.components) ? savedData.components : [];
      const wires = Array.isArray(savedData.wires) ? savedData.wires : [];
      simData = { components, wires };
      simCheckpoints = Array.isArray(savedData.checkpoints) ? savedData.checkpoints : [];
      $("sim-poster-url").value = savedData.og_image || "";
    } else if (templateId) {
      const t = simTemplates.find((x) => x.id === templateId);
      $("simulation-name").value = "New simulation";
      let templateData = { components: [], wires: [] };
      if (t) {
        try {
          if (!t.data || typeof t.data !== "object" || Array.isArray(t.data)) {
            throw new Error("Simulation data must be an object.");
          }
          // Older templates omitted circuit arrays; preserve their previous
          // empty-circuit defaults while still rejecting malformed values.
          const normalizedTemplateData = { ...t.data };
          if (!Object.prototype.hasOwnProperty.call(normalizedTemplateData, "components")) {
            normalizedTemplateData.components = [];
          }
          if (!Object.prototype.hasOwnProperty.call(normalizedTemplateData, "wires")) {
            normalizedTemplateData.wires = [];
          }
          normalizeSimulationBuilderIds(normalizedTemplateData);
          validateSimulationStructure(normalizedTemplateData, true);
          templateData = normalizedTemplateData;
        } catch (err) {
          currentSimId = null;
          alert(`Couldn't open that template: ${err.message}`);
          return;
        }
      }
      simData = JSON.parse(JSON.stringify({ components: templateData.components, wires: templateData.wires }));
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
    initialSimSnapshot = captureInitialSimulationSnapshot();
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
    openBuilderRequestId++;
    $("simulation-builder-modal").hidden = true;
    $("simulations-modal").hidden = false;
    // The list behind the builder was last loaded before this edit/create —
    // refresh it so a just-saved simulation actually shows up (and any
    // action taken on the list, like Duplicate, targets current rows).
    loadSimulationsList().catch(() => {});
  });

  // ---------- Rendering the live builder SVG ----------
  function pinPosition(comp, pinId) {
    if (
      !comp ||
      typeof comp !== "object" ||
      Array.isArray(comp) ||
      !Object.prototype.hasOwnProperty.call(REG, comp.type) ||
      !Number.isFinite(comp.x) ||
      !Number.isFinite(comp.y) ||
      comp.x < 0 ||
      comp.x > 1500 ||
      comp.y < 0 ||
      comp.y > 700
    ) return null;
    const def = window.getSimComponentDefinition(comp);
    if (!def) return null;
    const pin = def.pins.find((p) => p.id === pinId);
    return pin ? { x: comp.x + pin.x, y: comp.y + pin.y } : null;
  }

  function renderComponentSvg(comp, poweredComps, analysis) {
    if (
      !comp ||
      typeof comp !== "object" ||
      Array.isArray(comp) ||
      !Object.prototype.hasOwnProperty.call(REG, comp.type) ||
      !Number.isFinite(comp.x) ||
      !Number.isFinite(comp.y) ||
      comp.x < 0 ||
      comp.x > 1500 ||
      comp.y < 0 ||
      comp.y > 700
    ) return "";
    const def = window.getSimComponentDefinition(comp);
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
    // Mirrors the public embed's own live reading (worker/simulation-
    // render.js) -- an ammeter's whole reason for existing is showing a
    // number, so the admin canvas shows it directly on the part too, not
    // just in the separate inspector panel one has to select the part to see.
    const readingSvg =
      comp.type === "ammeter" && info
        ? `<text class="ammeter-reading" x="20" y="32" text-anchor="middle" font-size="8">${
            info.currentMa === Infinity ? "∞" : info.currentMa.toFixed(1)
          }mA</text>`
        : "";
    return `<g class="sim-comp sim-comp-${comp.type}${sel ? " sim-selected" : ""}${damaged ? " sim-damaged" : ""}${
      searchMatch ? " sim-search-match" : ""
    }" data-id="${escapeXml(
      comp.id
    )}" data-powered="${poweredComps.has(comp.id) ? "true" : "false"}" transform="translate(${comp.x},${
      comp.y
    })">${titleSvg}${def.render(comp)}${readingSvg}${sel ? `<rect class="sim-select-box" x="-4" y="-4" width="${def.w + 8}" height="${def.h + 8}" />` : ""}${
      searchMatch ? `<rect class="sim-search-match-box" x="-6" y="-6" width="${def.w + 12}" height="${def.h + 12}" />` : ""
    }</g>`;
  }

  // Optional presentation-only route bends; electrical connectivity still uses wire.from/to.
  const MAX_MANUAL_WIRE_WAYPOINTS = 20;

  function getSimulationCanvasBounds(components = simData.components) {
    let width = 1500;
    let height = 700;
    for (const component of Array.isArray(components) ? components : []) {
      const definition = window.getSimComponentDefinition(component);
      if (!definition || !Number.isFinite(component.x) || !Number.isFinite(component.y)) continue;
      width = Math.max(width, component.x + definition.w + 20);
      height = Math.max(height, component.y + definition.h + 20);
    }
    return { width, height };
  }

  function hasValidWireWaypoints(wire, bounds = getSimulationCanvasBounds()) {
    if (!wire || !Object.prototype.hasOwnProperty.call(wire, "waypoints")) return true;
    const points = wire.waypoints;
    return Array.isArray(points) &&
      points.length <= MAX_MANUAL_WIRE_WAYPOINTS &&
      !(wire.auto === true && points.length > 0) &&
      points.every((point) =>
        point &&
        typeof point === "object" &&
        !Array.isArray(point) &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y) &&
        point.x >= 0 &&
        point.x <= bounds.width &&
        point.y >= 0 &&
        point.y <= bounds.height
      );
  }

  function hasInvalidWireWaypoints(wire) {
    return !hasValidWireWaypoints(wire);
  }

  function getWireWaypoints(wire) {
    if (!wire || wire.auto === true || !Array.isArray(wire.waypoints) || !hasValidWireWaypoints(wire)) return [];
    return wire.waypoints.map((point) => ({ x: point.x, y: point.y }));
  }

  function getWireRoutePoints(wire, p1, p2) {
    return [p1, ...getWireWaypoints(wire), p2];
  }

  function getWireRoutePath(points) {
    return points.map((point, index) => (index === 0 ? "M" : "L") + point.x + "," + point.y).join(" ");
  }

  // Places labels halfway along the visible route rather than halfway
  // between component pins, which can be far away from a bent wire.
  function getWireLabelPosition(points) {
    if (!points.length) return { x: 0, y: 0 };
    let longestIndex = -1;
    let longestLength = 0;
    for (let i = 0; i < points.length - 1; i++) {
      const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      if (length > longestLength) {
        longestLength = length;
        longestIndex = i;
      }
    }
    if (longestIndex < 0) return { x: points[0].x, y: points[0].y };
    // Center labels on a straight segment, not on a waypoint where two
    // segments meet; this keeps multi-bend labels from sitting on a corner.
    return {
      x: (points[longestIndex].x + points[longestIndex + 1].x) / 2,
      y: (points[longestIndex].y + points[longestIndex + 1].y) / 2,
    };
  }

  function setWireWaypoints(wire, points) {
    if (points.length) wire.waypoints = points;
    else delete wire.waypoints;
  }
  function validateSimulationStructure(data, requireCircuitArrays = false, allowCheckpoints = true) {
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new Error("Simulation data must be an object.");
    }
    const hasComponents = Object.prototype.hasOwnProperty.call(data, "components");
    const hasWires = Object.prototype.hasOwnProperty.call(data, "wires");
    if ((requireCircuitArrays || hasComponents) && !Array.isArray(data.components)) {
      throw new Error("Simulation components must be an array.");
    }
    if ((requireCircuitArrays || hasWires) && !Array.isArray(data.wires)) {
      throw new Error("Simulation wires must be an array.");
    }
    const components = Array.isArray(data.components) ? data.components : [];
    const wires = Array.isArray(data.wires) ? data.wires : [];
    const validId = isValidSimulationBuilderId;
    const componentsById = new Map();
    const renderedComponentIds = new Set();
    components.forEach((component, index) => {
      if (
        !component ||
        typeof component !== "object" ||
        Array.isArray(component) ||
        !validId(component.id) ||
        componentsById.has(component.id) ||
        typeof component.type !== "string" ||
        !Object.prototype.hasOwnProperty.call(REG, component.type) ||
        !Number.isFinite(component.x) ||
        !Number.isFinite(component.y) ||
        component.x < 0 ||
        component.x > 1500 ||
        component.y < 0 ||
        component.y > 700
      ) {
        throw new Error(`Component ${index + 1} must have a unique id, supported type, and numeric coordinates inside the builder canvas.`);
      }
      if (
        component.type === "breadboard" &&
        Object.prototype.hasOwnProperty.call(component, "cols") &&
        !window.SIM_BREADBOARD_COLUMN_OPTIONS.includes(Number(component.cols))
      ) {
        throw new Error(`Component ${index + 1} has an unsupported breadboard size. Choose 15, 30, or 45 columns.`);
      }
      const renderedId = String(component.id);
      if (renderedComponentIds.has(renderedId)) {
        throw new Error(`Component ${index + 1} has an id that collides in the builder canvas.`);
      }
      renderedComponentIds.add(renderedId);
      componentsById.set(component.id, component);
    });
    const wireIds = new Set();
    wires.forEach((wire, index) => {
      const validEnd = (end) => {
        if (
          !end ||
          typeof end !== "object" ||
          Array.isArray(end) ||
          !validId(end.compId) ||
          typeof end.pin !== "string" ||
          !end.pin ||
          end.pin.length > 100
        ) return false;
        const component = componentsById.get(end.compId);
        return Boolean(component && window.getSimComponentDefinition(component).pins.some((pin) => pin.id === end.pin));
      };
      if (!wire || typeof wire !== "object" || Array.isArray(wire) || !validId(wire.id) || wireIds.has(String(wire.id)) || !validEnd(wire.from) || !validEnd(wire.to)) {
        throw new Error(`Wire ${index + 1} must have a unique id and valid endpoints that reference existing component pins.`);
      }
      wireIds.add(String(wire.id));
    });
    // Validate stored bends too, including checkpoint data through the
    // recursive validator below. This prevents legacy records from loading
    // into a state that cannot be saved again.
    validateImportedWireWaypoints(wires, components);
    if (Object.prototype.hasOwnProperty.call(data, "checkpoints")) {
      if (!allowCheckpoints) throw new Error("Nested simulation checkpoints are not supported.");
      if (!Array.isArray(data.checkpoints) || data.checkpoints.length > CHECKPOINT_LIMIT) {
        throw new Error(`Simulation checkpoints must be an array of at most ${CHECKPOINT_LIMIT} items.`);
      }
      data.checkpoints.forEach((checkpoint, index) => {
        if (
          !checkpoint ||
          typeof checkpoint !== "object" ||
          Array.isArray(checkpoint) ||
          typeof checkpoint.name !== "string" ||
          !checkpoint.name.trim() ||
          !checkpoint.data
        ) {
          throw new Error(`Checkpoint ${index + 1} has an invalid structure.`);
        }
        validateSimulationStructure(checkpoint.data, true, false);
      });
    }
  }

  function validateImportedWireWaypoints(wires, components) {
    const bounds = getSimulationCanvasBounds(components);
    wires.forEach((wire, index) => {
      if (!wire || typeof wire !== "object" || Array.isArray(wire) || !Object.prototype.hasOwnProperty.call(wire, "waypoints")) return;
      const points = wire.waypoints;
      if (!Array.isArray(points)) throw new Error(`Wire ${index + 1} has an invalid bend list.`);
      if (wire.auto === true && points.length) throw new Error(`Wire ${index + 1} is an automatic breadboard lead and cannot include manual bends.`);
      if (points.length > MAX_MANUAL_WIRE_WAYPOINTS) {
        throw new Error(`Wire ${index + 1} has too many bends (maximum ${MAX_MANUAL_WIRE_WAYPOINTS}).`);
      }
      points.forEach((point, pointIndex) => {
        if (
          !point ||
          typeof point !== "object" ||
          Array.isArray(point) ||
          !Number.isFinite(point.x) ||
          !Number.isFinite(point.y) ||
          point.x < 0 ||
          point.x > bounds.width ||
          point.y < 0 ||
          point.y > bounds.height
        ) {
          throw new Error(`Wire ${index + 1} bend ${pointIndex + 1} must have numeric coordinates inside the builder canvas.`);
        }
      });
    });
  }

  function clampWireWaypointValue(value, axis) {
    if (!Number.isFinite(value)) return null;
    const bounds = getSimulationCanvasBounds();
    const max = axis === "y" ? bounds.height : bounds.width;
    return Math.round(Math.max(0, Math.min(max, value)) * 10) / 10;
  }

  function findWireBendInsertion(points) {
    if (!Array.isArray(points) || points.length < 2) return null;
    let longestIndex = 0;
    let longestLength = -1;
    for (let i = 0; i < points.length - 1; i++) {
      const length = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
      if (length > longestLength) {
        longestLength = length;
        longestIndex = i;
      }
    }
    if (longestLength < 1) return null;
    const start = points[longestIndex];
    const end = points[longestIndex + 1];
    const midpoint = { x: (start.x + end.x) / 2, y: (start.y + end.y) / 2 };
    const normal = { x: -(end.y - start.y) / longestLength, y: (end.x - start.x) / longestLength };
    const candidates = [1, -1].map((direction) => ({
      x: clampWireWaypointValue(midpoint.x + normal.x * 24 * direction, "x"),
      y: clampWireWaypointValue(midpoint.y + normal.y * 24 * direction, "y"),
    }));
    candidates.sort((left, right) =>
      Math.hypot(right.x - midpoint.x, right.y - midpoint.y) - Math.hypot(left.x - midpoint.x, left.y - midpoint.y)
    );
    return { index: longestIndex + 1, point: candidates[0] };
  }

  function renderWireSvg(wire, poweredWires, netNodeIds, ghost) {
    const fromComp = simData.components.find((c) => c.id === wire.from.compId);
    const toComp = simData.components.find((c) => c.id === wire.to.compId);
    if (!fromComp || !toComp) return "";
    const p1 = pinPosition(fromComp, wire.from.pin);
    const p2 = pinPosition(toComp, wire.to.pin);
    if (!p1 || !p2) return "";
    const routePoints = getWireRoutePoints(wire, p1, p2);
    const routeLength = routePoints.slice(1).reduce((sum, point, index) => sum + Math.hypot(point.x - routePoints[index].x, point.y - routePoints[index].y), 0);
    if (routeLength < 0.5) return "";
    const d = getWireRoutePath(routePoints);
    const wireIdAttr = escapeXml(wire.id);
    // The ghost pass is purely visual and remains non-interactive, but it
    // follows the same editable route and endpoint updates as the base wire.
    if (ghost) {
      return `<path class="sim-wire-ghost" data-wire-id="${wireIdAttr}" d="${d}"/>`;
    }
    const sel = selected && selected.kind === "wire" && selected.id === wire.id;
    const inNet = netNodeIds && netNodeIds.has(window.simNodeId(fromComp, wire.from.pin));
    const labelPoint = getWireLabelPosition(routePoints);
    const labelSvg = wire.label
      ? `<text class="sim-wire-label" data-wire-id="${wireIdAttr}" x="${labelPoint.x}" y="${labelPoint.y - 6}" text-anchor="middle">${escapeXml(
          wire.label
        )}</text>`
      : "";
    const kind = wire.kind === "hdmi" ? "hdmi" : "wire";
    const thicknessMultiplier = { thin: 0.6, thick: 1.7 }[wire.thickness] || 1;
    const roundPx = (n) => Math.round(n * 100) / 100;
    const strokeStyle =
      thicknessMultiplier === 1 ? "" : ` style="stroke-width:${roundPx((kind === "hdmi" ? 5 : 4) * thicknessMultiplier)}px"`;
    const shineStrokeStyle =
      thicknessMultiplier === 1 ? "" : ` style="stroke-width:${roundPx((kind === "hdmi" ? 1.5 : 1.2) * thicknessMultiplier)}px"`;
    return `<path class="sim-wire sim-wire-${kind}${sel ? " sim-selected" : ""}${
      inNet ? " sim-net-highlight" : ""
    }" data-id="${wireIdAttr}" data-wire-id="${wireIdAttr}" data-animated="${
      poweredWires.has(wire.id) ? "true" : "false"
    }" d="${d}"${strokeStyle}/><path class="sim-wire-shine sim-wire-shine-${kind}" data-wire-id="${wireIdAttr}" d="${d}"${shineStrokeStyle}/>${labelSvg}`;
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
    const def = window.getSimComponentDefinition(comp);
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
      const def = window.getSimComponentDefinition(c);
      if (!def) return;
      def.pins.forEach((p) => {
        if (!isPinConnected(c.id, p.id)) n++;
      });
    });
    return n;
  }

  function renderPinDots(comp, netNodeIds) {
    const def = window.getSimComponentDefinition(comp);
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
    const { width: canvasWidth, height: canvasHeight } = getSimulationCanvasBounds(simData.components);
    $("sim-builder-canvas").innerHTML = `<svg id="sim-builder-svg" viewBox="0 0 ${canvasWidth} ${canvasHeight}" xmlns="http://www.w3.org/2000/svg" class="sim-svg${
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
          const def = window.getSimComponentDefinition(c);
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
        const wire = simData.wires.find((item) => String(item.id) === path.dataset.id);
        if (!wire) return;
        selected = { kind: "wire", id: wire.id };
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
      const fromComp = simData.components.find((c) => c.id === wire.from.compId);
      const toComp = simData.components.find((c) => c.id === wire.to.compId);
      const p1 = fromComp && pinPosition(fromComp, wire.from.pin);
      const p2 = toComp && pinPosition(toComp, wire.to.pin);
      if (p1 && p2) {
        const routePoints = getWireRoutePoints(wire, p1, p2);
        const d = getWireRoutePath(routePoints);
        const labelPoint = getWireLabelPosition(routePoints);
        svg.querySelectorAll("[data-wire-id]").forEach((node) => {
          if (node.dataset.wireId !== String(wire.id)) return;
          if (node.classList.contains("sim-wire-label")) {
            node.setAttribute("x", labelPoint.x);
            node.setAttribute("y", labelPoint.y - 6);
          } else {
            node.setAttribute("d", d);
          }
        });
      }
    });
    const dots = Array.from(svg.querySelectorAll("circle[data-comp]")).filter((dot) => dot.dataset.comp === String(compId));
    const comp = simData.components.find((c) => c.id === compId);
    const def = comp && window.getSimComponentDefinition(comp);
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
  const SNAP_TO_BREADBOARD_TYPES = new Set(["led", "resistor", "switch", "potentiometer", "ammeter"]);
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
      const board = window.getSimComponentDefinition(c);
      board.pins.forEach((pin) => {
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

  // Count occupied targets before replacing this part's own auto-wires, then
  // rebuild the snap links without disturbing other parts already in the hole.
  function rebuildBreadboardSnapWires(data, movingCompId, pinIds, snapTargets, nextWireId) {
    const targetKeys = new Set(
      Object.values(snapTargets).map((target) => JSON.stringify([target.breadboardId, target.holeId]))
    );
    const componentsById = new Map(data.components.map((component) => [component.id, component]));
    const occupiedTargets = new Set();

    data.wires.forEach((wire) => {
      if (wire.auto !== true || !wire.from || !wire.to) return;
      [[wire.from, wire.to], [wire.to, wire.from]].forEach(([boardEnd, leadEnd]) => {
        const key = JSON.stringify([boardEnd.compId, boardEnd.pin]);
        if (!targetKeys.has(key) || leadEnd.compId === movingCompId) return;
        const lead = componentsById.get(leadEnd.compId);
        if (!lead || lead.type === "breadboard") return;
        occupiedTargets.add(key);
      });
    });

    const movingPins = pinIds instanceof Set ? pinIds : new Set(pinIds);
    data.wires = data.wires.filter(
      (wire) => !(wire.auto && ((wire.from.compId === movingCompId && movingPins.has(wire.from.pin)) || (wire.to.compId === movingCompId && movingPins.has(wire.to.pin))))
    );
    Object.entries(snapTargets).forEach(([pinId, target]) => {
      data.wires.push({
        id: nextWireId(),
        from: { compId: movingCompId, pin: pinId },
        to: { compId: target.breadboardId, pin: target.holeId },
        kind: "wire",
        auto: true,
      });
    });
    return occupiedTargets.size;
  }

  // This status is nonblocking: the dropped part stays connected to the same
  // breadboard node as any lead that was already using the target hole.
  function setSnapHoleWarning(occupiedHoleCount) {
    const status = $("sim-hole-warning");
    if (!status) return;
    if (!occupiedHoleCount) {
      status.textContent = "";
      status.hidden = true;
      return;
    }
    status.textContent = occupiedHoleCount === 1
      ? "Another lead already uses 1 target breadboard hole. Both parts remain electrically connected."
      : `Other leads already use ${occupiedHoleCount} target breadboard holes. All parts remain electrically connected.`;
    status.hidden = false;
  }

  function onComponentPointerDown(e) {
    e.stopPropagation();
    const g = e.currentTarget;
    const comp = simData.components.find((c) => String(c.id) === g.dataset.id);
    if (!comp) return;
    const compId = comp.id;
    setSnapHoleWarning(0);

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
    const compDef = canSnap ? window.getSimComponentDefinition(comp) : null;
    const anchorPin = compDef ? compDef.pins[0] : null;
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
        compDef.pins.forEach((pin) => {
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
          const otherG = Array.from($("sim-builder-svg").querySelectorAll(".sim-comp")).find((node) => node.dataset.id === String(id));
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
      // A critic pass (reviewing the new arrow-key nudge feature's
      // interaction with snapped parts) found this rebuild ran on EVERY
      // pointerup, including a plain click with no movement at all --
      // onMove (the only place snapTargets ever gets populated) never
      // runs for a no-drag click, so snapTargets was still its initial
      // {} here, and the filter-then-rebuild silently deleted the part's
      // existing auto-wires while adding none back. Net effect: simply
      // (re)selecting an already-snapped part by clicking it, with zero
      // mouse movement -- the single most natural way to select a part
      // before nudging it with the arrow keys -- destroyed its wiring
      // before the first keypress. Gating on historySaved (only true
      // once onMove has actually run at least once) means a real drag
      // still correctly rebuilds the wires from wherever it ended up,
      // while a plain click leaves whatever wiring already existed alone.
      let occupiedHoleCount = 0;
      if (canSnap && historySaved) {
        const pinIds = new Set(window.getSimComponentDefinition(comp).pins.map((p) => p.id));
        occupiedHoleCount = rebuildBreadboardSnapWires(
          simData,
          compId,
          pinIds,
          snapTargets,
          () => newLocalId("wire")
        );
      }
      renderBuilder();
      if (canSnap && historySaved) setSnapHoleWarning(occupiedHoleCount);
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
    const comp = simData.components.find((component) => String(component.id) === dot.dataset.comp);
    if (!comp) return;
    const compId = comp.id;
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
    breadboard: { cols: 30 },
    resistor: { resistance: 220 },
    battery: { voltage: 9 },
    power_supply: { outputVoltage: 5 },
    led: { color: "red" },
    switch: { closed: true },
    potentiometer: { maxResistance: 10000, wiper: 50 },
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
      // Matches against the part's own spec/synonym keywords (from its
      // window.SIM_COMPONENTS registry entry, the single source of truth
      // also used for rendering/analysis) in addition to its visible
      // label, so searching "dimmer" or "current limiting" finds the
      // Potentiometer/Resistor even though neither word appears on the
      // button itself.
      const def = window.SIM_COMPONENTS[btn.dataset.simType];
      const haystack = `${btn.textContent} ${(def && def.keywords) || ""}`.toLowerCase();
      btn.classList.toggle("is-hidden-by-search", q.length > 0 && !haystack.includes(q));
    });
  });

  function getPotentiometerElectricalState(comp) {
    const maxResistance = Math.max(1, Number(comp.maxResistance) || 10000);
    const rawWiper = Number(comp.wiper);
    const wiperPct = Math.max(0, Math.min(100, Number.isFinite(rawWiper) ? rawWiper : 50));
    const effectiveResistance = Math.max(1, Math.round(maxResistance * (wiperPct / 100)));
    return { maxResistance, wiperPct, effectiveResistance };
  }

  function describePotentiometerElectricalState(state) {
    const minimum = state.effectiveResistance === 1 ? " (minimum model value)" : "";
    return `Electrical effect: Wiper at ${state.wiperPct}% gives ${state.effectiveResistance} Ω between terminals${minimum}.`;
  }

  function describeSwitchElectricalEffect(closed) {
    return closed
      ? "Closed — both terminals are connected; current can flow if the rest of the circuit is complete."
      : "Open — both terminals are disconnected, so current cannot flow through this switch.";
  }

  // ---------- Inspector ----------
  function renderInspector() {
    const box = $("sim-inspector");
    if (
      !selected ||
      selected.kind !== "component" ||
      simData.components.find((c) => c.id === selected.id)?.type !== "breadboard"
    ) {
      breadboardResizeNotice = "";
    }
    if (!selected) {
      box.innerHTML =
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Click a part or a wire to edit it. Click a pin, then another pin, to wire them. Shift+click parts, or drag a box over empty canvas, to select several at once.</p>" +
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Breadboards are available in 15, 30, or 45 columns; older simulations default to 30. Each terminal column connects only its own five-hole group. The top rails and bottom rails aren't connected to each other either. Wire outlet → power supply → a rail → a column → resistor bridging to another column → LED → back to the other rail.</p>" +
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Power needs a complete loop, and the numbers matter now: too little resistance burns out an LED, no resistor at all is a dead short, and wiring straight to the Wall Outlet (120V) destroys anything downstream — it must go through a Power Supply first. A backwards LED won't light even on an otherwise-complete loop, same as a real one.</p>";
      return;
    }
    if (selected.kind === "component") {
      const comp = simData.components.find((c) => c.id === selected.id);
      if (!comp) return;
    const def = window.getSimComponentDefinition(comp);
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
          // A potentiometer's analysis result also comes back as kind
          // "resistor" (it's wired as a plain two-terminal rheostat, see
          // sim-components.js) -- same current/wattage math, just with
          // part-appropriate wording. A fixed resistor's rating comes from
          // its real-world 1/4W spec (RESISTOR_WATTAGE_RATING); a
          // potentiometer's is admin-configurable per instance, so calling
          // it "a typical 1/4W resistor" would be a wrong-part reference.
          const overheatMsg =
            comp.type === "potentiometer"
              ? `🔥 Overheating — dissipating ${info.watts.toFixed(2)}W, more than this potentiometer can safely handle.`
              : `🔥 Overheating — dissipating ${info.watts.toFixed(2)}W, more than a typical 1/4W resistor can handle.`;
          if (info.dangerous) {
            electricalHtml = `<p class="sim-power-status is-danger">🔥 Charred instantly — this loop is running straight off 120V mains.</p>`;
          } else if (info.status === "overheating") {
            electricalHtml = `<p class="sim-power-status is-danger">${overheatMsg}</p>`;
          } else {
            electricalHtml = `<p class="sim-power-status is-powered">✓ ${ma}mA flowing, dissipating ${info.watts.toFixed(2)}W — well within its rating.</p>`;
          }
        } else if (info.kind === "teensy") {
          if (info.dangerous) {
            electricalHtml = `<p class="sim-power-status is-danger">🔥 Destroyed instantly — 120V mains directly to a microcontroller.</p>`;
          } else if (info.status === "overheating") {
            electricalHtml = `<p class="sim-power-status is-danger">🔥 Overheating — dissipating ${info.watts.toFixed(2)}W, more than a typical microcontroller board's power budget can handle.</p>`;
          } else {
            electricalHtml = `<p class="sim-power-status is-powered">Drawing ~${ma}mA at ${info.voltage}V — dissipating ${info.watts.toFixed(2)}W.</p>`;
          }
        } else if (info.kind === "ammeter") {
          electricalHtml = info.dangerous
            ? `<p class="sim-power-status is-danger">🔥 Destroyed instantly — 120V mains directly across this ammeter.</p>`
            : `<p class="sim-power-status is-powered">⚡ ${ma}mA flowing through this ammeter.</p>`;
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
      if (comp.type === "breadboard") {
        extraFieldsHtml = `<label title="Choose the number of terminal columns and matching positions in each power rail. Reducing board size removes wires connected to columns that no longer exist.">Board size
          <select id="sim-comp-breadboard-cols">${window.SIM_BREADBOARD_COLUMN_OPTIONS
            .map((cols) => `<option value="${cols}" ${def.cols === cols ? "selected" : ""}>${cols} columns</option>`)
            .join("")}</select>
        </label>${breadboardResizeNotice ? `<p role="status" style="color:var(--text-dim);font-size:0.8rem;">${breadboardResizeNotice}</p>` : ""}`;
      } else if (comp.type === "resistor") {
        extraFieldsHtml = `<label title="How much the resistor limits current flow through it -- higher values let less current through. A common LED current-limiting resistor is 220-330 ohms.">Resistance (ohms)<input id="sim-comp-resistance" type="number" min="1" value="${Number(comp.resistance) || 220}"></label>`;
      } else if (comp.type === "potentiometer") {
        const potState = getPotentiometerElectricalState(comp);
        extraFieldsHtml = `<label title="The potentiometer's full end-to-end resistance -- the Wiper position below sets what fraction of that range is actually in the circuit right now, the same way turning a real knob does.">Max resistance (ohms)<input id="sim-comp-max-resistance" type="number" min="1" value="${potState.maxResistance}"></label>
        <label title="How far the sliding contact sits along the resistive track, from 0% (minimum resistance) to 100% (maximum) -- same idea as turning a real knob from one end to the other.">Wiper position: <span id="sim-comp-wiper-value">${potState.wiperPct}</span>%<input id="sim-comp-wiper" type="range" min="0" max="100" value="${potState.wiperPct}" aria-describedby="sim-comp-pot-effective"></label>
        <output id="sim-comp-pot-effective" class="sim-electrical-effect" for="sim-comp-wiper">${describePotentiometerElectricalState(potState)}</output>`;
      } else if (comp.type === "battery") {
        extraFieldsHtml = `<label title="The battery's nominal voltage -- how much electrical 'push' it supplies to the circuit, matching the voltage printed on a real battery (1.5V AA, 9V, etc.).">Voltage (V)<input id="sim-comp-voltage" type="number" min="0.1" step="0.1" value="${Number(comp.voltage) || 9}"></label>
        <label title="Real batteries aren't perfect voltage sources -- this models a non-ideal battery's own resistance, in series with the rest of the circuit. Leave at 0 for an ideal source (the default, matching every simulation saved before this field existed).">Internal resistance (ohms)<input id="sim-comp-internal-resistance" type="number" min="0" step="0.1" value="${Math.max(0, Number(comp.internalResistance) || 0)}"></label>`;
      } else if (comp.type === "power_supply") {
        extraFieldsHtml = `<label title="The fixed DC voltage this supply outputs, like the labeled output on a real bench or wall power adapter -- unlike a battery, it doesn't run down over time.">Output voltage<select id="sim-comp-output-voltage">${[3.3, 5, 9, 12]
          .map((v) => `<option value="${v}" ${Number(comp.outputVoltage) === v ? "selected" : ""}>${v}V DC</option>`)
          .join("")}</select></label>`;
      } else if (comp.type === "led") {
        extraFieldsHtml = `<label>Color<select id="sim-comp-led-color">${Object.entries(window.LED_COLORS)
          .map(([key, c]) => `<option value="${key}" ${(comp.color || "red") === key ? "selected" : ""}>${c.label}</option>`)
          .join("")}</select></label>`;
      } else if (comp.type === "switch") {
        const closed = comp.closed !== false;
        const electricalEffect = describeSwitchElectricalEffect(closed);
        extraFieldsHtml = `<p class="sim-electrical-effect"><strong>Electrical effect:</strong> ${electricalEffect}</p>
        <label><input type="checkbox" id="sim-comp-switch-closed" ${closed ? "checked" : ""}> Closed — click the part on the canvas to toggle it too</label>`;
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

      const breadboardColsInput = $("sim-comp-breadboard-cols");
      if (breadboardColsInput) {
        breadboardColsInput.addEventListener("change", () => {
          const cols = Number(breadboardColsInput.value);
          if (!window.SIM_BREADBOARD_COLUMN_OPTIONS.includes(cols) || cols === def.cols) return;
          pushHistory();
          comp.cols = cols;
          const validPins = new Set(window.getSimComponentDefinition(comp).pins.map((pin) => pin.id));
          const previousWireCount = simData.wires.length;
          simData.wires = simData.wires.filter((wire) => {
            const fromValid = !wire.from || wire.from.compId !== comp.id || validPins.has(wire.from.pin);
            const toValid = !wire.to || wire.to.compId !== comp.id || validPins.has(wire.to.pin);
            return fromValid && toValid;
          });
          const removedWireCount = previousWireCount - simData.wires.length;
          breadboardResizeNotice = removedWireCount
            ? `Removed ${removedWireCount} wire${removedWireCount === 1 ? "" : "s"} attached to columns outside the ${cols}-column board.`
            : "";
          renderInspector();
          renderBuilder();
        });
      }
      const resistanceInput = $("sim-comp-resistance");
      if (resistanceInput) {
        resistanceInput.addEventListener("change", () => {
          pushHistory();
          comp.resistance = Math.max(1, Number(resistanceInput.value) || 220);
          renderInspector();
          renderBuilder();
        });
      }
      const maxResistanceInput = $("sim-comp-max-resistance");
      if (maxResistanceInput) {
        maxResistanceInput.addEventListener("change", () => {
          pushHistory();
          comp.maxResistance = Math.max(1, Number(maxResistanceInput.value) || 10000);
          renderInspector();
          renderBuilder();
        });
      }
      const wiperInput = $("sim-comp-wiper");
      if (wiperInput) {
        // Same live-update pattern as the wire-thickness/label fields --
        // dragging the slider should redraw the part (and its computed
        // ohms label/electrical status) continuously, not just on release,
        // but only push one history entry for the whole drag rather than
        // one per 'input' event.
        let wiperHistorySaved = false;
        wiperInput.addEventListener("input", () => {
          if (!wiperHistorySaved) {
            pushHistory();
            wiperHistorySaved = true;
          }
          comp.wiper = Math.max(0, Math.min(100, Number(wiperInput.value)));
          const potState = getPotentiometerElectricalState(comp);
          const wiperValueLabel = $("sim-comp-wiper-value");
          if (wiperValueLabel) wiperValueLabel.textContent = String(potState.wiperPct);
          const electricalEffect = $("sim-comp-pot-effective");
          if (electricalEffect) electricalEffect.textContent = describePotentiometerElectricalState(potState);
          renderBuilder();
        });
        wiperInput.addEventListener("change", () => {
          wiperHistorySaved = false;
          renderInspector();
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
      const internalResistanceInput = $("sim-comp-internal-resistance");
      if (internalResistanceInput) {
        internalResistanceInput.addEventListener("change", () => {
          pushHistory();
          comp.internalResistance = Math.max(0, Number(internalResistanceInput.value) || 0);
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
            const clonedWire = JSON.parse(JSON.stringify(w));
            clonedWire.id = newLocalId("wire");
            clonedWire.from = { ...w.from, compId: idMap.get(w.from.compId) };
            clonedWire.to = { ...w.to, compId: idMap.get(w.to.compId) };
            if (w.auto === true) {
              delete clonedWire.waypoints;
            } else {
              const shiftedWaypoints = getWireWaypoints(w).map((point) => ({
                x: clampWireWaypointValue(point.x + 20, "x"),
                y: clampWireWaypointValue(point.y + 20, "y"),
              }));
              setWireWaypoints(clonedWire, shiftedWaypoints);
            }
            simData.wires.push(clonedWire);
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
      const waypoints = getWireWaypoints(wire);
      const waypointBounds = getSimulationCanvasBounds();
      const hasInvalidRoute = hasInvalidWireWaypoints(wire);
      const invalidRouteNotice = hasInvalidRoute
        ? '<p class="sim-wire-route-help" role="status">Saved bend data is invalid. This wire is displayed straight. Clear its invalid bend data before editing the route.</p><button type="button" id="sim-wire-clear-invalid-bends">Clear invalid bends</button>'
        : "";
      const routeControls = hasInvalidRoute
        ? invalidRouteNotice
        : wire.auto === true
          ? '<p class="sim-wire-route-help">This breadboard lead is generated automatically and cannot be rerouted.</p>'
          : `<fieldset class="sim-wire-route">
            <legend>Route bends</legend>
            <p class="sim-wire-route-help">Set coordinates in the builder canvas. Component-pin endpoints move with their parts.</p>
            ${waypoints.map((point, index) => `<div class="sim-wire-waypoint">
              <span class="sim-wire-waypoint-title">Bend ${index + 1}</span>
              <label>X<input type="number" min="0" max="${waypointBounds.width}" step="0.1" value="${point.x}" data-wire-waypoint-index="${index}" data-wire-waypoint-axis="x" aria-label="Bend ${index + 1} X coordinate"></label>
              <label>Y<input type="number" min="0" max="${waypointBounds.height}" step="0.1" value="${point.y}" data-wire-waypoint-index="${index}" data-wire-waypoint-axis="y" aria-label="Bend ${index + 1} Y coordinate"></label>
              <button type="button" class="sim-wire-waypoint-remove" data-wire-waypoint-remove="${index}">Remove bend ${index + 1}</button>
            </div>`).join("")}
            <button type="button" id="sim-wire-add-bend" ${waypoints.length >= MAX_MANUAL_WIRE_WAYPOINTS ? "disabled" : ""}>Add bend point</button>
          </fieldset>`;
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
        ${routeControls}
        <button type="button" id="sim-delete-selected" class="danger">Delete wire</button>
      `;
      $("sim-wire-kind").addEventListener("change", (e) => {
        pushHistory();
        wire.kind = e.target.value;
        renderBuilder();
      });
      $("sim-wire-thickness").addEventListener("change", (e) => {
        pushHistory();
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
      const clearInvalidBendsButton = $("sim-wire-clear-invalid-bends");
      if (clearInvalidBendsButton) {
        clearInvalidBendsButton.addEventListener("click", () => {
          if (!hasInvalidWireWaypoints(wire)) return;
          pushHistory();
          delete wire.waypoints;
          renderInspector();
          renderBuilder();
          ($("sim-wire-add-bend") || $("sim-delete-selected"))?.focus();
        });
      }
      const addBendButton = $("sim-wire-add-bend");
      if (addBendButton) {
        addBendButton.addEventListener("click", () => {
          const fromComp = simData.components.find((c) => c.id === wire.from.compId);
          const toComp = simData.components.find((c) => c.id === wire.to.compId);
          const p1 = fromComp && pinPosition(fromComp, wire.from.pin);
          const p2 = toComp && pinPosition(toComp, wire.to.pin);
          if (!p1 || !p2) return;
          const next = getWireWaypoints(wire);
          if (next.length >= MAX_MANUAL_WIRE_WAYPOINTS) return;
          const insertion = findWireBendInsertion(getWireRoutePoints(wire, p1, p2));
          if (!insertion) return;
          pushHistory();
          next.splice(insertion.index, 0, insertion.point);
          setWireWaypoints(wire, next);
          renderInspector();
          renderBuilder();
          box.querySelector(`[data-wire-waypoint-index="${insertion.index}"][data-wire-waypoint-axis="x"]`)?.focus();
        });
      }
      box.querySelectorAll("[data-wire-waypoint-index]").forEach((input) => {
        input.addEventListener("change", () => {
          const index = Number(input.dataset.wireWaypointIndex);
          const axis = input.dataset.wireWaypointAxis;
          const next = getWireWaypoints(wire);
          if (!Number.isInteger(index) || !next[index] || !["x", "y"].includes(axis)) return;
          const value = input.value === "" ? null : clampWireWaypointValue(input.valueAsNumber, axis);
          if (value === null) {
            input.value = String(next[index][axis]);
            return;
          }
          if (next[index][axis] === value) return;
          pushHistory();
          next[index][axis] = value;
          setWireWaypoints(wire, next);
          input.value = String(value);
          // Keep the inspector DOM alive so keyboard and screen-reader
          // focus stays on the coordinate field while the canvas redraws.
          renderBuilder();
        });
      });
      box.querySelectorAll("[data-wire-waypoint-remove]").forEach((button) => {
        button.addEventListener("click", () => {
          const index = Number(button.dataset.wireWaypointRemove);
          const next = getWireWaypoints(wire);
          if (!Number.isInteger(index) || index < 0 || index >= next.length) return;
          pushHistory();
          next.splice(index, 1);
          setWireWaypoints(wire, next);
          renderInspector();
          renderBuilder();
          const focusIndex = Math.min(index, next.length - 1);
          if (focusIndex >= 0) {
            box.querySelector(`[data-wire-waypoint-index="${focusIndex}"][data-wire-waypoint-axis="x"]`)?.focus();
          } else {
            $("sim-wire-add-bend")?.focus();
          }
        });
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
  // On a wide screen, 100% fits the container (CSS width:100%) - the
  // board is comfortably readable shrunk to fit. On a phone, fitting the
  // full canvas into a ~390px screen shrinks pins/holes past the point of
  // being tappable, which is the opposite of what "100%" should mean
  // there - so on mobile, every zoom level (100% included) renders at a
  // real, explicit pixel size based on the live canvas dimensions, and the wrapping
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
        svg.style.width = `${svg.viewBox.baseVal.width * zoomLevel}px`;
        svg.style.height = `${svg.viewBox.baseVal.height * zoomLevel}px`;
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
    // Keyboard placement: nudge every selected component by arrow key,
    // same idea as a normal drag but without needing a mouse/touch --
    // reuses the exact same gridSnapSize the drag-to-move handler already
    // snaps to (1px plain, a full grid-snap step held with Shift, matching
    // the common "fine vs. coarse" nudge convention most drag-and-drop
    // editors already use). Wire endpoints need no separate update here --
    // they're computed from the CURRENT comp.x/y at render time, the same
    // reason a mouse-drag move never needs to touch wire data either.
    const ARROW_DELTAS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
    if (ARROW_DELTAS[e.key] && selectedIds().length) {
      // Resolved to real components FIRST, before pushHistory() -- a
      // critic pass found a stale selection (referencing an id that no
      // longer exists, e.g. after an external delete) would otherwise
      // still push a no-op history entry even though nothing was
      // actually going to move.
      const comps = selectedIds()
        .map((id) => simData.components.find((c) => c.id === id))
        .filter(Boolean);
      if (!comps.length) return;
      e.preventDefault();
      const step = e.shiftKey && gridSnapSize > 0 ? gridSnapSize : 1;
      const [dx, dy] = ARROW_DELTAS[e.key];
      pushHistory();
      comps.forEach((comp) => {
        comp.x += dx * step;
        comp.y += dy * step;
      });
      renderBuilder();
    }
  });

  // ---------- Thumbnail from current view ----------
  // Rasterizes the live builder SVG (the exact same markup the public
  // simulation viewer renders) into a PNG and uploads it as the poster
  // image, sparing the admin from having to screenshot the circuit
  // manually. Serializes a CLONE with explicit width/height attributes
  // set from the live viewBox -- an <img> loading an SVG that only has a
  // viewBox (no width/height) gets an unreliable, browser-dependent
  // default intrinsic size, so the clone avoids ever touching the live
  // DOM node just to make rasterization deterministic.
  $("sim-generate-thumbnail").addEventListener("click", async () => {
    const btn = $("sim-generate-thumbnail");
    const svg = $("sim-builder-svg");
    if (!svg) return;
    const originalText = btn.textContent;
    btn.textContent = "Generating…";
    btn.disabled = true;
    try {
      const vb = svg.viewBox.baseVal;
      const svgClone = svg.cloneNode(true);
      // applyZoom() sets an inline style.width/height on the LIVE svg
      // (whenever zoomed and always on mobile, whose default zoom is
      // 0.5) which cloneNode(true) copies verbatim. Inline style wins
      // over the width/height attributes below when this SVG is later
      // rendered standalone via <img>, so without clearing it the
      // rasterized image would render at the zoomed-out CSS size and get
      // drawn at 1:1 into the corner of the full 1500x700 canvas instead
      // of filling it -- a critic-found bug that reproduced with the
      // mobile admin's own default zoom level, not just a manual-zoom
      // edge case.
      svgClone.style.width = "";
      svgClone.style.height = "";
      svgClone.setAttribute("width", vb.width);
      svgClone.setAttribute("height", vb.height);
      const svgString = new XMLSerializer().serializeToString(svgClone);
      const svgBlob = new Blob([svgString], { type: "image/svg+xml;charset=utf-8" });
      const svgUrl = URL.createObjectURL(svgBlob);
      const img = new Image();
      try {
        await new Promise((resolve, reject) => {
          img.onload = resolve;
          img.onerror = () => reject(new Error("Couldn't render the circuit view as an image."));
          img.src = svgUrl;
        });
      } finally {
        URL.revokeObjectURL(svgUrl);
      }
      const canvas = document.createElement("canvas");
      canvas.width = vb.width;
      canvas.height = vb.height;
      const ctx = canvas.getContext("2d");
      // The public/admin backgrounds are CSS (var(--bg-elevated)), not
      // part of the SVG's own paintable content, so without this the
      // rasterized PNG would have a transparent background instead of
      // matching what's actually seen on screen.
      ctx.fillStyle = getComputedStyle(svg).backgroundColor || "#1e1e20";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);
      const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
      if (!blob) throw new Error("Couldn't encode the thumbnail image.");
      const { url } = await window.adminUploadBlob(blob);
      $("sim-poster-url").value = url;
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
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

  function splitImportedSimulation(parsed, existingCheckpoints) {
    const hasImportedCheckpoints = Object.prototype.hasOwnProperty.call(parsed, "checkpoints");
    const checkpoints = hasImportedCheckpoints
      ? parsed.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          data: { components: checkpoint.data.components, wires: checkpoint.data.wires },
        }))
      : existingCheckpoints;
    const data = { ...parsed };
    delete data.checkpoints;
    delete data.og_image;
    return {
      data,
      checkpoints,
      hasPoster: Object.prototype.hasOwnProperty.call(parsed, "og_image"),
      posterUrl: typeof parsed.og_image === "string" ? parsed.og_image : "",
    };
  }

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
      normalizeSimulationBuilderIds(parsed);
      validateSimulationStructure(parsed, true);
      const imported = splitImportedSimulation(parsed, simCheckpoints);
      if (imported.hasPoster) $("sim-poster-url").value = imported.posterUrl;
      setSnapHoleWarning(0);
      pushHistory();
      simData = imported.data;
      simCheckpoints = imported.checkpoints;
      renderCheckpointSelect();
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
      initialSimSnapshot = captureInitialSimulationSnapshot();
      alert("Saved.");
      if (window.refreshSimulationOptions) window.refreshSimulationOptions();
    } catch (err) {
      alert(err.message);
    }
  });

  $("sim-reset").addEventListener("click", resetSimToInitial);
})();
