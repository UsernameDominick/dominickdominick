// Counts what the page does with Web Audio, so a test can prove sound only starts on a click.
module.exports = `(() => {
  window.__audio = { contexts: 0, started: 0, stopped: 0 };
  const Real = window.AudioContext || window.webkitAudioContext;
  if (!Real) return;
  class Probe extends Real {
    constructor(...a) { super(...a); window.__audio.contexts++; }
    createOscillator() { const o = super.createOscillator(); const s = o.start.bind(o), t = o.stop.bind(o); o.start = (...a) => { window.__audio.started++; return s(...a); }; o.stop = (...a) => { window.__audio.stopped++; return t(...a); }; return o; }
  }
  window.AudioContext = Probe; window.webkitAudioContext = Probe;
})();`;
