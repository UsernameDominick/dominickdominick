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
| `public/admin/*-builder.js`, `photo-editor.js`, `script-*.js`, `node-*.js` | The big self-contained tools (simulations, songs, scans, photo editor, Scripts window, and its Nodes editor: `node-defs.js` the node types, `node-compiler.js` graph → code, `node-editor.js` the canvas, `node-templates.js` starter graphs). |
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
  (fix one, delete its line). A test that fails under load is retried once on its own and reported as "Flaky" if it then passes (`--no-retry` turns that off; keep it
  in mind when a test only fails in the full run). First time on a machine: `cd tests/e2e && npm install` (Playwright + axe-core).
- **Don't edit `worker/` or `public/` while a test run is going** (the servers reload mid-test and make false failures).
- A new feature gets a node test (`tests/<name>.test.mjs`, must print `ALL PASS`; copy the style of a neighbour) for its pure logic,
  and a browser test (`tests/e2e/test_<name>.js`, copy a neighbour: it uses `E2E_BASE` and `ADMIN_STATE`) for the UI.
- Two by-hand audits (not tests, run them after a UI change and read the report): `node tests/e2e/audit/audit-public.js` (every public page: SEO, axe, overflow, links, weight) and
  `node tests/e2e/audit/audit-admin.js` (every admin tool, its tabs and editors, dialogs and dropdowns: axe, overflow, tap targets, focus, Esc; `--only articles-btn` for one tool).
  Both need `wrangler dev` running on :8787 and only open and close things. Expect 0 high / 0 medium; the admin one cannot reach the CDN or GitHub in a sandbox, which it ignores.
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

## Songs: how a song is stored

A song is one JSON blob (`songs.data`). The sound is made by `public/song-engine.js` (shared by the admin builder, the public embed and the offline renders), the editor is `public/admin/song-builder.js`, and `public/admin/song-files.js` is the pure helper for MIDI, JSON import/export and import cleaning.
- **A new song field has to be added in four places or it silently disappears:** the engine (`scheduleStep` or a send like `setSpace`), `worker/songs.js` (`songDataError`, validation), `song-files.js` (`cleanSong`, or import drops it), and `song-builder.js` (open, undo restore in `applySongHistoryState`, the control). Add the field to `tests/song-files.test.mjs`'s "exactly the builder's own keys" list only if it is written for every song; optional fields (voice, patterns, chain, editing) are written only when set, so old songs and their noise seed stay identical (`tests/song-chain.test.mjs` pins the seed values).
- **Patterns:** the pattern being edited is always the song's own `tracks`, `melody.notes` and `melody.ties` (every editing tool works on it unchanged); `editing` names it (absent = "A") and `patterns` holds the others as `{tracks, notes, ties}`; `chain` is the song order (up to 32 letters). Mix, instrument, scale, tempo, echo and the rows themselves (`trackMeta`) are shared. Resolve patterns only through the engine's `patternData` / `chainOf` / `viewOf` (and `chainParts` in song-files.js, kept equal by a test), never by reading `songData.tracks` for "the song".
- **Bass line:** `bass` ({notes, ties, voice, volume, muted, hidden}, over its own C1 to B2 roll, `BASS_NOTES`) is a second melodic part with the same shape as `melody`. It is absent until used (the builder creates it in memory with `ensureBass()` and `pruneBass()` drops an empty one at save, so old songs are stored unchanged). The open pattern's bass is `bass.notes/ties`, every other pattern's is `patterns[X].bass = {notes, ties}`, and it follows the same four-places rule. In the builder the piano roll shows one part at a time (`rollPart`, `roll()`, `rollNotes()`), so every roll tool works on either part; never read `songData.melody` in code that should also serve the bass. A MIDI file's bass part is a track named "bass" or one mostly below C3.
- **Pump** (`pump`, 0 to 100, absent when off) ducks the melody and bass on every kick: with it on, `scheduleStep` routes `scheduleMusic` through a per-context music bus (`withMusicBus`) that `duckMusic` automates. With it off nothing extra is built, so graphs and seeds are unchanged (`tests/song-pump.test.mjs`).
- Drum rows: the four core rows always exist; open hat, rim, tom and crash exist once added (found by their `trackMeta` entry). Melody instruments are `melody.voice` (absent = the plain waveform note).
- Test helpers: `tests/fake-audio.mjs` (recording Web Audio stand-in plus engine and song-files loaders). A browser test can see which pattern is sounding by wrapping `SongEngine.createPlayer` in an init script (see `tests/e2e/test_song_patterns.js`).

## Recipes

- **New admin API route:** add an `if (path === "/thing" && method === …)` block in `routeAdminApi` (use `readJsonBody`, `json`, and
  `log(ctx, env, "create", "thing", name)` for the activity log). If it should be callable from the Scripts window, add the path
  to `WRITABLE` in `public/admin/script-policy.js`.
- **New admin tool/dialog:** markup in `index.html` (sidebar button in a `.admin-sidebar-group`, modal near the others, script tags at the end),
  logic in `app.js` or its own `public/admin/<name>.js`, CSS appended to `public/admin/style.css` using existing tokens (`--bg`, `--bg-elevated`,
  `--border`, `--text-dim`, `--accent`, `--error-text`, `--success`, `--warning`), a command-palette entry (grep `Open Redirects`), a sidebar icon (`#<id> { --ico: … }`).
- **New node type (Scripts window → Nodes):** add it to `NODES` in `public/admin/node-defs.js` (pins, props, and `emit` for a step or `expr` for a value). It
  should call a `site.*` helper (add the helper in `script-runner.js` and `SDK_DOCS` in `script-editor.js` if it is new, and its route to `WRITABLE` in
  `script-policy.js`). `tests/nodes.test.mjs` checks every definition; add a starter graph to `node-templates.js` when it makes a good example.
- **New stored list:** settings rows (rule 2) with routes like `/sections` or `/scripts` (cap the count and the size; validate in a small pure file).
- **New block type / simulation part / song feature:** find the nearest existing one (`grep -n` for a sibling such as `lamp`, `buzzer`, `ties`) and follow it
  end to end: validation → admin UI → public render → CSS → tests.

## The board (features.json)

The admin's Features board is a kanban: **To do** on the left (the owner adds to it), **Working on now** and **Done** on the right. It is driven by
`features.json`: `{"id", "area", "status", "kind", "title", "summary", "notes", "date"}` and a bumped `updated`. Status is `todo`, `doing`, `done` or
`parked`; an open item needs a `kind`: `decision` (waiting on the owner: `notes` must say what to decide), `bug`, `attention`, `almost` or `idea`. Plain
language, no internal item numbers. `node tests/run.mjs features` checks the file.

**The loop:** pick something from `todo` (waiting-on-owner items can't be picked), set it `doing` and push so the owner sees it move; do the work; set it
`done` with `"date": "<today>"` in the same commit as the work; pick the next. Keep two or three `doing` at most. New things you build that were never on
the board get a `done` entry too.

**The owner's own requests** are stored on the live site, which you can't read. They paste "Copy for Claude" output, which lists new requests with ids.
To pick one up add an item with `"request": "<that 12-character id>"`, status `doing`, a `kind`, `"area": "Your requests"` and a note; the board
shows the owner's title with your status. Finish it with `done` + `date`. (An entry whose request no longer exists just shows as a normal item.)

## Working with the owner

Casual, direct, short. Ask when the request is vague instead of guessing. Push back lightly when something doesn't add up. Make a
recommendation instead of listing every option. Ask before anything hard to reverse or outward-facing.
