// Warmth, tint, hue, vignette and the histogram: pure pixel maths for the photo editor.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/photo-color.js", import.meta.url), "utf8"), vm.createContext({ window, Math, Number, Float64Array, Uint8ClampedArray }));
const C = window.PhotoColor;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const px = (...rgba) => new Uint8ClampedArray(rgba.length === 3 ? [...rgba, 255] : rgba);
const arr = (a) => Array.from(a);

// identity
{
  const d = px(10, 120, 250);
  C.tweakPixels(d, { warmth: 0, tint: 0, hue: 0 });
  C.tweakPixels(d, {}); C.tweakPixels(d);
  ok(arr(d).join() === "10,120,250,255", "no change asked, no change made");
}
// warmth
{
  const warm = px(100, 100, 100); C.tweakPixels(warm, { warmth: 100 });
  const cool = px(100, 100, 100); C.tweakPixels(cool, { warmth: -100 });
  ok(warm[0] > 100 && warm[2] < 100 && warm[1] === 100, "positive warmth raises red, lowers blue, leaves green", arr(warm));
  ok(cool[0] < 100 && cool[2] > 100 && cool[1] === 100, "negative warmth does the opposite", arr(cool));
  ok(warm[0] - 100 === 100 - cool[0] || Math.abs(warm[0] - 100 - (100 - cool[0])) <= 1, "and the two are symmetrical", [warm[0], cool[0]]);
  const half = px(100, 100, 100); C.tweakPixels(half, { warmth: 50 });
  ok(half[0] > 100 && half[0] < warm[0], "half the slider is half the shift", [half[0], warm[0]]);
}
// tint
{
  const magenta = px(100, 100, 100); C.tweakPixels(magenta, { tint: 100 });
  const green = px(100, 100, 100); C.tweakPixels(green, { tint: -100 });
  ok(magenta[1] < 100 && magenta[0] >= 100 && magenta[2] >= 100, "positive tint pulls green down (magenta)", arr(magenta));
  ok(green[1] > 100, "negative tint pushes green up", arr(green));
}
// hue
{
  const red = px(255, 0, 0); C.tweakPixels(red, { hue: 180 });
  ok(red[0] < 20 && red[1] > 90 && red[2] > 90 && Math.abs(red[1] - red[2]) <= 1, "turning red by 180 degrees gives a cyan (the same result as the CSS hue-rotate filter)", arr(red));
  const grey = px(120, 120, 120); C.tweakPixels(grey, { hue: 90 });
  ok(grey.slice(0, 3).every((v) => Math.abs(v - 120) <= 1), "a grey stays grey whatever the hue", arr(grey));
  const a = px(140, 110, 125); C.tweakPixels(a, { hue: 60 }); C.tweakPixels(a, { hue: -60 });
  ok(Math.abs(a[0] - 140) <= 3 && Math.abs(a[1] - 110) <= 3 && Math.abs(a[2] - 125) <= 3, "turning by 60 and back lands where it started (within rounding, for colours that do not clip)", arr(a));
  const lum = (p) => 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2];
  const c = px(60, 160, 200); const before = lum(c); C.tweakPixels(c, { hue: 60 });
  ok(Math.abs(lum(c) - before) < 14, "a hue turn keeps roughly the same brightness", [before, lum(c)]);
}
// transparent pixels and clamping and junk
{
  const d = new Uint8ClampedArray([10, 20, 30, 0, 255, 255, 255, 255]);
  C.tweakPixels(d, { warmth: 100, tint: 100, hue: 90 });
  ok(arr(d).slice(0, 4).join() === "10,20,30,0", "a fully transparent pixel is left alone");
  const hot = px(255, 255, 255); C.tweakPixels(hot, { warmth: 100 });
  ok(hot.every((v) => v >= 0 && v <= 255), "values stay within 0-255");
  const odd = px(50, 60, 70); C.tweakPixels(odd, { warmth: "x", tint: NaN, hue: null });
  ok(arr(odd).join() === "50,60,70,255", "unreadable numbers count as zero");
  const big = px(100, 100, 100), capped = px(100, 100, 100); C.tweakPixels(big, { warmth: 9999 }); C.tweakPixels(capped, { warmth: 100 });
  ok(arr(big).join() === arr(capped).join(), "an out-of-range slider value is capped");
}
// vignette
{
  const w = 21, h = 21;
  const img = () => { const d = new Uint8ClampedArray(w * h * 4); for (let i = 0; i < d.length; i += 4) d.set([200, 200, 200, 255], i); return d; };
  const at = (d, x, y) => d[(y * w + x) * 4];
  const dark = img(); C.vignettePixels(dark, w, h, 80);
  ok(at(dark, 10, 10) === 200 && at(dark, 11, 10) === 200, "the centre is untouched", [at(dark, 10, 10)]);
  ok(at(dark, 0, 0) < 70 && at(dark, 20, 20) < 70 && at(dark, 0, 20) < 70, "the corners are much darker", [at(dark, 0, 0)]);
  ok(at(dark, 0, 10) > at(dark, 0, 0) && at(dark, 0, 10) < 200, "an edge midpoint is darkened less than a corner", [at(dark, 0, 10), at(dark, 0, 0)]);
  const gradient = Array.from({ length: 11 }, (_, i) => at(dark, 10 + i, 10));
  ok(gradient.every((v, i) => i === 0 || v <= gradient[i - 1]), "darkening grows steadily from the centre to the edge", gradient);
  const none = img(); C.vignettePixels(none, w, h, 0);
  ok(arr(none).join() === arr(img()).join(), "strength 0 changes nothing");
  const light = img(); C.vignettePixels(light, w, h, -80);
  ok(at(light, 0, 0) > 230 && at(light, 10, 10) === 200, "a negative strength lightens the corners instead", [at(light, 0, 0)]);
  const t = img(); t[3] = 0; C.vignettePixels(t, w, h, 100);
  ok(t[0] === 200 && t[3] === 0, "a transparent corner pixel is left alone");
  const rect = new Uint8ClampedArray(40 * 10 * 4).fill(255); C.vignettePixels(rect, 40, 10, 100);
  ok(rect[(5 * 40 + 20) * 4] === 255 && rect[0] < 255, "it works on a wide picture too", [rect[0]]);
  ok(arr(C.vignettePixels(new Uint8ClampedArray(0), 0, 0, 50)).length === 0 && !!C.vignettePixels(img(), 0, 0, 50), "an empty picture is no problem");
}
// histogram
{
  const d = new Uint8ClampedArray([0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255, 255, 128, 128, 128, 255]);
  const h = C.histogramOf(d);
  ok(h.total === 4 && h.lum[0] === 2 && h.lum[255] === 1 && h.lum[128] === 1 && h.r[0] === 2 && h.r[255] === 1, "counts per level, for each channel and for brightness", [h.total, h.lum[0], h.lum[255]]);
  const faint = C.histogramOf(new Uint8ClampedArray([255, 255, 255, 51, 0, 0, 0, 0]));
  ok(Math.abs(faint.total - 0.2) < 1e-9, "a faint pixel counts for little and a transparent one for nothing", faint.total);
  const c = C.clipping(h);
  ok(c.shadows === 50 && c.highlights === 25, "clipping: half the pixels are pure shadow, a quarter pure highlight", c);
  ok(C.clipping(C.histogramOf(new Uint8ClampedArray(0))).shadows === 0, "an empty picture has no clipping");
  ok(/mostly dark/.test(C.describeHistogram(C.histogramOf(new Uint8ClampedArray([5, 5, 5, 255, 9, 9, 9, 255])))) && /mostly bright/.test(C.describeHistogram(C.histogramOf(new Uint8ClampedArray([250, 250, 250, 255])))) && /mid-toned/.test(C.describeHistogram(C.histogramOf(new Uint8ClampedArray([120, 120, 120, 255])))), "the sentence names dark, bright and mid-toned pictures");
  ok(/50% of the picture is pure shadow and 25% pure highlight/.test(C.describeHistogram(h)) && C.describeHistogram(null) === "Nothing to measure yet.", "and the clipping figures, with a fallback for nothing");
}

