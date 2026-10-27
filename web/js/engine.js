// Baloot game engine — turn-based state machine for one match.
// Rules follow the common Saudi ruleset (pagat.com/jass/baloot.html, Jawaker rules).
// Seats: 0 (you, bottom), 1 (right), 2 (partner, top), 3 (left). Play passes to the right (seat + 1).
// Teams: A = seats {0,2}, B = seats {1,3}.
import {
  makeDeck, shuffle, SUITS, ORDER_SEQ, cardStrength, cardPoints,
} from "./deck.js?v=9";

export const TEAM_OF = (seat) => (seat % 2 === 0 ? "A" : "B");
const OTHER = (team) => (team === "A" ? "B" : "A");
const seatsFrom = (start) => [0, 1, 2, 3].map((i) => (start + i) % 4);

// Phases in which someone must choose a bid / doubling action.
export const BID_PHASES = ["bidding1", "bidding2", "sunCheck", "hokomConfirm", "doubling"];

// Projects (مشاريع): game-point values per contract.
const PROJECT_RANK = { sira: 1, "50": 2, "100": 3, "400": 4 };
export const PROJECT_VALUE = {
  hokom: { sira: 2, "50": 5, "100": 10 },
  sun:   { sira: 4, "50": 10, "100": 20, "400": 40 },
};
export const PROJECT_AR = { sira: "سرا", "50": "خمسين", "100": "مية", "400": "أربعمية" };

const bidKey = (a) => `${a.kind}|${a.suit || ""}|${a.locked ? "L" : ""}`;

export class BalootGame {
  // strict: the game forces following suit / trumping. When false any card may be played and
  // the other team must catch a revoke by calling قيد (claimQaid).
  constructor({ targetScore = 152, rng = Math.random, strict = true } = {}) {
    this.targetScore = targetScore;
    this.rng = rng;
    this.strict = strict;
    this.score = { A: 0, B: 0 };
    this.dealer = 3;              // dealer rotates; seat 0 leads first deal
    this.round = 0;
    this.listeners = [];
    this.startRound();
  }

  on(fn) { this.listeners.push(fn); }
  // A failing listener (UI bug) must never interrupt a state transition halfway.
  emit(ev) {
    for (const fn of this.listeners) {
      try { fn(ev); } catch (e) { console.error("listener failed on", ev.type, e); }
    }
  }

  // ---------- Round lifecycle ----------
  startRound() {
    this.round++;
    this.hands = [[], [], [], []];
    this.mode = null;             // "sun" | "hokom"
    this.trump = null;
    this.declarer = null;         // seat that bought the contract
    this.hokomBidder = null;      // provisional Hokom buyer while others may still call Sun
    this.pendingTrump = null;
    this.multiplier = 1;          // 1 · 2 دبل · 3 ثري · 4 فور
    this.gahwa = false;           // قهوة: round winner takes the match
    this.locked = false;          // مقفول: no trump leads unless holding only trumps
    this.doubler = null;
    this.projects = [];           // declared projects [{seat, type, set, top, suit, cards}]
    this.projectCandidates = [[], [], [], []]; // what each hand could declare (must be declared to count)
    this.projectTeam = null;      // only the team with the best project scores its projects
    this.fouls = [];              // revokes made while strict is off: [{seat, card, trick}]
    this.balootSeat = null;       // holder of trump K+Q (بلوت)
    this.balootDeclared = false;  // بلوت only counts once its holder says it
    this.tricks = [];             // completed tricks
    this.currentTrick = [];       // {seat, card}
    this.wonCards = { A: [], B: [] };
    this.lastTrickTeam = null;

    const deck = shuffle(makeDeck(), this.rng);
    this.deck = deck;
    // Deal 5 to each (3 then 2 in real life; order irrelevant to logic).
    for (let s = 0; s < 4; s++) this.hands[s] = deck.slice(s * 5, s * 5 + 5);
    this.remainder = deck.slice(20);        // 12 cards left
    this.flip = this.remainder[0];          // the revealed card (ورقة الشراء)
    this.phase = "bidding1";
    this.setQueue(seatsFrom(this.dealer + 1)); // player right of dealer speaks first
    this.emit({ type: "round-start", round: this.round });
    this.emit({ type: "state" });
  }

  setQueue(seats) { this.bidQueue = seats; this.bidTurn = seats[0]; }

