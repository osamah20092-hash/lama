// Private sessions (جلسات خاصة): online tables between friends, friendly or with a coin stake.
// Modeled on how Baloot apps run them: the host creates a table with a short code, shares a
// link, joiners land in a waiting hall and the host seats them; an optional PIN locks the table;
// empty seats are filled by the computer when the game starts.
//
// Firestore layout (see firestore.rules):
//   rooms/{code}                 { code, hostUid, hostName, status, locked, hasPin, seats[4], state, createdAt }
//   rooms/{code}/members/{uid}   { name, pin, wantSeat, kicked, ts }     — the waiting hall
//   rooms/{code}/hands/{uid}     { seat, cards: [cardId] }               — readable by that player only
//   rooms/{code}/actions/{id}    { uid, seat, kind, action, cardId }     — moves sent to the host
//   rooms/{code}/private/config  { pin, engine }                         — host only
//
// The host's browser runs the authoritative BalootGame (including the bots) and publishes a
// public snapshot; every other player renders that snapshot and sends moves as actions.
import { fire, state as authState } from "./auth.js?v=11";
import { BalootGame, detectProjects } from "./engine.js?v=11";

const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I to avoid typos
export const BOT_NAMES = ["كمبيوتر ١", "كمبيوتر ٢", "كمبيوتر ٣"];

const roomRef = (code) => { const { db, fns } = fire(); return fns.doc(db, "rooms", code); };
const sub = (code, ...path) => { const { db, fns } = fire(); return fns.doc(db, "rooms", code, ...path); };
const col = (code, name) => { const { db, fns } = fire(); return fns.collection(db, "rooms", code, name); };

export function normalizeCode(s) { return (s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6); }

function genCode() {
  let s = "";
  for (let i = 0; i < 6; i++) s += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)];
  return s;
}

export function inviteLink(code) {
  return `${location.origin}${location.pathname}?room=${code}`;
}

// ---------- Lobby ----------
// options: { strict: force following suit/trumping, stake: coins each player puts in (0 = friendly) }
export async function createRoom({ pin = "", strict = true, stake = 0 } = {}) {
  const { db, fns } = fire();
  const me = authState.profile;
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = genCode();
    if ((await fns.getDoc(roomRef(code))).exists()) continue;
    const batch = fns.writeBatch(db);
    batch.set(roomRef(code), {
      code, hostUid: me.uid, hostName: me.name, status: "lobby", locked: false, hasPin: !!pin,
      seats: [{ uid: me.uid, name: me.name }, null, null, null],
      options: { strict, stake }, matchId: null,
      state: null, createdAt: fns.serverTimestamp(),
    });
    batch.set(sub(code, "private", "config"), { pin, engine: null });
    await batch.commit();
    return code;
  }
  throw new Error("code-collision");
}

export async function getRoom(code) {
  const { fns } = fire();
  const snap = await fns.getDoc(roomRef(code));
  return snap.exists() ? snap.data() : null;
}

// Enter the waiting hall. The host's browser validates the PIN and seats you.
export async function joinRoom(code, pin = "") {
  const { fns } = fire();
  const me = authState.profile;
  const ref = sub(code, "members", me.uid);
  const snap = await fns.getDoc(ref);
  if (snap.exists()) {
    if (snap.data().kicked) throw new Error("kicked");
    await fns.updateDoc(ref, { name: me.name, pin, pinWrong: false, ts: fns.serverTimestamp() });
  } else {
    await fns.setDoc(ref, { name: me.name, pin, wantSeat: null, kicked: false, ts: fns.serverTimestamp() });
  }
}

export async function leaveRoom(code) {
  const { fns } = fire();
  try { await fns.deleteDoc(sub(code, "members", authState.profile.uid)); } catch (_) { /* already gone */ }
}

export function requestSeat(code, seat) {
  const { fns } = fire();
  return fns.updateDoc(sub(code, "members", authState.profile.uid), { wantSeat: seat });
}

export function watchRoom(code, cb) {
  const { fns } = fire();
  return fns.onSnapshot(roomRef(code), (snap) => cb(snap.exists() ? snap.data() : null));
}

export function watchMyMember(code, cb) {
  const { fns } = fire();
  return fns.onSnapshot(sub(code, "members", authState.profile.uid), (snap) => cb(snap.exists() ? snap.data() : null));
}

export function watchMyHand(code, cb) {
  const { fns } = fire();
  return fns.onSnapshot(sub(code, "hands", authState.profile.uid), (snap) => {
    const d = snap.exists() ? snap.data() : null;
    cb(d ? { seat: d.seat, cards: d.cards.map(cardFromId), baloot: !!d.baloot } : null);
  });
}

// ---------- Host-only ----------
export function updateRoom(code, patch) {
  const { fns } = fire();
  return fns.updateDoc(roomRef(code), patch);
}

export function watchMembers(code, cb) {
  const { fns } = fire();
  return fns.onSnapshot(col(code, "members"), (q) => {
    const out = [];
    q.forEach((d) => out.push({ uid: d.id, ...d.data() }));
    cb(out);
  });
}

