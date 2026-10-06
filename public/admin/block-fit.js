// Layout maths for fitting canvas blocks to their content (used by app.js; pure, so tests/block-fit.test.mjs can run it on its own).
// The canvas is a 24-column grid with 16px rows and an 8px gap; a block is {id, col, row, col_span, row_span, locked?}.
(function () {
  var COLS = 24;
  var ROW_H = 16;
  var GAP = 8;

  // Pixel height of `rows` rows, and the fewest rows that are at least `px` tall.
  function heightForRows(rows) {
    return rows * ROW_H + (rows - 1) * GAP;
  }
  function rowsForHeight(px) {
    var n = Number(px);
    if (!isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.ceil((n + GAP) / (ROW_H + GAP) - 1e-9));
  }
  function overlaps(a, b) {
    return a.col < b.col + b.col_span && b.col < a.col + a.col_span && a.row < b.row + b.row_span && b.row < a.row + a.row_span;
  }
  // Pushes whatever a grown block now overlaps down below it, and whatever that pushes down in turn, the way the public page's rows
  // grow to fit. Returns { moves: [{id, row}], blockedBy: id|null }: blockedBy is a locked block that would have had to move (then
  // nothing should be applied). Blocks that do not move are not listed. `list` is not changed.
  function settleDown(list, isFixed) {
    var items = list.map(function (b) { return { id: b.id, col: b.col, row: b.row, col_span: b.col_span, row_span: b.row_span, fixed: !!(isFixed && isFixed(b)) }; });
    var start = {};
    items.forEach(function (b) { start[b.id] = b.row; });
    var blockedBy = null;
    for (var guard = 0; guard < 2000; guard++) {
      items.sort(function (a, b) { return a.row - b.row || a.col - b.col || a.id - b.id; });
      var moved = false;
      for (var j = 1; j < items.length && !moved; j++) {
        for (var i = 0; i < j; i++) {
          if (!overlaps(items[i], items[j])) continue;
          if (items[j].fixed) { blockedBy = items[j].id; return { moves: [], blockedBy: blockedBy }; }
          items[j].row = items[i].row + items[i].row_span;
          moved = true;
          break;
        }
      }
      if (!moved) break;
    }
    var moves = [];
    items.forEach(function (b) { if (b.row !== start[b.id]) moves.push({ id: b.id, row: b.row }); });
    return { moves: moves, blockedBy: blockedBy };
  }
  // The widest a block may be made starting at its column without running into a block beside it on the same rows (never below 1).
  function maxSpanBeside(list, block, wantSpan) {
    var span = Math.min(wantSpan, COLS - block.col + 1);
    list.forEach(function (o) {
      if (o.id === block.id) return;
      var sameRows = block.row < o.row + o.row_span && o.row < block.row + block.row_span;
      if (sameRows && o.col > block.col && o.col < block.col + span) span = Math.min(span, o.col - block.col);
    });
    return Math.max(1, span);
  }
  // Where a block can take `want` columns: it keeps its left edge when it can, grows to the right first and then to the left, and never
  // lands on another block. Returns { col, span } (a smaller span when neighbours leave less room); a block that cannot change keeps
  // its own place and width.
  function fitWidth(list, block, want) {
    var others = list.filter(function (o) { return o.id !== block.id; });
    var target = Math.max(1, Math.min(COLS, want));
    for (var span = target; span >= 1; span--) {
      var hi = Math.min(block.col, COLS - span + 1);
      var lo = Math.max(1, block.col - (span - 1));
      for (var c = hi; c >= lo; c--) {
        var trial = { col: c, col_span: span, row: block.row, row_span: block.row_span };
        if (!others.some(function (o) { return overlaps(trial, o); })) return { col: c, span: span };
      }
      if (span <= block.col_span && target >= block.col_span) break; // growing: never end up narrower than it was
    }
    return { col: block.col, span: block.col_span };
  }
  // Two blocks next to each other in reading order trade places: side by side they trade columns, one above the other the lower one
  // moves up to where the upper one started and the upper one goes straight under it. Anything they now cover is pushed down.
  // Returns the changes [{ id, row, col }] to apply, or null when a locked block would have to move.
  function swapOrder(list, aId, bId, isFixed) {
    var items = list.map(function (b) { return { id: b.id, col: b.col, row: b.row, col_span: b.col_span, row_span: b.row_span, locked: b.locked }; });
    var a = items.filter(function (b) { return b.id === aId; })[0];
    var b = items.filter(function (x) { return x.id === bId; })[0];
    if (!a || !b) return null;
    var first = a.row < b.row || (a.row === b.row && a.col < b.col) ? a : b;
    var second = first === a ? b : a;
    var before = {};
    items.forEach(function (x) { before[x.id] = { row: x.row, col: x.col }; });
    if (first.row === second.row) {
      var firstCol = first.col;
      first.col = Math.max(1, Math.min(COLS - first.col_span + 1, second.col + second.col_span - first.col_span));
      second.col = firstCol;
    } else {
      second.row = first.row;
      first.row = first.row + second.row_span;
    }
    var settle = settleDown(items, function (x) { return x.id !== first.id && x.id !== second.id && !!(isFixed && isFixed(x)); });
    if (settle.blockedBy !== null) return null;
    settle.moves.forEach(function (m) { items.filter(function (x) { return x.id === m.id; })[0].row = m.row; });
    var out = [];
    items.forEach(function (x) { if (x.row !== before[x.id].row || x.col !== before[x.id].col) out.push({ id: x.id, row: x.row, col: x.col }); });
    return out;
  }
  // Columns needed for a width in pixels (colW is one column's width), and a picture's "actual size": its own pixel width as columns.
  function colsForWidth(px, colW) {
    var n = Number(px);
    if (!isFinite(n) || n <= 0) return 1;
    return Math.max(1, Math.min(COLS, Math.ceil((n + GAP) / (colW + GAP) - 1e-9)));
  }
  function widthForCols(cols, colW) {
    return cols * colW + (cols - 1) * GAP;
  }
  // How big a picture shows: its width in the block as a fraction of its own pixel width.
  function shownScale(blockWidthPx, naturalW) {
    return naturalW > 0 ? blockWidthPx / naturalW : 1;
  }
  var api = { COLS: COLS, ROW_H: ROW_H, GAP: GAP, heightForRows: heightForRows, rowsForHeight: rowsForHeight, overlaps: overlaps, settleDown: settleDown, maxSpanBeside: maxSpanBeside, fitWidth: fitWidth, swapOrder: swapOrder, colsForWidth: colsForWidth, widthForCols: widthForCols, shownScale: shownScale };
  if (typeof window !== "undefined") window.BlockFit = api;
})();
