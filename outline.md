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
- ✅ Pull quotes (a distinct large/bold style, not just the base quote
  block — see section 12); margin notes: consciously not built as a
  distinct layout (see section 12) — footnotes already cover "an aside
  note attached to a specific point in the text" reasonably well
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
- ☐ Image optimization comparison, video captions/transcripts, audio-file support (images only today), PDF/doc previews, direct-download controls, drag-to-page, resumable uploads, upload queue with retry
- ✅ Storage-by-type dashboard — already built (`getStorageUsage()`'s
  R2-by-prefix breakdown: Images/Audio/Video/3D scans/Backups/Image
  version history, surfaced in Site Settings → Backups → "Storage
  usage"); this line was just stale, no new work needed
- ✅ Private-metadata stripping (EXIF GPS/device data on upload — see section 12)

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
- ✅ Automated keyboard-nav checker. A new "Accessibility Report" panel in
  the SEO Dashboard, scoped to "Raw HTML" blocks specifically — every
  other block type is already accessible by construction (semantic markup,
  real `<button>`/`<a>` elements, a dedicated alt-text field the SEO
  Report already checks), so the html escape-hatch block is the one place
  arbitrary admin-authored markup can introduce a real problem. Regex-
  matches for positive `tabindex` (breaks natural tab order), `onclick` on
  a non-interactive element (a `<div>`/`<span>`/etc., not keyboard-
  operable), `<img>` with no `alt`, and `<a href="#">` dead-end links —
  heuristic like the site's other link/markdown scanners, not exhaustive.
  Focus-state ✅ too (see below — the reasoning for leaving it undone
  didn't hold up once `computeRenderedLayoutDiagnostics()` existed)
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
- Two findings noted but deliberately not built this round, both
  real but bigger in scope than a fix-in-place: no modal in the app
  traps keyboard focus (Tab from inside an open modal walks into
  background page controls — affects every modal, not one; ✅ fixed
  later, see "Modal focus trap" in section 12), and two blocks that
  fully overlap on the canvas (pre-existing test content, not
  something this round created) can't be clicked through to select
  the one underneath, only via the Layers panel's "Select" button —
  still open, a legitimate accessibility/UX gap worth a dedicated pass.

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

### Twentieth backlog item — admin console navigation redesign (left sidebar)
- ✅ **Replaced the single horizontal topbar with a persistent left
  sidebar**, at the user's explicit request that the console layout and
  navigation be simplified. The old topbar packed page switching, page
  creation, Recent, Search, Articles/Projects/Media, and a "More ▾"
  overflow dropdown (itself hiding Redirects/Simulations/Scans/Songs/
  Reusable Blocks/Layers/Diagnostics/Site Health/Topic Pages/Analytics/
  Trash/Site Settings/view-mode toggles) into one row — everything
  past the first few items needed an extra click through a collapsible
  menu just to see it existed. The sidebar instead lists every
  destination in five always-visible, labeled groups (Pages at top,
  then Content/Library/Tools/Settings/View), with theme toggle and log
  out anchored in a footer — no click-to-reveal step for anything.
  Confirmed the direction with the user first (sidebar vs. a simplified
  topbar vs. a tabbed topbar) before building, since it's a real design
  tradeoff, not a bug fix.
  Structurally: `#app` is now a row of `.admin-sidebar` +
  `.admin-main` (slim topbar — just notifications and search now —
  plus the unchanged palette/canvas/inspector workspace below it).
  Every functional element kept its existing `id`, so none of the ~40
  call sites across the codebase that do `el("some-btn").click()` or
  reference these ids (the command palette's jump-to-panel entries, the
  notification bell's "open the right settings tab" actions, the
  settings-search feature) needed to change — moving a button's
  position in the DOM doesn't affect a direct id lookup or a
  programmatic `.click()`. The "More ▾" dropdown and its toggle JS were
  deleted outright as dead weight now that a vertical sidebar list
  has no space constraint forcing anything into an overflow menu.
  On mobile, the sidebar becomes the same kind of off-canvas drawer the
  block palette already was (slide in from the left, opened by "☰"),
  consolidating what used to be a split model — page-picker visible in
  the cramped top row, everything else already behind a drawer — into
  one consistent place for all navigation. Freed from that cramped row,
  the template picker (previously hidden entirely on mobile: "doesn't
  fit") and "View live" (previously hidden on mobile) are both usable
  there now. The add-block button also got a clearer label ("+ Block"
  instead of a bare "☰") since the sidebar toggle now legitimately owns
  that icon and having two different hamburger-look buttons on the same
  screen would undercut the whole "simpler navigation" point.
  Verified via Playwright at both 1440×900 and 390×844, light and dark
  theme: every single sidebar nav button still opens its correct modal
  (14 checked individually), the four view-mode toggles (Focus,
  Content-only, Preview mode, Screen Preview) and the notification
  bell/Recent dropdowns all still work, the settings-search command-
  palette jump ("copyright" → Site Settings → Footer tab) still works
  end to end, the theme toggle and logout still work, Recent's popover
  no longer risks clipping now that it's deliberately kept outside the
  sidebar's scrolling nav list (a scroll container clips absolutely-
  positioned overflow on both axes the moment `overflow-y` is set, so
  nesting it there would have cut the popover off instead of letting it
  float over the canvas), and on mobile the sidebar drawer and the
  block-palette drawer open/close independently with zero console
  errors throughout. `canvasMetrics()` already reads the canvas's own
  `getBoundingClientRect()` rather than assuming a fixed window width,
  so the sidebar's ~240px doesn't affect any block drag/resize math,
  only how much room is left for the canvas to render in.

### Twenty-first backlog item — theme/color consistency pass, at explicit user request
- ✅ **Dialogs no longer center on the full window** — a direct
  symmetry regression from the sidebar redesign above: `.modal` was
  `position:fixed; inset:0` with the content flex-centered in it, which
  correctly centered on the full browser width when there was no
  persistent side column, but now visibly skews every dialog toward
  the sidebar's 240px now that one exists (confirmed the sidebar
  itself isn't actually a click-through/rendering bug first — it
  really does sit under the dialog's backdrop, z-index and all; it's
  purely a centering-box problem). Added a `--admin-sidebar-width`
  variable (on `.admin-body`, not `.admin-app`, since dialogs are
  DOM siblings of `#app` and wouldn't inherit a variable set there)
  and, above the 860px mobile breakpoint (where the sidebar is a
  persistent column rather than an off-canvas drawer), offset
  `.modal`'s left edge by it so dialogs center in the same visible
  workspace the canvas/palette/inspector already do. Verified via
  screenshot across several modals (Redirects, Site Settings) at
  1440×900 — dialogs now sit visibly centered in the canvas area
  instead of pulled left.
- ✅ **Consolidated scattered one-off status colors into shared,
  WCAG-verified tokens, and fixed two real contrast bugs found in the
  process** — audited every hardcoded hex color across both
  stylesheets (excluding legitimate exceptions: a decorative SVG
  illustration, device-mockup frame chrome, and white icons overlaid
  on photographic media thumbnails, none of which are theme-driven by
  design). Found the "danger/error red" concept alone had *four*
  different one-off hex values (`#e85a5a`, `#c62828`, `#c0392b`, plus
  an already-defined-but-unused `--error-text` token), "success green"
  had three, and "warning amber" had four — each picked independently
  per feature rather than sharing one considered value, with zero
  light-theme adaptation on the public site's versions at all.
  Tracing actual contrast ratios (same methodology as this palette's
  existing verified-ratio comments) surfaced two genuine bugs, not
  just inconsistency:
  1. `.danger` and `#pe-save-overwrite` used `#e85a5a` as a
     background with white text on top — 3.48:1, under WCAG AA's
     4.5:1 minimum for text. That value was already correctly tuned
     as *text* color against `--bg` (5.65:1, fine) but never verified
     in the different "background holding white text" role.
  2. The public site's `.callout-*` admonition boxes and the build
     journal's colored timeline dots had **no light-theme override at
     all** — three of the four callout colors measured under WCAG's
     3:1 minimum for non-text contrast against the light theme's
     background (as low as 2.09:1), making a "warning" callout's
     colored border almost invisible to anyone using light mode.
  Fixed by adding `--success`/`--warning`/`--info` (new) and
  `--error-bg` (new; `--error-text` already existed but was only used
  once) to `public/style.css`'s shared `:root`/`:root[data-theme=
  "light"]` blocks — inherited by both the public site and the admin,
  since admin pages load both stylesheets — each verified against
  `--bg`/white the same way every existing token already documents.
  Replaced all ~20 call sites across both stylesheets (delete buttons,
  the broken-reference and diagnostic-error badges, save-conflict and
  contrast-pass/fail indicators, link-check status, the simulation
  builder's power-status readout, and the public site's callouts and
  journal timeline) with the shared tokens, deleting three now-
  redundant manual light/dark override blocks in the process (the
  token itself is theme-aware, so a caller no longer needs its own
  copy of that logic). Verified via Playwright: the delete button's
  background is now the verified-safe `#c62828` everywhere; a test
  article with all four callout types renders clearly differentiated
  colors in both themes (previously-inaudible light-theme colors now
  visibly distinct); the full regression suite and every sidebar nav
  destination still pass with zero console errors.
  Scope note: this was audited and fixed as a genuine consistency/
  accessibility pass, not a redesign of the palette's actual hues —
  the existing dark violet-black + orange-coral identity (already
  documented with its own verified contrast ratios) is unchanged.
- ✅ **Site Settings' 7 tabs wrapped into an uneven 5-then-2 second
  row** — `.settings-modal-inner` had a `max-width: 500px` override
  left over from before the tabs existed (when the modal held a single
  simple form), never revisited once a 7-tab row was added on top of
  it. Measured the tabs' actual rendered width (~567px including gaps)
  against the available 500px and widened the override to 640px —
  comfortably fits all 7 on one line with room to spare, while staying
  narrower than the default 900px modal width this content (plain form
  fields, not a grid) doesn't need. Verified via Playwright that all 7
  tabs now share one row at 1440px width, and spot-checked two other
  tabs (Integrations, Logs) at the new width to confirm their content
  isn't left looking sparse or cramped by the change; mobile is
  unaffected (already had its own width override for narrow screens).
  Spacing/symmetry auditing across the rest of the admin's popups
  continues as an ongoing pass at the user's request.
- ✅ **Theme preset "tab select" + subtle nav animation, at explicit
  user request** — following up on "condense things and make it
  intuitive... theme colors could be better and maybe like a tab
  select for the colors... that snappy simple but complex look":
  - Added 5 curated, WCAG-verified color-scheme presets (Coral Violet
    — the existing default, Ocean, Forest, Sunset, Monochrome) as a
    row of clickable pill "tabs" above the four raw color pickers in
    Site Settings → Appearance. Each pill previews its own bg+accent
    pairing via a colored dot and background, so the choice is visual,
    not four independent hex inputs to reason about together.
    Clicking one fills the same four inputs Save already reads (still
    freely editable afterward — a starting point, not a locked mode),
    live-updates the existing contrast checker, and highlights
    whichever preset (if any) exactly matches the current four values
    — clearing automatically the moment any field is hand-edited away
    from an exact match, the same "tab select" convention an OS
    theme/appearance picker uses. All 5 verified ≥4.5:1 text/bg and
    ≥3:1 accent/bg, matching this codebase's existing contrast rigor.
  - Added subtle, CSS-only entrance motion: dialogs now fade+scale in
    on open (an `animation`, not a `transition`, since it needs to
    play starting from `display:none` — closing stays instant, which
    reads as responsive rather than sluggish), the Recent/Notifications
    dropdowns fade+slide in, and sidebar nav items get a sliding
    left-accent-bar + slight shift on hover (the same idiom Linear/
    Notion/Slack use) instead of an instant flat color swap. All of it
    respects `prefers-reduced-motion: reduce`. Also tightened the
    sidebar's inter-group spacing (18px → 14px) for a denser feel.
  Verified via Playwright: clicking each preset fills the four fields
  correctly and updates the live contrast readout; hand-editing a
  field afterward correctly clears the active-preset highlight;
  saving, closing, and reopening Settings correctly re-selects the
  saved preset; the full regression suite and every sidebar
  destination still pass with zero console errors in both themes and
  at both viewport sizes.
- **Home page test-debris cleanup (local dev database only — did not
  reach production)**, at explicit user request after seeing screenshots
  of the real public Home page rendering overlapping test blocks
  ("Updated via field preview test" over a "GitHub" link, three
  duplicate "New heading" placeholders, a broken image, a rickroll
  video embed ×2, "This is a test quote — Someone Famous" ×2, six
  identical "hello from custom html" blocks, two broken simulation
  references, three "Write something here." placeholders). Deleted all
  25 confirmed-test blocks via the admin API, keeping and repositioning
  the one genuinely real block (a GitHub profile link) to the top.
  **Important discovery made in the process**: `wrangler dev` in this
  environment runs against a local-only D1 copy — confirmed via
  `wrangler whoami` (no Cloudflare credentials configured anywhere in
  this sandbox) — completely disconnected from the real production
  database. Every test article/page/block this entire session created
  and cleaned up, and this Home page edit, only ever touched that local
  copy; none of it reached the real site's data in either direction.
  Code changes (everything else in this file) did reach production via
  the normal git push → Cloudflare Workers Build pipeline; this is
  specifically about D1 *content*, which is a separate mechanism. If
  the real production Home page carries the same debris, it's
  unaffected by this entry and needs the same cleanup applied directly
  (either by hand in the real admin panel, or by giving a future
  session real Cloudflare API credentials).
- ✅ **Follow-up: the four raw color fields themselves still looked
  like an afterthought** — the user clarified after the preset-tab
  feature above that their "layout could be nicer" comment was about
  these four fields specifically, not asking for the preset feature
  (which was a bonus, not what they meant). The default `.settings-body
  input` rule stretches any input to full width, which for
  `type="color"` produced four long flat bars stacked vertically
  rather than anything resembling a deliberate color-picker UI.
  Replaced with a 4-up grid of equal cards (label above a proper
  square-ish swatch, 2×2 on narrow screens), each with a focus-visible
  border highlight. Verified via Playwright at both viewport sizes that
  the new layout doesn't break the preset picker or contrast checker
  (both key off the same input ids/values, unaffected by the
  surrounding markup change) — confirmed the "Background" swatch
  correctly renders the exact same dark value the admin's own chrome
  uses by default, which is why it visually blends with its own card
  background rather than a rendering bug.
- ✅ **Generalized the "condense into a row" principle from the swatch
  grid to the rest of the editors, at explicit user request** — "focus
  on achieving situations like that where it can be condensed to give
  more space so the user doesn't have to scroll while also not
  limiting anything." Added a general-purpose `.field-row` utility
  (equal-width flex children, wraps below 160px each) and applied it
  to the two fields where it was a clean, obviously-safe win: Title +
  URL slug, and Tags + Co-authors (articles) / Tech stack (projects) —
  each pair is two short single-line inputs that were previously each
  eating a full row for very little content. Deliberately did *not*
  apply this to the ~240px block palette (already width-constrained
  enough that pairing fields there would cramp them, not save
  anything) or to the Sharing & SEO tab's "Empty States" fields (each
  carries substantial multi-line guidance text that would wrap
  awkwardly in a narrower column) — "condense" only where there's
  real slack being wasted, not everywhere reflexively. Added a mobile
  override (`.field-row { flex-direction: column }` below the existing
  860px breakpoint) after finding the two fields otherwise stayed
  side-by-side at phone width with clipped placeholder text — the
  160px-each minimum was technically still satisfied by a ~175px
  available half at that width, just barely, so nothing actually
  broke, but the "not limiting anything" bar meant it needed fixing
  anyway. Verified via Playwright at both viewport sizes: fields
  render side-by-side and fully legible on desktop, stack cleanly on
  mobile, and a full article save (title/tags/co-authors) round-trips
  correctly through the new markup with zero console errors.
- ✅ **Modernized checkboxes and gave every button a styled baseline, at
  explicit user request** ("fix spacing between checkboxes and labels
  and buttons and make them look modern and not have that windows 95
  look"). Every checkbox in the admin (20 of them) was a completely
  unstyled native `<input type="checkbox">` — whatever flat square the
  OS/browser draws by default. Replaced with `appearance: none` plus a
  small hand-drawn checkmark (the rotated-border-box trick, no SVG
  needed): a rounded 18px swatch that fills with the theme's accent
  color when checked, including proper `:indeterminate` (the dash
  "Select all" rows show when only some items are selected) and
  `:focus-visible` states so keyboard nav and screen readers keep
  working exactly as before — only the paint changed. Also added one
  global `button` baseline (lower specificity than any of the ~30
  existing context-specific button rules, so it never overrides them —
  it only catches whatever button isn't covered by one of those,
  making the literal "native unstyled button" look structurally
  impossible instead of relying on none ever being missed; confirmed
  it actually was catching real gaps — Trash's "Restore"/"Restore all"
  buttons had no dedicated rule before this).
  **Bug found and fixed in the same pass**: turning on `appearance:
  none` made every checkbox start fully honoring `width: 100%` from
  whatever ancestor's `input` rule was already stretching every *text*
  input in that panel — harmless before, since native checkbox
  rendering mostly ignores explicit sizing, but now a real bug once the
  checkbox was fully CSS-controlled. Caught immediately via a before/
  after screenshot (the Featured/Pinned/Archived flags row rendered as
  four overlapping, garbled full-width boxes) rather than shipped
  blind. Traced every broad `input` selector in the file and added
  `:not([type="checkbox"])` to the two that actually had checkboxes in
  scope (`.article-editor input` — articles, projects, and the
  Published checkbox all share this container; `.admin-palette input`/
  `.admin-inspector input` — the page-settings sitemap-exclude
  checkbox and every block's dynamically-rendered style-field
  checkboxes), mirroring the identical `.settings-body input:not(...)`
  pattern already established elsewhere in this same file for the
  exact same reason. Also fixed `.article-flags-row`'s missing
  `flex-wrap`, which had been forcing "Exclude from sitemap.xml" to
  wrap its own text across 3 lines while its neighbors stayed
  single-line, instead of the whole label moving to its own row.
  Verified via Playwright in both themes: checked/unchecked/
  indeterminate states all render correctly at the right size (18×18
  confirmed via computed style, not just visually) in the article
  flags row, the block inspector's dynamically-rendered style
  checkboxes, the page-settings palette, Site Settings, and the Media
  Library toolbar; the full regression suite and every sidebar
  destination still pass with zero console errors.

### Top-tier design review pass
Spawned a design-review agent (framed as an expert web/product designer,
not just a bug-hunter) to drive the whole site with Playwright — both the
public site and the full admin, desktop and mobile, both themes — and
report a prioritized, screenshot-backed critique. It correctly avoided
re-flagging anything from the redesign work above. Findings, and what
was done with each:

- ✅ **The real Home page's own "GitHub" link had a 50×17px tap
  target** — under WCAG 2.5.8's 24×24 minimum — confirmed by the
  site's own Diagnostics tool against real content, not a hypothetical.
  `.block-links a` had zero padding, just plain inline text. Fixed with
  `display: inline-block; padding: 4px 2px; margin: -4px -2px` — the
  negative margin keeps the link's visible text in exactly the same
  position (no layout shift), only the invisible hit-area grows.
  Verified via `getBoundingClientRect()`: now 53×34px.
- ✅ **No text input in the Article or Project editors had an
  accessible label anywhere** — placeholder-as-label throughout (a
  real WCAG 3.3.2 issue: the field's purpose disappears once you start
  typing, and screen readers get an inconsistent or empty accessible
  name). Added `aria-label` to all 20 affected fields across both
  editors (Title, Slug, Tags, Co-authors, Series name/part, Share
  image URL, Canonical URL, Summary, Tech stack, Status, GitHub/Demo/
  Docs/Download URLs) — the fields that already had a proper
  `<label>` wrapper with visible text (JSON-LD, notes, related-content
  pickers, Published, etc.) didn't need this. Verified each one's
  computed `aria-label` directly.
- ✅ **Mobile Articles/Projects editor was a genuine scroll-trap** — the
  full article/project list stayed permanently visible in its own
  independently-scrolling ~250px box above the edit form, even after
  selecting a real item, meaning reaching Title required scrolling
  past a nested scroll region first (the classic mobile "which thing
  scrolls" trap). Added a `.mobile-editing` class (toggled from inside
  `populateArticleForm`/`populateProjectForm` and the "New" buttons —
  covering direct list clicks, "New", and deep-links equally, since
  they all funnel through the same population functions) that hides
  the list and gives the editor the full pane on mobile, plus a
  "← Back to list" button at the top of the editor to return. Reopening
  the modal fresh always resets to list view regardless of where a
  previous mobile session left off (the class otherwise persists on
  the same DOM node across closes/reopens, since the modal is hidden,
  not destroyed). Verified via Playwright for both Articles and
  Projects: list hides and Title is immediately visible after
  selecting a real item, Back correctly restores the list, and a fresh
  reopen after a previous edit doesn't get stuck in editor view.
- ✅ **The /random (Articles) and /projects index pages — the actual
  default landing pages for a visitor's primary content-discovery
  routes — used the weakest visual treatment in the entire codebase**:
  a bare `<ul class="search-results">` (bold title + one-line excerpt,
  no card, no border) shared with internal search-result rows, while a
  proper card treatment (`.project-card`/`.project-list`) already
  existed and was only ever used for "related content" call-outs
  elsewhere — the actual routes every visitor reaches by default got
  the plain treatment, and the nicer one was buried behind a
  page-builder block an author would have to deliberately place. Both
  index pages also stayed single-column even at desktop widths.
  Rewrote `renderArticlesIndexHtml`/`renderProjectsIndexHtml` to reuse
  the existing card markup (adding a publish-date line for articles),
  and added a `.index-grid` class (scoped to just these two index
  pages, not the narrower related-content call-outs, which read better
  staying single-column in a body-width column) that flows into a
  responsive grid above 700px. Verified via Playwright with 3 real
  articles/projects each: proper 3-column card grid at 1280px, clean
  single-column stacking on mobile, tags/dates/excerpts all rendering
  correctly; full regression suite green.

Two items from the same review needed a decision only the user could
make before building. The Home-page-H1 item is intentionally left for
the user to write themselves — not a code change. The navigation item
was resolved (user chose to always show Articles/Projects/Topics) and
is implemented below.

- ✅ **Persistent site navigation to Articles/Projects/Topics** — the
  site had zero persistent nav; those routes were only reachable via
  direct URL or a manually-placed page-builder link block, and
  Articles/Projects aren't rows in the `pages` table so a normal
  `nav_label` couldn't attach to them anyway. `listNavPages()`
  (worker/db.js) now prepends a fixed `BASELINE_NAV_ITEMS` array
  (Articles → `/random`, Projects → `/projects`, Topics → `/topics`)
  ahead of whatever custom `nav_label` pages exist, so the three core
  destinations always show up first in the tab bar on every page.
  Since every route handler in worker/index.js already renders its nav
  through this one function (14+ call sites), the fix applies
  site-wide from a single change — no per-route edits needed. Also
  fixed a latent bug this surfaced: `renderTopicsIndex()` was passing
  `activeSlug: null` to `renderShell()` (harmless before there was a
  "Topics" tab to highlight), so visiting `/topics` never lit up its
  own nav tab — changed to `activeSlug: "topics"`. Verified via
  Playwright across homepage, `/random`, `/projects`, `/topics`, and
  the 404 page: correct active-tab highlighting everywhere, nav
  renders cleanly at both desktop (1280px) and mobile (390px) widths,
  and the existing content (e.g. the Home page's GitHub link) is
  unaffected. Full regression suite green.

### Modal focus trap

- ✅ **No modal in the admin app managed keyboard focus** — Tab from
  inside any open modal (Articles, Projects, Media Library, Settings,
  all ~20 of them) walked straight into whatever background control
  happened to sit next in DOM order, since none of them individually
  handled this (a real WAI-ARIA dialog pattern gap, and worse on this
  site than most since the 24-column canvas sits directly behind every
  modal with dozens of its own focusable blocks). Built as one generic,
  site-wide fix rather than touching every modal's open/close code:
  extracted the existing `closeTopModal()`'s "which `.modal:not([hidden])`
  is actually on top" resolution into a shared `getTopModal()` (unchanged
  behavior, just reused), then added a `keydown` listener that cycles Tab/
  Shift+Tab between the topmost modal's first and last focusable elements
  instead of letting focus leave it, correctly targeting the *topmost*
  modal when one picker (e.g. Media Library) is opened from inside another
  (e.g. the Articles editor) rather than the one behind it. Paired with
  the other half of the same pattern — returning focus to whatever
  triggered a modal once it closes — via a `MutationObserver` on the
  shared `hidden` attribute rather than a wrapper around every close path,
  since a few modals (Songs, Simulations builders) already run their own
  cleanup in a dedicated close handler that a second wrapper risked
  double-firing. Verified via Playwright: tabbing 90 times inside the
  Articles editor (85 real focusable elements) never left the modal;
  Shift+Tab from the first element wrapped to the last; closing it
  returned focus to the "Articles" button that opened it; and the nested
  case (Media Library opened from the Articles editor's "Browse…" image
  picker) trapped against Media Library specifically, left the Articles
  modal open underneath, and returned focus to the Browse button — not
  the outer modal's trigger — on close. Full regression suite green.

### Strip EXIF metadata (GPS, device model) from uploaded photos (section 2's audit checklist, "private-metadata stripping")

- ✅ **Uploaded photos shipped their full EXIF block straight to public R2
  storage, GPS coordinates included** — a phone photo's Exif segment
  routinely carries the exact latitude/longitude it was taken at plus
  device make/model/timestamp, none of which has anything to do with
  why an image is being published, and the upload pipeline
  (`worker/admin-api.js`'s `/upload`) stored the raw uploaded bytes
  completely untouched. Fixed at the single point every image upload
  already funnels through — `uploadFile()` in `public/admin/app.js`,
  called by both the per-field "Upload image" buttons and the Media
  Library's own uploader — rather than duplicating logic across
  callers. Added `stripImageMetadata()`: decodes the file via
  `createImageBitmap(file, { imageOrientation: "from-image" })` (the
  browser's own EXIF-orientation-aware decoder, not a hand-rolled
  binary TIFF/IFD parser that could get the byte-offset math wrong),
  draws it to an `OffscreenCanvas`, and re-exports — which drops every
  metadata segment as a side effect of the format round-trip while
  physically baking in the correct visual rotation first, so a photo
  taken in portrait via an EXIF orientation tag doesn't end up
  sideways once that tag is gone. Deliberately scoped to JPEG/PNG
  only: GIF and WebP can be animated, and a canvas round-trip only
  ever captures a single static frame, so re-encoding those would
  silently destroy animation — a worse trade than the metadata it
  would strip — so they pass through completely untouched. Falls back
  to the original file untouched on any decode error, since stripping
  metadata should never be the reason a legitimate upload fails.
  Verified via Playwright with a real generated JPEG carrying GPS
  lat/long, device Make/Model, and an EXIF Orientation=6 tag: the
  uploaded file's raw bytes contain no "Exif" marker, no GPS string,
  and no camera-model string at all (full strip, not just GPS), and it
  now decodes as 100×200 instead of the original 200×100 — confirming
  the 90° rotation was baked into the actual pixels rather than lost.
  A control upload of a tiny GIF came back byte-for-byte identical
  (34 bytes in, 34 out), confirming non-JPEG/PNG formats are correctly
  left alone. Full regression suite green; test uploads deleted and
  confirmed gone from both R2 (404 on refetch) and the `media` table.

### Critic pass on the nav bar, sidebar, theme, and motion/diagnostics work above

A fresh critic agent live-drove the persistent nav bar, admin sidebar,
theme consolidation, motion budget, and Diagnostics jump-to-block
features just shipped. Sidebar, theme tokens, motion-budget/reduced-
motion ordering, and Diagnostics jump-to-block all checked out clean.
Found two real, concrete bugs in the nav bar specifically, both fixed:

- ✅ **A long custom `nav_label` broke the page, two different ways
  depending on whether it had spaces** — `.tab` had no `white-space`/
  `overflow`/`text-overflow` handling and `.tabs` had no width cap at
  all, so a long label with spaces wrapped *inside* the pill (inflating
  its height to 206px on mobile, and since `border-radius: 999px`
  tracks the element's own height, that turned the whole nav bar into
  a giant oval bleeding into the page), while a long label with no
  spaces just overflowed `.tabs`' width outward, dragging the *entire
  page* into horizontal scroll (`documentElement.scrollWidth` measured
  795px against a 390px viewport). Fixed with `white-space: nowrap`,
  `overflow: hidden`, `text-overflow: ellipsis`, and a `max-width: 220px`
  cap on `.tab`, plus `.tabs` itself gaining `max-width: 100%` and a
  scrollbar-hidden `overflow-x: auto` as a backstop for however many
  tabs still don't fit after per-tab truncation. First pass introduced
  its own regression, caught before shipping: a flex item's default
  `flex-shrink: 1` let the *short* baseline tabs (Articles/Projects/
  Topics) get squeezed down to unreadable "A…"/"P…"/"T…" slivers too,
  since browsers distribute shrinkage across every flex item once the
  row doesn't fit, and `overflow: hidden` text has no minimum content
  width to resist that. Added `flex-shrink: 0` to `.tab` so only the
  actual overflow scrolls — short tabs keep their natural size, and the
  screenshot re-check confirmed "Articles"/"Projects"/"Topics" render
  fully readable again. Verified via Playwright with a real long
  `nav_label` page (both the spaced and unbroken-word variants): mobile
  `scrollWidth` back to 390 (matching the viewport) in both cases, the
  long tab's own height back to ~40px (not 200+), and the ellipsis
  truncation reads cleanly at both 390px and 1440px. Test page deleted
  (soft + permanent) and confirmed gone via D1.
- ✅ **Individual topic pages (`/topics/:tag`) never highlighted their
  own "Topics" nav tab** — the exact same `activeSlug: null` bug
  already found and fixed for the topics *index* page earlier in this
  section, just missed on the per-tag detail route
  (`renderTopicPage()` in `worker/index.js`), which is the page a
  visitor actually lands on after clicking a topic. Changed to
  `activeSlug: "topics"`, matching the index page's fix. Verified via
  curl against a real existing tag: `/topics/code` now renders
  `class="tab is-active" href="/topics" aria-current="page"`, matching
  `/topics` itself.

Full regression suite green after both fixes.

### Critic pass on the four newest fixes (focus trap, EXIF strip, nav overflow, topics active-tab)

A second critic agent live-drove specifically the four items just shipped
(focus trap, EXIF stripping, nav overflow fix, `/topics/:tag` active-tab).
EXIF stripping and the `/topics/:tag` fix both checked out completely
clean end-to-end (real GPS-tagged JPEG and tEXt-chunked PNG both came back
with zero metadata; GIF/SVG passed through byte-identical; the Photo
Editor and bulk uploader confirmed to share the same code path). Found
two real, concrete bugs, both fixed, plus one low-priority perf nit also
fixed while in there:

- ✅ **The one modal that moves focus into itself on open — the command
  palette — broke the new focus-return half of the trap** — a
  `MutationObserver` callback is a microtask, so it doesn't run until
  the synchronous code that flipped a modal's `hidden` attribute has
  already finished. Every other modal in the app leaves focus alone on
  open, so by the time the observer's callback reads
  `document.activeElement` to remember "what to restore on close," it's
  still correctly the trigger button. `openCommandPalette()` is the one
  exception: it calls `el("command-input").focus()` synchronously right
  after opening, so the observer was instead recording `#command-input`
  itself — which then closes with the modal, making the stored restore
  target unreachable and silently dropping focus to `<body>` instead of
  back to whatever opened the palette (`#command-btn`, or nothing in
  particular if opened via the Ctrl+K shortcut). Fixed by having
  `openCommandPalette()` record the real trigger into `modalFocusReturn`
  itself, *before* moving focus, and changing the observer's auto-
  capture branch to only fill in a value if nothing already claimed that
  slot (`if (!modalFocusReturn.has(modal))`) — safe because the `hidden`
  branch always deletes a modal's entry on close, so "already has a
  value" can only mean "claimed during this exact open," never a stale
  leftover. Every other modal's behavior is unchanged since nothing else
  pre-claims its slot. Verified via Playwright for both the click-to-open
  and Ctrl+K paths: focus now correctly lands back on the real trigger
  (`#command-btn` or whatever else was focused before Ctrl+K) after
  Escape, not `<body>`; Settings/Media Library/etc. re-checked unaffected.
- ✅ **The `.tabs` horizontal-scroll backstop (from the nav-overflow fix
  above) had zero visual affordance and a real keyboard-accessibility
  gap** — confirmed live with 7 mixed-length tabs (3 baseline + 4 custom
  `nav_label` pages): a hidden scrollbar plus plain edge-cropped content
  gave no hint there was more to scroll to, and Tab-focusing onto a tab
  that was only *partially* clipped (not fully off-screen) didn't
  reliably get scrolled into view — browsers only auto-scroll a newly-
  focused element when it's judged not visible at all, and a sliver
  already counts as "visible enough," so a keyboard user could land on a
  focus ring with the tab's own label still invisible. Fixed in
  `nav.js`: a `focusin` handler on `.tabs` explicitly calls
  `scrollIntoView({ block: "nearest", inline: "nearest" })` on whichever
  `.tab` receives focus, rather than relying on the browser's own
  (confirmed insufficient) default behavior. Paired with a `has-overflow-
  left`/`has-overflow-right` class pair (`style.css`), toggled on scroll/
  resize based on actual `scrollLeft`/`scrollWidth`, driving a subtle
  inset edge-shadow so there's now a visible cue when more tabs exist off
  to either side. Verified via Playwright with the same 7-tab setup:
  every tab (including "About the Studio," the exact one the critic
  found broken) is now fully within `.tabs`' visible bounds when
  Tab-focused, and the overflow-hint classes correctly flip based on real
  scroll position (right-only at the start, left-only once scrolled to
  the end).
- ✅ **Photo Editor's "Save as new"/"Save overwrite" did a pointless
  extra decode+re-encode pass** — `exportBlob()` already produces a PNG
  straight off the canvas (zero metadata by construction), but it then
  went through the same `stripImageMetadata()` as any other upload,
  which re-decoded and re-encoded it a second time for no benefit (a
  measured ~300ms+ of wasted work on a large image, confirmed via
  instrumented call counts). Fixed with one added check: `canvas.toBlob()`
  always yields a plain `Blob`, never a `File`, and every real upload
  path (single or bulk) always hands over a real `File` from an
  `<input type=file>` — so `if (!(file instanceof File)) return file;`
  at the top of `stripImageMetadata()` skips the redundant pass for
  canvas-sourced saves specifically, without touching any real upload
  path. Verified via Playwright: `createImageBitmap` call count stayed
  at 1 (from the original upload) through a full Photo Editor open →
  Save-as-new cycle, confirming zero extra strip-pass calls, while the
  saved copy still uploaded successfully with a real, non-empty size.

Noted but not fixed, both explicitly low-priority: a modal with zero
focusable elements would fully defeat the Tab trap (confirmed only via a
synthetic test that strips a modal's own close button — not reachable
with any real modal today, since every one ships with at least a close
button); and pre-existing, unrelated leftover test data from earlier
sessions (2 stale pages, 5 stale ~98-byte media uploads, all confirmed
unused) was found and cleaned up directly as routine local-dev hygiene,
not because it was caused by this round's work.

Full regression suite green after all three fixes.

### Diagnostics: focus-visible check for interactive elements

- ✅ **Extended the "Accessibility Report" with a real focus-visible
  check** — previously left undone (section 2's checklist) with the
  reasoning that "checking computed `:focus-visible` styles across
  every element isn't something a static scan can do meaningfully."
  That reasoning predates `computeRenderedLayoutDiagnostics()` (added
  for the tap-target/overflow/broken-image checks), which already
  spins up a real hidden iframe of the live rendered page — meaning the
  actual technique real accessibility auditors use (focus each element,
  diff its computed style before/after) is now genuinely available, not
  just theoretically possible. Added to that same iframe pass: for
  every `a[href], button, input, select, textarea` with real geometry,
  skip anything whose resting `outline` isn't already suppressed (has
  its own default ring — nothing to check), then `.focus()` it and diff
  `outlineStyle`/`outlineWidth`/`boxShadow`/`borderColor`/`borderWidth`
  against the resting snapshot; if nothing changed, the element has no
  visible way to show it's selected to a keyboard user. Verified via
  Playwright with two real pages: a Raw HTML block containing
  `<a href="#" style="outline:none;">` (no compensating focus style)
  correctly produces a "No visible focus indicator" finding naming the
  link, while an identical link with no inline style — relying on the
  site's existing global `a:focus-visible { outline: 2px solid
  var(--accent) }` rule — correctly produces none. Also ran it against
  the real (messy, test-debris-filled) local Home page to check for
  false positives across genuine content: zero spurious findings.
  Cleaned up test pages (soft + permanent delete), confirmed gone via
  D1. Full regression suite green.

### Critic pass on the focus-visible check — 4 real bugs found, all from the same root cause

A critic agent stress-tested the new focus-visible check specifically and
found 4 concrete, live-reproduced bugs, all tracing back to one root
cause: the original version only diffed `outline`/`box-shadow`/`border`
as a proxy for "did focusing change anything visible," and never checked
whether the element was actually *reachable or visible* in the first
place. All fixed by reworking the check to test real visibility
(`visibility`, `opacity`, geometry) at both the resting and focused state,
plus widening the style diff and adding a bounding-rect diff:

- ✅ **False positive: color- or background-only focus styles** (a
  completely standard, WCAG-legal technique) **were wrongly flagged as
  "no visible focus indicator"** — the diff never looked at `color`/
  `backgroundColor` at all. Added both to the diffed property set.
- ✅ **False positive: off-screen "reveal on focus" techniques — this
  site's own `.skip-link` pattern — were wrongly flagged** — the diff
  never accounted for position/geometry changes (`left`/`top`/
  `transform`/etc. all end up affecting the element's bounding rect).
  Added a `getBoundingClientRect()` diff between resting and focused
  state as a second, independent signal alongside the style diff; a
  meaningful position/size change counts as "visibly changed" regardless
  of which CSS property caused it. Also added an explicit exemption: if
  the element is invisible *at rest* but visible *once focused*, that's
  exactly the legitimate skip-link pattern working as intended, not a bug.
- ✅ **False negative — and the most serious of the four: an `opacity: 0`
  element (permanently invisible, focused or not) passed the check
  clean** — because focusing it still flipped `outlineStyle` from `none`
  to `solid` internally (from the site's own global `:focus-visible`
  rule), which the old diff read as "a change happened, so it's fine,"
  even though that change is itself invisible. This is exactly the class
  of defect the check exists to catch. Fixed by checking real rendered
  visibility (`visibility !== "hidden"`, `opacity > 0`, non-zero
  geometry) at the *focused* state specifically — if the element is
  still invisible once focused, that's now its own distinct, more
  severe finding ("Keyboard-focusable but always invisible"), reported
  regardless of what the internal style diff shows.
- ✅ **Misleading warnings on elements that can never actually be
  tabbed to in the first place** — a `disabled` button and a
  `visibility: hidden` link both got flagged with "a keyboard user
  can't tell it's selected," which is nonsensical since a keyboard user
  can never reach either one to begin with (`.focus()` is a confirmed
  no-op on both). Fixed by skipping `disabled` elements outright before
  any check runs, and by checking `document.activeElement === node`
  right after calling `.focus()` — if focus didn't actually move (the
  `visibility: hidden` case), the element is out of scope for a check
  about focus *styling*, not focus *reachability*.

Verified via Playwright reproducing all 4 original repros plus the two
cases the critic confirmed already worked correctly (plain `:focus`
selector, and a 115-element page for performance): all 8 now produce the
correct result — the two legitimate techniques (color/background-only,
skip-link-style reveal) no longer flagged, the `opacity: 0` element now
correctly flagged as "always invisible" instead of silently passing, the
unreachable elements (disabled, `visibility: hidden`) no longer produce
any finding, and the genuinely broken case (bare `outline: none`, no
compensating style) still correctly flags. Re-ran the real Home page
check: still zero false positives. Full regression suite green.

### Pull quotes / margin notes (section 2's checklist)

Section 2 had marked "Pull quotes (✅)" — checked and it was stale: the
`quote` block only ever had one modest citation-style look (small accent
left border, 1.05rem italic text), which is a normal attributed
blockquote, not what "pull quote" actually means typographically (a
large, bold excerpt meant to stand out while skimming a page). Also
checked "margin notes (☐)" against the current layout before building
anything:

- ✅ **Added a real large-pull-quote style, distinct from the base
  quote block** — a new "Display as a large pull quote" checkbox on
  the Quote block's content fields (`content.large`), rendered as an
  added `block-quote-large` class (`worker/render.js`) that swaps in
  centered, bold, 1.7rem text with a large decorative opening quote
  mark, no border — visually distinct from the modest default rather
  than a variation on it. Chosen as a content field (alongside the
  quote's existing `text`/`cite`) rather than a new generic style-panel
  toggle, since it's specific to this one block type and the codebase
  already has a data-driven per-block-type content-fields map to hang
  it on. Verified via Playwright: a normal quote and a `large: true`
  quote on the same page render with `block-quote` vs. `block-quote
  block-quote-large` respectively, the admin inspector shows the new
  checkbox, and the visual result (screenshot-checked) reads as a
  genuine pull quote next to the existing modest style.
- Margin notes deliberately not built as a distinct layout: a true
  margin note needs actual reserved margin space beside the running
  text to float into, and this site's article/project body currently
  runs the full ~1036px canvas width with no narrower text column
  reserving side space (`.canvas`'s `max-width: 1100px` minus padding —
  checked directly, no dedicated prose-width rule exists). Building
  "margin notes" without real margin space would just be a footnote by
  another name, and this site already has a working footnote system
  (`[^label]` syntax, numbered references, a footnotes section) that
  covers the actual underlying need — an aside attached to a specific
  point in the text without derailing the main reading flow. A true
  margin-note layout would mean narrowing the article text column
  site-wide to carve out permanent side space, which is a real visual
  redesign affecting every article/project page, not a small addition —
  noted here as a documented, reasoned scope call rather than left
  ambiguous, so a future pass doesn't re-litigate it without first
  answering that layout question.

Full regression suite green.

### Project editor: autosave/crash-recovery/conflict-handling parity with articles, plus a real bug found along the way

Set out to build "side-by-side compare of conflicting versions" (section
2's checklist, still ☐ — currently just "reload to see latest") and
found something more fundamental first: the Project editor had none of
the infrastructure Articles already had. Fixed the more foundational gap
before returning to the original ask:

- ✅ **Projects had no autosave at all** — only a manual "Save" button,
  while Articles autosave 2s after the last keystroke. Added
  `autosaveProject()`/`scheduleProjectAutosave()`, mirroring
  `autosaveArticle()`/`scheduleArticle()` exactly (same debounce, same
  `unsavedDirty` wiring so the existing `beforeunload` guard now also
  covers unsaved project edits, which it silently didn't before).
- ✅ **Projects had no crash-recovery draft** — Articles snapshot raw
  field values to `localStorage` on every keystroke and offer to
  restore them if a tab crashes before a save lands; Projects had
  nothing, so a crashed tab mid-edit lost the work with no recovery
  path at all. Added the same `PROJECT_DRAFT_FIELD_IDS`/
  `captureProjectRawFields`/`checkProjectDraftRecovery` pattern
  (reusing the already-generic `saveDraft`/`loadDraft`/`clearDraft`/
  `renderDraftRecoveryBanner` helpers — no new plumbing needed there).
  Scoped the same way Articles' version already is: raw single-value
  fields only, not the related-content multi-selects (those need
  `getMultiSelectValues`, not `.value`).
- ✅ **Projects' save-conflict handling was weaker than Articles'** — a
  conflicting project save just showed a static error message with no
  way to recover; Articles show a "Reload latest version" button.
  Wired Projects through the same `renderConflictStatus()` helper.
- ✅ **Found and fixed a real, pre-existing bug in "Reload latest
  version" itself — for both Articles and Projects** — the reload
  callback populated the form straight from the in-memory `articles`/
  `projects` array without re-fetching first, even though that array is
  *already known stale* the moment a conflict happens (that's what
  triggered it). Clicking "reload latest version" showed neither side's
  edit — whatever had been cached from before either tab's change — not
  the actual latest version the button promises. The Page editor's own
  conflict handler already re-fetches correctly (`await loadPages()`);
  Articles/Projects didn't. Fixed both to `await api(...)` before
  finding-and-populating, matching the page editor's already-correct
  pattern. Verified via Playwright: created a project, simulated a
  second "tab" changing it first (bumping its version), then saved a
  conflicting edit from the original tab — got the conflict + reload
  button as expected, and clicking it now genuinely shows the other
  tab's real change instead of a stale blank field. Repeated the same
  test for an article's conflict-reload and confirmed the same fix
  applies there too.

Verified via Playwright end-to-end for Projects specifically: typing
triggers "Unsaved changes…" then "Saved [time]" ~2s later with the value
confirmed on the server; abandoning an edit mid-typing (simulating a
crash) and reopening the project shows the draft-recovery banner, and
clicking "Restore it" brings back the exact abandoned text. Full
regression suite green; all test articles/projects deleted (soft +
permanent) and confirmed gone via D1.

The original ask — side-by-side diff on conflict, not just a binary
reload-or-lose-it — is still open; this round brought Projects up to the
same baseline Articles already had (including fixing a bug Articles had
too) rather than building the fancier compare view on top of an
inconsistent foundation.

### Critic pass on the project autosave parity work

A critic agent stress-tested the parity change specifically. Confirmed
clean, no issues found: the reload-latest-version fix itself (verified
via a real concurrent-edit simulation), `PROJECT_DRAFT_FIELD_IDS` against
every actual form field (no typos/omissions), new-project crash-recovery
draft behavior (including two abandoned drafts in a row correctly
overwriting via the same key, matching Articles), the full create → id
→ autosave flow, and no regressions in lock/unlock/duplicate. One real
bug found and fixed:

- ✅ **The four related-content multi-selects
  (`project-related-articles/-simulations/-scans/-override`) never
  triggered autosave at all** — deliberately excluded from
  `PROJECT_DRAFT_FIELD_IDS` (multi-selects need `getMultiSelectValues`,
  not `.value`, so they can't go through the same raw-capture path),
  but that's a reason to exclude them from the *crash-recovery
  snapshot*, not from *autosave itself* — Articles' equivalent field
  (`article-related-override`) already gets its own dedicated
  `"change"` listener calling `scheduleAutosave` despite the same
  crash-recovery exclusion, and Projects never got the matching one.
  Selecting a related item as the *only* edit before a crash or tab
  close was unprotected two ways instead of one: no autosave PATCH ever
  fired for it, and it was also outside the local draft snapshot by
  design. Added the same `"change"` listener pattern for all four
  fields. Verified via Playwright: selecting a related article with no
  other field touched now shows "Saved [time]" ~2s later, confirmed
  persisted server-side (`related_articles: [id]`) — previously this
  produced no autosave at all.

Full regression suite green; test article/project deleted and confirmed
gone via D1.

## 13. Creative-suite expansion backlog (2026-09-25)

User handed over a 600-item wishlist asking to massively expand the
three existing browser-based editors (Photo Editor, Song/DAW, Simulation
builder) toward near-professional depth, with all editors + the CMS
sharing one media library, project relationships, permissions, saving,
and version history. Triaged via 4 parallel research passes (one per
area), each reading the actual current implementation before ranking —
not evaluating against Photoshop/Ableton/SPICE in the abstract. Workflow
going forward: pull an item (easiest first), research + implement, get a
critic agent to score it out of 10, fix and resubmit until it scores 9-10
(or the only things left are minor polish / genuine out-of-scope calls),
and log every finding a critic raises — not just the ones fixed in that
pass — as its own line here.

**Shared foundation, confirmed by all 4 passes independently**: pages/
articles/projects already share `version` + `checkConflict()` optimistic
locking, soft-delete/trash, a generic `revisions` table, `activity_log`,
and autosave. Media already has real file-level versioning
(`media_revisions` + `media_versions`, R2 `_versions/` prefix) and usage
tracking (`findMediaUsage`/`getAllMediaUsage`). **`simulations` and
`songs` have NONE of this** — bare `{id, name, data JSON, updated_at}`
rows, zero autosave/conflict/revision/trash wiring in either
simulation-builder.js or song-builder.js. This is the single biggest gap
the whole wishlist is reaching for, and the natural fix is generalizing
the existing media-revisions pattern into one generic `entity_versions`
table (entity_type/entity_id/snapshot) plus a generic asset/relationship
join, rather than building three separate systems.

**Current reality per editor**, bluntly, since it drove every ranking:
- **Photo Editor** (`public/admin/photo-editor.js`): a flat single-canvas
  Canvas2D raster editor. No layer system, no vector paths, no true
  selection engine (just a rectangular crop), no masks, no adjustment
  layers. Adjustments are baked via CSS `ctx.filter`. Undo is a 15-deep
  full-canvas-snapshot stack. Save is "as new" (fresh upload) or
  "overwrite" (versioned PUT) — both already exist.
- **Song/DAW** (`song-builder.js`/`song-engine.js`/`song-embed.js`): a
  fixed 16-step drum+piano-roll sequencer, pure synthesized Web Audio
  (oscillators/noise, no sample playback), single tempo, one melody
  voice, no recording/mixing/effects/automation at all.
- **Simulations** (`simulation-builder.js`/`sim-components.js`/
  `sim-player.js`): "power"/analysis is a BFS reachability graph plus
  Ohm's law over a single shortest path — not a real circuit solver.
  Static SVG rendering (client canvas + a hand-duplicated server-side SVG
  renderer for embeds). Undo is an in-memory JSON-snapshot stack, lost on
  reload. No digital-logic engine, no MCU emulation, no audio engine, no
  mechanical/thermal engine.
- **Shared platform**: `preview_links` and `templates` are already
  generic by content type; the full backup system already supports
  inspect-before-restore, verify, download, and restore; `error_log` and
  `webhook_deliveries` tables exist. No queue/job system beyond the daily
  cron, no roles/permissions system (single admin cookie session only),
  no automation-trigger engine.

### Photo Editor — Easy
2. Blank document creation — new modal + canvas init, same pattern as open().
3. Document presets — static size list feeding #2.
5. Canvas resizing independent of image — extend crop logic to allow canvas-only resize.
6. Image resizing with aspect lock — ctx.drawImage scale + lock checkbox.
8. ✅ Canvas-view rotation — CSS transform on stack, no pixel change. (done — see the dated entry below)
17. Layer colors/labels — metadata fields once layers exist.
18. Search/filter layers — simple list filter UI.
31. Rect/ellipse selection — canvas path, same overlay pattern as crop.
32. Freehand lasso — pointer path capture, like brush stroke.
33. Polygonal lasso — click-to-add-vertex overlay.
40. Save/name selections — JSON blob like existing photo-presets.
43. Mask-only inspection view — toggle rendering mask canvas alone.
44. Colored mask overlays — tint mask canvas, trivial compositing.
59. Named editing snapshots — extend undo snapshots with a name/label.
71. Brush size/hardness/opacity/flow — extend existing brush params.
72. Pen-pressure support — PointerEvent.pressure already available.
76. Saved brush presets — same pattern as photo-presets.
77. Hard-edged pencil — brush variant with no smoothing.
78. Airbrush buildup — brush variant with cumulative alpha.
80. Accurate brush footprint preview — extend existing drawBrushCursor.
86. Dodge/burn brushes — brightness brush, same shape as existing blur brush.
90. Magnified retouch comparison — reuse existing originalSnapshot + zoom.
92. ✅ Saved crop ratios — done (see the dated entry below this section).
93. Horizon straightening — arbitrary-angle rotate + auto-crop.
102. ✅ Shared access to website fonts — done (see the dated entry below this section).
108. Reusable text styles — preset pattern like photo-presets.
109. Missing-font warnings — font-load check + fallback message.
112. ✅ Independent corner-radius — done (see the dated entry below this section).
129. Adjustable grain — random per-pixel noise injection.
139. ✅ Local vs external-upload indicator — the Photo Editor itself already covered this (pe-hint's "Editing a library image" vs "Editing an external image" text); extended the same idea to the page builder's own image-url fields (see the dated entry below this section).
143. Searchable command palette — static command list + filter/keydown.
146. ✅ Before/after compare — done (see the dated entry below this section).
150. ✅ Status bar (dimensions/zoom) — done (see the dated entry below this section).
158. ✅ Explain resource limits — done (see the dated entry below this section).
161. ✅ Export quality/size preview — done (see the dated entry below this section).
169. ✅ Transparency preview vs backgrounds — done (see the dated entry below this section).
174. Light/dark theme preview — wrap canvas container in themed class.
- ✅ (found by critic review of #92's crop-ratio feature) `rotate90()`/
  `flip()` leaving a stale crop selection after a transform -- fixed (see
  the dated entry below this section).

### Photo Editor — Medium
4, 7, 9, 10, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 29, 30, 35, 36, 37,
38, 39, 42, 45, 46, 48, 49, 53, 55, 58, 60, 61, 62, 63, 64, 65, 66, 67,
68, 69, 70, 73, 74, 75, 79, 81, 85, 87, 88, 89, 91, 95, 98, 99, 101, 103,
104, 107, 110, 111, 116, 118, 119, 121, 122, 123, 124, 126, 127, 130,
140 (★ also enterprise-flagged: spending-limit bookkeeping), 142, 144,
147, 148, 149, 151, 152, 154, 156, 157, 159, 160, 162 (AVIF pushes toward
Hard), 170, 172, 173, 176, 177, 178 — full one-line reasons for each are
in the design conversation this session (2026-09-25); pull from there
when picking one up. Two recurring blockers worth designing around
before working this tier: most of layers/compositing/masks/nondestructive-
editing (#11-60) share ONE foundational dependency — a real layer-stack/
object-model architecture, which doesn't exist and is itself Hard, but
unlocks dozens of these cheaply once built. Recommended sequencing:
layer engine → selection-mask engine → most of the rest becomes
incremental.

### Photo Editor — Hard
1, 11, 12, 25, 26, 27, 28, 34, 41, 47, 50, 51, 52, 54, 56, 57, 94, 96,
97, 100, 105, 106, 113, 114, 115, 117, 120, 125, 128, 131, 132, 133, 134,
135 (external generative API + billing), 136, 137, 138, 141 (dockable-
panel framework rebuild — enterprise/product-shaped, flagged), 145, 153,
155, 163, 164, 165, 166 (RAW decoding — borderline infeasible in-browser),
167, 168, 171, 179. Items 131-138 (ML-assisted selection/removal/upscale/
background-replacement) all need either a browser ML model or an
external API with real billing — none of that infra exists today.

### Photo Editor — Already done
175 (explicit "save as new" vs "overwrite" already exists —
`pe-save-new`/`pe-save-overwrite`). 180 (flatten redactions / strip
metadata — canvas re-export already flattens and drops EXIF; see this
session's own EXIF-stripping feature for the upload-side equivalent).

### DAW/Audio — Already done
246 (step sequencer — the drum grid already in song-builder.js).

### DAW/Audio — Easy
184. Tempo/time-signature settings — tempo field exists; add a sibling field.
189. Session templates — default-data presets, pattern already used.
190. Multiple sessions via tabs — songs already separate D1 rows/list UI.
195. ✅ Dedicated master bus — done (see the dated entry below this section).
196. Track colors/icons/notes — metadata fields + UI, same as song name.
197. Track search/filtering — client-side list filter.
198. Hide tracks without disabling audio — separate UI flag from mute.
199. Reorder/duplicate tracks — array ops, duplicate-song pattern exists.
217. ☐ Reverse selected audio — checked: doesn't map onto the current song engine as worded. There's no AudioBuffer/sample playback anywhere in `song-engine.js`/`song-builder.js` (confirmed via grep — zero `AudioBuffer`/`decodeAudioData`/`Float32Array` hits), only synthesized oscillator notes in a step sequencer. "Reversing audio" needs a real audio buffer to exist first, which is the much bigger "Recording"/"Sampling" infrastructure this backlog already rates Medium/Hard, not a quick win. Left open rather than force-fit onto data that doesn't exist.
218. ✅ Normalize to peak — done (see the dated entry below this section).
220. Remove DC offset — subtract mean from buffer.
236. Humanization — bounded Math.random() offsets on existing grid data.
237. ✅ Transpose semitone/octave — done (see the dated entry below this section).
276. Polarity inversion — GainNode(-1).
277. Mono compatibility button — ChannelMerger sum, toggle.
301. ✅ Peak meters — done (see the dated entry below this section).
302. ✅ RMS meters — done (see the dated entry below this section).
305. ✅ Spectrum analyzer — AnalyserNode FFT + canvas draw (mirrors existing waveform canvas). (done — see the dated entry below)
309. Track/master clipping history — log exceedances like existing `log()` action table.
311. MIDI-device discovery — extend existing `requestMIDIAccess` call already present.
314. On-screen keyboard — UI wired to existing `playMelodyNote`.
315. Computer-keyboard note entry — keydown → existing note-play function.
321. ✅ Background autosave — done (see the dated entry below this section).
328. Cache waveform previews — store existing `renderWaveformPeaks` output.
329. Warn before heavy sample imports — file.size check pre-decode.
339. ✅ Export session report — dump JSON session fields to text. (done — see the dated entry below)
341. Publish track to a project — `song_id` block linking already exists.
349. Generate waveform cover art — `renderWaveformPeaks` + canvas.toDataURL + existing upload endpoint.
350. ✅ Reusable audio-player themes — done (see the dated entry below this section).
351. Save mix snapshots — snapshot the existing JSON blob as a new row.
355. Reference track/production notes — plain metadata fields.
356. Detect missing samples before export — reuse existing dangling-reference reconciliation in db.js.

### DAW/Audio — Medium
182, 183, 185, 186, 187, 188, 191, 192, 193, 194, 200, 201, 203, 204,
207, 209, 211-216, 219, 221, 222, 224, 226-230, 231-235, 238, 239, 240,
241, 242, 244, 245, 247-250, 251-253, 255-259, 260, 261, 263, 266, 268,
269, 271-274, 278, 279, 281-285, 288-290, 300, 306-308, 310, 312, 313,
316, 317, 320, 323-325, 327, 330, 331-335, 337, 343-348, 352-354, 357,
358, 360. Nearly everything here needs a multitrack clip/timeline model
that doesn't exist yet — building that once unlocks most of this tier
incrementally, same "one foundational blocker" pattern as the Photo
Editor's layer engine.

### DAW/Audio — Hard
181 (the whole missing multitrack/timeline foundation), 202, 205, 206,
208, 210, 223, 225, 243, 254, 262, 264, 265, 267, 270, 275, 280, 286,
287, 291-299 (real pitch/time DSP — phase vocoder, YIN, etc.), 303, 304,
318, 319, 322, 326, 336 (proper K-weighted LUFS loudness, none exists),
338 (compressed codecs need heavy client-side encoders), 340 (proprietary
DAW project formats effectively infeasible to support faithfully), 342
(★ also enterprise-flagged: "restricted mixer" implies per-viewer access
control beyond single-admin), 352, 359 (a sandboxed plugin architecture —
substantial new infra + security surface).

**Critic-surfaced, not yet numbered in the original 600-item list**
(tracked per the "log every critic finding" rule, found while shipping
#237's melody transpose):
- The Song builder has **no undo/redo mechanism at all** — every edit
  (note toggles, transpose, drum-pattern changes) is immediately
  permanent with no way to step back, unlike Photo Editor's 15-deep undo
  stack. Falls under the same #181 multitrack-foundation umbrella but is
  worth calling out on its own since it affects basic editing safety, not
  just advanced timeline features.
- `refreshWaveformPreview()` has a pre-existing fire-and-forget async
  race: rapid successive calls (e.g. several quick transposes or note
  edits in a row) can resolve out of order, so the visible waveform can
  end up reflecting a stale intermediate state rather than the latest
  edit. Needs a generation counter or abort/cancel-in-flight guard around
  whatever produces the waveform data.
- **(found while shipping #321's autosave)** `PATCH /songs/:id` (and by
  extension the manual Save button, unrelated to the autosave feature)
  runs an unconditional `UPDATE ... WHERE id=?` with no existence check
  and always returns `{ok:true}` — deleting a song's row (e.g. from the
  songs list) while its builder happens to still be open, then editing a
  field, shows a confident "Saved" with the edit silently discarded
  server-side (zero rows affected). Same shape as a real fix would need:
  check the D1 `.run()` result's `meta.changes` (or a `SELECT` first) and
  return 404 if nothing was actually updated, then have both the manual
  Save handler and `autosaveSong()` surface that as a real error instead
  of a false "Saved." **✅ Fixed** (see the Forty-second item entry below
  this section).

### Simulations — Already done
361 (native editable docs — the simulations table + builder). 371
(multi-select — rubber-band + shift-click already works).

### Simulations — Easy
362. Separate draft/published — new `published_data` column + toggle, like other content types.
363. Deterministic runs/seeds — sim is deterministic already; add a seed field for future randomness.
366. ✅ Reset to initial state — done (see the dated entry below this section).
367. ✅ Save checkpoints — done (see the dated entry below this section).
373. Rotate/mirror — add transform + flip pin coords, small render change.
375. ✅ Configurable snapping — done (see the dated entry below this section).
378. ✅ Search component on canvas — done (see the dated entry below this section).
380. Keyboard placement/connection — extend existing keydown handler.
385. ✅ Show hidden connections — done (see the dated entry below this section).
387. Selectable breadboard sizes — new `cols` param variant of existing breadboard def.
388. Warn same-hole leads — check during snap-drop, data already tracks hole ids.
389. Mechanical vs electrical distinction — already implicit; just surface it in UI.
391. Named nets (ground/supply) — add a `label` field to node groups.
393. Manual wire bend points — extend wire path from 2-point to polyline.
394. ✅ Wire labels — done (see the dated entry below this section).
396. ✅ Wire thickness/appearance — done (see the dated entry below this section).
397. ✅ Detect disconnected ends — done (see the dated entry below this section).
398. ✅ Highlight net from point — done (see the dated entry below this section).
401. Searchable specs — reuse palette search; add spec text field.
402. ✅ Favorites/recent — done, scoped to recent (see the dated entry below this section for why favorites wasn't also built).
403-405. Resistor/capacitor/inductor basic params — extra content fields, same pattern as resistance.
409. Relays/switches — variant of existing switch component.
410. ✅ Datasheet links — done (see the dated entry below this section).
411. Adjustable DC supply — variant of existing battery/power_supply with voltage field.
415-416. Current source / battery internal resistance — extra numeric fields feeding existing Ohm's-law path.
427. ✅ Power dissipation — done (see the dated entry below this section).
431. Voltage meter — checked: needs real per-node voltage computation this simulator's single-shortest-path model doesn't have (a true voltmeter is measured in parallel, at two arbitrary points, not something the existing single-series-path analysis can derive) — left open as genuine solver work for a future Medium-tier pass rather than force-fit. See #432's dated entry below for the reasoning and for the current-meter half of this pair, which does fit the existing analysis.
432. ✅ Current meter (ammeter) — done (see the dated entry below this section).
434. ✅ Continuity tester — done (see the dated entry below this section).
441. Basic logic gates (static icons only, no dynamic sim) — new component type.
445. Truth-table editor — simple UI table bound to a gate's static behavior.
463. ✅ Potentiometer — done (see the dated entry below this section).
524. ✅ Comments on components — done (see the dated entry below this section).
531. Consistent embed controls — mostly CSS/UI consistency pass.
533. ✅ Thumbnail from saved view — render existing SVG to canvas, export PNG. (done — see the dated entry below)
534. Public param controls — expose whitelisted fields already in `data` via player UI.
539. Deep links to component/view — URL hash + scroll/select, trivial with existing ids.

### Simulations — Medium
364, 365, 368, 369, 370, 372, 374, 376, 377, 379, 381-384, 386, 390, 392,
395, 399, 400, 406-408, 412-414, 417-420, 421-430 (DC op-point specifically;
see Hard for transient/AC), 433, 435-440, 442-444, 446-450, 456-460,
464-470, 471-478, 479-480 (feed/export audio to/from the DAW), 481-490,
491-500 (guided lessons — real new authoring subsystem, no new solver),
501-510, 511-520 (mostly documentation/QA + moderate validation code),
521-523, 525-530 (522 ★ enterprise-flagged: public template marketplace
framing; 498 ★ "…or optional account" implies multi-user), 532, 535-538,
540.

### Simulations — Hard
421-424 general case (real transient/AC/frequency-domain analysis needs
an MNA-style solver — most of a small SPICE), 430 (tunable solver
accuracy implies that same real solver), 451-455 (MCU firmware
compilation/emulation — real toolchains like avr-gcc can't run in a
Cloudflare Worker, needs an external compute service to build/maintain),
459 (peripheral-bus inspection inherits 451-455's blocker), 506
(physically-accurate overload/failure cascades — simple threshold-check
version is Medium, listed above), 514-516 as true guarantees (need the
general solver from 421-424 first), 529-530 (general netlist import
across SPICE-family dialects — substantial ongoing-maintenance parser
work).

### Shared platform — Already done
553 (conflict detection — optimistic-locking `checkConflict()` covers
pages/articles/projects). 554 (per-row revision restore already exists).
558 (backup inspect-before-restore + verify already exist). 580 (generic
`preview_links` table with token/expiry already exists). 583 (`activity_log`
+ `log()` already used everywhere). 588 (secrets/webhook URLs already
live in env bindings, not content rows).

### Shared platform — Easy
544. ✅ Shared asset identifiers that survive renaming — verified: `upsertMediaMeta()` updates `folder`/`tags`/`alt_text`/`caption`/`credit`/`license` via `UPDATE media SET ... WHERE key = ?`, never touching the `key` column itself — moving a file between folders or editing its metadata cannot change its key (and therefore its public `/media/<key>` URL and every reference to it) by construction. Already true, no work needed.
549. ✅ Project inbox for uncategorized uploads/ideas — done, scoped to media (see the dated entry below this section).
567. ✅ Show storage used by originals/versions/previews/exports — checked: "previews" and "exports" don't exist as distinct stored R2 artifacts in this codebase (no thumbnail-generation pipeline; `/export` streams a live JSON dump, never written to R2), so there's nothing to break out for those two categories. "Originals" vs "versions" is already covered — `getStorageUsage()`'s existing breakdown separates "Images" from "Image version history" (confirmed the `_versions/` PUT-overwrite route is itself content-type-restricted to images only, so that label is accurate, not just aspirational). No new work needed for what actually exists.
569. ✅ Monitor editor crashes and failed saves — done (see the dated entry below this section).
572. ✅ Choose poster images/fallbacks before publishing — done for simulations, deliberately not songs (see the dated entry below this section for why).
576. ✅ Keep animated elements from moving surrounding text — done for the plain image block (see the dated entry below this section); gallery/before-after checked and found to already have CSS-reserved dimensions, no work needed there.
582. ✅ Protect source files containing private/sensitive material — done (see the dated entry below this section).
584. ✅ Require stronger confirmation for destructive bulk operations — done (see the dated entry below this section).
595. ✅ Searchable settings with direct navigation — checked: already done earlier this session as the "Where is this setting?" search (see the dated entry above, section 12) — `SETTINGS_SEARCH_INDEX` covers all 7 Site Settings tabs with plain-language keyword matching and jumps straight to the right tab/field via the command palette.
596. Contextual help explaining unfamiliar controls — static tooltip content, no infra.

### Shared platform — Medium
541-543, 545-548 (548's transcript search needs transcripts, which don't
exist yet), 550, 551, 555, 557, 559, 560, 563, 566, 568, 570, 571,
573-575, 577-579, 589, 591-594, 598 (★ "per-module" framing leans
enterprise; the simple env-flag version is fine for single-admin), 599.

**Critic-surfaced, not yet numbered in the original 600-item list**
(tracked per the "log every critic finding" rule, found while shipping
#584's typed bulk-delete confirmation): no modal anywhere in this admin
sets `role="dialog"`/`aria-modal="true"` — a real, app-wide accessibility
gap that predates this feature and affects every one of the ~20 modals
equally, so not something to special-case in any one feature's diff.
Worth its own dedicated pass across every modal at once (add the
attributes, verify each one's focus trap and label association still
holds) rather than fixing piecemeal per-feature going forward.
- **(found while shipping #576's image-dimension fix)** Project-card
  thumbnails and article/project header images render through different
  code paths than the plain `image` block, and weren't audited for the
  same late-loading layout-shift gap — the new `width`/`height` data now
  exists in the `media` table for any of them backed by an `uploads/`
  key, so wiring them up is mostly a rendering-side change (same
  `imgSizeAttrs()` helper, different call sites) rather than needing new
  infrastructure.
- **(found by round-2 critic review of #576's image-dimension fix)**
  `/media/backfill-dimensions` (and its sibling `/media/backfill-hashes`,
  which has had the identical shape since before this feature existed)
  lists only the first 500 R2 objects with no cursor loop, so a media
  library that ever grows past 500 uploaded files would silently stop
  getting backfilled beyond that point. Not fixed as part of #576 since
  it's a pre-existing pattern shared by another route, not a regression
  introduced by this feature, and today's library is nowhere near that
  size — but worth fixing both routes together (loop on `listed.cursor`)
  if the library ever approaches it.

### Shared platform — Hard (mostly flagged as likely out of scope for a single-admin site)
552 [offline-first sync — out of scope], 556, 561-562 [job queue — out of
scope], 564-565 [multiple compute backends / per-module spending limits —
out of scope], 581 [roles/permissions beyond one admin — out of scope],
585-587 [automation-trigger engine + loop prevention — out of scope],
590 [depends on 581's nonexistent permissions — out of scope], 597
[package/dependency system — out of scope], 600 [full module-platform
governance spec — out of scope].

Next: start pulling Easy items (any area — momentum matters more than
strict item order) under the research → implement → critic-score →
iterate-to-9-or-10 workflow, logging every critic finding here as its
own line whether or not it's fixed in that pass.

### First item: #569, monitor editor crashes and failed saves

- ✅ **Client-side crash reporting, feeding the existing error_log table**
  — previously `logError()`/the "Error Log" viewer in Site Settings only
  ever received *server-side* worker exceptions (the main fetch
  handler's catch-all, scheduled cron failures); an uncaught JS error
  inside the Photo Editor, Song builder, or Simulation builder — all
  admin-only, canvas/Web-Audio-heavy code with real crash surface — just
  vanished with nothing to look back at later. Added `POST /client-error`
  (`worker/admin-api.js`, reusing `logError()` unchanged) plus a single
  pair of `window.addEventListener("error"/"unhandledrejection", ...)`
  handlers in `app.js` — since the three editor scripts run as plain
  `<script>` tags sharing this one page's `window` rather than importing
  the admin app's IIFE (the same reason `window.adminApi`/
  `window.adminUploadBlob`/`window.PhotoEditor` already exist as the
  established cross-script sharing mechanism), one pair of listeners
  here catches crashes from all three editors plus the rest of the admin
  console at once — no per-editor wiring needed. Tags each report with
  whichever editor modal (if any) is open at the time
  (`photo-editor`/`song-builder`/`simulation-builder`/`admin`), folded
  into the existing `path` column as `client:<source>` so the one viewer
  already built for this table can tell client crashes apart from
  worker ones at a glance, with zero schema change. Uses
  `navigator.sendBeacon` (with a `fetch(..., {keepalive:true})` fallback)
  matching the exact pattern `nav.js`'s `trackEvent` already
  established, so a report fires reliably even if the crash is about to
  navigate/reload the page away.
  - **Bug caught before shipping**: `logError` was never imported into
    `worker/admin-api.js` (only its sibling `listErrors` was) — the new
    route 500'd on every call. Caught via a direct authenticated curl
    (the Playwright test only showed a generic "500" status; curl
    exposed the actual `{"error":"logError is not defined"}` body).
    Fixed with a one-line import addition.
  - Verified via Playwright before shipping: a plain uncaught error with
    no editor modal open lands as `client:admin`; an uncaught error
    while the Photo Editor is genuinely open lands as `client:photo-
    editor`. **Correction**: an earlier draft of this entry overstated
    this as also covering an unhandled-rejection case and both Song
    builder and Simulation builder — those were implemented but not
    actually exercised pre-ship (caught by the critic round below via
    direct DB inspection; both now independently confirmed working, see
    below). Confirmed the new endpoint requires auth (401
    unauthenticated), added to the session's regression suite. Test
    media upload cleaned up.

**Critic round 1: 6/10.** Two real, confirmed-live findings, plus the
documentation overclaim above (all now fixed):
- ✅ **Volume/flood risk was real** — a repeating crash (reproduced via a
  loop simulating a broken canvas render loop, exactly the failure mode
  this canvas/Web-Audio-heavy code is prone to) inserted 30 near-
  identical rows into `error_log` within about a second, with zero
  dedup/throttle anywhere. Since the admin viewer only ever requests the
  50 most recent rows, a single repeating bug would completely crowd out
  older/different real errors long before the 300-row DB cap was even
  reached — undermining the feature's own purpose. Fixed with an
  in-memory per-page-load dedup keyed on `source + message` (10s
  window) — no new persistent infrastructure, matching this codebase's
  existing throttle patterns (e.g. `PAGE_SNAPSHOT_THROTTLE_MS`) rather
  than building a new rate-limiter for a single-admin tool. Verified:
  30x the identical error → exactly 1 row lands; a genuinely different
  message fired immediately after still gets through (not wrongly
  suppressed by the same window).
- ✅ **Non-Error thrown/rejected values produced useless log rows** — a
  plain object thrown or rejected coerced to the literal string
  `"[object Object]"`, losing whatever information it actually carried;
  real risk given canvas/audio code sometimes throws non-Error shapes.
  Added `describeThrown()`: an `Error` still gets its real message+stack,
  a plain object gets `JSON.stringify`'d instead of default-coerced, and
  a primitive/`undefined`/`null` falls back to a real string or a
  named default. Verified: an object throw/rejection now logs actual
  field values instead of `[object Object]`; a plain string rejection
  is unaffected. Bonus side effect: `window.onerror`'s browser-added
  "Uncaught Error: " prefix is gone too, since a real `Error`'s own
  `.message` is used directly now instead of the event's formatted
  `.message` string.
- ✅ **Song builder and Simulation builder tagging, once actually
  exercised, work correctly** — confirmed via the critic's own live
  test (opened each builder for real, threw/rejected in each): rows
  land as `client:song-builder` and `client:simulation-builder`
  correctly. No code change needed here, just verification the
  original pre-ship pass skipped.

Deferred, tracked here rather than fixed now (per the critic's own
severity read — cosmetic/non-issues, not worth churning this ticket
further):
- 🔶 `getTopModal()`'s "topmost modal" resolution is DOM-order-based —
  correctness for source-tagging implicitly depends on every current
  and future modal's position in `index.html` matching its visual
  stacking order. Confirmed still correct today (tested the Media
  Library-behind-Photo-Editor nested case explicitly), but it's a
  latent, undocumented coupling worth remembering if a new nested-modal
  case is ever added.
- 🔶 The endpoint's `if (!body.message) return 400` is effectively
  unreachable in practice since the client always sends a non-empty
  string — harmless defensive code, not worth removing.
- 🔶 `source` isn't validated against an allowlist server-side (an
  arbitrary string gets folded into `path`) — a non-issue under this
  site's single-admin trust model; an allowlist/validation layer would
  be over-engineering for who can actually call this endpoint.
- 🔶 Triggering a client error on the login screen (before
  authentication) fires an inert beacon the server correctly rejects
  with 401 — not a security issue, just a wasted network call in a
  near-impossible edge case (the login screen essentially never throws).

Full regression suite green after the round-1 fixes; test rows/media
cleaned up and confirmed gone via D1.

**Critic round 2: 8/10.** Independently re-reproduced all three round-1
fixes live (flood → exactly 1 row; a different error immediately after
still landed, so dedup isn't over-broad; waited past the 10s window and
confirmed the same error logs again rather than being permanently
suppressed) plus the three-editor tagging regression check — all
confirmed working, no regressions. One real remaining gap:
- ✅ **A circular object throw/rejection still fell back to the exact
  useless `"[object Object]"` this fix was built to eliminate** — a
  self-referencing object (a realistic accidental throw target in
  canvas/DOM-heavy editor code, e.g. an event or DOM node referencing
  its own parent) makes `JSON.stringify` throw, and the catch-block
  fallback was plain `String(value)`. Didn't crash anything and didn't
  cause flooding (the message was at least *stable*, so dedup still
  collapsed repeats correctly) but was a genuine functional shortfall,
  not cosmetic. Fixed with a `safeStringify()` using a `WeakSet`-tracked
  replacer that marks a repeated reference as `"[Circular]"` instead of
  giving up on the whole object, plus a constructor-name fallback for
  any other stringify failure (e.g. a `BigInt` field) rather than
  falling all the way back to `[object Object]`. Verified via
  Playwright: a self-referencing object thrown/rejected now logs
  `{"name":"circularTestObj","value":42,"self":"[Circular]"}` instead
  of the useless literal string, page stays fully responsive throughout,
  and all of round 1's fixes (flood dedup, scoping, window expiry,
  plain-object/string handling, three-editor tagging) re-verified
  unaffected.

Full regression suite green after the round-2 fix; test rows cleaned up
and confirmed back to baseline via D1 (`COUNT=9, MAX(id)=11`, matching
pre-test state exactly).

**Critic round 3: 9/10 — cleared, item #569 done.** Verified the
round-2 fix against harder edge cases beyond what rounds 1-2 covered:
a *deep/indirect* circular reference (two objects referencing each
other, not just direct self-reference) correctly caught and marked
`[Circular]` by the `WeakSet`-based replacer; a `BigInt` field (a real,
non-circularity stringify failure) correctly falls through to the
constructor-name fallback rather than crashing; full round-1 regression
sweep (flood dedup, three-editor tagging, plain object/string/Error
handling) re-confirmed clean. One tradeoff surfaced and explicitly
judged rather than fixed:
- 🔶 **A legitimately repeated (but non-circular) object reference in a
  thrown value gets labeled `[Circular]` too** — e.g. `{first: shared,
  second: shared}` where `shared` is the same object at two keys, not
  an actual cycle. The `WeakSet` has no way to distinguish "really a
  cycle" from "same object visited twice." Judged as a fine tradeoff
  for this specific use case (an internal admin crash log read by one
  developer, not a data-interchange contract) rather than a defect: the
  label still correctly signals "this value appears more than once,
  don't assume independent duplication," which isn't meaningfully
  misleading here. A precise fix would need path-tracking — real added
  complexity with no real payoff for a single-admin debug log. Logged
  here rather than silently accepted, per the standing "every critic
  finding gets tracked" rule, even though the verdict is "don't fix."

Item #569 (monitor editor crashes and failed saves) is done: 3 critic
rounds, 6/10 → 8/10 → 9/10, every real finding fixed and verified live,
the one remaining item a judged, tracked tradeoff rather than an
oversight.

### Second item: #549, project inbox for uncategorized uploads

- ✅ **"Uncategorized (no folder)" filter in the Media Library** —
  previously there was no way to see just the uploads nobody has ever
  sorted into a folder; "All folders" showed everything (foldered and
  not) with no way to isolate the unsorted ones, so an upload dropped
  in without a folder could sit unnoticed indefinitely. Added a
  synthetic `__uncategorized__` sentinel option to the existing
  `#media-folder-filter` dropdown (alongside "All folders" and the real
  folder list), with matching logic in `renderMediaGrid()`'s filter.
  Scoped narrowly to the Media Library's existing folder concept rather
  than a broader cross-content-type "inbox" (the triage agent's own
  framing — "just a saved filter/view over unassigned media" — matched
  this scope exactly; a page/article/project equivalent would need a
  genuinely different "uncategorized" definition per content type and
  wasn't part of this pass). Verified via Playwright: uploaded one item
  with no folder and one into a new folder, confirmed the new dropdown
  option appears, and confirmed selecting it shows only the no-folder
  item while correctly hiding the foldered one. Test uploads and the
  now-empty test folder cleaned up (folders are purely derived from
  `DISTINCT folder FROM media`, so deleting every item in one makes it
  disappear from the list on its own — no separate folder-delete
  endpoint needed or exists). Full regression suite green.

**Critic round 1: 7/10.** Confirmed clean via live testing: interaction
with all four other Media Library filters (type/search/unused/duplicates,
correct AND logic), bulk-selection scoping (selecting "Uncategorized"
then "Select all shown" only selects the visible items, a bulk move
correctly removes an item from the Uncategorized view afterward), and
saved-search restore of the sentinel value. One real, confirmed bug:
- ✅ **A real folder named literally `__uncategorized__` collided with
  the filter's sentinel value and became permanently unreachable** — the
  dropdown would render two `<option>`s sharing one `value`, and since a
  `<select>`'s `.value` always resolves to the *first* matching option
  regardless of which row was actually clicked, clicking the real
  folder's row silently showed the built-in no-folder set instead. A
  narrow, self-inflicted edge case (requires typing an internal-looking
  double-underscore string as a folder name) but a genuine, reproducible
  correctness bug, not hypothetical. Fixed at two layers rather than
  one, since the critic's own testing only checked the "+ New folder…"
  prompt but a second, completely separate client path — the bulk "Move
  selected files to folder" prompt — accepts an equally arbitrary
  string with no shared validation between them (round 2 found a
  *third* such path too, see below):
  - Client-side: the "+ New folder…" handler now rejects the exact
    sentinel string with a friendly alert explaining why, rather than
    silently creating a shadow option.
  - Server-side (the more robust fix): `upsertMediaMeta()` — the single
    write path every caller (upload, bulk-move, single-item edit)
    already goes through — silently normalizes a `folder` value of
    exactly `"__uncategorized__"` to `null` before it's ever persisted,
    so no current or future caller can reintroduce the collision by a
    path this review didn't happen to check.
  Verified via Playwright: the "+ New folder…" path now shows the exact
  alert text and creates no duplicate option; the bulk-move path now
  silently normalizes to no-folder, confirmed by the item appearing
  under the "Uncategorized" filter afterward instead of under a shadow
  folder. Original interaction tests (other filters, bulk selection,
  basic correctness) re-run and confirmed unaffected. Full regression
  suite green; no leftover test folders (folders are purely derived, so
  emptying one makes it vanish on its own).

**Critic round 2: 9/10 — cleared, item #549 done.** Re-verified both
round-1 fixes live (the "+ New folder…" alert + no-duplicate-option
check; the bulk-move path's server-side normalization to `null`,
confirmed via direct D1 query), plus a full regression sweep (Uncategorized
+ type filter AND logic, "Select all shown" scoping, saved-search
round-trip) — all intact. One genuinely new finding, and one
documentation-precision nitpick, both logged:
- ✅ **A third, previously-unnamed path to set a folder existed all
  along — the single-item 🏷 info/tags modal's plain free-text folder
  input** (`#media-info-folder`), with zero client-side guard of its
  own. Typing the sentinel there and saving PATCHes `/media/:key`
  directly. **This already worked correctly** without any additional
  fix, because it also routes through `upsertMediaMeta()` — exactly
  validating the server-side-fix design choice from round 1 ("the
  single write path every caller already goes through," which turned
  out to mean *three* callers, not the two originally named). No code
  change needed; logged here so the actual number of entry points is
  on record accurately, correcting the round-1 write-up's "two places"
  framing above.
- 🔶 **UX inconsistency between the three paths, judged as a fine
  tradeoff rather than fixed**: the "+ New folder…" path gives a
  friendly, explanatory alert and refuses the action; the bulk-move
  prompt and the info-modal text field both silently normalize to "no
  folder" with zero visible feedback — an admin typing the sentinel
  there sees their folder assignment silently do nothing, with no
  explanation. Self-acknowledged in the `worker/db.js` comment itself
  ("this function has no error-reporting path back to most of its
  callers"). Judged acceptable for this extreme, self-inflicted edge
  case (deliberately typing an internal dunder string) on a
  single-admin site rather than plumbing error-reporting through two
  more call sites for a cosmetic inconsistency — logged per the
  standing "track every finding" rule, not silently dropped.
- Confirmed near-miss folder names ("My Uncategorized Sketches",
  "uncategorized-drafts-uitest") are completely unaffected — the
  normalization is a strict equality check, not a substring match.

Item #549 (project inbox / uncategorized uploads) is done: 2 critic
rounds, 7/10 → 9/10, the real bug (folder-name collision) fixed at its
actual root (the shared write path, which robustly covered a third
entry point neither round explicitly tested for), remaining findings
judged and tracked rather than fixed or ignored.

### Third item: #146, Photo Editor before/after compare

- ✅ **Press-and-hold "Compare" button** — reuses the existing
  `originalSnapshot` (already captured at image load for the "Reset"
  button) to show the untouched original while the button is held,
  reverting to the in-progress edit on release. A `pointerdown`/
  `pointerup` pair (plus `pointerleave`/`pointercancel` so dragging off
  the button or an interrupted touch can't leave the original showing
  indefinitely with no way to release it) rather than a toggle, since
  "hold to compare" is the natural gesture here — the admin wants a
  quick look, not a mode switch. Deliberately bypasses `pushUndo()`/
  `restoreSnapshot()`: this is a momentary look, not an edit, and
  shouldn't create an undo-stack entry or reset crop state the way a
  real "return to this version" action should. Handles a real edge
  case a naive version would get wrong: if the canvas has since been
  cropped or resized, it's a different size than `originalSnapshot`, so
  the compare swap also temporarily resizes the canvas to the
  original's dimensions (and back on release) — otherwise the original
  would render clipped to the current, possibly-smaller canvas instead
  of showing the full original image. Verified via Playwright: made a
  real edit (drew a rectangle annotation) on a real 200×200 test image,
  confirmed the canvas pixel data actually changes during the hold
  (showing the original) and exactly matches the pre-compare edited
  state after release, and confirmed the undo button's enabled state is
  unaffected throughout (no phantom undo entry). Separately verified
  the crop-size-mismatch case: cropped the image down to 80×80,
  confirmed the canvas correctly grows back to the full 200×200
  original during the hold and returns to 80×80 on release. Full
  regression suite green; test upload cleaned up.

**Critic round 1: 4/10 — real, serious findings, including a live-
reproduced data-loss path.** Not a "ship with caveats" score; two
confirmed blocking bugs, all fixed:
- ✅ **Ctrl+Z pressed while Compare is held corrupted the undo/redo
  history** — the keydown shortcut has no awareness that the canvas is
  currently showing a temporary preview, not real app state:
  `undo()`/`redo()` operate on whatever's actually on the canvas at that
  instant (the original), pushing a bogus entry onto the other stack,
  and the undo's real effect was then silently discarded the moment
  the button was released (`endCompare()` unconditionally overwrites
  the canvas with the pre-compare state). Fixed with a one-line guard
  in `undo()`/`redo()` themselves (`if (isComparing()) return;`) —
  catches the keyboard shortcut AND the Undo/Redo buttons uniformly,
  wherever they're triggered from, without needing to intercept the
  keydown handler specifically.
- ✅ **The most serious finding: if a Compare hold's release event was
  ever missed for any reason, the canvas silently stayed on the
  unedited original with zero visual indication, and Save at that
  moment uploaded the original over the real edit** — live-reproduced
  by dispatching `pointerdown` with no matching release and then
  clicking Save; the resulting upload was confirmed pixel-for-pixel
  identical to the untouched original. The three release listeners
  (`pointerup`/`pointerleave`/`pointercancel`) only covered the common
  accidental-release paths, with no backstop if none of them fired
  (e.g. losing window focus with the pointer stationary). Fixed at two
  layers: `window.addEventListener("blur", ...)` and a
  `visibilitychange` listener force-end any in-progress compare
  (covering the actual scenario reproduced), and — the real hard
  backstop — `exportBlob()`, the one function both "Save as new" and
  "Overwrite original" already funnel through, now unconditionally
  calls `endCompare()` before exporting, so a save can never capture
  the temporary preview no matter what specific path left it stuck.
- ✅ **Multi-touch: a second finger pressing Compare mid-drag on another
  tool computed that drag's coordinates in two different canvas
  coordinate spaces** (the canvas's own pixel dimensions change during
  a compare swap, so a crop-drag straddling the swap got corrupted
  bounds) — single-pointer mouse/trackpad use can never trigger this,
  but real on touch. Fixed by blocking `startCompare()` while `dragging`
  (an existing tracked flag for any in-progress canvas interaction) is
  true — verified correct by code reasoning against the existing,
  already-tested `dragging` flag rather than a live multi-touch repro
  (no real touch hardware available to test against), noted here for
  honesty about confidence level.
- ✅ **No visual feedback that Compare was active** — indistinguishable
  from a normal idle button by looking at the toolbar, which directly
  compounded the stuck-state risk above. Added a `.active` class
  toggled in `startCompare()`/`endCompare()` with matching CSS
  (accent-colored border, matching the existing `.pe-tool.active`
  pattern already used for tool selection).
- ✅ **No `touch-action`/`user-select` hardening** — for a press-and-hold
  gesture specifically, a mobile browser's own long-press text-
  selection/callout handling could hijack the interaction before a
  clean pointer down/up pair ever reached the JS handlers. A
  pre-existing gap shared with the rest of this toolbar's buttons, but
  this feature is unusually exposed to it; added `touch-action: none`
  and `user-select: none` scoped to just this button.
- ✅ **Keyboard-only use of the button did nothing** — it only listened
  for pointer events, so Tab-focusing it and pressing Enter/Space (a
  `click` event, not pointer events) had no effect, unlike every other
  control in the toolbar. Added matching `keydown`/`keyup` handling for
  Space/Enter.
- Also corrected an overstated claim in the original write-up above:
  it framed pointerleave/pointercancel as meaning "an interrupted touch
  can't leave the original showing indefinitely" — that was never
  actually tested against and turned out to be false (see the stuck-
  state finding above); the real guarantee now comes from the blur/
  visibility/export-time backstops, not the release-event listeners
  alone.

Verified via Playwright: Ctrl+Z during a hold no longer alters the
canvas or the undo button's state; a deliberately "stuck" compare
(pointerdown with no release) followed by Save now correctly uploads
the real edit, confirmed via the exact function (`exportBlob`) both
save paths share; the `.active` class correctly toggles on
press/release and is force-cleared by a simulated window blur even
mid-hold; Space-key hold/release now drives the same compare behavior
as a mouse hold. Both original round-0 checks (basic correctness,
crop-size mismatch) re-run and confirmed unaffected. Full regression
suite green; all test uploads across every test script (13 total, this
round and earlier ones) cleaned up and confirmed gone.

**Critic round 2: 9/10 — cleared, item #146 done.** Every finding from
round 1 re-verified *live* (not just re-read from code), including the
exact original data-loss repro (dispatched a stuck `pointerdown` with
no release, clicked Save, confirmed the upload now matches the real
edit's bytes, not the original's) and the visual/touch/keyboard fixes
checked against actual computed styles rather than just class
presence. Confirmed the fix didn't break the common case either
(normal undo/redo with Compare never touched still works exactly as
before). One real gap found and closed immediately:
- ✅ **The multi-touch guard from round 1 only worked in one direction**
  — `startCompare()` correctly refused to start while another drag was
  in progress, but nothing blocked the *reverse* order: a second touch
  starting a brand-new crop drag while a compare was already showing
  the swapped-in original (only possible if the image had already been
  cropped/resized before that compare, so `originalSnapshot`'s
  dimensions differ from the current canvas). The critic tried hard to
  force this live with real distinct `pointerId`s and
  `pointerType: 'touch'` but couldn't get the precondition (an existing
  crop) to coincide with the reverse-order attempt in the same test
  run, so it was flagged as "reasoned about, not fully live-confirmed"
  rather than closed. Fixed with the symmetric guard the round-1 fix
  was missing: `overlay`'s `pointerdown` handler now also refuses to
  start a new drag while `isComparing()` is true. Verified via
  Playwright with the exact precondition the critic couldn't
  reconstruct: cropped a real image down (200×200 → 80×80), started
  Compare (canvas correctly grew to the original's 200×200), dispatched
  a second-pointer `pointerdown` on the overlay mid-hold, confirmed the
  crop-apply button never appeared (the drag was blocked, not just
  silently corrupted), released Compare, and confirmed the canvas
  returned to the exact cropped 80×80 state with no corruption.

Item #146 (Photo Editor before/after compare) is done: 2 critic
rounds, 4/10 → 9/10, every real finding — including a genuine
live-reproduced data-loss bug — fixed and verified live, closing even
the one gap the second critic could only reason about rather than
force to manifest.

### Fifth item: #237, transpose the melody by semitone/octave

- ✅ **Four transpose buttons above the Song builder's piano roll**
  ("Oct ↓", "↓", "↑", "Oct ↑") shift every note in the melody up or
  down by re-keying each row to a different piano-roll row rather than
  touching step timing. First checked #217 ("Reverse selected audio")
  from the same backlog batch and found it doesn't map onto the actual
  song engine at all — there's no `AudioBuffer`/sample playback
  anywhere in `song-engine.js`/`song-builder.js` (confirmed via grep),
  only synthesized oscillator notes in a fixed step sequencer, so
  "reversing audio" needs real recording/sampling infrastructure this
  backlog already rates Medium/Hard — left that one open rather than
  force-fitting it, and picked this genuinely compatible item instead.
  `PIANO_NOTES` is ordered highest-pitch-first (B4 at index 0, pitch
  decreasing as index increases), so "up" moves toward lower indices; a
  note that would land outside the fixed 2-octave C3-B4 range is
  dropped (no way to display a note above/below the visible grid) with
  a count surfaced via `alert()` so a big shift can't silently lose
  notes with no explanation. Verified via Playwright: toggled a note at
  C4, semitone-up moved it to C#4 exactly (C4 correctly cleared);
  octave-up from there correctly dropped it (alert: "1 note moved
  outside the piano roll's range and was removed") since C#5 is outside
  the 2-octave range; a note at B4 (the top of the range) octave-down
  correctly landed at B3; a note at C3 (the bottom) semitone-down
  correctly dropped with the same alert. Also verified the transposed
  state survives a real save/reload — saved a song with a note
  transposed from A4 to G#4, re-fetched it from the API, and confirmed
  `melody.notes["G#4"]` was true and `melody.notes["A4"]` was correctly
  cleared, not just visually updated client-side. Full regression suite
  green; test song deleted and confirmed gone.

Handed to a critic agent for scoring: **8/10**. Findings:

1. **(Fixed)** The destructive-drop path used a post-hoc `alert()` showing
   only a count ("1 note moved outside the piano roll's range and was
   removed") *after* already applying the transpose — inconsistent with
   the codebase's own convention (e.g. the existing song-delete flow) of
   confirming destructive actions *before* acting. Reworked
   `transposeMelody(semitones)` to compute the full effect first —
   including exactly which notes would be dropped, as `"NOTE (step N)"`
   strings — then show a `confirm()` naming the specific notes (e.g.
   `"This will remove 1 note that would move outside the piano roll's
   range: B4 (step 3). Continue?"`) before mutating any state, only
   applying on OK. A non-destructive transpose (nothing would be dropped)
   shows no dialog at all.
2. **(Fixed)** The four transpose buttons had `title` attributes but no
   `aria-label`, so a screen reader announced them only by their terse
   glyphs ("↓", "Oct ↑"). Added matching `aria-label`s to all four.
3. **(Logged, not fixed — pre-existing, out of scope for this diff)** The
   Song builder has no undo/redo mechanism at all, so a transpose (even
   with the new confirm gate) can't be undone the way Photo Editor edits
   can. This is a real, bigger architectural gap shared by the whole
   builder, not something to bolt onto this one feature.
4. **(Logged, not fixed — pre-existing, out of scope for this diff)**
   `refreshWaveformPreview()` has a pre-existing fire-and-forget async
   race (rapid successive calls can resolve out of order) that transpose
   merely triggers more often; not something to fix inside this feature's
   diff.

Re-verified via Playwright (`test_transpose_confirm.js`) after the fix:
all 4 aria-labels present and mutually distinct; a non-destructive
transpose (C4→C#4) fires no dialog and still applies; a destructive
transpose (B4 up one semitone) fires a `confirm()` with the exact
expected message; clicking Cancel leaves the B4 note untouched; clicking
OK applies it — combined with an earlier C#4→D4 shift from the same test
run, the piano roll ends with exactly one note on, at D4 (confirmed by
row/step, not just count), matching the transpose math exactly. Full
regression suite (`test_security_seo.js`) re-run green; no leftover test
songs in D1.

Resubmitted the fixed diff to a fresh critic per the strict workflow
(new code changed since the 8/10 round). Round 2: **9/10**. Live-verified
via Playwright against the actual commit (no persisted test data
afterward): confirm-Cancel preserves state; confirm-OK applies correctly
including the drop/keep split; an empty or non-destructive transpose
stays a silent no-op; a >8-notes-dropped case correctly truncates the
message to 8 named notes plus a count ("...and 8 more"); the
source→target row mapping is a uniform array shift and therefore
inherently collision-free (no two source notes can land on the same
target and silently overwrite each other); rapid double-clicks are safe
because `confirm()` is a synchronous blocking dialog, so a second click
can't be dispatched until the first resolves; all four aria-labels
render correctly at runtime. New minor items surfaced (not bugs, logged
here rather than in a numbered backlog slot since they're this-feature-only
polish, not standalone work):
- The dropped-notes list in the confirm message is ordered by
  pitch-row-then-step (iteration order) rather than chronologically by
  step — a minor readability nit for a long list, not incorrect.
- `title` and `aria-label` now carry identical redundant text per
  button — harmless (aria-label correctly overrides the glyph-derived
  accessible name, title still shows as a tooltip) but slightly
  duplicative; not worth a special-case fix.
- No automated test suite exists in this repo at all, so the lack of
  committed tests for this logic is consistent with existing practice,
  not a regression introduced by this diff.

Item #237 is done: 2 critic rounds, 8/10 → 9/10, every real finding from
both rounds fixed and verified live; the only items left standing are
explicitly minor polish (this round) or pre-existing architectural gaps
called out of scope for this diff (no undo/redo in the Song builder;
`refreshWaveformPreview()`'s async race) — both tracked above under
"DAW/Audio — Hard" rather than silently dropped.

### Sixth item: #584, stronger confirmation for destructive bulk operations

- ✅ **Typed-confirmation modal for genuinely irreversible bulk actions**
  — checked which of this admin's bulk/permanent operations actually
  have no undo path: bulk block-delete has an undo toast, article/project
  bulk-trash is a soft-delete recoverable from Trash, but media
  bulk-delete and "Empty trash" (which loops the same permanent-delete
  call across every trashed row of a kind) are both truly final, and both
  previously guarded only by a single native `confirm()` — an "OK" a
  reflexive click or Enter-press away. Added a reusable `confirmTyped()`
  modal (`#typed-confirm-modal`) requiring the exact word "DELETE" typed
  into a field before its Confirm button enables at all; Cancel, ×, or
  Escape all resolve false without touching anything. Wired it into
  media bulk-delete and "Empty trash" (kept the plain single-item
  "Delete forever" `confirm()` as-is — one target, not a bulk sweep).
  Reused the existing generic modal-focus-return `MutationObserver`
  rather than adding new focus-management code, since it already handles
  any element with the `.modal` class.
  Verified via Playwright: uploaded 2 throwaway images, selected both,
  confirmed the typed-confirm modal (not a native dialog) opens with the
  right title/message; Confirm stays disabled for no input, wrong case
  ("delete"), and a partial match ("DELET"); Cancel leaves both files
  untouched; reopening and typing the exact word enables Confirm, and
  clicking it actually deletes both files. Same pattern verified for
  "Empty trash": created and soft-deleted a throwaway article, opened
  Empty trash, confirmed Cancel leaves it in Trash, typing "DELETE" and
  confirming permanently removes it (confirmed via the trash-list API
  going empty for that row). Full regression suite green; all created
  test rows either deleted by the test itself or already gone by design
  (permanent-delete is the assertion). Note: "Empty trash" is,
  correctly, an all-or-nothing sweep of every trashed row of that kind —
  running it during this test also cleared several other already-trashed
  leftover articles from earlier in this session's own testing, which is
  the button doing exactly what it says, not a bug; worth remembering as
  a testing-hygiene note (check what's already in Trash before exercising
  "Empty trash" against shared local dev state) rather than something to
  fix in the feature itself.

Handed to a critic agent for scoring: **6/10**. Two real bugs found (both
about incidental side effects of canceling or double-firing the dialog,
not about the core "must type DELETE" guarantee, which held up in every
path the critic tried):

1. **(Fixed)** Escape inside the typed-confirm input closed the modal
   correctly but the keydown event still bubbled to the document-level
   global shortcut handler, which by then saw no open `.modal` (this one
   had already hidden itself) and fell through to its own Escape
   behavior — clearing the canvas block selection and closing the
   Inspector as an unrelated side effect of simply canceling a delete
   confirmation. Fixed by calling `e.stopPropagation()` in the input's
   Escape branch. Live-reproduced pre-fix (selected a real block, opened
   the typed-confirm modal via media bulk-delete, pressed Escape, watched
   `.admin-block.selected` disappear) and confirmed post-fix the
   selection survives.
2. **(Fixed)** `confirmTyped()` used one module-level `typedConfirmResolve`
   with no protection against a second call before the first settles —
   neither call site disables its trigger button while a confirm is
   pending, so a rapid double-trigger (e.g. two fast clicks landing before
   the modal's own overlay starts intercepting pointer events) silently
   overwrote the first call's resolver, leaving that first `await
   confirmTyped(...)` hanging forever. Fixed by having `confirmTyped()`
   settle any already-pending call as `false` before starting a new one,
   so at most one call is ever left dangling and it resolves immediately
   rather than never. Live-reproduced by dispatching two synchronous
   click events on "Empty trash" (a real double-tap can land both before
   the overlay paints) and confirming the typed-confirm input still
   correctly reset and the subsequent real confirm still completed the
   delete rather than hanging.
3. **(Fixed, incidental)** A stale code comment claimed this modal "has
   no backdrop click handler by design" — actually incorrect; the
   generic per-`.modal` backdrop-click-to-close handler already covers
   it, exactly like every other modal. Corrected the comment; no
   behavior change needed.
4. **(Logged, not fixed — pre-existing, app-wide, out of scope for this
   diff)** No modal in this admin (not just this new one) sets
   `role="dialog"`/`aria-modal`. A real gap, but predates this feature
   and affects every modal equally — not something to special-case here.

Re-verified via Playwright after the fixes: a real page+block selection
survives pressing Escape inside the typed-confirm input (previously
verified live to be cleared pre-fix); dispatching two synchronous click
events on "Empty trash" back-to-back leaves the input correctly reset to
empty rather than showing stale text, and the delete still completes
normally afterward with no hang. Full regression suite green; all test
pages/media/articles created during this round (plus leftover data from
an earlier interrupted test run) cleaned up and confirmed gone.

Item #584 is done: 1 critic round, 6/10, every real finding (2 bugs + 1
stale comment) fixed and verified live; the one remaining item (no
`role="dialog"` anywhere in the admin) is a pre-existing, app-wide gap
explicitly out of scope for this diff, tracked here rather than silently
dropped — a real future accessibility item worth its own pass across
every modal at once rather than fixing piecemeal per-feature.

Resubmitted the fixed diff for a fresh critic round (new code changed
since the 6/10 round). Round 2: **9/10**. Both fixes independently traced
through the actual causal chain (the document-level Escape handler at
app.js's global keydown listener, and `confirmTyped()`'s single shared
resolver) and live-reproduced against the real app: Escape inside the
input now preserves canvas block selection; a rapid programmatic
double-trigger on media bulk-delete fires exactly one
`/api/admin/media/bulk-delete` call (verified via a routed fetch
intercept, not just outcome-checking) with no hang and a correctly-reset
input. Explicitly checked for new problems the fixes themselves might
introduce — a same-tick hide/show replay on a fast re-trigger (no visible
flicker, the CSS open-animation just replays cleanly) and whether
`stopPropagation()` on Escape could suppress some other legitimate
listener (it can't — the single document-level Escape handler's other
branches are mutually-exclusive fallbacks for "nothing else is open,"
and this modal already fully handles its own Escape case) — neither
panned out as a real issue. Correctly did not re-flag the already-tracked
app-wide `role="dialog"` gap. The only noted item is a theoretical,
never-actually-observed animation-replay edge case, not a bug.

Item #584 is fully closed: 2 critic rounds, 6/10 → 9/10, every real
finding from round 1 fixed and verified; round 2 found nothing new.

### Seventh item: #366, reset a simulation to its initial state

- ✅ **A "Reset" button next to Undo/Redo in the Simulation builder** —
  same pattern as the Photo Editor's own Reset: `confirm()` before
  discarding anything, and the reset itself pushed onto the existing
  undo stack so it can be undone too. The one design decision worth
  recording: "initial state" means the *last saved state*, not literally
  whatever `simData` held the instant the builder modal opened. The
  builder modal stays open after clicking Save (no close/reopen), so a
  naive "snapshot on open, restore that forever" version would let an
  admin save real progress, keep editing, then hit Reset expecting to
  undo just their unsaved changes — and instead silently lose the saved
  work too, wiping all the way back to session start. Fixed by having the
  save handler re-snapshot `initialSimSnapshot` on every successful save,
  so Reset always means "discard everything since the last save,"
  matching what "Reset" would actually be expected to do and avoiding a
  data-loss trap before it could ever ship. Verified via Playwright:
  placed a component on a brand-new (never-saved) simulation, Reset
  correctly cleared it back to 0 parts; placed a component, saved, placed
  a second component, Reset correctly kept the first (saved) part and
  dropped only the second (unsaved) one; undoing that Reset correctly
  restored both parts. Full regression suite green; test simulation
  deleted and confirmed gone (simulations have no soft-delete/trash —
  `DELETE /simulations/:id` is already a hard delete, so no separate
  permanent-delete call was needed).

Handed to a critic agent for scoring: **9/10**, no real bugs. Specifically
checked and confirmed correct on the first try: Reset on a never-saved
simulation goes to blank/template state; a failed save (network/API
error) leaves `initialSimSnapshot` untouched since the re-snapshot line
sits after the `await` inside the `try` block, so a rejected save can't
poison what Reset targets; Reset→Undo→edit→Reset again correctly
re-targets the same unchanged snapshot; "Save as template" (a separate
copy-out action) correctly leaves the snapshot alone; switching between
two different simulations in the same session shows no snapshot leakage
across them (`openBuilder()` unconditionally recaptures on every call);
importing a JSON circuit only pushes undo history, so Reset after an
Import correctly discards the imported data back to the last real save.
Minor items logged only (both are pre-existing UX precedent already
shared by the Photo Editor's own Reset button, not something to
special-case here): the Reset button has no disabled state when nothing
would actually change, and it uses blocking `confirm()`/`alert()` like
the rest of this admin.

Item #366 is done: 1 critic round, 9/10, no real findings — the design's
deliberate "snapshot targets the last save, not the state on open"
choice held up under every edge case tried, including the save-failure
and cross-simulation-switch cases that would have been the most likely
places for a subtle data-loss bug to hide.

### Eighth item: #367, named checkpoints for simulations

- ✅ **Save/restore/delete named checkpoints, persisted with the
  simulation** — a select dropdown plus Save/Restore/Delete buttons next
  to the new Reset button. Unlike undo/redo (in-memory, wiped the moment
  the builder closes) or Reset (only ever targets the single last-saved
  state), checkpoints are named, persistent snapshots an admin can create
  and jump back to at will, and they survive closing and reopening the
  builder. The one design decision worth recording: checkpoints are
  deliberately kept OUT of `simData` itself the rest of the time (a
  separate `simCheckpoints` array, only merged into the outgoing payload
  as `{...simData, checkpoints: simCheckpoints}` at save time, and split
  back out on load) rather than living inside `simData` as the backlog
  wording ("named snapshots array in `data`") might suggest at first
  read. Reason: `pushHistory()` (the existing undo system) snapshots the
  *entire* `simData` object on every single edit — if checkpoints, each
  one a full circuit snapshot, lived inside `simData`, every one of up to
  50 undo-stack entries would carry a redundant copy of every checkpoint,
  multiplying memory use by the checkpoint count on every edit. Keeping
  them as a sibling that only rides along at save/load time avoids that
  entirely while still meeting the actual goal (persisted with the
  simulation's `data` column). Capped at 20 checkpoints (oldest dropped
  first) so an admin can't unboundedly bloat one row's JSON blob without
  noticing. "Save as template" (a separate copy-out action, unaffected)
  correctly continues to save bare `simData` with no checkpoints, since a
  template is a fresh starting point, not a continuation of the
  original's checkpoint history.
  Verified via Playwright: placed 2 parts, saved a "Stage 1" checkpoint;
  added a 3rd part (not checkpointed); restoring "Stage 1" correctly
  dropped back to 2 parts; undoing that restore correctly returned to 3
  (checkpoint restore pushes onto the same undo stack as any other edit,
  so it's itself undoable); redid the restore, saved the simulation under
  a real name, closed and reopened the builder for that same simulation
  from the list — the "Stage 1" checkpoint was still there, confirming it
  actually persisted in the saved `data` blob rather than just living in
  that session's memory; deleting the checkpoint removed it from the
  dropdown. Full regression suite green; test simulation deleted and
  confirmed gone.

Handed to a critic agent for scoring: **8/10**. One real (low-severity)
finding:

1. **(Fixed)** The Restore/Delete click handlers guarded against "nothing
   selected" with `const i = Number(select.value); if (!simCheckpoints[i])
   return;` — but `Number("")` is `0`, not `NaN`, so that guard actually
   only catches out-of-range indices, not the blank-placeholder case
   itself. The critic reproduced it directly by force-enabling the
   buttons while the select sat at its blank value: Restore silently
   restored checkpoint 0 with no indication nothing was really selected.
   Not reachable through normal mouse/keyboard use today (the select
   always resets to blank and both buttons disable together on every
   render), but a real logic defect rather than a guard that's only
   correct because something else happens to keep it from firing — it
   would bite immediately if either button were ever re-enabled from a
   different code path. Fixed with a small `selectedCheckpointIndex()`
   helper that returns `-1` for the blank value instead of coercing it to
   `0`, used by both handlers instead of a bare `Number(...)`.
2. Everything else the critic checked came back correct on the first
   pass: no stale-index bug after delete/save (the select is fully
   rebuilt and reset to blank on every mutation); no cross-simulation
   checkpoint leakage between opening different simulations, a template,
   or a brand-new one; saving a checkpoint on a never-saved simulation
   works correctly since `simCheckpoints` doesn't depend on `currentSimId`.

Re-verified via Playwright: reproduced the critic's exact scenario
(force-enable Restore/Delete while the select sits at blank) and
confirmed neither button's confirm() dialog fires or touches
`simCheckpoints` anymore, while a real selection still restores/deletes
correctly. Full regression suite green.

Resubmitted for a fresh critic round (new code changed since the 8/10
round). Round 2: **9/10, zero findings**. Reproduced the round-1 critic's
exact scenario (force-enable Restore/Delete while the select sits at
blank) and confirmed neither button fires its confirm() or touches
`simCheckpoints` anymore; confirmed `simCheckpoints[-1]` really is
`undefined` in JS so the `-1` sentinel can never collide with a real
index; confirmed the normal select→Restore/Delete path still works
correctly (no regression from the fix); checked the Save handler and
`openBuilder()`'s load/reset paths for any similar blank/zero confusion
and found none — the save path never reads the select at all, so it was
never exposed to this class of bug in the first place.

Item #367 is fully closed: 2 critic rounds, 8/10 → 9/10, the one real
finding from round 1 fixed and verified; round 2 found nothing new.

### Ninth item: #150, Photo Editor status bar (dimensions/zoom)

- ✅ **A small status readout next to the existing hint text** — this
  editor has no manual zoom control, it auto-fits the canvas to the
  viewport (`fitCanvasToViewport()`), so "zoom" here means the actual
  fit ratio currently in effect, alongside the image's real pixel
  dimensions. Hooked the update into `fitCanvasToViewport()` itself
  rather than each individual caller, since every place that changes
  canvas dimensions (load, crop, rotate, undo/redo/reset, Compare
  start/end, window resize) already calls it — one hook point,
  automatically correct everywhere with no risk of a caller forgetting
  to update it separately. Verified via Playwright: opened a real
  1200×630 image, status bar read "1200 × 630px · 79% displayed";
  rotating 90° correctly swapped to "630 × 1200px · 42% displayed";
  undoing the rotate correctly reverted to the exact original string.
  Full regression suite green; test media deleted and confirmed gone.

Handed to a critic agent for scoring: **9/10**, no real bugs. Specifically
checked and confirmed correct: the Compare feature's press-and-hold shows
the *original* image's dimensions even when the working canvas had
already been cropped to a different size, and correctly reverts on
release (including when interrupted by the existing blur-triggered
force-end, unrelated to this diff); a tiny (20×15) image correctly caps
at "100% displayed" rather than showing an upscaled percentage above
100%; no `300×150` canvas-default flash before an image loads, since
`canvas.width`/`height` are only ever set inside `img.onload`, which runs
before the modal becomes visible; no divide-by-zero/NaN path found for
`stack.parentElement.clientWidth` since every call site either runs after
the modal is already visible or is explicitly guarded by `if
(!modal.hidden)` (the resize listener). Two minor/out-of-scope notes
logged only: an extremely tiny percentage would render as "0% displayed"
(not reachable in practice since `MAX_DIMENSION = 2000` already caps
load-time image size), and the status bar has no `aria-live` region for
screen readers (an accessibility nicety, not a regression).

Item #150 is done: 1 critic round, 9/10, no real findings.

### Tenth item: #161, Photo Editor export quality/size preview

- ✅ **Format selector (PNG/JPEG/WebP), quality slider, and a live
  estimated-size readout for "Save as new"** — while scoping this I found
  a real pre-existing bug worth fixing in the same diff rather than
  working around it: `exportBlob()` always hardcoded `"image/png"`, which
  meant "Overwrite original" on a JPEG or WebP source image silently
  converted it to PNG bytes stored under its original (non-`.png`) R2 key
  — a real, previously invisible content-type/extension mismatch with
  every use of that file. Fixed by adding `originalMimeType()`, which
  derives the correct format from the original key's own extension, and
  making "Overwrite" always use that — regardless of what format is
  selected in the new dropdown — since the R2 object key's extension is
  fixed once uploaded and can't be changed by an overwrite. GIF/SVG
  originals still fall back to PNG on overwrite (unchanged from before):
  `canvas.toBlob()` has no encoder for either format, and a GIF's
  animation is already destroyed the moment it's loaded into a canvas at
  all (only the first frame is ever drawn) — an unavoidable limitation of
  canvas-based export, not something fixable here, logged rather than
  silently left unmentioned.
  "Save as new" gets the real feature: a format dropdown (defaulting to
  PNG, matching prior behavior) with a quality slider that only appears
  for JPEG/WebP (PNG's toBlob quality argument is meaningless and ignored
  by browsers), and a debounced (150ms) live size estimate recomputed on
  every format/quality change and on every canvas-dimension-changing edit
  (reusing the same `fitCanvasToViewport()` hook point the status-bar
  feature added). Deliberately scoped the live estimate to NOT refresh on
  every content-only edit (a brush stroke, a filter, an adjustment slider)
  — hooking that would mean scattering size-estimate calls across many
  scattered mutation points for a bigger win than an "Easy" item
  warrants; the actual uploaded/overwritten file is always encoded fresh
  from the live canvas regardless, so this scoping only affects how
  current the *preview number* looks, never what actually gets saved.
  Verified via Playwright with a real photographic-content test image
  (a synthetic noisy PNG, not a flat single-color one — an earlier test
  run with a solid-color fixture showed no size difference between
  quality levels purely because a flat color has nothing left to compress
  away, not because of an app bug): PNG estimate ~184.6 KB, JPEG @85%
  ~64.6 KB, JPEG @10% ~5.9 KB — quality clearly affects the estimate in
  the right direction. Saving as new at JPEG format produced a real
  `.jpg`-extensioned key with `content-type: image/jpeg` actually served.
  Overwriting a PNG original with JPEG selected in the dropdown correctly
  still wrote back `content-type: image/png`, confirming the
  format-preservation fix. Full regression suite green; all test media
  deleted and confirmed gone.

Handed to a critic agent for scoring: **7/10**. One real (low-severity)
finding, plus one real but pre-existing, out-of-scope bug surfaced along
the way:

1. **(Fixed)** `#pe-export-quality`'s slider *value* was never reset when
   opening a new image — only the format dropdown and the quality label's
   `hidden` state were. Set format=JPEG, quality=15% on image A, close,
   open a different image B: format correctly reset to PNG (quality
   control correctly hidden), but the underlying slider value silently
   stayed at 15 instead of the declared 85 default. If the admin then
   switched image B's format to JPEG/WebP, they'd silently get 15%
   quality instead of the expected default, unless they noticed the
   slider's visual position. Never caused an estimate/actual-save
   mismatch (both always read live DOM state at the moment of use), so a
   UX/state-hygiene bug, not a data-corruption one. Fixed by also
   resetting the slider's `.value` to 85 in the same reset block.
2. **(Fixed, pre-existing, unrelated to this diff but found while
   reviewing it)** `/media/bulk-delete` never cleaned up a file's
   "Overwrite" version history — the single-item `DELETE /media/:key`
   route already deletes each archived `_versions/` R2 blob and its
   `media_versions` D1 rows before deleting the file itself, but the
   bulk-delete route only ever deleted the file's own R2 object and
   metadata row, leaving orphaned R2 objects and dead D1 rows behind for
   any file that had ever been overwritten and was later deleted via a
   bulk selection instead of one at a time. Confirmed via the critic's
   own testing (their overwrite-test files left `_versions/` blobs behind
   after bulk-delete) and fixed by mirroring the single-item route's
   cleanup logic into bulk-delete. Not something to leave "logged only"
   given it was cheap, directly related to the version-history mechanism
   I'd been exercising all session, and a genuine storage-leak bug on a
   real destructive-action code path.
3. Everything else the critic checked came back correct on the first
   pass: "Save as new" actually saves in the selected format/quality
   (verified byte-for-byte consistent with the live estimate, not just
   cosmetically matching); Overwrite's format-preservation fix works for
   JPEG and WebP originals too, not just PNG, confirmed all the way to
   the R2-stored content-type, not just client-side; format/quality
   selection survives Undo/Redo/Reset/Compare correctly; switching images
   correctly resets the format dropdown (just not, until this fix, the
   slider value); `formatBytesLite()`'s boundary cases (0 bytes, exactly
   1024 bytes) render correctly.

Re-verified via Playwright: reopening an image after selecting
JPEG/15% on a previous one now correctly shows PNG selected and the
slider back at 85; overwriting a file after one prior overwrite (one
`media_versions` row + one archived R2 blob) then bulk-deleting it now
correctly shows 0 remaining version rows instead of leaking. Full
regression suite green.

Resubmitted for a fresh critic round (new code changed since the 7/10
round). Round 2: **9/10, no real bugs**. Verified byte-for-byte: bulk-
deleted a mixed batch of 5 files (2 versioned at 2 and 1 overwrites
respectively, 3 with zero versions) in one call and confirmed via
`/storage-usage`'s `_versions/`-prefix count that exactly 3 version
blobs were removed (matching the 2+1 from the two versioned files, zero
cross-contamination between keys inside the `Promise.all`), the D1
`media` row count and `uploads/` R2 count both dropped by exactly 5, and
the two deleted version rows' image endpoints now 404 instead of still
serving orphaned bytes; a zero-version file in the same batch correctly
no-ops through an empty `listMediaVersions()` array rather than
erroring the whole batch. Confirmed the slider-reset fix holds for a
rapid re-open of the SAME image too (not just a different one), since
`open()` unconditionally resets format/quality on every call. One
minor/out-of-scope observation logged: a very large bulk selection of
heavily-versioned files fans out into a lot of parallel R2/D1 calls with
no per-key error isolation (one key's call throwing rejects the whole
batch) — an existing pattern already shared by other bulk actions in
this codebase (e.g. bulk-tag), just proportionally amplified here, and
not a functional problem at this site's actual single-admin scale.

Item #161 is fully closed: 2 critic rounds, 7/10 → 9/10, both real
findings from round 1 fixed and verified; round 2 found nothing new.

### Eleventh item: #321, Song builder background autosave

- ✅ **Autosave on every edit path, matching the article/project
  pattern** — the Song builder previously had zero autosave/crash-
  recovery wiring at all (flagged twice earlier this session as an
  out-of-scope finding while working on unrelated Song builder items),
  unlike pages/articles/projects which all share the same debounced-
  autosave pattern. Rather than piggyback on the existing
  `refreshWaveformPreview()` function (called from nearly every edit
  site, which would have made it a tempting single hook point like the
  Photo Editor's `fitCanvasToViewport()` or the Simulation builder's
  save handler), I checked its body first and found an early return —
  `if (visualization !== "waveform") return;` — meaning it does nothing
  at all for the two other visualization modes ("bars"/"pulse"). Hooking
  autosave there would have meant autosave silently never firing for the
  majority of songs (bars is the default). Wired `scheduleAutosave()`
  explicitly into every real mutation site instead: step toggles (shared
  by both the drum grid and piano roll), tempo/kit/waveform/visualization/
  page-sync controls, the song name field, and `transposeMelody()`.
  Only autosaves a song that's already been explicitly saved once (has an
  id) — a brand-new song still needs a deliberate first Save, same
  reasoning as the article/project autosave's own guard. No optimistic-
  locking/conflict system exists for songs (no version column, unlike
  articles/projects), so unlike those two this can't detect a concurrent
  edit from another tab — an accepted gap on a single-admin site with no
  realistic concurrent-editor scenario, and not a regression this feature
  introduces (the existing manual Save button has no conflict check
  either).
  Found and fixed one real subtle bug before it could ever ship: because
  `openBuilder()` is async and awaits a fetch before reassigning
  `songData`, a pending autosave timer from song A could fire *during*
  that await window — after `currentSongId` had already moved on to song
  B but `songData` was still A's stale content — silently overwriting
  B's row with A's data. Fixed by clearing the pending timer at the very
  start of `openBuilder()`, before reassigning anything, mirroring the
  article editor's own documented fix for the identical race. The
  tradeoff this introduces (accepted, matching the article pattern
  exactly): switching songs within the ~2-second debounce window of an
  edit discards that specific edit rather than risking it landing on the
  wrong song — silent data loss of a few seconds' work is the safer
  failure mode than silent data corruption of a different song, and this
  exact tradeoff already exists in the article/project autosave too.
  Verified via Playwright: a step toggle on a never-saved song shows no
  autosave status at all (no id yet); after an explicit first Save,
  toggling another step shows "Unsaved changes…" then "Saved HH:MM:SS"
  ~2s later, and the change is confirmed actually persisted server-side
  via a fresh GET, not just cosmetic; a tempo change autosaves and
  persists correctly too. Race-condition repro: created song B, made an
  edit to song A (scheduling A's timer), immediately switched to B and
  waited well past the debounce window — confirmed song B's tempo and
  melody were completely untouched by A's data (the corruption case is
  closed), and separately confirmed that giving an edit the full 2-second
  window before switching away does correctly persist it (the accepted
  discard-on-immediate-switch tradeoff only bites when switching faster
  than a human realistically would after a single toggle). Full
  regression suite green; test songs deleted and confirmed gone.

Handed to a critic agent for scoring: **6/10**. One significant real bug,
one minor real bug, one pre-existing (unrelated) real bug newly exposed
by this feature, and one confirmed design-intent gap:

1. **(Fixed, the most serious finding)** The generation-counter-shaped
   fix I'd already built only guarded against a STALE AUTOSAVE TIMER
   firing after a switch — it did nothing about two overlapping
   `openBuilder()` calls themselves. Clicking Edit on song A, then song B
   before A's GET resolved, meant whichever response came back LAST won
   — regardless of which song the admin actually meant to open —
   silently repopulating the form/`songData` with the wrong song's
   content while `currentSongId` correctly pointed at the one actually
   clicked last. The critic reproduced this live (delayed A's fetch via
   route interception, clicked A then B ~50ms apart) and confirmed a
   subsequent edit's autosave PATCH actually overwrote song B's row with
   song A's name/tempo/kit/waveform — real, confirmed data corruption of
   an unrelated song's saved content, not just the accepted "discard a
   few seconds of the most recent edit" tradeoff. Fixed with an
   `openGeneration` counter bumped on every `openBuilder()` call and
   checked immediately after the await; a superseded call now bails out
   before touching the form or `songData` at all.
2. **(Fixed)** A narrower sibling of the same class: if an autosave PATCH
   was already in flight (its 2s timer already fired) when the admin
   opened a different song, the save itself still correctly targeted the
   original song (its id/body were captured synchronously before the
   await), but the eventual "Saved HH:MM:SS"/"Autosave failed" status
   text still got written into `#song-autosave-status` for whatever song
   was now open — a misleading status message, not data corruption.
   Fixed by capturing the same generation token in `autosaveSong()` and
   suppressing the status write (and the `refreshSongOptions()` call) if
   a newer `openBuilder()` call has started since.
3. **(Logged, not fixed — pre-existing, unrelated to this diff, but a
   real gap this feature exposes in a new unattended way)** `PATCH
   /songs/:id` has no existence check and always reports success even if
   the row is already gone (e.g. deleted from the songs list while its
   builder was still open) — the manual Save button already had this gap
   too, autosave just means it can now happen silently in the background
   with no admin action to notice a problem around. Added as a new
   backlog item under "DAW/Audio" rather than fixed here, since it needs
   a small server-side existence check shared by both save paths, not a
   one-line change scoped to this feature.
4. **(Fixed)** The commit's own description claimed this "mirrors the
   article/project autosave," but never actually wired the equivalent of
   `unsavedDirty`/the `beforeunload` warning — app.js's `unsavedDirty`
   variable and its listener live in a different IIFE this file has no
   access to, so closing the tab within the 2s debounce window after an
   edit gave no warning at all, a real divergence from the feature's own
   stated design intent (not one of the already-accepted tradeoffs).
   Fixed by adding a separate `songHasUnsavedChanges` flag and this
   file's own `beforeunload` listener (multiple listeners on the same
   event coexist fine; the browser shows one dialog regardless of how
   many set `preventDefault()`), set true on every schedule and false on
   a successful autosave or manual save.
5. Confirmed correct, not a bug: `transposeMelody()`'s confirm-cancel
   path returns before both the mutation and `scheduleAutosave()`, so
   canceling a destructive transpose never schedules a pointless
   autosave. Closing the builder (not switching songs) without an
   explicit save correctly lets the pending autosave complete in the
   background against the right song, since nothing about the open
   song's identity/data changes on close.

Re-verified via Playwright: reproduced the critic's exact overlapping-
open scenario (delay song A's fetch, click A then B before A resolves)
and confirmed the form now correctly shows only B's data with no A
leakage, and a subsequent edit's autosave correctly lands on B alone —
song A's row verified completely untouched afterward. Reproduced the
status-bleed scenario (schedule an autosave on A, immediately switch to
B before the timer fires) and confirmed no stray status text appears for
B. Verified the new `beforeunload` guard: blocked with `false` before any
edit, `true` right after an edit and before the 2s autosave completes,
back to `false` once it completes. Full regression suite green; test
songs deleted and confirmed gone.

Item #321 is done: 1 critic round, 6/10, every real finding fixed except
the one explicitly pre-existing/unrelated gap (the fake-"Saved"-on-a-
deleted-row bug), which is tracked in the backlog above rather than
fixed inline since it needs a small shared server-side change, not a
client-only one scoped to this feature.

Resubmitted for a fresh critic round (new code changed since the 6/10
round). Round 2: **9/10**. All three round-1 fixes independently
re-verified live under the exact same reproductions (delayed-fetch
overlapping-open race, status-bleed-on-stale-autosave, and the full
five-step `beforeunload` lifecycle including after a manual Save, not
just an autosave). Explicitly hunted for new bugs the generation-counter
fix itself might introduce — opening the same song twice in a row or a
brand-new blank song never gets wrongly dropped as "superseded" (the
new-song branch has no `await` to straddle a generation bump at all),
and no legitimate autosave was ever wrongly suppressed in any tested
path. Correctly did not re-flag the already-deferred `PATCH /songs/:id`
existence-check gap. The only note: the fix that lets `autosaveSong()`
safely capture `openGeneration` only once its timer callback actually
starts (relying on `openBuilder()`'s unconditional `clearTimeout` to
guarantee no stale timer can still be pending by then) is an implicit
invariant rather than something explicitly asserted — added a comment
tying the two together so a future edit that removed that `clearTimeout`
would have a pointer to what else needs to move with it, rather than
silently reintroducing the bug.

Item #321 is fully closed: 2 critic rounds, 6/10 → 9/10, every real
finding from round 1 fixed and verified; round 2 found nothing new
beyond a documentation nit, addressed with a comment.

### Twelfth item: #582, protect private/sensitive source files

- ✅ **A "Private" flag on individual media library files, gating the
  public `/media/:key` route** — checked what "protection" actually meant
  in this codebase today and found there wasn't any at all: any uploaded
  file under `uploads/`, `scans/`, `audio/`, `video/`, or `fonts/` is
  servable via `/media/<key>` to anyone with the link, forever, with the
  file's unguessable key as the only real barrier. A source file with
  genuinely private/sensitive content (a personal document scan, an
  unreleased draft) uploaded into the media library for admin-only
  reference had no way to actually stay admin-only. Added a `private`
  column to the `media` table (applied to local D1 directly, matching how
  every other schema addition this session went in, since there's no
  migration runner in this project) and gated the public route: an
  `uploads/`-prefixed key with `private = 1` now 404s for anyone not
  authenticated — 404, not 401, so an anonymous request can't distinguish
  "private" from "doesn't exist," matching this route's existing
  not-found behavior rather than confirming a private file's existence to
  an outside observer. Scoped the DB lookup to `uploads/` specifically:
  that's the only prefix with rows in the `media` table at all
  (scans/audio/video/fonts are managed by their own tables and were never
  "private-capable"), so a lookup miss for those just means "not private,"
  preserving their existing always-public behavior with zero risk of an
  accidental new gate.
  Wired a checkbox into the existing media info modal (`upsertMediaMeta()`
  already had a clean single-write-path pattern to extend — same one the
  folder-collision fix from earlier this session went through). Reused
  the same "warn before an action with a visible consequence" pattern
  already used before deleting a used file: turning "Private" ON for a
  file currently referenced by a published page/article now shows exactly
  which page(s)/article(s) use it and requires confirming, since marking
  it private breaks that reference's direct URL for anonymous visitors
  the moment it saves — worded for this case rather than reusing delete's
  "safe to delete" phrasing verbatim. Added a small red "Private" badge
  to the media grid (stacked below the existing Unused/Duplicate badges,
  all three can coexist on one file) so an admin can see at a glance
  which files are gated without opening each one's info modal.
  Found and fixed a real bug of my own before it could ship: the `GET
  /media` list route hand-builds each returned item from an explicit
  field list rather than spreading the DB row, so the new `private`
  column silently never reached the client even though the server-side
  write path was already correct — the checkbox always showed unchecked
  and the badge never appeared, despite the actual protection already
  working. Fixed by adding `private` to that explicit field list.
  Also checked a real regression risk before considering this done: the
  Photo Editor's own image loader sets `img.crossOrigin = "anonymous"`,
  which for a plain cross-origin image strips cookies from the request —
  if that also applied to a same-origin `/media/...` request, marking a
  file private would have broken the admin's own ability to ever open it
  in the Photo Editor again, even while logged in. Verified live that
  this is NOT the case: Chromium correctly still sends same-origin
  cookies alongside `crossOrigin="anonymous"` (the attribute only
  suppresses credentials for a genuinely cross-origin request), so
  editing a private file continued to work correctly with no change
  needed there.
  Verified via Playwright: an uploaded file is publicly fetchable (200)
  before marking private; marking it private correctly returns 404 to an
  anonymous request (using `cache: "no-store"` in the test itself after
  first catching my own test-methodology mistake — a plain `fetch()` on
  the same URL from the same browser context just replayed the route's
  own `max-age=300` cached response without hitting the network again,
  which looked exactly like a live bug until isolated with a fresh
  no-cache request and a fresh anonymous context); still fetchable by the
  authenticated admin; the Photo Editor still opens it for editing; the
  grid badge appears; canceling the usage-warning dialog correctly leaves
  the file untouched and still public; accepting it correctly saves and
  the file becomes unreachable anonymously. Full regression suite green;
  all test pages/media deleted and confirmed gone.

Handed to a critic agent for scoring — this being a genuine security
feature, asked specifically for a hard bypass hunt: **8/10, no bypass
found**. The critic tried case-uppercasing the whole path, a trailing
slash, `/./` and `..` traversal, a double slash, a URL-encoded segment,
and a query string against a marked-private file — all correctly 404'd,
none reached the bytes. Confirmed `_versions/` (overwrite-history) keys
can never match the public route's regex at all regardless of privacy
status (pre-existing, not a regression), and the only route that DOES
serve version bytes sits behind the blanket admin-API auth gate.
Confirmed `isAuthenticated()` fails closed on every bad-input path
(missing cookie, malformed token, bad HMAC, expired/non-numeric
timestamp) with no throw path and nothing defaulting open. Confirmed the
usage-warning's coverage (image/gallery/before-after/background blocks,
every OG-image field, before-after body shortcodes, scan posters) has no
silent gap, and un-marking a file private correctly restores public
access. Two real, minor findings, both fixed:

1. **(Fixed)** `upsertMediaMeta()`'s INSERT branch (used when a media row
   doesn't already exist) never included the `private` column, so a
   theoretical `upsertMediaMeta(env, key, { private: true })` call
   against a key with no existing row would silently create it as public
   instead. Not reachable through any real UI flow today (upload always
   creates the row via a separate `{ hash }` call before the info modal's
   PATCH could ever fire), but a real defense-in-depth gap in a security
   feature's own write path — fixed by adding `private` to the INSERT
   statement's column list. Verified by PATCHing a key that had never
   been uploaded (forcing the INSERT branch) and confirming via a direct
   D1 read that the row actually persisted `private = 1`, not silently 0.
2. **(Fixed)** The route's pre-existing `Cache-Control: public,
   max-age=300, must-revalidate` header now has real security relevance
   it didn't before: a copy of a file cached by a shared cache (a CDN/
   proxy in front of the worker, or any cache honoring "public") while
   the file was still public could keep being served to a completely
   different, unauthenticated visitor for up to 5 minutes after the file
   is marked private, since `max-age=300` means no revalidation request
   happens at all within that window — this doesn't retroactively purge
   copies already cached from before the flip (no CDN purge-API
   integration exists to do that, and adding one is real infrastructure
   work disproportionate to a personal single-admin site), but it should
   at minimum stop making the problem worse going forward. Fixed by
   serving `Cache-Control: private, no-store` specifically for a private
   file's response (and skipping the ETag/304 shortcut for it too, since
   there's nothing left to revalidate against) — public files keep the
   exact previous behavior unchanged.

Re-verified via Playwright: a public file still returns
`public, max-age=300, must-revalidate`; a private file, fetched
authenticated (the only party who can reach it now), returns
`private, no-store` with a 200; the INSERT-branch fix confirmed via a raw
D1 read. Full regression suite green; all test data (including the
fake, never-uploaded key used to force the INSERT branch) cleaned up —
that one via a direct D1 delete, since a row with no real R2 object
never appears in the media list a normal bulk-delete would operate on.

Item #582 is done: 1 critic round, 8/10, both real findings fixed and
verified; no bypass of the actual privacy gate was found in any tested
path, including live encoding/traversal/case-tampering attempts.

Resubmitted for a fresh, independent bypass hunt (new code changed since
the 8/10 round, and this is a real security feature). Round 2: **9/10,
no bypass found**. Both fixes independently re-verified: the INSERT-
branch fix confirmed via a direct D1 read after forcing that exact code
path (PATCHing a never-uploaded key), with the `undefined` case (a plain
`{hash}` upload/dedup call) confirmed to still default correctly to 0,
matching the schema default and the UPDATE branch's own guard; the
cache fix confirmed by capturing a real ETag while a file was still
public, marking it private, then sending that same ETag back as
`If-None-Match` while authenticated and confirming a full `200` with
byte-identical content came back rather than a `304` — proving the
ETag/304 shortcut is actually skipped for a private file, not just that
the header text changed. A fresh, independent bypass attempt (not
reusing round 1's list) tried Range requests, HEAD, a percent-encoded
slash, double URL-encoding, an embedded null byte, overlong-UTF8
encoding, and a case-varied path prefix against the same private file —
all correctly 404/401'd, none reached the bytes. Un-marking the file
private was confirmed to fully restore normal public GET/304/Range/HEAD
behavior, ruling out any regression to the ordinary public path from
either fix.

Item #582 is fully closed: 1 critic round at 8/10 finding two real,
fixable gaps (no security bypass, both defense-in-depth/exposure-window
issues), fixed and verified; a second, independent round specifically
hunting for a bypass of the core privacy gate found none.

### Thirteenth item: #397, detect disconnected pins in a circuit

- ✅ **"Show disconnected pins" toggle in the Simulation builder** —
  an on-demand toggle rather than an always-on overlay, since a
  component just placed with no wires yet is completely normal mid-build
  and an always-on red-pulse on every fresh part would just be noise.
  Reused the wire data's existing `{from:{compId,pin}, to:{compId,pin}}`
  shape directly (`isPinConnected()` is a plain `.some()` over
  `simData.wires`, no new data structure needed) rather than the
  server-side BFS-based `connected()` reachability function the backlog
  item referenced — that function answers "are these two specific pins
  on the same net," a different question from "does this pin have any
  wire touching it at all," and pulling in a whole net-connectivity pass
  for a much simpler direct lookup would have been solving the wrong
  problem. Clicking the toggle highlights every currently-unwired pin
  with a pulsing red ring (respecting `prefers-reduced-motion`) and
  updates the button's own label to a live count ("Disconnected pins: 3"
  / "No disconnected pins"), recomputed on every render so wiring or
  deleting a connection while the toggle is on updates the highlighting
  and count immediately, not just on the next explicit toggle. Reset to
  off whenever a different (or new) simulation is opened, matching how
  every other per-session UI toggle in this builder already resets on
  open.
  Verified via Playwright: placed a resistor and a battery (4 pins,
  0 wired) and toggled on — correctly flagged all 4 with the label
  "Disconnected pins: 4"; wired one pair together — correctly dropped to
  2 flagged pins and updated the label live without re-toggling; toggled
  off — confirmed zero pins carry the highlighting class even though 2
  are still genuinely unwired (the toggle actually gates the visual, not
  just the count); wired the remaining pair and toggled back on —
  correctly showed "No disconnected pins" with zero highlighted. Full
  regression suite green; this test never saved the simulation, so no
  test data needed cleanup.

Handed to a critic agent for scoring: **9/10**, no real bugs. Traced
every mutation path that touches `simData.wires`/`components` (delete,
multi-delete, delete-wire, duplicate/duplicate-multi, undo/redo, Reset,
checkpoint restore) and confirmed each one calls `renderBuilder()`,
which reads `simData`/`showDisconnected` fresh every time rather than
caching anything — no stale-highlight or stale-count path exists by
construction. Confirmed component deletion filters wires by both
endpoints so no dangling reference could ever confuse
`isPinConnected()`. Tested the one unusual-shape component directly:
placed a Breadboard (180 pins, confirmed via `SIM_COMPONENTS.breadboard.
pins.length`) and toggled on — correctly showed "Disconnected pins: 180"
with exactly 180 highlighted, no throw, no miscount; deleting it dropped
the label to "No disconnected pins" instantly. Rapid triple-toggle
(on→off→on, net off) left the label and highlighting in perfect sync,
consistent with the synchronous (no `await` gap) click handler. One
cosmetic, out-of-scope note: `.sim-pin-active` and `.sim-pin-disconnected`
have equal CSS specificity with the disconnected rule declared later, so
a wire-in-progress started from a currently-unwired pin renders in the
"disconnected" red rather than the active accent color while the toggle
is on — arguably correct (the pin genuinely has no wire yet), not scored
against.

Item #397 is done: 1 critic round, 9/10, no real findings.

### Fourteenth item: #398, highlight the electrical net from a point

- ✅ **Clicking a wire highlights every wire/pin tied to the same
  electrical net** — the one real design decision worth recording: the
  backlog wording said "reuse existing BFS reach function," pointing at
  the server-side `connected()`/client-side `computeSimPoweredSet()`
  machinery from item #397's writeup and the shared power-flow graph in
  `sim-components.js`. That graph deliberately links a component's own
  pins together too (a resistor's or LED's two legs count as "connected"
  there, since current can flow through them) — correct for answering
  "is this powered," wrong for "what's the same net," since a resistor's
  two legs are NOT the same electrical node — a voltage drop happens
  across it. Reusing that broader graph as-is would have made clicking
  any wire highlight both legs of every component along the way as one
  sprawling "net," not the actual wire-tied group a real net is. Built a
  separate, wires-only adjacency in the admin builder instead (reusing
  `window.simNodeId()` so breadboard rail/row grouping still counts
  correctly, and the same plain BFS traversal shape, just over a graph
  built fresh from `simData.wires` alone rather than sim-components.js's
  shared component-conducting one) — a closer reading of "the BFS reach
  function" as "the traversal technique," not "that exact graph object."
  UX-wise, clicking a wire (already an established interaction — wires
  are already selectable, shown with an accent-colored highlight) now
  also highlights every other wire/pin sharing its net in a second,
  distinct color, rather than adding a new interaction mode that would
  have competed with a pin click already meaning "start a new wire."
  Verified via Playwright: built a 3-way net (three resistors, two wires
  joining R1's second leg / R2's first leg / R3's first leg into one tied
  point) and clicked either wire — both wires and exactly the 3 pins on
  that net highlighted, while R1's unwired first leg and R3's unconnected
  second leg (a genuinely separate node) correctly did NOT highlight;
  deselecting by clicking empty canvas correctly cleared every highlight.
  Full regression suite green; this test never saved the simulation, so
  no test data needed cleanup.

Handed to a critic agent for scoring: **9/10**, no real bugs. Confirmed
deleting the selected wire itself clears the highlight cleanly (the
delete handler nulls `selected` before the next render, no crash);
deleting a *different* wire in the same net while a wire stays selected
turned out unreachable through the actual UI (the single-selection model
requires selecting whatever you delete, which already reassigns
`selected` away from the old wire first) rather than a real gap; adding a
new wire that extends an already-highlighted net correctly grows the
highlight immediately, since `wireOnlyNetNodes()` rebuilds fresh from
`simData.wires` on every render rather than caching anything. Confirmed
undo/redo/checkpoint-restore/import all explicitly null `selected` as
part of the same operation, so a stale wire id pointing at
already-restored-away data can't happen — and even if it somehow could,
`renderBuilder()`'s own lookup is null-guarded and would just silently
skip highlighting rather than throw. Tested the breadboard rail case
directly: wiring two resistors into different holes on the same top rail
and selecting the connecting wire correctly highlighted both wires, both
resistor pins, AND all 30 rail-hole dots as one net, matching
`window.simNodeId()`'s rail-group collapsing. Confirmed selecting a
component (not a wire) correctly shows zero net highlighting with no
leaked state from a previous wire selection. Two minor/out-of-scope
notes, both pre-existing and not introduced by this diff: a stale-
inspector-HTML edge case that no code path in this file can actually
reach, and a hardcoded highlight color with no dark/light theme variants
matching the file's own existing `.sim-pin` color convention.

Item #398 is done: 1 critic round, 9/10, no real findings.

### Fifteenth item: #524, comments on simulation components

- ✅ **Every component's existing "Label" field now renders as a hover
  tooltip, admin builder and public embed alike** — checked what "same
  as labels" actually meant in this codebase before adding a redundant
  second field: a `comp.label` string already exists per component
  (editable in the inspector), but it only ever visually rendered for one
  component type (`mcu_teensy`, printed directly on the part) — every
  other type stored it captioned "(for your own reference)" with nothing
  anywhere ever displaying it. Rather than bolt on a second, overlapping
  `comment` field duplicating what `label` already is, extended the
  existing field with a native SVG `<title>` (a real browser hover
  tooltip, no new UI chrome) for every component type, in BOTH the admin
  builder (`public/admin/simulation-builder.js`) and the public embed's
  server-side render (`worker/simulation-render.js`) — these are two
  independent, duplicated rendering paths (confirmed no shared import
  exists between the client admin script and the server-side one), so
  both needed the identical change.
  The one real decision worth recording: is a component's label private
  admin notes or public-facing content? The existing Teensy behavior
  already answered this — its label prints directly on the part in BOTH
  the builder AND the public embed today, meaning this codebase already
  treats a filled-in label as intended-to-be-public, not a private note.
  Matched that existing precedent rather than introducing a new
  public/private distinction inconsistent with it, and updated the
  inspector's field caption (previously "(for your own reference)",
  misleading now) to say it's shown as a hover tooltip including on the
  public embed, so an admin isn't surprised later.
  Verified via Playwright: a freshly-placed resistor already carries a
  `<title>Resistor</title>` before any customization — turned out to be
  pre-existing default-fill behavior (new components are created with
  `label: def.label`, i.e. the generic type name, not blank), not
  something this diff introduced, and harmless/correctly informative
  either way; setting a custom label live-updated the tooltip text;
  saving the simulation and loading the separate public
  `/simulation/:id` embed page showed the identical tooltip text,
  confirming the server-side render path renders it correctly too, not
  just the admin builder. Full regression suite green; test simulation
  deleted and confirmed gone (confirmed via a fresh simulations list —
  also surfaced a large pile of unrelated stale test simulations from
  much earlier in this session's own testing, left untouched since
  cleaning up that backlog is a separate, larger task from this feature).

Handed to a critic agent for scoring, with an explicit ask to attempt XSS
injection since this renders admin-controlled text into a public page:
**9/10, no security bug**. Live-injected `</title><script>window.__xssFired
=true;document.title="XSS-PWNED"</script><title>x` as a component label
and confirmed the rendered SVG shows the payload fully HTML-entity-
encoded, `<title>`'s textContent comes back as the literal inert string,
`window.__xssFired` stayed false, and `document.title` was untouched —
verified in both the admin canvas and the public embed page. Confirmed
both escaping functions (`escapeXml` client-side, `escXml` server-side)
correctly handle `&`/`<`/`>` for this text-node context (server-side also
escapes `"`, unneeded here since no quoted-attribute context is
involved). Tested newlines, tabs, emoji, CJK text, embedded quotes, and
a 5000-character label — all round-tripped exactly with no parse errors.
Confirmed a label edit on an already-saved, already-viewed simulation
correctly reaches the public embed with no simulation-specific stale-
cache path (the one generic page-level cache header found applies
site-wide and predates this change, not something newly introduced
here). One real minor finding:

1. **(Fixed)** `mcu_teensy` already prints its label as visible SVG
   `<text>` on the part itself — the new `<title>` wrapper applied to
   every component type uniformly meant a Teensy got a redundant hover
   tooltip repeating text already readable on the part. Fixed by
   skipping the `<title>` specifically for `mcu_teensy` in both render
   paths, leaving its existing visible-text behavior as the only display
   (matching how it worked before this feature).

Re-verified via Playwright: a Teensy component now renders zero `<title>`
elements (its printed label is still visible as before), while every
other component type still gets the tooltip correctly. Full regression
suite green.

Item #524 is done: 1 critic round, 9/10 (explicitly including a real XSS
injection attempt in both render paths, with none found), the one real
finding (redundant Teensy tooltip) fixed and verified.

### Sixteenth item: #385, show wires hidden underneath components

- ✅ **"Show hidden wires" toggle in the Simulation builder** — wires
  render before components in normal SVG paint order, so a wire routed
  underneath an opaque part (most commonly a breadboard, the widest/
  tallest body on the canvas) is genuinely invisible with nothing on
  screen hinting it's there. Rather than computing which specific wires
  are actually occluded (a bounding-box intersection test against every
  component, for what's purely a cosmetic debug aid), the toggle just
  redraws every wire a second time on top of every component as a
  dashed, semi-transparent "ghost" outline — the data needed is exactly
  the same `simData.wires` already rendered once, no new occlusion-
  tracking required, matching the backlog's own "data already there"
  framing. The ghost pass deliberately does NOT reuse the `.sim-wire`
  class (so `attachBuilderEvents()`'s click-to-select wiring never binds
  to it) and is explicitly `pointer-events: none`, so it can't intercept
  a click meant for whatever's underneath or create a confusing
  "clicking near a component actually selected a wire" surprise. Same
  on-demand-toggle reasoning as #397/#398's own toggles: most wires are
  never actually hidden under anything, so an always-on dashed duplicate
  over every wire would just be clutter.
  Caught one real bug before it could ship: the button's own `.is-active`
  visual state was originally only ever set inside its click handler —
  `openBuilder()` correctly resets the underlying `showGhostWires`
  boolean to `false` on every open (matching #397's toggle), but nothing
  synced the button's DOM class to match, so opening a different
  simulation right after leaving the toggle on could leave the button
  looking active while the boolean underneath was actually off. Fixed by
  moving the active-class sync into `renderBuilder()` itself (which
  already runs on every simulation open), matching exactly how the
  disconnected-pins toggle already keeps its own button state
  synchronized on every render rather than only in its click handler.
  Verified via Playwright: toggling on with one real wire correctly shows
  exactly one ghost wire, non-interactive (`pointer-events: none`
  confirmed via computed style); adding a second wire while the toggle
  stays on correctly grows the ghost count to 2 live, without needing to
  re-toggle; toggling off correctly clears all ghosts; toggling on then
  opening a brand-new simulation correctly reset both the boolean AND the
  button's visual active state to off (the exact bug just found and
  fixed, re-verified live). Full regression suite green; this test never
  saved the simulation, so no test data needed cleanup.

Handed to a critic agent for scoring: **9/10**, no real bugs. Confirmed
the two things this diff explicitly anticipated actually hold: ghost
wires are never selectable (no `.sim-wire` class for
`attachBuilderEvents()`'s exact-class click binding to match, and
`onCanvasBackgroundPointerDown()`'s rubber-band multi-select only
hit-tests component bounding boxes, never wire/ghost geometry at all —
confirmed live with a full-canvas rubber-band drag leaving the ghost
count and selection unaffected), and clicking pixel-precisely on a ghost
path (via `pointer-events: none`) correctly falls through to whatever's
actually underneath rather than creating a dead zone over a real wire or
pin. Deleting a wire while ghost mode is on correctly removes both the
real path and its ghost copy together in the same `renderBuilder()` call,
with no stale outline surviving. Tested combining this toggle with the
disconnected-pins and net-highlight toggles simultaneously: the real
wire correctly carries both `sim-selected`/`sim-net-highlight` state
classes while its ghost copy stays a plain, stateless dashed outline —
two independently-built, z-order-separated elements that can't strip or
override each other's classes. Confirmed `showGhostWires` is correctly
untouched by undo/redo/reset/checkpoint-restore (a viewing preference,
not part of `simData`, exactly like the disconnected-pins toggle), with
`openBuilder()` remaining the one path that resets it — and the fix this
diff already made (syncing the button's active class inside
`renderBuilder()` rather than only its click handler) correctly keeps
the button's visual state matching that reset. Rapid 10x toggling left
the button's active state exactly matching the boolean's parity every
time, no desync.

Item #385 is done: 1 critic round, 9/10, no real findings.

### Seventeenth item: #572, poster/share images for simulations

- ✅ **A per-simulation poster/share image, done for simulations,
  deliberately scoped away from songs** — checked what `scans.poster_key`
  actually does before extending it: it's the `poster=""` attribute on
  the 3D `<model-viewer>` element, shown while the model loads and as a
  fallback for browsers that can't render WebGL — a real loading-state
  gap that exists specifically because a 3D scan has no inherent static
  representation. Neither songs nor simulations have that problem the
  same way: a simulation's standalone `/simulation/:id` page already
  renders a real, static SVG circuit diagram server-side immediately
  (`renderSimulationSvg()`), no loading gap to fill. What simulations
  DID lack: `renderSimulationPage()` always set `ogImage: defaultOgImage
  || null` — sharing a link to any circuit, however visually distinct,
  always showed the site's one generic default share image, with no
  per-item override at all (unlike articles/projects, which already
  support one). That's the real, well-scoped version of "poster image"
  that applies here: a share-image override, not a loading fallback.
  Added a "Poster / share image" field (text input + the existing
  Upload/Browse trigger buttons, same reusable pattern the scan builder
  already uses) as its own row in the Simulation builder, deliberately
  NOT part of `simData` or the undo/redo history — it's page-level
  metadata read straight from its own input at save time, exactly like
  the simulation name field already is, not circuit state. A template
  built from a simulation with a poster image does NOT carry it over
  (same "template is a fresh start" reasoning already applied to
  checkpoints not carrying over either).
  Deliberately did NOT extend this to songs in the same pass: songs have
  no standalone public page or OG-image concept at all (a song only ever
  appears embedded inside an article/page's own block, inheriting
  whatever OG tags the containing page already has), so the actual gap
  this item is meant to close doesn't exist for songs the same way. A
  song "cover image" would mean something different — a static visual
  shown in the embed's own preview area before playback — which overlaps
  with the separate, still-open #349 ("Generate waveform cover art," an
  auto-generated version of the same idea) rather than being a clean
  extension of this exact pattern. Logged rather than force-fit, matching
  this session's own established practice for a backlog item that turns
  out to only cleanly apply to part of what it names.
  Verified via Playwright: a brand-new simulation's poster field starts
  empty; setting one and saving correctly sets the standalone page's
  `og:image` meta tag to that exact URL; closing and reopening the
  builder correctly shows the saved value back in the field (round-
  tripped through `data.og_image`, not just held in memory); clearing the
  field and saving again correctly removes the custom `og:image` tag
  rather than leaving the old URL stuck. Full regression suite green;
  test simulation deleted and confirmed gone.

Handed to a critic agent for scoring, with an explicit ask to attempt
XSS injection via the poster URL (since it renders into a public page's
`<meta>` tag): **9/10, no real bugs, no XSS bypass**. Live-injected
`https://example.com/x.png"><script>window.__xss_fired=true</script>
<meta x="` as the poster URL and confirmed the rendered page's raw HTML
shows it fully HTML-entity-escaped (`renderShell()`'s `esc()` — the same
function used for every other `og:image`/`twitter:image` value) with no
injected script tag. Confirmed clearing the field writes `null` (not an
empty string) and the public page correctly emits no `og:image` tag at
all rather than a stale one. Confirmed a legacy simulation saved before
this feature existed opens with an empty poster field with no throw
(`(sim.data && sim.data.og_image) || ""` is undefined-safe). Verified —
not just assumed from the design — that "Save as template"'s POST body
genuinely cannot carry `og_image`, since `simData` is constructed as
`{components, wires}` everywhere in the file with no code path that
could attach a third key to it. One informational note, not a bug:
`duplicateSimulation()` (a pre-existing, unmodified server route) copies
`data` wholesale, so duplicating a simulation DOES carry over its poster
image, unlike saving as a template — an asymmetry the commit didn't
discuss but is arguably correct (a duplicate is a full copy; a template
is a fresh start, matching the checkpoints precedent).

Item #572 is done: 1 critic round, 9/10 (explicitly including a real
XSS injection attempt, with none found), no real findings.

### Eighteenth item: #576, prevent layout shift from late-loading images

- ✅ **Read each image's real pixel dimensions from its own file header at
  upload time, then emit `width`/`height` attributes on the plain image
  block** — checked which of the three places an image renders actually
  has this gap before touching anything: the gallery block and the
  before-after block both already have explicit CSS dimensions
  (`.gallery img { width:100%; height:160px; }`, `.before-after` has a
  fixed container with `min-height:240px` and its two images absolutely
  positioned at `width:100%;height:100%`) — their box size is entirely
  CSS-controlled regardless of the image's own intrinsic size, so adding
  width/height attributes there would be inert, no actual bug to fix. The
  plain `image` block is the one real gap: its only sizing rule is
  `max-width:100%`, so its rendered height is determined purely by
  whatever image happens to load, and a late-arriving image genuinely
  pushes surrounding content down as it finishes loading — the textbook
  layout-shift case this backlog item describes.
  Workers has no image-decoding API, so getting real dimensions meant
  reading them straight from each format's own file header — no full
  decode needed. Wrote `readImageDimensions()` (PNG: the IHDR chunk;
  GIF: the fixed 10-byte header; JPEG: walking marker segments to find
  the SOF frame; WebP: the VP8X/VP8/VP8L chunk layouts, each format
  encoding width/height slightly differently) plus a separate
  `readSvgDimensions()` for SVG's XML `width`/`height` attributes or
  `viewBox` fallback, since SVG has no fixed binary layout to read from.
  Both return `null` rather than ever throwing, on the reasoning that a
  missing size attribute on one image is a much smaller problem than
  corrupting an upload over a parsing edge case. Added `width`/`height`
  columns to the `media` table (applied directly to local D1, matching
  how every other schema addition this session went in) and a new
  `/media/backfill-dimensions` route mirroring the existing
  `/media/backfill-hashes` pattern exactly, so uploads from before this
  feature existed can get their dimensions filled in after the fact
  without needing to re-upload — plus a matching "Backfill image
  dimensions" button in the Media Library, next to the existing "Scan
  for duplicates" button it's modeled on.
  Caught one real bug of my own before it could ship: `GET /media`'s list
  route hand-picks its returned fields rather than spreading the DB row
  (the exact same shape of bug already found and fixed for the `private`
  column earlier this session) — width/height were being written
  correctly server-side but would have silently never reached the
  client's media grid. Added them to that explicit field list from the
  start this time, verified before considering the feature done rather
  than after.
  Verified via Playwright against real image files (not synthetic bytes)
  in every supported format, checked against ground truth from Pillow: a
  317×241 PNG, a 640×480 JPEG, a 150×90 GIF, a 400×225 WebP, and a
  333×222 SVG all uploaded and reported back exactly matching dimensions
  — no format-specific parsing bug in any of the five header formats.
  Rendered one of these inside a real page's image block and confirmed
  the public page's actual `<img>` tag carries `width="317"
  height="241"`. Backfill tested two ways: as a safe no-op against files
  that already have dimensions (`updated: 0`), and — the real test —
  against a file with its width/height columns directly cleared to
  simulate a genuinely pre-existing upload, correctly detecting and
  filling in the missing values via the same header-reading logic. Full
  regression suite green; all test media/pages deleted and confirmed
  gone.
  Explicitly not covered in this pass, noted rather than silently
  claimed: project-card thumbnails and article/project header images
  render through different code paths this diff didn't audit — a
  separate surface worth its own look, not something to assume is fine
  just because the block-level image case is now solid.

Handed to a critic agent for scoring, with an explicit ask for
adversarial/malformed-input testing since the header-parsing logic was
the highest-risk part of this diff: **6/10**. Confirmed correct on real
files: JPEG marker-walking on both baseline and progressive encodings,
correctly skipping a real EXIF/APP1 segment without descending into it;
all three WebP sub-formats (lossy, lossless, and a real RGBA-triggered
VP8X); `GET /media` genuinely returns width/height; the backfill route
handles mixed readable/unreadable batches correctly with accurate
counters and no throw; no uncaught exception on any malformed input
tried. Three real bugs found, all fixed:

1. **(Fixed)** The GIF branch was the one format with no magic-byte
   check before trusting the bytes at the expected offset — PNG checks
   the IHDR chunk type, WebP checks the RIFF/WEBP fourCC, but GIF only
   checked `byteLength >= 10` and read straight through. Ten bytes of
   arbitrary garbage labeled `image/gif` parsed to a nonsense
   `{width:2055, height:2569}` that the critic confirmed actually reaches
   a real rendered `<img>` tag. Fixed by checking for the `GIF87a`/
   `GIF89a` signature first, matching every other format's own check.
2. **(Fixed)** No parser anywhere enforced an upper bound on its output —
   a corrupted PNG with its IHDR width/height set to `0xFFFFFFFF` parsed
   straight through with no bound check in `readImageDimensions`,
   `upsertMediaMeta`, or `imgSizeAttrs`, and the critic confirmed the
   same gap in `readSvgDimensions` (an SVG with `width="999999999999"`
   rendered exactly that value into a real page). This doesn't just fail
   to help with layout shift, it actively causes severe shift/breakage
   once the real image loads — the opposite of the feature's purpose.
   Fixed with one shared `plausibleDims()` check (width/height both
   finite, `> 0`, and `<= 20000`, far past any real image this site would
   legitimately hold) applied at every single return point across all
   four raster-format branches and both SVG code paths, rather than
   scattering the same bound check across each one separately.
3. **(Fixed)** `readSvgDimensions` matched only the leading digits of a
   `width`/`height` attribute, so `width="100%"` was silently read as a
   literal 100px instead of being recognized as a percentage and falling
   through to the `viewBox` fallback — a very common real-world pattern
   for a responsive SVG. The critic confirmed this can silently write a
   wrong aspect ratio whenever the two percentages don't happen to match
   the viewBox's own ratio (e.g. `width="50%" height="100%"` on a 4:1
   viewBox). Fixed with a new `readSvgPixelAttr()` helper that captures
   the unit alongside the number and only accepts a bare value or an
   explicit `px` suffix, rejecting `%` and every other CSS unit so those
   cases correctly fall through to `viewBox` instead.

Re-verified via Playwright: all five valid formats (PNG/JPEG/GIF/WebP/SVG)
still parse correctly against Pillow ground truth with no regression
from the fixes; the same 10-byte garbage-labeled-as-GIF file now
correctly reports `null`/`null` instead of a fabricated size; a
hand-crafted PNG with `0xFFFFFFFF` IHDR dimensions and an SVG with a
12-digit width both now correctly report `null`/`null` instead of the
absurd value; an SVG with `width="50%" height="100%"` and a `viewBox`
of `0 0 400 100` now correctly reports `400x100` from the viewBox rather
than a wrong `50x100` from the percentages. Full regression suite green;
all test uploads deleted and confirmed gone.

Sent back for a round-2 critic pass on the fixed code (commit c808f37).
Scored 6/10 again — the round-1 fixes were verified as genuinely correct
and complete (the GIF signature check, the `plausibleDims()` bound check
applied consistently at every single raster/SVG return point, and the
SVG percentage-unit rejection all held up), but the fix pass had been
scoped too narrowly to the exact three complaints instead of re-auditing
every sibling code path for the same bug classes. Three new real bugs,
same shape as round 1:

1. JPEG had no signature check at all (the same class of bug round 1
   fixed for GIF) — the marker-walk loop trusted `0xFFD8` was present
   without ever checking it, so a 40-byte garbage buffer with a spliced
   fake SOF0 marker at offset 5, labeled `image/jpeg`, parsed to a
   fabricated `200x100`. Fixed by checking `view.getUint16(0) === 0xffd8`
   before entering the marker walk.
2. WebP never validated the outer RIFF/WEBP envelope, only the inner
   `VP8X`/`VP8 `/`VP8L` fourCC at byte 12 — an even easier coincidence to
   hit than JPEG's marker pattern, since it's an exact 4-byte match with
   no surrounding structure required. Fixed by checking bytes 0-3 are
   `RIFF` and bytes 8-11 are `WEBP` before trusting the fourCC.
3. `readSvgPixelAttr`'s regex used `\b${attrName}` as the left boundary,
   and `\b` fires between a hyphen and a letter — so `width` matched
   inside `stroke-width`, a common attribute on root `<svg>` elements in
   icon sets. An SVG with `stroke-width="1" width="600" height="400"`
   read `width` as `1` instead of `600`, and since `plausibleDims` only
   rejects out-of-range values (1 is in-range), it silently shipped the
   wrong dimensions with no error. Fixed by requiring the character
   before `attrName` be whitespace or `<` (`(?:^|[\s<])${attrName}`)
   instead of a bare word-boundary.

A fourth finding (the `/media/backfill-dimensions` route lists only the
first 500 R2 objects with no cursor loop, so a library over 500 files
would silently stop getting backfilled past that point) was logged but
not fixed — it's not a regression from this feature, the sibling
`/media/backfill-hashes` route has had the identical limitation since it
shipped, and today's library is nowhere near 500 files. Deferred as an
existing-pattern limitation rather than fixed just for this route in
isolation; noted below as a Medium-priority cleanup if the library ever
grows into it.

Re-verified via Playwright against real Pillow-generated ground truth for
all five valid formats (no regression from either fix round) plus three
new adversarial fixtures: the fake-SOI JPEG and the fake-envelope WebP
both now correctly report `null`/`null` instead of fabricated dimensions,
and the `stroke-width`-colliding SVG now correctly reads `600x400` from
its real `width`/`height` attributes instead of `1x400`. Full regression
suite green; all test uploads deleted and confirmed gone.

Sent back for a round-3 critic pass on commit 0a6a5a6. Scored 6/10 a
third time. The round-2 fixes were re-verified as correct with no
regressions or new bugs of their own (the SVG regex's new `(?:^|[\s<])`
boundary was specifically checked against `min-width` and other
hyphenated-attribute collisions and holds up), and `imgSizeAttrs()` in
render.js was checked for the hypothesized "read another image's
metadata via URL manipulation" attack and found not exploitable (the
same R2 key that's regex-extracted for the DB lookup is the same key
already embedded in the `src` the caller rendered). But the round-3
critic did one more adversarial pass across all formats specifically
looking for a sibling of the exact bug family both prior rounds had been
fixing (missing signature/envelope validation before trusting bytes at a
fixed offset) -- and found PNG was the one raster format that had never
gotten this treatment. `readImageDimensions`'s PNG branch checked only
that bytes 12-15 spelled `"IHDR"`, never that bytes 0-7 were the real
8-byte PNG magic number (`89 50 4E 47 0D 0A 1A 0A`) -- despite a comment
directly above it claiming the signature was accounted for. A 24-byte
buffer of zeroes with `IHDR` spliced at offset 12 and arbitrary
width/height at 16-23, labeled `image/png`, parsed to fabricated
dimensions for a file that isn't a PNG at all. Fixed with the same
pattern as the other three formats: `view.getUint32(0) !== 0x89504e47 ||
view.getUint32(4) !== 0x0d0a1a0a` rejects before the IHDR check runs.

Re-verified via Playwright: all five valid formats still parse correctly
with no regression from this fourth fix, and a hand-crafted fake-PNG
fixture (IHDR fourCC at offset 12, no real signature, labeled image/png)
now correctly reports `null`/`null` instead of a fabricated `800x600`.
Full regression suite green; all test uploads deleted and confirmed
gone.

Sent back for a round-4 critic pass on commit af54486, this time asking
for an explicit symmetric audit (all five formats checked against the
same questions side by side) rather than another open-ended search,
given the round-1/2/3 pattern of always finding one more sibling gap in
a format nobody had re-examined. Result: the five-format parser itself
is now genuinely symmetric and correct -- the critic confirmed, format
by format, that every one of PNG/GIF/JPEG/WebP/SVG validates its magic
bytes/envelope before any offset read, routes every return path through
`plausibleDims`, and has sufficiently-guarded buffer reads for the
offsets each branch actually uses (including WebP's three sub-formats
individually). No new parsing gap found. Scored 6/10 anyway, because the
audit's own last question -- whether any code path lets a computed
width/height bypass `plausibleDims` entirely -- turned up a real one
outside the parser: `PATCH /media/:key` forwarded its raw JSON request
body straight into `upsertMediaMeta` with no field allowlist, and
`upsertMediaMeta` itself never validated `width`/`height` before writing
them, so a request body like `{"width": 999999999, "height": -5}`
bypassed every one of the previous three rounds' parser hardening and
still got rendered as-is into the `<img>` tag `imgSizeAttrs()` emits.
The admin UI itself never sends those fields today, but the backend
route enforced nothing, so any future caller (a UI bug, a direct API
call) could reintroduce the exact "absurd value reaches a real page"
failure every prior round was fixing.

Fixed by moving `plausibleDims()` (and the `MAX_PLAUSIBLE_IMAGE_DIMENSION`
constant) from admin-api.js into db.js and enforcing it directly inside
`upsertMediaMeta` itself -- the one write path every caller (upload,
both backfill routes, and PATCH) already goes through -- rather than
only inside the header parsers that normally produce these values. This
makes it a single enforcement point no future caller can route around,
instead of relying on every caller to remember to validate before
calling in. admin-api.js now imports `plausibleDims` from db.js for its
own parser code (avoiding a circular import, since admin-api.js already
imports from db.js). The critic's secondary finding -- `PUT /media/:key`
(the photo editor's "Overwrite original" save) replaced a file's bytes
without recomputing width/height, so a crop or other dimension-changing
edit left the old file's stale dimensions in the DB, reserving the wrong
layout space for the new image -- was fixed too, by recomputing dims
from the new bytes via the same `readImageDimensions()` call already used
elsewhere and passing them through explicitly (using `null`, not
`undefined`, since this is an UPDATE on an existing row where `undefined`
would skip the column and leave the stale value in place).

Re-verified via Playwright: all five valid formats and all four earlier
adversarial fixtures (fake-signature GIF/JPEG/WebP/PNG, percentage and
stroke-width-colliding SVGs) still behave correctly after the refactor,
confirming no regression from moving `plausibleDims` to a different
file. Three new adversarial checks for this round's fix: a `PATCH` with
`{width: 999999999, height: -5}` on a real uploaded file now correctly
nulls both fields instead of writing them; a `PATCH` with plausible
values (`{width: 500, height: 400}`) is still correctly accepted,
confirming the fix doesn't over-reject legitimate metadata edits; and a
`PUT` overwrite with a 222x333 image on a file that previously had
100x100 dimensions now correctly reports 222x333 instead of the stale
value. Full regression suite green; all test uploads deleted and
confirmed gone.

Item #576 is done: 4 critic rounds (6/10 x4), nine real findings across
all four rounds all fixed and verified live except the one pre-existing
backfill-pagination limitation (logged as a deferred Medium item, shared
with `/media/backfill-hashes`, not a regression from this feature), with
no regression to the working formats at any step. Rounds 1-3 each found
a sibling instance of the same missing-validation bug class in a raster
format nobody had re-examined yet (GIF -> JPEG/WebP/SVG-regex -> PNG);
round 4's explicit symmetric audit finally closed that specific pattern
out, but surfaced a different, more consequential gap in the same
family: hardening every parser is worthless if the write path around the
parsers (an admin API route forwarding a raw request body) can skip them
entirely. The fix for that -- enforcing the invariant inside the shared
write function itself, not just inside the code paths that are expected
to produce valid input -- is the more durable pattern going forward for
this kind of validation.

Sent back for a round-5 critic pass on commit 917cac7, explicitly told
this had already been through 4 rounds of genuine convergence and to
score honestly rather than manufacture a new finding if what remained
was minor. Scored 9/10 -- ship. Verified all five follow-up questions
cleanly: `upsertMediaMeta` validates width/height on every code path
(both UPDATE and INSERT, unconditionally before either branch runs); a
partial PATCH with only one of width/height is handled correctly and
actually better than a pair-based check would be, since the enforcement
clamps each field independently rather than requiring both -- and the
renderer's own `imgSizeAttrs()` already refuses to emit either attribute
unless both columns are non-null, so a half-populated row still can't
produce a bogus `<img width height>` pair; no other route or function
writes the `media` table's width/height columns outside
`upsertMediaMeta` (the one other direct `INSERT INTO media` found, in
the full-database backup/restore routine, omits width/height from its
column list entirely, so it can't reintroduce the bypass -- noted for
awareness only, not a gap, since it also sits behind a much broader
admin-restore capability than anything media-editing touches); the
`plausibleDims` move from admin-api.js to db.js introduced no circular
import (`db.js` doesn't import from `admin-api.js`) and left no dangling
reference to the old removed local copy.

Item #576 is done: 5 critic rounds (6/10 x4, then 9/10), nine real
findings across the first four rounds all fixed and verified live except
the one pre-existing backfill-pagination limitation (logged as a
deferred Medium item, shared with `/media/backfill-hashes`, not a
regression from this feature), with no regression to the working formats
at any step. The arc of this item is worth remembering for future
header-parsing/validation work: harden every format symmetrically in one
pass rather than fixing only the branch a critic calls out, and enforce
invariants at the single shared write chokepoint a value passes through
rather than only at the code paths expected to produce valid input --
both lessons this item had to learn the hard way, one critic round at a
time, before finally converging.

### Nineteenth item: #92, Photo Editor saved crop ratios

Added a fixed aspect-ratio constraint to the existing crop tool: a new
`#pe-crop-ratio` dropdown (Free, 1:1, 4:3, 3:4, 3:2, 2:3, 16:9, 9:16)
next to the Select/Crop button. When a ratio other than Free is chosen,
dragging the crop selection constrains the dragged corner to keep that
exact aspect ratio relative to the anchor corner (the drag's start
point), rather than the previous free-form rectangle.

The constraint math (`applyCropRatio()` in photo-editor.js) computes the
raw drag delta, forces the smaller-driven dimension up to match the
ratio, then clamps in two passes -- once against the canvas edge in the
drag's x direction, once in its y direction, each time recomputing the
other dimension from the ratio -- so a drag toward or past the edge of
the canvas still produces a correctly-ratioed rectangle instead of
either overflowing the canvas or silently breaking the ratio once
clamped. The dropdown resets to "Free" every time a new image is opened
in the editor (matching the existing precedent of not carrying tool
state between separate edit sessions, e.g. checkpoints/poster-image
fields elsewhere in the admin), and changing the ratio while a selection
is already drawn (not mid-drag) re-constrains the existing rectangle in
place rather than leaving a stale one that doesn't match what Apply Crop
would actually produce.

Tested via Playwright against a real 800x600 uploaded image: confirmed
the dropdown starts on "Free" on open; a 1:1 drag from an asymmetric
mouse movement (250px right, 100px down) produced an exactly-square
crop (301x301); a 16:9 drag produced a crop with the correct ratio
(421x237, ratio 1.776 vs. the exact 1.778); and a 1:1 drag started near
the canvas's bottom-right corner and dragged well past both edges still
produced a square crop (36x36) rather than a non-square one truncated by
the edge clamp or a crop that silently ignored the edge and tried to
read out-of-bounds pixel data. Full regression suite green; test upload
deleted and confirmed gone.

Sent to a critic pass on commit dbd352d. Scored 5/10 -- the ratio-locking
math itself was confirmed correct (hand-traced and proved algebraically
that the two-pass clamp can only shrink, never regrow, so it can't
overflow the canvas or break the ratio), and "Free" mode confirmed as a
provable no-op passthrough, but two real bugs shipped anyway:

1. `normalizedCrop()` independently rounds x/y and w/h from continuous,
   mouse-derived coordinates -- fine on its own, but the new ratio-lock
   clamp deliberately produces rectangles whose *unrounded* edge lands
   exactly on the canvas boundary whenever a drag is clamped there (a
   very ordinary gesture: dragging to the edge at a fixed ratio). Two
   independent roundings of numbers that were only equal as floats could
   push the rounded width one pixel past the canvas edge. `getImageData`
   doesn't throw for that, it silently returns transparent-black for the
   out-of-range pixels, so the applied crop got a 1px fully-transparent
   strip baked into it on what should have been an exact-ratio edge crop.
2. The `pe-crop-ratio` "change" handler only checked `if (!cropRect)`,
   not whether the "select" tool was even still active. `setTool()`
   never clears `cropRect` when switching to a different tool, so
   drawing a selection, switching to e.g. Erase, and then changing the
   ratio dropdown "just to see" redrew the full-canvas dark crop-mask
   overlay on top of whatever tool was actually active -- it stayed
   there until the next pointermove over the canvas happened to clear it
   for an unrelated reason.

Both fixed: `normalizedCrop()` now clamps x/y to the canvas first, then
clamps w/h to whatever's actually left of the canvas from there (rather
than rounding the raw drag distance independently), which provably keeps
the returned rect in-bounds regardless of where its unrounded edges
landed -- this also hardens the pre-existing free-form crop path against
the same 1px overflow, not just the new ratio-locked one. The ratio
dropdown's change handler now also checks `currentTool !== "select"`
before touching the overlay.

The critic also surfaced a third, pre-existing issue not introduced by
this feature and not fixed here: `rotate90()`/`flip()` never clear
`cropRect` or hide the Apply Crop button, so a selection drawn before a
rotate/flip survives with stale coordinates against the new (possibly
dimension-swapped) canvas, and applying it afterward can read past the
new bounds the same silent-transparent-padding way. This already existed
for plain free-form crop before this commit, so it's not a regression
from #92 -- logged here as a Photo Editor Easy/Medium item worth its own
small fix (clear `cropRect` and hide `pe-apply-crop` at the top of both
`rotate90()` and `flip()`), tracked separately rather than expanding this
diff's scope.

Re-verified via Playwright on a 1000x1000 test image: a 1:1 drag from a
deliberately fractional anchor (10.3, 10.3) dragged 500px past both
canvas edges now produces an equal, in-bounds crop (979x979) instead of
a 1px-overflowing one; drawing a selection, switching to the Erase tool,
and changing the ratio dropdown now leaves the overlay canvas empty
(sampled for any nonzero alpha) with Erase still the active tool, instead
of painting the stale crop mask over it. The original round-1 tests
(dropdown resets to Free, 1:1/16:9 ratio-locked drags, near-corner
clamping) were re-run unchanged and still pass, confirming no regression
from the fix. Full regression suite green; test uploads deleted and
confirmed gone.

Sent back for a round-2 critic pass on commit f98b417. Scored 9/10 --
ship. Both fixes were re-verified as genuinely and completely correct,
not just patches for the one scenario round 1 happened to find: the
edge-clamping proof in `normalizedCrop()` holds algebraically for every
constructible input (fractional anchors, corner drags past two edges,
already-out-of-bounds coordinates, zero-size drags), and `drawCropOverlay()`
was confirmed to have exactly two call sites in the whole file, both now
correctly guarded, so there's no third path that could repaint the mask
over an unrelated tool. A dedicated fresh adversarial pass (changing the
ratio dropdown mid-drag, tiny/large canvas dimensions, the dual-pass
clamp math's own internal consistency) found nothing new -- mid-drag
ratio changes can't corrupt state since the very next pointermove
overwrites whatever the change handler wrote, and the two-pass clamp was
proven (not just tested) to never have its passes fight each other. The
one point held back was for the already-deferred rotate/flip staleness
issue and the inherent sub-pixel ratio drift from independent x/y vs.
w/h rounding, neither a defect introduced by or in scope for this item.

Item #92 is done: 2 critic rounds (5/10, 9/10), both real round-1
findings fixed and verified live (including hardening the pre-existing
free-form crop path against the same rounding bug), with the third
finding (stale cropRect surviving rotate/flip) logged as a separate
pre-existing Photo Editor item rather than expanding this diff.

### Twentieth item: #375, configurable grid snapping in the simulation builder

Exposed the simulation builder's existing free-drag alignment grid as a
UI control instead of a hardcoded constant. A new "Snap" dropdown in the
builder toolbar (Off / 1px / 5px / 10px / 20px, defaulting to the
long-standing 5px) sets `gridSnapSize`, which the existing drag-move
math in the pointer handler already rounds a component's position to.
`GRID_SNAP` (a `const`) became `gridSnapSize` (a `let`), and the rounding
step is skipped entirely (rather than dividing by zero) when the value
is 0 ("Off"). Deliberately scoped to only the general free-alignment
grid: parts that plug directly into a breadboard (LED/resistor/switch,
via `SNAP_TO_BREADBOARD_TYPES`) already snap to the breadboard's own
physical hole grid through separate logic, and that's correctly
unaffected by this control -- the label's tooltip says so explicitly, so
it isn't a surprise when dragging one of those parts ignores the
dropdown. Matches the existing precedent (showDisconnected,
showGhostWires, zoomLevel) of resetting per-builder-session UI
preferences rather than persisting them with the simulation's own data:
the dropdown resets to 5px every time a simulation is opened.

Tested via Playwright: placed a Power Supply (not a breadboard-snap
type) in a new, unsaved simulation and dragged it with the default 5px
snap active -- landed at (115, 90), both coordinates exact multiples of
5 as expected. Switched the dropdown to "Off" and dragged again by a
non-grid-aligned amount -- landed at a genuinely fractional position
(141.93, 104.50), confirming the rounding step is actually skipped
rather than just relabeled. Confirmed the dropdown itself defaults to
"5px" on a fresh builder open. No server-side state was touched (the
test simulation was never saved), so no cleanup was needed. Full
regression suite green.

Sent to a critic pass on commit 9fdd4f7. Scored 9/10 -- ship, first try.
Full-repo grep confirmed no leftover reference to the old `GRID_SNAP`
name anywhere; the `Number(value) || 0` parsing in the change listener
was checked against the `<select>`'s fixed option set and can't produce
NaN or a negative value; a mid-drag change to the dropdown can't corrupt
history the way the crop-ratio feature's mid-drag ratio bug did earlier
this session, since `gridSnapSize` is read fresh on every pointermove
tick with no accumulated state, `pushHistory()` still fires exactly once
per drag via the existing `historySaved` flag, and the dropdown isn't
even reachable mid-drag since the pointer has capture; a multi-component
group drag was traced and confirmed to apply the snap-adjusted delta
identically to every member, preserving their relative offsets; and
`openBuilder()`'s reset covers all three ways into the builder (new,
new-from-template, edit-existing) since it's the single entry point that
unhides the modal. One pre-existing, correctly-scoped observation was
logged rather than treated as a bug: a breadboard-snap-type part
(LED/resistor/switch) dragged far from any breadboard gets no positional
assistance at all -- not grid snap (type-gated out), not hole snap
(nothing nearby to snap to) -- which is exactly the scoping this item's
description called for, not a gap this diff should fix.

Item #375 is done: implemented and verified with a single 9/10 critic
round and no real findings -- confirms the earlier note that "small"
doesn't guarantee a critic pass is unnecessary, but this one held up
clean on the first submission.

### Twenty-first item: #434, simulation builder continuity tester

Added a "Continuity test" toggle mode to the simulation builder,
mirroring a real multimeter's continuity check: click one pin, then a
second pin, and it reports "Connected" or "Not connected" based on
whether they're on the same wire-tied net. Built as a genuinely thin
wrapper as the backlog item predicted: `handleContinuityClick()` reuses
`wireOnlyNetNodes()` (the wires-only BFS #398's net-highlight feature
already built earlier this session) unchanged -- "are these two pins
continuous" is exactly "are they in the same wire-only net," no new
solver logic needed.

Implementation notes: a toggle button (matching the existing
showDisconnected/showGhostWires pattern) rather than a modifier key or
separate always-on tool, since a pin click otherwise always means
"start/finish a wire" and needed an explicit mode switch to mean
something else instead. Turning the mode on clears any in-progress wire
draw (`wireStart`) so a half-drawn wire can't linger showing its own
stale "active" pin highlight once pin clicks stop meaning "draw a wire."
Clicking the same pin twice cancels the probe rather than reporting a
meaningless "connected to itself." A successful "Connected" result
reuses the existing net-highlight rendering path (the same
`netNodeIds`/`sim-net-highlight` machinery #398 built) to visually trace
the whole net, not just flash a text label. Deselecting to empty canvas
also clears an in-progress probe, and the whole mode resets (off, no
probe, no result text) every time the builder opens, matching the
existing precedent for per-session UI toggles.

Tested via Playwright: wired two components' pins together, left a
third unconnected; toggling continuity mode on and probing the two wired
pins correctly reported "Connected" (with the net-highlight class
applied) and created zero new wires in the process (confirming the mode
switch actually suppresses wire-drawing, not just relabels the button);
probing one of the wired pins against the unconnected third component
correctly reported "Not connected"; clicking the same pin twice
correctly cleared the probe with no result shown; and toggling the mode
back off and clicking two pins resumed normal wire-drawing (wire count
went from 1 to 2). No server-side state was touched (the test simulation
was never saved), so no cleanup was needed. Full regression suite green.

Sent to a critic pass on commit 1ad0888. Scored 5/10 -- the feature's
defining hard question (whether continuity correctly accounts for two
components sharing a breadboard row with zero explicit wires between
them, not just literal wire objects) passed cleanly: plugging a leg into
a breadboard hole already creates a real `auto:true` wire object, and
`window.simNodeId`'s `railGroups` collapses shared-rail pins to one node
string regardless of wiring, so `wireOnlyNetNodes`'s plain wire-only BFS
correctly reports "Connected" with no separate breadboard-aware solver
needed -- live-verified by dragging two resistors onto the same
terminal-strip hole and probing across them with no wire drawn between
the resistors themselves. But a real, live-reproduced bug shipped
anyway: the "Connected"/"Not connected" text and net highlight were
computed and cached once at the moment of the second probe click, then
never invalidated again. Undo, redo, reset-to-saved, checkpoint restore,
deleting the very component or wire involved, and import all mutate
`simData` and correctly reset `selected`/`wireStart`, but none of them
touched the cached continuity state -- so undoing the wire that made two
pins "Connected" left the stale "Connected" text and net highlight on
screen for a connection that no longer existed. Confirmed live: wired
two components, probed them (Connected, 3 highlighted elements), hit
Undo (wire count dropped to 0), and the result still read "Connected"
with 2 elements still highlighted.

Fixed by changing what gets cached: instead of storing the computed net
Set and result text at click time, `continuityLastProbe` now stores only
the two raw probed node identifiers, and `renderBuilder()` recomputes
`wireOnlyNetNodes()` and the resulting text/highlight completely fresh
on every single render -- self-healing after any mutation, present or
future, rather than requiring every one of the (now six-plus) simData-
mutating call sites to remember to also invalidate a cached continuity
result. If either probed component no longer exists at render time (the
delete-the-probed-component case), the state clears itself entirely
instead of trying to derive a node id from a component that's gone.
Also added `aria-live="polite"` to the result span, a genuinely dynamic
status text that's arguably the strongest case for it anywhere in this
admin, even though the critic correctly noted the rest of the admin has
no `aria-live` usage at all and this alone wasn't blocking.

Re-verified via Playwright, reproducing the critic's exact repro: wired
two components, probed them (Connected, 3 highlighted), hit Undo (wire
count to 0) -- now correctly self-heals to "Not connected" with 0
highlighted elements; hit Redo (wire restored) -- correctly re-reports
"Connected" with the highlight back; selected and deleted one of the two
probed components entirely -- correctly clears to an empty result with
no highlight and no thrown error. The original round-1 tests (connected/
unconnected pairs, same-pin-twice cancellation, mode toggle resuming
normal wire-drawing) were re-run unchanged and still pass. Full
regression suite green; no server-side state was touched in either
round (test simulations were never saved), so no cleanup was needed.

Sent back for a round-2 critic pass on commit 8455522. Scored 9/10 --
ship. Re-ran the exact round-1 repro live (wire a battery to an LED,
probe them for "Connected," undo the wire) and confirmed it now
self-heals to "Not connected" immediately with the highlight cleared.
Exhaustively grepped every `simData`-mutating call site in the file
(undo, redo, reset-to-saved, checkpoint restore, all three `openBuilder`
entry paths, place/duplicate/delete for single and multi-select, wire
draw/delete/kind-change, every property-edit field, and import) and
confirmed every single one already calls `renderBuilder()` right after
mutating -- meaning the "recompute fresh every render" fix is exhaustive
by construction rather than by having enumerated and patched each site,
so a future mutation site inherits correctness automatically as long as
it follows the file's existing universal render-after-mutate convention.
Also confirmed the wire-deleted-but-components-survive case (the actual
original repro) and the component-deleted case are handled by two
logically independent mechanisms, not aliases of the same check, and
that recomputing `wireOnlyNetNodes()` on every render has no realistic
performance or torn-state concern at this scale given JS's single-
threaded execution and the function's O(wires+components) BFS.

One new minor finding, logged rather than fixed: because `renderBuilder()`
now unconditionally rewrites the result span's `textContent` and classes
on every render whenever a probe is active -- not just when the
Connected/Not-connected value actually changes -- a screen reader is
likely to re-announce the same "Connected"/"Not connected" text on
completely unrelated actions (dragging another component, editing a
resistor's value, toggling an unrelated show/hide button) while a result
is still showing. This is a direct trade-off of the same unconditional-
recompute strategy that fixed the real bug, not a new defect it
introduced independently, and not a data-correctness issue -- a future
fix would skip the DOM write when the text/class state is unchanged from
the last render, worth doing if screen-reader users actually exercise
this tool, but not blocking.

Item #434 is done: 2 critic rounds (5/10, 9/10), the one real finding
(stale cached continuity result surviving simData mutations) fixed by
making the result reactively self-healing rather than patching each of
the several mutation call sites individually -- verified exhaustive, not
just spot-checked -- plus a small accessibility addition (aria-live on
the result span) folded in alongside it, with one minor aria-live
re-announcement side effect logged as an accepted, non-blocking gap.

### Twenty-second item: #139, local-vs-external image indicator for the page builder's image-url fields

Investigated where this genuinely applied before implementing anything,
since the Photo Editor itself already covers this exact idea: opening an
image in the editor shows "Editing a library image" vs. "Editing an
external image" in its hint text (`pe-hint`, pre-existing). The actual
gap was elsewhere -- the page builder's generic "Image URL" field type
(used by the plain image block, the before/after block's two image
fields, and background-image style fields) is a plain text input that's
always silently accepted either an uploaded file's `/media/...` URL or
any arbitrary external URL typed/pasted in directly, with zero
indication afterward of which kind a given field actually holds. An
admin coming back to edit a page months later has no way to tell, at a
glance, whether an image is durably hosted on this site or could vanish
the moment some other site takes it down or reorganizes its own URLs.

Added a small badge next to the field's existing Upload/Browse buttons:
"Local upload" (teal) or "External URL" (amber), or nothing when the
field is empty. Reuses the exact same detection rule `worker/db.js`
already uses elsewhere for "is this a site-local media reference"
(`url.startsWith("/media/")`) rather than inventing a new heuristic, so
the definition of "local" stays consistent across the codebase. The
badge updates live on every keystroke/paste and whenever Upload/Browse
fill the field, not just once on initial render, via the same
`input`/`change` event pattern the codebase already uses for other
field-linked UI (`setFieldUrl`'s dispatched `change` event). Wired into
all three places `.upload-trigger`/`.browse-trigger` buttons themselves
get wired (the block inspector, the bulk style-edit panel, and the
top-level document listener), so it covers every context this field type
appears in without needing a separate registration per call site.

Tested via Playwright: created a page, added an image block, opened its
inspector -- the field starts empty with no badge text; typing a
`/media/uploads/...` path shows "Local upload" with the teal `is-local`
class; replacing it with an external `https://...` URL shows "External
URL" with the amber `is-external` class; clearing the field back to
empty removes the badge text again. Full regression suite green; the
test page was deleted (both soft- and hard-delete) and confirmed gone
from the pages list afterward.

Sent to a critic pass on commit 30f0d7a. Scored 4/10 -- one real bug
that broke the feature's own core claim for the single most common path
it targets. The media-picker modal has a special "autofill" branch used
specifically when Browse is clicked on an image block's main URL field
(distinct from the generic `setFieldUrl()` path every other image-url
field, including before/after and background-image, correctly goes
through): it writes `input.value` and `block.content.url` directly and
calls `renderCanvas()`, but never dispatches a `change` event -- harmless
before this feature existed (nothing was listening), but the new badge
only re-evaluates on `input`/`change`, and `renderCanvas()` only rebuilds
the on-canvas block preview, never the inspector panel the badge and its
input actually live in. Net effect: picking a library image via Browse
on the plain image block's field visibly updated the URL and canvas
preview but left the badge showing its previous (often wrong) state
until the block was deselected and reselected for an unrelated reason.
Confirmed by exact id-matching that only this one field (id ending in
`-url`, the special branch's own trigger condition) was affected --
before/after's `beforeUrl`/`afterUrl` and the bulk panel's
`backgroundImage` field ids don't match that suffix and correctly fall
through to `setFieldUrl()`'s dispatched `change`.

Fixed with a one-line `input.dispatchEvent(new Event("change", { bubbles:
true }))` added right after the direct `input.value` assignment in that
branch -- the minimal change satisfying the badge's own live-update
contract, no broader architecture change needed. The critic separately
confirmed as non-issues (not fixed, not blocking): the `startsWith("/media/")`
detection would mislabel a full absolute URL to this site's own domain
as "External," but that's the exact same convention `worker/db.js`
already uses everywhere else for this question, and every actual write
path (Upload, Browse) only ever produces the relative form -- an admin
would have to manually paste an absolute URL to hit it, an accepted
pre-existing limitation this feature didn't introduce; whitespace
handling, multi-field id uniqueness (before/after's two fields), re-
render listener cleanup, and the bulk-panel's empty-starting-value
behavior were all traced and found correct.

Re-verified via Playwright, reproducing the critic's exact repro:
uploaded a real image to the library, opened an image block's inspector,
clicked Browse, picked that image -- without reselecting the block
afterward, the badge immediately read "Local upload" with the correct
`is-local` class, matching the input's now-updated value. The original
round-1 tests (empty/local/external/cleared states) were re-run unchanged
and still pass. Full regression suite green; the test page was deleted
and the test upload removed, both confirmed gone.

Sent back for a round-2 critic pass on commit 279d26d. Scored 5/10 --
the round-1 fix itself was confirmed genuinely correct (live-reproduced:
the dispatched `change` does reach the badge's own listener, attached
directly to the input, and bubbling is irrelevant since the listener is
on the target element itself), but the FIX'S OWN MECHANISM reintroduced
a real regression on the exact code path it touched. The image url
field's `data-key="url"` attribute means it already has a generic,
unrelated autosave-on-change listener wired by the inspector (every
`[data-key]` field gets one, firing its own `PATCH /blocks/:id` on
change). Dispatching a real `change` event to notify the badge also
fired that pre-existing listener -- synchronously, mid-branch, BEFORE the
alt/caption/credit autofill loop below it ran -- sending an incomplete
PATCH with only the url, immediately followed by the branch's own
deliberate merged-save PATCH with all four fields two lines later. The
critic captured both PATCH bodies live, ~1ms apart, and confirmed this
is exactly the "independent saves can race and silently drop a field"
failure mode the surrounding code's own comment was originally written
to guard against -- the round-1 fix broke that guarantee via a side
channel (an unrelated listener on the same element) rather than a
second deliberate save. Under adverse request-ordering, the incomplete
PATCH could persist last, silently reverting the alt/caption/credit
autofill while the in-memory state and on-screen inspector still showed
the correct values -- invisible until a reload.

Fixed by not dispatching a real event at all: `wireImageUrlSourceBadge()`
now stashes its `update` closure directly on the input element
(`input._imageUrlBadgeUpdate`), and the media-modal's block-autofill
branch calls that function directly instead of `dispatchEvent(new
Event("change"))`. This refreshes the badge with zero risk of also
triggering any other listener attached to the same shared input, present
or future -- a synthetic DOM event was never actually necessary here,
since the badge only ever needed its own update logic to re-run, not a
generic "something changed" signal broadcast to every listener on the
element.

Re-verified via Playwright with network-level PATCH capture: uploading a
real image, setting alt/caption/credit on it, then Browse-picking it into
a blank image block now fires exactly one `PATCH /blocks/:id`, containing
all four autofilled fields together (url/alt/caption/credit), with zero
incomplete intermediate request -- confirming the race is gone, not just
less likely. The badge still correctly reads "Local upload" immediately
afterward with no reselection needed, confirming the original round-1
fix's actual goal survived the correction. The original round-1 badge
tests (empty/local/external/cleared states) were re-run unchanged and
still pass. Full regression suite green; test page and test upload both
deleted and confirmed gone.

Sent back for a round-3 critic pass on commit 5f532fd. Scored 9/10 --
ship. The round-2 fix was re-verified as genuinely and completely
correct: grepped every `dispatchEvent` call in the file (7 total) and
confirmed the only one on this input is `setFieldUrl()`'s, used solely
by the non-block image-field path where dispatching is actually correct
and intended (no competing merged save exists there to race against);
the direct `input._imageUrlBadgeUpdate()` call touches nothing but the
badge's own text/class. Re-ran the double-save scenario live with a
twist -- pre-filling alt/caption/credit with non-empty values first, so
the autofill loop's own `!sibling.value` guards would skip them -- and
confirmed exactly one PATCH still fires, correctly preserving the
existing values while merging in the new url. Traced the timing concern
explicitly: `wireImageUrlSourceBadge()` runs synchronously in the same
render pass that inserts the input/badge markup, with no `await`/
microtask gap before Browse could possibly be clicked, so the `if
(input._imageUrlBadgeUpdate)` guard is defensive rather than masking a
reachable bug today. Confirmed no stale-closure/expando-leak risk either,
since `mediaPickTarget` is re-resolved via a fresh `querySelector` at
click time (never a captured stale element), and every re-render
discards old input/badge nodes together via `innerHTML =` before
re-wiring fresh ones.

Two narrow, non-blocking observations were logged rather than treated as
bugs: the `input.id.endsWith("-url")` check that gates the block-autofill
branch would also match a `text`-type field whose key happens to be
literally `"url"` (e.g. the button or project-card blocks) if such a
field ever gained a Browse affordance in the future -- unreachable via
today's UI (those field types never render `browse-trigger`/the badge in
the first place) but worth a comment if this code is touched again; and
the pre-existing (not a regression from this feature) fact that
before/after's `beforeUrl`/`afterUrl` field ids don't end in `-url`, so
Browse-picking into those always takes the plain non-merged save path,
skipping the alt/caption/credit autofill entirely -- a feature-
completeness gap outside this item's scope, not something #139 broke.

Item #139 is done: 3 critic rounds (4/10, 5/10, 9/10), two real findings
across the first two rounds -- the original stale-badge bug, and the
double-save race the first fix attempt introduced on the very same path
-- both fixed and verified live via network-level request capture, not
just UI-state inspection, with the detection-rule edge case (absolute
URLs to this site's own domain) and two narrow latent-coupling
observations logged as accepted, pre-existing, non-blocking gaps rather
than fixed.

### Twenty-third item: photo editor stale crop selection surviving rotate/flip

Fixed the pre-existing gap #92's critic review found and deliberately
deferred rather than folding into that diff: `rotate90()` and `flip()`
in `photo-editor.js` never cleared `cropRect` or hid the Apply Crop
button, so a crop selection drawn before either transform survived with
coordinates from before the transform. For a 90-degree rotate this is
especially broken since width/height swap -- the old coordinates land
somewhere completely different on the new canvas -- and for a flip the
canvas stays the same size but the pixels underneath the selection have
mirrored, so applying it afterward would silently crop the wrong,
mirrored region instead of throwing or visibly failing (`getImageData`
pads out-of-range reads with transparent-black rather than erroring).

Fixed by clearing `cropRect`, hiding `pe-apply-crop`, and clearing the
overlay at the end of both functions -- matching the exact pattern
`restoreSnapshot()` (used by Reset-to-original) already establishes for
"the canvas just changed underneath any in-progress selection."

Tested via Playwright: drew a crop selection, confirmed Apply Crop was
visible; rotated right and confirmed the canvas dimensions correctly
swapped (800x600 -> 600x800) AND Apply Crop was hidden again with no
selection surviving; drew a second selection and flipped horizontally,
confirming it was cleared the same way; sampled a canvas pixel afterward
to confirm the rotate+flip themselves still produced real image data (no
regression to the transforms' own correctness). Full regression suite
green; test upload deleted and confirmed gone.

Sent to a critic pass on commit fe438e0. Scored 8/10 -- the fix itself
was confirmed correct, minimal, idempotent, consistent with undo/redo
(which already independently clears `cropRect` via `restoreSnapshot()`,
making this fix's own clearing redundant but not conflicting on that
specific path), and correctly scoped (grepped every other canvas-
transforming operation -- one-shot filters, brightness/contrast/preset
adjustments, brush commits, annotations -- and confirmed none of them
resize or reposition canvas content the way rotate/flip do, so none of
them needed the same fix). But the critic found this fix stopped one
reasoning-step short of a sibling bug in the exact same two functions,
of the same underlying class: rotating or flipping while a BRUSH stroke
or SHAPE-tool drag is actively in progress (reachable only via multi-
touch -- holding a drag with one finger while tapping a toolbar button
with another, the same narrow scenario the file's own `startCompare()`
guard already has to account for elsewhere) leaves `strokeActive`/
`dragStart`/`lastPoint` untouched, so a brush stroke's mask (sized for
the OLD canvas) or a shape's drag anchor (in OLD coordinate space) gets
composited/committed against the NEW, post-transform canvas on release
-- the identical "reads/writes the wrong region" failure mode as the
original crop bug, just for two different tools. Not a regression this
commit introduced (the pre-existing `restoreSnapshot()` precedent this
fix mirrored had the identical gap for undo/redo/reset all along), but
the critic was right that a 9+/10 version of this fix would either have
extended the guard to cover it or explicitly logged it as deferred --
it did neither.

Fixed by factoring a shared `cancelActiveDrag()` helper that clears
`cropRect`/`pe-apply-crop`/the overlay (the original fix) AND `dragging`/
`dragStart`/`strokeActive`/`lastPoint` (the sibling gap) together, called
from `rotate90()` and `flip()`. Since the identical root cause exists in
`restoreSnapshot()` (used by undo/redo/reset) at essentially zero extra
cost once the shared helper existed, applied it there too rather than
leaving that specific instance as a separately-tracked deferred item --
the fix generalizes to every place the file already changes canvas
content/dimensions out from under an in-progress interaction, not just
the two functions the critic happened to review.

Re-verified via Playwright: the original round-1 regression checks still
pass (Apply Crop hides after rotate, canvas dims correctly swap, undo
correctly reverts a rotate back to the original 800x600); additionally
simulated the multi-touch mid-stroke scenario by starting an erase-brush
stroke (pointer held down, `strokeActive`/`dragging` true), firing a
rotate mid-stroke, then releasing the pointer -- no exception was thrown,
canvas dimensions stayed sane, and a sampled pixel confirmed the canvas
still held real, non-corrupted image data rather than a botched
composite from the mismatched pre/post-transform stroke. Full regression
suite green; test upload deleted and confirmed gone.

Sent to a round-2 critic pass on commit 81af099. Scored 8/10 again --
the `cancelActiveDrag()` fix itself was confirmed genuinely correct with
no new bugs: the hoisting concern from round 1 doesn't apply in practice
(the function is only ever called from click/keydown listeners that
can't fire until the whole module has finished executing, by which point
every `let` binding it references is initialized); resetting `dragging`
turned out to make the `strokeActive`/`dragStart` resets technically
redundant-but-harmless, since `pointerup`'s own `if (!dragging) return;`
guard already exits before either would matter; `ensureMask()`'s
existing dimension check already correctly reallocates a stale
`maskCanvas` before the next brush stroke; and calling the shared helper
from all three call sites was confirmed idempotent for the overwhelming
common case where nothing was actually in progress. But the critic found
a fourth species of the exact same bug class in the exact same two
functions this fix was reviewing: `baseSnapshot`, the canvas clone an
adjust-slider (brightness/contrast/saturate) drag holds while in
progress, was never cleared by `cancelActiveDrag()` -- so a multi-touch
scenario (holding a slider drag with one finger, tapping rotate/flip
with another) would leave the next slider tick painting an OLD-sized/
oriented `baseSnapshot` onto the NEW post-transform canvas, the identical
"resumes against stale state instead of being cancelled" failure this
whole fix chain has been closing off, just for a fourth interaction type
nobody had checked yet.

Fixed by extending `cancelActiveDrag()` once more: now also nulls
`baseSnapshot` and resets the three adjustment sliders to 0, discarding
an interrupted slider drag the same way crop/brush/shape are discarded
rather than letting it resume against mismatched state. The pixels
already baked into the canvas by the adjustment up to the interruption
point stay correctly in place (rotate/flip transforms whatever's
currently on the canvas, filtered or not); only the *next* slider tick's
would-be corruption is what's prevented.

Re-verified via Playwright with the exact scenario described: started a
brightness-slider drag (dispatching a synthetic `input` event to set
`baseSnapshot`), fired a rotate mid-drag, confirmed the canvas correctly
swapped dimensions AND the brightness slider reset to 0; then continued
moving the same slider afterward -- the precise moment that would have
tried to paint an 800x600 snapshot onto a 600x800 canvas if `baseSnapshot`
hadn't been cleared -- and confirmed the canvas dimensions stayed correct
with real, non-corrupted pixel data, no exception. The round-1 regression
tests (crop-clear-on-rotate, undo reverting correctly, mid-brush-stroke
rotate not crashing) were re-run unchanged and still pass. Full
regression suite green; test uploads deleted and confirmed gone.

Sent to a round-3 critic pass on commit db326be, explicitly asked to
hunt for a fifth species of the same bug class with fresh eyes given how
many times this recurring pattern had already been found. Scored 5/10 --
this round's own `baseSnapshot` fix was re-confirmed correct with no
regression risk, but the audit surfaced a genuine, more severe, and more
easily reachable fifth species: the Compare press-and-hold feature
(`compareSavedState`) has the exact same "cached state tied to
pre-transform canvas, resumed/read on a later event" shape as
crop/brush/shape/baseSnapshot -- but unlike those three, `undo()`,
`redo()`, and `resetToOriginal()` already had an `isComparing()` guard
against it, while five OTHER canvas-mutating actions did not:
`rotate90()`, `flip()`, `applyOneShotFilter()` (the one-click grayscale/
sepia/invert filters), the Apply Crop click handler, and the Apply Preset
change handler. Each of these calls `pushUndo()` and mutates the canvas
directly with zero check of whether Compare is currently held.

Critically, this one doesn't need multi-touch at all: Compare has both a
pointer binding (press-and-hold) AND a keyboard binding (hold Space/
Enter), so an ordinary desktop user holding Compare with the keyboard in
one hand and clicking Rotate/a filter/Apply Crop/a preset with the mouse
in the other hits this with completely standard hardware. The critic
live-reproduced it: applied grayscale, held Compare (canvas correctly
showed the original), clicked Rotate while still held (canvas silently
rotated the temporary ORIGINAL-image preview, not the real grayscale
edit), released Compare (the canvas snapped back to the real grayscale
state at its original dimensions -- the rotate vanished completely, with
zero error), and confirmed Undo landed directly on the pristine original,
meaning `rotate90()`'s `pushUndo()` mid-compare had pushed a bogus entry
that corrupted the undo stack on top of losing the edit outright.

Fixed by adding the same `if (isComparing()) return;` guard the three
already-protected functions use, to all five gaps: `rotate90()`,
`flip()`, `applyOneShotFilter()`, the Apply Crop click handler, and the
Apply Preset change handler -- placed as the very first line of each, so
`pushUndo()` never runs and no bogus entry can be pushed by construction
when the guard fires.

Re-verified via Playwright, reproducing the critic's exact scenario using
synthetic `PointerEvent`s dispatched directly on the Compare button
(rather than real OS mouse movement, which would trigger the button's own
`pointerleave`-ends-compare handler on the way to clicking elsewhere,
masking the very interaction being tested): held Compare, attempted a
rotate while held -- canvas dimensions stayed completely unchanged,
confirming the action was blocked rather than silently discarded;
released Compare -- dimensions still correctly unchanged, no rotate ever
took effect; then performed a real (non-comparing) rotate afterward to
confirm the guard doesn't break normal use -- dimensions correctly
swapped as expected. The round-1/round-2 regression tests (crop-clear-
on-rotate, mid-stroke rotate, mid-adjust-slider rotate) were re-run
unchanged and still pass. Full regression suite green; test uploads
deleted and confirmed gone.

Done: 3 critic rounds (8/10, 8/10, 5/10), three real findings across all
three rounds -- brush/shape-tool drag state, adjust-slider `baseSnapshot`
state, and (the most severe, and reachable via completely standard
keyboard+mouse use rather than requiring multi-touch) five actions
missing the pre-existing `isComparing()` guard that other actions already
had -- all fixed. What started as a single deferred crop-selection bug
from an earlier feature's critic review turned into finding and closing
five distinct instances of the same "cached interaction state outlives
the canvas transform that invalidated it" bug class across this file, the
last and worst of which was a real, easily-triggered silent-data-loss bug
with no connection to the original crop finding at all -- a reminder that
"send it back to a fresh critic with instructions to look for more of the
same pattern" can surface real bugs a narrower re-review of just the
latest diff would never have found.

Sent to a round-4 critic pass on commit 473ef97, explicitly asked to
exhaustively cross-reference every canvas-mutating action against which
ones now have the `isComparing()` guard, since the pattern had already
recurred five times. Scored 5/10 -- found a sixth, and live-reproduced it:
`onAdjustInput()`/`onAdjustCommit()` (the brightness/contrast/saturate
slider handlers) were never guarded, and -- unlike the five fixed last
round -- `startCompare()`'s existing `dragging` check doesn't cover an
adjust-slider drag either, since sliders don't set `dragging` (that flag
is reserved for canvas pointer tools). So the gap was bidirectional:
Compare could start mid-slider-drag, and a slider could act while Compare
was already active. Live-reproduced the exact failure: applied grayscale
(the real edit), held Compare (correctly showed the original), moved the
brightness slider while held (pushed a bogus undo entry and set
`baseSnapshot` to the temporary preview), released Compare (correctly
restored the grayscale edit), then moved the slider again -- the real
edit was silently destroyed and replaced with content derived from the
stale, compare-time `baseSnapshot`. The critic noted this is arguably the
MOST likely of all six gaps to actually get hit in practice, since
sliders are dragged continuously, unlike a single button click.

Fixed by adding `if (isComparing()) return;` to both `onAdjustInput()`
and `onAdjustCommit()`, and, as a belt-and-suspenders symmetry fix,
adding a `baseSnapshot` check alongside the existing `dragging` check in
`startCompare()`'s own guard -- so Compare can't start mid-slider-drag in
the first place, not just get correctly ignored by the slider if it does.
Also fixed a related minor issue the critic flagged: the Apply Preset
`<select>`'s displayed value updates before its own `change` event fires,
so blocking the change while comparing left the dropdown showing a preset
name that was never applied, with no way to re-trigger applying it
without picking something else first (a `<select>` doesn't fire `change`
on re-selecting its already-displayed value) -- fixed by resetting the
dropdown back to its placeholder when the guard fires.

The critic also flagged, as a real (not hypothetical) observation rather
than a blocking finding: the scattered `if (isComparing()) return;`
pattern, now copy-pasted across eight call sites, has no structural
enforcement -- proven by the fact that an exhaustive, dedicated
cross-reference pass still missed one of the eight candidates. Logged as
tech debt worth a future pass (e.g. a single `performEdit(mutateFn)`
wrapper every canvas-mutating action routes through, checking
`isComparing()` once in one place) rather than continuing to rely on
every future addition remembering to paste the same guard -- not fixed
now, since restructuring every call site is a larger, riskier change than
this bug-fix chain's scope justifies.

Re-verified via Playwright, reproducing the critic's exact scenario: the
full grayscale -> hold-Compare -> move-slider-while-held -> release ->
move-slider-again sequence now correctly preserves the grayscale edit
throughout, confirmed by sampling the same pixel at each step (gray ->
original -> gray again, never corrupted); confirmed the reverse direction
(starting a slider drag, then attempting to start Compare mid-drag) is
also now blocked, with Compare's `active` class never applying. All prior
rounds' regression tests (crop-clear, mid-stroke rotate, mid-adjust
rotate, the five-guard Compare-block tests) were re-run unchanged and
still pass. Full regression suite green; test uploads deleted and
confirmed gone.

Done: 4 critic rounds (8/10, 8/10, 5/10, 5/10), four real findings across
all four rounds -- brush/shape-tool drag state, adjust-slider
`baseSnapshot` state (found twice, once for the transform-clearing side
in round 3 and once for the missing Compare-guard side in round 4),
brush/shape-tool drag state, and the five-then-six missing
`isComparing()` guards -- all fixed, plus one deliberately-deferred tech-
debt observation (the scattered-guard maintenance risk) logged rather
than acted on. What began as a single deferred crop-selection bug from an
unrelated feature's critic review turned into finding and closing six
distinct instances of the same "cached interaction state outlives the
canvas/comparison state that invalidated it" bug class, the last two of
which were real, easily-triggered silent-data-loss bugs reachable with
completely ordinary keyboard-and-mouse use -- not the multi-touch edge
case the fix chain started out chasing.

Sent to a round-5 (planned-final) critic pass on commit 5ba1383. Scored
4/10 -- found a 7th real bug in the same family, live-reproduced. The
`cancelActiveDrag()` helper this whole chain built specifically to
invalidate a stale `baseSnapshot` was correctly wired into
`restoreSnapshot()`, `rotate90()`, and `flip()` -- but three OTHER
canvas-mutating actions that had separately received the `isComparing()`
guard in earlier rounds (`applyOneShotFilter()`, the Apply Preset change
handler, and the Apply Crop click handler) were never wired to it. Since
`isComparing()` and `baseSnapshot`-staleness are two genuinely separate
concerns (one about the Compare feature, one about a slider drag left
open), fixing the first at those three sites never touched the second --
which is presumably exactly how this stayed hidden through four rounds
that were each focused on the compare-guard inventory specifically.
Live-reproduced via a multi-touch-style repro (one finger holding a
slider mid-drag via a synthetic `input` event with no `change`, a second
"finger" clicking a filter/crop button): a grayscale filter applied while
a brightness drag was held open got silently erased back to the original
color the moment the still-open slider fired its next tick, painting the
stale pre-filter `baseSnapshot` back over the correctly-filtered canvas;
worse, the same sequence with Apply Crop instead of a filter left the
canvas at the new, correctly cropped dimensions but with the WRONG
pixels -- the old, differently-sized `baseSnapshot`'s top-left corner
painted onto the new canvas at the wrong scale/offset, destroying the
crop result while leaving its dimensions looking superficially correct.

Fixed by calling `cancelActiveDrag()` at the end of all three functions,
mirroring `rotate90()`/`flip()`. For Apply Crop specifically, replaced
its own inline `cropRect = null; hide the button; clearOverlay()` lines
(which only ever handled the crop-selection half of the problem) with
the shared helper, the same refactor already applied to `restoreSnapshot()`
in an earlier round.

Re-verified via Playwright, reproducing the critic's exact two scenarios:
opened a slider drag, applied grayscale (canvas correctly went gray), then
continued the still-open slider -- the canvas stayed gray-toned instead of
reverting to the original color, confirming the filter survived; opened a
slider drag, drew and applied a crop (canvas correctly resized smaller),
then continued the still-open slider -- the canvas dimensions stayed at
the cropped size with no revert, confirming the crop result wasn't
corrupted. Every prior round's regression tests (crop-clear-on-rotate,
mid-stroke rotate, mid-adjust-slider rotate, the six-guard Compare-block
tests including the slider-vs-Compare bidirectional case) were re-run
unchanged and all still pass. Full regression suite green; test uploads
deleted and confirmed gone.

Done: 5 critic rounds (8/10, 8/10, 5/10, 5/10, 4/10), seven real findings
across all five rounds -- crop-selection state, brush/shape-tool drag
state, adjust-slider `baseSnapshot` state (its transform-clearing side),
five-then-six missing `isComparing()` guards, and finally three actions
missing `baseSnapshot`-invalidation despite already having the unrelated
`isComparing()` guard -- all fixed. What began as a single deferred
crop-selection bug from an unrelated feature's critic review became a
five-round audit closing seven distinct instances of the same "cached
interaction state outlives the canvas/comparison state that invalidated
it" bug class, several of which were real, easily-triggered
silent-data-corruption bugs with no dependency on multi-touch hardware at
all. The clearest lesson from this chain: two orthogonal guards
(`isComparing()` for the Compare feature, `cancelActiveDrag()`/
`baseSnapshot` for adjust-slider staleness) can each individually look
complete while a given call site has only one of the two -- a checklist
covering "does this action need guard A" is not the same checklist as
"does this action need guard B," and an exhaustive review of one doesn't
substitute for a separate exhaustive review of the other.

Before sending back for a sixth critic round, applied that exact lesson
proactively: the round-5 critic's own report noted brush-stroke and
shape-tool commits were "correctly guarded, or transitively safe" against
`isComparing()`, but never separately checked whether they had the
OTHER guard (`baseSnapshot`-staleness) -- the same blind spot that let
the filter/preset/crop-apply gap slip through five rounds. Checked
directly: `commitBrushStroke()`/`commitAnnotation()` (the pointerup
handler's brush and shape commit paths) mutate canvas pixels with zero
`baseSnapshot` invalidation, so the identical multi-touch scenario
(a slider drag held open on one input while a brush stroke or shape
commits on another) would silently erase the stroke/shape the moment the
still-open slider fired its next tick.

Fixed by factoring the `baseSnapshot`-clearing lines out of
`cancelActiveDrag()` into their own `invalidateOpenAdjustDrag()` helper,
called from the brush and shape commit branches of the pointerup handler
directly -- NOT via a full `cancelActiveDrag()` call there, since that
also clears `cropRect`, which would incorrectly wipe out an unrelated,
still-in-progress crop selection drawn on a completely different tool
(the "select" branch of that same handler only finalizes selection UI
state on release, it doesn't mutate canvas pixels the way brush/shape
commits do, so it correctly does NOT get this treatment).
`cancelActiveDrag()` itself now just calls the new helper alongside its
other resets, unchanged in behavior for its three existing call sites.

Verified via Playwright: opened a slider drag, committed an erase-brush
stroke on the canvas (confirmed alpha dropped to 0 at the erased spot),
then continued the still-open slider -- the erased spot's alpha stayed
at 0 instead of the stale `baseSnapshot` painting the pre-erase pixels
back over it, confirming the stroke survived. Re-ran every prior test
from all five rounds (crop-clear-on-rotate, mid-stroke rotate, mid-
adjust-slider rotate, Compare-block guards, filter/crop-apply baseSnapshot
fixes) unchanged, including specifically confirming drawing a fresh crop
selection still shows the Apply Crop button correctly (proving the
targeted `invalidateOpenAdjustDrag()` fix doesn't over-clear crop state
the way a blanket `cancelActiveDrag()` call there would have). Full
regression suite green; test uploads deleted and confirmed gone.

Sent for a round-6 critic pass on commit a8d277b, this time explicitly
asked to build an INDEPENDENT from-scratch inventory of every canvas-
mutating action and every cross-event `let` variable, cross-referenced
against both guard mechanisms separately, rather than only re-checking
this round's specific fix. Scored 6/10 -- confirmed this round's own fix
(brush/shape commit invalidation) correct on every sub-question asked
(right order relative to the pixel commit, correctly excluded from the
crop-select branch, a true no-op during ordinary single-touch use, no
remaining `startCompare()` window), and confirmed the guard inventory
was otherwise complete for all ~13 canvas-mutating actions and ~15
cross-event state variables identified -- except one: `placeText()` (the
text-annotation tool) mutates canvas pixels via `ctx.fillText()` but was
never wired to `invalidateOpenAdjustDrag()`, the identical gap just fixed
for brush/shape commits. The critic noted this one is arguably EASIER to
trigger than the brush/shape cases: `placeText()` calls `prompt()`, which
blocks the main thread while its dialog is open, so another pointer's
adjust-slider `input` events queue up rather than requiring precise
simultaneous timing -- the instant the text dialog is confirmed and the
main thread frees up, the queued slider tick fires against the still-set,
now-stale `baseSnapshot` from before the text was placed, painting it
back over the canvas and silently erasing the just-placed text.

Fixed with the same one-line pattern as brush/shape: `invalidateOpenAdjustDrag()`
called in `placeText()` immediately after `ctx.fillText(...)` bakes the
text in. Re-verified via Playwright: opened a slider drag, placed text
via the text tool (confirmed a non-red pixel appeared where the text was
drawn), then continued the still-open slider -- the text stayed visible
instead of the stale `baseSnapshot` erasing it. Every prior round's
regression test (crop-clear-on-rotate, mid-stroke rotate, mid-adjust
rotate, Compare-block guards for all six previously-fixed actions, the
filter/preset/crop-apply and brush-stroke `baseSnapshot` fixes) was
re-run unchanged and all still pass. Full regression suite green; test
uploads deleted and confirmed gone.

Done: 6 critic rounds (8/10, 8/10, 5/10, 5/10, 4/10, 6/10), eight real
findings across all six rounds, plus one instance (brush/shape commits)
fixed proactively between rounds 5 and 6 without waiting for a critic to
surface it independently -- nine total instances of the same underlying
bug class found and fixed: crop-selection state, brush/shape-tool drag
state, adjust-slider `baseSnapshot` state on its transform-clearing side,
six missing `isComparing()` guards, three actions (filter/preset/crop-
apply) missing `baseSnapshot`-invalidation despite already having
`isComparing()`, brush/shape commits missing the same, and finally the
text-annotation tool missing it too. What began as a single deferred
crop-selection bug from an unrelated feature's critic review became a
six-round exhaustive audit of an entire file, closing every instance of
"cached interaction state outlives the canvas/comparison state that
invalidated it" that two independent, from-scratch, full-file
cross-reference passes (rounds 4 and 6) could find -- with round 6's own
inventory turning up only one gap, in a mutator (`placeText()`) that had
never been the specific target of any prior round's fix, rather than
another miss in the areas already patched. That -- a fresh full-file
inventory finding progressively fewer and more scattered gaps rather than
repeatedly missing the same area -- is the actual signal that this
pattern search has converged, not merely that enough rounds have
happened. Closing this out here.

A final, narrow targeted check (not another full audit, per the round-6
critic's own recommendation) confirmed the `placeText()` fix is correctly
ordered (mutate-then-invalidate, matching every other fixed call site)
and re-verified that text and eyedropper are genuinely the only two
`pointerdown`-synchronous canvas actions -- crop/brush/shape all defer
their real mutation to `pointerup`, already covered. Ship confirmed.
Fix chain closed at commit 6309587.

### Twenty-fourth item: #394, simulation wire labels

Added a `label` field to wires, mirroring the existing per-component
label pattern exactly: a text input in the wire's inspector panel (shown
when a wire is selected, alongside its existing Style dropdown and
Delete button), rendered as a small SVG `<text>` positioned just above
the wire's midpoint when non-empty -- the same "text sits just above the
thing it labels" convention the breadboard's rail labels and each part's
own body label already use, rather than inventing a new placement rule.
Typical use: labeling a wire "GND" or "5V" on a more complex circuit
where tracing which rail a given wire belongs to isn't obvious at a
glance.

Implemented in both places a simulation's SVG gets rendered: the admin
builder (`simulation-builder.js`'s `renderWireSvg()`) and the public-
facing embed (`worker/simulation-render.js`'s own `renderWireSvg()`),
using the exact same midpoint-and-offset placement formula in both so a
wire labeled in the builder shows identically on the public page, not
just in the admin. Added matching `.sim-wire-label` CSS to both
stylesheets (`public/admin/style.css` for the builder, `public/style.css`
for the public embed).

Tested via Playwright: wired two components together, selected the wire,
confirmed the label input exists and no label renders while empty; typed
"GND" and confirmed a `.sim-wire-label` text element with that exact
content appeared on the canvas; saved the simulation and loaded its
public embed page in a fresh browser context, confirming the same "GND"
label rendered there too via the worker-side render path, not just the
admin builder's client-side one. Full regression suite green; the test
simulation was deleted (soft- and hard-delete) and confirmed gone from
the simulations list afterward.

Sent to a critic pass on commit 0feb17f. Scored 6/10 -- three real,
narrow, single-file fixes, plus confirmation that persistence, multi-wire
scoping, and undo/redo all work correctly with no bug found in any of
those. Findings:

1. **Security**: the shared `escapeXml()` helper (used for both SVG text
   content and, for both wire and component labels, HTML attribute values
   like `value="..."`) only ever escaped `&`/`</`/`>` -- correct for its
   original SVG-text use, but never quotes, since `.innerHTML`'s DOM-based
   text-node serialization has no reason to escape a character that only
   matters in attribute-value context. A label containing a `"` (e.g.
   `"><img src=x onerror=...>`, reachable via the JSON import feature,
   which loads arbitrary untrusted JSON with no field validation, or a
   shared template/export file from elsewhere) breaks out of the input's
   `value` attribute and injects live markup into the admin inspector.
   Not a new bug this feature introduced -- it's a structural copy of a
   pre-existing identical flaw already present on `comp.label` -- but this
   feature doubled the attack surface by reusing the same flawed helper
   for a second field.
2. **Degenerate-wire edge case**: the public embed's `renderWireSvg()`
   already skips zero-length "wires" (a part plugged directly into a
   breadboard hole, not a real cable) before doing anything else, but the
   admin builder's own copy of that function never had the same guard --
   harmless before labels existed (an invisible zero-length path is a
   no-op either way), but a labeled degenerate wire (reachable via JSON
   import) would render an orphaned floating label with no visible wire
   under it in the admin canvas specifically.
3. **Minor contrast bug**: the public stylesheet's `.sim-wire-label`
   hardcoded `fill: #888` instead of the theme-aware `var(--text-dim)`
   every comparable "dim secondary text" rule in the file already uses
   (the admin stylesheet's own equivalent rule already got this right) --
   under WCAG AA contrast against the light theme's near-white background.

Fixed all three: `escapeXml()` now also escapes `"`/`'` after its
existing DOM-based `&`/`<`/`>` escaping, closing the flaw for both wire
labels and (as a side effect, since it's the same shared helper)
component labels; the admin's `renderWireSvg()` now has the identical
zero-length-wire early return the worker's sibling function already had;
`public/style.css`'s `.sim-wire-label` now uses `var(--text-dim)` instead
of a hardcoded color. A fourth, non-blocking observation (fixed-offset
label placement can crowd a very short or steep wire) was logged rather
than fixed, since it matches an existing, unchanged codebase convention
(every other label in this file uses a single fixed offset with no
collision awareness) rather than being a regression this feature
introduced.

Re-verified via Playwright: typed an XSS-style payload
(`"><img src=x onerror="window.__xssFired=true">`) into the wire label
field and confirmed it never executed, the input correctly roundtrips
the raw text, and no stray `<img>` element was injected into the
inspector DOM; imported a hand-crafted zero-length labeled wire via the
JSON import flow (the exact reachability path the critic identified) and
confirmed zero `.sim-wire-label` elements rendered, versus the orphaned
label the bug would have produced. The original round-1 tests (label
input exists, renders on canvas, persists through save and shows on the
public embed) were re-run unchanged and still pass. Full regression
suite green; no test simulations left behind in either round.

Sent back for a round-2 critic pass on commit 2a81580, specifically
asked to independently verify the escaping fix's ordering (does quote-
escaping after DOM-based `&`/`<`/`>` escaping ever double-escape) and to
search broadly for sibling instances of the same unescaped-attribute
pattern, given the task explicitly named JSON import's total lack of
field validation as the reachability vector. Scored 4/10 -- the ordering
was confirmed genuinely safe (hand-traced multiple adversarial payloads
including a literal `&quot;` typed by a user, which correctly round-trips
without decoding), and the worker-side `escXml()` was independently
re-verified correct rather than taken on faith -- but the broader search
found exactly what it was sent to look for: four more call sites in
`simulation-builder.js` building an HTML attribute from unescaped,
JSON-import-controlled data, the identical vulnerability class as round
1's finding, just untouched by that fix: `comp.id`/`wire.id` interpolated
raw into `data-id`/`data-comp` attributes, and `comp.resistance`/
`comp.voltage` interpolated raw into `value="..."`. Same severity and
reachability as round 1 -- a crafted JSON "circuit" import executing
arbitrary script in the admin's authenticated session the moment the
malicious component/wire renders or its inspector opens.

Fixed all four, plus one more the critic's search didn't explicitly name
but is the same pattern: `wire.kind` was building a CSS class name
(`sim-wire-${wire.kind}`) from an unconstrained JSON-import value, the
identical exposure `comp.type` already avoids via its implicit
`REG[comp.type]` whitelist lookup earlier in the same function -- fixed
by whitelisting `wire.kind` to the two values its own `<select>` can
actually produce, the same "constrain to known-safe values, don't just
escape" approach already used for the type field it sits next to.
`comp.id`/`wire.id`/pin-dot `data-comp` are now routed through
`escapeXml()` like the labels already are; `comp.resistance`/
`comp.voltage` are coerced through `Number(...) || <existing default>`
instead of just escaped, since they're semantically numeric fields and
`Number()`'s output can never contain HTML-significant characters --
fixing both the injection and the display of a stray string in one step.

Re-verified via Playwright: imported a JSON circuit with all four
distinct payloads simultaneously (a component id, a wire id, a wire
kind, and a resistance/voltage value each carrying a
`" autofocus onfocus="window.__xXss=true" x="`-style breakout attempt),
selected the resulting components to force their inspector panels open
(the exact trigger point for an attribute-breakout payload), and
confirmed none of the four global flags the payloads would have set ever
fired; confirmed the battery's voltage field correctly displayed the safe
numeric fallback ("9") instead of the injected string; confirmed both
components still rendered correctly with well-formed markup. The
round-1 tests (XSS-safe wire label round-trip, zero-length-wire label
suppression, label persists to public embed) were re-run unchanged and
still pass. Full regression suite green; no test simulations left behind
in any round.

Item #394 is done: 2 critic rounds (6/10, 4/10), eight real findings
across both rounds -- the original shared-helper quote-escaping gap
(closing an identical pre-existing flaw on component labels as a side
effect), a degenerate-wire label edge case, a contrast issue, and five
more unescaped/unconstrained attribute-interpolation sites the first
round's fix didn't reach -- all fixed and verified live via actual
JSON-import attack payloads, not just re-checking the originally-reported
vectors. The clearest lesson: fixing one flawed shared helper's call
sites is not the same as auditing every place user-controlled data
reaches an HTML attribute in the same file, and "the reachability vector
is unvalidated JSON import" is worth treating as an instruction to sweep
the whole render path for that vector's blast radius, not just patch the
one field a bug report happened to name.

Sent for a round-3 pass explicitly framed as an exhaustive, from-scratch
security sweep (not a diminishing-returns re-check) of the entire file
plus its rendering dependency `sim-components.js`, checking every
component-type's `render()` function individually rather than just the
two already fixed. Scored 9/10 -- ship. Built a systematic field-by-field
inventory of every `comp.`/`wire.` value reaching an HTML/SVG string
across both files and confirmed each one is escaped, whitelisted, or
numerically coerced: `power_supply`'s `outputVoltage`, `led`'s `color`,
`resistor`'s `resistance` (routed through a lookup table that only ever
emits fixed hex values), `switch`'s `closed` (boolean-coerced),
`battery`'s `voltage`, and `mcu_teensy`'s `label` in `sim-components.js`
were all already safe (that file's own local `escXml` already correctly
escaped quotes, unlike the flaw round 1 found in the builder's copy);
checkpoints/templates are populated only from the admin's own `prompt()`
calls, never touched by JSON import, so they carry no additional
exposure; the downstream electrical-analysis layer that feeds the
inspector's status text was traced to confirm every value passing through
it is a genuine JS number by construction before it ever reaches a
template literal, regardless of what a malicious JSON import put in the
original field.

One point held back for a real but non-security robustness gap, logged
rather than fixed: `querySelector` template strings built from unescaped
`wire.id`/component `id` (used to look up an element by id during drag/
wire-update operations) throw a `DOMException` if an imported id contains
a `"`, since that breaks CSS-selector syntax -- a crash-on-malformed-
import bug, not XSS, so it doesn't block closing this item, but worth a
follow-up if imported-data robustness (as opposed to injection safety)
gets its own pass later.

Item #394 is done: 3 critic rounds (6/10, 4/10, 9/10), eight real
security findings across the first two rounds -- all fixed and verified
live via actual crafted JSON-import attack payloads -- confirmed complete
by a third, genuinely exhaustive, from-scratch sweep of the whole file
and its rendering dependency, not just a re-check of what earlier rounds
already found. What started as a small feature request (a text label on
wires) surfaced and closed a real, multi-site XSS vulnerability class in
the simulation builder's JSON import path -- a good example of why "send
the critic back with instructions to search more broadly around a found
vulnerability's reachability vector" matters more for security findings
than for ordinary bugs, where the blast radius of "this exact input path
has zero validation" is worth mapping in full rather than patching one
symptom at a time.

### Twenty-fifth item: #402, recently-used parts in the simulation palette

Scoped to "recent" only, not "favorites": a recent-use tracker (localStorage,
capped at 6 distinct types, most-recent-first, deduped so re-placing an
already-recent type just moves it to the front rather than listing it
twice) requires zero new UI beyond a rendered list -- it's purely derived
from what the admin already does. "Favorites" would need an explicit
mark/unmark affordance on every palette button and its own persisted
set, a genuinely separate feature rather than a one-line variant of this
one, and the backlog item's own description ("localStorage list on top
of existing palette") maps far more directly onto auto-tracked recency
than onto a manually-curated favorites list. Left as a distinct future
item rather than force-fit into this one's scope.

Implementation: a new "Recently used" section at the top of the parts
palette, hidden entirely when no history exists yet, shown as small
pill-style buttons above the full static list once at least one part has
been placed. Clicking a recent-part button adds that component exactly
like its full-list counterpart -- both now route through one shared
`addComponentFromPalette(type)` function (previously only the static
buttons' own inline click handler), which also records the just-placed
type into the recent list on every placement, static or recent-shortcut
alike. Stored in localStorage (not per-simulation state), since "what did
I just reach for" is a builder-wide habit that should carry over between
different simulations, the same way a real toolbox's most-used bin
would. Recent-list entries from an old session referencing a component
type that no longer exists in the current registry are filtered out on
read, so a future removed component type can't leave a dead, do-nothing
button behind. Deliberately given its own CSS class
(`sim-palette-recent-btn`) rather than reusing `.sim-palette-btn`, so the
existing search-filter logic (which specifically targets `.sim-palette-btn`)
doesn't apply to it -- the recent shortcuts are meant to stay visible
as a fixed quick-access row regardless of what's typed into the parts
search box, not be filtered the same way the full list is.

Tested via Playwright: confirmed the recent section starts hidden with a
freshly-cleared localStorage; placed a resistor then an LED and confirmed
the section became visible with both listed most-recent-first ("LED",
"Resistor"); clicked the recent LED shortcut and confirmed it actually
added a new component (component count went from 2 to 3, not just a
UI-only action); closed the builder and opened a fresh one (simulating a
new session) and confirmed the recent list persisted via localStorage
across that boundary. Cleaned up the test's own localStorage key
afterward so it doesn't leave state for future test runs or the real
admin's actual usage history. Full regression suite green; no
simulations were saved during this test, so no server-side cleanup was
needed.

Sent to a critic pass on commit cb970ba. Scored 6/10 -- explicitly told
to take the localStorage-tampering vector seriously given this same
file's earlier XSS history, and it found a real bug of a related but
distinct class: `getRecentTypes()`'s stale-entry filter, `raw.filter((t)
=> REG[t])`, is a plain truthy lookup, not an own-property check --
since `REG` is a plain object literal (inherits from `Object.prototype`),
a localStorage value like `"constructor"` or `"toString"` (writable via
devtools, or in principle a hypothetical future XSS elsewhere on the
origin) resolves through the prototype chain to a real, truthy method
and passes the filter as if it were a genuine component type. Traced the
full crash chain: `addComponentFromPalette("constructor")` sets `def` to
the actual `Object` constructor function (truthy, so the existing
`if (!def) return ""` guard elsewhere doesn't catch it), `nextPlacement()`
reads `def.w` (undefined on a bare function), corrupting the palette's
placement-position tracking with `NaN` for the rest of the session, and
`renderComponentSvg()`/pin-iteration code call `def.render(comp)`/
`def.pins.find(...)` on something with neither method, throwing and
stopping the entire canvas from rendering. Worse, since the filter never
strips the poisoned entry back out, it re-crashes on every future load
until the browser's site data is manually cleared. The critic explicitly
confirmed this is NOT attribute-breakout XSS (the only strings that can
survive the broken filter are literal, quote-free `Object.prototype`
method names), but flagged it as the same underlying mistake --
validating a user/attacker-influenced string by truthy-testing it as an
object key instead of checking own-property-ness -- just landing on
availability (a crash/DoS) instead of confidentiality/integrity this
time, worth taking seriously precisely because this file already has a
history of the injection variant of this exact error class.

Fixed by replacing the truthy lookup with `typeof t === "string" &&
Object.prototype.hasOwnProperty.call(REG, t)`, which correctly rejects
every `Object.prototype` method name while still accepting every real
component-registry key. A minor cosmetic nit was fixed alongside it: the
static HTML markup had its own hardcoded `<h3>Recently used</h3>`, but
`renderRecentPalette()` unconditionally rebuilds the container's
`innerHTML` with its own copy of the same string on every call (including
the very first one, fired immediately on builder open) -- the static
version was dead markup, destroyed before anyone could see it, just two
copies of the same string that could silently drift apart later. Removed
the static copy, leaving the JS as the single source of truth.

Re-verified via Playwright, reproducing the critic's exact repro: set
localStorage to `["constructor", "toString", "resistor", 123, {"foo":
"bar"}, null]` directly, opened the builder, and confirmed only the one
genuine entry (`"resistor"`) rendered -- every prototype-method name,
non-string, and null value was correctly filtered out; confirmed zero
page errors were thrown at any point (the crash the bug would have
caused); confirmed clicking the one legitimate recent-part button still
correctly added a component; confirmed exactly one "Recently used"
heading renders, not zero or two. The original round-1 tests (hidden
when empty, correct order, adds a component, persists across sessions)
were re-run unchanged and still pass. Full regression suite green.

Sent back for a round-2 critic pass on commit 34edbb2. Scored 9/10 --
ship. The `hasOwnProperty` fix was independently re-verified against a
battery of adversarial payloads, including the one case most fixes of
this shape actually miss: `"__proto__"` specifically (distinct from an
ordinary inherited method name) -- confirmed via a live Node check that
`hasOwnProperty.call(REG, "__proto__")` correctly returns `false`, since
`REG` is a plain object literal where `__proto__` is only ever an
accessor on `Object.prototype`, never an own property, and `JSON.parse`
on an array containing that string creates a perfectly ordinary string
element with no special prototype semantics. Also confirmed case
sensitivity (`"Resistor"` vs. the real `"resistor"` key correctly
rejected), empty/very-long/unicode strings, and traced `recordRecentType()`'s
one write path back to its only two callers (trusted static HTML and the
already-filtered recent list) to confirm there's no way to write a bad
value in without the already-fixed read-path tampering. The `<h3>`
removal was confirmed non-breaking against the CSS's plain descendant
selector.

One more minor, explicitly non-blocking hardening note: `data-sim-type="${type}"`
in `renderRecentPalette()` was still interpolated unescaped, unlike the
adjacent `escapeXml(REG[type].label)` on the same line -- not exploitable
today, since `type` is guaranteed safe by the fixed own-property filter
against a fully static, developer-authored registry with plain-identifier
keys, but flagged as latent risk if component types ever became partly
dynamic in the future. Applied the one-line `escapeXml(type)` fix anyway
since it costs nothing and removes the risk before it could ever become
real, rather than leaving it as a footnote for a future feature to
rediscover the hard way.

Re-verified via Playwright: re-ran both round-1 test suites (normal
placement/order/persistence, and the poisoned-localStorage repro with
prototype names/non-strings/null) unchanged, all still pass with zero
page errors. Full regression suite green.

Item #402 is done: 2 critic rounds (6/10, 9/10), the one real finding (a
prototype-chain filter bypass that could permanently break the builder
canvas from tampered localStorage) fixed and independently re-verified
against the classic `__proto__` edge case specifically, plus one
proactive defense-in-depth hardening applied even though not required
for today's exploitability, and a minor markup-duplication cleanup
folded in alongside it.

### Twenty-sixth item: #410, datasheet links on simulation components

Added a "Datasheet link" URL field to every component's inspector panel
(common to all types, not gated by component type the way resistance/
voltage are), stored as `comp.datasheetUrl`, with an "Open datasheet ↗"
link appearing beneath the input whenever a URL is set -- opens in a new
tab via the target/rel combination (`_blank`/`noopener noreferrer`)
already used everywhere else this codebase opens an external link safely.
Scoped as admin-only reference metadata, explicitly not rendered on the
public embed: unlike a component's `label` (shown as a public hover
tooltip), a datasheet link is a build-reference aid for whoever's
assembling the circuit in the admin, not something an end viewer of a
published simulation page needs -- the field's own inspector caption
says so explicitly ("admin only, not shown on the public embed").

Given this session's own recent history of finding real attribute-
breakout XSS in this exact file via the JSON-import path, and given a
URL field is specifically the shape that needs more than plain
`escapeXml()` -- a `javascript:`/`data:`/`vbscript:` URI has nothing for
attribute-escaping to catch, since it's just as "valid" a string as a
real URL until the moment it's clicked -- added a client-side
`safeHref()` helper that mirrors the exact same reasoning, and literal
scheme blocklist, already used server-side for public-page links
(`worker/render.js`'s `safeHref()`): blocks `javascript:`/`data:`/
`vbscript:` specifically, passes everything else (relative paths,
`mailto:`, `tel:`, bare domains) through unchanged. The rendered link's
`href` goes through `escapeXml(safeHref(url))` -- the exact same
compose-both-helpers pattern the worker side already uses (`esc(safeHref(url))`)
-- rather than either one alone, since `safeHref` doesn't escape
attribute-breaking quote characters and `escapeXml` doesn't know a
`javascript:` scheme is dangerous.

Tested via Playwright: confirmed the datasheet input exists in every
component's inspector and no "Open datasheet" link appears before a URL
is typed; typed a normal `https://` URL and confirmed the link appears
with the exact href, opening via `target="_blank"` and
`rel="noopener noreferrer"`; typed `javascript:alert(document.cookie)`
and confirmed the rendered href was neutralized to `"#"` rather than the
payload, then clicked the neutralized link and confirmed no `alert()`
fired. Full regression suite green; no server-side test state was
created (the test simulation was never saved), so no cleanup was needed.

Sent to a critic pass on commit 398adef. Scored 6/10 -- explicitly asked
to adversarially probe the scheme-blocklist regex given this file's XSS
history, and found a real, browser-confirmed bypass in the exact
denylist-regex approach the new `safeHref()` helper was modeled on: a
tab or newline embedded INSIDE the scheme name (`java\tscript:alert(1)`)
doesn't match `/^(javascript|data|vbscript):/i` tested against a merely-
`.trim()`'d string, since `.trim()` only strips leading/trailing
whitespace, not embedded characters -- but a real browser's URL parser
strips every ASCII tab/newline anywhere in the string before ever
reading the scheme, so the href resolves to a genuine `javascript:` URL
despite passing the regex check. Same gap for a leading C0 control
character (`\x01javascript:alert(1)`), which `.trim()` also leaves alone
but the URL parser strips. The critic confirmed both live in Chromium:
setting either payload as a same-tab anchor's `href` and clicking it
executes the script; only the `target="_blank"` attribute already on the
rendered link happened to incidentally block navigation in current
Chrome specifically, which the critic correctly refused to treat as a
real defense ("a denylist regex on a string the browser will further
normalize is fundamentally the wrong approach... 'the sanitizer should
actually sanitize'"). Critically, this exact function was explicitly
described as mirroring `worker/render.js`'s own production `safeHref()`
-- which turned out to have the identical bypass, and several of ITS call
sites render links with no `target="_blank"` at all, so no incidental
same-tab protection exists there either.

A second, lower-severity but confirmed real bug: the datasheet link's
visible `<a>` element was only (re)created on the input's `blur` event
via a full `renderInspector()` call that replaces the entire inspector
panel's `innerHTML` -- including the anchor itself. Clicking the just-
typed "Open datasheet" link fires a `blur` on the input first, which
synchronously tears down and rebuilds the very element being clicked,
silently swallowing that first click (no navigation happens; a second
click, against the now-correctly-rebuilt anchor, works).

Fixed both, and extended the fix beyond just this feature's own file:
replaced the denylist-regex approach in both the new client-side
`safeHref()` (`simulation-builder.js`) AND the pre-existing server-side
`safeHref()` (`worker/render.js`, used across the whole public site's
link rendering -- project links, changelog entries, link-list blocks,
button blocks) with real URL parsing via the runtime's own WHATWG-
compliant `URL` object and a protocol allowlist (`http:`/`https:`/
`mailto:`/`tel:`) instead of denylisting patterns in raw input text.
This is correct by construction: whatever ends up in `.protocol` after
parsing IS what a browser will actually navigate as, so there's no gap
between what the check inspects and what happens on click -- unlike a
hand-rolled regex trying to anticipate every normalization a real parser
might apply. For the swallowed-click bug, gave the datasheet link a
stable id and update its `href`/`hidden` state directly on every `input`
keystroke instead of waiting for `blur` to trigger a full inspector
rebuild, so the element being clicked is never torn down out from under
an in-flight click.

Re-verified via Playwright and Node: reproduced the critic's exact two
bypass payloads (`java\tscript:alert(1)`, `\x01javascript:alert(1)`)
plus four more variants (embedded newline, vertical tab, a plain
`javascript:` control, and a legitimate `https://` URL) against the live
admin UI and confirmed every dangerous payload now neutralizes to `#`
while the legitimate URL passes through unchanged; unit-tested the
worker-side fix directly in Node against 14 cases (all three dangerous
schemes, all four previously-passing-through legitimate URL shapes --
https/http/mailto/tel/relative-with-slash/relative-without-slash -- plus
an empty string), all passing; confirmed end-to-end on an actual public
page with two button blocks (one a real external link, one the
tab-embedded bypass payload) that the real link rendered correctly and
the malicious one rendered as `#`. Confirmed the swallowed-first-click
fix by clicking the datasheet link immediately after typing (no blur in
between) and verifying a new tab actually opens on the first click. Full
regression suite green; no server-side test state was created in either
round (a scratch page created for the end-to-end worker test was
deleted, both soft- and hard-delete, and confirmed gone).

Sent back for a round-2 critic pass on commit 15c7c6a, given the fix
touched widely-used production code (`worker/render.js`'s `safeHref()`
backs project links, changelog entries, link-list items, buttons, and
cards across the whole public site). Scored 9/10 -- ship. The critic ran
the original bypass payloads plus new variants (embedded backspace,
embedded NUL, zero-width space) through the real WHATWG `URL` parser and
confirmed each one either correctly gets rejected or -- for characters
that break scheme-state parsing entirely -- correctly falls through to
being treated as a relative reference, which is provably safe rather
than coincidentally safe: the check runs the exact same parsing algorithm
a browser will run on the same string at click time, so there is no gap
between what's inspected and what actually navigates. A battery of
legitimate-URL edge cases (fragments, query strings, ports, IPv6 hosts,
IDN/unicode domains, a 100k-character URL, scheme-only forms) all parsed
without throwing and passed through unchanged -- no false rejections.
Confirmed protocol-relative URLs (`//evil.com/x`) still pass, matching
the OLD regex's behavior exactly (never a regression, since the old
check never blocked those either). Confirmed the function never returns
a normalized/resolved URL, only ever the original trimmed input or the
literal `"#"` -- verified against every call site's own independent
raw-string checks (e.g. a separate `/^https?:\/\//` test elsewhere for
deciding `target="_blank"`) to confirm none of them assume normalization
the new implementation doesn't provide. Grepped the whole repo and
confirmed the old denylist pattern survives only in this outline's own
historical narrative, not in any shipped code anymore.

One cosmetic, non-blocking note: the client and server now carry two
independent (matching, but separately maintained) copies of the same
tiny function, with only a one-line comment in the server copy pointing
to the client-side port and not the reverse -- a future edit to one
without the other could quietly drift. Logged as a minor
maintainability nit rather than fixed, since a shared module between a
browser-context IIFE and a Workers-runtime ES module is a larger
restructuring than this bug fix's scope justifies.

Item #410 is done: 2 critic rounds (6/10, 9/10), both real round-1
findings fixed and independently re-verified against a much broader
battery of edge cases than the original repro -- including closing an
identical, live, production-affecting bypass in the pre-existing
server-side `safeHref()` this feature's own client-side version was
explicitly modeled on, the same "the reachability/correctness question
this critic asked about the new code turned out to apply just as much to
the trusted original it copied" pattern this session already hit once
with `escapeXml()` in #394.

### Twenty-seventh item: #378, search for a placed component on the simulation canvas

Added a "Find on canvas" search input to the builder toolbar -- distinct
from the existing palette search (which filters the list of NEW parts to
add), this one highlights already-PLACED components matching what's
typed, useful once a circuit has enough parts that finding a specific one
by eye gets tedious. Matches against a component's own custom label
(if set), its type's display label (e.g. "Resistor"), or its raw type
key, case-insensitively -- so searching "status" finds an LED the admin
renamed to "Status LED" even though "LED" itself doesn't contain that
word, and searching "resistor" finds every resistor whether or not it
has a custom label at all.

Matches get a pulsing teal outline (`sim-search-match-box`), deliberately
a different color from the existing "currently selected" outline (accent
color) and "burnt/overheating" indicator (red) -- reuses the same teal
already established elsewhere in this file for net-highlighting, since
both are "these are related, not a problem" cues rather than "this is
what you clicked" or "this is broken." Respects
`prefers-reduced-motion`, matching the existing convention already used
for the disconnected-pin pulse elsewhere in this file. Resets to empty
every time the builder opens, matching the existing precedent for every
other per-session UI toggle/preference in this file (snap size, show-
disconnected, show-ghost-wires, continuity mode).

Tested via Playwright: placed a resistor and an LED, renamed the LED to
"Status LED"; confirmed no matches highlighted before typing anything;
searched "resistor" and confirmed only the resistor highlighted; searched
"status" and confirmed only the LED highlighted (via its custom label,
not its type); confirmed the match is case-insensitive ("STATUS" still
finds it); confirmed a nonsense query highlights nothing; confirmed
clearing the search removes all highlights; confirmed a highlighted
component can still be selected normally (search doesn't interfere with
existing interactions); confirmed the search box resets to empty when
reopening the builder for a new session. Full regression suite green; no
server-side state was created (the test simulation was never saved), so
no cleanup was needed.

Sent to a critic pass on commit 436e741. Scored 9/10 -- ship, first try.
Traced every reference to the search-query variable (only 3 in the whole
file: declaration, the input listener, and the one read inside the
match-checking function) and confirmed it's used exclusively as the
right-hand side of a boolean `.includes()` comparison, never concatenated
into any rendered string -- no XSS surface. Confirmed the per-render
match check is asymptotically identical cost to lookups already done for
every component every render (no meaningful performance concern, no
pathological-input slowdown, since `.includes()` cost is bounded by the
short haystack strings, not the needle). Confirmed a component that's
simultaneously selected AND search-matched renders two concentric
outline rings (the existing dashed selection box, then the new pulsing
teal search box drawn after it, both larger than the last) rather than
one obscuring the other, and that the "damaged" state doesn't add an
outline at all (it only recolors internal shapes), so there's no
three-way stacking conflict to worry about. Confirmed non-string
label/type values from JSON import can't reach the match-check function
at all, since it's only ever called after the same `def` registry-lookup
guard that already filters those out. Independently re-verified (not
just trusted from this outline's own write-up) that the `openBuilder()`
reset sits before the new/template/existing branch split, so all three
entry paths get it.

One minor, non-blocking accessibility gap was noted: the new search
input has no `<label>`, only a `placeholder`/`title` -- but this exactly
matches the existing, unlabeled `#sim-palette-search` field two lines
away in the same toolbar, so it's a pre-existing toolbar-wide convention
gap, not a regression this feature introduced. Logged as a candidate for
a future accessibility pass across every unlabeled search/filter input in
the builder toolbar, rather than fixed inconsistently for just this one
field.

Item #378 is done: 1 critic round, 9/10, no real findings -- one minor,
already-existing-convention accessibility gap logged as an accepted,
non-blocking observation.

### Twenty-eighth item: #396, wire thickness in the simulation builder

Added a "Thickness" dropdown (Thin/Normal/Thick) to the wire inspector,
alongside the existing Style (wire/HDMI-cable) and Label fields. Stored
as `wire.thickness` -- "normal" is represented by the field simply being
absent/undefined rather than the literal string "normal", so every
pre-existing wire from before this feature (which never set the field at
all) is correctly treated as normal-thickness with no migration needed,
and there's only one way to mean "default" instead of two equivalent
ones a future reader would have to remember are the same.

Implemented as an inline `style="stroke-width:...px"` override on both
the wire's main stroke and its shine highlight, computed from a fixed
multiplier (0.6x thin, 1.7x thick, keyed off the validated `thickness`
string -- never a raw number from JSON-import-controlled data, so there's
no numeric field here that could need a plausibility bound the way image
dimensions elsewhere in this codebase did) times each kind's existing
CSS base width (4px/1.2px for a plain wire, 5px/1.5px for the HDMI-style
cable). The inline style is only emitted at all when the multiplier isn't
1 -- the overwhelming common "Normal" case keeps relying on the plain CSS
class with no per-wire override cluttering the markup, exactly mirroring
the pattern the wire-label feature's own "only emit if non-empty"
approach already established. Mirrored in both render paths (the admin
builder's own `renderWireSvg()` and the public embed's `worker/
simulation-render.js` copy) with byte-identical multipliers and base
widths, so a wire's thickness set in the builder looks the same on the
public page.

Tested via Playwright: confirmed a freshly-drawn wire has no inline
stroke-width style at all (relying purely on the CSS default); selected
"Thick" and confirmed the exact expected inline width (4 * 1.7 = 6.8px);
selected "Thin" and confirmed 4 * 0.6 = 2.4px; selected "Normal" again
and confirmed the inline style was removed entirely, not just reset to a
value that happens to match the CSS default; saved a simulation with a
thick wire and loaded its public embed page in a fresh browser context,
confirming the same 6.8px inline width rendered there via the worker-side
render path. Full regression suite green; the test simulation was
deleted (both soft- and hard-delete) and confirmed gone from the
simulations list afterward.

Sent to a critic pass on commit 1ceb856. Scored 8/10 -- one real, shipped
bug, everything else confirmed clean. The critic checked all 8 kind
(wire/HDMI) × base-width (main/shine) × multiplier (thin/thick)
combinations and found one produces floating-point precision noise:
`1.5 * 0.6` (the HDMI-style cable's shine stroke at Thin) is
`0.8999999999999999` in IEEE 754, which would render as that exact ugly
literal in the SVG markup -- purely cosmetic (identical to the eye either
way), but the one combination the original testing notes hadn't happened
to check (only plain-wire Thick/Thin were verified at ship time). Every
other angle came back clean on direct verification: `wire.thickness` is
never interpolated into any template string, only ever used as an object-
lookup key (safe by construction, any non-matching value falls through to
the 1x default); the `<select>`'s three "selected" conditions are
mutually exclusive and exhaustive, so exactly one option is ever marked
selected for any input including garbage JSON-import values; the
dropdown's displayed "Normal" state and the wire's actual rendered 1x
multiplier can't diverge for a garbage value, since both key off the
identical two string comparisons; switching a wire's Style (kind)
dropdown correctly recomputes the stroke-width against the new kind's
base width, since nothing is cached -- `renderWireSvg()` recomputes
everything fresh on every call; a wire with no `thickness` property at
all behaves identically to one explicitly set to `undefined` (both hit
the same `|| 1` fallback); and the thickness change handler calls
`pushHistory()` first, exactly matching the adjacent kind-select handler's
existing convention.

Fixed by rounding all four computed stroke-width values (in both the
admin builder and the public embed's mirrored copy) to 2 decimal places
via a small `roundPx()` helper. Re-verified via Playwright: the original
round-1 tests (plain-wire Thick=6.8px, Thin=2.4px, Normal removes the
inline style, persists to the public embed) re-run unchanged and still
pass; specifically tested the exact combination the critic found broken
(HDMI-style + Thin) and confirmed the shine stroke now renders exactly
`0.9px`, not the float-noise literal, with the main stroke correctly at
`3px`. Full regression suite green.

Sent for a narrow, targeted follow-up check (not a full re-audit) focused
specifically on the `roundPx()` fix: confirmed it covers all 4 required
call sites in both the admin builder and public embed, resolves the
exact hdmi/thin/shine float-noise case (0.8999999999999999 -> 0.9)
without introducing new precision issues for any of the 8 wire-thickness
combinations, and is a purely cosmetic/formatting change with no
behavioral difference. Verdict: ship.

Item #396 is done: 1 critic round (8/10) plus a targeted follow-up
confirmation, the one real finding (floating-point precision noise in
one of eight thickness/kind/stroke combinations) fixed and independently
re-verified, with every other adversarial angle the critic checked
confirmed already correct on direct verification rather than just
re-reading the outline's own claims.

### Twenty-ninth item: #195, dedicated master bus for the Song/DAW builder

- ✅ **One shared `GainNode` per `AudioContext`** in `public/song-engine.js`
  (`getMasterGain(ctx)`, a `WeakMap<AudioContext, GainNode>` so the admin
  builder's persistent context, the public embed's lazily-created
  context, and any throwaway `OfflineAudioContext` used for waveform
  rendering each get their own node) that every synthesized voice
  (`playKick`/`playSnare`/`playHihat`/`playClap`/`playMelodyNote`) now
  routes through instead of connecting to `ctx.destination` directly.
  `songData.master_volume` (0-1, default `undefined`→1) is read fresh
  every scheduled step inside `scheduleStep()`, the same pattern already
  used for `tempo`/`kit`, so a live edit takes effect without any
  separate wiring. A new `#song-master-volume` range slider (0-100) was
  added to the admin builder's toolbar
  (`public/admin/index.html`), synced on song open/save exactly like the
  adjacent tempo/kit/waveform controls. The public Song embed
  (`public/song-embed.js`) needed **zero changes** — it creates its own
  `AudioContext` and calls the same shared `createPlayer`/`scheduleStep`
  path, so it picks up master-volume support for free from the one
  engine change.

Handed to a critic agent for scoring: **5/10**. Findings:

1. **(Fixed)** `renderWaveformPeaks()` rendered the offline waveform
   preview at the song's actual `master_volume`, so the waveform display
   in both the admin builder's live preview and the public embed visibly
   shrank as the volume slider was lowered and went completely flat at
   volume 0 — a real, reachable readability regression with no benefit,
   since the preview exists to show the pattern's *shape*, not the
   song's loudness. Fixed by having `renderWaveformPeaks` build a
   shallow-copied `previewData` with `master_volume` forced to 1
   whenever the real value isn't already 1, and scheduling the offline
   render against that copy instead of the real `songData` — leaving the
   actual persisted `master_volume` and the live-playback path
   completely untouched.
2. **(Fixed)** The master gain value was only ever applied inside
   `scheduleStep()`, which only runs once playback is actively
   scheduling steps. Two consequences: (a) MIDI-keyboard live-preview
   notes (played via `Engine.playMelodyNote` directly, bypassing
   `scheduleStep`) played at whatever gain the shared node happened to
   already hold, not the current slider position; (b) since the admin
   builder's `AudioContext` (and therefore its master `GainNode`) is
   created once and reused across every song opened in that session,
   opening song B right after playing song A left the gain at A's last
   value — audible as a stale-volume flash — until B's own playback got
   around to running `scheduleStep` for the first time. Fixed by adding
   a new public `SongEngine.setMasterVolume(ctx, value)` and calling it
   immediately from two places in `song-builder.js`: the volume slider's
   `input` handler, and `openSong()` right after loading a song's data
   (before creating its player) — on top of `scheduleStep()`'s existing
   per-step re-application, which stays as a redundant-but-harmless
   safety net.
3. **(Fixed)** Setting `gain.value = ...` directly during active
   playback risks an audible click/zipper artifact on the abrupt jump.
   Fixed by having `setMasterVolume()` use the standard
   `cancelScheduledValues` → `setValueAtTime(current, now)` →
   `linearRampToValueAtTime(target, now + 0.03)` ramp pattern instead of
   a bare assignment. Also switched the clamping check from
   `typeof value === "number"` to `Number.isFinite(value)`, closing a
   gap where a `NaN` (which passes `typeof x === "number"`) could have
   slipped through unclamped.
4. **(Fixed)** The new volume slider fires many rapid `input` events
   while being dragged, and `refreshWaveformPreview()`'s
   `OfflineAudioContext` render is async with no protection against
   out-of-order resolution — several renders could be in flight at once,
   with whichever happened to resolve last (not necessarily the one
   matching the final slider position) winning and leaving a stale
   preview. Fixed with the same generation-token guard already used
   elsewhere in `song-builder.js` for the open-song race
   (`waveformPreviewGeneration`, incremented per call, checked after the
   `await` before committing the result). Confirmed by the round-2
   critic to still be genuinely necessary and reachable even after fix
   #2 removed the volume-slider's own call to
   `refreshWaveformPreview()` — the tempo/kit/waveform controls still
   call it and remain exposed to the same race.
5. **(Logged, not fixed — matches a pre-existing pattern, not a
   regression)** Neither the `/songs` POST nor `/songs/:id` PATCH
   endpoint in `worker/admin-api.js` validates any field inside the
   song's `data` JSON blob, `master_volume` included — identical to the
   existing, already-unvalidated `tempo`/`kit`/etc. fields. Not a
   security issue (a corrupted/out-of-range value is just an audio gain
   consumed by Web Audio, and `setMasterVolume()`'s own
   `Number.isFinite` + clamp handles it defensively on every use
   regardless of what's stored), so left as-is rather than expanding
   scope to add validation this codebase has never had for this data
   shape.
6. **(Confirmed already correct, not a bug)** The song-duplicate
   endpoint (`worker/db.js`'s `duplicateSong`) copies the whole `data`
   blob verbatim, so `master_volume` correctly carries over to a
   duplicated song. Autosave is already debounced (a 2-second timer,
   cleared on each call), so dragging the volume slider does not spam
   the autosave endpoint.

Sent for a round-2 critic pass specifically re-verifying each of the four
fixes above against the real source (not just re-reading the fix
descriptions), plus a broader look for anything new. Confirmed genuinely
correct and complete: the waveform-preview shallow copy doesn't leak
back into the real `songData` (nothing in `scheduleStep` ever *writes*
to `songData.tracks`/`songData.melody`, only reads, so sharing those
nested references between the copy and the original is safe); both
stale-gain sub-cases are closed (grepped every direct `Engine.play*`/
`scheduleStep` call site in `song-builder.js` — only the MIDI-preview
handler and the scheduler itself exist, and both are now covered);
`Number.isFinite(0)` correctly still accepts an explicit 0-volume rather
than treating it as falsy; and the generation-token race guard is
confirmed still live and necessary via the tempo/kit/waveform controls,
not dead code. Two new minor, non-blocking observations: `setMasterVolume`
applies at `ctx.currentTime` ("now") rather than exactly on the next
beat boundary, so a mid-playback slider drag jumps volume immediately
rather than snapping to the beat — cosmetic only; and the public embed
was independently confirmed (not just asserted) to inherit both the
master-volume feature and the waveform-decoupling fix for free, since it
passes its parsed `songData` into the exact same shared engine calls
with no embed-specific code path. Final score: **9/10** — ships.

Item #195 is done: 2 critic rounds, 5/10 → 9/10, four real findings (a
waveform-preview loudness/shape regression, two stale-gain sub-cases, a
click-artifact risk, and an async preview-race) all fixed and
independently re-verified against the live source rather than the fix
descriptions, plus one pre-existing non-regression gap (no server-side
validation of song `data` fields) explicitly logged as intentionally
left alone.

### Thirtieth item: #463, potentiometer component for the simulation builder

- ✅ **A new `potentiometer` component type**, added identically to both
  `public/admin/sim-components.js` and its hand-duplicated mirror
  `worker/simulation-render.js` (the Worker can't import the admin's
  client-side JS module, so every component type and analysis rule is
  implemented twice, byte-for-byte — a real, previously-hit source of
  drift bugs in this codebase). Modeled as a two-terminal "rheostat"
  (`w: 80, h: 32`, pins `p1`/`p2`, `passthrough: [["p1","p2"]]`) rather
  than a real 3-terminal voltage divider — a proper wiper-tap needs a
  multi-branch solver this builder doesn't have, an intentional scope
  limit rather than an oversight. Two new data fields: `maxResistance`
  (ohms, default 10000) and `wiper` (0-100%, default 50). Effective
  resistance is `Math.max(1, Math.round(maxR * (wiperPct/100)))`,
  registered in the electrical-analysis graph with `kind: "resistor"` —
  deliberately reusing the existing resistor current/wattage/overheating
  logic rather than duplicating it under a new kind, since a pot wired
  this way is electrically identical to a fixed resistor at whatever
  value the wiper currently sets. New inspector-panel fields (a "Max
  resistance" number input and a live wiper-position slider that redraws
  the part and its computed-ohms label continuously while dragging, one
  history entry per drag rather than per `input` event), added to the
  breadboard-snap set (its 80px lead spacing matches a resistor's) and
  the palette.

Handed to a critic agent for scoring: **4/10**. Finding:

1. **(Fixed, ship-blocking)** `wiperPct = Math.max(0, Math.min(100,
   Number(c.wiper) ?? 50))` was dead-fallback code: `Number(x)` never
   returns `null`/`undefined` — only a number or `NaN` — and `NaN` is
   not nullish, so `NaN ?? 50` stays `NaN` instead of falling back. This
   existed identically in all four places the computation was
   duplicated: `render()` and `buildAnalysisGraph()` in both
   `sim-components.js` and `worker/simulation-render.js`. Concrete
   failure: a missing or non-numeric `wiper` (reachable via a
   hand-edited or imported simulation) rendered a literal "NaNΩ" label
   on both the admin canvas and the public embed, and fed `NaN`
   resistance into the electrical analysis — where any comparison
   against `NaN` evaluates `false`, so the overheating check silently
   reported "normal" / "well within its rating" no matter how dangerous
   the real circuit actually was, a false-safety claim with visibly
   broken numbers shown to a site visitor. Notably, the inspector
   panel's own separate display code already used the correct
   `Number.isFinite(...) ? ... : 50` pattern for the identical
   computation, so before the fix the inspector could show "50%" while
   the canvas simultaneously showed "NaNΩ" for the same underlying data
   — an internal inconsistency within the admin builder itself. Fixed by
   switching all four call sites to `Number.isFinite(rawWiper) ?
   rawWiper : 50`, matching the pattern the inspector already had right.
   Also fixed a minor wording nit found alongside it: the overheating
   message called a potentiometer "a typical 1/4W resistor", which
   doesn't fit since a pot's rating is admin-configurable per instance,
   not a fixed real-world spec — now branches on `comp.type` to say
   "this potentiometer can safely handle" instead.

Sent for a round-2 critic pass specifically hunting for the realistic
"3-of-4 mirrored sites fixed, one missed" failure mode, and re-tracing
the edge cases (`undefined`, `null`, `""`, `"abc"`, explicit `NaN`,
`-20`, `150`, explicit `0`) by hand against real JS semantics rather
than trusting the fix's own description. Confirmed genuinely and
completely fixed: grepped the whole repo for the old `?? 50` pattern —
it survives only in explanatory comments, not executable code — and all
four sites now compute identically; independently verified the
edge-case trace matches real `Number()`/`Number.isFinite()` behavior for
every value, including confirming explicit `0` is correctly preserved
(the exact case a naive `|| 50` fallback would have broken instead).
One pre-existing, non-regression quirk was noted and explicitly not
blocked on: `null` and `""` both coerce to `Number(...) === 0`, which
*is* finite, so they silently resolve to a literal 0% rather than the
"unset → 50%" a human might expect — this predates the fix (the
original broken code had the exact same behavior for these two inputs)
and matches the same coercion convention already used everywhere else
in this codebase for numeric fields, so it wasn't introduced by, and
isn't in scope for, this fix. Also confirmed the wording fix lives in
exactly one place (the admin inspector) with no second copy that could
have been missed, since the worker's public-embed renderer only toggles
a CSS class for the damaged/overheating state rather than rendering any
message text itself. Final score: **9/10** — ships.

Item #463 is done: 2 critic rounds, 4/10 → 9/10, one ship-blocking
finding (a dead nullish-coalescing fallback letting `NaN` silently reach
both the rendered label and the electrical-safety analysis, identically
broken across all four places this codebase's mirrored-registry
architecture required the same logic to be written twice) fixed and
independently re-verified against real JS semantics for every edge
case, plus one minor wording nit fixed alongside it and one pre-existing
non-regression quirk explicitly logged as out of scope.

### Thirty-first item: #218, normalize to peak for the Song/DAW builder

- ✅ **A new "Normalize to peak" button** in the Song builder toolbar,
  reusing the #195 master-bus feature's `renderWaveformPeaks()` (which
  always renders one full loop at forced full volume via an
  `OfflineAudioContext`, regardless of the song's saved
  `master_volume`, since it exists to show the waveform preview's
  *shape*). Rather than just visualizing that data, this feature reads
  it to find the song's real synthesized peak amplitude — several drum
  hits and melody notes landing on the same 16th-note step can sum well
  past a single voice's own level — and auto-sets `master_volume` so the
  loudest moment lands just under full scale (a 0.98 target, not exactly
  1.0, for a small safety margin) instead of clipping. Guards a silent
  song (peak ~0) from a divide-by-zero blowup with a small epsilon
  floor, and caps the result at 100% since this builder's master gain
  only ever attenuates, never boosts above unity. The button disables
  itself with a "Scanning…" label during the async render.

Handed to a critic agent for scoring: **3/10**. Findings:

1. **(Fixed, critical)** The async handler had no staleness guard at
   all. Clicking Normalize, then switching to a different song before
   the offline render resolved, silently wrote the FIRST song's computed
   volume onto the SECOND song's `songData` object (since `songData`/
   `currentSongId` are reassigned in place when switching songs) and
   then triggered the second song's autosave with the wrong value —
   real, reachable cross-song data corruption. Fixed by capturing the
   same `openGeneration` counter `openBuilder()` itself already
   increments on every song switch (and already uses to guard its own
   async `GET` request against this identical class of bug) before
   starting the render, and bailing out with no state mutation if it's
   changed by the time the render resolves.
2. **(Fixed)** The scan had no protection against a concurrent manual
   slider drag — if the admin dragged the volume slider while a scan was
   in flight, the scan's eventual (stale) result unconditionally
   overwrote the manual adjustment with no warning, since the existing
   `normalizingPeak` flag only guarded re-entering the same button's own
   handler, not a different writer touching the same field. Fixed with a
   new `volumeInputGeneration` counter, bumped as the literal first line
   of the slider's own `input` handler, checked in the same combined
   guard as finding #1 — any manual slider touch during a scan makes the
   scan back off silently on completion rather than clobbering it.
3. **(Fixed)** Full float precision was stored into `songData.master_volume`
   while only the slider's *displayed* percentage was rounded, so the
   file's separate explicit Save handler (which recomputes
   `master_volume` from the current rounded slider value) and autosave
   (persisting the unrounded value) could silently disagree about what
   the same on-screen percentage numerically meant — and rounding to
   *nearest* rather than *down* could push the persisted volume above
   the level the scan actually proved safe against clipping, quietly
   undoing part of the safety margin the feature exists to provide.
   Fixed by flooring once to a whole percent and using that single value
   for the slider, the live gain, and the persisted field alike.
4. **(Fixed, minor)** A `try/finally` with no `catch` meant a
   `renderWaveformPeaks`/`OfflineAudioContext` failure became a silent
   unhandled promise rejection. Added a `catch` with an `alert`, matching
   this file's established pattern for other async failures.
5. **(Fixed, minor/UX)** Normalizing a brand-new unsaved song updates
   `songData` in memory but persists nothing (matching this file's
   existing "autosave only for a saved draft" convention — not a bug on
   its own), so the completion alert now notes "(Save the song to keep
   this.)" in that case.

Sent for a round-2 critic pass specifically tracing the combined
generation-guard against both race scenarios independently, re-deriving
the flooring math by hand for several peak values, and checking for any
new race introduced by combining two counters. Confirmed all three fixes
genuinely correct: `openBuilder()` bumps `openGeneration` synchronously
before either place `songData` is ever reassigned, so there's no gap
where the object could change without the counter changing; the volume
counter increments before the slider handler even touches
`songData.master_volume` itself; the bail-out on either mismatch happens
strictly before any state mutation, with no partial write and no alert;
and since both counters are monotonically-incrementing and never reset,
no interleaving (switch → drag → switch back) can coincidentally "cancel
out" and slip past the OR-guard. Independently verified the flooring
math numerically for several peak values, confirming it only ever rounds
toward more conservative (quieter), never past the proven-safe level.
Confirmed the `catch`'s early return still runs the `finally` correctly
(no way to leave the button stuck disabled), and that the original
happy-path behavior (silent song → 100%, dense song → correct low
percentage, button state during a normal unraced scan) is unaffected.
Final score: **9/10** — ships.

Item #218 is done: 2 critic rounds, 3/10 → 9/10, three real bugs (a
cross-song data-corruption race, a concurrent-edit clobber, and a
rounding mismatch that could silently erode the feature's own safety
margin) all fixed with a reused/extended generation-guard pattern and
independently re-verified by hand-tracing both the race scenarios and
the rounding math, plus two minor fixes (error handling, an unsaved-song
UX note) alongside them.

### Thirty-second item: #169, Photo Editor transparency-preview background toggle

- ✅ **A new "Preview against" select** (Checkerboard/White/Black/Gray)
  next to the canvas in `public/admin/index.html`, swapping a CSS class
  on the canvas wrapper (`#pe-canvas-wrap`) so a transparent PNG's actual
  transparent areas can be checked against different real-world
  backgrounds instead of only the existing fixed checkerboard "this is
  transparent" indicator. Purely cosmetic: never touches canvas pixel
  data, pushes no undo entry, and isn't persisted anywhere. Resets to
  checkerboard every time an image is opened, matching this builder's
  existing per-session UI-preference-reset convention (crop ratio,
  adjustment sliders, etc.).

Handed to a critic agent for scoring: **7/10**. Findings:

1. **(Fixed)** The CSS class to remove was hardcoded as a literal array
   in two separate places in `photo-editor.js` — the `change` listener
   and `open()`'s reset — with nothing tying either list to the
   `<select>`'s actual `<option>` elements or the CSS classes. A future
   5th option added to the HTML/CSS without updating both hardcoded JS
   lists would leave two `pe-bg-*` classes on the wrapper at once, a
   regression the existing test (which only exercised the 4 current
   options) wouldn't have caught. Fixed with a single `applyBgPreview(value)`
   helper that derives the classes to remove from the select's own live
   DOM options (`Array.from(bgPreviewSelect.options).forEach(...)`)
   rather than a hand-maintained list, used identically by both call
   sites — making the drift impossible by construction instead of
   relying on remembering to update two places 90 lines apart.
2. **(Fixed)** `.pe-actions` (the toolbar row the new select was added
   to, already holding a status bar, hint text, export format, quality
   slider, size estimate, and 2 buttons) had no `flex-wrap`, unlike its
   sibling `.pe-toolbar` row which already gets an explicit narrow-
   viewport treatment — adding one more fixed-width control made an
   already-crowded row more likely to squeeze or overflow on a narrower
   admin window. Fixed with `flex-wrap: wrap` so the row degrades to
   multiple lines instead.
3. **(Fixed, minor)** The `change` listener re-queried the select for
   its own value via `getElementById` instead of using the event target
   it was already bound to — changed to `e.target.value`.

Sent for a round-2 critic pass specifically confirming `applyBgPreview`
is genuinely used in both call sites (not fixed in one and left
hardcoded in the other), checking for an edge case where the wrapper
could end up with zero `pe-bg-*` classes instead of a duplicate, and
sanity-checking the `flex-wrap` layout change against the row's existing
`flex: 1` hint element and other children. Confirmed all three fixes
correct and complete: grepped the whole file for `pe-bg-` and found no
hardcoded literal arrays remaining anywhere; independently verified the
drift fix by adding a genuinely new 5th `<option>` purely via the DOM
(zero JS changes, exactly the scenario the fix targets) and confirming
switching to it leaves exactly one class, not two; confirmed the
`<select>`'s options are static HTML present from page load, so there's
no race where `applyBgPreview` could run before the options exist; noted
that a hypothetical future option added to HTML without a matching CSS
rule would still correctly end up with exactly one (just visually
inert) class rather than zero or duplicate classes, so the originally-
reported bug class is fully closed, with only a separate, minor,
never-actually-possible-with-today's-4-options edge case left
undefended; and confirmed the `flex-wrap` change causes no layout
regression, since the row's `flex: 1` hint element behaves normally once
wrapped and no sibling relies on constant row height. Final score:
**9/10** — ships.

Item #169 is done: 2 critic rounds, 7/10 → 9/10, two real findings (a
class-list drift risk from duplicated hardcoded state, and a toolbar row
made measurably more crowded with no wrap handling) fixed by deriving
state from the DOM instead of hand-maintaining it twice and adding
`flex-wrap`, both independently re-verified — the drift fix specifically
confirmed against a live, never-before-seen 5th option rather than just
re-reading the fix's own description.

### Thirty-third item: #301, live peak meter for the Song/DAW builder

- ✅ **A new metering `AnalyserNode`** tapped directly off the #195
  master-bus `GainNode` (`public/song-engine.js`'s
  `getPeakMeterAnalyser(ctx)`, one per `AudioContext`, never connected
  onward to `ctx.destination` itself so it can't add a second copy of
  the audio to the output), driving a visual peak-level bar next to the
  master-volume slider in the admin Song builder toolbar. Reads the
  exact same post-fader signal every voice already feeds into, not a
  decorative animation driven by note/track data. Started on Play and
  stopped/reset on Stop or on closing the builder (both already routed
  through the single `stopPlayback()` choke point), driven by
  `requestAnimationFrame` rather than a fixed interval.

Handed to a critic agent for scoring: **7/10**. Findings:

1. **(Fixed)** `analyser.fftSize` was `256`, giving each animation-frame
   poll only a ~5.8ms window of audio while `requestAnimationFrame`
   polls roughly every ~16.7ms (60fps) — leaving roughly two-thirds of
   playback time never sampled at all and able to scroll out of the
   analyser's internal buffer completely unread. A brief, fast-decaying
   drum transient (hihat decay as low as 0.04s) landing entirely inside
   an unpolled gap could be silently missed, meaning a feature called a
   "peak meter" could under-report — or even show 0% during — the
   loudest moment of a song, the opposite of what a peak meter is
   supposed to guarantee. Fixed by bumping `fftSize` to `2048` (~46ms at
   a typical 44.1kHz context, ~43ms even at 48kHz) — comfortably wider
   than the gap between polls at any realistic sample rate, so
   consecutive polled windows overlap and nothing can fall entirely
   between two polls.
2. **(Fixed)** `stopPeakMeter()` hard-reset the meter to 0% the instant
   Stop was clicked, but `player.stop()` only clears the step-scheduling
   timer — it doesn't stop already-triggered oscillators/buffer sources,
   which keep decaying on their own envelope for up to ~0.6-0.7s (the
   "808" kit's kick decay plus its own stop buffer, plus up to 0.1s for
   an already-scheduled note to still start). The meter was visibly
   pinned at 0% while that tail was still actually playing. Fixed with a
   bounded ~800ms drain: `stopPeakMeter()` now schedules the reset via
   `setTimeout` instead of applying it immediately, leaving the same
   `requestAnimationFrame` loop running (never canceled) so the meter
   keeps tracking the real, decaying signal during the drain window;
   `startPeakMeter()` cancels any pending drain and, if the loop is
   already running, returns early rather than restarting it — so a rapid
   Stop-then-Play during the drain window resumes seamlessly instead of
   double-running or restarting the loop.

Sent for a round-2 critic pass specifically re-deriving the `fftSize`
math against real sample rates, walking multi-cycle Play/Stop/Play/Stop
sequences (not just the two round-1-tested scenarios), checking
background-tab `requestAnimationFrame` throttling against the
`setTimeout`-based drain, and re-verifying none of round 1's
already-confirmed-correct aspects (no double `connect()`, no rAF race,
correct buffer sizing, no stale DOM caching) were reopened by the fix.
Confirmed both fixes genuinely correct: the 2048-sample window
comfortably exceeds the frame gap at both 44.1kHz and 48kHz; every
requested Play/Stop sequence (including repeated rapid cycling) leaves
`peakMeterRaf`/`peakMeterDrainTimer` in a sane, non-leaking, non-
duplicating state, since JS's single-threaded event loop means the tick
loop and the drain timer's callback can never truly race; a pending
drain timer firing against a closed/hidden modal is harmless since the
toolbar markup is static and never removed; and the shared `AudioContext`
being a true page-lifetime singleton closes off the one theoretical edge
case (a continuing loop bound to a stale analyser from a different
context) the drain-and-resume design could otherwise have opened. Two
pre-existing, unrelated observations were noted but explicitly not
blocking: a backgrounded tab mid-playback (not mid-drain) simply freezes
the meter at a stale value until refocused, matching ordinary
`requestAnimationFrame` browser behavior; and the Play/Stop button label
flips back to "▶ Play" immediately on Stop while the meter visually
keeps decaying for up to 800ms afterward, an intentional and reasonable
UX tradeoff rather than a defect. Final score: **9/10** — ships.

Item #301 is done: 2 critic rounds, 7/10 → 9/10, two real accuracy
findings (an analyser window narrow enough to risk silently missing the
actual peak it was measuring, and a meter that visually disagreed with
audio still genuinely playing) fixed and independently re-verified
across multi-cycle play/stop sequences and a background-tab edge case
the first round hadn't explicitly walked through.

### Thirty-fourth item: #302, live RMS meter for the Song/DAW builder

- ✅ **A second meter bar (RMS / average loudness)** added right next to
  the #301 peak meter, computed from the exact same buffer that meter's
  existing `tick()` loop already reads once per animation frame from the
  shared metering `AnalyserNode` — no new `AnalyserNode`, no separate
  polling loop, just one extra `sumSquares += v * v` accumulation added
  to the same single pass that was already computing the peak. Shares
  the peak meter's entire lifecycle exactly (same start/stop calls, same
  ~800ms post-Stop drain window before resetting to 0%, so it keeps
  tracking a genuinely decaying signal rather than snapping to 0 early).
  Distinct blue fill color; deliberately doesn't get the peak meter's red
  "clip" treatment, since RMS conventionally isn't a clip indicator the
  way instantaneous peak is.

Handed to a critic agent for scoring: **9/10**. Findings:

1. **(Fixed)** This exact item's own outline.md checklist line hadn't
   been marked done yet and had no dated write-up section — the one gap
   keeping this from a 10, caught by the critic checking this session's
   own "log every finding" convention against itself. This entry is that
   fix.
2. **(Confirmed already correct, not a bug)** The RMS formula
   (`Math.sqrt(sumSquares / buffer.length)` over the full 2048-sample
   window) is textbook root-mean-square with no off-by-one or scale
   error; RMS ≤ peak was independently confirmed to be a real,
   unconditional mathematical property for any finite sample set (mean
   of a set of nonnegative values is always ≤ its max), not something
   that merely happened to hold in one test run. Also confirmed: the
   shared-loop refactor genuinely computes both readings in one pass
   over one buffer read (not two separate loops or a second `AnalyserNode`);
   `rmsFill` is looked up fresh every `startPeakMeter()` call exactly
   like `peakFill`, with no staleness risk; the "clip" CSS class is never
   applied to the RMS element; the added per-frame work (one multiply-add
   per sample, 2048 samples) is trivial and not a realistic risk of
   missing `requestAnimationFrame`'s ~16.7ms budget; and the linear
   (non-dB) scale is a reasonable simplification consistent with how the
   already-shipped peak meter itself already scales, not a new
   inconsistency this feature introduced.
3. **(Noted, not blocking)** For this specific instrument's sparse,
   percussive drum-pattern content, a ~46ms RMS window will spend most of
   its time straddling near-silence between hits even during a
   maximally dense pattern, so the RMS bar will typically read much
   lower and flicker much less than the peak bar — mathematically
   expected given finding #2, and arguably even useful information (the
   gap between the two readings itself says something about a song's
   dynamics), not a defect to fix.

Item #302 is done: 1 critic round, 9/10 immediately, zero real
correctness findings in the actual math/lifecycle/rendering (independently
re-verified rather than taken on faith) — the single point held back was
this project's own "every shipped item gets logged" convention not yet
having been applied to itself, closed by this entry.

### Thirty-fifth item: #427, power dissipation for the microcontroller in the simulation builder

- ✅ **Extended wattage reporting to the "teensy" microcontroller
  component**, which already had current/voltage in its electrical-
  analysis result but no derived power figure, unlike the resistor
  (and, via the same `kind: "resistor"` reuse, the potentiometer) which
  already computed and displayed dissipation. Added identically to both
  `public/admin/sim-components.js` and its hand-duplicated mirror
  `worker/simulation-render.js`.

Handed to a critic agent for scoring: **4/10**. Findings:

1. **(Fixed, high severity)** The original formula computed
   `watts = amps * domain.voltage` — the FULL source voltage across the
   whole loop, not the teensy's own voltage drop — rather than the
   resistor branch's correct `P = I² × R` pattern (which is
   automatically just that component's own drop, independent of
   anything else on the path). This only happened to be correct when
   the teensy was the sole resistive element in the loop; with anything
   else sharing the series path (a current-limiting resistor, a
   potentiometer, an LED ahead of it), some of that source voltage drops
   across the OTHER component, not the teensy. Concrete repro: 9V
   battery → 100Ω resistor → teensy → back — true teensy dissipation via
   P=I²R ≈ 0.152W, the buggy formula reported 0.2025W (the entire loop's
   power, mislabeled as the teensy's own figure), off by ~33% via a
   completely ordinary circuit. Fixed to `amps * amps * TEENSY_LOAD_OHMS`
   in both files, matching the resistor branch exactly.
2. **(Fixed, design gap)** The computed wattage was never used for
   anything — `status` was purely `domain.dangerous ? "burnt" : "normal"`,
   unaffected by how much power was actually being dissipated. A teensy
   fed by something like a 24V supply (1.92W through its fixed 300-ohm
   model, wildly unsafe for a real 3.3V/5V board) still showed a calm
   "normal" status with non-danger styling, just printing the number as
   if unremarkable — an incomplete port of the exact safety-gating
   pattern this feature was explicitly mirroring from the resistor
   branch. Fixed by adding `TEENSY_WATTAGE_RATING = 1` (a typical
   microcontroller board's own power budget) and the same
   `watts > rating ? "overheating" : "normal"` gate, plus a matching
   danger-styled inspector message.

Sent for a round-2 critic pass specifically re-verifying byte-for-byte
parity between the two mirrored files (this codebase's single biggest
recurring drift risk), independently re-deriving the math for all three
test cases by hand, and specifically checking whether the new 1W
threshold could misfire as a false positive against any voltage option
the builder's own UI actually offers. Confirmed both fixes genuinely
identical in both files (formula, constant, gate, and even the
explanatory comments duplicated consistently); independently re-derived
all three cases (9V alone → 0.27W/normal, the series-resistor repro →
0.1519W not the old buggy 0.2025W, 24V alone → 1.92W/overheating) by
hand and confirmed they match; solved for the exact voltage where the
threshold trips (≈17.3V) and checked it against every voltage source
this builder's UI actually exposes (battery defaults to 9V with a free
numeric field, power supply is a fixed 3.3/5/9/12V dropdown) — the
highest built-in option (12V) only reaches 0.48W, so no ordinary,
non-dangerous configuration can false-positive; and confirmed
`computeSimPoweredSet` (a separate, simpler topology-only function) is
genuinely independent of this wattage/status logic, with no interaction
risk. One pre-existing, out-of-scope cosmetic finding was noted: the
teensy's non-overheating status message still displays `info.voltage`
(the full loop/source voltage) rather than the teensy's own voltage drop
(current × 300Ω) in its "Drawing ~Xma at YV" text — the underlying watts
figure itself is correct, only the voltage shown alongside it can read
as the wrong number in a series circuit; left as a follow-up rather than
expanding this fix's scope, since it predates this feature and affects
display text only, not the analysis math. Final score: **9/10** — ships.

Item #427 is done: 2 critic rounds, 4/10 → 9/10, one high-severity
formula bug (mislabeling an entire series loop's power as one
component's own figure, reachable via a completely ordinary circuit)
and one design gap (a computed safety-relevant number that was never
actually used to flag danger) both fixed and independently re-verified
byte-for-byte across this codebase's two hand-duplicated analysis
engines, plus one pre-existing display-only inaccuracy logged as an
explicitly out-of-scope follow-up.

### Thirty-sixth item: #350, reusable player color themes for the Song/DAW builder

- ✅ **A new "Player color theme" select** (Default/Sunset/Ocean/Mono/
  Neon) letting an admin pick a per-song accent color for the public
  embed without touching the site's own global theme. Implemented as a
  scoped CSS variable override — `.song-embed.song-theme-*` re-declares
  `--accent`, so every existing embed rule already reading
  `var(--accent)` (play-button hover, active step bar, pulse core) picks
  it up automatically via ordinary CSS cascading, with zero changes
  needed to those rules; "Default" means no `song-theme-*` class at all,
  falling through to the site's global accent unchanged. Surfaced a real
  pre-existing bug along the way: the waveform-visualization canvas (both
  the public embed and the admin builder's own live preview, the latter
  of which had its color hardcoded to a literal string rather than
  reading any CSS variable at all) read `--accent` off the page's
  document root instead of the specific `.song-embed` element, so a
  per-instance theme override would have been silently invisible to the
  canvas-drawn waveform while the CSS-only bars/pulse correctly followed
  it — both now resolve `--accent` from the embed element itself.
  `worker/render.js` whitelists the theme value against the same 4 known
  names before building the class name, since `song.data` rides through
  arbitrary stored/imported JSON.

Handed to a critic agent for scoring: **5/10**. Findings:

1. **(Fixed, high severity — accessibility regression)** The four theme
   colors had no light-mode variant at all, unlike the site's own base
   `--accent` (deliberately darkened under `:root[data-theme="light"]`,
   verified 4.94:1 against `--bg`). Applied unconditionally, "Mono"
   (#d8d8d8) or "Sunset" (#ff7a45) against the light theme's
   `--bg-elevated` (#f7ede0, a warm near-white) measured roughly 1.2:1
   contrast — the active bar, hover border, pulse core, and waveform all
   became nearly invisible. Fixed by adding a
   `:root[data-theme="light"] .song-embed.song-theme-*` override for
   each theme, following the site's own darkened-same-hue pattern, each
   independently computed and verified against the real `--bg-elevated`
   hex value: sunset `#a83a0c` (5.55:1 — reusing the site's own
   light-mode accent as-is only measured 4.42:1 against this specific,
   slightly darker background, just under the 4.5:1 threshold, so a
   further-darkened value was used), ocean `#1a5c8a` (6.18:1), mono
   `#4a4a4a` (7.68:1), neon `#176b3f` (5.66:1).
2. **(Fixed, medium severity — incomplete theming)** The pulse-
   visualization beat-hit ring flash was a hardcoded
   `rgba(232, 161, 58, ...)` — a stale amber left over from before this
   site's own `--accent` was changed to `#ff7a45` — not `var(--accent)`
   at all, so it never matched even the GLOBAL accent, let alone a
   theme: one of the visual elements this feature's own description
   promised was themed but wasn't actually wired up. Fixed using
   `color-mix(in srgb, var(--accent) N%, transparent)` for both keyframe
   stops, so the ring now derives from whatever `--accent` is currently
   in scope (global or themed) instead of a fixed color.
3. **(Logged, explicitly not fixed — a documented, deliberate scope
   decision)** The page-wide "Sync page background" overlay is appended
   to `document.body`, a sibling of any `.song-embed`, not a descendant
   — so its own `var(--accent)` always resolves the global accent, never
   a themed song's override, since CSS custom properties only inherit
   down the DOM tree. A themed song's beat-flash won't match its own
   theme. Left as-is with a comment added at the overlay's declaration
   explicitly documenting this as a known, accepted limitation of the
   single-shared-overlay design (the realistic fixes — duplicating the
   overlay per song, or threading a dynamic color into each flash call —
   both undercut the point of sharing one overlay across every song on
   the page) rather than an unnoticed gap.

Sent for a round-2 critic pass specifically re-deriving the WCAG contrast
math from raw hex values independently (not trusting the reported
numbers), checking CSS selector specificity to confirm the light-mode
override rules genuinely win regardless of source order, verifying
`color-mix()`'s 0%-accent endpoint is genuinely fully transparent with
no flash-of-wrong-color quirk, and confirming nothing round-1 already
validated (theme whitelist parity between the admin builder and worker,
XSS escaping, no stale-reference race in `openBuilder()`) was disturbed
by these CSS-focused changes. Confirmed all three fixes correct: an
independent from-scratch luminance recomputation for all four light-mode
hex values landed within rounding noise of the reported figures, all
comfortably clearing 4.5:1; the light-mode selectors' specificity
((0,4,0) via `:root` + the attribute selector + two classes) beats the
dark-mode rules' (0,2,0) unconditionally, with the light-mode rules also
physically placed after the dark ones in the file as a belt-and-suspenders
match; `color-mix()` mixing 0% accent with transparent produces alpha 0
regardless of the underlying RGB channels, so there's no wrong-color
flash at the animation's end; and the pulse-hit rule sits on a genuine
descendant of the themed `.song-embed`, so it correctly resolves the
themed accent rather than the global one. The deferred page-sync-overlay
finding was independently confirmed accurate (the overlay really is a
`document.body`-appended sibling, and the comment neither overstates nor
understates the tradeoff). Final score: **9/10** — ships.

Item #350 is done: 2 critic rounds, 5/10 → 9/10, one accessibility
regression (theme colors nearly invisible against the light theme, with
no light-mode variant at all) and one incomplete-theming gap (a themed
visual element that was never actually wired to the theme) fixed and
independently re-verified via from-scratch WCAG contrast recomputation
and CSS specificity/compositing reasoning rather than re-reading the
fix's own claims, plus one real cross-DOM-scoping limitation explicitly
documented as an accepted design tradeoff rather than silently left
unaddressed.

### Thirty-seventh item: #432, ammeter (current meter) component for the simulation builder

- ✅ **An idealized zero-resistance ammeter**, placed in series like the
  existing switch component, mirrored identically in
  `public/admin/sim-components.js` and `worker/simulation-render.js` as
  a new `"ammeter"` analysis-edge kind (not reusing an existing kind the
  way the potentiometer reused `"resistor"`, since a pure current
  measurement has no wattage/status-gating logic to inherit). First
  checked #431 (voltmeter) from the same backlog pairing and found it
  genuinely doesn't fit: a real voltmeter measures in PARALLEL, at two
  arbitrary points, and needs actual per-node voltage computation this
  simulator's single-shortest-path model doesn't have — real solver
  work belonging in a future Medium-tier pass, not force-fit here. The
  ammeter, placed IN SERIES, fits the existing single-path current
  analysis directly with zero new solver math, so it's the half of this
  pair that's genuinely Easy.

Handed to a critic agent for scoring: **8/10**. Findings:

1. **(Fixed, cosmetic)** The SVG symbol had a visible 5px gap on each
   side between where the lead lines ended (x=0→6, x=34→40) and where
   the body circle began (radius 9 centered at x=20, spanning x=11→29)
   — unlike every other bodied component in this registry (switch,
   resistor), which draw the body overlapping the lead ends, this could
   visually read as a broken/disconnected wire on a "did I wire this
   right" teaching tool. Fixed by extending the leads to x=11/x=29,
   exactly touching the circle's edges, in both mirrored files.
2. **(Fixed, real product gap)** The public embed never rendered ANY
   analysis-result number anywhere — server-side analysis was only ever
   used to toggle a "damaged" CSS class, never to print a value. For an
   ammeter specifically, this meant the component's entire reason for
   existing (showing a current reading) never actually appeared to a
   real site visitor, only in the admin's own separate inspector panel,
   and only after selecting the part. Fixed by printing the live current
   directly on the part itself — matching how the microcontroller
   component already prints its own label visibly — in both the admin
   canvas render and the public embed's server-side render, correctly
   showing "∞mA" (not a crash or "NaN") for a dead-short reading. This
   required bumping the component's declared height from 20 to 34 in
   both files so the reading has room within its own bounding box
   instead of rendering outside it; pins stayed at their original y:10
   since only horizontal lead spacing matters for breadboard snapping.

Sent for a round-2 critic pass specifically confirming both fixes are
byte-identical across the two mirrored component-registry files (this
codebase's single biggest recurring drift risk), that the live-reading
guard (`comp.type === "ammeter" && info`) correctly renders nothing at
all — not "undefinedmA" or a stray text node — for an ammeter that isn't
on any analyzed path, and that the height bump introduces no new hit-
testing or overlap regression. Confirmed both fixes genuinely identical
in all the places they needed to be (the two component-registry files
for the lead geometry, plus a third copy of the reading-render logic in
the admin builder itself); confirmed the guard behaves correctly by
reading the exact ternary rather than trusting the claim; grepped every
use of the bumped height value and found only the rubber-band multi-
select overlap check depends on it, with no placement/snap logic
affected, making the taller hit area a cosmetically-correct side effect
rather than a regression; confirmed the reading text's position fits
within the new bounding box with a thin-but-real margin; confirmed a
realistic reading string (including "∞mA") doesn't visually overflow the
40px-wide component at the chosen font size; and independently traced
the CSS styling chain end-to-end to confirm the public embed's reading
text gets the same `--text-dim` styling as the admin canvas, not
unstyled/invisible text. Final score: **9/10** — ships.

Item #432 is done: 2 critic rounds, 8/10 → 9/10, one cosmetic SVG gap
and one real product gap (a "current meter" whose reading never actually
reached a real site visitor) fixed and independently re-verified across
every mirrored copy of the affected logic, plus #431 (voltmeter)
explicitly re-scoped as genuine future solver work rather than forced
into this pass.

### Thirty-eighth item: #112, independent corner-radius for the Photo Editor's rectangle tool

- ✅ **A new "Corner radius" slider**, shown only while the rect
  annotation tool is active, letting an admin draw a rounded rectangle
  instead of only a sharp-cornered one. Uses `ctx.roundRect()` (falling
  back to plain `ctx.rect()`) for both the live drag preview and the
  committed annotation, via one small shared helper both call sites
  route through instead of each calling `ctx.strokeRect()` directly.
  Resets to 0 on every image open, matching this editor's existing
  per-session UI-preference-reset convention.

Handed to a critic agent for scoring: **8/10**. Finding:

1. **(Fixed)** `ctx.roundRect()` was called unconditionally whenever the
   radius was above 0, with no feature detection and no try/catch
   anywhere in the calling `pointerup` handler. On a browser old enough
   to lack `roundRect()` (added to the Canvas2D spec circa 2021-2022 —
   plausible for "whatever laptop/phone is handy" on a personal-site
   admin tool, unlike the main site's assumed audience), this would
   throw a plain `TypeError` — a strictly worse failure mode than the
   `strokeRect()` it replaced, which never throws regardless of input.
   Since the exception would abort the pointerup handler mid-execution
   AFTER `pushUndo()` already ran but BEFORE `clearOverlay()`/`dragStart`'s
   reset could run, it could push a stray empty undo entry, leave a
   stuck preview stroke on the overlay, and corrupt the next drag's
   state. A related untested edge case was also flagged: a click without
   dragging, or a perfectly horizontal/vertical drag (no minimum-drag-
   distance gate exists), passes a zero-width or zero-height rectangle
   into `roundRect()` — expected by spec to clamp safely, but not
   explicitly verified. Fixed by changing the guard to
   `radius > 0 && typeof c.roundRect === "function"`, falling back to
   plain `c.rect()` — degrading to "the radius setting is silently
   ignored on this browser" rather than throwing and wedging the tool's
   state machine — and expanding the code comment to explicitly document
   the zero-size case alongside the pre-existing oversized-radius one.

Sent for a round-2 critic pass specifically walking the exact pointerup
control-flow sequence line by line to confirm the fix genuinely closes
the described failure path (not just that a guard exists in principle),
confirming the guard is centralized in the single shared helper with no
second unguarded call site anywhere in the file, and checking whether
the zero-size-drag Playwright test actually reaches the `w=0`/`h=0` code
path or short-circuits earlier against some drag-distance gate. Confirmed
all of it: `roundRect` appears in exactly one place in the whole file;
tracing the real pointerup statement sequence (`pushUndo()` →
`commitAnnotation()` → `invalidateOpenAdjustDrag()` → `clearOverlay()` →
`dragStart = null`) shows every statement now runs end-to-end since the
helper can no longer throw; confirmed there genuinely is no minimum-
drag-distance gate anywhere in the pointer handlers, so a stationary
click or a horizontal-only drag really does reach the degenerate
`w=0`/`h=0` path in the shared helper, meaning the test was exercising
the real code, not a decoy; and confirmed `typeof c.roundRect ===
"function"` is a safe idiom that can't itself throw. Final score:
**9/10** — ships.

Item #112 is done: 1 critic round, 8/10 → 9/10, one real gap (an
unguarded newer Canvas2D API call that could throw on an older browser
and corrupt the annotation tool's undo/drag state, worse than the
behavior it replaced) fixed with feature detection and independently
re-verified by tracing the exact control-flow path the finding
described, plus explicit tests added for a previously-untested
degenerate-input edge case.

### Thirty-ninth item: #102, Photo Editor Text tool using the site's uploaded custom font

- ✅ **A new font select** (Sans-serif / Site's custom font) for the
  Text annotation tool, letting placed text use the same one custom font
  already uploaded through Site Settings (`worker/admin-api.js`'s
  `/upload-font`) instead of only the hardcoded "sans-serif" that
  existed before. Loaded via the FontFace API
  (`new FontFace(name, url).load()` + `document.fonts.add(...)`) since
  referencing an unregistered font family in `ctx.font` silently falls
  back to a default rather than erroring — the option only becomes
  selectable once a load has genuinely succeeded.

Handed to a critic agent for scoring: **5/10**. Findings:

1. **(Fixed, high severity, ship-blocking)** The custom-font check was
   cached forever after the FIRST Text-tool selection in a page load.
   Since the admin app is a single-page app where opening the Photo
   Editor and saving Site Settings both happen in the same page load
   with no navigation between them, this meant: open the editor with no
   font configured, click Text (resolves to "unavailable", cached
   forever), close the editor, configure a font via Site Settings,
   reopen the editor, click Text again — the option stays disabled
   forever until a hard page reload. This is exactly the sequence
   someone trying the feature for the first time would follow, not an
   obscure edge case. Fixed by re-fetching Site Settings every time the
   Text tool is selected (cheap), while only redoing the actual
   `FontFace` construction + load (the real cost) if the name+url pair
   has genuinely changed since the last successful load, tracked via a
   small cache key.
2. **(Fixed)** The font URL was interpolated into `url(${url})`
   unquoted, inconsistent with every OTHER place this exact
   `custom_font_url` value reaches a CSS `url()` in this codebase
   (`worker/render.js`'s `esc()`-wrapped version, the admin's own live
   Settings preview's `JSON.stringify`-wrapped version) — since
   `custom_font_url` is a plain string accepted by the settings API with
   no server-side format validation, a hand-edited value containing a
   space/parenthesis/quote would silently break font loading instead of
   being handled the way this codebase already handles the same value
   everywhere else. Fixed with the same `JSON.stringify(url)` quoting
   the admin's own Settings preview already uses.
3. **(Fixed, minor)** Concurrent calls to the font-check function (e.g.
   rapidly switching Text → another tool → Text again before the first
   check resolved) weren't de-duplicated — two overlapping fetch+load
   calls could race, and whichever settled last would silently overwrite
   the other's result, so a successful load could get clobbered back to
   "unavailable" by an unrelated, unlucky duplicate request. Fixed by
   caching the in-flight promise itself, so a second call while one is
   already running returns the same promise instead of starting an
   independent one.

Sent for a round-2 critic pass specifically tracing the key-comparison
logic for both a font-to-font change and a font-removal case, confirming
the promise cache correctly resets for later genuinely-new calls rather
than getting stuck, and probing for a subtler remaining race between the
promise-caching and staleness fixes. Confirmed all three fixes correct:
explicitly traced a font-A-to-font-B change correctly triggering a
reload via the differing cache key; confirmed clearing a configured font
back to empty correctly resets the cached family to null and re-disables
the option; confirmed the in-flight promise is cleared in a `finally`
block so a later call after full resolution always starts fresh rather
than reusing a stale promise; and confirmed the `JSON.stringify`
quoting fix lives at the actual `FontFace` construction call site, not
just in a comment. One narrow, inherent, self-healing gap was
identified and explicitly accepted rather than blocking on: if Site
Settings changes while a check is already in flight, a second call
arriving before the first resolves gets the same (now slightly stale)
in-flight promise rather than a truly fresh one — but this self-corrects
on the very next Text-tool selection, and Text-tool selection is a
discrete UI click, not a hot loop, so this wasn't treated as a real
defect. Final score: **9/10** — ships.

Item #102 is done: 2 critic rounds, 5/10 → 9/10, one ship-blocking
staleness bug (reachable via the exact sequence a first-time user of
this feature would follow, not an obscure edge case) plus an unquoted-
URL inconsistency and an unde-duplicated concurrency race, all fixed and
independently re-verified by tracing the actual cache-key comparison
logic and confirming the fixes against real Site Settings mutations
rather than mocked state.

### Fortieth item: #158, Photo Editor resource-limits tooltip (plus two real bugs it surfaced)

- ✅ **A small "ℹ️ Limits" tooltip** in the bottom toolbar, explaining
  three previously-silent constraints: images over 2000px on the long
  edge get automatically downscaled on open, undo/redo keeps only the
  last 15 steps, and exported files are capped at 8MB. What started as a
  purely static-text item turned into a multi-round chain after writing
  the advice text surfaced two genuine, previously-invisible bugs in the
  editor's actual save behavior.

Handed to a critic agent for scoring: **4/10**. Round-1 findings:

1. **(Fixed, major, real functional bug)** "Overwrite original" never
   passed a `quality` argument to `canvas.toBlob()` at all, so the
   quality slider had zero effect on overwriting a JPEG/WebP-original
   image — this editor's own hint text calls that out as the primary
   save action for a library image ("overwrite updates it everywhere
   it's used"). The tooltip's own "lower the quality slider" advice was
   therefore actively false for the most common save path. Fixed by
   threading the same quality value "Save as new" already uses through
   the overwrite handler (skipped for PNG, matching "Save as new"'s own
   PNG handling).
2. **(Fixed, related visibility gap the fix surfaced)** The quality
   slider's shown/hidden state was only ever driven by "Save as new"'s
   own format dropdown, which `open()` always resets to PNG by default —
   so overwriting a JPEG-original image left the one control that now
   genuinely affects its output completely invisible unless the admin
   happened to also change the unrelated "Save as new" dropdown first.
   Fixed by showing the slider whenever EITHER save path would use it.
3. **(Fixed)** The tooltip's advice offered nothing for PNG exports
   hitting the cap (no quality concept, and this editor's own default
   format) — now names PNG's actual remedies (crop/resize, or switch
   format via "Save as new").
4. **(Fixed)** The three numbers were a separate hardcoded string with
   no link to the real `MAX_DIMENSION`/`UNDO_LIMIT` constants — now
   interpolated from them directly at render time, plus a new named
   `MAX_EXPORT_MB` constant for the server-side cap (necessarily a
   separate literal, since a client module has no way to query the
   Worker's own hardcoded limit, but centralized rather than a bare
   number).

Sent for a round-2 critic pass verifying all four fixes and independently
proving the overwrite fix by measuring real output bytes. Confirmed
correct — and found a NEW issue in the exact area it was checking:

5. **(Fixed, round 2, moderate)** `updateSizeEstimate()` always computed
   its displayed estimate against "Save as new"'s own format (PNG by
   default), even when the quality slider was visible purely because of
   the overwrite path. Dragging the slider genuinely changed the real
   overwrite output (proven: 8.7KB at quality 10 vs 206KB at quality
   100), but the displayed estimate stayed completely frozen at PNG's
   fixed size regardless of slider position — an admin could reasonably
   conclude the control was broken, when only the *display* was
   disconnected from the real save path. Fixed by computing and showing
   BOTH paths' real estimates whenever an original file exists to
   overwrite, each against its own actual format/quality, with a
   generation-counter guard against the two newly-chained async
   `canvas.toBlob()` calls resolving out of order across rapid slider
   drags.

Sent for a round-3 critic pass specifically tracing the generation-
counter guard across both the outer and inner chained async calls for a
genuine race, and checking two edge cases: a PNG-original image (would
both estimates show identically, and is that confusing) and the no-
original-key case (does it correctly show only "Save as new" with no
dangling separator). Confirmed the generation guard is correctly checked
independently at both callback levels, so an older, slower-resolving
pair of chained calls is always discarded regardless of resolution
order, and that starting the inner call without a fresh generation
check first is harmless since the inner callback's own check at
resolution time is what actually matters. Confirmed the no-original-key
path correctly shows only "Save as new" with no dangling text. One
minor, non-blocking cosmetic nit was noted: a PNG-original image with
"Save as new" also left at PNG shows two identical-looking numbers
under different labels ("Save as new"/"Overwrite") — technically
accurate (both truly would produce identical bytes) but could read as a
glitch; left as an optional future simplification rather than blocking
on it, since the numbers themselves are never wrong. Final score:
**9/10** — ships.

Item #158 is done: 3 critic rounds, 4/10 → 9/10. What began as a static
informational tooltip surfaced two real, previously-invisible bugs in
this editor's actual save behavior (overwrite silently ignoring the
quality slider entirely, and a size estimate that looked broken exactly
when the fix for the first bug made it matter) — both fixed and proven
with real measured output bytes rather than just "no error thrown,"
each independently re-verified by a fresh critic round tracing the
actual code paths and async-race handling involved.

### Forty-first item: #8, Photo Editor canvas-view rotation

- ✅ **A "↻ View: 0°" button** in the bottom toolbar that cycles the
  on-screen view through 0°/90°/180°/270° via a pure CSS
  `transform: rotate(Ndeg)` on `#pe-canvas-stack` — purely cosmetic,
  never touches the image's actual pixels (unlike the existing "Rotate"
  tool, which bakes a real 90° pixel rotation into the canvas). Resets
  to 0° every time an image is opened, matching this editor's existing
  per-session UI-preference-reset convention (crop ratio, background
  preview, etc. all reset the same way on `open()`).

Before sending this to a critic, working through the implementation
surfaced a correctness issue serious enough to fix pre-emptively: with
only the CSS transform in place, every pointer-based tool (brush,
shapes, crop, text, erase) would place marks at the wrong canvas
location the instant the view was rotated, since raw pointer coordinates
are relative to the *unrotated* screen, not the rotated visual position.
`pointFromEvent(e)` was rewritten to inverse-transform pointer
coordinates: compute the pointer's offset from the rotated overlay's own
center (invariant under any CSS rotation), rotate that offset by
`-viewRotation` degrees, then map the result into canvas-pixel space
using the overlay's true unrotated CSS display dimensions (read from
`overlay.style.width`/`height`, since `getBoundingClientRect()` on a
rotated element returns the post-transform axis-aligned box with
width/height swapped at 90°/270°).

Verified the fix independently before any critic review, by hand-
deriving the expected geometry first (a screen click at the rotated
view's right-middle edge should land in the canvas's TOP half after a
90° clockwise rotation, since that rotation moves what was the canvas's
top edge onto the screen's right side) and then writing a Playwright
test to check that specific prediction. An initial attempt
(`test_pe_view_rotation.js`) using the "circle" shape tool with a small
drag on a tiny 50×50 test canvas and exact single-pixel sampling proved
too fragile — it failed on both the 0° baseline and the 90° check,
diagnosed as a test-authoring problem (imprecise tool/drag choice,
overly precise sampling) rather than a product bug, since all the
button's UI-lifecycle assertions (label cycling 0°→90°→180°→270°→0°,
CSS transform applied/cleared correctly, no undo-history entry pushed by
view rotation alone) passed cleanly in the same run. Rewrote it as
`test_pe_view_rotation2.js` using the "erase" tool with a large 60px
brush (producing an unambiguous, easily-detected transparent hole) and
quadrant-level pixel counting instead of exact-pixel sampling — this
version passed both directional checks cleanly: at 0°, an erase click at
the overlay's right-middle edge produced 1192 transparent pixels in the
canvas's right half vs. only 126 in the left half; after rotating 90°
and clicking the identical screen position again, the hole correctly
moved to the canvas's top half (1194 vs. 126 in the bottom half),
proving the inverse-transform math is correct rather than merely
"doesn't throw."

Handed to a critic agent for scoring: **9/10 — ships.** The critic
independently re-derived the inverse-rotation matrix by hand and
confirmed the code's `rx = dx·cos(-θ) - dy·sin(-θ)`, `ry = dx·sin(-θ) +
dy·cos(-θ)` is algebraically exact, verified every pointer-driven tool
(crop/select, brush/erase/blur/pixelate, shapes, text, eyedropper) all
route through the single fixed `pointFromEvent`, confirmed the cosmetic
view rotation and the real pixel-rotate tool compose safely (the
overlay's live `style.width`/`height` gets re-read on every call, so it
stays correct even with both active at once), confirmed `viewRotation`
resets unconditionally on every `open()` (not just the first), and found
one minor, non-blocking edge case:

- **(Deferred, minor, cosmetic-only)** The 0.15s CSS transition on
  `.pe-canvas-stack`'s transform animates the *visual* rotation, but the
  `viewRotation` JS variable driving `pointFromEvent`'s math updates
  instantly on click. A pointer interaction landing inside that ~150ms
  window uses the target angle's math while the DOM is still mid-
  animation at an intermediate angle, causing a small, bounded, self-
  correcting transient misplacement. Left unfixed: the window is very
  short, the feature is admin-only and cosmetic, and no data-corruption
  risk exists (worst case is a slightly-off mark placed during a
  fraction-of-a-second animation). Possible future fix if ever worth it:
  drop the transition, or gate pointerdown during `transitionrun`/
  `transitionend`.

Item #8 is done: 1 critic round, 9/10 on the first pass — the pre-
emptive `pointFromEvent` inverse-transform fix (done before any critic
review, once the coordinate-mismatch risk was recognized while
implementing) meant the one round of adversarial review found no
must-fix bugs, only a minor deferred cosmetic edge case.

### Forty-second item: fix the critic-surfaced silent-save-loss bug in `PATCH /songs/:id` and `PATCH /simulations/:id`

- ✅ **A real data-integrity bug**, originally surfaced by a critic
  reviewing #321's autosave feature but not fixed at the time: both
  `updateSong()` and `updateSimulation()` in `worker/db.js` ran an
  unconditional `UPDATE ... WHERE id = ?` with no existence check and no
  inspection of how many rows were actually affected, so the route
  handlers in `worker/admin-api.js` always responded `{ ok: true }`
  regardless of whether a matching row existed. Deleting a song or
  simulation's row (e.g. from its list view) while its builder happened
  to still be open in another tab or an earlier click, then editing a
  field and saving, produced a confident "Saved" (manual Save button) or
  "Saved HH:MM:SS" (autosave) with the edit silently discarded
  server-side — zero rows actually changed.

Fixed by having both `updateSong()` and `updateSimulation()` return
`res.meta.changes > 0` from the D1 `.run()` result, and having both PATCH
route handlers return `404 { error: "Not found" }` when that comes back
false. Checked the client contract before assuming this would actually
surface correctly: `window.adminApi()` (`public/admin/app.js`) already
throws on any non-2xx response using the server's own `error` field as
the message, and both call sites already had a `catch` — the Song
builder's manual Save handler does `alert(err.message)` and
`autosaveSong()` sets `#song-autosave-status` to `"Autosave failed: " +
err.message` — so no client-side changes were needed at all; the bug was
purely the server never telling the client anything had gone wrong.
Also fixed `updateSimulation()` identically, since it shared the exact
same bug shape and the simulation builder's own Save handler has the
same `adminApi()`-based catch already wired up.

Verified against the real API (not a re-implementation) via Playwright:
created a song, deleted it, then PATCHed the same id and confirmed a
real `404 {"error":"Not found"}` response; confirmed a PATCH against a
still-existing row still returns `200 {"ok":true}` (no false positives
introduced); repeated both checks for simulations; and directly called
`window.adminApi()` against the deleted song's PATCH endpoint to confirm
it actually throws with `err.status === 404` and `err.message === "Not
found"`, the exact contract both catch handlers depend on. Ran the full
`test_security_seo.js` regression suite — all passed. No test data left
behind (every created row in the test was itself deleted as part of the
test, whether as the intentional pre-condition or as cleanup).

This was a well-scoped, already-diagnosed bug fix rather than a new
outline.md item, so it wasn't sent through the full critic-scoring
workflow — the fix is small, mechanical, and directly matches the
critic's own originally-proposed remedy verbatim.

### Forty-third item: #339, Song builder "Export report"

- ✅ **An "Export report" button** in the Song builder's header, next to
  Save, that downloads a plain-text `.txt` summary of the currently
  open song: name, tempo, kit, melody waveform, visualization, theme,
  master volume, page-background-sync flag, each drum track's hit count
  out of the total step count, and every melody note that has at least
  one step toggled on (with its own hit count) — or "(none)" when the
  melody is empty. Reads directly from the in-memory `songData` object
  (the same object `Save` and autosave both write from), so it reflects
  any unsaved edits still in the builder, not just what's persisted to
  D1 — deliberately, since a "what does this song currently look like"
  report is more useful mid-edit than a possibly-stale saved snapshot.
  Mirrors the existing `sim-export`/JSON-blob download pattern already
  used by the Simulation builder (`Blob` → `URL.createObjectURL` →
  synthetic `<a download>` click → `URL.revokeObjectURL`), just as
  human-readable text instead of raw JSON, matching the item's own
  "dump JSON session fields to text" framing.

Verified via Playwright against the real UI end-to-end (not just the
report-generation logic in isolation): created a real song through the
actual `/api/admin/songs` POST endpoint with distinct values in every
field plus specific drum/melody note patterns, opened it through the
genuine UI path (clicking the sidebar's "Songs" button → "Edit" on the
test row, the same click path a real admin uses, not a direct internal
function call), clicked "Export report", captured the real browser
download event, and asserted the downloaded file's exact byte content:
correct song name, tempo, kit, theme, master-volume percentage,
page-sync state, exact per-track hit counts (`Kick: 4 / 16`, `Snare: 1 /
16`, `Hi-Hat: 0 / 16`), and a `.txt` filename derived from the song
name. A second run with a melody note (`C4`) toggled on twice confirmed
the melody section correctly lists `C4: 2 / 16` instead of falling back
to "(none)". Ran the full `test_security_seo.js` regression suite — all
passed. Confirmed no leftover test data via a direct authenticated
`GET /api/admin/songs` check after cleanup (both test songs were deleted
through the real `DELETE` endpoint as part of the test).

Despite being small and self-contained, it was still handed to a critic
agent for adversarial scoring: **9/10 — ships.** The critic traced every
field's own live `input`/`change` listener (tempo, kit, waveform,
visualization, theme, page-sync, master-volume) to confirm the report
genuinely reflects unsaved in-progress edits rather than only what
`Save` last persisted — the concern the summary handed to it explicitly
flagged as worth verifying rather than assuming. Also confirmed the
`master_volume` fallback for a pre-existing-field-less old song matches
the exact same guard already used elsewhere in this file (no
"NaN%"/"undefined%" risk), that melody-note access can't throw on a
missing key since `openBuilder()` backfills every piano-roll note key on
load, that a brand-new blank song produces a sane all-zero report with
no crash, and that `URL.revokeObjectURL` fires with the same safe timing
as the pre-existing `sim-export` pattern it was modeled on. One minor,
explicitly non-blocking note: no length cap on the exported filename for
a pathologically long song name — left alone since the existing
`sim-export` handler this session's own code was modeled on has the
exact same non-issue, so it isn't a regression.

Item #339 is done: 1 critic round, 9/10 on the first pass.

### Forty-fourth item: #305, Song builder live spectrum analyzer

- ✅ **A small `#song-spectrum` canvas** in the Song builder's header,
  next to the peak/RMS meters, showing a real-time 24-bar frequency
  spectrum of the master bus while the song is playing. Reuses the exact
  same shared `AnalyserNode` the peak/RMS meters already tap
  (`Engine.getPeakMeterAnalyser`) — a real audio-signal readout, not a
  decorative animation — since a single `AnalyserNode` provides both
  time-domain data (what the peak/RMS meters already read via
  `getFloatTimeDomainData`) and frequency-domain data
  (`getByteFrequencyData`) from the same underlying FFT every frame, so
  no second analyser node or extra audio-graph connection was needed.
  Drawn inside the exact same `requestAnimationFrame` loop the peak/RMS
  meters already run (`tick()` in `startPeakMeter()`), bucketing the
  analyser's 1024 frequency bins (`fftSize: 2048`) into 24 visual bars by
  averaging each bucket's magnitude. Cleared to blank on the same
  drain-timeout schedule the peak/RMS meters already use
  (`PEAK_METER_DRAIN_MS`), so it keeps tracking real decaying audio for a
  moment after Stop is clicked rather than snapping to empty while sound
  is still audible, matching the reasoning a critic pass on the peak
  meter itself already established this session.

Verified via Playwright against real synthesized audio (a song with kick
+ hi-hat drum hits on every step and a sawtooth melody note held
throughout, all through the actual song engine, not mocked): confirmed
the canvas is genuinely blank (zero non-transparent pixels) before
playback starts, confirmed it has real drawn content (820 non-transparent
pixels) after ~600ms of playback, and confirmed it returns to fully
blank again after Stop plus the full `PEAK_METER_DRAIN_MS` drain window.
Ran the full `test_security_seo.js` regression suite — all passed. No
leftover test data (the test song was deleted through the real API as
part of the test).

This is an admin-only monitoring tool (not a new public-embed
visualization mode, which would be considerably more scope — a new
`song-visualization` option needing public-embed rendering support,
theming, and cross-file mirroring), so it was implemented at the same
scope as the existing peak/RMS meters it sits beside.

Handed to a critic agent for scoring: **8/10**, below the ship
threshold. Round-1 findings:

1. **(Fixed, minor)** The bucketing math (`1024` frequency bins /
   `24` bars = `42` remainder `16`) silently dropped the top 16 bins
   (roughly the ~21.7-22kHz range) since the loop only ever covered
   `24 * 42 = 1008` of the 1024 bins — no crash or out-of-bounds access,
   just a real, silent coverage gap at the very top of the spectrum.
   Fixed by having the last bar's range extend to `freqData.length`
   instead of a fixed `binsPerBar` width, so the remainder bins get
   folded into the last bar's average rather than never being read.
2. **(Fixed, comment-only)** The original code comment justified
   hardcoding `#4dff6a` instead of `var(--accent)` by claiming an
   `--accent` lookup "would have been dead code" in the admin
   stylesheet — factually wrong, since `--accent` is defined and used
   extensively throughout `admin/style.css`. Corrected the comment to
   state the real reasoning: matching the pre-existing peak meter's own
   already-hardcoded fill color (an established VU-meter-color
   convention in this file), not an "unused variable" argument.
3. **(Noted, explicitly deferred)** Linear (non-logarithmic) frequency
   bucketing means the low bars covering roughly 0-900Hz will show most
   of the visible movement for typical drum/melody content, while the
   upper bars sit comparatively quiet — a real design limitation of
   linear bucketing versus a perceptually-scaled one, but not something
   that makes the feature useless (kick/bass/hi-hat energy is still
   clearly visible), and reworking to log-scaled bucketing is a
   reasonable future enhancement rather than a blocking fix for a
   lightweight admin monitoring tool.

Re-verified via the same Playwright spectrum test (blank before
playback, real drawn content during playback, cleared after Stop plus
the drain window) and the full regression suite — both still pass after
the fix. Sent for a round-2 critic pass specifically re-deriving the
exact bin ranges by hand: confirmed the last bar's `start = 23 * 42 =
966` now correctly extends to `freqData.length` (1024), covering bins
966-1023 (58 bins) with the averaging divisor correctly reflecting that
wider range rather than staying hardcoded to `binsPerBar` — so bars 0-22
cover bins 0-965 (966 bins) and bar 23 covers the remaining 58, for
1024/1024 total coverage with zero gaps and zero double-counting. Also
confirmed the corrected comment's factual claim (the peak meter's own
`.song-peak-meter-fill` CSS rule really is hardcoded to `#4dff6a`, not
`var(--accent)`) against the actual CSS. Confirmed no new bugs in the
untouched surrounding `tick()`/drain-timeout logic. Final score: **9/10
— ships.**

Item #305 is done: 2 critic rounds, 8/10 → 9/10.

### Forty-fifth item: #533, Simulation builder "Generate from current view" poster thumbnail

- ✅ **A "Generate from current view" button** next to the existing
  poster-image field in the Simulation builder, which rasterizes the
  live circuit SVG (the exact same `#sim-builder-svg` markup the public
  simulation viewer renders) into a PNG and uploads it as the poster/
  share image — sparing an admin from having to screenshot the circuit
  manually. Since simulations already have a poster field (`og_image`,
  wired to `#sim-poster-url`) unlike songs, this only needed the
  generation step, not any schema change.

Implementation note worth logging: the live SVG only carries a
`viewBox` (no explicit `width`/`height` attributes — those are set via
CSS on the live DOM element instead), and loading such an SVG into an
`<img>` for rasterization is a known browser-dependent gotcha — some
browsers fall back to an unrelated default intrinsic size (traditionally
300×150) rather than deriving one from the `viewBox`. Avoided by cloning
the SVG node (never touching the live DOM element, so nothing about the
actual builder view is disturbed) and explicitly setting `width`/`height`
on the clone from the live `viewBox` before serializing it — making the
rasterized size deterministic rather than relying on browser-specific
fallback behavior. Also explicitly filled the canvas with the SVG's own
computed `background-color` before drawing, since that background comes
from CSS (`var(--bg-elevated)`), not the SVG's own paintable content —
without this the exported PNG would have had a transparent background
instead of matching what's actually seen on screen.

Verified via Playwright against a real simulation (battery + resistor +
LED, not an empty canvas): confirmed the poster field starts empty,
clicking the button uploads a genuine PNG through the real
`/api/admin/upload` endpoint and sets the poster field to the resulting
URL, fetched the uploaded file back and confirmed it's a real
`image/png` of reasonable size (24.8KB, not a blank/near-empty image),
decoded its actual pixel dimensions and confirmed they exactly match the
SVG's `1500×700` viewBox, and confirmed the button's label/disabled
state correctly restore after the async upload completes. Ran the full
`test_security_seo.js` regression suite — all passed. Cleaned up both
the test simulation row AND the uploaded test media file itself via
their real DELETE endpoints, since this feature (unlike this session's
earlier text/JSON-only test data) genuinely uploads a new file to R2/the
media library, not just a D1 row.

Handed to a critic agent for scoring: **5/10**, below the ship
threshold. Round-1 finding:

1. **(Fixed)** `applyZoom()` sets an inline `style.width`/`style.height`
   on the LIVE `#sim-builder-svg` whenever zoomed and, critically,
   always on mobile (whose default zoom is 0.5) — `svg.cloneNode(true)`
   copies that inline style verbatim onto the clone, and the code only
   overrode the `width`/`height` XML *attributes* afterward, never
   clearing the inline style itself. The critic's theory: per the CSS
   cascade, inline `style` on an SVG root should take precedence over
   presentation attributes when that SVG is rendered standalone (e.g.
   via `<img>`), so the rasterized image would render at the stale
   zoomed-out CSS size (e.g. 750×350) rather than the full 1500×700,
   getting drawn into just the canvas's top-left corner with the rest
   left as bare background — reproducing on the mobile admin's own
   default zoom, not just a manual-zoom edge case. Fixed by explicitly
   clearing `svgClone.style.width`/`height` (mirroring exactly how
   `applyZoom()` itself already clears the live element's style at
   zoom 1) before setting the XML attributes and serializing.

   Verifying this empirically turned up a genuinely interesting nuance
   worth recording: instrumenting the REAL click handler's own `Image`
   object (not a hand-reimplementation of its logic) to capture
   `naturalWidth`/`naturalHeight` showed Chromium actually already
   resolved the correct `1500×700` intrinsic size from the explicit
   `width`/`height` XML attributes even *before* this fix, despite the
   stale inline style being present on the serialized clone — meaning
   the specific failure mode the critic described didn't reproduce in
   the browser this admin tool is actually used in. This doesn't make
   the fix wrong or unnecessary to keep: the CSS/SVG spec's precedence
   rules genuinely leave this browser-dependent (a UA is free to resolve
   an `<img>`'s replaced-element intrinsic size differently than how
   the same markup would lay out as a standalone document), so relying
   on one browser's specific resolution behavior rather than removing
   the ambiguity outright would be fragile. The fix was kept as
   correct, low-cost defensive code, and this nuance is logged here
   rather than silently claiming to have reproduced-then-fixed a crash
   that direct instrumentation actually showed didn't fire in this
   runtime.

Re-verified via Playwright: confirmed the original battery/resistor/LED
end-to-end test still passes unchanged, and added a second test that
mocks `isMobileBuilder()`'s `matchMedia` check to force the exact
zoomed-out scenario the critic described, confirming the button still
produces a correctly-sized (1500×700) thumbnail with real circuit
content in that scenario. Ran the full `test_security_seo.js`
regression suite — all passed. Sent for a round-2 critic pass.
