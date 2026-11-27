# DTU Science Writer

WYSIWYG writing of scientific papers and proposals: visual equation editor, numbered sections, figures
and equations, cross-references, live page preview (Typst), export to PDF and Word.
Design and plan: [DESIGN.md](DESIGN.md) (source of truth). Status: **phase 1 (prototype) done 2026-11-26.**

## Run
- `start.cmd` — rebuilds the editor bundle and starts the app from source.
- First time on a PC: `powershell -File tools\setup.ps1` (installs Electron, libraries and Typst into
  `%LOCALAPPDATA%\dtu-science-writer-build`, outside Dropbox).
- From a VS Code terminal, clear `ELECTRON_RUN_AS_NODE` first (start.cmd does).
- Help → *Open sample paper* loads a 4-page demo with 11 equations, 3 figures and a table.
- Desktop shortcut + double-clickable `.dtusw` files for the source version: `powershell -File tools\install-source.ps1`
  (current Windows user only; `-Remove` undoes it). The installed version registers itself instead.
- Running from source, the app shows "A newer version … is ready" when main/ or the built renderer change (Restart now).

## Build and release (same scheme as DTU Planner)
- Local: `powershell -File tools\build-exe.ps1` → `dist\DTUScienceWriter-<version>-setup.exe` and `-portable.exe`
  (Electron + Typst + math fonts + Typst packages inside; ~130 MB).
- Release: bump `version` in package.json; in a clean worktree of the DEX repo's origin/main run
  `powershell -File tools\publish-dex.ps1 <worktree>` (copies the app to `tools/dtu-science-writer/app` and the workflow
  `tools/dex/dtu-science-writer-release.yml` to `.github/workflows/`), commit, push, then push the tag
  `dtu-science-writer-v<version>`. The workflow builds on windows-latest and publishes the versioned release plus the rolling
  pre-release `dtu-science-writer` with `latest.json` (version, URL, SHA-512).
- Installed copies read that `latest.json` 20 s after start and every 6 h (`main/update.js`), download the installer, check the
  SHA-512 and offer *Restart now* (silent install). Portable copies only link to the download page.
  Test locally with `DTUSW_UPDATE_URL=http://127.0.0.1:<port>/latest.json` (a URL as a command-line argument is swallowed).

## Using it
| Action | How |
|---|---|
| New document | New / Ctrl+N: pick a template — Article (default), Lecture notes, Thesis, Report, Notes, Proposal, Blank (`src/core/templates.js`). File → Save as template… stores the open document in `<settings folder>\templates\`; New lists them under "Your templates" (× deletes). The last choice is preselected |
| Journal / funder | New → Article: type a journal (the 39 of Journal style); New → Proposal: a funder and call (ERC, Horizon Europe, Villum, DFF, Novo Nordisk Foundation, Carlsberg, Innovation Fund Denmark). Skeleton, style and limits from `src/core/venues.json` (each entry: sources + date checked). The status bar counts against the limits (`ui/limits.js`; page limits per section from a Typst position query); click for details, type, Stop checking |
| Math in the text | Ctrl+M, or type `$x^2$` |
| Display equation | Ctrl+Shift+M; Enter or Esc leaves the editor; `#` button toggles numbering |
| Figure | Figure button, or paste / drop an image; drag a corner to resize (5 % steps, one undo step); the context row under the toolbar sets *Top of page*, *Bottom of page*, *Here*, *Wrap left/right* and width |
| Table | Table button → pick a size (first row is the header), or paste from Excel / Word (also plain tab-separated text). Tab / Shift+Tab move between cells; Tab in the last cell adds a row. Drag across cells to select them; the context row adds, deletes and moves rows and columns, merges/splits cells, toggles header row/column, aligns columns and sets the placement. Drag a column border to set its width. |
| Cross-reference | Ctrl+R, type to filter, Enter. After a typed "Fig. " / "Table " / "Section " / "Eq. " it shows only the number |
| Comment | select text (or click an equation), Comment button or Ctrl+Alt+M, type, Ctrl+Enter. Cards beside the page: reply, resolve, edit, delete; "show resolved" in the column header. Exported to Word as real comments with replies and resolved state |
| Highlight, text colour | Format → Highlight (Ctrl+Shift+H), Remove highlight, Text colour (red, blue, green, automatic). Shown in the PDF, written to Word and LaTeX, and read from Word (a revised manuscript or a response letter marks its changes so) |
| Track changes | Track button (Ctrl+Shift+T): edits become suggestions in your colour — insertions underlined, deletions struck through, a card beside the page with ✓ Accept / ✗ Reject. Review menu: next change (F7), accept / reject all, show final or original text. PDF shows the final text; Word export writes real Word revisions, and tracked changes made in Word come in as suggestions |
| Help | F1 or the ? in the toolbar: the guide, by topic, with search. Help → Tutorial: a paper to practise in. View → Page breaks in the text marks where each page of the PDF starts while you write |
| Shared drives | opening takes a lock (`~$name.dtusw.lock`); others get the document read-only until it is free. A save never overwrites a file changed since it was opened (conflict copy instead). Autosave + recovery after a crash; File → Backups of this document… |
| Settings | File → Settings…: your name and initials (comments, locks) |
| Authors | click the author block (👤 ✎): names, affiliations (tick per author), corresponding author + e-mail; affiliations from / to the library |
| Style | font pair, body size, title alignment, size/bold/italic/colour/numbering per heading level (1 · i · I · a · A · none), affiliation format |
| Journal style | Format → Journal style… (or Choose journal… in the Style dialog): pick from ~40 journals (numbering, “Fig.”/“Figure”, line spacing, line numbers, reference style in one undo step), or any journal’s reference style from the CSL repository / a .csl file, stored in the document |
| Supplementary Information | Insert → Supplementary Information adds the SI as a second tab of the same document (figures, tables, equations and sections numbered S1, S2, …; references between manuscript and SI stay live). PDF and Word export write `name` and `name-SI`. File → Import Word document as Supplementary Information… brings an existing SI in. The SI starts with its name (click to change it), then the paper's title and authors; untick "Same title and authors as the paper" to type its own |
| Zotero | Format → Add references to Zotero library sends the complete, verified references (collection named after the paper); incomplete or typed ones are listed, not sent |
| Headings | style box, Ctrl+Alt+1/2/3, or type `# ` / `## ` at the start of a line |
| Lists | buttons, or type `- ` / `1. ` |
| Export | PDF button (Ctrl+E), Word button (Ctrl+Shift+E) |
| Import from Word | File → Import Word document…: the .docx opens as a new document (the Word file is not changed); a report lists what arrived and what to check. Word equations, captions, cross-references, comments, footnotes, lists, tables and Zotero citations become live items; tracked changes are accepted; MathType equations become placeholders to retype. Typed "[1]" references: Format → Convert typed references |

