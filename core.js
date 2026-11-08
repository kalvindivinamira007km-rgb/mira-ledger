/* Mira Ledger core: every number in the app comes from this file, and nothing here touches the screen.
   Rule: entries are the only source of truth. No balance is ever stored, only calculated. */
(function (root) {
"use strict";

/* ---------- dates ---------- */
const pad = n => String(n).padStart(2, "0");
const dstr = d => d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
const dparse = s => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d || 1); };
const daysIn = m => { const [y, mo] = m.split("-").map(Number); return new Date(y, mo, 0).getDate(); };
const addMonth = (m, n) => { const d = dparse(m + "-01"); d.setMonth(d.getMonth() + n); return dstr(d).slice(0, 7); };
const addDays = (s, n) => { const d = dparse(s); d.setDate(d.getDate() + n); return dstr(d); };
const today = () => dstr(new Date());
const daysBetween = (a, b) => Math.round((dparse(b) - dparse(a)) / 864e5);
const round2 = n => Math.round((+n || 0) * 100) / 100;
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/* ---------- lookups ---------- */
const acct = (s, id) => (s.accounts || []).find(a => a.id === id);
const bill = (s, id) => (s.bills || []).find(b => b.id === id);
const debt = (s, id) => (s.debts || []).find(d => d.id === id);
const stream = (s, id) => (s.streams || []).find(x => x.id === id);
const defaultRate = s => +s.usdRate || 0;
const entryRate = (s, e) => +e.rate || defaultRate(s);
const toPHP = (s, amt, cur, rate) => cur === "USD" ? (+amt || 0) * (+rate || defaultRate(s)) : (+amt || 0);
const entPHP = (s, e) => toPHP(s, e.amount, e.currency, entryRate(s, e));
const inMonth = (s, m) => s.entries.filter(e => (e.date || "").slice(0, 7) === m);

/* ---------- what an entry means ---------- */
const debtIdOf = (s, e) => e.debtId || (e.kind === "bill" ? (bill(s, e.billId) || {}).debtId : "") || "";

/* Every entry belongs to exactly one group, so totals can't overlap. */
function groupOf(s, e) {
  switch (e.kind) {
    case "income": return "earned";
    case "borrow": return "borrowed";
    case "debt": return "debtpay";
    case "bill":
    case "expense": return debtIdOf(s, e) ? "debtpay" : "spent";
    case "transfer": return "transfer";
    case "correction": return "correction";
    case "debtadjust": return "debtadjust";
    case "lend": return "lent";
    case "collect": return "collected";
    default: return "other"; // savings set aside in the old app: never moved real money
  }
}
const GROUP_LABEL = { earned: "Earned", borrowed: "Borrowed", spent: "Spent", debtpay: "Debt payments", transfer: "Moved", correction: "Balance corrections", debtadjust: "Debt corrections", lent: "Lent out", collected: "Paid back to you", other: "Set aside" };
/* Debts go both ways: money you owe, and money someone owes you. */
const isOwedToYou = d => !!d && d.dir === "owed";
/* A debt can be money, something bought on credit (still owed in pesos), or an item to give back (no pesos at all). */
const isThing = d => !!d && d.kind === "thing";
const isMoneyDebt = d => !!d && !isThing(d);

/* ---------- balances ---------- */
function balances(s, upto) {
  const b = {};
  (s.accounts || []).forEach(a => { b[a.id] = +a.start || 0; });
  for (const e of s.entries) {
    if (upto && e.date > upto) continue;
    const a = +e.amount || 0;
    if (e.kind === "income" || e.kind === "borrow" || e.kind === "correction" || e.kind === "collect") { if (e.accountId in b) b[e.accountId] += a; }
    else if (e.kind === "expense" || e.kind === "bill" || e.kind === "debt" || e.kind === "lend") { if (e.accountId in b) b[e.accountId] -= a; }
    else if (e.kind === "transfer") {
      if (e.accountId in b) b[e.accountId] -= a;
      if (e.toAccountId in b) b[e.toAccountId] += (e.toAmount !== undefined && e.toAmount !== null && e.toAmount !== "") ? +e.toAmount : a;
    }
  }
  return b;
}
function totalPHP(s, upto) {
  const b = balances(s, upto);
  return (s.accounts || []).filter(a => !a.archived).reduce((t, a) => t + toPHP(s, b[a.id], a.currency), 0);
}

/* ---------- month statement: start + in - out = end, always ---------- */
function statement(s, m, now) {
  now = now || today();
  const first = m + "-01", last = m + "-" + pad(daysIn(m));
  const upto = last < now ? last : now;
  const rows = { earned: 0, borrowed: 0, spent: 0, debtpay: 0, correction: 0, lent: 0, collected: 0 };
  const lists = { earned: [], borrowed: [], spent: [], debtpay: [], correction: [], lent: [], collected: [] };
  for (const e of inMonth(s, m)) {
    if (e.date > upto) continue;
    const g = groupOf(s, e);
    if (!(g in rows)) continue;
    const v = entPHP(s, e);
    rows[g] += v;
    lists[g].push(e);
  }
  const start = totalPHP(s, addDays(first, -1));
  const end = totalPHP(s, upto);
  const moved = start + rows.earned + rows.borrowed - rows.spent - rows.debtpay + rows.correction - rows.lent + rows.collected;
  let exchange = round2(end - moved);
  if (Math.abs(exchange) < 0.01) exchange = 0;
  return { month: m, start, end, ...rows, exchange, lists };
}

