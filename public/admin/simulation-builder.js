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
  const PLACE_CANVAS_WIDTH = 860;

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

  $("sim-undo").addEventListener("click", undoHistory);
  $("sim-redo").addEventListener("click", redoHistory);

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
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><button type="button" class="edit-simulation" data-id="${
              s.id
            }">Edit</button><button type="button" class="delete-simulation" data-id="${s.id}">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No simulations yet.</p>";

    $("simulations-list")
      .querySelectorAll(".edit-simulation")
      .forEach((btn) => btn.addEventListener("click", () => openBuilder(Number(btn.dataset.id))));
    $("simulations-list")
      .querySelectorAll(".delete-simulation")
      .forEach((btn) =>
        btn.addEventListener("click", async () => {
          if (!confirm('Delete this simulation? Any block using it will show "not found".')) return;
          await window.adminApi(`/simulations/${btn.dataset.id}`, { method: "DELETE" });
          await loadSimulationsList();
        })
      );
  }

  $("simulations-btn").addEventListener("click", async () => {
    $("simulations-modal").hidden = false;
    await loadSimulationsList();
  });
  $("close-simulations").addEventListener("click", () => ($("simulations-modal").hidden = true));
  $("new-simulation-btn").addEventListener("click", () => openBuilder(null));

  // ---------- Open / close builder ----------
  async function openBuilder(id) {
    currentSimId = id;
    selected = null;
    wireStart = null;
    previewOn = false;
    zoomLevel = 1;
    placeX = 20;
    placeY = 20;
    undoStack = [];
    redoStack = [];
    if (id) {
      const sim = await window.adminApi(`/simulations/${id}`);
      $("simulation-name").value = sim.name;
      simData = sim.data && Array.isArray(sim.data.components) ? sim.data : { components: [], wires: [] };
    } else {
      $("simulation-name").value = "New simulation";
      simData = { components: [], wires: [] };
    }
    $("simulations-modal").hidden = true;
    $("simulation-builder-modal").hidden = false;
    updateHistoryButtons();
    renderInspector();
    renderBuilder();
  }

  $("close-simulation-builder").addEventListener("click", () => {
    $("simulation-builder-modal").hidden = true;
    $("simulations-modal").hidden = false;
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
    const sel = selected && selected.kind === "component" && selected.id === comp.id;
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
    return `<path class="sim-wire sim-wire-${wire.kind || "wire"}${
      sel ? " sim-selected" : ""
    }" data-id="${wire.id}" data-animated="${poweredWires.has(wire.id) ? "true" : "false"}" d="M${p1.x},${p1.y} L${p2.x},${p2.y}"/>`;
  }

  function renderPinDots(comp) {
    const def = REG[comp.type];
    return def.pins
      .map((p) => {
        const active = wireStart && wireStart.compId === comp.id && wireStart.pin === p.id;
        return `<circle class="sim-pin${active ? " sim-pin-active" : ""}" data-comp="${comp.id}" data-pin="${p.id}" cx="${
          comp.x + p.x
        }" cy="${comp.y + p.y}" r="5"/>`;
      })
      .join("");
  }

  function renderBuilder() {
    const { poweredComps, poweredWires } = window.computeSimPoweredSet(simData);
    const analysis = window.computeSimElectricalAnalysis(simData);
    const wiresSvg = simData.wires.map((w) => renderWireSvg(w, poweredWires)).join("");
    const compsSvg = simData.components.map((c) => renderComponentSvg(c, poweredComps, analysis)).join("");
    const pinsSvg = simData.components.map(renderPinDots).join("");
    $("sim-builder-canvas").innerHTML = `<svg id="sim-builder-svg" viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg" class="sim-svg${
      previewOn ? " is-on" : ""
    }">${window.SIM_DEFS_SVG}${wiresSvg}${compsSvg}${pinsSvg}</svg>`;
    attachBuilderEvents();
    applyZoom();
  }

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
    svg.addEventListener("click", (e) => {
      if (e.target === svg) {
        selected = null;
        wireStart = null;
        renderInspector();
        renderBuilder();
      }
    });
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

  // Parts that physically plug into a breadboard rather than dangling on
  // a cable to it. Snapping is anchored on the part's first pin — the
  // other leg just moves rigidly with it, close enough visually even
  // though a resistor's lead spacing doesn't exactly match hole spacing.
  const SNAP_TO_BREADBOARD_TYPES = new Set(["led", "resistor"]);
  const SNAP_THRESHOLD = 18;
  // Everything else just snaps to a light alignment grid while dragging.
  const GRID_SNAP = 5;

  function findNearestHole(x, y, excludeCompId) {
    let best = null;
    simData.components.forEach((c) => {
      if (c.type !== "breadboard" || c.id === excludeCompId) return;
      REG.breadboard.pins.forEach((pin) => {
        const hx = c.x + pin.x;
        const hy = c.y + pin.y;
        const dist = Math.hypot(hx - x, hy - y);
        if (dist <= SNAP_THRESHOLD && (!best || dist < best.dist)) {
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
    selected = { kind: "component", id: compId };
    renderInspector();
    document.querySelectorAll(".sim-select-box").forEach((n) => n.remove());
    g.classList.add("sim-selected");

    const start = svgPoint(e);
    const startX = comp.x;
    const startY = comp.y;
    g.setPointerCapture(e.pointerId);
    let historySaved = false;

    const canSnap = SNAP_TO_BREADBOARD_TYPES.has(comp.type);
    const anchorPin = canSnap ? REG[comp.type].pins[0] : null;
    let snapTarget = null;

    function onMove(ev) {
      if (!historySaved) {
        pushHistory();
        historySaved = true;
      }
      const p = svgPoint(ev);
      comp.x = Math.round(startX + (p.x - start.x));
      comp.y = Math.round(startY + (p.y - start.y));
      if (!canSnap) {
        // Light grid snap for free-floating parts, so components line up
        // without needing to eyeball pixel positions.
        comp.x = Math.round(comp.x / GRID_SNAP) * GRID_SNAP;
        comp.y = Math.round(comp.y / GRID_SNAP) * GRID_SNAP;
      }
      if (canSnap) {
        const anchorAbs = { x: comp.x + anchorPin.x, y: comp.y + anchorPin.y };
        const hole = findNearestHole(anchorAbs.x, anchorAbs.y, compId);
        if (hole) {
          comp.x += hole.x - anchorAbs.x;
          comp.y += hole.y - anchorAbs.y;
          snapTarget = { breadboardId: hole.breadboardId, holeId: hole.holeId };
          g.classList.add("sim-snapped");
        } else {
          snapTarget = null;
          g.classList.remove("sim-snapped");
        }
      }
      g.setAttribute("transform", `translate(${comp.x},${comp.y})`);
      updateWiresForComponent(compId);
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
        simData.wires = simData.wires.filter(
          (w) => !(w.auto && ((w.from.compId === compId && w.from.pin === anchorPin.id) || (w.to.compId === compId && w.to.pin === anchorPin.id)))
        );
        if (snapTarget) {
          simData.wires.push({
            id: newLocalId("wire"),
            from: { compId, pin: anchorPin.id },
            to: { compId: snapTarget.breadboardId, pin: snapTarget.holeId },
            kind: "wire",
            auto: true,
          });
        }
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

  // ---------- Inspector ----------
  function renderInspector() {
    const box = $("sim-inspector");
    if (!selected) {
      box.innerHTML =
        "<p style='color:var(--text-dim);font-size:0.85rem;'>Click a part or a wire to edit it. Click a pin, then another pin, to wire them.</p>" +
        "<p style='color:var(--text-dim);font-size:0.85rem;'>The breadboard now has real topology: the two rail lines (+/−) at the top are each one long connection, but the terminal columns below the gutter are each independent — plugging into the same column connects things, different columns don't, and the gutter splits top from bottom. Wire outlet → power supply → rails → a column → resistor bridging to another column → LED → back to the other rail.</p>" +
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
  // The canvas defaults to fitting the container (CSS width:100%); zooming
  // sets an explicit pixel size instead, and the wrapping .sim-builder-canvas
  // (overflow: auto) turns into a native scroll area for panning around.
  const ZOOM_STEPS = [0.5, 0.75, 1, 1.25, 1.5, 2, 3];
  let zoomLevel = 1;

  function applyZoom() {
    const svg = $("sim-builder-svg");
    if (svg) {
      if (zoomLevel === 1) {
        svg.style.width = "";
        svg.style.height = "";
      } else {
        svg.style.width = `${900 * zoomLevel}px`;
        svg.style.height = `${500 * zoomLevel}px`;
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
    zoomLevel = 1;
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
    try {
      if (currentSimId) {
        await window.adminApi(`/simulations/${currentSimId}`, { method: "PATCH", body: JSON.stringify({ name, data: simData }) });
      } else {
        const res = await window.adminApi("/simulations", { method: "POST", body: JSON.stringify({ name, data: simData }) });
        currentSimId = res.id;
      }
      alert("Saved.");
      if (window.refreshSimulationOptions) window.refreshSimulationOptions();
    } catch (err) {
      alert(err.message);
    }
  });
})();
