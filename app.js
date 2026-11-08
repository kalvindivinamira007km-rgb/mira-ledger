/* Mira Ledger screens. All money maths lives in core.js; this file only draws it and collects input. */
(function () {
"use strict";
const C = Core, $ = q => document.querySelector(q);
const KEY = "mira-v2-data", OLD_KEY = "mira-ledger-data-v1", VERSION = "3.5";
let S = null;
const UI = { tab: "home", month: C.today().slice(0, 7), sheets: [], wiz: null, actFilter: "all", actMode: "list", scope: "all", planMode: "bills", period: "week", weekFrom: "" };

/* ---------- small helpers ---------- */
const esc = v => String(v ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const lsGet = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } };
function money(n, cur) {
  const v = +n || 0, abs = Math.abs(v), whole = Math.abs(abs - Math.round(abs)) < 0.005;
  const txt = abs.toLocaleString("en-PH", { minimumFractionDigits: whole ? 0 : 2, maximumFractionDigits: whole ? 0 : 2 });
  return (v < -0.004 ? "−" : "") + (cur === "USD" ? "$" : "₱") + txt;
}
const fmtDate = (s, withDay) => C.dparse(s).toLocaleDateString("en-PH", withDay ? { weekday: "short", month: "short", day: "numeric" } : { month: "short", day: "numeric" });
const monthName = (m, short) => C.dparse(m + "-01").toLocaleDateString("en-PH", short ? { month: "long" } : { month: "long", year: "numeric" });
const opts = (list, val) => list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(val ?? "") ? " selected" : ""}>${esc(l)}</option>`).join("");
const accounts = () => (S.accounts || []).filter(a => !a.archived);
const ICON = {
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/></svg>',
  home: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 11l8-7 8 7v8a1 1 0 0 1-1 1h-4v-6H9v6H5a1 1 0 0 1-1-1z"/></svg>',
  list: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M4 6h16M4 12h16M4 18h10"/></svg>',
  plus: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  plan: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="5" width="16" height="15" rx="2"/><path d="M4 10h16M9 3v4M15 3v4"/></svg>',
  debt: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 4h14v16l-3-2-2 2-2-2-2 2-2-2-3 2z"/><path d="M9 9h6M9 13h6"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>',
  camera: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h3l2-3h6l2 3h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V9a1 1 0 0 1 1-1z"/><circle cx="12" cy="13" r="3.5"/></svg>'
};

/* ---------- saving: every change can be undone ---------- */
function save() {
  if (!lsSet(KEY, JSON.stringify(S))) toast("Couldn't save. Your phone's storage may be full. Download a backup now.");
}
function commit(fn, msg) {
  const prev = JSON.stringify(S);
  fn(S);
  save();
  render();
  if (msg) toast(msg, () => { S = JSON.parse(prev); save(); render(); toast("Undone"); });
}
let toastT;
function toast(msg, undo) {
  const t = $("#toast");
  t.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button id="undoBtn">Undo</button>' : ""}`;
  t.hidden = false;
  if (undo) $("#undoBtn").onclick = () => { t.hidden = true; undo(); };
  clearTimeout(toastT);
  toastT = setTimeout(() => { t.hidden = true; }, undo ? 6000 : 3200);
}

/* Receipt photos live in the browser's database, apart from the ledger */
const RDB = {
  open() { return new Promise((res, rej) => { const r = indexedDB.open("mira-receipts", 1); r.onupgradeneeded = () => r.result.createObjectStore("r"); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }); },
  async put(id, blob) { const db = await this.open(); return new Promise((res, rej) => { const t = db.transaction("r", "readwrite"); t.objectStore("r").put(blob, id); t.oncomplete = res; t.onerror = () => rej(t.error); }); },
  async get(id) { const db = await this.open(); return new Promise(res => { const q = db.transaction("r").objectStore("r").get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); }); },
  async del(id) { const db = await this.open(); db.transaction("r", "readwrite").objectStore("r").delete(id); }
};

/* ---------- light and dark ---------- */
const themePref = () => { const t = lsGet("mira-theme"); return t === "light" || t === "dark" ? t : "system"; };
function applyTheme() {
  const t = themePref();
  if (t === "system") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = t;
  const dark = t === "dark" || (t === "system" && window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", dark ? "#1E1116" : "#FFE5EC");
}
const isDark = () => { const t = themePref(); return t === "dark" || (t === "system" && !!window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches); };
applyTheme();
try { matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme); } catch (e) {}

/* ---------- shared pieces ---------- */
const signOf = e => { const g = C.groupOf(S, e); return g === "earned" || g === "borrowed" || g === "collected" ? "+" : g === "spent" || g === "debtpay" || g === "lent" ? "−" : ""; };
const catOf = e => e.kind === "debt" ? "Loans" : e.category;
function entryRow(e, opt) {
  const g = C.groupOf(S, e), a = C.acct(S, e.accountId), sign = signOf(e);
  
  const parts = [fmtDate(e.date)];
  if (g === "spent" && e.category && e.kind === "expense" && e.note) parts.push(e.category);
  if (e.kind === "bill") parts.push(e.category || "Bill");
  if (e.kind === "expense" && !e.note) { /* the title already shows the category */ }
  if (a) parts.push(a.name);
  if (g === "borrowed" || g === "collected") parts.push("not income");
  if (g === "lent") parts.push("not spending");
  const title = C.entryTitle(S, e);
  const fx = e.currency === "USD" ? `<small>≈ ${money(C.entPHP(S, e))}</small>` : "";
  const amtText = e.kind === "correction" ? (e.amount > 0 ? "+" : "") + money(e.amount, e.currency) : e.kind === "debtadjust" ? (e.amount > 0 ? "+" : "") + money(e.amount) : sign + money(e.amount, e.currency);
  return `<button class="row" data-a="editEntry" data-x="${e.id}">${entryTile(e)}<span class="grow"><span class="rowt">${esc(title)}</span><br><span class="rows">${esc(parts.join(" · "))}${opt && opt.balance !== undefined ? "" : ""}</span></span><span class="amt ${["borrowed", "lent", "collected"].includes(g) ? "loan" : sign === "+" ? "in" : ""}">${amtText}${opt && opt.balance !== undefined ? `<small>${opt.owedLabel || "owed"} ${money(opt.balance)}</small>` : fx}</span></button>`;
}
function statementRows(m) {
  const st = C.statement(S, m), now = C.today(), past = (m + "-" + C.pad(C.daysIn(m))) < now;
  const row = (sign, label, val, key, dot) => `<button class="eq" data-a="openGroup" data-x="${m}|${key}"><span class="l"><span class="sign">${sign}</span><span>${label}</span></span><span class="r">${money(val)}<span class="chev">›</span></span></button>`;
  const fixed = (label, val) => `<div class="eq"><span class="l"><span class="sign"></span><span>${label}</span></span><span class="r">${money(val)}</span></div>`;
  let h = fixed("Started " + monthName(m, true) + " with", st.start);
  h += row("+", "Earned", st.earned, "earned");
  if (st.borrowed) h += row("+", "Borrowed <span class='small muted'>(not income)</span>", st.borrowed, "borrowed");
  if (st.collected) h += row("+", "Paid back to you <span class='small muted'>(not income)</span>", st.collected, "collected");
  h += row("−", "Spent", st.spent, "spent");
  if (st.debtpay) h += row("−", "Debt payments", st.debtpay, "debtpay");
  if (st.lent) h += row("−", "Lent out <span class='small muted'>(not spending)</span>", st.lent, "lent");
  if (st.correction) h += row(st.correction > 0 ? "+" : "−", "Balance corrections", Math.abs(st.correction), "correction");
  if (st.exchange) h += `<button class="eq" data-a="explainExchange"><span class="l"><span class="sign">${st.exchange > 0 ? "+" : "−"}</span><span>Exchange and fees</span></span><span class="r">${money(Math.abs(st.exchange))}<span class="chev">›</span></span></button>`;
  h += `<div class="eq tot"><span class="l"><span class="sign">=</span><span>${past ? "Ended with" : "You have now"}</span></span><span class="r">${money(st.end)}</span></div>`;
  return h;
}
const monthBar = () => `<div class="monthbar"><button data-a="month" data-x="-1" aria-label="Previous month">‹</button><span>${esc(C.dparse(UI.month + "-01").toLocaleDateString("en-PH", { month: "short", year: "numeric" }))}</span><button data-a="month" data-x="1" aria-label="Next month">›</button></div>`;
const seg = (act, list, val) => `<div class="seg" role="tablist">${list.map(([v, l]) => `<button role="tab" aria-selected="${v === val}" class="${v === val ? "on" : ""}" data-a="${act}" data-x="${v}">${l}</button>`).join("")}</div>`;
/* A light/dark switch sits in the top bar of every main screen. */
const themeBtn = () => `<button class="iconbtn themebtn" data-a="toggleTheme" aria-label="Switch between light and dark"><svg class="moon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/></svg><svg class="sun" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg></button>`;
const pageTop = (title, right) => `<header class="top"><h1>${title}</h1><span class="tright">${right || ""}${themeBtn()}</span></header>`;
const statusPill = x => {
  if (x.status === "paid") return '<span class="pill paid">Paid</span>';
  if (x.status === "skipped") return '<span class="pill skipped">Not this month</span>';
  if (x.status === "overdue") return `<span class="pill overdue">${-x.diff === 1 ? "1 day late" : -x.diff + " days late"}</span>`;
  if (x.status === "soon") return `<span class="pill soon">${x.diff === 0 ? "Due today" : x.diff === 1 ? "Tomorrow" : "In " + x.diff + " days"}</span>`;
  return `<span class="pill">${fmtDate(x.due)}</span>`;
};

/* Icon tiles: quicker to scan than a color dot, and the category color still carries over. */
const CAT_ICON = { Rent: "🏠", Utilities: "💡", Loans: "🧾", Groceries: "🛒", "Entertainment/Memberships": "🎬", Gas: "⛽", "Car/Gas": "⛽", Toll: "🛣️", Meat: "🥩", "Fruits & Veggies": "🥦", Furniture: "🛋️", Laundry: "🧺", Pets: "🐾", "Gifts/Holiday": "🎁", Medical: "💊", Activities: "🎯", "Eat Out": "🍽️", Other: "📦", "Software & subscriptions": "💻", "Contractors & VAs": "👥", "Ads & marketing": "📣", Equipment: "🖥️", "Platform & bank fees": "🏦", "Internet & phone": "📶", Training: "📚", "Taxes & registration": "📄", "Other business": "💼" };
const tile = (icon, color) => `<span class="tile" style="--c:${color}" aria-hidden="true">${esc(icon)}</span>`;
const catIcon = c => (S.catIcons || {})[c] || CAT_ICON[c] || String(c || "?").trim().charAt(0).toUpperCase();
const catTile = c => tile(catIcon(c), C.catColor(S, c));
const acctIcon = a => a.icon || ({ Bank: "🏦", "E-wallet": "📱", Wallet: "👛", Cash: "💵" }[a.type]) || a.name.trim().charAt(0).toUpperCase();

/* ---------- pickers: dates, months and icons, drawn by the app so they work everywhere ---------- */
const pickLabel = (kind, v, ph) => !v ? (ph || "Choose") : kind === "month" ? monthName(v) : kind === "icon" ? v : fmtDate(v, true) + (v.slice(0, 4) !== C.today().slice(0, 4) ? ", " + v.slice(0, 4) : "");
/* "· 4 payments left, last Dec 12" / "· becomes ₱9,000 on Dec 1" for an income source's row. */
function streamNote(x) {
  const now = C.today(), bits = [];
  const next = (x.changes || []).filter(r => r.from > now).sort((a, b) => a.from.localeCompare(b.from))[0];
  if (next && !x.archived) bits.push("becomes " + money(next.amount, x.currency) + " on " + fmtDate(next.from, true));
  if (x.until && !x.archived) { const n = C.paysLeft(x, now); bits.push(x.until < now ? "ended " + fmtDate(x.until, true) : n + (n === 1 ? " payment" : " payments") + " left, last " + fmtDate(x.until, true)); }
  return bits.length ? " · " + bits.join(" · ") : "";
}
function pick(kind, id, attrs, value, optional, ph) {
  return `<input type="hidden" id="${id}" ${attrs} value="${esc(value || "")}"><button type="button" class="inp pickbtn ${value ? "" : "unset"}" id="${id}-btn" data-a="openPicker" data-x="${id}|${kind}|${optional ? 1 : 0}|${esc(ph || "")}">${esc(pickLabel(kind, value, ph))}</button>`;
}
const ICON_CHOICES = ["🛒", "🍽️", "🍜", "☕", "🍔", "🥩", "🥦", "🍞", "🧃", "🍺", "⛽", "🚗", "🛵", "🚌", "🚕", "✈️", "🏠", "💡", "💧", "📶", "📱", "💻", "🎬", "🎮", "🎵", "📚", "🎓", "💊", "🏥", "🧴", "💇", "👕", "👟", "🛍️", "🎁", "🐾", "👶", "🧸", "🧺", "🧹", "🛋️", "🔧", "🏦", "💳", "💵", "💰", "👛", "🧾", "📦", "💼", "📣", "🙏", "⛪", "🎉", "🏋️", "🌱", "❤️", "⭐"];
let PK = null;
function drawPicker() {
  let host = $("#picker");
  if (!host) { host = document.createElement("div"); host.id = "picker"; document.body.appendChild(host); }
  if (!PK) { host.innerHTML = ""; return; }
  let body = "", title = "";
  if (PK.kind === "date") {
    const m = PK.view, first = C.dparse(m + "-01").getDay(), n = C.daysIn(m), sel = $("#" + PK.id) ? $("#" + PK.id).value : "", now = C.today();
    title = monthName(m);
    const cells = [];
    for (let i = 0; i < first; i++) cells.push("<span></span>");
    for (let d = 1; d <= n; d++) { const v = m + "-" + C.pad(d); cells.push(`<button type="button" class="pkday ${v === sel ? "on" : ""} ${v === now ? "now" : ""}" data-a="pkSet" data-x="${v}" aria-label="${esc(fmtDate(v, true))}">${d}</button>`); }
    body = `<div class="pkweek">${["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"].map(w => `<span>${w}</span>`).join("")}</div><div class="pkgrid">${cells.join("")}</div>
      <div class="btnrow"><button type="button" class="btn sm" data-a="pkSet" data-x="${now}">Today</button>${PK.optional ? `<button type="button" class="btn sm" data-a="pkSet" data-x="">Clear</button>` : ""}</div>`;
  } else if (PK.kind === "month") {
    const sel = $("#" + PK.id) ? $("#" + PK.id).value : "", now = C.today().slice(0, 7);
    title = String(PK.year);
    body = `<div class="pkmonths">${Array.from({ length: 12 }, (_, i) => { const v = PK.year + "-" + C.pad(i + 1); return `<button type="button" class="pkday ${v === sel ? "on" : ""} ${v === now ? "now" : ""}" data-a="pkSet" data-x="${v}">${C.dparse(v + "-01").toLocaleDateString("en-PH", { month: "short" })}</button>`; }).join("")}</div>
      <div class="btnrow"><button type="button" class="btn sm" data-a="pkSet" data-x="${now}">This month</button>${PK.optional ? `<button type="button" class="btn sm" data-a="pkSet" data-x="">${esc(PK.ph || "Clear")}</button>` : ""}</div>`;
  } else {
    title = PK.title || "Choose an icon";
    body = `<div class="pkicons">${ICON_CHOICES.map(e => `<button type="button" class="pkicon ${e === PK.current ? "on" : ""}" data-a="pkSet" data-x="${e}" aria-label="${e}">${e}</button>`).join("")}</div>
      <div class="field"><label for="pk-own">Or type or paste any emoji</label><div style="display:flex;gap:8px"><input class="inp" id="pk-own" autocomplete="off" maxlength="8" placeholder="🙂"><button type="button" class="btn" data-a="pkOwn">Use</button></div></div>
      ${PK.optional ? `<button type="button" class="btn sm" data-a="pkSet" data-x="">Use the default</button>` : ""}`;
  }
  const nav = PK.kind === "icon" ? "" : `<button type="button" class="iconbtn" data-a="pkNav" data-x="-1" aria-label="Previous">‹</button>`;
  const navR = PK.kind === "icon" ? "" : `<button type="button" class="iconbtn" data-a="pkNav" data-x="1" aria-label="Next">›</button>`;
  host.innerHTML = `<div class="pkscrim" data-a="pkClose"></div><div class="pkcard" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="pkhead">${nav}<b>${esc(title)}</b>${navR}<button type="button" class="iconbtn" data-a="pkClose" aria-label="Close">✕</button></div>${body}</div>`;
}
function pickerChose(v) {
  const p = PK; PK = null; drawPicker();
  if (p.onPick) { p.onPick(v); return; }
  const inp = $("#" + p.id), btn = $("#" + p.id + "-btn");
  if (!inp) return;
  inp.value = v;
  if (btn) { btn.textContent = pickLabel(p.kind, v, p.ph); btn.classList.toggle("unset", !v); }
  inp.dispatchEvent(new Event("input", { bubbles: true }));
  inp.dispatchEvent(new Event("change", { bubbles: true }));
}
/* Keeps an emoji or two, nothing else, so a pasted sentence can't end up as an icon. */
function cleanIcon(v) {
  const s = String(v || "").trim();
  if (!s) return "";
  try { const parts = [...new Intl.Segmenter(undefined, { granularity: "grapheme" }).segment(s)].map(x => x.segment); return parts.slice(0, 2).join(""); } catch (e) { return [...s].slice(0, 2).join(""); }
}
function entryTile(e) {
  const g = C.groupOf(S, e);
  if (g === "earned") return tile("💵", "#137A3B");
  if (g === "borrowed") return tile("🤝", "#6B3FC9");
  if (g === "lent") return tile("📤", "#6B3FC9");
  if (g === "collected") return tile("📥", "#0E7A47");
  if (g === "debtpay") return tile("🧾", "#C22B30");
  if (g === "transfer") return tile("🔁", "#D6336C");
  if (g === "correction" || g === "debtadjust") return tile("✏️", "#55657F");
  if (g === "other") return tile("🐷", "#55657F");
  return catTile(e.category || "Other");
}
const statusText = x => x.status === "paid" ? `<span class="in strong">Paid</span>` : x.status === "skipped" ? "Not this month"
  : x.status === "overdue" ? `<span class="red strong">${-x.diff === 1 ? "1 day late" : -x.diff + " days late"}</span>`
  : x.status === "soon" ? `<span class="amber strong">${x.diff === 0 ? "Due today" : x.diff === 1 ? "Due tomorrow" : "Due in " + x.diff + " days"}</span>` : "Due " + fmtDate(x.due);
