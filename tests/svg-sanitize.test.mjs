// Uploaded SVG cleaning (sanitizeSvg in worker/admin-api.js) and the policy SVGs are served under (worker/index.js).
import { sanitizeSvg } from "../worker/admin-api.js";
import { SVG_CSP, isSvgContentType } from "../worker/svg.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const danger = (s) => /<\s*script\b|<\s*foreignObject\b|<\s*iframe\b|<\s*object\b|<\s*embed\b|[\s\/]on\w+\s*=|javascript\s*:/i.test(s);

const cases = [
  ["a plain script", '<svg><script>alert(1)</script><rect/></svg>'],
  ["a script with attributes", '<svg><script type="text/javascript" href="x.js"/></svg>'],
  ["a tag split around another (nested)", "<svg><scr<script></script>ipt>alert(1)</scr<script></script>ipt></svg>"],
  ["two levels of nesting", "<svg><scr<scr<script></script>ipt></script>ipt>alert(1)</svg>"],
  ["an onload attribute", '<svg onload="alert(1)"><rect/></svg>'],
  ["an unquoted handler", "<svg onload=alert(1) ><rect/></svg>"],
  ["a handler after a slash", "<svg/onload=alert(1)><rect/></svg>"],
  ["a handler with single quotes", "<rect onclick='alert(1)' width='5'/>"],
  ["uppercase handlers", '<rect ONCLICK="alert(1)"/>'],
  ["a javascript: link", '<a href="javascript:alert(1)"><rect/></a>'],
  ["an xlink javascript: link", "<a xlink:href='  javascript:alert(1)'><rect/></a>"],
  ["a data:text/html link", '<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>'],
  ["foreignObject with HTML", "<svg><foreignObject><body onload=alert(1)></body></foreignObject></svg>"],
  ["an iframe", '<svg><iframe src="https://example.com"></iframe></svg>'],
  ["an object and an embed", '<svg><object data="x"></object><embed src="y"></svg>'],
  ["a self-closing foreignObject", "<svg><foreignObject width='1'/></svg>"],
];
for (const [name, input] of cases) {
  const out = sanitizeSvg(input);
  ok(!danger(out), `strips ${name}`, out.slice(0, 80));
}
const fine = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>.a{fill:red}</style><rect class="a" width="5" height="5"/><a href="https://example.com/x"><circle r="2"/></a><text>onclick is just a word</text></svg>';
ok(sanitizeSvg(fine) === fine, "a normal SVG (style, a link to https, text mentioning a handler) comes back byte for byte");
ok(sanitizeSvg("") === "" && typeof sanitizeSvg("<svg/>") === "string", "empty and tiny inputs are fine");
const huge = "<svg>" + "<g>".repeat(5000) + "<script>1</script>" + "</g>".repeat(5000) + "</svg>";
ok(!danger(sanitizeSvg(huge)), "a large nested file is cleaned too");
const t0 = Date.now(); sanitizeSvg("<svg " + "on=".repeat(20000) + "></svg>"); ok(Date.now() - t0 < 1500, "hostile repetition does not make the cleaner hang", Date.now() - t0);

// the serving policy
ok(SVG_CSP === "default-src 'none'; style-src 'unsafe-inline'; sandbox", "SVGs are served under: nothing allowed except inline styles, and sandboxed", SVG_CSP);
ok(!/script-src/.test(SVG_CSP) && /sandbox/.test(SVG_CSP) && /default-src 'none'/.test(SVG_CSP), "so no scripts, no loading anything, and no origin of its own");
for (const t of ["image/svg+xml", "image/svg+xml; charset=utf-8", "IMAGE/SVG+XML", "image/svg", " image/svg+xml "]) ok(isSvgContentType(t), `${JSON.stringify(t)} counts as SVG`);
for (const t of ["image/png", "image/jpeg", "text/html", "application/xml", "", null, undefined, "image/svgz", "text/svg+xml"]) ok(!isSvgContentType(t), `${JSON.stringify(t)} does not`);

console.log(fail ? `\n${fail} FAILED` : "\nALL PASS");
process.exit(fail ? 1 : 0);
