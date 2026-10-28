// Heuristic computer player for Baloot. Plays like a careful human: it remembers every card
// played, notices who is out of a suit (or of trumps), knows which cards are now the boss
// (أكبر ورقة باقية), feeds points to a partner who is sure to win, and doesn't waste big cards.
import { makeDeck, cardStrength, cardPoints } from "./deck.js?v=15";
import { TEAM_OF } from "./engine.js?v=15";

// --- Bidding ---
export function chooseBid(game, seat) {
  const hand = game.hands[seat];
  const legal = game.legalBids(seat);
  const can = (kind) => legal.find((a) => a.kind === kind);
  const sunScore = sunStrength(hand);

  switch (game.phase) {
    case "bidding1": {
      // Buy the flipped suit as trump if we have good strength in it; Sun on a very strong hand.
      if (sunScore >= 13) return { kind: "sun" };
      return suitHokomStrength(hand, game.flip.suit, game.flip) >= 9 ? can("hokom") : { kind: "pass" };
    }
    case "bidding2": {
      let best = null, bestVal = -1;
      for (const a of legal.filter((x) => x.kind === "hokom")) {
        const v = suitHokomStrength(hand, a.suit);
        if (v > bestVal) { bestVal = v; best = a; }
      }
      if (bestVal >= 10) return best;
      if (sunScore >= 11) return { kind: "sun" };
      if (bestVal >= 8.5) return best;
      return { kind: "pass" };
    }
    case "sunCheck":     // someone bought Hokom: overcall with Sun only on a strong hand
      return sunScore >= 13 ? { kind: "sun" } : { kind: "pass" };
    case "hokomConfirm":
      return sunScore >= 14 ? { kind: "sun" } : can("hokom");
    case "doubling": {
      // Defenders double on a strong hand; buyers raise only when very strong. Never قهوة.
      const v = game.mode === "sun" ? sunScore : suitHokomStrength(hand, game.trump);
      if (game.multiplier === 1 && v >= (game.mode === "sun" ? 14 : 10)) return { kind: "double", locked: false };
      if (game.multiplier === 2 && v >= 14) return { kind: "triple" };
      if (game.multiplier === 3 && v >= 12) return { kind: "four", locked: false };
      return { kind: "pass" };
    }
  }
  return { kind: "pass" };
}

// The buyer also gets the flipped card, so it counts toward the trump strength.
function suitHokomStrength(hand, suit, extra = null) {
  const cards = extra ? [...hand, extra] : hand;
  let v = 0;
  const trumps = cards.filter((c) => c.suit === suit);
  for (const c of cards) {
    if (c.suit === suit) {
      v += { J: 6, "9": 5, A: 3, "10": 2, K: 1, Q: 1, "8": 0.5, "7": 0.5 }[c.rank] || 0;
    } else if (c.rank === "A") v += 1.5;
    else if (c.rank === "10") v += 0.5;
  }
  if (trumps.length >= 4) v += 1.5;                                   // length is control
  if (!trumps.some((c) => c.rank === "J" || c.rank === "9")) v -= 2;  // no top trump: risky buy
  return v;
}

function sunStrength(hand) {
  let v = 0;
  for (const c of hand) v += { A: 4, "10": 3, K: 1.5, Q: 1 }[c.rank] || 0;
  // A 10 without its Ace is easy to lose.
  for (const c of hand) {
    if (c.rank === "10" && !hand.some((x) => x.suit === c.suit && x.rank === "A")) v -= 1;
  }
  return v;
}

// --- What the bot remembers about the round ---
function knowledge(game, seat) {
  const mode = game.mode, trump = game.trump;
  const str = (c) => cardStrength(c, mode, trump);
  const played = new Set();
  // void[s] = suits seat s has shown it doesn't hold.
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const tricks = [...game.tricks.filter(Boolean).map((t) => t.cards), game.currentTrick];
  for (const cards of tricks) {
    if (!cards || !cards.length) continue;
    const led = cards[0].card.suit;
    let win = null;
    for (const p of cards) {
      played.add(p.card.id);
      if (p.card.suit !== led) {
        voids[p.seat].add(led);
        // Void and didn't trump over an opponent's winning card → no (higher) trumps either.
        if (mode === "hokom" && p.card.suit !== trump && win && TEAM_OF(win.seat) !== TEAM_OF(p.seat)) {
          voids[p.seat].add(trump);
        }
      }
      const isTrump = mode === "hokom" && p.card.suit === trump;
      if ((isTrump || p.card.suit === led) && (!win || str(p.card) > str(win.card))) win = p;
    }
  }
  const mine = new Set(game.hands[seat].map((c) => c.id));
  const unseen = makeDeck().filter((c) => !played.has(c.id) && !mine.has(c.id));
  return { mode, trump, str, played, voids, unseen, hand: game.hands[seat], seat, team: TEAM_OF(seat) };
}

