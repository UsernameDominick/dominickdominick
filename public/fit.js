// makes the whole thing fill the screen. The page is laid out at its normal size (the boxes fill the width, and are a set
// height), and on a bigger monitor the whole page is scaled up evenly until it fills the height too, while the width it
// lays out in gets narrower to match, so it also fills the width. It's never scaled down: a small screen keeps the normal
// size and the boxes scroll sideways, as before. This loads first, so the scripts after it know how big the page is
// (uiScale) when they draw.

const DESIGN_MIN_WIDTH = 1200; // it won't be scaled up so far that it's laid out narrower than this
let uiScale = 1; // how many times bigger than normal the page is drawn right now
const uiParent = document.querySelector(".parent");

function fitScreen() {
    const width = document.documentElement.clientWidth;
    const height = window.innerHeight;

    // measure it at normal size, as wide as the window
    uiParent.style.transform = "none";
    uiParent.style.width = width + "px";
    uiParent.style.maxWidth = "none";
    uiParent.style.marginInline = "0";
    let scale = 1;
    // (the height changes a little with the width, so it's worked out twice)
    for (let pass = 0; pass < 2; pass++) {
        const natural = uiParent.offsetHeight;
        scale = Math.max(1, Math.min(height / natural, width / DESIGN_MIN_WIDTH));
        uiParent.style.width = width / scale + "px";
    }

    uiScale = scale > 1.005 ? scale : 1;
    document.documentElement.style.setProperty("--ui-scale", String(uiScale)); // (the css uses it to keep the popups on the screen)
    uiParent.style.transformOrigin = "0 0";
    uiParent.style.transform = uiScale === 1 ? "none" : "scale(" + uiScale + ")";
    if (uiScale === 1) uiParent.style.width = width + "px";
    // a scaled page still takes up its normal height in the layout, so the text under it (the about part) would be drawn
    // underneath it. This leaves room: the extra height it's drawn with
    uiParent.style.marginBottom = uiScale === 1 ? "" : uiParent.offsetHeight * (uiScale - 1) + "px";
}

let lastFit = "";
function refit() {
    fitScreen();
    // everything that draws itself (the scope, the graphs, the blocks) draws again at the new size
    const now = uiScale + "," + document.documentElement.clientWidth + "," + window.innerHeight;
    if (now !== lastFit) {
        lastFit = now;
        window.dispatchEvent(new Event("resize"));
    }
}

fitScreen();
window.addEventListener("load", refit);
window.addEventListener("resize", () => {
    // (the resize we send ourselves comes back here, it stops once nothing has changed)
    const before = uiScale;
    fitScreen();
    if (before !== uiScale) window.dispatchEvent(new Event("resize"));
});
document.fonts.ready.then(refit);
