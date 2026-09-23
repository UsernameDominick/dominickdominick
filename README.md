# dominickdominick.com

A Cloudflare Worker + D1 site with a built-in visual page editor.

## How it works

- **`worker/`** — the Worker script. Renders every page from data stored in D1
  (a real database), handles the `/api/admin/*` endpoints, and generates
  `sitemap.xml`/`robots.txt` dynamically.
- **`public/`** — static assets: `style.css`, `nav.js`, and the admin app
  (`public/admin/`). Served directly by Cloudflare, no Worker code involved.
- **D1 database** (`dominickdominick`) — holds `pages`, `blocks` (the actual
  content, positioned on a 24-column grid, plus a per-block `style`
  override: color, background, font, font size, border), `articles`
  (posts under Random), `settings` (site-wide config: default share
  image, theme accent/background/font, custom `<head>` code, a webhook
  URL), `login_attempts` (rate limiting), `redirects` (old path → new
  path), `revisions` (undo history for pages and articles), and
  `pageviews` (self-hosted analytics — path, referrer domain, country,
  no cookies or IPs stored).
- **R2 bucket** (`dominickdominick-media`) — uploaded images. Served back
  through the Worker at `/media/:key` rather than R2's public dev URLs,
  which Cloudflare doesn't consider production-ready.

## Editing content

Go to `/admin` and log in with the admin password (set as a Cloudflare
Worker secret, not stored in this repo). From there:

- Drag blocks around a 24-column grid, resize from the bottom-right
  corner — blocks can't overlap; a drop onto another block snaps back
- Add new block types from the left palette
- Edit a selected block's content, and its own style (text/background
  color, font, font size, border) in the right-hand panel. Headings
  can be H1–H6. "Duplicate block" clones one, placed below everything
  else so it never overlaps.
- Text blocks and article bodies support minimal markdown: `**bold**`,
  `*italic*`, `[label](url)`.
- Block types include Heading, Text, Image, Button, Project Card, Article
  List, Video Embed (paste a YouTube or Vimeo URL), Quote, and Gallery
  (a grid of images).
- Use the "Media" button, or "Browse…" next to any image field, to reuse
  a previously uploaded image instead of uploading it again.
- Manage Random posts under the "Articles" button — tags, drafts, a share
  image, an "Upload image" button that goes straight to R2, and a
  "Publish at" field so a post can be scheduled for a future date/time
  (it stays hidden from every public listing, RSS, and its own URL until
  then)
- Under "Site": theme accent/background color, site-wide font, a
  site-wide footer (same markdown support), a default share image (with
  per-page/article overrides), and **Backup** — download everything as
  one JSON file, or restore from one (replaces all current content,
  atomically — a bad file can't half-wipe the site)
- Check "Analytics" for views/day, top pages, top referrers, top
  countries — no third-party dashboard needed
- Create new pages with "+ Page" — they get their own URL but aren't
  auto-added to the nav; add a Button block linking to them if you want
  them reachable from elsewhere
- "Redirects" sends an old URL to a new one (301 or 302) — handy after
  renaming or deleting a page or post so old links don't just 404
- Press **Ctrl/Cmd+K** anywhere in the admin for a search/command palette —
  jump to a page, article, or block by text match, or open any panel.
  Ctrl/Cmd+S saves the current form; with a block selected, Delete removes
  it and arrow keys nudge it a grid unit at a time (both blocked from
  overlapping, same as dragging)
- Every page and article keeps a **History** — the last 20 versions, each
  restorable, and restoring itself saves the current state first so it's
  undoable
- A draft or scheduled article's editor shows a **Preview** link that
  works while logged in, even though the article isn't public yet
- A block's Style panel has a "Hide from live site" checkbox — keeps the
  block (and its position) without publishing it
- Under "Site" → Advanced: custom `<head>` code (a verification meta tag,
  a script, anything trusted) injected on every page, and a webhook URL
  that gets POSTed `{title, slug, url, published_at}` the moment an
  article is published
- Under "Site" → Link Checker: scans every button/project-card/article
  link — internal paths are checked against real pages/articles/redirects,
  external ones get a live request — and flags anything broken

Changes save immediately — no separate publish step.

## Local development

```bash
npm install -g wrangler   # if you don't have it
cp .dev.vars.example .dev.vars   # fill in a password + session secret
wrangler d1 execute dominickdominick --local --file=./schema.sql
wrangler dev --local
```

## Deploying

Push to `main` — Cloudflare Workers Builds auto-deploys via
`npx wrangler deploy`. The D1 binding is already declared in
`wrangler.jsonc`. Two secrets must be set once in the Cloudflare dashboard
(Worker → Settings → Variables and Secrets, as **Secret**, not plain text):

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
