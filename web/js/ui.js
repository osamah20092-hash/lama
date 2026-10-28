import { BalootGame, TEAM_OF, BID_PHASES, PROJECT_AR } from "./engine.js?v=14";
import { chooseBid, chooseCard, shouldSayBaloot, shouldSayEkka, seesRevoke } from "./ai.js?v=14";
import { SUIT_INFO, RANK_AR, RANK_LABEL, SUITS, cardLabel } from "./deck.js?v=14";
import { initFirebase, onUserChange, signIn, signUp, logout, state, placeStake, awardWin, logMatch } from "./auth.js?v=14";
import { BET_TIERS, COINS_ON_WIN, SHOW_H2H } from "./firebase-config.js?v=14";
import * as rooms from "./rooms.js?v=14";
import * as audio from "./audio.js?v=14";
import * as stats from "./stats.js?v=14";

const $ = (id) => document.getElementById(id);
let ekkaArmed = false;   // I pressed إكة: it goes with the next card I lead
let ME = 0;                   // my seat; the table is drawn relative to it (me at the bottom)
let game = null;
let busy = false;             // prevents input while bots act / animations run
let currentStake = 0;         // chosen stake for the next match
let matchStake = 0;           // stake locked in for the running match
let online = null;            // private session state (see "Private sessions" below), null offline

// A spectator (online, not seated: ME = -1) sees the table from seat 0.
const watching = () => !!online && ME < 0;
const VIEW = () => (ME >= 0 ? ME : 0);
const rel = (s) => (s - VIEW() + 4) % 4;             // 0 me · 1 right · 2 partner · 3 left
const US = () => TEAM_OF(VIEW());
const THEM = () => (US() === "A" ? "B" : "A");
// "لنا/لهم" for players; spectators get neutral team names (as in the waiting hall).
const teamLabel = (t) => (watching() ? (t === "A" ? "الفريق الأول" : "الفريق الثاني") : t === US() ? "لنا" : "لهم");
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
$("btn-home").onclick = () => leaveGame();

// Leaving a match that is still running counts as a forfeit: a loss is recorded for me and the
// computer takes my seat (offline nobody's left to watch, so the match just stops).
const matchRunning = () => !!game && game.phase !== "matchEnd" && (!online || ME >= 0);

function leaveGame() {
  if (!matchRunning()) {
    if (!online) { show("screen-home"); return; }
    if (confirm(online.isHost ? "تبي تنهي الجلسة للكل؟" : "تبي تطلع من الجلسة؟")) exitRoom();
    return;
  }
  const msg = online?.isHost
    ? "متأكد إنك بتنسحب؟ بتنحسب عليك خسارة، والجلسة بتنتهي للكل."
    : "متأكد إنك بتنسحب؟ بتنحسب عليك خسارة" + (online ? " والكمبيوتر بيكمّل مكانك." : ".");
  if (!confirm(msg)) return;
  if (!online) {
    logMatch(matchStake, false);
    matchStake = 0;
    resetDriver();
    game = null;
    show("screen-home");
    return;
  }
  if (SHOW_H2H) stats.recordRoomMatch({ code: online.code, matchId: online.room?.matchId, seats: online.seats,
    me: ME, weWon: false, stake: online.room?.options?.stake || 0 });
  collectStake(false);
  exitRoom();
}

// The phone/browser back button during a match asks the same question instead of leaving the page.
window.addEventListener("popstate", () => {
  if (!$("screen-game").classList.contains("active") || !matchRunning()) return;
  history.pushState({ inGame: true }, "");
  leaveGame();
});

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

// ---------- Sound settings ----------
function openSoundPanel() {
  const s = audio.getSettings();
  $("snd-sfx").checked = s.sfx;
  $("snd-volume").value = s.volume;
  $("snd-narrator").innerHTML = audio.narrators()
    .map((n) => `<option value="${n.id}"${n.id === s.narrator ? " selected" : ""}>${n.name}</option>`).join("");
  $("sound-panel").classList.remove("hidden");
}
$("btn-sound").onclick = openSoundPanel;
$("btn-sound-home").onclick = openSoundPanel;
$("snd-close").onclick = () => $("sound-panel").classList.add("hidden");
$("snd-sfx").onchange = (e) => audio.setSettings({ sfx: e.target.checked });
$("snd-volume").oninput = (e) => audio.setSettings({ volume: +e.target.value });
$("snd-narrator").onchange = (e) => { audio.setSettings({ narrator: e.target.value }); audio.say("sun"); };
$("snd-test").onclick = () => { audio.play("card"); audio.say("hokom"); };

