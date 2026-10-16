// Only a salted PBKDF2 hash of the password is stored here, never the password.
// The check runs in the browser, so it is a front door, not real security.
(function () {
  var SALT = "2b95508f3e6efb73b1819a67cad935c6";
  var ITERATIONS = 310000;
  var HASH = "b1490d258d46f153137cb005b1b45d6960a8d050612db25e724e6fbca8062878";
  var KEY = "gate";

  var form = document.getElementById("gate");
  var input = document.getElementById("pw");
  var msg = document.getElementById("msg");

  function hex(bytes) {
    return Array.prototype.map.call(new Uint8Array(bytes), function (b) {
      return b.toString(16).padStart(2, "0");
    }).join("");
  }

  function unhex(s) {
    var out = new Uint8Array(s.length / 2);
    for (var i = 0; i < out.length; i++) out[i] = parseInt(s.substr(i * 2, 2), 16);
    return out;
  }

  function derive(password) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"])
      .then(function (key) {
        return crypto.subtle.deriveBits(
          { name: "PBKDF2", hash: "SHA-256", salt: unhex(SALT), iterations: ITERATIONS },
          key, 256);
      })
      .then(hex);
  }

  function open() {
    form.hidden = true;
    document.title = "";
  }

  try {
    if (sessionStorage.getItem(KEY) === HASH) open();
  } catch (e) {}

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.textContent = "";
    if (!window.crypto || !crypto.subtle) {
      msg.textContent = "This browser can't check the password.";
      return;
    }
    derive(input.value).then(function (h) {
      if (h === HASH) {
        try { sessionStorage.setItem(KEY, HASH); } catch (e) {}
        open();
      } else {
        msg.textContent = "Wrong password.";
        input.select();
      }
    });
  });
})();
