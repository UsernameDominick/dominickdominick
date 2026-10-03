// The Features board: everything that has been built, what is still open, and the owner's own requests, in one dialog.
// The list comes from features.json (kept up to date with each change, served by /api/admin/features); the requests are stored on the site.
(function () {
  const LABELS = { done: "Done", doing: "In progress", planned: "Planned", decision: "Needs your decision", parked: "Parked" };
  // What needs the owner first, then what is moving, then what is finished.
  const ORDER = ["decision", "doing", "planned", "parked", "done"];
  const REQUEST_LABELS = { requested: "Requested", done: "Done", dropped: "Dropped" };

  const lower = (v) => String(v == null ? "" : v).toLowerCase();
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // Items matching a status ("all" or one of LABELS), an area ("" for any) and words in the title, summary or notes.
  function filterItems(items, { status = "all", area = "", q = "" } = {}) {
    const words = lower(q).split(/\s+/).filter(Boolean);
    return items.filter((it) => {
      if (status !== "all" && it.status !== status) return false;
      if (area && it.area !== area) return false;
      if (!words.length) return true;
      const hay = lower(`${it.title} ${it.summary || ""} ${it.notes || ""} ${it.area}`);
      return words.every((w) => hay.includes(w));
    });
  }

  function groupByStatus(items) {
    return ORDER.map((status) => ({ status, label: LABELS[status], items: items.filter((it) => it.status === status) })).filter((g) => g.items.length);
  }

  function areasOf(items) {
    return [...new Set(items.map((it) => it.area))].sort();
  }

  // Plain text for pasting into a chat: the open items by status, then the owner's requests.
  function summaryText(data) {
    const lines = [`Features (updated ${data.updated})`];
    for (const g of groupByStatus(data.items)) {
      if (g.status === "done") continue;
      lines.push("", `${g.label}:`);
      for (const it of g.items) lines.push(`- ${it.title} [${it.area}]${it.notes ? ` — ${it.notes}` : ""}`);
    }
    const open = (data.requests || []).filter((r) => r.status === "requested");
    if (open.length) {
      lines.push("", "My requests:");
      for (const r of open) lines.push(`- ${r.title}${r.notes ? ` — ${r.notes.replace(/\s+/g, " ")}` : ""}`);
    }
    return lines.join("\n");
  }

  const api = { filterItems, groupByStatus, areasOf, summaryText, LABELS, ORDER };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.FeaturesBoard = api;

  // ---------- the dialog ----------
  const $ = (id) => document.getElementById(id);
  const modal = $("features-modal");
  if (!modal) return;
  let data = null;
  let filter = { status: "all", area: "", q: "" };
  let opener = null;

  function say(text) {
    $("features-status").textContent = text;
  }

  function renderSummary() {
    const total = data.items.length;
    const chips = [["all", "All", total], ...ORDER.map((s) => [s, LABELS[s], data.counts[s] || 0])];
    $("features-summary").innerHTML = chips
      .map(([key, label, n]) => `<button type="button" class="fb-chip fb-${key}" data-status="${key}" aria-pressed="${filter.status === key}"><b>${n}</b><span>${esc(label)}</span></button>`)
      .join("");
    const done = data.counts.done || 0;
    $("features-progress").style.width = `${total ? Math.round((done / total) * 100) : 0}%`;
    $("features-progress-label").textContent = `${done} of ${total} done`;
  }

  function renderList() {
    const matches = filterItems(data.items, filter);
    const searching = Boolean(filter.q.trim()) || filter.status !== "all" || Boolean(filter.area);
    const groups = groupByStatus(matches);
    $("features-groups").innerHTML = groups.length
      ? groups
          .map((g) => {
            const cards = g.items
              .map(
                (it) =>
                  `<li class="fb-card"><div class="fb-card-head"><span class="fb-title">${esc(it.title)}</span><span class="fb-area">${esc(it.area)}</span></div>${it.summary ? `<p class="fb-summary-text">${esc(it.summary)}</p>` : ""}${it.notes ? `<p class="fb-notes"><b>${it.status === "decision" ? "To decide:" : "Note:"}</b> ${esc(it.notes)}</p>` : ""}</li>`
              )
              .join("");
            const head = `<span class="fb-badge fb-${g.status}">${esc(g.label)}</span> <span class="fb-count">${g.items.length}</span>`;
            // The long finished list stays folded until you search or filter for it.
            if (g.status === "done" && !searching) return `<details class="fb-group"><summary><h2>${head}</h2></summary><ul class="fb-list">${cards}</ul></details>`;
            return `<section class="fb-group"><h2>${head}</h2><ul class="fb-list">${cards}</ul></section>`;
          })
          .join("")
      : '<p class="fb-empty">Nothing matches that.</p>';
  }

  function renderRequests() {
    const list = data.requests || [];
    $("features-requests").innerHTML = list.length
      ? list
          .map(
            (r) =>
              `<li class="fb-request fb-request-${r.status}" data-id="${esc(r.id)}"><div class="fb-request-main"><span class="fb-title">${esc(r.title)}</span>${r.notes ? `<p class="fb-notes">${esc(r.notes)}</p>` : ""}</div><label class="fb-sr-label" for="fb-status-${esc(r.id)}">Status of ${esc(r.title)}</label><select id="fb-status-${esc(r.id)}" data-act="status">${Object.entries(REQUEST_LABELS).map(([k, v]) => `<option value="${k}"${r.status === k ? " selected" : ""}>${v}</option>`).join("")}</select><button type="button" data-act="delete" aria-label="Delete request ${esc(r.title)}">Delete</button></li>`
          )
          .join("")
      : '<li class="fb-empty">Nothing yet. Add something you want built and it will show up here.</li>';
  }

  function render() {
    renderSummary();
    renderList();
    renderRequests();
    $("features-updated").textContent = `The list below was last updated ${data.updated}.`;
    const area = $("features-area");
    const keep = filter.area;
    area.innerHTML = '<option value="">All areas</option>' + areasOf(data.items).map((a) => `<option value="${esc(a)}"${a === keep ? " selected" : ""}>${esc(a)}</option>`).join("");
  }

  async function load() {
    try {
      data = await window.adminApi("/features");
      render();
      say("");
    } catch (err) {
      say(`Couldn't load the list: ${err.message}`);
    }
  }

  function open() {
    opener = document.activeElement;
    modal.hidden = false;
    load().then(() => $("features-search").focus());
  }
  function close() {
    modal.hidden = true;
    if (opener && opener.focus) opener.focus();
  }

  $("features-btn").addEventListener("click", open);
  $("close-features").addEventListener("click", close);
  $("features-summary").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-status]");
    if (!b) return;
    filter.status = filter.status === b.dataset.status ? "all" : b.dataset.status;
    renderSummary();
    renderList();
  });
  $("features-search").addEventListener("input", (e) => {
    filter.q = e.target.value;
    renderList();
  });
  $("features-area").addEventListener("change", (e) => {
    filter.area = e.target.value;
    renderList();
  });
  $("features-copy").addEventListener("click", async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(summaryText(data));
      say("Copied. Paste it into the chat.");
    } catch {
      say("Couldn't copy from here. Select the list and copy it.");
    }
  });

  $("features-request-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("features-request-title").value.trim();
    if (!title) return say("Say what you want first.");
    try {
      await window.adminApi("/feature-requests", { method: "POST", body: JSON.stringify({ title, notes: $("features-request-notes").value }) });
      $("features-request-title").value = "";
      $("features-request-notes").value = "";
      await load();
      say("Added.");
    } catch (err) {
      say(`Couldn't add that: ${err.message}`);
    }
  });
  $("features-requests").addEventListener("change", async (e) => {
    const li = e.target.closest("li[data-id]");
    if (!li || e.target.dataset.act !== "status") return;
    try {
      await window.adminApi(`/feature-requests/${li.dataset.id}`, { method: "PATCH", body: JSON.stringify({ status: e.target.value }) });
      await load();
    } catch (err) {
      say(`Couldn't update that: ${err.message}`);
    }
  });
  $("features-requests").addEventListener("click", async (e) => {
    const btn = e.target.closest('button[data-act="delete"]');
    const li = btn && btn.closest("li[data-id]");
    if (!li) return;
    if (!confirm("Delete this request?")) return;
    try {
      await window.adminApi(`/feature-requests/${li.dataset.id}`, { method: "DELETE" });
      await load();
    } catch (err) {
      say(`Couldn't delete that: ${err.message}`);
    }
  });
})();
