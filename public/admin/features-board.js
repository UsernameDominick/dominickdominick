// The Features board, read-only: a to-do side (bugs, things that need attention, almost-done work, ideas, decisions waiting on you) and a
// side with what is being worked on right now and what is done. The list comes from features.json (kept up to date with each change, served
// by /api/admin/features). An entry with `request` set to a request id shows that request's text with the entry's status and kind.
(function () {
  const KIND_LABELS = { decision: "Needs your decision", bug: "Bug", attention: "Needs attention", almost: "Almost done", idea: "Idea" };
  // What needs the owner first, then what is broken, then the rest.
  const KIND_ORDER = ["decision", "bug", "attention", "almost", "idea"];
  const DONE_SHOWN = 10;

  const lower = (v) => String(v == null ? "" : v).toLowerCase();
  const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const day = (iso) => String(iso || "").slice(0, 10);

  // Everything on the board as cards with one shape, sorted into lanes: todo, doing, done, parked, dropped.
  // card: { key, id, source: "item"|"request", title, summary, notes, area, kind, status, date, mine, picked, requestId }
  function buildBoard(data) {
    const items = Array.isArray(data && data.items) ? data.items : [];
    const requests = Array.isArray(data && data.requests) ? data.requests : [];
    const byRequest = new Map(requests.map((r) => [r.id, r]));
    const picked = new Map();
    for (const it of items) if (it.request && byRequest.has(it.request)) picked.set(it.request, it);

    const cards = [];
    items.forEach((it, order) => {
      if (it.request && byRequest.has(it.request)) return; // shown as the owner's request, in the lane this entry says
      cards.push({ key: `i:${it.id}`, id: it.id, source: "item", title: it.title, summary: it.summary || "", notes: it.notes || "", area: it.area, kind: it.kind || null, status: it.status, date: it.date || "", mine: false, picked: false, order });
    });
    requests.forEach((r, order) => {
      const mine = picked.get(r.id);
      if (mine) {
        cards.push({ key: `r:${r.id}`, id: r.id, source: "request", title: r.title, summary: mine.summary || "", notes: mine.notes || r.notes, area: mine.area || "Your requests", kind: mine.kind || r.kind, status: mine.status, date: mine.date || day(r.created_at), mine: true, picked: true, order: -1000 + order, requestId: r.id });
      } else {
        const status = r.status === "done" ? "done" : r.status === "dropped" ? "dropped" : "todo";
        cards.push({ key: `r:${r.id}`, id: r.id, source: "request", title: r.title, summary: "", notes: r.notes, area: "Your requests", kind: r.kind, status, date: status === "done" ? day(r.created_at) : "", mine: true, picked: false, order: -1000 + order, requestId: r.id });
      }
    });

    const kindRank = (c) => (KIND_ORDER.includes(c.kind) ? KIND_ORDER.indexOf(c.kind) : KIND_ORDER.length);
    const lane = (status) => cards.filter((c) => c.status === status);
    const board = { todo: lane("todo"), doing: lane("doing"), done: lane("done"), parked: lane("parked"), dropped: lane("dropped") };
    board.todo.sort((a, b) => kindRank(a) - kindRank(b) || a.order - b.order);
    board.doing.sort((a, b) => a.order - b.order);
    // Newest first; the ones with no date keep the order they have in the file.
    board.done.sort((a, b) => (a.date && b.date ? (a.date < b.date ? 1 : a.date > b.date ? -1 : 0) : a.date ? -1 : b.date ? 1 : 0) || a.order - b.order);
    return board;
  }

  // Cards matching a kind ("all" or one of KIND_LABELS), an area ("" for any) and words in the title, summary, notes or area.
  function filterCards(cards, { kind = "all", area = "", q = "" } = {}) {
    const words = lower(q).split(/\s+/).filter(Boolean);
    return cards.filter((c) => {
      if (kind !== "all" && c.kind !== kind) return false;
      if (area && c.area !== area) return false;
      if (!words.length) return true;
      const hay = lower(`${c.title} ${c.summary} ${c.notes} ${c.area} ${KIND_LABELS[c.kind] || ""}`);
      return words.every((w) => hay.includes(w));
    });
  }

  function groupByKind(cards) {
    return KIND_ORDER.map((kind) => ({ kind, label: KIND_LABELS[kind], cards: cards.filter((c) => c.kind === kind) })).filter((g) => g.cards.length);
  }

  const areasOf = (data) => [...new Set((data.items || []).map((it) => it.area))].sort();

  // Plain text to paste into the chat: what is open, and the owner's requests that have not been picked up yet (with their ids,
  // so they can be tracked in features.json).
  function summaryText(data) {
    const board = buildBoard(data);
    const lines = [`Board (updated ${data.updated})`];
    const list = (label, cards, withId) => {
      if (!cards.length) return;
      lines.push("", `${label}:`);
      for (const c of cards) lines.push(`- ${c.title}${c.mine ? ` [${c.kind}]` : ` [${c.area}]`}${c.notes ? ` — ${c.notes.replace(/\s+/g, " ")}` : ""}${withId && c.requestId ? ` (id: ${c.requestId})` : ""}`);
    };
    list("Working on now", board.doing, true);
    const fresh = board.todo.filter((c) => c.mine && !c.picked);
    list("My new requests, not picked up yet", fresh, true);
    for (const g of groupByKind(board.todo.filter((c) => !(c.mine && !c.picked)))) list(g.label, g.cards, true);
    return lines.join("\n");
  }

  const api = { buildBoard, filterCards, groupByKind, areasOf, summaryText, KIND_LABELS, KIND_ORDER };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  if (typeof window === "undefined" || typeof document === "undefined") return;
  window.FeaturesBoard = api;

  // ---------- the dialog ----------
  const $ = (id) => document.getElementById(id);
  const modal = $("features-modal");
  if (!modal) return;
  let data = null;
  let filter = { kind: "all", area: "", q: "" };
  let showAllDone = false;
  let opener = null;

  const say = (text) => ($("features-status").textContent = text);

  function cardHtml(c) {
    const kind = c.kind && KIND_LABELS[c.kind] ? `<span class="fb-kind fb-kind-${c.kind}">${esc(KIND_LABELS[c.kind])}</span>` : "";
    const notesLabel = c.kind === "decision" ? "To decide:" : "Note:";
    const detail = c.summary ? `<p class="fb-text">${esc(c.summary)}</p>` : "";
    const notes = c.notes ? `<p class="fb-notes">${c.source === "item" ? `<b>${notesLabel}</b> ` : ""}${esc(c.notes)}</p>` : "";
    const when = c.status === "done" && c.date ? `<span class="fb-date">${esc(c.date)}</span>` : "";
    const controls = c.mine && c.picked ? `<p class="fb-picked">Picked up</p>` : "";
    return `<li class="fb-card${c.mine ? " fb-mine" : ""}" data-key="${esc(c.key)}" data-id="${esc(c.requestId || "")}"><div class="fb-card-head"><span class="fb-title">${esc(c.title)}</span>${when}</div><div class="fb-tags">${kind}<span class="fb-area">${esc(c.mine ? "Yours" : c.area)}</span></div>${detail}${notes}${controls}</li>`;
  }

  function render() {
    const board = buildBoard(data);
    const done = filterCards(board.done, filter);
    const todo = filterCards(board.todo, filter);
    const doing = filterCards(board.doing, { area: filter.area, q: filter.q });
    const parked = filterCards(board.parked, { area: filter.area, q: filter.q, kind: "all" });
    const dropped = filterCards(board.dropped, { q: filter.q });
    const total = board.todo.length + board.doing.length + board.done.length;

    $("features-progress").style.width = `${total ? Math.round((board.done.length / total) * 100) : 0}%`;
    $("features-progress-label").textContent = `${board.done.length} of ${total} done · ${board.doing.length} in progress · ${board.todo.length} to do`;

    // kind chips (left side)
    const chips = [["all", "All", board.todo.length], ...KIND_ORDER.map((k) => [k, KIND_LABELS[k], board.todo.filter((c) => c.kind === k).length])];
    $("features-kinds").innerHTML = chips.map(([k, label, n]) => `<button type="button" class="fb-chip" data-kind="${k}" aria-pressed="${filter.kind === k}"><b>${n}</b> ${esc(label)}</button>`).join("");

    $("features-todo-count").textContent = String(todo.length);
    $("features-todo").innerHTML = todo.length
      ? groupByKind(todo)
          .map((g) => `<section class="fb-group" aria-label="${esc(g.label)}"><h3>${esc(g.label)} <span class="fb-count">${g.cards.length}</span></h3><ul class="fb-list">${g.cards.map(cardHtml).join("")}</ul></section>`)
          .join("")
      : '<p class="fb-empty">Nothing here.</p>';
    $("features-parked-wrap").hidden = !parked.length;
    $("features-parked-count").textContent = String(parked.length);
    $("features-parked").innerHTML = parked.map(cardHtml).join("");
    $("features-dropped-wrap").hidden = !dropped.length;
    $("features-dropped-count").textContent = String(dropped.length);
    $("features-dropped").innerHTML = dropped.map(cardHtml).join("");

    $("features-doing-count").textContent = String(doing.length);
    $("features-doing").innerHTML = doing.length ? doing.map(cardHtml).join("") : '<li class="fb-empty">Nothing right now. Claude moves an item here when starting on it.</li>';

    const searching = Boolean(filter.q.trim()) || Boolean(filter.area) || filter.kind !== "all";
    const shown = searching || showAllDone ? done : done.slice(0, DONE_SHOWN);
    $("features-done-count").textContent = String(done.length);
    $("features-done").innerHTML = shown.length ? shown.map(cardHtml).join("") : '<li class="fb-empty">Nothing finished matches that.</li>';
    const more = $("features-done-more");
    more.hidden = searching || done.length <= DONE_SHOWN;
    more.textContent = showAllDone ? "Show only the latest" : `Show all ${done.length}`;
    more.setAttribute("aria-expanded", String(showAllDone));

    $("features-updated").textContent = `Last updated ${data.updated}. Claude moves items between the sides.`;
    const area = $("features-area");
    area.innerHTML = '<option value="">All areas</option>' + areasOf(data).map((a) => `<option value="${esc(a)}"${a === filter.area ? " selected" : ""}>${esc(a)}</option>`).join("");
  }

  async function load() {
    try {
      const res = await fetch("/api/admin/features");
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Request failed");
      data = await res.json();
      render();
      say("");
    } catch (err) {
      say(`Couldn't load the board: ${err.message}`);
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
  $("features-kinds").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-kind]");
    if (!b) return;
    filter.kind = filter.kind === b.dataset.kind ? "all" : b.dataset.kind;
    render();
  });
  $("features-search").addEventListener("input", (e) => {
    filter.q = e.target.value;
    render();
  });
  $("features-area").addEventListener("change", (e) => {
    filter.area = e.target.value;
    render();
  });
  $("features-done-more").addEventListener("click", () => {
    showAllDone = !showAllDone;
    render();
  });
  $("features-copy").addEventListener("click", async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(summaryText(data));
      say("Copied. Paste it into the chat.");
    } catch {
      say("Couldn't copy from here. Select the text and copy it.");
    }
  });
})();