/* ---------- schedules ---------- */
const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const ord = n => n + ((n % 100 >= 11 && n % 100 <= 13) ? "th" : ({ 1: "st", 2: "nd", 3: "rd" })[n % 10] || "th");
const freqOf = b => (b && b.freq) || (b && +b.secondDay ? "twice" : "monthly");
function nthWeekday(m, wd, n) {
  const total = daysIn(m);
  let d = 1 + ((wd - dparse(m + "-01").getDay() + 7) % 7);
  if (+n === 5) { while (d + 7 <= total) d += 7; return d; }
  d += (n - 1) * 7;
  return d <= total ? d : null;
}
const monthDiff = (a, b) => (+b.slice(0, 4) - +a.slice(0, 4)) * 12 + (+b.slice(5, 7) - +a.slice(5, 7));
/* Due days in a month. A "last payment" date stops the schedule, so finished loans stop showing up. */
function occDays(b, m) {
  const days = rawOccDays(b, m);
  return b.until ? days.filter(d => m + "-" + pad(d) <= b.until) : days;
}
function rawOccDays(b, m) {
  const f = freqOf(b), by = b.by || "date", n = daysIn(m), wd = +b.weekday || 0;
  /* Every 2 weeks, every 3 months and yearly all count from one known date. */
  if (f === "biweekly") {
    if (!b.anchor) return [];
    const out = [];
    for (let d = 1; d <= n; d++) { const g = daysBetween(b.anchor, m + "-" + pad(d)); if (g >= 0 && g % 14 === 0) out.push(d); }
    return out;
  }
  if (f === "quarterly" || f === "yearly") {
    if (!b.anchor) return [];
    const g = monthDiff(b.anchor.slice(0, 7), m);
    return g >= 0 && g % (f === "quarterly" ? 3 : 12) === 0 ? [Math.min(+b.anchor.slice(8), n)] : [];
  }
  if (f === "weekly") { const out = []; for (let d = 1 + ((wd - dparse(m + "-01").getDay() + 7) % 7); d <= n; d += 7) out.push(d); return out; }
  if (by === "weekday") return (f === "twice" ? (b.nths || [1, 3]) : [+b.nth || 1]).map(x => nthWeekday(m, wd, x)).filter(Boolean);
  return (f === "twice" ? [+b.dueDay || 1, +b.secondDay || 15] : [+b.dueDay || 1]).map(d => Math.min(d, n)).sort((a, c) => a - c);
}
function scheduleText(b) {
  const f = freqOf(b), wd = WEEKDAYS[+b.weekday || 0], nl = n => +n === 5 ? "last" : ord(+n);
  if (f === "anytime") return "Any time this month";
  const ends = b.until ? ", until " + dparse(b.until).toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "";
  if (f === "biweekly") return (b.anchor ? "Every 2 weeks, from " + dparse(b.anchor).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "Every 2 weeks") + ends;
  if (f === "quarterly" || f === "yearly") {
    const on = b.anchor ? dparse(b.anchor).toLocaleDateString("en-PH", { month: "short", day: "numeric" }) : "";
    return (f === "quarterly" ? "Every 3 months" : "Every year") + (on ? ", starting " + on : "") + ends;
  }
  if (f === "weekly") return "Every " + wd + ends;
  if ((b.by || "date") === "weekday") return (f === "twice" ? (b.nths || [1, 3]).map(nl).join(" & ") : nl(b.nth || 1)) + " " + wd + ends;
  return "Every " + (f === "twice" ? ord(+b.dueDay || 1) + " & " + ord(+b.secondDay || 15) : ord(+b.dueDay || 1)) + ends;
}
const monthlyTimes = b => ({ weekly: 52 / 12, biweekly: 26 / 12, twice: 2, monthly: 1, quarterly: 1 / 3, yearly: 1 / 12 })[freqOf(b)] || 1;

/* ---------- debts: a plain running ledger, like a passbook ---------- */
function debtLedger(s, d) {
  const rows = [];
  const pushed = s.entries.filter(e => {
    if (["borrow", "debtadjust", "lend", "collect"].includes(e.kind)) return e.debtId === d.id;
    return groupOf(s, e) === "debtpay" && debtIdOf(s, e) === d.id;
  }).sort((a, b) => (a.date + (a.createdAt || "")).localeCompare(b.date + (b.createdAt || "")));
  let bal = +d.opening || 0;
  const opening = bal;
  for (const e of pushed) {
    const v = entPHP(s, e);
    /* The balance is always "how much is still outstanding", whichever way the debt goes. */
    const change = e.kind === "borrow" || e.kind === "lend" ? v : e.kind === "debtadjust" ? +e.amount || 0 : -v;
    bal = round2(bal + change);
    rows.push({ entry: e, change, balance: bal });
  }
  return { opening, rows, balance: bal };
}
const debtBalance = (s, d) => debtLedger(s, d).balance;
function debtPlan(s, d) {
  const b = (s.bills || []).find(x => x.debtId === d.id);
  const bal = debtBalance(s, d);
  if (!b) return { bal, bill: null };
  const per = +b.amount || 0, monthly = per * monthlyTimes(b);
  if (bal <= 0 || !monthly) return { bal, bill: b, monthly };
  const months = Math.ceil(bal / monthly - 1e-9);
  const m = today().slice(0, 7);
  return { bal, bill: b, per, monthly, months, finish: addMonth(m, months - 1) };
}
const totalOwed = s => (s.debts || []).filter(d => !isOwedToYou(d) && isMoneyDebt(d)).reduce((t, d) => t + Math.max(0, debtBalance(s, d)), 0);
const totalOwedToYou = s => (s.debts || []).filter(d => isOwedToYou(d) && isMoneyDebt(d)).reduce((t, d) => t + Math.max(0, debtBalance(s, d)), 0);

/* ---------- bills ---------- */
const billCur = (s, b) => (acct(s, b.accountId) || {}).currency || "PHP";
function billSlots(s, m, now) {
  now = now || today();
  const out = [];
  const tf = s.trackFrom || "";
  for (const b of s.bills || []) {
    if (b.startMonth && m < b.startMonth) continue;
    const linked = b.debtId ? debt(s, b.debtId) : null;
    const owed = linked ? debtBalance(s, linked) : 1;
    occDays(b, m).forEach((day, i) => {
      const slot = i + 1, due = m + "-" + pad(day);
      const paid = s.entries.find(e => e.kind === "bill" && e.billId === b.id && e.billMonth === m && (+e.billSlot || 1) === slot);
      const base = { bill: b, slot, due, usual: +b.amount || 0, currency: billCur(s, b), total: occDays(b, m).length };
      if (paid) { out.push({ ...base, status: "paid", entry: paid, php: entPHP(s, paid) }); return; }
      if ((b.since && due < b.since) || (tf && due < tf)) return;
      if (b.debtId && owed <= 0) return; // the debt is finished, so stop asking for payments
      const php = toPHP(s, base.usual, base.currency);
      if ((s.skips || {})[b.id + "|" + m + "|" + slot]) { out.push({ ...base, status: "skipped", php: 0 }); return; }
      const diff = daysBetween(now, due);
      out.push({ ...base, php, diff, status: diff < 0 ? "overdue" : diff <= 7 ? "soon" : "later" });
    });
  }
  return out.sort((a, c) => a.due.localeCompare(c.due));
}

