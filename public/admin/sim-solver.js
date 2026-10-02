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
//   - capacitors, voltmeters, ohmmeters, TVs and gates draw no current.
// It declines (returns nothing for that network) rather than guess: a wall outlet in the network (mains is handled by
// the one-path solver's "dangerous" rules), a dead short or two sources that contradict each other, a network over
// MAX_NODES, or diodes that never settle. The caller then keeps the one-path figures and its warning.
(function (root) {
  "use strict";

  const MAX_NODES = 200;
  const GMIN = 1e-12; // keeps a node that only an "off" diode touches from making the matrix singular
  const DIODE_ON_OHMS = 0.001; // a conducting diode's small series resistance: splits current between parallel diodes

  // ---- the linear solve --------------------------------------------------------------------------------------------
  // Elements (node names are strings; "ref" nodes are chosen here, one per connected network):
  //   { kind: "res", id, a, b, r }            resistor, r > 0
  //   { kind: "src", id, a, b, v }            ideal source, + at a, - at b
  //   { kind: "link", id, a, b }              zero-volt link (ammeter): a current to report, no voltage
  //   { kind: "diode", id, a, b, vf }         anode a, cathode b
  // Returns { ok, reason, volts: Map(node -> V), current: Map(id -> A flowing a to b through the element), on: Map(id -> bool) }.
  function solveNetwork(elements) {
    const nodes = new Set();
    elements.forEach((e) => {
      nodes.add(e.a);
      nodes.add(e.b);
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
    const on = new Map(diodes.map((d) => [d.id, false]));
    const maxIterations = 4 * diodes.length + 10;
    let solution = null;
    for (let iteration = 0; iteration <= maxIterations; iteration++) {
      solution = solveWith(on);
      if (!solution.ok) return solution;
      // Look for the diode whose state is most wrong: an "on" diode carrying current backwards goes off first; otherwise an
      // "off" diode forward biased past its drop goes on.
      let worst = null;
      let worstAmount = 0;
      diodes.forEach((d) => {
        if (!on.get(d.id)) return;
        const i = solution.current.get(d.id);
        if (i < -1e-12 && -i > worstAmount) {
          worst = d;
          worstAmount = -i;
        }
      });
      if (!worst) {
        diodes.forEach((d) => {
          if (on.get(d.id)) return;
          const over = solution.volts.get(d.a) - solution.volts.get(d.b) - d.vf;
          if (over > 1e-9 && over > worstAmount) {
            worst = d;
            worstAmount = over;
          }
        });
      }
      if (!worst) {
        solution.on = on;
        // Nine significant digits hide the solver's own rounding noise (6.000000001) without losing anything a display shows.
        const tidy = (v) => (v === 0 ? 0 : Number(v.toPrecision(9)));
        solution.volts.forEach((v, k) => solution.volts.set(k, tidy(v)));
        solution.current.forEach((v, k) => solution.current.set(k, tidy(v)));
        return solution;
      }
      on.set(worst.id, !on.get(worst.id));
    }
    return { ok: false, reason: "diodes" };

    function solveWith(state) {
      const branches = elements.filter((e) => e.kind === "src" || e.kind === "link" || (e.kind === "diode" && state.get(e.id)));
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
        if (e.kind === "diode") {
          m[row][row] -= DIODE_ON_OHMS;
          m[row][size] = e.vf;
        } else if (e.kind === "src") m[row][size] = e.v;
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
        else if (e.kind === "diode" && !state.get(e.id)) current.set(e.id, 0);
      });
      branches.forEach((e, k) => current.set(e.id, x[n + k]));
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
      } else if ((c.type === "led" || c.type === "diode") && def.polarity) {
        // Likewise a diode or LED shorted by a wire.
        if (node(c, def.polarity.pos) !== node(c, def.polarity.neg)) {
          elements.push({ kind: "diode", id: c.id, a: node(c, def.polarity.pos), b: node(c, def.polarity.neg), vf: env.forwardVoltage(c) });
          meta.set(c.id, { comp: c, kind: "diode" });
        }
      }
    });

    // Networks (connected through any element) that hold a source, no outlet, and one of the nodes the caller engaged.
    const adj = new Map();
    const link = (a, b) => {
      if (!adj.has(a)) adj.set(a, new Set());
      if (!adj.has(b)) adj.set(b, new Set());
      adj.get(a).add(b);
      adj.get(b).add(a);
    };
    elements.forEach((e) => link(e.a, e.b));
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
          if (e.kind !== "diode" || solved.on.get(e.id)) connect(e.a, e.b);
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
        if (e.kind === "res") {
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
          const conducting = solved.on.get(e.id);
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
