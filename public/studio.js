// The Studio as a real page of the site (/studio): no frame and nothing of the admin around it. The page holds an empty mount; this script
// builds the Studio into it: the song editor's own markup (taken from the admin page: the builder, the list it keeps hidden and the audio
// export dialog), its stylesheet scoped to the Studio so it cannot touch the rest of the site, and the song scripts. Its calls to the
// server are answered here instead, from this browser's own storage (songs and templates), so nothing a visitor makes is sent anywhere.
// The opening screen is a shelf of the visitor's songs (play one, open it, copy or delete it), New song and the starters; the editor opens
// in place under the site's nav, and its Songs button comes back to the shelf.
// When the visitor slides to another tab (page-slide.js), the Studio is parked, hidden, and put back as it was on the way back in.
(function () {
  "use strict";
  if (window.siteInitStudio) return;
  const SONGS_KEY = "studio.songs.v1";
  const TEMPLATES_KEY = "studio.templates.v1";
  const MAX_SONGS = 200;
  const MAX_SONG_BYTES = 1000000;
  const SCRIPTS = ["/dial.js", "/song-engine.js", "/admin/song-patterns.js", "/admin/song-files.js", "/admin/song-starters.js", "/admin/song-builder.js", "/admin/song-studio.js"];
  const $ = (id) => document.getElementById(id);
  const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

  // ---------- the store: songs and templates in this browser ----------
  const read = (key) => {
    try {
      const v = JSON.parse(localStorage.getItem(key) || "[]");
      return Array.isArray(v) ? v : [];
    } catch (e) {
      return [];
    }
  };
  const write = (key, list) => {
    try {
      localStorage.setItem(key, JSON.stringify(list));
    } catch (e) {
      throw new Error("This browser has no room left to keep songs. Delete a song, or save a song file first.");
    }
  };
  const fail = (message, status) => {
    const err = new Error(message);
    err.status = status || 400;
    return err;
  };
  const nextId = (list) => list.reduce((m, s) => Math.max(m, Number(s.id) || 0), 0) + 1;
  const now = () => new Date().toISOString().replace("T", " ").slice(0, 19);
  const cleanName = (name) => String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 120);
  const checkData = (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw fail("Song data must be an object.");
    if (JSON.stringify(data).length > MAX_SONG_BYTES) throw fail("This song is too large to save (over 1 MB of data).");
  };
  async function api(path, opts) {
    const method = ((opts && opts.method) || "GET").toUpperCase();
    let body = null;
    try {
      body = opts && opts.body ? JSON.parse(opts.body) : null;
    } catch (e) {
      throw fail("Bad request.");
    }
    const p = new URL(path, "http://x").pathname;
    if (p === "/songs" && method === "GET") return read(SONGS_KEY).map((s) => ({ id: s.id, name: s.name, updated_at: s.updated_at })).sort((a, b) => a.name.localeCompare(b.name));
    if (p === "/songs" && method === "POST") {
      const songs = read(SONGS_KEY);
      if (songs.length >= MAX_SONGS) throw fail("That is as many songs as this browser keeps. Delete one first.");
      const name = cleanName(body && body.name);
      if (!name) throw fail("Name is required");
      checkData(body.data);
      const id = nextId(songs);
      songs.push({ id, name, data: body.data, updated_at: now() });
      write(SONGS_KEY, songs);
      return { id };
    }
    const one = /^\/songs\/(\d+)(\/duplicate)?$/.exec(p);
    if (one) {
      const id = Number(one[1]);
      const songs = read(SONGS_KEY);
      const at = songs.findIndex((s) => s.id === id);
      if (at < 0) throw fail("Song not found", 404);
      if (!one[2] && method === "GET") return songs[at];
      if (!one[2] && method === "PATCH") {
        if (body && body.name !== undefined) {
          const name = cleanName(body.name);
          if (!name) throw fail("Name is required");
          songs[at].name = name;
        }
        if (body && body.data !== undefined) {
          checkData(body.data);
          songs[at].data = body.data;
        }
        songs[at].updated_at = now();
        write(SONGS_KEY, songs);
        return songs[at];
      }
      if (!one[2] && method === "DELETE") {
        songs.splice(at, 1);
        write(SONGS_KEY, songs);
        return { ok: true };
      }
      if (one[2] && method === "POST") {
        if (songs.length >= MAX_SONGS) throw fail("That is as many songs as this browser keeps. Delete one first.");
        const copy = { id: nextId(songs), name: cleanName(songs[at].name + " (copy)"), data: JSON.parse(JSON.stringify(songs[at].data)), updated_at: now() };
        songs.push(copy);
        write(SONGS_KEY, songs);
        return { id: copy.id };
      }
    }
    // Templates of other kinds (a circuit's) belong to another app page: passed on (404) to whoever answers them.
    const kind = new URL(path, "http://x").searchParams.get("kind") || (body && body.kind) || "song";
    if (p === "/templates" && kind !== "song") throw fail("That is not available here.", 404);
    if (p === "/templates" && method === "GET") return read(TEMPLATES_KEY);
    if (p === "/templates" && method === "POST") {
      const list = read(TEMPLATES_KEY);
      const name = cleanName(body && body.name);
      if (!name) throw fail("Name is required");
      checkData(body.data);
      list.push({ id: nextId(list), kind: "song", name, data: body.data });
      write(TEMPLATES_KEY, list);
      return { id: list[list.length - 1].id };
    }
    if (p === "/content-usage") return [];
    if (p === "/settings") return {};
    throw fail("That is not available here.", 404);
  }

  // ---------- the editor's stylesheet, scoped to the Studio ----------
  // Every selector of the admin stylesheet is put under .studio-native, so its rules for buttons, fields and dialogs only reach the Studio.
  // `:root`/`html` rules keep their place and gain the scope after them; `body` means the Studio's own shell.
  const SCOPE = ".studio-native";
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
      const rest = m[2].trim().replace(/^body(?=[\s.#:[>]|$)/, ".studio-shell");
      return `${m[1]} ${SCOPE}${rest ? " " + rest : ""}`;
    }
    if (/^body(?=[\s.#:[>]|$)/.test(sel)) return `${SCOPE} ${sel.replace(/^body/, ".studio-shell")}`;
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

  // ---------- the shelf: the visitor's songs ----------
  const TRACK_ROWS = [
    { key: "drums", color: "var(--track-1)" },
    { key: "bass", color: "var(--track-2)" },
    { key: "chords", color: "var(--track-3)" },
    { key: "melody", color: "var(--track-4)" },
    { key: "lead", color: "var(--track-5)" },
  ];
  const on = (v) => v !== false && v != null && v !== 0;
  // Which of the sixteen steps each track plays in the song's open pattern: the little picture on a card.
  function stepsOf(data) {
    const rows = {};
    const d = data || {};
    const mark = (key, arr) => {
      if (!Array.isArray(arr)) return;
      rows[key] = rows[key] || new Array(16).fill(false);
      arr.slice(0, 16).forEach((v, i) => { if (on(v)) rows[key][i] = true; });
    };
    Object.values(d.tracks || {}).forEach((arr) => mark("drums", arr));
    ["bass", "chords", "melody", "lead"].forEach((k) => {
      const part = d[k];
      if (part && part.notes) Object.values(part.notes).forEach((arr) => mark(k, arr));
    });
    return rows;
  }
  function cardPicture(data) {
    const rows = stepsOf(data);
    return TRACK_ROWS.map((t) => `<span class="shelf-row" style="--c:${t.color}">${(rows[t.key] || new Array(16).fill(false)).map((x) => `<i${x ? ' class="on"' : ""}></i>`).join("")}</span>`).join("");
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

  // One song plays at a time, from its card; it stops when another starts, when a song is opened or when the visitor leaves the page.
  let audio = null;
  let playing = null; // { id, player, btn }
  const ctx = () => {
    if (!audio) {
      const AC = window.AudioContext || window.webkitAudioContext;
      audio = new AC();
    }
    if (audio.state === "suspended") audio.resume();
    return audio;
  };
  function stopShelf() {
    if (!playing) return;
    try {
      playing.player.stop();
    } catch (e) {
      /* already stopped */
    }
    playing.btn.setAttribute("aria-pressed", "false");
    playing.btn.setAttribute("aria-label", `Play ${playing.name}`);
    playing = null;
  }

  let shelf = null;
  async function renderShelf() {
    if (!shelf) return;
    stopShelf();
    const list = read(SONGS_KEY).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const grid = shelf.querySelector(".shelf-grid");
    grid.innerHTML = list.length
      ? list
          .map(
            (s) => `<article class="shelf-card" data-id="${s.id}">
              <button type="button" class="shelf-play" data-act="play" aria-pressed="false" aria-label="Play ${esc(s.name)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="i-play" d="M8 5.5v13l11-6.5z"/><path class="i-stop" d="M7 7h10v10H7z"/></svg></button>
              <button type="button" class="shelf-open" data-act="open" aria-label="Open ${esc(s.name)}">
                <span class="shelf-picture" aria-hidden="true">${cardPicture(s.data)}</span>
                <span class="shelf-name">${esc(s.name)}</span>
                <span class="shelf-when">${esc(whenEdited(s.updated_at))}</span>
              </button>
              <span class="shelf-actions"><button type="button" data-act="copy" aria-label="Make a copy of ${esc(s.name)}" title="Make a copy">Copy</button><button type="button" data-act="delete" class="shelf-delete" aria-label="Delete ${esc(s.name)}" title="Delete">Delete</button></span>
            </article>`
          )
          .join("")
      : `<p class="shelf-empty">No songs yet. Start one: it is kept in this browser as soon as you change anything.</p>`;
    shelf.querySelector(".shelf-count").textContent = list.length ? `${list.length} song${list.length === 1 ? "" : "s"}` : "";
    renderStarters();
  }
  // The starters the editor offers (its own template list), as one-tap chips.
  function renderStarters() {
    const box = shelf && shelf.querySelector(".shelf-starters");
    const picker = $("song-template-picker");
    if (!box || !picker) return;
    const opts = [...picker.options].filter((o) => o.value && o.value.startsWith("starter:"));
    box.innerHTML = opts.length
      ? `<span class="shelf-starters-label">Or start from</span>${opts.map((o) => `<button type="button" class="shelf-chip" data-start="${esc(o.value)}">${esc(o.textContent.replace(/^Starter:\s*/i, ""))}</button>`).join("")}`
      : "";
  }
  async function openSong(id) {
    stopShelf();
    // The editor opens a song from its own list (kept hidden): make sure it lists this one, then press its Edit.
    let btn = document.querySelector(`#songs-list .edit-song[data-id="${id}"]`);
    if (!btn) {
      $("songs-btn").click();
      for (let i = 0; i < 40 && !btn; i++) {
        await new Promise((r) => setTimeout(r, 25));
        btn = document.querySelector(`#songs-list .edit-song[data-id="${id}"]`);
      }
    }
    if (btn) btn.click();
  }
  function wireShelf() {
    shelf.addEventListener("click", async (e) => {
      const chip = e.target.closest(".shelf-chip");
      if (chip) {
        stopShelf();
        $("song-template-picker").value = chip.dataset.start;
        $("new-song-btn").click();
        return;
      }
      const btn = e.target.closest("button[data-act]");
      const card = btn && btn.closest(".shelf-card");
      if (!card) return;
      const id = Number(card.dataset.id);
      const song = read(SONGS_KEY).find((s) => s.id === id);
      if (!song) return renderShelf();
      const act = btn.dataset.act;
      if (act === "open") openSong(id);
      else if (act === "play") {
        const was = playing && playing.id === id;
        stopShelf();
        if (was || !window.SongEngine) return;
        const player = window.SongEngine.createPlayer(ctx, song.data, () => {});
        player.start();
        playing = { id, player, btn, name: song.name };
        btn.setAttribute("aria-pressed", "true");
        btn.setAttribute("aria-label", `Stop ${song.name}`);
      } else if (act === "copy") {
        await api(`/songs/${id}/duplicate`, { method: "POST" });
        renderShelf();
      } else if (act === "delete") {
        if (!window.confirm(`Delete "${song.name}" from this browser? This can't be undone.`)) return;
        await api(`/songs/${id}`, { method: "DELETE" });
        renderShelf();
      }
    });
  }
  function buildShelf() {
    const el = document.createElement("section");
    el.className = "studio-shelf";
    el.setAttribute("aria-labelledby", "shelf-title");
    el.innerHTML = `<header class="shelf-head">
        <div><h2 id="shelf-title" class="shelf-title">Studio</h2><p class="shelf-lede">Make a beat, a bass line or a whole track: five tracks, forty instruments, fifteen drum kits. Your songs stay in this browser.</p></div>
        <div class="shelf-new"></div>
      </header>
      <div class="shelf-starters"></div>
      <div class="shelf-bar"><h3 class="shelf-sub">Your songs <span class="shelf-count"></span></h3><div class="shelf-files"></div></div>
      <p class="shelf-status" role="status"></p>
      <div class="shelf-grid"></div>`;
    // The editor's own New song, template, import buttons and file inputs move here, ids and all, so they keep working as they always did.
    // (Held first: once moved into this detached section, getElementById no longer finds them.)
    const [newBtn, picker, importBtn, importInput, midiBtn, midiInput, status] = ["new-song-btn", "song-template-picker", "song-import-btn", "song-import-input", "song-import-midi-btn", "song-import-midi-input", "song-import-status"].map($);
    const newBox = el.querySelector(".shelf-new");
    if (newBtn) {
      newBtn.textContent = "New song";
      newBtn.classList.add("btn", "btn-accent");
      newBox.append(newBtn);
    }
    if (importBtn) importBtn.textContent = "Open a song file…";
    if (midiBtn) midiBtn.textContent = "Open MIDI…";
    el.querySelector(".shelf-files").append(...[importBtn, importInput, midiBtn, midiInput].filter(Boolean));
    if (status) el.querySelector(".shelf-status").replaceWith(status);
    if (picker) {
      picker.hidden = true;
      newBox.append(picker);
      new MutationObserver(renderStarters).observe(picker, { childList: true });
    }
    return el;
  }

  // "Songs" goes back to the shelf without asking: a song here costs nothing to keep, so whatever is unsaved (or still saving) is saved
  // first, and the editor closes once it is. Only a save that fails falls through to the editor's own "discard?" question.
  function saveBeforeShelf() {
    let passing = false;
    shell.addEventListener("click", (e) => {
      const close = e.target.closest && e.target.closest("#studio-close");
      if (!close || passing) return;
      const status = () => (($("song-autosave-status") || {}).textContent || "").trim();
      const busy = () => /^(Unsaved|Saving|Autosaving|Saved, but|Save in progress|Autosave in progress)/.test(status());
      if (!busy()) return;
      e.stopImmediatePropagation();
      e.preventDefault();
      if (/^Unsaved|^Saved, but/.test(status())) {
        const name = $("song-name");
        if (name && !name.value.trim()) name.value = "New song";
        if ($("save-song") && !$("save-song").disabled) $("save-song").click();
      }
      let tries = 0;
      (function wait() {
        if (busy() && /^(Saving|Autosaving|Save in progress|Autosave in progress)/.test(status()) && tries++ < 100) return setTimeout(wait, 50);
        passing = true;
        close.click();
        passing = false;
      })();
    }, true);
  }

  // ---------- building it ----------
  let shell = null; // .studio-native, kept for the whole visit (parked while another tab is shown)
  let parking = null;
  let booting = null;
  let wasOpen = false;
  const builder = () => $("song-builder-modal");
  function showShelf(yes) {
    if (shelf) shelf.hidden = !yes;
    if (yes) renderShelf();
  }
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (src === "/song-engine.js" && window.SongEngine) return resolve();
      if (src === "/dial.js" && window.Dial) return resolve();
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.body.appendChild(s);
    });
  }
  // A new song is kept from its first change: the editor only autosaves a song that has been saved once, and a phone never asks "leave
  // this page?", so a beat made and then lost to a reload would be gone.
  function keepDrafts() {
    const status = $("song-autosave-status");
    if (!status) return;
    const isDraft = () => /^Unsaved draft/.test(status.textContent.trim());
    let timer = 0;
    new MutationObserver(() => {
      if (!isDraft()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        const name = $("song-name");
        const save = $("save-song");
        if (!isDraft() || !save || save.disabled) return;
        if (name && !name.value.trim()) name.value = "New song";
        save.click();
      }, 1200);
    }).observe(status, { childList: true, characterData: true, subtree: true });
  }
  // The editor's markup and its (scoped) stylesheet, fetched once. warm() asks for them early, while the visitor is still on another
  // page (page-slide.js loads this file when it warms the nav's pages), so opening the Studio does not wait on the network.
  let parts = null;
  function getParts() {
    const text = (url) => fetch(url, { credentials: "omit" }).then((r) => { if (!r.ok) throw new Error("The Studio could not be loaded."); return r.text(); });
    if (!parts) {
      parts = Promise.all([text("/admin/index.html"), text("/admin/style.css"), text("/studio.css")]).then(([page, css, own]) => ({ page, css: scopeCss(css), own }));
      parts.catch(() => { parts = null; });
    }
    return parts;
  }
  function warm() {
    if (shell || booting) return;
    getParts().catch(() => {});
    SCRIPTS.forEach((src) => {
      if (document.querySelector(`link[rel="prefetch"][href="${src}"]`)) return;
      const link = document.createElement("link");
      link.rel = "prefetch";
      link.as = "script";
      link.href = src;
      document.head.appendChild(link);
    });
  }

  async function boot(mount) {
    mount.innerHTML = `<p class="studio-loading" role="status">Loading the Studio…</p>`;
    const { page, css, own } = await getParts();
    const style = document.createElement("style");
    style.id = "studio-scoped-css";
    style.dataset.addedBy = "studio"; // page-slide.js leaves it out when it compares pages
    // The editor's styles, then the page's own (studio.css) after them, both in place before anything is shown: no unstyled flash.
    style.textContent = css + "\n" + own;
    document.head.appendChild(style);
    const doc = new DOMParser().parseFromString(page, "text/html");
    doc.querySelectorAll("script").forEach((s) => s.remove());
    shell = document.createElement("div");
    shell.className = "studio-native";
    const inner = document.createElement("div");
    inner.className = "studio-shell admin-body studio-app-body";
    // Only what the song editor uses: its editor, the list it keeps (hidden here), the audio export dialog and the button that opens the list.
    ["song-builder-modal", "songs-modal", "song-audio-modal"].forEach((id) => {
      const el = doc.getElementById(id);
      if (el) inner.appendChild(document.importNode(el, true));
    });
    const songsBtn = document.createElement("button");
    songsBtn.type = "button";
    songsBtn.id = "songs-btn";
    songsBtn.hidden = true;
    songsBtn.tabIndex = -1;
    inner.appendChild(songsBtn);
    shell.appendChild(inner);
    // Other app pages (public/app-kit.js) answer their own calls: anything that is not the Studio's goes on to them.
    const before = window.adminApi;
    window.adminApi = async (path, opts) => {
      try {
        return await api(path, opts);
      } catch (err) {
        if (err && err.status === 404 && before) return before(path, opts);
        throw err;
      }
    };
    window.refreshSongOptions = function () {};
    window.showContentUsage = function () {};
    mount.innerHTML = "";
    mount.appendChild(shell);
    for (const src of SCRIPTS) await loadScript(src);
    // The editor's "×" is the way back to the shelf here.
    const close = $("studio-close");
    if (close) {
      close.textContent = "Songs";
      close.classList.remove("studio-icon");
      close.classList.add("studio-btn");
      close.setAttribute("aria-label", "Your songs");
      close.title = "Your songs: open, start or delete a song";
    }
    shelf = buildShelf();
    inner.prepend(shelf);
    wireShelf();
    keepDrafts();
    saveBeforeShelf();
    // The shelf shows whenever the editor is closed.
    new MutationObserver(() => showShelf(builder().hidden)).observe(builder(), { attributes: true, attributeFilter: ["hidden"] });
    $("songs-btn").click(); // loads the editor's list and its starters
    showShelf(true);
  }
  function place(mount) {
    if (!shell) return;
    mount.innerHTML = "";
    mount.appendChild(shell);
    if (wasOpen) builder().hidden = false;
    wasOpen = false;
    showShelf(builder().hidden);
  }
  // Leaving in place (page-slide.js): stop the sound; once the page has gone, park the Studio hidden so the editor's own shortcuts sleep.
  document.addEventListener("site:leave", () => {
    stopShelf();
    if (!shell || !document.contains(shell)) return;
    if (window.SongStudioHost && window.SongStudioHost.playing && window.SongStudioHost.playing()) window.SongStudioHost.stop();
  });
  document.addEventListener("site:arrive", (e) => {
    const old = e.detail && e.detail.old;
    if (!shell || !old || !old.contains(shell)) return;
    if (!parking) {
      parking = document.createElement("div");
      parking.hidden = true;
      parking.id = "studio-parking";
      document.body.appendChild(parking);
    }
    wasOpen = !builder().hidden;
    builder().hidden = true;
    parking.appendChild(shell);
  });

  window.siteInitStudio = function (root) {
    const mount = (root || document).querySelector("#studio-mount");
    if (!mount) return;
    if (shell) return place(mount);
    if (!booting) booting = boot(mount).catch((err) => {
      console.error(err);
      booting = null;
      mount.innerHTML = `<p class="studio-loading" role="alert">${esc(err && err.message ? err.message : "The Studio could not be loaded.")}</p>`;
    });
  };
  // On another page this file was only loaded to get ready: fetch the editor while the browser is idle.
  const start = () => {
    window.siteInitStudio(document);
    if (!shell && !booting && !(navigator.connection && navigator.connection.saveData)) (window.requestIdleCallback || ((f) => setTimeout(f, 600)))(warm);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start);
  else start();
})();