  // ---------- Bidding ----------
  // Actions: {kind:"hokom", suit} | {kind:"sun"} | {kind:"ashkal"} | {kind:"pass"}
  // Doubling: {kind:"double"|"four", locked} | {kind:"triple"} | {kind:"gahwa"} | {kind:"pass"}
  legalBids(seat) {
    if (seat !== this.bidTurn) return [];
    const flipSuit = this.flip.suit;
    switch (this.phase) {
      case "bidding1": {
        const a = [{ kind: "hokom", suit: flipSuit }, { kind: "sun" }];
        // Ashkal: only the player left of the dealer, or the dealer (everyone before passed).
        if (seat === (this.dealer + 3) % 4 || seat === this.dealer) a.push({ kind: "ashkal" });
        a.push({ kind: "pass" });
        return a;
      }
      case "bidding2":
        return [
          ...SUITS.filter((s) => s !== flipSuit).map((suit) => ({ kind: "hokom", suit })),
          { kind: "sun" }, { kind: "pass" },
        ];
      case "sunCheck": return [{ kind: "sun" }, { kind: "pass" }];
      case "hokomConfirm": return [{ kind: "hokom", suit: this.pendingTrump }, { kind: "sun" }];
      case "doubling": return this.doubleOptions();
    }
    return [];
  }

  bid(seat, action) {
    if (!this.legalBids(seat).some((a) => bidKey(a) === bidKey(action))) return false;
    this.emit({ type: "bid", seat, action, phase: this.phase });
    if (this.phase === "doubling") { this.applyDouble(seat, action); return true; }

    if (action.kind === "sun") { this.setContract("sun", null, seat); return true; }
    if (action.kind === "ashkal") { this.setContract("sun", null, (seat + 2) % 4); return true; } // partner takes the card
    if (action.kind === "hokom") {
      if (this.phase === "hokomConfirm") { this.setContract("hokom", action.suit, seat); return true; }
      this.hokomBidder = seat;
      this.pendingTrump = action.suit;
      // Round 1: anyone else (even after passing) may still call Sun.
      // Round 2: only players who haven't spoken yet may call Sun.
      const askSun = this.phase === "bidding1"
        ? seatsFrom(this.dealer + 1).filter((s) => s !== seat)
        : this.bidQueue.slice(1);
      this.hokomRound = this.phase === "bidding1" ? 1 : 2;
      if (!askSun.length) { this.finishHokom(); return true; }
      this.phase = "sunCheck";
      this.setQueue(askSun);
      this.emit({ type: "state" });
      return true;
    }

    // pass
    this.bidQueue.shift();
    if (this.bidQueue.length) { this.bidTurn = this.bidQueue[0]; this.emit({ type: "state" }); return true; }
    if (this.phase === "bidding1") {
      this.phase = "bidding2";
      this.setQueue(seatsFrom(this.dealer + 1));
      this.emit({ type: "state" });
    } else if (this.phase === "bidding2") {
      this.emit({ type: "redeal" });
      this.dealer = (this.dealer + 1) % 4;
      this.startRound();
    } else if (this.phase === "sunCheck") {
      this.finishHokom();
    }
    return true;
  }

  // Nobody overcalled with Sun: a first-round Hokom buyer may still switch to Sun.
  finishHokom() {
    if (this.hokomRound === 1) {
      this.phase = "hokomConfirm";
      this.setQueue([this.hokomBidder]);
      this.emit({ type: "state" });
    } else {
      this.setContract("hokom", this.pendingTrump, this.hokomBidder);
    }
  }

  setContract(mode, trump, seat) {
    this.mode = mode;
    this.trump = trump;
    this.declarer = seat;
    // Buyer takes the revealed card + 2 more; everyone else gets 3 → 8 cards each.
    this.hands[seat].push(this.flip);
    const pool = this.remainder.filter((c) => c.id !== this.flip.id);
    let pi = 0;
    for (let s = 0; s < 4; s++) {
      while (this.hands[s].length < 8) this.hands[s].push(pool[pi++]);
    }
    this.findProjects();
    this.emit({ type: "contract", mode, trump, declarer: seat });
    this.startDoubling();
  }

  // ---------- Doubling (دبل / ثري / فور / قهوة) ----------
  startDoubling() {
    const dec = TEAM_OF(this.declarer);
    // Sun may only be doubled when the buyers are above 100 and the defenders below 100.
    if (this.mode === "sun" && !(this.score[dec] > 100 && this.score[OTHER(dec)] < 100)) {
      this.startPlay();
      return;
    }
    this.phase = "doubling";
    this.setQueue(seatsFrom(this.declarer + 1).filter((s) => TEAM_OF(s) !== dec));
    this.emit({ type: "state" });
  }