// ---------- Auth wiring ----------
$("btn-logout").onclick = async () => { await logout(); };
$("btn-admin").onclick = () => { location.href = "admin.html"; };
$("btn-stats").onclick = openStats;
$("btn-stats-back").onclick = () => show("screen-home");
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
    $("btn-stats").style.display = SHOW_H2H ? "block" : "none";
    if (COINS_ON_WIN) { stakeRow.style.display = "flex"; renderStakeChips(); }
    else stakeRow.style.display = "none";
  } else {
    $("wallet-name").textContent = "ضيف";
    $("wallet-coins").textContent = "—";
    $("btn-logout").style.display = "none";
    $("btn-admin").style.display = "none";
    $("btn-stats").style.display = "none";
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
      // Signed out because the admin deactivated or deleted the account.
      if (state.blocked) $("auth-error").textContent = state.blocked === "deleted"
        ? "⛔ هذا الحساب محذوف. تواصل مع الإدارة."
        : "⛔ حسابك موقوف حالياً ولا تقدر تلعب. تواصل مع الإدارة.";
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
  renderSeats();
  show("screen-game");
  if (!history.state?.inGame) history.pushState({ inGame: true }, "");   // catch the back button
  audio.play("shuffle");
  render();
}

// Names/avatars around the table; online they change when someone sits, leaves or is replaced.
function renderSeats() {
  for (const r of [1, 2, 3]) {
    const s = (VIEW() + r) % 4;
    const seat = $("seat-" + r);
    const occ = online ? online.seats[s] : null;
    seat.querySelector(".avatar").textContent = !online || occ?.bot ? "🤖" : "👤";
    seat.querySelector(".name").textContent = online ? (occ?.name || "—") : SEAT_NAME[r];
    // Host: tap a player who dropped off to hand their seat to the computer.
    seat.onclick = online?.isHost && occ && !occ.bot ? () => {
      if (confirm(`تحوّل ${occ.name} للكمبيوتر؟`)) hostRemoveSeat(s, true);
    } : null;
  }
}

// ---------- Event handling ----------
function onEvent(ev) {
  switch (ev.type) {
    case "round-start": audio.play("shuffle"); break;
    case "bid": if (ev.seat !== ME && ev.action.kind !== "pass") toast(`${seatName(ev.seat)}: ${bidLabel(ev.action, ev.phase)}`); bidSound(ev.action, ev.phase); break;
    case "contract": toast(contractText(ev.mode, ev.trump) + (ev.declarer === ME ? " · أنت الشاري" : ` · الشاري ${seatName(ev.declarer)}`)); break;
    case "baloot": toast(`👑 ${ev.seat === ME ? "قلت" : seatName(ev.seat) + ":"} بلوت`, 2600); audio.play("baloot"); audio.say("baloot"); break;
    case "declare":
      toast(`${ev.seat === ME ? "أعلنت" : seatName(ev.seat) + ":"} ${ev.types.map((t) => PROJECT_AR[t]).join(" + ")}`);
      audio.play("declare");
      for (const t of ev.types) audio.say(t === "sira" ? "sira" : "p" + t);
      break;
    case "projects": { const t = projectsText(ev.projects); if (t) toast(t, 3200); break; }
    case "qaid": toast(`⚖️ ${seatName(ev.seat)} قيّد — ${ev.correct ? "صح!" : "غلط!"}`, 3000); audio.say("qaid"); break;
    // A non-host already heard its own card when it tapped it (sendMove).
    case "play":
      if (!(online && !online.isHost && ev.seat === ME)) audio.play("card");
      if (ev.ekka) { toast(`${ev.seat === ME ? "قلت" : seatName(ev.seat) + ":"} إكة`, 2200); audio.say("ekka"); }
      break;
    case "trick-won": later(() => audio.play("collect"), TRICK_HOLD_MS); break;
    case "round-end": roundEndSound(ev); showRoundResult(ev); break;
    case "match-end": audio.play(ev.winner === US() ? "winMatch" : "loseMatch"); showMatchResult(ev); break;
    case "redeal": toast("الكل باس — توزيع جديد"); audio.say("redeal"); break;
  }
  render();
}

