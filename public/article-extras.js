(function () {
  // Reading progress bar — only present on article pages.
  var bar = document.querySelector(".reading-progress");
  if (bar) {
    var update = function () {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      var pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  }

  // Copy-link button — copies the current page URL to the clipboard.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".copy-link-btn");
    if (!btn) return;
    var reset = function () {
      btn.textContent = btn.dataset.copyText || "Copy link";
    };
    navigator.clipboard
      .writeText(window.location.href)
      .then(function () {
        btn.textContent = btn.dataset.copiedText || "Copied!";
        setTimeout(reset, 1800);
      })
      .catch(function () {
        reset();
      });
  });
})();
