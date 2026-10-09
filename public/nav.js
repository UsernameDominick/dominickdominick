(function () {
  var wrap = document.querySelector(".tabs");
  if (!wrap) return;
  var nav = wrap.closest(".site-nav") || wrap;

  // The nav is a dial. The strip of stops scrolls sideways and snaps one stop at a time under the needle in the middle; the stop under the
  // needle is the biggest and the others step down in size the farther they are from it (--d on each stop is its distance from the middle,
  // in stops; the CSS turns it into a size). The stop you are on is the one in the middle. Drag the dial (a finger on a phone) and, as it
  // settles on a stop, that page comes in; on a screen with room, click the stop you want and it turns to the middle and goes there.
  // Settings is a stop like the rest but only opens its dialog when it is pressed, never because the dial happened to land on it.
  var stops = [];
  var anchors = [];
  var centres = []; // each stop's middle, in the strip's own coordinates (from the left edge of its scrolled content)
  var pitch = 72;
  var touching = false;
  var userAt = 0; // when the visitor last moved the dial (a touch, a sideways wheel, or the glide that follows)
  var progUntil = 0; // until when a scroll is this script turning the dial itself, which must never count as the visitor's choice
  var interacted = false; // the visitor has moved the dial on a page that has no tab of its own
  var commitTimer = 0;
  var painting = 0;

  function now() { return Date.now(); }
  function reduced() {
    return document.documentElement.getAttribute("data-motion") === "reduce" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  // Everything is measured in the strip's own coordinates, so a tick, a stop and the middle agree wherever the strip is scrolled to.
  function origin() {
    return wrap.getBoundingClientRect().left + wrap.clientLeft - wrap.scrollLeft;
  }
  function measure() {
    stops = [].slice.call(wrap.querySelectorAll(":scope > .tab"));
    anchors = stops;
    var o = origin();
    centres = anchors.map(function (a) { var b = a.getBoundingClientRect(); return b.left + b.width / 2 - o; });
    pitch = centres.length > 1 ? Math.abs(centres[1] - centres[0]) : 72;
    if (!(pitch >= 12)) pitch = 72;
  }
  // The stop the dial is resting on: this page's, or Settings while its dialog is open.
  function target() {
    return wrap.querySelector('.tab-finder[aria-expanded="true"]') || wrap.querySelector(".tab.is-active");
  }
  function nearest() {
    var mid = wrap.scrollLeft + wrap.clientWidth / 2;
    var best = 0;
    for (var i = 1; i < centres.length; i++) if (Math.abs(centres[i] - mid) < Math.abs(centres[best] - mid)) best = i;
    return best;
  }
  // Sizes: every stop learns how far it is from the middle, and the one in the middle is lit.
  function paint() {
    if (!stops.length || !wrap.clientWidth) return;
    var mid = wrap.scrollLeft + wrap.clientWidth / 2;
    var best = nearest();
    for (var i = 0; i < stops.length; i++) stops[i].style.setProperty("--d", Math.min(Math.abs(centres[i] - mid) / pitch, 3).toFixed(3));
    // With nothing to scroll (the strip holds every stop) the lit stop is the one this page is on, or Search while its dialog is open.
    var still = wrap.scrollWidth <= wrap.clientWidth + 1;
    nav.classList.toggle("is-still", still);
    var lit = still ? anchors.indexOf(target()) : interacted || target() ? best : -1;
    for (var k = 0; k < anchors.length; k++) anchors[k].classList.toggle("is-centred", k === lit);
  }
  function paintSoon() {
    if (painting) return;
    painting = requestAnimationFrame(function () {
      painting = 0;
      paint();
      hints();
    });
  }
  // Turn the dial so stop i is in the middle (glides, unless the visitor asked for less motion).
  function centreOn(i, smooth) {
    if (!anchors[i] || !wrap.clientWidth) return;
    var max = wrap.scrollWidth - wrap.clientWidth;
    var left = Math.max(0, Math.min(max, centres[i] - wrap.clientWidth / 2));
    if (Math.abs(left - wrap.scrollLeft) < 0.5) return;
    var glide = smooth && !reduced();
    progUntil = now() + (glide ? 800 : 200);
    // A glide starts a tick later: the browser scrolls a stop that has just been given the focus into view right after the focus event
    // (the settings dialog hands the focus back to its stop as it closes), and that would cut the glide short.
    if (glide) setTimeout(function () { wrap.scrollTo({ left: left, behavior: "smooth" }); }, 0);
    else wrap.scrollTo({ left: left, behavior: "auto" });
  }
  // Put the dial on this page's stop (a page with no tab of its own rests on Home, unlit, with no needle).
  var lastTarget; // the stop (this page's, or Settings) the dial was last asked to rest on, so a visitor who has moved it is only brought back when that changes
  function place(instant) {
    var t = target();
    var changed = t !== lastTarget;
    lastTarget = t;
    nav.classList.toggle("no-needle", !t && !interacted);
    wrap.classList.add("dial-ready");
    if (!stops.length || !wrap.clientWidth) return;
    var goal = t ? anchors.indexOf(t) : interacted ? -1 : anchors.indexOf(wrap.querySelector(".tab-home"));
    if (goal < 0 && !t && !interacted) goal = Math.floor((anchors.length - 1) / 2);
    if (goal < 0) return;
    // While the visitor has the dial in hand it is theirs; they will land on a stop, and that is where the page goes.
    if (touching || now() - userAt < 250) return;
    // Turn it only when this page's stop (or Settings) has changed, or the strip has just been laid out again.
    if (!instant && !changed) return;
    centreOn(goal, !instant);
  }

  // The ruler under the tabs is drawn from the stops themselves: a long tick under the middle of every stop (where the needle rests when
  // it is the current one) and five short ones evenly between neighbours, carried on past the first and last stop to the ends of the
  // strip. Every tick is a mark of its own on a whole device pixel, inside the scrolling strip so it travels with the tabs. (A repeating
  // background cannot do this: its tiles do not match the tabs' widths, it does not follow the scrolling, and some browsers round every
  // tile, so the short ticks drifted off the long ones.)
  var rulerHtml = "";
  function ruler() {
    var marks = wrap.querySelector(":scope > .tab-ruler");
    // Nothing on screen (the header hidden, a print preview) means nothing to measure: no marks, and no steps of nothing to repeat.
    if (!anchors.length || !wrap.clientWidth) {
      if (marks) marks.remove();
      rulerHtml = "";
      return;
    }
    var cs = centres;
    var n = cs.length;
    var end = Math.max(wrap.scrollWidth, cs[n - 1] + pitch);
    // The step the ruler carries on with past the ends is the neighbouring gap, never less than a few pixels and never more than a
    // handful of marks: whatever the layout does, these loops finish.
    var step = function (gap) { return gap >= 12 ? gap : 60; };
    var gapFirst = step(n > 1 ? cs[1] - cs[0] : pitch);
    var gapLast = step(n > 1 ? cs[n - 1] - cs[n - 2] : gapFirst);
    var at = [];
    var k;
    for (k = 1; k <= 120 && cs[0] - (k * gapFirst) / 6 >= 0.5; k++) at.push([cs[0] - (k * gapFirst) / 6, false]);
    for (var i = 0; i < n; i++) {
      at.push([cs[i], true]);
      if (i < n - 1) for (k = 1; k < 6; k++) at.push([cs[i] + ((cs[i + 1] - cs[i]) * k) / 6, false]);
    }
    for (k = 1; k <= 120 && cs[n - 1] + (k * gapLast) / 6 <= end - 1.5; k++) at.push([cs[n - 1] + (k * gapLast) / 6, false]);
    var dpr = window.devicePixelRatio || 1;
    var html = at
      .map(function (m) { return '<i' + (m[1] ? ' class="is-major"' : "") + ' style="left:' + Math.round((m[0] - 0.5) * dpr) / dpr + 'px"></i>'; })
      .join("");
    if (!marks) {
      marks = document.createElement("span");
      marks.className = "tab-ruler";
      marks.setAttribute("aria-hidden", "true");
      wrap.insertBefore(marks, wrap.firstChild);
      rulerHtml = "";
    }
    if (html !== rulerHtml) {
      marks.innerHTML = html;
      rulerHtml = html;
    }
  }

  // The fades at the strip's ends show only while there is more to scroll to (drawn by the nav around the strip: a mask on the strip
  // itself would also clip what sits near the ends). Looked at again whenever the strip is measured, so a font arriving cannot leave one stuck on.
  function hints() {
    nav.classList.toggle("has-overflow-left", wrap.scrollLeft > 1);
    nav.classList.toggle("has-overflow-right", wrap.scrollLeft + wrap.clientWidth < wrap.scrollWidth - 1);
  }

  function layout(instant) {
    measure();
    ruler();
    place(instant === true);
    paint();
    hints();
  }
  layout(true);
  // A resize that only changes the height (a phone's address bar sliding away) must not throw the dial off its stop.
  var width = window.innerWidth;
  window.addEventListener("resize", function () {
    if (window.innerWidth !== width) {
      width = window.innerWidth;
      layout(true);
    } else {
      measure();
      ruler();
      place(false);
      paint();
      hints();
    }
  });
  // Styles that depend on the rest of the page (the Studio page's slim header) only apply once it has been read, so look again then.
  document.addEventListener("DOMContentLoaded", function () { layout(true); });
  window.addEventListener("load", function () { layout(true); }); // and once the fonts are in, which can change the widths
  // And whenever the strip or a stop changes size for any other reason (a page slid in with a slimmer header, a font arriving).
  var queued = 0;
  function soon() {
    if (queued) return;
    queued = requestAnimationFrame(function () {
      queued = 0;
      measure();
      ruler();
      place(false);
      paint();
      hints();
    });
  }
  if (typeof ResizeObserver === "function") {
    var ro = new ResizeObserver(soon);
    ro.observe(wrap);
    [].forEach.call(wrap.querySelectorAll(":scope > .tab"), function (s) { ro.observe(s); });
  }
  document.addEventListener("site:arrive", function () { setTimeout(layout, 0); });
  window.siteLayoutNav = layout;

  // ---- the visitor turning the dial ----
  function moved() { userAt = now(); progUntil = 0; }
  wrap.addEventListener("touchstart", function () { touching = true; moved(); }, { passive: true });
  wrap.addEventListener("touchend", function () { touching = false; userAt = now(); }, { passive: true });
  wrap.addEventListener("touchcancel", function () { touching = false; userAt = now(); }, { passive: true });
  wrap.addEventListener("wheel", function (e) { if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) moved(); }, { passive: true });
  wrap.addEventListener("scroll", function () {
    var t = now();
    // A scroll is the visitor's when a finger is down, or it follows one closely (the glide after a flick keeps scrolling every frame).
    // Anything else (this script turning the dial, the browser keeping a focused stop in view, a resize clamping it) is not a choice.
    var byUser = touching || t - userAt < 200;
    if (byUser) {
      userAt = t;
      interacted = true;
    }
    paintSoon();
    if (byUser && t > progUntil) settle();
  }, { passive: true });
  // The dial has stopped on a stop (it is still there a moment after the last movement): go to that page, or open the settings dialog when
  // it is Settings. Landing on a page's stop closes the dialog again if it was open.
  function settle() {
    clearTimeout(commitTimer);
    commitTimer = setTimeout(function () {
      var a = anchors[nearest()];
      if (!a) return;
      var finder = window.siteFinder;
      var open = !!wrap.querySelector('.tab-finder[aria-expanded="true"]');
      if (a.tagName !== "A") {
        if (!open && finder) finder.open({ focus: !(window.matchMedia && window.matchMedia("(pointer: coarse)").matches) });
        return;
      }
      // the dialog closes on the way to this stop; the dial is already there, so it must not be turned back to the page it came from
      if (open) lastTarget = wrap.querySelector(".tab.is-active");
      if (a.classList.contains("is-active")) {
        if (open && finder) finder.close();
        return;
      }
      a.click(); // the same as pressing it: the page slides in (public/page-slide.js), or loads
    }, 160);
  }
  // A click on a stop turns the dial to it at once; the page follows (or Settings opens).
  wrap.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".tab");
    if (!a) return;
    var i = anchors.indexOf(a);
    if (i < 0) return;
    clearTimeout(commitTimer);
    interacted = true;
    centreOn(i, true);
  });
  // The keyboard moves along the dial without going anywhere until Enter: Tab and the arrow keys pass the focus to the next stop and turn
  // the dial to it. Focus that arrives any other way, such as coming back to Settings when its dialog closes, leaves the dial alone.
  var tabAt = 0;
  document.addEventListener("keydown", function (e) { if (e.key === "Tab") tabAt = now(); }, true);
  wrap.addEventListener("focusin", function (e) {
    var a = e.target.closest && e.target.closest(".tab");
    var i = a ? anchors.indexOf(a) : -1;
    if (i < 0) return;
    clearTimeout(commitTimer);
    progUntil = now() + 900; // the browser scrolls a focused stop into view: that is not a choice either
    if (now() - tabAt < 300) centreOn(i, true);
  });
  wrap.addEventListener("keydown", function (e) {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    var a = document.activeElement && document.activeElement.closest && document.activeElement.closest(".tab");
    var i = anchors.indexOf(a);
    var next = i < 0 ? null : anchors[i + (e.key === "ArrowRight" ? 1 : -1)];
    if (!next) return;
    e.preventDefault();
    next.focus();
    centreOn(anchors.indexOf(next), true);
  });
})();