function paceLine() {
  if (UI.scope !== "all") return "";
  const p = C.spendPace(S, UI.month);
  if (!p.was) return "";
  const diff = p.now - p.was, when = UI.month === C.today().slice(0, 7) ? "this time last month" : "the month before";
  return `<div class="small muted">${Math.abs(diff) < 1 ? "About the same as " + when : money(Math.abs(diff)) + (diff > 0 ? " more than " : " less than ") + when}</div>`;
}
/* One chart, one question: how is my balance moving this month? Touch it to read any day. */
let chartPoints = [];
function balanceChart(m) {
  const b = C.balanceSeries(S, m), W = 340, H = 112, top = 8, bottom = 20, all = [...b.actual, ...b.planned].map(p => p.v);
  let lo = Math.min(...all), hi = Math.max(...all);
  if (hi - lo < 1) { hi += 1; lo -= 1; }
  const pad = (hi - lo) * 0.08; lo -= pad; hi += pad;
  const x = d => 6 + (W - 12) * ((+d.slice(8) - 1) / Math.max(1, b.days - 1)), y = v => top + (H - top - bottom) * (1 - (v - lo) / (hi - lo));
  const line = list => list.map((p, i) => (i ? "L" : "M") + x(p.date).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ");
  const now = b.actual[b.actual.length - 1], nowX = x(now.date), base = H - bottom;
  chartPoints = [...b.actual.map(p => ({ ...p, kind: "actual" })), ...b.planned.slice(1).map(p => ({ ...p, kind: "plan" }))].map(p => ({ ...p, x: x(p.date), y: y(p.v) }));
  const showNow = nowX > 46 && nowX < W - 46;
  const lbl = (tx, anchor, s) => `<text x="${tx.toFixed(1)}" y="${H - 5}" text-anchor="${anchor}" class="axis">${esc(s)}</text>`;
  return `<div class="chartwrap"><div class="chartread" id="chartRead"><span class="muted" id="chartWhen">Today</span><b id="chartVal">${money(now.v)}</b></div>
    <svg id="balChart" class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Your balance in ${monthName(m, true)}: now ${money(now.v)}${b.planned.length ? ", planned to reach " + money(b.planned[b.planned.length - 1].v) + " by month end" : ""}.">
      ${lo < 0 && hi > 0 ? `<line x1="6" x2="${W - 6}" y1="${y(0).toFixed(1)}" y2="${y(0).toFixed(1)}" class="zero"/>` : ""}
      <path d="${line(b.actual)} L ${nowX.toFixed(1)} ${base} L ${x(b.actual[0].date).toFixed(1)} ${base} Z" class="area"/>
      ${b.planned.length > 1 ? `<path d="${line(b.planned)}" class="planline"/>` : ""}
      ${b.actual.length > 1 ? `<path d="${line(b.actual)}" class="realline"/>` : ""}
      <line id="chartCross" x1="${nowX.toFixed(1)}" x2="${nowX.toFixed(1)}" y1="${top}" y2="${base}" class="cross"/>
      <circle id="chartDot" cx="${nowX.toFixed(1)}" cy="${y(now.v).toFixed(1)}" r="4.5" class="mark"/>
      ${lbl(6, "start", fmtDate(m + "-01"))}${showNow ? lbl(nowX, "middle", "Today") : ""}${lbl(W - 6, "end", fmtDate(m + "-" + C.pad(b.days)))}
    </svg></div>`;
}
function readChart(ev) {
  const svg = ev.target.closest && ev.target.closest("#balChart");
  if (!svg || !chartPoints.length) return;
  const box = svg.getBoundingClientRect(), px = (ev.clientX - box.left) / box.width * 340;
  const p = chartPoints.reduce((best, q) => Math.abs(q.x - px) < Math.abs(best.x - px) ? q : best);
  const dot = $("#chartDot"), cross = $("#chartCross");
  dot.setAttribute("cx", p.x); dot.setAttribute("cy", p.y); cross.setAttribute("x1", p.x); cross.setAttribute("x2", p.x);
  $("#chartWhen").textContent = p.date === C.today() ? "Today" : fmtDate(p.date) + (p.kind === "plan" ? " (planned)" : "");
  $("#chartVal").textContent = money(p.kind === "plan" ? Math.round(p.v) : p.v);
}

/* ---------- home ---------- */
/* ---------- home: this week's pay envelope ---------- */
const mast = () => `<header class="mast"><span class="wordmark">Mira<span>Ledger</span></span><span class="iconrow">${themeBtn()}<button class="iconbtn" data-a="search" aria-label="Search">${ICON.search}</button><button class="iconbtn" data-a="settings" aria-label="Settings">${ICON.gear}</button></span></header>`;
function periodBar() {
  const toggle = `<div class="pswitch" role="tablist" aria-label="View by">${[["week", "Week"], ["month", "Month"]].map(([v, l]) => `<button role="tab" aria-selected="${UI.period === v}" class="${UI.period === v ? "on" : ""}" data-a="period" data-x="${v}">${l}</button>`).join("")}</div>`;
  if (UI.period === "month") return `<div class="periodbar">${toggle}<span class="prange">${esc(monthName(C.today().slice(0, 7)))}</span></div>`;
  const from = UI.weekFrom, to = C.addDays(from, 6), isNow = C.today() >= from && C.today() <= to;
  return `<div class="periodbar">${toggle}<div class="wknav"><button data-a="wk" data-x="-1" aria-label="Previous week">‹</button><button class="prange" data-a="wkNow">${isNow ? "This week" : fmtDate(from) + "–" + fmtDate(to)}<small>${isNow ? fmtDate(from) + "–" + fmtDate(to) : "Back to this week"}</small></button><button data-a="wk" data-x="1" aria-label="Next week">›</button></div></div>`;
}
function homeNotices() {
  const lastBackup = lsGet("mira-last-backup"), staleBackup = S.entries.length > 0 && !S.sample && (!lastBackup || C.daysBetween(lastBackup.slice(0, 10), C.today()) > 14);
  return `${window.MIRA_DEMO ? `<div class="notice info"><span>This is a preview with example data. Please don't enter your real finances here.</span></div>` : S.sample ? `<div class="notice info"><span>This is example data.</span><button class="link" data-a="welcome">Use my own</button></div>` : ""}
    ${!accounts().length ? `<div class="notice info"><span>Start by adding the accounts you use.</span><button class="link" data-a="accounts">Add account</button></div>` : ""}
    ${staleBackup ? `<div class="notice"><span>${lastBackup ? "It's been a while since your last backup." : "You haven't saved a backup yet."}</span><button class="link" data-a="backup">Back up</button></div>` : ""}`;
}
function acctStrip() {
  if (!accounts().length) return "";
  const bal = C.balances(S);
  return `<section class="sect"><div class="secthead"><h2>Accounts</h2><button class="link" data-a="accounts">${money(C.totalPHP(S, C.today()))} total</button></div><div class="acctstrip" role="list" aria-label="Your accounts">${accounts().map(a => `<button class="acctcard" role="listitem" data-a="accountSheet" data-x="${a.id}"><span class="small muted">${esc(acctIcon(a))} ${esc(a.name)}</span><b>${money(bal[a.id], a.currency)}</b></button>`).join("")}</div></section>`;
}
const latest = () => { const recent = S.entries.slice().sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || ""))).slice(0, 4); return `<section class="sect"><div class="secthead"><h2>Latest</h2><button class="link" data-a="tab" data-x="activity">See all</button></div><div class="panel">${recent.length ? recent.map(e => entryRow(e)).join("") : `<div class="empty">Nothing logged yet. Tap + to add your first entry.</div>`}</div></section>`; };
function viewHome() { return UI.period === "month" ? monthHome() : weekHome(); }
/* The sum behind the big number, in one line: only the parts that aren't zero. */
function weekSum(w) {
  const r = n => money(Math.round(n));
  const parts = [`${r(w.income)} pay`];
  if (w.billsPlan + w.onesPlan) parts.push(`− ${r(w.billsPlan + w.onesPlan)} bills`);
  if (w.budgetPlan) parts.push(`− ${r(w.budgetPlan)} budgets`);
  if (w.other) parts.push(`− ${r(w.other)} other spending`);
  if (w.debtpay) parts.push(`− ${r(w.debtpay)} debt payments`);
  if (w.lent) parts.push(`− ${r(w.lent)} lent`);
  if (w.collected) parts.push(`+ ${r(w.collected)} paid back`);
  return parts.join(" ");
}
/* Plain words for what part of a budget counts this week, and why. */
function budgetWhy(x, w) {
  const b = x.budget, f = C.freqOf(b), now = C.today();
  if (f !== "anytime") {
    /* Dated budgets: explain by shopping day, never per day. */
    const how = `${money(b.amount)} each time · ${C.scheduleText(b)}`, runs = x.runs || [], bits = [];
    if (!runs.length) bits.push("No shopping day this week");
    runs.forEach(r => bits.push(r >= now ? `${fmtDate(r, true)}: ${money(b.amount)} planned` : `${fmtDate(r, true)} has passed, so only what you spent counts`));
    if (x.spent) bits.push(`${money(Math.round(x.spent))} spent this week`);
    const early = runs.length && x.spent && runs[0] >= w.from ? "" : "";
    return { how, now: bits.join(" · "), note: !runs.length && x.spent ? "Spending between shopping days still counts as spent." : early };
  }
  const how = `${money(b.amount)} a month, about ${money(Math.round(b.amount / C.daysIn(w.from.slice(0, 7))))} a day`;
  const start = now > w.from ? now : w.from, days = now > w.to ? 0 : C.daysBetween(start, w.to) + 1;
  const when = days === 0 ? "" : days === 1 ? (start === now ? "today" : "the last day") : `the next ${days} days`;
  const bits = [];
  if (x.spent) bits.push(`${money(Math.round(x.spent))} spent`);
  if (x.aheadLeft >= 1) bits.push(`${money(Math.round(x.aheadLeft))} still planned for ${when}`);
  if (!bits.length) bits.push(days === 0 ? "Nothing spent, and its days have passed" : "Nothing planned for the days left");
  const passed = x.limit - x.ahead;
  const note = passed >= 1 && w.isNow ? `Days that have passed only count what you spent, so ${money(Math.round(Math.max(0, passed - x.spent)))} unused from before today isn't counted.` : "";
  return { how, now: bits.join(" + "), note };
}
function weekHome() {
  const w = C.weekPlan(S, UI.weekFrom), now = C.today(), future = w.from > now, past = w.to < now;
  const maxOut = Math.max(1, ...w.days.map(d => d.out));
  const days = w.days.map(d => {
    const h = d.out ? Math.max(8, Math.round(d.out / maxOut * 100)) : 0, wd = C.dparse(d.date).toLocaleDateString("en-PH", { weekday: "short" }).slice(0, 2);
    const label = `${fmtDate(d.date, true)}: ${d.out ? money(d.out) + " spent" : "nothing spent"}${d.payday ? ", payday" : ""}${d.due ? ", " + d.due + " due" : ""}${d.runs && d.runs.length ? ", budget day for " + d.runs.map(b => b.name || b.category).join(" and ") : ""}`;
    return `<button class="day ${d.date === now ? "today" : ""} ${d.date > now ? "ahead" : ""}" data-a="openDay" data-x="${d.date}" aria-label="${esc(label)}"><span class="dbar"><i style="height:${h}%"></i></span><span class="dmarks">${d.payday ? '<b class="coin" title="Payday">₱</b>' : ""}${d.due ? '<b class="due" title="Bill due"></b>' : ""}${d.runs && d.runs.length ? `<b class="runmark" title="Budget day">${esc(catIcon(d.runs[0].category))}</b>` : ""}</span><span class="dwd">${wd}</span><span class="dnum">${+d.date.slice(8)}</span></button>`;
  }).join("");
  const line = (label, sub, val, act, x, sign) => `<button class="leader" data-a="${act}" data-x="${x || ""}"><span class="ll"><span>${label}</span>${sub ? `<small>${sub}</small>` : ""}</span><span class="dots" aria-hidden="true"></span><span class="lv">${sign || ""}${money(Math.round(val))}</span></button>`;
  const bud = w.budgets.reduce((t, x) => t + x.limit, 0);
  const needs = [];
  if (w.isNow) {
    C.billSlots(S, now.slice(0, 7)).filter(x => x.status === "overdue" && x.due < w.from).forEach(x => needs.push({ date: x.due, html: billRow(x) }));
  }
  w.bills.filter(x => x.status !== "paid").forEach(x => needs.push({ date: x.due, html: billRow(x) }));
  w.ones.filter(o => !o.entry).forEach(o => needs.push({ date: o.item.date, html: oneRow(o) }));
  w.pays.filter(p => !p.entry).forEach(p => needs.push({ date: p.date, html: payRow(p) }));
  needs.sort((a, b) => a.date.localeCompare(b.date));
  const budRows = w.budgets.filter(x => x.limit > 0 || x.spent > 0).map(x => {
    const dated = C.freqOf(x.budget) !== "anytime", runs = x.runs || [];
    const over = dated ? runs.length > 0 && x.left < 0 : x.spent > x.limit, daysLeft = w.isNow ? C.daysBetween(now, w.to) + 1 : 0, perDay = !dated && w.isNow && x.aheadLeft > 0 ? Math.floor(x.aheadLeft / daysLeft) : 0;
    const todayPct = w.isNow ? (C.daysBetween(w.from, now) + 0.5) / 7 * 100 : null;
    const sub = dated
      ? (runs.length ? `${runs.map(r => fmtDate(r, true)).join(" & ")} · ${money(Math.round(x.spent))} spent of ${money(Math.round(x.limit))}` : `No shopping day this week${x.spent ? ` · ${money(Math.round(x.spent))} spent` : ""}`)
      : `${money(Math.round(x.spent))} of ${money(Math.round(x.limit))}${perDay ? ` · ${money(perDay)} a day left` : ""}`;
    const right = over ? money(Math.round(-x.left)) + " over" : dated && !runs.length ? (x.spent ? money(Math.round(x.spent)) + " spent" : "—") : money(Math.round(x.left)) + " left";
    return `<div class="pad budrow"><div style="display:flex;gap:11px;align-items:center">${catTile(x.budget.category)}<button class="grow" data-a="editBudget" data-x="${x.budget.id}"><span class="rowt">${esc(x.budget.name || x.budget.category)}</span><br><span class="rows">${sub}</span></button><span class="amt ${over ? "red" : ""}">${right}</span></div>
      <div class="track pace" style="margin-top:9px"><div class="fill ${over ? "over" : ""}" style="width:${x.limit ? Math.min(100, x.spent / x.limit * 100) : 100}%;${over ? "" : `background:${C.catColor(S, x.budget.category)}`}"></div>${todayPct !== null ? `<i class="today" style="left:${todayPct.toFixed(1)}%"></i>` : ""}</div></div>`;
  }).join("");
  return `<div class="wrap home">${mast()}${periodBar()}
    <section class="envelope" aria-label="This week's pay envelope">
      <button class="env-tap" data-a="weekHow" aria-label="How this number is worked out">
        <span class="env-label">${future ? "Planned to be left" : past ? "Left that week" : "Left this week"}</span>
        <span class="env-amt ${w.left < 0 ? "neg" : ""}">${money(Math.round(w.left))}</span>
        <span class="env-sum">${weekSum(w)}</span>
        <span class="env-why">How is this worked out? ›</span>
      </button>
      <div class="days" role="list">${days}</div>
    </section>
    <section class="slip" aria-label="How this week adds up">
      ${line("Pay", w.expected ? `${money(Math.round(w.received))} in, ${money(Math.round(w.expected))} still coming` : w.received ? "All received" : "No pay this week", w.income, "weekList", "in", "+ ")}
      ${line("Bills", w.bills.length + w.ones.length ? `${money(Math.round(w.billsPaid + w.onesPaid))} paid of ${money(Math.round(w.billsPlan + w.onesPlan))}` : "Nothing due", w.billsPlan + w.onesPlan, "planTab", "bills", "− ")}
      ${(() => {
        if (!bud) return line("Budgets", "None set", 0, "planTab", "budgets", "− ");
        const over = w.budgets.reduce((t, x) => t + Math.max(0, x.spent - x.limit), 0), ahead = w.budgets.reduce((t, x) => t + x.aheadLeft, 0);
        const sub = past ? `${money(Math.round(w.budgetSpent))} spent` : future ? `${money(Math.round(bud))} planned` : `${money(Math.round(w.budgetSpent))} spent · ${money(Math.round(ahead))} left for the days ahead`;
        return line("Budgets", sub + (over >= 1 ? ` · <span class="red">${money(Math.round(over))} over</span>` : ""), w.budgetPlan, "planTab", "budgets", "− ");
      })()}
      ${line("Other spending", "Outside bills and budgets", w.other, "weekList", "other", "− ")}
      ${w.debtpay ? line("Debt payments", "Not counted as spending", w.debtpay, "weekList", "debt", "− ") : ""}
      ${w.lent ? line("Lent out", "Not counted as spending", w.lent, "weekList", "lent", "− ") : ""}
      ${w.collected ? line("Paid back to you", "Not counted as pay", w.collected, "weekList", "lent", "+ ") : ""}
      <div class="leader total"><span class="ll"><span>Left</span></span><span class="dots" aria-hidden="true"></span><span class="lv ${w.left < 0 ? "red" : ""}">${money(Math.round(w.left))}</span></div>
      ${w.borrowed ? `<p class="slipnote">${money(w.borrowed)} borrowed this week isn't counted as pay.</p>` : ""}
    </section>
    ${homeNotices()}
    ${needs.length ? `<section class="sect"><div class="secthead"><h2>${w.isNow ? "Due this week" : "Due that week"} <span class="count">${needs.length}</span></h2></div><div class="panel">${needs.map(n => n.html).join("")}</div></section>` : ""}
    ${budRows ? `<section class="sect"><div class="secthead"><h2>Budgets this week</h2><button class="link" data-a="planTab" data-x="budgets">Manage</button></div><div class="panel">${budRows}</div></section>` : ""}
    ${acctStrip()}
    ${latest()}
  </div>`;
}
function monthHome() {
  const m = C.today().slice(0, 7), have = C.totalPHP(S, C.today()), owed = C.totalOwed(S), f = C.forecast(S, m);
  const needs = [];
  f.bills.filter(x => x.status === "overdue" || x.status === "soon").forEach(x => needs.push({ date: x.due, html: billRow(x, true) }));
  f.ones.filter(o => C.daysBetween(C.today(), o.item.date) <= 7).forEach(o => needs.push({ date: o.item.date, html: oneRow(o) }));
  C.paydays(S, m).filter(p => p.status === "late" || (p.status === "upcoming" && C.daysBetween(C.today(), p.date) <= 2)).forEach(p => needs.push({ date: p.date, html: payRow(p) }));
  needs.sort((a, b) => a.date.localeCompare(b.date));
  const recent = S.entries.slice().sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || ""))).slice(0, 4);
  const lastBackup = lsGet("mira-last-backup"), staleBackup = S.entries.length > 0 && !S.sample && (!lastBackup || C.daysBetween(lastBackup.slice(0, 10), C.today()) > 14);
  return `<div class="wrap home">${mast()}${periodBar()}
    <section class="envelope month"><button class="env-tap" data-a="accounts"><span class="env-label">In your ${accounts().length} ${accounts().length === 1 ? "account" : "accounts"} ›</span><span class="env-amt">${money(have)}</span></button></section>
    <section class="panel">${balanceChart(m)}<button class="linkrow" data-a="forecast"><span><span class="muted">By ${fmtDate(m + "-" + C.pad(C.daysIn(m)))}, if things go as planned</span><br><b class="${f.end < 0 ? "red" : ""}">${money(f.end)}</b></span><span class="chev">›</span></button><button class="linkrow" data-a="tab" data-x="debts"><span class="muted">You owe</span><b style="margin-left:auto">${money(owed)}</b><span class="chev">›</span></button></section>
    ${homeNotices()}
    ${needs.length ? `<section class="sect"><div class="secthead"><h2>Needs you <span class="count">${needs.length}</span></h2>${needs.length > 3 ? `<button class="link" data-a="tab" data-x="plan">See all</button>` : ""}</div><div class="panel">${needs.slice(0, 3).map(n => n.html).join("")}</div></section>` : ""}
    <section class="sect"><div class="secthead"><h2>${monthName(m, true)} so far</h2></div><div class="panel">${statementRows(m)}</div></section>
    ${acctStrip()}
    ${latest()}
  </div>`;
}
function billRow(x, compact) {
  const b = x.bill, part = x.total > 1 ? ` · payment ${x.slot} of ${x.total}` : "";
  const amount = x.status === "paid" ? money(x.entry.amount, x.entry.currency) : b.variable && !x.usual ? "Set amount" : (b.variable ? "about " : "") + money(x.usual, x.currency);
  const action = x.status === "paid" ? "" : x.status === "skipped" ? `<button class="btn sm" data-a="unskip" data-x="${b.id}|${x.due.slice(0, 7)}|${x.slot}">Undo</button>` : `<button class="btn sm" data-a="payBill" data-x="${b.id}|${x.due.slice(0, 7)}|${x.slot}">Pay</button>`;
  return `<div class="row">${catTile(b.category || "Other")}<button class="grow" data-a="${x.status === "paid" ? "editEntry" : "billSheet"}" data-x="${x.status === "paid" ? x.entry.id : b.id + "|" + x.due.slice(0, 7) + "|" + x.slot}"><span class="rowt">${esc(b.name)}</span><br><span class="rows">${amount}${part} · ${statusText(x)}</span></button>${action}</div>`;
}
function oneRow(o) {
  const i = o.item;
  return `<div class="row">${catTile(i.category || "Other")}<button class="grow" data-a="${o.entry ? "editEntry" : "editOne"}" data-x="${o.entry ? o.entry.id : i.id}"><span class="rowt">${esc(i.name)}</span><br><span class="rows">${money(o.php)} · one time · ${fmtDate(i.date)}</span></button>${o.entry ? '<span class="pill paid">Paid</span>' : `<button class="btn sm" data-a="payOne" data-x="${i.id}">Pay</button>`}</div>`;
}
function payRow(p) {
  return `<div class="row">${tile("💵", "#137A3B")}<button class="grow" data-a="${p.entry ? "editEntry" : "editClient"}" data-x="${p.entry ? p.entry.id : p.stream.id}"><span class="rowt">${esc(p.stream.name)} pays you</span><br><span class="rows">${money(p.expected, p.currency)} · ${p.status === "late" ? `<span class="red strong">${fmtDate(p.date)}, not logged</span>` : fmtDate(p.date)}</span></button>${p.entry ? '<span class="pill received">Received</span>' : `<button class="btn sm" data-a="logPay" data-x="${p.stream.id}|${p.date}">Log</button>`}</div>`;
}

/* ---------- activity ---------- */
function viewActivity() {
  const top = pageTop("Activity", monthBar());
  const tabs = seg("actMode", [["list", "Entries"], ["spending", "Spending"], ["income", "Income"]], UI.actMode);
  let body = "";
  if (UI.actMode === "list") {
    const filters = [["all", "All"], ["spent", "Spent"], ["earned", "Earned"], ["borrowed", "Borrowed"], ["debtpay", "Debt payments"], ["lent", "Lent out"], ["collected", "Paid back to you"], ["transfer", "Moved"]];
    const all = C.inMonth(S, UI.month).filter(e => UI.actFilter === "all" || C.groupOf(S, e) === UI.actFilter).sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || "")));
    const days = {}; all.forEach(e => { (days[e.date] = days[e.date] || []).push(e); });
    body = `<button class="btn block" data-a="monthSummary" data-x="${UI.month}">${monthName(UI.month, true)} summary</button>
      <div class="chips filter">${filters.map(([v, l]) => `<button class="chip ${UI.actFilter === v ? "on" : ""}" data-a="actFilter" data-x="${v}">${l}</button>`).join("")}</div>
      ${all.length ? Object.keys(days).map(d => `<section class="sect"><div class="secthead"><span class="small strong muted">${esc(fmtDate(d, true))}</span></div><div class="panel">${days[d].map(e => entryRow(e)).join("")}</div></section>`).join("") : `<div class="panel"><div class="empty">Nothing here for ${monthName(UI.month, true)}.</div></div>`}`;
  } else if (UI.actMode === "spending") {
    const cats = C.categorySpend(S, UI.month, UI.scope), total = cats.reduce((t, c) => t + c.total, 0);
    const pays = C.statement(S, UI.month).debtpay;
    body = seg("scope", [["all", "Combined"], ["personal", "Personal"], ["business", "Business"]], UI.scope) +
      `<div class="panel pad"><div class="small muted">Spent in ${monthName(UI.month, true)}</div><div class="bigline">${money(total)}</div>${paceLine()}${total ? `<div class="stack" style="margin-top:10px">${cats.map(c => `<i style="background:${C.catColor(S, c.category)};flex:${c.total}"></i>`).join("")}</div>` : ""}</div>
      ${cats.length ? `<div class="panel">${cats.map(c => `<button class="row" data-a="openCat" data-x="${esc(c.category)}">${catTile(c.category)}<span class="grow rowt">${esc(c.category)}<br><span class="rows">${Math.round(c.total / total * 100)}% · ${c.entries.length} ${c.entries.length === 1 ? "entry" : "entries"}</span></span><span class="amt">${money(c.total)}</span><span class="chev">›</span></button>`).join("")}</div>` : `<div class="panel"><div class="empty">No spending logged for this month.</div></div>`}
      ${pays && UI.scope !== "business" ? `<button class="panel row" data-a="openGroup" data-x="${UI.month}|debtpay"><span class="grow rowt">Debt payments<br><span class="rows">Counted apart from spending</span></span><span class="amt">${money(pays)}</span><span class="chev">›</span></button>` : ""}`;
  } else {
    const list = C.incomeByClient(S, UI.month), total = list.reduce((t, x) => t + x.total, 0), st = C.statement(S, UI.month);
    const pays = C.paydays(S, UI.month);
    body = `<div class="panel pad"><div class="small muted">Earned in ${monthName(UI.month, true)}</div><div class="bigline in">${money(total)}</div><div class="small muted">Expected from paydays: ${money(pays.reduce((t, p) => t + p.php, 0))}</div></div>
      ${list.length ? `<div class="panel">${list.map(x => `<button class="row" data-a="openClient" data-x="${x.id}"><span class="grow rowt">${esc(x.name)}<br><span class="rows">${x.entries.length} ${x.entries.length === 1 ? "payment" : "payments"}</span></span><span class="amt in">${money(x.total)}</span><span class="chev">›</span></button>`).join("")}</div>` : ""}
      ${st.borrowed ? `<button class="panel row" data-a="openGroup" data-x="${UI.month}|borrowed"><span class="grow rowt">Borrowed<br><span class="rows">Not income. Added to what you owe.</span></span><span class="amt loan">${money(st.borrowed)}</span><span class="chev">›</span></button>` : ""}
      ${pays.length ? `<section class="sect"><div class="secthead"><h2>Paydays</h2></div><div class="panel">${pays.map(payRow).join("")}</div></section>` : ""}`;
  }
  return top + `<div class="wrap" style="padding-top:0;gap:14px">${tabs}${body}</div>`;
}

/* ---------- plan ---------- */
function viewPlan() {
  const top = pageTop("Plan", monthBar());
  const tabs = seg("planMode", [["bills", "Bills"], ["weeks", "Weeks"], ["budgets", "Budgets"]], UI.planMode);
  const body = UI.planMode === "bills" ? planBills() : UI.planMode === "weeks" ? planWeeks() : planBudgets();
  return top + `<div class="wrap" style="padding-top:0;gap:14px">${tabs}${body}</div>`;
}
function planBills() {
  const m = UI.month, slots = C.billSlots(S, m), ones = C.oneTimes(S, m);
  const live = slots.filter(x => x.status !== "skipped");
  const total = live.reduce((t, x) => t + x.php, 0) + ones.reduce((t, o) => t + o.php, 0);
  const paid = live.filter(x => x.status === "paid").reduce((t, x) => t + x.php, 0) + ones.filter(o => o.entry).reduce((t, o) => t + o.php, 0);
  const groups = [
    ["due", "Due soon or late", slots.filter(x => x.status === "overdue" || x.status === "soon"), true],
    ["later", "Later this month", slots.filter(x => x.status === "later"), true],
    ["paid", "Paid", slots.filter(x => x.status === "paid"), false],
    ["skipped", "Not this month", slots.filter(x => x.status === "skipped"), false]
  ].filter(g => g[2].length);
  return `<div class="panel pad"><div class="small muted">Bills in ${monthName(m, true)}</div><div class="bigline">${money(total)}</div><div class="track" style="margin:10px 0 7px"><div class="fill" style="width:${total ? Math.min(100, paid / total * 100) : 0}%"></div></div><div class="small muted"><b class="strong" style="color:var(--ink)">${money(paid)}</b> paid · <b class="strong" style="color:var(--ink)">${money(total - paid)}</b> still to pay</div></div>
  ${groups.map(([id, label, list, open]) => `<details class="panel" ${open ? "open" : ""}><summary class="row"><span class="grow strong">${label} <span class="muted small">(${list.length})</span></span><span class="small muted">${money(list.reduce((t, x) => t + x.php, 0))}</span><span class="sumchev">›</span></summary>${list.map(x => billRow(x)).join("")}</details>`).join("")}
  <section class="sect"><div class="secthead"><h2>One-time costs</h2><button class="link" data-a="editOne" data-x="new">+ Add</button></div><div class="panel">${ones.length ? ones.map(oneRow).join("") : `<div class="empty small">Expecting a deposit or a repair this month? Add it here and it counts in your estimate.</div>`}</div></section>
  <button class="btn block" data-a="editBill" data-x="new">+ Add a recurring bill</button>
  ${(S.bills || []).length ? `<button class="btn block" data-a="billsList">Edit my bills</button>` : ""}`;
}
/* Plan → Weeks: every payday week that touches this month, using the same sums as Home. */
function planWeeks() {
  const m = UI.month, first = C.weekOf(S, m + "-01").from, last = m + "-" + C.pad(C.daysIn(m)), whole = n => money(Math.round(n)), list = [];
  for (let f = first; f <= last; f = C.addDays(f, 7)) list.push(C.weekPlan(S, f));
  return list.map(w => {
    const outPlan = w.billsPlan + w.onesPlan + w.budgetPlan + w.other + w.debtpay, outNow = w.billsPaid + w.onesPaid + w.budgetSpent + w.other + w.debtpay;
    return `<details class="panel" ${w.isNow ? "open" : ""}><summary class="row"><span class="grow"><span class="strong">${fmtDate(w.from)}–${fmtDate(w.to)}</span>${w.isNow ? ' <span class="pill">This week</span>' : ""}<br><span class="rows">Pay ${whole(w.income)} · Out ${whole(outPlan)}</span></span><span class="amt ${w.left < 0 ? "red" : "in"}">${w.left > 0 ? "+" : ""}${whole(w.left)}</span><span class="sumchev">›</span></summary>
    <table class="compare"><thead><tr><th>That week</th><th>Planned</th><th>So far</th></tr></thead><tbody>
      <tr><td>Pay</td><td>${whole(w.income)}</td><td>${whole(w.received)}</td></tr>
      <tr><td>Going out</td><td>${whole(outPlan)}</td><td>${whole(outNow)}</td></tr>
      <tr class="t"><td>Left</td><td>${whole(w.left)}</td><td>${whole(w.leftNow)}</td></tr></tbody></table>
    <div class="pad"><button class="link" data-a="showWeek" data-x="${w.from}">Open this week ›</button></div></details>`;
  }).join("");
}
function planWeeksOld() {
  const m = UI.month, list = C.weeks(S, m), cur = C.today().slice(0, 7);
  let warn = "";
  if (m === cur) {
    /* Walk the rest of the month in date order, and only speak up if money would actually run out. */
    const todayStr = C.today(), steps = [];
    for (const w of list) {
      if (w.to < todayStr) continue;
      w.inItems.filter(i => !i.done).forEach(i => steps.push({ date: i.date < todayStr ? todayStr : i.date, v: i.php }));
      w.outItems.filter(i => !i.done).forEach(i => steps.push({ date: i.date < todayStr ? todayStr : i.date, v: -i.php }));
    }
    steps.sort((a, b) => a.date.localeCompare(b.date) || a.v - b.v);
    let run = C.totalPHP(S, todayStr), low = null;
    for (const s of steps) { run += s.v; if (low === null || run < low.v) low = { v: run, date: s.date }; }
    if (low && low.v < 0) warn = `<div class="notice"><span>Money could run out around <b>${fmtDate(low.date)}</b>. You'd be short by about ${money(Math.ceil(-low.v))}.</span></div>`;
  }
  const whole = n => money(Math.round(n));
  const item = i => `<div class="row" style="min-height:44px;padding-block:7px"><i class="dot" style="background:${i.category ? C.catColor(S, i.category) : "var(--in)"}"></i><span class="grow small"><span class="strong">${esc(i.label)}</span> <span class="muted">${fmtDate(i.date)}</span></span>${i.done ? '<span class="pill paid">Done</span>' : i.late ? '<span class="pill late">Late</span>' : ""}<span class="amt small">${whole(i.php)}</span></div>`;
  return warn + list.map(w => `<details class="panel" ${w.isNow ? "open" : ""}><summary class="row"><span class="grow"><span class="strong">${fmtDate(w.from)}${w.from === w.to ? "" : "–" + fmtDate(w.to)}</span>${w.isNow ? ' <span class="pill">This week</span>' : ""}<br><span class="rows">In ${whole(w.expectedIn)} · Out ${whole(w.expectedOut)}</span></span><span class="amt ${w.expectedIn - w.expectedOut < 0 ? "red" : "in"}">${w.expectedIn - w.expectedOut > 0 ? "+" : ""}${whole(w.expectedIn - w.expectedOut)}</span><span class="sumchev">›</span></summary>
    <table class="compare"><thead><tr><th>This week</th><th>Expected</th><th>Actual so far</th></tr></thead><tbody>
      <tr><td>Income</td><td>${whole(w.expectedIn)}</td><td>${money(w.actualIn)}</td></tr>
      <tr><td>Expenses</td><td>${whole(w.expectedOut)}</td><td>${money(w.actualOut)}</td></tr>
      <tr class="t"><td>Left</td><td>${whole(w.expectedIn - w.expectedOut)}</td><td>${money(w.actualIn - w.actualOut)}</td></tr></tbody></table>
    ${w.inItems.length ? `<div class="pad small strong muted" style="padding-bottom:0">Coming in</div>${w.inItems.map(item).join("")}` : ""}
    ${w.outItems.length ? `<div class="pad small strong muted" style="padding-bottom:0">Going out</div>${w.outItems.map(item).join("")}` : ""}
    ${w.entries.length ? `<div class="pad"><button class="link" data-a="openWeek" data-x="${w.from}|${w.to}">See what actually happened (${w.entries.length}) ›</button></div>` : ""}
  </details>`).join("");
}
function planBudgets() {
  const m = UI.month, list = S.budgets || [];
  const rows = list.map(b => {
    const p = C.budgetPace(S, b, m), total = p.total, spent = p.spent, over = spent > total && total > 0;
    /* A daily amount only makes sense for "any time" budgets; dated ones show their next shopping day. */
    const nextRun = C.freqOf(b) !== "anytime" ? C.budgetRuns(b, C.today(), C.addDays(C.today(), 90))[0] : null;
    const pace = C.freqOf(b) === "anytime" ? (p.perDay > 0 ? ` · <span class="strong" style="color:var(--ink)">${money(Math.floor(p.perDay))} a day</span> for ${p.daysLeft} more ${p.daysLeft === 1 ? "day" : "days"}` : "")
      : nextRun ? ` · next shopping day <span class="strong" style="color:var(--ink)">${fmtDate(nextRun, true)}</span>` : "";
    return `<div class="pad" style="border-top:1px solid var(--line)"><div style="display:flex;gap:11px;align-items:center">${catTile(b.category)}<button class="grow" data-a="editBudget" data-x="${b.id}"><span class="rowt">${esc(b.name || b.category)}</span><br><span class="rows">${esc(C.scheduleText(b))}${b.note ? " · " + esc(b.note) : ""}</span></button><button class="btn sm" data-a="logBudget" data-x="${b.id}">+ Log</button></div>
      <div class="track pace" style="margin:9px 0 5px"><div class="fill ${over ? "over" : ""}" style="width:${total ? Math.min(100, spent / total * 100) : 0}%;${over ? "" : `background:${C.catColor(S, b.category)}`}"></div>${p.todayPct !== null ? `<i class="today" style="left:${p.todayPct.toFixed(1)}%" title="Today"></i>` : ""}</div>
      <div class="small muted"><b class="strong" style="color:var(--ink)">${money(spent)}</b> of ${money(total)} · ${over ? `<span class="red strong">${money(spent - total)} over</span>` : money(total - spent) + " left" + pace}</div></div>`;
  }).join("");
  return `<div class="panel" style="border-top:0">${rows || `<div class="empty small">Set a monthly amount for everyday costs like groceries or gas, or list items you're saving up to buy, like a sofa.</div>`}</div><button class="btn block" data-a="editBudget" data-x="new">+ Add a budget</button>`;
}

