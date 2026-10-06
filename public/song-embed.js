// Public Song block player — one AudioContext + one SongEngine player per
// embed, created lazily on first Play click (browsers block audio until a
// user gesture, so there's no point creating an AudioContext any earlier).
(function () {
  // The Play and Stop icons, the same drawings as worker/ui-icons.js (no symbol characters: a phone shows those as emoji).
  var ICON = function (d) { return '<svg class="ui-icon" viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" focusable="false">' + d + "</svg>"; };
  var ICON_PLAY = ICON('<path d="M8 5v14l11-7z" fill="currentColor"/>');
  var ICON_STOP = ICON('<rect x="6" y="6" width="12" height="12" rx="1.5" fill="currentColor"/>');
  // One shared full-page overlay, lazily created — any playing song with
  // "page_sync" on flashes it, regardless of which block's visualization
  // is active. A single overlay avoids stacking one per embed on a page
  // with multiple songs.
  //
  // Known, deliberate limitation (flagged by a critic pass on the player
  // color themes feature): this overlay is appended to document.body, a
  // sibling of any .song-embed, not a descendant -- so its CSS
  // var(--accent) always resolves the site's global accent, never a
  // themed song's per-element override (CSS custom properties only
  // inherit down the DOM tree). A themed song's beat-flash will always be
  // the global accent color even though its own bars/waveform/pulse
  // correctly follow its theme. Scoping this to each song's own theme
  // would mean either duplicating the overlay per song (defeating the
  // single-shared-overlay design this comment starts with) or having each
  // flash set an inline color read from the playing song's own theme --
  // deferred as out of scope for now, not fixed by accident.
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

  // Only one embed plays at a time: starting one stops whichever was playing.
  let stopOther = null;

  // Sets up every song player in `root` that is not set up yet; page-slide.js calls it again after it swaps a page in.
  function initSongs(root) {
  (root || document).querySelectorAll(".song-embed:not([data-song-ready])").forEach((wrap) => {
    wrap.dataset.songReady = "1";
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

    // A song with a song order of several bars counts them: "6 bars" at rest, "Bar 3 of 6" while it plays, with one small segment per bar.
    // (A one-bar song has nothing to count and gets no line.)
    let positionLabel = null;
    let positionSegments = [];
    let shownBar; // undefined until the first showBar, so the first call (null, at rest) draws
    if (window.SongEngine.positionLabel && window.SongEngine.positionLabel(songData, null)) {
      const order = Array.from({ length: window.SongEngine.songBars(songData) });
      const row = document.createElement("div");
      row.className = "song-embed-position";
      positionLabel = document.createElement("span");
      positionLabel.className = "song-embed-position-label";
      positionLabel.style.minWidth = window.SongEngine.positionLabel(songData, order.length - 1).length + "ch"; // the widest text, so the strip beside it never shifts
      const strip = document.createElement("span");
      strip.className = "song-embed-position-strip";
      strip.setAttribute("aria-hidden", "true");
      positionSegments = order.map(() => strip.appendChild(document.createElement("span")));
      row.append(positionLabel, strip);
      wrap.appendChild(row);
    }
    function showBar(index) {
      if (!positionLabel || index === shownBar) return;
      shownBar = index;
      positionLabel.textContent = window.SongEngine.positionLabel(songData, index);
      positionSegments.forEach((seg, i) => {
        seg.classList.toggle("is-now", i === index);
        seg.classList.toggle("is-done", index !== null && i < index);
      });
    }
    showBar(null);

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

    if (canvas) {
      // A cached copy computed by the admin song builder at save time
      // (see refreshCachedWaveformPeaks in public/admin/song-builder.js)
      // means every visitor doesn't have to run their own
      // OfflineAudioContext render just to draw the static preview bars
      // -- the peaks are a deterministic function of the song's own
      // content, so a value computed once at save time is exactly as
      // correct as computing it fresh on every single page load, at zero
      // ongoing cost. Falls back to a live render for any song saved
      // before this cache existed (or one whose cache computation
      // itself failed and was left absent, see refreshCachedWaveformPeaks).
      if (Array.isArray(songData.cached_peaks) && songData.cached_peaks.length) {
        peaks = songData.cached_peaks;
        drawWaveform(0);
      } else if (window.SongEngine.renderWaveformPeaks) {
        window.SongEngine.renderWaveformPeaks(songData, 200).then((p) => {
          peaks = p;
          drawWaveform(0);
        });
      }
    }

    // info (from the player) says which pattern of a song with several is sounding and where it sits in the song order: the waveform's
    // progress covers the whole song, and the pulse follows that pattern's own drums. A song with one pattern gets the same as ever.
    function onStep(step, time, info) {
      const steps = window.SongEngine.STEPS;
      if (bars.length) bars.forEach((bar, i) => bar.classList.toggle("song-embed-bar-active", i === step));
      if (canvas) drawWaveform(((info ? info.chainIndex : 0) * steps + step) / ((info ? info.chainLength : 1) * steps));
      if (info && info.chainLength > 1) showBar(info.chainIndex);
      const hitsTrack = window.SongEngine.stepHasAudibleDrumHit(info ? info.data : songData, step);
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

    // The label names the action (so it isn't also aria-pressed); the icon is a
    // drawing (worker/ui-icons.js), never a symbol character, which a phone would
    // show as an emoji. The accessible name carries the song's title, since
    // several songs can share a page.
    const songTitle = (wrap.querySelector(".song-embed-header strong") || {}).textContent || "song";
    function setPlayLabel(playing) {
      btn.classList.toggle("is-active", playing);
      btn.setAttribute("aria-label", `${playing ? "Stop" : "Play"} ${songTitle}`);
      btn.innerHTML = (playing ? ICON_STOP : ICON_PLAY) + (playing ? " Stop" : " Play");
    }

    function stopPlayback() {
      player.stop();
      bars.forEach((bar) => bar.classList.remove("song-embed-bar-active"));
      if (pulse) pulse.classList.remove("song-embed-pulse-beat", "song-embed-pulse-hit");
      if (canvas) drawWaveform(0);
      showBar(null);
      setPlayLabel(false);
      if (stopOther === stopByOther) stopOther = null;
    }
    // Stopped because another embed started: still counts as a stop for analytics.
    function stopByOther() {
      stopPlayback();
      if (window.trackEvent) window.trackEvent("song_stop");
    }

    btn.addEventListener("click", () => {
      if (!player) player = window.SongEngine.createPlayer(getCtx, songData, onStep);
      if (player.isPlaying()) {
        stopPlayback();
        if (window.trackEvent) window.trackEvent("song_stop");
      } else {
        // Start first: a song that fails to start must not silence the one playing.
        const previous = stopOther;
        player.start();
        if (previous && previous !== stopByOther) previous();
        stopOther = stopByOther;
        setPlayLabel(true);
        if (window.trackEvent) window.trackEvent("song_play");
      }
    });
  });
  }
  initSongs(document);
  window.siteInitSongs = initSongs;
  // Leaving the page in place (page-slide.js) stops whatever is playing, as a normal page change would.
  window.siteStopSongs = function () {
    if (stopOther) stopOther();
  };
})();
