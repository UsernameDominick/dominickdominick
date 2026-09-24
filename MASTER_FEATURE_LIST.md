# dominickdominick.com — Master Feature List (status)

This is the living tracking file for the master feature list. Update it
whenever a batch ships so status survives context resets/new sessions —
check it at the start of a work session instead of re-deriving status from
memory or git log archaeology.

**Legend:** ✅ done · 🔶 partial (some of the bullet is done, noted inline) · ☐ not started

Last updated: 2026-09-24, after a security/SEO/accessibility/layout
health-check pass on everything through the Projects/build-journals/BOM/
relationships batch. That batch is now **live on `main`** — production D1
was fully migrated to match `schema.sql` first (see `PRODUCTION_TODO.md`
for that history and any other manual/human-only items). Work continues
on the `production` branch from here.

**Overnight session (still 2026-09-24), working through the list solo per
your go-ahead** — seven batches, each committed and pushed to
`production` separately, each tested with Playwright before committing:
media captions/credits/licensing + unused-file review + bulk move/tag
(section 12); text/border color + heading-font tokens with a live
contrast checker (section 3); project reading time + per-type/tag RSS
feeds + a random-page button (sections 10/18); topic browsing at
`/topics` (section 18) — which also fixed a real bug where a project's
tag chips linked to the article-only index and showed nothing; project
share previews + a site-wide SEO report (section 21); a keyboard
shortcuts reference modal (section 24). One schema change is queued
(`media.caption/credit/license`, not yet applied to production — see
`PRODUCTION_TODO.md`). Everything else needed no schema change.

---

## 1. Existing foundation

All ✅ — the original ~70-item backlog plus a security/SEO/accessibility
health-check pass, done before this master list existed.

## 2. Page builder and layout

