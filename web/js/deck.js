// Baloot deck & constants — original implementation of the traditional (public-domain) game.
// 32-card deck: ranks 7,8,9,10,J,Q,K,A in four suits.

export const SUITS = ["spades", "hearts", "diamonds", "clubs"];

export const SUIT_INFO = {
  spades:   { symbol: "♠", ar: "البستوني", color: "black" },
  hearts:   { symbol: "♥", ar: "الكبّة",   color: "red" },
  diamonds: { symbol: "♦", ar: "الديناري", color: "red" },
  clubs:    { symbol: "♣", ar: "السباتي",  color: "black" },
};

export const RANKS = ["7", "8", "9", "10", "J", "Q", "K", "A"];

export const RANK_AR = { "7": "٧", "8": "٨", "9": "٩", "10": "١٠", J: "ولد", Q: "بنت", K: "شايب", A: "إيس" };
// Standard international rank labels shown on the cards.
export const RANK_LABEL = { "7": "7", "8": "8", "9": "9", "10": "10", J: "J", Q: "Q", K: "K", A: "A" };

// --- Ranking orders (index 0 = strongest) ---
export const ORDER_SUN      = ["A", "10", "K", "Q", "J", "9", "8", "7"]; // no-trump
export const ORDER_TRUMP    = ["J", "9", "A", "10", "K", "Q", "8", "7"]; // trump suit in Hokom
export const ORDER_PLAIN    = ["A", "10", "K", "Q", "J", "9", "8", "7"]; // non-trump suit in Hokom
export const ORDER_SEQ      = ["A", "K", "Q", "J", "10", "9", "8", "7"]; // sequences for projects (سرا/خمسين/مية)

// --- Card point values ---
export const POINTS_SUN   = { A: 11, "10": 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 };      // ×? handled in scoring
export const POINTS_TRUMP = { J: 20, "9": 14, A: 11, "10": 10, K: 4, Q: 3, "8": 0, "7": 0 };    // trump suit (Hokom)
export const POINTS_PLAIN = { A: 11, "10": 10, K: 4, Q: 3, J: 2, "9": 0, "8": 0, "7": 0 };       // non-trump (Hokom)

export function makeDeck() {
  const deck = [];
  for (const s of SUITS) for (const r of RANKS) deck.push({ suit: s, rank: r, id: `${r}_${s}` });
  return deck;
}

export function shuffle(deck, rng = Math.random) {
  const a = deck.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Strength of a card within the current contract (higher = stronger), used to resolve tricks.
// mode: "sun" | "hokom". trump: suit string (only for hokom).
export function cardStrength(card, mode, trump) {
  if (mode === "hokom" && card.suit === trump) {
    return 100 - ORDER_TRUMP.indexOf(card.rank); // trump beats everything
  }
  const order = mode === "sun" ? ORDER_SUN : ORDER_PLAIN;
  return 50 - order.indexOf(card.rank);
}

export function cardPoints(card, mode, trump) {
  if (mode === "sun") return POINTS_SUN[card.rank];
  return card.suit === trump ? POINTS_TRUMP[card.rank] : POINTS_PLAIN[card.rank];
}

export function cardLabel(card) {
  const info = SUIT_INFO[card.suit];
  return `${RANK_AR[card.rank]}${info.symbol}`;
}
