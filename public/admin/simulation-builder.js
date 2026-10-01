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
  // Named views (a zoom level and where the canvas is looking) ride along
  // with the saved simulation like checkpoints do, and for the same reason
  // stay out of simData: they are not circuit state, so they don't belong
  // in the undo history.
  let simViews = [];
  const VIEW_LIMIT = 12;
  // Same rules as the server's check (worker/simulation-validation.js).
  function viewIsValid(view) {
    return Boolean(
      view && typeof view === "object" && !Array.isArray(view) &&
      Object.keys(view).every((key) => ["name", "zoom", "x", "y"].includes(key)) &&
      typeof view.name === "string" && view.name.trim() && view.name.length <= 60 &&
      Number.isFinite(view.zoom) && view.zoom >= 0.25 && view.zoom <= 4 &&
      Number.isFinite(view.x) && view.x >= 0 && view.x <= 1 &&
      Number.isFinite(view.y) && view.y >= 0 && view.y <= 1
    );
  }

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
    setSimSaveStatus("Unsaved changes…");
  }
  // One inline save indicator, like the other editors, instead of a pop-up "Saved." dialog.
  let simSavedText = ""; // what the status said at the last save ("Saved 1:42 AM"); shown again when edits are undone back to it
  function setSimSaveStatus(text) {
    const el = $("sim-save-status");
    if (el && el.textContent !== text) el.textContent = text; // unchanged text isn't re-announced on every keystroke
  }
  // Dirty = what is on screen differs from the last save/open (name, poster, circuit and checkpoints all count),
  // so undoing back to the saved state reads "Saved" again. pushHistory itself can't use this: it runs just
  // BEFORE its caller changes the circuit, so it marks dirty unconditionally.
  function refreshSimSaveState() {
    if (typeof initialSimSnapshot !== "string") return;
    setSimSaveStatus(captureInitialSimulationSnapshot() !== initialSimSnapshot ? "Unsaved changes…" : simSavedText);
  }

  function updateHistoryButtons() {
    $("sim-undo").disabled = undoStack.length === 0;
    $("sim-redo").disabled = redoStack.length === 0;
  }

  function undoHistory() {
    if (!undoStack.length) return;
    setSnapHoleWarning(0);
    redoStack.push(JSON.stringify(simData));
    const keepSelected = selectedIds();
    simData = JSON.parse(undoStack.pop());
    // Parts that still exist stay selected, so an alignment can be tried,
    // undone and tried another way without picking the parts again.
    setMultiSelection(keepSelected.filter((id) => simData.components.some((c) => c.id === id)));
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
    refreshSimSaveState();
  }

  function redoHistory() {
    if (!redoStack.length) return;
    setSnapHoleWarning(0);
    undoStack.push(JSON.stringify(simData));
    const keepSelected = selectedIds();
    simData = JSON.parse(redoStack.pop());
    // Parts that still exist stay selected, so an alignment can be tried,
    // undone and tried another way without picking the parts again.
    setMultiSelection(keepSelected.filter((id) => simData.components.some((c) => c.id === id)));
    wireStart = null;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
    refreshSimSaveState();
  }

  function captureInitialSimulationSnapshot() {
    return JSON.stringify({
      simData,
      simCheckpoints,
      simViews,
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
    simViews = initialState.simViews || [];
    renderViewSelect();
    $("simulation-name").value = initialState.name;
    $("sim-poster-url").value = initialState.posterUrl;
    selected = null;
    wireStart = null;
    updateHistoryButtons();
    renderCheckpointSelect();
    renderInspector();
    renderBuilder();
    refreshSimSaveState();
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
    refreshSimSaveState();
  });
  $("sim-checkpoint-restore").addEventListener("click", () => {
    const i = selectedCheckpointIndex();
    const cp = simCheckpoints[i];
    if (!cp) return;
    if (!confirm(`Discard all current edits and restore the checkpoint "${cp.name}"?`)) return;
    pushHistory();
    simData = { components: JSON.parse(JSON.stringify(cp.data.components)), wires: JSON.parse(JSON.stringify(cp.data.wires)) };
    canvasSearchCurrent = null;
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
    refreshSimSaveState();
  });

  // ---------- Named views ----------
  function renderViewSelect() {
    const select = $("sim-view-select");
    select.innerHTML =
      `<option value="">Go to view…</option>` +
      simViews.map((v, i) => `<option value="${i}">${escapeHtmlLite(v.name)} (${Math.round(v.zoom * 100)}%)</option>`).join("");
    $("sim-view-delete").disabled = true;
    $("sim-view-go").disabled = true;
  }
  function selectedViewIndex() {
    const raw = $("sim-view-select").value;
    return raw === "" ? -1 : Number(raw);
  }
  // The middle of the part of the board you can actually see: the canvas
  // clipped to the window, because on a phone the canvas grows with the zoom
  // and the page, not the canvas, does the vertical scrolling.
  function visibleBoardCentre() {
    const canvas = $("sim-builder-canvas");
    const svg = $("sim-builder-svg");
    if (!canvas || !svg) return { x: 0.5, y: 0.5 };
    const sc = canvasScreenScale(canvas);
    const cr = canvas.getBoundingClientRect();
    const sr = svg.getBoundingClientRect();
    if (!sr.width || !sr.height) return { x: 0.5, y: 0.5 };
    let left = Math.max(cr.left + canvas.clientLeft * sc, 0);
    let right = Math.min(cr.left + (canvas.clientLeft + canvas.clientWidth) * sc, window.innerWidth);
    let top = Math.max(cr.top + canvas.clientTop * sc, 0);
    let bottom = Math.min(cr.top + (canvas.clientTop + canvas.clientHeight) * sc, window.innerHeight);
    if (right <= left || bottom <= top) {
      left = cr.left; right = cr.right; top = cr.top; bottom = cr.bottom; // canvas is off-screen: use all of it
    }
    const clamp01 = (n) => Math.max(0, Math.min(1, n));
    return { x: clamp01(((left + right) / 2 - sr.left) / sr.width), y: clamp01(((top + bottom) / 2 - sr.top) / sr.height) };
  }
  function goToSelectedView() {
    const view = simViews[selectedViewIndex()];
    $("sim-view-delete").disabled = !view;
    $("sim-view-go").disabled = !view;
    if (!view) return;
    // Same zoom steps as the +/- buttons; a saved zoom that isn't one of them (a hand-edited file) snaps to the nearest.
    zoomLevel = ZOOM_STEPS.reduce((best, step) => (Math.abs(step - view.zoom) < Math.abs(best - view.zoom) ? step : best), ZOOM_STEPS[0]);
    applyZoom();
    centerCanvasOn(view.x, view.y);
    // When the canvas grows with the zoom (phones) it can't scroll vertically
    // itself, so bring that point to the middle of the screen through the page.
    const canvas = $("sim-builder-canvas");
    const svg = $("sim-builder-svg");
    if (canvas && svg && canvas.scrollHeight <= canvas.clientHeight + 1) {
      const vb = svg.viewBox.baseVal;
      const marker = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      marker.setAttribute("x", view.x * vb.width);
      marker.setAttribute("y", view.y * vb.height);
      marker.setAttribute("width", 1);
      marker.setAttribute("height", 1);
      marker.setAttribute("visibility", "hidden");
      svg.appendChild(marker);
      marker.scrollIntoView({ block: "center", inline: "nearest" });
      marker.remove();
    }
    $("sim-view-status").textContent = `View "${view.name}" at ${Math.round(zoomLevel * 100)}%.`;
  }
  $("sim-view-select").addEventListener("change", goToSelectedView);
  // Picking the view that is already selected fires no change event, so this
  // is how to return to it after panning or zooming away.
  $("sim-view-go").addEventListener("click", goToSelectedView);
  $("sim-view-save").addEventListener("click", () => {
    if (simViews.length >= VIEW_LIMIT) {
      alert(`A simulation can keep ${VIEW_LIMIT} views. Delete one to save another.`);
      return;
    }
    let n = simViews.length + 1;
    while (simViews.some((v) => v.name === `View ${n}`)) n++;
    const name = prompt("Name this view:", `View ${n}`);
    if (!name || !name.trim()) return;
    const centre = visibleBoardCentre();
    const round3 = (v) => Math.round(Math.max(0, Math.min(1, v)) * 1000) / 1000;
    // 60 characters, without cutting an emoji or other surrogate pair in half.
    const clean = name.trim().slice(0, 60).replace(/[\uD800-\uDBFF]$/, "").trim();
    if (!clean) return;
    simViews.push({ name: clean, zoom: zoomLevel, x: round3(centre.x), y: round3(centre.y) });
    renderViewSelect();
    refreshSimSaveState();
    $("sim-view-status").textContent = `Saved view "${clean}".`;
  });
  $("sim-view-delete").addEventListener("click", () => {
    const i = selectedViewIndex();
    const view = simViews[i];
    if (!view) return;
    if (!confirm(`Delete the view "${view.name}"?`)) return;
    simViews.splice(i, 1);
    renderViewSelect();
    refreshSimSaveState();
    $("sim-view-status").textContent = `Deleted view "${view.name}".`;
  });

  // ---------- Connect pins (keyboard-friendly wiring) ----------
  // Clicking one pin and then another on the board needs a pointer and fairly
  // steady aim. This dialog makes the same wire from four lists, and lists the
  // wires so any of them can be removed without finding it on the canvas.
  const connectModal = $("sim-connect-modal");
  function connectPinsOf(comp) {
    const def = comp && window.getSimComponentDefinition(comp);
    return def ? def.pins : [];
  }
  function fillConnectPartSelect(select, keepId) {
    const names = checklistPartNames();
    select.innerHTML = simData.components.map((c) => `<option value="${escapeXml(c.id)}">${escapeXml(names.get(c.id))}</option>`).join("");
    if (keepId && simData.components.some((c) => c.id === keepId)) select.value = keepId;
  }
  function fillConnectPinSelect(pinSelect, partId) {
    const comp = simData.components.find((c) => c.id === partId);
    const pins = connectPinsOf(comp);
    pinSelect.innerHTML = pins
      .map((pin) => `<option value="${escapeXml(pin.id)}">${escapeXml(checklistPinName(comp, pin.id))}${isPinConnected(comp.id, pin.id) ? " (has a wire)" : ""}</option>`)
      .join("");
  }
  function renderConnectWires() {
    const names = checklistPartNames();
    const byId = new Map(simData.components.map((c) => [c.id, c]));
    const rows = simData.wires
      .filter((w) => w.auto !== true && byId.has(w.from.compId) && byId.has(w.to.compId))
      .map((w) => {
        const a = byId.get(w.from.compId);
        const b = byId.get(w.to.compId);
        const text = `${names.get(a.id)}, ${checklistPinName(a, w.from.pin)} to ${names.get(b.id)}, ${checklistPinName(b, w.to.pin)}`;
        return `<li><span>${escapeXml(text)}</span><button type="button" data-remove-wire="${escapeXml(w.id)}" aria-label="Remove wire: ${escapeXml(text)}">Remove</button></li>`;
      });
    $("sim-connect-wires").innerHTML = rows.length ? rows.join("") : "<li class='sim-connect-empty'>No wires yet.</li>";
  }
  function refreshConnectDialog(keep = {}) {
    const from = $("sim-connect-from-part");
    const to = $("sim-connect-to-part");
    fillConnectPartSelect(from, keep.fromPart);
    fillConnectPartSelect(to, keep.toPart);
    fillConnectPinSelect($("sim-connect-from-pin"), from.value);
    fillConnectPinSelect($("sim-connect-to-pin"), to.value);
    if (keep.fromPin) $("sim-connect-from-pin").value = keep.fromPin;
    if (keep.toPin) $("sim-connect-to-pin").value = keep.toPin;
    $("sim-connect-go").disabled = !simData.components.length;
    renderConnectWires();
  }
  function openConnectDialog() {
    const status = $("sim-connect-status");
    status.textContent = simData.components.length ? "" : "Place at least one part first.";
    const first = selectedIds()[0] || (simData.components[0] && simData.components[0].id);
    const second = (simData.components.find((c) => c.id !== first) || simData.components[0] || {}).id;
    refreshConnectDialog({ fromPart: first, toPart: selectedIds()[1] || second });
    connectModal.hidden = false;
    $("sim-connect-from-part").focus();
  }
  function closeConnectDialog() {
    connectModal.hidden = true;
    $("sim-connect-btn").focus();
  }
  $("sim-connect-btn").addEventListener("click", openConnectDialog);
  $("close-sim-connect").addEventListener("click", closeConnectDialog);
  connectModal.addEventListener("click", (e) => {
    if (e.target === connectModal) closeConnectDialog();
  });
  connectModal.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation(); // don't let it also close the builder behind
    closeConnectDialog();
  });
  $("sim-connect-from-part").addEventListener("change", (e) => fillConnectPinSelect($("sim-connect-from-pin"), e.target.value));
  $("sim-connect-to-part").addEventListener("change", (e) => fillConnectPinSelect($("sim-connect-to-pin"), e.target.value));
  $("sim-connect-go").addEventListener("click", () => {
    const status = $("sim-connect-status");
    const a = { compId: $("sim-connect-from-part").value, pin: $("sim-connect-from-pin").value };
    const b = { compId: $("sim-connect-to-part").value, pin: $("sim-connect-to-pin").value };
    const compA = simData.components.find((c) => c.id === a.compId);
    const compB = simData.components.find((c) => c.id === b.compId);
    if (!compA || !compB || !a.pin || !b.pin) {
      status.textContent = "Choose a part and a pin for both ends.";
      return;
    }
    if (a.compId === b.compId && a.pin === b.pin) {
      status.textContent = "Choose two different pins.";
      return;
    }
    const names = checklistPartNames();
    const label = `${names.get(compA.id)}, ${checklistPinName(compA, a.pin)} to ${names.get(compB.id)}, ${checklistPinName(compB, b.pin)}`;
    const duplicate = simData.wires.some(
      (w) =>
        (w.from.compId === a.compId && w.from.pin === a.pin && w.to.compId === b.compId && w.to.pin === b.pin) ||
        (w.from.compId === b.compId && w.from.pin === b.pin && w.to.compId === a.compId && w.to.pin === a.pin)
    );
    if (duplicate) {
      status.textContent = `Already connected: ${label}.`;
      return;
    }
    pushHistory();
    simData.wires.push({ id: newLocalId("wire"), from: a, to: b, kind: "wire" });
    wireStart = null;
    renderBuilder();
    refreshConnectDialog({ fromPart: a.compId, fromPin: a.pin, toPart: b.compId, toPin: b.pin });
    status.textContent = `Connected ${label}.`;
  });
  $("sim-connect-wires").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-remove-wire]");
    if (!btn) return;
    const id = btn.dataset.removeWire;
    const wire = simData.wires.find((w) => String(w.id) === id);
    if (!wire) return;
    const rows = Array.from($("sim-connect-wires").querySelectorAll("[data-remove-wire]"));
    const at = rows.indexOf(btn);
    pushHistory();
    simData.wires = simData.wires.filter((w) => String(w.id) !== id);
    if (selected && selected.kind === "wire" && String(selected.id) === id) selected = null;
    renderInspector();
    renderBuilder();
    refreshConnectDialog({
      fromPart: $("sim-connect-from-part").value,
      fromPin: $("sim-connect-from-pin").value,
      toPart: $("sim-connect-to-part").value,
      toPin: $("sim-connect-to-pin").value,
    });
    $("sim-connect-status").textContent = "Removed the wire.";
    // Keep focus in the list, on the wire that took its place.
    const left = Array.from($("sim-connect-wires").querySelectorAll("[data-remove-wire]"));
    (left[Math.min(at, left.length - 1)] || $("sim-connect-go")).focus();
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
  // Lock explanations share the hole-warning line; they are cleared the next
  // time the inspector is rebuilt (selection change, lock toggled) so they
  // can't linger after they stop being true.
  let lockNoticeActive = false;
  function showLockNotice(message) {
    lockNoticeActive = true;
    setSnapHoleWarning(0, message);
  }
  // A locked part stays where it is (no drag, nudge, align, rotate, flip or
  // delete); its values and wiring can still be edited.
  function isCompLocked(compId) {
    const comp = simData.components.find((c) => c.id === compId);
    return Boolean(comp && comp.locked === true);
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
    if (window.bulkList) {
      window.bulkList({
        listId: "simulations-list",
        type: "simulation",
        noun: "simulation",
        rowIdSelector: ".delete-simulation",
        duplicate: (id) => window.adminApi(`/simulations/${id}/duplicate`, { method: "POST" }),
        remove: (id) => window.adminApi(`/simulations/${id}`, { method: "DELETE" }),
        reload: loadSimulationsList,
      });
    }
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
      // A template is a starting point, so it doesn't carry the lock flags.
      const templateData = JSON.parse(JSON.stringify(simData));
      templateData.components.forEach((c) => { delete c.locked; });
      await window.adminApi("/templates", { method: "POST", body: JSON.stringify({ kind: "simulation", name, data: templateData }) });
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
    canvasSearchCurrent = null;
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
        // Views are only a convenience: a bad one is dropped rather than making the whole circuit unopenable.
        if (Array.isArray(savedData.views)) savedData.views = savedData.views.filter(viewIsValid).slice(0, VIEW_LIMIT);
        else delete savedData.views;
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
      simViews = Array.isArray(savedData.views) ? savedData.views : [];
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
      simViews = [];
      // A template is a fresh starting point -- its own poster/share image
      // (if the simulation it was saved from had one) shouldn't carry over
      // into every new simulation created from it, same reasoning already
      // applied to not carrying over checkpoints from a template.
      $("sim-poster-url").value = "";
    } else {
      $("simulation-name").value = "New simulation";
      simData = { components: [], wires: [] };
      simCheckpoints = [];
      simViews = [];
      $("sim-poster-url").value = "";
    }
    initialSimSnapshot = captureInitialSimulationSnapshot();
    simSavedText = "";
    setSimSaveStatus(""); // a freshly opened circuit has no unsaved changes
    $("simulations-modal").hidden = true;
    $("simulation-builder-modal").hidden = false;
    $("sim-palette-search").value = "";
    document.querySelectorAll(".sim-palette-btn").forEach((btn) => btn.classList.remove("is-hidden-by-search"));
    updateHistoryButtons();
    renderCheckpointSelect();
    renderViewSelect();
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
    const titleText = comp.type === "mcu_teensy" ? "" : comp.type === "logic_gate" ? window.simLogicTitle(comp) : comp.label || "";
    const titleSvg = titleText ? `<title>${escapeXml(titleText)}</title>` : "";
    // Mirrors the public embed's own live reading (worker/simulation-
    // render.js) -- an ammeter's whole reason for existing is showing a
    // number, so the admin canvas shows it directly on the part too, not
    // just in the separate inspector panel one has to select the part to see.
    const readingSvg =
      comp.type === "ammeter" && info
        ? window.simAmmeterReadingSvg(`${info.currentMa === Infinity ? "∞" : info.currentMa.toFixed(1)}mA`, def.rotation || 0)
        : comp.type === "voltmeter" && info
        ? window.simVoltmeterReadingSvg(window.simFormatVolts(info.volts), def.rotation || 0)
        : "";
    return `<g class="sim-comp sim-comp-${comp.type}${sel ? " sim-selected" : ""}${damaged ? " sim-damaged" : ""}${
      searchMatch ? " sim-search-match" : ""
    }${comp.locked === true ? " sim-locked" : ""}" data-id="${escapeXml(
      comp.id
    )}" data-powered="${poweredComps.has(comp.id) ? "true" : "false"}" transform="translate(${comp.x},${
      comp.y
    })">${titleSvg}${def.render(comp)}${readingSvg && def.overlay ? def.overlay(readingSvg) : readingSvg}${sel ? `<rect class="sim-select-box" x="-4" y="-4" width="${def.w + 8}" height="${def.h + 8}" />` : ""}${
      searchMatch ? `<rect class="sim-search-match-box${comp.id === canvasSearchCurrent ? " is-current" : ""}" x="-6" y="-6" width="${def.w + 12}" height="${def.h + 12}" />` : ""
    }${comp.locked === true ? `<g class="sim-lock-badge" transform="translate(${def.w - 7},${comp.y < 16 ? def.h - 3 : -15}) scale(1.4)"><title>Locked</title><rect x="0" y="5" width="11" height="8" rx="1.5"/><path d="M2.5 5V3.5a3 3 0 0 1 6 0V5" fill="none"/></g>` : ""}</g>`;
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
      if (component.locked !== undefined && typeof component.locked !== "boolean") {
        throw new Error(`Component ${index + 1} has an invalid lock setting.`);
      }
      if (
        component.type === "breadboard" &&
        Object.prototype.hasOwnProperty.call(component, "cols") &&
        !window.SIM_BREADBOARD_COLUMN_OPTIONS.includes(Number(component.cols))
      ) {
        throw new Error(`Component ${index + 1} has an unsupported breadboard size. Choose 15, 30, or 45 columns.`);
      }
      const hasRotation = Object.prototype.hasOwnProperty.call(component, "rotation");
      const hasMirror = Object.prototype.hasOwnProperty.call(component, "mirror");
      if (
        (hasRotation && !window.SIM_ORIENTATION_ROTATIONS.includes(component.rotation)) ||
        (hasMirror && typeof component.mirror !== "boolean") ||
        (component.type === "breadboard" && ((hasRotation && component.rotation !== 0) || component.mirror === true))
      ) {
        throw new Error(`Component ${index + 1} has an invalid orientation. Rotation must be 0, 90, 180, or 270, mirror must be true or false, and breadboards cannot be rotated or mirrored.`);
      }
      if (component.type === "logic_gate") {
        const hasGate = Object.prototype.hasOwnProperty.call(component, "gate");
        const hasTruth = Object.prototype.hasOwnProperty.call(component, "truth");
        const gateOk = !hasGate || window.simIsLogicGateName(component.gate);
        if (!gateOk || (hasTruth && !window.simIsValidLogicTruth(window.simLogicGate(component), component.truth))) {
          throw new Error(`Component ${index + 1} has an invalid logic gate. Gate must be one of ${Object.keys(window.SIM_LOGIC_GATES).join(", ")}, and a custom truth table must list 4 outputs (2-input gates) or 2 (NOT and buffer), each 0 or 1.`);
        }
      }
      if (component.type === "switch_spdt" && Object.prototype.hasOwnProperty.call(component, "position") && component.position !== "a" && component.position !== "b") {
        throw new Error(`Component ${index + 1} has an invalid switch position. Position must be "a" or "b".`);
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
    if (Object.prototype.hasOwnProperty.call(data, "views")) {
      if (!allowCheckpoints) throw new Error("Nested simulation views are not supported.");
      if (!Array.isArray(data.views) || data.views.length > VIEW_LIMIT) {
        throw new Error(`Simulation views must be an array of at most ${VIEW_LIMIT} items.`);
      }
      data.views.forEach((view, index) => {
        if (!viewIsValid(view)) throw new Error(`View ${index + 1} has an invalid structure.`);
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
  // The match Enter last jumped to (drawn heavier than the other matches).
  let canvasSearchCurrent = null;
  // Extra words the palette search already knows (see the Logic Gate keywords).
  const LOGIC_GATE_SEARCH_ALIASES = { not: "inverter", buffer: "non-inverting" };
  function componentMatchesSearch(comp) {
    if (!canvasSearchQuery) return false;
    const def = window.getSimComponentDefinition(comp);
    const gateKey = comp.type === "logic_gate" ? window.simLogicGate(comp) : "";
    const gateName = gateKey ? `${window.SIM_LOGIC_GATES[gateKey].label} ${gateKey} ${LOGIC_GATE_SEARCH_ALIASES[gateKey] || ""}` : "";
    const haystacks = [comp.label, def && def.label, comp.type, gateName];
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
        }" r="5">${p.label ? `<title>${escapeXml(p.label)}</title>` : ""}</circle>`;
      })
      .join("");
  }

  function renderBuilder() {
    const { poweredComps, poweredWires } = window.computeSimPoweredSet(simData);
    const analysis = window.computeSimElectricalAnalysis(simData);
    updateWarningsBadge(analysis);
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
    updateCanvasSearchCount();
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

  // "3 matches", or "2 of 3" once Enter has stepped to one of them.
  function updateCanvasSearchCount() {
    const el = $("sim-canvas-search-count");
    let text = "";
    if (canvasSearchQuery) {
      const matches = simData.components.filter(componentMatchesSearch);
      const at = matches.findIndex((c) => c.id === canvasSearchCurrent);
      text = !matches.length ? "No match" : at >= 0 ? `${at + 1} of ${matches.length}` : `${matches.length} ${matches.length === 1 ? "match" : "matches"}`;
    }
    // Only written when it changes: this runs on every render, and a live
    // region that is rewritten with the same words gets announced again.
    if (el.textContent !== text) el.textContent = text;
  }

  $("sim-canvas-search").addEventListener("input", (e) => {
    canvasSearchQuery = e.target.value.trim().toLowerCase();
    canvasSearchCurrent = null;
    renderBuilder();
  });

  // Enter steps to the next match (Shift+Enter the previous one) and scrolls
  // it into the middle of the view, so a match off-screen on a zoomed board
  // can actually be found.
  $("sim-canvas-search").addEventListener("keydown", (e) => {
    // keyCode 229 is Safari's Enter that commits an IME candidate (isComposing is already false then).
    if (e.key !== "Enter" || e.isComposing || e.keyCode === 229) return;
    e.preventDefault();
    const matches = simData.components.filter(componentMatchesSearch);
    if (!matches.length) return;
    const at = matches.findIndex((c) => c.id === canvasSearchCurrent);
    const step = e.shiftKey ? -1 : 1;
    const next = matches[at === -1 ? (step > 0 ? 0 : matches.length - 1) : (at + step + matches.length) % matches.length];
    canvasSearchCurrent = next.id;
    renderBuilder();
    const def = window.getSimComponentDefinition(next);
    const svg = $("sim-builder-svg");
    if (def && svg) {
      const vb = svg.viewBox.baseVal;
      centerCanvasOn((next.x + def.w / 2) / vb.width, (next.y + def.h / 2) / vb.height);
      // On a phone or a short window the canvas can sit below the fold, so
      // bring the match itself into view too (a no-op when it already is).
      const box = svg.querySelector(".sim-search-match-box.is-current");
      if (box && box.scrollIntoView) box.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  });

  // ---------- Circuit warnings ----------
  // The solver already works out a status for every part it can analyse; this turns those statuses (and the parts it
  // could NOT analyse) into plain sentences, so a misleading-looking circuit says so instead of just showing a dim
  // part. Danger and warning lines are counted on the toolbar button; notes are only listed.
  function circuitWarnings(analysis) {
    const out = [];
    const names = checklistPartNames();
    const nameOf = (id) => names.get(id) || "A part";
    const add = (level, text) => out.push({ level, text });
    let outletLoop = false;
    for (const comp of simData.components) {
      const r = analysis[comp.id];
      if (!r) continue;
      const n = nameOf(comp.id);
      if (r.dangerous) outletLoop = true;
      if (r.kind === "led") {
        if (r.status === "reversed") add("warning", `${n} is the wrong way round, so no current can flow through this loop. Swap its two legs.`);
        else if (r.status === "blocked") add("warning", `${n} is blocked by a backwards LED in the same loop.`);
        else if (r.status === "burnt" && !r.dangerous) add("danger", `${n} would burn out: the current is far above a typical LED's 20 mA. Add or enlarge a series resistor.`);
        else if (r.status === "overdriven") add("warning", `${n} is overdriven: more than 1.5 times a typical LED's 20 mA.`);
        else if (r.status === "unlit-low-voltage") add("warning", `${n} gets too little voltage to light.`);
        else if (r.status === "dim") add("note", `${n} has almost no current (under 1 mA), so it will barely glow.`);
      } else if (r.kind === "resistor" && r.status === "overheating") {
        add(
          "warning",
          comp.type === "inductor"
            ? `${n} would run hot: ${r.watts.toFixed(2)} W in its winding (the check uses the same rough 0.25 W limit as a resistor).`
            : `${n} would overheat: it dissipates ${r.watts.toFixed(2)} W against a typical 0.25 W rating.`
        );
      } else if (r.kind === "teensy" && r.status === "overheating") {
        add("warning", `${n} would overheat at this current.`);
      } else if (r.kind === "voltmeter" && r.status === "no-reading") {
        add("note", `${n} shows a dash: ${VOLTMETER_NO_READING[r.reason] || "the simulator can't vouch for a reading here."}`);
      }
    }
    if (outletLoop) add("danger", "The wall outlet (120 V) is wired straight into this circuit, which destroys most parts. Go through a Power Supply.");
    if (analysis.meta && analysis.meta.parallel) {
      add("warning", "This circuit has a parallel branch or a bypass. The simulator follows one path from each source, so the figures and statuses may be incomplete or missing: a backwards LED, for one, is only flagged when it is on the only route.");
    }
    // Parts that can carry or show current but weren't analysed: not on the path the solver followed.
    const analysable = new Set(["led", "resistor", "ammeter", "mcu_teensy"]);
    const hasSource = simData.components.some((c) => {
      const d = window.getSimComponentDefinition(c);
      return d && d.isSource;
    });
    const skipped = simData.components.filter((c) => analysable.has(c.type) && !analysis[c.id]);
    if (simData.components.length && !hasSource && skipped.length) {
      add("note", "There is no powered source in this circuit (a Power Supply only counts once its input is fed), so nothing is analysed yet.");
    } else if (skipped.length) {
      const shown = skipped.slice(0, 5).map((c) => nameOf(c.id)).join(", ");
      const openSwitch = simData.components.some((c) => c.type === "switch" && !window.simIsSwitchClosed(c));
      add(
        "note",
        `${skipped.length === 1 ? "This part shows" : `${skipped.length} parts show`} no status: ${shown}${skipped.length > 5 ? ", …" : ""}. ${skipped.length === 1 ? "It isn't" : "They aren't"} on the path the simulator followed from a source: the loop may be incomplete${openSwitch ? " (a switch is open)" : ""}, or ${skipped.length === 1 ? "it sits" : "they sit"} on a parallel branch.`
      );
    }
    const rank = { danger: 0, warning: 1, note: 2 };
    return out.sort((a, b) => rank[a.level] - rank[b.level]);
  }
  let lastWarnings = [];
  let lastWarningsSummary = "";
  function updateWarningsBadge(analysis) {
    const btn = $("sim-warnings-btn");
    if (!btn) return;
    lastWarnings = circuitWarnings(analysis);
    const count = (level) => lastWarnings.filter((w) => w.level === level).length;
    const danger = count("danger");
    const warning = count("warning");
    const notes = count("note");
    // Notes count too: a circuit where nothing could be analysed must not read as an all-clear.
    const parts = [];
    if (danger) parts.push(`${danger} danger`);
    if (warning) parts.push(`${warning} warning${warning === 1 ? "" : "s"}`);
    if (notes) parts.push(`${notes} note${notes === 1 ? "" : "s"}`);
    const summary = parts.length ? parts.join(" · ") : "No warnings";
    btn.textContent = summary;
    btn.dataset.level = danger ? "danger" : warning ? "warning" : notes ? "note" : "";
    btn.title = lastWarnings.length ? "Click for the details in plain words" : "The simulator found nothing to flag in this circuit";
    // A polite announcement only when the summary changes (the button text itself isn't a live region).
    const live = $("sim-warnings-live");
    if (live && summary !== lastWarningsSummary) live.textContent = `Circuit check: ${summary}`;
    lastWarningsSummary = summary;
  }
  $("sim-warnings-btn").addEventListener("click", () => {
    const LEVEL_LABEL = { danger: "Danger", warning: "Warning", note: "Note" };
    $("sim-warnings-body").innerHTML = lastWarnings.length
      ? `<ul class="sim-model-list sim-warning-list">${lastWarnings.map((w) => `<li data-level="${w.level}"><strong>${LEVEL_LABEL[w.level]}:</strong> ${escapeXml(w.text)}</li>`).join("")}</ul>`
      : "<p class='sim-checklist-empty'>Nothing to flag. Every part the simulator can analyse looks fine for this circuit. See Model notes for what it does not check.</p>";
    $("sim-warnings-modal").hidden = false;
  });
  $("close-sim-warnings").addEventListener("click", () => {
    $("sim-warnings-modal").hidden = true;
    $("sim-warnings-btn").focus();
  });

  // ---------- Model notes ----------
  // Answers "what is this simulator really doing?": the general limits, then how each part type in THIS circuit
  // is modelled (the same text the part tooltips and the inspector use), then the rest of the parts.
  const SIM_GENERAL_LIMITS = [
    "It checks a circuit as direct current (DC) only: no AC, and nothing changes over time (no start-up or switching transients).",
    "Each source is solved on its own as one series path. Parallel branches, bypasses and several sources in one circuit are beyond what it can vouch for. Only voltmeters flag this, with a dash; other parts still show figures worked out from that one path, and a part on a side branch gets no status at all.",
    "Wires, breadboard strips and meter probes are perfect conductors (zero resistance), and sources are ideal: they hold their voltage with no sag or current limit beyond the part's own settings.",
    "Capacitors count as open circuits and inductors as their winding resistance alone.",
    "Part ratings are typical fixed values, not a real part's datasheet: LEDs 20 mA, resistors 0.25 W, the Teensy 1 W.",
    "Microcontroller pins and firmware are not simulated, and logic gates are diagram parts that document the truth table without being simulated.",
    "It is a learning aid, not a design tool: real parts have tolerances and limits it does not model.",
  ];
  function renderModelNotes() {
    const typesHere = [...new Set(simData.components.map((c) => c.type))];
    const partRow = (type) => {
      const m = partModel(type);
      const def = REG[type];
      if (!m || !def) return "";
      return `<li><strong>${escapeXml(def.label)}</strong> <span class="sim-model-kind">${escapeXml(m.kind)}</span>: ${escapeXml(m.text)}</li>`;
    };
    const here = typesHere.map(partRow).filter(Boolean);
    const others = Object.keys(SIM_PART_MODEL).filter((t) => !typesHere.includes(t) && REG[t]).map(partRow).filter(Boolean);
    $("sim-model-body").innerHTML =
      `<h2>What the simulator assumes</h2><ul class="sim-model-list">${SIM_GENERAL_LIMITS.map((t) => `<li>${escapeXml(t)}</li>`).join("")}</ul>` +
      `<h2>Parts in this circuit</h2>${here.length ? `<ul class="sim-model-list">${here.join("")}</ul>` : "<p class='sim-checklist-empty'>No parts placed yet.</p>"}` +
      (others.length ? `<details class="sim-model-more"><summary>Other parts (${others.length})</summary><ul class="sim-model-list">${others.join("")}</ul></details>` : "");
  }
  $("sim-model-notes-btn").addEventListener("click", () => {
    renderModelNotes();
    $("sim-model-modal").hidden = false;
  });
  $("close-sim-model").addEventListener("click", () => {
    $("sim-model-modal").hidden = true;
    $("sim-model-notes-btn").focus();
  });

  // ---------- Build checklist ----------
  // A plain-language list for building the circuit on real hardware: the parts to gather, then one step per wire
  // ("Connect R1 end 2 to LED1 anode"). Ticks live only in the open dialog (nothing is saved), and the whole list
  // can be copied as text or printed.
  const BB_PIN_NAMES = { rpt: "+ rail (top)", rnt: "− rail (top)", rnb: "− rail (bottom)", rpb: "+ rail (bottom)", t: "top half, column", b: "bottom half, column" };
  // Labels are typed by hand; control and direction-override characters could reorder the text that names a part.
  const cleanChecklistText = (v) => String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, "").trim();
  function checklistPartNames() {
    const counts = {};
    const names = new Map();
    for (const c of simData.components) {
      const def = REG[c.type];
      const base = (def && def.label) || c.type;
      counts[c.type] = (counts[c.type] || 0) + 1;
      const label = cleanChecklistText(c.label);
      // A part still carrying its default label (the type's own name) is numbered instead: "Resistor 1".
      names.set(c.id, label && label.toLowerCase() !== base.toLowerCase() ? `${label} (${base})` : `${base} ${counts[c.type]}`);
    }
    // Two parts that ended up with the same name are told apart by a number, so every step names one physical part.
    const seen = {};
    for (const n of names.values()) seen[n] = (seen[n] || 0) + 1;
    const used = {};
    for (const [id, n] of names) {
      if (seen[n] > 1) {
        used[n] = (used[n] || 0) + 1;
        names.set(id, `${n} #${used[n]}`);
      }
    }
    return names;
  }
  function checklistPinName(comp, pinId) {
    if (comp && comp.type === "breadboard") {
      const m = /^(rpt|rnt|rnb|rpb|t|b)(\d+)$/.exec(String(pinId));
      if (m) return m[1].length === 3 ? `${BB_PIN_NAMES[m[1]]}, hole ${m[2]}` : `${BB_PIN_NAMES[m[1]]} ${m[2]}`;
    }
    const def = comp && REG[comp.type];
    const pin = def && def.pins.find((x) => x.id === pinId);
    if (pin && pin.label) return cleanChecklistText(pin.label);
    // Registry ids like "p1" or "d0" mean little to someone building it: "lead 1", "pin D0".
    const id = String(pinId);
    const lead = /^p(\d+)$/i.exec(id);
    if (lead) return `lead ${lead[1]}`;
    return /^[a-z]{1,2}\d+$/i.test(id) ? `pin ${id.toUpperCase()}` : id; // "d0" -> "pin D0"; "anode" stays "anode"
  }
  function buildChecklist() {
    const names = checklistPartNames();
    const byId = new Map(simData.components.map((c) => [c.id, c]));
    const parts = simData.components.filter((c) => c.type !== "breadboard").map((c) => names.get(c.id));
    const boards = simData.components.filter((c) => c.type === "breadboard").map((c) => names.get(c.id));
    const steps = [];
    for (const w of simData.wires) {
      const a = byId.get(w.from.compId);
      const b = byId.get(w.to.compId);
      if (!a || !b) continue;
      const verb = w.auto === true ? "Plug" : "Connect";
      const joiner = w.auto === true ? "into" : "to";
      const wl = cleanChecklistText(w.label);
      steps.push(`${verb} ${names.get(a.id)}, ${checklistPinName(a, w.from.pin)} ${joiner} ${names.get(b.id)}, ${checklistPinName(b, w.to.pin)}${wl ? ` (${wl})` : ""}`);
    }
    return { boards, parts, steps };
  }
  function renderChecklist() {
    const { boards, parts, steps } = buildChecklist();
    const list = $("sim-checklist-list");
    const row = (text, group, i) => `<label class="sim-checklist-row"><input type="checkbox" data-group="${group}" data-i="${i}"> <span>${escapeXml(text)}</span></label>`;
    list.innerHTML =
      (boards.length ? `<h2>Boards</h2>${boards.map((t, i) => row(t, "board", i)).join("")}` : "") +
      `<h2>Parts to gather (${parts.length})</h2>${parts.length ? parts.map((t, i) => row(t, "part", i)).join("") : "<p class='sim-checklist-empty'>No parts placed yet.</p>"}` +
      `<h2>Connections (${steps.length})</h2>${steps.length ? steps.map((t, i) => row(t, "step", i)).join("") : "<p class='sim-checklist-empty'>No wires yet.</p>"}`;
    list.querySelectorAll("input[type=checkbox]").forEach((box) => box.addEventListener("change", updateChecklistProgress));
    updateChecklistProgress();
  }
  function updateChecklistProgress() {
    const boxes = [...$("sim-checklist-list").querySelectorAll("input[type=checkbox]")];
    const done = boxes.filter((b) => b.checked).length;
    $("sim-checklist-progress").textContent = boxes.length ? `${done} of ${boxes.length} done` : "Nothing to build yet: place some parts first.";
    boxes.forEach((b) => b.closest("label").classList.toggle("is-done", b.checked));
  }
  function checklistText() {
    const { boards, parts, steps } = buildChecklist();
    const lines = [`Build checklist (${parts.length} parts${boards.length ? `, ${boards.length} board${boards.length === 1 ? "" : "s"}` : ""}, ${steps.length} connections)`];
    if (boards.length) lines.push("", "Boards", ...boards.map((t) => `[ ] ${t}`));
    lines.push("", "Parts to gather", ...(parts.length ? parts.map((t) => `[ ] ${t}`) : ["(none)"]));
    lines.push("", "Connections", ...(steps.length ? steps.map((t, i) => `[ ] ${i + 1}. ${t}`) : ["(none)"]));
    return lines.join("\n");
  }
  $("sim-checklist-btn").addEventListener("click", () => {
    renderChecklist();
    $("sim-checklist-modal").hidden = false;
  });
  $("close-sim-checklist").addEventListener("click", () => {
    $("sim-checklist-modal").hidden = true;
    $("sim-checklist-btn").focus();
  });
  $("sim-checklist-clear").addEventListener("click", () => {
    $("sim-checklist-list").querySelectorAll("input[type=checkbox]").forEach((b) => (b.checked = false));
    updateChecklistProgress();
  });
  $("sim-checklist-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(checklistText());
      updateChecklistProgress();
      $("sim-checklist-progress").textContent += " · Copied to the clipboard";
    } catch (e) {
      updateChecklistProgress();
      $("sim-checklist-progress").textContent += " · Couldn't copy automatically; select the list and copy it by hand";
    }
  });
  $("sim-checklist-print").addEventListener("click", () => {
    // Printed from a hidden frame so the page behind it isn't printed with it.
    const frame = document.createElement("iframe");
    frame.style.cssText = "position:fixed;width:0;height:0;border:0;right:0;bottom:0";
    document.body.appendChild(frame);
    const doc = frame.contentDocument;
    doc.open();
    doc.write(`<!doctype html><title>Build checklist</title><style>body{font:14px/1.5 system-ui,sans-serif;margin:24px}h2{font-size:15px;margin:18px 0 6px}pre{white-space:pre-wrap;font:inherit}</style><pre>${escapeXml(checklistText())}</pre>`);
    doc.close();
    const cleanup = () => frame.remove();
    frame.contentWindow.addEventListener("afterprint", cleanup);
    setTimeout(cleanup, 60000); // fallback if the browser never reports the print dialog closing
    frame.contentWindow.focus();
    frame.contentWindow.print();
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
  const SNAP_TO_BREADBOARD_TYPES = new Set(["led", "resistor", "switch", "potentiometer", "ammeter", "voltmeter", "capacitor", "inductor"]);
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
  function setSnapHoleWarning(occupiedHoleCount, message = "") {
    const status = $("sim-hole-warning");
    if (!status) return;
    if (message) {
      status.textContent = message;
      status.hidden = false;
      return;
    }
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
    const selectedGroupIds = selected && selected.kind === "multi" && selected.ids.includes(compId) ? selected.ids : [compId];
    if (selectedGroupIds.length === 1) selected = { kind: "component", id: compId };
    // Locked members stay put while the rest of the group moves.
    const groupIds = selectedGroupIds.filter((id) => !isCompLocked(id));
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
    let pointerDragged = false; // set when a press on a part that can't move is dragged

    // Breadboard auto-snap only applies to a single-part drag — snapping
    // several independently-positioned parts to holes at once as a rigid
    // group doesn't make physical sense, so a group drag is a plain,
    // grid-snapped move instead.
    const isGroup = groupIds.length > 1;
    const canSnap = !isGroup && groupIds[0] === compId && SNAP_TO_BREADBOARD_TYPES.has(comp.type);
    const compDef = canSnap ? window.getSimComponentDefinition(comp) : null;
    const anchorPin = compDef ? compDef.pins[0] : null;
    let snapTargets = {}; // pinId -> { breadboardId, holeId }

    function onMove(ev) {
      const p = svgPoint(ev);
      let dx = p.x - start.x;
      let dy = p.y - start.y;
      if (!canSnap && gridSnapSize > 0) {
        // Snapped by the first part that can move (the clicked one may be locked).
        const anchorStart = startPositions.get(groupIds[0]);
        dx = Math.round((anchorStart.x + dx) / gridSnapSize) * gridSnapSize - anchorStart.x;
        dy = Math.round((anchorStart.y + dy) / gridSnapSize) * gridSnapSize - anchorStart.y;
      }
      ({ dx, dy } = clampMoveToBoard(Array.from(startPositions.values()), dx, dy));
      if (!historySaved) {
        // A drag that goes nowhere (pushing against the board edge, or a
        // wobble that snaps back to the grid) is still just a click.
        if (!dx && !dy) return;
        pushHistory();
        historySaved = true;
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
        let hole = findNearestHole(anchorAbs.x, anchorAbs.y, compId, SNAP_THRESHOLD);
        if (hole) {
          // A hole near the board's edge can sit where the part itself
          // would have to hang off it (and then never be drawn): skip
          // that snap and leave the part where the drag put it.
          const snappedX = comp.x + hole.x - anchorAbs.x;
          const snappedY = comp.y + hole.y - anchorAbs.y;
          if (snappedX >= 0 && snappedX <= BOARD_MAX_X && snappedY >= 0 && snappedY <= BOARD_MAX_Y) {
            comp.x = snappedX;
            comp.y = snappedY;
          } else {
            hole = null;
          }
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
      queueMinimapRender();
    }
    function onUp() {
      g.removeEventListener("pointermove", onMove);
      g.removeEventListener("pointerup", onUp);
      if (!historySaved && !pointerDragged && comp.type === "switch") {
        // A plain click (no drag) on a switch toggles it, like flipping one for real.
        pushHistory();
        comp.closed = comp.closed === false;
        renderInspector();
      } else if (!historySaved && !pointerDragged && comp.type === "switch_spdt") {
        pushHistory();
        comp.position = window.simSpdtThrow(comp) === "a" ? "b" : "a";
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
    if (groupIds.length) {
      g.addEventListener("pointermove", onMove);
    } else {
      // Nothing here can move: say why the first time the pointer drags.
      const explain = (ev) => {
        if (Math.hypot(ev.clientX - e.clientX, ev.clientY - e.clientY) < 5) return;
        g.removeEventListener("pointermove", explain);
        pointerDragged = true;
        showLockNotice("That part is locked. Unlock it in the inspector to move it.");
      };
      g.addEventListener("pointermove", explain);
      g.addEventListener("pointerup", () => g.removeEventListener("pointermove", explain), { once: true });
    }
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
    switch_spdt: { position: "a" },
    potentiometer: { maxResistance: 10000, wiper: 50 },
    capacitor: { capacitance: 100 },
    logic_gate: { gate: "and" },
    inductor: { inductance: 10, dcResistance: 1 },
  };

  // How the simulator treats each part, in one sentence: "Electrical" parts are
  // analysed, "(DC only)" ones are reduced to a steady-state equivalent,
  // "Mechanical" parts only join holes, a "Display" responds to power without
  // being analysed, and a "Diagram part" is drawn but not simulated. Shown as the
  // palette tooltip and, under the part's name, in the inspector. `brief` parts
  // (the capacitor and inductor) already explain themselves in an "Electrical
  // effect" paragraph there, so the inspector shows just the category for them;
  // gates have their own status line.
  // Keep in step with SIM_COMPONENTS (a new part type without an entry simply
  // shows nothing).
  const SIM_PART_MODEL = {
    outlet: { kind: "Electrical", text: "supplies a constant 120V (real mains is AC; here it is treated as steady DC); most parts in a loop with it are destroyed, so go through a Power Supply." },
    power_supply: { kind: "Electrical", text: "gives a fixed DC voltage, but only once its input is powered." },
    battery: { kind: "Electrical", text: "supplies a constant DC voltage, with an optional internal resistance." },
    breadboard: { kind: "Mechanical", text: "joins holes in column strips and power rails; nothing electrical of its own." },
    led: { kind: "Electrical", text: "lights only when wired the right way round; checked for current and burn-out against a typical 20 mA rating." },
    resistor: { kind: "Electrical", text: "limits current by Ohm's law; checked for overheating against a typical 0.25 W rating." },
    potentiometer: { kind: "Electrical", text: "acts as a two-terminal variable resistor set by its wiper." },
    capacitor: { kind: "Electrical (DC only)", text: "counts as an open circuit.", brief: true },
    inductor: { kind: "Electrical (DC only)", text: "counts as its winding resistance alone.", brief: true },
    switch: { kind: "Electrical", text: "opens or closes the path." },
    switch_spdt: { kind: "Electrical", text: "joins the common terminal to one of two throws." },
    ammeter: { kind: "Electrical", text: "shows the current through it, with zero resistance." },
    voltmeter: { kind: "Electrical", text: "reads the voltage between its probes in a series circuit and draws no current; a dash means the simulator can't vouch for that point (parallel branches, several sources)." },
    mcu_teensy: { kind: "Electrical", text: "acts as a fixed 300 Ω load and is checked for overheating (1 W); its digital pins and firmware aren't simulated." },
    tv: { kind: "Display", text: "lights up when powered (preview or Power on); it isn't analysed for current." },
    logic_gate: { kind: "Diagram part", text: "drawn for documentation, not simulated.", hideInInspector: true },
  };
  // Why a voltmeter shows a dash (the analysis says which; see collectNodePotentials).
  const VOLTMETER_NO_READING = {
    unwired: "connect both probes into a circuit.",
    nosource: "there is no powered source in this circuit (a Power Supply needs its input fed and its own loop closed).",
    probes: "the two probes need to be in the same circuit.",
    sources: "more than one source (or a Power Supply output) is wired into this circuit, and the simulator solves each source on its own.",
    parallel: "this circuit has parallel branches or a bypass (a switch or wire across a part), and the simulator solves one series path per source, so it can't vouch for the voltage.",
    short: "this source is short-circuited, so no voltage is defined.",
    ambiguous: "LEDs that aren't conducting (too little voltage, or backwards) share the voltage in a way the simulator can't work out.",
    invalid: "the source's voltage isn't a usable number.",
  };
  function partModel(type) {
    return Object.prototype.hasOwnProperty.call(SIM_PART_MODEL, type) ? SIM_PART_MODEL[type] : null;
  }
  function partModelTip(type) {
    const m = partModel(type);
    return m ? `${m.kind}: ${m.text}` : "";
  }
  function partModelHtml(type) {
    const m = partModel(type);
    if (!m || m.hideInInspector) return "";
    return `<p class="sim-part-model"><strong>${escapeXml(m.kind)}${m.brief ? "" : ":"}</strong>${m.brief ? "" : ` ${escapeXml(m.text)}`}</p>`;
  }

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
        .map((type) => `<button type="button" class="sim-palette-recent-btn" data-sim-type="${escapeXml(type)}"${partModelTip(type) ? ` title="${escapeXml(partModelTip(type))}"` : ""}>${escapeXml(REG[type].label)}</button>`)
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
    if (partModelTip(btn.dataset.simType) && !btn.title) btn.title = partModelTip(btn.dataset.simType);
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
      const haystack = `${btn.textContent} ${(def && def.keywords) || ""} ${(partModel(btn.dataset.simType) || {}).kind || ""}`.toLowerCase();
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

  function describeSpdtElectricalEffect(position) {
    const [on, off] = position === "b" ? ["B", "A"] : ["A", "B"];
    return `The common terminal is connected to throw ${on}. Throw ${off} is disconnected, so current can only flow between common and throw ${on}, and only if the rest of the circuit is complete.`;
  }

  // Where throw A and throw B sit on screen right now (rotation and flip move
  // them), so the Position options can say "upper"/"lower" or "left"/"right".
  function spdtThrowSides(comp) {
    const pins = window.getSimComponentDefinition(comp).pins;
    const a = pins.find((p) => p.id === "a");
    const b = pins.find((p) => p.id === "b");
    if (Math.abs(a.y - b.y) >= Math.abs(a.x - b.x)) return a.y <= b.y ? ["upper", "lower"] : ["lower", "upper"];
    return a.x <= b.x ? ["left", "right"] : ["right", "left"];
  }

  function describeSwitchElectricalEffect(closed) {
    return closed
      ? "Closed — both terminals are connected; current can flow if the rest of the circuit is complete."
      : "Open — both terminals are disconnected, so current cannot flow through this switch.";
  }

  // ---------- Inspector ----------
  // Rotate (90-degree steps) and flip a single part in place. Orientation
  // lives in the part's definition (see orientDefinition in sim-components.js),
  // so every pin position derives from it. Flip is a true left/right mirror on
  // screen at every rotation: the stored mirror flag toggles and the rotation
  // is reversed (a mirror applied outside a 90-degree turn is a mirror
  // top-to-bottom inside it). A 90/270 turn keeps the part's visual centre
  // (every shipped part's width/height differ by an even number, so the shift
  // is whole and four turns land back exactly where they started) instead of
  // pivoting on its corner. A part plugged
  // into a breadboard is re-seated afterwards: legs that still land exactly on
  // a hole stay plugged, the rest are unplugged rather than leaving a wire
  // stretched to where the pin used to be, and the admin is told.
  function orientComponent(comp, { rotateBy = 0, flip = false } = {}) {
    if (!comp || comp.type === "breadboard") return;
    if (comp.locked === true) {
      showLockNotice("Unlock this part to rotate or flip it.");
      return;
    }
    pushHistory();
    const focusId = document.activeElement && /^sim-(rotate-cw|rotate-ccw|flip)$/.test(document.activeElement.id) ? document.activeElement.id : null;
    const countPlugged = () =>
      simData.wires.filter((w) => w.auto && (w.from.compId === comp.id || w.to.compId === comp.id)).length;
    const pluggedBefore = countPlugged();
    const sizeBefore = window.getSimComponentDefinition(comp);
    const current = typeof comp.rotation === "number" && window.SIM_ORIENTATION_ROTATIONS.includes(comp.rotation) ? comp.rotation : 0;
    let rotation = current;
    let mirror = comp.mirror === true;
    if (rotateBy) rotation = (((current + rotateBy) % 360) + 360) % 360;
    if (flip) {
      mirror = !mirror;
      rotation = (360 - rotation) % 360;
    }
    if (rotation) comp.rotation = rotation;
    else delete comp.rotation;
    if (mirror) comp.mirror = true;
    else delete comp.mirror;
    const sizeAfter = window.getSimComponentDefinition(comp);
    if (sizeAfter.w !== sizeBefore.w) {
      const place = (value, max) => Math.max(0, Math.min(max, Math.round(value)));
      comp.x = place(comp.x + (sizeBefore.w - sizeAfter.w) / 2, 1500);
      comp.y = place(comp.y + (sizeBefore.h - sizeAfter.h) / 2, 700);
    }
    let occupiedHoleCount = 0;
    if (SNAP_TO_BREADBOARD_TYPES.has(comp.type)) {
      const def = window.getSimComponentDefinition(comp);
      const snapTargets = {};
      def.pins.forEach((pin) => {
        const hole = findNearestHole(comp.x + pin.x, comp.y + pin.y, comp.id, SNAP_EXACT_TOLERANCE);
        if (hole) snapTargets[pin.id] = hole;
      });
      occupiedHoleCount = rebuildBreadboardSnapWires(
        simData,
        comp.id,
        new Set(def.pins.map((pin) => pin.id)),
        snapTargets,
        () => newLocalId("wire")
      );
    }
    const lifted = pluggedBefore - countPlugged();
    renderInspector();
    renderBuilder();
    if (focusId && $(focusId)) $(focusId).focus();
    setSnapHoleWarning(
      occupiedHoleCount,
      lifted > 0
        ? `Turning this part unplugged ${lifted === 1 ? "1 lead" : `${lifted} leads`} from the breadboard. Drag the part back onto the holes to plug it in again.`
        : ""
    );
  }

  // Changing a gate between one- and two-input types removes its second
  // input pin; any wire still pointing at it would fail validation.
  function pruneWiresToMissingPins(comp) {
    const validPins = new Set(window.getSimComponentDefinition(comp).pins.map((pin) => pin.id));
    const before = simData.wires.length;
    simData.wires = simData.wires.filter((wire) => {
      const fromValid = !wire.from || wire.from.compId !== comp.id || validPins.has(wire.from.pin);
      const toValid = !wire.to || wire.to.compId !== comp.id || validPins.has(wire.to.pin);
      return fromValid && toValid;
    });
    return before - simData.wires.length;
  }

  function describeOrientation(comp) {
    const rotation = typeof comp.rotation === "number" && window.SIM_ORIENTATION_ROTATIONS.includes(comp.rotation) ? comp.rotation : 0;
    if (!rotation && comp.mirror !== true) return "Orientation: default";
    return `Orientation: ${rotation ? `${rotation}° clockwise` : "not rotated"}${comp.mirror === true ? ", flipped" : ""}`;
  }

  // The builder only draws (and the viewer only accepts) parts with
  // 0 <= x <= 1500 and 0 <= y <= 700, so a drag, nudge or duplicate that
  // crossed an edge used to make the part vanish. This trims a move so
  // every part in the group stays on the board.
  const BOARD_MAX_X = 1500;
  const BOARD_MAX_Y = 700;
  function clampMoveToBoard(starts, dx, dy) {
    let lowX = -Infinity;
    let highX = Infinity;
    let lowY = -Infinity;
    let highY = Infinity;
    starts.forEach((pos) => {
      lowX = Math.max(lowX, -pos.x);
      highX = Math.min(highX, BOARD_MAX_X - pos.x);
      lowY = Math.max(lowY, -pos.y);
      highY = Math.min(highY, BOARD_MAX_Y - pos.y);
    });
    return { dx: Math.min(highX, Math.max(lowX, dx)), dy: Math.min(highY, Math.max(lowY, dy)) };
  }

  // Where a duplicate lands: 20px down and right, or up and left on an
  // axis where that would run off the board, so it never sits invisibly
  // on top of the original.
  function duplicateShift(parts) {
    const forward = clampMoveToBoard(parts, 20, 20);
    const back = clampMoveToBoard(parts, -20, -20);
    return { dx: forward.dx || back.dx, dy: forward.dy || back.dy };
  }

  // ---------- Align / distribute ----------
  // Pure layout maths on {id, x, y, w, h} footprints: returns a Map of
  // id -> {x, y} for just the parts that have to move. Wires are drawn from
  // the parts' live positions, so they follow without being touched.
  function computeSimArrangement(boxes, action) {
    const moves = new Map();
    moves.clamped = 0; // parts whose result was held at the board edge
    moves.overlap = false; // distribute declined because the parts overlap
    moves.blocked = 0; // parts that could not move because they are already at the board edge
    if (!Array.isArray(boxes) || boxes.length < 2) return moves;
    const left = Math.min(...boxes.map((b) => b.x));
    const right = Math.max(...boxes.map((b) => b.x + b.w));
    const top = Math.min(...boxes.map((b) => b.y));
    const bottom = Math.max(...boxes.map((b) => b.y + b.h));
    const heldAtEdge = new Set(); // moved, but stopped short at the edge
    const blocked = new Set(); // wanted to move but is already at the edge
    // Sets one axis of one part. Moves under half a pixel are ignored (parts
    // already lined up with fractional coordinates stay put), only the axis
    // being changed is rounded, and the result is held on the board so a
    // wide part can't be sent somewhere that is never drawn.
    const put = (b, axis, value) => {
      if (b.locked) return; // locked parts are fixed references
      if (Math.abs(value - b[axis]) < 0.5) return;
      const wanted = Math.round(value);
      const next = Math.max(0, Math.min(axis === "x" ? BOARD_MAX_X : BOARD_MAX_Y, wanted));
      if (next === b[axis]) {
        if (next !== wanted) blocked.add(b.id);
        return;
      }
      if (next !== wanted) heldAtEdge.add(b.id);
      moves.set(b.id, { ...(moves.get(b.id) || { x: b.x, y: b.y }), [axis]: next });
    };
    const spread = (axis) => {
      // Locked parts don't take part in spacing: the rest are spread among themselves.
      const free = boxes.filter((b) => !b.locked);
      if (free.length < 3) return;
      const size = axis === "x" ? "w" : "h";
      // Ordered by centre, so a wide part doesn't leapfrog a narrow one;
      // the two outermost parts stay put and the gaps between are equalised.
      const order = free
        .map((b, index) => ({ b, index, centre: b[axis] + b[size] / 2 }))
        .sort((p, q) => p.centre - q.centre || p.b[axis] - q.b[axis] || p.index - q.index)
        .map((entry) => entry.b);
      const first = order[0];
      const last = order[order.length - 1];
      const used = order.reduce((sum, b) => sum + b[size], 0);
      const gap = (last[axis] + last[size] - first[axis] - used) / (order.length - 1);
      // Parts that already overlap more than the space allows have no even
      // spacing; pretending otherwise would shuffle them on every press.
      if (gap < 0) {
        moves.overlap = true;
        return;
      }
      let cursor = first[axis];
      order.forEach((b) => {
        put(b, axis, cursor);
        cursor += b[size] + gap;
      });
    };
    switch (action) {
      case "align-left": boxes.forEach((b) => put(b, "x", left)); break;
      case "align-center": boxes.forEach((b) => put(b, "x", (left + right) / 2 - b.w / 2)); break;
      case "align-right": boxes.forEach((b) => put(b, "x", right - b.w)); break;
      case "align-top": boxes.forEach((b) => put(b, "y", top)); break;
      case "align-middle": boxes.forEach((b) => put(b, "y", (top + bottom) / 2 - b.h / 2)); break;
      case "align-bottom": boxes.forEach((b) => put(b, "y", bottom - b.h)); break;
      case "distribute-h": spread("x"); break;
      case "distribute-v": spread("y"); break;
    }
    moves.clamped = heldAtEdge.size;
    moves.blocked = blocked.size;
    return moves;
  }
  window.computeSimArrangement = computeSimArrangement;

  const ARRANGE_ACTIONS = [
    { id: "align-left", label: "Align left", icon: '<path d="M2 2v14"/><rect x="4" y="4" width="11" height="4"/><rect x="4" y="10" width="7" height="4"/>' },
    { id: "align-center", label: "Align centres horizontally", icon: '<path d="M9 2v14"/><rect x="3" y="4" width="12" height="4"/><rect x="5" y="10" width="8" height="4"/>' },
    { id: "align-right", label: "Align right", icon: '<path d="M16 2v14"/><rect x="3" y="4" width="11" height="4"/><rect x="7" y="10" width="7" height="4"/>' },
    { id: "align-top", label: "Align top", icon: '<path d="M2 2h14"/><rect x="4" y="4" width="4" height="11"/><rect x="10" y="4" width="4" height="7"/>' },
    { id: "align-middle", label: "Align centres vertically", icon: '<path d="M2 9h14"/><rect x="4" y="3" width="4" height="12"/><rect x="10" y="5" width="4" height="8"/>' },
    { id: "align-bottom", label: "Align bottom", icon: '<path d="M2 16h14"/><rect x="4" y="3" width="4" height="11"/><rect x="10" y="7" width="4" height="7"/>' },
    { id: "distribute-h", label: "Distribute horizontally", icon: '<path d="M2 2v14M16 2v14"/><rect x="6" y="4" width="6" height="10"/>', needs: 3 },
    { id: "distribute-v", label: "Distribute vertically", icon: '<path d="M2 2h14M2 16h14"/><rect x="4" y="6" width="10" height="6"/>', needs: 3 }
  ];

  function arrangeButtonsHtml(count) {
    const button = (a) => {
      const off = a.needs && count < a.needs;
      const title = off ? `${a.label} (select at least ${a.needs} parts)` : a.label;
      return `<button type="button" class="sim-arrange-btn" data-arrange="${a.id}" aria-label="${a.label}" title="${title}"${off ? ' disabled aria-describedby="sim-arrange-note"' : ""}><svg viewBox="0 0 18 18" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">${a.icon}</svg></button>`;
    };
    return `<div class="sim-arrange" role="group" aria-label="Align and distribute">
      <div class="sim-arrange-row">${ARRANGE_ACTIONS.slice(0, 6).map(button).join("")}</div>
      <div class="sim-arrange-row">${ARRANGE_ACTIONS.slice(6).map(button).join("")}</div>
      ${count < 3 ? '<p id="sim-arrange-note" class="sim-arrange-note">Distribute needs three or more parts.</p>' : ""}
      <p id="sim-arrange-status" class="sim-orient-status" role="status" aria-live="polite"></p>
    </div>`;
  }

  function arrangeSelected(action) {
    const status = $("sim-arrange-status");
    const boxes = selectedIds()
      .map((id) => simData.components.find((c) => c.id === id))
      .filter(Boolean)
      .map((comp) => {
        const def = window.getSimComponentDefinition(comp);
        return def && Number.isFinite(comp.x) && Number.isFinite(comp.y) ? { id: comp.id, x: comp.x, y: comp.y, w: def.w, h: def.h, locked: comp.locked === true } : null;
      })
      .filter(Boolean);
    const info = ARRANGE_ACTIONS.find((a) => a.id === action);
    if (!info) return;
    const lockedCount = boxes.filter((b) => b.locked).length;
    const moves = computeSimArrangement(boxes, action);
    if (!moves.size) {
      if (status) {
        status.textContent = moves.overlap
          ? `${info.label}: these parts overlap too much to space out evenly.`
          : lockedCount && lockedCount === boxes.length
            ? `${info.label}: these parts are locked.`
            : lockedCount && action.startsWith("distribute") && boxes.length - lockedCount < 3
              ? `${info.label}: needs three or more unlocked parts.`
              : moves.blocked
            ? `${info.label}: ${moves.blocked} ${moves.blocked === 1 ? "part is" : "parts are"} at the board edge and can't move further.`
            : `${info.label}: already lined up.`;
      }
      return;
    }
    pushHistory();
    const oldPos = new Map(boxes.map((box) => [box.id, { x: box.x, y: box.y }]));
    moves.forEach((pos, id) => {
      const comp = simData.components.find((c) => c.id === id);
      if (comp) {
        comp.x = pos.x;
        comp.y = pos.y;
      }
    });
    // A part seated in a breadboard stays seated only if it and the board
    // moved together. When one moved without the other, the automatic lead
    // would be left stretched across the canvas, so it is dropped (the same
    // as dragging the part alone) and the part counts as unplugged.
    const shiftOf = (comp) => {
      const old = oldPos.get(comp.id);
      return old ? { dx: comp.x - old.x, dy: comp.y - old.y } : { dx: 0, dy: 0 };
    };
    const unpluggedParts = new Set();
    simData.wires = simData.wires.filter((wire) => {
      if (wire.auto !== true || !wire.from || !wire.to) return true;
      const a = simData.components.find((c) => c.id === wire.from.compId);
      const b = simData.components.find((c) => c.id === wire.to.compId);
      if (!a || !b) return true;
      const board = a.type === "breadboard" ? a : b.type === "breadboard" ? b : null;
      if (!board) return true;
      const lead = board === a ? b : a;
      const moveOfBoard = shiftOf(board);
      const moveOfLead = shiftOf(lead);
      if (Math.abs(moveOfBoard.dx - moveOfLead.dx) < 0.5 && Math.abs(moveOfBoard.dy - moveOfLead.dy) < 0.5) return true;
      unpluggedParts.add(lead.id);
      return false;
    });
    const unplugged = unpluggedParts.size;
    renderBuilder();
    if (status) {
      const notes = [];
      if (moves.clamped) notes.push(`${moves.clamped} held at the board edge`);
      if (unplugged) notes.push(`${unplugged} unplugged from the breadboard`);
      if (lockedCount) notes.push(`${lockedCount} locked ${lockedCount === 1 ? "part stayed" : "parts stayed"} put`);
      status.textContent = `${info.label}: moved ${moves.size} ${moves.size === 1 ? "part" : "parts"}${notes.length ? ` (${notes.join(", ")})` : ""}.`;
    }
  }

  function renderInspector() {
    const box = $("sim-inspector");
    if (lockNoticeActive) {
      lockNoticeActive = false;
      setSnapHoleWarning(0);
    }
    if (
      !selected ||
      selected.kind !== "component" ||
      simData.components.find((c) => c.id === selected.id)?.type !== "breadboard"
    ) {
      breadboardResizeNotice = "";
    }
    if (!selected) {
      box.innerHTML =
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Click a part or a wire to edit it. Click a pin, then another pin, to wire them. Shift+click parts, or drag a box over empty canvas, to select several at once. With a part selected, press R to rotate it, Shift+R to rotate the other way, or F to flip it.</p>" +
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
      if (comp.type === "logic_gate") {
        statusLine = "Diagram part: drawn for documentation, not simulated";
      } else if (comp.type === "voltmeter") {
        statusLine = "Meter: reads without carrying any current";
      } else if (def.isSource) {
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
        // Voltmeter results carry volts, not a current.
        const ma = typeof info.currentMa !== "number" ? "" : info.currentMa === Infinity ? "∞" : info.currentMa.toFixed(1);
        if (info.kind === "led") {
          const messages = {
            burnt: info.dangerous
              ? `🔥 Destroyed instantly — ${info.voltage}V mains has no business touching an LED directly. Route it through a Power Supply.`
              : `🔥 Burnt out — ${ma}mA is way more current than an LED can take (safe is under 30mA). Add a bigger resistor.`,
            overdriven: `⚠ Overdriven at ${ma}mA — it'll be too bright and won't last (safe is under 30mA).`,
            "unlit-low-voltage": "Not enough voltage in this loop to light it.",
            reversed: "No current flows — an LED only conducts one way. Flip it around so current runs anode to cathode.",
            blocked: "No current flows here: another LED in this loop is wired backwards.",
            dim: `Barely lit — only ${ma}mA is flowing. Try a smaller resistor.`,
            normal: `✓ ${ma}mA — a healthy, safe current.`,
          };
          electricalHtml = `<p class="sim-power-status ${info.status === "normal" ? "is-powered" : "is-danger"}">${messages[info.status] || ""}</p>`;
        } else if (info.kind === "resistor") {
          // A potentiometer's analysis result also comes back as kind
          // "resistor" (it's wired as a plain two-terminal rheostat, see
          // sim-components.js), and so does an inductor's (its winding
          // resistance) -- same current/wattage math, just with
          // part-appropriate wording. A fixed resistor's rating comes from
          // its real-world 1/4W spec (RESISTOR_WATTAGE_RATING); a
          // potentiometer's is admin-configurable per instance, so calling
          // it "a typical 1/4W resistor" would be a wrong-part reference.
          const overheatMsg =
            comp.type === "potentiometer"
              ? `🔥 Overheating — dissipating ${info.watts.toFixed(2)}W, more than this potentiometer can safely handle.`
              : comp.type === "inductor"
              ? `🔥 Overheating — dissipating ${info.watts.toFixed(2)}W in its winding, more than a small inductor can handle. Add a resistor to limit the current.`
              : `🔥 Overheating — dissipating ${info.watts.toFixed(2)}W, more than a typical 1/4W resistor can handle.`;
          if (info.dangerous) {
            electricalHtml = `<p class="sim-power-status is-danger">🔥 Charred instantly — this loop is running straight off 120V mains.</p>`;
          } else if (info.status === "overheating") {
            electricalHtml = `<p class="sim-power-status is-danger">${overheatMsg}</p>`;
          } else if (info.currentMa === 0) {
            electricalHtml = `<p class="sim-power-status">No current flows through it in this loop (something else in the loop is blocking it).</p>`;
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
        } else if (info.kind === "voltmeter") {
          electricalHtml =
            info.volts === null
              ? `<p class="sim-power-status">No reading — ${VOLTMETER_NO_READING[info.reason] || VOLTMETER_NO_READING.unwired}</p>`
              : `<p class="sim-power-status is-powered">⚡ Reads ${window.simFormatVolts(info.volts)} from the + probe to the − probe.</p>`;
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
      } else if (comp.type === "logic_gate") {
        const gateKey = window.simLogicGate(comp);
        const gateInfo = window.SIM_LOGIC_GATES[gateKey];
        const truth = window.simLogicTruth(comp);
        const custom = window.simLogicIsCustom(comp);
        const rowBits = window.simLogicRows(gateKey);
        const inputNames = gateInfo.inputs === 2 ? ["A", "B"] : ["A"];
        extraFieldsHtml = `<label title="Which standard symbol to draw. A custom truth table is kept when the new gate has the same number of inputs, and reset to the standard one when it doesn't.">Gate<select id="sim-comp-gate">${Object.entries(window.SIM_LOGIC_GATES)
          .map(([key, g]) => `<option value="${key}" ${key === gateKey ? "selected" : ""}>${g.label}</option>`)
          .join("")}</select></label>
        <table class="sim-truth-table" aria-describedby="sim-truth-hint"><caption>Truth table${custom ? " (custom)" : ""}</caption><thead><tr>${inputNames.map((n) => `<th scope="col">${n}</th>`).join("")}<th scope="col">Out</th></tr></thead><tbody>${rowBits
          .map(
            (bits, i) =>
              `<tr>${bits.map((b) => `<td>${b}</td>`).join("")}<td><button type="button" class="sim-truth-out" data-row="${i}" aria-pressed="${truth[i] === 1}" aria-label="Output when ${bits
                .map((b, k) => `${inputNames[k]} is ${b}`)
                .join(" and ")}">${truth[i]}</button></td></tr>`
          )
          .join("")}</tbody></table>
        <button type="button" id="sim-truth-reset" ${custom ? "" : "disabled"}>Reset to standard ${gateInfo.label}</button>
        <p id="sim-truth-hint" class="sim-electrical-effect"><strong>Truth table:</strong> Logic gates are drawn with their standard symbol and carry this table as documentation (a custom table dashes the outline). Signals aren't simulated, so wiring one into a circuit doesn't change any analysis. Click an output to flip it; a pressed output button means the gate outputs 1.</p>`;
      } else if (comp.type === "capacitor") {
        extraFieldsHtml = `<label title="How much charge the capacitor can hold per volt. Common values run from picofarads to thousands of microfarads. Recorded for reference -- charging over time isn't simulated.">Capacitance (µF)<input id="sim-comp-capacitance" type="number" min="0.000001" step="any" value="${window.simCapacitanceUf(comp)}"></label>
        <p class="sim-electrical-effect"><strong>Electrical effect:</strong> In a steady-state circuit a capacitor charges up and then stops current, so it acts like an open circuit here: anything wired through it gets no power. The value is for reference; charging over time isn't simulated.</p>`;
      } else if (comp.type === "inductor") {
        extraFieldsHtml = `<label title="How strongly the coil resists changes in current. Recorded for reference -- sudden-change behaviour isn't simulated.">Inductance (mH)<input id="sim-comp-inductance" type="number" min="0.000001" step="any" value="${window.simInductanceMh(comp)}"></label>
        <label title="The resistance of the coil's own wire. This is all that limits steady current through an inductor, so it does the actual work in the simulation.">Winding resistance (ohms)<input id="sim-comp-dc-resistance" type="number" min="0.01" step="any" value="${window.simInductorWindingOhms(comp)}"></label>
        <p class="sim-electrical-effect"><strong>Electrical effect:</strong> Once current settles, an inductor passes it like a wire with only its winding resistance. As with every part here, only the series path between a power source and its return is analysed, so an inductor wired in parallel with another part doesn't short it. Inductance is for reference; sudden-change behaviour isn't simulated.</p>`;
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
      } else if (comp.type === "switch_spdt") {
        const position = window.simSpdtThrow(comp);
        const [sideA, sideB] = spdtThrowSides(comp);
        extraFieldsHtml = `<p id="sim-spdt-effect" class="sim-electrical-effect"><strong>Electrical effect:</strong> ${describeSpdtElectricalEffect(position)}</p>
        <label title="Which throw the common terminal is connected to. Click the part on the canvas to change it too.">Position<select id="sim-comp-spdt-position" aria-describedby="sim-spdt-effect"><option value="a" ${position === "a" ? "selected" : ""}>A — ${sideA} terminal</option><option value="b" ${position === "b" ? "selected" : ""}>B — ${sideB} terminal</option></select></label>
        <p style="color:var(--text-dim);font-size:0.8rem;">Hover a terminal to see whether it is Common, Throw A or Throw B. It doesn't plug into breadboard holes, so wire its terminals instead.</p>`;
      } else if (comp.type === "outlet") {
        extraFieldsHtml = `<p style="color:var(--text-dim);font-size:0.8rem;">Fixed 120V AC, like a real wall outlet. Never wire it directly to a breadboard part.</p>`;
      }

      box.innerHTML = `
        <p><strong>${escapeXml(def.label)}</strong></p>
        ${partModelHtml(comp.type)}
        <p class="sim-power-status ${isPowered || def.isSource ? "is-powered" : ""}">${statusLine}</p>
        ${electricalHtml}
        ${extraFieldsHtml}
        <label>Label${comp.type === "mcu_teensy" ? " (shown on the part)" : ` (shown as a hover tooltip, including on the public embed${comp.type === "logic_gate" ? "; a gate's truth table is added" : ""})`}<input id="sim-comp-label" type="text" value="${escapeXml(comp.label || "")}"></label>
        <label>Datasheet link (for your own reference -- admin only, not shown on the public embed)<input id="sim-comp-datasheet" type="url" placeholder="https://…" value="${escapeXml(comp.datasheetUrl || "")}"></label>
        <a id="sim-datasheet-link" class="sim-datasheet-link" href="${escapeXml(safeHref(comp.datasheetUrl || ""))}" target="_blank" rel="noopener noreferrer" ${
          comp.datasheetUrl ? "" : "hidden"
        }>Open datasheet ↗</a>
        <label class="sim-lock-row"><input type="checkbox" id="sim-comp-locked"${comp.locked === true ? " checked" : ""}> Lock this part <span class="sim-lock-hint">(it can't be dragged, nudged, aligned, rotated or deleted until you unlock it; its settings and wires stay editable)</span></label>
        ${
          comp.type === "breadboard"
            ? ""
            : `<div class="sim-orient-row" role="group" aria-label="Orientation" aria-describedby="sim-orient-status">
          <button type="button" id="sim-rotate-ccw"${comp.locked === true ? " disabled" : ""} title="Rotate 90° counter-clockwise (Shift+R)" aria-label="Rotate 90 degrees counter-clockwise" aria-keyshortcuts="Shift+R">⟲ Rotate</button>
          <button type="button" id="sim-rotate-cw"${comp.locked === true ? " disabled" : ""} title="Rotate 90° clockwise (R)" aria-label="Rotate 90 degrees clockwise" aria-keyshortcuts="R">⟳ Rotate</button>
          <button type="button" id="sim-flip"${comp.locked === true ? " disabled" : ""} title="Flip left to right (F)" aria-label="Flip left to right" aria-keyshortcuts="F" aria-pressed="${comp.mirror === true ? "true" : "false"}">⇋ Flip</button>
        </div>
        <p id="sim-orient-status" class="sim-orient-status">${describeOrientation(comp)}</p>`
        }
        <button type="button" id="sim-duplicate-selected">Duplicate part</button>
        <button type="button" id="sim-delete-selected" class="danger"${comp.locked === true ? ' disabled title="Unlock this part to delete it"' : ""}>Delete part</button>
      `;
      $("sim-comp-locked").addEventListener("change", (e) => {
        pushHistory();
        if (e.target.checked) comp.locked = true;
        else delete comp.locked;
        renderBuilder();
        renderInspector();
        const again = $("sim-comp-locked");
        if (again) again.focus();
      });

      if ($("sim-rotate-cw")) {
        $("sim-rotate-cw").addEventListener("click", () => orientComponent(comp, { rotateBy: 90 }));
        $("sim-rotate-ccw").addEventListener("click", () => orientComponent(comp, { rotateBy: -90 }));
        $("sim-flip").addEventListener("click", () => orientComponent(comp, { flip: true }));
      }

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
      // Positive values are clamped to the field's minimum; a blank, zero or
      // negative entry is ignored and the stored value is shown again. The
      // refresh waits a tick so it can put focus (and a select-all, so typing
      // replaces the old value) back on whatever the user just tabbed to;
      // if they are mid-click on an inspector button, replacing the inspector
      // would swallow that click, so only the canvas is redrawn then.
      const currentParam = {
        capacitance: () => window.simCapacitanceUf(comp),
        inductance: () => window.simInductanceMh(comp),
        dcResistance: () => window.simInductorWindingOhms(comp),
      };
      [
        ["sim-comp-capacitance", "capacitance", 1e-6],
        ["sim-comp-inductance", "inductance", 1e-6],
        ["sim-comp-dc-resistance", "dcResistance", 0.01],
      ].forEach(([id, field, minimum]) => {
        const input = $(id);
        if (!input) return;
        input.addEventListener("change", () => {
          const value = Number(input.value);
          if (Number.isFinite(value) && value > 0) {
            const next = Math.max(minimum, Math.min(value, 1e9));
            if (next !== currentParam[field]()) {
              pushHistory();
              comp[field] = next;
            }
          }
          setTimeout(() => {
            const active = document.activeElement;
            if (active && active.tagName === "BUTTON" && $("sim-inspector").contains(active)) {
              renderBuilder();
              return;
            }
            const activeId = active && active.id;
            renderInspector();
            renderBuilder();
            const refocus = activeId && $(activeId);
            if (refocus) {
              refocus.focus();
              if (typeof refocus.select === "function" && refocus.tagName === "INPUT") refocus.select();
            }
          }, 0);
        });
      });
      const gateSelect = $("sim-comp-gate");
      if (gateSelect) {
        gateSelect.addEventListener("change", () => {
          pushHistory();
          const sameArity = window.SIM_LOGIC_GATES[gateSelect.value].inputs === window.SIM_LOGIC_GATES[window.simLogicGate(comp)].inputs;
          comp.gate = gateSelect.value;
          // Keep a custom table across same-input-count gates, but never store one
          // that has become the new gate's standard table (it would read as custom
          // again after the next switch).
          if (!sameArity || JSON.stringify(window.simLogicTruth(comp)) === JSON.stringify(window.simStandardLogicTruth(gateSelect.value))) delete comp.truth;
          const removed = pruneWiresToMissingPins(comp);
          renderInspector();
          renderBuilder();
          const refreshedSelect = $("sim-comp-gate");
          if (refreshedSelect) refreshedSelect.focus();
          setSnapHoleWarning(
            0,
            removed ? `Removed ${removed} wire${removed === 1 ? "" : "s"} attached to an input this gate no longer has.` : ""
          );
        });
      }
      box.querySelectorAll(".sim-truth-out").forEach((button) => {
        button.addEventListener("click", () => {
          const row = Number(button.dataset.row);
          const next = window.simLogicTruth(comp);
          next[row] = next[row] === 1 ? 0 : 1;
          pushHistory();
          if (JSON.stringify(next) === JSON.stringify(window.simStandardLogicTruth(window.simLogicGate(comp)))) delete comp.truth;
          else comp.truth = next;
          renderInspector();
          renderBuilder();
          const again = box.querySelector(`.sim-truth-out[data-row="${row}"]`);
          if (again) again.focus();
        });
      });
      const truthReset = $("sim-truth-reset");
      if (truthReset) {
        truthReset.addEventListener("click", () => {
          pushHistory();
          delete comp.truth;
          renderInspector();
          renderBuilder();
          const first = box.querySelector(".sim-truth-out");
          if (first) first.focus();
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
      const spdtPositionSelect = $("sim-comp-spdt-position");
      if (spdtPositionSelect) {
        spdtPositionSelect.addEventListener("change", () => {
          pushHistory();
          comp.position = spdtPositionSelect.value === "b" ? "b" : "a";
          renderInspector();
          renderBuilder();
          const refreshed = $("sim-comp-spdt-position");
          if (refreshed) refreshed.focus();
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
        delete clone.locked; // a copy starts unlocked
        const shift = duplicateShift([comp]);
        clone.x = comp.x + shift.dx;
        clone.y = comp.y + shift.dy;
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
        <p style="color:var(--text-dim);font-size:0.85rem;">Drag any one of them to move the whole group. Shift+click a part to remove it from the selection. Rotate and flip work on one part at a time.</p>
        ${arrangeButtonsHtml(ids.size)}
        <div class="sim-lock-actions" role="group" aria-label="Lock">
          <button type="button" id="sim-lock-selected">Lock all</button>
          <button type="button" id="sim-unlock-selected">Unlock all</button>
        </div>
        <p id="sim-lock-status" class="sim-orient-status" role="status" aria-live="polite"></p>
        <button type="button" id="sim-duplicate-selected">Duplicate all</button>
        <button type="button" id="sim-delete-selected" class="danger">Delete all</button>
      `;
      box.querySelectorAll("[data-arrange]").forEach((btn) => {
        btn.addEventListener("click", () => arrangeSelected(btn.dataset.arrange));
      });
      const setLocks = (locked) => {
        const parts = selected.ids.map((id) => simData.components.find((c) => c.id === id)).filter((c) => c && (c.locked === true) !== locked);
        const status = $("sim-lock-status");
        if (!parts.length) {
          status.textContent = locked ? "Already all locked." : "None of them are locked.";
          return;
        }
        pushHistory();
        parts.forEach((c) => {
          if (locked) c.locked = true;
          else delete c.locked;
        });
        renderBuilder();
        status.textContent = `${locked ? "Locked" : "Unlocked"} ${parts.length} ${parts.length === 1 ? "part" : "parts"}.`;
      };
      $("sim-lock-selected").addEventListener("click", () => setLocks(true));
      $("sim-unlock-selected").addEventListener("click", () => setLocks(false));
      $("sim-duplicate-selected").addEventListener("click", () => {
        pushHistory();
        const idMap = new Map();
        const shift = duplicateShift(selected.ids.map((id) => simData.components.find((c) => c.id === id)).filter(Boolean));
        const clones = selected.ids.map((id) => {
          const src = simData.components.find((c) => c.id === id);
          const clone = JSON.parse(JSON.stringify(src));
          clone.id = newLocalId(clone.type);
          delete clone.locked; // copies start unlocked
          clone.x = src.x + shift.dx;
          clone.y = src.y + shift.dy;
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
                x: clampWireWaypointValue(point.x + shift.dx, "x"),
                y: clampWireWaypointValue(point.y + shift.dy, "y"),
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
        // Locked parts are kept; whatever is left selected stays selected.
        const doomed = new Set(Array.from(ids).filter((id) => !isCompLocked(id)));
        if (!doomed.size) {
          $("sim-lock-status").textContent = "These parts are locked. Unlock them to delete them.";
          return;
        }
        const keptLocked = ids.size - doomed.size;
        pushHistory();
        simData.components = simData.components.filter((c) => !doomed.has(c.id));
        simData.wires = simData.wires.filter((w) => !doomed.has(w.from.compId) && !doomed.has(w.to.compId));
        setMultiSelection(Array.from(ids).filter((id) => !doomed.has(id)));
        renderInspector();
        renderBuilder();
        if (keptLocked) showLockNotice(`${keptLocked} locked ${keptLocked === 1 ? "part was" : "parts were"} kept.`);
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
    renderMinimap();
  }

  // ---------- Minimap ----------
  // A small overview of the whole board with a frame for what the canvas is
  // currently showing. It only appears when the canvas actually scrolls (a
  // zoomed-in desktop board, or any phone), and everything is derived from
  // the live svg/canvas rects so zoom, padding and resizes can't drift out
  // of sync with it. A small toggle tucks it away when it covers a part.
  const minimapDock = $("sim-minimap-dock");
  const minimapBox = $("sim-minimap");
  const minimapToggle = $("sim-minimap-toggle");
  const minimapStatus = $("sim-minimap-status");
  const MINIMAP_COLLAPSED_KEY = "sim-minimap-collapsed";
  let minimapCollapsed = false;
  try { minimapCollapsed = localStorage.getItem(MINIMAP_COLLAPSED_KEY) === "1"; } catch (_) { /* storage blocked */ }
  let minimapDrag = null;
  let minimapFrameQueued = false;
  let minimapRenderQueued = false;

  function canvasIsScrollable() {
    const canvas = $("sim-builder-canvas");
    return !!canvas && (canvas.scrollWidth > canvas.clientWidth + 1 || canvas.scrollHeight > canvas.clientHeight + 1);
  }

  // How much a transformed ancestor (the modal's scale-in) shrinks layout
  // pixels on screen. Rect measurements are scaled by it but clientWidth
  // and friends are not, so every mix of the two goes through here.
  function canvasScreenScale(canvas) {
    return canvas.offsetWidth ? canvas.getBoundingClientRect().width / canvas.offsetWidth : 1;
  }

  // The canvas's visible area as fractions of the svg's width/height. The
  // canvas has padding around the svg, so at a scroll extreme the view
  // reaches past the svg: pass clamp=false for the true view (its centre
  // is what a drag needs), true for the drawn frame.
  function minimapViewFractions(clamp = true) {
    const canvas = $("sim-builder-canvas");
    const svg = $("sim-builder-svg");
    if (!canvas || !svg) return null;
    const svgRect = svg.getBoundingClientRect();
    if (!svgRect.width || !svgRect.height) return null;
    const sc = canvasScreenScale(canvas);
    const canvasRect = canvas.getBoundingClientRect();
    const left = canvasRect.left + canvas.clientLeft * sc;
    const top = canvasRect.top + canvas.clientTop * sc;
    const fit = (n) => (clamp ? Math.max(0, Math.min(1, n)) : n);
    return {
      x0: fit((left - svgRect.left) / svgRect.width),
      y0: fit((top - svgRect.top) / svgRect.height),
      x1: fit((left + canvas.clientWidth * sc - svgRect.left) / svgRect.width),
      y1: fit((top + canvas.clientHeight * sc - svgRect.top) / svgRect.height)
    };
  }

  function updateMinimapFrame() {
    const frame = minimapBox.querySelector(".sim-minimap-frame");
    const svg = $("sim-builder-svg");
    const view = minimapViewFractions();
    if (!frame || !svg || !view) return;
    const vb = svg.viewBox.baseVal;
    frame.setAttribute("x", view.x0 * vb.width);
    frame.setAttribute("y", view.y0 * vb.height);
    frame.setAttribute("width", Math.max(0, (view.x1 - view.x0) * vb.width));
    frame.setAttribute("height", Math.max(0, (view.y1 - view.y0) * vb.height));
  }

  function syncMinimapToggle() {
    minimapToggle.setAttribute("aria-expanded", String(!minimapCollapsed));
    minimapToggle.textContent = minimapCollapsed ? "Map" : "×";
    minimapToggle.setAttribute("aria-label", minimapCollapsed ? "Show minimap" : "Hide minimap");
    minimapToggle.title = minimapCollapsed ? "Show minimap" : "Hide minimap";
    minimapDock.classList.toggle("is-collapsed", minimapCollapsed);
  }

  function hideMinimap() {
    minimapDrag = null;
    const active = document.activeElement;
    // Don't strand keyboard focus on something that is about to vanish.
    if (active === minimapBox || active === minimapToggle) $("sim-zoom-reset").focus({ preventScroll: true });
    minimapDock.hidden = true;
    minimapBox.hidden = true;
    minimapBox.textContent = "";
  }

  function renderMinimap() {
    const svg = $("sim-builder-svg");
    if (!svg || !canvasIsScrollable()) {
      hideMinimap();
      return;
    }
    syncMinimapToggle();
    minimapDock.hidden = false;
    if (minimapCollapsed) {
      minimapDrag = null;
      minimapBox.hidden = true;
      minimapBox.textContent = "";
      return;
    }
    const vb = svg.viewBox.baseVal;
    const picked = new Set(selectedIds());
    const byId = new Map(simData.components.map((c) => [c.id, c]));
    const comps = simData.components
      .map((comp) => {
        const def = window.getSimComponentDefinition(comp);
        if (!def || !Number.isFinite(comp.x) || !Number.isFinite(comp.y)) return "";
        return `<rect class="sim-minimap-comp${picked.has(comp.id) ? " is-selected" : ""}" x="${comp.x}" y="${comp.y}" width="${def.w}" height="${def.h}"/>`;
      })
      .join("");
    const wires = simData.wires
      .map((wire) => {
        const a = pinPosition(byId.get(wire.from.compId), wire.from.pin);
        const b = pinPosition(byId.get(wire.to.compId), wire.to.pin);
        if (!a || !b) return "";
        const points = getWireRoutePoints(wire, a, b).map((pt) => `${pt.x},${pt.y}`).join(" ");
        return `<polyline class="sim-minimap-wire" points="${points}"/>`;
      })
      .join("");
    minimapBox.innerHTML = `<svg viewBox="0 0 ${vb.width} ${vb.height}" aria-hidden="true">${wires}${comps}<rect class="sim-minimap-frame"/></svg>`;
    minimapBox.hidden = false;
    updateMinimapFrame();
  }

  // Coalesces rebuilds asked for in quick succession (a part being dragged).
  function queueMinimapRender() {
    if (minimapRenderQueued || minimapBox.hidden) return;
    minimapRenderQueued = true;
    requestAnimationFrame(() => {
      minimapRenderQueued = false;
      renderMinimap();
    });
  }

  // Scrolls the canvas so the given point (fractions of the board) sits in
  // the middle of the view; the browser clamps it at the edges.
  function centerCanvasOn(fx, fy) {
    const canvas = $("sim-builder-canvas");
    const svg = $("sim-builder-svg");
    if (!canvas || !svg) return;
    const sc = canvasScreenScale(canvas) || 1;
    const svgRect = svg.getBoundingClientRect();
    const canvasRect = canvas.getBoundingClientRect();
    const contentLeft = (svgRect.left - canvasRect.left) / sc - canvas.clientLeft + canvas.scrollLeft;
    const contentTop = (svgRect.top - canvasRect.top) / sc - canvas.clientTop + canvas.scrollTop;
    canvas.scrollLeft = contentLeft + fx * (svgRect.width / sc) - canvas.clientWidth / 2;
    canvas.scrollTop = contentTop + fy * (svgRect.height / sc) - canvas.clientHeight / 2;
  }

  function minimapPointerFractions(ev) {
    const inner = minimapBox.querySelector("svg");
    if (!inner) return null;
    const rect = inner.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    return {
      x: Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (ev.clientY - rect.top) / rect.height))
    };
  }

  minimapBox.addEventListener("pointerdown", (ev) => {
    if (ev.button !== undefined && ev.button !== 0) return;
    const at = minimapPointerFractions(ev);
    if (!at) return;
    ev.preventDefault();
    minimapBox.focus({ preventScroll: true });
    // Grabbing inside the frame keeps the spot you grabbed; clicking
    // outside it jumps the view so its centre lands where you clicked.
    // The offset is taken from the unclamped view so grabbing at a scroll
    // extreme (where the padding makes the view overhang) doesn't nudge it.
    const drawn = minimapViewFractions();
    const view = minimapViewFractions(false);
    const inside = drawn && view && at.x >= drawn.x0 && at.x <= drawn.x1 && at.y >= drawn.y0 && at.y <= drawn.y1;
    minimapDrag = {
      id: ev.pointerId,
      dx: inside ? at.x - (view.x0 + view.x1) / 2 : 0,
      dy: inside ? at.y - (view.y0 + view.y1) / 2 : 0
    };
    try { minimapBox.setPointerCapture(ev.pointerId); } catch (_) { /* pointer already gone */ }
    centerCanvasOn(at.x - minimapDrag.dx, at.y - minimapDrag.dy);
  });
  minimapBox.addEventListener("pointermove", (ev) => {
    if (!minimapDrag || ev.pointerId !== minimapDrag.id) return;
    const at = minimapPointerFractions(ev);
    if (at) centerCanvasOn(at.x - minimapDrag.dx, at.y - minimapDrag.dy);
  });
  const endMinimapDrag = (ev) => {
    if (minimapDrag && ev.pointerId === minimapDrag.id) minimapDrag = null;
  };
  minimapBox.addEventListener("pointerup", endMinimapDrag);
  minimapBox.addEventListener("pointercancel", endMinimapDrag);
  minimapBox.addEventListener("lostpointercapture", endMinimapDrag);

  // Arrow keys scroll the view from the minimap; stopPropagation keeps the
  // builder's own arrow-key nudge of the selected part from also firing.
  // The position is announced after each key press (not on every scroll,
  // which would chatter during a drag).
  minimapBox.addEventListener("keydown", (e) => {
    const canvas = $("sim-builder-canvas");
    const dirs = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
    if (!canvas || !dirs[e.key] || e.ctrlKey || e.metaKey || e.altKey) return;
    e.preventDefault();
    e.stopPropagation();
    canvas.scrollLeft += dirs[e.key][0] * canvas.clientWidth * 0.2;
    canvas.scrollTop += dirs[e.key][1] * canvas.clientHeight * 0.2;
    const view = minimapViewFractions();
    if (view) {
      const pct = (n) => Math.round(n * 100);
      minimapStatus.textContent = `Viewing ${pct(view.x0)} to ${pct(view.x1)} percent across, ${pct(view.y0)} to ${pct(view.y1)} percent down`;
    }
  });
  minimapBox.addEventListener("blur", () => { minimapStatus.textContent = ""; });

  minimapToggle.addEventListener("click", () => {
    minimapCollapsed = !minimapCollapsed;
    try { localStorage.setItem(MINIMAP_COLLAPSED_KEY, minimapCollapsed ? "1" : "0"); } catch (_) { /* storage blocked */ }
    renderMinimap();
  });

  $("sim-builder-canvas").addEventListener("scroll", () => {
    if (minimapFrameQueued) return;
    minimapFrameQueued = true;
    requestAnimationFrame(() => {
      minimapFrameQueued = false;
      updateMinimapFrame();
    });
  }, { passive: true });
  // Resizing (window, opening the modal, rotating a phone) can switch the
  // board between fitting and scrolling, so rebuild rather than just move
  // the frame.
  if (typeof ResizeObserver === "function") new ResizeObserver(() => renderMinimap()).observe($("sim-builder-canvas"));
  else window.addEventListener("resize", renderMinimap);

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
  // Same "highest computed z-index, later DOM order wins" rule app.js uses for
  // its own top-modal checks, so a single-letter shortcut never acts on the
  // builder from behind another dialog (shortcuts help, media picker).
  function builderIsTopModal() {
    let top = null;
    let highest = Number.NEGATIVE_INFINITY;
    document.querySelectorAll(".modal:not([hidden]), .writing-focus-overlay:not([hidden])").forEach((modal) => {
      const parsed = Number(getComputedStyle(modal).zIndex);
      const zIndex = Number.isFinite(parsed) ? parsed : 0;
      if (!top || zIndex >= highest) {
        top = modal;
        highest = zIndex;
      }
    });
    return top === $("simulation-builder-modal");
  }

  document.addEventListener("keydown", (e) => {
    if ($("simulation-builder-modal").hidden) return;
    const tag = document.activeElement && document.activeElement.tagName;
    const isTyping =
      tag === "INPUT" ||
      tag === "TEXTAREA" ||
      tag === "SELECT" ||
      // Arrow keys and Backspace on a focused truth-table button (or its Reset) must not nudge or delete the part.
      Boolean(document.activeElement && (document.activeElement.classList.contains("sim-truth-out") || document.activeElement.id === "sim-truth-reset")) ||
      // Arrow keys and Delete on a focused align/distribute button must not nudge or delete the parts either.
      Boolean(document.activeElement && document.activeElement.classList.contains("sim-arrange-btn")) ||
      Boolean(document.activeElement && document.activeElement.isContentEditable);
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
    // R rotates the selected part 90 degrees clockwise (Shift+R the other
    // way), F flips it left to right -- single parts only, never a
    // breadboard (its layout is fixed).
    if (!mod && !e.altKey && selected && selected.kind === "component" && (e.key.toLowerCase() === "r" || e.key.toLowerCase() === "f")) {
      const target = simData.components.find((c) => c.id === selected.id);
      if (target && target.type !== "breadboard" && builderIsTopModal()) {
        e.preventDefault();
        if (e.repeat) return;
        if (e.key.toLowerCase() === "f") orientComponent(target, { flip: true });
        else orientComponent(target, { rotateBy: e.shiftKey ? -90 : 90 });
        return;
      }
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
      const allSelected = selectedIds()
        .map((id) => simData.components.find((c) => c.id === id))
        .filter(Boolean);
      if (!allSelected.length) return;
      e.preventDefault();
      const comps = allSelected.filter((c) => c.locked !== true);
      if (!comps.length) {
        showLockNotice("That part is locked. Unlock it in the inspector to move it.");
        return;
      }
      if (comps.length < allSelected.length) {
        const stayed = allSelected.length - comps.length;
        showLockNotice(`${stayed} locked ${stayed === 1 ? "part stayed" : "parts stayed"} put.`);
      }
      const step = e.shiftKey && gridSnapSize > 0 ? gridSnapSize : 1;
      const [dx, dy] = ARROW_DELTAS[e.key];
      // Held at the board's edge rather than letting the part slip off it.
      const move = clampMoveToBoard(comps, dx * step, dy * step);
      if (!move.dx && !move.dy) return;
      pushHistory();
      comps.forEach((comp) => {
        comp.x += move.dx;
        comp.y += move.dy;
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
      svgClone.querySelectorAll(".sim-lock-badge").forEach((node) => node.remove()); // editor-only marker
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
      refreshSimSaveState();
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

  function splitImportedSimulation(parsed, existingCheckpoints, existingViews = []) {
    const hasImportedCheckpoints = Object.prototype.hasOwnProperty.call(parsed, "checkpoints");
    const checkpoints = hasImportedCheckpoints
      ? parsed.checkpoints.map((checkpoint) => ({
          ...checkpoint,
          data: { components: checkpoint.data.components, wires: checkpoint.data.wires },
        }))
      : existingCheckpoints;
    const data = { ...parsed };
    delete data.checkpoints;
    delete data.views;
    delete data.og_image;
    return {
      data,
      checkpoints,
      views: Object.prototype.hasOwnProperty.call(parsed, "views") ? parsed.views : existingViews,
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
      const imported = splitImportedSimulation(parsed, simCheckpoints, simViews);
      if (imported.hasPoster) $("sim-poster-url").value = imported.posterUrl;
      setSnapHoleWarning(0);
      pushHistory();
      simData = imported.data;
      canvasSearchCurrent = null; // part ids can repeat across circuits
      simCheckpoints = imported.checkpoints;
      simViews = imported.views;
      renderViewSelect();
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
    const payloadData = { ...simData, checkpoints: simCheckpoints, views: simViews, og_image: $("sim-poster-url").value.trim() || null };
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
      simSavedText = "Saved " + new Date().toLocaleTimeString();
      setSimSaveStatus(simSavedText);
      if (window.refreshSimulationOptions) window.refreshSimulationOptions();
    } catch (err) {
      setSimSaveStatus("Save failed: " + err.message);
      alert(err.message);
    }
  });

  $("simulation-name").addEventListener("input", refreshSimSaveState);
  $("sim-poster-url").addEventListener("input", refreshSimSaveState);
  $("sim-reset").addEventListener("click", resetSimToInitial);
})();
