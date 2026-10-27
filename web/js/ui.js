import { BalootGame, TEAM_OF, BID_PHASES, PROJECT_AR } from "./engine.js";
import { chooseBid, chooseCard } from "./ai.js";
import { SUIT_INFO, RANK_AR, RANK_LABEL, SUITS } from "./deck.js";
import { initFirebase, onUserChange, signIn, signUp, logout, state, placeStake, awardWin, logMatch } from "./auth.js";
import { BET_TIERS, COINS_ON_WIN } from "./firebase-config.js";

const HUMAN = 0;              // the human player's seat
const $ = (id) => document.getElementById(id);
let game = null;
let busy = false;             // prevents input while bots act / animations run
let currentStake = 0;         // chosen stake for the next match
let matchStake = 0;           // stake locked in for the running match

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

// ---------- Auth wiring ----------
$("btn-logout").onclick = async () => { await logout(); };
$("btn-admin").onclick = () => { location.href = "admin.html"; };
$("link-login").onclick = (e) => { e.preventDefault(); show("screen-auth"); };
$("btn-auth-guest").onclick = () => { renderWallet(null); show("screen-home"); };

let authMode = "login";
document.querySelectorAll(".auth-tab").forEach((tab) => {
  tab.onclick = () => {
    authMode = tab.dataset.tab;
    document.querySelectorAll(".auth-tab").forEach((t) => t.classList.toggle("active", t === tab));
    $("auth-name").style.display = authMode === "register" ? "block" : "none";
    $("btn-auth-submit").textContent = authMode === "register" ? "إنشاء الحساب" : "دخول";
    $("auth-error").textContent = "";
  };
});

$("btn-auth-submit").onclick = async () => {
  const email = $("auth-email").value.trim();
  const pass = $("auth-pass").value;
  const name = $("auth-name").value.trim();
  $("auth-error").textContent = "";
  if (!email || !pass) { $("auth-error").textContent = "اكتب الإيميل وكلمة السر"; return; }
  try {
    if (authMode === "register") await signUp(email, pass, name || undefined);
    else await signIn(email, pass);
    // onUserChange will route to home
  } catch (err) {
    $("auth-error").textContent = translateAuthError(err);
  }
};

function translateAuthError(err) {
  const c = (err && err.code) || "";
  if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found")) return "الإيميل أو كلمة السر غير صحيحة";
  if (c.includes("email-already-in-use")) return "هذا الإيميل مسجّل مسبقاً";
  if (c.includes("weak-password")) return "كلمة السر قصيرة (٦ أحرف على الأقل)";
  if (c.includes("invalid-email")) return "صيغة الإيميل غير صحيحة";
  return "صار خطأ، حاول مرة ثانية";
}

function renderWallet(profile) {
  const stakeRow = $("stake-row");
  if (profile) {
    $("wallet-name").textContent = profile.name;
    $("wallet-coins").textContent = profile.coins;
    $("btn-logout").style.display = "block";
    $("link-login").style.display = "none";
    $("btn-admin").style.display = profile.isAdmin ? "block" : "none";
    if (COINS_ON_WIN) { stakeRow.style.display = "flex"; renderStakeChips(); }
    else stakeRow.style.display = "none";
  } else {
    $("wallet-name").textContent = "ضيف";
    $("wallet-coins").textContent = "—";
    $("btn-logout").style.display = "none";
    $("btn-admin").style.display = "none";
    $("link-login").style.display = state.configured ? "block" : "none";
    stakeRow.style.display = "none";
    currentStake = 0;
  }
}

function renderStakeChips() {
  const box = $("stake-chips");
  box.innerHTML = "";
  if (!BET_TIERS.includes(currentStake)) currentStake = BET_TIERS[0];
  for (const tier of BET_TIERS) {
    const b = document.createElement("button");
    b.className = "stake-chip" + (tier === currentStake ? " active" : "");
    b.textContent = tier === 0 ? "تدريب" : tier;
    b.onclick = () => { currentStake = tier; renderStakeChips(); };
    box.appendChild(b);
  }
}

async function boot() {
  const configured = await initFirebase();
  if (!configured) { renderWallet(null); show("screen-home"); return; } // guest mode
  onUserChange((user) => {
    if (user) { renderWallet(state.profile); show("screen-home"); }
    else { renderWallet(null); show("screen-auth"); }
  });
}
boot();

