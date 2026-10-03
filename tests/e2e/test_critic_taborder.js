const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const BASE = (E2E_BASE);

async function main() {
  const fs = require("fs");
  const state = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE, "utf8"));
  const cookie = state.cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  const api = async (path, opts = {}) => {
    const res = await fetch(`${BASE}/api/admin${path}`, { ...opts, headers: { "Content-Type": "application/json", Cookie: cookie, ...(opts.headers || {}) } });
    if (!res.ok) throw new Error(`${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
  };
  const { id: songId } = await api("/songs", { method: "POST", body: JSON.stringify({ name: "TabOrderTest-" + Date.now() }) });
  const browser = await chromium.launch({ executablePath: "/opt/pw-browsers/chromium-1194/chrome-linux/chrome" });
  const ctx = await browser.newContext({ storageState: process.env.ADMIN_STATE, viewport: { width: 1440, height: 1200 } });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/admin/`);
  await page.waitForSelector("#app:not([hidden])");
  await page.evaluate(() => document.getElementById("songs-btn").click());
  await page.waitForSelector("#songs-modal:not([hidden])");
  await page.waitForTimeout(300);
  await page.evaluate((id) => document.querySelector(`.edit-song[data-id="${id}"]`).click(), songId);
  await page.waitForSelector("#song-builder-modal:not([hidden])");
  await page.waitForTimeout(500);

  // Focus the last step of row 1 (B4, index0), then tab and see what we land on.
  await page.evaluate(() => {
    const row0 = document.querySelectorAll("#song-piano-roll .song-track-row")[0];
    row0.querySelectorAll(".song-step")[15].focus();
  });
  const seq = [];
  for (let i = 0; i < 3; i++) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => ({
      tag: document.activeElement.tagName,
      cls: document.activeElement.className,
      row: document.activeElement.closest(".song-track-row") ? document.activeElement.closest(".song-track-row").querySelector(".song-steps").dataset.row : null,
    }));
    seq.push(info);
  }
  console.log("Tab sequence after last step of row0 (B4):", JSON.stringify(seq, null, 2));

  await browser.close();
  await api(`/songs/${songId}`, { method: "DELETE" });
}
main().catch((e) => { console.error(e); process.exit(1); });
