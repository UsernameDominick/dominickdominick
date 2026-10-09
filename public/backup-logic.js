// The rules for backing up what a visitor keeps in this browser (the Studio's songs) to a file and putting it
// back: the file's shape, how a restore is checked, and how restored items are merged with what is already here (never overwriting: a
// restored item that is already here is skipped, any other is added under a new id). No page in it, so a node test can load it.
// `window.BackupLogic`.
(function () {
  "use strict";
  const FORMAT = "dominick-backup";
  const VERSION = 1;
  const MAX_BYTES = 250 * 1024 * 1024;
  const APPS = ["studio"];

  // The file: { format, version, app, made, parts: { name: anything JSON } }.
  function makeBundle(app, parts, made) {
    return { format: FORMAT, version: VERSION, app, made: made || new Date().toISOString(), parts: parts || {} };
  }
  // Read a file's text: { bundle } or { error } in plain words.
  function parseBundle(text, app) {
    if (typeof text !== "string" || !text.trim()) return { error: "That file is empty." };
    if (text.length > MAX_BYTES) return { error: "That file is too big to restore here." };
    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      return { error: "That is not a backup file (it could not be read)." };
    }
    if (!data || typeof data !== "object" || data.format !== FORMAT) return { error: "That is not one of this site's backup files." };
    if (!Number.isInteger(data.version) || data.version > VERSION) return { error: "That backup is from a newer version of the site." };
    if (!APPS.includes(data.app)) return { error: "That backup is for something this site does not have." };
    if (app && data.app !== app) return { error: `That backup is for ${label(data.app)}, not ${label(app)}. Restore it on that page.` };
    if (!data.parts || typeof data.parts !== "object" || Array.isArray(data.parts)) return { error: "That backup has nothing in it." };
    return { bundle: data };
  }
  const NAMES = { studio: "the Studio" };
  function label(app) {
    return NAMES[app] || app;
  }
  function fileName(app, date) {
    const d = date instanceof Date ? date : new Date();
    const stamp = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
    return `dominick-${app}-backup-${stamp}.json`;
  }

  // Merge restored items into the ones already here. `sig(item)` says what makes two items the same thing. Items already here are kept
  // exactly as they are; a restored item that matches one is skipped; the rest are added with ids after the largest one in use.
  function mergeItems(existing, incoming, sig, max) {
    const list = Array.isArray(existing) ? existing.slice() : [];
    const seen = new Set(list.map(sig));
    let next = list.reduce((m, x) => Math.max(m, Number(x && x.id) || 0), 0) + 1;
    let added = 0;
    let skipped = 0;
    let full = 0;
    (Array.isArray(incoming) ? incoming : []).forEach((item) => {
      if (!item || typeof item !== "object") return;
      const s = sig(item);
      if (seen.has(s)) return void skipped++;
      if (max && list.length >= max) return void full++;
      seen.add(s);
      list.push(Object.assign({}, item, { id: next++ }));
      added++;
    });
    return { list, added, skipped, full };
  }
  // Two songs are the same when they have the same name and the same content.
  const dataSig = (x) => String(x.name) + "\u0000" + JSON.stringify(x.data === undefined ? null : x.data);

  // What to tell the person after a restore.
  function summary(r) {
    const bits = [];
    bits.push(r.added ? `Restored ${r.added} item${r.added === 1 ? "" : "s"}` : "Nothing new to restore");
    if (r.skipped) bits.push(`${r.skipped} already here`);
    if (r.full) bits.push(`${r.full} left out because this browser is full of them`);
    return bits.join(", ") + ".";
  }

  window.BackupLogic = { FORMAT, VERSION, MAX_BYTES, APPS, makeBundle, parseBundle, fileName, mergeItems, dataSig, summary, label };
})();
