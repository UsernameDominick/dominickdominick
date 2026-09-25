// Fire-and-forget named event tracking, shared by this file and the other
// deferred public scripts (article-extras.js, sim-player.js) — this file is
// a plain synchronous <script>, so it always finishes before those deferred
// ones start, making window.trackEvent reliably available to them.
window.trackEvent = function (name, detail) {
  try {
    var payload = JSON.stringify({ name: name, path: location.pathname, detail: detail || null });
    if (navigator.sendBeacon) navigator.sendBeacon("/api/track", payload);
    else fetch("/api/track", { method: "POST", body: payload, keepalive: true });
  } catch (e) {}
};

// Outbound-link and download tracking, site-wide. A "download" match wins
// over "outbound" even for an external host, since knowing which file
// left is more useful than just knowing a click left the site. A block
// with an admin-configured custom event name (currently just the Button
// block's "Track clicks as" field) wins over both of those — the admin
// named this click on purpose, so that's the more useful signal.
document.addEventListener("click", function (e) {
  var a = e.target.closest("a[href]");
  if (!a) return;
  var href = a.getAttribute("href");
  if (!href) return;
  if (a.dataset.trackEvent) {
    window.trackEvent(a.dataset.trackEvent, href);
    return;
  }
  if (a.hasAttribute("download") || /\.(zip|pdf|glb|gltf|usdz|dmg|exe|apk|csv|docx?|xlsx?|pptx?)(\?|$)/i.test(href) || href.indexOf("/media/") === 0) {
    window.trackEvent("download", href);
    return;
  }
  if (!/^https?:\/\//i.test(href)) return;
  try {
    var url = new URL(href, location.href);
    if (url.hostname === location.hostname) return;
    window.trackEvent("outbound_link", url.href);
  } catch (err) {}
});

// Before/after comparison blocks — the slider just writes its value to a
// CSS custom property the overlay image's clip-path reads, so there's no
// per-block JS instance to set up, just one delegated listener site-wide.
document.addEventListener("input", function (e) {
  if (!e.target.classList.contains("before-after-slider")) return;
  var wrap = e.target.closest(".before-after");
  if (wrap) wrap.style.setProperty("--pos", e.target.value + "%");
});

// Reading history — entirely client-side (localStorage), never sent to the
// server. Only records article/project detail pages, identified by URL
// shape rather than a data attribute so it needs no server changes at all.
(function () {
  var HISTORY_KEY = "reading_history";
  var MAX_ENTRIES = 100;

  function readHistory() {
    try {
      var raw = localStorage.getItem(HISTORY_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }

  function writeHistory(list) {
    try {
      localStorage.setItem(HISTORY_KEY, JSON.stringify(list));
    } catch (e) {}
  }

  function recordVisit() {
    var m = location.pathname.match(/^\/(random|projects)\/([a-z0-9-]+)$/);
    if (!m) return;
    var type = m[1] === "random" ? "article" : "project";
    var title = document.title.replace(/\s*·\s*Dominick\s*$/, "");
    var list = readHistory().filter(function (e) {
      return e.url !== location.pathname;
    });
    list.unshift({ type: type, url: location.pathname, title: title, visitedAt: new Date().toISOString() });
    writeHistory(list.slice(0, MAX_ENTRIES));
  }
  recordVisit();

  // nav.js runs synchronously in <head>-adjacent position, before <main>
  // (and #reading-history-list inside it) has even been parsed yet — has
  // to wait for the DOM to actually exist before querying it.
  function renderHistoryPage() {
    var container = document.getElementById("reading-history-list");
    if (!container) return;
    var list = readHistory();
    if (!list.length) {
      container.innerHTML = '<p class="empty-hint">Nothing viewed yet.</p>';
      return;
    }
    var rows = list
      .map(function (e) {
        var d = new Date(e.visitedAt);
        var dateStr = isNaN(d) ? "" : d.toLocaleDateString();
        var span = document.createElement("span");
        span.textContent = e.title;
        var typeSpan = document.createElement("span");
        typeSpan.className = "topic-count";
        typeSpan.textContent = e.type;
        return (
          '<li><time>' + dateStr + '</time> <a href="' + e.url + '">' + span.innerHTML + "</a> " + typeSpan.outerHTML + "</li>"
        );
      })
      .join("");
    container.innerHTML = '<ul class="archive-list">' + rows + "</ul>";
    var clearBtn = document.getElementById("clear-history-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        writeHistory([]);
        renderHistoryPage();
      });
    }
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", renderHistoryPage);
  } else {
    renderHistoryPage();
  }
})();

(function () {
  var active = document.querySelector(".tab.is-active");
  var wrap = document.querySelector(".tabs");
  if (!active || !wrap) return;

  function place() {
    var w = wrap.getBoundingClientRect();
    var t = active.getBoundingClientRect();
    wrap.style.setProperty("--indicator-width", t.width + "px");
    wrap.style.setProperty("--indicator-x", (t.left - w.left) + "px");
  }

  place();
  window.addEventListener("resize", place);
})();

// "Turn off preview mode" button inside the draft-preview banner (see
// renderPreviewBannerHtml in worker/render.js) — clears the cookie the
// admin's "Preview mode" toggle set and reloads, landing back on this
// same URL now showing whatever a normal visitor would actually see
// (a 404, if this page is only reachable in preview at all). The banner
// lives in <main>, which comes *after* this script tag in the page (see
// renderShell), so — unlike the header buttons above, already in the DOM
// by the time this plain synchronous script runs — this one has to wait
// for the rest of the page to parse first.
(function () {
  function wire() {
    var btn = document.getElementById("preview-mode-off-btn");
    if (!btn) return;
    btn.addEventListener("click", function () {
      document.cookie = "preview_mode=; path=/; max-age=0";
      location.reload();
    });
  }
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }
})();

