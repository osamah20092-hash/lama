// Simple heuristic computer player for Baloot. Not world-class, but plays sensibly:
// bids on strong hands, follows the rules, wins tricks it can cheaply, and dumps low otherwise.
import { cardStrength, cardPoints } from "./deck.js?v=7";
import { TEAM_OF } from "./engine.js?v=7";

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
      return suitHokomStrength(hand, game.flip.suit) >= 9 ? can("hokom") : { kind: "pass" };
    }
    case "bidding2": {
      let best = null, bestVal = -1;
      for (const a of legal.filter((x) => x.kind === "hokom")) {
        const v = suitHokomStrength(hand, a.suit);
        if (v > bestVal) { bestVal = v; best = a; }
      }
      if (bestVal >= 10) return best;
      if (sunScore >= 11) return { kind: "sun" };
      if (bestVal >= 8) return best;
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

function suitHokomStrength(hand, suit) {
  let v = 0;
  for (const c of hand) {
    if (c.suit === suit) {
      v += { J: 6, "9": 5, A: 3, "10": 2, K: 1, Q: 1, "8": 0.5, "7": 0.5 }[c.rank] || 0;
    } else if (c.rank === "A") v += 1.5;
    else if (c.rank === "10") v += 0.5;
  }
  return v;
}

function sunStrength(hand) {
  let v = 0;
  for (const c of hand) v += { A: 4, "10": 3, K: 1.5, Q: 1 }[c.rank] || 0;
  return v;
}

// --- Card play ---
export function chooseCard(game, seat) {
  const legal = game.strictMoves(seat); // bots always play by the rules, even when strict is off
  if (legal.length === 1) return legal[0];

  const trick = game.currentTrick;
  const myTeam = TEAM_OF(seat);

  // Leading the trick.
  if (trick.length === 0) {
    // Lead a high plain Ace/10 to grab points, else lowest card.
    const aces = legal.filter((c) => c.rank === "A" && (game.mode === "sun" || c.suit !== game.trump));
    if (aces.length) return aces[0];
    return lowest(legal, game);
  }

  const winInfo = game.currentWinningInfo();
  const partnerWinning = winInfo && winInfo.team === myTeam;
  const trickPoints = trick.reduce((s, p) => s + cardPoints(p.card, game.mode, game.trump), 0);

  if (partnerWinning) {
    // Partner is taking it: feed points if it's clearly ours, else dump lowest.
    const isLast = trick.length === 3;
    if (isLast && trickPoints >= 0) return highestValue(legal, game);
    return lowest(legal, game);
  }

  // Opponent currently winning → try to beat cheaply.
  const winStrength = winInfo ? winInfo.strength : -1;
  const beats = legal
    .filter((c) => cardStrength(c, game.mode, game.trump) > winStrength)
    .sort((a, b) => cardStrength(a, game.mode, game.trump) - cardStrength(b, game.mode, game.trump));
  if (beats.length && (trickPoints >= 4 || trick.length === 3)) return beats[0]; // cheapest winner
  if (beats.length && beats[0] && cardPoints(beats[0], game.mode, game.trump) === 0) return beats[0];
  return lowest(legal, game);
}

function lowest(cards, game) {
  return cards.slice().sort(
    (a, b) => cardPoints(a, game.mode, game.trump) - cardPoints(b, game.mode, game.trump)
            || cardStrength(a, game.mode, game.trump) - cardStrength(b, game.mode, game.trump)
  )[0];
}
function highestValue(cards, game) {
  return cards.slice().sort(
    (a, b) => cardPoints(b, game.mode, game.trump) - cardPoints(a, game.mode, game.trump)
  )[0];
}
