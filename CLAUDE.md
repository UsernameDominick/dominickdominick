# dominickdominick.com — notes for Claude

A personal site on a Cloudflare Worker + D1 (database) + R2 (media), with a built-in visual page editor, articles, projects, a circuit
simulator, a song builder, 3D scans and a photo editor. The owner is the only admin. `README.md` is the user-facing description;
this file is what you need to work here quickly.

## Where things are

| Path | What it is |
|---|---|
| `worker/index.js` | Entry point: routing, security headers (CSP), public pages, `/api/track`, cron (`scheduled`). The main module may **only export handlers**: put anything else in its own file. |
| `worker/admin-api.js` | Every `/api/admin/*` route, one big `routeAdminApi(request, env, url, ctx)` of `if (path === … && method === …)` blocks. `SETTINGS_KEYS` lists the site settings. |
| `worker/db.js` | All SQL. Lists, saves, bulk actions, backups/export, link checker, webhooks, rate limits. |
| `worker/render.js` | Server-side HTML for public pages, articles, projects, embeds. |
| `worker/simulation-render.js` | Public circuit simulation rendering and analysis. Mirror of `public/admin/sim-components.js` (see below). |
| `worker/*.js` (small ones) | Pure helpers with a comment on line 1 saying what they decide (`redirects.js`, `scans.js`, `songs.js`, `scripts.js`, `track.js`, `text.js`…). New validation goes in a small file like these so a node test can load it. |
| `public/admin/app.js` | The whole admin UI (pages, articles, projects, media, settings, dashboards, command palette). Find things by element id: `grep -n 'redirects-btn' public/admin/*`. |
| `public/admin/index.html` | All admin markup, every dialog (`.modal`), sidebar buttons, script tags. |
| `public/admin/*-builder.js`, `photo-editor.js`, `script-*.js` | The big self-contained tools (simulations, songs, scans, photo editor, Scripts window). |
| `public/style.css` | Public stylesheet **and** the colour/spacing tokens the admin reuses. `public/admin/style.css` is admin-only. |
| `public/*.js` | Scripts served to visitors (`nav.js`, `sim-player.js`, `song-engine.js`, `song-embed.js`…). |
| `schema.sql`, `migrations/` | Database shape. `schema.sql` is the bootstrap; later columns live in numbered migrations. |
| `tests/*.test.mjs` | Pure node tests (no server). `tests/e2e/` = browser tests. See Testing. |
| `features.json` | The admin's **Features board** (what is built, in progress, planned, waiting on the owner). Keep it current, see below. |
| `outline.md` | The owner's backlog/outline, shown read-only in the admin. Don't log work loops there. |

## Run it

```bash
npx wrangler dev --port 8787        # local site at http://localhost:8787, admin at /admin
npx wrangler d1 execute DB --local --command "select …"   # poke the local database
```
`.dev.vars` holds `ADMIN_PASSWORD` and `SESSION_SECRET` (gitignored). Never print them or paste them anywhere.
Static files in `public/` are served straight from disk, so a browser reload picks them up; Worker code reloads by itself.

## Testing (do this before every commit)

```bash
node tests/run.mjs                    # all pure tests, ~6 s. `node tests/run.mjs song sim` filters by name.
node tests/e2e/run.mjs                # all browser tests, parallel. `node tests/e2e/run.mjs prepublish` filters by name.
node tests/e2e/run.mjs --live test_x  # one test against the dev server already running on :8787 (fast, but changes that database)
```
- The e2e runner starts its own throwaway servers on copies of the local D1/R2, so tests may create and delete freely and the dev
  database is untouched. It prints only **new** failures: tests that already failed are in `tests/e2e/known-failing.txt`
  (fix one, delete its line). First time on a machine: `cd tests/e2e && npm install` (Playwright + axe-core).
- **Don't edit `worker/` or `public/` while a test run is going** (the servers reload mid-test and make false failures).
- A new feature gets a node test (`tests/<name>.test.mjs`, must print `ALL PASS`; copy the style of a neighbour) for its pure logic,
  and a browser test (`tests/e2e/test_<name>.js`, copy a neighbour: it uses `E2E_BASE` and `ADMIN_STATE`) for the UI.
- A browser test that adds an admin dialog should also run axe (see `test_scripts_e2e.js`) in dark and light, and check a 390 px width.
- Test data is synthetic (prefix titles with `QQ`). If you must use `--live`, clean up what you made.
- Before saying a failure is "not mine": check it on the previous commit (`git stash`/checkout, run that one test, restore).

## Git and deploy

