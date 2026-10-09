# dominickdominick.com — Project outline

Current operating rules, what is shipped, open work, migrations, and manual checks. Completed implementation narratives remain in Git history.

**What the site is (since 2026-10-08):** a home page, the Studio (a music maker in the browser), and two password-protected study modules that open from buttons on the home page. A slim admin at `/admin` edits the home page. Everything else the site used to have (articles, projects, search, the circuit simulator, 3D scans, the photo editor, the aim trainer, hidden notes, scripts, analytics and the rest) was deleted from the code. Its last working state is the git tag `before-slim-down`; to bring something back, start from that tag.

**Stack:** Cloudflare Workers (JavaScript), D1 (SQLite), R2, vanilla HTML/CSS/JS. Tests are plain Node scripts plus Playwright; CI is GitHub Actions.

**Last reviewed:** 2026-10-08

## 0. Project and release rules

**Release pipeline (trunk-based):** `main` is the live site. Every change is a short-lived branch and a pull request. There is no `production` branch and no per-session branches any more (they were deleted on 2026-10-08; everything in them was already in `main`).

1. **A pull request** runs CI (`.github/workflows/ci.yml`): every script parses, the pure tests, the Worker bundles (`wrangler deploy --dry-run`), and, when site code changed, the browser tests on Linux. It also gets a preview address (`preview.yml`): a Worker version that is not live, on the separate preview database and storage, never production's.
2. **A push to `main`** runs the same checks and then ships. The deploy job only runs if they are green (`wrangler deploy`), then smoke-tests the live site (`scripts/smoke.mjs`) and runs `wrangler rollback` if that fails. It refuses to deploy while a database migration is waiting.
3. **Migrations** are separate (`migrate.yml`). It only runs when started by hand and asked to type `migrate production`; it takes a database backup first (kept 30 days) and then applies `migrations/`. The order is: merge, run Migrate, then the deploy goes through.
4. **Monitoring:** `monitor.yml` smoke-tests the live site every six hours and opens one issue (label `live-site-down`) if it fails, adding a comment to that issue while it stays down.

**What GitHub's free plan cannot do here:** branch protection, rulesets and required reviewers on environments all need GitHub Pro for a private repository (the API answers "Upgrade to GitHub Pro or make this repository public"). So nothing can stop a direct push to `main`; the pipeline makes that harmless instead, because the deploy job only ships a commit whose checks passed, and a failed smoke test rolls it back. If the repository moves to Pro, turn on branch protection for `main` with the `checks` and `browser` jobs required.

**One-time setup only the owner can do** (it needs your Cloudflare and GitHub accounts):
- In the repository's Settings > Secrets and variables > Actions, add `CLOUDFLARE_API_TOKEN` (a token with Workers Scripts: Edit and D1: Edit) and `CLOUDFLARE_ACCOUNT_ID`.
- Then switch off Cloudflare's own git build for `main` (Workers & Pages > dominickdominick > Settings > Builds), otherwise `main` is deployed twice.
- Until the secrets exist, the deploy and preview jobs skip themselves with a notice (they do not fail), Cloudflare's own build keeps deploying `main`, and the `verify` job in `ci.yml` waits for that build and smoke-tests it.
- Seed the preview database once with `seed/home.sql` if you want previews to show the home page.
- **Cloudflare's bot protection and the smoke test:** Cloudflare answers requests from GitHub's runners with a challenge page (403, "Just a moment..."). The smoke test reports a challenged request as skipped, not failed, so without more setup the `verify` and `monitor` jobs only prove that Cloudflare's edge answers (real failures such as a 5xx still fail). For a full check, add a WAF custom rule in the Cloudflare dashboard (Security > WAF) that skips bot protection when the request header `X-Smoke-Key` equals a long random value, and store the same value as the repository secret `SMOKE_KEY`; the smoke script sends it when it is set. The first run on `main` (2026-10-08) hit this, and the issue it opened was closed as a false alarm.

**Vercel:** the site never used it. Its GitHub integration left 14 deployment records and the `Production` and `Preview` environments on the repository. Deleting the records needs a token with Deployments write access; disconnect the Vercel project in Vercel's own dashboard so it stops adding new ones.

**Review evidence:** report each score and unresolved finding; never claim browser or visual checks that were not run.

**Visible changes:** use a real-browser viewport screenshot and score 0–10 (0–4 fail, 5–7 needs polish, 8–10 ship-ready). If below 8, fix and rescore, stopping after five loops. For fixed modals capture viewport only; confirm suspected layout defects with DOM geometry. Always report the visual score, or say clearly when no screenshot was available.

**Test each batch:** use only synthetic test data and clean it up, including changed settings. Preview branches share D1/R2 when they use the same resource IDs/names, so namespace fixtures and avoid conflicting parallel tests. The user prefers forward progress without repeated check-ins; ask before production data changes, enabling paid services/billing, costly-to-reverse architecture or visible design choices, or starting a new module with unclear scope.

