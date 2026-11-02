// Together: one more person in the lab. Transport = Supabase Realtime *broadcast* (no database, no presence API: this file does its own
// "hi" heartbeats), or a BroadcastChannel between two tabs of the same browser for testing without any server.
// Roles: the first person in a room is the HOST (runs the simulation); the second is the GUEST (sees it). A third is turned away.
const SB_LIB = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.min.js';
const uid = () => Math.random().toString(36).slice(2, 8);
const NAMES = ['Atom', 'Quark', 'Boson', 'Photon', 'Lattice', 'Orbital', 'Phonon', 'Graphene', 'Fermion', 'Muon'];

export function sbConfig() {
  let c = (typeof window !== 'undefined' && window.MDLAB_SB) || {};
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('sburl') && q.get('sbkey')) { localStorage.setItem('mdlab.sb', JSON.stringify({ url: q.get('sburl'), key: q.get('sbkey') })); }
    const st = JSON.parse(localStorage.getItem('mdlab.sb') || '{}'); if (st.url && st.key) c = st;
  } catch (e) { /* no storage */ }
  return c.url && c.key ? c : null;
}
export function saveSbConfig(url, key) { try { localStorage.setItem('mdlab.sb', JSON.stringify({ url, key })); } catch (e) { /* no storage */ } }
export function defaultName() {
  try { const n = localStorage.getItem('mdlab.name'); if (n) return n; } catch (e) { /* no storage */ }
  return NAMES[Math.floor(Math.random() * NAMES.length)] + '-' + Math.floor(Math.random() * 90 + 10);
}
export function saveName(n) { try { localStorage.setItem('mdlab.name', n); } catch (e) { /* no storage */ } }
export const roomCode = () => { const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ'; let s = ''; for (let i = 0; i < 4; i++) s += A[Math.floor(Math.random() * A.length)]; return s; };

class LocalTransport {
  async open(room, onmsg) { this.bc = new BroadcastChannel('mdlab:' + room); this.bc.onmessage = (e) => onmsg(e.data.ev, e.data.p); }
  send(ev, p) { this.bc.postMessage({ ev, p }); }
  close() { try { this.bc.close(); } catch (e) { /* closed */ } }
}
class SupabaseTransport {
  async open(room, onmsg) {
    const cfg = sbConfig(); if (!cfg) throw new Error('no Supabase project set');
    if (!window.supabase) await new Promise((res, rej) => { const s = document.createElement('script'); s.src = SB_LIB; s.onload = res; s.onerror = () => rej(new Error('could not load the Supabase library')); document.head.appendChild(s); });
    this.client = window.supabase.createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 60 } } });
    this.ch = this.client.channel('mdlab:' + room, { config: { broadcast: { self: false, ack: false } } });
    this.ch.on('broadcast', { event: '*' }, (m) => onmsg(m.event, m.payload));
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timed out')), 12000); this.ch.subscribe((st) => { if (st === 'SUBSCRIBED') { clearTimeout(t); res(); } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); rej(new Error('channel ' + st)); } }); });
  }
  send(ev, p) { this.ch.send({ type: 'broadcast', event: ev, payload: p }); }
  close() { try { this.client.removeChannel(this.ch); } catch (e) { /* closed */ } }
}

export class Collab {
  constructor() { this.id = uid(); this.name = defaultName(); this.state = 'off'; this.role = 'host'; this.peers = new Map(); this.on = {}; this.room = ''; this.kind = 'local'; this.err = ''; this.onchange = null; this.settle = null; }
  get connected() { return this.state === 'on'; }
  get guest() { return this.state === 'on' && this.role === 'guest'; }
  get other() { for (const p of this.peers.values()) return p; return null; }              // at most one
  async join(room, kind) {
    if (this.state !== 'off') return; this.state = 'joining'; this.err = ''; this.room = room; this.kind = kind; this.role = 'host'; this.peers.clear();
    this._changed(); this.tr = kind === 'supabase' ? new SupabaseTransport() : new LocalTransport();
    try { await this.tr.open(room, (ev, p) => this.handle(ev, p)); } catch (e) { this.state = 'off'; this.err = e.message || String(e); this._changed(); return; }
    this.state = 'on'; this.settle = setTimeout(() => { this.settle = null; this._changed(); }, 1300); this._hi(false);
    this.timer = setInterval(() => { this._hi(false); const t = Date.now(); for (const [id, p] of [...this.peers]) if (t - p.last > 6000) this._gone(id); }, 1500);
    this._changed();
  }
  leave() {
    if (this.state === 'off') return; try { this.send('bye', {}); } catch (e) { /* closed */ }
    clearInterval(this.timer); clearTimeout(this.settle); this.settle = null; this.tr.close(); const wasGuest = this.role === 'guest', had = this.peers.size > 0;
    this.state = 'off'; this.peers.clear(); this.role = 'host'; this._changed(); if (had || wasGuest) this.fire('left', { wasGuest });
  }
  send(ev, p = {}) { if (this.state !== 'on') return; p.from = this.id; this.tr.send(ev, p); }
  _hi(reply) { this.send('hi', { name: this.name, role: this.role, settled: !this.settle, reply: !!reply }); }
  fire(ev, p) { const f = this.on[ev]; if (f) f(p); }
  _changed() { if (this.onchange) this.onchange(); }
  _gone(id) {
    const peer = this.peers.get(id); if (!peer) return; this.peers.delete(id); const wasGuest = this.role === 'guest';
    if (!this.peers.size) this.role = 'host'; this._changed(); this.fire('left', { peer, wasGuest });
  }
  handle(ev, p) {
    if (!p || p.from === this.id || this.state !== 'on') return;
    if (ev === 'hi') {
      let peer = this.peers.get(p.from), fresh = false;
      if (!peer) {
        if (this.peers.size >= 1) { if (this.role === 'host' && !this.settle) this.send('full', { to: p.from }); return; }          // a third person
        peer = { id: p.from, last: 0 }; this.peers.set(p.from, peer); fresh = true; if (!p.reply) this._hi(true);                       // answer the newcomer
      }
      peer.name = p.name; peer.role = p.role; peer.last = Date.now();
      if (this.role === 'host' && p.role === 'host') {                                                                                 // both think they are host: the settled one stays, else the lower id
        const mine = !this.settle, theirs = !!p.settled; if ((theirs && !mine) || (theirs === mine && p.from < this.id)) this.role = 'guest';
      }
      this._changed(); if (fresh) this.fire('joined', peer); return;
    }
    if (ev === 'full') { if (p.to === this.id) { this.leave(); this.err = 'This room already has two people'; this._changed(); } return; }
    if (ev === 'bye') { this._gone(p.from); return; }
    const peer = this.peers.get(p.from); if (peer) peer.last = Date.now();
    const f = this.on[ev]; if (f) f(p);
  }
}
