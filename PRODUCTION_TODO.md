# Production notes — dominickdominick.com

Tracks anything that needs a human, an account-level decision, or a
manual spot-check — as opposed to `MASTER_FEATURE_LIST.md`, which tracks
feature status. Check this at the start of a session alongside that file.

## Schema migrations

**Status: production D1 is fully migrated and matches `schema.sql`, as of
2026-09-24.** Applied directly via the Cloudflare D1 API with the user's
confirmation, right before the `production` → `main` push that shipped
everything through the Projects/build-journals/BOM/relationships batch.
Verified column-for-column against `schema.sql` after applying, and
confirmed existing rows were untouched.

Turned out production had never been migrated past the *original* schema
at all (not just missing the recent additions) — this was confirmed by
querying `sqlite_master`/`PRAGMA table_info` directly against production
before assuming, not by trusting old notes. Worth remembering: **check
prod's actual schema before writing new migration SQL, don't assume it's
at whatever state the last note here claimed.**

`schema.sql` in the repo is the source of truth for what a fresh database
should look like. D1 has no migration-tracking system of its own, so any
future schema change needs its `ALTER`/`CREATE` statements noted here
until they're actually applied to production — then this section gets
updated to say so, the same way this update just did.

**New, not yet applied to production** (media captions/credits/licensing,
content expiration, and device/browser analytics):

```sql
ALTER TABLE media ADD COLUMN caption TEXT;
ALTER TABLE media ADD COLUMN credit TEXT;
ALTER TABLE media ADD COLUMN license TEXT;
ALTER TABLE articles ADD COLUMN expires_at TEXT;
ALTER TABLE projects ADD COLUMN expires_at TEXT;
ALTER TABLE pageviews ADD COLUMN device TEXT;
ALTER TABLE pageviews ADD COLUMN browser TEXT;
```

## Deferred from the media library batch

- **Duplicate-file detection** — needs content hashing at upload time
  (cheap going forward) plus a backfill pass over every existing R2
  object to hash retroactively. Scoped out as a separate, larger piece of
  work rather than folding it into the captions/unused-files batch.
- **Metadata viewer for image dimensions/format** — needs either
  client-side `<img>`/canvas probing at upload time (stored alongside the
  other media metadata) or a server-side binary header parse. Deferred
  since neither is a quick add relative to its value for a personal site
  with a small media library.

## Deferred from the design tokens batch

- **Spacing and shadow tokens** (the other two categories the master
  list's "global tokens" line asks for, alongside colors/typography/
  borders which are now done). Neither has an existing hook to build on:
  spacing throughout style.css is ad hoc per-component px values, not a
  scale, and there are currently zero box-shadows anywhere on the site
  (a deliberately flat design). Retrofitting either safely — without
  quietly changing the site's current look — needs a careful, deliberate
  pass with visual review, not something to do unsupervised. Flagging
  for a future batch rather than rushing a lower-confidence version.
- **Presets for buttons/cards/callouts/image treatments**, **per-page
  style overrides**, and **page-specific CSS/JS controls** — real,
  reasonable asks from the same section, not done this batch since the
  tokens themselves (the foundation those would build on) came first.

Run via the Cloudflare D1 MCP tools (query directly against the
`dominickdominick` database, id `f49fb038-9dfb-419e-acfb-7d8babc9d509`),
or `npx wrangler d1 execute dominickdominick --remote --command "..."`
from a machine with the right credentials. Always confirm with the user
before running anything against production — this project's standing rule.

## Deferred from tonight's overnight session

- **Orphan-page detection** (section 18/21 on the master list) — the
  real design question isn't small: an article/project can be published,
  in the sitemap, and directly linkable, but still practically
  unreachable by browsing if it's aged out of every article-list/
  project-list block's `limit` (or simply never linked to from anywhere
  else). Detecting that correctly means walking every block type that
  can hold an internal link (button, links list, project-card, inline
  markdown links in article/project/journal bodies, nav) and reasoning
  about list-block limits truncating older items — worth getting right
  rather than shipping a version with false positives that erodes trust
  in the tool. Good next candidate, deliberately not rushed tonight.
- ~~"Recently edited" in the command palette~~ — done in a later session,
  via the client-side localStorage approach noted here (not the
  activity_log/entity_id route). Plain "favorites"/pinning (a user
  manually marking something, independent of recency) is still open.

## Local dev-only housekeeping (not urgent, not production)

- The local dev D1 `home` page (id 9, this environment's sandbox database
  only — never production) is carrying ~20 leftover test blocks (a
  deliberately garish red-text/green-border heading, a video/quote/
  gallery/simulation/html grab-bag) from testing many sessions ago,
  overlapping visually. A bulk-delete of all of them was blocked by this
  environment's own auto-mode safety classifier ("irreversible local
  destruction") when attempted autonomously overnight — reasonable
  caution for a bulk-delete loop, so it was left alone rather than
  worked around. Purely cosmetic (only affects local screenshots taken
  in this dev environment); if you want it cleaned up, it just needs
  someone to approve the deletes (or do it from the admin UI directly).
  Same for dozens of old test articles from much earlier sessions
  (`series-part-*`, `toc-test-article*`, etc.) — harmless clutter, not
  urgent.

## Other manual/human-only items

- **Highlight.js CDN dependency**: code blocks load `highlight.js` from
  `cdnjs.cloudflare.com` at runtime. Couldn't be verified end-to-end from
  the sandbox (its network policy blocks cdnjs outright) — worth opening
  a real published article with a code block in a normal browser once to
  confirm syntax highlighting actually renders.
- **model-viewer CDN dependency**: the 3D Scan block and the admin Scan
  editor's live preview load `@google/model-viewer` from
  `cdn.jsdelivr.net` at runtime. Same sandbox limitation. Worth doing once
  in a real browser: upload a small .glb (Polycam/Reality Composer
  export), confirm it spins and loads, try the AR button on an iPhone
  with a .usdz attached (Quick Look).
- **Cron trigger for D1→R2 backups** (`0 8 * * *` in `wrangler.jsonc`):
  activates automatically on deploy. Worth confirming in the Cloudflare
  dashboard that it's registered under the Worker's Triggers tab, and
  that a backup actually lands in the `dominickdominick-media` R2 bucket
  under `backups/` within the first day.

## Deliberately scoped-out decisions

These are real account-level or infrastructure calls, not gaps in the
code — flagging so they don't show up as "still open" in
`MASTER_FEATURE_LIST.md` without context:

- **A staging environment** (second D1 database + R2 bucket) — skipped
  since provisioning real Cloudflare account resources is an account-cost
  decision to confirm first, not something to do autonomously.
- **Automated tests wired into CI** — this session's Playwright scripts
  are ad hoc, run manually against local dev, not hooked into a pipeline.
- **Image CDN transforms** (Cloudflare Image Resizing) — needs a specific
  plan/add-on; didn't want to assume the billing setup.
- **A standalone public `/scan/:id` share-link page** (mirroring
  `/simulation/:id`) — straightforward to add later via the already-
  exported `modelViewerHtml()` helper, just hasn't been asked for.