function bidSound(a, phase) {
  if (a.kind === "hokom") audio.say(phase === "hokomConfirm" ? "confirm" : phase === "bidding2" ? "hokom_" + a.suit : "hokom");
  else if (["double", "triple", "four"].includes(a.kind)) { audio.play("double"); audio.say(a.kind); }
  else if (a.kind === "gahwa") { audio.play("gahwa"); audio.say("gahwa"); }
  else audio.say(a.kind);   // sun · ashkal · pass
}

function roundEndSound(ev) {
  const weWon = ev.winner === US();
  if (ev.result === "kaboot") { audio.play(weWon ? "kaboot" : "loseRound"); audio.say("kaboot"); }
  else audio.play(weWon ? "winRound" : "loseRound");
}

// ---------- Rendering ----------
function render() {
  if (!game) return;
  $("label-us").textContent = teamLabel(US());
  $("label-them").textContent = teamLabel(THEM());
  $("score-us").textContent = game.score[US()];
  $("score-them").textContent = game.score[THEM()];
  $("contract-badge").textContent = game.mode
    ? contractText(game.mode, game.trump) + multText(game) + " · " + (game.declarer === ME ? "أنت الشاري" : "الشاري " + seatName(game.declarer))
    : "—";

  renderHand();
  renderOpponents();
  renderTrick();
  renderTurn();
  renderBidPanel();
  renderActions();
  renderProjectsShow();
  renderWatchers();
  turnCue();
}

// Everyone at the table sees how many are watching; spectators get a bar to take a computer's seat.
function renderWatchers() {
  const n = online?.room?.watchers || 0;
  $("watchers").classList.toggle("hidden", !n);
  $("watchers").textContent = `👁 ${n} ${n === 1 ? "مشاهد" : "مشاهدين"}`;
  const bar = $("watch-bar");
  bar.classList.toggle("hidden", !watching());
  if (!watching()) return;
  const room = online.room;
  const bottom = online.seats[0];
  const bots = room.locked ? [] : online.seats.map((s, i) => (s?.bot ? i : -1)).filter((i) => i >= 0);
  const key = JSON.stringify([bottom?.name, bots, online.seats.map((s) => s?.name)]);
  if (bar.dataset.key === key) return;   // don't rebuild the buttons on every render
  bar.dataset.key = key;
  bar.innerHTML = `<span class="watch-label">👁 تشاهد · تحت: ${esc(bottom?.name || "—")}</span>`;
  for (const i of bots) {
    const b = document.createElement("button");
    b.className = "btn btn-primary";
    b.textContent = `اجلس مكان ${online.seats[i].name}`;
    b.onclick = () => takeSeat(i);
    bar.appendChild(b);
  }
}

// A chime when it becomes my turn to bid or play (once per turn, not on every render).
let wasMyTurn = false;
function turnCue() {
  const mine = ME >= 0 && !busy && !trickHeld() &&
    ((game.phase === "playing" && game.turn === ME) || (BID_PHASES.includes(game.phase) && game.bidTurn === ME));
  if (mine && !wasMyTurn) audio.play("turn");
  wasMyTurn = mine;
}

