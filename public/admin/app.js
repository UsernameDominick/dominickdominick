(function () {
  "use strict";

  const COLS = 12;
  const ROW_H = 32;
  const GAP = 16;

  const el = (id) => document.getElementById(id);
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
    backdrop.hidden = true;
  }
  el("mobile-menu-btn").addEventListener("click", () => openDrawer(el("palette")));
  el("close-palette").addEventListener("click", closeDrawers);
  el("close-inspector").addEventListener("click", closeDrawers);
  backdrop.addEventListener("click", closeDrawers);

  let pages = [];
  let currentPage = null;
  let blocks = [];
  let selectedBlockId = null;

  async function uploadFile(file) {
    const res = await fetch("/api/admin/upload", {
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

  // Wires any <button class="upload-trigger" data-target="#id"> to open a file
  // picker and fill the target input with the uploaded file's URL.
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
        targetInput.value = url;
        targetInput.dispatchEvent(new Event("change", { bubbles: true }));
      } catch (err) {
        alert(err.message);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        fileInput.value = "";
      }
    });
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
      throw new Error(body.error || "Request failed");
    }
    return res.status === 204 ? null : res.json();
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
    await loadBlocks();
  }

  el("page-picker").addEventListener("change", (e) => selectPage(Number(e.target.value)));

  el("new-page-btn").addEventListener("click", async () => {
    const title = prompt("Page title:");
    if (!title) return;
    try {
      const res = await api("/pages", { method: "POST", body: JSON.stringify({ title }) });
      await loadPages();
      const created = pages.find((p) => p.id === res.id);
      if (created) await selectPage(created.id);
    } catch (err) {
      alert(err.message);
    }
  });

  el("save-page-settings").addEventListener("click", async () => {
    if (!currentPage) return;
    try {
      await api(`/pages/${currentPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: el("page-title").value,
          meta_description: el("page-meta").value,
          nav_label: el("page-nav-label").value || null,
          nav_order: el("page-nav-order").value ? Number(el("page-nav-order").value) : null,
          og_image: el("page-og-image").value || null,
        }),
      });
      await loadPages();
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

  // ---------- Blocks ----------
  async function loadBlocks() {
    blocks = await api(`/pages/${currentPage.id}/blocks`);
    selectedBlockId = null;
    renderCanvas();
    renderInspector();
  }

  function canvasMetrics() {
    const rect = canvas.getBoundingClientRect();
    const colW = (rect.width - (COLS - 1) * GAP) / COLS;
    return { colW, rowH: ROW_H, gap: GAP, width: rect.width };
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
    return { heading: "Heading", text: "Text", image: "Image", button: "Button", "project-card": "Project Card", "article-list": "Article List", divider: "Divider", spacer: "Spacer", links: "Links" }[type] || type;
  }

  function blockPreview(b) {
    const c = b.content || {};
    switch (b.type) {
      case "heading": return `<strong>${escapeHtml(c.text || "(empty)")}</strong>`;
      case "text": return escapeHtml((c.text || "").slice(0, 80) || "(empty)");
      case "image": return c.url ? `<img src="${escapeHtml(c.url)}" style="max-width:100%;max-height:60px;">` : "(no image url)";
      case "button": return `Button: ${escapeHtml(c.label || "(no label)")}`;
      case "project-card": return `<strong>${escapeHtml(c.title || "(untitled)")}</strong>`;
      case "article-list": return `Shows latest ${c.limit || 10} posts`;
      case "divider": return "—";
      case "spacer": return "(spacer)";
      case "links": return `${(c.items || []).length} link(s)`;
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
      div.className = "admin-block" + (b.id === selectedBlockId ? " selected" : "");
      div.style.left = style.left + "px";
      div.style.top = style.top + "px";
      div.style.width = style.width + "px";
      div.style.height = style.height + "px";
      div.dataset.id = b.id;
      div.innerHTML = `<div class="block-type-label">${blockLabel(b.type)}</div><div class="block-preview">${blockPreview(b)}</div><div class="resize-handle"></div>`;
      canvas.appendChild(div);
      wireBlockInteractions(div, b);
    }
    canvas.style.minHeight = maxBottom + "px";
  }

  function rectsOverlap(a, b) {
    return a.col < b.col + b.col_span && a.col + a.col_span > b.col && a.row < b.row + b.row_span && a.row + a.row_span > b.row;
  }

  function flashOverlapWarning(div, block) {
    const overlaps = blocks.some((b) => b.id !== block.id && rectsOverlap(block, b));
    if (overlaps) {
      div.classList.add("overlap-warning");
      setTimeout(() => div.classList.remove("overlap-warning"), 1200);
    }
    return overlaps;
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
        flashOverlapWarning(div, block);
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
        flashOverlapWarning(div, block);
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
        heading: { content: { text: "New heading" }, col_span: 12, row_span: 2 },
        text: { content: { text: "Write something here." }, col_span: 8, row_span: 3 },
        image: { content: { url: "", alt: "" }, col_span: 6, row_span: 6 },
        button: { content: { label: "Click me", url: "#", external: false }, col_span: 3, row_span: 1 },
        "project-card": { content: { title: "Project", description: "", url: "", label: "View" }, col_span: 6, row_span: 3 },
        "article-list": { content: { limit: 10 }, col_span: 12, row_span: 6 },
        divider: { content: {}, col_span: 12, row_span: 1 },
        spacer: { content: {}, col_span: 12, row_span: 1 },
      }[type] || { content: {}, col_span: 6, row_span: 2 };

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
    heading: [{ key: "text", label: "Text", type: "text" }],
    text: [{ key: "text", label: "Text (blank line = new paragraph)", type: "textarea" }],
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
    divider: [],
    spacer: [],
  };

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
    const fields = FIELD_DEFS[block.type] || [];
    const container = el("inspector-fields");
    container.innerHTML = fields
      .map((f) => {
        const val = block.content[f.key];
        if (f.type === "checkbox") {
          return `<label><input type="checkbox" data-key="${f.key}" ${val ? "checked" : ""}> ${f.label}</label>`;
        }
        if (f.type === "textarea") {
          return `<label>${f.label}<textarea data-key="${f.key}" rows="4">${escapeHtml(val || "")}</textarea></label>`;
        }
        if (f.type === "image-url") {
          const fieldId = `field-${block.id}-${f.key}`;
          return `<label>${f.label}<input id="${fieldId}" data-key="${f.key}" type="text" value="${escapeHtml(
            val ?? ""
          )}"><button type="button" class="upload-trigger" data-target="#${fieldId}">Upload image</button></label>`;
        }
        return `<label>${f.label}<input data-key="${f.key}" type="${f.type}" value="${escapeHtml(val ?? "")}"></label>`;
      })
      .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No settings for this block.</p>";

    container.querySelectorAll(".upload-trigger").forEach(wireUploadButton);

    container.querySelectorAll("[data-key]").forEach((input) => {
      input.addEventListener("change", () => {
        const key = input.dataset.key;
        const value = input.type === "checkbox" ? input.checked : input.type === "number" ? Number(input.value) : input.value;
        block.content[key] = value;
        renderCanvas();
        api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ content: block.content }) }).catch((err) =>
          alert(err.message)
        );
      });
    });
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

  el("articles-btn").addEventListener("click", async () => {
    el("articles-modal").hidden = false;
    articles = await api("/articles");
    renderArticlesList();
    clearArticleForm();
  });
  el("close-articles").addEventListener("click", () => (el("articles-modal").hidden = true));

  function renderArticlesList() {
    el("articles-list").innerHTML = articles
      .map(
        (a) =>
          `<div class="article-list-item${a.id === currentArticleId ? " active" : ""}" data-id="${a.id}">${escapeHtml(
            a.title
          )}${a.published_at ? "" : " (draft)"}${
            a.tags && a.tags.length ? `<div class="article-list-tags">${a.tags.map(escapeHtml).join(", ")}</div>` : ""
          }</div>`
      )
      .join("");
    el("articles-list").querySelectorAll(".article-list-item").forEach((item) => {
      item.addEventListener("click", () => {
        const article = articles.find((a) => a.id === Number(item.dataset.id));
        currentArticleId = article.id;
        el("article-title").value = article.title;
        el("article-slug").value = article.slug;
        el("article-tags").value = (article.tags || []).join(", ");
        el("article-og-image").value = article.og_image || "";
        el("article-body").value = article.body;
        el("article-published").checked = !!article.published_at;
        renderArticlesList();
      });
    });
  }

  function clearArticleForm() {
    currentArticleId = null;
    el("article-title").value = "";
    el("article-slug").value = "";
    el("article-tags").value = "";
    el("article-og-image").value = "";
    el("article-body").value = "";
    el("article-published").checked = false;
  }

  el("new-article").addEventListener("click", clearArticleForm);

  function parseTags(str) {
    return str
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  el("save-article").addEventListener("click", async () => {
    const body = {
      title: el("article-title").value,
      slug: el("article-slug").value,
      tags: parseTags(el("article-tags").value),
      og_image: el("article-og-image").value || null,
      body: el("article-body").value,
      published: el("article-published").checked,
    };
    if (!body.title) return alert("Title is required.");
    try {
      if (currentArticleId) {
        await api(`/articles/${currentArticleId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await api("/articles", { method: "POST", body: JSON.stringify(body) });
        currentArticleId = res.id;
      }
      articles = await api("/articles");
      renderArticlesList();
    } catch (err) {
      alert(err.message);
    }
  });

  el("delete-article").addEventListener("click", async () => {
    if (!currentArticleId) return;
    if (!confirm("Delete this article?")) return;
    await api(`/articles/${currentArticleId}`, { method: "DELETE" });
    articles = await api("/articles");
    renderArticlesList();
    clearArticleForm();
  });

  // ---------- Site settings ----------
  el("site-settings-btn").addEventListener("click", async () => {
    const settings = await api("/settings");
    el("settings-og-image").value = settings.default_og_image || "";
    el("settings-modal").hidden = false;
  });
  el("close-settings").addEventListener("click", () => (el("settings-modal").hidden = true));
  el("save-settings").addEventListener("click", async () => {
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({ default_og_image: el("settings-og-image").value }),
      });
      el("settings-modal").hidden = true;
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Boot ----------
  async function boot() {
    const { authenticated } = await fetch("/api/admin/me").then((r) => r.json());
    if (!authenticated) {
      showLogin();
      return;
    }
    showApp();
    await loadPages();
  }

  document.querySelectorAll(".upload-trigger").forEach(wireUploadButton);

  window.addEventListener("resize", () => renderCanvas());
  boot();
})();
