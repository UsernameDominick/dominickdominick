// Page-to-page slide, like a carousel: clicking a tab to the right of the current one slides the page left (the new page comes in from
// the right), a tab to the left slides it right. It rides the browser's cross-document view transitions (the CSS is in style.css), so it
// is just a nicer way of doing the same normal page load: no content is fetched or swapped by script, browsers without it simply load the
// page as before, and it stays off for reduced motion (OS setting or this site's own toggle). Only moves between the nav's own pages slide.
// The direction is worked out on the page being opened ("pagereveal"), from the page it came from, using that page's own tab order.
// This file is loaded in the <head>, together with <link rel="expect" href="#main-content" blocking="render">, so the listener exists and the
// tabs are parsed before the browser reveals the page; the CSS side is in style.css.
window.addEventListener("pagereveal", function (e) {
  try {
    var vt = e.viewTransition;
    if (!vt) return;
    var root = document.documentElement;
    var from = window.navigation && navigation.activation && navigation.activation.from;
    if (!from || root.getAttribute("data-motion") === "reduce" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches)) {
      vt.skipTransition();
      return;
    }
    var tabs = [].slice.call(document.querySelectorAll(".tabs > .tab, .tabs .tab-group > .tab"));
    var clean = function (path) {
      return path.replace(/\/+$/, "") || "/";
    };
    var indexOfPath = function (path) {
      path = clean(path);
      for (var i = 0; i < tabs.length; i++) {
        if (clean(new URL(tabs[i].getAttribute("href"), location.href).pathname) === path) return i;
        var kids = tabs[i].parentNode.querySelectorAll(".tab-dropdown a");
        for (var k = 0; k < kids.length; k++) {
          if (clean(new URL(kids[k].getAttribute("href"), location.href).pathname) === path) return i;
        }
      }
      return -1;
    };
    var a = indexOfPath(new URL(from.url).pathname);
    var b = indexOfPath(location.pathname);
    if (a < 0 || b < 0 || a === b) {
      vt.skipTransition();
      return;
    }
    vt.types.add(b > a ? "nav-forward" : "nav-back");
  } catch (err) {}
});