  doubleOptions() {
    const hokom = this.mode === "hokom";
    switch (this.multiplier) {
      case 1: return hokom
        ? [{ kind: "double", locked: false }, { kind: "double", locked: true }, { kind: "pass" }]
        : [{ kind: "double" }, { kind: "pass" }];
      case 2: return [{ kind: "triple" }, { kind: "pass" }];
      case 3: return [{ kind: "four", locked: false }, { kind: "four", locked: true }, { kind: "pass" }];
      case 4: return [{ kind: "gahwa" }, { kind: "pass" }];
    }
    return [];
  }

  applyDouble(seat, action) {
    switch (action.kind) {
      case "pass":
        if (this.multiplier === 1 && this.bidQueue.length > 1) {
          this.bidQueue.shift();
          this.bidTurn = this.bidQueue[0];
          this.emit({ type: "state" });
          return;
        }
        this.startPlay();
        return;
      case "double":
        this.multiplier = 2; this.locked = !!action.locked; this.doubler = seat;
        if (this.mode === "sun") { this.startPlay(); return; } // Sun: a single double only
        this.setQueue([this.declarer]);
        break;
      case "triple":
        this.multiplier = 3; this.locked = false;               // ثري always open
        this.setQueue([this.doubler]);
        break;
      case "four":
        this.multiplier = 4; this.locked = !!action.locked;
        this.setQueue([this.declarer]);
        break;
      case "gahwa":
        this.gahwa = true; this.locked = false;                 // قهوة always open
        this.startPlay();
        return;
    }
    this.emit({ type: "state" });
  }

  startPlay() {
    this.phase = "playing";
    this.turn = (this.dealer + 1) % 4; // player right of dealer leads
    this.currentTrick = [];
    this.emit({ type: "play-start", multiplier: this.multiplier, gahwa: this.gahwa, locked: this.locked });
    this.emit({ type: "state" });
  }

  // ---------- Projects (مشاريع) ----------
  // Projects only count when declared during the first trick, before playing your first card.
  findProjects() {
    this.projects = [];
    this.projectTeam = null;
    this.projectCandidates = [0, 1, 2, 3].map((s) =>
      detectProjects(this.hands[s], this.mode).map((p) => ({ ...p, seat: s })));

    // Baloot: K+Q of trumps in one hand. Not scored separately when inside a trump مية or a four-K/Q مية.
    this.balootSeat = null;
    if (this.mode === "hokom") {
      for (let s = 0; s < 4; s++) {
        const h = this.hands[s];
        const has = (r) => h.some((c) => c.suit === this.trump && c.rank === r);
        if (!has("K") || !has("Q")) continue;
        const blocked = this.projectCandidates[s].some((p) => p.type === "100" && (
          (p.set && (p.top === "K" || p.top === "Q")) ||
          (!p.set && p.suit === this.trump && p.cards.some((c) => c.rank === "K") && p.cards.some((c) => c.rank === "Q"))
        ));
        if (!blocked) this.balootSeat = s;
      }
    }
  }

  // > 0 when a beats b: higher type, then a set beats a sequence, then higher top card, then earlier seat.
  compareProjects(a, b) {
    if (PROJECT_RANK[a.type] !== PROJECT_RANK[b.type]) return PROJECT_RANK[a.type] - PROJECT_RANK[b.type];
    if (a.set !== b.set) return a.set ? 1 : -1;
    const ta = ORDER_SEQ.indexOf(a.top), tb = ORDER_SEQ.indexOf(b.top);
    if (ta !== tb) return tb - ta;
    const order = seatsFrom(this.dealer + 1);
    return order.indexOf(b.seat) - order.indexOf(a.seat);
  }

  canDeclare(seat) {
    return this.phase === "playing" && this.tricks.length === 0
      && this.projectCandidates[seat].length > 0
      && !this.projects.some((p) => p.seat === seat)
      && !this.currentTrick.some((p) => p.seat === seat);
  }

  declareProjects(seat) {
    if (!this.canDeclare(seat)) return false;
    this.projects.push(...this.projectCandidates[seat]);
    this.emit({ type: "declare", seat, types: this.projectCandidates[seat].map((p) => p.type) });
    this.emit({ type: "state" });
    return true;
  }

