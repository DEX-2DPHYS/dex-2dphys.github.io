# Apps

Each app lives in its own folder under `apps/`, keeping its code, assets and
metadata together. The landing page (`/index.html`) reads this data at runtime
and renders the app grid plus the tag-filter bar.

## How it fits together

```
apps/
├── manifest.json        ← central registry: label definitions + list of app slugs
├── example-app/
│   ├── app.json         ← this app's metadata (name, description, tags, …)
│   └── index.html       ← the app itself
└── some-other-app/
    ├── app.json
    └── index.html
```

A static site (GitHub Pages) can't list a directory, so `manifest.json` is the
one place that records **which** app folders exist and **what** the shared
labels are. Everything else about an app lives next to the app.

## Adding an app

1. Create a folder `apps/<slug>/` with an `index.html` in it.
2. Add `apps/<slug>/app.json` (schema below).
3. Add `"<slug>"` to the `apps` array in `manifest.json`.
4. Optionally drop a 16:9 screenshot at `assets/app-previews/<slug>.png`.

That's it — the landing page picks it up on the next load. If no screenshot
exists, the card silently renders without one.

## `manifest.json`

| Field    | Type     | Notes                                                        |
|----------|----------|--------------------------------------------------------------|
| `labels` | array    | The tag vocabulary. Each has `id`, `name`, `description`. Order here is the display order of the filter chips. |
| `apps`   | string[] | App slugs, each matching a folder name under `apps/`.        |

To add a new label, add an entry to `labels`; apps reference it by `id`.

## `app.json`

| Field         | Type     | Notes                                                                 |
|---------------|----------|-----------------------------------------------------------------------|
| `slug`        | string   | Must match the folder name.                                           |
| `name`        | string   | Display name.                                                         |
| `description` | string   | One or two sentences shown on the card.                               |
| `status`      | string   | `"live"` or `"coming-soon"`. `live` cards link to `url`.              |
| `url`         | string   | Link to the app, e.g. `"apps/example-app/index.html"`. Leave `""` while coming soon. |
| `icon`        | string   | Icon key from the set in `index.html`: `clock`, `moon`, `heart`, `home`, `camera`, `music`, `note`, `map`, `game`, `chart`, `wrench`, `sparkle`, `more`. Unknown keys fall back to `more`. |
| `tags`        | string[] | Label `id`s from `manifest.json`. An app may carry several.           |
| `note`        | string   | Optional italic line under the description.                           |
| `preview`     | string   | Optional explicit screenshot path. Defaults to `assets/app-previews/<slug>.png`. |
| `repo`        | string   | Optional source link, shown on `coming-soon` cards.                   |

### Tags / labels

Tags are assigned **here**, in each app's `app.json` — that is the source of
truth. The filter bar on the site lets visitors *select* labels to narrow the
grid; it does not (and on a static host cannot) write changes back. To re-tag
an app, edit its `tags` array and commit.

## Moving an app over from DEX

The layout is deliberately the same as the DEX site, with `tools/` → `apps/`
and `tool.json` → `app.json`. To move a tool across:

1. Copy `tools/<slug>/` from the DEX repo to `apps/<slug>/` here.
2. Rename `tool.json` to `app.json` and update `url` to `apps/<slug>/index.html`.
3. Swap its `tags` for labels that exist in this `manifest.json`.
4. Add the slug to the `apps` array.
5. Copy `assets/tool-previews/<slug>.png` to `assets/app-previews/<slug>.png`.
