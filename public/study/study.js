// STUDY (temporary): the button on a page that opens a password-protected study page in a popup.
// The page is not in the HTML: it is asked for from /api/study/unlock (a block that asks for a password only gets it back for a right
// one, and a block that does not opens straight away), and is then shown
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
      '<p class="study-opening" role="status">Opening…</p>' +
      '<form class="study-gate" novalidate hidden>' +
      '<p class="study-lead">This one is locked. Enter the password to open it.</p>' +
      '<label class="study-label" for="study-pw-' + n + '">Password</label>' +
      '<input class="study-input" id="study-pw-' + n + '" type="password" autocomplete="off" autocapitalize="none" spellcheck="false" required>' +
      '<button type="submit" class="btn study-submit">Unlock</button>' +
      '<p class="study-status" role="status" aria-live="polite"></p></form>' +
      '<div class="study-stage" hidden></div>';
    dialog.querySelector(".study-title").textContent = title;
    document.body.appendChild(dialog);

    var opening = dialog.querySelector(".study-opening");
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

    function showFrame(html) {
      input.value = "";
      say("");
      opening.hidden = true;
      frame = document.createElement("iframe");
      frame.className = "study-frame";
      frame.title = title;
      frame.setAttribute("sandbox", "allow-scripts allow-popups allow-popups-to-escape-sandbox");
      frame.srcdoc = html;
      stage.appendChild(frame);
      form.hidden = true;
      stage.hidden = false;
      frame.focus();
    }
    function showForm() {
      opening.hidden = true;
      form.hidden = false;
      input.focus();
    }

    // Asks for the study page. `probing` is the first ask, made with no password: a block that needs none just opens, otherwise the form shows.
    function attempt(password, probing) {
      if (!probing) {
        submit.disabled = true;
        say("Checking…");
      }
      return fetch("/api/study/unlock", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ block: Number(block.getAttribute("data-study-block")), password: password }),
      })
        .then(function (res) {
          if (res.ok) return res.text().then(function (html) { return { html: html }; });
          return res.json().then(
            function (body) { return { error: (body && body.error) || "That didn't work.", needs: !!(body && body.needsPassword), status: res.status }; },
            function () { return { error: "Something went wrong on the site (error " + res.status + "). Try again in a minute.", status: res.status }; }
          );
        })
        .then(function (result) {
          submit.disabled = false;
          if (result.html != null) {
            showFrame(result.html);
            return;
          }
          if (probing) {
            // No password was typed yet, so "type the password" is not news; anything else (too many tries, a server error) is.
            showForm();
            say(result.needs ? "" : result.error);
            return;
          }
          say(result.error);
          input.select();
        })
        .catch(function () {
          submit.disabled = false;
          if (probing) showForm();
          say("Couldn't reach the site. Check your connection and try again.");
        });
    }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!input.value.trim()) {
        say("Type the password first.");
        input.focus();
        return;
      }
      attempt(input.value, false);
    });

    dialog._probe = function () {
      attempt("", true);
    };
    dialog._focusStart = function () {
      if (frame) frame.focus();
      else if (!form.hidden) input.focus();
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
    if (!dialog._probed) {
      dialog._probed = true;
      dialog._probe();
    }
    dialog._focusStart();
  });
})();
