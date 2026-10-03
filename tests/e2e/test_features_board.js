const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request, axeSource } = require("./_pw.cjs");
const B = E2E_BASE + "/api/admin";
(async () => {
  const api = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const b = await chromium.launch();
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: E2E_BASE }).catch(() => {});
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const data = await (await api.get(B + "/features")).json();
  ok(Array.isArray(data.items) && data.items.length > 50 && data.counts && Array.isArray(data.requests), "the API returns the list, counts and requests");

  await p.goto(E2E_BASE + "/admin/", { waitUntil: "networkidle" });
  await p.waitForSelector("#app:not([hidden])");
  await p.click("#features-btn");
  await p.waitForSelector("#features-modal:not([hidden])");
  await p.waitForSelector(".fb-chip");
  ok(await p.evaluate(() => document.activeElement.id === "features-search"), "search has focus on open");
  const chipCounts = await p.$$eval(".fb-chip", (c) => c.map((x) => [x.dataset.status, Number(x.querySelector("b").textContent)]));
  ok(chipCounts[0][0] === "all" && chipCounts[0][1] === data.items.length, "the All chip counts every item", chipCounts[0]);
  ok(chipCounts.slice(1).every(([s, n]) => n === (data.counts[s] || 0)), "each status chip matches the API counts", chipCounts);
  ok(/\d+ of \d+ done/.test(await p.textContent("#features-progress-label")), "progress label shown");
  const order = await p.$$eval("#features-groups .fb-badge", (b) => b.map((x) => x.textContent));
  ok(order[0] === "Needs your decision" && order[order.length - 1] === "Done", "what needs a decision is listed first, Done last", order);
  ok(await p.$eval("#features-groups details.fb-group", (d) => !d.open), "the long Done list starts folded");
  ok((await p.locator("#features-groups .fb-card:visible").count()) < data.items.length, "…so not every card is on screen yet");

  // filters
  await p.click('.fb-chip[data-status="decision"]');
  ok((await p.getAttribute('.fb-chip[data-status="decision"]', "aria-pressed")) === "true", "the chip shows it is pressed");
  ok((await p.$$eval("#features-groups .fb-card", (c) => c.length)) === data.counts.decision, "only decision items remain", await p.$$eval("#features-groups .fb-card", (c) => c.length));
  ok((await p.$$eval("#features-groups .fb-notes b", (c) => c.every((x) => x.textContent === "To decide:"))), "decision items say what is to be decided");
  await p.click('.fb-chip[data-status="decision"]');
  await p.click('.fb-chip[data-status="done"]');
  ok(await p.$("#features-groups details") === null, "filtering to Done unfolds the list");
  ok((await p.$$eval("#features-groups .fb-card", (c) => c.length)) === data.counts.done, "all Done items shown");
  await p.click('.fb-chip[data-status="done"]');
  await p.fill("#features-search", "scripts window");
  ok((await p.$$eval("#features-groups .fb-card .fb-title", (c) => c.map((x) => x.textContent))).includes("Scripts window"), "search finds an item by name (and unfolds Done)");
  await p.fill("#features-search", "zzzzqqqq");
  ok(/Nothing matches/.test(await p.textContent("#features-groups")), "no match says so");
  await p.fill("#features-search", "");
  const firstArea = await p.$eval("#features-area option:nth-child(2)", (o) => o.value);
  await p.selectOption("#features-area", firstArea);
  ok(await p.$$eval("#features-groups .fb-area", (a, area) => a.length > 0 && a.every((x) => x.textContent === area), firstArea), "area filter narrows the list");
  await p.selectOption("#features-area", "");

  // requests
  const T = "QQ board request";
  await p.fill("#features-request-title", T);
  await p.fill("#features-request-notes", "some details");
  await p.click('#features-request-form button[type="submit"]');
  await p.waitForSelector(".fb-request");
  ok(await p.isVisible(".fb-request .fb-title") && /QQ board request/.test(await p.textContent(".fb-request")), "a new request appears");
  ok(!(await p.inputValue("#features-request-title")), "the form clears");
  const stored = (await (await api.get(B + "/features")).json()).requests.find((r) => r.title === T);
  ok(stored && stored.status === "requested" && stored.notes === "some details", "and is stored on the site", stored);
  await p.fill("#features-request-title", "   ");
  await p.click('#features-request-form button[type="submit"]');
  ok(/first/.test(await p.textContent("#features-status")), "an empty request is refused with a hint");
  await p.selectOption(".fb-request select", "done");
  await p.waitForFunction(() => document.querySelector(".fb-request-done"));
  ok((await (await api.get(B + "/features")).json()).requests.find((r) => r.title === T).status === "done", "changing its status is saved");
  ok(await p.$eval(".fb-request-done .fb-title", (e) => getComputedStyle(e).textDecorationLine.includes("line-through")), "a finished request is struck through");
  // copy
  await p.click("#features-copy");
  await p.waitForFunction(() => /Cop/.test(document.getElementById("features-status").textContent));
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) ok(/^Features \(updated/.test(clip) && /Needs your decision:/.test(clip), "Copy puts the open items on the clipboard", clip.slice(0, 80));
  // delete
  await p.click('.fb-request button[data-act="delete"]');
  await p.waitForFunction(() => !document.querySelector(".fb-request"));
  ok(!(await (await api.get(B + "/features")).json()).requests.some((r) => r.title === T), "Delete removes it");

  // a11y, phone, theme, keyboard
  const axeSrc = axeSource();
  await p.addScriptTag({ content: axeSrc }).catch(() => {});
  const run = () => p.evaluate(async () => (await axe.run(document.getElementById("features-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
  ok((await run()).length === 0, "axe: no violations (dark)", await run());
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  ok((await run()).length === 0, "axe: no violations (light)", await run());
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await p.click('.fb-chip[data-status="done"]'); await p.click('.fb-chip[data-status="done"]');
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => { const m = document.querySelector(".features-modal-inner"); const body = document.querySelector(".features-body"); return m.scrollWidth > m.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1; })), "no horizontal overflow on a phone");
  await p.screenshot({ path: require("os").tmpdir() + "/features_phone.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.screenshot({ path: require("os").tmpdir() + "/features_desktop.png" });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  ok(!(await p.isVisible("#features-modal")), "Esc closes it");
  ok(await p.evaluate(() => document.activeElement.id === "features-btn"), "focus returns to the sidebar button");
  // command palette
  await p.keyboard.press("Control+k");
  await p.waitForTimeout(200);
  await p.keyboard.type("Open Features");
  await p.keyboard.press("Enter");
  await p.waitForSelector("#features-modal:not([hidden])", { timeout: 3000 }).catch(() => {});
  ok(await p.isVisible("#features-modal"), "Ctrl+K → Open Features works");
  ok(errs.length === 0, "no page errors", errs);
  for (const r of (await (await api.get(B + "/features")).json()).requests) if (/^QQ/.test(r.title)) await api.delete(B + "/feature-requests/" + r.id);
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  await b.close();
})();