function renderActions() {
  const decl = $("btn-declare");
  const canDecl = ME >= 0 && !busy && game.canDeclare(ME);
  decl.style.display = canDecl ? "" : "none";
  if (canDecl) decl.textContent = "📢 أعلن: " + game.projectCandidates[ME].map((p) => PROJECT_AR[p.type]).join(" + ");
  $("btn-baloot").style.display = ME >= 0 && !busy && game.canDeclareBaloot(ME) ? "" : "none";
  const canEkka = ME >= 0 && !busy && !trickHeld() && game.canSayEkka(ME);
  if (!canEkka) ekkaArmed = false;
  $("btn-ekka").style.display = canEkka ? "" : "none";
  $("btn-ekka").classList.toggle("armed", ekkaArmed);
  $("btn-ekka").textContent = ekkaArmed ? "✔ إكة — العب ورقتك" : "☝ إكة";
  $("btn-qaid").style.display = ME >= 0 && game.canClaimQaid(ME) ? "" : "none";
}

// إكة is the player's own call, right or wrong: it rides on the next non-trump card they lead.
// The game doesn't check it — a wrong one is a foul the other team can catch with قيد.
$("btn-ekka").onclick = () => {
  if (busy || !game.canSayEkka(ME)) return;
  ekkaArmed = !ekkaArmed;
  render();
};

$("btn-baloot").onclick = () => {
  if (busy || !game.canDeclareBaloot(ME)) return;
  if (online && !online.isHost) { sendMove({ kind: "baloot" }); return; }
  game.declareBaloot(ME);
  render();
};

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
  if (ME < 0) {   // spectator: the bottom player's cards stay face down
    for (let i = 0; i < game.hands[0].length; i++) {
      const b = document.createElement("div"); b.className = "mini-card"; wrap.appendChild(b);
    }
    return;
  }
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
    const s = (VIEW() + r) % 4;
    const el = $("hand-" + r);
    el.innerHTML = "";
    for (let i = 0; i < game.hands[s].length; i++) {
      const b = document.createElement("div"); b.className = "mini-card"; el.appendChild(b);
    }
    $("seat-" + r).classList.toggle("active-turn", game.phase === "playing" && game.turn === s);
    $("seat-" + r).classList.toggle("buyer", !!game.mode && game.declarer === s);
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
    el.innerHTML = `<img class="card-face" src="${cardSrc(p.card)}" alt="" draggable="false">` +
      (p.ekka ? `<span class="ekka-tag">إكة</span>` : "");
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
  const card = game.hands[ME].find((c) => c.id === cardId);
  const ekka = ekkaArmed && game.canSayEkka(ME) && card?.suit !== game.trump;
  ekkaArmed = false;
  if (online && !online.isHost) { sendMove({ kind: "play", cardId, ekka }); return; }
  game.play(ME, cardId, { ekka });
  render();
  afterPlayFlow();
}

