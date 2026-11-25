# DTU Planner — design

*Called One Todo Tree until 2026-11-25. Renamed so there is one program for everyone: the same build for the author and colleagues, published on DEX with self-update. Personal categories live in the data folder only; a new data folder starts with Topic 1–4 + People.*

Planning tool for project "atoms": a mind-map of tasks → subtasks → … under fixed
categories, with progress, criticality, urgency, deadlines, people, budget and
attachments. Monthly (or ad-hoc) **editions** you can flip through.

Decisions agreed with Peter, 2026-11-24.

## Platform
- **Electron desktop app**, Windows PCs (laptop + stationary). Shareable as a portable
  `.exe` (runtime bundled; no installs for colleagues). Data folder chosen on first start.
- Starts **in the tray at login**, window on demand (tray click or **Ctrl+Alt+T**).
- **Light + dark**, follows Windows, toggle in toolbar.
- Source here; `node_modules` live outside Dropbox in
  `%LOCALAPPDATA%\one-todo-tree-build` (Electron, electron-builder).
- Phone: **read-only PDF** written into the data folder (`phone/`), read in the Dropbox app.

## Data folder (`Dropbox\ACTIVITIES\One Todo Tree Data`)
```
editions/<id>.json        one file per edition (e.g. 2026-11.json), always editable
people.json               shared people list (all editions)
settings.json             categories (name, colour, order), defaults
journal/<id>/*.json.gz    rolling saved states (≤ 1 per 2 min, last 300 kept)
snapshots/<id>/YYYY-MM-DD.json.gz   one per day per edition, kept forever
files/<Category>/<node>/  attachments that were copied in
phone/One Todo Tree.pdf   phone view
locks/<id>.lock           which machine has an edition open (heartbeat)
```
A second mirror of every save goes to `%APPDATA%\One Todo Tree\mirror` (outside Dropbox).

### No data loss
1. Writes go to `*.tmp`, are flushed, then renamed over the target (retry on Dropbox locks).
2. Before every write the file on disk is compared with what this app last wrote/read;
   if another machine changed it, the app **does not overwrite**: it asks (reload theirs /
   keep mine — the other version is saved as a journal entry either way).
3. Journal + daily snapshots + local mirror + Dropbox version history; "Restore…" dialog.
4. Delete = to the edition's trash (restorable) + unlimited undo/redo in the session.
5. Lock file with heartbeat: warns if the edition is open on the other PC.
6. Corrupt/unparseable file on load → newest valid journal entry offered automatically.

## Model
Node: `id` (stable across editions), `parent`, `children[]`, `title`, `notes`,
`stage` (leaves only: 0 Not started, 1 Started, 2 Nearly done, 3 Done → 0/33/67/100 %),
`weight` (default 1), `crit` 1–3 | null (inherit), `urg` 1–3 | null (inherit),
`deadline` YYYY-MM-DD | null (inherit), `lead` days (default 14; step to 3 in last 3 days),
`owner`, `stakeholders[]` (people ids, optional — never nagged), `budget {alloc, spent, cur}`,
`attachments[]` (file link in place / copied file / URL), `relates[]` (node ids), `collapsed`.
- Progress of a parent = weighted mean of children.
- Effective crit/urg/deadline: own value, else parent's (inherited shown greyed).
- Effective urgency = max(set/inherited urgency, deadline ramp): ≥2 within `lead` days,
  3 within 3 days, overdue flagged. A subtask deadline after its parent's is flagged.
- Budget: own value if set, else sum of children (per currency).
- Category nodes (14, from settings) are the top level; renamed/reordered only in Settings.

## Interaction
- Views: **Map (centre)**, **Tree (left)**, **Outline** (numbered, columns),
  **Matrix** (Urgent × Critical 3×3, open leaves, drag to re-rate).
- Mouse wheel over a **leaf** steps its stage; wheel elsewhere zooms.
- Tab child, Enter sibling, F2/double-click rename, Del to trash, Ctrl+X/C/V (subtrees; plain
  indented text also pastes as nodes and copies out as text), Ctrl+Z/Y, arrows, Space collapse,
  Alt+↑/↓ reorder, drag-to-reparent, Ctrl+F search, F focus branch, Ctrl+1–4 views.
- Attachments: drop file → link in place (stored relative to Dropbox root so both PCs resolve
  it); files outside Dropbox or Ctrl-drop → copied into `files/`. URLs too.
- Relates-to links: dashed curves in the map.
- People dialog: by name, or grouped by project.
- New edition: from scratch / selected branches / full copy (option: drop finished leaves).

