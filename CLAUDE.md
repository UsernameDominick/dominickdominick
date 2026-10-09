# dominickdominick.com — notes for Claude

A personal site on a Cloudflare Worker (static files in `public/`, a small Worker in front, a D1 database bound but unused). **The owner started it over on 2026-10-09:** everything the site used to be (the Studio music maker, the search and command dialog, the nav dial, the two study modules, the admin panel and the Bit bento look) was deleted on purpose, leaving the boilerplate: one index page, the Worker, and the pipeline. Nothing is lost: the git tag `before-start-over` is the last working state of the old site and `before-slim-down` is the older, larger one. To bring a file back, `git show before-start-over:path/to/file` (or `git checkout before-start-over -- path`), but the owner is building something new, so do not restore things unasked. `README.md` is the user-facing description; this file is what you need to work here quickly.

## Where things are

| Path | What it is |
|---|---|
| `public/index.html`, `style.css`, `robots.txt` | The index page and its stylesheet. No scripts, no inline styles (the CSP forbids both). `style.css` is dark ink on soft paper (the reverse for a dark system theme), system fonts at 18px, a column no wider than 40rem. |
| `public/_headers` | The headers the asset store sends with the index page and every other file in `public/` (they never reach the Worker): the security headers and the content security policy in the `/*` block, and the `workers.dev` noindex rule. The `/*` block must equal `worker/security-headers.js` (a test checks). |
| `worker/index.js` | The Worker. The asset store answers a request for a file that exists in `public/` by itself; the Worker answers the rest (a missing address is a 404, a failure a plain 500) with the security headers on top, from `env.ASSETS`. The main module may **only export handlers**: put anything else in its own file. |
| `worker/security-headers.js` | The headers and the content security policy (`default-src 'self'`, no inline script, no eval) for what the Worker answers. Loosen it here **and** in `public/_headers` when the new site needs something it forbids. |
| `wrangler.jsonc` | The Worker's config: the assets folder, the D1 binding `DB` (the production database still holds the old site's tables, nothing reads them) and the `previews` block (a separate preview database). `wrangler.preview-migrations.jsonc` is for applying migrations to the preview database. |
| `schema.sql`, `migrations/` | The database shape. `schema.sql` is the bootstrap and omits columns added by the numbered migrations; `npm run db:local` applies both to a local database. |
| `tests/*.test.mjs` | Pure node tests (no server). `tests/run.mjs` runs them all. `tests/e2e/` holds the browser tests and their runner. |
| `scripts/smoke.mjs` | The post-deploy smoke test the pipeline runs (also `npm run smoke -- <url>`). |
| `.github/` | CI, preview, deploy, monitor and migrate workflows, and Dependabot. See "Git, pipeline and deploy". |
| `outline.md` | The owner's rules, the pipeline description and one-time setup (section 0), the migration state and the checks. Don't log work loops there. |

## Run it

```bash
npm install
npm run db:local                 # local database: schema and migrations
npm run dev                      # local site at http://localhost:8787
npx wrangler d1 execute DB --local --command "select …"   # poke the local database
```
Static files in `public/` are served straight from disk, so a browser reload picks them up; Worker code reloads by itself. Node 22 or newer (`.nvmrc`).

## Testing (do this before every commit)

**Check only what the change can break. Every run costs the owner money.** A copy or CSS change gets `npm test` (a second) and nothing else; the browser tests are for changes to the Worker or to what a page does.

```bash
npm test                              # all pure tests. `node tests/run.mjs site` filters by name.
node tests/e2e/run.mjs                # all browser tests, parallel. `node tests/e2e/run.mjs index` filters by name.
node tests/e2e/run.mjs --live test_x  # one test against the dev server already running on :8787 (fast, but changes that database)
```
- **The owner's computer does not run the browser tests or `wrangler dev`** (they open windows). CI runs them on Linux: open a pull request and read the result.
- The e2e runner starts its own throwaway servers on copies of the local D1 state (it needs `npm run db:local` once), so tests may create and delete freely. It prints only **new** failures: tests that already failed are in `tests/e2e/known-failing.txt` (it is empty now). A test that fails under load is retried once on its own and reported as "Flaky" if it then passes. First time on a machine: `cd tests/e2e && npm install && npx playwright install chromium`.
- **Don't edit `worker/` or `public/` while a test run is going** (the servers reload mid-test and make false failures).
- A new feature gets a node test (`tests/<name>.test.mjs`, must print `ALL PASS`; copy `tests/site.test.mjs`) for its pure logic, and a browser test (`tests/e2e/test_<name>.js`, copy `test_index.js`: it uses `E2E_BASE`) for the page.
- A browser test that adds UI should run axe (see `test_index.js`) in light and dark, and check a 390 px width.
- Test data is synthetic. If you must use `--live`, clean up what you made.
- Before saying a failure is "not mine": check it on the previous commit (`git stash`/checkout, run that one test, restore).

