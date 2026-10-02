// Parameter sweep for the simulation builder: change one setting of one part across a range (a resistor from 100 Ω to 10 kΩ, a battery
// from 1 V to 12 V, a potentiometer's wiper from 0 to 100 %), solve the circuit at each step with the builder's own analysis, and
// chart one reading. Everything here is pure (no DOM): the builder's dialog calls it, and a node test loads it with the analysis code.
(function () {
  const MAX_STEPS = 101;
  const MIN_STEPS = 2;

  // What can be swept. `min`/`max` are the limits the analysis itself honours (a value outside them would be silently replaced).
  const PARAMS = {
    resistor: [{ key: "resistance", label: "resistance", unit: "Ω", min: 1, max: 10000000, scales: ["log", "linear"], fallback: 220 }],
    potentiometer: [{ key: "wiper", label: "wiper position", unit: "%", min: 0, max: 100, scales: ["linear"], fallback: 50 }],
    battery: [
      { key: "voltage", label: "voltage", unit: "V", min: 0.1, max: 1000, scales: ["linear", "log"], fallback: 9 },
      { key: "internalResistance", label: "internal resistance", unit: "Ω", min: 0, max: 100000, scales: ["linear"], fallback: 0 },
    ],
    power_supply: [{ key: "outputVoltage", label: "output voltage", unit: "V", min: 0.1, max: 1000, scales: ["linear", "log"], fallback: 5 }],
  };

  // What can be watched on a part: the figures the analysis reports for it.
  const READINGS = {
    resistor: [["currentMa", "current", "mA"], ["watts", "power", "W"]],
    potentiometer: [["currentMa", "current", "mA"], ["watts", "power", "W"]],
    inductor: [["currentMa", "current", "mA"], ["watts", "power", "W"]],
    led: [["currentMa", "current", "mA"]],
    diode: [["currentMa", "current", "mA"]],
    ammeter: [["currentMa", "current", "mA"]],
    voltmeter: [["volts", "reading", "V"]],
    ohmmeter: [["ohms", "reading", "Ω"]],
    transistor: [["currentMa", "collector current", "mA"], ["baseMa", "base current", "mA"], ["vce", "collector-emitter voltage", "V"], ["watts", "power", "W"]],
    teensy: [["currentMa", "current", "mA"], ["watts", "power", "W"]],
  };

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const sig = (v) => Number(Number(v).toPrecision(6));

  function paramFor(type, key) {
    return (PARAMS[type] || []).find((p) => p.key === key) || null;
  }

  // The value a part has now for one of its sweepable settings (with the same fallbacks the analysis applies).
  function currentValue(comp, param) {
    const raw = Number(comp && comp[param.key]);
    if (param.key === "wiper") return Math.max(0, Math.min(100, Number.isFinite(raw) ? raw : param.fallback));
    if (param.key === "internalResistance") return Math.max(0, raw || 0);
    const value = raw || param.fallback;
    return Math.max(param.min, Math.min(param.max, value));
  }

  // A starting range around the current value: a tenth to ten times for a log scale, otherwise up to twice (a wiper and a voltage start at their ends).
  function defaultRange(comp, param, scale) {
    const cur = currentValue(comp, param);
    if (param.key === "wiper") return { from: 0, to: 100 };
    if (param.key === "internalResistance") return { from: 0, to: sig(Math.max(10, cur * 2)) };
    if (scale === "log") return { from: sig(Math.max(param.min, cur / 10)), to: sig(Math.min(param.max, cur * 10)) };
    return { from: sig(Math.max(param.min, cur / 2)), to: sig(Math.min(param.max, Math.max(cur * 2, param.min * 2))) };
  }

  // Every setting that can be swept in this circuit: [{ compId, comp, param }].
  function sweepable(data) {
    const out = [];
    for (const comp of (data && data.components) || []) {
      for (const param of PARAMS[comp.type] || []) out.push({ compId: comp.id, comp, param });
    }
    return out;
  }

  // Clamp and order a request; returns { spec } with clean numbers, or { error } in plain words.
  function normalize(spec, param) {
    let from = Number(spec.from);
    let to = Number(spec.to);
    if (!Number.isFinite(from) || !Number.isFinite(to)) return { error: "Enter a start and an end value." };
    if (from > to) [from, to] = [to, from];
    if (from < param.min || to > param.max) {
      return { error: `${cap(param.label)} can go from ${fmtNum(param.min)} to ${fmtNum(param.max)} ${param.unit}.` };
    }
    if (from === to) return { error: "The start and end values are the same, so there is nothing to sweep." };
    const scale = param.scales.includes(spec.scale) ? spec.scale : param.scales[0];
    if (scale === "log" && from <= 0) return { error: "A logarithmic scale needs a start above zero." };
    const steps = Math.max(MIN_STEPS, Math.min(MAX_STEPS, Math.round(Number(spec.steps) || 21)));
    return { spec: { from, to, steps, scale } };
  }

  function values(spec) {
    const out = [];
    const { from, to, steps, scale } = spec;
    for (let i = 0; i < steps; i++) {
      const t = i / (steps - 1);
      out.push(sig(scale === "log" ? from * Math.pow(to / from, t) : from + (to - from) * t));
    }
    out[0] = from;
    out[steps - 1] = to;
    return out;
  }

  function cap(s) {
    return s ? s[0].toUpperCase() + s.slice(1) : s;
  }

  function fmtNum(v) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    const a = Math.abs(v);
    if (a !== 0 && (a >= 1e6 || a < 0.001)) return String(Number(v.toPrecision(3)));
    return String(Number(v.toPrecision(a >= 100 ? 4 : 3)));
  }

  // "4.7 kΩ", "12.3 mA", "3.30 V": the figure with its unit.
  function formatValue(v, unit) {
    if (v === null || v === undefined || !Number.isFinite(v)) return "—";
    if (unit === "Ω") return typeof window !== "undefined" && window.simFormatOhms ? window.simFormatOhms(v) : `${fmtNum(v)} Ω`;
    if (unit === "V") return Math.abs(v) < 1e-9 ? "0 V" : `${fmtNum(v)} V`;
    if (unit === "%") return `${fmtNum(v)}%`;
    return `${fmtNum(v)} ${unit}`;
  }

  // The things a person can watch, given names for the parts: [{ key, label, group, kind, compId, field|pin, unit }].
  // `names` maps a part id to its name; `pinName(comp, pinId)` words a pin. Breadboard holes are left out (hundreds of them).
  function watchOptions(data, names, pinName) {
    const out = [];
    const comps = (data && data.components) || [];
    const wired = new Set();
    for (const w of (data && data.wires) || []) {
      if (w.from) wired.add(`${w.from.compId}|${w.from.pin}`);
      if (w.to) wired.add(`${w.to.compId}|${w.to.pin}`);
    }
    for (const c of comps) {
      for (const [field, what, unit] of READINGS[c.type] || []) {
        out.push({ key: `r:${c.id}:${field}`, group: "Readings", label: `${names.get(c.id) || c.type}: ${what}`, phrase: `${what} of ${names.get(c.id) || c.type}`, kind: "reading", compId: c.id, field, unit, what });
      }
    }
    for (const c of comps) {
      if (c.type === "breadboard") continue;
      const def = typeof window !== "undefined" && window.getSimComponentDefinition ? window.getSimComponentDefinition(c) : null;
      for (const pin of (def && def.pins) || []) {
        if (!wired.has(`${c.id}|${pin.id}`)) continue;
        const pinText = pinName ? pinName(c, pin.id) : pin.id;
        out.push({ key: `p:${c.id}:${pin.id}`, group: "Voltage at a pin", label: `${names.get(c.id) || c.type}, ${pinText}`, phrase: `voltage at ${names.get(c.id) || c.type}, ${pinText}`, kind: "pin", compId: c.id, pin: pin.id, unit: "V", what: "voltage" });
      }
    }
    return out;
  }

  function readWatch(results, watch, comp) {
    if (watch.kind === "pin") return num(results.nodeVoltage(window.simNodeId(comp, watch.pin)));
    const r = results[watch.compId];
    if (!r || r.status === "no-reading") return null;
    return num(r[watch.field]); // Infinity (a dead short) is not a figure to plot
  }

  // Solve the circuit at each value. Returns { values, ys, current, ... } where ys[i] is null where there is no reading.
  function run(data, request) {
    const target = ((data && data.components) || []).find((c) => c.id === request.compId);
    const param = target && paramFor(target.type, request.paramKey);
    if (!param) return { error: "Pick a part and a setting to sweep." };
    const checked = normalize(request, param);
    if (checked.error) return checked;
    const watch = request.watch;
    if (!watch) return { error: "Pick something to watch." };
    const watchComp = ((data && data.components) || []).find((c) => c.id === watch.compId);
    if (!watchComp) return { error: "The part being watched is no longer in the circuit." };
    const xs = values(checked.spec);
    const ys = xs.map((x) => {
      const trial = { ...data, components: data.components.map((c) => (c === target ? { ...c, [param.key]: x } : c)) };
      try {
        return readWatch(window.computeSimElectricalAnalysis(trial, { voltages: watch.kind === "pin" }), watch, watchComp);
      } catch {
        return null;
      }
    });
    const cur = currentValue(target, param);
    let now = null;
    try {
      now = readWatch(window.computeSimElectricalAnalysis(data, { voltages: watch.kind === "pin" }), watch, watchComp);
    } catch {
      now = null;
    }
    return { ...checked.spec, xs, ys, param, watch, current: cur, now, targetId: target.id };
  }

  // ---- text results ----

  function describe(result, names, watchLabel) {
    const { xs, ys, param } = result;
    const known = ys.map((y, i) => [xs[i], y]).filter(([, y]) => y !== null);
    const target = names.get(result.targetId) || "the part";
    const head = `${cap(watchLabel)} as the ${param.label} of ${target} goes from ${formatValue(xs[0], param.unit)} to ${formatValue(xs[xs.length - 1], param.unit)}`;
    if (!known.length) return `${head}: no reading at any of the ${xs.length} values (the circuit is not complete or not powered).`;
    const lo = known.reduce((a, b) => (b[1] < a[1] ? b : a));
    const hi = known.reduce((a, b) => (b[1] > a[1] ? b : a));
    const unit = result.watch.unit;
    const missing = xs.length - known.length;
    let text = `${head}: from ${formatValue(known[0][1], unit)} to ${formatValue(known[known.length - 1][1], unit)}`;
    text += lo[1] === hi[1] ? " (no change)" : `, lowest ${formatValue(lo[1], unit)} at ${formatValue(lo[0], param.unit)}, highest ${formatValue(hi[1], unit)} at ${formatValue(hi[0], param.unit)}`;
    if (missing) text += `; no reading at ${missing} of ${xs.length} values`;
    if (result.now !== null && result.current >= xs[0] && result.current <= xs[xs.length - 1]) text += `. As built (${formatValue(result.current, param.unit)}) it is ${formatValue(result.now, unit)}`;
    return `${text}.`;
  }

  // A spreadsheet treats a cell starting with = + - @ as a formula, so a typed label can't open with one; quote what needs it.
  function csvCell(v) {
    let s = String(v == null ? "" : v).replace(/[\u0000-\u001f\u007f]/g, " ");
    if (/^[=+\-@]/.test(s)) s = `'${s}`;
    return /[",]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }

  function csv(result, names, watchLabel) {
    const { xs, ys, param, watch } = result;
    const xName = `${cap(param.label)} of ${names.get(result.targetId) || "part"} (${param.unit})`;
    const yName = `${cap(watchLabel)} (${watch.unit})`;
    const rows = [[xName, yName].map(csvCell).join(",")];
    xs.forEach((x, i) => rows.push(`${x},${ys[i] === null ? "" : sig(ys[i])}`));
    return rows.join("\n");
  }

  // ---- chart ----

  function niceStep(span, count) {
    const raw = span / Math.max(1, count);
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const f = raw / pow;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * pow;
  }

  function linearTicks(min, max, count) {
    const step = niceStep(max - min, count);
    const ticks = [];
    for (let v = Math.ceil(min / step - 1e-9) * step; v <= max + step * 1e-9; v += step) ticks.push(Number(v.toPrecision(12)));
    return ticks;
  }

  function logTicks(min, max) {
    const ticks = [];
    const lo = Math.floor(Math.log10(min));
    const hi = Math.ceil(Math.log10(max));
    const mults = hi - lo <= 2 ? [1, 2, 5] : [1];
    for (let p = lo; p <= hi; p++) for (const m of mults) {
      const v = m * Math.pow(10, p);
      if (v >= min * (1 - 1e-9) && v <= max * (1 + 1e-9)) ticks.push(Number(v.toPrecision(12)));
    }
    return ticks;
  }

  const esc = (s) => String(s).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));

  // The chart as an SVG string: a line through the readings (broken where there is none), dots with hover text, the "as built" setting
  // marked. The line and axes take their colours from the stylesheet (classes sweep-*), so it follows the admin theme.
  function chartSvg(result, names, watchLabel, options = {}) {
    // `compact` draws for a narrow screen: a squarer picture, so the text is not shrunk to nothing when it is scaled to the width.
    const W = options.compact ? 360 : 640, H = options.compact ? 300 : 320, L = options.compact ? 52 : 64, R = 14, T = 16, B = 44;
    const { xs, ys, param, watch, scale } = result;
    const known = ys.filter((y) => y !== null);
    const x0 = xs[0], x1 = xs[xs.length - 1];
    const px = (x) => L + ((scale === "log" ? Math.log(x / x0) / Math.log(x1 / x0) : (x - x0) / (x1 - x0)) * (W - L - R));
    let yMin = known.length ? Math.min(0, ...known) : 0;
    let yMax = known.length ? Math.max(0, ...known) : 1;
    if (yMax === yMin) yMax = yMin + 1;
    const pad = (yMax - yMin) * 0.06;
    if (yMax > 0) yMax += pad;
    if (yMin < 0) yMin -= pad;
    const py = (y) => T + (1 - (y - yMin) / (yMax - yMin)) * (H - T - B);
    const xTicks = scale === "log" ? logTicks(x0, x1) : linearTicks(x0, x1, options.compact ? 4 : 6);
    const yTicks = linearTicks(yMin, yMax, options.compact ? 4 : 5);
    let svg = `<svg class="sweep-chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(describe(result, names, watchLabel))}" focusable="false">`;
    for (const t of yTicks) svg += `<line class="sweep-grid" x1="${L}" x2="${W - R}" y1="${py(t).toFixed(1)}" y2="${py(t).toFixed(1)}"/><text class="sweep-tick" x="${L - 8}" y="${(py(t) + 4).toFixed(1)}" text-anchor="end">${esc(fmtNum(t))}</text>`;
    for (const t of xTicks) svg += `<line class="sweep-grid sweep-grid-x" x1="${px(t).toFixed(1)}" x2="${px(t).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="sweep-tick" x="${px(t).toFixed(1)}" y="${H - B + 16}" text-anchor="middle">${esc(fmtNum(t))}</text>`;
    svg += `<line class="sweep-axis" x1="${L}" x2="${L}" y1="${T}" y2="${H - B}"/><line class="sweep-axis" x1="${L}" x2="${W - R}" y1="${py(0).toFixed(1)}" y2="${py(0).toFixed(1)}"/>`;
    svg += `<text class="sweep-label" x="${(L + W - R) / 2}" y="${H - 6}" text-anchor="middle">${esc(`${cap(param.label)} of ${names.get(result.targetId) || "part"} (${param.unit})`)}</text>`;
    svg += `<text class="sweep-label" transform="translate(14 ${(T + H - B) / 2}) rotate(-90)" text-anchor="middle">${esc(`${cap(watchLabel)} (${watch.unit})`)}</text>`;
    if (result.current >= x0 && result.current <= x1) svg += `<line class="sweep-now" x1="${px(result.current).toFixed(1)}" x2="${px(result.current).toFixed(1)}" y1="${T}" y2="${H - B}"/><text class="sweep-now-text" x="${(px(result.current) + 4).toFixed(1)}" y="${T + 11}">as built</text>`;
    let run = [];
    const flush = () => {
      if (run.length > 1) svg += `<polyline class="sweep-line" fill="none" points="${run.join(" ")}"/>`;
      run = [];
    };
    xs.forEach((x, i) => {
      if (ys[i] === null) return flush();
      run.push(`${px(x).toFixed(1)},${py(ys[i]).toFixed(1)}`);
    });
    flush();
    xs.forEach((x, i) => {
      if (ys[i] === null) return;
      svg += `<circle class="sweep-dot" cx="${px(x).toFixed(1)}" cy="${py(ys[i]).toFixed(1)}" r="${xs.length > 41 ? 2 : 3.5}"><title>${esc(formatValue(x, param.unit))} → ${esc(formatValue(ys[i], watch.unit))}</title></circle>`;
    });
    return `${svg}</svg>`;
  }

  window.SimSweep = { PARAMS, MAX_STEPS, MIN_STEPS, sweepable, paramFor, currentValue, defaultRange, normalize, values, watchOptions, run, describe, csv, chartSvg, formatValue };
})();
