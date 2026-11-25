/* One Todo Tree — inspector panel for the selected node. */
(function () {
  'use strict';
  const S = OTT.S, C = OTT.cmd;
  const box = $('#inspector');
  let lastSig = null, lastSel = null;
  let notesTimer = null;
  let force = false;   // re-render once even though a text box has focus (after adding timeline steps)

  function seg(field, own, eff, extra) {
    const names = ['Inherit', 'Low', 'Medium', 'High'];
    let s = `<div class="segctl" data-seg="${field}">`;
    for (let i = 0; i <= 3; i++) {
      const active = i === 0 ? own == null : own === i;
      const ghost = i > 0 && own == null && eff === i;
      s += `<button data-v="${i}" class="${active ? 'on' : ''} ${ghost ? 'ghost' : ''} lv${i}">${i === 0 ? (eff ? 'Inherit (' + names[eff].toLowerCase() + ')' : 'Inherit') : names[i]}</button>`;
    }
    return s + '</div>' + (extra || '');
  }

  /** 3×3 grid: urgency left→right, criticality bottom→top; one click sets both. */
  function ratingGrid(n, d) {
    const LV = ['', 'Low', 'Medium', 'High'];
    const crit = d.crit || null, urg = d.urgBase || null;
    const rated = crit != null || urg != null;
    const pc = crit || 1, pu = urg || 1;
    const ownBoth = n.crit != null && n.urg != null;
    let cells = '';
    for (const cr of [3, 2, 1]) {
      cells += `<span class="rgy">${LV[cr]}</span>`;
      for (const ur of [1, 2, 3]) {
        const here = rated && cr === pc && ur === pu;
        const ramp = d.ramped && cr === pc && ur === d.urg;
        cells += `<button class="rgc q${cr}${ur} ${here ? 'on' : ''} ${here && !ownBoth ? 'inh' : ''} ${ramp ? 'ramp' : ''}" data-mx="${cr},${ur}" title="Critical: ${LV[cr]} · Urgent: ${LV[ur]}">${here ? '<i></i>' : ''}${ramp ? '<b>⏱</b>' : ''}</button>`;
      }
    }
    cells += `<span></span><span class="rgx">Low</span><span class="rgx">Medium</span><span class="rgx">High</span>`;
    const desc = (label, own, eff, field) => `<span>${label}: <b>${eff ? LV[eff] : '—'}</b> ${eff ? (own != null ? '<em>set here</em>' : '<em>inherited</em>') : '<em>not rated</em>'}${own != null ? ` <button class="lnk" data-inh="${field}">inherit</button>` : ''}</span>`;
    let s = `<div class="rgwrap"><span class="rgaxis-y">Critical ↑</span><div class="rgrid">${cells}</div></div><div class="rgaxis-x">Urgent →</div>`;
    s += `<div class="rgdesc">${desc('Critical', n.crit, d.crit, 'crit')}${desc('Urgent', n.urg, d.urgBase, 'urg')}</div>`;
    if (d.ramped && d.stepRamp) s += `<div class="hint warn">⏱ ${d.tl.late ? 'A missed timeline step' : 'The next timeline step (' + E(OTT.stepDays(d.tl.next.days)) + ')'} lifts urgency to ${LV[d.urg].toLowerCase()}.</div>`;
    else if (d.ramped) s += `<div class="hint warn">⏱ The deadline (${E(OTT.dueLabel(d))}) lifts urgency to ${LV[d.urg].toLowerCase()}.</div>`;
    return s;
  }

  /** Date shown and typed as DD/MM/YY (also accepts 1/12, 1 Dec, -14, +7, fri…); the button opens the calendar. */
  function dateField(attr, iso, ph) {
    return `<span class="dfield"><input class="dtext" ${attr} value="${iso ? OTT.dmy(iso) : ''}" data-iso="${iso || ''}" placeholder="${ph || 'DD/MM/YY'}" spellcheck="false"><button class="dpick" tabindex="-1" title="Pick from calendar">${ICON('cal')}</button><input type="date" class="dhidden" tabindex="-1" value="${iso || ''}"></span>`;
  }
  function section(title, body, cls) { return `<section class="isec ${cls || ''}"><h4>${title}</h4>${body}</section>`; }

  function render() {
    if (!S.inspectorOpen) { box.classList.add('closed'); box.innerHTML = `<button class="iopen" title="Show details">${ICON('chev')}</button>`; lastSig = null; return; }
    box.classList.remove('closed');
    const id = S.sel;
    const n = S.ed.nodes[id];
    if (!n) { box.innerHTML = ''; return; }
    const d = OTT.d(id);
    const sig = JSON.stringify([id, n, d.progress, d.crit, d.urg, d.deadline, d.days, Object.keys(S.people.people).length, S.ed.id, OTT.relationsOf(id)]);
    if (sig === lastSig) return;
    const ae = document.activeElement;
    if (!force && lastSel === id && box.contains(ae) && ['INPUT', 'TEXTAREA', 'SELECT'].includes(ae.tagName)) return; // don't disturb typing (buttons are fine)
    force = false;
    lastSig = sig; lastSel = id;
    const color = OTT.catColor(d.cat);
    const cat = OTT.catOf(d.cat);
    const path = M.pathTitles(S.ed, id);
    let h = `<div class="ihead" style="--c:${color}"><button class="iclose" title="Hide details">${ICON('chev')}</button>`;
    h += n.kind === 'root' ? `<div class="ipath">Edition</div>` : `<div class="ipath"><span class="cdot"></span>${path.slice(0, -1).map(E).join(' › ') || E(cat.name)}</div>`;
    if (n.kind === 'root') {
      h += `<input id="insp-title" class="ititle" data-f="edtitle" value="${E(S.ed.title)}" spellcheck="true"></div>`;
      h += rootBody();
      box.innerHTML = h;
      return;
    }
    if (n.kind === 'category') {
      h += `<div class="ititle ro">${E(n.title)}</div></div>`;
      h += categoryBody(id, n, d);
      box.innerHTML = h;
      return;
    }
    h += `<textarea id="insp-title" class="ititle" data-f="title" rows="1" spellcheck="true" placeholder="${n.kind === 'person' ? 'Name' : n.kind === 'info' ? 'Information note' : 'Task'}">${E(n.title)}</textarea>`;
    if (n.kind === 'info') {
      h += `<div class="ikind"><span class="kinfo">i</span>Information note<button class="kconv" data-act="info2task" title="Turn it into a task with progress and dates">Make task</button></div></div>`;
      h += infoBody(id, n);
      box.innerHTML = h;
      autosize($('#insp-title'));
      autosize(box.querySelector('textarea[data-f="notes"]'));
      checkAttachments(n);
      return;
    }
    const peopleGroup = n.kind === 'group' && M.inPeople(S.ed, id);
    const kindLabel = n.kind === 'person' ? 'Person' : peopleGroup ? 'Group of people' : n.kind === 'group' ? 'Subcategory' + (n.children.length ? ' · ' + n.children.length + ' item' + (n.children.length > 1 ? 's' : '') : '') : d.leaf ? 'Task' : 'Task with ' + n.children.length + ' subtask' + (n.children.length > 1 ? 's' : '');
    const conv = C.canMakeGroup(id) ? `<button class="kconv" data-act="togroup" title="Turn this task into a subcategory heading">Make subcategory</button>` : (n.kind === 'group' && !peopleGroup) ? `<button class="kconv" data-act="totask" ${C.canMakeTask(id) ? '' : 'disabled title="Move the subcategories inside it out first"'}>Make task</button>` : '';
    const prom = C.canPromote(id) ? `<button class="kconv" data-act="promote" title="Turn this into a new top-level category">Make main category</button>` : '';
    const toInfo = C.canMakeInfo(id) && !n.deadline && !n.timeline ? `<button class="kconv" data-act="toinfo" title="Text and links only: no date, progress or rating">Make info note</button>` : '';
    h += `<div class="ikind">${kindLabel}${conv}${toInfo}${prom}</div></div>`;

    // progress
    if (d.leaf) {
      h += section('Progress', `<div class="stages">${M.STAGES.map((s, i) => `<button data-stage="${i}" class="${n.stage === i ? 'on' : ''}" style="--c:${color}"><span class="sd">${[0, 1, 2, 3].slice(1).map(k => `<i class="${k <= i ? 'f' : ''}"></i>`).join('')}</span>${s}</button>`).join('')}</div><div class="hint">Tip: hover the task and turn the mouse wheel.</div>`);
    } else if (d.progress != null) {
      h += section('Progress', `<div class="pbar big"><span><i style="width:${(d.progress * 100).toFixed(1)}%;background:${color}"></i></span><b>${Math.round(d.progress * 100)}%</b></div><div class="hint">Weighted mean of ${n.children.length} subtask${n.children.length > 1 ? 's' : ''}.</div>`);
    }
    if (!peopleGroup) {
      const par = S.ed.nodes[n.parent];
      if (par && par.kind !== 'category' && par.kind !== 'group') h += `<div class="irow small"><label>Weight in “${E(OTT.title(par))}”</label><input type="number" min="0.1" step="0.5" data-f="weight" value="${n.weight || 1}" class="num"></div>`;
      // ratings
      h += section('Critical × Urgent', ratingGrid(n, d));
      // deadline
      let dl = `<div class="irow dates">${dateField('data-f="deadline"', n.deadline, n.end ? 'start' : 'DD/MM/YY')}<span class="dto">to</span>${dateField('data-f="end"', d.end, 'end (optional)')}${n.deadline ? `<button class="mini" data-act="clear-deadline" title="Clear the date${d.end ? 's' : ''}">${ICON('x')}</button>` : ''}</div>`;
      dl += `<div class="irow"><label class="lead">urgent from <input type="number" min="0" max="365" data-f="lead" value="${n.lead != null ? n.lead : ''}" placeholder="${S.settings.defaultLead || 14}" class="num"> days before ${d.end ? 'it starts' : 'the deadline'}</label></div>`;
      if (!n.deadline && d.deadline) dl += `<div class="hint">Inherits ${E(OTT.fmtDate(d.deadline))} from above.</div>`;
      if (d.late) dl += `<div class="hint warn">${ICON('warn')} Later than the parent's date (${E(OTT.fmtDate(OTT.d(n.parent).deadline))}).</div>`;
      if (d.end) {
        const len = M.daysUntil(d.end, n.deadline) + 1;
        if (d.done) dl += `<div class="hint">${len} days · done</div>`;
        else if (d.now) dl += `<div class="hint warn">Happening now — until ${E(OTT.fmtDate(d.end))}.</div>`;
        else if (d.ended) dl += `<div class="hint">Ended ${-d.endDays === 1 ? 'yesterday' : -d.endDays + ' days ago'}.${d.leaf ? ' <button class="lnk" data-act="markdone">Mark done</button>' : ''}</div>`;
        else dl += `<div class="hint">${len} days · starts ${d.days === 0 ? 'today' : d.days === 1 ? 'tomorrow' : 'in ' + d.days + ' days'}</div>`;
      } else if (n.deadline && d.days != null && !d.done) dl += `<div class="hint ${d.overdue ? 'bad' : ''}">${d.overdue ? (-d.days) + ' days overdue' : d.days === 0 ? 'Due today' : 'In ' + d.days + ' days'}</div>`;
      if (n.deadline) dl += `<div class="irow ccol"><label>Calendar colour</label><input type="color" data-f="color" value="${n.color || color}">${n.color ? '<button class="lnk" data-act="clearcolor">use category colour</button>' : '<span class="hint">category colour</span>'}</div>`;
      else dl += `<div class="hint">One date = a deadline. Add an end date for a period (event, meeting, travel…).</div>`;
      h += section(d.end ? 'Period' : 'Date', dl);
      h += section('Timeline', timelineBody(id, n, d), 'tlsec');
    }
    // person record
    if (n.kind === 'person') h += personBody(n);
    // people
    if (!peopleGroup && n.kind !== 'person') {
      const owner = n.owner && OTT.person(n.owner);
      let ppl = `<div class="irow"><label>Owner</label><input list="peopleList" data-f="owner" value="${owner ? E(owner.name) : ''}" placeholder="Me (leave empty)"></div>`;
      ppl += `<div class="irow wrap"><label>Stakeholders</label><div class="chips2">${n.stakeholders.map(p => OTT.person(p) ? `<span class="pchip">${E(OTT.person(p).name)}<button data-rmstk="${p}">${ICON('x')}</button></span>` : '').join('')}<input list="peopleList" data-f="stk" placeholder="+ add"></div></div>`;
      h += section('People', ppl, 'people');
    }
    // budget
    if (!peopleGroup) {
      const b = n.budget || {};
      let bd = `<div class="irow budget"><label>Budget</label><input type="number" data-f="balloc" value="${b.alloc != null ? b.alloc : ''}" placeholder="allocated"><input type="number" data-f="bspent" value="${b.spent != null ? b.spent : ''}" placeholder="spent"><input data-f="bcur" value="${E(b.cur || S.settings.currency || 'DKK')}" class="cur"></div>`;
      if (d.childBudget) bd += `<div class="hint">Subtasks: ${Object.entries(d.childBudget).map(([c, v]) => E(c) + ' ' + v.spent.toLocaleString() + ' spent of ' + v.alloc.toLocaleString()).join('; ')}${b.alloc != null && d.childBudget[b.cur || S.settings.currency] && d.childBudget[b.cur || S.settings.currency].alloc > b.alloc ? ' — <b class="bad">more than this budget</b>' : ''}</div>`;
      if (b.alloc && b.spent) bd += `<div class="pbar"><span><i style="width:${Math.min(100, b.spent / b.alloc * 100)}%;background:${b.spent > b.alloc ? 'var(--u3)' : color}"></i></span><b>${Math.round(b.spent / b.alloc * 100)}%</b></div>`;
      h += section('Budget', bd, 'budgetsec');
    }
    // attachments
    let at = `<div class="atts">${n.attachments.map(a => `<div class="att" data-att="${a.id}"><span class="aic">${ICON(a.kind === 'url' ? 'ext' : a.kind === 'folder' ? 'folder' : 'clip')}</span><button class="aname" data-open="${a.id}" title="${E(a.url || a.dbx || a.copied || a.abs || '')}">${E(a.name)}</button><span class="atag">${a.kind === 'url' ? 'link' : a.copied ? 'copied' : 'in place'}</span>${a.kind !== 'url' ? `<button class="mini" data-reveal="${a.id}" title="Show in Explorer">${ICON('folder')}</button>` : ''}<button class="mini" data-rmatt="${a.id}" title="Remove">${ICON('x')}</button></div>`).join('')}</div>`;
    at += `<div class="irow btns"><button data-act="pick">${ICON('clip')} Files…</button><button data-act="addurl">${ICON('link')} Web link…</button></div><div class="hint">Or drop files/links on the task. Files in Dropbox are linked in place; others (or Ctrl+drop) are copied into the tree folder.</div>`;
    h += section('Attachments', at, 'attsec');
    // relations
    const rel = OTT.relationsOf(id);
    let rl = rel.map(r => { const rn = S.ed.nodes[r]; const rd = OTT.d(r); return `<div class="rel"><span class="cdot" style="background:${OTT.catColor(rd.cat)}"></span><button data-goto="${r}">${E(OTT.title(rn))}</button><span class="rpath">${E(OTT.catOf(rd.cat).name)}</span><button class="mini" data-unrel="${r}">${ICON('x')}</button></div>`; }).join('');
    rl += `<div class="irow btns"><button data-act="link">${ICON('link')} Link to another task…</button></div>`;
    h += section('Related', rl);
    // notes
    h += section('Notes', `<textarea data-f="notes" rows="4" placeholder="Notes, next steps, context…" spellcheck="true">${E(n.notes || '')}</textarea>`);
    h += `<div class="ifoot"><span>Created ${new Date(n.created).toLocaleDateString('en-GB')} · changed ${new Date(n.modified).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><button class="danger" data-act="delete">${ICON('trash')} Delete</button></div>`;
    box.innerHTML = h + peopleDatalist();
    autosize($('#insp-title'));
    checkAttachments(n);
  }

  /** Information note: text with clickable links, attached links/files, related items. */
  function infoBody(id, n) {
    const urls = OTT.urlsIn(n.notes);
    let h = section('Text', `<textarea data-f="notes" rows="5" spellcheck="true" placeholder="What to know, and where — paste links straight into the text (e.g. https://inside.dtu.dk/…)">${E(n.notes || '')}</textarea><div class="infoprev ${n.notes && n.notes.trim() ? '' : 'empty'}">${OTT.linkify(n.notes)}</div>`, 'infosec');
    let lk = urls.map(u => `<div class="att"><span class="aic">${ICON('ext')}</span><a href="#" class="aname" data-url="${E(u)}" title="${E(u)}">${E(u.replace(/^https?:\/\/(www\.)?/, ''))}</a><span class="atag">in text</span></div>`).join('');
    lk += n.attachments.map(a => `<div class="att" data-att="${a.id}"><span class="aic">${ICON(a.kind === 'url' ? 'ext' : a.kind === 'folder' ? 'folder' : 'clip')}</span><button class="aname" data-open="${a.id}" title="${E(a.url || a.dbx || a.copied || a.abs || '')}">${E(a.name)}</button><span class="atag">${a.kind === 'url' ? 'link' : a.copied ? 'copied' : 'in place'}</span>${a.kind !== 'url' ? `<button class="mini" data-reveal="${a.id}" title="Show in Explorer">${ICON('folder')}</button>` : ''}<button class="mini" data-rmatt="${a.id}" title="Remove">${ICON('x')}</button></div>`).join('');
    h += section('Links & files', `<div class="atts">${lk || '<div class="hint">Links in the text appear here, too.</div>'}</div><div class="irow btns"><button data-act="addurl">${ICON('link')} Web link…</button><button data-act="pick">${ICON('clip')} Files…</button></div>`, 'attsec');
    const rel = OTT.relationsOf(id);
    let rl = rel.map(r => { const rn = S.ed.nodes[r]; const rd = OTT.d(r); return `<div class="rel"><span class="cdot" style="background:${OTT.catColor(rd.cat)}"></span><button data-goto="${r}">${E(OTT.title(rn))}</button><span class="rpath">${E(OTT.catOf(rd.cat).name)}</span><button class="mini" data-unrel="${r}">${ICON('x')}</button></div>`; }).join('');
    rl += `<div class="irow btns"><button data-act="link">${ICON('link')} Link to a task…</button></div>`;
    h += section('Related', rl);
    h += `<div class="ifoot"><span>Created ${new Date(n.created).toLocaleDateString('en-GB')} · changed ${new Date(n.modified).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span><button class="danger" data-act="delete">${ICON('trash')} Delete</button></div>`;
    return h;
  }

  /** Dated steps towards the deadline, a quick-entry line and pin/copy tools. */
  function timelineBody(id, n, d) {
    const has = n.timeline && n.timeline.length;
    let s = '';
    if (has) {
      s += '<div class="tlist">' + OTT.tlLines(id).map(l => {
        if (l.t === 'today') return `<div class="tli today"><span class="tlmk"></span><span class="tlname">Today · ${E(OTT.fmtDate(l.date))}</span></div>`;
        if (l.t === 'dl') return `<div class="tli dl ${l.late ? 'late' : ''}"><span class="tlmk">${ICON('flag')}</span><span class="tldate">${E(OTT.fmtDate(l.date))}</span><span class="tlname">Deadline</span><span class="tlday">${d.done ? '' : E(OTT.dueLabel(d))}</span></div>`;
        const st = l.s;
        if (l.t === 'todo') { const k = st.id + '|' + l.td.id; return `<div class="tli todo ${l.td.done ? 'done' : ''} ${l.late ? 'late' : ''}"><span class="tlmk"></span><button class="tdmk chk" data-tdk="${k}" title="${l.td.done ? 'Mark as not done' : 'Mark as done'}">${l.td.done ? ICON('check') : ''}</button><input data-tdt="${k}" value="${E(l.td.text)}" placeholder="To do" title="${E(l.td.text)}"><button class="mini" data-tdrm="${k}" title="Remove to-do">${ICON('x')}</button></div>`; }
        const nt = (st.todos || []).length;
        return `<div class="tli ${st.done ? 'done' : ''} ${l.late ? 'late' : ''}"><button class="tlmk chk" data-tlk="${st.id}" title="${st.done ? 'Mark as not done' : 'Mark as done' + (nt ? ' (ticks all its to-dos)' : '')}">${st.done ? ICON('check') : ''}</button>${dateField(`data-tld="${st.id}"`, st.date)}<input data-tlt="${st.id}" value="${E(st.title)}" placeholder="${nt ? (st.todos.filter(t => t.done).length + '/' + nt + ' to-dos') : 'What should be ready'}" title="${E(st.title)}${st.done ? ' — done' : ' — ' + E(OTT.stepDays(l.days))}"><button class="mini" data-tlrm="${st.id}" title="Remove step${nt ? ' and its to-dos' : ''}">${ICON('x')}</button></div>`;
      }).join('') + '</div>';
    }
    s += `<textarea data-f="tladd" rows="1" spellcheck="true" placeholder="${has ? 'Add a step…' : 'Add dated steps, e.g. “-14 Collect abstracts” or “1 Dec Take old posters down”'}"></textarea><div class="tlprev"></div>`;
    const others = Object.values(S.ed.nodes).filter(x => x.id !== id && x.timeline && x.timeline.length);
    const btns = [];
    if (has) btns.push(`<button data-act="tlpin" class="${n.tlPin ? 'on' : ''}" title="Show the dates on the node in the map">${ICON('pin')} ${n.tlPin ? 'Shown on map' : 'Show on map'}</button>`);
    if (others.length) btns.push(`<select data-f="tlcopy" title="Copy the steps of another task; dates keep their distance to the deadline"><option value="">Copy steps from…</option>${others.map(x => `<option value="${x.id}">${E(OTT.title(x))} (${x.timeline.length})</option>`).join('')}</select>`);
    if (btns.length) s += `<div class="irow btns">${btns.join('')}</div>`;
    s += `<div class="hint">Enter adds; after a date on its own line or a “- ” to-do, Enter starts the next “- ” line, and Enter on an empty “- ” (or Ctrl+Enter) adds them. Dates: <b>1 Dec</b> · <b>1/12</b> · <b>-14</b> or <b>2w before</b> (counted back from the deadline) · <b>+7</b> or <b>in 2 weeks</b> · <b>fri</b> · <b>tomorrow</b> — at the start or end of the line. Lines starting with <b>- </b> become to-dos under the date above them (on their own: under the next step). Paste several lines to add a whole plan.</div>`;
    return s;
  }
  function stepPreview(text, id) {
    const d = OTT.d(id);
    return M.parseSteps(text, { deadline: d.deadline, today: M.todayStr() }).map(r => {
      if (r.error || !r.attach) return r;
      const st = OTT.attachStep(id);   // "- …" lines without a date line: under the next open step
      return st ? Object.assign(r, { attachTo: st.id, date: st.date, title: M.stepTitle(st) }) : Object.assign(r, { error: 'Start with a date line, then the “- ” to-dos below it.' });
    });
  }
  function commitSteps(t) {
    const id = S.sel, rows = stepPreview(t.value, id);
    if (!rows.length) return;
    const bad = rows.find(r => r.error);
    if (bad) { OTT.toast((rows.length > 1 ? '“' + bad.line + '”: ' : '') + bad.error, 'warn', 5000); return; }
    t.value = '';
    C.addSteps(id, rows.map(r => r.attachTo ? { attachTo: r.attachTo, todos: r.todos } : { title: r.title, date: r.date, todos: r.todos }));
    lastSig = null; force = true;
    OTT.renderNow();
    const a = box.querySelector('[data-f="tladd"]');
    if (a) a.focus();
  }

  function peopleDatalist() {
    return `<datalist id="peopleList">${Object.values(S.people.people).filter(p => p.name).sort((a, b) => a.name.localeCompare(b.name)).map(p => `<option value="${E(p.name)}">`).join('')}</datalist>`;
  }

  function personBody(n) {
    const p = OTT.person(n.person) || {};
    let h = `<div class="irow"><label>Organisation</label><input data-pf="org" value="${E(p.org || '')}" placeholder="e.g. DTU Physics"></div>`;
    h += `<div class="irow"><label>E-mail</label><input data-pf="email" value="${E(p.email || '')}" placeholder="name@dtu.dk">${p.email ? `<button class="mini" data-act="mail" title="Write e-mail">${ICON('ext')}</button>` : ''}</div>`;
    const inv = [];
    for (const x of Object.values(S.ed.nodes)) {
      if (x.owner === n.person) inv.push([x.id, 'owner']);
      else if (x.stakeholders && x.stakeholders.includes(n.person)) inv.push([x.id, 'stakeholder']);
    }
    h += `<div class="invol">${inv.length ? inv.map(([x, role]) => { const dd = OTT.d(x); return `<div class="rel"><span class="cdot" style="background:${OTT.catColor(dd.cat)}"></span><button data-goto="${x}">${E(OTT.title(S.ed.nodes[x]))}</button><span class="rpath">${role}${dd.deadline && !dd.done ? ' · ' + E(OTT.dueLabel(dd)) : ''}</span></div>`; }).join('') : '<div class="hint">Not owner or stakeholder of anything in this edition.</div>'}</div>`;
    return section('Person', h);
  }

  function rootBody() {
    const der = S.der;
    let tasks = 0, open = 0, over = 0;
    for (const [id, d] of der) { if (!d.leaf) continue; tasks++; if (!d.done) open++; if (d.overdue) over++; }
    let h = section('Edition', `<div class="kv"><span>Created</span><b>${new Date(S.ed.created).toLocaleDateString('en-GB')}</b><span>Based on</span><b>${E(S.ed.basedOn || '—')}</b><span>Tasks</span><b>${tasks} (${open} open${over ? ', ' + over + ' overdue' : ''})</b><span>Overall</span><b>${der.get('root').progress != null ? Math.round(der.get('root').progress * 100) + '%' : '—'}</b></div>`);
    h += section('Categories', S.ed.nodes.root.children.map(c => { const n = S.ed.nodes[c], d = der.get(c); return `<div class="rel"><span class="cdot" style="background:${OTT.catColor(n.cat)}"></span><button data-goto="${c}">${E(n.title)}</button><span class="rpath">${d.progress != null ? Math.round(d.progress * 100) + '%' : 'empty'}</span></div>`; }).join(''));
    return h + `<div class="hint pad">Select a category and press <kbd>Tab</kbd> to add a task.</div>`;
  }

  function categoryBody(id, n, d) {
    let leaves = 0, open = 0, over = 0, soon = 0;
    for (const x of M.subtreeIds(S.ed, id)) { const dd = OTT.d(x); if (!dd.leaf) continue; leaves++; if (!dd.done) open++; if (dd.overdue) over++; else if (dd.days != null && dd.days <= 7 && !dd.done) soon++; }
    let h = '';
    if (d.progress != null) h += section('Progress', `<div class="pbar big"><span><i style="width:${(d.progress * 100).toFixed(1)}%;background:${OTT.catColor(n.cat)}"></i></span><b>${Math.round(d.progress * 100)}%</b></div>`);
    h += section('Overview', `<div class="kv"><span>Tasks</span><b>${leaves}</b><span>Open</span><b>${open}</b><span>Overdue</span><b class="${over ? 'bad' : ''}">${over}</b><span>Due ≤ 7 days</span><b>${soon}</b></div>`);
    if (d.childBudget) h += section('Budget', `<div class="hint">${Object.entries(d.childBudget).map(([c, v]) => E(c) + ' ' + v.spent.toLocaleString() + ' spent of ' + v.alloc.toLocaleString()).join('<br>')}</div>`);
    h += section('Attachments', `<div class="atts">${n.attachments.map(a => `<div class="att"><span class="aic">${ICON(a.kind === 'url' ? 'ext' : 'clip')}</span><button class="aname" data-open="${a.id}">${E(a.name)}</button><button class="mini" data-rmatt="${a.id}">${ICON('x')}</button></div>`).join('')}</div><div class="irow btns"><button data-act="pick">${ICON('clip')} Files…</button><button data-act="addurl">${ICON('link')} Web link…</button></div>`);
    h += section('Notes', `<textarea data-f="notes" rows="4" placeholder="Notes for this category">${E(n.notes || '')}</textarea>`);
    h += `<div class="hint pad">${id === M.PEOPLE_CAT ? 'Tab adds a group; inside a group Tab adds a person; under a person Tab adds a task.' : 'Press <kbd>Tab</kbd> to add a task. Rename or recolour categories in Settings.'}</div>`;
    h += `<div class="irow btns pad2"><button data-act="editcat">${ICON('gear')} Edit category…</button>${C.canDemote(id) ? '<button data-act="demote">Move into another category…</button>' : ''}</div>`;
    return h;
  }

  async function checkAttachments(n) {
    const files = n.attachments.filter(a => a.kind !== 'url');
    if (!files.length) return;
    const st = await ott.attachStatus(files);
    if (!Array.isArray(st)) return;
    for (const s of st) {
      const el = box.querySelector(`.att[data-att="${s.id}"]`);
      if (el && !s.exists) { el.classList.add('missing'); el.querySelector('.atag').textContent = 'missing'; }
    }
  }

  function autosize(t) { if (!t || t.tagName !== 'TEXTAREA') return; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }

  // ---------- events ----------
  box.addEventListener('click', async (e) => {
    const id = S.sel, n = S.ed.nodes[id];
    if (e.target.closest('.iclose')) { S.inspectorOpen = false; S.ui.inspector = false; OTT.saveUiSoon(); lastSig = null; return OTT.render(); }
    if (e.target.closest('.iopen')) { S.inspectorOpen = true; S.ui.inspector = true; OTT.saveUiSoon(); lastSig = null; return OTT.render(); }
    const b = e.target.closest('button');
    if (!b || !n) return;
    if (b.classList.contains('dpick')) { const h = b.nextElementSibling; try { h.showPicker(); } catch (_) { h.focus(); } return; }
    if (b.dataset.stage != null) return C.setStage(id, +b.dataset.stage);
    if (b.dataset.mx) { const [cr, ur] = b.dataset.mx.split(',').map(Number); return OTT.tx('Critical ' + cr + ' · Urgent ' + ur, (c) => { const x = c.touch(id); x.crit = cr; x.urg = ur; }); }
    if (b.dataset.inh) return C.setField(id, b.dataset.inh, null, (b.dataset.inh === 'crit' ? 'Criticality' : 'Urgency') + ' inherited');
    const segc = b.closest('[data-seg]');
    if (segc) { const f = segc.dataset.seg; const v = +b.dataset.v || null; return C.setField(id, f, v, (f === 'crit' ? 'Criticality' : 'Urgency')); }
    if (b.dataset.goto) { C.select(b.dataset.goto, { reveal: true }); return; }
    if (b.dataset.tlk) return C.toggleStep(id, b.dataset.tlk);
    if (b.dataset.tlrm) return C.removeStep(id, b.dataset.tlrm);
    if (b.dataset.tdk) { const [sid, tid] = b.dataset.tdk.split('|'); return C.toggleTodo(id, sid, tid); }
    if (b.dataset.tdrm) { const [sid, tid] = b.dataset.tdrm.split('|'); return C.removeTodo(id, sid, tid); }
    if (b.dataset.act === 'tlpin') return C.toggleTlPin(id);
    if (b.dataset.unrel) return C.removeRelation(id, b.dataset.unrel);
    if (b.dataset.rmstk) return C.setField(id, 'stakeholders', n.stakeholders.filter(x => x !== b.dataset.rmstk), 'Remove stakeholder');
    if (b.dataset.open) { const a = n.attachments.find(x => x.id === b.dataset.open); const r = await ott.openAttachment(a); if (r && r.error) OTT.toast(r.error, 'error'); return; }
    if (b.dataset.reveal) { const a = n.attachments.find(x => x.id === b.dataset.reveal); ott.revealAttachment(a); return; }
    if (b.dataset.rmatt) { const a = n.attachments.find(x => x.id === b.dataset.rmatt); OTT.tx('Remove attachment', (c) => { const x = c.touch(id); x.attachments = x.attachments.filter(y => y.id !== a.id); }); OTT.toast(a.copied ? 'Removed from the task (the copied file stays in the tree folder)' : 'Removed from the task (the file itself is untouched)'); return; }
    const act = b.dataset.act;
    if (act === 'clear-deadline') return OTT.tx('Clear date', (c) => { const x = c.touch(id); x.deadline = null; delete x.end; });
    if (act === 'markdone') return C.setStage(id, M.STAGE_MAX);
    if (act === 'clearcolor') return OTT.tx('Calendar colour', (c) => { delete c.touch(id).color; });
    if (act === 'pick') { const p = await ott.pickFiles(); if (p && p.length) OTT.attachPaths(id, p, false); return; }
    if (act === 'addurl') { const u = await OTT.dialogs.prompt('Add a web link', 'URL (or a file path — paste “Copy as path”)', ''); if (!u) return; if (/^[a-z]:\\|^\\\\|^"[a-z]:\\/i.test(u.trim())) OTT.attachPaths(id, [u], false); else OTT.attachUrl(id, u); return; }
    if (act === 'link') return C.startLink(id);
    if (act === 'togroup') return C.toGroup(id);
    if (act === 'demote') return OTT.dialogs.demote(id);
    if (act === 'editcat') return OTT.dialogs.settings({ category: n.cat });
    if (act === 'toinfo') return C.toInfo(id);
    if (act === 'info2task') return C.infoToTask(id);
    if (act === 'promote') return C.promoteToCategory(id);
    if (act === 'totask') return C.toTask(id);
    if (act === 'delete') return C.remove(id);
    if (act === 'mail') { const p = OTT.person(n.person); if (p && p.email) ott.openAttachment({ kind: 'url', url: 'mailto:' + p.email }); }
  });

  box.addEventListener('change', (e) => {
    const t = e.target, f = t.dataset.f, id = S.sel, n = S.ed.nodes[id];
    if (!n) return;
    if (t.dataset.pf) { const p = OTT.person(n.person); if (p) { p[t.dataset.pf] = t.value.trim(); OTT.peopleChanged(); lastSig = null; } return; }
    // calendar picked: copy into the visible DD/MM/YY field and handle it there
    if (t.classList.contains('dhidden')) { const x = t.parentNode.querySelector('.dtext'); if (t.value) { x.value = OTT.dmy(t.value); x.dispatchEvent(new Event('change', { bubbles: true })); } return; }
    let iso = null;
    if (t.classList.contains('dtext')) {
      const v = t.value.trim();
      if (v) {
        // in the end field, "+3" / "fri" count from the start date
        const r = M.parseStep(v, { deadline: OTT.d(id).deadline, today: f === 'end' && n.deadline ? n.deadline : M.todayStr() });
        if (!r.date || r.title) { OTT.toast('“' + v + '” is not a date — use DD/MM/YY (or 1 Dec, -14, +7, fri…)', 'warn', 4500); t.value = t.dataset.iso ? OTT.dmy(t.dataset.iso) : ''; return; }
        iso = r.date;
        t.value = OTT.dmy(iso);
      }
    }
    if (t.dataset.tld) { if (iso) C.setStep(id, t.dataset.tld, { date: iso }, 'Step date'); else t.value = OTT.dmy(t.dataset.iso); return; }
    if (f === 'deadline') {
      if (!iso) { OTT.tx('Clear date', (c) => { const x = c.touch(id); x.deadline = null; delete x.end; }); return; }
      // moving the start keeps a period's length
      const len = n.end && n.deadline ? M.daysUntil(n.end, n.deadline) : 0;
      OTT.tx(n.end ? 'Period start' : 'Deadline', (c) => { const x = c.touch(id); x.deadline = iso; if (len > 0) x.end = M.addDays(iso, len); });
      return;
    }
    if (f === 'end') {
      if (!iso) { if (n.end) OTT.tx('Remove end date', (c) => { delete c.touch(id).end; }); return; }
      if (!n.deadline) { OTT.tx('Period', (c) => { const x = c.touch(id); x.deadline = iso; }); OTT.toast('Set as the start date — now add the end date.'); return; }
      if (iso <= n.deadline) { OTT.toast('The end must be after the start (' + OTT.dmy(n.deadline) + ').', 'warn'); t.value = n.end ? OTT.dmy(n.end) : ''; return; }
      OTT.tx('Period end', (c) => { c.touch(id).end = iso; });
      return;
    }
    if (f === 'color') { OTT.tx('Calendar colour', (c) => { c.touch(id).color = t.value; }); return; }
    if (t.dataset.tlt) { C.setStep(id, t.dataset.tlt, { title: t.value.trim() }, 'Step title'); return; }
    if (t.dataset.tdt) { const [sid, tid] = t.dataset.tdt.split('|'); C.setTodo(id, sid, tid, t.value.trim()); return; }
    if (f === 'tlcopy') { if (t.value) { const from = t.value; t.blur(); C.copyTimeline(from, id); } return; }
    switch (f) {
      case 'edtitle': S.ed.title = t.value.trim() || S.ed.id; S.dirtyEd = true; OTT.scheduleSave(); OTT.render(); break;
      case 'title': C.rename(id, t.value.replace(/\s*\n\s*/g, ' ').trim()); break;
      case 'lead': C.setField(id, 'lead', t.value === '' ? null : Math.max(0, +t.value), 'Lead time'); break;
      case 'weight': C.setField(id, 'weight', Math.max(0.1, +t.value || 1), 'Weight'); break;
      case 'owner': {
        const v = t.value.trim();
        if (!v) { C.setField(id, 'owner', null, 'Clear owner'); break; }
        let p = OTT.findPersonByName(v);
        OTT.tx('Owner', (c) => { const pid = p ? p.id : OTT.createPerson(v, c); c.touch(id).owner = pid; });
        if (!p) OTT.toast('New person “' + v + '” added under People › Other');
        break;
      }
      case 'stk': addStakeholder(t); break;
      case 'balloc': case 'bspent': case 'bcur': {
        const b = Object.assign({}, n.budget || {});
        if (f === 'bcur') b.cur = t.value.trim().toUpperCase() || null;
        else b[f === 'balloc' ? 'alloc' : 'spent'] = t.value === '' ? null : +t.value;
        const empty = b.alloc == null && b.spent == null;
        C.setField(id, 'budget', empty ? null : b, 'Budget');
        break;
      }
    }
  });
  function addStakeholder(t) {
    const v = t.value.trim();
    if (!v) return;
    const id = S.sel, n = S.ed.nodes[id];
    let p = OTT.findPersonByName(v);
    OTT.tx('Add stakeholder', (c) => { const pid = p ? p.id : OTT.createPerson(v, c); const x = c.touch(id); if (!x.stakeholders.includes(pid)) x.stakeholders = x.stakeholders.concat(pid); });
    if (!p) OTT.toast('New person “' + v + '” added under People › Other');
    t.value = '';
    lastSig = null;
    setTimeout(() => { const i = box.querySelector('[data-f="stk"]'); if (i) i.focus(); }, 30);
  }
  box.addEventListener('keydown', (e) => {
    const t = e.target;
    if (t.dataset.f === 'title' && e.key === 'Enter') { e.preventDefault(); t.blur(); }
    if (t.dataset.f === 'stk' && e.key === 'Enter') { e.preventDefault(); addStakeholder(t); }
    if (t.dataset.f === 'tladd' && e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      // bullet-list typing: after a lone date or a to-do, Enter starts the next "- " line;
      // Enter on an empty "- " line (or Ctrl+Enter) adds everything
      const lines = t.value.split(/\r?\n/), last = lines[lines.length - 1];
      if (!(e.ctrlKey || e.metaKey) && t.selectionStart === t.value.length) {
        if (/^\s*(?:[-–—•*▪◦]|\[\s?\])\s*$/.test(last) && lines.length > 1) { lines.pop(); t.value = lines.join('\n'); }
        else {
          const isTodo = M.parseTodo(last) != null;
          const r = !isTodo && last.trim() ? M.parseStep(last.trim(), { deadline: OTT.d(S.sel).deadline, today: M.todayStr() }) : null;
          if (isTodo || (r && !r.error && !r.title)) { t.value += '\n- '; t.dispatchEvent(new Event('input', { bubbles: true })); return; }
        }
      }
      commitSteps(t);
    }
    if ((t.dataset.tlt || t.dataset.tdt || t.classList.contains('dtext')) && e.key === 'Enter') { e.preventDefault(); t.blur(); }
    if (e.key === 'Escape') { t.blur(); OTT.focusStage(); }
  });
  box.addEventListener('input', (e) => {
    const t = e.target;
    if (t.dataset.f === 'title') autosize(t);
    if (t.dataset.f === 'tladd') {
      autosize(t);
      const pv = t.nextElementSibling;
      const rows = t.value.trim() ? stepPreview(t.value, S.sel) : [];
      const day = (iso) => new Date(iso + 'T00:00:00').toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: iso.slice(0, 4) === M.todayStr().slice(0, 4) ? undefined : 'numeric' });
      pv.innerHTML = rows.map(r => r.error ? `<div class="bad">${E(r.line)} — ${E(r.error)}</div>`
        : (r.attachTo ? `<div>→ to-dos under <b>${E(day(r.date))}</b> · ${E(r.title)}</div>` : `<div>→ <b>${E(day(r.date))}</b>${r.title ? ' · ' + E(r.title) : ''}${r.how ? ` <em>(${E(r.how)})</em>` : ''}</div>`) +
          (r.todos || []).map(x => `<div class="tdprev">☐ ${E(x)}</div>`).join('')).join('');
    }
    if (t.dataset.f === 'notes') {
      const pv = box.querySelector('.infoprev');
      if (pv) { pv.innerHTML = OTT.linkify(t.value); pv.classList.toggle('empty', !t.value.trim()); autosize(t); }
      clearTimeout(notesTimer);
      const id = S.sel, v = t.value;
      notesTimer = setTimeout(() => C.setField(id, 'notes', v, 'Notes', true), 700);
    }
  });
  box.addEventListener('focusout', (e) => {
    const t = e.target;
    if (t.dataset && t.dataset.f === 'notes') { clearTimeout(notesTimer); C.setField(S.sel, 'notes', t.value, 'Notes', true); }
    setTimeout(() => { if (!box.contains(document.activeElement)) { lastSig = null; OTT.render(); } }, 0);
  });
  // drop files on the inspector = attach to selected
  box.addEventListener('dragover', (e) => { e.preventDefault(); box.classList.add('filedrop'); });
  box.addEventListener('dragleave', (e) => { if (!box.contains(e.relatedTarget)) box.classList.remove('filedrop'); });
  box.addEventListener('drop', (e) => { e.preventDefault(); box.classList.remove('filedrop'); if (S.sel && S.sel !== 'root') OTT.handleDrop(S.sel, e); });

  OTT.inspector = { render, invalidate: () => { lastSig = null; } };
})();
