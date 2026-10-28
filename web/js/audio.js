// Sound system: effects albums + a narrator that calls the bids.
//
// Effects are synthesized with the Web Audio API, so the game ships without third-party
// sound files. Each album holds several variants; play() picks one at random (never the same
// one twice in a row) so frequent sounds like a card hitting the table don't sound robotic.
// A variant is either a synth recipe (function) or a URL to an audio file you own, so an
// album can be upgraded to recorded sounds later without touching the game code.
//
// The narrator speaks the bids and calls (صن، حكم، دبل، بلوت…). It uses a recorded voice
// pack when one is selected (assets/voices/<id>/<line>.mp3) and falls back to the device's
// Arabic text-to-speech for any line the pack is missing.

const SETTINGS_KEY = "lamma:audio";
const settings = { sfx: true, volume: 0.8, narrator: "tts" };   // narrator: "off" | "tts" | "tts:<voiceURI>" | pack id
try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}); } catch (_) { /* private mode */ }
function save() { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (_) { /* private mode */ } }

// ---------- Web Audio plumbing ----------
let ctx = null, master = null;
function ac() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC();
    master = ctx.createGain();
    master.gain.value = settings.volume;
    master.connect(ctx.destination);
  }
  if (ctx.state === "suspended") ctx.resume();
  return ctx;
}

// Browsers only allow audio after a user gesture: unlock both outputs on the first tap.
function unlock() {
  ac();
  if ("speechSynthesis" in window) speechSynthesis.speak(Object.assign(new SpeechSynthesisUtterance(""), { volume: 0 }));
  window.removeEventListener("pointerdown", unlock);
  window.removeEventListener("keydown", unlock);
}
window.addEventListener("pointerdown", unlock);
window.addEventListener("keydown", unlock);

const rand = (a, b) => a + Math.random() * (b - a);

let noiseBuf = null;
function noise() {
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const d = noiseBuf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  }
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  return src;
}

// Filtered noise burst: card snaps, riffles, swooshes.
function burst(t, { freq = 2500, q = 1.2, dur = 0.07, gain = 0.6, sweepTo = null, type = "bandpass" }) {
  const src = noise(), f = ctx.createBiquadFilter(), g = ctx.createGain();
  f.type = type; f.Q.value = q;
  f.frequency.setValueAtTime(freq, t);
  if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.004);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, rand(0, 0.5)); src.stop(t + dur + 0.02);
}

// Plucked/bell tone with a soft attack and exponential tail.
function tone(t, { freq, dur = 0.25, gain = 0.25, type = "sine", slideTo = null }) {
  const o = ctx.createOscillator(), g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t); o.stop(t + dur + 0.02);
}

const notes = (t, freqs, step, opts = {}) => freqs.forEach((f, i) => tone(t + i * step, { freq: f, ...opts }));
// Note frequencies (Hz) used by the jingles.
const C5 = 523.25, D5 = 587.33, E5 = 659.25, G5 = 783.99, A5 = 880, C6 = 1046.5, E6 = 1318.5;
const A4 = 440, F4 = 349.23, D4 = 293.66;

// ---------- Albums ----------
// key → { variants: [recipe | url], gain }. A recipe is (t) => void, scheduled at time t.
const cardSnap = () => (t) => {
  const f = rand(1800, 3400);
  burst(t, { freq: f, q: rand(0.8, 1.6), dur: rand(0.05, 0.09), gain: 0.55 });
  burst(t + 0.008, { freq: rand(250, 450), q: 0.7, dur: 0.05, gain: 0.25, type: "lowpass" });   // the table thud
};