// ---------------------------------------------------------------------------------------------------------------------------------
// In-place page changes. Clicking a nav tab (or the logo) no longer reloads the page: the next page is fetched, and only the content,
// title, active tab and footer are swapped, with the old and new content sliding side by side like a carousel (the header never moves).
// The address bar and the Back/Forward buttons work as usual (history.pushState + popstate). Anything this can't do safely, it hands back
// to a normal page load (which the view-transition slide above still dresses up): an error or non-page response, a page that needs scripts
// this one doesn't run again (simulation, song, study, article extras), or page-specific styles in the head.
(function () {
  if (!window.fetch || !window.DOMParser || !window.history || !history.pushState) return;
  var SAFE_SCRIPTS = { "/nav.js": 1, "/page-slide.js": 1, "/lightbox.js": 1 };
  // Scripts a swapped-in page may bring: loaded once (in order) the first time a page needs them, and set up for each page by
  // window.siteInitContent (song players, circuits, pictures), so these pages slide like the rest instead of loading from scratch.
  var LOADABLE = { "/sim-buzzer.js": 1, "/sim-player.js": 1, "/song-engine.js": 1, "/song-embed.js": 1, "/lightbox.js": 1 };
  var DURATION = 420;
  var EASE = "cubic-bezier(0.22, 0.8, 0.28, 1)";
  var cache = {}; // url -> {at, promise}
  var busy = null; // {finish()} while a slide is running
  var loaded = location.pathname + location.search;

  function clean(path) {
    return path.replace(/\/+$/, "") || "/";
  }
  function reduced() {
    return document.documentElement.getAttribute("data-motion") === "reduce" || (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }
  function tabs() {
    return [].slice.call(document.querySelectorAll(".tabs > .tab, .tabs .tab-group > .tab"));
  }
  function indexOfPath(path) {
    var list = tabs();
    path = clean(path);
    for (var i = 0; i < list.length; i++) {
      if (clean(new URL(list[i].getAttribute("href"), location.href).pathname) === path) return i;
      var kids = list[i].parentNode.querySelectorAll(".tab-dropdown a");
      for (var k = 0; k < kids.length; k++) if (clean(new URL(kids[k].getAttribute("href"), location.href).pathname) === path) return i;
    }
    return -1;
  }
  function headSignature(doc) {
    var parts = [];
    [].forEach.call(doc.head.querySelectorAll("style"), function (el) { parts.push("s:" + el.textContent); });
    [].forEach.call(doc.head.querySelectorAll('link[rel="stylesheet"]'), function (el) {
      var h = el.getAttribute("href") || "";
      if (h.charAt(0) === "/" && h.charAt(1) !== "/") parts.push("l:" + h);
    });
    return parts.join("\n");
  }
  var liveSignature = null;
  function currentSignature() {
    // Computed from the page as it was served, never from tags added later by scripts (highlight.js and friends): same-origin links and
    // <style> only. Cached once, and refreshed from the incoming page after every swap.
    if (liveSignature === null) liveSignature = headSignature(document);
    return liveSignature;
  }
  // The incoming document must be a plain content page: nothing in it that needs a script to run again.
  function swappable(doc) {
    if (!doc.getElementById("main-content") || !doc.querySelector(".topbar")) return false;
    if (doc.querySelector('meta[http-equiv="refresh" i]')) return false;
    var scripts = doc.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i++) {
      var src = (scripts[i].getAttribute("src") || "").split("?")[0];
      if (!SAFE_SCRIPTS[src] && !LOADABLE[src]) return false;
    }
    // A frame (the Studio) loads itself, so it can come along; scripts inside the content, 3D models and code still need a real load.
    if (doc.getElementById("main-content").querySelector("script, model-viewer, .mermaid, .katex-block, pre code")) return false;
    return headSignature(doc) === currentSignature();
  }
  function fetchDoc(url) {
    var hit = cache[url];
    if (hit && Date.now() - hit.at < 120000) return hit.promise;
    var promise = fetch(url, { credentials: "same-origin", headers: { Accept: "text/html" } }).then(function (res) {
      var type = res.headers.get("content-type") || "";
      if (!res.ok || type.indexOf("text/html") < 0) throw new Error("not a page");
      return res.text().then(function (text) {
        var u = new URL(res.url, location.href);
        if (u.origin !== location.origin) throw new Error("left the site");
        return { url: u, doc: new DOMParser().parseFromString(text, "text/html") };
      });
    });
    cache[url] = { at: Date.now(), promise: promise };
    promise.catch(function () { delete cache[url]; });
    return promise;
  }
  function copyHead(doc) {
    document.title = doc.title;
    var sel = 'meta[name="description"], link[rel="canonical"], meta[property^="og:"], meta[name^="twitter:"], script[type="application/ld+json"], meta[name="robots"]';
    [].forEach.call(document.head.querySelectorAll(sel), function (el) { el.remove(); });
    [].forEach.call(doc.head.querySelectorAll(sel), function (el) { document.head.appendChild(document.importNode(el, true)); });
  }
  function syncHeader(doc) {
    var live = [].slice.call(document.querySelectorAll(".tabs a.tab, .tabs .tab-dropdown a"));
    var next = {};
    [].forEach.call(doc.querySelectorAll(".tabs a.tab, .tabs .tab-dropdown a"), function (a) { next[a.getAttribute("href")] = a; });
    live.forEach(function (a) {
      var n = next[a.getAttribute("href")];
      if (!n) return;
      a.className = n.className;
      if (n.hasAttribute("aria-current")) a.setAttribute("aria-current", n.getAttribute("aria-current"));
      else a.removeAttribute("aria-current");
    });
    [].forEach.call(document.querySelectorAll(".tab-group.open"), function (g) { g.classList.remove("open"); });
    // The finder's "Edit this page" row points at the page now shown (or goes, on a page with nothing to edit).
    var oldEdit = document.querySelector(".site-finder .edit-this-btn");
    var newEdit = doc.querySelector(".site-finder .edit-this-btn");
    if (oldEdit) oldEdit.remove();
    var goGroup = document.querySelector('.site-finder [data-group="go"]');
    if (newEdit && goGroup) goGroup.insertBefore(document.importNode(newEdit, true), goGroup.querySelector(".finder-item"));
    var q = document.getElementById("finder-input");
    var nq = doc.getElementById("finder-input");
    if (q && nq) q.value = nq.value;
    window.dispatchEvent(new Event("resize")); // slides the active-tab indicator
  }
  function finishNow() {
    if (busy) busy.finish();
  }
  var loadedScripts = {};
  // A script is already here when any <script> on this page has it (this file runs in the <head>, so the page's own are checked late).
  function present(src) {
    return [].some.call(document.querySelectorAll("script[src]"), function (s) { return (s.getAttribute("src") || "").split("?")[0] === src; });
  }
  function loadScripts(doc) {
    var chain = Promise.resolve();
    [].forEach.call(doc.querySelectorAll("script[src]"), function (s) {
      var src = (s.getAttribute("src") || "").split("?")[0];
      if (!LOADABLE[src] || loadedScripts[src] || present(src)) return;
      chain = chain.then(function () {
        loadedScripts[src] = new Promise(function (resolve, reject) {
          var el = document.createElement("script");
          el.src = s.getAttribute("src");
          el.onload = resolve;
          el.onerror = function () { delete loadedScripts[src]; reject(new Error("script")); };
          document.body.appendChild(el);
        });
        return loadedScripts[src];
      });
    });
    return chain;
  }
  // The circuits' shared drawing definitions sit at the top of a page that has circuits; a page swapped in brings them if they are missing.
  function copySimDefs(doc) {
    var defs = doc.querySelector(".sim-defs-holder");
    if (defs && !document.querySelector(".sim-defs-holder")) document.body.insertBefore(document.importNode(defs, true), document.body.firstChild);
  }
  function go(url, dir, push) {
    finishNow();
    return fetchDoc(url.href).then(function (res) {
      if (!swappable(res.doc)) throw new Error("needs a full load");
      return loadScripts(res.doc).then(function () { return res; });
    }).then(function (res) {
      if (window.siteStopSongs) window.siteStopSongs();
      copySimDefs(res.doc);
      var doc = res.doc;
      var oldMain = document.getElementById("main-content");
      var fresh = document.importNode(doc.getElementById("main-content"), true);
      var sy = window.pageYOffset || 0;
      if (push) history.pushState({ slide: 1 }, "", res.url.pathname + res.url.search + res.url.hash);
      loaded = res.url.pathname + res.url.search;
      copyHead(doc);
      liveSignature = headSignature(doc);
      document.body.className = doc.body.className;
      syncHeader(doc);
      var footer = document.querySelector(".site-footer");
      var newFooter = doc.querySelector(".site-footer");
      if (footer && newFooter) footer.replaceWith(document.importNode(newFooter, true));
      var animate = dir !== 0 && !reduced() && oldMain.animate;
      var stage = document.createElement("div");
      stage.className = "page-stage";
      oldMain.parentNode.insertBefore(stage, oldMain);
      stage.appendChild(oldMain);
      oldMain.removeAttribute("id");
      oldMain.setAttribute("aria-hidden", "true");
      oldMain.inert = true;
      stage.appendChild(fresh);
      window.scrollTo(0, 0);
      if (window.siteInitContent) window.siteInitContent(fresh);
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        busy = null;
        [].forEach.call(stage.getAnimations ? stage.getAnimations({ subtree: true }) : [], function (a) { a.cancel(); });
        stage.replaceWith(fresh);
        fresh.setAttribute("tabindex", "-1");
        fresh.focus({ preventScroll: true });
        fresh.addEventListener("blur", function () { fresh.removeAttribute("tabindex"); }, { once: true });
        if (res.url.hash) { var t = document.getElementById(decodeURIComponent(res.url.hash.slice(1))); if (t) t.scrollIntoView(); }
      };
      if (!animate) { finish(); return; }
      var w = stage.getBoundingClientRect().width;
      oldMain.style.position = "absolute";
      oldMain.style.top = "0";
      oldMain.style.left = "0";
      oldMain.style.right = "0";
      var opts = { duration: DURATION, easing: EASE, fill: "both" };
      var a1 = oldMain.animate([{ transform: "translate(0," + -sy + "px)" }, { transform: "translate(" + -dir * w + "px," + -sy + "px)" }], opts);
      var a2 = fresh.animate([{ transform: "translateX(" + dir * w + "px)" }, { transform: "translateX(0)" }], opts);
      busy = { finish: finish };
      Promise.all([a1.finished, a2.finished]).then(finish, finish);
    });
  }
  function hard(url) {
    location.assign(url.href);
  }
  function directionTo(url, fromPath) {
    var from = indexOfPath(fromPath || location.pathname);
    var to = indexOfPath(url.pathname);
    return from < 0 || to < 0 || from === to ? 0 : to > from ? 1 : -1;
  }
  function eligible(a, e) {
    if (!a || e.defaultPrevented || e.button > 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return null;
    if (a.target && a.target !== "_self") return null;
    if (a.hasAttribute("download")) return null;
    var href = a.getAttribute("href");
    if (!href || href.charAt(0) === "#") return null;
    var url;
    try { url = new URL(href, location.href); } catch (err) { return null; }
    if (url.origin !== location.origin || !/^https?:$/.test(url.protocol)) return null;
    if (/\.[a-z0-9]{2,5}$/i.test(url.pathname) && !/\.html?$/i.test(url.pathname)) return null; // a file, not a page
    if (/^\/(admin|api|media|rss\.xml|sitemap\.xml|search)/.test(url.pathname)) return null;
    return url;
  }
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest(".tabs a, .brand");
    var url = eligible(a, e);
    if (!url) return;
    if (clean(url.pathname) === clean(location.pathname) && url.search === location.search) {
      if (url.hash === location.hash || !url.hash) e.preventDefault();
      return;
    }
    e.preventDefault();
    var dir = directionTo(url);
    go(url, dir, true).catch(function () { hard(url); });
  });
  // Warm the page up as soon as a tab is hovered, focused or touched, so the slide starts without waiting on the network.
  var warm = function (e) {
    var a = e.target.closest && e.target.closest(".tabs a, .brand");
    var url = eligible(a, { button: 0 });
    if (url && clean(url.pathname) !== clean(location.pathname)) fetchDoc(url.href).catch(function () {});
  };
  // And every page of the nav once the page has settled, so a tap slides at once even on a phone (no hover there to warm it).
  var warmAll = function () {
    [].forEach.call(document.querySelectorAll(".tabs a.tab"), function (a) {
      var url = eligible(a, { button: 0 });
      if (url && clean(url.pathname) !== clean(location.pathname)) fetchDoc(url.href).catch(function () {});
    });
  };
  if (navigator.connection && navigator.connection.saveData) warmAll = function () {};
  window.addEventListener("load", function () {
    (window.requestIdleCallback || function (f) { setTimeout(f, 800); })(warmAll);
  });
  document.addEventListener("pointerover", warm, { passive: true });
  document.addEventListener("focusin", warm);
  document.addEventListener("touchstart", warm, { passive: true });
  window.addEventListener("popstate", function () {
    var now = location.pathname + location.search;
    if (now === loaded) return; // only the #hash changed
    var url = new URL(location.href);
    var dir = directionTo(url, loaded.split("?")[0]);
    go(url, dir, false).catch(function () { location.reload(); });
  });
})();
