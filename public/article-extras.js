(function () {
  // Reading progress bar — only present on article pages.
  var bar = document.querySelector(".reading-progress");
  if (bar) {
    var update = function () {
      var doc = document.documentElement;
      var scrollable = doc.scrollHeight - window.innerHeight;
      var pct = scrollable > 0 ? (window.scrollY / scrollable) * 100 : 0;
      bar.style.width = Math.min(100, Math.max(0, pct)) + "%";
    };
    update();
    window.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
  }

  // Copy-link button — copies the current page URL to the clipboard.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".copy-link-btn");
    if (!btn) return;
    var reset = function () {
      btn.textContent = btn.dataset.copyText || "Copy link";
    };
    navigator.clipboard
      .writeText(window.location.href)
      .then(function () {
        btn.textContent = btn.dataset.copiedText || "Copied!";
        setTimeout(reset, 1800);
        if (window.trackEvent) window.trackEvent("copy_link");
      })
      .catch(function () {
        reset();
      });
  });

  // Save for later — client-side bookmarking (localStorage only, same as
  // reading history), toggled from the button next to the share links.
  var SAVED_KEY = "saved_items";
  function readSaved() {
    try {
      var raw = localStorage.getItem(SAVED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function writeSaved(list) {
    try {
      localStorage.setItem(SAVED_KEY, JSON.stringify(list));
    } catch (e) {}
  }
  function setSaveBtnState(btn) {
    var isSaved = readSaved().some(function (s) {
      return s.url === btn.dataset.url;
    });
    btn.textContent = isSaved ? btn.dataset.savedText || "Saved" : btn.dataset.saveText || "Save for later";
    btn.classList.toggle("is-saved", isSaved);
  }
  document.querySelectorAll(".save-for-later-btn").forEach(setSaveBtnState);
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".save-for-later-btn");
    if (!btn) return;
    var list = readSaved();
    var idx = list.findIndex(function (s) {
      return s.url === btn.dataset.url;
    });
    if (idx === -1) {
      list.unshift({ url: btn.dataset.url, title: btn.dataset.title, savedAt: new Date().toISOString() });
    } else {
      list.splice(idx, 1);
    }
    writeSaved(list);
    setSaveBtnState(btn);
  });

  // /saved page — this file is loaded (deferred) on every page, same as
  // nav.js's reading-history render, so it's already running after the DOM
  // (including #saved-items-list, when present) has been parsed.
  var savedList = document.getElementById("saved-items-list");
  if (savedList) {
    function renderSavedList() {
      var items = readSaved();
      if (!items.length) {
        savedList.innerHTML = '<p class="empty-hint">Nothing saved yet.</p>';
        return;
      }
      savedList.innerHTML =
        '<ul class="archive-list">' +
        items
          .map(function (it, i) {
            var a = document.createElement("a");
            a.href = it.url;
            a.textContent = it.title;
            return "<li>" + a.outerHTML + ' <button type="button" class="remove-saved-btn" data-index="' + i + '">Remove</button></li>';
          })
          .join("") +
        "</ul>";
      savedList.querySelectorAll(".remove-saved-btn").forEach(function (btn) {
        btn.addEventListener("click", function () {
          var items = readSaved();
          items.splice(Number(btn.dataset.index), 1);
          writeSaved(items);
          renderSavedList();
        });
      });
    }
    renderSavedList();
    var clearBtn = document.getElementById("clear-saved-btn");
    if (clearBtn) {
      clearBtn.addEventListener("click", function () {
        writeSaved([]);
        renderSavedList();
      });
    }
  }
})();
