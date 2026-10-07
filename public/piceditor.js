// PicEditor (/piceditor): the admin's photo editor as a page of the site, for every visitor (built on public/app-kit.js). The opening
// screen is a shelf of the visitor's own pictures (kept in this browser's IndexedDB, never sent to the site): open a picture from the
// device (or drop or paste one), start a blank one, or open a saved one; Download, Copy and Delete on each. The editor opens in place
// under the site's nav; Save keeps the changes to that picture, Save as new adds a copy, Pictures goes back to the shelf.
(function () {
  "use strict";
  if (!window.SiteAppKit || window.siteInitPicEditor) return;
  window.siteInitPicEditor = true;
  const K = window.SiteAppKit;
  const $ = (id) => document.getElementById(id);
  const esc = K.esc;
  const store = K.fileStore("piceditor-pictures");
  const MAX_PICTURES = 100;
  const BLANKS = [
    ["Square", 1080, 1080],
    ["Wide", 1200, 630],
    ["Story", 1080, 1920],
    ["Banner", 1500, 500],
  ];
  let shelf = null;
  let lib = null; // the Library panel on a wide screen
  let shelfStart = null; // the "new ones start from" field on the shelf
  let savedAt = 0; // PhotoEditor.edits() at the last save, to tell whether the open picture has changes that were not kept
  let current = null; // { id, name } of the saved picture being edited, or { name } of one from the device
  let urls = []; // object URLs of the shelf's thumbnails, let go on every redraw

  // ---------- the editor's calls, answered here ----------
  K.addApi(K.presetApi("/brush-presets", "piceditor.brushes.v1"));
  K.addApi(K.presetApi("/photo-presets", "piceditor.presets.v1"));
  K.addApi(K.presetApi("/selection-presets", "piceditor.selections.v1"));
  K.addApi(K.presetApi("/text-styles", "piceditor.textstyles.v1"));
  const stem = (name) => String(name || "picture").replace(/\.[A-Za-z0-9]{1,5}$/, "").trim() || "picture";
  async function sizeOf(blob) {
    try {
      const bmp = await createImageBitmap(blob);
      const out = { width: bmp.width, height: bmp.height };
      if (bmp.close) bmp.close();
      return out;
    } catch (e) {
      return { width: 0, height: 0 };
    }
  }
  async function addPicture(blob, name) {
    const all = await store.all();
    if (all.length >= MAX_PICTURES) throw K.fail("That is as many pictures as this browser keeps. Delete one first.");
    const size = await sizeOf(blob);
    const item = { id: K.nextId(all), name: K.cleanName(name) || "Picture", type: blob.type, blob, width: size.width, height: size.height, updated_at: K.now() };
    await store.put(item);
    return item;
  }
  const START_KEY = "piceditor.start";
  const startOptions = () => BLANKS.map(([label, w, h]) => ({ value: `${w}x${h}`, label: `Blank ${label.toLowerCase()} (${w}×${h})` }));
  const blankSize = () => {
    const v = K.startChoice(START_KEY, startOptions(), "1080x1080");
    const [w, h] = v.split("x").map(Number);
    return { w, h };
  };
  const unkept = () => !editor().hidden && !!window.PhotoEditor && window.PhotoEditor.edits() > savedAt;
  // An empty picture at the size this page starts from.
  function openBlank() {
    const { w, h } = blankSize();
    current = { name: `Blank ${w}×${h}` };
    window.PhotoEditor.openBlank(w, h);
    savedAt = window.PhotoEditor.edits();
    hintWhenOpen("A blank picture. Save as new keeps it in your library, in this browser; Download saves a file.");
  }
  const leave = () => !unkept() || window.confirm("This picture has changes that are not saved. Leave it anyway?");
  // Save as new: a new picture on the shelf, named after the one being edited.
  window.adminUploadBlob = async (blob) => {
    const item = await addPicture(blob, current ? stem(current.name) + " (edited)" : "New picture");
    savedAt = window.PhotoEditor.edits();
    return { key: "local-" + item.id, url: "" };
  };
  // Save (the editor's "overwrite"): the picture being edited gets the new pixels.
  K.addFetch((path, method, init) => {
    const m = /^\/media\/local-(\d+)$/.exec(path);
    if (!m || method !== "PUT") return undefined;
    return (async () => {
      const item = await store.get(Number(m[1]));
      if (!item) return K.jsonResponse({ error: "That picture is no longer here." }, 404);
      const blob = init.body instanceof Blob ? init.body : new Blob([init.body]);
      const size = await sizeOf(blob);
      try {
        await store.put(Object.assign(item, { blob, type: blob.type || item.type, width: size.width, height: size.height, updated_at: K.now() }));
      } catch (err) {
        return K.jsonResponse({ error: err.message }, 507);
      }
      savedAt = window.PhotoEditor.edits();
      return K.jsonResponse({ ok: true });
    })();
  });
  window.refreshCachedMedia = async () => {};
  window.refreshMediaLibrary = () => { renderShelf(); if (lib) lib.render(); };

  // ---------- the shelf ----------
  function buildShelf() {
    const el = document.createElement("section");
    el.className = "studio-shelf app-shelf pic-shelf";
    el.setAttribute("aria-labelledby", "pic-shelf-title");
    el.innerHTML = `<header class="shelf-head">
        <div><h2 id="pic-shelf-title" class="shelf-title">PicEditor</h2><p class="shelf-lede">Edit a picture right here: layers, brushes, selections, filters, text and more. Your pictures stay in this browser.</p></div>
        <div class="shelf-new"><button type="button" class="btn btn-accent" id="pic-open">Open a picture…</button><input type="file" id="pic-file" accept="image/png,image/jpeg,image/webp,image/gif" hidden></div>
      </header>
      <div class="shelf-starters" role="group" aria-label="Start a blank picture"><span class="shelf-starters-label">Or start blank</span>${BLANKS.map(
        ([label, w, h]) => `<button type="button" class="shelf-chip" data-w="${w}" data-h="${h}">${label} <span class="chip-size">${w}×${h}</span></button>`
      ).join("")}</div>
      <div class="shelf-start-slot"></div>
      <p class="pic-drop-hint">You can also drop a picture here, or paste one.</p>
      <div class="shelf-bar"><h3 class="shelf-sub">Your pictures <span class="shelf-count"></span></h3></div>
      <p class="shelf-status" role="status"></p>
      <div class="shelf-grid pic-grid"></div>`;
    return el;
  }
  const say = (text) => {
    const s = shelf && shelf.querySelector(".shelf-status");
    if (s) s.textContent = text || "";
  };
  async function renderShelf() {
    if (!shelf) return;
    let list = [];
    try {
      list = (await store.all()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    } catch (err) {
      say(err.message);
    }
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = [];
    const grid = shelf.querySelector(".shelf-grid");
    grid.innerHTML = list.length
      ? list
          .map((p) => {
            const url = URL.createObjectURL(p.blob);
            urls.push(url);
            const size = p.width ? `${p.width}×${p.height} · ` : "";
            return `<article class="shelf-card pic-card" data-id="${p.id}">
              <button type="button" class="shelf-open" data-act="open" aria-label="Open ${esc(p.name)}">
                <span class="pic-thumb"><img src="${url}" alt="" loading="lazy" decoding="async"></span>
                <span class="shelf-name">${esc(p.name)}</span>
                <span class="shelf-when">${esc(size + K.whenEdited(p.updated_at))}</span>
              </button>
              <span class="shelf-actions"><button type="button" data-act="download" aria-label="Download ${esc(p.name)}">Download</button><button type="button" data-act="copy" aria-label="Make a copy of ${esc(p.name)}">Copy</button><button type="button" data-act="delete" class="shelf-delete" aria-label="Delete ${esc(p.name)}">Delete</button></span>
            </article>`;
          })
          .join("")
      : `<p class="shelf-empty">No pictures yet. Open one from your device or start a blank one: it is kept in this browser when you save.</p>`;
    shelf.querySelector(".shelf-count").textContent = list.length ? `${list.length} picture${list.length === 1 ? "" : "s"}` : "";
  }
  function openFile(file) {
    if (!file) return;
    const out = window.PhotoEditor.openFile(file);
    if (out && out.error) return say(out.error);
    current = { name: file.name || "Pasted picture" };
    savedAt = 0;
    say("");
    hintWhenOpen(`Editing "${current.name}" from your device. Save as new keeps it on your shelf, in this browser; Download saves a file.`);
  }
  // The editor's own words talk about the site's media library: say what happens here instead, once it has opened the picture.
  function hintWhenOpen(text) {
    let tries = 0;
    (function set() {
      const hint = $("pe-hint");
      if (hint && !editor().hidden) return (hint.textContent = text);
      if (tries++ < 40) setTimeout(set, 50);
    })();
  }
  async function openSaved(id) {
    const p = await store.get(id);
    if (!p) return renderShelf();
    current = { id: p.id, name: p.name };
    savedAt = 0;
    window.PhotoEditor.open(URL.createObjectURL(p.blob), "local-" + p.id, {
      name: p.name,
      revoke: true,
      hint: `Editing "${p.name}". Save keeps your changes; Save as new keeps this one as it was and adds a copy.`,
    });
  }
  function download(p) {
    const ext = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif" }[p.type] || "png";
    const url = URL.createObjectURL(p.blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${stem(p.name).replace(/[\\/:*?"<>|]+/g, "-")}.${ext}`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function wireShelf() {
    shelf.querySelector("#pic-open").addEventListener("click", () => shelf.querySelector("#pic-file").click());
    shelf.querySelector("#pic-file").addEventListener("change", (e) => {
      openFile(e.target.files && e.target.files[0]);
      e.target.value = "";
    });
    shelf.querySelector(".shelf-starters").addEventListener("click", (e) => {
      const chip = e.target.closest(".shelf-chip");
      if (!chip) return;
      current = { name: `Blank ${chip.dataset.w}×${chip.dataset.h}` };
      window.PhotoEditor.openBlank(Number(chip.dataset.w), Number(chip.dataset.h));
      savedAt = window.PhotoEditor.edits();
      hintWhenOpen("A blank picture. Save as new keeps it in your library, in this browser; Download saves a file.");
    });
    shelf.querySelector(".shelf-grid").addEventListener("click", async (e) => {
      const btn = e.target.closest("button[data-act]");
      const card = e.target.closest(".pic-card");
      if (!btn || !card) return;
      const id = Number(card.dataset.id);
      const act = btn.dataset.act;
      try {
        if (act === "open") return openSaved(id);
        const p = await store.get(id);
        if (!p) return renderShelf();
        if (act === "download") return download(p);
        if (act === "copy") {
          await addPicture(p.blob, p.name + " (copy)");
          return renderShelf();
        }
        if (act === "delete") {
          if (!window.confirm(`Delete "${p.name}" from this browser? This can't be undone.`)) return;
          await store.delete(id);
          return renderShelf();
        }
      } catch (err) {
        say(err.message);
      }
    });
    // Drop a picture on the shelf, or paste one while the shelf is showing.
    shelf.addEventListener("dragover", (e) => {
      if (e.dataTransfer && [].some.call(e.dataTransfer.items || [], (i) => i.kind === "file")) {
        e.preventDefault();
        shelf.classList.add("is-dropping");
      }
    });
    shelf.addEventListener("dragleave", (e) => { if (!shelf.contains(e.relatedTarget)) shelf.classList.remove("is-dropping"); });
    shelf.addEventListener("drop", (e) => {
      e.preventDefault();
      shelf.classList.remove("is-dropping");
      openFile([].find.call((e.dataTransfer && e.dataTransfer.files) || [], (f) => /^image\//.test(f.type)));
    });
    document.addEventListener("paste", (e) => {
      if (!shelf || shelf.hidden || !document.contains(shelf)) return;
      const t = e.target;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const pic = [].find.call((e.clipboardData && e.clipboardData.files) || [], (f) => /^image\//.test(f.type));
      if (!pic) return;
      e.preventDefault();
      openFile(pic);
    });
  }

  // Back up and restore: every picture to one file, and back (merged, nothing overwritten).
  function makeBackup() {
    return K.backup({
      app: "piceditor",
      collect: async () => {
        const all = await store.all();
        return { pictures: await Promise.all(all.map(async (p) => Object.assign({}, p, { blob: await K.blobToData(p.blob) }))) };
      },
      restore: async (parts) => {
        const B = window.BackupLogic;
        const have = await store.all();
        const incoming = (Array.isArray(parts.pictures) ? parts.pictures : []).filter((p) => p && p.blob && typeof p.blob.data === "string").map((p) => Object.assign({}, p, { blob: K.dataToBlob(p.blob) }));
        const r = B.mergeItems(have, incoming, B.fileSig, MAX_PICTURES);
        const keep = new Set(have);
        for (const p of r.list) if (!keep.has(p)) await store.put(p);
        return r;
      },
      after: () => { renderShelf(); if (lib) lib.render(); },
    });
  }

  // ---------- the Library panel ----------
  const thumbs = new Map(); // "id:updated_at" -> object URL for the panel's pictures
  async function libItems() {
    const all = (await store.all()).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const keep = new Set();
    const out = all.map((p) => {
      const k = p.id + ":" + p.updated_at;
      keep.add(k);
      if (!thumbs.has(k)) thumbs.set(k, URL.createObjectURL(p.blob));
      return { id: String(p.id), name: p.name, meta: (p.width ? `${p.width}×${p.height} · ` : "") + K.whenEdited(p.updated_at), thumb: `<span class="pic-thumb"><img src="${thumbs.get(k)}" alt="" decoding="async"></span>` };
    });
    thumbs.forEach((u, k) => { if (!keep.has(k)) { URL.revokeObjectURL(u); thumbs.delete(k); } });
    return out;
  }
  function buildLibrary(inner) {
    const cfg = {
      id: "pic", host: inner, title: "Pictures", noun: "picture", newLabel: "New picture", startKey: START_KEY, startLabel: "New pictures start from", startOptions,
      items: libItems,
      footer: makeBackup(),
      isOpen: (id) => !editor().hidden && !!current && String(current.id) === id,
      onNew() { if (leave()) openBlank(); },
      async onOpen(id) { if (leave()) await openSaved(Number(id)); },
      async onCopy(id) { const p = await store.get(Number(id)); if (p) await addPicture(p.blob, p.name + " (copy)"); },
      async onDelete(id) {
        const p = await store.get(Number(id));
        if (!p || !window.confirm(`Delete "${p.name}" from this browser? This can't be undone.`)) return;
        await store.delete(Number(id));
        if (current && current.id === p.id) { current = null; editor().hidden = true; }
      },
      onStartChange() { if (shelfStart) shelfStart.fill(); },
    };
    lib = K.library(cfg);
    shelfStart = K.startSelect(Object.assign({}, cfg, { onStartChange() { lib.render(); } }));
    shelf.querySelector(".shelf-start-slot").appendChild(shelfStart.el);
    return cfg;
  }

  const editor = () => $("photo-editor-modal");
  K.register({
    name: "piceditor",
    mountId: "piceditor-mount",
    shellClass: "pic-native",
    loadingText: "Loading PicEditor…",
    scripts: ["/backup-logic.js", "/admin/photo-color.js", "/admin/photo-editor.js"],
    dialogs: ["photo-editor-modal", "photo-editor-prompt-modal"],
    editor,
    async build(inner) {
      // The editor's × is the way back to the shelf; its "Overwrite original" is this picture's Save.
      const close = $("close-photo-editor");
      close.textContent = "Pictures";
      close.classList.add("app-back");
      close.setAttribute("aria-label", "Back to your pictures");
      close.addEventListener("click", () => { editor().hidden = true; });
      $("pe-save-overwrite").textContent = "Save";
      const title = $("photo-editor-modal-title");
      if (title) {
        title.textContent = "PicEditor";
        // the page already has its h1 (for search engines and screen readers): the editor's own title is a level-two heading here
        if (title.tagName === "H1") {
          const h2 = document.createElement("h2");
          [...title.attributes].forEach((at) => h2.setAttribute(at.name, at.value));
          h2.textContent = title.textContent;
          title.replaceWith(h2);
        }
      }
      $("pe-download").title = "Save the picture to your device, in the format and quality chosen. The editor stays open.";
      const realConfirm = window.confirm.bind(window);
      window.confirm = (msg) => (/^Overwrite the original file\?/.test(String(msg)) && !editor().hidden ? true : realConfirm(msg));
      shelf = buildShelf();
      inner.prepend(shelf);
      shelf.querySelector(".shelf-bar").before(makeBackup());
      buildLibrary(inner);
      wireShelf();
      await renderShelf();
    },
    // The page opens on an empty picture, not on a shelf asking for a new one.
    openStart() { if (editor().hidden) openBlank(); },
    shown(open) {
      // The editor's shortcuts listen only while it is the open dialog (aria-modal), as in the admin.
      editor().setAttribute("aria-modal", open ? "true" : "false");
      if (shelf) {
        shelf.hidden = open;
        if (!open) renderShelf();
      }
      if (lib) lib.render();
    },
    // Hiding the editor would let go of its layers and history: parked, it only stops listening for shortcuts, and comes back as it was.
    park() { editor().setAttribute("aria-modal", "false"); },
    unpark() { if (!editor().hidden) editor().setAttribute("aria-modal", "true"); },
  });
})();
