// the settings buttons in the top box (SETTINGS and MIDI) all work the same way, so this does it for both.
// A button has a PANEL: the choices it lets you change. On a computer the panel is a little popup with an
// arrow pointing at the button. On a phone (a narrow screen) the whole dials box flips over to show the
// panel on its back, and the x on the far left flips it back. The popup closes when you click anywhere
// else or press Escape, and the back flips over again with the x or Escape.

const flipBox = document.querySelector(".div5"); // the box that flips (the dials box, on a phone)
const frontFace = flipBox.querySelector(".front");
const backFace = flipBox.querySelector(".back");
const phoneScreen = window.matchMedia("(max-width: 700px)"); // narrower than this counts as a phone

const panels = {}; // every panel by name: { name, button, popover, closeButton, onOpen }

// sets up a panel. button opens it, popover is its popup, closeButton is the x on its side of the back of
// the box, and onOpen (if there is one) runs each time it's opened, just before it shows (on a click, so it can
// ask for permissions or fill the popup in). options is optional: popupOnly is for a panel with no back to the box
// (the metronome, the step sequencer), it's a popup on a phone too, so it has no x and closeButton can be null. And
// anchor is a function that gives the element the popup points at, if that isn't the button (the step sequencer
// points at its block)
function registerPanel(name, button, popover, closeButton, onOpen, options = {}) {
    panels[name] = { name, button, popover, closeButton, onOpen, popupOnly: options.popupOnly, anchor: options.anchor };
    button.addEventListener("click", () => togglePanel(name));
    if (closeButton) closeButton.addEventListener("click", () => setFlipped(false, true, name));
}

// is this panel showing right now, as a popup or on the back of the box?
function isPanelOpen(name) {
    return !panels[name].popover.hidden || (flipBox.classList.contains("flipped") && backFace.dataset.panel === name);
}

function togglePanel(name) {
    const panel = panels[name];
    if (phoneScreen.matches && !panel.popupOnly) {
        // on a phone: flip to this panel. (If it's already showing flip back. If the other panel is showing, switch to this one)
        const showing = flipBox.classList.contains("flipped") && backFace.dataset.panel === name;
        if (!showing && panel.onOpen) panel.onOpen();
        setFlipped(!showing, true, name);
    } else if (!panel.popover.hidden) {
        closePopover(name);
    } else {
        closePopovers(); // only one popup at a time
        if (panel.onOpen) panel.onOpen(); // before it shows, so it's the right size when it's put in place
        openPopover(name);
    }
}

// closes a panel if it's showing (the popup, or the back of the box)
function closePanel(name) {
    closePopover(name);
    if (flipBox.classList.contains("flipped") && backFace.dataset.panel === name) setFlipped(false, false, name);
}

// ---- the popup (computers) ----

// opens a popup above its button (or below it if there's no room above), with its arrow pointing at the button
function openPopover(name) {
    const { button, popover, anchor } = panels[name];
    popover.hidden = false;
    const gap = 14; // room for the arrow
    const rect = (anchor ? anchor() : button).getBoundingClientRect();
    const width = popover.offsetWidth;
    const height = popover.offsetHeight;

    const above = rect.top - height - gap >= 8;
    popover.classList.toggle("above", above);
    popover.classList.toggle("below", !above);

    // centered on the button, but never off the side of the screen
    const buttonMiddle = rect.left + rect.width / 2;
    const left = Math.max(8, Math.min(buttonMiddle - width / 2, window.innerWidth - width - 8));
    popover.style.left = left + "px";
    // (a tall popup is kept on the screen, so it may end up beside the button instead of right against it)
    const top = above ? rect.top - height - gap : rect.bottom + gap;
    popover.style.top = Math.max(8, Math.min(top, window.innerHeight - height - 8)) + "px";
    // the arrow stays over the button (but never right at the corner of the popup)
    popover.style.setProperty("--arrow-x", Math.max(20, Math.min(buttonMiddle - left, width - 20)) + "px");

    button.setAttribute("aria-expanded", "true");
    const chosen = popover.querySelector('[aria-pressed="true"]');
    if (chosen) chosen.focus();
}

function closePopover(name) {
    const { button, popover } = panels[name];
    if (popover.hidden) return;
    popover.hidden = true;
    button.setAttribute("aria-expanded", "false");
}

function closePopovers() {
    Object.keys(panels).forEach(closePopover);
}

// ---- the flip (phones) ----

// flips the box over to its back (true) or to its front (false), showing the named panel on the back.
// Whichever side isn't showing is made "inert", so you can't tab to buttons you can't see.
// moveFocus moves the keyboard focus (to the x when flipping over, to the button when flipping back)
function setFlipped(flipped, moveFocus, name) {
    if (flipped) backFace.dataset.panel = name; // CSS shows only this panel's side of the back
    flipBox.classList.toggle("flipped", flipped);
    frontFace.inert = flipped;
    backFace.inert = !flipped;
    Object.values(panels).forEach((panel) => {
        panel.button.setAttribute("aria-expanded", String(flipped && backFace.dataset.panel === panel.name));
    });
    if (moveFocus) (flipped ? panels[name].closeButton : panels[name].button).focus();
}

setFlipped(false, false, null); // start on the front

// ---- closing ----

// clicking anywhere else closes a popup (clicking its own button is handled by the button)
document.addEventListener("pointerdown", (e) => {
    Object.values(panels).forEach((panel) => {
        if (!panel.popover.hidden && !panel.popover.contains(e.target) && !panel.button.contains(e.target)) {
            closePopover(panel.name);
        }
    });
});

document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const open = Object.values(panels).find((panel) => !panel.popover.hidden);
    if (open) {
        closePopover(open.name);
        open.button.focus();
    } else if (flipBox.classList.contains("flipped")) {
        setFlipped(false, true, backFace.dataset.panel);
    }
});

// a popup that's open when the window is resized would be in the wrong place, so close it
window.addEventListener("resize", closePopovers);

// when the window changes between phone size and computer size, put everything back to normal.
// (This only runs when it crosses the line, not on every resize: a phone resizes a little whenever
// its address bar slides away, and that shouldn't flip the box back)
phoneScreen.addEventListener("change", () => {
    closePopovers();
    setFlipped(false, false, null);
});

// ---- choices ----

// fills one or more boxes with a button for each item (the popup has one box and the back of the dials box
// has another, and they always show the same choice). An item is a name, or { name, disabled: true } for
// a message that can't be chosen. Choosing one calls onChange with its place in the list. chosen is the place
// that's marked as chosen. It empties the boxes first, so it can be used again when the list changes
function fillChoices(boxes, items, chosen, onChange) {
    boxes.forEach((box) => {
        box.innerHTML = "";
        items.forEach((item, i) => {
            const button = document.createElement("button");
            button.className = "choice";
            button.textContent = typeof item === "string" ? item : item.name;
            button.setAttribute("aria-pressed", String(i === chosen));
            if (typeof item !== "string" && item.disabled) {
                button.disabled = true;
            } else {
                button.addEventListener("click", () => onChange(i));
            }
            box.appendChild(button);
        });
    });
}
