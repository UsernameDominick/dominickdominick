// The pre-publish checklist: what it flags and what it leaves alone.
import fs from "node:fs";
import vm from "node:vm";

const window = {};
vm.runInContext(fs.readFileSync(new URL("../public/admin/prepublish.js", import.meta.url), "utf8"), vm.createContext({ window, String, Array, Math }));
const P = window.PrePublish;
let fail = 0;
const ok = (c, m, extra) => { if (!c) fail++; console.log(`${c ? "PASS" : "FAIL"} — ${m}${extra !== undefined ? " " + JSON.stringify(extra) : ""}`); };
const ids = (a) => P.check(a).map((x) => x.id);
const words = (n) => Array.from({ length: n }, (_, i) => "word" + i).join(" ");

const good = { title: "A decent title here", body: words(200), og_image: "/a.png", tags: ["x"], brokenLinks: [] };
ok(ids(good).length === 0, "a complete article flags nothing", ids(good));
ok(ids({}).includes("thin") && ids(null).includes("tags"), "empty or missing input does not throw");
ok(ids({ ...good, title: "x".repeat(50) }).includes("title-long"), "50 characters + site name goes over 60");
ok(!ids({ ...good, title: "x".repeat(49) }).includes("title-long"), "49 characters + site name fits");
ok(ids({ ...good, title: "Short" }).includes("title-short"), "very short title gets a tip");
ok(ids({ ...good, body: words(99) }).includes("thin") && !ids({ ...good, body: words(100) }).includes("thin"), "thin boundary at 100 words");
ok(ids({ ...good, body: words(150) + "\n\n![](/a.png)\n" }).includes("alt"), "picture with empty description is flagged");
ok(!ids({ ...good, body: words(150) + "\n\n![A cat](/a.png \"Cap\")\n" }).includes("alt"), "described picture is fine");
const links = P.check({ ...good, brokenLinks: ["/a", "/b", "/c", "/d"] }).find((x) => x.id === "links");
ok(links && /and 1 more/.test(links.text), "broken links listed, extras summarised", links && links.text);
ok(ids({ ...good, body: words(600) }).includes("headings") && !ids({ ...good, body: "## Hi\n" + words(600) }).includes("headings"), "long text without headings gets a tip");
const order = P.check({ title: "x", body: "", og_image: "", tags: [] }).map((x) => x.level);
ok(order.indexOf("tip") > order.lastIndexOf("fix"), "fixes come before tips", order);
console.log(fail ? `${fail} FAILED` : "ALL PASS");
process.exit(fail ? 1 : 0);
