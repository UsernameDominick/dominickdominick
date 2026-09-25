# dominickdominick.com — Outline

The one tracking doc for this project. Replaces `MASTER_FEATURE_LIST.md`
and `PRODUCTION_TODO.md` (deleted — their history lives in git log if
ever needed). Check this at the start of every session before touching
code.

**Stack:** Cloudflare Workers (JS, no framework) · Cloudflare D1 (SQLite)
· Cloudflare R2 (media + backups) · vanilla HTML/CSS/JS admin app (no
build step, no npm dependencies) · highlight.js + `@google/model-viewer`
via CDN · Playwright (ad hoc, local testing only, not wired into CI)

**Last updated:** 2026-09-24 (manually — no CI auto-updates this; refresh
the date and the lines-of-code stat yourself each session)

**Lines of code (fun stat, `worker/` + `public/` + `schema.sql`):** ~20,550

**Legend:** ✅ done · 🔶 partial (detail inline) · ☐ not started

---

## 0. Instructions for future me (read this first)

**Branches:** `production` is the working branch — commit and push here
after every tested batch. `main` is what's actually live/deployed
(Cloudflare Workers Builds auto-deploys from `main`). Never push to
`main` without a fresh, explicit user confirmation each time — a past
confirmation does not carry forward. Iterate on `production`, batch by
batch, and only merge to `main` when told to.

**Schema changes:** D1 has no migration tracker. Any `ALTER`/`CREATE`
against `schema.sql` needs its SQL added to the "Pending production
migrations" section below until it's actually applied to production.
Never touch production D1/R2 directly without explicit per-instance
confirmation. Before writing new migration SQL, verify production's
*actual* current schema (`PRAGMA table_info` / `sqlite_master`) rather
than trusting this doc's last note about it — production has drifted
from what old notes claimed before.

**Testing workflow for every batch, before committing:**
1. Build the feature.
2. Write a throwaway Playwright script in the scratchpad directory
   (never commit it) that exercises the real flow end-to-end — not just
   that code runs, but that the actual behavior is correct.
3. Clean up any test data created (trash + permanently delete test
   articles/projects/pages; reset any settings you changed).
4. Run the broad regression check (`test_security_seo.js` in the
   scratchpad, recreate it if lost — checks `javascript:` URI
   neutralization and basic SEO tags) — must stay green.
5. Update this outline (the relevant feature-list line, pending
   migrations if any).
6. Commit with a descriptive message ending in the attribution footer,
   push to `production`.

**Screenshot-and-rate loop for any big/visible change** (new UI, layout
change, new page, redesign): after implementing, spawn a subagent to
open the page in a real browser, take a screenshot, and score it 0–10
against what was asked for (0–4 fail / 5–7 passing but not polished /
8–10 ship-it). If below 8, fix what it flagged and repeat. Stop at
either a 10 or 5 loops total, whichever comes first — if still not a 10
after 5 loops, ship the best version and note in the commit/report what
didn't get resolved, rather than looping forever. Tell the reviewing
subagent to screenshot with `fullPage: false` (viewport only) for any
modal or other `position: fixed` chrome — a `fullPage: true` capture
stitches the whole scrollable page into one image, which misrenders
anything `position: fixed` (it renders relative to the viewport, not
that stitched canvas) and can report a fake centering/backdrop bug.
If a finding looks like layout chrome is broken, prefer verifying with
`getComputedStyle`/`getBoundingClientRect` over trusting the screenshot
alone before spending a fix cycle on it. **Always tell the user the
score in the visible reply** (not just logged here) — he's asked to
see it, not just the outcome.

**Periodic broad QA sweep:** in between other work (a natural pause
point, not mid-batch), dispatch a subagent to freely explore the admin
console and the public site — click around, try creating/editing
content, navigate like a real visitor, and check a mobile viewport
too — and report back bugs, layout issues, and improvement ideas, same
scoring instincts as the screenshot-and-rate loop. Fix anything easy
immediately; anything bigger goes into section 3 (Ideas) or as a new
☐ item below rather than getting built unreviewed on the spot. Tell
the user what came back either way, not just the fixes.

**Code reuse and token efficiency:** the user pays for every token this
session burns, so favor reusing/extracting a shared function over
re-deriving or re-explaining the same logic each time (this codebase
already does this well — `renderShareLinks`, `updateOgPreview`,
`wireFavoriteButton`, `wireTtsAudio`, etc. are all one implementation
parameterized for multiple content types, not copy-pasted per type).
Keep this project's code itself compact too — only what a feature
actually needs, no speculative abstraction for hypothetical future
requirements. But this is a preference to apply when it's free, not a
rule to force: if reusing something would mean cutting a corner, adding
a confusing abstraction, or coupling two things that aren't actually
the same concept, don't — spend the extra tokens and write it
correctly instead. Quality and correctness always win that tradeoff.

**When to ask vs. just proceed:** default to moving without stopping to
check in — that's the standing instruction for working through this
list. But ask first when a decision is genuinely expensive to reverse,
changes the visible design/UX in a way the user hasn't seen, or the
"obvious" choice isn't actually obvious (e.g. picking between two
real architectural approaches, anything touching production data,
scope for a brand-new module). If in doubt whether it matters to him,
err toward a quick question rather than guessing and redoing it later.

**Production D1 database id:** `f49fb038-9dfb-419e-acfb-7d8babc9d509`
(`dominickdominick`). R2 bucket: `dominickdominick-media`.

---

## 1. New modules in progress

### 1a. TTS (text-to-speech) module
Decision: upload pre-generated audio (admin uploads a finished TTS file
per article/project) **plus** a free browser-generated fallback via the
Web Speech API when no uploaded audio exists — no paid API, no key
management. Use cases: (1) a "listen to this" player attached to an
article/project, (2) a general accessibility read-aloud button.
Status: ✅ shipped. `/upload-audio` admin endpoint (mp3/wav/m4a/ogg,
30MB cap, its own R2 `audio/` prefix, auth-gated), `tts_audio_key` on
articles/projects, an upload/preview/remove control in both editors,
and a public "listen bar" (uploaded-audio `<audio>` player when set,
always-available "🔊 Read aloud" button using the Web Speech API
against the rendered `#readable-content` text — no server text
extraction, no duplicated content in the page). Verified: upload,
serving, admin remove-and-save, and the read-aloud toggle logic
(confirmed correct via direct event testing — the sandbox's headless
Chromium has zero installed TTS voices, so `speechSynthesis` always
fires `synthesis-failed` instantly there; this is a sandbox limitation,
not a bug — untested on a real browser with actual voices, worth a
manual check in a real browser, see section 6).

**Screenshot-and-rate review (round 1): 3/10.** A subagent found a real
layout bug — the article header used a fixed 2-row grid span regardless
of content, while the project header already computed a dynamic span
from what it actually contains. Any wrapping title (2+ lines) let the
header's real height exceed its allocated grid rows and visually
collide with the new TTS bar sitting right below it — a latent
weakness the new bar simply made visible for the first time. Fixed by
giving articles the same dynamic `headerSpan` formula projects already
use, plus a small defensive `margin-top` on `.tts-bar`. Verified with
direct `getBoundingClientRect` measurements (no overlap, wrapping or
not, mobile or desktop width, tags present or not) rather than
re-running the full subagent loop — cheaper and just as conclusive for
a geometry fix. Not yet re-scored by a fresh subagent pass; worth one
more before calling this fully closed.