/* ---------- paydays ---------- */
/* Pay can change from a date onward. The latest change on or before the payday wins. */
function streamAmount(x, date) {
  let amt = +x.expected || 0, best = "";
  for (const r of x.changes || []) if (r.from && r.from <= date && r.from >= best) { best = r.from; amt = +r.amount || 0; }
  return amt;
}
function paydayDates(x, m) {
  if (!(+x.expected || (x.changes || []).some(r => +r.amount)) || !x.freq || x.freq === "none" || x.archived) return [];
  if (x.until && m + "-01" > x.until) return [];
  const a = x.anchor || m + "-01", first = m + "-01", last = m + "-" + pad(daysIn(m));
  if (a > last) return [];
  let out = [];
  if (x.freq === "monthly") { const d = m + "-" + pad(Math.min(dparse(a).getDate(), daysIn(m))); out = d >= a ? [d] : []; }
  else {
    const step = x.freq === "biweekly" ? 14 : 7;
    const t = dparse(a);
    while (dstr(t) < first) t.setDate(t.getDate() + step);
    while (dstr(t) <= last) { out.push(dstr(t)); t.setDate(t.getDate() + step); }
  }
  return x.until ? out.filter(d => d <= x.until) : out;
}
/* The next n paydays on or after a date, ignoring any end date (used to work out the last one). */
function nextPaydays(x, from, n) {
  const open = { ...x, until: "", archived: false }, out = [];
  let m = from.slice(0, 7);
  for (let i = 0; i < 240 && out.length < n; i++, m = addMonth(m, 1)) paydayDates(open, m).forEach(d => { if (d >= from && out.length < n) out.push(d); });
  return out;
}
/* How many paydays are still to come (today included) before the source ends. */
function paysLeft(x, now) {
  now = now || today();
  if (!x.until || x.until < now) return x.until ? 0 : null;
  return nextPaydays(x, now, 999).filter(d => d <= x.until).length;
}
/* Each payment can only satisfy one payday, so one entry can't tick two weeks. */
function paydays(s, m, now) {
  now = now || today();
  const out = [];
  const tf = s.trackFrom || "";
  for (const x of s.streams || []) {
    const free = s.entries.filter(e => e.kind === "income" && e.streamId === x.id).slice();
    for (const date of paydayDates(x, m)) {
      if (tf && date < tf) continue;
      let hit = null, bestGap = 99;
      free.forEach(e => { const g = Math.abs(daysBetween(e.date, date)); if (g <= 3 && g < bestGap) { hit = e; bestGap = g; } });
      if (hit) free.splice(free.indexOf(hit), 1);
      const cur = x.currency || "PHP";
      const amt = streamAmount(x, date);
      out.push({ stream: x, date, expected: amt, currency: cur, php: toPHP(s, amt, cur), entry: hit,status: hit ? "received" : date < now ? "late" : "upcoming" });
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date));
}

/* ---------- one-time and budgets ---------- */
const oneTimes = (s, m) => (s.oneTime || []).filter(o => (o.date || "").slice(0, 7) === m && (!s.trackFrom || o.date >= s.trackFrom))
  .map(o => { const entry = s.entries.find(e => e.oneTimeId === o.id); return { item: o, entry, status: entry ? "paid" : "open", php: entry ? entPHP(s, entry) : +o.amount || 0 }; })
  .sort((a, b) => a.item.date.localeCompare(b.item.date));
function budgetTimes(b, m) { return freqOf(b) === "anytime" ? 1 : occDays(b, m).length; }
const budgetTotal = (b, m) => (+b.amount || 0) * budgetTimes(b, m);
function budgetSpent(s, b, m) {
  const firstOfCat = (s.budgets || []).find(x => x.category === b.category);
  return inMonth(s, m).filter(e => e.kind === "expense" && !e.oneTimeId && groupOf(s, e) === "spent" &&
    (e.budgetId === b.id || (!e.budgetId && e.category === b.category && firstOfCat && firstOfCat.id === b.id)))
    .reduce((t, e) => t + entPHP(s, e), 0);
}

/* How a budget is doing: what's left, and how much a day keeps you on track. */
function budgetPace(s, b, m, now) {
  now = now || today();
  const total = budgetTotal(b, m), spent = budgetSpent(s, b, m), left = total - spent;
  const current = now.slice(0, 7) === m, days = daysIn(m);
  const daysLeft = current ? days - +now.slice(8) + 1 : 0;
  return { total, spent, left, daysLeft, perDay: current && left > 0 ? left / daysLeft : 0, todayPct: current ? (+now.slice(8) - 0.5) / days * 100 : null };
}

/* Amounts can be sums, like "120+80" or "3x45". Only numbers and + − × ÷, never code. */
function evalAmount(input) {
  const src = String(input ?? "").replace(/,/g, "").replace(/[×xX*]/g, "*").replace(/[÷/]/g, "/").replace(/[−–]/g, "-").replace(/\s+/g, "");
  if (!src || !/^[\d.+\-*/]+$/.test(src)) return null;
  const parts = src.match(/(\d+\.?\d*|\.\d+|[+\-*/])/g);
  if (!parts || parts.join("") !== src) return null;
  let i = 0;
  const number = () => { let sign = 1; while (parts[i] === "-" || parts[i] === "+") { if (parts[i] === "-") sign = -sign; i++; } const v = parseFloat(parts[i++]); return isFinite(v) ? sign * v : NaN; };
  const term = () => { let v = number(); while (parts[i] === "*" || parts[i] === "/") { const op = parts[i++], r = number(); v = op === "*" ? v * r : v / r; } return v; };
  let v = term();
  while (parts[i] === "+" || parts[i] === "-") { const op = parts[i++], r = term(); v = op === "+" ? v + r : v - r; }
  return i === parts.length && isFinite(v) ? round2(v) : null;
}

/* ---------- end-of-month estimate: what you have now, plus what's coming, minus what's due ---------- */
function forecast(s, m, now) {
  now = now || today();
  const have = totalPHP(s, now);
  const bills = billSlots(s, m, now).filter(x => x.status === "overdue" || x.status === "soon" || x.status === "later");
  const ones = oneTimes(s, m).filter(x => x.status === "open");
  /* Only what's left of a budget for the days ahead still counts; unspent days that passed don't. */
  const budgets = (s.budgets || []).map(b => { const p = budgetPlanned(s, b, m + "-01", m + "-" + pad(daysIn(m)), now); return { budget: b, total: p.limit, spent: p.spent, left: p.aheadLeft }; });
  const pays = paydays(s, m, now).filter(p => p.status !== "received");
  const dueBills = bills.reduce((t, x) => t + x.php, 0);
  const dueOnes = ones.reduce((t, x) => t + x.php, 0);
  const dueBudgets = budgets.reduce((t, x) => t + x.left, 0);
  const coming = pays.reduce((t, p) => t + p.php, 0);
  return { have, coming, dueBills, dueOnes, dueBudgets, end: have + coming - dueBills - dueOnes - dueBudgets, bills, ones, budgets, pays };
}

/* Daily balance for the chart. The planned part ends exactly at the end-of-month estimate. */
function balanceSeries(s, m, now) {
  now = now || today();
  const last = m + "-" + pad(daysIn(m)), lastShown = last < now ? last : now, actual = [];
  for (let d = m + "-01"; d <= lastShown; d = addDays(d, 1)) actual.push({ date: d, v: totalPHP(s, d) });
  const planned = [];
  if (now.slice(0, 7) === m) {
    const f = forecast(s, m, now), when = {};
    const add = (date, v) => { const k = date < now ? now : date; when[k] = (when[k] || 0) + v; };
    f.pays.forEach(p => add(p.date, p.php));
    f.bills.forEach(x => add(x.due, -x.php));
    f.ones.forEach(o => add(o.item.date, -o.php));
    const daysLeft = daysBetween(now, last) + 1;
    for (let d = now; d <= last; d = addDays(d, 1)) add(d, -f.dueBudgets / daysLeft);
    let run = f.have;
    for (let d = now; d <= last; d = addDays(d, 1)) { run += when[d] || 0; planned.push({ date: d, v: run }); }
    if (planned.length) planned[planned.length - 1].v = f.end;
  }
  return { actual, planned, days: daysIn(m) };
}
/* Spending so far against the same point last month. */
function spendPace(s, m, now) {
  now = now || today();
  const sum = (mo, day) => inMonth(s, mo).filter(e => groupOf(s, e) === "spent" && +e.date.slice(8) <= day).reduce((t, e) => t + entPHP(s, e), 0);
  const day = m === now.slice(0, 7) ? +now.slice(8) : daysIn(m), prev = addMonth(m, -1);
  const was = sum(prev, Math.min(day, daysIn(prev)));
  return { now: sum(m, day), was, day };
}

