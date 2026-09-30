(function () {
  "use strict";
  // Bulk actions for the Songs, Simulations and Scans lists: a checkbox on each row, Select all,
  // "Duplicate selected" (where the type can be duplicated) and "Delete selected". Each list's own
  // renderer calls window.bulkList(...) after it draws its rows; the selection survives redraws
  // for rows that still exist and is pruned for rows that don't.
  const state = new Map(); // listId -> Set of selected ids (as strings)

  function ensureBar(listEl) {
    let bar = document.getElementById(listEl.id + "-bulk-bar");
    if (!bar) {
      bar = document.createElement("div");
      bar.id = listEl.id + "-bulk-bar";
      bar.className = "bulk-list-bar";
      bar.hidden = true;
      bar.innerHTML =
        '<label class="bulk-list-all"><input type="checkbox" class="bulk-list-all-box" aria-label="Select all"> <span>Select all</span></label>' +
        '<span class="bulk-list-count" role="status" aria-live="polite"></span>' +
        '<button type="button" class="bulk-list-duplicate">Duplicate selected</button>' +
        '<button type="button" class="bulk-list-delete danger">Delete selected</button>';
      listEl.parentNode.insertBefore(bar, listEl);
    }
    return bar;
  }

  // opts: { listId, type ("song"|"simulation"|"scan"), noun, rowIdSelector, duplicate(id) | null, remove(id), reload() }
  window.bulkList = function (opts) {
    const listEl = document.getElementById(opts.listId);
    if (!listEl) return;
    const bar = ensureBar(listEl);
    const selected = state.get(opts.listId) || new Set();
    state.set(opts.listId, selected);
    const rows = [...listEl.querySelectorAll(".simulation-row")];
    const present = new Set();
    rows.forEach((row) => {
      const idEl = row.querySelector(opts.rowIdSelector);
      if (!idEl) return;
      const id = String(idEl.dataset.id);
      present.add(id);
      if (row.querySelector(".bulk-list-row-box")) return;
      const box = document.createElement("input");
      box.type = "checkbox";
      box.className = "bulk-list-row-box";
      box.dataset.id = id;
      box.checked = selected.has(id);
      const name = row.querySelector("span");
      box.setAttribute("aria-label", "Select " + (name ? name.textContent.trim() : opts.noun));
      box.addEventListener("change", () => {
        if (box.checked) selected.add(id);
        else selected.delete(id);
        refresh();
      });
      row.insertBefore(box, row.firstChild);
    });
    [...selected].forEach((id) => !present.has(id) && selected.delete(id));

    const dupBtn = bar.querySelector(".bulk-list-duplicate");
    const delBtn = bar.querySelector(".bulk-list-delete");
    const allBox = bar.querySelector(".bulk-list-all-box");
    dupBtn.hidden = !opts.duplicate;
    // Replace the handlers on every redraw so they always see this render's callbacks.
    const fresh = (btn) => {
      const clone = btn.cloneNode(true);
      btn.parentNode.replaceChild(clone, btn);
      return clone;
    };
    const dup = fresh(dupBtn);
    const del = fresh(delBtn);
    const all = fresh(allBox);
    bar.hidden = rows.length === 0;

    function refresh() {
      const n = selected.size;
      bar.querySelector(".bulk-list-count").textContent = n ? `${n} selected` : "";
      dup.disabled = !n;
      del.disabled = !n;
      all.checked = n > 0 && n === present.size;
      all.indeterminate = n > 0 && n < present.size;
      listEl.querySelectorAll(".bulk-list-row-box").forEach((b) => (b.checked = selected.has(b.dataset.id)));
    }
    all.addEventListener("change", () => {
      if (all.checked) present.forEach((id) => selected.add(id));
      else selected.clear();
      refresh();
    });
    dup.addEventListener("click", async () => {
      const ids = [...selected];
      if (!ids.length || !opts.duplicate) return;
      dup.disabled = del.disabled = true;
      let failed = 0;
      for (const id of ids) {
        try {
          await opts.duplicate(id);
        } catch (e) {
          failed++;
        }
      }
      selected.clear();
      await opts.reload();
      if (failed) alert(`${failed} of ${ids.length} could not be duplicated.`);
    });
    del.addEventListener("click", async () => {
      const ids = [...selected];
      if (!ids.length) return;
      del.disabled = dup.disabled = true;
      try {
        const names = new Map();
        rows.forEach((row) => {
          const idEl = row.querySelector(opts.rowIdSelector);
          const name = row.querySelector("span");
          if (idEl && name) names.set(String(idEl.dataset.id), name.textContent.trim());
        });
        const inUse = [];
        for (const id of ids) {
          const usage = await window.adminApi(`/content-usage?type=${opts.type}&id=${id}`).catch(() => []);
          if (usage.length) inUse.push(`${names.get(id) || id}: ${usage.map((u) => u.title).join(", ")}`);
        }
        const what = `${ids.length} ${opts.noun}${ids.length === 1 ? "" : "s"}`;
        const warn = inUse.length
          ? `\n\nIn use, and those blocks will be omitted from public pages until replaced:\n- ${inUse.join("\n- ")}`
          : "";
        if (!confirm(`Delete ${what}? This can't be undone.${warn}`)) {
          refresh();
          return;
        }
        let failed = 0;
        for (const id of ids) {
          try {
            await opts.remove(id);
            selected.delete(id);
          } catch (e) {
            failed++;
          }
        }
        await opts.reload();
        if (failed) alert(`${failed} of ${ids.length} could not be deleted.`);
      } finally {
        refresh();
      }
    });
    refresh();
  };
})();
