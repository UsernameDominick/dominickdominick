# dominick dominick

_a personal archive for things i find interesting._

**[visit the site →](https://dominickdominick.com)**

<!-- optional: a homepage screenshot. drop one in public/img/ and point to it here. -->
<!-- ![homepage](public/img/screenshot-home.png) -->

---

## about me

<!--
two or three sentences, first person. what you're into, what you're working toward.
this can mirror the "about" section and keywords on the home page.
business casual: contractions are fine, skip buzzwords like "passionate" or "leveraging".
-->

write a short intro here.

## what i'm working on

- **[dominickdominick.com](https://github.com/usernamedominick/dominickdominick)**: this site. you're looking at its code.

## find me

- github: [@usernamedominick](https://github.com/usernamedominick)
- linkedin: [dominick gentile](https://www.linkedin.com/in/dominick-gentile)
- email: [gentile.dominick14@gmail.com](mailto:gentile.dominick14@gmail.com)

---

## about this site

the site has three sections:

| page | path | what it's for |
| --- | --- | --- |
| home | `/` | info and quick links |
| projects | `/projects/` | things i've built |
| random | `/random/` | everything else |

### built with

- html, css and javascript
- hosted on [cloudflare](https://developers.cloudflare.com/workers/static-assets/) as static files (config in `wrangler.jsonc`)

### project structure

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
wrangler.jsonc          cloudflare config
```

### quality checks

two github actions workflows keep the site safe and hold it to a standard for accessibility, performance and code quality:

- **check** (`check.yml`) runs on every push. it validates the html, lints the css and javascript, checks links and spelling, keeps images under 300 kb, tests accessibility with axe, makes sure every page lays out at phone, tablet and desktop widths, and requires a lighthouse score of 90+ in performance, accessibility, best practices and seo.
- **live site** (`live.yml`) waits for cloudflare to finish deploying, then checks every page on the live site. it also runs once a day.

every response also ships with security headers (see `public/_headers`).

### run it locally

run it with this command:

```sh
npx wrangler dev
```

and then open it at this link:

```
http://localhost:8787
```

### roadmap

what's planned and in progress lives on the [project board](https://github.com/users/usernamedominick/projects/1/views/1).