/* ---------- weekly budgeting: each week runs from your payday to the day before the next ---------- */
/* Week start: what you chose, else the weekday of your first weekly pay, else Monday. */
function weekStartDay(s) {
  if (s.weekStart !== undefined && s.weekStart !== null && s.weekStart !== "") return +s.weekStart;
  const weekly = (s.streams || []).find(x => !x.archived && (x.freq === "weekly" || x.freq === "biweekly") && x.anchor);
  return weekly ? dparse(weekly.anchor).getDay() : 1;
}
function weekOf(s, date) {
  const ws = weekStartDay(s), from = addDays(date, -((dparse(date).getDay() - ws + 7) % 7));
  return { from, to: addDays(from, 6) };
}
const monthsIn = (from, to) => { const out = []; for (let m = from.slice(0, 7); m <= to.slice(0, 7); m = addMonth(m, 1)) out.push(m); return out; };
/* Which entries a budget owns: tagged ones, plus untagged ones in its category if it's the first budget for that category. */
function inBudget(s, b, e) {
  if (e.kind !== "expense" || e.oneTimeId || groupOf(s, e) !== "spent") return false;
  if (e.budgetId) return e.budgetId === b.id;
  const first = (s.budgets || []).find(x => x.category === e.category);
  return !!first && first.id === b.id;
}
/* A budget's share of a week. Weekly budgets give their amount each week. Monthly ones (any time, or
   on set days like grocery runs) are spread evenly by day, so a week before a grocery run isn't "over". */
function budgetForRange(b, from, to) {
  if (freqOf(b) === "weekly") {
    let n = 0;
    for (const m of monthsIn(from, to)) occDays(b, m).forEach(day => { const d = m + "-" + pad(day); if (d >= from && d <= to) n++; });
    return n * (+b.amount || 0);
  }
  let t = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) { const m = d.slice(0, 7); t += budgetTotal(b, m) / daysIn(m); }
  return t;
}
/* What a budget still takes out of a period. Days that have passed only count what you actually spent:
   an unspent share from yesterday is gone, not still "planned". Spending uses up the past days' share
   first, then eats into the days ahead. A past period counts only spending; a future one counts the full budget. */
/* Dates a scheduled budget is used (shopping days), within a range. */
function budgetRuns(b, from, to) {
  const out = [];
  for (const m of monthsIn(from, to)) occDays(b, m).forEach(day => { const d = m + "-" + pad(day); if (d >= from && d <= to) out.push(d); });
  return out.sort();
}
function budgetPlanned(s, b, from, to, now) {
  now = now || today();
  const mine = s.entries.filter(e => e.date >= from && e.date <= to && inBudget(s, b, e));
  const spent = mine.reduce((t, e) => t + entPHP(s, e), 0);
  if (freqOf(b) !== "anytime") {
    /* A budget with dates counts in full on its date, never spread by day. Each date covers spending
       until the next date. A date still ahead keeps whatever of it isn't spent yet; a date that has
       passed only counts what was spent. Spending before the first date belongs to the previous run. */
    const runs = budgetRuns(b, from, to), amt = +b.amount || 0;
    const spentIn = (a, z) => mine.filter(e => e.date >= a && e.date <= z).reduce((t, e) => t + entPHP(s, e), 0);
    let aheadLeft = 0, ahead = 0;
    runs.forEach((r, i) => { if (r < now) return; ahead += amt; const end = i + 1 < runs.length ? addDays(runs[i + 1], -1) : to; aheadLeft += Math.max(0, amt - spentIn(r, end)); });
    const counted = runs.length ? spentIn(runs[0], to) : 0;
    return { limit: runs.length * amt, spent, ahead, aheadLeft, plan: spent + aheadLeft, left: runs.length * amt - counted, runs };
  }
  const cut = now > to ? addDays(to, 1) : now < from ? from : now;
  const past = cut > from ? budgetForRange(b, from, addDays(cut, -1)) : 0;
  const ahead = cut <= to ? budgetForRange(b, cut, to) : 0;
  const aheadLeft = Math.max(0, ahead - Math.max(0, spent - past));
  return { limit: past + ahead, spent, ahead, aheadLeft, plan: spent + aheadLeft, left: past + ahead - spent, runs: [] };
}

/* The week's plan: pay in, minus bills, budgets, other spending and debt payments, equals what's left. */
function weekPlan(s, from, now) {
  now = now || today();
  const to = addDays(from, 6), inR = d => d >= from && d <= to, ms = monthsIn(from, to);
  const ents = s.entries.filter(e => inR(e.date));
  const pays = ms.flatMap(m => paydays(s, m, now)).filter(p => inR(p.date));
  const bills = ms.flatMap(m => billSlots(s, m, now)).filter(x => inR(x.due) && x.status !== "skipped");
  const ones = ms.flatMap(m => oneTimes(s, m)).filter(o => inR(o.item.date));
  const budgets = (s.budgets || []).map(b => ({ budget: b, ...budgetPlanned(s, b, from, to, now) }));
  const sum = (list, f) => list.reduce((t, x) => t + f(x), 0);
  const received = sum(ents.filter(e => e.kind === "income"), e => entPHP(s, e));
  const expected = sum(pays.filter(p => !p.entry), p => p.php);
  const billsPlan = sum(bills, x => x.status === "paid" ? x.php : x.php), billsPaid = sum(bills.filter(x => x.status === "paid"), x => x.php);
  const onesPlan = sum(ones, o => o.php), onesPaid = sum(ones.filter(o => o.entry), o => o.php);
  const budgetPlan = sum(budgets, x => x.plan), budgetSpentAll = sum(budgets, x => x.spent);
  const billIds = new Set(bills.filter(x => x.entry).map(x => x.entry.id));
  const other = sum(ents.filter(e => groupOf(s, e) === "spent" && e.kind === "expense" && !e.oneTimeId && !(s.budgets || []).some(b => inBudget(s, b, e))), e => entPHP(s, e))
    + sum(ents.filter(e => e.kind === "bill" && groupOf(s, e) === "spent" && !billIds.has(e.id)), e => entPHP(s, e));
  const debtpay = sum(ents.filter(e => groupOf(s, e) === "debtpay" && !billIds.has(e.id)), e => entPHP(s, e));
  const borrowed = sum(ents.filter(e => e.kind === "borrow"), e => entPHP(s, e));
  /* Lending takes money out of the week, and getting paid back puts it in. Neither is pay or spending. */
  const lent = sum(ents.filter(e => e.kind === "lend"), e => entPHP(s, e)), collected = sum(ents.filter(e => e.kind === "collect"), e => entPHP(s, e));
  const income = received + expected;
  const left = income - billsPlan - onesPlan - budgetPlan - other - debtpay - lent + collected;
  const leftNow = received - billsPaid - onesPaid - budgetSpentAll - other - debtpay - lent + collected;
  const days = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    const de = ents.filter(e => e.date === d);
    days.push({
      date: d,
      out: sum(de.filter(e => ["spent", "debtpay", "lent"].includes(groupOf(s, e))), e => entPHP(s, e)),
      in: sum(de.filter(e => e.kind === "income"), e => entPHP(s, e)),
      payday: pays.some(p => p.date === d),
      runs: budgets.filter(x => (x.runs || []).includes(d)).map(x => x.budget),
      due: bills.filter(x => x.due === d && x.status !== "paid").length + ones.filter(o => o.item.date === d && !o.entry).length
    });
  }
  return { from, to, isNow: inR(now), received, expected, income, billsPlan, billsPaid, onesPlan, onesPaid, budgetPlan, budgetSpent: budgetSpentAll, other, debtpay, borrowed, lent, collected, left, leftNow, pays, bills, ones, budgets, days, entries: ents };
}

