import { BalootGame, TEAM_OF } from "./engine.js";
import { chooseBid, chooseCard } from "./ai.js";
import { SUIT_INFO, RANK_AR, SUITS } from "./deck.js";

const HUMAN = 0;              // the human player's seat
const $ = (id) => document.getElementById(id);
let game = null;
let busy = false;             // prevents input while bots act / animations run

// ---------- Screen routing ----------
function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screen).classList.add("active");
}
$("btn-play-cpu").onclick = startGame;
$("btn-how").onclick = () => show("screen-how");
$("btn-how-back").onclick = () => show("screen-home");
$("btn-home").onclick = () => { show("screen-home"); };
$("btn-next").onclick = () => { $("result-panel").classList.add("hidden"); if (game.phase === "matchEnd") show("screen-home"); else { game.nextRound(); } };
show("screen-home");

// ---------- Start ----------
function startGame() {
  game = new BalootGame({ targetScore: 152 });
  game.on(onEvent);
  show("screen-game");
  render();
  maybeBotTurn();
}

// ---------- Event handling ----------
function onEvent(ev) {
  switch (ev.type) {
    case "contract": toast(contractText(ev.mode, ev.trump) + (ev.declarer === HUMAN ? " · أنت الشاري" : "")); break;
    case "trick-won": break;
    case "round-end": showRoundResult(ev); break;
    case "match-end": showMatchResult(ev); break;
    case "redeal": toast("الكل باس — توزيع جديد"); break;
  }
  render();
}

// ---------- Rendering ----------
function render() {
  if (!game) return;
  $("score-us").textContent = game.score.A;
  $("score-them").textContent = game.score.B;
  $("contract-badge").textContent = game.mode ? contractText(game.mode, game.trump) : "—";

  renderHand();
  renderOpponents();
  renderTrick();
  renderTurn();
  renderBidPanel();
}

function cardEl(card, { playable = false } = {}) {
  const info = SUIT_INFO[card.suit];
  const el = document.createElement("div");
  el.className = "card" + (info.color === "red" ? " red" : "") + (playable ? " playable" : "");
  el.innerHTML =
    `<div class="cap">${RANK_AR[card.rank]}<br>${info.symbol}</div>` +
    `<div class="pip">${info.symbol}</div>` +
    `<div class="cap bottom">${RANK_AR[card.rank]}<br>${info.symbol}</div>`;
  return el;
}

function renderHand() {
  const wrap = $("hand-0");
  wrap.innerHTML = "";
  const hand = sortHand(game.hands[HUMAN]);
  const legalIds = new Set(
    (game.phase === "playing" && game.turn === HUMAN && !busy ? game.legalMoves(HUMAN) : []).map((c) => c.id)
  );
  for (const card of hand) {
    const playable = legalIds.has(card.id);
    const el = cardEl(card, { playable });
    if (playable) el.onclick = () => onHumanPlay(card.id);
    else el.classList.add("disabled");
    wrap.appendChild(el);
  }
}

function sortHand(hand) {
  const suitOrder = SUITS;
  const rankOrder = ["A", "10", "K", "Q", "J", "9", "8", "7"];
  return hand.slice().sort(
    (a, b) => suitOrder.indexOf(a.suit) - suitOrder.indexOf(b.suit)
           || rankOrder.indexOf(a.rank) - rankOrder.indexOf(b.rank)
  );
}

function renderOpponents() {
  for (const s of [1, 2, 3]) {
    const el = $("hand-" + s);
    el.innerHTML = "";
    for (let i = 0; i < game.hands[s].length; i++) {
      const b = document.createElement("div"); b.className = "mini-card"; el.appendChild(b);
    }
  }
  for (const s of [0, 1, 2, 3]) {
    const seat = $("seat-" + s);
    if (seat) seat.classList.toggle("active-turn", game.phase === "playing" && game.turn === s);
  }
}

function renderTrick() {
  const area = $("trick-area");
  area.innerHTML = "";
  for (const p of game.currentTrick) {
    const info = SUIT_INFO[p.card.suit];
    const el = document.createElement("div");
    el.className = `trick-card tc-${p.seat}` + (info.color === "red" ? " red" : "");
    el.innerHTML = `${RANK_AR[p.card.rank]}${info.symbol}`;
    area.appendChild(el);
  }
}

function renderTurn() {
  const names = { 0: "دورك", 1: "دور اليمين", 2: "دور شريكك", 3: "دور اليسار" };
  $("turn-indicator").textContent =
    game.phase === "playing" ? (names[game.turn] || "") :
    game.phase.startsWith("bidding") ? "المزايدة" : "";
}

