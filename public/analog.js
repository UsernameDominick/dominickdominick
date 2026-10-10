// ANALOG KEYBOARD. A keyboard with analog keys (a Wooting, which senses how far down each key is, not just whether it's down) can
// play the piano keys of the computer keyboard (keyboard.js) with feeling:
//   - a note starts when a key has gone down only a little way (about 5%), so a light touch plays
//   - how hard the note is (its velocity) comes from how fast the key went down: a slow press is soft, a quick stab is loud
//   - while the note is held, how far down the key is (KEY DEPTH, chosen in the MIDI popup) can move it, like pressure
//   - it's let go when the key comes back up
// A browser can't see how far down a key is by itself. This uses WebHID, which lets a page read a device that isn't a normal
// keyboard or mouse (Chrome and Edge have it, Firefox and Safari don't), and reads the analog interface a Wooting keyboard has (the
// one its own software reads). Press CONNECT AN ANALOG KEYBOARD in the MIDI popup once and pick the keyboard. Without it, or
// without WebHID, the keyboard plays notes as normal (every note at full strength), as before. It uses keyboard.js and synth.js.

const ANALOG_VENDORS = [0x03eb, 0x31e3]; // Wooting's vendor numbers
const ANALOG_USAGE_PAGE = 0xff54; // the analog part of the keyboard (not the part that types)
const ANALOG_ON = 12; // how far down a key (0 to 255) starts a note
const ANALOG_OFF = 6; // and a note is let go below this (a bit lower, so a key that wobbles doesn't stutter)
const ANALOG_FAST = 25; // key travels (whole presses) a second that count as the hardest hit

const analogConnect = document.getElementById("analogConnect");
const analogStatus = document.getElementById("analogStatus");

// the key (by KeyboardEvent.code) for a key number in the keyboard's reports (the numbers HID keyboards use), if it plays a note
function codeForUsage(usage) {
    if (usage >= 0x04 && usage <= 0x1d) return "Key" + String.fromCharCode(65 + usage - 0x04);
    if (usage >= 0x1e && usage <= 0x26) return "Digit" + (usage - 0x1d);
    if (usage === 0x27) return "Digit0";
    return null;
}

const analogKeys = new Map(); // each key's code -> { depth, down, startTime }
let analogDevice = null; // the keyboard we're reading, or null
let analogReports = 0; // how many reports have come
let analogLast = null; // the last key that moved: { code, depth }
let lastReportTime = 0;
let modifiers = { shift: false, ctrl: false, alt: false }; // the modifier keys, from the ordinary key events

function noteModifiers(e) {
    modifiers = { shift: e.shiftKey, ctrl: e.ctrlKey || e.metaKey, alt: e.altKey };
}
window.addEventListener("keydown", noteModifiers, true);
window.addEventListener("keyup", noteModifiers, true);

// is it right for a key press to play a note now? (not when the page is in the background, or a shortcut like Ctrl+C or Shift+R is
// being pressed, or you're typing in a box or using a popup)
function analogMayPlay(code) {
    if (!document.hasFocus() || document.body.inert) return false;
    if (modifiers.ctrl || modifiers.alt || (modifiers.shift && KB_SHORTCUT_LETTERS.includes(code))) return false;
    const active = document.activeElement;
    return !(typingInText(active) || (active instanceof Element && active.closest(".popover")));
}

// how hard the note is: from how fast the key went down (how far it had gone and how long it took). A press that takes about 0.04s
// from top to bottom is the hardest, a slow press (a third of a second) is soft
function analogVelocity(key, depth, now) {
    const seconds = Math.max(0.001, (now - key.startTime) / 1000);
    const speed = depth / 255 / seconds;
    return Math.min(1, Math.max(0.18, (speed / ANALOG_FAST) ** 0.6));
}

