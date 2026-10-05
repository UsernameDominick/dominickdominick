// Hidden Notes: the owner-only vault. Nobody else can see the tab, open the page or call the API; notes are sealed in the browser (the
// server never holds readable text or the passphrase); a wrong passphrase gets nowhere; the vault stays out of backups and survives a
// restore; change passphrase, sealed copy and import work; locking forgets everything.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request, axeSource } = require("./_pw.cjs");
const BASE = E2E_BASE; let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined && !c ? "  -> " + JSON.stringify(e) : ""}`); };
const SECRET = "the quick brown secret fox 9f3a";
const PASS1 = "correct horse battery";
const PASS2 = "another long passphrase!";
(async () => {
  const admin = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const anon = await request.newContext();
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    // ---- start from an empty vault (the copy of the database may have one from an earlier run)
    await admin.fetch(`${BASE}/api/admin/hidden-notes/erase`, { method: "POST", data: { confirm: "ERASE" } });

    // ---- nobody else
    const anonPage = await anon.get(`${BASE}/hidden-notes`);
    const missing = await anon.get(`${BASE}/definitely-not-a-page-xyz`);
    ok(anonPage.status() === 404 && (await anonPage.text()) === (await missing.text()).replace(/definitely-not-a-page-xyz/g, "hidden-notes"), "a visitor gets the same 404 as for any missing address", anonPage.status());
    ok([401, 403].includes((await anon.get(`${BASE}/api/admin/hidden-notes`)).status()) && [401, 403].includes((await anon.post(`${BASE}/api/admin/hidden-notes`, { data: { blob: "x" } })).status()), "a visitor cannot use the API");
    ok(!/Hidden Notes/.test(await (await anon.get(`${BASE}/`)).text()), "the home page shows visitors no Hidden Notes tab");
    ok(!/hidden-notes/.test(await (await anon.get(`${BASE}/sitemap.xml`)).text()), "and the sitemap doesn't list it");
    const mine = await admin.get(`${BASE}/hidden-notes`);
    const mineHtml = await mine.text();
    ok(mine.status() === 200 && /name="robots" content="noindex"/.test(mineHtml) && /no-store/.test(mine.headers()["cache-control"] || ""), "the owner gets the page, marked noindex and not cacheable", mine.headers()["cache-control"]);
    ok(/href="\/hidden-notes"[^>]*>Hidden Notes/.test(await (await admin.get(`${BASE}/`)).text()), "and the home page shows the owner the tab");

    // ---- the browser
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1200, height: 900 }, acceptDownloads: true });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
    p.on("dialog", (d) => (d.type() === "prompt" ? d.accept("ERASE") : d.accept()));
    await p.goto(BASE + "/", { waitUntil: "networkidle" });
    await p.click('a.tab:has-text("Hidden Notes")');
    await p.waitForURL("**/hidden-notes");
    await p.waitForSelector("#hn-pass");
    ok(/Set up your vault/.test(await p.textContent("#hn-root")), "the tab opens the page, which asks for a passphrase to set the vault up");
    // setup validation
    await p.fill("#hn-pass", "short"); await p.fill("#hn-pass2", "short"); await p.click("#hn-root button[type=submit]");
    ok(/at least 10/.test(await p.textContent(".hn-msg")), "a short passphrase is refused");
    await p.fill("#hn-pass", PASS1); await p.fill("#hn-pass2", PASS1 + "x"); await p.click("#hn-root button[type=submit]");
    ok(/don't match/.test(await p.textContent(".hn-msg")), "two different passphrases are refused");
    await p.fill("#hn-pass2", PASS1); await p.click("#hn-root button[type=submit]");
    ok(/Tick the box/.test(await p.textContent(".hn-msg")), "it makes you confirm the no-reset warning");
    await p.check("#hn-ack"); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    ok(true, "setting up opens the empty notes page");
    // write a note
    await p.click("text=New note");
    await p.fill("#hn-title", "First thoughts");
    await p.fill("#hn-body", SECRET + "\nsecond line");
    await p.waitForFunction(() => /Saved \d/.test(document.querySelector(".hn-status").textContent), null, { timeout: 25000 });
    ok(true, "typing saves by itself");
    const raw = await (await admin.get(`${BASE}/api/admin/hidden-notes`)).text();
    ok(!raw.includes(SECRET) && !raw.includes("First thoughts") && !raw.includes(PASS1) && /"ct":"/.test(raw), "what the server holds has neither the text, the title nor the passphrase", raw.slice(0, 200));
    // lock
    await p.click("text=Lock");
    await p.waitForSelector("#hn-pass");
    ok(!(await p.textContent("body")).includes(SECRET), "locking removes the text from the page");
    await p.fill("#hn-pass", "wrong passphrase!!"); await p.click("#hn-root button[type=submit]");
    await p.waitForFunction(() => /doesn't open/.test(document.querySelector(".hn-msg").textContent));
    ok(true, "a wrong passphrase gets nowhere");
    await p.fill("#hn-pass", PASS1); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    ok((await p.textContent(".hn-list")).includes("First thoughts"), "the right one brings the note back");
    await p.click(".hn-item");
    ok((await p.inputValue("#hn-body")).startsWith(SECRET), "and its text");
    // reload: locked again, key not kept anywhere
    await p.reload({ waitUntil: "networkidle" });
    await p.waitForSelector("#hn-pass");
    ok(/Locked/.test(await p.textContent("#hn-root")), "a reload is locked again");
    ok(await p.evaluate(() => !Object.keys(localStorage).concat(Object.keys(sessionStorage)).some((k) => /hidden|note|key|pass/i.test(k))), "nothing is kept in the browser's storage");
    await p.fill("#hn-pass", PASS1); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    // second note, search, delete
    await p.click("text=New note");
    await p.fill("#hn-title", "Shopping");
    await p.fill("#hn-body", "milk and eggs");
    await p.waitForFunction(() => /Saved \d/.test(document.querySelector(".hn-status").textContent), null, { timeout: 25000 });
    ok((await p.locator(".hn-item").count()) === 2, "a second note is added");
    await p.fill("#hn-search", "eggs");
    ok((await p.locator(".hn-item").count()) === 1 && (await p.textContent(".hn-item")).includes("Shopping"), "search finds text in the body");
    await p.fill("#hn-search", "");
    await p.locator(".hn-item", { hasText: "Shopping" }).click();
    await p.click("text=Delete note");
    await p.waitForFunction(() => document.querySelectorAll(".hn-item").length === 1);
    ok(((await (await admin.get(`${BASE}/api/admin/hidden-notes`)).json()).notes || []).length === 1, "deleting removes it for good");
    // typing straight after "New note", while its first save is still on its way, must not be lost by a quick Lock
    await p.route("**/api/admin/hidden-notes", async (route) => { if (route.request().method() === "POST") await new Promise((r) => setTimeout(r, 1500)); await route.continue(); });
    await p.click("text=New note");
    await p.fill("#hn-title", "Quick one");
    await p.fill("#hn-body", "typed while the first save was still on its way");
    await p.click("text=Lock");
    await p.waitForSelector("#hn-pass");
    await p.unroute("**/api/admin/hidden-notes");
    await p.fill("#hn-pass", PASS1); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    ok((await p.textContent(".hn-list")).includes("Quick one"), "a note typed while its first save was still on its way survives a quick Lock");
    await p.locator(".hn-item", { hasText: "Quick one" }).click();
    ok((await p.inputValue("#hn-body")).startsWith("typed while the first save"), "with its text");
    await p.click("text=Delete note");
    await p.waitForFunction(() => document.querySelectorAll(".hn-item").length === 1);

    // ---- backups
    const backup = await (await admin.get(`${BASE}/api/admin/export`)).text();
    ok(!/hidden_note/.test(backup) && !backup.includes(SECRET) && !/"ct"/.test(backup), "the site backup has no trace of the vault");
    const parsed = JSON.parse(backup);
    const restored = await admin.post(`${BASE}/api/admin/import`, { data: parsed });
    ok(restored.status() === 200, "a restore from that backup runs", restored.status());
    const after = await (await admin.get(`${BASE}/api/admin/hidden-notes`)).json();
    ok(after.meta && after.notes.length === 1, "and the vault is exactly as it was after it");
    // a backup that somehow carries vault rows must not overwrite it
    parsed.settings.push({ key: "hidden_note:aaaaaaaaaaaa", value: "{}" }, { key: "hidden_notes_meta", value: "{}" });
    await admin.post(`${BASE}/api/admin/import`, { data: parsed });
    const after2 = await (await admin.get(`${BASE}/api/admin/hidden-notes`)).json();
    ok(after2.meta && after2.meta.salt === after.meta.salt && after2.notes.length === 1, "a backup file that carries vault rows is ignored for them");

    // ---- sealed copy, change passphrase, import
    await p.reload({ waitUntil: "networkidle" });
    await p.fill("#hn-pass", PASS1); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.click("text=Download sealed copy")]);
    const copyText = require("node:fs").readFileSync(await dl.path(), "utf8");
    ok(!copyText.includes(SECRET) && /dominick-hidden-notes/.test(copyText), "the sealed copy holds no readable text");
    await p.click("text=Change passphrase…");
    await p.fill("#hn-cur", "not it at all!!"); await p.fill("#hn-new", PASS2); await p.fill("#hn-new2", PASS2);
    await p.click(".hn-panel button[type=submit]");
    await p.waitForFunction(() => /wrong/.test(document.querySelector(".hn-panel .hn-msg").textContent));
    ok(true, "changing needs the current passphrase");
    await p.fill("#hn-cur", PASS1);
    await p.click(".hn-panel button[type=submit]");
    await p.waitForFunction(() => /Passphrase changed/.test(document.querySelector(".hn-status").textContent));
    await p.click("text=Lock");
    await p.fill("#hn-pass", PASS1); await p.click("#hn-root button[type=submit]");
    await p.waitForFunction(() => /doesn't open/.test(document.querySelector(".hn-msg").textContent));
    ok(true, "after the change the old passphrase no longer opens it");
    await p.fill("#hn-pass", PASS2); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    await p.click(".hn-item");
    ok((await p.inputValue("#hn-body")).startsWith(SECRET), "the new one opens it, with the note intact");
    // import the older sealed copy: it comes back under the OLD passphrase
    await p.click("text=Import sealed copy…");
    await p.setInputFiles("#hn-file", { name: "copy.json", mimeType: "application/json", buffer: Buffer.from(copyText) });
    await p.fill("#hn-copy-pass", "nope nope nope nope");
    await p.click(".hn-panel button[type=submit]");
    await p.waitForFunction(() => /doesn't open the copy/.test(document.querySelector(".hn-panel .hn-msg").textContent));
    ok(true, "an import with the wrong passphrase for the copy is refused");
    await p.fill("#hn-copy-pass", PASS1);
    await p.click(".hn-panel button[type=submit]");
    await p.waitForFunction(() => /Imported 1 notes/.test(document.querySelector(".hn-status").textContent));
    await p.click("text=Lock");
    await p.fill("#hn-pass", PASS1); await p.click("#hn-root button[type=submit]");
    await p.waitForSelector(".hn-layout");
    ok(true, "the imported copy opens with the passphrase it was made with");

    // ---- look and accessibility
    await p.addScriptTag({ content: axeSource() });
    for (const theme of ["dark", "light"]) {
      await p.evaluate((t) => document.documentElement.setAttribute("data-theme", t), theme);
      await p.waitForTimeout(500);
      const v = await p.evaluate(async () => (await axe.run(document.getElementById("hn-root"), { resultTypes: ["violations"] })).violations.map((x) => x.id + ": " + x.nodes.map((n) => n.target.join(" ")).slice(0, 3).join(",")));
      ok(v.length === 0, `${theme} theme: no accessibility findings`, v);
    }
    await p.setViewportSize({ width: 390, height: 800 });
    await p.waitForTimeout(400);
    const geo = await p.evaluate(() => { const r = document.querySelector(".hn-layout").getBoundingClientRect(); const foot = document.querySelector("footer"); return { spill: document.documentElement.scrollWidth - document.documentElement.clientWidth, footerBelow: !foot || foot.getBoundingClientRect().top >= document.querySelector(".hn-status").getBoundingClientRect().bottom - 1, w: Math.round(r.width) }; });
    ok(geo.spill <= 0 && geo.footerBelow, "on a phone nothing spills and the footer stays below the notes", geo);
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();
  } finally {
    await admin.fetch(`${BASE}/api/admin/hidden-notes/erase`, { method: "POST", data: { confirm: "ERASE" } });
    await b.close();
  }
  console.log(f ? "FAILURES " + f : "ALL PASS"); process.exit(f ? 1 : 0);
})();
