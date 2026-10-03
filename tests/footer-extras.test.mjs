// The footer's feed link and Share button.
import fs from "node:fs";
import { footerHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

const plain = footerHtml("Made by me", 2026);
ok(plain.includes('<a class="footer-rss" href="/rss.xml">RSS feed</a>'), "a text footer gets the feed link");
ok(/<button type="button" class="footer-share" data-share hidden>Share this page<\/button>/.test(plain), "and a Share button that starts hidden (it only shows once nav.js knows it can work)");
ok(plain.includes('class="footer-share-note" role="status" aria-live="polite"'), "and a polite status line to say the link was copied");
ok(plain.indexOf("Made by me") < plain.indexOf("footer-extras"), "they come after the footer text");

const empty = footerHtml("", 2026);
ok(empty.includes("© 2026 Dominick") && empty.includes("footer-rss") && empty.includes("data-share"), "the minimal default footer has them too");
ok(footerHtml(null, 2026).includes("footer-rss"), "a missing footer is the same");

const laid = footerHtml({ text: "", columns: [{ title: "Site", links: [{ label: "Archive", url: "/archive" }] }], social: [{ label: "Mastodon", url: "https://example.social/@me" }] }, 2026);
ok(laid.includes("footer-columns") && laid.includes("footer-social") && laid.includes("footer-rss") && laid.indexOf("footer-social") < laid.indexOf("footer-extras"), "a laid-out footer keeps its columns and links, then the extras");

const hasFeed = footerHtml({ columns: [{ title: "Site", links: [{ label: "Feed", url: "/rss.xml" }] }] }, 2026);
ok(!hasFeed.includes('class="footer-rss"') && hasFeed.includes("data-share"), "no second feed link when the admin already added one");
const hasFeed2 = footerHtml({ social: [{ label: "RSS", url: "/rss.xml?type=article" }] }, 2026);
ok(!hasFeed2.includes('class="footer-rss"'), "even with a query on it");
const notFeed = footerHtml({ columns: [{ title: "x", links: [{ label: "Rss notes", url: "/rss-notes" }] }] }, 2026);
ok(notFeed.includes('class="footer-rss"'), "a link that only looks similar does not count");

const js = fs.readFileSync(new URL("../public/nav.js", import.meta.url), "utf8");
ok(/navigator\.share/.test(js) && /clipboard\.writeText/.test(js) && /\[data-share\]/.test(js), "nav.js wires the button to the share sheet, or the clipboard");
ok(/btn\.hidden = false/.test(js) && js.indexOf("if (!canShare && !canCopy) return;") < js.indexOf("btn.hidden = false"), "and only reveals it when one of them exists");
const css = fs.readFileSync(new URL("../public/style.css", import.meta.url), "utf8");
ok(css.includes(".footer-share[hidden]"), "the stylesheet keeps the hidden button hidden");

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