// one key's new depth (0 is up, 255 is all the way down)
function analogKey(code, depth, now) {
    let key = analogKeys.get(code);
    if (!key) analogKeys.set(code, (key = { depth: 0, down: false, startTime: 0 }));
    if (key.depth === 0 && depth > 0) key.startTime = lastReportTime || now; // (it has just left the top, as of the report before this one)
    key.depth = depth;
    analogLast = { code, depth };
    const id = "kb" + code;

    if (!key.down && depth >= ANALOG_ON) {
        key.down = true;
        const note = keyboardNote(code);
        if (note !== null && analogMayPlay(code) && !heldKeys.has(id)) pressKey(id, note, analogVelocity(key, depth, now));
    } else if (key.down && depth <= ANALOG_OFF) {
        key.down = false;
        if (heldKeys.has(id)) releaseKey(id);
    }
    if (key.down && heldKeys.has(id)) setKeyDepth(id, Math.max(0, Math.min(1, (depth - ANALOG_ON) / (255 - ANALOG_ON))));
}

// a report from the keyboard: a list of the keys that are down, three numbers for each (the keyboard's own, the key, how far down).
// A key that isn't in the list is up
function handleAnalogReport(data, now = performance.now()) {
    analogReports++;
    const listed = new Set();
    for (let i = 0; i + 2 < data.byteLength; i += 3) {
        const usage = data.getUint8(i + 1);
        if (usage === 0) break; // (the end of the list)
        const code = codeForUsage(usage);
        if (!code) continue;
        listed.add(code);
        analogKey(code, data.getUint8(i + 2), now);
    }
    analogKeys.forEach((key, code) => {
        if (!listed.has(code) && key.depth > 0) analogKey(code, 0, now);
    });
    lastReportTime = now;
    showAnalogStatus();
}

// ---- connecting ----

let statusTimer = 0;
let connectedAt = 0;

function showAnalogStatus() {
    clearTimeout(statusTimer);
    let text;
    if (!("hid" in navigator)) {
        text = "This browser can't read analog keys (Chrome and Edge can). The keyboard still plays notes, all at full strength.";
    } else if (!analogDevice) {
        text = "Not connected. With a Wooting keyboard, press the button and pick it. Soft presses then play soft notes.";
    } else if (analogReports === 0) {
        text = "Connected to " + analogDevice.productName + ". Press a piano key (Z, X, C...) gently.";
        if (performance.now() - connectedAt > 8000) text += " No analog data has come from the keyboard yet.";
        statusTimer = setTimeout(showAnalogStatus, 2000);
    } else {
        const last = analogLast ? " Last key: " + analogLast.code.replace("Key", "").replace("Digit", "") + ", " + Math.round((analogLast.depth / 255) * 100) + "% down." : "";
        text = "Connected to " + analogDevice.productName + "." + last;
    }
    if (analogStatus.textContent !== text) analogStatus.textContent = text;
}

// starts reading a keyboard
async function useAnalogDevice(device) {
    if (analogDevice === device) return;
    try {
        if (!device.opened) await device.open();
    } catch (err) {
        analogStatus.textContent = "Could not open the keyboard: " + err.message;
        return;
    }
    analogDevice = device;
    analogReports = 0;
    analogLast = null;
    connectedAt = performance.now();
    device.addEventListener("inputreport", (e) => handleAnalogReport(e.data));
    showAnalogStatus();
}

// a keyboard that has this page's permission already (so there's no need to ask again)
function isAnalogKeyboard(device) {
    return ANALOG_VENDORS.includes(device.vendorId) && device.collections.some((c) => c.usagePage === ANALOG_USAGE_PAGE);
}

analogConnect.addEventListener("click", async () => {
    if (!("hid" in navigator)) return showAnalogStatus();
    try {
        const devices = await navigator.hid.requestDevice({ filters: ANALOG_VENDORS.map((vendorId) => ({ vendorId, usagePage: ANALOG_USAGE_PAGE })) });
        if (devices.length) await useAnalogDevice(devices[0]);
        else analogStatus.textContent = "No keyboard was picked.";
    } catch (err) {
        analogStatus.textContent = "Could not connect: " + err.message;
    }
});

if ("hid" in navigator) {
    navigator.hid.getDevices().then((devices) => {
        const known = devices.find(isAnalogKeyboard);
        if (known) useAnalogDevice(known);
    }).catch(() => {});
    navigator.hid.addEventListener("disconnect", (e) => {
        if (e.device === analogDevice) {
            analogDevice = null;
            analogKeys.forEach((key, code) => key.down && heldKeys.has("kb" + code) && releaseKey("kb" + code));
            analogKeys.clear();
            showAnalogStatus();
        }
    });
}
showAnalogStatus();
