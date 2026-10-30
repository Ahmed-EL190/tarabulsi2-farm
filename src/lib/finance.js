// Centralised, pure financial functions. No Firebase imports: fully unit-testable.
// Money is handled per currency; values in different currencies are NEVER summed (see sumByCurrency).

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
/** تاريخ اليوم بالتوقيت المحلي (وليس UTC) كي لا يتأخر/يتقدّم يوم قرب منتصف الليل. */
export const todayISO = () => new Date().toLocaleDateString('en-CA');
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to); // ISO yyyy-mm-dd strings compare lexically

/** Sum {amount,currency} rows -> { SYP: x, USD: y } — never mixes currencies. */
export function sumByCurrency(rows, pick = (r) => r.amount) {
  const out = {};
  for (const r of rows) {
    const c = r.currency || 'SYP';
    out[c] = round2((out[c] || 0) + n(pick(r)));
  }
  return out;
}

/** Explicit conversion only; throws if a rate is missing. */
export function convert(amount, from, to, rates) {
  if (from === to) return n(amount);
  const r = rates?.[`${from}->${to}`];
  if (!r) throw new Error(`Missing exchange rate ${from}->${to}`);
  return round2(n(amount) * r);
}

// ───────────── Milk agreements, deliveries, payments ─────────────
// Policy (docs/ANALYSIS.md): revenue is recognised on DELIVERY. Advances are a liability
// (customer credit) until milk is delivered. Payments are applied oldest-delivery-first (FIFO).

export function agreementPosition(agreement, deliveries = [], payments = []) {
  const ds = deliveries.filter((d) => d.agreementId === agreement.id && !d.voided)
    .sort((a, b) => (a.date + (a.id || '')).localeCompare(b.date + (b.id || '')));
  const ps = payments.filter((p) => p.agreementId === agreement.id && !p.voided);
  const agreedQty = n(agreement.agreedQty);
  const price = (d) => n(d.pricePerLiter ?? agreement.pricePerLiter);
  const deliveredQty = round2(ds.reduce((s, d) => s + n(d.qty), 0));
  const deliveredValue = round2(ds.reduce((s, d) => s + n(d.qty) * price(d), 0));
  const received = round2(ps.filter((p) => p.type !== 'refund').reduce((s, p) => s + n(p.amount), 0));
  const refunded = round2(ps.filter((p) => p.type === 'refund').reduce((s, p) => s + n(p.amount), 0));
  const netReceived = round2(received - refunded);
  let pool = Math.max(netReceived, 0);
  const allocations = ds.map((d) => {
    const value = round2(n(d.qty) * price(d));
    const paid = round2(Math.min(pool, value));
    pool = round2(pool - paid);
    return { deliveryId: d.id, date: d.date, value, paid, due: round2(value - paid) };
  });
  const receivable = round2(allocations.reduce((s, a) => s + a.due, 0));
  const unappliedCredit = round2(pool);
  const contractValue = round2(agreedQty * n(agreement.pricePerLiter));
  const remainingQty = round2(Math.max(agreedQty - deliveredQty, 0));
  let paymentStatus = 'unpaid';
  if (deliveredQty === 0 && netReceived > 0) paymentStatus = 'advance';
  else if (receivable === 0 && deliveredValue > 0) paymentStatus = unappliedCredit > 0 ? 'paid_with_credit' : 'paid';
  else if (netReceived > 0 && receivable > 0) paymentStatus = 'partial';
  const status = agreement.status === 'cancelled' ? 'cancelled' : remainingQty === 0 && agreedQty > 0 ? 'fulfilled' : deliveredQty > 0 ? 'in_progress' : 'open';
  return { agreedQty, contractValue, deliveredQty, remainingQty, overDelivered: deliveredQty > agreedQty, deliveredValue,
    received, refunded, netReceived, allocations, receivable, unappliedCredit, paymentStatus, status };
}

