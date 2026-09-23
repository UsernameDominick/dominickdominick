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
  image, theme accent/background/font), `login_attempts` (rate limiting),
  and `pageviews` (self-hosted analytics — path, referrer domain, country,
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
- Manage Random posts under the "Articles" button — tags, drafts, a share
  image, an "Upload image" button that goes straight to R2
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
