// The Studio as a public page. It is the same song builder the site's owner uses, without the admin around it: the builder's own markup is
// taken from the admin page, its server calls go to a small store in this browser instead (songs and templates in localStorage), and the
// things only the owner can do (usage, cover art in the media library, help pages) are hidden. Nothing is sent anywhere.
(function () {
  "use strict";
  const SONGS_KEY = "studio.songs.v1";
  const TEMPLATES_KEY = "studio.templates.v1";
  const MAX_SONGS = 200;
  const MAX_SONG_BYTES = 1000000;

  // ---------- the store ----------
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
    const url = new URL(path, "http://x");
    const p = url.pathname;
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
  window.adminApi = api;
  window.refreshSongOptions = function () {};
  window.showContentUsage = function () {};

  // ---------- theme: follow the site around this frame ----------
  // The page around the frame owns the light/dark choice (its button sets data-theme on its <html>); read it, and follow it when it changes.
  function followTheme() {
    let theme = null;
    try {
      theme = window.parent !== window ? window.parent.document.documentElement.getAttribute("data-theme") : null;
    } catch (e) {
      theme = null;
    }
    if (!theme) {
      try {
        theme = localStorage.getItem("theme");
      } catch (e) {
        theme = null;
      }
    }
    if (theme === "light" || theme === "dark") document.documentElement.setAttribute("data-theme", theme);
    else document.documentElement.removeAttribute("data-theme");
  }
  followTheme();
  try {
    if (window.parent !== window) new MutationObserver(followTheme).observe(window.parent.document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  } catch (e) {
    /* not framed by the site */
  }
  window.addEventListener("storage", (e) => { if (e.key === "theme") followTheme(); });

  // ---------- load the builder ----------
  const SCRIPTS = ["/song-engine.js", "/admin/song-patterns.js", "/admin/song-files.js", "/admin/song-starters.js", "/admin/song-builder.js", "/admin/song-studio.js"];
  function loadScript(src) {
    return new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = src;
      s.async = false;
      s.onload = resolve;
      s.onerror = () => reject(new Error("Could not load " + src));
      document.body.appendChild(s);
    });
  }
  const loading = document.getElementById("studio-loading");
  const say = (text) => { if (loading) loading.textContent = text; };

  async function boot() {
    const res = await fetch("/admin/index.html", { credentials: "omit" });
    if (!res.ok) throw new Error("The Studio could not be loaded.");
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    doc.body.querySelectorAll("script").forEach((s) => s.remove());
    // Everything the builder looks up by id comes with it, all of it hidden until the builder shows its own parts.
    document.body.insertAdjacentHTML("beforeend", doc.body.innerHTML);
    for (const src of SCRIPTS) await loadScript(src);
    // The list of songs is "My songs" here: they live in this browser.
    const title = document.getElementById("songs-modal-title");
    if (title) title.textContent = "My songs";
    const hint = document.querySelector("#songs-modal .redirects-hint");
    if (hint) hint.textContent = "Build a loop, a tune or a whole track with the step sequencer, the piano roll and the drum kits. Songs you make here are kept in this browser only: use Share and export to save a song file or a sound file.";
    const list = await api("/songs");
    document.getElementById("songs-btn").click();
    if (loading) loading.remove();
    if (!list.length) {
      document.getElementById("new-song-btn").click();
      return;
    }
    // Back to the song worked on last.
    const last = read(SONGS_KEY).slice().sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at)))[0];
    for (let i = 0; i < 40; i++) {
      const edit = document.querySelector(`.edit-song[data-id="${last.id}"]`);
      if (edit) {
        edit.click();
        return;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
  }
  boot().catch((err) => say(err && err.message ? err.message : "The Studio could not be loaded."));
})();