  // بلوت: the holder of trump K+Q may say it any time during play (usually with the second card).
  canDeclareBaloot(seat) {
    return this.phase === "playing" && seat === this.balootSeat && !this.balootDeclared;
  }

  declareBaloot(seat) {
    if (!this.canDeclareBaloot(seat)) return false;
    this.balootDeclared = true;
    this.emit({ type: "baloot", seat });
    this.emit({ type: "state" });
    return true;
  }

  // After the first trick: only the team with the best declared project keeps its projects.
  settleProjects() {
    let best = null;
    for (const p of this.projects) if (!best || this.compareProjects(p, best) > 0) best = p;
    this.projectTeam = best ? TEAM_OF(best.seat) : null;
  }

  countedProjects() { return this.projects.filter((p) => TEAM_OF(p.seat) === this.projectTeam); }

  // ---------- Playing ----------
  legalMoves(seat) {
    if (this.strict) return this.strictMoves(seat);
    return this.phase === "playing" && seat === this.turn ? this.hands[seat].slice() : [];
  }

  // The cards the rules allow (following suit, trumping, مقفول).
  strictMoves(seat) {
    if (this.phase !== "playing" || seat !== this.turn) return [];
    const hand = this.hands[seat];
    const trumps = this.mode === "hokom" ? hand.filter((c) => c.suit === this.trump) : [];

    if (this.currentTrick.length === 0) {
      // Locked (مقفول): no trump lead unless the hand is all trumps.
      if (this.locked && trumps.length && trumps.length < hand.length) {
        return hand.filter((c) => c.suit !== this.trump);
      }
      return hand.slice();
    }

    const ledSuit = this.currentTrick[0].card.suit;
    const hasLed = hand.filter((c) => c.suit === ledSuit);
    if (this.mode === "sun") return hasLed.length ? hasLed : hand.slice();

    const win = this.currentWinningInfo();
    const partnerWinning = win.team === TEAM_OF(seat);
    const higher = (cards) => cards.filter((c) => cardStrength(c, this.mode, this.trump) > win.strength);

    if (hasLed.length) {
      // Trump led: must go over the opponent's trump if possible.
      if (ledSuit === this.trump && !partnerWinning) {
        const up = higher(hasLed);
        return up.length ? up : hasLed;
      }
      return hasLed;
    }
    // Void in led suit: partner winning → free; else must (over)trump if able, otherwise free.
    if (!trumps.length || partnerWinning) return hand.slice();
    const up = higher(trumps);
    return up.length ? up : hand.slice();
  }

  currentWinningInfo() {
    let best = null;
    const ledSuit = this.currentTrick.length ? this.currentTrick[0].card.suit : null;
    for (const p of this.currentTrick) {
      // A trump always beats a non-trump (handled by strength scale); others only compete in the led suit.
      const isTrump = this.mode === "hokom" && p.card.suit === this.trump;
      if (!isTrump && p.card.suit !== ledSuit) continue;
      const st = cardStrength(p.card, this.mode, this.trump);
      if (!best || st > best.strength) best = { seat: p.seat, strength: st, card: p.card };
    }
    return best ? { seat: best.seat, team: TEAM_OF(best.seat), strength: best.strength, card: best.card } : null;
  }

  play(seat, cardId) {
    if (this.phase !== "playing" || seat !== this.turn) return false;
    const legal = this.legalMoves(seat);
    const card = legal.find((c) => c.id === cardId);
    if (!card) return false;
    if (!this.strict) {
      const required = this.strictMoves(seat).map((c) => c.id);
      if (!required.includes(cardId)) this.fouls.push({ seat, card, trick: this.tricks.length, required });
    }

    this.hands[seat] = this.hands[seat].filter((c) => c.id !== cardId);
    this.currentTrick.push({ seat, card });
    this.emit({ type: "play", seat, card });

    if (this.currentTrick.length === 4) {
      this.resolveTrick();
    } else {
      this.turn = (this.turn + 1) % 4;
      this.emit({ type: "state" });
    }
    return true;
  }

  resolveTrick() {
    const w = this.currentWinningInfo();
    const team = w.team;
    for (const p of this.currentTrick) this.wonCards[team].push(p.card);
    this.lastTrickTeam = team;
    this.tricks.push({ cards: this.currentTrick, winner: w.seat, team });
    this.emit({ type: "trick-won", seat: w.seat, team });
    this.currentTrick = [];
    this.turn = w.seat;
    if (this.tricks.length === 1) {
      this.settleProjects();
      if (this.projects.length) this.emit({ type: "projects", projects: this.countedProjects() });
    }

    if (this.hands.every((h) => h.length === 0)) this.scoreRound();
    else this.emit({ type: "state" });
  }