/** Customer position across agreements. Unlinked payments (no agreementId) are applied to receivables oldest-first. */
export function customerPosition(customerId, { agreements = [], deliveries = [], payments = [] }) {
  const mine = agreements.filter((a) => a.customerId === customerId);
  const positions = mine.map((a) => ({ agreement: a, ...agreementPosition(a, deliveries, payments) }))
    .sort((x, y) => x.agreement.date.localeCompare(y.agreement.date));
  const general = payments.filter((p) => p.customerId === customerId && !p.agreementId && !p.voided);
  let generalPool = round2(general.reduce((s, p) => s + (p.type === 'refund' ? -n(p.amount) : n(p.amount)), 0));
  let receivable = 0, credit = 0;
  for (const p of positions) {
    const use = Math.min(Math.max(generalPool, 0), p.receivable);
    receivable = round2(receivable + p.receivable - use);
    generalPool = round2(generalPool - use);
    credit = round2(credit + p.unappliedCredit);
  }
  credit = round2(credit + Math.max(generalPool, 0));
  return { positions, receivable, unappliedCredit: credit,
    deliveredValue: round2(positions.reduce((s, p) => s + p.deliveredValue, 0)),
    deliveredQty: round2(positions.reduce((s, p) => s + p.deliveredQty, 0)) };
}

/** Statement with running balance. Positive balance = customer owes farm; negative = customer credit. */
export function customerStatement(customerId, { agreements, deliveries, payments, from, to, openingBalance = 0 }) {
  const myA = new Set(agreements.filter((a) => a.customerId === customerId).map((a) => a.id));
  const lines = [];
  for (const d of deliveries) if (myA.has(d.agreementId) && !d.voided) {
    const ag = agreements.find((a) => a.id === d.agreementId);
    lines.push({ date: d.date, kind: 'delivery', ref: d.agreementId, qty: n(d.qty), debit: round2(n(d.qty) * n(d.pricePerLiter ?? ag?.pricePerLiter)), credit: 0 });
  }
  for (const p of payments) if ((p.customerId === customerId || myA.has(p.agreementId)) && !p.voided)
    lines.push(p.type === 'refund' ? { date: p.date, kind: 'refund', ref: p.id, debit: n(p.amount), credit: 0 } : { date: p.date, kind: 'payment', ref: p.id, debit: 0, credit: n(p.amount) });
  lines.sort((a, b) => a.date.localeCompare(b.date));
  let bal = n(openingBalance);
  lines.filter((l) => from && l.date < from).forEach((l) => (bal = round2(bal + l.debit - l.credit)));
  const opening = bal;
  const rows = lines.filter((l) => inRange(l.date, from, to)).map((l) => ({ ...l, balance: (bal = round2(bal + l.debit - l.credit)) }));
  return { opening, rows, closing: bal,
    totalDebit: round2(rows.reduce((s, r) => s + r.debit, 0)), totalCredit: round2(rows.reduce((s, r) => s + r.credit, 0)) };
}

export function validateDelivery(agreement, deliveries, qty) {
  const delivered = deliveries.filter((d) => d.agreementId === agreement.id && !d.voided).reduce((s, d) => s + n(d.qty), 0);
  const remaining = round2(n(agreement.agreedQty) - delivered);
  return n(qty) > 0 && n(qty) <= remaining + 1e-9 ? { ok: true, remaining } : { ok: false, remaining };
}

// ───────────── Partner loans & capital ─────────────
const daysBetween = (a, b) => Math.max(0, Math.round((new Date(b) - new Date(a)) / 86400000));

/** loan: {principal, disbursementDate, interestRate (annual %), adjustments:[{amount,date}]}
 *  repayments: [{loanId,date,principalAmount,interestAmount}] — interest and principal are tracked separately. */
export function loanPosition(loan, repayments = [], asOf = todayISO()) {
  const reps = repayments.filter((r) => r.loanId === loan.id && !r.voided && r.date <= asOf);
  const adj = (loan.adjustments || []).filter((a) => a.date <= asOf);
  const principalRepaid = round2(reps.reduce((s, r) => s + n(r.principalAmount), 0));
  const interestPaid = round2(reps.reduce((s, r) => s + n(r.interestAmount), 0));
  const outstandingPrincipal = round2(n(loan.principal) + adj.reduce((s, a) => s + n(a.amount), 0) - principalRepaid);
  const events = [
    { date: loan.disbursementDate, delta: n(loan.principal) },
    ...adj.map((a) => ({ date: a.date, delta: n(a.amount) })),
    ...reps.map((r) => ({ date: r.date, delta: -n(r.principalAmount) })),
  ].sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0, last = loan.disbursementDate, accrued = 0;
  for (const e of events) { accrued += bal * (n(loan.interestRate) / 100) * daysBetween(last, e.date) / 365; bal += e.delta; last = e.date; }
  accrued += bal * (n(loan.interestRate) / 100) * daysBetween(last, asOf) / 365;
  accrued = round2(accrued);
  return { principalRepaid, interestPaid, outstandingPrincipal, interestAccrued: accrued, interestDue: round2(accrued - interestPaid),
    status: outstandingPrincipal <= 0 ? 'closed' : 'active' };
}

