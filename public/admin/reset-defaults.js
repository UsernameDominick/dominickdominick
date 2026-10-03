// Reset one control to its default without resetting the whole panel. Every slider (and every number box that starts with a value in
// the page) gets a small reset button that shows up once it has been moved off its default, and double-clicking the slider or its label
// resets it too. A control's default is the value it starts with in the page's HTML; mark a control data-default="..." to give it a
// different one (works on any input or select) or data-no-reset to leave it alone. Resetting fires the same input and change events a
// person would, so whatever listens to the control (previews, readouts) follows.
(function () {
  const NO_RESET_ID = /^pe-sel-box-/;

  function sameValue(a, b) {
    const x = String(a);
    const y = String(b);
    if (x === y) return true;
    const nx = Number(x);
    const ny = Number(y);
    return x.trim() !== "" && y.trim() !== "" && Number.isFinite(nx) && Number.isFinite(ny) && nx === ny;
  }
  // The default a control resets to, or null if it has none. el is anything with getAttribute/type/id.
  function defaultFor(el) {
    if (!el || el.getAttribute("data-no-reset") != null) return null;
    const explicit = el.getAttribute("data-default");
    if (explicit != null) return explicit;
    if (NO_RESET_ID.test(el.id || "")) return null;
    const attr = el.getAttribute("value");
    if (attr == null) return null;
    const type = String(el.type || el.getAttribute("type") || "").toLowerCase();
    return type === "range" || type === "number" ? attr : null;
  }
  const api = { sameValue, defaultFor };
  if (typeof window !== "undefined") window.AdminResetDefaults = api;
  if (typeof document === "undefined" || !document.body) return;

  const tracked = [];
  function nameOf(el) {
    const aria = el.getAttribute("aria-label");
    if (aria) return aria;
    const label = el.closest("label");
    if (label) {
      let text = "";
      label.childNodes.forEach((n) => {
        if (n.nodeType === 3) text += n.textContent;
      });
      text = text.replace(/\s+/g, " ").trim();
      if (text) return text;
    }
    return el.getAttribute("title") || el.id || "this control";
  }
  function reset(el, def) {
    if (sameValue(el.value, def)) return;
    el.value = def;
    el.dispatchEvent(new Event("input", { bubbles: true }));
    el.dispatchEvent(new Event("change", { bubbles: true }));
  }
  // The button floats at the top-right corner of its label, outside the label and out of the layout flow, so it never moves
  // neighbouring controls and never becomes part of the label's accessible name.
  function place(entry) {
    const a = entry.anchor;
    if (entry.button.hidden || a.offsetParent === null) return;
    entry.button.style.left = Math.max(0, a.offsetLeft + a.offsetWidth - 20) + "px";
    entry.button.style.top = Math.max(0, a.offsetTop - 9) + "px";
  }
  function sync(entry) {
    const changed = !sameValue(entry.el.value, entry.def);
    if (entry.button.hidden === !changed) {
      place(entry);
      return;
    }
    entry.button.hidden = !changed;
    if (changed) entry.button.setAttribute("aria-label", "Reset " + nameOf(entry.el) + " to " + entry.def);
    place(entry);
  }
  function enhance(el) {
    if (el.dataset.resetReady) return;
    const def = defaultFor(el);
    if (def == null) return;
    el.dataset.resetReady = "1";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "reset-default";
    if (el.id) button.dataset.for = el.id;
    button.hidden = true;
    button.textContent = "↺";
    button.title = "Reset to default (" + def + ")";
    const anchor = el.closest("label") || el;
    anchor.insertAdjacentElement("afterend", button);
    const entry = { el, def, button, anchor };
    tracked.push(entry);
    button.addEventListener("click", () => {
      reset(el, def);
      sync(entry);
      el.focus({ preventScroll: true });
    });
    const label = el.closest("label");
    // Double-click the slider, or the words of its label, to reset; on a number box only the label counts (double-click there selects text).
    if (el.type === "range") {
      el.addEventListener("dblclick", () => {
        reset(el, def);
        sync(entry);
      });
    }
    if (label && !label.dataset.resetDbl) {
      label.dataset.resetDbl = "1";
      label.addEventListener("dblclick", (e) => {
        const target = e.target;
        if (target.closest && target.closest("input, select, textarea, button, output")) return;
        const first = tracked.find((t) => t.el.closest("label") === label);
        if (first) {
          reset(first.el, first.def);
          sync(first);
        }
      });
    }
    sync(entry);
  }
  document.querySelectorAll('input[type="range"], input[type="number"], [data-default]').forEach(enhance);
  const refresh = () => tracked.forEach(sync);
  window.addEventListener("resize", refresh);
  document.addEventListener("input", refresh);
  document.addEventListener("change", refresh);
  // Code sets some of these directly (opening a photo, loading a song) without an event: a slow sweep keeps the buttons honest.
  setInterval(() => {
    if (!document.hidden) refresh();
  }, 500);
})();
