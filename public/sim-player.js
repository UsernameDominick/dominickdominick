// ---------- Schematic view ----------
// Swaps the pictorial parts for standard schematic symbols (both are drawn into the page; CSS shows one). The choice is
// remembered in this browser and applies to every circuit on the page.
(function () {
  const KEY = "sim-schematic";
  const read = () => {
    try {
      return localStorage.getItem(KEY) === "1";
    } catch (e) {
      return false;
    }
  };
  const apply = (on) => {
    document.documentElement.classList.toggle("sim-schematic-pref", on);
    document.querySelectorAll(".sim-svg").forEach((svg) => svg.classList.toggle("is-schematic", on));
    document.querySelectorAll(".sim-view-btn").forEach((b) => {
      b.setAttribute("aria-pressed", String(on));
    });
  };
  document.addEventListener("DOMContentLoaded", () => {
    if (read()) apply(true);
  });
  // A page swapped in by page-slide.js gets the same view as the rest (its clicks are handled for the whole document already).
  window.siteInitSims = () => {
    if (read()) apply(true);
  };
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".sim-view-btn");
    if (!btn) return;
    const on = btn.getAttribute("aria-pressed") !== "true";
    try {
      localStorage.setItem(KEY, on ? "1" : "0");
    } catch (err) {
      /* not remembered, still applied now */
    }
    apply(on);
    if (window.trackEvent) window.trackEvent("sim_schematic_toggle", on ? "on" : "off");
  });
})();

document.addEventListener("click", (e) => {
  const btn = e.target.closest(".sim-power-btn:not(.sim-view-btn)");
  if (!btn) return;
  const svg = document.getElementById(btn.dataset.target);
  if (!svg) return;
  const on = svg.classList.toggle("is-on");
  // The label names the action ("Power on" / "Power off"), so it isn't also
  // marked aria-pressed (that would announce the state twice); is-active only
  // drives the outlined look.
  btn.textContent = on ? "Power off" : "Power on";
  btn.classList.toggle("is-active", on);
  svg.dispatchEvent(new CustomEvent("sim-power-changed", { bubbles: true }));
  if (window.trackEvent) window.trackEvent("sim_power_toggle", on ? "on" : "off");
});

// ---------- Readings of a part ----------
// Tapping (or pressing Enter or Space on) a part names it, gives its value, and, once the circuit is powered, adds the figures the
// page was built with ("Resistor R1 — 220 Ω · 19.8 mA · 0.09 W · OK"). The text is in a live region under the buttons, so it is
// announced too. Switching the power on or off updates the part that is selected.
(function () {
  function show(part) {
    const wrap = part.closest(".sim-block-wrap");
    const out = wrap && wrap.querySelector(".sim-readout");
    const svg = part.closest(".sim-svg");
    if (!out || !svg) return;
    wrap.querySelectorAll(".sim-comp.is-selected").forEach((p) => p.classList.remove("is-selected"));
    part.classList.add("is-selected");
    const name = part.dataset.readoutName || "Part";
    const value = part.dataset.readout || "";
    const live = part.dataset.readoutLive || "";
    const on = svg.classList.contains("is-on");
    let text = value ? name + " — " + value : name;
    if (live) text += on ? " · " + live : ". Power on to see its live readings.";
    out.textContent = text;
  }
  document.addEventListener("click", (e) => {
    const part = e.target.closest && e.target.closest(".sim-comp[data-readout-name]");
    if (!part) return;
    show(part);
    if (window.trackEvent) window.trackEvent("sim_part_readout", part.dataset.readoutName);
  });
  // The "About this circuit" list: each part is a button that selects it in the drawing and shows its readings.
  document.addEventListener("click", (e) => {
    const btn = e.target.closest && e.target.closest(".sim-about-part");
    if (!btn) return;
    const svg = document.getElementById(btn.dataset.target);
    let part = null;
    try {
      part = svg && svg.querySelector('.sim-comp[data-id="' + CSS.escape(btn.dataset.part) + '"]');
    } catch (err) {
      return;
    }
    if (part && part.dataset.readoutName) show(part);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const part = e.target.closest && e.target.closest(".sim-comp[data-readout-name]");
    if (!part || e.target !== part) return;
    e.preventDefault();
    show(part);
  });
  document.addEventListener("sim-power-changed", (e) => {
    const wrap = e.target.closest && e.target.closest(".sim-block-wrap");
    const selected = wrap && wrap.querySelector(".sim-comp.is-selected");
    if (selected) show(selected);
  });
})();

