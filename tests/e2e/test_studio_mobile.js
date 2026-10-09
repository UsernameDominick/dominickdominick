// The Studio on small and sideways phones stays usable: nothing runs off the side, the main controls are on the screen and big enough to tap, the
// playlist and the editor keep a real size (a phone on its side used to squeeze them to a few pixels), and axe finds nothing in either theme.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, axeSource } = require("./_pw.cjs");
const axeSrc = axeSource();
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const b = await chromium.launch();
  try {
    for (const [name, w, h] of [["320 x 568", 320, 568], ["360 x 640", 360, 640], ["390 x 844", 390, 844], ["844 x 390 on its side", 844, 390], ["740 x 360 on its side", 740, 360]]) {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: scheme });
        await ctx.addInitScript((t) => { try { localStorage.setItem("studioTipSeen", "1"); localStorage.setItem("theme", t); } catch (e) { /* none */ } }, scheme);
        const p = await ctx.newPage();
        const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
        await p.goto(E2E_BASE + "/studio");
        await p.waitForSelector("#song-builder-modal:not([hidden]) #studio-stack .studio-card-main", { timeout: 30000 });
        await p.waitForTimeout(900);
        const tag = `${name}, ${scheme}`;
        const m = await p.evaluate(() => {
          const vw = window.innerWidth;
          const box = (q) => { const e = document.querySelector(q); if (!e) return null; const r = e.getBoundingClientRect(); return { l: Math.round(r.left), r: Math.round(r.right), t: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }; };
          return { vw, docW: document.documentElement.scrollWidth, stackTop: window.scrollY, play: box("#studio-play"), save: box("#studio-save"), stack: box("#studio-stack"), detail: box("#studio-detail"), undo: box("#studio-undo"), studioTop: document.getElementById("song-studio").scrollTop };
        });
        ok(m.docW <= m.vw + 1, `${tag}: the page does not scroll sideways`, [m.docW, m.vw]);
        ok(m.play && m.play.l >= 0 && m.play.r <= m.vw && m.play.w >= 40 && m.play.h >= 36, `${tag}: Play is on the screen and at least 40 x 36`, m.play);
        ok(m.save && m.save.r <= m.vw + 1 && m.save.w >= 36, `${tag}: Save is on the screen`, m.save);
        ok(m.undo && m.undo.w >= 32 && m.undo.r <= m.vw + 1, `${tag}: Undo is on the screen (even at 320)`, m.undo);
        ok(m.stack && m.stack.w >= m.vw * 0.5 && m.stack.h >= 60, `${tag}: the playlist has room (not squeezed to a few pixels)`, m.stack);
        ok(m.detail && m.detail.w >= m.vw * 0.45 && m.detail.h >= 150, `${tag}: the editor has room`, m.detail);
        ok(m.studioTop === 0, `${tag}: nothing scrolled the top of the Studio out of view by itself`, m.studioTop);
        await p.addScriptTag({ content: axeSrc }).catch(() => {});
        const v = await p.evaluate(async () => (await axe.run(document.getElementById("song-studio"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
        ok(v.length === 0, `${tag}: axe finds nothing`, v);
        ok(errs.length === 0, `${tag}: no page errors`, errs);
        await ctx.close();
      }
    }
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
