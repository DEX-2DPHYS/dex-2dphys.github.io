# DTU Science Writer — design

Name decided 2026-11-26 (was the working name "DTU Manuscript"). File extension `.dtusw`, app id `dk.dtu.sciencewriter`.

This file is the source of truth for the app. Change it when a decision changes; record the date.

Created 2026-11-26.

---

## 1. What it is

A desktop app (Electron) for writing scientific papers and proposals: a WYSIWYG alternative to
Microsoft Word with LaTeX-quality output and a deliberately small set of typographic features.

The writer never types markup. Formatting, equations, figures, citations and cross-references are all
edited visually. The output (PDF, Word, LaTeX) is typeset by an engine, not hand-placed.

### Goals

- Visual editing throughout: no codes, no source view needed.
- A full visual math editor.
- Figures and tables with embedded, automatically numbered captions; three placement modes
  (float, here, wrapped left/right).
- Sections, automatic numbering, table of contents, cross-references.
- Reference management with Zotero integration and standard citation styles.
- Comments (one person editing at a time, so no simultaneous commenting).
- Safe use on a shared drive: only one person can edit at a time.
- Export to PDF, Word (.docx) and LaTeX. Import from Word. Import from LaTeX for a defined subset.
- Same pages on every machine (fonts ship with the app).

### Non-goals

- Free-form typography (arbitrary fonts, sizes, colours, spacing). Styles are fixed per template.
- Real-time collaboration.
- Lossless round-trip of arbitrary Word or LaTeX documents.
- A pixel-exact live paginating editor like Word's Print Layout (see 5.2: the page view is close, the
  preview is exact).

---

## 2. Principles

1. **The document model is the master.** The app stores *what things are* (heading, equation,
   figure, citation), never *how they look*. Word, LaTeX and Typst are generated from it.
2. **A small model makes conversion tractable.** Every node type has a defined mapping to Typst,
   LaTeX and Word (section 7). A feature that cannot be mapped to all three is not added.
3. **Numbers are never typed.** Section, figure, table and equation numbers, citations and
   cross-references are always generated.
4. **Predictable layout over free placement.** Figures follow a few placement rules; they do not
   jump.
5. **Data safety first.** Manuscripts are precious: atomic saves, autosave, rolling backups, never
   overwrite a file that changed on disk since it was opened (section 9).

---

## 3. User-facing features

### 3.1 Text

- Paragraph styles: Body, Heading 1–4, Abstract, Quote, List item (bulleted, numbered),
  Caption (inside figures and tables only), Footnote.
- Inline: **bold**, *italic*, underline, superscript, subscript, small caps, monospace (code), highlight and text
  colour (added 2026-11-27: Word manuscripts and response letters mark their changes with them).
- Fonts: a template chooses one serif, one sans and one mono family (section 10). No per-word font
  choice beyond those families.
- Footnotes.
- Links (URLs).
- Special characters palette (Greek, units, symbols); typed text stays Unicode.

### 3.2 Math

- Inline math and display equations, edited visually with MathLive.
- Typing LaTeX inside the math field is allowed and converts immediately; never required.
- Display equations: numbered or unnumbered; multi-line aligned blocks (align at `=`) with
  per-line numbering; label for cross-reference.
- Matrices, cases, fractions, integrals, sums, accents, operators, units (`\mathrm`), bold vectors.
- Math is stored as LaTeX (the MathLive dialect, restricted to what Typst/Word can represent;
  see 7.4).

### 3.3 Figures

A figure is one block: image(s) + caption + label. The caption is part of the figure and always sits
underneath. Numbering is automatic.

Placement modes:

| Mode | Behaviour |
|---|---|
| **Float** | Fixed to the top (default) or bottom of a page, full text width or a set width, caption underneath. Placed on the page where it is referenced first, or the next. |
| **Here** | Centred in the text flow at this position; text above and below. |
| **Wrap** | Left or right side, text flows past it. Widths: ⅓, ½ or ⅖ of text width. Attached to the paragraph that follows it; if it does not fit on the page, figure and paragraph move to the next page together. |

- Subfigures (a), (b), (c) with sub-captions; panel labels generated.
- Image formats: PNG, JPG, SVG, PDF (vector kept vector in PDF output).
- Image width set by drag handle, snapped to fractions of the text width.

### 3.4 Tables

- Simple grid tables: header row, merged cells, column alignment, booktabs-style rules (top, mid,
  bottom). No cell colours or arbitrary borders.
- Caption *above* the table (scientific convention; template may change it), numbered, labelled.
- Same placement modes as figures except Wrap.
- Inline math allowed in cells.

### 3.5 Structure

- Sections with automatic numbering (template decides: numbered, unnumbered, appendix letters).
- Table of contents block (optional; proposals usually want it, papers usually not).
- Lists of figures/tables (optional blocks).
- Title block: title, authors, affiliations, corresponding author, date, abstract, keywords.
- Page settings from the template: paper size, margins, columns (1 or 2), header/footer,
  page numbers, line numbers (for review copies).

### 3.6 Cross-references

- Insert → Reference to… lists all labelled items (sections, figures, tables, equations).
- Rendered as "Fig. 3", "Eq. (2)", "Section 4.1", "Table 1" (forms per template; "Figure" at sentence
  start).
- Click to jump. Labels are created automatically on insert; the user never sees label names unless
  they want to.

### 3.7 References (citations)

- Each document carries its own reference library (CSL-JSON) inside the file, so the file is
  self-contained on a shared drive.
- Add references by:
  - Zotero picker (Better BibTeX "cite as you write" endpoint, or Zotero 7 local API),
  - DOI / arXiv ID lookup (Crossref / arXiv metadata),
  - BibTeX paste or .bib import,
  - manual entry form.
- Citation styles: CSL. Bundle a short list (Nature, Science, APS/Phys. Rev., ACS, IEEE, APA,
  Vancouver, Harvard) plus "load CSL file". Formatted with citeproc-js.
- Citation forms: [12], (Smith 2024), Smith et al. [12], multiple, ranges, page locators.
- Bibliography block generated at the end (or where placed).
- Export the library to .bib.

### 3.8 Comments

- Select text → Comment. Comment anchored to the range; shown in a margin column.
- Replies in a thread; resolve/reopen; author name and date (author from app settings).
- Comment on figures, equations, table cells.
- Only one editor at a time (section 9), so no merge logic is needed.
- Hidden from PDF by default; option "PDF with comments" (margin notes) for review copies.

### 3.9 Not in v1, candidates later

- Track changes (insertions/deletions as suggestions; accept/reject). Wanted as soon as Word
  co-authors are involved, because their tracked changes need to come in (see 8.1).
- Templates for specific journals and funding agencies (ERC, Villum, DFF, Novo, Horizon Europe).
- Page-limit warning for proposals.
- Spell check (Electron has Hunspell built in: enable English UK/US, Danish).
- Word count by section (proposals).

---

## 4. Architecture

```
Electron main process (Node)
  ├─ file I/O: open/save .dtusw (zip), atomic writes, autosave, backups
  ├─ lock manager (section 9)
  ├─ Typst compiler (bundled, version pinned) → SVG pages for preview, PDF for export
  ├─ exporters: docx writer, LaTeX writer, Typst writer
  ├─ Zotero / Crossref / arXiv bridges (no CORS limits in main)
  └─ self-update (same scheme as DTU Planner)

Renderer (Chromium)
  ├─ editor: ProseMirror (schema in section 6)
  ├─ math: MathLive <math-field> as ProseMirror node views
  ├─ comments margin, outline/navigator, reference manager panel
  └─ preview pane: Typst SVG pages, click-to-jump both ways
```

### 4.1 Technology choices

