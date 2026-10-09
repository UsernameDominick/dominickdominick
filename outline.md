# dominickdominick.com — Project outline

Current operating rules, what is shipped, open work, migrations, and manual checks. Completed implementation narratives remain in Git history.

**What the site is (started over on 2026-10-09):** one boilerplate index page served by a small Worker, with the pipeline (CI, preview, deploy, monitor, migrate) kept as it was. Everything the site used to be (the Studio music maker, the search and command dialog, the two study modules, the nav, the old admin panel, the earlier articles, projects and tools) was deleted from the code on purpose so the owner can start over. The last working state is the git tag `before-start-over`; the older, larger site is `before-slim-down`. To bring something back, start from a tag (`git show before-start-over:path/to/file`).

**Stack:** Cloudflare Workers (JavaScript) serving static files, D1 (SQLite) bound but unused for now, vanilla HTML/CSS/JS. Tests are plain Node scripts plus Playwright; CI is GitHub Actions.

**Last reviewed:** 2026-10-09

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
- **Cloudflare's bot protection and the smoke test:** Cloudflare answers requests from GitHub's runners with a challenge page (403, "Just a moment..."). The smoke test reports a challenged request as skipped, not failed, so without more setup the `verify` and `monitor` jobs only prove that Cloudflare's edge answers (real failures such as a 5xx still fail). For a full check, add a WAF custom rule in the Cloudflare dashboard (Security > WAF) that skips bot protection when the request header `X-Smoke-Key` equals a long random value, and store the same value as the repository secret `SMOKE_KEY`; the smoke script sends it when it is set. The first run on `main` (2026-10-08) hit this, and the issue it opened was closed as a false alarm.

**Vercel:** the site never used it. Its GitHub integration left 14 deployment records and the `Production` and `Preview` environments on the repository. Deleting the records needs a token with Deployments write access; disconnect the Vercel project in Vercel's own dashboard so it stops adding new ones.

**Review evidence:** report each score and unresolved finding; never claim browser or visual checks that were not run.

**Visible changes:** use a real-browser viewport screenshot and score 0–10 (0–4 fail, 5–7 needs polish, 8–10 ship-ready). If below 8, fix and rescore, stopping after five loops. For fixed modals capture viewport only; confirm suspected layout defects with DOM geometry. Always report the visual score, or say clearly when no screenshot was available.

**Test each batch:** use only synthetic test data and clean it up, including changed settings. Preview branches share D1/R2 when they use the same resource IDs/names, so namespace fixtures and avoid conflicting parallel tests. The user prefers forward progress without repeated check-ins; ask before production data changes, enabling paid services/billing, costly-to-reverse architecture or visible design choices, or starting a new module with unclear scope.

**Content and scope:** the public site has no articles, projects or filler content; never add placeholder production content. Work one item at a time. Any genuinely new paid external service/API or billing needs a check-in before activation.

**Commit messages** are a plain bulleted list of the changes, nothing else: no attribution lines, no session links, no tool names. History was rewritten on 2026-10-08 to match.

**D1/R2 cautions:** `schema.sql` is the base fresh-install bootstrap; apply the Wrangler migrations after it (`npm run db:local` does both for a local database). The `previews` block sets runtime bindings, while Wrangler migrations use the selected config's top-level D1. Use `wrangler.preview-migrations.jsonc` and verify its database name/ID against the Preview binding before `--remote`; inspect production before any forward-only live migration. Preview D1/R2 are separate from production but shared by Previews using the same IDs/names; use namespaced synthetic fixtures and clean them up. Production writes need per-instance confirmation. Preview resources: `dominickdominick-preview` D1 and `dominickdominick-media-preview` R2; production resources: `f49fb038-9dfb-419e-acfb-7d8babc9d509` and `dominickdominick-media`. **The code for the deleted features is gone but their D1 tables and rows are still there**; dropping them is a production database change that needs the owner's say-so (see section 3).