/* ---------- weeks (Sunday to Saturday, clipped to the month) ---------- */
function weekRanges(m) {
  const last = m + "-" + pad(daysIn(m));
  const out = [];
  let a = m + "-01";
  while (a <= last) {
    let b = addDays(a, 6 - dparse(a).getDay());
    if (b > last) b = last;
    out.push([a, b]);
    a = addDays(b, 1);
  }
  return out;
}
function weeks(s, m, now) {
  now = now || today();
  const slots = billSlots(s, m, now).filter(x => x.status !== "skipped");
  const pays = paydays(s, m, now);
  const ones = oneTimes(s, m);
  const bud = s.budgets || [];
  const n = daysIn(m);
  const tf = s.trackFrom && s.trackFrom.slice(0, 7) === m ? s.trackFrom : m + "-01";
  const days = n - dparse(tf).getDate() + 1;
  return weekRanges(m).map(([a, b]) => {
    const inR = d => d >= a && d <= b;
    const inItems = pays.filter(p => inR(p.date)).map(p => ({ label: p.stream.name, date: p.date, php: p.entry ? entPHP(s, p.entry) : p.php, done: !!p.entry, late: p.status === "late", payday: p }));
    const outItems = slots.filter(x => inR(x.due)).map(x => ({ label: x.bill.name, date: x.due, php: x.php, done: x.status === "paid", late: x.status === "overdue", slot: x, category: x.bill.category }));
    ones.filter(o => inR(o.item.date)).forEach(o => outItems.push({ label: o.item.name, date: o.item.date, php: o.php, done: o.status === "paid", one: o, category: o.item.category }));
    for (const g of bud) {
      if (freqOf(g) === "anytime") {
        const from = a < tf ? tf : a;
        if (from > b) continue;
        const share = budgetTotal(g, m) * (daysBetween(from, b) + 1) / days;
        outItems.push({ label: (g.name || g.category) + " (budget share)", date: from, php: share, budget: g, category: g.category });
      } else {
        occDays(g, m).forEach(d => { const date = m + "-" + pad(d); if (inR(date)) outItems.push({ label: (g.name || g.category) + " (budget)", date, php: +g.amount || 0, budget: g, category: g.category }); });
      }
    }
    outItems.sort((x, y) => x.date.localeCompare(y.date));
    const ents = s.entries.filter(e => inR(e.date));
    return {
      from: a, to: b, isNow: now >= a && now <= b, inItems, outItems,
      expectedIn: inItems.reduce((t, i) => t + i.php, 0),
      expectedOut: outItems.reduce((t, i) => t + i.php, 0),
      actualIn: ents.filter(e => e.kind === "income").reduce((t, e) => t + entPHP(s, e), 0),
      actualOut: ents.filter(e => ["spent", "debtpay"].includes(groupOf(s, e))).reduce((t, e) => t + entPHP(s, e), 0),
      entries: ents
    };
  });
}

