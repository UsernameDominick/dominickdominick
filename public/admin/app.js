(function () {
  "use strict";

  const COLS = 24;
  const ROW_H = 16;

  const el = (id) => document.getElementById(id);
  const DIALOG_SELECTOR = ".modal, .writing-focus-overlay";
  const OPEN_DIALOG_SELECTOR = ".modal:not([hidden]), .writing-focus-overlay:not([hidden])";
  // Wires a "×" button that just needs to hide its modal — most of them.
  // Ones that also need to reset state (media picker, command palette,
  // simulation builder) wire their own close handler instead of using this.
  const closeModalOnClick = (btnId, modalId) => el(btnId).addEventListener("click", () => (el(modalId).hidden = true));
  const modalFocusReturn = new WeakMap();

  // Every .modal shares one z-index, so a dialog opened from inside
  // another (Browse… from Site Settings, the Photo Editor from a media
  // tile) used to land underneath it whenever it came earlier in
  // index.html -- visible but unclickable. The most recently opened
  // dialog now always stacks above the ones already open.
  function raiseDialogAboveOthers(target) {
    target.style.zIndex = "";
    const base = Number(getComputedStyle(target).zIndex) || 100;
    const others = [...document.querySelectorAll(OPEN_DIALOG_SELECTOR)].filter((dialog) => dialog !== target);
    const top = Math.max(0, ...others.map((dialog) => Number(getComputedStyle(dialog).zIndex) || 0));
    if (top >= base) target.style.zIndex = String(top + 1);
  }
  const modalStackObserver = new MutationObserver((mutations) => {
    for (const { target } of mutations) {
      if (target.hidden) target.style.zIndex = "";
      else raiseDialogAboveOthers(target);
    }
    syncModalSemantics();
  });
  document.querySelectorAll(DIALOG_SELECTOR).forEach((m) => modalStackObserver.observe(m, { attributes: true, attributeFilter: ["hidden"] }));
  syncModalSemantics();

  // A stronger confirmation for bulk operations that are actually
  // irreversible (media bulk-delete, empty trash) — a plain confirm()'s
  // "OK" button is a single reflexive click/Enter-press away, easy to
  // fire on autopilot after clicking through a routine bulk action.
  // Requiring the exact word "DELETE" to be typed forces a deliberate
  // pause before something with no undo path actually happens. Returns
  // a Promise<boolean>; Cancel, Escape, the × button, and a backdrop
  // click (the generic .modal backdrop-click-to-close handler covers
  // this one too, same as every other modal in the app) all resolve false.
  // Only one confirmTyped() can be pending at a time — a second call
  // settles the first as false (no caller relies on overlapping calls,
  // and neither of this modal's two call sites disables its trigger
  // button while a confirm is open) rather than leaving that first
  // await hanging forever.
  let typedConfirmResolve = null;
  window.confirmTyped = (...args) => confirmTyped(...args);
  function confirmTyped(message, { title = "Confirm", requiredWord = "DELETE" } = {}) {
    if (typedConfirmResolve) settleTypedConfirm(false);
    return new Promise((resolve) => {
      typedConfirmResolve = resolve;
      el("typed-confirm-title").textContent = title;
      el("typed-confirm-message").textContent = message;
      el("typed-confirm-label").textContent = `Type ${requiredWord} to confirm:`;
      const input = el("typed-confirm-input");
      const okBtn = el("typed-confirm-ok");
      input.value = "";
      okBtn.disabled = true;
      input.dataset.requiredWord = requiredWord;
      const modal = el("typed-confirm-modal");
      modalFocusReturn.set(modal, document.activeElement);
      modal.hidden = false;
      input.focus();
    });
  }
  function settleTypedConfirm(result) {
    el("typed-confirm-modal").hidden = true;
    const resolve = typedConfirmResolve;
    typedConfirmResolve = null;
    if (resolve) resolve(result);
  }
  el("typed-confirm-input").addEventListener("input", (e) => {
    el("typed-confirm-ok").disabled = e.target.value !== e.target.dataset.requiredWord;
  });
  el("typed-confirm-input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !el("typed-confirm-ok").disabled) settleTypedConfirm(true);
    else if (e.key === "Escape") {
      // Without this, Escape bubbles to the document-level shortcut
      // handler, which by then sees no open .modal (this one already
      // hid itself) and falls through to its own Escape behavior —
      // clearing the canvas block selection and closing the Inspector
      // as an unrelated side effect of canceling a delete confirmation.
      e.stopPropagation();
      settleTypedConfirm(false);
    }
  });
  el("typed-confirm-ok").addEventListener("click", () => settleTypedConfirm(true));
  el("typed-confirm-cancel").addEventListener("click", () => settleTypedConfirm(false));
  el("close-typed-confirm").addEventListener("click", () => settleTypedConfirm(false));

  const canvas = el("canvas");
  const loginScreen = el("login-screen");
  const app = el("app");

  // ---------- Mobile drawers ----------
  const isMobile = () => window.matchMedia("(max-width: 860px)").matches;
  const backdrop = el("drawer-backdrop");

  // Articles and Projects share the same list-beside-editor markup
  // (.articles-layout > .articles-list-wrap + .article-editor). On mobile
  // that used to mean the list stayed permanently visible above the editor
  // — a ~250px scroll-trap you had to get past on every visit, even after
  // picking a real item to edit. This toggle just hides the list and
  // expands the editor to the full pane (CSS-scoped to the mobile
  // breakpoint, a no-op on desktop) — harmless to call unconditionally
  // rather than gating every call site on isMobile() itself.
  function showMobileEditorPane(modalId) {
    el(modalId).querySelector(".articles-layout")?.classList.add("mobile-editing");
  }
  function showMobileListPane(modalId) {
    el(modalId).querySelector(".articles-layout")?.classList.remove("mobile-editing");
  }
  document.querySelectorAll(".mobile-back-to-list-btn").forEach((btn) => {
    btn.addEventListener("click", () => showMobileListPane(btn.closest(".modal").id));
  });

  // Closing whichever drawer is already open before opening a new one keeps
  // two same-side drawers (the block palette and the sidebar both slide in
  // from the left) from ever being open at once if something taps both
  // triggers back to back without hitting the backdrop in between.
  function openDrawer(drawerEl) {
    closeDrawers();
    drawerEl.classList.add("drawer-open");
    backdrop.hidden = false;
  }
  function closeDrawers() {
    el("palette").classList.remove("drawer-open");
    el("inspector").classList.remove("drawer-open");
    el("admin-sidebar").classList.remove("drawer-open");
    backdrop.hidden = true;
  }
  el("mobile-menu-btn").addEventListener("click", () => openDrawer(el("palette")));
  el("close-palette").addEventListener("click", closeDrawers);
  el("close-inspector").addEventListener("click", closeDrawers);
  el("site-menu-btn").addEventListener("click", () => openDrawer(el("admin-sidebar")));
  el("close-site-menu").addEventListener("click", closeDrawers);
  backdrop.addEventListener("click", closeDrawers);
  // Tapping a nav item inside the mobile sidebar drawer should close it, not
  // leave it open behind the modal/panel it opened. Excludes the one button
  // that opens a *nested* dropdown inside this same drawer (Recent) —
  // closing the whole drawer on every click on it would fire alongside its
  // own open/close toggle (both listeners sit on the same element, so the
  // toggle handler's own stopPropagation() doesn't prevent this one from
  // also running) and immediately collapse the drawer it just opened. The theme and
  // density toggles stay open too: they change how the drawer itself looks, so closing
  // it would hide the very change being made.
  el("admin-sidebar").querySelectorAll("button, a").forEach((node) => {
    if (["close-site-menu", "recent-items-btn", "admin-theme-toggle", "admin-density-toggle"].includes(node.id)) return;
    node.addEventListener("click", () => {
      if (isMobile()) closeDrawers();
    });
  });

  // ---------- Notification bell ----------
  // Rolls up backup-failure/broken-links/recent-errors/recent-failed-
  // webhooks into one badge count, all signals that already exist as
  // their own panels (Backup status, Link Checker, Error Log, Webhook
  // Deliveries) — this just means not having to separately check all four
  // to notice something needs attention. No "read/unread" tracking: it's
  // a live status snapshot, recomputed fresh every time it's opened.
  const notifBtn = el("notifications-btn");
  const notifPanel = el("notifications-panel");
  function closeNotifMenu() {
    notifPanel.classList.remove("open");
    notifBtn.setAttribute("aria-expanded", "false");
  }
  // Every notification used to just open Site Settings on whatever tab
  // happened to be active (always Appearance, on a fresh open) instead of
  // the tab the notification is actually about — an admin clicking "3
  // errors" landed on Appearance and had to go find Logs themselves, the
  // exact "hunting through 7 tabs" problem the settings search feature
  // elsewhere in this file was built to solve. site-settings-btn's own
  // handler is async (fetches settings before un-hiding the modal), so
  // switching tabs has to wait for that, same as the settings-search
  // results above do.
  function openSettingsTab(tab) {
    el("site-settings-btn").click();
    setTimeout(() => switchSettingsTab(tab), 200);
  }
  async function loadNotifications() {
    const s = await api("/notifications-summary");
    const items = [
      s.backupFailed ? { label: "Last scheduled backup failed", action: () => openSettingsTab("backups") } : null,
      s.brokenLinks
        ? {
            label: `${s.brokenLinks} broken link(s) found`,
            action: () => {
              el("seo-dashboard-btn").click();
              // Reports are collapsible cards now -- open the one this is about.
              const card = el("scheduled-link-check-status").closest("details");
              if (card) {
                card.open = true;
                setTimeout(() => card.scrollIntoView({ block: "start" }), 150);
              }
            },
          }
        : null,
      s.recentErrors ? { label: `${s.recentErrors} error(s) in the last 24h`, action: () => openSettingsTab("logs") } : null,
      s.recentFailedWebhooks ? { label: `${s.recentFailedWebhooks} failed webhook deliverie${s.recentFailedWebhooks === 1 ? "" : "s"} in the last 24h`, action: () => openSettingsTab("integrations") } : null,
    ].filter(Boolean);
    const badge = el("notifications-badge");
    badge.textContent = String(items.length);
    badge.hidden = items.length === 0;
    // The button's own accessible name is otherwise just its emoji plus
    // the badge's bare number ("🔔 3") — this gives it a real one instead.
    notifBtn.setAttribute(
      "aria-label",
      items.length ? `Notifications, ${items.length} item${items.length === 1 ? "" : "s"} need attention` : "Notifications, nothing needs attention"
    );
    el("notifications-list").innerHTML =
      items.map((it, i) => `<button type="button" class="notifications-item" data-i="${i}">${escapeHtml(it.label)}</button>`).join("") ||
      "<p style='color:var(--text-dim);font-size:0.85rem;padding:8px 12px;'>Nothing needs attention.</p>";
    el("notifications-list")
      .querySelectorAll(".notifications-item")
      .forEach((btn) => btn.addEventListener("click", () => items[Number(btn.dataset.i)].action()));
  }
  notifBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    const isOpen = notifPanel.classList.toggle("open");
    notifBtn.setAttribute("aria-expanded", String(isOpen));
    if (isOpen) loadNotifications().catch(() => {});
  });
  document.addEventListener("click", (e) => {
    if (notifPanel.classList.contains("open") && !notifPanel.contains(e.target) && e.target !== notifBtn) closeNotifMenu();
  });
  let pages = [];
  let currentPage = null;
  let blocks = [];
  let selectedBlockId = null;
  // Shift-click adds/removes a block here. Non-empty takes over the
  // inspector (bulk mode) regardless of size, including 1 — kept as a
  // separate concept from selectedBlockId rather than collapsing back to
  // single-select at size 1, so the mode doesn't flip-flop mid-selection.
  let multiSelectedIds = new Set();
  // Isolation mode dims every block except selectedBlockId on the canvas —
  // it's a rendering toggle, not a separate "which block" state, so moving
  // the selection while it's on just moves which block stays highlighted.
  let isolationMode = false;
  // Content-only mode treats every block as locked for layout purposes
  // (drag/resize/delete/align/distribute) without writing that to any
  // block's own `locked` field — same accidental-vs-deliberate philosophy
  // as per-block locking, just applied session-wide with one toggle.
  let contentOnlyMode = false;
  function isLayoutLocked(b) {
    return !!b.locked || contentOnlyMode;
  }

  // Phone photos routinely carry EXIF GPS coordinates (plus device model,
  // timestamp, etc.) that have nothing to do with why an image is being
  // published — a privacy leak the upload flow otherwise ships straight
  // through to public R2 storage untouched. Re-decoding through a canvas
  // and re-exporting drops every metadata segment as a side effect of the
  // format round-trip, using the browser's own (EXIF-orientation-aware)
  // decoder rather than a hand-rolled binary parser that could easily get
  // the TIFF/IFD byte-offset math wrong. Scoped to JPEG/PNG only: GIF and
  // WebP can be animated, and a canvas round-trip only ever captures one
  // static frame — silently breaking animation would be a worse trade than
  // the metadata it would strip. Falls back to the original file untouched
  // on any decode error, since stripping metadata should never be the
  // reason a legitimate upload fails.
  async function stripImageMetadata(file) {
    // A plain Blob (not a File) can only have come from in-app canvas
    // processing — the Photo Editor's own save flow exports via
    // canvas.toBlob(), which by construction already carries zero
    // metadata — so re-decoding+re-encoding it here would be a pointless
    // extra pass for no benefit. Every real upload path (file inputs,
    // single or bulk) always hands over a real File.
    if (!(file instanceof File)) return file;
    if (file.type !== "image/jpeg" && file.type !== "image/png") return file;
    try {
      const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d");
      ctx.drawImage(bitmap, 0, 0);
      const blob = await canvas.convertToBlob({ type: file.type, quality: 0.92 });
      return blob.size ? blob : file;
    } catch {
      return file;
    }
  }

  async function uploadFile(file, folder) {
    file = await stripImageMetadata(file);
    const res = await fetch("/api/admin/upload" + (folder ? `?folder=${encodeURIComponent(folder)}` : ""), {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }
    return res.json();
  }

  async function uploadAudioFile(file) {
    const res = await fetch("/api/admin/upload-audio", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }
    return res.json();
  }

  async function uploadVideoFile(file) {
    const res = await fetch("/api/admin/upload-video", {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }
    return res.json();
  }

  // Fills a field with a URL — either replacing its value (used by single
  // image fields) or appending it as a new line (used by the gallery block's
  // one-URL-per-line textarea).
  function setFieldUrl(input, url, append) {
    input.value = append ? (input.value ? input.value + "\n" + url : url) : url;
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Wires any <button class="upload-trigger" data-target="#id"> to open a file
  // picker and fill the target input with the uploaded file's URL. A
  // data-append="1" attribute appends instead of replacing.
  function wireUploadButton(btn) {
    const targetInput = document.querySelector(btn.dataset.target);
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
    fileInput.hidden = true;
    btn.after(fileInput);
    btn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      const originalText = btn.textContent;
      btn.textContent = "Uploading…";
      btn.disabled = true;
      try {
        const { url } = await uploadFile(file);
        setFieldUrl(targetInput, url, btn.dataset.append === "1");
      } catch (err) {
        alert(err.message);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
        fileInput.value = "";
      }
    });
  }

  // Wires any <button class="browse-trigger" data-target="#id"> to open the
  // media library in picker mode, filling the target input on click.
  function wireBrowseButton(btn) {
    btn.addEventListener("click", () => openMediaModal(btn.dataset.target, btn.dataset.append === "1"));
  }

  // Wires any <span class="image-url-source-badge" data-target="#id"> to
  // show whether the target field's current value is a file actually
  // uploaded to this site (relative /media/... URL, same check db.js's
  // own dangling-reference reconciliation uses for "is this a locally-
  // hosted media reference") or a URL typed/pasted in directly -- most
  // commonly hotlinking someone else's image, which this field's plain
  // text input has always silently allowed with no indication either way
  // that it's a fundamentally different, less durable kind of reference
  // than an upload. Updates live as the field is typed into or filled by
  // Upload/Browse, not just once on initial render.
  function wireImageUrlSourceBadge(badge) {
    const input = document.querySelector(badge.dataset.target);
    if (!input) return;
    const update = () => {
      const value = (input.value || "").trim();
      if (!value) {
        badge.textContent = "";
        badge.className = "image-url-source-badge";
      } else if (value.startsWith("/media/")) {
        badge.textContent = "Local upload";
        badge.className = "image-url-source-badge is-local";
      } else {
        badge.textContent = "External URL";
        badge.className = "image-url-source-badge is-external";
      }
    };
    // Stashed on the input (rather than only closed over here) so a code
    // path that sets `.value` directly without going through a real user
    // interaction -- the media modal's image-block autofill branch below
    // is exactly such a path -- can refresh the badge without dispatching
    // a synthetic "change" event on a shared input. A critic pass found
    // dispatching one there re-triggered this same input's OWN unrelated
    // generic autosave-on-change listener (every [data-key] field gets
    // one), firing an extra, incomplete PATCH mid-branch that raced the
    // branch's own deliberate merged save -- reintroducing the exact
    // "independent saves can race and silently drop a field" failure mode
    // that merged save was written to avoid in the first place.
    input._imageUrlBadgeUpdate = update;
    input.addEventListener("input", update);
    input.addEventListener("change", update);
    update();
  }

  // Opens the same photo editor used from the Media Library, pre-loaded
  // with whatever image the target field currently points to — the
  // in-place "Overwrite original" save there already handles cropping,
  // this just gives the social-share image fields a direct route into it
  // instead of "go find this exact file in the library yourself first".
  // Only works for images actually uploaded to this site's media library
  // (the editor needs a real R2 key to save back to) — an external URL
  // typed into the field can't be edited this way.
  function wireEditImageButton(btn) {
    btn.addEventListener("click", () => {
      const input = document.querySelector(btn.dataset.target);
      const value = (input.value || "").trim();
      const m = value.match(/\/media\/(uploads\/[A-Za-z0-9_.\-\/]+)$/);
      if (!m) {
        alert("This only works for images uploaded to this site's media library — upload or browse to one first.");
        return;
      }
      if (window.PhotoEditor) window.PhotoEditor.open(value, m[1]);
    });
  }

  async function api(path, opts = {}) {
    const res = await fetch("/api/admin" + path, {
      ...opts,
      headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    });
    if (res.status === 401) {
      showLogin();
      throw new Error("unauthorized");
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      const err = new Error(body.error || "Request failed");
      err.status = res.status;
      err.conflict = !!body.conflict;
      throw err;
    }
    return res.status === 204 ? null : res.json();
  }

  async function runMediaBackfill(path, countKeys, onProgress) {
    const totals = Object.fromEntries(countKeys.map((key) => [key, 0]));
    let cursor = null;
    while (true) {
      const page = await api(path, {
        method: "POST",
        body: JSON.stringify(cursor ? { cursor } : {}),
      });
      for (const key of countKeys) totals[key] += page[key] || 0;
      onProgress?.(totals);
      if (page.complete) return totals;
      if (typeof page.cursor !== "string" || !page.cursor || page.cursor === cursor) {
        throw new Error("The media backfill stopped before completion. Retry it; completed files are safe to skip.");
      }
      cursor = page.cursor;
    }
  }

  // ---------- Unsaved-change protection ----------
  // Any in-flight or failed save sets this; a successful one clears it. The
  // realistic gap this covers is small (autosave debounces ~2s, block edits
  // save on blur) but real — closing the tab mid-request, or right after a
  // save that failed silently in the background, would otherwise lose work
  // with no warning at all.
  let unsavedDirty = false;
  window.addEventListener("beforeunload", (e) => {
    if (!unsavedDirty) return;
    e.preventDefault();
    e.returnValue = "";
  });

  // Shown when the server rejects a save because the record changed
  // elsewhere since this tab loaded it (another tab, another device, or
  // this same admin editing it twice) — see checkConflict() server-side.
  // Deliberately doesn't attempt a merge or diff (that's real future work,
  // not a one-line fix); it just refuses to silently clobber the other
  // change and gives the admin an explicit way to load the current version.
  function renderConflictStatus(statusElId, onReload, onCompare) {
    const e = el(statusElId);
    e.innerHTML = "";
    const span = document.createElement("span");
    span.className = "save-conflict";
    span.textContent = "Changed elsewhere since you loaded it — your last edit wasn't saved. ";
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "save-conflict-reload";
    btn.textContent = "Reload latest version";
    btn.addEventListener("click", async () => {
      await onReload();
      e.innerHTML = ""; // the message described the version that was just replaced
    });
    span.appendChild(btn);
    if (onCompare) {
      const cmp = document.createElement("button");
      cmp.type = "button";
      cmp.className = "save-conflict-reload";
      cmp.textContent = "Compare and merge…";
      cmp.addEventListener("click", onCompare);
      span.appendChild(cmp);
    }
    e.appendChild(span);
  }

  // ---------- Compare and merge a save conflict ----------
  // A three-way merge at field level. Three versions are known: the one this tab
  // loaded (its baseline), what is in the editor now, and what was saved since. A
  // field only this editor changed is kept; a field only the other side changed is
  // taken from the saved version; a field both changed is offered side by side.
  // Only this editor's own changes are sent, on top of the latest version, so
  // nothing else that changed elsewhere (publish state, flags, relations) is touched.
  let articleBase = null; // the article as this tab last loaded or saved it
  let projectBase = null;
  const CONFLICT_NOT_FIELDS = new Set(["expected_version"]);
  const CONFLICT_LABELS = { tts_audio_key: "Read-aloud audio", co_authors: "Co-authors", published_at: "Publish time", expires_at: "Expiry time", og_image: "Social image", custom_json_ld: "Custom JSON-LD", sitemap_exclude: "Hide from sitemap", hero_video: "Hero video", featured_order: "Featured order", sort_order: "Sort order", series_order: "Series order" };
  const conflictLabel = (key) => CONFLICT_LABELS[key] || key.replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
  // The server stores a blank number as 0, so 0 and blank are the same for these.
  const CONFLICT_BLANK_ZERO = new Set(["series_order", "featured_order", "sort_order"]);
  function conflictNorm(value, ref) {
    if (typeof ref === "boolean") return String(Boolean(value));
    if (value === null || value === undefined || value === "") return "";
    if (Array.isArray(value)) {
      const list = value.every((x) => typeof x === "number") ? [...value].sort((a, b) => a - b) : value;
      return list.map((x) => (typeof x === "object" ? JSON.stringify(x) : String(x))).join(", ");
    }
    if (typeof value === "object") return Object.keys(value).length ? JSON.stringify(value, null, 2) : "";
    return String(value);
  }
  const conflictShow = (value, key) => {
    if (/_at$/.test(key || "") && typeof value === "string" && value) {
      const d = new Date(value);
      if (!Number.isNaN(d.getTime())) return d.toLocaleString();
    }
    const t = conflictNorm(value, undefined);
    return t.trim() ? t : "(empty)";
  };
  // Publish and expiry times are rebuilt from the form on every save, so they only
  // count as changed when the date itself differs at minute precision (or the
  // published state flipped).
  function conflictTimeChanged(mineIso, baseIso, inputValue, isPublishedField) {
    if (isPublishedField && Boolean(mineIso) !== Boolean(baseIso)) return true;
    if (!mineIso || !baseIso) return Boolean(mineIso) !== Boolean(baseIso);
    if (isPublishedField && !inputValue) return false; // "now" was only a default
    return mineIso.slice(0, 16) !== baseIso.slice(0, 16);
  }
  let conflictCtx = null;
  async function compareConflict(kind) {
    const isArticle = kind === "article";
    const id = isArticle ? currentArticleId : currentProjectId;
    const base = isArticle ? articleBase : projectBase;
    let latest;
    try {
      const list = await api(isArticle ? "/articles" : "/projects");
      latest = list.find((x) => x.id === id);
    } catch (err) {
      return alert("Couldn't load the latest version: " + err.message);
    }
    if (!latest) return alert("This item no longer exists, so there is nothing to compare with.");
    if (!base) return alert("The version this editor started from isn't known any more. Use Reload latest version.");
    const mine = isArticle ? buildArticleBody() : buildProjectBody();
    const publishInput = el(isArticle ? "article-publish-at" : "project-publish-at").value;
    const expiresInput = el(isArticle ? "article-expires-at" : "project-expires-at").value;
    const mineChanges = []; // {key, label}: only this editor changed it
    const theirChanges = []; // only the saved version changed it: taken as is
    const both = []; // both changed it: the user chooses
    Object.keys(mine).forEach((key) => {
      if (CONFLICT_NOT_FIELDS.has(key)) return;
      let mineChanged;
      let theirChanged;
      if (key === "published_at" || key === "expires_at") {
        mineChanged = conflictTimeChanged(mine[key], base[key], key === "published_at" ? publishInput : expiresInput, key === "published_at");
        theirChanged = conflictTimeChanged(latest[key], base[key], "x", key === "published_at");
      } else {
        const n = (v) => (CONFLICT_BLANK_ZERO.has(key) && (v === 0 || v === "0") ? "" : conflictNorm(v, mine[key]));
        mineChanged = n(mine[key]) !== n(base[key]);
        theirChanged = n(latest[key]) !== n(base[key]);
        if (mineChanged && theirChanged && n(mine[key]) === n(latest[key])) mineChanged = false; // both made the same change
        else if (mineChanged && theirChanged && n(mine[key]).trim() === n(latest[key]).trim()) theirChanged = false; // differ only in spacing: keep yours
      }
      const entry = { key, label: conflictLabel(key) };
      if (mineChanged && theirChanged) both.push(entry);
      else if (mineChanged && !theirChanged) mineChanges.push(entry);
      else if (theirChanged && !mineChanged) theirChanges.push(entry);
    });
    conflictCtx = { kind, id, mine, latest, both, mineChanges };
    const names = (list) => list.map((f) => f.label).join(", ");
    el("conflict-intro").textContent = [
      both.length ? "Both this editor and the saved version changed the fields below: pick which version of each to keep." : "No field was changed on both sides, so the two sets of changes fit together.",
      mineChanges.length ? `Your changes that will be saved: ${names(mineChanges)}.` : "You have no other unsaved changes.",
      theirChanges.length ? `Kept from the saved version (changed elsewhere): ${names(theirChanges)}.` : "",
    ].filter(Boolean).join(" ");
    const rows = el("conflict-rows");
    rows.innerHTML = "";
    both.forEach(({ key, label }, i) => {
      const fs = document.createElement("fieldset");
      fs.className = "conflict-field";
      const lg = document.createElement("legend");
      lg.textContent = label;
      fs.appendChild(lg);
      const sides = document.createElement("div");
      sides.className = "conflict-sides";
      [["mine", "Yours (in this editor)", mine[key]], ["latest", "Latest saved", latest[key]]].forEach(([which, title, value]) => {
        const lab = document.createElement("label");
        lab.className = "conflict-side";
        const r = document.createElement("input");
        r.type = "radio";
        r.name = `conflict-${i}`;
        r.value = which;
        r.checked = which === "mine";
        r.setAttribute("aria-label", `${label}: ${which === "mine" ? "yours" : "latest saved"}`);
        const strong = document.createElement("strong");
        strong.textContent = " " + title;
        const pre = document.createElement("pre");
        pre.textContent = conflictShow(value, key);
        lab.append(r, strong, pre);
        sides.appendChild(lab);
      });
      fs.appendChild(sides);
      rows.appendChild(fs);
    });
    el("conflict-status").textContent = latest.locked
      ? "This item was locked elsewhere. Unlock it before saving."
      : !mineChanges.length && !both.length
        ? "Nothing of yours differs from the saved version. Close this and press Reload latest version to clear the notice."
        : "";
    el("conflict-apply").disabled = Boolean(latest.locked);
    el("conflict-apply").textContent = mineChanges.length || both.length ? "Save merged version" : "Nothing to save";
    if (!mineChanges.length && !both.length) el("conflict-apply").disabled = true;
    modalFocusReturn.set(el("conflict-modal"), document.activeElement);
    el("conflict-modal").hidden = false;
    el("conflict-modal-title").focus();
  }
  closeModalOnClick("close-conflict", "conflict-modal");
  closeModalOnClick("conflict-cancel", "conflict-modal");
  el("conflict-apply").addEventListener("click", async () => {
    if (!conflictCtx) return;
    const { kind, id, mine, latest, both, mineChanges } = conflictCtx;
    // Only this editor's own changes go up; the rest stays as saved.
    const patch = { expected_version: latest.version };
    mineChanges.forEach(({ key }) => (patch[key] = mine[key]));
    both.forEach(({ key }, i) => {
      const picked = document.querySelector(`input[name="conflict-${i}"]:checked`);
      if (!picked || picked.value === "mine") patch[key] = mine[key];
    });
    el("conflict-apply").disabled = true;
    el("conflict-status").textContent = "Saving…";
    const isArticle = kind === "article";
    try {
      await api(`/${isArticle ? "articles" : "projects"}/${id}`, { method: "PATCH", body: JSON.stringify(patch) });
      const list = await api(isArticle ? "/articles" : "/projects");
      const saved = list.find((x) => x.id === id);
      el("conflict-modal").hidden = true;
      if (isArticle) {
        articles = list;
        if (saved && currentArticleId === id) populateArticleForm(saved);
        renderArticlesList();
        setAutosaveStatus("Merged and saved " + new Date().toLocaleTimeString());
      } else {
        projects = list;
        if (saved && currentProjectId === id) populateProjectForm(saved);
        renderProjectsList();
        el("project-autosave-status").textContent = "Merged and saved " + new Date().toLocaleTimeString();
      }
      unsavedDirty = false;
      clearDraft(kind, id);
    } catch (err) {
      if (err.conflict) {
        // Changed yet again: show the newest comparison instead of a dead end.
        await compareConflict(kind);
        el("conflict-status").textContent = "It changed again while you were choosing, so the comparison was refreshed.";
        return;
      }
      el("conflict-apply").disabled = false;
      el("conflict-status").textContent = "Couldn't save: " + err.message;
    }
  });

  // ---------- Crash recovery ----------
  // A local (per-browser, never sent anywhere) snapshot of in-progress
  // edits, written on every keystroke — not the debounced server autosave.
  // This is what catches a crashed tab, a browser force-quit, or a save
  // that's been silently failing (offline, expired session) for a while:
  // none of those get a chance to run a "before you go" handler, so the
  // beforeunload guard above can't help. Wrapped in try/catch throughout
  // since localStorage can throw (private browsing, blocked site data).
  function draftKey(kind, id) {
    return `admin_draft_${kind}_${id || "new"}`;
  }
  function saveDraft(kind, id, fields) {
    try {
      localStorage.setItem(draftKey(kind, id), JSON.stringify({ savedAt: Date.now(), fields }));
    } catch {}
  }
  function loadDraft(kind, id) {
    try {
      const raw = localStorage.getItem(draftKey(kind, id));
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  }
  function clearDraft(kind, id) {
    try {
      localStorage.removeItem(draftKey(kind, id));
    } catch {}
  }

  // Recently-edited jump list for the command palette — deliberately just
  // a client-side recency list rather than a real activity-log query: the
  // log only ever kept an item's label at the time, not its id, so an old
  // entry silently goes stale the moment something gets renamed. This
  // always points at whatever's live right now.
  const RECENT_EDITED_KEY = "admin_recently_edited";
  const RECENT_EDITED_MAX = 8;
  function recordRecentlyEdited(kind, id, title) {
    try {
      const list = JSON.parse(localStorage.getItem(RECENT_EDITED_KEY) || "[]").filter((r) => !(r.kind === kind && r.id === id));
      list.unshift({ kind, id, title, ts: Date.now() });
      localStorage.setItem(RECENT_EDITED_KEY, JSON.stringify(list.slice(0, RECENT_EDITED_MAX)));
    } catch {}
  }
  function getRecentlyEdited() {
    try {
      return JSON.parse(localStorage.getItem(RECENT_EDITED_KEY) || "[]");
    } catch {
      return [];
    }
  }

  // Favorites/pinned shortcuts — same client-side-only approach as recently
  // edited, and for the same reason (no stable id in the activity log to
  // key off of). Unlike recency, these never age out or get capped.
  const FAVORITES_KEY = "admin_favorites";
  function getFavorites() {
    try {
      return JSON.parse(localStorage.getItem(FAVORITES_KEY) || "[]");
    } catch {
      return [];
    }
  }
  function isFavorite(kind, id) {
    return getFavorites().some((f) => f.kind === kind && f.id === id);
  }
  function toggleFavorite(kind, id, title) {
    const list = getFavorites();
    const idx = list.findIndex((f) => f.kind === kind && f.id === id);
    if (idx === -1) list.unshift({ kind, id, title, ts: Date.now() });
    else list.splice(idx, 1);
    try {
      localStorage.setItem(FAVORITES_KEY, JSON.stringify(list));
    } catch {}
    return idx === -1;
  }

  // Shared by the command palette's quick actions and the topbar's "Recent"
  // dropdown below — one place that knows how to label/open a
  // recently-edited or favorited item, instead of two copies.
  const RECENT_KIND_LABEL = { page: "Page", article: "Article", project: "Project" };
  // A stale favorite/recently-edited entry (the item was trashed since it
  // was pinned or last touched) used to just silently do nothing when
  // clicked from here or from the command palette's own Favorites/Recent
  // quick actions — selectPage() itself no-ops on an unknown id with no
  // feedback. openArticleEditorById/openProjectEditorById already guard
  // this (added earlier this session for stale "Edit this" deep links);
  // this closes the same gap for pages, in the one place both the Recent
  // dropdown and the command palette's quick actions actually reach it,
  // rather than adding the same check at each call site separately.
  const RECENT_KIND_RUN = {
    page: (id) => {
      if (!pages.some((p) => p.id === id)) {
        alert("That page no longer exists (it may have been trashed).");
        return;
      }
      selectPage(id);
    },
    article: (id) => openArticleEditorById(id),
    project: (id) => openProjectEditorById(id),
  };

  // ---------- "Recent" topbar dropdown ----------
  // The command palette already surfaced favorites/recently-edited, but
  // only to someone who knew to press Ctrl/Cmd+K — a visible button next
  // to the page picker is a much shorter path back to what you were just
  // working on, the single most common navigation need in a page-builder
  // this size.
  function renderRecentItemsPanel() {
    const favRow = (item) =>
      `<button type="button" class="recent-item-btn" data-kind="${item.kind}" data-id="${item.id}">★ ${escapeHtml(item.title || "(untitled)")} <span class="recent-item-type">${RECENT_KIND_LABEL[item.kind] || item.kind}</span></button>`;
    const recentRow = (item) =>
      `<button type="button" class="recent-item-btn" data-kind="${item.kind}" data-id="${item.id}">${escapeHtml(item.title || "(untitled)")} <span class="recent-item-type">${RECENT_KIND_LABEL[item.kind] || item.kind}</span></button>`;
    const favorites = getFavorites().slice(0, 5);
    const recent = getRecentlyEdited()
      .filter((r) => !favorites.some((f) => f.kind === r.kind && f.id === r.id))
      .slice(0, 5);
    el("recent-items-favorites").innerHTML = favorites.length
      ? `<h3>Favorites</h3>${favorites.map(favRow).join("")}`
      : "";
    el("recent-items-recent").innerHTML = recent.length
      ? `<h3>Recently edited</h3>${recent.map(recentRow).join("")}`
      : !favorites.length
      ? `<p style="color:var(--text-dim);font-size:0.8rem;padding:4px 2px;">Nothing yet — favorite or edit something first.</p>`
      : "";
    el("recent-items-panel").querySelectorAll(".recent-item-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        closeRecentItemsMenu();
        const run = RECENT_KIND_RUN[btn.dataset.kind];
        if (run) run(Number(btn.dataset.id));
      });
    });
  }
  function closeRecentItemsMenu() {
    el("recent-items-panel").classList.remove("open");
    el("recent-items-btn").setAttribute("aria-expanded", "false");
  }
  el("recent-items-btn").addEventListener("click", (e) => {
    e.stopPropagation();
    const opening = !el("recent-items-panel").classList.contains("open");
    if (opening) renderRecentItemsPanel();
    el("recent-items-panel").classList.toggle("open", opening);
    el("recent-items-btn").setAttribute("aria-expanded", String(opening));
  });
  document.addEventListener("click", (e) => {
    const panel = el("recent-items-panel");
    if (panel.classList.contains("open") && !panel.contains(e.target) && e.target !== el("recent-items-btn")) closeRecentItemsMenu();
  });

  // Shown when a local draft exists for whatever was just loaded — either
  // it matches what's on the server (a normal after-save leftover, cleared
  // silently) or it doesn't (something crashed before it could be saved),
  // in which case the admin gets to choose rather than either losing it
  // silently or having it silently clobber what they just opened.
  function renderDraftRecoveryBanner(statusElId, kind, id, draft, onRestore) {
    const e = el(statusElId);
    e.innerHTML = "";
    const span = document.createElement("span");
    span.className = "save-conflict";
    span.textContent = `Unsaved draft from ${new Date(draft.savedAt).toLocaleString()} found (crashed tab or browser?). `;
    const restoreBtn = document.createElement("button");
    restoreBtn.type = "button";
    restoreBtn.className = "save-conflict-reload";
    restoreBtn.textContent = "Restore it";
    restoreBtn.addEventListener("click", onRestore);
    const discardBtn = document.createElement("button");
    discardBtn.type = "button";
    discardBtn.className = "save-conflict-reload";
    discardBtn.style.marginLeft = "6px";
    discardBtn.textContent = "Discard";
    discardBtn.addEventListener("click", () => {
      clearDraft(kind, id);
      e.textContent = "";
    });
    span.appendChild(restoreBtn);
    span.appendChild(discardBtn);
    e.appendChild(span);
  }

  function showLogin() {
    loginScreen.hidden = false;
    app.hidden = true;
  }

  function showApp() {
    loginScreen.hidden = true;
    app.hidden = false;
  }

  // ---------- Auth ----------
  el("login-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const password = el("password").value;
    try {
      const res = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!res.ok) {
        el("login-error").hidden = false;
        return;
      }
      el("login-error").hidden = true;
      await boot();
    } catch (err) {
      el("login-error").hidden = false;
    }
  });

  el("logout-btn").addEventListener("click", async () => {
    await fetch("/api/admin/logout", { method: "POST" });
    // Photo editor autosaves live in this browser; signing out removes them.
    try {
      indexedDB.deleteDatabase("pe-recovery");
    } catch (e) {}
    showLogin();
  });

  el("admin-theme-toggle").addEventListener("click", () => {
    const root = document.documentElement;
    const next = (root.getAttribute("data-theme") || "dark") === "light" ? "dark" : "light";
    root.setAttribute("data-theme", next);
    try {
      localStorage.setItem("admin-theme", next);
    } catch (e) {}
  });

  // ---------- Interface density (comfortable / compact) ----------
  // A per-browser preference, like the theme: the head script in index.html applies a
  // saved "compact" before first paint, this keeps the button's state in step with it.
  function applyDensity(compact) {
    const root = document.documentElement;
    if (compact) root.setAttribute("data-density", "compact");
    else root.removeAttribute("data-density");
    const btn = el("admin-density-toggle");
    btn.setAttribute("aria-pressed", compact ? "true" : "false");
    btn.title = compact ? "Compact interface is on: click for comfortable spacing" : "Compact interface: tighter spacing in this browser";
  }
  applyDensity(document.documentElement.getAttribute("data-density") === "compact");
  el("admin-density-toggle").addEventListener("click", () => {
    const compact = document.documentElement.getAttribute("data-density") !== "compact";
    applyDensity(compact);
    try {
      localStorage.setItem("admin-density", compact ? "compact" : "comfortable");
    } catch (e) {}
  });

  // ---------- Preview the public site as of another date ----------
  // Opens the public site in a new tab with ?preview_at=<date>; the worker honours it only for this
  // signed-in admin (see previewClock in worker/index.js), keeps it for an hour, and shows an exit banner.
  el("preview-at-btn").addEventListener("click", () => {
    const soon = new Date(Date.now() + 7 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    const entered = prompt("Preview the public site as it will look on which date? (YYYY-MM-DD, or YYYY-MM-DDTHH:MM, in UTC; up to 10 years ahead)", soon);
    if (entered === null) return;
    const value = entered.trim();
    // The same rules as the server (previewClock): a real calendar date, from a year back to ten years ahead.
    const iso = value.includes("T") ? value + "Z" : value + "T00:00:00Z";
    const t = Date.parse(iso);
    const real = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2})?$/.test(value) && Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === value.slice(0, 10);
    if (!real) {
      alert("Enter a real date like 2026-12-01.");
      return;
    }
    if (t < Date.now() - 366 * 24 * 3600 * 1000 || t > Date.now() + 10 * 366 * 24 * 3600 * 1000) {
      alert("Choose a date from a year ago to ten years ahead.");
      return;
    }
    window.open(`/?preview_at=${encodeURIComponent(value)}`, "_blank", "noopener");
  });

  // ---------- Focus mode (hide the block palette for more canvas room) ----------
  function applyFocusMode(on) {
    el("app").classList.toggle("focus-mode", on);
    el("focus-mode-btn").textContent = on ? "Exit focus" : "Focus";
    el("focus-mode-btn").setAttribute("aria-pressed", on ? "true" : "false");
  }
  el("focus-mode-btn").addEventListener("click", () => {
    const on = !el("app").classList.contains("focus-mode");
    applyFocusMode(on);
    try {
      localStorage.setItem("admin-focus-mode", on ? "1" : "0");
    } catch (e) {}
  });
  try {
    if (localStorage.getItem("admin-focus-mode") === "1") applyFocusMode(true);
  } catch (e) {}

  // ---------- Whole-site draft-preview mode ----------
  // Sets a plain (non-httpOnly, non-secret) cookie the public worker reads
  // in worker/index.js — it grants nothing on its own, since every check
  // there also requires the real admin session cookie; this just lets
  // that existing per-item ?preview=1 gate follow normal navigation
  // (nav links, related content, a URL typed by hand) in this browser
  // without needing the query param re-added on every link.
  // Warning strip under the admin header: the site is down for visitors, or browsing is in draft preview.
  let maintenanceOn = false;
  function refreshStatusStrip() {
    const strip = el("admin-status-strip");
    if (!strip) return;
    const msgs = [];
    if (maintenanceOn) msgs.push("Maintenance mode is on: visitors see a “be right back” page.");
    if (hasPreviewModeCookie()) msgs.push("Draft preview mode is on: this browser sees unpublished content on the live site.");
    strip.textContent = msgs.join("  ·  ");
    strip.hidden = !msgs.length;
  }
  function applyPreviewModeButton(on) {
    el("draft-preview-mode-toggle").textContent = "Preview mode: " + (on ? "On" : "Off");
    el("draft-preview-mode-toggle").setAttribute("aria-pressed", on ? "true" : "false");
    refreshStatusStrip();
  }
  function hasPreviewModeCookie() {
    return document.cookie.split("; ").some((c) => c === "preview_mode=1");
  }
  el("draft-preview-mode-toggle").addEventListener("click", () => {
    const on = !hasPreviewModeCookie();
    if (on) document.cookie = "preview_mode=1; path=/; max-age=" + 60 * 60 * 24 + "; samesite=lax";
    else document.cookie = "preview_mode=; path=/; max-age=0";
    applyPreviewModeButton(on);
  });
  applyPreviewModeButton(hasPreviewModeCookie());

  // Save-status pill: the editors each write free text ("Saving…", "Saved 10:42", "Save failed: …")
  // into their own status element. Classify it into data-state (errors first, since "wasn't saved"
  // contains "saved") so the .save-pill CSS can style them all alike.
  const SAVE_STATUS_IDS = ["page-save-status", "block-save-status", "article-autosave-status", "project-autosave-status", "song-autosave-status", "sim-save-status", "scan-save-status"];
  function classifySaveText(t) {
    if (!t) return "";
    if (/fail|error|couldn|conflict|wasn.t saved|not saved|changed elsewhere/i.test(t)) return "error";
    if (/^saving|merging/i.test(t)) return "saving";
    if (/unsaved|changes…|editing|need saving/i.test(t)) return "dirty";
    if (/saved/i.test(t)) return "saved";
    return "";
  }
  SAVE_STATUS_IDS.forEach((id) => {
    const node = el(id);
    if (!node) return;
    node.classList.add("save-pill");
    const sync = () => {
      const st = classifySaveText(node.textContent.trim());
      if (st) node.dataset.state = st;
      else delete node.dataset.state;
    };
    new MutationObserver(sync).observe(node, { childList: true, characterData: true, subtree: true });
    sync();
  });

  el("content-only-mode-btn").addEventListener("click", () => {
    contentOnlyMode = !contentOnlyMode;
    el("content-only-mode-btn").textContent = contentOnlyMode ? "Exit content-only" : "Content-only";
    el("content-only-mode-btn").setAttribute("aria-pressed", contentOnlyMode ? "true" : "false");
    renderCanvas();
  });

  // ---------- Pages ----------
  async function loadPages() {
    pages = await api("/pages");
    const picker = el("page-picker");
    picker.innerHTML = pages
      .map((p) => `<option value="${p.id}">${escapeHtml(p.title || p.slug)}</option>`)
      .join("");
    if (pages.length) {
      const stillExists = currentPage && pages.find((p) => p.id === currentPage.id);
      await selectPage(stillExists ? currentPage.id : pages[0].id);
    } else {
      currentPage = null;
      blocks = [];
      selectedBlockId = null;
      canvas.innerHTML = "<p style='color:var(--text-dim);padding:24px;'>No pages left. Use \"+ Page\" to create one.</p>";
      renderInspector();
      updatePasteButtonVisibility();
    }
  }

  // Only other nav-eligible, not-already-nested pages can be a parent — a
  // page nested under something can't also be a parent itself (one level
  // of dropdown only), matching the server-side check in admin-api.js.
  function populatePageNavParentSelect(excludeId) {
    const options = pages.filter((p) => String(p.nav_label || "").trim() && p.id !== excludeId && !p.nav_parent_id);
    el("page-nav-parent").innerHTML =
      `<option value="">— none (top-level) —</option>` + options.map((p) => `<option value="${p.id}">${escapeHtml(p.nav_label)}</option>`).join("");
  }

  async function selectPage(id) {
    currentPage = pages.find((p) => p.id === id);
    if (!currentPage) return;
    recordRecentlyEdited("page", currentPage.id, currentPage.title);
    el("page-picker").value = id;
    el("page-title").value = currentPage.title || "";
    el("page-meta").value = currentPage.meta_description || "";
    el("page-nav-label").value = currentPage.nav_label || "";
    el("page-nav-order").value = currentPage.nav_order ?? "";
    populatePageNavParentSelect(currentPage.id);
    el("page-nav-parent").value = currentPage.nav_parent_id || "";
    el("page-og-image").value = currentPage.og_image || "";
    el("page-canonical-url").value = currentPage.canonical_url || "";
    el("page-custom-json-ld").value = currentPage.custom_json_ld || "";
    loadPageCss();
    el("page-sitemap-exclude").checked = !!currentPage.sitemap_exclude;
    el("page-password-input").value = "";
    el("page-password-status-text").textContent = currentPage.password_hash ? "protected" : "not protected";
    el("page-remove-password-btn").hidden = !currentPage.password_hash;
    el("page-save-status").textContent = "";
    updateLockButton("lock-page-btn", !!currentPage.locked);
    updateFavoriteButton("favorite-page-btn", "page", currentPage.id);
    updatePageOgPreview();
    checkPageDraftRecovery(currentPage.id);
    updatePasteButtonVisibility();
    el("admin-view-live").href = currentPage.slug === "home" ? "/" : `/${currentPage.slug}`;
    await loadBlocks();
  }

  // ---------- Page-settings crash-recovery draft ----------
  // Page settings have no server-side autosave at all (only the explicit
  // Save button), so this local snapshot is the *only* safety net between
  // typing and clicking Save — a bigger gap than articles have.
  const PAGE_DRAFT_FIELD_IDS = ["page-title", "page-meta", "page-nav-label", "page-nav-order", "page-nav-parent", "page-og-image", "page-canonical-url", "page-custom-json-ld", "page-sitemap-exclude"];
  function capturePageRawFields() {
    const out = {};
    for (const id of PAGE_DRAFT_FIELD_IDS) {
      const input = el(id);
      out[id] = input.type === "checkbox" ? input.checked : input.value;
    }
    return out;
  }
  function applyPageRawFields(fields) {
    for (const id of PAGE_DRAFT_FIELD_IDS) {
      if (!(id in fields)) continue;
      const input = el(id);
      if (input.type === "checkbox") input.checked = fields[id];
      else input.value = fields[id];
    }
    updatePageOgPreview();
  }
  function snapshotPageDraft() {
    if (!currentPage) return;
    saveDraft("page", currentPage.id, capturePageRawFields());
  }
  function checkPageDraftRecovery(pageId) {
    const draft = loadDraft("page", pageId);
    if (!draft) return;
    if (JSON.stringify(draft.fields) === JSON.stringify(capturePageRawFields())) {
      clearDraft("page", pageId);
      return;
    }
    renderDraftRecoveryBanner("page-save-status", "page", pageId, draft, () => {
      applyPageRawFields(draft.fields);
      clearDraft("page", pageId);
      unsavedDirty = true;
    });
  }

  el("page-picker").addEventListener("change", (e) => selectPage(Number(e.target.value)));

  el("new-page-btn").addEventListener("click", async () => {
    const title = prompt("Page title:");
    if (!title) return;
    const templateId = Number(el("page-template-picker").value) || null;
    try {
      const res = await api("/pages", { method: "POST", body: JSON.stringify({ title }) });
      if (templateId) {
        const t = templateOptions.page.find((x) => x.id === templateId);
        const templateBlocks = (t && t.data.blocks) || [];
        for (const b of templateBlocks) {
          await api(`/pages/${res.id}/blocks`, { method: "POST", body: JSON.stringify(b) });
        }
      }
      await loadPages();
      const created = pages.find((p) => p.id === res.id);
      if (created) await selectPage(created.id);
    } catch (err) {
      alert(err.message);
    }
  });

  ["page-title", "page-meta", "page-nav-label", "page-nav-order", "page-og-image", "page-canonical-url", "page-custom-json-ld"].forEach((id) =>
    el(id).addEventListener("input", () => {
      unsavedDirty = true;
      el("page-save-status").textContent = "Unsaved changes…";
      snapshotPageDraft();
    })
  );
  ["page-sitemap-exclude", "page-nav-parent"].forEach((id) =>
    el(id).addEventListener("change", () => {
      unsavedDirty = true;
      el("page-save-status").textContent = "Unsaved changes…";
      snapshotPageDraft();
    })
  );

  el("save-page-settings").addEventListener("click", async () => {
    if (!currentPage) return;
    el("page-save-status").textContent = "Saving…";
    try {
      await api(`/pages/${currentPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          title: el("page-title").value,
          meta_description: el("page-meta").value,
          nav_label: el("page-nav-label").value || null,
          nav_order: el("page-nav-order").value ? Number(el("page-nav-order").value) : null,
          nav_parent_id: el("page-nav-parent").value ? Number(el("page-nav-parent").value) : null,
          og_image: el("page-og-image").value || null,
          canonical_url: el("page-canonical-url").value.trim() || null,
          custom_json_ld: el("page-custom-json-ld").value.trim() || null,
          sitemap_exclude: el("page-sitemap-exclude").checked,
          expected_version: currentPage.version,
        }),
      });
      unsavedDirty = false;
      clearDraft("page", currentPage.id);
      await loadPages();
      el("page-save-status").textContent = "Saved " + new Date().toLocaleTimeString();
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("page-save-status", async () => {
          await loadPages();
        });
        return;
      }
      el("page-save-status").textContent = "Save failed: " + err.message;
      alert(err.message);
    }
  });

  // ---------- Group / ungroup and reusable sections ----------
  el("bulk-group-btn").addEventListener("click", async () => {
    const sel = selectedBlocksList();
    if (sel.length < 2) return alert("Select at least two blocks to group them.");
    if (sel.some((b) => b.shared_block_id)) return alert("Reusable blocks can't be grouped: their style is shared across pages.");
    try {
      await setBlocksGroup(sel, newGroupId());
    } catch (err) {
      alert(err.message);
    }
    renderCanvas();
    renderInspector();
  });
  el("bulk-ungroup-btn").addEventListener("click", async () => {
    const sel = selectedBlocksList().filter((b) => groupOf(b));
    if (!sel.length) return alert("None of the selected blocks are grouped.");
    // Ungrouping one member releases the whole group, not just the selected part of it.
    const ids = new Set(sel.map(groupOf));
    const all = blocks.filter((b) => ids.has(groupOf(b)));
    try {
      await setBlocksGroup(all, null);
    } catch (err) {
      alert(err.message);
    }
    renderCanvas();
    renderInspector();
  });

  let sectionsCache = [];
  async function loadSections() {
    try {
      sectionsCache = await api("/sections");
    } catch (e) {
      sectionsCache = [];
    }
    const box = el("sections-list");
    box.innerHTML = sectionsCache.length
      ? sectionsCache
          .map(
            (sec) =>
              `<div class="section-row"><span class="section-name">${escapeHtml(sec.name)} <span class="section-count">${sec.blocks.length} block${sec.blocks.length === 1 ? "" : "s"}</span></span><button type="button" class="insert-section" data-id="${escapeHtml(String(sec.id))}">Insert</button><button type="button" class="delete-section danger" data-id="${escapeHtml(String(sec.id))}" aria-label="Delete section ${escapeHtml(sec.name)}">Delete</button></div>`
          )
          .join("")
      : "<p class='dash-empty'>No saved sections yet.</p>";
    box.querySelectorAll(".insert-section").forEach((btn) => btn.addEventListener("click", () => insertSection(btn.dataset.id)));
    box.querySelectorAll(".delete-section").forEach((btn) =>
      btn.addEventListener("click", async () => {
        if (!confirm("Delete this saved section? Pages that already used it keep their blocks.")) return;
        await api(`/sections/${btn.dataset.id}`, { method: "DELETE" }).catch((err) => alert(err.message));
        await loadSections();
      })
    );
  }
  async function insertSection(id) {
    const sec = sectionsCache.find((x) => String(x.id) === String(id));
    if (!sec || !currentPage) return;
    const base = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    const group = sec.blocks.length > 1 ? newGroupId() : null;
    try {
      for (const b of sec.blocks) {
        const style = { ...(b.style || {}) };
        if (group) style.group = group;
        await api(`/pages/${currentPage.id}/blocks`, {
          method: "POST",
          body: JSON.stringify({ type: b.type, content: b.content, style, col: b.col, col_span: b.col_span, row: base + b.row - 1, row_span: b.row_span }),
        });
      }
    } catch (err) {
      alert("Couldn't insert the whole section: " + err.message);
    }
    await loadBlocks();
    schedulePreviewRefresh();
  }
  el("bulk-save-section-btn").addEventListener("click", async () => {
    const sel = selectedBlocksList();
    if (!sel.length) return;
    if (sel.some((b) => b.shared_block_id)) return alert("Sections can't include reusable blocks (they'd stop being shared). Duplicate them as normal blocks first.");
    const name = (prompt("Name this section:", "") || "").trim();
    if (!name) return;
    try {
      await api("/sections", {
        method: "POST",
        body: JSON.stringify({ name, blocks: sel.map((b) => ({ type: b.type, content: b.content, style: b.style || {}, col: b.col, col_span: b.col_span, row: b.row, row_span: b.row_span })) }),
      });
      await loadSections();
      el("sections-panel").open = true;
      alert(`Saved "${name}". Find it under Sections in the Page tab.`);
    } catch (err) {
      alert(err.message);
    }
  });
  el("sections-panel").addEventListener("toggle", () => {
    if (el("sections-panel").open) loadSections();
  });

  // ---------- Page-specific CSS ----------
  // Stored per page on the server (its own endpoint, not part of the page's versioned fields). "Preview" applies the
  // textarea to the Screen Preview frame without saving; "Save CSS" stores it for the live page.
  let pageCssPreview = null;
  let pageCssLoadedFor = null;
  async function loadPageCss() {
    const page = currentPage;
    if (!page) return;
    pageCssPreview = null;
    el("page-custom-css").value = "";
    el("page-css-status").textContent = "";
    try {
      const res = await api(`/pages/${page.id}/css`);
      if (currentPage && currentPage.id === page.id) {
        el("page-custom-css").value = res.css || "";
        el("page-css-panel").open = !!res.css;
        pageCssLoadedFor = page.id;
      }
    } catch (e) {
      if (currentPage && currentPage.id === page.id) el("page-css-status").textContent = "Couldn't load the page CSS: " + e.message;
    }
  }
  function applyPageCssPreview() {
    let doc;
    try {
      doc = el("preview-frame").contentDocument;
    } catch (e) {
      return;
    }
    if (!doc || !doc.head) return;
    doc.querySelectorAll("style[data-page-css-preview]").forEach((n) => n.remove());
    if (pageCssPreview === null) return;
    // The preview replaces the saved rules, so what's shown is exactly what saving would publish.
    doc.querySelectorAll("style[data-page-css]").forEach((n) => n.remove());
    const style = doc.createElement("style");
    style.setAttribute("data-page-css-preview", "");
    style.textContent = pageCssPreview;
    doc.head.appendChild(style);
  }
  el("preview-frame").addEventListener("load", applyPageCssPreview);
  el("page-css-preview-btn").addEventListener("click", () => {
    if (!currentPage) return;
    pageCssPreview = el("page-custom-css").value;
    if (el("preview-modal").hidden) el("preview-btn").click();
    else reloadPreviewFrame();
    el("page-css-status").textContent = "Previewing (not saved)";
  });
  el("page-css-save-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    const page = currentPage;
    el("page-css-status").textContent = "Saving…";
    try {
      const res = await api(`/pages/${page.id}/css`, { method: "PUT", body: JSON.stringify({ css: el("page-custom-css").value }) });
      // The admin may have switched pages while this was in flight; only touch the panel if it still shows this page.
      if (!currentPage || currentPage.id !== page.id) return;
      el("page-custom-css").value = res.css || "";
      pageCssPreview = null;
      el("page-css-status").textContent = "Saved " + new Date().toLocaleTimeString();
      schedulePreviewRefresh();
    } catch (err) {
      if (currentPage && currentPage.id === page.id) el("page-css-status").textContent = "Not saved: " + err.message;
    }
  });

  // ---------- Page password protection ----------
  // Separate Set/Remove actions rather than one field, since there's no
  // current value to show back (only its hash is ever stored) — a blank
  // field can't mean "leave as-is" vs. "remove protection" unambiguously.
  el("page-set-password-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    const password = el("page-password-input").value;
    if (!password.trim()) return alert("Enter a password first.");
    try {
      await api(`/pages/${currentPage.id}/password`, { method: "PUT", body: JSON.stringify({ password }) });
      await loadPages();
      await selectPage(currentPage.id);
    } catch (err) {
      alert(err.message);
    }
  });
  el("page-remove-password-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    if (!confirm("Remove password protection from this page? Anyone with the link will be able to view it.")) return;
    try {
      await api(`/pages/${currentPage.id}/password`, { method: "DELETE" });
      await loadPages();
      await selectPage(currentPage.id);
    } catch (err) {
      alert(err.message);
    }
  });

  el("duplicate-page-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    try {
      const res = await api(`/pages/${currentPage.id}/duplicate`, { method: "POST" });
      await loadPages();
      await selectPage(res.id);
    } catch (err) {
      alert(err.message);
    }
  });

  el("delete-page-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    if (!confirm(`Delete "${currentPage.title}" and all its blocks? This can't be undone.`)) return;
    await api(`/pages/${currentPage.id}`, { method: "DELETE" });
    currentPage = null;
    await loadPages();
  });

  el("lock-page-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    try {
      await api(`/pages/${currentPage.id}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: !currentPage.locked, expected_version: currentPage.version }),
      });
      await loadPages();
    } catch (err) {
      alert(err.message);
    }
  });
  wireFavoriteButton("favorite-page-btn", "page", () => currentPage && currentPage.id, () => currentPage && currentPage.title);

  // ---------- Blocks ----------
  async function loadBlocks() {
    blocks = await api(`/pages/${currentPage.id}/blocks`);
    selectedBlockId = null;
    renderCanvas();
    renderInspector();
  }

  function canvasMetrics() {
    const rect = canvas.getBoundingClientRect();
    const gap = parseFloat(getComputedStyle(canvas).getPropertyValue("--canvas-gap")) || 8;
    const colW = (rect.width - (COLS - 1) * gap) / COLS;
    return { colW, rowH: ROW_H, gap, width: rect.width };
  }

  function blockPixelStyle(b) {
    const { colW, rowH, gap } = canvasMetrics();
    const left = (b.col - 1) * (colW + gap);
    const width = b.col_span * colW + (b.col_span - 1) * gap;
    const top = (b.row - 1) * (rowH + gap);
    const height = b.row_span * rowH + (b.row_span - 1) * gap;
    return { left, top, width, height };
  }

  // Re-applies each already-rendered block's pixel geometry against the
  // canvas's *current* width, without touching the DOM nodes themselves —
  // called after anything that can change the canvas's available width
  // (showing/hiding the Inspector shrinks/grows it) without a full
  // renderCanvas(). Without this, a block selected while the Inspector was
  // closed keeps the wider left/width values computed for the pre-Inspector
  // canvas, so a block whose col_span reaches the old width (e.g. any
  // freshly-added block, which defaults to the full 24 columns) visually
  // overflows under the now-narrower Inspector panel — including its
  // resize handle, making it unreachable until the block is resized some
  // other way first.
  function repositionBlocks() {
    if (isMobile()) return;
    canvas.querySelectorAll(".admin-block").forEach((div) => {
      const block = blocks.find((b) => b.id === Number(div.dataset.id));
      if (!block) return;
      const style = blockPixelStyle(block);
      div.style.left = style.left + "px";
      div.style.top = style.top + "px";
      div.style.width = style.width + "px";
      div.style.height = style.height + "px";
    });
  }

  function blockLabel(type) {
    return { heading: "Heading", text: "Text", image: "Image", button: "Button", "project-card": "Project Card", "article-list": "Article List", "project-list": "Project List", video: "Video", quote: "Quote", gallery: "Gallery", "before-after": "Before / After", simulation: "Simulation", scan: "3D Scan", song: "Song", divider: "Divider", spacer: "Spacer", links: "Links", html: "HTML / Embed", changelog: "Changelog / Now", embed: "Generic Embed", accordion: "Accordion", tabs: "Tabs" }[type] || type;
  }

  let simulationOptions = [];
  function simulationNameById(id) {
    const s = simulationOptions.find((x) => x.id === id);
    return s ? s.name : null;
  }
  function simulationOptionLabel(simulation) {
    const status = simulation.is_published ? "Published" : "Draft — hidden publicly";
    return `${simulation.name} (${status})`;
  }

  let scanOptions = [];
  function scanNameById(id) {
    const s = scanOptions.find((x) => x.id === id);
    return s ? s.name : null;
  }

  let songOptions = [];
  function songNameById(id) {
    const s = songOptions.find((x) => x.id === id);
    return s ? s.name : null;
  }

  // A miniature of how the block reads on the live site (same content, scaled-down styling). Every
  // value is escaped; the wrapper classes (.pv-*) carry the look, so the text stays plain and testable.
  function blockPreview(b) {
    const c = b.content || {};
    const imgs = (urls) => urls.filter(Boolean).slice(0, 4).map((u) => `<img src="${escapeHtml(u)}" alt="" loading="lazy">`).join("");
    switch (b.type) {
      case "heading": return `<strong class="pv-heading">${escapeHtml(c.text || "(empty)")}</strong>`;
      case "text": return `<span class="pv-text">${escapeHtml((c.text || "").slice(0, 160) || "(empty)")}</span>`;
      case "image":
        return c.url
          ? `<img class="pv-image" src="${escapeHtml(c.url)}" alt="">${
              c.alt ? "" : `<span class="alt-text-warning" title="No alt text set — add one for accessibility and SEO">⚠ No alt text</span>`
            }`
          : "(no image url)";
      case "button": return `<span class="pv-button">Button: ${escapeHtml(c.label || "(no label)")}</span>`;
      case "project-card": return `<span class="pv-card"><strong>${escapeHtml(c.title || "(untitled)")}</strong>${c.description ? `<span>${escapeHtml(String(c.description).slice(0, 90))}</span>` : ""}</span>`;
      case "article-list": return `<span class="pv-list">Shows latest ${c.limit || 10} posts</span>`;
      case "project-list": return `<span class="pv-list">Shows latest ${c.limit || 12} projects</span>`;
      case "video": return c.url ? `<span class="pv-media">▶ ${escapeHtml(c.url)}</span>` : "(no video url)";
      case "embed": return c.url ? `<span class="pv-media">${escapeHtml(c.url)}</span>` : "(no embed url)";
      case "quote": return c.text ? `<span class="pv-quote">“${escapeHtml(c.text.slice(0, 100))}”</span>` : "(empty)";
      case "gallery": return `<span class="pv-gallery">${imgs((c.images || []).map((i) => (typeof i === "string" ? i : i && i.url)))}</span>${(c.images || []).length} image(s)`;
      case "before-after": return c.beforeUrl && c.afterUrl ? `<span class="pv-gallery">${imgs([c.beforeUrl, c.afterUrl])}</span>Before/after comparison` : "(missing before or after image)";
      case "simulation": return c.simulation_id ? escapeHtml(simulationNameById(c.simulation_id) || `#${c.simulation_id}`) : "(choose a simulation)";
      case "scan": return c.scan_id ? escapeHtml(scanNameById(c.scan_id) || `#${c.scan_id}`) : "(choose a scan)";
      case "song": return c.song_id ? escapeHtml(songNameById(c.song_id) || `#${c.song_id}`) : "(choose a song)";
      case "divider": return `<hr class="pv-divider">`;
      case "spacer": return `<span class="pv-spacer">(spacer)</span>`;
      case "links": return `<span class="pv-list">${(c.items || []).length} link(s)</span>`;
      case "changelog": return `${(c.entries || []).length} entr${(c.entries || []).length === 1 ? "y" : "ies"}`;
      case "html": return c.html ? "(custom HTML)" : "(empty)";
      case "accordion": return `${(c.items || []).length} section(s)`;
      case "tabs": return `${(c.tabs || []).length} tab(s)`;
      default: return "";
    }
  }

  function escapeHtml(s) {
    const d = document.createElement("div");
    d.textContent = s;
    // textContent->innerHTML escapes <, >, & for text-node safety, but
    // this is also used inside HTML attribute values (e.g. title="…")
    // throughout this file, so quotes need escaping too or a value
    // containing one can break out of the attribute.
    return d.innerHTML.replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  }

  // A simulation/scan/song block whose reference is unavailable is omitted
  // from public pages before row occupancy is calculated. The admin canvas
  // keeps it editable but marks the missing reference; these checks reuse
  // the same *NameById() lookups blockPreview() already uses.
  function brokenReferenceLookup(b) {
    const c = b.content || {};
    if (b.type === "simulation" && c.simulation_id) return !simulationNameById(c.simulation_id);
    if (b.type === "scan" && c.scan_id) return !scanNameById(c.scan_id);
    if (b.type === "song" && c.song_id) return !songNameById(c.song_id);
    return false;
  }

  // Explains *why* a block behaves the way it does on canvas — several
  // style fields (date-window visibility, the reading-order override) can
  // silently change what a visitor sees or how a screen reader walks the
  // page with zero visual trace on the canvas itself, which is exactly how
  // the reading-order "can't clear it" bug went unnoticed: nothing on
  // canvas showed the override was still there. A block schedued via
  // visibleFrom/visibleUntil gets a badge describing its *current* state
  // (not just "scheduled") since "visible now, hides later" and "hidden
  // now, shows later" need different at-a-glance treatment.
  function scheduledVisibilityBadge(style) {
    if (!style || (!style.visibleFrom && !style.visibleUntil)) return "";
    const now = new Date().toISOString();
    const fmt = (iso) => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
    if (style.visibleFrom && style.visibleFrom > now) {
      return ` <span class="lock-badge diagnostic-error" title="Not visible yet — starts showing ${fmt(style.visibleFrom)}">Hidden until ${fmt(style.visibleFrom)}</span>`;
    }
    if (style.visibleUntil && style.visibleUntil <= now) {
      return ` <span class="lock-badge diagnostic-error" title="No longer visible — expired ${fmt(style.visibleUntil)}">Expired ${fmt(style.visibleUntil)}</span>`;
    }
    if (style.visibleUntil) {
      return ` <span class="lock-badge" title="Currently visible — will hide ${fmt(style.visibleUntil)}">Hides ${fmt(style.visibleUntil)}</span>`;
    }
    // Reachable only once the first three branches above have ruled out a
    // future visibleFrom and any visibleUntil — a visibleFrom that's already
    // passed with no end date set is just a normal, unconditionally-visible
    // block from here on (matches worker/render.js's isBlockInDateWindow()
    // exactly), so it needs no badge at all rather than a leftover
    // "Scheduled" claiming a start date that already happened.
    return "";
  }

  // The same reading of an address rule as the server (worker/render.js parseUrlRule):
  // returns the cleaned "name" or "name=value", or "" when it can't be read.
  function urlRuleParsed(raw) {
    const text = String(raw || "").trim().replace(/^\?/, "").trim();
    const m = text.match(/^([A-Za-z0-9_.-]{1,40})\s*(?:=\s*([^&#\s]{0,80}))?$/);
    return m ? m[1] + (m[2] !== undefined ? "=" + m[2] : "") : "";
  }

  function blockBadgesHtml(b) {
    const visibility = b.style && b.style.visibility;
    const readingOrderRaw = b.style && b.style.readingOrder;
    const hasReadingOrder = typeof readingOrderRaw === "number" && Number.isFinite(readingOrderRaw);
    return `${groupOf(b) && blocks.filter((x) => groupOf(x) === groupOf(b)).length > 1 ? ` <span class="lock-badge" title="Part of a group: grouped blocks drag together">Group</span>` : ""}${
      b.shared_block_id ? ` <span class="lock-badge" title="Reusable block — editing it updates every page that uses it">Reusable</span>` : ""
    }${b.locked ? ` <span class="lock-badge" title="Locked — protected from accidental drag/resize/delete">Locked</span>` : ""}${
      visibility === "desktop-only" ? ` <span class="lock-badge" title="Hidden on mobile — desktop only">Desktop only</span>` : ""
    }${
      visibility === "mobile-only" ? ` <span class="lock-badge" title="Hidden on desktop — mobile only">Mobile only</span>` : ""
    }${
      b.style && (b.style.urlRule === "show" || b.style.urlRule === "hide")
        ? urlRuleParsed(b.style.urlParam)
          ? ` <span class="lock-badge" title="${b.style.urlRule === "show" ? "Only shown when the page address has" : "Hidden when the page address has"} ?${escapeHtml(urlRuleParsed(b.style.urlParam))}">${b.style.urlRule === "show" ? "Only with" : "Hidden with"} ?${escapeHtml(urlRuleParsed(b.style.urlParam))}</span>`
          : ` <span class="lock-badge diagnostic-error" title="${b.style.urlRule === "show" ? "The address rule can't be read, so this block is hidden from visitors" : "The address rule can't be read, so it has no effect"}. Write it as name or name=value.">Invalid address rule</span>`
        : ""
    }${b.style && b.style.hidden ? ` <span class="lock-badge" title="Hidden from the live site entirely">Hidden</span>` : ""}${scheduledVisibilityBadge(
      b.style
    )}${
      hasReadingOrder
        ? ` <span class="lock-badge" title="Reads/tabs out of visual order — reading-order override set to ${readingOrderRaw}, independent of this block's position on the grid">Reading order: ${readingOrderRaw}</span>`
        : ""
    }${
      brokenReferenceLookup(b)
        ? ` <span class="lock-badge broken-ref-badge" title="This reference is missing — the block is omitted from public pages">Broken reference</span>`
        : ""
    }`;
  }

  // ---------- Block groups ----------
  // A group is just a shared style.group id on several blocks (no schema change; the public renderer ignores it).
  // Grouped blocks drag together, show a dashed outline, and can be saved as a reusable section.
  const groupOf = (b) => (b && b.style && typeof b.style.group === "string" && b.style.group) || null;
  function groupMatesOf(block) {
    const g = groupOf(block);
    if (!g) return [];
    const mates = blocks.filter((x) => x.id !== block.id && groupOf(x) === g);
    return mates.some((m) => isLayoutLocked(m)) || isLayoutLocked(block) ? [] : mates;
  }
  function renderGroupOutlines() {
    canvas.querySelectorAll(".group-outline").forEach((n) => n.remove());
    const groups = new Map();
    blocks.forEach((b) => {
      const g = groupOf(b);
      if (g) groups.set(g, [...(groups.get(g) || []), b]);
    });
    groups.forEach((members) => {
      if (members.length < 2) return;
      const rects = members.map(blockPixelStyle);
      const left = Math.min(...rects.map((r) => r.left)) - 4;
      const top = Math.min(...rects.map((r) => r.top)) - 4;
      const right = Math.max(...rects.map((r) => r.left + r.width)) + 4;
      const bottom = Math.max(...rects.map((r) => r.top + r.height)) + 4;
      const box = document.createElement("div");
      box.className = "group-outline";
      box.setAttribute("aria-hidden", "true");
      box.style.cssText = `left:${left}px;top:${top}px;width:${right - left}px;height:${bottom - top}px`;
      canvas.insertBefore(box, canvas.firstChild);
    });
  }
  async function setBlocksGroup(list, group) {
    for (const b of list) {
      const style = { ...(b.style || {}) };
      if (group) style.group = group;
      else delete style.group;
      await api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ style }) });
      b.style = style;
    }
  }
  const styleWithoutGroup = (style) => {
    const out = { ...(style || {}) };
    delete out.group;
    return out;
  };
  const newGroupId = () => "g" + Math.random().toString(36).slice(2, 10);

  function renderCanvas() {
    if (isMobile()) renderCanvasMobile();
    else renderCanvasDesktop();
  }

  function renderCanvasDesktop() {
    canvas.classList.remove("admin-canvas-mobile-stack");
    canvas.innerHTML = "";
    canvas.classList.toggle("isolation-mode", isolationMode && selectedBlockId !== null);
    canvas.classList.toggle("content-only-mode", contentOnlyMode);
    let maxBottom = 600;
    for (const b of blocks) {
      const style = blockPixelStyle(b);
      maxBottom = Math.max(maxBottom, style.top + style.height + 100);
      const div = document.createElement("div");
      div.className =
        "admin-block" +
        (b.id === selectedBlockId || multiSelectedIds.has(b.id) ? " selected" : "") +
        (b.style && b.style.hidden ? " block-is-hidden" : "") +
        (b.locked ? " block-locked" : "") +
        (isolationMode && selectedBlockId !== null && b.id !== selectedBlockId ? " is-dimmed" : "");
      div.style.left = style.left + "px";
      div.style.top = style.top + "px";
      div.style.width = style.width + "px";
      div.style.height = style.height + "px";
      div.dataset.id = b.id;
      div.innerHTML = `<div class="block-type-label"><span class="block-type-name">${blockLabel(b.type)}</span>${blockBadgesHtml(
        b
      )}</div><div class="block-preview">${blockPreview(b)}</div><div class="resize-handle"></div>`;
      // Short blocks drop the type name (kept as a tooltip) so the miniature gets the room.
      if (style.height < 80) {
        div.classList.add("admin-block-compact");
        if (style.height < 34) div.classList.add("admin-block-xs");
        div.title = blockLabel(b.type);
      }
      canvas.appendChild(div);
      wireBlockInteractions(div, b);
    }
    canvas.style.minHeight = maxBottom + "px";
    renderGroupOutlines();
    renderCanvasToolbar();
    if (!el("layers-modal").hidden) renderLayersList();
  }

  // A small toolbar floating above the single selected block. Each button just presses the matching
  // Inspector button, so lock checks, confirmations and saving stay in one place.
  function hideCanvasToolbar() {
    canvas.querySelectorAll(".canvas-toolbar").forEach((n) => (n.hidden = true));
  }
  // After a toolbar action the canvas rebuilds; this remembers which button to put focus back on.
  let toolbarFocusIndex = null;
  function renderCanvasToolbar() {
    canvas.querySelectorAll(".canvas-toolbar").forEach((n) => n.remove());
    if (contentOnlyMode || multiSelectedIds.size > 1 || selectedBlockId === null) return;
    const b = blocks.find((x) => x.id === selectedBlockId);
    if (!b) return;
    const style = blockPixelStyle(b);
    const bar = document.createElement("div");
    bar.className = "canvas-toolbar";
    bar.setAttribute("role", "toolbar");
    bar.setAttribute("aria-label", `${blockLabel(b.type)} block actions`);
    // Above the block when there's room; in the first row it would cover the block, so sit below instead.
    bar.style.top = (style.top >= 40 ? style.top - 36 : style.top + style.height + 4) + "px";
    bar.style.left = style.left + "px";
    [
      ["copy-block-btn", "Copy"],
      ["duplicate-block-btn", "Duplicate"],
      ["lock-block-btn", b.locked ? "Unlock" : "Lock"],
      ["delete-block-btn", "Delete"],
    ].forEach(([id, label], idx) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = label;
      if (id === "delete-block-btn") {
        btn.className = "canvas-toolbar-danger";
        if (b.locked) {
          btn.disabled = true;
          btn.title = "Unlock this block before deleting it";
        }
      }
      // Keep the press from starting a drag or clearing the selection underneath.
      btn.addEventListener("mousedown", (e) => e.stopPropagation());
      btn.addEventListener("pointerdown", (e) => e.stopPropagation());
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        toolbarFocusIndex = id === "delete-block-btn" ? null : idx;
        if (toolbarFocusIndex !== null) setTimeout(() => (toolbarFocusIndex = null), 3000);
        el(id).click();
      });
      bar.appendChild(btn);
    });
    // Right after the selected block in the DOM, so Tab reaches it without crossing every later block.
    const blockDiv = canvas.querySelector(`.admin-block[data-id="${b.id}"]`);
    if (blockDiv) blockDiv.after(bar);
    else canvas.appendChild(bar);
    // Keep it inside the canvas: slide left when the block sits against the right edge.
    const max = canvas.clientWidth - bar.offsetWidth - 2;
    if (style.left > max) bar.style.left = Math.max(2, max) + "px";
    if (toolbarFocusIndex !== null) {
      const target = bar.querySelectorAll("button")[toolbarFocusIndex];
      toolbarFocusIndex = null;
      if (target && !target.disabled) target.focus();
    }
  }

  // The absolute-position 24-column grid is a faithful desktop editing
  // surface, but at phone width a block's real column width shrinks to
  // the point that side-by-side blocks (a normal, correct desktop layout)
  // become too narrow to read or tap individually, and a fixed fixed-px
  // row height clips any content that needs more room at that width. On
  // mobile, edit as a plain full-width stacked list instead — same block
  // data, no col/row pixel math, with Up/Down buttons in place of 2D drag
  // (which doesn't map to a single column anyway). Desktop editing is
  // completely unaffected; this only changes how <=860px renders/behaves.
  function renderCanvasMobile() {
    canvas.classList.add("admin-canvas-mobile-stack");
    canvas.innerHTML = "";
    canvas.classList.remove("isolation-mode", "content-only-mode");
    canvas.style.minHeight = "";
    const sorted = [...blocks].sort((a, b) => a.row - b.row || a.col - b.col);
    sorted.forEach((b, i) => {
      const div = document.createElement("div");
      div.className =
        "admin-block admin-block-stacked" +
        (b.id === selectedBlockId ? " selected" : "") +
        (b.style && b.style.hidden ? " block-is-hidden" : "") +
        (b.locked ? " block-locked" : "");
      div.dataset.id = b.id;
      div.tabIndex = 0;
      div.setAttribute("role", "button");
      div.setAttribute("aria-label", `${blockLabel(b.type)} block`);
      div.innerHTML = `<div class="block-type-label">${blockLabel(b.type)}${blockBadgesHtml(b)}</div><div class="block-preview">${blockPreview(
        b
      )}</div><div class="stacked-block-controls"><button type="button" class="stacked-move-up" aria-label="Move up"${
        i === 0 ? " disabled" : ""
      }>↑</button><button type="button" class="stacked-move-down" aria-label="Move down"${i === sorted.length - 1 ? " disabled" : ""}>↓</button></div>`;
      const selectThisBlock = () => {
        selectedBlockId = b.id;
        multiSelectedIds.clear();
        renderCanvas();
        renderInspector();
        openDrawer(el("inspector"));
      };
      div.addEventListener("click", selectThisBlock);
      div.addEventListener("keydown", (e) => {
        if ((e.key !== "Enter" && e.key !== " ") || e.target !== div) return;
        e.preventDefault();
        selectThisBlock();
      });
      const moveUp = div.querySelector(".stacked-move-up");
      const moveDown = div.querySelector(".stacked-move-down");
      moveUp.addEventListener("click", (e) => {
        e.stopPropagation();
        if (i > 0) swapStackedBlocks(sorted[i], sorted[i - 1]);
      });
      moveDown.addEventListener("click", (e) => {
        e.stopPropagation();
        if (i < sorted.length - 1) swapStackedBlocks(sorted[i], sorted[i + 1]);
      });
      canvas.appendChild(div);
    });
    if (!el("layers-modal").hidden) renderLayersList();
  }

  async function swapStackedBlocks(a, b) {
    if (isLayoutLocked(a) || isLayoutLocked(b)) return;
    const aPos = { row: a.row, col: a.col };
    a.row = b.row;
    a.col = b.col;
    b.row = aPos.row;
    b.col = aPos.col;
    await Promise.all([patchBlockPosition(a), patchBlockPosition(b)]);
    renderCanvas();
  }

  function rectsOverlap(a, b) {
    return a.col < b.col + b.col_span && a.col + a.col_span > b.col && a.row < b.row + b.row_span && a.row + a.row_span > b.row;
  }

  function wouldOverlap(block) {
    return blocks.some((b) => b.id !== block.id && rectsOverlap(block, b));
  }

  function flashRejected(div) {
    div.classList.add("overlap-warning");
    setTimeout(() => div.classList.remove("overlap-warning"), 800);
  }

  function clearSnapGuides() {
    canvas.querySelectorAll(".snap-guide").forEach((g) => g.remove());
  }

  // Figma-style alignment guides: while dragging/resizing, highlight when
  // this block's edge or center lines up with another block's — the grid
  // already quantizes movement to whole columns/rows, so an aligned pair
  // lands on the exact same pixel value, no fuzzy tolerance needed beyond
  // float rounding noise.
  function updateSnapGuides(block) {
    clearSnapGuides();
    const style = blockPixelStyle(block);
    const bLeft = style.left;
    const bRight = style.left + style.width;
    const bCenterX = style.left + style.width / 2;
    const bTop = style.top;
    const bBottom = style.top + style.height;
    const bCenterY = style.top + style.height / 2;
    const TOL = 0.5;
    let vx = null;
    let hy = null;
    for (const o of blocks) {
      if (o.id === block.id) continue;
      const os = blockPixelStyle(o);
      const oLeft = os.left;
      const oRight = os.left + os.width;
      const oCenterX = os.left + os.width / 2;
      const oTop = os.top;
      const oBottom = os.top + os.height;
      const oCenterY = os.top + os.height / 2;
      if (vx === null) {
        if (Math.abs(bLeft - oLeft) < TOL) vx = oLeft;
        else if (Math.abs(bRight - oRight) < TOL) vx = oRight;
        else if (Math.abs(bCenterX - oCenterX) < TOL) vx = oCenterX;
      }
      if (hy === null) {
        if (Math.abs(bTop - oTop) < TOL) hy = oTop;
        else if (Math.abs(bBottom - oBottom) < TOL) hy = oBottom;
        else if (Math.abs(bCenterY - oCenterY) < TOL) hy = oCenterY;
      }
    }
    if (vx !== null) {
      const line = document.createElement("div");
      line.className = "snap-guide snap-guide-v";
      line.style.left = vx + "px";
      canvas.appendChild(line);
    }
    if (hy !== null) {
      const line = document.createElement("div");
      line.className = "snap-guide snap-guide-h";
      line.style.top = hy + "px";
      canvas.appendChild(line);
    }
  }

  function wireBlockInteractions(div, block) {
    div.tabIndex = 0;
    div.setAttribute("role", "button");
    div.setAttribute("aria-label", `${blockLabel(block.type)} block`);
    div.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.target !== div) return;
      e.preventDefault();
      multiSelectedIds.clear();
      selectedBlockId = block.id;
      renderCanvas();
      renderInspector();
      // renderCanvas() rebuilds every block div from scratch, so the one
      // that just received Enter/Space no longer exists — refocus its
      // replacement or a keyboard user's Tab position silently resets to
      // the top of the canvas every time they select a block.
      canvas.querySelector(`.admin-block[data-id="${block.id}"]`)?.focus();
    });
    div.addEventListener("pointerdown", (e) => {
      if (e.target.classList.contains("resize-handle")) return;
      if (e.shiftKey) {
        e.stopPropagation();
        // Shift-clicking while a single block is selected should carry that
        // one into the new multi-selection too, matching how shift-click
        // accumulates a selection everywhere else — otherwise the block you
        // clicked *before* holding shift would silently drop out.
        if (multiSelectedIds.size === 0 && selectedBlockId !== null && selectedBlockId !== block.id) {
          multiSelectedIds.add(selectedBlockId);
        }
        if (multiSelectedIds.has(block.id)) multiSelectedIds.delete(block.id);
        else multiSelectedIds.add(block.id);
        selectedBlockId = null;
        renderCanvas();
        renderInspector();
        return;
      }
      // A plain click always exits multi-select mode, even when it lands
      // on a block that was already part of the selection — dragging
      // several blocks together isn't supported, so keeping multi-select
      // "active" here would just be confusing.
      multiSelectedIds.clear();
      selectedBlockId = block.id;
      renderInspector();
      document.querySelectorAll(".admin-block").forEach((d) => {
        d.classList.remove("selected");
        // Isolation dimming is keyed off selectedBlockId, but this handler
        // updates the DOM directly instead of calling renderCanvas() (so a
        // drag can start on the same pointerdown) — without this, switching
        // isolation to a newly-clicked block would wait until the next full
        // re-render to actually move.
        if (isolationMode) d.classList.toggle("is-dimmed", d !== div);
      });
      div.classList.add("selected");
      canvas.classList.toggle("isolation-mode", isolationMode);
      renderCanvasToolbar();
      // Selection still works on a locked block (so its content/style stay
      // editable) — only the drag-to-move below is skipped, which is the
      // "accidental" change locking is meant to guard against.
      if (isLayoutLocked(block)) return;

      const startX = e.clientX;
      const startY = e.clientY;
      const startCol = block.col;
      const startRow = block.row;
      const { colW, rowH, gap } = canvasMetrics();
      div.setPointerCapture(e.pointerId);

      // A block in a group drags with the rest of its group (unless one of them is locked, then it moves alone).
      const mates = groupMatesOf(block);
      const members = [block, ...mates];
      const starts = new Map(members.map((m) => [m.id, { col: m.col, row: m.row }]));
      const minDC = Math.max(...members.map((m) => 1 - starts.get(m.id).col));
      const maxDC = Math.min(...members.map((m) => COLS - m.col_span + 1 - starts.get(m.id).col));
      const minDR = Math.max(...members.map((m) => 1 - starts.get(m.id).row));
      const placeDiv = (m) => {
        const d = m === block ? div : canvas.querySelector(`.admin-block[data-id="${m.id}"]`);
        if (!d) return;
        const st = blockPixelStyle(m);
        d.style.left = st.left + "px";
        d.style.top = st.top + "px";
      };

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dC = Math.min(Math.max(Math.round(dx / (colW + gap)), minDC), maxDC);
        const dR = Math.max(Math.round(dy / (rowH + gap)), minDR);
        if (members.some((m) => m.col !== starts.get(m.id).col + dC || m.row !== starts.get(m.id).row + dR)) {
          members.forEach((m) => {
            m.col = starts.get(m.id).col + dC;
            m.row = starts.get(m.id).row + dR;
            placeDiv(m);
          });
          hideCanvasToolbar();
        }
        updateSnapGuides(block);
      }
      function onUp() {
        div.removeEventListener("pointermove", onMove);
        div.removeEventListener("pointerup", onUp);
        clearSnapGuides();
        // Put the toolbar back over wherever the block ended up (also after a snap-back).
        queueMicrotask(renderCanvasToolbar);
        const moved = members.filter((m) => m.col !== starts.get(m.id).col || m.row !== starts.get(m.id).row);
        // No overlaps allowed: if the drop spot collides with another
        // block, snap back to where the drag started instead of saving it.
        if (moved.length && moved.some((m) => wouldOverlap(m))) {
          members.forEach((m) => {
            m.col = starts.get(m.id).col;
            m.row = starts.get(m.id).row;
            placeDiv(m);
          });
          flashRejected(div);
          return;
        }
        // A plain click (select without moving) must not write: it bumped the block's
        // updated_at and could race a concurrent edit for nothing.
        if (!moved.length) return;
        Promise.all(
          moved.map((m) => api(`/blocks/${m.id}`, { method: "PATCH", body: JSON.stringify({ col: m.col, row: m.row }) }))
        )
          .then(() => (mates.length ? renderCanvas() : undefined))
          .catch((err) => alert(err.message));
      }
      div.addEventListener("pointermove", onMove);
      div.addEventListener("pointerup", onUp);
    });

    const handle = div.querySelector(".resize-handle");
    handle.addEventListener("pointerdown", (e) => {
      e.stopPropagation();
      if (isLayoutLocked(block)) return; // also hidden via CSS (.block-locked/.content-only-mode .resize-handle), this is belt-and-suspenders
      const startX = e.clientX;
      const startY = e.clientY;
      const startSpan = block.col_span;
      const startRowSpan = block.row_span;
      const { colW, rowH, gap } = canvasMetrics();
      handle.setPointerCapture(e.pointerId);

      function onMove(ev) {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        const dCol = Math.round(dx / (colW + gap));
        const dRow = Math.round(dy / (rowH + gap));
        const newSpan = Math.min(Math.max(1, startSpan + dCol), COLS - block.col + 1);
        const newRowSpan = Math.max(1, startRowSpan + dRow);
        if (newSpan !== block.col_span || newRowSpan !== block.row_span) {
          block.col_span = newSpan;
          block.row_span = newRowSpan;
          const style = blockPixelStyle(block);
          div.style.width = style.width + "px";
          div.style.height = style.height + "px";
          hideCanvasToolbar();
        }
        updateSnapGuides(block);
      }
      function onUp() {
        handle.removeEventListener("pointermove", onMove);
        handle.removeEventListener("pointerup", onUp);
        clearSnapGuides();
        queueMicrotask(renderCanvasToolbar);
        if ((block.col_span !== startSpan || block.row_span !== startRowSpan) && wouldOverlap(block)) {
          block.col_span = startSpan;
          block.row_span = startRowSpan;
          const style = blockPixelStyle(block);
          div.style.width = style.width + "px";
          div.style.height = style.height + "px";
          flashRejected(div);
          return;
        }
        if (block.col_span === startSpan && block.row_span === startRowSpan) return; // nothing changed: no write
        api(`/blocks/${block.id}`, {
          method: "PATCH",
          body: JSON.stringify({ col_span: block.col_span, row_span: block.row_span }),
        }).catch((err) => alert(err.message));
      }
      handle.addEventListener("pointermove", onMove);
      handle.addEventListener("pointerup", onUp);
    });
  }

  // The left panel used to be one long scroll: 22 full-width block
  // buttons, then every page setting and page action underneath. It's now
  // two tabs -- Blocks (a searchable icon grid) and Page (settings grouped
  // into collapsible sections) -- so neither buries the other.
  function switchLeftPanel(name) {
    ["blocks", "page"].forEach((n) => {
      const active = n === name;
      el(`panel-tab-${n}`).setAttribute("aria-selected", String(active));
      el(`palette-${n}`).hidden = !active;
    });
    try {
      localStorage.setItem("admin-left-panel", name);
    } catch (e) {}
  }
  el("panel-tab-blocks").addEventListener("click", () => switchLeftPanel("blocks"));
  el("panel-tab-page").addEventListener("click", () => switchLeftPanel("page"));
  try {
    if (localStorage.getItem("admin-left-panel") === "page") switchLeftPanel("page");
  } catch (e) {}

  el("palette-search").addEventListener("input", () => {
    const q = el("palette-search").value.trim().toLowerCase();
    let any = false;
    document.querySelectorAll(".palette-group").forEach((group) => {
      let groupHas = false;
      group.querySelectorAll(".palette-btn").forEach((btn) => {
        const match = !q || btn.textContent.toLowerCase().includes(q) || btn.dataset.type.includes(q);
        btn.hidden = !match;
        if (match) groupHas = true;
      });
      group.hidden = !groupHas;
      if (groupHas) any = true;
    });
    el("palette-no-match").hidden = any;
  });
  el("palette-search").addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const first = document.querySelector(".palette-group:not([hidden]) .palette-btn:not([hidden])");
    if (first) first.click();
  });

  document.querySelectorAll(".palette-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!currentPage) return;
      const type = btn.dataset.type;
      const defaults = {
        heading: { content: { text: "New heading", level: 1 }, col_span: 24, row_span: 4 },
        text: { content: { text: "Write something here." }, col_span: 16, row_span: 6 },
        image: { content: { url: "", alt: "" }, col_span: 12, row_span: 12 },
        button: { content: { label: "Click me", url: "#", external: false }, col_span: 6, row_span: 2 },
        "project-card": { content: { title: "Project", description: "", url: "", label: "View" }, col_span: 12, row_span: 6 },
        "article-list": { content: { limit: 10 }, col_span: 24, row_span: 12 },
        "project-list": { content: { limit: 12 }, col_span: 24, row_span: 16 },
        // A full-width (24-col) simulation SVG at its 1500:700 aspect ratio,
        // plus the power button below it, renders taller than it looks like
        // it should need — row_span accounts for that so it doesn't overflow
        // into whatever comes after it (grid rows here are a fixed 16px+gap).
        simulation: { content: { simulation_id: null }, col_span: 24, row_span: 25 },
        song: { content: { song_id: null }, col_span: 16, row_span: 6 },
        // model-viewer is a fixed 420px tall (public/style.css) regardless of
        // its container width — row_span picked to roughly match that at a
        // typical column width so it doesn't look cramped or overflow by default.
        scan: { content: { scan_id: null }, col_span: 24, row_span: 22 },
        video: { content: { url: "" }, col_span: 16, row_span: 12 },
        embed: { content: { url: "" }, col_span: 16, row_span: 12 },
        quote: { content: { text: "Quote text here.", cite: "" }, col_span: 16, row_span: 6 },
        gallery: { content: { images: [] }, col_span: 24, row_span: 12 },
        "before-after": { content: { beforeUrl: "", afterUrl: "", beforeLabel: "Before", afterLabel: "After" }, col_span: 16, row_span: 14 },
        links: { content: { items: [] }, col_span: 12, row_span: 6 },
        changelog: { content: { entries: [] }, col_span: 24, row_span: 16 },
        accordion: {
          content: {
            items: [
              { title: "First section", body: "Content for the first section." },
              { title: "Second section", body: "Content for the second section." },
            ],
          },
          col_span: 16,
          row_span: 12,
        },
        tabs: {
          content: {
            tabs: [
              { label: "Tab one", body: "Content for the first tab." },
              { label: "Tab two", body: "Content for the second tab." },
            ],
          },
          col_span: 16,
          row_span: 12,
        },
        html: { content: { html: "<!-- your HTML here -->" }, col_span: 24, row_span: 8 },
        divider: { content: {}, col_span: 24, row_span: 2 },
        spacer: { content: {}, col_span: 24, row_span: 2 },
      }[type] || { content: {}, col_span: 12, row_span: 4 };

      const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
      const body = { type, col: 1, row: maxRow, ...defaults };
      try {
        await api(`/pages/${currentPage.id}/blocks`, { method: "POST", body: JSON.stringify(body) });
        await loadBlocks();
        if (isMobile()) closeDrawers();
      } catch (err) {
        alert(err.message);
      }
    });
  });

  // ---------- Copy/paste blocks (works across pages — clipboard is
  // localStorage, so it survives navigating to a different page or even
  // reopening the admin later). Always creates an independent copy, unlike
  // a reusable block's live link — that's the dedicated flow for "this
  // should update everywhere"; copy/paste is just a plain duplicate.
  const BLOCK_CLIPBOARD_KEY = "admin_block_clipboard";
  function updatePasteButtonVisibility() {
    let hasClipboard = false;
    try {
      hasClipboard = !!localStorage.getItem(BLOCK_CLIPBOARD_KEY);
    } catch {}
    el("paste-block-btn").hidden = !hasClipboard || !currentPage;
  }

  el("paste-block-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    let clip;
    try {
      clip = JSON.parse(localStorage.getItem(BLOCK_CLIPBOARD_KEY) || "null");
    } catch {
      clip = null;
    }
    if (!clip) return;
    const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    try {
      await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({ type: clip.type, content: clip.content, style: styleWithoutGroup(clip.style), col: 1, row: maxRow, col_span: clip.col_span, row_span: clip.row_span }),
      });
      await loadBlocks();
      if (isMobile()) closeDrawers();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Inspector ----------
  const FIELD_DEFS = {
    heading: [
      { key: "text", label: "Text", type: "text" },
      {
        key: "level",
        label: "Heading level",
        type: "select",
        numeric: true,
        options: [
          [1, "H1 — page title (use once per page)"],
          [2, "H2"],
          [3, "H3"],
          [4, "H4"],
          [5, "H5"],
          [6, "H6"],
        ],
      },
    ],
    text: [{ key: "text", label: "Text (blank line = new paragraph, **bold**, *italic*, [link](url), ```code```, pipe tables, [^1] footnotes)", type: "textarea" }],
    image: [
      { key: "url", label: "Image URL", type: "image-url" },
      { key: "alt", label: "Alt text", type: "text" },
      { key: "caption", label: "Caption (shown under the image)", type: "text" },
      { key: "credit", label: "Credit (shown after the caption)", type: "text" },
      {
        key: "frame",
        label: "Device frame (for screenshots)",
        type: "select",
        options: [
          ["", "None"],
          ["browser", "Browser window"],
          ["phone", "Phone"],
        ],
      },
    ],
    button: [
      { key: "label", label: "Label", type: "text" },
      { key: "url", label: "URL", type: "text" },
      { key: "external", label: "Open in new tab", type: "checkbox" },
      { key: "trackEvent", label: "Track clicks as (optional custom analytics event name)", type: "text" },
    ],
    "project-card": [
      { key: "title", label: "Title", type: "text" },
      { key: "description", label: "Description", type: "textarea" },
      { key: "url", label: "Link URL", type: "text" },
      { key: "label", label: "Link label", type: "text" },
      { key: "external", label: "Open in new tab", type: "checkbox" },
    ],
    "article-list": [
      { key: "limit", label: "How many posts", type: "number" },
      { key: "tag", label: "Only show this tag (blank = all)", type: "text" },
      { key: "featuredOnly", label: "Only show featured posts", type: "checkbox" },
    ],
    "project-list": [
      { key: "limit", label: "How many projects", type: "number" },
      { key: "tag", label: "Only show this tag (blank = all)", type: "text" },
      { key: "featuredOnly", label: "Only show featured projects", type: "checkbox" },
      {
        key: "sort",
        label: "Sort by",
        type: "select",
        options: [
          ["newest", "Newest first"],
          ["manual", "Manual order (set per-project in the project editor)"],
        ],
      },
    ],
    video: [{ key: "url", label: "YouTube or Vimeo URL", type: "text" }],
    embed: [{ key: "url", label: "Embed URL (CodePen, Spotify, Figma, CodeSandbox, GitHub Gist, or any iframe-able link)", type: "text" }],
    quote: [
      { key: "text", label: "Quote text", type: "textarea" },
      { key: "cite", label: "Attribution (optional)", type: "text" },
      { key: "large", label: "Display as a large pull quote", type: "checkbox" },
    ],
    gallery: [{ key: "images", label: "Images", type: "gallery-urls" }],
    "before-after": [
      { key: "beforeUrl", label: "\"Before\" image URL", type: "image-url" },
      { key: "beforeLabel", label: "\"Before\" label", type: "text" },
      { key: "afterUrl", label: "\"After\" image URL", type: "image-url" },
      { key: "afterLabel", label: "\"After\" label", type: "text" },
    ],
    links: [{ key: "items", label: "Links (one per line: Label | URL)", type: "link-list" }],
    changelog: [{ key: "entries", label: "Entries (one per line: YYYY-MM-DD | Title | Description)", type: "changelog-list" }],
    accordion: [{ key: "items", label: "Sections (one per line: Title | Body)", type: "accordion-list" }],
    tabs: [{ key: "tabs", label: "Tabs (one per line: Label | Body)", type: "tabs-list" }],
    simulation: [
      { key: "simulation_id", label: "Simulation", type: "simulation-select" },
      { key: "description", label: "Description for screen readers (what does this circuit do?)", type: "textarea" },
    ],
    scan: [
      { key: "scan_id", label: "3D Scan", type: "scan-select" },
      { key: "description", label: "Description for screen readers (overrides the scan's name)", type: "textarea" },
    ],
    song: [{ key: "song_id", label: "Song", type: "song-select" }],
    html: [{ key: "html", label: "Raw HTML (advanced — rendered as-is, unescaped; be careful what you paste here)", type: "textarea", noSpellcheck: true }],
    divider: [],
    spacer: [],
  };

  const STYLE_FIELDS = [
    { key: "color", label: "Text color", type: "color" },
    { key: "bg", label: "Background color", type: "color" },
    {
      key: "fontFamily",
      label: "Font",
      type: "select",
      options: [
        ["", "Site default"],
        ["sans", "Sans-serif"],
        ["serif", "Serif"],
        ["mono", "Monospace"],
        ["rounded", "Rounded (Trebuchet)"],
        ["custom", "Custom (Site Settings)"],
      ],
    },
    { key: "fontSize", label: "Font size (px)", type: "number" },
    {
      key: "textAlign",
      label: "Text align",
      type: "select",
      options: [
        ["", "Default"],
        ["left", "Left"],
        ["center", "Center"],
        ["right", "Right"],
        ["justify", "Justify"],
      ],
    },
    { key: "padding", label: "Padding (px)", type: "number" },
    {
      key: "paddingStep",
      label: "Padding step (used when no exact padding is set)",
      type: "select",
      options: [
        ["", "None"],
        ["1", "1 (smallest)"],
        ["2", "2"],
        ["3", "3"],
        ["4", "4"],
        ["5", "5"],
        ["6", "6 (largest)"],
      ],
    },
    {
      key: "shadow",
      label: "Shadow",
      type: "select",
      options: [
        ["", "None"],
        ["sm", "Small"],
        ["md", "Medium"],
        ["lg", "Large"],
      ],
    },
    { key: "opacity", label: "Opacity (%)", type: "number" },
    { key: "borderWidth", label: "Border width (px)", type: "number" },
    { key: "borderColor", label: "Border color", type: "color" },
    { key: "borderRadius", label: "Border radius (px)", type: "number" },
    { key: "backgroundImage", label: "Background image", type: "image-url" },
    { key: "gradientFrom", label: "Background gradient — from color", type: "color" },
    { key: "gradientTo", label: "Background gradient — to color", type: "color" },
    { key: "gradientAngle", label: "Gradient angle (degrees, 0 = left-to-right, 135 = top-left to bottom-right)", type: "number" },
    {
      key: "backgroundSize",
      label: "Background image fit",
      type: "select",
      options: [
        ["cover", "Cover"],
        ["contain", "Contain"],
        ["auto", "Original size"],
      ],
    },
    { key: "backgroundVideoUrl", label: "Background video URL (.mp4 — plays behind the block, muted/looped)", type: "text" },
    {
      key: "parallax",
      label: "Parallax background (desktop only — the background image moves slower than the rest of the page while scrolling)",
      type: "checkbox",
    },
    {
      key: "blendMode",
      label: "Background blend mode",
      type: "select",
      options: [
        ["", "Normal"],
        ["multiply", "Multiply"],
        ["screen", "Screen"],
        ["overlay", "Overlay"],
        ["darken", "Darken"],
        ["lighten", "Lighten"],
        ["color-dodge", "Color dodge"],
        ["difference", "Difference"],
      ],
    },
    { key: "overlayColor", label: "Overlay color (tint over the background image/video)", type: "color" },
    { key: "overlayOpacity", label: "Overlay opacity (%)", type: "number" },
    {
      key: "position",
      label: "Position",
      type: "select",
      options: [
        ["", "Normal"],
        ["sticky", "Sticky (stays in view while scrolling past it)"],
        ["fixed", "Fixed (stays in view always, e.g. a floating button)"],
      ],
    },
    { key: "stickyOffset", label: "Sticky/fixed offset from top (px)", type: "number" },
    {
      key: "animation",
      label: "Entrance animation (plays once, when scrolled into view)",
      type: "select",
      options: [
        ["", "None"],
        ["fade-in", "Fade in"],
        ["slide-up", "Slide up"],
        ["slide-left", "Slide in from right"],
        ["slide-right", "Slide in from left"],
        ["zoom-in", "Zoom in"],
        ["custom", "Custom (build your own)…"],
      ],
    },
    { key: "animationDelay", label: "Animation delay (ms)", type: "number" },
    // Duration/easing/the keyframe list itself only matter when Entrance
    // animation above is set to "custom" -- they're owned by the
    // dedicated keyframe-editor modal (one focused place to define all of
    // it together, with a live preview) rather than three more always-
    // visible fields in this panel that do nothing for every other
    // animation choice.
    { key: "customKeyframes", label: "Custom animation keyframes", type: "keyframe-editor" },
    {
      key: "hoverEffect",
      label: "Hover effect",
      type: "select",
      options: [
        ["", "None"],
        ["lift", "Lift (rises with a shadow)"],
        ["grow", "Grow (scales up slightly)"],
        ["glow", "Glow (accent-color outline)"],
        ["darken", "Darken"],
      ],
    },
    {
      key: "visibility",
      label: "Show on",
      type: "select",
      options: [
        ["", "All devices"],
        ["desktop-only", "Desktop only (hidden on mobile)"],
        ["mobile-only", "Mobile only (hidden on desktop)"],
      ],
    },
    {
      key: "urlRule",
      label: "Address rule",
      type: "select",
      options: [
        ["", "None (always)"],
        ["show", "Show only when the address has…"],
        ["hide", "Hide when the address has…"],
      ],
    },
    { key: "urlParam", label: "…this query parameter, written as name or name=value (for example ref=newsletter, without the ?). Case matters. \"Show only\" hides the block from everyone whose address lacks it, including you while previewing; add the parameter to the page address to see it. One parameter per block. A \"Show only\" rule with no parameter hides the block.", type: "text" },
    { key: "visibleFrom", label: "Visible from (blank = always)", type: "datetime-local" },
    { key: "visibleUntil", label: "Visible until (blank = never expires)", type: "datetime-local" },
    {
      key: "readingOrder",
      label: "Reading order override (blank = follow visual position — a screen reader/Tab order fix for the rare layout where reading top-to-bottom, left-to-right isn't right; give it a number to slot it earlier or later, e.g. a low number like 1 to make it first)",
      type: "number",
    },
    {
      key: "mobileColSpan",
      label: "Mobile column span override (1–24, blank = full width, matching how many of this block's desktop 24 columns to keep on mobile instead of stacking full-width)",
      type: "number",
    },
    {
      key: "shapeMask",
      label: "Shape mask (clips the block to a shape — great on an image block)",
      type: "select",
      options: [
        ["", "None"],
        ["circle", "Circle"],
        ["diagonal-tl-br", "Diagonal (top-left to bottom-right)"],
        ["diagonal-tr-bl", "Diagonal (top-right to bottom-left)"],
        ["hexagon", "Hexagon"],
        ["blob", "Blob"],
      ],
    },
    { key: "customCss", label: "Custom CSS (advanced — raw declarations, e.g. transform: rotate(-2deg);)", type: "textarea", noSpellcheck: true },
    { key: "hidden", label: "Hide from live site", type: "checkbox" },
  ];

  // ---------- Style presets ----------
  // A saved snapshot of STYLE_FIELDS values — type-agnostic (every block
  // type shares the same style fields), so one preset library works for
  // buttons, cards, callouts, images, anything. Stored server-side (not
  // localStorage, unlike favorites/recents) since a style preset is
  // content an admin would want available on any device, not a personal
  // per-browser shortcut.
  let stylePresets = [];
  let lastInspectedBlockId = null;
  async function loadStylePresets() {
    stylePresets = await api("/style-presets").catch(() => []);
  }
  function populateStylePresetSelect() {
    el("apply-style-preset-select").innerHTML =
      `<option value="">Apply preset…</option>` + stylePresets.map((p) => `<option value="${p.id}">${escapeHtml(p.name)}</option>`).join("");
  }

  // The Style panel used to be one ~3,500px column of ~35 fields. Grouped
  // into collapsible sections instead; each summary shows how many of its
  // fields are set, so a styled block's settings are findable without
  // opening every group. Open/closed state lives here (not in the DOM)
  // because the inspector re-renders after every style change.
  const STYLE_GROUPS = [
    ["text", "Text", ["color", "fontFamily", "fontSize", "textAlign"]],
    ["box", "Box", ["bg", "padding", "paddingStep", "shadow", "opacity", "borderWidth", "borderColor", "borderRadius"]],
    ["background", "Background", ["backgroundImage", "gradientFrom", "gradientTo", "gradientAngle", "backgroundSize", "backgroundVideoUrl", "parallax", "blendMode", "overlayColor", "overlayOpacity"]],
    ["layout", "Layout & position", ["position", "stickyOffset", "readingOrder", "mobileColSpan", "shapeMask"]],
    ["motion", "Motion", ["animation", "animationDelay", "customKeyframes", "hoverEffect"]],
    ["visibility", "Visibility", ["visibility", "urlRule", "urlParam", "visibleFrom", "visibleUntil", "hidden"]],
    ["advanced", "Advanced", ["customCss"]],
  ];
  const openStyleGroups = new Set(["text"]);
  function styleValueIsSet(v) {
    if (v === null || v === undefined || v === "" || v === false) return false;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return true;
  }
  function styleGroupsHtml(style, idPrefix) {
    const grouped = new Set(STYLE_GROUPS.flatMap(([, , keys]) => keys));
    const leftovers = STYLE_FIELDS.filter((f) => !grouped.has(f.key)).map((f) => f.key);
    return STYLE_GROUPS.map(([id, title, keys]) => {
      const fields = (id === "advanced" ? [...keys, ...leftovers] : keys).map((k) => STYLE_FIELDS.find((f) => f.key === k)).filter(Boolean);
      if (!fields.length) return "";
      const setCount = style ? fields.filter((f) => styleValueIsSet(style[f.key])).length : 0;
      return `<details class="panel-section style-group" data-group="${id}"${openStyleGroups.has(id) ? " open" : ""}><summary>${escapeHtml(title)}${
        setCount ? `<span class="style-group-count">${setCount} set</span>` : ""
      }</summary><div class="style-group-body">${fields.map((f) => fieldHtml(f, style ? style[f.key] : undefined, idPrefix)).join("")}${
        setCount && idPrefix !== "bulk"
          ? `<button type="button" class="style-group-reset" data-group="${id}" data-keys="${escapeHtml(fields.map((f) => f.key).join(","))}" title="Clear every setting in this group so the block goes back to the theme's defaults">Reset ${setCount} ${escapeHtml(title.toLowerCase())} setting${setCount === 1 ? "" : "s"} to default</button>`
          : ""
      }</div></details>`;
    }).join("");
  }
  function wireStyleGroupToggles(container) {
    container.querySelectorAll(".style-group").forEach((d) => {
      d.addEventListener("toggle", () => {
        if (d.open) openStyleGroups.add(d.dataset.group);
        else openStyleGroups.delete(d.dataset.group);
      });
    });
  }

  function fieldHtml(f, val, idPrefix) {
    if (f.type === "checkbox") {
      return `<label><input type="checkbox" data-key="${f.key}" ${val ? "checked" : ""}> ${f.label}</label>`;
    }
    if (f.type === "textarea") {
      return `<label>${f.label}<textarea data-key="${f.key}" rows="4"${f.noSpellcheck ? ' spellcheck="false"' : ""}>${escapeHtml(val || "")}</textarea></label>`;
    }
    if (f.type === "select") {
      const options = f.options
        .map(([optVal, optLabel]) => `<option value="${escapeHtml(optVal)}"${String(val ?? "") === String(optVal) ? " selected" : ""}>${escapeHtml(optLabel)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}"${f.numeric ? ' data-numeric="1"' : ""}>${options}</select></label>`;
    }
    if (f.type === "color") {
      // The bulk multi-select inspector always calls this with val
      // undefined by design ("no prefilled values" — different selected
      // blocks likely have different existing colors, see
      // renderBulkInspector()), which meant Clear could never appear
      // there at all: a <input type="color"> itself never has an empty
      // value, so val is the only signal this function normally has for
      // "there's something to clear." idPrefix === "bulk" is the one
      // reliable way to tell "this render legitimately has nothing to
      // show yet" apart from "there's truly nothing to clear" — bulk mode
      // always wants the button, since applyStyleToAll(key, null) already
      // works fine, it just had no button wired to reach it.
      // A color input can't be empty, so an unset field used to show a
      // black swatch that read as "this is black". is-unset styles it as
      // an empty swatch with a "Not set" note instead.
      return `<label class="color-field${val ? "" : " is-unset"}"><span class="color-field-label">${f.label}</span><span class="color-field-control"><input data-key="${f.key}" type="color" value="${escapeHtml(
        val || "#000000"
      )}">${val ? `<code class="color-field-value">${escapeHtml(val)}</code>` : idPrefix === "bulk" ? "" : '<span class="color-field-value">Not set</span>'}${
        val || idPrefix === "bulk" ? `<button type="button" class="clear-color" data-key="${f.key}">Clear</button>` : ""
      }</span></label>`;
    }
    if (f.type === "image-url") {
      const fieldId = `${idPrefix}-${f.key}`;
      return `<label>${f.label}<input id="${fieldId}" data-key="${f.key}" type="text" spellcheck="false" value="${escapeHtml(
        val ?? ""
      )}"><button type="button" class="upload-trigger" data-target="#${fieldId}">Upload image</button> <button type="button" class="browse-trigger" data-target="#${fieldId}">Browse…</button> <span class="image-url-source-badge" data-target="#${fieldId}" title="Whether this URL points at a file uploaded to this site's media library, or is hotlinked from somewhere else -- an external image can disappear or change without warning if the other site removes or replaces it."></span></label>`;
    }
    if (f.type === "gallery-urls") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : [])
        .map((img) => (typeof img === "string" ? img : `${img.url || ""}${img.alt ? ` | ${img.alt}` : ""}`))
        .join("\n");
      return `<label>${f.label} (one image per line: <code>URL</code> or <code>URL | alt text</code>)<textarea id="${fieldId}" data-key="${f.key}" data-gallery="1" rows="5">${escapeHtml(
        text
      )}</textarea><button type="button" class="upload-trigger" data-target="#${fieldId}" data-append="1">Add image (upload)</button> <button type="button" class="browse-trigger" data-target="#${fieldId}" data-append="1">Add from library…</button></label>`;
    }
    if (f.type === "link-list") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : []).map((it) => `${it.label || ""} | ${it.url || ""}`).join("\n");
      return `<label>${f.label}<textarea id="${fieldId}" data-key="${f.key}" data-linklist="1" rows="5">${escapeHtml(text)}</textarea></label>`;
    }
    if (f.type === "changelog-list") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : [])
        .map((it) => `${it.date || ""} | ${it.title || ""} | ${it.description || ""}`)
        .join("\n");
      return `<label>${f.label}<textarea id="${fieldId}" data-key="${f.key}" data-changelog="1" rows="6">${escapeHtml(text)}</textarea></label>`;
    }
    if (f.type === "accordion-list") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : []).map((it) => `${it.title || ""} | ${it.body || ""}`).join("\n");
      return `<label>${f.label}<textarea id="${fieldId}" data-key="${f.key}" data-accordionlist="1" rows="6">${escapeHtml(text)}</textarea></label>`;
    }
    if (f.type === "tabs-list") {
      const fieldId = `${idPrefix}-${f.key}`;
      const text = (Array.isArray(val) ? val : []).map((it) => `${it.label || ""} | ${it.body || ""}`).join("\n");
      return `<label>${f.label}<textarea id="${fieldId}" data-key="${f.key}" data-tabslist="1" rows="6">${escapeHtml(text)}</textarea></label>`;
    }
    if (f.type === "simulation-select") {
      const options = simulationOptions
        .map((s) => `<option value="${s.id}"${String(val ?? "") === String(s.id) ? " selected" : ""}>${escapeHtml(simulationOptionLabel(s))}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}" data-numeric="1"><option value="">— choose —</option>${
        options || "<option disabled>No simulations yet</option>"
      }</select> <button type="button" class="manage-simulations-btn">Manage simulations…</button></label>`;
    }
    if (f.type === "scan-select") {
      const options = scanOptions
        .map((s) => `<option value="${s.id}"${String(val ?? "") === String(s.id) ? " selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}" data-numeric="1"><option value="">— choose —</option>${
        options || "<option disabled>No scans yet</option>"
      }</select> <button type="button" class="manage-scans-btn">Manage scans…</button></label>`;
    }
    if (f.type === "song-select") {
      const options = songOptions
        .map((s) => `<option value="${s.id}"${String(val ?? "") === String(s.id) ? " selected" : ""}>${escapeHtml(s.name)}</option>`)
        .join("");
      return `<label>${f.label}<select data-key="${f.key}" data-numeric="1"><option value="">— choose —</option>${
        options || "<option disabled>No songs yet</option>"
      }</select> <button type="button" class="manage-songs-btn">Manage songs…</button></label>`;
    }
    if (f.type === "keyframe-editor") {
      const stops = Array.isArray(val) ? val.length : 0;
      return `<label>${f.label}<br><button type="button" class="edit-keyframes-btn" data-key="${f.key}">${
        stops ? `Edit (${stops} keyframes)…` : "Create custom animation…"
      }</button></label>`;
    }
    if (f.type === "datetime-local") {
      return `<label>${f.label}<input id="${idPrefix}-${f.key}" data-key="${f.key}" data-datetime="1" type="datetime-local" value="${escapeHtml(
        isoToLocalInput(val)
      )}"></label>`;
    }
    return `<label>${f.label}<input id="${idPrefix}-${f.key}" data-key="${f.key}" type="${f.type}" value="${escapeHtml(val ?? "")}"></label>`;
  }

  function fieldValue(input) {
    if (input.type === "checkbox") return input.checked;
    if (input.dataset.datetime) return input.value === "" ? null : new Date(input.value).toISOString();
    if (input.type === "number") return input.value === "" ? null : Number(input.value);
    if (input.dataset.numeric) return input.value === "" ? null : Number(input.value);
    if (input.dataset.gallery) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const idx = line.indexOf("|");
          if (idx === -1) return { url: line, alt: "" };
          return { url: line.slice(0, idx).trim(), alt: line.slice(idx + 1).trim() };
        });
    }
    if (input.dataset.linklist) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, url] = line.split("|").map((s) => s.trim());
          return { label: label || url || "", url: url || label || "" };
        });
    }
    if (input.dataset.changelog) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [date, title, description] = line.split("|").map((s) => (s || "").trim());
          return { date: date || "", title: title || "", description: description || "" };
        });
    }
    if (input.dataset.accordionlist) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [title, body] = line.split("|").map((s) => (s || "").trim());
          return { title: title || "", body: body || "" };
        });
    }
    if (input.dataset.tabslist) {
      return input.value
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean)
        .map((line) => {
          const [label, body] = line.split("|").map((s) => (s || "").trim());
          return { label: label || "", body: body || "" };
        });
    }
    return input.value;
  }

  function renderInspector() {
    renderInspectorInner();
    repositionBlocks();
  }

  function renderInspectorInner() {
    const inspector = el("inspector");
    if (multiSelectedIds.size > 0) {
      inspector.hidden = false;
      if (isMobile()) openDrawer(inspector);
      el("single-block-inspector").hidden = true;
      el("bulk-inspector").hidden = false;
      renderBulkInspector();
      return;
    }
    el("single-block-inspector").hidden = false;
    el("bulk-inspector").hidden = true;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) {
      inspector.hidden = true;
      inspector.classList.remove("drawer-open");
      return;
    }
    inspector.hidden = false;
    if (isMobile()) openDrawer(inspector);
    el("block-save-status").textContent = "";

    if (!block.style) block.style = {};

    updateLockButton("lock-block-btn", !!block.locked);
    el("isolate-block-btn").classList.toggle("is-active", isolationMode);

    const banner = el("shared-block-banner");
    const saveAsSharedBtn = el("save-as-shared-block-btn");
    if (block.shared_block_id) {
      banner.hidden = false;
      banner.innerHTML = `<p class="shared-block-notice">Reusable block: <strong>${escapeHtml(
        block.shared_block_name || "Untitled"
      )}</strong> — editing it updates every page that uses it.</p><button type="button" id="detach-shared-block-btn">Detach (make independent)</button>`;
      el("detach-shared-block-btn").addEventListener("click", async () => {
        if (!confirm("Detach this block? It'll become an independent copy and stop updating when the reusable block changes.")) return;
        try {
          await api(`/blocks/${block.id}/detach`, { method: "POST" });
          await loadBlocks();
          selectedBlockId = block.id;
          renderCanvas();
          renderInspector();
        } catch (err) {
          alert(err.message);
        }
      });
      saveAsSharedBtn.hidden = true;
    } else {
      banner.hidden = true;
      banner.innerHTML = "";
      saveAsSharedBtn.hidden = false;
    }

    const fields = FIELD_DEFS[block.type] || [];
    const container = el("inspector-fields");
    container.innerHTML =
      fields.map((f) => fieldHtml(f, block.content[f.key], `field-${block.id}`)).join("") ||
      "<p style='color:var(--text-dim);font-size:0.85rem;'>No settings for this block.</p>";

    // populateStylePresetSelect() is NOT called here on purpose — rebuilding
    // a <select>'s options resets its current value as a side effect, which
    // would undo this same guard. It only needs to run once at boot and
    // again after a save/delete actually changes the preset list; applying
    // a preset re-renders the inspector for the *same* block afterward, and
    // resetting the value there too would make it impossible to
    // immediately follow up with "Delete" on the preset just applied.
    if (lastInspectedBlockId !== block.id) el("apply-style-preset-select").value = "";
    lastInspectedBlockId = block.id;

    const styleContainer = el("inspector-style-fields");
    styleContainer.innerHTML = styleGroupsHtml(block.style, `style-${block.id}`);
    wireStyleGroupToggles(styleContainer);

    container.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
    container.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
    container.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);
    container.querySelectorAll(".manage-simulations-btn").forEach((btn) => {
      btn.addEventListener("click", () => el("simulations-btn").click());
    });
    container.querySelectorAll(".manage-scans-btn").forEach((btn) => {
      btn.addEventListener("click", () => el("scans-btn").click());
    });
    container.querySelectorAll(".manage-songs-btn").forEach((btn) => {
      btn.addEventListener("click", () => el("songs-btn").click());
    });

    function save(opts) {
      saveBlockStyleAndContent(block, opts);
    }

    // :not(button) excludes .edit-keyframes-btn (and any future button-type
    // field control) -- a critic pass found that a synthetic "change" event
    // dispatched at a button (never fired by real mouse/keyboard use, but
    // reachable via a dispatchEvent call, a future refactor, or some
    // assistive-tech synthesis) would otherwise hit fieldValue()'s generic
    // fallback (a button's own .value, which is "") and silently overwrite
    // that field with `"" || null` -- for customKeyframes specifically,
    // silently wiping a saved animation with no confirmation or error.
    container.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      input.addEventListener("change", () => {
        block.content[input.dataset.key] = fieldValue(input);
        save();
      });
    });

    styleContainer.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      input.addEventListener("change", () => {
        block.style[input.dataset.key] = fieldValue(input) || null;
        save();
        renderInspector();
      });
    });

    styleContainer.querySelectorAll(".clear-color").forEach((btn) => {
      btn.addEventListener("click", () => {
        block.style[btn.dataset.key] = null;
        save();
        renderInspector();
      });
    });

    // One click puts a whole group back to the inherited/default look (the page
    // history keeps the earlier version if it was a mistake).
    styleContainer.querySelectorAll(".style-group-reset").forEach((btn) => {
      btn.addEventListener("click", () => {
        const groupId = btn.dataset.group;
        const keys = btn.dataset.keys.split(",").filter((k) => styleValueIsSet(block.style[k]));
        // The count matches the button; the timing fields behind custom animations
        // aren't shown as fields, so they go with Motion without being counted.
        const shownCount = keys.length;
        if (groupId === "motion") ["animationDuration", "animationEasing"].forEach((k) => styleValueIsSet(block.style[k]) && keys.push(k));
        if (!keys.length) return;
        const title = (STYLE_GROUPS.find(([id]) => id === groupId) || [, groupId])[1];
        const warnings = [];
        if (groupId === "visibility" && (block.style.hidden || block.style.urlRule || block.style.visibleFrom || block.style.visibleUntil)) {
          warnings.push("This can make a hidden, scheduled or address-limited block visible on the live site.");
        }
        if (block.shared_block_id) warnings.push("This is a reusable block, so the change applies on every page that uses it, and page history can't restore it.");
        if (!confirm(`Reset ${shownCount} ${title.toLowerCase()} setting${shownCount === 1 ? "" : "s"} to ${shownCount === 1 ? "its default" : "their defaults"}?${warnings.length ? "\n\n" + warnings.join("\n") : ""}`)) return;
        keys.forEach((k) => (block.style[k] = null));
        save({ forceSnapshot: true }); // the page's history keeps the version before the reset
        renderInspector();
        const summary = document.querySelector(`.style-group[data-group="${groupId}"] > summary`);
        if (summary) summary.focus();
      });
    });

    styleContainer.querySelectorAll(".edit-keyframes-btn").forEach((btn) => {
      btn.addEventListener("click", () =>
        openKeyframeEditor(block, () => {
          save();
          renderInspector();
        })
      );
    });
  }

  // Shared by renderInspector()'s own save() closure and the style-preset
  // handlers below (which act on whatever block is selected at click time,
  // outside any single renderInspector() call, so they can't reuse its
  // local closure directly).
  function saveBlockStyleAndContent(block, opts = {}) {
    renderCanvas();
    unsavedDirty = true;
    el("block-save-status").textContent = "Saving…";
    return api(`/blocks/${block.id}`, {
      method: "PATCH",
      body: JSON.stringify({ content: block.content, style: block.style, ...(opts.forceSnapshot ? { force_snapshot: true } : {}) }),
    })
      .then(() => {
        unsavedDirty = false;
        el("block-save-status").textContent = "Saved " + new Date().toLocaleTimeString();
        schedulePreviewRefresh();
      })
      .catch((err) => {
        el("block-save-status").textContent = "Save failed: " + err.message;
        alert(err.message);
      });
  }

  // These three are wired once (not inside renderInspector, which re-runs
  // on every selection change and would otherwise stack duplicate
  // listeners on these static buttons) — each looks up whichever block is
  // currently selected at click time.
  // A preset's saved color pair gets stamped onto every block it's applied
  // to in one click — exactly where a bad pairing does the most damage,
  // since it's now duplicated across however many blocks use it rather
  // than sitting on one page waiting to be noticed in Diagnostics. Site
  // Settings already has a live inline contrast checker for the theme's
  // own colors (updateThemeContrastCheck() below); this reuses the same
  // contrastRatio() math at the two moments a preset's colors actually
  // take effect — saving one, and applying one — instead of only ever
  // catching it after the fact.
  function warnIfBadContrast(style, blockType) {
    const color = style && style.color;
    const bg = style && style.bg;
    if (!color || !bg || !/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(bg)) return;
    const ratio = contrastRatio(color, bg);
    // Same relaxed 3:1 threshold for headings used everywhere else this
    // check runs (checkAccessibility(), sharedBlockIssues(), the per-page
    // Diagnostics check) — this one was left hardcoded at 4.5 and false-
    // positived on legitimately WCAG-compliant heading colors.
    const threshold = blockType === "heading" ? 3 : 4.5;
    if (ratio < threshold) {
      alert(`Heads up: this style's text/background colors have a contrast ratio of ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${threshold}:1 — text using it may be hard to read.`);
    }
  }
  el("apply-style-preset-select").addEventListener("change", () => {
    const select = el("apply-style-preset-select");
    const id = Number(select.value);
    if (!id) return;
    const preset = stylePresets.find((p) => p.id === id);
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!preset || !block) return;
    if (!block.style) block.style = {};
    Object.assign(block.style, preset.style);
    saveBlockStyleAndContent(block);
    renderInspector();
    warnIfBadContrast(block.style, block.type);
  });
  el("save-style-preset-btn").addEventListener("click", async () => {
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    const name = prompt("Preset name:");
    if (!name) return;
    try {
      await api("/style-presets", { method: "POST", body: JSON.stringify({ name, style: block.style || {} }) });
      await loadStylePresets();
      populateStylePresetSelect();
      warnIfBadContrast(block.style, block.type);
    } catch (err) {
      alert(err.message);
    }
  });
  el("delete-style-preset-btn").addEventListener("click", async () => {
    const id = Number(el("apply-style-preset-select").value);
    if (!id) return alert("Select a preset to delete first.");
    const preset = stylePresets.find((p) => p.id === id);
    if (!confirm(`Delete preset "${preset ? preset.name : id}"?`)) return;
    try {
      await api(`/style-presets/${id}`, { method: "DELETE" });
      await loadStylePresets();
      populateStylePresetSelect();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Multi-select bulk inspector ----------
  function selectedBlocksList() {
    return blocks.filter((b) => multiSelectedIds.has(b.id));
  }

  // Align/distribute reposition blocks the same way dragging does, so a
  // locked block is excluded here too — style/content changes and
  // duplication aren't repositioning, so those still apply to everything.
  function movableSelectedBlocksList() {
    return selectedBlocksList().filter((b) => !isLayoutLocked(b));
  }

  function renderBulkInspector() {
    const selected = selectedBlocksList();
    el("bulk-inspector-count").textContent = `${selected.length} block${selected.length === 1 ? "" : "s"} selected`;

    const container = el("bulk-style-fields");
    // No prefilled values — different selected blocks likely have
    // different existing styles, so this is purely "set this on all of
    // them", not "here's what they currently share".
    container.innerHTML = styleGroupsHtml(null, "bulk");
    wireStyleGroupToggles(container);
    container.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
    container.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
    container.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);

    async function applyStyleToAll(key, value) {
      const targets = selectedBlocksList();
      for (const b of targets) {
        if (!b.style) b.style = {};
        b.style[key] = value;
        await api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ style: b.style }) }).catch((err) => alert(err.message));
      }
      renderCanvas();
      schedulePreviewRefresh();
    }

    // :not(button) -- same footgun as the single-block inspector's query
    // (see the comment there): a synthetic "change" event at
    // .edit-keyframes-btn would otherwise hit fieldValue()'s generic
    // fallback and silently wipe customKeyframes via applyStyleToAll,
    // across EVERY selected block at once here. A round-2 critic pass
    // caught this as an unpatched sibling of the single-block fix -- both
    // generic [data-key] queries share the same STYLE_FIELDS array and
    // needed the same exclusion, not just one of the two call sites.
    container.querySelectorAll("[data-key]:not(button)").forEach((input) => {
      input.addEventListener("change", () => applyStyleToAll(input.dataset.key, fieldValue(input) || null));
    });
    container.querySelectorAll(".clear-color").forEach((btn) => {
      btn.addEventListener("click", async () => {
        await applyStyleToAll(btn.dataset.key, null);
        renderBulkInspector();
      });
    });
  }

  async function patchBlockPosition(b) {
    await api(`/blocks/${b.id}`, { method: "PATCH", body: JSON.stringify({ col: b.col, row: b.row }) }).catch((err) => alert(err.message));
    schedulePreviewRefresh();
  }

  el("bulk-align-left").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList();
    if (selected.length < 2) return;
    const minCol = Math.min(...selected.map((b) => b.col));
    for (const b of selected) {
      b.col = minCol;
      await patchBlockPosition(b);
    }
    renderCanvas();
  });

  el("bulk-align-center").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList();
    if (selected.length < 2) return;
    const minCol = Math.min(...selected.map((b) => b.col));
    const maxRight = Math.max(...selected.map((b) => b.col + b.col_span));
    const center = (minCol + maxRight) / 2;
    for (const b of selected) {
      b.col = Math.min(Math.max(1, Math.round(center - b.col_span / 2)), COLS - b.col_span + 1);
      await patchBlockPosition(b);
    }
    renderCanvas();
  });

  el("bulk-align-right").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList();
    if (selected.length < 2) return;
    const maxRight = Math.max(...selected.map((b) => b.col + b.col_span));
    for (const b of selected) {
      b.col = Math.min(Math.max(1, maxRight - b.col_span), COLS - b.col_span + 1);
      await patchBlockPosition(b);
    }
    renderCanvas();
  });

  // Standard design-tool "distribute": the first and last (by current row)
  // stay put, the ones between get an equal gap computed from the total
  // span minus everyone's own height — needs 3+ to mean anything.
  el("bulk-distribute-vertical").addEventListener("click", async () => {
    const selected = movableSelectedBlocksList().sort((a, b) => a.row - b.row);
    if (selected.length < 3) return alert("Select at least 3 blocks to distribute evenly.");
    const first = selected[0];
    const last = selected[selected.length - 1];
    const totalSpan = last.row + last.row_span - first.row;
    const totalBlockSpan = selected.reduce((sum, b) => sum + b.row_span, 0);
    const gap = Math.max(0, Math.round((totalSpan - totalBlockSpan) / (selected.length - 1)));
    let row = first.row;
    for (const b of selected) {
      b.row = row;
      await patchBlockPosition(b);
      row += b.row_span + gap;
    }
    renderCanvas();
  });

  el("bulk-duplicate-btn").addEventListener("click", async () => {
    const selected = selectedBlocksList();
    if (!selected.length || !currentPage) return;
    // The whole selection is placed as a group below everything else,
    // keeping each block's column and its position relative to the others
    // — same idea as single-block duplicate, just for a group at once.
    const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    const minSelectedRow = Math.min(...selected.map((b) => b.row));
    const newIds = [];
    // Copies of grouped blocks form their own new group instead of joining the original one.
    const groupRemap = new Map();
    for (const b of selected) {
      const g = groupOf(b);
      const style = styleWithoutGroup(b.style);
      if (g) {
        if (!groupRemap.has(g)) groupRemap.set(g, newGroupId());
        style.group = groupRemap.get(g);
      }
      const res = await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: b.type,
          content: b.content,
          style,
          col: b.col,
          col_span: b.col_span,
          row: maxRow + (b.row - minSelectedRow),
          row_span: b.row_span,
        }),
      });
      newIds.push(res.id);
    }
    await loadBlocks();
    multiSelectedIds = new Set(newIds);
    renderCanvas();
    renderInspector();
  });

  el("bulk-delete-btn").addEventListener("click", async () => {
    const all = selectedBlocksList();
    if (!all.length) return;
    // A locked block is protected from this kind of sweep, same as bulk
    // article actions — the single-block Delete button (a deliberate,
    // one-target action) is the one place a locked block still deletes.
    const locked = all.filter((b) => isLayoutLocked(b));
    const selected = all.filter((b) => !isLayoutLocked(b));
    if (!selected.length) return alert("All selected blocks are locked.");
    if (!confirm(`Delete ${selected.length} block(s)?${locked.length ? ` (${locked.length} locked block(s) will be skipped.)` : ""}`)) return;
    for (const b of selected) {
      await api(`/blocks/${b.id}`, { method: "DELETE" });
    }
    multiSelectedIds.clear();
    await loadBlocks();
    showUndoToast(`${selected.length} block(s) deleted.`, async () => {
      for (const b of selected) {
        await api(`/pages/${currentPage.id}/blocks`, {
          method: "POST",
          body: JSON.stringify({ type: b.type, content: b.content, style: b.style, col: b.col, col_span: b.col_span, row: b.row, row_span: b.row_span }),
        });
      }
      await loadBlocks();
    });
  });

  el("save-as-shared-block-btn").addEventListener("click", async () => {
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    const name = prompt("Name this reusable block:");
    if (!name || !name.trim()) return;
    try {
      const res = await api("/shared-blocks", {
        method: "POST",
        body: JSON.stringify({ name: name.trim(), type: block.type, content: block.content, style: block.style }),
      });
      await api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ shared_block_id: res.id }) });
      await loadBlocks();
      selectedBlockId = block.id;
      renderCanvas();
      renderInspector();
    } catch (err) {
      alert(err.message);
    }
  });

  el("copy-block-btn").addEventListener("click", () => {
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    try {
      localStorage.setItem(
        BLOCK_CLIPBOARD_KEY,
        JSON.stringify({ type: block.type, content: block.content, style: block.style, col_span: block.col_span, row_span: block.row_span })
      );
    } catch {}
    updatePasteButtonVisibility();
  });

  // ---------- Reusable blocks library ----------
  // A handful of the same checks computePageDiagnostics() runs per page,
  // applied directly to a shared block's own stored content/style — a
  // problem here (bad contrast, empty content, a broken simulation/scan/
  // song reference) shows up as a separate, duplicate Diagnostics finding
  // on every single page that uses it, so the admin only ever discovers it
  // one page at a time instead of once at the shared source. Deliberately
  // a smaller subset than the full per-page check (no H1/heading-order
  // checks, which are page-level concerns a lone block can't have an
  // opinion on) — just the checks that are genuinely about this block's
  // own content being usable wherever it's inserted.
  function sharedBlockIssues(sb) {
    const issues = [];
    const c = sb.content || {};
    if (sb.type === "heading" && !c.text) issues.push("Empty heading");
    if (sb.type === "text" && !c.text) issues.push("Empty text");
    if (sb.type === "quote" && !c.text) issues.push("Empty quote");
    if (sb.type === "image" && !c.url) issues.push("No image set");
    else if (sb.type === "image" && c.url && !c.alt) issues.push("Missing alt text");
    if (sb.type === "button" && !c.url) issues.push("No link URL");
    if (brokenReferenceLookup(sb)) issues.push("References a deleted item");
    const color = sb.style && sb.style.color;
    const bg = sb.style && sb.style.bg;
    if (color && bg && /^#[0-9a-f]{6}$/i.test(color) && /^#[0-9a-f]{6}$/i.test(bg)) {
      const ratio = contrastRatio(color, bg);
      const threshold = sb.type === "heading" ? 3 : 4.5;
      if (ratio < threshold) issues.push(`Low contrast (${ratio.toFixed(2)}:1)`);
    }
    return issues;
  }
  async function loadSharedBlocksList() {
    const sharedBlocks = await api("/shared-blocks");
    el("shared-blocks-list").innerHTML =
      sharedBlocks
        .map((sb) => {
          const issues = sharedBlockIssues(sb);
          // title="" tooltips never fire on a touch screen, so the issue
          // list would be readable on desktop (hover) but invisible on
          // mobile (the exact place this session already found the badge
          // itself was clipped away entirely) — a click/tap handler below
          // shows the same text as an alert, which works on both.
          const issuesBadge = issues.length
            ? ` <span class="lock-badge diagnostic-error shared-block-issues-badge" data-issues="${escapeHtml(
                issues.join("; ")
              )}" title="Tap for details: ${escapeHtml(issues.join("; "))}">${issues.length} issue${issues.length === 1 ? "" : "s"}</span>`
            : "";
          return `<div class="simulation-row"><span>${escapeHtml(sb.name)} <span class="lock-badge">${escapeHtml(
            blockLabel(sb.type)
          )}</span>${issuesBadge}</span><button type="button" class="usage-shared-block" data-id="${sb.id}" data-name="${escapeHtml(
            sb.name
          )}" data-issues="${escapeHtml(issues.join("; "))}" title="See which pages use this reusable block">Usage</button><button type="button" class="insert-shared-block" data-id="${
            sb.id
          }"${currentPage ? "" : " disabled title=\"Open a page first\""}>Insert onto current page</button><button type="button" class="delete-shared-block" data-id="${
            sb.id
          }">Delete</button></div>`;
        })
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No reusable blocks yet — select a block on a page and use \"Save as reusable block…\" in its settings.</p>";

    if (window.bulkList) {
      window.bulkList({
        listId: "shared-blocks-list",
        type: "shared-block",
        noun: "reusable block",
        rowIdSelector: ".delete-shared-block",
        duplicate: null,
        remove: (id) => api(`/shared-blocks/${id}`, { method: "DELETE" }),
        reload: loadSharedBlocksList,
        usageUrl: (id) => `/shared-blocks/usage?id=${id}`,
        inUseNote: "those placements become empty blocks",
      });
    }

    el("shared-blocks-list")
      .querySelectorAll(".shared-block-issues-badge")
      .forEach((badge) => badge.addEventListener("click", () => alert(`Issues with this reusable block:\n\n${badge.dataset.issues}`)));

    el("shared-blocks-list")
      .querySelectorAll(".usage-shared-block")
      .forEach((btn) => {
        const extraInfo = btn.dataset.issues ? `⚠ ${btn.dataset.issues}` : "";
        btn.addEventListener("click", () => window.showContentUsage("shared-block", btn.dataset.id, btn.dataset.name, extraInfo));
      });

    el("shared-blocks-list")
      .querySelectorAll(".insert-shared-block")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!currentPage) return;
          const sb = sharedBlocks.find((x) => x.id === Number(btn.dataset.id));
          const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
          try {
            await api(`/pages/${currentPage.id}/blocks`, {
              method: "POST",
              body: JSON.stringify({ type: sb.type, shared_block_id: sb.id, col: 1, col_span: 24, row: maxRow, row_span: 8 }),
            });
            await loadBlocks();
            el("shared-blocks-modal").hidden = true;
          } catch (err) {
            alert(err.message);
          }
        });
      });

    el("shared-blocks-list")
      .querySelectorAll(".delete-shared-block")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const id = Number(btn.dataset.id);
          const usage = await api(`/shared-blocks/usage?id=${id}`).catch(() => []);
          const msg = usage.length
            ? `Used on: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those placements become empty blocks.`
            : "Delete this reusable block? This can't be undone.";
          if (!confirm(msg)) return;
          await api(`/shared-blocks/${id}`, { method: "DELETE" });
          await loadSharedBlocksList();
        });
      });
  }

  el("shared-blocks-btn").addEventListener("click", async () => {
    el("shared-blocks-modal").hidden = false;
    await loadSharedBlocksList();
  });
  closeModalOnClick("close-shared-blocks", "shared-blocks-modal");

  // ---------- Layers panel (outline of every block on the current page) ----------
  function renderLayersList() {
    const container = el("layers-list");
    if (!currentPage) {
      container.innerHTML = "<p style='color:var(--text-dim);font-size:0.85rem;'>Open a page first.</p>";
      return;
    }
    if (!blocks.length) {
      container.innerHTML = "<p style='color:var(--text-dim);font-size:0.85rem;'>This page has no blocks yet.</p>";
      return;
    }
    container.innerHTML = blocks
      .map(
        (b) =>
          `<div class="simulation-row layer-row${b.id === selectedBlockId ? " layer-row-active" : ""}"><span>${blockLabel(
            b.type
          )}${blockBadgesHtml(b)} — <span class="layer-preview">${blockPreview(b)}</span></span><button type="button" class="layer-select-btn" data-id="${
            b.id
          }">Select</button><button type="button" class="layer-hide-btn" data-id="${b.id}">${
            b.style && b.style.hidden ? "Show" : "Hide"
          }</button><button type="button" class="layer-lock-btn" data-id="${b.id}">${b.locked ? "Unlock" : "Lock"}</button></div>`
      )
      .join("");

    container.querySelectorAll(".layer-select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        goToBlock(currentPage.id, Number(btn.dataset.id));
        el("layers-modal").hidden = true;
      });
    });
    container.querySelectorAll(".layer-hide-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const b = blocks.find((x) => x.id === id);
        if (!b) return;
        const style = { ...(b.style || {}), hidden: !(b.style && b.style.hidden) };
        try {
          await api(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify({ style }) });
          b.style = style;
          renderCanvas();
        } catch (err) {
          alert(err.message);
        }
      });
    });
    container.querySelectorAll(".layer-lock-btn").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = Number(btn.dataset.id);
        const b = blocks.find((x) => x.id === id);
        if (!b) return;
        try {
          await api(`/blocks/${id}`, { method: "PATCH", body: JSON.stringify({ locked: !b.locked }) });
          b.locked = !b.locked;
          renderCanvas();
        } catch (err) {
          alert(err.message);
        }
      });
    });
  }

  el("layers-btn").addEventListener("click", () => {
    el("layers-modal").hidden = false;
    renderLayersList();
  });
  closeModalOnClick("close-layers", "layers-modal");

  // ---------- Layout diagnostics ----------
  // Mirrors headingLevel() in worker/render.js exactly — a heading block
  // with no stored level (or an invalid one) actually renders as an H1,
  // so this check has to apply the same fallback rather than treating
  // "no explicit level" as "not an H1" (which used to make a page with
  // a real, rendered H1 falsely report "No H1 heading", and made two
  // such headings falsely report "No H1" instead of "2 H1 headings
  // found").
  function effectiveHeadingLevel(content) {
    const lvl = Number(content && content.level);
    return Number.isInteger(lvl) && lvl >= 1 && lvl <= 6 ? lvl : 1;
  }
  function computePageDiagnostics() {
    const issues = [];
    const visibleBlocks = blocks.filter((b) => !(b.style && b.style.hidden));
    const h1Blocks = visibleBlocks.filter((b) => b.type === "heading" && effectiveHeadingLevel(b.content) === 1);
    if (!h1Blocks.length) {
      issues.push({ severity: "warn", message: "No H1 heading on this page — search engines and screen readers rely on it to understand the page's main topic.", blockId: null });
    } else if (h1Blocks.length > 1) {
      issues.push({ severity: "warn", message: `${h1Blocks.length} H1 headings found — a page should generally have exactly one.`, blockId: h1Blocks[1].id });
    }
    // Reading order (top-to-bottom, left-to-right) is what a screen reader
    // actually walks, not creation order — so this has to re-sort rather
    // than trust the blocks array's order.
    const headingBlocksInOrder = visibleBlocks
      .filter((b) => b.type === "heading" && b.content && b.content.text)
      .sort((a, b) => a.row - b.row || a.col - b.col);
    let prevLevel = 0;
    for (const b of headingBlocksInOrder) {
      const level = effectiveHeadingLevel(b.content);
      if (prevLevel && level > prevLevel + 1) {
        issues.push({
          severity: "warn",
          message: `Heading level skips from H${prevLevel} to H${level} — screen reader users lose the outline structure. Use H${prevLevel + 1} instead.`,
          blockId: b.id,
        });
      }
      prevLevel = level;
    }
    for (const b of visibleBlocks) {
      const c = b.content || {};
      if (b.type === "heading" && !c.text) issues.push({ severity: "error", message: "Empty heading block", blockId: b.id });
      if (b.type === "text" && !c.text) issues.push({ severity: "error", message: "Empty text block", blockId: b.id });
      if (b.type === "quote" && !c.text) issues.push({ severity: "error", message: "Empty quote block", blockId: b.id });
      if (b.type === "image" && !c.url) issues.push({ severity: "error", message: "Image block has no image set", blockId: b.id });
      else if (b.type === "image" && c.url && !c.alt) issues.push({ severity: "warn", message: "Image is missing alt text", blockId: b.id });
      if (b.type === "button" && !c.url) issues.push({ severity: "error", message: "Button block has no link URL", blockId: b.id });
      if (b.type === "video" && !c.url) issues.push({ severity: "error", message: "Video block has no URL set", blockId: b.id });
      if (b.type === "embed" && !c.url) issues.push({ severity: "error", message: "Embed block has no URL set", blockId: b.id });
      if (b.type === "project-card" && !c.title) issues.push({ severity: "error", message: "Project card has no title", blockId: b.id });
      if (b.type === "before-after" && (!c.beforeUrl || !c.afterUrl)) issues.push({ severity: "error", message: "Before/After block is missing one of its images", blockId: b.id });
      if (brokenReferenceLookup(b)) {
        issues.push({
          severity: "error",
          message: `${blockLabel(b.type)} block references an unavailable item — it is omitted from public pages until fixed`,
          blockId: b.id,
        });
      }
    }
    // Motion budget: nav.js's IntersectionObserver already staggers
    // simultaneous entrance animations so they don't all fire in one
    // instant, but that's a band-aid for *fast scrolling*, not for a page
    // that's just genuinely saturated with motion — a visitor who scrolls
    // slowly on a page with parallax on most of its blocks still gets
    // "everything is moving" the whole way down. No hard rule for what's
    // too much, so this flags the page rather than any one block — an
    // admin who wanted every block to move presumably knows that; this is
    // for the page nobody looked at as a whole after building it block by block.
    const parallaxCount = visibleBlocks.filter((b) => b.style && b.style.parallax).length;
    if (parallaxCount > 3) {
      issues.push({
        severity: "warn",
        message: `${parallaxCount} blocks on this page have parallax enabled — likely to feel busy rather than "restrained." Consider reserving it for one or two focal blocks.`,
        blockId: null,
      });
    }
    const animatedCount = visibleBlocks.filter((b) => b.style && b.style.animation).length;
    if (animatedCount > 8) {
      issues.push({
        severity: "warn",
        message: `${animatedCount} blocks on this page have an entrance animation — a long scroll of constant reveals can read as noisy rather than "considered" motion.`,
        blockId: null,
      });
    }
    // A custom text/background color pair is a per-block override the site
    // theme's own contrast checker (below, for the global theme colors)
    // never sees — nothing previously caught a block shipping unreadable
    // text just because both colors happened to be set at the same time.
    // contrastRatio()/relLuminance() are defined further down in this file
    // (function declarations are hoisted within this IIFE) — same formula
    // already used to check the theme's own colors, just applied per-block.
    for (const b of visibleBlocks) {
      const color = b.style && b.style.color;
      const bg = b.style && b.style.bg;
      if (!color || !bg || !/^#[0-9a-f]{6}$/i.test(color) || !/^#[0-9a-f]{6}$/i.test(bg)) continue;
      const ratio = contrastRatio(color, bg);
      // WCAG AA allows a relaxed 3:1 for large text — headings are the
      // block type most likely to actually be large enough to qualify
      // (matches the theme checker's own 3:1 "Accent vs background" bar),
      // so they get that lower threshold instead of flagging pairs that
      // are technically compliant.
      const threshold = b.type === "heading" ? 3 : 4.5;
      if (ratio < threshold) {
        issues.push({
          severity: "warn",
          message: `This block's custom text/background colors have a contrast ratio of ${ratio.toFixed(2)}:1, below the WCAG AA minimum of ${threshold}:1 — likely hard to read.`,
          blockId: b.id,
        });
      }
    }
    return issues;
  }

  // Overlap can't happen at all (every drag/resize/create checks
  // wouldOverlap() before saving), so it's not worth checking for here —
  // but overflow and tap-target size depend on real CSS layout, which the
  // admin canvas's plain text preview doesn't reflect. A hidden iframe of
  // the actual public page gives real measurements to check against.
  function computeRenderedLayoutDiagnostics(path) {
    return new Promise((resolve) => {
      const frame = document.createElement("iframe");
      frame.style.cssText = "position:fixed;left:-9999px;top:0;width:1200px;height:2000px;border:0;";
      let settled = false;
      const finish = (issues) => {
        if (settled) return;
        settled = true;
        frame.remove();
        resolve(issues);
      };
      frame.addEventListener("load", () => {
        let doc;
        try {
          doc = frame.contentDocument;
        } catch (e) {
          return finish([]);
        }
        const issues = [];
        const MIN_TAP = 24; // WCAG 2.5.8 minimum target size
        // Every block wrapper now carries data-block-id (see renderBlocks()
        // in worker/render.js) — walking up to the nearest one lets these
        // real-layout findings jump straight to their source block instead
        // of just naming the problem with no "Select" button at all.
        const blockIdFor = (node) => {
          const wrapper = node.closest("[data-block-id]");
          return wrapper ? Number(wrapper.dataset.blockId) : null;
        };
        doc.querySelectorAll("a, button").forEach((node) => {
          const r = node.getBoundingClientRect();
          if (r.width > 0 && r.height > 0 && (r.width < MIN_TAP || r.height < MIN_TAP)) {
            const label = (node.textContent || "").trim().slice(0, 40) || node.tagName.toLowerCase();
            issues.push({
              severity: "warn",
              message: `Small tap target at desktop width (${Math.round(r.width)}×${Math.round(r.height)}px, ${MIN_TAP}×${MIN_TAP} minimum): "${label}"`,
              blockId: blockIdFor(node),
            });
          }
        });
        doc.querySelectorAll(".block").forEach((node) => {
          if (node.scrollHeight > node.clientHeight + 4 || node.scrollWidth > node.clientWidth + 4) {
            issues.push({
              severity: "warn",
              message: "A block's content overflows its box at desktop width — may be visually clipped",
              blockId: blockIdFor(node),
            });
          }
        });
        // Focus-visible check — previously left undone (see outline.md):
        // a static scan can't meaningfully evaluate computed :focus-visible
        // styles, but this iframe already renders the real page with real
        // CSS, so it can actually focus each element and diff its computed
        // style/geometry before and after, the same technique real
        // accessibility auditing tools use.
        //
        // A first version of this only diffed outline/box-shadow/border and
        // was caught by a critic pass producing both false positives (a
        // legitimate color- or background-only focus style, or a
        // reveal-on-focus technique like this site's own .skip-link, both
        // flagged as "broken" even though focusing them genuinely changes
        // something visible) and a false negative on exactly the defect
        // class this check exists to catch (an `opacity: 0` element still
        // registers an outline-style change on focus, so it passed clean
        // despite being permanently invisible). Reworked to check actual
        // visibility at each state instead of guessing from a fixed
        // property list:
        const nodeLabel = (node) => (node.textContent || node.getAttribute("aria-label") || node.getAttribute("placeholder") || "").trim().slice(0, 40) || node.tagName.toLowerCase();
        const isRenderedVisible = (style, rect) => style.visibility !== "hidden" && parseFloat(style.opacity) > 0 && rect.width > 0 && rect.height > 0;
        const styleSnapshot = (cs) => `${cs.outlineStyle}|${cs.outlineWidth}|${cs.boxShadow}|${cs.borderColor}|${cs.borderWidth}|${cs.color}|${cs.backgroundColor}`;
        doc.querySelectorAll("a[href], button, input, select, textarea").forEach((node) => {
          if (node.disabled) return; // can never receive focus in the first place — nothing to check
          const restingRect = node.getBoundingClientRect();
          if (restingRect.width <= 0 || restingRect.height <= 0) return;
          const restingStyle = doc.defaultView.getComputedStyle(node);
          const restingVisible = isRenderedVisible(restingStyle, restingRect);
          const outlineSuppressed = restingStyle.outlineStyle === "none" || restingStyle.outlineWidth === "0px";
          const restingSnapshot = styleSnapshot(restingStyle);

          node.focus();
          // visibility:hidden (and similar) makes .focus() a genuine no-op —
          // an element like that isn't reachable by keyboard at all, which
          // is a different question from "does it show a focus ring," so
          // it's out of scope for this specific check rather than worth a
          // guess at what to call it.
          if (doc.activeElement !== node) { node.blur(); return; }
          const focusedRect = node.getBoundingClientRect();
          const focusedStyle = doc.defaultView.getComputedStyle(node);
          const focusedVisible = isRenderedVisible(focusedStyle, focusedRect);
          const focusedSnapshot = styleSnapshot(focusedStyle);
          node.blur();

          if (!focusedVisible) {
            // Worse than "no focus ring": genuinely keyboard-reachable but
            // never visible at all, focused or not (opacity: 0 and the
            // like) — a keyboard user tabs here and sees literally nothing.
            issues.push({
              severity: "error",
              message: `Keyboard-focusable but always invisible: "${nodeLabel(node)}" — a keyboard user can tab to it but never see it`,
              blockId: blockIdFor(node),
            });
            return;
          }
          if (!restingVisible) return; // legit reveal-on-focus pattern (this site's own .skip-link does this) — fine, it's visible exactly when it needs to be
          if (!outlineSuppressed) return; // has its own default/native ring already — nothing to check

          const rectChanged =
            Math.abs(restingRect.left - focusedRect.left) > 1 ||
            Math.abs(restingRect.top - focusedRect.top) > 1 ||
            Math.abs(restingRect.width - focusedRect.width) > 1 ||
            Math.abs(restingRect.height - focusedRect.height) > 1;
          if (!rectChanged && restingSnapshot === focusedSnapshot) {
            issues.push({
              severity: "warn",
              message: `No visible focus indicator when tabbed to: "${nodeLabel(node)}" — a keyboard user can't tell it's selected`,
              blockId: blockIdFor(node),
            });
          }
        });
        // native `loading="lazy"` images never actually fetch inside this
        // off-screen iframe (it's nowhere near any viewport, so the
        // browser's own lazy-load heuristic just skips them forever) — so
        // checking img.naturalWidth here would silently miss almost every
        // real image on the page. Re-request each distinct src directly in
        // the parent document instead, which sidesteps lazy-loading
        // entirely and also naturally dedupes repeated images.
        // A src can appear in more than one block (the same image reused,
        // or several images inside one gallery) — probed once per distinct
        // src, but tracked back to every block that actually uses it so a
        // broken image still gets its own "Select" per affected block.
        const srcToBlockIds = new Map();
        doc.querySelectorAll("img").forEach((img) => {
          const src = img.getAttribute("src");
          if (!src) return;
          const id = blockIdFor(img);
          if (!srcToBlockIds.has(src)) srcToBlockIds.set(src, new Set());
          if (id !== null) srcToBlockIds.get(src).add(id);
        });
        const srcs = [...srcToBlockIds.keys()];
        Promise.all(
          srcs.map(
            (src) =>
              new Promise((res) => {
                const probe = new Image();
                probe.onload = () => res(null);
                probe.onerror = () => res(src);
                probe.src = new URL(src, location.origin).href;
                setTimeout(() => res(null), 4000); // don't let one slow/hanging image block the whole check
              })
          )
        ).then((results) => {
          results.filter(Boolean).forEach((src) => {
            const blockIds = [...srcToBlockIds.get(src)];
            if (!blockIds.length) {
              issues.push({ severity: "error", message: `Broken image (failed to load): ${src}`, blockId: null });
            } else {
              blockIds.forEach((blockId) => issues.push({ severity: "error", message: `Broken image (failed to load): ${src}`, blockId }));
            }
          });
          finish(issues);
        });
        return;
      });
      frame.addEventListener("error", () => finish([]));
      setTimeout(() => finish([]), 5000);
      frame.src = path;
      document.body.appendChild(frame);
    });
  }

  async function renderDiagnosticsList() {
    const container = el("diagnostics-list");
    if (!currentPage) {
      container.innerHTML = "<p style='color:var(--text-dim);font-size:0.85rem;'>Open a page first.</p>";
      return;
    }
    container.innerHTML = "<p style='color:var(--text-dim);font-size:0.85rem;'>Checking…</p>";
    const path = currentPage.slug === "home" ? "/" : `/${currentPage.slug}`;
    const issues = [...computePageDiagnostics(), ...(await computeRenderedLayoutDiagnostics(path))];
    if (!issues.length) {
      container.innerHTML = "<p style='color:var(--text-dim);font-size:0.85rem;'>No issues found on this page.</p>";
      return;
    }
    container.innerHTML = issues
      .map(
        (issue, i) =>
          `<div class="simulation-row"><span><span class="lock-badge${
            issue.severity === "error" ? " diagnostic-error" : ""
          }">${issue.severity === "error" ? "Issue" : "Warning"}</span> ${escapeHtml(issue.message)}</span>${
            issue.blockId ? `<button type="button" class="diagnostic-select-btn" data-index="${i}">Select</button>` : ""
          }</div>`
      )
      .join("");
    container.querySelectorAll(".diagnostic-select-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        const issue = issues[Number(btn.dataset.index)];
        goToBlock(currentPage.id, issue.blockId);
        el("diagnostics-modal").hidden = true;
      });
    });
  }

  el("diagnostics-btn").addEventListener("click", () => {
    el("diagnostics-modal").hidden = false;
    renderDiagnosticsList();
  });
  closeModalOnClick("close-diagnostics", "diagnostics-modal");

  // ---------- SEO Dashboard ----------
  // Consolidates what used to be scattered across the Site Settings modal
  // (Link Checker, SEO Report) plus a new sitemap-exclusions overview —
  // the Link Checker/SEO Report sections are the exact same markup/ids,
  // just relocated here, so their existing click handlers below work
  // unchanged regardless of which modal contains them.
  function renderSitemapExclusions() {
    const excluded = [
      ...pages.filter((p) => p.sitemap_exclude).map((p) => ({ title: p.title, url: p.slug === "home" ? "/" : `/${p.slug}`, type: "Page" })),
      ...articles.filter((a) => a.sitemap_exclude).map((a) => ({ title: a.title, url: `/random/${a.slug}`, type: "Article" })),
      ...projects.filter((p) => p.sitemap_exclude).map((p) => ({ title: p.title, url: `/projects/${p.slug}`, type: "Project" })),
    ];
    el("sitemap-exclusions-list").innerHTML =
      excluded
        .map(
          (e) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(e.title)}</span><span class="link-check-source">${escapeHtml(
              e.url
            )}</span><span class="link-check-status">${e.type}</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>Nothing currently excluded.</p>";
  }

  async function loadScheduledLinkCheckStatus() {
    const status = await api("/link-check-status");
    const statusEl = el("scheduled-link-check-status");
    if (!status.lastAt) {
      statusEl.innerHTML = "";
      return;
    }
    const when = escapeHtml(new Date(status.lastAt).toLocaleString());
    if (!status.broken.length) {
      statusEl.innerHTML = `<span class="contrast-pass">✓ Last automatic check ${when} — no broken links</span>`;
      return;
    }
    const rows = status.broken
      .map(
        (r) =>
          `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(r.url)}</span><span class="link-check-source">${escapeHtml(
            r.source
          )}</span><span class="link-check-status">${escapeHtml(r.status)}</span></div>`
      )
      .join("");
    statusEl.innerHTML = `<span class="contrast-fail">⚠ Last automatic check ${when} — ${status.broken.length} broken link(s) found</span>${rows}`;
  }

  // ---------- Dashboard ----------
  // One screen answering "what needs me?": health flags, recent edits, drafts and shortcuts.
  // Built from endpoints the other panels already use, so it adds no server code.
  function dashboardItemHtml(kind, row) {
    const when = row.updated_at || row.created_at || "";
    return `<li><button type="button" class="dash-item" data-kind="${kind}" data-id="${Number(row.id)}"><span class="dash-item-title">${escapeHtml(
      row.title || "(untitled)"
    )}</span><span class="dash-item-meta">${kind}${when ? " · " + escapeHtml(String(when).slice(0, 10)) : ""}</span></button></li>`;
  }
  async function openDashboard() {
    const body = el("dashboard-body");
    el("dashboard-modal").hidden = false;
    body.innerHTML = "<p class='command-empty'>Loading…</p>";
    const [arts, projs, notes, seo] = await Promise.allSettled([api("/articles"), api("/projects"), api("/notifications-summary"), api("/seo-report")]);
    const A = arts.status === "fulfilled" ? arts.value : [];
    const P = projs.status === "fulfilled" ? projs.value : [];
    // [text, panel button to open]; errors and webhooks live in Diagnostics, the rest in Site Health.
    const flags = [];
    const unavailable = [];
    if (arts.status !== "fulfilled") unavailable.push("articles");
    if (projs.status !== "fulfilled") unavailable.push("projects");
    if (notes.status === "fulfilled") {
      const n = notes.value;
      if (n.backupFailed) flags.push(["The last scheduled backup failed", "seo-dashboard-btn"]);
      if (n.brokenLinks) flags.push([`${n.brokenLinks} broken link${n.brokenLinks === 1 ? "" : "s"}`, "seo-dashboard-btn"]);
      if (n.recentErrors) flags.push([`${n.recentErrors} recent error${n.recentErrors === 1 ? "" : "s"}`, "diagnostics-btn"]);
      if (n.recentFailedWebhooks) flags.push([`${n.recentFailedWebhooks} failed webhook${n.recentFailedWebhooks === 1 ? "" : "s"}`, "diagnostics-btn"]);
    } else unavailable.push("alerts");
    if (seo.status === "fulfilled") {
      const r = seo.value;
      if (r.missingMeta && r.missingMeta.length) flags.push([`${r.missingMeta.length} page${r.missingMeta.length === 1 ? "" : "s"} without a description`, "seo-dashboard-btn"]);
      if (r.missingAlt && r.missingAlt.length) flags.push([`${r.missingAlt.length} image${r.missingAlt.length === 1 ? "" : "s"} without alt text`, "seo-dashboard-btn"]);
    } else unavailable.push("site health");
    const nowStr = new Date().toISOString();
    // Archived items are deliberately out of the way, so they stay off both lists.
    const all = [...A.map((r) => ({ k: "article", r })), ...P.map((r) => ({ k: "project", r }))].filter((x) => !x.r.archived);
    const recent = [...all].sort((a, b) => String(b.r.updated_at || "").localeCompare(String(a.r.updated_at || ""))).slice(0, 6);
    const draftsAll = all.filter((x) => !x.r.published_at);
    const scheduled = all.filter((x) => x.r.published_at && String(x.r.published_at) > nowStr);
    const list = (items, empty, total) =>
      items.length
        ? `<ul class="dash-list">${items.map((x) => dashboardItemHtml(x.k, x.r)).join("")}</ul>${
            total > items.length ? `<p class="dash-empty">and ${total - items.length} more in Articles and Projects</p>` : ""
          }`
        : `<p class="dash-empty">${empty}</p>`;
    const attention = flags.length
      ? `<ul class="dash-flags">${flags.map(([f]) => `<li>${escapeHtml(f)}</li>`).join("")}</ul>${[...new Set(flags.map(([, go]) => go))]
          .map((go) => `<button type="button" class="dash-link" data-go="${go}">${go === "diagnostics-btn" ? "Open Diagnostics" : "Open Site Health"}</button>`)
          .join(" ")}`
      : unavailable.length
        ? ""
        : "<p class='dash-empty'>No broken links, failed backups or recent errors.</p>";
    const unavailableNote = unavailable.length ? `<p class="dash-empty dash-unavailable">Couldn't load: ${escapeHtml(unavailable.join(", "))}. What's shown may be incomplete.</p>` : "";
    body.innerHTML = `
      <section class="dash-card dash-attention${flags.length ? " has-flags" : ""}"><h2>${flags.length ? "Needs attention" : unavailable.length ? "Couldn't check everything" : "All clear"}</h2>${attention}${unavailableNote}</section>
      <section class="dash-card"><h2>Recent edits</h2>${list(recent, "Nothing edited yet.", recent.length)}</section>
      <section class="dash-card"><h2>Drafts${draftsAll.length ? ` (${draftsAll.length})` : ""}</h2>${list(draftsAll.slice(0, 6), "No drafts waiting.", draftsAll.length)}</section>
      ${scheduled.length ? `<section class="dash-card"><h2>Scheduled (${scheduled.length})</h2>${list(scheduled.slice(0, 6), "", scheduled.length)}</section>` : ""}
      <section class="dash-card"><h2>Jump to</h2><div class="dash-links">${[
        ["new-page-btn", "New page"],
        ["articles-btn", "Articles"],
        ["projects-btn", "Projects"],
        ["media-btn", "Media"],
        ["analytics-btn", "Analytics"],
        ["site-settings-btn", "Site Settings"],
      ]
        .map(([id, label]) => `<button type="button" class="dash-link" data-go="${id}">${escapeHtml(label)}</button>`)
        .join("")}</div></section>`;
    body.querySelectorAll(".dash-item").forEach((b) =>
      b.addEventListener("click", () => {
        el("dashboard-modal").hidden = true;
        const id = Number(b.dataset.id);
        if (b.dataset.kind === "article") openArticleEditorById(id);
        else openProjectEditorById(id);
      })
    );
    body.querySelectorAll("[data-go]").forEach((b) =>
      b.addEventListener("click", () => {
        el("dashboard-modal").hidden = true;
        el(b.dataset.go).click();
      })
    );
  }
  el("dashboard-btn").addEventListener("click", () => openDashboard().catch((e) => (el("dashboard-body").textContent = "Couldn't load the dashboard: " + e.message)));
  el("close-dashboard").addEventListener("click", () => (el("dashboard-modal").hidden = true));

  el("seo-dashboard-btn").addEventListener("click", async () => {
    el("seo-dashboard-modal").hidden = false;
    // Pages/articles/projects need to be loaded for the exclusions list to
    // be accurate — cheap to just refetch rather than assume the in-memory
    // arrays are current (e.g. if this is opened before any editor tab).
    pages = await api("/pages");
    articles = await api("/articles");
    projects = await api("/projects");
    renderSitemapExclusions();
    loadScheduledLinkCheckStatus().catch(() => {});
  });

  el("run-scheduled-link-check-btn").addEventListener("click", async () => {
    const btn = el("run-scheduled-link-check-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      await api("/link-check-status/run", { method: "POST" });
      await loadScheduledLinkCheckStatus();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });
  closeModalOnClick("close-seo-dashboard", "seo-dashboard-modal");

  // ---------- Preview (responsive widths + stress previews) ----------
  let stressLongText = false;
  let stressBrokenImages = false;
  // Applied fresh after every real navigation of the iframe (not by patching
  // in place) — a reload always gives real, unmodified content to start
  // from, so toggling a stress effect off never needs to "undo" a mutation.
  function applyStressEffects() {
    let doc;
    try {
      doc = el("preview-frame").contentDocument;
    } catch (e) {
      return;
    }
    if (!doc || !doc.body) return;
    if (stressLongText) {
      doc.querySelectorAll("h1, h2, h3, h4, h5, h6, p").forEach((node) => {
        if (node.textContent.trim()) node.textContent = (node.textContent.trim() + " ").repeat(4).trim();
      });
    }
    if (stressBrokenImages) {
      doc.querySelectorAll("img").forEach((img) => {
        img.src = "/stress-preview-missing-image.jpg";
      });
    }
  }
  el("preview-frame").addEventListener("load", applyStressEffects);

  // Hover and focus state previews. A real :hover or :focus can't be forced from
  // script, so the page's own rules are rewritten in the preview frame: every
  // :hover (or :focus-visible, :focus-within, :focus) in a selector becomes an
  // attribute selector, and that attribute is put on every element. The rules keep
  // their own place in the cascade, their own media and support conditions and
  // their own selector lists, so the result follows the real page (including
  // descendant rules such as ".card:hover .title" and ":not(:hover)"). Nothing is
  // changed in the page itself: a reload gives back the real thing, like the stress
  // previews. Browser-default focus rings that the site doesn't style are not shown.
  let forceHoverStates = false;
  let forceFocusStates = false;
  // [pseudo-class pattern, attribute]. Hover is forced on every element (a real pointer
  // hovers an element and all its ancestors, and a rule can target any of them); focus
  // only on things that can take focus, and :focus-within on those and their ancestors,
  // so a bare ":focus-visible" rule doesn't ring the whole page.
  const HOVER_RULE = ["(?<!\\\\):hover(?![\\w-])", "data-forced-hover"];
  const FOCUS_RULE = ["(?<!\\\\):(?:focus-visible|focus)(?![\\w-])", "data-forced-focus"];
  const FOCUS_WITHIN_RULE = ["(?<!\\\\):focus-within(?![\\w-])", "data-forced-focus-within"];
  const FOCUSABLE = "a[href], button, input, select, textarea, summary, iframe, [contenteditable]:not([contenteditable='false']), [tabindex]:not([tabindex='-1'])";
  function forceStatesInRules(rules, pseudo, attr) {
    const test = new RegExp(pseudo);
    const all = new RegExp(pseudo, "g");
    for (const rule of Array.from(rules)) {
      if (rule.selectorText !== undefined && test.test(rule.selectorText)) {
        try {
          rule.selectorText = rule.selectorText.replace(all, `[${attr}]`);
        } catch (e) {
          // a selector the browser won't take back: leave that rule as it was
        }
      }
      if (rule.cssRules && rule.cssRules.length) forceStatesInRules(rule.cssRules, pseudo, attr);
      // A stylesheet pulled in with @import is not in document.styleSheets itself.
      if (rule.styleSheet) {
        try {
          forceStatesInRules(rule.styleSheet.cssRules, pseudo, attr);
        } catch (e) {
          // cross-origin import: skip it
        }
      }
    }
  }
  // Puts the state attributes on `root` and everything inside it.
  function markForcedStates(root, hover, focus) {
    const nodes = [root, ...root.querySelectorAll("*")].filter((n) => n.nodeType === 1);
    if (hover) nodes.forEach((n) => n.setAttribute("data-forced-hover", ""));
    if (focus) {
      nodes.filter((n) => n.matches(FOCUSABLE)).forEach((n) => {
        n.setAttribute("data-forced-focus", "");
        for (let p = n; p && p.nodeType === 1; p = p.parentElement) p.setAttribute("data-forced-focus-within", "");
      });
    }
  }
  function applyStatePreviews() {
    if (!forceHoverStates && !forceFocusStates) return;
    let doc;
    try {
      doc = el("preview-frame").contentDocument;
    } catch (e) {
      return;
    }
    if (!doc || !doc.body) return;
    const rules = [];
    if (forceHoverStates) rules.push(HOVER_RULE);
    if (forceFocusStates) rules.push(FOCUS_RULE, FOCUS_WITHIN_RULE);
    for (const [pseudo, attr] of rules) {
      for (const sheet of Array.from(doc.styleSheets)) {
        if (sheet.disabled) continue;
        try {
          forceStatesInRules(sheet.cssRules, pseudo, attr);
        } catch (e) {
          // a cross-origin stylesheet can't be read: skip it
        }
      }
    }
    markForcedStates(doc.documentElement, forceHoverStates, forceFocusStates);
    // Elements the page adds later (search suggestions, menus built by script) get the
    // same treatment; the observer goes away with the document on the next reload.
    new doc.defaultView.MutationObserver((mutations) => {
      for (const m of mutations) m.addedNodes.forEach((n) => n.nodeType === 1 && markForcedStates(n, forceHoverStates, forceFocusStates));
    }).observe(doc.body, { childList: true, subtree: true });
  }
  // Reloads the preview so a toggle takes effect. A frame that is still loading
  // applies the toggles when it finishes (the load handler reads them), and a frame
  // that has navigated to another site is sent back to the page.
  function reloadPreviewFrame() {
    const frame = el("preview-frame");
    if (!frame.src || frame.src === "about:blank") return;
    try {
      const d = frame.contentDocument;
      // null means the frame is on another origin (or an error page): send it back to the page.
      if (!d) frame.src = frame.src;
      else if (d.readyState === "complete" && d.location.href !== "about:blank") frame.contentWindow.location.reload();
    } catch (e) {
      frame.src = frame.src;
    }
  }
  el("preview-frame").addEventListener("load", applyStatePreviews);
  for (const [btnId, setter] of [["force-hover-btn", (v) => (forceHoverStates = v)], ["force-focus-btn", (v) => (forceFocusStates = v)]]) {
    el(btnId).addEventListener("click", () => {
      const on = !el(btnId).classList.contains("is-active");
      setter(on);
      el(btnId).classList.toggle("is-active", on);
      el(btnId).setAttribute("aria-pressed", String(on));
      const reduced = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el("state-preview-note").textContent =
        forceHoverStates && reduced ? "Your system is set to reduce motion, so hover animations such as lift, grow and glow are off here, as they are on the live site for you." : "";
      reloadPreviewFrame();
    });
  }

  // Field-change preview: the admin canvas is a simplified schematic (no
  // real CSS, fonts, or motion effects — see computeRenderedLayoutDiagnostics
  // above for why), so seeing what a style/content edit actually looks like
  // meant manually reopening Screen Preview and clicking reload after every
  // change. If Screen Preview is already open on the page being edited, any
  // field save now refreshes it automatically instead — debounced so a
  // color picker drag or fast typing doesn't reload on every keystroke, and
  // a no-op while the modal is closed (nothing to refresh, and no point
  // paying for an iframe load nobody's looking at).
  let previewRefreshTimer = null;
  function schedulePreviewRefresh() {
    if (el("preview-modal").hidden || !el("preview-frame").src || el("preview-frame").src === "about:blank") return;
    clearTimeout(previewRefreshTimer);
    previewRefreshTimer = setTimeout(() => {
      try {
        el("preview-frame").contentWindow.location.reload();
      } catch (e) {
        // cross-origin or already-torn-down frame — nothing to do
      }
    }, 500);
  }

  el("preview-btn").addEventListener("click", () => {
    if (!currentPage) return;
    const path = currentPage.slug === "home" ? "/" : `/${currentPage.slug}`;
    el("preview-frame").src = path;
    el("preview-modal").hidden = false;
  });
  el("close-preview").addEventListener("click", () => {
    el("preview-modal").hidden = true;
    // Stops any playing video/audio/simulation JS inside the iframe from
    // continuing to run in the background once the preview is dismissed.
    el("preview-frame").src = "about:blank";
  });
  document.querySelectorAll(".preview-device-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".preview-device-btn").forEach((b) => b.classList.remove("is-active"));
      btn.classList.add("is-active");
      el("preview-frame").style.width = btn.dataset.width;
    });
  });
  el("stress-long-text-btn").addEventListener("click", () => {
    stressLongText = !stressLongText;
    el("stress-long-text-btn").classList.toggle("is-active", stressLongText);
    el("stress-long-text-btn").setAttribute("aria-pressed", String(stressLongText));
    reloadPreviewFrame();
  });
  el("stress-broken-images-btn").addEventListener("click", () => {
    stressBrokenImages = !stressBrokenImages;
    el("stress-broken-images-btn").classList.toggle("is-active", stressBrokenImages);
    el("stress-broken-images-btn").setAttribute("aria-pressed", String(stressBrokenImages));
    reloadPreviewFrame();
  });

  // Motion audition: scroll-driven effects (parallax backgrounds, the
  // scroll-timeline header animation) only play back when the page actually
  // scrolls, so there was no way to see the full sequence of a page's
  // motion without manually scrolling the preview by hand every time.
  // A scrubber maps 0-1000 to 0-100% of the iframe's scrollable height and
  // drives contentWindow.scrollTo() directly — real scroll, so every
  // scroll-linked effect plays back exactly as it would live. "Play" just
  // automates moving that same scrubber top to bottom over a fixed
  // duration so the whole page's motion can be watched once without
  // touching anything.
  let motionAuditionRaf = null;
  function stopMotionAudition() {
    if (motionAuditionRaf) cancelAnimationFrame(motionAuditionRaf);
    motionAuditionRaf = null;
    el("motion-audition-play-btn").textContent = "▶ Play";
  }
  function scrubPreviewTo(fraction) {
    let win;
    try {
      win = el("preview-frame").contentWindow;
    } catch (e) {
      return;
    }
    if (!win || !win.document || !win.document.documentElement) return;
    const doc = win.document;
    const max = Math.max(0, (doc.documentElement.scrollHeight || 0) - win.innerHeight);
    // The previewed page sets `scroll-behavior: smooth` globally (see
    // style.css), so the 2-arg form of scrollTo() inherited that and
    // animated toward each target — since this fires on every rAF tick
    // during Play (and every drag input event), each frame re-targeted an
    // already-in-flight smoothed scroll a little further out, so the real
    // position perpetually chased a moving target and only caught up once
    // the target stopped moving at the very end. behavior: "instant"
    // bypasses that entirely — the scrubber needs to *set* a position, not
    // animate to one.
    win.scrollTo({ top: max * fraction, left: 0, behavior: "instant" });
  }
  el("motion-audition-scrub").addEventListener("input", (e) => {
    stopMotionAudition();
    scrubPreviewTo(Number(e.target.value) / 1000);
  });
  el("motion-audition-play-btn").addEventListener("click", () => {
    if (motionAuditionRaf) {
      stopMotionAudition();
      return;
    }
    const durationMs = 6000;
    const start = performance.now();
    el("motion-audition-play-btn").textContent = "⏸ Stop";
    const step = (now) => {
      const t = Math.min(1, (now - start) / durationMs);
      el("motion-audition-scrub").value = String(Math.round(t * 1000));
      scrubPreviewTo(t);
      if (t >= 1) {
        stopMotionAudition();
        return;
      }
      motionAuditionRaf = requestAnimationFrame(step);
    };
    motionAuditionRaf = requestAnimationFrame(step);
  });
  // A fresh page load resets scroll to the top and stops any in-progress
  // audition — starting from a stale scrub position on a different page
  // would be confusing, not helpful.
  el("preview-frame").addEventListener("load", () => {
    stopMotionAudition();
    el("motion-audition-scrub").value = "0";
  });

  // ---------- Undo (blocks only, in-memory, ~8s window) ----------
  let undoTimer = null;
  function showUndoToast(text, onUndo) {
    clearTimeout(undoTimer);
    const toast = el("undo-toast");
    el("undo-toast-text").textContent = text;
    toast.hidden = false;
    const btn = el("undo-toast-btn");
    const handler = async () => {
      btn.removeEventListener("click", handler);
      toast.hidden = true;
      clearTimeout(undoTimer);
      await onUndo();
    };
    btn.addEventListener("click", handler);
    undoTimer = setTimeout(() => {
      toast.hidden = true;
      btn.removeEventListener("click", handler);
    }, 8000);
  }

  el("duplicate-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    // Place the copy below everything else, same spot the palette uses for
    // new blocks, so it's guaranteed not to overlap anything.
    const maxRow = blocks.reduce((m, b) => Math.max(m, b.row + b.row_span), 1);
    try {
      const res = await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: block.type,
          content: block.content,
          style: styleWithoutGroup(block.style),
          col: block.col,
          col_span: block.col_span,
          row: maxRow,
          row_span: block.row_span,
        }),
      });
      await loadBlocks();
      selectedBlockId = res.id;
      renderCanvas();
      renderInspector();
      if (isMobile()) closeDrawers();
    } catch (err) {
      alert(err.message);
    }
  });

  el("isolate-block-btn").addEventListener("click", () => {
    isolationMode = !isolationMode;
    el("isolate-block-btn").classList.toggle("is-active", isolationMode);
    renderCanvas();
  });

  el("lock-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    try {
      await api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ locked: !block.locked }) });
      block.locked = !block.locked;
      updateLockButton("lock-block-btn", block.locked);
      renderCanvas();
    } catch (err) {
      alert(err.message);
    }
  });

  el("delete-block-btn").addEventListener("click", async () => {
    if (!selectedBlockId) return;
    const block = blocks.find((b) => b.id === selectedBlockId);
    if (!block) return;
    if (block.locked) {
      alert("This block is locked. Unlock it before deleting.");
      return;
    }
    if (isMobile()) closeDrawers();
    await api(`/blocks/${selectedBlockId}`, { method: "DELETE" });
    await loadBlocks();
    showUndoToast("Block deleted.", async () => {
      await api(`/pages/${currentPage.id}/blocks`, {
        method: "POST",
        body: JSON.stringify({
          type: block.type,
          content: block.content,
          style: block.style || {},
          col: block.col,
          col_span: block.col_span,
          row: block.row,
          row_span: block.row_span,
        }),
      });
      await loadBlocks();
    });
  });

  canvas.addEventListener("pointerdown", (e) => {
    if (e.target === canvas) {
      selectedBlockId = null;
      multiSelectedIds.clear();
      renderInspector();
      document.querySelectorAll(".admin-block").forEach((d) => d.classList.remove("selected"));
      renderCanvasToolbar();
    }
  });

  // ---------- Articles ----------
  let articles = [];
  let currentArticleId = null;
  let currentArticleVersion = null;
  let currentArticleLocked = false;

  // Shared by the article and page-settings lock buttons.
  function updateLockButton(btnId, locked) {
    const btn = el(btnId);
    btn.textContent = locked ? "Unlock" : "Lock";
    btn.classList.toggle("is-locked", locked);
  }

  function updateFavoriteButton(btnId, kind, id) {
    const btn = el(btnId);
    const fav = isFavorite(kind, id);
    btn.textContent = fav ? "★ Pinned" : "☆ Pin";
    btn.classList.toggle("is-favorite", fav);
  }
  function wireFavoriteButton(btnId, kind, getId, getTitle) {
    el(btnId).addEventListener("click", () => {
      const id = getId();
      if (!id) return;
      toggleFavorite(kind, id, getTitle());
      updateFavoriteButton(btnId, kind, id);
    });
  }

  el("articles-btn").addEventListener("click", async () => {
    el("articles-modal").hidden = false;
    // Always reopen to the list, not wherever a previous session's
    // mobile view was left (the .mobile-editing class otherwise persists
    // on this same DOM node across closes/reopens, since the modal is
    // never destroyed, just hidden).
    showMobileListPane("articles-modal");
    articles = await api("/articles");
    projects = await api("/projects");
    populateArticleRelatedProjectsSelect();
    renderArticlesList();
    clearArticleForm();
  });

  // ---------- Article ↔ project relationships (editable from either side) ----------
  // Storage stays project-side (project.related_articles) — this just gives
  // the article editor a way to see and edit the same relationship, so it
  // doesn't only exist from the project's editor.
  function populateArticleRelatedProjectsSelect() {
    el("article-related-projects").innerHTML = projects.map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`).join("");
  }

  // Pins specific articles as the "Related articles" shown on this
  // article's own page, overriding the automatic tag-based match — options
  // exclude the article currently being edited (an article can't be
  // related to itself). Re-populated per populateArticleForm() call since
  // "self" changes with whichever article is open.
  function populateArticleRelatedOverrideSelect(excludeId) {
    el("article-related-override").innerHTML = articles
      .filter((a) => a.id !== excludeId)
      .map((a) => `<option value="${a.id}">${escapeHtml(a.title)}</option>`)
      .join("");
  }
  async function syncArticleRelatedProjects(articleId) {
    const selectedIds = getMultiSelectValues(el("article-related-projects"));
    const changedProjects = projects.filter((p) => {
      const wasLinked = (p.related_articles || []).includes(articleId);
      const isLinked = selectedIds.includes(p.id);
      return wasLinked !== isLinked;
    });
    if (!changedProjects.length) return;
    await Promise.all(
      changedProjects.map((p) => {
        const isLinked = selectedIds.includes(p.id);
        const related_articles = isLinked
          ? [...(p.related_articles || []), articleId]
          : (p.related_articles || []).filter((id) => id !== articleId);
        return api(`/projects/${p.id}`, { method: "PATCH", body: JSON.stringify({ related_articles, expected_version: p.version }) });
      })
    );
    projects = await api("/projects");
  }
  closeModalOnClick("close-articles", "articles-modal");

  // <input type="datetime-local"> wants "YYYY-MM-DDTHH:MM" in local time,
  // not the article's stored UTC ISO string.
  function isoToLocalInput(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function articleStatusLabel(a) {
    if (!a.published_at) return " (draft)";
    if (a.published_at > new Date().toISOString()) return " (scheduled)";
    if (a.expires_at && a.expires_at <= new Date().toISOString()) return " (expired)";
    return "";
  }

  function articleLockBadge(a) {
    return `${a.locked ? ` <span class="lock-badge" title="Locked — protected from bulk actions and find-replace">Locked</span>` : ""}${
      a.pinned ? ` <span class="lock-badge" title="Pinned — leads every article list regardless of date">Pinned</span>` : ""
    }${a.featured ? ` <span class="lock-badge" title="Featured">Featured</span>` : ""}${
      a.archived ? ` <span class="lock-badge" title="Archived — still published and reachable at its URL, but hidden from listings, tag pages, related content, and RSS">Archived</span>` : ""
    }`;
  }

  let selectedArticleIds = new Set();

  function updateBulkBar() {
    const n = selectedArticleIds.size;
    el("articles-selected-count").textContent = n ? `${n} selected` : "";
    el("bulk-publish-btn").disabled = !n;
    el("bulk-unpublish-btn").disabled = !n;
    el("bulk-tag-btn").disabled = !n;
    el("bulk-trash-btn").disabled = !n;
    el("articles-select-all").checked = n > 0 && n === articles.length;
    // Same fix as Media's "Select all shown" — a partial selection used to
    // just leave this unchecked, reading as "nothing selected" even with
    // the count right next to it saying otherwise.
    el("articles-select-all").indeterminate = n > 0 && n < articles.length;
  }

  function renderArticlesList() {
    // Drop selected ids that no longer exist (trashed/deleted elsewhere).
    selectedArticleIds = new Set([...selectedArticleIds].filter((id) => articles.some((a) => a.id === id)));
    el("articles-list").innerHTML = articles
      .map(
        (a) =>
          `<div class="article-list-item${a.id === currentArticleId ? " active" : ""}" data-id="${a.id}"><input type="checkbox" class="article-select-checkbox" data-id="${a.id}"${
            selectedArticleIds.has(a.id) ? " checked" : ""
          }><div class="article-list-text"><span class="article-list-title">${escapeHtml(a.title)}</span>${articleStatusLabel(a)}${articleLockBadge(a)}${
            a.tags && a.tags.length ? `<div class="article-list-tags">${a.tags.map(escapeHtml).join(", ")}</div>` : ""
          }</div></div>`
      )
      .join("");
    el("articles-list").querySelectorAll(".article-list-item").forEach((item) => {
      item.querySelector(".article-select-checkbox").addEventListener("click", (e) => {
        e.stopPropagation();
        const id = Number(e.target.dataset.id);
        if (e.target.checked) selectedArticleIds.add(id);
        else selectedArticleIds.delete(id);
        updateBulkBar();
      });
      item.addEventListener("click", () => {
        const article = articles.find((a) => a.id === Number(item.dataset.id));
        populateArticleForm(article);
        renderArticlesList();
      });
    });
    updateBulkBar();
  }

  el("articles-select-all").addEventListener("change", (e) => {
    selectedArticleIds = e.target.checked ? new Set(articles.map((a) => a.id)) : new Set();
    renderArticlesList();
  });

  async function runBulkArticleAction(action, extra = {}) {
    if (!selectedArticleIds.size) return;
    const label = { publish: "Publish", unpublish: "Unpublish", trash: "Trash", "add-tag": "Tag" }[action];
    if (action !== "add-tag" && !confirm(`${label} ${selectedArticleIds.size} article(s)?`)) return;
    try {
      const result = await api("/articles/bulk", { method: "POST", body: JSON.stringify({ ids: [...selectedArticleIds], action, ...extra }) });
      selectedArticleIds = new Set();
      articles = await api("/articles");
      if (currentArticleId && !articles.some((a) => a.id === currentArticleId)) clearArticleForm();
      renderArticlesList();
      if (result.skippedLocked || result.skippedTooShort) {
        const reasons = [];
        if (result.skippedLocked) reasons.push(`${result.skippedLocked} skipped because they're locked`);
        if (result.skippedTooShort) reasons.push(`${result.skippedTooShort} skipped because their body is too short to publish`);
        alert(`${result.affected} article(s) ${label.toLowerCase()}ed. ${reasons.join("; ")}.`);
      }
    } catch (err) {
      alert(err.message);
    }
  }
  el("bulk-publish-btn").addEventListener("click", () => runBulkArticleAction("publish"));
  el("bulk-unpublish-btn").addEventListener("click", () => runBulkArticleAction("unpublish"));
  el("bulk-trash-btn").addEventListener("click", () => runBulkArticleAction("trash"));
  el("bulk-tag-btn").addEventListener("click", () => {
    if (!selectedArticleIds.size) return;
    const tag = (prompt("Add this tag to all selected articles:", "") || "").trim();
    if (!tag) return;
    runBulkArticleAction("add-tag", { tag });
  });

  function populateArticleForm(article) {
    showMobileEditorPane("articles-modal");
    // Switching articles must drop any pending autosave for the PREVIOUS
    // one — otherwise it could fire after currentArticleId has moved on
    // and silently overwrite the article now being edited.
    clearTimeout(autosaveTimer);
    setAutosaveStatus("");
    recordRecentlyEdited("article", article.id, article.title);
    currentArticleId = article.id;
    currentArticleVersion = article.version || null;
    articleBase = article;
    currentArticleLocked = !!article.locked;
    updateLockButton("lock-article-btn", currentArticleLocked);
    updateFavoriteButton("favorite-article-btn", "article", article.id);
    el("article-title").value = article.title;
    el("article-slug").value = article.slug;
    el("article-tags").value = (article.tags || []).join(", ");
    el("article-series").value = article.series || "";
    el("article-series-order").value = article.series_order ?? "";
    el("article-co-authors").value = (article.co_authors || []).join(", ");
    el("article-featured").checked = !!article.featured;
    el("article-pinned").checked = !!article.pinned;
    el("article-sitemap-exclude").checked = !!article.sitemap_exclude;
    el("article-archived").checked = !!article.archived;
    el("article-og-image").value = article.og_image || "";
    el("article-canonical-url").value = article.canonical_url || "";
    el("article-custom-json-ld").value = article.custom_json_ld || "";
    el("article-correction-note").value = article.correction_note || "";
    el("article-private-notes").value = article.private_notes || "";
    currentArticleTtsAudio = article.tts_audio_key || null;
    refreshArticleTtsAudio();
    populateArticleRelatedOverrideSelect(article.id);
    setMultiSelectValues(el("article-related-override"), article.related_override || []);
    setMultiSelectValues(
      el("article-related-projects"),
      projects.filter((p) => (p.related_articles || []).includes(article.id)).map((p) => p.id)
    );
    el("article-body").value = article.body;
    el("article-published").checked = !!article.published_at;
    el("article-publish-at").value = isoToLocalInput(article.published_at);
    el("article-expires-at").value = isoToLocalInput(article.expires_at);
    updateArticleExtras();
    checkArticleDraftRecovery(article.id);
  }

  // ---------- Article crash-recovery draft ----------
  // Raw DOM field values rather than buildArticleBody()'s cooked shape
  // (parsed tags array, resolved published_at) — much simpler to snapshot
  // and restore exactly as typed, and buildArticleBody() already handles
  // turning this back into a save payload when the restored draft is saved.
  const ARTICLE_DRAFT_FIELD_IDS = [
    "article-title", "article-slug", "article-tags", "article-series", "article-series-order",
    "article-co-authors", "article-featured", "article-pinned", "article-sitemap-exclude", "article-archived", "article-og-image", "article-canonical-url", "article-custom-json-ld", "article-correction-note", "article-private-notes", "article-body", "article-published", "article-publish-at",
    "article-expires-at",
  ];
  function captureArticleRawFields() {
    const out = {};
    for (const id of ARTICLE_DRAFT_FIELD_IDS) {
      const input = el(id);
      out[id] = input.type === "checkbox" ? input.checked : input.value;
    }
    return out;
  }
  function applyArticleRawFields(fields) {
    for (const id of ARTICLE_DRAFT_FIELD_IDS) {
      if (!(id in fields)) continue;
      const input = el(id);
      if (input.type === "checkbox") input.checked = fields[id];
      else input.value = fields[id];
    }
    updateArticleExtras();
  }
  function snapshotArticleDraft() {
    saveDraft("article", currentArticleId, captureArticleRawFields());
  }
  // Called right after the form is populated (existing article) or cleared
  // (new article) — a draft that matches what's already showing is just
  // this-tab's own last save and gets cleared silently; one that differs
  // means something never made it to the server.
  function checkArticleDraftRecovery(articleId) {
    const draft = loadDraft("article", articleId);
    if (!draft) return;
    const current = JSON.stringify(captureArticleRawFields());
    if (JSON.stringify(draft.fields) === current) {
      clearDraft("article", articleId);
      return;
    }
    renderDraftRecoveryBanner("article-autosave-status", "article", articleId, draft, () => {
      applyArticleRawFields(draft.fields);
      clearDraft("article", articleId);
      scheduleAutosave();
    });
  }

  // Shows/hides the Preview and History controls, which only make sense
  // once an article has been saved (so it has a slug and a real id).
  function updateArticleExtras() {
    const slug = el("article-slug").value;
    const previewLink = el("preview-article-link");
    const historyBtn = el("article-history-btn");
    if (currentArticleId && slug) {
      previewLink.href = `/random/${slug}?preview=1`;
      previewLink.hidden = false;
      historyBtn.hidden = false;
      el("share-preview-article-btn").hidden = false;
      el("duplicate-article-btn").hidden = false;
      el("convert-article-to-project-btn").hidden = false;
    } else {
      previewLink.hidden = true;
      historyBtn.hidden = true;
      el("share-preview-article-btn").hidden = true;
      el("preview-links-panel-article").hidden = true;
      el("duplicate-article-btn").hidden = true;
      el("convert-article-to-project-btn").hidden = true;
    }
    updateWordCount();
    updateArticleOgPreview();
    updateArticleChecklist();
    updateSeriesHint();
  }

  // Keeps the series datalist in sync with whatever articles are loaded,
  // and — when the typed name exactly matches an existing series (mirrors
  // getSeriesArticles()'s exact-match lookup in worker/db.js, which is what
  // actually drives the public "Part N of M" nav) — shows the other parts
  // already in it, so the admin doesn't have to search article-by-article
  // to know what number/title to use next.
  function updateSeriesHint() {
    const distinctSeries = [...new Set(articles.map((a) => a.series).filter(Boolean))].sort();
    el("article-series-datalist").innerHTML = distinctSeries
      .map((s) => `<option value="${escapeHtml(s)}">`)
      .join("");

    const hint = el("article-series-hint");
    const series = el("article-series").value.trim();
    const siblings = series
      ? articles
          .filter((a) => a.series === series && a.id !== currentArticleId)
          .sort(
            (a, b) =>
              (a.series_order ?? Infinity) - (b.series_order ?? Infinity) ||
              new Date(a.published_at || 0) - new Date(b.published_at || 0)
          )
      : [];
    if (!siblings.length) {
      hint.hidden = true;
      hint.textContent = "";
      return;
    }
    const parts = siblings.map((a) => {
      const label = a.series_order != null ? `Part ${a.series_order}: ${a.title}` : a.title;
      // getSeriesArticles() (worker/db.js) — the server-side lookup that
      // actually drives the public "Part N of M" nav — only counts a
      // sibling once it's published and its publish date has arrived.
      // Without this check the hint would claim a draft/future-scheduled
      // article is already "in this series" when nothing on the live
      // site shows it yet.
      const isLive = a.published_at && new Date(a.published_at) <= new Date();
      return isLive ? label : `${label} (not live yet)`;
    });
    hint.hidden = false;
    hint.textContent = `Other parts already in this series: ${parts.join(", ")}`;
  }
  el("article-series").addEventListener("input", updateSeriesHint);

  // Mirrors excerpt() in worker/render.js closely enough for a live preview
  // — doesn't need to be byte-exact, just give a realistic sense of length.
  function clientExcerpt(text, maxLen = 140) {
    const flat = String(text || "")
      .replace(/^#{2,3}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/\s+/g, " ")
      .trim();
    if (flat.length <= maxLen) return flat;
    const cut = flat.slice(0, maxLen);
    const lastSpace = cut.lastIndexOf(" ");
    return cut.slice(0, lastSpace > 0 ? lastSpace : maxLen).trim() + "…";
  }

  function updateOgPreview(prefix, { title, desc, image }) {
    el(`og-preview-${prefix}-title`).textContent = title || "(untitled)";
    el(`og-preview-${prefix}-desc`).textContent = desc || "";
    const imgEl = el(`og-preview-${prefix}-img`);
    imgEl.style.backgroundImage = image ? `url('${image.replace(/'/g, "\\'")}')` : "";
    imgEl.textContent = "";
  }

  function updatePageOgPreview() {
    if (!currentPage) return;
    updateOgPreview("page", {
      title: el("page-title").value,
      desc: el("page-meta").value,
      image: el("page-og-image").value,
    });
  }

  function updateArticleOgPreview() {
    updateOgPreview("article", {
      title: el("article-title").value,
      desc: clientExcerpt(el("article-body").value),
      image: el("article-og-image").value,
    });
  }

  function updateProjectOgPreview() {
    updateOgPreview("project", {
      title: el("project-title").value,
      desc: el("project-summary").value.trim() || clientExcerpt(el("project-body").value),
      image: el("project-og-image").value,
    });
  }

  // A soft, non-blocking checklist — never prevents saving/publishing,
  // just surfaces a few common things worth having before you do.
  function renderPublishingChecklist(elId, checks) {
    el(elId).innerHTML = checks
      .map(([label, pass]) => `<span class="${pass ? "contrast-pass" : "contrast-fail"}">${pass ? "✓" : "✗"} ${escapeHtml(label)}</span>`)
      .join("");
  }

  function updateArticleChecklist() {
    renderPublishingChecklist("publish-checklist-article", [
      ["Title set", !!el("article-title").value.trim()],
      ["At least one tag", parseTags(el("article-tags").value).length > 0],
      ["Body has enough content to publish", el("article-body").value.trim().length > 50],
    ]);
    renderLinkWarnings("article-link-warnings", el("article-body").value);
    renderLinkSuggestions("article-link-suggestions", "article-body", "article", currentArticleId);
  }

  function updateProjectChecklist() {
    renderPublishingChecklist("publish-checklist-project", [
      ["Title set", !!el("project-title").value.trim()],
      ["Summary set (used for share previews and project lists)", !!el("project-summary").value.trim()],
      ["At least one tag", parseTags(el("project-tags").value).length > 0],
      ["Body has enough content to publish", el("project-body").value.trim().length > 50],
    ]);
    renderLinkWarnings("project-link-warnings", el("project-body").value);
    renderLinkSuggestions("project-link-suggestions", "project-body", "project", currentProjectId);
  }

  // ---------- Live inline broken-link check while typing ----------
  // Checks internal links only (/random/:slug, /projects/:slug, /:page-slug)
  // against the already-loaded articles/projects/pages arrays — no server
  // round-trip needed. External URLs aren't checked here (that would mean
  // a real network fetch per keystroke); use the full Link Checker (Tools
  // menu) for those. Matches against every article/project regardless of
  // publish state — cross-linking to a still-draft companion piece is a
  // legitimate thing to do while writing both at once.
  function checkInternalLinks(text) {
    const links = [...(text || "").matchAll(/\[([^\]]*)\]\(([^)]+)\)/g)].map((m) => ({ label: m[1] || m[2], url: m[2].trim() }));
    const staticRoutes = new Set(["topics", "archive", "search", "saved", "history", "shuffle", "random", "projects", ""]);
    const warnings = [];
    for (const { label, url } of links) {
      if (!url.startsWith("/") || url.startsWith("//")) continue; // only internal relative links
      let m;
      if ((m = url.match(/^\/random\/([a-z0-9-]+)$/))) {
        if (!articles.some((a) => a.slug === m[1])) {
          warnings.push(`"${label}" links to /random/${m[1]}, which doesn't match any article`);
        }
      } else if ((m = url.match(/^\/projects\/([a-z0-9-]+)$/))) {
        if (!projects.some((p) => p.slug === m[1])) {
          warnings.push(`"${label}" links to /projects/${m[1]}, which doesn't match any project`);
        }
      } else {
        const slug = url.replace(/^\//, "").split(/[?#]/)[0];
        if (!staticRoutes.has(slug.split("/")[0]) && !pages.some((p) => p.slug === slug || (slug === "" && p.slug === "home"))) {
          warnings.push(`"${label}" links to /${slug}, which doesn't match any page`);
        }
      }
    }
    return warnings;
  }

  function renderLinkWarnings(elId, text) {
    const warnings = checkInternalLinks(text);
    el(elId).innerHTML = warnings.map((w) => `<span class="contrast-fail">⚠ ${escapeHtml(w)}</span>`).join("");
  }

  // ---------- Internal-link suggestions while writing ----------
  // Length-preserving so a match's index in the stripped text is the same
  // index in the real textarea value — lets "insert this link" wrap the
  // exact right span without re-scanning the original text.
  function stripMarkdownLinksForSuggestions(text) {
    return text.replace(/\[([^\]]*)\]\([^)]*\)/g, (m) => " ".repeat(m.length));
  }

  function suggestInternalLinks(text, excludeType, excludeId) {
    if (!text || text.trim().length < 10) return [];
    const stripped = stripMarkdownLinksForSuggestions(text);
    const candidates = [];
    for (const p of pages) {
      if (p.title && p.title.length >= 4) candidates.push({ title: p.title, url: p.slug === "home" ? "/" : `/${p.slug}` });
    }
    for (const a of articles) {
      if (excludeType === "article" && a.id === excludeId) continue;
      if (a.title && a.title.length >= 4) candidates.push({ title: a.title, url: `/random/${a.slug}` });
    }
    for (const p of projects) {
      if (excludeType === "project" && p.id === excludeId) continue;
      if (p.title && p.title.length >= 4) candidates.push({ title: p.title, url: `/projects/${p.slug}` });
    }
    const seen = new Set();
    const results = [];
    for (const c of candidates) {
      if (seen.has(c.url)) continue;
      const re = new RegExp(`\\b${c.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (re.test(stripped)) {
        seen.add(c.url);
        results.push(c);
      }
      if (results.length >= 6) break;
    }
    return results;
  }

  function renderLinkSuggestions(elId, textareaId, excludeType, excludeId) {
    const textarea = el(textareaId);
    const suggestions = suggestInternalLinks(textarea.value, excludeType, excludeId);
    el(elId).innerHTML = suggestions.length
      ? `<span class="link-suggestions-label">Link suggestions:</span>${suggestions
          .map((s, i) => `<button type="button" class="link-suggestion-btn" data-idx="${i}">${escapeHtml(s.title)}</button>`)
          .join("")}`
      : "";
    el(elId)
      .querySelectorAll(".link-suggestion-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const s = suggestions[Number(btn.dataset.idx)];
          const value = textarea.value;
          const re = new RegExp(`\\b${s.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
          const m = stripMarkdownLinksForSuggestions(value).match(re);
          if (!m) return;
          const idx = m.index;
          const matchedText = value.slice(idx, idx + s.title.length);
          textarea.value = value.slice(0, idx) + `[${matchedText}](${s.url})` + value.slice(idx + s.title.length);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
        });
      });
  }

  ["page-title", "page-meta", "page-og-image"].forEach((id) => el(id).addEventListener("input", updatePageOgPreview));
  ["article-title", "article-body", "article-og-image"].forEach((id) => el(id).addEventListener("input", updateArticleOgPreview));
  ["project-title", "project-summary", "project-body", "project-og-image"].forEach((id) => el(id).addEventListener("input", updateProjectOgPreview));
  ["article-title", "article-tags", "article-body"].forEach((id) => el(id).addEventListener("input", updateArticleChecklist));
  ["project-title", "project-summary", "project-tags", "project-body"].forEach((id) => el(id).addEventListener("input", updateProjectChecklist));

  // Matches the reading-time math in worker/render.js (200 words/min) so
  // what you see while writing matches what the published article shows.
  // Standard Flesch Reading Ease approximation — syllable counting is a
  // vowel-group heuristic (not a dictionary lookup), same tradeoff every
  // lightweight readability tool makes; good enough for a rough "how easy
  // is this to read" signal while writing, not a precise linguistic count.
  function countSyllables(word) {
    const w = word.toLowerCase().replace(/[^a-z]/g, "");
    if (!w) return 0;
    const groups = w.match(/[aeiouy]+/g);
    let count = groups ? groups.length : 1;
    if (w.endsWith("e") && count > 1) count--;
    return Math.max(1, count);
  }

  function fleschReadingEase(text) {
    const words = text.match(/[a-zA-Z']+/g) || [];
    const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
    if (!words.length || !sentences.length) return null;
    const syllables = words.reduce((sum, w) => sum + countSyllables(w), 0);
    const score = 206.835 - 1.015 * (words.length / sentences.length) - 84.6 * (syllables / words.length);
    return Math.max(0, Math.min(100, Math.round(score)));
  }

  function readabilityLabel(score) {
    if (score === null) return "";
    if (score >= 90) return "Very easy";
    if (score >= 80) return "Easy";
    if (score >= 70) return "Fairly easy";
    if (score >= 60) return "Standard";
    if (score >= 50) return "Fairly difficult";
    if (score >= 30) return "Difficult";
    return "Very difficult";
  }

  // Word-count goals are per-article scratch state, not shared/published
  // content — localStorage keyed by article id is a fine home for them,
  // no schema change needed. "new" covers an unsaved article in progress.
  function wordGoalKey() {
    return `article-word-goal-${currentArticleId || "new"}`;
  }
  el("article-word-goal").addEventListener("input", () => {
    const v = el("article-word-goal").value;
    try {
      if (v) localStorage.setItem(wordGoalKey(), v);
      else localStorage.removeItem(wordGoalKey());
    } catch (e) {}
    updateWordCount();
  });

  function updateWordCount() {
    const text = el("article-body").value.trim();
    const words = text ? text.split(/\s+/).length : 0;
    const mins = Math.max(1, Math.round(words / 200));
    const score = text ? fleschReadingEase(text) : null;
    const readability = score !== null ? ` · ${readabilityLabel(score)} (${score})` : "";
    el("article-word-count").textContent = `${words} word${words === 1 ? "" : "s"} · ${mins} min read${readability}`;
    let goal;
    try {
      goal = localStorage.getItem(wordGoalKey());
    } catch (e) {
      goal = null;
    }
    if (goal) {
      if (el("article-word-goal").value !== goal) el("article-word-goal").value = goal;
      el("article-word-goal").title = `${words} / ${goal} words`;
    } else {
      el("article-word-goal").value = "";
      el("article-word-goal").title = "Set a word-count goal for this article";
    }
  }
  el("article-body").addEventListener("input", updateWordCount);

  // ---------- Markdown formatting toolbar ----------
  // Only covers syntax paragraphsHtml() in worker/render.js actually
  // renders (bold/italic/link/##/###/code fence) — no list or blockquote
  // buttons, since that markdown-lite parser doesn't support either.
  function wrapSelection(textarea, before, after, placeholder) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const value = textarea.value;
    const selected = value.slice(start, end) || placeholder;
    textarea.value = value.slice(0, start) + before + selected + after + value.slice(end);
    const newStart = start + before.length;
    textarea.focus();
    textarea.setSelectionRange(newStart, newStart + selected.length);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ---------- Paste cleanup ----------
  // Pasting from a web page, Word or Google Docs brings inline styles, spans and
  // wrapper markup along. In the writing fields the clipboard's HTML is turned into
  // the site's own Markdown-style text (headings, bold, italic, links, lists,
  // quotes, code blocks, tables) and everything else is dropped. Plain-text paste
  // (Ctrl+Shift+V, or a clipboard with no formatting) is left alone. The site's
  // renderer has no backslash escapes, so characters it would read as formatting
  // (asterisks, "](" and line-leading markers) are swapped for look-alikes.
  const PASTE_SEMANTIC = /<(h[1-6]|strong|b|em|i|a|ul|ol|li|blockquote|table|pre)\b/i;
  const PASTE_MAX_HTML = 1500000; // beyond this, leave the browser's own paste alone
  const PASTE_UNDO_LINES = 120; // insertText costs about 3 ms per line, so long lists go in as one edit too
  const PASTE_UNDO_MAX = 5000; // longer results are inserted in one step (no native Undo): insertText is slow for long multi-line text
  const PASTE_SKIP = new Set(["script", "style", "meta", "link", "head", "title", "img", "svg", "iframe", "object", "noscript", "template", "form", "input", "textarea", "button", "select", "audio", "video", "canvas", "hr"]);
  const PASTE_INLINE = new Set(["span", "b", "strong", "em", "i", "a", "font", "u", "s", "strike", "del", "ins", "mark", "small", "big", "sup", "sub", "code", "kbd", "samp", "var", "abbr", "cite", "q", "dfn", "time", "label", "bdi", "bdo", "wbr", "tt", "br"]);
  const PASTE_BLOCK_SEL = "p,div,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,table,section,article,figure,dl,dt,dd";

  function pasteSafeHref(raw) {
    let href = String(raw || "").trim();
    if (!href) return null;
    if (/^\/\//.test(href)) href = "https:" + href; // protocol-relative -> explicit
    if (/^\/\\/.test(href) || /^\\/.test(href)) return null; // slash-backslash and UNC paths
    const scheme = href.replace(/[\u0000- ]/g, "");
    if (!/^(https?:|mailto:|tel:)/i.test(scheme) && /^[a-z][a-z0-9+.-]*:/i.test(scheme)) return null; // javascript:, data:, vbscript:...
    // The renderer's link syntax can't hold these, so they are percent-encoded.
    return href.replace(/[()\[\]|*\s]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0"));
  }
  // Emphasis marks that touch ("*a*" then "**b**") would read as one span: keep them apart.
  // Pieces are collected in an array and joined once (a string built by repeated
  // concatenation goes quadratic on a paragraph with tens of thousands of runs).
  // Two runs of the same emphasis are one run ("Hel" + "lo" stays searchable);
  // different emphasis is kept apart.
  function pushInline(parts, piece) {
    if (!piece) return;
    const last = parts.length ? parts[parts.length - 1] : "";
    if (last.endsWith("*") && piece.startsWith("*")) {
      if (last.endsWith("**") && piece.startsWith("**")) {
        parts[parts.length - 1] = last.slice(0, -2);
        piece = piece.slice(2);
      } else if (!last.endsWith("**") && !piece.startsWith("**")) {
        parts[parts.length - 1] = last.slice(0, -1);
        piece = piece.slice(1);
      } else {
        parts.push("\u200b");
      }
    }
    parts.push(piece);
  }
  const pasteEscape = (t) => t.replace(/\*/g, "∗").replace(/\]\(/g, "]​(");
  const pasteCollapse = (t) => t.replace(/[ \t\r\n ]+/g, " ");
  const pasteWrapLines = (text, mark) => text.split("\n").map((l) => (l.trim() ? mark + l.trim() + mark : l)).join("\n");

  function htmlToMarkdownLite(html) {
    // The whole clipboard document is parsed (its fragment markers can sit inside a
    // table, list or code block); whitespace outside the copied part adds nothing.
    const frag = html.match(/<!--StartFragment-->([\s\S]*?)<!--EndFragment-->/i);
    const doc = new DOMParser().parseFromString(html, "text/html"); // inert: scripts never run
    const weightOf = (n) => (n.style && n.style.fontWeight) || "";
    const isBoldEl = (n, tag) => tag === "strong" || (tag === "b" && !/^(normal|400)$/.test(weightOf(n))) || /^(bold|[6-9]00)$/.test(weightOf(n));
    const isItalicEl = (n, tag) => tag === "em" || tag === "i" || (n.style && n.style.fontStyle) === "italic";

    // One inline node as text, including its own bold/italic/link. Only the outermost
    // of nested emphasis is kept (the renderer can't nest ** and *).
    function inlineOf(node, st) {
      if (node.nodeType === 3) return pasteEscape(pasteCollapse(node.nodeValue));
      if (node.nodeType !== 1) return "";
      const tag = node.tagName.toLowerCase();
      if (PASTE_SKIP.has(tag)) return "";
      if (tag === "br") return "\n";
      // Citation markers (a "[1]" or a link to an anchor) are dropped; a bare 2 in m² stays.
      if (tag === "sup" && (/^\s*\[\d+\]\s*$/.test(node.textContent) || node.querySelector('a[href^="#"]') || /(^|[\s_-])(reference|noprint|cite)/i.test(node.className || ""))) return "";
      const free = !st.bold && !st.italic;
      const bold = free && isBoldEl(node, tag);
      const italic = free && !bold && isItalicEl(node, tag);
      const child = { bold: st.bold || bold, italic: st.italic || italic, noLink: st.noLink };
      const parts = [];
      node.childNodes.forEach((k) => pushInline(parts, inlineOf(k, child)));
      const inner = parts.join("");
      if (!inner.trim()) return inner;
      let text = inner;
      if (tag === "a" && !st.noLink) {
        const href = pasteSafeHref(node.getAttribute("href"));
        if (href) text = text.replace(/^(\s*)([\s\S]*?)(\s*)$/, (_, a, core, z) => `${a}[${core.replace(/\s*\n\s*/g, " ").replace(/\[/g, "(").replace(/\]/g, ")")}](${href})${z}`);
      }
      const lead = text.match(/^\s*/)[0];
      const trail = text.match(/\s*$/)[0];
      let core = text.trim();
      if (bold) core = pasteWrapLines(core, "**");
      else if (italic) core = pasteWrapLines(core, "*");
      return lead + core + trail;
    }

    // Text only (no emphasis or links), with a space where block children meet so
    // "<td><p>a</p><p>b</p></td>" reads "a b" and not "ab".
    const plain = (node) => {
      const spaced = node.cloneNode(true);
      spaced.querySelectorAll(PASTE_BLOCK_SEL + ",br").forEach((b) => {
        b.before(" ");
        b.after(" ");
      });
      return pasteCollapse(inlineOf(spaced, { bold: true, italic: true, noLink: true })).trim();
    };
    const tidy = (t) => t.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/^\s+|\s+$/g, "");
    const STRUCT = /^(#{1,6}\s|[-+]\s|>|\d+[.)]\s|:::|```|\[\^|\[before)/;

    // Word writes each typed-in bullet as its own paragraph: consecutive ones form one list.
    function pushBlock(out, b) {
      const last = out[out.length - 1];
      if (b.wordList && last && last.wordList) last.text += "\n" + b.text;
      else out.push(b);
    }

    function paragraphs(text, out) {
      tidy(text)
        .split(/\n{2,}/)
        .forEach((p) => {
          p = p.trim().replace(/```/g, "``\u200b`"); // the renderer's fence match isn't line-anchored
          if (!p) return;
          const bullet = p.match(/^[•·▪◦‣∙]\s*([\s\S]+)$/); // Word's typed-in bullets
          if (bullet) {
            pushBlock(out, { text: `- ${bullet[1].replace(/\s*\n\s*/g, " ")}`, wordList: true });
            return;
          }
          // Lines the renderer would read as structure get an invisible lead character.
          out.push({ text: p.split("\n").map((l) => (STRUCT.test(l) ? "​" + l : l)).join("\n") });
        });
    }

    function listBlock(listEl) {
      const ordered = listEl.tagName.toLowerCase() === "ol";
      let n = Number(listEl.getAttribute("start")) || 1;
      const lines = [];
      const items = (el, depth) => {
        el.childNodes.forEach((k) => {
          if (k.nodeType !== 1) return;
          const tag = k.tagName.toLowerCase();
          if (tag === "ul" || tag === "ol") return items(k, depth + 1); // Google Docs nests a list straight inside a list
          if (tag !== "li") return;
          const clone = k.cloneNode(true);
          const nested = [...clone.querySelectorAll(":scope > ul, :scope > ol")];
          nested.forEach((x) => x.remove());
          const text = walk(clone).map((b) => b.text.replace(/\s*\n\s*/g, " ")).join(" ").trim();
          // The renderer flattens lists and needs one marker type per list, so nested
          // items reuse the top list's marker (and keep counting when it is numbered).
          if (text) lines.push(`${"  ".repeat(depth)}${ordered ? `${n++}.` : "-"} ${text}`);
          nested.forEach((x) => items(x, depth + 1));
        });
      };
      items(listEl, 0);
      return lines.join("\n");
    }

    function tableBlocks(table, out) {
      const rowsEl = [...table.children].flatMap((c) => (/^(thead|tbody|tfoot)$/i.test(c.tagName) ? [...c.children] : [c])).filter((r) => r.tagName === "TR");
      const rows = rowsEl.map((tr) => {
        const cells = [];
        [...tr.children].forEach((cell) => {
          if (!/^(td|th)$/i.test(cell.tagName)) return;
          cells.push(plain(cell).replace(/\|/g, "¦"));
          for (let i = 1; i < Math.min(20, Number(cell.getAttribute("colspan")) || 1); i++) cells.push("");
        });
        return cells;
      });
      const caption = table.querySelector(":scope > caption");
      if (caption) paragraphs(plain(caption), out);
      const w = Math.max(0, ...rows.map((r) => r.length));
      if (w < 2) {
        rows.forEach((r) => paragraphs(r.join(" "), out)); // the renderer needs two or more columns
        return;
      }
      const line = (r) => `| ${Array.from({ length: w }, (_, i) => r[i] || "").join(" | ")} |`;
      out.push({ text: [line(rows[0]), `|${" --- |".repeat(w)}`, ...rows.slice(1).map(line)].join("\n") });
    }

    function walk(container) {
      const out = [];
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const parts = [];
        run.forEach((n) => pushInline(parts, inlineOf(n, {})));
        const text = parts.join("");
        run = [];
        paragraphs(text, out);
      };
      container.childNodes.forEach((c) => {
        if (c.nodeType === 3) return run.push(c);
        if (c.nodeType !== 1) return;
        const tag = c.tagName.toLowerCase();
        if (PASTE_SKIP.has(tag)) return;
        if (PASTE_INLINE.has(tag) && !c.querySelector(PASTE_BLOCK_SEL)) return run.push(c);
        flush();
        if (/^h[1-6]$/.test(tag)) {
          const t = plain(c);
          if (t) out.push({ text: `${tag <= "h2" ? "##" : "###"} ${t}` });
        } else if (tag === "ul" || tag === "ol") {
          const t = listBlock(c);
          if (t) out.push({ text: t });
        } else if (tag === "blockquote") {
          const lines = walk(c).flatMap((b) => b.text.split("\n")).map((l) => l.trim()).filter(Boolean);
          if (lines.length) out.push({ text: lines.map((l) => `> ${l}`).join("\n") });
        } else if (tag === "pre") {
          const code = c.textContent.replace(/\r/g, "").replace(/\n+$/, "").replace(/```/g, "``​`");
          out.push({ text: "```\n" + code + "\n```" });
        } else if (tag === "table") {
          tableBlocks(c, out);
        } else {
          walk(c).forEach((b) => pushBlock(out, b)); // p, div, section, dt/dd, wrappers: their content
        }
      });
      flush();
      return out;
    }

    const md = walk(doc.body).map((b) => b.text).join("\n\n");
    // A fragment pasted mid-sentence keeps its edge spaces ("bold " + next word).
    // Line breaks between tags are pretty-printing, not spaces the user copied.
    const edge = (frag ? frag[1].replace(/<[^>]*>/g, "") : doc.body.textContent)
      .replace(/&nbsp;/g, " ")
      .replace(/^[ \t]*[\r\n]\s*|\s*[\r\n]\s*$/g, "");
    const single = !md.includes("\n\n");
    return single ? (/^\s/.test(edge) ? " " : "") + md + (/\s$/.test(edge) ? " " : "") : md;
  }

  function attachPasteCleanup(id) {
    const ta = el(id);
    if (!ta) return;
    const note = () => el(`${id}-paste-note`);
    let pasting = false;
    ta.addEventListener("input", () => {
      if (!pasting && note()) note().textContent = "";
    });
    ta.addEventListener("paste", (e) => {
      const data = e.clipboardData;
      const html = data && data.getData("text/html");
      if (!html || html.length > PASTE_MAX_HTML || !PASTE_SEMANTIC.test(html)) return; // plain text: normal paste
      let md;
      try {
        md = htmlToMarkdownLite(html);
      } catch {
        return; // never block a paste over a converter bug
      }
      if (!md.trim()) return;
      e.preventDefault();
      pasting = true;
      ta.focus();
      const big = md.length > PASTE_UNDO_MAX || md.split("\n").length > PASTE_UNDO_LINES;
      // insertText keeps the browser's own Undo working, but it is very slow for long
      // multi-line text; those go in as one edit.
      if (big || !document.execCommand || !document.execCommand("insertText", false, md)) {
        ta.setRangeText(md, ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
      setTimeout(() => (pasting = false), 0);
      if (note()) {
        note().textContent = big
          ? "Pasted with the formatting cleaned up. This paste is large, so Ctrl+Z can't undo it as one step. Ctrl+Shift+V pastes plain text."
          : "Pasted with the formatting cleaned up. Ctrl+Z undoes it; Ctrl+Shift+V pastes plain text.";
      }
    });
  }
  window.__htmlToMarkdownLite = htmlToMarkdownLite; // exercised by the admin tests

  // ---------- Import a text file into a writing field ----------
  // Reads a Markdown, plain-text or HTML file in the browser (nothing is uploaded)
  // and inserts it where the cursor is, undoable like a paste. HTML goes through the
  // same cleanup as pasted content. A title found in the file fills the title field
  // when that is still empty. Word and PDF files aren't readable this way.
  const IMPORT_MAX_BYTES = 2 * 1024 * 1024;
  let importTarget = null;
  // Front matter is only recognised when it really is key: value lines between
  // --- markers (or TOML between +++), so a note that merely starts with a rule is
  // left alone. Returns {title, rest, found}.
  function splitFrontMatter(md) {
    const m = md.match(/^(---|\+\+\+)[ \t]*\n(?:([\s\S]*?)\n)?\1[ \t]*(?:\n|$)/);
    if (!m) return { title: "", rest: md, found: false };
    const lines = (m[2] || "").split("\n");
    const isToml = m[1] === "+++";
    const keyLine = isToml ? /^[A-Za-z0-9_-]+\s*=/ : /^[A-Za-z0-9_-]+\s*:/;
    if (!lines.every((l) => !l.trim() || keyLine.test(l) || /^\s+\S/.test(l) || /^\s*-\s/.test(l) || /^\s*#/.test(l))) return { title: "", rest: md, found: false };
    let title = "";
    const idx = lines.findIndex((l) => (isToml ? /^title\s*=/ : /^title\s*:/).test(l));
    if (idx >= 0) {
      let value = lines[idx].replace(isToml ? /^title\s*=\s*/ : /^title\s*:[ \t]*/, "").trim();
      if (/^[>|][+-]?$/.test(value) || value === "") {
        const folded = [];
        for (let k = idx + 1; k < lines.length && /^\s+\S/.test(lines[k]); k++) folded.push(lines[k].trim());
        value = folded.join(" ");
      }
      if (/^".*"$/.test(value)) value = value.slice(1, -1).replace(/\\(["\\])/g, "$1");
      else if (/^'.*'$/.test(value)) value = value.slice(1, -1).replace(/''/g, "'");
      else value = value.replace(/^["']/, ""); // an unterminated quote
      title = value;
    }
    return { title, rest: md.slice(m[0].length), found: true };
  }
  function importedTextToMarkdown(name, text, titleFieldEmpty) {
    const lower = name.toLowerCase();
    const result = { body: "", title: "", frontMatter: false, titleUsed: false };
    // A .html file with no tags at all is just text.
    if (/\.html?$/.test(lower) && /<[a-z!\/][^>]*>/i.test(text)) {
      const doc = new DOMParser().parseFromString(text, "text/html");
      let title = (doc.querySelector("title") || {}).textContent || "";
      const h1 = doc.body && doc.body.querySelector("h1");
      if (!title.trim() && h1) title = h1.textContent;
      // The heading moves into the title field only when that field is empty.
      if (titleFieldEmpty && h1 && h1.textContent.trim() === title.trim()) h1.remove();
      result.body = htmlToMarkdownLite(doc.body ? doc.body.innerHTML : text);
      result.title = title;
    } else {
      let md = text.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
      const fm = splitFrontMatter(md);
      md = fm.rest;
      result.title = fm.title;
      result.frontMatter = fm.found;
      // A first-line "# heading" (not indented, not a code line) is the title.
      const first = md.match(/^(?:[ \t]*\n)*[ ]{0,3}#[ \t]+([^\n]+?)[ \t]*(?:\n|$)/);
      if (first) {
        if (!result.title) result.title = first[1].trim();
        if (titleFieldEmpty && first[1].trim() === result.title.trim()) md = md.slice(first[0].length);
      }
      result.body = md.replace(/^\n+/, "").replace(/\s+$/, "");
    }
    result.title = result.title.replace(/\s+/g, " ").trim().slice(0, 200);
    result.titleUsed = Boolean(titleFieldEmpty && result.title);
    return result;
  }
  document.querySelectorAll(".md-import-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      importTarget = btn.dataset.importTarget;
      el("import-file-input").value = "";
      el("import-file-input").click();
    });
  });
  el("import-file-input").addEventListener("change", async () => {
    const file = el("import-file-input").files && el("import-file-input").files[0];
    const targetId = importTarget;
    if (!file || !targetId) return;
    const note = el(`${targetId}-paste-note`);
    if (/\.(docx?|pdf|odt|rtf|pages)$/i.test(file.name)) {
      return alert("That kind of file can't be read here. Save it as HTML or Markdown from your word processor, or copy and paste its text into the field.");
    }
    if (file.size > IMPORT_MAX_BYTES) return alert("That file is over 2 MB. Import it in smaller parts.");
    let text;
    try {
      text = await file.text();
    } catch {
      return alert("Couldn't read that file.");
    }
    if (text.includes("\u0000")) return alert("That doesn't look like a text file.");
    const titleInput = el(targetId === "article-body" ? "article-title" : "project-title");
    if (/\.html?$/i.test(file.name) && file.size > PASTE_MAX_HTML) return alert("That HTML file is too large to clean up here (over 1.5 MB). Split it, or save it as Markdown.");
    const { body, title, frontMatter, titleUsed } = importedTextToMarkdown(file.name, text, Boolean(titleInput && !titleInput.value.trim()));
    if (!body.trim() && !titleUsed) return alert("Nothing to import: the file has no text.");
    const ta = el(targetId);
    ta.focus();
    const big = body.length > PASTE_UNDO_MAX || body.split("\n").length > PASTE_UNDO_LINES;
    if (body.trim()) {
      if (big || !document.execCommand || !document.execCommand("insertText", false, body)) {
        ta.setRangeText(body, ta.selectionStart, ta.selectionEnd, "end");
        ta.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    if (titleUsed) {
      titleInput.value = title;
      titleInput.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (note) {
      const bits = body.trim() ? [`${body.length.toLocaleString()} character${body.length === 1 ? "" : "s"}`] : [];
      if (titleUsed) bits.push("title filled in");
      if (frontMatter) bits.push("front matter removed");
      const warn = text.includes("\uFFFD") ? " Some characters couldn't be read, so the file may not be UTF-8 text." : "";
      note.textContent = `Imported ${file.name} (${bits.join(", ")}).${!body.trim() ? "" : " "}${!body.trim() ? "" : big ? "This import is large, so Ctrl+Z can't undo it as one step." : `Ctrl+Z undoes the text${titleUsed ? " (not the title)" : ""}.`}${warn}`;
    }
  });

  ["article-body", "project-body"].forEach(attachPasteCleanup);

  function prefixCurrentLine(textarea, prefix) {
    const start = textarea.selectionStart;
    const value = textarea.value;
    const lineStart = value.lastIndexOf("\n", start - 1) + 1;
    const nextBreak = value.indexOf("\n", start);
    const lineEnd = nextBreak === -1 ? value.length : nextBreak;
    const line = value.slice(lineStart, lineEnd);
    const stripped = line.replace(/^#{2,3}\s*/, "");
    const newLine = prefix + stripped;
    textarea.value = value.slice(0, lineStart) + newLine + value.slice(lineEnd);
    const delta = newLine.length - line.length;
    textarea.focus();
    textarea.setSelectionRange(start + delta, start + delta);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }

  // ---------- Distraction-free writing mode ----------
  // Reparents the real textarea into the overlay (not a copy synced back
  // and forth) so autosave, live link-checking, and word count — all
  // already wired to that exact element — keep working untouched while
  // it's in focus mode, and its normal styling just comes back once it's
  // moved back out.
  let writingFocusState = null;
  function openWritingFocus(textareaId) {
    const textarea = el(textareaId);
    writingFocusState = { textarea, parent: textarea.parentNode, nextSibling: textarea.nextSibling };
    el("writing-focus-overlay").querySelector(".writing-focus-inner").appendChild(textarea);
    el("writing-focus-overlay").hidden = false;
    textarea.focus();
  }
  function closeWritingFocus() {
    if (!writingFocusState) return;
    const { textarea, parent, nextSibling } = writingFocusState;
    if (nextSibling) parent.insertBefore(textarea, nextSibling);
    else parent.appendChild(textarea);
    textarea.focus();
    el("writing-focus-overlay").hidden = true;
    writingFocusState = null;
  }
  document.querySelectorAll(".writing-focus-btn").forEach((btn) => {
    btn.addEventListener("click", () => openWritingFocus(btn.dataset.focusTarget));
  });
  el("close-writing-focus").addEventListener("click", closeWritingFocus);

  document.querySelectorAll(".md-toolbar-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const textarea = el(btn.dataset.mdTarget || "article-body");
      switch (btn.dataset.md) {
        case "bold":
          wrapSelection(textarea, "**", "**", "bold text");
          break;
        case "italic":
          wrapSelection(textarea, "*", "*", "italic text");
          break;
        case "link": {
          const url = prompt("Link URL:", "https://");
          if (url === null) return;
          wrapSelection(textarea, "[", `](${url})`, "link text");
          break;
        }
        case "h2":
          prefixCurrentLine(textarea, "## ");
          break;
        case "h3":
          prefixCurrentLine(textarea, "### ");
          break;
        case "code":
          wrapSelection(textarea, "```\n", "\n```", "code here");
          break;
        case "before-after": {
          const beforeUrl = prompt('"Before" image URL:', "");
          if (!beforeUrl) return;
          const afterUrl = prompt('"After" image URL:', "");
          if (!afterUrl) return;
          const beforeLabel = prompt('"Before" label (optional):', "Before") || "Before";
          const afterLabel = prompt('"After" label (optional):', "After") || "After";
          const start = textarea.selectionStart;
          const value = textarea.value;
          const shortcode = `[before-after: ${beforeUrl} | ${afterUrl} | ${beforeLabel} | ${afterLabel}]`;
          const insert = `\n\n${shortcode}\n\n`;
          textarea.value = value.slice(0, start) + insert + value.slice(start);
          textarea.focus();
          const newPos = start + insert.length;
          textarea.setSelectionRange(newPos, newPos);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          break;
        }
        case "callout": {
          const type = (prompt('Callout type: note, tip, warning, or danger', "note") || "note").trim().toLowerCase();
          if (!["note", "tip", "warning", "danger"].includes(type)) return;
          const start = textarea.selectionStart;
          const end = textarea.selectionEnd;
          const value = textarea.value;
          const selected = value.slice(start, end) || "Callout text";
          const insert = `\n\n:::${type}\n${selected}\n:::\n\n`;
          textarea.value = value.slice(0, start) + insert + value.slice(end);
          textarea.focus();
          const newPos = start + insert.length;
          textarea.setSelectionRange(newPos, newPos);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          break;
        }
        case "diagram": {
          const start = textarea.selectionStart;
          const value = textarea.value;
          const template = "graph TD\n  A[Start] --> B[Step]\n  B --> C[End]";
          const insert = `\n\n\`\`\`mermaid\n${template}\n\`\`\`\n\n`;
          textarea.value = value.slice(0, start) + insert + value.slice(start);
          textarea.focus();
          const newPos = start + insert.length;
          textarea.setSelectionRange(newPos, newPos);
          textarea.dispatchEvent(new Event("input", { bubbles: true }));
          break;
        }
      }
    });
  });

  function clearArticleForm() {
    clearTimeout(autosaveTimer);
    setAutosaveStatus("");
    currentArticleId = null;
    currentArticleVersion = null;
    articleBase = null;
    currentArticleLocked = false;
    updateLockButton("lock-article-btn", false);
    el("favorite-article-btn").textContent = "☆ Pin";
    el("favorite-article-btn").classList.remove("is-favorite");
    el("article-title").value = "";
    el("article-slug").value = "";
    el("article-tags").value = "";
    el("article-series").value = "";
    el("article-series-order").value = "";
    el("article-co-authors").value = "";
    el("article-featured").checked = false;
    el("article-pinned").checked = false;
    el("article-sitemap-exclude").checked = false;
    el("article-archived").checked = false;
    el("article-og-image").value = "";
    el("article-canonical-url").value = "";
    el("article-custom-json-ld").value = "";
    el("article-correction-note").value = "";
    el("article-private-notes").value = "";
    currentArticleTtsAudio = null;
    refreshArticleTtsAudio();
    setMultiSelectValues(el("article-related-projects"), []);
    populateArticleRelatedOverrideSelect(null);
    setMultiSelectValues(el("article-related-override"), []);
    el("article-body").value = "";
    el("article-published").checked = false;
    el("article-publish-at").value = "";
    el("article-expires-at").value = "";
    // Unsaved articles share one "new" word-goal bucket (there's no real id
    // yet to key it by) — clear it so a goal set on a discarded draft
    // doesn't leak into the next blank one.
    try {
      localStorage.removeItem("article-word-goal-new");
    } catch (e) {}
    updateArticleExtras();
  }

  el("new-article").addEventListener("click", () => {
    clearArticleForm();
    checkArticleDraftRecovery(null);
    showMobileEditorPane("articles-modal");
  });

  function parseTags(str) {
    return str
      .split(",")
      .map((t) => t.trim().toLowerCase())
      .filter(Boolean);
  }

  function parseCoAuthors(str) {
    return str
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }

  function buildArticleBody() {
    const publishAtLocal = el("article-publish-at").value;
    const expiresAtLocal = el("article-expires-at").value;
    const published = el("article-published").checked;
    const seriesOrder = el("article-series-order").value;
    return {
      title: el("article-title").value,
      slug: el("article-slug").value,
      tags: parseTags(el("article-tags").value),
      series: el("article-series").value.trim() || null,
      series_order: seriesOrder === "" ? null : Number(seriesOrder),
      co_authors: parseCoAuthors(el("article-co-authors").value),
      featured: el("article-featured").checked,
      pinned: el("article-pinned").checked,
      sitemap_exclude: el("article-sitemap-exclude").checked,
      archived: el("article-archived").checked,
      related_override: getMultiSelectValues(el("article-related-override")),
      og_image: el("article-og-image").value || null,
      canonical_url: el("article-canonical-url").value.trim() || null,
      custom_json_ld: el("article-custom-json-ld").value.trim() || null,
      correction_note: el("article-correction-note").value || null,
      private_notes: el("article-private-notes").value || null,
      tts_audio_key: currentArticleTtsAudio,
      body: el("article-body").value,
      // A blank publish-at with "Published" checked means "now"; a filled
      // one schedules it (past or future). Unchecked always means draft.
      published_at: published ? (publishAtLocal ? new Date(publishAtLocal).toISOString() : new Date().toISOString()) : null,
      expires_at: expiresAtLocal ? new Date(expiresAtLocal).toISOString() : null,
    };
  }

  // Pulls the freshly re-fetched article's version into the client's
  // conflict-detection baseline — needed after every successful save, not
  // just on initial load, since this same tab's own next save would
  // otherwise "conflict" against its own prior write.
  function rebaseArticleVersion() {
    const a = articles.find((x) => x.id === currentArticleId);
    if (a) {
      currentArticleVersion = a.version || null;
      articleBase = a;
    }
  }

  // A second Save (a double click, a held Ctrl+S) while the first is still in flight would create the
  // article twice, so it is ignored until the first finishes.
  let articleSaveInFlight = false;
  el("save-article").addEventListener("click", async () => {
    if (articleSaveInFlight) return;
    const body = buildArticleBody();
    if (!body.title) return alert("Title is required.");
    const isNewArticle = !currentArticleId;
    articleSaveInFlight = true;
    try {
      if (currentArticleId) {
        body.expected_version = currentArticleVersion;
        await api(`/articles/${currentArticleId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await api("/articles", { method: "POST", body: JSON.stringify(body) });
        currentArticleId = res.id;
        el("article-slug").value = res.slug;
      }
      await syncArticleRelatedProjects(currentArticleId);
      unsavedDirty = false;
      clearDraft("article", isNewArticle ? null : currentArticleId);
      articles = await api("/articles");
      rebaseArticleVersion();
      updateArticleExtras();
      renderArticlesList();
      setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("article-autosave-status", async () => {
          clearTimeout(autosaveTimer);
          // Re-fetch before reloading — this callback only runs because the
          // in-memory `articles` array is already known stale (that's what
          // triggered the conflict), so populating straight from it would
          // just show neither side's edit, whatever was cached from before.
          articles = await api("/articles");
          const a = articles.find((x) => x.id === currentArticleId);
          if (a) populateArticleForm(a);
        }, () => compareConflict("article"));
        return;
      }
      alert(err.message);
    } finally {
      articleSaveInFlight = false;
    }
  });

  // ---------- Article autosave ----------
  // Only autosaves an article that already exists (has an id/slug) —
  // a brand new draft still needs an explicit first Save so its slug gets
  // created deliberately, not from whatever's been typed a few keystrokes in.
  let autosaveTimer = null;
  function setAutosaveStatus(text) {
    const el2 = document.getElementById("article-autosave-status");
    if (el2) el2.textContent = text;
  }
  async function autosaveArticle() {
    if (!currentArticleId) return;
    const body = buildArticleBody();
    if (!body.title) return;
    body.expected_version = currentArticleVersion;
    try {
      await api(`/articles/${currentArticleId}`, { method: "PATCH", body: JSON.stringify(body) });
      unsavedDirty = false;
      clearDraft("article", currentArticleId);
      articles = await api("/articles");
      rebaseArticleVersion();
      renderArticlesList();
      setAutosaveStatus("Saved " + new Date().toLocaleTimeString());
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("article-autosave-status", async () => {
          clearTimeout(autosaveTimer);
          articles = await api("/articles");
          const a = articles.find((x) => x.id === currentArticleId);
          if (a) populateArticleForm(a);
        }, () => compareConflict("article"));
        return;
      }
      setAutosaveStatus("Autosave failed: " + err.message);
    }
  }
  function scheduleAutosave() {
    snapshotArticleDraft();
    if (!currentArticleId) return;
    unsavedDirty = true;
    setAutosaveStatus("Unsaved changes…");
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(autosaveArticle, 2000);
  }
  ["article-title", "article-tags", "article-series", "article-co-authors", "article-og-image", "article-canonical-url", "article-custom-json-ld", "article-correction-note", "article-private-notes", "article-body"].forEach((id) =>
    el(id).addEventListener("input", scheduleAutosave)
  );
  ["article-slug", "article-published", "article-publish-at", "article-expires-at", "article-series-order", "article-featured", "article-pinned", "article-sitemap-exclude", "article-archived", "article-related-override"].forEach((id) =>
    el(id).addEventListener("change", scheduleAutosave)
  );

  el("delete-article").addEventListener("click", async () => {
    if (!currentArticleId) return;
    if (!confirm("Delete this article?")) return;
    await api(`/articles/${currentArticleId}`, { method: "DELETE" });
    articles = await api("/articles");
    renderArticlesList();
    clearArticleForm();
  });

  el("lock-article-btn").addEventListener("click", async () => {
    if (!currentArticleId) return alert("Save the article first.");
    try {
      await api(`/articles/${currentArticleId}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: !currentArticleLocked, expected_version: currentArticleVersion }),
      });
      currentArticleLocked = !currentArticleLocked;
      updateLockButton("lock-article-btn", currentArticleLocked);
      articles = await api("/articles");
      rebaseArticleVersion();
      renderArticlesList();
    } catch (err) {
      alert(err.message);
    }
  });
  wireFavoriteButton("favorite-article-btn", "article", () => currentArticleId, () => el("article-title").value);
  el("duplicate-article-btn").addEventListener("click", async () => {
    if (!currentArticleId) return;
    try {
      const res = await api(`/articles/${currentArticleId}/duplicate`, { method: "POST" });
      articles = await api("/articles");
      const created = articles.find((a) => a.id === res.id);
      if (created) populateArticleForm(created);
      renderArticlesList();
    } catch (err) {
      alert(err.message);
    }
  });
  el("convert-article-to-project-btn").addEventListener("click", async () => {
    if (!currentArticleId) return;
    if (
      !confirm(
        'Create a project draft from this article\'s content? The article itself is kept as-is — nothing is deleted. If you publish this draft without adding distinct content (build photos, BOM, journal), it and the original article will have near-identical text at two different URLs — consider expanding it or adding a canonical URL first.'
      )
    )
      return;
    try {
      const res = await api(`/articles/${currentArticleId}/convert-to-project`, { method: "POST" });
      el("articles-modal").hidden = true;
      el("projects-modal").hidden = false;
      projects = await api("/projects");
      articles = await api("/articles");
      populateProjectRelatedSelects();
      renderProjectsList();
      const created = projects.find((p) => p.id === res.id);
      if (created) populateProjectForm(created);
    } catch (err) {
      alert(err.message);
    }
  });

  // Plain-Markdown export — title as an H1, then the raw markdown-lite
  // body as-is (it's already close enough to standard Markdown that no
  // conversion is needed: the same fenced code/table/footnote syntax a
  // real Markdown renderer understands, plus this site's own callout/
  // shortcode extensions, which just pass through untouched).
  function downloadMarkdown(filenameSlug, title, body) {
    // A brand-new, not-yet-saved item has no slug yet (that's assigned
    // server-side on first save) — fall back to slugifying the title
    // client-side rather than a generic "untitled.md".
    const fallback = (title || "untitled")
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "");
    const content = `# ${title}\n\n${body}\n`;
    const blob = new Blob([content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filenameSlug || fallback || "untitled"}.md`;
    a.click();
    URL.revokeObjectURL(url);
  }

  el("export-article-md-btn").addEventListener("click", () => {
    downloadMarkdown(el("article-slug").value, el("article-title").value || "Untitled", el("article-body").value);
  });

  // ---------- Projects ----------
  let projects = [];
  let currentProjectId = null;
  let currentProjectVersion = null;
  let currentProjectLocked = false;

  function projectStatusLabel(p) {
    if (!p.published_at) return " (draft)";
    if (p.published_at > new Date().toISOString()) return " (scheduled)";
    if (p.expires_at && p.expires_at <= new Date().toISOString()) return " (expired)";
    return "";
  }

  function projectBadges(p) {
    return `${p.locked ? ` <span class="lock-badge" title="Locked — protected from accidental deletion">Locked</span>` : ""}${
      p.featured ? ` <span class="lock-badge" title="Featured">Featured</span>` : ""
    }${
      p.archived ? ` <span class="lock-badge" title="Archived — still published and reachable at its URL, but hidden from listings, tag pages, related content, and RSS">Archived</span>` : ""
    }`;
  }

  let selectedProjectIds = new Set();

  function updateProjectBulkBar() {
    const n = selectedProjectIds.size;
    el("projects-selected-count").textContent = n ? `${n} selected` : "";
    el("bulk-project-publish-btn").disabled = !n;
    el("bulk-project-unpublish-btn").disabled = !n;
    el("bulk-project-tag-btn").disabled = !n;
    el("bulk-project-trash-btn").disabled = !n;
    el("projects-select-all").checked = n > 0 && n === projects.length;
    el("projects-select-all").indeterminate = n > 0 && n < projects.length;
  }

  function renderProjectsList() {
    selectedProjectIds = new Set([...selectedProjectIds].filter((id) => projects.some((p) => p.id === id)));
    el("projects-list").innerHTML = projects
      .map(
        (p) =>
          `<div class="article-list-item${p.id === currentProjectId ? " active" : ""}" data-id="${p.id}"><input type="checkbox" class="project-select-checkbox" data-id="${p.id}"${
            selectedProjectIds.has(p.id) ? " checked" : ""
          }><div class="article-list-text"><span class="article-list-title">${escapeHtml(p.title)}</span>${projectStatusLabel(p)}${projectBadges(p)}${
            p.tags && p.tags.length ? `<div class="article-list-tags">${p.tags.map(escapeHtml).join(", ")}</div>` : ""
          }</div></div>`
      )
      .join("");
    el("projects-list")
      .querySelectorAll(".article-list-item")
      .forEach((item) => {
        item.querySelector(".project-select-checkbox").addEventListener("click", (e) => {
          e.stopPropagation();
          const id = Number(e.target.dataset.id);
          if (e.target.checked) selectedProjectIds.add(id);
          else selectedProjectIds.delete(id);
          updateProjectBulkBar();
        });
        item.addEventListener("click", () => {
          const p = projects.find((x) => x.id === Number(item.dataset.id));
          if (p) populateProjectForm(p);
        });
      });
    updateProjectBulkBar();
  }

  el("projects-select-all").addEventListener("change", (e) => {
    selectedProjectIds = e.target.checked ? new Set(projects.map((p) => p.id)) : new Set();
    renderProjectsList();
  });

  async function runBulkProjectAction(action, extra = {}) {
    if (!selectedProjectIds.size) return;
    const label = { publish: "Publish", unpublish: "Unpublish", trash: "Trash", "add-tag": "Tag" }[action];
    if (action !== "add-tag" && !confirm(`${label} ${selectedProjectIds.size} project(s)?`)) return;
    try {
      const result = await api("/projects/bulk", { method: "POST", body: JSON.stringify({ ids: [...selectedProjectIds], action, ...extra }) });
      selectedProjectIds = new Set();
      projects = await api("/projects");
      if (currentProjectId && !projects.some((p) => p.id === currentProjectId)) clearProjectForm();
      renderProjectsList();
      if (result.skippedLocked || result.skippedTooShort) {
        const reasons = [];
        if (result.skippedLocked) reasons.push(`${result.skippedLocked} skipped because they're locked`);
        if (result.skippedTooShort) reasons.push(`${result.skippedTooShort} skipped because their body is too short to publish`);
        alert(`${result.affected} project(s) ${label.toLowerCase()}ed. ${reasons.join("; ")}.`);
      }
    } catch (err) {
      alert(err.message);
    }
  }
  el("bulk-project-publish-btn").addEventListener("click", () => runBulkProjectAction("publish"));
  el("bulk-project-unpublish-btn").addEventListener("click", () => runBulkProjectAction("unpublish"));
  el("bulk-project-trash-btn").addEventListener("click", () => runBulkProjectAction("trash"));
  el("bulk-project-tag-btn").addEventListener("click", () => {
    if (!selectedProjectIds.size) return;
    const tag = (prompt("Add this tag to all selected projects:", "") || "").trim();
    if (!tag) return;
    runBulkProjectAction("add-tag", { tag });
  });

  function populateProjectRelatedSelects() {
    el("project-related-articles").innerHTML = articles.map((a) => `<option value="${a.id}">${escapeHtml(a.title)}</option>`).join("");
    el("project-related-simulations").innerHTML = simulationOptions.map((s) => `<option value="${s.id}">${escapeHtml(simulationOptionLabel(s))}</option>`).join("");
    el("project-related-scans").innerHTML = scanOptions.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
    el("project-related-songs").innerHTML = songOptions.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`).join("");
  }

  // Pins specific projects as the "Related projects" shown on this
  // project's own page, overriding the automatic tag-based match — same
  // pattern as the article-side override above. Excludes the project
  // currently being edited.
  function populateProjectRelatedOverrideSelect(excludeId) {
    el("project-related-override").innerHTML = projects
      .filter((p) => p.id !== excludeId)
      .map((p) => `<option value="${p.id}">${escapeHtml(p.title)}</option>`)
      .join("");
  }

  // keepMissing: ids the list has no option for (the list is stale, or failed to
  // load) get a placeholder option instead of being dropped, so saving the form
  // can never quietly remove a relation the editor couldn't show.
  function setMultiSelectValues(select, ids, { keepMissing = false } = {}) {
    const idSet = new Set((ids || []).map(Number));
    if (keepMissing) {
      Array.from(select.options).forEach((opt) => opt.dataset.missing && opt.remove());
      const have = new Set(Array.from(select.options).map((opt) => Number(opt.value)));
      idSet.forEach((id) => {
        if (have.has(id)) return;
        const opt = document.createElement("option");
        opt.value = String(id);
        opt.dataset.missing = "1";
        opt.textContent = `#${id} (not in the current list)`;
        select.appendChild(opt);
      });
    }
    Array.from(select.options).forEach((opt) => {
      opt.selected = idSet.has(Number(opt.value));
    });
  }

  function getMultiSelectValues(select) {
    return Array.from(select.selectedOptions).map((opt) => Number(opt.value));
  }

  function populateProjectForm(project) {
    showMobileEditorPane("projects-modal");
    recordRecentlyEdited("project", project.id, project.title);
    currentProjectId = project.id;
    currentProjectVersion = project.version || null;
    projectBase = project;
    currentProjectLocked = !!project.locked;
    updateLockButton("lock-project-btn", currentProjectLocked);
    updateFavoriteButton("favorite-project-btn", "project", project.id);
    el("project-title").value = project.title;
    el("project-slug").value = project.slug;
    el("project-summary").value = project.summary || "";
    el("project-tags").value = (project.tags || []).join(", ");
    el("project-tech-stack").value = (project.tech_stack || []).join(", ");
    el("project-status").value = project.status || "";
    el("project-featured").checked = !!project.featured;
    el("project-sitemap-exclude").checked = !!project.sitemap_exclude;
    el("project-archived").checked = !!project.archived;
    el("project-featured-order").value = project.featured_order ?? "";
    el("project-sort-order").value = project.sort_order ?? "";
    const links = project.links || {};
    el("project-link-github").value = links.github || "";
    el("project-link-demo").value = links.demo || "";
    el("project-link-docs").value = links.docs || "";
    el("project-link-download").value = links.download || "";
    el("project-downloads").value = (Array.isArray(links.downloads) ? links.downloads : [])
      .map((d) => `${d.label || ""} | ${d.url || ""} | ${d.description || ""}`)
      .join("\n");
    el("project-og-image").value = project.og_image || "";
    el("project-canonical-url").value = project.canonical_url || "";
    el("project-custom-json-ld").value = project.custom_json_ld || "";
    el("project-correction-note").value = project.correction_note || "";
    el("project-private-notes").value = project.private_notes || "";
    currentProjectTtsAudio = project.tts_audio_key || null;
    refreshProjectTtsAudio();
    currentProjectHeroVideo = project.hero_video || null;
    refreshProjectHeroVideo();
    el("project-body").value = project.body || "";
    setMultiSelectValues(el("project-related-articles"), project.related_articles);
    setMultiSelectValues(el("project-related-simulations"), project.related_simulations, { keepMissing: true });
    setMultiSelectValues(el("project-related-scans"), project.related_scans, { keepMissing: true });
    setMultiSelectValues(el("project-related-songs"), project.related_songs || [], { keepMissing: true });
    populateProjectRelatedOverrideSelect(project.id);
    setMultiSelectValues(el("project-related-override"), project.related_override || []);
    el("project-published").checked = !!project.published_at;
    el("project-publish-at").value = isoToLocalInput(project.published_at);
    el("project-expires-at").value = isoToLocalInput(project.expires_at);
    el("project-autosave-status").textContent = "";
    updateProjectExtras();
    renderProjectsList();
    el("journal-section").hidden = false;
    clearJournalEntryForm();
    loadJournalEntries();
    el("bom-section").hidden = false;
    clearBomItemForm();
    loadBomItems();
    checkProjectDraftRecovery(project.id);
  }

  function clearProjectForm() {
    currentProjectId = null;
    currentProjectVersion = null;
    projectBase = null;
    currentProjectLocked = false;
    updateLockButton("lock-project-btn", false);
    el("favorite-project-btn").textContent = "☆ Pin";
    el("favorite-project-btn").classList.remove("is-favorite");
    el("project-title").value = "";
    el("project-slug").value = "";
    el("project-summary").value = "";
    el("project-tags").value = "";
    el("project-tech-stack").value = "";
    el("project-status").value = "";
    el("project-featured").checked = false;
    el("project-sitemap-exclude").checked = false;
    el("project-archived").checked = false;
    el("project-featured-order").value = "";
    el("project-sort-order").value = "";
    el("project-link-github").value = "";
    el("project-link-demo").value = "";
    el("project-link-docs").value = "";
    el("project-link-download").value = "";
    el("project-og-image").value = "";
    el("project-canonical-url").value = "";
    el("project-custom-json-ld").value = "";
    el("project-correction-note").value = "";
    el("project-private-notes").value = "";
    currentProjectTtsAudio = null;
    refreshProjectTtsAudio();
    currentProjectHeroVideo = null;
    refreshProjectHeroVideo();
    el("project-body").value = "";
    setMultiSelectValues(el("project-related-articles"), []);
    setMultiSelectValues(el("project-related-simulations"), [], { keepMissing: true });
    setMultiSelectValues(el("project-related-scans"), [], { keepMissing: true });
    setMultiSelectValues(el("project-related-songs"), [], { keepMissing: true });
    populateProjectRelatedOverrideSelect(null);
    setMultiSelectValues(el("project-related-override"), []);
    el("project-published").checked = false;
    el("project-publish-at").value = "";
    el("project-expires-at").value = "";
    el("project-autosave-status").textContent = "";
    updateProjectExtras();
    renderProjectsList();
    el("journal-section").hidden = true;
    el("journal-list").innerHTML = "";
    el("bom-section").hidden = true;
    el("bom-list").innerHTML = "";
    el("bom-total").textContent = "";
  }

  function updateProjectExtras() {
    const slug = el("project-slug").value;
    const previewLink = el("preview-project-link");
    if (currentProjectId && slug) {
      previewLink.href = `/projects/${slug}?preview=1`;
      previewLink.hidden = false;
      el("share-preview-project-btn").hidden = false;
      el("duplicate-project-btn").hidden = false;
    } else {
      previewLink.hidden = true;
      el("share-preview-project-btn").hidden = true;
      el("preview-links-panel-project").hidden = true;
      el("duplicate-project-btn").hidden = true;
    }
    updateProjectOgPreview();
    updateProjectChecklist();
  }

  function buildProjectBody() {
    const publishAtLocal = el("project-publish-at").value;
    const expiresAtLocal = el("project-expires-at").value;
    const published = el("project-published").checked;
    const links = {};
    if (el("project-link-github").value.trim()) links.github = el("project-link-github").value.trim();
    if (el("project-link-demo").value.trim()) links.demo = el("project-link-demo").value.trim();
    if (el("project-link-docs").value.trim()) links.docs = el("project-link-docs").value.trim();
    if (el("project-link-download").value.trim()) links.download = el("project-link-download").value.trim();
    const downloads = el("project-downloads")
      .value.split("\n")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((line) => {
        const [label, url, description] = line.split("|").map((s) => (s || "").trim());
        return { label: label || url || "", url: url || "", description: description || "" };
      })
      .filter((d) => d.url);
    if (downloads.length) links.downloads = downloads;
    return {
      title: el("project-title").value,
      slug: el("project-slug").value,
      summary: el("project-summary").value,
      tags: parseTags(el("project-tags").value),
      tech_stack: el("project-tech-stack").value.split(",").map((s) => s.trim()).filter(Boolean),
      status: el("project-status").value.trim() || null,
      featured: el("project-featured").checked,
      sitemap_exclude: el("project-sitemap-exclude").checked,
      archived: el("project-archived").checked,
      featured_order: el("project-featured-order").value === "" ? null : Number(el("project-featured-order").value),
      sort_order: el("project-sort-order").value === "" ? null : Number(el("project-sort-order").value),
      links,
      og_image: el("project-og-image").value || null,
      canonical_url: el("project-canonical-url").value.trim() || null,
      custom_json_ld: el("project-custom-json-ld").value.trim() || null,
      correction_note: el("project-correction-note").value || null,
      private_notes: el("project-private-notes").value || null,
      tts_audio_key: currentProjectTtsAudio,
      hero_video: currentProjectHeroVideo,
      body: el("project-body").value,
      related_articles: getMultiSelectValues(el("project-related-articles")),
      related_simulations: getMultiSelectValues(el("project-related-simulations")),
      related_scans: getMultiSelectValues(el("project-related-scans")),
      related_songs: getMultiSelectValues(el("project-related-songs")),
      related_override: getMultiSelectValues(el("project-related-override")),
      published_at: published ? (publishAtLocal ? new Date(publishAtLocal).toISOString() : new Date().toISOString()) : null,
      expires_at: expiresAtLocal ? new Date(expiresAtLocal).toISOString() : null,
    };
  }

  // ---------- Project crash-recovery draft + autosave ----------
  // Projects previously had none of this — only a manual Save button with
  // no autosave, no localStorage crash-recovery snapshot, and a weaker
  // conflict message with no way to reload the current version — all
  // three already existed for articles. Mirrors that implementation
  // exactly (see the "Article crash-recovery draft"/"Article autosave"
  // sections above), scoped the same way: raw single-value fields only,
  // not the related-content multi-selects (those need
  // getMultiSelectValues/setMultiSelectValues, not .value).
  const PROJECT_DRAFT_FIELD_IDS = [
    "project-title", "project-slug", "project-summary", "project-tags", "project-tech-stack", "project-status",
    "project-featured", "project-sitemap-exclude", "project-archived", "project-featured-order", "project-sort-order",
    "project-link-github", "project-link-demo", "project-link-docs", "project-link-download", "project-downloads",
    "project-og-image", "project-canonical-url", "project-custom-json-ld", "project-correction-note", "project-private-notes",
    "project-body", "project-published", "project-publish-at", "project-expires-at",
  ];
  function captureProjectRawFields() {
    const out = {};
    for (const id of PROJECT_DRAFT_FIELD_IDS) {
      const input = el(id);
      out[id] = input.type === "checkbox" ? input.checked : input.value;
    }
    return out;
  }
  function applyProjectRawFields(fields) {
    for (const id of PROJECT_DRAFT_FIELD_IDS) {
      if (!(id in fields)) continue;
      const input = el(id);
      if (input.type === "checkbox") input.checked = fields[id];
      else input.value = fields[id];
    }
    updateProjectExtras();
  }
  function snapshotProjectDraft() {
    saveDraft("project", currentProjectId, captureProjectRawFields());
  }
  function checkProjectDraftRecovery(projectId) {
    const draft = loadDraft("project", projectId);
    if (!draft) return;
    const current = JSON.stringify(captureProjectRawFields());
    if (JSON.stringify(draft.fields) === current) {
      clearDraft("project", projectId);
      return;
    }
    renderDraftRecoveryBanner("project-autosave-status", "project", projectId, draft, () => {
      clearTimeout(projectAutosaveTimer);
      applyProjectRawFields(draft.fields);
      clearDraft("project", projectId);
      scheduleProjectAutosave();
    });
  }
  let projectAutosaveTimer = null;
  async function autosaveProject() {
    if (!currentProjectId) return;
    const body = buildProjectBody();
    if (!body.title) return;
    body.expected_version = currentProjectVersion;
    try {
      await api(`/projects/${currentProjectId}`, { method: "PATCH", body: JSON.stringify(body) });
      unsavedDirty = false;
      clearDraft("project", currentProjectId);
      projects = await api("/projects");
      const p = projects.find((x) => x.id === currentProjectId);
      if (p) {
        currentProjectVersion = p.version || null;
        projectBase = p;
      }
      renderProjectsList();
      el("project-autosave-status").textContent = "Saved " + new Date().toLocaleTimeString();
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("project-autosave-status", async () => {
          clearTimeout(projectAutosaveTimer);
          projects = await api("/projects");
          const p = projects.find((x) => x.id === currentProjectId);
          if (p) populateProjectForm(p);
        }, () => compareConflict("project"));
        return;
      }
      el("project-autosave-status").textContent = "Autosave failed: " + err.message;
    }
  }
  function scheduleProjectAutosave() {
    snapshotProjectDraft();
    if (!currentProjectId) return;
    unsavedDirty = true;
    el("project-autosave-status").textContent = "Unsaved changes…";
    clearTimeout(projectAutosaveTimer);
    projectAutosaveTimer = setTimeout(autosaveProject, 2000);
  }
  PROJECT_DRAFT_FIELD_IDS.forEach((id) => el(id).addEventListener("input", scheduleProjectAutosave));
  // The four related-content multi-selects are deliberately excluded from
  // PROJECT_DRAFT_FIELD_IDS (crash-recovery snapshotting needs
  // getMultiSelectValues, not .value) -- but that's not a reason to also
  // leave them out of autosave itself, matching how article-related-override
  // gets its own "change" listener despite the same crash-recovery
  // exclusion. Without this, selecting a related item as the only edit
  // before a crash/tab-close was unprotected two ways instead of one.
  ["project-related-articles", "project-related-simulations", "project-related-scans", "project-related-songs", "project-related-override"].forEach((id) =>
    el(id).addEventListener("change", scheduleProjectAutosave)
  );

  el("projects-btn").addEventListener("click", async () => {
    el("projects-modal").hidden = false;
    showMobileListPane("projects-modal");
    projects = await api("/projects");
    articles = await api("/articles");
    // Songs made since the page loaded (or in another tab) should be pickable.
    await window.refreshSongOptions();
    populateProjectRelatedSelects();
    renderProjectsList();
    clearProjectForm();
  });
  closeModalOnClick("close-projects", "projects-modal");

  el("new-project").addEventListener("click", () => {
    clearProjectForm();
    checkProjectDraftRecovery(null);
    showMobileEditorPane("projects-modal");
  });

  el("save-project").addEventListener("click", async () => {
    const body = buildProjectBody();
    if (!body.title) return alert("Title is required.");
    const isNewProject = !currentProjectId;
    try {
      if (currentProjectId) {
        body.expected_version = currentProjectVersion;
        await api(`/projects/${currentProjectId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await api("/projects", { method: "POST", body: JSON.stringify(body) });
        currentProjectId = res.id;
        el("project-slug").value = res.slug;
      }
      unsavedDirty = false;
      clearDraft("project", isNewProject ? null : currentProjectId);
      projects = await api("/projects");
      const p = projects.find((x) => x.id === currentProjectId);
      if (p) {
        currentProjectVersion = p.version || null;
        projectBase = p;
      }
      updateProjectExtras();
      renderProjectsList();
      el("project-autosave-status").textContent = "Saved " + new Date().toLocaleTimeString();
      if (el("journal-section").hidden) {
        el("journal-section").hidden = false;
        clearJournalEntryForm();
      }
      await loadJournalEntries();
      if (el("bom-section").hidden) {
        el("bom-section").hidden = false;
        clearBomItemForm();
      }
      await loadBomItems();
    } catch (err) {
      if (err.conflict) {
        renderConflictStatus("project-autosave-status", async () => {
          clearTimeout(projectAutosaveTimer);
          projects = await api("/projects");
          const p = projects.find((x) => x.id === currentProjectId);
          if (p) populateProjectForm(p);
        }, () => compareConflict("project"));
        return;
      }
      alert(err.message);
    }
  });

  el("delete-project").addEventListener("click", async () => {
    if (!currentProjectId) return;
    if (!confirm("Delete this project?")) return;
    await api(`/projects/${currentProjectId}`, { method: "DELETE" });
    projects = await api("/projects");
    renderProjectsList();
    clearProjectForm();
  });

  el("lock-project-btn").addEventListener("click", async () => {
    if (!currentProjectId) return alert("Save the project first.");
    try {
      await api(`/projects/${currentProjectId}`, {
        method: "PATCH",
        body: JSON.stringify({ locked: !currentProjectLocked, expected_version: currentProjectVersion }),
      });
      currentProjectLocked = !currentProjectLocked;
      updateLockButton("lock-project-btn", currentProjectLocked);
      projects = await api("/projects");
      const p = projects.find((x) => x.id === currentProjectId);
      if (p) {
        currentProjectVersion = p.version || null;
        projectBase = p;
      }
      renderProjectsList();
    } catch (err) {
      alert(err.message);
    }
  });
  wireFavoriteButton("favorite-project-btn", "project", () => currentProjectId, () => el("project-title").value);
  el("duplicate-project-btn").addEventListener("click", async () => {
    if (!currentProjectId) return;
    try {
      const res = await api(`/projects/${currentProjectId}/duplicate`, { method: "POST" });
      projects = await api("/projects");
      const created = projects.find((p) => p.id === res.id);
      if (created) populateProjectForm(created);
      renderProjectsList();
    } catch (err) {
      alert(err.message);
    }
  });

  el("export-project-md-btn").addEventListener("click", () => {
    downloadMarkdown(el("project-slug").value, el("project-title").value || "Untitled", el("project-body").value);
  });

  // ---------- Build journal ----------
  let journalEntries = [];
  let currentJournalEntryId = null;

  const JOURNAL_TYPE_LABELS = { log: "Log", test: "Test result", decision: "Decision", failed: "Failed attempt" };

  function clearJournalEntryForm() {
    currentJournalEntryId = null;
    el("journal-entry-date").value = new Date().toISOString().slice(0, 10);
    el("journal-entry-type").value = "log";
    el("journal-entry-title").value = "";
    el("journal-entry-body").value = "";
    el("save-journal-entry-btn").textContent = "Add entry";
    el("cancel-journal-entry-btn").hidden = true;
  }

  function renderJournalList() {
    el("journal-count").hidden = !journalEntries.length;
    el("journal-count").textContent = `${journalEntries.length} ${journalEntries.length === 1 ? "entry" : "entries"}`;
    el("journal-list").innerHTML = journalEntries
      .map(
        (j) =>
          `<div class="simulation-row journal-entry-row"><span><span class="lock-badge">${escapeHtml(
            JOURNAL_TYPE_LABELS[j.entry_type] || "Log"
          )}</span> ${escapeHtml(j.entry_date)} — ${escapeHtml(j.title || "(untitled)")}${
            j.body ? `<div class="journal-entry-body">${escapeHtml(j.body.slice(0, 200))}${j.body.length > 200 ? "…" : ""}</div>` : ""
          }</span><button type="button" class="edit-journal-entry-btn" data-id="${j.id}">Edit</button><button type="button" class="delete-journal-entry-btn" data-id="${
            j.id
          }">Delete</button></div>`
      )
      .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No journal entries yet.</p>";

    el("journal-list")
      .querySelectorAll(".edit-journal-entry-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const j = journalEntries.find((x) => x.id === Number(btn.dataset.id));
          if (!j) return;
          currentJournalEntryId = j.id;
          el("journal-entry-date").value = j.entry_date;
          el("journal-entry-type").value = j.entry_type;
          el("journal-entry-title").value = j.title || "";
          el("journal-entry-body").value = j.body || "";
          el("save-journal-entry-btn").textContent = "Save entry";
          el("cancel-journal-entry-btn").hidden = false;
        });
      });
    el("journal-list")
      .querySelectorAll(".delete-journal-entry-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this journal entry?")) return;
          await api(`/journal/${btn.dataset.id}`, { method: "DELETE" });
          if (currentJournalEntryId === Number(btn.dataset.id)) clearJournalEntryForm();
          await loadJournalEntries();
        });
      });
  }

  async function loadJournalEntries() {
    if (!currentProjectId) return;
    journalEntries = await api(`/projects/${currentProjectId}/journal`);
    renderJournalList();
  }

  el("save-journal-entry-btn").addEventListener("click", async () => {
    if (!currentProjectId) return;
    const body = {
      entry_date: el("journal-entry-date").value || new Date().toISOString().slice(0, 10),
      entry_type: el("journal-entry-type").value,
      title: el("journal-entry-title").value,
      body: el("journal-entry-body").value,
    };
    try {
      if (currentJournalEntryId) {
        await api(`/journal/${currentJournalEntryId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`/projects/${currentProjectId}/journal`, { method: "POST", body: JSON.stringify(body) });
      }
      clearJournalEntryForm();
      await loadJournalEntries();
    } catch (err) {
      alert(err.message);
    }
  });

  el("cancel-journal-entry-btn").addEventListener("click", () => clearJournalEntryForm());

  // ---------- Bill of materials ----------
  let bomItems = [];
  let currentBomItemId = null;

  function formatMoney(n) {
    return "$" + Number(n).toFixed(2);
  }

  function clearBomItemForm() {
    currentBomItemId = null;
    el("bom-item").value = "";
    el("bom-quantity").value = "1";
    el("bom-price").value = "";
    el("bom-link").value = "";
    el("bom-substitution").value = "";
    el("save-bom-item-btn").textContent = "Add item";
    el("cancel-bom-item-btn").hidden = true;
  }

  function renderBomList() {
    el("bom-count").hidden = !bomItems.length;
    el("bom-count").textContent = `${bomItems.length} ${bomItems.length === 1 ? "part" : "parts"}`;
    el("bom-list").innerHTML = bomItems
      .map(
        (b) =>
          `<div class="simulation-row"><span>${escapeHtml(b.item)} — ${b.quantity}${
            b.price != null ? ` × ${formatMoney(b.price)}` : ""
          }${b.substitution ? ` <span class="lock-badge" title="${escapeHtml(b.substitution)}">Sub</span>` : ""}${
            b.link ? ` <a href="${escapeHtml(b.link)}" target="_blank" rel="noopener">link</a>` : ""
          }</span><button type="button" class="edit-bom-item-btn" data-id="${b.id}">Edit</button><button type="button" class="delete-bom-item-btn" data-id="${
            b.id
          }">Delete</button></div>`
      )
      .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No parts added yet.</p>";
    const total = bomItems.reduce((sum, b) => sum + (b.price != null ? b.price * b.quantity : 0), 0);
    el("bom-total").textContent = bomItems.length ? `Total build cost: ${formatMoney(total)}` : "";

    el("bom-list")
      .querySelectorAll(".edit-bom-item-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => {
          const b = bomItems.find((x) => x.id === Number(btn.dataset.id));
          if (!b) return;
          currentBomItemId = b.id;
          el("bom-item").value = b.item;
          el("bom-quantity").value = b.quantity;
          el("bom-price").value = b.price ?? "";
          el("bom-link").value = b.link || "";
          el("bom-substitution").value = b.substitution || "";
          el("save-bom-item-btn").textContent = "Save item";
          el("cancel-bom-item-btn").hidden = false;
        });
      });
    el("bom-list")
      .querySelectorAll(".delete-bom-item-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this part?")) return;
          await api(`/bom/${btn.dataset.id}`, { method: "DELETE" });
          if (currentBomItemId === Number(btn.dataset.id)) clearBomItemForm();
          await loadBomItems();
        });
      });
  }

  async function loadBomItems() {
    if (!currentProjectId) return;
    bomItems = await api(`/projects/${currentProjectId}/bom`);
    renderBomList();
  }

  // The BOM feature already computes everything needed to shop/order
  // parts (item, qty, price, where-to-buy link, substitution note, and a
  // grand total) but had no way to get that list out of the admin at all.
  // Reuses the exact same toCsvRow()/Blob-download pattern the Analytics
  // export button already established, just for this data instead.
  el("export-bom-csv-btn").addEventListener("click", () => {
    if (!bomItems.length) return alert("No BOM items to export yet.");
    let csv = toCsvRow(["Item", "Quantity", "Price paid", "Line total", "Where to buy", "Substitution note"]);
    bomItems.forEach((b) => {
      const lineTotal = b.price != null ? (b.price * b.quantity).toFixed(2) : "";
      csv += toCsvRow([b.item, b.quantity, b.price != null ? b.price.toFixed(2) : "", lineTotal, b.link || "", b.substitution || ""]);
    });
    const total = bomItems.reduce((sum, b) => sum + (b.price != null ? b.price * b.quantity : 0), 0);
    csv += toCsvRow(["", "", "", "", "", ""]) + toCsvRow(["", "", "Total", total.toFixed(2), "", ""]);
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    const project = projects.find((p) => p.id === currentProjectId);
    a.download = `bom-${(project && project.slug) || currentProjectId}-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Minimal RFC4180-ish CSV parser (quoted fields, "" escapes, \r\n or \n
  // line endings) -- good enough for both a re-imported export and a
  // pasted-from-spreadsheet parts list, without pulling in a library for
  // the one CSV-reading feature this admin has.
  function parseCsvText(text) {
    const rows = [];
    let row = [];
    let field = "";
    let inQuotes = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (inQuotes) {
        if (c === '"') {
          if (text[i + 1] === '"') {
            field += '"';
            i++;
          } else inQuotes = false;
        } else field += c;
      } else if (c === '"') inQuotes = true;
      else if (c === ",") {
        row.push(field);
        field = "";
      } else if (c === "\r") {
        // ignore -- \n (below) is what actually ends the row
      } else if (c === "\n") {
        row.push(field);
        rows.push(row);
        row = [];
        field = "";
      } else field += c;
    }
    if (field !== "" || row.length) {
      row.push(field);
      rows.push(row);
    }
    return rows.filter((r) => r.some((cell) => cell !== ""));
  }

  function findCsvColumn(header, aliases) {
    return header.findIndex((h) => aliases.includes(String(h).trim().toLowerCase()));
  }

  el("import-bom-csv-btn").addEventListener("click", () => el("import-bom-csv-input").click());
  el("import-bom-csv-input").addEventListener("change", async (e) => {
    const file = e.target.files[0];
    e.target.value = "";
    if (!file || !currentProjectId) return;
    const rows = parseCsvText(await file.text());
    if (rows.length < 2) return alert("No rows found in that CSV.");
    const header = rows[0];
    const col = {
      item: findCsvColumn(header, ["item", "name", "part", "part name"]),
      quantity: findCsvColumn(header, ["quantity", "qty"]),
      price: findCsvColumn(header, ["price paid", "price", "unit price", "cost"]),
      link: findCsvColumn(header, ["where to buy", "link", "url"]),
      substitution: findCsvColumn(header, ["substitution note", "substitution", "sub", "notes"]),
    };
    if (col.item === -1) return alert('CSV needs a header column named "Item" (or "Name"/"Part").');
    let imported = 0;
    let skipped = 0;
    // Sequential, not Promise.all -- these hit the same POST endpoint the
    // one-at-a-time "Add item" button uses, and a big paste shouldn't fire
    // dozens of concurrent writes at it.
    for (const row of rows.slice(1)) {
      const item = String(row[col.item] || "").trim();
      if (!item) {
        skipped++;
        continue;
      }
      const body = {
        item,
        quantity: col.quantity !== -1 ? row[col.quantity] : 1,
        price: col.price !== -1 && row[col.price] ? row[col.price] : null,
        link: (col.link !== -1 && (row[col.link] || "").trim()) || null,
        substitution: (col.substitution !== -1 && (row[col.substitution] || "").trim()) || null,
      };
      try {
        await api(`/projects/${currentProjectId}/bom`, { method: "POST", body: JSON.stringify(body) });
        imported++;
      } catch (err) {
        skipped++;
      }
    }
    await loadBomItems();
    alert(`Imported ${imported} item${imported === 1 ? "" : "s"}.${skipped ? ` Skipped ${skipped} row${skipped === 1 ? "" : "s"} with no item name.` : ""}`);
  });

  el("save-bom-item-btn").addEventListener("click", async () => {
    if (!currentProjectId) return;
    if (!el("bom-item").value.trim()) return alert("Item name is required.");
    const body = {
      item: el("bom-item").value.trim(),
      quantity: el("bom-quantity").value,
      price: el("bom-price").value === "" ? null : el("bom-price").value,
      link: el("bom-link").value.trim() || null,
      substitution: el("bom-substitution").value.trim() || null,
    };
    try {
      if (currentBomItemId) {
        await api(`/bom/${currentBomItemId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        await api(`/projects/${currentProjectId}/bom`, { method: "POST", body: JSON.stringify(body) });
      }
      clearBomItemForm();
      await loadBomItems();
    } catch (err) {
      alert(err.message);
    }
  });

  el("cancel-bom-item-btn").addEventListener("click", () => clearBomItemForm());

  // ---------- Media library ----------
  let mediaPickTarget = null;
  let mediaPickAppend = false;
  let mediaItems = [];
  let selectedMediaKeys = new Set();
  // What the filters (folder/type/search/unused/duplicates) are currently
  // showing — "Select all shown" needs to select just this subset, not the
  // whole library, the same way the filter itself only shows this subset.
  let lastFilteredMediaKeys = [];

  function formatBytes(n) {
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / (1024 * 1024)).toFixed(1) + " MB";
  }

  async function usageSummary(url) {
    try {
      const usage = await api(`/media/usage?url=${encodeURIComponent(url)}`);
      if (!usage.length) return "Not used anywhere — safe to delete.";
      return "Used in:\n" + usage.map((u) => `- ${u.type}${u.title ? `: "${u.title}"` : ""}`).join("\n");
    } catch {
      return "";
    }
  }

  function updateMediaBulkBar() {
    const n = selectedMediaKeys.size;
    el("media-selected-count").textContent = n ? `${n} selected` : "";
    el("media-bulk-delete-btn").disabled = !n;
    el("media-bulk-move-btn").disabled = !n;
    el("media-bulk-tag-btn").disabled = !n;
    el("media-bulk-alt-btn").disabled = !n;
    // The bulk actions only appear once something is selected, instead of
    // sitting there as a row of disabled buttons the rest of the time.
    el("media-bulk-actions").hidden = !n;
    el("media-grid").classList.toggle("has-selection", n > 0);
    const shown = lastFilteredMediaKeys;
    el("media-shown-count").textContent = `Select all ${shown.length} shown`;
    const shownSelectedCount = shown.filter((k) => selectedMediaKeys.has(k)).length;
    const selectAll = el("media-select-all");
    selectAll.checked = shown.length > 0 && shownSelectedCount === shown.length;
    // Without this, selecting some (not all) of what's shown just left the
    // checkbox unchecked — reading as "nothing selected" even when the
    // selected-count text right next to it said otherwise.
    selectAll.indeterminate = shownSelectedCount > 0 && shownSelectedCount < shown.length;
  }

  function mediaFilename(item) {
    return item.key.split("/").pop();
  }

  function mediaItemType(item) {
    if (item.key.startsWith("audio/")) return "audio";
    if (/\.(png|jpe?g|gif|webp|svg|avif)$/i.test(item.key)) return "image";
    return "other";
  }

  // Whether an item passes the dimensions filter. Sizes are recorded for images only,
  // so anything but "Any" leaves out audio and other files; "Size not recorded" finds
  // images uploaded before sizes were kept.
  function mediaMatchesSize(item, size) {
    if (!size) return true;
    if (mediaItemType(item) !== "image") return false;
    const w = Number(item.width);
    const h = Number(item.height);
    const known = w > 0 && h > 0;
    if (size === "unknown") return !known;
    if (!known) return false;
    const longest = Math.max(w, h);
    const ratio = w / h;
    if (size === "landscape") return ratio > 1.05;
    if (size === "portrait") return ratio < 0.95;
    if (size === "square") return ratio >= 0.95 && ratio <= 1.05;
    if (size === "large") return longest >= 1600;
    if (size === "medium") return longest >= 800 && longest < 1600;
    if (size === "small") return longest < 800;
    return true;
  }

  function renderMediaGrid() {
    const folderFilter = el("media-folder-filter").value;
    const typeFilter = el("media-type-filter").value;
    const sizeFilter = el("media-size-filter").value;
    const search = el("media-search").value.trim().toLowerCase();
    const usageSearch = el("media-usage-filter").value.trim().toLowerCase();
    const unusedOnly = el("media-unused-filter").checked;
    const duplicatesOnly = el("media-duplicates-filter").checked;
    const filtered = mediaItems.filter((item) => {
      if (folderFilter === "__uncategorized__" && item.folder) return false;
      else if (folderFilter && folderFilter !== "__uncategorized__" && item.folder !== folderFilter) return false;
      if (typeFilter && mediaItemType(item) !== typeFilter) return false;
      if (!mediaMatchesSize(item, sizeFilter)) return false;
      if (unusedOnly && item.used) return false;
      if (duplicatesOnly && !item.isDuplicate) return false;
      if (usageSearch && !(item.usage || []).some((u) => u.toLowerCase().includes(usageSearch))) return false;
      if (!search) return true;
      const filename = item.key.split("/").pop().toLowerCase();
      return filename.includes(search) || item.tags.some((t) => t.toLowerCase().includes(search));
    });
    lastFilteredMediaKeys = filtered.map((item) => item.key);
    // Bulk actions apply to what is selected, so a selection never outlives the filter
    // that showed it: anything no longer shown is dropped from it.
    const shownKeys = new Set(lastFilteredMediaKeys);
    selectedMediaKeys.forEach((k) => !shownKeys.has(k) && selectedMediaKeys.delete(k));

    el("media-grid").innerHTML =
      filtered
        .map(
          (item) =>
            `<div class="media-item${selectedMediaKeys.has(item.key) ? " is-selected" : ""}" data-url="${escapeHtml(item.url)}" data-key="${escapeHtml(
              item.key
            )}"><div class="media-thumb">${
              mediaItemType(item) === "image"
                ? `<img src="${escapeHtml(item.url)}" loading="lazy" alt="${escapeHtml(item.alt_text || "")}">`
                : `<span class="media-file-icon">${mediaItemType(item) === "audio" ? "♪" : "📄"}</span>`
            }<input type="checkbox" class="media-select-checkbox" aria-label="Select ${escapeHtml(mediaFilename(item))}" data-key="${escapeHtml(
              item.key
            )}"${selectedMediaKeys.has(item.key) ? " checked" : ""}><div class="media-tile-actions">${
              mediaItemType(item) === "image"
                ? `<button type="button" class="media-edit" data-url="${escapeHtml(item.url)}" data-key="${escapeHtml(item.key)}" title="Edit image" aria-label="Edit image">✎</button>`
                : ""
            }<button type="button" class="media-delete" data-key="${escapeHtml(item.key)}" title="Delete" aria-label="Delete">×</button></div></div><div class="media-meta"><div class="media-meta-top"><span class="media-filename" title="${escapeHtml(
              mediaFilename(item)
            )}">${escapeHtml(item.alt_text || item.caption || mediaFilename(item))}</span><button type="button" class="media-info" data-key="${escapeHtml(
              item.key
            )}" title="Details: folder, tags, alt text, caption, credit, license" aria-label="Details">i</button></div><div class="media-meta-sub">${escapeHtml(
              [item.width && item.height ? `${item.width}×${item.height}` : "", formatBytes(item.size), item.folder || ""].filter(Boolean).join(" · ")
            )}</div>${
              !item.used || item.isDuplicate || item.private || (!item.alt_text && mediaItemType(item) === "image")
                ? `<div class="media-badges">${item.used ? "" : '<span class="media-badge" title="Not referenced anywhere on the site">Unused</span>'}${
                    item.isDuplicate ? '<span class="media-badge media-badge-warn" title="Byte-for-byte identical to another upload">Duplicate</span>' : ""
                  }${item.private ? '<span class="media-badge" title="Admin-only — not publicly reachable, even by direct link">Private</span>' : ""}${
                    !item.alt_text && mediaItemType(item) === "image" ? '<span class="media-badge media-badge-warn" title="No alt text saved — screen readers and search engines get nothing">No alt</span>' : ""
                  }</div>`
                : ""
            }</div></div>`
        )
        .join("") ||
      `<p style='color:var(--text-dim);'>No uploads match.${
        sizeFilter && mediaItems.some((i) => mediaItemType(i) === "image" && !(i.width && i.height))
          ? " Some images have no recorded size yet: older uploads can be filled in with Settings, Tools, Backfill image dimensions."
          : ""
      }</p>`;

    el("media-grid")
      .querySelectorAll(".media-item")
      .forEach((div) => {
        div.addEventListener("click", (e) => {
          if (e.target.closest(".media-delete, .media-edit, .media-info, .media-select-checkbox")) return;
          // Browsing (not picking for a field): the tile itself opens its
          // details, rather than a click that silently does nothing.
          if (!mediaPickTarget) {
            openMediaInfoModal(div.dataset.key);
            return;
          }
          const input = document.querySelector(mediaPickTarget);
          if (input) {
            // An image block's url/alt/caption/credit fields are named
            // "...-url"/"...-alt"/"...-caption"/"...-credit" — suggest this
            // file's saved values for whichever of those fields are blank.
            // Merged into a single save rather than one dispatched "change"
            // per field: firing several independent saves back to back can
            // race (an earlier request completing after a later one),
            // silently dropping whichever field's save lost the race.
            const item = mediaItems.find((m) => m.url === div.dataset.url);
            const block = item && input.id.endsWith("-url") ? blocks.find((b) => b.id === selectedBlockId) : null;
            if (block) {
              input.value = div.dataset.url;
              // A critic pass found this left the image-url source badge
              // stale after Browse, since renderCanvas() below only
              // rebuilds the block's on-canvas preview, never the
              // inspector panel the badge lives in. Fixed by calling the
              // badge's own update function directly rather than
              // dispatching a synthetic "change" event on this input --
              // a first attempt at that dispatched a real event, which a
              // second critic pass caught also re-triggering this same
              // input's own unrelated generic autosave-on-change listener
              // (every [data-key] field gets one), firing an extra,
              // incomplete PATCH mid-branch that raced the merged save
              // two lines below -- reintroducing the exact
              // "independent saves can race and drop a field" bug the
              // comment above this block was written to avoid.
              if (input._imageUrlBadgeUpdate) input._imageUrlBadgeUpdate();
              block.content.url = div.dataset.url;
              [
                ["alt", "alt_text"],
                ["caption", "caption"],
                ["credit", "credit"],
              ].forEach(([suffix, itemKey]) => {
                const sibling = document.getElementById(input.id.replace(/-url$/, `-${suffix}`));
                if (sibling && !sibling.value && item[itemKey]) {
                  sibling.value = item[itemKey];
                  block.content[suffix] = item[itemKey];
                }
              });
              api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ content: block.content, style: block.style }) }).catch(() => {});
              renderCanvas();
            } else {
              setFieldUrl(input, div.dataset.url, mediaPickAppend);
            }
          }
          closeMediaModal();
        });
      });

    el("media-grid")
      .querySelectorAll(".media-select-checkbox")
      .forEach((cb) => {
        cb.addEventListener("click", (e) => {
          e.stopPropagation();
          if (e.target.checked) selectedMediaKeys.add(e.target.dataset.key);
          else selectedMediaKeys.delete(e.target.dataset.key);
          e.target.closest(".media-item").classList.toggle("is-selected", e.target.checked);
          updateMediaBulkBar();
        });
      });

    el("media-grid")
      .querySelectorAll(".media-edit")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (window.PhotoEditor) window.PhotoEditor.open(btn.dataset.url, btn.dataset.key);
        });
      });

    el("media-grid")
      .querySelectorAll(".media-info")
      .forEach((btn) => {
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          openMediaInfoModal(btn.dataset.key);
        });
      });

    el("media-grid")
      .querySelectorAll(".media-delete")
      .forEach((btn) => {
        btn.addEventListener("click", async (e) => {
          e.stopPropagation();
          const item = mediaItems.find((m) => m.key === btn.dataset.key);
          const usage = item ? await usageSummary(item.url) : "";
          if (!confirm(`Delete this file? This can't be undone.\n\n${usage}`)) return;
          try {
            await api(`/media/${btn.dataset.key}`, { method: "DELETE" });
            selectedMediaKeys.delete(btn.dataset.key);
            await loadMediaLibrary();
          } catch (err) {
            alert(err.message);
          }
        });
      });

    updateMediaBulkBar();
  }

  // Selects/deselects only the files the current filters are actually
  // showing (lastFilteredMediaKeys, set fresh by renderMediaGrid every
  // time it runs) — not the whole library, matching what "shown" means in
  // the label. Articles/Projects lists' own "select all" selects
  // everything because those lists have no filter to be "shown" by.
  el("media-bulk-clear-btn").addEventListener("click", () => {
    selectedMediaKeys.clear();
    renderMediaGrid();
  });

  el("media-select-all").addEventListener("change", (e) => {
    if (e.target.checked) lastFilteredMediaKeys.forEach((k) => selectedMediaKeys.add(k));
    else lastFilteredMediaKeys.forEach((k) => selectedMediaKeys.delete(k));
    renderMediaGrid();
  });

  let mediaInfoKey = null;
  function openMediaInfoModal(key) {
    const item = mediaItems.find((m) => m.key === key);
    if (!item) return;
    mediaInfoKey = key;
    el("media-info-preview").src = item.url;
    const ext = item.key.split(".").pop().toUpperCase();
    const isImage = /^(uploads)\//.test(item.key) || /\.(png|jpe?g|gif|webp|svg|avif)$/i.test(item.key);
    const metaEl = el("media-info-meta");
    metaEl.textContent = `${ext} · ${formatBytes(item.size)}`;
    if (isImage) {
      const probe = new Image();
      probe.onload = () => {
        if (mediaInfoKey === key) metaEl.textContent = `${ext} · ${formatBytes(item.size)} · ${probe.naturalWidth}×${probe.naturalHeight}px`;
      };
      probe.src = item.url;
    }
    el("media-info-folder").value = item.folder || "";
    el("media-info-tags").value = item.tags.join(", ");
    el("media-info-alt").value = item.alt_text || "";
    el("media-info-caption").value = item.caption || "";
    el("media-info-credit").value = item.credit || "";
    el("media-info-license").value = item.license || "";
    el("media-info-private").checked = !!item.private;
    el("media-info-history-list").innerHTML = "";
    el("media-info-file-versions-list").innerHTML = "";
    el("media-info-modal").hidden = false;
  }
  closeModalOnClick("close-media-info", "media-info-modal");
  el("save-media-info").addEventListener("click", async () => {
    if (!mediaInfoKey) return;
    const item = mediaItems.find((m) => m.key === mediaInfoKey);
    const turningPrivateOn = el("media-info-private").checked && !(item && item.private);
    if (turningPrivateOn) {
      // Marking a file private breaks its direct URL for anonymous
      // visitors immediately -- if it's currently embedded in a published
      // page/article, that page's image would 404 the moment this saves.
      // Same "warn before an action with a visible consequence" pattern
      // already used before deleting a file, just worded for this case
      // instead of borrowing delete's "safe to delete" phrasing.
      const usage = await api(`/media/usage?url=${encodeURIComponent(item.url)}`).catch(() => []);
      if (usage.length) {
        const list = usage.map((u) => `- ${u.type}${u.title ? `: "${u.title}"` : ""}`).join("\n");
        if (!confirm(`This file is currently used in:\n${list}\n\nMarking it private will break its direct link there for anyone not logged in. Continue?`)) {
          return;
        }
      }
    }
    try {
      await api(`/media/${mediaInfoKey}`, {
        method: "PATCH",
        body: JSON.stringify({
          folder: el("media-info-folder").value.trim() || null,
          tags: el("media-info-tags").value.split(",").map((t) => t.trim()).filter(Boolean),
          alt_text: el("media-info-alt").value.trim() || null,
          caption: el("media-info-caption").value.trim() || null,
          credit: el("media-info-credit").value.trim() || null,
          license: el("media-info-license").value.trim() || null,
          private: el("media-info-private").checked,
        }),
      });
      el("media-info-modal").hidden = true;
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

  el("media-info-history-btn").addEventListener("click", async () => {
    if (!mediaInfoKey) return;
    try {
      const revisions = await api(`/media-revisions?key=${encodeURIComponent(mediaInfoKey)}`);
      el("media-info-history-list").innerHTML =
        revisions
          .map(
            (r) =>
              `<div class="link-check-row"><span class="link-check-url">${escapeHtml(
                (r.created_at || "").replace("T", " ").slice(0, 19)
              )}</span><span class="link-check-source">${escapeHtml(
                [r.folder, (r.tags || []).join(", "), r.alt_text, r.caption, r.credit, r.license].filter(Boolean).join(" · ") || "(all blank)"
              )}</span><button type="button" class="restore-media-revision-btn" data-id="${r.id}">Restore</button></div>`
          )
          .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No earlier versions saved yet.</p>";
      el("media-info-history-list")
        .querySelectorAll(".restore-media-revision-btn")
        .forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Restore this version? The current metadata is saved as its own history entry first, so this can be undone too.")) return;
            try {
              await api(`/media-revisions/${btn.dataset.id}/restore`, { method: "POST" });
              const item = mediaItems.find((m) => m.key === mediaInfoKey);
              if (item) {
                const fresh = await api("/media");
                mediaItems = fresh;
                openMediaInfoModal(mediaInfoKey);
              }
              el("media-info-history-btn").click();
            } catch (err) {
              alert(err.message);
            }
          });
        });
    } catch (err) {
      alert(err.message);
    }
  });

  el("media-info-file-versions-btn").addEventListener("click", async () => {
    if (!mediaInfoKey) return;
    try {
      const versions = await api(`/media-file-versions?key=${encodeURIComponent(mediaInfoKey)}`);
      el("media-info-file-versions-list").innerHTML =
        versions
          .map(
            (v) =>
              `<div class="link-check-row"><img src="${escapeHtml(v.url)}" alt="" style="width:32px;height:32px;object-fit:cover;border-radius:4px;flex-shrink:0;"><span class="link-check-url">${escapeHtml(
                (v.created_at || "").replace("T", " ").slice(0, 19)
              )}</span><span class="link-check-source">${formatBytes(v.size || 0)}</span><button type="button" class="restore-media-file-version-btn" data-id="${v.id}">Restore</button></div>`
          )
          .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No earlier file versions saved yet (only created by 'Overwrite original' in the photo editor).</p>";
      el("media-info-file-versions-list")
        .querySelectorAll(".restore-media-file-version-btn")
        .forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Restore this file version? The current file is archived first, so this can be undone too.")) return;
            try {
              await api(`/media-file-versions/${btn.dataset.id}/restore`, { method: "POST" });
              await loadMediaLibrary();
              el("media-info-file-versions-btn").click();
            } catch (err) {
              alert(err.message);
            }
          });
        });
    } catch (err) {
      alert(err.message);
    }
  });

  el("media-unused-filter").addEventListener("change", renderMediaGrid);
  el("media-duplicates-filter").addEventListener("change", renderMediaGrid);

  el("media-backfill-dimensions-btn").addEventListener("click", async () => {
    const btn = el("media-backfill-dimensions-btn");
    const originalText = btn.textContent;
    btn.textContent = "Reading…";
    btn.disabled = true;
    try {
      const { updated, unreadable } = await runMediaBackfill(
        "/media/backfill-dimensions",
        ["updated", "unreadable", "alreadyHad"],
        ({ updated, unreadable, alreadyHad }) => {
          btn.textContent = `Reading… (${updated + unreadable + alreadyHad} checked)`;
        }
      );
      await loadMediaLibrary();
      alert(
        updated
          ? `Read dimensions for ${updated} file(s).${unreadable ? ` ${unreadable} couldn't be read (unusual/corrupt file).` : ""}`
          : "Everything already had its dimensions recorded."
      );
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("media-scan-duplicates-btn").addEventListener("click", async () => {
    const btn = el("media-scan-duplicates-btn");
    const originalText = btn.textContent;
    btn.textContent = "Scanning…";
    btn.disabled = true;
    try {
      const { hashed } = await runMediaBackfill(
        "/media/backfill-hashes",
        ["hashed", "alreadyHashed"],
        ({ hashed, alreadyHashed }) => {
          btn.textContent = `Scanning… (${hashed + alreadyHashed} checked)`;
        }
      );
      await loadMediaLibrary();
      alert(hashed ? `Hashed ${hashed} file(s). Turn on "Possible duplicates" in the Media Library to see matches.` : "Everything was already hashed.");
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("media-bulk-move-btn").addEventListener("click", async () => {
    const folder = prompt("Move selected files to folder (blank = remove from folder):", "");
    if (folder === null) return;
    try {
      await api("/media/bulk-update", {
        method: "POST",
        body: JSON.stringify({ keys: [...selectedMediaKeys], folder: folder.trim() || null }),
      });
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

  el("media-bulk-tag-btn").addEventListener("click", async () => {
    const tag = (prompt("Add this tag to all selected files:", "") || "").trim();
    if (!tag) return;
    try {
      await api("/media/bulk-update", { method: "POST", body: JSON.stringify({ keys: [...selectedMediaKeys], addTag: tag }) });
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

  // The SEO report already surfaces "missing alt text" sitewide, but fixing
  // N flagged images one at a time (the only path before this) is real
  // friction right after running Site Health. Sets the same string on
  // every selected file — meant for a batch of genuinely-identical images
  // (the button's own title says so), not a shortcut around writing
  // distinct alt text where it actually matters.
  el("media-bulk-alt-btn").addEventListener("click", async () => {
    const altText = prompt("Set this alt text on all selected files:", "");
    if (altText === null) return;
    try {
      await api("/media/bulk-update", { method: "POST", body: JSON.stringify({ keys: [...selectedMediaKeys], altText: altText.trim() }) });
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

  async function loadMediaLibrary() {
    mediaItems = await api("/media");
    selectedMediaKeys = new Set([...selectedMediaKeys].filter((k) => mediaItems.some((m) => m.key === k)));
    const folders = await api("/media/folders").catch(() => []);
    const currentFilter = el("media-folder-filter").value;
    const folderOptionsHtml = folders.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join("");
    // "Uncategorized" — previously there was no way to filter down to just
    // the uploads nobody has ever sorted into a folder ("All folders" shows
    // everything, foldered and not); an upload dropped in without a folder
    // could sit unnoticed indefinitely with no view surfacing it on its own.
    el("media-folder-filter").innerHTML = `<option value="">All folders</option><option value="__uncategorized__">Uncategorized (no folder)</option>${folderOptionsHtml}`;
    el("media-folder-filter").value = currentFilter === "__uncategorized__" || folders.includes(currentFilter) ? currentFilter : "";
    el("media-upload-folder").innerHTML = `<option value="">No folder</option>${folderOptionsHtml}<option value="__new__">+ New folder…</option>`;
    renderMediaGrid();
    updateMediaBulkBar();
  }

  el("media-folder-filter").addEventListener("change", renderMediaGrid);
  el("media-type-filter").addEventListener("change", renderMediaGrid);
  el("media-size-filter").addEventListener("change", renderMediaGrid);
  el("media-search").addEventListener("input", renderMediaGrid);
  el("media-usage-filter").addEventListener("input", renderMediaGrid);

  // ---------- Media saved searches ----------
  let mediaSavedSearches = [];

  async function loadMediaSavedSearches() {
    mediaSavedSearches = await api("/media-saved-searches").catch(() => []);
    el("media-saved-search-select").innerHTML = `<option value="">Saved searches…</option>${mediaSavedSearches
      .map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`)
      .join("")}`;
  }

  el("media-saved-search-select").addEventListener("change", () => {
    const id = Number(el("media-saved-search-select").value);
    const search = mediaSavedSearches.find((s) => s.id === id);
    if (!search) return;
    const f = search.filters;
    el("media-folder-filter").value = f.folder || "";
    el("media-type-filter").value = f.type || "";
    el("media-size-filter").value = f.size || "";
    if (el("media-size-filter").value !== (f.size || "")) el("media-size-filter").value = ""; // a value this version doesn't know
    el("media-search").value = f.search || "";
    el("media-usage-filter").value = f.usage || "";
    el("media-unused-filter").checked = !!f.unused;
    el("media-duplicates-filter").checked = !!f.duplicates;
    renderMediaGrid();
  });

  el("media-save-search-btn").addEventListener("click", async () => {
    const name = (prompt("Name this search:") || "").trim();
    if (!name) return;
    const filters = {
      folder: el("media-folder-filter").value,
      type: el("media-type-filter").value,
      size: el("media-size-filter").value,
      search: el("media-search").value,
      usage: el("media-usage-filter").value,
      unused: el("media-unused-filter").checked,
      duplicates: el("media-duplicates-filter").checked,
    };
    try {
      const { id } = await api("/media-saved-searches", { method: "POST", body: JSON.stringify({ name, filters }) });
      await loadMediaSavedSearches();
      el("media-saved-search-select").value = String(id);
    } catch (err) {
      alert(err.message);
    }
  });

  el("media-delete-search-btn").addEventListener("click", async () => {
    const id = Number(el("media-saved-search-select").value);
    if (!id) {
      alert("Select a saved search to delete first.");
      return;
    }
    try {
      await api(`/media-saved-searches/${id}`, { method: "DELETE" });
      await loadMediaSavedSearches();
    } catch (err) {
      alert(err.message);
    }
  });

  el("media-upload-folder").addEventListener("change", (e) => {
    if (e.target.value !== "__new__") return;
    const name = (prompt("New folder name:") || "").trim();
    if (!name) {
      e.target.value = "";
      return;
    }
    // A real folder named exactly this collides with the sentinel value the
    // "Uncategorized (no folder)" filter option uses (found by a critic
    // pass: the dropdown would render two <option>s sharing one value, and
    // since a <select>'s .value always resolves to the first match, the
    // real folder became permanently unreachable through this filter no
    // matter which row was actually clicked). Rejecting it at the one place
    // a folder name is ever created is simpler and more robust than trying
    // to disambiguate two same-valued options after the fact.
    if (name === "__uncategorized__") {
      alert('"__uncategorized__" is reserved for the built-in "Uncategorized (no folder)" filter — pick a different folder name.');
      e.target.value = "";
      return;
    }
    const opt = document.createElement("option");
    opt.value = name;
    opt.textContent = name;
    opt.selected = true;
    e.target.insertBefore(opt, e.target.lastElementChild);
  });

  const mediaUploadInput = document.createElement("input");
  mediaUploadInput.type = "file";
  mediaUploadInput.accept = "image/png,image/jpeg,image/webp,image/gif,image/svg+xml";
  mediaUploadInput.multiple = true;
  mediaUploadInput.hidden = true;
  el("media-upload-btn").after(mediaUploadInput);
  el("media-upload-btn").addEventListener("click", () => mediaUploadInput.click());
  mediaUploadInput.addEventListener("change", async () => {
    const files = Array.from(mediaUploadInput.files);
    if (!files.length) return;
    const folder = el("media-upload-folder").value === "__new__" ? "" : el("media-upload-folder").value;
    const btn = el("media-upload-btn");
    const originalText = btn.textContent;
    btn.disabled = true;
    try {
      let duplicateCount = 0;
      for (let i = 0; i < files.length; i++) {
        btn.textContent = `Uploading ${i + 1}/${files.length}…`;
        const { duplicateOf } = await uploadFile(files[i], folder);
        if (duplicateOf) duplicateCount++;
      }
      await loadMediaLibrary();
      if (duplicateCount) {
        alert(
          `${duplicateCount} of ${files.length} file(s) look identical to something already in the library — turn on "Possible duplicates" to compare.`
        );
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
      mediaUploadInput.value = "";
    }
  });

  // ---------- New blank image ----------
  // Starts an image editing session from scratch instead of editing an
  // existing upload -- a distinct entry point from "Upload files…" since
  // there's no file to select, just a size to pick first.
  const PE_NEW_DOC_PRESETS = {
    "1920x1080": [1920, 1080],
    "1080x1080": [1080, 1080],
    "1200x630": [1200, 630],
    "1600x900": [1600, 900],
    "800x600": [800, 600],
  };
  const PE_NEW_DOC_DEFAULT_PRESET = "1200x630";
  function resetNewDocModal() {
    el("pe-new-doc-preset").value = PE_NEW_DOC_DEFAULT_PRESET;
    const preset = PE_NEW_DOC_PRESETS[PE_NEW_DOC_DEFAULT_PRESET];
    el("pe-new-doc-width").value = preset[0];
    el("pe-new-doc-height").value = preset[1];
  }
  function closeNewDocSetup() {
    const mediaModal = el("media-modal");
    // This dialog reopens from inside the Media Library, so closing it
    // should return to its trigger. Closing the Library itself should then
    // return focus to the sidebar control that opened it.
    modalFocusReturn.set(mediaModal, el("media-btn"));
    el("pe-new-doc-modal").hidden = true;
    mediaModal.hidden = false;
    requestAnimationFrame(() => el("media-new-blank-btn").focus());
  }
  el("media-new-blank-btn").addEventListener("click", () => {
    resetNewDocModal();
    el("media-modal").hidden = true;
    el("pe-new-doc-modal").hidden = false;
  });
  el("close-pe-new-doc").addEventListener("click", closeNewDocSetup);
  el("cancel-pe-new-doc").addEventListener("click", closeNewDocSetup);
  el("pe-new-doc-preset").addEventListener("change", () => {
    const preset = PE_NEW_DOC_PRESETS[el("pe-new-doc-preset").value];
    if (!preset) return; // "Custom…" -- leave whatever the admin already typed alone
    el("pe-new-doc-width").value = preset[0];
    el("pe-new-doc-height").value = preset[1];
  });
  el("pe-new-doc-create").addEventListener("click", () => {
    const w = Number(el("pe-new-doc-width").value);
    const h = Number(el("pe-new-doc-height").value);
    if (!(w > 0) || !(h > 0)) return alert("Enter a valid width and height first.");
    if (!window.PhotoEditor) return closeNewDocSetup();
    el("pe-new-doc-modal").hidden = true;
    // The Media Library stays closed while editing a new image. Give the
    // editor an explicit return target and place focus on its title.
    modalFocusReturn.set(el("photo-editor-modal"), el("media-btn"));
    window.PhotoEditor.openBlank(w, h);
    requestAnimationFrame(() => initialFocusInModal(el("photo-editor-modal")).focus());
  });

  el("media-bulk-delete-btn").addEventListener("click", async () => {
    if (!selectedMediaKeys.size) return;
    const ok = await confirmTyped(`Permanently delete ${selectedMediaKeys.size} file(s)? This can't be undone.`, { title: "Delete files" });
    if (!ok) return;
    try {
      await api("/media/bulk-delete", { method: "POST", body: JSON.stringify({ keys: [...selectedMediaKeys] }) });
      selectedMediaKeys = new Set();
      await loadMediaLibrary();
    } catch (err) {
      alert(err.message);
    }
  });

  function openMediaModal(pickTarget, append) {
    mediaPickTarget = pickTarget || null;
    mediaPickAppend = !!append;
    el("media-hint").hidden = !mediaPickTarget;
    el("media-modal").hidden = false;
    loadMediaLibrary().catch((err) => alert(err.message));
  }

  function closeMediaModal() {
    el("media-modal").hidden = true;
    mediaPickTarget = null;
    mediaPickAppend = false;
  }

  el("media-btn").addEventListener("click", () => openMediaModal(null));
  el("close-media").addEventListener("click", closeMediaModal);

  // ---------- Redirects ----------
  async function loadRedirects() {
    const redirects = await api("/redirects");
    el("redirects-list").innerHTML =
      redirects
        .map(
          (r) =>
            `<div class="redirect-row" data-id="${r.id}"><span class="redirect-paths">${escapeHtml(r.from_path)} → ${escapeHtml(
              r.to_path
            )}</span><span class="redirect-code">${r.status_code}</span><button type="button" class="delete-redirect" data-id="${
              r.id
            }">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No redirects yet.</p>";

    if (window.bulkList) {
      window.bulkList({
        listId: "redirects-list",
        type: "redirect",
        noun: "redirect",
        rowSelector: ".redirect-row",
        rowIdSelector: ".delete-redirect",
        noUsage: true,
        duplicate: null,
        remove: (id) => api(`/redirects/${id}`, { method: "DELETE" }),
        reload: loadRedirects,
      });
    }
    el("redirects-list")
      .querySelectorAll(".delete-redirect")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Delete this redirect?")) return;
          await api(`/redirects/${btn.dataset.id}`, { method: "DELETE" });
          await loadRedirects();
        });
      });
  }

  el("redirects-btn").addEventListener("click", async () => {
    el("redirects-modal").hidden = false;
    await loadRedirects();
  });
  closeModalOnClick("close-redirects", "redirects-modal");

  el("add-redirect-btn").addEventListener("click", async () => {
    const from_path = el("redirect-from").value.trim();
    const to_path = el("redirect-to").value.trim();
    if (!from_path || !to_path) return alert("Both fields are required.");
    try {
      await api("/redirects", {
        method: "POST",
        body: JSON.stringify({ from_path, to_path, status_code: Number(el("redirect-status").value) }),
      });
      el("redirect-from").value = "";
      el("redirect-to").value = "";
      await loadRedirects();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Trash ----------
  // Every trash row's item already carries deleted_at (the list endpoints
  // are plain SELECT *), it just never made it into the row markup — with
  // no age shown, an old, forgotten trash pile (this local dev DB alone
  // has 7+ stale test pages sitting in it) gives no way to tell what's
  // safe to nuke without opening each one.
  function relativeAge(iso) {
    if (!iso) return "";
    const ms = Date.now() - new Date(iso).getTime();
    const days = Math.floor(ms / 86400000);
    if (days < 1) return "today";
    if (days === 1) return "1 day ago";
    if (days < 30) return `${days} days ago`;
    // Years computed straight from days (365, not 12 * 30 = 360) — the
    // compounded /30 then /12 flooring called a 363-day-old item "1 year
    // ago" nearly a week early.
    if (days < 365) {
      const months = Math.floor(days / 30);
      return `${months} month${months === 1 ? "" : "s"} ago`;
    }
    const years = Math.floor(days / 365);
    return `${years} year${years === 1 ? "" : "s"} ago`;
  }
  function renderTrashList(elId, items, kind, basePath) {
    el(elId).innerHTML =
      items
        .map(
          (item) =>
            `<div class="redirect-row" data-id="${item.id}"><span class="redirect-paths">${escapeHtml(
              item.title
            )} <span class="trash-item-age" title="${escapeHtml(item.deleted_at || "")}">Trashed ${escapeHtml(relativeAge(item.deleted_at))}</span></span><button type="button" class="restore-trash-item" data-id="${item.id}">Restore</button><button type="button" class="danger delete-trash-item" data-id="${item.id}">Delete forever</button></div>`
        )
        .join("") || `<p style='color:var(--text-dim);font-size:0.85rem;'>Nothing trashed.</p>`;

    if (window.bulkList) {
      window.bulkList({
        listId: elId,
        type: kind,
        noun: kind,
        rowSelector: ".redirect-row",
        rowIdSelector: ".restore-trash-item",
        noUsage: true,
        duplicate: null,
        restore: (id) => api(`${basePath}/${id}/restore`, { method: "POST" }),
        remove: (id) => api(`${basePath}/${id}/permanent`, { method: "DELETE" }),
        deleteLabel: "Delete forever",
        confirmDelete: (ids) =>
          window.confirmTyped(`Permanently delete ${ids.length} ${kind}${ids.length === 1 ? "" : "s"}? This can't be undone.`, { title: "Delete forever" }),
        reload: async () => {
          await loadTrash();
          if (kind === "page") await loadPages();
        },
      });
    }
    el(elId)
      .querySelectorAll(".restore-trash-item")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          await api(`${basePath}/${btn.dataset.id}/restore`, { method: "POST" });
          await loadTrash();
          if (kind === "page") await loadPages();
        });
      });
    el(elId)
      .querySelectorAll(".delete-trash-item")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm(`Permanently delete this ${kind}? This can't be undone.`)) return;
          await api(`${basePath}/${btn.dataset.id}/permanent`, { method: "DELETE" });
          await loadTrash();
        });
      });
  }

  async function loadTrash() {
    const [pages, articles, trashedProjects] = await Promise.all([api("/pages/trash"), api("/articles/trash"), api("/projects/trash")]);
    renderTrashList("trash-pages-list", pages, "page", "/pages");
    renderTrashList("trash-articles-list", articles, "article", "/articles");
    renderTrashList("trash-projects-list", trashedProjects, "project", "/projects");
  }

  // "Empty trash" just loops the same per-item /permanent DELETE the
  // "Delete forever" button already calls — no new endpoint needed, just
  // a bulk convenience for a pile that's otherwise one confirm dialog per
  // item to actually clear out.
  document.querySelectorAll(".empty-trash-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.kind;
      const basePath = btn.dataset.basePath;
      const items = await api(`${basePath}/trash`);
      if (!items.length) return alert(`No trashed ${kind}s to delete.`);
      const ok = await confirmTyped(`Permanently delete all ${items.length} trashed ${kind}${items.length === 1 ? "" : "s"}? This can't be undone.`, { title: "Empty trash" });
      if (!ok) return;
      for (const item of items) {
        await api(`${basePath}/${item.id}/permanent`, { method: "DELETE" }).catch(() => {});
      }
      await loadTrash();
    });
  });

  // Same loop-the-existing-per-item-call pattern as "Empty trash" above,
  // just for /restore instead of /permanent — useful after an accidental
  // bulk-trash, or after the age labels above make it obvious a whole
  // section is worth keeping rather than reviewing one item at a time.
  document.querySelectorAll(".restore-all-trash-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const kind = btn.dataset.kind;
      const basePath = btn.dataset.basePath;
      const items = await api(`${basePath}/trash`);
      if (!items.length) return alert(`No trashed ${kind}s to restore.`);
      if (!confirm(`Restore all ${items.length} trashed ${kind}${items.length === 1 ? "" : "s"}?`)) return;
      for (const item of items) {
        await api(`${basePath}/${item.id}/restore`, { method: "POST" }).catch(() => {});
      }
      await loadTrash();
      if (kind === "page") await loadPages();
    });
  });

  el("trash-btn").addEventListener("click", async () => {
    el("trash-modal").hidden = false;
    await loadTrash();
  });
  closeModalOnClick("close-trash", "trash-modal");

  // ---------- Site settings ----------
  // The one uploaded custom font — held here like TTS audio/hero video are
  // (uploaded immediately to R2, but only persisted to the setting when
  // "Save" is actually clicked) rather than saved the instant the file
  // picker resolves.
  let currentCustomFontUrl = null;
  function refreshCustomFontStatus() {
    el("settings-custom-font-status").textContent = currentCustomFontUrl ? "Font uploaded ✓" : "No font uploaded";
    el("settings-custom-font-remove-btn").hidden = !currentCustomFontUrl;
  }
  el("settings-custom-font-upload-btn").addEventListener("click", () => el("settings-custom-font-file").click());
  el("settings-custom-font-file").addEventListener("change", async () => {
    const file = el("settings-custom-font-file").files[0];
    if (!file) return;
    const btn = el("settings-custom-font-upload-btn");
    const originalText = btn.textContent;
    btn.textContent = "Uploading…";
    btn.disabled = true;
    try {
      const res = await fetch("/api/admin/upload-font", { method: "POST", headers: { "Content-Type": file.type }, body: file });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || "Upload failed");
      const { url } = await res.json();
      currentCustomFontUrl = url;
      refreshCustomFontStatus();
      updateFontPreview("settings-font", "settings-font-preview");
      updateFontPreview("settings-heading-font", "settings-heading-font-preview");
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
      el("settings-custom-font-file").value = "";
    }
  });
  el("settings-custom-font-remove-btn").addEventListener("click", () => {
    currentCustomFontUrl = null;
    refreshCustomFontStatus();
    updateFontPreview("settings-font", "settings-font-preview");
    updateFontPreview("settings-heading-font", "settings-heading-font-preview");
  });

  el("site-settings-btn").addEventListener("click", async () => {
    const settings = await api("/settings");
    el("settings-og-image").value = settings.default_og_image || "";
    el("settings-accent").value = settings.theme_accent || "#ff7a45";
    el("settings-bg").value = settings.theme_bg || "#0c0a16";
    el("settings-text").value = settings.theme_text || "#f4eefc";
    el("settings-border").value = settings.theme_border || "#2a2438";
    el("settings-border-auto").checked = !settings.theme_border;
    el("settings-border").disabled = !settings.theme_border;
    el("settings-font").value = settings.theme_font || "";
    el("settings-heading-font").value = settings.theme_heading_font || "";
    el("settings-footer").value = settings.site_footer || "";
    loadFooterEditor(settings.site_footer_links);
    el("settings-custom-head").value = settings.custom_head || "";
    el("settings-webhook-url").value = settings.webhook_url || "";
    el("settings-webhook-on-project-publish").checked = settings.webhook_on_project_publish === "1";
    el("settings-mobile-breakpoint").value = settings.mobile_breakpoint || "";
    el("settings-empty-search").value = settings.empty_search_text || "";
    el("settings-empty-archive").value = settings.empty_archive_text || "";
    el("settings-empty-topics").value = settings.empty_topics_text || "";
    el("settings-maintenance-mode").checked = settings.maintenance_mode === "1";
    el("settings-maintenance-message").value = settings.maintenance_message || "";
    el("settings-custom-font-name").value = settings.custom_font_name || "";
    currentCustomFontUrl = settings.custom_font_url || null;
    loadControlPresets(settings);
    refreshCustomFontStatus();
    el("find-replace-results").innerHTML = "";
    el("find-replace-apply-btn").disabled = true;
    el("settings-modal").hidden = false;
    switchSettingsTab("appearance");
    updateThemeContrastCheck();
    highlightActiveThemePreset();
    updateFontPreview("settings-font", "settings-font-preview");
    updateFontPreview("settings-heading-font", "settings-heading-font-preview");
    loadActivityLog().catch(() => {});
    loadErrors().catch(() => {});
    loadScheduledBackups().catch(() => {});
    loadWebhookDeliveries().catch(() => {});
  });
  closeModalOnClick("close-settings", "settings-modal");

  // ---------- Site settings tabs ----------
  function switchSettingsTab(name) {
    document.querySelectorAll(".settings-tab").forEach((btn) => {
      const active = btn.dataset.panel === name;
      btn.classList.toggle("is-active", active);
      btn.setAttribute("aria-selected", active ? "true" : "false");
    });
    document.querySelectorAll(".settings-panel").forEach((panel) => {
      panel.hidden = panel.dataset.panel !== name;
    });
  }
  document.querySelectorAll(".settings-tab").forEach((btn) => {
    btn.addEventListener("click", () => switchSettingsTab(btn.dataset.panel));
  });
  el("save-settings").addEventListener("click", async () => {
    try {
      await api("/settings", {
        method: "PUT",
        body: JSON.stringify({
          default_og_image: el("settings-og-image").value,
          theme_accent: el("settings-accent").value,
          theme_bg: el("settings-bg").value,
          theme_text: el("settings-text").value,
          theme_border: el("settings-border-auto").checked ? "" : el("settings-border").value,
          theme_font: el("settings-font").value,
          theme_heading_font: el("settings-heading-font").value,
          site_footer: el("settings-footer").value,
          site_footer_links: footerLayoutJson(),
          custom_head: el("settings-custom-head").value,
          webhook_url: el("settings-webhook-url").value,
          webhook_on_project_publish: el("settings-webhook-on-project-publish").checked ? "1" : "",
          mobile_breakpoint: el("settings-mobile-breakpoint").value,
          empty_search_text: el("settings-empty-search").value,
          empty_archive_text: el("settings-empty-archive").value,
          empty_topics_text: el("settings-empty-topics").value,
          maintenance_mode: el("settings-maintenance-mode").checked ? "1" : "",
          maintenance_message: el("settings-maintenance-message").value,
          custom_font_name: el("settings-custom-font-name").value,
          custom_font_url: currentCustomFontUrl || "",
          ...Object.fromEntries(Object.keys(ADMIN_CONTROL_PRESETS).map((key) => [key, controlPresetValues[key] || ""])),
        }),
      });
      el("settings-modal").hidden = true;
      api("/settings").then(applySiteThemeToAdmin).catch(() => {});
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Footer layout (link columns + social links) ----------
  // Edited as "Label | url" lines; the server normalises and drops anything that isn't a site path or http(s)/mailto/tel link.
  let footerIgnoredLines = 0;
  function parseLinkLines(text) {
    const links = [];
    for (const line of String(text || "").split("\n")) {
      if (!line.trim()) continue;
      const i = line.lastIndexOf("|");
      const label = i === -1 ? "" : line.slice(0, i).trim();
      const url = i === -1 ? "" : line.slice(i + 1).trim();
      const okUrl = /^(\/(?!\/)|https?:\/\/|mailto:|tel:)/i.test(url) && !/[\u0000-\u0020\u007f\\]/.test(url) && url.length <= 500;
      if (label && label.length <= 60 && okUrl && links.length < 8) links.push({ label, url });
      else footerIgnoredLines++;
    }
    return links;
  }
  const linkLines = (links) => (links || []).map((l) => `${l.label} | ${l.url}`).join("\n");
  function loadFooterEditor(raw) {
    let data = {};
    try {
      data = raw ? JSON.parse(raw) : {};
    } catch (e) {}
    const cols = data.columns || [];
    for (let n = 1; n <= 3; n++) {
      const c = cols[n - 1] || {};
      el(`settings-footer-col-title-${n}`).value = c.title || "";
      el(`settings-footer-col-links-${n}`).value = linkLines(c.links);
    }
    el("settings-footer-social").value = linkLines(data.social);
    el("settings-footer-note").textContent = "";
  }
  function footerLayoutJson() {
    footerIgnoredLines = 0;
    const columns = [1, 2, 3].map((n) => ({ title: el(`settings-footer-col-title-${n}`).value.trim(), links: parseLinkLines(el(`settings-footer-col-links-${n}`).value) }));
    const social = parseLinkLines(el("settings-footer-social").value);
    el("settings-footer-note").textContent = footerIgnoredLines
      ? `${footerIgnoredLines} line${footerIgnoredLines === 1 ? " was" : "s were"} left out: each needs "Label | /page" or a full https:// address, a label up to 60 characters, and at most 8 links per list.`
      : "";
    if (footerIgnoredLines) alert(el("settings-footer-note").textContent);
    return columns.some((c) => c.links.length) || social.length ? JSON.stringify({ columns, social }) : "";
  }

  // ---------- Theme contrast checker ----------
  // WCAG relative-luminance contrast ratio, same formula used to audit
  // every fixed color already in style.css — surfaced live here so a
  // custom theme color can't accidentally ship unreadable.
  function relLuminance(hex) {
    const h = hex.replace("#", "");
    const r = parseInt(h.slice(0, 2), 16) / 255;
    const g = parseInt(h.slice(2, 4), 16) / 255;
    const b = parseInt(h.slice(4, 6), 16) / 255;
    const f = (c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  }
  function contrastRatio(hexA, hexB) {
    const l1 = relLuminance(hexA);
    const l2 = relLuminance(hexB);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
  }
  // Mirrors worker/render.js's FONT_STACKS exactly — duplicated rather than
  // shared since this admin script is a plain <script>, not an ES module
  // that could import from the worker bundle. Lets an admin see what
  // "Serif"/"Monospace"/etc. actually look like without saving, closing
  // the modal, and opening a real page in a new tab just to check.
  const ADMIN_FONT_STACKS = {
    sans: `-apple-system, BlinkMacSystemFont, 'Segoe UI', Inter, Roboto, sans-serif`,
    serif: `Georgia, 'Times New Roman', serif`,
    mono: `'Courier New', Courier, monospace`,
    rounded: `'Trebuchet MS', Verdana, sans-serif`,
  };
  let customFontPreviewFaceInjected = null; // tracks which URL is currently injected
  // Body and Heading share the empty-string sentinel but it means two
  // different things: for Body it's "use the system default"; for Heading
  // it's "same as body", which needs to actually resolve to whatever the
  // Body select currently has (recursing once) rather than clearing to a
  // fixed default -- otherwise picking a non-default body font left the
  // heading preview silently showing a plain sans stack instead of matching,
  // even though the real site's CSS does inherit the body font here.
  function resolveFontStack(selectId) {
    const value = el(selectId).value;
    if (!value) return selectId === "settings-heading-font" ? resolveFontStack("settings-font") : "";
    if (value === "custom") {
      if (!currentCustomFontUrl) return "sans-serif";
      if (customFontPreviewFaceInjected !== currentCustomFontUrl) {
        const styleEl = document.createElement("style");
        // JSON.stringify, not escapeHtml -- this is a CSS string inside
        // .textContent (never parsed as HTML), so it needs CSS/JS-style
        // quote escaping, not HTML-entity escaping.
        styleEl.textContent = `@font-face{font-family:"AdminCustomFontPreview";src:url(${JSON.stringify(currentCustomFontUrl)});}`;
        document.head.appendChild(styleEl);
        customFontPreviewFaceInjected = currentCustomFontUrl;
      }
      return `"AdminCustomFontPreview", sans-serif`;
    }
    return ADMIN_FONT_STACKS[value] || "";
  }
  function updateFontPreview(selectId, previewId) {
    el(previewId).style.fontFamily = resolveFontStack(selectId);
  }
  el("settings-font").addEventListener("change", () => {
    updateFontPreview("settings-font", "settings-font-preview");
    // The heading preview may currently be resolving to "same as body" --
    // a body change needs to be reflected there too, not just its own box.
    updateFontPreview("settings-heading-font", "settings-heading-font-preview");
  });
  el("settings-heading-font").addEventListener("change", () => updateFontPreview("settings-heading-font", "settings-heading-font-preview"));

  function updateThemeContrastCheck() {
    const bg = el("settings-bg").value;
    const text = el("settings-text").value;
    const accent = el("settings-accent").value;
    const pairs = [
      ["Text vs background", contrastRatio(text, bg), 4.5],
      ["Accent vs background", contrastRatio(accent, bg), 3],
    ];
    el("theme-contrast-check").innerHTML = pairs
      .map(([label, ratio, threshold]) => {
        const pass = ratio >= threshold;
        return `<span class="${pass ? "contrast-pass" : "contrast-fail"}">${escapeHtml(label)}: ${ratio.toFixed(
          2
        )}:1 — ${pass ? "passes" : "fails"} WCAG AA (needs ${threshold}:1)</span>`;
      })
      .join("");
  }
  ["settings-bg", "settings-text", "settings-accent"].forEach((id) => el(id).addEventListener("input", updateThemeContrastCheck));

  // Quick-pick starting points for the four fields above, rather than
  // requiring four independent color pickers to land on a combination that
  // actually looks intentional together. Applying one just fills the same
  // inputs Save already reads -- it's a starting point, not a separate
  // locked-in mode, so editing any field afterward works exactly as before.
  const THEME_PRESETS = {
    coral: { bg: "#0c0a16", text: "#f4eefc", border: "#2a2438", accent: "#ff7a45" },
    ocean: { bg: "#0a1420", text: "#e8f4fa", border: "#1e3a4f", accent: "#3fb8e8" },
    forest: { bg: "#0a140f", text: "#e8f5ec", border: "#1e3a2a", accent: "#4ade80" },
    sunset: { bg: "#1a0a14", text: "#f7e8f0", border: "#3a1e2f", accent: "#ff4d94" },
    mono: { bg: "#121212", text: "#f0f0f0", border: "#333333", accent: "#d8d8d8" },
  };
  function highlightActiveThemePreset() {
    const current = {
      bg: el("settings-bg").value,
      text: el("settings-text").value,
      border: el("settings-border").value,
      accent: el("settings-accent").value,
    };
    el("theme-preset-row")
      .querySelectorAll(".theme-preset-btn")
      .forEach((btn) => {
        const p = THEME_PRESETS[btn.dataset.preset];
        const matches = p && p.bg === current.bg && p.text === current.text && p.border === current.border && p.accent === current.accent;
        btn.classList.toggle("is-active", !!matches);
        btn.setAttribute("aria-selected", String(!!matches));
      });
  }
  el("theme-preset-row")
    .querySelectorAll(".theme-preset-btn")
    .forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = THEME_PRESETS[btn.dataset.preset];
        if (!p) return;
        el("settings-bg").value = p.bg;
        el("settings-text").value = p.text;
        el("settings-border").value = p.border;
        el("settings-border-auto").checked = false;
        el("settings-border").disabled = false;
        el("settings-accent").value = p.accent;
        updateThemeContrastCheck();
        highlightActiveThemePreset();
      });
    });
  ["settings-bg", "settings-text", "settings-border", "settings-accent"].forEach((id) =>
    el(id).addEventListener("input", highlightActiveThemePreset)
  );
  el("settings-border-auto").addEventListener("change", () => {
    el("settings-border").disabled = el("settings-border-auto").checked;
  });

  // ---------- Buttons & controls ----------
  // Mirrors CONTROL_PRESETS in worker/render.js (the public site's copy) --
  // duplicated for the same reason as ADMIN_FONT_STACKS above. The first
  // option in each group is what style.css uses when nothing is saved.
  const ADMIN_CONTROL_PRESETS = {
    control_shape: {
      pill: { "--control-radius": "999px" },
      rounded: { "--control-radius": "12px" },
      soft: { "--control-radius": "6px" },
      square: { "--control-radius": "0px" },
    },
    control_size: {
      regular: { "--control-pad-y": "0.6em", "--control-pad-x": "1.25em" },
      compact: { "--control-pad-y": "0.45em", "--control-pad-x": "0.95em" },
      roomy: { "--control-pad-y": "0.8em", "--control-pad-x": "1.6em" },
    },
    control_outline: {
      thin: { "--control-border-width": "1px" },
      bold: { "--control-border-width": "2px" },
    },
    field_shape: {
      soft: { "--field-radius": "8px" },
      rounded: { "--field-radius": "12px" },
      square: { "--field-radius": "2px" },
    },
    card_shape: {
      rounded: { "--card-radius": "14px" },
      round: { "--card-radius": "22px" },
      soft: { "--card-radius": "8px" },
      square: { "--card-radius": "2px" },
    },
    space_scale: {
      compact: { "--space-1": "4px", "--space-2": "8px", "--space-3": "12px", "--space-4": "16px", "--space-5": "24px", "--space-6": "32px" },
      roomy: { "--space-1": "6px", "--space-2": "12px", "--space-3": "18px", "--space-4": "24px", "--space-5": "36px", "--space-6": "48px" },
    },
    shadow_strength: {
      soft: {
        "--shadow-sm": "0 1px 2px rgba(0,0,0,0.18)",
        "--shadow-md": "0 4px 12px rgba(0,0,0,0.22)",
        "--shadow-lg": "0 12px 32px rgba(0,0,0,0.28)",
      },
      strong: {
        "--shadow-sm": "0 2px 4px rgba(0,0,0,0.32)",
        "--shadow-md": "0 8px 20px rgba(0,0,0,0.4)",
        "--shadow-lg": "0 18px 44px rgba(0,0,0,0.5)",
      },
    },
  };
  const controlPresetValues = {};
  function applyControlPresets(target, values) {
    for (const [key, options] of Object.entries(ADMIN_CONTROL_PRESETS)) {
      const vars = options[values[key]] || Object.values(options)[0];
      for (const [name, value] of Object.entries(vars)) target.style.setProperty(name, value);
    }
  }
  function syncControlPresetButtons() {
    document.querySelectorAll(".control-preset").forEach((group) => {
      const key = group.dataset.setting;
      const current = controlPresetValues[key] || Object.keys(ADMIN_CONTROL_PRESETS[key])[0];
      group.querySelectorAll("button[data-value]").forEach((btn) => {
        btn.setAttribute("aria-pressed", String(btn.dataset.value === current));
      });
    });
    applyControlPresets(el("control-preview"), controlPresetValues);
  }
  document.querySelectorAll(".control-preset").forEach((group) => {
    group.addEventListener("click", (e) => {
      const btn = e.target.closest("button[data-value]");
      if (!btn) return;
      controlPresetValues[group.dataset.setting] = btn.dataset.value;
      syncControlPresetButtons();
    });
  });
  function loadControlPresets(settings) {
    for (const key of Object.keys(ADMIN_CONTROL_PRESETS)) controlPresetValues[key] = settings[key] || "";
    syncControlPresetButtons();
  }

  // The admin is a static page, so it never received the site's saved
  // theme -- it always showed the built-in violet palette and pill buttons
  // even when the public site was amber with square ones. Applying the same
  // colors (plus the shades the public shell derives from them) and the
  // control presets here keeps both halves of the site one character.
  function applySiteThemeToAdmin(settings) {
    maintenanceOn = !!settings && settings.maintenance_mode === "1";
    refreshStatusStrip();
    const hex = (v) => (/^#[0-9a-f]{6}$/i.test(v || "") ? v : "");
    const accent = hex(settings.theme_accent);
    const bg = hex(settings.theme_bg);
    const text = hex(settings.theme_text);
    const border = hex(settings.theme_border);
    const colors = [];
    if (accent) {
      colors.push(`--accent:${accent}`, "--accent-secondary:color-mix(in oklch, var(--accent), white 38%)");
      colors.push("--accent-dim:color-mix(in oklch, var(--accent) 78%, var(--text))");
      colors.push(`--on-accent:${relLuminance(accent) > 0.189 ? "#0c0a16" : "#ffffff"}`);
    }
    if (bg) colors.push(`--bg:${bg}`);
    if (text) colors.push(`--text:${text}`);
    if (border) colors.push(`--border:${border}`);
    if (bg || text) {
      colors.push("--bg-elevated:color-mix(in oklch, var(--bg), var(--text) 6%)");
      colors.push("--text-dim:color-mix(in oklch, var(--text) 68%, var(--bg))");
      if (!border) colors.push("--border:color-mix(in oklch, var(--bg), var(--text) 16%)");
    }
    const controls = [];
    for (const [key, options] of Object.entries(ADMIN_CONTROL_PRESETS)) {
      const vars = options[settings[key]];
      if (vars) for (const [name, value] of Object.entries(vars)) controls.push(`${name}:${value}`);
    }
    let styleEl = document.getElementById("admin-site-theme");
    if (!styleEl) {
      styleEl = document.createElement("style");
      styleEl.id = "admin-site-theme";
      document.head.appendChild(styleEl);
    }
    // Colors only for the dark theme, same as the public site: the light
    // theme keeps its own fixed palette so it always stays readable.
    // Light theme: same accent hue, darkened until it passes 4.5:1 as text
    // on the light background -- mirrors accentForLightTheme() in
    // worker/render.js so the admin and public light themes match.
    let light = "";
    if (accent) {
      const rgb = [1, 3, 5].map((i) => parseInt(accent.slice(i, i + 2), 16));
      let dark = "#000000";
      for (let t = 0; t <= 1.0001; t += 0.04) {
        const c = "#" + rgb.map((v) => Math.round(v * (1 - t)).toString(16).padStart(2, "0")).join("");
        if (contrastRatio(c, "#fffaf5") >= 4.5) {
          dark = c;
          break;
        }
      }
      light = `:root[data-theme="light"]{--accent:${dark};--accent-secondary:color-mix(in oklch, var(--accent), black 22%);--accent-dim:color-mix(in oklch, var(--accent) 75%, var(--text));--on-accent:${
        relLuminance(dark) > 0.189 ? "#0c0a16" : "#ffffff"
      };--text:#1d1a17;--text-dim:color-mix(in oklch, var(--text) 72%, var(--bg));--bg-elevated:color-mix(in oklch, var(--bg), var(--accent) 7%);--border:color-mix(in oklch, var(--bg), var(--text) 14%)}`;
    }
    styleEl.textContent =
      (colors.length ? `:root:not([data-theme="light"]){${colors.join(";")}}` : "") +
      light +
      (controls.length ? `:root{${controls.join(";")}}` : "");
  }
  window.applySiteThemeToAdmin = applySiteThemeToAdmin;

  el("check-links-btn").addEventListener("click", async () => {
    const btn = el("check-links-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const results = await api("/link-check");
      el("link-check-results").innerHTML =
        results
          .map(
            (r) =>
              `<div class="link-check-row ${r.ok === false ? "broken" : r.ok ? "ok" : ""}"><span class="link-check-url">${escapeHtml(
                r.url
              )}</span><span class="link-check-source">${escapeHtml(r.source)}</span><span class="link-check-status">${escapeHtml(
                r.status
              )}</span></div>`
          )
          .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No links found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("check-orphans-btn").addEventListener("click", async () => {
    const btn = el("check-orphans-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const { pages: orphanPages, articles: orphanArticles, projects: orphanProjects } = await api("/orphan-content");
      const rows = [
        ...orphanPages.map(
          (p) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(p.title)}</span><span class="link-check-source">/${escapeHtml(
              p.slug
            )}</span><span class="link-check-status">Page — no links, not in nav</span></div>`
        ),
        ...orphanArticles.map(
          (a) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(a.title)}</span><span class="link-check-source">/random/${escapeHtml(
              a.slug
            )}</span><span class="link-check-status">Article — no internal links</span></div>`
        ),
        ...orphanProjects.map(
          (p) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(p.title)}</span><span class="link-check-source">/projects/${escapeHtml(
              p.slug
            )}</span><span class="link-check-status">Project — no internal links</span></div>`
        ),
      ];
      el("orphan-content-results").innerHTML = rows.join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No orphans found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("check-content-health-btn").addEventListener("click", async () => {
    const btn = el("check-content-health-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const { emptyPages, staleArticles, staleProjects } = await api("/content-health");
      const rows = [
        ...emptyPages.map(
          (p) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(p.title)}</span><span class="link-check-source">/${escapeHtml(
              p.slug
            )}</span><span class="link-check-status">Empty page</span></div>`
        ),
        ...staleArticles.map(
          (a) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(a.title)}</span><span class="link-check-source">/random/${escapeHtml(
              a.slug
            )}</span><span class="link-check-status">Not touched since ${escapeHtml((a.updated_at || "").slice(0, 10))}</span></div>`
        ),
        ...staleProjects.map(
          (p) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(p.title)}</span><span class="link-check-source">/projects/${escapeHtml(
              p.slug
            )}</span><span class="link-check-status">Not touched since ${escapeHtml((p.updated_at || "").slice(0, 10))}</span></div>`
        ),
      ];
      el("content-health-results").innerHTML = rows.join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No issues found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("check-content-integrity-btn").addEventListener("click", async () => {
    const btn = el("check-content-integrity-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const { brokenBlockRefs, danglingRelations } = await api("/content-integrity");
      const rows = [
        ...brokenBlockRefs.map(
          (r) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(r.pageTitle)}</span><span class="link-check-source">/${escapeHtml(
              r.pageSlug
            )}</span><span class="link-check-status">${escapeHtml(r.blockType)} block references a deleted item</span></div>`
        ),
        ...danglingRelations.map(
          (r) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(r.title)}</span><span class="link-check-source">/projects/${escapeHtml(
              r.slug
            )}</span><span class="link-check-status">${escapeHtml(r.field)} lists a deleted item</span></div>`
        ),
      ];
      el("content-integrity-results").innerHTML = rows.join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No issues found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // ---------- Topic pages (per-tag /topics/:tag customization) ----------
  let topicPagesData = [];
  let editingTopicTag = null;

  async function loadTopicPages() {
    topicPagesData = await api("/topic-meta");
    el("topic-pages-list").innerHTML =
      topicPagesData
        .map(
          (t) =>
            `<div class="redirect-row"><span class="redirect-paths">${escapeHtml(t.tag)} <span class="topic-page-count">(${t.count})</span>${
              // An orphaned row's last published article/project lost the
              // tag (unpublished/deleted/retagged) without ever clearing
              // its saved description/share-image — /topics/:tag still
              // renders that stale content into the page <head> even
              // though nothing links here anymore. Flagged distinctly so
              // it doesn't read as just another customized, in-use topic.
              t.orphaned
                ? ` <span class="lock-badge diagnostic-error" title="No published content carries this tag anymore, but its custom description/share image is still saved and still rendered on /topics/${escapeHtml(
                    t.tag
                  )} — edit it and save with both fields blank to clear it">Orphaned</span>`
                : t.description || t.og_image
                ? ` <span class="lock-badge" title="Has a custom intro or share image">Customized</span>`
                : ""
            }</span>${
              t.orphaned
                ? ""
                : `<button type="button" class="usage-tag-btn" data-tag="${escapeHtml(
                    t.tag
                  )}" title="See every article/project tagged with this, including drafts">Usage</button>`
            }<button type="button" class="edit-topic-meta-btn" data-tag="${escapeHtml(t.tag)}">Edit</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No tags in use yet.</p>";
    el("topic-pages-list")
      .querySelectorAll(".edit-topic-meta-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => openTopicMetaEdit(btn.dataset.tag));
      });
    el("topic-pages-list")
      .querySelectorAll(".usage-tag-btn")
      .forEach((btn) => {
        btn.addEventListener("click", () => window.showContentUsage("tag", btn.dataset.tag, btn.dataset.tag));
      });
  }

  function openTopicMetaEdit(tag) {
    const t = topicPagesData.find((x) => x.tag === tag);
    if (!t) return;
    editingTopicTag = tag;
    el("topic-meta-edit-title").textContent = `Edit topic page: ${tag}`;
    el("topic-meta-description").value = t.description || "";
    el("topic-meta-og-image").value = t.og_image || "";
    el("topic-meta-edit-modal").hidden = false;
  }

  el("topic-pages-btn").addEventListener("click", async () => {
    el("topic-pages-modal").hidden = false;
    await loadTopicPages().catch((err) => alert(err.message));
  });
  closeModalOnClick("close-topic-pages", "topic-pages-modal");
  closeModalOnClick("close-topic-meta-edit", "topic-meta-edit-modal");

  el("save-topic-meta").addEventListener("click", async () => {
    if (!editingTopicTag) return;
    try {
      await api("/topic-meta", {
        method: "PUT",
        body: JSON.stringify({
          tag: editingTopicTag,
          description: el("topic-meta-description").value.trim(),
          og_image: el("topic-meta-og-image").value.trim(),
        }),
      });
      el("topic-meta-edit-modal").hidden = true;
      await loadTopicPages();
    } catch (err) {
      alert(err.message);
    }
  });

  // ---------- Custom animation (keyframe) editor ----------
  // A block's style.animation can be "custom" instead of one of the 5
  // fixed presets, backed by style.customKeyframes (an array of
  // {offset, opacity?, x?, y?, scale?, rotate?} stops) plus
  // animationDuration/animationEasing -- see worker/render.js's
  // customAnimationCss() for how this gets turned into a real @keyframes
  // rule reusing the exact same data-animate/.is-visible/reduced-motion
  // mechanism the 5 presets already use. This modal is the one place all
  // of that gets authored together, with a live preview, rather than
  // several more always-visible fields in the style panel that do
  // nothing for every other animation choice.
  let keyframeEditorState = null; // { block, onSaved } while the modal is open
  let keyframeEditorRows = [];

  // Mirrors worker/render.js's customKeyframeTransform() -- same fixed
  // translate/scale/rotate property set, same fixed stacking order, so
  // what the live preview shows here is what the real generated CSS will
  // actually do, not an approximation of it.
  function keyframeRowTransform(row) {
    const x = Number(row.x) || 0;
    const y = Number(row.y) || 0;
    const scale = row.scale === "" || row.scale === undefined || row.scale === null || Number.isNaN(Number(row.scale)) ? 1 : Number(row.scale);
    const rotate = Number(row.rotate) || 0;
    return `translate(${x}px,${y}px) scale(${scale}) rotate(${rotate}deg)`;
  }

  function renderKeyframeRows() {
    el("keyframe-rows").innerHTML = keyframeEditorRows
      .map(
        (row, i) => `<div class="keyframe-row" data-index="${i}">
          <label>Offset % <input type="number" class="keyframe-field kf-offset" min="0" max="100" value="${escapeHtml(row.offset ?? "")}"></label>
          <label>Opacity <input type="number" class="keyframe-field kf-opacity" min="0" max="1" step="0.05" value="${escapeHtml(row.opacity ?? "")}"></label>
          <label>X (px) <input type="number" class="keyframe-field kf-x" value="${escapeHtml(row.x ?? "")}"></label>
          <label>Y (px) <input type="number" class="keyframe-field kf-y" value="${escapeHtml(row.y ?? "")}"></label>
          <label>Scale <input type="number" class="keyframe-field kf-scale" step="0.05" value="${escapeHtml(row.scale ?? "")}"></label>
          <label>Rotate (deg) <input type="number" class="keyframe-field kf-rotate" value="${escapeHtml(row.rotate ?? "")}"></label>
          <button type="button" class="keyframe-remove-row" title="Remove this keyframe">×</button>
        </div>`
      )
      .join("");
    el("keyframe-rows")
      .querySelectorAll(".keyframe-row")
      .forEach((rowEl) => {
        const i = Number(rowEl.dataset.index);
        const readNum = (cls) => {
          const v = rowEl.querySelector(cls).value;
          return v === "" ? undefined : Number(v);
        };
        rowEl.querySelectorAll("input").forEach((inp) => {
          inp.addEventListener("input", () => {
            keyframeEditorRows[i] = {
              offset: readNum(".kf-offset"),
              opacity: readNum(".kf-opacity"),
              x: readNum(".kf-x"),
              y: readNum(".kf-y"),
              scale: readNum(".kf-scale"),
              rotate: readNum(".kf-rotate"),
            };
          });
        });
        rowEl.querySelector(".keyframe-remove-row").addEventListener("click", () => {
          if (keyframeEditorRows.length <= 2) return alert("An animation needs at least 2 keyframes (a start and an end).");
          keyframeEditorRows.splice(i, 1);
          renderKeyframeRows();
        });
      });
  }

  function openKeyframeEditor(block, onSaved) {
    keyframeEditorState = { block, onSaved };
    const existing = Array.isArray(block.style.customKeyframes) ? block.style.customKeyframes : null;
    keyframeEditorRows = existing && existing.length >= 2 ? existing.map((s) => ({ ...s })) : [
      { offset: 0, opacity: 0, y: 20 },
      { offset: 100, opacity: 1, y: 0 },
    ];
    renderKeyframeRows();
    el("keyframe-duration").value = Number.isFinite(block.style.animationDuration) ? block.style.animationDuration : 600;
    el("keyframe-easing").value = block.style.animationEasing || "ease";
    el("keyframe-editor-modal").hidden = false;
  }

  el("keyframe-add-row").addEventListener("click", () => {
    keyframeEditorRows.push({ offset: 100, opacity: 1 });
    renderKeyframeRows();
  });

  const KEYFRAME_EASING_CSS = {
    linear: "linear",
    ease: "ease",
    "ease-in": "ease-in",
    "ease-out": "ease-out",
    "ease-in-out": "ease-in-out",
    overshoot: "cubic-bezier(0.34, 1.56, 0.64, 1)",
  };
  el("keyframe-preview-play").addEventListener("click", () => {
    const box = el("keyframe-preview-box");
    const sorted = [...keyframeEditorRows].filter((r) => Number.isFinite(r.offset)).sort((a, b) => a.offset - b.offset);
    if (sorted.length < 2) return alert("Add at least 2 keyframes with a valid offset first.");
    const waapiKeyframes = sorted.map((r) => {
      const kf = { offset: Math.max(0, Math.min(100, r.offset)) / 100 };
      if (Number.isFinite(r.opacity)) kf.opacity = Math.max(0, Math.min(1, r.opacity));
      kf.transform = keyframeRowTransform(r);
      return kf;
    });
    const duration = Number(el("keyframe-duration").value) || 600;
    const easing = KEYFRAME_EASING_CSS[el("keyframe-easing").value] || "ease";
    box.getAnimations().forEach((a) => a.cancel()); // stop any still-running preview before starting a fresh one
    box.animate(waapiKeyframes, { duration, easing, fill: "both" });
  });

  closeModalOnClick("close-keyframe-editor", "keyframe-editor-modal");
  closeModalOnClick("cancel-keyframe-editor", "keyframe-editor-modal");

  el("save-keyframe-editor").addEventListener("click", () => {
    if (!keyframeEditorState) return;
    const valid = keyframeEditorRows.filter((r) => Number.isFinite(r.offset) && r.offset >= 0 && r.offset <= 100);
    if (valid.length < 2) return alert("Add at least 2 keyframes, each with an offset between 0 and 100, before saving.");
    const { block, onSaved } = keyframeEditorState;
    block.style.customKeyframes = valid;
    block.style.animationDuration = Number(el("keyframe-duration").value) || 600;
    block.style.animationEasing = el("keyframe-easing").value || "ease";
    el("keyframe-editor-modal").hidden = true;
    keyframeEditorState = null;
    onSaved();
  });

  // ---------- Site Health (aggregates the 6 site-wide checks below) ----------
  // Each check already has its own "Run report" button further down this
  // modal, returning its own shape of results — this doesn't replace those
  // (still useful individually), it just runs all five at once and merges
  // them into one severity-sorted list so nothing needs checking one at a
  // time. Diagnostics (further up the "Tools" menu) isn't included here —
  // it only scans whichever single page is currently open in the editor,
  // not the whole site, so it doesn't fit the same "run everywhere" model.
  // Wording shared by the Site Health overview and the SEO Report list below it.
  // Cut by user-perceived character, so an emoji, a flag or a combining sequence is never split
  // just before the ellipsis (falls back to code points where Intl.Segmenter is missing).
  const seoShort = (text, max) => {
    let chars;
    try {
      chars = Array.from(new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(text), (s) => s.segment);
    } catch (e) {
      chars = Array.from(text);
    }
    return chars.length > max ? chars.slice(0, max - 1).join("") + "…" : text;
  };
  // Links in the overview only ever go to a same-site path or an http(s) address.
  const seoSafeHref = (u) => (/^\/(?![\/\\])[^\\\t\n\r]*$/.test(String(u)) || /^https?:\/\/[^\s\\]+$/i.test(String(u)) ? u : "#");
  const seoWeakAltStatus = (m) => {
    const file = (m.url || "").split("/").pop();
    const where = m.slug === null ? m.where : `${m.where}${file ? ` (${seoShort(file, 32)})` : ""}`;
    return m.long
      ? `${where}: alt text is ${m.alt.length} characters; screen readers handle about 125 well, so consider moving the detail into a caption`
      : `${where}: the alt text "${seoShort(m.alt, 60)}" needs work. ${m.reason}. ${
          m.slug === null ? "Edit it in the Media Library, under the image's Details." : "Write a short description of what the image shows."
        }`;
  };
  const seoLongTitleStatus = (m) =>
    `Title is ${m.length} characters${m.type === "page" ? "" : ' including the " · Dominick" the site adds'}; search results cut it off around 60. Shorten it.`;
  const seoDescriptionLengthStatus = (m) =>
    `${m.type === "project" ? "Summary" : "Meta description"} is ${m.length} characters (${m.problem === "short" ? "a bit thin: aim for 50 to 160" : "search results cut it off at about 160"})`;
  el("run-site-health-btn").addEventListener("click", async () => {
    const btn = el("run-site-health-btn");
    const originalText = btn.textContent;
    btn.textContent = "Running…";
    btn.disabled = true;
    const summaryEl = el("site-health-summary");
    const resultsEl = el("site-health-results");
    try {
      const [linkResults, orphanData, healthData, seoData, a11yIssues, integrityData] = await Promise.all([
        api("/link-check"),
        api("/orphan-content"),
        api("/content-health"),
        api("/seo-report"),
        api("/accessibility-report"),
        api("/content-integrity"),
      ]);
      const typePath = { article: "/random/", project: "/projects/", page: "/", simulation: "/simulation/" };
      const pagePath = (slug) => `/${slug === "home" ? "" : slug}`;
      // Severity is just a sort key, not a formal classification — 3 for
      // things a visitor would actually notice (broken links, missing alt
      // text, an empty page), 2 for things that hurt discoverability/SEO
      // without visibly breaking anything, 1 for the mildest, easy-to-defer
      // findings (a missing share image, content nobody's touched in a while).
      const issues = [
        ...linkResults.filter((r) => r.ok === false).map((r) => ({ severity: 3, check: "Link Checker", title: r.source, url: r.url, status: `Broken link: ${r.status}` })),
        ...a11yIssues.map((i) => ({ severity: 3, check: "Accessibility", title: i.pageTitle, url: pagePath(i.pageSlug), status: i.issue })),
        ...healthData.emptyPages.map((p) => ({ severity: 3, check: "Content Health", title: p.title, url: pagePath(p.slug), status: "Empty page" })),
        ...seoData.missingAlt.map((m) => ({ severity: 3, check: "SEO", title: m.title, url: m.url, status: "Missing alt text" })),
        ...integrityData.brokenBlockRefs.map((r) => ({
          severity: 3,
          check: "Content Integrity",
          title: r.pageTitle,
          url: pagePath(r.pageSlug),
          status: `${r.blockType} block references a deleted item`,
        })),
        ...integrityData.danglingRelations.map((r) => ({
          severity: 2,
          check: "Content Integrity",
          title: r.title,
          url: `/projects/${r.slug}`,
          status: `${r.field} lists a deleted item`,
        })),
        ...seoData.duplicateTitles.map((owners) => ({
          severity: 2,
          check: "SEO",
          title: owners[0].title,
          url: typePath[owners[0].type] + (owners[0].slug === "home" ? "" : owners[0].slug),
          status: `Duplicate title (${owners.length}×)`,
        })),
        ...seoData.missingMeta.map((p) => ({ severity: 2, check: "SEO", title: p.title, url: pagePath(p.slug), status: "No meta description" })),
        ...seoData.duplicateMeta.map((owners) => ({
          severity: 2,
          check: "SEO",
          title: owners[0].title,
          url: pagePath(owners[0].slug),
          status: `Duplicate meta description (${owners.length}×)`,
        })),
        ...seoData.sitemapCanonicalMismatch.map((m) => ({
          severity: 2,
          check: "SEO",
          title: m.title,
          url: typePath[m.type] + (m.slug === "home" ? "" : m.slug),
          status: `Canonical URL points elsewhere but still in sitemap.xml (→ ${m.canonicalUrl})`,
        })),
        ...orphanData.pages.map((p) => ({ severity: 2, check: "Orphan", title: p.title, url: pagePath(p.slug), status: "Page — no links, not in nav" })),
        ...orphanData.articles.map((a) => ({ severity: 2, check: "Orphan", title: a.title, url: `/random/${a.slug}`, status: "Article — no internal links" })),
        ...orphanData.projects.map((p) => ({ severity: 2, check: "Orphan", title: p.title, url: `/projects/${p.slug}`, status: "Project — no internal links" })),
        ...healthData.staleArticles.map((a) => ({ severity: 1, check: "Content Health", title: a.title, url: `/random/${a.slug}`, status: `Not touched since ${(a.updated_at || "").slice(0, 10)}` })),
        ...healthData.staleProjects.map((p) => ({ severity: 1, check: "Content Health", title: p.title, url: `/projects/${p.slug}`, status: `Not touched since ${(p.updated_at || "").slice(0, 10)}` })),
        ...seoData.missingOgImage.map((m) => ({
          severity: 1,
          check: "SEO",
          title: m.title,
          url: typePath[m.type] + (m.slug === "home" ? "" : m.slug),
          status: "No social-share image",
        })),
        ...(seoData.weakAlt || []).map((m) => ({
          severity: m.long ? 1 : 2,
          check: "SEO",
          title: m.title,
          url: m.slug ? pagePath(m.slug) : m.url,
          status: seoWeakAltStatus(m),
        })),
        ...(seoData.longTitles || []).map((m) => ({
          severity: 1,
          check: "SEO",
          title: m.title,
          url: typePath[m.type] + (m.slug === "home" ? "" : m.slug),
          status: seoLongTitleStatus(m),
        })),
        ...(seoData.descriptionLength || []).map((m) => ({
          severity: 1,
          check: "SEO",
          title: m.title,
          url: typePath[m.type] + (m.slug === "home" ? "" : m.slug),
          status: seoDescriptionLengthStatus(m),
        })),
      ];
      issues.sort((a, b) => b.severity - a.severity || a.title.localeCompare(b.title));
      summaryEl.textContent = issues.length ? `${issues.length} issue${issues.length === 1 ? "" : "s"} found across 6 checks.` : "No issues found across any check.";
      resultsEl.innerHTML = issues
        .map(
          (i) =>
            `<div class="link-check-row${i.severity === 3 ? " broken" : ""}"><span class="lock-badge">${escapeHtml(
              i.check
            )}</span><a class="link-check-url" href="${escapeHtml(seoSafeHref(i.url))}" target="_blank" rel="noopener">${escapeHtml(
              i.title
            )}</a><span class="link-check-source">${escapeHtml(i.url)}</span><span class="link-check-status">${escapeHtml(i.status)}</span></div>`
        )
        .join("");
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("check-seo-btn").addEventListener("click", async () => {
    const btn = el("check-seo-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const { missingMeta, missingAlt, missingOgImage, duplicateTitles, duplicateMeta, sitemapCanonicalMismatch, weakAlt = [], longTitles = [], descriptionLength = [] } = await api("/seo-report");
      const typePath = { article: "/random/", project: "/projects/", page: "/", simulation: "/simulation/" };
      const rows = [
        ...missingMeta.map(
          (p) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(p.title)}</span><span class="link-check-source">/${escapeHtml(
              p.slug === "home" ? "" : p.slug
            )}</span><span class="link-check-status">No meta description</span></div>`
        ),
        ...missingAlt.map(
          (m) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(m.title)}</span><span class="link-check-source">${escapeHtml(
              m.url
            )}</span><span class="link-check-status">Missing alt text</span></div>`
        ),
        ...missingOgImage.map(
          (m) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(m.title)}</span><span class="link-check-source">${escapeHtml(
              typePath[m.type] + m.slug
            )}</span><span class="link-check-status">No social-share image</span></div>`
        ),
        ...duplicateTitles.map(
          (owners) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(owners[0].title)}</span><span class="link-check-source">${owners
              .map((o) => escapeHtml(typePath[o.type] + (o.slug === "home" ? "" : o.slug)))
              .join(", ")}</span><span class="link-check-status">Duplicate title (${owners.length}×)</span></div>`
        ),
        ...duplicateMeta.map(
          (owners) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(owners[0].title)}</span><span class="link-check-source">${owners
              .map((o) => escapeHtml(o.slug === "home" ? "/" : `/${o.slug}`))
              .join(", ")}</span><span class="link-check-status">Duplicate meta description (${owners.length}×)</span></div>`
        ),
        ...sitemapCanonicalMismatch.map(
          (m) =>
            `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(m.title)}</span><span class="link-check-source">${escapeHtml(
              typePath[m.type] + (m.slug === "home" ? "" : m.slug)
            )}</span><span class="link-check-status">Canonical URL points elsewhere but still in sitemap.xml (→ ${escapeHtml(m.canonicalUrl)})</span></div>`
        ),
        ...weakAlt.map(
          (m) =>
            `<div class="link-check-row${m.long ? "" : " broken"}"><span class="link-check-url">${escapeHtml(m.title)}</span><span class="link-check-source">${escapeHtml(
              m.url
            )}</span><span class="link-check-status">${escapeHtml(seoWeakAltStatus(m))}</span></div>`
        ),
        ...longTitles.map(
          (m) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(m.title)}</span><span class="link-check-source">${escapeHtml(
              typePath[m.type] + (m.slug === "home" ? "" : m.slug)
            )}</span><span class="link-check-status">${escapeHtml(seoLongTitleStatus(m))}</span></div>`
        ),
        ...descriptionLength.map(
          (m) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(m.title)}</span><span class="link-check-source">${escapeHtml(
              typePath[m.type] + (m.slug === "home" ? "" : m.slug)
            )}</span><span class="link-check-status">${escapeHtml(seoDescriptionLengthStatus(m))}</span></div>`
        ),
      ];
      el("seo-report-results").innerHTML = rows.join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No issues found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  el("check-accessibility-btn").addEventListener("click", async () => {
    const btn = el("check-accessibility-btn");
    const originalText = btn.textContent;
    btn.textContent = "Checking…";
    btn.disabled = true;
    try {
      const issues = await api("/accessibility-report");
      el("accessibility-report-results").innerHTML =
        issues
          .map(
            (i) =>
              `<div class="link-check-row broken"><span class="link-check-url">${escapeHtml(i.pageTitle)}</span><span class="link-check-source">/${escapeHtml(
                i.pageSlug === "home" ? "" : i.pageSlug
              )}</span><span class="link-check-status">${escapeHtml(i.issue)}</span></div>`
          )
          .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No issues found.</p>";
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // ---------- Find & replace ----------
  function findReplaceResultLabel(r) {
    if (r.kind === "block") return `${blockLabel(r.blockType)} block on page "${r.pageTitle}"`;
    if (r.kind === "project") return `Project "${r.projectTitle}" (${r.fields.join(", ")})`;
    return `Article "${r.articleTitle}" (${r.fields.join(", ")})`;
  }

  async function runFindReplaceUi(apply) {
    const find = el("find-replace-find").value;
    if (!find) return alert("Enter text to find.");
    const replace = el("find-replace-replace").value;
    if (apply && !confirm(`Replace every match of "${find}" with "${replace}"? Each affected page/article is snapshotted first, so this is undoable via History.`)) {
      return;
    }
    const btn = apply ? el("find-replace-apply-btn") : el("find-replace-preview-btn");
    const originalText = btn.textContent;
    btn.textContent = apply ? "Applying…" : "Searching…";
    btn.disabled = true;
    try {
      const { results } = await api("/find-replace", { method: "POST", body: JSON.stringify({ find, replace, apply }) });
      el("find-replace-results").innerHTML =
        results.map((r) => `<div class="link-check-row">${escapeHtml(findReplaceResultLabel(r))}</div>`).join("") ||
        "<p style='color:var(--text-dim);font-size:0.85rem;'>No matches.</p>";
      el("find-replace-apply-btn").disabled = apply || !results.length;
      if (apply) {
        articles = await api("/articles");
        renderArticlesList();
        if (currentPage) await loadBlocks();
      }
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = apply ? el("find-replace-apply-btn").disabled : false;
    }
  }
  el("find-replace-preview-btn").addEventListener("click", () => runFindReplaceUi(false));
  el("find-replace-apply-btn").addEventListener("click", () => runFindReplaceUi(true));

  // ---------- Activity log ----------
  function activityLabel(a) {
    const verb = { "create": "Created", "update": "Updated", "trash": "Trashed", "restore": "Restored", "delete-forever": "Permanently deleted",
      "duplicate": "Duplicated", "publish": "Published", "unpublish": "Unpublished", "upload": "Uploaded", "delete": "Deleted",
      "import": "Restored backup", "find-replace": "Find & replace", "restore-revision": "Restored a revision",
      "login": "Logged in", "login_failed": "Failed login attempt", "logout": "Logged out" }[a.action] || a.action;
    if (a.entity_type === "session") return `${verb}${a.detail ? ` (${a.detail})` : ""}`;
    return `${verb} ${a.entity_type}${a.entity_label ? `: ${a.entity_label}` : ""}`;
  }

  let lastActivityItems = [];
  const SECURITY_ACTIONS = new Set(["login", "login_failed", "logout"]);

  function renderActivityLog() {
    const securityOnly = el("activity-security-only-filter").checked;
    const items = securityOnly ? lastActivityItems.filter((a) => SECURITY_ACTIONS.has(a.action)) : lastActivityItems;
    el("activity-log-list").innerHTML =
      items
        .map(
          (a) =>
            `<div class="link-check-row${a.action === "login_failed" ? " broken" : ""}"><span class="link-check-url">${escapeHtml(activityLabel(a))}</span><span class="link-check-source">${escapeHtml(
              new Date(a.created_at.replace(" ", "T") + "Z").toLocaleString()
            )}</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>Nothing logged yet.</p>";
  }

  async function loadActivityLog() {
    lastActivityItems = await api("/activity?limit=100");
    renderActivityLog();
  }
  el("load-activity-btn").addEventListener("click", () => loadActivityLog().catch((err) => alert(err.message)));
  el("activity-security-only-filter").addEventListener("change", renderActivityLog);

  // ---------- Webhook delivery history ----------
  // ---------- TTS audio narration upload ----------
  // Stored as a plain URL string (like og_image), not a media-library
  // entry — deliberately kept out of the general Media Library since it's
  // a single narration file per article/project, not a reusable asset.
  let currentArticleTtsAudio = null;
  let currentProjectTtsAudio = null;
  function wireTtsAudio(kind, getCurrent, setCurrent) {
    const fileInput = el(`${kind}-tts-audio-file`);
    const uploadBtn = el(`${kind}-tts-audio-upload-btn`);
    const removeBtn = el(`${kind}-tts-audio-remove-btn`);
    const preview = el(`${kind}-tts-audio-preview`);
    function refresh() {
      const url = getCurrent();
      preview.hidden = !url;
      removeBtn.hidden = !url;
      if (url) preview.src = url;
    }
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Uploading…";
      try {
        const res = await uploadAudioFile(file);
        setCurrent(res.url);
        refresh();
      } catch (err) {
        alert(err.message);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload audio…";
        fileInput.value = "";
      }
    });
    removeBtn.addEventListener("click", () => {
      setCurrent(null);
      refresh();
    });
    return refresh;
  }
  const refreshArticleTtsAudio = wireTtsAudio(
    "article",
    () => currentArticleTtsAudio,
    (v) => (currentArticleTtsAudio = v)
  );
  const refreshProjectTtsAudio = wireTtsAudio(
    "project",
    () => currentProjectTtsAudio,
    (v) => (currentProjectTtsAudio = v)
  );

  // ---------- Project hero video upload ----------
  // Same "plain URL string, not a Media Library entry" reasoning as the TTS
  // audio above, and the same upload/preview/remove shape — just its own
  // small function rather than folding video into wireTtsAudio, since the
  // upload endpoint, accepted file types, and preview element tag differ.
  let currentProjectHeroVideo = null;
  function wireHeroVideo() {
    const fileInput = el("project-hero-video-file");
    const uploadBtn = el("project-hero-video-upload-btn");
    const removeBtn = el("project-hero-video-remove-btn");
    const preview = el("project-hero-video-preview");
    function refresh() {
      preview.hidden = !currentProjectHeroVideo;
      removeBtn.hidden = !currentProjectHeroVideo;
      if (currentProjectHeroVideo) preview.src = currentProjectHeroVideo;
    }
    uploadBtn.addEventListener("click", () => fileInput.click());
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files[0];
      if (!file) return;
      uploadBtn.disabled = true;
      uploadBtn.textContent = "Uploading…";
      try {
        const res = await uploadVideoFile(file);
        currentProjectHeroVideo = res.url;
        refresh();
      } catch (err) {
        alert(err.message);
      } finally {
        uploadBtn.disabled = false;
        uploadBtn.textContent = "Upload video…";
        fileInput.value = "";
      }
    });
    removeBtn.addEventListener("click", () => {
      currentProjectHeroVideo = null;
      refresh();
    });
    return refresh;
  }
  const refreshProjectHeroVideo = wireHeroVideo();

  // ---------- Shareable preview links ----------
  function previewLinkUrl(kind, slug, token) {
    const path = kind === "article" ? `/random/${slug}` : `/projects/${slug}`;
    return `${location.origin}${path}?preview_token=${token}`;
  }

  function wirePreviewLinks(kind, getId, getSlug) {
    const listEl = el(`preview-links-list-${kind}`);
    async function loadList() {
      const id = getId();
      if (!id) {
        listEl.innerHTML = "";
        return;
      }
      try {
        const links = await api(`/preview-links?contentType=${kind}&contentId=${id}`);
        listEl.innerHTML = links.length
          ? links
              .map((l) => {
                const active = !l.revoked_at && new Date(l.expires_at) > new Date();
                const url = previewLinkUrl(kind, getSlug(), l.token);
                const status = active ? "Active" : l.revoked_at ? "Revoked" : "Expired";
                return `<div class="preview-link-row"><span class="preview-link-status">${status}</span>${
                  active
                    ? `<span class="preview-link-url">${escapeHtml(url)}</span> <button type="button" class="copy-preview-link-btn" data-url="${escapeHtml(
                        url
                      )}">Copy</button> <button type="button" class="revoke-preview-link-btn" data-id="${l.id}">Revoke</button>`
                    : `<span class="preview-link-url">${escapeHtml(url)}</span>`
                }</div>`;
              })
              .join("")
          : "<p style='color:var(--text-dim);font-size:0.85rem;'>No preview links yet.</p>";
        listEl.querySelectorAll(".revoke-preview-link-btn").forEach((btn) => {
          btn.addEventListener("click", async () => {
            await api(`/preview-links/${btn.dataset.id}/revoke`, { method: "POST" });
            loadList();
          });
        });
        listEl.querySelectorAll(".copy-preview-link-btn").forEach((btn) => {
          btn.addEventListener("click", () => {
            navigator.clipboard
              .writeText(btn.dataset.url)
              .then(() => {
                btn.textContent = "Copied!";
                setTimeout(() => (btn.textContent = "Copy"), 1500);
              })
              .catch(() => {});
          });
        });
      } catch (err) {
        listEl.innerHTML = "";
      }
    }
    el(`share-preview-${kind}-btn`).addEventListener("click", () => {
      const panel = el(`preview-links-panel-${kind}`);
      panel.hidden = !panel.hidden;
      if (!panel.hidden) loadList();
    });
    el(`create-preview-link-${kind}-btn`).addEventListener("click", async () => {
      const id = getId();
      if (!id) return;
      const hours = Number(el(`preview-link-hours-${kind}`).value);
      try {
        await api("/preview-links", { method: "POST", body: JSON.stringify({ contentType: kind, contentId: id, hours }) });
        loadList();
      } catch (err) {
        alert(err.message);
      }
    });
  }
  wirePreviewLinks("article", () => currentArticleId, () => el("article-slug").value);
  wirePreviewLinks("project", () => currentProjectId, () => el("project-slug").value);

  async function loadWebhookDeliveries() {
    const items = await api("/webhook-deliveries");
    el("webhook-deliveries-list").innerHTML =
      items
        .map(
          (d) =>
            // Multiple webhook URLs can now be configured, so the same
            // publish fires one row per URL — the destination is shown
            // alongside the timestamp so those rows are distinguishable.
            `<div class="link-check-row ${d.status === "failed" ? "broken" : "ok"}"><span class="link-check-url">${escapeHtml(
              d.payload?.title || d.url
            )}</span><span class="link-check-source">${escapeHtml(d.url)} · ${escapeHtml(
              new Date(d.created_at.replace(" ", "T") + "Z").toLocaleString()
            )}</span><span class="link-check-status">${escapeHtml(d.status === "failed" ? d.error || "Failed" : "Delivered")}${
              d.status === "failed" ? ` <button type="button" class="retry-webhook-btn" data-id="${d.id}">Retry</button>` : ""
            }</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No webhook deliveries yet.</p>";
    el("webhook-deliveries-list")
      .querySelectorAll(".retry-webhook-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          btn.textContent = "Retrying…";
          btn.disabled = true;
          try {
            await api(`/webhook-deliveries/${btn.dataset.id}/retry`, { method: "POST" });
            await loadWebhookDeliveries();
          } catch (err) {
            alert(err.message);
          }
        });
      });
  }
  el("load-webhook-deliveries-btn").addEventListener("click", () => loadWebhookDeliveries().catch((err) => alert(err.message)));

  // ---------- Error log ----------
  async function loadErrors() {
    const items = await api("/errors?limit=50");
    el("error-log-list").innerHTML =
      items
        .map(
          (e) =>
            `<div class="link-check-row broken" title="${escapeHtml(e.stack || "")}"><span class="link-check-url">${escapeHtml(
              e.message
            )}${e.path ? ` (${escapeHtml(e.path)})` : ""}</span><span class="link-check-source">${escapeHtml(
              new Date(e.created_at.replace(" ", "T") + "Z").toLocaleString()
            )}</span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No errors logged — good sign.</p>";
  }
  el("load-errors-btn").addEventListener("click", () => loadErrors().catch((err) => alert(err.message)));

  // ---------- Scheduled backups ----------
  async function loadScheduledBackups() {
    const [items, status] = await Promise.all([api("/scheduled-backups"), api("/backup-status")]);
    el("scheduled-backups-list").innerHTML =
      items
        .map(
          (b) =>
            `<div class="link-check-row"><span class="link-check-url">${escapeHtml(b.key.replace("backups/", ""))}</span><span class="link-check-source">${formatBytes(
              b.size
            )}</span><button type="button" class="view-backup-contents-btn" data-key="${escapeHtml(
              b.key
            )}">View contents</button> <button type="button" class="verify-backup-btn" data-key="${escapeHtml(
              b.key
            )}">Verify integrity</button> <button type="button" class="download-backup-btn" data-key="${escapeHtml(
              b.key
            )}">Download</button> <button type="button" class="danger restore-backup-btn" data-key="${escapeHtml(
              b.key
            )}">Restore this backup…</button> <span class="backup-verify-result"></span></div><div class="backup-contents" data-key="${escapeHtml(
              b.key
            )}" hidden></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No backups yet.</p>";
    el("scheduled-backups-list")
      .querySelectorAll(".view-backup-contents-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const panel = btn.closest(".link-check-row").nextElementSibling;
          if (!panel.hidden) {
            panel.hidden = true;
            return;
          }
          try {
            const contents = await api(`/scheduled-backups-contents?key=${encodeURIComponent(btn.dataset.key)}`);
            const rows = Object.entries(contents.counts)
              .map(([table, count]) => `<span class="backup-contents-row">${escapeHtml(table)}: ${count}</span>`)
              .join("");
            panel.innerHTML = `<div class="backup-contents-meta">Exported ${escapeHtml(new Date(contents.exported_at).toLocaleString())} (backup format v${contents.version})</div>${rows}`;
            panel.hidden = false;
          } catch (err) {
            alert(err.message);
          }
        });
      });
    // Re-hashes the file as it sits in R2 right now against the checksum
    // stored when it was written — catches corruption/truncation before
    // it's discovered mid-restore, rather than trusting the file blindly.
    el("scheduled-backups-list")
      .querySelectorAll(".verify-backup-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const resultEl = btn.nextElementSibling;
          const originalText = btn.textContent;
          btn.textContent = "Verifying…";
          btn.disabled = true;
          try {
            const result = await api(`/scheduled-backups-verify?key=${encodeURIComponent(btn.dataset.key)}`);
            if (!result.hasChecksum) {
              resultEl.innerHTML = `<span class="contrast-fail">No stored checksum (backup predates this check)</span>`;
            } else if (result.ok) {
              resultEl.innerHTML = `<span class="contrast-pass">✓ Verified intact</span>`;
            } else {
              resultEl.innerHTML = `<span class="contrast-fail">⚠ Checksum mismatch — this file may be corrupted</span>`;
            }
          } catch (err) {
            resultEl.textContent = err.message;
          } finally {
            btn.textContent = originalText;
            btn.disabled = false;
          }
        });
      });
    // Same fetch-then-blob-download pattern the existing on-demand
    // "Download backup" (/export) button already uses, for a specific
    // historical R2-stored snapshot instead of always "right now."
    el("scheduled-backups-list")
      .querySelectorAll(".download-backup-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          const res = await fetch(`/api/admin/scheduled-backups-download?key=${encodeURIComponent(btn.dataset.key)}`);
          if (!res.ok) {
            alert("Download failed.");
            return;
          }
          const blob = await res.blob();
          const url = URL.createObjectURL(blob);
          const a = document.createElement("a");
          a.href = url;
          a.download = btn.dataset.key.replace("backups/", "");
          document.body.appendChild(a);
          a.click();
          a.remove();
          URL.revokeObjectURL(url);
        });
      });
    // A scheduled backup could previously be inspected and verified but
    // never actually restored — this reuses the exact same destructive
    // confirm wording as the manual "Restore from file…" flow, since the
    // consequence (replace everything) is identical either way.
    el("scheduled-backups-list")
      .querySelectorAll(".restore-backup-btn")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (
            !confirm(
              "This will REPLACE every page, block, article, and setting with what's in this backup. This can't be undone. Continue?"
            )
          ) {
            return;
          }
          const originalText = btn.textContent;
          btn.textContent = "Restoring…";
          btn.disabled = true;
          try {
            await api("/scheduled-backups-restore", { method: "POST", body: JSON.stringify({ key: btn.dataset.key }) });
            alert("Restored. Reloading…");
            location.reload();
          } catch (err) {
            alert("Restore failed: " + err.message);
            btn.textContent = originalText;
            btn.disabled = false;
          }
        });
      });
    const statusEl = el("scheduled-backup-status");
    if (status.lastError) {
      statusEl.innerHTML = `<span class="contrast-fail">⚠ Last backup attempt failed: ${escapeHtml(status.lastError)}</span>`;
    } else if (status.lastAt) {
      statusEl.innerHTML = `<span class="contrast-pass">✓ Last backup succeeded ${escapeHtml(new Date(status.lastAt).toLocaleString())}</span>`;
    } else {
      statusEl.innerHTML = "";
    }
  }
  el("run-backup-now-btn").addEventListener("click", async () => {
    const btn = el("run-backup-now-btn");
    const originalText = btn.textContent;
    btn.textContent = "Running…";
    btn.disabled = true;
    try {
      await api("/scheduled-backups/run", { method: "POST" });
      await loadScheduledBackups();
    } catch (err) {
      alert(err.message);
    } finally {
      btn.textContent = originalText;
      btn.disabled = false;
    }
  });

  // ---------- Storage usage ----------
  async function loadStorageUsage() {
    const usage = await api("/storage-usage");
    const dbSizeText = usage.d1.sizeBytes != null ? formatBytes(usage.d1.sizeBytes) : "not available";
    el("storage-usage-summary").innerHTML =
      `<div class="backup-contents-meta">R2 total: ${formatBytes(usage.r2.totalBytes)} across ${usage.r2.totalCount} object(s) · D1 database: ${dbSizeText}</div>`;
    const r2Rows = usage.r2.byPrefix
      .map((p) => `<div class="link-check-row"><span class="link-check-url">${escapeHtml(p.label)}</span><span class="link-check-source">${formatBytes(p.bytes)} (${p.count})</span></div>`)
      .join("");
    const rowCountRows = Object.entries(usage.d1.rowCounts)
      .map(([table, count]) => `<span class="backup-contents-row">${escapeHtml(table)}: ${count}</span>`)
      .join("");
    el("storage-usage-list").innerHTML = `${r2Rows}<div class="backup-contents-meta">Row counts — ${rowCountRows}</div>`;
  }
  el("load-storage-usage-btn").addEventListener("click", () => loadStorageUsage().catch((err) => alert(err.message)));

  // ---------- Revisions ----------
  // A simple word-level LCS diff — fine for typical article lengths. Capped
  // so a huge body can't hang the tab computing an O(m*n) table.
  function diffWords(oldText, newText) {
    const oldWords = String(oldText || "").split(/(\s+)/);
    const newWords = String(newText || "").split(/(\s+)/);
    const m = oldWords.length;
    const n = newWords.length;
    if (m * n > 400000) return null;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
    for (let i = m - 1; i >= 0; i--) {
      for (let j = n - 1; j >= 0; j--) {
        dp[i][j] = oldWords[i] === newWords[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
      }
    }
    const result = [];
    let i = 0, j = 0;
    while (i < m && j < n) {
      if (oldWords[i] === newWords[j]) {
        result.push({ type: "same", text: oldWords[i] });
        i++; j++;
      } else if (dp[i + 1][j] >= dp[i][j + 1]) {
        result.push({ type: "del", text: oldWords[i] });
        i++;
      } else {
        result.push({ type: "add", text: newWords[j] });
        j++;
      }
    }
    while (i < m) { result.push({ type: "del", text: oldWords[i] }); i++; }
    while (j < n) { result.push({ type: "add", text: newWords[j] }); j++; }
    return result;
  }

  function diffWordsHtml(oldText, newText) {
    const diff = diffWords(oldText, newText);
    if (!diff) return "<p style='color:var(--text-dim);font-size:0.85rem;'>Too large to diff word-by-word — showing versions side by side isn't available here; restore to see the full old version.</p>";
    return `<p class="revision-diff-text">${diff
      .map((d) => {
        const text = escapeHtml(d.text);
        if (d.type === "add") return `<ins>${text}</ins>`;
        if (d.type === "del") return `<del>${text}</del>`;
        return text;
      })
      .join("")}</p>`;
  }

  function normBlockForDiff(b) {
    return {
      id: b.id,
      type: b.type,
      content: typeof b.content === "string" ? b.content : JSON.stringify(b.content || {}),
      style: typeof b.style === "string" ? b.style : JSON.stringify(b.style || {}),
      col: b.col, col_span: b.col_span, row: b.row, row_span: b.row_span,
    };
  }

  function diffPageBlocksHtml(oldBlocks, newBlocks) {
    const oldNorm = oldBlocks.map(normBlockForDiff);
    const newNorm = newBlocks.map(normBlockForDiff);
    const oldById = new Map(oldNorm.map((b) => [b.id, b]));
    const newById = new Map(newNorm.map((b) => [b.id, b]));
    const rows = [];
    newNorm.forEach((b) => {
      if (!oldById.has(b.id)) rows.push({ status: "Added since", type: b.type, id: b.id, restorable: false });
    });
    oldNorm.forEach((b) => {
      const nb = newById.get(b.id);
      if (!nb) {
        rows.push({ status: "Removed since (restoring brings it back)", type: b.type, id: b.id, restorable: true });
      } else if (
        b.content !== nb.content ||
        b.style !== nb.style ||
        b.col !== nb.col ||
        b.col_span !== nb.col_span ||
        b.row !== nb.row ||
        b.row_span !== nb.row_span
      ) {
        rows.push({ status: "Changed since", type: b.type, id: b.id, restorable: true });
      }
    });
    if (!rows.length) return "<p style='color:var(--text-dim);font-size:0.85rem;'>No differences from the current page.</p>";
    return `<ul class="revision-diff-blocks">${rows
      .map(
        (r) =>
          `<li><strong>${escapeHtml(blockLabel(r.type))}</strong> — ${escapeHtml(r.status)} this version${
            r.restorable
              ? ` <button type="button" class="restore-revision-block" data-block-id="${r.id}">Restore just this block</button>`
              : ""
          }</li>`
      )
      .join("")}</ul>`;
  }

  async function showRevisionDiff(kind, entityId, revisionId) {
    const rev = await api(`/revisions/${revisionId}`);
    el("revisions-list").hidden = true;
    el("revisions-diff").hidden = false;
    if (kind === "article") {
      const current = articles.find((a) => a.id === entityId);
      el("revisions-diff-body").innerHTML = diffWordsHtml(rev.snapshot.body, current ? current.body : "");
    } else {
      el("revisions-diff-body").innerHTML = diffPageBlocksHtml(rev.snapshot, blocks);
      el("revisions-diff-body")
        .querySelectorAll(".restore-revision-block")
        .forEach((btn) => {
          btn.addEventListener("click", async () => {
            if (!confirm("Restore just this block to how it was in this revision? The current page is saved first, so this can be undone too.")) return;
            try {
              await api(`/revisions/${revisionId}/restore-block`, {
                method: "POST",
                body: JSON.stringify({ entity_id: entityId, block_id: Number(btn.dataset.blockId) }),
              });
              el("revisions-modal").hidden = true;
              await loadBlocks();
            } catch (err) {
              alert(err.message);
            }
          });
        });
    }
  }

  el("revisions-diff-back").addEventListener("click", () => {
    el("revisions-diff").hidden = true;
    el("revisions-list").hidden = false;
  });

  async function openRevisions(kind, entityId) {
    el("revisions-modal").hidden = false;
    el("revisions-diff").hidden = true;
    el("revisions-list").hidden = false;
    const revisions = await api(`/revisions?kind=${kind}&id=${entityId}`);
    el("revisions-list").innerHTML =
      revisions
        .map(
          (r) =>
            `<div class="revision-row"><span><span class="revision-row-time">${new Date(
              r.created_at.replace(" ", "T") + "Z"
            ).toLocaleString()}</span>${
              r.label ? `<span class="revision-row-label">${escapeHtml(r.label)}</span>` : ""
            }</span><span class="revision-row-actions"><button type="button" class="compare-revision" data-id="${
              r.id
            }">Compare</button><button type="button" class="restore-revision" data-id="${
              r.id
            }">Restore</button></span></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No history yet.</p>";

    el("revisions-list")
      .querySelectorAll(".compare-revision")
      .forEach((btn) => {
        btn.addEventListener("click", () => showRevisionDiff(kind, entityId, Number(btn.dataset.id)));
      });

    el("revisions-list")
      .querySelectorAll(".restore-revision")
      .forEach((btn) => {
        btn.addEventListener("click", async () => {
          if (!confirm("Restore this version? The current state is saved first, so this can be undone too.")) return;
          try {
            await api(`/revisions/${btn.dataset.id}/restore`, {
              method: "POST",
              body: JSON.stringify({ kind, entity_id: entityId }),
            });
            el("revisions-modal").hidden = true;
            if (kind === "page") {
              await loadBlocks();
            } else {
              articles = await api("/articles");
              const a = articles.find((x) => x.id === entityId);
              if (a) populateArticleForm(a);
              renderArticlesList();
            }
          } catch (err) {
            alert(err.message);
          }
        });
      });
  }

  closeModalOnClick("close-revisions", "revisions-modal");
  el("page-history-btn").addEventListener("click", () => {
    if (currentPage) openRevisions("page", currentPage.id);
  });
  el("article-history-btn").addEventListener("click", () => {
    if (currentArticleId) openRevisions("article", currentArticleId);
  });

  // ---------- Contextual help for the big editors ----------
  // A "?" in each editor's header opens a short, plain list of what the editor can do and
  // the keys it answers to. The text lives here so it is one place to keep true.
  const EDITOR_HELP = {
    photo: {
      title: "Photo editor help",
      sections: [
        ["Moving around", ["Zoom with the + and - buttons, the keys + - 0 (fit) and 1 (actual pixels), or Ctrl+wheel.", "Pan with the Pan tool, by holding Space, or with the middle mouse button."]],
        ["Making changes", ["Undo and redo with Ctrl+Z and Ctrl+Shift+Z; Reset goes back to the original.", "Selections (rectangle, ellipse, lasso, polygon) limit where a tool works; Ctrl+D deselects.", "Layers and masks live in the Layers panel: add, duplicate, merge down, flatten, reorder."]],
        ["Saving", ["Save as new file keeps the original untouched.", "Overwrite original replaces the file at the same address; the old bytes are kept as a file version you can restore from the Media Library."]],
        ["Faster", ["Ctrl+K lists the tools and actions while this editor is open."]],
      ],
    },
    song: {
      title: "Song builder help",
      sections: [
        ["Building", ["Drum tracks use the step sequencer; the melody uses the piano roll; both can be muted or hidden.", "Play / stop previews the loop. The melody can be transposed up or down."]],
        ["Working on several songs", ["Open another song from the tab row. Switching autosaves a saved song; an unsaved draft asks before it is discarded."]],
        ["Publishing", ["Songs go onto a page with the Song block, and onto a project under Related songs."]],
        ["Faster", ["Ctrl+K has a Play / stop command while this builder is open."]],
      ],
    },
    simulation: {
      title: "Simulation builder help",
      sections: [
        ["Building a circuit", ["Add parts from the Add part list and connect their pins with wires; parts can be rotated and mirrored.", "Preview: power on runs the circuit; LEDs, meters and logic gates respond live."]],
        ["Saving and publishing", ["Save keeps your draft private. Publish and Unpublish are in the Simulations list (open Simulations from the sidebar): Publish makes the current version public at /simulation/<id> and in the Simulation block, and Unpublish takes it down without losing the draft."]],
        ["Checkpoints", ["Checkpoints are named snapshots you can return to while experimenting."]],
      ],
    },
    scan: {
      title: "3D scan editor help",
      sections: [
        ["Adding a scan", ["A name and a GLB or GLTF model file are required."]],
        ["Using it", ["Add a scan to a page with the 3D scan block, or attach it to a project under Related scans.", "Usage in the Scans list shows where a scan is used before you delete it."]],
      ],
    },
  };
  let editorHelpReturnFocus = null;
  function openEditorHelp(key, trigger) {
    const help = EDITOR_HELP[key];
    if (!help) return;
    el("editor-help-title").textContent = help.title;
    el("editor-help-body").innerHTML = help.sections
      .map(([heading, items]) => `<h2>${escapeHtml(heading)}</h2><ul>${items.map((t) => `<li>${escapeHtml(t)}</li>`).join("")}</ul>`)
      .join("");
    editorHelpReturnFocus = trigger || document.activeElement;
    el("editor-help-modal").hidden = false;
    el("close-editor-help").focus();
  }
  function closeEditorHelp() {
    el("editor-help-modal").hidden = true;
    if (editorHelpReturnFocus && typeof editorHelpReturnFocus.focus === "function") editorHelpReturnFocus.focus();
    editorHelpReturnFocus = null;
  }
  document.querySelectorAll(".editor-help-btn").forEach((btn) => btn.addEventListener("click", () => openEditorHelp(btn.dataset.help, btn)));
  el("close-editor-help").addEventListener("click", closeEditorHelp);
  el("editor-help-modal").addEventListener("click", (e) => {
    if (e.target === el("editor-help-modal")) closeEditorHelp();
  });
  el("editor-help-modal").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeEditorHelp();
    }
  });

  // ---------- Command palette (Ctrl/Cmd+K) ----------
  let commandItems = [];
  let commandActiveIndex = 0;

  // "Where is this setting?" — a plain-language index over every control
  // in the (now 7-tab) Site Settings modal, so "breakpoint" or "footer"
  // finds the right tab+field without having to know which of the 7 tabs
  // it lives under. Keywords are deliberately generous (multiple phrasings
  // per field) since the whole point is not having to guess the exact label.
  const SETTINGS_SEARCH_INDEX = [
    { label: "Accent color", tab: "appearance", field: "settings-accent", keywords: ["theme", "color", "accent", "brand"] },
    { label: "Background color", tab: "appearance", field: "settings-bg", keywords: ["theme", "color", "background", "bg"] },
    { label: "Text color", tab: "appearance", field: "settings-text", keywords: ["theme", "color", "text"] },
    { label: "Border color", tab: "appearance", field: "settings-border", keywords: ["theme", "color", "border"] },
    { label: "Body font", tab: "appearance", field: "settings-font", keywords: ["font", "typography", "typeface"] },
    { label: "Heading font", tab: "appearance", field: "settings-heading-font", keywords: ["font", "typography", "heading", "h1"] },
    { label: "Custom font upload", tab: "appearance", field: "settings-custom-font-upload-btn", keywords: ["font", "upload", "custom font", "woff"] },
    {
      label: "Mobile/desktop breakpoint",
      tab: "appearance",
      field: "settings-mobile-breakpoint",
      keywords: ["breakpoint", "mobile", "responsive", "spacing", "screen width", "homepage spacing"],
    },
    { label: "Site footer text", tab: "appearance", field: "settings-footer", keywords: ["footer", "copyright"] },
    { label: "Default share image", tab: "sharing", field: "settings-og-image", keywords: ["og:image", "og image", "share image", "social preview", "thumbnail", "twitter card", "meta image"] },
    { label: "Search empty-state message", tab: "sharing", field: "settings-empty-search", keywords: ["search", "no results", "empty state"] },
    { label: "Archive empty-state message", tab: "sharing", field: "settings-empty-archive", keywords: ["archive", "empty state", "nothing published"] },
    { label: "Topics empty-state message", tab: "sharing", field: "settings-empty-topics", keywords: ["topics", "empty state", "tags"] },
    { label: "Custom <head> code", tab: "integrations", field: "settings-custom-head", keywords: ["head", "script", "analytics", "verification", "meta tag"] },
    { label: "Webhook URLs", tab: "integrations", field: "settings-webhook-url", keywords: ["webhook", "integration", "publish notification"] },
    { label: "Webhook deliveries", tab: "integrations", field: "load-webhook-deliveries-btn", keywords: ["webhook", "delivery", "retry"] },
    { label: "Maintenance mode", tab: "maintenance", field: "settings-maintenance-mode", keywords: ["maintenance", "down", "offline", "turn off", "shut down", "take down", "site down", "disable site"] },
    { label: "Maintenance message", tab: "maintenance", field: "settings-maintenance-message", keywords: ["maintenance", "message"] },
    { label: "Find & Replace", tab: "tools", field: "find-replace-find", keywords: ["find", "replace", "search and replace"] },
    { label: "Activity Log", tab: "logs", field: "activity-log-list", keywords: ["activity", "log", "history", "audit"] },
    { label: "Error Log", tab: "logs", field: "error-log-list", keywords: ["error", "log", "crash"] },
    { label: "Backup / Restore", tab: "backups", field: "export-btn", keywords: ["backup", "restore", "export", "import"] },
    { label: "Storage usage", tab: "backups", field: "load-storage-usage-btn", keywords: ["storage", "usage", "r2", "database size"] },
    { label: "Backfill image dimensions", tab: "tools", field: "media-backfill-dimensions-btn", keywords: ["backfill", "image size", "width", "height", "dimensions", "older uploads", "layout shift"] },
    { label: "Scan media for duplicates", tab: "tools", field: "media-scan-duplicates-btn", keywords: ["duplicate", "duplicates", "hash", "media", "uploads"] },
  ];

  // Common short/filler words stripped before matching — otherwise a
  // phrase like "turn off the site" would require the literal word "the"
  // to appear somewhere in a setting's keywords, which it never will.
  const SETTINGS_SEARCH_STOPWORDS = new Set(["the", "a", "an", "is", "this", "that", "to", "of", "for", "on", "in", "my"]);

  function settingsSearchActions(q) {
    if (!q) return [];
    // Was pure substring-of-the-whole-query matching (only worked if the
    // typed phrase happened to literally contain, or be contained by, one
    // whole keyword string) — real admin phrasings like "turn off the
    // site" or "twitter card image" matched nothing even with fitting
    // keywords, since neither string fully contains the other. Splitting
    // into individual significant words and requiring each one to appear
    // *somewhere* in the entry's label+keywords catches phrasings built
    // from words that are each individually present, without needing to
    // anticipate every exact multi-word phrase in advance.
    const words = q
      .toLowerCase()
      .split(/\s+/)
      .filter((w) => w.length >= 2 && !SETTINGS_SEARCH_STOPWORDS.has(w));
    if (!words.length) return [];
    return SETTINGS_SEARCH_INDEX.filter((entry) => {
      const haystack = `${entry.label} ${entry.keywords.join(" ")}`.toLowerCase();
      return words.every((w) => haystack.includes(w));
    }).map((entry) => ({
      label: `Setting: ${entry.label}`,
      sub: "Site Settings",
      run: () => {
        closeCommandPalette();
        el("site-settings-btn").click();
        // site-settings-btn's own handler is async (fetches settings before
        // un-hiding the modal) — switching tabs/focusing has to wait until
        // that's actually done, not fire synchronously right after click().
        setTimeout(() => {
          switchSettingsTab(entry.tab);
          const target = el(entry.field);
          if (target) {
            target.scrollIntoView({ behavior: "smooth", block: "center" });
            if (typeof target.focus === "function") target.focus();
          }
        }, 200);
      },
    }));
  }

  function quickActions() {
    const recentActions = getRecentlyEdited().map((r) => ({
      label: `Recent: ${r.title || "(untitled)"}`,
      sub: RECENT_KIND_LABEL[r.kind] || r.kind,
      run: () => { closeCommandPalette(); RECENT_KIND_RUN[r.kind](r.id); },
    }));
    const favoriteActions = getFavorites().map((f) => ({
      label: `★ ${f.title || "(untitled)"}`,
      sub: RECENT_KIND_LABEL[f.kind] || f.kind,
      run: () => { closeCommandPalette(); RECENT_KIND_RUN[f.kind](f.id); },
    }));
    const actions = [
      ...favoriteActions,
      ...recentActions,
      { label: "Add new page", sub: "", run: () => { closeCommandPalette(); el("new-page-btn").click(); } },
      { label: "Add new article", sub: "", run: () => { closeCommandPalette(); el("articles-btn").click(); setTimeout(() => el("new-article").click(), 200); } },
      { label: "Add new project", sub: "", run: () => { closeCommandPalette(); el("projects-btn").click(); setTimeout(() => el("new-project").click(), 200); } },
      { label: "Open Articles", sub: "", run: () => { closeCommandPalette(); el("articles-btn").click(); } },
      { label: "Open Projects", sub: "", run: () => { closeCommandPalette(); el("projects-btn").click(); } },
      { label: "Open Media Library", sub: "", run: () => { closeCommandPalette(); el("media-btn").click(); } },
      { label: "Open Redirects", sub: "", run: () => { closeCommandPalette(); el("redirects-btn").click(); } },
      { label: "Open Analytics", sub: "", run: () => { closeCommandPalette(); el("analytics-btn").click(); } },
      { label: "Open Simulations", sub: "", run: () => { closeCommandPalette(); el("simulations-btn").click(); } },
      { label: "Open Scans", sub: "", run: () => { closeCommandPalette(); el("scans-btn").click(); } },
      { label: "Open Songs", sub: "", run: () => { closeCommandPalette(); el("songs-btn").click(); } },
      { label: "Open Reusable Blocks", sub: "", run: () => { closeCommandPalette(); el("shared-blocks-btn").click(); } },
      { label: "Open Layers", sub: "", run: () => { closeCommandPalette(); el("layers-btn").click(); } },
      { label: "Open Diagnostics", sub: "", run: () => { closeCommandPalette(); el("diagnostics-btn").click(); } },
      { label: "Open Dashboard", sub: "", leads: true, keywords: ["dashboard", "home", "overview", "what needs me"], run: () => { closeCommandPalette(); el("dashboard-btn").click(); } },
      { label: "Open SEO Dashboard", sub: "", run: () => { closeCommandPalette(); el("seo-dashboard-btn").click(); } },
      { label: "Open Topic Pages", sub: "", run: () => { closeCommandPalette(); el("topic-pages-btn").click(); } },
      { label: "Open Trash", sub: "", run: () => { closeCommandPalette(); el("trash-btn").click(); } },
      { label: "Open Site Settings", sub: "", run: () => { closeCommandPalette(); el("site-settings-btn").click(); } },
      { label: "Keyboard Shortcuts", sub: "", run: () => { closeCommandPalette(); el("shortcuts-modal").hidden = false; } },
      { label: "Toggle light / dark admin theme", sub: "", leads: true, keywords: ["theme", "dark mode", "light mode", "dark", "light", "appearance of the admin"], run: () => { closeCommandPalette(); el("admin-theme-toggle").click(); } },
      {
        label: document.documentElement.getAttribute("data-density") === "compact" ? "Interface density: switch to comfortable" : "Interface density: switch to compact",
        sub: "This browser only",
        leads: true,
        keywords: ["compact", "comfortable", "density", "spacing", "tighter"],
        run: () => { closeCommandPalette(); el("admin-density-toggle").click(); },
      },
      { label: "Toggle Focus mode (hide the block palette)", sub: "", run: () => { closeCommandPalette(); el("focus-mode-btn").click(); } },
      { label: "Toggle Content-only mode (lock block positions)", sub: "", run: () => { closeCommandPalette(); el("content-only-mode-btn").click(); } },
      { label: "Toggle draft preview mode", sub: "", run: () => { closeCommandPalette(); el("draft-preview-mode-toggle").click(); } },
      { label: "Screen Preview", sub: "", run: () => { closeCommandPalette(); el("preview-btn").click(); } },
      { label: "Preview the site at a future date", sub: "", leads: true, keywords: ["preview at", "future", "scheduled", "as of a date", "time travel"], run: () => { closeCommandPalette(); el("preview-at-btn").click(); } },
      {
        label: "Run all Site Health checks",
        sub: "",
        leads: true,
        keywords: ["health", "audit", "seo check", "broken links", "check the site"],
        run: () => {
          closeCommandPalette();
          el("seo-dashboard-btn").click();
          setTimeout(() => el("run-site-health-btn").click(), 250);
        },
      },
      {
        label: "Log out (signs out every device)",
        sub: "",
        leads: true,
        keywords: ["logout", "log out", "sign out", "log off", "signout"],
        run: () => {
          closeCommandPalette();
          // Logging out revokes every session, phones included, so the keyboard route asks first.
          if (confirm("Log out? This signs you out on every device.")) el("logout-btn").click();
        },
      },
      {
        label: "Open Activity Log",
        sub: "",
        run: () => {
          closeCommandPalette();
          el("site-settings-btn").click();
          // The settings-btn handler is async (fetches settings + the log
          // before un-hiding the modal) — scrolling/focusing has to wait
          // until it's actually visible, not fire synchronously after click().
          setTimeout(() => el("activity-log-list").scrollIntoView({ behavior: "smooth" }), 200);
        },
      },
      {
        label: "Find & Replace",
        sub: "",
        run: () => {
          closeCommandPalette();
          el("site-settings-btn").click();
          setTimeout(() => el("find-replace-find").focus(), 200);
        },
      },
    ];
    pages.forEach((p) => {
      actions.push({
        label: `Go to page: ${p.title || p.slug}`,
        sub: p.slug === "home" ? "/" : `/${p.slug}`,
        run: () => {
          closeCommandPalette();
          selectPage(p.id);
        },
      });
    });
    const openEditorHelpKey = [["photo-editor-modal", "photo"], ["simulation-builder-modal", "simulation"], ["song-builder-modal", "song"], ["scan-editor-modal", "scan"]].find(([id]) => !el(id).hidden);
    if (openEditorHelpKey) {
      actions.push({ label: "Help for this editor", sub: "", leads: true, keywords: ["help", "tips", "how do i"], run: () => { closeCommandPalette(); openEditorHelp(openEditorHelpKey[1], document.querySelector(`.editor-help-btn[data-help="${openEditorHelpKey[1]}"]`)); } });
    }
    // Commands for the block that is selected right now (single selection only), so they
    // never act on something the user can't see selected.
    const singleBlockOpen = !el("inspector").hidden && !el("single-block-inspector").hidden && selectedBlockId != null;
    if (singleBlockOpen) {
      const blockClick = (id) => () => {
        closeCommandPalette();
        el(id).click();
      };
      // Each command follows its own button: one the inspector hides (Save as reusable on a block
      // that is already reusable) or disables is not offered.
      const blockCommands = [
        ["copy-block-btn", "Block: Copy selected block", ["copy", "copy block"]],
        ["duplicate-block-btn", "Block: Duplicate selected block", ["duplicate", "duplicate block", "clone"]],
        ["lock-block-btn", "Block: Lock / unlock selected block", ["lock", "unlock", "lock block"]],
        ["isolate-block-btn", "Block: Isolate selected block on the canvas", ["isolate", "focus block", "dim others"]],
        ["save-as-shared-block-btn", "Block: Save selected block as reusable block…", ["reusable", "shared block", "save as reusable"]],
      ];
      blockCommands.forEach(([id, label, keywords]) => {
        const btn = el(id);
        if (btn.hidden || btn.disabled) return;
        actions.push({ label, sub: "", leads: true, keywords, run: blockClick(id) });
      });
    }
    if (!el("paste-block-btn").hidden) {
      actions.push({ label: "Block: Paste copied block", sub: "", leads: true, keywords: ["paste", "paste block"], run: () => { closeCommandPalette(); el("paste-block-btn").click(); } });
    }
    const clickAction = (id) => () => {
      closeCommandPalette();
      el(id).click();
    };
    if (!el("song-builder-modal").hidden) {
      actions.push(
        { label: "Song builder: Play / stop", sub: "", run: clickAction("song-play") },
        { label: "Song builder: Save", sub: "", run: clickAction("save-song") },
        { label: "Song builder: Undo", sub: "", run: clickAction("song-undo") },
        { label: "Song builder: Redo", sub: "", run: clickAction("song-redo") }
      );
    }
    if (!el("simulation-builder-modal").hidden) {
      actions.push(
        { label: "Simulation builder: Save", sub: "", run: clickAction("save-simulation") },
        { label: "Simulation builder: Undo", sub: "", run: clickAction("sim-undo") },
        { label: "Simulation builder: Redo", sub: "", run: clickAction("sim-redo") },
        { label: "Simulation builder: Preview power on / off", sub: "", run: clickAction("sim-preview-power") }
      );
    }
    if (!el("scan-editor-modal").hidden) {
      actions.push({ label: "3D scan editor: Save", sub: "", run: clickAction("save-scan-btn") });
    }
    // Photo Editor's own tools/actions -- only surfaced while that modal is
    // actually open on top of this one, so the global palette isn't
    // cluttered with irrelevant "Erase"/"Blur" entries the rest of the
    // time. Ctrl+K still works while the photo editor is open (this
    // listener is document-level, unscoped to any one modal), and
    // closeCommandPalette() only ever hides its own modal, so the photo
    // editor stays open underneath exactly as if the admin had clicked its
    // button directly -- these entries are just a faster way to reach a
    // button that's already there, not a new code path for any of them.
    if (!el("photo-editor-modal").hidden) {
      const peClick = (id) => () => {
        closeCommandPalette();
        el(id).click();
      };
      const peToolClick = (tool) => () => {
        closeCommandPalette();
        document.querySelector(`.pe-tool[data-tool="${tool}"]`).click();
      };
      actions.push(
        { label: "Photo Editor: Undo", sub: "Ctrl+Z", run: peClick("pe-undo") },
        { label: "Photo Editor: Redo", sub: "Ctrl+Shift+Z", run: peClick("pe-redo") },
        { label: "Photo Editor: Reset to original", sub: "", run: peClick("pe-reset") },
        // Deliberately no "Compare with original" entry -- #pe-compare is
        // wired exclusively via pointerdown/pointerup/keydown/keyup (a real
        // press-and-hold gesture), not a "click" listener at all, so a
        // synthetic .click() from here would be a completely silent no-op
        // (a critic pass caught this reachable exactly as a dead palette
        // entry). A momentary hold-to-preview gesture has no sensible
        // "select once from a list" equivalent to invent instead, so this
        // is left out rather than built into a toggle that doesn't match
        // how Compare works anywhere else in the editor.
        { label: "Photo Editor: Save named snapshot", sub: "", run: peClick("pe-save-snapshot") },
        { label: "Photo Editor: Restore named snapshot", sub: "", run: peClick("pe-restore-snapshot") },
        { label: "Photo Editor: Paint brush tool", sub: "", run: peToolClick("paint") },
        { label: "Photo Editor: Pencil tool", sub: "", run: peToolClick("pencil") },
        { label: "Photo Editor: Select / Crop tool", sub: "", run: peToolClick("select") },
        { label: "Photo Editor: Rectangle selection tool", sub: "", run: peToolClick("sel-rect") },
        { label: "Photo Editor: Ellipse selection tool", sub: "", run: peToolClick("sel-ellipse") },
        { label: "Photo Editor: Lasso selection tool", sub: "", run: peToolClick("sel-lasso") },
        { label: "Photo Editor: Polygon selection tool", sub: "", run: peToolClick("sel-poly") },
        { label: "Photo Editor: Select all", sub: "", run: peClick("pe-sel-all") },
        { label: "Photo Editor: Invert selection", sub: "", run: peClick("pe-sel-invert") },
        { label: "Photo Editor: Deselect", sub: "Ctrl+D", run: peClick("pe-sel-clear") },
        { label: "Photo Editor: Crop to selection", sub: "", run: peClick("pe-sel-crop") },
        { label: "Photo Editor: Delete selected pixels", sub: "", run: peClick("pe-sel-delete") },
        { label: "Photo Editor: Apply crop", sub: "", run: peClick("pe-apply-crop") },
        { label: "Photo Editor: Rotate left 90°", sub: "", run: peClick("pe-rotate-left") },
        { label: "Photo Editor: Rotate right 90°", sub: "", run: peClick("pe-rotate-right") },
        { label: "Photo Editor: Flip horizontal", sub: "", run: peClick("pe-flip-h") },
        { label: "Photo Editor: Flip vertical", sub: "", run: peClick("pe-flip-v") },
        { label: "Photo Editor: Rotate view (cosmetic only)", sub: "", run: peClick("pe-view-rotate") },
        { label: "Photo Editor: Grayscale filter", sub: "", run: peClick("pe-filter-grayscale") },
        { label: "Photo Editor: Sepia filter", sub: "", run: peClick("pe-filter-sepia") },
        { label: "Photo Editor: Invert filter", sub: "", run: peClick("pe-filter-invert") },
        { label: "Photo Editor: Add grain", sub: "", run: peClick("pe-filter-grain") },
        { label: "Photo Editor: Erase brush", sub: "", run: peToolClick("erase") },
        { label: "Photo Editor: Blur brush", sub: "", run: peToolClick("blur") },
        { label: "Photo Editor: Pixelate brush", sub: "", run: peToolClick("pixelate") },
        { label: "Photo Editor: Dodge brush (brighten)", sub: "", run: peToolClick("dodge") },
        { label: "Photo Editor: Burn brush (darken)", sub: "", run: peToolClick("burn") },
        { label: "Photo Editor: Eyedropper", sub: "", run: peToolClick("eyedropper") },
        { label: "Photo Editor: Rectangle tool", sub: "", run: peToolClick("rect") },
        { label: "Photo Editor: Circle tool", sub: "", run: peToolClick("circle") },
        { label: "Photo Editor: Line tool", sub: "", run: peToolClick("line") },
        { label: "Photo Editor: Arrow tool", sub: "", run: peToolClick("arrow") },
        { label: "Photo Editor: Text tool", sub: "", run: peToolClick("text") },
        { label: "Photo Editor: Zoom in", sub: "+", run: peClick("pe-zoom-in") },
        { label: "Photo Editor: Zoom out", sub: "-", run: peClick("pe-zoom-out") },
        { label: "Photo Editor: Fit image to window", sub: "0", run: peClick("pe-zoom-reset") },
        { label: "Photo Editor: Actual pixels (100%)", sub: "1", run: peClick("pe-zoom-100") },
        { label: "Photo Editor: Pan tool", sub: "", run: peToolClick("pan") },
        { label: "Photo Editor: New layer", sub: "", run: peClick("pe-layer-add") },
        { label: "Photo Editor: Duplicate layer", sub: "", run: peClick("pe-layer-duplicate") },
        { label: "Photo Editor: Delete layer", sub: "", run: peClick("pe-layer-delete") },
        { label: "Photo Editor: Merge layer down", sub: "", run: peClick("pe-layer-merge") },
        { label: "Photo Editor: Flatten layers", sub: "", run: peClick("pe-layer-flatten") },
        { label: "Photo Editor: Move layer up", sub: "", run: peClick("pe-layer-up") },
        { label: "Photo Editor: Move layer down", sub: "", run: peClick("pe-layer-down") },
        { label: "Photo Editor: Save as new file", sub: "", run: peClick("pe-save-new") },
        { label: "Photo Editor: Overwrite original", sub: "", run: peClick("pe-save-overwrite") }
      );
    }
    return actions;
  }

  async function openArticleEditorById(id) {
    articles = await api("/articles");
    const article = articles.find((a) => a.id === id);
    // A stale/bookmarked/shared "Edit this" link (or command-palette
    // result) for an article that's since been deleted used to still
    // open the modal with nothing populated — indistinguishable from a
    // blank "create new" form, so an admin who didn't notice could end
    // up half-filling out and saving an unintended new article instead
    // of realizing their actual target is gone. Matches selectPage()'s
    // existing behavior for the same situation: fail visibly, touch
    // nothing, rather than silently open an editor for content that
    // doesn't exist.
    if (!article) {
      alert("That article no longer exists.");
      return;
    }
    el("articles-modal").hidden = false;
    populateArticleForm(article);
    renderArticlesList();
  }

  async function openProjectEditorById(id) {
    projects = await api("/projects");
    const project = projects.find((p) => p.id === id);
    if (!project) {
      alert("That project no longer exists.");
      return;
    }
    el("projects-modal").hidden = false;
    populateProjectForm(project);
    renderProjectsList();
  }

  async function goToBlock(pageId, blockId) {
    if (!currentPage || currentPage.id !== pageId) await selectPage(pageId);
    selectedBlockId = blockId;
    multiSelectedIds.clear();
    renderCanvas();
    renderInspector();
    if (isMobile()) openDrawer(el("inspector"));
    const el2 = canvas.querySelector(`[data-id="${blockId}"]`);
    if (el2) el2.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  function setCommandActive(index) {
    commandActiveIndex = index;
    el("command-results")
      .querySelectorAll(".command-result")
      .forEach((row, i) => {
        row.classList.toggle("active", i === index);
        row.setAttribute("aria-selected", i === index ? "true" : "false");
        if (i === index) el("command-input").setAttribute("aria-activedescendant", row.id);
      });
  }

  // Result groups follow the label prefix ("Page: x", "Setting: y"); anything else is a command.
  const COMMAND_GROUPS = {
    Page: ["Pages", "Page"],
    Article: ["Articles", "Article"],
    Block: ["Blocks", "Block"],
    Project: ["Projects", "Project"],
    Simulation: ["Simulations", "Simulation"],
    Song: ["Songs", "Song"],
    "3D Scan": ["Scans", "Scan"],
    "Reusable Block": ["Reusable blocks", "Reusable"],
    Setting: ["Settings", "Setting"],
  };
  // Display order of the groups; "Best match" holds commands that named the query.
  const COMMAND_GROUP_ORDER = ["Best match", "Settings", "Actions", "Pages", "Articles", "Blocks", "Projects", "Simulations", "Songs", "Scans", "Reusable blocks"];
  function commandGroupOf(it) {
    if (it.best) return ["Best match", "Action"];
    const m = /^([^:]{1,20}):/.exec(it.label || "");
    // "Block: …" is a block search result only when it points at a page; otherwise it's a command.
    if (m && m[1] === "Block" && !/^page #/.test(it.sub || "")) return ["Actions", "Action"];
    return (m && COMMAND_GROUPS[m[1]]) || ["Actions", "Action"];
  }

  function renderCommandResults(items) {
    // One heading per group: stable-sort by group so a group never reappears later in the list.
    items = items
      .map((it, i) => ({ it, i, r: COMMAND_GROUP_ORDER.indexOf(commandGroupOf(it)[0]) }))
      .sort((a, b) => a.r - b.r || a.i - b.i)
      .map((x) => x.it);
    commandItems = items;
    commandActiveIndex = 0;
    let lastGroup = null;
    el("command-results").innerHTML = items.length
      ? items
          .map((it, i) => {
            const [group, kind] = commandGroupOf(it);
            const heading = group !== lastGroup ? `<div class="command-result-group" aria-hidden="true">${escapeHtml(group)}</div>` : "";
            lastGroup = group;
            return `${heading}<div class="command-result${i === 0 ? " active" : ""}" id="command-opt-${i}" role="option" aria-selected="${i === 0 ? "true" : "false"}" data-index="${i}" data-k="${kind}"><span>${escapeHtml(
              it.label
            )}</span><span class="command-result-sub">${escapeHtml(it.sub || "")}</span></div>`;
          })
          .join("")
      : "<p class='command-empty'>Nothing matches. Try a page name, a setting, or a command like “theme”.</p>";
    el("command-input").setAttribute("aria-activedescendant", items.length ? "command-opt-0" : "");
    el("command-results")
      .querySelectorAll(".command-result")
      .forEach((row) => {
        row.addEventListener("click", () => commandItems[Number(row.dataset.index)].run());
        row.addEventListener("mousemove", () => setCommandActive(Number(row.dataset.index)));
      });
  }

  let commandSearchTimer = null;
  function runCommandSearch(q) {
    const needle = q.toLowerCase();
    const localMatches = q
      ? quickActions().filter((a) => a.label.toLowerCase().includes(needle) || (a.keywords || []).some((k) => k.includes(needle)))
      : quickActions();
    // A command that names what was typed (its label or one of its own keywords) outranks
    // the settings index, so "theme" toggles the theme instead of opening Accent color first.
    // Only a whole keyword, or the start of one from four letters up, leads: "a", "l" or "mode"
    // must not push these four ahead of everything else, and "log" still means the logs.
    const leading = q ? localMatches.filter((a) => a.leads && (a.keywords || []).some((k) => k === needle || (needle.length >= 4 && k.startsWith(needle)))) : [];
    // Settings matches lead the list — "where is this setting" is exactly
    // what this index exists for, so it should surface before generic
    // "Go to page: ..." matches that happen to share a word.
    const settingsMatches = settingsSearchActions(q);
    leading.forEach((a) => (a.best = true));
    renderCommandResults([...leading, ...settingsMatches, ...localMatches.filter((a) => !leading.includes(a))]);
    if (!q) return;
    clearTimeout(commandSearchTimer);
    commandSearchTimer = setTimeout(async () => {
      try {
        const results = await api(`/search?q=${encodeURIComponent(q)}`);
        const items = [...leading, ...settingsMatches, ...localMatches.filter((a) => !leading.includes(a))];
        results.pages.forEach((p) =>
          items.push({
            label: `Page: ${p.title}`,
            sub: `/${p.slug}`,
            // The remote /search endpoint deliberately searches every page
            // regardless of deleted_at ("sees everything"), so a trashed
            // page's title can still surface here — that's the real-
            // deletion case RECENT_KIND_RUN.page's existence check exists
            // for. But routing straight through it was wrong for a
            // *different* reason: /search is a live server query, so a
            // page created moments ago in another tab/session can be a
            // completely real, genuine result that just isn't in this
            // tab's own stale `pages` cache yet (only refreshed by this
            // tab's own create/delete/restore actions) — that's not "no
            // longer exists," it's "cache hasn't caught up." Refresh the
            // cache once before trusting a miss, since the search result
            // already proved the page exists server-side a moment ago.
            run: async () => {
              closeCommandPalette();
              if (!pages.some((existing) => existing.id === p.id)) await loadPages();
              RECENT_KIND_RUN.page(p.id);
            },
          })
        );
        results.articles.forEach((a) =>
          items.push({
            label: `Article: ${a.title}`,
            sub: a.published_at ? "" : "(draft)",
            run: () => openArticleEditorById(a.id),
          })
        );
        results.blocks.forEach((b) =>
          items.push({
            label: `Block: ${blockLabel(b.type)}`,
            sub: `page #${b.page_id}`,
            run: () => goToBlock(b.page_id, b.id),
          })
        );
        (results.projects || []).forEach((p) =>
          items.push({
            label: `Project: ${p.title}`,
            sub: "",
            run: () => openProjectEditorById(p.id),
          })
        );
        // Simulations/Songs/Scans/Reusable Blocks each have their own
        // dedicated list-and-editor modal rather than a single-item route,
        // so unlike pages/articles/projects there's no "open this exact
        // one" to jump to — landing on the right modal (where the match is
        // usually one of a short list) is still a real improvement over
        // these four content types not being searchable from here at all.
        (results.simulations || []).forEach((s) =>
          items.push({ label: `Simulation: ${s.name}`, sub: "", run: () => { closeCommandPalette(); el("simulations-btn").click(); } })
        );
        (results.songs || []).forEach((s) =>
          items.push({ label: `Song: ${s.name}`, sub: "", run: () => { closeCommandPalette(); el("songs-btn").click(); } })
        );
        (results.scans || []).forEach((s) =>
          items.push({ label: `3D Scan: ${s.name}`, sub: "", run: () => { closeCommandPalette(); el("scans-btn").click(); } })
        );
        (results.sharedBlocks || []).forEach((s) =>
          items.push({ label: `Reusable Block: ${s.name}`, sub: blockLabel(s.type), run: () => { closeCommandPalette(); el("shared-blocks-btn").click(); } })
        );
        renderCommandResults(items);
      } catch {
        // leave the local matches showing
      }
    }, 200);
  }

  function openCommandPalette() {
    if (!el("editor-help-modal").hidden) closeEditorHelp(); // the palette needs the keyboard
    // Recorded before .hidden flips and before focus moves into the
    // palette's own search input -- the only modal in the app that moves
    // focus into itself on open, which otherwise races the generic
    // focus-return MutationObserver below (a microtask, so by the time it
    // runs, document.activeElement is already #command-input, not the
    // real trigger). See that observer's own comment for the other half.
    modalFocusReturn.set(el("command-modal"), document.activeElement);
    el("command-modal").hidden = false;
    el("command-input").value = "";
    el("command-input").focus();
    renderCommandResults(quickActions());
  }
  function closeCommandPalette() {
    el("command-modal").hidden = true;
  }

  el("command-btn").addEventListener("click", openCommandPalette);
  el("close-command").addEventListener("click", closeCommandPalette);
  closeModalOnClick("close-shortcuts", "shortcuts-modal");
  el("command-input").addEventListener("input", (e) => runCommandSearch(e.target.value.trim()));
  el("command-input").addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      closeCommandPalette();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setCommandActive(Math.min(commandActiveIndex + 1, commandItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setCommandActive(Math.max(commandActiveIndex - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (commandItems[commandActiveIndex]) commandItems[commandActiveIndex].run();
    }
  });

  // ---------- Backup / restore ----------
  el("export-btn").addEventListener("click", async () => {
    const res = await fetch("/api/admin/export");
    if (!res.ok) {
      alert("Export failed.");
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `dominickdominick-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  });

  el("import-btn").addEventListener("click", () => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "application/json";
    input.addEventListener("change", async () => {
      const file = input.files[0];
      if (!file) return;
      if (
        !confirm(
          "This will REPLACE every page, block, article, and setting with what's in this file. This can't be undone. Continue?"
        )
      ) {
        return;
      }
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        await api("/import", { method: "POST", body: JSON.stringify(data) });
        alert("Restored. Reloading…");
        location.reload();
      } catch (err) {
        alert("Restore failed: " + err.message);
      }
    });
    input.click();
  });

  // ---------- Analytics ----------
  let analyticsRange = 7;
  let lastAnalyticsData = null;
  let analyticsFilterOptionsLoaded = false;

  function currentAnalyticsFilters() {
    return {
      contentType: el("analytics-filter-content-type").value,
      device: el("analytics-filter-device").value,
      referrer: el("analytics-filter-referrer").value,
    };
  }

  function analyticsFilterQuery() {
    const { contentType, device, referrer } = currentAnalyticsFilters();
    const params = new URLSearchParams({ days: String(analyticsRange) });
    if (contentType) params.set("contentType", contentType);
    if (device) params.set("device", device);
    if (referrer) params.set("referrer", referrer);
    return params.toString();
  }

  async function loadAnalytics() {
    const data = await api(`/analytics?${analyticsFilterQuery()}`);
    lastAnalyticsData = data;
    // Populated once, from the first (unfiltered) load — so the dropdown
    // keeps every known device/referrer as an option even after filtering
    // narrows the numbers down to just one of them.
    if (!analyticsFilterOptionsLoaded) {
      analyticsFilterOptionsLoaded = true;
      const deviceSel = el("analytics-filter-device");
      deviceSel.innerHTML = `<option value="">All devices</option>${data.topDevices
        .map((d) => `<option value="${escapeHtml(d.device)}">${escapeHtml(d.device)}</option>`)
        .join("")}`;
      const referrerSel = el("analytics-filter-referrer");
      referrerSel.innerHTML = `<option value="">All referrers</option>${data.topReferrers
        .map((r) => `<option value="${escapeHtml(r.referrer)}">${escapeHtml(r.referrer)}</option>`)
        .join("")}`;
    }
    const { contentType, device, referrer } = currentAnalyticsFilters();
    el("analytics-clear-filters").hidden = !(contentType || device || referrer);
    el("stat-active").textContent = data.activeNow;
    el("stat-today").textContent = data.today;
    el("stat-7d").textContent = data.last7;
    el("stat-30d").textContent = data.last30;
    el("stat-all").textContent = data.allTime;

    const max = Math.max(1, ...data.byDay.map((d) => d.n));
    el("analytics-chart").innerHTML = data.byDay
      .map((d) => {
        const pct = Math.round((d.n / max) * 100);
        const label = d.day.slice(5); // MM-DD
        return `<div class="chart-bar-wrap" title="${d.day}: ${d.n}"><div class="chart-bar" style="height:${pct}%"></div><div class="chart-bar-label">${label}</div></div>`;
      })
      .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No data yet.</p>";

    const renderList = (id, rows, keyName) =>
      (el(id).innerHTML =
        rows.map((r) => `<div class="analytics-row"><span>${escapeHtml(r[keyName])}</span><span>${r.n}</span></div>`).join("") ||
        "<p style='color:var(--text-dim);font-size:0.85rem;'>No data yet.</p>");

    renderList("analytics-pages", data.topPaths, "path");
    renderList("analytics-referrers", data.topReferrers, "referrer");
    renderList("analytics-countries", data.topCountries, "country");
    renderList("analytics-locations", data.topLocations, "location");
    renderList("analytics-devices", data.topDevices, "device");
    renderList("analytics-browsers", data.topBrowsers, "browser");
    renderList("analytics-events", data.topEvents, "name");
    renderList("analytics-search-terms", data.topSearchTerms, "term");
    renderList("analytics-no-result-searches", data.noResultSearchTerms, "term");
    renderList("analytics-outbound-links", data.topOutboundLinks, "url");
    renderList("analytics-downloads", data.topDownloads, "url");
  }

  el("analytics-btn").addEventListener("click", async () => {
    el("analytics-modal").hidden = false;
    await loadAnalytics();
  });
  closeModalOnClick("close-analytics", "analytics-modal");

  ["analytics-filter-content-type", "analytics-filter-device", "analytics-filter-referrer"].forEach((id) =>
    el(id).addEventListener("change", loadAnalytics)
  );
  el("analytics-clear-filters").addEventListener("click", async () => {
    el("analytics-filter-content-type").value = "";
    el("analytics-filter-device").value = "";
    el("analytics-filter-referrer").value = "";
    await loadAnalytics();
  });

  // Builds one CSV with a section per breakdown, rather than a single flat
  // table — the shapes (day/count, path/count, referrer/count) don't share
  // columns, and a human is going to open this in a spreadsheet, not parse it.
  function toCsvRow(cells) {
    return cells.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(",") + "\r\n";
  }

  el("export-analytics-btn").addEventListener("click", () => {
    if (!lastAnalyticsData) return;
    const data = lastAnalyticsData;
    let csv = toCsvRow(["Summary"]);
    csv += toCsvRow(["Today", data.today]);
    csv += toCsvRow(["Last 7 days", data.last7]);
    csv += toCsvRow(["Last 30 days", data.last30]);
    csv += toCsvRow(["All time", data.allTime]);
    csv += "\r\n" + toCsvRow(["Views per day"]) + toCsvRow(["Day", "Views"]);
    data.byDay.forEach((r) => (csv += toCsvRow([r.day, r.n])));
    csv += "\r\n" + toCsvRow(["Top pages"]) + toCsvRow(["Path", "Views"]);
    data.topPaths.forEach((r) => (csv += toCsvRow([r.path, r.n])));
    csv += "\r\n" + toCsvRow(["Top referrers"]) + toCsvRow(["Referrer", "Views"]);
    data.topReferrers.forEach((r) => (csv += toCsvRow([r.referrer, r.n])));
    csv += "\r\n" + toCsvRow(["Top countries"]) + toCsvRow(["Country", "Views"]);
    data.topCountries.forEach((r) => (csv += toCsvRow([r.country, r.n])));
    csv += "\r\n" + toCsvRow(["Top locations"]) + toCsvRow(["Location", "Views"]);
    data.topLocations.forEach((r) => (csv += toCsvRow([r.location, r.n])));
    csv += "\r\n" + toCsvRow(["Devices"]) + toCsvRow(["Device", "Views"]);
    data.topDevices.forEach((r) => (csv += toCsvRow([r.device, r.n])));
    csv += "\r\n" + toCsvRow(["Browsers"]) + toCsvRow(["Browser", "Views"]);
    data.topBrowsers.forEach((r) => (csv += toCsvRow([r.browser, r.n])));
    csv += "\r\n" + toCsvRow(["Top events"]) + toCsvRow(["Event", "Count"]);
    data.topEvents.forEach((r) => (csv += toCsvRow([r.name, r.n])));
    csv += "\r\n" + toCsvRow(["Top search terms"]) + toCsvRow(["Term", "Count"]);
    data.topSearchTerms.forEach((r) => (csv += toCsvRow([r.term, r.n])));
    csv += "\r\n" + toCsvRow(["Searches with no results"]) + toCsvRow(["Term", "Count"]);
    data.noResultSearchTerms.forEach((r) => (csv += toCsvRow([r.term, r.n])));
    csv += "\r\n" + toCsvRow(["Top outbound links"]) + toCsvRow(["URL", "Count"]);
    data.topOutboundLinks.forEach((r) => (csv += toCsvRow([r.url, r.n])));
    csv += "\r\n" + toCsvRow(["Top downloads"]) + toCsvRow(["URL", "Count"]);
    data.topDownloads.forEach((r) => (csv += toCsvRow([r.url, r.n])));

    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `analytics-${analyticsRange}d-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // Raw per-event export — every individual pageview/event row, generated
  // server-side (unlike the breakdown CSV above, which already has the
  // aggregated numbers client-side and just formats them). Same
  // fetch-blob-then-<a download> shape as the full JSON backup download.
  el("export-analytics-raw-btn").addEventListener("click", async () => {
    const btn = el("export-analytics-raw-btn");
    const originalText = btn.textContent;
    btn.disabled = true;
    btn.textContent = "Exporting…";
    try {
      const res = await fetch(`/api/admin/analytics/export-raw?${analyticsFilterQuery()}`);
      if (!res.ok) throw new Error("Export failed");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `raw-events-${analyticsRange}d-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
      btn.textContent = originalText;
    }
  });

  document.querySelectorAll(".range-btn").forEach((btn) => {
    if (Number(btn.dataset.days) === analyticsRange) btn.classList.add("active");
    btn.addEventListener("click", async () => {
      document.querySelectorAll(".range-btn").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      analyticsRange = Number(btn.dataset.days);
      await loadAnalytics();
    });
  });

  // ---------- Keyboard shortcuts ----------
  document.addEventListener("keydown", (e) => {
    const tag = document.activeElement && document.activeElement.tagName;
    const isTyping =
      tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || (document.activeElement && document.activeElement.isContentEditable);
    const mod = e.metaKey || e.ctrlKey;

    if (mod && e.key.toLowerCase() === "k") {
      e.preventDefault();
      openCommandPalette();
      return;
    }

    if (!isTyping && !mod && e.key === "?") {
      e.preventDefault();
      el("shortcuts-modal").hidden = false;
      return;
    }

    // Plain Ctrl/Cmd+S only (Ctrl+Shift+S and Ctrl+Alt+S are left to the browser), by physical key so it
    // works on non-Latin layouts, and not on the signed-out screen where there is nothing to save.
    if (mod && !e.shiftKey && !e.altKey && (e.code === "KeyS" || e.key.toLowerCase() === "s") && !app.hidden) {
      e.preventDefault();
      if (e.repeat) return; // a held key must not save over and over
      // Ctrl/Cmd+S saves the topmost editor, never something that is only visible behind it:
      // pressing it inside the Simulation builder used to save the page settings underneath.
      // Distraction-free Focus mode is part of the article or project editor beneath it.
      const top = getTopModal("writing-focus-overlay");
      if (top) {
        const saveButtonId = {
          "articles-modal": "save-article",
          "projects-modal": "save-project",
          "settings-modal": "save-settings",
          "simulation-builder-modal": "save-simulation",
          "song-builder-modal": "save-song",
          "scan-editor-modal": "save-scan-btn",
          "media-info-modal": "save-media-info",
          "topic-meta-edit-modal": "save-topic-meta",
          "keyframe-editor-modal": "save-keyframe-editor",
        }[top.id];
        const btn = saveButtonId && el(saveButtonId);
        if (btn && !btn.disabled) btn.click();
        return; // any other dialog on top (photo editor, pickers, confirmations): nothing to save with this key
      }
      if (currentPage) el("save-page-settings").click();
      return;
    }

    if (isTyping || app.hidden) return;

    if ((e.key === "Delete" || e.key === "Backspace") && multiSelectedIds.size > 0) {
      e.preventDefault();
      el("bulk-delete-btn").click();
      return;
    }

    if ((e.key === "Delete" || e.key === "Backspace") && selectedBlockId) {
      e.preventDefault();
      // A locked block still deletes fine via its own explicit button (a
      // deliberate action) — this keyboard shortcut is exactly the kind of
      // accidental trigger locking is meant to guard against, so it's the
      // one place that actually respects the lock.
      const block = blocks.find((b) => b.id === selectedBlockId);
      if (block && isLayoutLocked(block)) return;
      el("delete-block-btn").click();
      return;
    }

    if (selectedBlockId && ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"].includes(e.key)) {
      const block = blocks.find((b) => b.id === selectedBlockId);
      if (!block) return;
      e.preventDefault();
      let { col, row } = block;
      if (e.key === "ArrowUp") row = Math.max(1, row - 1);
      if (e.key === "ArrowDown") row = row + 1;
      if (e.key === "ArrowLeft") col = Math.max(1, col - 1);
      if (e.key === "ArrowRight") col = Math.min(COLS - block.col_span + 1, col + 1);
      if (col === block.col && row === block.row) return;
      const trial = { ...block, col, row };
      if (wouldOverlap(trial)) return;
      block.col = col;
      block.row = row;
      renderCanvas();
      api(`/blocks/${block.id}`, { method: "PATCH", body: JSON.stringify({ col, row }) }).catch((err) => alert(err.message));
    }
  });

  // ---------- Templates ----------
  const templateOptions = { page: [], article: [], project: [] };
  const TEMPLATE_PICKER_IDS = { page: "page-template-picker", article: "article-template-picker", project: "project-template-picker" };
  const TEMPLATE_BLANK_LABELS = { page: "Blank page", article: "Start blank", project: "Start blank" };

  async function loadTemplates(kind) {
    try {
      templateOptions[kind] = await api(`/templates?kind=${kind}`);
    } catch {
      templateOptions[kind] = [];
    }
    const picker = el(TEMPLATE_PICKER_IDS[kind]);
    const blankLabel = TEMPLATE_BLANK_LABELS[kind];
    const count = templateOptions[kind].length;
    // Visible on the collapsed <select> itself (the blank option's own
    // label), not just a hover tooltip — with several near-duplicate
    // "Test Template ..." entries able to pile up over time, there was no
    // way to tell at a glance how cluttered a picker had gotten without
    // opening it.
    picker.innerHTML =
      `<option value="">${blankLabel}${count ? ` (${count} template${count === 1 ? "" : "s"} saved)` : ""}</option>` +
      templateOptions[kind].map((t) => `<option value="${t.id}">${escapeHtml(t.name)}</option>`).join("");
  }

  el("save-page-template-btn").addEventListener("click", async () => {
    if (!currentPage) return;
    const name = prompt("Template name:");
    if (!name) return;
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({ kind: "page", name, data: { blocks } }),
      });
      await loadTemplates("page");
    } catch (err) {
      alert(err.message);
    }
  });

  // DELETE /templates/:id already existed with nothing in the UI ever
  // calling it — a typo'd or since-obsolete template just sat permanently
  // in the picker dropdown with no way to remove it. The page picker keeps
  // its selected value after use (see "+ Page" above, which reads it),
  // so its delete button can reuse that value directly, same pattern as
  // the style-preset delete button. Article/project pickers apply their
  // template and immediately reset to blank (so re-selecting the same
  // template a second time still fires a change event) — there's no
  // "just highlighted, not yet applied" state to read there, so those two
  // ask for the template's name instead rather than forcing an unwanted
  // re-apply just to select which one to delete.
  el("delete-page-template-btn").addEventListener("click", async () => {
    const id = Number(el("page-template-picker").value);
    if (!id) return alert("Select a template from the picker first.");
    const t = templateOptions.page.find((x) => x.id === id);
    if (!confirm(`Delete template "${t ? t.name : id}"? This can't be undone.`)) return;
    try {
      await api(`/templates/${id}`, { method: "DELETE" });
      await loadTemplates("page");
    } catch (err) {
      alert(err.message);
    }
  });
  async function deleteTemplateByName(kind) {
    const list = templateOptions[kind];
    if (!list.length) return alert(`No ${kind} templates saved yet.`);
    const name = prompt(`Delete which template? Type its exact name:\n\n${list.map((t) => t.name).join("\n")}`);
    if (!name) return;
    const t = list.find((x) => x.name === name.trim());
    if (!t) return alert("No template with that exact name.");
    if (!confirm(`Delete template "${t.name}"? This can't be undone.`)) return;
    try {
      await api(`/templates/${t.id}`, { method: "DELETE" });
      await loadTemplates(kind);
    } catch (err) {
      alert(err.message);
    }
  }

  el("save-article-template-btn").addEventListener("click", async () => {
    const name = prompt("Template name:");
    if (!name) return;
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({ kind: "article", name, data: { body: el("article-body").value } }),
      });
      await loadTemplates("article");
    } catch (err) {
      alert(err.message);
    }
  });

  el("article-template-picker").addEventListener("change", (e) => {
    const id = Number(e.target.value);
    e.target.value = "";
    if (!id) return;
    const t = templateOptions.article.find((x) => x.id === id);
    if (!t) return;
    el("article-body").value = t.data.body || "";
    updateWordCount();
    updateArticleOgPreview();
    scheduleAutosave();
  });
  el("delete-article-template-btn").addEventListener("click", () => deleteTemplateByName("article"));

  el("save-project-template-btn").addEventListener("click", async () => {
    const name = prompt("Template name:");
    if (!name) return;
    try {
      await api("/templates", {
        method: "POST",
        body: JSON.stringify({
          kind: "project",
          name,
          data: {
            body: el("project-body").value,
            summary: el("project-summary").value,
            tech_stack: el("project-tech-stack").value,
            status: el("project-status").value,
          },
        }),
      });
      await loadTemplates("project");
    } catch (err) {
      alert(err.message);
    }
  });

  el("project-template-picker").addEventListener("change", (e) => {
    const id = Number(e.target.value);
    e.target.value = "";
    if (!id) return;
    const t = templateOptions.project.find((x) => x.id === id);
    if (!t) return;
    el("project-body").value = t.data.body || "";
    el("project-summary").value = t.data.summary || "";
    el("project-tech-stack").value = t.data.tech_stack || "";
    el("project-status").value = t.data.status || "";
  });
  el("delete-project-template-btn").addEventListener("click", () => deleteTemplateByName("project"));

  // ---------- Boot ----------
  async function loadSimulationOptions() {
    try {
      simulationOptions = await api("/simulations");
    } catch {
      simulationOptions = [];
    }
    renderInspector();
    // The canvas's "Broken reference" badge (blockBadgesHtml) checks a
    // simulation/scan/song block's target against this same array — if the
    // canvas already rendered before this resolved (e.g. loadPages() ran
    // first, or a slow network delayed this past the initial render), every
    // valid block would show a false "broken" badge that renderInspector()
    // alone can't clear. Re-rendering the canvas here means that false state
    // can never outlive the fetch that caused it.
    renderCanvas();
  }

  async function loadScanOptions() {
    try {
      scanOptions = await api("/scans");
    } catch {
      scanOptions = [];
    }
    renderInspector();
    renderCanvas();
  }

  async function loadSongOptions() {
    try {
      songOptions = await api("/songs");
    } catch {
      // A failed refresh keeps the list already loaded rather than emptying it.
    }
    renderInspector();
    renderCanvas();
  }

  async function boot() {
    const { authenticated } = await fetch("/api/admin/me").then((r) => r.json());
    if (!authenticated) {
      showLogin();
      return;
    }
    showApp();
    api("/settings").then((settings) => window.applySiteThemeToAdmin && window.applySiteThemeToAdmin(settings)).catch(() => {});
    // Loaded before loadPages() specifically so the very first canvas render
    // already has real simulation/scan/song data to check "Broken reference"
    // badges against, instead of the empty arrays these start as.
    await loadSimulationOptions();
    await loadScanOptions();
    await loadSongOptions();
    await loadPages();
    await loadStylePresets();
    populateStylePresetSelect();
    await loadMediaSavedSearches();
    await loadTemplates("page");
    await loadTemplates("article");
    await loadTemplates("project");
    // The page-load call at startup 401s before login and never retries,
    // so the bell stays empty for the rest of the session unless boot()
    // (which also runs right after a successful in-page login) reloads it.
    loadNotifications().catch(() => {});
    await openDeepLinkedEditor();
  }

  // "Edit this" on the live public site links here as /admin/?edit=type:id
  // (type is "page"/"article"/"project") — jumps straight to that record's
  // editor instead of leaving a logged-in admin to find it themselves in
  // Articles/Projects/the page picker. A bad/missing id is just ignored
  // (no error shown) since there's nothing actionable to tell the admin.
  async function openDeepLinkedEditor() {
    const edit = new URLSearchParams(location.search).get("edit");
    if (!edit) return;
    const [type, idStr] = edit.split(":");
    const id = Number(idStr);
    if (!id) return;
    if (type === "page") await selectPage(id);
    else if (type === "article") await openArticleEditorById(id);
    else if (type === "project") await openProjectEditorById(id);
  }

  document.querySelectorAll(".upload-trigger").forEach(wireUploadButton);
  document.querySelectorAll(".browse-trigger").forEach(wireBrowseButton);
  document.querySelectorAll(".image-url-source-badge").forEach(wireImageUrlSourceBadge);
  document.querySelectorAll(".edit-image-trigger").forEach(wireEditImageButton);

  // Shared with photo-editor.js and simulation-builder.js, which are loaded
  // as separate plain scripts (not modules) and can't import from this IIFE.
  window.adminApi = api;
  window.adminUploadBlob = uploadFile;
  window.refreshMediaLibrary = loadMediaLibrary;
  window.refreshSimulationOptions = loadSimulationOptions;
  window.refreshScanOptions = loadScanOptions;
  window.refreshSongOptions = loadSongOptions;
  // Shared "what uses this" checker for the reusable-library builders
  // (simulations/songs/scans) and Reusable Blocks — one /content-usage
  // call + one alert format, instead of each builder script rolling its
  // own usage-fetch-and-display.
  // extraInfo (optional) is shown above the usage list — used by the
  // Reusable Blocks "Usage" button to surface the same content-quality
  // issues (empty content, bad contrast, a broken reference) shown as a
  // badge in the list, right where an admin investigating usage would
  // want to know what fixing this one source would fix everywhere.
  window.showContentUsage = async function (type, id, label, extraInfo) {
    try {
      const usage = await api(`/content-usage?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`);
      const prefix = extraInfo ? `${extraInfo}\n\n` : "";
      if (!usage.length) {
        alert(`${prefix}"${label}" isn't used anywhere.`);
        return;
      }
      const lines = usage.map((u) => `• ${u.type} — ${u.title}`).join("\n");
      alert(`${prefix}"${label}" is used in ${usage.length} place${usage.length === 1 ? "" : "s"}:\n\n${lines}`);
    } catch (err) {
      alert(err.message);
    }
  };

  // A modal opened from inside another is promoted by modalStackObserver.
  // Use computed z-index to identify the same top surface for Escape, focus,
  // and aria-modal semantics; later DOM order breaks ties.
  function getTopModal(ignoreId) {
    let top = null;
    let highestZIndex = Number.NEGATIVE_INFINITY;
    for (const modal of document.querySelectorAll(OPEN_DIALOG_SELECTOR)) {
      if (ignoreId && modal.id === ignoreId) continue;
      const parsedZIndex = Number(getComputedStyle(modal).zIndex);
      const zIndex = Number.isFinite(parsedZIndex) ? parsedZIndex : 0;
      if (!top || zIndex >= highestZIndex) {
        top = modal;
        highestZIndex = zIndex;
      }
    }
    return top;
  }
  function syncModalSemantics() {
    const top = getTopModal();
    document.querySelectorAll(DIALOG_SELECTOR).forEach((modal) => {
      modal.removeAttribute("aria-modal");
      modal.removeAttribute("aria-hidden");
      if (modal.hidden) return;
      if (modal === top) modal.setAttribute("aria-modal", "true");
      else modal.setAttribute("aria-hidden", "true");
    });
  }

  // Escape and backdrop-click close whichever modal is open, via its own
  // close button (not by setting .hidden directly) — several modals
  // (Songs, Simulations builders) run cleanup like stopping playback in
  // their close handler, which a bare .hidden = true would skip.
  function closeTopModal() {
    const modal = getTopModal();
    if (!modal) return false;
    const closeBtn = modal.querySelector('button[id^="close-"]');
    if (closeBtn) closeBtn.click();
    else modal.hidden = true;
    return true;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || e.defaultPrevented) return;
    if (closeTopModal()) {
      e.preventDefault();
      return;
    }
    if (writingFocusState) {
      e.preventDefault();
      closeWritingFocus();
    } else if (el("recent-items-panel").classList.contains("open")) {
      e.preventDefault();
      closeRecentItemsMenu();
    } else if (notifPanel.classList.contains("open")) {
      e.preventDefault();
      closeNotifMenu();
    } else if (selectedBlockId !== null || multiSelectedIds.size > 0) {
      // With no dialog or dropdown open, Escape clears the canvas selection
      // and closes the Inspector.
      e.preventDefault();
      selectedBlockId = null;
      multiSelectedIds.clear();
      renderCanvas();
      renderInspector();
    }
  });
  document.querySelectorAll(".modal").forEach((modal) => {
    modal.addEventListener("click", (e) => {
      // the editor-help dialog closes itself; letting this run too would close the editor under it
      if (e.target === modal && modal.id !== "editor-help-modal") closeTopModal();
    });
  });

  // Focus trap — previously no modal in the app managed keyboard focus at
  // all, so Tab from inside an open modal walked straight into whatever
  // background page control happened to be next in DOM order (the canvas,
  // the sidebar nav, another modal's controls hidden behind this one).
  // Reuses getTopModal() so a modal opened from inside another modal (e.g.
  // Media Library from the Articles editor) traps against the one actually
  // on top, not the one underneath it.
  function focusableIn(container) {
    return Array.from(
      container.querySelectorAll(
        'a[href], area[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), iframe, object, embed, audio[controls], video[controls], summary, [contenteditable]:not([contenteditable="false"]), [tabindex]:not([tabindex="-1"])'
      )
    ).filter((node) => !node.hasAttribute("data-modal-focus-sentinel") && node.offsetParent !== null && node.tabIndex >= 0);
  }
  function initialFocusInModal(modal) {
    const explicit = modal.querySelector("[autofocus]");
    if (explicit && explicit.offsetParent !== null) return explicit;
    const title = modal.querySelector(".modal-inner > header h1");
    if (title) {
      if (!title.hasAttribute("tabindex")) title.setAttribute("tabindex", "-1");
      return title;
    }
    const first = focusableIn(modal)[0];
    if (first) return first;
    if (!modal.hasAttribute("tabindex")) modal.setAttribute("tabindex", "-1");
    return modal;
  }
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Tab") return;
    const modal = getTopModal();
    if (!modal) return;
    const focusable = focusableIn(modal);
    if (!focusable.length) return;
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIndex = focusable.indexOf(document.activeElement);
    if (activeIndex === -1) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && activeIndex === 0) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && activeIndex === focusable.length - 1) {
      e.preventDefault();
      first.focus();
    }
  });
  // A frame's keyboard events stay inside its own document, so the parent
  // page cannot trap Tab at the frame boundary. A focusable sentinel after
  // the preview iframe redirects forward traversal to the next modal control
  // or wraps to the first. The dialog has ordinary controls before the frame,
  // so reverse traversal returns to those directly. The outside-focus guard
  // is a fallback for other programmatic focus changes.
  document.addEventListener("focusin", (e) => {
    const modal = getTopModal();
    if (!modal) return;
    if (e.target.hasAttribute("data-modal-focus-sentinel") && modal.contains(e.target)) {
      const frame = e.target.previousElementSibling;
      const focusable = focusableIn(modal);
      const frameIndex = focusable.indexOf(frame);
      const nextFocus = frameIndex >= 0
        ? focusable[frameIndex + 1] || focusable.find((node) => node !== frame)
        : focusable[0];
      (nextFocus || initialFocusInModal(modal)).focus();
      return;
    }
    if (!modal || modal.contains(e.target)) return;
    initialFocusInModal(modal).focus();
  });

  // The other half of the same pattern: once a modal closes, return focus
  // to whatever triggered it, rather than leaving it wherever the modal's
  // own contents last had it (often nowhere, since closing typically hides
  // the focused element itself, dropping focus to <body>). A
  // MutationObserver on the shared `hidden` attribute — not a wrapper
  // around every individual open/close call site — since several modals
  // (Songs, Simulations builders) already run their own cleanup in a
  // dedicated close handler that a second wrapper risks double-firing.
  new MutationObserver((mutations) => {
    for (const m of mutations) {
      const modal = m.target;
      if (!(modal instanceof HTMLElement) || !modal.matches(DIALOG_SELECTOR)) continue;
      if (modal.hidden) {
        const restore = modalFocusReturn.get(modal);
        modalFocusReturn.delete(modal);
        if (restore && document.body.contains(restore)) restore.focus();
      } else if (!modalFocusReturn.has(modal)) {
        const active = document.activeElement;
        modalFocusReturn.set(modal, active);
        if (!modal.contains(active)) initialFocusInModal(modal).focus();
      }
    }
  }).observe(document.body, { attributes: true, attributeFilter: ["hidden"], subtree: true });

  // Crash/failed-save monitoring — previously only the worker's own
  // uncaught-exception handler ever wrote to error_log; a JS error inside
  // the Photo Editor, Song builder, or Simulation builder (all admin-only,
  // canvas/Web-Audio-heavy code with real crash surface) just vanished
  // with nothing to look back at later, since those scripts run as plain
  // <script> tags sharing this page's window rather than importing this
  // IIFE. A single pair of window-level listeners here catches uncaught
  // errors and promise rejections from all of them at once, tagged with
  // whichever editor modal (if any) is open at the time so the existing
  // Error Log viewer can tell them apart from a generic admin-page crash.
  // A critic pass caught two real gaps in the first version: (1) a
  // repeating crash (a requestAnimationFrame/canvas render loop throwing
  // every frame — exactly the failure mode this canvas/Web-Audio-heavy
  // code is prone to) flooded error_log with dozens of near-identical
  // rows within a second, crowding real/older errors out of both the
  // 300-row DB cap and the admin viewer's own 50-row display; (2) a
  // non-Error thrown/rejected value (a plain object, a bare string)
  // produced a useless "[object Object]" row with no real information.
  // The dedup window is per-page-load only (a plain in-memory Map, not
  // persisted) — a fresh reload is itself a reasonable "give it another
  // chance to log" reset point, matching this codebase's existing
  // throttle patterns (e.g. db.js's PAGE_SNAPSHOT_THROTTLE_MS) rather
  // than building new persistent rate-limit infrastructure for a
  // single-admin tool.
  const recentClientErrors = new Map();
  const CLIENT_ERROR_DEDUP_MS = 10000;
  function reportClientError(message, stack, source) {
    try {
      const safeMessage = String(message ?? "Unknown error").slice(0, 2000);
      const key = source + "|" + safeMessage.slice(0, 200);
      const now = Date.now();
      if (now - (recentClientErrors.get(key) || 0) < CLIENT_ERROR_DEDUP_MS) return;
      recentClientErrors.set(key, now);
      const payload = JSON.stringify({ message: safeMessage, stack: stack ? String(stack).slice(0, 4000) : null, source });
      if (navigator.sendBeacon) navigator.sendBeacon("/api/admin/client-error", payload);
      else fetch("/api/admin/client-error", { method: "POST", body: payload, keepalive: true });
    } catch {}
  }
  function currentEditorSource() {
    const modal = getTopModal();
    if (!modal) return "admin";
    if (modal.id === "photo-editor-modal") return "photo-editor";
    if (modal.id === "song-builder-modal") return "song-builder";
    if (modal.id === "simulation-builder-modal") return "simulation-builder";
    return "admin";
  }
  // A thrown/rejected value isn't always an Error — canvas/Web-Audio code
  // in particular sometimes throws a plain object or a bare string.
  // Coercing straight to a string in that case just produces
  // "[object Object]", a log row with zero actionable information.
  // A plain object with a circular reference (a real, easy-to-hit shape in
  // canvas/DOM-heavy code, e.g. accidentally throwing an event or a node
  // that references its own parent) makes JSON.stringify throw — a second
  // critic pass caught that this then fell back to plain String(value),
  // silently reintroducing the exact "[object Object]" uselessness this
  // helper exists to eliminate. A WeakSet-tracked replacer lets circular
  // structures stringify successfully instead, marking the repeated
  // reference rather than giving up on the whole object.
  function safeStringify(value) {
    const seen = new WeakSet();
    try {
      return JSON.stringify(value, (key, val) => {
        if (val && typeof val === "object") {
          if (seen.has(val)) return "[Circular]";
          seen.add(val);
        }
        return val;
      });
    } catch {
      return null;
    }
  }
  function describeThrown(value, fallback) {
    if (value instanceof Error) return { message: value.message, stack: value.stack };
    if (value && typeof value === "object") {
      const json = safeStringify(value);
      if (json) return { message: json, stack: null };
      // Stringify failed for a reason other than circularity (e.g. a
      // BigInt field) -- name at least the constructor rather than
      // falling all the way back to a useless "[object Object]".
      const name = value.constructor && value.constructor.name;
      return { message: `[${name || "Object"} thrown, could not serialize]`, stack: null };
    }
    return { message: value !== undefined && value !== null ? String(value) : fallback, stack: null };
  }
  window.addEventListener("error", (e) => {
    const { message, stack } = describeThrown(e.error, e.message);
    reportClientError(message, stack, currentEditorSource());
  });
  window.addEventListener("unhandledrejection", (e) => {
    const { message, stack } = describeThrown(e.reason, "Unhandled promise rejection");
    reportClientError(message, stack, currentEditorSource());
  });

  window.addEventListener("resize", () => renderCanvas());
  boot();
})();
