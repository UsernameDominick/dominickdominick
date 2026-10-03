// Turns a node graph into script code. The graph is { version, nodes: [{ id, type, x, y, values, props }], wires: [{ from: { node, pin },
// to: { node, pin } }] }. Flow wires run from a node's flow-out pin to the next node's "in" pin; data wires run from an output pin to an input pin.
// The result is ordinary script code (the same `site.*` helpers), so it runs through the same preview and apply as a hand-written script.
// Pure (no page access), so a node test can load it.
(function () {
  const defsOf = () => (typeof window !== "undefined" && window.NodeDefs) || require("./node-defs.js");

  const MAX_NODES = 300;
  const MAX_WIRES = 1000;
  const VERSION = 1;

  const varName = (nodeId, pin) => `v_${String(nodeId).replace(/[^a-zA-Z0-9]/g, "_")}_${pin}`;

  function newGraph() {
    return { version: VERSION, nodes: [{ id: "n1", type: "start", x: 40, y: 40, values: {}, props: {} }], wires: [], view: null };
  }

  // An id for a new node: n1, n2, ... whichever is free.
  function freeId(graph) {
    const taken = new Set(graph.nodes.map((n) => n.id));
    let i = graph.nodes.length + 1;
    while (taken.has(`n${i}`)) i++;
    return `n${i}`;
  }

  const num = (v, fallback = 0) => (Number.isFinite(Number(v)) ? Number(v) : fallback);
  const plain = (o) => {
    const out = {};
    if (o && typeof o === "object" && !Array.isArray(o)) {
      for (const [k, v] of Object.entries(o)) if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
    }
    return out;
  };

  // Whatever came from storage, as a graph the editor and compiler can trust: odd nodes and wires are dropped, numbers and values tidied.
  function sanitizeGraph(raw) {
    const g = raw && typeof raw === "object" ? raw : {};
    const nodes = [];
    const seen = new Set();
    for (const n of Array.isArray(g.nodes) ? g.nodes.slice(0, MAX_NODES) : []) {
      if (!n || typeof n.id !== "string" || !n.id || seen.has(n.id) || typeof n.type !== "string") continue;
      seen.add(n.id);
      nodes.push({ id: n.id, type: n.type, x: Math.round(num(n.x)), y: Math.round(num(n.y)), values: plain(n.values), props: plain(n.props) });
    }
    const wires = [];
    const used = new Set();
    for (const w of Array.isArray(g.wires) ? g.wires.slice(0, MAX_WIRES) : []) {
      if (!w || !w.from || !w.to || !seen.has(w.from.node) || !seen.has(w.to.node)) continue;
      if (typeof w.from.pin !== "string" || typeof w.to.pin !== "string") continue;
      const key = `${w.from.node}.${w.from.pin}>${w.to.node}.${w.to.pin}`;
      if (used.has(key)) continue;
      used.add(key);
      wires.push({ from: { node: w.from.node, pin: w.from.pin }, to: { node: w.to.node, pin: w.to.pin } });
    }
    const v = g.view && typeof g.view === "object" ? { x: Math.round(num(g.view.x)), y: Math.round(num(g.view.y)), zoom: Math.min(2, Math.max(0.25, num(g.view.zoom, 1))) } : null;
    return { version: VERSION, nodes, wires, view: v };
  }

  function compile(graphIn, defs = defsOf().NODES) {
    const D = defsOf();
    const graph = sanitizeGraph(graphIn);
    const problems = [];
    const problem = (level, node, text) => problems.push({ level, node: node || null, text });
    const byId = new Map(graph.nodes.map((n) => [n.id, n]));
    const title = (n) => (defs[n.type] ? defs[n.type].title : n.type);
    const pinsOf = (def) => ({
      flowOuts: new Set((def.flowOuts || []).map((p) => p.id)),
      outputs: new Map((def.outputs || []).map((p) => [p.id, p])),
      inputs: new Map((def.inputs || []).map((p) => [p.id, p])),
    });

    // Index the wires: where each data input gets its value from, and where each flow pin leads.
    const dataSource = new Map();
    const flowTarget = new Map();
    for (const w of graph.wires) {
      const from = byId.get(w.from.node);
      const to = byId.get(w.to.node);
      const fd = defs[from.type];
      const td = defs[to.type];
      if (!fd || !td) continue;
      const fp = pinsOf(fd);
      const tp = pinsOf(td);
      if (fp.flowOuts.has(w.from.pin)) {
        if (!td.flowIn || w.to.pin !== "in") {
          problem("error", to.id, `${title(from)} leads into ${title(to)}, which is not a step.`);
          continue;
        }
        if (flowTarget.has(`${from.id}.${w.from.pin}`)) problem("warn", from.id, `${title(from)} has two wires leaving the same flow pin; only the first is used.`);
        else flowTarget.set(`${from.id}.${w.from.pin}`, to.id);
      } else if (fp.outputs.has(w.from.pin) && tp.inputs.has(w.to.pin)) {
        const outPin = fp.outputs.get(w.from.pin);
        const inPin = tp.inputs.get(w.to.pin);
        if (!D.compatible(outPin.type, inPin.type)) {
          problem("error", to.id, `"${outPin.label}" from ${title(from)} (${D.TYPE_LABELS[outPin.type]}) can't go into "${inPin.label}" on ${title(to)} (${D.TYPE_LABELS[inPin.type]}).`);
          continue;
        }
        if (dataSource.has(`${to.id}.${w.to.pin}`)) problem("warn", to.id, `"${inPin.label}" on ${title(to)} has two wires; only the first is used.`);
        else dataSource.set(`${to.id}.${w.to.pin}`, { node: from.id, pin: w.from.pin });
      } else {
        problem("warn", from.id, `A wire from ${title(from)} to ${title(to)} does not match any pins and was ignored.`);
      }
    }

    const used = new Set();
    const reached = new Set();
    const propsOf = (n, def) => {
      const out = {};
      for (const p of def.props || []) out[p.id] = n.props && p.id in n.props ? n.props[p.id] : p.value;
      return out;
    };
    const literal = (type, c) => {
      if (type === "number") return String(Number(c) || 0);
      if (type === "bool") return c === true || c === "true" ? "true" : "false";
      if (type === "list" || type === "object") return "undefined";
      return D.lit(String(c == null ? "" : c));
    };

    // stack: the value nodes being worked out right now, so a value wired into itself is caught instead of looping forever.
    function exprFor(node, input, scope, stack = new Set()) {
      const src = dataSource.get(`${node.id}.${input.id}`);
      if (src) {
        const sn = byId.get(src.node);
        const sd = defs[sn.type];
        if (!D.isExec(sd)) return `(${pureExpr(sn, scope, stack)})`;
        const name = varName(sn.id, src.pin);
        if (!scope.has(name)) {
          const out = (sd.outputs || []).find((o) => o.id === src.pin);
          problem("error", node.id, `${title(node)} uses "${out ? out.label : src.pin}" from ${title(sn)}, but ${title(sn)} has not run by then. Connect the flow so ${title(sn)} comes first.`);
          return "undefined";
        }
        used.add(sn.id);
        return name;
      }
      if (input.required) {
        problem("error", node.id, `${title(node)} needs something connected to "${input.label}".`);
        return "undefined";
      }
      const c = node.values && input.id in node.values ? node.values[input.id] : input.value;
      return literal(input.type, c);
    }

    function pureExpr(n, scope, stack) {
      const def = defs[n.type];
      if (!def) {
        problem("error", n.id, `Unknown node type "${n.type}".`);
        return "undefined";
      }
      if (stack.has(n.id)) {
        problem("error", n.id, `${title(n)} is wired into itself.`);
        return "undefined";
      }
      used.add(n.id);
      const next = new Set([...stack, n.id]);
      const ins = {};
      for (const input of def.inputs || []) ins[input.id] = exprFor(n, input, scope, next);
      return def.expr({ id: n.id, in: ins, props: propsOf(n, def) });
    }

    const tag = (id) => (l) => (typeof l === "string" ? { text: l, node: id } : l);

    function chain(nodeId, scope, path) {
      if (!nodeId) return [];
      const n = byId.get(nodeId);
      const def = defs[n.type];
      if (!def) {
        problem("error", n.id, `Unknown node type "${n.type}".`);
        return [];
      }
      if (!D.isExec(def)) {
        problem("error", n.id, `${title(n)} is a value, not a step. Connect it to an input instead.`);
        return [];
      }
      if (path.has(nodeId)) {
        problem("error", n.id, `The flow loops back to ${title(n)}. Use "For each" to repeat steps.`);
        return [];
      }
      if (reached.has(nodeId)) {
        problem("error", n.id, `${title(n)} is reached from two places. Each step can only follow one other step.`);
        return [];
      }
      reached.add(nodeId);
      used.add(nodeId);
      const here = new Set([...path, nodeId]);
      const ins = {};
      for (const input of def.inputs || []) ins[input.id] = exprFor(n, input, scope);
      const outs = {};
      for (const o of def.outputs || []) outs[o.id] = varName(n.id, o.id);
      const scoped = def.scoped || {};
      const scopedVars = new Set(Object.values(scoped).flat().map((id) => outs[id]));
      const ctx = {
        id: n.id,
        in: ins,
        out: outs,
        props: propsOf(n, def),
        indent: D.indent,
        block: (pinId) => {
          const child = new Set(scope);
          for (const o of scoped[pinId] || []) child.add(outs[o]);
          return chain(flowTarget.get(`${n.id}.${pinId}`), child, here);
        },
      };
      const emitted = def.emit(ctx).map(tag(n.id));
      const after = new Set(scope);
      for (const o of def.outputs || []) if (!scopedVars.has(outs[o.id])) after.add(outs[o.id]);
      const cont = def.continueAfter === undefined ? "then" : def.continueAfter;
      const rest = cont ? chain(flowTarget.get(`${n.id}.${cont}`), after, here) : [];
      return [...emitted, ...rest];
    }

    const starts = graph.nodes.filter((n) => n.type === "start");
    let body = [];
    if (!starts.length) problem("error", null, "Add a Start node to say where the script begins.");
    else {
      starts.slice(1).forEach((n) => problem("error", n.id, "There can only be one Start node."));
      body = chain(starts[0].id, new Set(), new Set());
      if (!flowTarget.has(`${starts[0].id}.then`)) problem("warn", starts[0].id, "Start isn't connected to anything yet. Drag from its flow pin to the first step.");
    }
    for (const n of graph.nodes) {
      if (n.type === "start" || used.has(n.id) || !defs[n.type]) continue;
      problem("warn", n.id, `${title(n)} isn't connected to the script, so it does nothing.`);
    }
    if (graph.nodes.length > MAX_NODES || (graphIn && Array.isArray(graphIn.nodes) && graphIn.nodes.length > MAX_NODES)) problem("error", null, `A graph can have up to ${MAX_NODES} nodes.`);

    const lines = [{ text: "// Built from nodes. Change the nodes, or copy this into a new script to edit it by hand.", node: null }, ...body];
    return {
      ok: !problems.some((p) => p.level === "error"),
      code: lines.map((l) => l.text).join("\n") + "\n",
      lineNodes: lines.map((l) => l.node),
      problems,
    };
  }

  // The node a line of the generated code came from (line is 1-based, as in an error message), or null.
  function nodeAtLine(result, line) {
    return (result && result.lineNodes && result.lineNodes[line - 1]) || null;
  }

  const api = { compile, sanitizeGraph, newGraph, freeId, nodeAtLine, varName, MAX_NODES, MAX_WIRES, VERSION };
  if (typeof window !== "undefined") window.NodeCompiler = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