/* ---------- summaries ---------- */
function categorySpend(s, m, scope) {
  const map = {};
  for (const e of inMonth(s, m)) {
    if (groupOf(s, e) !== "spent") continue;
    if (scope && scope !== "all" && (e.scope || "personal") !== scope) continue;
    const c = e.category || "Other";
    (map[c] = map[c] || { category: c, total: 0, entries: [] }).total += entPHP(s, e);
    map[c].entries.push(e);
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}
function incomeByClient(s, m) {
  const map = {};
  for (const e of inMonth(s, m)) {
    if (e.kind !== "income") continue;
    const k = e.streamId || "other";
    (map[k] = map[k] || { id: k, name: (stream(s, k) || {}).name || e.source || "Other income", total: 0, entries: [] }).total += entPHP(s, e);
    map[k].entries.push(e);
  }
  return Object.values(map).sort((a, b) => b.total - a.total);
}

/* ---------- what an entry is called ---------- */
function entryTitle(s, e) {
  switch (e.kind) {
    case "income": return (stream(s, e.streamId) || {}).name || e.source || "Other income";
    case "borrow": return "Borrowed from " + ((debt(s, e.debtId) || {}).name || "someone");
    case "debt": return "Paid " + ((debt(s, e.debtId) || {}).name || "a debt");
    case "lend": return "Lent to " + ((debt(s, e.debtId) || {}).name || "someone");
    case "collect": return ((debt(s, e.debtId) || {}).name || "Someone") + " paid you back";
    case "bill": return (bill(s, e.billId) || {}).name || e.note || "Bill";
    case "transfer": return "Moved to " + ((acct(s, e.toAccountId) || {}).name || "another account");
    case "correction": return "Balance correction";
    case "debtadjust": return "Debt correction: " + ((debt(s, e.debtId) || {}).name || "");
    case "save": return "Set aside";
    default: return e.debtId && debt(s, e.debtId) ? "Paid " + debt(s, e.debtId).name : e.note || e.category || "Spent";
  }
}

/* ---------- search ---------- */
function search(s, q) {
  const words = String(q || "").toLowerCase().replace(/,/g, "").split(/\s+/).filter(Boolean);
  if (!words.length) return { entries: [], bills: [], debts: [], accounts: [], clients: [], total: 0 };
  const hit = parts => { const hay = parts.join(" ").toLowerCase().replace(/,/g, ""); return words.every(w => hay.includes(w)); };
  const amt = v => { const n = +v || 0; return [String(n), n.toFixed(2)]; };
  const entries = s.entries.filter(e => {
    const a = acct(s, e.accountId) || {};
    const mo = dparse(e.date).toLocaleDateString("en-US", { month: "long" });
    return hit([entryTitle(s, e), e.note || "", e.category || "", a.name || "", e.date, mo, GROUP_LABEL[groupOf(s, e)] || "", ...amt(e.amount)]);
  }).sort((a, b) => b.date.localeCompare(a.date));
  return {
    entries,
    bills: (s.bills || []).filter(b => hit([b.name, b.category || "", ...amt(b.amount)])),
    debts: (s.debts || []).filter(d => hit([d.name, "debt", "loan", ...amt(debtBalance(s, d))])),
    accounts: (s.accounts || []).filter(a => hit([a.name, a.type || ""])),
    clients: (s.streams || []).filter(x => hit([x.name, x.via || ""])),
    total: entries.filter(e => groupOf(s, e) === "spent").reduce((t, e) => t + entPHP(s, e), 0)
  };
}

/* ---------- turning a form draft into a valid entry ---------- */
function buildEntry(s, d) {
  const a = acct(s, d.accountId);
  const amount = round2(d.amount);
  if (d.kind !== "debtadjust" && !a) return { error: "Choose an account." };
  if (d.kind !== "correction" && d.kind !== "debtadjust" && !(amount > 0)) return { error: "Enter an amount above zero." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d.date || "")) return { error: "Choose a date." };
  const e = { id: d.id || uid(), kind: d.kind, date: d.date, amount, currency: a ? a.currency : "PHP", accountId: d.accountId || "", note: (d.note || "").trim(), createdAt: d.createdAt || new Date().toISOString() };
  if (d.receiptId) e.receiptId = d.receiptId;
  if (a && a.currency === "USD" && +d.rate > 0) e.rate = +d.rate;
  switch (d.kind) {
    case "income":
      e.scope = "business";
      if (stream(s, d.streamId)) e.streamId = d.streamId;
      else if ((d.source || "").trim()) { e.source = d.source.trim(); e.scope = "personal"; }
      else return { error: "Choose who paid you." };
      break;
    case "expense":
      if (!d.category) return { error: "Choose a category." };
      e.category = d.category; e.scope = d.scope || "personal";
      if (d.budgetId) e.budgetId = d.budgetId;
      if (d.oneTimeId) e.oneTimeId = d.oneTimeId;
      if (d.debtId && debt(s, d.debtId) && isMoneyDebt(debt(s, d.debtId))) e.debtId = d.debtId;
      break;
    case "borrow":
    case "debt": {
      const x = debt(s, d.debtId);
      if (!x || isOwedToYou(x) || isThing(x)) return { error: d.kind === "borrow" ? "Choose who lent you the money." : "Choose which debt you paid." };
      e.debtId = d.debtId;
      if (d.kind === "debt") { e.scope = "personal"; e.category = "Loans"; }
      break;
    }
    case "lend":
    case "collect": {
      const x = debt(s, d.debtId);
      if (!x || !isOwedToYou(x) || isThing(x)) return { error: d.kind === "lend" ? "Choose who you lent the money to." : "Choose who paid you back." };
      e.debtId = d.debtId;
      break;
    }
    case "bill": {
      const b = bill(s, d.billId);
      if (!b) return { error: "Choose a bill." };
      e.billId = b.id; e.billMonth = d.billMonth || d.date.slice(0, 7); e.billSlot = +d.billSlot || 1;
      e.scope = b.scope || "personal"; e.category = b.category || "Utilities";
      break;
    }
    case "transfer": {
      const to = acct(s, d.toAccountId);
      if (!to) return { error: "Choose the account the money went to." };
      if (to.id === d.accountId) return { error: "Choose two different accounts." };
      e.toAccountId = to.id;
      e.toAmount = (d.toAmount === "" || d.toAmount === undefined || d.toAmount === null) ? amount : round2(d.toAmount);
      break;
    }
    case "correction":
    case "debtadjust":
      if (d.debtId) e.debtId = d.debtId;
      break;
    case "save":
      if (d.goalId) e.goalId = d.goalId;
      break;
    default: return { error: "Choose what happened." };
  }
  return { entry: e };
}

