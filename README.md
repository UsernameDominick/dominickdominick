# dominickdominick.com

A small personal site on a Cloudflare Worker: the **Studio** (a music maker that runs in the browser: the whole public site), a search and command dialog behind a magnifier in the nav, and two password-protected **study modules** that open when their name is typed in that search.

## What is here

- **Front door (`/`)**: sends a visitor to the Studio (there is no home page).
- **Search**: the magnifier in the nav (or Ctrl/Cmd+K) opens a dialog that filters its rows as you type: dark or light, reduced motion, text size, the Studio. Typing `core 1` or `c777` shows a study module, which asks for its password.
- **Studio (`/studio`)**: five fixed tracks (drums, bass, chords, melody, lead) with a step sequencer, a piano roll, forty instruments, fifteen drum kits, MIDI keyboard input, live play and song files. Everything a visitor makes stays in their own browser; nothing is sent to the site.
- **Study modules**: the A+ Core 1 drill and the WGU C777 web development drill, shown in a popup after a password. Progress is kept in the browser.

The look is "Bit bento": ink on paper, Mac-style windows, pixel type and one orange accent. Light is dark ink on warm cream; dark is the same screen inverted onto soft charcoal.

## How it works

- **`worker/`**: the Worker. `index.js` routes the few public addresses, `render.js` builds the HTML, `db.js` is the little SQL left (the error log and the rate limit), `study/` is the study modules.
- **`public/`**: static files served straight from the asset store: the stylesheet, `nav.js` and the Studio (`studio.js`, `app-kit.js`, `song-engine.js`).
- **D1** (`dominickdominick`): the error log and the rate limit; it still holds the tables of the features that were cut (nothing reads them). There is no admin panel (removed 2026-10-09).

## Run it locally

```bash
npm install
npm run db:local                 # local database: schema, migrations and the home page
npm run dev                      # http://localhost:8787
```

```bash
npm test                         # the pure tests, a few seconds
npm run test:e2e                 # the browser tests (cd tests/e2e && npm install first)
npm run smoke -- http://localhost:8787
```

## Shipping

`main` is the live site. Work on a branch and open a pull request: CI checks it and posts a preview address. Merging deploys and smoke-tests the live site and rolls back if the smoke test fails. Database migrations go through the separate **Migrate** workflow, which waits for approval. The full picture and the one-time setup are in [`outline.md`](outline.md) (section 0).