/** Partner ledger. Positive balance = farm owes partner. Profit ALLOCATION is separate from cash DISTRIBUTION. */
const LEDGER_SIGN = {
  opening_balance: 1, capital_contribution: 1, additional_capital: 1, loan_given: 1, loan_principal_repayment: -1,
  interest_accrued: 1, interest_paid: -1, expense_paid_personally: 1, reimbursement: -1, withdrawal: -1,
  profit_allocation: 1, profit_distribution: -1, adjustment: 1,
};
export const LEDGER_TYPES = Object.keys(LEDGER_SIGN);
export function partnerLedger(partnerId, entries, { currency, from, to } = {}) {
  const mine = entries.filter((e) => e.partnerId === partnerId && !e.voided && (!currency || e.currency === currency))
    .sort((a, b) => a.date.localeCompare(b.date));
  let bal = 0; const rows = [];
  for (const e of mine) {
    const delta = round2((LEDGER_SIGN[e.type] ?? 0) * n(e.amount));
    bal = round2(bal + delta);
    if (inRange(e.date, from, to)) rows.push({ ...e, delta, balance: bal });
  }
  const totals = {};
  for (const e of mine.filter((x) => inRange(x.date, from, to))) totals[e.type] = round2((totals[e.type] || 0) + n(e.amount));
  return { rows, totals, closing: bal };
}

/** رأس مال الشريك: المودَع − المستخدم في شراء المواشي (المشتريات التي سُجّلت «من رأس مال الشريك» ولا علاقة لها بالصندوق).
 *  قيود الدفتر المرتبطة بحيوان (animalId) هي أثر تحويلات قديمة فلا تُحسب مودَعاً. */
export function partnerCapital(partner, ledger = [], events = [], animals = [], currency = 'SYP') {
  const gone = new Set(animals.filter((a) => a.voided).map((a) => a.id));
  const mine = ledger.filter((e) => e.partnerId === partner.id && !e.voided && !e.animalId && (e.currency || 'SYP') === currency && ['capital_contribution', 'additional_capital'].includes(e.type));
  const initialInLedger = mine.some((e) => e.opening);
  const deposited = round2(mine.reduce((s, e) => s + n(e.amount), 0) + (!initialInLedger && currency === 'SYP' ? n(partner.initialCapital) : 0));
  const purchases = events.filter((e) => !e.voided && e.type === 'purchase' && e.paidFrom === 'capital' && e.capitalPartnerId === partner.id && (e.currency || 'SYP') === currency && !gone.has(e.animalId));
  const used = round2(purchases.reduce((s, e) => s + n(e.value), 0));
  return { deposited, used, remaining: round2(deposited - used), purchases };
}

/** Partner-funded expense: the expense is recorded ONCE; the ledger gets a linked entry (no second expense). */
export function partnerFundedExpenseEntry(expense, payment) {
  return { partnerId: payment.partnerId, date: payment.date, type: 'expense_paid_personally', amount: payment.amount,
    currency: expense.currency, expenseId: expense.id, expensePaymentId: payment.id };
}

// ───────────── Expenses ─────────────
export function expensePosition(expense, payments = []) {
  const paid = round2(payments.filter((p) => p.expenseId === expense.id && !p.voided).reduce((s, p) => s + n(p.amount), 0));
  const outstanding = round2(n(expense.amount) - paid);
  return { paid, outstanding, status: paid <= 0 ? 'unpaid' : outstanding > 0 ? 'partial' : outstanding === 0 ? 'paid' : 'overpaid' };
}
export function validateExpensePayment(expense, payments, amount) {
  const { outstanding } = expensePosition(expense, payments);
  return n(amount) > 0 && n(amount) <= outstanding + 1e-9 ? { ok: true, outstanding } : { ok: false, outstanding };
}
/** Loan principal repayments and partner withdrawals are NOT operating expenses. */
export const NON_OPERATING = new Set(['loan_principal', 'partner_withdrawal', 'partner_advance']);
export function operatingExpenses(expenses, { from, to, currency } = {}) {
  return expenses.filter((e) => !e.voided && inRange(e.date, from, to) && (!currency || e.currency === currency) && !NON_OPERATING.has(e.category));
}

