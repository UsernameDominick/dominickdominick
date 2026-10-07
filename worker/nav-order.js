// Where each stop of the nav dial goes: Home in the middle, the other stops split on either side of it in their usual order. Search is
// always the last stop (it sits on the right), so it counts as one of the right-hand stops. When the two sides would not be equally
// wide, `gap` is 1 and the left side gets one empty slot at its outer edge, so Home lands dead centre. Pure, so the worker and a node
// test share it. With no Home stop the order is left as it was.

export function centreHome(items, searchStops = 1) {
  const list = Array.isArray(items) ? items : [];
  const home = list.find((n) => n && n.slug === "home") || null;
  if (!home) return { left: [], home: null, right: list.slice(), gap: 0 };
  const others = list.filter((n) => n !== home);
  const total = others.length + Math.max(0, searchStops);
  const leftCount = Math.min(others.length, Math.floor(total / 2));
  return {
    left: others.slice(0, leftCount),
    home,
    right: others.slice(leftCount),
    gap: Math.max(0, total - leftCount - leftCount),
  };
}