const pts = (k, c) => cardPoints(c, k.mode, k.trump);
const isTrump = (k, c) => k.mode === "hokom" && c.suit === k.trump;
// Boss card: no card still out (in other hands) of the same suit beats it.
const isMaster = (k, c) => !k.unseen.some((u) => u.suit === c.suit && k.str(u) > k.str(c));
const trumpsOut = (k) => k.mode === "hokom" ? k.unseen.filter((u) => u.suit === k.trump) : [];
const opponents = (k) => [0, 1, 2, 3].filter((s) => TEAM_OF(s) !== k.team);
const partner = (k) => (k.seat + 2) % 4;

// Can seat s possibly beat `card` in a trick led with `led`?
function canBeat(k, s, card, led) {
  const higherLed = k.unseen.filter((u) => u.suit === led && k.str(u) > k.str(card));
  const followsLed = !k.voids[s].has(led) && k.unseen.some((u) => u.suit === led);
  if (!isTrump(k, card) && followsLed && higherLed.length) return true;
  if (k.mode !== "hokom" || k.voids[s].has(k.trump)) return false;
  const higherTrump = k.unseen.filter((u) => u.suit === k.trump && k.str(u) > k.str(card));
  if (!higherTrump.length) return false;
  if (led === k.trump) return followsLed;
  // Ruffing needs a void in the led suit: known, or nothing of it left out.
  return k.voids[s].has(led) || !k.unseen.some((u) => u.suit === led);
}

// Would `card` (winning now) hold against every opponent still to play?
function holds(game, k, card, led) {
  const after = [];
  for (let i = game.currentTrick.length + 1; i < 4; i++) after.push((k.seat + i - game.currentTrick.length) % 4);
  return after.filter((s) => TEAM_OF(s) !== k.team).every((s) => !canBeat(k, s, card, led));
}

const byPts = (k) => (a, b) => pts(k, a) - pts(k, b) || k.str(a) - k.str(b);
const lowest = (k, cards) => cards.slice().sort(byPts(k))[0];
const cheapestWinner = (k, cards) => cards.slice().sort((a, b) => k.str(a) - k.str(b))[0];

// --- Card play ---
// The bot looks ahead: it deals the cards it can't see in many ways that fit everything shown so
// far (who is out of a suit, who can't have a higher trump, the bought card, shown projects…),
// plays the round out for each of its cards with the quick player below, and picks the card that
// wins the most game points on average. budgetMs caps the thinking time.
export function chooseCard(game, seat, { budgetMs = 220, minDeals = 24, maxDeals = 400 } = {}) {
  const legal = game.strictMoves(seat); // bots always play by the rules, even when strict is off
  if (legal.length === 1) return legal[0];
  if (game.hands.some((h) => h.some((c) => !c))) return chooseCardQuick(game, seat);
  const team = TEAM_OF(seat);
  const known = constraints(game, seat);
  const totals = legal.map(() => 0);
  const start = Date.now();
  let deals = 0;
  while (deals < maxDeals && (deals < minDeals || Date.now() - start < budgetMs)) {
    const hands = sampleHands(game, seat, known);
    if (!hands) break;
    legal.forEach((card, i) => { totals[i] += playOut(game, hands, seat, card, team); });
    deals++;
  }
  if (!deals) return chooseCardQuick(game, seat);
  let best = 0;
  for (let i = 1; i < legal.length; i++) if (totals[i] > totals[best]) best = i;
  return legal[best];
}

// The quick heuristic player (also used inside the look-ahead).
export function chooseCardQuick(game, seat) {
  const legal = game.strictMoves(seat);
  if (legal.length === 1) return legal[0];
  const k = knowledge(game, seat);
  return game.currentTrick.length === 0 ? chooseLead(game, k, legal) : chooseFollow(game, k, legal);
}

