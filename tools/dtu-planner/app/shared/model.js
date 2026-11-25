/* One Todo Tree — pure data model helpers, shared by main process (require) and renderer (<script>). */
(function (root) {
  'use strict';

  const FORMAT = 'onetodotree/1';
  const STAGES = ['Not started', 'Started', 'Nearly done', 'Done'];
  const STAGE_MAX = STAGES.length - 1;
  const DEFAULT_LEAD = 14;   // days before deadline: urgency ≥ 2
  const FINAL_DAYS = 3;      // days before deadline: urgency 3

  // starting categories for a brand-new data folder only; an existing folder keeps its own (settings.json)
  const DEFAULT_CATEGORIES = [
    ['topic1', 'Topic 1', '#5b8def'],
    ['topic2', 'Topic 2', '#2bb3a3'],
    ['topic3', 'Topic 3', '#e0703c'],
    ['topic4', 'Topic 4', '#8a6fdf'],
    ['people', 'People', '#e2558a', ['Colleagues', 'Partners', 'Other']],
  ].map(([key, name, color, groups]) => (groups ? { key, name, color, groups } : { key, name, color }));
  const PEOPLE_CAT = 'cat-people';

  function uid() {
    const t = Date.now().toString(36);
    const r = Math.random().toString(36).slice(2, 8);
    return t + r;
  }

  function nowIso() { return new Date().toISOString(); }

  /** DTU teaching/exam periods shown as faint bands in the calendar (student.dtu.dk, academic year 2026/27). Editable in Settings. */
  const DTU_PERIODS = [
    { label: 'Autumn 13-week', start: '2026-08-31', end: '2026-12-04', kind: 'teach' },
    { label: 'Winter exams', start: '2026-12-06', end: '2026-12-22', kind: 'exam' },
    { label: 'January 3-week', start: '2027-01-04', end: '2027-01-22', kind: 'teach' },
    { label: 'Spring 13-week', start: '2027-02-01', end: '2027-05-12', kind: 'teach' },
    { label: 'Summer exams', start: '2027-05-13', end: '2027-06-02', kind: 'exam' },
    { label: 'June 3-week', start: '2027-06-04', end: '2027-06-24', kind: 'teach' },
    { label: 'July 3-week', start: '2027-07-05', end: '2027-07-23', kind: 'teach' },
    { label: 'August 3-week', start: '2027-08-02', end: '2027-08-20', kind: 'teach' },
  ];
  // a packaged flavour (flavor.json, e.g. the generic "Topic 1–4" build) can replace the starting categories
  let startCategories = DEFAULT_CATEGORIES;
  // product name: 'DTU Planner' (called One Todo Tree until 2026-11-25), or a flavour's productName
  let appName = 'DTU Planner';
  function setAppName(n) { if (n) appName = String(n); }
  function getAppName() { return appName; }
  function setStartCategories(list) {
    if (!Array.isArray(list) || !list.length) return;
    const cats = list.filter(c => c && c.key && c.name).map(c => ({ key: String(c.key), name: String(c.name), color: c.color || '#7b8794', ...(c.groups ? { groups: c.groups } : {}) }));
    if (!cats.some(c => 'cat-' + c.key === PEOPLE_CAT)) cats.push({ ...DEFAULT_CATEGORIES.find(c => 'cat-' + c.key === PEOPLE_CAT) });
    startCategories = cats;
  }
  function defaultSettings() {
    return { format: FORMAT, categories: startCategories.map(c => ({ ...c, ...(c.groups ? { groups: c.groups.slice() } : {}) })), defaultLead: DEFAULT_LEAD, currency: 'DKK', semesters: DTU_PERIODS.map(p => ({ ...p })) };
  }

  // ---------- Danish calendar ----------
  function easter(y) { // anonymous Gregorian algorithm (Meeus)
    const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
    return todayStr(new Date(y, month - 1, day));
  }
  /**
   * Danish days of a year: date -> {name, kind}. kind 'holiday' = public holiday (red day),
   * 'off' = customary day off (Grundlovsdag, Juleaften, Nytårsaften), 'special' = marked only.
   */
  const dkCache = new Map();
  function dkDays(y) {
    if (dkCache.has(y)) return dkCache.get(y);
    const E = easter(y), out = {};
    const put = (date, name, kind) => { if (out[date]) { out[date].name += ' · ' + name; if (kind === 'holiday' || (kind === 'off' && out[date].kind === 'special')) out[date].kind = kind; } else out[date] = { name, kind }; };
    const md = (m, d) => todayStr(new Date(y, m - 1, d));
    const nthSunday = (m, n) => { const first = new Date(y, m - 1, 1); const off = (7 - first.getDay()) % 7; return todayStr(new Date(y, m - 1, 1 + off + (n - 1) * 7)); };
    const lastSunday = (m) => { const last = new Date(y, m, 0); return todayStr(new Date(y, m - 1, last.getDate() - last.getDay())); };
    put(md(1, 1), 'Nytårsdag', 'holiday');
    put(addDays(E, -49), 'Fastelavn', 'special');
    put(md(2, 14), 'Valentinsdag', 'special');
    put(lastSunday(3), 'Sommertid', 'special');
    put(addDays(E, -7), 'Palmesøndag', 'special');
    put(addDays(E, -3), 'Skærtorsdag', 'holiday');
    put(addDays(E, -2), 'Langfredag', 'holiday');
    put(E, 'Påskedag', 'holiday');
    put(addDays(E, 1), '2. påskedag', 'holiday');
    put(md(5, 1), '1. maj', 'special');
    put(nthSunday(5, 2), 'Mors dag', 'special');
    put(addDays(E, 39), 'Kr. himmelfart', 'holiday');
    put(addDays(E, 49), 'Pinsedag', 'holiday');
    put(addDays(E, 50), '2. pinsedag', 'holiday');
    put(md(6, 5), 'Grundlovsdag · Fars dag', 'off');
    put(md(6, 23), 'Sankthans', 'special');
    put(lastSunday(10), 'Vintertid', 'special');
    put(md(10, 31), 'Halloween', 'special');
    put(md(11, 10), 'Mortensaften', 'special');
    put(md(12, 13), 'Lucia', 'special');
    put(md(12, 24), 'Juleaften', 'off');
    put(md(12, 25), 'Juledag', 'holiday');
    put(md(12, 26), '2. juledag', 'holiday');
    put(md(12, 31), 'Nytårsaften', 'off');
    dkCache.set(y, out);
    return out;
  }
  function dkDay(dateStr) { return dkDays(+dateStr.slice(0, 4))[dateStr] || null; }
  /** ISO 8601 week number. */
  function isoWeek(dateStr) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = new Date(Date.UTC(y, m - 1, d));
    const day = t.getUTCDay() || 7;
    t.setUTCDate(t.getUTCDate() + 4 - day);
    const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
    return Math.ceil(((t - y0) / 86400000 + 1) / 7);
  }

  function newNode(fields) {
    return Object.assign({
      id: uid(), parent: null, children: [], title: '', notes: '',
      stage: 0, weight: 1, crit: null, urg: null, deadline: null, lead: null,
      owner: null, stakeholders: [], budget: null, attachments: [], relates: [],
      collapsed: false, created: nowIso(), modified: nowIso(),
    }, fields || {});
  }

  /** Fresh edition with the category nodes only. */
  function newEdition(id, title, settings) {
    const nodes = {};
    const rootNode = newNode({ id: 'root', title: appName, kind: 'root' });
    nodes.root = rootNode;
    for (const c of (settings || defaultSettings()).categories) {
      if (c.archived) continue;
      const n = newNode({ id: 'cat-' + c.key, parent: 'root', kind: 'category', cat: c.key, title: c.name });
      nodes[n.id] = n;
      rootNode.children.push(n.id);
      addGroups(nodes, n, c.groups);
    }
    return { format: FORMAT, id, title: title || id, created: nowIso(), modified: nowIso(), basedOn: null, nodes, trash: [] };
  }

  function addGroups(nodes, cat, groups) {
    for (const g of groups || []) {
      const gid = cat.id + '-' + g.toLowerCase().replace(/[^a-z0-9]+/g, '');
      if (nodes[gid]) continue;
      nodes[gid] = newNode({ id: gid, parent: cat.id, kind: 'group', title: g });
      cat.children.push(gid);
    }
  }

  /** True when the node lives in the People category. */
  function inPeople(ed, id) {
    let n = ed.nodes[id];
    while (n && n.kind !== 'category' && n.kind !== 'root') n = ed.nodes[n.parent];
    return !!n && n.id === PEOPLE_CAT;
  }

  /**
   * Kind a new child of `parent` gets: People → group → person → task.
   * Outside People a group is a subcategory and its children are ordinary tasks.
   */
  function childKind(ed, parentId) {
    const p = ed.nodes[parentId];
    if (!p) return null;
    if (p.id === PEOPLE_CAT) return 'group';
    if (p.kind === 'group') return inPeople(ed, parentId) ? 'person' : null;
    return null; // ordinary task
  }

  function isTask(n) { return !n.kind; }

  /**
   * Make sure all active category nodes from settings exist in an edition (added at end if missing).
   * A deleted (archived) category disappears from an edition only when it is empty there, so older
   * editions keep their content and nothing is ever dropped silently.
   */
  function syncCategories(ed, settings) {
    const rootNode = ed.nodes.root;
    for (const c of settings.categories) {
      const id = 'cat-' + c.key;
      if (c.archived) {
        const n = ed.nodes[id];
        if (n) { n.title = c.name; if (!n.children.length) { delete ed.nodes[id]; rootNode.children = rootNode.children.filter(x => x !== id); } }
        continue;
      }
      if (!ed.nodes[id]) {
        ed.nodes[id] = newNode({ id, parent: 'root', kind: 'category', cat: c.key, title: c.name });
        rootNode.children.push(id);
        addGroups(ed.nodes, ed.nodes[id], c.groups);
      } else {
        ed.nodes[id].title = c.name;
      }
    }
    // order categories as in settings, keep unknown (removed-from-settings) ones at the end
    const order = settings.categories.filter(c => !c.archived).map(c => 'cat-' + c.key);
    const others = rootNode.children.filter(id => !order.includes(id));
    rootNode.children = order.filter(id => ed.nodes[id]).concat(others);
  }

  /** Repair structural problems so a damaged file can never crash the app. Returns list of fixes. */
  function validate(ed) {
    const fixes = [];
    if (!ed.nodes || typeof ed.nodes !== 'object') { ed.nodes = {}; fixes.push('nodes missing'); }
    if (!ed.nodes.root) { ed.nodes.root = newNode({ id: 'root', title: appName, kind: 'root' }); fixes.push('root missing'); }
    if (!Array.isArray(ed.trash)) ed.trash = [];
    const seen = new Set();
    const walk = (id) => {
      const n = ed.nodes[id];
      seen.add(id);
      const kids = [];
      for (const c of n.children || []) {
        if (!ed.nodes[c] || seen.has(c)) { fixes.push('dropped bad child ' + c); continue; }
        ed.nodes[c].parent = id;
        kids.push(c);
        walk(c);
      }
      n.children = kids;
      for (const k of ['stakeholders', 'attachments', 'relates']) if (!Array.isArray(n[k])) n[k] = [];
      if (n.end != null && (!n.deadline || !/^\d{4}-\d{2}-\d{2}$/.test(n.end) || n.end <= n.deadline)) { delete n.end; }
      if (n.timeline != null) {
        if (!Array.isArray(n.timeline)) { delete n.timeline; fixes.push('bad timeline on ' + id); }
        else n.timeline = n.timeline.filter(s => s && typeof s === 'object' && /^\d{4}-\d{2}-\d{2}$/.test(s.date || '')).map(s => {
          const o = { id: s.id || uid(), title: String(s.title || ''), date: s.date, done: !!s.done };
          const td = Array.isArray(s.todos) ? s.todos.filter(x => x && typeof x === 'object' && String(x.text || '').trim()).map(x => ({ id: x.id || uid(), text: String(x.text), done: !!x.done })) : [];
          if (td.length) o.todos = td;
          return o;
        });
      }
      if (typeof n.stage !== 'number') n.stage = 0;
      n.stage = Math.max(0, Math.min(STAGE_MAX, Math.round(n.stage)));
    };
    ed.nodes.root.parent = null;
    walk('root');
    for (const id of Object.keys(ed.nodes)) {
      if (!seen.has(id)) {
        // orphan: re-attach to root so nothing is lost silently
        const n = ed.nodes[id];
        n.parent = 'root';
        ed.nodes.root.children.push(id);
        fixes.push('re-attached orphan ' + id);
        walk(id);
      }
    }
    return fixes;
  }

  // ---------- dates ----------
  function todayStr(d) {
    d = d || new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function daysUntil(dateStr, today) {
    if (!dateStr) return null;
    const [y, m, d] = dateStr.split('-').map(Number);
    const t = today ? new Date(today + 'T00:00:00') : new Date(todayStr() + 'T00:00:00');
    const target = new Date(y, m - 1, d);
    return Math.round((target - t) / 86400000);
  }

  function addDays(dateStr, n) {
    const [y, m, d] = dateStr.split('-').map(Number);
    return todayStr(new Date(y, m - 1, d + n));
  }
  /** Steps in date order (stable for equal dates). */
  function sortSteps(list) {
    return list.map((s, i) => [s, i]).sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1])).map(x => x[0]);
  }

  /**
   * Read a quick-entry line for a timeline step, e.g.
   *   "1 Dec Abstracts collected", "Abstracts collected 1/12", "2026-12-01 Print",
   *   "-14 Abstracts" (14 days before the deadline), "-2w Call for posters", "3 days before: Print",
   *   "+5 Book room" / "in 2 weeks Book room" (from today), "fri Send reminder", "tomorrow Order boards",
   *   "deadline Poster session".
   * ctx: { deadline: 'YYYY-MM-DD' | null, today: 'YYYY-MM-DD' }.
   * Returns { date, title, how } or { error }.
   */
  const MONTHS = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, maj: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, okt: 10, nov: 11, dec: 12 };
  const WDAYS = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  function parseStep(text, ctx) {
    ctx = ctx || {};
    const today = ctx.today || todayStr();
    const dl = ctx.deadline || null;
    const unit = (u) => (!u || /^d/i.test(u) ? 1 : /^w/i.test(u) ? 7 : /^m/i.test(u) ? 30 : 1);
    const ymd = (y, m, d) => { const dt = new Date(y, m - 1, d); return dt.getMonth() === m - 1 ? todayStr(dt) : null; };
    // a day/month without year: the next such date (allowing a couple of months back for recent steps)
    const guessYear = (m, d) => {
      const ty = +today.slice(0, 4);
      for (const y of [ty, ty + 1]) { const s = ymd(y, m, d); if (s && daysUntil(s, today) >= -60) return s; }
      return ymd(ty + 1, m, d);
    };
    const mon = '(jan|feb|mar|apr|may|maj|jun|jul|aug|sep|oct|okt|nov|dec)(?:uary|ruary|ch|il|e|y|ust|t|tember|ober|ember)?\\.?';
    const U = '(d|days?|w|wks?|weeks?|m|mo|months?)';
    const back = (m) => dl ? { date: addDays(dl, -m[1] * unit(m[2])), how: m[1] * unit(m[2]) + ' days before the deadline' } : { error: 'Set a deadline first to count back from it (or type a date).' };
    const fwd = (m) => ({ date: addDays(today, +m[1] * unit(m[2])), how: 'in ' + m[1] * unit(m[2]) + ' days' });
    const rules = [
      { re: '(\\d{4})-(\\d{1,2})-(\\d{1,2})', f: (m) => ({ date: ymd(+m[1], +m[2], +m[3]) }) },
      { re: '(\\d{1,2})[./](\\d{1,2})(?:[./](\\d{2,4}))?', f: (m) => ({ date: m[3] ? ymd(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]) : guessYear(+m[2], +m[1]) }) },
      { re: '(\\d{1,2})\\.?\\s+' + mon + '(?:\\s+(\\d{4}))?', f: (m) => ({ date: m[3] ? ymd(+m[3], MONTHS[m[2].toLowerCase()], +m[1]) : guessYear(MONTHS[m[2].toLowerCase()], +m[1]) }) },
      { re: mon + '\\s+(\\d{1,2})(?:,?\\s+(\\d{4}))?', f: (m) => ({ date: m[3] ? ymd(+m[3], MONTHS[m[1].toLowerCase()], +m[2]) : guessYear(MONTHS[m[1].toLowerCase()], +m[2]) }) },
      { re: '-\\s*(\\d+)\\s*' + U + '?', f: back },
      { re: '(\\d+)\\s*' + U + '\\s+before', f: back },
      { re: '\\+\\s*(\\d+)\\s*' + U + '?', f: fwd },
      { re: 'in\\s+(\\d+)\\s*' + U, f: fwd },
      { re: '(today|i dag)', f: () => ({ date: today }) },
      { re: '(tomorrow|i morgen)', f: () => ({ date: addDays(today, 1) }) },
      { re: '(?:on\\s+)?(deadline)', startOnly: true, f: () => dl ? { date: dl } : { error: 'There is no deadline yet.' } },
      { re: '(?:next\\s+)?(sun|mon|tue|wed|thu|fri|sat)(?:day|s|sday|nesday|rs|rsday|urday)?', f: (m) => { const t = new Date(today + 'T00:00:00'); let k = (WDAYS[m[1].toLowerCase()] - t.getDay() + 7) % 7; if (k === 0) k = 7; return { date: addDays(today, k) }; } },
    ];
    const s = String(text || '').trim();
    if (!s) return { error: 'Type a date and what should be ready.' };
    for (const r of rules) {
      for (const where of r.startOnly ? ['start'] : ['start', 'end']) {
        const re = new RegExp(where === 'start' ? '^' + r.re + '(?=$|[\\s:,–-])' : '(?:^|\\s)' + r.re + '\\s*$', 'i');
        const m = re.exec(s);
        if (!m) continue;
        const v = r.f(m);
        if (v.error) return v;
        if (!v.date) return { error: 'That date does not exist.' };
        const rest = (where === 'start' ? s.slice(m[0].length) : s.slice(0, m.index)).replace(/^[\s:,–-]+|[\s:,–-]+$/g, '');
        return { date: v.date, title: rest, how: v.how || null };
      }
    }
    return { error: 'No date found — start or end with e.g. “1 Dec”, “1/12”, “-14” (days before the deadline) or “+7” (from today).' };
  }

  /** A to-do line under a step: "- text" (also • * – and "[ ]"). "-14 …" (no space) stays a date. */
  function parseTodo(line) { const m = /^\s*(?:[-–—•*▪◦]|\[\s?\])\s+(\S.*)$/.exec(String(line || '')); return m ? m[1].trim() : null; }
  /**
   * Several quick-entry lines: a date line starts a step, the "- …" lines below it are its to-dos, e.g.
   *   17/02/27
   *   - take care of this
   *   - take care of that
   * To-do lines before any date line belong to an existing step ({attach: true}).
   * Returns [{line, date, title, how, todos: [text], attach?, error?}].
   */
  function parseSteps(text, ctx) {
    const out = [];
    let cur = null;
    for (const raw of String(text || '').split(/\r?\n/)) {
      const line = raw.trim();
      if (!line || /^(?:[-–—•*▪◦]|\[\s?\])$/.test(line)) continue;   // empty or a bullet still being typed
      const td = parseTodo(raw);
      if (td != null) {
        if (!cur) { cur = { line, attach: true, todos: [] }; out.push(cur); }
        cur.todos.push(td);
        continue;
      }
      const r = parseStep(line, ctx);
      cur = r.error ? { line, error: r.error, todos: [] } : { line, date: r.date, title: r.title, how: r.how, todos: [] };
      out.push(cur);
    }
    for (const x of out) if (!x.error && !x.attach && !x.title && !x.todos.length) x.error = 'Write what should be ready — or list to-dos below it, each line starting with “- ”.';
    return out;
  }
  /** A step's name for lists, reminders and the calendar: its title, else its first to-do. */
  function stepTitle(s) {
    if (s.title) return s.title;
    const td = s.todos || [];
    if (!td.length) return 'Step';
    const open = td.filter(x => !x.done);
    const first = (open[0] || td[0]).text;
    return first + (td.length > 1 ? ' (+' + (td.length - 1) + ')' : '');
  }

  /**
   * Compute derived values for every node in one pass.
   * Returns Map id -> {progress, crit, critOwn, urg, urgOwn, urgBase, deadline, deadlineOwn,
   *   days, overdue, late (deadline after parent's), budget:{cur:{alloc,spent}}, leaf, depth, cat, done}
   */
  function derive(ed, settings, today) {
    const out = new Map();
    const tday = today || todayStr();
    const defLead = (settings && settings.defaultLead) || DEFAULT_LEAD;
    const N = ed.nodes;

    function down(id, inh, depth, cat) {
      const n = N[id];
      const d = { leaf: n.children.length === 0 && !n.kind, depth, cat: n.cat || cat };
      d.critOwn = n.crit != null; d.crit = n.crit != null ? n.crit : inh.crit;
      d.end = n.deadline && n.end && n.end > n.deadline ? n.end : null;   // own period: deadline = start
      d.urgOwn = n.urg != null; d.urgBase = n.urg != null ? n.urg : inh.urg;
      d.deadlineOwn = !!n.deadline; d.deadline = n.deadline || inh.deadline;
      d.lead = n.lead != null ? n.lead : inh.lead;
      d.late = !!(n.deadline && inh.deadline && n.deadline > inh.deadline);
      out.set(id, d);
      const next = { crit: d.crit, urg: d.urgBase, deadline: d.deadline, lead: d.lead };
      for (const c of n.children) down(c, next, depth + 1, d.cat);
    }
    down('root', { crit: null, urg: null, deadline: null, lead: defLead }, 0, null);

    function up(id) {
      const n = N[id];
      const d = out.get(id);
      const budget = {};
      if (n.children.length === 0) {
        d.progress = (d.leaf ? n.stage : 0) / STAGE_MAX;
        if (!d.leaf) d.progress = null; // empty category / root
      } else {
        let wsum = 0, psum = 0;
        for (const c of n.children) {
          up(c);
          const cd = out.get(c);
          if (cd.progress == null) continue;
          const w = N[c].weight > 0 ? N[c].weight : 1;
          wsum += w; psum += w * cd.progress;
          for (const [cur, b] of Object.entries(cd.budget)) {
            budget[cur] = budget[cur] || { alloc: 0, spent: 0 };
            budget[cur].alloc += b.alloc; budget[cur].spent += b.spent;
          }
        }
        d.progress = wsum ? psum / wsum : null;
      }
      d.childBudget = Object.keys(budget).length ? budget : null;
      if (n.budget && (n.budget.alloc != null || n.budget.spent != null)) {
        const cur = n.budget.cur || (settings && settings.currency) || 'DKK';
        d.budget = { [cur]: { alloc: +n.budget.alloc || 0, spent: +n.budget.spent || 0 } };
        d.budgetOwn = true;
      } else {
        d.budget = budget;
        d.budgetOwn = false;
      }
      d.done = d.progress != null && d.progress >= 0.9999;
      // deadline ramp
      d.days = d.deadline ? daysUntil(d.deadline, tday) : null;
      let ramp = 0;
      if (d.end) {   // a period: ramps towards its start, 'now' while it runs, never overdue
        d.endDays = daysUntil(d.end, tday);
        d.now = d.days <= 0 && d.endDays >= 0;
        d.ended = d.endDays < 0;
      }
      if (d.days != null && !d.done && !d.ended) {
        if (d.now) ramp = 2;
        else if (d.days <= FINAL_DAYS) ramp = 3; else if (d.days <= (d.lead != null ? d.lead : defLead)) ramp = 2;
      }
      d.overdue = d.days != null && d.days < 0 && !d.done && !d.end;
      // timeline steps (dated milestones towards the deadline)
      if (n.timeline && n.timeline.length && n.kind !== 'info') {
        const tl = { n: n.timeline.length, done: 0, late: 0, next: null };
        for (const s of sortSteps(n.timeline)) {
          if (s.done) { tl.done++; continue; }
          const days = daysUntil(s.date, tday);
          if (days < 0) tl.late++;
          if (!tl.next) tl.next = { id: s.id, title: stepTitle(s), date: s.date, days };   // earliest open step
        }
        d.tl = tl;
        // a missed step makes the task very urgent; a step within the final days makes it urgent
        if (!d.done && tl.next) {
          const r = tl.late ? 3 : tl.next.days <= FINAL_DAYS ? 2 : 0;
          if (r > ramp) { ramp = r; d.stepRamp = true; }
        }
      }
      d.urg = Math.max(d.urgBase || 0, ramp) || null;
      d.ramped = ramp > (d.urgBase || 0);
    }
    up('root');
    return out;
  }

  /** Path of titles from category down to node. */
  function pathTitles(ed, id) {
    const t = [];
    let n = ed.nodes[id];
    while (n && n.kind !== 'root') { t.unshift(n.title || '(untitled)'); n = ed.nodes[n.parent]; }
    return t;
  }

  function isAncestor(ed, a, b) { // is a an ancestor of b (or equal)
    let n = ed.nodes[b];
    while (n) { if (n.id === a) return true; n = ed.nodes[n.parent]; }
    return false;
  }

  function subtreeIds(ed, id, acc) {
    acc = acc || [];
    acc.push(id);
    for (const c of ed.nodes[id].children) subtreeIds(ed, c, acc);
    return acc;
  }

  /** Items worth notifying / listing: open nodes with effective urgency ≥2 from deadline, overdue. */
  function dueItems(ed, settings, today) {
    const der = derive(ed, settings, today);
    const items = [];
    for (const [id, d] of der) {
      const n = ed.nodes[id];
      if (n.kind) continue;
      if (d.done) continue;
      if (!d.deadlineOwn) continue; // only report the node that carries the deadline
      if (d.days == null) continue;
      if (d.end) {   // period: while it runs, or as its start approaches; never after it ended
        if (!d.ended && (d.now || d.urg >= 2)) items.push({ id, title: n.title, path: pathTitles(ed, id), days: Math.max(0, d.days), deadline: d.deadline, end: d.end, range: true, now: d.now, urg: d.urg, crit: d.crit, overdue: false, cat: d.cat });
        continue;
      }
      if (d.overdue || d.urg >= 2) items.push({ id, title: n.title, path: pathTitles(ed, id), days: d.days, deadline: d.deadline, urg: d.urg, crit: d.crit, overdue: d.overdue, cat: d.cat });
    }
    // timeline steps: missed ones, and those due within a week
    for (const [id, d] of der) {
      const n = ed.nodes[id];
      if (!n.timeline || !n.timeline.length || d.done || n.kind === 'info') continue;
      for (const s of n.timeline) {
        if (s.done) continue;
        const days = daysUntil(s.date, today);
        if (days > 7) continue;
        const title = stepTitle(s) + ' — ' + (n.title || '(untitled)');
        items.push({ id, step: s.id, title, path: pathTitles(ed, id).concat(title), days, deadline: s.date, urg: days <= FINAL_DAYS ? 3 : 2, crit: d.crit, overdue: days < 0, cat: d.cat });
      }
    }
    items.sort((a, b) => a.days - b.days);
    return items;
  }

  /**
   * Make a new edition from `src`.
   * mode: 'scratch' | 'branches' | 'copy'. include: Set of node ids picked (branches mode; a picked
   * node brings its ancestors along). dropDone: leave out finished tasks. Node ids are kept so a
   * task can be followed across editions. The People branch (groups + persons) always carries over.
   */
  function makeEdition(src, o, settings) {
    const ed = newEdition(o.id, o.title, settings);
    ed.basedOn = src ? src.id : null;
    ed.mode = o.mode;
    if (!src) return ed;
    const der = o.dropDone ? derive(src, settings) : null;
    const keep = new Set();
    const keepWithAncestors = (id) => { let n = src.nodes[id]; while (n && !keep.has(n.id)) { keep.add(n.id); n = src.nodes[n.parent]; } };
    // From scratch: o.structure = 'current' (keep the subcategories), 'none' (bare categories) or a template object
    const scratchSkipsGroups = o.mode === 'scratch' && o.structure && o.structure !== 'current';
    for (const id of Object.keys(src.nodes)) {
      const n = src.nodes[id];
      if (n.kind === 'group' && scratchSkipsGroups && !inPeople(src, id)) continue;
      if (n.kind && n.kind !== 'info') { keepWithAncestors(id); continue; }       // categories, groups, persons (info notes travel like tasks)
      if (o.mode === 'copy') { keep.add(id); continue; }
      if (o.mode === 'branches' && o.include && o.include.has(id)) keepWithAncestors(id);
    }
    if (der) for (const id of [...keep]) { const n = src.nodes[id]; if (!n.kind && der.get(id) && der.get(id).done) keep.delete(id); }
    // items the user chose not to carry over (e.g. past their date); their subtrees go with them
    if (o.exclude) for (const id of o.exclude) keep.delete(id);
    // a kept node whose parent was dropped (finished) is dropped too
    const alive = (id) => { let n = src.nodes[id]; while (n) { if (!keep.has(n.id)) return false; n = src.nodes[n.parent]; } return true; };
    const nodes = {};
    for (const id of keep) if (alive(id)) nodes[id] = JSON.parse(JSON.stringify(src.nodes[id]));
    for (const id of Object.keys(nodes)) {
      const n = nodes[id];
      n.children = n.children.filter(c => nodes[c]);
      n.relates = (n.relates || []).filter(r => nodes[r]);
    }
    // categories present in settings but not in src are added by syncCategories
    const out = Object.assign(ed, { nodes });
    syncCategories(out, settings);
    validate(out);
    if (o.structure && typeof o.structure === 'object') applyStructure(out, o.structure);
    return out;
  }

  /**
   * Structure template: the subcategory tree (groups) under each category, without tasks or persons.
   * { cats: { <catKey>: [ {id, title, children:[...]} ] } }
   */
  function extractStructure(ed) {
    const cats = {};
    const walk = (id) => ed.nodes[id].children
      .filter(c => ed.nodes[c] && ed.nodes[c].kind === 'group')
      .map(c => ({ id: c, title: ed.nodes[c].title, children: walk(c) }));
    for (const cid of ed.nodes.root.children) {
      const c = ed.nodes[cid];
      if (!c || c.kind !== 'category') continue;
      const g = walk(cid);
      if (g.length) cats[c.cat] = g;
    }
    return { cats };
  }
  function countStructure(tpl) {
    let n = 0;
    const walk = (arr) => { for (const g of arr) { n++; walk(g.children || []); } };
    for (const k of Object.keys(tpl.cats || {})) walk(tpl.cats[k]);
    return n;
  }
  /** Add a template's subcategories to an edition (reuses existing ones with the same id or title). */
  function applyStructure(ed, tpl) {
    const add = (parentId, list) => {
      const par = ed.nodes[parentId];
      for (const g of list || []) {
        let id = null;
        if (g.id && ed.nodes[g.id] && ed.nodes[g.id].parent === parentId) id = g.id;
        if (!id) id = par.children.find(c => ed.nodes[c] && ed.nodes[c].kind === 'group' && ed.nodes[c].title === g.title) || null;
        if (!id) {
          const n = newNode({ id: g.id && !ed.nodes[g.id] ? g.id : uid(), parent: parentId, kind: 'group', title: g.title });
          ed.nodes[n.id] = n;
          let i = 0; while (i < par.children.length && ed.nodes[par.children[i]] && ed.nodes[par.children[i]].kind === 'group') i++;
          par.children.splice(i, 0, n.id);
          id = n.id;
        }
        add(id, g.children);
      }
    };
    for (const key of Object.keys(tpl.cats || {})) if (ed.nodes['cat-' + key]) add('cat-' + key, tpl.cats[key]);
    return ed;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  const api = { FORMAT, STAGES, STAGE_MAX, DEFAULT_LEAD, FINAL_DAYS, DEFAULT_CATEGORIES, PEOPLE_CAT, setStartCategories, setAppName, getAppName, addGroups, childKind, inPeople, isTask, makeEdition, extractStructure, countStructure, applyStructure, uid, nowIso, defaultSettings, newNode, newEdition, syncCategories, validate, todayStr, daysUntil, addDays, sortSteps, parseStep, parseTodo, parseSteps, stepTitle, easter, dkDays, dkDay, isoWeek, DTU_PERIODS, derive, pathTitles, isAncestor, subtreeIds, dueItems, escapeHtml };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.OTTModel = api;
})(typeof self !== 'undefined' ? self : this);
