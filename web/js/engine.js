// Baloot game engine — turn-based state machine for one match.
// Seats: 0 (you, bottom), 1 (right), 2 (partner, top), 3 (left).
// Teams: A = seats {0,2}, B = seats {1,3}.
import {
  makeDeck, shuffle, SUITS, cardStrength, cardPoints,
} from "./deck.js";

export const TEAM_OF = (seat) => (seat % 2 === 0 ? "A" : "B");

export class BalootGame {
  constructor({ targetScore = 152, rng = Math.random } = {}) {
    this.targetScore = targetScore;
    this.rng = rng;
    this.score = { A: 0, B: 0 };
    this.dealer = 3;              // dealer rotates; seat 0 leads first deal
    this.round = 0;
    this.listeners = [];
    this.startRound();
  }

  on(fn) { this.listeners.push(fn); }
  emit(ev) { for (const fn of this.listeners) fn(ev); }

  // ---------- Round lifecycle ----------
  startRound() {
    this.round++;
    this.hands = [[], [], [], []];
    this.mode = null;             // "sun" | "hokom"
    this.trump = null;
    this.declarer = null;         // seat that bought the contract
    this.phase = "bidding1";
    this.tricks = [];             // completed tricks
    this.currentTrick = [];       // {seat, card}
    this.wonCards = { A: [], B: [] };
    this.lastTrickTeam = null;

    const deck = shuffle(makeDeck(), this.rng);
    this.deck = deck;
    // Deal 5 to each (3 then 2 in real life; order irrelevant to logic).
    for (let s = 0; s < 4; s++) this.hands[s] = deck.slice(s * 5, s * 5 + 5);
    this.remainder = deck.slice(20);        // 12 cards left
    this.flip = this.remainder[0];          // the revealed card for bidding
    this.bidTurn = (this.dealer + 1) % 4;   // player right of dealer starts
    this.passes = 0;
    this.emit({ type: "round-start", round: this.round });
    this.emit({ type: "state" });
  }

  // ---------- Bidding ----------
  // action: {kind:"hokom-flip"} take flip suit as trump
  //         {kind:"sun"} | {kind:"hokom", suit} | {kind:"pass"}
  legalBids(seat) {
    if (this.phase === "bidding1") return ["hokom-flip", "pass"];
    if (this.phase === "bidding2") return ["sun", "hokom", "pass"];
    return [];
  }

  bid(seat, action) {
    if (seat !== this.bidTurn) return false;

    if (this.phase === "bidding1") {
      if (action.kind === "hokom-flip") {
        this.setContract("hokom", this.flip.suit, seat);
        return true;
      }
      // pass
      this.passes++;
      this.bidTurn = (this.bidTurn + 1) % 4;
      if (this.passes >= 4) { this.phase = "bidding2"; this.passes = 0; this.bidTurn = (this.dealer + 1) % 4; }
      this.emit({ type: "state" });
      return true;
    }

    if (this.phase === "bidding2") {
      if (action.kind === "sun") { this.setContract("sun", null, seat); return true; }
      if (action.kind === "hokom") { this.setContract("hokom", action.suit, seat); return true; }
      // pass
      this.passes++;
      this.bidTurn = (this.bidTurn + 1) % 4;
      if (this.passes >= 4) { this.emit({ type: "redeal" }); this.dealer = (this.dealer + 1) % 4; this.startRound(); }
      else this.emit({ type: "state" });
      return true;
    }
    return false;
  }

  setContract(mode, trump, seat) {
    this.mode = mode;
    this.trump = trump;
    this.declarer = seat;
    // Deal the remaining cards so everyone holds 8.
    // Buyer conceptually took the flip; distribute remainder to reach 8 each.
    let pool = this.remainder.slice();
    // give flip to buyer first
    this.hands[seat].push(this.flip);
    pool = pool.filter((c) => c.id !== this.flip.id);
    let pi = 0;
    for (let s = 0; s < 4; s++) {
      while (this.hands[s].length < 8) { this.hands[s].push(pool[pi++]); }
    }
    this.phase = "playing";
    this.turn = (this.dealer + 1) % 4; // player right of dealer leads
    this.currentTrick = [];
    this.emit({ type: "contract", mode, trump, declarer: seat });
    this.emit({ type: "state" });
  }