- ✅ Reusable blocks that update everywhere they are used
- ✅ Option to detach a reusable block for independent editing
- ☐ Reusable sections containing multiple blocks (needs nested/grouped blocks — see below)
- ✅ Page templates for projects, articles, galleries, and landing pages (generic — any page can be saved/applied as a template, not type-restricted)
- ✅ Save existing pages or sections as templates (pages yes; a single block/section on its own, no)
- ☐ Custom components assembled from blocks, with their own editable options
- ☐ Visual header and footer editor (footer is a text field; header nav is basic ordering, not visual)
- 🔶 Navigation editor with nested menus, ordering, and visibility controls (ordering ✅, nested/dropdown menus ☐)
- ☐ Separate desktop, tablet, and phone layout settings (deliberately deferred — needs schema change + reworked drag/resize)
- 🔶 Per-device spacing, ordering, and visibility (visibility ✅ desktop-only/mobile-only; spacing/ordering ☐)
- 🔶 Custom breakpoint controls and breakpoint previews (breakpoint previews ✅ via responsive preview modal; custom breakpoint values ☐, fixed at 640px)
- ✅ Fullscreen canvas editing (Focus mode)
- ✅ Layers panel showing block hierarchy and nesting (no real nesting exists yet, so it's a flat list)
- ☐ Block grouping and ungrouping
- ✅ Multi-select and bulk styling
- ✅ Alignment and distribution tools
- ✅ Lock blocks or sections against accidental changes
- 🔶 Guides, rulers, snapping controls, and spacing measurements (alignment guides + grid snapping ✅; literal ruler UI and hover-to-see-gap measurements ☐)
- ☐ Nested sections and columns (biggest deliberately-deferred item — needs `blocks.parent_id` + reworked drag/resize/overlap logic)
- ✅ Tabs, accordions, cards, and expandable sections
- ✅ Sticky and fixed-position elements
- 🔶 Background video, gradients, overlays, and blend modes (video/overlays/blend-modes ✅; gradients ☐)
- 🔶 Entrance, scroll, and hover animation controls (entrance/scroll ✅; hover-triggered animation controls ☐)
- ✅ Reduced-motion alternatives
- 🔶 Shapes, dividers, and masks (dividers ✅ pre-existing; shapes/masks ☐)
- 🔶 Interactive previews of hover, focus, and mobile states (mobile-state preview ✅ via responsive preview modal; simulated hover/focus states ☐)
- 🔶 Copy/paste blocks and sections between pages (blocks ✅; "sections" n/a, no section concept yet)
- ☐ Bulk updates to pages using the same template
- 🔶 Conditional display based on date, device, URL, or content fields (device ✅; date/URL/content-field ☐)
- ✅ Layout diagnostics for overflow, overlap, and small tap targets (overlap is structurally impossible so isn't checked — flagged in the UI's own hint text)
- ✅ Content-only editing mode that locks the layout
- ✅ Isolation mode for editing one section at a time
- ✅ Stress previews using long titles, missing images, and large amounts of text

## 3. Design system and styling

- 🔶 Global tokens for colors, typography, spacing, borders, and shadows (accent/bg/text/border colors + body/heading fonts are now admin-configurable, 6 tokens; spacing and shadow tokens deferred — no existing hook to build them on safely without a larger, riskier retrofit of scattered magic numbers, see PRODUCTION_TODO.md)
- ☐ Per-page overrides of global styles
- ☐ Upload and manage custom fonts
- ✅ Light and dark site themes
- ✅ Visitor theme switcher
- ☐ Presets for buttons, cards, callouts, and image treatments
- ☐ Visual CSS inspector
- ☐ Style inheritance inspector showing where each setting comes from
- 🔶 Reset individual overrides to inherited values (per-field "Clear" buttons on color pickers exist; no general reset-to-inherited concept)
- ☐ Page-specific CSS and JavaScript controls (custom head code is site-wide only)
- ☐ Preview custom styles and scripts before publishing
- ☐ Site-wide review of pages affected by a design change

## 4. Content modeling and dynamic display

- 🔶 Custom content types defined through admin (Projects added as a dedicated hard-coded type; not a no-code admin-defined arbitrary-schema system — deliberate scope call, see PRODUCTION_TODO.md)
- ☐ Custom fields for each content type
- 🔶 Relationships between projects, articles, media, simulations, and scans (done for projects→articles/simulations/scans; one-directional, not every pair)
- ☐ Edit relationships from either connected item (currently project-side only)
- ☐ Nested categories (flat tags only)
- ✅ Series and collections (series — pre-existing; "collections" generically ☐)
- ☐ Manual collections
- ☐ Automatic collections populated by rules
- ✅ Featured and pinned content (articles have both; projects have featured only)
- ☐ Centrally managed option lists for statuses, tools, and categories (free text only)
- ☐ Required fields and field validation (beyond basic required-title)
- ✅ Computed fields, such as project age or total build cost (BOM total build cost)
- ☐ Bind block content to fields automatically
- 🔶 Repeating layouts: design a card once and populate it with a collection (this is what article-list/project-list blocks already do)
- 🔶 Visual query builder with filters, sorting, and item limits (article-list/project-list have a limit + tag/featured filter form, not a full visual query builder)
- 🔶 Display templates for cards, lists, detail pages, and search results (fixed templates exist; not admin-customizable)
- ☐ Conditional sections based on available content
- ✅ Missing-field fallbacks (empty-hint messages throughout)
- 🔶 Editable empty states (empty states exist; text is hard-coded, not admin-editable)
- ☐ Pagination, "load more," and infinite-scroll options
- ☐ Breadcrumb editor (a fixed breadcrumb JSON-LD exists for articles; not an editable UI)
- 🔶 Related-content suggestions with manual overrides (automatic tag-based suggestions ✅ for articles+projects; manual override ☐)
- ☐ Rules engine for display and content behavior
- ☐ Workflow builder for creation, publishing, changes, and archiving

## 5. Writing and article editor

- ✅ Automatic table of contents
- ✅ Automatic heading anchors
- ✅ Footnotes and citations
- ✅ Tables in text blocks (pipe tables)
- ✅ Code syntax highlighting (highlight.js)
- ☐ Code line numbers and copy buttons
- ☐ Callouts and warnings
- ✅ Expandable details (the accordion block)
- ☐ Side-by-side text and image layouts (possible manually via the page builder grid; not a distinct article-editor feature)
- ✅ Inline image captions and credits (image block has its own caption/credit fields, rendered as a figcaption; see section 12)
- ☐ Before/after image comparison slider
- 🔶 Pull quotes and margin notes (quote block ✅; margin notes ☐)
- ☐ Mathematical notation
- ✅ Generalized embeds with consistent controls and fallbacks (CodePen/Spotify/Figma/CodeSandbox/Gist + raw-iframe fallback)
- ☐ Internal-link suggestions while writing
- 🔶 Broken-link warnings inside the editor (site-wide on-demand Link Checker ✅; live inline warnings while typing ☐)
- ☐ Readability information
- ☐ Word and character goals (word count shown; no goal-setting)
- ☐ Distraction-free writing mode (page-builder Focus mode exists for the canvas; nothing equivalent for the article textarea)
- ☐ Markdown import/export (body already IS markdown-lite, but no file import/export UI)
- ☐ Paste cleanup from documents and websites
- ✅ Find and replace within an article (via the site-wide Find & Replace tool)
- ☐ Private notes and comments on draft sections
- ☐ Reader-facing update history
- ☐ Correction and update notices
- 🔶 Custom article endings with related content and project links (automatic related-articles section exists; not admin-curated, no project links)

## 6. Saving, recovery, and versioning

- ✅ Autosave with visible save status
- 🔶 Offline draft recovery and later synchronization (local crash-recovery drafts via localStorage ✅; true offline/service-worker sync ☐)
- ✅ Conflict detection across devices, tabs, and editing sessions
- ☐ Compare conflicting versions before resolving them (conflict just prompts "reload to see latest," no side-by-side compare)
- ✅ Crash recovery for unsaved content and editor state
- ✅ Unsaved-change protection (beforeunload guard)
- ✅ Descriptive undo history (revision labels)
- ✅ Side-by-side text revision diffs
- ✅ Visual layout revision diffs
- 🔶 Restore individual fields, blocks, pages, articles, or media (whole-item and per-block restore ✅; field-level restore and media revisions ☐)
- ✅ Trash and soft-delete (pages, articles, projects)
- ✅ Activity log showing who changed what and when
- ☐ Separate working revisions of already-published content (editing a published item edits it directly; no draft-vs-live split)
- ✅ Content freeze to protect finished items from bulk edits (locking)

## 7. Publishing workflow

- 🔶 Clear draft, scheduled, published, hidden, and archived states (draft/scheduled/published ✅; explicit "hidden"/"archived" states ☐)
- ✅ Scheduled unpublishing (same "Expires at" feature — see "Content expiration dates" just below)
- ☐ Publishing approvals and configurable review steps
- ✅ Page-level publishing checklist (a live, non-blocking checklist in the article/project editor — title, tags, summary where applicable, enough body content — updates as you type, same pattern as the share preview)
- ☐ Editorial calendar
- ✅ Content expiration dates (an "Expires at" field on articles and projects, mirroring "Publish at" — automatically drops out of listings, RSS, sitemap, search, and topic pages once passed, and the direct URL 404s; the item isn't deleted, and admin/preview access is unaffected, same as an unpublished draft)
- ☐ Review reminders
- 🔶 Inventory of stale, empty, and unfinished pages (the new layout-diagnostics panel flags empty blocks per-page; no site-wide stale-content report)
- 🔶 Full-site preview including drafts, navigation, and linked draft content (per-item `?preview=1` ✅; a full-site draft-inclusive preview mode ☐)
- ☐ Future-date preview for scheduled changes
- ☐ Expiring and revocable draft-preview links (preview requires being logged in as admin, not a shareable link)
- ✅ Warnings for links to unpublished content or missing assets (the Link Checker now resolves an internal link's actual publish state — draft/expired links report "Not published"/"Expired" instead of silently passing as OK; also fixed two real gaps found while building this: project links were never validated at all — always "Not found" even when correct — and project bodies/journal entries/links blocks/a project's own github-demo-docs-download links were never scanned for links in the first place)
- ☐ Publish related pages, navigation changes, and updates as one package
- ☐ Roll back an entire publishing package
- ☐ Show affected pages before publishing global changes
- ☐ URL-change preview showing affected links and redirects
- ☐ Private pages (no page-level access control)
- 🔶 Unlisted pages (a page can be left out of nav — de facto unlisted, but still reachable by direct URL)
- ☐ Password-protected pages

## 8. Content administration and portability

- ☐ Convert or clone content between types (page duplication exists; no cross-type conversion)
- ✅ Bulk update tags, categories, dates, and visibility (bulk publish/unpublish/trash/add-tag for both articles and projects; "categories" and "dates" map onto tags and publish scheduling, which are already per-item, not bulk-editable ranges)
- ✅ Global find and replace with review before applying
- ☐ Import from other platforms
- ☐ Import dry run showing proposed changes (backup import is all-or-nothing)
- ✅ Portable exports of content, fields, relationships, and media references (full JSON backup, now includes relationships)
- ✅ Export the complete site content
- 🔶 Preserve stable content identities when reorganizing or importing (ids preserved on backup round-trip; n/a for cross-platform import, which isn't built)

## 9. Personal site sections

These are mostly **content to write, not code to build** — the page
builder + changelog block already support making any of these as a plain
page. Noting where the supporting capability exists vs. doesn't:

- 🔶 Now page (capability exists — a page + changelog block — content not created)
- ✅ Site changelog (the changelog block type exists)
- ☐ Uses/gear page (no dedicated feature; could use project-card blocks manually)
- ☐ Resume or experience page generated from structured entries (no structured resume data model)
- 🔶 Public notes and short posts (articles already serve this; no distinct lightweight "note" format)
- ☐ Public project roadmaps
- ☐ "Currently building" section (no dedicated homepage widget; could combine project status+featured manually)
- 🔶 Topic landing pages (tag-filtered listing works via `?tag=`; no dedicated landing-page builder)
- ✅ Archive organized by year or timeline (`/archive` — every published article and project, grouped by publish year)

## 10. Projects and portfolio

- ☐ Independent layouts for individual projects (fixed template, like articles)
- ✅ Project templates and case-study layouts (templates ✅; no distinct "case-study" template type)
- 🔶 Hero images, videos, and interactive demos (hero image ✅; hero video ☐; demos via related simulations/scans, not embedded inline yet)
- ✅ Structured tech stack and tools
- ✅ GitHub, demo, documentation, and download links
- ☐ Screenshots with captions and optional device frames
- ☐ Before/after comparisons
- ✅ Project status fields
- 🔶 Development timelines and milestones (build journal entries are dated and tell a timeline; no dedicated milestones widget)
- ✅ Challenges, decisions, and lessons sections (journal entry types: decision, failed)
- ✅ Related articles, simulations, scans, and media
- ✅ Project version history and release notes (revisions exist; no distinct "release notes" concept)
- 🔶 Public project changelogs (journal entries can serve this; no distinct changelog feature for projects)
- 🔶 Downloadable project files (a single download link field exists; no file-manifest system)
- 🔶 Project search, sorting, and filtering (search ✅; tag/featured filter ✅; arbitrary sort options ☐)
- 🔶 Featured-project ordering (featured flag ✅; manual drag-reorder among featured ☐)
- ☐ Architecture and dependency diagrams

## 11. Build journals and technical documentation

- ✅ Dated build-journal entries attached to projects
- ✅ Bill of materials with quantities, prices paid, links, and substitutions
- ✅ Wiring and pinout tables (via markdown-lite pipe tables — no new feature needed)
- ✅ Test records with expected and actual results (journal entry type: test)
- 🔶 Supporting photos and measurements for tests (journal body is markdown-lite text; no dedicated photo/measurement fields)
- ✅ Decision logs
- ✅ Failed-attempt records
- ☐ Reproduction checklists and prerequisites
- ☐ Download manifests explaining each file
- ☐ Hardware and software compatibility information
- ☐ Firmware and source files tied to hardware revisions
- ☐ Project completion summaries
- ☐ Cybersecurity lab writeup templates
- ✅ Expandable hints and walkthrough solutions (the accordion block covers this generically)
- ☐ Annotated terminal transcript blocks
- ☐ Screenshot redaction for credentials and personal information

## 12. Media library and file management

- 🔶 Folders and nested folders (flat folders ✅; nesting ☐)
- 🔶 Media tags and smart collections (tags ✅; smart collections ☐)
- ☐ Saved searches
- ✅ Usage tracking showing every placement of an asset
- 🔶 Bulk upload, move, rename, tag, and delete (bulk upload/move/tag/delete ✅; bulk rename ☐ — R2 keys are content-addressed UUIDs, so "rename" only really applies to the display/alt text, which the info modal already covers per-file)
- ✅ Duplicate-file detection (every upload gets a SHA-256 of its bytes; a "Possible duplicates only" filter and a "Scan for duplicates" backfill button cover files uploaded before this existed; uploading something byte-identical to an existing file surfaces a warning immediately)
- ☐ Replace assets without breaking existing placements
- ☐ Media version history
- ✅ Original-file preservation (uploads aren't destructively modified)
- ☐ Responsive image variants and thumbnails (no srcset generation)
- ☐ Crop and focal-point settings per placement
- ✅ Alt text, captions, credits, and licensing fields (media-library-level fields on every upload; the image block also gets its own caption/credit fields, pre-filled from the library when you insert — resolves the matching "inline image captions and credits" item in section 5 too)
- 🔶 Metadata viewer for dimensions, format, and size (size shown; dimensions/format viewer still ☐ — deferred, see PRODUCTION_TODO.md)
- 🔶 Search by filename, tag, type, dimensions, and usage (filename+tag ✅; dimensions/usage search ☐)
- ✅ Review and cleanup of unused or orphaned files ("Unused only" filter in the library, computed from actual usage across pages/articles/projects/settings — also fixed a real gap where project share images weren't checked by usage tracking at all)
- ☐ Image optimization controls with visual comparison
- 🔶 Video poster images (exists for the 3D-scan feature; not for generic uploaded video)
- ☐ Video captions and transcript storage
- ☐ Audio-file support (uploads are image-only: png/jpeg/webp/gif/svg)
- ☐ PDF and document previews
- ☐ Download controls and direct-download buttons
- ☐ Drag library assets directly onto pages (upload/browse buttons only, no drag-and-drop)
- ☐ Resumable uploads
- ☐ Upload and processing queue with progress, failures, and retry
- ☐ Storage usage by file type and collection
- ☐ Strip private metadata from public copies while retaining originals

## 13. Photo editor

Undo/redo, flips, grayscale/sepia/invert, line tool, eyedropper, reset,
keyboard shortcuts — all ✅ (section 1). Remaining, all ☐:
batch adjustments across multiple images, saved editing presets,
redaction tools, preview edits across different crops where an image is used.

## 14. Media viewers and presentation

All ☐ — panoramic/360° viewer, deep-zoom viewer, image hotspots, audio
waveform player, synchronized A/B audio, timestamped notes, searchable
transcripts, consistent fullscreen controls, poster/caption conventions,
configurable fallbacks. Nothing in this section has been started.

## 15. Circuit simulation — existing features

All ✅ (section 1) — pre-existing, unchanged this session.

## 16. Circuit simulation — expansion

All ☐ — nothing in this section has been touched. 34 items: multi-select,
grouping/rotation, copy/paste, component search, starter templates,
potentiometers, multimeters, probes, live readings, playback controls,
oscilloscope graphs, wire routing, labels, custom components, validation,
plain-English explanations, guided mode, snapshots/history, sharing,
embeds, exports, accessibility, breadboard continuity, tolerances,
measurement history, and a limitations doc.

## 17. 3D LiDAR module

- ✅ Complete and verify the core scan module (Batch 11, pre-master-list)
- ✅ Browser-based 3D viewer (model-viewer)
- ✅ Rotate, pan, zoom, and reset-view controls (model-viewer defaults)
- ☐ Everything else in this section: scan library folders/tags/relationships beyond what projects now provide, fullscreen mode as a distinct control, point-cloud/mesh mode toggle, measurement tools, annotations, saved camera views, before/after and side-by-side comparison, scan timeline, thumbnails/poster images beyond what exists, descriptions/capture-date/equipment fields, embeds in articles/projects, mobile performance settings, original/optimized download options, privacy controls, fallback images.

## 18. Search and content discovery

- ✅ Site-wide search across all content types (now includes projects)
- ☐ Search filters and sorting
- 🔶 Suggestions while typing (the admin command palette does this; visitor-facing public search does not)
- ✅ Related-project and related-article displays
- ✅ Topic browsing (`/topics` lists every tag with counts; `/topics/:tag` shows matching posts and projects together. Also fixed a real bug found while building this: every tag chip linked to `/random?tag=` regardless of content type, so a project-only tag opened the article index and showed nothing)
- ☐ Timeline and year-based browsing
- ☐ Interactive project map or visual index
- ✅ Random article/project button (⇌ icon in the topbar, next to search; /shuffle route)
- ☐ Visitor bookmarks or save-for-later
- ☐ Locally stored visitor reading history
- ✅ Reading-time estimates for long project pages (sums project body + every journal entry, since that's usually where a project page's real length comes from)
- ✅ RSS feeds by content type or tag (`/rss.xml?type=article|project&tag=x`; also fixed a real gap where the feed never included projects at all, and added the missing `<link rel="alternate">` discovery tag site-wide)

## 19. Visitor interaction

Contact form, admin inbox, guestbook/comments, moderation, and newsletter
were **explicitly declined by you earlier this session** — left ☐
deliberately, not an oversight.

- ☐ Reactions or lightweight post feedback
- ✅ Expanded sharing controls (Share on X, LinkedIn, and email alongside the existing copy-link button, on both articles and projects)
- 🔶 Visitor font-size and motion preferences (reduced-motion respected automatically via OS setting; no manual visitor-facing toggle)
- ✅ Print-friendly articles and projects
- ☐ Downloadable PDF articles and case studies

## 20. Analytics

- ✅ Real-time visitor count
- 🔶 Event analytics (a generic named-event tracking system exists and is used internally; not a dedicated "event analytics" report surface)
- ✅ Device and browser breakdowns (Desktop/Mobile/Tablet and Chrome/Safari/Firefox/Edge/Opera, parsed from User-Agent at record time — only the coarse label is stored, never the raw UA string, so this doesn't add a new fingerprinting surface)
- 🔶 Expanded geographic analysis (country-level exists; region/city ☐)
- ☐ Per-page engagement and scroll depth
- ✅ Outbound-link tracking (every click on an external link, site-wide, with a "Top outbound links" breakdown in Analytics)
- ✅ Download tracking (links to common file types or `/media/` files, tracked separately from outbound links, with its own "Top downloads" breakdown)
- ✅ Internal search-term reporting ("Top search terms" in Analytics, from a new search-event log)
- ✅ Searches returning no results ("Searches with no results" in Analytics, same underlying log)
- ☐ Project-card clicks and navigation paths
- ☐ Configurable conversion goals
- 🔶 Custom events configured in admin (the tracking mechanism supports arbitrary named events; no admin UI to define new ones)
- 🔶 Filters by date, content type, referrer, and device (date-range filter ✅; the rest ☐)
- ☐ Period comparisons
- ☐ Chart annotations for releases and site changes
- ☐ Bot filtering and traffic-quality controls
- ☐ Data-retention settings
- ☐ Scheduled analytics summaries
- ☐ Rearrangeable dashboard widgets
- 🔶 Raw event-data export alongside existing breakdown exports (breakdown CSV export ✅; raw per-event export unconfirmed)

## 21. SEO and sharing

- ☐ Central SEO dashboard (tools are scattered: link checker, sitemap, meta fields — no single view)
- ✅ Per-page title and description controls
- 🔶 Canonical URL controls (canonical tag auto-generates correctly; not admin-editable per page)
- ✅ Indexing controls (noindex)
- 🔶 Social-share image editor (og_image field + upload/browse; no crop/preview editor)
- ✅ Social-share previews (og-preview UI now covers pages, articles, and projects)
- 🔶 Sitemap controls (auto-generated sitemap ✅; no admin include/exclude controls)
- 🔶 Structured-data controls for articles and projects (JSON-LD auto-generates; not admin-customizable)
- ☐ Internal-link suggestions across the site
- ☐ Orphan-page detection
- ☐ Automatic redirect suggestions after URL changes
- 🔶 Ongoing internal and external link monitoring (on-demand Link Checker scan exists; not scheduled/ongoing)
- 🔶 Missing-metadata reports (new "SEO Report" in Site Settings flags pages with no meta description and images missing alt text, site-wide; doesn't yet check every metadata field there is)

## 22. Accessibility

- ✅ Missing alt-text checks (diagnostics panel + inline warning on image blocks)
- 🔶 Heading-order checks (checks for missing/duplicate H1 only, not full h2→h3 hierarchy)
- 🔶 Color-contrast checks (a live WCAG contrast checker now runs in Site Settings whenever you touch a theme color, so a bad accent/text/background choice can't ship unnoticed; still no site-wide checker for arbitrary content colors)
- ☐ Keyboard-navigation checks (site supports keyboard nav from the health check; no automated checker)
- ☐ Visible focus-state checks (focus states exist site-wide; no automated checker)
- ✅ Tap-target checks
- ✅ Reduced-motion coverage across themes and interactive elements
- ☐ Accessible alternatives for simulations and 3D content
- ☐ Accessibility checks included in the publishing checklist (no publishing checklist feature exists at all)

## 23. Performance and loading

All ☐ — nothing in this section has been touched: performance budgets,
slow-page alerts, per-page weight reports, load-on-interaction for heavy
viewers, data-saving mode, slow-connection preview, visitor embed-loading
controls, cache status/refresh, embed-failure behavior, before/after
performance comparisons.

## 24. Admin interface

- 🔶 Deeper command palette covering content, media, settings, and actions (now searches pages/articles/projects/blocks; not exhaustive)
- ☐ Customizable admin dashboard
- ✅ Admin light/dark themes
- ☐ Interface density settings
- ☐ Saved workspace layouts
- 🔶 Favorites and recently edited items (recently edited pages/articles/projects show at the top of the command palette, from a client-side recency list rather than the activity log — that only ever kept a label, not an id, so a renamed item would silently point at a stale link; "favorites"/pinning specifically still ☐)
- ☐ Pinned shortcuts
- 🔶 Bulk-action toolbar (exists for articles and blocks; not universal)
- ☐ Contextual help for complex editors
- ✅ Keyboard shortcut reference (`?` or the command palette opens a cheat-sheet modal listing every shortcut)
- ☐ Shortcut remapping
- ✅ Universal admin search (command palette)
- ☐ Notifications for uploads, publishing, and site errors
- ☐ Background-job status and retry controls
- ✅ Visitor-view preview
- ☐ Role-specific preview (n/a — no roles exist)
- ✅ Mobile workflows for common edits
- ✅ Desktop controls for large editing sessions (focus mode, layers panel, multi-select)

## 25. Authentication and permissions

- ☐ Two-factor authentication
- ☐ Passkey sign-in
- ☐ Recovery codes
- ☐ Session list and remote session revocation
- ☐ Roles and permissions (single admin password only)
- ☐ Separate permissions for editing, publishing, settings, backups, and custom code
- ☐ Reauthentication for destructive or security-sensitive actions
- ☐ Scoped API tokens
- 🔶 Security-sensitive activity audit trail (general activity log exists; not specifically flagged/separated)
- ✅ Rate limits and abuse monitoring
- ✅ Security headers
- ☐ Sandboxed custom-code previews (custom head code / raw HTML blocks are trusted-admin-only by design, not sandboxed)
- ☐ Secret management that excludes credentials from content, previews, and exports

## 26. Integrations and automation

- 🔶 Integration settings managed through admin (a single webhook URL field exists in Site Settings)
- 🔶 Configurable actions triggered by content changes (one hard-coded trigger: webhook on article publish)
- ✅ Webhook delivery history (last 200 attempts logged with status/error, viewable in Site Settings)
- ✅ Retry failed webhook deliveries (re-sends the exact original payload)
- ☐ Background-task management
- ☐ Notifications for failed integrations
- ☐ Permission controls for external integrations

## 27. Testing, staging, and deployment

- ☐ Automated tests for important editing and publishing flows (Playwright scripts are ad hoc, not wired into CI)
- ☐ Staging environment with separate data (deliberately deferred — needs real Cloudflare resource provisioning, your go-ahead first)
- ☐ Preview deployments tied to changes
- 🔶 Database migration history (PRODUCTION_TODO.md is a manual migration log; no automated tracking system)
- ✅ Error tracking
- ☐ Uptime monitoring
- ☐ Maintenance mode
- 🔶 Custom error pages (custom 404 ✅; other error codes ☐)
- 🔶 Clear distinction between draft, staging, and live content (draft vs. live exists; "staging" as an environment doesn't)

## 28. Backups, health, and operating costs

- ✅ Automated D1 backups (daily cron → JSON export to R2)
- 🔶 R2 asset-backup strategy (media files live durably in R2 as the primary store already; not separately re-copied as a "backup")
- ☐ Backup-failure alerts
- 🔶 Tested restore procedure (the restore feature itself is tested repeatedly via Playwright; no written runbook for a human)
- ☐ Periodic restore drills
- ☐ Backup contents browser
- ☐ Selective restore from backups (restore is all-or-nothing)
- ☐ File-integrity checks for archives and backups
- ☐ Health dashboard for database, storage, uploads, and publishing
- ☐ Alerts for failed scheduled publishing
- ☐ Storage and database usage dashboard
- 🔶 Traffic and processing usage dashboard (analytics covers traffic; not Worker CPU/processing usage)
- ☐ Cost and usage alerts

## 29. Final verification

All ☐ — this is the explicit last step of the suggested build order
("run the full health check... before calling the system finished").
The health check done earlier this session covered the *original*
70-item backlog, before this master list existed — it needs to be
re-run against everything above once the list is far enough along.

---

## Suggested build order — where things stand

1. **Protect your work** — ✅ done (autosave, conflict recovery, trash, backups). Authentication is still just a single admin password (see section 25) — 2FA/roles/etc. not done.
2. **Build the flexible foundation** — in progress. Reusable blocks ✅, Projects as a real content type ✅, relationships/featured/pinned ✅. Custom content types (generic, no-code), custom fields, categories, and collections are still open (see section 4).
3. **Finish the publishing system** — mostly open. Revisions/diffs ✅ (section 6). Full-site preview, release packages, and rollback (section 7) are ☐.
4. **Improve daily editing** — partially done. Writing tools (TOC, footnotes, tables, code highlighting, markdown toolbar) ✅. Media management beyond folders/tags/usage-tracking is mostly ☐ (section 12). Admin search ✅.
5. **Expand your project tools** — well underway. Build journals, BOM, templates, relationships all ✅ (sections 10-11). Circuit-sim expansion (section 16) and LiDAR expansion (section 17) haven't been started.
6. **Polish the visitor experience** — mostly open. Search exists but filters/suggestions/browsing (section 18) are ☐. Accessibility has some new checks (section 22) but performance (section 23) is untouched.
7. **Run the full health check** — not started (section 29), by design — it's meant to run last.
