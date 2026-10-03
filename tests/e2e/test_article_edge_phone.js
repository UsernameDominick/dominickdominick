// An article full of awkward content (a very wide code line, a wide table, an unbroken address, a huge word, a long heading) must not
// make the page scroll sideways on a phone, and the wide parts must scroll inside their own box instead.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
(async () => {
  const b = await chromium.launch();
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const admin = await b.newContext({ storageState: process.env.ADMIN_STATE });
  const api = async (m, p, body) => { const r = await admin.request.fetch(E2E_BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: body === undefined ? undefined : JSON.stringify(body) }); let j = null; try { j = await r.json(); } catch (e) { /* no body */ } return { s: r.status(), j }; };
  const long = "x".repeat(140);
  const body = [
    "Intro paragraph for the QQ edge-case article, long enough to publish without any trouble at all.",
    "## A heading that is long enough to wrap onto several lines on a very narrow phone screen without breaking the layout",
    "```js\nconst veryLongLine = \"" + long + "\"; // " + long + "\n```",
    "| Column one | Column two | Column three | Column four | Column five | Column six |\n|---|---|---|---|---|---|\n| " + Array(6).fill("a fairly wordy table cell").join(" | ") + " |",
    "An unbroken address: https://example.com/" + "segment/".repeat(25) + "end and a huge word " + "w".repeat(120) + ".",
    "Inline `" + "code".repeat(40) + "` in a sentence.",
    "- a list item with https://example.com/" + "list-segment/".repeat(20) + "\n- another item",
    "> a quote with " + "q".repeat(100) + " inside it",
    "## " + "Unbroken".repeat(14),
  ].join("\n\n");
  const longTitle = "QQ" + "Wide".repeat(25) + " title";
  const longTag = "qq" + "tag".repeat(25);
  const made = await api("POST", "/articles", { title: longTitle, slug: "qq-edge-phone", body, tags: [longTag], published: true });
  const madeProject = await api("POST", "/projects", { title: longTitle, slug: "qq-edge-phone", summary: "Short QQ summary " + "s".repeat(90), body, tags: [longTag], published: true });
  ok(made.s < 300 && madeProject.s < 300, "the synthetic article and project are created", [made.s, madeProject.s]);
  try {
    const pages = ["/random/qq-edge-phone", "/projects/qq-edge-phone", "/", "/random", "/projects", "/archive", "/topics", "/topics/" + longTag, "/search?q=" + "z".repeat(150)];
    for (const [w, path] of pages.flatMap((x) => [[320, x], [390, x]])) {
      const c = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true });
      const p = await c.newPage();
      await p.goto(E2E_BASE + path, { waitUntil: "networkidle" });
      const m = await p.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const wide = [...document.querySelectorAll("main *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !e.closest("pre,table,.table-wrap,.code-block,[class*=scroll]"); }).map((e) => e.tagName + "." + String(e.className).split(" ")[0] + " " + Math.round(e.getBoundingClientRect().right));
        const scrollers = [...document.querySelectorAll("pre, table, .table-wrap")].map((e) => { const box = e.tagName === "TABLE" ? (e.closest(".table-wrap") || e.parentElement) : e; const cs = getComputedStyle(box); return { tag: e.tagName, scrolls: /auto|scroll/.test(cs.overflowX), fits: box.getBoundingClientRect().right <= vw + 1 }; });
        // anything that is not clipped by an ancestor and still reaches past the edge is what widens the page
        const clipped = (e) => { for (let a = e.parentElement; a && a !== document.documentElement; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (ox !== "visible") return true; } return false; };
        const leak = [...document.querySelectorAll("body *")].filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.right > vw + 1 && !clipped(e) && getComputedStyle(e).position !== "fixed"; }).map((e) => e.tagName + "." + String(e.className).split(" ")[0] + " right=" + Math.round(e.getBoundingClientRect().right) + " ws=" + getComputedStyle(e).whiteSpace + " ov=" + getComputedStyle(e).overflowX + " par=" + e.parentElement.tagName + "." + String(e.parentElement.className).split(" ")[0]);
        return { sw: document.documentElement.scrollWidth, vw, wide: wide.slice(0, 5), leak: leak.slice(0, 6), scrollers };
      });
      ok(m.sw <= m.vw + 1, `${path} at ${w}px: the page does not scroll sideways`, { sw: m.sw, vw: m.vw, wide: m.wide, leak: m.leak });
      ok(m.wide.length === 0, `${path} at ${w}px: nothing outside a scroll box runs past the screen edge`, m.wide);
      if (/qq-edge-phone$/.test(path)) ok(m.scrollers.length >= 2 && m.scrollers.every((s) => s.fits && s.scrolls), `${path} at ${w}px: the code block and the table scroll inside their own box`, m.scrollers);
      await c.close();
    }
  } finally {
    if (made.j && made.j.id) await api("DELETE", "/articles/" + made.j.id);
    if (madeProject.j && madeProject.j.id) await api("DELETE", "/projects/" + madeProject.j.id);
    await b.close();
  }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  process.exit(fails ? 1 : 0);
})();
