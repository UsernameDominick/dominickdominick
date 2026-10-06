// What the block bar (the pill bar under a selected block in the page editor, app.js) shows: one chip per style setting the block has,
// its short wording, the size chip's name, the settings the + menu offers, and the block's main choice for the dropdown pill.
// Pure, so tests/block-bar.test.mjs can run it on its own.
(function () {
  // Short names for the chips (the inspector's labels are full sentences).
  var SHORT = {
    color: "Text colour", bg: "Background", fontFamily: "Font", fontSize: "Text size", textAlign: "Align", padding: "Padding",
    paddingStep: "Padding", shadow: "Shadow", opacity: "Opacity", borderWidth: "Border", borderColor: "Border colour",
    borderRadius: "Corners", backgroundImage: "Background image", gradientFrom: "Gradient", backgroundVideoUrl: "Background video",
    parallax: "Parallax", blendMode: "Blend", overlayColor: "Overlay", position: "Position", readingOrder: "Reading order",
    mobileColSpan: "Phone width", shapeMask: "Shape", animation: "Animation", hoverEffect: "Hover", visibility: "Show on",
    urlRule: "Address rule", visibleFrom: "Shown from", visibleUntil: "Shown until", customCss: "Custom CSS", hidden: "Hidden",
  };
  // Settings that only refine another one: they ride on that one's chip instead of getting their own (and its × clears them too).
  var FOLLOWS = {
    urlParam: "urlRule", animationDelay: "animation", customKeyframes: "animation", stickyOffset: "position", gradientTo: "gradientFrom",
    gradientAngle: "gradientFrom", overlayOpacity: "overlayColor", backgroundSize: "backgroundImage",
  };
  var UNITS = { fontSize: "px", padding: "px", borderWidth: "px", borderRadius: "px", opacity: "%" };
  // Where a select's value is the whole story, the chip is just that value ("Fade in", "Desktop only").
  var VALUE_ONLY = { animation: 1, visibility: 1, hoverEffect: 0, shadow: 0 };
  // The + menu: the settings people reach for, in this order; everything else is under "All settings".
  var ADD = ["bg", "color", "padding", "borderRadius", "shadow", "borderWidth", "textAlign", "fontFamily", "fontSize", "animation", "hoverEffect", "visibility", "backgroundImage", "hidden"];
  var SIZES = [[6, "¼"], [8, "⅓"], [12, "½"], [16, "⅔"], [24, "Full"]];

  function isSet(v) {
    if (v === null || v === undefined || v === "" || v === false) return false;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }
  // "Slide in from right" stays; "Sticky (stays in view while scrolling past it)" becomes "Sticky".
  function optionText(field, value) {
    var opts = (field && field.options) || [];
    for (var i = 0; i < opts.length; i++) if (String(opts[i][0]) === String(value)) return String(opts[i][1]).replace(/…$/, "").replace(/\s*\(.*\)\s*$/, "");
    return String(value);
  }
  function sizeLabel(span) {
    for (var i = 0; i < SIZES.length; i++) if (SIZES[i][0] === span) return SIZES[i][1];
    return span + "/24";
  }
  function chip(key, value, field) {
    var name = SHORT[key] || (field && field.label) || key;
    var type = field && field.type;
    if (type === "checkbox") return { key: key, text: name };
    if (type === "color") return { key: key, text: name, swatch: String(value) };
    if (type === "select") {
      var v = optionText(field, value);
      return { key: key, text: VALUE_ONLY[key] ? v : name + " · " + v };
    }
    if (type === "number") return { key: key, text: name + " " + value + (UNITS[key] || "") };
    if (type === "datetime-local") return { key: key, text: name + " " + String(value).replace("T", " ").slice(0, 16) };
    return { key: key, text: name }; // a picture, a video address, custom CSS: the name says enough
  }
  // One chip per setting the block has, in the inspector's own order. `fields` is the inspector's STYLE_FIELDS.
  function chipsFor(style, fields) {
    style = style || {};
    var out = [];
    (fields || []).forEach(function (f) {
      if (FOLLOWS[f.key] || !isSet(style[f.key])) return;
      out.push(chip(f.key, style[f.key], f));
    });
    return out;
  }
  // The keys a chip's × clears: its own and the ones that ride on it.
  function keysOf(key) {
    var keys = [key];
    Object.keys(FOLLOWS).forEach(function (k) { if (FOLLOWS[k] === key) keys.push(k); });
    return keys;
  }
  // The + menu: the common settings this block does not have yet.
  function addable(style, fields) {
    style = style || {};
    var byKey = {};
    (fields || []).forEach(function (f) { byKey[f.key] = f; });
    return ADD.filter(function (k) { return byKey[k] && !isSet(style[k]); }).map(function (k) { return { key: k, text: SHORT[k] || byKey[k].label }; });
  }
  // The dropdown pill: the block's first choice-list field (a heading's level, a button's look), with what it is set to now.
  function mainChoice(fieldDefs, content) {
    var f = (fieldDefs || []).filter(function (x) { return x.type === "select" && x.options && x.options.length > 1; })[0];
    if (!f) return null;
    var value = content && content[f.key] !== undefined && content[f.key] !== null ? content[f.key] : f.options[0][0];
    return { key: f.key, label: f.label, value: String(value), text: optionText(f, value), options: f.options.map(function (o) { return { value: String(o[0]), text: String(o[1]) }; }) };
  }
  var api = { SHORT: SHORT, FOLLOWS: FOLLOWS, SIZES: SIZES, isSet: isSet, sizeLabel: sizeLabel, chipsFor: chipsFor, keysOf: keysOf, addable: addable, mainChoice: mainChoice, optionText: optionText };
  if (typeof window !== "undefined") window.BlockBarModel = api;
})();