**Secrets:** the site reads no runtime secrets now. `STUDY_PASSWORD`, `ADMIN_PASSWORD` and `SESSION_SECRET` belonged to the old site and can be deleted from Cloudflare. Any new secret stays in Worker runtime Secrets, never in source or public content. Build variables and secrets are build-time settings; that panel does not verify runtime Worker secrets. Verify distinct test-only Preview values before protected-flow checks.

## 1. What is shipped

- **The index page** (`public/index.html`, `style.css`, `robots.txt`): a plain, readable page that says a new site is on the way. No scripts, no inline styles.
- **The Worker** (`worker/index.js`, `worker/security-headers.js`): answers every request from the static files and adds the security headers (CSP with no inline script and no eval, no framing by other sites, no MIME sniffing, https only).
- **The pipeline:** unchanged (section 0). The pure tests (`tests/site.test.mjs`) and one browser test (`tests/e2e/test_index.js`) keep it honest.

## 2. Open work

- [ ] Decide what the new site is: its pages, its look and its content. Nothing is planned yet.
- [ ] Finish the one-time setup in section 0 and watch a pull request go through the whole pipeline.
- [ ] Migration history: Wrangler tracks `0001_simulation_publication` and `0002_project_related_songs`; older manual schema changes are not reconstructed.

## 3. Production migration state

- Production D1 `dominickdominick` has `media.private`, `width` and `height` (verified read-only 2026-09-28). Migrations `0001_simulation_publication.sql` and `0002_project_related_songs.sql` are applied to production and to Preview D1 `dominickdominick-preview` (`6b4b23d0-d680-4320-83c0-bc144f1cf3d9`).
- `schema.sql` is the base bootstrap and intentionally omits columns added by tracked migrations. Apply tracked migrations after an empty bootstrap. The migration directory does not reconstruct older manual schema changes.
- **Orphaned tables (decision for the owner):** `articles`, `projects`, `journal_entries`, `bom_items`, `simulations`, `scans`, `songs`, `topic_meta`, `redirects`, `templates`, `shared_blocks`, `events`, `pageviews`, `reactions`, `webhook_deliveries`, `preview_links`, `activity_log`, `media_revisions` and `media_versions` have no code reading them any more. Keeping them costs nothing; there is no backup of them any more (the daily backup went with the old admin panel). If they are ever dropped, do it in a numbered migration through the Migrate workflow, after a fresh backup.

## 4. Removed

- **2026-10-09, on purpose, to start over:** the Studio (the browser music maker: the song engine, the step sequencer and piano roll, the instruments and kits, MIDI, the song files), the search and command dialog and the nav dial, the A+ Core 1 and C777 study modules, the stylesheet and fonts, the Bit bento look, the share pictures, the old browser tests and the Worker's page rendering. Recover any of it from the git tag `before-start-over`.
- **Earlier on 2026-10-09:** the admin panel and everything only it used (the media route, maintenance mode, site settings, the daily backup and its R2 binding).
- **2026-10-08:** the earlier, larger site (search, articles, projects, the circuit simulator, 3D scans, the photo editor, the aim trainer, hidden notes and the rest). Recover it from the git tag `before-slim-down`.

## 5. Recurring security, SEO and accessibility checks

### Security
- [ ] Dependencies still pinned to versions without known CVEs (Dependabot opens the pull requests).
- [ ] Rate limits on every public write endpoint, if one is ever added.
- [ ] Security headers (CSP, X-Frame-Options, X-Content-Type-Options, Referrer-Policy) still present and correctly scoped (`worker/security-headers.js` and `public/_headers`).
- [ ] New tables/columns don't accidentally expose more than intended through a `SELECT *` in a public-facing query.

### SEO and accessibility
- [ ] Every new public page has a `<title>`, a meta description and one `<h1>`.
- [ ] Reduced motion respected for any new animation.
- [ ] Tap targets at least 24 by 24 px on any new mobile UI.
- [ ] Text at least 16px, and colour contrast checked for any new UI colour (the starting page is about 15:1 for text and 7:1 for dim text).

## 6. Open decisions

- Whether to drop the orphaned tables (section 3).
