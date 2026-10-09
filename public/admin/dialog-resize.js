// Dialogs resize from their sides: pull the left or right edge to make the dialog narrower or wider (it stays centred, so the edge
// follows the pointer). Double-click an edge, or press Home on it, to go back to the default width. Arrow keys nudge it. Widths are
// remembered per dialog in this browser. The little corner grip is gone: the CSS drops the native text-box grip inside dialogs.
// Builders, the command palette and the small confirm boxes keep their own sizing. Phones are untouched (dialogs fill the screen).
(function () {
  const KEY = "admin-dialog-widths:v1";
  const MIN = 420;
  const GAP = 48;
  const SKIP = new Set(["command-modal", "song-builder-modal", "typed-confirm-modal"]);

  // The widest a dialog can be is the room beside the menu; the narrowest is MIN (or the room, if that is smaller).
  function clampDialogWidth(value, room) {
    const n = Math.round(Number(value));
    const max = Number.isFinite(room) ? Math.max(0, room) : 2000;
    const min = Math.min(MIN, max);
    if (!Number.isFinite(n)) return null;
    return Math.min(max, Math.max(min, n));
  }
  function parseWidths(raw) {
    const out = {};
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return out;
    }
    if (!data || typeof data !== "object" || Array.isArray(data)) return out;
    for (const key of Object.keys(data)) {
      const w = data[key];
      if (/^[a-z0-9_-]{1,64}$/i.test(key) && typeof w === "number" && Number.isFinite(w) && w >= MIN && w <= 4000) out[key] = Math.round(w);
    }
    return out;
  }
  const api = { clampDialogWidth, parseWidths, MIN };
  if (typeof window !== "undefined") window.AdminDialogResize = api;
  if (typeof document === "undefined" || !document.body) return;

  const desktop = window.matchMedia("(min-width: 861px)");
  let saved;
  try {
    saved = parseWidths(localStorage.getItem(KEY));
  } catch (e) {
    saved = {};
  }
  const persist = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(saved));
    } catch (e) {
      /* it just will not be remembered */
    }
  };
  const roomOf = (modal) => window.innerWidth - (parseFloat(getComputedStyle(modal).paddingLeft) || 0) - GAP;

  function setWidth(modal, inner, width, remember) {
    const w = clampDialogWidth(width, roomOf(modal));
    if (w == null) return;
    inner.style.maxWidth = "calc(100vw - var(--admin-sidebar-width, 0px) - " + GAP + "px)";
    inner.style.width = w + "px";
    inner.dataset.customWidth = String(w);
    for (const h of inner.querySelectorAll(":scope > .dialog-resizer")) {
      h.setAttribute("aria-valuenow", String(w));
      h.setAttribute("aria-valuetext", w + " pixels wide");
    }
    if (remember) {
      saved[modal.id] = w;
      persist();
    }
  }
  function resetWidth(modal, inner) {
    inner.style.width = "";
    inner.style.maxWidth = "";
    delete inner.dataset.customWidth;
    delete saved[modal.id];
    persist();
    const w = inner.offsetWidth;
    for (const h of inner.querySelectorAll(":scope > .dialog-resizer")) {
      h.setAttribute("aria-valuenow", String(w));
      h.setAttribute("aria-valuetext", w + " pixels wide");
    }
  }

  function enhance(modal) {
    if (!modal.id || SKIP.has(modal.id) || modal.dataset.dialogResize) return;
    const inner = modal.querySelector(":scope > .modal-inner");
    if (!inner || !inner.querySelector(":scope > header")) return;
    modal.dataset.dialogResize = "1";
    for (const side of ["left", "right"]) {
      const h = document.createElement("div");
      h.className = "dialog-resizer dialog-resizer-" + side;
      h.setAttribute("role", "separator");
      h.setAttribute("aria-orientation", "vertical");
      h.setAttribute("aria-label", "Resize this dialog from its " + side + " edge (arrow keys, Home to reset)");
      h.setAttribute("aria-valuemin", String(MIN));
      h.setAttribute("aria-valuemax", "2000");
      h.setAttribute("aria-valuenow", String(saved[modal.id] || 640)); // a real value is read from the dialog when the handle is used
      h.tabIndex = 0;
      h.title = "Drag to resize, double-click to reset";
      inner.appendChild(h);
      const sign = side === "right" ? 1 : -1;
      h.addEventListener("pointerdown", (e) => {
        if (e.button !== 0 || !desktop.matches) return;
        e.preventDefault();
        const startX = e.clientX;
        const startW = inner.offsetWidth;
        h.setPointerCapture(e.pointerId);
        document.body.classList.add("panel-resizing");
        const move = (ev) => setWidth(modal, inner, startW + 2 * sign * (ev.clientX - startX), false);
        const end = () => {
          h.removeEventListener("pointermove", move);
          h.removeEventListener("pointerup", end);
          h.removeEventListener("pointercancel", end);
          document.body.classList.remove("panel-resizing");
          if (inner.dataset.customWidth) {
            saved[modal.id] = Number(inner.dataset.customWidth);
            persist();
          }
        };
        h.addEventListener("pointermove", move);
        h.addEventListener("pointerup", end);
        h.addEventListener("pointercancel", end);
      });
      h.addEventListener("focus", () => {
        const w = inner.offsetWidth;
        if (w) {
          h.setAttribute("aria-valuenow", String(w));
          h.setAttribute("aria-valuetext", w + " pixels wide");
        }
      });
      h.addEventListener("dblclick", () => resetWidth(modal, inner));
      h.addEventListener("keydown", (e) => {
        const step = e.shiftKey ? 96 : 32;
        const now = inner.offsetWidth;
        if (e.key === "ArrowRight") setWidth(modal, inner, now + sign * step, true);
        else if (e.key === "ArrowLeft") setWidth(modal, inner, now - sign * step, true);
        else if (e.key === "Home") resetWidth(modal, inner);
        else return;
        e.preventDefault();
      });
    }
    if (saved[modal.id]) setWidth(modal, inner, saved[modal.id], false);
  }

  document.querySelectorAll(".modal").forEach(enhance);
  new MutationObserver((records) => {
    for (const r of records) {
      r.addedNodes.forEach((n) => {
        if (n.nodeType !== 1) return;
        if (n.classList.contains("modal")) enhance(n);
        else n.querySelectorAll && n.querySelectorAll(".modal").forEach(enhance);
      });
    }
  }).observe(document.body, { childList: true });
})();
