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

  function renderComponentSvg(comp) {
    const def = REG[comp.type];
    if (!def) return "";
    const sel = selected && selected.kind === "component" && selected.id === comp.id;
    return `<g class="sim-comp sim-comp-${comp.type}${
      sel ? " sim-selected" : ""
    }" data-id="${comp.id}" data-powered="${comp.powered ? "true" : "false"}" transform="translate(${comp.x},${comp.y})">${def.render(
      comp
    )}${sel ? `<rect class="sim-select-box" x="-4" y="-4" width="${def.w + 8}" height="${def.h + 8}" />` : ""}</g>`;
  }

  function renderWireSvg(wire) {
    const fromComp = simData.components.find((c) => c.id === wire.from.compId);
    const toComp = simData.components.find((c) => c.id === wire.to.compId);
    if (!fromComp || !toComp) return "";
    const p1 = pinPosition(fromComp, wire.from.pin);
    const p2 = pinPosition(toComp, wire.to.pin);
    if (!p1 || !p2) return "";
    const sel = selected && selected.kind === "wire" && selected.id === wire.id;
    return `<path class="sim-wire sim-wire-${wire.kind || "wire"}${
      sel ? " sim-selected" : ""
    }" data-id="${wire.id}" data-animated="${wire.animated ? "true" : "false"}" d="M${p1.x},${p1.y} L${p2.x},${p2.y}"/>`;
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
    const wiresSvg = simData.wires.map(renderWireSvg).join("");
    const compsSvg = simData.components.map(renderComponentSvg).join("");
    const pinsSvg = simData.components.map(renderPinDots).join("");
    $("sim-builder-canvas").innerHTML = `<svg id="sim-builder-svg" viewBox="0 0 900 500" xmlns="http://www.w3.org/2000/svg" class="sim-svg${
      previewOn ? " is-on" : ""
    }">${wiresSvg}${compsSvg}${pinsSvg}</svg>`;
    attachBuilderEvents();
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
    const svgEl = svg.querySelector(`[data-id="${compId}"]`);
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

    function onMove(ev) {
      const p = svgPoint(ev);
      comp.x = Math.round(startX + (p.x - start.x));
      comp.y = Math.round(startY + (p.y - start.y));
      g.setAttribute("transform", `translate(${comp.x},${comp.y})`);
      updateWiresForComponent(compId);
    }
    function onUp() {
      g.removeEventListener("pointermove", onMove);
      g.removeEventListener("pointerup", onUp);
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
    simData.wires.push({
      id: newLocalId("wire"),
      from: { compId: wireStart.compId, pin: wireStart.pin },
      to: { compId, pin },
      kind: "wire",
      animated: false,
    });
    wireStart = null;
    renderBuilder();
  }

  // ---------- Palette ----------
  document.querySelectorAll(".sim-palette-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const type = btn.dataset.simType;
      const def = REG[type];
      // Stagger by total part count (not per-type) so the first LED doesn't
      // land on top of the first resistor — each new part is just offset
      // from whatever was placed before it, of any type.
      const n = simData.components.length;
      simData.components.push({
        id: newLocalId(type),
        type,
        x: 20 + (n % 10) * 30,
        y: 20 + Math.floor(n / 10) * 60,
        powered: false,
        label: def.label,
      });
      renderBuilder();
    });
  });

  // ---------- Inspector ----------
  function renderInspector() {
    const box = $("sim-inspector");
    if (!selected) {
      box.innerHTML = "<p style='color:var(--text-dim);font-size:0.85rem;'>Click a part or a wire to edit it. Click a pin, then another pin, to wire them.</p>";
      return;
    }
    if (selected.kind === "component") {
      const comp = simData.components.find((c) => c.id === selected.id);
      if (!comp) return;
      const def = REG[comp.type];
      box.innerHTML = `
        <p><strong>${escapeXml(def.label)}</strong></p>
        ${comp.type === "mcu_teensy" ? `<label>Label<input id="sim-comp-label" type="text" value="${escapeXml(comp.label || "")}"></label>` : ""}
        <label><input type="checkbox" id="sim-comp-powered" ${comp.powered ? "checked" : ""}> Powered (glows/changes when the sim is switched on)</label>
        <button type="button" id="sim-delete-selected" class="danger">Delete part</button>
      `;
      const labelInput = $("sim-comp-label");
      if (labelInput) {
        labelInput.addEventListener("input", () => {
          comp.label = labelInput.value;
          renderBuilder();
        });
      }
      $("sim-comp-powered").addEventListener("change", (e) => {
        comp.powered = e.target.checked;
        renderBuilder();
      });
      $("sim-delete-selected").addEventListener("click", () => {
        simData.components = simData.components.filter((c) => c.id !== comp.id);
        simData.wires = simData.wires.filter((w) => w.from.compId !== comp.id && w.to.compId !== comp.id);
        selected = null;
        renderInspector();
        renderBuilder();
      });
    } else if (selected.kind === "wire") {
      const wire = simData.wires.find((w) => w.id === selected.id);
      if (!wire) return;
      box.innerHTML = `
        <p><strong>Wire</strong></p>
        <label>Style
          <select id="sim-wire-kind">
            <option value="wire" ${wire.kind === "wire" ? "selected" : ""}>Wire</option>
            <option value="hdmi" ${wire.kind === "hdmi" ? "selected" : ""}>Cable (HDMI-style)</option>
          </select>
        </label>
        <label><input type="checkbox" id="sim-wire-animated" ${wire.animated ? "checked" : ""}> Animate signal flow when powered</label>
        <button type="button" id="sim-delete-selected" class="danger">Delete wire</button>
      `;
      $("sim-wire-kind").addEventListener("change", (e) => {
        wire.kind = e.target.value;
        renderBuilder();
      });
      $("sim-wire-animated").addEventListener("change", (e) => {
        wire.animated = e.target.checked;
        renderBuilder();
      });
      $("sim-delete-selected").addEventListener("click", () => {
        simData.wires = simData.wires.filter((w) => w.id !== wire.id);
        selected = null;
        renderInspector();
        renderBuilder();
      });
    }
  }

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
