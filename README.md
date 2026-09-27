# Em&m Blog: website

The website version of Em&m Blog, a cute diary, pinboard and life app. Plain modern JavaScript (ES modules) + CSS,
no framework, no bundler. It runs in two places from the same code:

- **A normal website** (planned: GitHub Pages at `https://1ninjwarrior.github.io/emm-blog/`, see *Hosting*). Everything
  is saved **in this browser** with IndexedDB (docs + photo/video blobs). Me → *Your data* makes backups.
- **A claude.ai Artifact** (the original home): when `window.claude.use` exists, `store.js` uses the artifact's
  `db` / `assets` / `downloads` capabilities instead.

The phone app (`../emm-blog-app`) is the source of truth for features, data shapes and look ("soft paper, one pink").
Pure logic is compiled straight from the app's TypeScript (see *Build*), so the two behave the same.
`v1-single-file.html` is the old single-file version, kept for reference only.

## Structure

```
index.html              full HTML document: meta viewport, icons (favicon, apple-touch-icon), theme-color, manifest, fonts,
                        CSS, flower SVG symbols, tab bar (Home · Today · ＋ · Lists · Diary; Me behind the ⚙ on Home / rail)
manifest.webmanifest    add-to-home-screen metadata
css/tokens.css          palettes generated from the app's src/theme.ts (5 looks × light/dark)
css/app.css             base, shell, buttons, chips, sheets, toasts, Home, Me
css/calm.css            the app's "soft paper, one pink" design pass (loaded last): no dots, ink titles, borderless cards,
                        flower border opt-in (Me), blossom corner on tab headers, shared .cbox/.pbar/.label-quiet
css/editor.css diary.css lists.css      editor/collage, Diary, Lists
css/today.css garden.css grocery.css recipes-extra.css me-data.css      the newer screens
js/main.js              shell: tabs + #hash routes, overlay routes, ＋ create menu, light/dark + looks, boot
js/store.js             data layer, 3 backends (see Storage). watch/add/set/update/remove/batch/patchSoon, kv, blobs
js/idb.js               tiny IndexedDB wrapper (docs / blobs / meta stores)
js/config.js            GENERATED: API base for recipe import + share links (no tokens)
js/ui.js                DOM helpers, sheets/fullscreen/confirm/choose, toasts, confetti, reconcile, dates, line icons, cornerHTML
js/share.js             canvas → file (downloads / share sheet), copy text, canvas card helpers
js/posts.js days.js demo.js     post helpers, special-day math, ?demo sample data (memory mode only)
js/views/home.js        boards, pin grid, viewer, composer, Today card slot, special day card, ⚙ → #me
js/views/today.js       Today planner, Home Today card, quick add, task sheet, routines editor (#routines)
js/views/garden.js      Habit Garden (#garden), Today's garden row + habits (mountGardenInToday)
js/views/lists.js       Lists tab host + lists; shopping lists get the grocery detail, walk card, addToShoppingList
js/views/recipes.js     recipes grid/editor/viewer/cook mode, import + receive entry points
js/views/countdowns.js diary.js me.js      special days, Diary, Me (+ Your data)
js/grocery/*.js         core (merge/history/settings/drafts), walk (aisle walk + review, #grocery), storeOrder, shopping, addbar
js/recipes/*.js         importer (link/caption/photo import + continue loop), sharing (receive/send links), timers (slim bar)
js/backup/*.js          zip reader/writer, web backup + restore, phone-app backup import (sql.js)
js/editor/*.js          story editor + collage maker
js/app/**               GENERATED from the app's pure TS: today (recurrence, parseTask, templates), garden (growth, rewards,
                        copy), grocery (catalog, parse, order, historyModel, walkModel, money, catalogData), recipes
                        (quantity, parseRecipe, source, tags, importTypes, share/codec)
js/vendor/fflate.js     fflate 0.8.3 (MIT), from the app's node_modules
js/vendor/sql-wasm.*    sql.js 1.13.0 (MIT), lazy-loaded only to import a phone backup
data/catalog.json       GENERATED: the app's grocery catalog (≈2,000 items, 26 aisles), fetched only when grocery opens
img/…                   icons (tab-*, create/*, apple-touch-icon, icon-192), illustrations, stickers, garden/* (256px, quantized)
tools/build.mjs         regenerates js/config.js, js/app/** and data/catalog.json from ../emm-blog-app (not published)
tools/import-ai-images.py   re-imports/downscales AI stickers (not published)
```

