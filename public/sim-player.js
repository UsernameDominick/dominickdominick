document.addEventListener("click", (e) => {
  const btn = e.target.closest(".sim-power-btn");
  if (!btn) return;
  const svg = document.getElementById(btn.dataset.target);
  if (!svg) return;
  const on = svg.classList.toggle("is-on");
  btn.textContent = on ? "Power off" : "Power on";
});
