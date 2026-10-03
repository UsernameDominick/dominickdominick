const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request, axeSource } = require("./_pw.cjs");
const B = E2E_BASE + "/api/admin";
(async () => {
  const api = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const b = await chromium.launch();
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  await ctx.grantPermissions(["clipboard-read", "clipboard-write"], { origin: E2E_BASE }).catch(() => {});
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e))); p.on("dialog", (d) => d.accept());
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const data = await (await api.get(B + "/features")).json();
  const items = data.items;
  const count = (status, kind) => items.filter((i) => i.status === status && (!kind || i.kind === kind)).length;
  ok(Array.isArray(items) && items.length > 50 && Array.isArray(data.requests), "the API returns the list and the requests");
  ok(items.every((i) => ["todo", "doing", "done", "parked"].includes(i.status)), "every item has a status the board understands");

  await p.goto(E2E_BASE + "/admin/", { waitUntil: "networkidle" });
  await p.waitForSelector("#app:not([hidden])");
  await p.click("#features-btn");
  await p.waitForSelector("#features-modal:not([hidden])");
  await p.waitForSelector("#features-todo .fb-card");
  ok(await p.evaluate(() => document.activeElement.id === "features-search"), "search has focus on open");
  ok((await p.textContent("#features-todo-count")) === String(count("todo")), "the To do count matches the list", await p.textContent("#features-todo-count"));
  ok((await p.textContent("#features-doing-count")) === String(count("doing")) && (await p.locator("#features-doing .fb-card").count()) === count("doing"), "Working on now shows what is marked as doing");
  ok((await p.textContent("#features-done-count")) === String(count("done")), "the Done count matches");
  ok(/\d+ of \d+ done/.test(await p.textContent("#features-progress-label")), "progress label shown");

  // layout: to do on the left; working on and done on the right
  const box = async (sel) => p.locator(sel).first().boundingBox();
  const left = await box(".fb-left"), doing = await box(".fb-doing"), done = await box(".fb-done");
  ok(left.x + left.width <= doing.x + 2 && Math.abs(doing.x - done.x) < 2 && doing.y < done.y, "To do is on the left; Working on now sits above Done on the right", { left, doing, done });

  // to do is grouped, needs-you first
  const groups = await p.$$eval("#features-todo .fb-group h3", (h) => h.map((x) => x.firstChild.textContent.trim()));
  ok(groups[0] === "Needs your decision", "what is waiting on you is listed first", groups);
  ok((await p.$$eval("#features-todo .fb-notes b", (c) => c.length > 0 && c.every((x) => /To decide|Note/.test(x.textContent)))), "items waiting on you say what is to be decided");

  // done: latest first, the rest behind a button
  ok((await p.locator("#features-done .fb-card").count()) === 10 && await p.isVisible("#features-done-more"), "Done shows the latest ten, with a button for the rest");
  const firstDone = await p.locator("#features-done .fb-card .fb-title").first().textContent();
  ok(items.find((i) => i.title === firstDone && i.date), "the first one is a dated, recent item", firstDone);
  await p.click("#features-done-more");
  ok((await p.locator("#features-done .fb-card").count()) === count("done"), "Show all lists every finished item");
  await p.click("#features-done-more");
  ok((await p.locator("#features-done .fb-card").count()) === 10, "and goes back");

  // filters
  await p.click('#features-kinds button[data-kind="decision"]');
  ok((await p.locator("#features-todo .fb-card").count()) === count("todo", "decision"), "the kind chips narrow To do");
  ok((await p.getAttribute('#features-kinds button[data-kind="decision"]', "aria-pressed")) === "true", "the chip shows it is pressed");
  await p.click('#features-kinds button[data-kind="decision"]');
  await p.fill("#features-search", "scripts window");
  ok((await p.$$eval("#features-done .fb-card .fb-title", (c) => c.map((x) => x.textContent))).includes("Scripts window") && !(await p.isVisible("#features-done-more")), "search finds a finished item and shows all matches");
  await p.fill("#features-search", "zzzzqqqq");
  ok(/Nothing/.test(await p.textContent("#features-todo")) && /Nothing finished/.test(await p.textContent("#features-done")), "no match says so on both sides");
  await p.fill("#features-search", "");
  const area = await p.$eval("#features-area option:nth-child(2)", (o) => o.value);
  await p.selectOption("#features-area", area);
  ok(await p.$$eval("#features-done .fb-area", (a, ar) => a.length > 0 && a.every((x) => x.textContent === ar), area), "the area filter narrows the list");
  await p.selectOption("#features-area", "");

  // adding things
  const T = "QQ board bug";
  await p.fill("#features-request-title", T);
  await p.selectOption("#features-request-kind", "bug");
  await p.fill("#features-request-notes", "it breaks when I click it");
  await p.click('#features-request-form button[type="submit"]');
  await p.waitForSelector("#features-todo .fb-mine");
  const mineCard = p.locator("#features-todo .fb-mine", { hasText: T });
  ok((await mineCard.count()) === 1 && /Bug/.test(await mineCard.locator(".fb-kind").textContent()) && /Yours/.test(await mineCard.textContent()), "a new request appears in To do as a bug, marked as yours");
  ok(!(await p.inputValue("#features-request-title")), "the form clears");
  const stored = (await (await api.get(B + "/features")).json()).requests.find((r) => r.title === T);
  ok(stored && stored.status === "todo" && stored.kind === "bug" && stored.notes === "it breaks when I click it", "and is stored on the site", stored);
  const firstGroup = await p.$$eval("#features-todo .fb-group", (g) => g.map((x) => [x.querySelector("h3").firstChild.textContent.trim(), x.querySelectorAll(".fb-card").length, x.querySelector(".fb-card .fb-title").textContent]));
  ok(firstGroup.find((g) => g[0] === "Bug") && firstGroup.find((g) => g[0] === "Bug")[2] === T, "it sits at the top of the Bug group", firstGroup);
  await p.fill("#features-request-title", "   ");
  await p.click('#features-request-form button[type="submit"]');
  ok(/first/.test(await p.textContent("#features-status")), "an empty request is refused with a hint");
  await mineCard.locator('select[data-act="kind"]').selectOption("attention");
  await p.waitForFunction((t) => [...document.querySelectorAll("#features-todo .fb-group")].some((g) => /Needs attention/.test(g.querySelector("h3").textContent) && [...g.querySelectorAll(".fb-title")].some((x) => x.textContent === t)), T);
  ok((await (await api.get(B + "/features")).json()).requests.find((r) => r.title === T).kind === "attention", "changing its kind moves it to another group and is saved");

  // copy for claude
  await p.click("#features-copy");
  await p.waitForFunction(() => /Copied|Couldn/.test(document.getElementById("features-status").textContent));
  const clip = await p.evaluate(() => navigator.clipboard.readText()).catch(() => null);
  if (clip !== null) ok(/^Board \(updated/.test(clip) && clip.includes(`My new requests, not picked up yet:\n- ${T} [attention] — it breaks when I click it (id: ${stored.id})`), "Copy for Claude lists the new request with its id", clip.slice(0, 200));

  // done, dropped, back
  await p.locator("#features-todo .fb-mine", { hasText: T }).locator('select[data-act="status"]').selectOption("done");
  await p.waitForFunction((t) => [...document.querySelectorAll("#features-done .fb-title")].some((x) => x.textContent === t), T);
  ok(!(await p.locator("#features-todo .fb-card", { hasText: T }).count()) && (await p.locator("#features-done .fb-card .fb-title").first().textContent()) === T, "marking it done moves it to the top of Done");
  ok(!/Picked up/.test(await p.locator("#features-done .fb-mine", { hasText: T }).textContent()), "and your own cards say they are yours, not picked up");
  await p.locator("#features-done .fb-mine", { hasText: T }).locator('select[data-act="status"]').selectOption("dropped");
  await p.waitForSelector("#features-dropped-wrap:not([hidden])");
  ok((await p.textContent("#features-dropped-count")) === "1", "dropping it files it under Dropped");
  await p.click("#features-dropped-wrap summary");
  await p.locator("#features-dropped .fb-mine", { hasText: T }).locator('select[data-act="status"]').selectOption("todo");
  await p.waitForSelector("#features-todo .fb-mine");
  ok(await p.locator("#features-todo .fb-card", { hasText: T }).count() === 1 && !(await p.isVisible("#features-dropped-wrap")), "and it can come back to To do");
  await p.locator("#features-todo .fb-mine", { hasText: T }).locator('button[data-act="delete"]').click();
  await p.waitForFunction((t) => ![...document.querySelectorAll(".fb-card")].some((c) => c.textContent.includes(t)), T);
  ok(!(await (await api.get(B + "/features")).json()).requests.some((r) => r.title === T), "Delete removes it");

  // a11y, phone, theme, keyboard
  await p.addScriptTag({ content: axeSource() }).catch(() => {});
  await p.fill("#features-request-title", "QQ axe check");
  await p.click('#features-request-form button[type="submit"]');
  await p.waitForSelector("#features-todo .fb-mine");
  const run = () => p.evaluate(async () => (await axe.run(document.getElementById("features-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
  const dark = await run();
  ok(dark.length === 0, "axe: no violations (dark)", dark);
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await p.waitForTimeout(600);
  const light = await run();
  ok(light.length === 0, "axe: no violations (light)", light);
  await p.screenshot({ path: require("os").tmpdir() + "/features_light.png" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await p.screenshot({ path: require("os").tmpdir() + "/features_desktop.png" });
  await p.setViewportSize({ width: 390, height: 800 }); await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => { const m = document.querySelector(".features-modal-inner"); const body = document.querySelector(".features-body"); return m.scrollWidth > m.clientWidth + 1 || body.scrollWidth > body.clientWidth + 1; })), "no horizontal overflow on a phone");
  const order = await p.evaluate(() => [".fb-doing", ".fb-left", ".fb-done"].map((s) => document.querySelector(s).getBoundingClientRect().top));
  ok(order[0] < order[1] && order[1] < order[2], "on a phone the sections stack: Working on now, To do, Done", order);
  await p.screenshot({ path: require("os").tmpdir() + "/features_phone.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.keyboard.press("Escape");
  await p.waitForTimeout(200);
  ok(!(await p.isVisible("#features-modal")), "Esc closes it");
  ok(await p.evaluate(() => document.activeElement.id === "features-btn"), "focus returns to the sidebar button");
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
