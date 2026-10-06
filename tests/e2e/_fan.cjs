// The Studio keeps its secondary controls (volume, metronome, undo, redo, stop, clear, quantize, follow...) in a fan that opens above the Rec hub. A test that
// clicks one of them goes through here: the fan is opened first when it is closed, the way a person would.
const FAN = /^#studio-(fan-stop|volume|volume-btn|pop-volume|volume-out|metro|metro-on|metro-vol|metro-out|count-in|pop-metro|quant|quant-btn|pop-quant|follow|rec-top|fan-undo|fan-redo|fan-clear)\b/;
function fanify(page) {
  const open = async (sel) => {
    if (typeof sel !== "string" || !FAN.test(sel)) return;
    const isOpen = await page.evaluate(() => { const f = document.getElementById("studio-fan"); return !!f && !f.hidden; });
    if (!isOpen) {
      const orig = page.__origClick || page.click.bind(page);
      await orig("#studio-fan-btn");
      await page.waitForTimeout(350);
    }
  };
  page.__origClick = page.click.bind(page);
  for (const name of ["click", "tap", "check", "uncheck", "fill", "selectOption", "dispatchEvent", "hover"]) {
    const orig = page[name].bind(page);
    page[name] = async (sel, ...rest) => { await open(sel); return orig(sel, ...rest); };
  }
  return page;
}
module.exports = { fanify, FAN };
