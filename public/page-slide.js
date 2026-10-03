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