export const ALBUMS = {
  card:    { variants: [cardSnap(), cardSnap(), cardSnap(), cardSnap(), cardSnap()] },
  deal:    { variants: [(t) => { for (let i = 0; i < 4; i++) cardSnap()(t + i * 0.09); }] },
  shuffle: { variants: [(t) => {
    for (let i = 0; i < 16; i++) burst(t + i * rand(0.022, 0.032), { freq: rand(2500, 4500), q: 2, dur: 0.035, gain: 0.3 });
    burst(t + 0.5, { freq: 900, q: 0.8, dur: 0.12, gain: 0.4, type: "lowpass" });
  }] },
  collect: { variants: [(t) => burst(t, { freq: 600, sweepTo: 3000, q: 0.9, dur: 0.22, gain: 0.25 }),
                        (t) => burst(t, { freq: 700, sweepTo: 2600, q: 0.9, dur: 0.2, gain: 0.25 })] },
  turn:    { variants: [(t) => notes(t, [A5, E6], 0.11, { dur: 0.35, gain: 0.16 })] },
  click:   { variants: [(t) => tone(t, { freq: 1800, dur: 0.04, gain: 0.12, type: "triangle" })] },
  declare: { variants: [(t) => notes(t, [C5, E5, G5, C6], 0.07, { dur: 0.3, gain: 0.18, type: "triangle" })] },
  baloot:  { variants: [(t) => { notes(t, [G5, C6], 0.12, { dur: 0.3, gain: 0.2, type: "triangle" });
                                  notes(t + 0.26, [C5, E5, G5, C6], 0, { dur: 0.7, gain: 0.12, type: "triangle" }); }] },
  double:  { variants: [(t) => { tone(t, { freq: 150, slideTo: 45, dur: 0.35, gain: 0.6 });
                                  burst(t, { freq: 180, q: 0.7, dur: 0.15, gain: 0.4, type: "lowpass" }); }] },
  gahwa:   { variants: [(t) => { for (let i = 0; i < 3; i++) tone(t + i * 0.16, { freq: 140, slideTo: 45, dur: 0.3, gain: 0.55 }); }] },
  error:   { variants: [(t) => notes(t, [220, 165], 0.14, { dur: 0.22, gain: 0.18, type: "square" })] },
  winRound:  { variants: [(t) => notes(t, [C5, E5, G5], 0.09, { dur: 0.4, gain: 0.18, type: "triangle" })] },
  loseRound: { variants: [(t) => notes(t, [A4, F4, D4], 0.13, { dur: 0.45, gain: 0.16, type: "triangle" })] },
  kaboot:    { variants: [(t) => { notes(t, [C5, E5, G5, C6, E6], 0.08, { dur: 0.35, gain: 0.18, type: "triangle" });
                                    notes(t + 0.45, [C5, G5, C6, E6], 0, { dur: 1.1, gain: 0.1, type: "triangle" }); }] },
  winMatch:  { variants: [(t) => { notes(t, [G5, G5, G5, C6], 0.14, { dur: 0.3, gain: 0.18, type: "triangle" });
                                    notes(t + 0.6, [C5, E5, G5, C6], 0, { dur: 1.3, gain: 0.1, type: "triangle" }); }] },
  loseMatch: { variants: [(t) => notes(t, [G5, D5, A4, F4], 0.2, { dur: 0.55, gain: 0.15, type: "triangle" })] },
};

const lastVariant = {};
const fileCache = new Map();

export function play(key) {
  const album = ALBUMS[key];
  if (!settings.sfx || !album || !ac()) return;
  const n = album.variants.length;
  let i = Math.floor(Math.random() * n);
  if (n > 1 && i === lastVariant[key]) i = (i + 1) % n;
  lastVariant[key] = i;
  const v = album.variants[i];
  if (typeof v === "function") { v(ctx.currentTime + 0.01); return; }
  let a = fileCache.get(v);
  if (!a) { a = new Audio(v); fileCache.set(v, a); }
  a.volume = settings.volume;
  a.currentTime = 0;
  a.play().catch(() => {});
}

