const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require("fs");
const BASE = process.env.BASE || (E2E_BASE);
let failures = 0;
const ok = (c, m, e) => { if (!c) failures++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
const cookie = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE, "utf8")).cookies.map((c) => `${c.name}=${c.value}`).join("; ");
const api = async (path, method = "GET", body) => { const r = await fetch(`${BASE}/api/admin${path}`, { method, headers: { "Content-Type": "application/json", Cookie: cookie, Origin: BASE }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, body: j }; };
const row = (h) => Array.from({ length: 16 }, (_, i) => h.includes(i));
const songData = (t) => ({ tempo: t, kit: "acoustic", visualization: "bars", theme: "default", master_volume: 1, tracks: { kick: row([0, 4]), snare: row([2]), hihat: row([]), clap: row([]) }, melody: { waveform: "sine", notes: { C4: row([1]) } } });
(async () => {
  const stamp = Date.now();
  const songs = [];
  for (const n of ["QQps Track A", "QQps Track B"]) songs.push((await api("/songs", "POST", { name: n + " " + stamp, data: songData(110) })).body.id);
  const slug = "qqps-" + stamp;
  const body = "Synthetic project body for the related songs test, long enough to publish safely and pass the minimum length.";
  const created = await api("/projects", "POST", { slug, title: "QQps project " + stamp, summary: "s", body, published: true, related_songs: [songs[0]] });
  ok(created.status === 200 && created.body.id, "a project can be created with related songs", created);
  const pid = created.body.id;
  let proj = (await api("/projects")).body.find((p) => p.id === pid);
  ok(JSON.stringify(proj.related_songs) === JSON.stringify([songs[0]]), "...and lists them", proj.related_songs);
  await api(`/projects/${pid}`, "PATCH", { related_songs: [songs[0], songs[1], String(songs[1]), songs[0]], expected_version: proj.version });
  proj = (await api("/projects")).body.find((p) => p.id === pid);
  ok(JSON.stringify(proj.related_songs) === JSON.stringify([songs[0], songs[1]]), "an update stores valid song ids once each (junk is a 400, see test_project_songs2)", proj.related_songs);
  const pub = await fetch(`${BASE}/projects/${slug}`).then((r) => r.text());
  ok(/class="song-embed/.test(pub) && pub.includes("QQps Track A") && pub.includes("QQps Track B"), "the public project page shows both songs as playable embeds");
  ok(/song-embed\.js/.test(pub) && /song-engine\.js/.test(pub), "...with the song scripts loaded");
  ok((pub.match(/class="song-embed"/g) || []).length === 2, "...one embed per song", (pub.match(/class="song-embed"/g) || []).length);
  const usage = (await api(`/content-usage?type=song&id=${songs[1]}`)).body;
  ok(Array.isArray(usage) && usage.some((u) => /Project/.test(u.type) && u.title.startsWith("QQps project")), "a song used by a project shows that in its usage check", usage);
  const exp = (await api("/export")).body;
  const ep = exp && exp.projects && exp.projects.find((p) => p.id === pid);
  ok(ep && JSON.parse(ep.related_songs).length === 2, "the backup export carries related_songs", ep && ep.related_songs);
  // deleting a song leaves the page rendering (dangling id skipped) and health lists it
  await api(`/songs/${songs[1]}`, "DELETE");
  const pub2 = await fetch(`${BASE}/projects/${slug}`).then((r) => r);
  ok(pub2.status === 200 && (await pub2.text()).includes("QQps Track A"), "a deleted song is skipped on the public page without breaking it");
  // admin UI round trip
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1400, height: 1000 } });
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(String(e))); page.on("dialog", (d) => d.accept());
  await page.goto(`${BASE}/admin/`); await page.waitForSelector("#app:not([hidden])");
  await page.evaluate(() => document.getElementById("projects-btn").click());
  await page.waitForSelector("#projects-modal:not([hidden])"); await page.waitForTimeout(700);
  const song3 = (await api("/songs", "POST", { name: "QQps Track C " + stamp, data: songData(90) })).body.id;
  songs.push(song3);
  await page.evaluate(() => window.refreshSongOptions && window.refreshSongOptions()); await page.waitForTimeout(600);
  await page.evaluate(() => document.getElementById("projects-btn").click()); await page.waitForTimeout(700);
  const opened = await page.evaluate((title) => { const btn = [...document.querySelectorAll("#projects-list button, #projects-list .project-row, #projects-list [data-id]")].find((b) => b.textContent.includes(title) || (b.closest(".simulation-row, .project-row, li") || {}).textContent?.includes(title)); if (!btn) return null; btn.click(); return true; }, "QQps project");
  await page.waitForTimeout(800);
  const optionTexts = await page.$$eval("#project-related-songs option", (o) => o.map((x) => x.textContent));
  ok(optionTexts.some((t) => t.startsWith("QQps Track A")) && optionTexts.some((t) => t.startsWith("QQps Track C")), "the editor's Related songs list offers the songs", { opened, optionTexts: optionTexts.filter((t) => t.startsWith("QQps")) });
  const selected = await page.$$eval("#project-related-songs option:checked", (o) => o.map((x) => x.textContent));
  ok(selected.some((t) => t.startsWith("QQps Track A")), "...and shows the ones already chosen", selected);
  await page.evaluate(() => { const d = document.getElementById("project-related-songs").closest("details"); if (d) d.open = true; });
  await page.selectOption("#project-related-songs", [String(songs[0]), String(song3)]);
  await page.evaluate(() => document.getElementById("project-related-songs").dispatchEvent(new Event("change", { bubbles: true })));
  await page.waitForTimeout(3200); // autosave
  proj = (await api("/projects")).body.find((p) => p.id === pid);
  ok(JSON.stringify(proj.related_songs) === JSON.stringify([songs[0], song3]), "choosing songs in the editor saves them", proj.related_songs);
  ok(errs.length === 0, "no page errors", errs);
  await browser.close();
  // cleanup
  for (let attempt = 0; attempt < 3; attempt++) {
    await new Promise((r) => setTimeout(r, 1200));
    const d1 = await api(`/projects/${pid}`, "DELETE"); const d2 = await api(`/projects/${pid}/permanent`, "DELETE");
    if (attempt === 0) console.log("cleanup project", d1.status, d2.status);
    for (const id of songs) await api(`/songs/${id}`, "DELETE");
    const rest = (await api("/songs")).body.filter((x) => x.name.startsWith("QQps"));
    const restP = (await api("/projects")).body.filter((p) => p.title.startsWith("QQps"));
    if (!rest.length && !restP.length) break;
  }
  const left = (await api("/songs")).body.filter((s) => s.name.startsWith("QQps"));
  const leftP = (await api("/projects")).body.filter((p) => p.title.startsWith("QQps"));
  ok(left.length === 0 && leftP.length === 0, "cleanup: nothing left", { left: left.length, leftP: leftP.length });
  console.log(failures ? `\n${failures} FAILURE(S)` : "\nALL PASS");
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.log("FAIL threw", e); process.exit(1); });