## Added 2026-11-25 — main categories arranged by the user (optional)
- Settings › Map layout: **Balanced automatically** (default, as before) / **Arranged by me**.
  `settings.mapLayout = {mode: 'auto'|'manual', sides: {catKey: {side: 'R'|'L'|'T'|'B', order}}}` — in settings, so
  every edition and both PCs share it; switching back to automatic keeps `sides` for later; "Forget my arrangement"
  clears them.
- Only the root's children (main categories) are placed; everything inside a branch keeps the automatic layout, and
  drag on subcategories/tasks still means move/reorder. Dragging a category only does something in manual mode (in
  auto mode a one-time hint points to the setting). The side follows the pointer's direction from the title; the place
  its position among that side's categories; the drag label says e.g. "Talks → above the title, place 2".
- Layout (`map.js` layout/arrangement): right/left stacks as before; above/below = a level row of branches (each still
  growing to the right), centred, moved clear of the stacks where it reaches over them, so nothing overlaps.
  Categories not placed yet keep their automatic side (switching on changes nothing until you drag). Edges to the
  rows are org-chart style: up/down out of the title, along the free lane next to the row, into the category.
  Tree view, focus and spotlight use the automatic layout.

## Added 2026-11-25 — backup export / import, to-dos under timeline steps
- **Export backup…** (edition menu, Settings › Data, History): one plain JSON file
  `{type:'onetodotree-backup', format, created, machine, app, version, settings, people, editions:{id:edition}, templates, notes}`
  (`store.buildBackup`; an unreadable edition is replaced by its newest journal/snapshot backup and noted). Attachment
  files are not included, only their links. Default folder Documents, then the last one used (`config.exportDir`).
- **Import backup…** reads such a file, or a single edition (`.json`, or a journal/snapshot `.json.gz`). Dialog lists
  each edition (new / replaces the current one, with counts and dates), people, settings, templates as ticks.
  `store.applyImport` first writes `backups/before-import-<stamp>.json` (importing it undoes the import), then saves
  with journal entries. The renderer stops saving (`S.importing`) and reloads the window; a toast reports the result.
- **Timeline to-dos**: `step.todos = [{id, text, done}]`. In the add box a date line followed by `- …` lines
  (`M.parseSteps`, `M.parseTodo`: dash/bullet + space; `-14 …` without space is still a date) makes a step with to-dos;
  a date line without title for a date that already has a step adds to it; `- …` lines with no date line go under the
  next open step (`OTT.attachStep`). Enter after a lone date or a to-do starts the next `- ` line, Enter on an empty
  `- ` (or Ctrl+Enter) adds. Ticking the last to-do marks the step done, unticking reopens it; ticking the step ticks
  all. Shown in the inspector (editable), the pinned map list and the pop-up; `M.stepTitle` names untitled steps
  after their first open to-do (calendar, reminders, phone PDF).

## Added 2026-11-25 — multiple selection
- `S.multi` (2+ ids) next to `S.sel` (the current item: inspector, keys). Map/tree: Shift or Ctrl+click toggles an
  item; outline/side panel: Shift = range in visible order (from `S.multiAnchor`), Ctrl = toggle. Categories/root
  are never part of it. Plain click clears; pressing on a selected item keeps the selection so it can be dragged.
- Commands use `OTT.topIds` (items inside another selected item travel with it, tree order). Ctrl+C/X copy/cut all
  (one clip with several roots), Ctrl+V pastes them into the clicked target and leaves the pasted items selected;
  drag moves all (`C.moveMany`, one undo step), Ctrl held at the drop copies (`C.copyTo`); Del = `C.removeMany`
  (one undo step, one Trash entry per branch). Right-click inside the selection: Move to… / Copy to… (next click
  is the target, `S.pickTo`), Cut, Copy, Delete N, Clear. Outline crit/urg dots on a selected row rate all selected
  tasks. Status bar chip "N selected" (✕ clears); Esc clears.

## Added 2026-11-25 — information notes, past-item review, Edit category, generic package
- **Information note** (`kind: 'info'`): title + text (`notes`) with auto-linked URLs + attached links/files +
  relations. No progress/date/rating/timeline: derive gives progress null (ignored in roll-ups), not a
  leaf (not in matrix/status counts), skipped by calendar/dueItems. Map: pale blue square card, blue
  italic "i" (hover = text pop-up with live links), italic title, link-count badge. Cannot hold
  children (addChild/move/paste refuse). Right-click: Add information note / Make information note
  (leaf tasks) / Make task. Carried into new editions like tasks.
- **New edition** defaults to *Copy everything*. Items with an own date that has passed (deadline gone,
  period ended; done ones only if "leave out finished" is off) are listed one by one: unfinished
  deadlines ticked (carry over), ended periods/finished unticked. `makeEdition({exclude})`.