**Content and scope:** the public site has no articles, projects or filler content; never add placeholder production content. Work one item at a time. Any genuinely new paid external service/API or billing needs a check-in before activation.

**Commit messages** are a plain bulleted list of the changes, nothing else: no attribution lines, no session links, no tool names. History was rewritten on 2026-10-08 to match.

**D1/R2 cautions:** `schema.sql` is the base fresh-install bootstrap; apply the Wrangler migrations after it (`npm run db:local` does both for a local database and seeds the home page from `seed/home.sql`, which must never be run against production). The `previews` block sets runtime bindings, while Wrangler migrations use the selected config's top-level D1. Use `wrangler.preview-migrations.jsonc` and verify its database name/ID against the Preview binding before `--remote`; inspect production before any forward-only live migration. Preview D1/R2 are separate from production but shared by Previews using the same IDs/names; use namespaced synthetic fixtures and clean them up. Production writes need per-instance confirmation. Preview resources: `dominickdominick-preview` D1 and `dominickdominick-media-preview` R2; production resources: `f49fb038-9dfb-419e-acfb-7d8babc9d509` and `dominickdominick-media`. **The code for the deleted features is gone but their D1 tables and rows are still there**; dropping them is a production database change that needs the owner's say-so (see section 3).

**Secrets:** `ADMIN_PASSWORD` and `SESSION_SECRET` stay in Worker runtime Secrets, never in source or public content. Also set `STUDY_PASSWORD` there: without it the study modules fall back to the built-in default (`123`), which keeps casual visitors out and nothing more. Build variables and secrets are build-time settings; that panel does not verify runtime Worker secrets. Verify distinct test-only Preview values before protected-flow checks.

## 1. What is shipped

- **Home page:** one D1 page (`home`) rendered from blocks. Block types: heading, text, image, button, divider, spacer, quote, gallery and study. Each block can carry colour, font, size, border, a width on phones, a reading order, hide-on-desktop/mobile, a hover effect and one of five entrance animations. A page holding a study block is kept out of search engines and the sitemap on purpose.
- **Study modules:** the A+ Core 1 drill and the WGU C777 web development drill (`worker/study/`, `public/study/`), opened from a study block in a full-screen popup after a password. Progress and weak spots stay in the browser. See `worker/study/README.md`.
- **Studio (`/studio`):** the song builder as a page for every visitor: five fixed tracks (drums, bass, chords, melody, lead), step sequencer and piano roll, forty instruments and fifteen drum kits, MIDI keyboard input, live play (arpeggio, strum, roll), bars and patterns, song files and MIDI import/export. Songs stay in the visitor's browser (`localStorage`) and are never sent to the site. The sound is synthesized with Web Audio; there is no sample playback, effects chain or mixing desk.
- **Look:** Bit bento (1-bit ink on paper, Mac-style windows, pixel type, one orange accent). Paper is warm cream in the light theme and soft charcoal in the dark theme (not pure white and black, which was hard on the eyes).
- **Settings dialog:** the last stop of the nav dial. Light/dark, reduce motion, text size, and links to the pages. No search.
- **Slim admin:** login; the home page editor (blocks, undo/redo, autosave that never publishes a draft, conflict check, revisions, trash); media library for images; site settings (footer, maintenance mode, default share image); backups (export/import, daily scheduled backup to R2, verify, restore); the features board and this outline, read-only; error log; command palette.
- **Backups:** the daily 08:00 UTC cron writes a full JSON export of D1 to R2 (`backups/`), including the tables of the deleted features, so a restore loses nothing.

## 2. Open work

### Home page
- [ ] The live home heading block carries a hard-coded white text colour and a 6px font size in its saved style, so it vanishes on the light theme. Clear that block's style in the admin (the seed in `seed/home.sql` has none).
- [ ] Decide whether the home page should be indexable. It is kept out of search engines only because it holds study buttons.
- [ ] Set `STUDY_PASSWORD` (section 0, Secrets).
- [ ] Alt text for the home page's hero image: it had an R2 object but no D1 media row (found 2026-09-28); recheck delivery and the admin media list.

### Studio
- [ ] Tempo/time-signature settings: every module assumes 16 steps per pattern, so a signature other than 4/4 needs a variable pattern length in the engine, the step grids, cached peaks and saved data. Needs a decision on which signatures.
- [ ] Per-track clipping attribution needs per-track metering; today only the master bus is logged.
- [ ] A longer piano-roll range or per-track step length means changing the song format.
- [ ] Reduced-motion sweep: the skip link's slide and `@view-transition` still need a check.

