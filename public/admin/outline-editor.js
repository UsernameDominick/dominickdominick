// Site settings > Outline: edit the project's outline.md in the GitHub repo (the server side is worker/outline.js).
// The text is loaded from GitHub when the tab opens and saved back as one commit. If the file changed on GitHub in the meantime the save is
// refused and the editor offers to load the latest, save over it, or download your version first.
(function () {
  var ta = document.getElementById("outline-text");
  if (!ta) return;
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("outline-status");
  var state = { sha: null, saved: "", loaded: false, busy: false, items: null, conflictSha: null };

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "outline-status" + (kind ? " is-" + kind : "");
  }
  function dirty() {
    return state.loaded && ta.value !== state.saved;
  }
  function refresh() {
    var d = dirty();
    $("outline-save").disabled = !state.loaded || state.busy || !d;
    $("outline-reload").disabled = state.busy;
    $("outline-download").disabled = !state.loaded;
    var bytes = new Blob([ta.value]).size;
    var lines = ta.value ? ta.value.split("\n").length : 0;
    $("outline-meta").textContent = state.loaded ? lines + " lines · " + Math.round(bytes / 1024) + " KB" + (d ? " · unsaved changes" : " · saved") : "";
  }
  async function call(method, body) {
    var res = await fetch("/api/admin/outline", {
      method: method,
      headers: { "Content-Type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    });
    var data = await res.json().catch(function () { return {}; });
    return { status: res.status, data: data };
  }
  // Headings (#, ## and ### lines) found in the text as it is right now; the menu stores each one's number, not its position.
  function findHeadings() {
    var out = [];
    var re = /^(#{1,3}) +(.+)$/gm;
    var m;
    while ((m = re.exec(ta.value)) && out.length < 200) out.push({ index: m.index, level: m[1].length, title: m[2].trim() });
    return out;
  }
  function buildHeadings() {
    var opts = ['<option value="">Sections…</option>'];
    findHeadings().forEach(function (h, n) {
      var label = (h.level > 1 ? "\u00a0\u00a0".repeat(h.level - 1) : "") + h.title.slice(0, 80);
      opts.push('<option value="' + n + '">' + label.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</option>");
    });
    $("outline-headings").innerHTML = opts.join("");
  }
  function jumpTo(index) {
    var full = ta.value;
    ta.focus();
    // Measure how tall the text before the heading is, so the box can scroll there (a textarea has no scroll-to-offset).
    ta.value = full.slice(0, index);
    var top = ta.scrollHeight;
    ta.value = full;
    ta.setSelectionRange(index, index);
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 4);
  }
  async function load(force) {
    if (state.busy) return;
    if (!force && dirty() && !window.confirm("Throw away your unsaved changes and load the outline from GitHub?")) return;
    state.busy = true;
    $("outline-conflict").hidden = true;
    setStatus("Loading the outline from GitHub…", "");
    refresh();
    try {
      var r = await call("GET");
      if (r.status === 401) { setStatus("You are signed out. Sign in again.", "error"); return; }
      if (r.data.error && r.data.text === undefined) {
        setStatus(r.data.error + (r.data.repo ? " (" + r.data.repo + ", " + r.data.branch + ")" : ""), "error");
        ta.disabled = true;
        state.loaded = false;
        return;
      }
      ta.value = r.data.text;
      ta.disabled = false;
      state.saved = r.data.text;
      state.sha = r.data.sha;
      state.loaded = true;
      buildHeadings();
      setStatus("Loaded " + r.data.path + " from " + r.data.repo + " (" + r.data.branch + ").", "ok");
    } catch (e) {
      setStatus("Could not load the outline.", "error");
    } finally {
      state.busy = false;
      refresh();
    }
  }
  async function save(sha) {
    if (state.busy || !state.loaded) return;
    state.busy = true;
    refresh();
    setStatus("Saving to GitHub…", "");
    try {
      var r = await call("PUT", { text: ta.value, sha: sha || state.sha, message: $("outline-message").value });
      if (r.status === 409 && r.data.conflict) {
        state.conflictSha = r.data.sha;
        $("outline-conflict").hidden = false;
        setStatus(r.data.error, "error");
        return;
      }
      if (r.status === 401) { setStatus("You are signed out. Sign in again.", "error"); return; }
      if (r.status === 429) { setStatus(r.data.error || "Too many saves. Wait a minute.", "error"); return; }
      if (!r.data.ok) { setStatus(r.data.error || "Could not save.", "error"); return; }
      state.saved = ta.value;
      if (r.data.sha) state.sha = r.data.sha;
      else { state.busy = false; await load(true); return; }
      $("outline-conflict").hidden = true;
      $("outline-message").value = "";
      setStatus("Saved to GitHub.", "ok");
    } catch (e) {
      setStatus("Could not save.", "error");
    } finally {
      state.busy = false;
      refresh();
    }
  }
  function download() {
    var a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ta.value], { type: "text/markdown" }));
    a.download = "outline.md";
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 0);
  }

  // ---- citing pages, articles and projects ----
  async function loadItems() {
    if (state.items) return;
    var lists = await Promise.all(["pages", "articles", "projects"].map(function (k) {
      return fetch("/api/admin/" + k).then(function (r) { return r.ok ? r.json() : []; }).catch(function () { return []; });
    }));
    var items = [];
    (lists[0] || []).forEach(function (p) { items.push({ type: "Page", title: p.title || p.slug, url: p.slug === "home" ? "/" : "/" + p.slug }); });
    (lists[1] || []).forEach(function (a) { items.push({ type: "Article", title: a.title || a.slug, url: "/random/" + a.slug }); });
    (lists[2] || []).forEach(function (p) { items.push({ type: "Project", title: p.title || p.slug, url: "/projects/" + p.slug }); });
    state.items = items;
  }
  function fillItems() {
    var q = $("outline-link-filter").value.trim().toLowerCase();
    var sel = $("outline-link-select");
    var shown = (state.items || []).filter(function (it) { return !q || (it.type + " " + it.title + " " + it.url).toLowerCase().indexOf(q) >= 0; }).slice(0, 200);
    sel.innerHTML = shown.length
      ? shown.map(function (it, i) { return '<option value="' + i + '">' + it.type + ": " + it.title.replace(/&/g, "&amp;").replace(/</g, "&lt;") + " (" + it.url + ")</option>"; }).join("")
      : '<option value="">No matches</option>';
    sel._shown = shown;
  }
  function insertLink() {
    var sel = $("outline-link-select");
    var it = sel._shown && sel._shown[Number(sel.value)];
    if (!it || ta.disabled) return;
    var text = "[" + it.title.replace(/[\[\]]/g, "") + "](" + it.url + ")";
    var s = ta.selectionStart;
    var e = ta.selectionEnd;
    ta.setRangeText(text, s, e, "end");
    ta.focus();
    rebuildSoon();
    refresh();
  }

  var headingTimer = null;
  var rebuildSoon = function () {
    clearTimeout(headingTimer);
    headingTimer = setTimeout(buildHeadings, 400); // headings you add or rename reach the menu shortly after you stop typing
  };
  ta.addEventListener("input", function () {
    rebuildSoon();
    refresh();
    if (!state.busy) setStatus(dirty() ? "Unsaved changes." : "No changes since the last save.", "");
  });
  $("outline-save").addEventListener("click", function () { save(); });
  $("outline-reload").addEventListener("click", function () { load(false); });
  $("outline-download").addEventListener("click", download);
  $("outline-conflict-reload").addEventListener("click", function () { load(true); });
  $("outline-conflict-overwrite").addEventListener("click", function () { save(state.conflictSha); });
  $("outline-conflict-download").addEventListener("click", download);
  $("outline-headings").addEventListener("change", function (e) {
    var list = findHeadings();
    var h = e.target.value !== "" ? list[Number(e.target.value)] : null;
    if (h) jumpTo(h.index);
    e.target.value = "";
  });

  $("outline-link-filter").addEventListener("input", fillItems);
  $("outline-link-insert").addEventListener("click", insertLink);
  // Ctrl/Cmd+S anywhere in this tab saves the outline (not the browser's page dialog, and not the general settings save the page's own
  // Ctrl+S would otherwise run for the open dialog).
  document.querySelector('.settings-panel[data-panel="outline"]').addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && String(e.key).toLowerCase() === "s") {
      e.preventDefault();
      e.stopPropagation();
      save();
    }
  });
  window.addEventListener("beforeunload", function (e) {
    if (dirty()) {
      e.preventDefault();
      e.returnValue = "";
    }
  });
  document.querySelectorAll(".settings-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var bar = document.querySelector(".settings-save-bar");
      if (bar) bar.hidden = btn.dataset.panel === "outline"; // the outline has its own Save
      if (btn.dataset.panel === "outline") {
        if (!state.loaded && !state.busy) load(true);
        loadItems().then(fillItems);
      }
    });
  });
})();