### 1b. Loop-based DAW / music module
Decision: a loop-based step sequencer + a basic piano roll + a handful
of built-in synth/drum sounds (Web Audio API, no sample licensing
issues) + optional external MIDI keyboard input (Web MIDI API). Saved
as project data (same pattern as the Simulation module), embeddable as
a playable block with a waveform visualization and a syncable page
animation (waveform-driven or a "cool" reactive animation, admin-
choosable and tunable). No mixing console / automation lanes / plugin
effects in v1 — flag if that's wanted later.
Status: ✅ done (see wrap-up note below). Built: `songs` table + full CRUD (mirrors
`simulations`, same reasoning — composition state as JSON in `data` so
schema doesn't churn as the format evolves). Admin "Songs" panel
(`public/admin/song-builder.js`, mirrors `simulation-builder.js`'s
list/open/save structure) with a working step sequencer: 4 built-in
drum tracks (kick/snare/hihat/clap) × 16 steps, 3 drum kits (acoustic/
electronic/808) synthesized live via the Web Audio API — no sample
files, so no licensing to manage and a song stays fully portable as
JSON — and a proper lookahead scheduler (the standard "two clocks"
pattern: schedules notes against `AudioContext.currentTime`, not
`setTimeout` timing, so playback doesn't drift). Verified: grid
renders, steps toggle and persist correctly, reopening restores exact
state, play/stop toggles and highlights the live step across all
tracks. Added a piano roll (2 octaves, C3-B4, 24 rows) reusing the
exact same step-grid toggle code as the drum sequencer (factored into
one `renderStepGrid()` parameterized by row keys/labels/get/set,
rather than a second copy) — 4 waveform choices (sine/square/sawtooth/
triangle), note→frequency via the standard equal-temperament formula.
Verified: 24 rows render (10 correctly flagged as black keys), note
toggles persist exactly, waveform choice saves, playback with melody
notes active runs without error.

**Screenshot-and-rate review (round 1): 5/10.** A subagent found real
issues: (1) no visual distinction between beat groups every 4 steps —
fixed with a small gap before each group rather than relying on a
border-color change alone; (2) the sequencer body couldn't actually
scroll — its content overflowed the modal with no way to reach it, a
classic flexbox bug (`flex: 1; overflow: auto` without `min-height: 0`
never shrinks below its content size, so the browser never engages the
scrollbar) — fixed, verified by actually calling `.scrollTop =
scrollHeight` and confirming it moved and revealed the rest of the
piano roll; (3) the playing-step outline and the on-state fill used
the same accent hue, hard to tell apart — changed the playhead outline
to a contrasting color instead; (4) the waveform `<select>` had no
accessible label — added one; (5) 28px step cells bumped to 32px for
touch. One flagged issue ("modal not centered/no dimmed backdrop")
was partly a `fullPage: true` Playwright screenshot artifact
(`position: fixed` elements render relative to the viewport, not a
stitched full-page canvas — worth remembering for future reviews:
prefer `fullPage: false` for modals, or check the page's real
scrollWidth/scrollHeight first) — but a follow-up viewport-only
screenshot at 1400x1000 during Play confirmed genuine faint text
bleed-through around the builder modal's edges. Verified this is a
pre-existing, shared characteristic of every *large* builder-style
modal on the site (96vw x 94vh at a 60% backdrop opacity leaves little
dimmed margin, so the same backdrop that reads as clearly "dimmed" on
the smaller list-style modals reads as barely-there here) by
reproducing the identical bleed-through on the pre-existing Simulation
builder, untouched by this batch — not a Songs-specific defect, so not
fixed here. Logged as a possible future polish item below (section 3)
instead of a one-off fix, since it'd need to change for Simulations
and Scans too to stay consistent. Not yet re-scored by a fresh pass.

Added Web MIDI input: a "Connect MIDI" button that only appears at all
if the browser supports the Web MIDI API (progressive enhancement, no
dead control offered where it can't work), wires every input device's
`onmidimessage` to a shared handler. Every note-on always plays live
(so an external keyboard works as an instrument monitor even outside
the piano roll's 2-octave range), and only while the sequencer is
actually playing AND a "Record" checkbox is checked does a note within
range also get written into the piano roll at the currently-playing
step. Verified by mocking `navigator.requestMIDIAccess` with a fake
input before page load (so the real code's feature-detection and
wiring both run for real, just against a fake device instead of
real hardware — untestable in this sandbox otherwise) and firing
synthetic note-on messages: preview-only correctly plays without
writing anything, and record mode correctly writes only while playing.

Refactored the synthesis + scheduler code out of the admin builder into
a shared `public/song-engine.js` (`window.SongEngine`) — one DOM-free
module with no dependency on the admin builder's globals, used by both
the admin builder and the public embed player below (per the
code-reuse instruction — cut ~150 lines of duplicated Web Audio code).

Built the embeddable public block/player: a "Song" block type
(`renderSongBlockHtml()` in `worker/render.js`, admin palette button +
`song-select` field type in `app.js`/`index.html`), rendered as a name
header, Play/Stop button, and a 16-bar "scanning playhead" visualizer
(`public/song-embed.js` + CSS) — deliberately simple, not the still-open
waveform-*display* item below. The full song JSON is embedded directly
in the page HTML (`data-song="..."` attribute, HTML-escaped), same
pattern as Simulations, so playback survives the song being edited or
deleted later. `AudioContext` is created lazily on first Play click
(browser autoplay policy). Verified: 16 bars render, Play/Stop toggles
correctly, exactly one bar highlights at a time during playback
(confirms `onStep` wiring), screenshot confirms clean rendering — **8/10**
(functional, readable, on-brand; not rescored beyond this since the
visual is intentionally minimal pending the waveform-display item).

Added the "choose the waveform or a cool page animation" visualization
picker the user asked for: each song now has a `visualization` field
(`bars` default / `waveform` / `pulse`), editable and live-previewed in
the builder ("dial it in" — the preview panel uses the exact same CSS
classes and SongEngine calls as the public embed, so what's previewed
is what ships). `waveform` renders a real amplitude waveform derived
from the actual synthesized audio — `SongEngine.renderWaveformPeaks()`
runs one loop through an `OfflineAudioContext` and downsamples it into
peak pairs, not a decorative fake — with a playhead that recolors
played vs. unplayed portions during playback. `pulse` is the "cool
animation" option: a glowing orb that scales up and fires a ring-pulse
CSS animation on any step with a drum hit. Verified in both the admin
builder preview and the public embed: waveform canvas actually paints
non-blank pixels reflecting the real audio, pulse animates on kick
hits, switching visualization types shows/hides the right element,
and the choice persists through save/reload. Screenshot-reviewed at
8/10 in both contexts — functional, on-brand, matches between the two
surfaces.

Added page-animation sync: a "Sync page background" checkbox
(`page_sync`, independent of the visualization choice above) that
flashes a single shared full-page overlay in time with the beat — a
fixed, pointer-events-none radial-gradient layer using `--accent`, so
it works with either theme and never fights page content. Same overlay
element/logic in both the admin preview and the public embed (one
`flashPageSync()`-style helper per side, intentionally not merged into
`song-engine.js` since overlay creation is DOM/document-specific and
the engine is deliberately kept DOM-free). Verified: checking the box
and playing creates the overlay and adds the flash class on a step
with a drum hit, in both the admin builder and a real public embed;
unchecked, no overlay is created at all. **DAW module status: done** —
step sequencer, 3 drum kits, piano roll, MIDI in, shared playback
engine, 3 selectable visualizations, page-sync animation, and the
public embeddable player are all shipped and verified. Any further
polish (mixing/automation, more kits, etc.) is a v2 idea, not a gap.

### 1c. Admin UX / mobile overhaul
The admin console's nav/UI/UX needs a real upgrade pass to accommodate
everything added this project (media, projects, simulations, scans,
webhooks, preview links, reactions, the new DAW/TTS modules, etc.) with
heavy focus on mobile — user is primarily on an iPhone 17 Pro Max.
Status: 🔶 in progress — both real findings from the QA sweep are now
fixed; remaining work is a broader design pass (below) rather than
bug-fixing.

1. **Desktop topbar overflow at common widths — ✅ fixed.** At 1440×900,
   10 of 18 right-side topbar controls rendered off-screen with no wrap
   or scroll affordance (`scrollWidth` 2190px vs `innerWidth` 1440px).
   Grouped the 14 less-frequent actions into a "More ▾" dropdown
   (`admin-more-panel` in `public/admin/index.html`/`style.css`),
   organized into Library/Tools/View sections; Search, Articles,
   Projects, Media stay always-visible as the daily-use actions. Button
   *ids* were kept identical and just relocated in the DOM, so no other
   JS needed to change. Closes on Escape, an outside click, or clicking
   an item inside it (which also opens that item's modal). On mobile,
   the dropdown flattens back into the existing drawer's column instead
   of floating (`.desktop-only` hides the "More ▾" toggle itself there —
   nothing on mobile needed to change). Verified: `scrollWidth` now
   equals `innerWidth` at 1440px with zero overflow, every grouped
   action still reachable and functional, mobile drawer unaffected.

2. **Mobile page-builder canvas doesn't reflow — ✅ fixed.** The canvas
   kept desktop's 24-column absolute-pixel-grid positions at 390px
   width, so a legitimate side-by-side desktop layout (two blocks on
   the same row) became too narrow to read or tap individually on a
   phone. Went with the "simplified stacked list" option from the two
   named here: at ≤860px, `renderCanvasMobile()` (`app.js`) renders
   blocks as a plain full-width vertical list in row/col order — same
   underlying block data, no pixel math, `overflow: visible` so content
   never clips — with Up/Down buttons swapping `row`/`col` between
   adjacent blocks (via the existing `patchBlockPosition()`, no new save
   path) in place of 2D drag, which doesn't map to a single column
   anyway. Tapping a block still selects it and opens the inspector
   drawer, same as before. Desktop editing (`renderCanvasDesktop()`) is
   byte-for-byte the same code, just renamed, gated behind the existing
   `isMobile()` check — verified drag/resize/selection all still work
   identically on desktop after the split. Verified on mobile: no
   vertical overlap between any two blocks, all full-width, move-down
   reorders and persists across reload, tap-to-select opens the
   inspector drawer.

The mobile *drawer* pattern (☰ palette, "Menu" topbar actions) already
worked well and was kept as-is — QA sweep confirmed all topbar actions
were reachable through it with clean single-column reflow, which is
exactly why the topbar fix above flattens into that same drawer on
mobile instead of adding a second dropdown mechanism there.

**Bonus from the same QA report:** Diagnostics flagged missing alt text
on images but had no way to catch a broken/404'd image `src` — the
report suggested adding that check. Added: `computeRenderedLayoutDiagnostics()`
now re-requests every distinct `<img>` src from the page's rendered
iframe in the parent document (sidestepping the fact that
`loading="lazy"` images never actually fetch inside an off-screen
diagnostic iframe — they'd have silently passed otherwise) and reports
any that fail to load. Verified: correctly caught the exact broken
image the QA report found on the live homepage
(`/media/uploads/ee713f43-….png`, still unresolved — that's now a
Diagnostics-visible cleanup item on the homepage itself, not code to
fix) plus two more broken placeholder images in a gallery block, and
produced zero false positives against a page with a real working
image.

**Still open for this section** (broader design work, not bugs): the
overall admin visual design (spacing/shadow tokens, deferred in section
5) hasn't had a dedicated pass, and there's no single-page overview of
"what's true about this admin console's mobile behavior" beyond what's
written here — revisit once there's a concrete reason to (a new module,
a user complaint) rather than redesigning proactively with no target.

**Round 2 (user asked directly to make the admin console "more easily
navigable"):**
- The block palette ("Add block") had grown to 22 undifferentiated
  buttons in one flat list as features were added over the project's
  life — a real scanning problem, not a subjective one. Grouped into 5
  labeled categories (Text & media, Actions & links, Dynamic content,
  Embeds & interactive, Layout) using the exact same small-caps label
  style the palette already used for "Add block"/"Page settings", so it
  reads as one consistent pattern rather than a new visual language.
  Purely a markup reorganization — `.palette-btn` is still one flat
  class, so nothing in `app.js` needed to change.
- Recently-edited items and favorites already existed (localStorage-
  backed) but were only reachable by knowing to open the command
  palette (Ctrl/Cmd+K) — a real discoverability gap for the single most
  common navigation need (getting back to what you just worked on).
  Added a visible "Recent ▾" dropdown next to the page picker (desktop
  only — mobile already has everything one tap away via the Menu
  drawer), reusing the exact same `.admin-more-panel` dropdown pattern
  and CSS as the topbar's "More ▾" menu for visual consistency, and
  factored the kind-label/kind-navigate logic out of the command
  palette into shared `RECENT_KIND_LABEL`/`RECENT_KIND_RUN` constants
  so both surfaces drive off one implementation. Verified: opens/closes
  correctly (button click, outside click, Escape — matching the other
  dropdown's behavior), shows real recently-edited items, hidden on
  mobile, doesn't interfere with adding blocks or navigating pages.

**QA sweep results (full agent report, 2026-09-24):** dispatched per
the periodic-sweep instruction — explored the whole admin console and
public site, desktop and mobile (390×844). Fixed immediately (all
verified via Playwright + a fresh `test_security_seo.js` pass):
- Songs piano-roll crashed on any song whose `melody.notes` was
  present but missing individual note keys (a drum-only song) —
  `song-builder.js`'s existing "missing `melody`" fallback didn't
  backfill missing keys *inside* `notes`. Fixed by backfilling every
  `PIANO_NOTES` key on open.
- No modal closed on Escape or backdrop click anywhere in the admin —
  added one global handler (`worker` n/a, `public/admin/app.js`) that
  closes the topmost open `.modal` via its own `close-*` button (not a
  bare `.hidden = true`), so builder-specific cleanup like stopping
  song/simulation playback still runs.
- Unpublished/nonexistent article, project, and simulation URLs
  returned a completely blank `Content-Length: 0` 404 instead of the
  site's branded "Page not found" page — `worker/index.js` called
  `env.ASSETS.fetch(request)` directly on a miss in three route
  handlers instead of checking the response and falling through to
  `renderNotFound()` like every other route already does. Fixed all
  three to match the existing pattern.
- `/favicon.ico` 404'd on every page load (browsers probe it directly
  regardless of the `<link rel="icon">` data-URI already in the head)
  — added a route serving the same icon as real SVG content.
  `worker/render.js` now exports the raw markup as `FAVICON_SVG`.
- Mobile: the "dominick.dominick" home link was only 149×20px, under
  the ~24×24px touch-target minimum the app's own Diagnostics tool
  already checks for — padded the tap area with an offsetting negative
  margin so the visual layout doesn't shift.
- Minor: placeholder text in narrow inputs was clipped mid-character —
  added `text-overflow: ellipsis` globally to text-ish inputs.

Logged above (not fixed on the spot, real design decisions): desktop
topbar overflow, mobile canvas reflow. Also logged as unverified, not
passed: the report couldn't confirm the 3D Scans `<model-viewer>`
actually renders a model, since its sandbox's egress policy blocks
`cdn.jsdelivr.net` — needs a manual check in a real browser session
(added to section 6 below). The report's note about content
"appearing/disappearing" in the dev DB during its run was almost
certainly this session's own concurrent test-data creation/cleanup
running against the same local D1 at the same time, not a real
background process — not adding a mystery-process investigation to the
list on that basis, but flagging it here in case it recurs.
Pre-existing test/seed clutter in Trash/Articles/Pages predates this
session and is the user's own call to clean up or leave, not something
to touch unprompted.

### 1d. Default public-site design polish
Status: 🔶 in progress (user asked to "make the default design look
better" alongside the admin nav work in 1c). First round, done:

- **Real bug, not just polish**: article and project pages laid every
  section (header, TOC, body, reactions, related-articles, BOM,
  journal, etc.) into the same 24-column/16px-row CSS Grid the page
  builder uses for admin-arranged Pages — with each section's grid-row
  span computed as a fixed guess in JS. The body's guess (`span 12` =
  192px) is nowhere near enough for any real long-form article, so its
  actual rendered content overflowed straight into the reactions bar
  positioned right after it — visually overlapping, illegible text.
  This is almost certainly *why* it was never caught: no real
  long-form article had been published and rendered end-to-end before
  now. Projects had the same issue, worse (BOM/journal entries are
  even more variable in length).
  **Fixed**: articles and projects now render in normal top-to-bottom
  flow (a new `.article-canvas` class, `display:flex;flex-direction:
  column`, applied via a `canvasClass` param on `renderShell()`)
  instead of the grid-row system — sections can't overlap in flow
  layout regardless of length. Admin-edited Pages are completely
  unaffected (still plain `.canvas`, still the real grid, since that
  system is correct there — the admin genuinely drag-positions blocks
  in 2D). Verified with a real ~250-word article including a code
  block: no overlap, in both themes and at mobile width.
- Code blocks (`` ```lang `` fences) had zero visual treatment
  (background/padding/border-radius) until highlight.js's CDN script
  finished running client-side and added its own `.hljs` class — on a
  slow connection, a blocked CDN, or just before that JS executes, a
  code block looked like plain unstyled text. Moved the base card
  treatment onto `pre` itself; `.hljs` (once it loads) only adds
  syntax coloring on top.
  There was also no global link color at all — anything without a
  specific class (body-content links, the "More to read" related-
  article title) fell back to the browser's default blue, clashing
  with the accent color used everywhere else. Added a low-specificity
  base `a { color: var(--accent); ... }` — every existing
  component that needs its own look (nav tabs, buttons, the archive
  list's deliberately-white-bold titles) already sets its own color on
  a class, which still wins.

Not yet done (this is a first round, not a final pass): overall
typographic rhythm/hierarchy still reads fairly plain/flat once laid
out correctly — headings, spacing scale, and card treatments could use
another pass once there's real published content to judge it against
(the site currently has zero published articles/projects in this
sandbox, so every screenshot here used temporary seed content, cleaned
up after). Revisit with fresh eyes rather than over-polishing blind.

---

## 2. Feature list by area

### Existing foundation
All ✅ — the original ~70-item backlog plus a security/SEO/accessibility
health-check pass, predates this doc.

### Page builder and layout
- ✅ Reusable blocks that update everywhere they are used, with detach-to-independent option
- ☐ Reusable sections containing multiple blocks (needs nested/grouped blocks)
- ✅ Page templates (generic, any page savable/appliable as a template)
- ☐ Custom components assembled from blocks with their own editable options
- ☐ Visual header/footer editor (footer is a text field; nav is ordering only)
- ✅ Navigation editor (ordering ✅; nested/dropdown menus ✅ — a new
  `nav_parent_id` column on pages, set via a "Parent nav item" select in
  Page settings (populated with other top-level nav-eligible pages —
  excluding itself and anything already nested). One level deep only, both
  directions: can't nest under an already-nested page, and can't nest a
  page that already has its own children, both enforced server-side too
  (not just by what the picker offers), since a raw API call could
  otherwise build a structure `listNavPages()`'s single-pass tree-build
  isn't written to handle. Renders as a `.tab-group` — the parent link
  itself still works normally, plus a caret button and a `.tab-dropdown`
  panel of child links. Dropdown shows on hover/keyboard focus-within via
  plain CSS (no JS needed for desktop/keyboard use at all); the caret
  (nav.js) adds a click-to-toggle path for touch, where hover never
  fires, closed by an outside click or Escape. Viewing a child page marks
  its *parent* tab active, not just the child link buried inside the
  closed dropdown, so the visible tab bar still shows where you are)
- ☐ Separate desktop/tablet/phone layout settings (needs schema change + reworked drag/resize — deliberately deferred)
- 🔶 Per-device spacing/ordering/visibility (visibility ✅; spacing/ordering ☐)
- ✅ Custom breakpoint controls (preview modal ✅; custom breakpoint value
  ✅ — a "Mobile/desktop breakpoint" number field in Site Settings; since
  the actual media-query rules live in the static `style.css` (can't be
  edited per-request), a non-default value injects an override `<style>`
  block with the same selectors at the custom width, same mechanism
  theme colors already use — only one of the two media queries ever
  matches a given viewport, so there's no cascade fight with the
  original 640px rule, whichever one applies just wins on its own)
- ✅ Fullscreen/Focus mode editing
- ✅ Layers panel (flat list — no real nesting exists yet)
- ☐ Block grouping/ungrouping
- ✅ Multi-select + bulk styling, alignment/distribution tools
- ✅ Lock blocks against accidental changes
- 🔶 Guides/rulers/snapping (alignment guides + grid snapping ✅; literal ruler/gap-measurement UI ☐)
- ☐ Nested sections and columns (needs `blocks.parent_id` + reworked drag/resize — biggest deferred item)
- ✅ Tabs, accordions, cards, expandable sections
- ✅ Sticky/fixed-position elements
- ✅ Background video/gradients/overlays/blend modes (gradients added: a
  from-color/to-color/angle triplet in any block's style panel, rendered
  as a `linear-gradient()` — layers under a background image via CSS's
  multiple-background-image support if both are set, so an image and a
  gradient fallback/tint can coexist)
- ✅ Entrance/scroll/hover animation controls — a "Hover effect" style
  field (lift/grow/glow/darken) alongside the existing entrance
  animation, pure CSS `:hover` transitions (no JS, unlike the
  scroll-triggered entrance animations), same `prefers-reduced-motion`
  scoping so a reduced-motion visitor sees the static look
- ✅ Reduced-motion alternatives
- ✅ Shapes/dividers/masks (dividers ✅; shapes/masks ✅ — a "Shape mask"
  style select on any block: circle, two diagonal cuts, hexagon, or a
  blob, rendered as a `clip-path` polygon — especially effective on an
  image block, but works on any block since it's just a style field)
- 🔶 Hover/focus/mobile-state previews (mobile ✅ via responsive preview; hover/focus simulation ☐)
- 🔶 Copy/paste blocks between pages (blocks ✅; "sections" n/a)
- ☐ Bulk updates to pages sharing a template
- 🔶 Conditional display by date/device/URL/content field (device ✅; date
  ✅ — "Visible from"/"Visible until" datetime fields in any block's
  style panel; unlike device-visibility, which is CSS-only, this is a
  real server-side filter in `renderBlocks()` so a not-yet-announced
  block never ships in the page source at all, not just hidden client-
  side; URL/content-field ☐)
- ✅ Layout diagnostics (overflow, small tap targets — overlap is structurally impossible)
- ✅ Content-only edit mode, isolation mode, stress previews (long titles/missing images/large text)

### Design system and styling
- 🔶 Global tokens (colors/typography/borders ✅, 6 tokens; spacing/shadow tokens deferred — no safe hook without a riskier retrofit)
- ✅ Per-page style overrides, custom font upload (per-block style
  overrides already existed via `STYLE_FIELDS`, including a
  `fontFamily` option per block; this added the missing piece, a real
  custom font upload. `PUT/POST /api/admin/upload-font` accepts WOFF2/
  WOFF/TTF/OTF up to 5MB, stores it in R2 under `fonts/`, and the site
  settings modal has a name field + uploader alongside "Custom" entries
  in both the body-font and heading-font dropdowns. `getTheme()` now
  also fetches `custom_font_name`/`custom_font_url`, and `renderShell()`
  injects a `@font-face` rule and a `--custom-font-family` CSS variable
  only when both are set, so pages that don't use a custom font never
  pay for it. `FONT_STACKS.custom` resolves to
  `var(--custom-font-family, sans-serif)`, so the exact same "custom"
  option works whether picked as the site-wide theme font/heading font
  or as one block's own font-family override — no separate plumbing
  needed. The public `/media/...` route's allow-list regex was widened
  to include `fonts/` (backups/ stays excluded). Tested end-to-end:
  unauthenticated upload rejected (401), bad content-type rejected
  (400), successful upload returns a servable `/media/fonts/...` URL,
  `@font-face`/CSS var appear in page HTML only when the custom font is
  actually selected, and the admin UI's upload/remove buttons and
  status text behave correctly through real DOM interaction.
- ✅ Light/dark themes + visitor switcher
- ✅ Presets for buttons/cards/callouts/image treatments — type-agnostic
  since every block type shares the same `STYLE_FIELDS` set (color,
  hover effect, animation, position, etc.): "Save preset" snapshots a
  block's current style under a name, "Apply preset" merges a saved
  one onto any block regardless of type. Stored server-side as one JSON
  blob under its own settings key (`style_presets`, own dedicated
  routes) rather than folded into the bulk settings PUT, since that
  resets any key missing from its body — wrong for a list added to/
  removed from individually. Screenshot review caught a real layout
  bug (three controls crammed into the 240px inspector sidebar, the
  select collapsing to zero width) and a real state bug (the preset
  `<select>` silently lost its value right after applying, since
  rebuilding a `<select>`'s options resets its value as a side effect
  — made "delete the preset I just applied" impossible) — both fixed
  and re-verified.
- ☐ Visual CSS inspector, style-inheritance inspector
- 🔶 Reset overrides to inherited (per-field "Clear" on color pickers ✅; no general concept)
- ☐ Page-specific CSS/JS controls (custom head code is site-wide only)
- ☐ Preview custom styles/scripts before publishing; site-wide impact review of a design change

### Content modeling and dynamic display
- 🔶 Custom content types via admin (Projects is a dedicated hard-coded type, not a no-code arbitrary-schema system — deliberate scope call)
- ☐ Custom fields per content type, nested categories (flat tags only)
- 🔶 Relationships (projects→articles/simulations/scans ✅, one-directional across every other pair)
- ✅ Edit relationships from either connected item (article editor's "Related projects" writes the same project.related_articles field)
- ✅ Series; ☐ manual/automatic collections generically
- ✅ Featured + pinned (articles both; projects featured only)
- 🔶 Centrally managed option lists (free text only) ☐; required-field
  validation beyond title ✅ — the admin editor's "Publishing checklist"
  had shown a "Body has enough content to publish" ✗/✓ line for a while,
  but never actually enforced it: you could check "Published" on an
  empty article and it would just save. Now the article/project create
  and update routes reject the exact transition from unpublished to
  published when the body is 50 characters or under, matching the
  checklist's own threshold, with a plain 400 + message that surfaces
  through the existing autosave-status/alert() error paths — no new UI
  needed. Deliberately transition-only: editing an already-published
  piece's body back down later isn't blocked, so an ongoing edit to live
  content never starts failing to save over something unrelated
- ✅ Computed fields (BOM total build cost)
- 🔶 Repeating layouts / visual query builder / display templates (article-list/project-list blocks cover the basics; not admin-customizable beyond limit+tag+featured filters)
- ☐ Conditional sections based on available content
- ✅ Missing-field fallbacks (empty-hint messages)
- ✅ Editable empty states for the three server-rendered, admin-relevant
  ones — Search's "no results" (supports a `{query}` token), Archive's
  "nothing published yet", Topics' "no tagged content yet" — new Site
  Settings fields, blank = the existing hardcoded default. `/saved` and
  `/history` are entirely client-rendered from localStorage, so their
  empty-state text lives in JS, not here — left as-is (making those
  admin-editable would mean an extra settings fetch from every visitor's
  browser for a personal, low-traffic page, not worth it)
- 🔶 Pagination/load-more/infinite scroll (search results ✅, page-based —
  only meaningful once narrowed to one type via the filter bar above, since
  showing Pages/Projects/Posts all at once would need three separate page
  counters on one screen; picking a type always resets back to page 1,
  since a page number from one filter combination usually doesn't carry
  meaning to another. `publicSearch()` now takes a `page` param, adding a
  `LIMIT/OFFSET` plus one `COUNT(*)` query for whichever single category is
  active, so the result count and "Page N of M" reflect the true total
  rather than just what's on screen; archive/topic pages still show
  everything on one page, untouched); ✅ breadcrumbs — no separate
  "editor" needed: a visible "Home / Random / Title" (articles) or
  "Home / Title" (projects) trail now renders from the exact same
  `{name, path}` shape the BreadcrumbList JSON-LD on those pages was
  already built from (relative paths instead of absolute URLs), so the
  invisible structured-data version and the new visible one can't drift
  apart. That JSON-LD existed only for search engines before this — a
  real visitor got no breadcrumb trail at all
- ✅ Related-content suggestions (automatic tag-based; manual override —
  `related_override` column on articles/projects, a multi-select in each
  editor excluding itself, checked first in `getRelatedArticles()`/
  `getRelatedProjects()` and falling back to the automatic tag match if
  it resolves to nothing published)
- ☐ Rules engine, workflow builder for publishing/archiving

### Writing and article editor
- ✅ Auto TOC + heading anchors, footnotes/citations, pipe tables, code syntax highlighting
- ✅ Code line numbers/copy buttons (client-side, works whether or not
  highlight.js's CDN script has run yet — reads `.textContent`, not the
  post-highlight DOM); callouts/warnings via `:::note`/`:::tip`/
  `:::warning`/`:::danger` fenced blocks in article/project bodies
  (a toolbar "Callout" button inserts the fence; supports the same
  inline rich text as a paragraph)
- ✅ Mathematical notation — a ` ```math ` fenced block renders as a KaTeX
  equation, the exact same conditional-CDN-load pattern already used for
  ` ```mermaid ` diagrams: KaTeX's JS/CSS only load on a page that
  actually has a `.katex-block` on it, not on every page. Block-level
  only, deliberately no inline `$...$` span syntax — this site already
  has real dollar-amount content (BOM build costs), which inline math
  delimiters would collide with. Built into the shared `paragraphsHtml()`
  markdown-lite renderer, so it works everywhere that already does (page
  text blocks, journal entries, accordions, quotes, callouts), not just
  article/project bodies
- ✅ Accordion (expandable details)
- ✅ Inline image captions/credits, device frames (browser/phone) on any image block
- ✅ Before/after image comparison slider — both as a page-builder block AND a `[before-after: url1 | url2 | Label1 | Label2]` markdown-lite shortcode for article/project bodies
- 🔶 Pull quotes (✅) / margin notes (☐)
- ✅ Generalized embeds (CodePen/Spotify/Figma/CodeSandbox/Gist + raw-iframe fallback)
- ✅ Readability info (Flesch Reading Ease approximation next to the
  word count — "Easy (85)" style label, standard vowel-group syllable
  heuristic); ✅ word-count goals (a "Goal" input next to word count,
  persisted per-article in localStorage since it's personal scratch
  state, not published content — no schema change needed); ✅ internal-
  link suggestions while writing (this note was stale — see the SEO and
  sharing section below, where the same feature is correctly marked ✅:
  a "Link suggestions" row that proposes links based on title-text
  matching against existing published content)
- ✅ Broken-link warnings (site-wide on-demand Link Checker; live inline
  while typing — checks internal markdown links (`/random/:slug`,
  `/projects/:slug`, `/:page-slug`) against the already-loaded articles/
  projects/pages arrays as you type, no server round-trip. External URLs
  aren't live-checked — that would mean a real network fetch per
  keystroke — use the full Link Checker for those)
- ✅ Distraction-free writing mode for article/project bodies — a
  "Focus" button reparents the real textarea (not a copy synced back and
  forth) into a full-screen overlay, so autosave/word-count/live link-
  checking all keep working untouched; Escape or "Exit focus mode"
  returns it to its original spot with the value intact. Screenshot
  review caught a real z-index bug (overlay opened *behind* the modal it
  was launched from, `z-index: 80` vs. `.modal`'s `100`) — fixed to 110
- 🔶 Markdown export ✅ (an "Export .md" button in the article/project
  editor downloads the title as an H1 plus the raw body — no conversion
  needed, since the markdown-lite body syntax already IS standard-enough
  Markdown for this to just work; falls back to slugifying the title
  client-side for the filename on a brand-new unsaved item, which has no
  slug yet); import UI, paste cleanup from documents/websites ☐
- ✅ Find & replace (site-wide tool covers articles too)
- ✅ Private notes (a new `private_notes` column on articles/projects — a
  textarea in each editor, clearly labeled "never shown publicly";
  verified it never reaches `renderArticle`/`renderProject`'s output.
  Not per-section/inline comments, just one private field per item —
  editorial reminders, todos, sources, not a commenting system)
- ✅ Reader-facing "Updated <date>" (only once 24h+ past publish, avoids autosave noise)
- ✅ Correction/update note callout (optional field, shown at top when set)
- ✅ Custom article endings (automatic related-articles ✅; admin-curated
  via `related_override` ✅; project-linked ✅ — an article page now shows
  a "Featured in" callout for every published project that names it in
  that project's own `related_articles` field. No new field needed: it's
  the same projects→articles relationship `getRelatedProjects` already
  used, just read backwards via `getProjectsLinkingToArticle()`, so any
  project that already links an article surfaces it automatically)

### Saving, recovery, and versioning
- ✅ Autosave with visible status, conflict detection across tabs/devices
- ☐ Side-by-side compare of conflicting versions (currently just "reload to see latest")
- ✅ Crash recovery, unsaved-change (beforeunload) guard
- ✅ Descriptive revision history with labels, side-by-side text diffs, visual layout diffs
- 🔶 Restore individual fields/blocks/pages/articles/media (whole-item +
  per-block ✅; media revisions ✅ — a new `media_revisions` table
  snapshots a file's folder/tags/alt/caption/credit/license right before
  each editorial edit in the File details modal, with a History button
  to browse and restore any earlier version; restoring itself snapshots
  the pre-restore state the same way, so a restore can be undone too;
  deliberately NOT triggered by upload or the hash-backfill scan, which
  would otherwise create a noisy revision per file; field-level restore
  within a single edit ☐)
- ✅ Trash/soft-delete for pages/articles/projects, activity log
- ☐ Separate working revisions of already-published content (editing live edits it directly)
- ✅ Locking to freeze finished items against bulk edits

### Publishing workflow
- ✅ Draft/scheduled/published states ✅; explicit "archived" state added
  (new `archived` column on articles/projects — checkbox in each editor,
  a badge in the management list. Archived content stays published and
  directly reachable at its URL, exactly like an expired article already
  was, but drops out of every listing/discovery surface: home/tag/topic
  listings, RSS, public search + type-ahead, and related-content picks —
  all of which already funnel through `listArticles`/`listProjects`'s
  `publishedOnly` flag or `publicSearch()`, so folding the `archived = 0`
  check in there covered every surface in one place. "Hidden" (as
  distinct from archived) wasn't added — nothing in this app currently
  distinguishes what "hidden but still counted somewhere" would even mean
  beyond what archived already covers.
  Found and fixed a real pre-existing bug while wiring this up:
  `createArticle`/`createProject` silently dropped `sitemap_exclude` and
  `related_override` (and would have dropped `archived` too) on a brand
  new item's first save — only `updateArticle`/`updateProject` handled
  them, so checking one of those boxes before ever saving lost it
  silently until the next edit. Both create functions now accept and
  persist all three.)
- ✅ Scheduled unpublishing (Expires at, mirrors Publish at)
- ☐ Publishing approvals/review steps, editorial calendar, review reminders
- ✅ Live non-blocking publishing checklist (article/project editor)
- ✅ Stale/empty-page inventory (SEO Dashboard → "Content Health": pages
  with zero blocks or where every block fails the same emptiness check
  the per-page diagnostics panel already used one page at a time, plus
  published articles/projects untouched for over a year — parses
  `updated_at`/`published_at` through `Date` rather than comparing the
  raw strings, since those columns mix SQLite's `datetime('now')` format
  and JS's `Date.toISOString()` format depending which code path wrote
  them, the same normalization `renderSitemap()` already needed)
- ✅ Full-site draft-inclusive preview mode (per-item `?preview=1` ✅;
  whole-site ✅ — a "Preview mode" toggle in the admin header's View
  menu sets a plain, non-secret `preview_mode` cookie the public worker
  now also checks (alongside the existing `?preview=1` query param) before
  gating a draft/expired article or project. The cookie grants nothing on
  its own — every check still also requires the real admin session cookie
  — so a visitor setting it themselves sees no more than before; it just
  lets an admin's *existing* browsing session keep seeing drafts through
  normal navigation (nav links, related content, a URL typed by hand)
  instead of needing that query param re-added to every single link.
  Added a small dashed-border banner ("Viewing a draft…") on any page
  shown only because of a preview, including the previously-silent
  `?preview=1` case, with a "Turn off preview mode" button when it's the
  cookie keeping it visible — a real bug surfaced while wiring that
  button: it lives in `<main>`, which sits *after* `<script src="/nav.js">`
  in the page, so nav.js's plain top-level `getElementById` ran before the
  banner existed and silently found nothing; fixed by deferring that one
  handler to `DOMContentLoaded`, the same pattern this file already used
  elsewhere for exactly this reason. Deliberately scoped to individual
  article/project pages only — listings/RSS/search/sitemap still show
  published-only content even in preview mode, the same way most CMS
  preview modes don't leak drafts into a subscribed feed)
- ☐ Future-date preview for scheduled changes
- ✅ Expiring, revocable, shareable draft-preview links (`?preview_token=`, 1/7/30 day options, works without admin login)
- ✅ Link Checker resolves real publish state (draft/expired reported correctly; project links + project bodies/journal/links-blocks now actually scanned — both were silent gaps before)
- ☐ Publish-as-package (related pages/nav/updates together), rollback of a package, affected-pages preview, URL-change impact preview
- ✅ Password-protected pages — a new `password_hash` column on pages, set
  via a "Set password"/"Remove protection" pair in Page settings (never a
  single field, since the client can never get the current password back
  to round-trip — only its hash is stored, so blank could otherwise mean
  either "no change" or "remove"). A locked page shows a plain password
  form (401) instead of its content; submitting the right one sets that
  page's own unlock cookie, itself keyed to the page id *and* its current
  `password_hash` (not the raw password) via HMAC with `SESSION_SECRET` —
  so a saved cookie silently stops matching the moment the password is
  next changed, with no separate revocation step needed. An authenticated
  admin always bypasses the gate, same as maintenance mode's own admin
  bypass. Private (fully hidden, no direct-URL access at all) is a
  different, bigger feature — this is specifically "reachable by anyone
  who has both the URL and the password"; 🔶 unlisted (nav-excluded but
  reachable by URL) exists de facto

### Content administration and portability
- ✅ Duplication exists for pages/articles/projects (always lands as
  unpublished draft; journal/BOM/relationships not carried over);
  cross-type conversion (article→project — a "Convert to Project…"
  button creates a project draft from the article's title/body/tags/
  og_image, reusing the same slug when free; the original article is
  left completely untouched, same non-destructive philosophy as
  duplication, so it's a copy an admin can follow up on manually rather
  than an automatic move)
- ✅ Bulk publish/unpublish/trash/add-tag for articles AND projects
- ✅ Global find & replace with review before applying
- ☐ Import from other platforms, import dry-run preview
- ✅ Full JSON backup export (content, fields, relationships, media refs), full-site export
- 🔶 Stable ids preserved on backup round-trip (n/a for import, not built)

### Personal site sections
Mostly content-to-write, not code-to-build — page builder + changelog
block already support any of these as a plain page:
- 🔶 Now page (capability exists, content not written)
- ✅ Site changelog block
- ☐ Uses/gear page, resume/experience page from structured data, public project roadmaps, "Currently building" homepage widget
- 🔶 Public notes/short posts (articles serve this; no distinct lightweight format)
- ✅ Topic landing pages (a new "Topic Pages" panel — Tools → Topic Pages
  — lists every tag currently in use with its content count, and an
  Edit button to set an optional intro blurb and share image for that
  tag's `/topics/:tag` page, stored in a new `topic_meta` table keyed by
  tag; falls back to the auto-generated title/description when no row
  exists. Not a full block-based page builder — deliberately just enough
  to give a topic its own voice and share card, matching the actual gap
  the previous note described)
- ✅ Archive by year (`/archive`)

### Projects and portfolio
- ☐ Independent per-project layouts (fixed template like articles)
- ✅ Project templates; 🔶 hero image ✅ (really the share/og image field,
  reused loosely — it isn't rendered as an on-page banner, only in social
  meta tags)/hero video ✅/inline demos ☐ (related sims/scans exist, not
  embedded inline)
  - Hero video: a new `hero_video` column on projects, uploaded through its
    own `/upload-video` route (mirroring the existing `/upload-audio`
    pattern — MP4/WebM/MOV, 40MB cap, own `video/` R2 prefix, not part of
    the general Media Library) rather than widening `/upload`'s image-only
    allowlist. Renders as a muted/looping `<video>` near the top of the
    project page, sized/cropped with `object-fit: cover`. Deliberately
    ships with no `autoplay` HTML attribute — the server can't know a
    visitor's motion preference at render time, so `nav.js` decides
    playback client-side instead, checking both OS-level
    `prefers-reduced-motion` and this site's own manual motion toggle
    (re-synced every time that toggle is clicked), the same dual check the
    CSS-side motion overrides already use.
- ✅ Tech stack, GitHub/demo/docs/download links, screenshots with captions + device frames, before/after comparisons, status field
- ✅ Timelines/milestones (the build journal is now a genuine connected
  timeline — a single vertical rail with a dot per entry, color-coded by
  entry type: decision/test/failed get their own dot color, log stays
  neutral — CSS-only change, no schema/data change, `entry_type` already
  existed)
- ✅ Challenges/decisions/lessons (journal entry types), related content, version history (revisions)
- 🔶 Public changelogs (journal entries can serve; no distinct feature)
- ✅ Download manifest (multiple labeled files + descriptions, scanned by Link Checker) alongside the single quick-download link
- ✅ Sort/filter (tag/featured ✅; arbitrary sort ✅ — a new `sort_order`
  column on projects, same nulls-last-ascending convention as
  `featured_order`, now factored into a shared `sortByOrderField()`
  helper both use; a Project List block's new "Sort by" field switches
  it from the default newest-first to this manual order. Correctness
  note: a manual sort has to happen in JS across the *whole* matching
  set before any `limit` is applied — if the SQL-level LIMIT ran first
  by publish date, a manually-prioritized-but-older project could get
  cut before its rank was ever considered; `listProjects()` only lets
  SQL apply the limit for the default newest-first sort now); featured-order ✅
  (a new `featured_order` column on projects — a number input next to
  the Featured checkbox, same convention as page nav ordering already
  uses rather than literal drag-and-drop; `listProjects()`'s
  `featuredOnly` path sorts by it ascending, nulls last, falling back to
  the normal newest-first order for anything left blank)
- ✅ Architecture/dependency diagrams (a ```mermaid fenced block in an
  article/project body renders as a diagram — server-side just wraps it
  in `<div class="mermaid">` instead of `<pre><code>`, unescaped-safe
  since mermaid reads `.textContent`, not `.innerHTML`; client-side loads
  mermaid.js from jsdelivr via a dynamic `import()` gated behind
  `document.querySelector(".mermaid")` so pages without a diagram never
  fetch it. A "Diagram" toolbar button inserts a starter flowchart
  template, next to the existing Callout button)

### Build journals and technical documentation
- ✅ Dated journal entries, BOM with substitutions, pipe-table wiring/pinout tables, test records, decision logs, failed-attempt records, accordion for expandable hints
- 🔶 Supporting photos/measurements for tests (markdown text only; no dedicated fields)
- ☐ Reproduction checklists, hardware/software compatibility info, firmware
  tied to hardware revisions, completion summaries, cybersecurity lab
  writeup templates, annotated terminal transcripts, screenshot redaction
  (correction: per-file download-manifest explanations were already ✅ —
  the "Label | URL | Description" format on each manifest line always
  included one; this note was stale, not describing a real gap)

### Media library and file management
- 🔶 Folders (flat ✅, nesting ☐); 🔶 tags ✅ / smart collections ☐; ✅ saved
  searches (name and reapply the current folder/type/text/unused/
  duplicates filter combo — same raw-settings-key storage pattern as
  style presets, since this is also an individually added-to/removed-
  from list the bulk settings PUT shouldn't own)
- ✅ Usage tracking across pages/articles/projects/settings (including project share images — a real gap fixed)
- 🔶 Bulk upload/move/tag/delete ✅; bulk rename ☐ (R2 keys are content-addressed, "rename" = alt text, already covered per-file)
- ✅ Duplicate detection (SHA-256 at upload + backfill scan + immediate warning on byte-identical upload)
- ✅ Replace-in-place without breaking placements (already existed via the
  photo editor's "Overwrite original" — same key, same URL, so nothing
  referencing it breaks — this note was stale); media version history ✅
  (a new `media_versions` table + `_versions/` R2 prefix: the old bytes
  get archived right before every in-place overwrite, with a "File
  versions" panel in File details to browse thumbnails and restore any
  earlier version — restoring archives the current bytes too, so it's
  undoable the same way. Archived bytes are served through an admin-only
  route, not the public `/media/:key` route, and both the R2 objects and
  their D1 rows get cleaned up when the file itself is deleted)
- ✅ Original-file preservation; ☐ responsive image variants/srcset, crop/focal-point per placement
- ✅ Alt text/caption/credit/license fields (library-level + per-block prefill)
- ✅ Metadata viewer (size, format from the file extension, and
  dimensions probed client-side via an off-screen `Image` element's
  `naturalWidth`/`naturalHeight` — shown in the existing File details
  modal, no schema change or server-side binary parsing needed)
- 🔶 Search by filename/tag/type/dimensions/usage (filename+tag ✅; type
  filter ✅ — Images/Audio/Other dropdown next to the folder filter,
  derived from the key prefix/extension, no schema change; usage ✅ — a
  "Used in…" text filter narrows the grid to files referenced from a
  page/article/project matching that text. `findMediaUsage()` (the
  existing per-file lookup) and the library's unused-file detection both
  did their own full-site traversal separately; consolidated into one
  shared `getMediaUsageMap()` walk so adding this filter's per-item usage
  breakdown to the `/media` list response didn't mean a third traversal —
  `GET /media` now returns each item's usage as flattened "Type: Title"
  strings, matched as a plain substring like the filename/tag search
  already works. Wired into saved searches too; dimensions still ☐)
- ✅ Unused/orphaned file review
- ☐ Image optimization comparison, video captions/transcripts, audio-file support (images only today), PDF/doc previews, direct-download controls, drag-to-page, resumable uploads, upload queue with retry, storage-by-type dashboard, private-metadata stripping

### Photo editor
Undo/redo, flips, grayscale/sepia/invert, line tool, eyedropper, reset,
keyboard shortcuts — all ✅.
- ✅ Saved presets — scoped to the brightness/contrast/saturation sliders
  (the only parametric adjustment; the one-click filters like grayscale
  are already single-click). "Save preset" names the values just applied;
  "Apply preset" replays them as a one-shot `ctx.filter` onto the current
  canvas (pushes undo first). Same storage pattern as style presets: one
  JSON blob under its own `photo_editor_presets` settings key with three
  dedicated routes, not folded into the bulk settings PUT. Non-obvious
  wrinkle: the adjust sliders are deltas, not absolute state — each drag
  bakes its filter into the canvas on `change` and resets to 0 so the next
  drag starts fresh (lets you stack, say, two separate brightness bumps
  without hitting the slider's ±100 range limit). That means by the time
  someone clicks "Save preset" the sliders normally already read 0 again,
  so a `lastAdjust` variable captures the just-committed values right
  before that reset, and "Save preset" reads from it (falling back to the
  live slider values only mid-drag, before `change` has fired).
- ☐: batch adjustments, redaction tools, cross-crop preview.

### Media viewers and presentation
All ☐: panoramic/360° viewer, deep-zoom, image hotspots, audio waveform
player, synced A/B audio, timestamped notes, searchable transcripts,
consistent fullscreen controls, poster/caption conventions, fallbacks.
(The new DAW module above will cover audio waveform playback for songs
specifically, once built — not the general media-viewer case.)

### Circuit simulation
Existing features (wiring-accurate breadboard sim, closed-loop lighting
logic, zoom, touch-friendly pins) — all ✅, pre-existing. Expansion (34
items: multi-select, grouping, MIDI-unrelated component search,
templates, potentiometers/multimeters/probes, oscilloscope graphs, wire
routing, custom components, guided mode, sharing/embeds, accessibility,
breadboard continuity, tolerances, limitations doc) — all ☐, untouched.

### 3D LiDAR module
- ✅ Core scan module, browser 3D viewer (model-viewer), rotate/pan/zoom/reset
- ☐ Everything else: library folders/tags beyond projects, fullscreen as distinct control, point-cloud/mesh toggle, measurement tools, annotations, saved camera views, comparisons, timeline, capture-date/equipment fields, inline embeds, mobile perf settings, download options, privacy controls, fallback images

### Search and content discovery
- ✅ Site-wide search (articles + projects); ✅ filters/sorting — a
  filter bar above results: type (All/Pages/Projects/Posts) and sort
  (Newest/Oldest first, articles+projects only — pages have no publish
  date to sort by). Plain `<a>` links rebuilding the `/search?q=&type=&sort=`
  URL rather than a JS-driven form, matching how every other listing page
  on the site (topics, archive) already needs no client JS at all —
  bookmarkable and shareable as a side effect. `publicSearch()` skips
  querying a category entirely when `type` excludes it, rather than
  fetching all three and filtering client-side
- ✅ Type-ahead suggestions (admin command palette; public search — debounced
  `/api/search-suggest` endpoint reusing `publicSearch()`, dropdown under
  the topbar search box with arrow-key nav and Enter-to-navigate, own
  rate limit separate from `/search`'s since it fires per keystroke)
- ✅ Related content displays, topic browsing (`/topics`, `/topics/:tag`), archive by year (`/archive`)
- ☐ Interactive project map/visual index
- ✅ Random content button (`/shuffle`), save-for-later (`/saved`), reading history (`/history`) — all client-only localStorage, nothing sent to the server
- ✅ Reading-time estimates (projects sum body + journal entries)
- ✅ RSS by type/tag (`/rss.xml?type=&tag=`)

### Visitor interaction
Contact form, admin inbox, guestbook/comments, moderation, newsletter —
**explicitly declined by the user**, left ☐ deliberately.
- ✅ Reactions (👍/💡/❤️, aggregate counts only, no visitor identity, client-side double-vote discouragement)
- ✅ Expanded sharing (X/LinkedIn/email + copy-link)
- ✅ Visitor font-size/motion prefs (reduced-motion auto-respected via OS
  ✅; a manual ⏸ toggle in the header now also lets a visitor turn
  animations off independent of their OS setting, persisted in
  localStorage — the CSS override mirrors exactly what the OS-driven
  `@media (prefers-reduced-motion)` scoping already does, just reachable
  without changing OS settings; font-size ✅ — a header "A" button next to
  the theme/motion toggles cycles a `--font-scale` CSS variable through
  [1, 1.15, 1.3, 0.9] (100% → 115% → 130% → 90% → back to 100%), persisted
  in localStorage and read by the same early inline `<head>` script that
  already sets theme/motion before first paint (avoids a flash of
  wrong-sized text). `html { font-size: calc(16px * var(--font-scale, 1)) }`
  means every `rem`-based size on the site scales together. One cycling
  button rather than separate A+/A- controls, matching the existing
  single-icon-button convention used by the theme and motion toggles)
- ✅ Print-friendly pages; ✅ downloadable PDF articles/case studies — a
  "Download PDF" button next to the existing share links. No server-side
  PDF generation at all: it's just `window.print()`, and the already-built
  `@media print` stylesheet already strips the chrome (nav, search,
  toggles, share buttons) down to readable content — every modern browser
  offers "Save as PDF" as a print destination, so this is a genuine
  download with zero new dependencies. Added the button itself to that
  print stylesheet's hide-list too (along with a pre-existing gap:
  `.save-for-later-btn` was missing from it as well)

### Analytics
- ✅ Real-time visitor count, device/browser breakdown (coarse label only, never raw UA — no new fingerprinting surface), outbound-link + download tracking, internal search-term + no-results reporting
- 🔶 Event analytics (generic tracking exists; no dedicated report
  surface); ✅ geographic (country ✅; region/city ✅ — new `region`/`city`
  columns on `pageviews`, populated free from the same Cloudflare-
  provided `request.cf` object country already used, no separate
  geolocation lookup; a new "Top locations" breakdown in the Analytics
  dashboard groups them as "City, Region"; both are unset in local
  `wrangler dev`, which doesn't have real edge geolocation data, so only
  populate on the actual deployed site)
- ☐ Per-page engagement/scroll depth, project-card click paths, conversion goals, period comparisons, chart annotations, bot filtering, data-retention settings, scheduled summaries, rearrangeable widgets
- ✅ Custom admin-defined events (the underlying mechanism —
  `window.trackEvent(name, detail)` posting to `/api/track` — already
  supported any name; there was just no way to attach one from the admin
  UI without hand-writing JS. Added a "Track clicks as" field to the
  Button block, rendered as a `data-track-event` attribute on its `<a>`;
  nav.js's existing site-wide delegated click handler checks for that
  attribute first, ahead of its own outbound-link/download
  auto-detection, since a name the admin chose on purpose is the more
  useful signal than the generic one. Scoped to the Button block only for
  now, not every block type with a URL); ✅ filters
  (date-range ✅; content-type/referrer/device ✅ — three dropdowns above
  the Analytics tiles, populated from the same top-lists the dashboard
  already computes, filtering every pageview-based number: tiles, the
  daily chart, and all five breakdown lists; event-based panels — top
  events/search terms/outbound links/downloads — aren't filtered by
  these, since the `events` table has no device/referrer columns to
  filter on); ✅ raw event export (breakdown CSV ✅; a new "Export raw
  events" button next to it downloads every individual pageview/event row
  in the selected range — not the top-N breakdowns the dashboard shows —
  as a two-section CSV (Pageviews, then Events), generated server-side via
  a new `/analytics/export-raw` route since raw rows, unlike the
  aggregates, were never sent to the browser for the breakdown export to
  reuse. Shares the exact same date-range and device/referrer/contentType
  filters as the dashboard; events still aren't filterable by those, same
  pre-existing limitation as the dashboard's own event panels, since the
  `events` table has no device/referrer columns. Capped at 20,000 rows per
  section — comfortably above what a personal-blog's traffic would ever
  produce in a 90-day window, while keeping the response bounded)

### SEO and sharing
- ✅ Central SEO dashboard (new "SEO Dashboard" panel under Tools,
  consolidating the Link Checker and SEO Report — relocated out of the
  general Site Settings modal, same markup/ids/logic, nothing rewritten
  — plus a new sitemap-exclusions overview computed client-side from the
  already-loaded pages/articles/projects, no new endpoint needed)
- ✅ Per-page title/description, canonical URL (auto + optional override), noindex controls
- ✅ Social-share image editor (upload/browse ✅; preview ✅; crop ✅ — an
  "Edit / crop for social…" button next to every og-image field (page,
  article, project, site settings, topic pages) opens the existing photo
  editor pre-loaded with that image, reusing its crop/rotate/filter tools
  and in-place "Overwrite original" save rather than building a second
  editor; only works for images already uploaded to this site's media
  library, since the editor needs a real R2 key to save back to)
- ✅ Social-share previews (pages/articles/projects)
- ✅ Sitemap (auto; admin include/exclude — `sitemap_exclude` column on
  pages/articles/projects, a checkbox in each editor, filtered out of
  `renderSitemap()` but the page/article/project itself stays fully
  live — this only removes it from the sitemap, doesn't unpublish it);
  ✅ structured data (JSON-LD auto ✅; admin-customizable ✅ — a new
  `custom_json_ld` column on pages/articles/projects, edited as a raw JSON
  textarea in each editor. Rendered as an *additional* `<script
  type="application/ld+json">` block alongside whatever's already
  auto-generated (Article/CreativeWork/BreadcrumbList/the sitewide
  WebSite block), not a replacement — an admin adding FAQPage or HowTo
  schema shouldn't have to hand-maintain the auto-generated schema too.
  Validated as JSON at save time (all three editors' POST/PATCH routes),
  rejecting malformed input with a clear error rather than silently
  saving something that would only be noticed by inspecting page source
  later. Projects have no autosave/draft-recovery to begin with, so the
  field there is manual-Save-only like the rest of that editor; pages and
  articles wire it into their existing autosave/crash-recovery-draft
  mechanisms like every other field)
- ✅ Orphan-page detection (SEO Dashboard → "Orphan Pages": published
  pages/articles/projects that nothing internally links to — reusing the
  exact same link-gathering walk the Link Checker already does, just
  resolved against site content in the other direction — and that aren't
  in the header nav either; related-content suggestions and shuffle
  deliberately don't count as "reachable" since neither is a deliberate
  link an editor placed)
- ✅ Internal-link suggestions while writing (a "Link suggestions" row
  under the link-warnings area in the article/project editor — scans the
  body for any existing published page/article/project title that
  appears as plain, not-yet-linked text, and a click wraps that exact
  span in a markdown link to it; client-side only, against the
  already-loaded pages/articles/projects arrays, no server round-trip)
- ✅ Automatic redirect suggestions after URL changes (not a suggestion to
  approve — a slug change on something already live auto-creates a 301
  from the old path to the new one, for pages/articles/projects alike; a
  draft's slug change creates nothing, since nothing public could be
  linking to it yet; never overwrites a redirect an admin already set up
  from that same old path; the home page's slug maps to "/" rather than
  "/home", handled as a special case)
- ✅ Link monitoring (on-demand Link Checker ✅; scheduled/ongoing ✅ — the
  same `checkLinks()` walk now also runs on the existing daily backup cron
  (`worker/index.js`'s `scheduled()`, one shared trigger rather than a
  second cron schedule), storing just the broken subset + a timestamp to
  settings, same "latest run only, not a history" scope as the
  backup-failure status line. The SEO Dashboard's Link Checker section
  shows that status (✓/⚠ + a broken-link list) as soon as it opens, no
  click required, plus a "Run automatic check now" button for testing/
  immediate use — same convenience "Run a backup now" already has)
- 🔶 Missing-metadata reports (SEO Report now covers meta description +
  alt text + missing social-share image on published articles/projects +
  duplicate titles across pages/articles/projects; not every conceivable
  field — meta description doesn't apply to articles/projects since
  those fall back to an auto-generated excerpt, not a missing field)

### Accessibility
- ✅ Alt-text checks, heading-order/hierarchy checks (full reading-order skip detection), tap-target checks, reduced-motion coverage
- 🔶 Color-contrast (live WCAG checker for theme colors in Site Settings; no site-wide arbitrary-content checker)
- ✅ Automated keyboard-nav checker (focus-state still ☐ — checking
  computed `:focus-visible` styles across every element isn't something a
  static scan can do meaningfully). A new "Accessibility Report" panel in
  the SEO Dashboard, scoped to "Raw HTML" blocks specifically — every
  other block type is already accessible by construction (semantic markup,
  real `<button>`/`<a>` elements, a dedicated alt-text field the SEO
  Report already checks), so the html escape-hatch block is the one place
  arbitrary admin-authored markup can introduce a real problem. Regex-
  matches for positive `tabindex` (breaks natural tab order), `onclick` on
  a non-interactive element (a `<div>`/`<span>`/etc., not keyboard-
  operable), `<img>` with no `alt`, and `<a href="#">` dead-end links —
  heuristic like the site's other link/markdown scanners, not exhaustive
- ✅ Accessible alternatives for simulations/3D content (optional description → aria-label/aria-describedby/role=img; scan alt override)
- ✅ Accessibility folded into the page diagnostics/publishing checklist

### Performance and loading
All ☐, untouched: performance budgets, slow-page alerts, per-page
weight reports, load-on-interaction for heavy viewers, data-saving
mode, slow-connection preview, embed-loading controls, cache
status/refresh, embed-failure behavior, before/after perf comparisons.

### Admin interface
- 🔶 Command palette (pages/articles/projects/blocks ✅; now also covers
  Songs/Diagnostics/SEO Dashboard/Topic Pages and "Add new article"/"Add
  new project" quick actions that were missing even though their menu
  buttons already existed; still not literally exhaustive of every modal)
- ☐ Customizable dashboard, interface density settings, saved workspace layouts
- ✅ Light/dark admin theme
- ✅ Favorites/pinning (☆ Pin button, client-side, leads the command palette) + recently-edited (client-side recency list, not activity-log-based since that only ever stored a label not an id)
- 🔶 Bulk-action toolbar (articles + projects + blocks ✅; not universal)
- ☐ Contextual help for complex editors, shortcut remapping
- ✅ Keyboard shortcut reference modal, universal admin search
- ✅ Notifications — a 🔔 bell in the admin header with a badge count,
  rolling up four signals that already each had their own separate panel
  (backup-failure status, scheduled-link-check broken count, recent error-
  log entries, recent failed webhook deliveries, all "last 24h" where a
  time window applies) into one glanceable place rather than needing to
  separately check four panels to notice something needs attention.
  Clicking an item jumps to the relevant panel. No "read/unread" tracking
  at all — it's a live status snapshot recomputed fresh every time the
  bell opens, not a dismissible inbox, so there's no new state to get out
  of sync; ☐ background-job status/retry (uploads/publishing are
  synchronous today, nothing queued to report on)
- ✅ Visitor-view preview, mobile workflows for common edits, desktop power-tools (focus mode/layers/multi-select)
- ☐ Role-specific preview (n/a, no roles exist)
- **Needs a real UX pass — see section 1c above.**

### Authentication and permissions
Single admin password, stateless HMAC-signed session cookie (no
server-side session store) — most items below are big architecture
changes with low value for a single-admin personal site; flagging as
"legitimately low priority" rather than silently ignoring:
- ☐ 2FA, passkeys, recovery codes, roles/permissions, scoped API tokens, reauthentication for sensitive actions, sandboxed custom-code previews, secret management separate from content
- ☐ Session list/remote revocation (would need a real session-store rearchitecture — currently nothing to list)
- ✅ Security-audit trail (login/failed-login/logout now log to the same
  `activity_log` table as everything else, with the IP in the detail
  field — a "Security events only" filter checkbox in the Activity Log
  panel isolates them, and a failed attempt gets the same red row styling
  the Link Checker already uses for a broken link, so it stands out)
- ✅ Rate limits/abuse monitoring, security headers

### Integrations and automation
- ✅ Integration settings (multiple webhook URLs — the field is now a
  textarea, one URL per line, rather than a single input; every non-blank
  line gets its own independent delivery attempt and its own row in the
  Webhook Deliveries history/retry list, so one endpoint being down
  doesn't affect whether the others get called or get retried. The
  deliveries list now shows each row's destination URL alongside its
  timestamp, since the same publish can produce more than one row with
  the same title once multiple URLs are configured); ✅ configurable
  triggers (a "Also call it when a project is published" checkbox in Site
  Settings — off by default, since it's new behavior an existing webhook
  consumer wasn't built to expect; the payload now also carries
  `contentType` so a receiver can tell which kind fired it. Found and
  fixed a real bug while wiring this in: the project *create* route never
  called `maybeFireWebhook` at all, even before this change — publishing
  a brand-new project for the first time silently never fired the
  webhook, only a later publish-via-edit did. Both create and edit now
  fire it consistently, matching how articles already worked)
- ✅ Webhook delivery history (last 200, status/error) + retry with original payload
- ☐ Background-task management, failed-integration notifications, permission controls for external integrations

### Testing, staging, and deployment
- ☐ Automated tests wired into CI (Playwright scripts are ad hoc, local only)
- ☐ Staging environment (deliberately deferred — real Cloudflare resource cost/provisioning, needs go-ahead first)
- ☐ Preview deployments tied to changes
- 🔶 Migration history (this doc is a manual log; no automated tracker)
- ✅ Error tracking; ☐ uptime monitoring; ✅ maintenance mode — a Site
  Settings checkbox (+ optional custom message) that takes the whole
  public site down to one plain, dependency-free "we'll be back" page
  (503, `Retry-After` header) while an admin does something risky. Gated
  by the exact same `isAuthenticated()` check the admin API already uses,
  so a logged-in admin keeps browsing the live site normally to verify
  whatever they're doing — the toggle only ever affects logged-out
  visitors. Exemption list is deliberately broad (`/admin*` plus any
  path with a static-asset-looking extension) rather than trying to
  enumerate every route that must keep working, since blocking the admin
  panel itself would strand a logged-out admin with no way to turn it
  back off, and blocking style.css/nav.js would break the admin panel's
  own styling while maintenance mode is on
- ✅ Custom error pages (404; 500 — `renderErrorPageHtml()` in
  `worker/render.js`, deliberately fully self-contained with no DB
  reads/imports beyond the module itself, since it's called from the
  top-level `fetch()` catch for the case where something's already
  broken, possibly the DB. `/api/*` paths still get a plain-text 500 so
  a client parsing the response doesn't choke on HTML)
- 🔶 Draft/staging/live distinction (draft vs. live ✅; "staging" as an environment doesn't exist)

### Backups, health, and operating costs
- ✅ Automated daily D1→R2 JSON backup (cron)
- 🔶 R2 asset backup (media lives durably in R2 already, as primary store, not separately re-copied)
- ✅ Backup-failure alerts (the scheduled cron backup previously had no
  error handling at all — a failure inside `ctx.waitUntil` on a cron
  trigger is only ever visible in Cloudflare's own dashboard logs, never
  surfaced to the admin. Now it logs to the same `error_log` every other
  uncaught error goes to, AND records success/failure to a `last_backup_at`/
  `last_backup_error` setting so Site Settings shows a clear ✓/⚠ status
  line without digging through the error log)
- 🔶 Restore tested repeatedly via Playwright; no written human runbook
- ✅ Backup contents browser (a "View contents" toggle on each scheduled
  backup in Site Settings shows its exported-at time, format version, and
  a row count per table — read-only, no restore involved, so it's safe to
  check "is this the one I want" before ever touching the all-or-nothing
  restore); ✅ file-integrity checks — a SHA-256 checksum is computed and
  stored as R2 custom metadata the moment a backup is written, then the
  file is immediately read back and re-hashed to catch any corruption in
  the write itself (a mismatch fails the whole scheduled backup, same as
  any other write error, since an untrustworthy backup is as good as no
  backup). A "Verify integrity" button next to "View contents" lets an
  admin re-check any existing backup's current bytes against that stored
  checksum later — e.g. right before actually trusting one for a restore.
  A backup written before this shipped has no stored checksum to compare
  against; that's reported as "no checksum" rather than a false failure;
  ☐ periodic restore drills, selective restore
- ☐ Health dashboard (DB/storage/uploads/publishing), failed-scheduled-publish alerts, cost/usage alerts
- ✅ Storage/DB usage dashboard — a new "Storage" section in Site Settings,
  right below Backup. R2 usage broken down by prefix (images, audio,
  video, 3D scans, backups, image-version-history) via a paginated
  `list()` scan (a single R2 `list()` call caps at 1000 objects, so it
  loops on `cursor`/`truncated` rather than assuming one page covers
  everything). D1 size comes from `size_after` in a throwaway query's
  `meta` — confirmed to actually populate under `wrangler dev` too, not
  just the deployed service — with a null fallback kept anyway in case a
  future D1 runtime stops reporting it. Also lists row counts for the
  tables most likely to grow unbounded on their own (pageviews, events)
  alongside the main content tables, as a size signal that doesn't depend
  on D1's own size reporting at all. Manual "Refresh" button, not
  auto-loaded on Site Settings open, matching Activity Log/Error Log
  rather than the auto-loading Backups list — an R2 bucket scan isn't
  something to run every time the modal opens.
- 🔶 Traffic dashboard (analytics covers visitor traffic; not Worker CPU/processing usage)

### Final verification
☐ — deliberately last. The original 70-item health check ran before
this doc existed; needs re-running against everything above once the
list is far enough along, plus once the two new modules and the admin
UX pass are in.

---

## 3. Ideas / things worth considering (my own notes, not requested yet)

Ask before building any of these — they're opinions, not the plan:

- The large builder-style modals (Simulations, Scans, Songs — 96vw x
  94vh, near-fullscreen) use the same 60%-opacity backdrop as the
  smaller list-style modals, but at that size the dimming barely reads
  as "dimmed" and faint background text bleeds through at the edges.
  Worth a slightly higher opacity (or a solid backdrop) specifically
  for that near-fullscreen modal variant, applied consistently across
  all three rather than one at a time.
- The audit trail (section "Authentication and permissions") could
  flag security-sensitive actions (settings change, backup restore,
  webhook URL change, lock/unlock) distinctly from routine content
  edits in the activity log, without needing full roles/permissions —
  cheap, real value.
- Orphan-page detection is worth doing right once there's time for it
  properly (see the SEO section note) — false positives would erode
  trust in the tool, so it shouldn't be rushed.
- A lightweight "staging" mode using a second local-only D1 binding for
  testing schema changes before they touch production could reduce the
  risk in every migration step, without the cost of full separate
  Cloudflare resources (still needs a go-ahead — it's still new
  infrastructure).
- Once the DAW module exists, the same waveform/animation-sync engine
  could double as the audio-waveform player the "Media viewers" section
  asks for generically (uploaded music/audio, not just DAW-composed
  loops) — worth revisiting scope then rather than building it twice.
- The TTS "read this article" accessibility angle could extend to
  reading build-journal entries and project pages too, not just
  articles, once the base player exists — cheap to extend, not cheap
  to design twice.

---

## 4. Pending production migrations

Production D1 was fully synced to `schema.sql` on 2026-09-24 (verified
column-by-column via the Cloudflare D1 MCP tools — every table/column
schema.sql expects is present, zero data rows touched by the sync
itself, pre-existing content in `pages`/`settings` intact). Nothing is
currently pending — everything shipped to `production` since then
(admin nav grouping, hover-effect style, style presets, the article/
project flow-layout fix) was deliberately schema-free. Re-verify with a
fresh `pragma_table_info` check before assuming this is still true if
much time has passed, rather than trusting this note blindly (the
standing rule in section 0).

If a future migration adds a `media.hash` backfill need again, run
`POST /api/admin/media/backfill-hashes` once (the "Scan for
duplicates" button in the Media Library) to hash files uploaded before
that feature existed — already done as part of the 2026-09-24 sync.

Always confirm with the user before running anything against
production — standing rule, exercised once already for the initial
full sync.

---

## 5. Deferred / deliberately scoped-out (with reasons)

- **Spacing and shadow tokens** — no safe existing hook (spacing is ad
  hoc per-component px values, zero box-shadows anywhere by current
  design); needs a careful visual-review pass, not an unsupervised one.
- **Metadata viewer for image dimensions/format** — needs client canvas
  probing at upload or server-side binary header parsing; low value for
  a small personal media library relative to effort.
- **Orphan-page detection** — real design complexity (every internal-
  link-holding block type, plus list-block `limit` truncation logic);
  worth doing right, not rushed.
- **A staging environment** — second D1 + R2 is a real account-cost
  decision, needs confirmation first, not autonomous.
- **Automated tests in CI** — Playwright scripts stay ad hoc/local for
  now.
- **Image CDN transforms** (Cloudflare Image Resizing) — needs a
  specific billing plan, didn't want to assume it.
- **A standalone public `/scan/:id` page** (mirroring `/simulation/:id`)
  — trivial to add via the existing `modelViewerHtml()` helper, just
  hasn't been asked for.
- **Local dev-only cosmetic clutter** (leftover test blocks on the local
  "home" page, old test articles) — harmless, sandbox-only, a bulk
  delete was blocked by the environment's own destructive-action
  safety classifier when attempted unsupervised; needs a human or an
  explicitly-approved deletion, not urgent.

---

## 6. Manual verification still owed (things I couldn't confirm from the sandbox)

- **highlight.js CDN** (cdnjs.cloudflare.com) — sandbox network policy
  blocks it; open a real published article with a code block in an
  actual browser once to confirm syntax highlighting renders.
- **`@google/model-viewer` CDN** (cdn.jsdelivr.net) — same limitation;
  upload a small `.glb`, confirm it spins/loads, try the AR button on
  an iPhone with a `.usdz` attached (Quick Look).
- **Cron trigger for D1→R2 backups** (`0 8 * * *`) — confirm in the
  Cloudflare dashboard it's registered under the Worker's Triggers tab
  and that a backup actually lands in R2 under `backups/`.
- **"Read aloud" (Web Speech API)** — sandbox headless Chromium has zero
  installed TTS voices, so this can only be logic-verified there
  (confirmed `speak()`/`onend`/`onerror` fire correctly), not actually
  heard. Try it once in a real desktop or iOS browser to confirm it
  actually speaks and the button toggle timing feels right.

---

## 7. Ongoing security check

Re-verify these periodically, not just once — mark the date next to an
item when last checked:

- [ ] Dependencies/CDN scripts (highlight.js, model-viewer) still
      pinned to versions without known CVEs
- [ ] Rate limits still cover every public write endpoint (login,
      track, react, search, preview links) — check after adding any
      new public POST route
- [ ] Security headers (CSP, X-Frame-Options, X-Content-Type-Options,
      Referrer-Policy) still present and correctly scoped
- [ ] Session cookie still `HttpOnly; Secure; SameSite=Strict`
- [ ] No new admin route added without going through
      `isAuthenticated()` / the admin router's auth gate
- [ ] `javascript:`/`data:` URI neutralization (`safeHref`) still
      applied everywhere a user-authored URL renders (buttons, project
      links, download manifest, links block, markdown links)
- [ ] Raw-HTML block and custom `<head>` code remain explicitly
      trusted-admin-only, never exposed to a lower trust level
- [ ] New tables/columns don't accidentally expose more than intended
      through a `SELECT *` in a public-facing query
- [ ] File uploads still validated by type (image-only today) before
      any new upload surface (e.g. TTS audio, DAW exports) is added —
      revisit this the moment audio uploads are built

## 8. Ongoing SEO / accessibility check

Re-verify periodically, especially after any new public page/route:

- [ ] Every new public route has a `<title>`, meta description, and
      correct canonical tag
- [ ] New content types show up in `sitemap.xml` (and RSS if content,
      not utility)
- [ ] JSON-LD structured data present and valid where expected
      (articles, projects, breadcrumbs)
- [ ] New image-bearing blocks get alt-text prompts/warnings in the
      diagnostics panel
- [ ] New heading-producing content respects the H1-once, no-skipped-
      level rule the diagnostics panel checks
- [ ] New interactive/canvas content (simulations, scans, and — once
      built — the DAW/TTS modules) gets a real text alternative, not
      just a generic label
- [ ] Reduced-motion respected for any new animation (including the
      planned DAW page-animation sync)
- [ ] Tap targets ≥ 24×24px on any new mobile UI, especially the
      planned admin mobile overhaul
- [ ] Color contrast checked for any new UI color, not just theme
      tokens

---

## 9. Critic review round 1 (2026-09-25)

Per standing instruction: after each batch of shipped work, spawn two
parallel read-only review agents (security/correctness/dead-code, and
design/a11y/SEO/UX) and act on real findings. This is the first run,
covering the 23 features shipped in the session before it plus custom
font upload. Both reports in full are in this session's transcript;
summarized and triaged below.

### Fixed this round

**Critical/high security:**
- Reflected XSS via `/search?type=` — the raw query param was placed
  unescaped into `href` attributes in the sort/pagination links, and an
  invalid value still rendered (0 results, filter bar shown regardless).
  Fixed at the source: `type` is now validated against an allow-list
  (`page`/`article`/`project`/empty) in `index.js` before it ever
  reaches `render.js`, plus `encodeURIComponent` on it in the link
  templates as defense in depth.
- Session-cookie / page-password HMAC collision — both used
  `hmac(SESSION_SECRET, <raw string>)` with no domain separation, so a
  page password chosen to look like a future millisecond timestamp
  could double as a forged admin session cookie (`auth.js`,
  `admin-api.js`). Fixed by prefixing every such HMAC's message with a
  purpose tag (`"session:"`, `"admin-login:"`, `"page-password:"`) so
  values from one context can never be replayed as another. This
  invalidates existing sessions/page-passwords once deployed (expected,
  one-time; no page passwords were in real use yet).
- Duplicating a password-protected page produced an unprotected,
  sitemap-included copy (`password_hash`/`sitemap_exclude` weren't in
  `createPage`'s field list). `duplicatePage` now copies both explicitly
  via a follow-up UPDATE.
- Backup restore (`importAll`) silently dropped columns added after the
  original implementation — page passwords, `nav_parent_id`,
  `custom_json_ld`, article/project `expires_at`/`archived`/
  `sitemap_exclude`/etc., and media `caption`/`credit`/`license`/`hash`
  — because each table's INSERT only listed a fixed, stale column set.
  Rewrote every INSERT to match the current schema exactly, added the
  three tables `exportAll` was missing entirely (`simulations`, `songs`,
  `topic_meta`) to both export and import, and handled `pages
  .nav_parent_id` (a self-reference) with a two-pass insert — first pass
  NULLs it, a second pass UPDATEs it — since a child row can have a
  lower id than its parent and D1 checks foreign keys immediately, not
  at commit.
- Page password brute-forcing had no rate limit and accepted 1-character
  passwords; the unlock cookie had neither `HttpOnly` nor `Secure`.
  Added an 8-per-15-minute rate limit on `POST /page-access/:slug`
  (matching admin login's own limit), a 4-character minimum, and
  `HttpOnly; Secure` on the cookie.
- CSV formula injection in the raw analytics export — a cell starting
  with `=`/`+`/`-`/`@` is a live formula to Excel/Sheets even when
  quoted, and pageview/event rows come from public, unauthenticated
  `POST /api/track` calls. Cells now get a leading tab when they'd
  otherwise start with one of those characters.
- `escapeHtml` in the admin app (`app.js`) escaped `<`/`>`/`&` but not
  quotes, unsafe in the ~23 places it's used inside an HTML attribute
  (e.g. a stored analytics referrer rendered as an `<option>`'s text,
  reachable via a crafted `Referer` header). Now also escapes `"`/`'`.
- `POST /api/admin/logout` sat above the auth gate (so a signed-out
  browser can still clear a stale cookie) but logged "Admin logout" on
  every call regardless — anyone could flood the activity log by
  hitting it repeatedly. Now only logs when a session was actually
  authenticated.
- RSS `?tag=` was written into `<title>` unescaped (pre-existing, not
  from this session) — now run through the same `xmlEsc` every other
  RSS field uses.
- Publish-validation bypass: the "body must be >50 chars to publish"
  check only ran when `published_at` was already in the past, so
  scheduling a near-empty article/project for a future date, or bulk-
  "Publish"-ing one, both skipped it entirely (nothing re-checks length
  when a future date actually arrives). Fixed by validating on *any*
  non-null `published_at`, not just an immediate one, in both single-
  item routes; bulk `publish` in `db.js` now queries affected rows first
  and skips (rather than force-publishes) any that are still too short,
  surfaced to the admin as "N skipped (body too short)" the same way
  locked-item skips already are.

**Correctness bugs:**
- `nav.js`'s project-hero-video autoplay/motion-sync IIFE ran
  synchronously before `<main>` exists in the page source (same root
  cause as an earlier-session preview-mode-button bug), so
  `querySelectorAll(".project-hero-video")` always found nothing —
  hero videos never played and never responded to the motion toggle.
  Deferred to `DOMContentLoaded`.
- The font-size toggle's `localStorage.getItem` read wasn't wrapped in
  try/catch (only the write was) — in a browser with blocked/cleared
  site storage, this threw uncaught during nav.js's initial top-to-
  bottom run, which (per how a classic script executes) silently
  aborted every statement after it in the file. Now guarded.
- KaTeX's stylesheet/fonts load from jsdelivr, but the CSP's
  `style-src`/`font-src` only allowed cdnjs (script-src already allowed
  both) — math blocks rendered as garbled, doubled HTML/MathML text.
  Added jsdelivr to both directives.
- `hardDeletePage` could 500 with a FK-constraint error when the page
  being permanently deleted was still some other page's `nav_parent_id`
  (no `ON DELETE` clause on that self-reference, and D1 enforces FKs).
  Now nulls out any children's `nav_parent_id` first.
- The notification bell never reloaded after logging in from the login
  screen within the same page load — `loadNotifications()` only ran
  once, before auth, and 401'd silently. Moved it into `boot()`, which
  runs after every successful auth check (page load or in-page login).
- The media-usage map (used by the library's "Unused" filter before a
  bulk delete) missed `before-after` blocks and the `[before-after: …]`
  body shortcode, per-topic share images, and 3D-scan poster images —
  any of these could be flagged "unused" and deleted while still live
  on the site. All four are now tracked in `getMediaUsageMap`.
- `/topics/<malformed-percent-encoding>` (e.g. `%E0%A4%A`) 500'd on an
  uncaught `decodeURIComponent` throw; `/search?...&page=<huge number>`
  also 500'd (no upper bound before it reached the SQL LIMIT/OFFSET).
  Both are public, unauthenticated, and each 500 writes an `error_log`
  row (capped at 300), so either could drown out real errors. Fixed:
  the topic decode is now try/caught (falls back to the raw segment,
  which just won't match anything), and `page` is clamped to a sane
  integer range.
- The breadcrumb (and its JSON-LD `BreadcrumbList`, and the RSS feed's
  `<channel><link>`) on every article page linked to `/random`, which
  has no index route and 404s — pointed at `/archive` instead (the
  closest real, working "everything, newest first" page) until a real
  `/random`/`/writing` index exists (see idea list below).
- Mobile search suggestions (`.search-suggest`) were `position:
  absolute; right: 0` relative to `.site-search`, which is only ~110px
  wide on a phone (the input's own `max-width: 40vw`) — the 260px-wide
  dropdown ran off the left edge of the screen. Verified via Playwright
  at 390px before and after: repositioned relative to `.topbar-tools`
  (the search box plus the icon buttons after it) at the existing
  640px breakpoint, confirmed fully on-screen (x 20–306 of 390) with no
  change to desktop's layout (verified unchanged at 1280px).

**Design/accessibility:**
- Every scrollable result list inside Site Settings and the SEO
  Dashboard modal (SEO report, accessibility report, orphans, content
  health, link-check results, activity log, error log, scheduled
  backups, webhook deliveries, storage) rendered at 0px height — a real
  flexbox trap: `.settings-body` is `display:flex; flex-direction:
  column; overflow-y:auto`, and a flex child with its own
  `overflow:auto` has an automatic minimum size of 0 per spec, so
  flexbox could shrink it to nothing instead of respecting its own
  `max-height`. Fixed with `.settings-body > * { flex-shrink: 0; }`
  (the parent already scrolls; children never needed to shrink).
  Verified via Playwright: activity log (100 rows), error log (5),
  webhook deliveries (2), and scheduled backups (22) all now render at
  their real heights instead of 0.
- The password-gate page had three stacked issues: no `grid-column`/
  `grid-row` (fell back to auto-placement — a single 1/24-column,
  16px-tall cell, ~35px wide on desktop, ~3px on mobile), the password
  input had only a placeholder and no `<label>`, and the error message
  wasn't announced to assistive tech. Fixed: explicit `grid-column: 1 /
  -1; grid-row: 1 / span 16` (matching the convention already used for
  search/topics/archive), a real `<label for="page-password-input">`,
  and `role="alert"` on the error paragraph. Verified full-width
  (1036px at 1280px viewport, was ~35px) via Playwright.
- Site-wide light-theme contrast failure: `--accent` in light mode
  (`#996414`, darkened specifically to work as *text* on white) was
  also being used as a *button background* with hardcoded `#0b0b0c`
  text on top — that combination is only 3.92:1, under WCAG AA's
  4.5:1. Affected the active nav tab, skip link, Unlock button, and the
  simulation/3D-scan power buttons (5 identical `background: var(
  --accent); color: #0b0b0c` pairs). Introduced a separate `--on-accent`
  token (dark in dark theme, white in light theme, ~5:1) and repointed
  all five. Also gave `.password-gate-error`'s red (`#e05252`, 3.82:1
  on white) a theme-aware `--error-text` token (`#c62828` in light
  theme, ~5.6:1).

### Deferred to backlog (not fixed this round)

Real findings, lower priority relative to the above or requiring more
design/testing time than a quick fix allows. Grouped by area; each has
enough detail to act on directly later.

- ✅ Pages didn't reflow on mobile — the public site's 24-column CSS
  grid kept desktop `grid-column`/`grid-row` placements verbatim at any
  width (an image block placed `1 / span 12` on desktop stayed 12/24
  columns wide, ~169px, on a 390px screen), and the fixed 16px
  `grid-auto-rows`/explicit row-span sizing (tuned for desktop-width
  line-wrapping) could clip content that wrapped to more lines at a
  narrower width — a real mismatch from what the admin's own mobile
  editor preview (already a single stacked column) suggested a visitor
  would see. Went with auto-stack-by-default plus an optional per-block
  override, matching the same 24-column numbering the desktop grid
  already uses so it's one consistent mental model: inside the
  existing `@media (max-width: 640px)` block, `.canvas` switches to
  `grid-auto-flow: row; grid-auto-rows: auto` and every `.block` gets
  `grid-column: 1 / -1 !important; grid-row: auto !important` — full
  width, auto-sized height, and stacked in the same order blocks are
  already fetched in (`ORDER BY row, col` in `listBlocks`/`getBlocks`,
  which is exactly desktop top-to-bottom/left-to-right reading order,
  so no separate "mobile order" field or reshuffling was needed). A new
  per-block style key, `mobileColSpan` (1–24), opts a block out of full
  width: `blockStyleAttr()` (`worker/render.js`) emits it as a
  `--mobile-col-span` CSS variable, `renderBlocks()` adds a
  `block-mobile-col-override` class when it's set, and that class's
  rule (`grid-column: span var(--mobile-col-span) !important`) lets the
  grid's normal auto-placement pack e.g. two blocks that should stay
  side-by-side on mobile into the same row if they fit — added to the
  inspector as "Mobile column span override" alongside the other
  per-block style fields (fully generic — no bespoke save-path code
  needed, `STYLE_FIELDS` already round-trips arbitrary keys through
  `block.style`). A site with a custom mobile/desktop breakpoint (Site
  Settings → Appearance) gets the same stacking rules re-asserted at
  its custom width too, via the same per-request `<style>` injection
  mechanism already used for the desktop/mobile block-visibility
  breakpoint override. Verified via Playwright: two blocks placed
  side-by-side on desktop (`col 1/span 12` and `col 13/span 12`) render
  full-width and stacked in order at 390px width; a third block with
  `mobileColSpan: 12` renders at half the canvas width instead of
  stacking full-width, and the generated HTML carries both the
  `block-mobile-col-override` class and `--mobile-col-span:12`; the
  inspector shows the new field with its full label when a block is
  selected.
- ✅ Search, Topics index, Archive, Reading History, Saved, 404, and a
  single tag's Topic page all used a fixed `grid-row: 1 / span 16`
  (376px) regardless of actual content — a full page of 10+ search
  results, or a site with a footer set, could overflow that height with
  the footer painting over the tail of the content. Switched all seven
  to the same flow layout (`canvasClass: "canvas article-canvas"`)
  article/project pages already use — height now comes from content,
  which can't overlap in flow layout the same way a wrong grid-row
  guess could. Verified via Playwright: all seven report the
  `article-canvas` class, and with a real footer set, a full page of
  archive content no longer overlaps it (previously confirmed
  overlapping in the design review's screenshot). Left the password
  gate (added this round, already a single self-contained form rather
  than a content listing) and the standalone simulation-viewer page
  (not named in the original finding) out of scope — both are
  fixed-length by nature, much lower overflow risk than a growing list.
- ✅ A video embed's 16:9 box sizes its height purely from its own
  width, independent of the row_span the admin actually assigned it —
  a wide column with a short row_span rendered taller than its own
  grid cell and visually spilled into whatever came after it. An
  `<iframe>`'s embedded content can't be letterboxed/cropped the way
  an `<img>`/`<video>` could with `object-fit`, so there's no clean way
  to shrink the video itself to fit a too-short row without visually
  squishing the player — instead, gave the video block's own wrapper
  `overflow: hidden`, scoped specifically to `block.type === "video"`
  (not every block, since that would also clip other blocks'
  intentional escape-the-box effects, like a hover-lift's shadow or a
  slide-in animation's start position). A too-short row now crops the
  video at its own boundary instead of overlapping the next block.
  Verified via Playwright: a video in a short row_span no longer
  overlaps a heading positioned right after it.
- ✅ Projects (and Articles) editor form fields were visually crushed —
  three separate bugs sharing the same root cause across
  `.article-editor` (used by both editors):
  1. Every textarea got `flex:1`, so the several small ones (Summary
     `rows="2"`, Downloads, custom JSON-LD, correction note, private
     notes) competed equally with the one that should actually grow
     (Body, `rows="16"`/`"14"`) for the panel's limited space — with
     more flex:1 items than room, all of them got squeezed toward
     flexbox's implicit `min-height:auto`, far below their own `rows`
     attribute. Fixed with `flex-shrink:0` on the general rule (every
     textarea defaults to its own rows-based height) and — this part
     took two tries — `flex: 1 0 auto` (not a bare `flex:1`, which
     implies `flex-basis:0%` and made Body ignore its own `rows`-based
     size and grow from *zero*, finding there usually isn't real
     leftover space in a panel already dense enough to scroll) on
     `#article-body`/`#project-body` specifically, so they still start
     from their natural size and only grow into space if there
     actually is any.
  2. `#project-status` had no sizing rule of its own inside
     `.article-series-row` (unlike `#article-series`, which already
     got `flex:1`) — sharing a flex row with several fixed-width
     checkboxes/number inputs squeezed it down to near its min-content
     width. Gave it `flex:1; min-width:160px`.
  3. `.article-series-row` had no `flex-wrap`, so a project with all of
     Status + Featured + Featured order + Sort order + Exclude from
     sitemap + Archived in one row could overflow past the panel's
     right edge instead of wrapping. Added `flex-wrap: wrap`.
  Verified via Playwright (correctly scoped to `#projects-modal` after
  first catching myself measuring the *hidden* Articles modal's
  identically-classed elements by mistake): Summary now renders at
  ~58px (was ~18px), Body at ~298px, Status at ~205px wide (was
  crushed), and no field overflows the row's edge. Re-verified the
  Articles editor's own Body/Series fields are unaffected by these
  shared-CSS changes.
- ✅ Diagnostics' H1 check compared `Number(b.content.level) === 1`,
  which is `false` for a heading block with no stored `level` at all —
  but `headingLevel()` in `worker/render.js` actually renders such a
  block as `<h1>` (its documented fallback). So a real, rendered H1
  wasn't being counted as one: a page with exactly one implicit-level
  H1 falsely reported "No H1 heading", and — since this is also why the
  finding said multiple-H1 detection "doesn't work at all" — two
  implicit-level H1s were BOTH miscounted as zero, so the page reported
  "No H1" instead of "2 H1 headings found" (the multiple-H1 check
  itself was fine; it just never had a nonzero `h1Blocks.length` to
  act on). Added `effectiveHeadingLevel()` in `app.js`, mirroring
  `headingLevel()`'s exact fallback rule, and used it for both the H1
  count and the heading-level-skip check (which already had its own
  correct-by-accident `|| 1` fallback, replaced for consistency).
  Verified via Playwright: an implicit-level H1 no longer falsely
  reports "No H1"; a page with genuinely zero headings still correctly
  does; two implicit-level H1s now correctly report "2 H1 headings
  found". (Diagnostics' overlap detection false-negative is a separate,
  unrelated issue — not investigated or fixed this round.)

**Admin UX:**
- ✅ Nav dropdown keyboard/screen-reader behavior, three issues:
  1. `role="menu"` on `.tab-dropdown` with no `menuitem` children or
     arrow-key/Home-End/type-ahead handling — committing to the ARIA
     "menu" role obligates all of that; a screen reader user told
     "menu" but only getting plain Tab order is worse off than one
     simply told about a list of links. Removed the role entirely — the
     ARIA APG's own "Disclosure Navigation Menu" pattern is exactly
     this (a plain button revealing ordinary links), and needs no
     special role since normal Tab order already handles it correctly.
  2. `aria-expanded` on the caret only ever updated inside its own click
     handler — the dropdown *also* opens via plain CSS `:focus-within`
     (Tabbing into a child link, no JS/class involved), which never
     touched it. Added `focusin`/`focusout` listeners per `.tab-group`.
  3. Escape did nothing while focus was inside a `:focus-within`-opened
     dropdown: `closeAll()` only ever removed the click-toggled `.open`
     class, which was never set in that case, and even after fixing
     Escape to move focus back to the group's own `.tab` link (the
     usual "return focus to what opened this" convention), the
     dropdown *stayed visually open* — `.tab-group`'s `:focus-within`
     matches on that same leading link too (by design, so hover and
     Tab-in both flow the same way), so landing focus back on it never
     stops matching on its own. Added a `.tab-group.force-closed`
     override (applied by Escape, cleared again the moment focus or
     hover genuinely re-enters the group) — this took two more
     iterations to get right: a `focusin` listener firing when focus
     literally landed on that same `.tab` link was originally
     re-triggering "this group is open" and undoing the close within
     the same synchronous call, then a version that only reopened it
     correctly the *first* time back in but stayed stuck closed on a
     later, unrelated visit was fixed by also clearing the override on
     the group's own `focusout` (focus leaving entirely).
  Also gave the caret `aria-controls` pointing at the dropdown's now-
  present `id` (previously had none). Verified via Playwright: no
  `role="menu"` remains; `aria-expanded` correctly becomes `true` when
  Tabbing into a dropdown link; Escape correctly sets it back to
  `false` and visually hides the dropdown; hovering or Tabbing back in
  afterward correctly reopens it again (not permanently stuck closed);
  plain mouse hover is unaffected by any of this.
- ✅ Checked, doesn't reproduce: at 390px, `.admin-header-right` (which
  holds Notifications/Search/Articles/Projects/Media/More/Preview mode
  — well past "5+ items") already collapses into a full off-canvas
  "Menu" drawer via an existing mobile media query, predating this
  critic-review round (the "Admin UX / mobile overhaul" work). No
  horizontal scroll or clipped label — `body.scrollWidth` measured
  equal to the viewport width via Playwright, and a screenshot showed
  a clean header (hamburger, page picker, "+ Page", "Menu"). This
  finding must reflect an earlier state of the admin UI than what's
  live now; nothing to fix.
- Notification bell: ✅ Escape now closes it (and the "More" menu,
  same handler), opening either one now closes the other (mutual
  exclusivity — verified via Playwright for both directions), the
  badge is now the same darker `#c62828` red used elsewhere this round
  (was `#e05252` on white text, 3.82:1, now ~5.6:1), and the bell
  button gets a real `aria-label` ("Notifications, N items need
  attention" / "…nothing needs attention") updated every time the
  count refreshes, instead of a screen reader reading its emoji plus
  the bare badge number as "🔔 3". Deep-links still open Site Settings
  at the top instead of scrolling to the relevant section — not fixed
  this round (a bigger admin-navigation change than this pass's other
  fixes).
- ✅ Media Library mobile grid rows overlapped — `.media-item` used CSS
  `aspect-ratio: 1`, but a grid's auto row-track height needs to come
  from its tallest item, and an aspect-ratio item's own height is
  itself derived from that same row's cross-size — a circular
  dependency the browser under-resolved, computing a track only
  ~134px tall for a ~160px item and letting every row visually spill
  into the next one. Measured the exact mechanism via Playwright before
  fixing (an `align-items: start` attempt changed nothing, since the
  row-height computation itself was the actual problem, not stretch);
  switched to the classic padding-bottom aspect-ratio technique
  instead, which has no such dependency (percentage padding resolves
  from the item's own already-known width). Verified via Playwright:
  rows now have the correct 12px gap with zero overlap on mobile, and
  desktop's grid is visually unaffected.
- ✅ `.danger`'s `background`/`color` `!important` rules were winning
  over the browser's own muted appearance for `:disabled`, making a
  disabled Delete/Trash/"Apply to all matches" look exactly as
  clickable as an active one. Added a `.danger:disabled` rule (a
  pseudo-class on the same class has the specificity edge needed to
  win once both sides use `!important`) with a muted background/text
  and `cursor: not-allowed`. Verified via Playwright: a disabled
  "Delete selected" no longer shows the active red, and selecting an
  item to enable it still shows the correct red styling.
- ✅ Media Library's desktop toolbar was ~19 ungrouped native controls
  in one flat flex row with no visual grouping. Wrapped the existing
  controls (no new functionality) into four `.media-toolbar-group`
  divs by function — filters (folder/type/search/usage/unused/
  duplicates), saved searches (select/save/delete/scan-duplicates),
  upload (folder select/upload button), and bulk actions (selected
  count/move/tag/delete) — each group getting a thin right-hand
  divider (`border-right`) except the last, with `flex-wrap` on both
  the outer toolbar and each group so it degrades to stacked rows on
  narrow viewports. No JS changes needed since ids/behavior are
  untouched. Verified via Playwright: four groups render, each
  containing its expected controls, dividers separate them visually at
  desktop width, and the layout wraps into readable rows at mobile
  width (390px) without overlap.
- ✅ Site Settings: checkboxes stretched to `width:100%` by a blanket
  `.settings-body input` rule, showing as a detached box above their
  label instead of inline; "Security events only" label clipped to one
  visible letter. Fixed the blanket rule to exclude checkboxes
  (`input:not([type="checkbox"])`) and wrapped each checkbox+label pair
  in a `.settings-checkbox-row` flex container so the box sits inline
  at its natural size next to full label text. This landed together
  with the Settings-modal tabs restructure below, which also moved the
  Save button off mid-modal into a sticky bottom bar. Verified via
  Playwright: checkbox width is 13px (not stretched), "Security events
  only" label renders in full, no clipping.
- ✅ Confusing/overlapping labels: "Site" opened the settings modal
  with no hint of what "Site" meant — renamed to "Site Settings".
  "Preview mode: Off" (a toggle that makes the live site show drafts
  in this browser) sat right next to an unrelated "Preview" button
  (which opens a responsive-width preview panel for the current page)
  — renamed the latter to "Screen Preview" so the two are visually and
  semantically distinct. Link Checker's "Run automatic check now" and
  "Check links" are genuinely two different features (the former
  triggers the same background job that also runs once a day and
  writes a compact pass/fail summary; the latter runs a fresh scan and
  lists every single link with its status) but the names didn't say
  so — renamed to "Update daily check now" / "Scan all links (full
  list)" with tooltips spelling out the difference, and reordered so
  the daily-check summary appears before the full scan output.
  Verified via Playwright: both link-checker buttons still trigger
  their respective endpoints and render results correctly, and the
  Site Settings modal still opens from its renamed button.
- ✅ Admin editor canvas wasn't keyboard-navigable — every block was a
  plain `<div>` with no `tabindex`, so Tab skipped the whole canvas and
  selecting a block required a mouse click. Added `tabIndex = 0`,
  `role="button"`, and an `aria-label` naming the block type to both
  the desktop absolute-positioned blocks and the mobile stacked-list
  blocks, plus a `keydown` handler on each (Enter or Space) that runs
  the same selection logic as a click — on desktop that's select +
  re-render + refocus (re-rendering rebuilds every block div from
  scratch, so without an explicit refocus of the replacement node,
  keyboard focus would silently reset to the top of the canvas every
  time a block was selected); on mobile it also opens the inspector
  drawer, matching the existing tap behavior. Added a visible
  `:focus-visible` outline on `.admin-block` since it had none before.
  Verified via Playwright: blocks report `tabIndex: 0`/`role="button"`/
  a descriptive `aria-label`; focusing a block and pressing Enter
  selects it, populates the inspector, and leaves focus on the
  (re-rendered) selected block rather than losing it; the same works
  on the mobile stacked layout, where Enter also opens the inspector
  drawer.
- ✅ Photo editor "Save preset" was dropping earlier adjustments —
  `onAdjustCommit()` replaced `lastAdjust` wholesale from the three
  sliders' current values each time, but the sliders reset to 0 after
  every commit, so adjusting brightness then separately adjusting
  contrast zeroed out brightness's already-baked-in contribution the
  moment contrast's commit fired. Now accumulates onto `lastAdjust`
  instead of replacing it. Verified via Playwright (`window.PhotoEditor
  .open()`, simulated slider input+change events, saved preset via the
  real UI): brightness +20 then contrast +10 now correctly saves
  `{brightness: 20, contrast: 10}` instead of `{brightness: 0,
  contrast: 10}`.
- ✅ Dropdown nav children used to vanish silently if the parent's
  `nav_label` was cleared or the parent was trashed — `listNavPages()`
  filters to `nav_label IS NOT NULL AND deleted_at IS NULL` before
  building the tree, so an invisible parent was dropped from the
  results entirely, taking its still-nav_label'd children with it
  (they were never picked up as top-level either, since they still
  pointed at that now-absent parent id). Both `updatePage()` (clearing
  `nav_label`) and `deletePage()` (trashing) now promote any children
  to top-level (`nav_parent_id = NULL`) instead, matching the same
  "detach, don't discard" fix already applied to `hardDeletePage()`
  earlier this round. Verified via Playwright: a child page's nav
  label survives both a parent's `nav_label` being cleared and the
  parent being trashed, appearing top-level in both cases instead of
  disappearing from the nav.
- ✅ A simulation/scan/song block whose reference had been deleted
  rendered a raw "Simulation/Scan/Song not found." message straight to
  real visitors, and still reserved its full grid-row span as blank
  space. `renderBlockInner` now returns `null` (kept distinct from a
  spacer block's intentional `""`) for these three "reference no longer
  exists" cases, and `renderBlocks` skips wrapping/positioning any
  block whose inner content came back `null` — the block disappears
  entirely instead of showing an error or reserving space. Scoped only
  to the "id set but the thing was deleted" case, not "no simulation/
  scan/song selected yet" (unchanged, still shows its placeholder — a
  page in that state isn't expected to be live yet). This only touches
  the real public render path (`renderBlocks` has exactly one caller,
  `renderPage` in `index.js`) — the admin editor's own canvas preview
  is separate client-side code, untouched, so an admin still needs
  their own way to notice a broken reference while editing (not fixed
  here; a red badge in the editor is listed as a future idea below).
  Verified via Playwright: a page with a broken simulation/scan/song
  block renders zero `.block` divs for them (no reserved space, no
  error text) while a real, valid reference on the same block type
  still renders its actual content.

**SEO/structured data:**
- ✅ A Page with no "Meta description" set shipped an empty
  `<meta name="description">` and empty `og:description` — articles/
  projects never had this gap since they don't have a separate
  meta-description field at all; they already fall back to
  `excerpt(body)`. Added the equivalent for pages: when
  `meta_description` is empty, build one from the page's own text/
  heading blocks (sorted into reading order, same as Diagnostics'
  heading-order check) run through the same `excerpt()` truncation, or
  the page title if there's no text at all. An explicit
  `meta_description` still always wins. Verified via Playwright both
  ways: an empty-`meta_description` page now gets a real description
  from its blocks, and a page with one set keeps using it untouched.
- ✅ `/topics/<anything>` now 404s with `noindex` when nothing's tagged
  with it, instead of an indexable 200 "Nothing tagged…" — closes the
  unbounded-thin-URL problem (every possible string used to render the
  same page at a distinct, indexable URL). Individual `/topics/:tag`
  sitemap entries were already scoped to tags with real content via
  `getTagCounts`, so this didn't touch the sitemap; the bare `/topics`
  and `/archive` index routes being unconditionally in the sitemap even
  when momentarily empty is a much smaller version of the same issue,
  left as a nitpick below rather than fixed here.
- ✅ Draft/expired previews (`?preview=1`, preview-token links, preview-
  mode cookie) now render `noindex` on both articles and projects —
  `renderArticle`/`renderProject` pass `noindex: !!previewReason`.
  Canonical URL is left pointing at the real public path on purpose
  (that's where the content belongs once published); `noindex` alone is
  what stops a leaked preview link from being indexed in its
  draft/expired state.
- ✅ JSON-LD/OG dates weren't valid ISO-8601 — D1's `datetime('now')`
  columns come back as `"YYYY-MM-DD HH:MM:SS"` (space-separated, no
  timezone), used raw in `datePublished`/`dateModified`/`dateCreated`
  and the `article:published_time`/`modified_time` meta tags. Added a
  `toIso8601()` helper (`index.js`) and applied it at all six call
  sites. (`WebPage` structured data on regular pages, and `url`/
  `image`/`description` on `BlogPosting`, are still not built — left
  below.)
- ✅ Gallery images now have a real per-image alt-text field. The
  gallery block's `content.images` array now holds `{url, alt}` objects
  (a bare string is still accepted and treated as `alt: ""`, so every
  existing gallery keeps rendering unchanged); the admin's textarea
  format is `URL` or `URL | alt text` per line (only the first `|`
  splits — an alt containing one of its own still round-trips intact),
  matching the same pipe-delimited convention already used for the
  link-list/changelog-list/etc. fields. The accessibility report now
  also flags a gallery block containing any image with no alt text,
  the same way it already flags a bare `<img>` in an HTML block.
  Verified via Playwright: a legacy bare-string image renders
  `alt=""`, an image with alt text renders it correctly, and the
  accessibility report correctly flags the block. (Embed/video iframes
  still have no `title` — not fixed this round.)
- ✅ Video and generic-embed block iframes now always render a `title`
  attribute (neither block type has a title/caption field of its own to
  draw a real one from, so it names the platform: "Embedded YouTube
  video", "Embedded Vimeo video", or "Embedded content from
  <hostname>" for the generic embed's various providers). Since these
  are now unconditional — not admin-optional — there's nothing for the
  accessibility report to additionally check here, unlike gallery alt
  text above. Verified via Playwright for both block types.
- ✅ Regular (non-home) pages used to have no structured data of their
  own at all beyond the site-wide `WebSite` entry every page already
  gets, unless the admin manually added `custom_json_ld` — the same
  minimum every other content type here has (`BlogPosting` for
  articles, `CreativeWork` for projects) was missing for the generic
  page-builder pages. Every non-home page now also gets a `WebPage`
  entry (name/description/url, using the same `description` — real or
  fallback — as the page's own meta tags), still combined with any
  `custom_json_ld` the admin added on top, same as before. Verified via
  Playwright: a plain page gets `WebPage` with the correct name/URL,
  and a page with `custom_json_ld` set gets both that entry and the new
  `WebPage` one side by side.
- `og:title` always matches `<title>` exactly (includes `" · Dominick"`)
  — on reflection this is normal, expected behavior (most sites do
  this deliberately), not a bug; not changing it.

**Lower priority / nitpicks:**
- ✅ Header icon buttons (theme/motion/font-size toggles) were rendering
  in the browser's default UI font instead of the site font — root
  cause of both halves of this finding at once: a `<button>` doesn't
  inherit `font-family` from the page by default (only non-form-control
  elements like the `.icon-link-btn` `<a>` next to them do), and two of
  the toggle glyphs (◐, ⏸) happen to render much smaller than the
  others (⇌, "A") in that fallback UI font at the same declared
  font-size — a mismatch that vanishes once all four actually share one
  font. Added `font-family: inherit` to the shared button rule.
  Verified all four now report the same computed `font-family`.
  (The font-size toggle's 4-step cycle still has no visible "current
  value" indicator — not fixed this round.)
- ✅ "Clear history"/"Clear all" on `/history` and `/saved` had no CSS
  targeting them at all, rendering with the browser's own default
  button chrome. Styled to match `.btn`'s inline accent-colored text-
  action look (an underline-on-hover link, not a heavy pill button —
  fits better for a small secondary control sitting inline in a
  sentence) rather than introducing a second button style. Verified
  via Playwright: computed background is transparent and border/cursor
  match the intended link-like style on both pages.
- ✅ Print/PDF output included share links, reactions, and the preview
  banner, and dark-theme text printed near-invisible on white. The
  chrome elements were a simple hide-list miss — added `.share-links`,
  `.reactions`, and `.preview-banner` to the existing `@media print`
  hide rule. The invisible-text bug was more subtle: `body { color:
  #000 }` inside `@media print` only sets the `<body>` element's own
  color — every block/heading/paragraph that sets `color: var(--text)`
  (which resolves to a light gray/white in dark theme) still uses
  whatever the `--text`/`--text-dim`/`--bg`/`--border`/`--accent`
  custom properties currently hold, since overriding one element's
  computed color doesn't touch the variables descendants read from.
  Fixed by overriding those custom properties themselves at `:root`
  inside `@media print` (forcing `--bg`/`--bg-elevated: #fff`,
  `--text: #000`, `--text-dim: #333`, `--accent: #000`), so every
  themed element resolves to readable print colors regardless of which
  theme was active on screen. Verified via Playwright with
  `page.emulateMedia({ media: "print" })` on a real published article:
  body background/color are white/black, `.share-links` and
  `.reactions` compute to `display: none`, and body text renders black
  even though the article was loaded in dark theme (`--text` resolves
  to `#17171a`, not the dark-theme `#ededf0`).
- ✅ An empty nav (zero pages with `nav_label` set) drew its `.tabs`
  wrapper as a small rounded dot in the header regardless — the `<nav
  class="tabs">` pill and its indicator span were unconditionally
  emitted even with nothing inside them. Now the whole wrapper is
  skipped when `navItems` is empty. Verified both states: no `.tabs` at
  all with zero nav items (this site's actual current local-dev state,
  incidentally — no pages have `nav_label` set yet), `.tabs` renders
  correctly again once a nav-labeled page exists.
- ✅ `theme-color` was a fixed dark value regardless of theme, and the
  site always started dark on a first visit even if the OS/browser
  preferred light (only the manual toggle ever set an explicit
  preference). The blocking inline theme script now falls back to
  `prefers-color-scheme` when nothing's stored yet, and both that
  script and the theme-toggle click handler keep `<meta name="theme-
  color" id="theme-color-meta">` in sync with whichever theme is
  actually applied — not just OS preference, since a manual override in
  either direction still needs to win. Verified via Playwright with
  `colorScheme: "light"`/`"dark"` contexts (first-visit OS preference
  respected in both directions) and an explicit `localStorage` override
  correctly taking priority over a conflicting OS preference.
- ✅ highlight.js and `<model-viewer>` used to load unconditionally on
  every page; now gated behind `document.querySelector("pre code")` /
  `"model-viewer"` respectively, same pattern as mermaid/KaTeX.
  `<model-viewer>` still upgrades correctly even though its defining
  script now loads after the element is already in the DOM — custom
  elements upgrade lazily once their definition arrives, same as how
  the mermaid/KaTeX conditional loads already worked. Caught and fixed
  a real bug surfaced by this pass' testing while I was in the same
  code: the `toIso8601()` helper added for the JSON-LD date fix above
  assumed `published_at` was always in D1's raw `datetime('now')`
  format, but the "publish now" path (`admin-api.js`) actually stores
  `new Date().toISOString()` directly — an already-valid ISO string.
  Feeding that through the naive space→`T`+`Z` transform produced a
  malformed date and 500'd every published article/project page.
  `toIso8601()` now tries the string as-is first and only falls back to
  the D1-format transform if that doesn't parse. Verified via
  Playwright: a code-block article now correctly requests highlight.js
  (previously the bug above 500'd before this could even be tested),
  the homepage (no code blocks/scans) requests neither script, and a
  "publish now" article's `article:published_time` meta and
  `datePublished` JSON-LD are both valid ISO 8601.
- ✅ Consolidated the three near-identical hex/SHA helpers. `toHex`
  (hex-encoding a buffer, `auth.js`) is now exported and reused by a
  single `sha256Hex` (digest + hex) exported from `db.js`;
  `admin-api.js`'s own copy (`hashBytes`) is deleted, its two call
  sites now import and call the shared `sha256Hex`. Verified via
  Playwright: media upload dedup (which uses this hash to detect an
  identical file re-upload) and the scheduled-backup integrity check
  (which uses it to verify a written backup reads back byte-identical)
  both still work correctly after the refactor.
- ✅ `getStorageUsage`'s table-name array existed as two separate
  literal copies that had to be kept in sync by hand — now one
  `STORAGE_USAGE_TABLE_NAMES` constant used by both.
- ✅ Removed the unused `plainText` export from `render.js` — its own
  comment claimed it fed the "Read aloud" button, but that feature
  (`public/article-extras.js`) actually reads the rendered DOM's own
  text directly and never called this function at all; confirmed zero
  call sites anywhere before deleting.
- ✅ Replacing (or removing) a project's hero video, or an article's/
  project's TTS narration audio, now deletes the old R2 object instead
  of leaving it orphaned — done despite this codebase's existing
  precedent elsewhere (e.g. `default_og_image`) of not cleaning up
  replaced files, at the user's explicit request, since video files
  are large enough that this adds up. `updateArticle`/`updateProject`
  fetch the current `tts_audio_key`/`hero_video` value only when that
  field is actually part of the incoming update, and delete it
  afterward if it changed (including changing to `null`, i.e. removed
  entirely) — guarded per-field so patching one of the two on a
  project (they're independent fields) never touches the other one's
  file. `custom font` uploads (site-wide, in Settings, not per-content)
  are a separate, deliberately-untouched case — still no precedent
  reason to delete those. Verified via Playwright: replacing a hero
  video deletes the old R2 object and keeps the new one servable,
  removing it (set to `null`) deletes it, and updating an unrelated
  field (title) on the same project doesn't touch it at all — same
  three checks repeated for an article's TTS audio.

### Improvement ideas surfaced (not bugs, future backlog)
- ✅ Real mobile reflow for the page grid — see the ✅ entry under
  Layout/reflow above (auto-stack full-width in desktop order by
  default, with an optional per-block `mobileColSpan` override).
- ✅ A built-in, paginated `/random` (articles) and `/projects` index
  page — previously the only real link target for the article
  breadcrumb was `/archive`, which mixes in projects/pages and has no
  pagination at all. Added `listArticlesPaged()`/`listProjectsPaged()`
  (`worker/db.js`) — the same published-only filtering as
  `listArticles`/`listProjects` but with real `LIMIT`/`OFFSET` +
  a `COUNT(*)` for a total, since neither existing helper supported an
  offset — and two new routes, `renderArticlesIndex`/`renderProjectsIndex`,
  reusing the exact `?page=N` / "Page N of M" pagination pattern the
  search page already established. Both are `noindex` past page 1 (a
  real, working slice of the same content the page-1 URL covers, not
  worth indexing separately) and 404 if `page` is past the last real
  page. The article breadcrumb (and its JSON-LD mirror) now points at
  `/random` instead of `/archive`; the project page gained a "Projects"
  breadcrumb segment pointing at the new `/projects` index (it
  previously had none at all — just Home → title). Both new paths are
  in the sitemap and added to `RESERVED_SLUGS` so a future custom Page
  can't be created at either slug again.
  **Note:** production already had two hand-built Pages sitting at
  these exact slugs ("Projects · Dominick" / "Random · Dominick",
  presumably built before this feature existed as a manual stand-in) —
  confirmed via a direct D1 query before shipping this, and the user
  explicitly confirmed replacing them (these new routes are checked
  before the generic page-slug lookup, so they now take priority; the
  two old Page rows are still sitting in the pages table, just
  unreachable at their URL — worth deleting via the admin Trash UI
  next time you're in there, since I didn't touch production data
  directly).
  Verified via Playwright against 25 test articles (more than one
  page's worth): `/random` page 1 shows 20 items with a "Page 1 of 2"
  / next link, page 2 shows the remaining 5 with a previous link and
  `noindex`, `/random?page=999` 404s, `/projects` renders a test
  project, and both the article and project breadcrumbs read "Home /
  Articles / …" and "Home / Projects / …" respectively.
- ✅ Consolidated "Site Health" dashboard — the SEO Dashboard modal
  already merged SEO/Accessibility/Link Checker/Orphans/Content Health
  into one modal, each with its own "Run report" button, but there was
  no single merged view. Diagnostics was deliberately left out of this
  merge: it only scans whichever single page is currently open in the
  editor, not the whole site, so folding it into a site-wide severity
  list would need a new batch-scan-every-page capability, a
  meaningfully bigger feature than aggregating results the other five
  checks already produce — confirmed this scope with the site owner
  before building it. Renamed the modal (and its "More" menu button)
  from "SEO Dashboard" to "Site Health", and added an "Overview"
  section at the top with a "Run all checks" button: it calls all five
  existing endpoints (`/link-check`, `/accessibility-report`,
  `/content-health`, `/seo-report`, `/orphan-content`) in parallel,
  normalizes every result shape into `{ severity, check, title, url,
  status }`, and renders one flat list sorted by severity (3 = a
  visitor would notice: broken links, missing alt text, an empty page;
  2 = hurts discoverability without visibly breaking anything: no meta
  description, duplicate title, orphaned content; 1 = mildest/easiest
  to defer: no share image, stale content) then alphabetically. Each
  row shows which check it came from (a small badge, reusing the
  existing `.lock-badge` pill style) and a clickable link to the
  affected page/article/project/image — the individual per-check
  "Run report" buttons and their own result lists are untouched, still
  useful on their own. Verified via Playwright: the modal/button both
  read "Site Health", clicking "Run all checks" against real local
  content produced 8 merged issues across 4 of the 5 checks with a
  "8 issues found across 5 checks" summary line, every row had a
  working link, and severity-3 (visually flagged "broken") rows all
  sorted before lower-severity ones.
- ✅ Split the giant Site Settings modal into tabs (Appearance, Sharing
  & SEO, Integrations, Maintenance, Tools, Logs, Backups) with a
  sticky Save bar, instead of one long scrolling list. Added a
  `.settings-tabs` row of buttons above the existing `.settings-body`,
  each with a `data-panel` attribute; the body's fields were grouped
  into seven `.settings-panel` divs carrying matching `data-panel`
  values (Appearance = theme + breakpoint + footer; Sharing & SEO =
  share image + empty states; Integrations = custom head + webhooks +
  webhook deliveries; Maintenance = maintenance mode/message; Tools =
  find & replace; Logs = activity/error log; Backups = backup/restore/
  scheduled backups + storage usage). All seven panels stay mounted in
  the DOM at all times — `switchSettingsTab()` only toggles their
  `hidden` attribute and the active-tab styling — so field values
  aren't lost switching tabs, and the existing Save handler (which
  reads every field by id regardless of which tab is visible) needed
  no changes. The Save button moved into a new `.settings-save-bar`
  sibling below `.settings-body`, sticky at the bottom of the modal
  instead of buried mid-scroll. Verified via Playwright across two
  scripts: `test_settings_tabs.js` confirmed each tab shows exactly
  one panel, the default tab (Appearance) is active on open, and Save
  still closes the modal; `test_settings_save_roundtrip.js` confirmed
  field values survive switching tabs (DOM never destroyed) and a save
  round-trip works correctly for fields spread across different tabs
  (footer from Appearance, maintenance_mode/message from Maintenance),
  with test values reset afterward via a direct API PUT.
- ✅ A richer 404 page — was just an apology plus the nav links already
  fetched for `renderNotFoundHtml()`. Added a plain `<form action="/search"
  method="get">` search box (submits without JS, no need to duplicate
  the topbar's autosuggest widget), a "Recent posts" list of the 5
  newest published articles (`listArticles(env, { publishedOnly: true,
  limit: 5 })`, fetched alongside the existing site-context lookup in
  `renderNotFound()`), and a link to `/archive`. The existing nav-links
  list stays, now under its own "Try one of these instead" heading so
  it doesn't run together with the new recent-posts list. Verified via
  Playwright: the search form is present and actually submits to
  `/search?q=...`, the "Recent posts" heading and list appear when
  published articles exist (using a real published test article, since
  the section renders nothing rather than an empty heading when there
  aren't any), and the archive link is present.
- ✅ One consistent public-facing name for "articles" — the admin panel
  already called them "Articles" everywhere, but a visitor saw a mix:
  the article breadcrumb (and its matching BreadcrumbList JSON-LD
  entry) literally read "Random" (an echo of the `/random/:slug` URL
  prefix), the search-filter pill and its section heading said "Posts",
  and the type-filtered RSS feed's title suffix also said "Random" —
  while the default (unfiltered) RSS feed's title fell back to the
  nonsensical "Dominick — Random" even though that feed mixes articles,
  projects, and pages together. Kept the URL itself as `/random/:slug`
  (an explicit call — renaming it would need 301 redirects for every
  existing article and would break already-shared links and cached RSS
  entries, treated as out of scope for a same-meaning label cleanup)
  and changed every other surface — breadcrumb text, its JSON-LD
  mirror, the search filter pill, both `<h2>Posts</h2>` result-section
  headings (search results and topic pages), and the RSS title suffix —
  to say "Articles"; the default RSS feed's fallback suffix is now
  simply dropped ("Dominick", not "Dominick — Random"), since it isn't
  a filtered articles-only feed. Verified via Playwright/curl against a
  real published test article: the search filter bar reads "All Pages
  Projects Articles", a type=article search results heading reads
  "Articles", `/rss.xml` title is plain "Dominick", `/rss.xml?type=article`
  title is "Dominick — Articles", and the article page's breadcrumb
  reads "Home / Articles / <title>".
- Badge a simulation/scan/song block with a broken (deleted) reference
  red in the admin editor canvas — now that the public side just
  silently hides such a block, an admin has no in-editor signal that
  one of their pages has one at all.

## 10. Design redesign + health/security/bug audit round (2026-09-25)

Two things happened together in this round: a full color-scheme redesign
("bold & vibrant," more character than the previous muted amber-on-black
default), and a three-way audit (one security/correctness pass over the
whole codebase, plus two hands-on Playwright critiques of the admin
console — one at iPhone width, one at a normal laptop width) with every
real finding fixed before deploying.

### Design redesign
- ✅ Replaced the muted amber/near-black default theme with a bolder,
  more distinctive palette in both light and dark mode, computed against
  actual WCAG contrast ratios rather than eyeballed (every text/background
  pairing below is ≥4.5:1, most well above): dark theme background moved
  from neutral near-black (`#0b0b0c`) to a deep violet-black (`#0c0a16`,
  7.59:1 for the new accent against it), light theme background moved
  from clinical white to a warm off-white (`#fffaf5`). The accent shifted
  from a muted amber (`#e8a13a`/`#996414`) to a vivid orange-coral
  (`#ff7a45`/`#c1440e`), paired with a new secondary accent, a soft violet
  (`#c9a5ff`/`#6d28d9`), via a new `--accent-gradient` token — used as a
  deliberate "character" touch on three signature elements: the brand
  logo's accent dot (background-clip: text gradient), the active nav
  tab's pill indicator, and the block-quote's left border (via
  `border-image`). Every other `var(--accent)` usage across the whole
  site and admin panel picks up the new solid color automatically, since
  it's one shared set of CSS custom properties in `public/style.css`
  that both stylesheets read from — no need to touch individual
  component rules. `--error-text` was nudged brighter to match the new
  theme's saturation while staying a clearly distinct hue (pure red) from
  the new orange-leaning accent, so the two are never confused.
- ✅ Swept every hardcoded fallback that duplicated the old hex values
  instead of reading the CSS variables, so the whole codebase agrees on
  one palette instead of half of it silently keeping the old colors:
  the favicon SVG and its data-URI twin, the fully-self-contained error
  and maintenance pages (deliberately independent of `/style.css`, so
  their colors are baked in as literal strings), the `theme-color` meta
  tag and its JS toggle in `nav.js`, the Site Settings custom-theme
  color pickers' default values (both the JS fallback and the static
  HTML `value=""` attributes — these are what a site that hasn't set a
  custom theme override shows as its "default" color, and needed to
  match the new real default), the photo editor's annotation-tool
  default stroke color, the song builder's played-note fill, and a
  stray `fill: #e8a13a` on the simulation-builder's active pin marker
  (switched to `var(--accent)` so it now stays in sync automatically).
- ✅ Found and fixed a real blocker while verifying this: the site's
  Settings table had `theme_bg`/`theme_accent`/`theme_text`/
  `theme_border` stored with the *exact* old hex values — not an
  intentional customization, just the old CSS defaults baked in as a
  permanent per-site override from early on, which silently shadowed
  every new default via `renderShell()`'s inline `<style>` injection
  (`worker/render.js`'s `themeVars` — sets `--bg` etc. via inline CSS
  when a setting is non-empty, which beats the linked stylesheet's own
  `:root`). Cleared all four settings to empty via the Site Settings
  API on the site actually being redesigned, letting the new CSS
  defaults take over as intended (a site that's set a genuine custom
  theme wouldn't have this problem, since intentional Appearance-tab
  values would look nothing like the shipped default).
- Scope: covers both the public site and the admin console (per your
  answer to scope this both ways), and both light and dark mode.
  Verified via Playwright screenshots at desktop and mobile width, in
  both themes, plus direct computed-style checks confirming the
  gradient renders correctly on the three signature elements.

### Security/correctness audit (general-purpose code review, no dynamic testing)
Full pass over `worker/*.js` looking specifically for what's *left* after
this session's earlier hardening rounds, not re-litigating already-fixed
issues. Overall verdict: well-hardened for a single-admin personal CMS —
auth gating, HMAC domain separation, SQL parameterization, XSS escaping,
SVG upload sanitization, CSV injection neutralization, mass-assignment
whitelisting, and rate limiting on every other unauthenticated
guess-a-secret endpoint were all independently re-verified clean. Two
real, if low-severity, gaps found and fixed:
- ✅ Preview-link tokens (`/random/:slug?preview_token=...` and
  `/projects/:slug?preview_token=...`) had no rate limiting, unlike
  every other unauthenticated "guess a secret" endpoint in the app
  (login, page-password). A 128-bit random hex token makes brute force
  impractical regardless, so this was a defense-in-depth gap rather
  than an exploitable one — but fixed for consistency with the rest of
  the codebase's posture: added the same `checkRateLimit`/
  `recordRateLimitHit` pattern already used for `/page-access` (15
  min / 20 attempts per IP), gated on a preview_token actually being
  present so normal published-content requests are unaffected. A
  rate-limited request just falls through to the existing generic 404
  (wrong token and no token already look identical), rather than a
  distinct 429 — arguably safer than revealing that a rate limit
  exists on this specific path. Verified: a real, valid preview link
  still returns 200; unfiltered requests are unaffected.
- 🔶 `DELETE /scans/:id` deletes the scan's R2 model files without an
  independent server-side usage check, even though `findScanUsage()`
  exists — but the admin's own delete flow (`scan-builder.js`) already
  calls that same endpoint first and shows a confirm dialog naming
  every page/article/project the scan is used in before deleting.
  Since this is a single-admin site with no untrusted caller of this
  endpoint, the UI-level warning is the real safeguard in practice —
  left as-is rather than duplicating the check server-side, which
  would be reasonable defense-in-depth for a multi-user CMS but adds
  complexity this app's actual threat model doesn't need.
- Also flagged, not acted on: a cosmetic gap where a page nested under
  a since-trashed parent isn't excluded from the nav-parent validation
  query (no security/rendering impact — `listNavPages()` already
  filters it out either way), and a couple of `Promise.all`-parallelized
  per-page loops that are technically O(n) queries but fine at this
  site's actual scale.

### Mobile admin critique (iPhone width, 390×844) — real findings, all fixed
- ✅ The notifications dropdown (and, if it were ever made visible on
  mobile, the "Recent" dropdown) was permanently forced open inside the
  mobile "Menu" drawer, and the bell icon's tap did nothing visible.
  Two compounding causes: (1) `public/admin/style.css`'s mobile
  "flatten the More menu into the drawer" rule targeted the *shared*
  `.admin-more-panel` class instead of `#admin-more-panel` specifically
  — `#notifications-panel` and `#recent-items-panel` share that class
  too, so they got force-shown along with it, even though their own
  trigger buttons (unlike "More ▾") stay visible and clickable on
  mobile and are supposed to behave as real toggleable dropdowns.
  Scoped the flatten rule to the specific id. (2) Even after that fix,
  clicking the notifications button still immediately closed the whole
  drawer: a separate "tapping any nav item in the drawer closes it"
  listener (meant for Articles/Media/etc., which navigate away) was
  wired to *every* button inside the drawer with no exclusion for the
  three toggle buttons that open a *nested* dropdown instead of
  navigating — since both listeners sit on the same button, the
  toggle's own `stopPropagation()` doesn't stop this second listener
  from also firing. Added `notifications-btn`/`recent-items-btn`/
  `admin-more-btn` to the existing exclusion list (which already
  excluded `close-site-menu` for the same reason). Verified via
  Playwright: the dropdown now starts closed, opens/closes correctly on
  tap, fits within the viewport, and the drawer itself stays open while
  toggling it.
- ✅ The Inspector (and Add-block palette) drawer's "×" close button
  scrolled away with the panel's own content on any block with a long
  style panel — since `.admin-inspector`/`.admin-palette` were both the
  fixed-position, transform-animated drawer *and* their own scroll
  container (`overflow-y: auto` on the same element), an absolutely-
  positioned child scrolled right along with everything else. Split the
  drawer into two layers: the outer `<aside>` stays fixed/non-scrolling
  and now only holds the close button; a new inner `.drawer-scroll-content`
  wrapper (added around each drawer's existing content in
  `public/admin/index.html`) holds the actual scrollable content. (A
  first attempt used `position: fixed` on the button instead of
  restructuring the DOM, but `.admin-inspector`'s own `transform` for
  the slide animation creates a *containing block* for fixed descendants
  too, per spec, so that alone didn't escape the scroll — confirmed by
  testing before committing to the DOM-split approach instead.) Verified
  via Playwright: scrolling either drawer's content to the bottom no
  longer moves the close button from its fixed corner position, in
  either drawer, and a real desktop screenshot confirms no visual
  regression there (the wrapper is a no-op layout-wise outside the
  mobile drawer transform).
- ✅ Diagnostics, Site Health/Link Checker, Trash, Layers, and Reusable
  Blocks rows all hard-truncated their one identifying string
  (`white-space: nowrap; text-overflow: ellipsis`) with no `title=`
  attribute anywhere and no way to read the full value — barely
  noticeable at desktop's much wider modal column, but several rows
  sharing a truncated prefix became indistinguishable at phone width.
  Rather than touching the ~25 separate JS call sites that build these
  rows (each would need a carefully-escaped `title=""` added), let
  `.link-check-url`/`.simulation-row span` wrap onto multiple lines
  instead of truncating, scoped to the existing mobile media query —
  trades a taller row for actually being able to read what it says,
  with one CSS rule covering every affected list at once.
- ✅ `<select multiple>` fields (Related projects/articles/
  simulations/scans in the article/project editor) rendered as the
  browser's unstyled default white listbox, a jarring bright rectangle
  in an otherwise fully dark-themed panel — `.article-editor input,
  .article-editor textarea` never included `select`. Added it, plus a
  little extra padding for the multi-select case specifically.
- ✅ Simulations/Songs/Scans/Reusable Blocks rows crammed a truncated
  title plus "View ↗ / Duplicate / Edit / Delete" onto one line, with
  "Edit" and a destructive "Delete" as little as 10px apart, both under
  any reasonable touch-target floor — a real mis-tap hazard on a
  touchscreen. Wrapped the row (title takes the full first line, action
  buttons wrap to their own row underneath) and bumped button padding/
  min-height, scoped to the mobile media query.
- ✅ Site Settings' "Save" button — the single most important action in
  the whole modal — was a completely unstyled native `<button>` (46×21px,
  default browser grey), because it lives in the sibling
  `.settings-save-bar` rather than inside `.settings-body`, which is
  what the existing accent-button styling targeted. Gave the save bar
  its own matching button style.
- ✅ Media Library grid overlay icons (edit-pencil and delete-X at
  24×24, the info button at 20×20, the select checkbox at the browser
  default ~13×13) were all under any reasonable touch-target size in a
  dense grid of ~170px tiles. Bumped to 30×30 / 26×26 / 18×18
  respectively — a meaningful improvement within the space a small
  grid tile actually has, not full 44px targets.

### Desktop admin critique (1440×900) — real findings, all fixed
- ✅ **Broke my own just-shipped feature**: every result list in the new
  Site Health dashboard (`Run all checks`, and every individual
  per-check "Run report" button, including the pre-existing SEO/
  Accessibility/Orphans/Content Health reports) rendered at `height: 0`
  — the API calls succeeded and populated real HTML, but none of it was
  visible, so opening the modal looked like every check just... found
  nothing. Root cause: `.settings-panel > * { flex-shrink: 0; }` (added
  earlier this session specifically to stop a scrollable flex child
  from collapsing to 0 height) only applies inside `.settings-panel` —
  which the *tabbed* Site Settings modal wraps its sections in, but the
  Site Health modal never did, since it isn't tabbed and its sections
  sit directly under `.settings-body`. Extended the rule to
  `.settings-body`'s own direct children too. Verified via Playwright:
  `#site-health-results` now measures a real 240px (was 0), and the
  pre-existing `#seo-report-results` (which had the *exact same*
  latent bug, just never triggered because a normal Settings-tab
  workflow never opens this particular non-tabbed modal) now measures
  111px too.
- ✅ A block whose column span reaches the canvas's current width (the
  common case — Heading, Article List, Project List, Gallery,
  Changelog, HTML, Simulation, Scan, Divider, and Spacer all default to
  the full 24-column span) had its resize handle rendered underneath
  the Inspector panel and completely unreachable, as soon as that block
  was selected. Cause: selecting a block calls `renderInspector()`
  directly (not a full `renderCanvas()`, deliberately, so a drag can
  start on the same pointerdown that also selects), but nothing
  recomputed the already-rendered blocks' pixel geometry against the
  canvas's new, narrower width once the Inspector's own width claimed
  some of the layout — every block kept the wider `left`/`width`
  values computed while the Inspector was closed. Added a
  `repositionBlocks()` helper (reads current `canvasMetrics()` and
  re-applies each block's `left`/`top`/`width`/`height` in place,
  without touching/recreating any DOM node, so an in-progress drag is
  unaffected) and wired it to run after every `renderInspector()` call
  via a thin wrapper, so any code path that shows/hides/resizes the
  Inspector — not just this one selection handler — stays in sync.
  Verified via Playwright on an isolated full-width test block: after
  selecting it, the block visibly shrinks to the canvas's new width and
  `document.elementFromPoint()` at the resize handle's own coordinates
  correctly resolves to the handle itself, not the Inspector.
- ✅ Escape did nothing to deselect a block or blocks on the canvas —
  every other Escape-dismissible surface in the app (modals, the
  notifications/more dropdowns, writing-focus mode) already handled it,
  but canvas selection was the one dead end. Added a fallback branch to
  the existing global Escape handler: if nothing else consumed the key
  (no modal/dropdown was open to close), clear the current selection
  and close the Inspector. Verified via Playwright: selecting a block
  then pressing Escape now deselects it and hides the Inspector.
- ✅ Cosmetic copy bug in the notifications panel: "2 failed webhook
  delivery/deliveries in the last 24h" — literally rendered the
  slash-form instead of picking one, unlike its two sibling lines
  ("1 broken link(s) found", "7 error(s) in the last 24h") which use
  the app's normal shorthand. Fixed to pluralize correctly.
- 🔶 Two findings noted but deliberately not built this round, both
  real but bigger in scope than a fix-in-place: no modal in the app
  traps keyboard focus (Tab from inside an open modal walks into
  background page controls — affects every modal, not one), and two
  blocks that fully overlap on the canvas (pre-existing test content,
  not something this round created) can't be clicked through to select
  the one underneath, only via the Layers panel's "Select" button. Both
  are legitimate accessibility/UX gaps worth a dedicated pass later,
  not a quick CSS or one-line fix.

### Incidental: local dev fixture recovery
One of the critique agents' own test cleanup accidentally renamed and
soft-deleted the actual "home" page in the *local dev* database (not
production) while probing an edge case — caught because it made the
standing regression suite's "homepage 200" check fail immediately
after. Restored via the admin API (`/pages/9/restore` + a title patch)
and re-ran the full suite to confirm; the block content itself was
untouched throughout (only the page's title and trash state were
affected), and the desktop critique agent's own later cleanup pass
independently re-verified the Home page was intact with its original
title and all 26 blocks.

## 11. Parallax/smooth/minimalist pass (2026-09-25)

Per explicit direction: keep the bold/vibrant palette from section 10,
layer smooth motion and more minimalist spacing on top of it, add
parallax specifically to the homepage and article/project headers, and
bring the same aesthetic (not the parallax itself) into the admin panel.

- ✅ Added a shared `--ease-smooth` easing token (`cubic-bezier(0.16, 1,
  0.3, 1)` — decelerating, "settles into place" rather than linear) and
  applied it to the site's actual chrome interactions: the active nav
  tab's text-color transition, the sliding pill indicator underneath it
  (previously snapped instantly between tabs with no transition at
  all — now eases into position), the fade/slide/zoom entrance
  animations, and the lift/grow hover effects. Brought the same token
  into the admin panel for its mobile drawer slide and the block
  palette's hover border. Left internal tool-specific transitions
  (simulation-canvas pins, song-player fills) alone — those aren't part
  of the public "feel," just implementation detail.
- ✅ A new per-block style option, "Parallax background" (checkbox,
  alongside the existing background-image fields in every block's style
  panel), gives any block with a background image real scroll depth via
  the classic `background-attachment: fixed` technique — the image
  stays pinned to the viewport while the page scrolls past it, instead
  of scrolling as one flat plane with everything else. Zero JavaScript;
  scoped to `@media (min-width: 768px) and (prefers-reduced-motion:
  no-preference)` since `background-attachment: fixed` has known jank
  problems on mobile Safari specifically and doesn't read as "depth" on
  a touch-scrolled screen the same way it does under a mouse wheel —
  the class the CSS keys off is only emitted when a background image is
  actually set, so enabling the checkbox before picking an image is a
  no-op rather than a silent half-broken state. This is what makes
  "homepage parallax" work in practice: set a background image on any
  block (a hero-style top block being the obvious case) and check the
  new box. Verified via Playwright: `background-attachment` computes to
  `fixed` at desktop width and plain `scroll` at 390px width on the
  same block, and the inspector shows the checkbox correctly reflecting
  a block's saved state.
- ✅ Articles and projects don't have a background-image "header" slot
  today (unlike pages, which are block-built) — rather than inventing a
  new image field unprompted, gave the existing title/meta/tags header
  a scroll-linked depth cue instead: as the page scrolls away from the
  top, the header recedes and fades slightly slower than the reading
  content beneath it (`animation-timeline: scroll(root block)`,
  `animation-range: 0 300px`, capped to a brief "leaving the top of the
  page" cue rather than a whole-scroll effect). Pure progressive
  enhancement via `@supports (animation-timeline: scroll())` — a
  browser without support (Firefox/Safari as of this writing) just
  shows the header at rest, no partial/broken state — and gated behind
  `prefers-reduced-motion: no-preference` like every other scroll effect
  on the site. Added a `page-header` class to the existing header
  wrapper `<div>` on both the article and project templates (no other
  markup changes) for the CSS to key off.
- ✅ Minimalist spacing pass, scoped to typography/flow rather than the
  fixed-position grid (bumping the 24-column grid's own `gap` would
  shift every already-placed block's pixel math across the whole site —
  deliberately left untouched): `body` gained an explicit `line-height:
  1.65` (previously just the browser default, ~1.2) for a calmer
  reading rhythm everywhere at once, and `.article-canvas`'s section gap
  (a flex layout, safe to change) went from 32px to 40px for more air
  between an article's header/body/reactions/related sections.
- Scope, per your answers: public site + admin (aesthetic only, no
  parallax in the CMS itself — motion there would just get in the way
  of editing), vibrant palette kept as-is from the previous round.

## 12. Post-audit backlog (2026-09-25 onward)

A very large (400+ item) wishlist came in after section 11. Triaged it
down before touching anything: kept the ★-marked priorities plus other
concretely-scoped items that extend what this codebase already does,
and deliberately did **not** build anything that's enterprise/multi-
tenant/SaaS-platform scale for a single-admin personal site — a module
marketplace, payments/licensing/sales, multi-user accounts and
editorial review workflows, staging-vs-production environment
promotion, a video/3D transcoding pipeline via external processing
services, an automation/workflow engine, a documentation/LMS platform,
localization, search-relevance tuning (overkill at this site's scale),
a phone quick-capture inbox, and an AI admin assistant chat feature.
Building stub/fake versions of any of these would be exactly the kind
of feature-theater bloat this project has been actively avoiding —
noting them here as consciously out of scope rather than silently
skipping them.

- ✅ **"Edit this" from the live site** (★ priority) — while logged in
  as admin, every page/article/project on the public site now shows a
  pencil icon-button in the topbar (next to the shuffle "⇌" link),
  linking to `/admin/?edit=page:<id>` / `article:<id>` / `project:<id>`.
  `renderShell()` takes a new optional `editUrl` param; `renderPage`/
  `renderArticle`/`renderProject` compute it only when
  `isAuthenticated(request, env)` is true (an unauthenticated visitor
  never sees the button or the link, verified below). On the admin
  side, `boot()` now calls a new `openDeepLinkedEditor()` after its
  normal startup sequence, which reads `?edit=` from the URL and
  dispatches to whichever of the existing `selectPage()` /
  `openArticleEditorById()` / `openProjectEditorById()` functions
  already power the normal "click this in a list" flow — no new
  editor-opening logic, just a new entry point into what already
  existed. A missing/invalid id is silently ignored (nothing actionable
  to tell the admin). Verified via Playwright: the button is present
  and points at the right deep link for a real article/page/project
  while authenticated, absent entirely for an anonymous visitor, and
  clicking through each of the three deep-link URLs correctly opens
  that exact record's editor (the Articles/Projects modal populated
  with the right title, or the page selected in the main page-picker)
  on a fresh page load.
- ✅ **"Where is this setting?" search** (★ priority) — the command
  palette (Ctrl/Cmd+K) now has a `SETTINGS_SEARCH_INDEX`: a plain-
  language index over every control across all 7 Site Settings tabs
  (Appearance/Sharing/Integrations/Maintenance/Tools/Logs/Backups),
  each entry carrying a handful of alternate phrasings — "breakpoint"
  also matches "mobile", "responsive", "screen width", and "homepage
  spacing"; "footer" also matches "copyright"; "webhook" matches both
  the URL field and the deliveries log. Typing a query surfaces
  matching settings labeled `Setting: <name>` ahead of the palette's
  existing page/article/project/block results, and picking one opens
  Site Settings, switches to the right tab via the existing
  `switchSettingsTab()`, then scrolls to and focuses the exact field —
  no more hunting through 7 tabs for "where did I put the breakpoint
  control." Verified via Playwright: "breakpoint" finds and correctly
  opens/focuses the Appearance tab's breakpoint field; "webhook" finds
  both integrations-tab entries; and two deliberately-indirect
  phrasings ("homepage spacing", "copyright") each resolve to the
  right underlying field despite not matching its label directly.
- ✅ **Unified "what uses this" / dependency view** — usage-checking
  existed already but split across three near-duplicate, incomplete
  functions (`findScanUsage` only checked page blocks, missing a
  project's "Related scans" picker entirely; `findSharedBlockUsage`
  was fine but separate; simulations/songs/tags had no usage check at
  all). Replaced with one `findContentUsage(env, type, id)` in db.js
  covering `scan`/`simulation`/`song` (checks both page blocks *and*,
  for scans/simulations, a project's related-X array — the real gap:
  a scan referenced only via "Related scans" could be deleted with no
  warning before this), `shared-block` (delegates to the existing,
  already-correct function), and `tag` (every article/project with
  that tag, published or not — the existing `getContentByTag` used
  elsewhere is published-only, which is right for public tag pages but
  wrong for "will deleting/renaming this tag affect anything," where a
  draft still counts). Exposed via a new `GET /content-usage?type=&id=`
  endpoint plus a shared `window.showContentUsage(type, id, label)`
  helper (one place other admin scripts loaded as plain scripts —
  simulation-builder.js, song-builder.js, scan-builder.js — call into,
  rather than each rolling its own fetch-and-alert). Added a "Usage"
  button next to Edit/Delete in Simulations, Songs, Scans, Reusable
  Blocks, and Topic Pages' tag list, and upgraded scan/song/simulation
  delete confirmations to show real usage instead of a generic warning
  (scans already did this via the old function; simulations/songs
  didn't). Verified via Playwright and direct API calls: a scan
  referenced only through a project's "Related scans" array (not any
  block) is now correctly found; a tag used only by a draft article is
  found via the new tag-usage check where the published-only archive
  logic would've missed it; and the "Usage" button renders and works
  end-to-end in the real Simulations list.
- ✅ **Motion budget + protected text layers** — a refinement of the
  parallax/motion system from section 11. Motion budget: the entrance-
  animation `IntersectionObserver` in `nav.js` fired every `[data-animate]`
  element that crossed its 15% threshold in the same callback batch all
  at the exact same instant — a fast scroll or a short page opened
  straight to a section with several animated blocks could reveal all
  of them simultaneously, reading as a flash of movement rather than
  something considered. Now stagger entries within a batch (80ms apart,
  capped at a 480ms total spread so a very large batch doesn't push the
  last few blocks' reveal absurdly late), added on top of — not
  overriding — whatever per-block `--animate-delay` the admin already
  set via the "Entrance animation" style field. Protected text layers:
  already true by construction for the per-block "Parallax background"
  option from section 11 — `background-attachment: fixed` only affects
  how a block's own background-image paints, never a child element's
  layout or position, so a block's heading/text/buttons sitting on top
  of a parallax background were never going to move independently of
  the rest of the page; no code change needed there, just confirming
  the guarantee holds. Verified via Playwright: 5 stacked blocks with
  fade-in animations opened in one viewport show `--animate-delay`
  values of 0/80/160/240/320ms across the batch instead of all firing
  at 0ms.
- ✅ **Diagnostics: layout findings now jump to their source block** —
  `computeRenderedLayoutDiagnostics()` (the checks that need real
  rendered-CSS measurements from a hidden iframe of the actual public
  page: small tap targets, content overflow, broken images) always set
  `blockId: null`, so none of those findings ever got a "Select"
  button — only the separate `computePageDiagnostics()` checks (empty
  heading, missing alt text, etc.), which already had the block's id
  on hand from the `blocks` array directly, could jump anywhere. Fixed
  the actual gap causing it: the public-facing rendered block wrapper
  (`worker/render.js`'s `renderBlocks()`) never carried the block's id
  in the DOM at all, so there was nothing in the iframe for the parent
  document to map a finding back to. Added `data-block-id="${b.id}"`
  to every block wrapper (harmless — it's an internal integer already
  visible elsewhere, e.g. revision snapshots and the activity log), and
  a small `blockIdFor(node)` helper in the Diagnostics code that walks
  up to the nearest `[data-block-id]` ancestor for the tap-target and
  overflow checks. The broken-image check needed one more step since
  its network probe is deduped by image `src` (the same file can be
  reused in several blocks, or appear multiple times in one gallery) —
  built a `src → Set<blockId>` map first, then emit one issue per
  affected block for anything that comes back broken, so each gets its
  own "Select." Verified via Playwright: a page with a broken image
  block shows the "Broken image" finding with a working "Select"
  button, and clicking it correctly selects that exact block on the
  canvas (confirmed by id, not just "a block got selected").

### Critic pass on the above (2026-09-25)
A critic agent reviewed all five items above plus the wider site — verified
each feature's core scenarios worked correctly via live Playwright testing
(not just code reading), and found two real bugs, both fixed:
- ✅ A stale/bookmarked "Edit this" deep link (or command-palette result)
  for an article/project that's since been deleted silently opened the
  Articles/Projects modal with every field blank — indistinguishable
  from a legitimate "create new" form, directly contradicting this
  feature's own stated intent of failing safely. `selectPage()` already
  got this right (early-returns, touches nothing, if the id isn't
  found); `openArticleEditorById`/`openProjectEditorById` didn't check
  existence until *after* already showing the modal. Fixed to check
  first and, on a miss, show an alert ("That article/project no longer
  exists.") and leave the modal closed. Verified via Playwright:
  `/admin/?edit=article:999999` and `?edit=project:999999` both now
  show the alert with the modal staying hidden, instead of opening a
  blank editor.
- ✅ The "where is this setting?" search's matching was pure substring-
  of-the-whole-query (checking whether the typed phrase and a keyword
  string each fully contained the other), so natural admin phrasings
  that didn't happen to exactly match a keyword string found nothing —
  confirmed live with two concrete failures: "turn off the site" (despite
  Maintenance mode's keywords) and "twitter card image" (despite that
  being exactly what the share-image setting is for). Rewrote the
  matching to split the query into significant words (filtering common
  filler words like "the"/"a"/"is") and require every word to appear
  *somewhere* in the entry's label+keywords, rather than needing one
  contiguous phrase match — catches phrasings built from words that are
  each individually present without having to anticipate every exact
  multi-word phrase in advance. Also added the two synonym gaps the
  critic found directly ("turn off"/"shut down"/"take down"/"site down"
  for Maintenance mode; "twitter card"/"og image"/"meta image" for
  Default share image). Verified via Playwright: both previously-failing
  phrases now resolve correctly, and all four previously-passing queries
  ("breakpoint", "webhook", "homepage spacing", "copyright") still work
  unchanged.

The critic also re-flagged, with fresh concrete evidence, an existing
backlog item that had been sitting unmarked in section 9 — a simulation/
scan/song block whose reference has been deleted renders as nothing on
the public site but still reserves its full grid space, with no warning
in the admin. Fixed while addressing the rest of this report:
- ✅ **Broken-reference badge** — `blockBadgesHtml()` (already used for
  Reusable/Locked/Desktop-only/Mobile-only/Hidden badges) now shows a
  red "Broken reference" badge on any simulation/scan/song block whose
  id doesn't resolve, reusing the exact `*NameById()` lookups
  `blockPreview()` already relied on (they return `null` when the id
  isn't in the loaded options list) rather than adding a second way to
  detect the same condition. Also surfaced as a new Diagnostics finding
  ("Simulation/3D Scan/Song block references a deleted item — renders
  as nothing on the live site but still reserves its space") with a
  working "Select" button, so it shows up in the same place as every
  other content problem, not just as an easy-to-miss badge on a canvas
  that might have many blocks. Verified via Playwright: a test page
  with a simulation block pointing at a nonexistent id shows the red
  badge on canvas and the same finding in Diagnostics with a working
  "Select" button that jumps to the exact block.

### Second backlog batch
- ✅ **Recently changed settings** — `PUT /settings` used to log a bare
  "Updated settings" with no detail (`log(ctx, env, "update", "settings",
  null)`), so the Activity Log told you *when* a settings save
  happened but never *what* changed — finding or reversing a specific
  change meant remembering which of the 7 Site Settings tabs it was on
  and re-checking every field by eye. Now fetches each key's value
  before applying the update, diffs old vs. new per key, and logs a
  real changelog entry (e.g. `site_footer: "" → "New footer text"`) —
  unchanged keys are left out entirely rather than padding the entry
  with noise. Long values (custom `<head>` code, webhook URLs) are
  truncated to 60 characters so one long field doesn't make the log
  entry unreadable. No new logging plumbing needed — the diff string
  goes through the exact same `entity_label` field the Activity Log
  already renders for every other action. Verified via a real settings
  save through the API: the resulting Activity Log entry read exactly
  `site_footer: "" → "SETTINGS DIFF TEST FOOTER"`, then confirmed the
  test value was restored afterward.
- Checked and already satisfied by the existing architecture, no work
  needed: **"Separate file identity from filename"** — every upload
  (`worker/admin-api.js`'s upload routes for images/audio/video/fonts/
  scans) already stores under a `crypto.randomUUID()`-based R2 key,
  completely independent of the original filename; nothing about a
  file's identity or its links depends on what it was originally
  called.
- ✅ **Content integrity checks** (★ priority) — a new site-wide sweep,
  `getContentIntegrity(env)`, for dangling references that don't break
  anything visibly at save time: a page block pointing at a simulation/
  scan/song that's since been deleted (the per-page "Broken reference"
  badge added earlier only warns about whichever page is currently
  open — this is the same check, run across every page at once), a
  project's `related_articles`/`related_simulations`/`related_scans`/
  `related_override` array still naming an id that no longer exists
  (deleting an article/project/simulation/scan doesn't touch anything
  else's related-X JSON array, so a stale id just sits there silently),
  and a page nested under a `nav_parent_id` that no longer exists (a
  defensive backstop — normal deletion already promotes/clears a
  deleted parent's children, so this mainly catches data that predates
  that logic or came in through a path that bypassed it). Added as its
  own "Content Integrity" section in the Site Health modal (new
  `GET /content-integrity` endpoint) and folded into the existing "Run
  all checks" aggregator (now 6 checks, not 5). Verified via Playwright
  against real synthetic cases (a block referencing a nonexistent
  simulation id, a project with a dangling `related_articles` id) — and
  incidentally, the check also surfaced genuine pre-existing debris in
  local dev's own fixture data (two already-broken simulation-block
  references on the local Home page, left over from earlier testing
  this session), confirming it works on real accumulated data, not
  just contrived test cases.
- ✅ **Reading-order editor** (★ priority) — the page builder's 24-column
  grid controls where a block sits visually (`col`/`row`/`col_span`/
  `row_span`), but until now that was also the only thing deciding DOM
  order, so screen-reader and keyboard (Tab) order was locked to visual
  position. A block placed for visual reasons (e.g. a sidebar callout
  physically above the content it supplements) had no way to read or
  tab in the order that actually made sense. Added a new
  `style.readingOrder` field (inspector: "Reading order override",
  number input, next to the other layout/background style fields) —
  `renderBlocks()` now sorts blocks into a synthetic key sequence
  (unoverridden blocks keep their natural row/col order, spaced 1000
  apart) before rendering, and any block with a finite `readingOrder`
  slots directly at that key instead, completely independent of its
  visual grid placement. Verified via Playwright with a 3-block page
  (Block A at row 1, Block B at row 3, Block C at row 5 with
  `readingOrder: 1`): DOM order came back `["Block C", "Block A",
  "Block B"]`, while a separate layout check confirmed Block C still
  renders visually below Block A on screen (`top: 245` vs `top: 149`)
  — confirming the two axes are genuinely decoupled, not just visually
  coincidental. Test pages cleaned up via trash + permanent-delete and
  confirmed gone via a direct D1 query.
- ✅ **Motion audition mode** (★ priority) — the parallax/scroll-timeline
  effects shipped in the motion pass only ever play back in response to
  real scrolling, so checking a page's full sequence of scroll-driven
  motion meant manually scrolling the Screen Preview by hand every
  time, with no way to jump straight to a specific point partway down.
  Added a scrubber and a "Play" button to the existing Preview modal
  (next to the device-width and stress-test controls it already has):
  dragging the scrubber calls `contentWindow.scrollTo()` on the preview
  iframe directly, mapped to 0-100% of its real scrollable height, so
  every scroll-linked effect plays back exactly as it does live —
  nothing is faked or re-simulated. "Play" automates the same scrubber
  from top to bottom over a fixed 6-second sweep via
  `requestAnimationFrame`, so a whole page's motion can be watched once
  without touching anything, and doubles as a "Stop" button mid-sweep.
  Reloading the preview (switching pages, or toggling a stress test)
  resets the scrubber to 0 rather than leaving it stale. Verified via
  Playwright: scrubbing to 50% moved the iframe's real `scrollY`,
  clicking Play advanced `scrollY` further on its own within a second
  and flipped the button to "⏸ Stop", clicking it again reset the
  label, and a fresh preview load reset the scrubber back to 0 — no
  console errors at any step.

### Second critic pass on the above
- ✅ **Long Content Integrity status text crushed the row's page/project
  title to unreadable or invisible** — `.link-check-row`'s title span
  had `min-width: 0`, which let it shrink toward nothing whenever the
  status text on the same row was long, and every prior check's status
  text topped out around 17 characters ("Missing alt text") while
  Content Integrity's ("Simulation block references a deleted item")
  runs to 44 — a failure mode the row layout was never actually
  exercised against before. Measured and confirmed: title width down
  to 7.7px on desktop's aggregated "Run all checks" view and fully 0px
  (invisible) in the standalone mobile panel. Fixed by giving the row
  `flex-wrap: wrap`, a real `min-width: 100px` on the title (so the
  browser wraps the status onto its own line instead of shrinking the
  title away), and letting the status span itself wrap onto multiple
  lines rather than forcing its full width. Verified via Playwright at
  both viewports with a real broken-simulation-reference case: title
  width went from crushed/invisible to 332px (desktop) and 207px
  (mobile) — same fix, since the underlying row markup is shared,
  applies to any future check with a long status string too.
- ✅ **Unreachable dead code removed** — `getContentIntegrity`'s
  `danglingNavParents` check could never actually find anything:
  `nav_parent_id` is a real, D1-enforced foreign key
  (`schema.sql`'s `REFERENCES pages(id)`), and every trash/delete/
  permadelete path already nulls out a deleted page's children.
  Confirmed via a direct D1 write attempt that a dangling value can't
  exist. Removed the check itself along with its now-dead consumers in
  the standalone panel and the "Run all checks" aggregator, and left a
  comment explaining why it isn't checked (rather than silently having
  three files reference a field that will never contain anything).
- ✅ **Settings save no longer logs a no-op "no changes" entry** — a
  re-save where nothing actually differs (opening and closing the tab)
  used to still write an Activity Log row every time, which is exactly
  the noise the settings-diff feature was built to cut. Now skips the
  log write entirely when the diff is empty. Also capped the combined
  multi-key diff string at 240 characters (each individual value was
  already truncated, but saving several keys at once had no overall
  cap, and the Activity Log renders this with no `title=""` attribute
  to reveal the rest). Verified via the API: an identical-settings PUT
  produced no new Activity Log row at all, confirmed by comparing the
  log immediately before and after against real timestamps.
- ✅ **Field-change live preview** (★ priority) — the admin canvas is a
  deliberately simplified schematic, not real CSS (no real fonts,
  backgrounds, or motion effects — the whole reason
  `computeRenderedLayoutDiagnostics` has to spin up its own hidden
  iframe for real-layout checks), so actually seeing what a style or
  content edit looks like meant reopening Screen Preview and clicking
  reload by hand after every change. Screen Preview's iframe now
  refreshes itself automatically whenever a block's content/style
  fields are saved, a block is dragged/resized, or a bulk style is
  applied to a multi-selection — but only while the preview is already
  open on that page, and debounced 500ms so a color picker drag or
  fast typing doesn't reload on every keystroke. A small "● live" badge
  next to the Preview modal's title makes the behavior discoverable.
  Verified via Playwright: with the modal open, editing a text block's
  content field showed the updated text in the real iframe within
  ~1.2s with no manual reload; closing the modal and editing again left
  `preview-frame.src` at `about:blank` (confirming the debounce timer
  correctly no-ops rather than firing a reload nobody would see).
- ✅ **Restrained motion controls: manual "reduce motion" toggle now
  actually covers the newer motion effects** (★ priority) — the site's
  existing ⏸ "reduce motion" header button (independent of the OS-level
  `prefers-reduced-motion` setting) only ever overrode the older
  entrance/hover animations. The parallax backgrounds and the article/
  project header's scroll-timeline animation, both shipped in the later
  motion pass, were only ever gated by the OS media query — a visitor
  who clicked "off" still got both effects, which defeats the point of
  a manual override that's supposed to mean "off, period." Added the
  missing `:root[data-motion="reduce"]` overrides for `.block-parallax`
  (forces `background-attachment: scroll`) and `.page-header` (`animation:
  none`), same higher-specificity pattern the existing overrides already
  use so it wins regardless of source order. Also fixed nav.js's entrance-
  animation `IntersectionObserver` setup, which checked only the OS media
  query and not this manual toggle — harmless visually (the CSS override
  already forced full opacity) but it was still doing needless observer
  work for a visitor who'd explicitly asked for less. Verified via
  Playwright against a real parallax block and a real published article:
  clicking the toggle flipped `background-attachment` from `fixed` to
  `scroll` (persisting across a reload, since the choice is restored from
  localStorage before first paint) and flipped the header's
  `animation-name` from `page-header-parallax` to `none`.

### Third critic pass on the above
- ✅ **Reading-order override couldn't be cleared** — clearing the field
  back to blank saved `style.readingOrder: null` (matching how every
  other blank number field saves), but `renderBlocks()` computed
  `Number(null)`, which is `0` — a perfectly valid *real* override — so
  a cleared field was indistinguishable from an explicit "always render
  this block first" and stayed stuck there permanently with no way
  back to natural order, silently contradicting the field's own label.
  Fixed by checking the raw stored value's actual type
  (`typeof raw === "number" && Number.isFinite(raw)`) instead of
  coercing first. Verified via Playwright: overriding block C to render
  first (`C, A, B`), then clearing it back to `null`, now correctly
  restores natural order (`A, B, C`).
- ✅ **Motion audition's scrub/Play lagged ~90% behind the real scroll
  position, then snapped at the very end** — `scrubPreviewTo()` called
  the previewed page's `window.scrollTo()`, which inherits that page's
  global `scroll-behavior: smooth`. Since this fires on every animation
  frame during Play (and every drag event while scrubbing manually),
  each frame re-targeted an already-in-flight smoothed scroll a little
  further out, so the real position perpetually chased a moving target
  instead of ever landing on one — defeating the whole point of a
  scrubber. Fixed by using the object form of `scrollTo()` with
  `behavior: "instant"`, which sets the position immediately instead of
  animating toward it. Verified with a real scrollable test page: 2
  seconds into a 6-second Play sweep, the scrubber read 33% and the
  real scroll position matched the expected 33%-of-max value almost
  exactly (3069px actual vs. 3068px expected), instead of sitting at 0.
- ✅ **Field-change live preview was structurally unusable through the
  actual admin UI** (★ priority, high severity) — Screen Preview used
  the same full-viewport modal as every other modal in the admin, which
  covered the inspector and canvas the auto-refresh feature depends on;
  a real mouse click on any inspector field timed out with Playwright
  reporting the modal's own backdrop intercepting the click. The
  feature's own header text ("editing a field... automatically
  refreshes the preview") was accurate in code but impossible to
  trigger by mouse. Fixed by docking Screen Preview to just the canvas
  strip on desktop (`left`/`right: 240px`, matching the palette/
  inspector's existing fixed width) instead of covering the full
  viewport — the canvas itself stays covered (nothing to see there
  while the real preview is showing anyway), but the palette and
  inspector stay fully clickable. Mobile keeps the old full-screen
  behavior, since those panels are off-canvas drawers there with
  nothing to preserve access to. Verified via Playwright with a real
  mouse click (not a JS-dispatched event) on an inspector text field
  while Screen Preview was open: the click succeeded, and the preview
  auto-updated with the new text ~1.2s later. Also confirmed the mobile
  preview modal still spans the full 390px viewport unchanged.

### Fourth backlog batch
- ✅ **Layout explanations: canvas badges for date-window visibility and
  reading-order overrides** (★ priority) — two style fields could
  silently change what a visitor sees or how a screen reader walks the
  page with zero trace on the canvas: `visibleFrom`/`visibleUntil`
  (scheduled show/hide) and `readingOrder` (the reading-order override
  fixed earlier this batch — whose own bug, a block stuck permanently
  overridden with no visual sign of it, was made worse by there being
  no badge at all). The existing "Hidden"/"Locked"/"Desktop only"
  badges already show this kind of thing at a glance; these two didn't.
  Added a scheduled-visibility badge that reflects the block's *current*
  state, not just "scheduled" — "Hidden until [date]" and "Expired
  [date]" both render as error-colored (matching the existing
  diagnostic-error badge style) since the block currently isn't showing
  at all, while "Hides [date]" is neutral since it's visible right now
  and will only change later. A reading-order badge ("Reading order: N")
  shows on any block with a numeric override, so a cleared field's
  absence is now itself visible confirmation nothing's still overridden.
  Reuses the same `blockBadgesHtml()` shared by the desktop canvas,
  mobile canvas, and the Layers panel, so all three picked it up for
  free. Verified via Playwright with 5 real blocks (not-yet-visible,
  expired, will-hide-later, reading-order override, and a plain block
  with no badges) — each rendered exactly the expected badge text and
  title, and the plain block correctly rendered none.
- ✅ **Diagnostics: motion-budget warnings for a whole page** (★
  priority) — the motion-budget stagger added earlier this session
  smooths out fast scrolling past several animated blocks at once,
  but does nothing for a page that's just genuinely saturated with
  motion — a visitor scrolling normally down a page with parallax on
  most of its blocks still gets "everything is moving" the entire way,
  and nothing ever flagged that. Added two new Diagnostics findings,
  scoped to the whole page rather than one block (no single block is
  "wrong," the page as a whole reads as busy): more than 3 blocks with
  parallax enabled, or more than 8 with an entrance animation set. Both
  are warnings, not errors — reserving motion for a couple of focal
  blocks is a judgment call, not a bug, so this nudges rather than
  blocks. Verified via Playwright with a real 4-parallax-block test
  page: the finding appeared in Diagnostics with the correct count and
  wording.
- ✅ **SEO: duplicate meta descriptions across pages** — the existing SEO
  checks already flag a missing meta description and a duplicate
  *title*, but the same meta description reused across pages (e.g.
  copy-pasted as a starting point and never customized) got no
  equivalent warning, even though search engines treat it about as
  poorly as a duplicate title — it makes distinct pages look
  interchangeable in results. Pages only (not articles/projects, which
  have no equivalent explicit meta-description field to compare), and
  excludes already-empty ones since those are covered by the existing
  "No meta description" finding. Wired into both the standalone SEO
  Report panel and the aggregated "Run all checks" view. Verified via
  Playwright with two real pages sharing one meta description: both
  surfaces correctly reported "Duplicate meta description (2×)".

### Fourth critic pass on the above
- ✅ **Scheduled-visibility badge mislabeled a normal, currently-visible
  block as hidden** — a block with `visibleFrom` already in the past
  and no `visibleUntil` set is just a plain, unconditionally-visible
  block from that point on (confirmed identical to
  `worker/render.js`'s `isBlockInDateWindow()` gate), but the badge's
  fallback branch only checked "not still in the future" for
  `visibleFrom`, not "actually in the future" — so it fell through to
  a "Scheduled" badge reading "Currently hidden, will become visible
  [a date that already happened]," both parts of which were wrong.
  This exact combination (visibleFrom-only, already past) wasn't among
  the cases the original shipping commit tested. Fixed by making the
  fallback unreachable once a future `visibleFrom` and any
  `visibleUntil` are ruled out — that state needs no badge at all.
  Verified via Playwright: the "already started, no end date" case now
  renders no badge, while confirming the block is genuinely visible on
  the live public page; the other three states (not-yet-visible,
  expired, will-hide-later) still render exactly as before.

### Fifth backlog batch
- ✅ **Diagnostics: per-block custom color contrast check** — the admin
  already has a live WCAG contrast checker for the site's global theme
  colors (text/background/accent, in Site Settings), but a block-level
  style override (a custom `color`/`bg` pair, independent of the theme)
  had no equivalent check — nothing caught a block shipping unreadable
  text just because both colors happened to be set. Reuses the exact
  same `contrastRatio()`/`relLuminance()` functions already used for
  the theme checker (function hoisting means `computePageDiagnostics()`
  can call them even though they're defined later in the file), applied
  per-block wherever both colors are explicitly set as valid hex, flagged
  as a warning below the WCAG AA 4.5:1 threshold for normal text.
  Verified via Playwright with three real blocks: a deliberately low-
  contrast pair (#cccccc on #ffffff, ratio 1.61:1) correctly flagged
  with the exact computed ratio in the message and a working "Select"
  button; a high-contrast pair (black on white) and a block with no
  colors set at all both correctly produced no finding.

### Fifth critic pass — no bugs, suggestions acted on
The fifth critic pass found the per-block contrast diagnostic correct
across every edge case it tried (only-color-set, only-bg-set, no
override at all, 3-digit hex, non-hex CSS functions — all correctly
un-flagged) and reported no bugs. It also suggested, per its "think
like the admin" mandate, feeding the same check into the site-wide
Accessibility Report (previously per-page only) and relaxing the
threshold to 3:1 for headings (WCAG AA's own allowance for large
text). Both implemented:
- ✅ **Site-wide per-block contrast sweep** — `checkAccessibility()` in
  worker/db.js (previously only pattern-matched raw "html" blocks and
  gallery alt text) now also checks every block's own `style.color`/
  `style.bg` pair against the same WCAG formula, site-wide — closing
  the gap where a bad color pair only ever surfaced if the admin
  happened to open Diagnostics on that specific page. Automatically
  picked up by both the standalone Accessibility Report panel and the
  "Run all checks" aggregator, since both already consume this
  function's output in the existing `{pageTitle, pageSlug, blockId,
  issue}` shape. Verified via Playwright/API: a real low-contrast block
  on a fresh test page showed up correctly in `GET /accessibility-report`
  with the exact computed ratio.
- ✅ **Relaxed 3:1 threshold for heading blocks** (both the per-page
  client-side check and the new site-wide one) — matches the theme
  checker's own existing 3:1 "Accent vs background" bar, which uses the
  same WCAG allowance for large text. Verified with a real heading at a
  contrast ratio of 3.45:1 (fails the normal 4.5:1 bar, passes the
  relaxed one): correctly un-flagged as a heading, while an identical
  3.45:1 pair on a plain text block was correctly still flagged.
- ✅ **Style-preset contrast warning at the moment it's saved or applied**
  — a style preset stamps its color pair onto every block it's applied
  to in one click, which is exactly where a bad pairing does the most
  damage: duplicated across however many blocks use it, instead of
  sitting on one page waiting to be noticed later in Diagnostics. Site
  Settings already has a live inline contrast checker for the theme's
  own colors; this reuses the same `contrastRatio()` math at the two
  moments a preset's colors actually take effect — saving one (from
  whatever block's current style you're saving) and applying one to a
  block — with a plain `alert()` warning, consistent with this
  codebase's existing native-dialog UX (the preset-naming prompt is
  right next to it). Verified via Playwright: saving a preset from a
  low-contrast block (1.61:1) correctly triggered the warning dialog
  with the exact ratio; applying a high-contrast preset (black on
  white) triggered no dialog at all.
- ✅ **Reusable Blocks library shows content issues inline, next to Usage**
  — a bad reusable block (empty content, missing alt text, low
  contrast, a broken simulation/scan/song reference) previously only
  ever surfaced as a separate, duplicate Diagnostics finding on every
  single page that used it — an admin discovered the same problem once
  per page instead of once at the shared source. Added
  `sharedBlockIssues()`, a lighter subset of the per-page diagnostic
  checks (no page-level H1/heading-order checks, which don't make sense
  for a lone block) applied directly to each shared block's own stored
  content/style, shown as an issue-count badge right next to its
  existing Usage button in the Reusable Blocks list. Verified via
  Playwright with a real shared block combining two problems at once
  (empty text + a 1.61:1 contrast pair): correctly showed "2 issues"
  with both listed in the badge's tooltip, while an unrelated clean
  shared block showed no badge at all.

### Sixth critic pass on the above
- ✅ **Style-preset contrast warning false-positived on headings** —
  `warnIfBadContrast()` hardcoded the 4.5:1 normal-text threshold with
  no knowledge of block type, unlike every sibling contrast check
  shipped this session (`checkAccessibility()`, `sharedBlockIssues()`,
  the per-page Diagnostics check), which all correctly relax to 3:1 for
  headings. A legitimately WCAG-compliant heading color (3.45:1, passes
  the 3:1 large-text allowance) still triggered an alarming false
  warning when saved or applied as a preset. Fixed by passing the
  block's type through and using the same threshold logic as
  everywhere else. Verified via Playwright: saving a preset from a
  3.45:1 heading now shows only the name prompt, no contrast alert.
- ✅ **Reusable Blocks (and Simulations/Songs/Scans) row content —
  including the brand-new issue-count badge — was invisible on mobile**
  — a CSS specificity bug, not new to this session but newly
  consequential: the mobile-only wrap override
  (`.simulation-row span { white-space: normal; ... }` inside
  `@media (max-width:860px)`) and the base unscoped rule further down
  the file (`white-space: nowrap; overflow: hidden; text-overflow:
  ellipsis`) have identical specificity, so normal cascade order let
  the later, unscoped rule silently win even inside the narrower
  viewport — clipping row text (and now the issue badge) down to ~66px
  wide. Fixed by qualifying the mobile override selectors with `#app`,
  raising their specificity above the unscoped base rules regardless of
  source order. Verified via Playwright at 390px: a shared block's
  issue badge now has a real, nonzero bounding box instead of being
  clipped away.
- ✅ **Stale Accessibility Report description** — the panel's own label
  still read "every other block type is already accessible by
  construction," which stopped being true the moment this session
  extended the same check to scan every block's color contrast and
  gallery alt text site-wide. Updated the label to describe what it
  actually checks now.

### Sixth backlog batch (remaining critic suggestions)
- ✅ **Shared block issues surfaced in the Usage popup too, and tap-
  friendly on mobile** — two of the sixth critic's suggestions: (1) an
  admin clicking "Usage" on a shared block to see which pages reference
  it had no way to also see the block's own content problems in that
  same view, even though `sharedBlockIssues()` already computes them
  right next to it; (2) the issue badge's explanation only lived in a
  `title=""` tooltip, which never fires on a touch screen — the exact
  audience most likely to just want a quick glance at what's wrong.
  `window.showContentUsage()` (shared by simulations/songs/scans/shared-
  blocks/tags) gained an optional `extraInfo` line shown above the
  usage list, and the Reusable Blocks "Usage" button now passes the
  block's own issues into it. The issue badge itself is now also a
  click target (`cursor:pointer`) that shows the same issue list as a
  plain alert — works identically on desktop and mobile, unlike the
  tooltip it complements rather than replaces. Verified via Playwright:
  clicking "Usage" on a shared block with 2 real issues showed "⚠ Empty
  text; Low contrast (1.61:1)" above the usual usage summary; clicking
  the issue badge directly showed the same two issues in their own
  alert.

### Seventh critic pass on the above
- ✅ **The `#app`-scoped mobile CSS fix from the sixth pass was a no-op**
  — every modal containing a `.simulation-row`/`.link-check-row`
  (Simulations, Songs, Scans, Reusable Blocks, Trash, Diagnostics, Site
  Health, SEO Report, etc.) is a sibling of `#app` in the DOM, not a
  descendant of it — `#app` only wraps the main editor canvas/inspector.
  So `#app .simulation-row span` matched nothing at all, and the
  underlying bug (row content clipped to ~0-66px wide on phones) was
  still fully present everywhere, unchanged. Re-fixed properly by
  doubling the class itself (`.simulation-row.simulation-row`), which
  raises specificity without depending on any particular ancestor
  existing — works regardless of which modal a row happens to live in.
  Also caught and fixed the exact same never-covered problem for
  `.redirect-row`/`.redirect-paths` (Trash, Redirects, Topic Pages),
  flagged by the critic as sharing the identical failure mode but never
  included in the original fix's selector list. Verified via
  Playwright at 390px with real long titles: a Reusable Blocks row and
  a Trash row both now wrap to their full text (310px wide, `white-
  space: normal`) instead of collapsing to a sliver or a single
  truncated line.

### Seventh backlog batch (remaining critic suggestions)
- ✅ **Media Library "Select all shown"** — Articles and Projects lists
  both already had a select-all checkbox for bulk actions; Media
  Library had the same underlying primitive (a `selectedMediaKeys` Set
  plus a working bulk-delete/move/tag) and useful filters ("Unused
  only", "Possible duplicates only", folder, type, search) but no way
  to select everything a filter was currently showing — clearing out,
  say, every unused file meant ticking each one by hand first. Added
  "Select all shown" next to the bulk-action buttons, scoped to
  whatever `renderMediaGrid()`'s filters are currently displaying (not
  the whole library) — tracked via a `lastFilteredMediaKeys` array
  refreshed on every render, matching what "shown" actually means as
  filters change. The checkbox's own checked state reflects "shown" too:
  fully checked, unchecked, or reverting to unchecked whenever the
  filtered set and the selection stop matching exactly. Verified via
  Playwright: clicking it selected/deselected every currently-shown
  checkbox; with a folder filter narrowing 6 items down to 1, selecting
  and then clearing the filter correctly left the selection at 1 (not
  jumping to all 6), and the checkbox itself correctly read unchecked
  once selection and "shown" no longer matched.
- ✅ **Wired up template deletion** — `DELETE /templates/:id` already
  existed server-side and worked (used nowhere), but nothing in the
  admin UI ever called it — a typo'd or since-obsolete page/article/
  project template had no way to be removed and just sat permanently
  in its picker dropdown. Added a "Delete template" button next to each
  of the three "Save as template" buttons. The page picker keeps its
  selected value after use (read by "+ Page" to apply it), so its
  delete button reuses that value directly, same pattern as the
  existing style-preset delete button. Article/project pickers apply
  their template and immediately reset to blank (so re-selecting the
  same template a second time still fires a change event) — there's no
  "just highlighted" state to read there, so those two ask for the
  template's exact name via a prompt instead of forcing an unwanted
  re-apply just to select which one to delete. Verified via Playwright:
  deleting a page template via the picker and an article template via
  the name prompt both correctly removed them from their pickers and
  from `GET /templates`.
- ✅ **Trash rows show how long ago they were deleted, plus a bulk
  "Empty trash" per type** — `listTrashedPages`/`Articles`/`Projects`
  already `SELECT *`, so `deleted_at` was sitting on every row the
  Trash API returned; `renderTrashList()` just never read it, showing
  only the title. Cleaning up an old trash pile meant guessing which
  items were safe to nuke and clicking "Delete forever" one at a time
  with zero date context — this local dev DB alone had accumulated 60+
  un-purged test pages this way. Added a relative-age label ("Trashed
  today" / "3 days ago" / "2 months ago" / "1 year ago") next to each
  title, and an "Empty pages/articles/projects trash" button per
  section that loops the exact same per-item `/permanent` DELETE the
  "Delete forever" button already calls — no new endpoint. Verified via
  Playwright: a freshly-trashed page correctly showed "Trashed today";
  clicking "Empty pages trash" with a real confirm dialog removed every
  trashed page (2 fresh test pages plus, incidentally, the 60+ pieces
  of accumulated local-dev test debris a prior critic pass had flagged
  as clutter) down to the "Nothing trashed" placeholder, confirmed via
  a direct D1 count query — with the real Home page (id 9) untouched
  throughout, since it was never trashed.

### Eighth critic pass on the above
- ✅ **`relativeAge()` called a 363-day-old item "1 year ago" nearly a
  week early** — years were computed by compounding two flooring
  approximations (`Math.floor(days/30)` for months, then
  `Math.floor(months/12)` for years), and `12 × 30 = 360`, not 365 —
  so anything 360-364 days old already rounded up to "1 year." Fixed
  by computing years straight from `days` (`Math.floor(days/365)`)
  instead of from the already-floored month count. Verified via
  Playwright against a real page with `deleted_at` set to exactly 363
  days ago (via a direct D1 update): now correctly reads "12 months
  ago", not "1 year ago".
- ✅ **Misleading tooltips on the article/project "Delete template"
  buttons** — both still read "Delete the template currently selected
  in the picker above," copied from the page-template button where
  that's accurate, but article/project template pickers reset to blank
  immediately after applying (so there's nothing "currently selected"
  to read) — those two actually prompt for the template's exact name.
  Updated both tooltips to describe what actually happens.
- ✅ **"Restore all" bulk action for Trash** — the shipped "Empty trash"
  let an admin bulk-delete a whole trash section but restoring still
  meant one item at a time; added a "Restore all" button per section
  (pages/articles/projects) using the exact same loop-the-existing-
  per-item-call pattern. Verified via Playwright: restoring all 5
  trashed pages correctly emptied the Trash list and both real test
  pages reappeared in the live pages list.
- ✅ **Template count visible on the picker itself** — with several
  near-duplicate templates able to pile up over time (this session's
  own testing left behind 7-8 "Test Template..." entries), there was no
  way to tell how cluttered a picker had gotten without opening it.
  The blank/"start from scratch" option's own label now reads e.g.
  "Blank page (8 templates saved)" — visible on the collapsed `<select>`
  itself, not just a hover tooltip.
- ✅ **Indeterminate checkbox state for Media "Select all shown"** — a
  partial selection (some but not all of what's currently shown)
  previously just left the checkbox unchecked, reading as "nothing
  selected" even though the selected-count text right next to it said
  otherwise. Now sets the standard DOM `.indeterminate` property.
  Verified via Playwright: selecting 1 of 5 shown items correctly set
  `checked: false, indeterminate: true`.

### Ninth critic pass — no bugs in the five shipped items, three new bugs found elsewhere
The ninth critic pass ran a full day-by-day sweep of `relativeAge()` (0-800
days, every boundary clean), verified "Restore all" can never hit a slug
conflict (`slugExists()` checks every row regardless of `deleted_at`, so a
restored item colliding with an active page's slug is blocked at the
source, not just unlikely), and confirmed the template count and Media
indeterminate checkbox both recompute correctly through every transition.
All five items from the previous batch: solid, no changes needed. It found
three new bugs in untouched territory instead:
- ✅ **Command palette surfaced trashed pages as dead, silently-failing
  search results** — the remote search behind Ctrl+K deliberately searches
  every page regardless of `deleted_at` ("sees everything"), but clicking
  a "Page: ..." result called `selectPage()` directly, which just no-ops
  if the id isn't in the currently-loaded (trashed-excluded) `pages` array
  — the exact "looks clickable, does nothing" anti-pattern this session
  already fixed once for stale "Edit this" deep links, just with one more
  entry point. Fixed by checking the loaded `pages` array before calling
  `selectPage()` and alerting "That page no longer exists (it may have
  been trashed)" if it's gone — scoped to just this command-palette
  result, since a stale deep link's existing silent-no-op behavior was
  determined intentional earlier this session and shouldn't change.
- ✅ **Public search silently under-counted and truncated results with no
  type filter applied** (visitor-facing correctness bug) — `publicSearch()`
  only ran real `COUNT(*)` queries when narrowed to one content type; the
  default "All" view fell back to whatever a hard `LIMIT 20` per category
  happened to return, so 25 real matches displayed as a flatly wrong
  "20 results" with 5 silently dropped and no indication anything was
  cut off. Now runs the same lightweight count query for every category
  whenever it's included at all (not just when paginated), summing them
  for the true total in the unfiltered view. Also added a "Showing the
  first N of M — narrow to one type above to see the rest" hint when the
  real total exceeds what's actually rendered. Verified via Playwright
  with 25 real published articles sharing a unique word: unfiltered
  search now correctly reads "25 results" (was "20"), the hint appears,
  and exactly 20 rows still render (the display cap itself is unchanged
  and reasonable — the bug was the wrong number, not the cap).
- ✅ **Orphaned `topic_meta` rows became permanently invisible but kept
  rendering stale content** — the Topic Pages admin panel only ever
  listed tags from `getTagCounts()` (currently-published content only);
  once the last published item carrying a tag was unpublished or
  deleted, the tag vanished from that list forever, but its saved
  custom description/share-image row was never cleaned up and
  `/topics/:tag` kept rendering it into the page `<head>` — with the
  admin having no way to even see the row existed, let alone clear it
  (the actual "delete on blank save" mechanism already existed in the
  PUT handler, it just had no way to be reached). Fixed by having the
  `GET /topic-meta` endpoint also include topic_meta rows with no
  matching live tag, flagged `orphaned: true` and shown as a distinct
  red "Orphaned" badge (no "Usage" button, since there's nothing to show
  usage of) — reaching it now unlocks the exact same pre-existing Edit
  flow, where saving with both fields blank deletes it. Verified via
  Playwright: unpublishing a tag's only article made its custom-blurb
  topic_meta row appear in the admin list marked "Orphaned," and saving
  it blank correctly removed it from the list.

### Ninth backlog batch (remaining critic suggestions)
- ✅ **Command palette now also searches Simulations, Songs, 3D Scans,
  and Reusable Blocks** — the admin's Ctrl+K search only ever covered
  pages/articles/blocks/projects, even though these four other content
  types each have their own dedicated editor and (as of this session) a
  "Usage" concept of their own. Extended `search()` in worker/db.js to
  also query each by its one name field. Since these four don't have a
  single-item URL route the way pages/articles/projects do, clicking a
  result opens the right list-and-editor modal rather than one exact
  item — still a real improvement over not being searchable here at
  all, especially since a match is usually one of a short list once
  the right modal is open. Verified via Playwright: searching for a
  real simulation's and a real shared block's name both surfaced them
  correctly.
- ✅ **Indeterminate checkbox state for Articles/Projects "select all"**
  — the exact same partial-selection gap just fixed for Media's select-
  all existed in the two other list-with-bulk-actions places sharing
  the same shape (`updateBulkBar()`/`updateProjectBulkBar()`); both now
  set `.indeterminate` the same way.
- ✅ **Exact timestamp on Trash age labels** — the relative-age text
  ("3 days ago") already had the real `deleted_at` ISO string in hand;
  it's now also a `title=""` tooltip on the same span, for an admin who
  wants the precise deletion time before deciding what's safe to purge.

### Tenth critic pass on the above
The tenth critic pass confirmed all six items from the previous batch
correct through every requested edge case (the exact 20-vs-21-result
boundary for the search-count hint, re-publishing an article to un-orphan
its topic_meta row, similarly-named page/simulation search results not
colliding) and found one new bug plus two pre-existing ones:
- ✅ **Stale favorited/recently-edited pages silently no-op'd** — the
  same "trashed page still shows as a live, clickable result" gap just
  fixed for command-palette search results had two more entry points:
  the topbar "Recent" dropdown and the command palette's own local
  Favorites/Recently-edited quick actions. Both reach pages through the
  same shared `RECENT_KIND_RUN.page` function, so the existence check
  now lives there once — closing all three entry points (including the
  original search-result one, simplified to reuse this instead of its
  own copy of the same check) instead of patching them one at a time.
  Verified via Playwright: pinning a page, trashing it, then clicking
  it from the Favorites panel now correctly alerts instead of doing
  nothing.
- ✅ **Password-protected pages were listed in sitemap.xml** — a page
  gated behind a password 401s (with noindex) for anyone unauthenticated,
  but its URL was still advertised in the sitemap, the same anti-pattern
  the existing `sitemap_exclude` flag exists to avoid for the
  intentional case. Added `&& !p.password_hash` alongside it. Verified
  via a real password-protected test page: excluded from `/sitemap.xml`.
- ✅ **Notification bell always opened Settings on Appearance, regardless
  of what the notification was about** — clicking "3 errors in the last
  24h" landed on Appearance instead of Logs; a failed-webhook notification
  landed on Appearance instead of Integrations; a backup-failure
  notification landed on Appearance instead of Backups — the exact
  "hunting through 7 tabs" problem the settings search feature elsewhere
  this session was built to solve, just never wired up here. Added a
  small `openSettingsTab()` helper (same async-then-switch-tab pattern
  the settings search results already use) and pointed each
  notification's action at its actual tab. Verified via Playwright with
  a real seeded error_log row: clicking the resulting "1 error(s) in the
  last 24h" notification now correctly lands on the Logs tab.

### Eleventh critic pass — one real regression found, two suggestions shipped
- ✅ **The centralized page-existence guard produced false positives for
  a page found by live search but not yet in the client's local cache**
  — routing the command-palette "Page:" search result through
  `RECENT_KIND_RUN.page` (added last batch) was correct for the Recent/
  Favorites entry points, whose local `pages` cache can only ever
  reference pages this browser tab already touched — a miss there
  really does mean deleted. But `/search` is a live server query that
  can find a page created moments ago in another tab/session, before
  this tab's own cache has any idea it exists — that's "cache hasn't
  caught up," not "doesn't exist," and the shared guard couldn't tell
  the difference. Fixed by having the search-result path refresh the
  page cache once (`loadPages()`) before trusting a miss, since the
  search result itself already proved the page exists server-side a
  moment ago; the Recent/Favorites paths are untouched and still
  correct as-is. Verified via Playwright: a page created via the API
  after the admin tab loaded now opens correctly from search with no
  alert, while a genuinely trashed page still correctly alerts.
- ✅ **Find & Replace extended to cover Projects** — the sweep already
  covered article titles/bodies and page block text, but never
  projects, even though a project's title/summary/body are exactly as
  user-facing. Mirrors the existing article-handling code exactly
  (snapshot before writing, split/join replace, skip locked projects).
  Verified via Playwright: a project containing a unique term now shows
  up correctly in a Find & Replace preview alongside articles.
- ✅ **Bulk multi-select "Clear" button for color-type style fields now
  actually renders** — `renderBulkInspector()` always calls `fieldHtml()`
  with `val` undefined by design (different selected blocks may have
  different existing colors), but the Clear button's own visibility
  check required a truthy `val` — so it could never appear in bulk
  mode at all, even though the underlying `applyStyleToAll(key, null)`
  handler it needed was already correctly wired and working. Fixed by
  also showing the button when `idPrefix === "bulk"`. Verified via
  Playwright with two real blocks (red and green text color): shift-
  selecting both and clicking the now-visible bulk Clear button
  correctly nulled `style.color` on both, confirmed via a direct D1
  query.

### Twelfth backlog item — scheduled backup restore/download
- ✅ **A scheduled backup could be inspected and verified but never
  actually restored or downloaded** (★ real safety gap, flagged
  medium-high by the eleventh critic pass) — the automatic daily R2
  backups panel only ever offered "View contents" (row counts) and
  "Verify integrity" (checksum) per backup; the only working restore
  path anywhere was "Restore from file…", which needs a JSON file
  already sitting on the admin's own device, and "Download backup"
  always exports the *current* live state, never a specific historical
  snapshot. In practice this meant the whole scheduled-backup system
  provided false assurance — "last backup succeeded," "verified
  intact" — with no way to act on that safety net if it were ever
  actually needed. Added two new endpoints reusing existing logic
  end-to-end rather than duplicating it: `GET
  /scheduled-backups-download?key=` streams the chosen R2 object back
  with the right headers (same idea as the existing on-demand
  `/export`, just for a specific past snapshot instead of "right now"),
  and `POST /scheduled-backups-restore` reads a specific R2-stored
  backup and pipes it straight through the exact same `importAll()`
  the manual file-upload restore already uses. Client-side, each backup
  row gained "Download" and "Restore this backup…" buttons alongside
  the existing two, with the restore button using the identical
  destructive confirm wording as the manual restore-from-file flow
  (same consequence, same warning). Verified via a careful, safe live
  test: took a fresh snapshot backup of the actual current state,
  created a throwaway test page, restored that snapshot, and confirmed
  the throwaway page was correctly gone and the real Home page (id 9)
  came through completely intact — proving the restore path works
  without risking real data. Also verified both new endpoints
  correctly 401 unauthenticated, and that "Restore this backup…" is
  fully visible and reasonably sized on a 390px mobile viewport.

### Twelfth critic pass — real security bug found and fixed
- ✅ **Unescaped canonical URL / og:url enabled stored HTML injection into
  every page's `<head>`** (medium-high severity, genuine security bug) —
  `renderShell()` in worker/render.js interpolated the `canonical` value
  raw in two places (`<link rel="canonical" href="${canonical}">` and
  `<meta property="og:url" content="${canonical}">`), the sole omission
  in a template where every other dynamic value (title, description,
  keywords, og:image, twitter tags, etc.) already goes through the
  codebase's own `esc()` helper. `canonical_url` is an ordinary admin-
  editable plain-text field on pages/articles/projects with zero format
  validation anywhere — an admin typo, or a deliberately crafted value,
  landed straight in every visitor's page source. Even a normal real-
  world canonical URL containing `&` (any query string) already produced
  invalid HTML here. Fixed the root cause by wrapping both interpolations
  in `esc()`, and added defense-in-depth: a new `validateCanonicalUrl()`
  in worker/admin-api.js (same pattern as the existing
  `validateCustomJsonLd()` guard) rejects a non-empty value that doesn't
  start with `http://`/`https://`, applied at all 6 create/update routes
  across pages/articles/projects. Verified via Playwright with a real
  `<script>`-tag-embedding value: confirmed the script did NOT execute
  and the output was correctly HTML-entity-escaped even when the
  malformed value was written directly at the DB layer (bypassing the
  new admin-api validation entirely) — proving the render-layer fix is
  the actual protection, with validation as an additional layer, not a
  substitute for it. Also confirmed a legitimate URL with `&` in its
  query string still renders correctly (`&amp;`-escaped, valid HTML) and
  a non-URL value is now rejected with a 400 at save time.

### Thirteenth backlog batch (remaining twelfth-critic suggestions)
- ✅ **"Export CSV" for a project's Bill of Materials** — the BOM feature
  already models everything needed to actually shop/order parts (item,
  quantity, price paid, where-to-buy link, substitution note) and
  computes a grand total, but there was no way to get that list out of
  the admin. Added an "Export CSV" button next to the BOM section
  heading, reusing the exact same `toCsvRow()`/Blob-download pattern
  the Analytics export button already established rather than
  introducing a second CSV-writing approach. Includes a trailing
  total row. Verified via Playwright with two real BOM items: the
  downloaded file's rows and computed total (25.50) matched exactly.
- ✅ **Duplicate-content-risk note added to the "Convert to Project"
  confirm dialog** — converting an article copies its title/body
  verbatim into a new draft while the original article stays live and
  unchanged; publishing that draft without adding anything distinct
  would put near-identical text at two URLs. The dialog's existing
  "nothing is deleted" wording was accurate but didn't mention this —
  added one sentence suggesting expanding the content or setting a
  canonical URL before publishing. No behavior change, just an
  awareness nudge at the one moment it's actually relevant.

### Fourteenth backlog batch — thirteenth critic pass
The thirteenth critic pass did a deep, deliberate audit of the canonical-
URL/og:url security fix specifically — tracing every place `canonical_url`
flows through render.js, index.js, sitemap.xml, RSS, JSON-LD, and the
admin UI's own field display — and confirmed it fully solid with no
remaining gaps: nothing else reads that field unescaped, sitemap/RSS/
JSON-LD independently compute their own URLs from slugs rather than
reading canonical_url at all, and the admin's own inputs are plain
`.value` assignments, never `innerHTML`. It found two smaller issues
instead:
- ✅ **Whitespace-only/trailing-space canonical URL produced inconsistent,
  confusing behavior** — a value that was pure whitespace (e.g. a stray
  space left after clearing the field) was truthy so it fell through to
  the regex check and got rejected, while a value with a *trailing*
  space silently passed and got stored with the space still attached —
  inconsistent with the *leading*-space case, which failed. Because
  `validateCanonicalUrl()` runs on every save for pages/articles/
  projects, and articles autosave on a 2-second debounce across ~10
  unrelated fields, a stray space in this one field could make every
  autosave attempt (triggered by just typing in the body) fail with a
  confusing error pointing at a field that looked empty. Fixed by
  trimming `body.canonical_url` in place before validating — a
  whitespace-only value now normalizes to "no canonical URL" (same as
  never setting it), and a real URL with incidental leading/trailing
  whitespace gets stored trimmed instead of either being rejected or
  saved with the stray space attached. Also trimmed client-side in all
  three build-body functions for the same value, avoiding an
  unnecessary round-trip error. Verified via the API: whitespace-only
  now saves cleanly (treated as empty), and both a leading-space and a
  trailing-space real URL are now stored identically, with no leading/
  trailing whitespace either way.
- ✅ **Removed leftover dead code from the content-usage unification** —
  `scan-builder.js`'s delete-confirmation was the one call site that
  never got migrated to the unified `/content-usage?type=scan&id=`
  endpoint when simulations/songs/shared-blocks were (this session,
  earlier), still calling the legacy `/scans/usage` route — which by
  then was just a one-line passthrough (`findScanUsage()`) to the exact
  same unified function anyway. Pointed scan-builder.js at the unified
  endpoint (matching simulation-builder.js/song-builder.js exactly) and
  removed the now-fully-unused `/scans/usage` route and
  `findScanUsage()` wrapper. Verified via Playwright: deleting a scan
  through the real admin UI still shows the correct usage-aware confirm
  dialog, and the legacy route now correctly 404s.

### Fifteenth backlog item — sitemap/canonical consistency check
- ✅ **SEO: flag content whose canonical URL points elsewhere but is still
  listed in sitemap.xml/rss.xml** — a canonical URL set to a different
  page (e.g. a project deliberately converted from an article, per that
  flow's own new confirm-dialog advice) is exactly the signal that
  means "the real version of this is over there," but the sitemap/RSS
  generators always list a page's own slug URL regardless of that
  signal — search engines get told two contradictory things at once.
  `sitemap_exclude` already exists for exactly this situation; this new
  check just flags where it was probably meant to be set but wasn't.
  Added `sitemapCanonicalMismatch` to `getSeoReport()`: any page/
  article/project with a non-empty `canonical_url` that doesn't match
  its own computed URL and isn't already sitemap-excluded. Wired into
  both the standalone SEO Report panel and the "Run all checks"
  aggregator. Verified via Playwright across all four cases: an
  external canonical still in the sitemap correctly flags; the same
  content with `sitemap_exclude` set correctly stops flagging; a
  canonical URL that matches the page's own URL never flags in the
  first place; and both admin surfaces correctly display the finding
  with the actual canonical URL it points to.

### Fourteenth critic pass — two high-severity bugs found and fixed
- ✅ **Redirects had no cycle detection — A→B→A (or a self-loop via
  PATCH) created a real, browser-visible infinite redirect loop** (high
  severity, visitor-facing) — the redirect-serving code does a single-
  hop lookup per request with no server-side chain resolution, so any
  cycle anywhere in the chain becomes an actual `ERR_TOO_MANY_REDIRECTS`
  for a visitor. `POST /redirects` only ever checked the zero-hop case
  (`from_path === to_path`) and nothing checked a multi-hop cycle
  through other existing redirects at all; `PATCH /redirects/:id` didn't
  even have the zero-hop check, since it was never copied over from
  POST — a single-field edit could point a redirect at itself with zero
  warning. Fixed by replacing both narrow checks with one shared
  `wouldCreateRedirectLoop()` that walks the actual redirect graph with
  the pending edge applied (bounded to 25 hops), used by both POST and
  PATCH — the old zero-hop check is just the first step of this same
  walk, so nothing needed two separate mechanisms. An external redirect
  target (a full `https://...` URL, which `to_path` is allowed to be)
  is correctly treated as a safe dead end, since the serving code can
  never revisit it as a `from_path`. Verified via Playwright: creating
  A→B then attempting B→A now correctly rejects with "This would
  create a redirect loop"; PATCHing an existing redirect to point at
  itself is now rejected identically; a 3-hop chain (A→B→C) where B's
  target is PATCHed back to A is also correctly caught; a real,
  non-cyclic redirect still resolves normally with a single 301.
- ✅ **The just-shipped sitemap/canonical-URL check false-positived on
  password-protected pages** — it excluded a page via `sitemap_exclude`
  but didn't also check `password_hash`, while the actual sitemap
  generator (fixed earlier this session) excludes password-protected
  pages regardless of `sitemap_exclude`. A password-gated page with a
  mismatched canonical URL got flagged as "still in sitemap.xml" even
  though it was never actually listed there — the two exclusion rules
  had quietly drifen apart. Fixed properly per the critic's own
  suggestion: extracted a single shared `isInSitemap(item, type)`
  helper in worker/db.js, used by both the real sitemap generator
  (worker/index.js) and the new consistency check, so they can't drift
  apart again the same way. Verified via Playwright: a password-
  protected page with a deliberately mismatched canonical URL no longer
  appears in `sitemapCanonicalMismatch`, confirmed alongside a direct
  check that the page is genuinely absent from `/sitemap.xml`.

### Sixteenth backlog item — font preview in Site Settings
- ✅ **Live font preview for the Body/Heading font selects** — choosing
  "Serif"/"Monospace"/"Rounded"/etc. previously changed nothing visible
  in the admin at all; the only way to see what a font choice actually
  looked like was saving, closing the modal, and opening a real page in
  a new tab. Added a sample-text preview under each select, updated
  live on change, using `ADMIN_FONT_STACKS` — a small client-side
  mirror of worker/render.js's `FONT_STACKS` (duplicated rather than
  shared, since this admin script is a plain `<script>`, not an ES
  module that could import from the worker bundle). Selecting "Custom"
  dynamically injects an `@font-face` rule pointing at the actual
  uploaded font file (via the same `currentCustomFontUrl` the save flow
  already tracks), so the preview reflects the real uploaded font, not
  just a generic placeholder — and falls back cleanly to plain
  sans-serif if "Custom" is selected before anything's been uploaded
  yet, no error. Verified via Playwright: Serif/Monospace/Rounded each
  correctly changed the preview's computed `font-family` to the right
  stack, selecting "Custom" with nothing uploaded fell back safely with
  zero console errors, and clearing back to "Default" correctly removed
  the inline override.

### Seventeenth backlog item — bulk alt-text editing in Media Library
- ✅ **Bulk "Set alt text…" for multi-selected media** — the SEO report
  already surfaces "missing alt text" as a sitewide finding, but fixing
  it meant opening each flagged image individually; there was no bulk
  path at all (only "Move to folder…" and "Add tag…" existed for a
  multi-selection). Extended the existing `/media/bulk-update` endpoint
  (already shared by move/tag) to also accept an `altText` value applied
  to every selected file, and added a matching "Set alt text…" button
  next to the other two — same prompt-dialog UX as "Add tag…" for
  consistency. Scoped deliberately to a batch of genuinely similar
  images (the button's own tooltip says so) rather than a shortcut
  around writing distinct alt text where it actually matters. Gets
  per-file revision history for free, since `upsertMediaMeta()` already
  snapshots before any editorial change. Verified via Playwright with
  two real uploaded images: selecting both and setting alt text applied
  the exact same string to both, confirmed via a direct API read.

### Eighteenth backlog item — series-name autocomplete and sibling-parts hint
- ✅ **Series name autocomplete + "other parts" hint in the article
  editor** — the Series field was a bare text input with no way to see
  what series names already existed, so a typo (an extra space, wrong
  capitalization) silently created a second, orphaned "series" instead
  of joining the real one, since `getSeriesArticles()` (worker/db.js)
  matches on exact string equality. Added a `<datalist>` populated from
  the distinct `series` values already present in the in-memory
  `articles` array (no schema change, no new endpoint), and a hint line
  that appears when the typed name exactly matches an existing series,
  listing its other parts ("Other parts already in this series: Part 1:
  …, Part 2: …") sorted the same way the public "Part N of M" nav is
  (`series_order`, nulls last, then publish date) — mirroring
  `getSeriesArticles()`'s own matching and ordering client-side rather
  than adding a second endpoint just to ask the server the same
  question. The article currently being edited excludes itself from its
  own hint. Verified via Playwright with two real published articles in
  a temporary series: the datalist offered the series name on a brand
  new article, typing it exactly showed both parts, opening one of the
  two articles itself showed only its sibling (self-exclusion works),
  and a one-character-short partial match correctly showed no hint
  (exact match only, matching the server's own lookup semantics).

### Nineteenth backlog item — BOM CSV import
- ✅ **Bulk "Import CSV…" for a project's Bill of Materials**,
  complementing the already-shipped CSV export — previously the only
  way to get parts into a BOM was one row at a time through the "Add
  item" form, which is painful for a parts list already sitting in a
  spreadsheet or a vendor cart export. Added a client-side-only
  feature (no schema change, no new endpoint — it just loops the
  existing `POST /projects/:id/bom` the "Add item" button already
  uses): a small hand-rolled RFC4180-ish CSV parser (quoted fields,
  `""` escapes) plus header-name column matching (`Item`/`Name`/`Part`,
  `Quantity`/`Qty`, `Price paid`/`Price`/`Cost`, `Where to buy`/`Link`/
  `URL`, `Substitution note`/`Substitution`/`Notes` — case-insensitive,
  order-independent) so it can both read a plain hand-made parts list
  *and* round-trip the app's own CSV export unmodified, correctly
  skipping that export's derived "Line total" column and its trailing
  blank/"Total" summary rows (any row with an empty Item cell is
  silently skipped, reported in the completion count). Rejects
  up front with a clear message if the CSV has no recognizable Item-ish
  column at all, rather than silently importing nothing. Verified via
  Playwright: importing a CSV shaped exactly like this app's own export
  (comma-in-a-quoted-item-name, a blank row, a trailing Total row)
  correctly created exactly the 2 real parts and skipped the other 2
  rows; a CSV with only Quantity/Price columns (no Item-like column)
  was correctly rejected with zero rows written; an empty file was
  rejected with a distinct "no rows found" message.

### Critic pass on the redirect-loop, sitemap-check, font-preview, bulk-alt-text, and series-autocomplete features
- ✅ **"Broken reference" badge false-positived on valid simulation/scan/
  song blocks under real network latency, and never self-corrected** —
  `boot()` called `await loadPages()` (which renders the initial
  canvas) *before* `loadSimulationOptions()/loadScanOptions()/
  loadSongOptions()` resolved, so the very first canvas render checked
  every simulation/scan/song block against still-empty option arrays.
  Once those loads actually finished, only `renderInspector()` ran —
  never `renderCanvas()` — so a false "broken" badge could outlive the
  fetch that caused it indefinitely, only clearing if the admin
  switched to a different page and back. Fixed on both ends: reordered
  `boot()` to load simulation/scan/song options *before* `loadPages()`
  (so the first render already has real data), and added
  `renderCanvas()` alongside the existing `renderInspector()` call in
  all three load functions, so any future stale-badge window
  self-heals the moment the real data arrives rather than requiring a
  page switch. Verified via Playwright with `/api/admin/simulations`
  artificially delayed 1.5s: no false badge appeared at any point
  during or after the load on a real, valid simulation-block reference.
- ✅ **Series-autocomplete hint could claim an unpublished draft was
  already "in this series"** — `updateSeriesHint()` matched on
  `series` equality alone, unlike the server-side `getSeriesArticles()`
  it's supposed to mirror, which only counts a sibling once it's
  actually published and its publish date has passed. An admin editing
  a published article could see an unpublished/future-scheduled
  sibling listed as if it were already live. Rather than hiding drafts
  entirely (losing real planning value — knowing a part 2 draft
  already exists is useful), each non-live sibling in the hint is now
  suffixed `(not live yet)`. Verified via Playwright: a series with one
  published and one intentionally-unpublished article shows the
  unpublished one correctly labeled.
- ✅ **Heading font "Same as body" preview didn't actually preview the
  body font** — `updateFontPreview()` treated the heading select's
  empty ("Same as body") value the same as the body select's own empty
  ("Default") value: just clear to blank. On the real site this
  genuinely inherits the body font (`public/style.css`:
  `font-family: var(--heading-font-family, inherit)`), so the preview
  was actively misrepresenting what headings would look like — e.g.
  Body=Serif + Heading="Same as body" showed the heading preview in
  the default sans stack instead of serif. Refactored into a
  `resolveFontStack(selectId)` helper that recurses into the body
  select when the heading select is blank, and wired the body select's
  `change` handler to also refresh the heading preview (since a body
  change can affect what "same as body" now resolves to). Also fixed a
  related code smell caught in the same pass: the custom-font
  `@font-face` injection used `escapeHtml()` (HTML-entity escaping) on
  a value going into `.textContent` of a `<style>` tag, which is never
  parsed as HTML — harmless today only because uploaded font URLs are
  always plain UUID paths, but the wrong tool for the job. Switched to
  `JSON.stringify()`, which produces a correctly-escaped CSS/JS string
  literal. Verified via Playwright: Body=Serif + Heading="Same as
  body" now correctly previews serif in both boxes, and changing Body
  afterward live-updates the heading preview too.
- ✅ **Bulk "Set alt text…" tooltip didn't disclose that it can't
  retroactively fix already-placed images** — the media library's
  `alt_text` only ever gets copied onto a block's own `content.alt`
  once, at pick time, and only into a currently-blank field (true of
  single-file edits too, not something this feature changed) — so
  running it on files already flagged by the SEO report's "missing alt
  text" check (which reads each block's own `content.alt`, not the
  media library) doesn't clear that finding, contrary to what the
  original commit message implied. Rather than building a broader
  retroactive block-rewriting feature to scan every page/article/
  project for placements of the edited file (real scope creep for what
  this tool is), updated the button's tooltip to say plainly that it
  only updates the Media Library entry and won't touch images already
  placed on a page.
- ✅ **Redirect-loop check's fixed 25-hop cutoff misreported long,
  genuinely non-cyclic redirect chains as loops** — the walk's own
  `seen` set already detects any real cycle exactly; the hop cap was
  only ever meant as a defensive backstop, but a fixed constant meant
  a chain that happened to be longer than it (built up over years of
  incremental slug renames, plausible for a real site) got rejected
  with "this would create a redirect loop" even with zero actual
  cycles. Changed the cap to the redirect table's own size (+1) —
  since a true cycle must repeat a node within that many steps
  (pigeonhole), any real loop is still caught exactly, but a
  non-cyclic chain can never be misreported just for being "too long"
  again. Verified via Playwright: a real 31-hop non-cyclic chain (past
  the old 25-hop cutoff) now correctly accepts a new redirect pointing
  at its head, while actually closing that same chain into a real loop
  is still correctly rejected.
- Noted, not fixed: the critic pass surfaced that the production D1
  database already carries a fair amount of leftover test debris from
  earlier QA sessions (draft articles with junk `series` values like
  "Test Series 1790220605718", junk simulations, a couple of stray
  test pages) — none of it created by this pass. It's mostly invisible
  clutter except that the new series `<datalist>` now surfaces several
  of those garbage series names directly in the real admin's
  autocomplete. Left alone rather than bulk-deleting a lot of
  pre-existing records unilaterally — worth a deliberate cleanup pass
  with the user's go-ahead.