  // ---------- Scoring ----------
  scoreRound() {
    const mode = this.mode;
    const total = mode === "sun" ? 26 : 16;     // game points per round (130 / 162 card points)
    const m = this.multiplier;
    const dec = TEAM_OF(this.declarer), opp = OTHER(dec);

    const raw = { A: 0, B: 0 };
    for (const team of ["A", "B"]) {
      for (const c of this.wonCards[team]) raw[team] += cardPoints(c, mode, this.trump);
    }
    raw[this.lastTrickTeam] += 10; // الأرض: last trick bonus

    const proj = { A: 0, B: 0 };
    for (const p of this.countedProjects()) proj[this.projectTeam] += PROJECT_VALUE[mode][p.type];
    const bal = { A: 0, B: 0 };      // بلوت: always 2, never multiplied, kept by its holder
    if (this.balootDeclared) bal[TEAM_OF(this.balootSeat)] = 2;
    const projMult = m > 1 ? 2 : 1;  // projects are doubled at most

    const tricksWon = { A: 0, B: 0 };
    for (const t of this.tricks) tricksWon[t.team]++;
    const kabootTeam = tricksWon.A === 8 ? "A" : tricksWon.B === 8 ? "B" : null;

    const gp = { A: 0, B: 0 };
    let cards = null, winner, result;
    if (kabootTeam) {
      // كبوت: all 8 tricks — 25 (Hokom) / 44 (Sun) × multiplier, plus the sweepers' projects.
      winner = kabootTeam;
      result = "kaboot";
      gp[winner] = (mode === "sun" ? 44 : 25) * m + proj[winner] * projMult;
    } else {
      // The counting team converts its card points; the other team gets the remainder of 16 / 26.
      const counting = m === 2 || m === 4 ? dec : opp;
      const c = toGamePoints(raw[counting], mode);
      cards = { [counting]: c, [OTHER(counting)]: total - c };
      const decTotal = cards[dec] + proj[dec] + bal[dec];
      const oppTotal = cards[opp] + proj[opp] + bal[opp];
      const decWins = decTotal !== oppTotal ? decTotal > oppTotal
        : tieBreak(raw[counting], mode, counting === dec);
      winner = decWins ? dec : opp;
      if (m === 1 && decWins) {
        result = "normal";
        gp[dec] = cards[dec] + proj[dec];
        gp[opp] = cards[opp] + proj[opp];
      } else {
        // خسارة (failed contract) or a doubled game: the winners take everything.
        result = m === 1 ? "khasara" : "doubled";
        gp[winner] = total * m + (proj.A + proj.B) * projMult;
      }
    }
    this.finishRound({ raw, cards, proj, bal, gp, result, winner, kabootTeam });
  }

  // ---------- قيد (only when strict is off) ----------
  // Any player may call قيد during play. If the other team revoked this round, the caller's team
  // takes the whole round as if the buyers failed; a wrong call hands the round to the other team.
  claimQaid(seat) {
    if (this.strict || this.phase !== "playing") return false;
    if (this.tricks.length === 0) this.settleProjects();
    const team = TEAM_OF(seat);
    const foul = this.fouls.find((f) => TEAM_OF(f.seat) !== team) || null;
    const winner = foul ? team : OTHER(team);
    const mode = this.mode, m = this.multiplier;

    const raw = { A: 0, B: 0 };
    for (const t of ["A", "B"]) for (const c of this.wonCards[t]) raw[t] += cardPoints(c, mode, this.trump);
    const proj = { A: 0, B: 0 };
    for (const p of this.countedProjects()) proj[this.projectTeam] += PROJECT_VALUE[mode][p.type];
    const bal = { A: 0, B: 0 };
    if (this.balootDeclared) bal[TEAM_OF(this.balootSeat)] = 2;
    const gp = { A: 0, B: 0 };
    gp[winner] = (mode === "sun" ? 26 : 16) * m + (proj.A + proj.B) * (m > 1 ? 2 : 1);

    this.emit({ type: "qaid", seat, correct: !!foul, foul });
    this.finishRound({
      raw, cards: null, proj, bal, gp, result: foul ? "qaid" : "qaidWrong", winner, kabootTeam: null,
      qaid: { seat, foul },
    });
    return true;
  }