// ───────────── Cash ─────────────
const IN_TYPES = new Set(['customer_payment', 'other_income', 'animal_sale', 'loan_received', 'capital_contribution', 'transfer_in', 'opening_balance', 'animal_exchange_receipt']);
const isIn = (t) => (t.direction ? t.direction === 'in' : IN_TYPES.has(t.type));
export function cashBalances(txs) {
  const out = {};
  for (const t of txs) {
    if (t.voided) continue;
    const k = `${t.accountId}|${t.currency}`;
    out[k] = round2((out[k] || 0) + (isIn(t) ? 1 : -1) * n(t.amount));
  }
  return out;
}
/** A transfer yields two linked rows; they never count as income or expense. */
export function makeTransfer({ date, fromAccountId, toAccountId, amount, currency, description, id }) {
  return [
    { id: `${id}-out`, date, type: 'transfer_out', direction: 'out', accountId: fromAccountId, amount, currency, transferId: id, description },
    { id: `${id}-in`, date, type: 'transfer_in', direction: 'in', accountId: toAccountId, amount, currency, transferId: id, description },
  ];
}
export function cashFlowSummary(txs, { from, to, currency } = {}) {
  const rows = txs.filter((t) => !t.voided && inRange(t.date, from, to) && (!currency || t.currency === currency)
    && !String(t.type).startsWith('transfer') && t.type !== 'opening_balance');
  const inflow = {}, outflow = {};
  for (const t of rows) { const b = isIn(t) ? inflow : outflow; b[t.type] = round2((b[t.type] || 0) + n(t.amount)); }
  const sum = (o) => round2(Object.values(o).reduce((s, v) => s + v, 0));
  return { inflow, outflow, totalIn: sum(inflow), totalOut: sum(outflow), net: round2(sum(inflow) - sum(outflow)) };
}

// ───────────── Profit & settlement ─────────────
/** Accrual P&L: milk revenue = DELIVERED value (not cash). Animal purchases follow the workbook (expense) unless configured. */
export function profitAndLoss({ deliveries = [], agreements = [], expenses = [], otherIncome = [], animalSales = [], animalPurchases = [], from, to, currency = 'SYP', animalPurchaseAsExpense = true }) {
  const price = (d) => n(d.pricePerLiter ?? agreements.find((a) => a.id === d.agreementId)?.pricePerLiter);
  const agCur = (d) => agreements.find((a) => a.id === d.agreementId)?.currency || 'SYP';
  const sum = (rows) => round2(rows.reduce((s, x) => s + n(x.amount), 0));
  const milkRevenue = round2(deliveries.filter((d) => !d.voided && inRange(d.date, from, to) && agCur(d) === currency).reduce((s, d) => s + n(d.qty) * price(d), 0));
  const other = sum(otherIncome.filter((x) => inRange(x.date, from, to) && x.currency === currency));
  const animals = sum(animalSales.filter((x) => inRange(x.date, from, to) && x.currency === currency));
  const opex = sum(operatingExpenses(expenses, { from, to, currency }));
  const purchases = animalPurchaseAsExpense ? sum(animalPurchases.filter((x) => inRange(x.date, from, to) && x.currency === currency)) : 0;
  const revenue = round2(milkRevenue + other + animals);
  const totalExpenses = round2(opex + purchases);
  return { milkRevenue, otherIncome: other, animalSales: animals, revenue, operatingExpenses: opex, animalPurchases: purchases, totalExpenses, netProfit: round2(revenue - totalExpenses) };
}
export function validateShares(partners, key = 'profitSharePct') {
  const total = round2(partners.reduce((s, p) => s + n(p[key]), 0));
  return { ok: total === 100, total };
}
/** Allocation only — creates NO cash movement. Remainder cents go to the first partner so parts sum exactly. */
export function allocateProfit(netProfit, partners) {
  const v = validateShares(partners);
  if (!v.ok) throw new Error(`Profit-sharing percentages total ${v.total}%, expected 100%`);
  const raw = partners.map((p) => ({ partnerId: p.id, amount: Math.floor(netProfit * n(p.profitSharePct)) / 100 }));
  raw[0].amount += round2(netProfit - raw.reduce((s, r) => s + r.amount, 0));
  return raw.map((r) => ({ ...r, amount: round2(r.amount) }));
}

