const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { chromium } = require("./_pw.cjs");
const fs = require('fs');
const BASE = (E2E_BASE);
const stored = JSON.parse(fs.readFileSync(process.env.ADMIN_STATE));
const SESSION = stored.cookies[0].value;

function assert(cond, msg) { if (!cond) throw new Error('ASSERTION FAILED: ' + msg); console.log('PASS:', msg); }

async function api(path, opts = {}) {
  const res = await fetch(BASE + '/api/admin' + path, { ...opts, headers: { 'Content-Type': 'application/json', Cookie: `session=${SESSION}`, ...(opts.headers || {}) } });
  const text = await res.text();
  let body; try { body = JSON.parse(text); } catch { body = text; }
  return { status: res.status, body };
}

(async () => {
  let pageId, blockId;
  const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium-1194/chrome-linux/chrome', args: ['--no-sandbox', '--no-proxy-server'] });
  try {
    let r = await api('/pages', { method: 'POST', body: JSON.stringify({ title: 'R3 A11y Page ' + Date.now() }) });
    pageId = r.body.id;
    const pages = (await api('/pages')).body;
    const slug = pages.find(p => p.id === pageId).slug;

    r = await api(`/pages/${pageId}/blocks`, { method: 'POST', body: JSON.stringify({
      type: 'heading', content: { text: 'Anim Block' },
      style: { customKeyframes: [{ offset: 0, opacity: 0 }, { offset: 100, opacity: 1 }], animation: 'custom', animationDuration: 500 },
      col: 1, row: 1,
    }) });
    blockId = r.body.id;

    const context = await browser.newContext();
    const page = await context.newPage();
    // Set manual motion toggle via localStorage before load, matching nav.js's own read-back
    await page.addInitScript(() => { try { localStorage.setItem('motion', 'reduce'); } catch (e) {} });
    // Need nav.js to actually apply data-motion from localStorage on load -- check if it does
    await page.goto(`${BASE}/${slug}`, { waitUntil: 'networkidle' });

    const dataMotion = await page.evaluate(() => document.documentElement.getAttribute('data-motion'));
    console.log('data-motion attr after load with localStorage motion=reduce:', dataMotion);

    if (dataMotion !== 'reduce') {
      // nav.js might not auto-apply from storage on load; click the toggle instead.
      await page.click('#finder-open'); // the setting lives in the finder
      await page.click('#motion-toggle');
      await page.keyboard.press('Escape');
      await page.waitForTimeout(100);
    }
    const dataMotion2 = await page.evaluate(() => document.documentElement.getAttribute('data-motion'));
    assert(dataMotion2 === 'reduce', 'manual motion toggle is now ON (data-motion=reduce)');

    // Reload fresh to check IMMEDIATE post-load state
    await page.reload({ waitUntil: 'networkidle' });
    const dm3 = await page.evaluate(() => document.documentElement.getAttribute('data-motion'));
    console.log('data-motion after reload:', dm3);

    const style = await page.evaluate(() => {
      const el = document.querySelector('[data-animate]');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { opacity: cs.opacity, animationName: cs.animationName, hasIsVisible: el.classList.contains('is-visible') };
    });
    console.log('Custom-animated element computed style right after fresh load w/ manual reduce-motion:', style);
    assert(style !== null, 'found a [data-animate] element on the page');
    assert(style.opacity === '1', 'opacity is 1 (not mid-animation) immediately after load with manual reduce-motion');
    assert(style.animationName === 'none', 'animationName is none (animation not running) immediately after load with manual reduce-motion');

    // Now confirm normal (non-reduced) playback still works: turn toggle back off
    await page.click('#finder-open');
    await page.click('#motion-toggle');
    await page.waitForTimeout(50);
    const dmOff = await page.evaluate(() => document.documentElement.getAttribute('data-motion'));
    assert(dmOff === null || dmOff === '', 'motion toggle turned back off (data-motion removed)');

    console.log('\n=== A11Y RE-VERIFICATION PASSED ===');
  } catch (err) {
    console.error('=== A11Y TEST FAILED ===', err);
    process.exitCode = 1;
  } finally {
    await browser.close();
    if (pageId) {
      const del = await api(`/pages/${pageId}`, { method: 'DELETE' });
      const perm = await api(`/pages/${pageId}/permanent`, { method: 'DELETE' });
      const check = await api(`/pages`);
      console.log('Cleanup ok, still present?', !!check.body.find(p => p.id === pageId));
    }
  }
})();
