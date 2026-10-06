// The Studio (/studio): the song builder as a page of the site, for every visitor (built on public/app-kit.js, like PicEditor, Simulations
// and Scans). The opening screen is a shelf of the visitor's own songs (kept in this browser, never sent to the site): New song and the
// starters, Open a song file or MIDI, and a card per song (a little picture of its five tracks, a Play button right on the card, open,
// Copy, Delete). The editor is the owner's song builder, opening in place under the site's nav; its Songs button comes back to the shelf,
// saving first. The kit does the rest: the admin markup and styles, the scripts, answering the editor's calls, and parking while another
// tab is shown.
(function () {
  "use strict";
  if (!window.SiteAppKit || window.siteInitStudioApp) return;
  window.siteInitStudioApp = true;
  const K = window.SiteAppKit;
  const SONGS_KEY = "studio.songs.v1";
  const TEMPLATES_KEY = "studio.templates.v1";
  const MAX_SONGS = 200;
  const MAX_SONG_BYTES = 1000000;
  const $ = (id) => document.getElementById(id);
  const esc = K.esc;
  let shelf = null;

  // ---------- the editor's calls, answered from this browser ----------
  const checkData = (data) => {
    if (!data || typeof data !== "object" || Array.isArray(data)) throw K.fail("Song data must be an object.");
    if (JSON.stringify(data).length > MAX_SONG_BYTES) throw K.fail("This song is too large to save (over 1 MB of data).");
  };
  const full = "This browser has no room left to keep songs. Delete a song, or save a song file first.";
  K.addApi((p, method, body, query) => {
    if (p === "/songs" && method === "GET") return K.readList(SONGS_KEY).map((s) => ({ id: s.id, name: s.name, updated_at: s.updated_at })).sort((a, b) => a.name.localeCompare(b.name));
    if (p === "/songs" && method === "POST") {
      const songs = K.readList(SONGS_KEY);
      if (songs.length >= MAX_SONGS) throw K.fail("That is as many songs as this browser keeps. Delete one first.");
      const name = K.cleanName(body && body.name);
      if (!name) throw K.fail("Name is required");
      checkData(body.data);
      const id = K.nextId(songs);
      songs.push({ id, name, data: body.data, updated_at: K.now() });
      K.writeList(SONGS_KEY, songs, full);
      return { id };
    }
    const one = /^\/songs\/(\d+)(\/duplicate)?$/.exec(p);
    if (one) {
      const id = Number(one[1]);
      const songs = K.readList(SONGS_KEY);
      const at = songs.findIndex((s) => s.id === id);
      if (at < 0) throw K.fail("Song not found", 404);
      if (!one[2] && method === "GET") return songs[at];
      if (!one[2] && method === "PATCH") {
        if (body && body.name !== undefined) {
          const name = K.cleanName(body.name);
          if (!name) throw K.fail("Name is required");
          songs[at].name = name;
        }
        if (body && body.data !== undefined) {
          checkData(body.data);
          songs[at].data = body.data;
        }
        songs[at].updated_at = K.now();
        K.writeList(SONGS_KEY, songs, full);
        return songs[at];
      }
      if (!one[2] && method === "DELETE") {
        songs.splice(at, 1);
        K.writeList(SONGS_KEY, songs, full);
        return { ok: true };
      }
      if (one[2] && method === "POST") {
        if (songs.length >= MAX_SONGS) throw K.fail("That is as many songs as this browser keeps. Delete one first.");
        const copy = { id: K.nextId(songs), name: K.cleanName(songs[at].name + " (copy)"), data: JSON.parse(JSON.stringify(songs[at].data)), updated_at: K.now() };
        songs.push(copy);
        K.writeList(SONGS_KEY, songs, full);
        return { id: copy.id };
      }
    }
    if (p === "/templates") {
      // Templates of other kinds (a circuit's) belong to another app page.
      const kind = (query && query.get("kind")) || (body && body.kind) || "song";
      if (kind !== "song") return undefined;
      if (method === "GET") return K.readList(TEMPLATES_KEY);
      if (method === "POST") {
        const list = K.readList(TEMPLATES_KEY);
        const name = K.cleanName(body && body.name);
        if (!name) throw K.fail("Name is required");
        checkData(body.data);
        list.push({ id: K.nextId(list), kind: "song", name, data: body.data });
        K.writeList(TEMPLATES_KEY, list, full);
        return { id: list[list.length - 1].id };
      }
    }
    return undefined;
  });

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

  // One song plays at a time, from its card; it stops when another starts, when a song is opened or when the visitor leaves the page.
  let audio = null;
  let playing = null; // { id, player, btn, name }
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

  function renderShelf() {
    if (!shelf) return;
    stopShelf();
    const list = K.readList(SONGS_KEY).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)));
    const grid = shelf.querySelector(".shelf-grid");
    grid.innerHTML = list.length
      ? list
          .map(
            (s) => `<article class="shelf-card" data-id="${s.id}">
              <button type="button" class="shelf-play" data-act="play" aria-pressed="false" aria-label="Play ${esc(s.name)}"><svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path class="i-play" d="M8 5.5v13l11-6.5z"/><path class="i-stop" d="M7 7h10v10H7z"/></svg></button>
              <button type="button" class="shelf-open" data-act="open" aria-label="Open ${esc(s.name)}">
                <span class="shelf-picture" aria-hidden="true">${cardPicture(s.data)}</span>
                <span class="shelf-name">${esc(s.name)}</span>
                <span class="shelf-when">${esc(K.whenEdited(s.updated_at))}</span>
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
      const song = K.readList(SONGS_KEY).find((s) => s.id === id);
      if (!song) return renderShelf();
      const act = btn.dataset.act;
      try {
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
          await window.adminApi(`/songs/${id}/duplicate`, { method: "POST" });
          renderShelf();
        } else if (act === "delete") {
          if (!window.confirm(`Delete "${song.name}" from this browser? This can't be undone.`)) return;
          await window.adminApi(`/songs/${id}`, { method: "DELETE" });
          renderShelf();
        }
      } catch (err) {
        const status = $("song-import-status") || shelf.querySelector(".shelf-status");
        if (status) status.textContent = err && err.message ? err.message : "That did not work.";
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
  function saveBeforeShelf(inner) {
    let passing = false;
    inner.addEventListener("click", (e) => {
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

  K.register({
    name: "studio",
    mountId: "studio-mount",
    shellClass: "studio-native",
    loadingText: "Loading the Studio…",
    scripts: ["/dial.js", "/song-engine.js", "/admin/song-patterns.js", "/admin/song-files.js", "/admin/song-starters.js", "/admin/song-builder.js", "/admin/song-studio.js"],
    // The editor, the list it keeps (hidden here) and the audio export dialog.
    dialogs: ["song-builder-modal", "songs-modal", "song-audio-modal"],
    editor: () => $("song-builder-modal"),
    // The editor listens to a button that opens its list, so it must be there before its scripts load; and a few calls it makes to the
    // admin page have nothing to do here.
    prepare(inner) {
      const songsBtn = document.createElement("button");
      songsBtn.type = "button";
      songsBtn.id = "songs-btn";
      songsBtn.hidden = true;
      songsBtn.tabIndex = -1;
      inner.appendChild(songsBtn);
      window.refreshSongOptions = function () {};
      window.showContentUsage = function () {};
    },
    build(inner) {
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
      saveBeforeShelf(inner);
      $("songs-btn").click(); // loads the editor's list and its starters
    },
    // The shelf shows whenever the editor is closed.
    shown(open) {
      if (!shelf) return;
      shelf.hidden = open;
      if (!open) renderShelf();
    },
    // Leaving in place (page-slide.js): stop the sound.
    onLeave() {
      stopShelf();
      if (window.SongStudioHost && window.SongStudioHost.playing && window.SongStudioHost.playing()) window.SongStudioHost.stop();
    },
  });
})();
