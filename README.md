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
  List, Video Embed (paste a YouTube or Vimeo URL), Quote, Gallery (a grid
  of images), and Simulation (an animated diagram built in the
  Simulations panel).
- Use the "Media" button, or "Browse…" next to any image field, to reuse
  a previously uploaded image instead of uploading it again.
- The pencil icon on a Media Library image opens the **Photo Editor**:
  crop/select, rotate, brightness/contrast/saturation, an erase/blur/
  pixelate brush, and rectangle/circle/arrow/text annotations, with
  Undo. "Save as new" uploads a fresh file; "Overwrite original" replaces
  the file in place at the same URL, updating it everywhere it's used
  (this is why `/media/:key` now serves a short, revalidating cache
  instead of a year-long immutable one).
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
- "Simulations" is a small builder for wiring-accurate circuit/AV
  diagrams — drag parts (wall outlet, power supply, breadboard, LED,
  resistor, capacitor, inductor, switch, SPDT switch, logic gate, ammeter, voltmeter, battery, a Teensy-style
  microcontroller, a TV/display) onto a canvas and click one pin then
  another to wire them. Logic gates are static diagram symbols (AND, OR,
  NAND, NOR, XOR, XNOR, NOT, buffer) with an editable truth table for
  documentation; signals aren't simulated.
  The simulator solves steady-state circuits (the Wall Outlet counts as a
  steady source): a capacitor blocks current (an open circuit), and an
  inductor passes it like a wire with only its winding resistance; the
  capacitance and inductance values are kept for reference. An SPDT
  (changeover) switch connects its common terminal to one of two throws;
  click it on the canvas or use the inspector to change position. It
  doesn't snap into breadboard holes; wire its three terminals instead.
  A voltmeter reads the voltage between its two probes (it draws no
  current); because the solver follows one path per source, it reads points
  on that path, points wired straight onto it, or the two sides of an open
  circuit, and shows a dash anywhere else.
  Dragging an LED or resistor near a breadboard hole snaps it into place
  and plugs it in automatically, like a real breadboard.
  Select a part and press **R** (Shift+R the other way) to rotate it 90°, or **F** to flip it left to right
  (the Rotate/Flip buttons in the inspector do the same; Flip is always a left/right mirror as you see it). A
  quarter turn keeps the part's centre in place. A part plugged into a breadboard stays plugged in only where its
  legs still land exactly on holes: flipping a resistor end-for-end usually keeps it seated, a quarter turn
  usually lifts it out, and the builder says so when a turn unplugs a lead. Breadboards themselves can't be
  rotated.
  What lights up is computed from an actual closed loop back to an
  outlet or battery — not just "is it connected to something." A
  dangling wire with no return path lights nothing, and an LED wired
  backwards won't light even in an otherwise-complete loop, the same way
  a real one wouldn't; other parts (resistors, wires, a Teensy) aren't
  direction-sensitive, so they conduct either way in this simplified
  model. Wire outlet → power supply → breadboard → Teensy, then Teensy →
  breadboard, and the whole chain lights together once the loop closes.
  A simplified Ohm's-law calculation models voltage, current, and
  resistance over one shortest path per power domain; it is not a general
  SPICE circuit solver. Every part is drawn with gradient shading and highlights
  rather than flat colors. The canvas has zoom controls and larger pins
  on touchscreens so it's usable on a phone, though precise wiring is
  still easier on a bigger screen. Add a simulation to a page/article via
  the Simulation block; readers get a "Power on" button after it is
  published. Draft saves stay hidden from public blocks and project relations.
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

In the page and article editors, changes save immediately. Simulations are
separate: publish a saved simulation before its page blocks or project
relations show it publicly; draft saves remain hidden.

## Local development

```bash
npm install -g wrangler   # if you don't have it
cp .dev.vars.example .dev.vars   # fill in a password + session secret
wrangler d1 execute dominickdominick --local --file=./schema.sql
wrangler d1 migrations apply dominickdominick --local
wrangler dev --local
```

## Deploying

`production` is the pre-release integration branch for active work and
test candidates. Implement one scoped batch, run focused local checks,
then commit and push it to `production` for independent critic review.
Fix findings and rerun the relevant checks there. Promote the reviewed
candidate to `main` only after it scores at least 9/10, has no unresolved
critical or high-severity findings, and meets its required browser/manual
gates. A lower score needs Dominick's explicit acceptance with findings
logged. If browser testing is unavailable, keep the candidate on
`production` and record the manual check that remains.

Cloudflare Workers Builds was verified on 2026-09-27: `main` is the
production branch and preview builds are enabled. Candidate pushes to
`production` create Worker Previews using `npx wrangler preview`; only
pushes to `main` deploy live with `npx wrangler deploy`. See
[Cloudflare's branch configuration](https://developers.cloudflare.com/workers/ci-cd/builds/build-branches/)
and [Worker Previews configuration](https://developers.cloudflare.com/workers/previews/configuration/).

Previews use the `dominickdominick-preview` D1 database and
`dominickdominick-media-preview` R2 bucket configured in `wrangler.jsonc`.
Both are separate from production. The preview D1 was initialized from
`schema.sql` with no production content copied; its R2 bucket is empty.
Every Preview using the same database ID or bucket name shares that test
storage, so use synthetic, namespaced fixtures, avoid conflicting parallel
tests, and clean them up. Never point Preview bindings at production storage.

The dashboard showed “Anyone with this URL can visit” for Preview URLs, so
keep their content non-sensitive unless Cloudflare Access is enabled. See
[Preview access control](https://developers.cloudflare.com/workers/previews/#access-control)
and [Preview resource sharing](https://developers.cloudflare.com/workers/previews/resources/).

For an empty local database, apply `schema.sql` and then the Wrangler
migrations; `schema.sql` intentionally omits columns tracked by migrations so
the bootstrap and migration do not define the same column twice. The migration
ledger tracks simulation publication in
`migrations/0001_simulation_publication.sql`, but it does not reconstruct older
manual schema changes. Wrangler migrations target the selected config's
top-level D1 binding, so use `wrangler.preview-migrations.jsonc` for Preview
work and verify its name/ID against `wrangler.jsonc`'s Preview binding before
applying with `--remote`. Production migration work needs a separate live-schema
inspection and per-instance approval. See [Cloudflare's Preview
D1 migration guidance](https://developers.cloudflare.com/workers/previews/resources/#d1-migrations).

Before changing either ref, recheck both and ensure the new commit is a
fast-forward from that branch's current head. Before promotion, also
verify that `main` is an ancestor of the reviewed `production` candidate.
`production` being ahead during review is expected. If either ref moved
or the histories otherwise diverged, stop and reconcile them. Never
force-push or rewrite either branch.

The Worker requires two Cloudflare Worker Secrets. Configure live values
and separate test-only values in Worker Previews Base; verify them before
protected-flow testing. Store these as **Secrets**, not plain text:

- `ADMIN_PASSWORD`
- `SESSION_SECRET`