/* ---------- debts ---------- */
function viewDebts() {
  const all = (S.debts || []).filter(C.isMoneyDebt).map(d => ({ d, plan: C.debtPlan(S, d), theirs: C.isOwedToYou(d) }));
  const things = (S.debts || []).filter(C.isThing), openThings = things.filter(d => !d.settled);
  const thingRow = d => `<button class="row" data-a="debtSheet" data-x="${d.id}">${tile("📦", C.isOwedToYou(d) ? "#0E7A47" : "#7A3FC4")}<span class="grow"><span class="rowt">${esc(d.item || "Item")}</span><br><span class="rows">${C.isOwedToYou(d) ? "With " : "From "}${esc(d.name)}${d.note ? " · " + esc(d.note) : ""}</span></span>${d.settled ? '<span class="pill paid">Returned</span>' : `<span class="pill">${C.isOwedToYou(d) ? "Lent" : "To return"}</span>`}<span class="chev">›</span></button>`;
  const mine = all.filter(x => !x.theirs && x.plan.bal > 0).sort((a, b) => b.plan.bal - a.plan.bal);
  const theirs = all.filter(x => x.theirs && x.plan.bal > 0).sort((a, b) => b.plan.bal - a.plan.bal);
  const done = all.filter(x => x.plan.bal <= 0);
  const monthly = mine.reduce((t, x) => t + (x.plan.monthly || 0), 0);
  const row = ({ d, plan, theirs: owedToYou }) => {
    const led = C.debtLedger(S, d), up = led.opening + led.rows.filter(r => r.change > 0).reduce((t, r) => t + r.change, 0), back = up - plan.bal, pct = up > 0 ? Math.min(100, Math.max(0, back / up * 100)) : 0;
    const sub = owedToYou ? (plan.bal > 0 ? (back > 0 ? `${money(back)} paid back so far` : "Nothing paid back yet") : plan.bal < 0 ? `They paid back ${money(-plan.bal)} more than they owed` : "Paid back in full")
      : plan.bill && plan.monthly ? `${money(plan.per, C.billCur(S, plan.bill))} · ${C.scheduleText(plan.bill).toLowerCase()}${plan.months ? ` · done by ${esc(C.dparse(plan.finish + "-01").toLocaleDateString("en-PH", { month: "short", year: "numeric" }))}` : ""}` : plan.bal > 0 ? `No payment plan yet${back > 0 ? ` · ${money(back)} paid so far` : ""}` : plan.bal < 0 ? `You overpaid by ${money(-plan.bal)}` : "Paid off";
    return `<button class="row" data-a="debtSheet" data-x="${d.id}" style="flex-wrap:wrap">${tile(d.kind === "credit" ? "🛍️" : d.name.trim()[0].toUpperCase(), owedToYou ? "#0E7A47" : "#6B3FC9")}<span class="grow"><span class="rowt">${esc(d.name)}</span><br><span class="rows">${d.kind === "credit" && d.item ? "For " + esc(d.item) + " · " : ""}${sub}</span></span><span class="amt ${owedToYou ? "in" : ""}">${money(Math.max(plan.bal, 0))}</span><span class="chev">›</span>${plan.bal > 0 ? `<span class="track" style="flex:0 0 100%;display:block"><span class="fill" style="display:block;width:${pct}%;${owedToYou ? "background:var(--in)" : ""}"></span></span>` : ""}</button>`;
  };
  return pageTop("Debts") + `<div class="wrap" style="padding-top:0">
    <div class="two"><div class="panel pad"><div class="small muted">You owe</div><div class="bigline" style="font-size:26px">${money(C.totalOwed(S))}</div><div class="small muted">${mine.length} ${mine.length === 1 ? "debt" : "debts"}${monthly ? ` · ${money(monthly)}/mo` : ""}</div></div>
      <div class="panel pad"><div class="small muted">Owed to you</div><div class="bigline in" style="font-size:26px">${money(C.totalOwedToYou(S))}</div><div class="small muted">${theirs.length} ${theirs.length === 1 ? "person" : "people"}</div></div></div>
    <div class="btnrow"><button class="btn" data-a="editDebt" data-x="new">+ I borrowed</button><button class="btn" data-a="newLoan">+ I lent money</button></div>
    <section class="sect"><div class="secthead"><h2>You owe</h2></div>${mine.length ? `<div class="panel">${mine.map(row).join("")}</div>` : `<div class="panel"><div class="empty small">Nothing owed. Add a loan or money borrowed from family.</div></div>`}</section>
    <section class="sect"><div class="secthead"><h2>Owed to you</h2></div>${theirs.length ? `<div class="panel">${theirs.map(row).join("")}</div>` : `<div class="panel"><div class="empty small">Lent money to family or friends? Add it here so you remember who still owes you.</div></div>`}</section>
    ${openThings.length ? `<section class="sect"><div class="secthead"><h2>Items, not money</h2></div><div class="panel">${openThings.map(thingRow).join("")}</div></section>` : ""}
    ${done.length || things.length > openThings.length ? `<details class="panel"><summary class="row"><span class="grow strong">Settled <span class="muted small">(${done.length + things.length - openThings.length})</span></span><span class="sumchev">›</span></summary>${done.map(row).join("")}${things.filter(d => d.settled).map(thingRow).join("")}</details>` : ""}
    <p class="small muted">Lending money takes it out of your account but isn't spending. When they pay you back, it isn't income.</p>
  </div>`;
}
/* ---------- welcome ---------- */
function oldDataCount() { try { const o = JSON.parse(lsGet(OLD_KEY) || "null"); return o && o.settings ? Object.keys(o.entries || {}).length : null; } catch (e) { return null; } }
function viewWelcome() {
  const n = oldDataCount();
  return `<div class="wiz"><div class="wizhead"><span class="brand" style="color:var(--blue)">Mira Ledger</span></div>
    <h1>Know where your money is, with numbers you can check.</h1>
    <p class="muted">Everything stays on this device. Nothing is uploaded.</p>
    <div class="opts">
      ${n !== null ? `<button class="opt feature" data-a="importOld"><span><b>Bring in my old Mira Ledger</b><small>Found ${n} entries on this device. Your old data isn't changed.</small></span></button>` : ""}
      <button class="opt ${n === null ? "feature" : ""}" data-a="restore"><span><b>Restore a backup file</b><small>Works with backups from the old or new Mira Ledger</small></span></button>
      <button class="opt" data-a="restorePaste"><span><b>Paste a backup instead</b><small>If your phone won't let you pick the file</small></span></button>
      <button class="opt" data-a="startEmpty"><span><b>Start fresh</b><small>Add your own accounts and bills</small></span></button>
      <button class="opt" data-a="useSample"><span><b>Look around with example data</b><small>You can clear it any time</small></span></button>
    </div></div>`;
}

/* ---------- add: one question per screen ---------- */
const newDraft = o => ({ kind: null, amount: "", date: C.today(), accountId: "", note: "", scope: "personal", ...o });
const STEP_TEXT = { lend: "Which account did the money come from?", collect: "Which account did it land in?", expense: "Which account did you pay from?", income: "Which account did it land in?", borrow: "Which account did the money land in?", debt: "Which account did you pay from?", transfer: "Moving money out of which account?" };
function stepsFor(d) {
  switch (d.kind) {
    case "expense": return ["what", "category", ...((S.budgets || []).filter(b => b.category === d.category).length > 1 ? ["item"] : []), "account", "amount", "review"];
    case "income": return ["what", "who", ...(d.fixedAccount ? [] : ["account"]), "amount", "review"];
    case "borrow": return ["what", "lender", "account", "amount", "review"];
    case "lend": return ["what", "lendee", "account", "amount", "review"];
    case "collect": return ["what", "payer", "account", "amount", "review"];
    case "debt": return ["what", "debtpick", "account", "amount", "review"];
    case "bill": return ["what", "billpick", "amount", "review"];
    case "transfer": return ["what", "account", "to", "amount", "review"];
    default: return ["what"];
  }
}
const wizStart = o => { UI.wiz = { d: newDraft(o), step: "what" }; UI.tab = "add"; };
function wizNext() { const w = UI.wiz, st = stepsFor(w.d), i = st.indexOf(w.step); w.step = st[Math.min(i + 1, st.length - 1)]; render(); window.scrollTo(0, 0); const f = $("[data-focus]"); if (f) f.focus(); }
function wizBack() { const w = UI.wiz, st = stepsFor(w.d), i = st.indexOf(w.step); if (i <= 0 || (w.d.scan && w.step === "review")) { UI.wiz = { d: newDraft(), step: "what" }; UI.tab = w.from || "home"; UI.wiz = null; render(); return; } w.step = st[i - 1]; render(); window.scrollTo(0, 0); }
function viewAdd() {
  if (!UI.wiz) wizStart();
  const w = UI.wiz, d = w.d;
  if (w.step === "scanning") return `<div class="wiz"><div class="wizhead"><span class="strong">Reading your receipt</span></div><div class="progress"><i style="width:${w.pct || 3}%"></i></div><p class="muted" id="scanMsg">${esc(w.msg || "Getting started…")}</p><p class="small muted" id="scanNote">${w.viaClaude ? "Sending the image to Anthropic, as you set up in Settings." : "This happens on your phone. Your receipt isn't uploaded."}</p></div>`;
  if (w.step === "done") return viewDone();
  const st = stepsFor(d), i = st.indexOf(w.step);
  const head = `<div class="wizhead"><button class="btn sm" data-a="wizBack" style="border:0;padding-left:0;background:none">‹ Back</button>${i > 0 && !d.scan ? `<span class="small muted">Step ${i + 1} of ${st.length}</span>` : `<span></span>`}</div>${d.scan ? "" : `<div class="progress"><i style="width:${(i + 1) / st.length * 100}%"></i></div>`}`;
  const opt = (a, x, title, sub, on, dot) => `<button class="opt ${on ? "on" : ""}" data-a="${a}" data-x="${esc(x)}">${dot ? `<i class="dot" style="background:${dot}"></i>` : ""}<span class="grow"><b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ""}</span></button>`;
  let q = "", body = "", after = "";
  switch (w.step) {
    case "what":
      q = "What happened?";
      body = `<button class="opt feature" data-a="scan">${ICON.camera}<span><b>Use a receipt or screenshot</b><small>It fills in the amount for you</small></span></button><div class="opts">` +
        [["expense", "I spent money", "Shopping, food, gas"], ["income", "I got paid", "Money I earned"], ["borrow", "I borrowed money", "A loan I need to pay back"], ["bill", "I paid a bill", "Rent, utilities, subscriptions"], ["debt", "I paid a debt", "Paying back a loan"], ["lend", "I lent money", "To family or friends"], ["collect", "Someone paid me back", "Money I lent them"], ["transfer", "I moved money", "Between my own accounts"]].map(([k, t, s]) => opt("pickKind", k, t, s)).join("") + "</div>";
      break;
    case "category": {
      q = "What was it for?";
      const cats = C.catsOf(S, d.scope);
      body = seg("wizScope", [["personal", "Personal"], ["business", "Business"]], d.scope) + `<div class="grid">${cats.map(c => opt("pickCat", c, c, "", d.category === c, C.catColor(S, c))).join("")}</div>`;
      break;
    }
    case "item":
      q = "Which item is it for?";
      body = `<div class="opts">${(S.budgets || []).filter(b => b.category === d.category).map(b => opt("pickItem", b.id, b.name || b.category, money(C.budgetSpent(S, b, UI.month)) + " spent of " + money(C.budgetTotal(b, UI.month)), d.budgetId === b.id)).join("")}</div>`;
      break;
    case "account": {
      q = STEP_TEXT[d.kind];
      const bal = C.balances(S);
      body = accounts().length ? `<div class="opts">${accounts().map(a => opt("pickAcct", a.id, a.name, money(bal[a.id], a.currency), d.accountId === a.id)).join("")}</div>` : `<div class="notice info"><span>Add an account first.</span><button class="link" data-a="editAccount" data-x="new">Add account</button></div>`;
      break;
    }
    case "to": {
      q = "Moving it to which account?";
      const bal = C.balances(S);
      body = `<div class="opts">${accounts().filter(a => a.id !== d.accountId).map(a => opt("pickTo", a.id, a.name, money(bal[a.id], a.currency), d.toAccountId === a.id)).join("")}</div>`;
      break;
    }
    case "who": {
      q = "Who paid you?";
      body = `<div class="opts">${(S.streams || []).filter(x => !x.archived).map(x => opt("pickStream", x.id, x.name, x.via || "", d.streamId === x.id)).join("")}${opt("pickStream", "other", "Other income", "A refund, a gift, a one-off sale", d.streamId === "other")}</div>
        <button class="opt" data-a="switchBorrow" style="background:var(--loan-soft);border-color:transparent"><span class="grow"><b class="loan">Someone lent me this</b><small>It's a loan, so it won't count as income</small></span></button>
        <button class="opt" data-a="switchCollect" style="background:var(--green-soft);border-color:transparent"><span class="grow"><b class="in">Someone paid back money I lent</b><small>It won't count as income</small></span></button>`;
      break;
    }
    case "lender": {
      q = "Who lent you the money?";
      body = `<p class="muted" style="margin-top:-8px">This adds to what you owe them. It doesn't count as income.</p><div class="opts">${(S.debts || []).filter(x => !C.isOwedToYou(x) && C.isMoneyDebt(x)).map(x => opt("pickLender", x.id, x.name, "You owe " + money(C.debtBalance(S, x)), d.debtId === x.id)).join("")}</div>
        <div class="field"><label for="w-new">Someone new</label><input class="inp" id="w-new" data-b="newDebtName" value="${esc(d.newDebtName || "")}" placeholder="Their name"></div><button class="btn" data-a="pickNewLender">Continue with this name</button>`;
      break;
    }
    case "lendee": {
      q = "Who did you lend it to?";
      body = `<p class="muted" style="margin-top:-8px">This adds to what they owe you. It doesn't count as spending.</p><div class="opts">${(S.debts || []).filter(x => C.isOwedToYou(x) && C.isMoneyDebt(x)).map(x => opt("pickLendee", x.id, x.name, "Owes you " + money(C.debtBalance(S, x)), d.debtId === x.id)).join("")}</div>
        <div class="field"><label for="w-new">Someone new</label><input class="inp" id="w-new" data-b="newDebtName" value="${esc(d.newDebtName || "")}" placeholder="Their name"></div><button class="btn" data-a="pickNewLendee">Continue with this name</button>`;
      break;
    }
    case "payer": {
      q = "Who paid you back?";
      const list = (S.debts || []).filter(x => C.isOwedToYou(x) && C.debtBalance(S, x) > 0);
      body = list.length ? `<div class="opts">${list.map(x => opt("pickPayer", x.id, x.name, "Owes you " + money(C.debtBalance(S, x)), d.debtId === x.id)).join("")}</div>` : `<div class="notice info"><span>Nobody owes you money right now.</span><button class="link" data-a="newLoan">Add a loan</button></div>`;
      break;
    }
    case "debtpick":
      q = "Which debt did you pay?";
      body = (S.debts || []).length ? `<div class="opts">${S.debts.filter(x => !C.isOwedToYou(x) && C.debtBalance(S, x) > 0).map(x => opt("pickDebt", x.id, x.name, "You owe " + money(C.debtBalance(S, x)), d.debtId === x.id)).join("")}</div>` : `<div class="notice info"><span>You have no debts listed.</span><button class="link" data-a="editDebt" data-x="new">Add a debt</button></div>`;
      break;
    case "billpick": {
      q = "Which bill did you pay?";
      const unpaid = C.billSlots(S, C.today().slice(0, 7)).filter(x => ["overdue", "soon", "later"].includes(x.status));
      body = unpaid.length ? `<div class="opts">${unpaid.map(x => opt("pickBill", x.bill.id + "|" + x.due.slice(0, 7) + "|" + x.slot, x.bill.name + (x.total > 1 ? ` (${C.ord(C.dparse(x.due).getDate())})` : ""), money(x.usual, x.currency) + " · due " + fmtDate(x.due))).join("")}</div>` : `<div class="panel"><div class="empty">No unpaid bills this month.</div></div>`;
      break;
    }
    case "amount": {
      q = d.kind === "income" || d.kind === "borrow" ? "How much arrived?" : d.kind === "transfer" ? "How much did you send?" : "How much was it?";
      const a = C.acct(S, d.accountId), cur = a ? a.currency : "PHP";
      body = amountField(d, cur, true) + (d.usualHint ? `<p class="hint">Usually ${esc(d.usualHint)}. Change it if this one was different.</p>` : "") + rateField(d, a) + transferArrival(d);
      after = `<button class="btn primary block" data-a="amountNext">Next ›</button>`;
      break;
    }
    case "review":
      q = d.scan ? "Check what we read" : "Check and save";
      body = (d.scan && d.scan.notReceipt ? `<div class="notice"><span>This doesn't look like a receipt. Please check everything below.</span></div>` : "") +
        (d.scan && !d.scan.ok && !d.scan.notReceipt ? `<div class="notice"><span>We couldn't read the total clearly. Please type the amount.</span></div>` : "") +
        (d.scan && d.scan.warning ? `<div class="notice"><span>${esc(d.scan.warning)}</span></div>` : "") +
        (d.scan && (d.scan.currency === "USD" || d.scan.currency === "OTHER") ? `<div class="notice"><span>This receipt isn't in pesos. Pick the matching account or enter the peso amount.</span></div>` : "") +
        entryFormHTML(d);
      after = `<button class="btn primary block" data-a="wizSave">Save</button>`;
      break;
  }
  return `<div class="wiz">${head}<h1>${esc(q)}</h1>${body}${after}</div>`;
}
function viewDone() {
  const { entry } = UI.wiz, a = C.acct(S, entry.accountId), bal = C.balances(S);
  const lines = [];
  if (a) lines.push(`${esc(a.name)} is now <b>${money(bal[a.id], a.currency)}</b>`);
  if (entry.kind === "transfer") { const to = C.acct(S, entry.toAccountId); lines.push(`${esc(to.name)} is now <b>${money(bal[to.id], to.currency)}</b>`); }
  const did = C.debtIdOf(S, entry);
  if (did && C.debt(S, did)) { const x = C.debt(S, did), bal = money(C.debtBalance(S, x)); lines.push(C.isOwedToYou(x) ? `${esc(x.name)} owes you <b>${bal}</b>` : `You owe ${esc(x.name)} <b>${bal}</b>`); }
  return `<div class="wiz"><div class="wizhead"></div><h1>Saved</h1><div class="panel pad" style="display:flex;flex-direction:column;gap:6px"><div class="strong">${esc(C.entryTitle(S, entry))} · ${money(entry.amount, entry.currency)}</div>${lines.map(l => `<div class="muted">${l}</div>`).join("")}</div>
    <div class="btnrow"><button class="btn primary" data-a="wizAgain">Log another</button><button class="btn" data-a="wizDone">Done</button></div><button class="link" style="text-align:center" data-a="editEntry" data-x="${entry.id}">Something wrong? Edit it</button></div>`;
}

