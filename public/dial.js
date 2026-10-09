// Rotary dials. A range input in a dial keeps being the real control (keyboard, forms, labels, tests) and a 1-bit face is drawn over it: eleven ticks
// round a paper disc, the ticks up to the value lit (the one orange on the face) and a needle at the pointer. Asking for one: a range input with class
// "dial-me" (or inside .dial-scope) is enhanced as it appears.
//
// Operating a dial:
//   drag up or down on the face   the whole range takes 180 px; hold Shift (or, on a touch screen, press and hold for a moment before moving) for a
//                                 four times finer drag; pressing or letting go of Shift mid-drag carries on from where the value is, with no jump
//   arrow keys                    one step; with Shift ten steps; PageUp and PageDown a tenth of the range (Shift: a hundredth); Home and End the ends
//   mouse wheel                   one percent of the range a notch (Shift: a fifth of that), only while the dial has the focus (so the page still scrolls)
//   double-click, double-tap,
//   Alt-click (no drag)           back to the dial's own value (see configure's reset or a data-default); Alt held through a drag turns the detents off
//   Enter                         type the value in its own unit (Dial.edit); Enter applies, Esc cancels
// Window.Dial.configure(input, { format, parse, def, detents, detent, reset }) tells a dial what its numbers mean: format(sliderValue) is the text shown in the
// bubble while turning and read out to screen readers (aria-valuetext); parse(text) turns typed text back into a slider value (or null); def is the slider
// value of the dial's own setting (a small mark on the face); detents are slider values the drag is pulled onto (within `detent`, a fraction of the range,
// default 2 percent; Alt turns the pull off); reset() puts the dial back to its own setting (the page then sets the value, which redraws the face);
// aria: false leaves the page's own aria-valuetext in place (the bubble still shows format).
(function () {
  "use strict";
  const SWEEP = 270; // from 7:30 round to 4:30, clockwise
  const DRAG_PX = 180; // pixels of drag for the whole range
  const FINE = 4; // how much finer the fine drag is
  const HOLD_MS = 350; // a touch held still this long before moving turns the fine drag on
  const DETENT = 0.02; // the pull of a detent, as a fraction of the range

  const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

  // ---- the maths, with no page in it (tests/dial.test.mjs) ----
  const DialMath = {
    clamp,
    // a value on the input's own grid (min, then every step), inside its range
    quantize(v, min, max, step) {
      const s = step > 0 ? step : 1;
      return clamp(Number((min + Math.round((v - min) / s) * s).toFixed(6)), min, max);
    },
    fraction(v, min, max) {
      return max > min ? clamp((v - min) / (max - min), 0, 1) : 0;
    },
    // the value after dragging up by `dy` pixels (negative: down) from `start`
    dragValue(start, dy, min, max, step, fine) {
      return DialMath.quantize(start + ((max - min) * dy) / (fine ? DRAG_PX * FINE : DRAG_PX), min, max, step);
    },
    // the value after a key, or null when the key is not one the dial uses
    keyValue(key, shift, value, min, max, step) {
      const s = step > 0 ? step : 1;
      const span = max - min;
      let v;
      switch (key) {
        case "ArrowUp": case "ArrowRight": v = value + s * (shift ? 10 : 1); break;
        case "ArrowDown": case "ArrowLeft": v = value - s * (shift ? 10 : 1); break;
        case "PageUp": v = value + span * (shift ? 0.01 : 0.1); break;
        case "PageDown": v = value - span * (shift ? 0.01 : 0.1); break;
        case "Home": v = min; break;
        case "End": v = max; break;
        default: return null;
      }
      return DialMath.quantize(v, min, max, step);
    },
    // the value after a wheel notch (deltaY below zero is up); never less than one step
    wheelValue(deltaY, shift, value, min, max, step) {
      if (!deltaY) return value;
      const s = step > 0 ? step : 1;
      const amount = Math.max(s, (max - min) * (shift ? 0.002 : 0.01));
      return DialMath.quantize(value + (deltaY < 0 ? amount : -amount), min, max, step);
    },
    // the nearest detent when one is within `reach` of the value, else the value
    snap(value, detents, reach) {
      let best = value;
      let gap = reach;
      for (const d of detents || []) {
        const g = Math.abs(d - value);
        if (g <= gap) { gap = g; best = d; }
      }
      return best;
    },
    // the first number in typed text ("1,5 kHz" is 1.5), or null
    parseNumber(text) {
      const m = /-?\d+(?:[.,]\d+)?|-?[.,]\d+/.exec(String(text).replace(/\s+/g, ""));
      if (!m) return null;
      const n = Number(m[0].replace(",", "."));
      return Number.isFinite(n) ? n : null;
    },
  };
  window.DialMath = DialMath;
  if (typeof document === "undefined") return; // a test loads the maths only

  const NS = "http://www.w3.org/2000/svg";
  const fraction = (input) => DialMath.fraction(num(input.value, num(input.min, 0)), num(input.min, 0), num(input.max, 100));
  const cfgOf = (input) => input.__dial || {};

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
    // Eleven ticks over the 270 degree sweep; the ones up to the value are drawn twice (an ink bar, an orange bar on it) so they read on paper and on ink.
    const at = (r, i) => {
      const a = ((-SWEEP / 2 + (SWEEP / 10) * i) * Math.PI) / 180;
      return [30 + r * Math.sin(a), 30 - r * Math.cos(a)];
    };
    const tick = (r1, r2, i) => {
      const a = at(r1, i);
      const b = at(r2, i);
      return `M${a[0].toFixed(1)} ${a[1].toFixed(1)}L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    };
    face.innerHTML =
      `<svg viewBox="0 0 60 60" focusable="false" shape-rendering="crispEdges">` +
      `<path class="dial-k" d=""/>` +
      `<path class="dial-kl-edge" d=""/>` +
      `<path class="dial-kl" d=""/>` +
      `<circle class="dial-disc" cx="30" cy="30" r="17"/>` +
      `<circle class="dial-def" cx="30" cy="30" r="0"/>` +
      `<g class="dial-needle"><line x1="30" y1="26" x2="30" y2="16"/></g>` +
      `<circle class="dial-dot" cx="30" cy="30" r="3"/>` +
      `</svg>`;
    wrap.appendChild(face);
    const bubble = document.createElement("span");
    bubble.className = "dial-bubble";
    bubble.setAttribute("aria-hidden", "true");
    wrap.appendChild(bubble);
    const ticks = face.querySelector(".dial-k");
    const litEdge = face.querySelector(".dial-kl-edge");
    const lit = face.querySelector(".dial-kl");
    const hand = face.querySelector(".dial-needle");
    const defMark = face.querySelector(".dial-def");

    const min = () => num(input.min, 0);
    const max = () => num(input.max, 100);
    const step = () => num(input.step, 1) || 1;
    const read = () => num(input.value, min());
    const fire = (type) => input.dispatchEvent(new Event(type, { bubbles: true }));
    // sets the value, and says so the way the browser's own slider does
    function set(v, quiet) {
      v = DialMath.quantize(v, min(), max(), step());
      if (String(v) === input.value) return false;
      input.value = String(v);
      if (!quiet) fire("input");
      return true;
    }

    function draw() {
      const f = fraction(input);
      let on = "";
      let off = "";
      for (let i = 0; i <= 10; i++) {
        if (i / 10 <= f + 1e-9) on += tick(23, 29, i);
        else off += tick(23, 29, i);
      }
      ticks.setAttribute("d", off);
      litEdge.setAttribute("d", on);
      lit.setAttribute("d", on);
      hand.setAttribute("transform", `rotate(${(-SWEEP / 2 + SWEEP * f).toFixed(2)} 30 30)`);
      wrap.classList.toggle("is-disabled", input.disabled);
      const c = cfgOf(input);
      // the dial's own setting, a dot just outside the disc
      if (c.def !== undefined && Number.isFinite(Number(c.def))) {
        const df = DialMath.fraction(Number(c.def), min(), max());
        const p = at(27.5, df * 10);
        defMark.setAttribute("cx", p[0].toFixed(1));
        defMark.setAttribute("cy", p[1].toFixed(1));
        defMark.setAttribute("r", "1.6");
      } else defMark.setAttribute("r", "0");
      if (typeof c.format === "function") {
        let text = "";
        try { text = String(c.format(read())); } catch (e) { text = ""; }
        bubble.textContent = text;
        if (text && c.aria !== false) input.setAttribute("aria-valuetext", text);
      } else bubble.textContent = "";
    }
    draw();
    input.__dialDraw = draw;
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

    // ---- back to the dial's own setting ----
    let lastReset = 0;
    function reset() {
      const c = cfgOf(input);
      if (typeof c.reset === "function") c.reset();
      else if (input.hasAttribute("data-default")) {
        if (set(num(input.getAttribute("data-default"), read()))) fire("change");
      } else return;
      lastReset = Date.now();
    }

    // ---- dragging the face ----
    let drag = null;
    let lastTap = null;
    face.addEventListener("pointerdown", (e) => {
      if (input.disabled || (e.button !== undefined && e.button > 0)) return;
      e.preventDefault();
      input.focus({ preventScroll: true });
      face.setPointerCapture(e.pointerId);
      drag = { id: e.pointerId, y: e.clientY, x: e.clientX, start: read(), moved: false, fine: false, hold: false, timer: 0, touch: e.pointerType !== "mouse", alt: e.altKey };
      wrap.classList.add("is-turning");
      if (drag.touch) {
        // pressing and holding still for a moment is the touch screen's Shift
        drag.timer = setTimeout(() => {
          if (!drag || drag.moved) return;
          drag.hold = true;
          drag.fine = true;
          drag.start = read();
          drag.y = drag.lastY !== undefined ? drag.lastY : drag.y;
          wrap.classList.add("is-fine");
          try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { /* none */ }
        }, HOLD_MS);
      }
    });
    face.addEventListener("pointermove", (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      drag.lastY = e.clientY;
      if (!drag.moved && Math.abs(e.clientY - drag.y) <= 4 && Math.abs(e.clientX - drag.x) <= 4 && !drag.hold) return; // a press is not yet a drag
      const fine = e.shiftKey || drag.hold;
      if (fine !== drag.fine) {
        // Shift pressed or let go: carry on from where the value is now, so it does not jump
        drag.fine = fine;
        drag.start = read();
        drag.y = e.clientY;
        wrap.classList.toggle("is-fine", fine);
      }
      let v = DialMath.dragValue(drag.start, drag.y - e.clientY, min(), max(), step(), drag.fine);
      const c = cfgOf(input);
      if (c.detents && c.detents.length && !e.altKey) {
        const reach = (max() - min()) * (Number.isFinite(c.detent) ? c.detent : DETENT) * (drag.fine ? 0.5 : 1);
        v = DialMath.quantize(DialMath.snap(v, c.detents, reach), min(), max(), step());
      }
      if (String(v) === input.value) return;
      drag.moved = true;
      clearTimeout(drag.timer);
      input.value = String(v);
      fire("input");
    });
    const end = (e) => {
      if (!drag || e.pointerId !== drag.id) return;
      const was = drag;
      clearTimeout(was.timer);
      drag = null;
      wrap.classList.remove("is-turning", "is-fine");
      if (was.moved) {
        fire("change");
        return;
      }
      // Alt-click (Alt held and no drag) puts it back; Alt held through a drag only turns the pull of the detents off
      if (e.type === "pointerup" && was.alt) { reset(); return; }
      // a double tap (a touch screen has no double-click on a dial) puts it back
      if (e.type === "pointerup") {
        const now = Date.now();
        if (lastTap && now - lastTap.t < 320 && Math.abs(e.clientX - lastTap.x) < 14 && Math.abs(e.clientY - lastTap.y) < 14) {
          lastTap = null;
          reset();
        } else lastTap = { t: now, x: e.clientX, y: e.clientY };
      }
    };
    face.addEventListener("pointerup", end);
    face.addEventListener("pointercancel", end);
    face.addEventListener("dblclick", () => {
      if (Date.now() - lastReset > 450) reset();
    });
    face.addEventListener("pointerenter", () => wrap.classList.add("is-near"));
    face.addEventListener("pointerleave", () => wrap.classList.remove("is-near"));

    // ---- the keyboard and the wheel on the real input ----
    let settle = 0;
    const later = () => {
      clearTimeout(settle);
      settle = setTimeout(() => fire("change"), 350); // one "change" after a burst of key presses or wheel notches
    };
    input.addEventListener("keydown", (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || input.disabled) return;
      if (e.key === "Enter") {
        e.preventDefault();
        edit();
        return;
      }
      const v = DialMath.keyValue(e.key, e.shiftKey, read(), min(), max(), step());
      if (v === null) return;
      e.preventDefault();
      if (set(v)) later();
    });
    wrap.addEventListener("wheel", (e) => {
      if (input.disabled || document.activeElement !== input) return; // the page keeps scrolling unless this dial was chosen
      e.preventDefault();
      if (set(DialMath.wheelValue(e.deltaY, e.shiftKey, read(), min(), max(), step()))) later();
    }, { passive: false });

    // ---- typing a value in its own unit ----
    function edit() {
      if (input.disabled || wrap.querySelector(".dial-type")) return;
      const c = cfgOf(input);
      const field = document.createElement("input");
      field.type = "text";
      field.className = "dial-type";
      field.setAttribute("inputmode", "decimal");
      field.setAttribute("aria-label", `${input.getAttribute("aria-label") || "Value"}: type a value, Enter to set, Escape to cancel`);
      const shown = typeof c.format === "function" ? String(c.format(read())) : String(read());
      const first = DialMath.parseNumber(shown);
      field.value = first === null ? shown : String(first);
      wrap.appendChild(field);
      field.focus();
      field.select();
      let done = false;
      const close = (apply) => {
        if (done) return;
        done = true;
        let v = null;
        if (apply) {
          const n = DialMath.parseNumber(field.value);
          if (n !== null) v = typeof c.parse === "function" ? c.parse(field.value, n) : n;
        }
        field.remove();
        input.focus({ preventScroll: true });
        if (v !== null && v !== undefined && Number.isFinite(Number(v)) && set(Number(v))) fire("change");
      };
      field.addEventListener("keydown", (e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); close(true); }
        else if (e.key === "Escape") { e.preventDefault(); close(false); }
      });
      field.addEventListener("blur", () => close(true));
    }
    input.__dialEdit = edit;
    input.__dialReset = reset;
  }

  function scan(root) {
    (root || document).querySelectorAll('.dial-scope input[type="range"], input[type="range"].dial-me').forEach(enhance);
  }
  // Tells a dial what its numbers mean (see the top of this file); may be called before or after the dial is drawn.
  function configure(input, cfg) {
    if (!input) return;
    input.__dial = Object.assign(input.__dial || {}, cfg);
    if (input.__dialDraw) input.__dialDraw();
  }
  window.Dial = { enhance, scan, configure, edit: (input) => input && input.__dialEdit && input.__dialEdit(), reset: (input) => input && input.__dialReset && input.__dialReset(), math: DialMath };
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
