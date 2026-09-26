(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const REG = window.SIM_COMPONENTS;

  let simulations = [];
  let currentSimId = null;
  let simData = { components: [], wires: [] };
  let selected = null; // { kind: "component" | "wire", id }
  let wireStart = null; // { compId, pin }
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
    return d.innerHTML;
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
    zoomLevel = defaultZoomLevel();
    placeX = 20;
    placeY = 20;
    undoStack = [];
    redoStack = [];
    if (id) {
      const sim = await window.adminApi(`/simulations/${id}`);
      $("simulation-name").value = sim.name;
      const components = sim.data && Array.isArray(sim.data.components) ? sim.data.components : [];
      const wires = sim.data && Array.isArray(sim.data.wires) ? sim.data.wires : [];
      simData = { components, wires };
      simCheckpoints = sim.data && Array.isArray(sim.data.checkpoints) ? sim.data.checkpoints : [];
    } else if (templateId) {
      const t = simTemplates.find((x) => x.id === templateId);
      $("simulation-name").value = "New simulation";
      simData = t && Array.isArray(t.data.components) ? JSON.parse(JSON.stringify({ components: t.data.components, wires: t.data.wires || [] })) : { components: [], wires: [] };
      simCheckpoints = [];
    } else {
      $("simulation-name").value = "New simulation";
      simData = { components: [], wires: [] };
      simCheckpoints = [];
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
    return `<g class="sim-comp sim-comp-${comp.type}${sel ? " sim-selected" : ""}${damaged ? " sim-damaged" : ""}" data-id="${
      comp.id
    }" data-powered="${poweredComps.has(comp.id) ? "true" : "false"}" transform="translate(${comp.x},${
      comp.y
    })">${def.render(comp)}${sel ? `<rect class="sim-select-box" x="-4" y="-4" width="${def.w + 8}" height="${def.h + 8}" />` : ""}</g>`;
  }

  function renderWireSvg(wire, poweredWires) {
    const fromComp = simData.components.find((c) => c.id === wire.from.compId);
    const toComp = simData.components.find((c) => c.id === wire.to.compId);
    if (!fromComp || !toComp) return "";
    const p1 = pinPosition(fromComp, wire.from.pin);
    const p2 = pinPosition(toComp, wire.to.pin);
    if (!p1 || !p2) return "";
    const sel = selected && selected.kind === "wire" && selected.id === wire.id;
    const d = `M${p1.x},${p1.y} L${p2.x},${p2.y}`;
    return `<path class="sim-wire sim-wire-${wire.kind || "wire"}${
      sel ? " sim-selected" : ""
    }" data-id="${wire.id}" data-animated="${
      poweredWires.has(wire.id) ? "true" : "false"
    }" d="${d}"/><path class="sim-wire-shine sim-wire-shine-${wire.kind || "wire"}" d="${d}"/>`;
  }

  // A component just placed with no wires yet is completely normal mid-
  // build, so this is an on-demand toggle rather than an always-on
  // overlay that would just be noisy for any circuit still in progress.
  let showDisconnected = false;
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

  function renderPinDots(comp) {
    const def = REG[comp.type];
    return def.pins
      .map((p) => {
        const active = wireStart && wireStart.compId === comp.id && wireStart.pin === p.id;
        const disconnected = showDisconnected && !isPinConnected(comp.id, p.id);
        return `<circle class="sim-pin${active ? " sim-pin-active" : ""}${
          disconnected ? " sim-pin-disconnected" : ""
        }" data-comp="${comp.id}" data-pin="${p.id}" cx="${comp.x + p.x}" cy="${comp.y + p.y}" r="5"/>`;
      })
      .join("");
  }

  function renderBuilder() {
    const { poweredComps, poweredWires } = window.computeSimPoweredSet(simData);
    const analysis = window.computeSimElectricalAnalysis(simData);
    const wiresSvg = simData.wires.map((w) => renderWireSvg(w, poweredWires)).join("");
    const compsSvg = simData.components.map((c) => renderComponentSvg(c, poweredComps, analysis)).join("");
    const pinsSvg = simData.components.map(renderPinDots).join("");
    $("sim-builder-canvas").innerHTML = `<svg id="sim-builder-svg" viewBox="0 0 1500 700" xmlns="http://www.w3.org/2000/svg" class="sim-svg${
      previewOn ? " is-on" : ""
    }">${window.SIM_DEFS_SVG}${wiresSvg}${compsSvg}${pinsSvg}</svg>`;
    attachBuilderEvents();
    applyZoom();
    if (showDisconnected) {
      const n = countDisconnectedPins();
      $("sim-show-disconnected").textContent = n ? `Disconnected pins: ${n}` : "No disconnected pins";
    } else {
      $("sim-show-disconnected").textContent = "Show disconnected pins";
    }
    $("sim-show-disconnected").classList.toggle("is-active", showDisconnected);
  }

  $("sim-show-disconnected").addEventListener("click", () => {
    showDisconnected = !showDisconnected;
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
  const GRID_SNAP = 5;

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
      if (!canSnap) {
        dx = Math.round((startPositions.get(compId).x + dx) / GRID_SNAP) * GRID_SNAP - startPositions.get(compId).x;
        dy = Math.round((startPositions.get(compId).y + dy) / GRID_SNAP) * GRID_SNAP - startPositions.get(compId).y;
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

  function onPinClick(e) {
    e.stopPropagation();
    const dot = e.currentTarget;
    const compId = dot.dataset.comp;
    const pin = dot.dataset.pin;
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

  document.querySelectorAll(".sim-palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      pushHistory();
      const type = btn.dataset.simType;
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
      renderBuilder();
    });
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
      if (comp.type === "resistor") {
        extraFieldsHtml = `<label>Resistance (ohms)<input id="sim-comp-resistance" type="number" min="1" value="${comp.resistance ?? 220}"></label>`;
      } else if (comp.type === "battery") {
        extraFieldsHtml = `<label>Voltage (V)<input id="sim-comp-voltage" type="number" min="0.1" step="0.1" value="${comp.voltage ?? 9}"></label>`;
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
        <label>Label${comp.type === "mcu_teensy" ? " (shown on the part)" : " (for your own reference)"}<input id="sim-comp-label" type="text" value="${escapeXml(comp.label || "")}"></label>
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
        <button type="button" id="sim-delete-selected" class="danger">Delete wire</button>
      `;
      $("sim-wire-kind").addEventListener("change", (e) => {
        pushHistory();
        wire.kind = e.target.value;
        renderBuilder();
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
    // comment on simCheckpoints above.
    const payloadData = { ...simData, checkpoints: simCheckpoints };
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
