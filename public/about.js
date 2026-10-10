// the i button at the right of the top box opens a popup about the page: what it is and what it can do. The words are in
// index.html (inside the popup, so they're in the page for search engines even when it's closed). This only opens and
// closes it, the same way as the other popups (panels.js).

registerPanel("info", document.getElementById("infoButton"), document.getElementById("infoPopover"), null, null, { popupOnly: true }); // a popup on a phone too
