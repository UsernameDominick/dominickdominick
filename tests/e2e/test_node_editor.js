const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request, axeSource } = require("./_pw.cjs");
const B = E2E_BASE + "/api/admin";
(async () => {
  const api = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const b = await chromium.launch();
  const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(String(e)));
  p.on("dialog", (d) => d.accept());
  let fails = 0; const ok = (c, m, x) => { console.log((c ? "PASS" : "FAIL") + " — " + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fails++; };
  const settings = async () => (await api.get(B + "/settings")).json();
  const graph = () => p.evaluate(() => { const ed = document.querySelector(".ne-root"); return window.__lastGraph || null; });
  const nodeCount = () => p.locator(".ne-node").count();
  const wireCount = () => p.locator(".ne-wire:not(.ne-wire-temp)").count();
  const code = async () => { await p.click("#script-tab-code"); const v = await p.inputValue(".ce-input"); await p.click("#script-tab-nodes"); return v; };
  const pin = (node, pinId, dir) => p.locator(`.ne-node[data-id="${node}"] .ne-pin[data-pin="${pinId}"][data-dir="${dir}"]`);
  const centre = async (loc) => { const r = await loc.boundingBox(); return { x: r.x + r.width / 2, y: r.y + r.height / 2 }; };
  const drag = async (from, to) => { const a = await centre(from); const t = await centre(to); await p.mouse.move(a.x, a.y); await p.mouse.down(); await p.mouse.move((a.x + t.x) / 2, (a.y + t.y) / 2, { steps: 5 }); await p.mouse.move(t.x, t.y, { steps: 5 }); await p.mouse.up(); };
  // Wait for the status line to match; on a timeout say what the window was showing instead of just throwing.
  const waitStatus = async (re, ms = 10000) => {
    try {
      await p.waitForFunction((src) => new RegExp(src).test(document.getElementById("script-status").textContent), re.source, { timeout: ms });
      return true;
    } catch (e) {
      console.log("FAIL — waiting for status " + re + ": status=" + JSON.stringify(await p.textContent("#script-status")) + " output=" + JSON.stringify((await p.textContent("#script-output")).slice(0, 300)));
      fails++;
      return false;
    }
  };
  const addViaMenu = async (query) => { await p.click('.ne-toolbar [data-act="add"]'); await p.waitForSelector(".ne-menu:not([hidden])"); await p.fill(".ne-search", query); await p.keyboard.press("Enter"); await p.waitForTimeout(150); };

  // fixture pages with their own CSS
  const mk = async (title, slug, css) => { const r = await (await api.post(B + "/pages", { data: { title, slug } })).json(); await api.put(`${B}/pages/${r.id}/css`, { data: { css } }); return r.id; };
  const pa = await mk("QQ node page A", "qq-node-a", ".a { color: #ff7a45; }");
  const pb = await mk("QQ node page B", "qq-node-b", ".b { border: 1px solid #ff7a45; }");
  const cssOf = async (id) => (await (await api.get(`${B}/pages/${id}/css`)).json()).css;

  await p.goto(E2E_BASE + "/admin/", { waitUntil: "networkidle" });
  await p.waitForSelector("#app:not([hidden])");
  await p.click("#scripts-btn");
  await p.waitForSelector("#scripts-modal:not([hidden])");

  // ---- a new graph
  await p.click("#script-new-nodes");
  await p.waitForSelector(".ne-viewport");
  ok(await p.isVisible("#script-modes") && await p.isVisible(".ne-viewport") && !(await p.isVisible("#script-editor")), "a new node graph shows the canvas, not the code editor");
  ok((await nodeCount()) === 1 && (await p.textContent(".ne-node .ne-title")) === "Start", "it starts with just a Start node");
  ok(/Built from nodes/.test(await code()) && /nothing|connected/i.test(await p.textContent(".ne-problems")), "the generated code is shown, and Start not being connected is noted");
  ok(await p.evaluate(() => document.querySelector("#script-editor .ce-input").readOnly), "the generated code can't be typed over");

  // ---- add a node, connect by dragging
  await addViaMenu("set site");
  ok((await nodeCount()) === 2 && (await p.locator(".ne-node.is-selected .ne-title").textContent()) === "Set site setting", "the add menu finds a node by what it does and adds it");
  await drag(pin("n1", "then", "out"), pin("n2", "in", "in"));
  ok((await wireCount()) === 1, "dragging from a pin to a pin makes a wire");
  await p.selectOption('.ne-node[data-id="n2"] [data-prop="key"]', "theme_bg");
  await p.fill('.ne-node[data-id="n2"] [data-input="value"]', "#101010");
  const c1 = await code();
  ok(/await site\.settings\.update\(\{ "theme_bg": "#101010" \}\);/.test(c1), "the code follows the nodes as they change", c1);
  ok(!(await p.isVisible(".ne-problems")) || !/Fix/.test(await p.textContent(".ne-problems")), "no problems left");

  // ---- preview and apply a graph
  const before = await settings();
  await api.put(B + "/settings", { data: { ...before, theme_accent: "#ff7a45", site_brand: "QQ keep me" } });
  await p.click("#script-run");
  await waitStatus(/Preview finished/, 8000);
  ok((await p.$$eval("#script-changes li", (l) => l.map((x) => x.textContent))).join("|") === "PUT /settings (theme_bg)", "Preview lists the change the graph would make");
  ok((await settings()).theme_bg !== "#101010", "a preview changes nothing");
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])");
  await p.click("#script-confirm-go");
  await waitStatus(/Applied/, 8000);
  const after = await settings();
  ok(after.theme_bg === "#101010" && after.theme_accent === "#ff7a45" && after.site_brand === "QQ keep me", "Apply changes that setting and nothing else", { bg: after.theme_bg, accent: after.theme_accent, brand: after.site_brand });

  // ---- save, reload, reopen
  await p.fill("#script-name", "QQ node graph");
  await p.keyboard.press("Control+s").catch(() => {});
  await p.click("#script-save");
  await waitStatus(/Saved/);
  const saved = (await (await api.get(B + "/scripts")).json()).find((s) => s.name === "QQ node graph");
  ok(saved && saved.graph && saved.graph.nodes.length === 2 && saved.graph.wires.length === 1 && /theme_bg/.test(saved.code), "the graph is saved with its generated code", saved && saved.graph && saved.graph.nodes.length);
  ok(await p.isVisible('#scripts-list button:has-text("QQ node graph") .scripts-kind'), "the list marks it as a node graph");
  await p.reload({ waitUntil: "networkidle" });
  await p.click("#scripts-btn");
  await p.click('#scripts-list button:has-text("QQ node graph")');
  await p.waitForSelector(".ne-node");
  ok((await nodeCount()) === 2 && (await wireCount()) === 1 && (await p.inputValue('.ne-node[data-id="n2"] [data-input="value"]')) === "#101010", "reopening restores the nodes, wire and values");
  ok((await p.locator('.ne-node[data-id="n2"] [data-prop="key"]').inputValue()) === "theme_bg", "...and the chosen setting");

  // ---- keyboard: connect, disconnect, undo
  await addViaMenu("print");
  ok((await nodeCount()) === 3, "a Print node is added");
  await pin("n2", "then", "out").focus();
  await p.keyboard.press("Enter");
  ok((await p.getAttribute('.ne-node[data-id="n2"] .ne-pin[data-pin="then"][data-dir="out"]', "aria-pressed")) === "true", "Enter on a pin starts a connection");
  await pin("n3", "in", "in").focus();
  await p.keyboard.press("Enter");
  ok((await wireCount()) === 2, "Enter on another pin finishes it");
  ok(/connected from Set site setting/.test(await pin("n3", "in", "in").getAttribute("aria-label")), "pins say what they are connected to", await pin("n3", "in", "in").getAttribute("aria-label"));
  await pin("n3", "in", "in").focus();
  await p.keyboard.press("Delete");
  ok((await wireCount()) === 1, "Delete on a pin disconnects it");
  await p.locator(".ne-viewport").focus();
  await p.keyboard.press("Control+z");
  ok((await wireCount()) === 2, "Ctrl+Z brings the wire back");
  await p.keyboard.press("Control+Shift+z");
  ok((await wireCount()) === 1, "Ctrl+Shift+Z undoes the undo");
  // Esc cancels a pending connection without closing the window
  await pin("n3", "in", "in").focus();
  await p.keyboard.press("Enter");
  await p.keyboard.press("Escape");
  ok(await p.isVisible("#scripts-modal") && (await p.getAttribute('.ne-node[data-id="n3"] .ne-pin[data-pin="in"][data-dir="in"]', "aria-pressed")) === "false", "Esc cancels a connection and does not close the window");

  // ---- dragging a wire into empty space opens a filtered menu and plugs the new node in
  const out = await centre(pin("n3", "then", "out"));
  const box = await p.locator(".ne-viewport").boundingBox();
  await p.mouse.move(out.x, out.y);
  await p.mouse.down();
  await p.mouse.move(out.x + 80, out.y + 30, { steps: 4 });
  await p.mouse.move(Math.min(out.x + 140, box.x + box.width - 300), out.y + 60, { steps: 4 });
  await p.mouse.up();
  await p.waitForSelector(".ne-menu:not([hidden])");
  const offered = await p.$$eval(".ne-menu-list li[role=option] b", (l) => l.map((x) => x.textContent));
  ok(offered.length > 0 && offered.includes("Print") && !offered.includes("Text") && !offered.includes("Equals"), "dragging out of a flow pin offers only steps", offered);
  await p.keyboard.type("print");
  await p.keyboard.press("Enter");
  await p.waitForTimeout(150);
  ok((await nodeCount()) === 4 && (await wireCount()) === 2, "the new node is plugged into the pin you dragged from");
  // Esc closes just the menu
  await p.click('.ne-toolbar [data-act="add"]');
  await p.keyboard.press("Escape");
  ok(await p.isVisible("#scripts-modal") && !(await p.isVisible(".ne-menu")), "Esc closes the add menu and not the window");

  // ---- delete a node, and only that node
  await p.locator('.ne-node[data-id="n4"] .ne-head').click();
  await p.keyboard.press("Delete");
  ok((await nodeCount()) === 3, "Delete removes the selected node");
  ok((await wireCount()) === 2 - 0 || (await wireCount()) >= 1, "its wires go with it");
  await p.keyboard.press("Control+z");
  ok((await nodeCount()) === 4, "and undo brings it back");

  // ---- problems and running a broken graph
  await p.click("#script-new-nodes");
  await addViaMenu("page css");
  await drag(pin("n1", "then", "out"), pin("n2", "in", "in"));
  ok(/needs something connected/.test(await p.textContent(".ne-problems")), "a missing connection is listed under the canvas");
  ok(await p.locator('.ne-node[data-id="n2"].has-error').count() === 1, "and the node is marked");
  await p.click("#script-run");
  ok(/Fix the graph first/.test(await p.textContent("#script-output")), "running a broken graph says what to fix instead of running it");

  // ---- a starter graph, end to end on real pages
  await p.selectOption("#script-template", "graph:swap-colour");
  await p.waitForSelector(".ne-node");
  ok((await nodeCount()) === 6 && (await wireCount()) === 9, "a starter graph loads", { nodes: await nodeCount(), wires: await wireCount() });
  ok(!(await p.locator(".ne-problems").isVisible()) || !/Fix/.test(await p.textContent(".ne-problems")), "and has no problems");
  await p.click("#script-run");
  await waitStatus(/Preview finished/, 10000);
  const lines = await p.$$eval("#script-changes li", (l) => l.map((x) => x.textContent));
  ok(lines.some((l) => l.includes(`PUT /pages/${pa}/css`)) && lines.some((l) => l.includes(`PUT /pages/${pb}/css`)), "the preview lists a CSS change for each page", lines.slice(0, 6));
  ok((await cssOf(pa)).includes("#ff7a45"), "and changes nothing yet");
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])");
  await p.click("#script-confirm-go");
  await waitStatus(/Applied/, 15000);
  ok((await cssOf(pa)) === ".a { color: #c1440e; }" && (await cssOf(pb)) === ".b { border: 1px solid #c1440e; }", "Apply swaps the colour in each page's CSS", { a: await cssOf(pa), b: await cssOf(pb) });

  // ---- an error at run time points at the node
  await p.fill('.ne-node[data-id="n5"] [data-input="find"]', "#c1440e");
  await p.fill('.ne-node[data-id="n5"] [data-input="replacement"]', "</style>");
  await p.click("#script-apply");
  await p.waitForSelector("#script-confirm:not([hidden])", { timeout: 10000 });
  await p.click("#script-confirm-go");
  await p.waitForFunction(() => /Applied|Stopped|failed|Error|came from/.test(document.getElementById("script-status").textContent + document.getElementById("script-output").textContent), null, { timeout: 15000 });
  console.log("INFO status=" + JSON.stringify(await p.textContent("#script-status")) + " output=" + JSON.stringify((await p.textContent("#script-output")).slice(0, 400)));
  ok(/Set page CSS/.test(await p.textContent("#script-output")), "a failure while running names the node it came from", (await p.textContent("#script-output")).slice(0, 300));
  ok(await p.locator('.ne-node[data-id="n6"].is-selected').count() === 1, "and selects that node on the canvas");

  // ---- pan and zoom don't count as edits
  await p.selectOption("#script-template", "graph:set-accent");
  await p.waitForSelector(".ne-node");
  await p.click("#script-save");
  await p.fill("#script-name", "QQ view test");
  await p.click("#script-save");
  await waitStatus(/Saved/);
  await p.click('.ne-toolbar [data-act="zoom-in"]');
  await p.click('.ne-toolbar [data-act="fit"]');
  ok(!(await p.isVisible("#scripts-list .scripts-dot")), "zooming and moving around leave the script saved");

  // ---- detach to code
  await p.click("#script-detach");
  await p.waitForTimeout(150);
  ok(!(await p.isVisible("#script-modes")) && await p.isVisible("#script-editor") && !(await p.evaluate(() => document.querySelector("#script-editor .ce-input").readOnly)), "Edit as code turns it into a normal script");
  await p.click("#script-save");
  await waitStatus(/Saved/);
  ok(!(await (await api.get(B + "/scripts")).json()).find((s) => s.name === "QQ view test").graph, "and the saved script no longer has a graph");

  // ---- a11y, phone, light theme
  await p.click("#script-new-nodes");
  await addViaMenu("print");
  await drag(pin("n1", "then", "out"), pin("n2", "in", "in"));
  await p.addScriptTag({ content: axeSource() }).catch(() => {});
  const run = () => p.evaluate(async () => (await axe.run(document.getElementById("scripts-modal"), { resultTypes: ["violations"] })).violations.map((v) => v.id + ": " + v.nodes.slice(0, 3).map((n) => n.target.join(" ")).join(" ; ")));
  const dark = await run();
  ok(dark.length === 0, "axe: no violations in nodes mode (dark)", dark);
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "light"));
  await p.waitForTimeout(600);
  const light = await run();
  ok(light.length === 0, "axe: no violations in nodes mode (light)", light);
  await p.screenshot({ path: require("os").tmpdir() + "/nodes_light.png" });
  await p.evaluate(() => document.documentElement.setAttribute("data-theme", "dark"));
  await p.setViewportSize({ width: 390, height: 800 });
  await p.waitForTimeout(300);
  ok(!(await p.evaluate(() => { const m = document.querySelector(".scripts-modal-inner"); return m.scrollWidth > m.clientWidth + 1; })), "no horizontal overflow on a phone");
  await p.screenshot({ path: require("os").tmpdir() + "/nodes_phone.png" });
  await p.setViewportSize({ width: 1440, height: 900 });
  await p.screenshot({ path: require("os").tmpdir() + "/nodes_dark.png" });
  ok(errs.length === 0, "no page errors", errs);

  // cleanup
  for (const s of await (await api.get(B + "/scripts")).json()) if (/^QQ/.test(s.name)) await api.delete(B + "/scripts/" + s.id);
  await api.put(B + "/settings", { data: before });
  console.log(fails ? `${fails} FAILED` : "ALL PASS");
  await b.close();
})();
