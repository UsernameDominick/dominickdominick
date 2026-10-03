// A small code editor for the Scripts window: a textarea with a highlighted copy behind it, line numbers, smart Tab / Enter / brackets,
// and completion for the `site` helpers. No library to load (the admin has to work offline-ish and under a strict CSP).
(function () {
  // One entry per helper, shared by the completion list and the reference panel: [name, signature, what it does].
  const SDK_DOCS = [
    ["site.api", "(method, path, body?)", "Any admin API call, e.g. site.api('GET', '/articles')"],
    ["site.get", "(path)", "GET an admin API path"],
    ["site.post", "(path, body)", "POST to an admin API path"],
    ["site.patch", "(path, body)", "PATCH an admin API path"],
    ["site.put", "(path, body)", "PUT to an admin API path"],
    ["site.delete", "(path)", "DELETE an admin API path"],
    ["site.articles.list", "()", "All articles"],
    ["site.articles.get", "(id)", "One article, or null"],
    ["site.articles.create", "(fields)", "Make an article (title and body at least)"],
    ["site.articles.update", "(id, fields)", "Change fields on an article"],
    ["site.articles.remove", "(id)", "Move an article to Trash"],
    ["site.articles.duplicate", "(id)", "Copy an article"],
    ["site.articles.bulk", "({ ids, action, … })", "The same bulk actions as the Articles list"],
    ["site.projects.list", "()", "All projects"],
    ["site.projects.get", "(id)", "One project, or null"],
    ["site.projects.create", "(fields)", "Make a project"],
    ["site.projects.update", "(id, fields)", "Change fields on a project"],
    ["site.projects.remove", "(id)", "Move a project to Trash"],
    ["site.projects.duplicate", "(id)", "Copy a project"],
    ["site.projects.bulk", "({ ids, action, … })", "The same bulk actions as the Projects list"],
    ["site.pages.list", "()", "All pages"],
    ["site.pages.get", "(id)", "One page, or null"],
    ["site.pages.create", "(fields)", "Make a page"],
    ["site.pages.update", "(id, fields)", "Change fields on a page"],
    ["site.pages.remove", "(id)", "Move a page to Trash"],
    ["site.pages.duplicate", "(id)", "Copy a page"],
    ["site.pages.blocks", "(pageId)", "The blocks on a page"],
    ["site.pages.addBlock", "(pageId, block)", "Add a block to a page"],
    ["site.pages.css", "(pageId)", "A page's own CSS, as text"],
    ["site.pages.setCss", "(pageId, css)", "Replace a page's own CSS"],
    ["site.blocks.update", "(blockId, fields)", "Change a block"],
    ["site.blocks.setStyle", "(block, { color: '#fff' })", "Change some of a block's style fields and keep the rest"],
    ["site.blocks.remove", "(blockId)", "Delete a block"],
    ["site.redirects.list", "()", "All redirects"],
    ["site.redirects.create", "({ from_path, to_path, status_code })", "Add a redirect"],
    ["site.redirects.update", "(id, fields)", "Change a redirect"],
    ["site.redirects.remove", "(id)", "Delete a redirect"],
    ["site.songs.list", "()", "All songs"],
    ["site.songs.get", "(id)", "One song with its data"],
    ["site.songs.update", "(id, fields)", "Change a song"],
    ["site.simulations.list", "()", "All simulations"],
    ["site.simulations.get", "(id)", "One simulation with its circuit"],
    ["site.simulations.update", "(id, fields)", "Change a simulation"],
    ["site.scans.list", "()", "All 3D scans"],
    ["site.scans.get", "(id)", "One scan"],
    ["site.scans.update", "(id, fields)", "Change a scan"],
    ["site.sharedBlocks.list", "()", "Reusable blocks"],
    ["site.settings.get", "()", "Site settings"],
    ["site.settings.update", "(fields)", "Change some site settings"],
    ["site.media.list", "(query?)", "Media library entries"],
    ["site.search", "(text)", "Search the site's content"],
    ["site.css.rule", "(selector, declarations)", "Lay out one CSS rule from 'color: red; margin: 0'"],
    ["site.css.append", "(css, rule)", "Add a rule to some CSS unless it is already there"],
    ["site.each", "(items, fn, { concurrency }?)", "Run fn over a list a few at a time"],
    ["site.slugify", "(text)", "'Hello World!' → 'hello-world'"],
    ["site.sleep", "(ms)", "Wait a moment (up to 10 s)"],
    ["site.log", "(...values)", "Print to the output, same as console.log"],
    ["site.dryRun", "", "true while previewing, false when applying"],
  ];

  // name -> [child names], built from SDK_DOCS: "" is `site.`'s own children, "articles" is `site.articles.`'s.
  const TREE = {};
  for (const [name] of SDK_DOCS) {
    const parts = name.split(".").slice(1);
    for (let i = 0; i < parts.length; i++) {
      const key = parts.slice(0, i).join(".");
      (TREE[key] = TREE[key] || new Set()).add(parts[i]);
    }
  }
  const docFor = (full) => SDK_DOCS.find((d) => d[0] === full);

  // ---------- highlighting ----------
  const KEYWORDS = new Set("async await break case catch class const continue default delete do else export finally for function if in instanceof let new of return switch throw try typeof var void while yield".split(" "));
  const LITERALS = new Set(["true", "false", "null", "undefined", "NaN", "Infinity", "this"]);
  const GLOBALS = new Set(["site", "console", "Math", "JSON", "Object", "Array", "Date", "Promise", "String", "Number", "Set", "Map", "RegExp", "Error", "parseInt", "parseFloat", "Boolean"]);
  const TOKEN = /(\/\/[^\n]*|\/\*[\s\S]*?(?:\*\/|$))|("(?:\\.|[^"\\\n])*"?|'(?:\\.|[^'\\\n])*'?|`(?:\\[\s\S]|[^`\\])*`?)|(\b\d[\d_]*(?:\.\d+)?(?:e[+-]?\d+)?\b)|([A-Za-z_$][\w$]*)/g;
  const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

  function highlight(code) {
    const src = String(code == null ? "" : code);
    let out = "";
    let last = 0;
    let m;
    TOKEN.lastIndex = 0;
    while ((m = TOKEN.exec(src))) {
      out += esc(src.slice(last, m.index));
      const t = m[0];
      let cls = null;
      if (m[1] !== undefined) cls = "ce-comment";
      else if (m[2] !== undefined) cls = "ce-string";
      else if (m[3] !== undefined) cls = "ce-number";
      else if (KEYWORDS.has(t)) cls = "ce-keyword";
      else if (LITERALS.has(t)) cls = "ce-literal";
      else if (GLOBALS.has(t) && src[m.index - 1] !== ".") cls = "ce-global";
      out += cls ? `<span class="${cls}">${esc(t)}</span>` : esc(t);
      last = m.index + t.length;
      if (t.length === 0) TOKEN.lastIndex++;
    }
    return out + esc(src.slice(last));
  }

  // ---------- editing rules (pure, so a node test can drive them) ----------
  const PAIRS = { "(": ")", "[": "]", "{": "}", '"': '"', "'": "'", "`": "`" };
  const INDENT = "  ";

  // The line containing `pos`: { start, end } offsets (end is before the newline).
  function lineBounds(text, pos) {
    const start = text.lastIndexOf("\n", pos - 1) + 1;
    const nl = text.indexOf("\n", pos);
    return { start, end: nl === -1 ? text.length : nl };
  }

  // Enter: keep the current line's indentation, one level deeper after an opening bracket, and split a {} pair onto three lines.
  // Returns { text, start, end } (the new text and caret).
  function enterEdit(text, start, end) {
    const { start: ls } = lineBounds(text, start);
    const indent = /^[ \t]*/.exec(text.slice(ls, start))[0];
    const prev = text[start - 1];
    const opens = prev === "{" || prev === "[" || prev === "(";
    let insert = "\n" + indent + (opens ? INDENT : "");
    const caret = start + insert.length;
    if (opens && text[end] === PAIRS[prev]) insert += "\n" + indent;
    return { text: text.slice(0, start) + insert + text.slice(end), start: caret, end: caret };
  }

  // Tab / Shift+Tab: indent or outdent every line the selection touches (or insert two spaces at a bare caret).
  function tabEdit(text, start, end, back) {
    if (start === end && !back) return { text: text.slice(0, start) + INDENT + text.slice(end), start: start + INDENT.length, end: start + INDENT.length };
    const first = lineBounds(text, start).start;
    const lastPos = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const last = lineBounds(text, lastPos).end;
    const lines = text.slice(first, last).split("\n");
    let startShift = 0;
    let total = 0;
    const next = lines.map((line, i) => {
      let out;
      let delta;
      if (back) {
        const m = /^( {1,2}|\t)/.exec(line);
        out = m ? line.slice(m[0].length) : line;
        delta = m ? -m[0].length : 0;
      } else {
        out = INDENT + line;
        delta = INDENT.length;
      }
      if (i === 0) startShift = delta;
      total += delta;
      return out;
    });
    const newStart = Math.max(first, start + startShift);
    return { text: text.slice(0, first) + next.join("\n") + text.slice(last), start: newStart, end: Math.max(newStart, end + total) };
  }

  // Ctrl+/ : comment every touched line, or uncomment them when all are already commented.
  function commentEdit(text, start, end) {
    const first = lineBounds(text, start).start;
    const lastPos = end > start && text[end - 1] === "\n" ? end - 1 : end;
    const last = lineBounds(text, lastPos).end;
    const lines = text.slice(first, last).split("\n");
    const live = lines.filter((l) => l.trim());
    const uncomment = live.length > 0 && live.every((l) => /^\s*\/\//.test(l));
    let total = 0;
    let startShift = 0;
    const next = lines.map((line, i) => {
      if (!line.trim()) return line;
      let out;
      if (uncomment) out = line.replace(/^(\s*)\/\/ ?/, "$1");
      else {
        const lead = /^\s*/.exec(line)[0].length;
        out = line.slice(0, lead) + "// " + line.slice(lead);
      }
      const delta = out.length - line.length;
      if (i === 0) startShift = delta;
      total += delta;
      return out;
    });
    return { text: text.slice(0, first) + next.join("\n") + text.slice(last), start: Math.max(first, start + startShift), end: Math.max(first, end + total) };
  }

  // Typing an opening bracket or quote adds its partner; typing the partner over an auto-added one steps past it.
  function typeEdit(text, start, end, ch) {
    const isOpen = Object.prototype.hasOwnProperty.call(PAIRS, ch);
    const isClose = ch === ")" || ch === "]" || ch === "}" || ch === '"' || ch === "'" || ch === "`";
    if (end > start && isOpen) {
      // Wrap a selection.
      return { text: text.slice(0, start) + ch + text.slice(start, end) + PAIRS[ch] + text.slice(end), start: start + 1, end: end + 1 };
    }
    if (start !== end) return null;
    if (isClose && text[start] === ch) return { text, start: start + 1, end: start + 1 };
    if (!isOpen) return null;
    // A quote after a word character is an apostrophe ("don't") or the end of a string, and a bracket before a word is not a pair.
    if ((ch === '"' || ch === "'" || ch === "`") && /[\w$]/.test(text[start - 1] || "")) return null;
    if (/[\w$]/.test(text[start] || "")) return null;
    return { text: text.slice(0, start) + ch + PAIRS[ch] + text.slice(end), start: start + 1, end: start + 1 };
  }

  // Backspace between an empty pair deletes both.
  function backspaceEdit(text, start, end) {
    if (start !== end || start === 0) return null;
    const a = text[start - 1];
    if (PAIRS[a] && text[start] === PAIRS[a]) return { text: text.slice(0, start - 1) + text.slice(start + 1), start: start - 1, end: start - 1 };
    return null;
  }

  // The completion context at the caret: { prefix, base, from } for `site.art|` -> base "", prefix "art"; null when not after `site`.
  function completionContext(text, caret) {
    const m = /(?:^|[^\w$.])(site(?:\.[A-Za-z_$][\w$]*)*)\.([A-Za-z_$][\w$]*)?$/.exec(text.slice(Math.max(0, caret - 200), caret));
    if (!m) return null;
    const base = m[1].split(".").slice(1).join(".");
    const prefix = m[2] || "";
    return { base, prefix, from: caret - prefix.length };
  }

  function suggestions(ctx) {
    if (!ctx || !TREE[ctx.base]) return [];
    return Array.from(TREE[ctx.base])
      .filter((n) => n.toLowerCase().startsWith(ctx.prefix.toLowerCase()) && n !== ctx.prefix)
      .sort()
      .map((n) => {
        const full = `site.${ctx.base ? ctx.base + "." : ""}${n}`;
        const doc = docFor(full);
        return { name: n, sig: doc ? doc[1] : "", info: doc ? doc[2] : "", leaf: Boolean(doc) };
      });
  }

  // ---------- the widget ----------
  let uid = 0;
  function create(container, options = {}) {
    const id = ++uid;
    const root = document.createElement("div");
    root.className = "code-editor";
    root.innerHTML = `<div class="ce-gutter" aria-hidden="true"></div>
      <div class="ce-scroll"><pre class="ce-highlight" aria-hidden="true"></pre><div class="ce-error-bar" hidden></div><textarea class="ce-input" spellcheck="false" autocomplete="off" autocapitalize="off" wrap="off" aria-label="${esc(options.label || "Script code")}" aria-describedby="ce-hint-${id}" aria-autocomplete="list" aria-controls="ce-list-${id}"></textarea></div>
      <ul class="ce-complete" id="ce-list-${id}" role="listbox" aria-label="Suggestions" hidden></ul>
      <span class="ce-live" id="ce-live-${id}" role="status" aria-live="polite"></span>
      <p class="ce-hint" id="ce-hint-${id}">Tab indents. Esc, then Tab, moves on. Ctrl+Enter runs a preview.</p>`;
    container.appendChild(root);
    const ta = root.querySelector(".ce-input");
    const pre = root.querySelector(".ce-highlight");
    const gutter = root.querySelector(".ce-gutter");
    const scroll = root.querySelector(".ce-scroll");
    const bar = root.querySelector(".ce-error-bar");
    const list = root.querySelector(".ce-complete");
    const live = root.querySelector(".ce-live");
    let errorLine = null;
    let tabMoves = false;
    let items = [];
    let picked = 0;
    let ctx = null;

    function metrics() {
      const cs = getComputedStyle(ta);
      const probe = document.createElement("span");
      probe.style.cssText = `position:absolute;visibility:hidden;white-space:pre;font:${cs.font}`;
      probe.textContent = "0".repeat(20);
      root.appendChild(probe);
      const w = probe.getBoundingClientRect().width / 20;
      probe.remove();
      return { char: w || 8, line: parseFloat(cs.lineHeight) || 20, padTop: parseFloat(cs.paddingTop) || 0, padLeft: parseFloat(cs.paddingLeft) || 0 };
    }

    function render() {
      const value = ta.value;
      pre.innerHTML = highlight(value) + "\n";
      const n = value.split("\n").length;
      let g = "";
      for (let i = 1; i <= n; i++) g += `<span${i === errorLine ? ' class="ce-bad"' : ""}>${i}</span>`;
      gutter.innerHTML = g;
      placeErrorBar();
      syncScroll();
    }
    function syncScroll() {
      pre.style.transform = `translate(${-ta.scrollLeft}px, ${-ta.scrollTop}px)`;
      gutter.style.transform = `translateY(${-ta.scrollTop}px)`;
      bar.style.transform = `translateY(${-ta.scrollTop}px)`;
    }
    function placeErrorBar() {
      if (!errorLine) {
        bar.hidden = true;
        return;
      }
      const mt = metrics();
      bar.hidden = false;
      bar.style.top = `${mt.padTop + (errorLine - 1) * mt.line}px`;
      bar.style.height = `${mt.line}px`;
    }

    function changed() {
      errorLine = null;
      render();
      updateComplete();
      if (options.onChange) options.onChange(ta.value);
    }

    // Applies a computed edit by replacing only the changed stretch through execCommand, so the browser's own undo history
    // (Ctrl+Z) keeps working; falls back to assigning the value where execCommand is unavailable.
    function edit(fn) {
      const next = fn(ta.value, ta.selectionStart, ta.selectionEnd);
      if (!next) return false;
      ta.focus();
      const old = ta.value;
      const nw = next.text;
      let a = 0;
      while (a < old.length && a < nw.length && old[a] === nw[a]) a++;
      let b = 0;
      while (b < old.length - a && b < nw.length - a && old[old.length - 1 - b] === nw[nw.length - 1 - b]) b++;
      let ok = true;
      if (a !== old.length - b || nw.length - b !== a) {
        ta.setSelectionRange(a, old.length - b);
        const piece = nw.slice(a, nw.length - b);
        try {
          ok = piece ? document.execCommand("insertText", false, piece) : document.execCommand("delete");
        } catch (e) {
          ok = false;
        }
      }
      if (!ok || ta.value !== nw) ta.value = nw;
      ta.setSelectionRange(next.start, next.end);
      changed();
      return true;
    }

    function closeComplete() {
      list.hidden = true;
      items = [];
      ctx = null;
      ta.removeAttribute("aria-activedescendant");
      live.textContent = "";
    }
    function updateComplete() {
      if (ta.selectionStart !== ta.selectionEnd) return closeComplete();
      ctx = completionContext(ta.value, ta.selectionStart);
      items = suggestions(ctx);
      if (!items.length) return closeComplete();
      picked = Math.min(picked, items.length - 1);
      list.innerHTML = items
        .map((it, i) => `<li role="option" id="ce-opt-${id}-${i}" aria-selected="${i === picked}" data-i="${i}"><b>${esc(it.name)}</b><span class="ce-sig">${esc(it.sig)}</span><span class="ce-info">${esc(it.info)}</span></li>`)
        .join("");
      const mt = metrics();
      const before = ta.value.slice(0, ctx.from);
      const line = before.split("\n").length - 1;
      const col = before.length - (before.lastIndexOf("\n") + 1);
      const x = Math.min(gutter.offsetWidth + mt.padLeft + col * mt.char - ta.scrollLeft, Math.max(0, root.clientWidth - 260));
      const y = mt.padTop + (line + 1) * mt.line - ta.scrollTop;
      list.style.left = `${Math.max(0, x)}px`;
      list.style.top = `${Math.min(y, root.clientHeight - 40)}px`;
      list.hidden = false;
      ta.setAttribute("aria-activedescendant", `ce-opt-${id}-${picked}`);
      live.textContent = `${items.length} suggestion${items.length === 1 ? "" : "s"}. ${items[picked].name}${items[picked].info ? ", " + items[picked].info : ""}`;
    }
    function accept(i) {
      const it = items[i];
      if (!it || !ctx) return;
      const from = ctx.from;
      const to = ta.selectionStart;
      const text = ta.value.slice(0, from) + it.name + ta.value.slice(to);
      const caret = from + it.name.length;
      edit(() => ({ text, start: caret, end: caret }));
    }

    ta.addEventListener("input", () => {
      picked = 0;
      changed();
    });
    ta.addEventListener("scroll", () => {
      syncScroll();
      if (!list.hidden) updateComplete();
    });
    ta.addEventListener("click", updateComplete);
    ta.addEventListener("blur", () => setTimeout(closeComplete, 120));
    list.addEventListener("mousedown", (e) => {
      const li = e.target.closest("li[data-i]");
      if (!li) return;
      e.preventDefault();
      accept(Number(li.dataset.i));
    });

    ta.addEventListener("keydown", (e) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!list.hidden && items.length) {
        if (e.key === "ArrowDown" || e.key === "ArrowUp") {
          e.preventDefault();
          picked = (picked + (e.key === "ArrowDown" ? 1 : items.length - 1)) % items.length;
          updateComplete();
          list.children[picked]?.scrollIntoView({ block: "nearest" });
          return;
        }
        if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
          e.preventDefault();
          accept(picked);
          return;
        }
        if (e.key === "Escape") {
          e.preventDefault();
          e.stopPropagation();
          closeComplete();
          return;
        }
      }
      if (e.key === "Escape") {
        // Esc is how a keyboard user gets out: the next Tab moves focus instead of indenting. It must not also close the window.
        tabMoves = true;
        e.preventDefault();
        return;
      }
      if (e.key === "Tab") {
        if (tabMoves) return;
        e.preventDefault();
        edit((t, s, en) => tabEdit(t, s, en, e.shiftKey));
        return;
      }
      tabMoves = false;
      if (mod && e.key === "Enter") {
        e.preventDefault();
        if (options.onRun) options.onRun();
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        if (options.onSave) {
          e.preventDefault();
          options.onSave();
        }
        return;
      }
      if (mod && e.key === "/") {
        e.preventDefault();
        edit(commentEdit);
        return;
      }
      if (e.key === "Enter" && !mod && !e.shiftKey && !e.altKey) {
        e.preventDefault();
        edit(enterEdit);
        return;
      }
      if (e.key === "Backspace" && !mod && !e.altKey) {
        const next = backspaceEdit(ta.value, ta.selectionStart, ta.selectionEnd);
        if (next) {
          e.preventDefault();
          edit(() => next);
        }
        return;
      }
      if (e.key.length === 1 && !mod && !e.altKey) {
        const next = typeEdit(ta.value, ta.selectionStart, ta.selectionEnd, e.key);
        if (next) {
          e.preventDefault();
          edit(() => next);
        }
      }
    });

    render();
    return {
      el: root,
      getValue: () => ta.value,
      setValue(v) {
        ta.value = String(v == null ? "" : v);
        errorLine = null;
        ta.scrollTop = 0;
        render();
        closeComplete();
      },
      focus: () => ta.focus(),
      // Insert at the caret (a starter snippet), on a line of its own.
      insert(text) {
        edit((t, s, en) => {
          const ls = lineBounds(t, s).start;
          const blank = !t.slice(ls, lineBounds(t, s).end).trim();
          const lead = blank ? "" : "\n";
          const out = t.slice(0, s) + lead + text + t.slice(en);
          const caret = s + lead.length + text.length;
          return { text: out, start: caret, end: caret };
        });
      },
      // Mark (and scroll to) the line an error came from; null clears it.
      markError(line) {
        errorLine = Number.isInteger(line) && line > 0 ? line : null;
        render();
        if (errorLine) {
          const mt = metrics();
          const y = mt.padTop + (errorLine - 1) * mt.line;
          if (y < ta.scrollTop || y > ta.scrollTop + ta.clientHeight - mt.line * 2) ta.scrollTop = Math.max(0, y - ta.clientHeight / 3);
        }
      },
      // The generated code of a node graph is shown, not edited.
      setReadOnly(on) {
        ta.readOnly = Boolean(on);
        root.classList.toggle("is-readonly", Boolean(on));
        root.querySelector(".ce-hint").textContent = on ? "Generated from the nodes: change the nodes to change this." : "Tab indents. Esc, then Tab, moves on. Ctrl+Enter runs a preview.";
      },
      relayout: render,
      destroy: () => root.remove(),
    };
  }

  const api = { create, highlight, enterEdit, tabEdit, commentEdit, typeEdit, backspaceEdit, completionContext, suggestions, SDK_DOCS, INDENT };
  if (typeof window !== "undefined") window.ScriptEditor = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
