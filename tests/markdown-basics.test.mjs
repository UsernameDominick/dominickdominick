// The writing basics in article and project bodies: `inline code`, --- dividers, and which links open a new tab.
import { paragraphsHtml } from "../worker/render.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const html = (md) => paragraphsHtml(md);

// inline code
ok(html("Use `npm install` first.").includes("Use <code>npm install</code> first."), "`backticks` become inline code");
ok(html("Both `a` and `b` here").includes("<code>a</code> and <code>b</code>"), "several spans in one line");
ok(html("Keep `**not bold**` and `[x](y)` literal").includes("<code>**not bold**</code>") && html("Keep `**not bold**` and `[x](y)` literal").includes("<code>[x](y)</code>"), "stars and links inside a code span stay literal");
ok(html("A `<img src=x onerror=alert(1)>` span").includes("<code>&lt;img src=x onerror=alert(1)&gt;</code>") && !html("A `<img src=x onerror=alert(1)>` span").includes("<img"), "HTML inside a code span is escaped");
ok(!html("a ` b").includes("<code>") && !html("one `two\nthree` four").includes("<code>"), "a lone backtick, or a span across lines, is left alone");
ok(html("**bold `code` bold**").includes("<strong>bold <code>code</code> bold</strong>"), "code inside bold works");
ok(html("```js\nconst a = `x`;\n```").includes('<pre><code class="language-js">') && !html("```js\nconst a = `x`;\n```").includes("<code>x</code>"), "fenced blocks are unchanged and not re-processed");
ok(html("## Using `fetch`").includes("<code>fetch</code>"), "headings can hold code");
ok(html("- first `a`\n- second").includes("<li>first <code>a</code></li>"), "list items can hold code");

// dividers
ok(html("Above\n\n---\n\nBelow").includes("<hr>"), "a --- paragraph is a divider");
ok(html("***").includes("<hr>") && html("___").includes("<hr>") && html("-----").includes("<hr>"), "*** ___ and longer dashes too");
ok(!html("a --- b").includes("<hr>") && !html("--").includes("<hr>"), "dashes inside text, or only two, are not dividers");
ok(!html("| a | b |\n| --- | --- |\n| 1 | 2 |").includes("<hr>"), "a table's separator row is not a divider");

// links
const internal = html("See [the sim](/simulation/148) and [projects](/projects).");
ok(internal.includes('<a href="/simulation/148">the sim</a>') && internal.includes('<a href="/projects">projects</a>') && !internal.includes("target="), "links to this site stay in the same tab");
const external = html("Visit [GitHub](https://github.com/x).");
ok(external.includes('<a href="https://github.com/x" target="_blank" rel="noopener">GitHub<span class="sr-only"> (opens in a new tab)</span></a>'), "links to other sites open a new tab and say so");
ok(html("[mail](mailto:a@b.co) [phone](tel:+15551234) [top](#top)").split("target=").length === 1, "mailto, tel and in-page links stay put");
ok(!/javascript:/i.test(html("[x](javascript:alert(1))")) && !html("[x](javascript:alert(1))").includes("target="), "a javascript: link is neutralised");
ok(html("Footnote[^1]\n\n[^1]: see [docs](https://example.com)").includes("opens in a new tab"), "links inside footnotes follow the same rule");
console.log(fail ? "FAILURES " + fail : "ALL PASS");
