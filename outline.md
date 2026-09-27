# dominickdominick.com — Project outline

Current operating rules, shipped-module state, open work, migrations, and manual checks. Completed
implementation narratives remain in Git history.

**Stack:** Cloudflare Workers (JavaScript), D1 (SQLite), R2, vanilla HTML/CSS/JS admin; CDN-loaded highlight.js
and `@google/model-viewer`; ad hoc local Playwright with no CI test suite.

**Last reviewed:** 2026-09-26

## 0. Project and release rules

**Release pipeline:** `production` is the pre-release integration branch for active work and test candidates;
`main` is the intended release branch. Work one scoped batch at a time, run focused local checks, then commit and
push the candidate to `production` for independent critic review. Fix findings and rerun relevant checks there.
Promote the reviewed candidate to `main` only after it scores 9/10 or higher, has no unresolved critical/high
findings, and passes its required browser/manual gates. A lower score needs Dominick's explicit acceptance with
findings logged. If browser testing is unavailable, leave the candidate on `production` and list the manual check
still owed. The standing user decision authorizes clean fast-forward promotion after gates pass; no separate ask
is needed.

Cloudflare Workers Builds was verified on 2026-09-27: `main` is the selected production branch and Preview
builds are enabled. The `production` branch creates Worker Previews; it does not deploy to the live Worker. See
[Cloudflare's branch configuration](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/) and
[Preview configuration](https://developers.cloudflare.com/workers/previews/configuration/).
Before changing either ref, recheck both refs and require the candidate commit to fast-forward the target branch.
Before release, also confirm `main` is an ancestor of the reviewed `production` candidate. `production` being
ahead during review is expected. If either ref moved or the histories otherwise diverged, stop and reconcile them.
Never force-push or rewrite either branch. Cloudflare confirms `main` deploys live with `npx wrangler deploy`.

**Review gate:** target 9/10 or higher. A lower score requires Dominick's explicit acceptance and logged findings. Fix findings between passes; report every score and unresolved finding. Never claim browser or visual checks that were not run.

**Visible changes:** use a real-browser viewport screenshot and score 0–10 (0–4 fail, 5–7 needs polish, 8–10 ship-ready). If below 8, fix and rescore, stopping after five loops; after five, stop iteration, keep the best candidate on `production`, and record remaining issues. This is not release approval: `main` still needs the critic and manual gates above. For fixed modals capture viewport only; confirm suspected layout defects with DOM geometry. Always report the visual score, or say clearly when no screenshot was available.

**Test each batch:** use a throwaway Playwright script outside the repo to exercise the real flow; use only
synthetic test data and clean it up, including changed settings. Preview branches share D1/R2 when they use the
same resource IDs/names, so namespace fixtures and avoid conflicting parallel tests. Run the scratchpad
security/SEO regression and focused checks before pushing the candidate to `production`. The independent critic reviews changed code and
relevant call paths for bugs, security, SEO, accessibility, design, documentation, and maintainability; each
finding includes severity and evidence. Fix findings between passes and rerun affected checks. Target 9/10+ with
no critical/high findings; log accepted low-severity follow-ups. Update this outline and use the repository's
commit attribution footer. The user prefers forward progress without repeated check-ins; ask before production
data changes, enabling paid services/billing, costly-to-reverse architecture or visible design choices, or
starting a new module with unclear scope.

**Agent workflow and token budget:** the primary Codex agent implements one batch and owns the final evidence.
Use a short-lived backlog curator at batch starts or natural QA pauses to remove duplicates, capture new
evidence-backed ideas, classify value/difficulty/risk/dependencies, and recommend at most three ready-next tasks
with acceptance checks. Use one independent critic for sequential passes; give it the changed files, relevant
call paths, acceptance checks, and test evidence, not the whole repository. An optional site scout runs only at
planned QA pauses and sends findings to the curator; no agent runs continuously. Keep reports to actionable
findings and scores. Remove dead/duplicate code when safe; avoid speculative abstractions, repeated tests that
add no evidence, and scratch files in the repo. Browser/manual checks that cannot run stay explicitly open.

**Content and scope:** the public site intentionally has no articles or projects; never add filler/placeholder
production content. Work one item at a time. Continue from Easy into Medium/Hard when Easy runs low. Log
worthwhile new ideas and pursue them without waiting. Any genuinely new paid external service/API or billing
needs a check-in before activation. The admin custom-animation editor is implemented; do not treat it as a
planned feature.

**D1/R2 cautions:** this repo has not adopted Wrangler D1 migrations; `schema.sql` is bootstrap only. The
`previews` block sets runtime bindings, while Wrangler migrations use the selected config's top-level D1. Use
a dedicated Preview migration config and verify its database name/ID before `--remote`; inspect production
before any forward-only live migration. Preview D1/R2 are separate from production but shared by Previews
using the same IDs/names; use namespaced synthetic fixtures and clean them up. Production writes need
per-instance confirmation. See [Preview D1 migration guidance](https://developers.cloudflare.com/workers/previews/resources/#d1-migrations).
Preview resources: `dominickdominick-preview` D1 and
`dominickdominick-media-preview` R2; production resources: `f49fb038-9dfb-419e-acfb-7d8babc9d509` and
`dominickdominick-media`.

**Secrets:** `ADMIN_PASSWORD` and `SESSION_SECRET` stay in Worker runtime Secrets, never in source or public
content. The empty **Builds → Variables and secrets** panel only shows that no build-time values are configured;
it does not verify runtime Worker secrets. Verify distinct test-only Preview values before protected-flow checks.

## 1. Module status and architecture

- **TTS:** shipped with uploaded audio and Web Speech API fallback. Actual speech still needs a browser with
  installed voices.
- **Song builder:** shipped with drum sequencer, piano roll, MIDI input, autosave, waveform/player
  visualizations, public embeds, and private production notes. Waveform previews now render deterministically;
  live drum playback retains fresh noise.
- **Admin mobile UX:** topbar overflow, page-builder reflow, and QA bugs were fixed. The broader
  visual/navigation pass remains open. Prior QA also found broken homepage/gallery image paths; verify these in
  admin diagnostics before cleanup.
- **Public design:** flow-layout and baseline code-block/link styling shipped. Typographic hierarchy and spacing
  remain open, best judged with real published content.
- **Custom animations:** timeline/keyframe editor with server-side CSS generation is implemented.
- **Photo Editor:** single Canvas2D raster canvas; no layer stack, masks, or nondestructive adjustments.
  Existing undo is a 15-snapshot canvas stack.
- **Song/DAW:** fixed 16-step sequencer with synthesized Web Audio; no sample playback, multitrack timeline,
  mixing, or effects.
- **Simulation builder:** SVG circuits and simplified connectivity/Ohm's-law analysis, not a SPICE solver; named
  checkpoints exist, while undo is in-memory.
- **Shared lifecycle:** pages/articles/projects have autosave, conflict detection, revisions, and trash; media
  has versions and usage tracking. Songs/simulations still lack full parity.
## 2. Active feature backlog

Open and partial items only; completed implementation histories remain in Git history.

### Page builder and layout
- ☐ Reusable sections containing multiple blocks (needs nested/grouped blocks)
- ☐ Custom components assembled from blocks with their own editable options
- ☐ Visual header/footer editor (footer is a text field; nav is ordering only)
- ☐ Separate desktop/tablet/phone layout settings (needs schema change + reworked drag/resize)
- 🔶 Per-device spacing/ordering/visibility (visibility ✅; spacing/ordering ☐)
- ☐ Block grouping/ungrouping
- 🔶 Guides/rulers/snapping (alignment guides + grid snapping ✅; literal ruler/gap-measurement UI ☐)
- ☐ Nested sections and columns (needs `blocks.parent_id` + reworked drag/resize)
- 🔶 Hover/focus/mobile-state previews (mobile ✅ via responsive preview; hover/focus simulation ☐)
- 🔶 Copy/paste blocks between pages (blocks ✅; "sections" n/a)
- ☐ Bulk updates to pages sharing a template
- 🔶 Conditional display by date/device/URL/content field (device/date work; URL/content rules remain open)

### Design system and styling
- 🔶 Global spacing and shadow tokens (color, typography, and border tokens exist)
- ☐ Visual CSS inspector, style-inheritance inspector
- 🔶 Reset overrides to inherited (per-field "Clear" on color pickers ✅; no general concept)
- ☐ Page-specific CSS/JS controls (custom head code is site-wide only)
- ☐ Preview custom styles/scripts before publishing; site-wide impact review of a design change

### Content modeling and dynamic display
- 🔶 Custom content types via admin (Projects is a dedicated hard-coded type, not a no-code arbitrary-schema
  system)
- ☐ Custom fields per content type, nested categories (flat tags only)
- 🔶 Relationships (projects→articles/simulations/scans ✅, one-directional across every other pair)
- 🔶 Centrally managed option lists for reusable controlled values
- 🔶 Repeating layouts / visual query builder / display templates (article-list/project-list blocks cover the
  basics; not admin-customizable beyond limit+tag+featured filters)
- ☐ Conditional sections based on available content
- 🔶 Pagination/load-more/infinite scroll (search results supported; review other listings)
- ☐ Rules engine, workflow builder for publishing/archiving

### Writing and article editor
- 🔶 Import UI and paste cleanup from documents/websites

### Saving, recovery, and versioning
- ☐ Side-by-side compare of conflicting versions (currently just "reload to see latest")
- 🔶 Field-level restore within an edit (whole-item, block, and media restore exist)
- ☐ Separate working revisions of already-published content (editing live edits it directly)

### Publishing workflow
- ☐ Publishing approvals/review steps, editorial calendar, review reminders
- ☐ Future-date preview for scheduled changes
- ☐ Publish-as-package (related pages/nav/updates together), rollback of a package, affected-pages preview,
  URL-change impact preview

### Content administration and portability
- ☐ Import from other platforms, import dry-run preview
- 🔶 Stable IDs across backup/import round-trips (import is not implemented)

### Personal site sections
- 🔶 Now page (capability exists, content not written)
- ☐ Uses/gear page, resume/experience page from structured data, public project roadmaps, "Currently building"
  homepage widget
- 🔶 Public notes/short posts (articles serve this; no distinct lightweight format)

### Projects and portfolio
- ☐ Independent per-project layouts (fixed template like articles)
- 🔶 Public changelogs (journal entries can serve; no distinct feature)

### Build journals and technical documentation
- 🔶 Supporting photos/measurements for tests (markdown text only; no dedicated fields)
- ☐ Reproduction checklists, hardware/software compatibility info, firmware tied to hardware revisions,
  completion summaries, cybersecurity lab writeup templates, annotated terminal transcripts, screenshot
  redaction

### Media library and file management
- 🔶 Nested folders and smart collections (flat folders, tags, and saved searches exist)
- 🔶 Bulk rename (R2 keys are content-addressed; rename metadata instead)
- 🔶 Search media by dimensions (filename, tag, type, and usage searches exist)
- ☐ Image optimization comparison, video captions/transcripts, general media-audio support (TTS audio is
  separate), PDF/document previews, direct-download controls, drag-to-page, resumable uploads, retry queue

### Photo editor
- ☐ Batch adjustments, redaction tools, cross-crop preview.

### 3D LiDAR module
- ☐ Everything else: library folders/tags beyond projects, fullscreen as distinct control, point-cloud/mesh
  toggle, measurement tools, annotations, saved camera views, comparisons, timeline, capture-date/equipment
  fields, inline embeds, mobile perf settings,…

### Search and content discovery
- ☐ Interactive project map/visual index

### Analytics
- 🔶 Event analytics report surface (generic tracking exists)
- ☐ Per-page engagement/scroll depth, project-card click paths, conversion goals, period comparisons, chart
  annotations, bot filtering, data-retention settings, scheduled summaries, rearrangeable widgets

### SEO and sharing
- 🔶 Additional metadata reports beyond the existing SEO report

### Accessibility
- 🔶 Sitewide arbitrary-content contrast checker (theme-color contrast is supported)

### Admin interface
- 🔶 Broader command-palette coverage beyond current pages/articles/projects/blocks/Songs/Diagnostics/SEO/Topics
- ☐ Customizable dashboard, interface density settings, saved workspace layouts
- 🔶 Universal bulk-action toolbar (currently articles, projects, and blocks)
- ☐ Contextual help for complex editors, shortcut remapping
- ☐ Role-specific preview (requires a roles system; none exists)

### Authentication and permissions
- ☐ 2FA, passkeys, recovery codes, roles/permissions, scoped API tokens, reauthentication for sensitive actions,
  sandboxed custom-code previews, secret management separate from content
- ☐ Session list/remote revocation (would need a real session-store rearchitecture)

### Integrations and automation
- ☐ Background-task management, failed-integration notifications, permission controls for external integrations

### Testing, staging, and deployment
- ☐ Automated tests wired into CI (Playwright scripts are ad hoc, local only)
- 🔶 Worker Preview environment (D1/R2 separate from production and shared across Preview branches; build, secrets, and browser/manual validation remain)
- 🔶 Preview deployments tied to the `production` branch (mapping configured; successful build verification remains)
- 🔶 Migration history (this doc is a manual log; no automated tracker)
- 🔶 Staging content workflow (draft and live states exist; no content-promotion workflow)

### Backups, health, and operating costs
- 🔶 Separate R2 asset backups (R2 currently stores the primary media copies)
- 🔶 Human restore runbook (automated restore is tested with Playwright)
- ☐ Health dashboard (DB/storage/uploads/publishing), failed-scheduled-publish alerts, cost/usage alerts
- 🔶 Traffic dashboard (analytics covers visitor traffic; not Worker CPU/processing usage)

## 3. Ideas to consider

The standing scope rule in section 0 applies. Keep shared builders consistent.
- Improve backdrop contrast for near-fullscreen builder modals across Songs, Simulations, and Scans.
- Distinguish security-sensitive admin actions in the activity log.
- Build orphan-page detection carefully to avoid false positives.
- Add a D1 migration runner only after inventorying production schema and historical manual changes; keep
  `schema.sql` as bootstrap, not a repeatable migration.
- If the general media library expands beyond images, consider adding waveforms for its audio files.
- Extend TTS read-aloud to build journals if there is a clear use case.

## 4. Pending production migrations

Production D1 was last reported column-by-column synced to `schema.sql` on 2026-09-24. Nothing was pending at
that check; this is historical and must be reverified against production before relying on it. This repository
has not adopted Wrangler's D1 migration system. The media hash backfill had been run for then-existing uploads.
Verify the target database/config before any remote migration or production D1/R2 operation.

## 5. Deferred or scoped out

- **Spacing and shadow tokens** — no safe existing hook (spacing is ad
  hoc per-component px values, zero box-shadows anywhere by current
  design); needs a careful visual-review pass, not an unsupervised one.
- **Metadata viewer for image dimensions/format** — needs client canvas
  probing at upload or server-side binary header parsing; low value for
  a small personal media library relative to effort.
- **Orphan-page detection** — real design complexity (every internal-
  link-holding block type, plus list-block `limit` truncation logic);
  worth doing right, not rushed.
- **Automated tests in CI** — Playwright scripts stay ad hoc/local for
  now.
- **Image CDN transforms** (Cloudflare Image Resizing) — needs a
  specific billing plan, didn't want to assume it.
- **A standalone public `/scan/:id` page** (mirroring `/simulation/:id`)
  — trivial to add via the existing `modelViewerHtml()` helper, just
  hasn't been asked for.
- **Local dev-only test content cleanup** — low priority; inspect and
  confirm before any bulk deletion.

---

## 6. Manual verification still owed

- Verify the next `production` push creates a successful Worker Preview with the separate-from-production,
  shared test bindings; then open its preview URL and run the required real-browser/manual checks before release.
- Verify Worker Previews Base uses distinct test-only `ADMIN_PASSWORD` and `SESSION_SECRET` values before testing
  protected admin flows; never reuse production secrets.
- Recheck Preview URL access before adding test data. The dashboard showed “Anyone with this URL can visit”; keep
  content non-sensitive and clean namespaced fixtures unless Cloudflare Access is enabled. See [Preview access control](https://developers.cloudflare.com/workers/previews/#access-control).
- Confirm highlight.js loads for a real published article with a code block.
- Confirm `@google/model-viewer` loads a `.glb`; test `.usdz` AR on an iPhone.
- Confirm the live Worker's `0 8 * * *` D1→R2 backup schedule in Cloudflare. Worker Previews do not run Cron
  Triggers, so this is not covered by Preview QA; do not manually trigger a production backup as a Preview test.
- Confirm Web Speech API read-aloud with actual browser voices.

**Audit environment limitation:** browser testing was not performed. The cloud browser could not reach
localhost, and Chromium installation failed because outbound package access was restricted. Do not report
browser or visual testing as passed.

## 7. Recurring security, SEO, and accessibility checks

### Security
- [ ] Dependencies/CDN scripts (highlight.js, model-viewer) still pinned to versions without known CVEs
- [ ] Rate limits still cover every public write endpoint (login, track, react, search, preview links) — check
  after adding any new public POST route
- [ ] Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) still present and
  correctly scoped
- [ ] Session cookie still `HttpOnly; Secure; SameSite=Strict`
- [ ] No new admin route added without going through `isAuthenticated()` / the admin router's auth gate
- [ ] `javascript:`/`data:` URI neutralization (`safeHref`) still applied everywhere a user-authored URL renders
  (buttons, project links, download manifest, links block, markdown links)
- [ ] Raw-HTML block and custom `<head>` code remain explicitly trusted-admin-only, never exposed to a lower
  trust level
- [ ] New tables/columns don't accidentally expose more than intended through a `SELECT *` in a public-facing
  query
- [ ] File uploads validated by type for each supported surface (images and TTS audio); add validation whenever
  anewformat is introduced, such as DAW exports

### SEO and accessibility
- [ ] Every new public route has a `<title>`, meta description, and correct canonical tag
- [ ] New content types show up in `sitemap.xml` (and RSS if content, not utility)
- [ ] JSON-LD structured data present and valid where expected (articles, projects, breadcrumbs)
- [ ] New image-bearing blocks get alt-text prompts/warnings in the diagnostics panel
- [ ] New heading-producing content respects the H1-once, no-skipped- level rule the diagnostics panel checks
- [ ] New interactive/canvas content (simulations, scans, and — the DAW/TTS modules) gets a real text
  alternative, not just a generic label
- [ ] Reduced-motion respected for any new animation (including the page-animation sync)
- [ ] Tap targets ≥ 24×24px on any new mobile UI
- [ ] Color contrast checked for any new UI color, not just theme tokens ---

## 8. Creative-suite backlog

The 600-item wish list covers the Photo Editor, Song/DAW, Simulation builder, and shared platform. Treat it as a
menu, not a code specification: inspect implementation and dependencies before selecting an item. Work one item
at a time through research, implementation, tests, critic review, fixes, and shipping.

**Current editor reality:** the Photo Editor is a single raster canvas; the Song builder synthesizes sound and
has no sample timeline; Simulations use simplified connectivity analysis rather than SPICE.
Pages/articles/projects have the strongest save/version lifecycle; media has file versions; songs and
simulations need parity.

### Photo Editor — Easy
- 17. Layer colors/labels — metadata fields once layers exist.
- 18. Search/filter layers — simple list filter UI.
- 31. Rect/ellipse selection — canvas path, same overlay pattern as crop.
- 32. Freehand lasso — pointer path capture, like brush stroke.
- 33. Polygonal lasso — click-to-add-vertex overlay.
- 40. Save/name selections — JSON blob like existing photo-presets.
- 43. Mask-only inspection view — toggle rendering mask canvas alone.
- 44. Colored mask overlays — tint mask canvas, trivial compositing.
- 77. Hard-edged pencil (requires a real freehand paintbrush first)
- 90. Magnified retouch comparison (requires zoom/pan)
- 93. Horizon straightening — arbitrary-angle rotate + auto-crop.

### Photo Editor — Medium
4, 7, 9, 10, 13, 14, 15, 16, 19, 20, 21, 22, 23, 24, 29, 30, 35, 36, 37, 38, 39, 42, 45, 46, 48, 49, 53, 55, 58,
60, 61, 62, 63, 64, 65, 66, 67, 68, 69, 70, 73, 74, 75, 79, 81, 85, 87, 88, 89, 91, 95, 98, 99, 101, 103, 104,
107, 110, 111, 116, 118, 119, 121, 122, 123, 124, 126, 127, 130, 140 (★ also enterprise-flagged: spending-limit
bookkeeping), 142, 144, 147, 148, 149, 151, 152, 154, 156, 157, 159, 160, 162 (AVIF pushes toward Hard), 170,
172, 173, 176, 177, 178. Inspect the chosen item's requirements in the original wishlist and current code before
implementation. Two recurring blockers worth designing around before working this tier: most of
layers/compositing/masks/nondestructive- editing (#11-60) share ONE foundational dependency — a real
layer-stack/ object-model architecture, which doesn't exist and is itself Hard, but unlocks dozens of these
cheaply once built. Recommended sequencing: layer engine → selection-mask engine → most of the rest becomes
incremental.

### Photo Editor — Hard
1, 11, 12, 25, 26, 27, 28, 34, 41, 47, 50, 51, 52, 54, 56, 57, 94, 96, 97, 100, 105, 106, 113, 114, 115, 117,
120, 125, 128, 131, 132, 133, 134, 135 (external generative API + billing), 136, 137, 138, 141 (dockable- panel
framework rebuild — enterprise/product-shaped, flagged), 145, 153, 155, 163, 164, 165, 166 (RAW decoding —
borderline infeasible in-browser), 167, 168, 171, 179. Items 131-138 (ML-assisted selection/removal/upscale/
background-replacement) all need either a browser ML model or an external API with real billing — none of that
infra exists today.

### DAW/Audio — Easy
- 184. Tempo/time-signature settings — tempo field exists; add a sibling field.
- 190. Multiple sessions via tabs — songs already separate D1 rows/list UI.
- 198. Hide tracks without disabling audio (add mute and hide together)
- 199. Reorder/duplicate tracks — array ops, duplicate-song pattern exists.
- 217. Reverse selected audio (requires imported/recorded audio buffers)
- 220. Remove DC offset (requires imported/recorded audio buffers)
- 276. Polarity inversion (requires stereo signal support)
- 277. Mono compatibility button (requires stereo signal support)
- 309. Track/master clipping history — log exceedances like existing `log()` action table.
- 329. Warn before heavy sample imports — file.size check pre-decode.
- 341. Publish track to a project (requires a project schema change; follow migration cautions)
- 356. Detect missing samples before export (requires sample playback)

### DAW/Audio — Medium
182, 183, 185, 186, 187, 188, 191, 192, 193, 194, 200, 201, 203, 204, 207, 209, 211-216, 219, 221, 222, 224,
226-230, 231-235, 238, 239, 240, 241, 242, 244, 245, 247-250, 251-253, 255-259, 260, 261, 263, 266, 268, 269,
271-274, 278, 279, 281-285, 288-290, 300, 306-308, 310, 312, 313, 316, 317, 320, 323-325, 327, 330, 331-335,
337, 343-348, 352-354, 357, 358, 360. Nearly everything here needs a multitrack clip/timeline model that doesn't
exist yet — building that once unlocks most of this tier incrementally, same "one foundational blocker" pattern
as the Photo Editor's layer engine.

### DAW/Audio — Hard
181 (the whole missing multitrack/timeline foundation), 202, 205, 206, 208, 210, 223, 225, 243, 254, 262, 264,
265, 267, 270, 275, 280, 286, 287, 291-299 (real pitch/time DSP — phase vocoder, YIN, etc.), 303, 304, 318, 319,
322, 326, 336 (proper K-weighted LUFS loudness, none exists), 338 (compressed codecs need heavy client-side
encoders), 340 (proprietary DAW project formats effectively infeasible to support faithfully), 342 (★ also
enterprise-flagged: "restricted mixer" implies per-viewer access control beyond single-admin), 352, 359 (a
sandboxed plugin architecture — substantial new infra + security surface).

### Simulations — Easy
- 362. Separate draft/published — new `published_data` column + toggle, like other content types.
- 363. Deterministic runs/seeds — sim is deterministic already; add a seed field for future randomness.
- 373. Rotate/mirror — add transform + flip pin coords, small render change.
- 387. Selectable breadboard sizes — new `cols` param variant of existing breadboard def.
- 388. Warn same-hole leads — check during snap-drop, data already tracks hole ids.
- 389. Mechanical vs electrical distinction — already implicit; just surface it in UI.
- 393. Manual wire bend points — extend wire path from 2-point to polyline.
- 403-405. Resistor/capacitor/inductor basic params — extra content fields, same pattern as resistance.
- 409. Relays/switches — variant of existing switch component.
- 415. Current source — checked while implementing #416: doesn't fit this simulator's model as worded. This
  solver assumes constant-voltage sources and derives current via I=V/R; a true current source needs a different
  source model, which is outside the current simulator's scope.
- 431. Voltage meter (requires arbitrary-node voltage computation)
- 441. Basic logic gates (static icons only, no dynamic sim) — new component type.
- 445. Truth-table editor — simple UI table bound to a gate's static behavior.
- 531. Consistent embed controls — mostly CSS/UI consistency pass.
- 534. Public param controls — expose whitelisted fields already in `data` via player UI.

### Simulations — Medium
364, 365, 368, 369, 370, 372, 374, 376, 377, 379, 381-384, 386, 390, 392, 395, 399, 400, 406-408, 412-414,
417-420, 421-430 (DC op-point specifically; see Hard for transient/AC), 433, 435-440, 442-444, 446-450, 456-460,
464-470, 471-478, 479-480 (feed/export audio to/from the DAW), 481-490, 491-500 (guided lessons — real new
authoring subsystem, no new solver), 501-510, 511-520 (mostly documentation/QA + moderate validation code),
521-523, 525-530 (522 ★ enterprise-flagged: public template marketplace framing; 498 ★ "…or optional account"
implies multi-user), 532, 535-538, 540.

### Simulations — Hard
421-424 general case (real transient/AC/frequency-domain analysis needs an MNA-style solver — most of a small
SPICE), 430 (tunable solver accuracy implies that same real solver), 451-455 (MCU firmware compilation/emulation
— real toolchains like avr-gcc can't run in a Cloudflare Worker, needs an external compute service to
build/maintain), 459 (peripheral-bus inspection inherits 451-455's blocker), 506 (physically-accurate
overload/failure cascades — simple threshold-check version is Medium, listed above), 514-516 as true guarantees
(need the general solver from 421-424 first), 529-530 (general netlist import across SPICE-family dialects —
substantial ongoing-maintenance parser work).

### Shared platform — Easy
No open Easy items remain in this area.

### Shared platform — Medium
541-543, 545-548 (548's transcript search needs transcripts, which don't exist yet), 550, 551, 555, 557, 559,
560, 563, 566, 568, 570, 571, 573-575, 577-579, 589, 591-594, 598 (★ "per-module" framing leans enterprise; the
simple env-flag version is fine for single-admin), 599.

### Shared platform — Hard (mostly flagged as likely out of scope for a single-admin site)
552 [offline-first sync — out of scope], 556, 561-562 [job queue — out of scope], 564-565 [multiple compute
backends / per-module spending limits — out of scope], 581 [roles/permissions beyond one admin — out of scope],
585-587 [automation-trigger engine + loop prevention — out of scope], 590 [depends on 581's nonexistent
permissions — out of scope], 597 [package/dependency system — out of scope], 600 [full module-platform
  governance spec — out of scope]. Prioritize a scoped Easy item; move into Medium and Hard as the Easy queue
  runs low. The curator ranks ready candidates by impact, difficulty, risk, and dependencies. Research, implement,
  and test one item at a time, then address critic findings toward 9/10 or higher; log accepted residuals.

### Current unnumbered follow-ups

- Song builder still has no undo/redo.
- Admin dialogs lack `role="dialog"` and `aria-modal="true"` semantics.
- Media hash/dimension backfills stop after 500 R2 objects instead of following the cursor.
- Project-card and content-header images still need the image-dimension layout-shift audit.
- The prior sweep found broken image URLs in homepage/gallery content; verify those paths in admin diagnostics
  before cleanup.

## 9. Current Codex audit

- Offline waveform peaks are content-seeded; live playback keeps fresh noise.
- Four sequential critiques scored 8, 8, 9, and 8/10; findings were fixed between passes, followed by a 9/10 confirmation with no material findings. The Preview/config review scored 8/10; its documentation findings were fixed, then confirmed at 9/10 with no remaining technical findings.
- Earlier local checks passed: 66 server/security/SEO checks, 9 song save/race/waveform checks, modal/accessibility checks, simulation save/open checks, JavaScript syntax, and `git diff --check`. Scratch scripts remain outside the repo.
- The audited batch was fast-forwarded from `production` to `main` at `2ce8ffe`; Cloudflare's live build `ebb0caf1` succeeded with `npx wrangler deploy`. Preview builds for code candidate `86d4ef6` (`03b3099f`), documentation snapshot `639ac07` (`f9f41cbb`), and audit-note snapshot `2ce8ffe` (`d223daba`) succeeded with `npx wrangler preview`.
- Public Preview smoke checks: `/admin/` loads the sign-in form; `/random` and `/projects` render their empty states; `/` shows the branded 404 because Preview D1 has zero pages, articles, and projects. No production content was copied. The mobile-sized `/admin/` viewport screenshot scored 8/10 as an entry-screen check; no password was entered. This does not verify authenticated flows or populated public layouts.
- Dominick explicitly requested promotion before populated public-page/song and protected-admin flows were tested; these remain outstanding, not passed. Localhost testing was blocked because the cloud browser could not reach localhost and Chromium installation failed under restricted egress. Use namespaced synthetic Preview data and verify test-only runtime secrets before those checks. Preview URLs are public unless Access is enabled. Cron checks remain limited to live config; never trigger a production backup as a Preview test.
## 10. Open decisions

- Whether to replace the legacy violet border.
- Built-in routes take precedence over CMS slugs `projects` and `random`.
