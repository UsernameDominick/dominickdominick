# dominickdominick.com

A personal site on a Cloudflare Worker, started over on 2026-10-09. What is here is the boilerplate to build on:

- **`public/`**: the index page (`index.html`, `style.css`, `robots.txt`) and `_headers`. Static files, served straight from the asset store.
- **`worker/`**: a small Worker that answers every request from `public/` and adds the security headers.
- **`.github/workflows/`**: the pipeline. Every pull request is checked and previewed; every push to `main` is checked, deployed and smoke-tested, and rolled back if the smoke test fails.
- **`schema.sql`, `migrations/`**: the shape of the D1 database (bound as `DB`, not used yet). The production database still holds the tables of the old site, untouched.

The old site (the Studio music maker, the search dialog, the study modules, the admin panel) is not deleted from history: the git tag `before-start-over` is its last working state, and `before-slim-down` is the older, larger site. To look at a file from it: `git show before-start-over:public/studio.js`.

## Run it locally

```bash
npm install
npm run db:local                 # local database: schema and migrations
npm run dev                      # http://localhost:8787
npm test                         # the pure tests
```

`CLAUDE.md` has the working notes (testing, the pipeline, Windows tips) and `outline.md` the release rules, the one-time Cloudflare and GitHub setup and the migration state.
