# claude.md

this file tells claude how it's allowed to work on this repo. it's public on purpose, so anyone can see the extent of ai use on the site. the short version for visitors is the "how the site uses ai" section in the readme.

## the line

i write and design the site myself. claude is for:

- **tooling**: the github actions checks, deploys and config
- **docs**: the readme and this file
- **git**: branches, merges and cleanup
- **the project board**: planning and sorting cards (see below)
- **menial work** when i ask for it, like formatting the file paths for the nav links or html boilerplate for a new page

claude doesn't write or redesign the site's pages, styles or scripts on its own. if a change to `public/` is needed, it explains the change and i make it, unless i ask claude to make it. the settings make claude ask before it edits anything in `public/`.

## the mockups

the site's design started as mockups i made with claude, through a lot of back and forth. those mockups live in `docs/mockups/` and are a reference only. i build the real site from them by hand.

- don't "improve" the real site's design to match the mockups unless i ask
- `docs/` isn't part of the site. only `public/` gets deployed

## the project board

the plan for the site lives on the [project board](https://github.com/users/usernamedominick/projects/1/views/1). when i ask, claude re-sorts it: it reads the code to see what's done, then moves the cards where they belong.

- re-sorting the board never touches the code. no edits, commits or pushes during it
- claude can move, edit, add or remove cards

## my writing

claude doesn't rewrite my own words without asking. that covers the about me, the readme's voice and the "how the site uses ai" section. it can point out typos or suggest wording, and i decide what goes in.

## mark every change

anything claude adds or changes in the site's code gets a `- claude -` comment at the start and a `- end claude -` comment at the end, so it's always clear what wasn't written by hand:

- html: `<!-- - claude - -->` ... `<!-- - end claude - -->`
- css: `/* - claude - */` ... `/* - end claude - */`
- javascript: `// - claude -` ... `// - end claude -`

the rules for markers:

- markers only go around code that exists in the repo. if claude deletes something, there's no marker for it. the commit message says what was removed
- the markers stay forever. claude never removes a marker. the one exception for moving: if i ask claude to change code inside a section it already marked, and that change shifts where the section starts or ends, claude moves its own markers to match
- markdown docs and the workflow files don't get markers. the readme's "how the site uses ai" section covers those

## commits

- commit as `UsernameDominick <gentile.dominick14@gmail.com>`
- claude is never the author or co-author of anything in this repo. never add a `Co-Authored-By` or session line to commit messages or pull requests
- work on the `testing` branch. only bring changes into `main` when i say so
- never force-push, to any branch
- never rewrite history or delete branches (reset --hard, rebase, amend, filter-branch) unless i give the ok first

## checks

- the checks in `.github/workflows/check.yml` must pass before anything goes to `main`
- if they're failing, claude doesn't merge or push to `main` unless i specifically say to, even then it tells me what's failing first

## style

- the readme is all lowercase, business casual
- the site is plain html, css and javascript. don't add frameworks, build steps or packages
