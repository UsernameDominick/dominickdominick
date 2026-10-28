# dominick dominick

<!-- One line about who you are or what you do. Keep it short enough to read in a glance. -->
_Tagline goes here._

**[Visit the site →](https://LIVE-URL-HERE)**

<!-- Optional: a homepage screenshot. Drop one in public/img/ and point to it here. -->
<!-- ![Homepage](public/img/screenshot-home.png) -->

---

## About me

<!--
Two or three sentences, first person. What you're into, what you're working toward.
This can mirror the "about" section and keywords on the home page.
Business casual: contractions are fine, skip buzzwords like "passionate" or "leveraging".
-->

Write a short intro here.

## What I'm working on

<!-- Mirror the projects page. One line each, with a link. Keep it to your best few. -->

- **Project name**: one line on what it is. [link](#)
- **Project name**: one line on what it is. [link](#)

## Find me

<!-- Only list places you actually check. -->

- GitHub: [@usernamedominick](https://github.com/usernamedominick)
- Email: you@example.com
- LinkedIn: [link](#)

---

## About this site

<!-- Everything below is the documentation half: for people curious how the site works. -->

My personal site, built from scratch. It has three sections:

| Page | Path | What it's for |
| --- | --- | --- |
| Home | `/` | About me and keywords |
| Projects | `/projects/` | Things I've built |
| Random | `/random/` | Everything else |

### Built with

- Plain HTML, CSS and JavaScript, no framework or build step
- Hosted on [Cloudflare](https://developers.cloudflare.com/workers/static-assets/) as static files (config in `wrangler.jsonc`)

<!-- If skipping a framework was on purpose, one sentence on why makes this more interesting. -->

### Project structure

```
public/
├── index.html          home page
├── projects/index.html projects page
├── random/index.html   random page
├── 404.html            shown for pages that don't exist
├── styles.css          all styles
├── script.js           all scripts
├── img/                images
├── fonts/              fonts
└── _headers            security and cache headers
.github/workflows/      automated checks (see below)
wrangler.jsonc          Cloudflare config
```

### Quality checks

Two GitHub Actions workflows keep the site healthy:

- **Check** (`check.yml`) validates the HTML on every push.
- **Live site** (`live.yml`) waits for Cloudflare to finish deploying, then checks every page on the live site. It also runs once a day.

### Run it locally

Open `public/index.html` in a browser, or run it the way Cloudflare does:

```sh
npx wrangler dev
```

### Roadmap

<!-- What's next. Being upfront that the site is in progress reads well. Delete items as you ship them. -->

- [ ] Fill in the about section and keywords on the home page
- [ ] Add projects
- [ ] Add content to the random page