- **Edit category…** (category right-click + category panel) opens Settings at that row.
- **Generic package**: `tools\build-exe.ps1 -Flavor generic` puts `tools\flavors\generic.json` in the app
  as `flavor.json`; main calls `M.setStartCategories` → a NEW data folder starts with Topic 1–4 +
  People (Colleagues/Partners/Other). Existing data folders are untouched. Output
  `OneTodoTree-<ver>-generic-portable.exe` / `-generic-setup.exe`.

## Added 2026-11-25 — periods + Calendar view
- **Period** = `deadline` (start) + `end`. One date = deadline. A period ramps urgency towards its START,
  is `now` while it runs (urgency 2), and is never overdue; after it ends it shows "ended" and the
  inspector offers "Mark done". Reminders: "starts in N days" / "happening now". `n.color` overrides
  the category colour on the calendar only. Date fields are typed DD/MM/YY (+ calendar button);
  in the end field "+4"/"fri" count from the start. Moving the start keeps the period length.
- **Calendar view** (Ctrl+5, renderer/calendar.js): one column per month, 31 day rows, Danish day
  letters + month names, ISO week numbers on Mondays, weekends grey, `M.dkDays(y)` holidays (red),
  customary days off (light red), special days (grey text). DTU periods (`settings.semesters`, seeded
  from student.dtu.dk 2026/27, editable in Settings) as a strip at the column's right edge.
  Items: periods = solid bars, deadlines = ⚑ pills, timeline steps = dashed pills; overlapping items
  share the width per cluster; bars crossing months continue. Click = status card (stages, facts,
  Show in tree, step done, Details); double-click = show in tree; drag over days = new period,
  double-click a day = new deadline (asks title + category, remembers it). Toolbar: ◀ Today ▶,
  months 1–24, presets (academic/calendar year), Steps / Done / DTU toggles, category chips.
- **Print / PDF**: the same percent-based markup in a light self-contained page → `cal:pdf` →
  printToPDF one landscape page (A3/A4) → `<data>/calendar/…pdf`, opened for printing.

## Added 2026-11-25 — timelines (dated steps towards a deadline)
- `node.timeline = [{id, title, date, done}]` (kept date-sorted), `node.tlPin` = shown open on the map.
- Inspector › Timeline: rows (tick, date, title, remove), today marker, deadline row; quick-add line
  parsed by `M.parseStep` (1 Dec · 1/12 · ISO · -14 / 2w before = from deadline · +7 / in 2 weeks ·
  weekday · today/tomorrow · "deadline …"), date at start or end, several pasted lines at once, live
  preview; "Copy steps from…" shifts dates by the deadline difference and reopens them.
- Map: badge `done/n` (red = missed step, amber = next step ≤ 3 days); hover = pop-up list with ticks +
  Pin/Edit; click on the map badge toggles the pinned list inside the card (title row keeps its height
  `g.hh`, edges attach to it). Outline rows get the same badge/pop-up.
- Urgency: a missed open step → 3, next step within FINAL_DAYS → 2 (`d.stepRamp`). `dueItems` adds step
  items (`step` id; ≤ 7 days or missed) → toasts, morning summary, phone PDF.

## Added 2026-11-24 (same day, after first use)
- **Node colours** (Settings › Node colours, `settings.nodeColors`: `classic` | `frame`). `frame`: criticality
  = frame colour + thickness (blue 1.7 / violet 2.7 / near-black 3.8 px; light versions in dark theme),
  urgency = fill (pale yellow / orange / soft red), unrated = white card (dark card in dark theme).
  Uses the effective (inherited, deadline-ramped) values; done tasks get no urgency fill. Body class `cs-frame`.
- **Subcategories** (`kind: 'group'` outside People): right-click › Make subcategory / Make task / Add
  subcategory; allowed directly under a category or subcategory; nest freely; can carry deadline/crit
  that tasks inherit. People groups can have subgroups (children of any People group are persons).
- **Delete category** in Settings: its branches in the current edition go to Trash; settings keeps it as
  `archived` so older editions still show it; Restore brings it back. People cannot be deleted.
- **Structure templates** (`templates/<name>.json`, subcategory trees per category key, no tasks):
  edition menu › Save structure as template…; New edition › From scratch › Structure = current
  subcategories / a template / only categories. Replaced/deleted templates kept in `.replaced`/`.deleted`.
- **Hover pop-up** on 📎 / 📝 badges (map, outline, side panel, matrix): Open / Show in Explorer /
  notes preview; click pins it; Ctrl+O opens the selected task's attachment.
- **Large trees**: Spotlight, side panel (own folding), collapse all but this, levels Alt+1–4.
- Esc on a *new* item keeps typed text (only empty new items are discarded).

## Notifications
- Toasts from the tray app when an item steps up in urgency or becomes overdue (once each).
- Morning summary via Task Scheduler (`--morning`), works when the app is closed.
