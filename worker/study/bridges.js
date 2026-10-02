// STUDY (temporary): small scripts added to a study page when it is sent, so the popup can keep a reader's progress.
// A study page (a sandboxed frame that cannot reach this site's storage) tells the popup its progress as it changes and is given it
// back the next time it opens. Each study page needs its own bridge because each keeps its progress in its own way.
// Messages: the page sends {study:"ready"}, {study:"save", state}, {study:"corrupt"}; the popup sends {study:"restore", state},
// {study:"flush"}, {study:"zoom", value}.

// A bridge is plain browser code in a string. It must not contain a closing script tag.
const CORE1_LAB_BRIDGE = `
(function () {
  if (window.parent === window || typeof state === "undefined" || typeof render !== "function") return;
  var SKIP = { timerEnd: 1, labDrag: 1 };
  function skip(k) { return SKIP[k] === 1 || /Handle$/.test(k); }
  var timer = null;
  function snapshot() {
    try { if (state.labClockHandle && typeof labSyncElapsed === "function") labSyncElapsed(); } catch (e) {}
    var out = {};
    Object.keys(state).forEach(function (k) { if (!skip(k) && typeof state[k] !== "function") out[k] = state[k]; });
    return JSON.parse(JSON.stringify(out));
  }
  function save() {
    timer = null;
    try {
      var snap = snapshot();
      if (JSON.stringify(snap).length > 1500000) return;
      parent.postMessage({ study: "save", state: snap }, "*");
    } catch (e) {}
  }
  function later() { if (timer) clearTimeout(timer); timer = setTimeout(save, 400); }
  var original = render;
  render = function () { var r = original.apply(this, arguments); later(); return r; };

  function restore(saved) {
    if (!saved || typeof saved !== "object" || Array.isArray(saved)) return;
    Object.keys(saved).forEach(function (k) {
      if (!Object.prototype.hasOwnProperty.call(state, k) || skip(k)) return;
      var cur = state[k], val = saved[k];
      if (cur !== null && val !== null && (typeof cur !== typeof val || Array.isArray(cur) !== Array.isArray(val))) return;
      state[k] = val;
    });
    // A run with lives and a clock is not something to resume; a quiz is (with its clock where it stopped).
    if (state.screen === "game") state.screen = "home";
    if (state.screen === "quiz" && !canResume()) state.screen = "home";
    if (state.screen === "lab-board" && !labCurBoard()) state.screen = "lab";
    if (state.screen === "lab-quiz" && !labQuizDef(state.lqId)) state.screen = "lab";
    if (state.screen === "quiz" && state.timedMode && state.timeRemaining > 0) resumeTimer();
    if (state.screen === "lab-board" && !state.labDone) {
      state.labStartMs = Date.now() - (state.labElapsed || 0) * 1000;
      state.labClockHandle = setInterval(labTick, 1000);
    }
    render();
  }

  window.addEventListener("message", function (e) {
    if (e.source !== parent) return;
    var d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.study === "restore") {
      try { restore(d.state); } catch (err) { parent.postMessage({ study: "corrupt" }, "*"); }
    } else if (d.study === "flush") {
      save();
    } else if (d.study === "zoom") {
      var z = Number(d.value);
      if (z >= 0.5 && z <= 3) document.documentElement.style.zoom = String(z);
    }
  });
  window.addEventListener("pagehide", save);
  document.addEventListener("visibilitychange", function () { if (document.hidden) save(); });
  parent.postMessage({ study: "ready" }, "*");
})();
`;

export const LAB_BRIDGES = { "core1-lab": CORE1_LAB_BRIDGE };

// The study page with its bridge (if it has one) just before the end of the body.
export function withBridge(html, lab) {
  const bridge = LAB_BRIDGES[lab];
  const text = String(html == null ? "" : html);
  if (!bridge) return text;
  const tag = `<script>${bridge}</script>`;
  const at = text.lastIndexOf("</body>");
  return at < 0 ? text + tag : text.slice(0, at) + tag + text.slice(at);
}
