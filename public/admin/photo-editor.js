(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const modal = $("photo-editor-modal");
  const canvas = $("pe-canvas");
  const overlay = $("pe-overlay");
  const stack = $("pe-canvas-stack");
  const frame = $("pe-canvas-frame"); // sized to what the (possibly rotated) view occupies
  const canvasWrap = $("pe-canvas-wrap");
  const ctx = canvas.getContext("2d");
  const octx = overlay.getContext("2d");

  // Images larger than this (on the long edge) are downscaled on load —
  // plenty for a personal blog, and keeps brush/undo snapshots fast.
  const MAX_DIMENSION = 2000;
  const UNDO_LIMIT = 15;
  // Mirrors worker/admin-api.js's /upload and PUT /media/:key size caps
  // (both 8MB) -- a separate literal here, not read from the server,
  // since there's no request-independent way for this client-side
  // module to ask the Worker what its own hardcoded limit is. Kept in
  // one named constant rather than a second copy of the number, so a
  // future change to the actual server-side cap only has to also update
  // this one spot (still manual, but a single spot instead of a bare
  // number duplicated inline in the tooltip text below).
  const MAX_EXPORT_MB = 8;

  // The app modal replaces the native dialog API, which is unsupported in
  // some embedded browsers. The shared stack supplies
  // Escape/backdrop closing, focus trapping, and focus return; every close
  // path resolves null so callers can treat cancellation consistently.
  const promptModal = $("photo-editor-prompt-modal");
  const promptForm = $("photo-editor-prompt-form");
  const promptTitle = $("photo-editor-prompt-title");
  const promptLabel = $("photo-editor-prompt-label");
  const promptInput = $("photo-editor-prompt-input");
  let resolvePrompt = null;

  function settlePrompt(value) {
    if (!resolvePrompt) return;
    const resolve = resolvePrompt;
    resolvePrompt = null;
    promptModal.hidden = true;
    resolve(value);
  }

  function promptForText(title, label, initialValue = "") {
    if (resolvePrompt) return Promise.resolve(null);
    promptTitle.textContent = title;
    promptLabel.textContent = label;
    promptInput.value = initialValue;
    promptInput.setCustomValidity("");
    promptModal.hidden = false;
    // Let the shared modal observers finish stacking the nested dialog and
    // capturing the trigger before moving focus into its input.
    requestAnimationFrame(() => {
      if (!promptModal.hidden) promptInput.focus();
    });
    return new Promise((resolve) => {
      resolvePrompt = resolve;
    });
  }

  promptForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const value = promptInput.value;
    if (!value.trim()) {
      promptInput.setCustomValidity("Enter a value, or cancel.");
      promptInput.reportValidity();
      return;
    }
    promptInput.setCustomValidity("");
    settlePrompt(value);
  });
  promptInput.addEventListener("input", () => promptInput.setCustomValidity(""));
  $("pe-prompt-cancel").addEventListener("click", () => settlePrompt(null));
  $("close-photo-editor-prompt").addEventListener("click", () => settlePrompt(null));

  // Interpolates the real constants above into the tooltip text rather
  // than a separate hardcoded string, so a future change to any of them
  // can't silently drift out of sync with what the UI tells an admin (a
  // critic pass found the original static string had no link back to
  // MAX_DIMENSION/UNDO_LIMIT/the export cap at all). Also fixed a factual
  // gap the same pass found: "lower the quality slider" only ever helped
  // the JPEG/WebP case (PNG has no quality concept, canvas.toBlob()
  // ignores the argument for it) -- PNG is also this editor's own default
  // export format, so the advice silently didn't apply to its own
  // starting state. Now names PNG's actual remedies (crop/resize, or
  // switch format) instead of repeating advice that does nothing for it.
  $("pe-limits-info").title =
    `Images wider or taller than ${MAX_DIMENSION}px are automatically downscaled when opened, to keep editing responsive. ` +
    `Undo/redo keeps the last ${UNDO_LIMIT} steps. ` +
    `Exported files are capped at ${MAX_EXPORT_MB}MB -- for JPEG/WebP, lower the quality slider; for PNG (no quality setting), try cropping/resizing first, or use "Save as new" with a JPEG/WebP format instead.`;

  // The site's one uploaded custom font (see worker/admin-api.js's
  // /upload-font, Site Settings' custom_font_name/custom_font_url).
  // Site Settings can be opened and saved without leaving this same
  // single-page admin app, so a critic pass found that caching the
  // resolved family name forever (only checking Settings once, the
  // first time the Text tool was ever selected in this page load) went
  // permanently stale the moment an admin configured a font AFTER
  // already having opened the Photo Editor once with none configured --
  // exactly the sequence someone trying this feature for the first time
  // would follow, not an obscure edge case. Settings are re-fetched every
  // time the Text tool is selected (cheap), but the actual FontFace load
  // (the real network/CPU cost) is only redone if the name+url actually
  // changed since the last successful load.
  let loadedFontKey = null; // `${name}|${url}` of the currently-loaded custom font, or null
  let loadedFontFamily = null; // family name once loaded, else null
  // De-dupes concurrent calls (e.g. rapidly switching Text -> another
  // tool -> Text again before the first check resolves) -- a critic pass
  // found that without this, two overlapping fetch+load calls could race,
  // and whichever settled last would silently overwrite the other's
  // result even if the earlier one had already succeeded.
  let fontCheckPromise = null;
  // Distinguishes "no custom font configured at all" from "one IS
  // configured but actually failed to load" -- both used to collapse
  // into the same null result and the same generic "(none uploaded)"
  // label, silently hiding a real, actionable problem (a broken font
  // URL, an unsupported font format, a CORS-blocked host) behind text
  // that reads as if nothing had ever been set up.
  let lastFontLoadFailed = false;
  function ensureCustomFontLoaded() {
    if (fontCheckPromise) return fontCheckPromise;
    fontCheckPromise = (async () => {
      try {
        const settings = await window.adminApi("/settings");
        const name = settings && settings.custom_font_name;
        const url = settings && settings.custom_font_url;
        if (!name || !url) {
          loadedFontKey = null;
          loadedFontFamily = null;
          lastFontLoadFailed = false;
          return null;
        }
        const key = `${name}|${url}`;
        if (key !== loadedFontKey) {
          // JSON.stringify quotes and escapes the URL for safe embedding
          // as a CSS string, matching how this exact value is already
          // handled everywhere else it reaches a CSS url() in this
          // codebase (worker/render.js's esc()-wrapped url('...'), the
          // admin's own live Settings preview) -- custom_font_url is a
          // plain string accepted by the settings API with no server-side
          // format validation, so a hand-edited value containing a space,
          // parenthesis, or quote needs the same defensive handling here,
          // not just for values that only ever come from the upload UI.
          const face = new FontFace(name, `url(${JSON.stringify(url)})`);
          await face.load();
          document.fonts.add(face);
          loadedFontKey = key;
          loadedFontFamily = name;
        }
        lastFontLoadFailed = false;
        return loadedFontFamily;
      } catch {
        // A failed fetch/parse/load leaves the custom option unavailable
        // rather than surfacing an error over something as minor as an
        // optional font choice -- placeText() below falls back to
        // sans-serif the same way as "not configured at all". The
        // DISTINCTION is only in the label text (see setTool()'s "text"
        // branch): a configured-but-broken font gets an actionable
        // "(failed to load)" message instead of the misleading "(none
        // uploaded)" this used to show for both cases identically.
        loadedFontKey = null;
        loadedFontFamily = null;
        lastFontLoadFailed = true;
        return null;
      } finally {
        fontCheckPromise = null;
      }
    })();
    return fontCheckPromise;
  }

  let originalKey = null;
  let undoStack = [];
  let redoStack = [];
  let originalSnapshot = null; // canvas clone taken when the image is first loaded, for "Reset"
  let currentTool = "select";
  let cropRect = null; // {x0,y0,x1,y1} in canvas pixel space
  let dragging = false;
  let dragStart = null;
  let baseSnapshot = null; // canvas clone taken when an adjust slider is first touched
  // Selection state (the Selection section below explains the model).
  let selOps = []; // {kind: "rect"|"ellipse"|"poly"|"invert", mode: "add"|"sub", box | pts} in canvas pixels
  let selMask = null; // canvas-sized alpha mask rasterised from selOps
  let selMaskCtx = null;
  let selBounds = null; // {x, y, w, h, coverage} of what the mask selects
  let selOverlay = null; // cached tint/outline layer that clearOverlay() lays down
  let selOverlayScale = 0; // display scale selOverlay was drawn for
  let selMaskData = null; // RGBA pixels of selMask (alpha is the mask), kept for the outline
  let selEdge = null; // cached two-tone outline layer
  let selEdgeScale = 0; // display scale selEdge was drawn for
  let selDraft = null; // the shape being drawn right now

  // ---------- View rotation ----------
  // A purely cosmetic on-screen rotation (CSS transform on the stack),
  // completely separate from pe-rotate-left/right above (which actually
  // rotate the pixel data, resize the canvas, and count as an edit). This
  // never touches canvas.width/height or any pixel, and resets to 0 on
  // every image open like the other per-session view preferences
  // (background preview, crop ratio, etc.).
  let viewRotation = 0;
  // The CSS rotation doesn't change layout, so the frame around the stack takes the
  // rotated footprint (width and height swapped at 90/270) and the canvas area
  // scrolls to the real edges of what is on screen.
  function layoutFrame() {
    const w = parseFloat(stack.style.width) || 0;
    const h = parseFloat(stack.style.height) || 0;
    const swapped = viewRotation % 180 !== 0;
    frame.style.width = (swapped ? h : w) + "px";
    frame.style.height = (swapped ? w : h) + "px";
  }
  function applyViewRotation() {
    stack.style.transform = viewRotation === 0 ? "" : `rotate(${viewRotation}deg)`;
    layoutFrame();
    $("pe-view-rotate").textContent = `↻ View: ${viewRotation}°`;
  }
  $("pe-view-rotate").addEventListener("click", () => {
    viewRotation = (viewRotation + 90) % 360;
    applyViewRotation();
    // The footprint changed (swapped at 90/270), so the fit changes with it; going
    // through setZoom keeps the point at the middle of the view in place.
    if (!modal.hidden) setZoom(zoomMode);
  });

  let lastFitDims = "";
  // ---------- Zoom and pan ----------
  // "fit" or a magnification (1 = actual pixels). The canvas area already scrolls,
  // so panning is scrolling; pointer mapping reads the displayed size, so every
  // tool keeps working at any zoom.
  let zoomMode = "fit";
  const ZOOM_STEPS = [0.25, 0.33, 0.5, 0.67, 1, 1.5, 2, 3, 4, 6, 8];
  // What Fit would show right now (never enlarged past 100%).
  function fitScaleNow() {
    const cs = getComputedStyle(canvasWrap);
    const innerW = canvasWrap.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
    const innerH = canvasWrap.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
    const maxW = Math.max(1, Math.min(canvasWrap.clientWidth * 0.9, innerW));
    const maxH = Math.max(1, Math.min(canvasWrap.clientHeight * 0.9, innerH));
    const rotated = viewRotation % 180 !== 0;
    return Math.min(1, maxW / (rotated ? canvas.height : canvas.width), maxH / (rotated ? canvas.width : canvas.height));
  }
  function currentScale() {
    return (parseFloat(overlay.style.width) || canvas.width) / canvas.width || 1;
  }
  // Set the zoom, keeping the image point under (clientX, clientY) fixed (the
  // centre of the area by default).
  function setZoom(mode, clientX, clientY) {
    const wrapEl = canvasWrap;
    const wr = wrapEl.getBoundingClientRect();
    const ax = clientX == null ? wr.left + wr.width / 2 : clientX;
    const ay = clientY == null ? wr.top + wr.height / 2 : clientY;
    const before = stack.getBoundingClientRect();
    const fx = before.width ? (ax - before.left) / before.width : 0.5;
    const fy = before.height ? (ay - before.top) / before.height : 0.5;
    zoomMode = mode === "fit" ? "fit" : Math.max(Math.min(ZOOM_STEPS[0], fitScaleNow()), Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], mode));
    fitCanvasToViewport();
    const after = stack.getBoundingClientRect();
    wrapEl.scrollLeft += after.left + fx * after.width - ax;
    wrapEl.scrollTop += after.top + fy * after.height - ay;
    redrawOverlay();
    if (selDraft && SELECTION_TOOLS.includes(currentTool)) drawSelectionDraft();
    updateZoomUi();
    $("pe-zoom-status").textContent = `Zoom ${Math.round(currentScale() * 100)}%`;
  }
  function stepZoom(dir, clientX, clientY) {
    const cur = currentScale();
    const next = dir > 0 ? ZOOM_STEPS.find((z) => z > cur + 0.005) : [...ZOOM_STEPS].reverse().find((z) => z < cur - 0.005);
    if (next !== undefined) setZoom(next, clientX, clientY);
  }
  function updateZoomUi() {
    const cur = currentScale();
    // aria-disabled, not disabled: a button that disables itself under the
    // keyboard would strand focus on the page body.
    $("pe-zoom-out").setAttribute("aria-disabled", String(cur <= ZOOM_STEPS[0] + 0.005));
    $("pe-zoom-in").setAttribute("aria-disabled", String(cur >= ZOOM_STEPS[ZOOM_STEPS.length - 1] - 0.005));
    $("pe-zoom-reset").setAttribute("aria-pressed", String(zoomMode === "fit"));
    $("pe-zoom-100").setAttribute("aria-pressed", String(zoomMode === 1));
  }
  // fromLayout: the refit was caused by the area or window changing size, not by an
  // edit, so with unchanged pixel dimensions there is nothing to re-estimate.
  function fitCanvasToViewport(fromLayout = false) {
    // 90% of the area, but never more than what is left inside its padding
    // (clientWidth/Height include it), or a short window gets scrollbars.
    const wrapEl = canvasWrap;
    const wrapStyle = getComputedStyle(wrapEl);
    const innerW = wrapEl.clientWidth - parseFloat(wrapStyle.paddingLeft) - parseFloat(wrapStyle.paddingRight);
    const innerH = wrapEl.clientHeight - parseFloat(wrapStyle.paddingTop) - parseFloat(wrapStyle.paddingBottom);
    const maxW = Math.max(1, Math.min(wrapEl.clientWidth * 0.9, innerW));
    const maxH = Math.max(1, Math.min(wrapEl.clientHeight * 0.9, innerH));
    // "fit" shows the whole image (never enlarged past 100%); a number is a fixed
    // magnification relative to real pixels.
    // A view rotated 90/270 occupies the swapped footprint.
    const rotated = viewRotation % 180 !== 0;
    const fitW = rotated ? canvas.height : canvas.width;
    const fitH = rotated ? canvas.width : canvas.height;
    const scale = zoomMode === "fit" ? Math.min(1, maxW / fitW, maxH / fitH) : zoomMode;
    // The legacy CSS size caps only suit an unrotated Fit: with the view rotated the
    // footprint is swapped, so the (inline) size must be the size the element gets.
    // The inline size is already exact (fitted or zoomed), so the legacy CSS caps
    // are never wanted: they could only shrink the element below the size the
    // pointer mapping assumes (a phone-width squash of wide images).
    stack.classList.add("is-zoomed");
    // Enlarged pixels stay square instead of blurring, which is what retouching needs.
    stack.classList.toggle("is-pixelated", scale >= 2);
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    overlay.style.width = w + "px";
    overlay.style.height = h + "px";
    stack.style.width = w + "px";
    stack.style.height = h + "px";
    layoutFrame();
    updateStatusBar(scale);
    // A selection's coordinates belong to one canvas size: drop it when the
    // size changed (crop, rotate, resize, straighten, undo across a resize),
    // and redraw its outline when only the display scale did.
    // (Compare briefly swaps in the original, which may be another size; the
    // selection waits for the real canvas to come back.)
    if (selMask && (selMask.width !== canvas.width || selMask.height !== canvas.height)) {
      if (!isComparing()) dropSelection("The selection was cleared because the image size changed.");
    } else if (selOverlay && Math.abs(selOverlayScale - displayScale()) > 0.01) {
      rebuildSelectionOverlay();
      redrawOverlay();
    }
    // Covers every dimension-changing edit (crop, rotate, undo/redo/reset,
    // load) for free since they all already call this function. Content-
    // only edits that don't change dimensions (a brush stroke, a filter)
    // don't refresh the estimate until the format/quality controls are
    // next touched or the image is actually saved -- the real exported
    // file is always encoded fresh from the live canvas regardless, so
    // this only affects how current the *preview number* looks, never
    // what actually gets uploaded.
    // ...but only when the pixel dimensions changed. A refit for any other reason
    // (a window resize, the bars around the canvas re-wrapping) must not wipe a
    // width or height someone has typed and not applied yet.
    const dims = canvas.width + "x" + canvas.height;
    // An edit or history move (undo, redo, reset, snapshot) can change the encoded
    // size without changing the pixel size, so it always re-estimates.
    if (!fromLayout || dims !== lastFitDims) scheduleSizeEstimate();
    if (dims === lastFitDims) return;
    lastFitDims = dims;
    // Same free ride for the Resize width/height fields -- without this
    // they'd keep showing whatever dimensions were true when the modal
    // opened even after a rotate/crop/undo genuinely changed them,
    // silently misleading an admin about what "no change" (leaving the
    // fields alone) would actually do on their next Resize click.
    refreshResizeFields();
    refreshCanvasResizeFields();
  }

  // Real pixel dimensions and the scale actually being displayed at right
  // now (this editor auto-fits to the viewport rather than having a manual
  // zoom control, so "zoom" here just means that fit ratio) — an admin
  // cropping/resizing has no other way to see the current pixel size
  // without exporting first.
  function updateStatusBar(scale) {
    const el2 = $("pe-status-bar");
    if (!el2) return;
    // The percentage sits in a fixed-width box: "99" and "100" would otherwise
    // differ in width, which can flip the bottom bar between one and two rows,
    // which changes the canvas area, which changes the scale, which changes the
    // text again (the canvas area's ResizeObserver then never settles).
    el2.textContent = `${canvas.width} × ${canvas.height}px · `;
    const pct = document.createElement("span");
    pct.className = "pe-scale";
    pct.textContent = String(Math.round(scale * 100));
    el2.append(pct, "% displayed");
    updateZoomUi();
  }

  function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
    // The selection's outline/tint stays under every tool's own overlay drawing.
    if (selOverlay && selOverlay.width === overlay.width && selOverlay.height === overlay.height) octx.drawImage(selOverlay, 0, 0);
  }

  function syncOverlaySize() {
    overlay.width = canvas.width;
    overlay.height = canvas.height;
  }

  function snapshotCanvas() {
    const snap = document.createElement("canvas");
    snap.width = canvas.width;
    snap.height = canvas.height;
    snap.getContext("2d").drawImage(canvas, 0, 0);
    return snap;
  }

  // Undo entries are {canvas, sel}: the pixels before an edit (null for a
  // selection-only change, which leaves the pixels alone) and the selection
  // shapes at that moment, so Undo/Redo step through selection changes too.
  function cloneOps(ops) {
    return JSON.parse(JSON.stringify(ops));
  }

  // Pixel snapshots are the heavy part, so they keep the original depth (15);
  // selection-only entries are tiny and are limited separately, so a run of
  // selection changes can never push a pixel edit out of the history.
  const SELECTION_UNDO_LIMIT = 40;
  function trimUndo() {
    const dropOldest = (wantPixel) => {
      const i = undoStack.findIndex((entry) => Boolean(entry.canvas) === wantPixel);
      if (i >= 0) undoStack.splice(i, 1);
    };
    let pixel = undoStack.filter((entry) => entry.canvas).length;
    while (pixel > UNDO_LIMIT) {
      dropOldest(true);
      pixel--;
    }
    let selectionOnly = undoStack.length - pixel;
    while (selectionOnly > SELECTION_UNDO_LIMIT) {
      dropOldest(false);
      selectionOnly--;
    }
  }

  function pushUndo() {
    undoStack.push({ canvas: snapshotCanvas(), sel: cloneOps(selOps) });
    trimUndo();
    redoStack = [];
    updateHistoryButtons();
  }

  function pushSelectionUndo() {
    undoStack.push({ canvas: null, sel: cloneOps(selOps) });
    trimUndo();
    redoStack = [];
    updateHistoryButtons();
  }

  // Put the selection back to the given shapes (no-op when it already is).
  function restoreSelection(ops) {
    if (JSON.stringify(ops) === JSON.stringify(selOps)) return;
    selOps = cloneOps(ops);
    rebuildSelection();
  }

  function updateHistoryButtons() {
    $("pe-undo").disabled = undoStack.length === 0;
    $("pe-redo").disabled = redoStack.length === 0;
  }

  function restoreSnapshot(snap) {
    canvas.width = snap.width;
    canvas.height = snap.height;
    ctx.drawImage(snap, 0, 0);
    syncOverlaySize();
    // Undo/redo/reset have the identical "canvas changed underneath any
    // in-progress interaction" problem rotate90()/flip() do -- a critic
    // pass reviewing THIS function's own precedent (which those two mirror)
    // found it only ever cleared the crop selection, never a brush stroke's
    // mask or a shape tool's drag anchor, both invalidated the same way.
    cancelActiveDrag();
    fitCanvasToViewport();
  }

  // A critic pass caught a real corruption bug: Ctrl+Z fired while Compare
  // is held operated on whatever's currently ON the canvas -- which at that
  // moment is the temporary original preview, not real app state -- pushing
  // a bogus entry onto redoStack and having its own effect silently
  // discarded when the button was released and endCompare() unconditionally
  // overwrote the canvas again. Guarding here (not just in the keydown
  // handler) closes it regardless of whether undo/redo is triggered by
  // keyboard shortcut or by clicking the Undo/Redo buttons directly.
  function undo() {
    if (isComparing()) return;
    const prev = undoStack.pop();
    if (!prev) return;
    redoStack.push({ canvas: prev.canvas ? snapshotCanvas() : null, sel: cloneOps(selOps) });
    if (prev.canvas) restoreSnapshot(prev.canvas);
    restoreSelection(prev.sel);
    selectionNoteText = "";
    updateSelectionUi();
    updateHistoryButtons();
  }

  function redo() {
    if (isComparing()) return;
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push({ canvas: next.canvas ? snapshotCanvas() : null, sel: cloneOps(selOps) });
    if (next.canvas) restoreSnapshot(next.canvas);
    restoreSelection(next.sel);
    selectionNoteText = "";
    updateSelectionUi();
    updateHistoryButtons();
  }

  function resetToOriginal() {
    if (!originalSnapshot || isComparing()) return;
    if (!confirm("Discard all edits and go back to the original image?")) return;
    pushUndo();
    restoreSnapshot(originalSnapshot);
  }

  // ---------- Named snapshots ----------
  // A separate, unbounded-within-reason list an admin explicitly names
  // and jumps directly back to, unlike the plain 15-deep linear undo
  // stack (which is capped, unnamed, and only ever steps one edit at a
  // time). Reuses the exact same restoreSnapshot() helper Reset already
  // uses, so restoring correctly handles canvas resize/overlay sync/
  // stale-drag invalidation identically -- no separate restore logic to
  // keep in sync with future changes to that function.
  const NAMED_SNAPSHOT_LIMIT = 5;
  let namedSnapshots = []; // { name, canvas }

  function escapeHtmlAttr(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  function renderSnapshotSelect() {
    const select = $("pe-snapshot-select");
    const prevValue = select.value;
    if (!namedSnapshots.length) {
      select.innerHTML = `<option value="">No snapshots yet</option>`;
      select.disabled = true;
    } else {
      select.innerHTML = namedSnapshots.map((s, i) => `<option value="${i}">${escapeHtmlAttr(s.name)}</option>`).join("");
      select.disabled = false;
      // Keep the same selection across a re-render (e.g. after deleting a
      // different entry) when that index is still valid, rather than
      // always snapping back to the first snapshot.
      if (prevValue && Number(prevValue) < namedSnapshots.length) select.value = prevValue;
    }
  }

  $("pe-save-snapshot").addEventListener("click", async () => {
    // While Compare is held, the live canvas is temporarily swapped to
    // show originalSnapshot's pixels (a plain drawImage swap, not routed
    // through restoreSnapshot() -- see startCompare()'s own comment).
    // Without this guard, snapshotCanvas() here would capture that
    // temporary pre-edit preview instead of the actual current edit,
    // silently saving a mislabeled snapshot with the wrong content --
    // the exact bug class already hunted down and fixed for Undo/Redo/
    // Reset/Restore, just missed for this one.
    if (isComparing()) return;
    // Capture pixels before the dialog yields, while a second pointer may still
    // be delivering changes from an in-progress gesture.
    const snapshot = snapshotCanvas();
    const name = await promptForText("Save snapshot", "Snapshot name", `Snapshot ${namedSnapshots.length + 1}`);
    if (name === null) return;
    namedSnapshots.push({ name: name.trim(), canvas: snapshot });
    // Full-size canvas copies held in memory -- capped like the undo stack
    // so a long editing session on a large (MAX_DIMENSION-sized) image
    // can't quietly accumulate an unbounded number of them.
    if (namedSnapshots.length > NAMED_SNAPSHOT_LIMIT) namedSnapshots.shift();
    renderSnapshotSelect();
    $("pe-snapshot-select").value = String(namedSnapshots.length - 1);
  });

  $("pe-restore-snapshot").addEventListener("click", () => {
    if (isComparing()) return;
    const idx = Number($("pe-snapshot-select").value);
    const snap = namedSnapshots[idx];
    if (!snap) return;
    if (!confirm(`Jump back to the "${snap.name}" snapshot? Your current state stays undoable afterward with Undo.`)) return;
    pushUndo();
    restoreSnapshot(snap.canvas);
  });

  $("pe-delete-snapshot").addEventListener("click", () => {
    const idx = Number($("pe-snapshot-select").value);
    if (!namedSnapshots[idx]) return;
    if (!confirm(`Delete the "${namedSnapshots[idx].name}" snapshot? This can't be undone (it's separate from the image's own Undo/Redo history).`)) return;
    namedSnapshots.splice(idx, 1);
    renderSnapshotSelect();
  });

  // Before/after compare — press and hold to see the original, release to
  // return to the in-progress edit, with no history/undo effect either way
  // (unlike Reset, nothing is actually changed; it's a look, not an edit).
  // A plain drawImage swap rather than routing through restoreSnapshot(),
  // which resets crop state and canvas dimensions meant for a real
  // "return to this state" action, not a momentary preview.
  //
  // A critic pass found the original version had no backstop if the
  // pointerup/pointerleave/pointercancel release events were ever missed
  // (e.g. losing window focus with the pointer stationary) -- the canvas
  // would silently stay on the unedited original with zero visual
  // indication, and a Save at that moment would upload the original,
  // silently discarding the real edit. Closed two ways: (1) window blur
  // and tab-visibility changes force-end the compare, covering the most
  // common ways a pointerup could get lost; (2) exportBlob() -- the one
  // function both "Save as new" and "Overwrite original" funnel through --
  // force-ends it unconditionally as a hard backstop, so even a release
  // path neither of us thought of still can't make a save capture the
  // temporary preview instead of the real edit.
  let compareSavedState = null;
  function isComparing() {
    return compareSavedState !== null;
  }
  // A crop or canvas-resize since load leaves the canvas a different size
  // than originalSnapshot -- swapping images without also swapping
  // dimensions would draw the original clipped to the (possibly smaller)
  // current canvas instead of showing it in full.
  let compareScroll = null;
  function startCompare() {
    // `dragging` (an in-progress crop/brush/shape interaction on the main
    // canvas) is deliberately also blocked here: a critic pass found that
    // on a touchscreen, a second finger pressing Compare mid-drag on
    // another tool computed that drag's start/end coordinates in two
    // different canvas coordinate spaces (pre- and post-compare-resize),
    // since the canvas's own pixel dimensions change during a compare.
    // Single-pointer mouse/trackpad use can never trigger this (only one
    // interaction can be in progress at a time), so this only matters for
    // touch, but it's a one-line guard against a real corrupted-crop risk.
    // `baseSnapshot` (an in-progress brightness/contrast/saturate slider
    // drag) is blocked for the same reason -- a critic pass found this one
    // reachable via completely ordinary keyboard+mouse, not just
    // multi-touch, and guarding `onAdjustInput()`/`onAdjustCommit()`
    // against starting mid-compare already prevents the corruption on its
    // own; this is the belt-and-suspenders other half, stopping Compare
    // from starting mid-slider-drag in the first place rather than only
    // stopping the slider from acting while Compare is already active.
    if (!originalSnapshot || compareSavedState || dragging || baseSnapshot) return;
    resetStraightenUi();
    compareSavedState = snapshotCanvas();
    compareScroll = { l: canvasWrap.scrollLeft, t: canvasWrap.scrollTop };
    canvas.width = originalSnapshot.width;
    canvas.height = originalSnapshot.height;
    ctx.drawImage(originalSnapshot, 0, 0);
    syncOverlaySize();
    fitCanvasToViewport();
    redrawOverlay();
    $("pe-compare").classList.add("active");
  }
  function endCompare() {
    if (!compareSavedState) return;
    canvas.width = compareSavedState.width;
    canvas.height = compareSavedState.height;
    ctx.drawImage(compareSavedState, 0, 0);
    syncOverlaySize();
    fitCanvasToViewport();
    compareSavedState = null;
    if (compareScroll) {
      // A size-mismatched compare clamped the scroll position; put it back.
      canvasWrap.scrollLeft = compareScroll.l;
      canvasWrap.scrollTop = compareScroll.t;
      compareScroll = null;
    }
    // syncOverlaySize() cleared the overlay bitmap; bring the selection back.
    redrawOverlay();
    $("pe-compare").classList.remove("active");
  }

  // ---------- Pointer <-> canvas coordinate mapping ----------
  // Accounts for viewRotation (see above) -- without this, every pointer-
  // based tool (brush, shapes, crop, text placement) would place its mark
  // at the wrong canvas location whenever the view is rotated 90/270°,
  // since getBoundingClientRect() on a rotated element returns the
  // post-transform axis-aligned box (width/height swapped at 90/270°),
  // not the canvas's own unrotated pixel grid. CSS rotates around the
  // element's center by default, so that center point is the one thing
  // that stays fixed regardless of rotation -- computing the pointer's
  // offset from that center, then inverse-rotating that offset back into
  // the unrotated frame, correctly recovers canvas-space coordinates at
  // any rotation. At viewRotation === 0 this reduces to exactly the
  // original, unrotated formula.
  function pointFromEvent(e) {
    const rect = overlay.getBoundingClientRect();
    const displayW = parseFloat(overlay.style.width) || rect.width;
    const displayH = parseFloat(overlay.style.height) || rect.height;
    const cx = rect.left + rect.width / 2;
    const cy = rect.top + rect.height / 2;
    let dx = e.clientX - cx;
    let dy = e.clientY - cy;
    if (viewRotation !== 0) {
      const rad = (-viewRotation * Math.PI) / 180;
      const cos = Math.cos(rad);
      const sin = Math.sin(rad);
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      dx = rx;
      dy = ry;
    }
    const x = ((dx + displayW / 2) / displayW) * canvas.width;
    const y = ((dy + displayH / 2) / displayH) * canvas.height;
    return { x, y };
  }

  // ---------- Tool selection ----------
  function setTool(tool) {
    const previousTool = currentTool;
    currentTool = tool;
    resetStraightenUi();
    document.querySelectorAll(".pe-tool").forEach((b) => {
      b.classList.toggle("active", b.dataset.tool === tool);
      b.setAttribute("aria-pressed", String(b.dataset.tool === tool));
    });
    $("pe-apply-crop").hidden = tool !== "select" || !cropRect;
    // Changing tool abandons a shape still being drawn (the finished
    // selection itself stays).
    if (tool !== previousTool) selDraft = null;
    $("pe-rect-radius-label").hidden = tool !== "rect";
    $("pe-text-font").hidden = tool !== "text";
    $("pe-apply-text-style").hidden = tool !== "text";
    $("pe-save-text-style").hidden = tool !== "text";
    $("pe-delete-text-style").hidden = tool !== "text";
    if (tool === "text") {
      ensureCustomFontLoaded().then((family) => {
        const fontSelect = $("pe-text-font");
        const customOption = fontSelect.querySelector('option[value="custom"]');
        customOption.disabled = !family;
        customOption.textContent = family
          ? `Site's custom font (${family})`
          : lastFontLoadFailed
          ? "Site's custom font (failed to load — check Site Settings)"
          : "Site's custom font (none uploaded)";
        // Don't leave the dropdown silently pointed at an option that just
        // got disabled -- e.g. the admin picked "custom" before this
        // async check resolved false, or a font was uploaded then later
        // removed from Site Settings between sessions.
        if (!family && fontSelect.value === "custom") fontSelect.value = "sans-serif";
      });
    }
    overlay.style.cursor = tool === "pan" ? "grab" : "";
    redrawOverlay();
  }

  document.querySelectorAll(".pe-tool").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  // ---------- Crop / select ----------
  function normalizedCrop(r) {
    // x/y and w/h are rounded independently here, but x0/y0/x1/y1 are
    // continuous mouse-derived coordinates (see pointFromEvent) -- so a
    // rect whose unrounded edges land exactly on the canvas boundary (the
    // ratio-lock clamp in applyCropRatio deliberately produces exactly
    // this when a drag is clamped against an edge) can round to a width
    // one pixel past that edge. getImageData doesn't throw for that, it
    // silently reads a transparent-black strip past the edge, so the
    // extra pixel bakes a real (if 1px) defect into the crop instead of
    // erroring. Clamping x/y first, then w/h against what's actually left
    // of the canvas from there, keeps the final rect provably in-bounds.
    const x = Math.max(0, Math.min(canvas.width, Math.round(Math.min(r.x0, r.x1))));
    const y = Math.max(0, Math.min(canvas.height, Math.round(Math.min(r.y0, r.y1))));
    const w = Math.max(0, Math.min(canvas.width - x, Math.round(Math.abs(r.x1 - r.x0))));
    const h = Math.max(0, Math.min(canvas.height - y, Math.round(Math.abs(r.y1 - r.y0))));
    return { x, y, w, h };
  }

  // Constrains a drag endpoint to a fixed aspect ratio, keeping x0/y0 as
  // the anchor corner. Clamped in two passes (width against the canvas
  // edge in the drag's x direction, then height against the edge in its y
  // direction, each time recomputing the other dimension from the ratio)
  // rather than one -- clamping only one dimension first can leave the
  // other still over its own edge, since shrinking a dimension to fit its
  // own bound never grows the other, so a second pass is guaranteed to
  // finish inside both bounds without ever breaking the ratio.
  function applyCropRatio(x0, y0, x1, y1) {
    const ratioStr = $("pe-crop-ratio").value;
    if (ratioStr === "free") return { x1, y1 };
    const [rw, rh] = ratioStr.split(":").map(Number);
    const ratio = rw / rh;
    const signX = x1 < x0 ? -1 : 1;
    const signY = y1 < y0 ? -1 : 1;
    let w = Math.abs(x1 - x0);
    let h = Math.abs(y1 - y0);
    if (w / ratio >= h) {
      h = w / ratio;
    } else {
      w = h * ratio;
    }
    const maxW = signX > 0 ? canvas.width - x0 : x0;
    const maxH = signY > 0 ? canvas.height - y0 : y0;
    if (w > maxW) {
      w = maxW;
      h = w / ratio;
    }
    if (h > maxH) {
      h = maxH;
      w = h * ratio;
    }
    return { x1: x0 + signX * w, y1: y0 + signY * h };
  }

  // Four dim bands around the crop box (rather than a full dim with a hole
  // punched out), so a selection outline or tint inside the box stays visible.
  function paintCropRect() {
    const r = normalizedCrop(cropRect);
    octx.save();
    octx.fillStyle = "rgba(0,0,0,0.5)";
    octx.fillRect(0, 0, overlay.width, r.y);
    octx.fillRect(0, r.y + r.h, overlay.width, overlay.height - (r.y + r.h));
    octx.fillRect(0, r.y, r.x, r.h);
    octx.fillRect(r.x + r.w, r.y, overlay.width - (r.x + r.w), r.h);
    octx.strokeStyle = "#ff7a45";
    // Screen-sized when zoomed in (an image pixel is several screen pixels there).
    const zoomDiv = Math.max(1, currentScale());
    // The overlay is at image resolution, so the thinnest stroke that reads is one
    // image pixel (several screen pixels when zoomed in).
    octx.lineWidth = zoomDiv > 1 ? 1 : Math.max(2, canvas.width * 0.002);
    octx.setLineDash(zoomDiv > 1 ? [4, 3] : [8, 6]);
    octx.strokeRect(r.x, r.y, r.w, r.h);
    octx.restore();
  }

  function drawCropOverlay() {
    clearOverlay();
    if (!cropRect) return;
    paintCropRect();
  }

  // Repaint everything that lives on the overlay between tool gestures: the
  // selection layer and, on the Select/Crop tool, a pending crop box.
  function redrawOverlay() {
    clearOverlay();
    if (currentTool === "select" && cropRect) paintCropRect();
  }

  // Re-constrains an already-drawn selection when the ratio is changed
  // mid-edit, rather than leaving a stale free-form rectangle on screen
  // that doesn't match the ratio the next Apply Crop would silently jump
  // to (applyCropRatio only runs during the drag itself, not on an
  // already-finished selection).
  $("pe-crop-ratio").addEventListener("change", () => {
    // Also guards on currentTool -- without it, switching to another tool
    // (e.g. Erase) after drawing a selection and then changing the ratio
    // "just to see" redraws the crop mask overlay (a full-canvas dark fill
    // plus the dashed selection rect) on top of whatever tool is actually
    // active, since setTool() doesn't clear cropRect when switching away
    // from "select" -- it stays there until the next pointermove happens
    // to clear the overlay for its own tool's reasons.
    if (currentTool !== "select" || !cropRect) return;
    const constrained = applyCropRatio(cropRect.x0, cropRect.y0, cropRect.x1, cropRect.y1);
    cropRect.x1 = constrained.x1;
    cropRect.y1 = constrained.y1;
    drawCropOverlay();
  });

  $("pe-apply-crop").addEventListener("click", () => {
    // A critic pass found this (and four sibling actions below) missing
    // the same isComparing() guard undo()/redo()/resetToOriginal() already
    // have -- without it, applying while Compare is held operates on the
    // temporary original-image preview currently on the canvas rather than
    // the real edited state, pushes a bogus undo entry snapshotting that
    // preview, and the whole action is then silently discarded the instant
    // Compare is released and endCompare() overwrites the canvas back to
    // the real state -- no error, just a vanished edit and corrupted undo
    // history. Reachable without multi-touch too, since Compare also has a
    // held-key binding (Space/Enter), so a mouse click can trigger any of
    // these while a keyboard hold has Compare active.
    if (isComparing()) return;
    if (!cropRect) return;
    const r = normalizedCrop(cropRect);
    if (r.w < 2 || r.h < 2) return;
    pushUndo();
    const data = ctx.getImageData(r.x, r.y, r.w, r.h);
    canvas.width = r.w;
    canvas.height = r.h;
    ctx.putImageData(data, 0, 0);
    syncOverlaySize();
    // Was: manually clearing cropRect/hiding the button/clearing the
    // overlay inline. Replaced with cancelActiveDrag() (same as rotate90()/
    // flip() already do) after a critic pass found this handler was still
    // missing baseSnapshot invalidation specifically -- a multi-touch drag
    // held open on an adjust slider while Apply Crop is tapped would
    // otherwise resume against the pre-crop canvas on the drag's next
    // tick, painting the OLD dimensions' pixels back over the newly
    // resized canvas at the wrong scale/offset, destroying the crop.
    cancelActiveDrag();
    fitCanvasToViewport();
  });

  // ---------- Selection ----------
  // A selection is the list of shapes that made it (rectangles, ellipses,
  // lasso/polygon outlines, each added, subtracted or intersected, plus
  // inversions), drawn into an alpha mask the size of the canvas. While one
  // exists, the pixel edits below are limited to the masked area: the Adjust
  // sliders and presets, the one-shot filters and grain, the brushes, the Draw &
  // annotate shapes and Text, and Delete selected. Anything that changes the
  // canvas geometry (crop, rotate, flip, resize, straighten) drops it, since its
  // coordinates no longer describe the image; the shapes are also what "Save
  // selection" stores, as fractions of the image size, so a saved one fits any
  // image. Selection changes are undoable (see pushSelectionUndo).
  const SELECTION_TOOLS = ["sel-rect", "sel-ellipse", "sel-lasso", "sel-poly"];
  const SELECTION_KIND = { "sel-rect": "rect", "sel-ellipse": "ellipse", "sel-lasso": "poly", "sel-poly": "poly" };
  const SELECTION_MAX_POINTS = 1500;
  const SELECTION_MAX_OPS = 40;
  const MODE_GLYPH = { add: "+", sub: "−", int: "∩" };
  let selectionPresets = [];
  let selectionNoteText = "";
  let selScratch = [null, null];
  let selOverlayFrame = 0;

  function hasSelection() {
    return selBounds !== null && selMask !== null && selMask.width === canvas.width && selMask.height === canvas.height;
  }

  function displayScale() {
    return (parseFloat(overlay.style.width) || canvas.width) / canvas.width || 1;
  }

  function scratchCanvas(i) {
    let c = selScratch[i];
    if (!c || c.width !== canvas.width || c.height !== canvas.height) {
      c = document.createElement("canvas");
      c.width = canvas.width;
      c.height = canvas.height;
      selScratch[i] = c;
    }
    const cx = c.getContext("2d");
    cx.setTransform(1, 0, 0, 1, 0, 0);
    cx.globalCompositeOperation = "source-over";
    cx.globalAlpha = 1;
    cx.filter = "none";
    cx.clearRect(0, 0, c.width, c.height);
    return c;
  }

  function tracePath(c, op) {
    c.beginPath();
    if (op.kind === "rect") c.rect(op.box[0], op.box[1], op.box[2], op.box[3]);
    else if (op.kind === "ellipse") c.ellipse(op.box[0] + op.box[2] / 2, op.box[1] + op.box[3] / 2, op.box[2] / 2, op.box[3] / 2, 0, 0, Math.PI * 2);
    else {
      op.pts.forEach(([x, y], i) => (i ? c.lineTo(x, y) : c.moveTo(x, y)));
      c.closePath();
    }
  }

  function rasterizeSelection() {
    const w = canvas.width;
    const h = canvas.height;
    selMask = document.createElement("canvas");
    selMask.width = w;
    selMask.height = h;
    selMaskCtx = selMask.getContext("2d", { willReadFrequently: true });
    for (const op of selOps) {
      if (op.kind === "invert") {
        const flipped = scratchCanvas(0);
        const fc = flipped.getContext("2d");
        fc.fillStyle = "#000";
        fc.fillRect(0, 0, w, h);
        fc.globalCompositeOperation = "destination-out";
        fc.drawImage(selMask, 0, 0);
        selMaskCtx.clearRect(0, 0, w, h);
        selMaskCtx.drawImage(flipped, 0, 0);
        continue;
      }
      selMaskCtx.save();
      selMaskCtx.globalCompositeOperation = op.mode === "sub" ? "destination-out" : op.mode === "int" ? "destination-in" : "source-over";
      selMaskCtx.fillStyle = "#000";
      tracePath(selMaskCtx, op);
      selMaskCtx.fill();
      selMaskCtx.restore();
    }
  }

  // Bounding box and coverage of what the mask actually selects (null when
  // nothing is selected, e.g. after subtracting everything). Keeps the pixels
  // for the outline.
  function analyseSelection() {
    const w = canvas.width;
    const h = canvas.height;
    const data = selMaskCtx.getImageData(0, 0, w, h).data;
    selMaskData = data;
    let minX = w;
    let minY = h;
    let maxX = -1;
    let maxY = -1;
    let count = 0;
    for (let y = 0; y < h; y++) {
      const row = y * w * 4;
      for (let x = 0; x < w; x++) {
        if (data[row + x * 4 + 3] > 127) {
          count++;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return count ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1, coverage: count / (w * h) } : null;
  }

  function selectionNote(text) {
    selectionNoteText = text;
    updateSelectionUi();
  }

  function updateSelectionUi() {
    const on = hasSelection();
    const gated = ["pe-sel-invert", "pe-sel-clear", "pe-sel-delete", "pe-sel-crop", "pe-save-selection"];
    // A button that disables itself (Deselect, or Invert that emptied the
    // selection) must not strand keyboard focus on the page body.
    const focusedGated = gated.some((id) => document.activeElement === $(id));
    gated.forEach((id) => ($(id).disabled = !on));
    if (focusedGated && !on) $("pe-sel-all").focus();
    let base = on
      ? `Selection: ${selBounds.w} × ${selBounds.h} px bounding box, ${Math.max(1, Math.round(selBounds.coverage * 100))}% of the image. Edits apply inside it only.`
      : "No selection.";
    if (on && $("pe-sel-view").value === "mask") base += " Mask view hides the image.";
    const text = selectionNoteText ? `${selectionNoteText} ${base}` : base;
    const statusEl = $("pe-sel-status");
    statusEl.textContent = text;
    statusEl.title = text;
    // Nothing to report: keep the line for screen readers but out of the layout.
    statusEl.classList.toggle("is-idle", !on && !selectionNoteText);
  }

  function dropSelection(note) {
    selOps = [];
    selMask = null;
    selMaskCtx = null;
    selMaskData = null;
    selOverlay = null;
    selOverlayScale = 0;
    selEdge = null;
    selEdgeScale = 0;
    selBounds = null;
    selDraft = null;
    selScratch = [null, null];
    selectionNoteText = note || "";
    updateSelectionUi();
    redrawOverlay();
  }

  function rebuildSelection() {
    if (!selOps.length) {
      dropSelection();
      return;
    }
    rasterizeSelection();
    selBounds = analyseSelection();
    finishSelectionRebuild();
  }

  // Everything after the mask is rasterised and its bounds are known.
  function finishSelectionRebuild() {
    if (!selBounds) {
      dropSelection("The selection ended up empty, so it was cleared.");
      return;
    }
    selectionNoteText = "";
    selEdge = null;
    // The next slider tick must repaint from pixels that respect the new mask.
    invalidateOpenAdjustDrag();
    rebuildSelectionOverlay();
    updateSelectionUi();
    fillSelectionBoxFields();
    redrawOverlay();
  }

  // The outline: selected pixels with an unselected neighbour one screen pixel
  // away, drawn twice (dark, then light, nudged apart) so it reads on any image.
  function buildEdgeLayer() {
    const w = canvas.width;
    const h = canvas.height;
    const t = Math.max(1, Math.round(1 / displayScale()));
    const src = selMaskData;
    const edge = new Uint8Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        if (src[((row + x) << 2) + 3] <= 127) continue;
        const l = x - t;
        const r = x + t;
        const u = y - t;
        const d = y + t;
        if (l < 0 || r >= w || u < 0 || d >= h || src[((row + l) << 2) + 3] <= 127 || src[((row + r) << 2) + 3] <= 127 || src[((u * w + x) << 2) + 3] <= 127 || src[((d * w + x) << 2) + 3] <= 127) edge[row + x] = 1;
      }
    }
    const out = new Uint32Array(w * h);
    for (let y = 0; y < h - t; y++) {
      const row = y * w;
      for (let x = 0; x < w - t; x++) if (edge[row + x]) out[(y + t) * w + x + t] = 0xff000000;
    }
    for (let i = 0; i < edge.length; i++) if (edge[i]) out[i] = 0xffffffff;
    const layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    layer.getContext("2d").putImageData(new ImageData(new Uint8ClampedArray(out.buffer), w, h), 0, 0);
    selEdgeScale = displayScale();
    return layer;
  }

  // The tint / mask view and the outline are composed once into a cached layer
  // that clearOverlay() lays down, so the (frequent) overlay clears made by the
  // brush cursor and other tools stay cheap. The outline itself is cached
  // separately, so changing the view or tint colour doesn't recompute it.
  function rebuildSelectionOverlay() {
    selOverlay = null;
    if (!hasSelection()) return;
    const w = canvas.width;
    const h = canvas.height;
    const layer = document.createElement("canvas");
    layer.width = w;
    layer.height = h;
    const lc = layer.getContext("2d");
    const view = $("pe-sel-view").value;
    if (view === "mask") {
      lc.fillStyle = "#000";
      lc.fillRect(0, 0, w, h);
      const white = document.createElement("canvas");
      white.width = w;
      white.height = h;
      const wc = white.getContext("2d");
      wc.fillStyle = "#fff";
      wc.fillRect(0, 0, w, h);
      wc.globalCompositeOperation = "destination-in";
      wc.drawImage(selMask, 0, 0);
      lc.drawImage(white, 0, 0);
      selOverlay = layer;
      selOverlayScale = displayScale();
      return;
    }
    if (view === "inside" || view === "outside") {
      const tint = document.createElement("canvas");
      tint.width = w;
      tint.height = h;
      const tc = tint.getContext("2d");
      tc.fillStyle = $("pe-sel-tint").value;
      tc.fillRect(0, 0, w, h);
      tc.globalCompositeOperation = view === "inside" ? "destination-in" : "destination-out";
      tc.drawImage(selMask, 0, 0);
      lc.globalAlpha = 0.45;
      lc.drawImage(tint, 0, 0);
      lc.globalAlpha = 1;
    }
    if (!selEdge || selEdge.width !== w || selEdge.height !== h || Math.abs(selEdgeScale - displayScale()) > 0.01) selEdge = buildEdgeLayer();
    lc.drawImage(selEdge, 0, 0);
    selOverlay = layer;
    selOverlayScale = displayScale();
  }

  // Dragging the colour picker fires many input events; repaint once per frame.
  function scheduleSelectionOverlay() {
    if (selOverlayFrame) return;
    selOverlayFrame = requestAnimationFrame(() => {
      selOverlayFrame = 0;
      rebuildSelectionOverlay();
      redrawOverlay();
      updateSelectionUi();
    });
  }
  $("pe-sel-view").addEventListener("change", scheduleSelectionOverlay);
  $("pe-sel-tint").addEventListener("input", () => {
    if ($("pe-sel-view").value === "ants" || $("pe-sel-view").value === "mask") return;
    scheduleSelectionOverlay();
  });

  // Replace the canvas content inside the selection with `after`, keeping
  // `before` outside it (soft edges blend, since the mask is antialiased).
  function blendThroughSelection(before, after) {
    const inside = scratchCanvas(0);
    const ic = inside.getContext("2d");
    ic.drawImage(after, 0, 0);
    ic.globalCompositeOperation = "destination-in";
    ic.drawImage(selMask, 0, 0);
    const outside = scratchCanvas(1);
    const oc = outside.getContext("2d");
    oc.drawImage(before, 0, 0);
    oc.globalCompositeOperation = "destination-out";
    oc.drawImage(selMask, 0, 0);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    ctx.filter = "none";
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(outside, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(inside, 0, 0);
    ctx.restore();
  }

  // Runs a drawing action on the canvas and, if there is a selection, keeps its
  // result inside the selection only.
  function withSelectionClip(draw) {
    if (!hasSelection()) {
      draw();
      return;
    }
    const before = snapshotCanvas();
    draw();
    blendThroughSelection(before, snapshotCanvas());
  }

  // Repaint the canvas from `base` with a CSS filter, limited to the selection
  // when there is one. Used by the Adjust sliders, presets and filter buttons.
  function paintFiltered(base, filter) {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!hasSelection()) {
      ctx.save();
      ctx.filter = filter;
      ctx.drawImage(base, 0, 0);
      ctx.restore();
      return;
    }
    const inside = scratchCanvas(0);
    const ic = inside.getContext("2d");
    ic.filter = filter;
    ic.drawImage(base, 0, 0);
    ic.filter = "none";
    ic.globalCompositeOperation = "destination-in";
    ic.drawImage(selMask, 0, 0);
    const outside = scratchCanvas(1);
    const oc = outside.getContext("2d");
    oc.drawImage(base, 0, 0);
    oc.globalCompositeOperation = "destination-out";
    oc.drawImage(selMask, 0, 0);
    ctx.save();
    ctx.globalCompositeOperation = "source-over";
    ctx.drawImage(outside, 0, 0);
    ctx.globalCompositeOperation = "lighter";
    ctx.drawImage(inside, 0, 0);
    ctx.restore();
  }

  // ---- drawing a selection ----
  // The Mode menu sets how a new shape combines with the current selection;
  // holding Shift (add) or Alt (subtract) overrides it for one shape.
  function selectionModeFor(e) {
    return e.shiftKey ? "add" : e.altKey ? "sub" : $("pe-sel-mode").value || "replace";
  }

  function clampToCanvas(x, y) {
    return [Math.max(0, Math.min(canvas.width, x)), Math.max(0, Math.min(canvas.height, y))];
  }

  function beginSelectionDraft(e, p) {
    const kind = SELECTION_KIND[currentTool];
    if (currentTool === "sel-poly") {
      dragging = false;
      dragStart = null;
      if (!selDraft || !selDraft.polyClick) {
        selDraft = { kind: "poly", polyClick: true, mode: selectionModeFor(e), pts: [clampToCanvas(p.x, p.y)], cursor: p };
      } else {
        const first = selDraft.pts[0];
        const [cx, cy] = clampToCanvas(p.x, p.y);
        if (selDraft.pts.length >= 3 && Math.hypot(cx - first[0], cy - first[1]) * displayScale() < 10) {
          finishPolygon();
          return;
        }
        const last = selDraft.pts[selDraft.pts.length - 1];
        if (Math.hypot(cx - last[0], cy - last[1]) * displayScale() >= 2) selDraft.pts.push([cx, cy]);
        selDraft.cursor = p;
      }
      drawSelectionDraft();
      return;
    }
    const [cx, cy] = clampToCanvas(p.x, p.y);
    selDraft = { kind, mode: selectionModeFor(e), x0: cx, y0: cy, x1: cx, y1: cy, pts: kind === "poly" ? [[cx, cy]] : [] };
  }

  function updateSelectionDraft(p) {
    if (!selDraft) return;
    const [cx, cy] = clampToCanvas(p.x, p.y);
    if (selDraft.polyClick) {
      selDraft.cursor = { x: cx, y: cy };
    } else {
      if (!dragging) return;
      selDraft.x1 = cx;
      selDraft.y1 = cy;
      if (currentTool === "sel-lasso") {
        const last = selDraft.pts[selDraft.pts.length - 1];
        if (Math.hypot(cx - last[0], cy - last[1]) * displayScale() >= 2) selDraft.pts.push([cx, cy]);
      }
    }
    drawSelectionDraft();
  }

  // The in-progress shape: a dark line with a light dashed one over it (pink
  // to subtract, blue to intersect), plus a + / − / ∩ mark at its start.
  function drawSelectionDraft() {
    clearOverlay();
    const d = selDraft;
    if (!d) return;
    const px = 1 / displayScale();
    const path = () => {
      octx.beginPath();
      if (d.kind === "rect" || d.kind === "ellipse") {
        const x = Math.min(d.x0, d.x1);
        const y = Math.min(d.y0, d.y1);
        const w = Math.abs(d.x1 - d.x0);
        const h = Math.abs(d.y1 - d.y0);
        if (d.kind === "rect") octx.rect(x, y, w, h);
        else octx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
      } else {
        d.pts.forEach(([x, y], i) => (i ? octx.lineTo(x, y) : octx.moveTo(x, y)));
        if (d.polyClick && d.cursor) octx.lineTo(d.cursor.x, d.cursor.y);
        else octx.closePath();
      }
    };
    octx.save();
    octx.lineJoin = "round";
    octx.lineWidth = 2.5 * px;
    octx.strokeStyle = "#000";
    path();
    octx.stroke();
    octx.lineWidth = 1.2 * px;
    octx.strokeStyle = d.mode === "sub" ? "#ff9a9a" : d.mode === "int" ? "#8fe3ff" : "#fff";
    octx.setLineDash([6 * px, 4 * px]);
    path();
    octx.stroke();
    if (d.polyClick) {
      octx.setLineDash([]);
      octx.fillStyle = "#fff";
      octx.strokeStyle = "#000";
      octx.lineWidth = 1.5 * px;
      d.pts.forEach(([x, y], i) => {
        octx.beginPath();
        octx.arc(x, y, (i === 0 ? 5 : 3.5) * px, 0, Math.PI * 2);
        octx.fill();
        octx.stroke();
      });
    }
    if (MODE_GLYPH[d.mode]) {
      const [ax, ay] = d.polyClick || d.kind === "poly" ? d.pts[0] : [Math.min(d.x0, d.x1), Math.min(d.y0, d.y1)];
      octx.setLineDash([]);
      octx.font = `bold ${15 * px}px sans-serif`;
      octx.textBaseline = "bottom";
      octx.lineWidth = 3 * px;
      octx.strokeStyle = "#000";
      octx.fillStyle = "#fff";
      octx.strokeText(MODE_GLYPH[d.mode], ax + 4 * px, ay - 2 * px);
      octx.fillText(MODE_GLYPH[d.mode], ax + 4 * px, ay - 2 * px);
    }
    octx.restore();
  }

  function decimatePoints(pts, maxPoints) {
    if (pts.length <= maxPoints) return pts;
    const out = [];
    for (let i = 0; i < maxPoints; i++) out.push(pts[Math.floor((i * pts.length) / maxPoints)]);
    return out;
  }

  // Area of the box around the points (a crossing lasso or bow-tie has no
  // meaningful signed area, but it is still a real shape).
  function pointsBoxArea(pts) {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const [x, y] of pts) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }
    return (maxX - minX) * (maxY - minY);
  }

  function roundPt(v) {
    return Math.round(v * 10) / 10;
  }

  function applySelectionOp(op, mode) {
    if ((mode === "sub" || mode === "int") && !hasSelection()) {
      selectionNote(`There is no selection to ${mode === "sub" ? "subtract from" : "intersect with"}; make one first.`);
      redrawOverlay();
      return;
    }
    const added = { ...op, mode: mode === "sub" ? "sub" : mode === "int" ? "int" : "add" };
    const next = mode === "replace" || !hasSelection() ? [added] : [...selOps, added];
    // Redoing exactly what is already there (Select all twice) changes nothing,
    // so it isn't a history step either.
    if (JSON.stringify(next) === JSON.stringify(selOps)) {
      redrawOverlay();
      return;
    }
    if (!hasSelection()) {
      pushSelectionUndo();
      selOps = next;
      rebuildSelection();
      return;
    }
    // Rasterise the result first: a shape that changes nothing you can see (a
    // rectangle wholly inside the selection, a subtraction wholly outside it)
    // isn't a history step.
    const before = { ops: selOps, mask: selMask, ctx: selMaskCtx, data: selMaskData };
    selOps = next;
    rasterizeSelection();
    const nextBounds = analyseSelection();
    if (nextBounds && sameSelectionAlpha(before.data, selMaskData)) {
      selOps = before.ops;
      selMask = before.mask;
      selMaskCtx = before.ctx;
      selMaskData = before.data;
      selectionNote("That shape doesn't change the selection.");
      redrawOverlay();
      return;
    }
    selOps = before.ops;
    pushSelectionUndo();
    selOps = next;
    selBounds = nextBounds;
    finishSelectionRebuild();
  }

  // Two rasterised masks that select the same pixels (alpha within one unit).
  function sameSelectionAlpha(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (let i = 3; i < a.length; i += 4) {
      const d = a[i] - b[i];
      if (d > 1 || d < -1) return false;
    }
    return true;
  }

  // True when the points lie (almost) on one straight line, which encloses
  // nothing (a lasso dragged in a straight line, or collinear polygon corners).
  function pointsAreCollinear(pts) {
    const [ax, ay] = pts[0];
    let far = pts[0];
    let farDist = 0;
    for (const [x, y] of pts) {
      const dist = Math.hypot(x - ax, y - ay);
      if (dist > farDist) {
        farDist = dist;
        far = [x, y];
      }
    }
    if (farDist === 0) return true;
    const dx = (far[0] - ax) / farDist;
    const dy = (far[1] - ay) / farDist;
    let maxOff = 0;
    for (const [x, y] of pts) maxOff = Math.max(maxOff, Math.abs((x - ax) * dy - (y - ay) * dx));
    return maxOff * displayScale() < 2;
  }

  function commitSelectionDraft() {
    const d = selDraft;
    selDraft = null;
    if (!d) {
      redrawOverlay();
      return;
    }
    const scale = displayScale();
    let op = null;
    if (d.kind === "rect" || d.kind === "ellipse") {
      const x = Math.min(d.x0, d.x1);
      const y = Math.min(d.y0, d.y1);
      const w = Math.abs(d.x1 - d.x0);
      const h = Math.abs(d.y1 - d.y0);
      if (w * scale >= 3 && h * scale >= 3) op = { kind: d.kind, box: [roundPt(x), roundPt(y), roundPt(w), roundPt(h)] };
    } else if (d.pts.length >= 3) {
      const pts = decimatePoints(d.pts, SELECTION_MAX_POINTS).map(([x, y]) => [roundPt(x), roundPt(y)]);
      if (pointsBoxArea(pts) * scale * scale >= 9 && !pointsAreCollinear(pts)) op = { kind: "poly", pts };
    }
    if (!op) {
      // A plain click with a selection tool clears the selection, like most editors.
      if (d.mode === "replace" && hasSelection()) deselect();
      else redrawOverlay();
      return;
    }
    applySelectionOp(op, d.mode);
  }

  function finishPolygon() {
    const d = selDraft;
    if (!d || !d.polyClick) return;
    selDraft = null;
    if (d.pts.length < 3) {
      selectionNote("A polygon needs at least three corners.");
      redrawOverlay();
      return;
    }
    const pts = d.pts.map(([x, y]) => [roundPt(x), roundPt(y)]);
    if (pointsBoxArea(pts) * displayScale() * displayScale() < 9 || pointsAreCollinear(pts)) {
      selectionNote("That polygon was too small, or too flat, to select anything.");
      redrawOverlay();
      return;
    }
    applySelectionOp({ kind: "poly", pts }, d.mode);
  }

  overlay.addEventListener("dblclick", () => {
    if (currentTool === "sel-poly" && selDraft && selDraft.polyClick) finishPolygon();
  });

  // ---- actions ----
  function deselect() {
    if (isComparing() || !hasSelection()) return;
    pushSelectionUndo();
    dropSelection();
  }

  $("pe-sel-all").addEventListener("click", () => {
    if (isComparing()) return;
    applySelectionOp({ kind: "rect", box: [0, 0, canvas.width, canvas.height] }, "replace");
  });

  $("pe-sel-invert").addEventListener("click", () => {
    if (isComparing() || !hasSelection()) return;
    pushSelectionUndo();
    if (selOps.length && selOps[selOps.length - 1].kind === "invert") selOps.pop();
    else selOps.push({ kind: "invert" });
    rebuildSelection();
  });

  $("pe-sel-clear").addEventListener("click", deselect);

  $("pe-sel-delete").addEventListener("click", () => {
    if (isComparing() || !hasSelection()) return;
    pushUndo();
    ctx.save();
    ctx.globalCompositeOperation = "destination-out";
    ctx.drawImage(selMask, 0, 0);
    ctx.restore();
    invalidateOpenAdjustDrag();
    selectionNote("Deleted the selected pixels (they're transparent now; Undo brings them back).");
  });

  $("pe-sel-crop").addEventListener("click", () => {
    if (isComparing() || !hasSelection()) return;
    const b = selBounds;
    cropRect = { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
    setTool("select");
    drawCropOverlay();
    $("pe-apply-crop").hidden = false;
    $("pe-apply-crop").focus();
  });

  // ---- numeric box (a keyboard-friendly way to make a rectangle) ----
  function fillSelectionBoxFields() {
    if (!selBounds) return;
    $("pe-sel-box-x").value = selBounds.x;
    $("pe-sel-box-y").value = selBounds.y;
    $("pe-sel-box-w").value = selBounds.w;
    $("pe-sel-box-h").value = selBounds.h;
  }

  // A fresh image starts with the whole-image box and the section folded away
  // (the old numbers described another image).
  function resetSelectionBox() {
    $("pe-sel-box-x").value = 0;
    $("pe-sel-box-y").value = 0;
    $("pe-sel-box-w").value = canvas.width;
    $("pe-sel-box-h").value = canvas.height;
    document.querySelector(".pe-sel-box").open = false;
  }

  $("pe-sel-box-apply").addEventListener("click", () => {
    if (isComparing()) return;
    const num = (id) => Math.round(Number($(id).value));
    // An empty field would read as 0 (Number("") === 0); make the user say so.
    if (["x", "y", "w", "h"].some((k) => $("pe-sel-box-" + k).value.trim() === "")) {
      selectionNote("Fill in X, Y, width and height first.");
      return;
    }
    let x = num("pe-sel-box-x");
    let y = num("pe-sel-box-y");
    let w = num("pe-sel-box-w");
    let h = num("pe-sel-box-h");
    if (![x, y, w, h].every(Number.isFinite) || w < 1 || h < 1) {
      selectionNote("Enter a width and height of at least 1 pixel.");
      return;
    }
    // Clip each edge to the image, so a box hanging off one side keeps its inside part.
    const x0 = Math.max(0, x);
    const y0 = Math.max(0, y);
    const x1 = Math.min(canvas.width, x + w);
    const y1 = Math.min(canvas.height, y + h);
    if (x1 - x0 < 1 || y1 - y0 < 1) {
      selectionNote("That box is outside the image.");
      return;
    }
    applySelectionOp({ kind: "rect", box: [x0, y0, x1 - x0, y1 - y0] }, $("pe-sel-mode").value || "replace");
  });
  ["pe-sel-box-x", "pe-sel-box-y", "pe-sel-box-w", "pe-sel-box-h"].forEach((id) =>
    $(id).addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        $("pe-sel-box-apply").click();
      }
    })
  );

  // ---- saved selections ----
  function updateSavedSelectionButtons() {
    const chosen = selectionPresets.some((p) => p.id === Number($("pe-apply-selection").value));
    // A button that disables itself (after deleting the chosen selection) must
    // not strand keyboard focus on the page body.
    const focusedGated = document.activeElement === $("pe-load-selection") || document.activeElement === $("pe-delete-selection");
    $("pe-load-selection").disabled = !chosen;
    $("pe-delete-selection").disabled = !chosen;
    if (focusedGated && !chosen) $("pe-apply-selection").focus();
  }
  $("pe-apply-selection").addEventListener("change", updateSavedSelectionButtons);

  async function loadSelectionPresets() {
    try {
      selectionPresets = (await window.adminApi("/selection-presets")) || [];
    } catch {
      selectionPresets = [];
    }
    const select = $("pe-apply-selection");
    select.innerHTML =
      `<option value="">Load saved selection…</option>` +
      selectionPresets.map((p) => `<option value="${p.id}">${escapeHtmlAttr(p.name)}</option>`).join("");
    updateSavedSelectionButtons();
  }

  // Shapes as fractions of the image size, at most 2000 points in all.
  function selectionForSave() {
    const w = canvas.width;
    const h = canvas.height;
    const total = selOps.reduce((n, op) => n + (op.kind === "poly" ? op.pts.length : 0), 0);
    const keep = total > 2000 ? 2000 / total : 1;
    return selOps.map((op) => {
      if (op.kind === "invert") return { kind: "invert" };
      if (op.kind === "poly") {
        const pts = decimatePoints(op.pts, Math.max(3, Math.floor(op.pts.length * keep)));
        return { kind: "poly", mode: op.mode, pts: pts.map(([x, y]) => [x / w, y / h]) };
      }
      return { kind: op.kind, mode: op.mode, box: [op.box[0] / w, op.box[1] / h, op.box[2] / w, op.box[3] / h] };
    });
  }

  $("pe-save-selection").addEventListener("click", async () => {
    if (!hasSelection()) return;
    if (selOps.length > SELECTION_MAX_OPS) {
      alert(`This selection is made of ${selOps.length} shapes; a saved selection can have at most ${SELECTION_MAX_OPS}. Simplify it (Deselect and redraw) before saving.`);
      return;
    }
    const name = await promptForText("Save selection", "Selection name");
    if (name === null) return;
    try {
      await window.adminApi("/selection-presets", { method: "POST", body: JSON.stringify({ name: name.trim(), ops: selectionForSave() }) });
      await loadSelectionPresets();
      selectionNote(`Saved "${name.trim()}".`);
    } catch (err) {
      alert(err.message);
    }
  });

  $("pe-load-selection").addEventListener("click", () => {
    const id = Number($("pe-apply-selection").value);
    const preset = selectionPresets.find((p) => p.id === id);
    if (!preset || isComparing()) return;
    const w = canvas.width;
    const h = canvas.height;
    pushSelectionUndo();
    selOps = preset.ops.map((op) => {
      if (op.kind === "invert") return { kind: "invert" };
      if (op.kind === "poly") return { kind: "poly", mode: op.mode, pts: op.pts.map(([x, y]) => [x * w, y * h]) };
      return { kind: op.kind, mode: op.mode, box: [op.box[0] * w, op.box[1] * h, op.box[2] * w, op.box[3] * h] };
    });
    rebuildSelection();
    if (hasSelection()) selectionNote(`Loaded "${preset.name}".`);
  });

  $("pe-delete-selection").addEventListener("click", async () => {
    const id = Number($("pe-apply-selection").value);
    const preset = selectionPresets.find((p) => p.id === id);
    if (!preset) return;
    if (!confirm(`Delete saved selection "${preset.name}"?`)) return;
    try {
      await window.adminApi(`/selection-presets/${id}`, { method: "DELETE" });
      await loadSelectionPresets();
    } catch (err) {
      // Already gone (say, deleted in another tab): refresh so the list is honest.
      await loadSelectionPresets();
      alert(err.message);
    }
  });

  // ---------- Rotate ----------
  // Any transform that changes canvas content/dimensions out from under an
  // in-progress pointer interaction invalidates whatever that interaction
  // was tracking -- not just a crop selection (the original bug this was
  // written for), but a brush stroke's mask (still sized/oriented for the
  // OLD canvas, so `ensureMask()` will replace it before the next stroke,
  // but the CURRENT one, if still active, would otherwise get composited
  // against post-transform coordinates onto a pre-transform mask) and a
  // shape tool's drag-start anchor (still in OLD coordinate space). Only
  // reachable via multi-touch -- holding a drag with one finger while
  // tapping a toolbar button with another, the same class of scenario
  // `startCompare()`'s own `dragging` guard elsewhere in this file already
  // has to account for -- but a critic pass reviewing the crop-specific
  // fix found it generalizes to every pointer-tracked tool, not just crop.
  // Discards an in-progress adjust-slider (brightness/contrast/saturate)
  // drag rather than letting its next tick resume against a canvas that's
  // since been mutated out from under it -- `baseSnapshot` is a clone
  // taken at the OLD pixels/dimensions when the drag started, and painting
  // it back over the canvas after some OTHER action (rotate, flip, a
  // filter, a preset, a crop, a brush stroke, a shape commit) has already
  // changed what's actually on the canvas would silently erase that
  // action's result. Factored out from `cancelActiveDrag()` (which also
  // clears crop/drag-tool state that isn't relevant to every one of these
  // call sites -- a brush/shape commit inside `pointerup`, for instance,
  // must NOT also clear `cropRect`, since that would wipe out an
  // unrelated in-progress crop selection on an entirely different tool).
  function invalidateOpenAdjustDrag() {
    baseSnapshot = null;
    $("pe-brightness").value = 0;
    $("pe-contrast").value = 0;
    $("pe-saturate").value = 0;
  }

  function cancelActiveDrag() {
    resetStraightenUi();
    cropRect = null;
    $("pe-apply-crop").hidden = true;
    dragging = false;
    dragStart = null;
    strokeActive = false;
    lastPoint = null;
    clearOverlay();
    invalidateOpenAdjustDrag();
  }

  function rotate90(clockwise) {
    if (isComparing()) return;
    pushUndo();
    const w = canvas.width;
    const h = canvas.height;
    const tmp = document.createElement("canvas");
    tmp.width = h;
    tmp.height = w;
    const tctx = tmp.getContext("2d");
    tctx.translate(clockwise ? h : 0, clockwise ? 0 : w);
    tctx.rotate((clockwise ? 1 : -1) * (Math.PI / 2));
    tctx.drawImage(canvas, 0, 0);
    canvas.width = h;
    canvas.height = w;
    ctx.drawImage(tmp, 0, 0);
    syncOverlaySize();
    dropSelection("The selection was cleared because the image was rotated.");
    cancelActiveDrag();
    fitCanvasToViewport();
  }
  $("pe-rotate-left").addEventListener("click", () => rotate90(false));
  $("pe-rotate-right").addEventListener("click", () => rotate90(true));

  // ---------- Flip ----------
  function flip(horizontal) {
    if (isComparing()) return;
    pushUndo();
    const snap = snapshotCanvas();
    ctx.save();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (horizontal) {
      ctx.translate(canvas.width, 0);
      ctx.scale(-1, 1);
    } else {
      ctx.translate(0, canvas.height);
      ctx.scale(1, -1);
    }
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
    dropSelection("The selection was cleared because the image was flipped.");
    cancelActiveDrag();
  }
  $("pe-flip-h").addEventListener("click", () => flip(true));
  $("pe-flip-v").addEventListener("click", () => flip(false));

  // ---------- Straighten ----------
  // Rotates by an arbitrary angle and auto-crops to the largest rectangle of
  // the image's own aspect ratio that fits inside the tilted picture, so no
  // transparent corners are left behind. That rectangle turns by `angle`
  // inside the source, so it fits when its rotated bounding box fits:
  // a*|cos| + b*|sin| <= W and a*|sin| + b*|cos| <= H. The box is kept a
  // little inside the source (2*(|cos|+|sin|) px, about one pixel per side
  // measured across the tilted edge) so anti-aliased edge pixels never survive
  // into the result. Crops under 8px on a side (very thin images at some
  // angles) aren't useful; those are reported as tooSmall and Straighten is
  // disabled.
  function straightenSize(w, h, radians) {
    const c = Math.abs(Math.cos(radians));
    const s = Math.abs(Math.sin(radians));
    const margin = 2 * (c + s);
    const scaleByWidth = (w - margin) / (w * c + h * s);
    const scaleByHeight = (h - margin) / (w * s + h * c);
    const scale = Math.max(0, Math.min(scaleByWidth, scaleByHeight));
    // Floor the side that limits the fit and derive the other from it, so the
    // aspect ratio only drifts by the rounding of the derived side.
    let cw;
    let ch;
    if (scaleByHeight < scaleByWidth) {
      ch = Math.floor(h * scale);
      cw = Math.min(Math.round((ch * w) / h), Math.floor(w * scale));
    } else {
      cw = Math.floor(w * scale);
      ch = Math.min(Math.round((cw * h) / w), Math.floor(h * scale));
    }
    return { w: Math.max(1, cw), h: Math.max(1, ch), tooSmall: cw < 8 || ch < 8 };
  }

  // The preview owns the overlay and dims the whole picture, so it is an
  // exclusive mode: anything else that draws on the overlay or edits pixels
  // (crop drag, brush, shapes, text, adjust sliders, Compare) cancels it first.
  let straightenPreviewing = false;
  const STRAIGHTEN_BUTTON_TITLE = $("pe-apply-straighten").title;
  const STRAIGHTEN_TOO_THIN = "Too thin to straighten at this angle";

  function straightenAngle() {
    const angle = Number($("pe-straighten-angle").value);
    return Number.isFinite(angle) ? angle : 0;
  }

  function resetStraightenUi() {
    straightenPreviewing = false;
    $("pe-straighten-angle").value = 0;
    $("pe-straighten-angle").setAttribute("aria-valuetext", "0.0 degrees");
    $("pe-straighten-number").value = 0;
    $("pe-apply-straighten").disabled = true;
    $("pe-apply-straighten").title = STRAIGHTEN_BUTTON_TITLE;
    $("pe-apply-straighten").removeAttribute("aria-describedby");
    $("pe-straighten-note").hidden = true;
  }

  function cancelStraightenPreview() {
    if (!straightenPreviewing) return;
    resetStraightenUi();
    clearOverlay();
  }

  // Live preview on the overlay: the tilted picture, dimmed outside the crop
  // that would be kept, with a thirds grid to line a horizon up against.
  function drawStraightenPreview() {
    // A tilt can't be started mid-stroke or while Compare shows the original.
    if (dragging || isComparing()) {
      cancelStraightenPreview();
      resetStraightenUi();
      return;
    }
    const angle = straightenAngle();
    const w = canvas.width;
    const h = canvas.height;
    const radians = (angle * Math.PI) / 180;
    const crop = straightenSize(w, h, radians);
    const wasPreviewing = straightenPreviewing;
    $("pe-straighten-angle").setAttribute("aria-valuetext", `${angle.toFixed(1)} degrees`);
    $("pe-apply-straighten").disabled = angle === 0 || crop.tooSmall;
    $("pe-apply-straighten").title = crop.tooSmall && angle !== 0 ? STRAIGHTEN_TOO_THIN : STRAIGHTEN_BUTTON_TITLE;
    $("pe-straighten-note").hidden = !(angle !== 0 && crop.tooSmall);
    if (angle !== 0 && crop.tooSmall) $("pe-apply-straighten").setAttribute("aria-describedby", "pe-straighten-note");
    else $("pe-apply-straighten").removeAttribute("aria-describedby");
    straightenPreviewing = angle !== 0;
    if (!angle) {
      // Only wipe the overlay if a preview was on it; a crop selection may be.
      if (wasPreviewing) clearOverlay();
      return;
    }
    clearOverlay();
    // A crop selection would silently survive underneath the preview.
    cropRect = null;
    $("pe-apply-crop").hidden = true;
    const x = (w - crop.w) / 2;
    const y = (h - crop.h) / 2;
    octx.save();
    octx.fillStyle = "#101010";
    octx.fillRect(0, 0, w, h);
    octx.save();
    octx.translate(w / 2, h / 2);
    octx.rotate(radians);
    octx.drawImage(canvas, -w / 2, -h / 2);
    octx.restore();
    octx.fillStyle = "rgba(0,0,0,0.55)";
    octx.beginPath();
    octx.rect(0, 0, w, h);
    octx.rect(x, y, crop.w, crop.h);
    octx.fill("evenodd");
    octx.strokeStyle = "rgba(255,255,255,0.55)";
    octx.lineWidth = Math.max(1, w * 0.0015);
    octx.beginPath();
    for (let i = 1; i <= 2; i++) {
      octx.moveTo(x + (crop.w * i) / 3, y);
      octx.lineTo(x + (crop.w * i) / 3, y + crop.h);
      octx.moveTo(x, y + (crop.h * i) / 3);
      octx.lineTo(x + crop.w, y + (crop.h * i) / 3);
    }
    octx.stroke();
    octx.strokeStyle = "#ff7a45";
    octx.lineWidth = Math.max(2, w * 0.002);
    octx.strokeRect(x, y, crop.w, crop.h);
    octx.restore();
  }

  $("pe-straighten-angle").addEventListener("input", () => {
    $("pe-straighten-number").value = straightenAngle();
    drawStraightenPreview();
  });
  // Typing: follow every valid number without rewriting the field under the
  // cursor; on commit, snap the field to the clamped, one-decimal value.
  $("pe-straighten-number").addEventListener("input", () => {
    const raw = $("pe-straighten-number").value;
    const typed = Number(raw);
    if (raw.trim() === "" || !Number.isFinite(typed)) return;
    $("pe-straighten-angle").value = Math.max(-45, Math.min(45, typed));
    drawStraightenPreview();
  });
  $("pe-straighten-number").addEventListener("change", () => {
    const typed = Number($("pe-straighten-number").value);
    $("pe-straighten-angle").value = Number.isFinite(typed) ? Math.max(-45, Math.min(45, typed)) : 0;
    $("pe-straighten-number").value = straightenAngle();
    drawStraightenPreview();
  });
  // Double-click resets the tilt; only wipe the overlay if the tilt preview
  // was on it (a crop selection may be there instead).
  $("pe-straighten-angle").addEventListener("dblclick", () => {
    const wasPreviewing = straightenPreviewing;
    resetStraightenUi();
    if (wasPreviewing) clearOverlay();
  });

  $("pe-apply-straighten").addEventListener("click", () => {
    if (isComparing()) return;
    const angle = straightenAngle();
    if (!angle) return;
    const radians = (angle * Math.PI) / 180;
    const w = canvas.width;
    const h = canvas.height;
    const crop = straightenSize(w, h, radians);
    if (crop.tooSmall) return;
    pushUndo();
    const out = document.createElement("canvas");
    out.width = crop.w;
    out.height = crop.h;
    const outCtx = out.getContext("2d");
    outCtx.imageSmoothingQuality = "high";
    outCtx.translate(crop.w / 2, crop.h / 2);
    outCtx.rotate(radians);
    outCtx.drawImage(canvas, -w / 2, -h / 2);
    canvas.width = crop.w;
    canvas.height = crop.h;
    ctx.drawImage(out, 0, 0);
    syncOverlaySize();
    cancelActiveDrag();
    fitCanvasToViewport();
    // The button just disabled itself; keep keyboard users in the control.
    $("pe-straighten-angle").focus();
  });

  // ---------- Resize (scales the actual pixels, unlike Crop which only
  // ever cuts down to a sub-region without stretching anything) ----------
  function refreshResizeFields() {
    $("pe-resize-width").value = canvas.width;
    $("pe-resize-height").value = canvas.height;
  }
  // A critic pass found that typing/pasting a value above MAX_DIMENSION
  // (the HTML `max` attribute only affects spinner arrows/form
  // validation, never a raw `.value` read) let the LOCKED counterpart get
  // computed from that oversized, not-yet-clamped number -- e.g. a
  // 500x2000 image with height typed as 100000 computed a locked width of
  // 25000, which the apply-time clamp then silently squashed to 2000x2000,
  // breaking the very aspect ratio "Lock ratio" promised to preserve, with
  // no warning. Clamping the just-edited field to MAX_DIMENSION here,
  // before computing its counterpart, means the counterpart is always
  // computed from the same clamped value Apply will actually use -- the
  // ratio the admin sees while typing is the ratio that actually applies.
  function clampResizeDimension(n) {
    return Math.max(1, Math.min(MAX_DIMENSION, Math.round(n) || 1));
  }
  $("pe-resize-width").addEventListener("input", () => {
    const w = clampResizeDimension(Number($("pe-resize-width").value));
    $("pe-resize-width").value = w;
    if (!$("pe-resize-lock").checked || !canvas.width) return;
    $("pe-resize-height").value = Math.max(1, Math.round((w * canvas.height) / canvas.width));
  });
  $("pe-resize-height").addEventListener("input", () => {
    const h = clampResizeDimension(Number($("pe-resize-height").value));
    $("pe-resize-height").value = h;
    if (!$("pe-resize-lock").checked || !canvas.height) return;
    $("pe-resize-width").value = Math.max(1, Math.round((h * canvas.width) / canvas.height));
  });
  $("pe-apply-resize").addEventListener("click", () => {
    if (isComparing()) return;
    // Aspect ratio for the live-lock inputs above is always derived from
    // the canvas's CURRENT dimensions at the moment of each keystroke, not
    // a value frozen from when the modal opened -- so it stays correct
    // even after an intervening rotate/crop/undo changes what "current"
    // means, with no separate tracked-aspect variable to keep in sync.
    const w = clampResizeDimension(Number($("pe-resize-width").value) || canvas.width);
    const h = clampResizeDimension(Number($("pe-resize-height").value) || canvas.height);
    if (w === canvas.width && h === canvas.height) return;
    pushUndo();
    const snap = snapshotCanvas();
    canvas.width = w;
    canvas.height = h;
    // Higher-quality resampling than the browser default (which several
    // engines leave at "low") -- most noticeable on a large downscale,
    // where the default can look visibly blockier than necessary for a
    // one-shot "resize the image" operation.
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = "high";
    ctx.drawImage(snap, 0, 0, snap.width, snap.height, 0, 0, w, h);
    syncOverlaySize();
    cancelActiveDrag();
    fitCanvasToViewport();
  });

  // ---------- Canvas resize (grows/shrinks the canvas itself around the
  // existing image content, unlike Resize image above which scales the
  // pixels -- same idea as Photoshop's Image > Canvas Size) ----------
  function refreshCanvasResizeFields() {
    $("pe-canvas-width").value = canvas.width;
    $("pe-canvas-height").value = canvas.height;
  }
  $("pe-canvas-width").addEventListener("input", () => {
    $("pe-canvas-width").value = clampResizeDimension(Number($("pe-canvas-width").value));
  });
  $("pe-canvas-height").addEventListener("input", () => {
    $("pe-canvas-height").value = clampResizeDimension(Number($("pe-canvas-height").value));
  });
  // fx/fy are how much of the size DELTA gets applied before the existing
  // content -- 0 keeps content flush against that edge (top/left), 1 keeps
  // it flush against the opposite edge (bottom/right), 0.5 centers it. The
  // same formula handles both growing (adds transparent padding on the
  // side(s) away from the anchor) and shrinking (crops away the side(s)
  // away from the anchor) with no special-casing between the two.
  const CANVAS_ANCHOR_FRACTIONS = {
    "top-left": [0, 0], "top-center": [0.5, 0], "top-right": [1, 0],
    "middle-left": [0, 0.5], "center": [0.5, 0.5], "middle-right": [1, 0.5],
    "bottom-left": [0, 1], "bottom-center": [0.5, 1], "bottom-right": [1, 1],
  };
  $("pe-apply-canvas-resize").addEventListener("click", () => {
    if (isComparing()) return;
    const w = clampResizeDimension(Number($("pe-canvas-width").value) || canvas.width);
    const h = clampResizeDimension(Number($("pe-canvas-height").value) || canvas.height);
    if (w === canvas.width && h === canvas.height) return;
    pushUndo();
    const snap = snapshotCanvas();
    const [fx, fy] = CANVAS_ANCHOR_FRACTIONS[$("pe-canvas-anchor").value] || [0.5, 0.5];
    const dx = Math.round(fx * (w - snap.width));
    const dy = Math.round(fy * (h - snap.height));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(snap, dx, dy);
    syncOverlaySize();
    cancelActiveDrag();
    fitCanvasToViewport();
  });

  // ---------- One-click filters ----------
  function applyOneShotFilter(cssFilter) {
    if (isComparing()) return;
    pushUndo();
    const snap = snapshotCanvas();
    paintFiltered(snap, cssFilter);
    // A critic pass found this (and the Apply Crop / Apply Preset handlers
    // below) already had the isComparing() guard but not this one --
    // baseSnapshot invalidation is a SEPARATE concern from that guard, and
    // a multi-touch drag held open on an adjust slider while this button
    // is tapped with another finger would otherwise resume against the
    // now-stale pre-filter canvas on the drag's next tick, silently
    // erasing the filter that was just applied. Same fix rotate90()/
    // flip() already needed for the identical reason.
    cancelActiveDrag();
  }
  // Grain is real per-pixel noise, not a CSS filter -- there's no
  // filter(1)-style CSS function for it, unlike grayscale/sepia/invert
  // above. One random offset per PIXEL (not per channel) is applied
  // identically to its R/G/B channels, matching real film grain's
  // luminance-only noise look rather than per-channel color static.
  function applyGrain(amount) {
    if (isComparing()) return;
    pushUndo();
    const beforeGrain = hasSelection() ? snapshotCanvas() : null;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imgData.data;
    for (let i = 0; i < data.length; i += 4) {
      const noise = (Math.random() - 0.5) * 2 * amount;
      data[i] = Math.max(0, Math.min(255, data[i] + noise));
      data[i + 1] = Math.max(0, Math.min(255, data[i + 1] + noise));
      data[i + 2] = Math.max(0, Math.min(255, data[i + 2] + noise));
      // Alpha (data[i + 3]) is left untouched -- grain shouldn't change
      // which pixels are transparent.
    }
    ctx.putImageData(imgData, 0, 0);
    if (beforeGrain) blendThroughSelection(beforeGrain, snapshotCanvas());
    cancelActiveDrag();
  }
  $("pe-filter-grain").addEventListener("click", () => applyGrain(Number($("pe-grain-amount").value) || 15));

  $("pe-filter-grayscale").addEventListener("click", () => applyOneShotFilter("grayscale(1)"));
  $("pe-filter-sepia").addEventListener("click", () => applyOneShotFilter("sepia(1)"));
  $("pe-filter-invert").addEventListener("click", () => applyOneShotFilter("invert(1)"));

  // ---------- Brightness / contrast / saturation ----------
  function filterString() {
    const b = 100 + Number($("pe-brightness").value);
    const c = 100 + Number($("pe-contrast").value);
    const s = 100 + Number($("pe-saturate").value);
    return `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
  }

  function onAdjustInput() {
    // A critic pass's exhaustive cross-reference of every canvas-mutating
    // action against the isComparing() guard (added elsewhere in this file
    // for rotate/flip/filters/crop-apply/preset-apply) found this one --
    // and its `change` counterpart below -- were missed, and live-
    // reproduced the exact same silent-data-loss/undo-corruption failure
    // via a slider drag that starts, continues, or finishes while Compare
    // is held: `pushUndo()` captures the temporary original-image preview
    // instead of the real edit, and `baseSnapshot` gets set to a clone of
    // that same temporary canvas, corrupting whatever the slider paints
    // next even after Compare is released.
    if (isComparing()) return;
    cancelStraightenPreview();
    if (!baseSnapshot) {
      pushUndo();
      baseSnapshot = document.createElement("canvas");
      baseSnapshot.width = canvas.width;
      baseSnapshot.height = canvas.height;
      baseSnapshot.getContext("2d").drawImage(canvas, 0, 0);
    }
    paintFiltered(baseSnapshot, filterString());
  }

  let lastAdjust = { brightness: 0, contrast: 0, saturate: 0 };

  function onAdjustCommit() {
    // Same isComparing() guard as onAdjustInput() above, for the same
    // reason: if Compare is still held when the slider's "change" fires,
    // accumulating the current slider value into lastAdjust would record
    // an adjustment that was never actually applied to the real edit (it
    // was blocked from painting by onAdjustInput()'s own guard), and would
    // reset baseSnapshot/the sliders as if a real edit had just completed.
    if (isComparing()) return;
    // The slider handler already baked the filtered pixels into the canvas;
    // accumulate onto lastAdjust (for "Save preset", since the sliders
    // themselves are about to reset to 0) then reset sliders/snapshot so
    // the next drag starts fresh from this baked-in state. Accumulating
    // (rather than replacing) matters because each slider only shows its
    // own delta since the last commit — after adjusting brightness then
    // separately adjusting contrast, both sliders read their own value at
    // commit time, but a *replace* would zero out brightness's already-
    // committed contribution the moment contrast's commit fired.
    lastAdjust = {
      brightness: lastAdjust.brightness + Number($("pe-brightness").value),
      contrast: lastAdjust.contrast + Number($("pe-contrast").value),
      saturate: lastAdjust.saturate + Number($("pe-saturate").value),
    };
    baseSnapshot = null;
    $("pe-brightness").value = 0;
    $("pe-contrast").value = 0;
    $("pe-saturate").value = 0;
  }

  // What "Save preset" should capture: the live slider values while a drag
  // is in progress (baseSnapshot set, sliders not yet reset), otherwise the
  // last values that were actually committed onto the canvas.
  function currentAdjust() {
    if (baseSnapshot) {
      return {
        brightness: Number($("pe-brightness").value),
        contrast: Number($("pe-contrast").value),
        saturate: Number($("pe-saturate").value),
      };
    }
    return lastAdjust;
  }

  ["pe-brightness", "pe-contrast", "pe-saturate"].forEach((id) => {
    $(id).addEventListener("input", onAdjustInput);
    $(id).addEventListener("change", onAdjustCommit);
  });

  // ---------- Saved presets (brightness/contrast/saturation) ----------
  let photoPresets = [];

  async function loadPhotoPresets() {
    try {
      photoPresets = (await window.adminApi("/photo-presets")) || [];
    } catch (e) {
      photoPresets = [];
    }
    const select = $("pe-apply-preset");
    select.innerHTML =
      `<option value="">Apply preset…</option>` +
      photoPresets.map((p) => `<option value="${p.id}">${escapeHtmlAttr(p.name)}</option>`).join("");
  }

  $("pe-apply-preset").addEventListener("change", () => {
    if (isComparing()) {
      // A native <select>'s displayed value updates before "change" fires,
      // so returning here alone would leave the dropdown showing a preset
      // name that was never actually applied -- and since re-picking that
      // SAME option later wouldn't fire "change" again (no value
      // transition), there'd be no obvious way to actually apply it
      // without picking something else first. Resetting the value back to
      // the placeholder makes the UI honestly reflect that nothing
      // happened, and leaves the option immediately re-selectable.
      $("pe-apply-preset").value = "";
      return;
    }
    const id = Number($("pe-apply-preset").value);
    const preset = photoPresets.find((p) => p.id === id);
    if (!preset) return;
    pushUndo();
    const snap = snapshotCanvas();
    const b = 100 + Number(preset.adjust.brightness);
    const c = 100 + Number(preset.adjust.contrast);
    const s = 100 + Number(preset.adjust.saturate);
    paintFiltered(snap, `brightness(${b}%) contrast(${c}%) saturate(${s}%)`);
    // Same baseSnapshot-invalidation gap as applyOneShotFilter() and Apply
    // Crop, found by the same critic pass: this handler already had the
    // isComparing() guard above, but not this separate one for a
    // multi-touch drag held open on an adjust slider while a preset is
    // applied with another finger.
    cancelActiveDrag();
  });

  $("pe-save-preset").addEventListener("click", async () => {
    const adjust = currentAdjust();
    if (!adjust.brightness && !adjust.contrast && !adjust.saturate) {
      alert("Adjust brightness, contrast, or saturation first, then save it as a preset.");
      return;
    }
    const name = await promptForText("Save adjustment preset", "Preset name");
    if (name === null) return;
    try {
      await window.adminApi("/photo-presets", { method: "POST", body: JSON.stringify({ name: name.trim(), adjust }) });
      await loadPhotoPresets();
    } catch (err) {
      alert(err.message);
    }
  });

  $("pe-delete-preset").addEventListener("click", async () => {
    const id = Number($("pe-apply-preset").value);
    const preset = photoPresets.find((p) => p.id === id);
    if (!preset) return;
    if (!confirm(`Delete preset "${preset.name}"?`)) return;
    try {
      await window.adminApi(`/photo-presets/${id}`, { method: "DELETE" });
      await loadPhotoPresets();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Brush tools: erase / blur / pixelate / dodge / burn ----------
  let maskCanvas = null;
  let maskCtx = null;
  let strokeActive = false;
  let lastPoint = null;

  // ---------- Airbrush mode ----------
  // A modifier on the existing 5 brush tools (not a 6th tool of its own),
  // matching how "airbrush mode" works in real paint tools: holding the
  // pointer STILL still keeps building the effect up over time, unlike
  // normal brush behavior where nothing happens unless you actually move.
  // Reuses the exact same commitBrushStroke()/buildEffectCanvas()
  // compositing every other brush tool already has -- each tick just
  // commits again, and buildEffectCanvas() re-reading the already-mutated
  // live canvas is exactly the mechanism that already makes repeated
  // manual clicks with Dodge/Burn compound (confirmed by an earlier critic
  // pass on this session's own Dodge/Burn work); this just automates that
  // same compounding on a timer instead of requiring repeated clicks.
  const AIRBRUSH_INTERVAL_MS = 150;
  let airbrushTimer = null;
  let airbrushPoint = null;
  let airbrushPressure = 1;
  // A critic pass found a real double-commit bug: after a tick commits and
  // reseeds the mask with a fresh dot (so the NEXT tick has something to
  // build on if the pointer is still perfectly stationary), that reseeded
  // dot was ALSO being committed a second time by pointerup's own
  // unconditional final commit moments later -- applying one extra
  // full-strength dose at the release point beyond what elapsed dwell time
  // actually justified. This flag tracks whether the mask's current
  // contents are just that tick-reseeded dot (nothing new since) so
  // pointerup can skip its own commit in exactly that case, while still
  // committing normally if real movement happened after the last tick.
  let airbrushJustCommitted = false;

  function airbrushMode() {
    return $("pe-airbrush-mode").checked;
  }

  function airbrushTick() {
    if (!strokeActive || !airbrushPoint) return;
    try {
      commitBrushStroke();
      // Reset the mask to just the current point after each commit -- if
      // this DIDN'T clear, a stroke that moved across a wide area would
      // recomposite its entire accumulated path on every single tick,
      // wildly over-building the parts painted earliest rather than
      // building up proportionally to how long each spot was actually
      // under the brush. Clearing means each tick only accounts for
      // whatever's happened (movement, or none) since the LAST tick,
      // exactly like a real airbrush's continuous-while-held behavior.
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      lastPoint = null;
      strokeTo(airbrushPoint, airbrushPressure);
      airbrushJustCommitted = true;
    } catch (err) {
      // A broken tick body must not keep firing silently forever against a
      // possibly-corrupted canvas state -- stop the interval rather than
      // repeat whatever just failed every 150ms with no visible sign
      // anything is wrong.
      stopAirbrushTimer();
    }
  }

  function startAirbrushTimer() {
    stopAirbrushTimer();
    airbrushTimer = setInterval(airbrushTick, AIRBRUSH_INTERVAL_MS);
  }

  function stopAirbrushTimer() {
    if (airbrushTimer) clearInterval(airbrushTimer);
    airbrushTimer = null;
  }

  // A critic pass found that unchecking "Airbrush" mid-hold had no effect
  // at all -- the running interval never re-reads the checkbox, so the
  // effect kept building even though the UI said it was off. Checking it
  // ON mid-drag correctly has no effect until the NEXT stroke (a timer
  // can only ever be started at pointerdown, matching how every other
  // brush setting is captured at stroke-start), but turning it off
  // should stop an already-running timer immediately.
  $("pe-airbrush-mode").addEventListener("change", () => {
    if (!airbrushMode()) stopAirbrushTimer();
  });

  function ensureMask() {
    if (maskCanvas && maskCanvas.width === canvas.width && maskCanvas.height === canvas.height) return;
    maskCanvas = document.createElement("canvas");
    maskCanvas.width = canvas.width;
    maskCanvas.height = canvas.height;
    maskCtx = maskCanvas.getContext("2d");
  }

  function brushSize() {
    return Number($("pe-brush-size").value);
  }

  // 1-100 (never 0 -- the slider's own min is 1) so a stroke always
  // applies at least a little, matching how a real low-flow brush works
  // rather than silently doing nothing at the bottom of the range.
  function brushOpacity() {
    return Math.max(1, Math.min(100, Number($("pe-brush-opacity").value) || 100)) / 100;
  }

  // ---------- Saved brush presets ----------
  // Named tool/size/opacity combos, server-persisted the same way the
  // existing brightness/contrast/saturation presets already are, but as
  // a separate /brush-presets resource -- that endpoint's own validation
  // is specifically shaped around `adjust: {brightness,contrast,saturate}`,
  // not brush parameters, so this isn't folded into it.
  const BRUSH_PRESET_TOOLS = new Set(["erase", "blur", "pixelate", "dodge", "burn"]);
  let brushPresets = [];

  async function loadBrushPresets() {
    try {
      brushPresets = (await window.adminApi("/brush-presets")) || [];
    } catch (e) {
      brushPresets = [];
    }
    const select = $("pe-apply-brush-preset");
    select.innerHTML =
      `<option value="">Apply brush preset…</option>` +
      brushPresets.map((p) => `<option value="${p.id}">${escapeHtmlAttr(p.name)}</option>`).join("");
  }

  $("pe-apply-brush-preset").addEventListener("change", () => {
    const id = Number($("pe-apply-brush-preset").value);
    const preset = brushPresets.find((p) => p.id === id);
    if (!preset) return;
    setTool(preset.tool);
    $("pe-brush-size").value = preset.size;
    $("pe-brush-opacity").value = preset.opacity;
  });

  $("pe-save-brush-preset").addEventListener("click", async () => {
    if (!BRUSH_PRESET_TOOLS.has(currentTool)) {
      alert("Select a brush tool (Erase, Blur, Pixelate, Dodge, or Burn) first, then save it as a preset.");
      return;
    }
    const preset = {
      tool: currentTool,
      size: brushSize(),
      opacity: Number($("pe-brush-opacity").value),
    };
    const name = await promptForText("Save brush preset", "Preset name");
    if (name === null) return;
    try {
      await window.adminApi("/brush-presets", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), ...preset }),
      });
      await loadBrushPresets();
    } catch (err) {
      alert(err.message);
    }
  });

  $("pe-delete-brush-preset").addEventListener("click", async () => {
    const id = Number($("pe-apply-brush-preset").value);
    const preset = brushPresets.find((p) => p.id === id);
    if (!preset) return;
    if (!confirm(`Delete brush preset "${preset.name}"?`)) return;
    try {
      await window.adminApi(`/brush-presets/${id}`, { method: "DELETE" });
      await loadBrushPresets();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Saved text styles ----------
  // Named font/color/size combos for the Text annotation tool, same
  // server-persisted settings-blob pattern as the brush presets
  // immediately above -- a separate /text-styles resource since text has
  // no "tool" concept and brush presets have no "font" concept, matching
  // the same reasoning that already kept brush presets out of
  // /photo-presets.
  let textStyles = [];

  async function loadTextStyles() {
    try {
      textStyles = (await window.adminApi("/text-styles")) || [];
    } catch (e) {
      textStyles = [];
    }
    const select = $("pe-apply-text-style");
    select.innerHTML =
      `<option value="">Apply text style…</option>` + textStyles.map((s) => `<option value="${s.id}">${escapeHtmlAttr(s.name)}</option>`).join("");
  }

  $("pe-apply-text-style").addEventListener("change", () => {
    const id = Number($("pe-apply-text-style").value);
    const style = textStyles.find((s) => s.id === id);
    if (!style) return;
    $("pe-text-font").value = style.font;
    $("pe-annotate-color").value = style.color;
    $("pe-annotate-size").value = style.size;
  });

  $("pe-save-text-style").addEventListener("click", async () => {
    const style = { font: $("pe-text-font").value, color: annotateColor(), size: annotateSize() };
    const name = await promptForText("Save text style", "Style name");
    if (name === null) return;
    try {
      await window.adminApi("/text-styles", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), ...style }),
      });
      await loadTextStyles();
    } catch (err) {
      alert(err.message);
    }
  });

  $("pe-delete-text-style").addEventListener("click", async () => {
    const id = Number($("pe-apply-text-style").value);
    const style = textStyles.find((s) => s.id === id);
    if (!style) return;
    if (!confirm(`Delete text style "${style.name}"?`)) return;
    try {
      await window.adminApi(`/text-styles/${id}`, { method: "DELETE" });
      await loadTextStyles();
    } catch (err) {
      alert(err.message);
    }
  });

  // Pen pressure scales the brush's effective diameter for this one point
  // -- deliberately ignored for anything but a real pressure-sensitive
  // stylus. PointerEvent.pressure defaults to 0.5 for a plain mouse click
  // (per spec, not "half pressure" in any meaningful sense) and 0/1 for
  // touch depending on the browser, so scaling by raw `pressure` for
  // those pointer types would make every ordinary mouse/trackpad stroke
  // draw at half the selected brush size by default -- a regression for
  // the overwhelming majority of admins who don't have a tablet. Clamped
  // to a 0.15 floor so the very lightest real pen touch still leaves a
  // visible mark instead of an invisible zero-width line.
  function pressureMultiplier(e) {
    if (!e || e.pointerType !== "pen") return 1;
    const p = typeof e.pressure === "number" ? e.pressure : 0.5;
    return Math.max(0.15, Math.min(1, p));
  }

  function strokeTo(point, sizeMultiplier = 1) {
    const size = brushSize() * sizeMultiplier;
    maskCtx.lineCap = "round";
    maskCtx.lineJoin = "round";
    maskCtx.strokeStyle = "#000";
    maskCtx.fillStyle = "#000";
    maskCtx.lineWidth = size;
    if (lastPoint) {
      maskCtx.beginPath();
      maskCtx.moveTo(lastPoint.x, lastPoint.y);
      maskCtx.lineTo(point.x, point.y);
      maskCtx.stroke();
    } else {
      maskCtx.beginPath();
      maskCtx.arc(point.x, point.y, size / 2, 0, Math.PI * 2);
      maskCtx.fill();
    }
    lastPoint = point;
  }

  function buildEffectCanvas(tool) {
    const c = document.createElement("canvas");
    c.width = canvas.width;
    c.height = canvas.height;
    const cx = c.getContext("2d");
    if (tool === "blur") {
      cx.filter = `blur(${Math.max(4, canvas.width * 0.012)}px)`;
      cx.drawImage(canvas, 0, 0);
    } else if (tool === "dodge" || tool === "burn") {
      // Classic darkroom dodge/burn: a brush that locally brightens
      // (dodge) or darkens (burn) instead of adding/removing/blurring
      // pixels. Reuses the exact same effect-canvas + mask compositing
      // pipeline as blur/pixelate -- just a brightness-filtered full copy
      // of the canvas instead of a blurred or downscaled one.
      cx.filter = tool === "dodge" ? "brightness(140%)" : "brightness(65%)";
      cx.drawImage(canvas, 0, 0);
    } else if (tool === "pixelate") {
      const scale = 0.05;
      const small = document.createElement("canvas");
      small.width = Math.max(1, Math.round(canvas.width * scale));
      small.height = Math.max(1, Math.round(canvas.height * scale));
      small.getContext("2d").drawImage(canvas, 0, 0, small.width, small.height);
      cx.imageSmoothingEnabled = false;
      cx.drawImage(small, 0, 0, small.width, small.height, 0, 0, canvas.width, canvas.height);
    }
    return c;
  }

  function commitBrushStroke() {
    // With a selection, the stroke only counts inside it.
    if (hasSelection() && selMask.width === maskCanvas.width && selMask.height === maskCanvas.height) {
      maskCtx.save();
      maskCtx.globalCompositeOperation = "destination-in";
      maskCtx.drawImage(selMask, 0, 0);
      maskCtx.restore();
    }
    if (currentTool === "erase") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
      ctx.globalAlpha = brushOpacity();
      ctx.drawImage(maskCanvas, 0, 0);
      ctx.restore();
      return;
    }
    const effect = buildEffectCanvas(currentTool);
    const tmp = document.createElement("canvas");
    tmp.width = canvas.width;
    tmp.height = canvas.height;
    const tctx = tmp.getContext("2d");
    tctx.drawImage(effect, 0, 0);
    tctx.globalCompositeOperation = "destination-in";
    tctx.drawImage(maskCanvas, 0, 0);
    ctx.save();
    ctx.globalAlpha = brushOpacity();
    ctx.drawImage(tmp, 0, 0);
    ctx.restore();
  }

  // The outline itself was always exact -- point.x/y and brushSize() are
  // both in the same canvas-pixel space strokeTo() actually draws in, so
  // the circle's SIZE and POSITION already matched a real stroke exactly
  // before this change. What it never reflected was the brush OPACITY
  // slider (item #71): a preview that always looked identically solid
  // regardless of that setting was misleading about how STRONG a click
  // would actually apply, not just where/how big. Now a light, filled
  // interior scaled by the real brushOpacity() gives an honest preview of
  // strength too, and the outline stroke itself is also alpha-scaled so a
  // very-low-opacity setting reads as a correspondingly faint preview
  // rather than a jarring full-strength outline around a barely-visible
  // fill.
  function drawBrushCursor(point) {
    clearOverlay();
    const opacity = brushOpacity();
    octx.save();
    octx.beginPath();
    octx.arc(point.x, point.y, brushSize() / 2, 0, Math.PI * 2);
    octx.fillStyle = "#ff7a45";
    octx.globalAlpha = opacity * 0.35; // fill is always subtler than the outline, never the dominant visual
    octx.fill();
    octx.globalAlpha = Math.max(0.25, opacity); // never fades the outline to the point it's hard to see even at low opacity
    octx.strokeStyle = "#ff7a45";
    octx.lineWidth = Math.max(1, canvas.width * 0.0015);
    octx.stroke();
    octx.restore();
  }

  // ---------- Annotate: rect / circle / arrow / text ----------
  function annotateColor() {
    return $("pe-annotate-color").value;
  }
  function annotateSize() {
    return Number($("pe-annotate-size").value);
  }

  function drawArrow(context, x0, y0, x1, y1, color, size) {
    context.strokeStyle = color;
    context.fillStyle = color;
    context.lineWidth = size;
    context.lineCap = "round";
    context.beginPath();
    context.moveTo(x0, y0);
    context.lineTo(x1, y1);
    context.stroke();
    const angle = Math.atan2(y1 - y0, x1 - x0);
    const headLen = Math.max(12, size * 4);
    context.beginPath();
    context.moveTo(x1, y1);
    context.lineTo(x1 - headLen * Math.cos(angle - Math.PI / 6), y1 - headLen * Math.sin(angle - Math.PI / 6));
    context.lineTo(x1 - headLen * Math.cos(angle + Math.PI / 6), y1 - headLen * Math.sin(angle + Math.PI / 6));
    context.closePath();
    context.fill();
  }

  // Corner radius only applies to the rect tool -- read once here rather
  // than in each of the two call sites (preview + commit) that need it.
  function rectRadius() {
    return Number($("pe-rect-radius").value) || 0;
  }

  // ctx.roundRect() clamps an oversized radius to fit the rect automatically
  // per spec, so a radius larger than half the drawn rectangle's smaller
  // side (very possible since the slider's max is fixed at 100 regardless
  // of how small a rectangle is actually dragged) degrades gracefully into
  // a rounded pill/circle shape rather than throwing or corrupting the
  // path -- no manual clamping needed here. A zero-width or zero-height
  // rect (a click without dragging, or a perfectly horizontal/vertical
  // drag -- reachable since there's no minimum-drag-distance gate) hits
  // the same spec-mandated clamping (the effective radius scales to 0
  // along with the degenerate dimension), so it's covered by the same
  // path, not a separate case.
  //
  // Feature-detected rather than called unconditionally -- a critic pass
  // found that on a browser old enough to lack roundRect() (added to the
  // spec circa 2021-2022; plausible for "whatever laptop/phone is handy"
  // on a personal-site admin tool, unlike the main site's assumed
  // audience), calling a nonexistent method throws a plain TypeError with
  // no surrounding try/catch anywhere in the pointerup handler that leads
  // here. That's a strictly worse failure mode than the strokeRect() this
  // replaced (which never throws): the exception would abort mid-handler
  // after pushUndo() already ran but before clearOverlay()/dragStart reset
  // could run, pushing a stray empty undo entry, leaving a stuck preview
  // stroke, and corrupting the next drag's state. Falling back to the
  // plain, always-available rect() degrades to "the radius setting is
  // silently ignored on this browser" instead -- a worse-looking rectangle,
  // never a wedged tool.
  function strokeRectMaybeRounded(c, x, y, w, h, radius) {
    c.beginPath();
    if (radius > 0 && typeof c.roundRect === "function") c.roundRect(x, y, w, h, radius);
    else c.rect(x, y, w, h);
    c.stroke();
  }

  function drawAnnotatePreview(x0, y0, x1, y1) {
    clearOverlay();
    const color = annotateColor();
    const size = annotateSize();
    octx.strokeStyle = color;
    octx.lineWidth = size;
    if (currentTool === "rect") {
      strokeRectMaybeRounded(octx, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), rectRadius());
    } else if (currentTool === "circle") {
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      octx.beginPath();
      octx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, rx, ry, 0, 0, Math.PI * 2);
      octx.stroke();
    } else if (currentTool === "line") {
      octx.lineCap = "round";
      octx.beginPath();
      octx.moveTo(x0, y0);
      octx.lineTo(x1, y1);
      octx.stroke();
    } else if (currentTool === "arrow") {
      drawArrow(octx, x0, y0, x1, y1, color, size);
    }
  }

  function commitAnnotation(x0, y0, x1, y1) {
    const color = annotateColor();
    const size = annotateSize();
    if (currentTool === "rect") {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      strokeRectMaybeRounded(ctx, Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0), rectRadius());
    } else if (currentTool === "circle") {
      const rx = Math.abs(x1 - x0) / 2;
      const ry = Math.abs(y1 - y0) / 2;
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.beginPath();
      ctx.ellipse((x0 + x1) / 2, (y0 + y1) / 2, rx, ry, 0, 0, Math.PI * 2);
      ctx.stroke();
    } else if (currentTool === "line") {
      ctx.strokeStyle = color;
      ctx.lineWidth = size;
      ctx.lineCap = "round";
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    } else if (currentTool === "arrow") {
      drawArrow(ctx, x0, y0, x1, y1, color, size);
    }
  }

  // ---------- Eyedropper ----------
  function pickColor(point) {
    const x = Math.max(0, Math.min(canvas.width - 1, Math.round(point.x)));
    const y = Math.max(0, Math.min(canvas.height - 1, Math.round(point.y)));
    const [r, g, b] = ctx.getImageData(x, y, 1, 1).data;
    const hex = "#" + [r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("");
    $("pe-annotate-color").value = hex;
  }

  async function placeText(point) {
    const style = {
      fontSize: Math.max(16, annotateSize() * 6),
      color: annotateColor(),
      font: $("pe-text-font").value,
      loadedFontFamily,
    };
    const text = await promptForText("Add text", "Text to add");
    if (text === null) return;
    pushUndo();
    const fontSize = style.fontSize;
    const textBefore = hasSelection() ? snapshotCanvas() : null;
    ctx.fillStyle = style.color;
    // Use a custom face only when that exact, pre-dialog selection has
    // already finished loading; otherwise retain the plain sans-serif fallback.
    const useCustom = style.font === "custom" && style.loadedFontFamily;
    const fontFamily = useCustom ? "'" + style.loadedFontFamily + "', sans-serif" : "sans-serif";
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";
    ctx.fillText(text, point.x, point.y);
    if (textBefore) blendThroughSelection(textBefore, snapshotCanvas());
    // A critic pass found this was the one remaining pixel-mutating action
    // missing baseSnapshot invalidation -- and arguably the easiest of all
    // of them to trigger. The app modal leaves the event loop running, so
    // a second touch already captured by an adjust slider can still deliver
    // input while the prompt is open; clearing its old snapshot here keeps
    // the next adjustment from painting over and erasing the placed text.
    invalidateOpenAdjustDrag();
  }

  // ---------- Zoom / pan input ----------
  $("pe-zoom-in").addEventListener("click", () => stepZoom(1));
  $("pe-zoom-out").addEventListener("click", () => stepZoom(-1));
  $("pe-zoom-reset").addEventListener("click", () => setZoom("fit"));
  $("pe-zoom-100").addEventListener("click", () => setZoom(1));
  // Ctrl (or pinch-as-Ctrl) + wheel zooms about the cursor; a plain wheel scrolls.
  canvasWrap.addEventListener(
    "wheel",
    (e) => {
      if (!(e.ctrlKey || e.metaKey) || modal.hidden) return;
      e.preventDefault();
      if (!e.deltaY) return;
      // Proportional to the amount scrolled, so a trackpad pinch (dozens of tiny
      // events) zooms smoothly and a mouse-wheel notch is a modest step.
      const dy = e.deltaY * (e.deltaMode === 1 ? 33 : e.deltaMode === 2 ? 400 : 1);
      const next = Math.round(currentScale() * Math.exp(-dy * 0.0025) * 1000) / 1000;
      // Never zoom IN when asked to zoom out: a large image's Fit can be below 25%.
      const lower = Math.min(ZOOM_STEPS[0], fitScaleNow());
      setZoom(Math.max(lower, Math.min(ZOOM_STEPS[ZOOM_STEPS.length - 1], next)), e.clientX, e.clientY);
    },
    { passive: false }
  );
  let spaceHeld = false;
  let panning = null;
  let pointerOverArea = false;
  canvasWrap.addEventListener("pointerenter", () => (pointerOverArea = true));
  canvasWrap.addEventListener("pointerleave", () => (pointerOverArea = false));
  function typingInField(t) {
    return !!t && (t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable || (t.tagName === "INPUT" && !["range", "color", "checkbox", "radio", "button"].includes(t.type)));
  }
  // Panning state must never outlive its gesture: a missed keyup (alt-tab), closing
  // the editor or opening another image would otherwise leave every drag panning.
  function resetPanState() {
    pointerOverArea = false; // a closing editor never sends pointerleave
    spaceHeld = false;
    panning = null;
    overlay.style.cursor = currentTool === "pan" ? "grab" : "";
  }
  window.addEventListener("blur", resetPanState);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) resetPanState();
  });
  // Capture phase. Space is remembered whenever it isn't typing, so "hold Space,
  // then press on the canvas" pans however you got there. Its own action (clicking a
  // focused button, scrolling the page) is suppressed only while the pointer is over
  // the canvas, so Space still toggles a focused checkbox or button elsewhere.
  document.addEventListener(
    "keydown",
    (e) => {
      if (e.key !== " " || modal.hidden || modal.getAttribute("aria-modal") !== "true" || e.ctrlKey || e.metaKey || e.altKey) return;
      if (typingInField(document.activeElement)) return;
      // Suppress Space's own action only when focus is somewhere it would do
      // something unwanted (the page, the canvas, a tool button); a focused
      // checkbox, summary or other control keeps working under the pointer.
      const ae = document.activeElement;
      const inert = !ae || ae === document.body || ae === overlay || (ae.tagName === "BUTTON" && ae.classList.contains("pe-tool"));
      if (pointerOverArea && inert) {
        e.preventDefault();
        e.stopPropagation();
      }
      if (!spaceHeld) {
        spaceHeld = true;
        overlay.style.cursor = "grab";
      }
    },
    true
  );
  document.addEventListener(
    "keyup",
    (e) => {
      if (e.key !== " " || !spaceHeld) return;
      const ae = document.activeElement;
      if (pointerOverArea && (!ae || ae === document.body || ae === overlay || (ae.tagName === "BUTTON" && ae.classList.contains("pe-tool")))) {
        e.preventDefault();
        e.stopPropagation();
      }
      spaceHeld = false;
      overlay.style.cursor = currentTool === "pan" ? "grab" : "";
    },
    true
  );
  document.addEventListener("keydown", (e) => {
    if (modal.hidden || modal.getAttribute("aria-modal") !== "true" || e.ctrlKey || e.metaKey || e.altKey || typingInField(document.activeElement)) return;
    if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      stepZoom(1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      stepZoom(-1);
    } else if (e.key === "0") {
      e.preventDefault();
      setZoom("fit");
    } else if (e.key === "1") {
      e.preventDefault();
      setZoom(1);
    }
  });
  function startPan(e) {
    const wrapEl = canvasWrap;
    panning = { x: e.clientX, y: e.clientY, sl: wrapEl.scrollLeft, st: wrapEl.scrollTop, id: e.pointerId };
    overlay.setPointerCapture(e.pointerId);
    overlay.style.cursor = "grabbing";
  }
  function movePan(e) {
    const wrapEl = canvasWrap;
    wrapEl.scrollLeft = panning.sl - (e.clientX - panning.x);
    wrapEl.scrollTop = panning.st - (e.clientY - panning.y);
  }
  function endPan() {
    panning = null;
    overlay.style.cursor = spaceHeld || currentTool === "pan" ? "grab" : "";
  }

  // ---------- Pointer routing ----------
  const BRUSH_TOOLS = ["erase", "blur", "pixelate", "dodge", "burn"];
  const SHAPE_TOOLS = ["rect", "circle", "line", "arrow"];

  // The pointer (finger, pen or mouse) that owns the current drag. A second
  // finger landing mid-stroke is ignored instead of starting a second stroke or
  // ending the first one when it lifts. Only trusted while the first pointer
  // still holds capture, so a lost pointerup can't leave the editor deaf.
  let activePointerId = null;
  const isSecondaryPointer = (e) => dragging && activePointerId !== null && e.pointerId !== activePointerId;

  overlay.addEventListener("pointerdown", (e) => {
    // Panning (Pan tool, held Space or the middle button) never reaches a tool.
    if ((currentTool === "pan" && e.button !== 2) || spaceHeld || e.button === 1) {
      if (isComparing() || panning) return;
      e.preventDefault();
      startPan(e);
      return;
    }
    if (activePointerId !== null && e.pointerId !== activePointerId && overlay.hasPointerCapture(activePointerId)) return;
    activePointerId = e.pointerId;
    // The reverse order of the guard already in startCompare() -- that one
    // blocks starting a compare mid-drag; this blocks starting a NEW drag
    // while a compare is already showing the original. Without it, on a
    // touchscreen a second finger could start a crop drag while the canvas
    // is temporarily resized to originalSnapshot's dimensions (only
    // possible if the image was cropped/resized before this compare), and
    // the resulting cropRect coordinates would then be computed against
    // the wrong canvas size once the swap reverts on release -- the same
    // corruption as before, just in the other temporal order. A second
    // critic pass found this gap in the fix's symmetry after the first
    // round only guarded one direction.
    if (isComparing()) return;
    cancelStraightenPreview();
    const p = pointFromEvent(e);
    dragging = true;
    dragStart = p;
    overlay.setPointerCapture(e.pointerId);

    if (currentTool === "select") {
      cropRect = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
      $("pe-apply-crop").hidden = true;
    } else if (BRUSH_TOOLS.includes(currentTool)) {
      pushUndo();
      ensureMask();
      maskCtx.clearRect(0, 0, maskCanvas.width, maskCanvas.height);
      strokeActive = true;
      lastPoint = null;
      strokeTo(p, pressureMultiplier(e));
      airbrushPoint = p;
      airbrushPressure = pressureMultiplier(e);
      airbrushJustCommitted = false;
      if (airbrushMode()) startAirbrushTimer();
    } else if (currentTool === "text") {
      dragging = false;
      dragStart = null;
      void placeText(p);
    } else if (currentTool === "eyedropper") {
      pickColor(p);
      dragging = false;
    } else if (SELECTION_TOOLS.includes(currentTool)) {
      beginSelectionDraft(e, p);
    }
  });

  overlay.addEventListener("pointermove", (e) => {
    if (panning) {
      if (e.pointerId === panning.id) movePan(e);
      return;
    }
    if (isSecondaryPointer(e)) return;
    if (spaceHeld && !dragging) return; // Space is held: this is a pan, not a hover over a tool
    if (straightenPreviewing) return; // the tilt preview owns the overlay; no crop/brush cursor over it
    const p = pointFromEvent(e);
    if (currentTool === "select" && dragging && cropRect) {
      const constrained = applyCropRatio(cropRect.x0, cropRect.y0, p.x, p.y);
      cropRect.x1 = constrained.x1;
      cropRect.y1 = constrained.y1;
      drawCropOverlay();
    } else if (BRUSH_TOOLS.includes(currentTool)) {
      if (dragging && strokeActive) {
        strokeTo(p, pressureMultiplier(e));
        airbrushPoint = p;
        airbrushPressure = pressureMultiplier(e);
        // Real movement invalidates the "nothing's changed since the last
        // tick" assumption pointerup relies on to skip a redundant final
        // commit -- this genuinely new content needs its own commit.
        airbrushJustCommitted = false;
      }
      drawBrushCursor(p);
    } else if (SHAPE_TOOLS.includes(currentTool) && dragging && dragStart) {
      drawAnnotatePreview(dragStart.x, dragStart.y, p.x, p.y);
    } else if (SELECTION_TOOLS.includes(currentTool)) {
      updateSelectionDraft(p);
    }
  });

  // Shared by pointerup and pointercancel -- a critic pass found the
  // latter had NO handler at all, which for most tools only left
  // dragging/strokeActive stuck (annoying but inert). For airbrush
  // specifically, a missed release (an interrupted touch, an OS gesture)
  // would leave its setInterval running forever, silently repainting the
  // saved canvas every 150ms with zero visual indication -- a real,
  // continuous-mutation risk this feature didn't have before. Finalizing
  // identically on both events closes that gap.
  function finalizeBrushStroke() {
    stopAirbrushTimer();
    if (strokeActive) {
      // Skip the redundant final commit when the mask's only content is
      // the dot an airbrush tick JUST committed and reseeded moments ago
      // (see airbrushJustCommitted's own comment) -- committing again here
      // would apply one extra full-strength dose beyond what the actual
      // elapsed dwell time earned. Any real movement since that last tick
      // clears the flag, so this only skips the true no-op case.
      if (!airbrushJustCommitted) commitBrushStroke();
      // A critic pass found the same baseSnapshot-staleness gap here as
      // rotate/flip/filters/presets/crop-apply already had fixed: a
      // multi-touch adjust-slider drag held open while a brush stroke on
      // another finger commits would otherwise resume against the
      // pre-stroke pixels on its next tick, erasing the stroke. Only
      // invalidates the adjust-drag specifically (not the full
      // cancelActiveDrag()), since this branch must not also clear an
      // unrelated in-progress crop selection on a different tool.
      invalidateOpenAdjustDrag();
    }
    strokeActive = false;
    lastPoint = null;
    clearOverlay();
  }

  overlay.addEventListener("pointerup", (e) => {
    if (panning) {
      if (e.pointerId === panning.id) endPan();
      return;
    }
    if (isSecondaryPointer(e)) return;
    activePointerId = null;
    if (!dragging) return;
    dragging = false;
    const p = pointFromEvent(e);

    if (currentTool === "select") {
      $("pe-apply-crop").hidden = !cropRect;
    } else if (BRUSH_TOOLS.includes(currentTool)) {
      finalizeBrushStroke();
    } else if (SELECTION_TOOLS.includes(currentTool)) {
      if (currentTool !== "sel-poly") commitSelectionDraft();
    } else if (SHAPE_TOOLS.includes(currentTool) && dragStart) {
      pushUndo();
      const anchor = dragStart;
      withSelectionClip(() => commitAnnotation(anchor.x, anchor.y, p.x, p.y));
      invalidateOpenAdjustDrag();
      clearOverlay();
    }
    dragStart = null;
  });

  // No pointercancel handling existed anywhere for the main canvas's own
  // tools before this (only the unrelated Compare button had one) -- an
  // interrupted brush stroke already left dragging/strokeActive stuck
  // true, a pre-existing gap this doesn't attempt to fully solve for
  // every tool. What airbrush specifically needs, and gets here: its
  // timer stopped so it can't keep silently repainting forever after a
  // stroke that never received a real pointerup.
  overlay.addEventListener("pointercancel", (e) => {
    if (panning) {
      endPan();
      return;
    }
    if (isSecondaryPointer(e)) return;
    activePointerId = null;
    if (!dragging) return;
    dragging = false;
    if (BRUSH_TOOLS.includes(currentTool)) finalizeBrushStroke();
    if (SELECTION_TOOLS.includes(currentTool) && currentTool !== "sel-poly") {
      selDraft = null;
      redrawOverlay();
    }
    dragStart = null;
  });

  $("pe-undo").addEventListener("click", undo);
  $("pe-redo").addEventListener("click", redo);
  $("pe-reset").addEventListener("click", resetToOriginal);
  // pointerdown/up (not click) since this is a press-and-hold gesture, not
  // a toggle -- pointer events cover mouse and touch with one listener
  // pair. pointerleave/pointercancel also end it, so dragging off the
  // button (or an interrupted touch) can't leave the original showing
  // indefinitely with no way to release it.
  $("pe-compare").addEventListener("pointerdown", startCompare);
  $("pe-compare").addEventListener("pointerup", endCompare);
  $("pe-compare").addEventListener("pointerleave", endCompare);
  $("pe-compare").addEventListener("pointercancel", endCompare);
  // Backstop for a lost pointerup (e.g. alt-tabbing away, or switching tabs,
  // with the pointer left stationary over the button) -- neither of those
  // reliably fires pointerleave/pointercancel on their own. Also stops a
  // running airbrush timer for the same reason: alt-tabbing away mid-hold
  // would otherwise leave it silently repainting the canvas in the
  // background with no way to notice until switching back.
  window.addEventListener("blur", () => {
    endCompare();
    stopAirbrushTimer();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      endCompare();
      stopAirbrushTimer();
    }
  });
  // Keyboard equivalent (Tab to the button, hold Space or Enter) -- the
  // pointer-only listeners above left this button, uniquely among the
  // toolbar's controls, completely inert for keyboard-only use.
  $("pe-compare").addEventListener("keydown", (e) => {
    if (e.code === "Space" || e.code === "Enter") {
      e.preventDefault(); // stop Space from also scrolling the page
      startCompare();
    }
  });
  $("pe-compare").addEventListener("keyup", (e) => {
    if (e.code === "Space" || e.code === "Enter") endCompare();
  });
  // Backstop for the keyboard-hold path specifically: if focus moves away
  // from this button WHILE Space/Enter is still held down (e.g. clicking
  // a different toolbar button without releasing Space first), the keyup
  // for that held key fires on whichever element focus landed on instead
  // of here, so this element's own "keyup" listener above never runs and
  // endCompare() would otherwise never fire -- leaving the editor stuck
  // permanently "comparing" (every history action guarded by
  // isComparing() would silently no-op from then on). The window "blur"
  // listener above only covers losing focus to a DIFFERENT window/tab,
  // not focus moving to another element within this same page.
  $("pe-compare").addEventListener("blur", endCompare);

  document.addEventListener("keydown", (e) => {
    // Only the top dialog handles editor shortcuts and crop Escape.
    if (modal.hidden || modal.getAttribute("aria-modal") !== "true") return;
    // Escape resets a tilt in progress wherever focus is, instead of closing
    // the editor and losing edits; with nothing to reset it closes as usual.
    if (e.key === "Escape" && straightenPreviewing) {
      e.preventDefault();
      cancelStraightenPreview();
      return;
    }
    // Selection shortcuts that must also work while a slider or colour input has
    // focus (only real text entry keeps its own keys): Escape abandons a shape
    // being drawn instead of closing the editor, Ctrl+D deselects.
    const focused = document.activeElement;
    const typingText =
      focused &&
      (focused.tagName === "TEXTAREA" ||
        focused.isContentEditable ||
        (focused.tagName === "INPUT" && !["range", "color", "checkbox", "radio", "button"].includes(focused.type)));
    if (e.key === "Escape" && selDraft && SELECTION_TOOLS.includes(currentTool)) {
      e.preventDefault();
      selDraft = null;
      dragging = false;
      dragStart = null;
      redrawOverlay();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === "d" && !typingText) {
      e.preventDefault();
      deselect();
      return;
    }
    const active = document.activeElement;
    const tag = active && active.tagName;
    // The tilt slider has no text-editing undo of its own and is where focus
    // lands after Straighten, so Ctrl+Z/Y must still reach the editor there.
    if ((tag === "INPUT" && active.id !== "pe-straighten-angle") || tag === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    // A polygon being clicked out: Enter closes it, Backspace drops the last
    // corner.
    if (currentTool === "sel-poly" && selDraft && selDraft.polyClick && !mod) {
      if (e.key === "Enter") {
        e.preventDefault();
        finishPolygon();
        return;
      }
      if (e.key === "Backspace") {
        e.preventDefault();
        selDraft.pts.pop();
        if (!selDraft.pts.length) {
          selDraft = null;
          redrawOverlay();
        } else {
          drawSelectionDraft();
        }
        return;
      }
    }
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape" && currentTool === "select" && cropRect) {
      e.preventDefault();
      cropRect = null;
      $("pe-apply-crop").hidden = true;
      clearOverlay();
    }
  }, true);

  // ---------- Save ----------
  // Hard backstop against the data-loss path a critic pass found: if a
  // Compare hold's release event were ever somehow missed, the canvas
  // would still be showing the temporary unedited original with zero
  // visual indication -- exporting at that exact moment would silently
  // save the original over the real edit. Force-ending any in-progress
  // compare right before every export, unconditionally, means a save can
  // never capture the temporary preview no matter what left it stuck.
  function exportBlob(cb, mimeType, quality) {
    endCompare();
    canvas.toBlob(cb, mimeType || "image/png", quality);
  }

  // "Overwrite" always keeps the ORIGINAL file's own format, regardless
  // of the "Save as new" format selector -- the R2 object key's extension
  // is fixed once uploaded, so exporting a different format under the
  // same key would leave its content-type mismatched with its own file
  // extension. Before this feature, exportBlob() always hardcoded PNG,
  // which meant overwriting a JPEG/WebP original silently converted it to
  // PNG bytes under its original (non-.png) key -- a real, if previously
  // invisible, pre-existing bug. GIF/SVG originals still fall back to PNG
  // here since canvas.toBlob() has no encoder for either format (and a
  // GIF's animation is already destroyed the moment it's loaded into a
  // canvas at all, only the first frame ever gets drawn) -- an unavoidable
  // limitation of canvas-based export, not something fixable here.
  function originalMimeType() {
    const ext = (originalKey || "").split(".").pop().toLowerCase();
    return { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp" }[ext] || "image/png";
  }

  // Debounced live estimate of the exported file size at the currently
  // selected format/quality -- canvas.toBlob() is async, and re-running it
  // on every single slider-drag tick would be wasteful and could visibly
  // lag the slider.
  let sizeEstimateTimer = null;
  function scheduleSizeEstimate() {
    clearTimeout(sizeEstimateTimer);
    sizeEstimateTimer = setTimeout(updateSizeEstimate, 150);
  }
  // A critic pass on updateQualityVisibility() (below) found the estimate
  // this function shows was ALWAYS computed against "Save as new"'s own
  // format, even when the quality slider was only visible because of the
  // OVERWRITE path (a JPEG/WebP original with "Save as new"'s format
  // dropdown still at its PNG default). In that state, dragging the
  // slider changed the real overwrite output dramatically (confirmed:
  // 8.7KB at quality 10 vs 206KB at quality 100) while this label stayed
  // completely frozen at PNG's fixed size regardless of the slider --
  // exactly the "the control looks broken" impression this feature exists
  // to prevent. Now computes and shows BOTH paths' real estimates
  // whenever an original file exists to overwrite, each against its own
  // actual format/quality, instead of only ever labeling one blob
  // "Save as new" no matter which path the slider is actually affecting.
  let sizeEstimateGeneration = 0;
  function updateSizeEstimate() {
    const myGeneration = ++sizeEstimateGeneration;
    const format = $("pe-export-format").value;
    const quality = Number($("pe-export-quality").value) / 100;
    canvas.toBlob(
      (blob) => {
        if (myGeneration !== sizeEstimateGeneration || !blob) return;
        const saveAsNewText = `~${formatBytesLite(blob.size)} ("Save as new")`;
        if (!originalKey) {
          $("pe-export-size-estimate").textContent = saveAsNewText;
          return;
        }
        const overwriteMime = originalMimeType();
        const overwriteQuality = overwriteMime === "image/png" ? undefined : quality;
        canvas.toBlob(
          (overwriteBlob) => {
            if (myGeneration !== sizeEstimateGeneration) return;
            const overwriteText = overwriteBlob ? `~${formatBytesLite(overwriteBlob.size)} ("Overwrite")` : "";
            $("pe-export-size-estimate").textContent = overwriteText ? `${saveAsNewText} · ${overwriteText}` : saveAsNewText;
          },
          overwriteMime,
          overwriteQuality
        );
      },
      format,
      format === "image/png" ? undefined : quality
    );
  }
  function formatBytesLite(n) {
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  }
  // Shown whenever EITHER save path would actually use it -- "Save as
  // new"'s own format selector, or "Overwrite original"'s fixed original-
  // file format (now that overwrite respects this slider too, see the
  // fix at pe-save-overwrite's click handler). Without checking the
  // overwrite path too, opening a JPEG-original image (which always
  // resets "Save as new"'s format to PNG by default in open()) would
  // leave this control hidden even though overwriting that same file
  // now genuinely depends on it -- an admin would have no visible way to
  // adjust the one value that actually affects their overwrite's quality
  // unless they happened to also change the unrelated "Save as new"
  // format dropdown first.
  function updateQualityVisibility() {
    const saveAsNewNeedsIt = $("pe-export-format").value !== "image/png";
    const overwriteNeedsIt = !!originalKey && originalMimeType() !== "image/png";
    $("pe-export-quality-label").hidden = !saveAsNewNeedsIt && !overwriteNeedsIt;
  }
  $("pe-export-format").addEventListener("change", () => {
    updateQualityVisibility();
    scheduleSizeEstimate();
  });
  // Display-only -- changes what's behind the canvas so a transparent
  // PNG's actual transparent areas can be checked against a real-world
  // background (white/black/gray page), not just the conventional
  // checkerboard "this is transparent" indicator. Never touches pixel
  // data, so it needs no undo entry and nothing to persist.
  const bgPreviewSelect = $("pe-bg-preview");
  // Derives the class list to remove from the <select>'s own <option>
  // values rather than a hardcoded array -- a critic pass found the
  // original version hardcoded "pe-bg-white/black/gray" in two separate
  // places (here and in open()'s reset), with nothing tying either list
  // to the actual <option> elements or the CSS classes. A future 5th
  // option added to the HTML without also updating both hardcoded JS
  // lists would leave two pe-bg-* classes on the wrapper at once; reading
  // the options directly makes that drift impossible.
  function applyBgPreview(value) {
    Array.from(bgPreviewSelect.options).forEach((opt) => canvasWrap.classList.remove(`pe-bg-${opt.value}`));
    canvasWrap.classList.add(`pe-bg-${value}`);
  }
  bgPreviewSelect.addEventListener("change", (e) => applyBgPreview(e.target.value));
  $("pe-export-quality").addEventListener("input", scheduleSizeEstimate);

  $("pe-save-new").addEventListener("click", () => {
    const format = $("pe-export-format").value;
    const quality = format === "image/png" ? undefined : Number($("pe-export-quality").value) / 100;
    exportBlob(async (blob) => {
      try {
        await window.adminUploadBlob(blob);
        close();
        if (window.refreshMediaLibrary) window.refreshMediaLibrary();
      } catch (err) {
        alert(err.message);
      }
    }, format, quality);
  });

  $("pe-save-overwrite").addEventListener("click", () => {
    if (!originalKey) {
      alert("This image wasn't opened from the Media Library, so there's nothing to overwrite. Use \"Save as new\" instead.");
      return;
    }
    if (!confirm("Overwrite the original file? This updates it everywhere it's used on the site and can't be undone.")) return;
    const mimeType = originalMimeType();
    // A critic pass found this call previously passed no quality argument
    // at all, so canvas.toBlob() silently fell back to the browser's own
    // default JPEG/WebP encoder quality regardless of whatever the admin
    // had the "Save as new" quality slider set to -- the slider had zero
    // effect on the save path this codebase's own hint text calls out as
    // the primary one ("Editing a library image — overwrite updates it
    // everywhere it's used"). Reads the same slider "Save as new" already
    // uses, since it's the one quality control this editor has; PNG has
    // no quality concept at all (canvas.toBlob() ignores the argument for
    // lossless formats), matching "Save as new"'s own PNG handling.
    const quality = mimeType === "image/png" ? undefined : Number($("pe-export-quality").value) / 100;
    exportBlob(async (blob) => {
      try {
        const res = await fetch(`/api/admin/media/${originalKey}`, {
          method: "PUT",
          headers: { "Content-Type": blob.type },
          body: blob,
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error || "Overwrite failed");
        }
        close();
        if (window.refreshMediaLibrary) window.refreshMediaLibrary();
      } catch (err) {
        alert(err.message);
      }
    }, mimeType, quality);
  });

  // ---------- Open / close ----------
  function close() {
    resetPanState();
    modal.hidden = true;
  }
  $("close-photo-editor").addEventListener("click", close);
  window.addEventListener("resize", () => {
    if (!modal.hidden) fitCanvasToViewport(true);
  });
  // The canvas area settles a frame after the editor opens and changes size when
  // the bars around it wrap, so refit whenever the area itself changes size, not
  // only on window resizes (otherwise it can open scrolled at short heights).
  if (typeof ResizeObserver === "function") {
    let fitFrame = 0;
    let recentFits = [];
    let trailingFit = 0;
    new ResizeObserver(() => {
      if (fitFrame) return;
      fitFrame = requestAnimationFrame(() => {
        fitFrame = 0;
        if (modal.hidden) return;
        // Belt and braces: if refits keep re-triggering themselves (the bars
        // around the canvas re-wrapping with each new size), stop after a burst
        // and let the next real window resize or edit refit as usual.
        const now = performance.now();
        recentFits = recentFits.filter((t) => now - t < 500);
        if (recentFits.length >= 8) {
          // One trailing fit, so a tripped breaker never leaves a stale fit behind.
          clearTimeout(trailingFit);
          trailingFit = setTimeout(() => {
            if (!modal.hidden) fitCanvasToViewport(true);
          }, 300);
          return;
        }
        recentFits.push(now);
        fitCanvasToViewport(true);
      });
    }).observe(canvasWrap);
  }

  // Shared by both entry points below: everything that has to reset for
  // ANY brand-new editing session, regardless of whether the starting
  // pixels came from a loaded image or a blank transparent canvas.
  // Factored out rather than duplicated so a future reset-on-open fix
  // (there have been several this session -- named snapshots, brush
  // presets, view rotation) only ever needs to happen in one place.
  function initEditorSession(w, h, drawContent, hint) {
    zoomMode = "fit";
    resetPanState();
    lastFitDims = ""; // a new image: the size fields and the estimate start fresh even at the same size
    canvas.width = w;
    canvas.height = h;
    ctx.clearRect(0, 0, w, h);
    drawContent();
    syncOverlaySize();
    undoStack = [];
    redoStack = [];
    updateHistoryButtons();
    namedSnapshots = [];
    renderSnapshotSelect();
    originalSnapshot = snapshotCanvas();
    cropRect = null;
    baseSnapshot = null;
    dropSelection();
    $("pe-sel-view").value = "ants";
    $("pe-sel-mode").value = "replace";
    resetSelectionBox();
    lastAdjust = { brightness: 0, contrast: 0, saturate: 0 };
    $("pe-brightness").value = 0;
    $("pe-contrast").value = 0;
    $("pe-saturate").value = 0;
    $("pe-apply-preset").value = "";
    $("pe-apply-brush-preset").value = "";
    $("pe-apply-text-style").value = "";
    $("pe-crop-ratio").value = "free";
    $("pe-rect-radius").value = 0;
    $("pe-text-font").value = "sans-serif";
    viewRotation = 0;
    applyViewRotation();
    bgPreviewSelect.value = "checkerboard";
    applyBgPreview("checkerboard");
    loadPhotoPresets();
    loadBrushPresets();
    loadTextStyles();
    loadSelectionPresets();
    $("pe-hint").textContent = hint;
    $("pe-save-overwrite").hidden = !originalKey;
    setTool("select");
    $("pe-export-format").value = "image/png";
    $("pe-export-quality").value = 85;
    updateQualityVisibility();
    modal.hidden = false;
    requestAnimationFrame(fitCanvasToViewport);
  }

  window.PhotoEditor = {
    open(url, key) {
      originalKey = key || null;
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        let w = img.naturalWidth;
        let h = img.naturalHeight;
        const longEdge = Math.max(w, h);
        if (longEdge > MAX_DIMENSION) {
          const scale = MAX_DIMENSION / longEdge;
          w = Math.round(w * scale);
          h = Math.round(h * scale);
        }
        initEditorSession(
          w,
          h,
          () => ctx.drawImage(img, 0, 0, w, h),
          originalKey
            ? "Editing a library image — overwrite updates it everywhere it's used."
            : "Editing an external image — only \"Save as new\" is available."
        );
      };
      img.onerror = () => alert("Couldn't load that image for editing (it may be from another site that blocks this).");
      img.src = url;
    },
    // A brand-new, fully transparent canvas has no source image to
    // compare against or overwrite. initEditorSession hides Overwrite while
    // originalKey is null, leaving only "Save as new".
    openBlank(width, height) {
      originalKey = null;
      const w = Math.max(1, Math.min(MAX_DIMENSION, Number.isFinite(width) ? Math.round(width) : 1200));
      const h = Math.max(1, Math.min(MAX_DIMENSION, Number.isFinite(height) ? Math.round(height) : 630));
      initEditorSession(
        w,
        h,
        () => {}, // clearRect above already leaves it transparent -- nothing to draw
        "New blank image — nothing to overwrite yet, so only \"Save as new\" is available."
      );
    },
  };
})();

