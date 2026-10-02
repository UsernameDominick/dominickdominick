// Sizing rules for big pictures: when to shrink one and to what. Pure (numbers in, numbers out), so a node test can load it.
(function () {
  // The longest side a picture is kept at. The site never shows anything wider than about 1600px (2x that for a sharp screen), and the
  // uploader refuses files over 8 MB, which an untouched phone or camera photo often is.
  const MAX_SIDE = 3000;

  // The size to draw a picture at so its longest side is at most `max`, keeping its shape: { width, height, scaled }. A picture already
  // small enough comes back unchanged with scaled false; a very thin one keeps at least one pixel on its short side.
  function fitWithin(width, height, max = MAX_SIDE) {
    const w = Math.floor(Number(width));
    const h = Math.floor(Number(height));
    const limit = Math.max(1, Math.floor(Number(max)) || MAX_SIDE);
    if (!(w > 0) || !(h > 0)) return { width: 0, height: 0, scaled: false };
    const longest = Math.max(w, h);
    if (longest <= limit) return { width: w, height: h, scaled: false };
    const f = limit / longest;
    return { width: Math.max(1, Math.round(w * f)), height: Math.max(1, Math.round(h * f)), scaled: true };
  }

  // Which kinds of file are re-drawn at all. JPEG and PNG only: GIF and WebP can be animated (a redraw keeps one frame) and SVG has no
  // pixels to shrink.
  const SHRINKABLE_TYPES = ["image/jpeg", "image/png"];
  const canShrink = (type) => SHRINKABLE_TYPES.includes(String(type || "").toLowerCase());

  // One plain phrase for what happened, for the note under the Media Library's filters.
  function describeShrunk(list, max = MAX_SIDE) {
    const n = Array.isArray(list) ? list.length : 0;
    if (!n) return "";
    return `${n} big picture${n === 1 ? " was" : "s were"} reduced to fit ${max}px on the longest side. Untick “Shrink big photos” to keep full size.`;
  }

  window.ImageFit = { MAX_SIDE, fitWithin, canShrink, describeShrunk };
})();