/* ---------- the entry form: everything can always be changed ---------- */
/* The amount box takes sums like 120+80. Phone number pads have no + key, so these buttons add one. */
const amtOf = d => { const v = C.evalAmount(d.amount); return v === null ? NaN : v; };
const calcText = d => /[+\-×÷*/x]/i.test(String(d.amount || "").replace(/^-/, "")) ? (isNaN(amtOf(d)) ? "Finish the sum" : "= " + money(amtOf(d))) : "";
function amountField(d, cur, focus) {
  return `<div class="field"><label for="f-amt">Amount</label><div class="bigamt"><span>${cur === "USD" ? "$" : "₱"}</span><input id="f-amt" data-b="amount" data-live inputmode="decimal" autocomplete="off" value="${esc(d.amount)}" placeholder="0" aria-label="Amount" ${focus ? "data-focus autofocus" : ""}></div>
    <div class="ops"><span class="hint" id="f-calc">${calcText(d)}</span>${[["+", "Add"], ["−", "Subtract"], ["×", "Multiply"], ["÷", "Divide"]].map(([o, l]) => `<button type="button" class="op" data-a="op" data-x="${o}" aria-label="${l}">${o}</button>`).join("")}</div></div>`;
}
function rateField(d, a) {
  if (!a || a.currency !== "USD") return "";
  if (!d.rate) d.rate = S.usdRate || "";
  const php = (amtOf(d) || 0) * (+d.rate || 0);
  return `<div class="field"><label for="f-rate">Exchange rate (₱ per $1)</label><input class="inp" id="f-rate" data-b="rate" data-live inputmode="decimal" value="${esc(d.rate)}"><span class="hint" id="f-php">${d.rate ? `In pesos: ${money(php)}` : "Enter a rate to count this in your peso totals."}</span></div>`;
}
function transferArrival(d) {
  if (d.kind !== "transfer") return "";
  const a = C.acct(S, d.accountId), to = C.acct(S, d.toAccountId);
  if (!a || !to || a.currency === to.currency) return "";
  return `<div class="field"><label for="f-to">How much arrived in ${esc(to.name)}?</label><input class="inp" id="f-to" data-b="toAmount" data-live inputmode="decimal" value="${esc(d.toAmount ?? "")}"></div>`;
}
const acctChips = (field, skip) => `<div class="chips">${accounts().filter(a => a.id !== skip).map(a => `<button type="button" class="chip ${"" + a.id === "" + DRAFT()[field] ? "on" : ""}" data-a="setDraft" data-x="${field}|${a.id}">${esc(a.name)}</button>`).join("")}</div>`;
const DRAFT = () => { const top = UI.sheets[UI.sheets.length - 1]; return top && top.d ? top.d : UI.wiz && UI.wiz.d; };
/* Spending more than an account holds is usually a typo or the wrong account, so say so before saving. */
function effectText(d) {
  const r = effectCore(d);
  if (r.bad || !["expense", "bill", "debt", "transfer", "lend"].includes(d.kind)) return r;
  const a = C.acct(S, d.accountId), v = amtOf(d);
  if (!a || !(v > 0)) return r;
  const others = { ...S, entries: S.entries.filter(e => e.id !== d.id) }, after = C.balances(others)[a.id] - v;
  return after < 0 ? { bad: true, text: r.text + ` This would take ${a.name} below zero, to ${money(after, a.currency)}. Check the amount and account.` } : r;
}
function effectCore(d) {
  const built = C.buildEntry(S, { ...d, streamId: d.streamId === "other" ? "" : d.streamId, source: d.streamId === "other" ? (d.source || "Other income") : d.source, debtId: d.debtId === "new" ? "__" : d.debtId });
  const a = C.acct(S, d.accountId), an = a ? a.name : "the account", cur = a ? a.currency : "PHP", amt = money(amtOf(d), cur);
  if (!(amtOf(d) > 0) && d.kind !== "correction") return { bad: true, text: "Enter an amount to see what this does." };
  if (!a && d.kind !== "debtadjust") return { bad: true, text: "Choose which account this affects." };
  const dbt = C.debt(S, d.debtId);
  const after = delta => { if (!dbt) return ""; const others = { ...S, entries: S.entries.filter(e => e.id !== d.id) }; return money(C.debtBalance(others, dbt) + delta); };
  const php = C.toPHP(S, amtOf(d), cur, d.rate);
  switch (d.kind) {
    case "expense": return { text: `Takes ${amt} out of ${an}. ${dbt ? `Lowers what you owe ${dbt.name} to ${after(-php)}.` : `Counts as spending under ${d.category || "a category"}.`}` };
    case "income": return { text: `Adds ${amt} to ${an}. Counts as money you earned.` };
    case "lend": return { text: `Takes ${amt} out of ${an}. ${dbt ? `${dbt.name} would owe you ${after(php)}.` : d.debtId === "new" && d.newDebtName ? `${d.newDebtName} would owe you ${money(php)}.` : "Adds to what they owe you."} Not counted as spending.` };
    case "collect": return { text: `Adds ${amt} to ${an}. ${dbt ? `${dbt.name} would owe you ${after(-php)}.` : "Lowers what they owe you."} Not counted as income.` };
    case "borrow": return { text: `Adds ${amt} to ${an}. ${dbt ? `You'd owe ${dbt.name} ${after(php)}.` : d.debtId === "new" && d.newDebtName ? `You'd owe ${d.newDebtName} ${money(php)}.` : "Adds the same amount to what you owe."} Not counted as income.` };
    case "debt": return { text: `Takes ${amt} out of ${an}. ${dbt ? `You'd owe ${dbt.name} ${after(-php)}.` : "Lowers what you owe."}` };
    case "bill": { const b = C.bill(S, d.billId), ld = b && b.debtId && C.debt(S, b.debtId); return { text: `Takes ${amt} out of ${an}. ${ld ? `Lowers what you owe ${ld.name}.` : `Marks ${b ? b.name : "the bill"} as paid and counts as spending.`}` }; }
    case "transfer": { const to = C.acct(S, d.toAccountId); return { text: `Moves ${amt} from ${an} to ${to ? to.name : "another account"}. Not income or spending.` }; }
    case "correction": return { text: "Changes the balance of " + an + " to match reality. Not income or spending." };
    default: return { text: built.error || "" };
  }
}
function entryFormHTML(d) {
  const a = C.acct(S, d.accountId), cur = a ? a.currency : d.currency || "PHP", ef = effectText(d);
  let source = "";
  if (d.kind === "expense") {
    const cats = C.catsOf(S, d.scope || "personal");
    if (d.category && !cats.includes(d.category)) cats.unshift(d.category);
    const items = (S.budgets || []).filter(b => b.category === d.category);
    source = `<div class="field"><span class="lbl">Personal or business</span>${seg("formScope", [["personal", "Personal"], ["business", "Business"]], d.scope || "personal")}</div>
      <div class="field"><label for="f-cat">Category</label><select class="inp" id="f-cat" data-b="category" data-re>${opts([["", "Choose…"], ...cats.map(c => [c, c])], d.category)}</select></div>
      ${items.length > 1 ? `<div class="field"><label for="f-item">Budget item</label><select class="inp" id="f-item" data-b="budgetId">${opts([["", "None"], ...items.map(b => [b.id, b.name || b.category])], d.budgetId)}</select></div>` : ""}
      ${d.debtId || d.category === "Loans" ? `<div class="field"><label for="f-dl">Counts toward a debt</label><select class="inp" id="f-dl" data-b="debtId" data-re>${opts([["", "No"], ...(S.debts || []).filter(x => C.isMoneyDebt(x) && !C.isOwedToYou(x)).map(x => [x.id, x.name])], d.debtId)}</select></div>` : ""}`;
  } else if (d.kind === "income") {
    source = `<div class="field"><label for="f-str">Came from</label><select class="inp" id="f-str" data-b="streamId" data-re>${opts([["", "Choose…"], ...(S.streams || []).map(x => [x.id, x.name]), ["other", "Other income"]], d.streamId)}</select></div>
      ${d.streamId === "other" ? `<div class="field"><label for="f-src">What was it?</label><input class="inp" id="f-src" data-b="source" value="${esc(d.source || "")}" placeholder="e.g. Refund"></div>` : ""}`;
  } else if (d.kind === "lend" || d.kind === "collect") {
    const list = (S.debts || []).filter(x => C.isOwedToYou(x) && C.isMoneyDebt(x)).map(x => [x.id, x.name]);
    source = `<div class="field"><label for="f-debt">${d.kind === "lend" ? "Lent to" : "Paid back by"}</label><select class="inp" id="f-debt" data-b="debtId" data-re>${opts([["", "Choose…"], ...list, ...(d.kind === "lend" ? [["new", "+ Someone new"]] : [])], d.debtId)}</select></div>
      ${d.debtId === "new" ? `<div class="field"><label for="f-nd">Their name</label><input class="inp" id="f-nd" data-b="newDebtName" data-live value="${esc(d.newDebtName || "")}"></div>` : ""}`;
  } else if (d.kind === "borrow" || d.kind === "debt") {
    const list = (S.debts || []).filter(x => !C.isOwedToYou(x) && C.isMoneyDebt(x)).map(x => [x.id, x.name]);
    source = `<div class="field"><label for="f-debt">${d.kind === "borrow" ? "Lent by" : "Debt paid"}</label><select class="inp" id="f-debt" data-b="debtId" data-re>${opts([["", "Choose…"], ...list, ...(d.kind === "borrow" ? [["new", "+ Someone new"]] : [])], d.debtId)}</select></div>
      ${d.debtId === "new" ? `<div class="field"><label for="f-nd">Their name</label><input class="inp" id="f-nd" data-b="newDebtName" data-live value="${esc(d.newDebtName || "")}"></div>` : ""}`;
  } else if (d.kind === "bill") {
    const b = C.bill(S, d.billId), m = d.billMonth || d.date.slice(0, 7), days = b ? C.occDays(b, m) : [];
    source = `<div class="field"><label for="f-bill">Bill</label><select class="inp" id="f-bill" data-b="billId" data-re>${opts([["", "Choose…"], ...(S.bills || []).map(x => [x.id, x.name])], d.billId)}</select></div>
      <div class="two"><div class="field"><label for="f-bm-btn">For month</label>${pick("month", "f-bm", 'data-b="billMonth" data-re', m)}</div>
      ${days.length > 1 ? `<div class="field"><label for="f-bs">Which payment</label><select class="inp" id="f-bs" data-b="billSlot">${opts(days.map((x, i) => [i + 1, C.ord(x)]), d.billSlot || 1)}</select></div>` : ""}</div>`;
  } else if (d.kind === "transfer") {
    source = `<div class="field"><span class="lbl">Moved to</span>${acctChips("toAccountId", d.accountId)}</div>${transferArrival(d)}`;
  }
  const canChangeType = ["expense", "income", "borrow", "debt", "bill", "transfer", "lend", "collect"].includes(d.kind);
  const types = [["expense", "Spent"], ["income", "Earned"], ["borrow", "Borrowed"], ["debt", "Paid a debt"], ["bill", "Paid a bill"], ["lend", "Lent"], ["collect", "Paid back to me"], ["transfer", "Moved"]];
  const acctLabel = { income: "Landed in", borrow: "Landed in", collect: "Landed in", lend: "Came from", transfer: "Moved from" }[d.kind] || "Paid from";
  const needAcct = !!d.scan;
  return `<div class="form">
    ${d.receiptId ? `<img class="receipt" id="receiptImg" alt="Your receipt">` : ""}
    ${needAcct ? `<div class="field"><span class="lbl" style="color:var(--blue-deep)">Which account did you pay from?</span>${acctChips("accountId")}</div>` : ""}
    ${amountField(d, cur)}
    ${d.scan && d.scan.candidates && d.scan.candidates.length > 1 ? `<div class="field"><span class="lbl">Amounts found on the receipt</span><div class="chips">${d.scan.candidates.map(v => `<button type="button" class="chip ${+d.amount === v ? "on" : ""}" data-a="setDraft" data-x="amount|${v}">${money(v)}</button>`).join("")}</div></div>` : ""}
    ${rateField(d, a)}
    ${canChangeType ? `<div class="field"><span class="lbl">What was this?</span><div class="chips">${types.map(([k, l]) => `<button type="button" class="chip ${d.kind === k ? "on" : ""}" data-a="setKind" data-x="${k}">${l}</button>`).join("")}</div></div>` : ""}
    ${source}
    ${d.kind !== "debtadjust" && !needAcct ? `<div class="field"><span class="lbl">${acctLabel}</span>${acctChips("accountId")}</div>` : ""}
    <div class="field"><label for="f-date-btn">Date</label><div class="chips"><button type="button" class="chip ${d.date === C.today() ? "on" : ""}" data-a="setDraft" data-x="date|${C.today()}">Today</button><button type="button" class="chip ${d.date === C.addDays(C.today(), -1) ? "on" : ""}" data-a="setDraft" data-x="date|${C.addDays(C.today(), -1)}">Yesterday</button><span style="flex:1;min-width:150px">${pick("date", "f-date", 'data-b="date" data-re', d.date)}</span></div>${d.scan && d.scan.noDate ? `<span class="hint">We couldn't find a date on the receipt, so this says today.</span>` : ""}</div>
    <div class="field"><label for="f-note">${d.kind === "expense" ? "Where or what" : "Note"} <span style="font-weight:400">(optional)</span></label><input class="inp" id="f-note" data-b="note" value="${esc(d.note || "")}" placeholder="${d.kind === "expense" ? "e.g. Puregold" : ""}" ${d.kind === "expense" ? 'list="pastNotes" autocomplete="off"' : ""}>${d.kind === "expense" ? `<datalist id="pastNotes">${pastNotes().map(n => `<option value="${esc(n)}"></option>`).join("")}</datalist>` : ""}</div>
    <div class="effect ${ef.bad ? "bad" : ""}" id="effect">${esc(ef.text)}</div>
  </div>`;
}
/* Places you've spent at before, newest first, so typing "Pu" offers "Puregold". */
function pastNotes() {
  const seen = new Set(), out = [];
  for (const e of S.entries.slice().sort((a, b) => b.date.localeCompare(a.date))) {
    const n = (e.kind === "expense" && e.note || "").trim(), k = n.toLowerCase();
    if (n && !seen.has(k)) { seen.add(k); out.push(n); if (out.length >= 60) break; }
  }
  return out;
}
function draftFromEntry(e) {
  const d = { ...e };
  if (e.kind === "income" && !e.streamId) d.streamId = "other";
  if (e.amount !== undefined) d.amount = String(e.amount);
  return d;
}
function finalizeDraft(d) {
  const x = { ...d };
  if (x.kind !== "correction" && x.kind !== "debtadjust") { const v = C.evalAmount(x.amount); if (v === null) return { error: "Check the amount. It should be a number or a sum like 120+80." }; x.amount = v; }
  if (x.kind === "income" && x.streamId === "other") { x.streamId = ""; x.source = (x.source || "").trim() || "Other income"; }
  let newDebt = null;
  if ((x.kind === "borrow" || x.kind === "lend") && x.debtId === "new") {
    const name = (x.newDebtName || "").trim();
    if (!name) return { error: x.kind === "lend" ? "Enter the name of who you lent it to." : "Enter the name of who lent you the money." };
    newDebt = { id: C.uid(), name, opening: 0, startDate: C.today(), ...(x.kind === "lend" ? { dir: "owed" } : {}) };
    x.debtId = newDebt.id;
  }
  const temp = newDebt ? { ...S, debts: [...(S.debts || []), newDebt] } : S;
  const r = C.buildEntry(temp, x);
  return r.error ? r : { entry: r.entry, newDebt };
}
function storeEntry(s, r) {
  if (r.newDebt) s.debts = [...(s.debts || []), r.newDebt];
  const at = s.entries.findIndex(e => e.id === r.entry.id);
  if (at >= 0) s.entries[at] = r.entry; else s.entries.push(r.entry);
  if (!s.sample && r.entry.rate && r.entry.currency === "USD") s.usdRate = String(r.entry.rate);
}

/* ---------- sheets ---------- */
function openSheet(o) { UI.sheets.push(o); renderSheet(); }
function closeSheet() { UI.sheets.pop(); render(); }
const SHEETS = {
  entry(sh) {
    const d = sh.d, isNew = !S.entries.some(e => e.id === d.id);
    return { title: sh.title || (isNew ? "New entry" : "Edit entry"), body: (d.kind === "save" ? `<div class="notice info"><span>This came from your old app, where setting money aside didn't change a balance.</span></div>` : "") + entryFormHTML(d),
      foot: `${isNew ? "" : `<button class="btn danger" data-a="deleteEntry" data-x="${d.id}">Delete</button><button class="btn" data-a="copyEntry" data-x="${d.id}">Log again</button>`}<button class="btn primary" data-a="saveEntry">Save</button>` };
  },
  list(sh) {
    const es = sh.get().sort((a, b) => (b.date + (b.createdAt || "")).localeCompare(a.date + (a.createdAt || "")));
    const total = es.reduce((t, e) => t + C.entPHP(S, e), 0);
    return { title: sh.title, body: `${sh.note ? `<p class="muted">${esc(sh.note)}</p>` : ""}<div class="panel pad"><div class="small muted">${es.length} ${es.length === 1 ? "entry" : "entries"} add up to</div><div class="bigline">${money(total)}</div></div><div class="panel">${es.length ? es.map(e => entryRow(e)).join("") : `<div class="empty">Nothing here.</div>`}</div><p class="small muted">Tap an entry to change it. This total updates right away.</p>` };
  },
  summary(sh) { return { title: monthName(sh.month) + " summary", body: `<div class="panel">${statementRows(sh.month)}</div><p class="small muted">Tap a line to see the entries behind it.</p>` }; },
  forecast() {
    const m = C.today().slice(0, 7), f = C.forecast(S, m);
    const det = (sign, label, val, items) => `<details class="panel"><summary class="eq"><span class="l"><span class="sign">${sign}</span><span>${label}</span></span><span class="r">${money(val)}<span class="sumchev">›</span></span></summary>${items.length ? items.join("") : `<div class="empty small">Nothing here.</div>`}</details>`;
    const line = (t, s, v) => `<div class="row" style="min-height:46px"><span class="grow small"><span class="strong">${esc(t)}</span><br><span class="muted">${esc(s)}</span></span><span class="amt small">${money(v)}</span></div>`;
    return { title: "By the end of " + monthName(m, true), body: `
      <div class="panel"><div class="eq"><span class="l"><span class="sign"></span><span>You have now</span></span><span class="r">${money(f.have)}</span></div></div>
      ${det("+", "Paydays still to come", f.coming, f.pays.map(p => line(p.stream.name, fmtDate(p.date) + (p.status === "late" ? " · not logged yet" : ""), p.php)))}
      ${det("−", "Bills still to pay", f.dueBills, f.bills.map(x => line(x.bill.name, "Due " + fmtDate(x.due), x.php)))}
      ${f.dueOnes || f.ones.length ? det("−", "One-time costs", f.dueOnes, f.ones.map(o => line(o.item.name, fmtDate(o.item.date), o.php))) : ""}
      ${det("−", "Left in your budgets", f.dueBudgets, f.budgets.map(b => line(b.budget.name || b.budget.category, money(b.spent) + " spent of " + money(b.total), b.left)))}
      <div class="panel"><div class="eq tot"><span class="l"><span class="sign">=</span><span>You'd end with</span></span><span class="r ${f.end < 0 ? "red" : ""}">${money(f.end)}</span></div></div>
      <p class="small muted">Debts with no payment plan aren't included, since nothing is scheduled for them. Add a plan under Debts to count them.</p>` };
  },
  accounts() {
    const bal = C.balances(S);
    return { title: "Accounts", body: `<div class="panel">${accounts().map(a => `<button class="row" data-a="accountSheet" data-x="${a.id}">${tile(acctIcon(a), "#D6336C")}<span class="grow"><span class="rowt">${esc(a.name)}</span><br><span class="rows">${esc(a.type || "Account")}</span></span><span class="amt">${money(bal[a.id], a.currency)}${a.currency === "USD" ? `<small>≈ ${money(C.toPHP(S, bal[a.id], "USD"))}</small>` : ""}</span><span class="chev">›</span></button>`).join("") || `<div class="empty">No accounts yet.</div>`}</div>
      <div class="panel"><div class="eq tot"><span class="l">Total in pesos</span><span class="r">${money(C.totalPHP(S))}</span></div></div>
      ${accounts().some(a => a.currency === "USD") ? `<p class="small muted">Dollar balances use your rate of ₱${esc(S.usdRate || "0")} per $1.</p>` : ""}
      <button class="btn block" data-a="editAccount" data-x="new">+ Add an account</button><button class="btn block" data-a="check">Compare with my real balances</button>` };
  },
  account(sh) {
    const a = C.acct(S, sh.id), bal = C.balances(S);
    if (!a) return { title: "Account", body: "" };
    const es = S.entries.filter(e => e.accountId === a.id || e.toAccountId === a.id).sort((x, y) => (y.date + (y.createdAt || "")).localeCompare(x.date + (x.createdAt || ""))).slice(0, 60);
    return { title: a.name, body: `<div class="panel pad"><div class="small muted">Balance</div><div class="bigline">${money(bal[a.id], a.currency)}</div><div class="small muted">Started at ${money(a.start, a.currency)}</div></div>
      <div class="btnrow"><button class="btn" data-a="fixAccount" data-x="${a.id}">Fix balance</button><button class="btn" data-a="editAccount" data-x="${a.id}">Edit</button></div>
      <div class="panel">${es.map(e => entryRow(e)).join("") || `<div class="empty">No entries yet.</div>`}</div>` };
  },
  fixAccount(sh) {
    const a = C.acct(S, sh.id), bal = C.balances(S)[a.id];
    return { title: "Fix " + a.name, body: `<form class="form" data-save="fixAccount" data-id="${a.id}"><p class="muted">The app thinks you have <b class="strong">${money(bal, a.currency)}</b>. What's really in there?</p>
      <div class="field"><label for="fx">Actual balance</label><input class="inp" id="fx" name="actual" inputmode="decimal" required data-focus></div>
      <p class="hint">This adds a visible correction entry, so your history stays honest. It doesn't count as income or spending.</p><button class="btn primary" type="submit">Save correction</button></form>` };
  },
  check() {
    const bal = C.balances(S);
    return { title: "Compare with real balances", body: `<form class="form" data-save="check"><p class="muted">Check your banking apps and type what's really there. Leave the ones that match. Any difference becomes a visible correction.</p>
      <div class="panel">${accounts().map(a => `<div class="row"><label class="grow" for="c-${a.id}"><span class="rowt">${esc(a.name)}</span><br><span class="rows">App says ${money(bal[a.id], a.currency)}</span></label><input class="inp" style="width:130px" id="c-${a.id}" name="a:${a.id}" inputmode="decimal" placeholder="Same"></div>`).join("")}</div>
      ${(S.debts || []).length ? `<div class="secthead"><h2>What you owe</h2></div><div class="panel">${S.debts.filter(d => C.debtBalance(S, d) !== 0).map(d => `<div class="row"><label class="grow" for="d-${d.id}"><span class="rowt">${esc(d.name)}</span><br><span class="rows">App says ${money(C.debtBalance(S, d))}</span></label><input class="inp" style="width:130px" id="d-${d.id}" name="d:${d.id}" inputmode="decimal" placeholder="Same"></div>`).join("")}</div>` : ""}
      <button class="btn primary" type="submit">Save</button></form>` };
  },
  debt(sh) {
    const d = C.debt(S, sh.id);
    if (!d) return { title: "Debt", body: "" };
    if (C.isThing(d)) {
      const mine = !C.isOwedToYou(d);
      return { title: d.item || "Item", body: `<div class="panel pad" style="display:flex;flex-direction:column;gap:6px"><div class="small muted">${mine ? "Borrowed from" : "Lent to"}</div><div class="bigline" style="font-size:26px">${esc(d.name)}</div>${d.note ? `<div class="muted">${esc(d.note)}</div>` : ""}<div>${d.settled ? '<span class="pill paid">Returned</span>' : `<span class="pill">${mine ? "You still have it" : "They still have it"}</span>`}</div></div>
        <p class="small muted">This isn't money, so it doesn't change your balances or what you owe in pesos.</p>
        <button class="btn primary block" data-a="toggleReturned" data-x="${d.id}">${d.settled ? "Not returned yet" : mine ? "I gave it back" : "They gave it back"}</button>
        <div class="btnrow"><button class="btn" data-a="editDebt" data-x="${d.id}">Edit</button></div>` };
    }
    const led = C.debtLedger(S, d), plan = C.debtPlan(S, d);
    const theirs = C.isOwedToYou(d);
    const rows = led.rows.slice().reverse().map(r => entryRow(r.entry, { balance: r.balance, owedLabel: theirs ? "owes you" : "owed" })).join("");
    if (theirs) return { title: d.name, body: `<div class="panel pad"><div class="small muted">Owes you</div><div class="bigline in">${money(Math.max(0, led.balance))}</div>${led.balance < 0 ? `<div class="small">They paid back ${money(-led.balance)} more than they owed</div>` : ""}</div>
      <div class="btnrow"><button class="btn primary" data-a="collectDebt" data-x="${d.id}">They paid me back</button><button class="btn" data-a="lendMore" data-x="${d.id}">I lent more</button></div>
      <section class="sect"><div class="secthead"><h2>History</h2></div><div class="panel">${rows}<div class="row"><span class="grow"><span class="rowt">Starting balance</span><br><span class="rows">${d.startDate ? fmtDate(d.startDate) : "When you started tracking"}</span></span><span class="amt">${money(led.opening)}</span></div></div><p class="small muted">Each line shows what they owed you after it. Tap one to change it.</p></section>
      <div class="btnrow"><button class="btn" data-a="fixDebt" data-x="${d.id}">Fix balance</button><button class="btn" data-a="editDebt" data-x="${d.id}">Edit</button></div>` };
    return { title: d.name, body: `<div class="panel pad"><div class="small muted">You owe</div><div class="bigline">${money(Math.max(0, led.balance))}</div>${led.balance < 0 ? `<div class="small in">You overpaid by ${money(-led.balance)}</div>` : ""}<div class="small muted" style="margin-top:4px">${plan.bill && plan.monthly ? `${money(plan.per, C.billCur(S, plan.bill))} · ${esc(C.scheduleText(plan.bill).toLowerCase())}${plan.months ? ` · about ${plan.months} ${plan.months === 1 ? "month" : "months"} left` : ""}` : "No payment plan"}</div></div>
      <div class="btnrow"><button class="btn primary" data-a="payDebt" data-x="${d.id}">I paid</button><button class="btn" data-a="borrowMore" data-x="${d.id}">I borrowed more</button></div>
      <section class="sect"><div class="secthead"><h2>History</h2></div><div class="panel">${rows}<div class="row"><span class="grow"><span class="rowt">Starting balance</span><br><span class="rows">${d.startDate ? fmtDate(d.startDate) : "When you started tracking"}</span></span><span class="amt">${money(led.opening)}</span></div></div><p class="small muted">Each line shows what you owed after it. Tap one to change it.</p></section>
      <div class="btnrow"><button class="btn" data-a="fixDebt" data-x="${d.id}">Fix balance</button><button class="btn" data-a="editDebt" data-x="${d.id}">Edit</button></div>` };
  },
  fixDebt(sh) {
    const d = C.debt(S, sh.id), bal = C.debtBalance(S, d);
    return { title: "Fix " + d.name, body: `<form class="form" data-save="fixDebt" data-id="${d.id}"><p class="muted">${C.isOwedToYou(d) ? `The app says ${esc(d.name)} owes you <b class="strong">${money(bal)}</b>. What do they really owe?` : `The app says you owe <b class="strong">${money(bal)}</b>. What do you really owe?`}</p><div class="field"><label for="fx">Actually owed</label><input class="inp" id="fx" name="actual" inputmode="decimal" required data-focus></div><p class="hint">This only changes the debt, not your accounts, and it shows in the history.</p><button class="btn primary" type="submit">Save correction</button></form>` };
  },
  editAccount(sh) {
    const a = sh.id === "new" ? { currency: "PHP", type: "Bank" } : C.acct(S, sh.id), used = S.entries.some(e => e.accountId === sh.id || e.toAccountId === sh.id);
    return { title: sh.id === "new" ? "Add an account" : "Edit account", body: `<form class="form" data-save="account" data-id="${sh.id}">
      <div class="field"><label for="a-n">Name</label><input class="inp" id="a-n" name="name" value="${esc(a.name || "")}" required placeholder="e.g. BDO, GCash, Cash"></div>
      <div class="field"><label for="a-i-btn">Icon</label>${pick("icon", "a-i", 'name="icon"', a.icon || "", true, "Default for the account type")}</div>
      <div class="two"><div class="field"><label for="a-t">Type</label><select class="inp" id="a-t" name="type">${opts(["Bank", "E-wallet", "Wallet", "Cash", "Other"].map(x => [x, x]), a.type)}</select></div>
      <div class="field"><label for="a-c">Currency</label><select class="inp" id="a-c" name="currency">${opts([["PHP", "Pesos"], ["USD", "Dollars"]], a.currency)}</select></div></div>
      <div class="field"><label for="a-s">${sh.id === "new" ? "How much is in it now?" : "Starting balance"}</label><input class="inp" id="a-s" name="start" inputmode="decimal" value="${esc(a.start ?? "")}"><span class="hint">${sh.id === "new" ? "Entries you log add to or take from this." : "This is the balance before your first entry. To match today's balance, use Fix balance instead."}</span></div>
      <button class="btn primary" type="submit">Save</button>
      ${sh.id !== "new" ? (used ? `<button class="btn danger" type="button" data-a="archiveAccount" data-x="${sh.id}">Hide this account</button>` : `<button class="btn danger" type="button" data-a="deleteThing" data-x="accounts|${sh.id}">Delete account</button>`) : ""}</form>` };
  },
  editClient(sh) {
    const x = sh.id === "new" ? { currency: "PHP", freq: "weekly" } : C.stream(S, sh.id);
    const end = x.until ? (x.endMode === "count" ? "count" : "date") : "none", left = C.paysLeft(x);
    const changes = [...(x.changes || [])].sort((a, b) => a.from.localeCompare(b.from)), rows = [...changes, { from: "", amount: "" }];
    return { title: sh.id === "new" ? "Add an income source" : "Edit " + x.name, body: `<form class="form cform" data-save="client" data-id="${sh.id}" data-end="${end}">
      <div class="field"><label for="c-n">Name</label><input class="inp" id="c-n" name="name" value="${esc(x.name || "")}" required placeholder="Client or employer"></div>
      <div class="field"><label for="c-v">Paid through <span style="font-weight:400">(optional)</span></label><input class="inp" id="c-v" name="via" value="${esc(x.via || "")}" placeholder="e.g. Upwork, agency"></div>
      <div class="two"><div class="field"><label for="c-e">${changes.length ? "Pay before any change" : "Usual pay"}</label><input class="inp" id="c-e" name="expected" inputmode="decimal" value="${esc(x.expected || "")}"></div>
      <div class="field"><label for="c-c">Currency</label><select class="inp" id="c-c" name="currency">${opts([["PHP", "Pesos"], ["USD", "Dollars"]], x.currency)}</select></div></div>
      <div class="field"><label for="c-f">How often</label><select class="inp" id="c-f" name="freq">${opts([["weekly", "Every week"], ["biweekly", "Every 2 weeks"], ["monthly", "Once a month"], ["none", "No regular schedule"]], x.freq)}</select></div>
      <div class="field"><label for="c-a-btn">A recent or upcoming payday</label>${pick("date", "c-a", 'name="anchor"', x.anchor || "", true, "Choose a payday")}</div>
      <div class="field"><label for="c-ac">Usually lands in</label><select class="inp" id="c-ac" name="accountId">${opts([["", "Ask me each time"], ...accounts().map(a => [a.id, a.name])], x.accountId)}</select></div>
      <fieldset class="field paychg"><legend>Pay changes</legend>
        <span class="hint">If the amount goes up or down, add the first payday it changes. Paydays from then on use the new amount. Clear an amount to remove that change.</span>
        ${rows.map((r, i) => `<div class="two"><div class="field"><label for="c-rf${i}-btn">From</label>${pick("date", "c-rf" + i, `name="rf${i}"`, r.from, true, "Choose")}</div>
        <div class="field"><label for="c-ra${i}">New pay</label><input class="inp" id="c-ra${i}" name="ra${i}" inputmode="decimal" value="${esc(r.amount || "")}" placeholder="${i === changes.length ? "Amount" : ""}"></div></div>`).join("")}
      </fieldset>
      <div class="field"><label for="c-end">When does this end?</label><select class="inp" id="c-end" name="endMode">${opts([["none", "It keeps going"], ["date", "On a date I choose"], ["count", "After a number of payments"]], end)}</select></div>
      <div class="field ce-date"><label for="c-u-btn">Last payday</label>${pick("date", "c-u", 'name="until"', x.until || "", true, "Choose the last payday")}<span class="hint">Paydays after this date won't be expected.</span></div>
      <div class="field ce-count"><label for="c-l">Payments left</label><input class="inp" id="c-l" name="left" type="number" min="0" step="1" inputmode="numeric" value="${left ?? ""}" placeholder="e.g. 4"><span class="hint">Counting from today${x.until && end === "count" ? `. Right now the last one is ${fmtDate(x.until, true)}.` : "."}</span></div>
      <label class="check"><input type="checkbox" name="archived" ${x.archived ? "checked" : ""}> I no longer work with them (stop expecting pay now)</label>
      <button class="btn primary" type="submit">Save</button></form>` };
  },
  bill(sh) {
    const [id, m, slot] = sh.x.split("|"), b = C.bill(S, id);
    return { title: b.name, body: `<div class="panel pad"><div class="small muted">Payment for ${monthName(m)}</div><div class="bigline">${money(b.amount, C.billCur(S, b))}</div><div class="small muted">${esc(C.scheduleText(b))}</div></div>
      <button class="btn primary block" data-a="payBill" data-x="${sh.x}">I paid this</button><button class="btn block" data-a="skipBill" data-x="${sh.x}">Not this month</button><p class="small muted" style="margin-top:-10px">Use "Not this month" if you already paid before tracking, or it doesn't apply. Nothing is logged.</p><button class="btn block" data-a="editBill" data-x="${id}">Edit this bill</button>` };
  },
  billsList() { return { title: "My bills", body: `<div class="panel">${(S.bills || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map(b => `<button class="row" data-a="editBill" data-x="${b.id}"><i class="dot" style="background:${C.catColor(S, b.category || "Other")}"></i><span class="grow"><span class="rowt">${esc(b.name)}</span><br><span class="rows">${esc(C.scheduleText(b))}</span></span><span class="amt">${money(b.amount, C.billCur(S, b))}</span><span class="chev">›</span></button>`).join("")}</div>` }; },
  editBill(sh) {
    const b = sh.id === "new" ? { freq: "monthly", by: "date", scope: "personal", category: "Other" } : C.bill(S, sh.id), scope = b.scope || "personal";
    const cats = C.catsOf(S, scope); if (b.category && !cats.includes(b.category)) cats.unshift(b.category);
    return { title: sh.id === "new" ? "Add a bill" : "Edit " + b.name, body: `<form class="form" data-save="bill" data-id="${sh.id}">
      <div class="field"><label for="b-n">Name</label><input class="inp" id="b-n" name="name" value="${esc(b.name || "")}" required placeholder="e.g. Meralco"></div>
      <div class="field"><label for="b-a">Amount each time</label><input class="inp" id="b-a" name="amount" inputmode="decimal" value="${esc(b.amount || "")}"></div>
      <label class="check"><input type="checkbox" name="variable" ${b.variable ? "checked" : ""}> The amount changes each time</label>
      ${schedFields(b)}
      <div class="field"><label for="b-ac">Usually paid from</label><select class="inp" id="b-ac" name="accountId">${opts([["", "Ask me each time"], ...accounts().map(a => [a.id, a.name])], b.accountId)}</select></div>
      <div class="field"><label for="b-c">Category</label><select class="inp" id="b-c" name="category">${opts(cats.map(c => [c, c]), b.category)}</select></div>
      <div class="field"><label for="b-d">Pays down a debt?</label><select class="inp" id="b-d" name="debtId">${opts([["", "No"], ...(S.debts || []).filter(d => C.isMoneyDebt(d) && !C.isOwedToYou(d)).map(d => [d.id, d.name])], b.debtId)}</select>${(S.debts || []).some(d => C.isMoneyDebt(d) && !C.isOwedToYou(d)) ? "" : `<span class="hint">No debts yet. Add one under Debts first, and it will show up here.</span>`}</div>
      <div class="field"><label for="b-s-btn">First month</label>${pick("month", "b-s", 'name="startMonth"', b.startMonth || "", true, "Start right away")}<span class="hint">Leave it as is to start right away.</span></div>
      <button class="btn primary" type="submit">Save</button>
      ${sh.id !== "new" ? `<button class="btn danger" type="button" data-a="deleteThing" data-x="bills|${sh.id}">Delete bill</button><p class="hint">Payments you already logged stay in your history.</p>` : ""}</form>` };
  },
  editBudget(sh) {
    const b = sh.id === "new" ? { freq: "anytime", by: "date" } : (S.budgets || []).find(x => x.id === sh.id);
    const cats = C.allCategories(S).sort((x, y) => x.localeCompare(y));
    return { title: sh.id === "new" ? "Add a budget" : "Edit budget", body: `<form class="form" data-save="budget" data-id="${sh.id}">
      <div class="field"><label for="g-c">Category</label><select class="inp" id="g-c" name="category">${opts(cats.map(c => [c, c]), b.category)}</select></div>
      <div class="field"><label for="g-n">Item name <span style="font-weight:400">(optional)</span></label><input class="inp" id="g-n" name="name" value="${esc(b.name || "")}" placeholder="e.g. Sofa, for a specific purchase"></div>
      <div class="field"><label for="g-a">Amount each time</label><input class="inp" id="g-a" name="amount" inputmode="decimal" value="${esc(b.amount || "")}"><span class="hint">With "Every week", this is your budget for each week. With "Any time in the month", it's for the whole month.</span></div>
      ${schedFields(b, true)}
      <div class="field"><label for="g-nt">Note <span style="font-weight:400">(optional)</span></label><input class="inp" id="g-nt" name="note" value="${esc(b.note || "")}"></div>
      <button class="btn primary" type="submit">Save</button>${sh.id !== "new" ? `<button class="btn danger" type="button" data-a="deleteThing" data-x="budgets|${sh.id}">Remove budget</button>` : ""}</form>` };
  },
  editOne(sh) {
    const o = sh.id === "new" ? { date: UI.month === C.today().slice(0, 7) ? C.today() : UI.month + "-01" } : (S.oneTime || []).find(x => x.id === sh.id);
    const cats = C.allCategories(S).sort((x, y) => x.localeCompare(y));
    return { title: sh.id === "new" ? "Add a one-time cost" : "Edit " + o.name, body: `<form class="form" data-save="one" data-id="${sh.id}">
      <div class="field"><label for="o-n">What is it?</label><input class="inp" id="o-n" name="name" value="${esc(o.name || "")}" required placeholder="e.g. Move-in deposit"></div>
      <div class="two"><div class="field"><label for="o-a">Expected amount</label><input class="inp" id="o-a" name="amount" inputmode="decimal" value="${esc(o.amount || "")}"></div><div class="field"><label for="o-d-btn">When</label>${pick("date", "o-d", 'name="date"', o.date || C.today())}</div></div>
      <div class="field"><label for="o-c">Category</label><select class="inp" id="o-c" name="category">${opts(cats.map(c => [c, c]), o.category || "Other")}</select></div>
      <div class="field"><label for="o-ac">Paid from</label><select class="inp" id="o-ac" name="accountId">${opts([["", "Ask me when I pay"], ...accounts().map(a => [a.id, a.name])], o.accountId)}</select></div>
      <button class="btn primary" type="submit">Save</button>${sh.id !== "new" ? `<button class="btn danger" type="button" data-a="deleteThing" data-x="oneTime|${sh.id}">Remove</button>` : ""}</form>` };
  },
  editDebt(sh) {
    const isNew = sh.id === "new", d = isNew ? { dir: sh.dir } : C.debt(S, sh.id), theirs = C.isOwedToYou(d), kind = d.kind || "money";
    const linked = isNew || theirs ? null : (S.bills || []).find(b => b.debtId === d.id);
    const canChangeKind = isNew || (!C.debtLedger(S, d).rows.length && !linked);
    const kinds = theirs
      ? [["money", "Money", "Cash you lent them"], ["credit", "Something they're paying off", "Like an item they pay you for in parts"], ["thing", "An item, not money", "Something to give back, like a borrowed laptop"]]
      : [["money", "Money", "A cash loan"], ["credit", "Something bought on credit", "Paid in parts, like a phone or appliance"], ["thing", "An item, not money", "Something to give back, like a borrowed laptop"]];
    const label = { money: "Money", credit: theirs ? "Something they're paying off" : "Something bought on credit", thing: "An item, not money" }[kind];
    return { title: isNew ? (theirs ? "Something you lent" : "Something you owe") : "Edit " + d.name, body: `<form class="form dform" data-save="debt" data-id="${sh.id}" data-kind="${kind}">${theirs ? '<input type="hidden" name="dir" value="owed">' : ""}
      <div class="field"><label for="d-n">${theirs ? "Who has it?" : "Who do you owe?"}</label><input class="inp" id="d-n" name="name" value="${esc(d.name || "")}" required placeholder="${theirs ? "e.g. Tito Jun" : "e.g. Mama, Home Credit"}"></div>
      ${canChangeKind ? `<div class="field"><span class="lbl">What is it?</span><div class="opts">${kinds.map(([v, t, s]) => `<label class="opt kindopt"><input type="radio" name="dkind" value="${v}" ${kind === v ? "checked" : ""}><span class="grow"><b>${t}</b><small>${s}</small></span></label>`).join("")}</div></div>`
        : `<input type="hidden" name="dkind" value="${kind}"><p class="small muted">Type: <b>${label}</b></p>`}
      <div class="field dk-item"><label for="d-it">${theirs ? "What did they get?" : "What did you get?"}</label><input class="inp" id="d-it" name="item" value="${esc(d.item || "")}" placeholder="e.g. Phone, laptop, rice cooker"></div>
      ${isNew ? `<div class="field dk-amt"><label for="d-o">${theirs ? "How much do they owe you right now?" : "How much do you owe right now?"}</label><input class="inp" id="d-o" name="owed" inputmode="decimal"></div>
      <div class="field dk-fresh"><span class="lbl">${theirs ? "Did this money leave one of your accounts today?" : "Did this money land in one of your accounts today?"}</span>
        <label class="check"><input type="radio" name="fresh" value="old" checked> ${theirs ? "No, it's an older loan" : "No, it's an older debt"}</label>
        <label class="check"><input type="radio" name="fresh" value="new"> ${theirs ? "Yes, take it out of an account" : "Yes, add it to an account too"}</label>
        <select class="inp" name="freshAccount" aria-label="Which account">${opts([["", "Which account?"], ...accounts().map(a => [a.id, a.name])])}</select></div>` :
        `<div class="field dk-amt"><label for="d-o">Starting balance</label><input class="inp" id="d-o" name="opening" inputmode="decimal" value="${esc(d.opening ?? 0)}"><span class="hint">What was owed before any entry in the history. To match today, use Fix balance instead.</span></div>`}
      <div class="field dk-note"><label for="d-nt">Note <span style="font-weight:400">(optional)</span></label><input class="inp" id="d-nt" name="note" value="${esc(d.note || "")}" placeholder="e.g. Give back before Christmas"></div>
      ${theirs ? "" : linked ? `<div class="notice info dk-pay"><span>Payment plan: ${money(linked.amount, C.billCur(S, linked))} · ${esc(C.scheduleText(linked).toLowerCase())}</span><button class="link" type="button" data-a="editBill" data-x="${linked.id}">Change</button></div>` : `
      <details class="panel dk-pay" style="background:none"><summary class="row"><span class="grow strong">Add a payment plan <span class="small muted">(optional)</span></span><span class="sumchev">›</span></summary><div class="pad form">
        <p class="hint">This adds the payment to your bills. Paying it lowers this debt.</p>
        <div class="field"><label for="d-p">Amount each time</label><input class="inp" id="d-p" name="planAmt" inputmode="decimal"></div>
        ${schedFields({ freq: "monthly", by: "date" })}
        <div class="field"><label for="d-ac">Usually paid from</label><select class="inp" id="d-ac" name="planAccount">${opts([["", "Ask me each time"], ...accounts().map(a => [a.id, a.name])])}</select></div>
        <div class="field"><label for="d-sm-btn">First payment month</label>${pick("month", "d-sm", 'name="planStart"', "", true, "Start right away")}</div></div></details>`}
      <button class="btn primary" type="submit">Save</button>
      ${!isNew && (C.isThing(d) || !C.debtLedger(S, d).rows.length) ? `<button class="btn danger" type="button" data-a="deleteDebt" data-x="${d.id}">Delete</button>` : ""}</form>` };
  },
  settings() {
    const row = (a, t, s) => `<button class="row" data-a="${a}"><span class="grow"><span class="rowt">${t}</span><br><span class="rows">${s}</span></span><span class="chev">›</span></button>`;
    const lb = lsGet("mira-last-backup");
    return { title: "Settings", body: `<div class="panel">${row("accounts", "Accounts", "Banks, e-wallets, cash")}${row("clients", "Income sources", "Clients, usual pay, paydays")}${row("categories", "Categories", "Names and colors")}${row("themeSheet", "Appearance", { system: "Same as my phone", light: "Light", dark: "Dark" }[themePref()])}${row("trackSheet", "Started tracking on", S.trackFrom ? fmtDate(S.trackFrom, true) + ", " + S.trackFrom.slice(0, 4) : "From the beginning")}${row("weekStartSheet", "Week starts on", C.WEEKDAYS[C.weekStartDay(S)] + (S.weekStart === undefined || S.weekStart === "" ? " (your payday)" : ""))}${row("rateSheet", "Dollar rate", S.usdRate ? `₱${esc(S.usdRate)} per $1` : "Not set")}${row("readerSheet", "Receipt reading", claudeKey() ? "Claude, with your phone as backup" : "On your phone")}</div>
      <div class="panel">${row("check", "Compare with my real balances", "Find and fix differences")}${row("backup", "Backup and restore", lb ? "Last backup " + fmtDate(lb.slice(0, 10)) : "No backup yet")}</div>
      <p class="small muted" style="text-align:center">Mira Ledger ${VERSION} · ${claudeKey() ? "your ledger stays on this device; scanned receipts go to Anthropic" : "your data stays on this device"}</p>
      <button class="btn danger block" data-a="eraseAsk">Erase everything on this device</button>` };
  },
  erase() { return { title: "Erase everything?", body: `<p>This removes all accounts and entries from this device. Download a backup first if you might want them back.</p><button class="btn block" data-a="backup">Download a backup first</button><button class="btn danger block" data-a="erase">Erase everything</button>` }; },
  clients() { return { title: "Income sources", body: `<div class="panel">${(S.streams || []).map(x => `<button class="row" data-a="editClient" data-x="${x.id}"><span class="grow"><span class="rowt">${esc(x.name)}${x.archived || (x.until && x.until < C.today()) ? ' <span class="pill skipped">Past</span>' : ""}</span><br><span class="rows">${C.streamAmount(x, C.today()) ? money(C.streamAmount(x, C.today()), x.currency) + " · " : ""}${esc({ weekly: "every week", biweekly: "every 2 weeks", monthly: "once a month" }[x.freq] || "no schedule")}${streamNote(x)}</span></span><span class="chev">›</span></button>`).join("") || `<div class="empty">No income sources yet.</div>`}</div><button class="btn block" data-a="editClient" data-x="new">+ Add an income source</button>` }; },
  categories(sh) {
    const scope = sh.scope || "personal";
    return { title: "Categories", body: seg("catScope", [["personal", "Personal"], ["business", "Business"]], scope) + `<div class="panel">${C.catsOf(S, scope).map(c => `<div class="row"><button type="button" class="tilebtn" data-a="catIconPick" data-x="${esc(c)}" aria-label="Change the icon for ${esc(c)}">${catTile(c)}</button><input type="color" aria-label="Color for ${esc(c)}" value="${C.catColor(S, c)}" data-color="${esc(c)}" style="width:34px;height:34px;padding:0;border:0;background:none"><span class="grow rowt">${esc(c)}</span><button class="btn sm danger" data-a="delCat" data-x="${esc(c)}">Remove</button></div>`).join("")}</div>
      <form class="form" data-save="cat"><div class="field"><label for="n-c">New category</label><input class="inp" id="n-c" name="cat" required></div><button class="btn" type="submit">Add</button></form><p class="small muted">Removing a category keeps your past entries as they are.</p>` };
  },
  reader() {
    if (window.MIRA_DEMO) return { title: "Receipt reading", body: `<p class="muted">Reading receipts with Claude is available in the installed app, not in this preview.</p>` };
    const on = !!claudeKey(), u = usageNow(), cost = (u.input * 4 + u.output * 20) / 1e6;
    return { title: "Receipt reading", body: `
      <div class="panel pad" style="display:flex;flex-direction:column;gap:8px"><div class="strong">${on ? "Claude is reading your receipts" : "Your phone is reading your receipts"}</div>
        <p class="small muted">${on ? "If Claude can't be reached, your phone reads the receipt instead, so scanning still works offline. You always check the result before saving." : "This is private and free, but it can struggle with crumpled or faded receipts."}</p></div>
      ${on ? `<div class="panel pad"><div class="small muted">Scans with Claude this month</div><div class="strong">${u.scans} · about $${cost.toFixed(2)}</div><p class="small muted" style="margin-top:4px">An estimate from this device. Your Anthropic account shows the real bill.</p></div>` : ""}
      <div class="panel pad" style="display:flex;flex-direction:column;gap:8px"><div class="strong">What using Claude means</div>
        <ul class="small muted" style="margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px">
          <li>Each receipt image is sent to Anthropic, along with today's date and your category names. Your balances, debts and other entries aren't sent.</li>
          <li>You pay Anthropic for each scan, using your own API account. This is separate from a Claude subscription.</li>
          <li>Your key is saved only on this device and isn't included in backups.</li></ul></div>
      ${on ? `<button class="btn danger block" data-a="removeKey">Stop using Claude and remove my key</button>` : `<div class="field"><label for="claudeKey">Anthropic API key</label><input class="inp" id="claudeKey" type="password" autocomplete="off" autocapitalize="off" spellcheck="false" placeholder="sk-ant-…"><span class="hint">Create a key at platform.claude.com. A spending limit on your account is a good idea.</span></div>
      <p class="small" id="keyMsg" role="status"></p><button class="btn primary block" data-a="saveKey">Check key and turn on</button>`}` };
  },
  theme() {
    const cur = themePref(), opt = (v, t, s) => `<button class="opt ${cur === v ? "on" : ""}" data-a="setTheme" data-x="${v}" aria-pressed="${cur === v}"><span class="grow"><b>${t}</b><small>${s}</small></span>${cur === v ? "✓" : ""}</button>`;
    return { title: "Appearance", body: `<div class="opts">${opt("system", "Same as my phone", "Light in the day, dark at night if your phone does that")}${opt("light", "Light", "Pink on white")}${opt("dark", "Dark", "Easier on the eyes at night")}</div>` };
  },
  weekHow() {
    const w = C.weekPlan(S, UI.weekFrom), r = n => money(Math.round(n));
    const item = (t, s, v, sign) => `<div class="row" style="min-height:52px"><span class="grow"><span class="rowt">${esc(t)}</span>${s ? `<br><span class="rows">${s}</span>` : ""}</span><span class="amt">${sign || ""}${r(v)}</span></div>`;
    const group = (title, total, sign, rows, empty) => `<section class="sect"><div class="secthead"><h2>${title}</h2><span class="strong">${sign}${r(total)}</span></div><div class="panel">${rows.length ? rows.join("") : `<div class="empty small">${empty}</div>`}</div></section>`;
    const pay = [
      ...w.entries.filter(e => e.kind === "income").map(e => item(C.entryTitle(S, e), "Received " + fmtDate(e.date, true), C.entPHP(S, e), "+")),
      ...w.pays.filter(p => !p.entry).map(p => item(p.stream.name, (p.status === "late" ? "Expected " + fmtDate(p.date, true) + ", not logged yet" : "Expected " + fmtDate(p.date, true)), p.php, "+"))
    ];
    const bills = [
      ...w.bills.map(x => item(x.bill.name, (x.status === "paid" ? "Paid" : "Due " + fmtDate(x.due, true)), x.php, "−")),
      ...w.ones.map(o => item(o.item.name, (o.entry ? "Paid" : "One-time, " + fmtDate(o.item.date, true)), o.php, "−"))
    ];
    const buds = w.budgets.filter(x => x.limit >= 1 || x.spent).map(x => { const y = budgetWhy(x, w); return `<div class="row" style="align-items:flex-start;padding-block:12px">${catTile(x.budget.category)}<span class="grow"><span class="rowt">${esc(x.budget.name || x.budget.category)}</span><br><span class="rows">${esc(y.how)}</span><br><span class="small strong">${esc(y.now)}</span>${y.note ? `<br><span class="rows">${esc(y.note)}</span>` : ""}</span><span class="amt">−${r(x.plan)}</span></div>`; });
    const bill = new Set(w.bills.filter(x => x.entry).map(x => x.entry.id));
    const others = w.entries.filter(e => C.groupOf(S, e) === "spent" && !e.oneTimeId && !bill.has(e.id) && !(S.budgets || []).some(b => C.inBudget(S, b, e))).map(e => item(C.entryTitle(S, e), fmtDate(e.date, true), C.entPHP(S, e), "−"));
    const debts = w.entries.filter(e => ["debtpay", "lent", "collected"].includes(C.groupOf(S, e)) && !bill.has(e.id)).map(e => item(C.entryTitle(S, e), fmtDate(e.date, true), C.entPHP(S, e), C.groupOf(S, e) === "collected" ? "+" : "−"));
    return { title: fmtDate(w.from) + "–" + fmtDate(w.to), body: `
      <div class="panel pad"><div class="small muted">${w.to < C.today() ? "Left that week" : w.from > C.today() ? "Planned to be left" : "Left this week"}</div><div class="bigline ${w.left < 0 ? "red" : ""}">${r(w.left)}</div><div class="small muted" style="margin-top:4px">${esc(weekSum(w))}</div></div>
      ${w.left < 0 && !w.income ? `<div class="notice info"><span>It's below zero because no pay is expected this week yet. Add your income sources under Settings so paydays count here.</span></div>` : ""}
      ${group("Pay", w.income, "+", pay, "No pay this week. Add income sources in Settings so paydays show up here.")}
      ${group("Bills", w.billsPlan + w.onesPlan, "−", bills, "No bills due this week.")}
      ${group("Budgets", w.budgetPlan, "−", buds, "No budgets set.")}
      ${others.length ? group("Other spending", w.other, "−", others, "") : ""}
      ${debts.length ? group("Debts and lending", w.debtpay + w.lent - w.collected, "−", debts, "") : ""}
      <p class="small muted">Borrowed money isn't counted as pay. Tap any entry in Activity to change it.</p>` };
  },
  trackFrom() { return { title: "Started tracking on", body: `<form class="form" data-save="trackFrom"><p class="muted">Paydays, bills and one-time costs before this date aren't expected, so they won't show as late or count in your plans.</p><div class="field"><label for="tf-btn">Start date</label>${pick("date", "tf", 'name="tf"', S.trackFrom || "", true, "From the beginning")}</div><button class="btn primary" type="submit">Save</button></form>` }; },
  weekStart() { return { title: "Week starts on", body: `<form class="form" data-save="weekStart"><p class="muted">Pick your payday, so each week runs from one pay to the next. Your weekly budgets and Home follow this.</p><div class="field"><label for="ws">First day of the week</label><select class="inp" id="ws" name="ws">${opts(C.WEEKDAYS.map((d, i) => [i, d]), C.weekStartDay(S))}</select></div><button class="btn primary" type="submit">Save</button></form>` }; },
  rate() { return { title: "Dollar rate", body: `<form class="form" data-save="rate"><div class="field"><label for="r-r">Pesos per $1</label><input class="inp" id="r-r" name="rate" inputmode="decimal" value="${esc(S.usdRate || "")}" required></div><p class="hint">Used to value your dollar balances and to fill in new dollar entries. Past payments keep the rate you saved with them.</p><button class="btn primary" type="submit">Save</button></form>` }; },
  backup() {
    const lb = lsGet("mira-last-backup");
    return { title: "Backup and restore", body: `<div class="panel pad" style="display:flex;flex-direction:column;gap:10px"><div class="strong">Back up</div><p class="muted small">Your data is only on this device. Save a backup every week or two, somewhere like Google Drive. Receipt photos aren't included.</p><p class="small">${S.entries.length} entries · last backup: <b>${lb ? fmtDate(lb.slice(0, 10)) : "never"}</b></p><button class="btn primary" data-a="doBackup">Save a backup file</button><button class="btn" data-a="backupText">Copy my data as text</button><p class="hint">Use this to move your data to another phone or browser, or if saving a file doesn't work here.</p></div>
      <div class="panel pad" style="display:flex;flex-direction:column;gap:10px"><div class="strong">Restore</div><p class="muted small">Replaces everything on this device. You can undo it right after.</p><button class="btn" data-a="restore">Choose a backup file</button><button class="btn" data-a="restorePaste">Paste a backup instead</button></div>` };
  },
  copyOut() { return { title: "Your data as text", body: `<p class="small">Copy all of this text. On the other device, open Mira Ledger, go to <b>Settings → Backup and restore → Paste a backup instead</b>, and paste it there.</p>
    <div class="field"><label for="outtext">Backup text (${S.entries.length} entries)</label><textarea class="inp" id="outtext" rows="8" readonly>${esc(JSON.stringify(C.exportBackup(S)))}</textarea></div>
    <button class="btn primary block" data-a="copyBackup">Copy</button><p class="hint">If Copy doesn't work, tap the box, select all, and copy it by hand. To get it onto your phone, paste it into a note or a message to yourself.</p>` }; },
  paste() { return { title: "Paste a backup", body: `<div class="field"><label for="pasted">Backup text</label><textarea class="inp" id="pasted" rows="8" placeholder='Starts with {"app":"Mira Ledger"…'></textarea></div><p class="hint">Open the backup file, select all, copy, then paste it here.</p><button class="btn primary" data-a="pasteRestore">Restore</button>` }; },
  exchange() { return { title: "Exchange and fees", body: `<p>This is the difference from changing dollars to pesos. It comes from withdrawal fees, the rate you got on the day, and changes to your dollar rate setting.</p><p class="muted">It's only money that changed value. Nothing is missing from your entries.</p>` }; },
  search(sh) { return { title: "Search", body: `<input class="inp" id="q" type="search" placeholder="A name, amount, month…" value="${esc(sh.q || "")}" aria-label="Search" data-focus autocomplete="off"><div id="sres" style="display:flex;flex-direction:column;gap:16px">${searchResults(sh.q || "")}</div>` }; }
};
function searchResults(q) {
  if (!q.trim()) return `<p class="muted small">Try "Meralco", "1700" or "loans oct".</p>`;
  const r = C.search(S, q);
  const sect = (t, html) => html ? `<section class="sect"><div class="secthead"><h2>${t}</h2></div><div class="panel">${html}</div></section>` : "";
  const simple = (a, x, t, s) => `<button class="row" data-a="${a}" data-x="${esc(x)}"><span class="grow"><span class="rowt">${esc(t)}</span><br><span class="rows">${s}</span></span><span class="chev">›</span></button>`;
  const none = !r.entries.length && !r.bills.length && !r.debts.length && !r.accounts.length && !r.clients.length;
  return none ? `<p class="muted">Nothing matches "${esc(q)}".</p>` :
    sect(`Entries (${r.entries.length})${r.total ? ` · ${money(r.total)} spent` : ""}`, r.entries.slice(0, 40).map(e => entryRow(e)).join("")) +
    sect("Bills", r.bills.map(b => simple("editBill", b.id, b.name, money(b.amount, C.billCur(S, b)) + " · " + esc(C.scheduleText(b)))).join("")) +
    sect("Debts", r.debts.map(d => simple("debtSheet", d.id, d.name, "You owe " + money(C.debtBalance(S, d)))).join("")) +
    sect("Accounts", r.accounts.map(a => simple("accountSheet", a.id, a.name, money(C.balances(S)[a.id], a.currency))).join("")) +
    sect("Income sources", r.clients.map(x => simple("editClient", x.id, x.name, esc(x.via || ""))).join(""));
}
/* Budgets (allowAny) keep the simple choices. Bills and payment plans also get every 2 weeks, every 3 months, yearly and a last payment date. */
function schedFields(b, allowAny) {
  const f = allowAny && (b.freq === "anytime") ? "anytime" : C.freqOf(b), by = f === "weekly" ? "weekday" : (b.by || "date");
  const extra = !allowAny;
  const choices = [...(allowAny ? [["anytime", "Any time in the month (spread by day)"]] : []), ["weekly", "Every week"], ["biweekly", "Every 2 weeks"], ["twice", "Twice a month"], ["monthly", "Once a month"], ...(extra ? [["quarterly", "Every 3 months"], ["yearly", "Once a year"]] : [])];
  return `<div class="sched" data-freq="${f}" data-by="${by}">
    <div class="field"><label for="s-f">How often</label><select class="inp" id="s-f" name="freq">${opts(choices, f)}</select></div>
    <div class="field s-anchor"><label for="s-a-btn">${extra ? "Next payment date" : "Next shopping day"}</label>${pick("date", "s-a", 'name="anchor"', b.anchor || C.today())}<span class="hint">${extra ? "Later payments follow from this date." : "The budget counts in full on this day, then every 2 weeks after."}</span></div>
    <div class="field s-by"><span class="lbl">Due on</span><div class="chips"><label class="check"><input type="radio" name="by" value="date" ${by === "date" ? "checked" : ""}> A date</label><label class="check"><input type="radio" name="by" value="weekday" ${by === "weekday" ? "checked" : ""}> A day of the week</label></div></div>
    <div class="two s-date"><div class="field"><label for="s-d1">Day of the month</label><input class="inp" id="s-d1" name="dueDay" type="number" min="1" max="31" value="${esc(b.dueDay || 15)}"></div><div class="field s-twice"><label for="s-d2">Second day</label><input class="inp" id="s-d2" name="secondDay" type="number" min="1" max="31" value="${esc(+b.secondDay || 30)}"></div></div>
    <div class="field s-nth s-monthly"><label for="s-n">Which one</label><select class="inp" id="s-n" name="nth">${opts([["1", "1st"], ["2", "2nd"], ["3", "3rd"], ["4", "4th"], ["5", "Last"]], b.nth || 1)}</select></div>
    <div class="field s-nth s-twice"><label for="s-ns">Which ones</label><select class="inp" id="s-ns" name="nths">${opts([["1,3", "1st & 3rd"], ["2,4", "2nd & 4th"]], (b.nths || [1, 3]).join(","))}</select></div>
    <div class="field s-wd"><label for="s-w">Day of the week</label><select class="inp" id="s-w" name="weekday">${opts(C.WEEKDAYS.map((w, i) => [i, w]), b.weekday ?? 5)}</select></div>
    ${extra ? `<div class="field s-until"><label for="s-u-btn">Last payment <span style="font-weight:400">(optional)</span></label>${pick("date", "s-u", 'name="until"', b.until || "", true, "No end date")}<span class="hint">For loans or plans that end. Leave empty if it keeps going.</span></div>` : ""}
  </div>`;
}
function parseSched(fd) {
  const freq = ["monthly", "twice", "weekly", "biweekly", "quarterly", "yearly"].includes(fd.freq) ? fd.freq : "monthly", dated = ["biweekly", "quarterly", "yearly"].includes(freq);
  const by = freq === "weekly" ? "weekday" : dated ? "date" : (fd.by === "weekday" ? "weekday" : "date");
  const cl = v => Math.min(31, Math.max(1, parseInt(v) || 1)), isDate = v => /^\d{4}-\d{2}-\d{2}$/.test(v || "");
  const out = { freq, by, dueDay: cl(fd.dueDay), secondDay: freq === "twice" && by === "date" ? cl(fd.secondDay || 30) : 0, weekday: Math.min(6, Math.max(0, parseInt(fd.weekday) || 0)), nth: Math.min(5, Math.max(1, parseInt(fd.nth) || 1)), nths: String(fd.nths || "1,3").split(",").map(Number), until: isDate(fd.until) ? fd.until : "" };
  if (dated) { out.anchor = isDate(fd.anchor) ? fd.anchor : C.today(); out.dueDay = +out.anchor.slice(8); }
  return out;
}

