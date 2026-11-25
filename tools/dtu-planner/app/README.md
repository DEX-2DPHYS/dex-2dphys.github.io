# DTU Planner

Desktop planning tree (Electron, Windows): categories, tasks, people, deadlines, timelines, a calendar
and an Urgent × Critical matrix. Called *One Todo Tree* until 2026-11-25. Design decisions:
[DESIGN.md](DESIGN.md). Licence: MIT ([LICENSE](LICENSE)).

Download page: https://dex-2dphys.github.io/tools/dtu-planner/

## Run
- **Installed** (`DTUPlanner-<version>-setup.exe`, per user, no admin): updates itself. It checks
  `releases/download/dtu-planner/latest.json` on the DEX repository at start and every 6 h, downloads the
  new installer, verifies its SHA-512 and offers *Restart now*; the update installs silently.
- **Portable** (`DTUPlanner-<version>-portable.exe`): no install; tells you when a new version is out.
- **From source** (development): `%LOCALAPPDATA%\one-todo-tree-build\node_modules\electron\dist\electron.exe "<this folder>"`.
  Edits take effect on the next start (the app offers a restart when the source changes).
  From a VS Code terminal, clear `ELECTRON_RUN_AS_NODE` first (VS Code sets it, and Electron then
  behaves like plain Node).

On first start it asks where to keep its data (suggests a Dropbox folder if there is one, else
Documents). A synced folder keeps the tree on all your PCs; two PCs may use the same folder (locks
warn when an edition is open elsewhere, conflicts are detected instead of overwritten).

Moving from One Todo Tree: the first start of DTU Planner copies the old settings
(`%APPDATA%\One Todo Tree\config.json`: data folder, view, theme, window) and replaces the old autostart
entry and morning task with DTU Planner ones. An existing `One Todo Tree Data` folder is used as it is.

## Data
`editions/*.json` (one per edition) · `people.json` · `settings.json` · `journal/` (every save,
≤1 per 2 min, last 300) · `snapshots/` (one per day, forever) · `files/` (copied attachments) ·
`phone/DTU Planner.pdf` · `calendar/` · `templates/` · `locks/`. A mirror of every save is kept in
`%APPDATA%\DTU Planner\mirror` (outside the synced folder). App settings: `%APPDATA%\DTU Planner\config.json`.
A new data folder starts with the categories Topic 1–4 + People; rename them via right-click › Edit category…

## Code
- `main/` — Electron main: `main.js` (window, tray, hotkey, IPC, notifications, autostart, morning
  task, self-update, one-time move from One Todo Tree), `store.js` (atomic writes, conflict detection,
  journal/snapshots/mirror, recovery, locks, attachments), `phone.js` (PDF), `preload.js`, `testdriver.js` (test mode).
- `shared/model.js` — pure model: derived progress/urgency/inheritance, editions, People branch rules,
  Danish holidays, DTU periods.
- `renderer/` — `app.js` (state, undo, saving, commands, clipboard, keys), `map.js` (centre + left
  tree, spotlight), `outline.js` (outline + side panel), `matrix.js`, `calendar.js`, `inspector.js`,
  `dialogs.js`, `boot.js`, `styles.css`.

## Test mode
`electron.exe "<this folder>" --test --data <dir> --userdata <dir> --script <file.js> --out <log>`
runs a script `module.exports = async (t) => {...}` with `t.exec(js)`, `t.shot(png)`, `t.key()`,
`t.type()`, `t.wheel()`, `t.clip()`. The window opens off-screen; nothing touches the real data.
Self-update test: add `--update-url http://127.0.0.1:<port>/latest.json` as the LAST argument (Electron
refuses switches after a URL) to an installed copy; it then checks at once and, in test mode, installs
without restarting.

## Build and release
- Local: `powershell -File tools\build-exe.ps1` (electron-builder in `%LOCALAPPDATA%\one-todo-tree-build`,
  outside Dropbox) → `dist\DTUPlanner-<version>-setup.exe` and `-portable.exe`.
- Release: copy this folder to `tools/dtu-planner/app/` in the DEX repository
  (`tools\publish-dex.ps1 <dex checkout>`), bump `version` in package.json, commit, and push a tag
  `dtu-planner-v<version>`. The workflow `dtu-planner-release.yml` builds on GitHub, publishes the
  versioned release (never marked *latest*, so DSW's download links keep working) and refreshes the
  rolling release `dtu-planner` (stable download names + `latest.json`).
