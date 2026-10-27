import { BalootGame, TEAM_OF, BID_PHASES, PROJECT_AR } from "./engine.js?v=7";
import { chooseBid, chooseCard } from "./ai.js?v=7";
import { SUIT_INFO, RANK_AR, RANK_LABEL, SUITS, cardLabel } from "./deck.js?v=7";
import { initFirebase, onUserChange, signIn, signUp, logout, state, placeStake, awardWin, logMatch } from "./auth.js?v=7";
import { BET_TIERS, COINS_ON_WIN } from "./firebase-config.js?v=7";
import * as rooms from "./rooms.js?v=7";

const $ = (id) => document.getElementById(id);
let ME = 0;                   // my seat; the table is drawn relative to it (me at the bottom)
let game = null;
let busy = false;             // prevents input while bots act / animations run
let currentStake = 0;         // chosen stake for the next match
let matchStake = 0;           // stake locked in for the running match
let online = null;            // private session state (see "Private sessions" below), null offline

const rel = (s) => (s - ME + 4) % 4;                 // 0 me · 1 right · 2 partner · 3 left
const US = () => TEAM_OF(ME);
const THEM = () => (US() === "A" ? "B" : "A");
// Seats this browser plays automatically: offline every seat but mine; online (host) the bot seats.
const isBot = (s) => (online ? !!online.seats[s]?.bot : s !== ME);

// ---------- Screen routing ----------
function show(screen) {
  document.querySelectorAll(".screen").forEach((s) => s.classList.remove("active"));
  $(screen).classList.add("active");
}
$("btn-play-cpu").onclick = startGame;
$("btn-how").onclick = () => show("screen-how");
$("btn-how-back").onclick = () => show("screen-home");
$("btn-home").onclick = () => {
  if (!online) { show("screen-home"); return; }
  if (confirm(online.isHost ? "تبي تنهي الجلسة للكل؟" : "تبي تطلع من الجلسة؟ الكمبيوتر بيكمّل مكانك.")) exitRoom();
};
$("btn-next").onclick = () => {
  $("result-panel").classList.add("hidden");
  if (online) {
    if (game.phase === "matchEnd") { if (online.isHost) hostBackToLobby(); else show("screen-lobby"); }
    else if (online.isHost) { game.nextRound(); maybeBotTurn(); }
    return;
  }
  if (game.phase === "matchEnd") show("screen-home");
  else { game.nextRound(); maybeBotTurn(); }
};

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
    // Fires on every profile update too (e.g. coins) — only route away from splash/auth.
    const routing = $("screen-splash").classList.contains("active") || $("screen-auth").classList.contains("active");
    if (user) {
      renderWallet(state.profile);
      if (routing) { show("screen-home"); openInviteLink(); }
    } else {
      if (online) exitRoom();
      renderWallet(null); show("screen-auth");
    }
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
  ME = 0;
  resetDriver();
  game = new BalootGame({ targetScore: 152 });
  game.on(onEvent);
  enterGameScreen();
  maybeBotTurn();
}

function enterGameScreen() {
  $("result-panel").classList.add("hidden");
  for (const r of [1, 2, 3]) {
    const s = (ME + r) % 4;
    const seat = $("seat-" + r);
    const occ = online ? online.seats[s] : null;
    seat.querySelector(".avatar").textContent = !online || occ?.bot ? "🤖" : "👤";
    seat.querySelector(".name").textContent = online ? (occ?.name || "—") : SEAT_NAME[r];
    // Host: tap a player who dropped off to hand their seat to the computer.
    seat.onclick = online?.isHost && occ && !occ.bot ? () => {
      if (confirm(`تحوّل ${occ.name} للكمبيوتر؟`)) hostRemoveSeat(s, true);
    } : null;
  }
  show("screen-game");
  render();
}

