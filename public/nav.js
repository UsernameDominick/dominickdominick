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
  });
})();
