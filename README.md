# dominick dominick

_a personal archive for things i find interesting._

**[visit the site →](https://dominickdominick.com)**

---

## me

i'm a student based in illinois. i've been into technology for as long as i can remember, mostly web development, software development and hardware. this site is a place to document and archive things i find interesting.

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

ai is a great tool that can save a lot of time, but without control and transparency it struggles to stay consistent. it's a text predictor, at the end of the day. it forgets, it hallucinates and, maybe worst of all, it's gotten really good at making you feel productive when in reality you're spending more time waiting on responses than looking at your actual project. it also makes feature creep easy, asking for more and more complicated things quietly hurts the design and makes the code harder to maintain. that being said, used right, though, it can change how you work. so i wanted to use it on this site in a way that's controlled and transparent. below is a short summary of how, with links to the full rules and settings.

i used claude to make the mockups that are used for me to reference in building the site. this helped me get a finalized design out in hours, instead of spending two weeks going through a hundred different iterations. it still took a lot of back and forth, just way less than doing it all by hand. claude also helps plan the build on the [project board](https://github.com/users/usernamedominick/projects/1/views/1), where i track the things i want and need to do. when i need it to, i have claude re-sort the board. it reads the code and moves the cards where they belong, without touching the code. it also helps with tooling, security and safety checks, documentation, and sometimes menial work, like formatting file paths or writing html boilerplate for a new page. 

tl;dr, it's a tool, not a replacement.

anything claude changes in the site's code is marked with a `- claude -` comment.

the full rules claude follows are in [`claude.md`](.claude/CLAUDE.md), and its settings are in [`.claude/settings.json`](.claude/settings.json).

## license 
Code is MIT licensed. Site content, writing, and images © Dominick Gentile, all rights reserved.
