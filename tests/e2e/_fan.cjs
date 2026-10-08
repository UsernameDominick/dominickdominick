// The Studio's secondary controls used to wait in a fan above the Rec hub; they are named switches in the display bar now (on a phone, beside
// Hold and Play over the keys), so a test can press them directly. The fan's own Stop, Undo, Redo and Clear were copies of buttons that are
// on screen anyway: a test that still names one of them is sent to that button.
const FAN = /^#studio-(fan-stop|volume|volume-btn|pop-volume|volume-out|metro|metro-on|metro-vol|metro-out|count-in|pop-metro|quant|quant-btn|pop-quant|follow|rec-top|fan-undo|fan-redo|fan-clear)\b/;
const MOVED = { "#studio-fan-stop": "#studio-stop", "#studio-fan-undo": "#studio-undo", "#studio-fan-redo": "#studio-redo", "#studio-fan-clear": "#studio-clear" };
function fanify(page) {
  page.__origClick = page.click.bind(page);
  for (const name of ["click", "tap", "check", "uncheck", "fill", "selectOption", "dispatchEvent", "hover"]) {
    const orig = page[name].bind(page);
    page[name] = async (sel, ...rest) => {
      if (typeof sel === "string") {
        for (const [from, to] of Object.entries(MOVED)) if (sel === from || sel.startsWith(from + ":") || sel.startsWith(from + " ")) sel = to + sel.slice(from.length);
      }
      return orig(sel, ...rest);
    };
  }
  return page;
}
module.exports = { fanify, FAN };