// What the table has shown about each hidden hand: cards it can't hold, and cards it must hold.
function constraints(game, seat) {
  const { mode, trump } = game;
  const str = (c) => cardStrength(c, mode, trump);
  const cant = [0, 1, 2, 3].map(() => new Set());
  const must = [0, 1, 2, 3].map(() => new Set());
  const all = makeDeck();
  const noTrumpAbove = (s, st) => { for (const c of all) if (c.suit === trump && str(c) > st) cant[s].add(c.id); };
  const tricks = [...game.tricks.filter(Boolean).map((t) => t.cards), game.currentTrick];
  for (const cards of tricks) {
    if (!cards || !cards.length) continue;
    const lead = cards[0], led = lead.card.suit;
    // Locked game: leading a trump means holding nothing else.
    if (game.locked && mode === "hokom" && led === trump) for (const c of all) if (c.suit !== trump) cant[lead.seat].add(c.id);
    let win = { seat: lead.seat, card: lead.card };
    for (let i = 1; i < cards.length; i++) {
      const p = cards[i];
      const st = str(win.card);
      const oppWinning = TEAM_OF(win.seat) !== TEAM_OF(p.seat);
      if (p.card.suit !== led) {
        for (const c of all) if (c.suit === led) cant[p.seat].add(c.id);
        if (mode === "hokom") {
          if (p.card.suit !== trump) {
            if (oppWinning) noTrumpAbove(p.seat, win.card.suit === trump ? st : 0);
            else if (win.seat === lead.seat && lead.card.rank !== "A" && !lead.ekka) noTrumpAbove(p.seat, 0);
          } else if (oppWinning && str(p.card) < st) noTrumpAbove(p.seat, st);
        }
      } else if (mode === "hokom" && led === trump && oppWinning && str(p.card) < st) {
        noTrumpAbove(p.seat, st);
      }
      const beats = (mode === "hokom" && p.card.suit === trump) || p.card.suit === led;
      if (beats && str(p.card) > str(win.card)) win = p;
    }
  }
  // The buyer holds the revealed card; shown projects and a said بلوت reveal cards too.
  must[game.declarer].add(game.flip.id);
  for (const p of game.tricks.length ? game.countedProjects() : []) for (const c of p.cards) must[p.seat].add(c.id);
  if (game.balootDeclared && game.balootSeat !== null) {
    must[game.balootSeat].add(`K_${trump}`); must[game.balootSeat].add(`Q_${trump}`);
  }
  return { cant, must };
}

// One random deal of the unseen cards that fits the constraints (relaxed if none can be found).
function sampleHands(game, seat, { cant, must }) {
  const played = new Set();
  for (const t of game.tricks) if (t) for (const p of t.cards) played.add(p.card.id);
  for (const p of game.currentTrick) played.add(p.card.id);
  const mine = new Set(game.hands[seat].map((c) => c.id));
  const unseen = makeDeck().filter((c) => !played.has(c.id) && !mine.has(c.id));
  const others = [0, 1, 2, 3].filter((s) => s !== seat);
  for (let attempt = 0; attempt < 30; attempt++) {
    const strict = attempt < 25;
    const hands = [[], [], [], []];
    hands[seat] = game.hands[seat].slice();
    const room = {};
    for (const s of others) room[s] = game.hands[s].length;
    const pool = [];
    for (const c of unseen) {
      const owner = others.find((s) => must[s].has(c.id));
      if (owner !== undefined && room[owner] > 0) { hands[owner].push(c); room[owner]--; }
      else pool.push(c);
    }
    // Most constrained cards first, each to a random seat that may hold it.
    const opts = (c) => others.filter((s) => room[s] > 0 && (!strict || !cant[s].has(c.id)));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    pool.sort((a, b) => opts(a).length - opts(b).length);
    let ok = true;
    for (const c of pool) {
      const o = opts(c);
      if (!o.length) { ok = false; break; }
      // Weight by free room so short hands aren't overfilled early.
      let r = Math.random() * o.reduce((n, s) => n + room[s], 0), pick = o[0];
      for (const s of o) { r -= room[s]; if (r < 0) { pick = s; break; } }
      hands[pick].push(c); room[pick]--;
    }
    if (ok) return hands;
  }
  return null;
}

// Play `card`, then finish the round with every seat using the quick player. Score from the
// bot's side: game points won minus lost this round, with card points breaking near-ties.
function playOut(game, hands, seat, card, team) {
  const g = Object.create(Object.getPrototypeOf(game));
  Object.assign(g, {
    targetScore: Infinity, rng: Math.random, strict: true, listeners: [],
    score: { A: 0, B: 0 }, dealer: game.dealer, round: game.round, phase: "playing",
    mode: game.mode, trump: game.trump, declarer: game.declarer, multiplier: game.multiplier,
    gahwa: false, locked: game.locked, doubler: game.doubler, flip: game.flip,
    projects: game.projects.slice(), projectTeam: game.projectTeam, projectCandidates: [[], [], [], []],
    fouls: [], ekkaTeams: [], balootSeat: game.balootSeat, balootDeclared: game.balootDeclared,
    tricks: game.tricks.slice(), currentTrick: game.currentTrick.slice(), turn: game.turn,
    wonCards: { A: game.wonCards.A.slice(), B: game.wonCards.B.slice() }, lastTrickTeam: game.lastTrickTeam,
    hands: hands.map((h) => h.slice()),
  });
  g.play(seat, card.id, { ekka: ekkaHolds(g, card) });
  while (g.phase === "playing") {
    const s = g.turn;
    const c = chooseCardQuick(g, s);
    g.play(s, c.id, { ekka: ekkaHolds(g, c) });
  }
  const r = g.lastRoundResult;
  const other = team === "A" ? "B" : "A";
  return (r.gp[team] - r.gp[other]) + 0.02 * (r.raw[team] - r.raw[other]);
}

