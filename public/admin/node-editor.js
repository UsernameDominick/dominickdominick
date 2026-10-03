// The canvas of the Nodes editor: draggable nodes with pins, wires between them, an "add a node" menu, undo, zoom and pan.
// It edits a graph (see node-compiler.js) and says when it changed; turning the graph into code is the compiler's job.
// Everything is positioned from numbers (layoutNode), so a pin's place is known without measuring the page.
// Keyboard: Tab to a node, Enter on a pin starts a connection and Enter on another pin finishes it, Delete removes, arrows move.
(function () {
  const NODE_W = 220;
  const HEADER_H = 30;
  const ROW_H = 26;
  const PROP_H = 32;
  const AREA_H = 64;
  const MULTI_H = 62;
  const PAD = 8;
  const GRID = 20;
  const MIN_ZOOM = 0.4;
  const MAX_ZOOM = 1.6;

  // Where everything inside a node goes, from its definition. Pins are numbers relative to the node's top-left corner.
  function layoutNode(def) {
    const items = [];
    const pins = {};
    if (!def) return { w: NODE_W, h: HEADER_H + PAD + ROW_H, items, pins };
    let y = HEADER_H;
    const pin = (key, dir, id, type, label, py) => {
      pins[key] = { key, dir, id, type, label, x: dir === "in" ? 0 : NODE_W, y: py };
    };
    const flowOuts = def.flowOuts || [];
    const flowRows = Math.max(def.flowIn ? 1 : 0, flowOuts.length);
    for (let r = 0; r < flowRows; r++) {
      if (r === 0 && def.flowIn) pin("in:in", "in", "in", "flow", "Run", y + ROW_H / 2);
      const fo = flowOuts[r];
      if (fo) {
        pin(`out:${fo.id}`, "out", fo.id, "flow", fo.label || "Next", y + ROW_H / 2);
        if (fo.label) items.push({ kind: "label", text: fo.label, align: "right", y, h: ROW_H });
      }
      y += ROW_H;
    }
    for (const p of def.props || []) {
      const h = p.control === "textarea" ? AREA_H : PROP_H;
      items.push({ kind: "prop", prop: p, y, h });
      y += h;
    }
    const inputs = def.inputs || [];
    const outputs = def.outputs || [];
    for (let i = 0; i < Math.max(inputs.length, outputs.length); i++) {
      const inp = inputs[i];
      const out = outputs[i];
      const h = inp && inp.multiline ? MULTI_H : ROW_H;
      if (inp) {
        pin(`in:${inp.id}`, "in", inp.id, inp.type, inp.label, y + ROW_H / 2);
        items.push({ kind: "input", input: inp, y, h });
      }
      if (out) {
        pin(`out:${out.id}`, "out", out.id, out.type, out.label, y + ROW_H / 2);
        items.push({ kind: "label", text: out.label, align: "right", y, h: ROW_H });
      }
      y += h;
    }
    return { w: NODE_W, h: y + PAD, items, pins };
  }

  // The curve between two pins: leaves each pin sideways, like the wires in a Blueprint graph.
  function wirePath(x1, y1, x2, y2) {
    const dx = Math.max(50, Math.abs(x2 - x1) * 0.5);
    return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`;
  }

  const api = { layoutNode, wirePath, NODE_W, HEADER_H, ROW_H };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.NodeEditor = api;

  const NS = "http://www.w3.org/2000/svg";
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  let uid = 0;

  function create(container, options = {}) {
    const D = window.NodeDefs;
    const C = window.NodeCompiler;
    const id = ++uid;
    let graph = C.newGraph();
    let view = { x: 40, y: 40, zoom: 1 };
    const selected = new Set();
    let selectedWire = -1;
    let pending = null; // a connection being made: { node, pin, dir, type }
    let problems = [];
    let flashId = null;
    let marks = new Map();
    const undoStack = [];
    const redoStack = [];
    let lastUndoKey = "";
    let lastUndoAt = 0;
    let menuState = null;
    const layouts = new Map();

    const root = document.createElement("div");
    root.className = "ne-root";
    root.innerHTML = `<div class="ne-toolbar" role="toolbar" aria-label="Node editor tools">
        <button type="button" data-act="add" title="Add a node (A)">Add node</button>
        <button type="button" data-act="undo" title="Undo (Ctrl+Z)">Undo</button>
        <button type="button" data-act="redo" title="Redo (Ctrl+Shift+Z)">Redo</button>
        <button type="button" data-act="zoom-out" aria-label="Zoom out" title="Zoom out">−</button>
        <button type="button" data-act="zoom-in" aria-label="Zoom in" title="Zoom in">+</button>
        <button type="button" data-act="fit" title="Show everything">Fit</button>
        <span class="ne-tip">Drag from a pin to connect. Scroll to zoom, drag the background to move around.</span>
      </div>
      <div class="ne-viewport" role="group" aria-label="${esc(options.label || "Node graph")}" tabindex="0" aria-describedby="ne-help-${id}">
        <div class="ne-world"><svg class="ne-wires" aria-hidden="true"></svg><div class="ne-nodes"></div></div>
        <div class="ne-box" hidden></div>
        <div class="ne-menu" role="dialog" aria-label="Add a node" hidden>
          <label class="ne-sr" for="ne-search-${id}">Search nodes</label>
          <input id="ne-search-${id}" class="ne-search" type="search" placeholder="Search nodes" autocomplete="off">
          <ul class="ne-menu-list" role="listbox" aria-label="Nodes"></ul>
        </div>
      </div>
      <p class="ne-sr" id="ne-help-${id}">Nodes are connected with wires. Tab to a pin and press Enter to start a connection, then Tab to another pin and press Enter to finish it. Press A to add a node, Delete to remove the selected one, arrow keys to move it.</p>
      <p class="ne-sr" role="status" aria-live="polite" id="ne-status-${id}"></p>
      <ul class="ne-problems" aria-label="Problems with this graph"></ul>`;
    container.appendChild(root);
    const viewport = root.querySelector(".ne-viewport");
    const world = root.querySelector(".ne-world");
    const wiresSvg = root.querySelector(".ne-wires");
    const nodesEl = root.querySelector(".ne-nodes");
    const boxEl = root.querySelector(".ne-box");
    const menu = root.querySelector(".ne-menu");
    const menuList = root.querySelector(".ne-menu-list");
    const search = root.querySelector(".ne-search");
    const problemsEl = root.querySelector(".ne-problems");
    const statusEl = root.querySelector(`#ne-status-${id}`);

    const say = (t) => {
      statusEl.textContent = "";
      setTimeout(() => (statusEl.textContent = t), 20);
    };
    const defOf = (n) => D.NODES[n.type];
    const nodeById = (nid) => graph.nodes.find((n) => n.id === nid);
    const layoutOf = (n) => {
      const key = n.type;
      if (!layouts.has(key)) layouts.set(key, layoutNode(defOf(n)));
      return layouts.get(key);
    };
    const titleOf = (n) => (defOf(n) ? defOf(n).title : n.type);
    // viewOnly: only the pan or zoom moved, nothing to rebuild or save.
    const changed = (viewOnly = false) => options.onChange && options.onChange(getGraph(), { viewOnly });

    // ---------- undo ----------
    const snapshot = () => JSON.stringify({ nodes: graph.nodes, wires: graph.wires });
    function pushUndo(key = "") {
      const now = Date.now();
      if (key && key === lastUndoKey && now - lastUndoAt < 1500) {
        lastUndoAt = now;
        return;
      }
      lastUndoKey = key;
      lastUndoAt = now;
      undoStack.push(snapshot());
      if (undoStack.length > 100) undoStack.shift();
      redoStack.length = 0;
      syncToolbar();
    }
    function restore(text) {
      const g = C.sanitizeGraph({ ...JSON.parse(text), view });
      graph = { ...g, view };
      selected.clear();
      selectedWire = -1;
      pending = null;
      renderAll();
      changed();
    }
    function undo() {
      if (!undoStack.length) return;
      redoStack.push(snapshot());
      restore(undoStack.pop());
      lastUndoKey = "";
      syncToolbar();
      say("Undone.");
    }
    function redo() {
      if (!redoStack.length) return;
      undoStack.push(snapshot());
      restore(redoStack.pop());
      lastUndoKey = "";
      syncToolbar();
      say("Redone.");
    }
    function syncToolbar() {
      root.querySelector('[data-act="undo"]').disabled = !undoStack.length;
      root.querySelector('[data-act="redo"]').disabled = !redoStack.length;
    }

    // ---------- the graph ----------
    function addNode(type, x, y) {
      const def = D.NODES[type];
      if (!def) return null;
      pushUndo();
      const node = { id: C.freeId(graph), type, x: Math.round(x / GRID) * GRID, y: Math.round(y / GRID) * GRID, values: {}, props: {} };
      graph.nodes.push(node);
      selected.clear();
      selected.add(node.id);
      selectedWire = -1;
      renderAll();
      changed();
      say(`Added ${def.title}.`);
      return node;
    }

    const pinOf = (nodeId, key) => {
      const n = nodeById(nodeId);
      return n ? layoutOf(n).pins[key] : null;
    };
    const wireSource = (w) => pinOf(w.from.node, `out:${w.from.pin}`);
    const wireTarget = (w) => pinOf(w.to.node, w.to.pin === "in" ? "in:in" : `in:${w.to.pin}`);

    // Join two pins (either order). Returns an error sentence, or "" when it worked.
    function connect(a, b) {
      let from = a;
      let to = b;
      if (a.dir === "in" && b.dir === "out") [from, to] = [b, a];
      if (from.dir !== "out" || to.dir !== "in") return "Connect an output pin to an input pin.";
      if (from.node === to.node) return "A node can't be connected to itself.";
      const fp = pinOf(from.node, `out:${from.pin}`);
      const tp = pinOf(to.node, `in:${to.pin}`);
      if (!fp || !tp) return "That pin is not available.";
      if (!D.compatible(fp.type, tp.type)) return `A ${D.TYPE_LABELS[fp.type]} can't go into a ${D.TYPE_LABELS[tp.type]} pin.`;
      pushUndo();
      // An input takes one wire; a flow pin leads to one place.
      graph.wires = graph.wires.filter((w) => {
        if (tp.type !== "flow" && w.to.node === to.node && w.to.pin === to.pin) return false;
        if (fp.type === "flow" && w.from.node === from.node && w.from.pin === from.pin) return false;
        return true;
      });
      graph.wires.push({ from: { node: from.node, pin: from.pin }, to: { node: to.node, pin: to.pin } });
      renderAll();
      changed();
      return "";
    }

    function disconnectPin(p) {
      const before = graph.wires.length;
      const keep = graph.wires.filter((w) => !(p.dir === "in" ? w.to.node === p.node && w.to.pin === p.pin : w.from.node === p.node && w.from.pin === p.pin));
      if (keep.length === before) return false;
      pushUndo();
      graph.wires = keep;
      selectedWire = -1;
      renderAll();
      changed();
      return true;
    }

    function deleteSelection() {
      if (selectedWire >= 0 && graph.wires[selectedWire]) {
        pushUndo();
        graph.wires.splice(selectedWire, 1);
        selectedWire = -1;
        renderAll();
        changed();
        say("Wire removed.");
        return;
      }
      if (!selected.size) return;
      pushUndo();
      const gone = new Set(selected);
      graph.nodes = graph.nodes.filter((n) => !gone.has(n.id));
      graph.wires = graph.wires.filter((w) => !gone.has(w.from.node) && !gone.has(w.to.node));
      selected.clear();
      renderAll();
      changed();
      say(`Removed ${gone.size} node${gone.size === 1 ? "" : "s"}.`);
      viewport.focus();
    }

    function duplicateSelection() {
      if (!selected.size) return;
      pushUndo();
      const map = new Map();
      for (const n of graph.nodes.filter((x) => selected.has(x.id))) {
        const copy = { id: C.freeId({ nodes: [...graph.nodes, ...map.values()] }), type: n.type, x: n.x + 40, y: n.y + 40, values: { ...n.values }, props: { ...n.props } };
        map.set(n.id, copy);
      }
      for (const copy of map.values()) graph.nodes.push(copy);
      for (const w of [...graph.wires]) if (map.has(w.from.node) && map.has(w.to.node)) graph.wires.push({ from: { node: map.get(w.from.node).id, pin: w.from.pin }, to: { node: map.get(w.to.node).id, pin: w.to.pin } });
      selected.clear();
      for (const copy of map.values()) selected.add(copy.id);
      renderAll();
      changed();
      say(`Duplicated ${map.size} node${map.size === 1 ? "" : "s"}.`);
    }

    // ---------- drawing ----------
    function applyView() {
      world.style.transform = `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`;
      viewport.style.backgroundPosition = `${view.x}px ${view.y}px`;
      viewport.style.backgroundSize = `${GRID * view.zoom}px ${GRID * view.zoom}px`;
    }

    const wiredInputs = () => {
      const set = new Set();
      for (const w of graph.wires) set.add(`${w.to.node}.${w.to.pin}`);
      return set;
    };

    function connectedNote(p, nodeId) {
      const parts = [];
      for (const w of graph.wires) {
        if (p.dir === "out" && w.from.node === nodeId && w.from.pin === p.id) parts.push(`to ${titleOf(nodeById(w.to.node))}`);
        if (p.dir === "in" && w.to.node === nodeId && w.to.pin === p.id) parts.push(`from ${titleOf(nodeById(w.from.node))}`);
      }
      return parts.length ? `, connected ${parts.join(" and ")}` : ", not connected";
    }

    function buildNode(n) {
      const def = defOf(n);
      const L = layoutOf(n);
      const el = document.createElement("div");
      el.className = `ne-node${selected.has(n.id) ? " is-selected" : ""}${def && !D.isExec(def) ? " is-value" : ""}${flashId === n.id ? " is-flash" : ""}`;
      el.dataset.id = n.id;
      el.dataset.cat = def ? def.category : "Unknown";
      el.tabIndex = 0;
      el.setAttribute("role", "group");
      el.setAttribute("aria-label", `${titleOf(n)} node`);
      el.style.cssText = `left:${n.x}px;top:${n.y}px;width:${L.w}px;height:${L.h}px`;
      const head = document.createElement("div");
      head.className = "ne-head";
      head.innerHTML = `<span class="ne-title">${esc(titleOf(n))}</span><button type="button" class="ne-remove" aria-label="Remove ${esc(titleOf(n))}" title="Remove">×</button>`;
      if (def && def.help) head.title = def.help;
      el.appendChild(head);
      const wired = wiredInputs();
      for (const item of L.items) {
        if (item.kind === "label") {
          const s = document.createElement("span");
          s.className = `ne-label ne-label-${item.align}`;
          s.style.cssText = `top:${item.y}px;height:${item.h}px;line-height:${ROW_H}px`;
          s.textContent = item.text;
          el.appendChild(s);
        } else if (item.kind === "prop") {
          const p = item.prop;
          const wrap = document.createElement("label");
          wrap.className = "ne-prop";
          wrap.style.cssText = `top:${item.y}px;height:${item.h}px`;
          const cur = p.id in n.props ? n.props[p.id] : p.value;
          let control;
          if (p.control === "select") {
            control = document.createElement("select");
            for (const o of p.options) {
              const opt = document.createElement("option");
              opt.value = o.value;
              opt.textContent = o.label;
              if (String(cur) === String(o.value)) opt.selected = true;
              control.appendChild(opt);
            }
          } else if (p.control === "textarea") {
            control = document.createElement("textarea");
            control.value = String(cur == null ? "" : cur);
            control.rows = 2;
          } else {
            control = document.createElement("input");
            control.type = p.control === "number" ? "number" : "text";
            control.value = String(cur == null ? "" : cur);
          }
          control.className = "ne-control";
          control.dataset.prop = p.id;
          control.addEventListener("input", () => {
            pushUndo(`${n.id}.${p.id}`);
            n.props[p.id] = control.value;
            afterValueChange();
          });
          const lab = document.createElement("span");
          lab.textContent = p.label;
          wrap.append(lab, control);
          el.appendChild(wrap);
        } else if (item.kind === "input") {
          const inp = item.input;
          const row = document.createElement("div");
          row.className = "ne-input";
          row.style.cssText = `top:${item.y}px;height:${item.h}px`;
          const lab = document.createElement("span");
          lab.className = "ne-in-label";
          lab.textContent = inp.label;
          row.appendChild(lab);
          const isWired = wired.has(`${n.id}.${inp.id}`);
          if (!isWired && !inp.required && inp.type !== "list" && inp.type !== "object") {
            const cur = inp.id in n.values ? n.values[inp.id] : inp.value;
            let control;
            if (inp.type === "bool") {
              control = document.createElement("input");
              control.type = "checkbox";
              control.checked = cur === true || cur === "true";
              control.setAttribute("aria-label", inp.label);
              control.addEventListener("change", () => {
                pushUndo(`${n.id}.${inp.id}`);
                n.values[inp.id] = control.checked;
                afterValueChange();
              });
            } else {
              control = document.createElement(inp.multiline ? "textarea" : "input");
              if (!inp.multiline) control.type = inp.type === "number" ? "number" : "text";
              control.value = String(cur == null ? "" : cur);
              control.setAttribute("aria-label", inp.label);
              control.addEventListener("input", () => {
                pushUndo(`${n.id}.${inp.id}`);
                n.values[inp.id] = control.value;
                afterValueChange();
              });
            }
            control.className = `ne-control ne-const${inp.multiline ? " ne-const-multi" : ""}`;
            control.dataset.input = inp.id;
            row.appendChild(control);
          }
          el.appendChild(row);
        }
      }
      for (const p of Object.values(L.pins)) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = `ne-pin ne-t-${p.type} ne-${p.dir}`;
        b.style.cssText = `left:${p.x - 8}px;top:${p.y - 8}px`;
        b.dataset.node = n.id;
        b.dataset.pin = p.id;
        b.dataset.dir = p.dir;
        b.dataset.type = p.type;
        const isPending = pending && pending.node === n.id && pending.pin === p.id && pending.dir === p.dir;
        b.setAttribute("aria-pressed", isPending ? "true" : "false");
        b.setAttribute("aria-label", `${p.dir === "in" ? "Input" : "Output"} ${p.label || (p.type === "flow" ? "flow" : "")} (${D.TYPE_LABELS[p.type]}) of ${titleOf(n)}${connectedNote({ dir: p.dir, id: p.id }, n.id)}. Enter to connect, Delete to disconnect.`);
        el.appendChild(b);
      }
      el.querySelector(".ne-remove").addEventListener("click", (e) => {
        e.stopPropagation();
        selected.clear();
        selected.add(n.id);
        deleteSelection();
      });
      return el;
    }

    function applyMarks() {
      for (const el of nodesEl.querySelectorAll(".ne-node")) {
        const level = marks.get(el.dataset.id);
        el.classList.toggle("has-error", level === "error");
        el.classList.toggle("has-warn", level === "warn");
      }
    }

    function renderNodes() {
      const active = document.activeElement;
      const focusKey = active && nodesEl.contains(active) ? { node: active.closest(".ne-node")?.dataset.id, pin: active.dataset.pin, dir: active.dataset.dir, prop: active.dataset.prop, input: active.dataset.input, cls: active.className } : null;
      nodesEl.textContent = "";
      for (const n of graph.nodes) nodesEl.appendChild(buildNode(n));
      if (focusKey && focusKey.node) {
        const nodeEl = nodesEl.querySelector(`.ne-node[data-id="${CSS.escape(focusKey.node)}"]`);
        let target = null;
        if (nodeEl) {
          if (focusKey.pin !== undefined && focusKey.dir) target = nodeEl.querySelector(`.ne-pin[data-pin="${CSS.escape(focusKey.pin)}"][data-dir="${focusKey.dir}"]`);
          else if (focusKey.prop) target = nodeEl.querySelector(`[data-prop="${CSS.escape(focusKey.prop)}"]`);
          else if (focusKey.input) target = nodeEl.querySelector(`[data-input="${CSS.escape(focusKey.input)}"]`);
          else target = nodeEl;
        }
        if (target) target.focus({ preventScroll: true });
      }
      applyMarks();
    }

    function svgPath(d, cls) {
      const p = document.createElementNS(NS, "path");
      p.setAttribute("d", d);
      p.setAttribute("class", cls);
      return p;
    }

    function renderWires(temp) {
      wiresSvg.textContent = "";
      graph.wires.forEach((w, i) => {
        const a = wireSource(w);
        const b = wireTarget(w);
        const na = nodeById(w.from.node);
        const nb = nodeById(w.to.node);
        if (!a || !b || !na || !nb) return;
        const d = wirePath(na.x + a.x, na.y + a.y, nb.x + b.x, nb.y + b.y);
        const hit = svgPath(d, "ne-wire-hit");
        hit.dataset.wire = String(i);
        wiresSvg.appendChild(hit);
        wiresSvg.appendChild(svgPath(d, `ne-wire ne-w-${a.type}${i === selectedWire ? " is-selected" : ""}`));
      });
      if (temp) wiresSvg.appendChild(svgPath(temp, "ne-wire ne-wire-temp"));
    }

    function renderProblems() {
      const real = problems.filter((p) => p && p.text);
      problemsEl.hidden = !real.length;
      problemsEl.innerHTML = real
        .map((p, i) => `<li class="ne-problem ne-problem-${p.level === "error" ? "error" : "warn"}"><button type="button" data-i="${i}"><b>${p.level === "error" ? "Fix" : "Note"}</b> ${esc(p.text)}</button></li>`)
        .join("");
    }

    function renderAll() {
      renderNodes();
      renderWires();
      renderProblems();
      applyView();
      syncToolbar();
    }

    function afterValueChange() {
      changed();
    }

    // ---------- pointer: connect, move, pan, select ----------
    const toWorld = (cx, cy) => {
      const r = viewport.getBoundingClientRect();
      return { x: (cx - r.left - view.x) / view.zoom, y: (cy - r.top - view.y) / view.zoom };
    };

    function pinFromEl(el) {
      return { node: el.dataset.node, pin: el.dataset.pin, dir: el.dataset.dir, type: el.dataset.type };
    }

    function startConnection(pinEl, ev) {
      const from = pinFromEl(pinEl);
      const start = { x: ev.clientX, y: ev.clientY };
      let dragged = false;
      const n = nodeById(from.node);
      const fp = layoutOf(n).pins[`${from.dir}:${from.pin}`];
      const origin = { x: n.x + fp.x, y: n.y + fp.y };
      viewport.setPointerCapture(ev.pointerId);
      const move = (e) => {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4) dragged = true;
        if (!dragged) return;
        const p = toWorld(e.clientX, e.clientY);
        renderWires(from.dir === "out" ? wirePath(origin.x, origin.y, p.x, p.y) : wirePath(p.x, p.y, origin.x, origin.y));
      };
      const up = (e) => {
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", up);
        viewport.removeEventListener("pointercancel", up);
        try {
          viewport.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* already released */
        }
        if (!dragged) {
          renderWires();
          activatePin(from);
          return;
        }
        const over = document.elementFromPoint(e.clientX, e.clientY);
        const target = over && over.closest ? over.closest(".ne-pin") : null;
        if (target) {
          const err = connect(from, pinFromEl(target));
          if (err) say(err);
          else say("Connected.");
          renderWires();
        } else {
          renderWires();
          const w = toWorld(e.clientX, e.clientY);
          openMenu(w.x, w.y, { from });
        }
      };
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up);
      viewport.addEventListener("pointercancel", up);
    }

    // Enter on a pin (or a click without dragging): the first one starts a connection, the second finishes it.
    function activatePin(p) {
      if (!pending) {
        pending = p;
        renderNodes();
        const n = nodeById(p.node);
        say(`Connecting from ${titleOf(n)}. Choose another pin and press Enter, or Escape to cancel.`);
        return;
      }
      const first = pending;
      pending = null;
      if (first.node === p.node && first.pin === p.pin && first.dir === p.dir) {
        renderNodes();
        say("Connection cancelled.");
        return;
      }
      const err = connect(first, p);
      if (err) {
        renderNodes();
        say(err);
      } else say("Connected.");
    }

    function startNodeDrag(nodeEl, ev) {
      const nid = nodeEl.dataset.id;
      if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
        if (selected.has(nid)) selected.delete(nid);
        else selected.add(nid);
      } else if (!selected.has(nid)) {
        selected.clear();
        selected.add(nid);
      }
      selectedWire = -1;
      refreshSelection();
      const start = { x: ev.clientX, y: ev.clientY };
      const originals = graph.nodes.filter((n) => selected.has(n.id)).map((n) => ({ n, x: n.x, y: n.y }));
      let moved = false;
      viewport.setPointerCapture(ev.pointerId);
      const move = (e) => {
        const dx = (e.clientX - start.x) / view.zoom;
        const dy = (e.clientY - start.y) / view.zoom;
        if (!moved && Math.hypot(dx, dy) < 3) return;
        if (!moved) {
          moved = true;
          pushUndo();
        }
        for (const o of originals) {
          o.n.x = Math.round((o.x + dx) / 10) * 10;
          o.n.y = Math.round((o.y + dy) / 10) * 10;
          const el = nodesEl.querySelector(`.ne-node[data-id="${CSS.escape(o.n.id)}"]`);
          if (el) {
            el.style.left = `${o.n.x}px`;
            el.style.top = `${o.n.y}px`;
          }
        }
        renderWires();
      };
      const up = () => {
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", up);
        viewport.removeEventListener("pointercancel", up);
        try {
          viewport.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* already released */
        }
        if (moved) changed();
      };
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up);
      viewport.addEventListener("pointercancel", up);
    }

    function startPan(ev) {
      const start = { x: ev.clientX, y: ev.clientY, vx: view.x, vy: view.y };
      let moved = false;
      viewport.setPointerCapture(ev.pointerId);
      const move = (e) => {
        if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 3) moved = true;
        view.x = start.vx + (e.clientX - start.x);
        view.y = start.vy + (e.clientY - start.y);
        applyView();
      };
      const up = () => {
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", up);
        viewport.removeEventListener("pointercancel", up);
        try {
          viewport.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* already released */
        }
        if (!moved && (selected.size || selectedWire >= 0)) {
          selected.clear();
          selectedWire = -1;
          refreshSelection();
          renderWires();
        }
        if (moved) changed(true);
      };
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up);
      viewport.addEventListener("pointercancel", up);
    }

    function startBox(ev) {
      const r = viewport.getBoundingClientRect();
      const start = { x: ev.clientX - r.left, y: ev.clientY - r.top };
      viewport.setPointerCapture(ev.pointerId);
      boxEl.hidden = false;
      const move = (e) => {
        const x = e.clientX - r.left;
        const y = e.clientY - r.top;
        boxEl.style.cssText = `left:${Math.min(start.x, x)}px;top:${Math.min(start.y, y)}px;width:${Math.abs(x - start.x)}px;height:${Math.abs(y - start.y)}px`;
      };
      const up = (e) => {
        viewport.removeEventListener("pointermove", move);
        viewport.removeEventListener("pointerup", up);
        boxEl.hidden = true;
        try {
          viewport.releasePointerCapture(ev.pointerId);
        } catch (err) {
          /* already released */
        }
        const a = toWorld(Math.min(ev.clientX, e.clientX), Math.min(ev.clientY, e.clientY));
        const b = toWorld(Math.max(ev.clientX, e.clientX), Math.max(ev.clientY, e.clientY));
        selected.clear();
        for (const n of graph.nodes) {
          const L = layoutOf(n);
          if (n.x < b.x && n.x + L.w > a.x && n.y < b.y && n.y + L.h > a.y) selected.add(n.id);
        }
        refreshSelection();
      };
      viewport.addEventListener("pointermove", move);
      viewport.addEventListener("pointerup", up);
    }

    function refreshSelection() {
      for (const el of nodesEl.querySelectorAll(".ne-node")) el.classList.toggle("is-selected", selected.has(el.dataset.id));
      renderWires();
    }

    viewport.addEventListener("pointerdown", (e) => {
      if (e.button !== 0 || menuState) {
        if (menuState && !menu.contains(e.target)) closeMenu();
        if (e.button !== 0) return;
      }
      const pinEl = e.target.closest(".ne-pin");
      if (pinEl) {
        e.preventDefault();
        startConnection(pinEl, e);
        return;
      }
      const wireHit = e.target.closest(".ne-wire-hit");
      if (wireHit) {
        selectedWire = Number(wireHit.dataset.wire);
        selected.clear();
        refreshSelection();
        viewport.focus();
        return;
      }
      const head = e.target.closest(".ne-head");
      if (head && !e.target.closest(".ne-remove")) {
        startNodeDrag(head.closest(".ne-node"), e);
        return;
      }
      if (e.target.closest(".ne-node") || e.target.closest(".ne-menu")) {
        const n = e.target.closest(".ne-node");
        if (n && !selected.has(n.dataset.id)) {
          selected.clear();
          selected.add(n.dataset.id);
          selectedWire = -1;
          refreshSelection();
        }
        return;
      }
      if (e.shiftKey) startBox(e);
      else startPan(e);
    });

    viewport.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        zoomAt(e.clientX, e.clientY, e.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false }
    );

    function zoomAt(cx, cy, factor) {
      const r = viewport.getBoundingClientRect();
      const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * factor));
      const k = next / view.zoom;
      const px = cx - r.left;
      const py = cy - r.top;
      view.x = px - (px - view.x) * k;
      view.y = py - (py - view.y) * k;
      view.zoom = next;
      applyView();
    }
    function zoomCentre(factor) {
      const r = viewport.getBoundingClientRect();
      zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
      changed(true);
    }
    function fit() {
      if (!graph.nodes.length) {
        view = { x: 40, y: 40, zoom: 1 };
        applyView();
        return;
      }
      let x0 = Infinity;
      let y0 = Infinity;
      let x1 = -Infinity;
      let y1 = -Infinity;
      for (const n of graph.nodes) {
        const L = layoutOf(n);
        x0 = Math.min(x0, n.x);
        y0 = Math.min(y0, n.y);
        x1 = Math.max(x1, n.x + L.w);
        y1 = Math.max(y1, n.y + L.h);
      }
      const r = viewport.getBoundingClientRect();
      const w = Math.max(1, r.width - 60);
      const h = Math.max(1, r.height - 60);
      const zoom = Math.min(1, Math.max(MIN_ZOOM, Math.min(w / (x1 - x0), h / (y1 - y0))));
      view = { zoom, x: 30 + (w - (x1 - x0) * zoom) / 2 - x0 * zoom, y: 30 + (h - (y1 - y0) * zoom) / 2 - y0 * zoom };
      applyView();
      changed(true);
    }

    // ---------- the add-a-node menu ----------
    function openMenu(wx, wy, ctx = {}) {
      menuState = { wx, wy, from: ctx.from || null };
      const r = viewport.getBoundingClientRect();
      const sx = Math.min(Math.max(8, wx * view.zoom + view.x), Math.max(8, r.width - 260));
      const sy = Math.min(Math.max(8, wy * view.zoom + view.y), Math.max(8, r.height - 300));
      menu.style.left = `${sx}px`;
      menu.style.top = `${sy}px`;
      menu.hidden = false;
      search.value = "";
      renderMenu();
      search.focus();
    }
    function closeMenu() {
      if (!menuState) return;
      menuState = null;
      menu.hidden = true;
      viewport.focus({ preventScroll: true });
    }
    // Nodes worth offering: all of them, or (dragging out of a pin) only those with a pin it can plug into.
    function menuChoices() {
      const q = search.value.trim().toLowerCase();
      const from = menuState && menuState.from;
      const out = [];
      for (const cat of D.CATEGORY_ORDER) {
        for (const [type, def] of Object.entries(D.NODES)) {
          if (def.category !== cat || type === "start") continue;
          if (q && !`${def.title} ${def.help} ${cat}`.toLowerCase().includes(q)) continue;
          if (from) {
            const L = layoutNode(def);
            const wantDir = from.dir === "out" ? "in" : "out";
            const ok = Object.values(L.pins).some((p) => p.dir === wantDir && (from.dir === "out" ? D.compatible(from.type, p.type) : D.compatible(p.type, from.type)));
            if (!ok) continue;
          }
          const title = def.title.toLowerCase();
          out.push({ type, def, cat, rank: !q ? 0 : title.startsWith(q) ? 0 : title.includes(q) ? 1 : 2 });
        }
      }
      // Searching: nodes whose name matches come first, in a flat list. Not searching: grouped by category.
      return q ? out.map((c, i) => ({ c, i })).sort((a, b) => a.c.rank - b.c.rank || a.i - b.i).map((x) => x.c) : out;
    }
    let menuPick = 0;
    function renderMenu() {
      const choices = menuChoices();
      menuPick = Math.min(menuPick, Math.max(0, choices.length - 1));
      let lastCat = "";
      const grouped = !search.value.trim();
      menuList.innerHTML = choices
        .map((c, i) => {
          const head = grouped && c.cat !== lastCat ? `<li class="ne-menu-cat" role="presentation">${esc(c.cat)}</li>` : "";
          lastCat = c.cat;
          return `${head}<li role="option" id="ne-opt-${id}-${i}" data-type="${c.type}" aria-selected="${i === menuPick}"><b>${esc(c.def.title)}</b><span>${esc(c.def.help)}</span></li>`;
        })
        .join("");
      if (!choices.length) menuList.innerHTML = '<li class="ne-menu-none" role="presentation">Nothing fits.</li>';
      search.setAttribute("aria-activedescendant", choices.length ? `ne-opt-${id}-${menuPick}` : "");
      const cur = menuList.querySelector('[aria-selected="true"]');
      if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: "nearest" });
    }
    function chooseFromMenu(type) {
      const state = menuState;
      closeMenu();
      const node = addNode(type, state.wx, state.wy);
      if (node && state.from) {
        // Plug the new node into the pin the drag started from.
        const L = layoutOf(node);
        const wantDir = state.from.dir === "out" ? "in" : "out";
        const pin = Object.values(L.pins).find((p) => p.dir === wantDir && (state.from.dir === "out" ? D.compatible(state.from.type, p.type) : D.compatible(p.type, state.from.type)));
        if (pin) connect(state.from, { node: node.id, pin: pin.id, dir: pin.dir, type: pin.type });
      }
    }
    search.addEventListener("input", () => {
      menuPick = 0;
      renderMenu();
    });
    search.addEventListener("keydown", (e) => {
      const choices = menuChoices();
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (choices.length) menuPick = (menuPick + (e.key === "ArrowDown" ? 1 : choices.length - 1)) % choices.length;
        renderMenu();
      } else if (e.key === "Enter") {
        e.preventDefault();
        if (choices[menuPick]) chooseFromMenu(choices[menuPick].type);
      } else if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        closeMenu();
      }
    });
    menuList.addEventListener("click", (e) => {
      const li = e.target.closest("li[data-type]");
      if (li) chooseFromMenu(li.dataset.type);
    });

    // ---------- keyboard ----------
    const typing = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT");
    viewport.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      const t = e.target;
      if (t === search) return;
      const pinEl = t.closest && t.closest(".ne-pin");
      if (pinEl) {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          e.stopPropagation();
          activatePin(pinFromEl(pinEl));
          return;
        }
        if (e.key === "Delete" || e.key === "Backspace") {
          e.preventDefault();
          e.stopPropagation();
          const p = pinFromEl(pinEl);
          say(disconnectPin(p) ? "Disconnected." : "Nothing connected to this pin.");
          return;
        }
      }
      if (e.key === "Escape") {
        if (pending) {
          pending = null;
          renderNodes();
          say("Connection cancelled.");
          e.preventDefault();
          e.stopPropagation();
        } else if (selected.size || selectedWire >= 0) {
          selected.clear();
          selectedWire = -1;
          refreshSelection();
          e.preventDefault();
          e.stopPropagation();
        }
        return;
      }
      if (mod && e.key === "Enter" && options.onRun) {
        e.preventDefault();
        e.stopPropagation();
        options.onRun();
        return;
      }
      if (typing(t)) return;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
          e.stopPropagation();
        if (e.shiftKey) redo();
        else undo();
      } else if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
          e.stopPropagation();
        redo();
      } else if (mod && e.key.toLowerCase() === "d") {
        e.preventDefault();
          e.stopPropagation();
        duplicateSelection();
      } else if (mod && e.key.toLowerCase() === "a") {
        e.preventDefault();
          e.stopPropagation();
        selected.clear();
        graph.nodes.forEach((n) => selected.add(n.id));
        refreshSelection();
      } else if ((e.key === "Delete" || e.key === "Backspace") && !mod) {
        if (selected.size || selectedWire >= 0) {
          e.preventDefault();
          e.stopPropagation();
          deleteSelection();
        }
      } else if ((e.key === "a" || e.key === "A" || e.key === " ") && !mod) {
        e.preventDefault();
          e.stopPropagation();
        const r = viewport.getBoundingClientRect();
        const p = toWorld(r.left + r.width / 2 - 100, r.top + r.height / 3);
        openMenu(p.x, p.y);
      } else if (e.key.startsWith("Arrow") && selected.size) {
        e.preventDefault();
          e.stopPropagation();
        const step = e.shiftKey ? 50 : 10;
        const dx = e.key === "ArrowLeft" ? -step : e.key === "ArrowRight" ? step : 0;
        const dy = e.key === "ArrowUp" ? -step : e.key === "ArrowDown" ? step : 0;
        pushUndo("move");
        for (const n of graph.nodes) if (selected.has(n.id)) {
          n.x += dx;
          n.y += dy;
        }
        const keep = document.activeElement;
        renderNodes();
        renderWires();
        if (keep && keep.classList && keep.classList.contains("ne-node")) {
          const again = nodesEl.querySelector(`.ne-node[data-id="${CSS.escape(keep.dataset.id)}"]`);
          if (again) again.focus({ preventScroll: true });
        }
        changed();
      }
    });
    // Focusing a node selects it, so arrows and Delete act on it.
    nodesEl.addEventListener("focusin", (e) => {
      const nodeEl = e.target.closest(".ne-node");
      if (!nodeEl) return;
      if (e.target === nodeEl && !selected.has(nodeEl.dataset.id)) {
        selected.clear();
        selected.add(nodeEl.dataset.id);
        selectedWire = -1;
        refreshSelection();
      }
    });

    root.querySelector(".ne-toolbar").addEventListener("click", (e) => {
      const b = e.target.closest("button[data-act]");
      if (!b) return;
      const act = b.dataset.act;
      if (act === "add") {
        const r = viewport.getBoundingClientRect();
        const p = toWorld(r.left + r.width / 2 - 100, r.top + r.height / 3);
        openMenu(p.x, p.y);
      } else if (act === "undo") undo();
      else if (act === "redo") redo();
      else if (act === "zoom-in") zoomCentre(1.2);
      else if (act === "zoom-out") zoomCentre(1 / 1.2);
      else if (act === "fit") fit();
    });
    problemsEl.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-i]");
      const p = b && problems.filter((x) => x && x.text)[Number(b.dataset.i)];
      if (p && p.node) highlightNode(p.node);
    });

    // ---------- the outside ----------
    function getGraph() {
      return { version: 1, nodes: graph.nodes.map((n) => ({ ...n, values: { ...n.values }, props: { ...n.props } })), wires: graph.wires.map((w) => ({ from: { ...w.from }, to: { ...w.to } })), view: { x: Math.round(view.x), y: Math.round(view.y), zoom: Math.round(view.zoom * 100) / 100 } };
    }
    function setGraph(g) {
      graph = C.sanitizeGraph(g);
      view = graph.view ? { ...graph.view } : { x: 40, y: 40, zoom: 1 };
      graph.view = view;
      selected.clear();
      selectedWire = -1;
      pending = null;
      undoStack.length = 0;
      redoStack.length = 0;
      renderAll();
    }
    function highlightNode(nid) {
      const n = nodeById(nid);
      if (!n) return;
      selected.clear();
      selected.add(nid);
      selectedWire = -1;
      flashId = nid;
      const r = viewport.getBoundingClientRect();
      const L = layoutOf(n);
      if (n.x * view.zoom + view.x < 0 || n.y * view.zoom + view.y < 0 || (n.x + L.w) * view.zoom + view.x > r.width || (n.y + L.h) * view.zoom + view.y > r.height) {
        view.x = r.width / 2 - (n.x + L.w / 2) * view.zoom;
        view.y = r.height / 3 - n.y * view.zoom;
      }
      renderAll();
      const el = nodesEl.querySelector(`.ne-node[data-id="${CSS.escape(nid)}"]`);
      if (el) el.focus({ preventScroll: true });
      setTimeout(() => {
        flashId = null;
        const again = nodesEl.querySelector(`.ne-node[data-id="${CSS.escape(nid)}"]`);
        if (again) again.classList.remove("is-flash");
      }, 1200);
    }
    function setProblems(list) {
      problems = Array.isArray(list) ? list : [];
      marks = new Map();
      for (const p of problems) if (p.node && (!marks.has(p.node) || p.level === "error")) marks.set(p.node, p.level);
      renderProblems();
      applyMarks();
    }

    renderAll();
    const resizeObserver = typeof ResizeObserver !== "undefined" ? new ResizeObserver(() => applyView()) : null;
    if (resizeObserver) resizeObserver.observe(viewport);

    return {
      el: root,
      viewport,
      getGraph,
      setGraph,
      setProblems,
      highlightNode,
      addNode,
      focus: () => viewport.focus(),
      relayout: () => {
        renderAll();
      },
      fit,
      destroy: () => {
        if (resizeObserver) resizeObserver.disconnect();
        root.remove();
      },
    };
  }

  api.create = create;
})();