## Routes

Tabs: `#home`, `#today`, `#lists` (`#recipes`, `#mylists`, `#specialdays`), `#diary`, `#me`. Overlays open on top of the
current tab: `#garden` (`?plant=1`, `?habit=<id>`), `#routines`, `#grocery` (`?list=<id>` = Add by aisle, `?aisle=`),
`#import?url=…`, `#receive=<payload>` (the part after `#` of a `https://emm-blog-app.expo.app/r#1.…` share link),
`#create`. Hash routes only, so any static host works (no rewrites). Keyboard: `n` opens the create menu.

## Storage (`js/store.js`)

| mode | when | where |
|---|---|---|
| `device` | a normal website | IndexedDB `emm-blog`: store `docs` (key `[collection, id]`, index `c`), `blobs` (id → Blob), `meta` |
| `memory` | `?demo`, or IndexedDB unavailable (some private windows) | in memory; a small "Not saved in this window" pill |
| `live` | claude.ai Artifact | the artifact `db` + `assets` (unchanged) |

- Same API in every mode. Writes are optimistic: the in-memory cache updates and notifies at once, then one IndexedDB
  transaction per change (queued per doc; `batch()` = one transaction). `patchSoon` coalesces fast edits and flushes on
  `pagehide`/hidden. Other open tabs are told via `BroadcastChannel('emm-blog')` and re-read the touched collections.
- Blobs: `upload(blob)` stores it in IndexedDB and returns `{id}`; `blobSrc(id)` returns an object URL created lazily
  and cached per id (blob handles are loaded once at boot; browsers keep them on disk).
- `navigator.storage.persist()` is requested at boot; Me shows `navigator.storage.estimate()` and the note "Saved in this
  browser on this computer. Back up to keep it safe."
- Collections: `boards posts diary recipes lists countdowns` (as before) + `tasks taskDone routines habits habitChecks
  gardenUnlocks kv`. Shapes follow the app's tables in camelCase (e.g. task `{title, dueDate, dueTime, repeat, routineId,
  archived…}`, `taskDone` id `taskId|date`, `habitChecks` id `habitId|date`, `gardenUnlocks` id = reward key). `kv` holds
  synced settings as plain objects under the app's key names (`grocery_history`, `grocery_aisle_numbers`,
  `grocery_walk_draft[:listId]`, `backup_last_manual`, …). List items live inside the list doc with plain extra fields
  `note need for aisle link price` (not the app's `\u001F` text encoding). Per-browser prefs (light/dark, look, flower
  border, open board…) stay in `localStorage` (`emm-*`).

## Backups (Me → Your data)

- **Back up this browser** → `Emm-Blog-web-backup-yyyy-mm-dd-HHmm.zip`: `web-backup.json`
  (`{format:'emm-blog-web-backup', formatVersion:1, createdAt, counts, prefs, collections}`) + `media/<assetId>` (stored).
- **Restore a backup**: validates everything first, confirms with counts, writes media, replaces the collections, reloads.
- **Import from the phone app**: reads the app's backup zip (`manifest.json` + `emm.db` + `media/`), opens `emm.db` with
  sql.js and maps every table (app ids kept; post editor projects kept as `appEdit`, the web shows the flattened render).
- Web → app is **not** supported (the app can't read web backups).

## Recipe import

Calls `https://emm-blog-app.expo.app/api/recipe-import` (the app's EAS Hosting API) cross-origin. The server allows
exactly `https://1ninjwarrior.github.io` (CORS headers are added in `emm-blog-app/server/app/api/recipe-import+api.ts`).
The request needs the app's import code in `x-emm-import-token`; the site **does not ship it**: the import sheet asks
for it once per browser and keeps it in `localStorage` (`emm-import-code`). Follow-ups (`continue`) and the
"Found the full recipe on …" banner work like the app. Share links still point at the `/r` page on EAS Hosting; the
site also accepts pasted share links (and `#receive=…`) and saves them with "Save to my recipes".