/* ---------- reading receipts: turns scanned text into suggested fields ---------- */
const CATEGORY_HINTS = [
  [/\b(s ?m|sm (super|hyper)market|puregold|robinsons super|landers|s&r|savemore|waltermart|shopwise|alfamart|dali)\b/i, "Groceries"],
  [/\b(shell|petron|caltex|seaoil|phoenix|unioil)\b/i, "Gas"],
  [/\b(autosweep|easytrip|nlex|slex|toll)\b/i, "Toll"],
  [/\b(jollibee|mcdonald|mcdo|kfc|chowking|greenwich|starbucks|mang inasal|restaurant|cafe|coffee|bakery|grill)\b/i, "Eat Out"],
  [/\b(meralco|maynilad|manila water|pldt|globe|smart|converge)\b/i, "Utilities"],
  [/\b(philfoam|ikea|mandaue foam|uratex|furniture|our home)\b/i, "Furniture"],
  [/\b(mercury|southstar|watsons|pharmacy|hospital|clinic|medical)\b/i, "Medical"]
];
function suggestCategory(s, merchant) {
  const key = String(merchant || "").trim().toLowerCase();
  if (!key) return "";
  const past = s.entries.filter(e => e.kind === "expense" && e.category && (e.note || "").trim().toLowerCase() === key).sort((a, b) => b.date.localeCompare(a.date))[0];
  if (past) return past.category;
  const all = allCategories(s);
  for (const [re, c] of CATEGORY_HINTS) if (re.test(merchant) && all.includes(c)) return c;
  return "";
}
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
function parseDateFrom(text, now) {
  now = now || today();
  const ok = (y, m, d) => {
    if (y < 100) y += 2000;
    if (m < 1 || m > 12 || d < 1 || d > 31 || y < 2000) return null;
    const v = y + "-" + pad(m) + "-" + pad(d);
    return v <= now && d <= daysIn(v.slice(0, 7)) ? v : null;
  };
  let x;
  if ((x = text.match(/\b(20\d{2})[-/.](\d{1,2})[-/.](\d{1,2})\b/))) { const v = ok(+x[1], +x[2], +x[3]); if (v) return v; }
  if ((x = text.match(/\b(\d{1,2})[ \t]+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?[ \t]+(\d{2,4})\b/i))) { const v = ok(+x[3], MONTHS.indexOf(x[2].toLowerCase()) + 1, +x[1]); if (v) return v; }
  if ((x = text.match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?[ \t]+(\d{1,2}),?[ \t]+(\d{2,4})\b/i))) { const v = ok(+x[3], MONTHS.indexOf(x[1].toLowerCase()) + 1, +x[2]); if (v) return v; }
  if ((x = text.match(/\b(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})\b/))) { const v = ok(+x[3], +x[1], +x[2]) || ok(+x[3], +x[2], +x[1]); if (v) return v; }
  return null;
}
function parseReceipt(text, now) {
  const lines = String(text || "").split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const moneyIn = l => {
    const out = [];
    const re = /(?:₱|PHP|Php|php|\bP)?\s?(\d{1,3}(?:[, ]\d{3})+(?:\.\d{1,2})?|\d+\.\d{2})(?!\d)/g;
    let x;
    while ((x = re.exec(l))) { const v = parseFloat(x[1].replace(/[, ]/g, "")); if (v > 0 && v < 10000000) out.push(v); }
    const sym = l.match(/(?:₱|PHP|Php)\s?(\d+)(?![\d.,])/);
    if (sym) out.push(+sym[1]);
    return out;
  };
  const GOOD = [[/grand\s*total|total\s*amount|amount\s*due|total\s*due|total\s*payment|amount\s*paid|net\s*amount|total\s*sales/i, 3], [/\btotal\b/i, 2], [/\b(amount|payment|paid|sent)\b/i, 1]];
  const BAD = /sub\s*-?\s*total|\bvat\b|vatable|\btax\b|change|cash\b|tender|discount|saving|balance|points|\bqty\b|items?\b|exempt|zero.?rated|fee\b/i;
  const scored = [];
  lines.forEach((l, i) => {
    const vals = moneyIn(l);
    const score = BAD.test(l) ? -1 : (GOOD.find(([re]) => re.test(l)) || [0, 0])[1];
    if (vals.length) vals.forEach(v => scored.push({ v, score }));
    else if (score > 0 && lines[i + 1]) moneyIn(lines[i + 1]).forEach(v => scored.push({ v, score: BAD.test(lines[i + 1]) ? -1 : score }));
  });
  const usable = scored.filter(x => x.score >= 0);
  const best = usable.slice().sort((a, b) => b.score - a.score || b.v - a.v)[0];
  const candidates = [...new Set(scored.slice().sort((a, b) => b.score - a.score || b.v - a.v).map(x => x.v))].slice(0, 5);
  let merchant = "";
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^(?:paid to|merchant(?: name)?|sent to|store|to)(?:\s*[:\-]\s*|\s+|$)(.*)$/i);
    if (m) { merchant = m[1] && /[a-z]{3}/i.test(m[1]) ? m[1] : (lines[i + 1] || ""); break; }
  }
  if (!merchant) merchant = lines.find(l => (l.match(/[a-z]/gi) || []).length >= 3 && !/receipt|invoice|official|transaction|details|\btin\b|vat reg|success|payment|welcome|thank|\d{1,2}:\d{2}|maribank|gcash|^total/i.test(l)) || "";
  merchant = merchant.replace(/[^\p{L}\p{N}&'.\- ]/gu, " ").replace(/\s+/g, " ").trim();
  return { amount: best ? best.v : null, candidates, date: parseDateFrom(lines.join("\n"), now), merchant };
}

/* Checks what Claude returned before it reaches a form. Anything doubtful is left for you to fill in. */
function cleanClaudeReceipt(raw, categories, now) {
  now = now || today();
  const r = raw && typeof raw === "object" ? raw : {};
  const goodAmount = v => typeof v === "number" && isFinite(v) && v > 0 && v < 10000000;
  const amount = goodAmount(r.amount) ? round2(r.amount) : null;
  const others = (Array.isArray(r.other_amounts) ? r.other_amounts : []).filter(goodAmount).map(round2);
  const candidates = [...new Set([...(amount !== null ? [amount] : []), ...others])].slice(0, 5);
  let date = null;
  if (typeof r.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(r.date)) {
    const m = +r.date.slice(5, 7), d = +r.date.slice(8, 10);
    if (m >= 1 && m <= 12 && d >= 1 && d <= daysIn(r.date.slice(0, 7)) && r.date <= now && r.date >= "2000-01-01") date = r.date;
  }
  const text = (v, max) => typeof v === "string" ? v.replace(/\s+/g, " ").trim().slice(0, max) : "";
  return {
    isReceipt: r.is_receipt !== false, amount, candidates, date,
    currency: ["PHP", "USD", "OTHER"].includes(r.currency) ? r.currency : "PHP",
    merchant: text(r.merchant, 60),
    category: (categories || []).includes(r.category) ? r.category : "",
    warning: text(r.warning, 160)
  };
}

/* ---------- categories ---------- */
const DEFAULT_CATEGORIES = {
  business: ["Software & subscriptions", "Contractors & VAs", "Ads & marketing", "Equipment", "Platform & bank fees", "Internet & phone", "Training", "Taxes & registration", "Other business"],
  personal: ["Rent", "Utilities", "Groceries", "Gas", "Toll", "Meat", "Fruits & Veggies", "Furniture", "Pets", "Gifts/Holiday", "Medical", "Activities", "Eat Out", "Other"]
};
const catsOf = (s, scope) => [...((s.categories || DEFAULT_CATEGORIES)[scope] || [])].sort((a, b) => a.localeCompare(b));
const allCategories = s => [...new Set([...catsOf(s, "personal"), ...catsOf(s, "business")])];
const PALETTE = ["#D92D42", "#E8590C", "#C98A00", "#2F9E44", "#0B8F7E", "#0284C7", "#3B5BDB", "#7B3FC4", "#C2277F", "#94603B", "#5C6F87", "#5C8C0A"];
const KNOWN_COLORS = { Rent: "#7B3FC4", Utilities: "#C98A00", Loans: "#D92D42", Groceries: "#0B8F7E", "Entertainment/Memberships": "#D9486E", Gas: "#E8590C", Toll: "#94603B", Meat: "#A61E1E", "Fruits & Veggies": "#5C8C0A", Furniture: "#3B5BDB", Pets: "#94603B", Medical: "#0284C7", "Eat Out": "#C2277F", Other: "#5C6F87" };
function catColor(s, name) {
  const c = (s.catColors || {})[name] || KNOWN_COLORS[name];
  if (c) return c;
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

/* ---------- empty state, backups and moving data from the first app ---------- */
const emptyState = () => ({ v: 2, usdRate: "", accounts: [], streams: [], bills: [], debts: [], budgets: [], oneTime: [], goals: [], skips: {}, categories: JSON.parse(JSON.stringify(DEFAULT_CATEGORIES)), catColors: {}, entries: [] });
function exportBackup(s) { return { app: "Mira Ledger", format: 2, exportedAt: new Date().toISOString(), state: s }; }

/* Accepts this app's backups and the first app's backups (or its saved data). Never edits the input. */
function importBackup(obj) {
  if (!obj || typeof obj !== "object") throw new Error("not a backup");
  if (obj.format === 2 && obj.state && Array.isArray(obj.state.entries)) return { ...emptyState(), ...JSON.parse(JSON.stringify(obj.state)) };
  if (!("settings" in obj) || !obj.entries) throw new Error("not a backup");
  const old = JSON.parse(JSON.stringify(obj.settings || {}));
  const s = { ...emptyState(), ...old, v: 2 };
  s.categories = old.categories || emptyState().categories;
  ["accounts", "streams", "bills", "debts", "budgets", "oneTime", "goals"].forEach(k => { s[k] = Array.isArray(old[k]) ? old[k] : []; });
  s.skips = old.skips || {};
  s.bills = s.bills.map(b => {
    const x = { ...b };
    if (!x.freq) { // the first app stored the monthly total for twice-a-month bills without a frequency
      if (+x.secondDay) { x.freq = "twice"; x.amount = round2((+x.amount || 0) / 2); } else x.freq = "monthly";
    }
    return x;
  });
  const list = Array.isArray(obj.entries) ? obj.entries : Object.values(obj.entries);
  s.entries = list.filter(e => e && e.id && e.date).map(e => ({ ...e, month: undefined }));
  s.entries.forEach(e => delete e.month);
  return s;
}

/* Example data for trying the app. Dates follow today's date. */
function sampleState(now) {
  now = now || today();
  const m = now.slice(0, 7), prev = addMonth(m, -1), d = n => m + "-" + pad(n), p = n => prev + "-" + pad(n);
  const s = emptyState();
  s.usdRate = "58.20";
  s.accounts = [
    { id: "bdo", name: "BDO Savings", type: "Bank", currency: "PHP", start: 42000 },
    { id: "gcash", name: "GCash", type: "E-wallet", currency: "PHP", start: 24200 },
    { id: "maya", name: "Maya", type: "E-wallet", currency: "PHP", start: 1500 },
    { id: "wallet", name: "Upwork wallet", type: "Wallet", currency: "USD", start: 120 },
    { id: "cash", name: "Cash", type: "Cash", currency: "PHP", start: 2000 }
  ];
  const anchor = addDays(p(1), (5 - dparse(p(1)).getDay() + 7) % 7);
  s.streams = [
    { id: "acme", name: "Acme Studio", via: "Agency", accountId: "bdo", expected: 15000, currency: "PHP", freq: "biweekly", anchor },
    { id: "north", name: "Northwind Coaching", via: "Agency", accountId: "bdo", expected: 6200, currency: "PHP", freq: "weekly", anchor },
    { id: "lumen", name: "Lumen Labs", via: "Upwork", accountId: "wallet", expected: 175, currency: "USD", freq: "weekly", anchor }
  ];
  s.debts = [
    { id: "tita", name: "Tita Ana", opening: 5000 },
    { id: "bill", name: "BillEase", opening: 24000 }
  ];
  s.bills = [
    { id: "rent", name: "Rent", amount: 16000, freq: "monthly", by: "date", dueDay: 26, accountId: "bdo", scope: "personal", category: "Rent" },
    { id: "elec", name: "Meralco", amount: 4200, freq: "monthly", by: "date", dueDay: 20, accountId: "gcash", scope: "personal", category: "Utilities", variable: true },
    { id: "net", name: "Fiber internet", amount: 1700, freq: "monthly", by: "date", dueDay: 12, accountId: "gcash", scope: "personal", category: "Utilities" },
    { id: "stream", name: "Netflix", amount: 549, freq: "monthly", by: "date", dueDay: 9, accountId: "gcash", scope: "personal", category: "Other" },
    { id: "be", name: "BillEase", amount: 2000, freq: "twice", by: "date", dueDay: 15, secondDay: 30, accountId: "bdo", scope: "personal", category: "Loans", debtId: "bill" }
  ];
  s.budgets = [
    { id: "gro", name: "", category: "Groceries", amount: 8000, freq: "twice", by: "date", dueDay: 15, secondDay: 30 },
    { id: "gas", name: "", category: "Gas", amount: 4000, freq: "anytime" }
  ];
  s.oneTime = [{ id: "dep", name: "Move-in deposit", amount: 8000, date: d(Math.min(24, daysIn(m))), category: "Other", accountId: "bdo" }];
  /* Recent entries are dated back from today, so the example week always has something in it. */
  const ago = n => { const x = addDays(now, -n); return x < m + "-01" ? m + "-01" : x; };
  const add = (id, o) => { if (o.date <= now) s.entries.push({ id, currency: "PHP", createdAt: o.date + "T09:00:00Z", ...o }); };
  add("p1", { kind: "income", streamId: "acme", accountId: "bdo", amount: 15000, date: p(16), scope: "business" });
  add("p2", { kind: "expense", category: "Groceries", scope: "personal", accountId: "gcash", amount: 6120, date: p(20), note: "Puregold" });
  add("e1", { kind: "income", streamId: "north", accountId: "bdo", amount: 6200, date: ago(2), scope: "business" });
  add("e2", { kind: "borrow", debtId: "tita", accountId: "bdo", amount: 10000, date: ago(5), note: "For the deposit" });
  add("e3", { kind: "expense", category: "Groceries", scope: "personal", accountId: "gcash", amount: 1840, date: ago(1), note: "Puregold" });
  add("e4", { kind: "expense", category: "Eat Out", scope: "personal", accountId: "gcash", amount: 640, date: ago(1), note: "Jollibee" });
  add("e5", { kind: "debt", debtId: "tita", accountId: "gcash", amount: 2000, date: ago(3), scope: "personal", category: "Loans" });
  add("e6", { kind: "expense", category: "Gas", scope: "personal", accountId: "cash", amount: 1500, date: ago(0), note: "Shell" });
  s.entries.push(...["netflix|9|stream|549", "fiber|12|net|1700", "meralco|20|elec|4310", "rent|26|rent|16000"].map(t => { const [id, day, billId, amt] = t.split("|"); return { id: "pb-" + id, kind: "bill", billId, billMonth: prev, billSlot: 1, accountId: billId === "rent" ? "bdo" : "gcash", amount: +amt, currency: "PHP", date: p(+day), createdAt: p(+day) + "T09:00:00Z", category: billId === "rent" ? "Rent" : billId === "stream" ? "Other" : "Utilities", scope: "personal" }; }));
  return s;
}

root.Core = {
  pad, dstr, dparse, daysIn, addMonth, addDays, today, daysBetween, round2, uid,
  acct, bill, debt, stream, defaultRate, entryRate, toPHP, entPHP, inMonth,
  debtIdOf, groupOf, GROUP_LABEL, balances, totalPHP, statement,
  WEEKDAYS, ord, freqOf, occDays, scheduleText, monthlyTimes, monthDiff,
  debtLedger, debtBalance, debtPlan, totalOwed, totalOwedToYou, isOwedToYou, isThing, isMoneyDebt,
  billSlots, billCur, paydayDates, paydays, streamAmount, nextPaydays, paysLeft, oneTimes, budgetTotal, budgetSpent, budgetPace, evalAmount, forecast, balanceSeries, spendPace, weekRanges, weeks, weekStartDay, weekOf, weekPlan, budgetForRange, budgetPlanned, budgetRuns, inBudget,
  categorySpend, incomeByClient, entryTitle, search, buildEntry,
  suggestCategory, parseDateFrom, parseReceipt, cleanClaudeReceipt,
  DEFAULT_CATEGORIES, catsOf, allCategories, catColor, emptyState, exportBackup, importBackup, sampleState
};
})(typeof window !== "undefined" ? window : globalThis);
