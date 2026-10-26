// DTUwrite pages for the Interactive Presenter (loaded after appX.js; uses its globals).
//
// A DTUwrite page is a slide with an overlay whose source is a "DTUwrite board" (asset kind
// overlay-dtuwrite). The board is the DTUwrite whiteboard running on this PC (its server on
// http://localhost:5178, opened as /?embed=ip&key=<board key>, see DTUwrite's public/embed.js).
// What is written is kept in the deck (deck.dtuwriteBoards[key]) and saved inside the .ipe file:
//   dtuwrite/<key>.json       the board in DTUwrite's own session format: ink, regions, typeset
//                             results, answers, text boxes, slides and figures as data
//   dtuwrite/<key>-NN.webp    a picture of each page, shown when DTUwrite is not running on a PC
// The deck holds only data, never DTUwrite's code, so an updated DTUwrite opens every older deck.
//
// The boards run in their own layer at the bottom of the stage, which survives the presenter's
// re-renders (renderStage rebuilds the stage on every change; reloading DTUwrite each time would lose
// the stroke being written and the board's undo history). Each frame follows the position, size,
// z-order and visibility (animations) of its overlay element on the stage.
(function () {
  "use strict";
  // ?dtuwrite=<address> points at another DTUwrite server (tests run one on a spare port)
  const DTUWRITE_URL = new URLSearchParams(location.search).get("dtuwrite") || "http://localhost:5178/";
  const PROTOCOL = 1;
  const KIND = "overlay-dtuwrite";
  const MAX_LIVE = 4;               // boards kept running at the same time (each is a whole DTUwrite)
  const START_TIMEOUT_MS = 20000;   // a board that has not said hello by then: DTUwrite counts as missing
  const COLLECT_TIMEOUT_MS = 8000;  // per board, when the deck is saved

  const frames = new Map();         // key -> frame record
  let layer = null;
  let server = "unknown";           // "unknown" | "up" | "down"
  let probeTimer = 0;
  let probing = false;
  let reqSeq = 0;
  let syncQueued = false;

  // ---- deck data -------------------------------------------------------------------------------
  function boards(deck = state.deck) {
    if (!deck) return {};
    if (!deck.dtuwriteBoards || typeof deck.dtuwriteBoards !== "object") deck.dtuwriteBoards = {};
    return deck.dtuwriteBoards;
  }

  function isDtuwriteOverlay(overlay) {
    const source = overlay && resolveAssetByAnyId(overlay.sourceId);
    return !!source && source.kind === KIND;
  }

  function ensureSource() {
    const existing = Object.values(state.deck.assets || {}).find((a) => a && a.kind === KIND);
    if (existing) return existing.id;
    const id = uid();
    state.deck.assets[id] = { id, kind: KIND, mime: "text/html", name: "DTUwrite board" };
    return id;
  }

  function ensureKey(overlay) {
    if (!overlay.dtuwriteKey) {
      overlay.dtuwriteKey = uid();
      touch();
    }
    return overlay.dtuwriteKey;
  }

  function referencedKeys(deck) {
    const keys = new Set();
    for (const slide of deck?.slides || []) {
      for (const o of slide?.overlays || []) if (o?.dtuwriteKey) keys.add(o.dtuwriteKey);
    }
    return keys;
  }

  // ---- frames ----------------------------------------------------------------------------------
  function getLayer() {
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "dtuwrite-layer";
    }
    if (layer.parentElement !== dom.stage) dom.stage.prepend(layer);
    return layer;
  }

  function createFrame(key) {
    const iframe = document.createElement("iframe");
    iframe.className = "dtuwrite-frame";
    iframe.allow = "fullscreen; microphone; clipboard-read; clipboard-write";
    iframe.style.visibility = "hidden"; // until DTUwrite says hello (or it would show an error page)
    iframe.src = `${DTUWRITE_URL}?embed=ip&key=${encodeURIComponent(key)}`;
    const f = { key, iframe, ready: false, el: null, lastUsed: Date.now(), waiters: new Map(), timer: 0 };
    f.timer = setTimeout(() => {
      if (!f.ready) {
        destroyFrame(key);
        setServer("down");
      }
    }, START_TIMEOUT_MS);
    frames.set(key, f);
    getLayer().appendChild(iframe);
    return f;
  }

  function destroyFrame(key) {
    const f = frames.get(key);
    if (!f) return;
    clearTimeout(f.timer);
    for (const done of f.waiters.values()) done();
    f.iframe.remove();
    frames.delete(key);
  }

  function frameOf(win) {
    for (const f of frames.values()) if (f.iframe.contentWindow === win) return f;
    return null;
  }

  // ---- DTUwrite running? ------------------------------------------------------------------------
  // no-cors: resolves if anything answers on the port, rejects if nothing does (works from file://)
  function probe() {
    return fetch(`${DTUWRITE_URL}index.html`, { mode: "no-cors", cache: "no-store" }).then(() => true, () => false);
  }

  function setServer(next) {
    if (server === next) return;
    server = next;
    clearTimeout(probeTimer);
    if (next === "down") {
      for (const f of [...frames.values()]) if (!f.ready) destroyFrame(f.key);
      const again = async () => {
        if (await probe()) setServer("up");
        else probeTimer = setTimeout(again, 3000);
      };
      probeTimer = setTimeout(again, 3000);
    }
    scheduleSync();
  }

  // ---- messages from the boards -----------------------------------------------------------------
  window.addEventListener("message", (e) => {
    const d = e.data;
    if (!d || typeof d !== "object" || typeof d.type !== "string" || !d.type.startsWith("dtuwrite-embed-")) return;
    const f = frameOf(e.source);
    if (!f) return;
    if (d.type === "dtuwrite-embed-ready") {
      // Answer every hello: DTUwrite ignores a second load, and a board that reloaded needs one again.
      clearTimeout(f.timer);
      f.ready = true;
      setServer("up");
      const rec = boards()[f.key];
      e.source.postMessage({ type: "dtuwrite-embed-load", protocol: PROTOCOL, key: f.key, board: rec?.board || null }, "*");
      scheduleSync();
    } else if (d.type === "dtuwrite-embed-state") {
      if (d.board && !d.unchanged) {
        const all = boards();
        const rec = all[f.key] || {};
        all[f.key] = {
          ...rec,
          v: PROTOCOL,
          board: d.board,
          updatedAt: new Date().toISOString(),
          ...(Array.isArray(d.snapshots) ? { snapshots: d.snapshots, cur: Number(d.cur) || 0 } : {}),
        };
        touch();
      }
      if (d.reqId && f.waiters.has(d.reqId)) {
        f.waiters.get(d.reqId)();
        f.waiters.delete(d.reqId);
      }
    }
  });

  // The newest board and fresh page pictures from one running board (before a save).
  function collect(f) {
    if (!f.ready || !f.iframe.contentWindow) return Promise.resolve();
    const reqId = `c${++reqSeq}`;
    return new Promise((resolve) => {
      const t = setTimeout(() => {
        f.waiters.delete(reqId);
        resolve();
      }, COLLECT_TIMEOUT_MS);
      f.waiters.set(reqId, () => {
        clearTimeout(t);
        resolve();
      });
      f.iframe.contentWindow.postMessage({ type: "dtuwrite-embed-collect", protocol: PROTOCOL, reqId }, "*");
    });
  }

  async function collectAll() {
    await Promise.all([...frames.values()].map(collect));
  }

  // ---- placing the boards on the stage ----------------------------------------------------------
  function scheduleSync() {
    if (syncQueued) return;
    syncQueued = true;
    requestAnimationFrame(() => {
      syncQueued = false;
      sync();
    });
  }

  function sync() {
    if (!state?.deck || !dom?.stage) return;
    const used = new Set();
    for (const el of dom.stage.querySelectorAll(":scope > .overlay[data-overlay-id]")) {
      const overlay = findOverlay(el.dataset.overlayId);
      if (!isDtuwriteOverlay(overlay)) continue;
      const key = ensureKey(overlay);
      decorate(el);
      if (used.has(key)) {
        el.dataset.dtuwrite = "duplicate"; // the same board twice on one slide: only the first is live
        continue;
      }
      used.add(key);
      if (server === "down") {
        showFallback(el, key);
        continue;
      }
      const f = frames.get(key) || createFrame(key);
      f.el = el;
      f.lastUsed = Date.now();
      el.dataset.dtuwrite = f.ready ? "live" : "starting";
      if (server === "unknown" && !probing) {
        probing = true;
        probe().then((up) => {
          probing = false;
          if (!up) setServer("down");
        });
      }
    }
    for (const f of frames.values()) if (!used.has(f.key)) f.el = null;
    prune();
    evict();
  }

  function decorate(el) {
    if (el.classList.contains("dtuwrite-overlay")) return;
    el.classList.add("dtuwrite-overlay");
    const ph = document.createElement("div");
    ph.className = "dtuwrite-placeholder";
    ph.innerHTML = '<div class="dtuwrite-msg">Starting DTUwrite…</div>';
    el.prepend(ph);
    if (state.mode === "edit") {
      const grip = document.createElement("div");
      grip.className = "dtuwrite-grip";
      grip.textContent = "DTUwrite board · drag here to move, click to select";
      el.appendChild(grip);
    }
  }

  // DTUwrite is not running on this PC: the saved page pictures, read-only.
  function showFallback(el, key) {
    el.dataset.dtuwrite = "fallback";
    const ph = el.querySelector(".dtuwrite-placeholder");
    if (!ph) return;
    const rec = boards()[key];
    const shots = Array.isArray(rec?.snapshots) ? rec.snapshots : [];
    let page = Math.min(Math.max(0, Number(rec?.cur) || 0), Math.max(0, shots.length - 1));
    const draw = () => {
      ph.innerHTML = "";
      if (shots.length) {
        const img = document.createElement("img");
        img.className = "dtuwrite-shot";
        img.src = shots[page];
        img.alt = `DTUwrite page ${page + 1}`;
        img.draggable = false;
        ph.appendChild(img);
      }
      const bar = document.createElement("div");
      bar.className = "dtuwrite-note";
      bar.textContent = shots.length
        ? "DTUwrite is not running on this PC: this is the saved picture. Start DTUwrite to write on this board."
        : "DTUwrite is not running on this PC. Start DTUwrite (desktop icon) to write on this board.";
      if (shots.length > 1) {
        const nav = document.createElement("span");
        nav.className = "dtuwrite-nav";
        const prev = document.createElement("button");
        prev.type = "button";
        prev.textContent = "◀";
        prev.disabled = page === 0;
        prev.addEventListener("click", (ev) => { ev.stopPropagation(); page--; draw(); });
        const label = document.createElement("span");
        label.textContent = ` ${page + 1} / ${shots.length} `;
        const next = document.createElement("button");
        next.type = "button";
        next.textContent = "▶";
        next.disabled = page >= shots.length - 1;
        next.addEventListener("click", (ev) => { ev.stopPropagation(); page++; draw(); });
        nav.append(prev, label, next);
        bar.appendChild(nav);
      }
      ph.appendChild(bar);
    };
    draw();
  }

  // Boards whose overlay is gone from the deck (deleted, or another deck was opened) stop.
  function prune() {
    const keys = referencedKeys(state.deck);
    for (const key of [...frames.keys()]) if (!keys.has(key)) destroyFrame(key);
  }

  // At most MAX_LIVE boards run; the longest unused ones hand over their board, then stop.
  let evicting = false;
  async function evict() {
    if (evicting || frames.size <= MAX_LIVE) return;
    evicting = true;
    try {
      const idle = [...frames.values()].filter((f) => !f.el).sort((a, b) => a.lastUsed - b.lastUsed);
      while (frames.size > MAX_LIVE && idle.length) {
        const f = idle.shift();
        await collect(f);
        if (!f.el) destroyFrame(f.key);
      }
    } finally {
      evicting = false;
    }
  }

  // Every frame follows its overlay element: position, size, z-order, animation visibility.
  function setStyle(node, prop, value) {
    if (node.style[prop] !== value) node.style[prop] = value;
  }
  function follow() {
    for (const f of frames.values()) {
      const fr = f.iframe;
      const el = f.el;
      if (!el || !el.isConnected) {
        setStyle(fr, "display", "none");
        continue;
      }
      setStyle(fr, "display", "");
      setStyle(fr, "left", el.style.left);
      setStyle(fr, "top", el.style.top);
      setStyle(fr, "width", el.style.width);
      setStyle(fr, "height", el.style.height);
      setStyle(fr, "zIndex", el.style.zIndex || "1");
      const hiddenByStep = el.style.opacity === "0";
      setStyle(fr, "opacity", el.style.opacity || "1");
      setStyle(fr, "visibility", f.ready && !hiddenByStep ? "visible" : "hidden");
      const passThrough = hiddenByStep || (state.mode === "present" && state.presenterTextInsertArmed);
      setStyle(fr, "pointerEvents", passThrough ? "none" : "auto");
      if (f.ready && el.dataset.dtuwrite !== "live") el.dataset.dtuwrite = "live";
    }
    requestAnimationFrame(follow);
  }

  // ---- saving and opening .ipe files (called from appX.js) ----------------------------------------
  // Into the zip: each board as its own compact JSON file and its page pictures as images; deck.json
  // keeps only the file names. Boards no overlay uses any more are left out.
  function packIntoZip(packaged, zip) {
    const recs = packaged.dtuwriteBoards;
    if (!recs || typeof recs !== "object") return;
    const keys = referencedKeys(packaged);
    for (const [key, rec] of Object.entries(recs)) {
      if (!rec || !keys.has(key)) {
        delete recs[key];
        continue;
      }
      const safe = String(key).replace(/[^A-Za-z0-9_-]/g, "_");
      const out = { v: rec.v || PROTOCOL, updatedAt: rec.updatedAt || "", cur: Number(rec.cur) || 0, snapshots: [] };
      if (rec.board) {
        out.file = `dtuwrite/${safe}.json`;
        zip.file(out.file, JSON.stringify(rec.board));
      } else if (rec.file) {
        out.file = rec.file; // never opened in this session and not readable: keep the reference
      }
      (rec.snapshots || []).forEach((url, i) => {
        const parsed = parseBase64DataUrl(url);
        if (!parsed) return;
        const ext = /webp/i.test(parsed.mime) ? "webp" : /jpe?g/i.test(parsed.mime) ? "jpg" : "png";
        const path = `dtuwrite/${safe}-${String(i + 1).padStart(2, "0")}.${ext}`;
        zip.file(path, parsed.b64, { base64: true });
        out.snapshots.push(path);
      });
      recs[key] = out;
    }
  }

  // Out of the zip, back into the deck in memory (boards as objects, pictures as data).
  async function unpackFromZip(deck, zip) {
    for (const key of [...frames.keys()]) destroyFrame(key); // another deck: its boards start fresh
    const recs = deck?.dtuwriteBoards;
    if (!recs || typeof recs !== "object") return;
    for (const [key, rec] of Object.entries(recs)) {
      if (!rec || typeof rec !== "object") {
        delete recs[key];
        continue;
      }
      const out = { v: rec.v || PROTOCOL, updatedAt: rec.updatedAt || "", cur: Number(rec.cur) || 0, board: rec.board || null, snapshots: [] };
      if (!out.board && rec.file) {
        const entry = zip.file(rec.file);
        try {
          if (!entry) throw new Error("missing from the file");
          out.board = JSON.parse(await entry.async("string"));
        } catch (err) {
          console.warn(`DTUwrite board ${rec.file} could not be read:`, err);
          out.file = rec.file;
        }
      }
      for (const p of rec.snapshots || []) {
        if (/^data:/i.test(p)) {
          out.snapshots.push(p);
          continue;
        }
        const entry = zip.file(p);
        if (!entry) continue;
        const ext = String(p).split(".").pop().toLowerCase();
        const mime = ext === "webp" ? "image/webp" : ext === "jpg" ? "image/jpeg" : "image/png";
        out.snapshots.push(`data:${mime};base64,${await entry.async("base64")}`);
      }
      recs[key] = out;
    }
  }

  // ---- "+ DTUwrite": a new white slide with a board filling it -----------------------------------
  function addDtuwritePage() {
    if (!state.deckSessionReady) {
      dom.modeHint.textContent = "Create a New deck or open one before adding a DTUwrite page.";
      return;
    }
    const before = new Set(state.deck.slides);
    addBlankSlideAfterIndex(state.currentSlideIndex);
    const slide = state.deck.slides.find((s) => !before.has(s));
    if (!slide) return;
    const n = state.deck.slides.filter((s) => /^DTUwrite \d+$/.test(String(s?.name || ""))).length + 1;
    slide.name = `DTUwrite ${n}`;
    const overlay = createOverlay({ x: 0, y: 0, w: 1, h: 1 });
    overlay.sourceId = ensureSource();
    overlay.dtuwriteKey = uid();
    slide.overlays = slide.overlays || [];
    slide.overlays.push(overlay);
    state.currentSlideIndex = state.deck.slides.indexOf(slide);
    state.selectedOverlayId = null;
    touch();
    renderAll();
    dom.modeHint.textContent = "DTUwrite page added. What you write on it is saved inside the deck.";
  }

  // ---- start -------------------------------------------------------------------------------------
  new MutationObserver(scheduleSync).observe(dom.stage, { childList: true });
  document.getElementById("addDtuwritePageBtn")?.addEventListener("click", addDtuwritePage);
  requestAnimationFrame(follow);
  scheduleSync();

  window.DtuwriteBoards = Object.freeze({
    collectAll, packIntoZip, unpackFromZip, addDtuwritePage,
    // for tests
    _frames: frames, _server: () => server,
  });
})();
