// Firebase web config — SAFE to be public (these are identifiers, not secrets;
// real security is enforced by Firestore rules). Fill these from your Firebase
// console: Project settings ▸ Your apps ▸ Web app ▸ SDK setup and configuration.
//
// Until you paste real values, the app runs in GUEST mode (play vs computer only).

export const FIREBASE_CONFIG = {
  apiKey: "PASTE_API_KEY",
  authDomain: "PASTE.firebaseapp.com",
  projectId: "PASTE_PROJECT_ID",
  storageBucket: "PASTE.appspot.com",
  messagingSenderId: "PASTE_SENDER_ID",
  appId: "PASTE_APP_ID",
};

// Email(s) that act as ADMIN (can manage every account's balance).
// Put the email you will sign in with. Must match EXACTLY.
export const ADMIN_EMAILS = ["osamah20092@gmail.com"];

// Starting coins granted once when a new account is created.
export const STARTING_BALANCE = 1000;

export function isConfigured() {
  return FIREBASE_CONFIG.apiKey && !FIREBASE_CONFIG.apiKey.startsWith("PASTE");
}
