// Scans (/scans): the admin's 3D scan editor as a page of the site, for every visitor (built on public/app-kit.js). A visitor opens a
// 3D model from their device (.glb or .gltf, and a .usdz for iPhone AR if they have one), turns it around, picks the view it opens on and
// keeps it on a shelf of their scans. The model files stay in this browser (IndexedDB) and are never sent to the site.
(function () {
  "use strict";
  if (!window.SiteAppKit || window.siteInitScans) return;
  window.siteInitScans = true;
  const K = window.SiteAppKit;
  const $ = (id) => document.getElementById(id);
  const esc = K.esc;
  const files = K.fileStore("scans-files"); // { id: key, blob, name, type, size }
  const list = K.fileStore("scans-list"); // { id, name, glb_key, usdz_key, size, poster_key, camera_*, field_of_view, thumb, updated_at }
  const MAX_SCANS = 50;
  const LIMITS = { glb: 80, gltf: 80, usdz: 30 }; // MB, as on the site
  const VIEWER = "https://cdn.jsdelivr.net/npm/@google/model-viewer@3.5.0/dist/model-viewer.min.js";
  let shelf = null;
  let urls = [];
  let lib = null; // the Library panel on a wide screen
  let shelfStart = null;
  let openId = null; // the saved scan the editor has open (null: a new one that was never saved)
  const START_KEY = "scans.start";

  // ---------- the editor's calls, answered here ----------
  const FIELDS = ["name", "glb_key", "size", "usdz_key", "poster_key", "camera_orbit", "camera_target", "field_of_view"];
  const pick = (body) => {
    const out = {};
    FIELDS.forEach((k) => { if (body && body[k] !== undefined) out[k] = k === "name" ? K.cleanName(body[k]) : body[k]; });
    return out;
  };
  // The view the model is showing, as a small picture for its card (taken at Save; nothing when the viewer cannot make one).
  async function snapshot() {
    const viewer = $("scan-preview-viewer");
    try {
      if (viewer && viewer.toBlob && viewer.loaded) return await viewer.toBlob({ mimeType: "image/webp", qualityArgument: 0.8, idealAspect: true });
    } catch (e) {
      /* no picture then */
    }
    return null;
  }
  K.addApi(async (p, method, body) => {
    if (p === "/scans" && method === "GET") return (await list.all()).map((s) => ({ id: s.id, name: s.name, updated_at: s.updated_at }));
    if (p === "/scans" && method === "POST") {
      const all = await list.all();
      if (all.length >= MAX_SCANS) throw K.fail("That is as many scans as this browser keeps. Delete one first.");
      const item = Object.assign(pick(body), { id: K.nextId(all), thumb: await snapshot(), updated_at: K.now() });
      if (!item.name) throw K.fail("Name is required");
      await list.put(item);
      openId = item.id; // a new scan saved for the first time is the open one
      return { id: item.id };
    }
    const one = /^\/scans\/(\d+)$/.exec(p);
    if (one) {
      const id = Number(one[1]);
      const item = await list.get(id);
      if (!item) throw K.fail("Scan not found", 404);
      if (method === "GET") {
        openId = id;
        return item;
      }
      if (method === "PATCH") {
        const old = { glb: item.glb_key, usdz: item.usdz_key };
        Object.assign(item, pick(body), { updated_at: K.now() });
        item.thumb = (await snapshot()) || item.thumb;
        await list.put(item);
        // A file this scan no longer uses is let go.
        if (old.glb && old.glb !== item.glb_key) await files.delete(old.glb);
        if (old.usdz && old.usdz !== item.usdz_key) await files.delete(old.usdz);
        return item;
      }
      if (method === "DELETE") {
        await list.delete(id);
        if (item.glb_key) await files.delete(item.glb_key);
        if (item.usdz_key) await files.delete(item.usdz_key);
        return { ok: true };
      }
    }
    return undefined;
  });
  // A model file goes into this browser instead of being uploaded; its key looks like the site's, under local-.
  K.addFetch((path, method, init, query) => {
    if (path !== "/scan-upload" || method !== "POST") return undefined;
    return (async () => {
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body]);
      const kind = (query && query.get("kind")) || "glb";
      const max = (LIMITS[kind] || 80) * 1024 * 1024;
      if (blob.size > max) return K.jsonResponse({ error: `That file is over ${LIMITS[kind] || 80} MB, too big to keep here.` }, 413);
      const key = `local-scan-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
      try {
        await files.put({ id: key, blob, name: blob.name || "", type: blob.type, size: blob.size });
      } catch (err) {
        return K.jsonResponse({ error: err.message }, 507);
      }
      return K.jsonResponse({ key, size: blob.size });
    })();
  });
  // The viewer loads the model by its address: one kept here comes from this browser.
  K.addMediaFetch((key) => {
    if (!/^local-scan-[a-z0-9]+$/.test(key)) return undefined;
    return files.get(key).then((f) => (f ? new Response(f.blob, { headers: { "Content-Type": f.type || "model/gltf-binary" } }) : new Response("", { status: 404 })));
  });
  // What the page opens with: an empty viewer, or the scan that was edited last.
  const startOptions = () => [{ value: "", label: "An empty viewer" }, { value: "last", label: "My last scan" }];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  function newScan() {
    openId = null;
    $("new-scan-btn").click();
  }
  // At first (and when the open scan was deleted) the page opens the chosen start; a New scan button always means an empty viewer.
  async function openStart() {
    if (!editor().hidden) return;
    if (K.startChoice(START_KEY, startOptions(), "") === "last") {
      const all = (await list.all()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
      if (all.length) return openScan(all[0].id);
    }
    newScan();
  }
  // A scan with changes not yet saved (and a model to keep) is saved before the editor moves on.
  async function saveFirst() {
    if (editor().hidden) return;
    const status = (($("scan-save-status") || {}).textContent || "").trim();
    const hasModel = /\(|Current file/.test(($("scan-glb-status") || {}).textContent || "");
    if (!/^Unsaved/.test(status) || !hasModel) return;
    $("save-scan-btn").click();
    for (let i = 0; i < 100 && /^Unsaved/.test((($("scan-save-status") || {}).textContent || "").trim()); i++) await sleep(50);
  }
  window.refreshScanOptions = () => {};
  window.showContentUsage = window.showContentUsage || (() => {});

  // The editor points its viewer at /media/<key>: a model kept here is given to it from this browser instead.
  const blobUrls = {};
  async function localUrl(key) {
    if (!blobUrls[key]) {
      const f = await files.get(key);
      if (!f) return null;
      blobUrls[key] = URL.createObjectURL(f.blob);
    }
    return blobUrls[key];
  }
  function watchViewer() {
    const viewer = $("scan-preview-viewer");
    if (!viewer) return;
    const fix = async () => {
      for (const attr of ["src", "ios-src"]) {
        const v = viewer.getAttribute(attr) || "";
        const m = /^\/media\/(local-scan-[a-z0-9]+)$/.exec(v);
        if (!m) continue;
        const url = await localUrl(m[1]);
        if (url && viewer.getAttribute(attr) === v) viewer.setAttribute(attr, url);
      }
    };
    new MutationObserver(fix).observe(viewer, { attributes: true, attributeFilter: ["src", "ios-src"] });
  }
  function loadViewer() {
    if (window.customElements && customElements.get("model-viewer")) return;
    if (document.querySelector(`script[src="${VIEWER}"]`)) return;
    const s = document.createElement("script");
    s.type = "module";
    s.src = VIEWER;
    document.head.appendChild(s);
  }

  // ---------- the shelf ----------
  function buildShelf() {
    const el = document.createElement("section");
    el.className = "studio-shelf app-shelf scan-shelf";
    el.setAttribute("aria-labelledby", "scan-shelf-title");
    el.innerHTML = `<header class="shelf-head">
        <div><h2 id="scan-shelf-title" class="shelf-title">Scans</h2><p class="shelf-lede">Look at a 3D scan or model from every side: open a .glb or .gltf file (from Polycam, a phone's LiDAR scanner or any 3D app), pick the view it opens on, and keep it here. Your scans stay in this browser.</p></div>
        <div class="shelf-new"><button type="button" class="btn btn-accent" id="scan-shelf-open">Open a 3D model…</button><input type="file" id="scan-shelf-file" accept=".glb,.gltf,model/gltf-binary,model/gltf+json" hidden></div>
      </header>
      <div class="shelf-start-slot"></div>
      <div class="shelf-bar"><h3 class="shelf-sub">Your scans <span class="shelf-count"></span></h3></div>
      <p class="shelf-status" role="status"></p>
      <div class="shelf-grid scan-grid"></div>`;
    return el;
  }
  const say = (text) => {
    const s = shelf && shelf.querySelector(".shelf-status");
    if (s) s.textContent = text || "";
  };
  async function renderShelf() {
    if (!shelf) return;
    let all = [];
    try {
      all = (await list.all()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    } catch (err) {
      say(err.message);
    }
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    const grid = shelf.querySelector(".shelf-grid");
    grid.innerHTML = all.length
      ? all
          .map((s) => {
            let pic = `<span class="scan-thumb-blank" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/></svg></span>`;
            if (s.thumb) {
              const url = URL.createObjectURL(s.thumb);
              urls.push(url);
              pic = `<img src="${url}" alt="" loading="lazy" decoding="async">`;
            }
            const mb = s.size ? `${(s.size / 1048576).toFixed(1)} MB · ` : "";
            return `<article class="shelf-card scan-card" data-id="${s.id}">
              <button type="button" class="shelf-open" data-act="open" aria-label="Open ${esc(s.name)}">
                <span class="scan-thumb">${pic}</span>
                <span class="shelf-name">${esc(s.name)}</span>
                <span class="shelf-when">${esc(mb + K.whenEdited(s.updated_at))}</span>
              </button>
              <span class="shelf-actions"><button type="button" data-act="download" aria-label="Download the model of ${esc(s.name)}">Download</button><button type="button" data-act="delete" class="shelf-delete" aria-label="Delete ${esc(s.name)}">Delete</button></span>
            </article>`;
          })
          .join("")
      : `<p class="shelf-empty">No scans yet. Open a 3D model from your device: it is kept in this browser when you save.</p>`;
    shelf.querySelector(".shelf-count").textContent = all.length ? `${all.length} scan${all.length === 1 ? "" : "s"}` : "";
  }
  async function openScan(id) {
    $("scans-btn").click();
    for (let i = 0; i < 60; i++) {
      const edit = document.querySelector(`#scans-list .edit-scan[data-id="${id}"]`);
      if (edit) return edit.click();
      await new Promise((r) => setTimeout(r, 30));
    }
    say("That scan could not be opened.");
  }
  // A model picked on the shelf: a new scan named after the file, with the file handed to the editor's own model field.
  async function openFile(file) {
    if (!file) return;
    $("new-scan-btn").click();
    for (let i = 0; i < 40 && editor().hidden; i++) await new Promise((r) => setTimeout(r, 25));
    $("scan-name").value = K.cleanName(file.name.replace(/\.(glb|gltf)$/i, "")) || "New scan";
    const input = $("scan-glb-input");
    try {
      const dt = new DataTransfer();
      dt.items.add(file);
      input.files = dt.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } catch (e) {
      say("Pick the model again in the editor's Model file field.");
    }
  }
  function wireShelf() {
    shelf.querySelector("#scan-shelf-open").addEventListener("click", () => shelf.querySelector("#scan-shelf-file").click());
    shelf.querySelector("#scan-shelf-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      openFile(file);
    });
    shelf.querySelector(".shelf-grid").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      const card = e.target.closest(".scan-card");
      if (!btn || !card) return;
      const id = Number(card.dataset.id);
      try {
        const s = await list.get(id);
        if (!s) return renderShelf();
        if (btn.dataset.act === "open") return openScan(id);
        if (btn.dataset.act === "download") {
          const f = s.glb_key && (await files.get(s.glb_key));
          if (!f) return say("That scan's model is no longer here.");
          const url = URL.createObjectURL(f.blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = f.name || `${s.name.replace(/[\\/:*?"<>|]+/g, "-")}.glb`;
          document.body.appendChild(a);
          a.click();
          a.remove();
          setTimeout(() => URL.revokeObjectURL(url), 10000);
          return;
        }
        if (btn.dataset.act === "delete") {
          if (!window.confirm(`Delete "${s.name}" and its model from this browser? This can't be undone.`)) return;
          await window.adminApi(`/scans/${id}`, { method: "DELETE" });
          return renderShelf();
        }
      } catch (err) {
        say(err.message);
      }
    });
  }
  // "Scans" saves an unsaved scan first (when it has a model), then goes back to the shelf.
  function saveBeforeShelf(close) {
    let passing = false;
    close.addEventListener("click", (e) => {
      if (passing) return;
      const status = (($("scan-save-status") || {}).textContent || "").trim();
      const hasModel = /\(|Current file/.test(($("scan-glb-status") || {}).textContent || "");
      if (!/^Unsaved/.test(status) || !hasModel) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      $("save-scan-btn").click();
      let tries = 0;
      (function wait() {
        const now = (($("scan-save-status") || {}).textContent || "").trim();
        if (/^Unsaved/.test(now) && tries++ < 100) return setTimeout(wait, 50);
        passing = true;
        close.click();
        passing = false;
      })();
    }, true);
  }

  // Back up and restore: every scan with its model files to one file, and back (merged, nothing overwritten). Models can be big: the file
  // is as large as they are together.
  function makeBackup() {
    return K.backup({
      app: "scans",
      collect: async () => {
        const all = await list.all();
        const keys = new Set();
        all.forEach((s) => [s.glb_key, s.usdz_key].forEach((k) => k && keys.add(k)));
        const fileRows = [];
        for (const k of keys) {
          const f = await files.get(k);
          if (f && f.blob) fileRows.push({ id: k, name: f.name, type: f.type, size: f.size, blob: await K.blobToData(f.blob) });
        }
        const scans = [];
        for (const s of all) scans.push(Object.assign({}, s, { thumb: s.thumb ? await K.blobToData(s.thumb) : null }));
        return { scans, files: fileRows };
      },
      restore: async (parts) => {
        const B = window.BackupLogic;
        const have = await list.all();
        const byKey = {};
        (Array.isArray(parts.files) ? parts.files : []).forEach((f) => { if (f && f.id && f.blob) byKey[f.id] = f; });
        const incoming = (Array.isArray(parts.scans) ? parts.scans : []).map((s) => Object.assign({}, s, { thumb: s && s.thumb && typeof s.thumb.data === "string" ? K.dataToBlob(s.thumb) : null }));
        const r = B.mergeItems(have, incoming, B.fileSig, MAX_SCANS);
        const keep = new Set(have);
        for (const s of r.list) {
          if (keep.has(s)) continue;
          // a model file gets a key of its own here, so it can never replace one that is already kept
          for (const field of ["glb_key", "usdz_key"]) {
            const old = s[field];
            const f = old && byKey[old];
            if (!f) { if (old) s[field] = null; continue; }
            const key = `local-scan-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
            await files.put({ id: key, blob: K.dataToBlob(f.blob), name: f.name || "", type: f.type || f.blob.type, size: f.size });
            s[field] = key;
          }
          await list.put(s);
        }
        return r;
      },
      after: () => { renderShelf(); if (lib) lib.render(); },
    });
  }

  // ---------- the Library panel ----------
  const thumbUrls = new Map(); // "id:updated_at" -> object URL for the panel's pictures
  async function libItems() {
    const all = (await list.all()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const keep = new Set();
    const out = all.map((sc) => {
      let pic = `<span class="scan-thumb"><span class="scan-thumb-blank" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 3 20 7.5v9L12 21l-8-4.5v-9z"/><path d="M12 12 20 7.5M12 12v9M12 12 4 7.5"/></svg></span></span>`;
      if (sc.thumb) {
        const k = sc.id + ":" + sc.updated_at;
        keep.add(k);
        if (!thumbUrls.has(k)) thumbUrls.set(k, URL.createObjectURL(sc.thumb));
        pic = `<span class="scan-thumb"><img src="${thumbUrls.get(k)}" alt="" decoding="async"></span>`;
      }
      const mb = sc.size ? `${(sc.size / 1048576).toFixed(1)} MB · ` : "";
      return { id: String(sc.id), name: sc.name, meta: mb + K.whenEdited(sc.updated_at), thumb: pic };
    });
    thumbUrls.forEach((u, k) => { if (!keep.has(k)) { URL.revokeObjectURL(u); thumbUrls.delete(k); } });
    return out;
  }
  function buildLibrary(inner) {
    const cfg = {
      id: "scan", host: inner, title: "Scans", noun: "scan", newLabel: "New scan", startKey: START_KEY, startLabel: "The page opens with", startOptions,
      items: libItems,
      footer: makeBackup(),
      isOpen: (id) => !editor().hidden && openId !== null && String(openId) === id,
      async onNew() { await saveFirst(); newScan(); },
      async onOpen(id) { await saveFirst(); await openScan(Number(id)); },
      async onDelete(id) {
        const sc = await list.get(Number(id));
        if (!sc || !window.confirm(`Delete "${sc.name}" and its model from this browser? This can't be undone.`)) return;
        await window.adminApi(`/scans/${id}`, { method: "DELETE" });
        if (openId === sc.id) { openId = null; editor().hidden = true; }
      },
      onStartChange() { if (shelfStart) shelfStart.fill(); },
    };
    lib = K.library(cfg);
    shelfStart = K.startSelect(Object.assign({}, cfg, { onStartChange() { lib.render(); } }));
    shelf.querySelector(".shelf-start-slot").appendChild(shelfStart.el);
    const status = $("scan-save-status");
    if (status) new MutationObserver(() => lib.refresh()).observe(status, { childList: true, characterData: true, subtree: true });
  }

  const editor = () => $("scan-editor-modal");
  K.register({
    name: "scans",
    mountId: "scans-mount",
    shellClass: "scan-native",
    loadingText: "Loading Scans…",
    scripts: ["/backup-logic.js", "/admin/scan-builder.js"],
    dialogs: ["scans-modal", "scan-editor-modal"],
    editor,
    prepare(inner) {
      // The editor's list stays hidden (the shelf stands for it); it listens to a button that opens it, so it must be there first.
      const listBtn = document.createElement("button");
      listBtn.type = "button";
      listBtn.id = "scans-btn";
      listBtn.hidden = true;
      listBtn.tabIndex = -1;
      inner.appendChild(listBtn);
      loadViewer();
    },
    build(inner) {
      const close = $("close-scan-editor");
      close.textContent = "Scans";
      close.classList.add("app-back");
      close.setAttribute("aria-label", "Back to your scans");
      saveBeforeShelf(close);
      close.addEventListener("click", () => setTimeout(() => { $("scans-modal").hidden = true; }, 0));
      // Deleting from inside the editor also comes back to the shelf.
      $("delete-scan-btn").addEventListener("click", () => setTimeout(() => { if (!$("scans-modal").hidden) $("scans-modal").hidden = true; }, 600));
      watchViewer();
      shelf = buildShelf();
      inner.prepend(shelf);
      shelf.querySelector(".shelf-bar").before(makeBackup());
      buildLibrary(inner);
      wireShelf();
      renderShelf();
    },
    // The page opens on an empty viewer (or the scan chosen in the panel), not on a shelf asking for a new one.
    openStart,
    shown(open) {
      if (shelf) {
        shelf.hidden = open;
        if (!open) {
          $("scans-modal").hidden = true;
          renderShelf();
        }
      }
      if (lib) lib.render();
    },
  });
})();
