(function () {
  "use strict";

  const COLS = 24;
  const ROW_H = 16;

  const el = (id) => document.getElementById(id);
  // A <header> inside an open dialog would count as a second page banner; the page's own header is the only one.
  document.querySelectorAll(".modal-inner header").forEach((h) => h.setAttribute("role", "presentation"));
  const DIALOG_SELECTOR = ".modal";
  const OPEN_DIALOG_SELECTOR = ".modal:not([hidden])";
  // Wires a "×" button that just needs to hide its modal — most of them.
  // Ones that also need to reset state (media picker, command palette)
  // wire their own close handler instead of using this.
  const closeModalOnClick = (btnId, modalId) => el(btnId).addEventListener("click", () => (el(modalId).hidden = true));
  const modalFocusReturn = new WeakMap();

  // Every .modal shares one z-index, so a dialog opened from inside
  // another (Browse… from Site Settings, a media tile's details) used to
  // land underneath it whenever it came earlier in
  // index.html -- visible but unclickable. The most recently opened
  // dialog now always stacks above the ones already open.
  function raiseDialogAboveOthers(target) {
    target.style.zIndex = "";
    const base = Number(getComputedStyle(target).zIndex) || 100;
    const others = [...document.querySelectorAll(OPEN_DIALOG_SELECTOR)].filter((dialog) => dialog !== target);
    const top = Math.max(0, ...others.map((dialog) => Number(getComputedStyle(dialog).zIndex) || 0));
    if (top >= base) target.style.zIndex = String(top + 1);
  }
  const modalStackObserver = new MutationObserver((mutations) => {
    for (const { target } of mutations) {
      if (target.hidden) target.style.zIndex = "";
      else raiseDialogAboveOthers(target);
    }
    syncModalSemantics();
  });
  document.querySelectorAll(DIALOG_SELECTOR).forEach((m) => modalStackObserver.observe(m, { attributes: true, attributeFilter: ["hidden"] }));
  syncModalSemantics();

  // A stronger confirmation for bulk operations that are actually
  // irreversible (media bulk-delete) — a plain confirm()'s
  // "OK" button is a single reflexive click/Enter-press away, easy to
  // fire on autopilot after clicking through a routine bulk action.
  // Requiring the exact word "DELETE" to be typed forces a deliberate
  // pause before something with no undo path actually happens. Returns
  // a Promise<boolean>; Cancel, Escape, the × button, and a backdrop
  // click (the generic .modal backdrop-click-to-close handler covers
  // this one too, same as every other modal in the app) all resolve false.
  // Only one confirmTyped() can be pending at a time — a second call
  // settles the first as false rather than leaving that first
  // await hanging forever.
  let typedConfirmResolve = null;
  function confirmTyped(message, { title = "Confirm", requiredWord = "DELETE" } = {}) {
    if (typedConfirmResolve) settleTypedConfirm(false);
    return new Promise((resolve) => {
      typedConfirmResolve = resolve;
      el("typed-confirm-title").textContent = title;
      el("typed-confirm-message").textContent = message;
      el("typed-confirm-label").textContent = `Type ${requiredWord} to confirm:`;
      const input = el("typed-confirm-input");
      const okBtn = el("typed-confirm-ok");
      input.value = "";
      okBtn.disabled = true;
      input.dataset.requiredWord = requiredWord;
      const modal = el("typed-confirm-modal");
      modalFocusReturn.set(modal, document.activeElement);
      modal.hidden = false;
      input.focus();
    });
  }
  function settleTypedConfirm(result) {
    el("typed-confirm-modal").hidden = true;
    const resolve = typedConfirmResolve;
    typedConfirmResolve = null;
    if (resolve) resolve(result);
  }
  el("typed-confirm-input").addEventListener("input", (e) => {
    el("typed-confirm-ok").disabled = e.target.value !== e.target.dataset.requiredWord;
  });
  el("typed-confirm-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !el("typed-confirm-ok").disabled) settleTypedConfirm(true);
    else if (e.key === "Escape") {
      // Without this, Escape bubbles to the document-level shortcut
      // handler, which by then sees no open .modal (this one already
      // hid itself) and falls through to its own Escape behavior —
      // clearing the canvas block selection and closing the Inspector
      // as an unrelated side effect of canceling a delete confirmation.
      e.stopPropagation();
      settleTypedConfirm(false);
    }
  });
  el("typed-confirm-ok").addEventListener("click", () => settleTypedConfirm(true));
  el("typed-confirm-cancel").addEventListener("click", () => settleTypedConfirm(false));
  el("close-typed-confirm").addEventListener("click", () => settleTypedConfirm(false));

  const canvas = el("canvas");
  const loginScreen = el("login-screen");
  const app = el("app");

  // ---------- Mobile drawers ----------
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
  const backdrop = el("drawer-backdrop");

  // Closing whichever drawer is already open before opening a new one keeps
  // two same-side drawers (the block palette and the sidebar both slide in
  // from the left) from ever being open at once if something taps both
  // triggers back to back without hitting the backdrop in between.
  function openDrawer(drawerEl) {
    closeDrawers();
    drawerEl.classList.add("drawer-open");
    backdrop.hidden = false;
  }
  function closeDrawers() {
    el("palette").classList.remove("drawer-open");
    el("inspector").classList.remove("drawer-open");
    el("admin-sidebar").classList.remove("drawer-open");
    backdrop.hidden = true;
  }
  el("mobile-menu-btn").addEventListener("click", () => openDrawer(el("palette")));
  el("close-palette").addEventListener("click", closeDrawers);
  el("close-inspector").addEventListener("click", closeDrawers);
  el("site-menu-btn").addEventListener("click", () => openDrawer(el("admin-sidebar")));
  el("close-site-menu").addEventListener("click", closeDrawers);
  backdrop.addEventListener("click", closeDrawers);
  // Tapping a nav item inside the mobile sidebar drawer should close it, not
  // leave it open behind the modal/panel it opened. The theme and
  // density toggles stay open: they change how the drawer itself looks, so closing
  // it would hide the very change being made.
  el("admin-sidebar").querySelectorAll("button, a").forEach((node) => {
    if (["close-site-menu", "admin-theme-toggle", "admin-density-toggle"].includes(node.id)) return;
    node.addEventListener("click", () => {
      if (isMobile()) closeDrawers();
    });
  });
  let pages = [];
  let currentPage = null;
  let blocks = [];
  let selectedBlockId = null;
  // Shift-click adds/removes a block here. Non-empty takes over the
  // inspector (bulk mode) regardless of size, including 1 — kept as a
  // separate concept from selectedBlockId rather than collapsing back to
  // single-select at size 1, so the mode doesn't flip-flop mid-selection.
  let multiSelectedIds = new Set();
  function isLayoutLocked(b) {
    return !!b.locked;
  }

  // Whether big photos are shrunk on upload (the "Shrink big photos" box in the Media Library; on unless switched off).
  const SHRINK_KEY = "media_shrink_big";
  function shrinkBigEnabled() {
    try {
      return localStorage.getItem(SHRINK_KEY) !== "0";
    } catch {
      return true;
    }
  }

  // The bytes to upload for a file, and whether it was made smaller to fit. Phone photos carry EXIF GPS coordinates and other metadata
  // that has no business being published, so JPEG and PNG are re-decoded through a canvas (which drops it; GIF and WebP can be animated
  // and are left alone, as is the original on any decode error) and, when the box is ticked and the picture is over the limit (window.ImageFit.MAX_SIDE), are scaled down
  // so the longest side fits. A phone photo is often over the uploader's 8 MB cap, so this is also what lets it in at all.
  async function prepareImageForUpload(file) {
    const plain = { blob: file, resized: null };
    // A plain Blob (not a File) can only have come from in-app canvas processing.
    if (!(file instanceof File)) return plain;
    if (!window.ImageFit.canShrink(file.type)) return plain;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const fit = shrinkBigEnabled() ? window.ImageFit.fitWithin(bitmap.width, bitmap.height) : { width: bitmap.width, height: bitmap.height, scaled: false };
      const canvas = new OffscreenCanvas(fit.width, fit.height);
      const ctx = canvas.getContext("2d");
      if (fit.scaled) ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bitmap, 0, 0, fit.width, fit.height);
      const blob = await canvas.convertToBlob({ type: file.type, quality: 0.92 });
      if (!blob.size) return plain;
      return { blob, resized: fit.scaled ? { from: [bitmap.width, bitmap.height], to: [fit.width, fit.height] } : null };
    } catch {
      return plain;
    }
  }

  async function uploadFile(file, folder) {
    const prepared = await prepareImageForUpload(file);
    file = prepared.blob;
    const res = await fetch("/api/admin/upload" + (folder ? `?folder=${encodeURIComponent(folder)}` : ""), {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }
    const json = await res.json();
    return prepared.resized ? { ...json, resized: prepared.resized } : json;
  }

  // Fills a field with a URL — either replacing its value (used by single
  // image fields) or appending it as a new line (used by the gallery block's
  // one-URL-per-line textarea).
  function setFieldUrl(input, url, append) {
    input.value = append ? (input.value ? input.value + "\n" + url : url) : url;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Wires any <button class="upload-trigger" data-target="#id"> to open a file
  // picker and fill the target input with the uploaded file's URL. A
  // data-append="1" attribute appends instead of replacing.
  function wireUploadButton(btn) {
    const targetInput = document.querySelector(btn.dataset.target);
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    fileInput.hidden = true;
    btn.after(fileInput);
    btn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const originalText = btn.textContent;
      btn.textContent = "Uploading…";
      btn.disabled = true;
      try {
        const { url } = await uploadFile(file);
        setFieldUrl(targetInput, url, btn.dataset.append === "1");
      } catch (err) {
        alert(err.message);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        fileInput.value = "";
      }
    });
  }

  // Wires any <button class="browse-trigger" data-target="#id"> to open the
  // media library in picker mode, filling the target input on click.
  function wireBrowseButton(btn) {
    btn.addEventListener("click", () => openMediaModal(btn.dataset.target, btn.dataset.append === "1"));
  }

  // Wires any <span class="image-url-source-badge" data-target="#id"> to
  // show whether the target field's current value is a file actually
  // uploaded to this site (relative /media/... URL, same check db.js's
  // own dangling-reference reconciliation uses for "is this a locally-
  // hosted media reference") or a URL typed/pasted in directly -- most
  // commonly hotlinking someone else's image, which this field's plain
  // text input has always silently allowed with no indication either way
  // that it's a fundamentally different, less durable kind of reference
  // than an upload. Updates live as the field is typed into or filled by
  // Upload/Browse, not just once on initial render.
  function wireImageUrlSourceBadge(badge) {
    const input = document.querySelector(badge.dataset.target);
    if (!input) return;
    const update = () => {
      const value = (input.value || "").trim();
      if (!value) {
        badge.textContent = "";
        badge.className = "image-url-source-badge";
      } else if (value.startsWith("/media/")) {
        badge.textContent = "Local upload";
        badge.className = "image-url-source-badge is-local";
      } else {
        badge.textContent = "External URL";
        badge.className = "image-url-source-badge is-external";
      }
    };
    // Stashed on the input (rather than only closed over here) so a code
    // path that sets `.value` directly without going through a real user
    // interaction -- the media modal's image-block autofill branch below
    // is exactly such a path -- can refresh the badge without dispatching
    // a synthetic "change" event on a shared input. A critic pass found
    // dispatching one there re-triggered this same input's OWN unrelated
    // generic autosave-on-change listener (every [data-key] field gets
    // one), firing an extra, incomplete PATCH mid-branch that raced the
    // branch's own deliberate merged save -- reintroducing the exact
    // "independent saves can race and silently drop a field" failure mode
    // that merged save was written to avoid in the first place.
    input._imageUrlBadgeUpdate = update;
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    update();
  }
  async function api(path, opts = {}) {
    const res = await fetch("/api/admin" + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401) {
      showLogin();
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || "Request failed");
      err.status = res.status;
      err.conflict = !!body.conflict;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  // ---------- Unsaved-change protection ----------
  // Any in-flight or failed save sets this; a successful one clears it. The
  // realistic gap this covers is small (autosave debounces ~2s, block edits
  // save on blur) but real — closing the tab mid-request, or right after a
  // save that failed silently in the background, would otherwise lose work
  // with no warning at all.
  let unsavedDirty = false;
  window.addEventListener("beforeunload", (e) => {
    if (!unsavedDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Shown when the server rejects a save because the record changed
  // elsewhere since this tab loaded it (another tab, another device, or
  // this same admin editing it twice) — see checkConflict() server-side.
  // Deliberately doesn't attempt a merge or diff; it just refuses to
  // silently clobber the other change and gives the admin an explicit way
  // to load the current version.
  function renderConflictStatus(statusElId, onReload) {
    const e = el(statusElId);
    e.innerHTML = "";
    const span = document.createElement("span");
    span.className = "save-conflict";
    span.textContent = "Changed elsewhere since you loaded it — your last edit wasn't saved. ";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "save-conflict-reload";
    btn.textContent = "Reload latest version";
    btn.addEventListener("click", async () => {
      await onReload();
      e.innerHTML = ""; // the message described the version that was just replaced
    });
    span.appendChild(btn);
    e.appendChild(span);
  }

  // ---------- Crash recovery ----------
  // A local (per-browser, never sent anywhere) snapshot of in-progress
  // edits, written on every keystroke — not the debounced server autosave.
  // This is what catches a crashed tab, a browser force-quit, or a save
  // that's been silently failing (offline, expired session) for a while:
  // none of those get a chance to run a "before you go" handler, so the
  // beforeunload guard above can't help. Wrapped in try/catch throughout
  // since localStorage can throw (private browsing, blocked site data).
  function draftKey(kind, id) {
    return `admin_draft_${kind}_${id || "new"}`;
  }
  function saveDraft(kind, id, fields) {
    try {
      localStorage.setItem(draftKey(kind, id), JSON.stringify({ savedAt: Date.now(), fields }));
    } catch {}
  }
  function loadDraft(kind, id) {
    try {
      const raw = localStorage.getItem(draftKey(kind, id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function clearDraft(kind, id) {
    try {
      localStorage.removeItem(draftKey(kind, id));
    } catch {}
  }

  // Shown when a local draft exists for whatever was just loaded — either
  // it matches what's on the server (a normal after-save leftover, cleared
  // silently) or it doesn't (something crashed before it could be saved),
  // in which case the admin gets to choose rather than either losing it
  // silently or having it silently clobber what they just opened.
  function renderDraftRecoveryBanner(statusElId, kind, id, draft, onRestore) {
    const e = el(statusElId);
    e.innerHTML = "";
    const span = document.createElement("span");
    span.className = "save-conflict";
    span.textContent = `Unsaved draft from ${new Date(draft.savedAt).toLocaleString()} found (crashed tab or browser?). `;
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "save-conflict-reload";
    restoreBtn.textContent = "Restore it";
    restoreBtn.addEventListener("click", onRestore);
    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "save-conflict-reload";
    discardBtn.style.marginLeft = "6px";
    discardBtn.textContent = "Discard";
    discardBtn.addEventListener("click", () => {
      clearDraft(kind, id);
      e.textContent = "";
    });
    span.appendChild(restoreBtn);
    span.appendChild(discardBtn);
    e.appendChild(span);
  }

  function showLogin() {
    loginScreen.hidden = false;
    app.hidden = true;
  }

  function showApp() {
    loginScreen.hidden = true;
    app.hidden = false;
  }

  // ---------- Auth ----------
  // The message sits in a role="alert" paragraph, so a screen reader announces it as soon as it appears.
  function showLoginError(message) {
    el("login-error").textContent = message || "";
    if (message) el("password").setAttribute("aria-invalid", "true");
    else el("password").removeAttribute("aria-invalid");
  }
  el("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = el("password").value;
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        if (res.status === 429 && data.error) showLoginError(data.error);
        else if (res.status === 401) showLoginError("Wrong password.");
        else showLoginError(`Couldn't sign in (error ${res.status}). Try again in a moment.`);
        return;
      }
      showLoginError("");
      await boot();
    } catch (err) {
      showLoginError("Couldn't reach the server. Check your connection and try again.");
    }
  });

  el("logout-btn").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    showLogin();
  });

  el("admin-theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const next = (root.getAttribute("data-theme") || "dark") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("admin-theme", next);
    } catch (e) {}
  });

  // ---------- Interface density (comfortable / compact) ----------
  // A per-browser preference, like the theme: the head script in index.html applies a
  // saved "compact" before first paint, this keeps the button's state in step with it.
  function applyDensity(compact) {
    const root = document.documentElement;
    if (compact) root.setAttribute("data-density", "compact");
    else root.removeAttribute("data-density");
    const btn = el("admin-density-toggle");
    btn.setAttribute("aria-pressed", compact ? "true" : "false");
    btn.title = compact ? "Compact interface is on: click for comfortable spacing" : "Compact interface: tighter spacing in this browser";
  }
  applyDensity(document.documentElement.getAttribute("data-density") === "compact");
  el("admin-density-toggle").addEventListener("click", () => {
    const compact = document.documentElement.getAttribute("data-density") !== "compact";
    applyDensity(compact);
    try {
      localStorage.setItem("admin-density", compact ? "compact" : "comfortable");
    } catch (e) {}
  });

  // Save-status pill: the editors each write free text ("Saving…", "Saved 10:42", "Save failed: …")
  // into their own status element. Classify it into data-state (errors first, since "wasn't saved"
  // contains "saved") so the .save-pill CSS can style them all alike.
  const SAVE_STATUS_IDS = ["page-save-status", "block-save-status"];
  function classifySaveText(t) {
    if (!t) return "";
    if (/fail|error|couldn|conflict|wasn.t saved|not saved|changed elsewhere/i.test(t)) return "error";
    if (/^saving|merging/i.test(t)) return "saving";
    if (/unsaved|changes…|editing|need saving/i.test(t)) return "dirty";
    if (/saved/i.test(t)) return "saved";
    return "";
  }
  SAVE_STATUS_IDS.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.classList.add("save-pill");
    const sync = () => {
      const st = classifySaveText(node.textContent.trim());
      if (st) node.dataset.state = st;
      else delete node.dataset.state;
    };
    new MutationObserver(sync).observe(node, { childList: true, characterData: true, subtree: true });
    sync();
  });

  // ---------- Pages ----------
  async function loadPages() {
    // The site is the home page and the Studio: only the home page is offered here.
    const allPages = await api("/pages");
    pages = allPages.some((p) => p.slug === "home") ? allPages.filter((p) => p.slug === "home") : allPages;
    const picker = el("page-picker");
    picker.innerHTML = pages
      .map((p) => `<option value="${p.id}">${escapeHtml(p.title || p.slug)}</option>`)
      .join("");
    if (pages.length) {
      const stillExists = currentPage && pages.find((p) => p.id === currentPage.id);
      await selectPage(stillExists ? currentPage.id : pages[0].id);
    } else {
      currentPage = null;
      blocks = [];
      selectedBlockId = null;
      canvas.innerHTML = "<p style='color:var(--text-dim);padding:24px;'>There is no home page to edit yet.</p>";
      renderInspector();
      updatePasteButtonVisibility();
    }
  }

  async function selectPage(id) {
    currentPage = pages.find((p) => p.id === id);
    if (!currentPage) return;
    el("page-picker").value = id;
    el("page-title").value = currentPage.title || "";
    el("page-meta").value = currentPage.meta_description || "";
    el("page-og-image").value = currentPage.og_image || "";
    el("page-save-status").textContent = "";
    updatePageOgPreview();
    checkPageDraftRecovery(currentPage.id);
    updatePasteButtonVisibility();
    el("admin-view-live").href = currentPage.slug === "home" ? "/" : `/${currentPage.slug}`;
    await loadBlocks();
  }

  // ---------- Page-settings crash-recovery draft ----------
  // Page settings have no server-side autosave at all (only the explicit
  // Save button), so this local snapshot is the *only* safety net between
  // typing and clicking Save.
  const PAGE_DRAFT_FIELD_IDS = ["page-title", "page-meta", "page-og-image"];
  function capturePageRawFields() {
    const out = {};
    for (const id of PAGE_DRAFT_FIELD_IDS) out[id] = el(id).value;
    return out;
  }
  function applyPageRawFields(fields) {
    for (const id of PAGE_DRAFT_FIELD_IDS) {
      if (id in fields) el(id).value = fields[id];
    }
    updatePageOgPreview();
  }
  function snapshotPageDraft() {
    if (!currentPage) return;
    saveDraft("page", currentPage.id, capturePageRawFields());
  }
  function checkPageDraftRecovery(pageId) {
    const draft = loadDraft("page", pageId);
    if (!draft) return;
    if (JSON.stringify(draft.fields) === JSON.stringify(capturePageRawFields())) {
      clearDraft("page", pageId);
      return;
    }
    renderDraftRecoveryBanner("page-save-status", "page", pageId, draft, () => {
      applyPageRawFields(draft.fields);
      clearDraft("page", pageId);
      unsavedDirty = true;
    });
  }

  el("page-picker").addEventListener("change", (e) => selectPage(Number(e.target.value)));

  PAGE_DRAFT_FIELD_IDS.forEach((id) =>
    el(id).addEventListener("input", () => {
      unsavedDirty = true;
      el("page-save-status").textContent = "Unsaved changes…";
      snapshotPageDraft();
    })
  );

  el("save-page-settings").addEventListener("click", async () => {
    if (!currentPage) return;
    el("page-save-status").textContent = "Saving…";
    try {
      await api(`/pages/${currentPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: el("page-title").value,
          meta_description: el("page-meta").value,
          og_image: el("page-og-image").value || null,
          expected_version: currentPage.version,
        }),
      });
      unsavedDirty = false;
      clearDraft("page", currentPage.id);
      await loadPages();
      el("page-save-status").textContent = "Saved " + new Date().toLocaleTimeString();
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("page-save-status", async () => {
          await loadPages();
        });
        return;
      }
      el("page-save-status").textContent = "Save failed: " + err.message;
      alert(err.message);
    }
  });

  // ---------- Group / ungroup ----------
  el("bulk-group-btn").addEventListener("click", async () => {
    const sel = selectedBlocksList();
    if (sel.length < 2) return alert("Select at least two blocks to group them.");
    try {
      await setBlocksGroup(sel, newGroupId());
    } catch (err) {
      alert(err.message);
    }
    renderCanvas();
    renderInspector();
  });
  el("bulk-ungroup-btn").addEventListener("click", async () => {
    const sel = selectedBlocksList().filter((b) => groupOf(b));
    if (!sel.length) return alert("None of the selected blocks are grouped.");
    // Ungrouping one member releases the whole group, not just the selected part of it.
    const ids = new Set(sel.map(groupOf));
    const all = blocks.filter((b) => ids.has(groupOf(b)));
    try {
      await setBlocksGroup(all, null);
    } catch (err) {
      alert(err.message);
    }
    renderCanvas();
    renderInspector();
  });

  // ---------- Blocks ----------
  async function loadBlocks() {
    blocks = await api(`/pages/${currentPage.id}/blocks`);
    selectedBlockId = null;
    renderCanvas();
    renderInspector();
  }

  function canvasMetrics() {
    const rect = canvas.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(canvas).getPropertyValue("--canvas-gap")) || 8;
    const colW = (rect.width - (COLS - 1) * gap) / COLS;
    return { colW, rowH: ROW_H, gap, width: rect.width };
  }

  function blockPixelStyle(b) {
    const { colW, rowH, gap } = canvasMetrics();
    const left = (b.col - 1) * (colW + gap);
    const width = b.col_span * colW + (b.col_span - 1) * gap;
    const top = (b.row - 1) * (rowH + gap);
    const height = b.row_span * rowH + (b.row_span - 1) * gap;
    return { left, top, width, height };
  }

  // Re-applies each already-rendered block's pixel geometry against the
  // canvas's *current* width, without touching the DOM nodes themselves —
  // called after anything that can change the canvas's available width
  // (showing/hiding the Inspector shrinks/grows it) without a full
  // renderCanvas(). Without this, a block selected while the Inspector was
  // closed keeps the wider left/width values computed for the pre-Inspector
  // canvas, so a block whose col_span reaches the old width (e.g. any
  // freshly-added block, which defaults to the full 24 columns) visually
  // overflows under the now-narrower Inspector panel — including its
  // resize handle, making it unreachable until the block is resized some
  // other way first.
  function repositionBlocks() {
    if (isMobile()) return;
    canvas.querySelectorAll(".admin-block").forEach((div) => {
      const block = blocks.find((b) => b.id === Number(div.dataset.id));
      if (!block) return;
      const style = blockPixelStyle(block);
      div.style.left = style.left + "px";
      div.style.top = style.top + "px";
      div.style.width = style.width + "px";
      div.style.height = style.height + "px";
    });
    scheduleOverflowMarks();
    syncQuickEdit();
  }

  // ---------- Fit blocks to their content ----------
  // The public page grows its rows to fit whatever a block holds, but the canvas gives every block a fixed height, so a heading or a
  // paragraph can sit cut off in the editor. These helpers measure what a block really needs (its preview at the block's own width),
  // mark blocks that overflow, and fit one block or all of them, pushing the blocks below down so nothing overlaps (public/admin/block-fit.js).
  const FIT_TYPES = new Set(["heading", "text", "quote", "image", "button"]);
  const imageDims = new Map(); // url -> {w, h} once loaded, "loading" or "bad" otherwise
  let overflowTimer = null;
  function imageSizeAttrs(url) {
    const d = imageDims.get(url);
    if (d && typeof d === "object") return ` width="${d.w}" height="${d.h}"`;
    if (!imageDims.has(url)) loadImageDims(url);
    return "";
  }
  function loadImageDims(url) {
    return new Promise((resolve) => {
      const known = imageDims.get(url);
      if (known && typeof known === "object") return resolve(known);
      if (known === "bad") return resolve(null);
      const im = new Image();
      imageDims.set(url, "loading");
      im.onload = () => {
        const d = { w: im.naturalWidth || 0, h: im.naturalHeight || 0 };
        imageDims.set(url, d.w && d.h ? d : "bad");
        scheduleOverflowMarks();
        resolve(d.w && d.h ? d : null);
      };
      im.onerror = () => {
        imageDims.set(url, "bad");
        resolve(null);
      };
      im.src = url;
    });
  }
  // How tall the block's preview needs to be at a given width, borders and label included; null when it cannot be known.
  function measureBlockPx(b, widthPx) {
    if (!FIT_TYPES.has(b.type)) return null;
    if (b.type === "image") {
      const url = b.content && b.content.url;
      if (!url) return null;
      const d = imageDims.get(url);
      if (!d || typeof d !== "object") return null;
    }
    const probe = document.createElement("div");
    probe.className = "admin-block admin-block-probe";
    probe.setAttribute("aria-hidden", "true");
    probe.style.cssText = `position:absolute;left:-99999px;top:0;visibility:hidden;pointer-events:none;height:auto;width:${Math.max(24, Math.round(widthPx))}px;`;
    probe.innerHTML = `<div class="block-type-label"><span class="block-type-name">${blockLabel(b.type)}</span>${blockBadgesHtml(b)}</div><div class="block-preview">${blockPreview(b)}</div>`;
    document.body.appendChild(probe);
    const h = probe.getBoundingClientRect().height;
    probe.remove();
    return h;
  }
  function minRowsFor(b, colSpan) {
    const { colW } = canvasMetrics();
    const h = measureBlockPx({ ...b }, BlockFit.widthForCols(colSpan, colW));
    return h === null ? null : BlockFit.rowsForHeight(h);
  }
  function scheduleOverflowMarks() {
    clearTimeout(overflowTimer);
    overflowTimer = setTimeout(markOverflows, 60);
  }
  function markOverflows() {
    if (isMobile() || !canvas) return;
    canvas.querySelectorAll(".block-fit-hint").forEach((n) => n.remove());
    canvas.querySelectorAll(".admin-block").forEach((div) => {
      const b = blocks.find((x) => x.id === Number(div.dataset.id));
      let over = false;
      if (b && FIT_TYPES.has(b.type) && !(b.style && b.style.hidden)) {
        const need = measureBlockPx(b, div.offsetWidth);
        over = need !== null && need > div.offsetHeight + 2;
      }
      div.classList.toggle("block-overflows", over);
      if (!over) return;
      // A sibling right after the block (not inside it: a button may not sit inside the block's own interactive element).
      const hint = document.createElement("button");
      hint.type = "button";
      hint.className = "block-fit-hint";
      hint.dataset.for = String(b.id);
      hint.textContent = "Fit ⤓";
      hint.title = "This block is shorter than its content. Make it tall enough.";
      hint.setAttribute("aria-label", `${blockLabel(b.type)} block is cut off: fit it to its content`);
      ["pointerdown", "mousedown", "click"].forEach((t) => hint.addEventListener(t, (e) => e.stopPropagation()));
      hint.addEventListener("click", () => fitBlock(b.id));
      const style = blockPixelStyle(b);
      // In the block's top-right corner, so the middle of even a short block stays clickable. A block too narrow for it just keeps
      // its dashed border and the Fit in the block bar's ⋯ menu.
      if (style.width < 110) return;
      hint.style.left = style.left + style.width - 58 + "px";
      hint.style.top = style.top + 3 + "px";
      div.after(hint);
    });
  }
  let canvasNoteTimer = null;
  function canvasNote(msg) {
    let note = el("canvas-note");
    if (!note) return;
    note.textContent = msg;
    note.hidden = !msg;
    clearTimeout(canvasNoteTimer);
    if (msg) canvasNoteTimer = setTimeout(() => ((note.hidden = true), (note.textContent = "")), 6000);
  }
  // Applies new sizes and positions in one go (one PATCH per changed block) and redraws.
  async function applyLayoutChanges(changes) {
    const jobs = [];
    for (const ch of changes) {
      const b = blocks.find((x) => x.id === ch.id);
      if (!b) continue;
      const patch = {};
      for (const k of ["col", "col_span", "row_span", "row"]) if (ch[k] !== undefined && ch[k] !== b[k]) patch[k] = ch[k];
      if (!Object.keys(patch).length) continue;
      jobs.push({ b, patch });
    }
    if (!jobs.length) return 0;
    await Promise.all(jobs.map(({ b, patch }) => api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify(patch) })));
    jobs.forEach(({ b, patch }) => Object.assign(b, patch));
    renderCanvas();
    return jobs.length;
  }
  // mode: "content" (keep the width, fit the height), "actual" (a picture at its own pixel size, as wide as the space beside it allows).
  async function fitBlock(id, mode = "content") {
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    if (isLayoutLocked(b)) return canvasNote("Unlock this block before changing its size.");
    if (!FIT_TYPES.has(b.type)) return canvasNote(`A ${blockLabel(b.type)} block has no content size of its own: resize it by hand.`);
    const { colW } = canvasMetrics();
    let colSpan = b.col_span;
    if (b.type === "image") {
      if (!b.content || !b.content.url) return canvasNote("Choose a picture first.");
      const d = await loadImageDims(b.content.url);
      if (!d) return canvasNote("That picture could not be measured.");
      if (mode === "actual") colSpan = BlockFit.maxSpanBeside(blocks, b, BlockFit.colsForWidth(d.w, colW));
    }
    const h = measureBlockPx({ ...b, col_span: colSpan }, BlockFit.widthForCols(colSpan, colW));
    if (h === null) return canvasNote("Could not work out this block's size.");
    const rows = BlockFit.rowsForHeight(h);
    const next = blocks.map((x) => (x.id === b.id ? { ...x, col_span: colSpan, row_span: rows } : x));
    const settle = BlockFit.settleDown(next, isLayoutLocked);
    if (settle.blockedBy !== null) return canvasNote("A locked block is in the way. Unlock or move it first.");
    try {
      const changed = await applyLayoutChanges([{ id: b.id, col_span: colSpan, row_span: rows }, ...settle.moves]);
      const moved = settle.moves.length;
      const picture = b.type === "image" && mode === "actual" ? ` Shown at ${Math.round(BlockFit.shownScale(BlockFit.widthForCols(colSpan, colW), imageDims.get(b.content.url).w) * 100)}% of the picture's own size.` : "";
      canvasNote(changed ? `Fitted to its content${moved ? `; ${moved} block${moved === 1 ? "" : "s"} below moved down` : ""}.${picture}` : `Already fits its content.${picture}`);
    } catch (err) {
      canvasNote(err.message || "Could not resize the block.");
    }
  }
  async function fitAllBlocks() {
    if (!currentPage) return;
    const targets = blocks.filter((b) => FIT_TYPES.has(b.type) && !isLayoutLocked(b) && !(b.style && b.style.hidden));
    await Promise.all(targets.filter((b) => b.type === "image" && b.content && b.content.url).map((b) => loadImageDims(b.content.url)));
    const { colW } = canvasMetrics();
    const sizes = new Map();
    for (const b of targets) {
      const h = measureBlockPx(b, BlockFit.widthForCols(b.col_span, colW));
      if (h !== null) sizes.set(b.id, BlockFit.rowsForHeight(h));
    }
    const next = blocks.map((x) => (sizes.has(x.id) ? { ...x, row_span: sizes.get(x.id) } : x));
    const settle = BlockFit.settleDown(next, isLayoutLocked);
    if (settle.blockedBy !== null) return canvasNote("A locked block is in the way. Unlock or move it first.");
    try {
      const changes = [...sizes].map(([id, row_span]) => ({ id, row_span })).concat(settle.moves);
      const merged = new Map();
      changes.forEach((c) => merged.set(c.id, { ...(merged.get(c.id) || {}), ...c }));
      const n = await applyLayoutChanges([...merged.values()]);
      canvasNote(n ? `Fitted ${n} block${n === 1 ? "" : "s"} to their content.` : "Every block already fits its content.");
    } catch (err) {
      canvasNote(err.message || "Could not resize the blocks.");
    }
  }

  // ---------- Quick edit ----------
  // The toolbar's Edit button (or a double-click on a block) opens a small panel beside the block with its main fields, so a heading,
  // paragraph, picture or button can be changed without going to the Inspector. It uses the Inspector's own field definitions and the
  // same save, so both always agree. The panel lives outside the canvas, which is redrawn after every save.
  let quickEditId = null;
  const QUICK_FIELD_TYPES = new Set(["text", "textarea", "select", "image-url", "checkbox"]);
  const QUICK_FIELD_LIMIT = 4;
  function quickFieldsFor(type) {
    return (FIELD_DEFS[type] || []).filter((f) => QUICK_FIELD_TYPES.has(f.type)).slice(0, QUICK_FIELD_LIMIT);
  }
  function quickEditEl() {
    let box = el("quick-edit");
    if (box) return box;
    box = document.createElement("div");
    box.id = "quick-edit";
    box.className = "quick-edit";
    box.setAttribute("role", "dialog");
    box.setAttribute("aria-modal", "false");
    box.hidden = true;
    box.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeQuickEdit(true);
      }
    });
    // Presses inside the panel must not start a drag or clear the selection underneath.
    ["pointerdown", "mousedown"].forEach((t) => box.addEventListener(t, (e) => e.stopPropagation()));
    canvas.parentNode.appendChild(box);
    return box;
  }
  function closeQuickEdit(returnFocus) {
    const box = el("quick-edit");
    const id = quickEditId;
    quickEditId = null;
    if (box) {
      box.hidden = true;
      box.innerHTML = "";
    }
    if (returnFocus && id !== null) {
      const target = document.querySelector('#block-bar:not([hidden]) [data-action="edit"]') || canvas.querySelector(`.admin-block[data-id="${id}"]`);
      if (target) target.focus();
    }
  }
  function positionQuickEdit() {
    const box = el("quick-edit");
    if (!box || box.hidden || quickEditId === null) return;
    const b = blocks.find((x) => x.id === quickEditId);
    if (!b) return closeQuickEdit(false);
    const style = blockPixelStyle(b);
    const w = box.offsetWidth;
    const cLeft = canvas.offsetLeft;
    const cTop = canvas.offsetTop;
    const rightSide = style.left + style.width + 12;
    const leftSide = style.left - 12 - w;
    let left;
    let top;
    if (rightSide + w <= canvas.clientWidth) {
      left = rightSide;
      top = style.top;
    } else if (leftSide >= 0) {
      left = leftSide;
      top = style.top;
    } else {
      // No room at either side: under the block.
      left = Math.max(0, Math.min(style.left, canvas.clientWidth - w));
      top = style.top + style.height + 8;
    }
    box.style.left = cLeft + left + "px";
    box.style.top = cTop + top + "px";
    // Never under the floating block bar: an editor on screen that runs into it is lifted so Done stays reachable.
    const bar = el("block-bar");
    const r = box.getBoundingClientRect();
    if (bar && !bar.hidden && bar.getClientRects().length && r.top >= 0 && r.top < innerHeight) {
      const over = r.bottom - (bar.getBoundingClientRect().top - 8);
      if (over > 0) box.style.top = Math.max(cTop, cTop + top - over) + "px";
    }
  }
  function syncQuickEdit() {
    if (quickEditId === null) return;
    if (isMobile() || selectedBlockId !== quickEditId || multiSelectedIds.size > 0 || !blocks.some((x) => x.id === quickEditId)) return closeQuickEdit(false);
    positionQuickEdit();
  }
  function openQuickEdit(id) {
    if (isMobile()) return;
    const b = blocks.find((x) => x.id === id);
    if (!b) return;
    if (selectedBlockId !== id) {
      selectedBlockId = id;
      multiSelectedIds.clear();
      renderCanvas();
      renderInspector();
    }
    const fields = quickFieldsFor(b.type);
    const box = quickEditEl();
    quickEditId = id;
    const idPrefix = `qe-${id}`;
    const titleId = `quick-edit-title-${id}`;
    box.setAttribute("aria-labelledby", titleId);
    const fieldsHtml = fields
      .map((f) => fieldHtml(f.type === "textarea" && f.key === "text" ? { ...f, label: "Text" } : f, b.content[f.key], idPrefix))
      .join("");
    box.innerHTML = `<div class="quick-edit-head"><strong id="${titleId}">Edit ${escapeHtml(blockLabel(b.type))}</strong><button type="button" class="quick-edit-close" aria-label="Close quick edit">×</button></div>
      <div class="quick-edit-fields">${fieldsHtml || `<p class="quick-edit-none">${escapeHtml(blockLabel(b.type))} has no quick fields. Use the Inspector for its settings.</p>`}</div>
      <div class="quick-edit-actions">${FIT_TYPES.has(b.type) ? '<button type="button" class="quick-edit-fit">Fit to content</button>' : ""}<button type="button" class="quick-edit-more">More settings</button><button type="button" class="quick-edit-done">Done</button></div>
      <div class="quick-edit-status" role="status" aria-live="polite"></div>`;
    box.hidden = false;
    const fieldsBox = box.querySelector(".quick-edit-fields");
    fieldsBox.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
    fieldsBox.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
    fieldsBox.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);
    const status = box.querySelector(".quick-edit-status");
    fieldsBox.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      // While typing, only the block's own preview is redrawn (no save); the change is saved when the field is left.
      input.addEventListener("input", () => {
        if (input.type === "checkbox" || input.tagName === "SELECT") return;
        b.content[input.dataset.key] = fieldValue(input);
        const pv = canvas.querySelector(`.admin-block[data-id="${b.id}"] .block-preview`);
        if (pv) pv.innerHTML = blockPreview(b);
        scheduleOverflowMarks();
        status.textContent = "Unsaved";
      });
      input.addEventListener("change", async () => {
        b.content[input.dataset.key] = fieldValue(input);
        status.textContent = "Saving…";
        await saveBlockStyleAndContent(b);
        renderInspector();
        status.textContent = "Saved";
        positionQuickEdit();
      });
    });
    box.querySelector(".quick-edit-close").addEventListener("click", () => closeQuickEdit(true));
    box.querySelector(".quick-edit-done").addEventListener("click", () => closeQuickEdit(true));
    const fit = box.querySelector(".quick-edit-fit");
    if (fit) fit.addEventListener("click", () => fitBlock(b.id, "content"));
    box.querySelector(".quick-edit-more").addEventListener("click", () => showInspectorPanel());
    positionQuickEdit();
    const first = fieldsBox.querySelector("input:not([type=checkbox]), textarea, select") || box.querySelector(".quick-edit-done");
    if (first) first.focus();
    box.scrollIntoView({ block: "nearest", inline: "nearest" });
    positionQuickEdit();
  }

  el("fit-all-blocks-btn").addEventListener("click", fitAllBlocks);

  function blockLabel(type) {
    return { heading: "Heading", text: "Text", image: "Image", button: "Button", quote: "Quote", gallery: "Gallery", divider: "Divider", spacer: "Spacer", study: "Study" }[type] || type;
  }

  // A miniature of how the block reads on the live site (same content, scaled-down styling). Every
  // value is escaped; the wrapper classes (.pv-*) carry the look, so the text stays plain and testable.
  function blockPreview(b) {
    const c = b.content || {};
    const imgs = (urls) => urls.filter(Boolean).slice(0, 4).map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy">`).join("");
    switch (b.type) {
      case "heading": return `<strong class="pv-heading" data-level="${effectiveHeadingLevel(c)}">${escapeHtml(c.text || "(empty)")}</strong>`;
      case "text": return `<span class="pv-text">${escapeHtml((c.text || "").slice(0, 3000) || "(empty)")}</span>`;
      case "image":
        return c.url
          ? `<img class="pv-image" src="${escapeHtml(c.url)}" alt=""${imageSizeAttrs(c.url)}>${
              c.alt ? "" : `<span class="alt-text-warning" title="No alt text set — add one for accessibility and SEO">No alt text</span>`
            }`
          : "(no image url)";
      case "button": return `<span class="pv-button">Button: ${escapeHtml(c.label || "(no label)")}</span>`;
      // STUDY (temporary): never show the password here.
      case "study": return `<span class="pv-button">Study: ${escapeHtml(c.label || "Open study")} (locked)</span>`;
      case "quote": return c.text ? `<span class="pv-quote">“${escapeHtml(c.text.slice(0, 600))}”</span>` : "(empty)";
      case "gallery": return `<span class="pv-gallery">${imgs((c.images || []).map((i) => (typeof i === "string" ? i : i && i.url)))}</span>${(c.images || []).length} image(s)`;
      case "divider": return `<hr class="pv-divider">`;
      case "spacer": return `<span class="pv-spacer">(spacer)</span>`;
      default: return "";
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    // textContent->innerHTML escapes <, >, & for text-node safety, but
    // this is also used inside HTML attribute values (e.g. title="…")
    // throughout this file, so quotes need escaping too or a value
    // containing one can break out of the attribute.
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  function blockBadgesHtml(b) {
    const visibility = b.style && b.style.visibility;
    return `${groupOf(b) && blocks.filter((x) => groupOf(x) === groupOf(b)).length > 1 ? ` <span class="lock-badge" title="Part of a group: grouped blocks drag together">Group</span>` : ""}${
      b.locked ? ` <span class="lock-badge" title="Locked — protected from accidental drag/resize/delete">Locked</span>` : ""
    }${
      visibility === "desktop-only" ? ` <span class="lock-badge" title="Hidden on mobile — desktop only">Desktop only</span>` : ""
    }${
      visibility === "mobile-only" ? ` <span class="lock-badge" title="Hidden on desktop — mobile only">Mobile only</span>` : ""
    }${b.style && b.style.hidden ? ` <span class="lock-badge" title="Hidden from the live site entirely">Hidden</span>` : ""}`;
  }

  // ---------- Block groups ----------
  // A group is just a shared style.group id on several blocks (no schema change; the public renderer ignores it).
  // Grouped blocks drag together and show a dashed outline.
  const groupOf = (b) => (b && b.style && typeof b.style.group === "string" && b.style.group) || null;
  function groupMatesOf(block) {
    const g = groupOf(block);
    if (!g) return [];
    const mates = blocks.filter((x) => x.id !== block.id && groupOf(x) === g);
    return mates.some((m) => isLayoutLocked(m)) || isLayoutLocked(block) ? [] : mates;
  }
  function renderGroupOutlines() {
    canvas.querySelectorAll(".group-outline").forEach((n) => n.remove());
    const groups = new Map();
    blocks.forEach((b) => {
      const g = groupOf(b);
      if (g) groups.set(g, [...(groups.get(g) || []), b]);
    });
    groups.forEach((members) => {
      if (members.length < 2) return;
      const rects = members.map(blockPixelStyle);
      const left = Math.min(...rects.map((r) => r.left)) - 4;
      const top = Math.min(...rects.map((r) => r.top)) - 4;
      const right = Math.max(...rects.map((r) => r.left + r.width)) + 4;
      const bottom = Math.max(...rects.map((r) => r.top + r.height)) + 4;
      const box = document.createElement("div");
      box.className = "group-outline";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
      canvas.insertBefore(box, canvas.firstChild);
    });
  }
  async function setBlocksGroup(list, group) {
    for (const b of list) {
      const style = { ...(b.style || {}) };
      if (group) style.group = group;
      else delete style.group;
      await api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ style }) });
      b.style = style;
    }
  }
  const styleWithoutGroup = (style) => {
    const out = { ...(style || {}) };
    delete out.group;
    return out;
  };
  const newGroupId = () => "g" + Math.random().toString(36).slice(2, 10);

  function renderCanvas() {
    if (isMobile()) renderCanvasMobile();
    else renderCanvasDesktop();
  }

  function renderCanvasDesktop() {
    canvas.classList.remove("admin-canvas-mobile-stack");
    canvas.innerHTML = "";
    let maxBottom = 600;
    for (const b of blocks) {
      const style = blockPixelStyle(b);
      maxBottom = Math.max(maxBottom, style.top + style.height + 100);
      const div = document.createElement("div");
      div.className =
        "admin-block" +
        (b.id === selectedBlockId || multiSelectedIds.has(b.id) ? " selected" : "") +
        (b.style && b.style.hidden ? " block-is-hidden" : "") +
        (b.locked ? " block-locked" : "");
      div.style.left = style.left + "px";
      div.style.top = style.top + "px";
      div.style.width = style.width + "px";
      div.style.height = style.height + "px";
      div.dataset.id = b.id;
      div.innerHTML = `<div class="block-type-label"><span class="block-type-name">${blockLabel(b.type)}</span>${blockBadgesHtml(
        b
      )}</div><div class="block-preview">${blockPreview(b)}</div><div class="resize-handle"></div>`;
      // Short blocks drop the type name (kept as a tooltip) so the miniature gets the room.
      if (style.height < 80) {
        div.classList.add("admin-block-compact");
        if (style.height < 34) div.classList.add("admin-block-xs");
        div.title = blockLabel(b.type);
      }
      canvas.appendChild(div);
      wireBlockInteractions(div, b);
    }
    canvas.style.minHeight = maxBottom + "px";
    renderGroupOutlines();
    renderCanvasToolbar();
    scheduleOverflowMarks();
    syncQuickEdit();
  }

  // ---------- The block bar ----------
  // The selected block's controls, as a pill bar floating at the bottom of the editor (the owner's sketch: a + button, a chip for each
  // thing the block has set with a × to clear it, a dropdown pill for the block's main choice, and a round accent button to finish).
  // The type chip opens the quick editor, the size chip the width and position choices, a style chip that one setting. Everything in
  // the ⋯ menu presses the inspector's own buttons, so lock checks, confirmations and saving stay in one place. What it shows is worked
  // out by block-bar-model.js. The popovers (`#bb-pop`) live outside the bar, which is rebuilt after every save.
  const BB = window.BlockBarModel;
  const SIZE_PRESETS = [["¼", 6, "a quarter"], ["⅓", 8, "a third"], ["½", 12, "half"], ["⅔", 16, "two thirds"], ["Full", 24, "the full width"]];
  const BB_ICON = {
    plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
    x: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 8l8 8M16 8l-8 8"/></svg>',
    down: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    more: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="6" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="18" cy="12" r="1.6"/></svg>',
    done: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
    size: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h16M7 9l-3 3 3 3M17 9l3 3-3 3"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6" y="11" width="12" height="9" rx="2"/><path d="M9 11V8a3 3 0 0 1 6 0v3"/></svg>',
  };
  let bbPopFor = null; // what the open popover is for: "add", "size", "choice", "more" or "style:<key>"
  let toolbarFocusAction = null; // the data-action of the bar button to focus after the redraw
  function blockBarEl() {
    let bar = el("block-bar");
    if (bar) return bar;
    bar = document.createElement("div");
    bar.id = "block-bar";
    bar.className = "block-bar";
    bar.setAttribute("role", "toolbar");
    bar.hidden = true;
    // Presses on the bar must not start a drag or clear the selection underneath.
    ["pointerdown", "mousedown"].forEach((t) => bar.addEventListener(t, (e) => e.stopPropagation()));
    bar.addEventListener("click", onBlockBarClick);
    canvas.parentNode.appendChild(bar);
    return bar;
  }
  function bbPopEl() {
    let pop = el("bb-pop");
    if (pop) return pop;
    pop = document.createElement("div");
    pop.id = "bb-pop";
    pop.className = "bb-pop";
    pop.hidden = true;
    ["pointerdown", "mousedown"].forEach((t) => pop.addEventListener(t, (e) => e.stopPropagation()));
    pop.addEventListener("keydown", (e) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      closeBbPop(true);
    });
    canvas.parentNode.appendChild(pop);
    return pop;
  }
  function closeBbPop(returnFocus) {
    const pop = el("bb-pop");
    const was = bbPopFor;
    bbPopFor = null;
    if (pop) {
      pop.hidden = true;
      pop.innerHTML = "";
    }
    const bar = el("block-bar");
    if (bar) bar.querySelectorAll("[aria-expanded]").forEach((b) => b.setAttribute("aria-expanded", "false"));
    if (returnFocus && was && bar && !bar.hidden) {
      const opener = bbOpener(was);
      (opener || bar.querySelector("button")).focus();
    }
  }
  function bbOpener(what) {
    const bar = el("block-bar");
    if (!bar) return null;
    if (what.startsWith("style:")) return bar.querySelector(`[data-action="style"][data-key="${what.slice(6)}"]`);
    return bar.querySelector(`[data-action="${what}"]`);
  }
  // The popover sits above its button, inside the window.
  function placeBbPop() {
    const pop = el("bb-pop");
    if (!pop || pop.hidden || !bbPopFor) return;
    const opener = bbOpener(bbPopFor) || el("block-bar");
    const r = opener.getBoundingClientRect();
    const w = pop.offsetWidth;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - w - 8));
    pop.style.left = left + "px";
    pop.style.bottom = Math.max(8, window.innerHeight - r.top + 8) + "px";
  }
  function openBbPop(what, html, wire) {
    const pop = bbPopEl();
    bbPopFor = what;
    // A fresh inner box each time: listeners go on it, so they go away with it (on the popover itself they would pile up).
    pop.innerHTML = `<div class="bb-pop-inner">${html}</div>`;
    pop.hidden = false;
    const opener = bbOpener(what);
    if (opener) opener.setAttribute("aria-expanded", "true");
    if (wire) wire(pop.firstElementChild);
    placeBbPop();
    const first = pop.querySelector("input:not([type=hidden]), select, textarea, button");
    if (first) first.focus();
  }
  function hideCanvasToolbar() {
    canvas.querySelectorAll(".block-fit-hint").forEach((n) => (n.hidden = true));
    const bar = el("block-bar");
    if (bar) bar.classList.add("is-resting");
  }
  function showInspectorPanel() {
    if (window.AdminPanels && window.AdminPanels.show) window.AdminPanels.show("inspector");
    const inspector = el("inspector");
    inspector.hidden = false;
    if (isMobile()) openDrawer(inspector);
    const first = el("inspector-fields").querySelector("input, textarea, select");
    if (first) first.focus();
  }
  async function applySize(id, want, align) {
    const b = blocks.find((x) => x.id === id);
    if (!b || isLayoutLocked(b)) return;
    let span = want == null ? b.col_span : Math.max(1, Math.min(BlockFit.COLS, want));
    let col = b.col;
    if (want != null && !align) {
      // A new width keeps the block where it is when it can, grows right then left, and stops short of its neighbours.
      const fit = BlockFit.fitWidth(blocks, b, span);
      if (fit.span !== span && fit.span === b.col_span && fit.col === b.col) return canvasNote(span > b.col_span ? "Something is beside this block, so it cannot be any wider." : "Already like that.");
      col = fit.col;
      span = fit.span;
    } else {
      if (align === "left") col = 1;
      else if (align === "center") col = Math.floor((BlockFit.COLS - span) / 2) + 1;
      else if (align === "right") col = BlockFit.COLS - span + 1;
      col = Math.max(1, Math.min(col, BlockFit.COLS - span + 1));
    }
    if (blocks.some((o) => o.id !== b.id && BlockFit.overlaps({ ...b, col, col_span: span }, o))) return canvasNote("Another block is in the way.");
    const changed = await applyLayoutChanges([{ id: b.id, col, col_span: span }]);
    canvasNote(changed ? "" : "Already like that.");
  }
  function bbSelected() {
    return selectedBlockId === null ? null : blocks.find((x) => x.id === selectedBlockId) || null;
  }
  function bbChip(action, label, text, opts = {}) {
    const key = opts.key ? ` data-key="${escapeHtml(opts.key)}"` : "";
    const swatch = opts.swatch ? `<i class="bb-swatch" style="background:${escapeHtml(opts.swatch)}"></i>` : "";
    const icon = opts.icon || "";
    const clear = opts.clear
      ? `<button type="button" class="bb-x" data-clear="${escapeHtml(opts.clear)}" aria-label="${escapeHtml(opts.clearLabel || "Remove " + text)}" title="${escapeHtml(opts.clearLabel || "Remove")}"${opts.clearDisabled ? " disabled" : ""}>${BB_ICON.x}</button>`
      : "";
    return `<span class="bb-chip${opts.cls ? " " + opts.cls : ""}"><button type="button" class="bb-chip-main" data-action="${action}"${key} aria-label="${escapeHtml(label)}" aria-haspopup="${opts.dialog ? "dialog" : "true"}" aria-expanded="false"${opts.disabled ? " disabled" : ""}>${icon}${swatch}<span>${escapeHtml(text)}</span></button>${clear}</span>`;
  }
  function renderCanvasToolbar() {
    const b = bbSelected();
    const bar = blockBarEl();
    if (multiSelectedIds.size > 1 || !b) {
      bar.hidden = true;
      closeBbPop(false);
      return;
    }
    const typeIcon = (document.querySelector(`.palette-btn[data-type="${b.type}"] svg`) || {}).outerHTML || "";
    const style = b.style || {};
    const chips = [
      bbChip("edit", `Edit this ${blockLabel(b.type).toLowerCase()}'s text and main fields`, blockLabel(b.type), { icon: typeIcon, cls: "bb-type", dialog: true }),
      bbChip("size", "Width and position: " + BB.sizeLabel(b.col_span), BB.sizeLabel(b.col_span) === "Full" ? "Full width" : BB.sizeLabel(b.col_span) + " width", {
        icon: BB_ICON.size,
        disabled: isLayoutLocked(b),
        clear: b.col_span !== 24 && !isLayoutLocked(b) ? "size" : "",
        clearLabel: "Back to the full width",
      }),
    ];
    if (b.locked) chips.push(bbChip("unlock", "Locked: press to unlock", "Locked", { icon: BB_ICON.lock, cls: "bb-locked", clear: "lock", clearLabel: "Unlock this block" }));
    BB.chipsFor(style, STYLE_FIELDS).forEach((c) => chips.push(bbChip("style", `${c.text}: change it`, c.text, { key: c.key, swatch: c.swatch, clear: c.key, clearLabel: `Remove ${c.text}` })));
    const choice = BB.mainChoice(FIELD_DEFS[b.type], b.content);
    bar.setAttribute("aria-label", `${blockLabel(b.type)} block`);
    bar.innerHTML = `<div class="bb-row bb-row-chips">
        <button type="button" class="bb-round bb-add" data-action="add" aria-label="Add a setting" title="Add a setting" aria-haspopup="true" aria-expanded="false">${BB_ICON.plus}</button>
        <div class="bb-chips">${chips.join("")}</div>
      </div>
      <div class="bb-row bb-row-main">
        ${choice ? `<button type="button" class="bb-pill bb-choice" data-action="choice" aria-label="${escapeHtml(choice.label)}: ${escapeHtml(choice.text)}" aria-haspopup="true" aria-expanded="false"><span>${escapeHtml(choice.text)}</span>${BB_ICON.down}</button>` : ""}
        <button type="button" class="bb-round bb-more" data-action="more" aria-label="More: copy, duplicate, lock, fit, delete" title="More" aria-haspopup="true" aria-expanded="false">${BB_ICON.more}</button>
        <button type="button" class="bb-round bb-done" data-action="done" aria-label="Done with this block" title="Done">${BB_ICON.done}</button>
      </div>`;
    bar.hidden = false;
    bar.classList.remove("is-resting");
    placeBlockBar();
    scheduleOverflowMarks();
    // A popover that was open stays open over the rebuilt bar (it is about the same block), unless its chip has gone.
    if (bbPopFor) {
      if (bbPopFor.startsWith("style:") && !BB.isSet(style[bbPopFor.slice(6)]) && !el("bb-pop").querySelector("[data-adding]")) closeBbPop(false);
      else {
        const opener = bbOpener(bbPopFor);
        if (opener) opener.setAttribute("aria-expanded", "true");
        placeBbPop();
      }
    }
    if (toolbarFocusAction !== null) {
      const target = bar.querySelector(`button[data-action="${toolbarFocusAction}"]`);
      toolbarFocusAction = null;
      if (target && !target.disabled) target.focus();
    }
  }
  // The bar floats centred over the editor's middle column, at the bottom of the window.
  function placeBlockBar() {
    const bar = el("block-bar");
    if (!bar || bar.hidden) return;
    const wrap = canvas.parentNode.getBoundingClientRect();
    bar.style.left = wrap.left + wrap.width / 2 + "px";
    bar.style.maxWidth = Math.max(280, wrap.width - 24) + "px";
  }
  window.addEventListener("resize", () => {
    placeBlockBar();
    placeBbPop();
  });
  if (typeof ResizeObserver === "function") new ResizeObserver(() => placeBlockBar()).observe(canvas.parentNode);
  document.addEventListener("pointerdown", (e) => {
    if (!bbPopFor) return;
    if (e.target.closest("#bb-pop, #block-bar")) return;
    closeBbPop(false);
  });
  async function bbSaveStyle(b, changes) {
    b.style = { ...(b.style || {}) };
    Object.keys(changes).forEach((k) => {
      if (changes[k] === null || changes[k] === undefined || changes[k] === "" || changes[k] === false) delete b.style[k];
      else b.style[k] = changes[k];
    });
    await saveBlockStyleAndContent(b);
    renderInspector();
  }
  function onBlockBarClick(e) {
    e.stopPropagation();
    const b = bbSelected();
    if (!b) return;
    const clear = e.target.closest("[data-clear]");
    if (clear) {
      const what = clear.dataset.clear;
      closeBbPop(false);
      if (what === "size") return applySize(b.id, 24, null);
      if (what === "lock") {
        toolbarFocusAction = "add";
        return el("lock-block-btn").click();
      }
      toolbarFocusAction = "add";
      const changes = {};
      BB.keysOf(what).forEach((k) => (changes[k] = null));
      return bbSaveStyle(b, changes);
    }
    const btn = e.target.closest("button[data-action]");
    if (!btn) return;
    const action = btn.dataset.action;
    const what = action === "style" ? "style:" + btn.dataset.key : action;
    if (bbPopFor === what) return closeBbPop(true);
    closeBbPop(false);
    if (action === "done") {
      closeQuickEdit(false);
      selectedBlockId = null;
      multiSelectedIds.clear();
      renderCanvas();
      renderInspector();
      return;
    }
    if (action === "edit") return isMobile() ? showInspectorPanel() : openQuickEdit(b.id); // a phone has no room beside the block
    if (action === "unlock") {
      toolbarFocusAction = "add";
      return el("lock-block-btn").click();
    }
    if (action === "size") return openSizePop(b);
    if (action === "choice") return openChoicePop(b);
    if (action === "more") return openMorePop(b);
    if (action === "add") return openAddPop(b);
    if (action === "style") return openStylePop(b, btn.dataset.key, false);
  }
  function openSizePop(b) {
    const cur = b.col_span;
    openBbPop(
      "size",
      `<div class="size-menu bb-menu" role="group" aria-label="Block width and position">
        <p class="bb-pop-title">Width</p>
        <div class="size-menu-row" role="group" aria-label="Width">${SIZE_PRESETS.map(([label, span, word]) => `<button type="button" data-span="${span}" aria-label="${word}" aria-pressed="${cur === span}">${label}</button>`).join("")}</div>
        <p class="bb-pop-title">Position</p>
        <div class="size-menu-row" role="group" aria-label="Position"><button type="button" data-align="left" aria-label="Align left">Left</button><button type="button" data-align="center" aria-label="Centre">Centre</button><button type="button" data-align="right" aria-label="Align right">Right</button></div>
      </div>`,
      (pop) =>
        pop.addEventListener("click", (e) => {
          const t = e.target.closest("button");
          if (!t) return;
          toolbarFocusAction = "size";
          closeBbPop(false);
          if (t.dataset.span) applySize(b.id, Number(t.dataset.span), null);
          else if (t.dataset.align) applySize(b.id, null, t.dataset.align);
        })
    );
  }
  function openChoicePop(b) {
    const choice = BB.mainChoice(FIELD_DEFS[b.type], b.content);
    if (!choice) return;
    openBbPop(
      "choice",
      `<div class="bb-menu" role="menu" aria-label="${escapeHtml(choice.label)}"><p class="bb-pop-title">${escapeHtml(choice.label)}</p>${choice.options
        .map((o) => `<button type="button" role="menuitemradio" aria-checked="${o.value === choice.value}" data-value="${escapeHtml(o.value)}">${escapeHtml(o.text)}</button>`)
        .join("")}</div>`,
      (pop) =>
        pop.addEventListener("click", async (e) => {
          const t = e.target.closest("button[data-value]");
          if (!t) return;
          const f = FIELD_DEFS[b.type].find((x) => x.key === choice.key);
          const raw = t.dataset.value;
          b.content[choice.key] = f && f.numeric ? Number(raw) : typeof (f && f.options[0][0]) === "number" ? Number(raw) : raw;
          closeBbPop(false);
          toolbarFocusAction = "choice";
          await saveBlockStyleAndContent(b);
          renderInspector();
        })
    );
  }
  function openMorePop(b) {
    const locked = isLayoutLocked(b);
    const items = [
      ["copy-block-btn", "Copy", ""],
      ["duplicate-block-btn", "Duplicate", ""],
      ["lock-block-btn", b.locked ? "Unlock" : "Lock", ""],
      ["fit", "Fit to content", locked ? "disabled" : ""],
    ];
    if (b.type === "image") items.push(["actual", "Actual size", locked ? "disabled" : ""]);
    items.push(["settings", "All settings…", ""]);
    items.push(["delete-block-btn", "Delete", b.locked ? "disabled" : "", "bb-danger"]);
    openBbPop(
      "more",
      `<div class="bb-menu" role="menu" aria-label="${escapeHtml(blockLabel(b.type))} block actions">${items
        .map(([id, label, dis, cls]) => `<button type="button" role="menuitem" data-action="${id}"${cls ? ` class="${cls}"` : ""}${dis ? ' disabled title="Unlock this block first"' : ""}>${label}</button>`)
        .join("")}</div>`,
      (pop) =>
        pop.addEventListener("click", (e) => {
          const t = e.target.closest("button[data-action]");
          if (!t || t.disabled) return;
          const id = t.dataset.action;
          closeBbPop(false);
          if (id === "fit") return fitBlock(b.id, "content");
          if (id === "actual") return fitBlock(b.id, "actual");
          if (id === "settings") return showInspectorPanel();
          toolbarFocusAction = id === "delete-block-btn" ? null : "more";
          el(id).click();
        })
    );
  }
  function openAddPop(b) {
    const list = BB.addable(b.style, STYLE_FIELDS);
    openBbPop(
      "add",
      `<div class="bb-menu" role="menu" aria-label="Add a setting"><p class="bb-pop-title">Add to this block</p>${list
        .map((x) => `<button type="button" role="menuitem" data-key="${escapeHtml(x.key)}">${escapeHtml(x.text)}</button>`)
        .join("")}<button type="button" role="menuitem" data-key="" class="bb-menu-all">All settings…</button></div>`,
      (pop) =>
        pop.addEventListener("click", (e) => {
          const t = e.target.closest("button[data-key]");
          if (!t) return;
          if (!t.dataset.key) {
            closeBbPop(false);
            return showInspectorPanel();
          }
          openStylePop(b, t.dataset.key, true);
        })
    );
  }
  // One setting (and the ones that ride on it) in a small panel above its chip; a change is saved at once.
  function openStylePop(b, key, adding) {
    const keys = BB.keysOf(key);
    const fields = keys.map((k) => STYLE_FIELDS.find((f) => f.key === k)).filter(Boolean);
    const name = BB.SHORT[key] || (fields[0] && fields[0].label) || key;
    const style = b.style || {};
    openBbPop(
      adding ? "add" : "style:" + key,
      `<div class="bb-field" role="dialog" aria-label="${escapeHtml(name)}"${adding ? " data-adding" : ""}>
        <p class="bb-pop-title">${escapeHtml(name)}</p>
        <div class="bb-field-body">${fields.map((f) => fieldHtml(f, style[f.key], "bb-" + b.id)).join("")}</div>
        <div class="bb-field-actions">${BB.isSet(style[key]) ? '<button type="button" class="bb-field-clear">Remove</button>' : ""}<button type="button" class="bb-field-done">Done</button></div>
      </div>`,
      (pop) => {
        const body = pop.querySelector(".bb-field-body");
        body.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
        body.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
        body.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);
        body.querySelectorAll(".clear-color").forEach((btn) =>
          btn.addEventListener("click", () => {
            bbPopFor = "style:" + key;
            bbSaveStyle(b, { [btn.dataset.key]: null });
            closeBbPop(false);
          })
        );
        body.querySelectorAll("[data-key]:not(button)").forEach((input) =>
          input.addEventListener("change", async () => {
            bbPopFor = "style:" + key; // once it has a value it has a chip: the panel now belongs to that chip
            await bbSaveStyle(b, { [input.dataset.key]: fieldValue(input) });
            placeBbPop();
          })
        );
        const clear = pop.querySelector(".bb-field-clear");
        if (clear)
          clear.addEventListener("click", () => {
            const changes = {};
            keys.forEach((k) => (changes[k] = null));
            closeBbPop(false);
            toolbarFocusAction = "add";
            bbSaveStyle(b, changes);
          });
        pop.querySelector(".bb-field-done").addEventListener("click", () => closeBbPop(true));
      }
    );
  }

  // The absolute-position 24-column grid is a faithful desktop editing
  // surface, but at phone width a block's real column width shrinks to
  // the point that side-by-side blocks (a normal, correct desktop layout)
  // become too narrow to read or tap individually, and a fixed fixed-px
  // row height clips any content that needs more room at that width. On
  // mobile, edit as a plain full-width stacked list instead — same block
  // data, no col/row pixel math, with Up/Down buttons in place of 2D drag
  // (which doesn't map to a single column anyway). Desktop editing is
  // completely unaffected; this only changes how <=860px renders/behaves.
  function renderCanvasMobile() {
    closeQuickEdit(false);
    canvas.classList.add("admin-canvas-mobile-stack");
    canvas.innerHTML = "";
    canvas.style.minHeight = "";
    const sorted = [...blocks].sort((a, b) => a.row - b.row || a.col - b.col);
    sorted.forEach((b, i) => {
      const div = document.createElement("div");
      div.className =
        "admin-block admin-block-stacked" +
        (b.id === selectedBlockId ? " selected" : "") +
        (b.style && b.style.hidden ? " block-is-hidden" : "") +
        (b.locked ? " block-locked" : "");
      div.dataset.id = b.id;
      div.tabIndex = 0;
      // A group, not a button: it holds its own Move up / Move down buttons, and a button may not contain controls.
      div.setAttribute("role", "group");
      div.setAttribute("aria-label", `${blockLabel(b.type)} block`);
      div.innerHTML = `<div class="block-type-label">${blockLabel(b.type)}${blockBadgesHtml(b)}</div><div class="block-preview">${blockPreview(
        b
      )}</div><div class="stacked-block-controls"><button type="button" class="stacked-move-up" aria-label="Move up"${
        i === 0 ? " disabled" : ""
      }>↑</button><button type="button" class="stacked-move-down" aria-label="Move down"${i === sorted.length - 1 ? " disabled" : ""}>↓</button></div>`;
      const selectThisBlock = () => {
        selectedBlockId = b.id;
        multiSelectedIds.clear();
        renderCanvas();
        renderInspector(); // the block bar at the bottom shows up with the redraw; its ⋯ > All settings opens the inspector drawer
      };
      div.addEventListener("click", selectThisBlock);
      div.addEventListener("keydown", (e) => {
        if ((e.key !== "Enter" && e.key !== " ") || e.target !== div) return;
        e.preventDefault();
        selectThisBlock();
      });
      const moveUp = div.querySelector(".stacked-move-up");
      const moveDown = div.querySelector(".stacked-move-down");
      moveUp.addEventListener("click", (e) => {
        e.stopPropagation();
        if (i > 0) swapStackedBlocks(sorted[i], sorted[i - 1]);
      });
      moveDown.addEventListener("click", (e) => {
        e.stopPropagation();
        if (i < sorted.length - 1) swapStackedBlocks(sorted[i], sorted[i + 1]);
      });
      canvas.appendChild(div);
    });
    renderCanvasToolbar();
  }

  async function swapStackedBlocks(a, b) {
    if (isLayoutLocked(a) || isLayoutLocked(b)) return;
    const dir = b.row < a.row || (b.row === a.row && b.col < a.col) ? -1 : 1;
    const changes = BlockFit.swapOrder(blocks, a.id, b.id, isLayoutLocked);
    if (!changes) return canvasNote("A locked block is in the way.");
    await applyLayoutChanges(changes);
    // The moved block's own arrow keeps the focus, so it can be moved again straight away.
    const card = canvas.querySelector(`.admin-block-stacked[data-id="${a.id}"]`);
    const again = card && (card.querySelector(dir < 0 ? ".stacked-move-up" : ".stacked-move-down") || card);
    if (again) again.focus();
  }

  function rectsOverlap(a, b) {
    return a.col < b.col + b.col_span && a.col + a.col_span > b.col && a.row < b.row + b.row_span && a.row + a.row_span > b.row;
  }

  function wouldOverlap(block) {
    return blocks.some((b) => b.id !== block.id && rectsOverlap(block, b));
  }

  function flashRejected(div) {
    div.classList.add("overlap-warning");
    setTimeout(() => div.classList.remove("overlap-warning"), 800);
  }

  function clearSnapGuides() {
    canvas.querySelectorAll(".snap-guide").forEach((g) => g.remove());
  }

  // Figma-style alignment guides: while dragging/resizing, highlight when
  // this block's edge or center lines up with another block's — the grid
  // already quantizes movement to whole columns/rows, so an aligned pair
  // lands on the exact same pixel value, no fuzzy tolerance needed beyond
  // float rounding noise.
  function updateSnapGuides(block) {
    clearSnapGuides();
    const style = blockPixelStyle(block);
    const bLeft = style.left;
    const bRight = style.left + style.width;
    const bCenterX = style.left + style.width / 2;
    const bTop = style.top;
    const bBottom = style.top + style.height;
    const bCenterY = style.top + style.height / 2;
    const TOL = 0.5;
    let vx = null;
    let hy = null;
    for (const o of blocks) {
      if (o.id === block.id) continue;
      const os = blockPixelStyle(o);
      const oLeft = os.left;
      const oRight = os.left + os.width;
      const oCenterX = os.left + os.width / 2;
      const oTop = os.top;
      const oBottom = os.top + os.height;
      const oCenterY = os.top + os.height / 2;
      if (vx === null) {
        if (Math.abs(bLeft - oLeft) < TOL) vx = oLeft;
        else if (Math.abs(bRight - oRight) < TOL) vx = oRight;
        else if (Math.abs(bCenterX - oCenterX) < TOL) vx = oCenterX;
      }
      if (hy === null) {
        if (Math.abs(bTop - oTop) < TOL) hy = oTop;
        else if (Math.abs(bBottom - oBottom) < TOL) hy = oBottom;
        else if (Math.abs(bCenterY - oCenterY) < TOL) hy = oCenterY;
      }
    }
    if (vx !== null) {
      const line = document.createElement("div");
      line.className = "snap-guide snap-guide-v";
      line.style.left = vx + "px";
      canvas.appendChild(line);
    }
    if (hy !== null) {
      const line = document.createElement("div");
      line.className = "snap-guide snap-guide-h";
      line.style.top = hy + "px";
      canvas.appendChild(line);
    }
  }

  function wireBlockInteractions(div, block) {
    div.tabIndex = 0;
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", `${blockLabel(block.type)} block`);
    div.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== div) return;
      e.preventDefault();
      multiSelectedIds.clear();
      selectedBlockId = block.id;
      renderCanvas();
      renderInspector();
      // renderCanvas() rebuilds every block div from scratch, so the one
      // that just received Enter/Space no longer exists — refocus its
      // replacement or a keyboard user's Tab position silently resets to
      // the top of the canvas every time they select a block.
      canvas.querySelector(`.admin-block[data-id="${block.id}"]`)?.focus();
    });
    // Double-clicking a block opens the quick editor for it.
    div.addEventListener("dblclick", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      e.preventDefault();
      openQuickEdit(block.id);
    });
    div.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      if (e.shiftKey) {
        e.stopPropagation();
        // Shift-clicking while a single block is selected should carry that
        // one into the new multi-selection too, matching how shift-click
        // accumulates a selection everywhere else — otherwise the block you
        // clicked *before* holding shift would silently drop out.
        if (multiSelectedIds.size === 0 && selectedBlockId !== null && selectedBlockId !== block.id) {
          multiSelectedIds.add(selectedBlockId);
        }
        if (multiSelectedIds.has(block.id)) multiSelectedIds.delete(block.id);
        else multiSelectedIds.add(block.id);
        selectedBlockId = null;
        renderCanvas();
        renderInspector();
        return;
      }
      // A plain click always exits multi-select mode, even when it lands
      // on a block that was already part of the selection — dragging
      // several blocks together isn't supported, so keeping multi-select
      // "active" here would just be confusing.
      multiSelectedIds.clear();
      selectedBlockId = block.id;
      renderInspector();
      document.querySelectorAll(".admin-block").forEach((d) => d.classList.remove("selected"));
      div.classList.add("selected");
      renderCanvasToolbar();
      // Selection still works on a locked block (so its content/style stay
      // editable) — only the drag-to-move below is skipped, which is the
      // "accidental" change locking is meant to guard against.
      if (isLayoutLocked(block)) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const startCol = block.col;
      const startRow = block.row;
      const { colW, rowH, gap } = canvasMetrics();
      div.setPointerCapture(e.pointerId);

      // A block in a group drags with the rest of its group (unless one of them is locked, then it moves alone).
      const mates = groupMatesOf(block);
      const members = [block, ...mates];
      const starts = new Map(members.map((m) => [m.id, { col: m.col, row: m.row }]));
      const minDC = Math.max(...members.map((m) => 1 - starts.get(m.id).col));
      const maxDC = Math.min(...members.map((m) => COLS - m.col_span + 1 - starts.get(m.id).col));
      const minDR = Math.max(...members.map((m) => 1 - starts.get(m.id).row));
      const placeDiv = (m) => {
        const d = m === block ? div : canvas.querySelector(`.admin-block[data-id="${m.id}"]`);
        if (!d) return;
        const st = blockPixelStyle(m);
        d.style.left = st.left + "px";
        d.style.top = st.top + "px";
      };

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dC = Math.min(Math.max(Math.round(dx / (colW + gap)), minDC), maxDC);
        const dR = Math.max(Math.round(dy / (rowH + gap)), minDR);
        if (members.some((m) => m.col !== starts.get(m.id).col + dC || m.row !== starts.get(m.id).row + dR)) {
          members.forEach((m) => {
            m.col = starts.get(m.id).col + dC;
            m.row = starts.get(m.id).row + dR;
            placeDiv(m);
          });
          hideCanvasToolbar();
        }
        updateSnapGuides(block);
      }
      function onUp() {
        div.removeEventListener("pointermove", onMove);
        div.removeEventListener("pointerup", onUp);
        clearSnapGuides();
        // Put the toolbar back over wherever the block ended up (also after a snap-back).
        queueMicrotask(renderCanvasToolbar);
        const moved = members.filter((m) => m.col !== starts.get(m.id).col || m.row !== starts.get(m.id).row);
        // No overlaps allowed: if the drop spot collides with another
        // block, snap back to where the drag started instead of saving it.
        if (moved.length && moved.some((m) => wouldOverlap(m))) {
          members.forEach((m) => {
            m.col = starts.get(m.id).col;
            m.row = starts.get(m.id).row;
            placeDiv(m);
          });
          flashRejected(div);
          return;
        }
        // A plain click (select without moving) must not write: it bumped the block's
        // updated_at and could race a concurrent edit for nothing.
        if (!moved.length) return;
        Promise.all(
          moved.map((m) => api(`/blocks/${m.id}`, { method: "PATCH", body: JSON.stringify({ col: m.col, row: m.row }) }))
        )
          .then(() => (mates.length ? renderCanvas() : undefined))
          .catch((err) => alert(err.message));
      }
      div.addEventListener("pointermove", onMove);
      div.addEventListener("pointerup", onUp);
    });

    const handle = div.querySelector(".resize-handle");
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (isLayoutLocked(block)) return; // also hidden via CSS (.block-locked/.content-only-mode .resize-handle), this is belt-and-suspenders
      const startX = e.clientX;
      const startY = e.clientY;
      const startSpan = block.col_span;
      const startRowSpan = block.row_span;
      const { colW, rowH, gap } = canvasMetrics();
      handle.setPointerCapture(e.pointerId);
      const floorByWidth = new Map(); // columns -> the fewest rows that still show the content at that width

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCol = Math.round(dx / (colW + gap));
        const dRow = Math.round(dy / (rowH + gap));
        const newSpan = Math.min(Math.max(1, startSpan + dCol), COLS - block.col + 1);
        let newRowSpan = Math.max(1, startRowSpan + dRow);
        // A block cannot be made shorter than what it holds at that width (a heading, a paragraph, a picture).
        if (FIT_TYPES.has(block.type)) {
          if (!floorByWidth.has(newSpan)) floorByWidth.set(newSpan, minRowsFor(block, newSpan));
          const floor = floorByWidth.get(newSpan);
          if (floor && newRowSpan < floor) newRowSpan = floor;
        }
        if (newSpan !== block.col_span || newRowSpan !== block.row_span) {
          block.col_span = newSpan;
          block.row_span = newRowSpan;
          const style = blockPixelStyle(block);
          div.style.width = style.width + "px";
          div.style.height = style.height + "px";
          hideCanvasToolbar();
        }
        updateSnapGuides(block);
      }
      function onUp() {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        clearSnapGuides();
        queueMicrotask(renderCanvasToolbar);
        if ((block.col_span !== startSpan || block.row_span !== startRowSpan) && wouldOverlap(block)) {
          block.col_span = startSpan;
          block.row_span = startRowSpan;
          const style = blockPixelStyle(block);
          div.style.width = style.width + "px";
          div.style.height = style.height + "px";
          flashRejected(div);
          return;
        }
        if (block.col_span === startSpan && block.row_span === startRowSpan) return; // nothing changed: no write
        api(`/blocks/${block.id}`, {
          method: "PATCH",
          body: JSON.stringify({ col_span: block.col_span, row_span: block.row_span }),
        }).catch((err) => alert(err.message));
      }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  // The left panel used to be one long scroll: 22 full-width block
  // buttons, then every page setting and page action underneath. It's now
  // two tabs -- Blocks (a searchable icon grid) and Page (settings grouped
  // into collapsible sections) -- so neither buries the other.
  function switchLeftPanel(name) {
    ["blocks", "page"].forEach((n) => {
      const active = n === name;
      el(`panel-tab-${n}`).setAttribute("aria-selected", String(active));
      el(`palette-${n}`).hidden = !active;
    });
    try {
      localStorage.setItem("admin-left-panel", name);
    } catch (e) {}
  }
  el("panel-tab-blocks").addEventListener("click", () => switchLeftPanel("blocks"));
  el("panel-tab-page").addEventListener("click", () => switchLeftPanel("page"));
  try {
    if (localStorage.getItem("admin-left-panel") === "page") switchLeftPanel("page");
  } catch (e) {}

  el("palette-search").addEventListener("input", () => {
    const q = el("palette-search").value.trim().toLowerCase();
    let any = false;
    document.querySelectorAll(".palette-group").forEach((group) => {
      let groupHas = false;
      group.querySelectorAll(".palette-btn").forEach((btn) => {
        const match = !q || btn.textContent.toLowerCase().includes(q) || btn.dataset.type.includes(q);
        btn.hidden = !match;
        if (match) groupHas = true;
      });
      group.hidden = !groupHas;
      if (groupHas) any = true;
    });
    el("palette-no-match").hidden = any;
  });
  el("palette-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = document.querySelector(".palette-group:not([hidden]) .palette-btn:not([hidden])");
    if (first) first.click();
  });

  document.querySelectorAll(".palette-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!currentPage) return;
      const type = btn.dataset.type;
      const defaults = {
        heading: { content: { text: "New heading", level: 1 }, col_span: 24, row_span: 4 },
        text: { content: { text: "Write something here." }, col_span: 16, row_span: 6 },
        image: { content: { url: "", alt: "" }, col_span: 12, row_span: 12 },
        button: { content: { label: "Click me", url: "#", external: false }, col_span: 6, row_span: 2 },
        // STUDY (temporary): opens for anyone unless "Ask for a password" is ticked; a blank password then means the site's default (worker/study/index.js).
        study: { content: { label: "Open study", lab: "core1-lab", requirePassword: false, password: "" }, col_span: 8, row_span: 3 },
        quote: { content: { text: "Quote text here.", cite: "" }, col_span: 16, row_span: 6 },
        gallery: { content: { images: [] }, col_span: 24, row_span: 12 },
        divider: { content: {}, col_span: 24, row_span: 2 },
        spacer: { content: {}, col_span: 24, row_span: 2 },
      }[type] || { content: {}, col_span: 12, row_span: 4 };

      const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
      // Opened by a click on an empty spot of the page: the block goes right there, no wider than the room beside it. Otherwise it goes
      // at the bottom of the page, as it always did.
      const spot = pendingInsert && !isMobile() ? pendingInsert : null;
      let placed = { col: 1, row: maxRow, col_span: defaults.col_span };
      if (spot) {
        const col = Math.max(1, Math.min(BlockFit.COLS, spot.col));
        const want = Math.max(1, Math.min(defaults.col_span, BlockFit.COLS - col + 1));
        placed = { col, row: Math.max(1, spot.row), col_span: BlockFit.maxSpanBeside(blocks, { id: -1, col, row: spot.row, row_span: defaults.row_span }, want) };
      }
      const body = { type, ...defaults, ...placed };
      closePicker();
      try {
        const made = await api(`/pages/${currentPage.id}/blocks`, { method: "POST", body: JSON.stringify(body) });
        await loadBlocks();
        if (isMobile()) closeDrawers();
        if (made && made.id) {
          // Whatever the new block now overlaps moves down below it, as the public page would grow, and the new block is selected.
          const settle = BlockFit.settleDown(blocks, isLayoutLocked);
          if (settle.blockedBy === null && settle.moves.length) await applyLayoutChanges(settle.moves);
          if (blocks.some((b) => b.id === made.id)) {
            selectedBlockId = made.id;
            multiSelectedIds.clear();
            renderCanvas();
            renderInspector();
            if (!isMobile() && quickFieldsFor(type).length) openQuickEdit(made.id);
          }
        }
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // ---------- Copy/paste blocks (the clipboard is localStorage, so it survives
  // reopening the admin later). Always creates an independent copy.
  const BLOCK_CLIPBOARD_KEY = "admin_block_clipboard";
  function updatePasteButtonVisibility() {
    let hasClipboard = false;
    try {
      hasClipboard = !!localStorage.getItem(BLOCK_CLIPBOARD_KEY);
    } catch {}
    el("paste-block-btn").hidden = !hasClipboard || !currentPage;
  }

  el("paste-block-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    let clip;
    try {
      clip = JSON.parse(localStorage.getItem(BLOCK_CLIPBOARD_KEY) || "null");
    } catch {
      clip = null;
    }
    if (!clip) return;
    const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    try {
      await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({ type: clip.type, content: clip.content, style: styleWithoutGroup(clip.style), col: 1, row: maxRow, col_span: clip.col_span, row_span: clip.row_span }),
      });
      await loadBlocks();
      if (isMobile()) closeDrawers();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Inspector ----------
  const FIELD_DEFS = {
    heading: [
      { key: "text", label: "Text", type: "text" },
      {
        key: "level",
        label: "Heading level",
        type: "select",
        numeric: true,
        options: [
          [1, "H1 — page title (use once per page)"],
          [2, "H2"],
          [3, "H3"],
          [4, "H4"],
          [5, "H5"],
          [6, "H6"],
        ],
      },
    ],
    text: [{ key: "text", label: "Text (blank line = new paragraph, **bold**, *italic*, [link](url), ```code```, pipe tables, [^1] footnotes)", type: "textarea" }],
    image: [
      { key: "url", label: "Image URL", type: "image-url" },
      { key: "alt", label: "Alt text", type: "text" },
      { key: "caption", label: "Caption (shown under the image)", type: "text" },
      { key: "credit", label: "Credit (shown after the caption)", type: "text" },
      {
        key: "frame",
        label: "Device frame (for screenshots)",
        type: "select",
        options: [
          ["", "None"],
          ["browser", "Browser window"],
          ["phone", "Phone"],
        ],
      },
    ],
    button: [
      { key: "label", label: "Label", type: "text" },
      { key: "url", label: "URL", type: "text" },
      { key: "external", label: "Open in new tab", type: "checkbox" },
    ],
    // STUDY (temporary): see worker/study/README.md.
    study: [
      { key: "label", label: "Button text", type: "text" },
      { key: "lab", label: "Study page", type: "select", options: [["core1-lab", "A+ Core 1 Drill"], ["c777-lab", "C777 Web Development Drill"]] },
      { key: "password", label: "Password (it always asks; blank = the site's default study password).", type: "text", noSpellcheck: true },
    ],
    quote: [
      { key: "text", label: "Quote text", type: "textarea" },
      { key: "cite", label: "Attribution (optional)", type: "text" },
      { key: "large", label: "Display as a large pull quote", type: "checkbox" },
    ],
    gallery: [{ key: "images", label: "Images", type: "gallery-urls" }],
    divider: [],
    spacer: [],
  };

  const STYLE_FIELDS = [
    { key: "color", label: "Text color", type: "color" },
    { key: "bg", label: "Background color", type: "color" },
    {
      key: "fontFamily",
      label: "Font",
      type: "select",
      options: [
        ["", "Site default"],
        ["sans", "Sans-serif"],
        ["serif", "Serif"],
        ["mono", "Monospace"],
        ["rounded", "Rounded (Trebuchet)"],
      ],
    },
    { key: "fontSize", label: "Font size (px)", type: "number" },
    {
      key: "textAlign",
      label: "Text align",
      type: "select",
      options: [
        ["", "Default"],
        ["left", "Left"],
        ["center", "Center"],
        ["right", "Right"],
        ["justify", "Justify"],
      ],
    },
    { key: "padding", label: "Padding (px)", type: "number" },
    {
      key: "paddingStep",
      label: "Padding step (used when no exact padding is set)",
      type: "select",
      options: [
        ["", "None"],
        ["1", "1 (smallest)"],
        ["2", "2"],
        ["3", "3"],
        ["4", "4"],
        ["5", "5"],
        ["6", "6 (largest)"],
      ],
    },
    {
      key: "shadow",
      label: "Shadow",
      type: "select",
      options: [
        ["", "None"],
        ["sm", "Small"],
        ["md", "Medium"],
        ["lg", "Large"],
      ],
    },
    { key: "opacity", label: "Opacity (%)", type: "number" },
    { key: "borderWidth", label: "Border width (px)", type: "number" },
    { key: "borderColor", label: "Border color", type: "color" },
    { key: "borderRadius", label: "Border radius (px)", type: "number" },
    { key: "backgroundImage", label: "Background image", type: "image-url" },
    { key: "gradientFrom", label: "Background gradient — from color", type: "color" },
    { key: "gradientTo", label: "Background gradient — to color", type: "color" },
    { key: "gradientAngle", label: "Gradient angle (degrees, 0 = left-to-right, 135 = top-left to bottom-right)", type: "number" },
    {
      key: "backgroundSize",
      label: "Background image fit",
      type: "select",
      options: [
        ["cover", "Cover"],
        ["contain", "Contain"],
        ["auto", "Original size"],
      ],
    },
    {
      key: "parallax",
      label: "Parallax background (desktop only — the background image moves slower than the rest of the page while scrolling)",
      type: "checkbox",
    },
    {
      key: "blendMode",
      label: "Background blend mode",
      type: "select",
      options: [
        ["", "Normal"],
        ["multiply", "Multiply"],
        ["screen", "Screen"],
        ["overlay", "Overlay"],
        ["darken", "Darken"],
        ["lighten", "Lighten"],
        ["color-dodge", "Color dodge"],
        ["difference", "Difference"],
      ],
    },
    { key: "overlayColor", label: "Overlay color (tint over the background image/video)", type: "color" },
    { key: "overlayOpacity", label: "Overlay opacity (%)", type: "number" },
    {
      key: "position",
      label: "Position",
      type: "select",
      options: [
        ["", "Normal"],
        ["sticky", "Sticky (stays in view while scrolling past it)"],
        ["fixed", "Fixed (stays in view always, e.g. a floating button)"],
      ],
    },
    { key: "stickyOffset", label: "Sticky/fixed offset from top (px)", type: "number" },
    {
      key: "animation",
      label: "Entrance animation (plays once, when scrolled into view)",
      type: "select",
      options: [
        ["", "None"],
        ["fade-in", "Fade in"],
        ["slide-up", "Slide up"],
        ["slide-left", "Slide in from right"],
        ["slide-right", "Slide in from left"],
        ["zoom-in", "Zoom in"],
      ],
    },
    { key: "animationDelay", label: "Animation delay (ms)", type: "number" },
    {
      key: "hoverEffect",
      label: "Hover effect",
      type: "select",
      options: [
        ["", "None"],
        ["lift", "Lift (rises with a shadow)"],
        ["grow", "Grow (scales up slightly)"],
        ["glow", "Glow (accent-color outline)"],
        ["darken", "Darken"],
      ],
    },
    {
      key: "visibility",
      label: "Show on",
      type: "select",
      options: [
        ["", "All devices"],
        ["desktop-only", "Desktop only (hidden on mobile)"],
        ["mobile-only", "Mobile only (hidden on desktop)"],
      ],
    },
    {
      key: "mobileColSpan",
      label: "Mobile column span override (1–24, blank = full width, matching how many of this block's desktop 24 columns to keep on mobile instead of stacking full-width)",
      type: "number",
    },
    {
      key: "shapeMask",
      label: "Shape mask (clips the block to a shape — great on an image block)",
      type: "select",
      options: [
        ["", "None"],
        ["circle", "Circle"],
        ["diagonal-tl-br", "Diagonal (top-left to bottom-right)"],
        ["diagonal-tr-bl", "Diagonal (top-right to bottom-left)"],
        ["hexagon", "Hexagon"],
        ["blob", "Blob"],
      ],
    },
    { key: "customCss", label: "Custom CSS (advanced — raw declarations, e.g. transform: rotate(-2deg);)", type: "textarea", noSpellcheck: true },
    { key: "hidden", label: "Hide from live site", type: "checkbox" },
  ];

  // The Style panel used to be one ~3,500px column of ~35 fields. Grouped
  // into collapsible sections instead; each summary shows how many of its
  // fields are set, so a styled block's settings are findable without
  // opening every group. Open/closed state lives here (not in the DOM)
  // because the inspector re-renders after every style change.
  const STYLE_GROUPS = [
    ["text", "Text", ["color", "fontFamily", "fontSize", "textAlign"]],
    ["box", "Box", ["bg", "padding", "paddingStep", "shadow", "opacity", "borderWidth", "borderColor", "borderRadius"]],
    ["background", "Background", ["backgroundImage", "gradientFrom", "gradientTo", "gradientAngle", "backgroundSize", "parallax", "blendMode", "overlayColor", "overlayOpacity"]],
    ["layout", "Layout & position", ["position", "stickyOffset", "mobileColSpan", "shapeMask"]],
    ["motion", "Motion", ["animation", "animationDelay", "hoverEffect"]],
    ["visibility", "Visibility", ["visibility", "hidden"]],
    ["advanced", "Advanced", ["customCss"]],
  ];
  const openStyleGroups = new Set(["text"]);
  function styleValueIsSet(v) {
    if (v === null || v === undefined || v === "" || v === false) return false;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }
  function styleGroupsHtml(style, idPrefix) {
    const grouped = new Set(STYLE_GROUPS.flatMap(([, , keys]) => keys));
    const leftovers = STYLE_FIELDS.filter((f) => !grouped.has(f.key)).map((f) => f.key);
    return STYLE_GROUPS.map(([id, title, keys]) => {
      const fields = (id === "advanced" ? [...keys, ...leftovers] : keys).map((k) => STYLE_FIELDS.find((f) => f.key === k)).filter(Boolean);
      if (!fields.length) return "";
      const setCount = style ? fields.filter((f) => styleValueIsSet(style[f.key])).length : 0;
      return `<details class="panel-section style-group" data-group="${id}"${openStyleGroups.has(id) ? " open" : ""}><summary>${escapeHtml(title)}${
        setCount ? `<span class="style-group-count">${setCount} set</span>` : ""
      }</summary><div class="style-group-body">${fields.map((f) => fieldHtml(f, style ? style[f.key] : undefined, idPrefix)).join("")}${
        setCount && idPrefix !== "bulk"
          ? `<button type="button" class="style-group-reset" data-group="${id}" data-keys="${escapeHtml(fields.map((f) => f.key).join(","))}" title="Clear every setting in this group so the block goes back to the theme's defaults">Reset ${setCount} ${escapeHtml(title.toLowerCase())} setting${setCount === 1 ? "" : "s"} to default</button>`
          : ""
      }</div></details>`;
    }).join("");
  }
  function wireStyleGroupToggles(container) {
    container.querySelectorAll(".style-group").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (d.open) openStyleGroups.add(d.dataset.group);
        else openStyleGroups.delete(d.dataset.group);
      });
    });
  }

  function fieldHtml(f, val, idPrefix) {
    if (f.type === "checkbox") {
      return `<label><input type="checkbox" data-key="${f.key}" ${val ? "checked" : ""}> ${f.label}</label>`;
    }
    if (f.type === "textarea") {
      return `<label>${f.label}<textarea data-key="${f.key}" rows="4"${f.noSpellcheck ? ' spellcheck="false"' : ""}>${escapeHtml(val || "")}</textarea></label>`;
    }
    if (f.type === "select") {
      const options = f.options
        .map(([optVal, optLabel]) => `<option value="${escapeHtml(optVal)}"${String(val ?? "") === String(optVal) ? " selected" : ""}>${escapeHtml(optLabel)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}"${f.numeric ? ' data-numeric="1"' : ""}>${options}</select></label>`;
    }
    if (f.type === "color") {
      // The bulk multi-select inspector always calls this with val
      // undefined by design ("no prefilled values" — different selected
      // blocks likely have different existing colors, see
      // renderBulkInspector()), which meant Clear could never appear
      // there at all: a <input type="color"> itself never has an empty
      // value, so val is the only signal this function normally has for
      // "there's something to clear." idPrefix === "bulk" is the one
      // reliable way to tell "this render legitimately has nothing to
      // show yet" apart from "there's truly nothing to clear" — bulk mode
      // always wants the button, since applyStyleToAll(key, null) already
      // works fine, it just had no button wired to reach it.
      // A color input can't be empty, so an unset field used to show a
      // black swatch that read as "this is black". is-unset styles it as
      // an empty swatch with a "Not set" note instead.
      return `<label class="color-field${val ? "" : " is-unset"}"><span class="color-field-label">${f.label}</span><span class="color-field-control"><input data-key="${f.key}" type="color" value="${escapeHtml(
        val || "#000000"
      )}">${val ? `<code class="color-field-value">${escapeHtml(val)}</code>` : idPrefix === "bulk" ? "" : '<span class="color-field-value">Not set</span>'}${
        val || idPrefix === "bulk" ? `<button type="button" class="clear-color" data-key="${f.key}">Clear</button>` : ""
      }</span></label>`;
    }
    if (f.type === "image-url") {
      const fieldId = `${idPrefix}-${f.key}`;
      return `<label>${f.label}<input id="${fieldId}" data-key="${f.key}" type="text" spellcheck="false" value="${escapeHtml(
        val ?? ""
      )}"><button type="button" class="upload-trigger" data-target="#${fieldId}">Upload image</button> <button type="button" class="browse-trigger" data-target="#${fieldId}">Browse…</button> <span class="image-url-source-badge" data-target="#${fieldId}" title="Whether this URL points at a file uploaded to this site's media library, or is hotlinked from somewhere else -- an external image can disappear or change without warning if the other site removes or replaces it."></span></label>`;
    }
    if (f.type === "gallery-urls") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : [])
        .map((img) => (typeof img === "string" ? img : `${img.url || ""}${img.alt ? ` | ${img.alt}` : ""}`))
        .join("\n");
      return `<label>${f.label} (one image per line: <code>URL</code> or <code>URL | alt text</code>)<textarea id="${fieldId}" data-key="${f.key}" data-gallery="1" rows="5">${escapeHtml(
        text
      )}</textarea><button type="button" class="upload-trigger" data-target="#${fieldId}" data-append="1">Add image (upload)</button> <button type="button" class="browse-trigger" data-target="#${fieldId}" data-append="1">Add from library…</button></label>`;
    }
    return `<label>${f.label}<input id="${idPrefix}-${f.key}" data-key="${f.key}" type="${f.type}" value="${escapeHtml(val ?? "")}"></label>`;
  }

  function fieldValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number") return input.value === "" ? null : Number(input.value);
    if (input.dataset.numeric) return input.value === "" ? null : Number(input.value);
    if (input.dataset.gallery) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf("|");
          if (idx === -1) return { url: line, alt: "" };
          return { url: line.slice(0, idx).trim(), alt: line.slice(idx + 1).trim() };
        });
    }
    return input.value;
  }

  function renderInspector() {
    renderInspectorInner();
    repositionBlocks();
  }

  function renderInspectorInner() {
    const inspector = el("inspector");
    if (multiSelectedIds.size > 0) {
      inspector.hidden = false;
      if (isMobile()) openDrawer(inspector);
      el("single-block-inspector").hidden = true;
      el("bulk-inspector").hidden = false;
      renderBulkInspector();
      return;
    }
    el("single-block-inspector").hidden = false;
    el("bulk-inspector").hidden = true;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) {
      inspector.hidden = true;
      inspector.classList.remove("drawer-open");
      return;
    }
    inspector.hidden = false;
    // On a phone a selected block gets the block bar; the inspector drawer only opens when asked for (the bar's ⋯ > All settings).
    el("block-save-status").textContent = "";

    if (!block.style) block.style = {};

    updateLockButton("lock-block-btn", !!block.locked);

    const fields = FIELD_DEFS[block.type] || [];
    const container = el("inspector-fields");
    container.innerHTML =
      fields.map((f) => fieldHtml(f, block.content[f.key], `field-${block.id}`)).join("") ||
      "<p style='color:var(--text-dim);font-size:0.85rem;'>No settings for this block.</p>";

    const styleContainer = el("inspector-style-fields");
    styleContainer.innerHTML = styleGroupsHtml(block.style, `style-${block.id}`);
    wireStyleGroupToggles(styleContainer);

    container.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
    container.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
    container.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);

    function save(opts) {
      saveBlockStyleAndContent(block, opts);
    }

    // :not(button) keeps a synthetic "change" event dispatched at a button from reaching fieldValue()'s generic fallback (a button's own
    // .value, which is "") and silently overwriting a field with `"" || null`.
    container.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      input.addEventListener("change", () => {
        block.content[input.dataset.key] = fieldValue(input);
        save();
      });
    });

    styleContainer.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      input.addEventListener("change", () => {
        block.style[input.dataset.key] = fieldValue(input) || null;
        save();
        renderInspector();
      });
    });

    styleContainer.querySelectorAll(".clear-color").forEach((btn) => {
      btn.addEventListener("click", () => {
        block.style[btn.dataset.key] = null;
        save();
        renderInspector();
      });
    });

    // One click puts a whole group back to the inherited/default look (the page
    // history keeps the earlier version if it was a mistake).
    styleContainer.querySelectorAll(".style-group-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const groupId = btn.dataset.group;
        const keys = btn.dataset.keys.split(",").filter((k) => styleValueIsSet(block.style[k]));
        const shownCount = keys.length;
        if (!keys.length) return;
        const title = (STYLE_GROUPS.find(([id]) => id === groupId) || [, groupId])[1];
        const warnings = [];
        if (groupId === "visibility" && block.style.hidden) {
          warnings.push("This can make a hidden block visible on the live site.");
        }
        if (!confirm(`Reset ${shownCount} ${title.toLowerCase()} setting${shownCount === 1 ? "" : "s"} to ${shownCount === 1 ? "its default" : "their defaults"}?${warnings.length ? "\n\n" + warnings.join("\n") : ""}`)) return;
        keys.forEach((k) => (block.style[k] = null));
        save({ forceSnapshot: true }); // the page's history keeps the version before the reset
        renderInspector();
        const summary = document.querySelector(`.style-group[data-group="${groupId}"] > summary`);
        if (summary) summary.focus();
      });
    });

  }

  // Shared by renderInspector()'s own save() closure and the block bar.
  function saveBlockStyleAndContent(block, opts = {}) {
    renderCanvas();
    unsavedDirty = true;
    el("block-save-status").textContent = "Saving…";
    return api(`/blocks/${block.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: block.content, style: block.style, ...(opts.forceSnapshot ? { force_snapshot: true } : {}) }),
    })
      .then(() => {
        unsavedDirty = false;
        el("block-save-status").textContent = "Saved " + new Date().toLocaleTimeString();
      })
      .catch((err) => {
        el("block-save-status").textContent = "Save failed: " + err.message;
        alert(err.message);
      });
  }

  // ---------- Multi-select bulk inspector ----------
  function selectedBlocksList() {
    return blocks.filter((b) => multiSelectedIds.has(b.id));
  }

  // Align/distribute reposition blocks the same way dragging does, so a
  // locked block is excluded here too — style/content changes and
  // duplication aren't repositioning, so those still apply to everything.
  function movableSelectedBlocksList() {
    return selectedBlocksList().filter((b) => !isLayoutLocked(b));
  }

  function renderBulkInspector() {
    const selected = selectedBlocksList();
    el("bulk-inspector-count").textContent = `${selected.length} block${selected.length === 1 ? "" : "s"} selected`;

    const container = el("bulk-style-fields");
    // No prefilled values — different selected blocks likely have
    // different existing styles, so this is purely "set this on all of
    // them", not "here's what they currently share".
    container.innerHTML = styleGroupsHtml(null, "bulk");
    wireStyleGroupToggles(container);
    container.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
    container.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
    container.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);

    async function applyStyleToAll(key, value) {
      const targets = selectedBlocksList();
      for (const b of targets) {
        if (!b.style) b.style = {};
        b.style[key] = value;
        await api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ style: b.style }) }).catch((err) => alert(err.message));
      }
      renderCanvas();
    }

    // :not(button): same reason as the single-block inspector's query (see the comment there).
    container.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      input.addEventListener("change", () => applyStyleToAll(input.dataset.key, fieldValue(input) || null));
    });
    container.querySelectorAll(".clear-color").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await applyStyleToAll(btn.dataset.key, null);
        renderBulkInspector();
      });
    });
  }

  async function patchBlockPosition(b) {
    await api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ col: b.col, row: b.row }) }).catch((err) => alert(err.message));
  }

  el("bulk-align-left").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList();
    if (selected.length < 2) return;
    const minCol = Math.min(...selected.map((b) => b.col));
    for (const b of selected) {
      b.col = minCol;
      await patchBlockPosition(b);
    }
    renderCanvas();
  });

  el("bulk-align-center").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList();
    if (selected.length < 2) return;
    const minCol = Math.min(...selected.map((b) => b.col));
    const maxRight = Math.max(...selected.map((b) => b.col + b.col_span));
    const center = (minCol + maxRight) / 2;
    for (const b of selected) {
      b.col = Math.min(Math.max(1, Math.round(center - b.col_span / 2)), COLS - b.col_span + 1);
      await patchBlockPosition(b);
    }
    renderCanvas();
  });

  el("bulk-align-right").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList();
    if (selected.length < 2) return;
    const maxRight = Math.max(...selected.map((b) => b.col + b.col_span));
    for (const b of selected) {
      b.col = Math.min(Math.max(1, maxRight - b.col_span), COLS - b.col_span + 1);
      await patchBlockPosition(b);
    }
    renderCanvas();
  });

  // Standard design-tool "distribute": the first and last (by current row)
  // stay put, the ones between get an equal gap computed from the total
  // span minus everyone's own height — needs 3+ to mean anything.
  el("bulk-distribute-vertical").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList().sort((a, b) => a.row - b.row);
    if (selected.length < 3) return alert("Select at least 3 blocks to distribute evenly.");
    const first = selected[0];
    const last = selected[selected.length - 1];
    const totalSpan = last.row + last.row_span - first.row;
    const totalBlockSpan = selected.reduce((sum, b) => sum + b.row_span, 0);
    const gap = Math.max(0, Math.round((totalSpan - totalBlockSpan) / (selected.length - 1)));
    let row = first.row;
    for (const b of selected) {
      b.row = row;
      await patchBlockPosition(b);
      row += b.row_span + gap;
    }
    renderCanvas();
  });

  el("bulk-duplicate-btn").addEventListener("click", async () => {
    const selected = selectedBlocksList();
    if (!selected.length || !currentPage) return;
    // The whole selection is placed as a group below everything else,
    // keeping each block's column and its position relative to the others
    // — same idea as single-block duplicate, just for a group at once.
    const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    const minSelectedRow = Math.min(...selected.map((b) => b.row));
    const newIds = [];
    // Copies of grouped blocks form their own new group instead of joining the original one.
    const groupRemap = new Map();
    for (const b of selected) {
      const g = groupOf(b);
      const style = styleWithoutGroup(b.style);
      if (g) {
        if (!groupRemap.has(g)) groupRemap.set(g, newGroupId());
        style.group = groupRemap.get(g);
      }
      const res = await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: b.type,
          content: b.content,
          style,
          col: b.col,
          col_span: b.col_span,
          row: maxRow + (b.row - minSelectedRow),
          row_span: b.row_span,
        }),
      });
      newIds.push(res.id);
    }
    await loadBlocks();
    multiSelectedIds = new Set(newIds);
    renderCanvas();
    renderInspector();
  });

  el("bulk-delete-btn").addEventListener("click", async () => {
    const all = selectedBlocksList();
    if (!all.length) return;
    // A locked block is protected from this kind of sweep; the single-block Delete
    // button (a deliberate, one-target action) is the one place a locked block still deletes.
    const locked = all.filter((b) => isLayoutLocked(b));
    const selected = all.filter((b) => !isLayoutLocked(b));
    if (!selected.length) return alert("All selected blocks are locked.");
    if (!confirm(`Delete ${selected.length} block(s)?${locked.length ? ` (${locked.length} locked block(s) will be skipped.)` : ""}`)) return;
    for (const b of selected) {
      await api(`/blocks/${b.id}`, { method: "DELETE" });
    }
    multiSelectedIds.clear();
    await loadBlocks();
    showUndoToast(`${selected.length} block(s) deleted.`, async () => {
      for (const b of selected) {
        await api(`/pages/${currentPage.id}/blocks`, {
          method: "POST",
          body: JSON.stringify({ type: b.type, content: b.content, style: b.style, col: b.col, col_span: b.col_span, row: b.row, row_span: b.row_span }),
        });
      }
      await loadBlocks();
    });
  });

  el("copy-block-btn").addEventListener("click", () => {
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    try {
      localStorage.setItem(
        BLOCK_CLIPBOARD_KEY,
        JSON.stringify({ type: block.type, content: block.content, style: block.style, col_span: block.col_span, row_span: block.row_span })
      );
    } catch {}
    updatePasteButtonVisibility();
  });

  // ---------- Heading level ----------
  // Mirrors headingLevel() in worker/render.js exactly: a heading block with no stored level (or an invalid one) renders as an H1.
  function effectiveHeadingLevel(content) {
    const lvl = Number(content && content.level);
    return Number.isInteger(lvl) && lvl >= 1 && lvl <= 6 ? lvl : 1;
  }

  // ---------- Undo (blocks only, in-memory, ~8s window) ----------
  let undoTimer = null;
  function showUndoToast(text, onUndo) {
    clearTimeout(undoTimer);
    const toast = el("undo-toast");
    el("undo-toast-text").textContent = text;
    toast.hidden = false;
    const btn = el("undo-toast-btn");
    const handler = async () => {
      btn.removeEventListener("click", handler);
      toast.hidden = true;
      clearTimeout(undoTimer);
      await onUndo();
    };
    btn.addEventListener("click", handler);
    undoTimer = setTimeout(() => {
      toast.hidden = true;
      btn.removeEventListener("click", handler);
    }, 8000);
  }

  el("duplicate-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    // Place the copy below everything else, same spot the palette uses for
    // new blocks, so it's guaranteed not to overlap anything.
    const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    try {
      const res = await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: block.type,
          content: block.content,
          style: styleWithoutGroup(block.style),
          col: block.col,
          col_span: block.col_span,
          row: maxRow,
          row_span: block.row_span,
        }),
      });
      await loadBlocks();
      selectedBlockId = res.id;
      renderCanvas();
      renderInspector();
      if (isMobile()) closeDrawers();
    } catch (err) {
      alert(err.message);
    }
  });

  el("lock-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    try {
      await api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ locked: !block.locked }) });
      block.locked = !block.locked;
      updateLockButton("lock-block-btn", block.locked);
      renderCanvas();
    } catch (err) {
      alert(err.message);
    }
  });

  el("delete-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    if (block.locked) {
      alert("This block is locked. Unlock it before deleting.");
      return;
    }
    if (isMobile()) closeDrawers();
    await api(`/blocks/${selectedBlockId}`, { method: "DELETE" });
    await loadBlocks();
    showUndoToast("Block deleted.", async () => {
      await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: block.type,
          content: block.content,
          style: block.style || {},
          col: block.col,
          col_span: block.col_span,
          row: block.row,
          row_span: block.row_span,
        }),
      });
      await loadBlocks();
    });
  });

  // ---------- Adding: click an empty spot of the page, pick a block ----------
  // The block palette is a picker that opens where you click (or under + Add, which puts the block at the bottom). A faint box follows the
  // pointer over empty space to show where a block would land.
  let pendingInsert = null; // {col, row}: where the next block goes, or null for the bottom of the page
  const paletteEl = el("palette");
  function gridCellAt(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    const { colW, gap, rowH } = canvasMetrics();
    const col = Math.max(1, Math.min(BlockFit.COLS, Math.floor((clientX - rect.left) / (colW + gap)) + 1));
    const row = Math.max(1, Math.floor((clientY - rect.top) / (rowH + gap)) + 1);
    return { col, row };
  }
  let pickerOpener = null;
  function openPicker(opts = {}) {
    if (!currentPage || isMobile()) return;
    pendingInsert = opts.spot || null;
    pickerOpener = opts.opener || null;
    const tab = opts.tab === "page" ? "panel-tab-page" : "panel-tab-blocks";
    el(tab).click();
    paletteEl.classList.add("is-picker-open");
    const w = paletteEl.offsetWidth || 340;
    const h = Math.min(window.innerHeight * 0.7, 560);
    let x = opts.x != null ? opts.x + 10 : 20;
    let y = opts.y != null ? opts.y + 10 : 90;
    x = Math.max(8, Math.min(x, window.innerWidth - w - 8));
    y = Math.max(8, Math.min(y, window.innerHeight - h - 8));
    paletteEl.style.left = x + "px";
    paletteEl.style.top = y + "px";
    [el("add-block-btn"), el("page-settings-btn")].forEach((b) => b && b.setAttribute("aria-expanded", String(b === pickerOpener)));
    hideInsertGhost();
    if (tab === "panel-tab-blocks") {
      const search = el("palette-search");
      search.value = "";
      search.dispatchEvent(new Event("input", { bubbles: true }));
      search.focus();
    }
  }
  function closePicker(returnFocus) {
    const wasOpen = paletteEl.classList.contains("is-picker-open");
    paletteEl.classList.remove("is-picker-open");
    paletteEl.style.left = "";
    paletteEl.style.top = "";
    pendingInsert = null;
    [el("add-block-btn"), el("page-settings-btn")].forEach((b) => b && b.setAttribute("aria-expanded", "false"));
    if (wasOpen && returnFocus && pickerOpener) pickerOpener.focus();
    pickerOpener = null;
  }
  el("close-palette").addEventListener("click", () => closePicker(true));
  el("add-block-btn").addEventListener("click", () => {
    if (paletteEl.classList.contains("is-picker-open") && pickerOpener === el("add-block-btn")) return closePicker(true);
    const r = el("add-block-btn").getBoundingClientRect();
    openPicker({ x: r.left - 10, y: r.bottom - 6, opener: el("add-block-btn"), tab: "blocks" });
  });
  el("page-settings-btn").addEventListener("click", () => {
    if (paletteEl.classList.contains("is-picker-open") && pickerOpener === el("page-settings-btn")) return closePicker(true);
    const r = el("page-settings-btn").getBoundingClientRect();
    openPicker({ x: r.left - 10, y: r.bottom - 6, opener: el("page-settings-btn"), tab: "page" });
  });
  document.addEventListener("pointerdown", (e) => {
    if (!paletteEl.classList.contains("is-picker-open")) return;
    if (paletteEl.contains(e.target) || e.target.closest("#add-block-btn, #page-settings-btn")) return;
    closePicker();
  });
  document.addEventListener("keydown", (e) => {
    if (!paletteEl.classList.contains("is-picker-open")) return;
    if (e.key === "Escape") {
      e.stopPropagation();
      closePicker(true);
      return;
    }
    // Up and Down walk the rows (from the search box too); the Enter that follows presses the row.
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    const rows = [...paletteEl.querySelectorAll("#palette-blocks .palette-btn")].filter((b) => !b.hidden && b.offsetParent !== null);
    if (!rows.length || !paletteEl.contains(document.activeElement)) return;
    e.preventDefault();
    const at = rows.indexOf(document.activeElement);
    const next = e.key === "ArrowDown" ? (at + 1) % rows.length : (at <= 0 ? rows.length - 1 : at - 1);
    rows[next].focus();
  }, true);
  let insertGhost = null;
  function hideInsertGhost() {
    if (insertGhost) insertGhost.hidden = true;
  }
  function showInsertGhost(spot) {
    if (!insertGhost || !insertGhost.isConnected) {
      insertGhost = document.createElement("div");
      insertGhost.className = "insert-ghost";
      insertGhost.setAttribute("aria-hidden", "true");
      insertGhost.innerHTML = "<span>+ Add here</span>";
      canvas.appendChild(insertGhost);
    }
    const { colW, gap, rowH } = canvasMetrics();
    const span = BlockFit.maxSpanBeside(blocks, { id: -1, col: spot.col, row: spot.row, row_span: 3 }, Math.min(8, BlockFit.COLS - spot.col + 1));
    insertGhost.style.left = (spot.col - 1) * (colW + gap) + "px";
    insertGhost.style.top = (spot.row - 1) * (rowH + gap) + "px";
    insertGhost.style.width = BlockFit.widthForCols(span, colW) + "px";
    insertGhost.style.height = BlockFit.heightForRows(3) + "px";
    insertGhost.hidden = false;
  }
  canvas.addEventListener("pointermove", (e) => {
    if (e.target !== canvas || isMobile() || !currentPage || e.pointerType === "touch" || paletteEl.classList.contains("is-picker-open")) return hideInsertGhost();
    showInsertGhost(gridCellAt(e.clientX, e.clientY));
  });
  canvas.addEventListener("pointerleave", hideInsertGhost);
  canvas.addEventListener("click", (e) => {
    if (e.target !== canvas || isMobile() || !currentPage) return;
    openPicker({ spot: gridCellAt(e.clientX, e.clientY), x: e.clientX, y: e.clientY, tab: "blocks" });
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.target === canvas) {
      selectedBlockId = null;
      multiSelectedIds.clear();
      renderInspector();
      document.querySelectorAll(".admin-block").forEach((d) => d.classList.remove("selected"));
      renderCanvasToolbar();
    }
  });

  function updateLockButton(btnId, locked) {
    const btn = el(btnId);
    btn.textContent = locked ? "Unlock" : "Lock";
    btn.classList.toggle("is-locked", locked);
  }

  function updateOgPreview(prefix, { title, desc, image }) {
    el(`og-preview-${prefix}-title`).textContent = title || "(untitled)";
    el(`og-preview-${prefix}-desc`).textContent = desc || "";
    const imgEl = el(`og-preview-${prefix}-img`);
    imgEl.style.backgroundImage = image ? `url('${image.replace(/'/g, "\\'")}')` : "";
    imgEl.textContent = "";
  }

  function updatePageOgPreview() {
    if (!currentPage) return;
    updateOgPreview("page", {
      title: el("page-title").value,
      desc: el("page-meta").value,
      image: el("page-og-image").value,
    });
  }

  // The settings that are kept: the footer, the default share image and maintenance mode. A save sends exactly these keys.
  el("site-settings-btn").addEventListener("click", async () => {
    const settings = await api("/settings");
    el("settings-og-image").value = settings.default_og_image || "";
    el("settings-footer").value = settings.site_footer || "";
    loadFooterEditor(settings.site_footer_links);
    el("settings-maintenance-mode").checked = settings.maintenance_mode === "1";
    el("settings-maintenance-message").value = settings.maintenance_message || "";
    el("settings-modal").hidden = false;
    switchSettingsTab("footer");
    loadErrors().catch(() => {});
    loadScheduledBackups().catch(() => {});
  });
  closeModalOnClick("close-settings", "settings-modal");

  // ---------- Site settings tabs ----------
  function switchSettingsTab(name) {
    document.querySelectorAll(".settings-tab").forEach((btn) => {
      const active = btn.dataset.panel === name;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".settings-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
  }
  document.querySelectorAll(".settings-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchSettingsTab(btn.dataset.panel));
  });
  el("save-settings").addEventListener("click", async () => {
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          default_og_image: el("settings-og-image").value,
          site_footer: el("settings-footer").value,
          site_footer_links: footerLayoutJson(),
          maintenance_mode: el("settings-maintenance-mode").checked ? "1" : "",
          maintenance_message: el("settings-maintenance-message").value,
        }),
      });
      el("settings-modal").hidden = true;
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Footer layout (link columns + social links) ----------
  // Edited as "Label | url" lines; the server normalises and drops anything that isn't a site path or http(s)/mailto/tel link.
  let footerIgnoredLines = 0;
  function parseLinkLines(text) {
    const links = [];
    for (const line of String(text || "").split("\n")) {
      if (!line.trim()) continue;
      const i = line.lastIndexOf("|");
      const label = i === -1 ? "" : line.slice(0, i).trim();
      const url = i === -1 ? "" : line.slice(i + 1).trim();
      const okUrl = /^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(url) && !/[\u0000-\u0020\u007f\\]/.test(url) && url.length <= 500;
      if (label && label.length <= 60 && okUrl && links.length < 8) links.push({ label, url });
      else footerIgnoredLines++;
    }
    return links;
  }
  const linkLines = (links) => (links || []).map((l) => `${l.label} | ${l.url}`).join("\n");
  function loadFooterEditor(raw) {
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {}
    const cols = data.columns || [];
    for (let n = 1; n <= 3; n++) {
      const c = cols[n - 1] || {};
      el(`settings-footer-col-title-${n}`).value = c.title || "";
      el(`settings-footer-col-links-${n}`).value = linkLines(c.links);
    }
    el("settings-footer-social").value = linkLines(data.social);
    el("settings-footer-note").textContent = "";
  }
  function footerLayoutJson() {
    footerIgnoredLines = 0;
    const columns = [1, 2, 3].map((n) => ({ title: el(`settings-footer-col-title-${n}`).value.trim(), links: parseLinkLines(el(`settings-footer-col-links-${n}`).value) }));
    const social = parseLinkLines(el("settings-footer-social").value);
    el("settings-footer-note").textContent = footerIgnoredLines
      ? `${footerIgnoredLines} line${footerIgnoredLines === 1 ? " was" : "s were"} left out: each needs "Label | /page" or a full https:// address, a label up to 60 characters, and at most 8 links per list.`
      : "";
    if (footerIgnoredLines) alert(el("settings-footer-note").textContent);
    return columns.some((c) => c.links.length) || social.length ? JSON.stringify({ columns, social }) : "";
  }

  // ---------- Media library ----------
  // Upload images, pick one for a block, set its alt text, caption and credit, and delete files. The list comes a page at a time.
  let mediaPickTarget = null;
  let mediaPickAppend = false;
  let mediaItems = [];
  let selectedMediaKeys = new Set();
  // What the search box is currently showing: "Select all" selects just this subset, not the whole library.
  let lastFilteredMediaKeys = [];
  let mediaInfoKey = null;
  let mediaLoadToken = 0;
  let mediaUploading = false;

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  function mediaFilename(item) {
    return item.key.split("/").pop();
  }

  function mediaIsImage(item) {
    return /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(item.key);
  }

  function updateMediaBulkBar() {
    const n = selectedMediaKeys.size;
    el("media-selected-count").textContent = n ? `${n} selected` : "";
    el("media-bulk-delete-btn").disabled = !n;
    // The bulk actions only appear once something is selected, instead of sitting there as disabled buttons.
    el("media-bulk-actions").hidden = !n;
    el("media-grid").classList.toggle("has-selection", n > 0);
    const shown = lastFilteredMediaKeys;
    el("media-shown-count").textContent = `Select all ${shown.length} shown`;
    const shownSelectedCount = shown.filter((k) => selectedMediaKeys.has(k)).length;
    const selectAll = el("media-select-all");
    selectAll.checked = shown.length > 0 && shownSelectedCount === shown.length;
    selectAll.indeterminate = shownSelectedCount > 0 && shownSelectedCount < shown.length;
  }

  async function deleteMediaFiles(keys) {
    if (keys.length === 1) await api(`/media/${keys[0]}`, { method: "DELETE" });
    else await api("/media/bulk-delete", { method: "POST", body: JSON.stringify({ keys }) });
    keys.forEach((k) => selectedMediaKeys.delete(k));
    await loadMediaLibrary();
  }

  function renderMediaGrid() {
    const search = el("media-search").value.trim().toLowerCase();
    const filtered = mediaItems
      .filter((item) => {
        if (!search) return true;
        return mediaFilename(item).toLowerCase().includes(search) || (item.alt_text || "").toLowerCase().includes(search);
      })
      .sort((a, b) => (Date.parse(b.uploaded) || 0) - (Date.parse(a.uploaded) || 0) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
    lastFilteredMediaKeys = filtered.map((item) => item.key);
    // Bulk actions apply to what is selected, so a selection never outlives the search that showed it.
    const shownKeys = new Set(lastFilteredMediaKeys);
    selectedMediaKeys.forEach((k) => !shownKeys.has(k) && selectedMediaKeys.delete(k));

    el("media-grid").innerHTML =
      filtered
        .map(
          (item) =>
            `<div class="media-item${selectedMediaKeys.has(item.key) ? " is-selected" : ""}" data-url="${escapeHtml(item.url)}" data-key="${escapeHtml(
              item.key
            )}"><div class="media-thumb">${
              mediaIsImage(item)
                ? `<img src="${escapeHtml(item.url)}" loading="lazy" alt="${escapeHtml(item.alt_text || "")}">`
                : `<span class="media-file-icon">File</span>`
            }<input type="checkbox" class="media-select-checkbox" aria-label="Select ${escapeHtml(mediaFilename(item))}" data-key="${escapeHtml(
              item.key
            )}"${selectedMediaKeys.has(item.key) ? " checked" : ""}><div class="media-tile-actions"><button type="button" class="media-delete" data-key="${escapeHtml(
              item.key
            )}" title="Delete" aria-label="Delete">×</button></div></div><div class="media-meta"><div class="media-meta-top"><span class="media-filename" title="${escapeHtml(
              mediaFilename(item)
            )}">${escapeHtml(item.alt_text || item.caption || mediaFilename(item))}</span><button type="button" class="media-info" data-key="${escapeHtml(
              item.key
            )}" title="Details: alt text, caption, credit" aria-label="Details">i</button></div><div class="media-meta-sub">${escapeHtml(
              [item.width && item.height ? `${item.width}×${item.height}` : "", formatBytes(item.size)].filter(Boolean).join(" · ")
            )}</div>${
              !item.alt_text && mediaIsImage(item)
                ? '<div class="media-badges"><span class="media-badge media-badge-warn" title="No alt text saved: screen readers and search engines get nothing">No alt</span></div>'
                : ""
            }</div></div>`
        )
        .join("") || "<p style='color:var(--text-dim);'>No uploads match.</p>";

    el("media-grid")
      .querySelectorAll(".media-item")
      .forEach((div) => {
        div.addEventListener("click", (e) => {
          if (e.target.closest(".media-delete, .media-info, .media-select-checkbox")) return;
          // Browsing (not picking for a field): the tile itself opens its details, rather than a click that silently does nothing.
          if (!mediaPickTarget) {
            openMediaInfoModal(div.dataset.key);
            return;
          }
          const input = document.querySelector(mediaPickTarget);
          if (input) {
            // An image block's url/alt/caption/credit fields are named "...-url"/"...-alt"/"...-caption"/"...-credit": suggest this
            // file's saved values for whichever of those fields are blank. Merged into a single save rather than one dispatched
            // "change" per field, because several independent saves back to back can race and silently drop a field.
            const item = mediaItems.find((m) => m.url === div.dataset.url);
            const block = item && input.id.endsWith("-url") ? blocks.find((b) => b.id === selectedBlockId) : null;
            if (block) {
              input.value = div.dataset.url;
              // Refreshed directly rather than by a synthetic "change" event, which would also fire this input's own autosave listener.
              if (input._imageUrlBadgeUpdate) input._imageUrlBadgeUpdate();
              block.content.url = div.dataset.url;
              [
                ["alt", "alt_text"],
                ["caption", "caption"],
                ["credit", "credit"],
              ].forEach(([suffix, itemKey]) => {
                const sibling = document.getElementById(input.id.replace(/-url$/, `-${suffix}`));
                if (sibling && !sibling.value && item[itemKey]) {
                  sibling.value = item[itemKey];
                  block.content[suffix] = item[itemKey];
                }
              });
              api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ content: block.content, style: block.style }) }).catch(() => {});
              renderCanvas();
            } else {
              setFieldUrl(input, div.dataset.url, mediaPickAppend);
            }
          }
          closeMediaModal();
        });
      });

    el("media-grid")
      .querySelectorAll(".media-select-checkbox")
      .forEach((cb) => {
        cb.addEventListener("click", (e) => {
          e.stopPropagation();
          if (e.target.checked) selectedMediaKeys.add(e.target.dataset.key);
          else selectedMediaKeys.delete(e.target.dataset.key);
          e.target.closest(".media-item").classList.toggle("is-selected", e.target.checked);
          updateMediaBulkBar();
        });
      });

    el("media-grid")
      .querySelectorAll(".media-info")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openMediaInfoModal(btn.dataset.key);
        });
      });

    el("media-grid")
      .querySelectorAll(".media-delete")
      .forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this file? This can't be undone.")) return;
          try {
            await deleteMediaFiles([btn.dataset.key]);
          } catch (err) {
            alert(err.message);
          }
        });
      });

    updateMediaBulkBar();
  }

  el("media-bulk-clear-btn").addEventListener("click", () => {
    selectedMediaKeys.clear();
    renderMediaGrid();
  });

  el("media-select-all").addEventListener("change", (e) => {
    if (e.target.checked) lastFilteredMediaKeys.forEach((k) => selectedMediaKeys.add(k));
    else lastFilteredMediaKeys.forEach((k) => selectedMediaKeys.delete(k));
    renderMediaGrid();
  });

  el("media-bulk-delete-btn").addEventListener("click", async () => {
    if (!selectedMediaKeys.size) return;
    const ok = await confirmTyped(`Permanently delete ${selectedMediaKeys.size} file(s)? This can't be undone.`, { title: "Delete files" });
    if (!ok) return;
    try {
      await deleteMediaFiles([...selectedMediaKeys]);
    } catch (err) {
      alert(err.message);
    }
  });

  function openMediaInfoModal(key) {
    const item = mediaItems.find((m) => m.key === key);
    if (!item) return;
    mediaInfoKey = key;
    el("media-info-preview").src = item.url;
    const ext = item.key.split(".").pop().toUpperCase();
    el("media-info-meta").textContent = `${mediaFilename(item)} · ${ext} · ${formatBytes(item.size)}${item.width && item.height ? ` · ${item.width}×${item.height}px` : ""}`;
    el("media-info-alt").value = item.alt_text || "";
    el("media-info-caption").value = item.caption || "";
    el("media-info-credit").value = item.credit || "";
    el("media-info-modal").hidden = false;
  }
  closeModalOnClick("close-media-info", "media-info-modal");
  el("save-media-info").addEventListener("click", async () => {
    if (!mediaInfoKey) return;
    const item = mediaItems.find((m) => m.key === mediaInfoKey) || {};
    try {
      // The fields this dialog does not show go back as they are, so a save can never clear them.
      await api(`/media/${mediaInfoKey}`, {
        method: "PATCH",
        body: JSON.stringify({
          folder: item.folder || null,
          tags: item.tags || [],
          alt_text: el("media-info-alt").value.trim() || null,
          caption: el("media-info-caption").value.trim() || null,
          credit: el("media-info-credit").value.trim() || null,
          license: item.license || null,
          private: !!item.private,
        }),
      });
      el("media-info-modal").hidden = true;
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

  // Every file, fetched a page of up to 500 at a time (the first page is drawn as soon as it arrives). A newer load makes an older
  // one stop, so a slow listing can never overwrite a fresher one. Pages are capped at 40 (20,000 files).
  async function fetchAllMedia(onPage) {
    const token = ++mediaLoadToken;
    const all = [];
    let cursor = null;
    for (let page = 0; page < 40; page++) {
      const reply = await api(`/media?paged=1${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (token !== mediaLoadToken) return null;
      all.push(...reply.items);
      cursor = reply.next;
      if (onPage) onPage(all.slice(), Boolean(cursor));
      if (!cursor) return { items: all, complete: true };
    }
    return { items: all, complete: false };
  }

  async function loadMediaLibrary() {
    const status = el("media-load-status");
    const result = await fetchAllMedia((items, more) => {
      mediaItems = items;
      status.textContent = more ? `Loading… ${items.length} files so far` : "";
      if (more) renderMediaGrid(); // what has arrived so far is shown while the rest loads
    }).catch((err) => {
      status.textContent = "";
      throw err;
    });
    if (!result) return; // a newer load took over
    mediaItems = result.items;
    status.textContent = result.complete ? "" : `Showing the first ${result.items.length} files (the library is too big to list in full here).`;
    selectedMediaKeys = new Set([...selectedMediaKeys].filter((k) => mediaItems.some((m) => m.key === k)));
    renderMediaGrid();
  }

  el("media-search").addEventListener("input", renderMediaGrid);

  const mediaUploadInput = document.createElement("input");
  mediaUploadInput.type = "file";
  mediaUploadInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  mediaUploadInput.multiple = true;
  mediaUploadInput.hidden = true;
  el("media-upload-btn").after(mediaUploadInput);
  el("media-upload-btn").addEventListener("click", () => mediaUploadInput.click());
  el("media-shrink-big").checked = shrinkBigEnabled();
  el("media-shrink-big").addEventListener("change", () => {
    try {
      localStorage.setItem(SHRINK_KEY, el("media-shrink-big").checked ? "1" : "0");
    } catch {
      // Without storage the choice just lasts until the page is reloaded.
    }
  });
  // Uploads the given files one after another, then reloads the library. Shared by the Upload files button and by dropping files on the library.
  async function uploadMediaFileList(files, note) {
    if (!files.length || mediaUploading) return;
    mediaUploading = true;
    const btn = el("media-upload-btn");
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      const shrunk = [];
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Uploading ${i + 1}/${files.length}…`;
        const { resized } = await uploadFile(files[i]);
        if (resized) shrunk.push(resized);
      }
      await loadMediaLibrary();
      const fullNote = [note, window.ImageFit.describeShrunk(shrunk)].filter(Boolean).join(" ");
      if (fullNote) el("media-load-status").textContent = fullNote;
    } catch (err) {
      alert(err.message);
    } finally {
      mediaUploading = false;
      btn.textContent = originalText;
      btn.disabled = false;
      mediaUploadInput.value = "";
    }
  }
  mediaUploadInput.addEventListener("change", () => uploadMediaFileList(Array.from(mediaUploadInput.files)));

  // Drag files from the desktop onto the library to upload them. Only real file drags count (dragging a tile or text does nothing),
  // anything that isn't an image type the Upload button accepts is skipped and said so, and nothing happens while an upload is running.
  const MEDIA_DROP_TYPES = new Set(mediaUploadInput.accept.split(","));
  const mediaDropZone = el("media-modal").querySelector(".modal-inner");
  const draggingFiles = (e) => Array.from((e.dataTransfer && e.dataTransfer.types) || []).includes("Files");
  let mediaDragDepth = 0;
  function setMediaDropping(on) {
    mediaDropZone.classList.toggle("is-dropping", on);
    mediaDropZone.dataset.dropLabel = on ? "Drop images here to upload" : "";
  }
  mediaDropZone.addEventListener("dragenter", (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    mediaDragDepth++;
    setMediaDropping(true);
  });
  mediaDropZone.addEventListener("dragover", (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault(); // without this the browser would refuse the drop
    e.dataTransfer.dropEffect = mediaUploading ? "none" : "copy";
  });
  mediaDropZone.addEventListener("dragleave", (e) => {
    if (!draggingFiles(e)) return;
    mediaDragDepth = Math.max(0, mediaDragDepth - 1);
    if (!mediaDragDepth) setMediaDropping(false);
  });
  mediaDropZone.addEventListener("drop", (e) => {
    if (!draggingFiles(e)) return;
    e.preventDefault();
    mediaDragDepth = 0;
    setMediaDropping(false);
    if (mediaUploading) return;
    const dropped = Array.from(e.dataTransfer.files || []);
    const accepted = dropped.filter((f) => MEDIA_DROP_TYPES.has(f.type));
    const skipped = dropped.length - accepted.length;
    const note = skipped ? `${skipped} dropped file${skipped === 1 ? " was" : "s were"} skipped: only PNG, JPEG, WebP, GIF and SVG images can be uploaded here.` : "";
    if (note) el("media-load-status").textContent = note;
    if (accepted.length) uploadMediaFileList(accepted, note);
  });
  // A file dropped just outside the library must not make the browser open it in place of the admin.
  ["dragover", "drop"].forEach((type) => window.addEventListener(type, (e) => draggingFiles(e) && e.preventDefault()));

  function openMediaModal(pickTarget, append) {
    mediaPickTarget = pickTarget || null;
    mediaPickAppend = !!append;
    el("media-hint").hidden = !mediaPickTarget;
    el("media-modal").hidden = false;
    loadMediaLibrary().catch((err) => alert(err.message));
  }

  function closeMediaModal() {
    el("media-modal").hidden = true;
    mediaPickTarget = null;
    mediaPickAppend = false;
  }

  el("media-btn").addEventListener("click", () => openMediaModal(null));
  el("close-media").addEventListener("click", closeMediaModal);

  // ---------- Error log ----------
  async function loadErrors() {
    const items = await api("/errors?limit=50");
    el("error-log-list").innerHTML =
      items
        .map(
          (e) =>
            `<div class="link-check-row broken" title="${escapeHtml(e.stack || "")}"><span class="link-check-url">${escapeHtml(
              e.message
            )}${e.path ? ` (${escapeHtml(e.path)})` : ""}</span><span class="link-check-source">${escapeHtml(
              new Date(e.created_at.replace(" ", "T") + "Z").toLocaleString()
            )}</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No errors logged — good sign.</p>";
  }
  el("load-errors-btn").addEventListener("click", () => loadErrors().catch((err) => alert(err.message)));

  // ---------- Scheduled backups ----------
  async function loadScheduledBackups() {
    const [items, status] = await Promise.all([api("/scheduled-backups"), api("/backup-status")]);
    el("scheduled-backups-list").innerHTML =
      items
        .map(
          (b) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(b.key.replace("backups/", ""))}${b.key.startsWith("backups/pre-restore-") ? ' <em class="backup-safety-tag">(saved automatically before a restore)</em>' : ""}</span><span class="link-check-source">${formatBytes(
              b.size
            )}</span><button type="button" class="view-backup-contents-btn" data-key="${escapeHtml(
              b.key
            )}">View contents</button> <button type="button" class="verify-backup-btn" data-key="${escapeHtml(
              b.key
            )}">Verify integrity</button> <button type="button" class="download-backup-btn" data-key="${escapeHtml(
              b.key
            )}">Download</button> <button type="button" class="danger restore-backup-btn" data-key="${escapeHtml(
              b.key
            )}">Restore this backup…</button> <span class="backup-verify-result"></span></div><div class="backup-contents" data-key="${escapeHtml(
              b.key
            )}" hidden></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No backups yet.</p>";
    el("scheduled-backups-list")
      .querySelectorAll(".view-backup-contents-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const panel = btn.closest(".link-check-row").nextElementSibling;
          if (!panel.hidden) {
            panel.hidden = true;
            return;
          }
          try {
            const contents = await api(`/scheduled-backups-contents?key=${encodeURIComponent(btn.dataset.key)}`);
            const rows = Object.entries(contents.counts)
              .map(([table, count]) => `<span class="backup-contents-row">${escapeHtml(table)}: ${count}</span>`)
              .join("");
            panel.innerHTML = `<div class="backup-contents-meta">Exported ${escapeHtml(new Date(contents.exported_at).toLocaleString())} (backup format v${contents.version})</div>${rows}`;
            panel.hidden = false;
          } catch (err) {
            alert(err.message);
          }
        });
      });
    // Re-hashes the file as it sits in R2 right now against the checksum
    // stored when it was written — catches corruption/truncation before
    // it's discovered mid-restore, rather than trusting the file blindly.
    el("scheduled-backups-list")
      .querySelectorAll(".verify-backup-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const resultEl = btn.nextElementSibling;
          const originalText = btn.textContent;
          btn.textContent = "Verifying…";
          btn.disabled = true;
          try {
            const result = await api(`/scheduled-backups-verify?key=${encodeURIComponent(btn.dataset.key)}`);
            if (!result.hasChecksum) {
              resultEl.innerHTML = `<span class="contrast-fail">No stored checksum (backup predates this check)</span>`;
            } else if (result.ok) {
              resultEl.innerHTML = `<span class="contrast-pass">✓ Verified intact</span>`;
            } else {
              resultEl.innerHTML = `<span class="contrast-fail">Checksum mismatch — this file may be corrupted</span>`;
            }
          } catch (err) {
            resultEl.textContent = err.message;
          } finally {
            btn.textContent = originalText;
            btn.disabled = false;
          }
        });
      });
    // Same fetch-then-blob-download pattern the existing on-demand
    // "Download backup" (/export) button already uses, for a specific
    // historical R2-stored snapshot instead of always "right now."
    el("scheduled-backups-list")
      .querySelectorAll(".download-backup-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const res = await fetch(`/api/admin/scheduled-backups-download?key=${encodeURIComponent(btn.dataset.key)}`);
          if (!res.ok) {
            alert("Download failed.");
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = btn.dataset.key.replace("backups/", "");
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        });
      });
    // A scheduled backup could previously be inspected and verified but
    // never actually restored — this reuses the exact same destructive
    // confirm wording as the manual "Restore from file…" flow, since the
    // consequence (replace everything) is identical either way.
    el("scheduled-backups-list")
      .querySelectorAll(".restore-backup-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const originalText = btn.textContent;
          btn.disabled = true;
          let summary = "";
          try {
            summary = backupPreviewText(await api(`/scheduled-backups-preview?key=${encodeURIComponent(btn.dataset.key)}`));
          } catch (err) {
            alert("Couldn't read that backup: " + err.message);
            btn.disabled = false;
            return;
          }
          if (!confirm(restoreConfirmText("this backup", summary))) {
            btn.disabled = false;
            return;
          }
          btn.textContent = "Restoring…";
          try {
            const res = await api("/scheduled-backups-restore", { method: "POST", body: JSON.stringify({ key: btn.dataset.key }) });
            alert(restoredText(res));
            location.reload();
          } catch (err) {
            alert("Restore failed: " + err.message);
            btn.textContent = originalText;
            btn.disabled = false;
          }
        });
      });
    const statusEl = el("scheduled-backup-status");
    if (status.lastError) {
      statusEl.innerHTML = `<span class="contrast-fail">Last backup attempt failed: ${escapeHtml(status.lastError)}</span>`;
    } else if (status.lastAt) {
      statusEl.innerHTML = `<span class="contrast-pass">✓ Last backup succeeded ${escapeHtml(new Date(status.lastAt).toLocaleString())}</span>`;
    } else {
      statusEl.innerHTML = "";
    }
  }
  // Restore wording shared by "Restore from file…" and a scheduled backup's Restore: what would change, and that a safety copy is made first.
  function backupPreviewText(preview) {
    const rows = (preview.rows || [])
      .filter((r) => r.file || r.now)
      .map((r) => `  ${r.table.replace(/_/g, " ")}: ${r.now} now → ${r.file} in the backup${r.now === r.file ? "" : r.file < r.now ? " (fewer)" : " (more)"}`);
    const when = preview.exported_at ? new Date(preview.exported_at).toLocaleString() : "an unknown date";
    return `Backup made ${when}.\n\nRows on the site now → in the backup:\n${rows.join("\n") || "  (nothing)"}`;
  }
  function restoreConfirmText(what, summary) {
    return `${summary}\n\nRestoring replaces every page, block and setting with what is in ${what}. The site as it is now is saved first as a backup in Settings → Backups, so you can undo this by restoring that copy. Continue?`;
  }
  function restoredText(res) {
    return `Restored.${res && res.safetyBackup ? `\n\nThe previous site was saved as ${res.safetyBackup} (Settings → Backups); restore it to undo.` : ""}\n\nReloading…`;
  }
  el("run-backup-now-btn").addEventListener("click", async () => {
    const btn = el("run-backup-now-btn");
    const originalText = btn.textContent;
    btn.textContent = "Running…";
    btn.disabled = true;
    try {
      await api("/scheduled-backups/run", { method: "POST" });
      await loadScheduledBackups();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // ---------- Revisions ----------
  // ---------- Page history ----------
  function normBlockForDiff(b) {
    return {
      id: b.id,
      type: b.type,
      content: typeof b.content === "string" ? b.content : JSON.stringify(b.content || {}),
      style: typeof b.style === "string" ? b.style : JSON.stringify(b.style || {}),
      col: b.col, col_span: b.col_span, row: b.row, row_span: b.row_span,
    };
  }

  function diffPageBlocksHtml(oldBlocks, newBlocks) {
    const oldNorm = oldBlocks.map(normBlockForDiff);
    const newNorm = newBlocks.map(normBlockForDiff);
    const oldById = new Map(oldNorm.map((b) => [b.id, b]));
    const newById = new Map(newNorm.map((b) => [b.id, b]));
    const rows = [];
    newNorm.forEach((b) => {
      if (!oldById.has(b.id)) rows.push({ status: "Added since", type: b.type, id: b.id, restorable: false });
    });
    oldNorm.forEach((b) => {
      const nb = newById.get(b.id);
      if (!nb) {
        rows.push({ status: "Removed since (restoring brings it back)", type: b.type, id: b.id, restorable: true });
      } else if (
        b.content !== nb.content ||
        b.style !== nb.style ||
        b.col !== nb.col ||
        b.col_span !== nb.col_span ||
        b.row !== nb.row ||
        b.row_span !== nb.row_span
      ) {
        rows.push({ status: "Changed since", type: b.type, id: b.id, restorable: true });
      }
    });
    if (!rows.length) return "<p style='color:var(--text-dim);font-size:0.85rem;'>No differences from the current page.</p>";
    return `<ul class="revision-diff-blocks">${rows
      .map(
        (r) =>
          `<li><strong>${escapeHtml(blockLabel(r.type))}</strong> — ${escapeHtml(r.status)} this version${
            r.restorable
              ? ` <button type="button" class="restore-revision-block" data-block-id="${r.id}">Restore just this block</button>`
              : ""
          }</li>`
      )
      .join("")}</ul>`;
  }

  async function showRevisionDiff(kind, entityId, revisionId) {
    const rev = await api(`/revisions/${revisionId}`);
    el("revisions-list").hidden = true;
    el("revisions-diff").hidden = false;
    el("revisions-diff-body").innerHTML = diffPageBlocksHtml(rev.snapshot, blocks);
    el("revisions-diff-body")
      .querySelectorAll(".restore-revision-block")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Restore just this block to how it was in this revision? The current page is saved first, so this can be undone too.")) return;
          try {
            await api(`/revisions/${revisionId}/restore-block`, {
              method: "POST",
              body: JSON.stringify({ entity_id: entityId, block_id: Number(btn.dataset.blockId) }),
            });
            el("revisions-modal").hidden = true;
            await loadBlocks();
          } catch (err) {
            alert(err.message);
          }
        });
      });
  }

  el("revisions-diff-back").addEventListener("click", () => {
    el("revisions-diff").hidden = true;
    el("revisions-list").hidden = false;
  });

  async function openRevisions(kind, entityId) {
    el("revisions-modal").hidden = false;
    el("revisions-diff").hidden = true;
    el("revisions-list").hidden = false;
    const revisions = await api(`/revisions?kind=${kind}&id=${entityId}`);
    el("revisions-list").innerHTML =
      revisions
        .map(
          (r) =>
            `<div class="revision-row"><span><span class="revision-row-time">${new Date(
              r.created_at.replace(" ", "T") + "Z"
            ).toLocaleString()}</span>${
              r.label ? `<span class="revision-row-label">${escapeHtml(r.label)}</span>` : ""
            }</span><span class="revision-row-actions"><button type="button" class="compare-revision" data-id="${
              r.id
            }">Compare</button><button type="button" class="restore-revision" data-id="${
              r.id
            }">Restore</button></span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No history yet.</p>";

    el("revisions-list")
      .querySelectorAll(".compare-revision")
      .forEach((btn) => {
        btn.addEventListener("click", () => showRevisionDiff(kind, entityId, Number(btn.dataset.id)));
      });

    el("revisions-list")
      .querySelectorAll(".restore-revision")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Restore this version? The current state is saved first, so this can be undone too.")) return;
          try {
            await api(`/revisions/${btn.dataset.id}/restore`, {
              method: "POST",
              body: JSON.stringify({ kind, entity_id: entityId }),
            });
            el("revisions-modal").hidden = true;
            await loadBlocks();
          } catch (err) {
            alert(err.message);
          }
        });
      });
  }

  closeModalOnClick("close-revisions", "revisions-modal");
  el("page-history-btn").addEventListener("click", () => {
    if (currentPage) openRevisions("page", currentPage.id);
  });

  // ---------- Command palette (Ctrl/Cmd+K) ----------
  let commandItems = [];
  let commandActiveIndex = 0;

  // "Where is this setting?": a plain-language index over the controls in Site Settings, so "footer" or "offline" finds the right
  // tab and field without knowing which tab it lives under. Keywords are deliberately generous.
  const SETTINGS_SEARCH_INDEX = [
    { label: "Site footer text", tab: "footer", field: "settings-footer", keywords: ["footer", "copyright"] },
    { label: "Footer link columns", tab: "footer", field: "settings-footer-col-title-1", keywords: ["footer", "links", "columns", "social"] },
    { label: "Default share image", tab: "sharing", field: "settings-og-image", keywords: ["og:image", "og image", "share image", "social preview", "thumbnail", "twitter card", "meta image"] },
    { label: "Maintenance mode", tab: "maintenance", field: "settings-maintenance-mode", keywords: ["maintenance", "down", "offline", "turn off", "shut down", "take down", "site down", "disable site"] },
    { label: "Maintenance message", tab: "maintenance", field: "settings-maintenance-message", keywords: ["maintenance", "message"] },
    { label: "Error Log", tab: "errors", field: "error-log-list", keywords: ["error", "log", "crash"] },
    { label: "Backup / Restore", tab: "backups", field: "export-btn", keywords: ["backup", "restore", "export", "import"] },
  ];

  // Common short/filler words stripped before matching, so "turn off the site" does not need the literal word "the" in a keyword.
  const SETTINGS_SEARCH_STOPWORDS = new Set(["the", "a", "an", "is", "this", "that", "to", "of", "for", "on", "in", "my"]);

  function settingsSearchActions(q) {
    if (!q) return [];
    // Each significant word must appear somewhere in the entry's label and keywords.
    const words = q
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !SETTINGS_SEARCH_STOPWORDS.has(w));
    if (!words.length) return [];
    return SETTINGS_SEARCH_INDEX.filter((entry) => {
      const haystack = `${entry.label} ${entry.keywords.join(" ")}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    }).map((entry) => ({
      label: `Setting: ${entry.label}`,
      sub: "Site Settings",
      run: () => {
        closeCommandPalette();
        el("site-settings-btn").click();
        // site-settings-btn's own handler is async (it fetches settings before un-hiding the modal), so switching tabs and focusing
        // has to wait until that is done.
        setTimeout(() => {
          switchSettingsTab(entry.tab);
          const target = el(entry.field);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            if (typeof target.focus === "function") target.focus();
          }
        }, 200);
      },
    }));
  }

  function quickActions() {
    const actions = [
      { label: "Open Media Library", sub: "", run: () => { closeCommandPalette(); el("media-btn").click(); } },
      { label: "Open Features", sub: "What has been built, and your requests", run: () => { closeCommandPalette(); el("features-btn").click(); } },
      { label: "Open Site Settings", sub: "", run: () => { closeCommandPalette(); el("site-settings-btn").click(); } },
      { label: "Keyboard Shortcuts", sub: "", run: () => { closeCommandPalette(); el("shortcuts-modal").hidden = false; } },
      { label: "Toggle light / dark admin theme", sub: "", leads: true, keywords: ["theme", "dark mode", "light mode", "dark", "light", "appearance of the admin"], run: () => { closeCommandPalette(); el("admin-theme-toggle").click(); } },
      {
        label: document.documentElement.getAttribute("data-density") === "compact" ? "Interface density: switch to comfortable" : "Interface density: switch to compact",
        sub: "This browser only",
        leads: true,
        keywords: ["compact", "comfortable", "density", "spacing", "tighter"],
        run: () => { closeCommandPalette(); el("admin-density-toggle").click(); },
      },
      { label: "Fit every block to its content", sub: "Page", run: () => { closeCommandPalette(); fitAllBlocks(); } },
      {
        label: "Log out (signs out every device)",
        sub: "",
        leads: true,
        keywords: ["logout", "log out", "sign out", "log off", "signout"],
        run: () => {
          closeCommandPalette();
          // Logging out revokes every session, phones included, so the keyboard route asks first.
          if (confirm("Log out? This signs you out on every device.")) el("logout-btn").click();
        },
      },
      {
        label: "Open Error Log",
        sub: "",
        run: () => {
          closeCommandPalette();
          el("site-settings-btn").click();
          // The settings button's handler is async, so scrolling has to wait until the dialog is actually visible.
          setTimeout(() => {
            switchSettingsTab("errors");
            el("error-log-list").scrollIntoView({ behavior: "smooth" });
          }, 200);
        },
      },
    ];
    pages.forEach((p) => {
      actions.push({
        label: `Go to page: ${p.title || p.slug}`,
        sub: p.slug === "home" ? "/" : `/${p.slug}`,
        run: () => {
          closeCommandPalette();
          selectPage(p.id);
        },
      });
    });
    // Commands for the block that is selected right now (single selection only), so they
    // never act on something the user can't see selected.
    const singleBlockOpen = !el("inspector").hidden && !el("single-block-inspector").hidden && selectedBlockId != null;
    if (singleBlockOpen) {
      const blockClick = (id) => () => {
        closeCommandPalette();
        el(id).click();
      };
      // Each command follows its own button: one the inspector hides or disables is not offered.
      const blockCommands = [
        ["copy-block-btn", "Block: Copy selected block", ["copy", "copy block"]],
        ["duplicate-block-btn", "Block: Duplicate selected block", ["duplicate", "duplicate block", "clone"]],
        ["lock-block-btn", "Block: Lock / unlock selected block", ["lock", "unlock", "lock block"]],
      ];
      blockCommands.forEach(([id, label, keywords]) => {
        const btn = el(id);
        if (btn.hidden || btn.disabled) return;
        actions.push({ label, sub: "", leads: true, keywords, run: blockClick(id) });
      });
    }
    if (!el("paste-block-btn").hidden) {
      actions.push({ label: "Block: Paste copied block", sub: "", leads: true, keywords: ["paste", "paste block"], run: () => { closeCommandPalette(); el("paste-block-btn").click(); } });
    }
    return actions;
  }

  // The blocks of the page being edited whose own text contains what was typed.
  function blockSearchActions(q) {
    const needle = q.toLowerCase();
    return blocks
      .filter((b) => JSON.stringify(b.content || {}).toLowerCase().includes(needle))
      .slice(0, 8)
      .map((b) => ({
        label: `Block: ${blockLabel(b.type)}`,
        sub: String((b.content && (b.content.text || b.content.label)) || "").slice(0, 40) || "this page",
        found: true,
        run: () => {
          closeCommandPalette();
          selectedBlockId = b.id;
          multiSelectedIds.clear();
          renderCanvas();
          renderInspector();
          if (isMobile()) openDrawer(el("inspector"));
          const node = canvas.querySelector(`[data-id="${b.id}"]`);
          if (node) node.scrollIntoView({ behavior: "smooth", block: "center" });
        },
      }));
  }

  function setCommandActive(index) {
    commandActiveIndex = index;
    el("command-results")
      .querySelectorAll(".command-result")
      .forEach((row, i) => {
        row.classList.toggle("active", i === index);
        row.setAttribute("aria-selected", i === index ? "true" : "false");
        if (i === index) el("command-input").setAttribute("aria-activedescendant", row.id);
      });
  }

  // Result groups follow the label prefix ("Setting: y"); anything else is a command.
  const COMMAND_GROUPS = {
    Block: ["Blocks", "Block"],
    Setting: ["Settings", "Setting"],
  };
  // Display order of the groups; "Best match" holds commands that named the query.
  const COMMAND_GROUP_ORDER = ["Best match", "Settings", "Actions", "Blocks"];
  function commandGroupOf(it) {
    if (it.best) return ["Best match", "Action"];
    const m = /^([^:]{1,20}):/.exec(it.label || "");
    // "Block: …" is a block search result only when it was found by its text; otherwise it's a command.
    if (m && m[1] === "Block" && !it.found) return ["Actions", "Action"];
    return (m && COMMAND_GROUPS[m[1]]) || ["Actions", "Action"];
  }

  function renderCommandResults(items) {
    // One heading per group: stable-sort by group so a group never reappears later in the list.
    items = items
      .map((it, i) => ({ it, i, r: COMMAND_GROUP_ORDER.indexOf(commandGroupOf(it)[0]) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.it);
    commandItems = items;
    commandActiveIndex = 0;
    let lastGroup = null;
    el("command-results").innerHTML = items.length
      ? items
          .map((it, i) => {
            const [group, kind] = commandGroupOf(it);
            const heading = group !== lastGroup ? `<div class="command-result-group" aria-hidden="true">${escapeHtml(group)}</div>` : "";
            lastGroup = group;
            return `${heading}<div class="command-result${i === 0 ? " active" : ""}" id="command-opt-${i}" role="option" aria-selected="${i === 0 ? "true" : "false"}" data-index="${i}" data-k="${kind}"><span>${escapeHtml(
              it.label
            )}</span><span class="command-result-sub">${escapeHtml(it.sub || "")}</span></div>`;
          })
          .join("")
      : "<p class='command-empty'>Nothing matches. Try a page name, a setting, or a command like “theme”.</p>";
    el("command-input").setAttribute("aria-activedescendant", items.length ? "command-opt-0" : "");
    el("command-results")
      .querySelectorAll(".command-result")
      .forEach((row) => {
        row.addEventListener("click", () => commandItems[Number(row.dataset.index)].run());
        row.addEventListener("mousemove", () => setCommandActive(Number(row.dataset.index)));
      });
  }

  function runCommandSearch(q) {
    const needle = q.toLowerCase();
    const localMatches = q
      ? quickActions().filter((a) => a.label.toLowerCase().includes(needle) || (a.keywords || []).some((k) => k.includes(needle)))
      : quickActions();
    // A command that names what was typed (its label or one of its own keywords) outranks
    // the settings index, so "theme" toggles the theme instead of opening a setting first.
    // Only a whole keyword, or the start of one from four letters up, leads: "a", "l" or "mode"
    // must not push these ahead of everything else, and "log" still means the logs.
    const leading = q ? localMatches.filter((a) => a.leads && (a.keywords || []).some((k) => k === needle || (needle.length >= 4 && k.startsWith(needle)))) : [];
    leading.forEach((a) => (a.best = true));
    // Settings matches lead the list: "where is this setting" is exactly what this index exists for.
    renderCommandResults([...leading, ...settingsSearchActions(q), ...localMatches.filter((a) => !leading.includes(a)), ...(q ? blockSearchActions(q) : [])]);
  }

  function openCommandPalette() {
    // Recorded before .hidden flips and before focus moves into the
    // palette's own search input -- the only modal in the app that moves
    // focus into itself on open, which otherwise races the generic
    // focus-return MutationObserver below (a microtask, so by the time it
    // runs, document.activeElement is already #command-input, not the
    // real trigger). See that observer's own comment for the other half.
    modalFocusReturn.set(el("command-modal"), document.activeElement);
    el("command-modal").hidden = false;
    el("command-input").value = "";
    el("command-input").focus();
    renderCommandResults(quickActions());
  }
  function closeCommandPalette() {
    el("command-modal").hidden = true;
  }

  el("command-btn").addEventListener("click", openCommandPalette);
  el("close-command").addEventListener("click", closeCommandPalette);
  closeModalOnClick("close-shortcuts", "shortcuts-modal");
  el("command-input").addEventListener("input", (e) => runCommandSearch(e.target.value.trim()));
  el("command-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeCommandPalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCommandActive(Math.min(commandActiveIndex + 1, commandItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCommandActive(Math.max(commandActiveIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (commandItems[commandActiveIndex]) commandItems[commandActiveIndex].run();
    }
  });

  // ---------- Backup / restore ----------
  el("export-btn").addEventListener("click", async () => {
    const res = await fetch("/api/admin/export");
    if (!res.ok) {
      alert("Export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dominickdominick-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  el("import-btn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        const summary = backupPreviewText(await api("/import-preview", { method: "POST", body: JSON.stringify(data) }));
        if (!confirm(restoreConfirmText("this file", summary))) return;
        const res = await api("/import", { method: "POST", body: JSON.stringify(data) });
        alert(restoredText(res));
        location.reload();
      } catch (err) {
        alert("Restore failed: " + err.message);
      }
    });
    input.click();
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const isTyping =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (document.activeElement && document.activeElement.isContentEditable);
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    if (!isTyping && !mod && e.key === "?") {
      e.preventDefault();
      el("shortcuts-modal").hidden = false;
      return;
    }

    // Plain Ctrl/Cmd+S only (Ctrl+Shift+S and Ctrl+Alt+S are left to the browser), by physical key so it
    // works on non-Latin layouts, and not on the signed-out screen where there is nothing to save.
    if (mod && !e.shiftKey && !e.altKey && (e.code === "KeyS" || e.key.toLowerCase() === "s") && !app.hidden) {
      e.preventDefault();
      if (e.repeat) return; // a held key must not save over and over
      // Ctrl/Cmd+S saves the topmost editor, never something that is only visible behind it.
      const top = getTopModal();
      if (top) {
        const saveButtonId = {
          "settings-modal": "save-settings",
          "media-info-modal": "save-media-info",
        }[top.id];
        const btn = saveButtonId && el(saveButtonId);
        if (btn && !btn.disabled) btn.click();
        return; // any other dialog on top (pickers, confirmations): nothing to save with this key
      }
      if (currentPage) el("save-page-settings").click();
      return;
    }

    if (isTyping || app.hidden) return;

    if ((e.key === "Delete" || e.key === "Backspace") && multiSelectedIds.size > 0) {
      e.preventDefault();
      el("bulk-delete-btn").click();
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId) {
      e.preventDefault();
      // A locked block still deletes fine via its own explicit button (a
      // deliberate action) — this keyboard shortcut is exactly the kind of
      // accidental trigger locking is meant to guard against, so it's the
      // one place that actually respects the lock.
      const block = blocks.find((b) => b.id === selectedBlockId);
      if (block && isLayoutLocked(block)) return;
      el("delete-block-btn").click();
      return;
    }

    if (selectedBlockId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      const block = blocks.find((b) => b.id === selectedBlockId);
      if (!block) return;
      e.preventDefault();
      let { col, row } = block;
      if (e.key === "ArrowUp") row = Math.max(1, row - 1);
      if (e.key === "ArrowDown") row = row + 1;
      if (e.key === "ArrowLeft") col = Math.max(1, col - 1);
      if (e.key === "ArrowRight") col = Math.min(COLS - block.col_span + 1, col + 1);
      if (col === block.col && row === block.row) return;
      const trial = { ...block, col, row };
      if (wouldOverlap(trial)) return;
      block.col = col;
      block.row = row;
      renderCanvas();
      api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ col, row }) }).catch((err) => alert(err.message));
    }
  });

  async function boot() {
    const { authenticated } = await fetch("/api/admin/me").then((r) => r.json());
    if (!authenticated) {
      showLogin();
      return;
    }
    showApp();
    await loadPages();
    await openDeepLinkedEditor();
  }

  // "Edit this" on the live public site links here as /admin/?edit=page:id: jumps straight to that page. A bad or missing id is just
  // ignored (no error shown) since there is nothing actionable to tell the admin.
  async function openDeepLinkedEditor() {
    const edit = new URLSearchParams(location.search).get("edit");
    if (!edit) return;
    const [type, idStr] = edit.split(":");
    const id = Number(idStr);
    if (!id) return;
    if (type === "page") await selectPage(id);
  }

  document.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
  document.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
  document.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);

  // A modal opened from inside another is promoted by modalStackObserver.
  // Use computed z-index to identify the same top surface for Escape, focus,
  // and aria-modal semantics; later DOM order breaks ties.
  function getTopModal(ignoreId) {
    let top = null;
    let highestZIndex = Number.NEGATIVE_INFINITY;
    for (const modal of document.querySelectorAll(OPEN_DIALOG_SELECTOR)) {
      if (ignoreId && modal.id === ignoreId) continue;
      const parsedZIndex = Number(getComputedStyle(modal).zIndex);
      const zIndex = Number.isFinite(parsedZIndex) ? parsedZIndex : 0;
      if (!top || zIndex >= highestZIndex) {
        top = modal;
        highestZIndex = zIndex;
      }
    }
    return top;
  }
  function syncModalSemantics() {
    const top = getTopModal();
    document.querySelectorAll(DIALOG_SELECTOR).forEach((modal) => {
      modal.removeAttribute("aria-modal");
      modal.removeAttribute("aria-hidden");
      if (modal.hidden) return;
      if (modal === top) modal.setAttribute("aria-modal", "true");
      else modal.setAttribute("aria-hidden", "true");
    });
  }

  // Escape and backdrop-click close whichever modal is open, via its own
  // close button (not by setting .hidden directly), so a close handler that
  // does cleanup is never skipped.
  function closeTopModal() {
    const modal = getTopModal();
    if (!modal) return false;
    const closeBtn = modal.querySelector('button[id^="close-"]');
    if (closeBtn) closeBtn.click();
    else modal.hidden = true;
    return true;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (closeTopModal()) {
      e.preventDefault();
      return;
    }
    if (selectedBlockId !== null || multiSelectedIds.size > 0) {
      // With no dialog or dropdown open, Escape clears the canvas selection
      // and closes the Inspector.
      e.preventDefault();
      selectedBlockId = null;
      multiSelectedIds.clear();
      renderCanvas();
      renderInspector();
    }
  });
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      if (e.target === modal) closeTopModal();
    });
  });

  // Focus trap — previously no modal in the app managed keyboard focus at
  // all, so Tab from inside an open modal walked straight into whatever
  // background page control happened to be next in DOM order (the canvas,
  // the sidebar nav, another modal's controls hidden behind this one).
  // Reuses getTopModal() so a modal opened from inside another modal (e.g.
  // Media Library from Site Settings) traps against the one actually
  // on top, not the one underneath it.
  function focusableIn(container) {
    return Array.from(
      container.querySelectorAll(
        'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, audio[controls], video[controls], summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => node.offsetParent !== null && node.tabIndex >= 0);
  }
  function initialFocusInModal(modal) {
    const explicit = modal.querySelector("[autofocus]");
    if (explicit && explicit.offsetParent !== null) return explicit;
    const title = modal.querySelector(".modal-inner > header h1");
    if (title) {
      if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
      return title;
    }
    const first = focusableIn(modal)[0];
    if (first) return first;
    if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
    return modal;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const modal = getTopModal();
    if (!modal) return;
    const focusable = focusableIn(modal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIndex = focusable.indexOf(document.activeElement);
    if (activeIndex === -1) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && activeIndex === 0) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeIndex === focusable.length - 1) {
      e.preventDefault();
      first.focus();
    }
  });
  // The outside-focus guard: focus that lands outside the top dialog is pulled back in.
  document.addEventListener("focusin", (e) => {
    const modal = getTopModal();
    if (!modal || modal.contains(e.target)) return;
    initialFocusInModal(modal).focus();
  });

  // The other half of the same pattern: once a modal closes, return focus
  // to whatever triggered it, rather than leaving it wherever the modal's
  // own contents last had it (often nowhere, since closing typically hides
  // the focused element itself, dropping focus to <body>). A
  // MutationObserver on the shared `hidden` attribute, not a wrapper
  // around every individual open/close call site.
  //
  // A dialog that is hidden in the same moment another one opens is handing
  // over, not closing, so it keeps the button it will have to return to.
  let dialogsOpenBefore = new Set();
  new MutationObserver((mutations) => {
    const dialogsOpenNow = new Set(document.querySelectorAll(OPEN_DIALOG_SELECTOR));
    const openedNow = [...dialogsOpenNow].filter((d) => !dialogsOpenBefore.has(d));
    for (const m of mutations) {
      const modal = m.target;
      if (!(modal instanceof HTMLElement) || !modal.matches(DIALOG_SELECTOR)) continue;
      if (modal.hidden) {
        const others = openedNow.filter((d) => d !== modal);
        if (others.length) {
          if (others.some((d) => modalFocusReturn.has(d))) modalFocusReturn.delete(modal); // handing back to the dialog that was waiting
          continue; // (otherwise handing over to a new one: keep the return target for when this one comes back)
        }
        const restore = modalFocusReturn.get(modal);
        modalFocusReturn.delete(modal);
        if (restore && document.body.contains(restore)) restore.focus();
      } else if (!modalFocusReturn.has(modal)) {
        const active = document.activeElement;
        modalFocusReturn.set(modal, active);
        if (!modal.contains(active)) initialFocusInModal(modal).focus();
      } else if (!modal.contains(document.activeElement)) {
        initialFocusInModal(modal).focus(); // shown again after a hand-over, with the focus left outside it
      }
    }
    dialogsOpenBefore = dialogsOpenNow;
  }).observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });

  // A result list that scrolls has to be reachable from the keyboard, or someone who cannot use a mouse can never read the rest of it. It
  // becomes a focusable, named region only while it really overflows and has nothing focusable inside already (so empty and short
  // lists do not add tab stops).
  function syncScrollRegion(box) {
    const overflows = box.scrollHeight > box.clientHeight + 1;
    const hasFocusable = !!box.querySelector("a[href], button, input, select, textarea, [tabindex]");
    if (overflows && !hasFocusable) {
      box.tabIndex = 0;
      box.setAttribute("role", "region");
      if (!box.dataset.scrollLabel) {
        let heading = box.previousElementSibling;
        while (heading && !/^H[1-6]$/.test(heading.tagName)) heading = heading.previousElementSibling;
        box.dataset.scrollLabel = heading ? heading.textContent.trim() : "Results";
      }
      box.setAttribute("aria-label", box.dataset.scrollLabel);
    } else if (box.dataset.scrollLabel) {
      box.removeAttribute("tabindex");
      box.removeAttribute("role");
      box.removeAttribute("aria-label");
      delete box.dataset.scrollLabel;
    }
  }
  if (typeof ResizeObserver === "function") {
    const watchScrollRegion = (box) => {
      new ResizeObserver(() => syncScrollRegion(box)).observe(box);
      new MutationObserver(() => syncScrollRegion(box)).observe(box, { childList: true, subtree: true });
    };
    document.querySelectorAll(".link-check-results").forEach(watchScrollRegion);
  }

  // Crash monitoring: a single pair of window-level listeners catches uncaught errors and promise rejections and sends them to the
  // Error Log viewer. A repeating crash would otherwise flood the log with near-identical rows, so the same message from the same source
  // is reported at most once every ten seconds (per page load; a reload is a fair reset).
  const recentClientErrors = new Map();
  const CLIENT_ERROR_DEDUP_MS = 10000;
  function reportClientError(message, stack, source) {
    try {
      const safeMessage = String(message ?? "Unknown error").slice(0, 2000);
      const key = source + "|" + safeMessage.slice(0, 200);
      const now = Date.now();
      if (now - (recentClientErrors.get(key) || 0) < CLIENT_ERROR_DEDUP_MS) return;
      recentClientErrors.set(key, now);
      const payload = JSON.stringify({ message: safeMessage, stack: stack ? String(stack).slice(0, 4000) : null, source });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/admin/client-error", payload);
      else fetch("/api/admin/client-error", { method: "POST", body: payload, keepalive: true });
    } catch {}
  }
  function currentEditorSource() {
    return "admin";
  }
  // A thrown/rejected value isn't always an Error. Coercing a plain object straight to a string gives "[object Object]", a log row
  // with no information, so objects are stringified (a WeakSet-tracked replacer marks circular references instead of throwing).
  function safeStringify(value) {
    const seen = new WeakSet();
    try {
      return JSON.stringify(value, (key, val) => {
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      });
    } catch {
      return null;
    }
  }
  function describeThrown(value, fallback) {
    if (value instanceof Error) return { message: value.message, stack: value.stack };
    if (value && typeof value === "object") {
      const json = safeStringify(value);
      if (json) return { message: json, stack: null };
      // Stringify failed for a reason other than circularity (e.g. a
      // BigInt field) -- name at least the constructor rather than
      // falling all the way back to a useless "[object Object]".
      const name = value.constructor && value.constructor.name;
      return { message: `[${name || "Object"} thrown, could not serialize]`, stack: null };
    }
    return { message: value !== undefined && value !== null ? String(value) : fallback, stack: null };
  }
  window.addEventListener("error", (e) => {
    const { message, stack } = describeThrown(e.error, e.message);
    reportClientError(message, stack, currentEditorSource());
  });
  window.addEventListener("unhandledrejection", (e) => {
    const { message, stack } = describeThrown(e.reason, "Unhandled promise rejection");
    reportClientError(message, stack, currentEditorSource());
  });

  window.addEventListener("resize", () => renderCanvas());
  // The search button's hint names this computer's own shortcut.
  if (el("command-btn") && !/Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)) el("command-btn").textContent = "Search Ctrl K";
  // Opening or closing the menu or the inspector changes the canvas's width without a window resize.
  if (window.ResizeObserver && canvas.parentElement) {
    let lastW = canvas.parentElement.clientWidth;
    new ResizeObserver(() => {
      const w = canvas.parentElement.clientWidth;
      if (Math.abs(w - lastW) < 1) return;
      lastW = w;
      requestAnimationFrame(() => renderCanvas());
    }).observe(canvas.parentElement);
  }
  boot();
})();
