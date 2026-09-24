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