  finishRound({ gp, bal, winner, ...rest }) {
    gp.A += bal.A;
    gp.B += bal.B;

    this.score.A += gp.A;
    this.score.B += gp.B;
    const ev = {
      type: "round-end", ...rest, gp, bal, winner, decTeam: TEAM_OF(this.declarer),
      multiplier: this.multiplier, gahwa: this.gahwa,
    };
    this.lastRoundResult = ev;
    this.phase = "roundEnd";
    this.emit(ev);

    if (this.gahwa) { this.endMatch(winner); return; }
    const { A, B } = this.score;
    if ((A >= this.targetScore || B >= this.targetScore) && A !== B) this.endMatch(A > B ? "A" : "B");
    else this.emit({ type: "state" });
  }

  endMatch(winner) {
    this.phase = "matchEnd";
    this.emit({ type: "match-end", winner, gahwa: this.gahwa, score: { ...this.score } });
  }

  nextRound() {
    if (this.phase !== "roundEnd") return;
    this.dealer = (this.dealer + 1) % 4;
    this.startRound();
  }
}

// Card points → game points. Hokom: /10 rounding to nearest, 5 rounds down.
// Sun: nearest 10 then ×2/10, except a units digit of 5 is kept exactly (65 → 13).
export function toGamePoints(raw, mode) {
  const units = raw % 10;
  if (mode === "sun") return units === 5 ? (raw * 2) / 10 : Math.round(raw / 10) * 2;
  return units <= 5 ? Math.floor(raw / 10) : Math.ceil(raw / 10);
}

// Equal totals: decided by the counting team's units digit (who lost more in rounding).
function tieBreak(raw, mode, countingIsDec) {
  const u = raw % 10;
  if (mode === "hokom") {
    if (u === 1) return true;                       // both lost 1 → buyers win
    return u >= 2 && u <= 5 ? countingIsDec : !countingIsDec;
  }
  if (u === 0 || u === 5) return true;              // no rounding → buyers win
  return u <= 4 ? countingIsDec : !countingIsDec;
}

// Projects in one 8-card hand: four-of-a-kind (A/K/Q/J/10) and runs of 3+ in a suit.
// A card belongs to one project; at most two projects per player.
export function detectProjects(hand, mode) {
  const sets = [];
  for (const r of ["A", "K", "Q", "J", "10"]) {
    const cards = hand.filter((c) => c.rank === r);
    if (cards.length === 4) sets.push({ type: r === "A" && mode === "sun" ? "400" : "100", set: true, top: r, cards });
  }
  const ids = (ps) => new Set(ps.flatMap((p) => p.cards.map((c) => c.id)));
  const setsFirst = [...sets, ...findSequences(hand, ids(sets))];
  const seqs = findSequences(hand, new Set());
  const usedBySeq = ids(seqs);
  const seqsFirst = [...seqs, ...sets.filter((p) => p.cards.every((c) => !usedBySeq.has(c.id)))];

  const value = (ps) => ps.reduce((s, p) => s + PROJECT_VALUE[mode][p.type], 0);
  const best = value(seqsFirst) > value(setsFirst) ? seqsFirst : setsFirst;
  return best
    .sort((a, b) => PROJECT_RANK[b.type] - PROJECT_RANK[a.type] || (b.set ? 1 : 0) - (a.set ? 1 : 0))
    .slice(0, 2);
}

function findSequences(hand, used) {
  const out = [];
  for (const suit of SUITS) {
    const idx = hand
      .filter((c) => c.suit === suit && !used.has(c.id))
      .map((c) => ORDER_SEQ.indexOf(c.rank))
      .sort((a, b) => a - b);
    let run = [];
    const flush = () => {
      for (let i = 0; run.length - i >= 3;) {
        const len = Math.min(5, run.length - i);
        const chunk = run.slice(i, i + len);
        out.push({
          type: len === 3 ? "sira" : len === 4 ? "50" : "100", set: false, suit,
          top: ORDER_SEQ[chunk[0]],
          cards: chunk.map((k) => hand.find((c) => c.suit === suit && c.rank === ORDER_SEQ[k])),
        });
        i += len;
      }
      run = [];
    };
    for (const k of idx) {
      if (run.length && k !== run[run.length - 1] + 1) flush();
      run.push(k);
    }
    flush();
  }
  return out;
}