/* ---------- drawing ---------- */
function renderNav() {
  const item = (t, label, ic) => `<button class="${UI.tab === t ? "on" : ""}" data-a="tab" data-x="${t}" ${UI.tab === t ? 'aria-current="page"' : ""}>${ic}${label}</button>`;
  $("#nav").hidden = !S;
  $("#nav").innerHTML = `<div class="in-nav">${item("home", "Home", ICON.home)}${item("activity", "Activity", ICON.list)}<button class="plus" data-a="add" aria-label="Add an entry"><span>${ICON.plus}</span></button>${item("plan", "Plan", ICON.plan)}${item("debts", "Debts", ICON.debt)}</div>`;
}
function render() {
  if (S && !UI.weekFrom) { UI.period = lsGet("mira-period") || "week"; UI.weekFrom = C.weekOf(S, C.today()).from; }
  renderNav();
  const v = $("#view");
  if (!S) v.innerHTML = viewWelcome();
  else v.innerHTML = ({ home: viewHome, activity: viewActivity, plan: viewPlan, debts: viewDebts, add: viewAdd }[UI.tab] || viewHome)();
  renderSheet();
}
function renderSheet() {
  const host = $("#sheet"), sh = UI.sheets[UI.sheets.length - 1];
  document.body.classList.toggle("locked", !!sh);
  if (!sh) { host.innerHTML = ""; loadReceiptImage(); return; }
  const old = host.querySelector(".sheetbody"), keep = old ? old.scrollTop : 0, sameKey = host.dataset.key === String(UI.sheets.length) + sh.type;
  const c = SHEETS[sh.type](sh);
  host.innerHTML = `<div class="scrim"></div><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(c.title)}"><div class="sheethead"><button class="iconbtn" data-a="closeSheet" aria-label="Back">${ICON.back}</button><h2>${esc(c.title)}</h2></div><div class="sheetbody">${c.body}</div>${c.foot ? `<div class="sheetfoot">${c.foot}</div>` : ""}</div>`;
  host.dataset.key = String(UI.sheets.length) + sh.type;
  if (sameKey) host.querySelector(".sheetbody").scrollTop = keep;
  else { const f = host.querySelector("[data-focus]"); if (f) setTimeout(() => f.focus(), 40); }
  loadReceiptImage();
}
let shownReceipt = null;
async function loadReceiptImage() {
  const img = $("#receiptImg"), d = DRAFT();
  if (!img || !d || !d.receiptId) return;
  try { const b = await RDB.get(d.receiptId); if (b && $("#receiptImg")) { if (shownReceipt) URL.revokeObjectURL(shownReceipt); shownReceipt = URL.createObjectURL(b); $("#receiptImg").src = shownReceipt; } } catch (e) { /* the entry still works without its photo */ }
}
function refreshEffect() {
  const d = DRAFT(), e = $("#effect");
  if (!d) return;
  if (e) { const ef = effectText(d); e.textContent = ef.text; e.className = "effect" + (ef.bad ? " bad" : ""); }
  const p = $("#f-php");
  if (p) p.textContent = d.rate ? "In pesos: " + money((amtOf(d) || 0) * (+d.rate || 0)) : "Enter a rate to count this in your peso totals.";
  const c = $("#f-calc");
  if (c) c.textContent = calcText(d);
}

