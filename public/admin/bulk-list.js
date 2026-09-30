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
      bar.setAttribute("role", "toolbar");
      bar.setAttribute("aria-label", "Bulk actions for this list");
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

  // opts: { listId, type ("song"|"simulation"|"scan"|...), noun, rowIdSelector, duplicate(id) | null, remove(id), reload(), usageUrl(id)?, inUseNote? }
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
    // After a bulk action the list re-renders and this bar's buttons are replaced, so put keyboard
    // focus on the fresh bar rather than letting it fall back to the top of the page.
    const refocus = () => {
      const bar = document.getElementById(opts.listId + "-bulk-bar");
      const fresh = bar && !bar.hidden ? bar.querySelector(".bulk-list-all-box") : null;
      if (fresh) {
        fresh.focus();
        return;
      }
      // The list emptied and the bar is hidden: keep focus inside the dialog, on its close button.
      const modal = document.getElementById(opts.listId).closest(".modal");
      const close = modal && modal.querySelector("header button");
      if (close) close.focus();
    };
    const nameOf = (id) => {
      const row = rows.find((r) => {
        const el = r.querySelector(opts.rowIdSelector);
        return el && String(el.dataset.id) === String(id);
      });
      const span = row && row.querySelector("span");
      return span ? span.textContent.trim() : String(id);
    };
    const failureText = (verb, failedIds, total) => {
      const shown = failedIds.slice(0, 5).map(nameOf).join(", ");
      return `${failedIds.length} of ${total} could not be ${verb}: ${shown}${failedIds.length > 5 ? ", …" : ""}. They stay selected so you can try again.`;
    };
    dup.addEventListener("click", async () => {
      const ids = [...selected];
      if (!ids.length || !opts.duplicate) return;
      dup.disabled = del.disabled = true;
      const failedIds = [];
      try {
        for (const id of ids) {
          try {
            await opts.duplicate(id);
            selected.delete(id);
          } catch (e) {
            failedIds.push(id);
          }
        }
        await opts.reload();
      } finally {
        refocus();
      }
      if (failedIds.length) alert(failureText("duplicated", failedIds, ids.length));
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
        let lookupFailed = false;
        for (const id of ids) {
          const usage = await window.adminApi(opts.usageUrl ? opts.usageUrl(id) : `/content-usage?type=${opts.type}&id=${id}`).catch(() => null);
          if (usage === null) lookupFailed = true;
          else if (usage.length) inUse.push(`${names.get(id) || id}: ${usage.map((u) => u.title).join(", ")}`);
        }
        const what = `${ids.length} ${opts.noun}${ids.length === 1 ? "" : "s"}`;
        const warn = inUse.length
          ? `\n\nIn use, and ${opts.inUseNote || "those blocks will be omitted from public pages until replaced"}:\n- ${inUse.join("\n- ")}`
          : "";
        const unknown = lookupFailed ? "\n\nCouldn't check where some of these are used, so they may be in use on pages." : "";
        if (!confirm(`Delete ${what}? This can't be undone.${warn}${unknown}`)) {
          refresh();
          return;
        }
        const failedIds = [];
        for (const id of ids) {
          try {
            await opts.remove(id);
            selected.delete(id);
          } catch (e) {
            failedIds.push(id);
          }
        }
        await opts.reload();
        refocus();
        if (failedIds.length) alert(failureText("deleted", failedIds, ids.length));
      } finally {
        refresh();
      }
    });
    refresh();
  };
})();
