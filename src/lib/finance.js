// Centralised, pure financial functions. No Firebase imports: fully unit-testable.
// Money is handled per currency; values in different currencies are NEVER summed (see sumByCurrency).

const n = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
export const round2 = (v) => Math.round((n(v) + Number.EPSILON) * 100) / 100;
/** تاريخ اليوم بالتوقيت المحلي (وليس UTC) كي لا يتأخر/يتقدّم يوم قرب منتصف الليل. */
export const todayISO = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const inRange = (d, from, to) => (!from || d >= from) && (!to || d <= to); // ISO yyyy-mm-dd strings compare lexically

/** أسماء الشهور الميلادية (يناير، فبراير…) — مصدر واحد لكل الموقع. */
export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'];
/** '2026-11' ← 'نوفمبر 2026' */
export const monthLabel = (ym) => { const m = Number(String(ym).slice(5, 7)); return MONTHS_AR[m - 1] ? `${MONTHS_AR[m - 1]} ${String(ym).slice(0, 4)}` : String(ym); };
/** تاريخ طويل: الأربعاء 18 نوفمبر 2026 (أرقام إنجليزية وأسماء شهور ميلادية). */
export const longDateAr = (d = new Date()) => `${new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(d)} ${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`;

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
export function customerStatement(customerId, { agreements, deliveries, payments, from, to, openingBalance = 0, expenses = [], expensePayments = [] }) {
  const myA = new Set(agreements.filter((a) => a.customerId === customerId).map((a) => a.id));
  const lines = [];
  for (const d of deliveries) if (myA.has(d.agreementId) && !d.voided) {
    const ag = agreements.find((a) => a.id === d.agreementId);
    lines.push({ date: d.date, kind: 'delivery', ref: d.agreementId, qty: n(d.qty), debit: round2(n(d.qty) * n(d.pricePerLiter ?? ag?.pricePerLiter)), credit: 0 });
  }
  for (const p of payments) if ((p.customerId === customerId || myA.has(p.agreementId)) && !p.voided)
    lines.push(p.type === 'refund' ? { date: p.date, kind: 'refund', ref: p.id, debit: n(p.amount), credit: 0 } : { date: p.date, kind: 'payment', ref: p.id, debit: 0, credit: n(p.amount) });
  // مشتريات آجلة من هذا الشخص كمورّد: فاتورته «له علينا» (دائن)، وما دفعناه له «عليه» (مدين) — فيظهر الصافي في نفس الكشف
  const myE = expenses.filter((e) => e.supplierId === customerId && !e.voided); const myEIds = new Set(myE.map((e) => e.id));
  for (const e of myE) lines.push({ date: e.date, kind: 'purchase', ref: e.id, debit: 0, credit: n(e.amount) });
  for (const p of expensePayments) if (myEIds.has(p.expenseId) && !p.voided) lines.push({ date: p.date, kind: 'supplier_payment', ref: p.id, expenseId: p.expenseId, debit: n(p.amount), credit: 0 });
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
  profit_allocation: 1, profit_distribution: -1, adjustment: 1, animal_purchase_paid: 1, animal_purchase_repaid: -1, partner_advance: -1,
  animal_loss_charge: -1, animal_gain_credit: 1, // خسارة/ربح تبادل حيوانات يتحمّلها الشريك (لا تمسّ ربح المزرعة)
};
export const LEDGER_TYPES = Object.keys(LEDGER_SIGN);
export function partnerLedger(partnerId, entries, { currency, from, to } = {}) {
  // رأس المال الابتدائي القديم (والقيود الناتجة عن تحويلات رأس المال القديمة) لم يعد جزءاً من حساب الشريك
  const mine = entries.filter((e) => e.partnerId === partnerId && !e.voided && !(e.type === 'capital_contribution' && (e.opening || e.animalId)) && (!currency || e.currency === currency))
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

/** ما على المزرعة لشريك — ثلاثة أبواب تزيد تلقائياً وتنقص عند السداد:
 *  loans: سلف أعطاها للمزرعة · purchases: ثمن حيوانات دفعها (أو اشتريناها منه) · other: مصروفات دفعها من ماله + مبالغ زائدة أودعها. */
export function partnerDebt(partnerId, ledger = [], currency = 'SYP') {
  const mine = ledger.filter((e) => e.partnerId === partnerId && !e.voided && !(e.type === 'capital_contribution' && (e.opening || e.animalId)) && (e.currency || 'SYP') === currency);
  const sum = (...ts) => round2(mine.filter((e) => ts.includes(e.type)).reduce((s, e) => s + n(e.amount), 0));
  const loans = round2(sum('loan_given') - sum('loan_principal_repayment'));
  const purchases = round2(sum('animal_purchase_paid') - sum('animal_purchase_repaid'));
  const advances = sum('partner_advance'); // سلف أخذها الشريك من المزرعة: تُخصم مما نستحقه له
  const other = round2(sum('expense_paid_personally', 'additional_capital', 'capital_contribution', 'animal_gain_credit') - sum('reimbursement', 'animal_loss_charge') - advances);
  return { loans, purchases, other, total: round2(loans + purchases + other), loansTotal: sum('loan_given'), purchasesTotal: sum('animal_purchase_paid'), withdrawals: sum('withdrawal'), advances, distributions: sum('profit_distribution') };
}
/** يوزّع مبلغ السداد على الأبواب الثلاثة: الافتراضي سلف ← ثمن بقر ← مصروفات/مبالغ؛ أو ثمن البقر أولاً؛ أو باب واحد فقط. يرمي خطأ لو المبلغ أكبر من المستحق. */
export function planPartnerRepayment({ loans, purchases, other = 0, amount, order = 'loans_first' }) {
  const amt = round2(amount); if (!(amt > 0)) throw new Error('أدخل مبلغاً أكبر من صفر');
  const room = { loans: Math.max(0, n(loans)), purchases: Math.max(0, n(purchases)), other: Math.max(0, n(other)) };
  const seq = { loans_first: ['loans', 'purchases', 'other'], purchases_first: ['purchases', 'loans', 'other'], loans_only: ['loans'], purchases_only: ['purchases'], other_only: ['other'] }[order] || ['loans', 'purchases', 'other'];
  const cap = round2(seq.reduce((s, k) => s + room[k], 0));
  if (amt > cap + 0.005) throw new Error(`المبلغ أكبر من المستحق (${cap}) حسب الاختيار`);
  let left = amt; const out = { loans: 0, purchases: 0, other: 0 };
  for (const k of seq) { const take = Math.min(left, room[k]); out[k] = round2(take); left = round2(left - take); }
  return { toLoans: out.loans, toPurchases: out.purchases, toOther: out.other };
}
/** يوزّع مبلغاً على قروض الشريك النشطة: الأقدم أولاً. */
export function allocateToLoans(partnerId, loans = [], repayments = [], amount, currency = 'SYP') {
  let left = round2(amount); const out = [];
  for (const l of loans.filter((x) => !x.voided && x.partnerId === partnerId && (x.currency || 'SYP') === currency).sort((a, b) => (a.disbursementDate || '').localeCompare(b.disbursementDate || ''))) {
    if (left <= 0) break; const open = loanPosition(l, repayments).outstandingPrincipal; if (open <= 0) continue;
    const take = round2(Math.min(open, left)); out.push({ loan: l, principal: take }); left = round2(left - take);
  }
  return { parts: out, unallocated: left };
}
/** حركات صندوق «يتيمة»: أصلها (مصروف/دفعة/حيوان/قيد) ملغى أو محذوف لكنها ما زالت تُحتسب في الصندوق وتظهر في الكشف. */
export function findOrphanCash({ cash = [], expensePays = [], expenses = [], custPays = [], animals = [], ledger = [], events = [] }) {
  const byId = (arr) => Object.fromEntries(arr.map((x) => [x.id, x]));
  const EP = byId(expensePays), EX = byId(expenses), CP = byId(custPays), AN = byId(animals), LE = byId(ledger);
  const out = [];
  for (const t of cash) {
    if (t.voided) continue; let why = '';
    if (t.expensePaymentId) { const p = EP[t.expensePaymentId]; const e = p && EX[p.expenseId]; if (!p || p.voided) why = 'دفعة مصروف ملغاة'; else if (!e || e.voided) why = 'مصروف ملغى'; }
    else if (t.expenseId && (!EX[t.expenseId] || EX[t.expenseId].voided)) why = 'مصروف ملغى';
    if (!why && t.customerPaymentId) { const p = CP[t.customerPaymentId]; if (!p || p.voided) why = 'دفعة عميل ملغاة'; }
    if (!why && t.animalId && ['animal_purchase', 'animal_sale'].includes(t.type)) { const a = AN[t.animalId]; if (!a || a.voided) why = 'حيوان ملغى'; }
    if (!why && t.ledgerEntryId) { const l = LE[t.ledgerEntryId]; if (!l || l.voided) why = 'قيد شريك ملغى'; }
    if (!why && t.exchangeId) { const evs = events.filter((e) => e.exchangeId === t.exchangeId); if (evs.length && evs.every((e) => e.voided)) why = 'تبادل ملغى'; }
    if (why) out.push({ tx: t, reason: why });
  }
  return out;
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
/** ما علينا لهذا المورّد (فواتير مشتريات غير مسدَّدة) بعملة واحدة. */
export function supplierPayable(customerId, expenses = [], payments = [], currency = 'SYP') {
  return round2(expenses.filter((e) => e.supplierId === customerId && !e.voided && (e.currency || 'SYP') === currency).reduce((t, e) => t + Math.max(0, expensePosition(e, payments).outstanding), 0));
}
export function validateExpensePayment(expense, payments, amount) {
  const { outstanding } = expensePosition(expense, payments);
  return n(amount) > 0 && n(amount) <= outstanding + 1e-9 ? { ok: true, outstanding } : { ok: false, outstanding };
}
/** Loan principal repayments and partner withdrawals are NOT operating expenses. */
export const NON_OPERATING = new Set(['loan_principal', 'partner_withdrawal', 'partner_advance', 'equipment']); // المعدات رأس مال وليست مصروف تشغيل
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
export function profitAndLoss({ deliveries = [], agreements = [], expenses = [], otherIncome = [], animalSales = [], animalPurchases = [], exchangeResults = [], deathLosses = [], stockConsumption = [], from, to, currency = 'SYP', animalPurchaseAsExpense = true }) {
  const price = (d) => n(d.pricePerLiter ?? agreements.find((a) => a.id === d.agreementId)?.pricePerLiter);
  const agCur = (d) => agreements.find((a) => a.id === d.agreementId)?.currency || 'SYP';
  const sum = (rows) => round2(rows.reduce((s, x) => s + n(x.amount), 0));
  const milkRevenue = round2(deliveries.filter((d) => !d.voided && inRange(d.date, from, to) && agCur(d) === currency).reduce((s, d) => s + n(d.qty) * price(d), 0));
  const other = sum(otherIncome.filter((x) => inRange(x.date, from, to) && x.currency === currency));
  const animals = sum(animalSales.filter((x) => inRange(x.date, from, to) && x.currency === currency));
  const opex = sum(operatingExpenses(expenses, { from, to, currency }));
  const purchases = animalPurchaseAsExpense ? sum(animalPurchases.filter((x) => inRange(x.date, from, to) && x.currency === currency)) : 0;
  const revenue = round2(milkRevenue + other + animals);
  // تكلفة العلف/المخزون المستهلك في الفترة (بالمتوسط المرجّح) بدل شرائه — انظر stockCosting
  const consumptionCost = round2(stockConsumption.filter((x) => inRange(x.date, from, to) && (x.currency || 'SYP') === currency).reduce((t, x) => t + n(x.amount), 0));
  const totalExpenses = round2(opex + purchases + consumptionCost);
  // خسارة نفوق الحيوانات (سعر شرائها) تدخل الأرباح فتتقاسمها الأثلاث
  const deathLoss = round2(deathLosses.filter((x) => inRange(x.date, from, to) && (x.currency || 'SYP') === currency).reduce((t, x) => t + n(x.amount), 0));
  // نتيجة تبادل الحيوانات التي اختير أن تكون على المزرعة (ربح موجب / خسارة سالبة)
  const exchangeResult = round2(exchangeResults.filter((x) => inRange(x.date, from, to) && (x.currency || 'SYP') === currency).reduce((t, x) => t + n(x.amount), 0));
  return { milkRevenue, otherIncome: other, animalSales: animals, revenue, operatingExpenses: opex, animalPurchases: purchases, totalExpenses, stockConsumption: consumptionCost, exchangeResult, deathLoss, netProfit: round2(revenue - totalExpenses + exchangeResult + deathLoss) };
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

// ───────────── رأس مال الشركاء + توزيع الأرباح بالأثلاث ─────────────
/** مجموعة الشريك: owners = شريك ملكية (يدفع رأس المال ويأخذ ثلثه + ثلث المزرعة) · side = شريك ربح فقط (يشاركه ثلث الأرباح).
 *  لو لم تُحدَّد: من له نسبة ملكية > 0 فهو من الملاك. */
export const profitGroupOf = (p) => {
  if (p?.profitGroup === 'farm') return 'farm';
  if (p?.profitGroup === 'owners') return 'owners';
  // سجل اسمه «المزرعة» هو حساب ثلث رأس المال، حتى لو كان محفوظاً بالخطأ كـ«شريك ربح فقط»
  if (/^\s*(حساب\s*)?(ال)?مزرعة\s*$/.test(String(p?.name || ''))) return 'farm';
  if (p?.profitGroup === 'side') return 'side';
  return n(p?.ownershipPct) > 0 ? 'owners' : 'side';
};

/** رأس مال الشريك = ثمن البقر الذي دفعه + المعدات التي دفعها (فئة «معدات»). يُحسب تلقائياً من حسابه، حتى تاريخ `to` إن وُجد. */
export function partnerInvestment(partnerId, { ledger = [], expenses = [], animals = [] } = {}, { currency = 'SYP', to } = {}) {
  const gone = new Set(animals.filter((a) => a.voided).map((a) => a.id));
  const equip = new Set(expenses.filter((e) => !e.voided && e.category === 'equipment').map((e) => e.id));
  const mine = ledger.filter((e) => e.partnerId === partnerId && !e.voided && (e.currency || 'SYP') === currency && (!to || e.date <= to));
  const sum = (rows) => round2(rows.reduce((t, e) => t + n(e.amount), 0));
  const cows = sum(mine.filter((e) => e.type === 'animal_purchase_paid' && !(e.animalId && gone.has(e.animalId))));
  const equipment = sum(mine.filter((e) => e.type === 'expense_paid_personally' && e.expenseId && equip.has(e.expenseId)));
  return { cows, equipment, total: round2(cows + equipment) };
}

// يقسم مبلغاً على أوزان بدقة قرش واحد؛ الباقي يذهب لصاحب أكبر وزن فيكون المجموع مطابقاً تماماً.
function splitByWeights(amount, weights) {
  const tot = weights.reduce((a, w) => a + w, 0);
  const raw = weights.map((w) => Math.floor((amount * w / tot) * 100) / 100);
  const rem = round2(amount - raw.reduce((a, v) => a + v, 0));
  raw[weights.indexOf(Math.max(...weights))] += rem;
  return raw.map(round2);
}
function weightsOf(list, primary, fallback) {
  let w = list.map(primary), basis = 'primary';
  if (!(w.reduce((a, v) => a + v, 0) > 0) && fallback) { w = list.map(fallback); basis = 'fallback'; }
  if (!(w.reduce((a, v) => a + v, 0) > 0)) { w = list.map(() => 1); basis = 'equal'; }
  return { w, basis };
}

/** توزيع الربح بالأثلاث:
 *  ثلث لشركاء الربح فقط (أبو غفير وسعيد) بحسب `profitSharePct` بينهما (متساوٍ إن لم تُحدَّد) ·
 *  ثلث لشركاء الملكية (أبو وليد وعمار) · ثلث المزرعة يأخذه شركاء الملكية أيضاً.
 *  الثلثان الأخيران يُقسَّمان بين الملاك بنسبة رأس مال كل واحد (`capitalById`: بقر + معدات).
 *  تخصيص فقط — لا يُنشئ أي حركة نقدية. المجموع يساوي صافي الربح تماماً (الربح السالب يُوزَّع بنفس النسب). */
// ───────────── رأس المال: مرجَّح بالأيام ─────────────
const dayN = (d) => Math.floor(Date.parse(`${String(d).slice(0, 10)}T00:00:00Z`) / 86400000);
/** قيود رأس مال الشريك: ثمن بقر دفعه + معدات دفعها، كل قيد بتاريخه وعملته. */
export function capitalEntries(partnerId, { ledger = [], expenses = [], animals = [] } = {}) {
  const gone = new Set(animals.filter((a) => a.voided).map((a) => a.id));
  const equip = new Set(expenses.filter((e) => !e.voided && e.category === 'equipment').map((e) => e.id));
  const out = [];
  for (const e of ledger) {
    if (e.partnerId !== partnerId || e.voided) continue;
    if (e.type === 'animal_purchase_paid' && !(e.animalId && gone.has(e.animalId))) out.push({ date: e.date, amount: n(e.amount), currency: e.currency || 'SYP', kind: 'cows' });
    else if (e.type === 'expense_paid_personally' && e.expenseId && equip.has(e.expenseId)) out.push({ date: e.date, amount: n(e.amount), currency: e.currency || 'SYP', kind: 'equipment' });
  }
  return out;
}
/** رأس مال الشريك لحساب نسب الأرباح (بالليرة السورية): ثمن بقر + معدات دفعها.
 *  from+to: يُرجَّح كل قيد بعدد أيام وجوده من الفترة (دخل آخر الفترة = وزن صغير). بدونهما: التراكمي حتى `to`. */
export function capitalOf(partnerId, data = {}, { currency = 'SYP', from, to } = {}) {
  let cows = 0, equipment = 0;
  for (const e of capitalEntries(partnerId, data)) {
    if (to && e.date > to) continue;
    if (e.currency !== currency) continue;
    let w = 1;
    if (from && to) { const total = dayN(to) - dayN(from) + 1; const active = dayN(to) - Math.max(dayN(e.date), dayN(from)) + 1; w = total > 0 ? Math.max(0, Math.min(1, active / total)) : 1; }
    if (e.kind === 'cows') cows += e.amount * w; else equipment += e.amount * w;
  }
  return { cows: round2(cows), equipment: round2(equipment), total: round2(cows + equipment), unit: currency, weighted: !!(from && to) };
}

// ───────────── المخزون: تكلفة العلف عند الاستهلاك (متوسط مرجّح) ─────────────
/** مشتريات مرتبطة بصنف مخزون لا تدخل الأرباح عند الشراء؛ يدخلها الاستهلاك فقط (كمية الصادر × متوسط التكلفة).
 *  → { linked: Set(معرّفات المصروفات المرتبطة), consumption: [{date,currency,amount,itemId}], valuation: {itemId:{qty,cost:{cur:amount}}} } */
export function stockCosting(expenses = [], movements = []) {
  const expById = Object.fromEntries(expenses.filter((e) => !e.voided).map((e) => [e.id, e]));
  const mvs = movements.filter((m) => !m.voided).slice().sort((a, b) => String(a.date).localeCompare(String(b.date)) || (a.type === 'in' ? -1 : 1) - (b.type === 'in' ? -1 : 1));
  const linked = new Set(), consumption = [], st = {};
  for (const m of mvs) {
    const s = (st[m.itemId] = st[m.itemId] || { qty: 0, cost: {} }); const q = n(m.qty);
    if (m.type === 'in') { s.qty = round2(s.qty + q); const e = m.expenseId ? expById[m.expenseId] : null; if (e) { linked.add(e.id); const c = e.currency || 'SYP'; s.cost[c] = (s.cost[c] || 0) + n(e.amount); } }
    else { const take = Math.min(q, s.qty); if (!(take > 0)) continue; const ratio = take / s.qty;
      for (const [c, amt] of Object.entries(s.cost)) { const used = round2(amt * ratio); s.cost[c] = round2(amt - used); if (used) consumption.push({ date: m.date, currency: c, amount: used, itemId: m.itemId }); }
      s.qty = round2(s.qty - take); }
  }
  return { linked, consumption, valuation: st };
}

/** رأس المال مُغلق في هذا التاريخ؟ (closedFrom = تاريخ الإغلاق من الإعدادات؛ فارغ = ما زال مفتوحاً) */
export const isCapitalClosed = (closedFrom, date) => !!closedFrom && !!date && String(date) >= String(closedFrom);
/** حالة رأس المال: المستثمَر (بقر + معدات للملاك) وما بقي مستحقاً لهم من ثمن البقر والتبادل. */
export function capitalStatus(partners = [], data = {}) {
  const act = partners.filter((p) => !p.voided && p.status !== 'inactive');
  const invested = round2(act.filter((p) => profitGroupOf(p) === 'owners').reduce((t, p) => t + partnerInvestment(p.id, data).total, 0));
  const owed = round2(act.reduce((t, p) => t + Math.max(0, partnerDebt(p.id, data.ledger || []).purchases), 0));
  return { invested, owed, repaid: invested > 0 && owed <= 0 };
}
export function allocateProfitByThirds(netProfit, partners, capitalById = {}, { capitalClosed = false } = {}) {
  const owners = partners.filter((p) => profitGroupOf(p) === 'owners');
  const side = partners.filter((p) => profitGroupOf(p) === 'side'); // سجل «المزرعة» مستبعد: ثلثها يذهب لمن دفع رأس المال
  if (!owners.length) throw new Error('لا يوجد شريك ملكية (أبو وليد / عمار) لتوزيع ثلثَي الأرباح عليه');
  const total = round2(netProfit);
  if (capitalClosed) { // رأس المال أُغلق: لا ثلث له، والربح نصفان: شركاء الملكية (بنسبة رأس المال) وشركاء الربح فقط
    const sideHalf = side.length ? round2(total / 2) : 0, ownersHalf = round2(total - sideHalf);
    const ow2 = weightsOf(owners, (p) => n(capitalById[p.id]), (p) => n(p.ownershipPct)), sw2 = weightsOf(side, (p) => n(p.profitSharePct));
    const os = splitByWeights(ownersHalf, ow2.w), ss = side.length ? splitByWeights(sideHalf, sw2.w) : [];
    const ot = ow2.w.reduce((a, v) => a + v, 0), st = sw2.w.reduce((a, v) => a + v, 0);
    return { allocations: [
      ...owners.map((p, i) => ({ partnerId: p.id, group: 'owners', capital: round2(n(capitalById[p.id])), ratioPct: round2(ow2.w[i] / ot * 100), fromOwnThird: os[i], fromFarmThird: 0, amount: os[i] })),
      ...side.map((p, i) => ({ partnerId: p.id, group: 'side', capital: 0, ratioPct: round2(sw2.w[i] / st * 100), fromOwnThird: ss[i], fromFarmThird: 0, amount: ss[i] }))],
      breakdown: { mode: 'halves', sideThird: sideHalf, ownersThird: ownersHalf, farmThird: 0, ownersBasis: ow2.basis === 'primary' ? 'capital' : ow2.basis === 'fallback' ? 'ownership' : 'equal' } };
  }
  const sideThird = side.length ? round2(total / 3) : 0;
  const farmThird = round2(total / 3);
  const ownersThird = round2(total - sideThird - farmThird);

  const ow = weightsOf(owners, (p) => n(capitalById[p.id]), (p) => n(p.ownershipPct));
  const ownShare = splitByWeights(ownersThird, ow.w), farmShare = splitByWeights(farmThird, ow.w);
  const sw = weightsOf(side, (p) => n(p.profitSharePct));
  const sideShare = side.length ? splitByWeights(sideThird, sw.w) : [];
  const owTot = ow.w.reduce((a, v) => a + v, 0), swTot = sw.w.reduce((a, v) => a + v, 0);

  const allocations = [
    ...owners.map((p, i) => ({ partnerId: p.id, group: 'owners', capital: round2(n(capitalById[p.id])), ratioPct: round2(ow.w[i] / owTot * 100), fromOwnThird: ownShare[i], fromFarmThird: farmShare[i], amount: round2(ownShare[i] + farmShare[i]) })),
    ...side.map((p, i) => ({ partnerId: p.id, group: 'side', capital: 0, ratioPct: round2(sw.w[i] / swTot * 100), fromOwnThird: sideShare[i], fromFarmThird: 0, amount: sideShare[i] })),
  ];
  return { allocations, breakdown: { mode: 'thirds', sideThird, ownersThird, farmThird, ownersBasis: ow.basis === 'primary' ? 'capital' : ow.basis === 'fallback' ? 'ownership' : 'equal' } };
}
/** النسبة الفعلية لكل شريك من إجمالي الأرباح (للعرض): { partnerId: % } */
export function effectiveProfitShares(partners, capitalById = {}, opts = {}) {
  if (!partners.some((p) => profitGroupOf(p) === 'owners')) return {};
  const { allocations } = allocateProfitByThirds(1000000, partners, capitalById, opts);
  return Object.fromEntries(allocations.map((a) => [a.partnerId, round2(a.amount / 10000)]));
}

/** مدخلات الأرباح الخاصة بالمواشي — مصدر واحد للتسويات والتقارير. */
export function animalPLInputs(events = [], animals = []) {
  // سياسة الأرباح: شراء الحيوانات لا يدخل أبداً (رأس مال). بيع الحيوان يدخل بنتيجته = سعر البيع − سعر شرائه (ربح أو خسارة تتقاسمها الأثلاث على الجميع)؛
  // ومن لا سعر شراء له (مولود بالمزرعة) يدخل بسعر البيع كاملاً. نتيجة التبادل تدخل بنفس الطريقة (انظر exchangeResults).
  const byId = Object.fromEntries(animals.map((a) => [a.id, a]));
  const animalSales = [];
  for (const e of events) {
    if (e.voided || byId[e.animalId]?.voided || e.type !== 'sale') continue;
    const cost = n(e.costBasis) || n(byId[e.animalId]?.acquisitionCost);
    animalSales.push({ date: e.date, currency: e.currency || 'SYP', amount: round2(n(e.value) - (cost > 0 ? cost : 0)) });
  }
  // نتيجة التبادل: تدخل الأرباح فقط لو اختير أن تكون على المزرعة (على الشركاء تُقيَّد في حساباتهم)
  const exchangeResults = events.filter((e) => !e.voided && !byId[e.animalId]?.voided && e.type === 'exchange_out' && (e.resultBearer || 'farm') === 'farm' && n(e.result) !== 0).map((e) => ({ date: e.date, currency: e.currency || 'SYP', amount: n(e.result) }));
  // نفوق حيوان له سعر شراء = خسارة بسعره (المولود بالمزرعة بلا سعر شراء لا خسارة)
  const deathLosses = events.filter((e) => !e.voided && e.type === 'death' && byId[e.animalId] && !byId[e.animalId].voided && n(byId[e.animalId].acquisitionCost) > 0).map((e) => ({ date: e.date, currency: byId[e.animalId].currency || e.currency || 'SYP', amount: -n(byId[e.animalId].acquisitionCost) }));
  return { animalSales, animalPurchases: [], exchangeResults, deathLosses };
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
/** معرّف الحيوان في قاعدة البيانات من رقمه (نفس التحويل المستخدم عند الإنشاء): مسافات وشرطات مائلة وعلامات اقتباس تتحول إلى «_». */
export const animalIdFromTag = (tag) => String(tag || '').trim().toLowerCase().replace(/[\s/\\'"]/g, '_');
/** رقم حيوان جديد: لازم غير فارغ وغير مستخدم لحيوان قائم (الملغى/المحذوف لا يُحتسب، ويُقارَن بنفس تحويل المعرّف فلا يمرّ «A 1» ثم يفشل الحفظ بسبب «A_1»). */
export function validateNewAnimal(tag, existing) {
  const t = animalIdFromTag(tag);
  if (!t) return { ok: false, reason: 'missing' };
  return existing.some((a) => animalIdFromTag(a.tag) === t && !a.voided) ? { ok: false, reason: 'duplicate' } : { ok: true };
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

// ───────────── تسمين العجول: وزن + علف + حليب + بنود أخرى لكل عجل ─────────────
/** logs: [{calfId,date,type:'arrival_weight'|'weight'|'feed'|'milk'|'other',qty,unit,item}] — الاستهلاك يُجمَع ضمن الفترة [from,to]،
 *  والوزن: بداية = آخر وزن في/قبل `from` (أو أول وزن مسجَّل)، نهاية = آخر وزن في/قبل `to`. */
export function calfFattening(calfId, logs = [], { from, to } = {}) {
  const mine = logs.filter((l) => l.calfId === calfId && !l.voided);
  const byDate = (a, b) => a.date.localeCompare(b.date);
  const ws = mine.filter((l) => l.type === 'arrival_weight' || l.type === 'weight').sort(byDate);
  const upTo = (d) => ws.filter((w) => !d || w.date <= d);
  const before = from ? ws.filter((w) => w.date <= from) : [];
  const startW = before.length ? before[before.length - 1] : ws[0] || null;
  const endList = upTo(to); const endW = endList.length ? endList[endList.length - 1] : null;
  const gain = startW && endW && endW !== startW ? round2(n(endW.qty) - n(startW.qty)) : null;
  const days = startW && endW && endW !== startW ? daysBetween(startW.date, endW.date) : 0;
  const inR = mine.filter((l) => inRange(l.date, from, to));
  const sumOf = (rows) => round2(rows.reduce((t, l) => t + n(l.qty), 0));
  const feedRows = inR.filter((l) => l.type === 'feed'), milkRows = inR.filter((l) => l.type === 'milk');
  const group = (rows, key) => { const o = {}; for (const l of rows) { const k = key(l); o[k] = round2((o[k] || 0) + n(l.qty)); } return o; };
  const feed = sumOf(feedRows), milk = sumOf(milkRows);
  return {
    startWeight: startW ? n(startW.qty) : null, startDate: startW?.date || null, endWeight: endW ? n(endW.qty) : null, endDate: endW?.date || null,
    gain, days, dailyGain: gain !== null && days > 0 ? round2(gain / days) : null,
    feed, feedByItem: group(feedRows, (l) => l.item || 'علف'), milk,
    other: group(inR.filter((l) => l.type === 'other'), (l) => `${l.item || '—'}${l.unit ? ` (${l.unit})` : ''}`),
    feedPerKgGain: gain > 0 ? round2(feed / gain) : null, // كغ علف لكل كغ زيادة وزن
  };
}

/** صافي رصيد عميل (مطابق لكشف حسابه): موجب = عليه لنا، سالب = له عندنا. = المستحق + الرصيد الافتتاحي − الدفعات المقدمة غير المطبَّقة. */
export function netCustomerBalance(customerId, data, opening = 0) {
  const p = customerPosition(customerId, data);
  return round2(n(p.receivable) + n(opening) - n(p.unappliedCredit));
}
/** قيمة القطيع الحالي بتكلفة الشراء: الحيوانات الموجودة فعلاً (غير المباعة/النافقة/الملغاة) مجمَّعة لكل عملة وفئة. */
export function herdValue(animals = [], events = []) {
  const h = herdState(events, animals); const rows = animals.filter((a) => !a.voided && h[a.id]?.active);
  const byCurrency = {}; const byCategory = {};
  for (const a of rows) {
    const c = a.currency || 'SYP'; const cost = n(a.acquisitionCost);
    byCurrency[c] = round2((byCurrency[c] || 0) + cost);
    const k = `${a.category || '-'}|${c}`; (byCategory[k] = byCategory[k] || { category: a.category || '-', currency: c, count: 0, cost: 0 }); byCategory[k].count++; byCategory[k].cost = round2(byCategory[k].cost + cost);
  }
  return { count: rows.length, rows, byCurrency, byCategory: Object.values(byCategory) };
}
/** يقسم مبلغاً (خسارة/ربح) على شركاء الملكية بنسبة رأس مال كل واحد حتى تاريخ `to` (نفس قاعدة الأرباح). → [{partnerId, amount}] مجموعها = المبلغ */
export function splitAmongOwners(amount, partners, data = {}, { currency = 'SYP', to } = {}) {
  const owners = partners.filter((p) => !p.voided && p.status !== 'inactive' && profitGroupOf(p) === 'owners');
  if (!owners.length) throw new Error('لا يوجد شريك ملكية لتحميل الخسارة/الربح عليه');
  const cap = owners.map((p) => partnerInvestment(p.id, data, { currency, to }).total);
  const { w } = weightsOf(owners, (p) => cap[owners.indexOf(p)], (p) => n(p.ownershipPct));
  const parts = splitByWeights(round2(amount), w);
  return owners.map((p, i) => ({ partnerId: p.id, amount: parts[i] })).filter((x) => x.amount !== 0);
}
/** نتيجة الحيوان (ربح/خسارة): بيع = سعر البيع − سعر الشراء، تبادل = القيمة المتفق عليها − سعر الشراء. null لو لا بيع/تبادل أو سعر الشراء غير معروف. */
export function animalResultInfo(animal, events = []) {
  const cost = n(animal.acquisitionCost); if (!(cost > 0)) return null;
  const ev = events.find((e) => !e.voided && e.animalId === animal.id && (e.type === 'sale' || e.type === 'exchange_out' || e.type === 'death')); if (!ev) return null;
  if (ev.type === 'death') return { kind: 'death', result: -cost, value: 0, cost, bearer: 'farm', partnerIds: [], currency: animal.currency || ev.currency || 'SYP' };
  const result = ev.result !== undefined && ev.result !== null && ev.result !== '' ? n(ev.result) : round2(n(ev.value) - cost);
  return { kind: ev.type === 'sale' ? 'sale' : 'exchange', result, value: n(ev.value), cost, bearer: ev.resultBearer || null, partnerIds: ev.resultPartnerIds || [], currency: ev.currency || animal.currency || 'SYP' };
}
/** الفرق المستلَم في تبادل = «بعنا» الحيوان الخارج وأخذنا مالاً: يذهب لمن دفع ثمنه (شريك أو أكثر، بنسبة ما دفع) والباقي (ما دُفع من الصندوق أو مجهول) للصندوق.
 *  outs: [{animal, weight}] weight = سعر شراء الخارج (أو قيمته). → { partners:[{partnerId,amount}], farm } مجموعها = المبلغ */
export function splitReceivedDiff(received, outs = [], data = {}) {
  const buckets = new Map(); let farmW = 0;
  const add = (id, w) => buckets.set(id, (buckets.get(id) || 0) + w);
  for (const { animal, weight } of outs) {
    const w = n(weight); if (!(w > 0)) continue;
    const src = purchaseSource(animal, data); const ex = animalExchangeInfo(animal, data);
    if (src.multi) { const tot = src.partners.reduce((t, q) => t + q.amount, 0) || 1; src.partners.forEach((q) => add(q.partnerId, w * q.amount / tot)); }
    else if (src.from === 'partner' && src.partnerId) add(src.partnerId, w);
    else if (ex?.paidBy === 'partner' && ex.partnerId) add(ex.partnerId, w); // وصل بتبادل سابق ودفع فرقه شريك
    else farmW += w;
  }
  const keys = [...buckets.keys()]; const ws = [...keys.map((k) => buckets.get(k)), ...(farmW > 0 ? [farmW] : [])];
  if (!ws.length) return { partners: [], farm: round2(received) };
  const parts = splitByWeights(round2(received), ws);
  return { partners: keys.map((k, i) => ({ partnerId: k, amount: parts[i] })).filter((x) => x.amount !== 0), farm: farmW > 0 ? parts[keys.length] : 0 };
}
/** بيانات تبادل الحيوان الوارد: ما خرج مقابله (حيوان أو أكثر) + قيمته + الفرق + من دفعه (شريك/صندوق).
 *  diff > 0 = دفعنا فرقاً · diff < 0 = استلمنا فرقاً. يُرجع null لو الحيوان لم يدخل بتبادل. */
export function animalExchangeInfo(animal, { events = [], ledger = [], cash = [] } = {}) {
  const inEv = events.find((e) => !e.voided && e.animalId === animal.id && e.type === 'exchange_in'); if (!inEv) return null;
  const exId = inEv.exchangeId;
  const outs = exId ? events.filter((e) => !e.voided && e.exchangeId === exId && e.type === 'exchange_out').map((e) => ({ animalId: e.animalId, tag: e.tag || '', value: n(e.value) })) : [];
  const inValue = n(inEv.value), outValue = round2(outs.reduce((t, o) => t + o.value, 0)), diff = round2(inValue - outValue);
  const res = { exchangeId: exId, date: inEv.date, currency: inEv.currency || animal.currency || 'SYP', inValue, outs, outValue, diff, paidBy: 'none', partnerId: null, accountId: null };
  if (!exId || diff === 0) return res;
  if (diff > 0) {
    const leds = ledger.filter((l) => !l.voided && l.type === 'animal_purchase_paid' && l.exchangeId === exId);
    if (leds.length) return { ...res, paidBy: 'partner', partnerId: leds[0].partnerId, partners: leds.map((l) => ({ partnerId: l.partnerId, amount: n(l.amount) })) }; // شريك أو أكثر دفعوا الفرق
    const c = cash.find((t) => !t.voided && t.exchangeId === exId && t.type === 'animal_exchange_payment');
    if (c) return { ...res, paidBy: 'account', accountId: c.accountId };
    if (inEv.diffPaidBy) return { ...res, paidBy: 'partner', partnerId: inEv.diffPaidBy };
  } else {
    const c = cash.find((t) => !t.voided && t.exchangeId === exId && t.type === 'animal_exchange_receipt');
    const rep = ledger.filter((l) => !l.voided && l.type === 'animal_purchase_repaid' && l.exchangeId === exId); // ذهب لدافع ثمن الحيوان الخارج
    if (rep.length) return { ...res, paidBy: 'partner', partnerId: rep[0].partnerId, partners: rep.map((l) => ({ partnerId: l.partnerId, amount: n(l.amount) })), accountId: c?.accountId || null };
    if (c) return { ...res, paidBy: 'account', accountId: c.accountId };
  }
  return res;
}
/** من دفع ثمن شراء هذا الحيوان؟ يُستنتج من قيد حساب الشريك أو حركة الصندوق أو علامة الحدث. */
export function purchaseSource(animal, { events = [], ledger = [], cash = [] } = {}) {
  const ev = events.find((e) => !e.voided && e.animalId === animal.id && e.type === 'purchase' && n(e.value) > 0) || events.find((e) => !e.voided && e.animalId === animal.id && e.type === 'purchase');
  const out = { event: ev || null, from: 'none', partnerId: null, accountId: null, amount: ev ? n(ev.value) : n(animal.acquisitionCost), date: ev?.date || animal.acquisitionDate || '' };
  const leds = ledger.filter((l) => !l.voided && l.type === 'animal_purchase_paid' && !l.exchangeId && ((ev && l.eventId === ev.id) || (l.animalId === animal.id && (!ev || l.date === ev.date))));
  const led = leds[0];
  if (leds.length > 1 && ev && leds.every((l) => l.eventId === ev.id)) return { ...out, from: 'partner', partnerId: led.partnerId, multi: true, partners: leds.map((l) => ({ partnerId: l.partnerId, amount: n(l.amount) })) }; // اشتراه أكثر من شريك
  if (led) return { ...out, from: 'partner', partnerId: led.partnerId, ledgerId: led.id };
  const c = cash.find((t) => !t.voided && t.type === 'animal_purchase' && (t.animalId === animal.id || (!t.animalId && t.description === `شراء ${animal.tag}`)));
  if (c) return { ...out, from: 'account', accountId: c.accountId, cashId: c.id };
  if (ev?.paidFrom === 'partner' || ev?.paidFrom === 'capital') return { ...out, from: 'partner', partnerId: ev.payerPartnerId || ev.capitalPartnerId || null };
  return out;
}