export function setMember(code, uid, patch) {
  const { fns } = fire();
  return fns.updateDoc(sub(code, "members", uid), patch);
}

export async function readConfig(code) {
  const { fns } = fire();
  const snap = await fns.getDoc(sub(code, "private", "config"));
  return snap.exists() ? snap.data() : { pin: "", engine: null };
}

export function setConfig(code, patch) {
  const { fns } = fire();
  return fns.updateDoc(sub(code, "private", "config"), patch);
}

export function watchActions(code, cb) {
  const { fns } = fire();
  return fns.onSnapshot(col(code, "actions"), (q) => {
    q.docChanges().forEach((ch) => { if (ch.type === "added") cb({ id: ch.doc.id, ...ch.doc.data() }); });
  });
}

export function deleteAction(code, id) {
  const { fns } = fire();
  return fns.deleteDoc(sub(code, "actions", id)).catch(() => {});
}

// One atomic write of the public snapshot + each human's private hand + the full engine (for resume).
export async function publish(code, game, seats, events) {
  const { db, fns } = fire();
  const batch = fns.writeBatch(db);
  // rev always changes the doc, so players get a snapshot even after a rejected move.
  batch.update(roomRef(code), { state: JSON.stringify({ ...publicState(game), events, rev: Date.now() }) });
  seats.forEach((s, i) => {
    if (s && !s.bot) batch.set(sub(code, "hands", s.uid), {
      seat: i, cards: game.hands[i].map((c) => c.id), baloot: game.phase === "playing" && game.balootSeat === i,
    });
  });
  batch.update(sub(code, "private", "config"), { engine: engineToJSON(game) });
  await batch.commit();
}

// ---------- Players ----------
export function sendAction(code, seat, move) {
  const { fns } = fire();
  return fns.addDoc(col(code, "actions"), { uid: authState.profile.uid, seat, ...move, ts: fns.serverTimestamp() });
}

// ---------- Game (de)serialization ----------
export function cardFromId(id) {
  const [rank, suit] = id.split("_");
  return { rank, suit, id };
}

const NOT_SAVED = new Set(["listeners", "rng"]);
export function engineToJSON(g) {
  const o = {};
  for (const k of Object.keys(g)) if (!NOT_SAVED.has(k)) o[k] = g[k];
  return JSON.stringify(o);
}
export function engineFromJSON(json) {
  const g = Object.assign(Object.create(BalootGame.prototype), JSON.parse(json));
  g.listeners = [];
  g.rng = Math.random;
  return g;
}

// Everything a player may see: no hands, deck or undeclared projects.
export function publicState(g) {
  const pub = {};
  for (const k of ["targetScore", "strict", "score", "dealer", "round", "phase", "mode", "trump", "declarer",
    "hokomBidder", "pendingTrump", "hokomRound", "multiplier", "gahwa", "locked", "doubler",
    "bidQueue", "bidTurn", "turn", "currentTrick", "flip", "lastRoundResult"]) pub[k] = g[k] ?? null;
  pub.handCounts = g.hands.map((h) => h.length);
  // The بلوت holder stays secret until they say it.
  pub.balootDeclared = !!g.balootDeclared;
  pub.balootSeat = g.balootDeclared ? g.balootSeat : null;
  pub.trickNo = g.tricks.length;
  // Declared projects are announced by type only; the cards stay hidden.
  pub.declared = g.projects.map((p) => ({ seat: p.seat, type: p.type }));
  // From the second trick the counted projects are shown to everyone, cards included.
  pub.shownProjects = g.tricks.length ? g.countedProjects().map((p) => ({ seat: p.seat, type: p.type, cards: p.cards })) : [];
  pub.lastTrick = g.tricks[g.tricks.length - 1] || null;   // so players see the completed trick
  return pub;
}

// A read-only BalootGame a non-host player renders: own hand real, the others as blanks.
// legalBids / legalMoves only need public state + your own hand, so they work unchanged.
export function viewGame(pub, mySeat, myCards, myBaloot = false) {
  const g = Object.assign(Object.create(BalootGame.prototype), pub);
  g.listeners = [];
  g.hands = pub.handCounts.map((n, s) => (s === mySeat ? myCards.slice() : new Array(n).fill(null)));
  // Enough for canDeclare(mySeat): my candidates come from my own 8-card hand.
  g.tricks = new Array(pub.trickNo || 0).fill(null);
  if (pub.lastTrick && g.tricks.length) g.tricks[g.tricks.length - 1] = pub.lastTrick;
  g.countedProjects = () => pub.shownProjects || [];
  g.projects = pub.declared || [];
  if (myBaloot && !pub.balootDeclared) g.balootSeat = mySeat;   // only I know I hold it
  g.projectCandidates = [0, 1, 2, 3].map((s) =>
    s === mySeat && pub.mode && myCards.length === 8 ? detectProjects(myCards, pub.mode) : []);
  return g;
}
