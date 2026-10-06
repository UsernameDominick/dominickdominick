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

  // Download PDF — no server-side rendering at all: the browser's own
  // print dialog already lets you pick "Save as PDF" as the destination,
  // and the @media print stylesheet already strips the chrome (nav,
  // search, toggles, share buttons) down to just the readable content.
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".print-pdf-btn");
    if (!btn) return;
    if (window.trackEvent) window.trackEvent("download_pdf");
    window.print();
  });

  // Read aloud — browser-native Web Speech API against the rendered body
  // text, no server involvement and no uploaded audio required. Doubles as
  // a real accessibility feature for any article/project, not just ones
  // with a narration file.
  (function () {
    var btn = document.querySelector(".read-aloud-btn");
    var content = document.getElementById("readable-content");
    if (!btn || !content) return;
    if (!("speechSynthesis" in window)) {
      btn.hidden = true;
      return;
    }
    var utterance = null;
    // Only the words change; the speaker icon stays.
    function setLabel(text) {
      var label = btn.querySelector(".read-aloud-label");
      if (label) label.textContent = text;
      else btn.textContent = text;
    }
    function stop() {
      window.speechSynthesis.cancel();
      utterance = null;
      setLabel(btn.dataset.labelRead || "Read aloud");
    }
    btn.addEventListener("click", function () {
      if (window.speechSynthesis.speaking) {
        stop();
        return;
      }
      // Embedded circuits, songs and scans (their labels and buttons) aren't text to be read out: hide them for the moment innerText is taken.
      var embeds = content.querySelectorAll(".body-embed");
      embeds.forEach(function (e) { e.hidden = true; });
      var spoken = content.innerText;
      embeds.forEach(function (e) { e.hidden = false; });
      utterance = new SpeechSynthesisUtterance(spoken);
      utterance.onend = stop;
      utterance.onerror = stop;
      window.speechSynthesis.speak(utterance);
      setLabel(btn.dataset.labelStop || "Stop reading");
    });
    // Leaving the page mid-utterance shouldn't leave speech running.
    window.addEventListener("beforeunload", function () {
      window.speechSynthesis.cancel();
    });
  })();

  // Code-block copy buttons + line numbers. Reads `.textContent`, which
  // highlight.js's own re-rendering of `<code>` doesn't change, so this
  // works whether it runs before or after highlightAll() — no ordering
  // dependency between the two deferred scripts.
  document.querySelectorAll("pre").forEach(function (pre) {
    var code = pre.querySelector("code");
    if (!code) return;
    var btn = document.createElement("button");
    btn.type = "button";
    btn.className = "code-copy-btn";
    btn.textContent = "Copy";
    btn.setAttribute("aria-label", "Copy code");
    btn.addEventListener("click", function () {
      navigator.clipboard.writeText(code.textContent).then(function () {
        btn.textContent = "Copied!";
        setTimeout(function () {
          btn.textContent = "Copy";
        }, 1500);
      });
    });
    pre.appendChild(btn);

    var lines = code.textContent.replace(/\n$/, "").split("\n");
    if (lines.length > 1) {
      pre.classList.add("has-line-numbers");
      var gutter = document.createElement("span");
      gutter.className = "code-line-numbers";
      gutter.setAttribute("aria-hidden", "true");
      gutter.textContent = lines.map(function (_, i) {
        return i + 1;
      }).join("\n");
      pre.insertBefore(gutter, code);
    }
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

  // Reactions — one vote per emoji per item, discouraged (not enforced)
  // client-side via localStorage, since there's no visitor identity to
  // dedupe against server-side.
  var REACTED_KEY = "reacted_items";
  function getReactedSet() {
    try {
      var raw = localStorage.getItem(REACTED_KEY);
      return raw ? JSON.parse(raw) : [];
    } catch (e) {
      return [];
    }
  }
  function markReacted(key) {
    try {
      var set = getReactedSet();
      if (set.indexOf(key) === -1) {
        set.push(key);
        localStorage.setItem(REACTED_KEY, JSON.stringify(set));
      }
    } catch (e) {}
  }
  document.querySelectorAll(".reactions").forEach(function (wrap) {
    var contentType = wrap.dataset.contentType;
    var contentId = wrap.dataset.contentId;
    wrap.querySelectorAll(".reaction-btn").forEach(function (btn) {
      var key = contentType + ":" + contentId + ":" + btn.dataset.emoji;
      if (getReactedSet().indexOf(key) !== -1) btn.classList.add("is-reacted");
    });
  });
  document.addEventListener("click", function (e) {
    var btn = e.target.closest(".reaction-btn");
    if (!btn) return;
    var wrap = btn.closest(".reactions");
    if (!wrap) return;
    var key = wrap.dataset.contentType + ":" + wrap.dataset.contentId + ":" + btn.dataset.emoji;
    if (getReactedSet().indexOf(key) !== -1) return;
    markReacted(key);
    btn.classList.add("is-reacted");
    var countEl = btn.querySelector(".reaction-count");
    if (countEl) countEl.textContent = String(Number(countEl.textContent || "0") + 1);
    fetch("/api/react", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contentType: wrap.dataset.contentType, contentId: Number(wrap.dataset.contentId), emoji: btn.dataset.emoji }),
    }).catch(function () {});
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

  // Reading completion: "read_complete" is sent once per visit, when the reader has reached the end of the text and has stayed long
  // enough for it to be believable that they read it: 40% of the time the length suggests at 200 words a minute (never under 10 or
  // over 120 seconds), counting only the seconds the tab is visible. Nothing is stored in the browser. The Analytics window shows it as
  // "read to the end", per article and project, next to the views.
  (function () {
    var content = document.getElementById("readable-content");
    if (!content || !window.IntersectionObserver || !window.trackEvent) return;
    var words = (content.textContent || "").trim().split(/\s+/).filter(Boolean).length;
    var need = Math.min(120, Math.max(10, Math.round((words / 200) * 60 * 0.4)));
    var end = content.lastElementChild || content;
    var seen = false;
    var seconds = 0;
    var sent = false;
    var timer = null;
    var observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (entry.isIntersecting) seen = true;
      });
      check();
    });
    function check() {
      if (sent || !seen || seconds < need) return;
      sent = true;
      clearInterval(timer);
      observer.disconnect();
      window.trackEvent("read_complete", String(seconds));
    }
    timer = setInterval(function () {
      if (document.visibilityState === "visible") seconds++;
      check();
    }, 1000);
    observer.observe(end);
  })();
})();
