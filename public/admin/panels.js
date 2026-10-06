// Desktop side panels: drag the edge of the menu, the block palette or the inspector to resize it (double-click or Home puts it back),
// hide the menu and the inspector from the top bar (Ctrl/Cmd+B hides the menu). Sizes and choices are remembered in this browser.
// The palette is hidden by the existing Focus button. Phones keep their slide-in drawers: none of this runs below 861px.
(function () {
  const KEY = "admin-panels:v2"; // v2: the admin opens on the page alone (menu and inspector tucked away) until a choice is made
  const PANELS = {
    sidebar: { id: "admin-sidebar", side: "right", def: 240, min: 180, max: 400, label: "menu" },
    palette: { id: "palette", side: "right", def: 240, min: 200, max: 480, label: "block palette" },
    inspector: { id: "inspector", side: "left", def: 240, min: 220, max: 560, label: "inspector" },
  };
  const MIN_WORKSPACE = 360;

  function clampWidth(name, value, room) {
    const p = PANELS[name];
    const n = Math.round(Number(value));
    if (!p || !Number.isFinite(n)) return p ? p.def : 0;
    const max = Math.max(p.min, Math.min(p.max, Number.isFinite(room) ? room : p.max));
    return Math.min(max, Math.max(p.min, n));
  }
  // What is stored is untrusted (another version, hand edits): keep only known keys with sensible values.
  function parseState(raw) {
    const out = { w: {}, hidden: {} };
    let data = null;
    try {
      data = JSON.parse(raw);
    } catch (e) {
      return out;
    }
    if (!data || typeof data !== "object") return out;
    for (const name of Object.keys(PANELS)) {
      const w = data.w && data.w[name];
      if (typeof w === "number" && Number.isFinite(w)) out.w[name] = clampWidth(name, w);
    }
    if (data.hidden && data.hidden.sidebar === true) out.hidden.sidebar = true;
    if (data.hidden && data.hidden.inspector === true) out.hidden.inspector = true;
    return out;
  }
  const api = { PANELS, clampWidth, parseState, MIN_WORKSPACE };
  if (typeof window !== "undefined") window.AdminPanels = api;
  if (typeof document === "undefined" || !document.body) return;

  const desktop = window.matchMedia("(min-width: 861px)");
  let state;
  try {
    const stored = localStorage.getItem(KEY);
    state = stored === null ? { w: {}, hidden: { sidebar: true, inspector: true } } : parseState(stored);
  } catch (e) {
    state = { w: {}, hidden: { sidebar: true, inspector: true } };
  }
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      /* it just will not be remembered */
    }
  };
  const widthOf = (name) => (state.w[name] != null ? state.w[name] : PANELS[name].def);
  // Room a panel may take: the window minus the other open panels minus a usable workspace.
  function roomFor(name) {
    let others = 0;
    for (const other of Object.keys(PANELS)) {
      if (other === name) continue;
      const el = document.getElementById(PANELS[other].id);
      if (el && el.offsetParent !== null) others += el.getBoundingClientRect().width;
    }
    return window.innerWidth - others - MIN_WORKSPACE;
  }

  function apply() {
    const body = document.body;
    body.classList.toggle("panel-sidebar-collapsed", !!state.hidden.sidebar);
    body.classList.toggle("panel-inspector-collapsed", !!state.hidden.inspector);
    body.style.setProperty("--admin-sidebar-width", state.hidden.sidebar ? "0px" : widthOf("sidebar") + "px");
    body.style.setProperty("--admin-palette-width", widthOf("palette") + "px");
    body.style.setProperty("--admin-inspector-width", widthOf("inspector") + "px");
    const menuBtn = document.getElementById("sidebar-toggle-btn");
    if (menuBtn) menuBtn.setAttribute("aria-pressed", String(!state.hidden.sidebar));
    const insBtn = document.getElementById("inspector-toggle-btn");
    if (insBtn) insBtn.setAttribute("aria-pressed", String(!state.hidden.inspector));
    for (const [name, handle] of Object.entries(handles)) {
      const w = widthOf(name);
      handle.setAttribute("aria-valuenow", String(w));
      handle.setAttribute("aria-valuetext", w + " pixels wide");
    }
  }

  function setWidth(name, value, persist) {
    state.w[name] = clampWidth(name, value, roomFor(name));
    apply();
    if (persist) save();
  }
  function resetWidth(name) {
    delete state.w[name];
    apply();
    save();
  }
  function toggleHidden(name, force) {
    const next = force === undefined ? !state.hidden[name] : !!force;
    if (next) state.hidden[name] = true;
    else delete state.hidden[name];
    apply();
    save();
  }

  const handles = {};
  function makeHandle(name) {
    const p = PANELS[name];
    const panel = document.getElementById(p.id);
    if (!panel) return;
    const h = document.createElement("div");
    h.className = "panel-resizer panel-resizer-" + p.side;
    h.setAttribute("role", "separator");
    h.setAttribute("aria-orientation", "vertical");
    h.setAttribute("aria-label", "Resize the " + p.label + " (arrow keys, Home to reset)");
    h.setAttribute("aria-valuemin", String(p.min));
    h.setAttribute("aria-valuemax", String(p.max));
    h.tabIndex = 0;
    h.title = "Drag to resize, double-click to reset";
    panel.appendChild(h);
    handles[name] = h;

    h.addEventListener("pointerdown", (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      const startX = e.clientX;
      const startW = panel.getBoundingClientRect().width;
      const sign = p.side === "right" ? 1 : -1;
      h.setPointerCapture(e.pointerId);
      document.body.classList.add("panel-resizing");
      const move = (ev) => setWidth(name, startW + sign * (ev.clientX - startX), false);
      const end = () => {
        h.removeEventListener("pointermove", move);
        h.removeEventListener("pointerup", end);
        h.removeEventListener("pointercancel", end);
        document.body.classList.remove("panel-resizing");
        save();
      };
      h.addEventListener("pointermove", move);
      h.addEventListener("pointerup", end);
      h.addEventListener("pointercancel", end);
    });
    h.addEventListener("dblclick", () => resetWidth(name));
    h.addEventListener("keydown", (e) => {
      const step = e.shiftKey ? 48 : 16;
      const sign = p.side === "right" ? 1 : -1;
      let handled = true;
      if (e.key === "ArrowRight") setWidth(name, widthOf(name) + sign * step, true);
      else if (e.key === "ArrowLeft") setWidth(name, widthOf(name) - sign * step, true);
      else if (e.key === "Home") resetWidth(name);
      else handled = false;
      if (handled) e.preventDefault();
    });
  }

  Object.keys(PANELS).forEach(makeHandle);
  // For the page editor: bring a panel into view when something needs it (the block's settings).
  api.show = (name) => { if (state.hidden[name]) toggleHidden(name, false); };
  const menuBtn = document.getElementById("sidebar-toggle-btn");
  if (menuBtn) menuBtn.addEventListener("click", () => toggleHidden("sidebar"));
  const insBtn = document.getElementById("inspector-toggle-btn");
  if (insBtn) insBtn.addEventListener("click", () => toggleHidden("inspector"));
  document.addEventListener("keydown", (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || String(e.key).toLowerCase() !== "b") return;
    if (!desktop.matches) return;
    // Leave Ctrl+B alone while writing (bold in a rich field) and while a dialog is open.
    const t = e.target;
    if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
    if (document.querySelector(".modal:not([hidden])")) return;
    e.preventDefault();
    toggleHidden("sidebar");
  });
  // Narrow windows are covered in CSS (each panel is capped at a share of the width), so the workspace is never squeezed out.
  apply();
})();