  // ---------- Playing ----------
  legalMoves(seat) {
    if (this.phase !== "playing" || seat !== this.turn) return [];
    const hand = this.hands[seat];
    if (this.currentTrick.length === 0) return hand.slice(); // leader: any card

    const ledSuit = this.currentTrick[0].card.suit;
    const hasLed = hand.filter((c) => c.suit === ledSuit);

    if (this.mode === "sun") {
      return hasLed.length ? hasLed : hand.slice(); // must follow; else anything
    }

    // Hokom following rules (common ruleset):
    if (hasLed.length) {
      if (ledSuit === this.trump) {
        // must follow trump, and over-trump if possible
        const winning = this.currentWinningCard();
        const higher = hasLed.filter((c) => cardStrength(c, this.mode, this.trump) > winning.strength);
        return higher.length ? higher : hasLed;
      }
      return hasLed; // follow the led plain suit
    }
    // void in led suit → must trump (and over-trump) if partner isn't winning
    const trumps = hand.filter((c) => c.suit === this.trump);
    if (!trumps.length) return hand.slice(); // no trumps: free
    const winInfo = this.currentWinningInfo();
    if (winInfo.team === TEAM_OF(seat)) return hand.slice(); // partner winning: free discard
    const winning = this.currentWinningCard();
    const higherTrumps = trumps.filter((c) => cardStrength(c, this.mode, this.trump) > winning.strength);
    return higherTrumps.length ? higherTrumps : trumps;
  }

  currentWinningInfo() {
    let best = null;
    for (const p of this.currentTrick) {
      const st = cardStrength(p.card, this.mode, this.trump);
      // A trump always beats a non-trump in hokom (handled by strength scale).
      // Non-trump only competes if same suit as led.
      const ledSuit = this.currentTrick[0].card.suit;
      const isTrump = this.mode === "hokom" && p.card.suit === this.trump;
      const competes = isTrump || p.card.suit === ledSuit;
      if (!competes) continue;
      if (!best || st > best.strength) best = { seat: p.seat, strength: st, card: p.card };
    }
    return best ? { seat: best.seat, team: TEAM_OF(best.seat), strength: best.strength, card: best.card } : null;
  }
  currentWinningCard() { const w = this.currentWinningInfo(); return w ? { strength: w.strength } : { strength: -1 }; }

  play(seat, cardId) {
    if (this.phase !== "playing" || seat !== this.turn) return false;
    const legal = this.legalMoves(seat);
    const card = legal.find((c) => c.id === cardId);
    if (!card) return false;

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

    if (this.hands.every((h) => h.length === 0)) this.scoreRound();
    else this.emit({ type: "state" });
  }

  // ---------- Scoring ----------
  scoreRound() {
    const raw = { A: 0, B: 0 };
    for (const team of ["A", "B"]) {
      for (const c of this.wonCards[team]) raw[team] += cardPoints(c, this.mode, this.trump);
    }
    raw[this.lastTrickTeam] += 10; // last trick (آخر) bonus

    // "بلوت" bonus: K+Q of trump in Hokom = +20 raw to whoever holds them in won cards.
    if (this.mode === "hokom") {
      for (const team of ["A", "B"]) {
        const hasK = this.wonCards[team].some((c) => c.suit === this.trump && c.rank === "K");
        const hasQ = this.wonCards[team].some((c) => c.suit === this.trump && c.rank === "Q");
        if (hasK && hasQ) raw[team] += 20;
      }
    }

    // Convert raw → game points. Hokom /10, Sun /5 (doubled). Rounding to nearest.
    const div = this.mode === "sun" ? 5 : 10;
    let gp = { A: Math.round(raw.A / div), B: Math.round(raw.B / div) };

    // Declarer team must out-score opponents, else "بقى/قهر": opponents take the whole round.
    const decTeam = TEAM_OF(this.declarer);
    const oppTeam = decTeam === "A" ? "B" : "A";
    let result = "normal";
    if (raw[decTeam] <= raw[oppTeam]) {
      gp[oppTeam] = gp.A + gp.B;
      gp[decTeam] = 0;
      result = "baqi"; // declarer failed
    }

    this.score.A += gp.A;
    this.score.B += gp.B;
    this.lastRoundResult = { raw, gp, decTeam, result };
    this.phase = "roundEnd";
    this.emit({ type: "round-end", raw, gp, result, decTeam });

    if (this.score.A >= this.targetScore || this.score.B >= this.targetScore) {
      const winner = this.score.A >= this.score.B ? "A" : "B";
      this.phase = "matchEnd";
      this.emit({ type: "match-end", winner, score: { ...this.score } });
    } else {
      this.emit({ type: "state" });
    }
  }

  nextRound() {
    if (this.phase !== "roundEnd") return;
    this.dealer = (this.dealer + 1) % 4;
    this.startRound();
  }
}
