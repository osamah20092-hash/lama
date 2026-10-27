// Firebase auth + wallet layer. Loads the Firebase SDK lazily only when configured,
// so the game still runs in guest mode before you set up Firebase.
import { FIREBASE_CONFIG, ADMIN_EMAILS, STARTING_BALANCE, isConfigured } from "./firebase-config.js?v=7";

const SDK = "https://www.gstatic.com/firebasejs/10.12.2";

let app, auth, db, fns = {};
let profileUnsub = null;

export const state = {
  configured: isConfigured(),
  user: null,        // firebase user
  profile: null,     // { uid, name, email, coins, isAdmin }
};

export function isAdminEmail(email) {
  return !!email && ADMIN_EMAILS.map((e) => e.toLowerCase()).includes(email.toLowerCase());
}

export async function initFirebase() {
  if (!state.configured) return false;
  const [{ initializeApp }, authMod, fsMod] = await Promise.all([
    import(`${SDK}/firebase-app.js`),
    import(`${SDK}/firebase-auth.js`),
    import(`${SDK}/firebase-firestore.js`),
  ]);
  // Local testing against the Firebase emulators: open http://localhost:<port>/?emu once.
  // Each tab then signs in separately (session persistence), so two tabs = two players.
  const emu = ["localhost", "127.0.0.1"].includes(location.hostname)
    && (new URLSearchParams(location.search).has("emu") || sessionStorage.getItem("emu"));
  app = initializeApp(emu ? { ...FIREBASE_CONFIG, projectId: "demo-lamma" } : FIREBASE_CONFIG);
  auth = authMod.getAuth(app);
  db = fsMod.getFirestore(app);
  if (emu) {
    sessionStorage.setItem("emu", "1");
    authMod.connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    fsMod.connectFirestoreEmulator(db, "127.0.0.1", 8080);
    await authMod.setPersistence(auth, authMod.browserSessionPersistence);
  }
  fns = { ...authMod, ...fsMod };
  return true;
}

// Raw Firestore handle + SDK functions, for modules that need more than the wallet (rooms.js).
export function fire() { return { db, fns }; }

// Subscribe to sign-in/out. cb(user|null) runs on every change.
export function onUserChange(cb) {
  if (!state.configured) { cb(null); return; }
  fns.onAuthStateChanged(auth, async (user) => {
    state.user = user;
    if (profileUnsub) { profileUnsub(); profileUnsub = null; }
    if (user) {
      await ensureProfile(user);
      watchProfile(user.uid, () => cb(user));
    } else {
      state.profile = null;
      cb(null);
    }
  });
}

async function ensureProfile(user) {
  const ref = fns.doc(db, "users", user.uid);
  const snap = await fns.getDoc(ref);
  if (!snap.exists()) {
    await fns.setDoc(ref, {
      name: user.displayName || (user.email || "لاعب").split("@")[0],
      email: user.email || "",
      coins: STARTING_BALANCE,
      isAdmin: false,
      createdAt: fns.serverTimestamp(),
    });
  }
}

function watchProfile(uid, cb) {
  const ref = fns.doc(db, "users", uid);
  profileUnsub = fns.onSnapshot(ref, (snap) => {
    const d = snap.data() || {};
    state.profile = {
      uid,
      name: d.name || "لاعب",
      email: d.email || "",
      coins: typeof d.coins === "number" ? d.coins : 0,
      isAdmin: !!d.isAdmin || isAdminEmail(d.email),
    };
    cb();
  });
}

// --- Auth actions ---
export async function signUp(email, password, name) {
  const cred = await fns.createUserWithEmailAndPassword(auth, email, password);
  if (name) await fns.updateProfile(cred.user, { displayName: name });
  await ensureProfile(cred.user);
  return cred.user;
}
export function signIn(email, password) {
  return fns.signInWithEmailAndPassword(auth, email, password);
}
export function logout() { return fns.signOut(auth); }

// --- Admin: list users + adjust balance ---
export async function listUsers() {
  const q = await fns.getDocs(fns.collection(db, "users"));
  const out = [];
  q.forEach((d) => out.push({ uid: d.id, ...d.data() }));
  return out;
}

export async function adjustCoins(uid, delta) {
  const ref = fns.doc(db, "users", uid);
  await fns.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.exists() ? (snap.data().coins || 0) : 0;
    tx.update(ref, { coins: Math.max(0, cur + delta) });
  });
}

export async function setCoins(uid, value) {
  await fns.updateDoc(fns.doc(db, "users", uid), { coins: Math.max(0, Math.floor(value)) });
}

// --- Betting (vs computer) ---
// Deduct a stake at match start. Throws if the balance is too low.
export async function placeStake(amount) {
  if (!state.user || amount <= 0) return;
  const ref = fns.doc(db, "users", state.user.uid);
  await fns.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.data().coins || 0;
    if (cur < amount) throw new Error("insufficient");
    tx.update(ref, { coins: cur - amount });
  });
}

// Credit winnings at match end.
export async function awardWin(amount) {
  if (!state.user || amount <= 0) return;
  const ref = fns.doc(db, "users", state.user.uid);
  await fns.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const cur = snap.data().coins || 0;
    tx.update(ref, { coins: cur + amount });
  });
}

// Append a match record for admin audit (append-only).
export async function logMatch(stake, won) {
  if (!state.user) return;
  try {
    await fns.addDoc(fns.collection(db, "matches"), {
      uid: state.user.uid,
      name: state.profile?.name || "",
      stake, won, mode: "cpu",
      ts: fns.serverTimestamp(),
    });
  } catch (_) { /* logging is best-effort */ }
}
