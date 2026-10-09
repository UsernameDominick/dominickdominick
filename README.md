# dominickdominick.com

A small personal site on a Cloudflare Worker: a home page, the **Studio** (a music maker that runs in the browser), and two password-protected **study modules** that open from buttons on the home page.

## What is here

- **Home (`/`)**: a page of blocks (heading, text, image, button, divider, spacer, quote, gallery, study) stored in D1 and edited in `/admin`.
- **Studio (`/studio`)**: five fixed tracks (drums, bass, chords, melody, lead) with a step sequencer, a piano roll, forty instruments, fifteen drum kits, MIDI keyboard input, live play and song files. Everything a visitor makes stays in their own browser; nothing is sent to the site.
- **Study modules**: the A+ Core 1 drill and the WGU C777 web development drill, shown in a popup after a password. Progress is kept in the browser.
- **Admin (`/admin`)**: the owner's page editor, image library, a few site settings, backups, and a read-only view of the features board and the project outline.

The look is "Bit bento": ink on paper, Mac-style windows, pixel type and one orange accent. Light is dark ink on warm cream; dark is the same screen inverted onto soft charcoal.

## How it works

- **`worker/`**: the Worker. `index.js` routes the few public addresses, `render.js` builds the HTML, `admin-api.js` is every `/api/admin/*` route, `db.js` is all the SQL, `study/` is the study modules.
- **`public/`**: static files served straight from the asset store: the stylesheet, `nav.js`, the Studio (`studio.js`, `app-kit.js`, `song-engine.js`) and the admin app (`public/admin/`).
- **D1** (`dominickdominick`): pages, blocks, media records, settings, revisions and the error log. **R2** (`dominickdominick-media`): uploaded images and the daily JSON backups.

## Run it locally

```bash
npm install
cp .dev.vars.example .dev.vars   # then put your own values in it
npm run db:local                 # local database: schema, migrations and the home page
npm run dev                      # http://localhost:8787, admin at /admin
```

```bash
npm test                         # the pure tests, a few seconds
npm run test:e2e                 # the browser tests (cd tests/e2e && npm install first)
npm run smoke -- http://localhost:8787
```

## Shipping

`main` is the live site. Work on a branch and open a pull request: CI checks it and posts a preview address. Merging deploys and smoke-tests the live site and rolls back if the smoke test fails. Database migrations go through the separate **Migrate** workflow, which waits for approval. The full picture and the one-time setup are in [`outline.md`](outline.md) (section 0).
