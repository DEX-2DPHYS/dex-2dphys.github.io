// The textbook: a book symbol beside every view preset opens that view's chapter. Figures are
// grabbed from the running simulation (main.js hands us a capture function), so a figure can
// never drift out of step with what the model shows. Built on the salmonella micro-textbooks.
//
// Beyond those: chapters are numbered and linked previous/next, glossary terms in the text
// (content/kit.js gl()) open a definition popup on hover or tap, and every chapter ends on an
// open research question instead of a drug target.
//
// No maths library: equations use the small CSS kit in template.html (.eq / .mi / .frac).
import { TOPICS, ORDER, GLOSSARY, UI } from 'sun-content';

const plain = (s) => String(s).replace(/<[^>]*>/g, '');

const BOOK_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">' +
  '<path d="M4 4.2c2.7-.9 5.3-.9 8 .3v15c-2.7-1.2-5.3-1.2-8-.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '<path d="M20 4.2c-2.7-.9-5.3-.9-8 .3v15c2.7-1.2 5.3-1.2 8-.3z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>' +
  '</svg>';

export function initPortal({ requestFigure, onNavigate }) {
  // ---- book symbol beside every preset ------------------------------------
  document.querySelectorAll('.views [data-view]').forEach((btn) => {
    const id = btn.dataset.view;
    if (!TOPICS[id]) return;
    const row = document.createElement('div');
    row.className = 'vrow';
    btn.parentNode.insertBefore(row, btn);
    row.appendChild(btn);
    const info = document.createElement('button');
    info.type = 'button';
    info.className = 'vinfo';
    info.title = UI.bookTitle(plain(TOPICS[id].title));
    info.setAttribute('aria-label', info.title);
    info.innerHTML = BOOK_SVG;
    info.addEventListener('click', (e) => { e.stopPropagation(); open(id); });
    row.appendChild(info);
  });

  // ---- the reader ---------------------------------------------------------
  const el = document.createElement('div');
  el.id = 'mt';
  el.hidden = true;
  el.innerHTML = `
    <div class="mt-scrim"></div>
    <article class="mt-doc" role="dialog" aria-modal="true" aria-labelledby="mt-title" tabindex="-1">
      <header class="mt-head">
        <div class="mt-crumb"></div>
        <h1 id="mt-title"></h1>
        <p class="mt-lead"></p>
        <button class="mt-x" type="button" aria-label="${UI.close}">&times;</button>
      </header>
      <div class="mt-body">
        <main class="mt-text"></main>
        <aside class="mt-side"></aside>
      </div>
      <footer class="mt-foot">
        <div class="mt-more"></div>
        <div class="mt-rel"></div>
      </footer>
      <div class="gl-pop" hidden></div>
    </article>`;
  document.body.appendChild(el);

  const q = (s) => el.querySelector(s);
  const scrim = q('.mt-scrim'), doc = q('.mt-doc'), pop = q('.gl-pop');
  let current = null;

  // ---- glossary popups ----------------------------------------------------
  let popFor = null;
  function showGloss(term) {
    const g = GLOSSARY[term.dataset.gl];
    if (!g) return;
    popFor = term;
    pop.innerHTML = `<div class="gl-h">${g[0]}</div><p>${g[1]}</p>`;
    pop.hidden = false;
    const dr = doc.getBoundingClientRect(), tr = term.getBoundingClientRect();
    const w = pop.offsetWidth, h = pop.offsetHeight;
    let x = tr.left - dr.left + tr.width / 2 - w / 2;
    x = Math.max(12, Math.min(dr.width - w - 12, x));
    let y = tr.bottom - dr.top + 8;
    if (y + h > dr.height - 10) y = tr.top - dr.top - h - 8;
    pop.style.left = x + 'px'; pop.style.top = y + 'px';
  }
  function hideGloss() { pop.hidden = true; popFor = null; }
  el.addEventListener('mouseover', (e) => { const t = e.target.closest('[data-gl]'); if (t && t !== popFor) showGloss(t); });
  el.addEventListener('mouseout', (e) => { const t = e.target.closest('[data-gl]'); if (t && !t.contains(e.relatedTarget)) hideGloss(); });
  q('.mt-text').addEventListener('scroll', hideGloss);
  q('.mt-side').addEventListener('scroll', hideGloss);

  // ---- annotated figure ---------------------------------------------------
  function exploreHTML(E) {
    return `<section class="mt-explore">
      <h2>${E.title}</h2>
      <p class="mt-ex-hint">${E.hint}</p>
      <div class="anno" data-anno>
        <div class="anno-img"><div class="anno-wait">${UI.rendering}</div></div>
        <svg class="anno-lines" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true"></svg>
      </div>
    </section>`;
  }
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  function fillExplore(wrap, E, pts) {
    const geo = E.pins.map((p, i) => {
      const s = pts[i] || { x: 50, y: 50 };
      const x = clamp(s.x, 2, 98), y = clamp(s.y, 3, 97);
      const side = x < 48 ? 'r' : 'l';
      return { x, y, side, cx: clamp(x + (side === 'r' ? 7 : -7), 6, 94), cy: clamp(y, 16, 84) };
    });
    wrap.dataset.geo = JSON.stringify(geo);
    wrap.insertAdjacentHTML('beforeend',
      E.pins.map((p, i) => `<button class="anno-pin" type="button" data-pin="${i}"
          style="left:${geo[i].x}%;top:${geo[i].y}%" aria-label="${plain(p.name)}">${i + 1}</button>`).join('') +
      E.pins.map((p, i) => `<div class="anno-card anno-${geo[i].side}" data-card="${i}"
            style="left:${geo[i].cx}%;top:${geo[i].cy}%">
          <h4><span class="anno-n">${i + 1}</span>${p.name}</h4>
          <p>${p.text}</p>
        </div>`).join(''));
  }
  function drawLeader(wrap, i) {
    const svg = wrap.querySelector('.anno-lines');
    let geo = [];
    try { geo = JSON.parse(wrap.dataset.geo || '[]'); } catch { geo = []; }
    const g = geo[i];
    svg.innerHTML = g ? `<line x1="${g.x}" y1="${g.y}" x2="${g.cx}" y2="${g.cy}" stroke="currentColor" stroke-width="1.25"
        vector-effect="non-scaling-stroke" stroke-linecap="round" opacity=".9"/>` : '';
  }
  function selectPin(wrap, i) {
    wrap.querySelectorAll('.anno-pin').forEach((b, k) => b.classList.toggle('on', k === i));
    wrap.querySelectorAll('.anno-card').forEach((c, k) => c.classList.toggle('on', k === i));
    wrap.classList.toggle('picked', i >= 0);
    drawLeader(wrap, i);
  }

  function fillShot(host, f) {
    requestFigure(f.view, f.opts || {}, (url) => {
      if (!url || !host.isConnected) return;
      const img = new Image();
      img.alt = plain(f.cap);
      img.onload = () => { host.innerHTML = ''; host.appendChild(img); };
      img.src = url;
    });
  }

  function open(id) {
    const T = TOPICS[id];
    if (!T) return;
    current = id;
    hideGloss();
    const n = ORDER.indexOf(id);
    const chap = n >= 0 ? `${UI.chapter} ${n + 1} &nbsp;›&nbsp; ` : '';
    q('.mt-crumb').innerHTML = `${UI.book} &nbsp;›&nbsp; ${chap}${T.crumb}`;
    q('#mt-title').innerHTML = T.title;
    q('.mt-lead').innerHTML = T.lead;

    const body = T.sections.map((s) => `<section><h2>${s.h}</h2>${s.html}</section>`).join('');
    const question = T.question
      ? `<section class="mt-target"><div class="mt-target-tag">${UI.openQuestion} &middot; ${T.question.tag}</div>${T.question.html}</section>`
      : '';
    q('.mt-text').innerHTML = (T.explore ? exploreHTML(T.explore) : '') + body + question;

    const figs = (T.figures || []).map((f, i) => f.kind === 'svg'
      ? `<figure class="mt-fig">${f.svg}<figcaption>${f.cap}</figcaption></figure>`
      : `<figure class="mt-fig"><div class="mt-shot" data-fig="${i}"><div class="mt-shot-wait">${UI.rendering}</div></div><figcaption>${f.cap}</figcaption></figure>`).join('');
    const facts = T.facts ? `<div class="mt-facts"><h3>${UI.keyNumbers}</h3><dl>` +
      T.facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('') + `</dl></div>` : '';
    q('.mt-side').innerHTML = figs + facts;

    const prev = n > 0 ? ORDER[n - 1] : null, next = n >= 0 && n < ORDER.length - 1 ? ORDER[n + 1] : (n < 0 ? ORDER[0] : null);
    q('.mt-more').innerHTML =
      `<button class="mt-btn" type="button" data-go="contents">${UI.contents}</button>` +
      (prev ? `<button class="mt-btn" type="button" data-go="${prev}">‹ ${TOPICS[prev].title}</button>` : '') +
      (next ? `<button class="mt-btn mt-next" type="button" data-go="${next}">${TOPICS[next].title} ›</button>` : '');
    q('.mt-rel').innerHTML = (T.related || []).length ? `<span class="mt-rel-l">${UI.related}</span>` +
      T.related.filter((r) => TOPICS[r]).map((r) => `<button class="mt-chip" type="button" data-go="${r}">${TOPICS[r].title}</button>`).join('') : '';

    el.hidden = false;
    requestAnimationFrame(() => el.classList.add('on'));
    q('.mt-text').scrollTop = 0; q('.mt-side').scrollTop = 0;
    doc.focus?.();

    if (T.explore) {
      const wrap = q('.anno');
      requestFigure(T.explore.view, T.explore.opts || {}, (url, pts) => {
        if (!url || !wrap || !wrap.isConnected) return;
        const img = new Image();
        img.alt = plain(T.title);
        img.onload = () => {
          const host = wrap.querySelector('.anno-img');
          host.innerHTML = ''; host.appendChild(img);
          fillExplore(wrap, T.explore, pts || []);
          selectPin(wrap, -1);
        };
        img.src = url;
      });
    }
    (T.figures || []).forEach((f, i) => {
      if (f.kind !== 'sim') return;
      const host = q(`.mt-shot[data-fig="${i}"]`);
      if (host) fillShot(host, f);
    });
  }

  function close() {
    el.classList.remove('on');
    current = null;
    hideGloss();
    setTimeout(() => { if (!el.classList.contains('on')) el.hidden = true; }, 220);
  }

  el.addEventListener('click', (e) => {
    const term = e.target.closest('[data-gl]');
    if (term) { if (popFor === term) hideGloss(); else showGloss(term); return; }   // tap support
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      const wrap = pin.closest('.anno');
      if (wrap) selectPin(wrap, pin.classList.contains('on') ? -1 : +pin.dataset.pin);
      return;
    }
    const t = e.target.closest('[data-go],.mt-x');
    if (!t) { if (!e.target.closest('.gl-pop')) hideGloss(); return; }
    if (t.classList.contains('mt-x')) { close(); return; }
    open(t.dataset.go);
    onNavigate?.(t.dataset.go);
  });
  scrim.addEventListener('click', close);
  window.addEventListener('keydown', (e) => {
    if (el.hidden) return;
    if (e.key === 'Escape') { e.stopPropagation(); close(); }
    const n = ORDER.indexOf(current);
    if (e.key === 'ArrowRight' && n >= 0 && n < ORDER.length - 1) { e.preventDefault(); open(ORDER[n + 1]); onNavigate?.(ORDER[n + 1]); }
    if (e.key === 'ArrowLeft' && n > 0) { e.preventDefault(); open(ORDER[n - 1]); onNavigate?.(ORDER[n - 1]); }
  }, true);

  return { open, close, isOpen: () => !el.hidden, current: () => current };
}