| Part | Choice | Notes |
|---|---|---|
| Shell | Electron 45.x + electron-builder 26.x | Same as DTU Planner; build folder outside Dropbox (`%LOCALAPPDATA%\dtu-science-writer-build`). |
| Editor | ProseMirror (direct, or via TipTap) | Structured schema, marks for comments, decorations for page boundaries. Decide direct vs TipTap in the prototype; direct ProseMirror is preferred for full control. |
| Math | MathLive | Visual editing, LaTeX in/out, MathML out, virtual keyboard. |
| Layout / PDF | Typst | Bundled CLI first (simplest, exact version pin, ~100 ms recompiles). Move to the in-process WASM compiler (typst.ts) if latency needs it. Typst packages used (wrap: `wrap-it` or `meander`) are vendored offline, never fetched at compile time. |
| Citations | citeproc-js + CSL styles | Also used to produce the formatted bibliography for docx/LaTeX export. |
| Word import | Own reader (`core/xml.js`, `core/ommlin.js`, `core/docxin.js`) | Decided in step 6, see §8.1 and §13: no bundled pandoc. |
| Word export | Own docx writer | Needs fields (SEQ, REF), bookmarks, anchored figure frames, comments, OMML. Evaluate the `docx` npm package as base; fall back to template XML. |
| Math → Word | Temml (LaTeX → MathML) + own MathML → OMML (`src/core/omml.js`) | Decided in phase 1, see §13. |
| LaTeX export | Own writer | Clean, readable LaTeX a co-author could submit. |
| LaTeX import | pandoc for a defined subset | Unknown commands kept as protected raw blocks (shown greyed, round-trip unchanged to LaTeX). |

### 4.2 Prior art to read before building

- **Fidus Writer** (open source, ProseMirror, academic, comments, DOCX/LaTeX/JATS export, citeproc):
  closest existing architecture; read its schema and exporters.
- **LyX** (WYSIWYM over LaTeX): its math editor UX and figure/float model.
- **Typst web app**: preview/click-sync behaviour.
- **TeXmacs**: math editing keyboard flow.

---

## 5. Views

### 5.1 Editing view (always WYSIWYG)

- Real fonts, rendered math, figures with captions, resolved numbers ("Fig. 3"), formatted
  citations, comment highlights.
- Text column at the template's real text width.

### 5.2 Page view (phase 3)

- The editing view drawn as pages: real width and margins, page boundaries shown where Typst
  breaks the pages, header/footer and page numbers drawn in the margins.
- Floats drawn where they are in the flow, with a tag "→ top of p. 4".
- Mechanism: after each Typst compile, query the page and position of every block (Typst
  introspection/labels on blocks) and insert ProseMirror decorations at the matching block starts.
- Known limit: the browser and Typst break lines differently, so a page boundary can fall a line
  earlier or later inside a paragraph. Boundaries are placed at block level exactly and inside
  paragraphs approximately. The preview (5.3) is always exact.

### 5.3 Preview pane

- Exact Typst-rendered pages beside the editor, updated after each pause in typing (debounced).
- Click in preview → cursor jumps to that place in the editor; moving the cursor scrolls the
  preview.
- Can be hidden, or shown full screen as a print preview.

---

## 6. Document model (ProseMirror schema)

Block nodes:

| Node | Attributes | Content |
|---|---|---|
| `doc` | — | `front`, `block+`, `back?` |
| `front` | title, authors[], affiliations[], date, keywords[] | `abstract?` |
| `heading` | level 1–4, numbered, label, appendix | inline |
| `paragraph` | style (body, quote) | inline |
| `list` | ordered, start | `list_item+` |
| `equation` | latex, numbered, label | — (atom) |
| `equation_group` | numbered per line, labels[] | `equation_line+` (aligned) |
| `figure` | placement (float/here/wrap), side, float_pos (top/bottom), width, label | `image+` or `subfigure+`, `caption` |
| `subfigure` | width, label | `image`, `caption?` |
| `table_figure` | placement, label | `caption`, `table` |
| `table` | column alignments, rules | rows/cells (cells hold inline) |
| `caption` | — | inline |
| `toc` / `list_of_figures` / `list_of_tables` | — | — |
| `bibliography` | — | — |
| `raw` | format (latex/typst), source | — (protected import leftovers) |
| `page_break` | — | — |

Inline nodes: `text`, `math_inline` (latex), `citation` (items[{id, locator, prefix, suffix}], mode),
`xref` (target label, form), `footnote` (inline content), `hard_break`.

Marks: `bold`, `italic`, `underline`, `sup`, `sub`, `smallcaps`, `code`, `link` (href), `highlight` (color: a Word
highlighter name), `color` (color: RRGGBB),
`comment` (thread id; may overlap).

Labels are stable generated ids (e.g. `fig-7k2q`), editable as a friendly name in an advanced field.

---

## 7. Mapping to output formats

### 7.1 Typst (preview and PDF)

| Model | Typst |
|---|---|
| heading | `= …` with `numbering` from template, `<label>` |
| equation | `$ … $` block, `<label>`; numbering via `math.equation` settings |
| figure float | `#figure(placement: top/bottom, …, caption: […]) <label>` |
| figure here | `#figure(placement: none, …)` |
| figure wrap | vendored wrap package, figure + following paragraph as its body |
| table_figure | `#figure(kind: table, …)` with caption position from template |
| citation | `@key` / `#cite(<key>, form: …)`; bibliography from the embedded library (exported to a temporary `.bib`/CSL style) |
| xref | `@label` with supplement from template |
| toc | `#outline()` |
| comment | dropped, or margin note in "PDF with comments" |

LaTeX math → Typst math: needs a converter (MathLive LaTeX → Typst). Options: an existing
converter such as `tex2typst` (npm), or MathML → Typst. Verify coverage in the prototype; this is
the first technical risk to test.

### 7.2 Word (.docx)

| Model | Word |
|---|---|
| headings | built-in Heading 1–4 styles with list numbering |
| equation | OMML display math; number in a tab-aligned or table layout + bookmark |
| figure here | inline picture + Caption paragraph with `SEQ Figure` field |
| figure float | picture + caption in an anchored frame, top-and-bottom wrap, anchored to page top (fallback: export as Here, option in the export dialog) |
| figure wrap | anchored frame, square wrap, left/right |
| xref | `REF` field to a bookmark on the caption number, so numbers update in Word |
| citation | formatted text from citeproc (v1); Zotero field codes later, so Word co-authors with Zotero keep live citations |
| bibliography | formatted paragraphs |
| comments | Word comments with author and date |
| toc | Word `TOC` field (updates in Word) |

Fonts: Word on co-authors' machines will not have the bundled fonts. Export maps them to fonts every
Office install has (e.g. serif → Cambria or Times New Roman, math → Cambria Math, sans → Calibri);
template decides. Embedding fonts in the docx is an option to test.

### 7.3 LaTeX

Readable `.tex` + `.bib` + figures folder (zip): `article` class or the template's class, `amsmath`,
`graphicx`, `booktabs`, `wrapfig` (wrap), `float` (`[H]` for Here), `hyperref`, `cleveref`, `biblatex`
or `natbib` per template. Comments optionally as `\todo{}` (todonotes).

### 7.4 Math subset

