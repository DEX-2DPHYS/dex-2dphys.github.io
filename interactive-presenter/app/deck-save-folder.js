// "Save to folder…" (Deck panel): an independent copy of the presentation in a folder of its own.
// (loaded after appX.js, deck-links.js and deck-panel.js; uses their globals)
//
// The copy is the .ipe plus every file its linked sims and pages need, so nothing in it points back to
// the original:
//  - links into sims/ html/ pdf/ figures/ movies/ keep their place (sims/x.html -> <folder>\sims\x.html);
//  - other linked pages (e.g. ../10031 Notes/10031Notes.html) move to html/<their folder>/<file> and the
//    link is rewritten; the same goes for embedded sims that load a page from disk;
//  - what those pages load (scripts, styles, pictures, iframes, data) is copied with the same relative
//    layout. It is found twice: by reading the files (src/href/url()/import ...) and by loading each page
//    for a few seconds in a hidden, sandboxed frame and recording what it asks for (catches files a page
//    loads by itself, such as MathJax extensions);
//  - the copy takes its sims from its own folder ("deck:").
// What it cannot follow is listed: files above the new folder, files that are missing, fixed paths
// (file:///C:/...) written inside a page, and links to other pages (<a href>), which are not copied.
// Writing uses the browser's folder picker (File System Access), so it needs no helper; finding the copy's
// path afterwards (to load its sims from there) uses the helper's "locate", as Save As does.
(function () {
  "use strict";
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const decode = (u) => { try { return decodeURIComponent(u); } catch { return String(u || ""); } };
  const hint = (msg) => { if (dom?.modeHint) dom.modeHint.textContent = msg; };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const HTML_RE = /\.(html?|xhtml)$/i;
  const TEXT_RE = /\.(html?|xhtml|js|mjs|cjs|css|svg)$/i;
  const FILE_EXT = "png|jpe?g|gif|svg|webp|avif|ico|bmp|tiff?|mp4|webm|ogg|ogv|mov|m4v|mp3|wav|m4a|flac|json|csv|tsv|txt|xml|js|mjs|css|html?|pdf|glb|gltf|obj|stl|ply|bin|dat|wasm|woff2?|ttf|otf|vtt|srt|npy|npz|md";
  const LITERAL_RE = new RegExp(`["'\`]([^"'\`\\n\\r<>{}$]{1,240}\\.(?:${FILE_EXT}))["'\`]`, "gi");
  const ANCHOR_FILE_RE = new RegExp(`\\.(?:${FILE_EXT})$`, "i");
  // what a page can load from disk ("i.src" or "e.url" in code are not files)
  const KNOWN_EXT_RE = new RegExp(`\\.(?:${FILE_EXT}|xhtml|cjs|frag|vert|glsl|wgsl|hdr|exr|tga|dds|ktx2?|basis|drc|fbx|dae|3ds|las|nc|h5|hdf5|cif|xyz|pdb|mol|sdf|data|mem|map|webmanifest|ico|cur|avi|mkv|aac|opus|oga)$`, "i");
  const MAX_PROBED_PAGES = 40;

  // ---- urls and paths --------------------------------------------------------------------------------
  const clean = (u) => String(u || "").replace(/[?#].*$/, "");
  const fileName = (u) => decode(clean(u).split("/").pop() || "");
  function segs(u) {
    const x = new URL(u);
    return [x.host.toLowerCase(), ...decode(x.pathname).split("/").filter(Boolean)];
  }
  // where `dep` (absolute file url) belongs in the copy, given that `page` (absolute) is copied to `pageRel`;
  // null when it would land above the new folder or is on another drive
  function targetFor(page, pageRel, dep) {
    let a, b;
    try { a = segs(page).slice(0, -1); b = segs(dep); } catch { return null; }
    if (a.length < 2 || b.length < 2 || a[0] !== b[0] || a[1].toLowerCase() !== b[1].toLowerCase()) return null;
    let i = 0;
    while (i < a.length && i < b.length - 1 && a[i].toLowerCase() === b[i].toLowerCase()) i++;
    const out = pageRel.split("/").slice(0, -1);
    for (let k = i; k < a.length; k++) { if (!out.length) return null; out.pop(); }
    out.push(...b.slice(i));
    return out.join("/");
  }
  function windowsPath(url) {
    try { return decode(new URL(url).pathname).replace(/^\/([a-zA-Z]:)/, "$1").replace(/\//g, "\\"); } catch { return String(url || ""); }
  }
  function shortPath(url) {
    const p = windowsPath(url).split("\\");
    return p.length > 4 ? "…\\" + p.slice(-3).join("\\") : p.join("\\");
  }
  const encodeRel = (rel) => rel.split("/").map((s) => encodeURIComponent(s)).join("/");

  // ---- reading files --------------------------------------------------------------------------------
  const existsCache = new Map();
  function exists(url) {
    const key = clean(url).toLowerCase();
    if (!existsCache.has(key)) existsCache.set(key, existsNow(url));
    return existsCache.get(key);
  }
  async function existsNow(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      const ok = r.ok || r.status === 0;
      try { await r.body?.cancel(); } catch { /* fine */ }
      return ok;
    } catch { return false; }
  }
  async function readBytes(url) {
    try {
      const r = await fetch(url, { cache: "no-store" });
      if (!(r.ok || r.status === 0)) return null;
      return new Uint8Array(await r.arrayBuffer());
    } catch { return null; }
  }

  // ---- what a file refers to ------------------------------------------------------------------------
  // [{ ref, sure }]: sure = a src/href/import/url() (missing ones are reported); not sure = a string that
  // looks like a file name in a script (copied when it exists, otherwise ignored)
  function scanRefs(text, isHtml) {
    const out = [];
    const add = (ref, sure) => { if (ref) out.push({ ref: String(ref).trim(), sure }); };
    const anchors = [];
    if (isHtml) {
      // attributes only outside <script>/<style> (minified code is full of "a<b?...src=..." that is no tag);
      // those blocks are still read below as code and CSS
      const markup = text.replace(/<(script|style)\b([^>]*)>[\s\S]*?<\/\1\s*>/gi, (m, tag, attrs) => `<${tag}${attrs}></${tag}>`)
        .replace(/<!--[\s\S]*?-->/g, "");
      for (const m of markup.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
        const tag = m[1].toLowerCase(), attrs = m[2];
        if (tag === "base") continue;
        const relAttr = (/\brel\s*=\s*["']?([^"'>]+)/i.exec(attrs)?.[1] || "").toLowerCase();
        for (const a of attrs.matchAll(/\b(src|href|data|poster|xlink:href|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          const name = a[1].toLowerCase(), val = a[2] ?? a[3] ?? a[4] ?? "";
          if (name === "srcset") { for (const part of val.split(",")) add(part.trim().split(/\s+/)[0], true); continue; }
          if (tag === "a" || tag === "area") {
            if (HTML_RE.test(clean(val))) anchors.push(val);
            else if (ANCHOR_FILE_RE.test(clean(val))) add(val, false);
            continue;
          }
          if (tag === "link" && /\b(canonical|alternate|dns-prefetch|preconnect|search)\b/.test(relAttr)) continue;
          if (tag === "form" || tag === "meta") continue;
          add(val, true);
        }
      }
    }
    for (const m of text.matchAll(/url\(\s*(['"]?)([^'")]+)\1\s*\)/gi)) add(m[2], true);
    for (const m of text.matchAll(/@import\s+(['"])([^'"]+)\1/gi)) add(m[2], true);
    for (const m of text.matchAll(/\b(?:import|export)\s[^'";]*?\bfrom\s*(['"])([^'"]+)\1/g)) add(m[2], true);
    for (const m of text.matchAll(/\bimport\s*\(?\s*(['"])([^'"]+)\1/g)) add(m[2], true);
    for (const m of text.matchAll(/\b(?:new\s+(?:Shared)?Worker|importScripts)\s*\(\s*(['"])([^'"]+)\1/g)) add(m[2], true);
    for (const m of text.matchAll(/new\s+URL\(\s*(['"])([^'"]+)\1\s*,\s*import\.meta\.url/g)) add(m[2], true);
    for (const m of text.matchAll(LITERAL_RE)) add(m[1], false);
    return { refs: out, anchors };
  }
  // a reference worth following: relative, or file:// (which is reported, not followed)
  function kindOfRef(ref) {
    if (!ref || /^(#|data:|blob:|javascript:|mailto:|tel:|about:|chrome:|edge:)/i.test(ref)) return "skip";
    if (/^(https?:)?\/\//i.test(ref)) return "web";
    if (/^file:|^[a-z]:[\\/]/i.test(ref)) return "fixed";
    if (/^\//.test(ref)) return "rootabs";
    if (/^[a-z][\w+.-]*:/i.test(ref)) return "skip";
    if (/[\s]{2,}|^[\w-]+$/.test(ref)) return "skip"; // a bare word, not a path
    // a file name with an extension, and nothing that only code contains
    if (/[(){};,=<>|\\`$!*^]/.test(ref) || !KNOWN_EXT_RE.test(clean(ref))) return "skip";
    return "rel";
  }

  // ---- what a page asks for when it runs ------------------------------------------------------------
  const HOOK = `<script>(function(){var R=window.__ipeRefs=[];function add(u){try{R.push(String(new URL(String(u&&u.url||u),document.baseURI)))}catch(e){}}
var f=window.fetch;if(f)window.fetch=function(i){add(i);return f.apply(this,arguments)};
var o=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,u){add(u);return o.apply(this,arguments)};
if(window.Worker){var W=window.Worker;window.Worker=function(u,x){add(u);return new W(u,x)};window.Worker.prototype=W.prototype}
[window.HTMLImageElement,window.HTMLMediaElement,window.HTMLScriptElement,window.HTMLSourceElement,window.HTMLIFrameElement,window.HTMLTrackElement].forEach(function(C){if(!C)return;var d=Object.getOwnPropertyDescriptor(C.prototype,'src');if(d&&d.set)Object.defineProperty(C.prototype,'src',{get:d.get,set:function(v){add(v);d.set.call(this,v)},configurable:true})});
if(window.HTMLMediaElement)HTMLMediaElement.prototype.play=function(){return Promise.resolve()};
function mem(){var s={};return{getItem:function(k){return Object.prototype.hasOwnProperty.call(s,k)?s[k]:null},setItem:function(k,v){s[k]=String(v)},removeItem:function(k){delete s[k]},clear:function(){s={}},key:function(i){return Object.keys(s)[i]||null},get length(){return Object.keys(s).length}}}
try{Object.defineProperty(window,'localStorage',{value:mem(),configurable:true});Object.defineProperty(window,'sessionStorage',{value:mem(),configurable:true})}catch(e){}
window.alert=window.confirm=window.prompt=function(){};window.open=function(){return null};
if(navigator.mediaDevices)navigator.mediaDevices.getUserMedia=function(){return Promise.reject(new Error('probe'))};
})();<\/script>`;
  async function probePage(url, text) {
    const f = document.createElement("iframe");
    f.setAttribute("sandbox", "allow-scripts allow-same-origin");
    f.setAttribute("allow", "camera 'none'; microphone 'none'; geolocation 'none'; display-capture 'none'; fullscreen 'none'; autoplay 'none'");
    f.setAttribute("aria-hidden", "true");
    f.tabIndex = -1;
    f.style.cssText = "position:fixed;left:-4000px;top:0;width:1280px;height:800px;border:0;pointer-events:none;";
    const head = `<base href="${esc(url)}">${HOOK}`;
    f.srcdoc = /<head\b[^>]*>/i.test(text) ? text.replace(/<head\b[^>]*>/i, (m) => m + head) : head + text;
    document.body.appendChild(f);
    await Promise.race([new Promise((r) => f.addEventListener("load", r, { once: true })), sleep(8000)]);
    await sleep(1800);
    const urls = [];
    try {
      const w = f.contentWindow, d = w.document;
      for (const u of w.__ipeRefs || []) urls.push(u);
      for (const el of d.querySelectorAll("[src],[href],[poster],[data],[srcset]")) {
        const tag = el.tagName.toLowerCase();
        if (tag === "a" || tag === "area" || tag === "base") continue;
        if (tag === "link" && /\b(canonical|alternate|dns-prefetch|preconnect)\b/i.test(el.rel || "")) continue;
        for (const v of [el.src, el.href, el.poster, el.data]) if (typeof v === "string" && v) urls.push(v);
        if (el.srcset) for (const p of el.srcset.split(",")) { try { urls.push(new URL(p.trim().split(/\s+/)[0], d.baseURI).href); } catch { /* skip */ } }
      }
      for (const e of w.performance.getEntriesByType("resource")) urls.push(e.name);
    } catch { /* the page made itself unreadable: the file scan still counts */ }
    try { f.srcdoc = ""; f.remove(); } catch { /* gone */ }
    return [...new Set(urls.map(clean))].filter((u) => /^file:/i.test(u) && clean(u) !== clean(url));
  }

  // ---- the plan ---------------------------------------------------------------------------------------
  function usedAssetIds(deck) {
    const ids = new Set(Object.keys(deck.assets || {}));
    const used = new Set();
    (function walk(x) {
      if (typeof x === "string") { if (ids.has(x)) used.add(x); return; }
      if (x && typeof x === "object") for (const v of Object.values(x)) walk(v);
    })(deck.slides || []);
    return used;
  }

  async function makePlan(onStep) {
    const deck = state.deck;
    const files = new Map(); // lower-case target path -> { rel, src, bytes, text, from, stored }
    const rewrites = new Map(); // asset id -> { url, kind } | { inline: file url }
    const rep = { missing: [], outside: [], conflicts: [], fixed: [], anchors: new Set(), web: [], stored: [], app: 0, embedded: 0, unusedLinks: 0, relocated: [], probed: 0, probeSkipped: 0, media: 0 };
    const queue = [];
    const relocatedFolders = new Map(); // source folder -> html/<name>

    function claim(rel, src, extra = {}) {
      const key = rel.toLowerCase();
      const had = files.get(key);
      if (had) {
        if (had.src && src && clean(had.src) !== clean(src)) rep.conflicts.push({ rel, a: had.src, b: src });
        return null;
      }
      const f = { rel, src, ...extra };
      files.set(key, f);
      return f;
    }
    // html/<folder of the page>/<page>, one folder per source folder (renamed "(2)" on a clash)
    function relocate(srcUrl, name) {
      const folderUrl = srcUrl ? clean(srcUrl).replace(/[^/]*$/, "") : "";
      if (folderUrl && relocatedFolders.has(folderUrl.toLowerCase())) return relocatedFolders.get(folderUrl.toLowerCase()) + "/" + fileName(srcUrl);
      let base = folderUrl ? decode(folderUrl.replace(/\/$/, "").split("/").pop() || "page") : "pages";
      base = base.replace(/[\\/:*?"<>|]+/g, "_") || "page";
      let dir = `html/${base}`, n = 2;
      const taken = () => [...relocatedFolders.values()].some((d) => d.toLowerCase() === dir.toLowerCase());
      while (taken()) dir = `html/${base} (${n++})`;
      if (folderUrl) relocatedFolders.set(folderUrl.toLowerCase(), dir);
      return `${dir}/${srcUrl ? fileName(srcUrl) : name}`;
    }
    async function addTop(asset, srcUrl, rel) {
      const ok = srcUrl && /^file:/i.test(srcUrl) && (await exists(srcUrl));
      if (ok) {
        const f = claim(rel, srcUrl, { from: asset.name });
        if (f && TEXT_RE.test(rel)) queue.push(f);
        return true;
      }
      if (asset.htmlText) {
        claim(rel, "", { text: asset.htmlText, stored: true, from: asset.name });
        rep.stored.push({ name: asset.name, rel, src: srcUrl });
        return true;
      }
      rep.missing.push({ name: asset.name, ref: srcUrl || asset.url || asset.name, from: "the deck" });
      return false;
    }

    const used = usedAssetIds(deck);
    onStep("Finding the linked files…");
    for (const [id, a] of Object.entries(deck.assets || {})) {
      if (!a || typeof a !== "object") continue;
      const isLink = a.kind === "overlay-html-filelink" || (a.kind === "overlay-html-external" && /^file:/i.test(String(a.url || "")));
      // pictures and videos go into figures\ / videos\ of the copy, never into its .ipe (2026-10-28):
      // a linked one is copied from its file; one stored inside the deck is written out and linked.
      // Also the ones no slide uses (parked sources): otherwise they alone keep the .ipe big.
      if (MEDIA_LINK_FOLDERS[a.kind] && (isLinkedMediaAsset(a) || /^data:/i.test(String(a.dataUrl || "")))) {
        const keepInside = !!state.deck.settings?.keepLinkedCopies;
        const stored = /^data:/i.test(String(a.dataUrl || ""));
        const fileUrl = isLinkedMediaAsset(a) ? linkedMediaFileUrl(a) : "";
        if (fileUrl && (await exists(fileUrl))) {
          claim(decode(clean(normalizeConventionRelativePath(a.url))), fileUrl, { from: a.name });
          rep.media++;
          continue;
        }
        if (!stored) { if (used.has(id)) rep.missing.push({ name: a.name, ref: fileUrl || a.url || a.name, from: "the deck" }); continue; }
        const folder = MEDIA_LINK_FOLDERS[a.kind][0];
        const base = mediaFileNameFor(a);
        let rel = `${folder}/${base}`;
        for (let n = 2; files.has(rel.toLowerCase()); n++) rel = `${folder}/${base.replace(/(\.[^.]+)?$/, (ext) => `-${n}${ext || ""}`)}`;
        const blob = dataUrlToBlob(a.dataUrl, a.mime);
        claim(rel, "", { bytes: new Uint8Array(await blob.arrayBuffer()), from: a.name });
        rewrites.set(id, { mediaUrl: encodeRel(rel), keepInside });
        rep.media++;
        continue;
      }
      if (!used.has(id)) { if (isLink) rep.unusedLinks++; continue; }
      if (a.kind === "overlay-notes-board" || a.kind === "overlay-dtuwrite" || a.kind === "overlay-notebook-panel") { rep.app++; continue; }
      if (typeof a.dataUrl === "string" && /^file:/i.test(a.dataUrl)) { rewrites.set(id, { inline: a.dataUrl }); continue; }
      if (a.kind === "overlay-html-external" && !isLink) { if (a.url) rep.web.push({ name: a.name, url: a.url }); continue; }
      if (a.kind === "overlay-html-file") {
        const ext = a.htmlText ? resolveHtmlFileSourceExternalUrl(a, a.htmlText) : "";
        if (!ext) { rep.embedded++; continue; }
        const abs = new URL(ext, location.href).href;
        const rel = relocate(abs, a.name);
        if (await addTop(a, abs, rel)) {
          rewrites.set(id, { url: encodeRel(rel), kind: "overlay-html-filelink" });
          rep.relocated.push({ name: a.name, from: abs, rel });
        }
        continue;
      }
      if (!isLink) continue;
      const stored = String(a.url || "");
      const resolved = a.kind === "overlay-html-external" ? stored : resolveHtmlFileLinkUrl(a);
      if (/^https?:/i.test(resolved)) { rep.web.push({ name: a.name, url: resolved }); continue; }
      const abs = resolved ? new URL(resolved, location.href).href : "";
      const rootRel = normalizeConventionRelativePath(stored);
      if (rootRel) {
        await addTop(a, abs, decode(clean(rootRel)));
        continue; // the link stays as it is
      }
      const rel = relocate(abs, a.name || fileName(stored) || "page.html");
      if (await addTop(a, abs, rel)) {
        rewrites.set(id, { url: encodeRel(rel), kind: "overlay-html-filelink" });
        rep.relocated.push({ name: a.name, from: abs || stored, rel });
      }
    }

    // what those files need, recursively
    let scanned = 0;
    // four at a time: most of the wait is pages settling in their hidden frames
    let active = 0;
    const worker = async () => {
      for (;;) {
        if (!queue.length) {
          if (!active) return;
          await sleep(50);
          continue;
        }
        const f = queue.shift();
        active++;
        try { await follow(f); } finally { active--; }
      }
    };
    await Promise.all([worker(), worker(), worker(), worker()]);
    const once = (arr, key) => { const seen = new Set(); return arr.filter((x) => { const k = key(x).toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; }); };
    rep.missing = once(rep.missing, (x) => x.ref);
    rep.outside = once(rep.outside, (x) => x.ref);
    rep.fixed = once(rep.fixed, (x) => `${x.in}|${x.ref}`);
    rep.conflicts = once(rep.conflicts, (x) => `${x.rel}|${x.b}`);
    return { files: [...files.values()], rewrites, rep };

    async function follow(f) {
      scanned++;
      onStep(`Following what the pages use… (${scanned} read, ${files.size} files so far)`);
      f.bytes = await readBytes(f.src);
      if (!f.bytes) return;
      const text = new TextDecoder("utf-8").decode(f.bytes);
      const isHtml = HTML_RE.test(f.rel);
      const { refs, anchors } = scanRefs(text, isHtml);
      for (const a of anchors) { try { rep.anchors.add(fileName(new URL(a, f.src).href)); } catch { /* odd */ } }
      const deps = [];
      for (const { ref, sure } of refs) {
        const k = kindOfRef(ref);
        if (k === "fixed") { if (sure || /^file:/i.test(ref)) rep.fixed.push({ in: f.rel, ref }); continue; }
        if (k === "rootabs") { if (sure) rep.outside.push({ in: f.rel, ref }); continue; }
        if (k !== "rel") continue;
        let abs;
        try { abs = clean(new URL(ref, f.src).href); } catch { continue; }
        deps.push({ abs, sure, ref });
      }
      if (isHtml) {
        if (rep.probed < MAX_PROBED_PAGES) {
          rep.probed++;
          onStep(`Loading ${fileName(f.src)} briefly to see what it asks for… (${scanned} read, ${files.size} files so far)`);
          for (const abs of await probePage(f.src, text)) deps.push({ abs, sure: true, ref: abs, run: true });
        } else rep.probeSkipped++;
      }
      for (const d of deps) {
        if (clean(d.abs) === clean(f.src)) continue;
        const rel = targetFor(f.src, f.rel, d.abs);
        if (rel === null) {
          if (d.sure && (await exists(d.abs))) rep.outside.push({ in: f.rel, ref: d.run ? windowsPath(d.abs) : d.ref });
          continue;
        }
        const key = rel.toLowerCase();
        if (files.has(key)) {
          const had = files.get(key);
          if (had.src && clean(had.src) !== clean(d.abs)) rep.conflicts.push({ rel, a: had.src, b: d.abs });
          continue;
        }
        if (!(await exists(d.abs))) {
          if (d.sure && !d.run) rep.missing.push({ name: fileName(d.abs), ref: d.ref, from: f.rel });
          continue;
        }
        const nf = claim(rel, d.abs, { from: f.rel });
        if (nf && TEXT_RE.test(rel)) queue.push(nf);
      }
    }
  }

  // ---- writing ----------------------------------------------------------------------------------------
  async function dirFor(root, rel, create = true) {
    let d = root;
    for (const part of rel.split("/").slice(0, -1)) d = await d.getDirectoryHandle(part, { create });
    return d;
  }
  async function writeFile(root, rel, data) {
    const d = await dirFor(root, rel);
    const h = await d.getFileHandle(rel.split("/").pop(), { create: true });
    const w = await h.createWritable();
    if (data instanceof ReadableStream) await data.pipeTo(w); // closes w
    else { await w.write(data); await w.close(); }
    return h;
  }
  async function fileSize(root, rel) {
    try { const d = await dirFor(root, rel, false); return (await (await d.getFileHandle(rel.split("/").pop())).getFile()).size; } catch { return -1; }
  }
  function blobToDataUrl(blob) {
    return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(blob); });
  }

  // prepareHtml (optional, "Make portable package…"): async ({ text, rel, embedded }) -> { text, extra: [{ rel, bytes }] }
  // is given every copied page and every page stored in the deck before it is written; extra files it
  // returns (local copies of web libraries) are written beside them and checked like the rest.
  async function copyInto(root, { onStep = () => {}, prepareHtml = null } = {}) {
    if (!state.deckSessionReady || !state.deck) throw new Error("Open a presentation first.");
    const t0 = Date.now();
    const plan = await makePlan(onStep);
    const { files, rewrites, rep } = plan;

    // 1. the files
    let n = 0, bytes = 0;
    const failed = [];
    const extras = [];
    const extraRels = new Set(files.map((f) => f.rel.toLowerCase()));
    for (const f of files) {
      n++;
      onStep(`Copying ${n} of ${files.length}: ${f.rel}`);
      try {
        if (prepareHtml && HTML_RE.test(f.rel)) {
          if (!f.bytes && !f.stored) f.bytes = await readBytes(f.src);
          const text = f.stored ? f.text : new TextDecoder("utf-8").decode(f.bytes);
          const out = await prepareHtml({ text, rel: f.rel, embedded: false, onStep });
          f.bytes = new TextEncoder().encode(out.text);
          f.stored = false;
          for (const x of out.extra || []) {
            if (extraRels.has(x.rel.toLowerCase())) continue;
            extraRels.add(x.rel.toLowerCase());
            extras.push({ rel: x.rel, src: x.src || "", bytes: x.bytes, from: f.rel });
          }
        }
        if (f.bytes) { await writeFile(root, f.rel, f.bytes); f.size = f.bytes.length; }
        else if (f.stored) { const b = new TextEncoder().encode(f.text); await writeFile(root, f.rel, b); f.size = b.length; }
        else {
          const r = await fetch(f.src, { cache: "no-store" });
          if (!(r.ok || r.status === 0) || !r.body) throw new Error("cannot read it");
          await writeFile(root, f.rel, r.body);
          f.size = await fileSize(root, f.rel);
        }
        bytes += Math.max(0, f.size || 0);
      } catch (err) { failed.push({ rel: f.rel, why: err.message }); }
      f.bytes = null;
    }
    for (const x of extras) {
      onStep(`Writing ${x.rel}`);
      try { await writeFile(root, x.rel, x.bytes); x.size = x.bytes.length; bytes += x.size; }
      catch (err) { failed.push({ rel: x.rel, why: err.message }); }
      x.bytes = null;
      files.push(x);
    }

    // 2. the presentation, taking its sims from its own folder
    onStep("Writing the presentation…");
    const inlined = [];
    const transform = async (packaged) => {
      if (prepareHtml) {
        const usedIds = usedAssetIds(packaged);
        for (const [id, a] of Object.entries(packaged.assets || {})) {
          if (!usedIds.has(id) || !a || typeof a.htmlText !== "string" || !a.htmlText) continue;
          const out = await prepareHtml({ text: a.htmlText, rel: a.name || id, embedded: true, onStep });
          a.htmlText = out.text;
        }
      }
      packaged.settings = packaged.settings || {};
      packaged.settings.presentationRootPath = "deck:";
      delete packaged.settings.rootKeptInFolder;
      for (const [id, rw] of rewrites) {
        const a = packaged.assets?.[id];
        if (!a) continue;
        if (rw.mediaUrl) { // written into figures\ / videos\ of the copy: the .ipe only links to it
          a.url = rw.mediaUrl;
          if (!rw.keepInside) delete a.dataUrl;
          continue;
        }
        if (rw.inline) {
          try {
            const r = await fetch(rw.inline);
            a.dataUrl = await blobToDataUrl(await r.blob());
            inlined.push(a.name || id);
          } catch { rep.missing.push({ name: a.name || id, ref: rw.inline, from: "the deck" }); }
          continue;
        }
        a.kind = rw.kind;
        a.url = rw.url;
        a.mime = "text/uri-list";
        a.preferSnapshot = false;
      }
    };
    const blob = await buildDeckZipBlob(transform);
    const ipeName = `${deckFileBase(state.deck.meta?.title)}.ipe`;
    const ipeHandle = await writeFile(root, ipeName, blob);

    // 3. check the copy: every file there at its size, and the deck links only to them
    onStep("Checking the copy…");
    const short = [];
    for (const f of files) {
      if (failed.some((x) => x.rel === f.rel)) continue;
      const s = await fileSize(root, f.rel);
      if (s < 0 || (f.size >= 0 && s !== f.size)) short.push(f.rel);
    }
    const back = [];
    try {
      const z = await JSZip.loadAsync(await ipeHandle.getFile());
      const d = JSON.parse(await z.file("deck.json").async("string"));
      const have = new Set(files.map((f) => f.rel.toLowerCase()));
      if (d.settings?.presentationRootPath !== "deck:") back.push("the presentation root is not its own folder");
      const usedIds = usedAssetIds(d);
      for (const [id, a] of Object.entries(d.assets || {})) {
        if (!usedIds.has(id) || !a) continue;
        if (typeof a.dataUrl === "string" && /^file:/i.test(a.dataUrl)) back.push(`${a.name || id}: ${a.dataUrl}`);
        if (isLinkedMediaAsset(a)) {
          const rr = normalizeConventionRelativePath(String(a.url || ""));
          if (!have.has(decode(clean(rr)).toLowerCase())) back.push(`${a.name || id}: ${decode(rr)} is not in the folder`);
          continue;
        }
        if (a.kind !== "overlay-html-filelink" && !(a.kind === "overlay-html-external" && /^file:/i.test(a.url || ""))) continue;
        const u = String(a.url || "");
        if (/^https?:/i.test(u)) continue;
        const rr = normalizeConventionRelativePath(u);
        if (!rr) back.push(`${a.name || id}: ${u}`);
        else if (!have.has(decode(clean(rr)).toLowerCase())) back.push(`${a.name || id}: ${decode(rr)} is not in the folder`);
      }
    } catch (err) { back.push("could not read the written .ipe back (" + err.message + ")"); }

    return {
      folder: root.name, ipeName, ipeHandle, ipeSize: blob.size, files, bytes, failed, short, back, inlined, rep,
      seconds: Math.round((Date.now() - t0) / 1000),
      independent: !failed.length && !short.length && !back.length && !rep.outside.length && !rep.missing.length && !rep.fixed.length && !rep.conflicts.length,
    };
  }

  // ---- the dialog -------------------------------------------------------------------------------------
  let modal = null;
  function ensureModal() {
    if (modal) return modal;
    modal = document.createElement("div");
    modal.id = "deckSaveFolderModal";
    modal.className = "manual-modal hidden";
    modal.setAttribute("role", "dialog");
    modal.setAttribute("aria-modal", "true");
    modal.innerHTML = `<div class="manual-modal-backdrop" data-close="1"></div>
      <div class="manual-modal-content deck-links-content">
        <div class="manual-modal-header"><h2>Save to folder</h2><button type="button" class="manual-close" data-close="1" aria-label="Close">&times;</button></div>
        <div class="manual-scroller deck-links-body"></div>
      </div>`;
    modal.addEventListener("click", (e) => {
      if (e.target?.dataset?.close && !busy) modal.classList.add("hidden");
      if (e.target?.dataset?.act === "continue") continueWithCopy();
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !busy && !modal.classList.contains("hidden")) modal.classList.add("hidden"); });
    document.body.appendChild(modal);
    return modal;
  }
  const body = () => ensureModal().querySelector(".deck-links-body");
  function show(html) { const m = ensureModal(); body().innerHTML = html; m.classList.remove("hidden"); }

  let busy = false, last = null, originalFolder = "";
  async function hasFileAccess() {
    try { const r = await fetch(location.href, { cache: "no-store" }); return r.ok || r.status === 0; } catch { return false; }
  }

  async function saveToFolder() {
    if (busy) return;
    if (!state.deckSessionReady || !state.deck?.slides?.length) { hint("Open a presentation first."); return; }
    if (typeof window.showDirectoryPicker !== "function") {
      alert("This browser cannot write into a folder. Use Chrome or Edge (Interactive Presenter's desktop icon starts one).");
      return;
    }
    let root;
    try {
      root = await window.showDirectoryPicker({ id: "ipe-save-to-folder", mode: "readwrite", startIn: "documents" });
    } catch (err) {
      if (err?.name !== "AbortError") alert("Could not use that folder (" + err.message + ").");
      return;
    }
    if (!(await hasFileAccess())) {
      alert("To copy the files the slides link to, Interactive Presenter must be started from its desktop icon or by double-clicking an .ipe file (it then may read files on this PC).");
      return;
    }
    const items = [];
    for await (const [name] of root.entries()) { items.push(name); if (items.length > 5) break; }
    if (items.length) {
      const ok = confirm(`The folder "${root.name}" is not empty (${items.slice(0, 5).join(", ")}${items.length > 5 ? ", …" : ""}).\n\nSave the presentation into it anyway? Files with the same names are replaced; nothing else is removed.\n\n(To make a new folder: Cancel, click Save to folder again and use "New folder" in the dialog.)`);
      if (!ok) return;
    }
    originalFolder = state.deckFileUrl ? windowsPath(new URL("./", state.deckFileUrl).href) : "";
    busy = true;
    show('<p class="deck-links-dim" id="dsfStep">Starting…</p>');
    try {
      last = await copyInto(root, { onStep: (s) => { const el = document.getElementById("dsfStep"); if (el) el.textContent = s; } });
      showResult(last);
      hint(`Saved a copy in “${last.folder}”: ${last.ipeName} and ${last.files.length} file${last.files.length === 1 ? "" : "s"}.`);
    } catch (err) {
      console.error(err);
      show(`<p class="deck-links-warn">The copy failed: ${esc(err.message)}</p>`);
    } finally { busy = false; }
  }

  const mb = (b) => b >= 1048576 ? `${(b / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`;
  function list(items, fmt, max = 12) {
    if (!items.length) return "";
    return "<ul>" + items.slice(0, max).map((x) => `<li>${fmt(x)}</li>`).join("") + (items.length > max ? `<li>… and ${items.length - max} more</li>` : "") + "</ul>";
  }
  function showResult(r) {
    const p = [];
    const rep = r.rep;
    p.push(`<p><b>Saved in “${esc(r.folder)}”:</b> ${esc(r.ipeName)} (${mb(r.ipeSize)}) and ${r.files.length} file${r.files.length === 1 ? "" : "s"} (${mb(r.bytes)}), in ${r.seconds} s.</p>`);
    p.push(r.independent
      ? '<p class="deck-links-ok"><b>✓ The copy is independent:</b> its sims and pages load from its own folder, nothing points back to the original.</p>'
      : '<p class="deck-links-warn"><b>The copy is saved, but some things still need you:</b> see below.</p>');
    const why = [];
    if (r.failed.length) why.push(`<p class="deck-links-missing">Could not be written:</p>${list(r.failed, (x) => `${esc(x.rel)} (${esc(x.why)})`)}`);
    if (r.short.length) why.push(`<p class="deck-links-missing">Written with the wrong size:</p>${list(r.short, esc)}`);
    if (r.back.length) why.push(`<p class="deck-links-missing">Links in the deck that do not lead into the folder:</p>${list(r.back, esc)}`);
    if (rep.missing.length) why.push(`<p class="deck-links-missing">Missing in the original too (not copied):</p>${list(rep.missing, (x) => `${esc(x.ref)} <span class="deck-links-dim">(used by ${esc(x.from)})</span>`)}`);
    if (rep.outside.length) why.push(`<p class="deck-links-outside">Used from above the new folder, so not copied (move them in by hand, or put the page deeper):</p>${list(rep.outside, (x) => `${esc(x.ref)} <span class="deck-links-dim">(in ${esc(x.in)})</span>`)}`);
    if (rep.fixed.length) why.push(`<p class="deck-links-outside">Fixed paths written inside a page, which still point at this PC's files:</p>${list(rep.fixed, (x) => `${esc(x.ref)} <span class="deck-links-dim">(in ${esc(x.in)})</span>`)}`);
    if (rep.conflicts.length) why.push(`<p class="deck-links-outside">Two different files wanted the same place (the first was kept):</p>${list(rep.conflicts, (x) => `${esc(x.rel)}: ${esc(shortPath(x.a))} / ${esc(shortPath(x.b))}`)}`);
    p.push(...why);
    const info = [];
    if (rep.relocated.length) info.push(`${rep.relocated.length} linked page${rep.relocated.length === 1 ? " was" : "s were"} outside the presentation's folder and now sit${rep.relocated.length === 1 ? "s" : ""} in <code>html\\</code> (the slides point there).`);
    if (rep.stored.length) info.push(`${rep.stored.length} page${rep.stored.length === 1 ? "" : "s"} could not be found on disk and ${rep.stored.length === 1 ? "was" : "were"} written from the copy stored in the deck: ${rep.stored.map((x) => esc(x.name)).join(", ")}.`);
    if (r.inlined.length) info.push(`${r.inlined.length} picture/video/PDF that was a file link is now stored inside the deck.`);
    if (rep.media) info.push(`${rep.media} picture${rep.media === 1 ? "" : "s"} and video${rep.media === 1 ? "" : "s"} sit in <code>figures\\</code> and <code>videos\\</code> of the new folder; the .ipe only links to them.`);
    if (rep.embedded) info.push(`${rep.embedded} sim${rep.embedded === 1 ? " is" : "s are"} stored inside the deck (no files needed).`);
    if (rep.web.length) info.push(`${rep.web.length} web address${rep.web.length === 1 ? "" : "es"} stay as they are (they need the internet): ${rep.web.slice(0, 4).map((x) => esc(x.url)).join(", ")}${rep.web.length > 4 ? ", …" : ""}.`);
    if (rep.anchors.size) info.push(`Links to other pages (clicked, not shown) were not copied: ${[...rep.anchors].slice(0, 6).map(esc).join(", ")}${rep.anchors.size > 6 ? ", …" : ""}.`);
    if (rep.app) info.push(`${rep.app} notes/DTUwrite board${rep.app === 1 ? " is" : "s are"} part of Interactive Presenter itself and need${rep.app === 1 ? "s" : ""} nothing copied.`);
    if (rep.unusedLinks) info.push(`${rep.unusedLinks} linked source${rep.unusedLinks === 1 ? " is" : "s are"} not used on any slide and ${rep.unusedLinks === 1 ? "was" : "were"} left as ${rep.unusedLinks === 1 ? "it was" : "they were"} (Prune unused removes them).`);
    if (rep.probeSkipped) info.push(`${rep.probeSkipped} page${rep.probeSkipped === 1 ? " was" : "s were"} only read, not loaded (over ${MAX_PROBED_PAGES}); a file such a page loads by itself may be missing.`);
    if (info.length) p.push("<p>" + info.join("</p><p>") + "</p>");
    if (r.files.length) {
      p.push('<table class="deck-links-table"><thead><tr><th>In the new folder</th><th>Copied from</th><th>Size</th></tr></thead><tbody>' +
        r.files.slice(0, 400).map((f) => `<tr><td>${esc(f.rel.replace(/\//g, "\\"))}</td><td title="${esc(f.src ? windowsPath(f.src) : "")}">${f.stored ? "the copy stored in the deck" : esc(shortPath(f.src))}</td><td>${f.size >= 0 ? mb(f.size) : "?"}</td></tr>`).join("") +
        (r.files.length > 400 ? `<tr><td colspan="3">… and ${r.files.length - 400} more</td></tr>` : "") + "</tbody></table>");
    }
    p.push(`<p>The presentation open now is still the original${state.dirty ? " (its unsaved changes are in the copy, not in the original file)" : ""}.</p>
      <p><button type="button" class="primary" data-act="continue">Continue with the copy</button> <button type="button" data-close="1">Keep the original open</button></p>`);
    show(p.join(""));
  }

  async function continueWithCopy() {
    if (!last?.ipeHandle) return;
    modal.classList.add("hidden");
    const handle = last.ipeHandle;
    try {
      await loadDeckZip(await handle.getFile(), { fileHandle: handle });
    } catch (err) { alert("Could not open the copy (" + err.message + ")."); return; }
    hint(`Working on the copy ${last.ipeName}. Finding its folder so its sims load from there…`);
    if (window.DeckPanel?.locateSavedFile) window.DeckPanel.locateSavedFile(handle, { near: originalFolder });
  }

  document.getElementById("saveToFolderBtn")?.addEventListener("click", saveToFolder);
  window.DeckSaveFolder = Object.freeze({ saveToFolder, copyInto, makePlan, targetFor, scanRefs, last: () => last });
})();
