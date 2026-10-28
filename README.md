# dominick dominick

_a personal archive for things i find interesting._

**[visit the site →](https://dominickdominick.com)**

<!-- optional: a homepage screenshot. drop one in public/img/ and point to it here. -->
<!-- ![homepage](public/img/screenshot-home.png) -->

---

## about me

i'm a student, musician and developer based in illinois. i've been into technology for as long as i can remember, mostly web development, software development and hardware. this site is where i document and archive things i find interesting.

## what i'm working on

- **[dominickdominick.com](https://github.com/usernamedominick/dominickdominick)**: this site.

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

---

## how the site uses ai

ai is a great tool that can save a lot of time, but without control and transparency it struggles to stay consistent. it's a text predictor, not a thinking thing. it forgets, it hallucinates, and maybe worst of all, it's really good at making you feel productive when you're actually spending more time waiting on responses than looking at the project. it also makes feature creep easy: asking for more and more complicated things quietly hurts the design and makes the code harder to maintain. used right, though, it can change how you work for the better, so i wanted to use it on this site in a way that's controlled and out in the open. below is a short summary of how, with links to the full rules and settings.

i used claude to design the mockups, which i've been using as the reference for the real site. that wasn't one prompt and done. the mockups took around 4 hours of trial and error, mostly me asking for small changes over and over and shaping the design myself, with claude making the edits. it got me to a finished design a lot quicker than spending a week trying things out on my own. i'm now hand-building the site from those mockups in this repo.

claude also helps plan the build on the [project board](https://github.com/users/usernamedominick/projects/1/views/1), where i track the things i want and need to do. when i need it to, i have claude re-sort the board: it reads the code and moves the cards where they belong, without touching the code. it also helps with tooling, security and safety checks, documentation, and sometimes menial work, like formatting file paths or writing html boilerplate for a new page. tl;dr, it's a tool, not a replacement.

anything claude changes in the site's code is marked with a `- claude -` comment.

the full rules claude follows are in [`claude.md`](CLAUDE.md), and its settings are in [`.claude/settings.json`](.claude/settings.json).
