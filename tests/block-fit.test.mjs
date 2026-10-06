// Canvas fit maths (public/admin/block-fit.js): row sums, push-down without overlaps, locked blocks, widths and picture scale.
import fs from "node:fs";
import vm from "node:vm";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/block-fit.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, isFinite }));
const F = window.BlockFit;
const B = (id, col, row, col_span, row_span, locked) => ({ id, col, row, col_span, row_span, locked });

// rows <-> pixels
ok(F.heightForRows(1) === 16 && F.heightForRows(2) === 40 && F.heightForRows(10) === 232, "heightForRows matches the canvas (16px rows, 8px gaps)");
ok([1, 2, 3, 7, 25].every((r) => F.rowsForHeight(F.heightForRows(r)) === r), "rowsForHeight inverts heightForRows exactly");
ok(F.rowsForHeight(F.heightForRows(5) + 0.5) === 6, "a hair over a row count needs the next row");
ok(F.rowsForHeight(0) === 1 && F.rowsForHeight(-5) === 1 && F.rowsForHeight(NaN) === 1 && F.rowsForHeight("x") === 1, "junk or tiny heights are one row");

// overlap
ok(F.overlaps(B(1, 1, 1, 12, 4), B(2, 12, 4, 5, 5)) === true, "overlapping rectangles");
ok(F.overlaps(B(1, 1, 1, 12, 4), B(2, 13, 1, 5, 4)) === false && F.overlaps(B(1, 1, 1, 12, 4), B(2, 1, 5, 12, 4)) === false, "touching edges do not overlap");

// push down
let r = F.settleDown([B(1, 1, 1, 24, 8), B(2, 1, 5, 24, 4), B(3, 1, 9, 24, 4)]);
ok(r.blockedBy === null && JSON.stringify(r.moves) === JSON.stringify([{ id: 2, row: 9 }, { id: 3, row: 13 }]), "a grown block pushes the one below it down, and that one pushes the next (cascade)", r);
r = F.settleDown([B(1, 1, 1, 24, 4), B(2, 1, 5, 24, 4)]);
ok(r.moves.length === 0, "a layout that already fits changes nothing");
r = F.settleDown([B(1, 1, 1, 12, 8), B(2, 13, 1, 12, 4), B(3, 1, 9, 24, 3), B(4, 13, 5, 12, 4)]);
ok(r.moves.length === 0, "blocks side by side that do not touch stay put");
r = F.settleDown([B(1, 1, 1, 12, 10), B(2, 13, 1, 12, 4), B(3, 1, 5, 24, 3)]);
ok(JSON.stringify(r.moves) === JSON.stringify([{ id: 3, row: 11 }]), "only the block that is actually in the way moves", r.moves);
r = F.settleDown([B(1, 1, 1, 24, 8), B(2, 1, 5, 24, 4, true)], (b) => b.locked);
ok(r.blockedBy === 2 && r.moves.length === 0, "a locked block in the way stops the whole change (nothing is applied)", r);
r = F.settleDown([B(1, 1, 1, 24, 8), B(2, 1, 5, 24, 4, true)]);
ok(r.blockedBy === null && r.moves.length === 1, "without an isFixed check it just moves it");
const input = [B(1, 1, 1, 24, 8), B(2, 1, 5, 24, 4)]; F.settleDown(input);
ok(input[1].row === 5, "the input list is never modified");
const many = [B(1, 1, 1, 24, 30)]; for (let i = 0; i < 40; i++) many.push(B(i + 2, 1, 2 + i * 2, 24, 2));
r = F.settleDown(many);
const after = many.map((b) => ({ ...b, row: (r.moves.find((m) => m.id === b.id) || b).row }));
ok(after.every((a, i) => after.every((o, j) => i === j || !F.overlaps(a, o))), "a long cascade ends with no overlaps at all", r.moves.length);