## Git, pipeline and deploy

`main` is the live site, trunk-based: work on a short-lived branch, open a pull request, merge when CI is green. There is no `production` branch and no per-session branches. The full description and the one-time setup (the Cloudflare secrets, switching off Cloudflare's own build, why there is no branch protection) are in `outline.md` section 0; read it before changing a workflow.
- **A pull request** runs `.github/workflows/ci.yml` (every script parses, `npm test`, `wrangler deploy --dry-run`, and the browser tests when site code changed) and `.github/workflows/preview.yml` (a preview address on the pull request, from the separate preview database).
- **A push to `main`** runs the checks and then ships: the `deploy` job needs them green, runs `wrangler deploy`, runs `scripts/smoke.mjs` against the live site and `wrangler rollback` if that fails. It refuses to deploy while a database migration is waiting. Without the Cloudflare secrets the deploy and preview jobs **skip with a notice** (they do not fail) and the `verify` job smoke-tests whatever Cloudflare's own build deployed.
- **`monitor.yml`** smoke-tests the live site every six hours and opens one issue if it fails.
- **Migrations** go through `.github/workflows/migrate.yml` (manual; you must type `migrate production`; takes a backup first). Production D1 changes (migrations, data fixes) need the owner's explicit say-so each time. Never touch the live site or call external services from tests. Local dev only.
- **A change to a workflow is checked by reading it twice**, because it cannot be run here: keep every step that needs a secret behind the `ready` check, keep `permissions` as small as the job allows, and pin actions to a major version.
- **Windows:** the repo is developed on Windows and Linux. Do not add `new URL(...).pathname` for file paths (use `fileURLToPath`) and start `npx`/`npm` with `shell` and `windowsHide: true` (see `tests/e2e/run.mjs`). Do not leave a `wrangler dev` running while editing files: it restarts its server on every change.
- **Commit messages are a plain bulleted list of the changes and nothing else**: no attribution or co-author lines, no session links, no tool or model names, in commits, code comments or any repo file. Commit only files you changed for the task (`git add <paths>`, not `-A`). Never force-push (the one rewrite of history, on 2026-10-08, was the owner's explicit instruction).

## Rules that stay

1. **The CSP has no `unsafe-eval` and no inline script or style.** No `eval`/`new Function` anywhere in browser code. Everything is served from the site; add a CDN or an inline allowance only when the owner asks for what needs it, in `worker/security-headers.js` and the `/*` block of `public/_headers` together.
2. **No emoji anywhere on the site** (the owner's rule, and in `outline.md`). That includes symbols phones draw as emoji (play, pause, stop, record, the north-east arrow, warning sign): use words or a drawn icon. Plain text marks (✓ × ← → ♪ ©) are fine. `tests/no-emoji.test.mjs` fails on any, escapes included; a line that only holds one as data is marked `// no-emoji: data` and uses an escape.
3. **Anything that animates must sit inside `@media (prefers-reduced-motion: no-preference)`.**
4. **Text is at least 16px and has real contrast** (the owner found the old site's small pixel type hard to read): check any new colour, and never set body text below 16px.
5. **D1 allows 100 bound variables per statement.** Chunk big `IN (…)` lists (90 per chunk).
6. **Escape text from users or scripts** before it goes into HTML; validation goes in a small pure file a node test can load.
7. **Audio plays only after a click.** Never autoplay.

## Working with the owner

Casual, direct, short. Ask when the request is vague instead of guessing. Push back lightly when something doesn't add up. Make a recommendation instead of listing every option. Ask before anything hard to reverse or outward-facing. The owner prefers forward progress without repeated check-ins, but asks to be consulted before production data changes, paid services, costly-to-reverse architecture and visible design choices.