// The search and command dialog, opened from the magnifier at the end of the nav or with Ctrl/Cmd+K: type to filter its rows (light or dark, reduced
// motion, text size, the Studio), or arrow through them; Enter presses the first (or the one you are on), Esc closes and gives the focus back. Two study
// modules are not in the list: they appear when their name is typed (data-secret, data-keys) and open the study popup (public/study/study.js, loaded
// the first time one is pressed).
(function () {
  var finder = document.getElementById("site-finder");
  if (!finder) return;
  var openBtn = document.getElementById("finder-open");
  var query = document.getElementById("finder-q");
  var none = document.getElementById("finder-none");
  var lastFocus = null;

  function visible(el) {
    return !el.hidden && el.offsetParent !== null;
  }
  function items() {
    return [].slice.call(finder.querySelectorAll("#finder-list .finder-item")).filter(visible);
  }
  // Shows the rows that match what was typed. A row marked data-secret is shown only when the whole text typed is one of its keys (data-keys, separated
  // by |), never from a part of a word: the study modules are found by their name, not listed.
  function applyFilter() {
    var text = ((query && query.value) || "").trim().toLowerCase();
    var anything = false;
    [].forEach.call(finder.querySelectorAll("#finder-list .finder-group"), function (group) {
      var shown = 0;
      [].forEach.call(group.querySelectorAll(".finder-item"), function (item) {
        var match;
        if (item.hasAttribute("data-secret")) match = text !== "" && (item.getAttribute("data-keys") || "").toLowerCase().split("|").indexOf(text) >= 0;
        else match = text === "" || item.textContent.toLowerCase().indexOf(text) >= 0;
        item.hidden = !match;
        if (match) shown++;
      });
      group.hidden = shown === 0;
      if (shown) anything = true;
    });
    if (none) none.hidden = anything || text === "";
  }
  function resetFilter() {
    if (query) query.value = "";
    applyFilter();
  }
  var studyLoading = false;
  function openStudy(lab, title) {
    close();
    function go() { if (window.SiteStudy) window.SiteStudy.open(lab, title); }
    if (window.SiteStudy) return go();
    if (studyLoading) return;
    studyLoading = true;
    if (!document.querySelector('link[href="/study/study.css"]')) {
      var css = document.createElement("link");
      css.rel = "stylesheet";
      css.href = "/study/study.css";
      css.setAttribute("data-added-by", "nav");
      document.head.appendChild(css);
    }
    var js = document.createElement("script");
    js.src = "/study/study.js";
    js.setAttribute("data-added-by", "nav");
    js.onload = function () { studyLoading = false; go(); };
    js.onerror = function () { studyLoading = false; };
    document.head.appendChild(js);
  }
  // The dialog opens under the nav, which stays in view and can still be tapped: its top is wherever the header ends.
  function placeFinder() {
    var bar = document.querySelector(".topbar");
    var top = bar ? Math.max(0, Math.round(bar.getBoundingClientRect().bottom)) : 0;
    finder.style.setProperty("--finder-top", top + "px");
  }
  function open(opts) {
    if (!finder.hidden) return;
    lastFocus = document.activeElement;
    placeFinder();
    finder.hidden = false;
    document.documentElement.classList.add("finder-on");
    if (openBtn) openBtn.setAttribute("aria-expanded", "true");
    if (window.siteLayoutNav) window.siteLayoutNav(); // the needle turns to the search stop while it is open
    resetFilter();
    if (opts && opts.focus === false) return;
    // the search box has the focus (on a phone it would raise the keyboard, so there the first row does)
    var coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    var first = coarse ? items()[0] : query || items()[0];
    if (first) first.focus();
  }
  function close() {
    if (finder.hidden) return;
    finder.hidden = true;
    document.documentElement.classList.remove("finder-on");
    if (openBtn) openBtn.setAttribute("aria-expanded", "false");
    if (window.siteLayoutNav) window.siteLayoutNav();
    if (lastFocus && document.contains(lastFocus) && lastFocus.focus) lastFocus.focus();
  }
  window.siteFinder = { open: open, close: close };
  // The Settings stop opens it and, pressed again, closes it; another tab closes it on the way to its page.
  if (openBtn) openBtn.addEventListener("click", function () { if (finder.hidden) open(); else close(); });
  window.addEventListener("resize", function () { if (!finder.hidden) placeFinder(); });
  document.addEventListener("site:leave", close);
  document.addEventListener("click", function (e) {
    if (!finder.hidden && e.target.closest && e.target.closest(".tabs a")) close();
  }, true);
  finder.addEventListener("click", function (e) {
    if (e.target.closest("[data-finder-close]")) close();
    var study = e.target.closest && e.target.closest("[data-study-lab]");
    if (study) openStudy(study.getAttribute("data-study-lab"), study.getAttribute("data-study-title") || "Study");
  });
  if (query) query.addEventListener("input", applyFilter);
  finder.addEventListener("keydown", function (e) {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      close();
      return;
    }
    var list = items();
    if (e.key === "Enter" && document.activeElement === query) {
      // Enter in the search box presses the first row that matches
      e.preventDefault();
      if (list[0]) list[0].click();
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      if (!list.length) return;
      e.preventDefault();
      var i = list.indexOf(document.activeElement);
      if (e.key === "ArrowDown") (i < 0 ? list[0] : list[Math.min(list.length - 1, i + 1)]).focus();
      else if (i <= 0 && query) query.focus();
      else list[Math.max(0, i - 1)].focus();
    } else if (e.key === "Tab") {
      // The focus stays inside while it is open.
      var all = (query ? [query] : []).concat(list, [].slice.call(finder.querySelectorAll(".finder-esc")));
      var at = all.indexOf(document.activeElement);
      if (e.shiftKey && at <= 0) {
        e.preventDefault();
        all[all.length - 1].focus();
      } else if (!e.shiftKey && at === all.length - 1) {
        e.preventDefault();
        all[0].focus();
      }
    }
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key === "k" || e.key === "K") && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      if (finder.hidden) open();
      else close();
    }
  });
})();

