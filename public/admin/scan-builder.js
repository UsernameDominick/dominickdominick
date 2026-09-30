(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);

  let scans = [];
  let currentScanId = null;
  let currentScanData = {};

  // Used in both text and attribute positions (data-name="..."), so quotes are escaped too.
  function escapeXml(s) {
    return String(s == null ? "" : s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatSize(bytes) {
    if (!bytes) return "";
    const mb = bytes / (1024 * 1024);
    return mb >= 1 ? `${mb.toFixed(1)}MB` : `${Math.round(bytes / 1024)}KB`;
  }

  // Raw-bytes upload, parallel to uploadFile() in app.js but hitting the
  // dedicated /scan-upload endpoint (which validates size/kind and writes
  // straight to R2 under scans/) instead of the plain image upload route.
  async function uploadScanFile(file, kind) {
    const res = await fetch(`/api/admin/scan-upload?kind=${encodeURIComponent(kind)}`, {
      method: "POST",
      headers: { "Content-Type": file.type || "application/octet-stream" },
      body: file,
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error || "Upload failed");
    }
    return res.json();
  }

  // ---------- List modal ----------
  async function loadScansList() {
    scans = await window.adminApi("/scans");
    renderScansList();
  }

  function renderScansList() {
    $("scans-list").innerHTML =
      scans
        .map(
          (s) =>
            `<div class="simulation-row"><span>${escapeXml(s.name)}</span><button type="button" class="usage-scan" data-id="${
              s.id
            }" data-name="${escapeXml(s.name)}" title="See which pages/projects use this scan">Usage</button><button type="button" class="edit-scan" data-id="${
              s.id
            }">Edit</button><button type="button" class="delete-scan" data-id="${s.id}">Delete</button></div>`
        )
        .join("") || "<p style='color:var(--text-dim);font-size:0.85rem;'>No scans yet.</p>";

    $("scans-list")
      .querySelectorAll(".edit-scan")
      .forEach((btn) => btn.addEventListener("click", () => openScanEditor(Number(btn.dataset.id))));
    $("scans-list")
      .querySelectorAll(".usage-scan")
      .forEach((btn) => btn.addEventListener("click", () => window.showContentUsage("scan", btn.dataset.id, btn.dataset.name)));
    $("scans-list")
      .querySelectorAll(".delete-scan")
      .forEach((btn) => btn.addEventListener("click", () => deleteScan(Number(btn.dataset.id))));
  }

  async function deleteScan(id) {
    const usage = await window.adminApi(`/content-usage?type=scan&id=${id}`).catch(() => []);
    const msg = usage.length
      ? `This scan is used in: ${usage.map((u) => u.title).join(", ")}. Delete anyway? Those blocks will be omitted from public pages until replaced.`
      : "Delete this scan? This can't be undone.";
    if (!confirm(msg)) return false;
    await window.adminApi(`/scans/${id}`, { method: "DELETE" });
    await loadScansList();
    return true;
  }

  $("scans-btn").addEventListener("click", async () => {
    $("scans-modal").hidden = false;
    await loadScansList();
  });
  $("close-scans").addEventListener("click", () => ($("scans-modal").hidden = true));
  $("new-scan-btn").addEventListener("click", () => openScanEditor(null));

  // ---------- Editor ----------
  function resetPreview() {
    const viewer = $("scan-preview-viewer");
    viewer.removeAttribute("src");
    viewer.removeAttribute("ios-src");
    viewer.removeAttribute("poster");
    viewer.removeAttribute("camera-orbit");
    viewer.removeAttribute("field-of-view");
    $("scan-preview-hint").hidden = false;
  }

  async function openScanEditor(id) {
    currentScanId = id;
    $("scan-glb-status").textContent = "";
    $("scan-usdz-status").textContent = "";
    $("scan-camera-status").textContent = "";
    $("scan-glb-input").value = "";
    $("scan-usdz-input").value = "";
    resetPreview();
    if (id) {
      const scan = await window.adminApi(`/scans/${id}`);
      currentScanData = { ...scan };
      $("scan-name").value = scan.name;
      $("scan-poster-url").value = scan.poster_key ? (scan.poster_key.startsWith("/") ? scan.poster_key : `/media/${scan.poster_key}`) : "";
      applyPreview();
      if (scan.size) $("scan-glb-status").textContent = `Current file: ${formatSize(scan.size)}`;
    } else {
      currentScanData = {};
      $("scan-name").value = "New scan";
      $("scan-poster-url").value = "";
    }
    $("scans-modal").hidden = true;
    $("scan-editor-modal").hidden = false;
  }

  $("close-scan-editor").addEventListener("click", () => {
    $("scan-editor-modal").hidden = true;
    $("scans-modal").hidden = false;
    loadScansList().catch(() => {});
  });

  function applyPreview() {
    const viewer = $("scan-preview-viewer");
    if (!currentScanData.glb_key) {
      resetPreview();
      return;
    }
    viewer.src = `/media/${currentScanData.glb_key}`;
    if (currentScanData.usdz_key) viewer.setAttribute("ios-src", `/media/${currentScanData.usdz_key}`);
    else viewer.removeAttribute("ios-src");
    const posterVal = $("scan-poster-url").value.trim();
    if (posterVal) viewer.setAttribute("poster", posterVal);
    else viewer.removeAttribute("poster");
    if (currentScanData.camera_orbit) viewer.setAttribute("camera-orbit", currentScanData.camera_orbit);
    if (currentScanData.field_of_view) viewer.setAttribute("field-of-view", currentScanData.field_of_view);
    $("scan-preview-hint").hidden = true;
  }

  $("scan-glb-input").addEventListener("change", async () => {
    const file = $("scan-glb-input").files[0];
    if (!file) return;
    const kind = /\.gltf$/i.test(file.name) ? "gltf" : "glb";
    $("scan-glb-status").textContent = "Uploading…";
    try {
      const { key, size } = await uploadScanFile(file, kind);
      currentScanData.glb_key = key;
      currentScanData.size = size;
      $("scan-glb-status").textContent = `${file.name} (${formatSize(size)})`;
      applyPreview();
    } catch (err) {
      $("scan-glb-status").textContent = "";
      alert(err.message);
    } finally {
      $("scan-glb-input").value = "";
    }
  });

  $("scan-usdz-input").addEventListener("change", async () => {
    const file = $("scan-usdz-input").files[0];
    if (!file) return;
    $("scan-usdz-status").textContent = "Uploading…";
    try {
      const { key, size } = await uploadScanFile(file, "usdz");
      currentScanData.usdz_key = key;
      $("scan-usdz-status").textContent = `${file.name} (${formatSize(size)})`;
      applyPreview();
    } catch (err) {
      $("scan-usdz-status").textContent = "";
      alert(err.message);
    } finally {
      $("scan-usdz-input").value = "";
    }
  });

  $("scan-poster-url").addEventListener("change", applyPreview);

  $("scan-use-current-view-btn").addEventListener("click", () => {
    const viewer = $("scan-preview-viewer");
    if (!currentScanData.glb_key) return alert("Upload a model file first.");
    const orbit = viewer.getCameraOrbit();
    const target = viewer.getCameraTarget();
    const fov = viewer.getFieldOfView();
    currentScanData.camera_orbit = orbit.toString();
    currentScanData.camera_target = target.toString();
    currentScanData.field_of_view = `${fov.toFixed(2)}deg`;
    $("scan-camera-status").textContent = `Camera saved: ${currentScanData.camera_orbit}`;
  });

  $("delete-scan-btn").addEventListener("click", async () => {
    if (!currentScanId) {
      $("scan-editor-modal").hidden = true;
      $("scans-modal").hidden = false;
      return;
    }
    const deleted = await deleteScan(currentScanId);
    if (deleted) {
      $("scan-editor-modal").hidden = true;
      $("scans-modal").hidden = false;
    }
  });

  $("save-scan-btn").addEventListener("click", async () => {
    const name = $("scan-name").value.trim();
    if (!name) return alert("Name is required.");
    if (!currentScanData.glb_key) return alert("Upload a .glb or .gltf model file first.");
    const body = {
      name,
      glb_key: currentScanData.glb_key,
      size: currentScanData.size || 0,
      usdz_key: currentScanData.usdz_key || null,
      poster_key: $("scan-poster-url").value.trim() || null,
      camera_orbit: currentScanData.camera_orbit || null,
      camera_target: currentScanData.camera_target || null,
      field_of_view: currentScanData.field_of_view || null,
    };
    try {
      if (currentScanId) {
        await window.adminApi(`/scans/${currentScanId}`, { method: "PATCH", body: JSON.stringify(body) });
      } else {
        const res = await window.adminApi("/scans", { method: "POST", body: JSON.stringify(body) });
        currentScanId = res.id;
      }
      alert("Saved.");
      if (window.refreshScanOptions) window.refreshScanOptions();
    } catch (err) {
      alert(err.message);
    }
  });
})();
