// Starter node graphs for the Scripts window (the CSS ones first). Each is a complete, working graph; most are safe to preview straight away.
// Plain data, so a node test can check that every one of them compiles.
(function () {
  const N = (id, type, x, y, values = {}, props = {}) => ({ id, type, x, y, values, props });
  const W = (a, aPin, b, bPin = "in") => ({ from: { node: a, pin: aPin }, to: { node: b, pin: bPin } });
  const G = (nodes, wires) => ({ version: 1, nodes, wires, view: null });

  const TEMPLATES = [
    {
      id: "swap-colour",
      name: "Swap a colour on every page",
      description: "Finds a colour in every page's own CSS and replaces it with another.",
      graph: G(
        [
          N("n1", "start", 40, 40),
          N("n2", "get-pages", 300, 40),
          N("n3", "for-each", 560, 40),
          N("n4", "get-page-css", 820, 40),
          N("n5", "replace-text", 820, 160, { find: "#ff7a45", replacement: "#c1440e" }),
          N("n6", "set-page-css", 1080, 40),
        ],
        [
          W("n1", "then", "n2"),
          W("n2", "then", "n3"),
          W("n2", "pages", "n3", "list"),
          W("n3", "body", "n4"),
          W("n3", "item", "n4", "page"),
          W("n4", "then", "n6"),
          W("n3", "item", "n6", "page"),
          W("n4", "css", "n5", "text"),
          W("n5", "value", "n6", "css"),
        ]
      ),
    },
    {
      id: "add-css-rule",
      name: "Add a CSS rule to every page",
      description: "Adds one rule to each page's CSS. Running it twice doesn't add it twice.",
      graph: G(
        [
          N("n1", "start", 40, 40),
          N("n2", "get-pages", 300, 40),
          N("n3", "for-each", 560, 40),
          N("n4", "get-page-css", 820, 40),
          N("n5", "css-rule", 820, 170, { selector: ".button", declarations: "border-radius: 12px;" }),
          N("n6", "add-css-rule", 1080, 170),
          N("n7", "set-page-css", 1340, 40),
        ],
        [
          W("n1", "then", "n2"),
          W("n2", "then", "n3"),
          W("n2", "pages", "n3", "list"),
          W("n3", "body", "n4"),
          W("n3", "item", "n4", "page"),
          W("n4", "then", "n7"),
          W("n3", "item", "n7", "page"),
          W("n4", "css", "n6", "css"),
          W("n5", "value", "n6", "rule"),
          W("n6", "value", "n7", "css"),
        ]
      ),
    },
    {
      id: "set-accent",
      name: "Set the accent colour",
      description: "Changes the site's accent colour and leaves every other setting alone.",
      graph: G(
        [N("n1", "start", 40, 40), N("n2", "set-setting", 300, 40, { value: "#c1440e" }, { key: "theme_accent" }), N("n3", "print", 560, 40, { value: "Accent colour changed." })],
        [W("n1", "then", "n2"), W("n2", "then", "n3")]
      ),
    },
    {
      id: "round-home-blocks",
      name: "Round the corners of every block on a page",
      description: "Sets the corner radius on every block of the page whose address is 'home'.",
      graph: G(
        [
          N("n1", "start", 40, 40),
          N("n2", "get-pages", 300, 40),
          N("n3", "filter-list", 560, 190, { value: "home" }, { field: "slug", operator: "equals" }),
          N("n4", "for-each", 820, 40),
          N("n5", "get-blocks", 1080, 40),
          N("n6", "for-each", 1340, 40),
          N("n7", "set-block-style", 1600, 40, { value: "12" }, { key: "borderRadius" }),
        ],
        [
          W("n1", "then", "n2"),
          W("n2", "then", "n4"),
          W("n2", "pages", "n3", "list"),
          W("n3", "value", "n4", "list"),
          W("n4", "body", "n5"),
          W("n4", "item", "n5", "page"),
          W("n5", "then", "n6"),
          W("n5", "blocks", "n6", "list"),
          W("n6", "body", "n7"),
          W("n6", "item", "n7", "block"),
        ]
      ),
    },
  ];

  const api = { TEMPLATES };
  if (typeof window !== "undefined") window.NodeTemplates = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