/** مدخلات الأرباح الخاصة بالمواشي — مصدر واحد للتسويات والتقارير.
 *  asExpense=true : الشراء مصروف، والبيع إيراد كامل (كما في ملف Excel الأصلي).
 *  asExpense=false: لا يُحتسب الشراء، ويُحتسب في البيع الربح/الخسارة فقط (سعر البيع − تكلفة الحيوان).
 *  التبادل = بيع للحيوان الخارج بقيمته المتفق عليها + شراء للحيوان الوارد (فقط لو سُجّل جديداً عبر التبادل، لتفادي تكرار شراء سُجّل سابقاً). */
export function animalPLInputs(events = [], animals = [], asExpense = true) {
  const byId = Object.fromEntries(animals.map((a) => [a.id, a]));
  const cost = (id) => n(byId[id]?.acquisitionCost);
  const animalSales = [], animalPurchases = [];
  for (const e of events) {
    if (e.voided || byId[e.animalId]?.voided) continue;
    const row = (amount) => ({ date: e.date, currency: e.currency || 'SYP', amount });
    if (e.type === 'sale') animalSales.push(row(asExpense ? n(e.value) : round2(n(e.value) - n(e.costBasis ?? cost(e.animalId)))));
    else if (e.type === 'exchange_out') animalSales.push(row(asExpense ? n(e.value) : round2(n(e.value) - cost(e.animalId))));
    else if (asExpense && n(e.value) > 0 && (e.type === 'purchase' || (e.type === 'exchange_in' && byId[e.animalId]?.viaExchange))) animalPurchases.push(row(n(e.value)));
  }
  return { animalSales, animalPurchases };
}

// ───────────── Animals ─────────────
const ACTIVE_ADD = new Set(['purchase', 'birth', 'exchange_in', 'transfer_in', 'opening']);
const ACTIVE_REMOVE = new Set(['sale', 'death', 'transfer_out', 'exchange_out']);
export function herdState(events, animals = null) {
  const state = {};
  const gone = animals ? new Set(animals.filter((a) => a.voided).map((a) => a.id)) : null; // حيوانات ملغاة لا تُحسب في القطيع
  // نفس اليوم: الدخول قبل الخروج (شراء ثم بيع في نفس اليوم لا يُبقي الحيوان "نشطاً" بالغلط)
  for (const e of [...events].filter((x) => !x.voided && !(gone && gone.has(x.animalId))).sort((a, b) => a.date.localeCompare(b.date) || (ACTIVE_ADD.has(b.type) ? 1 : 0) - (ACTIVE_ADD.has(a.type) ? 1 : 0))) {
    if (ACTIVE_ADD.has(e.type)) state[e.animalId] = { active: true, since: e.date, last: e.type };
    else if (ACTIVE_REMOVE.has(e.type)) state[e.animalId] = { ...(state[e.animalId] || {}), active: false, last: e.type, endDate: e.date };
  }
  return state;
}
export const activeHerdCount = (events) => Object.values(herdState(events)).filter((s) => s.active).length;
export function validateNewAnimal(tag, existing) {
  const t = String(tag || '').trim().toLowerCase();
  if (!t) return { ok: false, reason: 'missing' };
  return existing.some((a) => String(a.tag).trim().toLowerCase() === t && !a.voided) ? { ok: false, reason: 'duplicate' } : { ok: true };
}
/** Exchange: old animal out at agreed value, new in at agreed value, cash difference settled. diff>0: farm pays. */
export function animalExchange({ date, oldAnimalId, newAnimalId, oldValue, newValue, currency }) {
  const diff = round2(n(newValue) - n(oldValue));
  const cash = diff === 0 ? [] : [{ date, type: diff > 0 ? 'animal_exchange_payment' : 'animal_exchange_receipt', direction: diff > 0 ? 'out' : 'in', amount: Math.abs(diff), currency }];
  return { events: [{ date, type: 'exchange_out', animalId: oldAnimalId, value: oldValue }, { date, type: 'exchange_in', animalId: newAnimalId, value: newValue }], cashDifference: diff, cash };
}