// ---------- Buzzers ----------
// A buzzer that the powered circuit is driving (data-sounding="true", set when the page was built) makes its sound when it is clicked,
// tapped, or given Enter or Space, and a second press stops it. Nothing ever plays on its own, and switching the power off ends it.
(function () {
  function drivenNow(part) {
    const svg = part.closest(".sim-svg");
    return part.dataset.sounding === "true" && !!svg && svg.classList.contains("is-on");
  }
  function press(part) {
    if (!window.SimBuzzer) return;
    if (!drivenNow(part)) {
      window.SimBuzzer.stop();
      return;
    }
    const on = window.SimBuzzer.toggle(1200);
    if (on && window.trackEvent) window.trackEvent("sim_buzzer_play");
  }
  document.addEventListener("click", (e) => {
    const part = e.target.closest && e.target.closest(".sim-comp-buzzer");
    if (part) press(part);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    const part = e.target.closest && e.target.closest(".sim-comp-buzzer");
    if (part && e.target === part) press(part);
  });
  document.addEventListener("sim-power-changed", () => {
    if (window.SimBuzzer) window.SimBuzzer.stop();
  });
})();

// ---------- Deep links to a specific component ----------
// A URL hash of #sim-<blockId>-comp-<componentId> scrolls to and briefly
// highlights that exact part -- both ids already exist and are already
// rendered into the page (the embed's <svg id="sim-<blockId>"> from
// renderSimulationBlockHtml, and each part's own data-id from
// renderComponentSvg), so this needed no new server-side plumbing, just
// a client-side reader for a hash format nothing on the public site
// previously used. Runs on load AND on hashchange so a link clicked
// while already on the page (e.g. from an in-page index) works too, not
// just a fresh page load.
(function () {
  function highlightFromHash() {
    const m = location.hash.match(/^#sim-(\d+)-comp-(.+)$/);
    if (!m) return;
    const svg = document.getElementById(`sim-${m[1]}`);
    if (!svg) return;
    let target;
    try {
      target = svg.querySelector(`.sim-comp[data-id="${CSS.escape(m[2])}"]`);
    } catch (err) {
      return; // an invalid/malformed hash fragment -- nothing to do
    }
    if (!target) return;
    const reduceMotion =
      (window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches) ||
      document.documentElement.dataset.motion === "reduce";
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
    // Re-triggerable: removing the class before re-adding it (rather than
    // just adding it once) means clicking the SAME deep link a second
    // time -- e.g. from a "jump back to X" button -- replays the
    // highlight pulse instead of silently doing nothing because the
    // class was already present from a previous visit to this hash.
    target.classList.remove("sim-deep-link-highlight");
    void target.offsetWidth; // force a reflow so the re-added class re-triggers the CSS animation
    target.classList.add("sim-deep-link-highlight");
    // A fixed timeout (matching the CSS animation's own 1.8s x2 = 3.6s
    // total duration, see style.css) rather than an "animationend"
    // listener -- the class has NO animation at all under reduced
    // motion, so "animationend" would simply never fire there and leave
    // the class (harmlessly, but sloppily) stuck on the element forever.
    // A timeout cleans it up the same way regardless of whether the
    // animation actually played.
    setTimeout(() => target.classList.remove("sim-deep-link-highlight"), 3600);
  }
  document.addEventListener("DOMContentLoaded", highlightFromHash);
  window.addEventListener("hashchange", highlightFromHash);
})();
