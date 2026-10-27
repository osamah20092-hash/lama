// Firebase web config — SAFE to be public (these are identifiers, not secrets;
// real security is enforced by Firestore rules). Fill these from your Firebase
// console: Project settings ▸ Your apps ▸ Web app ▸ SDK setup and configuration.
//
// Until you paste real values, the app runs in GUEST mode (play vs computer only).

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCZZBatL5WCb3SRGkIkQq0cIOe8jr789jo",
  authDomain: "baloot-lamma.firebaseapp.com",
  projectId: "baloot-lamma",
  storageBucket: "baloot-lamma.firebasestorage.app",
  messagingSenderId: "976251255807",
  appId: "1:976251255807:web:f008d4580571c6cb9e45ca",
};

// Email(s) that act as ADMIN (can manage every account's balance).
// Put the email you will sign in with. Must match EXACTLY.
export const ADMIN_EMAILS = ["osamah20092@gmail.com"];

// Starting coins granted once when a new account is created.
export const STARTING_BALANCE = 1000;

// --- Coins / betting (vs computer) ---
// Turn client-side winnings on/off. For a trusted friends group this is fine;
// it is bounded by MAX_SINGLE_WIN so no single write can mint more than that.
export const COINS_ON_WIN = true;
// Stake tiers the player can pick before a match (0 = practice, no coins).
export const BET_TIERS = [0, 10, 50, 100];
// Hard cap on how much a single wallet write may add (anti-abuse; see firestore.rules).
export const MAX_SINGLE_WIN = 200;

// EXPERIMENTAL: "📊 إحصائياتي" on the home screen — your record against each friend in private
// sessions (see js/stats.js). Set to false to hide it.
export const SHOW_H2H = true;

export function isConfigured() {
  return FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith("PASTE");
}
