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
// title, active tab, page styles and footer are swapped, with the content travelling sideways like a carousel (the header never moves):
// the farther the tab, the farther it travels, past the pages in between. On a phone a sideways swipe on the page moves to the tab beside
// it, following the finger. Every nav page (and its first pictures) is fetched ahead, so nothing waits on the network.
// The address bar and the Back/Forward buttons work as usual (history.pushState + popstate). Anything this can't do safely, it hands back
// to a normal page load (which the view-transition slide above still dresses up): an error or non-page response, or a page that needs
// scripts this one doesn't run again (study, article extras). Scripts Cloudflare adds to pages (/cdn-cgi/, analytics) do not count, and
// the addresses Cloudflare's email protection hides are put back here.
(function () {
  if (!window.fetch || !window.DOMParser || !window.history || !history.pushState) return;
  var SAFE_SCRIPTS = { "/nav.js": 1, "/page-slide.js": 1, "/lightbox.js": 1 };
  // Scripts a swapped-in page may bring: loaded once (in order) the first time a page needs them, and set up for each page by
  // window.siteInitContent (song players, circuits, pictures), so these pages slide like the rest instead of loading from scratch.
  var LOADABLE = { "/sim-buzzer.js": 1, "/sim-player.js": 1, "/song-engine.js": 1, "/song-embed.js": 1, "/lightbox.js": 1, "/studio.js": 1, "/trainer.js": 1, "/backup-logic.js": 1, "/trainer-logic.js": 1, "/app-kit.js": 1, "/piceditor.js": 1, "/simulations.js": 1, "/scans.js": 1 };
  var DURATION = 420;
  var EASE = "cubic-bezier(0.22, 0.8, 0.28, 1)";
  var cache = {}; // url -> {at, promise}
  var ready = {}; // url -> {url, doc} once fetched: the pages in between and the swipe's neighbour are drawn from these
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
  // Why the incoming page can't be swapped in ("" when it can).
  function whyNot(doc) {
    if (!doc.getElementById("main-content") || !doc.querySelector(".topbar")) return "not a site page";
    if (doc.querySelector('meta[http-equiv="refresh" i]')) return "a refresh page";
    var scripts = doc.querySelectorAll("script[src]");
    for (var i = 0; i < scripts.length; i++) {
      var raw = scripts[i].getAttribute("src") || "";
      var src = raw.split("?")[0];
      if (SAFE_SCRIPTS[src] || LOADABLE[src]) continue;
      // Cloudflare's own additions (email protection, analytics, challenge scripts) and anything from another site: not ours to run again.
      if (/^\/cdn-cgi\//.test(src) || /^(https?:)?\/\//.test(raw)) continue;
      return "needs " + src;
    }
    // Scripts inside the content, 3D models and code still need a real load.
    if (doc.getElementById("main-content").querySelector("script, model-viewer, .mermaid, .katex-block, pre code")) return "content needs its scripts";
    return "";
  }
  function swappable(doc) {
    return !whyNot(doc);
  }
  // A page's own styles (page CSS, a theme set for one page): the incoming page's are added before it slides in, and the old page's go
  // once it has. Tags a script added (data-added-by, the Studio's) are left alone.
  function styleKey(el) {
    return el.tagName === "STYLE" ? "s:" + el.textContent : "l:" + (el.getAttribute("href") || "");
  }
  function pageStyles(doc) {
    return [].slice.call(doc.head.querySelectorAll('style:not([data-added-by]), link[rel="stylesheet"]:not([data-added-by])'));
  }
  function swapStyles(doc) {
    var have = {};
    pageStyles(document).forEach(function (el) { have[styleKey(el)] = el; });
    var want = {};
    var waits = [];
    var added = [];
    pageStyles(doc).forEach(function (el) {
      var k = styleKey(el);
      want[k] = 1;
      if (have[k]) return;
      var copy = document.importNode(el, true);
      added.push(copy);
      if (copy.tagName === "LINK") waits.push(new Promise(function (r) { copy.onload = copy.onerror = r; setTimeout(r, 1500); }));
      document.head.appendChild(copy);
    });
    return {
      ready: Promise.all(waits),
      done: function () { Object.keys(have).forEach(function (k) { if (!want[k]) have[k].remove(); }); },
      undo: function () { added.forEach(function (el) { el.remove(); }); },
    };
  }
  // Cloudflare's email protection hides addresses in the HTML and puts them back with a script that only runs on a real load.
  function cfDecode(hex) {
    var key = parseInt(hex.substr(0, 2), 16);
    var out = "";
    for (var i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.substr(i, 2), 16) ^ key);
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
  }
  function revealEmails(root) {
    if (!root) return;
    [].forEach.call(root.querySelectorAll('a[href*="/cdn-cgi/l/email-protection"]'), function (a) {
      var hex = (a.getAttribute("href").split("#")[1] || "");
      if (/^[0-9a-f]+$/i.test(hex)) a.setAttribute("href", "mailto:" + cfDecode(hex));
    });
    [].forEach.call(root.querySelectorAll("[data-cfemail]"), function (el) {
      el.replaceWith(document.createTextNode(cfDecode(el.getAttribute("data-cfemail") || "")));
    });
  }
  // A copy of a page's content to pass by or peek at: no ids (it is never the page), out of the way of the keyboard and screen readers.
  function ghostOf(doc) {
    var g = document.importNode(doc.getElementById("main-content"), true);
    g.removeAttribute("id");
    [].forEach.call(g.querySelectorAll("[id]"), function (n) { n.removeAttribute("id"); });
    [].forEach.call(g.querySelectorAll("script"), function (n) { n.remove(); });
    g.setAttribute("aria-hidden", "true");
    g.inert = true;
    g.classList.add("page-ghost");
    revealEmails(g);
    return g;
  }
  // A page fetched once is kept for the whole visit and shown at once when its tab is tapped; one older than FRESH is fetched again in the
  // background at the same time, so the next visit has the new copy (stale-while-revalidate). A failed refresh keeps the copy it had.
  var FRESH = 30000;
  function fetchDoc(url) {
    var hit = cache[url];
    if (hit) {
      if (Date.now() - hit.at > FRESH && !hit.refreshing) {
        hit.refreshing = true;
        hit.promise.then(function () {
          return request(url).then(function (res) {
            cache[url] = { at: Date.now(), promise: Promise.resolve(res) };
            ready[url] = res;
          });
        }).catch(function () { hit.refreshing = false; });
      }
      return hit.promise;
    }
    var promise = request(url);
    promise.then(function (res) { ready[url] = res; }, function () {});
    cache[url] = { at: Date.now(), promise: promise };
    promise.catch(function () { if (cache[url] && cache[url].promise === promise) delete cache[url]; });
    return promise;
  }
  function request(url) {
    return fetch(url, { credentials: "same-origin", headers: { Accept: "text/html" } }).then(function (res) {
      var type = res.headers.get("content-type") || "";
      if (!res.ok || type.indexOf("text/html") < 0) throw new Error("not a page");
      return res.text().then(function (text) {
        var u = new URL(res.url, location.href);
        if (u.origin !== location.origin) throw new Error("left the site");
        return { url: u, doc: new DOMParser().parseFromString(text, "text/html") };
      });
    });
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
  // The tabs between two stops, in travel order, as pages already fetched (a page not fetched yet, or one that can't be drawn, is skipped).
  function pagesBetween(fromPath, toPath) {
    var list = tabs();
    var a = indexOfPath(fromPath);
    var b = indexOfPath(toPath);
    var out = [];
    if (a < 0 || b < 0) return out;
    var step = b > a ? 1 : -1;
    for (var i = a + step; i !== b; i += step) {
      var href = list[i] && list[i].getAttribute("href");
      if (!href) continue;
      var res = ready[new URL(href, location.href).href];
      if (res && swappable(res.doc)) out.push(res.doc);
    }
    return out;
  }
  // opts.startPx: where a swipe left the page (it carries on from there); opts.handover(): takes the swipe's preview away, in the same
  // frame as the real pages go in.
  function go(url, dir, push, opts) {
    opts = opts || {};
    finishNow();
    var fromPath = loaded.split("?")[0];
    var styles = null;
    return fetchDoc(url.href).then(function (res) {
      var why = whyNot(res.doc);
      if (why) throw new Error(why);
      styles = swapStyles(res.doc);
      return Promise.all([loadScripts(res.doc), styles.ready]).then(function () { return res; });
    }).then(function (res) {
      if (opts.handover) opts.handover();
      if (window.siteStopSongs) window.siteStopSongs();
      document.dispatchEvent(new CustomEvent("site:leave")); // the app pages stop their sound (public/app-kit.js)
      copySimDefs(res.doc);
      var doc = res.doc;
      var oldMain = document.getElementById("main-content");
      var fresh = document.importNode(doc.getElementById("main-content"), true);
      revealEmails(fresh);
      var between = dir !== 0 ? pagesBetween(fromPath, res.url.pathname).map(ghostOf) : [];
      var sy = window.pageYOffset || 0;
      if (push) history.pushState({ slide: 1 }, "", res.url.pathname + res.url.search + res.url.hash);
      loaded = res.url.pathname + res.url.search;
      copyHead(doc);
      document.body.className = doc.body.className;
      syncHeader(doc);
      var footer = document.querySelector(".site-footer");
      var newFooter = doc.querySelector(".site-footer");
      if (footer && newFooter) {
        var nf = document.importNode(newFooter, true);
        revealEmails(nf);
        footer.replaceWith(nf);
      }
      var animate = dir !== 0 && !reduced() && oldMain.animate;
      var stage = document.createElement("div");
      stage.className = "page-stage";
      oldMain.parentNode.insertBefore(stage, oldMain);
      stage.appendChild(oldMain);
      oldMain.removeAttribute("id");
      oldMain.setAttribute("aria-hidden", "true");
      oldMain.inert = true;
      if (animate) between.forEach(function (g) { stage.appendChild(g); });
      stage.appendChild(fresh);
      window.scrollTo(0, 0);
      if (window.siteInitContent) window.siteInitContent(fresh);
      var done = false;
      var finish = function () {
        if (done) return;
        done = true;
        busy = null;
        [].forEach.call(stage.getAnimations ? stage.getAnimations({ subtree: true }) : [], function (a) { a.cancel(); });
        // Just before the old page goes: an app page (public/app-kit.js) moves itself out of it, so it never leaves the document.
        document.dispatchEvent(new CustomEvent("site:arrive", { detail: { old: oldMain } }));
        stage.replaceWith(fresh);
        styles.done();
        fresh.setAttribute("tabindex", "-1");
        fresh.focus({ preventScroll: true });
        fresh.addEventListener("blur", function () { fresh.removeAttribute("tabindex"); }, { once: true });
        if (res.url.hash) { var t = document.getElementById(decodeURIComponent(res.url.hash.slice(1))); if (t) t.scrollIntoView(); }
        (window.requestIdleCallback || function (f) { setTimeout(f, 800); })(function () { warmAll(); }); // refresh the copies that have gone stale
      };
      if (!animate) { finish(); return; }
      // One strip: the old page, the pages in between, the new one, a page-width apart; it travels the whole way in one movement.
      var w = stage.getBoundingClientRect().width;
      var hops = between.length + 1;
      var startPx = opts.startPx || 0;
      var left = Math.max(0.15, 1 - Math.abs(startPx) / (w * hops));
      var duration = Math.round((DURATION + 110 * (hops - 1)) * left);
      var opts2 = { duration: Math.min(duration, 820), easing: EASE, fill: "both" };
      var anims = [];
      [oldMain].concat(between).forEach(function (panel, k) {
        panel.style.position = "absolute";
        panel.style.top = "0";
        panel.style.left = "0";
        panel.style.right = "0";
        var y = k === 0 ? -sy : 0;
        anims.push(panel.animate([
          { transform: "translate(" + (dir * k * w + startPx) + "px," + y + "px)" },
          { transform: "translate(" + dir * (k - hops) * w + "px," + y + "px)" },
        ], opts2));
      });
      anims.push(fresh.animate([{ transform: "translateX(" + (dir * hops * w + startPx) + "px)" }, { transform: "translateX(0)" }], opts2));
      busy = { finish: finish };
      Promise.all(anims.map(function (a) { return a.finished; })).then(finish, finish);
    }).catch(function (err) {
      if (styles && !document.querySelector(".page-stage")) styles.undo(); // nothing was swapped: take the incoming page's styles back out
      if (opts.handover) opts.handover();
      throw err;
    });
  }
  function hard(url) {
    location.assign(url.href);
  }
  // A page that could not slide in loads the normal way; why is kept (console and sessionStorage "slideFallback") to find out later.
  function fallBack(url, err) {
    var why = (err && err.message) || "error";
    try { console.info("[page-slide] full load of " + url.pathname + ": " + why); sessionStorage.setItem("slideFallback", url.pathname + ": " + why); } catch (e) {}
    hard(url);
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
    go(url, dir, true).catch(function (err) { fallBack(url, err); });
  });
  // Warm the page up as soon as a tab is hovered, focused or touched, so the slide starts without waiting on the network.
  var warm = function (e) {
    var a = e.target.closest && e.target.closest(".tabs a, .brand");
    var url = eligible(a, { button: 0 });
    if (url && clean(url.pathname) !== clean(location.pathname)) fetchDoc(url.href).catch(function () {});
  };
  // And every page of the nav once the page has settled, so a tap slides at once even on a phone (no hover there to warm it).
  // A page that holds an app (the Studio, PicEditor, Simulations, Scans) has the kit and the app's script loaded early too: on a page
  // without it, it only fetches the editor in the background (public/app-kit.js, warm), so opening that tab does not wait for it.
  // Its first pictures are fetched too, so a page does not slide in with empty boxes that fill in after.
  var warmedPictures = {};
  function warmPictures(res) {
    if (warmedPictures[res.url.href]) return;
    warmedPictures[res.url.href] = 1;
    [].slice.call(res.doc.querySelectorAll("#main-content img")).slice(0, 8).forEach(function (img) {
      var pic = new Image();
      if (img.getAttribute("sizes")) pic.sizes = img.getAttribute("sizes");
      if (img.getAttribute("srcset")) pic.srcset = img.getAttribute("srcset");
      if (img.getAttribute("src")) pic.src = new URL(img.getAttribute("src"), res.url).href;
    });
  }
  var warmAll = function () {
    [].forEach.call(document.querySelectorAll(".tabs a.tab"), function (a) {
      var url = eligible(a, { button: 0 });
      if (!url || clean(url.pathname) === clean(location.pathname)) return;
      fetchDoc(url.href).then(function (res) {
        if (!swappable(res.doc)) return;
        warmPictures(res);
        if (res.doc.querySelector('script[src="/app-kit.js"]')) loadScripts(res.doc).catch(function () {});
      }).catch(function () {});
    });
  };
  if (navigator.connection && navigator.connection.saveData) warmAll = function () {};
  // As soon as the page itself is in (not after every picture and the analytics have loaded), then again when the browser is idle.
  var warmSoon = function () { setTimeout(warmAll, 300); };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", warmSoon);
  else warmSoon();
  window.addEventListener("load", function () {
    (window.requestIdleCallback || function (f) { setTimeout(f, 800); })(warmAll);
  });
  document.addEventListener("pointerover", warm, { passive: true });
  document.addEventListener("focusin", warm);
  document.addEventListener("touchstart", warm, { passive: true });
  // ---- A sideways swipe on the page (touch screens): the page follows the finger with the tab beside it coming in; let go past a quarter
  // of the screen (or flick) and it carries on there, otherwise it springs back. Not on things that use sideways drags themselves.
  var SWIPE_OFF = 'input, textarea, select, [contenteditable], canvas, video, audio, iframe, model-viewer, .app-native, .song-embed, .sim-embed, [class^="sim-"], .tabs, .site-finder, [data-no-swipe]';
  function scrollsSideways(el) {
    for (; el && el !== document.body; el = el.parentElement) {
      if (el.scrollWidth > el.clientWidth + 2) {
        var ox = getComputedStyle(el).overflowX;
        if (ox === "auto" || ox === "scroll") return true;
      }
    }
    return false;
  }
  var swipe = null;
  function neighbour(dir) {
    var list = tabs();
    var at = indexOfPath(location.pathname);
    var tab = at < 0 ? null : list[at + dir];
    if (!tab || !tab.getAttribute("href")) return null;
    var url = eligible(tab, { button: 0 });
    if (!url) return null;
    var res = ready[url.href];
    if (!res) fetchDoc(url.href).catch(function () {});
    return { url: url, res: res && swappable(res.doc) ? res : null };
  }
  function startSwipe(dir) {
    var main = document.getElementById("main-content");
    var stage = document.createElement("div");
    stage.className = "page-stage page-swipe";
    main.parentNode.insertBefore(stage, main);
    stage.appendChild(main);
    var next = neighbour(dir);
    var ghost = null;
    if (next && next.res) {
      ghost = ghostOf(next.res.doc);
      ghost.style.position = "absolute";
      ghost.style.left = "0";
      ghost.style.right = "0";
      ghost.style.top = Math.max(0, (window.pageYOffset || 0) - (stage.getBoundingClientRect().top + (window.pageYOffset || 0))) + "px";
      stage.appendChild(ghost);
    }
    swipe.dir = dir;
    swipe.stage = stage;
    swipe.main = main;
    swipe.ghost = ghost;
    swipe.next = next;
    swipe.w = stage.getBoundingClientRect().width;
  }
  function moveSwipe(dx) {
    // The wrong way, or no page beside it: it only gives a little, like the end of a list.
    var free = swipe.ghost && Math.sign(dx) === -swipe.dir;
    var x = free ? dx : dx * 0.25;
    swipe.x = x;
    swipe.main.style.transform = "translateX(" + x + "px)";
    if (swipe.ghost) swipe.ghost.style.transform = "translateX(" + (swipe.dir * swipe.w + x) + "px)";
  }
  function unwrapSwipe(s) {
    s.main.style.transform = "";
    if (s.stage.parentNode) s.stage.replaceWith(s.main);
  }
  function endSwipe() {
    var s = swipe;
    swipe = null;
    if (!s || !s.stage) return;
    var x = s.x || 0;
    var speed = Math.abs(x) / Math.max(1, Date.now() - s.t0);
    var go2 = s.ghost && Math.sign(x) === -s.dir && (Math.abs(x) > s.w * 0.25 || (Math.abs(x) > 40 && speed > 0.45));
    if (go2) {
      go(s.next.url, s.dir, true, { startPx: x, handover: function () { unwrapSwipe(s); if (s.ghost) s.ghost.remove(); } }).catch(function (err) { fallBack(s.next.url, err); });
      return;
    }
    // Back to where it was.
    var back = [s.main.animate([{ transform: "translateX(" + x + "px)" }, { transform: "translateX(0)" }], { duration: 220, easing: EASE })];
    if (s.ghost) back.push(s.ghost.animate([{ transform: "translateX(" + (s.dir * s.w + x) + "px)" }, { transform: "translateX(" + s.dir * s.w + "px)" }], { duration: 220, easing: EASE }));
    s.main.style.transform = "";
    Promise.all(back.map(function (a) { return a.finished; })).then(function () { unwrapSwipe(s); if (s.ghost) s.ghost.remove(); }, function () { unwrapSwipe(s); });
  }
  document.addEventListener("touchstart", function (e) {
    swipe = null;
    if (busy || e.touches.length !== 1 || reduced() || !document.documentElement.animate) return;
    var main = document.getElementById("main-content");
    var t = e.target;
    if (!main || !main.contains(t) || (t.closest && t.closest(SWIPE_OFF)) || scrollsSideways(t)) return;
    var p = e.touches[0];
    if (p.clientX < 24 || p.clientX > window.innerWidth - 24) return; // the browser's own edge swipes (back, forward) stay the browser's
    swipe = { x0: p.clientX, y0: p.clientY, t0: Date.now(), mode: null };
  }, { passive: true });
  document.addEventListener("touchmove", function (e) {
    if (!swipe) return;
    var p = e.touches[0];
    var dx = p.clientX - swipe.x0;
    var dy = p.clientY - swipe.y0;
    if (!swipe.mode) {
      if (Math.abs(dx) < 10 && Math.abs(dy) < 10) return;
      if (Math.abs(dx) < Math.abs(dy) * 1.4) { swipe = null; return; } // a scroll up or down
      swipe.mode = "x";
      swipe.t0 = Date.now();
      startSwipe(dx < 0 ? 1 : -1);
    }
    e.preventDefault();
    moveSwipe(dx);
  }, { passive: false });
  document.addEventListener("touchend", endSwipe);
  document.addEventListener("touchcancel", endSwipe);

  // ---- The same drag with a mouse: press on the page's own space (not on text, a link, a button or a control) and drag hard sideways. It
  // only starts after a clear sideways pull of 28 px with nothing selected, so selecting text, dragging a picture or using a slider still
  // work as always; the click that ends such a drag is swallowed. Same rules after that: past a quarter of the width (or a quick flick)
  // it goes to the tab beside it, otherwise it springs back.
  var MOUSE_OFF = SWIPE_OFF + ', a, button, summary, label, img, svg, [draggable="true"], [role="slider"], [role="button"]';
  var mouse = null;
  document.addEventListener("mousedown", function (e) {
    mouse = null;
    if (e.button !== 0 || busy || reduced() || !document.documentElement.animate) return;
    var main = document.getElementById("main-content");
    var t = e.target;
    if (!main || !main.contains(t) || (t.closest && t.closest(MOUSE_OFF)) || scrollsSideways(t)) return;
    mouse = { x0: e.clientX, y0: e.clientY, t0: Date.now(), mode: null };
  });
  document.addEventListener("mousemove", function (e) {
    if (!mouse) return;
    if (!(e.buttons & 1)) { mouse = null; return; }
    var dx = e.clientX - mouse.x0;
    var dy = e.clientY - mouse.y0;
    if (!mouse.mode) {
      if (Math.abs(dy) > 14 && Math.abs(dy) > Math.abs(dx)) { mouse = null; return; }
      if (Math.abs(dx) < 28 || Math.abs(dx) < Math.abs(dy) * 2) return;
      var sel = window.getSelection && window.getSelection();
      if (sel && !sel.isCollapsed) { mouse = null; return; } // that is a text selection
      mouse.mode = "x";
      mouse.t0 = Date.now();
      swipe = { x0: mouse.x0, y0: mouse.y0, t0: mouse.t0, mode: "x" };
      startSwipe(dx < 0 ? 1 : -1);
      document.documentElement.classList.add("is-page-dragging");
    }
    e.preventDefault();
    if (window.getSelection) window.getSelection().removeAllRanges();
    if (swipe) moveSwipe(dx);
  });
  function endMouse() {
    if (!mouse) return;
    var dragged = mouse.mode === "x";
    mouse = null;
    if (!dragged) return;
    document.documentElement.classList.remove("is-page-dragging");
    endSwipe();
    var swallow = function (ev) { ev.stopPropagation(); ev.preventDefault(); };
    document.addEventListener("click", swallow, { capture: true, once: true });
    setTimeout(function () { document.removeEventListener("click", swallow, true); }, 60);
  }
  document.addEventListener("mouseup", endMouse);
  window.addEventListener("blur", endMouse);

  window.addEventListener("popstate", function () {
    var now = location.pathname + location.search;
    if (now === loaded) return; // only the #hash changed
    var url = new URL(location.href);
    var dir = directionTo(url, loaded.split("?")[0]);
    go(url, dir, false).catch(function () { location.reload(); });
  });
})();
