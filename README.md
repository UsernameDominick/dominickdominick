# dominickdominick.com

Empty on purpose. On 2026-10-09 the owner deleted the whole site (the code, the tests, the build and deploy pipeline and the git history) to start over. What is left in this repository:

- `README.md`: this file.
- `CLAUDE.md`: the working notes for Claude.
- `schema.sql` and `migrations/`: the shape of the D1 database.

## Cloudflare

The site runs on Cloudflare (a Worker with static files, and D1). These resources exist in the Cloudflare account and were left untouched:

| What | Name | Id |
|---|---|---|
| D1 database, production | `dominickdominick` | `f49fb038-9dfb-419e-acfb-7d8babc9d509` |
| D1 database, preview | `dominickdominick-preview` | `6b4b23d0-d680-4320-83c0-bc144f1cf3d9` |
| R2 bucket, production | `dominickdominick-media` | |
| R2 bucket, preview | `dominickdominick-media-preview` | |

The production database still holds the tables and rows of the old site (nothing reads them). The Worker that was deployed last is still running in Cloudflare and serves a blank page until it is replaced or deleted in the dashboard (Workers & Pages > dominickdominick).

## The database files

`schema.sql` is the bootstrap for a fresh database. The numbered files in `migrations/` add columns on top of it: apply the bootstrap first and then the migrations in order. With a Wrangler config that binds the database as `DB`:

```bash
npx wrangler d1 execute DB --local --file=schema.sql
npx wrangler d1 migrations apply DB --local
```

## Starting again

There is no code, no test, no `wrangler.jsonc` and no GitHub Actions workflow here any more, so a new site needs its own config, its own `public/` folder and a new pipeline.
