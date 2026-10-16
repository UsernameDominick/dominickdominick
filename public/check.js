// Runs first on index.html: anyone the browser has not seen enter the password goes to the login page.
(function () {
  var ok = false;
  try { ok = localStorage.getItem(window.GATE.key) === window.GATE.hash; } catch (e) {}
  if (!ok) location.replace("/login.html");
})();
