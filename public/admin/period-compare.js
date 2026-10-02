// Words for "this period against the one before it" in Analytics and on the Dashboard. Pure (no DOM), so a node test can load it.
(function () {
  // describe(current, previous, days) -> { text, trend } where trend is "up", "down", "same" or "none".
  function describe(current, previous, days) {
    const whole = (v, fallback) => (Number.isFinite(Number(v)) ? Math.floor(Number(v)) : fallback);
    const cur = Math.max(0, whole(current, 0));
    const prev = Math.max(0, whole(previous, 0));
    const n = Math.max(1, whole(days, 7) || 7);
    const span = n === 1 ? "the day before" : `the ${n} days before`;
    if (!cur && !prev) return { text: `No views in this period or in ${span}.`, trend: "none" };
    if (!prev) return { text: `${cur} view${cur === 1 ? "" : "s"}, none in ${span}.`, trend: "up" };
    if (cur === prev) return { text: `The same as ${span} (${prev}).`, trend: "same" };
    const pct = Math.round((Math.abs(cur - prev) / prev) * 100);
    // A change under half a percent rounds to 0%: say "about the same" rather than "0% more".
    if (pct === 0) return { text: `About the same as ${span} (${prev}).`, trend: "same" };
    return cur > prev
      ? { text: `${pct}% more than ${span} (${prev}).`, trend: "up" }
      : { text: `${pct}% fewer than ${span} (${prev}).`, trend: "down" };
  }
  window.PeriodCompare = { describe };
})();
