// Where a deck's linked files come from (loaded after appX.js; uses its globals).
//
// 1. A warning when a deck that was opened by double-clicking its .ipe takes its sims from another
//    folder than its own. This is what happens after copying a presentation folder: a deck that stores
//    a fixed root (e.g. "../InteractivePresentations/2026 09 29 DTU BOARD/") keeps pointing at the
//    original. If the deck's own folder has every file the deck uses, it switches to "deck:" by itself
//    (no warning); otherwise the warning names the missing files.
// 2. "Check links" (Deck panel): every linked file the slides use, where it loads from, and whether it
//    is in the deck's folder, outside it, or missing.
//
// Only links into sims/ and pdf/ follow the presentation root; links such as "../10031 Notes/..." are
// relative to the presenter itself and are listed as "outside" by design.
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const dismissed = new Set(); // .ipe files whose warning was closed in this session

  // ---- paths -------------------------------------------------------------------------------------
  const decode = (u) => { try { return decodeURIComponent(u); } catch { return String(u || ""); } };
  const folderOf = (url) => { try { return new URL("./", url).href; } catch { return ""; } };
  const norm = (u) => decode(u).toLowerCase().replace(/\\/g, "/").replace(/\/+$/, "");
  const sameFolder = (a, b) => !!a && !!b && norm(a) === norm(b);
  const isInside = (url, folder) => !!url && !!folder && norm(url).startsWith(norm(folder) + "/");
  function folderName(url) {
    try { return decode(new URL(url).pathname).split("/").filter(Boolean).pop() || url; } catch { return url; }
  }
  function windowsPath(url) {
    try { return decode(new URL(url).pathname).replace(/^\/([a-zA-Z]:)/, "$1").replace(/\//g, "\\"); } catch { return String(url || ""); }
  }
  function shortPath(url, deckFolder) {
    if (deckFolder && isInside(url, deckFolder)) return decode(url.slice(deckFolder.length)).replace(/\//g, "\\");
    const parts = windowsPath(url).split("\\");
    return parts.length > 4 ? "…\\" + parts.slice(-3).join("\\") : parts.join("\\");
  }

  // ---- does a file exist? (needs the presenter to run with file access, as the .ipe launcher does) --
  let canRead = null;
  async function fileAccess() {
    if (canRead === null) {
      try {
        const r = await fetch(location.href, { cache: "no-store" });
        canRead = r.ok || r.status === 0;
      } catch {
        canRead = false;
      }
    }
    return canRead;
  }
  async function exists(url) { // true | false | null (cannot tell)
    if (!/^file:/i.test(url) || !(await fileAccess())) return null;
    try {
      const r = await fetch(url, { cache: "no-store" });
      try { await r.body?.cancel(); } catch { /* already read */ }
      return r.ok || r.status === 0;
    } catch {
      return false;
    }
  }

  // ---- what the slides use -------------------------------------------------------------------------
  function usedAssets() {
    const deck = state.deck;
    const ids = new Set(Object.keys(deck?.assets || {}));
    const uses = new Map(); // asset id -> Set of slide numbers (1-based)
    (deck?.slides || []).forEach((slide, i) => {
      (function walk(x) {
        if (typeof x === "string") {
          if (ids.has(x)) {
            if (!uses.has(x)) uses.set(x, new Set());
            uses.get(x).add(i + 1);
          }
          return;
        }
        if (x && typeof x === "object") for (const v of Object.values(x)) walk(v);
      })(slide);
    });
    return uses;
  }

  async function report() {
    const deck = state.deck;
    const deckFolder = state.deckFileUrl ? folderOf(state.deckFileUrl) : "";
    const rows = [];
    let embedded = 0;
    for (const [id, slides] of usedAssets()) {
      const a = deck.assets[id];
      if (!a) continue;
      let url = "";
      if (a.kind === "overlay-html-filelink") url = resolveHtmlFileLinkUrl(a);
      else if (a.kind === "overlay-html-external") url = String(a.url || "");
      else if (a.kind === "overlay-html-file") {
        url = a.htmlText ? resolveHtmlFileSourceExternalUrl(a, a.htmlText) : "";
        if (!url) { embedded++; continue; }
      } else continue;
      const row = {
        name: a.name || a.url || id,
        slides: [...slides].sort((x, y) => x - y),
        link: String(a.url || ""),
        rootRelative: !!normalizeConventionRelativePath(String(a.url || "")),
        hasCopy: !!a.htmlText,
        url: "",
        status: "",
        checked: true,
      };
      if (!url) {
        row.status = row.hasCopy ? "copy" : "missing";
      } else if (/^https?:/i.test(url)) {
        row.url = url;
        row.status = "web";
      } else {
        row.url = new URL(url, location.href).href;
        const ok = await exists(row.url);
        row.checked = ok !== null;
        row.status = ok === false ? "missing" : deckFolder && isInside(row.url, deckFolder) ? "here" : "outside";
      }
      rows.push(row);
    }
    rows.sort((a, b) => a.slides[0] - b.slides[0]);
    return { deckFolder, root: getPresentationRootFileUrl(), setting: String(deck.settings?.presentationRootPath || "").trim(), rows, embedded };
  }

  // Does the deck take its sims/pdf files from another folder than its own (only known when it was
  // opened by double-clicking the .ipe)? And would its own folder do?
  async function rootCheck(rep) {
    if (!state.deckFileUrl || /^deck:/i.test(rep.setting)) return null;
    const deckFolder = rep.deckFolder;
    if (rep.root && sameFolder(rep.root, deckFolder)) return null;
    const rels = [...new Set(rep.rows.filter((r) => r.rootRelative).map((r) => normalizeConventionRelativePath(r.link)))];
    if (!rels.length) return null; // nothing depends on the root
    const missing = [];
    let checked = true;
    for (const rel of rels) {
      const ok = await exists(new URL(rel, deckFolder).href);
      if (ok === null) checked = false;
      else if (!ok) missing.push(rel);
    }
    return { deckFolder, root: rep.root, setting: rep.setting, total: rels.length, missing, checked };
  }

  function useOwnFolder() {
    dom.presentationRootInput.value = "deck:";
    dom.applyPresentationRootBtn.click();
    renderStage();
    dom.modeHint.textContent = "This presentation now takes its sims from its own folder. Save to keep this.";
  }

  // ---- the warning --------------------------------------------------------------------------------
  let banner = null;
  function removeBanner() { banner?.remove(); banner = null; }

  async function afterDeckOpened() {
    removeBanner();
    const opened = state.deckFileUrl;
    if (!opened || dismissed.has(opened)) return;
    // "Keep as it is" was chosen for a deck in this very folder (and saved): stay quiet. A copy in
    // another folder warns again, which is the case this is for.
    if (sameFolder(state.deck.settings?.rootKeptInFolder, folderOf(opened))) return;
    const rc = await rootCheck(await report());
    if (!rc || state.deckFileUrl !== opened) return; // another deck was opened meanwhile
    // The .ipe's own folder is the default: if it has every file the deck uses, switch without asking
    // (2026-10-21). The warning is only for folders that lack files (e.g. a package whose sims sit in "../").
    if (rc.checked && !rc.missing.length) {
      useOwnFolder();
      dom.modeHint.textContent = `Sims now load from this presentation's own folder (it has all ${rc.total} file${rc.total === 1 ? "" : "s"}; before: ${rc.root ? folderName(rc.root) : rc.setting}). Save to keep this.`;
      return;
    }
    const from = rc.root ? `the folder “${esc(folderName(rc.root))}”` : `“${esc(rc.setting)}”`;
    const own = `“${esc(folderName(rc.deckFolder))}”`;
    let detail, canSwitch;
    if (!rc.checked) {
      detail = "The presenter cannot look at files here, so it cannot tell whether its own folder has them all.";
      canSwitch = true;
    } else if (!rc.missing.length) {
      detail = `Its own folder has all ${rc.total} file${rc.total === 1 ? "" : "s"} it uses.`;
      canSwitch = true;
    } else {
      const list = rc.missing.slice(0, 3).map((m) => esc(decode(m))).join(", ") + (rc.missing.length > 3 ? ", …" : "");
      detail = `${rc.missing.length} of the ${rc.total} files it uses are missing in its own folder (${list}).`;
      canSwitch = false;
    }
    banner = document.createElement("div");
    banner.className = "deck-links-banner";
    banner.setAttribute("role", "alert");
    banner.innerHTML = `<div class="deck-links-banner-text"><b>This presentation takes its sims from ${from}, not from its own folder ${own}.</b> ${detail}</div>
      <div class="deck-links-banner-buttons">
        ${canSwitch ? '<button type="button" data-act="use" class="primary">Use its own folder</button>' : ""}
        <button type="button" data-act="check">Check links</button>
        <button type="button" data-act="keep">Keep as it is</button>
      </div>`;
    banner.addEventListener("click", (e) => {
      const act = e.target?.dataset?.act;
      if (!act) return;
      if (act === "use") {
        useOwnFolder();
        removeBanner();
      } else if (act === "check") {
        openLinks();
      } else if (act === "keep") {
        dismissed.add(opened);
        state.deck.settings.rootKeptInFolder = folderOf(opened); // remembered for this folder once saved
        touch();
        removeBanner();
        dom.modeHint.textContent = "Kept. Save to stop this warning for this folder (a copy in another folder still warns).";
      }
    });
    document.body.appendChild(banner);
  }

  // ---- "Check links" -------------------------------------------------------------------------------
  const LABEL = {
    here: ["ok", "✓ in this folder"],
    outside: ["outside", "↗ outside this folder"],
    missing: ["missing", "✗ missing"],
    copy: ["copy", "◌ copy stored in the deck"],
    web: ["web", "web address"],
  };
  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "deckLinksModal";
    modal.className = "manual-modal hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="manual-modal-backdrop" data-close="1"></div>
      <div class="manual-modal-content deck-links-content">
        <div class="manual-modal-header"><h2>Linked files</h2><button type="button" class="manual-close" data-close="1" aria-label="Close">&times;</button></div>
        <div class="manual-scroller deck-links-body"></div>
      </div>`;
    modal.addEventListener("click", (e) => {
      if (e.target?.dataset?.close) closeLinks();
      if (e.target?.dataset?.act === "use") { useOwnFolder(); removeBanner(); openLinks(); }
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !modal.classList.contains("hidden")) closeLinks(); });
    document.body.appendChild(modal);
    return modal;
  }
  function closeLinks() { modal?.classList.add("hidden"); }

  async function openLinks() {
    if (!state.deckSessionReady || !state.deck) {
      dom.modeHint.textContent = "Open a presentation first.";
      return;
    }
    const m = ensureModal();
    const body = m.querySelector(".deck-links-body");
    body.innerHTML = '<p class="deck-links-dim">Checking…</p>';
    m.classList.remove("hidden");
    const rep = await report();
    const rc = await rootCheck(rep);
    const count = (s) => rep.rows.filter((r) => r.status === s).length;
    const parts = [];
    if (state.deckFileUrl) {
      parts.push(`<p><b>Presentation file:</b> ${esc(windowsPath(state.deckFileUrl))}</p>`);
    } else {
      parts.push('<p class="deck-links-warn">Opened with Load: the presenter does not know where the .ipe file is, so sims in <code>sims/</code> and <code>pdf/</code> use the copies stored in the deck. Open the .ipe by double-clicking it to use the files next to it.</p>');
    }
    const rootText = /^deck:/i.test(rep.setting)
      ? "deck: (its own folder)"
      : `${esc(rep.setting || "(none)")}${rep.root ? ` → ${esc(folderName(rep.root))}` : ""}`;
    parts.push(`<p><b>Sims and PDFs come from:</b> ${rootText}</p>`);
    if (rc) {
      const fix = rc.checked && !rc.missing.length
        ? ' <button type="button" data-act="use" class="primary">Use its own folder</button>'
        : "";
      parts.push(`<p class="deck-links-warn">This is not the presentation's own folder (“${esc(folderName(rc.deckFolder))}”). ${
        !rc.checked ? "Could not check whether that folder has the files." : rc.missing.length ? `${rc.missing.length} of the ${rc.total} files are missing there.` : `That folder has all ${rc.total} files.`}${fix}</p>`);
    }
    const unchecked = rep.rows.some((r) => !r.checked);
    parts.push(`<p>${rep.rows.length} linked file${rep.rows.length === 1 ? "" : "s"}: ${count("here")} in this folder, ${count("outside")} outside it, ${count("missing")} missing${count("copy") ? `, ${count("copy")} only as a stored copy` : ""}${count("web") ? `, ${count("web")} web` : ""}. ${rep.embedded} sim${rep.embedded === 1 ? " is" : "s are"} stored inside the deck (no files needed).${unchecked ? " Some files could not be checked (the presenter runs without file access)." : ""}</p>`);
    if (rep.rows.length) {
      parts.push('<table class="deck-links-table"><thead><tr><th>Slide</th><th>File</th><th>Loads from</th><th>Status</th></tr></thead><tbody>' +
        rep.rows.map((r) => {
          const [cls, label] = LABEL[r.status];
          const where = r.status === "web" ? esc(r.url) : r.url ? esc(shortPath(r.url, rep.deckFolder)) : esc(r.link || "");
          const title = r.url ? esc(r.status === "web" ? r.url : windowsPath(r.url)) : "";
          return `<tr><td>${r.slides.join(", ")}</td><td>${esc(r.name)}</td><td title="${title}">${where}</td><td class="deck-links-${cls}">${label}${r.checked ? "" : " (not checked)"}</td></tr>`;
        }).join("") + "</tbody></table>");
    }
    body.innerHTML = parts.join("");
  }

  // ---- start ---------------------------------------------------------------------------------------
  document.getElementById("checkLinksBtn")?.addEventListener("click", openLinks);
  dom.newDeckBtn?.addEventListener("click", removeBanner);

  window.DeckLinks = Object.freeze({ afterDeckOpened, openLinks, report, rootCheck: async () => rootCheck(await report()) });
})();
