# Study (temporary)

A password-protected study page that opens in a popup from a button on any page. It is here so a friend can use the
A+ Core 1 drill for now; it is meant to be taken out again.

## What it is

- **Add it:** in the admin, open a page, then Add block > Embeds & interactive > **Study (locked)**. It shows as a button
  ("Open study" unless you change the text). Pressing it asks for a password and, if that is right, opens the study page
  in a popup. Esc, the x button, or a press outside closes it; opening it again keeps your place.
- **Password:** **123** (not case sensitive). Set a different one per block in the block's settings; a blank box means
  the default, which is the `DEFAULT_PASSWORD` line in `worker/study/index.js` (or the `STUDY_PASSWORD` variable, if the Worker has one).
- **Not hidden in the page:** the page only contains the button. The password is checked by the Worker (`POST /api/study/unlock`,
  8 wrong tries per 15 minutes per visitor) and the study page is only sent back when it is right. It is shown in a sandboxed frame
  that cannot see this site's cookies, storage or pages. This keeps casual visitors out; it is not strong security (anyone who has
  the password has the page, and the file is in this repository).

## Where things are

- `worker/study/index.js` - the password check, the route handler, the button's HTML. Pure and tested by `tests/study.test.mjs`.
- `worker/study/core1-lab.html` - the study page itself (one self-contained file, shown as-is). To add another one, put its file
  next to it and add a line to `STUDY_LABS` in `index.js` and an option in the block's settings (`app.js`, see below).
- `public/study/study.js`, `public/study/study.css` - the popup. Only loaded on pages that have the block.

## Taking it out

Delete `worker/study/`, `public/study/` and `tests/study.test.mjs`, then remove the few lines elsewhere. Every one is marked
with the words `STUDY (temporary)`; find them with `grep -rn "STUDY (temporary)" worker public tests`:

- `worker/index.js` - the import and the `/api/study/unlock` route.
- `worker/render.js` - the import, the `case "study"` in the block renderer, and the tags line in `pageScriptsHtml`.
- `public/admin/app.js` - the block's name, its defaults, its settings fields and its canvas preview.
- `public/admin/index.html` - the palette button.

Existing Study blocks left on pages simply render nothing once the code is gone (an unknown block type is skipped), but it is tidier
to delete them from the pages first.
