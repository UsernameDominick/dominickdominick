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
- **Extra melodic parts (bass, chords, lead):** `bass`, `chords` and `lead` are each `{notes, ties, voice, volume, muted, hidden}` with the same shape as `melody`, over a two-octave roll of their own (bass C1 to B2, chords C3 to B4, lead C4 to B5; melody is C3 to B4), with default voices bass, pad and lead. The engine keeps them in one registry (`PART_KEYS`, `PART_NOTES`, `PART_OCTAVES`, `partVoiceOf`, `isPartMuted`); `worker/songs.js` and `song-files.js` loop the same keys, so a fourth part is a one-line addition in each. A part is absent until used (the builder creates it in memory with `ensurePart(key)` and `pruneParts()` drops an empty, uncustomised one at save, so old songs are stored unchanged and the engine's noise seed only includes parts that have notes). The open pattern's part is `songData[key].notes/ties`, every other pattern's is `patterns[X][key] = {notes, ties}`, and it follows the same four-places rule. In the builder the piano roll shows one part at a time (`rollPart`, `roll()`, `rollNotes()`), so every roll tool works on any of them; never read `songData.melody` in code that should also serve the other parts. A MIDI file writes bass, chords and lead on channels 2 to 4 (own tracks named Bass, Chords, Lead; the chords and lead tracks carry a marker text event so our own file re-imports into the right part); a foreign track named "bass" or one mostly below C3 becomes the bass.
- **Bars, lanes, sound tweaks:** `bars` (1 to 64, absent = as long as the music) is the song's length; `lanes` is `{ drums|bass|chords|melody|lead: { order: ["A","B"], loop: false } }`, a run of patterns for one track (a track with no lane follows the song order `chain`; a lane shorter than the song loops until it ends unless `loop` is false). There are 16 patterns (A to P) and the order is at most 64 bars. The engine resolves it with `songBars` / `laneOrder` / `patternAtBar` / `barView` (the song as it sounds in one bar; `viewOf` when there are no lanes), the player reports `info.patterns` (the pattern each track plays now) and `currentPatternFor(track)`, and `song-files.js` `chainParts` is kept equal by `tests/song-chain.test.mjs` and `tests/song-lanes.test.mjs`. A part (and melody) can carry `synth`, a few clamped tweaks laid over its named voice (`Engine.cleanSynth`; the same ranges are in `song-files.js`, and `worker/songs.js` only checks the keys and types). `scale` may carry `snap: true` (notes played or tapped move to the scale). The defaults for a new song come from Site Settings (`song_default_tempo/bars/kit`, `worker/song-defaults.js`).
- **Sounds:** the instruments are `MELODY_VOICES` in the engine (grouped for the menus by `VOICE_GROUPS`; the builder fills `#song-voice`, `#song-bass-voice`, `#song-part-voice` and `#song-kit` from the engine at start, so a new voice or kit is added in the engine, in `song-files.js` (`MELODY_VOICES`, `KITS`; a test keeps them equal) and, for a kit, in `worker/song-defaults.js` and the Settings menu in `index.html`; the first five voices and three kits are pinned, their numbers never change). Kits are `KIT_PARAMS` over `DEFAULT_KIT` (a kit only names what differs; `KITS` is the menu order because number-like names sort first in an object). A voice may use `unison`, `sub`, `partial`, `noise`, `drive`, `fm`, `tremolo`, `vibrato`, `wobble`, `slide`, `ftype` and a filter sweep; these parts are only built when asked for. A track's `synth` tweaks (`SYNTH_RANGES` + `ftype`) are mirrored in `song-files.js` and `worker/songs.js` (`SYNTH_KEYS`). One drum sound's own `tune`, `decay` and `tone` live in `trackMeta[row]` (`DRUM_RANGES`, `drumShape`, `kitParams`; mirrored in `song-files.js` and checked in `worker/songs.js`). A new knob is added in all of those and in the Studio's `KNOBS`.
- **Audio wakes from a tap:** a phone keeps the sound asleep, so everything that makes a sound calls the builder's `ensureAudio()` first (Play, Preview, keys, pads). Do not add a new sound path that calls `getAudioCtx()` alone.
- **Recording helpers:** `quantizeSteps` (0, 1, 2 or 4; `localStorage.songQuantize`) moves a recorded note to the nearest grid line in `recordingSpot`; the Studio keeps `followOn` (`songFollow`) and `recTop` (`songRecTop`: arming Rec, or Play while armed, starts from the top).
- **Pump** (`pump`, 0 to 100, absent when off) ducks all the music (melody, bass, chords, lead) on every kick: with it on, `scheduleStep` routes `scheduleMusic` through a per-context music bus (`withMusicBus`) that `duckMusic` automates. With it off nothing extra is built, so graphs and seeds are unchanged (`tests/song-pump.test.mjs`).
- Drum rows: the four core rows always exist; open hat, rim, tom and crash exist once added (found by their `trackMeta` entry). Melody instruments are `melody.voice` (absent = the plain waveform note).
- Test helpers: `tests/fake-audio.mjs` (recording Web Audio stand-in plus engine and song-files loaders). A browser test can see which pattern is sounding by wrapping `SongEngine.createPlayer` in an init script (see `tests/e2e/test_song_patterns.js`).

## Song Studio view

`public/admin/song-studio.js` is the Song builder's only UI, drawn from the owner's sketch and built for a phone first. Top to bottom: five track cards stacked on top of each other like a deck (each card behind shows its top strip; scroll through them with a swipe, the wheel or the arrow keys, or tap one; the open one is in front), the open track's card (a strip of bars with Loop, + Bar and a menu; Steps or Roll to draw the notes; Sound, Tools, undo, redo, mute, clear), the play controls (play/pause, stop, rec, a volume button and a metronome button that each open a small slider popover (on a wide screen the volume slider is just there), BPM), and the keys that stay at the bottom (a piano you scroll sideways, or pads on Drums). **Tools** (top bar) opens a sheet with five tabs: Sound (the open track's instrument, a Wave and sliders for attack, decay, sustain, release, brightness, thickness and vibrato; for Drums the kit, one chosen sound's volume and mute, add a sound), Track (the builder's own tools for the open track and the scale with Snap), Song (tempo, length, swing and the rest, metronome sound, mix, notes, templates), Patterns (the builder's arrangement section) and Share (player look, preview, exports). There is no other view: `localStorage.songView = "classic"` still shows the old editor, but only so the older browser tests (which the runner seeds with it) keep driving it; nothing offers it.

It stores nothing and is a view over the builder's own editor, which stays in the page, hidden. **The five tracks are fixed and in this order, 1 Drums, 2 Bass, 3 Chords, 4 Melody, 5 Lead** (the owner asked for a set order that cannot be changed or extended; do not add a way to add, remove or reorder them); each is also the name of its lane. They are a grouping of the song's own data: Drums is every drum row in one grid (with pads for keys), the others are the `bass`, `chords`, `melody` and `lead` parts, each on its own roll. The step cells are a mirror painted from `songData`, and every control drives the builder's: a tap clicks the matching step (`#song-sequencer` / `#song-piano-roll`), choosing a note track clicks the `#song-roll-<part>` button so the real roll shows that part, sliders and menus set the matching control and fire its event, play is `#song-play`. The sheet **moves the builder's own controls into it, ids and all** (`buildSheet`), so they keep working; the selects the Sound tab drives (`#song-voice`, `#song-bass-voice`, `#song-part-voice`, `#song-kit`, `#song-waveform`) stay hidden in the builder. A card counts a held (tied) step as part of the note before it, not as another note. The Roll draws by dragging (`host.group(true/false)` makes the whole drag one undo step).

Arrangement: `SongStudioHost.arr` (builder) is how the Studio edits bars: `info(track)`, `openBar`, `addBar`, `differ` (a bar gets a pattern of its own: a copy of that track's part only), `removeBar`, `setLoop`, `follow`, `setBars`. The builder has one open pattern at a time (the song's own `tracks` and `melody`), so opening a track or a bar opens the pattern that track plays in that bar. While playing, the Studio follows the music from bar to bar. Recording writes where the music is, not where it was scheduled: `recordingSpot(track)` uses the step that is sounding now and the pattern that track plays in this bar (another pattern's notes are written into `songData.patterns[X]`), and with Loop off on the open track (and no fixed length) `extendLaneForRecording` adds an empty bar just before the track runs out so the take can go on while the other tracks keep looping.

Things that have bitten: the studio's own buttons that only navigate or proxy undo/redo/play carry `data-no-history` (otherwise the click is captured as an edit, which would clear the redo stack or add a bogus undo step); `SVGElement` has no `hidden` property, use `toggleAttribute("hidden")`; the 24px floor rule for song controls on phones has an id in its selector, so studio sizes that need to be larger are repeated with `#song-builder-modal #song-studio` at the end of `style.css`; a row or roll that is hidden in the builder has no cells to click, so the studio opens it first; a rebuilt popover must give the focus back (otherwise Escape reaches the dialog and closes the whole builder); `.studio-pop` is shown and hidden by the class `is-open`, not `hidden`, so the volume slider can stay open on a wide screen. The builder tells the Studio about playback through `SongStudioHost` (the builder defines it) and `window.SongStudio.step/stopped/played/refresh/openLane`.

Pause is real: `createPlayer().start(atTime, { step, chainIndex })` carries on from a step, the builder remembers where it stopped (`resumeFrom`), and only the Studio's Pause sets it (the old Play still stops). `tests/e2e/test_song_studio.js` switches to the Studio itself (desktop, bars and free recording, a 390 px touch phone, hidden rows, the Songs settings tab; `test_song_parts.js` covers the Chords and Lead parts in the old editor), and `tests/song-resume.test.mjs`, `tests/song-lanes.test.mjs` and `tests/song-defaults.test.mjs` cover the logic.

## The page editor (first slice of the Squarespace-style admin)

The admin opens on the page itself. `page-first.js` puts the page chooser (`.admin-sidebar-pages`) in the top bar on a wide screen (it stays in the menu drawer on a phone). The menu (☰ Tools, `#admin-sidebar`) and the inspector are hidden on a first visit (`panels.js`, state key `admin-panels:v2`; `AdminPanels.show(name)` brings one back); the block palette (`#palette`) is a floating **picker**: `+ Add` (blocks, at the bottom of the page), `Page settings` (the palette's Page tab) or a **click on an empty spot of the canvas** (the block lands in that column and row, no wider than the room beside it, and whatever it overlaps is pushed down with `BlockFit.settleDown`; then it is selected with its quick editor open). `pendingInsert`, `openPicker`, `closePicker`, `gridCellAt` and the hover ghost (`.insert-ghost`) are in `app.js` next to the canvas pointer handlers. A selected block's toolbar is Edit, **Size** (¼ ⅓ ½ ⅔ Full and Left/Centre/Right, `applySize`, never into another block), Copy, Duplicate, Lock, **Settings** (opens the inspector), Fit, Delete. On a phone nothing of this applies: the stacked list, the drawer and the `+ Block` button are as before. The e2e runner seeds `admin-panels:v2` with everything visible so older tests keep driving the menu; `tests/e2e/test_page_first.js` starts clean as the owner would. Still to do: real-looking blocks in the editor (the preview blocks are miniatures), insertion bars between blocks on a phone, retiring the old inspector for the settings bar.

## The Studio page (/studio)

`/studio` is the Studio for every visitor: a built-in nav link (`BUILTIN_NAV` in `worker/nav-settings.js`, reserved slugs `studio` and `studio-app`, listed in the sitemap) whose page is the site shell with one frame, `/studio-app/` (`public/studio-app/`). The frame is the same song builder the admin uses, so its stylesheet and scripts cannot collide with the site's. `studio-app.js` fetches `/admin/index.html`, injects its body (scripts stripped: the builder looks up many ids, so everything comes along, hidden), loads the song scripts, and answers the builder's `window.adminApi` calls itself from localStorage (`studio.songs.v1`, `studio.templates.v1`: songs, templates, duplicate, delete; `/settings` is empty, `/content-usage` is empty). Nothing is sent to the server and a visitor's songs stay in their browser. Owner-only bits are hidden in `studio-app.css` (usage, cover art to the media library, help). **The builder's markup lives in `public/admin/index.html` (`#songs-modal`, `#song-builder-modal`)**: if that page is ever restructured, keep those ids (or move the markup to a shared file and load it from both). The frame follows the site's light/dark through the parent's `data-theme`. `tests/e2e/test_studio_page.js` covers it as a visitor.

## Hidden Notes

`/hidden-notes` (owner only; anyone else gets the normal 404) is a vault of notes sealed in the browser (`public/hidden-notes.js`, PBKDF2 then AES-GCM). The server (`worker/hidden-notes.js`, `/api/admin/hidden-notes*`) only stores sealed blobs in `hidden_note:*` settings rows plus `hidden_notes_meta`. Those rows are excluded from `exportAll`, skipped on import, and left alone by a restore (`isHiddenNotesKey`). Never log a note's content, never render it server-side, and keep it out of any new export or search.

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