// ---------- Bidding UI ----------
function renderBidPanel() {
  const panel = $("bid-panel");
  const isBidding = game.phase === "bidding1" || game.phase === "bidding2";
  const showForHuman = isBidding && game.bidTurn === HUMAN && !busy;
  document.querySelector(".myhand-wrap").style.visibility = showForHuman ? "hidden" : "visible";
  if (!showForHuman) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");

  const info = SUIT_INFO[game.flip.suit];
  const flip = $("flip-card");
  flip.className = "flip-card" + (info.color === "red" ? " red" : "");
  flip.innerHTML = `${RANK_AR[game.flip.rank]}${info.symbol}`;

  $("bid-title").textContent = game.phase === "bidding1" ? "تشتري حكم؟" : "اختر العقد";
  const box = $("bid-buttons");
  box.innerHTML = "";

  if (game.phase === "bidding1") {
    addBidBtn(box, `حكم ${info.symbol}`, "btn-primary", () => doBid({ kind: "hokom-flip" }));
    addBidBtn(box, "بس", "btn-ghost", () => doBid({ kind: "pass" }));
  } else {
    addBidBtn(box, "صن", "btn-primary", () => doBid({ kind: "sun" }));
    addBidBtn(box, "بس", "btn-ghost", () => doBid({ kind: "pass" }));
    const pick = document.createElement("div");
    pick.className = "suit-pick";
    for (const s of SUITS) {
      const si = SUIT_INFO[s];
      const b = document.createElement("button");
      b.className = si.color === "red" ? "red" : "";
      b.textContent = si.symbol;
      b.title = "حكم " + si.ar;
      b.onclick = () => doBid({ kind: "hokom", suit: s });
      pick.appendChild(b);
    }
    box.appendChild(pick);
  }
}
function addBidBtn(box, label, cls, fn) {
  const b = document.createElement("button");
  b.className = "btn " + cls; b.textContent = label; b.onclick = fn;
  box.appendChild(b);
}
function doBid(action) {
  if (game.bidTurn !== HUMAN) return;
  game.bid(HUMAN, action);
  render();
  maybeBotTurn();
}

// ---------- Human play ----------
function onHumanPlay(cardId) {
  if (busy || game.turn !== HUMAN) return;
  game.play(HUMAN, cardId);
  render();
  afterPlayFlow();
}

// ---------- Bot driver ----------
function maybeBotTurn() {
  // Bidding bots
  if ((game.phase === "bidding1" || game.phase === "bidding2") && game.bidTurn !== HUMAN) {
    busy = true; render();
    setTimeout(() => {
      const action = chooseBid(game, game.bidTurn);
      game.bid(game.bidTurn, action);
      busy = false; render();
      maybeBotTurn();
    }, 650);
    return;
  }
  // Playing bots
  if (game.phase === "playing" && game.turn !== HUMAN) {
    afterPlayFlow();
  }
}

function afterPlayFlow() {
  if (game.phase !== "playing") return;
  if (game.turn === HUMAN) { render(); return; }
  busy = true; render();
  setTimeout(() => {
    const card = chooseCard(game, game.turn);
    game.play(game.turn, card.id);
    render();
    busy = false;
    // small pause if a trick just completed (area cleared)
    afterPlayFlow();
  }, 700);
}

// ---------- Results ----------
function showRoundResult(ev) {
  const panel = $("result-panel");
  $("result-title").textContent = ev.result === "baqi" ? "بقى! 🔥" : "نهاية الجولة";
  const usRaw = ev.raw.A, themRaw = ev.raw.B;
  $("result-body").innerHTML =
    `العقد: <b>${contractText(game.mode, game.trump)}</b><br>` +
    `نقاط الأكلات — لنا ${usRaw} · لهم ${themRaw}<br>` +
    `<span class="big">لنا +${ev.gp.A} · لهم +${ev.gp.B}</span><br>` +
    `المجموع: لنا ${game.score.A} · لهم ${game.score.B}`;
  $("btn-next").textContent = "الجولة التالية";
  panel.classList.remove("hidden");
}

function showMatchResult(ev) {
  const panel = $("result-panel");
  const weWon = ev.winner === "A";
  $("result-title").textContent = weWon ? "فزنا! 🏆" : "خسرنا";
  $("result-body").innerHTML =
    `<span class="big">${ev.score.A} — ${ev.score.B}</span><br>` +
    (weWon ? "مبروك الفوز!" : "حظ أوفر المرة الجاية");
  $("btn-next").textContent = "رجوع للرئيسية";
  panel.classList.remove("hidden");
}

// ---------- Helpers ----------
function contractText(mode, trump) {
  if (mode === "sun") return "صن";
  if (mode === "hokom") return "حكم " + (trump ? SUIT_INFO[trump].symbol : "");
  return "—";
}
let toastTimer;
function toast(msg) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 1900);
}
