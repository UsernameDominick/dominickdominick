# dominickdominick.com — notes for Claude

A personal site on Cloudflare. **It is almost empty on purpose.** On 2026-10-09 the owner deleted everything to start over, at their own explicit instruction: the Studio music maker, the search dialog and nav, the two study modules, the admin panel, the tests, the old build pipeline and the whole git history. Nothing of it can be restored from here and nothing should be looked for or recreated unasked: the owner builds the rest themselves and wants only what is needed to do that. `README.md` has the Cloudflare resources and the database notes.

## What is here

| Path | What it is |
|---|---|
| `public/index.html` | The whole site: a heading (`dominickdominick.com`). Everything in `public/` is served as is. |
| `wrangler.jsonc` | The Cloudflare config: the Worker name `dominickdominick`, the compatibility date and `assets.directory` (`./public`). No Worker script and no bindings yet. |
| `.github/workflows/deploy.yml` | A push to `main` (or a manual run) deploys to Cloudflare with `npx wrangler@4.149.0 deploy`, using the repository secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` (it skips with a notice when they are missing). |
| `schema.sql`, `migrations/` | The D1 database shape: the bootstrap, then the numbered migrations. The production database still holds the old site's tables and rows; nothing reads them. |
| `README.md` | The Cloudflare resources (database and bucket names and ids), how to bind the database, how to apply the database files. |

There is no `package.json`, no test and no other CI. A push to `main` ships, so look carefully before pushing, or use a branch and a pull request.

## Working here

- **Never force-push without the owner's explicit instruction** (history was rewritten on 2026-10-08 and wiped on 2026-10-09, both on their say-so).
- **Commit messages are a plain bulleted list of the changes and nothing else**: no attribution or co-author lines, no session links, no tool or model names, in commits, code comments or any file. Commit only files you changed for the task (`git add <paths>`, not `-A`).
- **The owner's computer does not run `wrangler dev` or browser tests** (they open windows and popups). `wrangler deploy --dry-run` is fine. Browser tests, if they come back, run in CI on Linux.
- **Production database changes** (migrations, data fixes) need the owner's explicit say-so each time. Never touch the live site or call external services from tests.
- **Windows:** the repo is developed on Windows and Linux. Do not use `new URL(...).pathname` for file paths (use `fileURLToPath`), and start `npx`/`npm` from node with `shell` and `windowsHide: true`.

## Rules that stay

1. **Text is at least 16px and has real contrast.** The owner found the old site's small pixel type, dithered shadows and dotted lines hard on the eyes: use plain solid lines and flat fills, and check any new colour.
2. **No emoji anywhere on the site**, including symbols phones draw as emoji (play, pause, stop, record, the north-east arrow, warning sign): use words or a drawn icon. Plain text marks (✓ × ← → ♪ ©) are fine.
3. **No inline script or style and no `eval`** (a content security policy with `default-src 'self'`), unless the owner asks for what needs it.
4. **Anything that animates sits inside `@media (prefers-reduced-motion: no-preference)`.**
5. **D1 allows 100 bound variables per statement.** Chunk big `IN (…)` lists (90 per chunk).
6. **Escape text from users or scripts** before it goes into HTML.
7. **Audio plays only after a click.** Never autoplay.

## Working with the owner

Casual, direct, short. Ask when the request is vague instead of guessing. Push back lightly when something doesn't add up. Make a recommendation instead of listing every option. Ask before anything hard to reverse or outward-facing, and before paid services, costly-to-reverse architecture and visible design choices. Otherwise prefer forward progress without repeated check-ins.