/* ---------- receipts ---------- */
const KEY_CLAUDE = "mira-claude-key", KEY_USAGE = "mira-claude-usage";
const claudeKey = () => window.MIRA_DEMO ? "" : (lsGet(KEY_CLAUDE) || "");
function usageNow() {
  const m = C.today().slice(0, 7);
  try { const u = JSON.parse(lsGet(KEY_USAGE) || "null"); if (u && u.month === m) return u; } catch (e) {}
  return { month: m, scans: 0, input: 0, output: 0 };
}
function noteUsage(u) {
  const x = usageNow();
  x.scans += 1; x.input += (u && u.input_tokens) || 0; x.output += (u && u.output_tokens) || 0;
  lsSet(KEY_USAGE, JSON.stringify(x));
}
function applyClaudeReading(d, r) {
  d.scan = { by: "claude", ok: r.amount !== null, candidates: r.candidates, noDate: !r.date, warning: r.warning, notReceipt: !r.isReceipt, currency: r.currency };
  if (r.amount !== null) d.amount = String(r.amount);
  if (r.date) d.date = r.date;
  if (r.merchant) d.note = r.merchant;
  /* What you chose for this store before beats Claude's guess. */
  d.category = C.suggestCategory(S, r.merchant) || r.category || "";
  if (d.category && !C.catsOf(S, "personal").includes(d.category) && C.catsOf(S, "business").includes(d.category)) d.scope = "business";
}
let ocrWorker = null;
async function getOcr(onProgress) {
  if (!window.Tesseract) await new Promise((res, rej) => { const s = document.createElement("script"); s.src = "vendor/ocr/tesseract.min.js"; s.onload = res; s.onerror = () => rej(new Error("reader")); document.head.appendChild(s); });
  if (!ocrWorker) ocrWorker = await Tesseract.createWorker("eng", 1, { workerPath: new URL("vendor/ocr/worker.min.js", location.href).href, corePath: new URL("vendor/ocr/", location.href).href, langPath: new URL("vendor/ocr", location.href).href, gzip: true, logger: onProgress });
  return ocrWorker;
}
function shrink(img, max, type, q, gray) {
  const k = Math.min(1, max / Math.max(img.width, img.height)), c = document.createElement("canvas");
  c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  const x = c.getContext("2d"); if (gray) x.filter = "grayscale(1) contrast(1.25)";
  x.drawImage(img, 0, 0, c.width, c.height);
  return new Promise(res => c.toBlob(res, type, q));
}
async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try { return await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; }); } finally { setTimeout(() => URL.revokeObjectURL(url), 30000); }
}
function setScan(msg, pct) {
  if (!UI.wiz || UI.wiz.step !== "scanning") return;
  UI.wiz.msg = msg; if (pct !== undefined) UI.wiz.pct = pct;
  const m = $("#scanMsg"), b = $(".progress i");
  if (m) m.textContent = msg; if (b && pct !== undefined) b.style.width = pct + "%";
}
async function runScan(file) {
  const from = UI.tab === "add" ? (UI.wiz && UI.wiz.from) || "home" : UI.tab;
  const key = claudeKey(), viaClaude = !!key && navigator.onLine !== false;
  UI.tab = "add"; UI.wiz = { d: newDraft({ kind: "expense" }), step: "scanning", msg: "Opening your image…", pct: 5, from, viaClaude };
  render();
  const d = UI.wiz.d;
  d.scan = { ok: false, candidates: [] };
  try {
    const img = await loadImage(file);
    try { const small = await shrink(img, 1100, "image/jpeg", 0.65); const id = "r" + C.uid(); await RDB.put(id, small); d.receiptId = id; } catch (e) { /* no saved photo, but the scan can continue */ }
    if (viaClaude) {
      try {
        setScan("Claude is reading your receipt…", 40);
        const m = await import("./claude.js");
        const cats = C.allCategories(S);
        const out = await m.readReceipt(key, await shrink(img, 1800, "image/jpeg", 0.8), cats, C.today());
        noteUsage(out.usage);
        const r = C.cleanClaudeReceipt(out.data, cats);
        if (UI.wiz && UI.wiz.d === d) applyClaudeReading(d, r);
        if (UI.wiz && UI.wiz.d === d) { UI.wiz.step = "review"; render(); window.scrollTo(0, 0); }
        return;
      } catch (err) {
        toast((err && err.reason || "Claude couldn't read it") + ", so your phone read it instead.");
        const note = $("#scanNote"); if (note) note.textContent = "Reading it on your phone instead. It isn't uploaded.";
      }
    }
    setScan("Getting the receipt reader ready. The first time needs internet and takes a little longer.", 12);
    const worker = await getOcr(m => { if (m.status === "recognizing text") setScan("Reading the text…", 35 + Math.round(m.progress * 60)); else if (m.status && m.progress !== undefined) setScan("Getting the receipt reader ready. The first time needs internet and takes a little longer.", 12 + Math.round(m.progress * 20)); });
    const ready = await shrink(img, 2000, "image/png", 1, true);
    const { data } = await worker.recognize(ready);
    let text = data.text, r = C.parseReceipt(text);
    if (r.amount === null) {
      /* Banking apps show the amount as big, isolated text, which the normal page reading can skip. */
      setScan("Looking again for the amount…", 90);
      await worker.setParameters({ tessedit_pageseg_mode: "11" });
      const again = await worker.recognize(ready);
      await worker.setParameters({ tessedit_pageseg_mode: "3" });
      text += "\n" + again.data.text;
      r = C.parseReceipt(text);
    }
    d.scan = { ok: r.amount !== null, candidates: r.candidates, noDate: !r.date };
    if (r.amount !== null) d.amount = String(r.amount);
    if (r.date) d.date = r.date;
    if (r.merchant) d.note = r.merchant;
    d.category = C.suggestCategory(S, r.merchant) || "";
  } catch (err) {
    d.scan = { ok: false, candidates: [] };
    toast(navigator.onLine === false ? "The receipt reader needs internet the first time. You can type it in instead." : "Couldn't read that image. You can type it in instead.");
  }
  if (UI.wiz && UI.wiz.d === d) { UI.wiz.step = "review"; render(); window.scrollTo(0, 0); }
}

