// Blocks on the public page are the same wherever they are placed and however they are resized: a block is exactly its content (no stray outer
// margin from a paragraph, heading or rule), the space between blocks is the grid's gap for every kind of block, a spacer is as tall on a phone
// as on a wide screen, and nothing runs past the screen at phone width.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const f = (m, p, b) => c.fetch(E2E_BASE + "/api/admin" + p, { method: m, data: b });
  const slug = "qq-spacing-" + Date.now();
  const pg = await (await f("POST", "/pages", { title: "QQ Spacing", slug })).json();
  const add = (type, content, col, row, cs, rs, style) => f("POST", `/pages/${pg.id}/blocks`, { type, content, col, row, col_span: cs, row_span: rs, style });
  await add("heading", { text: "QQ Heading block", level: 1 }, 1, 1, 24, 2);
  await add("text", { text: "QQ first paragraph with enough words in it to wrap onto a second line on a phone.\n\nQQ second paragraph." }, 1, 3, 24, 4);
  await add("spacer", {}, 1, 7, 24, 4);
  await add("heading", { text: "QQ Heading two", level: 2 }, 1, 11, 24, 2);
  await add("button", { label: "QQ Go", url: "/x" }, 1, 13, 24, 2);
  await add("divider", {}, 1, 15, 24, 1);
  await add("quote", { text: "QQ quote text", cite: "me" }, 1, 16, 24, 3);
  await add("text", { text: "QQ padded text" }, 1, 19, 24, 2, { padding: 24, bg: "#222" });
  await add("text", { text: "QQ last text block" }, 1, 21, 24, 2);
  await add("text", { text: "QQ" + "unbrokenwordthatisfarlongerthanaphonescreencouldeverhold".repeat(3) }, 1, 23, 24, 2);
  await f("PUT", `/pages/${pg.id}`, { title: "QQ Spacing", slug, published: true });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const measure = async (width) => {
    const ctx = await b.newContext({ viewport: { width, height: 900 }, isMobile: width < 500, hasTouch: width < 500 });
    const p = await ctx.newPage();
    await p.goto(E2E_BASE + "/" + slug);
    await p.waitForSelector(".canvas > .block");
    const r = await p.evaluate(() => {
      const bl = [...document.querySelectorAll(".canvas > .block")];
      const canvas = document.querySelector(".canvas").getBoundingClientRect();
      const cs = getComputedStyle(document.querySelector(".canvas"));
      return {
        n: bl.length,
        edges: bl.map((e) => [e.firstElementChild ? getComputedStyle(e.firstElementChild).marginTop : "0px", e.lastElementChild ? getComputedStyle(e.lastElementChild).marginBottom : "0px"]),
        gaps: bl.slice(0, -1).map((e, i) => Math.round(bl[i + 1].getBoundingClientRect().top - e.getBoundingClientRect().bottom)),
        spacer: Math.round(bl[2].getBoundingClientRect().height),
        over: document.documentElement.scrollWidth - window.innerWidth,
        widths: bl.map((e) => Math.round(e.getBoundingClientRect().width)),
        content: Math.round(canvas.width - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight)),
        rightmost: Math.max(...bl.map((e) => Math.round(e.getBoundingClientRect().right))),
        words: Math.round(bl[9].scrollWidth - bl[9].clientWidth),
      };
    });
    await ctx.close();
    return r;
  };
  try {
    const m = await measure(390);
    const d = await measure(1280);
    ok(m.n === 10 && d.n === 10, "ten blocks on both", [m.n, d.n]);
    ok(m.edges.every((e) => e[0] === "0px" && e[1] === "0px") && d.edges.every((e) => e[0] === "0px" && e[1] === "0px"), "no block starts or ends with an outer margin of its own", { m: m.edges, d: d.edges });
    ok(new Set(m.gaps).size === 1 && m.gaps[0] === 16, "on a phone the space between every pair of blocks is the same 16px, whatever they hold", m.gaps);
    ok(new Set(d.gaps).size === 1 && d.gaps[0] === 8, "on a wide screen it is the same 8px", d.gaps);
    ok(m.spacer === 88 && d.spacer === 88, "a four-row spacer is 88px tall on a phone and on a wide screen", [m.spacer, d.spacer]);
    ok(m.over <= 0 && d.over <= 0, "nothing makes the page wider than the screen (not even a very long word)", [m.over, d.over]);
    ok(m.widths.every((w) => w === m.content) && m.rightmost <= 390 - 20 + 1, "on a phone every block is exactly the width of the page's content, inside its side margins", { widths: m.widths, content: m.content, right: m.rightmost });
    ok(m.words <= 1, "a long word wraps inside its block", m.words);
  } finally {
    await f("DELETE", `/pages/${pg.id}`);
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
