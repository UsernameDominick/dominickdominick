(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  const modal = $("photo-editor-modal");
  const canvas = $("pe-canvas");
  const overlay = $("pe-overlay");
  const stack = $("pe-canvas-stack");
  const ctx = canvas.getContext("2d");
  const octx = overlay.getContext("2d");

  // Images larger than this (on the long edge) are downscaled on load —
  // plenty for a personal blog, and keeps brush/undo snapshots fast.
  const MAX_DIMENSION = 2000;
  const UNDO_LIMIT = 15;

  let originalKey = null;
  let undoStack = [];
  let redoStack = [];
  let originalSnapshot = null; // canvas clone taken when the image is first loaded, for "Reset"
  let currentTool = "select";
  let cropRect = null; // {x0,y0,x1,y1} in canvas pixel space
  let dragging = false;
  let dragStart = null;
  let baseSnapshot = null; // canvas clone taken when an adjust slider is first touched

  function fitCanvasToViewport() {
    const maxW = stack.parentElement.clientWidth * 0.9;
    const maxH = stack.parentElement.clientHeight * 0.9;
    const scale = Math.min(1, maxW / canvas.width, maxH / canvas.height);
    const w = Math.round(canvas.width * scale);
    const h = Math.round(canvas.height * scale);
    canvas.style.width = w + "px";
    canvas.style.height = h + "px";
    overlay.style.width = w + "px";
    overlay.style.height = h + "px";
    stack.style.width = w + "px";
    stack.style.height = h + "px";
    updateStatusBar(scale);
  }

  // Real pixel dimensions and the scale actually being displayed at right
  // now (this editor auto-fits to the viewport rather than having a manual
  // zoom control, so "zoom" here just means that fit ratio) — an admin
  // cropping/resizing has no other way to see the current pixel size
  // without exporting first.
  function updateStatusBar(scale) {
    const el2 = $("pe-status-bar");
    if (!el2) return;
    el2.textContent = `${canvas.width} × ${canvas.height}px · ${Math.round(scale * 100)}% displayed`;
  }

  function clearOverlay() {
    octx.clearRect(0, 0, overlay.width, overlay.height);
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

  function pushUndo() {
    undoStack.push(snapshotCanvas());
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack = [];
    updateHistoryButtons();
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
    cropRect = null;
    $("pe-apply-crop").hidden = true;
    clearOverlay();
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
    redoStack.push(snapshotCanvas());
    restoreSnapshot(prev);
    updateHistoryButtons();
  }

  function redo() {
    if (isComparing()) return;
    const next = redoStack.pop();
    if (!next) return;
    undoStack.push(snapshotCanvas());
    restoreSnapshot(next);
    updateHistoryButtons();
  }

  function resetToOriginal() {
    if (!originalSnapshot || isComparing()) return;
    if (!confirm("Discard all edits and go back to the original image?")) return;
    pushUndo();
    restoreSnapshot(originalSnapshot);
  }

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
    if (!originalSnapshot || compareSavedState || dragging) return;
    compareSavedState = snapshotCanvas();
    canvas.width = originalSnapshot.width;
    canvas.height = originalSnapshot.height;
    ctx.drawImage(originalSnapshot, 0, 0);
    syncOverlaySize();
    fitCanvasToViewport();
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
    $("pe-compare").classList.remove("active");
  }

  // ---------- Pointer <-> canvas coordinate mapping ----------
  function pointFromEvent(e) {
    const rect = overlay.getBoundingClientRect();
    const x = ((e.clientX - rect.left) / rect.width) * canvas.width;
    const y = ((e.clientY - rect.top) / rect.height) * canvas.height;
    return { x, y };
  }

  // ---------- Tool selection ----------
  function setTool(tool) {
    currentTool = tool;
    document.querySelectorAll(".pe-tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    $("pe-apply-crop").hidden = tool !== "select" || !cropRect;
    clearOverlay();
  }

  document.querySelectorAll(".pe-tool").forEach((btn) => {
    btn.addEventListener("click", () => setTool(btn.dataset.tool));
  });

  // ---------- Crop / select ----------
  function normalizedCrop(r) {
    return {
      x: Math.round(Math.min(r.x0, r.x1)),
      y: Math.round(Math.min(r.y0, r.y1)),
      w: Math.round(Math.abs(r.x1 - r.x0)),
      h: Math.round(Math.abs(r.y1 - r.y0)),
    };
  }

  function drawCropOverlay() {
    clearOverlay();
    if (!cropRect) return;
    const r = normalizedCrop(cropRect);
    octx.save();
    octx.fillStyle = "rgba(0,0,0,0.5)";
    octx.fillRect(0, 0, overlay.width, overlay.height);
    octx.clearRect(r.x, r.y, r.w, r.h);
    octx.strokeStyle = "#ff7a45";
    octx.lineWidth = Math.max(2, canvas.width * 0.002);
    octx.setLineDash([8, 6]);
    octx.strokeRect(r.x, r.y, r.w, r.h);
    octx.restore();
  }

  $("pe-apply-crop").addEventListener("click", () => {
    if (!cropRect) return;
    const r = normalizedCrop(cropRect);
    if (r.w < 2 || r.h < 2) return;
    pushUndo();
    const data = ctx.getImageData(r.x, r.y, r.w, r.h);
    canvas.width = r.w;
    canvas.height = r.h;
    ctx.putImageData(data, 0, 0);
    syncOverlaySize();
    cropRect = null;
    $("pe-apply-crop").hidden = true;
    clearOverlay();
    fitCanvasToViewport();
  });

  // ---------- Rotate ----------
  function rotate90(clockwise) {
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
    fitCanvasToViewport();
  }
  $("pe-rotate-left").addEventListener("click", () => rotate90(false));
  $("pe-rotate-right").addEventListener("click", () => rotate90(true));

  // ---------- Flip ----------
  function flip(horizontal) {
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
  }
  $("pe-flip-h").addEventListener("click", () => flip(true));
  $("pe-flip-v").addEventListener("click", () => flip(false));

  // ---------- One-click filters ----------
  function applyOneShotFilter(cssFilter) {
    pushUndo();
    const snap = snapshotCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = cssFilter;
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
  }
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
    if (!baseSnapshot) {
      pushUndo();
      baseSnapshot = document.createElement("canvas");
      baseSnapshot.width = canvas.width;
      baseSnapshot.height = canvas.height;
      baseSnapshot.getContext("2d").drawImage(canvas, 0, 0);
    }
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = filterString();
    ctx.drawImage(baseSnapshot, 0, 0);
    ctx.restore();
  }

  let lastAdjust = { brightness: 0, contrast: 0, saturate: 0 };

  function onAdjustCommit() {
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
      photoPresets.map((p) => `<option value="${p.id}">${p.name.replace(/</g, "&lt;")}</option>`).join("");
  }

  $("pe-apply-preset").addEventListener("change", () => {
    const id = Number($("pe-apply-preset").value);
    const preset = photoPresets.find((p) => p.id === id);
    if (!preset) return;
    pushUndo();
    const snap = snapshotCanvas();
    const b = 100 + Number(preset.adjust.brightness);
    const c = 100 + Number(preset.adjust.contrast);
    const s = 100 + Number(preset.adjust.saturate);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
  });

  $("pe-save-preset").addEventListener("click", async () => {
    const adjust = currentAdjust();
    if (!adjust.brightness && !adjust.contrast && !adjust.saturate) {
      alert("Adjust brightness, contrast, or saturation first, then save it as a preset.");
      return;
    }
    const name = prompt("Preset name:");
    if (!name) return;
    try {
      await window.adminApi("/photo-presets", { method: "POST", body: JSON.stringify({ name, adjust }) });
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

  // ---------- Brush tools: erase / blur / pixelate ----------
  let maskCanvas = null;
  let maskCtx = null;
  let strokeActive = false;
  let lastPoint = null;

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

  function strokeTo(point) {
    const size = brushSize();
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
    } else {
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
    if (currentTool === "erase") {
      ctx.save();
      ctx.globalCompositeOperation = "destination-out";
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
    ctx.drawImage(tmp, 0, 0);
  }

  function drawBrushCursor(point) {
    clearOverlay();
    octx.beginPath();
    octx.arc(point.x, point.y, brushSize() / 2, 0, Math.PI * 2);
    octx.strokeStyle = "#ff7a45";
    octx.lineWidth = Math.max(1, canvas.width * 0.0015);
    octx.stroke();
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

  function drawAnnotatePreview(x0, y0, x1, y1) {
    clearOverlay();
    const color = annotateColor();
    const size = annotateSize();
    octx.strokeStyle = color;
    octx.lineWidth = size;
    if (currentTool === "rect") {
      octx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
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
      ctx.strokeRect(Math.min(x0, x1), Math.min(y0, y1), Math.abs(x1 - x0), Math.abs(y1 - y0));
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

  function placeText(point) {
    const text = prompt("Text to add:");
    if (!text) return;
    pushUndo();
    const fontSize = Math.max(16, annotateSize() * 6);
    ctx.fillStyle = annotateColor();
    ctx.font = `bold ${fontSize}px sans-serif`;
    ctx.textBaseline = "top";
    ctx.fillText(text, point.x, point.y);
  }

  // ---------- Pointer routing ----------
  const BRUSH_TOOLS = ["erase", "blur", "pixelate"];
  const SHAPE_TOOLS = ["rect", "circle", "line", "arrow"];

  overlay.addEventListener("pointerdown", (e) => {
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
      strokeTo(p);
    } else if (currentTool === "text") {
      placeText(p);
      dragging = false;
    } else if (currentTool === "eyedropper") {
      pickColor(p);
      dragging = false;
    }
  });

  overlay.addEventListener("pointermove", (e) => {
    const p = pointFromEvent(e);
    if (currentTool === "select" && dragging && cropRect) {
      cropRect.x1 = p.x;
      cropRect.y1 = p.y;
      drawCropOverlay();
    } else if (BRUSH_TOOLS.includes(currentTool)) {
      if (dragging && strokeActive) strokeTo(p);
      drawBrushCursor(p);
    } else if (SHAPE_TOOLS.includes(currentTool) && dragging && dragStart) {
      drawAnnotatePreview(dragStart.x, dragStart.y, p.x, p.y);
    }
  });

  overlay.addEventListener("pointerup", (e) => {
    if (!dragging) return;
    dragging = false;
    const p = pointFromEvent(e);

    if (currentTool === "select") {
      $("pe-apply-crop").hidden = !cropRect;
    } else if (BRUSH_TOOLS.includes(currentTool)) {
      if (strokeActive) commitBrushStroke();
      strokeActive = false;
      lastPoint = null;
      clearOverlay();
    } else if (SHAPE_TOOLS.includes(currentTool) && dragStart) {
      pushUndo();
      commitAnnotation(dragStart.x, dragStart.y, p.x, p.y);
      clearOverlay();
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
  // reliably fires pointerleave/pointercancel on their own.
  window.addEventListener("blur", endCompare);
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) endCompare();
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

  document.addEventListener("keydown", (e) => {
    if (modal.hidden) return;
    const tag = document.activeElement && document.activeElement.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "z") {
      e.preventDefault();
      if (e.shiftKey) redo();
      else undo();
    } else if (mod && e.key.toLowerCase() === "y") {
      e.preventDefault();
      redo();
    } else if (e.key === "Escape" && currentTool === "select" && cropRect) {
      cropRect = null;
      $("pe-apply-crop").hidden = true;
      clearOverlay();
    }
  });

  // ---------- Save ----------
  // Hard backstop against the data-loss path a critic pass found: if a
  // Compare hold's release event were ever somehow missed, the canvas
  // would still be showing the temporary unedited original with zero
  // visual indication -- exporting at that exact moment would silently
  // save the original over the real edit. Force-ending any in-progress
  // compare right before every export, unconditionally, means a save can
  // never capture the temporary preview no matter what left it stuck.
  function exportBlob(cb) {
    endCompare();
    canvas.toBlob(cb, "image/png");
  }

  $("pe-save-new").addEventListener("click", () => {
    exportBlob(async (blob) => {
      try {
        await window.adminUploadBlob(blob);
        close();
        if (window.refreshMediaLibrary) window.refreshMediaLibrary();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  $("pe-save-overwrite").addEventListener("click", () => {
    if (!originalKey) {
      alert("This image wasn't opened from the Media Library, so there's nothing to overwrite. Use \"Save as new\" instead.");
      return;
    }
    if (!confirm("Overwrite the original file? This updates it everywhere it's used on the site and can't be undone.")) return;
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
    });
  });

  // ---------- Open / close ----------
  function close() {
    modal.hidden = true;
  }
  $("close-photo-editor").addEventListener("click", close);
  window.addEventListener("resize", () => {
    if (!modal.hidden) fitCanvasToViewport();
  });

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
        canvas.width = w;
        canvas.height = h;
        ctx.clearRect(0, 0, w, h);
        ctx.drawImage(img, 0, 0, w, h);
        syncOverlaySize();
        undoStack = [];
        redoStack = [];
        updateHistoryButtons();
        originalSnapshot = snapshotCanvas();
        cropRect = null;
        baseSnapshot = null;
        lastAdjust = { brightness: 0, contrast: 0, saturate: 0 };
        $("pe-brightness").value = 0;
        $("pe-contrast").value = 0;
        $("pe-saturate").value = 0;
        $("pe-apply-preset").value = "";
        loadPhotoPresets();
        $("pe-hint").textContent = originalKey
          ? "Editing a library image — overwrite updates it everywhere it's used."
          : "Editing an external image — only \"Save as new\" is available.";
        setTool("select");
        modal.hidden = false;
        requestAnimationFrame(fitCanvasToViewport);
      };
      img.onerror = () => alert("Couldn't load that image for editing (it may be from another site that blocks this).");
      img.src = url;
    },
  };
})();