// ───────────── All sales (milk + animals + other income) ─────────────
/** One unified sales list. Milk is recognised on delivery; animal sales and other income are cash sales into the same cashbox. */
export function salesLedger({ deliveries = [], agreements = [], animalEvents = [], cashTransactions = [], customers = [] }, { from, to, currency } = {}) {
  const rows = [];
  for (const d of deliveries) {
    if (d.voided) continue;
    const ag = agreements.find((a) => a.id === d.agreementId);
    rows.push({ id: `d${d.id}`, date: d.date, kind: 'milk', ref: ag?.number || '', party: customers.find((c) => c.id === d.customerId)?.name || '', qty: n(d.qty),
      amount: round2(n(d.qty) * n(d.pricePerLiter ?? ag?.pricePerLiter)), currency: ag?.currency || d.currency || 'SYP', description: 'حليب' });
  }
  for (const e of animalEvents) if (e.type === 'sale' && !e.voided)
    rows.push({ id: `a${e.id}`, date: e.date, kind: 'animal', ref: e.tag || '', party: e.buyerName || '', qty: 1, amount: n(e.value), currency: e.currency || 'SYP', description: `بيع حيوان ${e.tag || ''}` });
  for (const t of cashTransactions) if (t.type === 'other_income' && !t.voided)
    rows.push({ id: `o${t.id}`, date: t.date, kind: 'other', ref: '', party: '', qty: null, amount: n(t.amount), currency: t.currency || 'SYP', description: t.description || 'إيراد آخر' });
  return rows.filter((r) => inRange(r.date, from, to) && (!currency || r.currency === currency)).sort((a, b) => a.date.localeCompare(b.date));
}
export function salesTotals(rows) {
  const byKind = {};
  for (const k of ['milk', 'animal', 'other']) byKind[k] = sumByCurrency(rows.filter((r) => r.kind === k), (r) => r.amount);
  return { byKind, total: sumByCurrency(rows, (r) => r.amount) };
}

// ───────────── Animal profile (age, milk, treatment, sale result — as in the Excel animals sheet) ─────────────
export const monthsBetween = (a, b) => Math.max(0, Math.floor(daysBetween(a, b) / 30.4375));
export function animalProfile(animal, { events = [], production = [], expenses = [] } = {}, asOf = todayISO()) {
  const sale = events.find((e) => e.animalId === animal.id && e.type === 'sale' && !e.voided);
  const end = sale?.date || asOf;
  const hasAge = animal.ageAtPurchaseMonths !== undefined && animal.ageAtPurchaseMonths !== '' && animal.ageAtPurchaseMonths !== null;
  const ageMonths = animal.birthDate ? monthsBetween(animal.birthDate, end) : hasAge && animal.acquisitionDate ? n(animal.ageAtPurchaseMonths) + monthsBetween(animal.acquisitionDate, end) : null;
  const milk = production.filter((p) => !p.voided && (p.animalId === animal.id || (!p.animalId && p.group && String(p.group).trim() === String(animal.tag).trim())));
  const milkTotal = round2(milk.reduce((s, p) => s + n(p.liters), 0));
  const milkDays = new Set(milk.filter((p) => n(p.liters) > 0).map((p) => p.date)).size;
  const treatmentCost = round2(expenses.filter((e) => !e.voided && e.animalId === animal.id && e.category === 'vet').reduce((s, e) => s + n(e.amount), 0));
  let expectedBirthDate = null, daysToCalving = null;
  if (animal.pregnant === 'yes' && animal.daysToBirth !== undefined && animal.daysToBirth !== '' && animal.daysToBirth !== null && animal.acquisitionDate) {
    const dt = new Date(animal.acquisitionDate); dt.setUTCDate(dt.getUTCDate() + n(animal.daysToBirth)); expectedBirthDate = dt.toISOString().slice(0, 10);
    const calved = events.some((e) => !e.voided && e.type === 'birth' && e.motherId === animal.id && e.date >= animal.acquisitionDate);
    if (!calved && !sale) daysToCalving = Math.round((new Date(expectedBirthDate) - new Date(asOf)) / 86400000); // negative = overdue
  }
  return { expectedBirthDate, daysToCalving, ageMonths, milkTotal, milkDays, milkAvg: milkDays ? round2(milkTotal / milkDays) : 0, treatmentCost,
    salePrice: sale ? n(sale.value) : null, saleDate: sale?.date || null, saleResult: sale ? round2(n(sale.value) - n(animal.acquisitionCost)) : null };
}