// ---------- Event handling ----------
function onEvent(ev) {
  switch (ev.type) {
    case "bid": if (ev.seat !== ME && ev.action.kind !== "pass") toast(`${seatName(ev.seat)}: ${bidLabel(ev.action, ev.phase)}`); break;
    case "contract": toast(contractText(ev.mode, ev.trump) + (ev.declarer === ME ? " · أنت الشاري" : ` · الشاري ${seatName(ev.declarer)}`)); break;
    case "play-start": { const t = playStartText(ev); if (t) toast(t, 3200); break; }
    case "declare": toast(`${ev.seat === ME ? "أعلنت" : seatName(ev.seat) + ":"} ${ev.types.map((t) => PROJECT_AR[t]).join(" + ")}`); break;
    case "projects": { const t = projectsText(ev.projects); if (t) toast(t, 3200); break; }
    case "qaid": toast(`⚖️ ${seatName(ev.seat)} قيّد — ${ev.correct ? "صح!" : "غلط!"}`, 3000); break;
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
  $("score-us").textContent = game.score[US()];
  $("score-them").textContent = game.score[THEM()];
  $("contract-badge").textContent = game.mode ? contractText(game.mode, game.trump) + multText(game) : "—";

  renderHand();
  renderOpponents();
  renderTrick();
  renderTurn();
  renderBidPanel();
  renderActions();
  renderProjectsShow();
}

function renderActions() {
  const decl = $("btn-declare");
  const canDecl = ME >= 0 && !busy && game.canDeclare(ME);
  decl.style.display = canDecl ? "" : "none";
  if (canDecl) decl.textContent = "📢 أعلن: " + game.projectCandidates[ME].map((p) => PROJECT_AR[p.type]).join(" + ");
  $("btn-qaid").style.display = online && game.strict === false && game.phase === "playing" && ME >= 0 ? "" : "none";
}

$("btn-declare").onclick = () => {
  if (busy || !game.canDeclare(ME)) return;
  if (online && !online.isHost) { sendMove({ kind: "declare" }); return; }
  game.declareProjects(ME);
  render();
};
$("btn-qaid").onclick = () => {
  if (game.phase !== "playing" || !confirm("تقيّد على الخصم؟ لو ما غلطوا، تنقلب الجولة عليكم.")) return;
  if (online && !online.isHost) { sendMove({ kind: "qaid" }); return; }
  game.claimQaid(ME);
  render();
};

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
  const hand = sortHand(game.hands[ME]);
  const legalIds = new Set(
    (game.phase === "playing" && game.turn === ME && !busy && !trickHeld() ? game.legalMoves(ME) : []).map((c) => c.id)
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
  for (const r of [1, 2, 3]) {
    const s = (ME + r) % 4;
    const el = $("hand-" + r);
    el.innerHTML = "";
    for (let i = 0; i < game.hands[s].length; i++) {
      const b = document.createElement("div"); b.className = "mini-card"; el.appendChild(b);
    }
    $("seat-" + r).classList.toggle("active-turn", game.phase === "playing" && game.turn === s);
  }
}

// A completed trick stays on the table for TRICK_HOLD_MS (winner highlighted) before it's collected.
const TRICK_HOLD_MS = 2000;
let trickHold = { n: 0, until: 0 };
// True while the just-completed trick is on display (the next leader can't play yet).
function trickHeld() {
  const n = game.tricks.length;
  if (game.currentTrick.length || !n || !game.tricks[n - 1]) return false;
  if (trickHold.n !== n) { trickHold = { n, until: Date.now() + TRICK_HOLD_MS }; later(render, TRICK_HOLD_MS + 50); }
  return Date.now() < trickHold.until;
}

function renderTrick() {
  const area = $("trick-area");
  area.innerHTML = "";
  let plays = game.currentTrick, winner = null;
  const last = game.tricks[game.tricks.length - 1];
  if (!plays.length && last && (trickHeld() || game.phase !== "playing")) { plays = last.cards; winner = last.winner; }
  for (const p of plays) {
    const el = document.createElement("div");
    el.className = `trick-card tc-${rel(p.seat)}` + (p.seat === winner ? " win" : "");
    el.innerHTML = `<img class="card-face" src="${cardSrc(p.card)}" alt="" draggable="false">`;
    area.appendChild(el);
  }
}

// Second trick: the counted projects are shown to everyone, with their cards.
function renderProjectsShow() {
  const box = $("proj-show");
  const show = game.phase === "playing" && game.tricks.length === 1 ? game.countedProjects() : [];
  box.classList.toggle("hidden", !show.length);
  if (!show.length) return;
  box.innerHTML = show.map((p) =>
    `<div class="proj-row"><b>${p.seat === ME ? "أنت" : seatName(p.seat)}: ${PROJECT_AR[p.type]}</b>` +
    p.cards.map((c) => `<img src="${cardSrc(c)}" alt="">`).join("") + "</div>").join("");
}

function renderTurn() {
  if (hostAway()) { $("turn-indicator").textContent = "⏳ المضيف طلع من الصفحة — اللعب يكمّل لما يرجع"; return; }
  $("turn-indicator").textContent =
    game.phase === "playing" ? (game.turn === ME ? "دورك" : "دور " + seatName(game.turn)) :
    BID_PHASES.includes(game.phase) ? (game.phase === "doubling" ? "الدبل" : "المزايدة") : "";
}

// ---------- Bidding UI ----------
const SEAT_NAME = { 0: "أنت", 1: "يمين", 2: "شريكك", 3: "يسار" };
// Online: the real player names; offline: the position relative to you.
const seatName = (s) => (s !== ME && online ? online.seats[s]?.name || "—" : SEAT_NAME[rel(s)]);

function bidLabel(a, phase = game.phase) {
  const confirming = phase === "hokomConfirm";
  switch (a.kind) {
    case "hokom": return (confirming ? "✔ تأكيد الحكم " : "حكم ") + SUIT_INFO[a.suit].symbol;
    case "sun": return confirming ? "تحويل صن" : "صن";
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
    case "hokomConfirm": return "تأكيد الحكم — تثبّته أو تحوّل صن؟";
    case "doubling": return contractText(game.mode, game.trump) + " · " +
      ({ 1: "تدبل؟", 2: "الخصم دبل — ترد ثري؟", 3: "ردّوا ثري — ترد فور؟", 4: "ردّوا فور — ترد قهوة؟" })[game.multiplier];
  }
  return "المزايدة";
}

function renderBidPanel() {
  const panel = $("bid-panel");
  const showForHuman = BID_PHASES.includes(game.phase) && game.bidTurn === ME && !busy;
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

  const legal = game.legalBids(ME);
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
  if (game.bidTurn !== ME) return;
  if (online && !online.isHost) { sendMove({ kind: "bid", action }); return; }
  game.bid(ME, action);
  render();
  maybeBotTurn();
}

// ---------- Human play ----------
function onHumanPlay(cardId) {
  if (busy || game.turn !== ME) return;
  if (online && !online.isHost) { sendMove({ kind: "play", cardId }); return; }
  game.play(ME, cardId);
  render();
  afterPlayFlow();
}

// Non-host: send the move to the host and wait for the next snapshot.
function sendMove(move) {
  if (move.kind === "play") {
    // Show my card on the table right away; the host's next snapshot confirms it.
    const card = game.hands[ME].find((c) => c.id === move.cardId);
    game.hands[ME] = game.hands[ME].filter((c) => c.id !== move.cardId);
    game.currentTrick = [...game.currentTrick, { seat: ME, card }];
  }
  busy = true; render();
  rooms.sendAction(online.code, ME, move).catch(() => { busy = false; render(); toast("تعذّر الإرسال، حاول مرة ثانية"); });
}

// ---------- Bot driver ----------
// Only the browser that owns the game (offline, or the session host) drives the bots.
// Timers run in a Web Worker: browsers throttle page timers in background tabs (down to once
// a minute), which would stall the whole table when the session host switches tabs.
const later = (() => {
  const cbs = new Map();
  let n = 0, worker = null;
  try {
    worker = new Worker(URL.createObjectURL(new Blob(
      ["onmessage = (e) => setTimeout(() => postMessage(e.data.id), e.data.ms);"], { type: "text/javascript" })));
    worker.onmessage = (e) => { const fn = cbs.get(e.data); cbs.delete(e.data); if (fn) fn(); };
  } catch (_) { worker = null; }
  return (fn, ms) => {
    if (!worker) { const t = setTimeout(fn, ms); return () => clearTimeout(t); }
    const id = ++n;
    cbs.set(id, fn);
    worker.postMessage({ id, ms });
    return () => cbs.delete(id);
  };
})();

let botTimer = null;          // cancel function of the one pending bot move
function botLater(ms, fn) {
  if (botTimer) return;
  const g = game;
  busy = true; render();
  botTimer = later(() => {
    botTimer = null;
    if (game !== g) return;   // left the game meanwhile (resetDriver cleared busy)
    try { fn(); } catch (e) { console.error("bot move failed", e); }
    busy = false; render();
  }, ms);
}

// Fresh driver state for a new or resumed game, so a stale bot timer can't lock input.
function resetDriver() {
  if (botTimer) botTimer();
  botTimer = null;
  busy = false;
}

function maybeBotTurn() {
  if (!game || (online && !online.isHost)) return;
  // Bidding bots
  if (BID_PHASES.includes(game.phase) && isBot(game.bidTurn)) {
    botLater(650, () => {
      if (BID_PHASES.includes(game.phase) && isBot(game.bidTurn)) game.bid(game.bidTurn, chooseBid(game, game.bidTurn));
      setTimeout(maybeBotTurn);
    });
    return;
  }
  // Playing bots
  if (game.phase === "playing" && isBot(game.turn)) {
    afterPlayFlow();
  }
}

function afterPlayFlow() {
  if (!game || game.phase !== "playing") return;
  if (!isBot(game.turn)) { render(); return; }
  // Leading a new trick: wait until the finished one has been seen by everyone.
  const leading = !game.currentTrick.length && game.tricks.length;
  botLater(leading ? TRICK_HOLD_MS + 300 : 700, () => {
    if (game.phase !== "playing" || !isBot(game.turn)) return;
    game.declareProjects(game.turn);   // bots never forget their projects
    game.play(game.turn, chooseCard(game, game.turn).id);
    setTimeout(afterPlayFlow);
  });
}

// ---------- Results ----------
const RESULT_TITLE = { normal: "نهاية الجولة", khasara: "قهر! الشاري خسر 🔥", doubled: "نتيجة الدبل", kaboot: "كبوت! 🔥" };

function showRoundResult(ev) {
  const panel = $("result-panel");
  let title = RESULT_TITLE[ev.result];
  if (ev.result === "kaboot") title = ev.winner === US() ? "كبوت لنا! 🔥" : "كبوت علينا!";
  if (ev.result === "qaid") title = ev.winner === US() ? "قيد صحيح ⚖️ الجولة لنا" : "انقيد علينا ⚖️";
  if (ev.result === "qaidWrong") title = ev.winner === US() ? "قيدهم غلط — الجولة لنا" : "قيدنا غلط — الجولة لهم";
  $("result-title").textContent = title;
  const u = US(), t = THEM();
  const line = (label, v) => (v[u] || v[t]) ? `${label} — لنا ${v[u]} · لهم ${v[t]}<br>` : "";
  const f = ev.qaid?.foul;
  $("result-body").innerHTML =
    (ev.qaid ? `${seatName(ev.qaid.seat)} قيّد · ` +
      (f ? `الغلطة: ${f.seat === ME ? "لعبت" : seatName(f.seat) + " لعب"} ${cardLabel(f.card)}` : "ما فيه غلطة") + "<br>" : "") +
    `العقد: <b>${contractText(game.mode, game.trump)}${multText(game)}</b><br>` +
    line("الأبناط", ev.raw) +
    line("المشاريع", ev.proj) +
    line("البلوت", ev.bal) +
    `<span class="big">لنا +${ev.gp[u]} · لهم +${ev.gp[t]}</span><br>` +
    `المجموع: لنا ${game.score[u]} · لهم ${game.score[t]}`;
  // Online only the host deals the next round.
  $("btn-next").textContent = online && !online.isHost ? "تمام" : "الجولة التالية";
  if (online) online.resultShownAt = Date.now();
  panel.classList.remove("hidden");
}

async function showMatchResult(ev) {
  const panel = $("result-panel");
  const weWon = ev.winner === US();
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
  if (online) coinLine = await collectStake(weWon);
  $("result-title").textContent = weWon ? "فزنا! 🏆" : "خسرنا";
  $("result-body").innerHTML =
    `<span class="big">${ev.score[US()]} — ${ev.score[THEM()]}</span><br>` +
    (weWon ? "مبروك الفوز!" : "حظ أوفر المرة الجاية") + coinLine;
  $("btn-next").textContent = online ? "رجوع للجلسة" : "رجوع للرئيسية";
  panel.classList.remove("hidden");
}

// ---------- Helpers ----------
function multText(g) {
  if (g.gahwa) return " · قهوة ☕";
  const m = { 2: " · دبل", 3: " · ثري", 4: " · فور" }[g.multiplier] || "";
  return m && g.mode === "hokom" && g.multiplier !== 3 ? m + (g.locked ? " مقفول" : " مفتوح") : m;
}

function playStartText(ev) {
  return ev.balootSeat !== null && ev.balootSeat !== undefined ? `بلوت مع ${seatName(ev.balootSeat)}` : "";
}

// After the first trick: which declared projects count.
function projectsText(projects) {
  if (!projects.length) return "";
  const who = TEAM_OF(projects[0].seat) === US() ? "لنا" : "لهم";
  return `مشاريع ${who}: ` + projects.map((p) => `${PROJECT_AR[p.type]} (${seatName(p.seat)})`).join("، ");
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

// =====================================================================
// ---------- Private sessions (جلسات خاصة) ----------
// Friendly tables with friends: create → share code/link → waiting hall → host seats players
// (optional PIN, lock, kick, pick seats/teams) → empty seats become bots → play. No coins.
// The host's browser runs the real game; see rooms.js for the data flow.
// =====================================================================
const PUB_EVENTS = new Set(["bid", "contract", "play-start", "declare", "projects", "qaid", "round-end", "match-end", "redeal"]);

$("btn-private").onclick = () => {
  if (!state.user) {
    alert(state.configured ? "الجلسات الخاصة تحتاج حساب — سجّل دخول أول" : "الجلسات الخاصة تحتاج ربط Firebase");
    if (state.configured) show("screen-auth");
    return;
  }
  openRoomMenu("");
};
$("btn-room-back").onclick = () => show("screen-home");
$("join-code").oninput = (e) => { e.target.value = rooms.normalizeCode(e.target.value); };
let roomStake = 0;
function renderRoomStakeChips() {
  const box = $("room-stake-chips");
  box.innerHTML = "";
  for (const tier of BET_TIERS) {
    const b = document.createElement("button");
    b.className = "stake-chip" + (tier === roomStake ? " active" : "");
    b.textContent = tier === 0 ? "ودّية" : `${tier} 🪙`;
    b.onclick = () => { roomStake = tier; renderRoomStakeChips(); };
    box.appendChild(b);
  }
}
$("opt-strict").onchange = (e) => { $("opt-strict-hint").style.display = e.target.checked ? "none" : "block"; };

$("btn-create-room").onclick = async () => {
  const pin = $("create-pin").value.trim();
  if (pin && !/^\d{4}$/.test(pin)) { roomError("الرمز السري ٤ أرقام"); return; }
  if (roomStake > (state.profile?.coins || 0)) { roomError("رصيدك ما يكفي لهذا الرهان"); return; }
  roomError("");
  try { await enterRoom(await rooms.createRoom({ pin, strict: $("opt-strict").checked, stake: roomStake }), true); }
  catch (e) { console.error(e); roomError("تعذّر إنشاء الجلسة، حاول مرة ثانية"); }
};
$("btn-join-room").onclick = () => joinByCode($("join-code").value, $("join-pin").value.trim());

$("btn-copy-link").onclick = async () => {
  const link = rooms.inviteLink(online.code);
  try { await navigator.clipboard.writeText(link); toastLobby("انتسخ الرابط ✔"); }
  catch (_) { prompt("انسخ الرابط:", link); }
};
$("btn-share-wa").onclick = () => {
  const text = `تعال نلعب بلوت 🃏 رمز الجلسة: ${online.code}\n${rooms.inviteLink(online.code)}`;
  window.open("https://wa.me/?text=" + encodeURIComponent(text), "_blank");
};
$("lobby-lock").onchange = (e) => rooms.updateRoom(online.code, { locked: e.target.checked });
$("btn-start-room").onclick = () => hostStartGame();
$("btn-leave-room").onclick = () => {
  if (online?.isHost && !confirm("خروجك ينهي الجلسة للكل. متأكد؟")) return;
  exitRoom();
};

function roomError(msg) { $("room-error").textContent = msg; }
function toastLobby(msg) { $("lobby-status").textContent = msg; setTimeout(renderLobby, 1500); }

function openRoomMenu(code) {
  roomError("");
  renderRoomStakeChips();
  $("join-code").value = code;
  $("join-pin").value = "";
  $("join-pin").style.display = "none";
  show("screen-room-menu");
}

// Invite links look like ...?room=ABC123 — open the join flow after sign-in.
function openInviteLink() {
  const code = rooms.normalizeCode(new URLSearchParams(location.search).get("room"));
  if (code) { openRoomMenu(code); joinByCode(code, ""); }
}

async function joinByCode(raw, pin) {
  const code = rooms.normalizeCode(raw);
  roomError("");
  if (code.length !== 6) { roomError("الرمز ٦ خانات"); return; }
  try {
    const room = await rooms.getRoom(code);
    if (!room || room.status === "closed") { roomError("ما لقينا جلسة بهذا الرمز، أو انتهت"); return; }
    if (room.hostUid === state.user.uid) { await enterRoom(code, true); return; }
    const seated = room.seats.some((s) => s && s.uid === state.user.uid);
    if (!seated && room.locked) { roomError("الجلسة مقفلة 🔒"); return; }
    const stake = room.options?.stake || 0;
    if (!seated && stake > (state.profile?.coins || 0)) { roomError(`الجلسة برهان ${stake} 🪙 ورصيدك ما يكفي`); return; }
    if (!seated && room.hasPin && !pin) {
      $("join-pin").style.display = "block";
      $("join-pin").focus();
      roomError("الجلسة محمية برمز سري — اكتبه واضغط انضم");
      return;
    }
    await rooms.joinRoom(code, pin);
    await enterRoom(code, false);
  } catch (e) {
    roomError(e.message === "kicked" ? "المضيف طلّعك من هذي الجلسة" : "تعذّر الانضمام، حاول مرة ثانية");
  }
}

async function enterRoom(code, isHost) {
  online = {
    code, isHost, room: null, seats: [null, null, null, null], members: [], unsubs: [],
    pin: "", pub: null, hand: null, lastSeq: null, seq: 0, events: [], seen: false,
  };
  ME = -1;
  game = null;
  history.replaceState(null, "", "?room=" + code);
  $("lobby-code").textContent = code;
  show("screen-lobby");

  if (isHost) {
    const cfg = await rooms.readConfig(code);
    online.pin = cfg.pin || "";
    const room = await rooms.getRoom(code);
    online.room = room;
    if (room.status === "playing" && cfg.engine) hostResume(room, cfg.engine);   // host refreshed mid-game
    online.unsubs.push(rooms.watchMembers(code, hostSyncMembers));
    online.unsubs.push(rooms.watchActions(code, hostOnAction));
    startHostPing();
  } else {
    online.unsubs.push(rooms.watchMyMember(code, onMyMember));
    online.unsubs.push(rooms.watchMyHand(code, (hand) => {
      if (!online) return;
      online.hand = hand;
      if (online.pub && ME >= 0) { game = rooms.viewGame(online.pub, ME, myCards()); render(); }
    }));
  }
  online.unsubs.push(rooms.watchRoom(code, onRoom));
}

// My cards from the private hand doc, only if it's for the seat I'm in now.
const myCards = () => (online.hand && online.hand.seat === ME ? online.hand.cards : []);

function exitRoom(msg) {
  if (!online) return;
  const { code, isHost, unsubs } = online;
  unsubs.forEach((u) => u());
  stopHostPing();
  if (isHost) rooms.updateRoom(code, { status: "closed" }).catch(() => {});
  else rooms.leaveRoom(code);
  online = null; game = null; ME = 0;
  resetDriver();
  $("result-panel").classList.add("hidden");
  history.replaceState(null, "", location.pathname);
  show("screen-home");
  if (msg) alert(msg);
}

function onMyMember(m) {
  if (!online) return;
  if (m) online.seen = true;
  if (m?.kicked) { exitRoom("المضيف طلّعك من الجلسة"); return; }
  if (m?.pinWrong) {
    const code = online.code;
    exitRoom();
    openRoomMenu(code);
    $("join-pin").style.display = "block";
    roomError("الرمز السري غلط");
    return;
  }
  if (!m && online.seen) exitRoom("طلعت من الجلسة");
}

function onRoom(room) {
  if (!online) return;
  online.lastRoomAt = Date.now();   // any snapshot (moves or the host's ping) means the host is alive
  if (!room || room.status === "closed") { if (!online.isHost) exitRoom("المضيف أنهى الجلسة"); return; }
  const prevMe = ME;
  online.room = room;
  online.seats = room.seats;
  ME = room.seats.findIndex((s) => s && s.uid === state.user.uid);

  if (room.status === "lobby") {
    online.pub = null;
    // Stay on the game screen while the final result is still showing.
    if (!$("screen-game").classList.contains("active") || $("result-panel").classList.contains("hidden")) show("screen-lobby");
    renderLobby();
    return;
  }
  // playing
  if (online.isHost) return;                  // the host renders its own engine
  if (ME < 0 || !room.state) { show("screen-lobby"); renderLobby(); return; }
  const pub = JSON.parse(room.state);
  const first = online.lastSeq === null || prevMe !== ME;
  if (online.pub && pub.round !== online.pub.round) {
    // The host dealt again: close the round result, but give it at least 4s on screen.
    const left = 4000 - (Date.now() - (online.resultShownAt || 0));
    later(() => { if (game?.phase !== "roundEnd") $("result-panel").classList.add("hidden"); }, Math.max(0, left));
  }
  online.pub = pub;
  busy = false;
  game = rooms.viewGame(pub, ME, myCards());
  if (!$("screen-game").classList.contains("active")) enterGameScreen();
  payStakeOnce();
  // Replay the host's events we haven't seen (toasts, round results). Skip history on first sight.
  for (const e of pub.events || []) if (!first && e.seq > online.lastSeq) onEvent(e.ev);
  online.lastSeq = Math.max(online.lastSeq ?? 0, ...(pub.events || []).map((e) => e.seq));
  render();
}

function renderLobby() {
  if (!online || !online.room) return;
  const { room, isHost } = online;
  const waiting = online.members.filter((m) => !m.kicked && !room.seats.some((s) => s && s.uid === m.uid));
  for (let i = 0; i < 4; i++) {
    const box = $("lobby-seat-" + i);
    const s = room.seats[i];
    box.innerHTML = "";
    const el = document.createElement("div");
    if (s) {
      el.className = "lobby-seat" + (s.uid && s.uid === state.user.uid ? " me" : "");
      el.textContent = (s.bot ? "🤖 " : "") + s.name + (s.uid === room.hostUid ? " 👑" : "");
      if (isHost && s.uid !== state.user.uid && room.status === "lobby") {
        const k = document.createElement("button");
        k.className = "kick"; k.textContent = "✕"; k.title = "طرد";
        k.onclick = () => { if (s.bot || confirm(`تطرد ${s.name}؟`)) hostRemoveSeat(i, false); };
        el.appendChild(k);
      }
    } else {
      el.className = "lobby-seat empty";
      el.textContent = "فاضي";
      if (room.status === "lobby" && (isHost || ME >= 0)) {
        el.classList.add("clickable");
        el.textContent += " · اجلس هنا";
        el.onclick = () => (isHost ? hostMoveSeat(room.hostUid, i) : rooms.requestSeat(online.code, i));
      }
    }
    box.appendChild(el);
  }
  $("lock-row").style.display = isHost ? "flex" : "none";
  $("lobby-lock").checked = !!room.locked;
  const empty = room.seats.filter((s) => !s).length;
  $("btn-start-room").style.display = isHost && room.status === "lobby" ? "block" : "none";
  $("btn-start-room").textContent = empty ? `ابدأ اللعب (الكمبيوتر يكمّل ${empty})` : "ابدأ اللعب";

  let status;
  if (room.status === "playing") status = ME < 0 ? "الجلسة بدأت — انتظر الصكة الجاية" : "اللعب شغّال…";
  else if (ME < 0) status = room.seats.every(Boolean) ? "الطاولة مكتملة — انتظر المضيف" : "بانتظار المضيف يجلسك…";
  else status = isHost ? "أرسل الرمز لربعك، واضغط ابدأ لما تجهزون" : "بانتظار المضيف يبدأ…";
  if (isHost && waiting.length) status += ` · بالانتظار: ${waiting.map((m) => m.name).join("، ")}`;
  if (room.hasPin) status += " · 🔑 محمية برمز";
  const opts = room.options || {};
  status += opts.stake ? ` · رهان ${opts.stake} 🪙` : " · ودّية";
  if (opts.strict === false) status += " · لعب حر + قيد";
  if (hostAway()) status = "⏳ المضيف طلع من الصفحة — انتظره يرجع";
  $("lobby-status").textContent = status;
}

// ---------- Host side ----------
function hostSaveSeats(seats) {
  online.seats = seats;
  return rooms.updateRoom(online.code, { seats });
}

// The waiting hall changed: seat newcomers, honour seat-change requests, free seats of leavers.
async function hostSyncMembers(list) {
  if (!online) return;
  online.members = list;
  const room = online.room;
  const seats = online.seats.slice();
  const lobby = room.status === "lobby";
  let changed = false;

  for (const m of list) {
    if (m.kicked) continue;
    const at = seats.findIndex((s) => s && s.uid === m.uid);
    if (at < 0) {
      if (!lobby || room.locked) continue;
      if (online.pin && m.pin !== online.pin) {
        if (!m.pinWrong) rooms.setMember(online.code, m.uid, { pinWrong: true });
        continue;
      }
      const want = Number.isInteger(m.wantSeat) && !seats[m.wantSeat] ? m.wantSeat : seats.findIndex((s) => !s);
      if (want < 0) continue;
      seats[want] = { uid: m.uid, name: m.name };
      changed = true;
    } else if (lobby && Number.isInteger(m.wantSeat) && m.wantSeat !== at) {
      if (!seats[m.wantSeat]) { seats[m.wantSeat] = seats[at]; seats[at] = null; changed = true; }
      rooms.setMember(online.code, m.uid, { wantSeat: null });
    }
  }
  // Players who left (member entry deleted): free the seat, or hand it to the computer mid-game.
  const present = new Set(list.filter((m) => !m.kicked).map((m) => m.uid));
  seats.forEach((s, i) => {
    if (!s || s.bot || s.uid === room.hostUid || present.has(s.uid)) return;
    seats[i] = lobby ? null : { bot: true, name: s.name + " 🤖" };
    changed = true;
  });
  if (changed) {
    await hostSaveSeats(seats);
    if (!lobby && game) { enterGameScreen(); maybeBotTurn(); }
  }
  renderLobby();
}

function hostMoveSeat(uid, to) {
  const seats = online.seats.slice();
  const from = seats.findIndex((s) => s && s.uid === uid);
  if (seats[to] || from < 0) return;
  seats[to] = seats[from]; seats[from] = null;
  hostSaveSeats(seats);
}

// Kick (lobby: frees the seat) or, mid-game, hand the seat to the computer.
async function hostRemoveSeat(i, toBot) {
  const s = online.seats[i];
  if (!s) return;
  const seats = online.seats.slice();
  seats[i] = toBot ? { bot: true, name: s.name + " 🤖" } : null;
  if (s.uid) await rooms.setMember(online.code, s.uid, { kicked: true }).catch(() => {});
  await hostSaveSeats(seats);
  if (toBot && game) { enterGameScreen(); maybeBotTurn(); }
}

function attachHostGame() {
  game.on(onEvent);
  game.on((ev) => {
    if (PUB_EVENTS.has(ev.type)) online.events = [...online.events, { seq: ++online.seq, ev }].slice(-12);
    schedulePublish();
  });
}

let publishTimer = null;
function schedulePublish() {
  if (publishTimer || !online?.isHost) return;
  publishTimer = true;
  queueMicrotask(() => {      // once per burst of engine events; never throttled in background
    publishTimer = null;
    if (!online || !game) return;
    rooms.publish(online.code, game, online.seats, online.events).catch((e) => console.error("publish", e));
  });
}

// ---------- Host presence ----------
// The host's browser runs the game, so if it's frozen (phone app switched, screen locked) the
// table waits. The host pings every 20s; players show a notice after 45s of silence, and the
// host picks up immediately when it comes back to the page.
const HOST_PING_MS = 20000, HOST_AWAY_MS = 45000;
let hostPingTimer = null;
function startHostPing() {
  stopHostPing();
  const ping = () => {
    if (!online?.isHost) return;
    rooms.updateRoom(online.code, { hostSeen: Date.now() }).catch(() => {});
    hostPingTimer = later(ping, HOST_PING_MS);
  };
  ping();
}
function stopHostPing() { if (hostPingTimer) hostPingTimer(); hostPingTimer = null; }

const hostAway = () => online && !online.isHost && Date.now() - (online.lastRoomAt || Date.now()) > HOST_AWAY_MS;
setInterval(() => {
  if (!online || online.isHost) return;
  const away = hostAway();
  if (away !== online.shownAway) { online.shownAway = away; if (game) render(); renderLobby(); }
}, 5000);

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState !== "visible" || !online?.isHost) return;
  startHostPing();
  if (game && online.room?.status === "playing") { resetDriver(); schedulePublish(); maybeBotTurn(); render(); }
});

