// Colour and tone maths for the photo editor: warmth, tint, hue, vignette, levels and the histogram. Pure (typed arrays in, typed arrays out),
// so a node test can load it. Every function works on RGBA bytes (a Uint8ClampedArray from getImageData) and leaves fully
// transparent pixels alone.
(function () {
  const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

  // The standard hue-rotation matrix (as in the CSS hue-rotate() filter), for an angle in degrees.
  function hueMatrix(deg) {
    const a = (deg * Math.PI) / 180;
    const c = Math.cos(a), s = Math.sin(a);
    return [
      0.213 + c * 0.787 - s * 0.213, 0.715 - c * 0.715 - s * 0.715, 0.072 - c * 0.072 + s * 0.928,
      0.213 - c * 0.213 + s * 0.143, 0.715 + c * 0.285 + s * 0.140, 0.072 - c * 0.072 - s * 0.283,
      0.213 - c * 0.213 - s * 0.787, 0.715 - c * 0.715 + s * 0.715, 0.072 + c * 0.928 + s * 0.072,
    ];
  }

  // warmth and tint are -100..100 (positive warmth = warmer/oranger, positive tint = more magenta, negative = greener); hue is -180..180
  // degrees. Warmth moves red up and blue down, tint moves green down (with a touch of red and blue up) -- the usual white-balance
  // sliders, not a calibrated colour temperature.
  function tweakPixels(d, { warmth = 0, tint = 0, hue = 0 } = {}) {
    const k = Math.max(-100, Math.min(100, Number(warmth) || 0)) / 100;
    const t = Math.max(-100, Math.min(100, Number(tint) || 0)) / 100;
    const h = Math.max(-180, Math.min(180, Number(hue) || 0));
    if (!k && !t && !h) return d;
    const m = h ? hueMatrix(h) : null;
    const gr = 1 + 0.18 * k + 0.06 * t, gg = 1 - 0.18 * t, gb = 1 - 0.18 * k + 0.06 * t;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let r = d[i] * gr, g = d[i + 1] * gg, b = d[i + 2] * gb;
      if (m) {
        const nr = m[0] * r + m[1] * g + m[2] * b;
        const ng = m[3] * r + m[4] * g + m[5] * b;
        const nb = m[6] * r + m[7] * g + m[8] * b;
        r = nr; g = ng; b = nb;
      }
      d[i] = clamp(Math.round(r));
      d[i + 1] = clamp(Math.round(g));
      d[i + 2] = clamp(Math.round(b));
    }
    return d;
  }

  const smooth = (a, b, x) => {
    const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
    return t * t * (3 - 2 * t);
  };

  // Darken (strength 1..100) or lighten (-1..-100) toward the corners: nothing within the inner 45% of the way out to the corner, then a
  // smooth fall-off. Distance is measured to the image's corner so the effect follows its shape.
  function vignettePixels(d, width, height, strength) {
    const s = Math.max(-100, Math.min(100, Number(strength) || 0)) / 100;
    if (!s || !width || !height) return d;
    const cx = (width - 1) / 2, cy = (height - 1) / 2;
    const maxD = Math.hypot(cx, cy) || 1;
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4;
        if (d[i + 3] === 0) continue;
        const f = smooth(0.45, 1, Math.hypot(x - cx, y - cy) / maxD) * Math.abs(s) * 0.9;
        if (s > 0) {
          d[i] = d[i] * (1 - f);
          d[i + 1] = d[i + 1] * (1 - f);
          d[i + 2] = d[i + 2] * (1 - f);
        } else {
          d[i] = d[i] + (255 - d[i]) * f;
          d[i + 1] = d[i + 1] + (255 - d[i + 1]) * f;
          d[i + 2] = d[i + 2] + (255 - d[i + 2]) * f;
        }
      }
    }
    return d;
  }

  // Levels: the black point (0..254) becomes pure black, the white point (1..255) pure white, and gamma bends everything between (above 1
  // brightens the midtones, below 1 darkens them; 1 leaves them straight). Returns the 256-entry lookup table. Out-of-range or odd inputs
  // are pulled back into range, and the white point always stays above the black point.
  function levelsLut(black = 0, gamma = 1, white = 255) {
    let b = Math.round(Number(black));
    b = Number.isFinite(b) ? Math.max(0, Math.min(254, b)) : 0;
    let w = Math.round(Number(white));
    w = Number.isFinite(w) ? Math.max(1, Math.min(255, w)) : 255;
    if (w <= b) w = b + 1;
    let g = Number(gamma);
    g = Number.isFinite(g) && g > 0 ? Math.max(0.1, Math.min(10, g)) : 1;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
      const t = Math.max(0, Math.min(1, (i - b) / (w - b)));
      lut[i] = Math.round(255 * Math.pow(t, 1 / g));
    }
    return lut;
  }

  // The Midtones slider (-100..100) as a gamma: 0 is 1.00 (straight), 100 is 4 (much brighter), -100 is 0.25 (much darker).
  function gammaFromSlider(v) {
    const n = Math.max(-100, Math.min(100, Number(v) || 0));
    return Math.pow(2, n / 50);
  }

  // Applies the same lookup to red, green and blue (so colours keep their balance), leaving transparent pixels alone.
  function levelsPixels(d, { black = 0, gamma = 1, white = 255 } = {}) {
    const lut = levelsLut(black, gamma, white);
    let identity = true;
    for (let i = 0; i < 256; i++) if (lut[i] !== i) { identity = false; break; }
    if (identity) return d;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      d[i] = lut[d[i]];
      d[i + 1] = lut[d[i + 1]];
      d[i + 2] = lut[d[i + 2]];
    }
    return d;
  }

  // Counts of each brightness level 0..255 for red, green, blue and overall brightness, weighted by opacity (faint antialiased rims count
  // for little), plus the weighted pixel total.
  function histogramOf(d) {
    const r = new Float64Array(256), g = new Float64Array(256), b = new Float64Array(256), lum = new Float64Array(256);
    let total = 0;
    for (let i = 0; i < d.length; i += 4) {
      const w = d[i + 3] / 255;
      if (!w) continue;
      r[d[i]] += w;
      g[d[i + 1]] += w;
      b[d[i + 2]] += w;
      lum[Math.round(0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2])] += w;
      total += w;
    }
    return { r, g, b, lum, total };
  }

  // How much of the picture sits at the extremes: the share of pixels at brightness 0-2 ("shadows") and 253-255 ("highlights"), in percent.
  function clipping(hist) {
    if (!hist || !hist.total) return { shadows: 0, highlights: 0 };
    const sum = (from, to) => { let n = 0; for (let i = from; i <= to; i++) n += hist.lum[i]; return n; };
    return { shadows: (sum(0, 2) / hist.total) * 100, highlights: (sum(253, 255) / hist.total) * 100 };
  }

  // One plain sentence about the tones, for the histogram's text alternative.
  function describeHistogram(hist) {
    if (!hist || !hist.total) return "Nothing to measure yet.";
    let mean = 0;
    for (let i = 0; i < 256; i++) mean += i * hist.lum[i];
    mean /= hist.total;
    const tone = mean < 85 ? "mostly dark" : mean > 170 ? "mostly bright" : "mid-toned";
    const c = clipping(hist);
    const fmt = (v) => (v < 0.05 ? "0" : v < 10 ? v.toFixed(1) : String(Math.round(v)));
    return `${tone}; ${fmt(c.shadows)}% of the picture is pure shadow and ${fmt(c.highlights)}% pure highlight.`;
  }

  window.PhotoColor = { tweakPixels, vignettePixels, levelsLut, levelsPixels, gammaFromSlider, histogramOf, clipping, describeHistogram, hueMatrix };
})();
