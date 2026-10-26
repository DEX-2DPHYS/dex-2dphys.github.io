// The Deck panel (2026-10-26). Loaded after appX.js and the scripts that extend it; uses their globals.
//
// 1. Title = file name. Opening a file sets the title to its name; saving writes "<title>.ipe" and a title
//    changed since then makes Save ask for the new name (appX.js saveDeckZip). The line under the title says
//    which file the deck is.
// 2. Autosave is on by default and needs no file dialog: every 5 minutes, when something changed, the deck is
//    written as "<file name>.bak.ipe" into this browser's own storage on this PC (it survives a browser or PC
//    crash; tested by killing the browser mid-session). "Backups…" lists them: open, save to disk, delete.
// 3. Linked files (sims/, html/, pdf/, figures/, movies/ under one folder): a choice instead of a typed path -
//    the folder of the .ipe file, another folder (Browse… opens a Windows folder dialog), or none.
// 4. The Windows helper (ipe-helper.ps1, registered by "Install Interactive Presenter.cmd" as the ipe-helper:
//    link type) does what a web page cannot: the folder dialog, finding where Save put the file (the browser
//    never tells the page), and converting a PowerPoint file. The page starts it with an ipe-helper: link and
//    reads the answer from .ipe-jobs\<job>.json beside the presenter (needs the file access the launcher gives).
(function () {
  "use strict";
  if (window.__deckPanelInstalled) return;
  window.__deckPanelInstalled = true;
  const $ = (id) => document.getElementById(id);
  const decode = (u) => { try { return decodeURIComponent(u); } catch { return String(u || ""); } };
  const windowsPath = (url) => { try { return decode(new URL(url).pathname).replace(/^\/([a-zA-Z]:)/, "$1").replace(/\//g, "\\"); } catch { return String(url || ""); } };
  const toFileUrl = (p) => "file:///" + String(p).replace(/\\/g, "/").split("/").map(encodeURIComponent).join("/").replace(/^([a-zA-Z])%3A/, "$1:");
  const baseOf = (name) => String(name || "").replace(/\.(bak\.ipe|ipe|zip|json)$/i, "");
  const hint = (msg) => { if (dom?.modeHint) dom.modeHint.textContent = msg; };

  // ---- 1. the file ---------------------------------------------------------------------------------
  function currentFileName() {
    if (state.currentZipFileHandle?.name) return state.currentZipFileHandle.name;
    if (state.deckFileUrl) return decode(String(state.deckFileUrl).split(/[\\/]/).pop() || "");
    return "";
  }
  function renderFileStatus() {
    const el = $("deckFileStatus");
    if (!el) return;
    const name = currentFileName();
    const where = state.deckFileUrl ? windowsPath(state.deckFileUrl) : "";
    let text;
    if (!name) text = "Not saved yet: Save asks where to put it.";
    else text = where ? `File: ${where}` : `File: ${name} (folder not known to the presenter)`;
    if (name && baseOf(name) !== deckFileBase(state.deck.meta.title)) {
      text += ` - renamed: Save asks where to save "${deckFileBase(state.deck.meta.title)}.ipe".`;
    }
    el.textContent = text;
    el.title = where || name;
  }
  window.__deckPanelFileChanged = renderFileStatus;

  // the title follows the file the deck was opened from
  if (typeof loadDeckZip === "function") {
    const baseLoad = loadDeckZip;
    loadDeckZip = async function loadDeckZipTitleFromFile(file, options = {}) {
      await baseLoad(file, options);
      const name = options.fileHandle?.name || (options.deckFileUrl ? decode(options.deckFileUrl.split("/").pop()) : "") || file?.name || "";
      if (name && baseOf(name)) {
        state.deck.meta.title = baseOf(name);
        renderDeckMeta();
        persistLastDeckToStorage();
      }
      lastBackedUpEdit = editCount; // nothing new to back up yet
      renderFileStatus();
      renderAutosaveHint();
    };
  }

  // after a Save to a NEW file the presenter does not know its folder: ask the helper where it went
  if (typeof saveDeckZip === "function") {
    const baseSave = saveDeckZip;
    saveDeckZip = async function saveDeckZipThenLocate(forceSaveAs = false) {
      const before = state.currentZipFileHandle;
      const beforeUrl = state.deckFileUrl;
      await baseSave(forceSaveAs);
      const after = state.currentZipFileHandle;
      renderFileStatus();
      if (!after || (after === before && beforeUrl)) return; // same file, folder already known
      if (locateTried.has(after)) return; // asked once for this file already (not found, or not installed)
      locateTried.add(after);
      if (after !== before) state.deckFileUrl = ""; // a new file: the old folder no longer applies
      renderFileStatus();
      locateSavedFile(after);
    };
  }

  const locateTried = new WeakSet();
  async function locateSavedFile(handle) {
    let f;
    try { f = await handle.getFile(); } catch { return; }
    if (!(await helperUsable())) return;
    const r = await helperCall("locate", { name: f.name, size: f.size, t: f.lastModified }, { quiet: true, timeoutMs: 90000 });
    if (!r?.path || state.currentZipFileHandle !== handle) return;
    state.deckFileUrl = toFileUrl(r.path);
    const setting = String(state.deck.settings?.presentationRootPath || "").trim();
    if (!setting || /^deck:/i.test(setting)) {
      // the default: links follow the folder the deck was saved in
      dom.presentationRootInput.value = "deck:";
      dom.applyPresentationRootBtn.click();
      renderStage();
    }
    renderFileStatus();
    renderDeckMeta();
    hint(`Saved ${f.name} in ${windowsPath(new URL("./", state.deckFileUrl).href)}`);
  }

  $("deckTitleInput")?.addEventListener("input", renderFileStatus);
  dom.newDeckBtn?.addEventListener("click", () => { setTimeout(() => { renderFileStatus(); renderAutosaveHint(); }, 0); });

  // ---- 2. autosave into the browser's own storage -------------------------------------------------
  const AUTOSAVE_MS = 300_000;
  const KEEP_BACKUPS = 40;
  const SETTING_KEY = "ip.autosave";
  let editCount = 0, lastBackedUpEdit = 0, timer = null, busy = false, lastInfo = null;

  if (typeof touch === "function") {
    const baseTouch = touch;
    touch = function touchCounted() { editCount++; return baseTouch.apply(this, arguments); };
  }
  const autosaveOn = () => { try { return localStorage.getItem(SETTING_KEY) !== "off"; } catch { return true; } };
  function backupName() {
    return `${deckFileBase(baseOf(currentFileName()) || state.deck.meta.title)}.bak.ipe`;
  }
  async function backupDir() {
    const root = await navigator.storage.getDirectory();
    return root.getDirectoryHandle("backups", { create: true });
  }
  function renderAutosaveHint() {
    if (!autosaveOn()) { setAutosaveHint("Off. Tick to back up every 5 minutes."); return; }
    if (lastInfo?.error) { setAutosaveHint(`Backup failed: ${lastInfo.error}. Use Save.`); return; }
    const when = lastInfo ? `last ${new Date(lastInfo.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "none yet";
    setAutosaveHint(`As "${backupName()}" in this browser (${when}).`);
  }

  doAutosave = async function backupToBrowserStorage(options = {}) {
    if (busy || !state.deck?.slides?.length) return false;
    const edit = editCount;
    if (!options.force && edit === lastBackedUpEdit) return false;
    busy = true;
    const name = backupName();
    try {
      const blob = await buildDeckZipBlob();
      if (!blob || blob.size < 100) throw new Error("the deck came out empty");
      const dir = await backupDir();
      const fh = await dir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(blob);
      await w.close();
      lastBackedUpEdit = edit;
      lastInfo = { at: Date.now(), name, size: blob.size };
      await pruneBackups(dir);
    } catch (err) {
      lastInfo = { at: Date.now(), error: String(err?.message || err) };
    } finally {
      busy = false;
      renderAutosaveHint();
    }
    return !lastInfo?.error;
  };
  async function listBackups(dir) {
    const out = [];
    for await (const [name, h] of dir.entries()) {
      if (h.kind !== "file" || !/\.bak\.ipe$/i.test(name)) continue;
      const f = await h.getFile();
      out.push({ name, file: f, at: f.lastModified, size: f.size });
    }
    return out.sort((a, b) => b.at - a.at);
  }
  async function pruneBackups(dir) {
    const all = await listBackups(dir);
    for (const b of all.slice(KEEP_BACKUPS)) await dir.removeEntry(b.name).catch(() => {});
  }
  startAutosaveTimer = function startBrowserBackupTimer() {
    if (timer) clearInterval(timer);
    timer = setInterval(() => { if (autosaveOn()) void doAutosave(); }, AUTOSAVE_MS);
  };
  stopAutosaveTimer = function stopBrowserBackups() {
    if (timer) clearInterval(timer);
    timer = null;
    try { localStorage.setItem(SETTING_KEY, "off"); } catch { /* private window */ }
    if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = false;
    renderAutosaveHint();
  };
  enableAutosave = async function enableBrowserBackups() {
    try { localStorage.removeItem(SETTING_KEY); } catch { /* private window */ }
    if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = true;
    navigator.storage.persist?.().catch(() => {}); // ask the browser never to clear it to make room
    startAutosaveTimer();
    renderAutosaveHint();
  };
  resetAutosaveTargetKeepSelection = function newFileSameAutosave() { renderAutosaveHint(); };
  getAutosaveSuggestedName = backupName;
  state.autosaveFileHandle = null;

  // ---- the Backups list ----
  const fmtSize = (n) => (n < 1048576 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  async function openBackupsDialog() {
    const dlg = document.createElement("dialog");
    dlg.className = "deck-backups-dialog";
    document.body.appendChild(dlg);
    const close = () => { dlg.close(); dlg.remove(); };
    async function render() {
      let rows = [];
      try { rows = await listBackups(await backupDir()); } catch (err) { rows = null; dlg.innerHTML = `<p>Backups are not available in this browser (${esc(err.message)}).</p>`; }
      if (!rows) return;
      dlg.innerHTML = `
        <h3>Backups</h3>
        <p class="deck-backups-hint">Autosave keeps one backup per file name in this browser on this PC. They survive a crash of the browser or the PC, not a lost PC: <b>Save to disk</b> copies one out. The newest ${KEEP_BACKUPS} are kept.</p>
        ${rows.length ? `<table><thead><tr><th>Backup</th><th>Saved</th><th>Size</th><th></th></tr></thead><tbody>${rows.map((r, i) => `
          <tr><td>${esc(r.name)}</td><td>${esc(new Date(r.at).toLocaleString([], { dateStyle: "short", timeStyle: "short" }))}</td><td>${fmtSize(r.size)}</td>
          <td class="deck-backups-actions"><button data-act="open" data-i="${i}">Open</button><button data-act="disk" data-i="${i}">Save to disk…</button><button data-act="del" data-i="${i}">Delete</button></td></tr>`).join("")}</tbody></table>`
        : `<p>No backups yet. The first one is written 5 minutes after the first change.</p>`}
        <menu><button data-act="now">Back up now</button><button data-act="close" class="primary">Close</button></menu>`;
      dlg.querySelectorAll("button").forEach((btn) => btn.addEventListener("click", async () => {
        const r = rows[Number(btn.dataset.i)];
        const act = btn.dataset.act;
        if (act === "close") return close();
        if (act === "now") { await doAutosave({ force: true }); return render(); }
        if (act === "open") {
          if (!confirm(`Open the backup "${r.name}" from ${new Date(r.at).toLocaleString()}? Unsaved changes in the open deck are lost.`)) return;
          close();
          await loadDeckZip(new File([r.file], r.name, { type: "application/zip" }), {});
          hint(`Opened the backup ${r.name}. Save to keep it as an .ipe file.`);
          return;
        }
        if (act === "disk") {
          const target = r.name;
          try {
            if (typeof window.showSaveFilePicker === "function") {
              const h = await window.showSaveFilePicker({ suggestedName: target, types: [IPE_FILE_TYPE] });
              const w = await h.createWritable(); await w.write(r.file); await w.close();
            } else {
              downloadBlob(r.file, target);
            }
          } catch (err) { if (err?.name !== "AbortError") alert("Could not save: " + err.message); }
          return;
        }
        if (act === "del") {
          if (!confirm(`Delete the backup "${r.name}"?`)) return;
          await (await backupDir()).removeEntry(r.name).catch(() => {});
          return render();
        }
      }));
    }
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); close(); });
    await render();
    dlg.showModal();
  }
  $("deckBackupsBtn")?.addEventListener("click", () => void openBackupsDialog());

  // ---- 3. linked files -----------------------------------------------------------------------------
  const rootSelect = $("rootModeSelect");
  const rootRow = $("rootCustomRow");
  function rootMode() {
    const v = String(state.deck.settings?.presentationRootPath || "").trim();
    return !v || /^deck:/i.test(v) ? "deck" : "custom"; // nothing set yet = the .ipe folder once it is known
  }
  function applyRoot(value) {
    dom.presentationRootInput.value = value;
    dom.applyPresentationRootBtn.click(); // appX.js + slide-transfer.js do the work (and remember it)
    renderStage();
  }
  function renderRoot() {
    if (!rootSelect) return;
    const mode = rootSelect.dataset.picking === "custom" ? "custom" : rootMode();
    rootSelect.value = mode;
    rootRow.hidden = mode !== "custom";
    const h = $("presentationRootHint");
    if (!h) return;
    const root = getPresentationRootFileUrl();
    h.style.color = ""; h.style.fontWeight = "";
    if (mode === "deck") {
      h.textContent = root ? windowsPath(root) : "Known once the deck is saved, or opened by double-clicking its .ipe file.";
    } else {
      h.textContent = root ? windowsPath(root) : "Type or paste the folder, or Browse…";
    }
    h.title = root ? windowsPath(root) : "";
  }
  if (typeof renderDeckMeta === "function") {
    const baseRender = renderDeckMeta;
    renderDeckMeta = function renderDeckMetaPanel() {
      baseRender();
      renderRoot();
      renderFileStatus();
      const v = $("globalContentScaleValue");
      if (v) v.textContent = `${Math.round((state.deck.settings?.globalContentScale ?? 1) * 100)}%`;
    };
  }
  rootSelect?.addEventListener("change", () => {
    delete rootSelect.dataset.picking;
    if (rootSelect.value === "deck") applyRoot("deck:");
    else {
      rootSelect.dataset.picking = "custom";
      rootRow.hidden = false;
      const cur = String(state.deck.settings?.presentationRootPath || "");
      dom.presentationRootInput.value = /^deck:/i.test(cur) ? "" : cur;
      renderRoot();
      dom.presentationRootInput.focus();
    }
  });
  dom.presentationRootInput?.addEventListener("change", () => {
    delete rootSelect.dataset.picking;
    let v = dom.presentationRootInput.value.trim().replace(/^"|"$/g, "");
    if (v && /^[a-z]:[\\/]|^\\\\/i.test(v) && !/[\\/]$/.test(v)) v += "\\"; // a folder, not a file
    applyRoot(v);
  });
  dom.presentationRootInput?.addEventListener("keydown", (e) => { if (e.key === "Enter") dom.presentationRootInput.blur(); });
  $("pickRootBtn")?.addEventListener("click", async () => {
    if (!(await helperUsable(true))) return;
    const start = getPresentationRootFileUrl();
    const r = await helperCall("pickfolder", start ? { start: windowsPath(start) } : {}, { timeoutMs: 600000, waiting: "Choose the folder in the Windows dialog…" });
    if (r?.path) {
      delete rootSelect.dataset.picking;
      applyRoot(r.path.replace(/[\\/]?$/, "\\"));
      hint(`Linked files now load from ${r.path}`);
    }
  });

  // ---- 4. the Windows helper -----------------------------------------------------------------------
  let fileAccess = null;
  async function helperUsable(explain = false) {
    if (fileAccess === null) {
      try { const r = await fetch(location.href, { cache: "no-store" }); fileAccess = r.ok || r.status === 0; } catch { fileAccess = false; }
    }
    const ok = fileAccess && location.protocol === "file:" && navigator.platform.startsWith("Win");
    if (!ok && explain) {
      alert("This needs Interactive Presenter started from its desktop icon or by double-clicking an .ipe file (Windows, after \"Install Interactive Presenter.cmd\"). Opened like this, a page may not start the helper or read its answer.\n\nYou can type or paste the folder instead.");
    }
    return ok;
  }
  const jobUrl = (job, suffix) => new URL(`.ipe-jobs/${job}${suffix}`, location.href).href;
  async function readJson(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!(r.ok || r.status === 0)) return null;
      const t = await r.text();
      return t.trim() ? JSON.parse(t.replace(/^﻿/, "")) : null;
    } catch { return null; }
  }
  // starts the helper and waits for its answer: resolves to the answer, or null (cancelled, failed, timed out)
  async function helperCall(action, params = {}, { quiet = false, timeoutMs = 120000, waiting = "" } = {}) {
    const job = Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, "0")).join("");
    const q = new URLSearchParams({ job, ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])) });
    const link = `ipe-helper:${action}?${q}`;
    if (typeof window.__ipeLaunch === "function") window.__ipeLaunch(link); // tests
    else { const a = document.createElement("a"); a.href = link; a.style.display = "none"; document.body.appendChild(a); a.click(); a.remove(); }
    const t0 = Date.now();
    let started = false;
    while (Date.now() - t0 < timeoutMs) {
      await new Promise((r) => setTimeout(r, 400));
      const done = await readJson(jobUrl(job, ".json"));
      if (done) {
        if (done.error && !quiet) alert(done.error);
        return done.cancelled || done.error ? null : done;
      }
      const st = await readJson(jobUrl(job, ".start.json"));
      if (st) {
        started = true;
        if (!quiet && st.message) hint(st.message);
      } else if (!started) {
        if (!quiet) hint(waiting ? `${waiting} (the browser may first ask to open the Interactive Presenter helper: allow it)` : "Starting the Interactive Presenter helper… (allow it if the browser asks)");
        if (Date.now() - t0 > 45000) {
          if (!quiet) alert("The Interactive Presenter helper did not start. Run \"Install Interactive Presenter.cmd\" once (it registers the helper), then try again.");
          return null;
        }
      }
    }
    if (!quiet) hint("The helper did not answer in time.");
    return null;
  }

  // ---- PowerPoint import ----
  $("importPptxBtn")?.addEventListener("click", async () => {
    if (!(await helperUsable(true))) return;
    const r = await helperCall("pptx", {}, { timeoutMs: 1800000, waiting: "Choose the PowerPoint file in the Windows dialog…" });
    if (!r?.manifest) return;
    const hasDeck = !!state.deck?.slides?.length;
    try {
      const res = await importPowerPointManifest(r.manifest, { insert: hasDeck });
      hint(res.inserted
        ? `Inserted ${res.slides} PowerPoint slide${res.slides === 1 ? "" : "s"} after the current slide${res.animations ? `, ${res.animations} animation${res.animations === 1 ? "" : "s"}` : ""}.`
        : `Imported ${res.slides - 1} PowerPoint slides after a title page. Save to keep it as an .ipe file.`);
    } catch (err) {
      alert("Could not import the PowerPoint file (" + err.message + ").");
    }
  });

  // ---- start ---------------------------------------------------------------------------------------
  if (dom.autosaveEnabledCheckbox) dom.autosaveEnabledCheckbox.checked = autosaveOn();
  if (autosaveOn()) { navigator.storage.persist?.().catch(() => {}); startAutosaveTimer(); }
  renderAutosaveHint();
  renderFileStatus();
  renderRoot();
  window.DeckPanel = Object.freeze({ doAutosave: (o) => doAutosave(o), listBackups: async () => listBackups(await backupDir()), helperCall, renderFileStatus, locateSavedFile });
})();
