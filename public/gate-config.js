// Only a salted PBKDF2 hash of the password is stored here, never the password.
// The check runs in the browser, so it is a front door, not real security.
window.GATE = {
  salt: "2b95508f3e6efb73b1819a67cad935c6",
  iterations: 310000,
  hash: "b1490d258d46f153137cb005b1b45d6960a8d050612db25e724e6fbca8062878",
  key: "gate"
};
