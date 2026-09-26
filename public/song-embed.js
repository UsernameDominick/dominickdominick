// Public Song block player — one AudioContext + one SongEngine player per
// embed, created lazily on first Play click (browsers block audio until a
// user gesture, so there's no point creating an AudioContext any earlier).
(function () {
  // One shared full-page overlay, lazily created — any playing song with
  // "page_sync" on flashes it, regardless of which block's visualization
  // is active. A single overlay avoids stacking one per embed on a page
  // with multiple songs.
  let pageSyncOverlay = null;
  function getPageSyncOverlay() {
    if (!pageSyncOverlay) {
      pageSyncOverlay = document.createElement("div");
      pageSyncOverlay.id = "song-page-sync-overlay";
      document.body.appendChild(pageSyncOverlay);
    }
    return pageSyncOverlay;
  }
  function flashPageSync() {
    const overlay = getPageSyncOverlay();
    overlay.classList.remove("song-page-sync-hit");
    void overlay.offsetWidth;
    overlay.classList.add("song-page-sync-hit");
  }

  document.querySelectorAll(".song-embed").forEach((wrap) => {
    let songData;
    try {
      songData = JSON.parse(wrap.dataset.song);
    } catch {
      return;
    }
    const btn = wrap.querySelector(".song-embed-play-btn");
    const bars = wrap.querySelectorAll(".song-embed-bar");
    const canvas = wrap.querySelector(".song-embed-waveform");
    const pulse = wrap.querySelector(".song-embed-pulse");
    let ctx = null;
    let player = null;
    let peaks = null;

    function getCtx() {
      if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
      return ctx;
    }

    // Waveform is rendered once from the actual synthesized audio (via an
    // OfflineAudioContext) and cached — re-rendering every frame would be
    // wasteful and the loop's audio content never changes at runtime here.
    function drawWaveform(progress) {
      if (!canvas || !peaks) return;
      const c2d = canvas.getContext("2d");
      const w = canvas.width;
      const h = canvas.height;
      const mid = h / 2;
      c2d.clearRect(0, 0, w, h);
      const barW = w / peaks.length;
      // Reads --accent off this specific embed's own element, not the page
      // root -- a per-song theme class (song-theme-*) overrides --accent
      // scoped to just this .song-embed, so the canvas-drawn waveform has
      // to resolve the cascade from the same element the CSS-only bars/
      // pulse visualizations already inherit it from, not the document
      // root, or a themed song's waveform would silently ignore its own
      // theme while the other two visualization modes honored it.
      const accent = getComputedStyle(wrap).getPropertyValue("--accent").trim() || "#ff7a45";
      peaks.forEach((p, i) => {
        const x = i * barW;
        const played = i / peaks.length <= progress;
        c2d.fillStyle = played ? accent : "rgba(255,255,255,0.25)";
        const yTop = mid + p[1] * mid;
        const yBot = mid + p[0] * mid;
        c2d.fillRect(x, yTop, Math.max(1, barW - 1), Math.max(1, yBot - yTop));
      });
    }

    if (canvas && window.SongEngine.renderWaveformPeaks) {
      window.SongEngine.renderWaveformPeaks(songData, 200).then((p) => {
        peaks = p;
        drawWaveform(0);
      });
    }

    function onStep(step) {
      if (bars.length) bars.forEach((bar, i) => bar.classList.toggle("song-embed-bar-active", i === step));
      if (canvas) drawWaveform(step / window.SongEngine.STEPS);
      const hitsTrack = songData.tracks && Object.keys(songData.tracks).some((t) => songData.tracks[t][step]);
      if (pulse) {
        pulse.classList.toggle("song-embed-pulse-beat", hitsTrack);
        if (hitsTrack) {
          pulse.classList.remove("song-embed-pulse-hit");
          void pulse.offsetWidth; // restart the CSS animation
          pulse.classList.add("song-embed-pulse-hit");
        }
      }
      if (songData.page_sync && hitsTrack) flashPageSync();
    }

    btn.addEventListener("click", () => {
      if (!player) player = window.SongEngine.createPlayer(getCtx, songData, onStep);
      if (player.isPlaying()) {
        player.stop();
        bars.forEach((bar) => bar.classList.remove("song-embed-bar-active"));
        if (pulse) pulse.classList.remove("song-embed-pulse-beat", "song-embed-pulse-hit");
        if (canvas) drawWaveform(0);
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
