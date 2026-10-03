// The sound a simulated buzzer makes. Shared by the public circuit pages and the admin builder, and only ever started by a click or
// tap on a buzzer that the circuit is driving (browsers will not start audio on their own, and nothing here tries to). One tone at a
// time: starting it again, or calling stop(), ends the one that is playing. The tone is a plain 2.4 kHz square wave through a low-pass
// filter at a low volume, about a second and a bit long.
(function () {
  const FREQUENCY = 2400;
  const LEVEL = 0.05;
  const FADE = 0.015;
  let ctx = null;
  let osc = null;
  let gain = null;
  let timer = null;

  function playing() {
    return osc !== null;
  }
  function stop() {
    if (timer) clearTimeout(timer);
    timer = null;
    if (!osc) return;
    const o = osc;
    const g = gain;
    osc = null;
    gain = null;
    try {
      // A short fade out, so stopping does not click.
      g.gain.cancelScheduledValues(ctx.currentTime);
      g.gain.setValueAtTime(g.gain.value, ctx.currentTime);
      g.gain.linearRampToValueAtTime(0, ctx.currentTime + FADE);
      o.stop(ctx.currentTime + FADE + 0.01);
    } catch (e) {
      try {
        o.stop();
      } catch (e2) {
        /* already stopped */
      }
    }
    document.dispatchEvent(new CustomEvent("sim-buzzer-stopped"));
  }
  // Returns true when a tone started.
  function play(ms) {
    try {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return false;
      stop();
      if (!ctx) ctx = new Ctx();
      if (ctx.state === "suspended") ctx.resume();
      osc = ctx.createOscillator();
      gain = ctx.createGain();
      const filter = ctx.createBiquadFilter();
      osc.type = "square";
      osc.frequency.value = FREQUENCY;
      filter.type = "lowpass";
      filter.frequency.value = 3200;
      gain.gain.setValueAtTime(0, ctx.currentTime);
      gain.gain.linearRampToValueAtTime(LEVEL, ctx.currentTime + FADE);
      osc.connect(filter);
      filter.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      const length = Math.max(200, Math.min(5000, Number(ms) || 1200));
      timer = setTimeout(stop, length);
      return true;
    } catch (e) {
      osc = null;
      gain = null;
      return false;
    }
  }
  // Starts the tone, or ends it if it is already playing. Returns true when it is playing afterwards.
  function toggle(ms) {
    if (playing()) {
      stop();
      return false;
    }
    return play(ms);
  }
  window.SimBuzzer = { play, stop, toggle, playing };
})();
