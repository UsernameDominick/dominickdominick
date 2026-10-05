// Hidden Notes (the owner's private writing, at /hidden-notes). Everything here happens in this browser: a passphrase is turned into a
// key (PBKDF2 then AES-GCM, WebCrypto) that lives only in memory, every note is sealed before it is sent, and the server stores nothing
// it could read. No passphrase, no way in: there is no reset that keeps the notes. Locking, or ten idle minutes, forgets the key.
(function () {
  "use strict";
  var root = document.getElementById("hn-root");
  if (!root || !window.crypto || !crypto.subtle) {
    if (root) root.textContent = "This browser can't seal notes (it needs a secure connection and Web Crypto).";
    return;
  }
  var enc = new TextEncoder();
  var dec = new TextDecoder();
  var ITER = 600000;
  var MIN_PASS = 10;
  var IDLE_MS = 10 * 60 * 1000;
  var MAX_BODY = 100000;

  // ---- bytes and text
  function toB64(buf) {
    var bytes = new Uint8Array(buf);
    var s = "";
    for (var i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192));
    return btoa(s);
  }
  function fromB64(text) {
    var s = atob(text);
    var out = new Uint8Array(s.length);
    for (var i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  }
  function h(tag, attrs, kids) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (k === "text") el.textContent = attrs[k];
      else if (k === "class") el.className = attrs[k];
      else el.setAttribute(k, attrs[k]);
    });
    (kids || []).forEach(function (c) { el.appendChild(c); });
    return el;
  }
  function field(id, label, type, extra) {
    var input = h("input", Object.assign({ id: id, type: type || "text", autocomplete: "off", spellcheck: "false" }, extra || {}));
    return { wrap: h("div", { class: "hn-field" }, [h("label", { for: id, text: label }), input]), input: input };
  }

  // ---- the server (sealed blobs only)
  function api(path, options) {
    var o = Object.assign({ credentials: "same-origin", headers: { "Content-Type": "application/json" } }, options || {});
    return fetch("/api/admin" + path, o).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (body) {
        if (!res.ok) throw new Error(body.error || "Request failed (" + res.status + ")");
        return body;
      });
    });
  }

  // ---- crypto
  function deriveKey(pass, saltB64, iter) {
    return crypto.subtle.importKey("raw", enc.encode(String(pass).normalize("NFKC")), "PBKDF2", false, ["deriveKey"]).then(function (base) {
      return crypto.subtle.deriveKey({ name: "PBKDF2", salt: fromB64(saltB64), iterations: iter, hash: "SHA-256" }, base, { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
    });
  }
  function seal(key, value) {
    var iv = crypto.getRandomValues(new Uint8Array(12));
    return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(JSON.stringify(value))).then(function (ct) {
      return { v: 1, iv: toB64(iv), ct: toB64(ct) };
    });
  }
  function unseal(key, sealed) {
    return crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(sealed.iv) }, key, fromB64(sealed.ct)).then(function (pt) {
      return JSON.parse(dec.decode(pt));
    });
  }
  function newMeta(pass) {
    var salt = toB64(crypto.getRandomValues(new Uint8Array(16)));
    return deriveKey(pass, salt, ITER).then(function (key) {
      return seal(key, { check: "hidden-notes-ok" }).then(function (check) {
        return { key: key, meta: { v: 1, salt: salt, iter: ITER, check: check } };
      });
    });
  }
  // Resolves with the key when the passphrase opens this vault's check word, otherwise rejects.
  function keyFromPass(pass, meta) {
    return deriveKey(pass, meta.salt, meta.iter).then(function (key) {
      return unseal(key, meta.check).then(function (v) {
        if (!v || v.check !== "hidden-notes-ok") throw new Error("wrong");
        return key;
      });
    });
  }

  // ---- state
  var meta = null;
  var key = null;
  var notes = [];
  var selected = null;
  var saveTimer = null;
  var chain = Promise.resolve();
  var idleTimer = null;
  var dirty = false;
  var ui = {};

  function pad(n) { return (n < 10 ? "0" : "") + n; }
  function when(iso) {
    var d = new Date(iso);
    return isNaN(d) ? "" : d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate()) + " " + pad(d.getHours()) + ":" + pad(d.getMinutes());
  }
  function clear() { while (root.firstChild) root.removeChild(root.firstChild); }
  function say(el, text, isError) {
    el.textContent = text;
    el.classList.toggle("hn-error", !!isError);
  }

  // ---- first visit: choose a passphrase
  function showSetup() {
    clear();
    var pass = field("hn-pass", "Passphrase (at least " + MIN_PASS + " characters)", "password", { autocomplete: "new-password" });
    var again = field("hn-pass2", "Type it again", "password", { autocomplete: "new-password" });
    var ack = h("input", { type: "checkbox", id: "hn-ack" });
    var msg = h("p", { class: "hn-msg", role: "alert" });
    var form = h("form", { class: "hn-card" }, [
      h("h2", { text: "Set up your vault" }),
      h("p", { text: "Your notes are sealed in this browser with a passphrase before they are saved. The site, its database and its backups only ever hold scrambled text." }),
      pass.wrap,
      again.wrap,
      h("p", { class: "hn-warn", text: "There is no reset. If you forget this passphrase your notes can never be read again, by anyone." }),
      h("label", { class: "hn-check" }, [ack, h("span", { text: " I understand that a forgotten passphrase can't be recovered." })]),
      h("button", { type: "submit", text: "Create vault" }),
      msg,
    ]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (pass.input.value.length < MIN_PASS) return say(msg, "Use at least " + MIN_PASS + " characters.", true);
      if (pass.input.value !== again.input.value) return say(msg, "The two passphrases don't match.", true);
      if (!ack.checked) return say(msg, "Tick the box to confirm you understand.", true);
      say(msg, "Sealing…");
      newMeta(pass.input.value)
        .then(function (made) {
          return api("/hidden-notes/setup", { method: "POST", body: JSON.stringify({ meta: made.meta }) }).then(function () {
            meta = made.meta;
            key = made.key;
            notes = [];
            showApp();
          });
        })
        .catch(function (err) { say(msg, err.message, true); });
    });
    root.appendChild(form);
    pass.input.focus();
  }

  // ---- locked
  function showLock(message) {
    clear();
    key = null;
    notes = [];
    selected = null;
    var pass = field("hn-pass", "Passphrase", "password", { autocomplete: "current-password" });
    var msg = h("p", { class: "hn-msg", role: "alert", text: message || "" });
    var forgot = h("button", { type: "button", class: "hn-link", text: "I forgot my passphrase…" });
    var form = h("form", { class: "hn-card" }, [h("h2", { text: "Locked" }), pass.wrap, h("button", { type: "submit", text: "Unlock" }), msg, forgot]);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      say(msg, "Opening…");
      keyFromPass(pass.input.value, meta).then(
        function (k) {
          key = k;
          loadNotes().then(showApp).catch(function (err) { say(msg, err.message, true); });
        },
        function () { say(msg, "That passphrase doesn't open this vault.", true); pass.input.select(); }
      );
    });
    forgot.addEventListener("click", function () { eraseFlow(msg); });
    root.appendChild(form);
    pass.input.focus();
  }

  function eraseFlow(msg) {
    var typed = window.prompt("Without the passphrase the notes cannot be recovered. Erasing deletes every note and the vault so you can start again.\n\nType ERASE to confirm:");
    if (typed !== "ERASE") return;
    api("/hidden-notes/erase", { method: "POST", body: JSON.stringify({ confirm: "ERASE" }) })
      .then(function () { meta = null; key = null; notes = []; showSetup(); })
      .catch(function (err) { if (msg) say(msg, err.message, true); });
  }

  // ---- loading
  function loadNotes() {
    return api("/hidden-notes").then(function (vault) {
      meta = vault.meta;
      return Promise.all(
        vault.notes.map(function (n) {
          return unseal(key, JSON.parse(n.blob)).then(function (v) {
            return { id: n.id, title: String(v.title || ""), body: String(v.body || ""), created_at: n.created_at, updated_at: n.updated_at };
          });
        })
      ).then(function (list) { notes = list; });
    });
  }

  // ---- the notes
  function blobOf(n) { return seal(key, { title: n.title, body: n.body }).then(function (s) { return JSON.stringify(s); }); }
  function persist(n) {
    chain = chain.then(function () {
      if (!key) return;
      return blobOf(n).then(function (blob) {
        if (n.id) return api("/hidden-notes/" + n.id, { method: "PUT", body: JSON.stringify({ blob: blob }) });
        return api("/hidden-notes", { method: "POST", body: JSON.stringify({ blob: blob }) }).then(function (r) { n.id = r.id; return r; });
      }).then(function (r) {
        n.created_at = r.created_at;
        n.updated_at = r.updated_at;
        dirty = false;
        if (ui.status) say(ui.status, "Saved " + when(r.updated_at).slice(11));
        renderList();
      });
    }).catch(function (err) { if (ui.status) say(ui.status, "Couldn't save: " + err.message, true); });
    return chain;
  }
  function current() { return notes.find(function (n) { return n.id === selected || n._tmp === selected; }) || null; }
  function flush() {
    clearTimeout(saveTimer);
    var n = current();
    return n && dirty ? persist(n) : chain;
  }

  function newNote() {
    var n = { id: null, title: "", body: "", created_at: new Date().toISOString(), updated_at: new Date().toISOString(), _tmp: "tmp" + Date.now() };
    notes.unshift(n);
    selected = n._tmp;
    renderList();
    renderEditor();
    persist(n).then(function () { if (n.id && selected === n._tmp) selected = n.id; renderList(); });
    ui.title.focus();
  }
  function removeNote() {
    var n = current();
    if (!n || !window.confirm("Delete this note? It can't be brought back.")) return;
    clearTimeout(saveTimer);
    dirty = false;
    notes = notes.filter(function (x) { return x !== n; });
    selected = null;
    (n.id ? api("/hidden-notes/" + n.id, { method: "DELETE" }) : Promise.resolve()).then(function () { renderList(); renderEditor(); }).catch(function (err) { say(ui.status, err.message, true); });
  }

  // ---- the page
  function showApp() {
    clear();
    ui = {};
    ui.search = h("input", { id: "hn-search", type: "search", placeholder: "Search your notes", "aria-label": "Search your notes", autocomplete: "off" });
    ui.list = h("ul", { class: "hn-list", "aria-label": "Notes" });
    ui.status = h("p", { class: "hn-status", role: "status" });
    ui.tools = h("div", { class: "hn-tools" });
    ui.panel = h("div", { class: "hn-panel", hidden: "" });
    ui.editor = h("div", { class: "hn-editor" });
    var newBtn = h("button", { type: "button", class: "hn-primary", text: "New note" });
    var lockBtn = h("button", { type: "button", text: "Lock" });
    ui.tools.appendChild(newBtn);
    ui.tools.appendChild(lockBtn);
    [["Download all (readable)", downloadPlain, "Saves every note as one plain text file. That file is NOT sealed."], ["Download sealed copy", downloadSealed, "Saves a copy that is still sealed. It is the only backup of these notes."], ["Import sealed copy…", importFlow, "Replaces everything here with a sealed copy you downloaded before."], ["Change passphrase…", changePassFlow, "Re-seals every note under a new passphrase."], ["Erase everything…", function () { eraseFlow(ui.status); }, "Deletes every note and the vault."]].forEach(function (t) {
      ui.tools.appendChild(h("button", { type: "button", text: t[0], title: t[2], class: "hn-minor" })).addEventListener("click", t[1]);
    });
    root.appendChild(ui.tools);
    root.appendChild(ui.panel);
    root.appendChild(h("div", { class: "hn-layout" }, [h("div", { class: "hn-side" }, [ui.search, ui.list]), ui.editor]));
    root.appendChild(ui.status);
    newBtn.addEventListener("click", newNote);
    lockBtn.addEventListener("click", lockNow);
    ui.search.addEventListener("input", renderList);
    renderList();
    renderEditor();
    armIdle();
  }

  function renderList() {
    if (!ui.list) return;
    var q = ui.search.value.trim().toLowerCase();
    var shown = notes
      .filter(function (n) { return !q || (n.title + "\n" + n.body).toLowerCase().indexOf(q) !== -1; })
      .sort(function (a, b) { return String(b.updated_at).localeCompare(String(a.updated_at)); });
    while (ui.list.firstChild) ui.list.removeChild(ui.list.firstChild);
    if (!shown.length) ui.list.appendChild(h("li", { class: "hn-empty", text: notes.length ? "No notes match." : "No notes yet. Press New note." }));
    shown.forEach(function (n) {
      var id = n.id || n._tmp;
      var btn = h("button", { type: "button", class: "hn-item", "aria-current": id === selected ? "true" : "false" }, [
        h("strong", { text: n.title || "Untitled" }),
        h("span", { text: when(n.updated_at) }),
        h("span", { class: "hn-snippet", text: n.body.replace(/\s+/g, " ").slice(0, 70) }),
      ]);
      btn.addEventListener("click", function () { flush().then(function () { selected = id; renderList(); renderEditor(); }); });
      ui.list.appendChild(h("li", {}, [btn]));
    });
  }

  function renderEditor() {
    while (ui.editor.firstChild) ui.editor.removeChild(ui.editor.firstChild);
    var n = current();
    if (!n) {
      ui.editor.appendChild(h("p", { class: "hn-empty", text: "Pick a note, or start a new one." }));
      return;
    }
    ui.title = h("input", { id: "hn-title", type: "text", placeholder: "Title", "aria-label": "Title", maxlength: "200", autocomplete: "off" });
    ui.body = h("textarea", { id: "hn-body", "aria-label": "Note", placeholder: "Write here…", maxlength: String(MAX_BODY) });
    ui.title.value = n.title;
    ui.body.value = n.body;
    ui.count = h("span", { class: "hn-count" });
    var del = h("button", { type: "button", class: "hn-minor", text: "Delete note" });
    ui.editor.appendChild(ui.title);
    ui.editor.appendChild(ui.body);
    ui.editor.appendChild(h("div", { class: "hn-editor-foot" }, [ui.count, del]));
    function words() { var t = ui.body.value.trim(); ui.count.textContent = (t ? t.split(/\s+/).length : 0) + " words · created " + when(n.created_at); }
    words();
    function changed() {
      n.title = ui.title.value;
      n.body = ui.body.value;
      dirty = true;
      words();
      say(ui.status, "Saving…");
      clearTimeout(saveTimer);
      saveTimer = setTimeout(function () { persist(n); }, 1200);
    }
    ui.title.addEventListener("input", changed);
    ui.body.addEventListener("input", changed);
    del.addEventListener("click", removeNote);
  }

  // ---- locking
  function lockNow() {
    flush().then(function () { clearTimeout(idleTimer); showLock(""); });
  }
  function armIdle() {
    clearTimeout(idleTimer);
    idleTimer = setTimeout(function () { if (key) flush().then(function () { showLock("Locked after ten idle minutes."); }); }, IDLE_MS);
  }
  ["keydown", "pointerdown", "scroll"].forEach(function (t) { document.addEventListener(t, function () { if (key) armIdle(); }, { passive: true }); });
  document.addEventListener("keydown", function (e) {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && key) { e.preventDefault(); flush(); }
  });
  window.addEventListener("beforeunload", function (e) { if (dirty) { e.preventDefault(); e.returnValue = ""; } });

  // ---- tools
  function download(name, type, text) {
    var url = URL.createObjectURL(new Blob([text], { type: type }));
    var a = h("a", { href: url, download: name });
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
  }
  function downloadPlain() {
    var text = notes.slice().sort(function (a, b) { return String(a.created_at).localeCompare(String(b.created_at)); })
      .map(function (n) { return "# " + (n.title || "Untitled") + "\n(" + when(n.created_at) + ")\n\n" + n.body + "\n"; }).join("\n---\n\n");
    download("hidden-notes-readable.txt", "text/plain", text);
    say(ui.status, "Saved a readable copy. Keep that file somewhere safe: it is not sealed.");
  }
  function downloadSealed() {
    flush().then(function () { return api("/hidden-notes"); }).then(function (vault) {
      download("hidden-notes-sealed.json", "application/json", JSON.stringify({ format: "dominick-hidden-notes", version: 1, meta: vault.meta, notes: vault.notes }, null, 1));
      say(ui.status, "Saved a sealed copy. It opens only with your passphrase.");
    }).catch(function (err) { say(ui.status, err.message, true); });
  }
  function openPanel(title, fields, button, onSubmit) {
    ui.panel.hidden = false;
    while (ui.panel.firstChild) ui.panel.removeChild(ui.panel.firstChild);
    var msg = h("p", { class: "hn-msg", role: "alert" });
    var cancel = h("button", { type: "button", class: "hn-minor", text: "Cancel" });
    var form = h("form", {}, [h("h2", { text: title })].concat(fields.map(function (f) { return f.wrap; }), [h("div", { class: "hn-row" }, [h("button", { type: "submit", text: button }), cancel]), msg]));
    cancel.addEventListener("click", function () { ui.panel.hidden = true; });
    form.addEventListener("submit", function (e) { e.preventDefault(); say(msg, "Working…"); Promise.resolve(onSubmit(msg)).catch(function (err) { say(msg, err.message, true); }); });
    ui.panel.appendChild(form);
    fields[0].input.focus();
  }
  function changePassFlow() {
    var cur = field("hn-cur", "Current passphrase", "password", { autocomplete: "current-password" });
    var p1 = field("hn-new", "New passphrase (at least " + MIN_PASS + " characters)", "password", { autocomplete: "new-password" });
    var p2 = field("hn-new2", "New passphrase again", "password", { autocomplete: "new-password" });
    openPanel("Change passphrase", [cur, p1, p2], "Re-seal everything", function (msg) {
      if (p1.input.value.length < MIN_PASS) throw new Error("Use at least " + MIN_PASS + " characters.");
      if (p1.input.value !== p2.input.value) throw new Error("The two new passphrases don't match.");
      return flush().then(function () { return keyFromPass(cur.input.value, meta); }).then(
        function () {
          return newMeta(p1.input.value).then(function (made) {
            return Promise.all(notes.filter(function (n) { return n.id; }).map(function (n) {
              return seal(made.key, { title: n.title, body: n.body }).then(function (s) { return { id: n.id, blob: JSON.stringify(s), created_at: n.created_at, updated_at: n.updated_at }; });
            })).then(function (sealed) {
              return api("/hidden-notes/replace", { method: "POST", body: JSON.stringify({ meta: made.meta, notes: sealed }) }).then(function () {
                meta = made.meta;
                key = made.key;
                ui.panel.hidden = true;
                say(ui.status, "Passphrase changed. Every note is sealed under the new one.");
              });
            });
          });
        },
        function () { throw new Error("The current passphrase is wrong."); }
      );
    });
  }
  function importFlow() {
    var file = h("input", { type: "file", accept: ".json,application/json" });
    var fileField = { wrap: h("div", { class: "hn-field" }, [h("label", { for: "hn-file", text: "Sealed copy (.json)" }), file]), input: file };
    file.id = "hn-file";
    var pass = field("hn-copy-pass", "The passphrase that copy was made with", "password", { autocomplete: "off" });
    openPanel("Import a sealed copy", [fileField, pass], "Replace everything with this copy", function () {
      if (!file.files[0]) throw new Error("Choose a file first.");
      if (!window.confirm("This replaces every note here with the copy. Continue?")) return;
      return file.files[0].text().then(function (text) {
        var data;
        try { data = JSON.parse(text); } catch (e) { throw new Error("That isn't a sealed copy."); }
        if (!data || data.format !== "dominick-hidden-notes" || !data.meta || !Array.isArray(data.notes)) throw new Error("That isn't a sealed copy.");
        return keyFromPass(pass.input.value, data.meta).then(
          function (k) {
            return api("/hidden-notes/replace", { method: "POST", body: JSON.stringify({ meta: data.meta, notes: data.notes }) }).then(function () {
              meta = data.meta;
              key = k;
              return loadNotes().then(function () { selected = null; ui.panel.hidden = true; renderList(); renderEditor(); say(ui.status, "Imported " + notes.length + " notes."); });
            });
          },
          function () { throw new Error("That passphrase doesn't open the copy."); }
        );
      });
    });
  }

  // ---- start
  api("/hidden-notes").then(
    function (vault) {
      meta = vault.meta;
      if (!meta) showSetup();
      else showLock("");
    },
    function (err) { root.textContent = "Couldn't reach the vault: " + err.message; }
  );
})();