async function hostStartGame() {
  let b = 0;
  const seats = online.seats.map((s) => s || { bot: true, name: rooms.BOT_NAMES[b++] });
  const matchId = Date.now();
  await rooms.updateRoom(online.code, { seats, status: "playing", matchId });
  online.seats = seats;
  online.room = { ...online.room, seats, status: "playing", matchId };
  ME = seats.findIndex((s) => s && s.uid === state.user.uid);
  resetDriver();
  game = new BalootGame({ targetScore: 152, strict: online.room.options?.strict !== false });
  attachHostGame();
  schedulePublish();
  enterGameScreen();
  payStakeOnce();
  maybeBotTurn();
}

// ---------- Stakes ----------
// Same trust level as betting vs the computer: each player's own browser pays their stake when
// a match starts and collects 2× when their team wins. localStorage makes both happen once per
// match, even across refreshes.
const stakeKey = () => `stake:${state.user?.uid}:${online.code}:${online.room?.matchId}`;

async function payStakeOnce() {
  const stake = online?.room?.options?.stake || 0;
  if (!stake || !online.room.matchId || ME < 0 || readLS(stakeKey())) return;
  writeLS(stakeKey(), "paid");
  try { await placeStake(stake); }
  catch (_) { writeLS(stakeKey(), "unpaid"); toast("رصيدك ما يكفي للرهان — تلعب بدون رهان"); }
}

