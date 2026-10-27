// Admin panel: list accounts, adjust balances, deactivate or delete players. Only an admin
// (by ADMIN_EMAILS, enforced by Firestore rules) can actually write — others get permission errors.
import { initFirebase, onUserChange, watchUsers, watchBanned, adjustCoins, setCoins,
  setDisabled, deleteAccount, restoreAccount, state } from "./auth.js?v=13";
import { isConfigured } from "./firebase-config.js?v=13";

const $ = (id) => document.getElementById(id);
const rows = new Map(); // uid → row element, updated in place so typing in a field isn't wiped
let started = false;

async function boot() {
  if (!isConfigured()) { msg("Firebase غير مهيّأ بعد. راجع docs/FIREBASE.md"); return; }
  await initFirebase();
  onUserChange((user) => {
    if (!user) { msg("سجّل الدخول بحساب الأدمن أولاً.", true); setTimeout(() => (location.href = "index.html"), 1500); return; }
    if (!state.profile?.isAdmin) { msg("هذا الحساب ليس أدمن.", true); return; }
    // onUserChange fires on every profile change too — subscribe only once.
    if (started) return;
    started = true;
    $("users-list").textContent = "جارٍ التحميل…";
    watchUsers(renderUsers, (e) => { msg("تعذّر تحميل المستخدمين — تأكد أن حسابك أدمن وأن القواعد مطبّقة.", true); console.error(e); });
    watchBanned(renderBanned, (e) => console.error(e));
  });
}

function renderUsers(users) {
  const list = $("users-list");
  if (!rows.size) list.textContent = "";
  users.sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "ar"));
  const seen = new Set();
  for (const u of users) {
    seen.add(u.uid);
    let row = rows.get(u.uid);
    if (!row) { row = buildRow(u.uid); rows.set(u.uid, row); }
    fillRow(row, u);
    list.appendChild(row); // keeps the sorted order (moves existing rows)
  }
  for (const [uid, row] of rows) if (!seen.has(uid)) { row.remove(); rows.delete(uid); }
  if (!users.length) list.textContent = "لا يوجد مستخدمون بعد.";
}

function buildRow(uid) {
  const row = document.createElement("div");
  row.className = "user-row";
  row.innerHTML =
    `<div class="u-info"><div class="u-name"></div><div class="u-email"></div></div>` +
    `<div class="u-coins"></div>` +
    `<div class="admin-actions full">
       <input class="amount" type="text" inputmode="numeric" placeholder="المبلغ" />
       <button class="give" data-op="add">➕ زيادة</button>
       <button class="take" data-op="sub">➖ خصم</button>
       <button data-op="set">= تعيين</button>
       <button class="give" data-quick="100">+100</button>
       <button class="give" data-quick="1000">+1000</button>
     </div>
     <div class="admin-actions full account-actions">
       <button class="warn" data-op="toggle"></button>
       <button class="take" data-op="delete">🗑️ حذف الحساب</button>
     </div>`;
  const input = row.querySelector(".amount");
  const amount = () => parseAmount(input.value);
  const u = () => row._user;
  const busy = async (fn, okText) => {
    row.querySelectorAll("button, input").forEach((el) => (el.disabled = true));
    try { await fn(); if (okText) msg(okText); input.value = ""; }
    catch (e) { msg("فشلت العملية: " + (e?.code || e?.message || e), true); console.error(e); }
    finally { row.querySelectorAll("button, input").forEach((el) => (el.disabled = false)); fillRow(row, u()); }
  };
  row.querySelector('[data-op="add"]').onclick = () => {
    const n = amount(); if (!n) return needAmount(input);
    busy(() => adjustCoins(uid, n), `✔ أضفت ${n} 🪙 لـ ${u().name}`);
  };
  row.querySelector('[data-op="sub"]').onclick = () => {
    const n = amount(); if (!n) return needAmount(input);
    busy(() => adjustCoins(uid, -n), `✔ خصمت ${n} 🪙 من ${u().name}`);
  };
  row.querySelector('[data-op="set"]').onclick = () => {
    const n = parseAmount(input.value, true); if (n === null) return needAmount(input);
    busy(() => setCoins(uid, n), `✔ رصيد ${u().name} صار ${n} 🪙`);
  };
  row.querySelectorAll("[data-quick]").forEach((b) => {
    b.onclick = () => { const n = +b.dataset.quick; busy(() => adjustCoins(uid, n), `✔ أضفت ${n} 🪙 لـ ${u().name}`); };
  });
  row.querySelector('[data-op="toggle"]').onclick = () => {
    const off = !u().disabled;
    if (off && !confirm(`إيقاف حساب ${u().name}؟ ما يقدر يدخل أو يلعب لين تفعّله.`)) return;
    busy(() => setDisabled(uid, off), off ? `⛔ أوقفت حساب ${u().name}` : `✅ فعّلت حساب ${u().name}`);
  };
  row.querySelector('[data-op="delete"]').onclick = () => {
    if (!confirm(`حذف حساب ${u().name} (${u().email})؟\nيروح رصيده (${u().coins ?? 0} 🪙) وما يقدر يدخل مرة ثانية.`)) return;
    busy(() => deleteAccount(u()), `🗑️ حذفت حساب ${u().name}`);
  };
  return row;
}

