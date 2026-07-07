# Tools

Each DEX tool lives in its own folder under `tools/`, keeping its code, assets,
and metadata together. The landing page (`/index.html`) reads this data at
runtime and renders the tool grid plus the tag-filter bar.

## How it fits together

```
tools/
├── manifest.json        ← central registry: label definitions + list of tool slugs
├── transim/
│   └── tool.json        ← this tool's metadata (name, description, tags, …)
└── labtcad/
    └── tool.json
```

A static site (GitHub Pages) can't list a directory, so `manifest.json` is the
one place that records **which** tool folders exist and **what** the shared
labels are. Everything else about a tool lives next to the tool.

## Adding a tool

1. Create a folder `tools/<slug>/`.
2. Add `tools/<slug>/tool.json` (schema below).
3. Add `"<slug>"` to the `tools` array in `manifest.json`.

That's it — the landing page picks it up on the next load.

## `manifest.json`

| Field    | Type     | Notes                                                        |
|----------|----------|-------------------------------------------------------------|
| `labels` | array    | The tag vocabulary. Each has `id`, `name`, `description`. Order here is the display order of the filter chips. |
| `tools`  | string[] | Tool slugs, each matching a folder name under `tools/`.     |

To add a new label, add an entry to `labels`; tools reference it by `id`.

## `tool.json`

| Field         | Type     | Notes                                                                 |
|---------------|----------|-----------------------------------------------------------------------|
| `slug`        | string   | Must match the folder name.                                           |
| `name`        | string   | Display name.                                                         |
| `description` | string   | One or two sentences shown on the card.                              |
| `status`      | string   | `"coming-soon"` or `"live"`. `live` cards link to `url`.             |
| `url`         | string   | Link to the tool (e.g. `"tools/transim/"`). Leave `""` while coming soon. |
| `icon`        | string   | Icon key from the set in `index.html` (`transport`, `device`, `chart`, `atom`, `book`, `more`). Unknown keys fall back to a default. |
| `tags`        | string[] | Label `id`s from `manifest.json`. A tool may have several.            |

### Tags / labels

Tags are assigned **here**, in each tool's `tool.json` — that is the source of
truth. The filter bar on the site lets visitors *select* labels to narrow the
grid; it does not (and on a static host cannot) write changes back. To re-tag a
tool, edit its `tags` array and commit.
