// STUDY (temporary): the button on a page that opens a study page in a popup.
// The study page is not in the HTML: it is asked for from /api/study/unlock (a block that asks for a password only gets it back for a
// right one, and a block that does not opens straight away) and is then shown in a sandboxed frame (no access to this site's cookies,
// storage or pages). The popup opens filling the screen; on a larger screen it can be made smaller (the button in its title bar, or
// double-press the title), moved by its title and resized from any edge or corner, and the study page's size can be changed with
// the A- and A+ buttons. Closing needs a deliberate press of the x (and a confirmation): a press outside does nothing. The study page's
// progress is kept on this device and put back the next time it opens. See worker/study/README.md for how to remove it.
(function () {
  if (typeof HTMLDialogElement !== "function") return;

  var made = 0;
  var MIN_W = 320;
  var MIN_H = 240;
  var PROGRESS_KEY = "study-progress:v1:";
  var ZOOM_KEY = "study-zoom:v1";
  var phone = window.matchMedia ? window.matchMedia("(max-width: 640px)") : { matches: false };
  var DIRS = ["n", "s", "e", "w", "ne", "nw", "se", "sw"];
  var registry = []; // {frame, api} for every study page on this page, so messages can be matched to their popup
  var memory = {}; // progress, when this browser will not let it be stored

  function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
  }

  // ---- progress kept on this device ----
  function loadProgress(lab) {
    try {
      var raw = window.localStorage.getItem(PROGRESS_KEY + lab);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* fall through to memory */ }
    return memory[lab] || null;
  }
  function storeProgress(lab, state) {
    memory[lab] = state;
    try {
      window.localStorage.setItem(PROGRESS_KEY + lab, JSON.stringify(state));
      return true;
    } catch (e) {
      return false;
    }
  }
  function clearProgress(lab) {
    delete memory[lab];
    try { window.localStorage.removeItem(PROGRESS_KEY + lab); } catch (e) { /* nothing stored */ }
  }
  function loadZoom() {
    try {
      var z = Number(window.localStorage.getItem(ZOOM_KEY));
      return z >= 0.5 && z <= 3 ? z : null;
    } catch (e) {
      return null;
    }
  }
  function storeZoom(z) {
    try { window.localStorage.setItem(ZOOM_KEY, String(z)); } catch (e) { /* not essential */ }
  }

  window.addEventListener("message", function (e) {
    var d = e.data;
    if (!d || typeof d !== "object" || typeof d.study !== "string") return;
    for (var i = 0; i < registry.length; i++) {
      if (registry[i].frame.contentWindow === e.source) {
        registry[i].api.message(d);
        return;
      }
    }
  });

  function build(block, opener) {
    var n = ++made;
    var title = block.getAttribute("data-study-title") || "Study";
    var lab = block.getAttribute("data-study-lab") || "study";
    var dialog = document.createElement("dialog");
    dialog.className = "study-dialog study-max";
    dialog.setAttribute("aria-labelledby", "study-title-" + n);
    dialog.innerHTML =
      '<div class="study-bar"><h2 class="study-title" id="study-title-' + n + '"></h2>' +
      '<span class="study-saved" hidden></span>' +
      '<button type="button" class="study-tool study-smaller" aria-label="Make the study text smaller" title="Make the study text smaller" hidden>A−</button>' +
      '<button type="button" class="study-tool study-larger" aria-label="Make the study text larger" title="Make the study text larger" hidden>A+</button>' +
      '<button type="button" class="study-tool study-reset" aria-label="Start over: clear saved progress" title="Start over: clear saved progress" hidden>↺</button>' +
      '<button type="button" class="study-tool study-size" aria-label="Make the window smaller" title="Make the window smaller">❐</button>' +
      '<button type="button" class="study-tool study-close" aria-label="Close">×</button></div>' +
      '<p class="study-opening" role="status">Opening…</p>' +
      '<form class="study-gate" novalidate hidden>' +
      '<p class="study-lead">This one is locked. Enter the password to open it.</p>' +
      '<label class="study-label" for="study-pw-' + n + '">Password</label>' +
      '<input class="study-input" id="study-pw-' + n + '" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required>' +
      '<button type="submit" class="btn study-submit">Unlock</button>' +
      '<p class="study-status" role="status" aria-live="polite"></p></form>' +
      '<div class="study-stage" hidden></div>' +
      '<div class="study-confirm" role="alertdialog" aria-modal="true" aria-labelledby="study-confirm-text-' + n + '" hidden>' +
      '<div class="study-confirm-box"><p id="study-confirm-text-' + n + '"></p>' +
      '<div class="study-confirm-actions"><button type="button" class="btn study-keep">Keep studying</button>' +
      '<button type="button" class="btn btn-secondary study-leave">Close</button></div></div></div>' +
      DIRS.map(function (d) { return '<span class="study-handle study-handle-' + d + '" data-dir="' + d + '" aria-hidden="true"></span>'; }).join("");
    dialog.querySelector(".study-title").textContent = title;
    document.body.appendChild(dialog);

    var bar = dialog.querySelector(".study-bar");
    var sizeButton = dialog.querySelector(".study-size");
    var smaller = dialog.querySelector(".study-smaller");
    var larger = dialog.querySelector(".study-larger");
    var resetButton = dialog.querySelector(".study-reset");
    var saved = dialog.querySelector(".study-saved");
    var opening = dialog.querySelector(".study-opening");
    var form = dialog.querySelector(".study-gate");
    var input = dialog.querySelector(".study-input");
    var submit = dialog.querySelector(".study-submit");
    var status = dialog.querySelector(".study-status");
    var stage = dialog.querySelector(".study-stage");
    var confirmBox = dialog.querySelector(".study-confirm");
    var keepButton = dialog.querySelector(".study-keep");
    var leaveButton = dialog.querySelector(".study-leave");
    var frame = null;
    var html = "";

    // ---- size and place: filling the screen, or a window of its own ----
    var maximized = true;
    var rect = null; // {left, top, width, height} in px, while it is a window

    function bounds() {
      return { w: document.documentElement.clientWidth || window.innerWidth, h: window.innerHeight };
    }
    function fit(r) {
      var b = bounds();
      var width = clamp(r.width, Math.min(MIN_W, b.w), b.w);
      var height = clamp(r.height, Math.min(MIN_H, b.h), b.h);
      return { width: width, height: height, left: clamp(r.left, 0, b.w - width), top: clamp(r.top, 0, b.h - height) };
    }
    function layout() {
      var windowed = !(maximized || phone.matches || !rect);
      if (!windowed) {
        dialog.classList.add("study-max");
        ["left", "top", "width", "height"].forEach(function (k) { dialog.style[k] = ""; });
      } else {
        rect = fit(rect);
        dialog.classList.remove("study-max");
        dialog.style.left = rect.left + "px";
        dialog.style.top = rect.top + "px";
        dialog.style.width = rect.width + "px";
        dialog.style.height = rect.height + "px";
      }
      var label = windowed ? "Fill the screen" : "Make the window smaller";
      sizeButton.setAttribute("aria-label", label);
      sizeButton.title = label;
      sizeButton.textContent = windowed ? "⤢" : "❐";
      applyZoom();
    }
    function toggleSize() {
      if (phone.matches) return;
      if (maximized) {
        var b = bounds();
        if (!rect) {
          var width = Math.round(b.w * 0.7);
          var height = Math.round(b.h * 0.75);
          rect = { width: width, height: height, left: Math.round((b.w - width) / 2), top: Math.round((b.h - height) / 2) };
        }
        maximized = false;
      } else {
        maximized = true;
      }
      layout();
    }
    sizeButton.addEventListener("click", toggleSize);
    bar.addEventListener("dblclick", function (e) {
      if (!e.target.closest("button")) toggleSize();
    });
    window.addEventListener("resize", function () {
      if (dialog.open && !maximized) layout();
      else applyZoom();
    });

    // ---- the study page's own size (A- / A+), automatic until a reader picks one ----
    var zoomPick = loadZoom();
    var lastZoom = 0;
    function autoZoom() {
      var w = stage.clientWidth || bounds().w;
      return clamp(Math.round((w / 700) * 10) / 10, 1, 1.6);
    }
    function applyZoom() {
      if (!frame) return;
      var z = zoomPick || autoZoom();
      if (z === lastZoom) return;
      lastZoom = z;
      try { frame.contentWindow.postMessage({ study: "zoom", value: z }, "*"); } catch (e) { /* not loaded yet */ }
    }
    function nudgeZoom(step) {
      var z = Math.round(clamp((zoomPick || autoZoom()) + step, 0.6, 2.4) * 10) / 10;
      zoomPick = z;
      storeZoom(z);
      lastZoom = 0;
      applyZoom();
    }
    smaller.addEventListener("click", function () { nudgeZoom(-0.1); });
    larger.addEventListener("click", function () { nudgeZoom(0.1); });
    if (window.ResizeObserver) new ResizeObserver(function () { if (!zoomPick) applyZoom(); }).observe(stage);

    // ---- moving by the title, resizing from the edges ----
    var drag = null;
    function startDrag(e, kind, dir) {
      if (e.button > 0 || maximized || phone.matches || !rect) return;
      e.preventDefault();
      drag = { kind: kind, dir: dir, x: e.clientX, y: e.clientY, start: { left: rect.left, top: rect.top, width: rect.width, height: rect.height }, el: e.currentTarget };
      dialog.classList.add("study-dragging");
      try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* not essential */ }
    }
    function moveDrag(e) {
      if (!drag) return;
      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      var s = drag.start;
      var b = bounds();
      if (drag.kind === "move") {
        // The window stays wholly on screen, so it can always be grabbed again.
        rect = { width: s.width, height: s.height, left: clamp(s.left + dx, 0, Math.max(0, b.w - s.width)), top: clamp(s.top + dy, 0, Math.max(0, b.h - s.height)) };
      } else {
        var left = s.left;
        var top = s.top;
        var right = s.left + s.width;
        var bottom = s.top + s.height;
        if (drag.dir.indexOf("e") >= 0) right = clamp(right + dx, left + Math.min(MIN_W, b.w), b.w);
        if (drag.dir.indexOf("w") >= 0) left = clamp(left + dx, 0, right - Math.min(MIN_W, b.w));
        if (drag.dir.indexOf("s") >= 0) bottom = clamp(bottom + dy, top + Math.min(MIN_H, b.h), b.h);
        if (drag.dir.indexOf("n") >= 0) top = clamp(top + dy, 0, bottom - Math.min(MIN_H, b.h));
        rect = { left: left, top: top, width: right - left, height: bottom - top };
      }
      dialog.style.left = rect.left + "px";
      dialog.style.top = rect.top + "px";
      dialog.style.width = rect.width + "px";
      dialog.style.height = rect.height + "px";
    }
    function endDrag() {
      if (!drag) return;
      drag = null;
      dialog.classList.remove("study-dragging");
    }
    bar.addEventListener("pointerdown", function (e) {
      if (e.target.closest("button")) return;
      startDrag(e, "move", null);
    });
    Array.prototype.forEach.call(dialog.querySelectorAll(".study-handle"), function (h) {
      h.addEventListener("pointerdown", function (e) { startDrag(e, "resize", h.getAttribute("data-dir")); });
    });
    dialog.addEventListener("pointermove", moveDrag);
    dialog.addEventListener("pointerup", endDrag);
    dialog.addEventListener("pointercancel", endDrag);
    dialog.addEventListener("lostpointercapture", endDrag);

    // ---- closing: only by the x, and only after a confirmation (nothing outside the popup closes it) ----
    function reallyClose() {
      confirmBox.hidden = true;
      stage.inert = false;
      if (frame) { try { frame.contentWindow.postMessage({ study: "flush" }, "*"); } catch (e) { /* gone */ } }
      if (dialog.open) dialog.close();
    }
    function askClose() {
      if (!frame) { reallyClose(); return; } // nothing to lose before the study page has opened
      dialog.querySelector("#study-confirm-text-" + n).textContent = "Close the study? Your progress is saved on this device, so you can pick up where you left off.";
      confirmBox.hidden = false;
      stage.inert = true;
      keepButton.focus();
    }
    function keepOpen() {
      confirmBox.hidden = true;
      stage.inert = false;
      if (frame) frame.focus();
    }
    dialog.querySelector(".study-close").addEventListener("click", askClose);
    keepButton.addEventListener("click", keepOpen);
    leaveButton.addEventListener("click", reallyClose);
    // Esc asks too (instead of closing at once); while the question is showing it means "keep studying".
    dialog.addEventListener("cancel", function (e) {
      e.preventDefault();
      if (!confirmBox.hidden) keepOpen();
      else askClose();
    });
    dialog.addEventListener("keydown", function (e) {
      if (e.key !== "Escape") return;
      e.preventDefault();
      if (!confirmBox.hidden) keepOpen();
      else askClose();
    });
    dialog.addEventListener("close", function () {
      endDrag();
      document.documentElement.classList.remove("study-is-open");
      if (document.contains(opener) && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    });

    // ---- progress: the study page reports it, and gets it back when it opens ----
    var savedTimer = null;
    function showSaved() {
      saved.hidden = false;
      saved.textContent = "Saved";
      if (savedTimer) clearTimeout(savedTimer);
      savedTimer = setTimeout(function () { saved.hidden = true; }, 2500);
    }
    function startOver() {
      if (!window.confirm("Start over? This clears the progress saved on this device.")) return;
      clearProgress(lab);
      if (frame) {
        lastZoom = 0;
        frame.srcdoc = "";
        frame.srcdoc = html;
      }
    }
    resetButton.addEventListener("click", startOver);
    var api = {
      message: function (d) {
        if (d.study === "ready") {
          try { frame.contentWindow.postMessage({ study: "restore", state: loadProgress(lab) }, "*"); } catch (e) { /* gone */ }
          lastZoom = 0;
          applyZoom();
        } else if (d.study === "save") {
          if (d.state && typeof d.state === "object" && !Array.isArray(d.state)) {
            var ok;
            try { ok = JSON.stringify(d.state).length < 2000000; } catch (e) { ok = false; }
            if (ok) {
              storeProgress(lab, d.state);
              showSaved();
            }
          }
        } else if (d.study === "corrupt") {
          // Saved progress the study page could not use: forget it and start the page again.
          clearProgress(lab);
          if (frame) { lastZoom = 0; frame.srcdoc = ""; frame.srcdoc = html; }
        }
      },
    };

    // ---- the password, and opening the study page ----
    function say(text) {
      status.textContent = text;
    }
    function showFrame(text) {
      input.value = "";
      say("");
      opening.hidden = true;
      html = text;
      frame = document.createElement("iframe");
      frame.className = "study-frame";
      frame.title = title;
      frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
      registry.push({ frame: frame, api: api });
      frame.srcdoc = html;
      stage.appendChild(frame);
      form.hidden = true;
      stage.hidden = false;
      [smaller, larger, resetButton].forEach(function (b) { b.hidden = false; });
      frame.focus();
    }
    function showForm() {
      opening.hidden = true;
      form.hidden = false;
      input.focus();
    }

    // Asks for the study page. `probing` is the first ask, made with no password: a block that needs none just opens, otherwise the form shows.
    function attempt(password, probing) {
      if (!probing) {
        submit.disabled = true;
        say("Checking…");
      }
      return fetch("/api/study/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: Number(block.getAttribute("data-study-block")), password: password }),
      })
        .then(function (res) {
          if (res.ok) return res.text().then(function (text) { return { html: text }; });
          return res.json().then(
            function (body) { return { error: (body && body.error) || "That didn't work.", needs: !!(body && body.needsPassword), status: res.status }; },
            function () { return { error: "Something went wrong on the site (error " + res.status + "). Try again in a minute.", status: res.status }; }
          );
        })
        .then(function (result) {
          submit.disabled = false;
          if (result.html != null) {
            showFrame(result.html);
            return;
          }
          if (probing) {
            // No password was typed yet, so "type the password" is not news; anything else (too many tries, a server error) is.
            showForm();
            say(result.needs ? "" : result.error);
            return;
          }
          say(result.error);
          input.select();
        })
        .catch(function () {
          submit.disabled = false;
          if (probing) showForm();
          say("Couldn't reach the site. Check your connection and try again.");
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input.value.trim()) {
        say("Type the password first.");
        input.focus();
        return;
      }
      attempt(input.value, false);
    });

    dialog._probe = function () {
      attempt("", true);
    };
    dialog._focusStart = function () {
      if (frame) frame.focus();
      else if (!form.hidden) input.focus();
    };
    layout();
    return dialog;
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest && e.target.closest(".study-block .study-open");
    if (!button) return;
    var block = button.closest(".study-block");
    if (!block._studyDialog) block._studyDialog = build(block, button);
    var dialog = block._studyDialog;
    document.documentElement.classList.add("study-is-open");
    if (!dialog.open) dialog.showModal();
    if (!dialog._probed) {
      dialog._probed = true;
      dialog._probe();
    }
    dialog._focusStart();
  });
})();
