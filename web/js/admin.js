// Admin panel: list accounts and adjust balances. Only an admin (by ADMIN_EMAILS,
// enforced by Firestore rules) can actually write — non-admins get permission errors.
import { initFirebase, onUserChange, listUsers, adjustCoins, setCoins, state } from "./auth.js?v=7";
import { isConfigured } from "./firebase-config.js?v=7";

const $ = (id) => document.getElementById(id);

async function boot() {
  if (!isConfigured()) { msg("Firebase غير مهيّأ بعد. راجع docs/FIREBASE.md"); return; }
  await initFirebase();
  onUserChange(async (user) => {
    if (!user) { msg("سجّل الدخول بحساب الأدمن أولاً.", true); setTimeout(() => (location.href = "index.html"), 1500); return; }
    if (!state.profile?.isAdmin) { msg("هذا الحساب ليس أدمن.", true); return; }
    await renderUsers();
  });
}

async function renderUsers() {
  const list = $("users-list");
  list.innerHTML = "جارٍ التحميل…";
  try {
    const users = await listUsers();
    users.sort((a, b) => (b.coins || 0) - (a.coins || 0));
    list.innerHTML = "";
    for (const u of users) {
      const row = document.createElement("div");
      row.className = "user-row";
      row.innerHTML =
        `<div><div class="u-name">${esc(u.name || "لاعب")}${u.isAdmin ? " 👑" : ""}</div>` +
        `<div class="u-email">${esc(u.email || "")}</div></div>` +
        `<div class="u-coins">🪙 ${u.coins ?? 0}</div>` +
        `<div class="admin-actions">
           <button class="give" data-add="100">+100</button>
           <button class="give" data-add="1000">+1000</button>
           <button class="take" data-add="-100">-100</button>
           <button data-set="1">✎</button>
         </div>`;
      row.querySelectorAll("[data-add]").forEach((b) => {
        b.onclick = async () => { await adjustCoins(u.uid, Number(b.dataset.add)); await renderUsers(); };
      });
      row.querySelector("[data-set]").onclick = async () => {
        const v = prompt(`الرصيد الجديد لـ ${u.name}:`, u.coins ?? 0);
        if (v !== null && !isNaN(+v)) { await setCoins(u.uid, +v); await renderUsers(); }
      };
      list.appendChild(row);
    }
    if (!users.length) list.innerHTML = "لا يوجد مستخدمون بعد.";
  } catch (e) {
    msg("تعذّر تحميل المستخدمين — تأكد أن حسابك أدمن وأن القواعد مطبّقة.", true);
    console.error(e);
  }
}

function esc(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
function msg(t, isErr) { const el = $("admin-msg"); el.textContent = t; el.style.color = isErr ? "#ff9a8d" : "#9fe3b6"; }

boot();
