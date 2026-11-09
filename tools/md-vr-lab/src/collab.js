// Together: one more person in the lab. Transport = Supabase Realtime *broadcast* (no database, no presence API: this file does its own
// "hi" heartbeats), or a BroadcastChannel between two tabs of the same browser for testing without any server.
// Roles: the first person in a room is the HOST (runs the simulation); the second is the GUEST (sees it). A third is turned away.
// newer versions first (the new sb_publishable_ keys need a recent client), older ones as a fallback if a file cannot be loaded
const SB_LIBS = ['2.58.0', '2.50.0', '2.45.4'].map((v) => `https://cdn.jsdelivr.net/npm/@supabase/supabase-js@${v}/dist/umd/supabase.min.js`);
const uid = () => Math.random().toString(36).slice(2, 8);
const NAMES = ['Atom', 'Quark', 'Boson', 'Photon', 'Lattice', 'Orbital', 'Phonon', 'Graphene', 'Fermion', 'Muon'];

// The online link has a sundown date: after `expires` (YYYY-MM-DD, valid through the end of that day, UTC) the page no longer opens online rooms.
// (This is a courtesy check in the page. To really revoke access, rotate or pause the key in the Supabase dashboard.)
function read() {
  let c = (typeof window !== 'undefined' && window.MDLAB_SB) || {};
  try {
    const q = new URLSearchParams(location.search);
    if (q.get('sburl') && q.get('sbkey')) localStorage.setItem('mdlab.sb', JSON.stringify({ url: q.get('sburl'), key: q.get('sbkey'), expires: q.get('sbexp') || '' }));
    const st = JSON.parse(localStorage.getItem('mdlab.sb') || '{}'); if (st.url && st.key) c = st;
  } catch (e) { /* no storage */ }
  return c.url && c.key ? c : null;
}
export function sbExpired() {                                              // the sundown date if it has passed, else ''
  const c = read(); if (!c || !c.expires) return '';
  const end = Date.parse(c.expires + 'T23:59:59Z'); return Number.isFinite(end) && Date.now() > end ? c.expires : '';
}
export function sbConfig() { const c = read(); return c && !sbExpired() ? c : null; }
export function sbExpires() { const c = read(); return c && c.expires && !sbExpired() ? c.expires : ''; }
export function saveSbConfig(url, key) { try { localStorage.setItem('mdlab.sb', JSON.stringify({ url, key, expires: '' })); } catch (e) { /* no storage */ } }
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
    const cfg = sbConfig(); if (!cfg) throw new Error(sbExpired() ? 'The online link expired on ' + sbExpired() : 'no Supabase project set');
    for (const src of SB_LIBS) {
      if (window.supabase) break;
      await new Promise((res) => { const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => { s.remove(); res(); }; document.head.appendChild(s); });
    }
    if (!window.supabase) throw new Error('could not load the Supabase library (is the network blocking cdn.jsdelivr.net?)');
    this.client = window.supabase.createClient(cfg.url, cfg.key, { realtime: { params: { eventsPerSecond: 60 } } });
    this.ch = this.client.channel('mdlab:' + room, { config: { broadcast: { self: false, ack: false } } });
    this.ch.on('broadcast', { event: '*' }, (m) => onmsg(m.event, m.payload));
    await new Promise((res, rej) => { const t = setTimeout(() => rej(new Error('timed out')), 12000); this.ch.subscribe((st) => { if (st === 'SUBSCRIBED') { clearTimeout(t); res(); } else if (st === 'CHANNEL_ERROR' || st === 'TIMED_OUT') { clearTimeout(t); rej(new Error('channel ' + st)); } }); });
  }
  send(ev, p) { this.ch.send({ type: 'broadcast', event: ev, payload: p }); }
  close() { try { this.client.removeChannel(this.ch); } catch (e) { /* closed */ } }
}

const FAST = new Set(['pose', 'snap', 'vel', 'plots', 'ack']);                   // high-rate events: sent over the direct (WebRTC) link when there is one