async function collectStake(weWon) {
  const stake = online?.room?.options?.stake || 0;
  if (!stake || readLS(stakeKey()) !== "paid") return "";
  writeLS(stakeKey(), "done");
  logMatch(stake, weWon);
  if (!weWon) return `<br>🪙 خسرت رهانك (${stake})`;
  try { await awardWin(stake * 2); } catch (_) {}
  return `<br><span class="big">🪙 +${stake * 2}</span>`;
}

function readLS(k) { try { return localStorage.getItem(k); } catch (_) { return null; } }
function writeLS(k, v) { try { localStorage.setItem(k, v); } catch (_) { /* private mode */ } }

function hostResume(room, engineJson) {
  online.seats = room.seats;
  ME = room.seats.findIndex((s) => s && s.uid === state.user.uid);
  try {
    const pub = room.state ? JSON.parse(room.state) : null;
    online.events = pub?.events || [];
    online.seq = Math.max(0, ...online.events.map((e) => e.seq));
  } catch (_) { /* fresh event log */ }
  resetDriver();
  game = rooms.engineFromJSON(engineJson);
  attachHostGame();
  enterGameScreen();
  if (game.phase === "roundEnd" && game.lastRoundResult) showRoundResult(game.lastRoundResult);
  if (game.phase === "matchEnd") showMatchResult({ winner: game.score.A > game.score.B ? "A" : "B", score: { ...game.score } });
  payStakeOnce();
  maybeBotTurn();
}

async function hostBackToLobby() {
  game = null;
  online.events = [];
  await rooms.updateRoom(online.code, { status: "lobby", state: null });
  rooms.setConfig(online.code, { engine: null }).catch(() => {});
  show("screen-lobby");
  renderLobby();
}

// A move from another player: the engine validates it, then the host publishes the new state.
function hostOnAction(a) {
  rooms.deleteAction(online.code, a.id);
  if (!game || online.room?.status !== "playing") return;
  const s = online.seats[a.seat];
  if (!s || s.bot || s.uid !== a.uid) return;
  const ok = a.kind === "bid" ? game.bid(a.seat, a.action)
           : a.kind === "play" ? game.play(a.seat, a.cardId)
           : a.kind === "declare" ? game.declareProjects(a.seat)
           : a.kind === "qaid" ? game.claimQaid(a.seat) : false;
  if (!ok) { schedulePublish(); return; }      // resend state so the sender is unblocked
  render();
  maybeBotTurn();
}