- `main` deploys the **live** site. `production` is the preview/integration branch. Work on the branch the session names, and also
  keep `production` current. Push order used so far: `production` → the session branch → `main` (only when `origin/main` is an
  ancestor of `production`: `git merge-base --is-ancestor origin/main production`). The owner has authorised pushing to `main` once
  tests pass. Never force-push. Never open a PR unless asked.
- Commit only files you changed for the task (`git add <paths>`, not `-A`). End commit messages with the attribution lines the
  session gives you. No model names or identifiers in commits, code comments or any repo file.
- Production D1 changes (migrations, data fixes) need the owner's explicit say-so each time. Never touch the live site or call
  external services from tests. Local dev only.

## Rules that have bitten before

1. **D1 allows 100 bound variables per statement.** Chunk big `IN (…)` lists (`chunkList`, `selectIn`, `updateIn` in `db.js`, 90 per chunk).
2. **Settings rows are the schema-free store.** Lists of small things live in the `settings` table under a prefix (`page_section:<id>`,
   `admin_script:<id>`), one row each, so no migration is needed and backups (`exportAll` dumps every settings row) include them.
3. **Anything that animates in the public CSS must sit inside `@media (prefers-reduced-motion: no-preference)`** (`tests/reduced-motion.test.mjs` fails otherwise).
4. **The CSP has no `unsafe-eval`.** No `eval`/`new Function` anywhere in browser code; code that must run is loaded as script text/blob (see `script-runner.js`).
5. **Circuit simulation is mirrored by hand:** `public/admin/sim-components.js` (builder) and `worker/simulation-render.js` (public page) must
   agree, with `sim-solver.js` and `sim-schematic.js` shared. Change one, change the other, and the `*-parity.test.mjs` files must pass. New resistive parts reuse the edge kind `"resistor"` with a flag.
6. **Audio plays only after a click** (`public/sim-buzzer.js` is the shared tone module). Never autoplay.
7. **A new file that public visitors need while the site is in maintenance mode** goes in `MAINTENANCE_EXEMPT_FILES` in `worker/index.js`.
8. **Every admin dialog** is a `.modal` with `role="dialog"`, a `close-…` button (Esc and backdrop click press it), and is added to the Ctrl+S map near
   "Keyboard shortcuts" in `app.js` if it has a Save. Dialog stacking and focus return are handled for you (`modalFocusReturn`).
9. **Saves that can race** use `expected_version` (`checkConflict`). Autosave must never publish a draft by itself.
10. **Text from users or from scripts is data.** Escape with `escapeHtml` in admin templates; the public side goes through `worker/text.js` / `render.js` helpers.
11. **Server validation in a small pure file, then called from the route** (see `worker/redirects.js`): keeps it testable and keeps `admin-api.js` readable.
12. Page and article bodies need > 50 characters before they can be published (server check) — tests that publish need a real-length body.

## Recipes

- **New admin API route:** add an `if (path === "/thing" && method === …)` block in `routeAdminApi` (use `readJsonBody`, `json`, and
  `log(ctx, env, "create", "thing", name)` for the activity log). If it should be callable from the Scripts window, add the path
  to `WRITABLE` in `public/admin/script-policy.js`.
- **New admin tool/dialog:** markup in `index.html` (sidebar button in a `.admin-sidebar-group`, modal near the others, script tags at the end),
  logic in `app.js` or its own `public/admin/<name>.js`, CSS appended to `public/admin/style.css` using existing tokens (`--bg`, `--bg-elevated`,
  `--border`, `--text-dim`, `--accent`, `--error-text`, `--success`, `--warning`), a command-palette entry (grep `Open Redirects`), a sidebar icon (`#<id> { --ico: … }`).
- **New stored list:** settings rows (rule 2) with routes like `/sections` or `/scripts` (cap the count and the size; validate in a small pure file).
- **New block type / simulation part / song feature:** find the nearest existing one (`grep -n` for a sibling such as `lamp`, `buzzer`, `ties`) and follow it
  end to end: validation → admin UI → public render → CSS → tests.

## Keeping the Features board current

`features.json` is what the owner reads to see what has been added and what is done. In the same commit as any feature or fix the owner would
care about, add or update its entry: `{"id", "area", "status", "title", "summary", "notes"}` with status `done`, `doing`, `planned`, `decision`
(waiting on the owner: `notes` must say what the decision is) or `parked`, and bump `updated`. Plain language, no internal item numbers.
`node tests/run.mjs features` checks the file. The owner's own requests live on the live site (they use "Copy open items" to paste them to you).

## Working with the owner

Casual, direct, short. Ask when the request is vague instead of guessing. Push back lightly when something doesn't add up. Make a
recommendation instead of listing every option. Ask before anything hard to reverse or outward-facing.