// levels
{
  const lut = C.levelsLut();
  ok(arr(lut).every((v, i) => v === i), "default levels are the identity table");
  const stretch = C.levelsLut(50, 1, 200);
  ok(stretch[0] === 0 && stretch[50] === 0 && stretch[200] === 255 && stretch[255] === 255, "black point and below become 0, white point and above become 255", [stretch[50], stretch[200]]);
  ok(stretch[125] === 128 || stretch[125] === 127, "and the middle of the range stays in the middle at gamma 1", stretch[125]);
  const bright = C.levelsLut(0, 2, 255), dark = C.levelsLut(0, 0.5, 255);
  ok(bright[128] > 128 && dark[128] < 128 && bright[0] === 0 && bright[255] === 255 && dark[0] === 0 && dark[255] === 255, "gamma above 1 brightens the midtones, below 1 darkens them, the ends stay put", [bright[128], dark[128]]);
  ok(Math.abs(bright[64] - 255 * Math.pow(64 / 255, 0.5)) <= 0.5, "gamma 2 is the square root curve", bright[64]);
  let mono = true;
  for (const [b, g, w] of [[0, 1, 255], [30, 2.2, 220], [100, 0.4, 130], [254, 3, 255], [0, 9, 1]]) {
    const t = C.levelsLut(b, g, w);
    for (let i = 1; i < 256; i++) if (t[i] < t[i - 1]) mono = false;
  }
  ok(mono, "every table only ever goes up (no tone swaps order)");
  const crossed = C.levelsLut(200, 1, 100);
  ok(crossed[200] === 0 && crossed[201] === 255, "a white point at or below the black point is kept one level above it", [crossed[200], crossed[201]]);
  ok(arr(C.levelsLut("x", "y", null)).every((v, i) => v === i) || C.levelsLut("x", "y", null)[255] === 255, "nonsense inputs fall back to safe values");
  const wild = C.levelsLut(-50, -3, 999);
  ok(wild[0] === 0 && wild[255] === 255 && !arr(wild).some((v) => !Number.isInteger(v) || v < 0 || v > 255), "out-of-range inputs are pulled back into range", [wild[0], wild[255]]);
  ok(C.gammaFromSlider(0) === 1 && Math.abs(C.gammaFromSlider(100) - 4) < 1e-9 && Math.abs(C.gammaFromSlider(-100) - 0.25) < 1e-9 && C.gammaFromSlider(500) === 4 && C.gammaFromSlider("x") === 1, "the midtones slider maps 0 to 1, 100 to 4, -100 to 0.25 and clamps");

  const d = px(50, 125, 200);
  C.levelsPixels(d, { black: 50, gamma: 1, white: 200 });
  ok(d[0] === 0 && d[2] === 255 && d[3] === 255 && (d[1] === 127 || d[1] === 128), "each channel goes through the table and opacity is untouched", arr(d));
  const same = px(10, 120, 250);
  C.levelsPixels(same, {}); C.levelsPixels(same);
  ok(arr(same).join() === "10,120,250,255", "no change asked, no change made");
  const clear = px(60, 60, 60, 0);
  C.levelsPixels(clear, { black: 100 });
  ok(arr(clear).join() === "60,60,60,0", "a transparent pixel is left alone");
  const faint = px(60, 60, 60, 40);
  C.levelsPixels(faint, { black: 100 });
  ok(faint[0] === 0 && faint[3] === 40, "a faint pixel is changed but keeps its opacity", arr(faint));
  const hist = C.histogramOf(C.levelsPixels(new Uint8ClampedArray([60, 60, 60, 255, 120, 120, 120, 255, 180, 180, 180, 255]), { black: 60, white: 180 }));
  ok(hist.lum[0] === 1 && hist.lum[255] === 1, "stretching the range to the picture's own ends puts its darkest at 0 and lightest at 255", [hist.lum[0], hist.lum[255]]);
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
