// "Make portable package…" (Deck panel): one folder that runs the presentation on another Windows PC,
// with no installation and no internet. (loaded after deck-save-folder.js; uses its copyInto)
//
//   <chosen folder>\
//     START <title>.cmd        opens the talk (Chrome or Edge, with permission to read the files beside it)
//     READ ME FIRST.txt
//     Interactive Presenter\   the app, and People\ with the portraits the slides credit
//     <title>\                 the presentation, as "Save to folder…" writes it (.ipe + sims\ figures\ videos\ …)
//
// Offline: every page that is copied, and every page stored in the deck, is searched for libraries it loads
// from the internet (<script src="https://…">, stylesheets such as Google Fonts). Each is downloaded once:
//  - a copied page gets a local file in <title>\web-libs\<host>\<path> and its tag points there;
//  - a page stored in the deck gets the library written into it (it has no folder of its own).
// Stylesheets carry their fonts and pictures with them as data: addresses. MathJax 3's CHTML build loads its
// fonts as separate files, so its single-file SVG build (same version, same TeX) is used instead.
// What cannot be made offline is listed: downloads that fail, ES module imports, and web addresses a page
// builds while it runs.
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const hint = (msg) => { if (dom?.modeHint) dom.modeHint.textContent = msg; };
  const mb = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;

  // The files InteractivePresenter.html loads, plus the launchers (keep in step with tools/make-distribution.mjs).
  const APP_FILES = [
    "InteractivePresenter.html", "appX.js", "stylesX.css", "jszip.min.js", "slide-transfer.js", "project-canvas-copy.js",
    "dtuwrite-board.js", "deck-links.js", "deck-panel.js", "deck-save-folder.js", "deck-portable.js",
    "notes-boardX.html", "notes-board.html", "DTUlogo.png", "DEXlogo.png", "InteractivePresenter.ico", "ipe-file.ico",
    "Install Interactive Presenter.cmd", "Uninstall Interactive Presenter.cmd", "Import PowerPoint (drop .pptx here).cmd",
    "register-ipe.ps1", "open-ipe.ps1", "ipe-helper.ps1", "tools/pptx-export.ps1",
  ];
  const LIB_DIR = "web-libs";

  // ---- offline: web libraries ---------------------------------------------------------------------------
  function absWeb(u) {
    const s = String(u || "").trim();
    if (/^https?:\/\//i.test(s)) return s;
    if (/^\/\//.test(s)) return "https:" + s;
    return "";
  }
  // MathJax 3 CHTML fetches its fonts as separate files at run time; the SVG build is one file.
  function preferSingleFile(url) {
    return url.replace(/(mathjax@?[^/]*\/es5\/(?:tex-|mml-)?)chtml(-full)?\.js/i, "$1svg$2.js")
      .replace(/(mathjax@?[^/]*\/es5\/tex-mml-)chtml\.js/i, "$1svg.js");
  }
  function libRel(url) {
    const u = new URL(url);
    let p = decodeURIComponent(u.pathname).replace(/^\/+/, "") || "index";
    if (u.search) p += "_" + u.search.replace(/[^\w.-]+/g, "_").slice(0, 60);
    if (/\/$/.test(p)) p += "index";
    p = p.split("/").map((s) => s.replace(/[\\:*?"<>|]+/g, "_").replace(/^\.+$/, "_")).join("/");
    return `${LIB_DIR}/${u.host.replace(/[^\w.-]+/g, "_")}/${p}`;
  }
  const upTo = (pageRel) => "../".repeat(Math.max(0, pageRel.split("/").length - 1));

  function makeLocaliser() {
    const cache = new Map(); // url -> Promise<{ ok, kind, text|bytes, why }>
    const log = { libs: new Map(), failed: new Map(), swapped: new Set(), left: new Map(), pages: 0 };

    async function get(url, asText) {
      const key = (asText ? "t:" : "b:") + url;
      if (!cache.has(key)) cache.set(key, (async () => {
        try {
          const r = await fetch(url, { cache: "no-store", mode: "cors" });
          if (!r.ok) throw new Error(`HTTP ${r.status}`);
          return { ok: true, data: asText ? await r.text() : new Uint8Array(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
        } catch (err) { return { ok: false, why: err.message || "no answer" }; }
      })());
      return cache.get(key);
    }
    async function dataUrl(url) {
      const r = await get(url, false);
      if (!r.ok) return "";
      let s = "";
      for (let i = 0; i < r.data.length; i += 32768) s += String.fromCharCode.apply(null, r.data.subarray(i, i + 32768));
      const type = (r.type.split(";")[0] || "application/octet-stream").trim();
      return `data:${type};base64,${btoa(s)}`;
    }
    // a stylesheet with its @imports and url()s carried inside it
    async function selfContainedCss(url, depth = 0) {
      const r = await get(url, true);
      if (!r.ok) return { ok: false, why: r.why };
      let css = r.data;
      if (depth < 3) {
        const imports = [...css.matchAll(/@import\s+(?:url\()?\s*["']?([^"')\s;]+)["']?\s*\)?[^;]*;/gi)];
        for (const m of imports) {
          let abs; try { abs = new URL(m[1], url).href; } catch { continue; }
          const sub = await selfContainedCss(abs, depth + 1);
          css = css.replace(m[0], sub.ok ? sub.css : "");
        }
      }
      const urls = [...new Set([...css.matchAll(/url\(\s*["']?([^"')]+)["']?\s*\)/gi)].map((m) => m[1]).filter((u) => !/^data:/i.test(u)))];
      for (const u of urls) {
        let abs; try { abs = new URL(u, url).href; } catch { continue; }
        if (!/^https?:/i.test(abs)) continue;
        const d = await dataUrl(abs);
        if (d) css = css.split(u).join(d);
        else log.failed.set(abs, "font or picture of a stylesheet");
      }
      return { ok: true, css };
    }

    // { text, rel, embedded } -> { text, extra }
    async function prepareHtml({ text, rel, embedded, onStep = () => {} }) {
      log.pages++;
      const extra = [];
      let out = text;
      const replaceTag = (tag, by) => { out = out.split(tag).join(by); };
      // <link rel=preconnect / dns-prefetch> to the web: dropped (they only warm up a connection)
      for (const m of [...out.matchAll(/<link\b[^>]*\brel\s*=\s*["']?(?:preconnect|dns-prefetch)["']?[^>]*>/gi)]) {
        if (/href\s*=\s*["']?(https?:)?\/\//i.test(m[0])) replaceTag(m[0], "");
      }
      // scripts
      for (const m of [...out.matchAll(/<script\b([^>]*)\bsrc\s*=\s*(["']?)([^"'\s>]+)\2([^>]*)>\s*<\/script\s*>/gi)]) {
        const orig = absWeb(m[3]);
        if (!orig) continue;
        const attrs = (m[1] + " " + m[4]).replace(/\b(integrity|crossorigin|referrerpolicy)\s*=\s*(["'])[^"']*\2/gi, "").replace(/\s+/g, " ").trim();
        if (/\btype\s*=\s*["']?module/i.test(attrs)) { log.left.set(orig, `module script in ${rel}`); continue; }
        const url = preferSingleFile(orig);
        if (url !== orig) log.swapped.add(`${orig} → ${url}`);
        onStep(`Making ${rel} work offline: ${new URL(url).host}${new URL(url).pathname}`);
        const r = await get(url, true);
        if (!r.ok) { log.failed.set(url, r.why); continue; }
        log.libs.set(url, r.data.length);
        if (embedded) {
          const keep = attrs.replace(/\b(async|defer)\b/gi, "").trim();
          out = out.split(m[0]).join(`<script${keep ? " " + keep : ""}>\n${r.data.replace(/<\/script/gi, "<\\/script")}\n</script>`);
        } else {
          const lr = libRel(url);
          extra.push({ rel: lr, src: url, bytes: new TextEncoder().encode(r.data) });
          out = out.split(m[0]).join(`<script${attrs ? " " + attrs : ""} src="${upTo(rel)}${lr.split("/").map(encodeURIComponent).join("/")}"></script>`);
        }
      }
      // stylesheets (Google Fonts and the like)
      for (const m of [...out.matchAll(/<link\b[^>]*>/gi)]) {
        if (!/\brel\s*=\s*["']?stylesheet/i.test(m[0])) continue;
        const h = m[0].match(/\bhref\s*=\s*(["']?)([^"'\s>]+)\1/i);
        const orig = absWeb(h && h[2].replace(/&amp;/g, "&"));
        if (!orig) continue;
        onStep(`Making ${rel} work offline: ${new URL(orig).host}`);
        const r = await selfContainedCss(orig);
        if (!r.ok) { log.failed.set(orig, r.why); continue; }
        log.libs.set(orig, r.css.length);
        if (embedded) out = out.split(m[0]).join(`<style>\n${r.css.replace(/<\/style/gi, "<\\/style")}\n</style>`);
        else {
          const lr = libRel(orig).replace(/(\.css)?$/i, ".css");
          extra.push({ rel: lr, src: orig, bytes: new TextEncoder().encode(r.css) });
          out = out.split(m[0]).join(`<link rel="stylesheet" href="${upTo(rel)}${lr.split("/").map(encodeURIComponent).join("/")}">`);
        }
      }
      // what is left: libraries a page fetches by itself from the web while it runs
      const left = out.replace(/data:[^"')\s]+/g, "");
      for (const m of left.matchAll(/(?:\bimport\s*(?:\(\s*)?|\bfrom\s+)["'](https?:\/\/[^"']+)["']/g)) log.left.set(m[1], `module import in ${rel}`);
      // a script tag made while the page runs (s.src = "https://…js", loadScript("https://…")); a bare web
      // address in a string is not counted: bundlers keep the original addresses as labels next to the library
      for (const m of left.matchAll(/(?:\.src\s*=\s*|load(?:Script|Css|Style)\w*\s*\(\s*|importScripts\s*\(\s*)["'`](https?:\/\/[^"'`\s]+\.(?:m?js|css))(?:\?[^"'`\s]*)?["'`]/gi)) {
        if (!log.libs.has(m[1])) log.left.set(m[1], `loaded by a script in ${rel}`);
      }
      return { text: out, extra };
    }
    return { prepareHtml, log };
  }

  // ---- the package --------------------------------------------------------------------------------------
  function portraitsUsed(deck) {
    const out = new Set();
    for (const s of [...(deck.slides || []), ...(deck.orphanedSlides || [])]) {
      for (const f of s?.credits?.people || []) if (typeof f === "string" && f) out.add(f);
    }
    return [...out];
  }
  const cmdQuote = (s) => String(s).replace(/%/g, "%%");

  async function makePackage(root, { onStep = () => {} } = {}) {
    if (!state.deckSessionReady || !state.deck) throw new Error("Open a presentation first.");
    const t0 = Date.now();
    const base = deckFileBase(state.deck.meta?.title);
    const loc = makeLocaliser();

    // 1. the presentation, with its pages made to work offline
    const deckDir = await root.getDirectoryHandle(base, { create: true });
    const copy = await DeckSaveFolder.copyInto(deckDir, { onStep, prepareHtml: loc.prepareHtml });

    // 2. the app, and the portraits the slides credit
    const app = await root.getDirectoryHandle("Interactive Presenter", { create: true });
    const appFailed = [];
    let appBytes = 0;
    for (const f of APP_FILES) {
      onStep(`Copying Interactive Presenter: ${f}`);
      try {
        const r = await fetch(new URL(f.split("/").map(encodeURIComponent).join("/"), location.href).href, { cache: "no-store" });
        if (!(r.ok || r.status === 0)) throw new Error("cannot read it");
        const b = new Uint8Array(await r.arrayBuffer());
        if (!b.length && !/\.cmd$/i.test(f)) throw new Error("empty");
        await writeTo(app, f, b);
        appBytes += b.length;
      } catch (err) { appFailed.push(`${f} (${err.message})`); }
    }
    const portraits = new Set(portraitsUsed(state.deck));
    for (const p of state.people || []) if (p?.file) portraits.add(p.file);
    const people = { copied: 0, missing: [] };
    for (const f of portraits) {
      onStep(`Copying portraits: ${f}`);
      try {
        const r = await fetch(new URL(personPortraitUrl(f), location.href).href, { cache: "no-store" });
        if (!(r.ok || r.status === 0)) throw new Error("missing");
        const b = new Uint8Array(await r.arrayBuffer());
        if (!b.length) throw new Error("missing");
        await writeTo(app, `${PEOPLE_FOLDER_NAME}/${f}`, b);
        people.copied++;
      } catch { if (portraitsUsed(state.deck).includes(f)) people.missing.push(f); }
    }
    if (!portraits.size) await writeTo(app, `${PEOPLE_FOLDER_NAME}/Put portraits here.txt`, new TextEncoder().encode("Portrait pictures for credit lines on slides.\r\n"));

    // 3. the launcher and the note
    const startName = `START ${base}.cmd`;
    const cmd = [
      "@echo off",
      `rem Opens "${base}" in Interactive Presenter from THIS folder (no installation needed).`,
      "rem Starts Chrome or Edge in its own window, allowed to read the sims, figures and videos next to the presentation.",
      `title ${cmdQuote(base)}`,
      `powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0Interactive Presenter\\open-ipe.ps1" "%~dp0${cmdQuote(base)}\\${cmdQuote(copy.ipeName)}"`,
      "if errorlevel 1 (",
      "  echo.",
      "  echo   Could not start the presentation - see the message above. Needs Google Chrome or Microsoft Edge.",
      "  pause",
      ")",
      "",
    ].join("\r\n");
    await writeTo(root, startName, new TextEncoder().encode(cmd));
    const readme = [
      `${base} - portable copy (made ${new Date().toISOString().slice(0, 10)} by Interactive Presenter)`,
      "",
      "To run it on another Windows PC:",
      "",
      " 1. Copy this whole folder to the PC (USB stick, or zip it: right-click > Send to > Compressed folder,",
      "    and unzip it on the other PC). Put it on the PC's own disk, e.g. Desktop. Do not run it from",
      "    inside a zip file.",
      ` 2. Double-click  ${startName}`,
      "    Chrome or Edge opens in its own window with the presentation loaded.",
      "    (If Windows says \"Windows protected your PC\": More info -> Run anyway.)",
      " 3. Press Present (top right) or F5. Arrow keys / click to move on, Esc to stop.",
      "",
      "What is in the folder:",
      `    ${startName}`,
      "    Interactive Presenter\\     the app, and People\\ (portraits for the credit lines)",
      `    ${base}\\`.padEnd(30) + `the presentation (${copy.ipeName}) and the files its slides use`,
      loc.log.libs.size ? `    ${base}\\${LIB_DIR}\\`.padEnd(30) + "web libraries the sims use, copied so no internet is needed" : "",
      "",
      "Keep the folders together as they are: the presentation loads its sims, videos and figures from",
      "the folder it sits in.",
      "",
      "Alternative: double-click \"Interactive Presenter\\Install Interactive Presenter.cmd\" once; after that",
      "a double-click on the .ipe file opens it too.",
      "",
      "Needs: Windows, and Google Chrome or Microsoft Edge (Edge is part of Windows 11).",
      "",
    ].filter((l) => l !== null).join("\r\n");
    await writeTo(root, "READ ME FIRST.txt", new TextEncoder().encode(readme));

    const offlineProblems = loc.log.failed.size + loc.log.left.size;
    return {
      folder: root.name, base, startName, copy, appFailed, appBytes, people, log: loc.log,
      seconds: Math.round((Date.now() - t0) / 1000),
      complete: copy.independent && !appFailed.length && !people.missing.length && !offlineProblems,
    };
  }
  async function writeTo(dir, rel, bytes) {
    let d = dir;
    const parts = rel.split("/");
    for (const p of parts.slice(0, -1)) d = await d.getDirectoryHandle(p, { create: true });
    const h = await d.getFileHandle(parts.pop(), { create: true });
    const w = await h.createWritable();
    await w.write(bytes);
    await w.close();
  }

  // ---- the dialog ---------------------------------------------------------------------------------------
  let modal = null, busy = false, last = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "deckPortableModal";
    modal.className = "manual-modal hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="manual-modal-backdrop" data-close="1"></div>
      <div class="manual-modal-content deck-links-content">
        <div class="manual-modal-header"><h2>Make portable package</h2><button type="button" class="manual-close" data-close="1" aria-label="Close">&times;</button></div>
        <div class="manual-scroller deck-links-body"></div>
      </div>`;
    modal.addEventListener("click", (e) => { if (e.target?.dataset?.close && !busy) modal.classList.add("hidden"); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !busy && !modal.classList.contains("hidden")) modal.classList.add("hidden"); });
    document.body.appendChild(modal);
    return modal;
  }
  function show(html) { const m = ensureModal(); m.querySelector(".deck-links-body").innerHTML = html; m.classList.remove("hidden"); }
  function list(items, max = 12) {
    if (!items.length) return "";
    return "<ul>" + items.slice(0, max).map((x) => `<li>${x}</li>`).join("") + (items.length > max ? `<li>… and ${items.length - max} more</li>` : "") + "</ul>";
  }

  async function run() {
    if (busy) return;
    if (!state.deckSessionReady || !state.deck?.slides?.length) { hint("Open a presentation first."); return; }
    if (typeof window.showDirectoryPicker !== "function") { alert("This browser cannot write into a folder. Use Chrome or Edge."); return; }
    try { const r = await fetch(location.href, { cache: "no-store" }); if (!(r.ok || r.status === 0)) throw 0; }
    catch { alert("To copy the app and the files the slides use, Interactive Presenter must be started from its desktop icon or by double-clicking an .ipe file."); return; }
    let root;
    try { root = await window.showDirectoryPicker({ id: "ipe-portable-package", mode: "readwrite", startIn: "documents" }); }
    catch (err) { if (err?.name !== "AbortError") alert("Could not use that folder (" + err.message + ")."); return; }
    const items = [];
    for await (const [name] of root.entries()) { items.push(name); if (items.length > 5) break; }
    if (items.length && !confirm(`The folder "${root.name}" is not empty (${items.slice(0, 5).join(", ")}${items.length > 5 ? ", …" : ""}).\n\nPut the package into it anyway? Files with the same names are replaced; nothing else is removed.\n\n(For a new folder: Cancel, click again and use "New folder" in the dialog.)`)) return;
    busy = true;
    show('<p>Needs the internet once, to download the web libraries the sims use.</p><p class="deck-links-dim" id="dppStep">Starting…</p>');
    try {
      last = await makePackage(root, { onStep: (s) => { const el = document.getElementById("dppStep"); if (el) el.textContent = s; } });
      showResult(last);
      hint(`Portable package in “${last.folder}”: double-click ${last.startName} on the other PC.`);
    } catch (err) {
      console.error(err);
      show(`<p class="deck-links-warn">The package failed: ${esc(err.message)}</p>`);
    } finally { busy = false; }
  }

  function showResult(r) {
    const c = r.copy, log = r.log, p = [];
    p.push(`<p><b>Package in “${esc(r.folder)}”</b> (${r.seconds} s): <code>${esc(r.startName)}</code>, <code>Interactive Presenter\\</code> (${mb(r.appBytes)}, ${r.people.copied} portrait${r.people.copied === 1 ? "" : "s"}) and <code>${esc(r.base)}\\</code> (${esc(c.ipeName)} ${mb(c.ipeSize)} and ${c.files.length} file${c.files.length === 1 ? "" : "s"}, ${mb(c.bytes)}).</p>`);
    p.push(r.complete
      ? '<p class="deck-links-ok"><b>✓ Complete:</b> everything the slides use is in the folder and nothing needs the internet. Copy the whole folder; on the other PC double-click the START file.</p>'
      : '<p class="deck-links-warn"><b>The package is written, but check the points below</b> before relying on it.</p>');
    if (log.libs.size) p.push(`<p>Made to work offline: ${log.libs.size} web librar${log.libs.size === 1 ? "y" : "ies"} used by the sims (${[...log.libs.keys()].map((u) => esc(new URL(u).host + new URL(u).pathname.replace(/^(.{0,40}).*$/, "$1"))).slice(0, 8).join(", ")}${log.libs.size > 8 ? ", …" : ""}).</p>`);
    if (log.swapped.size) p.push(`<p class="deck-links-dim">MathJax uses its single-file SVG version instead of CHTML (same formulas; CHTML loads its fonts separately).</p>`);
    if (log.failed.size) p.push(`<p class="deck-links-missing">Could not be downloaded (no internet, or the server refused), so these still need the internet:</p>${list([...log.failed].map(([u, w]) => `${esc(u)} <span class="deck-links-dim">(${esc(w)})</span>`))}`);
    if (log.left.size) p.push(`<p class="deck-links-outside">Loaded from the web by the page itself while it runs (not changed; test that slide without internet):</p>${list([...log.left].map(([u, w]) => `${esc(u)} <span class="deck-links-dim">(${esc(w)})</span>`))}`);
    if (r.appFailed.length) p.push(`<p class="deck-links-missing">App files that could not be copied:</p>${list(r.appFailed.map(esc))}`);
    if (r.people.missing.length) p.push(`<p class="deck-links-missing">Portraits used on slides but not in the People folder:</p>${list(r.people.missing.map(esc))}`);
    const cr = c.rep, why = [];
    if (c.failed.length) why.push(`${c.failed.length} file(s) could not be written`);
    if (c.short.length) why.push(`${c.short.length} file(s) were written with the wrong size`);
    if (c.back.length) why.push(`${c.back.length} link(s) do not lead into the folder: ${c.back.slice(0, 3).map(esc).join("; ")}`);
    if (cr.missing.length) why.push(`missing in the original too: ${cr.missing.slice(0, 5).map((x) => esc(x.ref)).join(", ")}`);
    if (cr.outside.length) why.push(`used from above the folder: ${cr.outside.slice(0, 5).map((x) => esc(x.ref)).join(", ")}`);
    if (cr.fixed.length) why.push(`fixed paths inside a page: ${cr.fixed.slice(0, 5).map((x) => esc(x.ref)).join(", ")}`);
    if (why.length) p.push(`<p class="deck-links-missing">The presentation copy:</p>${list(why)}`);
    if (cr.app) p.push(`<p class="deck-links-dim">${cr.app} DTUwrite/notes board${cr.app === 1 ? "" : "s"}: a DTUwrite board needs DTUwrite running on the other PC; the slides around it are not affected.</p>`);
    p.push('<p class="deck-links-dim">Sims that talk to a live service while they run (an audience poll or feed) still need the internet for that part.</p>');
    if (cr.web.length) p.push(`<p class="deck-links-dim">${cr.web.length} slide source${cr.web.length === 1 ? " is a web page" : "s are web pages"} and still need${cr.web.length === 1 ? "s" : ""} the internet: ${cr.web.slice(0, 4).map((x) => esc(x.url)).join(", ")}.</p>`);
    p.push(`<p class="deck-links-dim">The presentation open now is still the original. The package does not change when you edit it: make the package again after your last edits.</p>`);
    p.push('<p><button type="button" class="primary" data-close="1">Close</button></p>');
    show(p.join(""));
  }

  document.getElementById("portablePackageBtn")?.addEventListener("click", run);
  window.DeckPortable = Object.freeze({ run, makePackage, makeLocaliser, showResult, APP_FILES, last: () => last });
})();
