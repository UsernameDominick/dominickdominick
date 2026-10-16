// The login page: the right password is remembered by the browser and leads to index.html.
(function () {
  var G = window.GATE;
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
          { name: "PBKDF2", hash: "SHA-256", salt: unhex(G.salt), iterations: G.iterations },
          key, 256);
      })
      .then(hex);
  }

  function enter() {
    location.replace("/");
  }

  try {
    if (localStorage.getItem(G.key) === G.hash) enter();
  } catch (e) {}

  form.addEventListener("submit", function (e) {
    e.preventDefault();
    msg.textContent = "";
    if (!window.crypto || !crypto.subtle) {
      msg.textContent = "This browser can't check the password.";
      return;
    }
    derive(input.value).then(function (h) {
      if (h === G.hash) {
        try { localStorage.setItem(G.key, G.hash); } catch (e) {}
        enter();
      } else {
        msg.textContent = "Wrong password.";
        input.select();
      }
    });
  });
})();
