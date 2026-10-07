// Site Settings > Header & footer: a link renamed in the Navigation list is kept whichever Save is pressed. The big Save at the bottom used to
// close the dialog without writing the page links (only "Save navigation" did), so the next time the dialog opened they had snapped back.
const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium, request } = require("./_pw.cjs");
(async () => {
  let fail = 0; const ok = (c, m, x) => { console.log((c ? "PASS " : "FAIL ") + m + (x !== undefined && !c ? " " + JSON.stringify(x) : "")); if (!c) fail++; };
  const admin = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const api = (m, p, data) => admin.fetch(E2E_BASE + "/api/admin" + p, { method: m, headers: { "content-type": "application/json" }, data: data === undefined ? undefined : JSON.stringify(data) });
  const slug = "qq-nav-" + Date.now();
  const made = await (await api("POST", "/pages", { title: "QQ Nav Page", slug, nav_label: "QQ Nav" })).json();
  const labelOnServer = async () => ((await (await api("GET", "/pages")).json()).find((p) => p.id === made.id) || {}).nav_label;
  const b = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  try {
    const ctx = await b.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1280, height: 900 } });
    const p = await ctx.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
    await p.goto(E2E_BASE + "/admin", { waitUntil: "networkidle" });
    const open = async () => {
      await p.click("#site-settings-btn");
      await p.click('.settings-tab[data-panel="headerfooter"]');
      await p.waitForSelector(`#nav-editor .nav-row[data-id="${made.id}"]`);
    };
    const field = () => p.locator(`#nav-editor .nav-row[data-id="${made.id}"] [data-field="label"]`);

    // the big Save at the bottom
    await open();
    ok((await field().inputValue()) === "QQ Nav", "the page's link is in the Navigation list");
    await field().fill("QQ Renamed");
    await p.click("#save-settings");
    await p.waitForFunction(() => document.getElementById("settings-modal").hidden, null, { timeout: 8000 });
    ok((await labelOnServer()) === "QQ Renamed", "the bottom Save writes the renamed link", await labelOnServer());
    await open();
    ok((await field().inputValue()) === "QQ Renamed", "and it is still there when Site Settings is opened again");
    ok(new RegExp('class="tab-label">QQ Renamed<').test(await (await request.newContext()).get(E2E_BASE + "/").then((r) => r.text())), "and the public nav shows it");

    // "Save navigation" next to the list still works, and keeps marks around a name exactly as typed
    await field().fill("· QQ Marks ·");
    await p.click("#nav-save-btn");
    await p.waitForFunction(() => /^Saved/.test(document.getElementById("nav-save-status").textContent), null, { timeout: 8000 });
    ok((await labelOnServer()) === "· QQ Marks ·", "Save navigation writes it too", await labelOnServer());

    // an empty name takes the link out of the bar, saved from the bottom Save as well
    await field().fill("");
    await p.click("#save-settings");
    await p.waitForFunction(() => document.getElementById("settings-modal").hidden, null, { timeout: 8000 });
    ok(!(await labelOnServer()), "a blank name takes the link out of the bar", await labelOnServer());
    ok(errs.length === 0, "no page errors", errs);
    await ctx.close();
  } finally {
    await b.close();
  }
  console.log(fail ? `${fail} FAILED` : "ALL PASS");
  process.exit(fail ? 1 : 0);
})();
