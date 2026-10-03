// Site settings > Outline: a read-only view of the project's outline.md, read from the GitHub repo (the server side is worker/outline.js).
// Nothing here can change the file: the box is read-only and the server has no way to write back.
(function () {
  var ta = document.getElementById("outline-text");
  if (!ta) return;
  var $ = function (id) { return document.getElementById(id); };
  var statusEl = $("outline-status");
  var state = { loaded: false, busy: false, matchFrom: 0 };

  function setStatus(msg, kind) {
    statusEl.textContent = msg;
    statusEl.className = "outline-status" + (kind ? " is-" + kind : "");
  }
  function refresh() {
    $("outline-reload").disabled = state.busy;
    $("outline-copy").disabled = !state.loaded;
    $("outline-download").disabled = !state.loaded;
    $("outline-find-next").disabled = !state.loaded || !$("outline-find").value;
    var lines = ta.value ? ta.value.split("\n").length : 0;
    $("outline-meta").textContent = state.loaded ? lines + " lines · " + Math.round(new Blob([ta.value]).size / 1024) + " KB · read-only" : "";
  }
  async function fetchOutline() {
    var res = await fetch("/api/admin/outline");
    var data = await res.json().catch(function () { return {}; });
    return { status: res.status, data: data };
  }
  // Headings (#, ## and ### lines) with their positions in the loaded text.
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
      var label = (h.level > 1 ? "  ".repeat(h.level - 1) : "") + h.title.slice(0, 80);
      opts.push('<option value="' + n + '">' + label.replace(/&/g, "&amp;").replace(/</g, "&lt;") + "</option>");
    });
    $("outline-headings").innerHTML = opts.join("");
  }
  // A textarea has no scroll-to-offset: measure the height of the text before the spot, then scroll there. (Read-only, so swapping the
  // value out and back for the measurement can lose nothing.)
  function showRange(start, end) {
    var full = ta.value;
    ta.value = full.slice(0, start);
    var top = ta.scrollHeight;
    ta.value = full;
    ta.focus();
    ta.setSelectionRange(start, end);
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 3);
  }
  async function load() {
    if (state.busy) return;
    state.busy = true;
    setStatus("Loading the outline from GitHub…", "");
    refresh();
    try {
      var r = await fetchOutline();
      if (r.status === 401) { setStatus("You are signed out. Sign in again.", "error"); return; }
      if (r.data.text === undefined) {
        setStatus((r.data.error || "Could not load the outline.") + (r.data.repo ? " (" + r.data.repo + ", " + r.data.branch + ")" : ""), "error");
        ta.value = "";
        ta.disabled = true;
        state.loaded = false;
        return;
      }
      ta.value = r.data.text;
      ta.disabled = false;
      ta.scrollTop = 0;
      state.loaded = true;
      state.matchFrom = 0;
      buildHeadings();
      setStatus("Loaded " + r.data.path + " from " + r.data.repo + " (" + r.data.branch + ").", "ok");
    } catch (e) {
      setStatus("Could not load the outline.", "error");
    } finally {
      state.busy = false;
      refresh();
    }
  }
  function findNext() {
    var q = $("outline-find").value;
    if (!q || !state.loaded) return;
    var hay = ta.value.toLowerCase();
    var needle = q.toLowerCase();
    var at = hay.indexOf(needle, state.matchFrom);
    var wrapped = false;
    if (at < 0 && state.matchFrom > 0) { at = hay.indexOf(needle, 0); wrapped = true; }
    if (at < 0) { setStatus("No match for “" + q + "”.", "error"); return; }
    showRange(at, at + q.length);
    state.matchFrom = at + Math.max(1, q.length);
    setStatus((wrapped ? "Back at the top: " : "") + "Match at line " + (ta.value.slice(0, at).split("\n").length) + ".", "");
  }
  async function copyAll() {
    try {
      await navigator.clipboard.writeText(ta.value);
      setStatus("Copied the whole outline.", "ok");
    } catch (e) {
      ta.focus();
      ta.select();
      setStatus("Could not copy automatically; the text is selected, press Ctrl+C.", "");
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

  $("outline-reload").addEventListener("click", load);
  $("outline-copy").addEventListener("click", copyAll);
  $("outline-download").addEventListener("click", download);
  $("outline-find-next").addEventListener("click", findNext);
  $("outline-find").addEventListener("input", function () { state.matchFrom = 0; refresh(); });
  $("outline-find").addEventListener("keydown", function (e) {
    if (e.key === "Enter") { e.preventDefault(); findNext(); }
  });
  $("outline-headings").addEventListener("change", function (e) {
    var h = e.target.value !== "" ? findHeadings()[Number(e.target.value)] : null;
    if (h) showRange(h.index, h.index);
    e.target.value = "";
  });
  document.querySelectorAll(".settings-tab").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var bar = document.querySelector(".settings-save-bar");
      if (bar) bar.hidden = btn.dataset.panel === "outline"; // nothing to save on this tab
      if (btn.dataset.panel === "outline" && !state.loaded && !state.busy) load();
    });
  });
})();
