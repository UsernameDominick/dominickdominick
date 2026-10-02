// Anything that moves must respect the visitor's "reduce motion" setting. This reads the public stylesheet and fails on any
// transition, animation, smooth scroll or view transition that is not inside @media (prefers-reduced-motion: no-preference)
// (or is explicitly switched off). Declarations like `transition: none` and `animation: none` are fine anywhere.
import fs from "node:fs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

// Returns the declarations that move, each with its line number and the at-rules it sits inside.
export function findMotion(css) {
  const out = [];
  const stack = []; // { kind: "media"|"other", text }
  let i = 0, line = 1, buf = "", bufLine = 1;
  const text = css.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "));
  const inReducedGuard = () => stack.some((s) => s.kind === "media" && /prefers-reduced-motion:\s*(no-preference|reduce)/.test(s.text));
  const inKeyframes = () => stack.some((s) => /^@(-\w+-)?keyframes/.test(s.text));
  const check = (decl, at) => {
    const m = /^\s*([\w-]+)\s*:\s*([\s\S]*)$/.exec(decl);
    if (!m) return;
    const prop = m[1].toLowerCase();
    const value = m[2].trim().toLowerCase();
    // What counts as movement: an animation of anything, a transition of position or size (or of "all"), smooth scrolling. A transition
    // that only fades or recolours something (colour, border colour, opacity, shadow, background) is not motion in the sense the setting is about.
    const MOVING = /^(all|transform|translate|scale|rotate|top|left|right|bottom|inset|width|height|max-height|min-height|margin[\w-]*|padding[\w-]*|gap|flex[\w-]*|grid[\w-]*|clip-path)$/;
    const off = /^(none|0s|0ms)(\s|$)/.test(value) || value === "none";
    let moves = false;
    if (prop === "scroll-behavior") moves = value.startsWith("smooth");
    else if (/^(-\w+-)?animation$/.test(prop) || prop === "animation-name") moves = !off;
    else if (prop === "transition") moves = !off && value.split(",").some((part) => MOVING.test(part.trim().split(/\s+/)[0]));
    else if (prop === "transition-property") moves = value.split(",").some((part) => MOVING.test(part.trim()));
    if (moves && !inKeyframes() && !inReducedGuard()) out.push({ line: at, decl: decl.trim().replace(/\s+/g, " ").slice(0, 90), inside: stack.map((s) => s.text).join(" > ") });
  };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (ch === "\n") line++;
    if (ch === "{") {
      const head = buf.trim();
      stack.push({ kind: /^@media/.test(head) ? "media" : "other", text: head });
      if (/^@view-transition/.test(head) && !inReducedGuard()) out.push({ line: bufLine, decl: "@view-transition", inside: stack.slice(0, -1).map((s) => s.text).join(" > ") });
      buf = ""; bufLine = line;
    } else if (ch === "}") {
      if (buf.trim()) check(buf, bufLine);
      stack.pop();
      buf = ""; bufLine = line;
    } else if (ch === ";") {
      check(buf, bufLine);
      buf = ""; bufLine = line;
    } else {
      if (!buf.trim()) bufLine = line;
      buf += ch;
    }
  }
  return out;
}

if (process.argv[1] && process.argv[1].endsWith("reduced-motion.test.mjs")) {
  // the checker itself
  {
    const css = `
      a { transition: color 0.2s; }
      a2 { animation: wiggle 1s; }
      @media (prefers-reduced-motion: no-preference) { b { transition: opacity 0.3s; animation: spin 1s infinite; } html { scroll-behavior: smooth; } }
      @media (hover: hover) and (prefers-reduced-motion: no-preference) { c:hover { transform: scale(1.1); transition: transform .2s; } }
      d { animation: none; transition: none; }
      @keyframes spin { from { transform: rotate(0); } to { transform: rotate(1turn); animation-timing-function: ease; } }
      @media (max-width: 600px) { e { animation: pulse 1s; } }
      html { scroll-behavior: smooth; }
      @view-transition { navigation: auto; }
      f { transition-property: transform; animation-name: fade; }
      h { transition: color .2s, border-color .2s, opacity .2s, box-shadow .2s; }
      k { transition: transform .2s; }
      @media (prefers-reduced-motion: reduce) { g { transition: none; } }
    `;
    const found = findMotion(css).map((f) => f.decl.split(":")[0].trim());
    ok(found.join() === "animation,animation,scroll-behavior,@view-transition,transition-property,animation-name,transition", "the checker flags exactly the unguarded motion in a fixture", found);
  }
  const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
  const found = findMotion(css);
  ok(found.length === 0, "the public stylesheet has no transition, animation, smooth scroll or view transition outside a reduced-motion guard", found);
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
}