export class Collab {
  constructor() { this.id = uid(); this.name = defaultName(); this.state = 'off'; this.role = 'host'; this.admin = false; this.epoch = 0; this.peers = new Map(); this.on = {}; this.room = ''; this.kind = 'local'; this.err = ''; this.onchange = null; this.settle = null; this.rtc = null; }
  get connected() { return this.state === 'on'; }
  get guest() { return this.state === 'on' && this.role === 'guest'; }
  get other() { for (const p of this.peers.values()) return p; return null; }              // at most one
  get link() { return this.rtc && this.rtc.open ? 'direct' : 'relay'; }
  async join(room, kind) {
    if (this.state !== 'off') return; this.state = 'joining'; this.err = ''; this.room = room; this.kind = kind; this.role = 'host'; this.admin = false; this.epoch = 0; this.peers.clear();
    this._changed(); this.tr = kind === 'supabase' ? new SupabaseTransport() : new LocalTransport();
    try { await this.tr.open(room, (ev, p) => this.handle(ev, p)); } catch (e) { this.state = 'off'; this.err = e.message || String(e); this._changed(); return; }
    this.state = 'on'; this.settle = setTimeout(() => { this.settle = null; const o = this.other; if (this.role === 'host' && !(o && o.admin)) this.admin = true; this._hi(false); this._changed(); }, 1300); this._hi(false);
    this.timer = setInterval(() => { this._hi(false); const t = Date.now(); for (const [id, p] of [...this.peers]) if (t - p.last > 6000) this._gone(id); }, 1500);
    this._changed();
  }
  leave() {
    if (this.state === 'off') return; try { this.send('bye', {}); } catch (e) { /* closed */ }
    clearInterval(this.timer); clearTimeout(this.settle); this.settle = null; this._rtcClose(); this.tr.close(); const wasGuest = this.role === 'guest', had = this.peers.size > 0;
    this.state = 'off'; this.peers.clear(); this.role = 'host'; this.admin = false; this._changed(); if (had || wasGuest) this.fire('left', { wasGuest });
  }
  setRole(role, epoch) { this.role = role; if (epoch !== undefined) this.epoch = epoch; this._hi(false); this._changed(); }
  send(ev, p = {}) {
    if (this.state !== 'on') return; p.from = this.id;
    if (FAST.has(ev) && this.rtc && this.rtc.open && this.rtc.dc.bufferedAmount < 400000) { try { this.rtc.dc.send(JSON.stringify({ ev, p })); return; } catch (e) { /* fall back to the relay */ } }
    this.tr.send(ev, p);
  }
  _hi(reply) { this.send('hi', { name: this.name, role: this.role, settled: !this.settle, reply: !!reply, admin: this.admin, epoch: this.epoch }); }
  fire(ev, p) { const f = this.on[ev]; if (f) f(p); }
  _changed() { if (this.onchange) this.onchange(); }
  _gone(id) {
    const peer = this.peers.get(id); if (!peer) return; this.peers.delete(id); const wasGuest = this.role === 'guest'; this._rtcClose();
    if (!this.peers.size) { this.role = 'host'; this.admin = true; } this._changed(); this.fire('left', { peer, wasGuest });
  }
  handle(ev, p) {
    if (!p || p.from === this.id || this.state !== 'on') return;
    if (ev === 'hi') {
      let peer = this.peers.get(p.from), fresh = false;
      if (!peer) {
        if (this.peers.size >= 1) { if (this.role === 'host' && !this.settle) this.send('full', { to: p.from }); return; }          // a third person
        peer = { id: p.from, last: 0 }; this.peers.set(p.from, peer); fresh = true; if (!p.reply) this._hi(true);                       // answer the newcomer
      }
      peer.name = p.name; peer.role = p.role; peer.admin = !!p.admin; peer.epoch = p.epoch || 0; peer.last = Date.now();
      if (this.role === 'host' && p.role === 'host') {                                                                                 // two hosts: the newer handover, then the settled one, then the lower id stays
        const mine = !this.settle, theirs = !!p.settled;
        if ((p.epoch || 0) > this.epoch || ((p.epoch || 0) === this.epoch && ((theirs && !mine) || (theirs === mine && p.from < this.id)))) this.role = 'guest';
      }
      this._changed(); if (fresh) { this.fire('joined', peer); this._startRtc(peer); } return;
    }
    if (ev === 'full') { if (p.to === this.id) { this.leave(); this.err = 'This room already has two people'; this._changed(); } return; }
    if (ev === 'bye') { this._gone(p.from); return; }
    if (ev === 'rtc') { this._rtcSignal(p); return; }
    const peer = this.peers.get(p.from); if (peer) peer.last = Date.now();
    const f = this.on[ev]; if (f) f(p);
  }
  // ---- direct link: a WebRTC data channel (unordered, short-lived packets), signalled over the same broadcast channel; the relay stays as the fallback ----
  _startRtc(peer) {
    if (this.rtc || typeof RTCPeerConnection === 'undefined') return;
    const init = this.id < peer.id, pc = new RTCPeerConnection({ iceServers: [{ urls: 'stun:stun.l.google.com:19302' }] }), r = this.rtc = { pc, dc: null, open: false, peer: peer.id, q: [], remote: false };
    pc.onicecandidate = (e) => { if (e.candidate) this.send('rtc', { to: peer.id, kind: 'ice', c: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => { if (['failed', 'closed'].includes(pc.connectionState)) this._rtcClose(); };
    const setup = (dc) => { r.dc = dc; dc.onopen = () => { r.open = true; this._changed(); }; dc.onclose = () => { r.open = false; this._changed(); }; dc.onmessage = (e) => { try { const m = JSON.parse(e.data); if (this.state !== 'on' || !m || !m.p || m.p.from === this.id) return; const pe = this.peers.get(m.p.from); if (pe) pe.last = Date.now(); const h = this.on[m.ev]; if (h) h(m.p); } catch (x) { /* bad packet */ } }; };
    if (init) {
      setup(pc.createDataChannel('fast', { ordered: false, maxPacketLifeTime: 250 }));
      pc.createOffer().then((o) => pc.setLocalDescription(o)).then(() => this.send('rtc', { to: peer.id, kind: 'offer', sdp: { type: pc.localDescription.type, sdp: pc.localDescription.sdp } })).catch(() => this._rtcClose());
    } else pc.ondatachannel = (e) => setup(e.channel);
    r.timer = setTimeout(() => { if (!r.open) this._rtcClose(); }, 12000);
  }
  async _rtcSignal(p) {
    if (p.to !== this.id) return; if (!this.rtc) { const peer = this.peers.get(p.from); if (peer) this._startRtc(peer); } const r = this.rtc; if (!r) return;
    try {
      if (p.kind === 'ice') { if (r.remote) await r.pc.addIceCandidate(p.c); else r.q.push(p.c); return; }
      await r.pc.setRemoteDescription(p.sdp); r.remote = true; for (const c of r.q.splice(0)) await r.pc.addIceCandidate(c);
      if (p.kind === 'offer') { const a = await r.pc.createAnswer(); await r.pc.setLocalDescription(a); this.send('rtc', { to: p.from, kind: 'answer', sdp: { type: a.type, sdp: a.sdp } }); }
    } catch (e) { /* the relay keeps working */ }
  }
  _rtcClose() { const r = this.rtc; if (!r) return; this.rtc = null; clearTimeout(r.timer); try { r.dc && r.dc.close(); r.pc.close(); } catch (e) { /* closed */ } this._changed(); }
}
