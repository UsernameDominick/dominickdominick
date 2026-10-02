// When the daily backup fails, the owner can have the webhook URLs told (opt in). Uses a fake D1 and R2 and an injected fetch.
import { runScheduledBackup, alertBackupFailure } from "../worker/db.js";

let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };

function makeEnv(settingsInit = {}, { failPut = false } = {}) {
  const settings = new Map(Object.entries(settingsInit));
  const deliveries = [];
  const store = new Map();
  return {
    settings, deliveries,
    MEDIA: {
      async put(key, bytes) { if (failPut) throw new Error("R2 is down"); store.set(key, bytes); },
      async get(key) { const b = store.get(key); return b ? { arrayBuffer: async () => b, text: async () => new TextDecoder().decode(b), customMetadata: {} } : null; },
      async head(key) { return store.has(key) ? { key } : null; },
      async delete(key) { store.delete(key); },
      async list() { return { objects: [] }; },
    },
    DB: {
      prepare(sql) {
        const stmt = (args) => ({
          async all() { return { results: [] }; },
          async first() { if (/FROM settings/i.test(sql) && args && settings.has(args[0])) return { value: settings.get(args[0]) }; return null; },
          async run() {
            if (/INSERT INTO settings|INSERT OR REPLACE INTO settings|ON CONFLICT/i.test(sql) && args) settings.set(args[0], args[1]);
            if (/INSERT INTO webhook_deliveries/i.test(sql)) deliveries.push({ url: args[0], payload: JSON.parse(args[1]), status: args[2], code: args[3], error: args[4] });
            return { meta: { last_row_id: deliveries.length } };
          },
          bind(...a) { return stmt(a); },
        });
        return stmt(null);
      },
    },
  };
}
const okFetch = (log) => async (url, init) => { log.push({ url, init }); return { ok: true, status: 200 }; };

// off by default: nothing is sent
{
  const calls = [];
  const env = makeEnv({ webhook_url: "https://hooks.example/a" });
  ok((await alertBackupFailure(env, "boom", okFetch(calls))) === 0 && calls.length === 0 && env.deliveries.length === 0, "with the setting off, no webhook is called");
}
// on: one POST per URL, a real JSON body, logged as deliveries
{
  const calls = [];
  const env = makeEnv({ webhook_on_backup_failure: "1", webhook_url: "https://hooks.example/a\n\n  https://hooks.example/b  \nnot a url\nftp://x/y\nhttp://hooks.example/c" });
  const n = await alertBackupFailure(env, "R2 is down", okFetch(calls));
  ok(n === 3 && calls.map((c) => c.url).join() === "https://hooks.example/a,https://hooks.example/b,http://hooks.example/c", "only the http(s) lines are called, trimmed, blanks and junk skipped", calls.map((c) => c.url));
  const body = JSON.parse(calls[0].init.body);
  ok(calls[0].init.method === "POST" && calls[0].init.headers["Content-Type"] === "application/json" && body.event === "backup_failed" && body.message === "R2 is down" && body.site === "dominickdominick.com" && !Number.isNaN(Date.parse(body.at)), "the body says what happened", body);
  ok(env.deliveries.length === 3 && env.deliveries.every((d) => d.status === "success" && d.code === 200 && d.payload.event === "backup_failed"), "each call is recorded in the webhook delivery history", env.deliveries.length);
}
// a failing endpoint is logged and the others still get called
{
  const sent = [];
  const send = async (url) => { sent.push(url); if (url.endsWith("/a")) throw new Error("connection refused"); if (url.endsWith("/b")) return { ok: false, status: 500 }; return { ok: true, status: 204 }; };
  const env = makeEnv({ webhook_on_backup_failure: "1", webhook_url: "https://h/a\nhttps://h/b\nhttps://h/c" });
  const n = await alertBackupFailure(env, "x", send);
  ok(n === 3 && sent.length === 3, "one endpoint being down does not stop the others", sent);
  ok(env.deliveries.map((d) => d.status).join() === "failed,failed,success" && /refused/.test(env.deliveries[0].error) && env.deliveries[1].error === "HTTP 500", "failures are recorded with their reason", env.deliveries.map((d) => [d.status, d.error]));
}
// at most five URLs, and a long message is cut
{
  const calls = [];
  const env = makeEnv({ webhook_on_backup_failure: "1", webhook_url: Array.from({ length: 9 }, (_, i) => `https://h/${i}`).join("\n") });
  const n = await alertBackupFailure(env, "e".repeat(5000), okFetch(calls));
  ok(n === 5 && calls.length === 5 && JSON.parse(calls[0].init.body).message.length === 300, "no more than five calls, and the message is cut to 300 characters", [n, JSON.parse(calls[0].init.body).message.length]);
}
// never throws, whatever is wrong
{
  const bad = { DB: { prepare() { throw new Error("db down"); } } };
  ok((await alertBackupFailure(bad, "x", okFetch([]))) === 0, "a broken database means no alert and no exception");
  const env = makeEnv({ webhook_on_backup_failure: "1" });
  ok((await alertBackupFailure(env, "x", okFetch([]))) === 0, "no URLs configured means nothing to call");
}
// wired into the backup: only the scheduled run asks for the alert
{
  const calls = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = okFetch(calls);
  try {
    const env = makeEnv({ webhook_on_backup_failure: "1", webhook_url: "https://hooks.example/a" }, { failPut: true });
    let threw = null;
    try { await runScheduledBackup(env, { alert: true }); } catch (e) { threw = e.message; }
    ok(threw === "R2 is down" && calls.length === 1 && JSON.parse(calls[0].init.body).message === "R2 is down", "a failed scheduled backup still throws, and tells the webhook what went wrong", [threw, calls.length]);
    ok(env.settings.get("last_backup_error") === "R2 is down", "the dashboard's last-error note is still set");
    calls.length = 0;
    threw = null;
    try { await runScheduledBackup(makeEnv({ webhook_on_backup_failure: "1", webhook_url: "https://hooks.example/a" }, { failPut: true })); } catch (e) { threw = e.message; }
    ok(threw === "R2 is down" && calls.length === 0, "a backup started by hand does not send an alert (the person who clicked sees the error)");
    calls.length = 0;
    const good = makeEnv({ webhook_on_backup_failure: "1", webhook_url: "https://hooks.example/a" });
    await runScheduledBackup(good, { alert: true });
    ok(calls.length === 0 && good.settings.get("last_backup_error") === "", "a backup that works sends nothing");
  } finally {
    globalThis.fetch = realFetch;
  }
}

console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
