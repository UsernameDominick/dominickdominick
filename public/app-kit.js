// The kit the site's app pages are built on (the Studio, PicEditor, Simulations, Scans): an admin tool, taken from the admin page, built into a
// page of the site instead of a dialog over the admin. It gives each app:
// - the admin's stylesheet once, scoped under .app-native so it cannot touch the rest of the site, plus the app's own (app-kit.css);
// - the admin markup (/admin/index.html, fetched once and shared) to take the tool's dialogs from;
// - script loading in order, each script once;
// - answers for the tool's calls to the admin API (window.adminApi and fetch("/api/admin/…")) from handlers the app registers, which keep
//   everything in this browser: nothing a visitor makes is sent to the site;
// - a small store (localStorage lists for small things, IndexedDB for files);
// - the page life: build once, park hidden when another tab slides in (page-slide.js), come back as it was.
(function () {
  "use strict";
  if (window.SiteAppKit) return;
  const SCOPE = ".app-native";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- the admin's stylesheet, scoped ----------
  // Every selector goes under .app-native; `:root`/`html` rules keep their place and gain the scope after them; `body` means the app's shell.
  function splitList(sel) {
    const out = [];
    let depth = 0;
    let cur = "";
    for (const ch of sel) {
      if (ch === "(" || ch === "[") depth++;
      else if (ch === ")" || ch === "]") depth--;
      if (ch === "," && depth === 0) {
        out.push(cur.trim());
        cur = "";
      } else cur += ch;
    }
    if (cur.trim()) out.push(cur.trim());
    return out;
  }
  function scopeOne(sel) {
    const m = /^((?::root|html)(?:\[[^\]]*\]|:[\w-]+(?:\([^)]*\))?|\.[\w-]+)*)(.*)$/.exec(sel);
    if (m && m[1]) {
      const rest = m[2].trim().replace(/^body(?=[\s.#:[>]|$)/, ".app-shell");
      return `${m[1]} ${SCOPE}${rest ? " " + rest : ""}`;
    }
    if (/^body(?=[\s.#:[>]|$)/.test(sel)) return `${SCOPE} ${sel.replace(/^body/, ".app-shell")}`;
    return `${SCOPE} ${sel}`;
  }
  function scopeRules(rules) {
    let out = "";
    for (const r of rules) {
      if (r.type === 1) out += `${splitList(r.selectorText).map(scopeOne).join(", ")}{${r.style.cssText}}\n`;
      else if (r.type === 4) out += `@media ${r.conditionText || r.media.mediaText}{${scopeRules(r.cssRules)}}\n`;
      else if (r.type === 12) out += `@supports ${r.conditionText}{${scopeRules(r.cssRules)}}\n`;
      else out += r.cssText + "\n"; // keyframes, font faces
    }
    return out;
  }
  function scopeCss(text) {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(text.replace(/@import[^;]+;/g, ""));
    return scopeRules(sheet.cssRules);
  }

  // ---------- the shared parts, fetched once ----------
  let parts = null;
  // One flaky request must not leave a tool broken: each file is tried three times before giving up.
  const text = async (url) => {
    for (let i = 0; ; i++) {
      try {
        const r = await fetch(url, { credentials: "omit" });
        if (r.ok) return await r.text();
      } catch (e) {
        /* tried again below */
      }
      if (i >= 2) throw new Error("This could not be loaded.");
      await wait(400 * (i + 1));
    }
  };
  let own = null;
  function ownCss() {
    if (!own) {
      own = text("/app-kit.css");
      own.catch(() => { own = null; });
    }
    return own;
  }
  function adminParts() {
    if (!parts) {
      parts = Promise.all([text("/admin/index.html"), text("/admin/style.css"), text("/app-kit.css")]).then(([page, css, own]) => ({
        doc: new DOMParser().parseFromString(page, "text/html"),
        css: scopeCss(css) + "\n" + own,
      }));
      parts.catch(() => { parts = null; });
    }
    return parts;
  }
  // The styles go in once, before anything is shown (no unstyled flash). data-added-by: page-slide.js leaves them alone.
  function ensureStyles(css) {
    if (document.getElementById("app-kit-css")) return;
    const style = document.createElement("style");
    style.id = "app-kit-css";
    style.dataset.addedBy = "app-kit";
    style.textContent = css;
    document.head.appendChild(style);
  }
  const loaded = {};
  const wait = (ms) => new Promise((done) => setTimeout(done, ms));
  // A script that fails to arrive (a flaky connection, a busy server) is asked for again, up to three times, before the tool gives up.
  function loadScript(src) {
    if (loaded[src]) return loaded[src];
    if ([].some.call(document.querySelectorAll("script[src]"), (s) => (s.getAttribute("src") || "").split("?")[0] === src)) return (loaded[src] = Promise.resolve());
    loaded[src] = (async () => {
      for (let attempt = 0; ; attempt++) {
        try {
          await new Promise((resolve, reject) => {
            const s = document.createElement("script");
            s.src = src;
            s.async = false;
            s.onload = resolve;
            s.onerror = () => {
              s.remove();
              reject(new Error("Could not load " + src));
            };
            document.body.appendChild(s);
          });
          return;
        } catch (err) {
          if (attempt >= 2) {
            delete loaded[src];
            throw err;
          }
          await wait(500 * (attempt + 1));
        }
      }
    })();
    return loaded[src];
  }
  async function loadScripts(list) {
    for (const src of list) await loadScript(src);
  }
  function prefetch(list) {
    list.forEach((src) => {
      if (document.querySelector(`link[rel="prefetch"][href="${src}"]`)) return;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "script";
      link.href = src;
      document.head.appendChild(link);
    });
  }

  // ---------- the admin API, answered here ----------
  // Handlers are asked in turn and return undefined when a path is not theirs; anything left over goes to whatever answered before (the
  // Studio sets its own), and then is "not available here". The same for fetch("/api/admin/…") (a tool that sends a file itself).
  const fail = (message, status) => {
    const err = new Error(message);
    err.status = status || 400;
    return err;
  };
  const apis = [];
  let installed = false;
  function addApi(fn) {
    apis.push(fn);
    if (installed) return;
    installed = true;
    const before = window.adminApi;
    window.adminApi = async function (path, opts) {
      const method = ((opts && opts.method) || "GET").toUpperCase();
      let body = null;
      try {
        body = opts && typeof opts.body === "string" && opts.body ? JSON.parse(opts.body) : null;
      } catch (e) {
        throw fail("Bad request.");
      }
      const u = new URL(path, "http://x");
      const p = u.pathname;
      for (const fn of apis) {
        const out = await fn(p, method, body, u.searchParams);
        if (out !== undefined) return out;
      }
      if (before && before !== window.adminApi) return before(path, opts);
      if (p === "/settings" && method === "GET") return {};
      if (p === "/content-usage") return [];
      throw fail("That is not available here.", 404);
    };
  }
  const fetchers = [];
  const mediaFetchers = [];
  let fetchInstalled = false;
  function addMediaFetch(fn) {
    mediaFetchers.push(fn);
    addFetch(() => undefined);
  }
  function addFetch(fn) {
    if (!fetchInstalled) {
      fetchInstalled = true;
      const real = window.fetch.bind(window);
      window.fetch = function (input, init) {
        const url = typeof input === "string" ? input : input && input.url;
        const u = url ? new URL(url, location.href) : null;
        if (u && u.origin === location.origin && u.pathname.indexOf("/api/admin/") === 0) {
          for (const fn of fetchers) {
            const out = fn(u.pathname.slice("/api/admin".length), ((init && init.method) || "GET").toUpperCase(), init || {}, u.searchParams);
            if (out) return Promise.resolve(out);
          }
        }
        // A file kept in this browser that a tool asks for by its site address (/media/local-…): a 3D viewer loading a model.
        if (u && u.origin === location.origin && u.pathname.indexOf("/media/local-") === 0) {
          for (const fn of mediaFetchers) {
            const out = fn(decodeURIComponent(u.pathname.slice("/media/".length)));
            if (out) return Promise.resolve(out);
          }
        }
        return real(input, init);
      };
    }
    fetchers.push(fn);
  }
  // A JSON answer in the shape fetch gives back.
  const jsonResponse = (data, status) => new Response(JSON.stringify(data), { status: status || 200, headers: { "Content-Type": "application/json" } });

  // ---------- small dialogs inside an app ----------
  // In the admin every dialog's "×" (an id starting close-) and Escape close it; an app's own smaller dialogs (a checklist, a sweep) get
  // the same here. The app's main editor is not one of these: its × goes back to the shelf, which the app wires itself.
  const subDialogs = [];
  function wireSubDialogs(ids) {
    ids.forEach((id) => {
      const d = document.getElementById(id);
      if (!d || subDialogs.includes(d)) return;
      subDialogs.push(d);
      const x = d.querySelector('header button[id^="close-"]');
      if (x) x.addEventListener("click", () => { d.hidden = true; });
    });
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = subDialogs.filter((d) => !d.hidden && document.contains(d) && d.offsetParent !== null);
    if (!open.length) return;
    e.preventDefault();
    e.stopPropagation();
    open[open.length - 1].hidden = true;
  }, true);

  // ---------- the store ----------
  function readList(key) {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  }
  function writeList(key, list, full) {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      throw fail(full || "This browser has no room left. Delete something first.");
    }
  }
  const nextId = (list) => list.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
  const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
  const cleanName = (name) => String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  // A list of named presets (brushes, styles…) kept in one localStorage key, answered at `path` (GET, POST, DELETE /path/:id).
  function presetApi(path, key, max) {
    return (p, method, body) => {
      if (p === path && method === "GET") return readList(key);
      if (p === path && method === "POST") {
        const list = readList(key);
        if (list.length >= (max || 100)) throw fail("That is as many as this browser keeps. Delete one first.");
        const item = Object.assign({}, body || {}, { id: nextId(list), name: cleanName(body && body.name) || "Untitled" });
        list.push(item);
        writeList(key, list);
        return item;
      }
      const one = new RegExp("^" + path.replace(/[/]/g, "\\/") + "\\/(\\d+)$").exec(p);
      if (one && method === "DELETE") {
        writeList(key, readList(key).filter((x) => x.id !== Number(one[1])));
        return { ok: true };
      }
      if (one && (method === "PATCH" || method === "PUT")) {
        const list = readList(key);
        const at = list.findIndex((x) => x.id === Number(one[1]));
        if (at < 0) throw fail("Not found", 404);
        list[at] = Object.assign({}, list[at], body || {}, { id: list[at].id });
        writeList(key, list);
        return list[at];
      }
      return undefined;
    };
  }
  // Files (pictures, 3D models) in IndexedDB, one store per app: get, put, delete, all.
  function fileStore(dbName) {
    const open = () =>
      new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(fail("This browser can't keep files."));
        const req = indexedDB.open(dbName, 1);
        req.onupgradeneeded = () => req.result.createObjectStore("items", { keyPath: "id" });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    const op = async (mode, fn) => {
      const db = await open();
      try {
        return await new Promise((resolve, reject) => {
          const tx = db.transaction("items", mode);
          const req = fn(tx.objectStore("items"));
          tx.oncomplete = () => resolve(req ? req.result : undefined);
          tx.onerror = () => reject(tx.error && tx.error.name === "QuotaExceededError" ? fail("This browser has no room left. Delete something first.") : tx.error);
          tx.onabort = () => reject(tx.error && tx.error.name === "QuotaExceededError" ? fail("This browser has no room left. Delete something first.") : tx.error);
        });
      } finally {
        db.close();
      }
    };
    return {
      all: () => op("readonly", (s) => s.getAll()).then((x) => x || []),
      get: (id) => op("readonly", (s) => s.get(id)),
      put: (item) => op("readwrite", (s) => s.put(item)),
      delete: (id) => op("readwrite", (s) => s.delete(id)),
    };
  }
  function whenEdited(stamp) {
    const t = Date.parse(String(stamp || "").replace(" ", "T") + "Z");
    if (!t) return "";
    const mins = Math.round((Date.now() - t) / 60000);
    if (mins < 1) return "Edited just now";
    if (mins < 60) return `Edited ${mins} min ago`;
    const hours = Math.round(mins / 60);
    if (hours < 24) return `Edited ${hours} h ago`;
    const days = Math.round(hours / 24);
    return days < 30 ? `Edited ${days} day${days === 1 ? "" : "s"} ago` : `Edited ${new Date(t).toLocaleDateString()}`;
  }

  // ---------- the page life ----------
  // app = { name, mountId, shellClass, loadingText, scripts, dialogs: [ids taken from the admin page], editor: () => the dialog that is
  //         the editor, prepare(shell) before the scripts load, build(shell) after they ran (makes the shelf), onLeave(), shown(editorOpen), park()/unpark() optional }
  // The shelf shows whenever the editor is hidden.
  let parking = null;
  const apps = [];
  function register(app) {
    let shell = null;
    let booting = null;
    let wasOpen = false;
    // A standalone app (the Trainer) has no admin tool behind it: no dialogs, no admin stylesheet, just its own page in the shell.
    const editor = () => (app.standalone ? { hidden: false } : app.editor());
    async function boot(mount) {
      if (app.standalone) return bootStandalone(mount);
      mount.innerHTML = `<p class="studio-loading app-loading" role="status">${esc(app.loadingText || "Loading…")}</p>`;
      const { doc, css } = await adminParts();
      ensureStyles(css);
      shell = document.createElement("div");
      shell.className = "app-native " + (app.shellClass || "");
      const inner = document.createElement("div");
      inner.className = "app-shell admin-body";
      app.dialogs.forEach((id) => {
        const el = doc.getElementById(id);
        if (!el) return;
        const copy = document.importNode(el, true);
        copy.querySelectorAll("script").forEach((s) => s.remove());
        inner.appendChild(copy);
      });
      shell.appendChild(inner);
      mount.innerHTML = "";
      mount.appendChild(shell);
      if (app.prepare) app.prepare(inner); // anything the tool's scripts look up as they load
      await loadScripts(app.scripts);
      await app.build(inner);
      new MutationObserver(() => app.shown(!editor().hidden)).observe(editor(), { attributes: true, attributeFilter: ["hidden"] });
      app.shown(!editor().hidden);
    }
    async function bootStandalone(mount) {
      mount.innerHTML = `<p class="studio-loading app-loading" role="status">${esc(app.loadingText || "Loading…")}</p>`;
      const own = await ownCss();
      if (!document.getElementById("app-kit-lite-css")) {
        const style = document.createElement("style");
        style.id = "app-kit-lite-css";
        style.dataset.addedBy = "app-kit";
        style.textContent = own;
        document.head.appendChild(style);
      }
      shell = document.createElement("div");
      shell.className = "app-native " + (app.shellClass || "");
      const inner = document.createElement("div");
      inner.className = "app-shell";
      shell.appendChild(inner);
      mount.innerHTML = "";
      mount.appendChild(shell);
      await loadScripts(app.scripts);
      await app.build(inner);
      app.shown(true);
    }
    // Parking: by default the editor is hidden while parked (its document shortcuts sleep) and shown again on the way back; an app whose
    // editor loses its work when hidden (the photo editor frees its layers) gives park()/unpark() of its own instead.
    function park() {
      if (app.park) return app.park();
      wasOpen = !editor().hidden;
      editor().hidden = true;
    }
    function unpark() {
      if (app.unpark) return app.unpark();
      if (wasOpen) editor().hidden = false;
      wasOpen = false;
    }
    function place(mount) {
      mount.innerHTML = "";
      mount.appendChild(shell);
      unpark();
      app.shown(!editor().hidden);
    }
    function init(root) {
      const mount = (root || document).querySelector("#" + app.mountId);
      if (!mount) return;
      if (shell) return place(mount);
      if (!booting)
        booting = boot(mount).catch((err) => {
          console.error(err);
          booting = null;
          shell = null;
          mount.innerHTML = `<div class="studio-loading app-loading" role="alert"><p>${esc(err && err.message ? err.message : "This could not be loaded.")}</p><button type="button" class="btn app-retry">Try again</button></div>`;
          mount.querySelector(".app-retry").addEventListener("click", () => init(document));
        });
    }
    document.addEventListener("site:leave", () => {
      if (shell && document.contains(shell) && app.onLeave) app.onLeave();
    });
    document.addEventListener("site:arrive", (e) => {
      const old = e.detail && e.detail.old;
      if (!shell || !old || !old.contains(shell)) return;
      if (!parking) {
        parking = document.createElement("div");
        parking.hidden = true;
        parking.id = "app-parking";
        document.body.appendChild(parking);
      }
      park();
      parking.appendChild(shell);
    });
    const entry = { init, warm: () => { if (!shell && !booting) { (app.standalone ? ownCss() : adminParts()).catch(() => {}); prefetch(app.scripts); } } };
    apps.push(entry);
    // On another page the script was only loaded to get ready (page-slide.js warms the nav's pages): fetch what it needs while idle.
    const start = () => {
      init(document);
      if (!shell && !booting && !(navigator.connection && navigator.connection.saveData)) (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(entry.warm);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    return entry;
  }
  // page-slide.js / nav.js call this for every page that slides in.
  window.siteInitApps = (root) => apps.forEach((a) => a.init(root));

  window.SiteAppKit = { esc, fail, wireSubDialogs, addApi, addFetch, addMediaFetch, jsonResponse, readList, writeList, nextId, now, cleanName, presetApi, fileStore, whenEdited, register };
})();
