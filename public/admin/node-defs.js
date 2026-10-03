// The node types of the Nodes editor (Scripts window). Each one says what pins it has and what JavaScript it turns into, using the
// same `site.*` helpers a hand-written script uses (see node-compiler.js for how a graph is put together). Pure data and string
// building, no page access, so a node test can load it.
(function () {
  const lit = (v) => JSON.stringify(v);
  const indent = (lines) => lines.map((l) => (typeof l === "string" ? "  " + l : { ...l, text: "  " + l.text }));

  // Settings a node can set. [key, what it is, an example value].
  const SETTING_KEYS = [
    ["theme_accent", "Accent colour", "#ff7a45"],
    ["theme_bg", "Background colour", "#0c0a16"],
    ["theme_text", "Text colour", "#f4eefc"],
    ["theme_border", "Border colour", "#2a2438"],
    ["theme_font", "Body font", "sans"],
    ["theme_heading_font", "Heading font", "serif"],
    ["control_shape", "Button shape", "pill, rounded, soft or square"],
    ["control_size", "Button size", "compact, regular or roomy"],
    ["control_outline", "Button outline", "thin or bold"],
    ["field_shape", "Field shape", "rounded, soft or square"],
    ["card_shape", "Card shape", "rounded, soft or square"],
    ["space_scale", "Spacing scale", "compact, regular or roomy"],
    ["shadow_strength", "Shadow strength", "none, soft or strong"],
    ["mobile_breakpoint", "Mobile breakpoint (px)", "720"],
  ];

  // Block style fields a node can set. [key, label, numeric?]
  const STYLE_KEYS = [
    ["color", "Text colour", false],
    ["bg", "Background colour", false],
    ["fontFamily", "Font", false],
    ["fontSize", "Font size (px)", true],
    ["textAlign", "Text align", false],
    ["padding", "Padding (px)", true],
    ["shadow", "Shadow", false],
    ["opacity", "Opacity", true],
    ["borderWidth", "Border width (px)", true],
    ["borderColor", "Border colour", false],
    ["borderRadius", "Corner radius (px)", true],
    ["hoverEffect", "Hover effect", false],
    ["animation", "Animation", false],
    ["customCss", "Custom CSS", false],
  ];
  const NUMERIC_STYLE = new Set(STYLE_KEYS.filter((k) => k[2]).map((k) => k[0]));

  const select = (pairs) => pairs.map(([value, label]) => ({ value, label }));
  const OPERATORS = [
    ["equals", "is"],
    ["not-equals", "is not"],
    ["contains", "contains"],
    ["starts-with", "starts with"],
    ["empty", "is empty"],
    ["not-empty", "is not empty"],
  ];

  // Which comparison a Filter node makes on one field of each item.
  function filterTest(field, operator, valueExpr) {
    const got = field ? `String((x == null ? undefined : x[${lit(field)}]) ?? "")` : 'String(x ?? "")';
    switch (operator) {
      case "not-equals":
        return `${got} !== String(${valueExpr})`;
      case "contains":
        return `${got}.toLowerCase().includes(String(${valueExpr}).toLowerCase())`;
      case "starts-with":
        return `${got}.toLowerCase().startsWith(String(${valueExpr}).toLowerCase())`;
      case "empty":
        return `!${got}.trim()`;
      case "not-empty":
        return `!!${got}.trim()`;
      default:
        return `${got} === String(${valueExpr})`;
    }
  }

  // Pin types: flow (the order things happen in) and the kinds of value. "any" fits anywhere.
  const TYPE_LABELS = { flow: "flow", any: "anything", text: "text", number: "number", bool: "yes/no", list: "list", object: "item" };

  // inputs/outputs: [{ id, label, type, required?, value?, multiline? }]. required = must be wired (there is no sensible typed-in value).
  // props: [{ id, label, control: "select"|"text"|"textarea"|"number", options?, value }] settings that sit on the node itself.
  // Exec nodes (flowIn/flowOuts) run in order and write `emit(ctx)`; pure nodes have one output and write `expr(ctx)`.
  const NODES = {
    start: {
      title: "Start",
      category: "Flow",
      help: "Where the script begins. Connect its flow pin to the first step.",
      flowIn: false,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [],
      outputs: [],
      props: [],
      emit: () => [],
    },
    branch: {
      title: "Branch",
      category: "Flow",
      help: "Do one thing if the condition is yes and another if it is no.",
      flowIn: true,
      flowOuts: [
        { id: "true", label: "Yes" },
        { id: "false", label: "No" },
      ],
      continueAfter: null,
      inputs: [{ id: "condition", label: "Condition", type: "bool", required: true }],
      outputs: [],
      props: [],
      emit: ({ in: i, block }) => {
        const yes = block("true");
        const no = block("false");
        const out = [`if (${i.condition}) {`, ...indent(yes)];
        if (no.length) out.push("} else {", ...indent(no));
        out.push("}");
        return out;
      },
    },
    "for-each": {
      title: "For each",
      category: "Flow",
      help: "Run the steps in Each once for every item in a list, then carry on from Done.",
      flowIn: true,
      flowOuts: [
        { id: "body", label: "Each" },
        { id: "done", label: "Done" },
      ],
      continueAfter: "done",
      scoped: { body: ["item", "index"] },
      inputs: [{ id: "list", label: "List", type: "list", required: true }],
      outputs: [
        { id: "item", label: "Item", type: "object" },
        { id: "index", label: "Number", type: "number" },
      ],
      props: [],
      emit: ({ in: i, out, block }) => [`for (const [${out.index}, ${out.item}] of Array.from(${i.list} || []).entries()) {`, ...indent(block("body")), "}"],
    },
    print: {
      title: "Print",
      category: "Flow",
      help: "Show a value in the Output box.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [{ id: "value", label: "Value", type: "any", value: "" }],
      outputs: [],
      props: [],
      emit: ({ in: i }) => [`console.log(${i.value});`],
    },

    // ---- reading the site
    "get-pages": {
      title: "Get pages",
      category: "Site",
      help: "Every page on the site.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [],
      outputs: [{ id: "pages", label: "Pages", type: "list" }],
      props: [],
      emit: ({ out }) => [`const ${out.pages} = await site.pages.list();`],
    },
    "get-blocks": {
      title: "Get blocks",
      category: "Site",
      help: "The blocks on one page.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [{ id: "page", label: "Page", type: "object", required: true }],
      outputs: [{ id: "blocks", label: "Blocks", type: "list" }],
      props: [],
      emit: ({ in: i, out }) => [`const ${out.blocks} = await site.pages.blocks(${i.page});`],
    },
    "get-settings": {
      title: "Get settings",
      category: "Site",
      help: "The site settings (colours, fonts, shapes...).",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [],
      outputs: [{ id: "settings", label: "Settings", type: "object" }],
      props: [],
      emit: ({ out }) => [`const ${out.settings} = await site.settings.get();`],
    },

    // ---- CSS
    "get-page-css": {
      title: "Get page CSS",
      category: "CSS",
      help: "The CSS written for one page.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [{ id: "page", label: "Page", type: "object", required: true }],
      outputs: [{ id: "css", label: "CSS", type: "text" }],
      props: [],
      emit: ({ in: i, out }) => [`const ${out.css} = await site.pages.css(${i.page});`],
    },
    "set-page-css": {
      title: "Set page CSS",
      category: "CSS",
      help: "Replace one page's CSS with this text.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [
        { id: "page", label: "Page", type: "object", required: true },
        { id: "css", label: "CSS", type: "text", value: "", multiline: true },
      ],
      outputs: [],
      props: [],
      emit: ({ in: i }) => [`await site.pages.setCss(${i.page}, ${i.css});`],
    },
    "css-rule": {
      title: "CSS rule",
      category: "CSS",
      help: "Lay out one rule: a selector and its declarations, like 'color: red; margin: 0'.",
      inputs: [
        { id: "selector", label: "Selector", type: "text", value: ".button" },
        { id: "declarations", label: "Declarations", type: "text", value: "color: #ff7a45;", multiline: true },
      ],
      outputs: [{ id: "value", label: "Rule", type: "text" }],
      props: [],
      expr: ({ in: i }) => `site.css.rule(${i.selector}, ${i.declarations})`,
    },
    "add-css-rule": {
      title: "Add rule to CSS",
      category: "CSS",
      help: "Put a rule at the end of some CSS. If it is already there, nothing changes, so it is safe to run twice.",
      inputs: [
        { id: "css", label: "CSS", type: "text", value: "", multiline: true },
        { id: "rule", label: "Rule", type: "text", value: "", multiline: true },
      ],
      outputs: [{ id: "value", label: "CSS", type: "text" }],
      props: [],
      expr: ({ in: i }) => `site.css.append(${i.css}, ${i.rule})`,
    },
    "replace-text": {
      title: "Replace text",
      category: "CSS",
      help: "Swap every copy of one piece of text for another: a colour, a font name, a size.",
      inputs: [
        { id: "text", label: "Text", type: "text", value: "", multiline: true },
        { id: "find", label: "Find", type: "text", value: "#ff7a45" },
        { id: "replacement", label: "Replace with", type: "text", value: "#c1440e" },
      ],
      outputs: [{ id: "value", label: "Result", type: "text" }],
      props: [],
      expr: ({ in: i }) => `((t, f, w) => (f === "" ? t : t.split(f).join(w)))(String(${i.text}), String(${i.find}), String(${i.replacement}))`,
    },
    "set-setting": {
      title: "Set site setting",
      category: "CSS",
      help: "Change one site-wide setting (a theme colour, the button shape...). The others stay as they are.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [{ id: "value", label: "Value", type: "text", value: "" }],
      outputs: [],
      props: [{ id: "key", label: "Setting", control: "select", options: select(SETTING_KEYS.map(([k, label]) => [k, label])), value: "theme_accent" }],
      emit: ({ in: i, props }) => [`await site.settings.update({ ${lit(props.key)}: ${i.value} });`],
    },
    "set-block-style": {
      title: "Set block style",
      category: "CSS",
      help: "Change one style field on a block (its colour, corner radius, custom CSS...). Its other style fields stay as they are.",
      flowIn: true,
      flowOuts: [{ id: "then", label: "" }],
      inputs: [
        { id: "block", label: "Block", type: "object", required: true },
        { id: "value", label: "Value", type: "text", value: "" },
      ],
      outputs: [],
      props: [{ id: "key", label: "Style", control: "select", options: select(STYLE_KEYS.map(([k, label]) => [k, label])), value: "color" }],
      emit: ({ in: i, props }) => {
        const v = NUMERIC_STYLE.has(props.key) ? `((v) => (v === "" ? "" : Number(v)))(${i.value})` : i.value;
        return [`await site.blocks.setStyle(${i.block}, { ${lit(props.key)}: ${v} });`];
      },
    },

    // ---- values and logic (no flow pins: they work out a value where it is used)
    text: {
      title: "Text",
      category: "Values",
      help: "A piece of text you type in.",
      inputs: [],
      outputs: [{ id: "value", label: "Text", type: "text" }],
      props: [{ id: "value", label: "Text", control: "textarea", value: "" }],
      expr: ({ props }) => lit(String(props.value == null ? "" : props.value)),
    },
    number: {
      title: "Number",
      category: "Values",
      help: "A number you type in.",
      inputs: [],
      outputs: [{ id: "value", label: "Number", type: "number" }],
      props: [{ id: "value", label: "Number", control: "number", value: "0" }],
      expr: ({ props }) => String(Number(props.value) || 0),
    },
    "join-text": {
      title: "Join text",
      category: "Values",
      help: "Put pieces of text one after another.",
      inputs: [
        { id: "a", label: "A", type: "text", value: "" },
        { id: "b", label: "B", type: "text", value: "" },
        { id: "c", label: "C", type: "text", value: "" },
      ],
      outputs: [{ id: "value", label: "Text", type: "text" }],
      props: [],
      expr: ({ in: i }) => `[${i.a}, ${i.b}, ${i.c}].join("")`,
    },
    "get-field": {
      title: "Get field",
      category: "Values",
      help: "One field of an item: a page's title, a block's type, a setting's value.",
      inputs: [{ id: "object", label: "Item", type: "object", required: true }],
      outputs: [{ id: "value", label: "Value", type: "any" }],
      props: [{ id: "field", label: "Field", control: "text", value: "title" }],
      expr: ({ in: i, props }) => `((o) => (o == null ? undefined : o[${lit(String(props.field || ""))}]))(${i.object})`,
    },
    count: {
      title: "Count",
      category: "Values",
      help: "How many items are in a list.",
      inputs: [{ id: "list", label: "List", type: "list", required: true }],
      outputs: [{ id: "value", label: "Count", type: "number" }],
      props: [],
      expr: ({ in: i }) => `(${i.list} || []).length`,
    },
    "filter-list": {
      title: "Filter list",
      category: "Values",
      help: "Keep only the items whose field matches.",
      inputs: [
        { id: "list", label: "List", type: "list", required: true },
        { id: "value", label: "Value", type: "text", value: "" },
      ],
      outputs: [{ id: "value", label: "Kept", type: "list" }],
      props: [
        { id: "field", label: "Field", control: "text", value: "slug" },
        { id: "operator", label: "Test", control: "select", options: select(OPERATORS), value: "contains" },
      ],
      expr: ({ in: i, props }) => `(${i.list} || []).filter((x) => ${filterTest(String(props.field || ""), props.operator, i.value)})`,
    },
    contains: {
      title: "Contains",
      category: "Logic",
      help: "Yes if the text has the other text in it.",
      inputs: [
        { id: "text", label: "Text", type: "text", value: "" },
        { id: "needle", label: "Look for", type: "text", value: "" },
      ],
      outputs: [{ id: "value", label: "Yes/No", type: "bool" }],
      props: [{ id: "case", label: "Capital letters", control: "select", options: select([["ignore", "Don't matter"], ["match", "Must match"]]), value: "ignore" }],
      expr: ({ in: i, props }) => (props.case === "match" ? `String(${i.text}).includes(String(${i.needle}))` : `String(${i.text}).toLowerCase().includes(String(${i.needle}).toLowerCase())`),
    },
    equals: {
      title: "Equals",
      category: "Logic",
      help: "Yes if both are the same.",
      inputs: [
        { id: "a", label: "A", type: "any", value: "" },
        { id: "b", label: "B", type: "any", value: "" },
      ],
      outputs: [{ id: "value", label: "Yes/No", type: "bool" }],
      props: [],
      expr: ({ in: i }) => `String(${i.a}) === String(${i.b})`,
    },
    not: {
      title: "Not",
      category: "Logic",
      help: "Flip yes and no.",
      inputs: [{ id: "a", label: "Yes/No", type: "bool", value: false }],
      outputs: [{ id: "value", label: "Yes/No", type: "bool" }],
      props: [],
      expr: ({ in: i }) => `!(${i.a})`,
    },
    and: {
      title: "And",
      category: "Logic",
      help: "Yes only if both are yes.",
      inputs: [
        { id: "a", label: "A", type: "bool", value: false },
        { id: "b", label: "B", type: "bool", value: false },
      ],
      outputs: [{ id: "value", label: "Yes/No", type: "bool" }],
      props: [],
      expr: ({ in: i }) => `(${i.a}) && (${i.b})`,
    },
    or: {
      title: "Or",
      category: "Logic",
      help: "Yes if either is yes.",
      inputs: [
        { id: "a", label: "A", type: "bool", value: false },
        { id: "b", label: "B", type: "bool", value: false },
      ],
      outputs: [{ id: "value", label: "Yes/No", type: "bool" }],
      props: [],
      expr: ({ in: i }) => `(${i.a}) || (${i.b})`,
    },
  };

  const CATEGORY_ORDER = ["Flow", "Site", "CSS", "Values", "Logic"];

  // Can a value of type `from` be plugged into a pin of type `to`?
  function compatible(from, to) {
    if (from === "flow" || to === "flow") return from === to;
    if (from === "any" || to === "any" || from === to) return true;
    // Numbers and yes/no print fine as text.
    return to === "text" && (from === "number" || from === "bool");
  }

  const isExec = (def) => Boolean(def && (def.flowIn || (def.flowOuts && def.flowOuts.length)));

  const api = { NODES, CATEGORY_ORDER, SETTING_KEYS, STYLE_KEYS, TYPE_LABELS, compatible, isExec, indent, lit, filterTest };
  if (typeof window !== "undefined") window.NodeDefs = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