/* ---------- backup ---------- */
async function doBackup() {
  const name = "mira-ledger-backup-" + C.today() + ".json", text = JSON.stringify(C.exportBackup(S), null, 1), file = new File([text], name, { type: "application/json" });
  const done = () => { lsSet("mira-last-backup", new Date().toISOString()); render(); toast("Backup saved. Keep it somewhere safe, like Google Drive."); };
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); done(); return; } catch (e) { if (e && e.name === "AbortError") return; }
  }
  const a = document.createElement("a"); a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  done();
}
function applyRestore(obj) {
  const prev = S ? JSON.stringify(S) : null, next = C.importBackup(obj);
  S = next; save(); UI.sheets = []; UI.tab = "home"; render();
  const n = S.entries.length;
  toast(`Restored ${n} ${n === 1 ? "entry" : "entries"}`, prev ? () => { S = JSON.parse(prev); save(); render(); toast("Undone"); } : null);
  if (accounts().length) openSheet({ type: "check" });
}
const num = v => { const n = parseFloat(String(v).replace(/,/g, "")); return isFinite(n) ? n : null; };

/* ---------- actions ---------- */
const A = {
  tab(x) { UI.tab = x; UI.wiz = null; UI.sheets = []; render(); window.scrollTo(0, 0); },
  add() { const from = UI.tab === "add" ? "home" : UI.tab; wizStart(); UI.wiz.from = from; UI.sheets = []; render(); window.scrollTo(0, 0); },
  month(x) { UI.month = C.addMonth(UI.month, +x); render(); },
  period(x) { UI.period = x; lsSet("mira-period", x); UI.weekFrom = C.weekOf(S, C.today()).from; render(); },
  wk(x) { UI.weekFrom = C.addDays(UI.weekFrom, 7 * +x); render(); },
  wkNow() { UI.weekFrom = C.weekOf(S, C.today()).from; render(); },
  showWeek(x) { UI.tab = "home"; UI.period = "week"; UI.weekFrom = x; render(); window.scrollTo(0, 0); },
  planTab(x) { UI.tab = "plan"; UI.planMode = x; UI.month = UI.weekFrom ? UI.weekFrom.slice(0, 7) : UI.month; render(); window.scrollTo(0, 0); },
  openDay(d) { openSheet({ type: "list", title: fmtDate(d, true), get: () => S.entries.filter(e => e.date === d) }); },
  weekList(kind) {
    const from = UI.weekFrom, to = C.addDays(from, 6), inR = e => e.date >= from && e.date <= to;
    const w = C.weekPlan(S, from), billIds = new Set(w.bills.filter(x => x.entry).map(x => x.entry.id));
    const pick = { in: e => e.kind === "income", debt: e => C.groupOf(S, e) === "debtpay" && !billIds.has(e.id),
      lent: e => e.kind === "lend" || e.kind === "collect", other: e => C.groupOf(S, e) === "spent" && !e.oneTimeId && !billIds.has(e.id) && !(S.budgets || []).some(b => C.inBudget(S, b, e)) }[kind];
    const title = { in: "Pay this week", debt: "Debt payments this week", lent: "Lending this week", other: "Other spending this week" }[kind];
    openSheet({ type: "list", title, note: kind === "in" && w.expected ? `${money(Math.round(w.expected))} more is expected from paydays you haven't logged yet.` : kind === "other" ? "Spending that isn't a bill and doesn't belong to a budget." : "", get: () => S.entries.filter(e => inR(e) && pick(e)) });
  },
  weekStartSheet() { openSheet({ type: "weekStart" }); },
  themeSheet() { openSheet({ type: "theme" }); },
  toggleTheme() { lsSet("mira-theme", isDark() ? "light" : "dark"); applyTheme(); toast(isDark() ? "Dark mode" : "Light mode"); },
  setTheme(x) { if (x === "system") { try { localStorage.removeItem("mira-theme"); } catch (e) {} } else lsSet("mira-theme", x); applyTheme(); renderSheet(); },
  closeSheet,
  openPicker(x) {
    const [id, kind, opt, ph] = x.split("|"), v = ($("#" + id) || {}).value || "";
    PK = { id, kind, optional: opt === "1", ph, view: (/^\d{4}-\d{2}/.test(v) ? v : C.today()).slice(0, 7), year: +((/^\d{4}/.test(v) ? v : C.today()).slice(0, 4)), current: v, title: kind === "icon" ? "Choose an icon" : "" };
    drawPicker();
  },
  pkNav(x) { if (PK.kind === "month") PK.year += +x; else PK.view = C.addMonth(PK.view, +x); drawPicker(); },
  pkSet(v) { pickerChose(v); },
  pkClose() { PK = null; drawPicker(); },
  pkOwn() { const v = cleanIcon(($("#pk-own") || {}).value); if (!v) { toast("Type or paste an emoji first."); return; } pickerChose(v); },
  catIconPick(c) {
    PK = { kind: "icon", optional: true, current: catIcon(c), title: "Icon for " + c, onPick: v => commit(s => { const m = { ...(s.catIcons || {}) }; if (v) m[c] = v; else delete m[c]; s.catIcons = m; }, v ? "Icon changed" : "Default icon restored") };
    drawPicker();
  },
  actMode(x) { UI.actMode = x; render(); },
  actFilter(x) { UI.actFilter = x; render(); },
  scope(x) { UI.scope = x; render(); },
  planMode(x) { UI.planMode = x; render(); },
  search() { openSheet({ type: "search", q: "" }); },
  settings() { openSheet({ type: "settings" }); },
  accounts() { openSheet({ type: "accounts" }); },
  accountSheet(x) { openSheet({ type: "account", id: x }); },
  fixAccount(x) { openSheet({ type: "fixAccount", id: x }); },
  fixDebt(x) { openSheet({ type: "fixDebt", id: x }); },
  check() { openSheet({ type: "check" }); },
  debtSheet(x) { openSheet({ type: "debt", id: x }); },
  forecast() { openSheet({ type: "forecast" }); },
  monthSummary(x) { openSheet({ type: "summary", month: x }); },
  explainExchange() { openSheet({ type: "exchange" }); },
  backup() { openSheet({ type: "backup" }); },
  doBackup,
  clients() { openSheet({ type: "clients" }); },
  categories() { openSheet({ type: "categories" }); },
  catScope(x) { UI.sheets[UI.sheets.length - 1].scope = x; renderSheet(); },
  rateSheet() { openSheet({ type: "rate" }); },
  readerSheet() { openSheet({ type: "reader" }); },
  async saveKey() {
    const key = ($("#claudeKey").value || "").trim(), say = t => { const m = $("#keyMsg"); if (m) m.textContent = t; };
    if (!key) { say("Paste your key first."); return; }
    say("Checking your key…");
    try {
      const m = await import("./claude.js"), r = await m.checkKey(key);
      if (!r.ok) { say(r.reason + ". Your key wasn't saved."); return; }
      lsSet(KEY_CLAUDE, key); renderSheet(); toast("Claude will read your receipts from now on.");
    } catch (e) { say("Couldn't check your key. Your key wasn't saved."); }
  },
  removeKey() { try { localStorage.removeItem(KEY_CLAUDE); } catch (e) {} renderSheet(); toast("Key removed. Your phone will read receipts."); },
  editAccount(x) { openSheet({ type: "editAccount", id: x }); },
  editClient(x) { openSheet({ type: "editClient", id: x }); },
  editBill(x) { openSheet({ type: "editBill", id: x }); },
  billsList() { openSheet({ type: "billsList" }); },
  billSheet(x) { openSheet({ type: "bill", x }); },
  editBudget(x) { openSheet({ type: "editBudget", id: x }); },
  editOne(x) { openSheet({ type: "editOne", id: x }); },
  editDebt(x) { openSheet({ type: "editDebt", id: x, dir: x === "new" ? "" : (C.debt(S, x) || {}).dir }); },
  eraseAsk() { openSheet({ type: "erase" }); },
  erase() { S = null; try { localStorage.removeItem(KEY); localStorage.removeItem("mira-last-backup"); localStorage.removeItem(KEY_CLAUDE); localStorage.removeItem(KEY_USAGE); } catch (e) {} UI.sheets = []; UI.tab = "home"; render(); toast("Everything was erased from this device."); },
  openGroup(x) { const [m, g] = x.split("|"); const upto = C.today(); openSheet({ type: "list", title: C.GROUP_LABEL[g] + " in " + monthName(m, true), note: g === "borrowed" ? "Borrowed money goes into your account and adds to what you owe. It's not counted as income." : g === "debtpay" ? "These lower what you owe. They're counted apart from spending." : "", get: () => C.inMonth(S, m).filter(e => C.groupOf(S, e) === g && e.date <= upto) }); },
  openCat(c) { const m = UI.month, sc = UI.scope; openSheet({ type: "list", title: c, get: () => C.categorySpend(S, m, sc).filter(x => x.category === c).flatMap(x => x.entries) }); },
  openClient(id) { const m = UI.month; openSheet({ type: "list", title: (C.stream(S, id) || {}).name || "Other income", get: () => C.inMonth(S, m).filter(e => e.kind === "income" && (e.streamId || "other") === id) }); },
  openWeek(x) { const [a, b] = x.split("|"); openSheet({ type: "list", title: fmtDate(a) + "–" + fmtDate(b), get: () => S.entries.filter(e => e.date >= a && e.date <= b && e.kind !== "transfer") }); },
  editEntry(id) { const e = S.entries.find(x => x.id === id); if (e) openSheet({ type: "entry", d: draftFromEntry(e) }); },
  setKind(k) { const d = DRAFT(); if (d.kind === k) return; { const cur = C.debt(S, d.debtId), wantTheirs = k === "lend" || k === "collect"; if (cur && C.isOwedToYou(cur) !== wantTheirs) d.debtId = ""; } if (k === "expense" || k === "income" || k === "transfer") d.debtId = ""; if (k !== "bill") { d.billId = ""; } if (k === "bill" && !d.billMonth) d.billMonth = d.date.slice(0, 7); if (k === "expense" && !d.scope) d.scope = "personal"; d.kind = k; renderDraft(); },
  setDraft(x) { const i = x.indexOf("|"), f = x.slice(0, i), v = x.slice(i + 1), d = DRAFT(); d[f] = v; if (f === "accountId") { const a = C.acct(S, v); d.currency = a ? a.currency : "PHP"; } renderDraft(); },
  formScope(x) { const d = DRAFT(); d.scope = x; if (d.category && !C.catsOf(S, x).includes(d.category)) d.category = ""; renderDraft(); },
  saveEntry() {
    const sh = UI.sheets[UI.sheets.length - 1], r = finalizeDraft(sh.d);
    if (r.error) { toast(r.error); return; }
    UI.sheets.pop();
    commit(s => storeEntry(s, r), savedMsg(r.entry));
  },
  deleteEntry(id) { UI.sheets.pop(); commit(s => { s.entries = s.entries.filter(e => e.id !== id); }, "Entry deleted"); },
  /* wizard */
  wizBack, pickKind(k) { const w = UI.wiz; w.d.kind = k; if (k === "bill") w.d.billMonth = C.today().slice(0, 7); wizNext(); },
  wizScope(x) { UI.wiz.d.scope = x; render(); },
  pickCat(c) { const d = UI.wiz.d; d.category = c; const items = (S.budgets || []).filter(b => b.category === c); if (items.length === 1) d.budgetId = items[0].id; wizNext(); },
  pickItem(x) { UI.wiz.d.budgetId = x; wizNext(); },
  pickAcct(x) { const d = UI.wiz.d; d.accountId = x; d.currency = C.acct(S, x).currency; wizNext(); },
  pickTo(x) { UI.wiz.d.toAccountId = x; wizNext(); },
  pickStream(x) { const d = UI.wiz.d; d.streamId = x; d.fixedAccount = false; if (x === "other") { d.source = ""; } else { const st = C.stream(S, x); if (st.accountId && C.acct(S, st.accountId)) { d.accountId = st.accountId; d.fixedAccount = true; d.currency = C.acct(S, st.accountId).currency; } const usual = C.streamAmount(st, d.date || C.today()); if (usual) { d.amount = String(usual); d.usualHint = money(usual, st.currency); } } wizNext(); },
  switchBorrow() { const w = UI.wiz; w.d.kind = "borrow"; w.d.streamId = ""; w.step = "lender"; render(); },
  pickLender(x) { UI.wiz.d.debtId = x; wizNext(); },
  pickNewLender() { const d = UI.wiz.d; if (!(d.newDebtName || "").trim()) { toast("Type their name first."); return; } d.debtId = "new"; wizNext(); },
  pickDebt(x) { UI.wiz.d.debtId = x; const b = (S.bills || []).find(y => y.debtId === x); if (b) { d0(UI.wiz.d, b); } wizNext(); },
  pickBill(x) { fillBill(UI.wiz.d, x); wizNext(); },
  amountNext() { const d = UI.wiz.d, v = C.evalAmount(d.amount); if (!(v > 0)) { toast(v === null && d.amount ? "Check the amount. It should be a number or a sum like 120+80." : "Enter an amount above zero."); return; } d.amount = String(v); wizNext(); },
  op(o) {
    const d = DRAFT(), inp = $("#f-amt");
    if (!d || !inp) return;
    const sym = { "−": "-", "×": "×", "÷": "÷", "+": "+" }[o] || o;
    d.amount = String(d.amount || "").replace(/[+\-×÷*/]$/, "") + sym;
    inp.value = d.amount; inp.focus(); refreshEffect();
  },
  copyEntry(id) {
    const e = S.entries.find(x => x.id === id); if (!e) return;
    const d = draftFromEntry(e);
    delete d.id; delete d.createdAt; delete d.receiptId; delete d.billMonth; delete d.billSlot; delete d.oneTimeId;
    if (d.kind === "bill") d.billMonth = C.today().slice(0, 7);
    d.date = C.today();
    UI.sheets.pop();
    openSheet({ type: "entry", title: "Log this again", d });
  },
  wizSave() {
    const r = finalizeDraft(UI.wiz.d);
    if (r.error) { toast(r.error); return; }
    const prev = JSON.stringify(S);
    storeEntry(S, r); save();
    UI.wiz = { step: "done", d: {}, entry: r.entry, from: UI.wiz.from };
    render(); window.scrollTo(0, 0);
    void prev;
  },
  wizAgain() { const from = UI.wiz.from; wizStart(); UI.wiz.from = from; render(); },
  wizDone() { const from = UI.wiz.from || "home"; UI.wiz = null; UI.tab = from === "add" ? "home" : from; render(); window.scrollTo(0, 0); },
  scan() { $("#receiptFile").value = ""; $("#receiptFile").click(); },
  /* shortcuts */
  payBill(x) { const d = newDraft({ kind: "bill" }); fillBill(d, x); UI.sheets = UI.sheets.filter(s => s.type !== "bill"); openSheet({ type: "entry", title: "Pay " + C.bill(S, d.billId).name, d }); },
  skipBill(x) { UI.sheets = UI.sheets.filter(s => s.type !== "bill"); commit(s => { s.skips = { ...(s.skips || {}), [x]: true }; }, "Removed for this month. Nothing was logged."); },
  unskip(x) { commit(s => { const k = { ...(s.skips || {}) }; delete k[x]; s.skips = k; }, "Back on the list"); },
  payOne(x) { const o = S.oneTime.find(y => y.id === x); openSheet({ type: "entry", title: "Pay " + o.name, d: newDraft({ kind: "expense", amount: String(o.amount || ""), category: o.category || "Other", accountId: o.accountId || "", note: o.name, oneTimeId: o.id, scope: "personal" }) }); },
  logPay(x) { const [id, date] = x.split("|"), st = C.stream(S, id); openSheet({ type: "entry", title: "Log " + st.name, d: newDraft({ kind: "income", streamId: id, amount: String(C.streamAmount(st, date) || ""), accountId: st.accountId || "", date: date > C.today() ? C.today() : date, scope: "business" }) }); },
  logBudget(x) { const b = S.budgets.find(y => y.id === x), scope = C.catsOf(S, "business").includes(b.category) && !C.catsOf(S, "personal").includes(b.category) ? "business" : "personal"; openSheet({ type: "entry", title: "Log " + (b.name || b.category), d: newDraft({ kind: "expense", category: b.category, budgetId: b.id, note: b.name || "", scope }) }); },
  payDebt(x) { const b = (S.bills || []).find(y => y.debtId === x), d = newDraft({ kind: "debt", debtId: x }); if (b) d0(d, b); openSheet({ type: "entry", title: "Paid " + C.debt(S, x).name, d }); },
  newLoan() { openSheet({ type: "editDebt", id: "new", dir: "owed" }); },
  toggleReturned(id) { const d = C.debt(S, id); commit(s => { s.debts = s.debts.map(x => x.id === id ? { ...x, settled: !x.settled } : x); }, d.settled ? "Marked as not returned" : "Marked as returned"); },
  collectDebt(x) { openSheet({ type: "entry", title: C.debt(S, x).name + " paid me back", d: newDraft({ kind: "collect", debtId: x }) }); },
  lendMore(x) { openSheet({ type: "entry", title: "Lent to " + C.debt(S, x).name, d: newDraft({ kind: "lend", debtId: x }) }); },
  switchCollect() { const w = UI.wiz; w.d.kind = "collect"; w.d.streamId = ""; w.step = "payer"; render(); },
  pickLendee(x) { UI.wiz.d.debtId = x; wizNext(); },
  pickNewLendee() { const d = UI.wiz.d; if (!(d.newDebtName || "").trim()) { toast("Type their name first."); return; } d.debtId = "new"; wizNext(); },
  pickPayer(x) { UI.wiz.d.debtId = x; wizNext(); },
  borrowMore(x) { openSheet({ type: "entry", title: "Borrowed from " + C.debt(S, x).name, d: newDraft({ kind: "borrow", debtId: x }) }); },
  deleteThing(x) { const [k, id] = x.split("|"); UI.sheets.pop(); if (k === "bills") UI.sheets = UI.sheets.filter(s => s.type !== "bill"); commit(s => { s[k] = (s[k] || []).filter(y => y.id !== id); }, "Removed"); },
  deleteDebt(id) { UI.sheets.pop(); UI.sheets = UI.sheets.filter(s => s.type !== "debt"); commit(s => { s.debts = s.debts.filter(d => d.id !== id); s.bills = (s.bills || []).map(b => b.debtId === id ? { ...b, debtId: "" } : b); }, "Debt removed"); },
  archiveAccount(id) { UI.sheets.pop(); UI.sheets = UI.sheets.filter(s => s.type !== "account"); commit(s => { s.accounts = s.accounts.map(a => a.id === id ? { ...a, archived: true } : a); }, "Account hidden. Its history stays."); },
  delCat(c) { const sc = UI.sheets[UI.sheets.length - 1].scope || "personal"; commit(s => { s.categories[sc] = s.categories[sc].filter(x => x !== c); }, "Category removed"); },
  /* welcome */
  welcome() { A.eraseAsk(); },
  /* Starting fresh: nothing before today is expected, so earlier paydays and bills don't show as late. */
  startEmpty() { S = C.emptyState(); S.trackFrom = C.today(); save(); UI.tab = "home"; render(); },
  trackSheet() { openSheet({ type: "trackFrom" }); },
  weekHow() { openSheet({ type: "weekHow" }); },
  useSample() { S = C.sampleState(); S.sample = true; save(); UI.tab = "home"; render(); },
  importOld() { try { applyRestore(JSON.parse(lsGet(OLD_KEY))); } catch (e) { toast("Couldn't read the old data. Try restoring a backup file."); } },
  restore() { const f = $("#restoreFile"); f.value = ""; f.click(); },
  restorePaste() { openSheet({ type: "paste" }); },
  backupText() { openSheet({ type: "copyOut" }); },
  async copyBackup() {
    const ta = $("#outtext"); if (!ta) return;
    const ok = () => { lsSet("mira-last-backup", new Date().toISOString()); toast("Copied. Now paste it on your phone."); };
    try { await navigator.clipboard.writeText(ta.value); ok(); return; } catch (e) {}
    ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length);
    try { if (document.execCommand("copy")) { ok(); return; } } catch (e) {}
    toast("Copy is blocked here. The text is selected, so copy it by hand.");
  },
  pasteRestore() { try { applyRestore(JSON.parse($("#pasted").value)); } catch (e) { toast("That isn't a Mira Ledger backup. Copy the whole file."); } }
};
function d0(d, b) { d.amount = String(b.amount || ""); d.accountId = b.accountId || d.accountId; d.usualHint = money(b.amount, C.billCur(S, b)); }
function fillBill(d, x) {
  const [id, m, slot] = x.split("|"), b = C.bill(S, id);
  Object.assign(d, { kind: "bill", billId: id, billMonth: m, billSlot: +slot, amount: b.amount ? String(b.amount) : "", accountId: b.accountId || "", usualHint: b.amount ? money(b.amount, C.billCur(S, b)) : "" });
}
const savedMsg = e => { const a = C.acct(S, e.accountId); if (!a) return "Saved"; const after = { ...S, entries: [...S.entries.filter(y => y.id !== e.id), e] }; return `Saved. ${a.name} is now ${money(C.balances(after)[a.id], a.currency)}.`; };
function renderDraft() { if (UI.sheets.length) renderSheet(); else render(); }

