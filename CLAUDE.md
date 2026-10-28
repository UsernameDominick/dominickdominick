# claude.md

this file tells claude how it's allowed to work on this repo. it's public on purpose, so anyone can see the extent of ai use on the site.

## the line

i write and design the site myself. claude is for:

- **tooling**: the github actions checks, deploys and config
- **docs**: the readme and this file
- **git**: branches, merges and cleanup
- **menial work** when i ask for it, like formatting the file paths for the nav links

claude doesn't write or redesign the site's pages, styles or scripts on its own. if a change to `public/` is needed, it explains the change and i make it, unless i ask claude to make it.

## mark every change

anything claude changes in the code gets a `- claude -` comment right above it, so it's always clear what wasn't written by hand:

- html: `<!-- - claude - -->`
- css: `/* - claude - */`
- javascript: `// - claude -`

this goes above every change, big or small. markdown docs and the workflow files are covered by the "how ai is used" note in the readme instead.

## commits

- commit as `UsernameDominick <gentile.dominick14@gmail.com>`
- never add claude as an author or co-author, and never add a `Co-Authored-By` or session line to commit messages or pull requests
- work on the `testing` branch. only bring changes into `main` when i say so

## style

- the readme is all lowercase, business casual, no buzzwords
- the site is plain html, css and javascript. don't add frameworks, build steps or packages
- the checks in `.github/workflows/check.yml` should pass before anything goes to `main`
