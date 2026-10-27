// Simple heuristic computer player for Baloot. Not world-class, but plays sensibly:
// bids on strong hands, follows the rules, wins tricks it can cheaply, and dumps low otherwise.
import { cardStrength, cardPoints, SUITS } from "./deck.js";
import { TEAM_OF } from "./engine.js";

// --- Bidding ---
export function chooseBid(game, seat) {
  const hand = game.hands[seat];

  if (game.phase === "bidding1") {
    // Buy the flipped suit as trump if we have good strength in it.
    const suit = game.flip.suit;
    const strength = suitHokomStrength(hand, suit);
    return strength >= 9 ? { kind: "hokom-flip" } : { kind: "pass" };
  }

  // bidding2: choose Sun, Hokom (best suit), or pass.
  const sunScore = sunStrength(hand);
  let bestSuit = null, bestVal = -1;
  for (const s of SUITS) {
    const v = suitHokomStrength(hand, s);
    if (v > bestVal) { bestVal = v; bestSuit = s; }
  }
  if (bestVal >= 10) return { kind: "hokom", suit: bestSuit };
  if (sunScore >= 11) return { kind: "sun" };
  if (bestVal >= 8) return { kind: "hokom", suit: bestSuit };
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
  const legal = game.legalMoves(seat);
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
