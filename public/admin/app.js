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
    return { heading: "Heading", text: "Text", image: "Image", button: "Button", "project-card": "Project Card", "article-list": "Article List", video: "Video", quote: "Quote", gallery: "Gallery", simulation: "Simulation", divider: "Divider", spacer: "Spacer", links: "Links", html: "HTML / Embed" }[type] || type;
  }

  let simulationOptions = [];
  function simulationNameById(id) {
    const s = simulationOptions.find((x) => x.id === id);
    return s ? s.name : null;
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
      case "video": return c.url ? escapeHtml(c.url) : "(no video url)";
      case "quote": return c.text ? `“${escapeHtml(c.text.slice(0, 60))}”` : "(empty)";
      case "gallery": return `${(c.images || []).length} image(s)`;
      case "simulation": return c.simulation_id ? escapeHtml(simulationNameById(c.simulation_id) || `#${c.simulation_id}`) : "(choose a simulation)";
      case "divider": return "—";
      case "spacer": return "(spacer)";
      case "links": return `${(c.items || []).length} link(s)`;
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
      div.innerHTML = `<div class="block-type-label">${blockLabel(b.type)}</div><div class="block-preview">${blockPreview(b)}</div><div class="resize-handle"></div>`;
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
        // A full-width (24-col) simulation SVG at its 900:500 aspect ratio,
        // plus the power button below it, renders taller than it looks like
        // it should need — row_span accounts for that so it doesn't overflow
        // into whatever comes after it (grid rows here are a fixed 16px+gap).
        simulation: { content: { simulation_id: null }, col_span: 24, row_span: 30 },
        video: { content: { url: "" }, col_span: 16, row_span: 12 },
        quote: { content: { text: "Quote text here.", cite: "" }, col_span: 16, row_span: 6 },
        gallery: { content: { images: [] }, col_span: 24, row_span: 12 },
        links: { content: { items: [] }, col_span: 12, row_span: 6 },
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
    text: [{ key: "text", label: "Text (blank line = new paragraph, **bold**, *italic*, [link](url))", type: "textarea" }],
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
    quote: [
      { key: "text", label: "Quote text", type: "textarea" },
      { key: "cite", label: "Attribution (optional)", type: "text" },
    ],
    gallery: [{ key: "images", label: "Images", type: "gallery-urls" }],
    links: [{ key: "items", label: "Links (one per line: Label | URL)", type: "link-list" }],
    simulation: [{ key: "simulation_id", label: "Simulation", type: "simulation-select" }],
    html: [{ key: "html", label: "Raw HTML (advanced — rendered as-is, unescaped; be careful what you paste here)", type: "textarea" }],
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
    { key: "customCss", label: "Custom CSS (advanced — raw declarations, e.g. transform: rotate(-2deg);)", type: "textarea" },
    { key: "hidden", label: "Hide from live site", type: "checkbox" },
  ];

  function fieldHtml(f, val, idPrefix) {
    if (f.type === "checkbox") {
      return `<label><input type="checkbox" data-key="${f.key}" ${val ? "checked" : ""}> ${f.label}</label>`;
    }
    if (f.type === "textarea") {
      return `<label>${f.label}<textarea data-key="${f.key}" rows="4">${escapeHtml(val || "")}</textarea></label>`;
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
      return `<label>${f.label}<input id="${fieldId}" data-key="${f.key}" type="text" value="${escapeHtml(
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
    if (f.type === "simulation-select") {
      const options = simulationOptions
        .map((s) => `<option value="${s.id}"${String(val ?? "") === String(s.id) ? " selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}" data-numeric="1"><option value="">— choose —</option>${
        options || "<option disabled>No simulations yet</option>"
      }</select> <button type="button" class="manage-simulations-btn">Manage simulations…</button></label>`;
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

    if (!block.style) block.style = {};

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

    function save() {
      renderCanvas();
      api(`/blocks/${block.id}`, {
        method: "PATCH",
        body: JSON.stringify({ content: block.content, style: block.style }),
      }).catch((err) => alert(err.message));
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

  function renderArticlesList() {
    el("articles-list").innerHTML = articles
      .map(
        (a) =>
          `<div class="article-list-item${a.id === currentArticleId ? " active" : ""}" data-id="${a.id}">${escapeHtml(
            a.title
          )}${articleStatusLabel(a)}${
            a.tags && a.tags.length ? `<div class="article-list-tags">${a.tags.map(escapeHtml).join(", ")}</div>` : ""
          }</div>`
      )
      .join("");
    el("articles-list").querySelectorAll(".article-list-item").forEach((item) => {
      item.addEventListener("click", () => {
        const article = articles.find((a) => a.id === Number(item.dataset.id));
        populateArticleForm(article);
        renderArticlesList();
      });
    });
  }

  function populateArticleForm(article) {
    currentArticleId = article.id;
    el("article-title").value = article.title;
    el("article-slug").value = article.slug;
    el("article-tags").value = (article.tags || []).join(", ");
    el("article-og-image").value = article.og_image || "";
    el("article-body").value = article.body;
    el("article-published").checked = !!article.published_at;
    el("article-publish-at").value = isoToLocalInput(article.published_at);
    updateArticleExtras();
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
  }

  function clearArticleForm() {
    currentArticleId = null;
    el("article-title").value = "";
    el("article-slug").value = "";
    el("article-tags").value = "";
    el("article-og-image").value = "";
    el("article-body").value = "";
    el("article-published").checked = false;
    el("article-publish-at").value = "";
    updateArticleExtras();
  }

  el("new-article").addEventListener("click", clearArticleForm);

  function parseTags(str) {
    return str
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  el("save-article").addEventListener("click", async () => {
    const publishAtLocal = el("article-publish-at").value;
    const published = el("article-published").checked;
    const body = {
      title: el("article-title").value,
      slug: el("article-slug").value,
      tags: parseTags(el("article-tags").value),
      og_image: el("article-og-image").value || null,
      body: el("article-body").value,
      // A blank publish-at with "Published" checked means "now"; a filled
      // one schedules it (past or future). Unchecked always means draft.
      published_at: published ? (publishAtLocal ? new Date(publishAtLocal).toISOString() : new Date().toISOString()) : null,
    };
    if (!body.title) return alert("Title is required.");
    try {
      if (currentArticleId) {
        await api(`/articles/${currentArticleId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await api("/articles", { method: "POST", body: JSON.stringify(body) });
        currentArticleId = res.id;
        el("article-slug").value = res.slug;
      }
      articles = await api("/articles");
      updateArticleExtras();
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

  // ---------- Media library ----------
  let mediaPickTarget = null;
  let mediaPickAppend = false;

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function loadMediaLibrary() {
    const items = await api("/media");
    el("media-grid").innerHTML =
      items
        .map(
          (item) =>
            `<div class="media-item" data-url="${escapeHtml(item.url)}" data-key="${escapeHtml(item.key)}" title="${formatBytes(
              item.size
            )}"><img src="${escapeHtml(item.url)}" loading="lazy"><button type="button" class="media-edit" data-url="${escapeHtml(
              item.url
            )}" data-key="${escapeHtml(item.key)}" title="Edit">✎</button><button type="button" class="media-delete" data-key="${escapeHtml(
              item.key
            )}" title="Delete">×</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);'>No uploads yet.</p>";

    el("media-grid")
      .querySelectorAll(".media-item")
      .forEach((div) => {
        div.addEventListener("click", (e) => {
          if (e.target.classList.contains("media-delete") || e.target.classList.contains("media-edit")) return;
          if (!mediaPickTarget) return;
          const input = document.querySelector(mediaPickTarget);
          if (input) setFieldUrl(input, div.dataset.url, mediaPickAppend);
          closeMediaModal();
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
      .querySelectorAll(".media-delete")
      .forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          if (!confirm("Delete this file? Anything still using it will break.")) return;
          try {
            await api(`/media/${btn.dataset.key}`, { method: "DELETE" });
            await loadMediaLibrary();
          } catch (err) {
            alert(err.message);
          }
        });
      });
  }

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
    el("settings-modal").hidden = false;
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

  // ---------- Revisions ----------
  async function openRevisions(kind, entityId) {
    el("revisions-modal").hidden = false;
    const revisions = await api(`/revisions?kind=${kind}&id=${entityId}`);
    el("revisions-list").innerHTML =
      revisions
        .map(
          (r) =>
            `<div class="revision-row"><span>${new Date(r.created_at.replace(" ", "T") + "Z").toLocaleString()}</span><button type="button" class="restore-revision" data-id="${
              r.id
            }">Restore</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No history yet.</p>";

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
      { label: "Open Site Settings", sub: "", run: () => { closeCommandPalette(); el("site-settings-btn").click(); } },
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

  async function loadAnalytics() {
    const data = await api(`/analytics?days=${analyticsRange}`);
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
  }

  el("analytics-btn").addEventListener("click", async () => {
    el("analytics-modal").hidden = false;
    await loadAnalytics();
  });
  closeModalOnClick("close-analytics", "analytics-modal");

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

  // ---------- Boot ----------
  async function loadSimulationOptions() {
    try {
      simulationOptions = await api("/simulations");
    } catch {
      simulationOptions = [];
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
  }

  document.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
  document.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);

  // Shared with photo-editor.js and simulation-builder.js, which are loaded
  // as separate plain scripts (not modules) and can't import from this IIFE.
  window.adminApi = api;
  window.adminUploadBlob = uploadFile;
  window.refreshMediaLibrary = loadMediaLibrary;
  window.refreshSimulationOptions = loadSimulationOptions;

  window.addEventListener("resize", () => renderCanvas());
  boot();
})();
