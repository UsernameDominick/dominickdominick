// Editing helpers for the Studio's step sequencer and piano roll: the notes of a roll as spans (a note and the steps tied to it), moving,
// copying, resizing, deleting and re-levelling them, and painting drum steps. Pure (no DOM), so a node test can load it. `notes` is
// { row: [step values...] } where a value is false, true (full strength) or a number below 1 (softer); `ties[row][i] === true` joins step i
// to the same row's step i - 1, so the two play as one held note. Every function returns fresh objects and leaves its input alone.
(function () {
  const clone = (o) => JSON.parse(JSON.stringify(o || {}));
  const on = (v) => v !== false && v != null && v !== 0;
  const tied = (ties, row, i) => Boolean(ties && ties[row] && ties[row][i] === true);

  // A strength: 1 (or above) is stored as true, below it a number between 0.1 and 0.98.
  function level(value) {
    const n = Number(value);
    if (!Number.isFinite(n) || n >= 0.98) return true;
    return Math.round(Math.max(0.1, n) * 100) / 100;
  }
  const strength = (v) => (v === true ? 1 : typeof v === "number" ? v : on(v) ? 1 : 0);

  // Every note of a roll, left to right within each row: { row, start, len }.
  function spans(notes, ties, steps) {
    const out = [];
    Object.keys(notes || {}).forEach((row) => {
      const arr = notes[row] || [];
      for (let i = 0; i < steps; i++) {
        if (!on(arr[i]) || (i > 0 && on(arr[i - 1]) && tied(ties, row, i))) continue;
        let len = 1;
        while (i + len < steps && on(arr[i + len]) && tied(ties, row, i + len)) len++;
        out.push({ row, start: i, len });
        i += len - 1;
      }
    });
    return out;
  }
  // The note that covers a step of a row, or null.
  function spanAt(notes, ties, row, step, steps) {
    return spans(notes, ties, steps).find((s) => s.row === row && step >= s.start && step < s.start + s.len) || null;
  }
  const key = (s) => s.row + ":" + s.start;

  // Take notes out: the steps (and the ties into them) are cleared.
  function remove(notes, ties, list, steps) {
    const n = clone(notes);
    const t = clone(ties);
    list.forEach((s) => {
      for (let i = s.start; i < s.start + s.len && i < steps; i++) {
        if (n[s.row]) n[s.row][i] = false;
        if (t[s.row]) t[s.row][i] = false;
      }
    });
    return { notes: n, ties: t };
  }
  // The notes as they stand, each with the strength of every step it covers.
  function pick(notes, list) {
    return list.map((s) => ({ row: s.row, start: s.start, len: s.len, values: Array.from({ length: s.len }, (_, k) => notes[s.row][s.start + k]) }));
  }
  // Put picked notes down (over whatever is there). A note that would run off the bar is cut; one with no row to land on is dropped.
  function place(notes, ties, items, steps) {
    const n = clone(notes);
    const t = clone(ties);
    const placed = [];
    items.forEach((it) => {
      if (!n[it.row] || it.start < 0 || it.start >= steps) return;
      const len = Math.min(it.len, steps - it.start);
      for (let k = 0; k < len; k++) {
        n[it.row][it.start + k] = it.values[k] === undefined ? true : it.values[k];
        if (!t[it.row]) t[it.row] = new Array(steps).fill(false);
        t[it.row][it.start + k] = k > 0;
      }
      placed.push({ row: it.row, start: it.start, len });
    });
    return { notes: n, ties: t, placed };
  }

  // Move notes (or copy them) by some rows and some steps, all together. The move is cut back so every note stays on the roll and in the
  // bar, so a group keeps its shape. `rowNames` is the roll from the top to the bottom.
  function move(notes, ties, list, dRows, dSteps, steps, rowNames, opts) {
    if (!list.length) return { notes: clone(notes), ties: clone(ties), spans: [], moved: { rows: 0, steps: 0 } };
    const idx = (row) => rowNames.indexOf(row);
    let dr = Math.round(dRows) || 0;
    let ds = Math.round(dSteps) || 0;
    const minRow = Math.min(...list.map((s) => idx(s.row)));
    const maxRow = Math.max(...list.map((s) => idx(s.row)));
    dr = Math.max(-minRow, Math.min(rowNames.length - 1 - maxRow, dr));
    const minStart = Math.min(...list.map((s) => s.start));
    const maxEnd = Math.max(...list.map((s) => s.start + s.len));
    ds = Math.max(-minStart, Math.min(steps - maxEnd, ds));
    const items = pick(notes, list).map((it) => ({ row: rowNames[idx(it.row) + dr], start: it.start + ds, len: it.len, values: it.values }));
    const base = opts && opts.copy ? { notes: clone(notes), ties: clone(ties) } : remove(notes, ties, list, steps);
    const out = place(base.notes, base.ties, items, steps);
    return { notes: out.notes, ties: out.ties, spans: out.placed, moved: { rows: dr, steps: ds } };
  }

  // Make a note longer or shorter. It cannot grow into the next note of its row; the new length is returned.
  function resize(notes, ties, span, newLen, steps) {
    const arr = (notes[span.row] || []).slice();
    let len = Math.max(1, Math.min(Math.round(newLen) || 1, steps - span.start));
    for (let k = span.len; k < len; k++) {
      if (on(arr[span.start + k])) {
        len = k;
        break;
      }
    }
    len = Math.max(1, len);
    const n = clone(notes);
    const t = clone(ties);
    if (!t[span.row]) t[span.row] = new Array(steps).fill(false);
    const first = n[span.row][span.start];
    for (let k = 0; k < Math.max(len, span.len); k++) {
      const i = span.start + k;
      if (i >= steps) break;
      if (k < len) {
        n[span.row][i] = k < span.len ? n[span.row][i] : first;
        t[span.row][i] = k > 0;
      } else {
        n[span.row][i] = false;
        t[span.row][i] = false;
      }
    }
    return { notes: n, ties: t, len };
  }

  // Give notes a strength (every step they cover). `which` is "all" of the steps or only the first.
  function setLevel(notes, list, value, steps) {
    const n = clone(notes);
    const v = level(value);
    list.forEach((s) => {
      for (let i = s.start; i < s.start + s.len && i < steps; i++) if (n[s.row] && on(n[s.row][i])) n[s.row][i] = v;
    });
    return n;
  }
  // Give single steps of a roll or a drum row a strength (only steps that are on).
  function setStepLevels(rows, cells, value, steps) {
    const n = clone(rows);
    const v = level(value);
    cells.forEach((c) => {
      if (n[c.row] && c.step >= 0 && c.step < steps && on(n[c.row][c.step])) n[c.row][c.step] = v;
    });
    return n;
  }
  // The strongest step of the notes that start on a step (the bar the velocity lane draws): 0 when none.
  function startLevel(notes, ties, step, steps, rowName) {
    let best = 0;
    Object.keys(notes || {}).forEach((row) => {
      if (rowName && row !== rowName) return;
      const v = (notes[row] || [])[step];
      if (on(v) && !(step > 0 && on(notes[row][step - 1]) && tied(ties, row, step))) best = Math.max(best, strength(v));
    });
    return best;
  }

  // Notes inside a box (rows by index into rowNames, steps), given by two corners in any order.
  function inBox(notes, ties, steps, rowNames, a, b) {
    const r1 = Math.min(a.row, b.row);
    const r2 = Math.max(a.row, b.row);
    const s1 = Math.min(a.step, b.step);
    const s2 = Math.max(a.step, b.step);
    return spans(notes, ties, steps).filter((s) => {
      const r = rowNames.indexOf(s.row);
      return r >= r1 && r <= r2 && s.start <= s2 && s.start + s.len - 1 >= s1;
    });
  }

  // Round a step to the snap setting (1 = every step, 2 = every other, 4 = every beat).
  const snap = (step, by) => (by > 1 ? Math.round(step / by) * by : Math.round(step));

  // Drum steps: set a list of { row, step } to a strength, or off. A row the song does not have is left alone.
  function paintCells(tracks, cells, value, steps) {
    const n = clone(tracks);
    cells.forEach((c) => {
      if (!n[c.row] || c.step < 0 || c.step >= steps) return;
      n[c.row][c.step] = value === false ? false : level(value);
    });
    return n;
  }

  window.SongEdit = { level, strength, spans, spanAt, key, remove, pick, place, move, resize, setLevel, setStepLevels, startLevel, inBox, snap, paintCells, on };
})();
