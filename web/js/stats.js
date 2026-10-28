// EXPERIMENTAL — head-to-head record against the real players you met in private sessions
// ("فزت على أسامة ٣ مرات"). Switched by SHOW_H2H in firebase-config.js; to remove it entirely
// delete this file, the SHOW_H2H flag, #screen-stats/#btn-stats in index.html and their hooks in ui.js.
import { fire, state } from "./auth.js?v=16";
import { TEAM_OF } from "./engine.js?v=16";

// Each player's own browser records the finished match once (refresh-safe via localStorage).
export async function recordRoomMatch({ code, matchId, seats, me, weWon, stake }) {
  if (!state.user || me < 0 || !matchId) return;
  const key = `h2h:${state.user.uid}:${code}:${matchId}`;
  try { if (localStorage.getItem(key)) return; localStorage.setItem(key, "1"); } catch (_) {}
  const people = (side) => seats
    .map((s, i) => ({ s, i }))
    .filter(({ s, i }) => s && !s.bot && s.uid && s.uid !== state.user.uid && side(TEAM_OF(i) === TEAM_OF(me)))
    .map(({ s }) => ({ uid: s.uid, name: s.name || "لاعب" }));
  const { db, fns } = fire();
  try {
    await fns.addDoc(fns.collection(db, "matches"), {
      uid: state.user.uid,
      name: state.profile?.name || "",
      mode: "room",
      code, matchId,
      won: !!weWon,
      stake: stake || 0,
      partners: people((same) => same),
      opponents: people((same) => !same),
      ts: fns.serverTimestamp(),
    });
  } catch (_) { /* stats are best-effort */ }
}

// → { played, won, rivals: [{ uid, name, beat, lostTo, withMe }] } sorted by most games.
export async function loadHeadToHead() {
  const { db, fns } = fire();
  const q = fns.query(fns.collection(db, "matches"), fns.where("uid", "==", state.user.uid));
  const snap = await fns.getDocs(q);
  const map = new Map();
  const get = (p) => {
    if (!map.has(p.uid)) map.set(p.uid, { uid: p.uid, name: p.name, beat: 0, lostTo: 0, withMe: 0 });
    const r = map.get(p.uid);
    r.name = p.name || r.name;
    return r;
  };
  let played = 0, won = 0;
  snap.forEach((d) => {
    const m = d.data();
    if (m.mode !== "room") return;
    played++;
    if (m.won) won++;
    for (const p of m.opponents || []) m.won ? get(p).beat++ : get(p).lostTo++;
    for (const p of m.partners || []) get(p).withMe++;
  });
  const rivals = [...map.values()].sort((a, b) => (b.beat + b.lostTo + b.withMe) - (a.beat + a.lostTo + a.withMe));
  return { played, won, rivals };
}