Store math as LaTeX restricted to what converts cleanly to Typst and OMML. Keep a test file of
~200 representative equations (from the user's own papers) and check every converter against it.

---

## 8. Import

### 8.1 Word

**Done in step 6 (2026-11-26).** File → Import Word document… reads a .docx with our own reader and opens it as a new,
unsaved document; the Word file is never changed. A report dialog lists what arrived (counts) and what to check.
No pandoc: the reader is the mirror of our own Word writer, so the two are tested against each other, it runs in the
page without a 150 MB helper program, and it reads things pandoc drops (REF fields → live cross-references, Zotero
fields → citations with their library, comment replies and resolved state).

- `core/xml.js`: small XML reader (prefixes kept, text exact).
- `core/ommlin.js`: Word equations (OMML) → LaTeX; the mirror of `omml.js`. Test `tests/ommlin-core.js`: the math
  corpus goes LaTeX → OMML → LaTeX → OMML and all 61 are identical.
- `core/docxin.js`: `docxToDocument(bytes)` → `{ json, media, report }`.
  - Styles by their built-in names (independent of Word's language): title, headings 1–4 (numbered only if they are
    in Word), abstract, captions, lists (bullets/numbers, nested), footnotes/endnotes, page breaks.
  - Title block: "Author"/"Affiliation" styles, or — as most manuscripts have none — a plain line under the title that
    reads as a list of names (reported, to be checked), with superscript-marked lines after it as affiliations.
  - Figures: picture + caption paragraph (SEQ field or "Figure 1:" text in any language Word writes) → figure node;
    tables with merged cells and header rows; a table that only lays out an equation and its number → equation.
  - Cross-references: REF fields → live references through the bookmarks; a label typed around a number-only field
    ("Fig. " + field, "Eq. (" + field + ")") is removed where our reference writes the same label, other wordings stay
    and the reference shows the number alone. Unresolvable ones stay as text and are counted.
  - Citations: Zotero fields → citations + library (with the Zotero link); the Zotero bibliography field → the
    reference list; the document's Zotero style → our citation style. Typed "[1]" citations with a typed list stay text,
    and the report offers **Convert typed references** (Format menu), which looks each one up and makes them real.
  - Comments with replies and resolved state, anchored to the same words; comments on equations and figures.
  - Tracked changes: accepted (insertions kept, deletions dropped) and counted in the report; step 8 imports them as
    suggestions.
  - **Tracked changes inside equations** (2026-11-27). Word keeps them inside the math: a run's content in w:ins /
    w:del, a structure inserted or deleted as a whole marked in its m:ctrlPr. `ommlin.js` reads an equation in two
    views (accept / reject); when they differ the import makes it a change — a display equation becomes one
    "changed equation" suggestion (track.kind 'mod'; 'ins' / 'del' when one view is empty), inline math a deleted old
    and an inserted new piece. Structures left empty in a view are dropped. Our export writes such changes the way
    Word does (`docx.js` mathRev: inside every run and every m:ctrlPr), so Word's Accept / Reject remove whole
    fractions and roots. Before this, any equation typed or edited in Word with tracking on, and our own tracked
    equations once Word had saved the file, came back empty (WORD-ROUNDTRIP-2026-11-27.md).
  - Highlight (w:highlight) and font colour (w:color, not auto/black) → marks; written back the same way.
  - Text typed into a citation in Word (the field result differs from the field's plainCitation): an addition before
    or after is kept beside the citation with its revision marks, anything else reported.
  - **MathType** equations are OLE objects, not Word equations: each becomes a placeholder equation
    "[MathType equation n — retype]" and the report says how many; a MathType object inside a Word equation gets the
    placeholder inside the LaTeX. (In Word, MathType → Convert Equations to "Office
    Math" before importing converts them all; a built-in MTEF reader is a possible later addition.)
  - Anything not understood (charts, text boxes, nested tables, pictures in cells) is kept as text where possible and
    always named in the report; nothing is dropped silently.
- Tests: `tests/wordimport.js` (in the app: a document with everything → Word → import; every block, the comment
  threads, the library and the style identical; 9 checks) and `tests/wordimport-real.js` with `tests/word-make.ps1`
  (a manuscript made by Word itself through COM — here a Danish Word, "Figur 1"/"Tabel 1" — equation editor,
  captions, cross-references, comment + reply, tracked changes, footnote, lists, table; 20 checks; run with -Word).
- **Manuscripts typed without Word styles** (tested on two of the user's own papers, `tests/realdocs.js`, read in place,
  skipped where absent): the first line or first heading is the title; a line of names under it is the author line
  (marks as superscripts *or* typed "*"); lines starting with a mark, or "*Email:/Corresponding author", are
  affiliations / e-mails (several corresponding authors each get the address that fits their name); "Abstract" /
  "ABSTRACT:" on its own line opens the abstract, "Keywords" closes it; only when the document uses no heading styles
  at all, lines in capitals, short all-bold lines and usual section names ("Acknowledgments", "Methods") become
  headings; "Figure 1: …" typed under a picture is its caption; a table pasted as a picture keeps its "Table" caption
  (reported); a caption without its picture stays where it was. Every guess is named in the report.
- **Authors survive Word**: the Word export stores the structured author block (affiliation fields, marks,
  corresponding author) as document properties (`DTUSW_AUTHORS_n`); the import uses it when the names in the
  document still match, otherwise it reads the author line afresh.
- **Typed citations** (Format → Convert typed references, `core/typedrefs.js`) also find superscript numbers
  ("…heterostructures¹⁻³", "VASP⁵⁸") but not exponents (after units, numbers, one-letter variables, or a formula:
  "MoS²" typed for MoS₂), and "(refs. 21, 43, 45, 46)" / "[Ref. 12]" written out. A superscript document gets a
  superscript reference style (ACS when the list reads "Surname, A. B.;", else Nature).
- Known, intended differences after a round trip through Word: figures fixed to the page or wrapped by text come back
  as figures in the text (our Word export writes them so).

### 8.2 LaTeX

Defined subset (the same as our LaTeX export, plus common packages). Unknown macros → `raw` nodes.
`.bib` → library. Figures from the paths in the source.

---

## 9. Files, locking, data safety

### 9.1 File format `.dtusw`

A zip (like .docx):

```
manifest.json      format version, app version, template id, created/modified
document.json      ProseMirror doc JSON
comments.json      threads keyed by id (anchors live as marks in document.json)
library.json       CSL-JSON reference items
style/             chosen CSL style + template settings
media/             images (original files, content-hashed names)
```

- Format versioned; migrations on open; never write an older format.
- Large figures stay as the originals; preview uses cached downscaled copies outside the file.

### 9.2 Saving

- Atomic save: write `name.dtusw.tmp` in the same folder, fsync, rename over the original.
- Autosave to a local recovery folder (`%APPDATA%\DTU Science Writer\recovery`) every 30 s while dirty;
  the document file itself is written on explicit save (and optionally on autosave, setting).
- Rolling backups: keep the last N saves per document locally (`%APPDATA%\…\backups`), plus
  daily snapshots for 30 days.

### 9.3 One editor at a time

Lock file `~$name.dtusw.lock` next to the document (JSON: user, machine, pid, opened, heartbeat):

1. On open: create the lock file exclusively (`wx`). If it exists:
   - heartbeat recent → open **read-only** ("Being edited by NN on MACHINE since 10:42"),
     with "notify me when free" and comments disabled;
   - heartbeat stale (> 2 min) → offer to take over.
2. While open: refresh heartbeat every 30 s.
3. On close: delete the lock.

On a real network share (SMB) the exclusive create is reliable. On Dropbox / OneDrive the lock
syncs with a delay, so two people can both get in within a few seconds. Second line of defence:

4. **Hash check on save:** remember the file's hash at open. Before saving, re-hash the file on
   disk; if it changed, never overwrite: save as `name (conflict NN date).dtusw` and tell the user.
5. Detect Dropbox "conflicted copy" files next to the document and warn on open.

### 9.4 Testing data safety

Before any change to load/save code: back up test documents, run old and new code on copies,
compare per-document fingerprints (same discipline as DTU Planner).

---

## 10. Fonts, layout and journal styles

- Fonts: Times New Roman + STIX Two Math, or Arial + Fira Math (`core/style.js`); Word uses Cambria Math.
- **Layout (step 7, 2026-11-26)** in the document style: line spacing 1 / 1.5 / 2, line numbers (PDF, Word, LaTeX; not
  shown while editing), "Fig. 1" or "Figure 1" (captions, references, lists of figures; the import recognises both).
- **Journal styles (step 7)**: Format → Journal style… (also from the Style dialog). `core/journalstyles.js` lists
  ~40 journals in the user's fields by publisher family (APS, AIP, Nature, Science, ACS, IOP, Wiley, Elsevier, RSC,
  PNAS, IEEE); one choice sets heading numbering, figure label, spacing, line numbers and the reference style in one
  undo step; font, sizes and colours stay the author's. Values are starting points from author guidelines; the
  dialog says to check the journal's current guide. Add a journal: one line in JOURNALS.
- **Any other journal**: its reference style from the CSL repository Zotero uses (`main/csl.js`: index cached in
  userData for a month, a dependent style resolved to its parent; a parent we bundle is not downloaded), or a .csl
  file. A style we do not bundle is **stored in the document** (`style.csl = { name, title, xml }`, cite
  `csl:<name>`), so it formats the same on every computer, offline; Word gets its CSL id for Zotero.
- Bundled reference styles (16): APS, Nature, ACS, IEEE, Vancouver, APA, Harvard, AIP, Science, Advanced Materials,
  Advanced Functional Materials, Small, IOP numeric, Elsevier (with titles), RSC, PNAS. Each is tested with a
  reference that has only an article number (`tests/journal-core.js`).
- Not done (decided 2026-11-26): exporting into a publisher's own .dotx template. Journals accept a plain manuscript
  with the right numbering, spacing and references; their Word templates differ in every detail and change often.
  Revisit if a journal insists.
- Tests: `tests/journal-core.js` (36: list, every style, stored style, layout compiled by Typst and pdfLaTeX and
  written to Word), `tests/journal.js` (22, in the app with a stand-in style repository).

### 10.1 Supplementary Information (step 7b, 2026-11-26)

Nearly every paper has an SI, and the main text points into it all the time ("Fig. S3"). So the SI is **the second part
of the same document**, shown as a second tab — not a second file.

- Model: `supplement` (content `block+`, attr title), the optional last node of the document. One file, one lock,
  one reference library, one undo history; comments and (later) track changes cover both parts.
- Numbering (`core/numbering.js`): inside the supplement figures, tables, equations and sections are S1, S2, …
  (sections S1, S1.1 whatever the manuscript's numbering style; unnumbered if the journal style is). Footnotes and
  contents / lists of figures are per part.
- Cross-references between the parts are live in the editor ("Fig. S2" in the manuscript follows the SI).
- `core/parts.js` `splitParts(doc)` → two complete documents for preview and export: the manuscript, and the SI with
  its header (below) and `attrs.part = 'si'`. A reference that crosses
  into the other part becomes its text ("Fig. S3"): the other file cannot be linked to. The writers, given the whole
  document, write the manuscript.
- Header of the SI (2026-11-26, the user's rule): its name, then title, authors and affiliations as on the paper.
  `supplement.attrs`: `title` (the name, default "Supplementary Information", editable — also the tab's text),
  `lock` (default true: title and authors follow the manuscript), `freeTitle`, `freeAuthors` (used when not locked;
  empty = left out). `splitParts` passes them on as `doc.attrs.partLabel` / `partAuthors`; PDF, Word (style
  `PartLabel`, skipped by the reader) and LaTeX write the name above the title. In the editor the header is a widget
  at the top of the SI tab (`editor/siheader.js`): name field, tick box "Same title and authors as the paper",
  and either the paper's header (read only) or two lines to type. Header edits are not tracked changes.
- Each part has its own citation numbering and reference list (as the two files have): `formatReferences(doc, style,
  part)`.
- Editor: tabs "Manuscript | Supplementary Information" in the context row (`ui/parttabs.js`), there once the paper has
  an SI (Insert → Supplementary Information). A tab shows one part (CSS hides the other); the preview shows the part of
  the tab; the tab follows the cursor (a clicked reference, a comment, Ctrl+End). Block commands work one level
  deeper inside the SI (`blockDepth` in editor/mathview.js). Format → Remove Supplementary Information….
- Export: PDF and Word write `name.pdf` + `name-SI.pdf` (`.docx` likewise, also for "Always save a Word copy");
  LaTeX puts `main.tex` and `si.tex` in one project. In Word the "S" is text inside the caption bookmark and the
  counter a SEQ field, headings use an "S%1" list: refreshing fields in Word keeps S1 (checked in Word).
- File → Import Word document as Supplementary Information…: the Word file becomes the SI; its title block is dropped,
  its ids are renamed so none collides, its references join the library.
- References through a list: a reference shows only its number after a typed label *and* after earlier references of
  the list ("Figs. 2a and 3", "Table S1, S2") — `nextContext` / `REF_MARK` in numbering.js, used by the editor and
  all three writers; "Eq. (" + reference gives the bare number.
- Typed cross-references → live (`core/typedxrefs.js`, part of Format → Convert typed references): numbers after
  "Fig.", "Figs.", "Table", "Eq.", "Section", "Supplementary Fig." that match an item of the document, lists and
  panel letters included; the sentence reads exactly as before.
- Not done: one continuous reference numbering across manuscript and SI (some journals); two people editing the two
  parts at the same time (one lock).
- Tests: `tests/si-core.js` (38), `tests/si.js` (36, in the app), the two SI Word files in the Word check.

### 10.2 Track changes (step 8, 2026-11-26)

With **Track** on (toolbar, Review → Track changes, Ctrl+Shift+T; saved in the document as `attrs.tracking`), an
edit is not carried out but recorded as a suggestion by its author, to accept or reject. Rules and engine:
`core/track.js` (no editor in it); editor side: `editor/track.js`, `ui/review.js`, cards in `ui/commentspane.js`.

- **Model.** Text and inline items (math, references, citations, footnotes) carry the mark `ins` or `del` with
  { id, author, initials, time }; deleted content stays in the document until accepted. Blocks carry
  `attrs.track` = { kind, id, author, initials, time }:
  - on a text block (paragraph, heading): the paragraph **boundary in front of it** — `ins`: it was inserted (Enter),
    `del`: it was deleted (the block is to be joined to the one before). This is Word's inserted / deleted
    paragraph mark.
  - on a unit (equation, figure, table, page break, contents list, reference list): the whole item inserted or
    deleted; a display equation also `mod` with `old: { latex }` — its formula changed, in place (it keeps its id
    and its references).
  Pieces with one id are one change: a replacement, text typed in one go, a new paragraph with its text.
- **Recording** (`trackTransaction`, called from the one place every edit passes: `dispatchTransaction`): each
  ReplaceStep becomes — marks / flags on what it would delete, then its insertion behind that, marked. Deleting your
  own pending insertion really deletes it (Enter then Backspace leaves nothing). The cursor ends where the untracked
  edit would put it (after Delete: behind the deleted text). Not tracked, simply applied: formatting, heading level,
  list wrapping, figure size and placement, document style, comments, authors, and table rows / columns (the text in
  cells is tracked). Undo / redo, accept / reject and programmatic conversions are never re-tracked. If a step does
  not fit, the edit is applied untracked rather than lost.
- **Accept / reject** (`resolveChanges`): by id, by range, or all; marks and flags first (they move nothing), then
  removals and joins from the end of the document backwards. A paragraph is joined into the text block right before
  it, never out of its scope (cell, caption, list structure is cleaned up). One undo step.
- **Two invariants**, checked on 400 random edit sequences in `tests/track-core.js`: accept all == the document
  the same edits give with tracking off; reject all == the document before the edits.
- **Display**: insertions underlined, deletions struck through, in the author's colour; ¶ in the margin for a
  tracked paragraph boundary; units outlined with "Inserted / Deleted / Changed by …". A card per change beside the
  page (with the comments, in text order): what changed, ✗ Reject, ✓ Accept. Review menu: next / previous change
  (F7), accept / reject at the cursor, accept / reject all, and the view — all markup, final text, original text.
  Numbering always shows the final document (a deleted figure has no number).
- **PDF, preview, LaTeX**: the final text (`finalDoc`).
- **Word out**: real revisions — runs in `w:ins` / `w:del` (`w:delText`, `w:delInstrText`), the tracked paragraph
  mark in the *previous* paragraph's `rPr` (Word keeps a boundary on the paragraph before it, we on the block
  after), rows of a tracked table in `trPr`, a tracked equation as one paragraph (formula, tab, number; a changed
  one as old-deleted + new-inserted), `w:trackRevisions` in settings. A deleted reference list / contents list /
  page break is left out. Option `revisions: false` writes the final text.
- **Word in**: revisions arrive as suggestions with author and date (neighbouring revisions of one author and time
  are one change); `w:moveFrom/To` as delete/insert; formatting revisions are accepted. Option `acceptRevisions`.
- **Checked with Word itself** (`tests/track-word.js`): Word sees the revisions by both authors; Word's Accept All
  gives exactly our final text and its Reject All exactly the original; importing the file back gives the same
  markup. Changes made *in* Word import as suggestions (`tests/wordimport-real.js`).
- Not done: tracking of formatting and of table rows / columns; a PDF with the markup shown; per-author filters.
- Tests: `tests/track-core.js` (engine, 45 + the random invariants), `tests/track.js` (34, in the app with real
  keys), `tests/track-word.js` (19, with Word).

### 10.3 Page breaks in the text, guide, tutorial (step 9, 2026-11-26)

- **Page breaks in the text** (View menu, off by default, remembered): a thin divider "page 3" where each page of
  the PDF starts, while writing. After every preview a second, quick Typst run (`typst query`) reports page and
  height of every top-level block: the writer marks each block with an invisible `#metadata(i) <dswpos>` and
  collects them in one element (`docToTypst(doc, { positions: true })`, `main/typst.js` format `query`).
  `core/pages.js` turns that into places: exact in front of a block that starts a page; estimated inside a
  paragraph or list that runs over a page end (the preview stays the exact one). Floats are left out (Typst moves
  them). With tracked changes pending, `blockOf` maps the editor's blocks to those of the final text.
  `editor/pageview.js` draws the dividers.
- **Guide** (F1, the ? in the toolbar, Help → Guide): what the program does and how, by topic, with search
  (`ui/help.js`; the text is data, `GUIDE` — a new feature gets its lines there in the same change).
- **Tutorial** (Help → Tutorial): a short paper to practise in, with a "Try it" in every section; it already holds an
  equation, a figure, a table, a citation, a comment, two tracked changes and a Supplementary Information tab
  (`tutorial.js`). Closing it asks nothing.
- Test: `tests/step9.js` (22).

### 10.4 Hardening (2026-11-26, before the first publication)

The page shows documents made by other people, so the main process does not take its word for anything that
reaches the disk or the network (`main/guard.js`; test `tests/hardening.js`, 31 checks with the rules switched on).

- **Only our page calls in**: every IPC handler checks that the message comes from the main frame of our window,
  loaded from our own `index.html`. The window cannot be navigated, redirected or open others; no `<webview>`;
  all web permissions refused; a link opens in the browser only for the program's own few sites.
  (Already there: context isolation, sandbox, no Node in the page, a Content-Security-Policy with scripts only
  from the program.)
- **Files only where the user pointed**: a document opens only if it was chosen in the open dialog, is on the
  recent list, came from the command line / a double-click, or is the open one; it is saved only to the open path
  or one chosen in Save as. Exports go to the file chosen in the save dialog, its `-SI` companion, or the Word
  copy beside the open document — and only as .pdf .docx .zip .bib. Reading a file by path is for tests only.
  Backups are read only from the backup folder; recovery names cannot contain path parts; shared comments and
  backups only for the open document. The page cannot add to the recent list.
- **Documents are data**: text from a document is always inserted as text; ids are reduced to letters, digits,
  `. _ -` before they reach the Typst source (`safeLabel`); media names are checked before they are written to the
  work folder.
- **No test doors in an installed copy**: `--test` (which runs a script inside the program), `--update-url` and the
  `DTUSW_*` stand-in addresses work only when running from source.
- **Signed updates**: an update is accepted only if `latest.json` carries an Ed25519 signature over version and
  checksums made with the DTU Science Writer update key (public half in `main/update.js`), the installer comes from
  the DEX releases and matches the signed SHA-512. The private key is on the maintainer's PC
  (`%USERPROFILE%\.dtu-science-writer\`, never in Dropbox or a repository) and in the repository secret
  `DTUSW_UPDATE_KEY`, with which the release workflow signs. Without the secret a release is not signed and
  installed copies do not update themselves from it.
- **Electron fuses** in the built program: cannot be run as plain Node, no `NODE_OPTIONS`, no `--inspect`, the
  code is loaded only from the app archive, whose integrity is checked.
- The Zotero key is kept encrypted with the operating system's key store (safeStorage), never in a document.
- **Not done: code signing.** It needs a certificate bought for the publisher; without it Windows shows
  "Windows protected your PC" once at installation.

## 11. Testing

- `--test --data <dir> --userdata <dir> --script <file>` driver like DTU Planner; off-screen shown
  window for screenshots.
- Golden tests: model → Typst / LaTeX / docx text compared with committed reference outputs.
- Round-trip tests: model → docx → import → model; diff report of what changed.
- Math corpus test (7.4) through every converter.
- Real-paper tests: a few of the user's own published papers and proposals (Word and LaTeX) as
  import cases; record the import report.
- docx output opened in Word via COM and exported to PDF to verify fields, comments and figures
  landed (recipe as in the docx review toolchain).

---

## 12. Phases

| Phase | Content | Done when |
|---|---|---|
| **1. Prototype** (~1 week) | Electron window; editor with headings, paragraphs, marks; MathLive inline + display; figures (float/here/wrap) with captions and numbering; xrefs; save/open `.dtusw`; Typst preview; export PDF and docx. | A 4-page sample paper with 10 equations and 3 figures exports to PDF and to a docx that Word opens with correct equations, captions and live numbering. |
| **2. Writing complete** | ~~Tables~~ (done 2026-11-26), lists, footnotes, title block, TOC, references (library, Zotero, DOI, CSL styles), comments, LaTeX export, templates. | A real proposal written in the app end to end. |
| **3. Shared use** | Lock manager, hash-check saves, autosave/backups, page view (5.2), read-only mode, settings (author name). | Two machines on the shared drive behave correctly in the lock tests. |
| **4. Import** | Word import via pandoc with import report; LaTeX subset import; MathType strategy. | Three of the user's existing papers import with a clean report. |
| **5. Co-authors** | Track changes (model, UI, docx in/out), Zotero field codes in docx. | Round-trip with a Word co-author's comments and tracked changes. |
| **6. Release** | Installer + portable, self-update, DEX card (same scheme as DTU Planner). | — |

### 12.1 Build order from here (agreed 2026-11-26; replaces the phase order above)

Done so far: phase 1, tables, figure resizing, document style, authors/affiliations, heading numbering, self-update
(built and tested, not yet published), desktop shortcut + .dtusw association for the source version.

| Step | Content | Why in this place | Model |
|---|---|---|---|
| 0 | Tidy-up: split `app.js` into modules (files, preview, export, commands); user settings (name, initials); `tests/run-all` | everything after needs settings and clean seams | Opus |
| 1 | Shared-drive safety: lock file + read-only mode, hash check before save, Dropbox conflicted copies, autosave + recovery, rolling backups | data safety first; self-contained in the file layer | Opus |
| 2 | Comments: anchored threads on text/figures/equations/cells, margin column, replies, resolve, Word comments, "PDF with comments" | builds the author/annotation/margin machinery that track changes reuses | Opus |
| 3 | References: library in the document, Zotero, DOI/arXiv lookup, BibTeX import, CSL styles, citations + bibliography | independent new node type; footnotes may cite | Opus |
| 4 | Footnotes, table of contents, lists of figures/tables; page break, keep-with-next; spell-check language | small schema additions | Opus |
| 5 | LaTeX: paste LaTeX into text; LaTeX export (.tex + .bib + figures, publisher classes) | one LaTeX mapping, both directions | Opus |
| 6 ✔ | Word import: text, OMML, figures, tables, captions/xrefs → live items, comments; import report; MathType strategy (done 2026-11-26, §8.1) | needs all node types above | **Fable** |
| 8 ✔ | Track changes: text, paragraphs, figures / equations / tables as units, accept / reject, views, author colours, Word revisions out and in (done 2026-11-26, §10.2) | builds on comments + import | **Fable** |
| 7b ✔ | Supplementary Information as the second part of the document: tabs, S numbering, live cross-references, two-file export, Word import as SI (done 2026-11-26, §10.1) | changes the model before track changes, which then covers it | Opus |
| 7 ✔ | Journal styles: layout (spacing, line numbers, "Figure"), ~40 journals, any reference style from the CSL repository stored in the document (done 2026-11-26, §10; .dotx export not done) | reuses the reference engine | Opus |
| 9 ✔ | Page breaks in the text; guide + tutorial; hardening; published on DEX (done 2026-11-26, §10.3, §10.4). Not done: Mac build, code signing | polish on a finished model | Fable |

Publishing v0.1.0 on DEX can happen at any step, on the user's word.

**Step 0 done (2026-11-26):** renderer split into `context.js` (state, bridge, command registry, events) + `editor/`
(editing surface) + `ui/` (toolbar, status, dialogs, bars) + `doc/` (files, preview, export, safety); main split into
`context.js`, `menu.js`, `ipc.js`, `storage.js`, `docs.js`. Modules talk through the context (commands and events), not
by importing each other's internals. User settings (name, initials) in config.json. `tests\run-all.ps1 [-Word] [-Only …]`
runs everything; each test gets its own fresh settings folder (`%TEMP%\dtusw-test-<name>`).

**Step 1 done (2026-11-26):** `main/docs.js` owns the open document's safety.
- Lock `~$<name>.lock` (hidden) next to the document: user, initials, machine, pid, opened, heartbeat (every 60 s).
  Held by someone else → the document opens read-only (red bar, edits blocked at the single dispatch point, save only as a
  copy) and is re-checked every 30 s; when free it becomes editable, reloading first if the other editor saved. Stale after
  5 min, or at once when the owning process on this machine is gone. Exclusive create (`wx`) for the first lock.
- Checksum (SHA-256) of the file as opened/saved: if the file on disk differs at save time, nothing is overwritten and the
  work goes to `<name> (conflict, <initials> <date time>).dtusw`.
- Dropbox "conflicted copy" files next to the document are reported on open.
- Backups of the previous version on every save in the settings folder (last 20 + newest per day for 30 days);
  File → Backups… opens one as an unsaved copy.
- Autosave every 30 s while there are unsaved changes, to the settings folder (never the shared drive); at start, work of
  crashed sessions is offered for restore (as an unsaved copy; the original file is not touched).
- Every exit path releases the lock: quit events, plus `ctx.exit()` for hard exits (tests, Restart now) — `app.exit()`
  skips Electron's quit events. Test `tests/safety.js` (26 checks) + a run-all check that no lock is left behind.

**Step 2 done (2026-11-26): comments.** Threads live in the document (doc attr `comments`: id → {author, initials, time,
text, resolved, replies[]}), so they are saved and undoable. Anchors: the `comment` mark (text, inline math, references,
captions, table cells; overlapping allowed; not inclusive, so typing at the edge does not extend it) and
`equation.attrs.comments` for a display equation as a whole. A thread whose anchor is deleted stays in the document (undo can
restore the text) but is not shown or exported. UI (`ui/commentspane.js`): a column of cards level with their anchors
(pushed down on overlap), new comment typed in place (Ctrl+Enter), reply, resolve/reopen, edit (own), delete (with
anchors), show/hide resolved; Comment button, Ctrl+Alt+M, View → Comments. Highlight via decorations (active / quiet).
Word: `comments.xml` + `commentsExtended.xml` — each thread one comment plus one per reply on the same range,
`w15:paraIdParent` for replies, `w15:done` for resolved; ranges open at the first anchor segment and close after the last
(a final pass closes any left open). Verified in Word (threads, replies, resolved, scopes). PDF ignores comments
("PDF with comments" is a later option). Test `tests/comments.js` (22 checks).

**Step 2b done (2026-11-26): shared comments** — commenting while someone else edits. A reader (document read-only
because of another's lock) can reply, resolve/reopen, add comments (text or equation) and edit their own; only the editor
deletes. Each action is shown at once (a `commentOnly` step: the one kind of change the read-only view accepts; not an
unsaved change) and appended as one JSON line to `~$<name>.dtusw.comments-<session>.ndjson` (hidden) next to the document
(`main/docs.js` sideAppend/sideList/sideClear). Every 30 s and on open, all readers' actions are applied
(`core/commentops.js`, idempotent): new threads only if absent, replies by reply id, resolve/edit only if newer than the
thread's `statusTime`/`editTime` (so re-reading an old file never undoes a later reopen). Text anchors are stored as position
+ quoted text and re-found by the nearest occurrence of the quote (fallback: the text block at the old position); equation
anchors by equation id. The editor merges them as a non-undoable step (others' work), the document becomes unsaved, and after
the save that holds them the files are deleted (only if they have not grown since). A reader whose lock becomes free with
actions only in their copy gets them as unsaved changes. A reader reloads when the editor saves (unless typing a comment).
Test `tests/sharedcomments.js` (23 checks).

**Step 3 done (2026-11-26): references.** The library is CSL-JSON in the document (doc attr `references`: key → item; keys
like `jessen2019`, `castroneto2009`; a work with the same DOI or the same title + year is not added twice). `citation` node
(items [{id, locator}], mode normal | suppress-author) and one `bibliography` node (the reference list, placed with Insert →
Reference list; without one, the list is added at the end — shown in the editor as well). Formatting: citeproc-js with
bundled CSL styles (APS, Nature, ACS, IEEE, Vancouver, APA, Harvard; style `cite`, chosen in Style), one engine for editor,
PDF and Word (`core/references.js`; cache keyed on library identity + citation list, so typing does not re-run it).
Citation dialog (`ui/citedialog.js`, Insert → Citation…, Ctrl+Alt+C, Cite button, click a citation to edit it): one search box
for the document's library, the local Zotero library (Zotero 7 local API), a DOI or arXiv number (doi.org content
negotiation, CSL-JSON; arXiv via its DataCite DOI) or pasted BibTeX; several works per citation, page locator per work,
"year only" form for author–year styles; new works enter the library in the same undo step. Reference library dialog
(`ui/librarydialog.js`, Format → Reference library…, double-click the list): cited counts, edit / new by hand (with DOI
look-up), remove not cited, import BibTeX, export .bib. Lookups run in the main process (`main/refs.js`, `net.fetch`, system
proxy). Typst: citations as formatted text; list as label/entry grid (numbered) or hanging indents (author–year). Word: plain
formatted text (no reference-manager fields yet) and Bibliography / Bibliography (numbered) paragraph styles.
Tests: `tests/refs-core.js` (19, Node, compiles with Typst), `tests/references.js` (37, app, stand-in doi.org/Zotero server).
Not yet: custom CSL file, Zotero field codes in Word (step 8 area), citation prefix/suffix text.

**Step 4 done (2026-11-26): document structure.**
- Footnotes: inline `footnote` node holding its own text (text, math, citations, cross-references); numbered in reading
  order (`computeNumbers().footnotes`); in the editor a superscript number, selected → a nested editor below it whose
  steps are mapped into the document (one undo history). Insert → Footnote, Ctrl+Alt+F. Typst `#footnote[…]`; Word
  `footnotes.xml` (separators, FootnoteText/FootnoteReference styles, footnotePr in settings).
- Table of contents, list of figures, list of tables: one `outline` node (kind contents | figures | tables), drawn live
  from `outlineEntries()` (click an entry to jump there). Typst `#outline` (figures/tables listed by the first caption
  sentence via an `in-outline` state); Word: TOC fields with the current entries, marked dirty so Word adds page numbers
  and links on opening (verified in Word).
- Page break: `page_break` node, Ctrl+Enter (as in Word); Typst `#pagebreak(weak: true)`, Word `w:br type=page`.
- Appendix: `heading.attrs.appendix` on a level-1 heading (Format → Appendix starts here): from there top-level sections
  are A, B, … (A.1, A.1.1 below), referred to as "Appendix A"; figures and equations keep counting. Typst: precomputed
  numbers + `supplement: [Appendix]`; Word: a second numbering instance (numId 60, upperLetter).
- Document language (style `lang`: en-GB, en-US, da-DK, de-DE; Style dialog): editor spell-check dictionary, Typst
  `lang`/`region` (hyphenation), Word proofing language. The spelling context menu with suggestions existed already.
- Keep-with-next: headings already keep with the next paragraph (Word style, Typst default).
Tests: `tests/structure-core.js` (22, Node + real Typst + Word parts), `tests/structure.js` (23, app).

**Step 5 done (2026-11-26): LaTeX.**
- Export (`core/latex.js`, File → Export LaTeX (for Overleaf)…): one zip with `main.tex`, `references.bib` and
  `figures/` (SVG/GIF rasterised to PNG) — Overleaf uploads it directly; locally, unzip and run pdfLaTeX twice. pdfLaTeX
  (what journals and arXiv expect): utf8 + T1, common Unicode symbols mapped to commands, newtx (Times) or helvet
  (Arial), babel from the document language, authblk title block, booktabs/multirow tables, wrapfig, caption labels
  "Fig. 1." bold. Numbers stay live: `\label{<id>}` on sections, figures, tables, equations; references `\ref`/`\eqref`
  with the editor's words (number only after a typed "Fig. "); `\appendix`; heading numbering formats mapped to
  `\the<counter>`. Citations `\cite{keys}` ([super]{cite} for superscript styles); the reference list is written out as
  `thebibliography` in the document's citation style (no BibTeX run needed; author–year styles: formatted text + list).
  A sentence continuing after a display equation is not a new paragraph. Not exported: comments, figure annotations.
- Paste (`core/latexin.js` + `editor/latexpaste.js`): plain text that looks like LaTeX becomes content — sections
  (with labels), paragraphs, inline/display math (equation, align → aligned, \[ \], $$), lists, footnotes,
  \emph/\textbf/…, accents and typography, figure and table environments (caption, label, tabular with \multicolumn; the
  image must be added), \cite (keys in the library; others stay as text and are reported), \ref/\eqref to labels in the
  paste or the document. A snippet goes into the current paragraph; Ctrl+Shift+V pastes the plain text; HTML with
  paragraphs (web pages, Word) is pasted normally. Our own export pasted back keeps its structure.
- Tests: `tests/latex-core.js` (14, compiled with the real pdfLaTeX), `tests/latexin-core.js` (20), `tests/latex.js`
  (12, app). The 17-page example manuscript exports and compiles with no undefined references (18 pages).

**Zotero step done (2026-11-26).** `main/zotero.js`: the user's online library through the Zotero web API.
- Settings → Zotero: API key (checked against zotero.org, stored encrypted with Electron safeStorage — Windows DPAPI —
  in config.json; it never reaches the renderer; Remove deletes it). Status shows the account and whether it may write.
- Search: desktop Zotero (local API) first; without it, the online library. Citing a Zotero item links it
  (`zotero: { id: http://zotero.org/users/<uid>/items/<KEY>, key }`).
- Reference library → "Send to Zotero": the references not linked yet go to a collection named after the document
  (created when missing; tag "DTU Science Writer"); a work whose DOI is already in the library is linked, not
  duplicated; links stored as one undo step. Official journal abbreviations are sent.
- Editing a linked reference: "Also update it in Zotero" (PATCH of the bibliographic fields only, with the item version;
  tags, notes, collections and the item type stay).
- "Update from Zotero / DOI": linked items refresh from desktop Zotero, else from the online library.
- Word export: citations as Zotero fields (`ADDIN ZOTERO_ITEM CSL_CITATION {json}` with the formatted text as result,
  item data embedded, URI when linked) and the list as `ZOTERO_BIBL`; Zotero document preferences (style id, field
  type) in docProps/custom.xml — Word co-authors with Zotero can refresh, add citations and change the style. Settings:
  "Citations in Word as Zotero fields" (on by default; off = plain text). Step 6 reads the fields back.
- Test `tests/zotero.js` (19, stand-in zotero.org server; desktop Zotero pointed at a closed port).

**References, verified (2026-11-26):** Reference library → "Update from Zotero / DOI" fetches every reference from its
source (Zotero if linked and running; else doi.org by DOI; else the Crossref match — accepted only when title, year and
first author agree), one undo step, with a list of what could not be verified. Official journal abbreviations
(`core/journals.js`, ISO 4 as the journals print them) win over delivered ones, which are often wrong. Items cited from
Zotero keep `zotero: { id, key }` (the link for refresh / edit in Zotero / Zotero fields in Word later).
The example manuscript's references are verified records (tests/data/antidot-refs.json).

**References: article numbers (2026-11-26, user priority).** Journals that number articles instead of pages deliver an
article number and no page range (Crossref `article-number`, BibTeX `eid`/`articleno`); styles print only `page`, so the
reference showed nothing there (EndNote's long-standing gap). `forFormatting()` puts the article number in the page
position when there is no page range — at formatting time, for every library item, without changing the stored data.
Tested in APS and Nature styles. Reference formatting is a user priority: keep testing real journal cases.

**Always save a Word copy (2026-11-26, Settings):** every save of `name.dtusw` also writes `name.docx` next to it (latest
only, not versioned), in the background; a docx open in Word cannot be replaced and is reported once.

**View tools (2026-11-26, user requests):** page preview on/off remembered (Pages, F8, View → Page preview with tick, Hide in
its header); page zoom 50–300 % (Ctrl + mouse wheel around the pointer, − field + in the toolbar, View → Zoom, Ctrl+0), only
the page, remembered; while an equation is edited, expanded palettes stand left (structures, brackets, matrices, accents,
functions, modes) and right (Greek, operators, relations, arrows, physics) of the page, and — Settings, on by default — the
preview steps aside meanwhile. Equation writing modes as in Word's equation editor: Bold (Ctrl+B, `\mathbf`), Upright
(Ctrl+I, `\mathrm`), Text (Ctrl+T, `\text`), lit in the palette while on. Ctrl+Alt shortcuts (comment, cite) are handled in
the page so AltGr (Danish keyboards: AltGr+M = µ) never triggers them. Test `tests/viewtools.js` (27 checks).

---

### Phase 1 status (2026-11-26): done

Acceptance test `tests/phase1.js`: the sample paper (4 pages, 11 display equations, 16 inline, 3 figures, 13 cross-references)
previews in ~0.2 s, exports to PDF and Word; Word opens the .docx with 27 native equations, 13 SEQ + 13 REF fields,
and refreshing all fields in Word changes nothing. Save → reopen is identical. `tests/editing.js` (real key events)
passes 14/14. Math corpus: 61/61 equations convert and compile, Word rendering checked by eye.

---

## 13. Decisions taken (with date)

- 2026-11-26 Name **DTU Science Writer**, extension `.dtusw`, app id `dk.dtu.sciencewriter`.
- 2026-11-26 ProseMirror directly (no TipTap).
- 2026-11-26 Typst **CLI** 0.15.1, bundled and pinned; ~0.1–0.25 s per recompile is fast enough, so no WASM compiler for now.
  Fonts: Typst's embedded Libertinus Serif / New Computer Modern with `--ignore-system-fonts`; the editor loads the same OTF files.
- 2026-11-26 LaTeX → Typst math: `tex2typst` + `src/core/typst-symfix.json` (symbol names the pinned Typst rejects → Unicode;
  regenerate with `tools/check-symbols.js`) + small rewrites (|x| → \left|x\right|, a gap in `cases`).
- 2026-11-26 Math → Word: **Temml** (LaTeX → MathML) + **own MathML → OMML converter** (`src/core/omml.js`).
  MathLive's MathML and the `mathml2omml` package were tried and rejected: empty sums/integrals, non-stretching brackets,
  italic function names, lost overlines/hats.
- 2026-11-26 Word writer: own XML (no `docx` package). Numbered equations = borderless 3-column table (number in a SEQ field,
  bookmarked); an invisible spacer paragraph between consecutive equations (Word merges touching tables). REF fields carry
  `\* Charformat` so a refresh does not copy the bold caption number.
- 2026-11-26 Word figures: *Here* = centred paragraph; *Wrap* = Word frame (wrap around); **top/bottom-of-page floats are exported
  as *Here*** — Word frames do not stack (two floats on a page overlap) and a frame on page 1 sits above the title.
  The frame variant stays available as option `wordFloats: 'frame'`.
- 2026-11-26 Typst: the title block is itself the first top float, so top-of-page figures on page 1 go below it (as in LaTeX).
  Wrapped figures use the **meander** package (wrap-it 0.1.1 is broken on Typst 0.15); the figure wraps the paragraphs that
  follow it up to the next heading/equation/figure. Meander margins must be absolute lengths (pt), not em.
- 2026-11-26 Editor: a display equation left with Enter at the end of the document creates a paragraph after it (otherwise it stays
  selected and the next keystroke replaces it); the document always ends with a paragraph.

- 2026-11-26 Figures resize by dragging a corner (image node view; only the view's own element changes during the drag and the
  width is written on release — changing the figure element mid-drag makes the editor redraw it and the drag is lost).
- 2026-11-26 **Tables** (pulled forward from phase 2 at the user's request): prosemirror-tables 1.8.5 (cell selection, merge/split,
  column resizing, normalisation). `table_figure` = caption **above** + table, numbered "Table n", placement here/top/bottom;
  bare tables exist only inside it (pasted tables are wrapped). Cells hold paragraphs (text, inline math, refs); cell attr `align`.
  Editor columns size to their content (defaultCellMinWidth 36 px) to match Typst. Typst: booktabs hlines, table.header,
  table.cell spans, dragged widths px → pt. Word: booktabs borders per cell, gridSpan / vMerge (one tc per grid row), header rows
  repeat (tblHeader), column widths estimated from content (Word does not shrink a generated auto-fit table).
- 2026-11-26 Word: an equation alone in a paragraph/cell gets a zero-width space beside it; otherwise Word treats it as a display
  equation and ignores the paragraph/cell alignment.
- 2026-11-26 Figure and table tools live in a fixed **context row** under the toolbar (a floating bar covered the text).

- 2026-11-26 **Fonts (supersedes §10):** only fonts with a matching math font — Times New Roman + STIX Two Math, or
  Arial + Fira Math. Times/Arial come from the system (Typst now runs *with* system fonts, `--font-path assets/fonts` for the
  math fonts); Word equations use Cambria Math (co-authors have it). Libertinus/NCM removed.
- 2026-11-26 **Document style** (doc attr `style`, undoable, saved in the file; `src/core/style.js`, dialog *Style*):
  body 10/10.5/11/12 pt; Title, Heading 1–3 each with size (body + n pt), bold, italic, colour. Defaults from the user:
  H1 = body + 2 pt bold (12→14, 10→12), H2 = body size bold, H3 = body size italic; title body + 6 bold. Applied as CSS
  variables in the editor, `#show heading.where(level: n)` in Typst, styles.xml in Word.
- 2026-11-26 Wrapped figures: Enter at the end of a caption leaves the figure (figure → paragraph after it, created if needed;
  table caption → first cell); a wrapped figure with no paragraph after it shows a warning in the editor (it cannot wrap);
  paragraph spacing restored inside meander.
- 2026-11-26 **Self-update** like DTU Planner (`main/update.js`, rolling release `dtu-science-writer` on the DEX repo,
  workflow `tools/dex/dtu-science-writer-release.yml`). Verified locally with the packaged app and a stand-in server:
  good checksum → "ready to install", bad checksum → rejected. Not yet published (needs the user's go).
- 2026-11-26 The build syntax-checks main/*.js (a broken main.js only shows as an error box in the packaged app).

- 2026-11-26 **Title block** left-aligned by default (style `titleAlign`: left | center). **Authors** are structured
  (`authors` node attrs: list of {name, affils, corresponding, email}, affils of {dept, inst, street, postcode, city,
  country}), edited in the *Authors and affiliations* dialog (click the block / 👤 ✎). Affiliations are numbered in order of
  first use; marker (1 2 3 / a b c / † ‡ §) and address fields (full / medium / short) are document style (`style.affil`).
  Reusable **affiliation library** = `affiliations.json` in the app's settings folder, with export/import of a shareable file.
  Old documents (author line as text) are migrated on load.
- 2026-11-26 **Heading numbering per level** (style `hN.num`: 1 | i | I | a | A | none); '1' under all-'1' parents is
  hierarchical (1.2.3), other formats stand alone. **Heading 4** added (default a, b, c, italic). Numbers are computed once
  (numbering.js) and given to Typst per heading (`numbering: (..n) => "II"`); Word gets matching numbering.xml formats and
  `REF \n` (the number as shown). A level set to "none" still restarts the levels below it.
- 2026-11-26 **References after a typed type word**: when the text before a reference already says "Fig.", "Figure",
  "Table", "Section", "Eq." …, the reference shows only the number ("Fig. 3", "Eq. (2)") — editor, Typst and Word alike.
- 2026-11-26 Test mode answers "Save changes?" with "Don't save" (an off-screen modal blocked a test run).
- 2026-11-26 Example manuscript (full-program test): `tests/manuscript-antidot.js` builds an 8-page paper from the KPM antidot
  report into `RESEARCH - MANUSCRIPTS\2027 DTU SCIENCE WRITER\antidot-regimes.{dtusw,pdf,docx}`.

- 2026-11-26 **Readers can comment** on a document someone else is editing (shared comment files next to it, merged by the
  editor; see step 2b). Deleting comments stays with the editor.
- 2026-11-26 Citations in Word are plain formatted text for now; live Zotero/Word fields are a later option.
- 2026-11-26 **"Save changes?"** is the app's own dialog (`ui/asksave.js`), not the system box: "Don't save" alone on the
  left, Cancel and Save on the right, Save last and the default; Escape and a click outside cancel. Test `tests/asksave.js`.
- 2026-11-26 **Plain text in equations** (`\text{…}`) is set in the body font at body size (smaller in sub/superscripts):
  Typst via `bodytext()` from the preamble (`latexToTypst(…, { textFn })`), Word via `w:rFonts` on the normal-text runs;
  the editor already did this.
- 2026-11-26 **Figure viewer and annotations** (user request): double-click a figure → near-full-screen viewer
  (`ui/figviewer.js`) with Look, Comment (drag a box; becomes a real comment thread anchored to the figure —
  `figure.attrs.comments`, like display equations, so it appears in the comment column, in shared comments and as a Word
  comment on the picture), Type, Pen and Marker (colours), Undo, Remove annotations (marks, boxes and their threads; one undo
  step), Close/Esc. Marks live in `figure.attrs.annotations` (core/annotations.js; coordinates as fractions of the image,
  so they survive resizing; author/initials/time on every mark for later track changes), are shown faintly on the figure in
  the editor with a count badge, and are not printed in the PDF; drawings have no Word equivalent. Test `tests/figannot.js`
  (23 checks). Read-only documents: look only (reader annotations would need shared ops — later).
- 2026-11-26 Figure viewer, round 2 (user feedback): Select tool (click a mark to select; Delete removes; colours recolour
  it), click a typed text to edit it, text size slider (per text, default 2.2 % of the image width), annotation text always
  Arial. Marks reach the editor's image view through a decoration (`figureAnnotationsPlugin`), so they show on the page as
  soon as they are made.
- 2026-11-26 The app reopens the last document on start (most recent existing file in the recent list; not in tests).
- 2026-11-26 The bar between page and print view can be dragged (`ui/splitter.js`); width remembered, double-click resets.
- 2026-11-26 amsmath `\dots`, `\dotsc`, `\dotsb`, `\dotsm`, … work in editor (MathLive macros), PDF and Word
  (`LATEX_ALIASES` in core/mathconv.js).
- 2026-11-26 The example manuscript uses real citations (library in the document, APS style, automatic reference list).
- 2026-11-26 Open question for later: automatic versioning independent of Dropbox (local content-addressed store: media
  once by hash, compressed document.json per version, Time-Machine thinning, named versions, size cap, history panel with
  compare/restore) — discussed, not decided.
- 2026-11-26 The grey context row under the toolbar shows figure/table tools only (the hint text is gone); it keeps its
  height so the page does not jump.
- 2026-11-26 Word import uses our own reader, not pandoc (§8.1): mirror of the writer, no large helper program, keeps
  cross-reference and Zotero fields live.
- 2026-11-26 Typed references: Format → Convert typed references finds a typed "[n]" list and its markers, looks each
  entry up (Zotero → DOI → Crossref, accepted only when title, year and first author agree) and replaces them with real
  citations in one undo step (`core/typedrefs.js`, test `tests/typedrefs.js`).
- 2026-11-26 Titles in reference lists: publishers deliver Title Case or sentence case at random; the list is made
  uniform at formatting time (`core/titles.js`, sentence case with proper names and words after a full stop kept),
  stored data unchanged.

- 2026-11-26 Restart reopens the document that was open when the app closed (`config.lastDoc`, written by main at
  quit), not the newest entry of the recent list; an unsaved document open at quit -> a new document next time.
- 2026-11-26 Step 7 is journal styles inside the app, not export into publishers' .dotx templates (§10).

- 2026-11-26 The SI is a part of the document, not a second file (§10.1): live cross-references and one library
  outweigh the single lock.
- 2026-11-26 "Add references to Zotero library" (Format menu, and Send to Zotero in the reference library) sends only
  complete records: not references kept as typed text, nor ones without authors, year or source — those are named
  with the reason. Without a DOI, the same title and year already in Zotero is linked instead of added again.
- 2026-11-26 "Restart now" drops the document path from the command line it restarts with (it reopened the file the
  app was first started with instead of the one open now).

- 2026-11-26 Track changes keeps an inserted / deleted paragraph boundary on the block *after* it (Word: on the
  paragraph before); a changed display equation is changed in place with its old formula remembered, so its id and
  the references to it survive (§10.2).

## 14. Open decisions

- Default fonts and the three v1 templates.
- Word figure floats: is *Here* in Word acceptable, or do we need a smarter placement (e.g. move the figure to the paragraph
  where Typst put the page break)?
- Whether autosave also writes the shared file, or only the local recovery copy.
- MathType: placeholders + report now (§8.1); a built-in MTEF reader later if the placeholders turn out to be common.
- Mac build (needed if co-authors on Mac should edit, not just read exports).
