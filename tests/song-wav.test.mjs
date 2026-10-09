// The audio export's writers: WAV (any number of channels, 16 or 24-bit integer or 32-bit float, optional dither) and the stored ZIP of stems.
// They are pure (song-files.js), so what they write is checked byte by byte.
import { loadSongFiles } from "./fake-audio.mjs";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined && !c ? " " + JSON.stringify(extra) : ""}`); };
const F = loadSongFiles();
const dv = (bytes) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
const str = (bytes, at, n) => String.fromCharCode(...bytes.slice(at, at + n));

// ---- a mono 16-bit file
{
  const wav = F.encodeWav([[0, 0.5, -0.5, 1]], 44100, "16", false);
  const v = dv(wav.bytes);
  ok(str(wav.bytes, 0, 4) === "RIFF" && str(wav.bytes, 8, 4) === "WAVE" && str(wav.bytes, 12, 4) === "fmt " && str(wav.bytes, 36, 4) === "data", "a WAV has the RIFF, WAVE, fmt and data markers");
  ok(v.getUint16(20, true) === 1 && v.getUint16(22, true) === 1 && v.getUint32(24, true) === 44100 && v.getUint16(34, true) === 16, "mono, 44100 Hz, 16-bit integer PCM");
  ok(v.getUint32(28, true) === 44100 * 2 && v.getUint16(32, true) === 2, "byte rate and block align follow");
  ok(wav.bytes.length === 44 + 8 && v.getUint32(40, true) === 8 && v.getUint32(4, true) === wav.bytes.length - 8, "the sizes in the header are right", wav.bytes.length);
  ok(v.getInt16(44, true) === 0 && v.getInt16(46, true) === Math.round(0.5 * 32767) && v.getInt16(48, true) === Math.round(-0.5 * 32767) && v.getInt16(50, true) === 32767, "the samples are scaled to the full range (1.0 is 32767)");
  ok(wav.peak === 1 && wav.clipped === 0, "the peak is reported, and exactly 1.0 is not clipped", [wav.peak, wav.clipped]);
  const hot = F.encodeWav([[0, 1.5, -2]], 44100, "16", false);
  ok(hot.clipped === 2 && hot.peak === 2 && dv(hot.bytes).getInt16(46, true) === 32767 && dv(hot.bytes).getInt16(48, true) === -32767, "samples beyond full scale are counted, reported and written at the limit", [hot.clipped, hot.peak]);
}

// ---- stereo is interleaved
{
  const wav = F.encodeWav([[0.25, 0.25], [-0.25, -0.5]], 48000, "16", false);
  const v = dv(wav.bytes);
  ok(v.getUint16(22, true) === 2 && v.getUint16(32, true) === 4 && v.getUint32(28, true) === 48000 * 4, "two channels: block align 4, byte rate 4 x the rate");
  const q = Math.round(0.25 * 32767);
  ok(v.getInt16(44, true) === q && v.getInt16(46, true) === -q && v.getInt16(48, true) === q && v.getInt16(50, true) === Math.round(-0.5 * 32767), "left and right are interleaved frame by frame");
  ok(v.getUint32(40, true) === 8 && wav.bytes.length === 52, "the data chunk is frames x channels x 2 bytes");
}

// ---- 24-bit and float
{
  const wav = F.encodeWav([[0.5, -0.5, 1]], 44100, "24", false);
  const b = wav.bytes;
  const s24 = (at) => { const u = b[at] | (b[at + 1] << 8) | (b[at + 2] << 16); return u & 0x800000 ? u - 0x1000000 : u; };
  ok(dv(b).getUint16(34, true) === 24 && s24(44) === Math.round(0.5 * 8388607) && s24(47) === Math.round(-0.5 * 8388607) && s24(50) === 8388607, "24-bit samples are three bytes, little-endian, signed");
  ok(b.length % 2 === 0 && dv(b).getUint32(4, true) === b.length - 8, "an odd data chunk gets its pad byte so the file stays on an even boundary", b.length);
  const f = F.encodeWav([[0.5, -0.25, 2]], 44100, "32f", false);
  const v = dv(f.bytes);
  ok(v.getUint16(20, true) === 3 && v.getUint16(34, true) === 32 && str(f.bytes, 36, 4) === "fact" && v.getUint32(44, true) === 3 && str(f.bytes, 48, 4) === "data", "float: format 3, 32 bits, a fact chunk with the frame count");
  ok(v.getFloat32(56, true) === 0.5 && v.getFloat32(60, true) === -0.25 && v.getFloat32(64, true) === 2 && f.clipped === 1, "float samples are written as they are (a peak over 1.0 is kept, and counted)");
}

// ---- dither is deterministic, leaves silence silent, and stays within a step
{
  const quiet = Array.from({ length: 2000 }, (_, i) => 0.0001 * Math.sin(i / 7));
  const a = F.encodeWav([quiet], 44100, "16", true);
  const b2 = F.encodeWav([quiet], 44100, "16", true);
  ok(a.bytes.every((x, i) => x === b2.bytes[i]), "dithering the same audio twice gives the same file");
  const plain = F.encodeWav([quiet], 44100, "16", false);
  let maxDiff = 0;
  for (let i = 0; i < quiet.length; i++) maxDiff = Math.max(maxDiff, Math.abs(dv(a.bytes).getInt16(44 + i * 2, true) - dv(plain.bytes).getInt16(44 + i * 2, true)));
  ok(maxDiff <= 2 && maxDiff >= 1, "the dither moves a sample by one or two steps", maxDiff);
  const silent = F.encodeWav([new Array(100).fill(0)], 44100, "16", true);
  ok(silent.bytes.slice(44).every((x) => x === 0), "exact digital silence stays silent");
  let threw = false; try { F.encodeWav([[0]], 44100, "8", false); } catch (e) { threw = true; }
  ok(threw, "an unknown bit depth is refused");
}

// ---- the CRC and the ZIP
{
  const enc = (s) => Uint8Array.from(Buffer.from(s));
  ok(F.crc32(enc("123456789")) === 0xcbf43926, "crc32 of 123456789 is the standard check value");
  const when = new Date(2026, 9, 9, 12, 30, 20);
  const files = [{ name: "kick.wav", bytes: enc("AAAA") }, { name: "snare é.wav", bytes: enc("hello world") }];
  const zip = F.buildZipBytes(files, when);
  const v = dv(zip);
  ok(v.getUint32(0, true) === 0x04034b50, "a ZIP starts with the local file header signature");
  // walk the central directory
  const endAt = zip.length - 22;
  ok(v.getUint32(endAt, true) === 0x06054b50 && v.getUint16(endAt + 8, true) === 2 && v.getUint16(endAt + 10, true) === 2, "the end record says two files");
  let at = v.getUint32(endAt + 16, true);
  const found = [];
  for (let i = 0; i < 2; i++) {
    ok(v.getUint32(at, true) === 0x02014b50, `central entry ${i + 1} has its signature`);
    const nameLen = v.getUint16(at + 28, true);
    const size = v.getUint32(at + 24, true);
    const crc = v.getUint32(at + 16, true);
    const off = v.getUint32(at + 42, true);
    const name = Buffer.from(zip.slice(at + 46, at + 46 + nameLen)).toString("utf8");
    const data = zip.slice(off + 30 + nameLen, off + 30 + nameLen + size);
    found.push({ name, data: Buffer.from(data).toString(), crcOk: F.crc32(data) === crc, flags: v.getUint16(at + 8, true), method: v.getUint16(at + 10, true) });
    at += 46 + nameLen;
  }
  ok(found[0].name === "kick.wav" && found[0].data === "AAAA" && found[1].name === "snare é.wav" && found[1].data === "hello world", "each file comes back out with its name (UTF-8) and its bytes", found);
  ok(found.every((f) => f.crcOk && f.flags === 0x0800 && f.method === 0), "every CRC matches, names are flagged UTF-8, files are stored");
  const again = F.buildZipBytes(files, when);
  ok(zip.length === again.length && zip.every((x, i) => x === again[i]), "the same files at the same time give the same ZIP");
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
