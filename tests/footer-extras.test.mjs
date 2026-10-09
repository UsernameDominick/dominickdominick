// The footer: the copyright line, and the Share button.
import fs from "node:fs";
import { footerHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const f = footerHtml(2026);
ok(f.includes("© 2026 Dominick"), "the footer is the copyright line");
ok(!f.includes("footer-rss"), "with no feed link (the feed is off the cut-down site, worker/site-scope.js)");
ok(/<button type="button" class="footer-share" data-share hidden>Share this page<\/button>/.test(f), "and a Share button that starts hidden (it only shows once nav.js knows it can work)");
ok(f.includes('class="footer-share-note" role="status" aria-live="polite"'), "and a polite status line to say the link was copied");
ok(f.indexOf("© 2026") < f.indexOf("footer-extras"), "the share line comes after the copyright");
ok(footerHtml().includes("© " + new Date().getUTCFullYear()), "the year defaults to this one");

const js = fs.readFileSync(new URL("../public/nav.js", import.meta.url), "utf8");
ok(/navigator\.share/.test(js) && /clipboard\.writeText/.test(js) && /\[data-share\]/.test(js),"nav.js wires the button to the share sheet, or the clipboard");
ok(/btn\.hidden = false/.test(js) && js.indexOf("if (!canShare && !canCopy) return;") < js.indexOf("btn.hidden = false"), "and only reveals it when one of them exists");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
ok(css.includes(".footer-share[hidden]"), "the stylesheet keeps the hidden button hidden");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
