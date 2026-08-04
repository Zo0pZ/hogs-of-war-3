/* ================= ONLINE PLAY: THE WIRE =================

   One player hosts. Everybody else connects to them by room code, so the host's
   machine is the hub and guests never need to find each other. That keeps the
   topology simple (N-1 connections rather than N*(N-1)/2) and gives us an
   obvious authority for anything that has to be decided once — who goes first,
   what the wind is doing, what the CPU squads intend.

   Transport is WebRTC via PeerJS's public broker. The broker only introduces
   the two browsers; once they are talking, the game data goes directly between
   them and never touches a server. That is what lets this ship as a static page
   on GitHub Pages with nothing to run or pay for.

   The room code is deliberately short and unambiguous — no O/0 or I/1 — because
   somebody is going to read it down the phone to a relative. */

import { Peer } from 'peerjs';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // no O/0, no I/1
const ID_PREFIX = 'hogs3-';            // namespaces us on the shared public broker
const CODE_LEN = 5;

export function makeRoomCode(){
  let s = '';
  for (let i = 0; i < CODE_LEN; i++)
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}
/* Accept whatever the player types: lower case, stray spaces, and the letters
   people habitually substitute for the digits we left out. */
export function normaliseCode(raw){
  return String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '')
    .replace(/O/g, '0').replace(/I/g, '1')       // fold to the digit...
    .replace(/0/g, 'O').replace(/1/g, 'I')       // ...then back, so both read the same
    .slice(0, CODE_LEN);
}

/* A tiny event emitter — smaller than pulling in a dependency for four methods. */
function emitter(){
  const map = new Map();
  return {
    on(ev, fn){ (map.get(ev) || map.set(ev, []).get(ev)).push(fn); return this; },
    emit(ev, ...a){ for (const fn of (map.get(ev) || [])) { try { fn(...a); } catch(e){ console.error(e); } } },
  };
}

/* Both roles share this shape so the game can talk to "the net" without caring
   which end it is on. */
class Link {
  constructor(){
    Object.assign(this, emitter());
    this.peer = null;
    this.isHost = false;
    this.code = null;
    this.conns = new Map();     // guest id -> DataConnection (host only)
    this.hostConn = null;       // guest only
    this.slot = null;           // which player number we are
    this.closed = false;
  }
  /* Wire up the handlers every connection needs, whichever side it is. */
  _adopt(conn, who){
    conn.on('data', msg => {
      if (!msg || typeof msg !== 'object') return;
      this.emit('message', msg, who);
    });
    conn.on('close', () => {
      this.conns.delete(who);
      this.emit('peerleft', who);
    });
    conn.on('error', err => this.emit('neterror', err));
  }
  send(msg, to){
    if (this.isHost){
      if (to){ const c = this.conns.get(to); if (c && c.open) c.send(msg); }
      else for (const c of this.conns.values()) if (c.open) c.send(msg);
    } else if (this.hostConn && this.hostConn.open){
      this.hostConn.send(msg);
    }
  }
  /* Host: send to everyone except one player — used to echo a move back to the
     others without bouncing it to whoever made it. */
  sendExcept(msg, skip){
    if (!this.isHost) return;
    for (const [id, c] of this.conns) if (id !== skip && c.open) c.send(msg);
  }
  count(){ return this.isHost ? this.conns.size : (this.hostConn ? 1 : 0); }
  close(){
    this.closed = true;
    try { for (const c of this.conns.values()) c.close(); } catch(e){}
    try { if (this.hostConn) this.hostConn.close(); } catch(e){}
    try { if (this.peer) this.peer.destroy(); } catch(e){}
    this.peer = null; this.conns.clear(); this.hostConn = null;
  }
}

/* Open a room. Resolves once the broker has accepted our code, which is the
   point at which it is safe to read it out to anybody. */
export function host(){
  return new Promise((resolve, reject) => {
    const link = new Link();
    link.isHost = true;
    link.slot = 0;                       // the host is always player 1
    const code = makeRoomCode();
    const peer = new Peer(ID_PREFIX + code, { debug: 0 });
    link.peer = peer; link.code = code;

    const giveUp = setTimeout(() => {
      if (!link.code || link.closed) return;
      reject(new Error('Could not reach the matchmaking service. Check your connection and try again.'));
      link.close();
    }, 20000);

    peer.on('open', () => { clearTimeout(giveUp); resolve(link); });
    peer.on('connection', conn => {
      conn.on('open', () => {
        link.conns.set(conn.peer, conn);
        link._adopt(conn, conn.peer);
        link.emit('peerjoined', conn.peer);
      });
    });
    peer.on('error', err => {
      clearTimeout(giveUp);
      // the only error worth translating: somebody already holds this code
      if (err && String(err.type) === 'unavailable-id')
        reject(new Error('That room code is already taken — try again.'));
      else if (link.code && !link.closed) link.emit('neterror', err);
      else reject(err);
    });
  });
}

/* Join somebody else's room. */
export function join(rawCode){
  return new Promise((resolve, reject) => {
    const code = normaliseCode(rawCode);
    if (code.length !== CODE_LEN) { reject(new Error('A room code is ' + CODE_LEN + ' characters.')); return; }
    const link = new Link();
    link.isHost = false;
    link.code = code;
    const peer = new Peer({ debug: 0 });
    link.peer = peer;

    let settled = false;
    const giveUp = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error('No answer from room ' + code + '. Check the code, and that the host is still waiting.'));
      link.close();
    }, 20000);

    peer.on('open', () => {
      const conn = peer.connect(ID_PREFIX + code, { reliable: true });
      conn.on('open', () => {
        if (settled) return;
        settled = true; clearTimeout(giveUp);
        link.hostConn = conn;
        link._adopt(conn, 'host');
        resolve(link);
      });
      conn.on('error', err => {
        if (settled) return;
        settled = true; clearTimeout(giveUp);
        reject(new Error('Could not join room ' + code + '.'));
      });
    });
    peer.on('error', err => {
      if (settled) { link.emit('neterror', err); return; }
      settled = true; clearTimeout(giveUp);
      const t = String(err && err.type);
      reject(new Error(t === 'peer-unavailable'
        ? 'No room called ' + code + '. Check the code with whoever is hosting.'
        : 'Could not reach the matchmaking service.'));
    });
  });
}