// ---------- Narrator ----------
// Line keys the game can call. Recorded packs provide <key>.mp3; text is the TTS fallback.
export const VOICE_LINES = {
  sun: "صن", hokom: "حكم", ashkal: "أشكال", pass: "بس", confirm: "أثبت",
  hokom_spades: "حكم بستوني", hokom_hearts: "حكم كبّة", hokom_diamonds: "حكم ديناري", hokom_clubs: "حكم سباتي",
  double: "دبل", triple: "ثري", four: "فور", gahwa: "قهوة",
  sira: "سرا", p50: "خمسين", p100: "مية", p400: "أربعمية", baloot: "بلوت",
  qaid: "قيد", kaboot: "كبوت", redeal: "توزيع جديد", ekka: "إكة",
};

// Recorded narrator packs you own. To add one: put <key>.mp3 files for VOICE_LINES in
// web/assets/voices/<id>/ and register it here, e.g. { id: "rashid", name: "راشد" }.
export const VOICE_PACKS = [];

let arVoices = [];
function loadVoices() {
  if (!("speechSynthesis" in window)) return;
  arVoices = speechSynthesis.getVoices().filter((v) => v.lang && v.lang.toLowerCase().startsWith("ar"));
}
if ("speechSynthesis" in window) { loadVoices(); speechSynthesis.addEventListener?.("voiceschanged", loadVoices); }

// Narrator choices for the settings menu.
export function narrators() {
  const list = [{ id: "off", name: "بدون معلّق" }];
  if ("speechSynthesis" in window) {
    list.push({ id: "tts", name: "صوت الجهاز" + (arVoices.length ? "" : " (ما فيه صوت عربي)") });
    for (const v of arVoices) list.push({ id: "tts:" + v.voiceURI, name: "صوت الجهاز: " + v.name });
  }
  for (const p of VOICE_PACKS) list.push({ id: p.id, name: p.name });
  return list;
}

const speakQueue = [];
let speaking = false;

export function say(key) {
  if (settings.narrator === "off" || !VOICE_LINES[key]) return;
  // Keep the narrator in step with the table: drop old lines instead of lagging behind.
  if (speakQueue.length >= 2) speakQueue.shift();
  speakQueue.push(key);
  if (!speaking) nextLine();
}

function nextLine() {
  const key = speakQueue.shift();
  if (!key) { speaking = false; return; }
  speaking = true;
  const pack = VOICE_PACKS.find((p) => p.id === settings.narrator);
  if (pack) {
    const a = new Audio(`assets/voices/${pack.id}/${key}.mp3`);
    a.volume = settings.volume;
    let fellBack = false;
    const fallback = () => { if (!fellBack) { fellBack = true; speakTTS(key); } };   // line missing from the pack
    a.onended = nextLine;
    a.onerror = fallback;
    a.play().catch(fallback);
  } else speakTTS(key);
}

function speakTTS(key) {
  if (!("speechSynthesis" in window)) { nextLine(); return; }
  const u = new SpeechSynthesisUtterance(VOICE_LINES[key]);
  const uri = settings.narrator.startsWith("tts:") ? settings.narrator.slice(4) : null;
  u.voice = arVoices.find((v) => v.voiceURI === uri) || arVoices.find((v) => /sa/i.test(v.lang)) || arVoices[0] || null;
  u.lang = u.voice?.lang || "ar-SA";
  u.volume = settings.volume;
  u.rate = 1.05;
  let done = false;
  const next = () => { if (!done) { done = true; nextLine(); } };
  u.onend = next; u.onerror = next;
  setTimeout(next, 3000);                 // some engines never fire onend
  speechSynthesis.speak(u);
}

// ---------- Settings ----------
export const getSettings = () => ({ ...settings });
export function setSettings(patch) {
  Object.assign(settings, patch);
  if (master) master.gain.value = settings.volume;
  if (settings.narrator === "off" && "speechSynthesis" in window) { speakQueue.length = 0; speechSynthesis.cancel(); }
  save();
}