// ---------- Start ----------
async function startGame() {
  matchStake = 0;
  if (COINS_ON_WIN && state.profile && currentStake > 0) {
    if ((state.profile.coins || 0) < currentStake) { alert("رصيدك لا يكفي لهذا الرهان"); return; }
    try { await placeStake(currentStake); matchStake = currentStake; }
    catch (e) { alert("تعذّر حجز الرهان، حاول مرة ثانية"); return; }
  }
  game = new BalootGame({ targetScore: 152 });
  game.on(onEvent);
  show("screen-game");
  render();
  maybeBotTurn();
}

// ---------- Event handling ----------
function onEvent(ev) {
  switch (ev.type) {
    case "bid": if (ev.seat !== HUMAN && ev.action.kind !== "pass") toast(`${seatName(ev.seat)}: ${bidLabel(ev.action)}`); break;
    case "contract": toast(contractText(ev.mode, ev.trump) + (ev.declarer === HUMAN ? " · أنت الشاري" : ` · الشاري ${seatName(ev.declarer)}`)); break;
    case "play-start": { const t = playStartText(ev); if (t) toast(t, 3200); break; }
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
  $("contract-badge").textContent = game.mode ? contractText(game.mode, game.trump) + multText(game) : "—";

  renderHand();
  renderOpponents();
  renderTrick();
  renderTurn();
  renderBidPanel();
}

function cardSrc(card) { return `assets/cards/${card.rank}_${card.suit}.svg`; }

function cardEl(card, { playable = false } = {}) {
  const el = document.createElement("div");
  el.className = "card" + (playable ? " playable" : "");
  el.innerHTML = `<img class="card-face" src="${cardSrc(card)}" alt="" draggable="false">`;
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
    else if (game.phase === "playing") el.classList.add("disabled"); // dim only during play
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
    const el = document.createElement("div");
    el.className = `trick-card tc-${p.seat}`;
    el.innerHTML = `<img class="card-face" src="${cardSrc(p.card)}" alt="" draggable="false">`;
    area.appendChild(el);
  }
}

function renderTurn() {
  const names = { 0: "دورك", 1: "دور اليمين", 2: "دور شريكك", 3: "دور اليسار" };
  $("turn-indicator").textContent =
    game.phase === "playing" ? (names[game.turn] || "") :
    BID_PHASES.includes(game.phase) ? (game.phase === "doubling" ? "الدبل" : "المزايدة") : "";
}

// ---------- Bidding UI ----------
const SEAT_NAME = { 0: "أنت", 1: "يمين", 2: "شريكك", 3: "يسار" };
// Online: the real player names (seat 0 is always "you").
const seatName = (s) => (s !== HUMAN && game && game.online ? game.seatName(s) : SEAT_NAME[s]);

function bidLabel(a) {
  switch (a.kind) {
    case "hokom": return "حكم " + SUIT_INFO[a.suit].symbol;
    case "sun": return "صن";
    case "ashkal": return "أشكال";
    case "pass": return "بس";
    case "double": return game.mode === "sun" ? "دبل" : a.locked ? "دبل مقفول" : "دبل مفتوح";
    case "triple": return "ثري";
    case "four": return a.locked ? "فور مقفول" : "فور مفتوح";
    case "gahwa": return "قهوة ☕";
  }
  return a.kind;
}

function bidTitle() {
  switch (game.phase) {
    case "bidding1": return "الدور الأول — تشتري؟";
    case "bidding2": return "الدور الثاني — حكم ثاني أو صن";
    case "sunCheck": return `${seatName(game.hokomBidder)} اشترى حكم — تبي صن؟`;
    case "hokomConfirm": return "تثبّت الحكم أو تحوّل صن؟";
    case "doubling": return contractText(game.mode, game.trump) + " · " +
      ({ 1: "تدبل؟", 2: "الخصم دبل — ترد ثري؟", 3: "ردّوا ثري — ترد فور؟", 4: "ردّوا فور — ترد قهوة؟" })[game.multiplier];
  }
  return "المزايدة";
}

