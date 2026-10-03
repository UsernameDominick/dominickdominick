const E2E_BASE = process.env.E2E_BASE || "http://localhost:8787";
const { request } = require("./_pw.cjs");
const BASE = (E2E_BASE);
let f = 0;
const ok = (c, m, e) => { if (!c) f++; console.log(`${c ? "PASS" : "FAIL"}  ${m}${e !== undefined ? "  -> " + JSON.stringify(e) : ""}`); };
(async () => {
  const c = await request.newContext({ storageState: process.env.ADMIN_STATE });
  const api = (m, p, data) => c.fetch(BASE + "/api/admin" + p, { method: m, data });
  const made = { songs: [], sims: [] };
  try {
    const data = { tempo: 132, kit: "acoustic", tracks: { kick: [true, false, true, false] }, melody: { waveform: "sine", notes: { C4: [true, false] } }, private_notes: "QQ secret" };
    let r = await api("POST", "/songs", { name: "QQ song rules", data });
    const { id } = await r.json();
    made.songs.push(id);
    ok(r.status() === 200 && id, "a song with proper data is saved", r.status());
    r = await api("PATCH", "/songs/" + id, { name: "QQ song renamed" });
    ok(r.status() === 200, "renaming with no data is allowed", r.status());
    let got = await (await api("GET", "/songs/" + id)).json();
    ok(got.name === "QQ song renamed" && got.data.tempo === 132 && got.data.tracks.kick.length === 4 && got.data.private_notes === "QQ secret", "and the song is untouched by it", got.data);
    r = await api("PATCH", "/songs/" + id, { name: "QQ song renamed", data: { ...data, tempo: 90 } });
    got = await (await api("GET", "/songs/" + id)).json();
    ok(r.status() === 200 && got.data.tempo === 90, "a full save still replaces the data", got.data.tempo);
    r = await api("PATCH", "/songs/" + id, { name: "QQ x", data: [1, 2] });
    ok(r.status() === 400, "an array is not song data", r.status());
    r = await api("PATCH", "/songs/" + id, { name: "QQ x", data: { tracks: { kick: "no" } } });
    ok(r.status() === 400, "tracks that are not lists are refused", r.status());
    r = await api("POST", "/songs", { name: "QQ x", data: { tempo: "fast" } });
    ok(r.status() === 400, "a text tempo is refused on create", r.status());
    r = await api("POST", "/songs", { name: 5 });
    ok(r.status() === 400, "a number is not a name", r.status());
    r = await api("PATCH", "/songs/999999999", { name: "QQ ghost" });
    ok(r.status() === 404, "renaming a song that is not there is a 404", r.status());
    got = await (await api("GET", "/songs/" + id)).json();
    ok(got.data.tempo === 90, "refused saves changed nothing", got.data.tempo);
    // simulations
    const comps = Array.from({ length: 1001 }, (_, i) => ({ id: i + 1, type: "led", x: 20 + (i % 100), y: 20 }));
    r = await api("POST", "/simulations", { name: "QQ sim big", data: { components: comps, wires: [] } });
    ok(r.status() === 400 && /up to 1000 parts/.test((await r.json()).error), "1001 parts are refused", r.status());
    r = await api("POST", "/simulations", { name: "QQ sim ok", data: { components: comps.slice(0, 3), wires: [] } });
    const sim = await r.json();
    ok(r.status() === 200 && sim.id, "a normal simulation saves", r.status());
    if (sim.id) made.sims.push(sim.id);
  } finally {
    for (const id of made.songs) await api("DELETE", "/songs/" + id);
    for (const id of made.sims) await api("DELETE", "/simulations/" + id);
  }
  console.log(f ? "FAILED " + f : "ALL PASS");
  process.exit(f ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