(function () {
  // This script tag sits before <main> in the document (see renderShell),
  // so the block content [data-animate] elements live in hasn't been
  // parsed yet when this runs synchronously — wait for the full document.
  var initAnimate = function (root) {
    var targets = (root || document).querySelectorAll("[data-animate]");
    if (!targets.length) return;
    // Checks both the OS-level setting and this site's own manual toggle
    // (data-motion="reduce", restored from localStorage before this script
    // runs — see the inline head script in renderShell) — matches the same
    // dual check the hero-video sync below already does, so the two don't
    // disagree about whether motion is currently reduced.
    var reducedMotion =
      document.documentElement.getAttribute("data-motion") === "reduce" ||
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    if (reducedMotion || !("IntersectionObserver" in window)) {
      // Reduced motion (or no observer support): the CSS never defines an
      // animated state for these anyway, so adding the class is a harmless
      // no-op there — this just also skips setting up an observer for nothing.
      targets.forEach(function (el) { el.classList.add("is-visible"); });
      return;
    }
    // Motion budget: a fast scroll (or a short page) can cross the 0.15
    // threshold for several [data-animate] blocks in the same
    // IntersectionObserver callback batch, which without this all reveal
    // at the exact same instant — reads as a flash of movement rather than
    // "considered" motion. Staggering entries within a batch turns that
    // into a brief cascade instead, on top of (not overriding) whatever
    // per-block delay the admin already set via the "Entrance animation"
    // style field's --animate-delay. Capped at MOTION_BUDGET_MAX_STAGGER_MS
    // total so a very large batch (e.g. a long page opened at the bottom
    // via an anchor link) doesn't push the last few blocks' reveal absurdly
    // far into the future.
    var MOTION_BUDGET_STAGGER_MS = 80;
    var MOTION_BUDGET_MAX_STAGGER_MS = 480;
    var observer = new IntersectionObserver(
      function (entries) {
        var visible = entries.filter(function (e) { return e.isIntersecting; });
        visible.forEach(function (entry, i) {
          if (i > 0) {
            var extra = Math.min(i * MOTION_BUDGET_STAGGER_MS, MOTION_BUDGET_MAX_STAGGER_MS);
            var existing = parseFloat(entry.target.style.getPropertyValue("--animate-delay")) || 0;
            entry.target.style.setProperty("--animate-delay", existing + extra + "ms");
          }
          entry.target.classList.add("is-visible");
          observer.unobserve(entry.target);
        });
      },
      { threshold: 0.15 }
    );
    targets.forEach(function (el) { observer.observe(el); });
  };
  window.siteInitAnimate = initAnimate;
  document.addEventListener("DOMContentLoaded", function () { initAnimate(document); });
})();

