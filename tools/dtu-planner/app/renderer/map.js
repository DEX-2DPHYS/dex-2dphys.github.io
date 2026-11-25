/* One Todo Tree — mind-map views: 'map' (from centre, balanced left/right) and 'tree' (from left). */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd;
  const wrap = $('#mapwrap'), svg = $('#map'), vpG = $('#vp'), gE = $('#edges'), gL = $('#links'), gN = $('#nodes');
  const ctx2d = document.createElement('canvas').getContext('2d');
  const FONT = '"Segoe UI Variable Text","Segoe UI",system-ui,sans-serif';
  const MAXT = 290;
  const NS = 'http://www.w3.org/2000/svg';
  const vps = { map: { x: 0, y: 0, k: 1, fitted: false }, tree: { x: 0, y: 0, k: 1, fitted: false } };
  let pos = new Map();
  const els = new Map();       // id -> {g, sig}
  const edgeEls = new Map();   // child id -> path
  const relEls = new Map();    // 'a|b' -> path
  let wantFit = false;
  let lastShape = '';
  let lastMode = null;
  const twCache = new Map();

  function tw(text, size, weight) {
    const key = size + '|' + weight + '|' + text;
    let v = twCache.get(key);
    if (v == null) { ctx2d.font = weight + ' ' + size + 'px ' + FONT; v = ctx2d.measureText(text).width; if (twCache.size > 20000) twCache.clear(); twCache.set(key, v); }
    return v;
  }
  function clip(text, size, weight, max) {
    if (tw(text, size, weight) <= max) return text;
    let lo = 0, hi = text.length;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tw(text.slice(0, mid) + '…', size, weight) <= max) lo = mid; else hi = mid - 1; }
    return text.slice(0, lo).trimEnd() + '…';
  }
  const vp = () => vps[S.view === 'tree' ? 'tree' : 'map'];
  const mode = () => (S.view === 'tree' ? 'tree' : 'map');

  // ---------- geometry ----------
  function geom(id) {
    const n = S.ed.nodes[id], d = OTT.d(id);
    const isFocusRoot = id === S.focus;
    let kind = n.kind || 'task';
    if (isFocusRoot && kind !== 'root' && kind !== 'category') kind = 'froot';
    const G = { kind };
    if (kind === 'root') Object.assign(G, { fs: 18, fw: 650, h: 50, padL: 50, padR: 22 });
    else if (kind === 'category') Object.assign(G, { fs: 14.5, fw: 600, h: 38, padL: 40, padR: 18 });
    else if (kind === 'froot') Object.assign(G, { fs: 16, fw: 650, h: 44, padL: 44, padR: 18 });
    else if (kind === 'group') Object.assign(G, { fs: 13, fw: 600, h: 30, padL: d.progress != null ? 32 : 14, padR: 14 });
    else if (kind === 'person') Object.assign(G, { fs: 13, fw: 500, h: 30, padL: 36, padR: 12 });
    else if (kind === 'info') Object.assign(G, { fs: 13, fw: 450, h: 30, padL: 31, padR: 11 });
    else Object.assign(G, { fs: 13, fw: d.crit >= 3 ? 650 : d.crit === 2 ? 560 : 430, h: 30, padL: 31, padR: 11 });
    let title = kind === 'root' ? (S.ed.title || M.getAppName()) : OTT.title(n);
    G.full = title;
    G.title = clip(title, G.fs, G.fw, MAXT);
    G.tw = tw(G.title, G.fs, G.fw);
    // badges
    const b = [];
    if (kind === 'info') {
      const links = OTT.urlsIn(n.notes).length + n.attachments.length;
      if (links) b.push({ t: 'lnk', text: String(links), w: 14 + tw(String(links), 10.5, 600) });
      if (OTT.hasRel(id)) b.push({ t: 'rel', w: 13 });
    }
    if (kind === 'task' || kind === 'person' || kind === 'froot' || kind === 'group') {
      if (n.deadline) {
        const t = OTT.dueLabel(d);
        b.push({ t: 'due', text: t, w: tw(t, 10.5, 600) + 12, cls: d.done ? '' : d.overdue ? 'o' : d.urg >= 3 ? 'u3' : d.urg >= 2 ? 'u2' : '' });
      }
      if (n.timeline && n.timeline.length && d.tl) {
        const t = d.tl.done + '/' + d.tl.n;
        b.push({ t: 'tl', text: t, w: 15 + tw(t, 10.5, 600), cls: (d.tl.late && !d.done ? 'late' : d.tl.next && d.tl.next.days <= M.FINAL_DAYS && !d.done ? 'soon' : '') + (n.tlPin ? ' pinned' : '') });
      }
      if (n.owner && OTT.person(n.owner)) b.push({ t: 'own', text: OTT.initials(OTT.person(n.owner).name), w: 19, name: OTT.person(n.owner).name });
      if (n.stakeholders.length) { const t = (n.owner ? '+' : '') + n.stakeholders.length; b.push({ t: 'stk', text: t, w: 14 + tw(t, 10.5, 600) }); }
      if (n.attachments.length) { const t = n.attachments.length > 1 ? String(n.attachments.length) : ''; b.push({ t: 'att', text: t, w: 13 + (t ? tw(t, 10.5, 600) + 2 : 0) }); }
      if (n.notes && n.notes.trim()) b.push({ t: 'note', w: 13 });
      if (n.budget && (n.budget.alloc || n.budget.spent)) b.push({ t: 'bud', w: 13 });
      if (OTT.hasRel(id)) b.push({ t: 'rel', w: 13 });
    }
    G.badges = b;
    G.bw = b.reduce((s, x) => s + x.w, 0) + Math.max(0, b.length - 1) * 5;
    G.w = Math.ceil(G.padL + G.tw + (b.length ? 10 + G.bw : 0) + G.padR);
    if (kind === 'group') G.w = Math.max(G.w, 70);
    G.hh = G.h;   // height of the title row (the card grows below it when the timeline is pinned open)
    if (n.tlPin && n.timeline && n.timeline.length && kind !== 'root' && kind !== 'category' && role(id) !== 'ctx') {
      const LH = 18, TH = 13;
      let y = G.hh + 1, dateW = 0, rowW = 0;
      G.lines = OTT.tlLines(id).map(l => {
        if (l.t === 'todo') {   // a to-do under its step: small tick box + text, no date
          const title = clip(l.td.text, 11, 450, 240), h = 15;
          const o = Object.assign({}, l, { date: '', title, day: '', y: y + h / 2 });
          y += h;
          rowW = Math.max(rowW, 15 + tw(title, 11, 450));
          return o;
        }
        const nt = l.t === 'step' && l.s.todos ? l.s.todos.length : 0;
        const date = OTT.fmtDate(l.t === 'step' ? l.s.date : l.date);
        const title = l.t === 'step' ? clip(l.s.title || (nt ? l.s.todos.filter(t => t.done).length + '/' + nt + ' to-dos' : '—'), 11.5, 450, 250) : l.t === 'dl' ? 'Deadline' : 'today';
        const day = l.t === 'step' ? (l.s.done ? '' : OTT.stepDays(l.days)) : l.t === 'dl' && !d.done ? OTT.dueLabel(d) : '';
        const h = l.t === 'today' ? TH : LH;
        const o = Object.assign({}, l, { date, title, day, y: y + h / 2, muted: l.t === 'step' && !l.s.title && nt > 0 });
        y += h;
        dateW = Math.max(dateW, tw(date, 10.5, 600));
        rowW = Math.max(rowW, tw(title, 11.5, l.t === 'dl' ? 650 : 450) + (day ? 12 + tw(day, 10, 600) : 0));
        return o;
      });
      G.dateW = Math.ceil(dateW) + 9;
      G.h = y + 7;
      G.w = Math.max(G.w, Math.ceil(31 + G.dateW + rowW + 12));
      G.tlSig = JSON.stringify([n.timeline, n.deadline, M.todayStr(), d.done]);
    }
    return G;
  }

  /** Spotlight roles: 'in' = inside the spotlit branch, 'path' = its ancestors, 'ctx' = everything else. */
  function role(id) {
    if (!S.spot) return 'n';
    if (M.isAncestor(S.ed, S.spot, id)) return 'in';
    if (M.isAncestor(S.ed, id, S.spot)) return 'path';
    return 'ctx';
  }
  function scaleOf(id) {
    const r = role(id);
    if (id === S.focus) return 1;
    return r === 'ctx' ? 0.68 : r === 'path' ? 0.92 : 1;
  }
  function visibleKids(id) {
    const n = S.ed.nodes[id];
    if (S.spot) {
      const r = role(id);
      if (r === 'ctx') return [];                         // context branches fold to a pill
      if (r === 'path' && id !== S.spot) return n.children; // keep siblings of the path visible (small)
      if (id === S.spot) return n.children;
    }
    if (n.collapsed && id !== S.focus) return [];
    return n.children;
  }

  // ---------- layout ----------
  function layout() {
    const P = new Map();
    const G = new Map();
    const sub = new Map();
    const gapOf = (id) => { const k = S.ed.nodes[id].kind; return k === 'root' ? 16 : k === 'category' ? 9 : 6; };
    const hgapOf = (id) => { const k = S.ed.nodes[id].kind; return id === S.focus ? 60 : k === 'category' ? 42 : k === 'group' ? 34 : 30; };
    function measure(id) {
      const g = geom(id); g.s = scaleOf(id); G.set(id, g);
      const kids = visibleKids(id);
      let total = 0;
      for (const c of kids) total += measure(c);
      if (kids.length) total += (kids.length - 1) * gapOf(id) * (S.spot && role(kids[0]) === 'ctx' ? 0.6 : 1);
      const s = Math.max(g.h * g.s, total);
      sub.set(id, s);
      return s;
    }
    function place(id, ax, yTop, dir, depth) {
      const g = G.get(id), s = sub.get(id);
      const w = g.w * g.s, h = g.h * g.s;
      const x = dir > 0 ? ax : ax - w;
      P.set(id, { x, y: yTop + s / 2 - h / 2, w, h, cy: g.hh * g.s / 2, s: g.s, dir, depth, g, ctx: role(id) === 'ctx' });
      const kids = visibleKids(id);
      if (!kids.length) return;
      const gap = gapOf(id) * (S.spot && role(kids[0]) === 'ctx' ? 0.6 : 1);
      let total = (kids.length - 1) * gap;
      for (const c of kids) total += sub.get(c);
      let yy = yTop + (s - total) / 2;
      const cx = dir > 0 ? x + w + hgapOf(id) * g.s : x - hgapOf(id) * g.s;
      for (const c of kids) { place(c, cx, yy, dir, depth + 1); yy += sub.get(c) + gapOf(id); }
    }
    const f = S.focus;
    measure(f);
    if (mode() === 'tree') {
      place(f, 0, -sub.get(f) / 2, 1, 0);
    } else {
      const g = G.get(f);
      const kids = visibleKids(f);
      P.set(f, { x: -g.w / 2, y: -g.h / 2, w: g.w, h: g.h, cy: g.hh / 2, s: 1, dir: 0, depth: 0, g, ctx: false });
      // balance: first half (by height) right, rest left (clockwise)
      const hs = kids.map(c => sub.get(c));
      const totalH = hs.reduce((a, b) => a + b, 0);
      let acc = 0, split = kids.length;
      for (let i = 0; i < kids.length; i++) { if (acc + hs[i] / 2 > totalH / 2 && i > 0) { split = i; break; } acc += hs[i]; }
      if (kids.length > 1 && split === kids.length) split = Math.ceil(kids.length / 2);
      let right = kids.slice(0, split), left = kids.slice(split).reverse();
      // spotlight: the spotlit branch gets the right-hand side to itself, the rest goes left
      const spotKid = S.spot ? kids.find(c => M.isAncestor(S.ed, c, S.spot)) : null;
      if (spotKid) { right = [spotKid]; left = kids.filter(c => c !== spotKid).reverse(); }
      const gap = gapOf(f) + 6;
      const stack = (arr, dir) => {
        let total = arr.reduce((a, c) => a + sub.get(c), 0) + Math.max(0, arr.length - 1) * gap;
        let yy = -total / 2;
        const ax = dir > 0 ? g.w / 2 + hgapOf(f) : -g.w / 2 - hgapOf(f);
        for (const c of arr) { place(c, ax, yy, dir, 1); yy += sub.get(c) + gap; }
      };
      if (manualLayout(f, spotKid)) {
        // Settings › Map layout › Arranged by me: each main category on the side the user dragged it to
        // (right / left of the title, or in a row above / below it); inside each branch the layout stays automatic
        const sides = arrangement(kids, right, left);
        stack(sides.R, 1); stack(sides.L, -1);
        const ids = (c) => { const out = [c]; for (const k of visibleKids(c)) out.push(...ids(k)); return out; };
        const box = (list) => { let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity; for (const id of list) { const p = P.get(id); if (!p) continue; x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x + p.w); y0 = Math.min(y0, p.y); y1 = Math.max(y1, p.y + p.h); } return { x0, x1, y0, y1 }; };
        const stacks = [sides.R, sides.L].filter(a => a.length).map(a => box(a.flatMap(ids)));
        for (const c of sides.R) P.get(c).side = 'R';
        for (const c of sides.L) P.get(c).side = 'L';
        const row = (arr, up) => {
          if (!arr.length) return;
          const blocks = arr.map(c => { place(c, 0, 0, 1, 1); const l = ids(c); return { c, l, b: box(l) }; });
          const GX = 30, VG = 46, BUS = 16;
          const W = blocks.reduce((a, k) => a + k.b.x1 - k.b.x0, 0) + GX * (blocks.length - 1);
          const x0 = -W / 2;
          // one level for the whole row, clear of the left/right stacks wherever the row reaches over or under them
          let edge = up ? -g.h / 2 - VG : g.h / 2 + VG;
          for (const s of stacks) if (x0 + W > s.x0 - 14 && x0 < s.x1 + 14) edge = up ? Math.min(edge, s.y0 - 30) : Math.max(edge, s.y1 + 30);
          let x = x0;
          for (const k of blocks) {
            const bw = k.b.x1 - k.b.x0, bh = k.b.y1 - k.b.y0;
            const dx = x - k.b.x0, dy = (up ? edge - bh : edge) - k.b.y0;
            for (const id of k.l) { const p = P.get(id); p.x += dx; p.y += dy; }
            const pc = P.get(k.c);
            pc.side = up ? 'T' : 'B';
            pc.bus = up ? edge + BUS : edge - BUS;   // the free lane between the row and the rest, used by its edge
            x += bw + GX;
          }
        };
        row(sides.T, true); row(sides.B, false);
      } else { stack(right, 1); stack(left, -1); }
    }
    return P;
  }

  // ---------- main categories arranged by the user (Settings › Map layout) ----------
  const isManual = () => !!(S.settings && S.settings.mapLayout && S.settings.mapLayout.mode === 'manual');
  /** Only on the full map (not tree view, focus or spotlight). */
  function manualLayout(f, spotKid) { return isManual() && f === 'root' && mode() === 'map' && !spotKid; }
  const catKey = (c) => (S.ed.nodes[c] && S.ed.nodes[c].cat) || c;
  /** {R, L, T, B}: the root's children per side in the stored order; categories without a place keep their automatic side. */
  function arrangement(kids, autoR, autoL) {
    const stored = (S.settings.mapLayout && S.settings.mapLayout.sides) || {};
    const sides = { R: [], L: [], T: [], B: [] }, rest = [];
    kids.forEach((c, i) => { const e = stored[catKey(c)]; if (e && sides[e.side]) sides[e.side].push([+e.order || 0, i, c]); else rest.push(c); });
    for (const s of Object.keys(sides)) sides[s] = sides[s].sort((a, b) => a[0] - b[0] || a[1] - b[1]).map(x => x[2]);
    // not placed yet (none at first, or a new category): where the automatic balance puts it, so switching on changes nothing
    for (const c of autoR) if (rest.includes(c)) sides.R.push(c);
    for (const c of autoL) if (rest.includes(c)) sides.L.push(c);
    return sides;
  }

  // ---------- drawing ----------
  function ringSvg(cx, cy, r, frac, leafStage, color, sw) {
    const circ = 2 * Math.PI * r;
    if (leafStage === M.STAGE_MAX || (leafStage == null && frac >= 0.9999)) {
      return `<circle class="ring-done" cx="${cx}" cy="${cy}" r="${r + 0.5}" style="fill:${color}"/><path class="ring-check" d="M${cx - r * 0.45} ${cy + 0.2}l${r * 0.32} ${r * 0.34} ${r * 0.62}-${r * 0.7}"/>`;
    }
    let s = `<circle class="ring-bg" cx="${cx}" cy="${cy}" r="${r}" style="stroke-width:${sw}"/>`;
    if (leafStage != null) {
      // segmented: one segment per stage step
      const segs = M.STAGE_MAX, gapA = 0.22;
      for (let i = 0; i < segs; i++) {
        const a0 = -Math.PI / 2 + (i / segs) * 2 * Math.PI + gapA / 2, a1 = -Math.PI / 2 + ((i + 1) / segs) * 2 * Math.PI - gapA / 2;
        const on = i < leafStage;
        s += `<path class="ring-seg${on ? ' on' : ''}" d="M${(cx + r * Math.cos(a0)).toFixed(2)} ${(cy + r * Math.sin(a0)).toFixed(2)}A${r} ${r} 0 0 1 ${(cx + r * Math.cos(a1)).toFixed(2)} ${(cy + r * Math.sin(a1)).toFixed(2)}" style="stroke-width:${sw}${on ? ';stroke:' + color : ''}"/>`;
      }
    } else if (frac > 0) {
      s += `<circle class="ring-fg" cx="${cx}" cy="${cy}" r="${r}" transform="rotate(-90 ${cx} ${cy})" style="stroke:${color};stroke-width:${sw};stroke-dasharray:${(frac * circ).toFixed(2)} ${circ.toFixed(2)}"/>`;
    }
    return s;
  }

  function badgeSvg(b, x, cy) {
    const I = (name, xx) => `<g class="bi" transform="translate(${xx},${cy - 6.5}) scale(0.54)"><g fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS[name]}</g></g>`;
    switch (b.t) {
      case 'due': return `<g class="due ${b.cls}"><rect x="${x}" y="${cy - 8.5}" width="${b.w}" height="17" rx="8.5"/><text x="${x + b.w / 2}" y="${cy + 0.5}">${E(b.text)}</text></g>`;
      case 'own': return `<g class="own"><circle cx="${x + 9.5}" cy="${cy}" r="9"/><text x="${x + 9.5}" y="${cy + 0.5}">${E(b.text)}</text><title>${E(b.name)}</title></g>`;
      case 'stk': return `<g class="bdg">${I('users', x)}<text x="${x + 14}" y="${cy + 0.5}" class="bt">${E(b.text)}</text></g>`;
      case 'att': return `<g class="bdg act" data-attbadge="1"><rect class="hit" x="${x - 4}" y="${cy - 11}" width="${b.w + 8}" height="22" rx="6"/>${I('clip', x)}${b.text ? `<text x="${x + 14}" y="${cy + 0.5}" class="bt">${b.text}</text>` : ''}</g>`;
      case 'note': return `<g class="bdg act" data-notebadge="1"><rect class="hit" x="${x - 4}" y="${cy - 11}" width="${b.w + 8}" height="22" rx="6"/>${I('note', x)}</g>`;
      case 'tl': return `<g class="bdg act tlb ${b.cls}" data-tlbadge="1"><rect class="hit" x="${x - 4}" y="${cy - 11}" width="${b.w + 8}" height="22" rx="6"/>${I('steps', x)}<text x="${x + 15}" y="${cy + 0.5}" class="bt">${E(b.text)}</text></g>`;
      case 'lnk': return `<g class="bdg act" data-notebadge="1"><rect class="hit" x="${x - 4}" y="${cy - 11}" width="${b.w + 8}" height="22" rx="6"/>${I('link', x)}<text x="${x + 14}" y="${cy + 0.5}" class="bt">${E(b.text)}</text></g>`;
      case 'bud': return `<g class="bdg">${I('coins', x)}</g>`;
      case 'rel': return `<g class="bdg">${I('link', x)}</g>`;
    }
    return '';
  }

  /** The pinned-open timeline drawn inside the card, below the title row. */
  function timelineSvg(id, g, color) {
    const L = g.lines, x0 = 16, xd = 31, xt = 31 + g.dateW, xr = g.w - 10;
    let s = `<line class="tlsep" x1="8" x2="${g.w - 8}" y1="${g.hh}" y2="${g.hh}"/>`;
    if (L.length > 1) s += `<line class="tlrail" x1="${x0}" x2="${x0}" y1="${L[0].y}" y2="${L[L.length - 1].y}"/>`;
    for (const l of L) {
      const y = l.y;
      if (l.t === 'today') {
        s += `<g class="tlr today"><line x1="${Math.min(xr - 4, xt + tw('today', 10, 650) + 6)}" x2="${xr}" y1="${y}" y2="${y}"/><rect x="${x0 - 3.5}" y="${y - 3.5}" width="7" height="7" transform="rotate(45 ${x0} ${y})"/><text x="${xd}" y="${y + 0.5}" class="tld">${E(l.date)}</text><text x="${xt}" y="${y + 0.5}" class="tlt">today</text></g>`;
        continue;
      }
      if (l.t === 'dl') {
        s += `<g class="tlr dl ${l.late ? 'late' : ''}"><g transform="translate(${x0 - 6},${y - 6.5}) scale(0.54)"><g fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round">${ICON_PATHS.flag}</g></g><text x="${xd}" y="${y + 0.5}" class="tld">${E(l.date)}</text><text x="${xt}" y="${y + 0.5}" class="tlt">Deadline</text>${l.day ? `<text x="${xr}" y="${y + 0.5}" class="tlday">${E(l.day)}</text>` : ''}</g>`;
        continue;
      }
      const st = l.s;
      if (l.t === 'todo') {
        const td = l.td, bx = xt + 0.5;
        s += `<g class="tlr todo ${td.done ? 'done' : ''} ${l.late ? 'late' : ''}"><g class="tlchk" data-todochk="${st.id}|${td.id}"><rect class="hit" x="${bx - 4}" y="${y - 8}" width="17" height="16" rx="4"/><rect class="tdbox" x="${bx}" y="${y - 4.5}" width="9" height="9" rx="2" style="${td.done ? 'fill:' + color + ';stroke:' + color : ''}"/>${td.done ? `<path class="tlck" d="M${bx + 2.2} ${y + 0.1}l1.5 1.6 3-3.3"/>` : ''}<title>${td.done ? 'Done — click to reopen' : 'Click when done'}</title></g><text x="${bx + 15}" y="${y + 0.5}" class="tlt tdt">${E(l.title)}</text></g>`;
        continue;
      }
      s += `<g class="tlr ${st.done ? 'done' : ''} ${l.late ? 'late' : ''} ${l.muted ? 'muted' : ''}"><g class="tlchk" data-stepchk="${st.id}"><rect class="hit" x="${x0 - 9}" y="${y - 9}" width="18" height="18" rx="5"/><circle cx="${x0}" cy="${y}" r="5" style="${st.done ? 'fill:' + color + ';stroke:' + color : ''}"/>${st.done ? `<path class="tlck" d="M${x0 - 2.6} ${y + 0.2}l1.8 1.9 3.4-3.8"/>` : ''}<title>${st.done ? 'Done — click to reopen' : 'Click when done'}</title></g><text x="${xd}" y="${y + 0.5}" class="tld">${E(l.date)}</text><text x="${xt}" y="${y + 0.5}" class="tlt">${E(l.title)}</text>${l.day ? `<text x="${xr}" y="${y + 0.5}" class="tlday">${E(l.day)}</text>` : ''}</g>`;
    }
    return s;
  }

  function countDesc(id) { let c = 0; for (const k of S.ed.nodes[id].children) c += 1 + countDesc(k); return c; }

  function nodeSvg(id, p) {
    const n = S.ed.nodes[id], d = OTT.d(id), g = p.g;
    const color = OTT.catColor(d.cat);
    const w = g.w, h = g.h, cy = g.hh / 2;
    const rx = g.kind === 'task' || g.kind === 'person' ? 9 : g.kind === 'info' ? 4 : g.lines ? 14 : h / 2;
    let s = `<rect class="selring" x="-4" y="-4" width="${w + 8}" height="${h + 8}" rx="${rx + 4}"/>`;
    s += `<rect class="card" x="0" y="0" width="${w}" height="${h}" rx="${rx}"/>`;
    if (g.kind === 'root') {
      s += ringSvg(25, cy, 12.5, d.progress || 0, null, '#fff', 3.2);
      s += `<text class="t" x="${g.padL}" y="${cy + 0.5}">${E(g.title)}</text>`;
    } else if (g.kind === 'category' || g.kind === 'froot') {
      if (d.progress != null) s += ringSvg(g.kind === 'category' ? 20 : 22, cy, g.kind === 'category' ? 9.5 : 10.5, d.progress, d.leaf ? n.stage : null, color, 2.8);
      else s += `<circle class="catdot" cx="20" cy="${cy}" r="5" style="fill:${color}"/>`;
      s += `<text class="t" x="${g.padL}" y="${cy + 0.5}">${E(g.title)}</text>`;
    } else if (g.kind === 'group') {
      if (d.progress != null) s += ringSvg(16, cy, 7.5, d.progress, null, color, 2.4);
      s += `<text class="t" x="${g.padL}" y="${cy + 0.5}">${E(g.title)}</text>`;
    } else if (g.kind === 'info') {
      s += `<g class="infoic" data-notebadge="1"><circle cx="16" cy="${cy}" r="8.5"/><text x="16" y="${cy + 0.5}">i</text></g>`;
      s += `<text class="t" x="${g.padL}" y="${cy + 0.5}">${E(g.title)}</text>`;
    } else if (g.kind === 'person') {
      s += `<circle class="avatar" cx="17" cy="${cy}" r="11" style="fill:${color}"/><text class="avt" x="17" y="${cy + 0.5}">${E(OTT.initials(n.title))}</text>`;
      if (d.progress != null && n.children.length) s += `<circle class="pring" cx="17" cy="${cy}" r="13.2" transform="rotate(-90 17 ${cy})" style="stroke:${color};stroke-dasharray:${(d.progress * 2 * Math.PI * 13.2).toFixed(1)} 200"/>`;
      s += `<text class="t" x="${g.padL}" y="${cy + 0.5}">${E(g.title)}</text>`;
    } else {
      s += ringSvg(16, cy, 7.5, d.progress || 0, d.leaf ? n.stage : null, color, 2.4);
      s += `<text class="t" x="${g.padL}" y="${cy + 0.5}">${E(g.title)}</text>`;
    }
    if (g.badges.length) {
      let x = g.padL + g.tw + 10;
      for (const b of g.badges) { s += badgeSvg(b, x, cy); x += b.w + 5; }
    }
    if (g.lines) s += timelineSvg(id, g, color);
    if ((n.collapsed || p.ctx) && n.children.length && id !== S.focus) {
      const cx = p.dir < 0 ? -10 : w + 10;
      const cnt = countDesc(id);
      const t = cnt > 99 ? '99+' : String(cnt);
      const r = Math.max(9, tw(t, 10, 650) / 2 + 5);
      s += `<g class="cbadge" data-collapse="1"><circle cx="${cx + (p.dir < 0 ? -(r - 9) : r - 9)}" cy="${cy}" r="${r}"/><text x="${cx + (p.dir < 0 ? -(r - 9) : r - 9)}" y="${cy + 0.5}">${t}</text></g>`;
    }
    s += `<title>${E(g.full)}${g.kind === 'info' ? ' — information (hover the i to read)' : d.leaf ? ' — ' + M.STAGES[n.stage] + ' (scroll to change)' : d.progress != null ? ' — ' + Math.round(d.progress * 100) + '%' : ''}</title>`;
    return s;
  }

  function classesFor(id, p) {
    const n = S.ed.nodes[id], d = OTT.d(id);
    const c = ['node', 'k-' + p.g.kind];
    if (p.g.kind === 'task' || p.g.kind === 'person' || p.g.kind === 'froot' || (p.g.kind === 'group' && n.deadline)) {
      if (d.crit && p.g.kind !== 'group') c.push('c' + d.crit);
      if (!d.done && d.urg >= 1) c.push('u' + d.urg);   // u1 is only drawn in the frame/fill scheme
      if (d.overdue) c.push('over');
    }
    if (d.done && p.g.kind !== 'root' && p.g.kind !== 'category') c.push('done');
    if (id === S.sel) c.push('sel');
    if (OTT.isMulti(id)) c.push('msel');
    if (S.search && S.hits.includes(id)) c.push('hit');
    if (d.leaf) c.push('leaf');
    if (n.kind === 'person') c.push('k-person');
    if (p.ctx) c.push('ctx');
    if (S.lens && M.isAncestor(S.ed, S.lens, id)) c.push('inlens');
    return c.join(' ');
  }

  function edgePath(pp, cp) {
    if (pp.dir === 0 && (cp.side === 'T' || cp.side === 'B')) {   // a main category above / below the title
      // org-chart style: straight out of the title, along the free lane under/over the row, then into the category,
      // so it never crosses the branches on the left and right
      const up = cp.side === 'T';
      const ex = cp.x + Math.min(cp.w / 2, 26), ey = up ? cp.y + cp.h : cp.y;
      const inset = Math.max(16, pp.w * 0.25);   // keep clear of where the left/right edges leave the title
      const sx = Math.max(pp.x + inset, Math.min(pp.x + pp.w - inset, ex)), sy = up ? pp.y : pp.y + pp.h;
      const by = cp.bus != null ? cp.bus : (sy + ey) / 2, f = (v) => v.toFixed(1);
      const dxs = ex - sx, rr = Math.min(10, Math.abs(dxs) / 2, Math.abs(by - sy) / 2, Math.abs(ey - by) / 2);
      if (Math.abs(dxs) < 1) return `M${f(sx)} ${f(sy)}L${f(ex)} ${f(ey)}`;
      const sg = Math.sign(dxs), vs = up ? -1 : 1;
      return `M${f(sx)} ${f(sy)}L${f(sx)} ${f(by - vs * rr)}Q${f(sx)} ${f(by)} ${f(sx + sg * rr)} ${f(by)}L${f(ex - sg * rr)} ${f(by)}Q${f(ex)} ${f(by)} ${f(ex)} ${f(by + vs * rr)}L${f(ex)} ${f(ey)}`;
    }
    let sx, sy = pp.y + (pp.cy != null ? pp.cy : pp.h / 2), ex, ey = cp.y + (cp.cy != null ? cp.cy : cp.h / 2);
    if (cp.dir > 0) { sx = pp.x + pp.w; ex = cp.x; } else { sx = pp.x; ex = cp.x + cp.w; }
    if (pp.dir === 0) sx = cp.dir > 0 ? pp.x + pp.w - 6 : pp.x + 6;
    const dx = ex - sx;
    return `M${sx.toFixed(1)} ${sy.toFixed(1)}C${(sx + dx * 0.55).toFixed(1)} ${sy.toFixed(1)} ${(ex - dx * 0.45).toFixed(1)} ${ey.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`;
  }

  function visibleAnchor(id) { // nearest ancestor (or self) that is laid out
    let n = S.ed.nodes[id];
    while (n && !pos.has(n.id)) n = S.ed.nodes[n.parent];
    return n ? n.id : null;
  }

  function render() {
    const m = mode();
    const anchorId = S.sel;
    const old = pos.get(anchorId);
    const modeChanged = lastMode !== m;
    lastMode = m;
    pos = layout();
    const v = vp();
    // keep the selected node still on screen when the layout shifts
    const nw = pos.get(anchorId);
    let animate = !modeChanged && els.size > 0;
    if (old && nw && !modeChanged && !wantFit) {
      const dx = (nw.x - old.x) * v.k, dy = (nw.y - old.y) * v.k;
      if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) { v.x -= dx; v.y -= dy; }
    }
    svg.classList.toggle('anim', animate);
    svg.classList.toggle('searching', !!S.search && S.hits.length > 0);
    wrap.classList.toggle('tree-mode', m === 'tree');

    // nodes
    const seen = new Set();
    for (const [id, p] of pos) {
      seen.add(id);
      let e = els.get(id);
      const cls = classesFor(id, p);
      const color = OTT.catColor(OTT.d(id).cat);
      const sig = JSON.stringify([p.g.w, p.g.h, p.g.title, p.g.tlSig || '', p.g.badges.map(b => b.t + b.text + b.cls), OTT.d(id).progress, S.ed.nodes[id].stage, S.ed.nodes[id].collapsed, p.dir, p.g.kind, color, S.focus === id, p.ctx]);
      if (!e) {
        const g = document.createElementNS(NS, 'g');
        g.dataset.id = id;
        g.style.transform = `translate(${p.x}px,${p.y}px)`;
        // new nodes grow out of their parent
        const par = S.ed.nodes[id].parent && pos.get(S.ed.nodes[id].parent);
        if (animate && par) { g.style.transform = `translate(${par.x + (p.dir < 0 ? 0 : par.w - p.g.w)}px,${par.y + par.h / 2 - p.g.h / 2}px)`; g.style.opacity = '0'; }
        gN.appendChild(g);
        e = { g, sig: null };
        els.set(id, e);
      }
      if (e.sig !== sig) { e.g.innerHTML = nodeSvg(id, p); e.sig = sig; }
      e.g.setAttribute('class', cls);
      e.g.style.setProperty('--c', color);
      const tf = `translate(${p.x}px,${p.y}px)` + (p.s !== 1 ? ` scale(${p.s})` : '');
      if (e.g.style.transform !== tf || e.g.style.opacity === '0') {
        if (e.g.style.opacity === '0') { e.g.getBoundingClientRect(); e.g.style.opacity = ''; }
        e.g.style.transform = tf;
      }
    }
    for (const [id, e] of els) if (!seen.has(id)) { e.g.remove(); els.delete(id); }

    // edges
    const seenE = new Set();
    for (const [id, p] of pos) {
      if (id === S.focus) continue;
      const par = pos.get(S.ed.nodes[id].parent);
      if (!par) continue;
      seenE.add(id);
      let el = edgeEls.get(id);
      if (!el) { el = document.createElementNS(NS, 'path'); el.setAttribute('class', 'edge'); gE.appendChild(el); edgeEls.set(id, el); }
      const dpath = edgePath(par, p);
      if (el._d !== dpath) { el.style.d = `path("${dpath}")`; el._d = dpath; }
      const pk = S.ed.nodes[S.ed.nodes[id].parent].kind;
      el.style.stroke = OTT.catColor(OTT.d(id).cat);
      el.style.strokeWidth = par.dir === 0 ? 3.4 : pk === 'category' ? 2.3 : 1.6;
      el.classList.toggle('done', !!OTT.d(id).done);
      el.classList.toggle('ctx', !!p.ctx);
      if (p.s !== 1) el.style.strokeWidth = parseFloat(el.style.strokeWidth) * p.s;
    }
    for (const [id, el] of edgeEls) if (!seenE.has(id)) { el.remove(); edgeEls.delete(id); }

    // relation links
    const seenL = new Set();
    if (S.showLinks) {
      for (const n of Object.values(S.ed.nodes)) {
        for (const r of n.relates || []) {
          if (!S.ed.nodes[r]) continue;
          const a = visibleAnchor(n.id), b = visibleAnchor(r);
          if (!a || !b || a === b) continue;
          const key = n.id + '|' + r;
          seenL.add(key);
          const pa = pos.get(a), pb = pos.get(b);
          const ax = pa.x + pa.w / 2, ay = pa.y + pa.h / 2, bx = pb.x + pb.w / 2, by = pb.y + pb.h / 2;
          const mx = (ax + bx) / 2, my = (ay + by) / 2, dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1;
          const off = Math.min(120, L * 0.25);
          const qx = mx - dy / L * off, qy = my + dx / L * off;
          let el = relEls.get(key);
          if (!el) { el = document.createElementNS(NS, 'path'); el.setAttribute('class', 'rel'); gL.appendChild(el); relEls.set(key, el); }
          const dp = `M${ax.toFixed(1)} ${ay.toFixed(1)}Q${qx.toFixed(1)} ${qy.toFixed(1)} ${bx.toFixed(1)} ${by.toFixed(1)}`;
          if (el._d !== dp) { el.style.d = `path("${dp}")`; el._d = dp; }
          el.classList.toggle('hot', S.sel === n.id || S.sel === r);
        }
      }
    }
    for (const [k, el] of relEls) if (!seenL.has(k)) { el.remove(); relEls.delete(k); }

    // Auto-fit: whenever the map's outline changes (fold, add, move, levels…), fit it to the window again
    const bb = pos.size ? bbox() : null;
    const shape = bb ? [m, Math.round(bb.x0), Math.round(bb.y0), Math.round(bb.x1), Math.round(bb.y1), pos.size].join('|') : '';
    if (S.ui.autoFit && shape !== lastShape && v.fitted) wantFit = true;
    lastShape = shape;
    if (wantFit || !v.fitted) { if (fit()) { wantFit = false; v.fitted = true; } }
    applyVp(animate);
    renderCrumbs();
    renderZoom();
  }

  // ---------- viewport ----------
  function applyVp(anim) {
    const v = vp();
    vpG.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.k})`;
    wrap.style.backgroundPosition = `${v.x}px ${v.y}px`;
    wrap.style.backgroundSize = `${26 * v.k}px ${26 * v.k}px`;
    const z = $('#zoomval'); if (z) z.textContent = Math.round(v.k * 100) + '%';
  }
  function bbox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pos.values()) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x + p.w); y1 = Math.max(y1, p.y + p.h); }
    return { x0, y0, x1, y1 };
  }
  function fit() {
    const r = wrap.getBoundingClientRect();
    if (!r.width || !pos.size) return false;
    const b = bbox();
    const v = vp();
    const k = Math.max(0.2, Math.min(1.15, Math.min((r.width - 80) / (b.x1 - b.x0), (r.height - 80) / (b.y1 - b.y0))));
    v.k = k;
    v.x = r.width / 2 - ((b.x0 + b.x1) / 2) * k;
    v.y = r.height / 2 - ((b.y0 + b.y1) / 2) * k;
    return true;
  }
  function zoomAt(f, cx, cy) {
    const v = vp();
    const k = Math.max(0.12, Math.min(3, v.k * f));
    v.x = cx - (cx - v.x) * (k / v.k);
    v.y = cy - (cy - v.y) * (k / v.k);
    v.k = k;
    svg.classList.remove('anim');
    applyVp();
  }

  function scrollTo(id) {
    const p = pos.get(id);
    if (!p) return;
    const r = wrap.getBoundingClientRect(), v = vp();
    const sx = p.x * v.k + v.x, sy = p.y * v.k + v.y, sw = p.w * v.k, sh = p.h * v.k;
    const m = 60;
    let dx = 0, dy = 0;
    if (sx < m) dx = m - sx; else if (sx + sw > r.width - m) dx = r.width - m - sx - sw;
    if (sy < m) dy = m - sy; else if (sy + sh > r.height - m) dy = r.height - m - sy - sh;
    if (dx || dy) {
      v.x += dx; v.y += dy;
      vpG.classList.add('glide');
      applyVp();
      setTimeout(() => vpG.classList.remove('glide'), 260);
    }
  }

  function renderCrumbs() {
    const el = $('#crumbs');
    let h = '';
    if (S.focus !== 'root') {
      const parts = [];
      let n = S.ed.nodes[S.focus];
      while (n) { parts.unshift(n); n = S.ed.nodes[n.parent]; }
      h += parts.map((p, i) => `<button data-id="${p.id}" class="${i === parts.length - 1 ? 'cur' : ''}">${E(p.kind === 'root' ? 'All' : OTT.title(p))}</button>`).join('<span>›</span>') + `<button class="x" title="Leave focus (Esc)">${ICON('x')}</button>`;
    }
    if (S.spot) h += (h ? '<span class="tsep"></span>' : '') + `<button class="spot" data-spot="1" title="Spotlight — the rest of the tree is shown small">${ICON('focus')} ${E(OTT.title(S.ed.nodes[S.spot]))}</button><button class="x" data-spotx="1" title="End spotlight (Esc)">${ICON('x')}</button>`;
    el.hidden = !h;
    el.innerHTML = h;
  }
  for (const sel of ['#crumbs', '#zoomctl']) $(sel).addEventListener('pointerdown', (e) => e.stopPropagation());
  $('#crumbs').addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.spotx) return C.spotlight(null);
    if (b.dataset.spot) return C.select(S.spot);
    if (b.classList.contains('x')) return C.unfocus();
    if (b.dataset.id === 'root') return C.unfocus();
    C.focusOn(b.dataset.id);
  });

  function renderZoom() {
    let lv = $('#levels');
    if (!lv) {
      lv = document.createElement('div');
      lv.id = 'levels';
      lv.innerHTML = `<span>Show</span><button data-lv="1" title="Categories only (Alt+1)">1</button><button data-lv="2" title="Two levels (Alt+2)">2</button><button data-lv="3" title="Three levels (Alt+3)">3</button><button data-lv="all" title="Everything (Alt+4)">All</button>`;
      wrap.appendChild(lv);
      lv.addEventListener('click', (e) => { const b = e.target.closest('[data-lv]'); if (b) C.showLevels(b.dataset.lv === 'all' ? Infinity : +b.dataset.lv); });
      lv.addEventListener('pointerdown', (e) => e.stopPropagation());
    }
    const el = $('#zoomctl');
    if (el.dataset.ready) return;
    el.dataset.ready = 1;
    el.innerHTML = `<button data-z="out" title="Zoom out">−</button><span id="zoomval">100%</span><button data-z="in" title="Zoom in">+</button><button data-z="fit" title="Fit to window">${ICON('fit')}</button><button data-z="auto" class="autofit" title="Auto fit: fit to window after every fold, add, move or reorganisation">Auto</button>`;
    el.querySelector('.autofit').classList.toggle('on', !!S.ui.autoFit);
    el.addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b) return;
      const r = wrap.getBoundingClientRect();
      if (b.dataset.z === 'auto') {
        S.ui.autoFit = !S.ui.autoFit; OTT.saveUiSoon();
        b.classList.toggle('on', !!S.ui.autoFit);
        OTT.toast(S.ui.autoFit ? 'Auto fit on — the map refits after every change in shape' : 'Auto fit off');
        if (S.ui.autoFit) { fit(); svg.classList.remove('anim'); vpG.classList.add('glide'); applyVp(); setTimeout(() => vpG.classList.remove('glide'), 260); }
        return;
      }
      if (b.dataset.z === 'fit') { fit(); svg.classList.remove('anim'); vpG.classList.add('glide'); applyVp(); setTimeout(() => vpG.classList.remove('glide'), 260); }
      else zoomAt(b.dataset.z === 'in' ? 1.2 : 1 / 1.2, r.width / 2, r.height / 2);
    });
  }

  // ---------- wheel: progress on leaves, zoom elsewhere ----------
  let wheelAcc = 0, wheelT = 0, tipT = 0;
  wrap.addEventListener('wheel', (e) => {
    e.preventDefault();
    const g = e.target.closest && e.target.closest('.node');
    if (g && !e.ctrlKey && OTT.d(g.dataset.id).leaf) {
      const id = g.dataset.id;
      if (Date.now() - wheelT > 300) wheelAcc = 0;
      wheelT = Date.now();
      wheelAcc += e.deltaY;
      if (Math.abs(wheelAcc) >= 50) {
        const step = wheelAcc < 0 ? 1 : -1;
        wheelAcc = 0;
        const n = S.ed.nodes[id];
        C.setStage(id, n.stage + step);
        showWheelTip(e.clientX, e.clientY, n.stage, OTT.catColor(OTT.d(id).cat));
      }
      return;
    }
    const r = wrap.getBoundingClientRect();
    const f = Math.exp(-e.deltaY * (e.ctrlKey ? 0.004 : 0.0016));
    zoomAt(f, e.clientX - r.left, e.clientY - r.top);
  }, { passive: false });

  function showWheelTip(x, y, stage, color) {
    const t = $('#wheeltip');
    const dots = M.STAGES.map((_, i) => `<i class="${i <= stage && i > 0 ? 'on' : ''}" style="${i <= stage && i > 0 ? 'background:' + color : ''}"></i>`).slice(1).join('');
    t.innerHTML = `<b>${E(M.STAGES[stage])}</b><span>${dots}</span>`;
    const r = $('#stage').getBoundingClientRect();
    t.style.left = (x - r.left + 14) + 'px'; t.style.top = (y - r.top - 34) + 'px';
    t.hidden = false;
    clearTimeout(tipT); tipT = setTimeout(() => { t.hidden = true; }, 900);
  }
  OTT.showWheelTip = showWheelTip;

  // ---------- pointer: select, pan, drag ----------
  let drag = null;
  let lastDown = {}, suppressDbl = 0;
  wrap.addEventListener('pointerdown', (e) => {
    if (e.button === 2) return;
    const g = e.target.closest('.node');
    wrap.focus({ preventScroll: true });
    if (g && e.button === 0) {
      const id = g.dataset.id;
      if (e.target.closest('[data-collapse]')) { C.toggleCollapse(id); return; }
      const chk = e.target.closest('[data-stepchk]');
      if (chk) { e.preventDefault(); C.select(id, { scroll: false }); C.toggleStep(id, chk.dataset.stepchk); return; }
      const tdc = e.target.closest('[data-todochk]');
      if (tdc) { e.preventDefault(); C.select(id, { scroll: false }); const [sid, tid] = tdc.dataset.todochk.split('|'); C.toggleTodo(id, sid, tid); return; }
      // Shift/Ctrl+click: add to / take out of the multiple selection
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && !S.pickTo && !S.linkFrom) { e.preventDefault(); lastDown = {}; C.toggleMulti(id); return; }
      // our own double-click detection (pointer capture and re-renders confuse the browser's dblclick)
      const now = Date.now();
      if (lastDown.id === id && now - lastDown.t < 450 && Math.hypot(e.clientX - lastDown.x, e.clientY - lastDown.y) < 8) {
        lastDown = {}; suppressDbl = now;
        e.preventDefault();
        // no subtasks: double-click renames (open the editor after this click has finished, so it keeps focus)
        if (!C.toggleAll(id)) setTimeout(() => OTT.startEdit(id), 80);
        return;
      }
      lastDown = { id, t: now, x: e.clientX, y: e.clientY };
      // pressing on an item of the multiple selection keeps the selection (to drag all of them);
      // a plain click without dragging then selects just this one (on release)
      const inMulti = OTT.isMulti(id);
      if (inMulti) { S.sel = id; OTT.render(); } else C.select(id, { scroll: false });
      drag = { kind: 'node', id, sx: e.clientX, sy: e.clientY, moved: false, multi: inMulti };
    } else {
      const v = vp();
      drag = { kind: 'pan', sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
      wrap.classList.add('panning');
      svg.classList.remove('anim');
    }
    wrap.setPointerCapture(e.pointerId);
  });
  // ---------- dragging a main category to another place (only with Settings › Map layout › Arranged by me) ----------
  let hintedCat = false;
  const SIDE_NAME = { R: 'right of the title', L: 'left of the title', T: 'above the title', B: 'below the title' };
  function catDragOk(id) { return isManual() && S.focus === 'root' && mode() === 'map' && !S.spot && S.ed.nodes[id] && S.ed.nodes[id].parent === 'root' && pos.get(id) && pos.get(id).side; }
  /** The main categories per side as they are drawn now (top→bottom, left→right). */
  function sidesNow() {
    const out = { R: [], L: [], T: [], B: [] };
    for (const c of S.ed.nodes.root.children) { const p = pos.get(c); if (p && out[p.side]) out[p.side].push(c); }
    for (const s of ['R', 'L']) out[s].sort((a, b) => pos.get(a).y - pos.get(b).y);
    for (const s of ['T', 'B']) out[s].sort((a, b) => pos.get(a).x - pos.get(b).x);
    return out;
  }
  /** Which side and place the pointer points at: the side follows the direction from the title, the place the pointer's position among that side's categories. */
  function catTargetAt(cx, cy, id) {
    const r = wrap.getBoundingClientRect(), v = vp(), rp = pos.get('root');
    const mx = (cx - r.left - v.x) / v.k, my = (cy - r.top - v.y) / v.k;
    const nx = mx / (rp.w / 2 + 160), ny = my / (rp.h / 2 + 70);
    const side = Math.abs(ny) > Math.abs(nx) ? (ny < 0 ? 'T' : 'B') : (nx > 0 ? 'R' : 'L');
    const row = side === 'T' || side === 'B';
    const list = sidesNow()[side].filter(c => c !== id);
    let idx = list.length;
    for (let i = 0; i < list.length; i++) { const p = pos.get(list[i]); if ((row ? mx : my) < (row ? p.x + p.w / 2 : p.y + p.h / 2)) { idx = i; break; } }
    return { side, idx, n: list.length };
  }
  function catDragMove(e) {
    if (!drag.moved) { drag.moved = true; drag.ids = [drag.id]; $('#dropghost').hidden = false; wrap.classList.add('dragging'); els.get(drag.id) && els.get(drag.id).g.classList.add('dragsrc'); }
    const t = drag.catTarget = catTargetAt(e.clientX, e.clientY, drag.id);
    const sr = $('#stage').getBoundingClientRect(), gh = $('#dropghost');
    gh.textContent = OTT.title(S.ed.nodes[drag.id]) + ' → ' + SIDE_NAME[t.side] + (t.n ? ', ' + (t.idx === 0 ? (t.side === 'T' || t.side === 'B' ? 'leftmost' : 'at the top') : t.idx === t.n ? (t.side === 'T' || t.side === 'B' ? 'rightmost' : 'at the bottom') : 'place ' + (t.idx + 1)) : '');
    gh.style.left = (e.clientX - sr.left + 12) + 'px'; gh.style.top = (e.clientY - sr.top + 8) + 'px';
  }
  /** Store the new arrangement of all main categories in the settings (shared by every edition and PC). */
  async function placeCategory(id, t) {
    const cur = sidesNow();
    for (const s of Object.keys(cur)) cur[s] = cur[s].filter(c => c !== id);
    cur[t.side].splice(Math.min(t.idx, cur[t.side].length), 0, id);
    const st = JSON.parse(JSON.stringify(S.settings));
    const sides = Object.assign({}, (st.mapLayout && st.mapLayout.sides) || {});
    for (const s of Object.keys(cur)) cur[s].forEach((c, i) => { sides[catKey(c)] = { side: s, order: i }; });
    st.mapLayout = { mode: 'manual', sides };
    S.settings = st;
    OTT.render();
    const r = await ott.saveSettings(st);
    if (r && r.error) OTT.toast('Could not save the arrangement: ' + r.error, 'error');
  }
  OTT.placeCategory = placeCategory;

  wrap.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (drag.kind === 'pan') {
      const v = vp();
      v.x = drag.vx + e.clientX - drag.sx; v.y = drag.vy + e.clientY - drag.sy;
      applyVp();
      return;
    }
    if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
    if (catDragOk(drag.id)) return catDragMove(e);
    if (!C.canRemove(drag.id)) {
      if (!hintedCat && S.ed.nodes[drag.id].parent === 'root' && !isManual() && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 40) { hintedCat = true; OTT.toast('To place the main categories yourself (also above or below the title): Settings › Map layout › Arranged by me', 'info', 6000); }
      return;
    }
    if (!drag.moved) {
      drag.moved = true;
      drag.ids = drag.multi ? OTT.topIds(S.multi) : [drag.id];
      $('#dropghost').hidden = false;
      wrap.classList.add('dragging');
      for (const x of drag.ids) els.get(x) && els.get(x).g.classList.add('dragsrc');
    }
    const r = $('#stage').getBoundingClientRect();
    const gh = $('#dropghost');
    gh.textContent = (e.ctrlKey ? '+ Copy: ' : '') + (drag.ids.length > 1 ? drag.ids.length + ' items' : OTT.title(S.ed.nodes[drag.id]));
    gh.style.left = (e.clientX - r.left + 12) + 'px'; gh.style.top = (e.clientY - r.top + 8) + 'px';
    drag.target = dropTarget(e.clientX, e.clientY, drag.id);
    markDrop(drag.target);
  });
  wrap.addEventListener('pointerup', (e) => {
    if (!drag) return;
    const d = drag; drag = null;
    wrap.classList.remove('panning', 'dragging');
    $('#dropghost').hidden = true;
    markDrop(null);
    for (const x of d.ids || [d.id]) { const src = els.get(x); if (src) src.g.classList.remove('dragsrc'); }
    if (d.kind === 'node' && d.moved && d.catTarget) placeCategory(d.id, d.catTarget);
    else if (d.kind === 'node' && d.moved && d.target) OTT.dropItems(d, e.ctrlKey);
    else if (d.kind === 'node' && !d.moved && d.multi) C.select(d.id, { scroll: false });
  });
  wrap.addEventListener('dblclick', (e) => {
    if (Date.now() - suppressDbl < 600) return;      // node double-clicks are handled in pointerdown
    const g = e.target.closest('.node');
    if (g) return;
    else { fit(); vpG.classList.add('glide'); svg.classList.remove('anim'); applyVp(); setTimeout(() => vpG.classList.remove('glide'), 260); }
  });
  wrap.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    const g = e.target.closest('.node');
    if (g) OTT.contextMenu(e.clientX, e.clientY, g.dataset.id);
  });

  /** Find drop target under the pointer: {id, zone: 'child'|'before'|'after'} or null. Shared with outline. */
  function dropTarget(x, y, dragId) {
    const el = document.elementFromPoint(x, y);
    const g = el && el.closest('.node, .orow');
    if (!g) return null;
    const id = g.dataset.id;
    if (!id || (dragId && M.isAncestor(S.ed, dragId, id))) return null;
    const tn = S.ed.nodes[id];
    const r = g.getBoundingClientRect();
    const fy = (y - r.top) / r.height;
    let zone = 'child';
    if (tn.kind !== 'root' && tn.kind !== 'category') { if (fy < 0.28) zone = 'before'; else if (fy > 0.72) zone = 'after'; }
    if (tn.kind === 'root') return null;
    return { id, zone, el: g };
  }
  OTT.dropTarget = dropTarget;
  function markDrop(t) {
    $$('.drop-child, .drop-before, .drop-after').forEach(x => x.classList.remove('drop-child', 'drop-before', 'drop-after'));
    if (t) t.el.classList.add('drop-' + t.zone);
  }
  OTT.markDrop = markDrop;

  // files / urls dropped from Explorer, Outlook, browser
  wrap.addEventListener('dragover', (e) => {
    e.preventDefault();
    const g = e.target.closest && e.target.closest('.node');
    $$('.node.filedrop').forEach(x => x !== g && x.classList.remove('filedrop'));
    if (g && g.dataset.id !== 'root') { g.classList.add('filedrop'); e.dataTransfer.dropEffect = e.ctrlKey ? 'copy' : 'link'; }
    else e.dataTransfer.dropEffect = 'none';
  });
  wrap.addEventListener('dragleave', (e) => { if (!wrap.contains(e.relatedTarget)) $$('.node.filedrop').forEach(x => x.classList.remove('filedrop')); });
  wrap.addEventListener('drop', (e) => {
    e.preventDefault();
    $$('.node.filedrop').forEach(x => x.classList.remove('filedrop'));
    const g = e.target.closest && e.target.closest('.node');
    if (!g || g.dataset.id === 'root') return OTT.toast('Drop files onto a task to attach them.');
    C.select(g.dataset.id, { scroll: false });
    OTT.handleDrop(g.dataset.id, e);
  });

  // ---------- keyboard navigation (spatial) ----------
  function navigate(key) {
    const cur = pos.get(S.sel);
    if (key === 'Home') { C.select(S.focus); return; }
    if (!cur) { C.select(S.focus); return; }
    const dir = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[key];
    const n = S.ed.nodes[S.sel];
    // toward children of a collapsed node: expand
    const childSide = cur.dir === 0 ? null : cur.dir;
    if (n.collapsed && n.children.length && dir[0] !== 0 && dir[0] === childSide) { C.toggleCollapse(S.sel, false); return; }
    const cx = cur.x + cur.w / 2, cy = cur.y + cur.h / 2;
    let best = null, bestS = Infinity;
    for (const [id, p] of pos) {
      if (id === S.sel) continue;
      const px = p.x + p.w / 2, py = p.y + p.h / 2;
      let along, perp;
      if (dir[0]) {
        // horizontal: compare facing edges so wide nodes are fair
        along = dir[0] > 0 ? p.x - (cur.x + cur.w) : cur.x - (p.x + p.w);
        perp = Math.abs(py - cy);
        if (along < -4) continue;
        const sc = along + perp * 2.2;
        if (sc < bestS) { bestS = sc; best = id; }
      } else {
        along = (py - cy) * dir[1];
        perp = Math.abs(px - cx);
        if (along <= 2) continue;
        // prefer same column (same parent) strongly
        const sib = S.ed.nodes[id].parent === n.parent ? 0 : 40;
        const sc = along + perp * 1.4 + sib;
        if (sc < bestS) { bestS = sc; best = id; }
      }
    }
    if (best) C.select(best);
  }

  function editRect(id) {
    const p = pos.get(id);
    if (!p) return null;
    const v = vp();
    const s = p.s || 1;
    const left = p.x + (p.g.padL - 6) * s;
    return { x: left * v.k + v.x, y: p.y * v.k + v.y, w: (p.g.w - p.g.padL + 6) * s * v.k, h: p.g.hh * s * v.k, fs: Math.max(12, p.g.fs * s * v.k), parent: wrap };
  }

  const view = { render, scrollTo, navigate, editRect, fitSoon: () => { wantFit = true; OTT.render(); }, fit: () => { fit(); applyVp(); } };
  /** For tests and tools: which side of the title a main category is drawn on (R, L, T, B). */
  view.sideOf = (id) => { const p = pos.get(id), r = pos.get(S.focus); return !p ? null : p.side || (r && p.x + p.w / 2 < r.x + r.w / 2 ? "L" : "R"); };
  OTT.views.map = view;
  OTT.views.tree = view;
  let resizeT = null;
  window.addEventListener('resize', () => {
    if (S.view !== 'map' && S.view !== 'tree') return;
    applyVp();
    if (S.ui.autoFit) { clearTimeout(resizeT); resizeT = setTimeout(() => { fit(); vpG.classList.add('glide'); applyVp(); setTimeout(() => vpG.classList.remove('glide'), 260); }, 150); }
  });
  // the side panel / inspector opening or closing changes the map's width too
  new ResizeObserver(() => { if (S.ui && S.ui.autoFit && (S.view === 'map' || S.view === 'tree') && wrap.clientWidth) { clearTimeout(resizeT); resizeT = setTimeout(() => { fit(); vpG.classList.add('glide'); applyVp(); setTimeout(() => vpG.classList.remove('glide'), 260); }, 150); } }).observe(wrap);
})();
