// A general DC network solver for the Simulation builder, shared by the admin canvas and the public page (the worker
// imports this same file, so the two can never drift apart). It is used where the one-path solver in sim-components.js
// can't vouch for a circuit -- parallel branches, a switch or wire across a part, or several sources in one circuit --
// and it solves the whole network at once:
//   - nodes are joined by wires, closed switches and SPDT throws (ideal, 0 ohm);
//   - resistors, potentiometers, inductor windings and the Teensy's load are resistances;
//   - batteries and an active power supply are ideal voltage sources (a battery's internal resistance in series);
//   - an ammeter is a zero-volt link whose current is reported;
//   - LEDs and diodes are one-way parts with a fixed forward voltage: each is either off (open) or on (a source of
//     that voltage with a tiny series resistance), and the solver finds the combination that is consistent;
//   - a transistor (NPN or PNP) is a base-emitter junction with a fixed 0.7 V drop plus either nothing (cut off), a collector
//     current of gain times the base current (active), or a 0.2 V collector-emitter drop (saturated); the solver finds the
//     region that is consistent;
//   - capacitors, voltmeters, ohmmeters, TVs and gates draw no current.
// It declines (returns nothing for that network) rather than guess: a wall outlet in the network (mains is handled by
// the one-path solver's "dangerous" rules), a dead short or two sources that contradict each other, a network over
// MAX_NODES, or diodes that never settle. The caller then keeps the one-path figures and its warning.
(function (root) {
  "use strict";

  const MAX_NODES = 200;
  const GMIN = 1e-12; // keeps a node that only an "off" diode touches from making the matrix singular
  const DIODE_ON_OHMS = 0.001; // a conducting diode's small series resistance: splits current between parallel diodes
  const BJT_VBE = 0.7; // base-emitter drop of a conducting transistor
  const BJT_VCE_SAT = 0.2; // collector-emitter drop of a saturated one
  const BJT_DEFAULT_GAIN = 100;
  const BJT_MAX_GAIN = 1000;

  // ---- the linear solve --------------------------------------------------------------------------------------------
  // Elements (node names are strings; "ref" nodes are chosen here, one per connected network):
  //   { kind: "res", id, a, b, r }            resistor, r > 0
  //   { kind: "src", id, a, b, v }            ideal source, + at a, - at b
  //   { kind: "link", id, a, b }              zero-volt link (ammeter): a current to report, no voltage
  //   { kind: "diode", id, a, b, vf }         anode a, cathode b
  //   { kind: "bjt", id, a, b, base, beta, pnp, forceOff }  collector a, emitter b (an NPN; a PNP has the emitter on the high side)
  // Returns { ok, reason, volts: Map(node -> V), current: Map(id -> A flowing a to b through the element), on: Map(id -> bool),
  // mode: Map(bjt id -> "off" | "active" | "sat") } -- a transistor's currents are under "<id>:b" (base, into the base for an
  // NPN) and "<id>:c" (collector, into the collector for an NPN).
  function solveNetwork(elements) {
    const nodes = new Set();
    elements.forEach((e) => {
      nodes.add(e.a);
      nodes.add(e.b);
      if (e.kind === "bjt") nodes.add(e.base);
    });
    if (nodes.size > MAX_NODES) return { ok: false, reason: "large" };
    // Connected networks (every element joins its two nodes), each with one reference node held at 0 V.
    const parent = new Map();
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      return r;
    };
    elements.forEach((e) => {
      const ra = find(e.a);
      const rb = find(e.b);
      if (ra !== rb) parent.set(ra, rb);
      if (e.kind === "bjt") {
        const rc = find(e.base);
        const rd = find(e.a);
        if (rc !== rd) parent.set(rc, rd);
      }
    });
    const refOf = new Map();
    elements.forEach((e) => {
      if (e.kind === "src" && !refOf.has(find(e.b))) refOf.set(find(e.b), e.b);
    });
    nodes.forEach((n) => {
      if (!refOf.has(find(n))) refOf.set(find(n), n);
    });
    const refs = new Set(refOf.values());
    const free = [...nodes].filter((n) => !refs.has(n));
    const index = new Map();
    free.forEach((n, i) => index.set(n, i));
    const nodeIdx = (n) => (index.has(n) ? index.get(n) : -1);

    const diodes = elements.filter((e) => e.kind === "diode");
    const bjts = elements.filter((e) => e.kind === "bjt");
    const on = new Map(diodes.map((d) => [d.id, false]));
    const mode = new Map(bjts.map((t) => [t.id, "off"]));
    const maxIterations = 4 * diodes.length + 8 * bjts.length + 10;
    // Base-emitter and collector-emitter voltages in the part's own direction (positive when it conducts normally).
    const vbeOf = (t, v) => (t.pnp ? v.get(t.b) - v.get(t.base) : v.get(t.base) - v.get(t.b));
    const vceOf = (t, v) => (t.pnp ? v.get(t.b) - v.get(t.a) : v.get(t.a) - v.get(t.b));
    let solution = null;
    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      solution = solveWith();
      if (!solution.ok) return solution;
      // Look for the part whose state is most wrong. First anything conducting backwards goes off (an "on" diode carrying
      // current backwards, a transistor with its base current reversed); otherwise an "off" diode forward biased past its drop
      // goes on, a cut-off transistor driven past 0.7 V turns on, an active one pushed below its saturation voltage saturates,
      // and a saturated one that would need more collector current than the gain allows drops back to active.
      let worst = null;
      let worstAmount = 0;
      const consider = (amount, flip) => {
        if (amount > worstAmount) {
          worstAmount = amount;
          worst = flip;
        }
      };
      diodes.forEach((d) => {
        if (!on.get(d.id)) return;
        const i = solution.current.get(d.id);
        if (i < -1e-12) consider(-i, () => on.set(d.id, false));
      });
      bjts.forEach((t) => {
        if (mode.get(t.id) === "off") return;
        const ib = solution.current.get(`${t.id}:b`);
        if (ib < -1e-12) consider(-ib, () => mode.set(t.id, "off"));
      });
      if (!worst) {
        diodes.forEach((d) => {
          if (on.get(d.id)) return;
          const over = solution.volts.get(d.a) - solution.volts.get(d.b) - d.vf;
          if (over > 1e-9) consider(over, () => on.set(d.id, true));
        });
        bjts.forEach((t) => {
          const md = mode.get(t.id);
          if (md === "off") {
            if (t.forceOff) return; // a base wired to nothing: its node would float at the reference voltage and turn a PNP on
            const over = vbeOf(t, solution.volts) - BJT_VBE;
            if (over > 1e-9) consider(over, () => mode.set(t.id, "active"));
          } else if (md === "active") {
            const under = BJT_VCE_SAT - vceOf(t, solution.volts);
            if (under > 1e-9) consider(under, () => mode.set(t.id, "sat"));
          } else {
            const ic = solution.current.get(`${t.id}:c`);
            const ib = solution.current.get(`${t.id}:b`);
            const excess = ic - t.beta * ib;
            if (excess > 1e-9 * (1 + Math.abs(ic))) consider(excess, () => mode.set(t.id, "active"));
            // A saturated transistor can't carry its collector current backwards: that would be the inverse region this model
            // doesn't have, so the flip to active is allowed to chase its tail until the iteration cap declines the network.
            else if (ic < -1e-9 * (1 + Math.abs(ib))) consider(-ic, () => mode.set(t.id, "active"));
          }
        });
      }
      if (!worst) {
        solution.on = on;
        solution.mode = mode;
        // Nine significant digits hide the solver's own rounding noise (6.000000001) without losing anything a display shows.
        const tidy = (v) => (v === 0 ? 0 : Number(v.toPrecision(9)));
        solution.volts.forEach((v, k) => solution.volts.set(k, tidy(v)));
        solution.current.forEach((v, k) => solution.current.set(k, tidy(v)));
        return solution;
      }
      worst();
    }
    return { ok: false, reason: "diodes" };

    function solveWith() {
      // Everything that carries a current of its own: sources, ammeter links, conducting diodes and transistor junctions.
      const branches = [];
      elements.forEach((e) => {
        if (e.kind === "src") branches.push({ id: e.id, a: e.a, b: e.b, v: e.v, r: 0 });
        else if (e.kind === "link") branches.push({ id: e.id, a: e.a, b: e.b, v: 0, r: 0 });
        else if (e.kind === "diode" && on.get(e.id)) branches.push({ id: e.id, a: e.a, b: e.b, v: e.vf, r: DIODE_ON_OHMS });
        else if (e.kind === "bjt" && mode.get(e.id) !== "off") {
          // The junction: base to emitter for an NPN, emitter to base for a PNP (the branch current is the base current).
          branches.push({ id: `${e.id}:be`, a: e.pnp ? e.b : e.base, b: e.pnp ? e.base : e.b, v: BJT_VBE, r: DIODE_ON_OHMS, bjt: mode.get(e.id) === "active" ? e : null });
          if (mode.get(e.id) === "sat") branches.push({ id: `${e.id}:ce`, a: e.pnp ? e.b : e.a, b: e.pnp ? e.a : e.b, v: BJT_VCE_SAT, r: 0 });
        }
      });
      const n = free.length;
      const size = n + branches.length;
      const m = Array.from({ length: size }, () => new Float64Array(size + 1));
      const add = (r, c, v) => {
        if (r >= 0 && c >= 0) m[r][c] += v;
      };
      for (let i = 0; i < n; i++) m[i][i] += GMIN;
      elements.forEach((e) => {
        if (e.kind !== "res") return;
        const g = 1 / e.r;
        const ia = nodeIdx(e.a);
        const ib = nodeIdx(e.b);
        add(ia, ia, g);
        add(ib, ib, g);
        add(ia, ib, -g);
        add(ib, ia, -g);
      });
      branches.forEach((e, k) => {
        const row = n + k;
        const ia = nodeIdx(e.a);
        const ib = nodeIdx(e.b);
        // The branch current leaves node a and enters node b.
        add(ia, row, 1);
        add(ib, row, -1);
        // Va - Vb - r*I = E
        add(row, ia, 1);
        add(row, ib, -1);
        m[row][row] -= e.r;
        m[row][size] = e.v;
        // An active transistor also pulls gain times that base current from collector to emitter (emitter to collector for a PNP).
        if (e.bjt) {
          add(nodeIdx(e.bjt.pnp ? e.bjt.b : e.bjt.a), row, e.bjt.beta);
          add(nodeIdx(e.bjt.pnp ? e.bjt.a : e.bjt.b), row, -e.bjt.beta);
        }
      });
      // Gaussian elimination with partial pivoting.
      let scale = 0;
      for (let i = 0; i < size; i++) scale = Math.max(scale, Math.abs(m[i][i]));
      for (let col = 0; col < size; col++) {
        let pivot = col;
        for (let row = col + 1; row < size; row++) if (Math.abs(m[row][col]) > Math.abs(m[pivot][col])) pivot = row;
        if (Math.abs(m[pivot][col]) < 1e-14 * Math.max(1, scale)) return { ok: false, reason: "singular" };
        if (pivot !== col) {
          const swap = m[col];
          m[col] = m[pivot];
          m[pivot] = swap;
        }
        for (let row = col + 1; row < size; row++) {
          const f = m[row][col] / m[col][col];
          if (!f) continue;
          for (let k = col; k <= size; k++) m[row][k] -= f * m[col][k];
        }
      }
      const x = new Float64Array(size);
      for (let row = size - 1; row >= 0; row--) {
        let sum = m[row][size];
        for (let k = row + 1; k < size; k++) sum -= m[row][k] * x[k];
        x[row] = sum / m[row][row];
      }
      if (!x.every(Number.isFinite)) return { ok: false, reason: "singular" };
      const volts = new Map();
      nodes.forEach((node) => volts.set(node, index.has(node) ? x[index.get(node)] : 0));
      const current = new Map();
      elements.forEach((e) => {
        if (e.kind === "res") current.set(e.id, (volts.get(e.a) - volts.get(e.b)) / e.r);
        else if (e.kind === "diode" && !on.get(e.id)) current.set(e.id, 0);
        else if (e.kind === "bjt" && mode.get(e.id) === "off") {
          current.set(`${e.id}:b`, 0);
          current.set(`${e.id}:c`, 0);
        }
      });
      branches.forEach((e, k) => current.set(e.id, x[n + k]));
      elements.forEach((e) => {
        if (e.kind !== "bjt" || mode.get(e.id) === "off") return;
        const ib = current.get(`${e.id}:be`);
        current.set(`${e.id}:b`, ib);
        current.set(`${e.id}:c`, mode.get(e.id) === "active" ? e.beta * ib : current.get(`${e.id}:ce`));
      });
      return { ok: true, volts, current };
    }
  }

  // ---- building the network from a circuit ------------------------------------------------------------------------
  // env supplies what only the caller knows: getDef(comp), nodeId(comp, pin), isSwitchClosed(comp), spdtThrow(comp),
  // validWire(wire), inductorOhms(comp), forwardVoltage(comp) (LEDs/diodes), supplyActive(comp) (power supplies),
  // limits { ledMa, diodeMa, resistorWatts, teensyWatts, teensyOhms }.
  // engageNodes: nodes (raw node ids) of the networks the caller wants solved. Returns null when nothing was solved,
  // else { results, covered: Set of raw node ids that were solved, nodeVolts(rawNode) -> volts | undefined }.
  function analyze(data, env, engageNodes) {
    const components = (data && data.components) || [];
    const wires = (data && data.wires) || [];
    const parent = new Map();
    const find = (x) => {
      if (!parent.has(x)) parent.set(x, x);
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r);
      let cur = x;
      while (parent.get(cur) !== r) {
        const next = parent.get(cur);
        parent.set(cur, r);
        cur = next;
      }
      return r;
    };
    const join = (a, b) => {
      const ra = find(a);
      const rb = find(b);
      if (ra !== rb) parent.set(ra, rb);
    };
    const byId = new Map(components.map((c) => [c.id, c]));
    components.forEach((c) => {
      const def = env.getDef(c);
      if (!def) return;
      def.pins.forEach((p) => find(env.nodeId(c, p.id)));
      if (c.type === "switch") {
        if (env.isSwitchClosed(c)) join(env.nodeId(c, "p1"), env.nodeId(c, "p2"));
      } else if (c.type === "switch_spdt") join(env.nodeId(c, "com"), env.nodeId(c, env.spdtThrow(c)));
    });
    wires.forEach((w) => {
      if (!env.validWire(w)) return;
      const from = byId.get(w.from.compId);
      const to = byId.get(w.to.compId);
      if (from && to) join(env.nodeId(from, w.from.pin), env.nodeId(to, w.to.pin));
    });

    const elements = [];
    const meta = new Map(); // element id -> { comp, kind }
    const outletGroups = new Set();
    let supplyVoltage = 0;
    const node = (c, pin) => find(env.nodeId(c, pin));
    components.forEach((c) => {
      const def = env.getDef(c);
      if (!def) return;
      const resistor = (a, b, r) => {
        elements.push({ kind: "res", id: c.id, a, b, r });
        meta.set(c.id, { comp: c, kind: "res", r });
      };
      if (c.type === "battery") {
        const v = Number(c.voltage) || 9;
        const rInt = Math.max(0, Number(c.internalResistance) || 0);
        const pos = node(c, "pos");
        const neg = node(c, "neg");
        supplyVoltage = Math.max(supplyVoltage, v);
        if (rInt > 0) {
          const mid = `${c.id}:internal`;
          elements.push({ kind: "src", id: `src:${c.id}`, a: mid, b: neg, v });
          elements.push({ kind: "res", id: `int:${c.id}`, a: pos, b: mid, r: rInt });
        } else elements.push({ kind: "src", id: `src:${c.id}`, a: pos, b: neg, v });
      } else if (c.type === "outlet") {
        outletGroups.add(node(c, "hot"));
        outletGroups.add(node(c, "neutral"));
      } else if (c.type === "power_supply") {
        if (env.supplyActive(c)) {
          const v = Number(c.outputVoltage) || 5;
          supplyVoltage = Math.max(supplyVoltage, v);
          elements.push({ kind: "src", id: `src:${c.id}`, a: node(c, "out_pos"), b: node(c, "out_neg"), v });
        }
      } else if (c.type === "resistor") {
        resistor(node(c, "p1"), node(c, "p2"), Math.max(1, Number(c.resistance) || 220));
      } else if (c.type === "potentiometer") {
        const maxR = Math.max(1, Number(c.maxResistance) || 10000);
        const rawWiper = Number(c.wiper);
        const pct = Math.max(0, Math.min(100, Number.isFinite(rawWiper) ? rawWiper : 50));
        resistor(node(c, "p1"), node(c, "p2"), Math.max(1, Math.round(maxR * (pct / 100))));
      } else if (c.type === "inductor") {
        resistor(node(c, "p1"), node(c, "p2"), env.inductorOhms(c));
      } else if (c.type === "mcu_teensy") {
        resistor(node(c, "vin"), node(c, "gnd"), env.limits.teensyOhms);
      } else if (c.type === "ammeter") {
        // An ammeter with a wire across its terminals is shorted out: its current can't be told, so it gets no result.
        if (node(c, "p1") !== node(c, "p2")) {
          elements.push({ kind: "link", id: c.id, a: node(c, "p1"), b: node(c, "p2") });
          meta.set(c.id, { comp: c, kind: "link" });
        }
      } else if (c.type === "transistor") {
        // A transistor with its collector and emitter wired together does nothing the solver can model.
        const collector = node(c, "collector");
        const emitter = node(c, "emitter");
        if (collector !== emitter) {
          const gain = Math.min(BJT_MAX_GAIN, Math.max(1, Number(c.gain) || BJT_DEFAULT_GAIN));
          elements.push({ kind: "bjt", id: c.id, a: collector, b: emitter, base: node(c, "base"), beta: gain, pnp: c.polarity === "pnp" });
          meta.set(c.id, { comp: c, kind: "bjt" });
        }
      } else if ((c.type === "led" || c.type === "diode") && def.polarity) {
        // Likewise a diode or LED shorted by a wire.
        if (node(c, def.polarity.pos) !== node(c, def.polarity.neg)) {
          elements.push({ kind: "diode", id: c.id, a: node(c, def.polarity.pos), b: node(c, def.polarity.neg), vf: env.forwardVoltage(c) });
          meta.set(c.id, { comp: c, kind: "diode" });
        }
      }
    });

    // A transistor whose base is wired to nothing else stays off (the unconnected node would otherwise sit at the reference voltage).
    elements.forEach((e) => {
      if (e.kind !== "bjt") return;
      e.forceOff = !elements.some((o) => o !== e && (o.a === e.base || o.b === e.base || (o.kind === "bjt" && o.base === e.base)));
    });

    // Networks (connected through any element) that hold a source, no outlet, and one of the nodes the caller engaged.
    const adj = new Map();
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };
    elements.forEach((e) => {
      link(e.a, e.b);
      if (e.kind === "bjt") {
        link(e.base, e.a);
        link(e.base, e.b);
      }
    });
    const wanted = new Set();
    (engageNodes || []).forEach((n) => wanted.add(find(n)));
    const seen = new Set();
    const results = {};
    const covered = new Set();
    const clear = new Set(); // components inside a solved network: their one-path results are stale
    const voltsByGroup = new Map();
    const islandByGroup = new Map();
    const rawNodesByGroup = new Map();
    parent.forEach((_, raw) => {
      const g = find(raw);
      if (!rawNodesByGroup.has(g)) rawNodesByGroup.set(g, []);
      rawNodesByGroup.get(g).push(raw);
    });
    let solvedAny = false;
    const declines = []; // why a network was left alone (kept for tests)
    root.SimSolver.lastDeclines = declines;
    wanted.forEach((start) => {
      if (seen.has(start) || !adj.has(start)) return;
      const network = new Set([start]);
      const queue = [start];
      while (queue.length) {
        const cur = queue.shift();
        for (const n of adj.get(cur) || []) {
          if (!network.has(n)) {
            network.add(n);
            queue.push(n);
          }
        }
      }
      network.forEach((n) => seen.add(n));
      if ([...network].some((n) => outletGroups.has(n))) return declines.push("outlet");
      const mine = elements.filter((e) => network.has(e.a));
      if (!mine.some((e) => e.kind === "src")) return declines.push("nosource");
      // A source with both terminals on one node is a dead short, which this solver does not model.
      if (mine.some((e) => e.kind === "src" && e.a === e.b)) return declines.push("short");
      const solved = solveNetwork(mine);
      if (!solved.ok) return declines.push(solved.reason);
      solvedAny = true;
      // Only nodes with a conducting path to a source have a meaningful voltage; a node joined to the network only through
      // an "off" diode is left floating (the solver puts it at an arbitrary value), so meters on it say nothing. An island
      // that carries its own source is fine on its own, but its voltage relative to another island is just as arbitrary, so
      // each conducting island gets a label and a voltmeter only reads between two nodes of the same one.
      const islandOf = new Map();
      {
        const reachAdj = new Map();
        const connect = (a, b) => {
          if (!reachAdj.has(a)) reachAdj.set(a, []);
          if (!reachAdj.has(b)) reachAdj.set(b, []);
          reachAdj.get(a).push(b);
          reachAdj.get(b).push(a);
        };
        mine.forEach((e) => {
          if (e.kind === "bjt") {
            const md = solved.mode.get(e.id);
            if (md !== "off") {
              connect(e.a, e.b);
              connect(e.base, e.b);
            }
          } else if (e.kind !== "diode" || solved.on.get(e.id)) connect(e.a, e.b);
        });
        let label = 0;
        mine
          .filter((e) => e.kind === "src")
          .flatMap((e) => [e.a, e.b])
          .forEach((seed) => {
            if (islandOf.has(seed)) return;
            label++;
            islandOf.set(seed, `${start}#${label}`);
            const queue = [seed];
            while (queue.length) {
              const cur = queue.shift();
              for (const n of reachAdj.get(cur) || []) {
                if (!islandOf.has(n)) {
                  islandOf.set(n, `${start}#${label}`);
                  queue.push(n);
                }
              }
            }
          });
      }
      network.forEach((g) => {
        if (islandOf.has(g)) {
          voltsByGroup.set(g, solved.volts.get(g));
          islandByGroup.set(g, islandOf.get(g));
        }
        (rawNodesByGroup.get(g) || []).forEach((raw) => covered.add(raw));
      });
      components.forEach((c) => {
        const def = env.getDef(c);
        if (def && def.pins.some((p) => network.has(find(env.nodeId(c, p.id))))) clear.add(c.id);
      });
      // Turn the solution into part results.
      const degree = (g) => (adj.get(g) ? adj.get(g).size : 0);
      mine.forEach((e) => {
        const info = meta.get(e.id);
        if (!info) return;
        const c = info.comp;
        const i = solved.current.get(e.id);
        const L = env.limits;
        if (e.kind === "bjt") {
          let region = solved.mode.get(e.id);
          let ib = solved.current.get(`${e.id}:b`);
          let ic = solved.current.get(`${e.id}:c`);
          // A base current under a nanoamp is the solver's own leakage, not a transistor that is on.
          if (region !== "off" && ib < 1e-9) {
            region = "off";
            ib = 0;
            ic = 0;
          }
          const sign = e.pnp ? -1 : 1;
          const vce = sign * (solved.volts.get(e.a) - solved.volts.get(e.b));
          const vbe = sign * (solved.volts.get(e.base) - solved.volts.get(e.b));
          const watts = Math.max(0, vce) * Math.max(0, ic) + BJT_VBE * Math.max(0, ib);
          const icMa = ic * 1000;
          const ibMa = ib * 1000;
          const ratedMa = L.transistorMa || 200;
          const ratedBaseMa = L.transistorBaseMa || 50;
          let status = region === "sat" ? "saturated" : region;
          if (icMa > ratedMa * 3 || ibMa > ratedBaseMa * 3) status = "burnt";
          else if (icMa > ratedMa * 1.5 || ibMa > ratedBaseMa * 1.5) status = "overdriven";
          else if (watts > (L.transistorWatts || 0.625)) status = "overheating";
          results[c.id] = { kind: "transistor", region: region === "sat" ? "saturated" : region, polarity: e.pnp ? "pnp" : "npn", currentMa: icMa, baseMa: ibMa, vce, vbe, watts, status, dangerous: false };
        } else if (e.kind === "res") {
          const amps = Math.abs(i);
          if (c.type === "mcu_teensy") {
            const watts = amps * amps * e.r;
            results[c.id] = { kind: "teensy", currentMa: amps * 1000, voltage: Math.abs(solved.volts.get(e.a) - solved.volts.get(e.b)), watts, status: watts > L.teensyWatts ? "overheating" : "normal", dangerous: false };
          } else {
            const watts = amps * amps * e.r;
            results[c.id] = { kind: "resistor", currentMa: amps * 1000, watts, status: watts > L.resistorWatts ? "overheating" : "normal", dangerous: false };
          }
        } else if (e.kind === "link") {
          results[c.id] = { kind: "ammeter", currentMa: Math.abs(i) * 1000, status: "normal", dangerous: false };
        } else if (e.kind === "diode") {
          // "On" with a few femtoamps (only the solver's own leakage reaches it, as with an LED in series with an open transistor)
          // is not conducting in any sense a person would mean: nothing to say about it.
          const wasOn = solved.on.get(e.id);
          const conducting = wasOn && i > 1e-7;
          const ma = conducting ? Math.max(0, i) * 1000 : 0;
          const vd = solved.volts.get(e.a) - solved.volts.get(e.b);
          const isDiode = c.type === "diode";
          const rated = isDiode ? L.diodeMa : L.ledMa;
          let status;
          if (conducting) {
            if (ma > rated * 3) status = "burnt";
            else if (ma > rated * 1.5) status = "overdriven";
            else if (!isDiode && ma < 1) status = "dim";
            else status = "normal";
          } else if (vd < -0.1) status = "reversed";
          else if (degree(e.a) <= 1 || degree(e.b) <= 1) status = null; // dangling: nothing to say
          else if (wasOn || vd < 0.1) status = "idle"; // joined into a live loop but carrying (next to) nothing, with no voltage across it: it must not glow
          else status = isDiode ? "off" : "unlit-low-voltage"; // forward biased (or nearly) but below its drop
          if (status) results[c.id] = { kind: isDiode ? "diode" : "led", currentMa: ma, voltage: supplyVoltage, status, dangerous: false };
        }
      });
    });
    if (!solvedAny) return null;
    // Voltmeters whose probes are both in a solved network read the difference of the two node voltages.
    components.forEach((c) => {
      if (c.type !== "voltmeter") return;
      const pos = find(env.nodeId(c, "pos"));
      const neg = find(env.nodeId(c, "neg"));
      if (!voltsByGroup.has(pos) || !voltsByGroup.has(neg) || islandByGroup.get(pos) !== islandByGroup.get(neg)) return;
      const volts = voltsByGroup.get(pos) - voltsByGroup.get(neg);
      if (Number.isFinite(volts)) results[c.id] = { kind: "voltmeter", volts: Math.abs(volts) < 1e-9 ? 0 : volts, status: "normal", reason: null, dangerous: false };
    });
    return { results, covered, clear, nodeVolts: (raw) => voltsByGroup.get(find(raw)) };
  }

  root.SimSolver = { analyze, solveNetwork, MAX_NODES, lastDeclines: [] };
})(typeof window !== "undefined" ? window : globalThis);
