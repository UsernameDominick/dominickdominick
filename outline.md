# dominickdominick.com — Project outline

Current operating rules, shipped-module state, open work, migrations, and manual checks. Completed
implementation narratives remain in Git history.

**Stack:** Cloudflare Workers (JavaScript), D1 (SQLite), R2, vanilla HTML/CSS/JS admin; CDN-loaded highlight.js
and `@google/model-viewer`; ad hoc local Playwright with no CI test suite.

**Last reviewed:** 2026-09-28

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

GitHub's branch API reports `protected: false` and `protection.enabled: false` for both `main` and `production`. The rulesets API returns 403 on this repository plan, so any rulesets remain unverified. Treat both branches as unprotected until the owner verifies effective controls.

**Review evidence:** report each critic score and unresolved finding; never claim browser or visual checks that were not run.

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

**D1/R2 cautions:** `schema.sql` is the base fresh-install bootstrap; apply the Wrangler migrations after it. Wrangler D1 migration `0001` tracks simulation
publication only; older manual schema changes are not reconstructed. The `previews` block sets runtime bindings,
while Wrangler migrations use the selected config's top-level D1. Use `wrangler.preview-migrations.jsonc` and
verify its database name/ID against the Preview binding before `--remote`; inspect production before any
forward-only live migration. Preview D1/R2 are separate from production but shared by Previews using the same
IDs/names; use namespaced synthetic fixtures and clean them up. Production writes need per-instance confirmation.
See [Preview D1 migration guidance](https://developers.cloudflare.com/workers/previews/resources/#d1-migrations).
Preview resources: `dominickdominick-preview` D1 and
`dominickdominick-media-preview` R2; production resources: `f49fb038-9dfb-419e-acfb-7d8babc9d509` and
`dominickdominick-media`.

**Secrets:** `ADMIN_PASSWORD` and `SESSION_SECRET` stay in Worker runtime Secrets, never in source or public
content. Builds variables and secrets are build-time settings; that panel does not verify runtime Worker secrets.
Verify distinct test-only Preview values before protected-flow checks.

## 1. Module status and architecture

- **TTS:** shipped with uploaded audio and Web Speech API fallback. Actual speech still needs a browser with
  installed voices.
- **Song builder:** drum sequencer, piano roll, MIDI input, bounded grouped Undo/Redo, autosave, waveform/player
  visualizations, public embeds, and private production notes. Waveform previews render deterministically;
  live drum playback retains fresh noise. New drafts warn before close and become autosaved after first Save.
  Each drum track and the melody can be muted (silent in preview, embed, and cached waveform) or hidden
  (collapsed in the editor only); flags are stored only while true in `trackMeta[t]` / `melody`.
  A Clipping history panel logs each time the master output reaches full scale while playing (merged into
  events, in memory for the open song, master bus only since there are no per-track meters).
- **Admin mobile UX:** topbar overflow, page-builder reflow, and QA bugs were fixed. The broader
  visual/navigation pass remains open.
- **Public design:** flow-layout and baseline code-block/link styling shipped. Typographic hierarchy and spacing
  remain open, best judged with real published content.
- **Custom animations:** timeline/keyframe editor with server-side CSS generation is implemented.
- **Photo Editor:** single Canvas2D raster canvas; no layer stack, masks, or nondestructive adjustments.
  Existing undo is a 15-snapshot canvas stack. Straighten rotates by -45 to +45 degrees with a live overlay
  preview and auto-crops to the largest same-aspect rectangle that fits inside the tilted image.
- **Song/DAW:** fixed 16-step sequencer with synthesized Web Audio; no sample playback, multitrack timeline,
  mixing, or effects.
- **Simulation builder:** SVG circuits and simplified connectivity/Ohm's-law analysis, not a SPICE solver; breadboards support 15, 30, or 45 columns, manual wire bends, same-hole snap warnings, named checkpoints, and in-memory undo. Draft edits stay private until the saved name and circuit data are explicitly published; unpublish hides the live snapshot. Older simulations default to 30 columns, and save validation checks board-size pins. Parts (not breadboards) can be rotated in 90° steps and mirrored (R / Shift+R / F or the inspector buttons); orientation is applied at the component-definition level so pins, wires, snapping, and rendering all follow it, and save validation rejects invalid orientation values. Capacitor and inductor parts carry basic parameters (capacitance in µF, inductance in mH, winding resistance in ohms) in the DC steady-state model: a capacitor is an open circuit and an inductor is a small resistor, so only the winding resistance affects the analysis. Logic gates (AND, OR, NAND, NOR, XOR, XNOR, NOT, buffer) are static diagram symbols with an editable truth table (`gate`, optional `truth` of 0/1 outputs); they add no analysis edges and save validation checks the gate name and table shape. The SPDT changeover switch (common plus two throws, position `a`/`b`, toggled by clicking the part or the inspector) joins the common terminal to the chosen throw in both analysis engines; saves reject any position other than exactly `a` or `b`.
- **Embed controls:** the public song Play/Stop, simulation Power, and 3D-scan AR buttons share one primary-button treatment (accent fill, hover lift, focus ring, outlined while pressed); the song button now exposes `aria-pressed`.
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
- 🔶 Admin dialogs and writing-focus semantics (implemented; real-browser verification remains)
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
- 🔶 Worker Preview environment (D1/R2 separate from production and shared across Preview branches; branch Preview and runtime binding cleanup verified; authenticated/manual checks remain)
- 🔶 Preview deployments tied to the `production` branch (mapping and successful code build verified on 2026-09-27; authenticated flow checks are partial; full sitewide visual review remains)
- 🔶 Migration history (Wrangler tracks simulation publication; older manual schema changes are not reconstructed, and no broader migration inventory exists)
- 🔶 Staging content workflow (simulation drafts and publication are explicit; no general content-promotion workflow exists)

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
- Inventory historical manual schema changes before extending Wrangler migration coverage; keep `schema.sql`
  as bootstrap, not a repeatable migration.
- If the general media library expands beyond images, consider adding waveforms for its audio files.
- Extend TTS read-aloud to build journals if there is a clear use case.

## 4. Production migration state

- Production D1 `dominickdominick` has `media.private`, `width`, and `height` (verified read-only on 2026-09-28). Simulation publication migration `0001_simulation_publication.sql` has not been applied to Production. Inspect the exact live schema and get per-instance confirmation before any forward-only migration.
- Preview D1 `dominickdominick-preview` (`6b4b23d0-d680-4320-83c0-bc144f1cf3d9`) has migration `0001` applied and verified; Production was not changed.
- `schema.sql` is the base bootstrap and intentionally omits columns added by tracked migrations. Apply tracked migrations after an empty bootstrap. The migration directory does not reconstruct older manual schema changes. Never replay the full schema into an existing database; verify the exact database and schema before any forward-only change. Preview and Production D1/R2 remain separate. Production writes require per-instance confirmation.
- The homepage hero image `uploads/300679fa-5339-49cc-a839-9a3253031cb6.png` has an R2 object but no D1 media row or alt text. Recheck homepage delivery and the admin media listing; distinguish missing objects from missing metadata or query errors before cleanup. The earlier media-route HTTP 500 remains unverified.

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

- **Simulation Preview:** Authenticated browser checks exercised 15/30/45 breadboard sizes and rendered a 45-column board; the tested builder surface scored 8/10. Draft privacy, publish/direct-route behavior, the power control, draft-update isolation until republishing, unpublish hiding the route, and the Project → Related simulations picker (including its “Draft — hidden publicly” label and saved relation) were verified. The disposable Preview records were removed. Still open: edge-hole snapping/wires, resize cleanup, undo/redo, save/reopen, the page Simulation block selector, and a published project's public simulation embed.
- **Backups:** Verify a legacy backup restore and a new backup round trip containing both a published simulation and an explicit-NULL draft. Local compatibility regressions passed; this Preview browser round trip remains open.
- **Photo Editor:** Finish prompt submit/cancel, Escape/backdrop, and focus-return checks. Verify blank-image editor card centering and uploaded header-image dimensions before load.
- **Content/media:** Retest homepage image delivery and authenticated media metadata after the confirmed media migration. Resolve the homepage image's missing alt text before publishing affected content. The Production site has no articles, projects, simulations, or scans; do not add filler to check highlight.js, model-viewer, header sizing, or iPhone `.usdz` AR.
- **Other browser checks:** Confirm Web Speech read-aloud with installed voices, the live Worker's `0 8 * * *` backup schedule, and `sitemap.xml` in a browser. Preview Workers do not run Cron Triggers; never trigger a Production backup as Preview QA.
- **Environment and access:** The cloud browser cannot reach localhost, and Chromium installation failed under restricted egress. Hosted Cloudflare Preview browser testing did work. Temporary Preview-only QA secrets and the secret-bearing test deployments were removed after checks. Preview is otherwise public; never use Production secrets/data for Preview tests. See [Preview access control](https://developers.cloudflare.com/workers/previews/#access-control).

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
  a new format is introduced, such as DAW exports

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
- [ ] Color contrast checked for any new UI color, not just theme tokens

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
- 199. Reorder/duplicate tracks — array ops, duplicate-song pattern exists.
- 217. Reverse selected audio (requires imported/recorded audio buffers)
- 220. Remove DC offset (requires imported/recorded audio buffers)
- 276. Polarity inversion (requires stereo signal support)
- 277. Mono compatibility button (requires stereo signal support)
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
- 363. Deterministic runs/seeds — sim is deterministic already; add a seed field for future randomness.
- 389. Mechanical vs electrical distinction — already implicit; just surface it in UI.
- 409. Relays (SPDT changeover switch shipped; a relay still needs a coil model — the single-path DC solver can't express "coil current closes a contact" without feedback).
- 415. Current source — checked while implementing #416: doesn't fit this simulator's model as worded. This
  solver assumes constant-voltage sources and derives current via I=V/R; a true current source needs a different
  source model, which is outside the current simulator's scope.
- 431. Voltage meter (requires arbitrary-node voltage computation)
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

- External article/project header images have no persisted dimensions; decide between author-supplied dimensions and a fixed-ratio presentation before relying on remote covers. Current project-card blocks and article/project index cards are text-only and have no image layout shift.
- Print output on a dark-theme site with Site Settings colours: the Site Settings `:root` block outranks the print block's `--bg`/`--bg-elevated`/`--text`, so dark cards (the song embed's card in particular) print dark with their black titles nearly invisible when backgrounds print. Make the print variables win (scoped or `!important`) and re-check every module.
- Public logic-gate embeds show their truth table only in a hover title and screen-reader text; decide on a visible presentation for touch users (a small table under the circuit, or a tap-to-reveal).
- Give `.btn` and the linked project card the same `(hover: hover)` gate the embed controls have, so a tap on touch doesn't leave a lifted, glowing button; and finish the reduced-motion sweep the last critic listed: the skip link's slide, `@view-transition`, the simulation switch lever's transition, and the admin's `.theme-preset-btn:hover` lift and `.palette-btn:active` scale.
- Powered-set model: every node in the source's connected component counts as powered when the loop closes, so dead-end branches (the deselected throw of a changeover switch, an open plain switch's far side) animate and read powered; consider tracing only nodes on a current path. Related quirks: a reversed LED reads "healthy" beside "wired backwards", and a wire-and-switch dead short gives no warning.
- Simulation builder touch targets: at phone default zoom the 5px pin dots cover most small parts, so a tap on the centre of an SPDT or gate starts a wire instead of selecting/toggling; consider a bigger body hit area or a pin-hit-radius that shrinks with zoom. Also "Generate from current view" rasterises the builder SVG without its stylesheet, so parts come out black.
- Per-track clipping attribution (the other half of the old wishlist #309) needs per-track metering, which the single master analyser doesn't provide; only the master bus is logged today.
- Recheck homepage/gallery image paths in admin diagnostics after the media-schema migration; distinguish missing R2 objects from metadata or query errors before cleanup.

## 9. Current audit status

- The initial simulation source review scored 8/10; both findings were fixed. The three requested sequential critic passes scored 9/10, 8/10, and 8/10, with findings fixed between passes. Final re-review scored 9/10 with no actionable findings. Breadboard-size critic passes scored 9/10, 8/10, 9/10, and 9/10; the second-pass findings were fixed.
- Candidate-source checks passed: 66 server/security/SEO checks; 9 song save/race/waveform checks; modal-stack/accessibility checks; simulation save/open, publication, backup-compatibility, and bootstrap-migration regressions; JavaScript syntax; and `git diff --check`. Scratch regression scripts remain outside the repository. No CI run is claimed.
- Simulation rotate/flip (#373), critic pass 1: 8/10, no critical/high findings. Fixed in the follow-up: (1) the ammeter's live reading now turns with the part and sits beside the body at quarter turns instead of on the lead; (2) Flip is a true left/right mirror at every rotation (mirror toggles and rotation reverses); (3) printed labels rotate about their glyph centre so they stay centred; (4) focus returns to the activated Rotate/Flip button, and an orientation readout describes the group; (5) R/F ignore key repeat, contenteditable focus, and any dialog stacked above the builder; (6) a quarter turn keeps the part's visual centre (grid-snapped); (8) turning a plugged part reports how many leads it unplugged; (9) README corrected; (10) renderers accept only a numeric rotation and boolean mirror like the validators; (13) Flip has an explicit accessible name and the buttons declare key shortcuts; (14) multi-select inspector says rotate/flip is single-part; (11, partly) unused window export removed. Accepted residuals: (7) rotating can shrink canvas bounds and invalidate existing wire bends (save reports it; "Clear invalid bends" recovers); (11) orientation math and validation are still hand-duplicated between client and worker with no parity test in the repo; (12) part gradients rotate with the part; (15) backup-restored templates skip simulation validation (pre-existing; the builder validates on open); Teensy and potentiometer labels can overlap the body or overflow the narrower box at 90/270 degrees; a 90/270 part cannot seat two legs because its lead spacing (40 or 80 px) differs from the hole rows (30/34 px), so quarter turns always unplug.
- Simulation rotate/flip (#373), critic pass 2: 9/10, no critical/high. One new low-medium finding (grid-rounding the re-centring shift broke four-turn reversibility on grids of 10 or more) was fixed by using whole-pixel shifts only. Remaining nits, accepted: the readout reports the stored mirror-first state ("270° clockwise, flipped" after R then F) and is not `aria-live`; the side-anchored ammeter reading overhangs the box by about 25px at 90/270 and can be clipped near the canvas edge or crowd wires; `keepTextUpright` assumes a 10px font when the attribute is missing (the battery label is larger) and falls back to 0 for non-literal x/y; the two Rotate buttons differ visually only by a glyph.
- Song mute/hide (#198), critic pass 1: 7.5/10, no critical/high. Fixed in the follow-up: (1) drum rows overflowed at 1000-1200px, so rows now wrap up to 1200px, the step grid reserves the three 8px beat gaps (one per row on phones) so step 16 stays inside the panel padding, and the shared embed header wraps for long titles; (2) a collapsed row's "Hidden, muted / still plays" text now re-renders when its mute changes (drums and melody); (3) recording a note into a hidden melody re-expands the piano roll; (4) saved templates strip `muted`/`hidden`; (5) melody Mute/Hide are 28px (36px on phones) like the drum toggles; (7) the Normalize alert names muted parts it did not count; (8) pressed state adds shape cues (struck-through M, eye-off icon, "Muted"/"Hidden" wording); (11, partly) the orphaned `renderStepGrid` comment moved back next to its function. Accepted residuals: (3b) notes recorded into a muted melody are silent on playback (the Mute button shows why; live audition still sounds); (6) Undo/Redo re-render the grids and drop focus to the body (existing behaviour for step cells too); (9) muting cannot silence audio already inside the ~100ms scheduler lookahead or a decay tail; (10) muting a noise track shifts the seeded noise stream, so other tracks' waveform texture differs slightly from a cleared track (deterministic, cosmetic); (11) drum and melody flags use two small code paths and "Hidden, ..." wording is duplicated; (12) Hide is view state stored in song data, so toggling it marks the song dirty, autosaves, and ships `hidden` in the public `data-song`; Cover art also renders the audible mix only.
- Song mute/hide (#198), critic pass 2: 7.5/10, no critical/high. The first fix pass wrapped the piano roll at 861-1200px and roughly doubled its height, so the wrap is now scoped: drum rows wrap up to 1200px, the piano roll wraps up to 960px (below which it no longer fits), and `#song-sequencer` alone gets the 900px max width. Also fixed: melody pills' accessible names contain their visible word when pressed (WCAG 2.5.3) and pills keep one width; unbroken long titles wrap in the public embed header; auto-revealing a hidden melody while recording now always schedules an autosave. Accepted residuals: in a few narrow bands step 16 spills past the panel edge because step tracks cannot shrink below 32px (the old CSS spilled further there): roughly 320-330px (up to 11px of horizontal scroll), 641-647px (up to 7px of scroll), exactly 861px (1px), and a spill into the padding with no scroll at 331-351px, 648-672px, 862-885px, and for the piano roll about 981-1101px; melody pills sit beside smaller Oct/arrow pills.
- Song mute/hide (#198), critic pass 3: 9/10, no critical/high; all pass-2 findings verified fixed. Remaining low/nit items are the band notes above; the melody pills' accessible name changes with state ("Mute melody" / "Muted melody") alongside `aria-pressed`, a deliberate trade for WCAG 2.5.3 label-in-name; and the 28px melody pills next to the 21px Oct/arrow pills.
- Scratch regression scripts known stale (they fail identically on the baseline, so are not regressions; refresh or retire them): simulation checkpoints, ghost-wires, poster, snap-click-bug (counts zero-length auto-wires), toolbar-grid (label list), comment-tooltip (never publishes its simulation), song autosave and undo-critic scripts (stacked Songs dialog intercepts clicks), and several older scripts that launch Chromium without an explicit executable path.
- Photo editor Straighten (#93), critic pass 1: 7/10, no critical/high. Pixel sweeps (901 angles x 12 sizes, plus the 2000px cap sizes) found no non-opaque pixels and the sign convention, undo/redo, Compare, resize and snapshot paths were clean. Fixed in the follow-up: (1) the tilt preview is now an exclusive mode: a crop drag, brush press, shape/text/eyedropper press, adjust slider, or Compare cancels it, brush hover no longer wipes it, and moving the slider discards a pending crop selection, so Apply Crop and Straighten are never both pending; (3) the opaque preview can no longer hide live adjust/text/stroke edits for the same reason; (4) focus moves to the slider after applying; (5) the slider has `aria-valuetext`, the noisy live `<output>` was replaced by a labelled number field, and Escape resets a tilt in progress instead of closing the editor; (6) that number field allows exact tilts (0.1 degree) that the slider track cannot; (7) images too thin to keep a usable crop at an angle disable Straighten and say why; (8) the crop is derived from one scale so the aspect ratio is preserved; (9) renamed the confusing context variable. Accepted residuals: the preview redraws at full resolution on every input without rAF coalescing (26 ms median at 2000x2000); Straighten is not in the Ctrl+K palette; the Straighten group sits deep in the horizontally scrolling toolbar at phone widths like its neighbours.
- Photo editor Straighten (#93), critic pass 2: 8.5/10, no critical/high. Fixed in the follow-up: Ctrl+Z/Y now reach the editor while a range slider has focus (they were swallowed right after Straighten moved focus to the slider); typing 0 or double-clicking the slider no longer wipes a pending crop overlay; Escape resets a tilt in progress from anywhere in the dialog (document-level handler) instead of closing the editor; a tilt cannot be started mid-stroke or during Compare; crops under 8px a side count as too thin (and the crop height is rounded, not floored, so strips no longer drift 30%), with the button's title and `aria-describedby` explaining why on narrow toolbars. Accepted residuals: aspect drift is under 0.4% for photo-sized images but up to about 2% under 100px; tabbing out of an emptied number field can drop focus to the page because the button it was moving to just disabled.
- Photo editor Straighten (#93), critic pass 3: 9/10, no critical/high; pass-2 findings verified fixed. Follow-ups applied: the "too thin" description is attached to the button only while it applies (a static reference read a false reason on a working button), the crop derives from the limiting side so thin banners drift less, and the Ctrl+Z/Y exemption is scoped to the tilt slider only. Accepted nits: 100px-or-smaller images can still drift about 1-2% and thin banners more (a 1200x60 banner about 12%, refused below 8px a side); "at this angle" is loose wording for images too thin at every angle; the too-thin note sits off-screen in the phone toolbar (the button title carries it).
- Song clipping history (#309), critic pass 1: 6.5/10, no critical/high. Detection, no-dirty-state, no-undo-entry, rapid Play/Stop, cross-song isolation, and layout checks were clean. Fixed in the follow-up: (1) "near step" now uses audio time (the latest scheduled step whose time has passed) instead of schedule time, so it stays right at 160-240 BPM; (2) events split after a 120 ms gap or 2 s, and long ones show their duration, so repeated clipping is no longer one merged entry; (3) the red summary uses the theme's `--error-text` token (passes contrast in light and dark); (4) the panel note no longer promises Normalize clears it (one seeded pass can still be exceeded by random noise); (5) the list is newest first, drops the competing numbered markers, and says when older entries were dropped past the 50 cap; (6) Clear moves focus to the summary; (7) a hidden live region announces "Clipped N times so far" (throttled); (8) the panel re-renders only when an entry's text changes instead of every frame; the export report carries the clip count. Per-track attribution stays a logged follow-up. Accepted residuals: the meter is rAF-driven, so a backgrounded tab or a long main-thread stall can miss, split, or even double clips (the merge gap stretches with slow frames, which softens but doesn't remove this); the log is per open session (reopening the same song clears it) and a note already inside the scheduler lookahead can still log just after Stop; the meter turns red from 98% while the log needs 100%; the panel's HTML shipped in the preceding Photo-editor commit by a staging slip.
- Simulation capacitor/inductor (#403-405), critic pass 1: 8/10, no critical/high. Parity was exact (13 part types, 4 rotations, hostile values, about 6000 random circuits), nothing was unsafe, and snapping, rotate/re-seat, undo, publish, palette search, and both themes behaved. Fixed in the follow-up: (1) the README and inspector call the model steady-state and name the Wall Outlet as a steady source (it is AC mains, but treated as a constant source like every other); (2) the inductor text says only the series path is analysed, so a parallel inductor doesn't short its neighbour (an existing solver limitation, now stated); (3) value labels sit beside the body at 90/270 degrees instead of on it; (4) capacitor and inductor leads use a solid stroke (a bounding-box gradient paints nothing on a zero-height line); (5) a blank, zero or negative entry is ignored and the stored value shown again, and tiny positive values clamp to the field minimum instead of jumping to a default; (6) the helpers clamp to 1 pF / 1 nH and the units gain pF/nH/F; (7) unit choice happens after rounding (999.999 uF reads 1 mF); (8) the accessible summary no longer truncates to three significant figures and pluralises "ohms"; (9) tabbing out of an edited field keeps focus (the refresh restores it); (10) both parts get a transparent hit rect so they can be clicked across their box; unused window exports removed and the ammeter comment reattached. Accepted residuals: the resistor, switch and ammeter leads have the same invisible-gradient problem (pre-existing, left as is); value labels are tiny at the default zoom like existing labels; parallel branches and general networks aren't solved; the defaults (100, 10, 1), the 1e9 cap and the minimums are repeated in the helpers, the change handler, palette defaults and HTML attributes; a capacitor bridged across a live net still shows the generic "Part of a complete circuit" status beside its open-circuit note; the 1 ohm default winding resistance is optimistic for 10 mH; the parity harness is scratch-only, not a committed test; an unrelated Photo-editor accessibility edit rode along in the same commit.
- Song clipping history (#309), critic pass 2: 8.5/10, no critical/high. Step attribution, merge/split, contrast, cap-of-50, focus and render cost were verified fixed. Follow-ups applied: Clear keeps the scheduled-step queue so a clip already inside the lookahead still names the right step; the merge gap stretches with slow frames (the larger of 120 ms and three frame intervals); the first clip of a run is announced at once and later ones at most every 2 s; entries that span several steps read "from step A to B". Accepted: the meter is frame-driven, so a backgrounded tab can still miss, split, or double clips.
- Simulation capacitor/inductor (#403-405), critic pass 2: 8.5/10, no critical/high. Parity (4000 random circuits, 14 rotation values, hostile values), labels, leads, formatting, input handling, and undo/redo with the deferred refresh were verified. Follow-ups applied: refocusing after a refresh selects the field's text so typing replaces it (digits used to prepend to the old value); the refresh no longer replaces the inspector while a button is under the pointer (a slow click right after typing was swallowed); re-entering the stored value adds no history entry; the transparent hit areas shrank (32x24 and 64x24) so wires passing beside a part stay clickable. Accepted: extreme values still print large units ("1000F") that overflow the part; resistor/switch/ammeter leads remain invisible (pre-existing), so they look unlike the new parts; a slow click on an inspector button right after typing was a pre-existing problem for the resistor field, which still refreshes synchronously.
- Song clipping history (#309), critic pass 3: 9/10, no critical/high; all pass-2 items verified fixed. Accepted nits: an event lasting exactly a whole number of loops can read "near step N" because its start and end steps match; the step-range text roughly doubles a sustained clip's re-render rate (about 11 to 23 renders/s, still cheap). A main-thread stall of 130 ms or more still splits a clip, which is correct because the scheduler runs on that thread and the audio really drops out.
- Simulation capacitor/inductor (#403-405), critic pass 3: 9/10, no critical/high/medium; all pass-2 items verified fixed (typing after Tab, slow clicks after typing, no-op history, wire clickability, parity). Accepted nits: label rounding at extremes ("1µF" for 0.999 µF, "1000F" for enormous values); resistor/switch/ammeter leads stay invisible (pre-existing); an inspector field can briefly show a clamped or blank value while a button is mid-click, until that button's own re-render.
- Embed controls (#531), critic pass 1: 8/10, no critical/high. Style consistency across the three buttons, contrast on every song theme in both modes, AR-slot placement, layout, and removed-rule coverage were verified. Fixed in the follow-up: (1) the song and simulation buttons' labels name the action ("Play"/"Stop", "Power on"/"Power off") and no longer also carry `aria-pressed` (state was announced twice); the song button's accessible name includes its title ("Play <song>"), and its glyph is `aria-hidden` with U+FE0E so it renders as text, not colour emoji; (3) the hover lift and transitions only run when motion isn't reduced (OS setting or the site's manual switch) while the glow stays; (4) print sets `--on-accent` so the black print pill has a white label; (5) hover styles only apply on hover-capable devices, so a tap no longer leaves a sticky lift; (6) forced-colors mode gets a dashed border on the active state as a shape cue; (7) coarse pointers get 44px-tall targets; font size matches `.btn` (0.95rem). Accepted: `.btn` itself still lifts under reduced motion (a follow-up to scope it the same way); the AR button's no-wrap width can overflow a viewer narrower than about 185px; the simulation button's `margin-top` stacks with its wrapper's gap (pre-existing); the shared rule mirrors `.btn`'s properties rather than sharing its selector list, because `.btn` also sets layout properties these don't want.
- Simulation logic gates (#441, #445), critic pass 1: 8/10, no critical/high. Parity of the gate helpers between client and worker, validation, truth-table edits, rotate/flip, public rendering and the accessible summary were checked. Fixed in the follow-up: (1) changing the gate in the inspector keeps focus on the Gate select; (2) the public summary now spells out which input combination each custom output belongs to ("output for inputs A,B of 00, 01, 10, 11 is ...") and the canvas tooltip includes the same summary; (3) the custom-table marker moved from a text caption (which collided with labels at quarter turns) to a dashed outline; (4) canvas search matches the gate name ("inverter", "nand") as well as the label; (5) truth-table buttons no longer encode the value twice (`aria-pressed` plus the value in the name); (6) Arrow keys and Backspace on a focused truth-table button no longer nudge or delete the part; (7) switching between gates with the same number of inputs keeps a custom table, and the field's tooltip says a different input count resets it; (8) nits: "Diagram part:" wording no longer repeats, the Reset button has bottom margin, light-theme leads use the solid grey stroke, and the truth-row and validation logic reuse the shared helpers instead of a third copy. Accepted residuals: gates are diagram-only (signals are not simulated); the 1-input gates (NOT, buffer) share a two-row table with no separate name for a custom one; the standard-table check is computed per render; the hand-mirrored client and worker helpers still have no committed parity test (scratch only).
- Embed controls (#531), critic pass 2: 8.5/10, no critical/high. Verified fixed: action-named labels with no `aria-pressed` (the song button's name flips "Play <title>"/"Stop <title>" with focus kept), reduced-motion and manual-switch lift removal, no sticky hover on touch, 44px coarse targets, identical font/radius/padding on all three buttons across five themes in both modes, and no regressions to the bars, waveform, pulse, page-sync or the AR slot. Findings and follow-ups: (1) low, a regression from pass 1 -- print set `--on-accent:#fff` but themed songs kept a bright accent, so their pill printed white on pale (1.3-3.5:1 on sunset/ocean/mono/neon); themed embeds now print with `--accent:#000` (marked `!important` so it also beats the light-theme accent rules), and the test covers all five themes on both site themes; (2) low, forced-colors mode grew the button by 2px in height when it toggled (1px to 2px border); the active padding now gives back the extra border width, so the height no longer moves; (3) nit, the site's manual reduce-motion switch still faded the glow and colour, so it now sets `transition:none` on the three controls; (4) nit, unverified (no real screen readers here): with `aria-pressed` gone, state feedback depends on the focused button's accessible name changing, and some screen readers announce that unreliably. Accepted, not built: a visually hidden `role="status"` would re-introduce the double announcement that pass 1 removed; revisit if a real screen-reader pass reports silence; (5) nit, `.btn`'s own reduced-motion gap is already tracked in the follow-ups above.
- Embed controls (#531), critic pass 3: 7.5/10, no critical/high. Manual reduce-motion (0s transition however it is set), forced-colors size stability (0.00px height change across regular, compact, roomy, bold and 0px-border presets in both themes; the remaining width change is only the label text), and every earlier check were verified with no regressions. One medium regression in the pass-2 print fix: the Site Settings inline `:root{--on-accent}` outranks the print block's `--on-accent:#fff`, so themed songs (now `--accent:#000`) printed dark text on black (1.07:1) whenever Site Settings emit a colour, as this dev site does. Nit: with the light theme, the default and simulation buttons still printed orange while themed songs printed black. Fixed in the follow-up by setting `--accent:#000; --on-accent:#fff` on the three controls themselves in the print block, so nothing above them (theme classes, the light theme, Site Settings) can change a print pill; all seven controls now print 21:1 in both themes with and without Site Settings, and the test covers those cases. Still accepted: no live announcement (unverifiable without a real screen reader; a hidden `role="status"` would re-add the double announcement); `.btn`'s own reduced-motion gap stays a tracked follow-up.
- Simulation logic gates (#441, #445), critic pass 2: 8.5/10, no critical/high. Parity (13,125 definition and SVG cases, 4,000 random circuits, 702 validator combinations), ingress rejection, gate-select focus, the public summary, the dashed marker's placement at quarter turns, toggle names, key handling on the toggles, same-arity table keeping and the nits from pass 1 were verified. Not delivered in pass 1 or only partly, now fixed: (1) medium, the dashed cue was weak on the dark canvas (a `#555` dash at 2.45:1), so a custom outline is now dashed, heavier and accent-coloured; (2) canvas search for "inverter" matched nothing (the earlier note overstated it), so the canvas haystack now includes the gate key and a small alias map (not = inverter, buffer = non-inverting); (3) the Reset button still let arrow keys nudge and Backspace delete the part, so it is exempt like the toggles; (4) the "light-theme lead contrast" fix in the pass-1 note was not actually made -- the gate, capacitor and inductor leads were a fixed grey at 2.3:1 on light, and now use the theme's `--text-dim` on both themes; (5) editing a table to equal another gate's standard table and then switching to that gate left a stale `truth` that reappeared as custom after the next switch, so the change handler drops a table that equals the new gate's standard one; (7) pressed meaning: the table is now described by the note "a pressed output button means the gate outputs 1"; nits: the hover title drops a label that only repeats the gate name (shared `logicGateTitle` helper, client and worker), the Label field caption mentions the added truth table, and the screen-reader sentence reads "with inputs A,B, 00 gives 1, 01 gives 0, ...". Accepted residual: (6) sighted touch users still cannot see a gate's truth table on the public embed (it lives in the hover title and the screen-reader text); a visible table or tap-to-reveal needs a presentation decision and is logged as a follow-up; the committed client/worker parity test remains scratch-only.
- Embed controls (#531), critic pass 4: 8/10, no critical/high. The pass-3 print fix was verified (computed 21:1 for all seven controls on both page themes, with and without the Site Settings `<style>`; screen behaviour unchanged). New low print findings from real PDFs, now fixed: (1) the black pill lost its fill with "background graphics" off (white label on white paper, about 2.8:1), so the pills carry `print-color-adjust: exact`; (2) the pressed state's `color: var(--text)` lost to the Site Settings `:root` (1.1:1 on a powered-on sim button), so `--text:#000` is also set on the buttons in print; (4) nit, the AR button is an inert black pill on paper, so it is hidden in print. Accepted nit (3), not from this change: with Site Settings present and backgrounds on, the dark theme prints a dark song card with its black title nearly invisible because the Site Settings `--bg-elevated`/`--text` outrank the print variables (logged as a follow-up below).
- Embed controls (#531), critic pass 5: 9/10, no critical/high; all pass-4 fixes verified in 16 real PDFs (dark/light page x Site Settings present/stripped x backgrounds on/off x idle/active): idle pills print black with a white label at 21:1 even with backgrounds off, pressed pills print black on transparent at 21:1, the AR button is absent from print, and screen appearance, behaviour, reduced motion and the AR slot are unchanged. Remaining findings, all accepted: (1) low, an edge case rooted in the Site Settings print follow-up above -- on a dark page with Site Settings colours, backgrounds on and a song playing, the song card prints dark and the black "Stop" label lands on it at 1.2:1 (its own black title is equally unreadable there, and the card is already broken in that combination; with backgrounds off or on a light page it is 16.9-21:1); (2) nit, that same follow-up (a `.song-embed` print rule setting `--bg-elevated`, `--text` and `--border` would clear findings 1 and 3 and the title); (3) nit, in that combination the black idle pill's edge is invisible on the dark card while its label stays readable; (4) no live announcement (unverifiable without a real screen reader); (5) `.btn`'s own reduced-motion gap stays a tracked follow-up.
- Simulation logic gates (#441, #445), critic pass 3: 9/10, no critical/high. Parity (the shared `logicGateTitle` across 2,436 gate x label x truth cases, the 13,125 definition/SVG cases, 4,000 random circuits, 702 validator combinations), the accent dashed cue (8.30:1 dark, 4.36:1 light), search aliases, Reset key handling, theme-ink leads (6.75:1 dark, 7.03:1 light), the stale-table fix and the screen-reader wording were verified. Fixed after the review because they were plainly right and cheap: (1) the Label caption's "logic gates add their truth table" suffix appeared on every part, so it now shows only on gates; (3) the XOR/XNOR second arc was a `#555` stroke at 2.44:1 on the dark canvas and now uses `--text-dim`; (5) the palette's default "Logic Gate" label repeated the gate name in the hover title, so it is dropped like "AND" and "AND gate". Accepted: (2) the custom outline is a dashed accent shape like the selection box, so a selected custom gate shows two nested dashed shapes (the box sits 4px out and the two are distinguishable; a different marker would weaken the cue); (4) pre-existing: the canvas key guard is a whitelist (toggles and Reset), so arrows and Backspace on the inspector's Rotate/Flip/Duplicate buttons still nudge or delete the part -- kept because those buttons advertise the R/F shortcuts, follow-up if a broader rule is wanted; (6) a non-string label is dropped from a gate's title and `logicGateTitle(null)` throws (neither reachable from validated data or the UI); (7) the public screen-reader text still says "Logic Gate labeled Logic Gate, AND gate" (the existing `describeComponent` pattern); (8) deferred: a visible truth table for touch users on the public embed (follow-up above).
- Public button/card reduced-motion scoping (the old `.btn` follow-up), critic review: 9/10, no critical/high. An A/B against the previous stylesheet (OS no-preference/reduce x manual switch on/off x dark/light, on synthetic pages and the real `/` and `/components`) found no-preference behaviour byte-identical, the lift and transform transitions gone under OS or manual reduce with the glow kept, correct specificity for `.btn-link`, `.btn-secondary` and the manual overrides, and the embed controls untouched. Findings: (1) low, pre-existing: `.btn` and the linked project card have no `(hover: hover)` gate, so the lift and glow stick after a tap on touch (the embed controls have it) -- logged as a follow-up below, so the old follow-up is only partly closed; (2) medium, pre-existing and outside the diff: `html { scroll-behavior: smooth }` was unconditional, so reduced-motion visitors still got smooth scrolling and the note near the deep-link highlight was false -- fixed in the next commit (smooth only under no-preference and not under `data-motion="reduce"`; the test covers OS reduce, manual reduce and back); (3) nit, the commit message said "fade" but `.btn` drops every fade while the project card keeps its border-colour fade (colour is not motion, kept; wording only); (4) nit, the card's `border-color` transition is repeated in the base and the media rule, and only the `.btn` block is commented; (5) nit, that commit also removed the old follow-up line from this file without saying so; (6) by design, the per-block hover effects (`.block-hover-lift`/`-glow`) and `.btn`'s glow follow different reduced-motion rules; (7) nit, `.reaction-btn` declares a transform transition nothing ever triggers; (8) other unguarded motion found by reading, not tested: `@view-transition { navigation: auto }`, the skip link's `top` slide, the simulation switch lever's `all 0.2s`; (9) the admin has the same gap in `.theme-preset-btn:hover` (lift) and `.palette-btn:active` (scale); (10) the repo has no committed tests, so none of this is regression-protected. The critic's synthetic page left three local `activity_log` rows (ids 6051-6053, "QQbtn hover test"); the local dev database only.
- Simulation SPDT changeover switch (#409, relay still open), critic pass 1: 8.5/10, no critical/high, no functional bug. Verified: client/worker parity (1,035 definition combos; 46,000 random circuits, 27,351 containing an SPDT, 0 mismatches; an independent oracle that rewrites each SPDT as a plain switch plus a dummy part also matched), the two-load, dangling-throw, two-SPDT staircase (3-way), ammeter/LED and polarity-reverse cases, palette placement, click and select toggling with undo/redo, rotate/flip with wires, duplicate/delete/multi-select, save/reopen/checkpoint/template/publish/backup, public rendering, hostile position values and ingress of unknown pins. Fixed in the follow-up: (M2) the public summary said "throw B pin a"; pins now carry labels (Common, Throw A, Throw B) and the summary reads "...common terminal connected to throw B, common pin...", "throw A pin"; (M3) each terminal has a hover title in the builder, and the inspector's Position options say which side each throw is on right now ("A — upper terminal", "B — right terminal" after a turn) instead of a fixed upper/lower that stopped applying after rotation; (L1, L2) `position` is now validated server-side and in the builder's mirror (exactly "a" or "b"; "B", null, numbers, objects and strings are rejected with 400), while the renderers stay lenient; (L5) the pointer cursor on switches applies only inside the builder, not on the view-only public embed (the plain switch too); (L6) the inspector and README say the SPDT doesn't snap into breadboard holes; (L7) the Position select is described by the effect text, its label has a tooltip, and options start with the throw letter so type-ahead works; (N1) the effect text no longer repeats itself; (N2) palette search finds "three-way", "3 way" and "change over"; (N5) the throws moved to y=10/30 so pins sit on the 5px grid. Accepted or logged as follow-ups: (M1) the powered set treats the whole connected component as powered, so the deselected branch's wires animate and its resistor reads powered on the two-load changeover demo (a plain open switch behaves the same; fixing it means changing the powered-set model for every part); (M4) at phone default zoom (about 50%) the three 5px pin dots leave about a 12px strip of body, so a tap on the centre starts a wire instead of toggling (150% zoom works; all parts share the pin size); (L3) "Generate from current view" rasterises the SVG without the stylesheet, so CSS-styled parts (every part) come out black, existing bug; (L4) a plain click on an SPDT both selects and flips it (like the plain switch), and after Undo/Redo the selection is cleared so the next click flips it again (Shift+click or rubber-band selects without flipping); (N3) the default label repeats the part name in the summary ("SPDT Switch labeled SPDT Switch", the "Battery labeled Battery" pattern); (N4) pin dots hide the lead stubs in the builder; (N6) the lever transition never runs because the builder redraws on every toggle; (N7) an SPDT reads "Part of a complete circuit" when only its inactive throw sits on a powered net (`anyPinPowered`); (N8) existing analysis quirks the SPDT exposes: a reversed LED shows "healthy 14.9 mA" beside "wired backwards", and a bare wire-and-switch dead short gets no warning.
- Simulation SPDT changeover switch (#409, relay still open), critic pass 2: 9/10, no critical/high/medium. Every pass-1 fix was re-verified (labels and summary wording in the public page, pin titles and side-aware Position options across all 8 orientations, strict `position` validation on POST/PATCH/checkpoint/template/backup import and the client mirror, pointer cursor scoping, breadboard note, select accessibility, palette keywords, grid-aligned pins); parity was unchanged (1,035 definition combos, 46,000 random circuits, oracle 0 mismatches; 3,000 non-SPDT circuits and 210 other-part definition cases identical to the parent). New findings, all accepted: (LP2a) low, a stored simulation that already holds an invalid `position` (only possible from hand-edited data before this commit) can't be opened, saved, published or duplicated and has no in-UI repair, the same policy as the logic-gate fields, and nothing is in production; (N-P2a) nit, with the finer 20-unit throw spacing the coarse-pointer pin radius (10 units) makes the Throw A/B touch dots exactly tangent (desktop dots keep a 4.8-15px gap); (N-P2b) nit, the summary is a comma run-on ("...connected to throw B, throw A pin connects to...") that can be misheard; (N-P2c) nit, the inspector's "Hover a terminal" tip means nothing on touch and the drawing has no COM/A/B text, so touch users learn the terminals from the Position options; (N-P2d) nit, "Throw A" in titles and the effect text vs "A — upper terminal" in the options; (N-P2e) the module blurb didn't mention position validation (fixed here). Confirmed unchanged and already logged: M1, M4, L3, L4, N3, N4, N6, N7, N8.
- Authenticated Preview QA is recorded in section 6. The candidate is on `production`; `main` remains unchanged. Remaining manual gates and Production D1 schema/migration inspection block promotion. Recheck both refs before any move; promote only as a clean fast-forward and never force-push.

## 10. Open decisions

- Whether to replace the legacy violet border.
- Built-in routes take precedence over CMS slugs `projects` and `random`.