/* ---------- saving forms ---------- */
const SAVE = {
  account(fd, id) {
    const x = { id: id === "new" ? C.uid() : id, name: fd.name.trim(), type: fd.type, currency: fd.currency, start: num(fd.start) || 0, icon: cleanIcon(fd.icon) };
    UI.sheets.pop();
    commit(s => { if (id === "new") s.accounts = [...(s.accounts || []), x]; else s.accounts = s.accounts.map(a => a.id === id ? { ...a, ...x } : a); }, "Account saved");
  },
  client(fd, id) {
    const changes = [];
    for (let i = 0; ("rf" + i) in fd; i++) { const a = num(fd["ra" + i]); if (/^\d{4}-\d{2}-\d{2}$/.test(fd["rf" + i] || "") && a > 0) changes.push({ from: fd["rf" + i], amount: a }); }
    const x = { id: id === "new" ? C.uid() : id, name: fd.name.trim(), via: fd.via.trim(), expected: num(fd.expected) || 0, currency: fd.currency, freq: fd.freq, anchor: fd.anchor, accountId: fd.accountId, archived: !!fd.archived, changes: changes.sort((a, b) => a.from.localeCompare(b.from)), endMode: "", until: "" };
    if (fd.endMode === "date") {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(fd.until || "")) { toast("Choose the last payday, or pick “It keeps going”."); return; }
      x.endMode = "date"; x.until = fd.until;
    } else if (fd.endMode === "count") {
      const n = Math.floor(+fd.left);
      if (!(n >= 0) || fd.left === "") { toast("Enter how many payments are left."); return; }
      if (!x.freq || x.freq === "none") { toast("Choose how often they pay first, so the last payday can be worked out."); return; }
      if (n === 0) x.until = C.addDays(C.today(), -1);
      else { const ds = C.nextPaydays(x, C.today(), n); if (ds.length < n) { toast("Choose a payday above so the payments can be counted."); return; } x.until = ds[n - 1]; }
      x.endMode = "count";
    }
    UI.sheets.pop();
    commit(s => { if (id === "new") s.streams = [...(s.streams || []), x]; else s.streams = s.streams.map(y => y.id === id ? x : y); }, "Saved");
  },
  bill(fd, id) {
    const x = { id: id === "new" ? C.uid() : id, name: fd.name.trim(), amount: num(fd.amount) || 0, variable: !!fd.variable, ...parseSched(fd), accountId: fd.accountId, category: fd.debtId ? "Loans" : fd.category, scope: (C.catsOf(S, "business").includes(fd.category) && !C.catsOf(S, "personal").includes(fd.category)) ? "business" : "personal", debtId: fd.debtId, startMonth: fd.startMonth };
    if (id === "new") x.since = C.today(); else { const old = C.bill(S, id); if (old.since) x.since = old.since; }
    UI.sheets.pop();
    commit(s => { if (id === "new") s.bills = [...(s.bills || []), x]; else s.bills = s.bills.map(b => b.id === id ? x : b); }, "Bill saved");
  },
  budget(fd, id) {
    const sc = fd.freq === "anytime" ? { freq: "anytime" } : parseSched(fd), x = { id: id === "new" ? C.uid() : id, name: fd.name.trim(), category: fd.category, amount: num(fd.amount) || 0, note: fd.note.trim(), ...sc };
    UI.sheets.pop();
    commit(s => { if (id === "new") s.budgets = [...(s.budgets || []), x]; else s.budgets = s.budgets.map(b => b.id === id ? x : b); }, "Budget saved");
  },
  one(fd, id) {
    const x = { id: id === "new" ? C.uid() : id, name: fd.name.trim(), amount: num(fd.amount) || 0, date: fd.date, category: fd.category, accountId: fd.accountId };
    UI.sheets.pop();
    commit(s => { if (id === "new") s.oneTime = [...(s.oneTime || []), x]; else s.oneTime = s.oneTime.map(o => o.id === id ? x : o); }, "Saved");
  },
  debt(fd, id) {
    const isNew = id === "new", did = isNew ? C.uid() : id, owedToYou = fd.dir === "owed", old = isNew ? null : C.debt(S, id);
    const kind = ["money", "credit", "thing"].includes(fd.dkind) ? fd.dkind : (old && old.kind) || "money";
    const name = (fd.name || "").trim(), item = (fd.item || "").trim(), note = (fd.note || "").trim();
    if (!name) { toast(owedToYou ? "Say who has it." : "Say who you owe."); return; }
    const extra = { kind, item: kind === "money" ? "" : item, note: kind === "thing" ? note : "", ...(owedToYou ? { dir: "owed" } : {}) };
    if (kind === "thing") {
      if (!item) { toast("Say what the item is."); return; }
      UI.sheets.pop();
      commit(s => {
        if (isNew) s.debts = [...(s.debts || []), { id: did, name, opening: 0, startDate: C.today(), ...extra }];
        else s.debts = s.debts.map(d => d.id === id ? { ...d, name, ...extra, opening: 0 } : d);
      }, "Saved");
      return;
    }
    const owed = num(isNew ? fd.owed : fd.opening);
    if (owed === null || owed < 0) { toast("Enter how much is owed."); return; }
    const fresh = isNew && kind === "money" && fd.fresh === "new";
    if (fresh && !fd.freshAccount) { toast(owedToYou ? "Choose which account the money came from." : "Choose which account the money landed in."); return; }
    const planAmt = num(fd.planAmt) || 0;
    UI.sheets.pop();
    commit(s => {
      if (isNew) {
        s.debts = [...(s.debts || []), { id: did, name, opening: fresh ? 0 : owed, startDate: C.today(), ...extra }];
        if (fresh) { const r = C.buildEntry(s, { kind: owedToYou ? "lend" : "borrow", debtId: did, accountId: fd.freshAccount, amount: owed, date: C.today() }); s.entries.push(r.entry); }
      } else s.debts = s.debts.map(d => d.id === id ? { ...d, name, opening: owed, ...extra } : d);
      if (planAmt > 0 && !owedToYou) s.bills = [...(s.bills || []), { id: C.uid(), name, amount: planAmt, ...parseSched(fd), accountId: fd.planAccount, category: "Loans", scope: "personal", debtId: did, startMonth: fd.planStart || "", since: C.today() }];
    }, owedToYou ? "Saved" : "Debt saved");
  },
  fixAccount(fd, id) {
    const a = C.acct(S, id), actual = num(fd.actual);
    if (actual === null) { toast("Enter a number."); return; }
    const diff = C.round2(actual - C.balances(S)[id]);
    UI.sheets.pop();
    if (!diff) { render(); toast("That already matches."); return; }
    commit(s => { s.entries.push({ id: C.uid(), kind: "correction", accountId: id, currency: a.currency, amount: diff, date: C.today(), note: "Matched to real balance", createdAt: new Date().toISOString() }); }, `${a.name} is now ${money(actual, a.currency)}`);
  },
  fixDebt(fd, id) {
    const d = C.debt(S, id), actual = num(fd.actual);
    if (actual === null) { toast("Enter a number."); return; }
    const diff = C.round2(actual - C.debtBalance(S, d));
    UI.sheets.pop();
    if (!diff) { render(); toast("That already matches."); return; }
    commit(s => { s.entries.push({ id: C.uid(), kind: "debtadjust", debtId: id, accountId: "", currency: "PHP", amount: diff, date: C.today(), note: "Matched to what's really owed", createdAt: new Date().toISOString() }); }, `You owe ${d.name} ${money(actual)}`);
  },
  check(fd) {
    const bal = C.balances(S), add = [];
    const now = new Date().toISOString();
    for (const a of accounts()) { const v = num(fd["a:" + a.id]); if (v === null || fd["a:" + a.id] === "") continue; const diff = C.round2(v - bal[a.id]); if (diff) add.push({ id: C.uid(), kind: "correction", accountId: a.id, currency: a.currency, amount: diff, date: C.today(), note: "Matched to real balance", createdAt: now }); }
    for (const d of S.debts || []) { const raw = fd["d:" + d.id]; const v = raw ? num(raw) : null; if (v === null) continue; const diff = C.round2(v - C.debtBalance(S, d)); if (diff) add.push({ id: C.uid(), kind: "debtadjust", debtId: d.id, accountId: "", currency: "PHP", amount: diff, date: C.today(), note: "Matched to what's really owed", createdAt: now }); }
    UI.sheets.pop();
    if (!add.length) { render(); toast("Everything matches."); return; }
    commit(s => { s.entries.push(...add); }, `${add.length} ${add.length === 1 ? "correction" : "corrections"} saved`);
  },
  cat(fd) {
    const c = fd.cat.trim(), sc = UI.sheets[UI.sheets.length - 1].scope || "personal";
    commit(s => { if (!s.categories[sc].includes(c)) s.categories[sc] = [...s.categories[sc], c]; }, "Category added");
  },
  trackFrom(fd) { const v = /^\d{4}-\d{2}-\d{2}$/.test(fd.tf || "") ? fd.tf : ""; UI.sheets.pop(); commit(s => { s.trackFrom = v; }, v ? "Tracking starts " + fmtDate(v, true) : "Tracking from the beginning"); },
  weekStart(fd) { UI.sheets.pop(); commit(s => { s.weekStart = +fd.ws; }, "Weeks now start on " + C.WEEKDAYS[+fd.ws]); UI.weekFrom = C.weekOf(S, C.today()).from; render(); },
  rate(fd) { const v = num(fd.rate); if (!(v > 0)) { toast("Enter a rate above zero."); return; } UI.sheets.pop(); commit(s => { s.usdRate = String(v); }, "Rate saved"); }
};

/* ---------- events ---------- */
document.addEventListener("click", ev => {
  const el = ev.target.closest("[data-a]");
  if (!el) return;
  const fn = A[el.dataset.a];
  if (fn) { ev.preventDefault(); fn(el.dataset.x, el); }
});
document.addEventListener("input", ev => {
  const el = ev.target;
  if (el.id === "q") { const sh = UI.sheets[UI.sheets.length - 1]; if (sh) sh.q = el.value; $("#sres").innerHTML = searchResults(el.value); return; }
  if (el.dataset.color) { const prev = el.dataset.color; S.catColors = { ...(S.catColors || {}), [prev]: el.value }; save(); return; }
  if (!el.dataset.b) return;
  const d = DRAFT(); if (!d) return;
  d[el.dataset.b] = el.value;
  if ("live" in el.dataset) refreshEffect();
});
document.addEventListener("change", ev => {
  const el = ev.target;
  if (el.dataset.b && "re" in el.dataset) { const d = DRAFT(); if (d) { d[el.dataset.b] = el.value; renderDraft(); } return; }
  if (el.name === "dkind") { const f = el.closest(".dform"); if (f) f.dataset.kind = el.value; return; }
  if (el.name === "endMode") { const f = el.closest(".cform"); if (f) f.dataset.end = el.value; return; }
  if (el.name === "freq" || el.name === "by") {
    const box = el.closest(".sched"); if (!box) return;
    if (el.name === "freq") { box.dataset.freq = el.value; if (el.value === "weekly") box.dataset.by = "weekday"; else box.dataset.by = (box.querySelector('[name="by"]:checked') || {}).value || "date"; }
    else box.dataset.by = el.value;
  }
  /* Picking a place you've used before fills in the category you gave it last time. */
  if (el.id === "f-note") { const d = DRAFT(); if (d && d.kind === "expense" && !d.category) { const c = C.suggestCategory(S, el.value); if (c) { d.category = c; if (!C.catsOf(S, d.scope || "personal").includes(c) && C.catsOf(S, "business").includes(c)) d.scope = "business"; renderDraft(); } } return; }
  if (el.id === "receiptFile" && el.files[0]) runScan(el.files[0]);
  if (el.id === "restoreFile" && el.files[0]) el.files[0].text().then(t => applyRestore(JSON.parse(t))).catch(() => toast("That file isn't a Mira Ledger backup."));
});
document.addEventListener("submit", ev => {
  const f = ev.target; ev.preventDefault();
  const fn = SAVE[f.dataset.save];
  if (fn) fn(Object.fromEntries(new FormData(f)), f.dataset.id);
});

document.addEventListener("pointerdown", readChart);
document.addEventListener("pointermove", ev => { if (ev.pressure > 0 || ev.pointerType === "mouse") readChart(ev); });

/* ---------- start ---------- */
try { const raw = lsGet(KEY); if (raw) S = JSON.parse(raw); } catch (e) { S = null; }
if (!S && window.MIRA_DEMO) { S = C.sampleState(); S.sample = true; }
render();
try { navigator.storage && navigator.storage.persist && navigator.storage.persist(); } catch (e) {}
})();
