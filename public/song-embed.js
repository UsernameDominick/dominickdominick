// Public Song block player — one AudioContext + one SongEngine player per
// embed, created lazily on first Play click (browsers block audio until a
// user gesture, so there's no point creating an AudioContext any earlier).
(function () {
  document.querySelectorAll(".song-embed").forEach((wrap) => {
    let songData;
    try {
      songData = JSON.parse(wrap.dataset.song);
    } catch {
      return;
    }
    const btn = wrap.querySelector(".song-embed-play-btn");
    const bars = wrap.querySelectorAll(".song-embed-bar");
    let ctx = null;
    let player = null;

    function getCtx() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    }

    function onStep(step) {
      bars.forEach((bar, i) => bar.classList.toggle("song-embed-bar-active", i === step));
    }

    btn.addEventListener("click", () => {
      if (!player) player = window.SongEngine.createPlayer(getCtx, songData, onStep);
      if (player.isPlaying()) {
        player.stop();
        bars.forEach((bar) => bar.classList.remove("song-embed-bar-active"));
        btn.textContent = "▶ Play";
        if (window.trackEvent) window.trackEvent("song_stop");
      } else {
        player.start();
        btn.textContent = "⏹ Stop";
        if (window.trackEvent) window.trackEvent("song_play");
      }
    });
  });
})();