// Non-host: send the move to the host and wait for the next snapshot.
function sendMove(move) {
  if (move.kind === "play") {
    // Show my card on the table right away; the host's next snapshot confirms it.
    const card = game.hands[ME].find((c) => c.id === move.cardId);
    game.hands[ME] = game.hands[ME].filter((c) => c.id !== move.cardId);
    game.currentTrick = [...game.currentTrick, move.ekka ? { seat: ME, card, ekka: true } : { seat: ME, card }];
    audio.play("card");
    if (move.ekka) audio.say("ekka");
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
  if (game.phase === "playing") afterPlayFlow();
}

// A bot whose opponents' foul (revoke or wrong إكة) has been proven calls قيد, like a sharp player would.
function maybeBotQaid() {
  if (botTimer) return false;
  const caller = [0, 1, 2, 3].find((s) => isBot(s) && seesRevoke(game, s));
  if (caller === undefined) return false;
  botLater(900, () => { if (game.phase === "playing" && seesRevoke(game, caller)) game.claimQaid(caller); });
  return true;
}

function afterPlayFlow() {
  if (!game || game.phase !== "playing") return;
  if (maybeBotQaid()) return;
  if (!isBot(game.turn)) { render(); return; }
  // Leading a new trick: wait until the finished one has been seen by everyone.
  const leading = !game.currentTrick.length && game.tricks.length;
  botLater(leading ? TRICK_HOLD_MS + 300 : 700, () => {
    if (game.phase !== "playing" || !isBot(game.turn)) return;
    game.declareProjects(game.turn);   // bots never forget their projects
    const card = chooseCard(game, game.turn);
    if (shouldSayBaloot(game, game.turn, card)) game.declareBaloot(game.turn);
    game.play(game.turn, card.id, { ekka: shouldSayEkka(game, game.turn, card) });
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
  if (watching()) title = `${RESULT_TITLE[ev.result] || "⚖️ قيد"} · الجولة: ${teamLabel(ev.winner)}`;
  $("result-title").textContent = title;
  const u = US(), t = THEM();
  const lu = teamLabel(u), lt = teamLabel(t);
  const line = (label, v) => (v[u] || v[t]) ? `${label} — ${lu} ${v[u]} · ${lt} ${v[t]}<br>` : "";
  const f = ev.qaid?.foul;
  $("result-body").innerHTML =
    (ev.qaid ? `${seatName(ev.qaid.seat)} قيّد · ` +
      (!f ? "ما فيه غلطة"
        : f.ekka ? `الغلطة: ${f.seat === ME ? "قلت" : seatName(f.seat) + " قال"} إكة على ${cardLabel(f.card)} وفيه أكبر منها`
        : `الغلطة: ${f.seat === ME ? "لعبت" : seatName(f.seat) + " لعب"} ${cardLabel(f.card)}`) + "<br>" : "") +
    `العقد: <b>${contractText(game.mode, game.trump)}${multText(game)}</b><br>` +
    line("الأبناط", ev.raw) +
    line("المشاريع", ev.proj) +
    line("البلوت", ev.bal) +
    `<span class="big">${lu} +${ev.gp[u]} · ${lt} +${ev.gp[t]}</span><br>` +
    `المجموع: ${lu} ${game.score[u]} · ${lt} ${game.score[t]}`;
  // Online only the host deals the next round.
  $("btn-next").textContent = online && !online.isHost ? "تمام" : "الجولة التالية";
  if (online) online.resultShownAt = Date.now();
  panel.classList.remove("hidden");
}

async function showMatchResult(ev) {
  const panel = $("result-panel");
  if (watching()) {
    $("result-title").textContent = `🏆 فاز ${teamLabel(ev.winner)}`;
    $("result-body").innerHTML = `<span class="big">${teamLabel("A")} ${ev.score.A} — ${teamLabel("B")} ${ev.score.B}</span>`;
    $("btn-next").textContent = "رجوع للجلسة";
    panel.classList.remove("hidden");
    return;
  }
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
  if (online) {
    if (SHOW_H2H) stats.recordRoomMatch({ code: online.code, matchId: online.room?.matchId, seats: online.seats,
      me: ME, weWon, stake: online.room?.options?.stake || 0 });
    coinLine = await collectStake(weWon);
  }
  $("result-title").textContent = weWon ? "فزنا! 🏆" : "خسرنا";
  $("result-body").innerHTML =
    `<span class="big">${ev.score[US()]} — ${ev.score[THEM()]}</span><br>` +
    (weWon ? "مبروك الفوز!" : "حظ أوفر المرة الجاية") + coinLine;
  $("btn-next").textContent = online ? "رجوع للجلسة" : "رجوع للرئيسية";
  panel.classList.remove("hidden");
}

// ---------- Stats (experimental, SHOW_H2H) ----------
async function openStats() {
  show("screen-stats");
  const box = $("stats-body");
  box.textContent = "جارٍ التحميل…";
  try {
    const { played, won, rivals } = await stats.loadHeadToHead();
    if (!played) { box.innerHTML = `<p class="hint">ما لعبت جلسات خاصة مع ربعك للحين. العب صكة كاملة وترجع هنا تشوف مين غلبت 😉</p>`; return; }
    box.innerHTML =
      `<div class="stats-total">لعبت <b>${played}</b> صكة · فزت <b>${won}</b> · خسرت <b>${played - won}</b></div>` +
      rivals.map((r) => {
        const vs = r.beat + r.lostTo;
        const lead = r.beat > r.lostTo ? "lead" : r.beat < r.lostTo ? "trail" : "";
        return `<div class="rival-row ${lead}"><div class="rival-name">${esc(r.name)}</div><div class="rival-rec">` +
          (vs ? `فزت عليه <b>${r.beat}</b> · خسرت منه <b>${r.lostTo}</b>` : "") +
          (r.withMe ? `<span class="rival-with">${vs ? " · " : ""}لعب معك ${r.withMe}</span>` : "") +
          `</div></div>`;
      }).join("");
  } catch (e) {
    console.error(e);
    box.innerHTML = `<p class="hint">تعذّر تحميل الإحصائيات.</p>`;
  }
}

// ---------- Helpers ----------
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

function multText(g) {
  if (g.gahwa) return " · قهوة ☕";
  const m = { 2: " · دبل", 3: " · ثري", 4: " · فور" }[g.multiplier] || "";
  return m && g.mode === "hokom" && g.multiplier !== 3 ? m + (g.locked ? " مقفول" : " مفتوح") : m;
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
const PUB_EVENTS = new Set(["round-start", "bid", "contract", "play-start", "play", "trick-won", "declare", "baloot", "projects", "qaid", "round-end", "match-end", "redeal"]);

$("btn-private").onclick = () => {
  if (!state.user) {
    alert(state.configured ? "الجلسات الخاصة تحتاج حساب — سجّل دخول أول" : "الجلسات الخاصة تحتاج ربط Firebase");
    if (state.configured) show("screen-auth");
    return;
  }
  openRoomMenu("");
};
$("btn-room-back").onclick = () => { stopRoomList(); show("screen-home"); };
$("btn-new-room").onclick = () => {
  $("create-form").classList.remove("hidden");
  $("btn-new-room").style.display = "none";
};
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
  $("create-form").classList.add("hidden");
  $("btn-new-room").style.display = "";
  show("screen-room-menu");
  startRoomList();
}

// ---------- Open sessions list ----------
// Live tables whose host is on the page and that aren't locked. Tap a free seat or a computer's
// seat to play there, or 👁 to watch.
let roomListUnsub = null;
function startRoomList() {
  stopRoomList();
  $("room-list").innerHTML = `<p class="hint">جارٍ التحميل…</p>`;
  roomListUnsub = rooms.watchOpenRooms(renderRoomList);
}
function stopRoomList() { if (roomListUnsub) roomListUnsub(); roomListUnsub = null; }

function renderRoomList(list) {
  const box = $("room-list");
  if (!list) { box.innerHTML = `<p class="hint">تعذّر تحميل الجلسات.</p>`; return; }
  const open = list
    .filter((r) => r.status !== "closed" && !r.locked && r.hostUid !== state.user?.uid)
    .sort((a, b) => (a.status === "lobby" ? 0 : 1) - (b.status === "lobby" ? 0 : 1) || (b.hostSeen || 0) - (a.hostSeen || 0));
  if (!open.length) { box.innerHTML = `<p class="hint">ما فيه جلسات مفتوحة الحين — أنشئ وحدة وادعُ ربعك 👇</p>`; return; }
  box.innerHTML = "";
  for (const r of open) {
    const row = document.createElement("div");
    row.className = "room-row";
    const stake = r.options?.stake || 0;
    const tags = [
      r.status === "playing" ? "▶ شغّالة" : "⏳ بالانتظار",
      stake ? `رهان ${stake} 🪙` : "ودّية",
      r.options?.strict === false ? "حر + قيد" : "",
      r.hasPin ? "🔑" : "",
      r.watchers ? `👁 ${r.watchers}` : "",
    ].filter(Boolean).join(" · ");
    row.innerHTML = `<div class="room-row-head"><span class="room-row-host">جلسة ${esc(r.hostName || "")}</span>` +
      `<span class="room-row-tags">${tags}</span></div><div class="room-row-seats"></div>`;
    const seatsBox = row.querySelector(".room-row-seats");
    // Same layout as the waiting hall: team 1 (seats 0, 2) on the right, team 2 (1, 3) on the left.
    for (const i of [0, 1, 2, 3]) {
      const s = r.seats?.[i];
      const b = document.createElement("button");
      const free = !s || s.bot;
      b.className = "seat-chip" + (free ? " open" : "");
      b.textContent = !s ? "فاضي · اجلس" : s.bot ? `🤖 اجلس مكانه` : "👤 " + s.name;
      b.title = s?.name || "";
      if (free) b.onclick = () => joinByCode(r.code, "", { wantSeat: i });
      else b.disabled = true;
      seatsBox.appendChild(b);
    }
    const watch = document.createElement("button");
    watch.className = "btn btn-ghost";
    watch.textContent = "👁 شاهد";
    watch.onclick = () => joinByCode(r.code, "", { spectator: true });
    row.appendChild(watch);
    box.appendChild(row);
  }
}

// Invite links look like ...?room=ABC123 — open the join flow after sign-in.
function openInviteLink() {
  const code = rooms.normalizeCode(new URLSearchParams(location.search).get("room"));
  if (code) { openRoomMenu(code); joinByCode(code, ""); }
}

// opts: { wantSeat: seat to sit in (empty or a computer's), spectator: just watch }
async function joinByCode(raw, pin, opts = {}) {
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
    if (!seated && !opts.spectator && stake > (state.profile?.coins || 0)) { roomError(`الجلسة برهان ${stake} 🪙 ورصيدك ما يكفي`); return; }
    if (!seated && room.hasPin && !pin) {
      // From the list there's no PIN box on screen: ask right away.
      if (opts.wantSeat !== undefined || opts.spectator) {
        const typed = prompt("الجلسة محمية برمز سري 🔑 — اكتبه:");
        if (typed === null) return;
        return joinByCode(code, typed.trim(), opts);
      }
      $("join-pin").style.display = "block";
      $("join-pin").focus();
      roomError("الجلسة محمية برمز سري — اكتبه واضغط انضم");
      return;
    }
    await rooms.joinRoom(code, pin, { wantSeat: opts.wantSeat ?? null, spectator: !!opts.spectator });
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
  stopRoomList();
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
      if (online.pub && ME >= 0) { game = rooms.viewGame(online.pub, ME, myCards(), myBaloot()); render(); }
    }));
  }
  online.unsubs.push(rooms.watchRoom(code, onRoom));
}