Files are `.dtusw` (a zip: `manifest.json`, `document.json`, `media/`).

## Code
- `main/` — Electron main: `main.js` (window, menu, dialogs, atomic saves), `typst.js` (runs Typst), `preload.js`, `testdriver.js`.
- `src/core/` — document model, no DOM: `schema.js`, `numbering.js`, `typst.js` (→ Typst), `docx.js` (→ Word),
  `mathconv.js` (LaTeX → Typst math / MathML), `omml.js` (MathML → Word equations), `docxin.js` + `ommlin.js` + `xml.js` (Word → document), `fileformat.js`, `media.js`,
  `typst-symfix.json` (generated by `tools/check-symbols.js`).
- `src/renderer/` — editor: `app.js` (UI, preview, files, export), `editor.js`, `plugins.js` (ids, numbering,
  input rules), `mathview.js` (MathLive equation editing), `figures.js` (insert, figure bar, image view with resize handles), `tables.js` (table tool on prosemirror-tables),
  `ctxbar.js` (context row under the toolbar), `sample.js`.
- `renderer/` — `index.html`, `style.css`, `bundle.js` (built), `mathlive/` (copied by the build).
- `vendor/typst-packages/` — Typst packages used offline (meander for wrapped figures + its dependency).
- `assets/fonts/` — Libertinus Serif, New Computer Modern (OFL), the same fonts Typst embeds.

## Tests
- `node tests/math-corpus.js` — 61 equations through LaTeX→Typst (each compiled) and LaTeX→Word math.
- `node tests/docx-corpus.js` then `pwsh -File tests\word-check.ps1 tests\out\math-corpus.docx tests\out\word-corpus`
  — opens the file in Word, counts equations/fields, checks that refreshing fields changes nothing, exports PDF pages.
- `tests\run.cmd tests\wordimport.js` — a document with everything → Word → import, compared block by block; `node tests/ommlin-core.js` — equations LaTeX → Word → LaTeX; `node tests/wordimport-real.js` — a manuscript made by Word itself (needs Word and PowerShell 7).
- `node tests/realdocs.js` — two real manuscripts (read in place, skipped when absent); `node tests/journal-core.js` and `tests\run.cmd tests\journal.js` — journal styles.
- `node tests/si-core.js` and `tests\run.cmd tests\si.js` — Supplementary Information: numbering, the split into two documents, export, tabs.
- `node tests/wordroundtrip.js` — our file through Word and back (needs Word): tracked equations and inline math survive Word saving the file, Word's Accept / Reject, equations a Word author types or edits with tracking on, highlight and colour, text typed into a citation, MathType inside a Word equation. `tests/roundtrip/` holds the longer multi-author pressure test (WORD-ROUNDTRIP-2026-11-27.md).
- `node tests/track-core.js` (engine + 400 random edit sequences), `tests\run.cmd tests\track.js` (in the app), `node tests/track-word.js` (Word's own Accept All / Reject All against ours) — track changes.
- `tests\run.cmd tests\step9.js` (page breaks, guide, tutorial) and `tests\run.cmd tests\hardening.js` (what a hostile page or document could try, with the path rules on).
- `tests\run.cmd tests\venues.js` — every journal / funder template builds and typesets; limits (words, display items, references, pages per section); the New dialog's row; Journal style sets the limits.
- `tests\run.cmd tests\templates.js` — every template typesets and exports; the New chooser; Save as template, reopen, delete.
- `tests\run.cmd tests\phase1.js` — sample paper in the app: preview, PDF, Word, save + reopen round trip.
- `tests\run.cmd tests\editing.js` — real key events: math editor, `$…$`, equations, Ctrl+R picker, figure bar, undo.
- `tests\run.cmd tests\titleblock.js` — left title block, authors dialog, affiliation library and formats, heading numbering styles (I / a / none / level 4).
- `tests\run.cmd tests\manuscript-antidot.js` — builds the 8-page example manuscript (all elements) into `RESEARCH - MANUSCRIPTS\2027 DTU SCIENCE WRITER`.
- `tests\run.cmd tests\style.js` — document style: defaults, dialog (font, colour, size), editor/PDF/Word, undo, save.
- `tests\run.cmd tests\wrap.js` — wrapped figure in editor and preview (screenshot `tests/out/wrap.png`, Typst source `wrap.typ`).
- `tests\run.cmd tests\tables.js` — tables (picker, Tab, merge, align, Excel/Word/TSV paste, numbering, export) and corner-drag resizing.
- After updating Typst or tex2typst: `node tools/check-symbols.js`.
