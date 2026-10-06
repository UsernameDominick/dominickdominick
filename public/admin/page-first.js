// The admin opens on the page itself: the page chooser lives in the top bar on a wide screen (and stays in the menu drawer on a phone, where
// the bar has no room). DOM only; the editing itself is in app.js.
(function () {
  "use strict";
  const group = document.querySelector(".admin-sidebar-pages");
  const slot = document.getElementById("sidebar-pages-slot");
  const header = document.querySelector(".admin-header");
  const anchor = document.querySelector(".page-actions");
  if (!group || !slot || !header || !anchor) return;
  const wide = window.matchMedia("(min-width: 861px)");
  function place() {
    if (wide.matches) header.insertBefore(group, anchor);
    else slot.appendChild(group);
  }
  place();
  if (wide.addEventListener) wide.addEventListener("change", place);
  else if (wide.addListener) wide.addListener(place);
})();
