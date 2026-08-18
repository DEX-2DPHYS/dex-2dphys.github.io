# Brokild Apps

A personal collection of small, browser-based apps, published with GitHub Pages.

Same shape as the DEX site: a static `index.html` that reads
`apps/manifest.json` at runtime and renders a filterable card grid. No build
step, no framework, no dependencies — edit the files, commit, and the site
updates.

```
.
├── index.html                  ← the landing page (grid, filters, theme toggle)
├── apps/
│   ├── manifest.json           ← labels + the list of app slugs
│   ├── README.md               ← how to add an app
│   └── example-app/
│       ├── app.json            ← card metadata
│       └── index.html          ← the app itself
├── assets/app-previews/        ← optional 16:9 screenshots, named <slug>.png
└── .nojekyll                   ← serve files as-is, skip Jekyll processing
```

## Publishing this on GitHub Pages

Pick whichever matches how `BrokildApps` was created.

### A. `BrokildApps` is a GitHub account or organisation

Create a repository named exactly `brokildapps.github.io` inside it. The site
is then served from the root of `https://brokildapps.github.io/`.

```bash
git init
git add .
git commit -m "Brokild Apps: initial site"
git branch -M main
git remote add origin https://github.com/BrokildApps/brokildapps.github.io.git
git push -u origin main
```

### B. `BrokildApps` is a repository under a personal account

Then the site is served from a sub-path,
`https://<username>.github.io/BrokildApps/`. Nothing needs to change — every
path in this site is relative, so it works at either address.

```bash
git init
git add .
git commit -m "Brokild Apps: initial site"
git branch -M main
git remote add origin https://github.com/<username>/BrokildApps.git
git push -u origin main
```

### Then turn Pages on

Repository → **Settings** → **Pages** → *Build and deployment* →
Source: **Deploy from a branch**, Branch: **main**, Folder: **/ (root)** → Save.

The first build takes a minute or two. After that, every push to `main` is
live within seconds.

## Working locally

Opening `index.html` straight off disk will show "Couldn't load the app list" —
`fetch()` is blocked for `file://` URLs. Serve the folder instead:

```bash
python3 -m http.server 8000
# then open http://localhost:8000/
```

## Adding an app

See [`apps/README.md`](apps/README.md). Short version: make a folder under
`apps/`, add an `app.json` next to its `index.html`, and list the slug in
`apps/manifest.json`.

## Notes

- `.nojekyll` is there so GitHub Pages serves the tree verbatim — without it,
  files and folders starting with `_` are silently dropped.
- Everything runs client-side. If you add an app that stores data, keep it in
  `localStorage` so the site stays a pure static host with nothing to run.