- [ ] Re-create the browser tests for the song builder against `/studio`: the 18 `test_song_*` tests drove it through the admin's song library and were deleted with it (the pure `tests/song-*.test.mjs` still cover the logic).
- [ ] Rewrite `tests/e2e/test_nav_carousel.js` for the three-stop nav; it is parked in `known-failing.txt`.
- [ ] The browser tests have not been run to the end since the cut (the first full run is the first CI run on Linux). Check `known-failing.txt` for what is still parked and why.

### Admin
- [ ] Improve backdrop contrast for near-fullscreen builder modals.
- [ ] Real-browser verification of the admin dialogs and writing-focus semantics.

### Testing, staging and deployment
- [ ] Finish the one-time setup in section 0 and watch the first pull request go through the whole pipeline.
- [ ] Seed the preview database with `seed/home.sql` once, so previews show the home page, then drop `--no-home` from the preview smoke test.
- [ ] Migration history: Wrangler tracks `0001_simulation_publication` and `0002_project_related_songs`; older manual schema changes are not reconstructed.

### Backups and operating costs
- [ ] Separate R2 asset backups (R2 currently holds the only copy of the media).
- [ ] A human restore runbook (automated restore is tested with Playwright).
- [ ] Verify a legacy backup restore and a new backup round trip in a Preview.
- [ ] Confirm the live Worker's `0 8 * * *` backup schedule. Preview Workers do not run Cron Triggers.

## 3. Production migration state

- Production D1 `dominickdominick` has `media.private`, `width` and `height` (verified read-only 2026-09-28). Migrations `0001_simulation_publication.sql` and `0002_project_related_songs.sql` are applied to production and to Preview D1 `dominickdominick-preview` (`6b4b23d0-d680-4320-83c0-bc144f1cf3d9`).
- `schema.sql` is the base bootstrap and intentionally omits columns added by tracked migrations. Apply tracked migrations after an empty bootstrap. The migration directory does not reconstruct older manual schema changes.
- **Orphaned tables (decision for the owner):** `articles`, `projects`, `journal_entries`, `bom_items`, `simulations`, `scans`, `songs`, `topic_meta`, `redirects`, `templates`, `shared_blocks`, `events`, `pageviews`, `reactions`, `webhook_deliveries`, `preview_links`, `activity_log`, `media_revisions` and `media_versions` have no code reading them any more. Keeping them costs nothing and the daily backup still carries them. If they are ever dropped, do it in a numbered migration through the Migrate workflow, after a fresh backup.

## 4. Removed on 2026-10-08

The code for these was deleted (recover it from the git tag `before-slim-down`): search and the finder's search box; articles, Random, Topics, Archive, RSS and reactions; projects, journals and bills of materials; the circuit simulator and its solver; 3D scans; PicEditor and the admin photo editor; the aim trainer; Hidden Notes; the Scripts and Nodes editor; redirects, the link checker, the SEO and accessibility dashboards, preview links, preview-at-a-date, webhooks, find and replace, templates, sections, style presets; analytics, page views and events; password-protected pages; audio, video, font and scan uploads; the admin's own song library; shared blocks; block types other than the nine above; the Appearance settings (accent, fonts and control presets, which the Bit bento look already overrode).

## 5. Recurring security, SEO and accessibility checks

### Security
- [ ] Dependencies still pinned to versions without known CVEs (Dependabot opens the pull requests).
- [ ] Rate limits still cover every public write endpoint (login, study unlock); check after adding any new public POST route.
- [ ] Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) still present and correctly scoped.
- [ ] Session cookie still `HttpOnly; Secure; SameSite=Strict`.
- [ ] No new admin route added without going through `isAuthenticated()` / the admin router's auth gate.
- [ ] `javascript:`/`data:` URI neutralization (`safeHref`) still applied wherever a user-authored URL renders.
- [ ] New tables/columns don't accidentally expose more than intended through a `SELECT *` in a public-facing query.
- [ ] File uploads validated by type (images); add validation whenever a new format is introduced.

### SEO and accessibility
- [ ] Every new public route has a `<title>`, meta description and correct canonical tag, and appears in `sitemap.xml` unless it is meant to be hidden.
- [ ] Heading rule: one H1, no skipped levels.
- [ ] Interactive/canvas content (the Studio) has a real text alternative, not just a generic label.
- [ ] Reduced motion respected for any new animation.
- [ ] Tap targets at least 24 by 24 px on any new mobile UI.
- [ ] Colour contrast checked for any new UI colour, not just theme tokens (paper and ink are about 12:1; dim text is about 5.5:1).

## 6. Open decisions

- Whether to drop the orphaned tables (section 3).
- Whether to bring back a way to edit more than the home page (a second page, a notes page). The admin edits the home page only, and `PUT /api/admin/pages` creates pages but nothing links to them.
