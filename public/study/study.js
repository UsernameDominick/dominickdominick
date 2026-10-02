// STUDY (temporary): the button on a page that opens a password-protected study page in a popup.
// The page is not in the HTML: the password goes to /api/study/unlock and only a right one gets it back, which is then shown
// in a sandboxed frame (no access to this site's cookies, storage or pages). Built on the browser's own <dialog>, so Esc closes
// it and keyboard focus stays inside while it is open. See worker/study/README.md for how to remove it.
(function () {
  if (typeof HTMLDialogElement !== "function") return;

  var made = 0;

  function build(block, opener) {
    var n = ++made;
    var title = block.getAttribute("data-study-title") || "Study";
    var dialog = document.createElement("dialog");
    dialog.className = "study-dialog";
    dialog.setAttribute("aria-labelledby", "study-title-" + n);
    dialog.innerHTML =
      '<div class="study-bar"><h2 class="study-title" id="study-title-' + n + '"></h2>' +
      '<button type="button" class="study-close" aria-label="Close">×</button></div>' +
      '<form class="study-gate" novalidate>' +
      '<p class="study-lead">This one is locked. Enter the password to open it.</p>' +
      '<label class="study-label" for="study-pw-' + n + '">Password</label>' +
      '<input class="study-input" id="study-pw-' + n + '" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required>' +
      '<button type="submit" class="btn study-submit">Unlock</button>' +
      '<p class="study-status" role="status" aria-live="polite"></p></form>' +
      '<div class="study-stage" hidden></div>';
    dialog.querySelector(".study-title").textContent = title;
    document.body.appendChild(dialog);

    var form = dialog.querySelector(".study-gate");
    var input = dialog.querySelector(".study-input");
    var submit = dialog.querySelector(".study-submit");
    var status = dialog.querySelector(".study-status");
    var stage = dialog.querySelector(".study-stage");
    var frame = null;

    function close() {
      if (dialog.open) dialog.close();
    }
    dialog.querySelector(".study-close").addEventListener("click", close);
    // A press on the dark area around the popup closes it (a press inside it does not).
    dialog.addEventListener("mousedown", function (e) {
      dialog._downOnBackdrop = e.target === dialog;
    });
    dialog.addEventListener("click", function (e) {
      if (e.target === dialog && dialog._downOnBackdrop) close();
    });
    dialog.addEventListener("close", function () {
      document.documentElement.classList.remove("study-is-open");
      if (document.contains(opener) && typeof opener.focus === "function") opener.focus({ preventScroll: true });
    });

    function say(text) {
      status.textContent = text;
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var password = input.value;
      if (!password.trim()) {
        say("Type the password first.");
        input.focus();
        return;
      }
      submit.disabled = true;
      say("Checking…");
      fetch("/api/study/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: Number(block.getAttribute("data-study-block")), password: password }),
      })
        .then(function (res) {
          if (res.ok) return res.text().then(function (html) { return { html: html }; });
          return res.json().then(
            function (body) { return { error: (body && body.error) || "That didn't work." }; },
            function () { return { error: "That didn't work." }; }
          );
        })
        .then(function (result) {
          submit.disabled = false;
          if (result.error) {
            say(result.error);
            input.select();
            return;
          }
          input.value = "";
          say("");
          frame = document.createElement("iframe");
          frame.className = "study-frame";
          frame.title = title;
          frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
          frame.srcdoc = result.html;
          stage.appendChild(frame);
          form.hidden = true;
          stage.hidden = false;
          frame.focus();
        })
        .catch(function () {
          submit.disabled = false;
          say("Couldn't reach the site. Check your connection and try again.");
        });
    });

    dialog._focusStart = function () {
      if (frame) frame.focus();
      else input.focus();
    };
    return dialog;
  }

  document.addEventListener("click", function (e) {
    var button = e.target.closest && e.target.closest(".study-block .study-open");
    if (!button) return;
    var block = button.closest(".study-block");
    if (!block._studyDialog) block._studyDialog = build(block, button);
    var dialog = block._studyDialog;
    document.documentElement.classList.add("study-is-open");
    if (!dialog.open) dialog.showModal();
    dialog._focusStart();
  });
})();
