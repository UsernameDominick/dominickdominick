// Rotary dials. A range input in a dial keeps being the real control (keyboard, forms, labels, tests) and a round face is drawn over it: a dark cap
// in a ring, a glowing arc up to the value and a pink mark at the pointer. Drag up or down on the face (hold Shift for fine steps), or use the
// arrow keys on the focused input. Asking for one: a range input with class "dial-me" (or inside .dial-scope) is enhanced as it appears.
(function () {
  "use strict";
  const SWEEP = 270; // from 7:30 round to 4:30, clockwise
  const DRAG_PX = 180; // pixels of drag for the whole range
  const NS = "http://www.w3.org/2000/svg";

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  function fraction(input) {
    const min = num(input.min, 0);
    const max = num(input.max, 100);
    return max > min ? Math.max(0, Math.min(1, (num(input.value, min) - min) / (max - min))) : 0;
  }

  function enhance(input) {
    if (!input || input.dataset.dial === "on" || input.hasAttribute("data-no-dial") || input.type !== "range") return;
    input.dataset.dial = "on";
    const wrap = document.createElement("span");
    wrap.className = "dial";
    input.parentNode.insertBefore(wrap, input);
    wrap.appendChild(input);
    input.classList.add("dial-input");
    const face = document.createElement("span");
    face.className = "dial-face";
    face.setAttribute("aria-hidden", "true");
    face.innerHTML =
      `<svg viewBox="0 0 64 64" focusable="false">` +
      `<circle class="dial-halo" cx="32" cy="32" r="31"/>` +
      `<circle class="dial-track" cx="32" cy="32" r="26" pathLength="100" stroke-dasharray="75 100" transform="rotate(135 32 32)"/>` +
      `<circle class="dial-glow" cx="32" cy="32" r="26" pathLength="100" stroke-dasharray="0 100" transform="rotate(135 32 32)"/>` +
      `<circle class="dial-cap" cx="32" cy="32" r="19"/>` +
      `<g class="dial-hand"><line x1="32" y1="17" x2="32" y2="24"/></g>` +
      `</svg>`;
    wrap.appendChild(face);
    const glow = face.querySelector(".dial-glow");
    const hand = face.querySelector(".dial-hand");

    function draw() {
      const f = fraction(input);
      glow.setAttribute("stroke-dasharray", `${(75 * f).toFixed(2)} 100`);
      hand.setAttribute("transform", `rotate(${(-SWEEP / 2 + SWEEP * f).toFixed(2)} 32 32)`);
      wrap.classList.toggle("is-disabled", input.disabled);
    }
    draw();
    ["input", "change"].forEach((t) => input.addEventListener(t, draw));
    // A value set from code (a slider reset, a panel filled in) never fires an event: the value property reports it instead.
    try {
      const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value");
      Object.defineProperty(input, "value", {
        configurable: true,
        get() { return proto.get.call(this); },
        set(v) { proto.set.call(this, v); draw(); },
      });
    } catch (e) {
      /* the dial then follows events only */
    }
    new MutationObserver(draw).observe(input, { attributes: true, attributeFilter: ["min", "max", "step", "disabled"] });

    // Dragging the face.
    let drag = null;
    face.addEventListener("pointerdown", (e) => {
      if (input.disabled || (e.button !== undefined && e.button > 0)) return;
      e.preventDefault();
      face.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, y: e.clientY, start: num(input.value, 0), moved: false };
      wrap.classList.add("is-turning");
      input.focus({ preventScroll: true });
    });
    face.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const min = num(input.min, 0);
      const max = num(input.max, 100);
      const step = num(input.step, 1) || 1;
      const span = (max - min) * ((drag.y - e.clientY) / (e.shiftKey ? DRAG_PX * 4 : DRAG_PX));
      let v = Math.max(min, Math.min(max, drag.start + span));
      v = min + Math.round((v - min) / step) * step;
      v = Math.max(min, Math.min(max, Number(v.toFixed(6))));
      if (String(v) === input.value) return;
      drag.moved = true;
      input.value = String(v);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const moved = drag.moved;
      drag = null;
      wrap.classList.remove("is-turning");
      if (moved) input.dispatchEvent(new Event("change", { bubbles: true }));
    };
    face.addEventListener("pointerup", end);
    face.addEventListener("pointercancel", end);
    // A double tap takes the dial back to its own value, the way a double-click on a slider already does.
    face.addEventListener("dblclick", () => input.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true })));
  }

  function scan(root) {
    (root || document).querySelectorAll('.dial-scope input[type="range"], input[type="range"].dial-me').forEach(enhance);
  }
  window.Dial = { enhance, scan };
  scan(document);
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => {
      queued = false;
      scan(document);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
})();
