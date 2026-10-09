// One address per page: a trailing slash redirects to the path without it, except where the slash is the address.
import assert from "node:assert/strict";
import { trailingSlashTarget } from "../worker/trailing-slash.js";

assert.equal(trailingSlashTarget("/"), null);
assert.equal(trailingSlashTarget("/projects/"), "/projects");
assert.equal(trailingSlashTarget("/random/my-post/"), "/random/my-post");
assert.equal(trailingSlashTarget("/topics/web//"), "/topics/web");
assert.equal(trailingSlashTarget("/studio/"), "/studio");
assert.equal(trailingSlashTarget("/projects"), null);
assert.equal(trailingSlashTarget("/admin/"), "/admin");
assert.equal(trailingSlashTarget("/studio-app/"), null);
assert.equal(trailingSlashTarget("/api/x/"), null);
assert.equal(trailingSlashTarget(""), null);
console.log("ALL PASS");
