# dominickdominick.com — notes for Claude

A personal site on Cloudflare. **It is almost empty on purpose.** On 2026-10-09 the owner deleted everything to start over, at their own explicit instruction: the Studio music maker, the search dialog and nav, the two study modules, the admin panel, the tests, the old build pipeline, the README, the database files (`schema.sql` and `migrations/`) and the whole git history. Nothing of it can be restored from here and nothing should be looked for or recreated unasked: the owner builds the rest themselves and wants only what is needed to do that.

## What is here

| Path | What it is |
|---|---|
| `public/index.html`, `gate.css`, `gate.js` | The whole site: a password box, and a blank page once the right password is entered. `gate.js` holds only a salted PBKDF2 hash of the password (never the password), checked in the browser, so it is a front door and not real security. Everything in `public/` is served as is. |
| `wrangler.jsonc` | The Cloudflare config: the Worker name `dominickdominick`, the compatibility date and `assets.directory` (`./public`). No Worker script and no bindings. Cloudflare's build reads it, so keep it valid. |
| `CLAUDE.md` | This file. |

## How it goes live

**Cloudflare publishes `main`, not GitHub.** The Worker `dominickdominick` is connected to this repository through Cloudflare's own GitHub integration (Workers Builds): each push to `main` is built and deployed with `wrangler deploy` and is live within about a minute (the owner confirmed it is Cloudflare doing it). There is no GitHub Actions workflow, no repository secret, no test and no other CI. A push to `main` ships, so look carefully before pushing, or use a branch and a pull request. A broken `wrangler.jsonc` fails the build and Cloudflare emails the owner. After a push, `https://dominickdominick.com/` shows the new page when the build is done.

## In the Cloudflare account (not in the repo, left untouched)

| What | Name | Id |
|---|---|---|
| D1 database, production | `dominickdominick` | `f49fb038-9dfb-419e-acfb-7d8babc9d509` |
| D1 database, preview | `dominickdominick-preview` | `6b4b23d0-d680-4320-83c0-bc144f1cf3d9` |
| R2 bucket, production | `dominickdominick-media` | |
| R2 bucket, preview | `dominickdominick-media-preview` | |

The production database still holds the old site's tables and rows (nothing reads them), and its migrations were applied there, so its schema lives in Cloudflare, not in the repo (`wrangler d1 export` can write it out). The site is not connected to it: a site of plain files has no code to use it. To connect it, add a Worker script (`"main"` in `wrangler.jsonc`) and a `d1_databases` entry with `"binding": "DB"`, the name and the id above.

## Working here

- **Never force-push without the owner's explicit instruction** (history was rewritten on 2026-10-08 and wiped on 2026-10-09, both on their say-so).
- **Commit messages are a plain bulleted list of the changes and nothing else**: no attribution or co-author lines, no session links, no tool or model names, in commits, code comments or any file. Commit only files you changed for the task (`git add <paths>`, not `-A`).
- **The owner's computer does not run `wrangler dev` or browser tests** (they open windows and popups). `npx wrangler@4.149.0 deploy --dry-run` is fine for checking the config. Browser tests, if they come back, run in CI on Linux.
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
