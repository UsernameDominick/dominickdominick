// HTTP byte ranges for /media (RFC 9110 section 14): Safari and iOS will not play or seek <audio> / <video> unless the server answers
// "Range: bytes=..." with 206 Partial Content. Only a single range is honoured; anything else that is not a valid range is ignored (the
// whole file is sent, which the standard allows), and a range that starts past the end of the file is 416.

// -> { type: "none" } | { type: "range", start, end } (inclusive, within the file) | { type: "unsatisfiable" }
export function parseByteRange(header, size) {
  if (header == null) return { type: "none" };
  const m = /^\s*bytes\s*=\s*(\d*)\s*-\s*(\d*)\s*$/i.exec(String(header));
  if (!m) return { type: "none" }; // another unit, several ranges, or junk: ignore the header
  const [, a, b] = m;
  if (a === "" && b === "") return { type: "none" };
  const total = Number(size);
  if (!Number.isFinite(total) || total < 0) return { type: "none" };
  if (a === "") {
    // "-N": the last N bytes
    const n = Number(b);
    if (!Number.isSafeInteger(n) || n <= 0) return { type: "unsatisfiable" };
    if (total === 0) return { type: "unsatisfiable" };
    return { type: "range", start: Math.max(0, total - n), end: total - 1 };
  }
  const start = Number(a);
  if (!Number.isSafeInteger(start)) return { type: "unsatisfiable" };
  if (start >= total) return { type: "unsatisfiable" };
  if (b === "") return { type: "range", start, end: total - 1 };
  const end = Number(b);
  if (!Number.isSafeInteger(end) || end < start) return { type: "none" }; // "5-2" is not a valid range: ignore it
  return { type: "range", start, end: Math.min(end, total - 1) };
}