// Nav dropdown caret — hover/focus-within alone (pure CSS) already covers
// mouse and keyboard use; this just adds a click-to-toggle path for touch,
// where hover never fires. Only one dropdown open at a time, closed by an
// outside click or Escape (same pattern as the search-suggest dropdown above).
(function () {
  var carets = document.querySelectorAll(".tab-caret");
  if (!carets.length) return;
  function closeAll(except) {
    document.querySelectorAll(".tab-group.open").forEach(function (g) {
      if (g !== except) {
        g.classList.remove("open");
        var c = g.querySelector(".tab-caret");
        if (c) c.setAttribute("aria-expanded", "false");
      }
    });
  }
  carets.forEach(function (caret) {
    caret.addEventListener("click", function (e) {
      e.preventDefault();
      var group = caret.closest(".tab-group");
      var willOpen = !group.classList.contains("open");
      closeAll();
      group.classList.toggle("open", willOpen);
      caret.setAttribute("aria-expanded", willOpen ? "true" : "false");
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".tab-group")) closeAll();
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "Escape") closeAll();
  });
})();

(function () {
  var searchInput = document.querySelector(".site-search input");
  if (!searchInput) return;
  document.addEventListener("keydown", function (e) {
    var tag = (e.target.tagName || "").toLowerCase();
    var typing = tag === "input" || tag === "textarea" || e.target.isContentEditable;
    if (e.key === "/" && !typing) {
      e.preventDefault();
      searchInput.focus();
    } else if (e.key === "Escape" && document.activeElement === searchInput) {
      searchInput.blur();
    }
  });
})();

(function () {
  // Type-ahead suggestions for the topbar search box — hits
  // /api/search-suggest (debounced) rather than a full /search page load
  // per keystroke.
  var input = document.querySelector(".site-search input");
  var list = document.getElementById("search-suggest-list");
  if (!input || !list) return;
  var debounceTimer = null;
  var activeIndex = -1;
  var items = [];

  function closeList() {
    list.hidden = true;
    list.innerHTML = "";
    items = [];
    activeIndex = -1;
    input.setAttribute("aria-expanded", "false");
  }

  function render(results) {
    items = results;
    activeIndex = -1;
    if (!results.length) return closeList();
    list.innerHTML = results
      .map(function (r) {
        return (
          '<a class="search-suggest-item" href="' +
          r.url +
          '">' +
          r.title.replace(/</g, "&lt;") +
          '<span class="search-suggest-type">' +
          r.type +
          "</span></a>"
        );
      })
      .join("");
    list.hidden = false;
    input.setAttribute("aria-expanded", "true");
  }

  function fetchSuggestions(q) {
    if (!q) return closeList();
    fetch("/api/search-suggest?q=" + encodeURIComponent(q))
      .then(function (r) { return r.json(); })
      .then(function (data) { render(data.results || []); })
      .catch(function () {});
  }

  input.addEventListener("input", function () {
    clearTimeout(debounceTimer);
    var q = input.value.trim();
    debounceTimer = setTimeout(function () { fetchSuggestions(q); }, 200);
  });

  input.addEventListener("keydown", function (e) {
    var links = list.querySelectorAll(".search-suggest-item");
    if (!links.length || list.hidden) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      activeIndex = Math.min(activeIndex + 1, links.length - 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      activeIndex = Math.max(activeIndex - 1, 0);
    } else if (e.key === "Enter" && activeIndex >= 0) {
      e.preventDefault();
      window.location.href = links[activeIndex].getAttribute("href");
      return;
    } else {
      return;
    }
    links.forEach(function (l, i) { l.classList.toggle("active", i === activeIndex); });
  });

  document.addEventListener("click", function (e) {
    if (e.target !== input && !list.contains(e.target)) closeList();
  });
  input.addEventListener("blur", function () {
    // Let a click on a suggestion register before the list disappears.
    setTimeout(closeList, 150);
  });
})();

