// The kit the site's app page is built on (the Studio): the song builder, built into a page of the site instead of a dialog. It gives the
// app:
// - the Studio's stylesheet once (/studio/studio.css, already scoped under .app-native so it cannot touch the rest of the site), plus the
//   kit's own (app-kit.css);
// - the Studio's dialogs (/studio/dialogs.txt, fetched once) to build the page from;
// - script loading in order, each script once;
// - answers for the builder's calls to the old admin API (window.adminApi) from handlers the app registers, which keep
//   everything in this browser: nothing a visitor makes is sent to the site;
// - a small store (localStorage lists);
// - the page life: build once, park hidden when another tab slides in (page-slide.js), come back as it was.
(function () {
  "use strict";
  if (window.SiteAppKit) return;
  const SCOPE = ".app-native";
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

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
  function studioParts() {
    if (!parts) {
      parts = Promise.all([text("/studio/dialogs.txt"), text("/studio/studio.css"), text("/app-kit.css")]).then(([dialogs, css, own]) => ({
        doc: new DOMParser().parseFromString(dialogs, "text/html"),
        css: css + "\n" + own,
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
  // Starts every script downloading at once (they still run one after another, in order, from the cache), so the first visit is not a
  // chain of one download after another.
  function preload(list) {
    list.forEach((src) => {
      if (document.querySelector(`link[rel="preload"][href="${src}"]`) || loaded[src]) return;
      const link = document.createElement("link");
      link.rel = "preload";
      link.as = "script";
      link.href = src;
      link.dataset.addedBy = "app-kit";
      document.head.appendChild(link);
    });
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
  // Studio sets its own), and then is "not available here".
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

  const WIDE = "(min-width: 1100px)";
  const isWide = () => !!(window.matchMedia && window.matchMedia(WIDE).matches);

  // ---------- backup and restore ----------
  // What a visitor keeps lives in this browser only: a Back up button saves it all to one file, Restore puts it back (merging, never
  // overwriting: public/backup-logic.js). `cfg` = { app, collect(): parts, restore(parts): { added, skipped, full }, after?() }.
  function backup(cfg) {
    const el = document.createElement("div");
    el.className = "app-backup";
    el.innerHTML = `<div class="app-backup-row"><button type="button" class="app-backup-save" data-no-history title="Save everything you have made here to one file, to keep or move to another device">Back up</button><button type="button" class="app-backup-load" data-no-history title="Put things from a backup file back (nothing you have now is overwritten)">Restore</button><input type="file" accept="application/json,.json" hidden></div><p class="app-backup-status" role="status"></p>`;
    const status = el.querySelector(".app-backup-status");
    const say = (t) => { status.textContent = t || ""; };
    const L = () => window.BackupLogic;
    el.querySelector(".app-backup-save").addEventListener("click", async () => {
      if (!L()) return say("Backup is not ready yet: try again in a moment.");
      say("Preparing…");
      try {
        const bundle = L().makeBundle(cfg.app, await cfg.collect());
        const blob = new Blob([JSON.stringify(bundle)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = L().fileName(cfg.app);
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 10000);
        say(`Saved ${a.download}.`);
      } catch (err) {
        say(err && err.message ? err.message : "That did not work.");
      }
    });
    const input = el.querySelector("input[type=file]");
    el.querySelector(".app-backup-load").addEventListener("click", () => input.click());
    input.addEventListener("change", async () => {
      const file = input.files && input.files[0];
      input.value = "";
      if (!file) return;
      if (!L()) return say("Backup is not ready yet: try again in a moment.");
      say("Restoring…");
      try {
        const parsed = L().parseBundle(await file.text(), cfg.app);
        if (parsed.error) return say(parsed.error);
        say(L().summary(await cfg.restore(parsed.bundle.parts)));
        if (cfg.after) cfg.after();
      } catch (err) {
        say(err && err.message ? err.message : "That did not work.");
      }
    });
    return el;
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
    const editor = () => app.editor();
    async function boot(mount) {
      mount.innerHTML = `<p class="studio-loading app-loading" role="status">${esc(app.loadingText || "Loading…")}</p>`;
      preload(app.scripts);
      const { doc, css } = await studioParts();
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
      // A tool page opens straight into an empty item (app.openStart), not onto a shelf that asks for a new one.
      if (app.openStart) await app.openStart();
      new MutationObserver(() => {
        app.shown(!editor().hidden);
        // On a wide screen the Library panel stands for the shelf, so an editor that closes (the open item was deleted) opens a fresh one.
        if (app.openStart && (app.wideQuery ? window.matchMedia(app.wideQuery).matches : isWide())) setTimeout(() => { if (shell && !(parking && parking.contains(shell)) && editor().hidden) app.openStart(); }, 0);
      }).observe(editor(), { attributes: true, attributeFilter: ["hidden"] });
      app.shown(!editor().hidden);
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
    const entry = { init, warm: () => { if (!shell && !booting) { studioParts().catch(() => {}); prefetch(app.scripts); } } };
    apps.push(entry);
    // On another page the script was only loaded to get ready (page-slide.js loads it for the nav's pages): fetch what the Studio needs
    // only when someone points at, touches or tabs to its stop, not for every visitor of the home page.
    const start = () => {
      init(document);
      if (shell || booting || (navigator.connection && navigator.connection.saveData)) return;
      const events = ["pointerover", "touchstart", "focusin"];
      const interest = (e) => {
        if (!e.target.closest || !e.target.closest('a[href="/studio"]')) return;
        events.forEach((t) => document.removeEventListener(t, interest, true));
        entry.warm();
      };
      events.forEach((t) => document.addEventListener(t, interest, { capture: true, passive: true }));
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
    else start();
    return entry;
  }
  // page-slide.js / nav.js call this for every page that slides in.
  window.siteInitApps = (root) => apps.forEach((a) => a.init(root));

  window.SiteAppKit = { esc, fail, addApi, readList, writeList, nextId, now, cleanName, whenEdited, backup, register };
})();
