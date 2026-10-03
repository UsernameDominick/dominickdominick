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
  var api = { COLS: COLS, ROW_H: ROW_H, GAP: GAP, heightForRows: heightForRows, rowsForHeight: rowsForHeight, overlaps: overlaps, settleDown: settleDown, maxSpanBeside: maxSpanBeside, colsForWidth: colsForWidth, widthForCols: widthForCols, shownScale: shownScale };
  if (typeof window !== "undefined") window.BlockFit = api;
})();