// Inside the look-ahead every hand is known: a lead says إكة exactly when it's right.
function ekkaHolds(g, card) {
  if (g.mode !== "hokom" || g.currentTrick.length || card.suit === g.trump || card.rank === "A") return false;
  const st = cardStrength(card, g.mode, g.trump);
  return !g.hands.some((h) => h.some((c) => c.suit === card.suit && cardStrength(c, g.mode, g.trump) > st));
}

function chooseLead(game, k, legal) {
  const weBought = TEAM_OF(game.declarer) === k.team;
  const opps = opponents(k);
  const myTrumps = legal.filter((c) => isTrump(k, c));
  const oppsHaveTrumps = trumpsOut(k).length > 0 && opps.some((s) => !k.voids[s].has(k.trump));

  // Buyers pull the opponents' trumps with the boss trump.
  if (weBought && myTrumps.length && oppsHaveTrumps) {
    const top = myTrumps.slice().sort((a, b) => k.str(b) - k.str(a))[0];
    if (isMaster(k, top) && (myTrumps.length >= 2 || game.declarer === k.seat)) return top;
  }

  const side = legal.filter((c) => !isTrump(k, c));
  const pool = side.length ? side : legal;
  // A suit is safe to cash when no opponent can ruff it.
  const ruffable = (suit) => k.mode === "hokom" && suit !== k.trump && trumpsOut(k).length > 0
    && opps.some((s) => k.voids[s].has(suit) && !k.voids[s].has(k.trump));

  // 1. Cash boss cards (Aces, then 10s whose Ace is gone…), richest first.
  const masters = pool.filter((c) => isMaster(k, c) && !ruffable(c.suit)
    && k.unseen.some((u) => u.suit === c.suit || isTrump(k, u)));
  if (masters.length) return masters.sort((a, b) => pts(k, b) - pts(k, a))[0];

  // 2. Let partner ruff: lead a suit partner is out of (and still has trumps) — not trump itself.
  const p = partner(k);
  if (k.mode === "hokom" && !k.voids[p].has(k.trump) && trumpsOut(k).length) {
    const feed = pool.filter((c) => c.suit !== k.trump && k.voids[p].has(c.suit) && !ruffable(c.suit));
    if (feed.length) return lowest(k, feed);
  }

  // 3. Otherwise lead low from a suit where we don't expose an unguarded 10 / K.
  const scored = pool.map((c) => {
    const suitCards = k.hand.filter((x) => x.suit === c.suit);
    let score = -pts(k, c) * 2 - k.str(c) * 0.1;
    // Leading away from an honour that isn't the boss loses it.
    if (suitCards.some((x) => (x.rank === "10" || x.rank === "K") && !isMaster(k, x))) score -= 8;
    if (c.rank === "10" || c.rank === "K") score -= 6;
    if (k.mode === "hokom" && c.suit !== k.trump && suitCards.length === 1 && k.hand.some((x) => isTrump(k, x))) score += 4; // make a void to ruff later
    if (ruffable(c.suit)) score -= 5;
    if (isTrump(k, c)) score -= weBought ? 2 : 10;   // defenders rarely lead trumps
    return { c, score };
  });
  return scored.sort((a, b) => b.score - a.score)[0].c;
}

