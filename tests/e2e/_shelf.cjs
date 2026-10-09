// The Studio opens straight into an empty song, so a test that wants the shelf goes there through the editor's back button (a screen
// under 1280 px wide; wider, the Songs panel stands in for the shelf and the back button is not shown).
const APPS = {
  studio: { editor: "#song-builder-modal", close: "#studio-close", shelf: ".studio-shelf" },
};
async function toShelf(page, app) {
  const a = APPS[app];
  await page.waitForSelector(a.editor + ":not([hidden])", { timeout: 30000 });
  await page.waitForTimeout(300);
  await page.click(a.close);
  await page.waitForSelector(a.shelf + ":not([hidden])", { timeout: 15000 });
}
module.exports = { toShelf };
