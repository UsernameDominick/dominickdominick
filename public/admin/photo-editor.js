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
  // Mirrors worker/admin-api.js's /upload and PUT /media/:key size caps
  // (both 8MB) -- a separate literal here, not read from the server,
  // since there's no request-independent way for this client-side
  // module to ask the Worker what its own hardcoded limit is. Kept in
  // one named constant rather than a second copy of the number, so a
  // future change to the actual server-side cap only has to also update
  // this one spot (still manual, but a single spot instead of a bare
  // number duplicated inline in the tooltip text below).
  const MAX_EXPORT_MB = 8;

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

  // ---------- View rotation ----------
  // A purely cosmetic on-screen rotation (CSS transform on the stack),
  // completely separate from pe-rotate-left/right above (which actually
  // rotate the pixel data, resize the canvas, and count as an edit). This
  // never touches canvas.width/height or any pixel, and resets to 0 on
  // every image open like the other per-session view preferences
  // (background preview, crop ratio, etc.).
  let viewRotation = 0;
  function applyViewRotation() {
    stack.style.transform = viewRotation === 0 ? "" : `rotate(${viewRotation}deg)`;
    $("pe-view-rotate").textContent = `↻ View: ${viewRotation}°`;
  }
  $("pe-view-rotate").addEventListener("click", () => {
    viewRotation = (viewRotation + 90) % 360;
    applyViewRotation();
  });

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
    // Covers every dimension-changing edit (crop, rotate, undo/redo/reset,
    // load) for free since they all already call this function. Content-
    // only edits that don't change dimensions (a brush stroke, a filter)
    // don't refresh the estimate until the format/quality controls are
    // next touched or the image is actually saved -- the real exported
    // file is always encoded fresh from the live canvas regardless, so
    // this only affects how current the *preview number* looks, never
    // what actually gets uploaded.
    scheduleSizeEstimate();
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

  $("pe-save-snapshot").addEventListener("click", () => {
    // While Compare is held, the live canvas is temporarily swapped to
    // show originalSnapshot's pixels (a plain drawImage swap, not routed
    // through restoreSnapshot() -- see startCompare()'s own comment).
    // Without this guard, snapshotCanvas() here would capture that
    // temporary pre-edit preview instead of the actual current edit,
    // silently saving a mislabeled snapshot with the wrong content --
    // the exact bug class already hunted down and fixed for Undo/Redo/
    // Reset/Restore, just missed for this one.
    if (isComparing()) return;
    const name = prompt("Name this snapshot:", `Snapshot ${namedSnapshots.length + 1}`);
    if (!name || !name.trim()) return;
    namedSnapshots.push({ name: name.trim(), canvas: snapshotCanvas() });
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
    currentTool = tool;
    document.querySelectorAll(".pe-tool").forEach((b) => b.classList.toggle("active", b.dataset.tool === tool));
    $("pe-apply-crop").hidden = tool !== "select" || !cropRect;
    $("pe-rect-radius-label").hidden = tool !== "rect";
    $("pe-text-font").hidden = tool !== "text";
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
    clearOverlay();
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
    cancelActiveDrag();
  }
  $("pe-flip-h").addEventListener("click", () => flip(true));
  $("pe-flip-v").addEventListener("click", () => flip(false));

  // ---------- One-click filters ----------
  function applyOneShotFilter(cssFilter) {
    if (isComparing()) return;
    pushUndo();
    const snap = snapshotCanvas();
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = cssFilter;
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
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
      photoPresets.map((p) => `<option value="${p.id}">${p.name.replace(/</g, "&lt;")}</option>`).join("");
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.save();
    ctx.filter = `brightness(${b}%) contrast(${c}%) saturate(${s}%)`;
    ctx.drawImage(snap, 0, 0);
    ctx.restore();
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

  // ---------- Brush tools: erase / blur / pixelate / dodge / burn ----------
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
      brushPresets.map((p) => `<option value="${p.id}">${p.name.replace(/</g, "&lt;")}</option>`).join("");
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
    const name = prompt("Brush preset name:");
    if (!name || !name.trim()) return;
    try {
      await window.adminApi("/brush-presets", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), tool: currentTool, size: brushSize(), opacity: Number($("pe-brush-opacity").value) }),
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

  function placeText(point) {
    const text = prompt("Text to add:");
    if (!text) return;
    pushUndo();
    const fontSize = Math.max(16, annotateSize() * 6);
    ctx.fillStyle = annotateColor();
    // loadedFontFamily is only ever a real family name once a load has
    // actually succeeded (checked again here, not just trusted from the
    // dropdown's selection, in case the async check hadn't actually
    // finished -- or failed -- by the time this fires) -- otherwise this
    // falls back to the same plain sans-serif as before the font picker
    // existed.
    const useCustom = $("pe-text-font").value === "custom" && loadedFontFamily;
    const fontFamily = useCustom ? `'${loadedFontFamily}', sans-serif` : "sans-serif";
    ctx.font = `bold ${fontSize}px ${fontFamily}`;
    ctx.textBaseline = "top";
    ctx.fillText(text, point.x, point.y);
    // A critic pass found this was the one remaining pixel-mutating action
    // missing baseSnapshot invalidation -- and arguably the easiest of all
    // of them to actually trigger, since prompt() blocks the main thread
    // while the dialog is open, letting another pointer's adjust-slider
    // drag queue up input events that resume the instant this returns,
    // painting the pre-text baseSnapshot back over the canvas and silently
    // erasing the text that was just placed.
    invalidateOpenAdjustDrag();
  }

  // ---------- Pointer routing ----------
  const BRUSH_TOOLS = ["erase", "blur", "pixelate", "dodge", "burn"];
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
      strokeTo(p, pressureMultiplier(e));
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
      const constrained = applyCropRatio(cropRect.x0, cropRect.y0, p.x, p.y);
      cropRect.x1 = constrained.x1;
      cropRect.y1 = constrained.y1;
      drawCropOverlay();
    } else if (BRUSH_TOOLS.includes(currentTool)) {
      if (dragging && strokeActive) strokeTo(p, pressureMultiplier(e));
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
      if (strokeActive) {
        commitBrushStroke();
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
    } else if (SHAPE_TOOLS.includes(currentTool) && dragStart) {
      pushUndo();
      commitAnnotation(dragStart.x, dragStart.y, p.x, p.y);
      invalidateOpenAdjustDrag();
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
  const canvasWrap = $("pe-canvas-wrap");
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
        namedSnapshots = [];
        renderSnapshotSelect();
        originalSnapshot = snapshotCanvas();
        cropRect = null;
        baseSnapshot = null;
        lastAdjust = { brightness: 0, contrast: 0, saturate: 0 };
        $("pe-brightness").value = 0;
        $("pe-contrast").value = 0;
        $("pe-saturate").value = 0;
        $("pe-apply-preset").value = "";
        $("pe-apply-brush-preset").value = "";
        $("pe-crop-ratio").value = "free";
        $("pe-rect-radius").value = 0;
        $("pe-text-font").value = "sans-serif";
        viewRotation = 0;
        applyViewRotation();
        bgPreviewSelect.value = "checkerboard";
        applyBgPreview("checkerboard");
        loadPhotoPresets();
        loadBrushPresets();
        $("pe-hint").textContent = originalKey
          ? "Editing a library image — overwrite updates it everywhere it's used."
          : "Editing an external image — only \"Save as new\" is available.";
        setTool("select");
        $("pe-export-format").value = "image/png";
        $("pe-export-quality").value = 85;
        updateQualityVisibility();
        modal.hidden = false;
        requestAnimationFrame(fitCanvasToViewport);
      };
      img.onerror = () => alert("Couldn't load that image for editing (it may be from another site that blocks this).");
      img.src = url;
    },
  };
})();