(function () {
  var btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", function () {
    var root = document.documentElement;
    var current = root.getAttribute("data-theme") || "dark";
    var next = current === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    var themeColorMeta = document.getElementById("theme-color-meta");
    if (themeColorMeta) themeColorMeta.setAttribute("content", next === "light" ? "#f5f0e6" : themeColorMeta.getAttribute("data-dark") || "#18161b");
    try {
      localStorage.setItem("theme", next);
    } catch (e) {}
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
    btn.title = reduced ? "Animations are off (click to turn back on)" : "Turn off entrance/hover animations";
    var state = btn.querySelector(".finder-state");
    if (state) state.textContent = reduced ? "On" : "Off";
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
  var storedScale;
  try {
    storedScale = localStorage.getItem("fontScale");
  } catch (e) {}
  var current = parseFloat(storedScale) || 1;
  var apply = function (scale) {
    current = scale;
    if (scale === 1) root.style.removeProperty("--font-scale");
    else root.style.setProperty("--font-scale", scale);
    btn.title = "Text size: " + Math.round(scale * 100) + "% (click to change)";
    var state = btn.querySelector(".finder-state");
    if (state) state.textContent = Math.round(scale * 100) + "%";
    try {
      localStorage.setItem("fontScale", String(scale));
    } catch (e) {}
  };
  apply(current);
  btn.addEventListener("click", function () {
    var idx = SCALES.indexOf(current);
    var next = SCALES[(idx + 1) % SCALES.length];
    apply(next);
  });
})();

