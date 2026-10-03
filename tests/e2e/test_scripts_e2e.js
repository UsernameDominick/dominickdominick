const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
const axeSrc = require("./_pw.cjs").axeSource();
const B = (E2E_BASE + "/api/admin");
(async () => {
  const api = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const val = () => p.inputValue(".ce-input");
  const setCode = async (code) => { await p.fill(".ce-input", code); await p.waitForTimeout(80); };
  const out = () => p.textContent("#script-output");
  const status = () => p.textContent("#script-status");
  const articleByTitle = async (t) => (await (await api.get(`${B}/articles`)).json()).find((a) => a.title === t);

  // fixture
  const T = "QQ script target";
  await api.post(`${B}/articles`, { data: { title: T, body: "A body that is long enough to be a valid article body for the QQ fixture.", tags: [] } });
  const fx = await articleByTitle(T);
  ok(fx && fx.tags.length === 0, "fixture article exists");

  await p.goto((E2E_BASE + "/admin/"), { waitUntil: "networkidle" });
  await p.waitForSelector("#app:not([hidden])");
  await p.click("#scripts-btn");
  await p.waitForSelector("#scripts-modal:not([hidden])");
  ok(await p.evaluate(() => document.activeElement && document.activeElement.classList.contains("ce-input")), "editor has focus on open");
  ok(/site\.articles\.list/.test(await val()), "opens with the blank starter");
  const opts = await p.$$eval("#script-template option", (o) => o.length);
  ok(opts >= 8, "templates listed: " + opts);

  // ---- editing behaviour
  await setCode("");
  await p.keyboard.type("if (x) {");
  await p.keyboard.press("Enter");
  await p.keyboard.type("y");
  ok((await val()) === "if (x) {\n  y\n}", "brackets auto-close and Enter indents", await val());
  await p.keyboard.press("Tab");
  ok((await val()) === "if (x) {\n  y  \n}", "Tab indents inside the editor", await val());
  await p.keyboard.press("Escape");
  ok(await p.isVisible("#scripts-modal"), "Esc inside the editor does not close the window");
  await p.keyboard.press("Tab");
  ok(await p.evaluate(() => !document.activeElement.classList.contains("ce-input")), "Esc then Tab leaves the editor (no keyboard trap)");
  await p.click(".ce-input");
  await setCode("");
  await p.keyboard.type("site.art");
  ok(await p.isVisible(".ce-complete"), "typing site.art opens suggestions");
  ok((await p.textContent(".ce-complete li")).startsWith("articles"), "…with articles first");
  ok(/suggestion/.test(await p.textContent(".ce-live")), "suggestions are announced", await p.textContent(".ce-live"));
  await p.keyboard.press("Enter");
  ok((await val()) === "site.articles", "Enter accepts the suggestion (no newline)", await val());
  await p.keyboard.type(".li");
  await p.keyboard.press("Tab");
  ok((await val()) === "site.articles.list", "Tab accepts too", await val());
  await p.keyboard.type("(");
  ok((await val()) === "site.articles.list()", "bracket auto-closed after completion");
  await p.keyboard.press("Escape");
  await setCode("// hi\nconst a = 1;");
  await p.keyboard.press("Control+/");
  ok((await val()).startsWith("// hi"), "Ctrl+/ toggles comments (caret at end line)", await val());
  ok(await p.$eval(".ce-highlight", (e) => e.querySelectorAll(".ce-comment, .ce-keyword").length >= 2), "highlighting present");
  // undo
  await setCode("abc");
  await p.click(".ce-input");
  await p.keyboard.press("End");
  await p.keyboard.type("(");
  await p.keyboard.press("Control+z");
  ok((await val()) === "abc", "Ctrl+Z undoes an auto-closed bracket in one step", await val());

  // ---- errors
  await setCode("const x = 1;\nconst y = ;\n");
  await p.click("#script-run");
  await p.waitForFunction(() => /Syntax error|Error/.test(document.getElementById("script-output").textContent), null, { timeout: 8000 });
  ok(/Syntax error/.test(await out()), "a syntax error is reported as one", await out());
  await setCode("const x = 1;\n\nthrow new Error('oops');");
  await p.click("#script-run");
  await p.waitForFunction(() => /oops/.test(document.getElementById("script-output").textContent), null, { timeout: 8000 });
  ok(/line 3/.test(await out()), "a runtime error names its line", await out());
  ok(await p.isVisible(".ce-error-bar") && (await p.textContent(".ce-gutter .ce-bad")) === "3", "and marks it in the editor");
  ok(/failed/.test(await status()) && /nothing was changed/.test(await status()), "status says nothing changed", await status());

  // ---- sandbox
  const attempts = `
const results = {};
const tryit = async (name, fn) => { try { results[name] = await fn(); } catch (e) { results[name] = "ERR: " + e.message; } };
await tryit("fetch", () => fetch("/api/admin/me"));
await tryit("xhr", () => new XMLHttpRequest());
await tryit("ws", () => new WebSocket("wss://example.com"));
await tryit("importScripts", () => importScripts("/x.js"));
await tryit("login", () => site.api("POST", "/login", { password: "x" }));
await tryit("scripts", () => site.api("GET", "/scripts"));
await tryit("traversal", () => site.api("GET", "/articles/../me"));
await tryit("external", () => site.api("GET", "https://example.com/"));
await tryit("media-delete", () => site.api("DELETE", "/media/uploads/x.png"));
await tryit("document", () => typeof document);
await tryit("cookie", () => typeof document === "undefined" ? "no document" : document.cookie);
await tryit("origin", () => self.location.origin);
await tryit("proto-fetch", async () => { const f = Object.getPrototypeOf(self).fetch || (typeof WorkerGlobalScope !== "undefined" && WorkerGlobalScope.prototype.fetch); if (!f) return "no prototype fetch"; const r = await f.call(self, "/api/admin/me"); return "status " + r.status; });
return results;`;
  await setCode(attempts);
  await p.click("#script-run");
  await p.waitForFunction(() => /Returned:/.test(document.getElementById("script-output").textContent), null, { timeout: 15000 });
  const text = await out();
  const res = JSON.parse(text.slice(text.indexOf("Returned:") + 9));
  ok(/isn't available/.test(res.fetch), "fetch refused", res.fetch);
  ok(/isn't available/.test(res.xhr) && /isn't available/.test(res.ws) && /isn't available/.test(res.importScripts), "other network doors refused");
  ok(/can't use/.test(res.login), "login blocked", res.login);
  ok(/can't use/.test(res.scripts), "scripts API blocked", res.scripts);
  ok(/not a valid/.test(res.traversal) && /not a valid/.test(res.external), "traversal and external URLs invalid");
  ok(/not change/.test(res["media-delete"]), "single media delete not allowed");
  ok(res.document === "undefined" && res.cookie === "no document", "no document or cookies in the sandbox");
  ok(res.origin === "null" || res.origin === undefined || /null/.test(String(res.origin)), "opaque origin", res.origin);
  ok(!/status 200/.test(res["proto-fetch"]), "bypass through the prototype is not authenticated", res["proto-fetch"]);

  // ---- loops are stopped
  await setCode("while (true) {}");
  await p.click("#script-run");
  await p.waitForSelector("#script-stop:not([hidden])");
  ok(await p.isDisabled("#script-run"), "Run is disabled while running");
  const alive = await p.evaluate(() => new Promise((r) => setTimeout(() => r("alive"), 300)));
  ok(alive === "alive", "the page stays responsive during a runaway loop");
  await p.click("#script-stop");
  await p.waitForFunction(() => document.getElementById("script-stop").hidden);
  ok(/Stopped/.test(await out()) || /Stopped/.test(await status()), "Stop ends it", await status());
  const t0 = Date.now();
  const timed = await p.evaluate(async () => { const h = window.ScriptRunner.run({ code: "while (true) {}", dry: true, call: async () => null, timeoutMs: 1200 }); const r = await h.promise; return { status: r.status, ms: r.ms }; });
  ok(timed.status === "timeout" && timed.ms < 4000, "a runaway loop times out", timed);
  ok(await p.evaluate(() => !document.querySelector("iframe[sandbox]")), "no sandbox frames are left behind");

  // ---- preview vs apply
  const script = `const hits = (await site.articles.list()).filter((a) => a.title === "${T}");\nfor (const a of hits) await site.articles.update(a.id, { tags: [...a.tags, "qq-tagged"] });\nconsole.log("matched", hits.length);`;
  await setCode(script);
  await p.click("#script-run");
  await p.waitForFunction(() => /Preview finished/.test(document.getElementById("script-status").textContent), null, { timeout: 8000 });
  ok(/matched 1/.test(await out()), "script saw the fixture", await out());
  ok((await p.$$eval("#script-changes li", (l) => l.map((x) => x.textContent))).join("|") === "PATCH /articles/" + fx.id + " (tags)", "change list shows the pending PATCH", await p.$$eval("#script-changes li", (l) => l.map((x) => x.textContent)));
  ok((await articleByTitle(T)).tags.length === 0, "preview changed nothing");
  ok(/1 change would be made/.test(await status()), "status counts it", await status());
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])");
  ok(/Apply 1 change for real/.test(await p.textContent("#script-confirm-text")), "Apply asks first");
  await p.click("#script-confirm-cancel");
  ok((await articleByTitle(T)).tags.length === 0, "cancelling changes nothing");
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])");
  await p.click("#script-confirm-go");
  await p.waitForFunction(() => /Applied/.test(document.getElementById("script-status").textContent), null, { timeout: 8000 });
  ok((await articleByTitle(T)).tags.join() === "qq-tagged", "Apply made the change");
  // editing after a preview invalidates it
  await setCode(script + "\n// edited");
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])");
  ok(/Apply 1 change/.test(await p.textContent("#script-confirm-text")), "Apply previews first when the code changed");
  await p.click("#script-confirm-cancel");

  // ---- destructive changes ask for the typed word
  await setCode(`await site.api("DELETE", "/articles/${fx.id}/permanent");`);
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])");
  ok(/permanent deletion/.test(await p.textContent("#script-confirm-text")), "permanent deletions are called out");
  ok(await p.$eval("#script-changes li", (l) => l.classList.contains("scripts-destructive")), "and marked in the list");
  await p.click("#script-confirm-go");
  await p.waitForSelector("#typed-confirm-modal:not([hidden])");
  await p.click("#typed-confirm-cancel");
  ok(!!(await articleByTitle(T)), "cancelling the typed confirmation keeps the article");

  // ---- save, list, reopen, delete
  await setCode("console.log('saved one');");
  await p.fill("#script-name", "QQ my script");
  await p.fill("#script-description", "QQ description");
  ok(await p.isVisible("#scripts-list .scripts-dot"), "unsaved marker shown");
  await p.keyboard.press("Control+s");
  await p.waitForFunction(() => /Saved/.test(document.getElementById("script-status").textContent));
  ok(!(await p.isVisible("#scripts-list .scripts-dot")), "marker clears after saving");
  const saved = await (await api.get(`${B}/scripts`)).json();
  const mine = saved.filter((s) => s.name === "QQ my script");
  ok(mine.length === 1 && mine[0].code === "console.log('saved one');" && mine[0].description === "QQ description", "Ctrl+S saved exactly once", mine.length);
  await p.click("#script-new");
  await setCode("// scratch");
  await p.click('#scripts-list button:has-text("QQ my script")');
  ok((await val()).includes("saved one"), "clicking a saved script opens it");
  ok(await p.isVisible("#script-delete"), "delete shown for a saved script");
  await setCode("console.log('v2');");
  await p.click("#script-save");
  await p.waitForFunction(() => /Saved/.test(document.getElementById("script-status").textContent));
  ok((await (await api.get(`${B}/scripts`)).json()).find((s) => s.id === mine[0].id).code.includes("v2"), "editing a saved script updates it in place");
  await p.selectOption("#script-template", "inventory");
  ok(/Site inventory/.test(await p.inputValue("#script-name")), "a template loads into a new unsaved script");
  await p.click("#script-run");
  await p.waitForFunction(() => /Preview finished/.test(document.getElementById("script-status").textContent), null, { timeout: 15000 });
  ok(/articles/.test(await out()) && /Longest articles/.test(await out()), "the inventory template runs", (await out()).slice(0, 200));
  await p.click('#scripts-list button:has-text("QQ my script")');
  await p.click("#script-delete");
  await p.waitForTimeout(500);
  ok(!(await (await api.get(`${B}/scripts`)).json()).some((s) => s.name === "QQ my script"), "delete removes it");
  // reference panel inserts
  await p.click("#scripts-modal summary");
  await setCode("");
  await p.click('#scripts-reference-list button:has-text("site.articles.list")');
  ok((await val()).includes("await site.articles.list();"), "reference entries insert a call");

  // ---- a11y + phone
  await p.addScriptTag({ content: axeSrc }).catch(() => {});
  const viol = await p.evaluate(async () => (await axe.run(document.getElementById("scripts-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
  ok(viol.length === 0, "axe: no violations in the Scripts window", viol);
  await p.setViewportSize({ width: 390, height: 800 });
  await p.waitForTimeout(300);
  const over = await p.evaluate(() => { const m = document.querySelector(".scripts-modal-inner"); return m.scrollWidth > m.clientWidth + 1; });
  ok(!over, "no horizontal overflow on a phone");
  await p.screenshot({ path: require("os").tmpdir() + "/scripts_phone.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  // light theme
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  const viol2 = await p.evaluate(async () => (await axe.run(document.getElementById("scripts-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 2).map((n) => n.target.join(" ")).join(" ; ")));
  ok(viol2.length === 0, "axe: light theme clean", viol2);
  await p.screenshot({ path: require("os").tmpdir() + "/scripts_light.png" });

  // ---- close asks when dirty
  await setCode("// unsaved");
  let asked = 0; p.removeAllListeners("dialog"); p.on("dialog", (d) => { asked++; d.dismiss(); });
  await p.click("#close-scripts");
  ok(asked === 1 && await p.isVisible("#scripts-modal"), "closing with unsaved changes asks and can be cancelled");
  p.removeAllListeners("dialog"); p.on("dialog", (d) => d.accept());
  await p.click("#close-scripts");
  ok(!(await p.isVisible("#scripts-modal")), "…and closes when confirmed");
  ok(errs.length === 0, "no page errors", errs);

  // cleanup
  for (const s of await (await api.get(`${B}/scripts`)).json()) if (/^QQ/.test(s.name)) await api.delete(`${B}/scripts/${s.id}`);
  const left = await articleByTitle(T);
  if (left) { await api.delete(`${B}/articles/${left.id}`); const t = await (await api.get(`${B}/articles/trash`)).json(); for (const it of t) if (/^QQ/.test(it.title)) await api.delete(`${B}/articles/${it.id}/permanent`); }
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  await b.close();
})();