// My cards from the private hand doc, only if it's for the seat I'm in now.
const myCards = () => (online.hand && online.hand.seat === ME ? online.hand.cards : []);
const myBaloot = () => !!(online.hand && online.hand.seat === ME && online.hand.baloot);

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
  online.spectator = !!m?.spectator;
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
  if (online.isHost) { if (game) renderWatchers(); return; }   // the host renders its own engine
  if (!room.state) { show("screen-lobby"); renderLobby(); return; }
  // Not seated (spectator, or waiting for a seat): watch the table from seat 0.
  const pub = JSON.parse(room.state);
  const first = online.lastSeq === null || prevMe !== ME;
  if (online.pub && pub.round !== online.pub.round) {
    // The host dealt again: close the round result, but give it at least 4s on screen.
    const left = 4000 - (Date.now() - (online.resultShownAt || 0));
    later(() => { if (game?.phase !== "roundEnd") $("result-panel").classList.add("hidden"); }, Math.max(0, left));
  }
  online.pub = pub;
  busy = false;
  game = rooms.viewGame(pub, ME, myCards(), myBaloot());
  if (!$("screen-game").classList.contains("active")) enterGameScreen();
  else if (JSON.stringify(room.seats) !== online.seatsShown) renderSeats();
  online.seatsShown = JSON.stringify(room.seats);
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
      // Not seated yet: a computer's seat can be taken (mid-game too).
      if (s.bot && !isHost && ME < 0 && !room.locked) {
        el.classList.add("bot", "clickable");
        el.textContent += " · اجلس مكانه";
        el.onclick = () => takeSeat(i);
      }
    } else {
      el.className = "lobby-seat empty";
      el.textContent = "فاضي";
      if (room.status === "lobby" && (isHost || ME >= 0 || !room.locked)) {
        el.classList.add("clickable");
        el.textContent += " · اجلس هنا";
        el.onclick = () => (isHost ? hostMoveSeat(room.hostUid, i) : ME >= 0 ? rooms.requestSeat(online.code, i) : takeSeat(i));
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
  else if (ME < 0 && online.spectator) status = "👁 تشاهد — اضغط مقعد فاضي لو تبي تلعب";
  else if (ME < 0) status = room.seats.every(Boolean) ? "الطاولة مكتملة — انتظر المضيف" : "بانتظار المضيف يجلسك…";
  else status = isHost ? "أرسل الرمز لربعك، واضغط ابدأ لما تجهزون" : "بانتظار المضيف يبدأ…";
  if (isHost && waiting.length) status += ` · بالانتظار: ${waiting.map((m) => m.name).join("، ")}`;
  if (room.hasPin) status += " · 🔑 محمية برمز";
  const opts = room.options || {};
  status += opts.stake ? ` · رهان ${opts.stake} 🪙` : " · ودّية";
  if (opts.strict === false) status += " · لعب حر + قيد";
  if (room.watchers) status += ` · 👁 ${room.watchers}`;
  if (hostAway()) status = "⏳ المضيف طلع من الصفحة — انتظره يرجع";
  $("lobby-status").textContent = status;
}

// Spectator / waiting player: ask the host for an empty or computer seat.
function takeSeat(i) {
  const stake = online.room?.options?.stake || 0;
  if (stake > (state.profile?.coins || 0)) { alert(`الجلسة برهان ${stake} 🪙 ورصيدك ما يكفي`); return; }
  online.spectator = false;
  rooms.requestSeat(online.code, i)
    .then(() => toast("بتجلس الحين…"))
    .catch(() => toast("تعذّر، حاول مرة ثانية"));
}

// ---------- Host side ----------
function hostSaveSeats(seats) {
  online.seats = seats;
  return rooms.updateRoom(online.code, { seats });
}

// The waiting hall changed: seat newcomers, honour seat-change requests, free seats of leavers,
// and count the spectators (members with a valid PIN who aren't seated).
async function hostSyncMembers(list) {
  if (!online) return;
  online.members = list;
  const room = online.room;
  const seats = online.seats.slice();
  const lobby = room.status === "lobby";
  const open = (s) => !s || s.bot;   // a computer's seat can be taken, mid-game too
  let changed = false, watchers = 0;

  for (const m of list) {
    if (m.kicked) continue;
    const at = seats.findIndex((s) => s && s.uid === m.uid);
    if (at < 0) {
      if (online.pin && m.pin !== online.pin) {
        if (!m.pinWrong) rooms.setMember(online.code, m.uid, { pinWrong: true });
        continue;
      }
      if (m.spectator || room.locked) { watchers++; continue; }
      // A chosen seat if it's still open; in the lobby otherwise any empty seat, then a computer's.
      let want = Number.isInteger(m.wantSeat) && open(seats[m.wantSeat]) ? m.wantSeat : -1;
      if (want < 0 && lobby) want = seats.findIndex((s) => !s);
      if (want < 0 && (lobby || Number.isInteger(m.wantSeat))) want = seats.findIndex((s) => s?.bot);
      if (want < 0) { watchers++; continue; }
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
  if (watchers !== (room.watchers || 0)) {
    online.room = { ...online.room, watchers };
    rooms.updateRoom(online.code, { watchers }).catch(() => {});
  }
  if (changed) {
    await hostSaveSeats(seats);
    // A player took a seat mid-game: publish so they get their hand, and stop the bot there.
    if (!lobby && game) { renderSeats(); schedulePublish(); maybeBotTurn(); render(); }
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
    if (PUB_EVENTS.has(ev.type)) online.events = [...online.events, { seq: ++online.seq, ev }].slice(-24);
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
           : a.kind === "play" ? game.play(a.seat, a.cardId, { ekka: !!a.ekka })
           : a.kind === "declare" ? game.declareProjects(a.seat)
           : a.kind === "baloot" ? game.declareBaloot(a.seat)
           : a.kind === "qaid" ? game.claimQaid(a.seat) : false;
  if (!ok) { schedulePublish(); return; }      // resend state so the sender is unblocked
  render();
  maybeBotTurn();
}