// Everything a freshly swapped-in page needs that normally happens once at load; called by page-slide.js after it swaps the content.
window.siteInitContent = function (root) {
  if (window.siteInitAnimate) window.siteInitAnimate(root);
  if (window.siteLightboxPrepare) window.siteLightboxPrepare(root);
  if (window.siteInitApps) window.siteInitApps(root); // the Studio (public/app-kit.js)
};

// .tabs (the persistent Articles/Projects/Topics nav pill) scrolls
// internally as a backstop when too many tabs -- or a long custom
// nav_label -- don't all fit, rather than blowing out the whole page's
// width. Two real gaps in that on its own: nothing hints there's more to
// scroll to (a hidden scrollbar plus plain edge-cropped content gives zero
// visual affordance), and Tab-focusing onto a tab that's only *partially*
// clipped doesn't reliably get scrolled fully into view -- browsers only
// auto-scroll a newly-focused element when it's judged not visible at all,
// and a sliver already counts as "visible enough," so a keyboard user can
// land on a focus ring with the tab's own label still invisible.
document.addEventListener("DOMContentLoaded", function () {
  var tabs = document.querySelector(".tabs");
  if (!tabs) return;
  tabs.addEventListener("focusin", function (e) {
    if (!e.target.classList.contains("tab")) return;
    e.target.scrollIntoView({ block: "nearest", inline: "nearest" }); // the scroll event updates the fades
  });
});

// Footer "Share this page": shown only where it can do something. It opens the device's share sheet, or copies the page's address.
document.addEventListener("DOMContentLoaded", function () {
  var btn = document.querySelector("[data-share]");
  if (!btn) return;
  var canShare = typeof navigator.share === "function";
  var canCopy = !!(navigator.clipboard && typeof navigator.clipboard.writeText === "function");
  if (!canShare && !canCopy) return;
  btn.hidden = false;
  var note = document.querySelector(".footer-share-note");
  function say(text) {
    if (!note) return;
    note.textContent = "";
    setTimeout(function () {
      note.textContent = text;
    }, 20);
  }
  btn.addEventListener("click", function () {
    var canonical = document.querySelector('link[rel="canonical"]');
    var url = (canonical && canonical.href) || location.href.split("#")[0];
    if (canShare) {
      navigator.share({ title: document.title, url: url }).catch(function () {
        /* the visitor closed the share sheet: nothing to report */
      });
    } else {
      navigator.clipboard.writeText(url).then(
        function () {
          say("Link copied.");
        },
        function () {
          say("Couldn't copy the link.");
        }
      );
    }
  });
});
