// Drum pattern helpers for the song builder: Euclidean rhythms and starter beats. Pure (no DOM), so a node test can load it.
(function () {
  // Spread `hits` hits as evenly as possible over `steps` steps (the "Euclidean" rhythm: 3 in 8 is x..x..x.), then turn it `rotate`
  // steps later. Returns an array of booleans.
  function euclideanRow(hits, steps, rotate) {
    const n = Math.max(1, Math.floor(Number(steps)) || 16);
    const k = Math.max(0, Math.min(n, Math.floor(Number(hits)) || 0));
    const r = Math.floor(Number(rotate)) || 0;
    const row = Array.from({ length: n }, (_, i) => (i * k) % n < k);
    return row.map((_, i) => row[(((i - r) % n) + n) % n]);
  }

  // Starter beats over 16 steps: "x" is a hit, "." a rest. Rows a beat doesn't list are left empty.
  const STARTERS = [
    { id: "four-floor", label: "Four on the floor", rows: { kick: "x...x...x...x...", clap: "....x.......x...", hihat: "..x...x...x...x." } },
    { id: "rock", label: "Rock backbeat", rows: { kick: "x.......x.x.....", snare: "....x.......x...", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "boom-bap", label: "Hip-hop boom bap", rows: { kick: "x.....x...x.....", snare: "....x.......x...", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "half-time", label: "Half-time", rows: { kick: "x.........x.....", snare: "........x.......", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "trap", label: "Trap", rows: { kick: "x.....x...x.....", snare: "........x.......", clap: "........x.......", hihat: "xxxxxxxxxxxxxxxx" } },
    { id: "dembow", label: "Reggaeton dembow", rows: { kick: "x...x...x...x...", snare: "...x..x....x..x.", hihat: "x.x.x.x.x.x.x.x." } },
    { id: "breakbeat", label: "Breakbeat", rows: { kick: "x.x.......x.x...", snare: "....x..x.x..x...", hihat: "x.x.x.x.x.x.x.x." } },
  ];

  // One row of a starter beat as booleans (all false for a row the beat doesn't list or an unknown beat), resized to `steps`.
  function starterRow(id, track, steps) {
    const beat = STARTERS.find((b) => b.id === id);
    const text = (beat && beat.rows[track]) || "";
    const n = Math.max(1, Math.floor(Number(steps)) || 16);
    return Array.from({ length: n }, (_, i) => text[i % 16] === "x" && i < 16);
  }

  window.SongPatterns = { euclideanRow, STARTERS, starterRow };
})();