function renderBidPanel() {
  const panel = $("bid-panel");
  const showForHuman = BID_PHASES.includes(game.phase) && game.bidTurn === HUMAN && !busy;
  if (!showForHuman) { panel.classList.add("hidden"); return; }
  panel.classList.remove("hidden");   // keep the hand visible so you can judge your cards

  // The revealed card is already in the buyer's hand once doubling starts.
  const flip = $("flip-card");
  flip.className = "flip-card";
  flip.style.display = game.phase === "doubling" ? "none" : "";
  flip.innerHTML = `<img class="card-face" src="${cardSrc(game.flip)}" alt="" draggable="false">`;

  $("bid-title").textContent = bidTitle();
  const box = $("bid-buttons");
  box.innerHTML = "";

  const legal = game.legalBids(HUMAN);
  const suitBids = game.phase === "bidding2" ? legal.filter((a) => a.kind === "hokom") : [];
  for (const a of legal) {
    if (suitBids.includes(a)) continue;
    addBidBtn(box, bidLabel(a), a.kind === "pass" ? "btn-ghost" : "btn-primary", () => doBid(a));
  }
  if (suitBids.length) {
    const pick = document.createElement("div");
    pick.className = "suit-pick";
    for (const a of suitBids) {
      const si = SUIT_INFO[a.suit];
      const b = document.createElement("button");
      b.className = si.color === "red" ? "red" : "";
      b.textContent = si.symbol;
      b.title = "حكم " + si.ar;
      b.onclick = () => doBid(a);
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
  if (BID_PHASES.includes(game.phase) && game.bidTurn !== HUMAN) {
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
const RESULT_TITLE = { normal: "نهاية الجولة", khasara: "قهر! الشاري خسر 🔥", doubled: "نتيجة الدبل", kaboot: "كبوت! 🔥" };

function showRoundResult(ev) {
  const panel = $("result-panel");
  let title = RESULT_TITLE[ev.result];
  if (ev.result === "kaboot") title = ev.winner === "A" ? "كبوت لنا! 🔥" : "كبوت علينا!";
  $("result-title").textContent = title;
  const line = (label, a, b) => (a || b) ? `${label} — لنا ${a} · لهم ${b}<br>` : "";
  $("result-body").innerHTML =
    `العقد: <b>${contractText(game.mode, game.trump)}${multText(game)}</b><br>` +
    line("الأبناط", ev.raw.A, ev.raw.B) +
    line("المشاريع", ev.proj.A, ev.proj.B) +
    line("البلوت", ev.bal.A, ev.bal.B) +
    `<span class="big">لنا +${ev.gp.A} · لهم +${ev.gp.B}</span><br>` +
    `المجموع: لنا ${game.score.A} · لهم ${game.score.B}`;
  $("btn-next").textContent = "الجولة التالية";
  panel.classList.remove("hidden");
}

async function showMatchResult(ev) {
  const panel = $("result-panel");
  const weWon = ev.winner === "A";
  let coinLine = "";
  if (matchStake > 0) {
    if (weWon) {
      const prize = matchStake * 2;
      try { await awardWin(prize); } catch (_) {}
      logMatch(matchStake, true);
      coinLine = `<br><span class="big">🪙 +${prize}</span>`;
    } else {
      logMatch(matchStake, false);
      coinLine = `<br>🪙 خسرت رهانك (${matchStake})`;
    }
  }
  matchStake = 0;
  $("result-title").textContent = weWon ? "فزنا! 🏆" : "خسرنا";
  $("result-body").innerHTML =
    `<span class="big">${ev.score.A} — ${ev.score.B}</span><br>` +
    (weWon ? "مبروك الفوز!" : "حظ أوفر المرة الجاية") + coinLine;
  $("btn-next").textContent = "رجوع للرئيسية";
  panel.classList.remove("hidden");
}

// ---------- Helpers ----------
function multText(g) {
  if (g.gahwa) return " · قهوة ☕";
  const m = { 2: " · دبل", 3: " · ثري", 4: " · فور" }[g.multiplier] || "";
  return m && g.mode === "hokom" && g.multiplier !== 3 ? m + (g.locked ? " مقفول" : " مفتوح") : m;
}

function playStartText(ev) {
  const parts = [];
  if (ev.projects.length) {
    const who = TEAM_OF(ev.projects[0].seat) === "A" ? "لنا" : "لهم";
    parts.push(`مشاريع ${who}: ` + ev.projects.map((p) => `${PROJECT_AR[p.type]} (${seatName(p.seat)})`).join("، "));
  }
  if (ev.balootSeat !== null) parts.push(`بلوت مع ${seatName(ev.balootSeat)}`);
  return parts.join(" · ");
}

function contractText(mode, trump) {
  if (mode === "sun") return "صن";
  if (mode === "hokom") return "حكم " + (trump ? SUIT_INFO[trump].symbol : "");
  return "—";
}
let toastTimer;
function toast(msg, ms = 1900) {
  const t = $("toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), ms);
}