function fillRow(row, u) {
  if (!u) return;
  row._user = u;
  const self = u.uid === state.user?.uid;
  row.classList.toggle("disabled", !!u.disabled);
  row.querySelector(".u-name").textContent = (u.name || "لاعب") + (u.isAdmin || self ? " 👑" : "") + (u.disabled ? " · ⛔ موقوف" : "");
  row.querySelector(".u-email").textContent = u.email || "";
  row.querySelector(".u-coins").textContent = `🪙 ${u.coins ?? 0}`;
  row.querySelector('[data-op="toggle"]').textContent = u.disabled ? "✅ تفعيل" : "⛔ إيقاف";
  // Never lock yourself out of the admin account.
  row.querySelector(".account-actions").style.display = self ? "none" : "";
}

function renderBanned(list) {
  const box = $("banned-list");
  box.textContent = "";
  $("banned-wrap").style.display = list.length ? "" : "none";
  for (const b of list) {
    const row = document.createElement("div");
    row.className = "user-row disabled";
    row.innerHTML = `<div class="u-info"><div class="u-name"></div><div class="u-email"></div></div>` +
      `<div class="admin-actions"><button class="give">↩️ استرجاع</button></div>`;
    row.querySelector(".u-name").textContent = `${b.name || "لاعب"} · كان رصيده ${b.coins ?? 0}`;
    row.querySelector(".u-email").textContent = b.email || b.uid;
    row.querySelector("button").onclick = async () => {
      if (!confirm(`استرجاع حساب ${b.name}؟ يقدر يدخل مرة ثانية ويبدأ برصيد جديد.`)) return;
      try { await restoreAccount(b.uid); msg(`↩️ استرجعت حساب ${b.name}`); }
      catch (e) { msg("فشلت العملية: " + (e?.code || e), true); }
    };
    box.appendChild(row);
  }
}

// Accepts Arabic/Persian digits ("١٠٠"), commas and spaces. Returns a positive integer, or null.
// allowZero: for "set balance", where 0 is a valid value.
function parseAmount(v, allowZero) {
  const s = String(v || "").trim()
    .replace(/[٠-٩]/g, (d) => d.charCodeAt(0) - 0x660)
    .replace(/[۰-۹]/g, (d) => d.charCodeAt(0) - 0x6f0)
    .replace(/[,،٬\s]/g, "");
  if (!/^\d+$/.test(s)) return null;
  const n = parseInt(s, 10);
  return n > 0 || (allowZero && n === 0) ? n : null;
}

function needAmount(input) { msg("اكتب المبلغ أولاً (أرقام بس).", true); input.focus(); }

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function msg(t, isErr) { const el = $("admin-msg"); el.innerHTML = esc(t); el.style.color = isErr ? "#ff9a8d" : "#9fe3b6"; }

boot();
