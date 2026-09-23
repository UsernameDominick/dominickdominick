# dominickdominick.com

A Cloudflare Worker + D1 site with a built-in visual page editor.

## How it works

- **`worker/`** — the Worker script. Renders every page from data stored in D1
  (a real database), handles the `/api/admin/*` endpoints, and generates
  `sitemap.xml`/`robots.txt` dynamically.
- **`public/`** — static assets: `style.css`, `nav.js`, and the admin app
  (`public/admin/`). Served directly by Cloudflare, no Worker code involved.
- **D1 database** (`dominickdominick`) — holds `pages`, `blocks` (the actual
  content, positioned on a 12-column grid), and `articles` (posts under
  Random).

## Editing content

Go to `/admin` and log in with the admin password (set as a Cloudflare
Worker secret, not stored in this repo). From there:

- Drag blocks around, resize them from the bottom-right corner
- Add new block types from the left palette
- Edit a selected block's content in the right-hand panel
- Manage Random posts under the "Articles" button
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
