// Open a picture larger: click an image block, a gallery picture or a picture in the text and it opens in a full-screen viewer.
// Escape closes it, the arrow keys (or the buttons, or a swipe) step through the other pictures in the same gallery or on the page, and
// focus goes back to the picture you opened. Built on the browser's own <dialog>, so keyboard focus stays inside while it is open.
// Without this script (or without <dialog>) the pictures simply stay as they are.
(function () {
  if (typeof HTMLDialogElement !== "function") return;

  var SELECTOR = ".block-image, .gallery img, .body-figure img, .image-figure img";
  var dialog = null;
  var parts = {};
  var group = [];
  var index = 0;
  var opener = null;

  // A picture that is a link to somewhere, or half of a before/after slider, already does something when pressed.
  function zoomable(img) {
    return img.tagName === "IMG" && img.matches(SELECTOR) && !img.closest("a, button, .before-after") && !!(img.currentSrc || img.src);
  }

  function groupFor(img) {
    var gallery = img.closest(".gallery");
    var root = gallery || document;
    return Array.prototype.filter.call(root.querySelectorAll(SELECTOR), function (el) {
      return zoomable(el) && (gallery || !el.closest(".gallery"));
    });
  }

  function captionFor(img) {
    var fig = img.closest("figure");
    var cap = fig && fig.querySelector("figcaption");
    if (cap && cap.textContent.trim()) return cap.textContent.trim();
    return img.getAttribute("alt") || "";
  }

  function build() {
    dialog = document.createElement("dialog");
    dialog.className = "lightbox";
    dialog.setAttribute("aria-label", "Image viewer");
    dialog.innerHTML =
      '<button type="button" class="lightbox-close" aria-label="Close image viewer">×</button>' +
      '<button type="button" class="lightbox-nav lightbox-prev" aria-label="Previous image">‹</button>' +
      '<figure class="lightbox-figure"><img class="lightbox-img" alt=""><figcaption class="lightbox-caption"></figcaption></figure>' +
      '<button type="button" class="lightbox-nav lightbox-next" aria-label="Next image">›</button>' +
      '<p class="lightbox-count" role="status" aria-live="polite"></p>';
    document.body.appendChild(dialog);
    parts.img = dialog.querySelector(".lightbox-img");
    parts.caption = dialog.querySelector(".lightbox-caption");
    parts.count = dialog.querySelector(".lightbox-count");
    parts.prev = dialog.querySelector(".lightbox-prev");
    parts.next = dialog.querySelector(".lightbox-next");
    dialog.querySelector(".lightbox-close").addEventListener("click", close);
    parts.prev.addEventListener("click", function () { step(-1); });
    parts.next.addEventListener("click", function () { step(1); });
    // A press on the dark area around the picture closes it (a press on the picture, caption or buttons does not).
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog) close();
    });
    dialog.addEventListener("keydown", function (e) {
      if (e.key === "ArrowLeft") { e.preventDefault(); step(-1); }
      else if (e.key === "ArrowRight") { e.preventDefault(); step(1); }
      else if (e.key === "Home") { e.preventDefault(); show(0); }
      else if (e.key === "End") { e.preventDefault(); show(group.length - 1); }
    });
    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("lightbox-open");
      parts.img.removeAttribute("src");
      var back = opener;
      opener = null;
      if (back && document.contains(back) && typeof back.focus === "function") back.focus({ preventScroll: true });
    });
    // A swipe left or right on a touch screen steps through the pictures.
    var startX = null;
    dialog.addEventListener("touchstart", function (e) { startX = e.touches.length === 1 ? e.touches[0].clientX : null; }, { passive: true });
    dialog.addEventListener("touchend", function (e) {
      if (startX === null || !e.changedTouches.length) return;
      var dx = e.changedTouches[0].clientX - startX;
      startX = null;
      if (Math.abs(dx) > 60) step(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function show(i) {
    if (!group.length) return;
    index = (i + group.length) % group.length;
    var img = group[index];
    var src = img.currentSrc || img.src;
    parts.img.src = src;
    parts.img.alt = img.getAttribute("alt") || "";
    var caption = captionFor(img);
    parts.caption.textContent = caption;
    parts.caption.hidden = !caption;
    var many = group.length > 1;
    parts.prev.hidden = parts.next.hidden = parts.count.hidden = !many;
    parts.count.textContent = many ? "Image " + (index + 1) + " of " + group.length : "";
    // The neighbours are fetched now so stepping to them is instant.
    [index - 1, index + 1].forEach(function (n) {
      var other = group[(n + group.length) % group.length];
      if (other && other !== img) new Image().src = other.currentSrc || other.src;
    });
  }

  function step(by) {
    show(index + by);
  }

  function open(img) {
    if (!dialog) build();
    group = groupFor(img);
    var at = group.indexOf(img);
    if (at < 0) return;
    opener = img;
    show(at);
    document.documentElement.classList.add("lightbox-open");
    if (!dialog.open) dialog.showModal();
    if (window.trackEvent) window.trackEvent("lightbox_open");
  }

  function close() {
    if (dialog && dialog.open) dialog.close();
  }

  // Pictures with a description can be reached and opened from the keyboard; a decorative one (empty alt) is for the mouse only.
  function prepare(root) {
    Array.prototype.forEach.call((root || document).querySelectorAll(SELECTOR), function (img) {
      if (!zoomable(img) || img.dataset.lbReady) return;
      img.dataset.lbReady = "1";
      img.classList.add("lb-zoomable");
      if ((img.getAttribute("alt") || "").trim()) {
        img.tabIndex = 0;
        img.setAttribute("role", "button");
        img.setAttribute("aria-label", "View larger: " + img.getAttribute("alt").trim());
      }
    });
  }

  document.addEventListener("click", function (e) {
    var img = e.target.closest && e.target.closest(SELECTOR);
    if (!img || e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button > 0) return;
    if (!img.dataset.lbReady) return;
    open(img);
  });
  document.addEventListener("keydown", function (e) {
    if ((e.key !== "Enter" && e.key !== " ") || !e.target.matches || !e.target.matches(SELECTOR) || !e.target.dataset.lbReady) return;
    e.preventDefault();
    open(e.target);
  });

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", function () { prepare(); });
  else prepare();
})();