## Ask AI to change a recipe

The recipe view has a calm "✨ Ask to change this recipe…" input under the steps (`js/recipes/aiEdit.js`). It POSTs
`{recipe, request}` to `https://emm-blog-app.expo.app/api/recipe-edit` (same CORS + the same per-browser import code
as imports) and shows a **preview** sheet: the summary, the updated recipe with `new` / `edited` markers, a collapsed
"Removed" list, a "Tweak it…" follow-up input (applies to the preview), **Save changes** (in place; toast Undo, and the
previous version goes to kv `recipe_prev_<id>` for the view's "Undo last AI change"), **Save as a new recipe**
("Title (label)", own copy of the photo), Try again and Discard. The AI always gets the recipe at its saved servings.
The highlight logic is the app's `editDiff.ts` (transpiled into `js/app/recipes/editDiff.js`).

## Build

`node tools/build.mjs` regenerates `js/config.js`, `js/app/**` (transpiled with the app's TypeScript: `.js` import
specifiers, `fflate` → `js/vendor/fflate.js`) and `data/catalog.json`. Run it after the app's pure logic or catalog
changes, then check every file parses: `for f in $(find js -name '*.js'); do node --check $f; done`.

## Local preview

`python3 -m http.server 8765` in this folder, then `http://127.0.0.1:8765/index.html#home` (`?demo` for sample data,
memory only). ES modules don't load from `file://`. Recipe import from localhost is blocked by CORS (by design).

## Hosting

Not published yet. The plan was GitHub Pages (a public repo `1ninjwarrior/emm-blog`, served from `main` at
`https://1ninjwarrior.github.io/emm-blog/`, with a `.nojekyll` file); creating the public repo/publishing is waiting on
the owner's go-ahead. Everything is static with relative paths and hash routes, so publishing is just copying these
files: `index.html manifest.webmanifest css/ js/ img/ data/` (never `tools/`, `.capability-docs/`,
`v1-single-file.html`). If the site is hosted on a different origin, add that origin to the API's CORS allow-list.

## Artifact publishing (claude.ai)

Publish `index.html` as the page, with these capabilities:

```
capabilities: { db: { rules: [ { path: "", read: "view", write: "admin" } ] }, assets: {}, downloads: true }
```

Every other file is published next to it at the **same relative path** as it has in this folder (`files` map:
published path to source path):

```
css/tokens.css  css/app.css  css/editor.css  css/diary.css  css/lists.css
js/main.js  js/store.js  js/ui.js  js/share.js  js/posts.js  js/days.js  js/demo.js
js/views/home.js  js/views/diary.js  js/views/lists.js  js/views/recipes.js  js/views/countdowns.js  js/views/me.js
js/editor/editor.js  js/editor/layers.js  js/editor/draw.js  js/editor/filters.js  js/editor/frames.js  js/editor/collage.js
img/app-icon.png  img/icon-96.png  img/icons/*.png  img/illustrations/*.png  img/stickers/*.png  img/stickers/manifest.json
```

Don't publish `README.md`, `tools/`, `.capability-docs/` or `v1-single-file.html`.
When you add stickers, run `python3 tools/import-ai-images.py`, then publish the new PNGs and `manifest.json`.