// width beside neighbours
ok(F.maxSpanBeside([B(1, 1, 1, 6, 4), B(2, 13, 1, 12, 4)], B(1, 1, 1, 6, 4), 24) === 12, "widening stops at a neighbour on the same rows");
ok(F.maxSpanBeside([B(1, 1, 1, 6, 4), B(2, 13, 6, 12, 4)], B(1, 1, 1, 6, 4), 24) === 24, "a block on other rows is no obstacle");
ok(F.maxSpanBeside([B(1, 20, 1, 3, 4)], B(1, 20, 1, 3, 4), 24) === 5, "it never runs past the right edge (24 columns)");
ok(F.maxSpanBeside([B(1, 1, 1, 6, 4)], B(1, 1, 1, 6, 4), 0) === 1, "never below one column");

// pixels <-> columns
const colW = (1100 - 23 * 8) / 24;
ok(F.colsForWidth(F.widthForCols(10, colW), colW) === 10 && F.colsForWidth(F.widthForCols(24, colW), colW) === 24, "colsForWidth inverts widthForCols", [colW]);
ok(F.colsForWidth(5000, colW) === 24 && F.colsForWidth(0, colW) === 1 && F.colsForWidth(NaN, colW) === 1, "capped at 24 columns, floored at 1");
ok(F.colsForWidth(F.widthForCols(10, colW) + 1, colW) === 11, "a pixel more than ten columns needs eleven");
ok(Math.abs(F.shownScale(400, 800) - 0.5) < 1e-9 && F.shownScale(400, 0) === 1, "scale shown = block width over the picture's own width");

// widening from the Size menu: never on top of a neighbour
let w = F.fitWidth([B(1, 1, 8, 16, 6), B(2, 17, 8, 8, 6)], B(2, 17, 8, 8, 6), 24);
ok(w.col === 17 && w.span === 8, "an image beside a text block cannot go Full: it keeps its place and width", w);
w = F.fitWidth([B(1, 1, 8, 8, 6), B(2, 9, 8, 8, 6)], B(2, 9, 8, 8, 6), 16);
ok(w.col === 9 && w.span === 16, "with room on the right it keeps its left edge and grows right", w);
w = F.fitWidth([B(1, 1, 8, 8, 6), B(2, 17, 8, 8, 6)], B(2, 17, 8, 8, 6), 16);
ok(w.col === 9 && w.span === 16, "at the right edge it grows to the left into the free room", w);
w = F.fitWidth([B(1, 1, 8, 6, 6), B(2, 13, 8, 8, 6)], B(2, 13, 8, 8, 6), 24);
ok(w.col === 7 && w.span === 18, "with only some room it takes what there is", w);
w = F.fitWidth([B(1, 1, 1, 24, 4)], B(1, 1, 1, 24, 4), 12);
ok(w.col === 1 && w.span === 12, "narrowing keeps the left edge", w);

// the phone's up/down: the two trade places and nothing overlaps swwards
const noOverlap = (list) => list.every((a, i) => list.every((b, j) => i === j || !F.overlaps(a, b)));
const applied = (list, changes) => list.map((b) => Object.assign({}, b, (changes || []).find((c) => c.id === b.id) || {}));
let pg = [B(1, 1, 3, 24, 4), B(2, 1, 8, 24, 6), B(3, 1, 15, 24, 3)];
let ch = F.swapOrder(pg, 1, 2);
let sw = applied(pg, ch);
ok(sw.find((b) => b.id === 2).row === 3 && sw.find((b) => b.id === 1).row === 9 && noOverlap(sw), "moving a heading below the text under it: the text moves up, the heading goes straight under it", sw);
pg = [B(1, 1, 1, 8, 4), B(2, 9, 1, 16, 4)];
sw = applied(pg, F.swapOrder(pg, 2, 1));
ok(sw.find((b) => b.id === 2).col === 1 && sw.find((b) => b.id === 1).col === 17 && noOverlap(sw), "side by side they trade columns", sw);
pg = [B(1, 1, 1, 24, 2), B(2, 1, 3, 24, 10), B(3, 1, 13, 24, 2)];
sw = applied(pg, F.swapOrder(pg, 1, 2));
ok(noOverlap(sw), "a tall block moved up pushes whatever it now covers down", sw);
ok(F.swapOrder([B(1, 1, 1, 24, 2)], 1, 99) === null, "a block that is not on the page swaps nothing");

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
