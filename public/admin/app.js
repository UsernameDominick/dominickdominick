(function () {
  "use strict";

  const COLS = 24;
  const ROW_H = 16;

  const el = (id) => document.getElementById(id);
  // Wires a "×" button that just needs to hide its modal — most of them.
  // Ones that also need to reset state (media picker, command palette,
  // simulation builder) wire their own close handler instead of using this.
  const closeModalOnClick = (btnId, modalId) => el(btnId).addEventListener("click", () => (el(modalId).hidden = true));
  const canvas = el("canvas");
  const loginScreen = el("login-screen");
  const app = el("app");

  // ---------- Mobile drawers ----------
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
  const backdrop = el("drawer-backdrop");

  function openDrawer(drawerEl) {
    drawerEl.classList.add("drawer-open");
    backdrop.hidden = false;
  }
  function closeDrawers() {
    el("palette").classList.remove("drawer-open");
    el("inspector").classList.remove("drawer-open");
    el("admin-header-right").classList.remove("drawer-open");
    backdrop.hidden = true;
  }
  el("mobile-menu-btn").addEventListener("click", () => openDrawer(el("palette")));
  el("close-palette").addEventListener("click", closeDrawers);
  el("close-inspector").addEventListener("click", closeDrawers);
  el("site-menu-btn").addEventListener("click", () => openDrawer(el("admin-header-right")));
  el("close-site-menu").addEventListener("click", closeDrawers);
  backdrop.addEventListener("click", closeDrawers);
  // Tapping a nav item inside the mobile menu drawer should close it, not leave it open behind the modal it opened.
  el("admin-header-right").querySelectorAll("button, a").forEach((node) => {
    if (node.id === "close-site-menu") return;
    node.addEventListener("click", () => {
      if (isMobile()) closeDrawers();
    });
  });

  let pages = [];
  let currentPage = null;
  let blocks = [];
  let selectedBlockId = null;

  async function uploadFile(file, folder) {
    const res = await fetch("/api/admin/upload" + (folder ? `?folder=${encodeURIComponent(folder)}` : ""), {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }
    const { url } = await res.json();
    return url;
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
        const url = await uploadFile(file);
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
  // Deliberately doesn't attempt a merge or diff (that's real future work,
  // not a one-line fix); it just refuses to silently clobber the other
  // change and gives the admin an explicit way to load the current version.
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
    btn.addEventListener("click", onReload);
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
        el("login-error").hidden = false;
        return;
      }
      el("login-error").hidden = true;
      await boot();
    } catch (err) {
      el("login-error").hidden = false;
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

  // ---------- Pages ----------
  async function loadPages() {
    pages = await api("/pages");
    const picker = el("page-picker");
    picker.innerHTML = pages
      .map((p) => `<option value="${p.id}">${p.title || p.slug}</option>`)
      .join("");
    if (pages.length) {
      const stillExists = currentPage && pages.find((p) => p.id === currentPage.id);
      await selectPage(stillExists ? currentPage.id : pages[0].id);
    } else {
      currentPage = null;
      blocks = [];
      selectedBlockId = null;
      canvas.innerHTML = "<p style='color:var(--text-dim);padding:24px;'>No pages left. Use \"+ Page\" to create one.</p>";
      renderInspector();
    }
  }

  async function selectPage(id) {
    currentPage = pages.find((p) => p.id === id);
    if (!currentPage) return;
    el("page-picker").value = id;
    el("page-title").value = currentPage.title || "";
    el("page-meta").value = currentPage.meta_description || "";
    el("page-nav-label").value = currentPage.nav_label || "";
    el("page-nav-order").value = currentPage.nav_order ?? "";
    el("page-og-image").value = currentPage.og_image || "";
    el("page-save-status").textContent = "";
    updateLockButton("lock-page-btn", !!currentPage.locked);
    updatePageOgPreview();
    checkPageDraftRecovery(currentPage.id);
    await loadBlocks();
  }

  // ---------- Page-settings crash-recovery draft ----------
  // Page settings have no server-side autosave at all (only the explicit
  // Save button), so this local snapshot is the *only* safety net between
  // typing and clicking Save — a bigger gap than articles have.
  const PAGE_DRAFT_FIELD_IDS = ["page-title", "page-meta", "page-nav-label", "page-nav-order", "page-og-image"];
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

  el("new-page-btn").addEventListener("click", async () => {
    const title = prompt("Page title:");
    if (!title) return;
    const templateId = Number(el("page-template-picker").value) || null;
    try {
      const res = await api("/pages", { method: "POST", body: JSON.stringify({ title }) });
      if (templateId) {
        const t = templateOptions.page.find((x) => x.id === templateId);
        const templateBlocks = (t && t.data.blocks) || [];
        for (const b of templateBlocks) {
          await api(`/pages/${res.id}/blocks`, { method: "POST", body: JSON.stringify(b) });
        }
      }
      await loadPages();
      const created = pages.find((p) => p.id === res.id);
      if (created) await selectPage(created.id);
    } catch (err) {
      alert(err.message);
    }
  });

  ["page-title", "page-meta", "page-nav-label", "page-nav-order", "page-og-image"].forEach((id) =>
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
          nav_label: el("page-nav-label").value || null,
          nav_order: el("page-nav-order").value ? Number(el("page-nav-order").value) : null,
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

  el("duplicate-page-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    try {
      const res = await api(`/pages/${currentPage.id}/duplicate`, { method: "POST" });
      await loadPages();
      await selectPage(res.id);
    } catch (err) {
      alert(err.message);
    }
  });

  el("delete-page-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    if (!confirm(`Delete "${currentPage.title}" and all its blocks? This can't be undone.`)) return;
    await api(`/pages/${currentPage.id}`, { method: "DELETE" });
    currentPage = null;
    await loadPages();
  });

  el("lock-page-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    try {
      await api(`/pages/${currentPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: !currentPage.locked, expected_version: currentPage.version }),
      });
      await loadPages();
    } catch (err) {
      alert(err.message);
    }
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

  function blockLabel(type) {
    return { heading: "Heading", text: "Text", image: "Image", button: "Button", "project-card": "Project Card", "article-list": "Article List", video: "Video", quote: "Quote", gallery: "Gallery", simulation: "Simulation", scan: "3D Scan", divider: "Divider", spacer: "Spacer", links: "Links", html: "HTML / Embed", changelog: "Changelog / Now", embed: "Generic Embed" }[type] || type;
  }

  let simulationOptions = [];
  function simulationNameById(id) {
    const s = simulationOptions.find((x) => x.id === id);
    return s ? s.name : null;
  }

  let scanOptions = [];
  function scanNameById(id) {
    const s = scanOptions.find((x) => x.id === id);
    return s ? s.name : null;
  }

  function blockPreview(b) {
    const c = b.content || {};
    switch (b.type) {
      case "heading": return `<strong>${escapeHtml(c.text || "(empty)")}</strong>`;
      case "text": return escapeHtml((c.text || "").slice(0, 80) || "(empty)");
      case "image":
        return c.url
          ? `<img src="${escapeHtml(c.url)}" style="max-width:100%;max-height:60px;">${
              c.alt ? "" : `<span class="alt-text-warning" title="No alt text set — add one for accessibility and SEO">⚠ No alt text</span>`
            }`
          : "(no image url)";
      case "button": return `Button: ${escapeHtml(c.label || "(no label)")}`;
      case "project-card": return `<strong>${escapeHtml(c.title || "(untitled)")}</strong>`;
      case "article-list": return `Shows latest ${c.limit || 10} posts`;
      case "video": return c.url ? escapeHtml(c.url) : "(no video url)";
      case "embed": return c.url ? escapeHtml(c.url) : "(no embed url)";
      case "quote": return c.text ? `“${escapeHtml(c.text.slice(0, 60))}”` : "(empty)";
      case "gallery": return `${(c.images || []).length} image(s)`;
      case "simulation": return c.simulation_id ? escapeHtml(simulationNameById(c.simulation_id) || `#${c.simulation_id}`) : "(choose a simulation)";
      case "scan": return c.scan_id ? escapeHtml(scanNameById(c.scan_id) || `#${c.scan_id}`) : "(choose a scan)";
      case "divider": return "—";
      case "spacer": return "(spacer)";
      case "links": return `${(c.items || []).length} link(s)`;
      case "changelog": return `${(c.entries || []).length} entr${(c.entries || []).length === 1 ? "y" : "ies"}`;
      case "html": return c.html ? "(custom HTML)" : "(empty)";
      default: return "";
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    return d.innerHTML;
  }

  function renderCanvas() {
    canvas.innerHTML = "";
    let maxBottom = 600;
    for (const b of blocks) {
      const style = blockPixelStyle(b);
      maxBottom = Math.max(maxBottom, style.top + style.height + 100);
      const div = document.createElement("div");
      div.className =
        "admin-block" + (b.id === selectedBlockId ? " selected" : "") + (b.style && b.style.hidden ? " block-is-hidden" : "");
      div.style.left = style.left + "px";
      div.style.top = style.top + "px";
      div.style.width = style.width + "px";
      div.style.height = style.height + "px";
      div.dataset.id = b.id;
      div.innerHTML = `<div class="block-type-label">${blockLabel(b.type)}${
        b.shared_block_id ? ` <span class="lock-badge" title="Reusable block — editing it updates every page that uses it">Reusable</span>` : ""
      }</div><div class="block-preview">${blockPreview(b)}</div><div class="resize-handle"></div>`;
      canvas.appendChild(div);
      wireBlockInteractions(div, b);
    }
    canvas.style.minHeight = maxBottom + "px";
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

  function wireBlockInteractions(div, block) {
    div.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      selectedBlockId = block.id;
      renderInspector();
      document.querySelectorAll(".admin-block").forEach((d) => d.classList.remove("selected"));
      div.classList.add("selected");

      const startX = e.clientX;
      const startY = e.clientY;
      const startCol = block.col;
      const startRow = block.row;
      const { colW, rowH, gap } = canvasMetrics();
      div.setPointerCapture(e.pointerId);

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCol = Math.round(dx / (colW + gap));
        const dRow = Math.round(dy / (rowH + gap));
        const newCol = Math.min(Math.max(1, startCol + dCol), COLS - block.col_span + 1);
        const newRow = Math.max(1, startRow + dRow);
        if (newCol !== block.col || newRow !== block.row) {
          block.col = newCol;
          block.row = newRow;
          const style = blockPixelStyle(block);
          div.style.left = style.left + "px";
          div.style.top = style.top + "px";
        }
      }
      function onUp() {
        div.removeEventListener("pointermove", onMove);
        div.removeEventListener("pointerup", onUp);
        // No overlaps allowed: if the drop spot collides with another
        // block, snap back to where the drag started instead of saving it.
        if ((block.col !== startCol || block.row !== startRow) && wouldOverlap(block)) {
          block.col = startCol;
          block.row = startRow;
          const style = blockPixelStyle(block);
          div.style.left = style.left + "px";
          div.style.top = style.top + "px";
          flashRejected(div);
          return;
        }
        api(`/blocks/${block.id}`, {
          method: "PATCH",
          body: JSON.stringify({ col: block.col, row: block.row }),
        }).catch((err) => alert(err.message));
      }
      div.addEventListener("pointermove", onMove);
      div.addEventListener("pointerup", onUp);
    });

    const handle = div.querySelector(".resize-handle");
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      const startX = e.clientX;
      const startY = e.clientY;
      const startSpan = block.col_span;
      const startRowSpan = block.row_span;
      const { colW, rowH, gap } = canvasMetrics();
      handle.setPointerCapture(e.pointerId);

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCol = Math.round(dx / (colW + gap));
        const dRow = Math.round(dy / (rowH + gap));
        const newSpan = Math.min(Math.max(1, startSpan + dCol), COLS - block.col + 1);
        const newRowSpan = Math.max(1, startRowSpan + dRow);
        if (newSpan !== block.col_span || newRowSpan !== block.row_span) {
          block.col_span = newSpan;
          block.row_span = newRowSpan;
          const style = blockPixelStyle(block);
          div.style.width = style.width + "px";
          div.style.height = style.height + "px";
        }
      }
      function onUp() {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        if ((block.col_span !== startSpan || block.row_span !== startRowSpan) && wouldOverlap(block)) {
          block.col_span = startSpan;
          block.row_span = startRowSpan;
          const style = blockPixelStyle(block);
          div.style.width = style.width + "px";
          div.style.height = style.height + "px";
          flashRejected(div);
          return;
        }
        api(`/blocks/${block.id}`, {
          method: "PATCH",
          body: JSON.stringify({ col_span: block.col_span, row_span: block.row_span }),
        }).catch((err) => alert(err.message));
      }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  document.querySelectorAll(".palette-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!currentPage) return;
      const type = btn.dataset.type;
      const defaults = {
        heading: { content: { text: "New heading", level: 1 }, col_span: 24, row_span: 4 },
        text: { content: { text: "Write something here." }, col_span: 16, row_span: 6 },
        image: { content: { url: "", alt: "" }, col_span: 12, row_span: 12 },
        button: { content: { label: "Click me", url: "#", external: false }, col_span: 6, row_span: 2 },
        "project-card": { content: { title: "Project", description: "", url: "", label: "View" }, col_span: 12, row_span: 6 },
        "article-list": { content: { limit: 10 }, col_span: 24, row_span: 12 },
        // A full-width (24-col) simulation SVG at its 1500:700 aspect ratio,
        // plus the power button below it, renders taller than it looks like
        // it should need — row_span accounts for that so it doesn't overflow
        // into whatever comes after it (grid rows here are a fixed 16px+gap).
        simulation: { content: { simulation_id: null }, col_span: 24, row_span: 25 },
        // model-viewer is a fixed 420px tall (public/style.css) regardless of
        // its container width — row_span picked to roughly match that at a
        // typical column width so it doesn't look cramped or overflow by default.
        scan: { content: { scan_id: null }, col_span: 24, row_span: 22 },
        video: { content: { url: "" }, col_span: 16, row_span: 12 },
        embed: { content: { url: "" }, col_span: 16, row_span: 12 },
        quote: { content: { text: "Quote text here.", cite: "" }, col_span: 16, row_span: 6 },
        gallery: { content: { images: [] }, col_span: 24, row_span: 12 },
        links: { content: { items: [] }, col_span: 12, row_span: 6 },
        changelog: { content: { entries: [] }, col_span: 24, row_span: 16 },
        html: { content: { html: "<!-- your HTML here -->" }, col_span: 24, row_span: 8 },
        divider: { content: {}, col_span: 24, row_span: 2 },
        spacer: { content: {}, col_span: 24, row_span: 2 },
      }[type] || { content: {}, col_span: 12, row_span: 4 };

      const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
      const body = { type, col: 1, row: maxRow, ...defaults };
      try {
        await api(`/pages/${currentPage.id}/blocks`, { method: "POST", body: JSON.stringify(body) });
        await loadBlocks();
        if (isMobile()) closeDrawers();
      } catch (err) {
        alert(err.message);
      }
    });
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
    image: [{ key: "url", label: "Image URL", type: "image-url" }, { key: "alt", label: "Alt text", type: "text" }],
    button: [
      { key: "label", label: "Label", type: "text" },
      { key: "url", label: "URL", type: "text" },
      { key: "external", label: "Open in new tab", type: "checkbox" },
    ],
    "project-card": [
      { key: "title", label: "Title", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "url", label: "Link URL", type: "text" },
      { key: "label", label: "Link label", type: "text" },
      { key: "external", label: "Open in new tab", type: "checkbox" },
    ],
    "article-list": [{ key: "limit", label: "How many posts", type: "number" }, { key: "tag", label: "Only show this tag (blank = all)", type: "text" }],
    video: [{ key: "url", label: "YouTube or Vimeo URL", type: "text" }],
    embed: [{ key: "url", label: "Embed URL (CodePen, Spotify, Figma, CodeSandbox, GitHub Gist, or any iframe-able link)", type: "text" }],
    quote: [
      { key: "text", label: "Quote text", type: "textarea" },
      { key: "cite", label: "Attribution (optional)", type: "text" },
    ],
    gallery: [{ key: "images", label: "Images", type: "gallery-urls" }],
    links: [{ key: "items", label: "Links (one per line: Label | URL)", type: "link-list" }],
    changelog: [{ key: "entries", label: "Entries (one per line: YYYY-MM-DD | Title | Description)", type: "changelog-list" }],
    simulation: [{ key: "simulation_id", label: "Simulation", type: "simulation-select" }],
    scan: [{ key: "scan_id", label: "3D Scan", type: "scan-select" }],
    html: [{ key: "html", label: "Raw HTML (advanced — rendered as-is, unescaped; be careful what you paste here)", type: "textarea", noSpellcheck: true }],
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
    { key: "opacity", label: "Opacity (%)", type: "number" },
    { key: "borderWidth", label: "Border width (px)", type: "number" },
    { key: "borderColor", label: "Border color", type: "color" },
    { key: "borderRadius", label: "Border radius (px)", type: "number" },
    { key: "backgroundImage", label: "Background image", type: "image-url" },
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
    { key: "customCss", label: "Custom CSS (advanced — raw declarations, e.g. transform: rotate(-2deg);)", type: "textarea", noSpellcheck: true },
    { key: "hidden", label: "Hide from live site", type: "checkbox" },
  ];

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
      return `<label>${f.label}<input data-key="${f.key}" type="color" value="${escapeHtml(val || "#000000")}">${
        val ? `<button type="button" class="clear-color" data-key="${f.key}">Clear</button>` : ""
      }</label>`;
    }
    if (f.type === "image-url") {
      const fieldId = `${idPrefix}-${f.key}`;
      return `<label>${f.label}<input id="${fieldId}" data-key="${f.key}" type="text" spellcheck="false" value="${escapeHtml(
        val ?? ""
      )}"><button type="button" class="upload-trigger" data-target="#${fieldId}">Upload image</button> <button type="button" class="browse-trigger" data-target="#${fieldId}">Browse…</button></label>`;
    }
    if (f.type === "gallery-urls") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : []).join("\n");
      return `<label>${f.label} (one URL per line)<textarea id="${fieldId}" data-key="${f.key}" data-gallery="1" rows="5">${escapeHtml(
        text
      )}</textarea><button type="button" class="upload-trigger" data-target="#${fieldId}" data-append="1">Add image (upload)</button> <button type="button" class="browse-trigger" data-target="#${fieldId}" data-append="1">Add from library…</button></label>`;
    }
    if (f.type === "link-list") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : []).map((it) => `${it.label || ""} | ${it.url || ""}`).join("\n");
      return `<label>${f.label}<textarea id="${fieldId}" data-key="${f.key}" data-linklist="1" rows="5">${escapeHtml(text)}</textarea></label>`;
    }
    if (f.type === "changelog-list") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : [])
        .map((it) => `${it.date || ""} | ${it.title || ""} | ${it.description || ""}`)
        .join("\n");
      return `<label>${f.label}<textarea id="${fieldId}" data-key="${f.key}" data-changelog="1" rows="6">${escapeHtml(text)}</textarea></label>`;
    }
    if (f.type === "simulation-select") {
      const options = simulationOptions
        .map((s) => `<option value="${s.id}"${String(val ?? "") === String(s.id) ? " selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}" data-numeric="1"><option value="">— choose —</option>${
        options || "<option disabled>No simulations yet</option>"
      }</select> <button type="button" class="manage-simulations-btn">Manage simulations…</button></label>`;
    }
    if (f.type === "scan-select") {
      const options = scanOptions
        .map((s) => `<option value="${s.id}"${String(val ?? "") === String(s.id) ? " selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}" data-numeric="1"><option value="">— choose —</option>${
        options || "<option disabled>No scans yet</option>"
      }</select> <button type="button" class="manage-scans-btn">Manage scans…</button></label>`;
    }
    return `<label>${f.label}<input data-key="${f.key}" type="${f.type}" value="${escapeHtml(val ?? "")}"></label>`;
  }

  function fieldValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.type === "number") return input.value === "" ? null : Number(input.value);
    if (input.dataset.numeric) return input.value === "" ? null : Number(input.value);
    if (input.dataset.gallery) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean);
    }
    if (input.dataset.linklist) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, url] = line.split("|").map((s) => s.trim());
          return { label: label || url || "", url: url || label || "" };
        });
    }
    if (input.dataset.changelog) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [date, title, description] = line.split("|").map((s) => (s || "").trim());
          return { date: date || "", title: title || "", description: description || "" };
        });
    }
    return input.value;
  }

  function renderInspector() {
    const inspector = el("inspector");
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) {
      inspector.hidden = true;
      inspector.classList.remove("drawer-open");
      return;
    }
    inspector.hidden = false;
    if (isMobile()) openDrawer(inspector);
    el("block-save-status").textContent = "";

    if (!block.style) block.style = {};

    const banner = el("shared-block-banner");
    const saveAsSharedBtn = el("save-as-shared-block-btn");
    if (block.shared_block_id) {
      banner.hidden = false;
      banner.innerHTML = `<p class="shared-block-notice">Reusable block: <strong>${escapeHtml(
        block.shared_block_name || "Untitled"
      )}</strong> — editing it updates every page that uses it.</p><button type="button" id="detach-shared-block-btn">Detach (make independent)</button>`;
      el("detach-shared-block-btn").addEventListener("click", async () => {
        if (!confirm("Detach this block? It'll become an independent copy and stop updating when the reusable block changes.")) return;
        try {
          await api(`/blocks/${block.id}/detach`, { method: "POST" });
          await loadBlocks();
          selectedBlockId = block.id;
          renderCanvas();
          renderInspector();
        } catch (err) {
          alert(err.message);
        }
      });
      saveAsSharedBtn.hidden = true;
    } else {
      banner.hidden = true;
      banner.innerHTML = "";
      saveAsSharedBtn.hidden = false;
    }

    const fields = FIELD_DEFS[block.type] || [];
    const container = el("inspector-fields");
    container.innerHTML =
      fields.map((f) => fieldHtml(f, block.content[f.key], `field-${block.id}`)).join("") ||
      "<p style='color:var(--text-dim);font-size:0.85rem;'>No settings for this block.</p>";

    const styleContainer = el("inspector-style-fields");
    styleContainer.innerHTML = STYLE_FIELDS.map((f) => fieldHtml(f, block.style[f.key], `style-${block.id}`)).join("");

    container.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
    container.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
    container.querySelectorAll(".manage-simulations-btn").forEach((btn) => {
      btn.addEventListener("click", () => el("simulations-btn").click());
    });
    container.querySelectorAll(".manage-scans-btn").forEach((btn) => {
      btn.addEventListener("click", () => el("scans-btn").click());
    });

    function save() {
      renderCanvas();
      unsavedDirty = true;
      el("block-save-status").textContent = "Saving…";
      api(`/blocks/${block.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: block.content, style: block.style }),
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

    container.querySelectorAll("[data-key]").forEach((input) => {
      input.addEventListener("change", () => {
        block.content[input.dataset.key] = fieldValue(input);
        save();
      });
    });

    styleContainer.querySelectorAll("[data-key]").forEach((input) => {
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
  }

  el("save-as-shared-block-btn").addEventListener("click", async () => {
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    const name = prompt("Name this reusable block:");
    if (!name || !name.trim()) return;
    try {
      const res = await api("/shared-blocks", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), type: block.type, content: block.content, style: block.style }),
      });
      await api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ shared_block_id: res.id }) });
      await loadBlocks();
      selectedBlockId = block.id;
      renderCanvas();
      renderInspector();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Reusable blocks library ----------
  async function loadSharedBlocksList() {
    const sharedBlocks = await api("/shared-blocks");
    el("shared-blocks-list").innerHTML =
      sharedBlocks
        .map(
          (sb) =>
            `<div class="simulation-row"><span>${escapeHtml(sb.name)} <span class="lock-badge">${escapeHtml(
              blockLabel(sb.type)
            )}</span></span><button type="button" class="insert-shared-block" data-id="${
              sb.id
            }"${currentPage ? "" : " disabled title=\"Open a page first\""}>Insert onto current page</button><button type="button" class="delete-shared-block" data-id="${
              sb.id
            }">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No reusable blocks yet — select a block on a page and use \"Save as reusable block…\" in its settings.</p>";

    el("shared-blocks-list")
      .querySelectorAll(".insert-shared-block")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!currentPage) return;
          const sb = sharedBlocks.find((x) => x.id === Number(btn.dataset.id));
          const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
          try {
            await api(`/pages/${currentPage.id}/blocks`, {
              method: "POST",
              body: JSON.stringify({ type: sb.type, shared_block_id: sb.id, col: 1, col_span: 24, row: maxRow, row_span: 8 }),
            });
            await loadBlocks();
            el("shared-blocks-modal").hidden = true;
          } catch (err) {
            alert(err.message);
          }
        });
      });

    el("shared-blocks-list")
      .querySelectorAll(".delete-shared-block")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.id);
          const usage = await api(`/shared-blocks/usage?id=${id}`).catch(() => []);
          const msg = usage.length
            ? `Used on: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those placements become empty blocks.`
            : "Delete this reusable block? This can't be undone.";
          if (!confirm(msg)) return;
          await api(`/shared-blocks/${id}`, { method: "DELETE" });
          await loadSharedBlocksList();
        });
      });
  }

  el("shared-blocks-btn").addEventListener("click", async () => {
    el("shared-blocks-modal").hidden = false;
    await loadSharedBlocksList();
  });
  closeModalOnClick("close-shared-blocks", "shared-blocks-modal");

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
          style: block.style,
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

  el("delete-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    if (isMobile()) closeDrawers();
    await api(`/blocks/${selectedBlockId}`, { method: "DELETE" });
    await loadBlocks();
    showUndoToast("Block deleted.", async () => {
      await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: block.type,
          content: block.content,
          col: block.col,
          col_span: block.col_span,
          row: block.row,
          row_span: block.row_span,
        }),
      });
      await loadBlocks();
    });
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.target === canvas) {
      selectedBlockId = null;
      renderInspector();
      document.querySelectorAll(".admin-block").forEach((d) => d.classList.remove("selected"));
    }
  });

  // ---------- Articles ----------
  let articles = [];
  let currentArticleId = null;
  let currentArticleVersion = null;
  let currentArticleLocked = false;

  // Shared by the article and page-settings lock buttons.
  function updateLockButton(btnId, locked) {
    const btn = el(btnId);
    btn.textContent = locked ? "Unlock" : "Lock";
    btn.classList.toggle("is-locked", locked);
  }

  el("articles-btn").addEventListener("click", async () => {
    el("articles-modal").hidden = false;
    articles = await api("/articles");
    renderArticlesList();
    clearArticleForm();
  });
  closeModalOnClick("close-articles", "articles-modal");

  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:MM" in local time,
  // not the article's stored UTC ISO string.
  function isoToLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function articleStatusLabel(a) {
    if (!a.published_at) return " (draft)";
    if (a.published_at > new Date().toISOString()) return " (scheduled)";
    return "";
  }

  function articleLockBadge(a) {
    return a.locked ? ` <span class="lock-badge" title="Locked — protected from bulk actions and find-replace">Locked</span>` : "";
  }

  let selectedArticleIds = new Set();

  function updateBulkBar() {
    const n = selectedArticleIds.size;
    el("articles-selected-count").textContent = n ? `${n} selected` : "";
    el("bulk-publish-btn").disabled = !n;
    el("bulk-unpublish-btn").disabled = !n;
    el("bulk-trash-btn").disabled = !n;
    el("articles-select-all").checked = n > 0 && n === articles.length;
  }

  function renderArticlesList() {
    // Drop selected ids that no longer exist (trashed/deleted elsewhere).
    selectedArticleIds = new Set([...selectedArticleIds].filter((id) => articles.some((a) => a.id === id)));
    el("articles-list").innerHTML = articles
      .map(
        (a) =>
          `<div class="article-list-item${a.id === currentArticleId ? " active" : ""}" data-id="${a.id}"><input type="checkbox" class="article-select-checkbox" data-id="${a.id}"${
            selectedArticleIds.has(a.id) ? " checked" : ""
          }> ${escapeHtml(a.title)}${articleStatusLabel(a)}${articleLockBadge(a)}${
            a.tags && a.tags.length ? `<div class="article-list-tags">${a.tags.map(escapeHtml).join(", ")}</div>` : ""
          }</div>`
      )
      .join("");
    el("articles-list").querySelectorAll(".article-list-item").forEach((item) => {
      item.querySelector(".article-select-checkbox").addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(e.target.dataset.id);
        if (e.target.checked) selectedArticleIds.add(id);
        else selectedArticleIds.delete(id);
        updateBulkBar();
      });
      item.addEventListener("click", () => {
        const article = articles.find((a) => a.id === Number(item.dataset.id));
        populateArticleForm(article);
        renderArticlesList();
      });
    });
    updateBulkBar();
  }

  el("articles-select-all").addEventListener("change", (e) => {
    selectedArticleIds = e.target.checked ? new Set(articles.map((a) => a.id)) : new Set();
    renderArticlesList();
  });

  async function runBulkArticleAction(action) {
    if (!selectedArticleIds.size) return;
    const label = { publish: "Publish", unpublish: "Unpublish", trash: "Trash" }[action];
    if (!confirm(`${label} ${selectedArticleIds.size} article(s)?`)) return;
    try {
      const result = await api("/articles/bulk", { method: "POST", body: JSON.stringify({ ids: [...selectedArticleIds], action }) });
      selectedArticleIds = new Set();
      articles = await api("/articles");
      if (currentArticleId && !articles.some((a) => a.id === currentArticleId)) clearArticleForm();
      renderArticlesList();
      if (result.skippedLocked) {
        alert(`${result.affected} article(s) ${label.toLowerCase()}ed. ${result.skippedLocked} skipped because they're locked.`);
      }
    } catch (err) {
      alert(err.message);
    }
  }
  el("bulk-publish-btn").addEventListener("click", () => runBulkArticleAction("publish"));
  el("bulk-unpublish-btn").addEventListener("click", () => runBulkArticleAction("unpublish"));
  el("bulk-trash-btn").addEventListener("click", () => runBulkArticleAction("trash"));

  function populateArticleForm(article) {
    // Switching articles must drop any pending autosave for the PREVIOUS
    // one — otherwise it could fire after currentArticleId has moved on
    // and silently overwrite the article now being edited.
    clearTimeout(autosaveTimer);
    setAutosaveStatus("");
    currentArticleId = article.id;
    currentArticleVersion = article.version || null;
    currentArticleLocked = !!article.locked;
    updateLockButton("lock-article-btn", currentArticleLocked);
    el("article-title").value = article.title;
    el("article-slug").value = article.slug;
    el("article-tags").value = (article.tags || []).join(", ");
    el("article-series").value = article.series || "";
    el("article-series-order").value = article.series_order ?? "";
    el("article-co-authors").value = (article.co_authors || []).join(", ");
    el("article-og-image").value = article.og_image || "";
    el("article-body").value = article.body;
    el("article-published").checked = !!article.published_at;
    el("article-publish-at").value = isoToLocalInput(article.published_at);
    updateArticleExtras();
    checkArticleDraftRecovery(article.id);
  }

  // ---------- Article crash-recovery draft ----------
  // Raw DOM field values rather than buildArticleBody()'s cooked shape
  // (parsed tags array, resolved published_at) — much simpler to snapshot
  // and restore exactly as typed, and buildArticleBody() already handles
  // turning this back into a save payload when the restored draft is saved.
  const ARTICLE_DRAFT_FIELD_IDS = [
    "article-title", "article-slug", "article-tags", "article-series", "article-series-order",
    "article-co-authors", "article-og-image", "article-body", "article-published", "article-publish-at",
  ];
  function captureArticleRawFields() {
    const out = {};
    for (const id of ARTICLE_DRAFT_FIELD_IDS) {
      const input = el(id);
      out[id] = input.type === "checkbox" ? input.checked : input.value;
    }
    return out;
  }
  function applyArticleRawFields(fields) {
    for (const id of ARTICLE_DRAFT_FIELD_IDS) {
      if (!(id in fields)) continue;
      const input = el(id);
      if (input.type === "checkbox") input.checked = fields[id];
      else input.value = fields[id];
    }
    updateArticleExtras();
  }
  function snapshotArticleDraft() {
    saveDraft("article", currentArticleId, captureArticleRawFields());
  }
  // Called right after the form is populated (existing article) or cleared
  // (new article) — a draft that matches what's already showing is just
  // this-tab's own last save and gets cleared silently; one that differs
  // means something never made it to the server.
  function checkArticleDraftRecovery(articleId) {
    const draft = loadDraft("article", articleId);
    if (!draft) return;
    const current = JSON.stringify(captureArticleRawFields());
    if (JSON.stringify(draft.fields) === current) {
      clearDraft("article", articleId);
      return;
    }
    renderDraftRecoveryBanner("article-autosave-status", "article", articleId, draft, () => {
      applyArticleRawFields(draft.fields);
      clearDraft("article", articleId);
      scheduleAutosave();
    });
  }

  // Shows/hides the Preview and History controls, which only make sense
  // once an article has been saved (so it has a slug and a real id).
  function updateArticleExtras() {
    const slug = el("article-slug").value;
    const previewLink = el("preview-article-link");
    const historyBtn = el("article-history-btn");
    if (currentArticleId && slug) {
      previewLink.href = `/random/${slug}?preview=1`;
      previewLink.hidden = false;
      historyBtn.hidden = false;
    } else {
      previewLink.hidden = true;
      historyBtn.hidden = true;
    }
    updateWordCount();
    updateArticleOgPreview();
  }

  // Mirrors excerpt() in worker/render.js closely enough for a live preview
  // — doesn't need to be byte-exact, just give a realistic sense of length.
  function clientExcerpt(text, maxLen = 140) {
    const flat = String(text || "")
      .replace(/^#{2,3}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (flat.length <= maxLen) return flat;
    const cut = flat.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    return cut.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
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

  function updateArticleOgPreview() {
    updateOgPreview("article", {
      title: el("article-title").value,
      desc: clientExcerpt(el("article-body").value),
      image: el("article-og-image").value,
    });
  }

  ["page-title", "page-meta", "page-og-image"].forEach((id) => el(id).addEventListener("input", updatePageOgPreview));
  ["article-title", "article-body", "article-og-image"].forEach((id) => el(id).addEventListener("input", updateArticleOgPreview));

  // Matches the reading-time math in worker/render.js (200 words/min) so
  // what you see while writing matches what the published article shows.
  function updateWordCount() {
    const text = el("article-body").value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const mins = Math.max(1, Math.round(words / 200));
    el("article-word-count").textContent = `${words} word${words === 1 ? "" : "s"} · ${mins} min read`;
  }
  el("article-body").addEventListener("input", updateWordCount);

  function clearArticleForm() {
    clearTimeout(autosaveTimer);
    setAutosaveStatus("");
    currentArticleId = null;
    currentArticleVersion = null;
    currentArticleLocked = false;
    updateLockButton("lock-article-btn", false);
    el("article-title").value = "";
    el("article-slug").value = "";
    el("article-tags").value = "";
    el("article-series").value = "";
    el("article-series-order").value = "";
    el("article-co-authors").value = "";
    el("article-og-image").value = "";
    el("article-body").value = "";
    el("article-published").checked = false;
    el("article-publish-at").value = "";
    updateArticleExtras();
  }

  el("new-article").addEventListener("click", () => {
    clearArticleForm();
    checkArticleDraftRecovery(null);
  });

  function parseTags(str) {
    return str
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  function parseCoAuthors(str) {
    return str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildArticleBody() {
    const publishAtLocal = el("article-publish-at").value;
    const published = el("article-published").checked;
    const seriesOrder = el("article-series-order").value;
    return {
      title: el("article-title").value,
      slug: el("article-slug").value,
      tags: parseTags(el("article-tags").value),
      series: el("article-series").value.trim() || null,
      series_order: seriesOrder === "" ? null : Number(seriesOrder),
      co_authors: parseCoAuthors(el("article-co-authors").value),
      og_image: el("article-og-image").value || null,
      body: el("article-body").value,
      // A blank publish-at with "Published" checked means "now"; a filled
      // one schedules it (past or future). Unchecked always means draft.
      published_at: published ? (publishAtLocal ? new Date(publishAtLocal).toISOString() : new Date().toISOString()) : null,
    };
  }

  // Pulls the freshly re-fetched article's version into the client's
  // conflict-detection baseline — needed after every successful save, not
  // just on initial load, since this same tab's own next save would
  // otherwise "conflict" against its own prior write.
  function rebaseArticleVersion() {
    const a = articles.find((x) => x.id === currentArticleId);
    if (a) currentArticleVersion = a.version || null;
  }

  el("save-article").addEventListener("click", async () => {
    const body = buildArticleBody();
    if (!body.title) return alert("Title is required.");
    const isNewArticle = !currentArticleId;
    try {
      if (currentArticleId) {
        body.expected_version = currentArticleVersion;
        await api(`/articles/${currentArticleId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await api("/articles", { method: "POST", body: JSON.stringify(body) });
        currentArticleId = res.id;
        el("article-slug").value = res.slug;
      }
      unsavedDirty = false;
      clearDraft("article", isNewArticle ? null : currentArticleId);
      articles = await api("/articles");
      rebaseArticleVersion();
      updateArticleExtras();
      renderArticlesList();
      setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("article-autosave-status", () => {
          clearTimeout(autosaveTimer);
          const a = articles.find((x) => x.id === currentArticleId);
          if (a) populateArticleForm(a);
        });
        return;
      }
      alert(err.message);
    }
  });

  // ---------- Article autosave ----------
  // Only autosaves an article that already exists (has an id/slug) —
  // a brand new draft still needs an explicit first Save so its slug gets
  // created deliberately, not from whatever's been typed a few keystrokes in.
  let autosaveTimer = null;
  function setAutosaveStatus(text) {
    const el2 = document.getElementById("article-autosave-status");
    if (el2) el2.textContent = text;
  }
  async function autosaveArticle() {
    if (!currentArticleId) return;
    const body = buildArticleBody();
    if (!body.title) return;
    body.expected_version = currentArticleVersion;
    try {
      await api(`/articles/${currentArticleId}`, { method: "PATCH", body: JSON.stringify(body) });
      unsavedDirty = false;
      clearDraft("article", currentArticleId);
      articles = await api("/articles");
      rebaseArticleVersion();
      renderArticlesList();
      setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("article-autosave-status", () => {
          clearTimeout(autosaveTimer);
          const a = articles.find((x) => x.id === currentArticleId);
          if (a) populateArticleForm(a);
        });
        return;
      }
      setAutosaveStatus("Autosave failed: " + err.message);
    }
  }
  function scheduleAutosave() {
    snapshotArticleDraft();
    if (!currentArticleId) return;
    unsavedDirty = true;
    setAutosaveStatus("Unsaved changes…");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveArticle, 2000);
  }
  ["article-title", "article-tags", "article-series", "article-co-authors", "article-og-image", "article-body"].forEach((id) =>
    el(id).addEventListener("input", scheduleAutosave)
  );
  ["article-slug", "article-published", "article-publish-at", "article-series-order"].forEach((id) =>
    el(id).addEventListener("change", scheduleAutosave)
  );

  el("delete-article").addEventListener("click", async () => {
    if (!currentArticleId) return;
    if (!confirm("Delete this article?")) return;
    await api(`/articles/${currentArticleId}`, { method: "DELETE" });
    articles = await api("/articles");
    renderArticlesList();
    clearArticleForm();
  });

  el("lock-article-btn").addEventListener("click", async () => {
    if (!currentArticleId) return alert("Save the article first.");
    try {
      await api(`/articles/${currentArticleId}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: !currentArticleLocked, expected_version: currentArticleVersion }),
      });
      currentArticleLocked = !currentArticleLocked;
      updateLockButton("lock-article-btn", currentArticleLocked);
      articles = await api("/articles");
      rebaseArticleVersion();
      renderArticlesList();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Media library ----------
  let mediaPickTarget = null;
  let mediaPickAppend = false;
  let mediaItems = [];
  let selectedMediaKeys = new Set();

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function usageSummary(url) {
    try {
      const usage = await api(`/media/usage?url=${encodeURIComponent(url)}`);
      if (!usage.length) return "Not used anywhere — safe to delete.";
      return "Used in:\n" + usage.map((u) => `- ${u.type}${u.title ? `: "${u.title}"` : ""}`).join("\n");
    } catch {
      return "";
    }
  }

  function updateMediaBulkBar() {
    const n = selectedMediaKeys.size;
    el("media-selected-count").textContent = n ? `${n} selected` : "";
    el("media-bulk-delete-btn").disabled = !n;
  }

  function renderMediaGrid() {
    const folderFilter = el("media-folder-filter").value;
    const search = el("media-search").value.trim().toLowerCase();
    const filtered = mediaItems.filter((item) => {
      if (folderFilter && item.folder !== folderFilter) return false;
      if (!search) return true;
      const filename = item.key.split("/").pop().toLowerCase();
      return filename.includes(search) || item.tags.some((t) => t.toLowerCase().includes(search));
    });

    el("media-grid").innerHTML =
      filtered
        .map(
          (item) =>
            `<div class="media-item" data-url="${escapeHtml(item.url)}" data-key="${escapeHtml(item.key)}" title="${formatBytes(
              item.size
            )}"><img src="${escapeHtml(item.url)}" loading="lazy" alt="${escapeHtml(item.alt_text || "")}"><button type="button" class="media-edit" data-url="${escapeHtml(
              item.url
            )}" data-key="${escapeHtml(item.key)}" title="Edit image">✎</button><button type="button" class="media-delete" data-key="${escapeHtml(
              item.key
            )}" title="Delete">×</button><div class="media-item-bottom"><input type="checkbox" class="media-select-checkbox" data-key="${escapeHtml(
              item.key
            )}"${selectedMediaKeys.has(item.key) ? " checked" : ""}><span class="media-folder-badge">${escapeHtml(
              item.folder || ""
            )}</span><button type="button" class="media-info" data-key="${escapeHtml(item.key)}" title="Folder / tags / alt text">🏷</button></div></div>`
        )
        .join("") || "<p style='color:var(--text-dim);'>No uploads match.</p>";

    el("media-grid")
      .querySelectorAll(".media-item")
      .forEach((div) => {
        div.addEventListener("click", (e) => {
          if (e.target.closest(".media-delete, .media-edit, .media-info, .media-select-checkbox")) return;
          if (!mediaPickTarget) return;
          const input = document.querySelector(mediaPickTarget);
          if (input) {
            setFieldUrl(input, div.dataset.url, mediaPickAppend);
            // An image block's url/alt fields are named "...-url"/"...-alt" —
            // suggest this file's saved alt text if that alt field is blank.
            const item = mediaItems.find((m) => m.url === div.dataset.url);
            const altInput = item && item.alt_text && input.id.endsWith("-url") ? document.getElementById(input.id.replace(/-url$/, "-alt")) : null;
            if (altInput && !altInput.value) altInput.value = item.alt_text;
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
          updateMediaBulkBar();
        });
      });

    el("media-grid")
      .querySelectorAll(".media-edit")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (window.PhotoEditor) window.PhotoEditor.open(btn.dataset.url, btn.dataset.key);
        });
      });

    el("media-grid")
      .querySelectorAll(".media-info")
      .forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const item = mediaItems.find((m) => m.key === btn.dataset.key);
          if (!item) return;
          const folder = prompt("Folder (blank = none):", item.folder || "");
          if (folder === null) return;
          const tagsStr = prompt("Tags, comma separated:", item.tags.join(", "));
          if (tagsStr === null) return;
          const altText = prompt("Alt text (used as a default when you insert this image):", item.alt_text || "");
          if (altText === null) return;
          try {
            await api(`/media/${item.key}`, {
              method: "PATCH",
              body: JSON.stringify({
                folder: folder.trim() || null,
                tags: tagsStr.split(",").map((t) => t.trim()).filter(Boolean),
                alt_text: altText.trim() || null,
              }),
            });
            await loadMediaLibrary();
          } catch (err) {
            alert(err.message);
          }
        });
      });

    el("media-grid")
      .querySelectorAll(".media-delete")
      .forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const item = mediaItems.find((m) => m.key === btn.dataset.key);
          const usage = item ? await usageSummary(item.url) : "";
          if (!confirm(`Delete this file? This can't be undone.\n\n${usage}`)) return;
          try {
            await api(`/media/${btn.dataset.key}`, { method: "DELETE" });
            selectedMediaKeys.delete(btn.dataset.key);
            await loadMediaLibrary();
          } catch (err) {
            alert(err.message);
          }
        });
      });
  }

  async function loadMediaLibrary() {
    mediaItems = await api("/media");
    selectedMediaKeys = new Set([...selectedMediaKeys].filter((k) => mediaItems.some((m) => m.key === k)));
    const folders = await api("/media/folders").catch(() => []);
    const currentFilter = el("media-folder-filter").value;
    const folderOptionsHtml = folders.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
    el("media-folder-filter").innerHTML = `<option value="">All folders</option>${folderOptionsHtml}`;
    el("media-folder-filter").value = folders.includes(currentFilter) ? currentFilter : "";
    el("media-upload-folder").innerHTML = `<option value="">No folder</option>${folderOptionsHtml}<option value="__new__">+ New folder…</option>`;
    renderMediaGrid();
    updateMediaBulkBar();
  }

  el("media-folder-filter").addEventListener("change", renderMediaGrid);
  el("media-search").addEventListener("input", renderMediaGrid);

  el("media-upload-folder").addEventListener("change", (e) => {
    if (e.target.value !== "__new__") return;
    const name = (prompt("New folder name:") || "").trim();
    if (!name) {
      e.target.value = "";
      return;
    }
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    opt.selected = true;
    e.target.insertBefore(opt, e.target.lastElementChild);
  });

  const mediaUploadInput = document.createElement("input");
  mediaUploadInput.type = "file";
  mediaUploadInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  mediaUploadInput.multiple = true;
  mediaUploadInput.hidden = true;
  el("media-upload-btn").after(mediaUploadInput);
  el("media-upload-btn").addEventListener("click", () => mediaUploadInput.click());
  mediaUploadInput.addEventListener("change", async () => {
    const files = Array.from(mediaUploadInput.files);
    if (!files.length) return;
    const folder = el("media-upload-folder").value === "__new__" ? "" : el("media-upload-folder").value;
    const btn = el("media-upload-btn");
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Uploading ${i + 1}/${files.length}…`;
        await uploadFile(files[i], folder);
      }
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
      mediaUploadInput.value = "";
    }
  });

  el("media-bulk-delete-btn").addEventListener("click", async () => {
    if (!selectedMediaKeys.size) return;
    if (!confirm(`Permanently delete ${selectedMediaKeys.size} file(s)? This can't be undone.`)) return;
    try {
      await api("/media/bulk-delete", { method: "POST", body: JSON.stringify({ keys: [...selectedMediaKeys] }) });
      selectedMediaKeys = new Set();
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

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

  // ---------- Redirects ----------
  async function loadRedirects() {
    const redirects = await api("/redirects");
    el("redirects-list").innerHTML =
      redirects
        .map(
          (r) =>
            `<div class="redirect-row" data-id="${r.id}"><span class="redirect-paths">${escapeHtml(r.from_path)} → ${escapeHtml(
              r.to_path
            )}</span><span class="redirect-code">${r.status_code}</span><button type="button" class="delete-redirect" data-id="${
              r.id
            }">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No redirects yet.</p>";

    el("redirects-list")
      .querySelectorAll(".delete-redirect")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this redirect?")) return;
          await api(`/redirects/${btn.dataset.id}`, { method: "DELETE" });
          await loadRedirects();
        });
      });
  }

  el("redirects-btn").addEventListener("click", async () => {
    el("redirects-modal").hidden = false;
    await loadRedirects();
  });
  closeModalOnClick("close-redirects", "redirects-modal");

  el("add-redirect-btn").addEventListener("click", async () => {
    const from_path = el("redirect-from").value.trim();
    const to_path = el("redirect-to").value.trim();
    if (!from_path || !to_path) return alert("Both fields are required.");
    try {
      await api("/redirects", {
        method: "POST",
        body: JSON.stringify({ from_path, to_path, status_code: Number(el("redirect-status").value) }),
      });
      el("redirect-from").value = "";
      el("redirect-to").value = "";
      await loadRedirects();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Trash ----------
  function renderTrashList(elId, items, kind, basePath) {
    el(elId).innerHTML =
      items
        .map(
          (item) =>
            `<div class="redirect-row" data-id="${item.id}"><span class="redirect-paths">${escapeHtml(item.title)}</span><button type="button" class="restore-trash-item" data-id="${item.id}">Restore</button><button type="button" class="danger delete-trash-item" data-id="${item.id}">Delete forever</button></div>`
        )
        .join("") || `<p style='color:var(--text-dim);font-size:0.85rem;'>Nothing trashed.</p>`;

    el(elId)
      .querySelectorAll(".restore-trash-item")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`${basePath}/${btn.dataset.id}/restore`, { method: "POST" });
          await loadTrash();
          if (kind === "page") await loadPages();
        });
      });
    el(elId)
      .querySelectorAll(".delete-trash-item")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm(`Permanently delete this ${kind}? This can't be undone.`)) return;
          await api(`${basePath}/${btn.dataset.id}/permanent`, { method: "DELETE" });
          await loadTrash();
        });
      });
  }

  async function loadTrash() {
    const [pages, articles] = await Promise.all([api("/pages/trash"), api("/articles/trash")]);
    renderTrashList("trash-pages-list", pages, "page", "/pages");
    renderTrashList("trash-articles-list", articles, "article", "/articles");
  }

  el("trash-btn").addEventListener("click", async () => {
    el("trash-modal").hidden = false;
    await loadTrash();
  });
  closeModalOnClick("close-trash", "trash-modal");

  // ---------- Site settings ----------
  el("site-settings-btn").addEventListener("click", async () => {
    const settings = await api("/settings");
    el("settings-og-image").value = settings.default_og_image || "";
    el("settings-accent").value = settings.theme_accent || "#e8a13a";
    el("settings-bg").value = settings.theme_bg || "#0b0b0c";
    el("settings-font").value = settings.theme_font || "";
    el("settings-footer").value = settings.site_footer || "";
    el("settings-custom-head").value = settings.custom_head || "";
    el("settings-webhook-url").value = settings.webhook_url || "";
    el("link-check-results").innerHTML = "";
    el("find-replace-results").innerHTML = "";
    el("find-replace-apply-btn").disabled = true;
    el("settings-modal").hidden = false;
    loadActivityLog().catch(() => {});
    loadErrors().catch(() => {});
    loadScheduledBackups().catch(() => {});
  });
  closeModalOnClick("close-settings", "settings-modal");
  el("save-settings").addEventListener("click", async () => {
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          default_og_image: el("settings-og-image").value,
          theme_accent: el("settings-accent").value,
          theme_bg: el("settings-bg").value,
          theme_font: el("settings-font").value,
          site_footer: el("settings-footer").value,
          custom_head: el("settings-custom-head").value,
          webhook_url: el("settings-webhook-url").value,
        }),
      });
      el("settings-modal").hidden = true;
    } catch (err) {
      alert(err.message);
    }
  });

  el("check-links-btn").addEventListener("click", async () => {
    const btn = el("check-links-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const results = await api("/link-check");
      el("link-check-results").innerHTML =
        results
          .map(
            (r) =>
              `<div class="link-check-row ${r.ok === false ? "broken" : r.ok ? "ok" : ""}"><span class="link-check-url">${escapeHtml(
                r.url
              )}</span><span class="link-check-source">${escapeHtml(r.source)}</span><span class="link-check-status">${escapeHtml(
                r.status
              )}</span></div>`
          )
          .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No links found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // ---------- Find & replace ----------
  function findReplaceResultLabel(r) {
    if (r.kind === "block") return `${blockLabel(r.blockType)} block on page "${r.pageTitle}"`;
    return `Article "${r.articleTitle}" (${r.fields.join(", ")})`;
  }

  async function runFindReplaceUi(apply) {
    const find = el("find-replace-find").value;
    if (!find) return alert("Enter text to find.");
    const replace = el("find-replace-replace").value;
    if (apply && !confirm(`Replace every match of "${find}" with "${replace}"? Each affected page/article is snapshotted first, so this is undoable via History.`)) {
      return;
    }
    const btn = apply ? el("find-replace-apply-btn") : el("find-replace-preview-btn");
    const originalText = btn.textContent;
    btn.textContent = apply ? "Applying…" : "Searching…";
    btn.disabled = true;
    try {
      const { results } = await api("/find-replace", { method: "POST", body: JSON.stringify({ find, replace, apply }) });
      el("find-replace-results").innerHTML =
        results.map((r) => `<div class="link-check-row">${escapeHtml(findReplaceResultLabel(r))}</div>`).join("") ||
        "<p style='color:var(--text-dim);font-size:0.85rem;'>No matches.</p>";
      el("find-replace-apply-btn").disabled = apply || !results.length;
      if (apply) {
        articles = await api("/articles");
        renderArticlesList();
        if (currentPage) await loadBlocks();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = apply ? el("find-replace-apply-btn").disabled : false;
    }
  }
  el("find-replace-preview-btn").addEventListener("click", () => runFindReplaceUi(false));
  el("find-replace-apply-btn").addEventListener("click", () => runFindReplaceUi(true));

  // ---------- Activity log ----------
  function activityLabel(a) {
    const verb = { "create": "Created", "update": "Updated", "trash": "Trashed", "restore": "Restored", "delete-forever": "Permanently deleted",
      "duplicate": "Duplicated", "publish": "Published", "unpublish": "Unpublished", "upload": "Uploaded", "delete": "Deleted",
      "import": "Restored backup", "find-replace": "Find & replace", "restore-revision": "Restored a revision" }[a.action] || a.action;
    return `${verb} ${a.entity_type}${a.entity_label ? `: ${a.entity_label}` : ""}`;
  }

  async function loadActivityLog() {
    const items = await api("/activity?limit=100");
    el("activity-log-list").innerHTML =
      items
        .map(
          (a) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(activityLabel(a))}</span><span class="link-check-source">${escapeHtml(
              new Date(a.created_at.replace(" ", "T") + "Z").toLocaleString()
            )}</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>Nothing logged yet.</p>";
  }
  el("load-activity-btn").addEventListener("click", () => loadActivityLog().catch((err) => alert(err.message)));

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
    const items = await api("/scheduled-backups");
    el("scheduled-backups-list").innerHTML =
      items
        .map(
          (b) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(b.key.replace("backups/", ""))}</span><span class="link-check-source">${formatBytes(
              b.size
            )}</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No backups yet.</p>";
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
  // A simple word-level LCS diff — fine for typical article lengths. Capped
  // so a huge body can't hang the tab computing an O(m*n) table.
  function diffWords(oldText, newText) {
    const oldWords = String(oldText || "").split(/(\s+)/);
    const newWords = String(newText || "").split(/(\s+)/);
    const m = oldWords.length;
    const n = newWords.length;
    if (m * n > 400000) return null;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = oldWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const result = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (oldWords[i] === newWords[j]) {
        result.push({ type: "same", text: oldWords[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: "del", text: oldWords[i] });
        i++;
      } else {
        result.push({ type: "add", text: newWords[j] });
        j++;
      }
    }
    while (i < m) { result.push({ type: "del", text: oldWords[i] }); i++; }
    while (j < n) { result.push({ type: "add", text: newWords[j] }); j++; }
    return result;
  }

  function diffWordsHtml(oldText, newText) {
    const diff = diffWords(oldText, newText);
    if (!diff) return "<p style='color:var(--text-dim);font-size:0.85rem;'>Too large to diff word-by-word — showing versions side by side isn't available here; restore to see the full old version.</p>";
    return `<p class="revision-diff-text">${diff
      .map((d) => {
        const text = escapeHtml(d.text);
        if (d.type === "add") return `<ins>${text}</ins>`;
        if (d.type === "del") return `<del>${text}</del>`;
        return text;
      })
      .join("")}</p>`;
  }

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
    if (kind === "article") {
      const current = articles.find((a) => a.id === entityId);
      el("revisions-diff-body").innerHTML = diffWordsHtml(rev.snapshot.body, current ? current.body : "");
    } else {
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
            if (kind === "page") {
              await loadBlocks();
            } else {
              articles = await api("/articles");
              const a = articles.find((x) => x.id === entityId);
              if (a) populateArticleForm(a);
              renderArticlesList();
            }
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
  el("article-history-btn").addEventListener("click", () => {
    if (currentArticleId) openRevisions("article", currentArticleId);
  });

  // ---------- Command palette (Ctrl/Cmd+K) ----------
  let commandItems = [];
  let commandActiveIndex = 0;

  function quickActions() {
    const actions = [
      { label: "Add new page", sub: "", run: () => { closeCommandPalette(); el("new-page-btn").click(); } },
      { label: "Open Articles", sub: "", run: () => { closeCommandPalette(); el("articles-btn").click(); } },
      { label: "Open Media Library", sub: "", run: () => { closeCommandPalette(); el("media-btn").click(); } },
      { label: "Open Redirects", sub: "", run: () => { closeCommandPalette(); el("redirects-btn").click(); } },
      { label: "Open Analytics", sub: "", run: () => { closeCommandPalette(); el("analytics-btn").click(); } },
      { label: "Open Simulations", sub: "", run: () => { closeCommandPalette(); el("simulations-btn").click(); } },
      { label: "Open Scans", sub: "", run: () => { closeCommandPalette(); el("scans-btn").click(); } },
      { label: "Open Reusable Blocks", sub: "", run: () => { closeCommandPalette(); el("shared-blocks-btn").click(); } },
      { label: "Open Trash", sub: "", run: () => { closeCommandPalette(); el("trash-btn").click(); } },
      { label: "Open Site Settings", sub: "", run: () => { closeCommandPalette(); el("site-settings-btn").click(); } },
      {
        label: "Open Activity Log",
        sub: "",
        run: () => {
          closeCommandPalette();
          el("site-settings-btn").click();
          // The settings-btn handler is async (fetches settings + the log
          // before un-hiding the modal) — scrolling/focusing has to wait
          // until it's actually visible, not fire synchronously after click().
          setTimeout(() => el("activity-log-list").scrollIntoView({ behavior: "smooth" }), 200);
        },
      },
      {
        label: "Find & Replace",
        sub: "",
        run: () => {
          closeCommandPalette();
          el("site-settings-btn").click();
          setTimeout(() => el("find-replace-find").focus(), 200);
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
    return actions;
  }

  async function openArticleEditorById(id) {
    el("articles-modal").hidden = false;
    articles = await api("/articles");
    const article = articles.find((a) => a.id === id);
    if (article) populateArticleForm(article);
    renderArticlesList();
  }

  async function goToBlock(pageId, blockId) {
    await selectPage(pageId);
    selectedBlockId = blockId;
    renderCanvas();
    renderInspector();
    if (isMobile()) openDrawer(el("inspector"));
  }

  function setCommandActive(index) {
    commandActiveIndex = index;
    el("command-results")
      .querySelectorAll(".command-result")
      .forEach((row, i) => row.classList.toggle("active", i === index));
  }

  function renderCommandResults(items) {
    commandItems = items;
    commandActiveIndex = 0;
    el("command-results").innerHTML = items.length
      ? items
          .map(
            (it, i) =>
              `<div class="command-result${i === 0 ? " active" : ""}" data-index="${i}"><span>${escapeHtml(
                it.label
              )}</span><span class="command-result-sub">${escapeHtml(it.sub || "")}</span></div>`
          )
          .join("")
      : "<p class='command-empty'>No results.</p>";
    el("command-results")
      .querySelectorAll(".command-result")
      .forEach((row) => {
        row.addEventListener("click", () => commandItems[Number(row.dataset.index)].run());
        row.addEventListener("mousemove", () => setCommandActive(Number(row.dataset.index)));
      });
  }

  let commandSearchTimer = null;
  function runCommandSearch(q) {
    const localMatches = q ? quickActions().filter((a) => a.label.toLowerCase().includes(q.toLowerCase())) : quickActions();
    renderCommandResults(localMatches);
    if (!q) return;
    clearTimeout(commandSearchTimer);
    commandSearchTimer = setTimeout(async () => {
      try {
        const results = await api(`/search?q=${encodeURIComponent(q)}`);
        const items = [...localMatches];
        results.pages.forEach((p) =>
          items.push({
            label: `Page: ${p.title}`,
            sub: `/${p.slug}`,
            run: () => {
              closeCommandPalette();
              selectPage(p.id);
            },
          })
        );
        results.articles.forEach((a) =>
          items.push({
            label: `Article: ${a.title}`,
            sub: a.published_at ? "" : "(draft)",
            run: () => openArticleEditorById(a.id),
          })
        );
        results.blocks.forEach((b) =>
          items.push({
            label: `Block: ${blockLabel(b.type)}`,
            sub: `page #${b.page_id}`,
            run: () => goToBlock(b.page_id, b.id),
          })
        );
        renderCommandResults(items);
      } catch {
        // leave the local matches showing
      }
    }, 200);
  }

  function openCommandPalette() {
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
  el("command-input").addEventListener("input", (e) => runCommandSearch(e.target.value.trim()));
  el("command-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
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
      if (
        !confirm(
          "This will REPLACE every page, block, article, and setting with what's in this file. This can't be undone. Continue?"
        )
      ) {
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await api("/import", { method: "POST", body: JSON.stringify(data) });
        alert("Restored. Reloading…");
        location.reload();
      } catch (err) {
        alert("Restore failed: " + err.message);
      }
    });
    input.click();
  });

  // ---------- Analytics ----------
  let analyticsRange = 7;
  let lastAnalyticsData = null;

  async function loadAnalytics() {
    const data = await api(`/analytics?days=${analyticsRange}`);
    lastAnalyticsData = data;
    el("stat-active").textContent = data.activeNow;
    el("stat-today").textContent = data.today;
    el("stat-7d").textContent = data.last7;
    el("stat-30d").textContent = data.last30;
    el("stat-all").textContent = data.allTime;

    const max = Math.max(1, ...data.byDay.map((d) => d.n));
    el("analytics-chart").innerHTML = data.byDay
      .map((d) => {
        const pct = Math.round((d.n / max) * 100);
        const label = d.day.slice(5); // MM-DD
        return `<div class="chart-bar-wrap" title="${d.day}: ${d.n}"><div class="chart-bar" style="height:${pct}%"></div><div class="chart-bar-label">${label}</div></div>`;
      })
      .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No data yet.</p>";

    const renderList = (id, rows, keyName) =>
      (el(id).innerHTML =
        rows.map((r) => `<div class="analytics-row"><span>${escapeHtml(r[keyName])}</span><span>${r.n}</span></div>`).join("") ||
        "<p style='color:var(--text-dim);font-size:0.85rem;'>No data yet.</p>");

    renderList("analytics-pages", data.topPaths, "path");
    renderList("analytics-referrers", data.topReferrers, "referrer");
    renderList("analytics-countries", data.topCountries, "country");
    renderList("analytics-events", data.topEvents, "name");
  }

  el("analytics-btn").addEventListener("click", async () => {
    el("analytics-modal").hidden = false;
    await loadAnalytics();
  });
  closeModalOnClick("close-analytics", "analytics-modal");

  // Builds one CSV with a section per breakdown, rather than a single flat
  // table — the shapes (day/count, path/count, referrer/count) don't share
  // columns, and a human is going to open this in a spreadsheet, not parse it.
  function toCsvRow(cells) {
    return cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",") + "\r\n";
  }

  el("export-analytics-btn").addEventListener("click", () => {
    if (!lastAnalyticsData) return;
    const data = lastAnalyticsData;
    let csv = toCsvRow(["Summary"]);
    csv += toCsvRow(["Today", data.today]);
    csv += toCsvRow(["Last 7 days", data.last7]);
    csv += toCsvRow(["Last 30 days", data.last30]);
    csv += toCsvRow(["All time", data.allTime]);
    csv += "\r\n" + toCsvRow(["Views per day"]) + toCsvRow(["Day", "Views"]);
    data.byDay.forEach((r) => (csv += toCsvRow([r.day, r.n])));
    csv += "\r\n" + toCsvRow(["Top pages"]) + toCsvRow(["Path", "Views"]);
    data.topPaths.forEach((r) => (csv += toCsvRow([r.path, r.n])));
    csv += "\r\n" + toCsvRow(["Top referrers"]) + toCsvRow(["Referrer", "Views"]);
    data.topReferrers.forEach((r) => (csv += toCsvRow([r.referrer, r.n])));
    csv += "\r\n" + toCsvRow(["Top countries"]) + toCsvRow(["Country", "Views"]);
    data.topCountries.forEach((r) => (csv += toCsvRow([r.country, r.n])));
    csv += "\r\n" + toCsvRow(["Top events"]) + toCsvRow(["Event", "Count"]);
    data.topEvents.forEach((r) => (csv += toCsvRow([r.name, r.n])));

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${analyticsRange}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  document.querySelectorAll(".range-btn").forEach((btn) => {
    if (Number(btn.dataset.days) === analyticsRange) btn.classList.add("active");
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      analyticsRange = Number(btn.dataset.days);
      await loadAnalytics();
    });
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

    if (mod && e.key.toLowerCase() === "s") {
      e.preventDefault();
      if (!el("articles-modal").hidden) el("save-article").click();
      else if (!el("settings-modal").hidden) el("save-settings").click();
      else if (currentPage) el("save-page-settings").click();
      return;
    }

    if (isTyping || app.hidden) return;

    if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId) {
      e.preventDefault();
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

  // ---------- Templates ----------
  const templateOptions = { page: [], article: [] };

  async function loadTemplates(kind) {
    try {
      templateOptions[kind] = await api(`/templates?kind=${kind}`);
    } catch {
      templateOptions[kind] = [];
    }
    const picker = el(kind === "page" ? "page-template-picker" : "article-template-picker");
    const blankLabel = kind === "page" ? "Blank page" : "Start blank";
    picker.innerHTML =
      `<option value="">${blankLabel}</option>` +
      templateOptions[kind].map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  }

  el("save-page-template-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    const name = prompt("Template name:");
    if (!name) return;
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({ kind: "page", name, data: { blocks } }),
      });
      await loadTemplates("page");
    } catch (err) {
      alert(err.message);
    }
  });

  el("save-article-template-btn").addEventListener("click", async () => {
    const name = prompt("Template name:");
    if (!name) return;
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({ kind: "article", name, data: { body: el("article-body").value } }),
      });
      await loadTemplates("article");
    } catch (err) {
      alert(err.message);
    }
  });

  el("article-template-picker").addEventListener("change", (e) => {
    const id = Number(e.target.value);
    e.target.value = "";
    if (!id) return;
    const t = templateOptions.article.find((x) => x.id === id);
    if (!t) return;
    el("article-body").value = t.data.body || "";
    updateWordCount();
    updateArticleOgPreview();
    scheduleAutosave();
  });

  // ---------- Boot ----------
  async function loadSimulationOptions() {
    try {
      simulationOptions = await api("/simulations");
    } catch {
      simulationOptions = [];
    }
    renderInspector();
  }

  async function loadScanOptions() {
    try {
      scanOptions = await api("/scans");
    } catch {
      scanOptions = [];
    }
    renderInspector();
  }

  async function boot() {
    const { authenticated } = await fetch("/api/admin/me").then((r) => r.json());
    if (!authenticated) {
      showLogin();
      return;
    }
    showApp();
    await loadPages();
    await loadSimulationOptions();
    await loadScanOptions();
    await loadTemplates("page");
    await loadTemplates("article");
  }

  document.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
  document.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);

  // Shared with photo-editor.js and simulation-builder.js, which are loaded
  // as separate plain scripts (not modules) and can't import from this IIFE.
  window.adminApi = api;
  window.adminUploadBlob = uploadFile;
  window.refreshMediaLibrary = loadMediaLibrary;
  window.refreshSimulationOptions = loadSimulationOptions;
  window.refreshScanOptions = loadScanOptions;

  window.addEventListener("resize", () => renderCanvas());
  boot();
})();