(function () {
  // This script tag sits before <main> in the document (see renderShell),
  // so the block content [data-animate] elements live in hasn't been
  // parsed yet when this runs synchronously — wait for the full document.
  document.addEventListener("DOMContentLoaded", function () {
    var targets = document.querySelectorAll("[data-animate]");
    if (!targets.length) return;
    var reducedMotion = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reducedMotion || !("IntersectionObserver" in window)) {
      // Reduced motion (or no observer support): the CSS never defines an
      // animated state for these anyway, so adding the class is a harmless
      // no-op there — this just also skips setting up an observer for nothing.
      targets.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 }
    );
    targets.forEach(function (el) { observer.observe(el); });
  });
})();

(function () {
  // Event delegation — no DOMContentLoaded wait needed since this only
  // binds a listener on document itself, not on the not-yet-parsed content.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".tab-strip-btn");
    if (!btn) return;
    var strip = btn.closest(".tab-strip");
    var block = btn.closest(".tabs-block");
    if (!strip || !block) return;
    var index = Array.prototype.indexOf.call(strip.querySelectorAll(".tab-strip-btn"), btn);
    strip.querySelectorAll(".tab-strip-btn").forEach(function (b, i) {
      b.classList.toggle("is-active", i === index);
      b.setAttribute("aria-selected", i === index ? "true" : "false");
    });
    block.querySelectorAll(".tab-panel").forEach(function (panel, i) {
      panel.classList.toggle("is-active", i === index);
      if (i === index) panel.removeAttribute("hidden");
      else panel.setAttribute("hidden", "");
    });
  });
})();

(function () {
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var root = document.documentElement;
    var current = root.getAttribute("data-theme") || "dark";
    var next = current === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
    window.trackEvent("theme_toggle", next);
  });
})();

// Manual "reduce motion" override — independent of (and in addition to)
// the OS-level prefers-reduced-motion setting, for a visitor whose OS
// default is fine with motion but who wants it off just for this site.
// The CSS side (`[data-motion="reduce"]` overrides in style.css) mirrors
// exactly what the OS-driven `@media (prefers-reduced-motion)` scoping
// already does — same visual result, just reachable without changing OS
// settings.
(function () {
  var btn = document.getElementById("motion-toggle");
  if (!btn) return;
  var root = document.documentElement;
  var update = function () {
    var reduced = root.getAttribute("data-motion") === "reduce";
    btn.setAttribute("aria-pressed", reduced ? "true" : "false");
    btn.textContent = reduced ? "▶" : "⏸";
    btn.title = reduced ? "Turn animations back on" : "Turn off entrance/hover animations";
  };
  update();
  btn.addEventListener("click", function () {
    var next = root.getAttribute("data-motion") === "reduce" ? "" : "reduce";
    if (next) root.setAttribute("data-motion", next);
    else root.removeAttribute("data-motion");
    try {
      localStorage.setItem("motion", next);
    } catch (e) {}
    update();
    window.trackEvent("motion_toggle", next || "default");
  });
})();

// Manual text-size toggle — cycles through a few preset scales rather
// than separate A+/A- buttons, matching the single-icon-button
// convention the theme/motion toggles already use in this header. Sets
// a CSS custom property the base `html` font-size reads (see style.css),
// so every rem-based size on the site scales from it.
(function () {
  var btn = document.getElementById("font-size-toggle");
  if (!btn) return;
  var SCALES = [1, 1.15, 1.3, 0.9];
  var root = document.documentElement;
  var current = parseFloat(localStorage.getItem("fontScale")) || 1;
  var apply = function (scale) {
    current = scale;
    if (scale === 1) root.style.removeProperty("--font-scale");
    else root.style.setProperty("--font-scale", scale);
    btn.title = "Text size: " + Math.round(scale * 100) + "% (click to change)";
    try {
      localStorage.setItem("fontScale", String(scale));
    } catch (e) {}
  };
  apply(current);
  btn.addEventListener("click", function () {
    var idx = SCALES.indexOf(current);
    var next = SCALES[(idx + 1) % SCALES.length];
    apply(next);
    window.trackEvent("font_size_toggle", String(next));
  });
})();

// A project's hero video has no `autoplay` attribute in the server-rendered
// HTML (see renderHeroVideoHtml in worker/render.js) — whether it plays is
// decided here instead, since only the client knows both the OS-level
// prefers-reduced-motion setting and this site's own manual motion toggle
// above. Re-synced on every click of that toggle, same as the CSS overrides
// it already drives.
(function () {
  var videos = document.querySelectorAll(".project-hero-video");
  if (!videos.length) return;
  var prefersReducedMotion = function () {
    return (
      document.documentElement.getAttribute("data-motion") === "reduce" ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)
    );
  };
  var sync = function () {
    for (var i = 0; i < videos.length; i++) {
      if (prefersReducedMotion()) videos[i].pause();
      else videos[i].play().catch(function () {});
    }
  };
  sync();
  var motionBtn = document.getElementById("motion-toggle");
  if (motionBtn) motionBtn.addEventListener("click", sync);
})();
