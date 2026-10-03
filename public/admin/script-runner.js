// Runs a script from the Scripts window without giving it the keys to the admin.
//
// The code runs in a Web Worker inside a sandboxed iframe (no allow-same-origin), so it has no cookies, no storage and no DOM, and a
// runaway loop is stopped by terminating the worker. The only way out is a MessageChannel to this page: every `site.*` call arrives
// here as a { method, path, body } request, is checked by ScriptPolicy, counted, and (in a preview run) recorded instead of sent.
// The page's CSP has no 'unsafe-eval', so the code is never eval'd: it is the body of a function in the worker's own source text.
(function () {
  const MAX_READS = 3000;
  const MAX_WRITES = 500;
  const MAX_LOG_LINES = 1000;
  const MAX_LOG_CHARS = 4000;
  const DEFAULT_TIMEOUT = 60000;
  const MAX_TIMEOUT = 5 * 60000;
  const CONCURRENCY = 4;

  // Everything inside this function runs in the worker (it is sent as text), so it must not touch anything outside itself.
  function workerMain() {
    self.onmessage = (event) => {
      self.onmessage = null;
      const { port, dry } = event.data;
      const pending = new Map();
      let nextId = 1;
      port.onmessage = (m) => {
        const d = m.data;
        const p = pending.get(d.id);
        if (!p) return;
        pending.delete(d.id);
        if (d.ok) p.resolve(d.data);
        else p.reject(Object.assign(new Error(d.error || "Request failed"), { status: d.status }));
      };
      const plain = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
      const call = (method, path, body) =>
        new Promise((resolve, reject) => {
          let sent;
          try {
            sent = plain(body);
          } catch {
            reject(new Error("The request body has to be plain data (no functions, no circular references)."));
            return;
          }
          const id = nextId++;
          pending.set(id, { resolve, reject });
          port.postMessage({ t: "call", id, method, path, body: sent });
        });

      const text = (v) => {
        if (typeof v === "string") return v;
        if (v instanceof Error) return v.stack || v.message;
        if (v === undefined) return "undefined";
        try {
          const s = JSON.stringify(v, null, 2);
          return s === undefined ? String(v) : s;
        } catch {
          return String(v);
        }
      };
      const logger = (level) => (...args) => port.postMessage({ t: "log", level, text: args.map(text).join(" ") });
      const console = { log: logger("log"), info: logger("log"), debug: logger("log"), warn: logger("warn"), error: logger("error") };

      const qs = (q) => {
        if (!q || typeof q !== "object") return "";
        const parts = Object.entries(q)
          .filter(([, v]) => v !== undefined && v !== null)
          .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`);
        return parts.length ? `?${parts.join("&")}` : "";
      };
      const idOf = (v) => (v && typeof v === "object" ? v.id : v);
      const withId = (base, id, tail = "") => `${base}/${encodeURIComponent(idOf(id))}${tail}`;

      // list/get/create/update/remove for a content type. get reads the list when the type has no route for a single item.
      const resource = (base, { single = false, duplicate = false } = {}) => {
        const r = {
          list: (query) => call("GET", base + qs(query)),
          get: single
            ? (id) => call("GET", withId(base, id))
            : async (id) => {
                const all = await call("GET", base);
                return (Array.isArray(all) ? all : []).find((x) => String(x.id) === String(idOf(id))) || null;
              },
          create: (body) => call("POST", base, body),
          update: (id, body) => call("PATCH", withId(base, id), body),
          remove: (id) => call("DELETE", withId(base, id)),
        };
        if (duplicate) r.duplicate = (id) => call("POST", withId(base, id, "/duplicate"));
        return r;
      };

      const pages = resource("/pages", { duplicate: true });
      pages.blocks = (id) => call("GET", withId("/pages", id, "/blocks"));
      pages.addBlock = (id, body) => call("POST", withId("/pages", id, "/blocks"), body);
      const blocks = {
        update: (id, body) => call("PATCH", withId("/blocks", id), body),
        remove: (id) => call("DELETE", withId("/blocks", id)),
      };
      const articles = resource("/articles", { duplicate: true });
      articles.bulk = (body) => call("POST", "/articles/bulk", body);
      const projects = resource("/projects", { duplicate: true });
      projects.bulk = (body) => call("POST", "/projects/bulk", body);
      const settings = { get: () => call("GET", "/settings"), update: (body) => call("PUT", "/settings", body) };

      const sleep = (ms) => new Promise((r) => setTimeout(r, Math.min(Math.max(Number(ms) || 0, 0), 10000)));
      // Runs fn(item, index) over a list a few at a time, so a script doesn't open hundreds of requests at once.
      const each = async (items, fn, { concurrency = 3 } = {}) => {
        const list = Array.from(items || []);
        const out = new Array(list.length);
        let next = 0;
        const worker = async () => {
          while (next < list.length) {
            const i = next++;
            out[i] = await fn(list[i], i);
          }
        };
        await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, 6)) }, worker));
        return out;
      };
      const slugify = (s) =>
        String(s == null ? "" : s)
          .normalize("NFKD")
          .replace(/[̀-ͯ]/g, "")
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/^-+|-+$/g, "");

      const site = {
        dryRun: Boolean(dry),
        api: (method, path, body) => call(method, path, body),
        get: (path) => call("GET", path),
        post: (path, body) => call("POST", path, body),
        patch: (path, body) => call("PATCH", path, body),
        put: (path, body) => call("PUT", path, body),
        delete: (path) => call("DELETE", path),
        articles,
        projects,
        pages,
        blocks,
        redirects: resource("/redirects"),
        songs: resource("/songs", { single: true, duplicate: true }),
        simulations: resource("/simulations", { single: true, duplicate: true }),
        scans: resource("/scans", { single: true }),
        sharedBlocks: resource("/shared-blocks", { single: true }),
        settings,
        media: { list: (query) => call("GET", "/media" + qs(query)) },
        search: (q) => call("GET", "/search" + qs({ q })),
        log: console.log,
        sleep,
        each,
        slugify,
      };

      // The sandbox has no cookies, so these would only fail confusingly; point at the supported way instead.
      const refuse = (name) =>
        function () {
          throw new Error(`${name} isn't available in scripts. Use site.api(method, path, body), or the site.articles / site.pages helpers.`);
        };
      for (const name of ["fetch", "XMLHttpRequest", "WebSocket", "EventSource", "importScripts", "Worker", "SharedWorker"]) {
        try {
          Object.defineProperty(self, name, { value: refuse(name), configurable: false, writable: false });
        } catch {
          /* already gone */
        }
      }

      (async () => {
        try {
          const value = await self.__userMain(site, console);
          let shown;
          try {
            shown = value === undefined ? undefined : JSON.stringify(value, null, 2);
          } catch {
            shown = String(value);
          }
          port.postMessage({ t: "done", ok: true, value: shown });
        } catch (err) {
          const message = err && err.message ? err.message : String(err);
          const lines = String((err && err.stack) || "")
            .split("\n")
            .map((l) => /:(\d+):\d+\)?\s*$/.exec(l))
            .filter(Boolean)
            .map((m) => Number(m[1]));
          port.postMessage({ t: "done", ok: false, error: { message, name: err && err.name, lines } });
        }
      })();
    };
  }

  // The worker's source text: the prelude, then the script's code as the body of an async function. userLine1 is the line of the
  // source that holds line 1 of the script, to turn the worker's line numbers back into the script's.
  function buildSource(code) {
    const head = `(${workerMain.toString()})();\nself.__userMain = async function (site, console) {\n`;
    return { source: `${head}${String(code)}\n};\n`, offset: head.split("\n").length - 1 };
  }

  const FRAME_DOC = `<!doctype html><meta charset="utf-8"><script>
let worker;
addEventListener("message", (e) => {
  if (e.source !== parent || !e.data || e.data.t !== "start") return;
  const url = URL.createObjectURL(new Blob([e.data.source], { type: "text/javascript" }));
  worker = new Worker(url);
  worker.onerror = (ev) => {
    ev.preventDefault();
    parent.postMessage({ t: "worker-error", message: ev.message, line: ev.lineno }, "*");
  };
  worker.postMessage({ port: e.ports[0], dry: e.data.dry }, [e.ports[0]]);
});
parent.postMessage({ t: "ready" }, "*");
<\/script>`;

  // run({ code, dry, call, onLog, onChange, timeoutMs }) -> { promise, abort }.
  //   call(method, path, body) sends a checked request with the owner's session and resolves with the response data.
  //   The promise resolves (never rejects) with { status: "ok"|"error"|"timeout"|"aborted", value, error, reads, writes, changes, ms }.
  function run({ code, dry = true, call, onLog, onChange, timeoutMs = DEFAULT_TIMEOUT }) {
    const policy = window.ScriptPolicy;
    const limit = Math.min(Math.max(Number(timeoutMs) || DEFAULT_TIMEOUT, 1000), MAX_TIMEOUT);
    const { source, offset } = buildSource(code);
    const started = Date.now();
    const stats = { reads: 0, writes: 0, changes: [], logs: 0 };
    let settle;
    let finished = false;
    const promise = new Promise((resolve) => (settle = resolve));

    const iframe = document.createElement("iframe");
    iframe.setAttribute("sandbox", "allow-scripts");
    iframe.setAttribute("aria-hidden", "true");
    iframe.tabIndex = -1;
    iframe.hidden = true;
    iframe.srcdoc = FRAME_DOC;
    const channel = new MessageChannel();
    let timer = null;
    let active = 0;
    const waiting = [];

    // The first stack frame inside the script's own text (frames in the prelude come before its first line).
    const lineOf = (n) => (Number.isFinite(n) && n > offset ? n - offset : null);
    const firstScriptLine = (lines) => (Array.isArray(lines) ? lines.map(lineOf).find((n) => n !== null) : null) ?? null;
    function finish(result) {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      window.removeEventListener("message", onFrame);
      channel.port1.onmessage = null;
      channel.port1.close();
      iframe.remove();
      settle({ reads: stats.reads, writes: stats.writes, changes: stats.changes, dry, ms: Date.now() - started, ...result });
    }

    function onFrame(e) {
      if (e.source !== iframe.contentWindow || !e.data) return;
      if (e.data.t === "ready") {
        iframe.contentWindow.postMessage({ t: "start", source, dry }, "*", [channel.port2]);
      } else if (e.data.t === "worker-error") {
        finish({ status: "error", error: { message: e.data.message || "The script could not start.", line: lineOf(e.data.line), syntax: true } });
      }
    }

    // A few requests at a time, in the order the script asked for them.
    function schedule(task) {
      return new Promise((resolve) => {
        const go = () => {
          active++;
          task().then(resolve, resolve).finally(() => {
            active--;
            if (waiting.length) waiting.shift()();
          });
        };
        if (active < CONCURRENCY) go();
        else waiting.push(go);
      });
    }

    function reply(id, ok, payload) {
      if (finished) return;
      channel.port1.postMessage(ok ? { id, ok: true, data: payload } : { id, ok: false, error: payload.message, status: payload.status });
    }

    function handleCall(d) {
      const check = policy.checkCall(d.method, d.path);
      if (!check.ok) return reply(d.id, false, { message: check.error, status: 403 });
      if (check.write) {
        if (stats.writes >= MAX_WRITES) return reply(d.id, false, { message: `A script can make up to ${MAX_WRITES} changes in one run.`, status: 429 });
        stats.writes++;
        const change = { text: policy.describeCall(d.method, d.path, d.body), destructive: check.destructive, dry };
        stats.changes.push(change);
        if (onChange) onChange(change);
        if (dry) {
          // A preview run makes no changes: the script is told it worked, with a placeholder id for anything it creates.
          return reply(d.id, true, { ok: true, dryRun: true, id: `preview-${stats.writes}` });
        }
      } else {
        if (stats.reads >= MAX_READS) return reply(d.id, false, { message: `A script can read up to ${MAX_READS} times in one run.`, status: 429 });
        stats.reads++;
      }
      schedule(async () => {
        try {
          const data = await call(d.method, d.path, d.body);
          reply(d.id, true, data === undefined ? null : data);
        } catch (err) {
          reply(d.id, false, { message: (err && err.message) || "Request failed", status: err && err.status });
        }
      });
    }

    channel.port1.onmessage = (m) => {
      const d = m.data || {};
      if (d.t === "call") handleCall(d);
      else if (d.t === "log") {
        if (stats.logs >= MAX_LOG_LINES) {
          if (stats.logs === MAX_LOG_LINES) onLog && onLog("warn", `(output stops here: ${MAX_LOG_LINES} lines is the limit)`);
          stats.logs++;
          return;
        }
        stats.logs++;
        const text = String(d.text || "");
        onLog && onLog(d.level === "warn" || d.level === "error" ? d.level : "log", text.length > MAX_LOG_CHARS ? `${text.slice(0, MAX_LOG_CHARS)}… (${text.length - MAX_LOG_CHARS} more characters)` : text);
      } else if (d.t === "done") {
        if (d.ok) finish({ status: "ok", value: d.value });
        else finish({ status: "error", error: { message: d.error.message, name: d.error.name, line: firstScriptLine(d.error.lines) } });
      }
    };

    window.addEventListener("message", onFrame);
    timer = setTimeout(() => finish({ status: "timeout", error: { message: `The script was stopped after ${Math.round(limit / 1000)} seconds.` } }), limit);
    document.body.appendChild(iframe);
    return { promise, abort: () => finish({ status: "aborted", error: { message: "Stopped." } }) };
  }

  const api = { run, buildSource, workerMain, MAX_READS, MAX_WRITES, MAX_LOG_LINES, DEFAULT_TIMEOUT, MAX_TIMEOUT };
  if (typeof window !== "undefined") window.ScriptRunner = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})();
