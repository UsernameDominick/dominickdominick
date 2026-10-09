# dominickdominick.com

Almost empty on purpose: one page with a heading, live on Cloudflare, ready to be built on. The owner deleted the earlier site, its tests and its git history on 2026-10-09 to start over.

## What is here

- `public/index.html`: the whole site, a heading. Everything in `public/` is served exactly as it is.
- `wrangler.jsonc`: the Cloudflare config (the Worker's name and the folder to serve).
- `.github/workflows/deploy.yml`: puts the site live.
- `schema.sql` and `migrations/`: the shape of the D1 database.
- `CLAUDE.md`: the working notes for Claude.

## How it goes live

A push to `main` runs the Deploy workflow, which runs `wrangler deploy` and publishes `public/` at dominickdominick.com. Watch it in the repository's Actions tab. It needs two repository secrets, `CLOUDFLARE_API_TOKEN` (a token that can edit Workers Scripts) and `CLOUDFLARE_ACCOUNT_ID`; without them it skips itself with a notice and nothing is published. There are no tests or other checks: what is on `main` is what ships.

## Cloudflare

These resources exist in the Cloudflare account and are left untouched:

| What | Name | Id |
|---|---|---|
| D1 database, production | `dominickdominick` | `f49fb038-9dfb-419e-acfb-7d8babc9d509` |
| D1 database, preview | `dominickdominick-preview` | `6b4b23d0-d680-4320-83c0-bc144f1cf3d9` |
| R2 bucket, production | `dominickdominick-media` | |
| R2 bucket, preview | `dominickdominick-media-preview` | |

The production database still holds the tables and rows of the old site (nothing reads them). The site is not connected to it right now, because a site made only of files has no code to use it. To connect it, add a Worker script (`"main": "worker/index.js"` in `wrangler.jsonc`) and the binding:

```jsonc
"d1_databases": [
	{ "binding": "DB", "database_name": "dominickdominick", "database_id": "f49fb038-9dfb-419e-acfb-7d8babc9d509", "migrations_dir": "migrations" }
]
```

## The database files

`schema.sql` is the bootstrap for a fresh database. The numbered files in `migrations/` add columns on top of it: apply the bootstrap first and then the migrations in order. With the binding above:

```bash
npx wrangler d1 execute DB --local --file=schema.sql
npx wrangler d1 migrations apply DB --local
```
