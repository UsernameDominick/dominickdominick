// The site is the Studio and a magnifier. There is no home page ("/" goes to the Studio); the magnifier at the end of the nav (or Ctrl/Cmd+K) opens a
// search and command dialog: its rows filter as you type, and the two study modules are not listed, they show only when their name is typed and ask for
// their password.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
    await ctx.addInitScript(() => { try { localStorage.setItem("studioTipSeen", "1"); } catch (e) { /* none */ } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message));

    // the front door
    await p.goto(E2E_BASE + "/");
    ok(new URL(p.url()).pathname === "/studio", "the front door (/) lands on the Studio", p.url());
    await p.waitForSelector("#studio-mount .studio-native", { timeout: 30000 });
    const stops = await p.evaluate(() => [...document.querySelectorAll(".tabs > .tab")].map((t) => ({ tag: t.tagName, href: t.getAttribute("href"), id: t.id, label: t.textContent.trim() })));
    ok(stops.length === 2 && stops[0].href === "/studio" && stops[1].id === "finder-open", "the nav has two stops: the Studio and the search", stops);
    ok(!(await p.locator('.site-nav a[href="/"]').count()), "and nothing in it goes to a home page");
    ok((await p.locator("#finder-open svg.tab-ico").isVisible()) && (await p.getAttribute("#finder-open", "aria-label")) === "Search", "the search stop is a magnifier with a name for screen readers");
    const sitemap = await (await p.request.get(E2E_BASE + "/sitemap.xml")).text();
    ok(/\/studio</.test(sitemap) && !/dominickdominick\.com\/<\/loc>/.test(sitemap), "the sitemap lists the Studio and nothing else", sitemap);

    // the dialog
    await p.click("#finder-open");
    await p.waitForSelector("#site-finder:not([hidden])", { timeout: 5000 });
    ok(await p.evaluate(() => document.activeElement && document.activeElement.id === "finder-q"), "it opens with the cursor in the search box");
    const rows = () => p.evaluate(() => [...document.querySelectorAll("#finder-list .finder-item")].filter((e) => !e.hidden && e.offsetParent).map((e) => e.querySelector(".finder-label").textContent.trim().replace(/\s+/g, " ")));
    let list = await rows();
    ok(list.some((l) => /Dark mode/.test(l)) && list.includes("Reduce motion") && list.includes("Text size") && list.includes("studio") && list.length === 4, "the list is the settings and the Studio", list);
    ok((await p.locator("[data-study-lab]:visible").count()) === 0, "the study modules are not in it");
    await p.keyboard.type("dark");
    list = await rows();
    ok(list.length === 1 && /Dark mode|Light mode/.test(list[0]), "typing filters the rows", list);
    await p.fill("#finder-q", "zzzz");
    ok((await rows()).length === 0 && (await p.locator("#finder-none").isVisible()), "nothing matching says so");
    await p.fill("#finder-q", "stu");
    ok(!(await p.locator("[data-study-lab]:visible").count()), "a part of a word does not show the study modules ('stu')");
    await p.fill("#finder-q", "c777");
    list = await rows();
    ok(list.length === 1 && /C777/.test(list[0]), "typing a study module's name shows it", list);
    await p.fill("#finder-q", "study");
    ok((await rows()).length === 2, "and 'study' shows both", await rows());

    // opening one asks for the password
    await p.fill("#finder-q", "core 1");
    await p.keyboard.press("Enter");
    await p.waitForSelector("dialog.study-dialog[open]", { timeout: 15000 });
    ok(await p.evaluate(() => document.getElementById("site-finder").hidden), "Enter opens the first match and the search closes");
    await p.waitForSelector(".study-gate:not([hidden])", { timeout: 15000 });
    ok(true, "the study popup asks for its password");
    await p.fill(".study-input", "not it");
    await p.click(".study-submit");
    await p.waitForFunction(() => /isn't right/.test(document.querySelector(".study-status").textContent), null, { timeout: 10000 });
    ok(true, "a wrong password is refused");
    await p.fill(".study-input", "123");
    await p.click(".study-submit");
    await p.waitForSelector(".study-frame", { timeout: 20000 });
    ok(true, "and the right one opens the study page");
    await p.evaluate(() => { const d = document.querySelector("dialog.study-dialog"); d.close(); });
    await p.waitForTimeout(300);

    // keys
    await p.keyboard.press("Control+K");
    await p.waitForSelector("#site-finder:not([hidden])", { timeout: 5000 });
    ok(await p.evaluate(() => document.getElementById("finder-q").value === ""), "Ctrl+K opens it with an empty box (it forgets what was typed)");
    await p.keyboard.press("ArrowDown");
    ok(await p.evaluate(() => document.activeElement.classList.contains("finder-item")), "the arrow keys move into the list");
    await p.keyboard.press("ArrowUp");
    ok(await p.evaluate(() => document.activeElement.id === "finder-q"), "and back up to the box");
    await p.keyboard.press("Escape");
    ok(await p.evaluate(() => document.getElementById("site-finder").hidden), "Esc closes it");

    // a dark and a light dialog are clean
    await p.click("#finder-open");
    await p.addScriptTag({ content: axeSrc }).catch(() => {});
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => { document.documentElement.dataset.theme = t; }, theme);
      await p.waitForTimeout(250);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("site-finder"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
      ok(v.length === 0, `axe: the search dialog is clean in the ${theme} theme`, v);
    }
    ok(errs.length === 0, "no page errors", errs);
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