function chooseFollow(game, k, legal) {
  const trick = game.currentTrick;
  const led = trick[0].card.suit;
  const win = game.currentWinningInfo();
  const partnerWinning = win.team === k.team;
  const last = trick.length === 3;
  const trickPts = trick.reduce((s, p) => s + pts(k, p.card), 0);
  const following = legal.some((c) => c.suit === led);

  if (partnerWinning) {
    const safe = last || holds(game, k, win.card, led);
    if (safe) return feed(k, legal, led);
    // Partner may be beaten: take over with a boss card if that keeps it ours, else stay low.
    const over = legal.filter((c) => k.str(c) > win.strength && (c.suit === led || isTrump(k, c)) && holds(game, k, c, led));
    if (over.length && trickPts >= 10) return cheapestWinner(k, over);
    return discard(k, legal, led);
  }

  // Opponent winning.
  const beats = legal.filter((c) => (c.suit === led || isTrump(k, c)) && k.str(c) > win.strength);
  if (beats.length) {
    if (last) {
      // Take it with the card worth keeping least.
      return beats.slice().sort((a, b) => k.str(a) - k.str(b))[0];
    }
    const sure = beats.filter((c) => holds(game, k, c, led));
    if (sure.length) {
      // Win cheaply; with a following trick partner may still add points.
      return sure.slice().sort((a, b) => k.str(a) - k.str(b))[0];
    }
    // Can't be sure: contest a rich trick with the cheapest winner, else keep big cards.
    const cheap = cheapestWinner(k, beats);
    const risk = pts(k, cheap);
    if (trickPts >= 10 && risk <= 4) return cheap;
    if (trickPts + risk >= 15 && !following && isTrump(k, cheap)) return cheap;
  }
  return discard(k, legal, led);
}

// Partner is taking the trick: give the most points we can spare (not our boss cards).
function feed(k, legal, led) {
  return legal.slice().sort((a, b) => keepValue(k, a, led) - keepValue(k, b, led))[0];
}
function keepValue(k, c, led) {
  let v = -pts(k, c);
  if (isMaster(k, c) && (c.suit !== led || isTrump(k, c))) v += 12;   // a boss wins its own trick later
  if (isTrump(k, c)) v += 15;                       // trumps are worth more held
  return v;
}

// Losing the trick: throw the least useful card.
function discard(k, legal, led) {
  return legal.slice().sort((a, b) => dumpCost(k, a, led) - dumpCost(k, b, led))[0];
}
function dumpCost(k, c, led) {
  let v = pts(k, c) * 2 + k.str(c) * 0.05;
  if (isMaster(k, c)) v += 15;
  if (isTrump(k, c) && c.suit !== led) v += 20;
  const suitCards = k.hand.filter((x) => x.suit === c.suit);
  // Keep a low card guarding a 10 / K that isn't the boss yet.
  if (c.suit !== led && suitCards.length === 2 && suitCards.some((x) => x !== c && (x.rank === "10" || x.rank === "K") && !isMaster(k, x))) v += 6;
  // Throwing the last card of a short suit (to ruff later) is good in Hokom.
  if (k.mode === "hokom" && c.suit !== led && suitCards.length === 1) v -= 2;
  return v;
}

// A bot says بلوت when it plays the second of its trump K / Q.
export function shouldSayBaloot(game, seat, card) {
  if (!game.canDeclareBaloot(seat) || card.suit !== game.trump || (card.rank !== "K" && card.rank !== "Q")) return false;
  const other = card.rank === "K" ? "Q" : "K";
  return !game.hands[seat].some((c) => c.suit === game.trump && c.rank === other);
}

// A bot says إكة when it leads the boss card of a side suit (an Ace needs no call). It never
// says it wrongly, so its partner is only freed from trumping when the lead really holds.
export function shouldSayEkka(game, seat, card) {
  if (!game.canSayEkka(seat) || card.suit === game.trump || card.rank === "A") return false;
  const k = knowledge(game, seat);
  return isMaster(k, card) && !k.hand.some((c) => c.suit === card.suit && k.str(c) > k.str(card));
}

// قيد: a bot calls it once an opponent's foul is proven — they later played a card they were
// obliged to play earlier, or said إكة while a higher card was out and that card has since been
// played or sits in the bot's own hand. Returns true when the bot at `seat` should call it.
export function seesRevoke(game, seat) {
  if (!game.canClaimQaid(seat)) return false;
  const team = TEAM_OF(seat);
  const playedAfter = (s, trickNo) => {
    const ids = new Set();
    game.tricks.forEach((t, i) => { if (t && i >= trickNo) for (const p of t.cards) if (s === null || p.seat === s) ids.add(p.card.id); });
    for (const p of game.currentTrick) if (s === null || p.seat === s) ids.add(p.card.id);
    return ids;
  };
  const mine = new Set(game.hands[seat].map((c) => c.id));
  return game.fouls.some((f) => {
    if (TEAM_OF(f.seat) === team) return false;
    if (f.ekka) {
      const seen = playedAfter(null, f.trick);
      return f.higher.some((id) => mine.has(id) || seen.has(id));
    }
    if (!f.required) return false;
    const later = playedAfter(f.seat, f.trick);
    later.delete(f.card.id);
    return f.required.some((id) => later.has(id));
  });
}
