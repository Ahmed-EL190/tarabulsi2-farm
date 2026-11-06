// Multi-record financial operations. Each is ONE atomic batch so related records can never get out of sync.
import { serverTimestamp } from 'firebase/firestore';
import { allExpenseCategories, allAnimalCategories, PARTNER_EXPENSE_CATS } from '../lib/constants';
import { planPartnerRepayment, allocateToLoans, loanPosition, partnerDebt, cashBalances } from '../lib/finance';
import { commit, nextNumber, newId } from './db';
import { validateDelivery, validateExpensePayment, partnerFundedExpenseEntry, makeTransfer, allocateProfit } from '../lib/finance';

const today = () => new Date().toLocaleDateString('en-CA'); // تاريخ محلي

export async function createAgreement(user, a) {
  const number = await nextNumber('agreement', 'AG');
  const id = newId('milkSales');
  const ops = [{ col: 'milkSales', id, data: { ...a, number, status: 'open' } }];
  if (Number(a.advance) > 0) ops.push(...paymentOps(user, { agreementId: id, customerId: a.customerId, date: a.date, amount: Number(a.advance), currency: a.currency, accountId: a.accountId, method: a.method, note: 'دفعة مقدمة عند الاتفاق', kind: 'advance' }));
  await commit(user, ops); return { id, number };
}
export async function addDelivery(user, agreement, deliveries, d) {
  const v = validateDelivery(agreement, deliveries, d.qty);
  if (!v.ok) throw new Error(`الكمية تتجاوز المتبقي (${v.remaining} لتر)`);
  return commit(user, [{ col: 'milkDeliveries', data: { ...d, agreementId: agreement.id, customerId: agreement.customerId, pricePerLiter: d.pricePerLiter || agreement.pricePerLiter, currency: agreement.currency } }]);
}
function paymentOps(user, p) {
  const payId = newId('customerPayments');
  const isRefund = p.type === 'refund';
  return [
    { col: 'customerPayments', id: payId, data: { agreementId: p.agreementId || null, customerId: p.customerId, date: p.date, amount: p.amount, currency: p.currency, type: isRefund ? 'refund' : 'payment', kind: p.kind || 'payment', accountId: p.accountId, method: p.method || 'cash', note: p.note || '' } },
    ...(p.accountId ? [{ col: 'cashTransactions', data: { date: p.date, type: isRefund ? 'customer_refund' : 'customer_payment', direction: isRefund ? 'out' : 'in', amount: p.amount, currency: p.currency, accountId: p.accountId, method: p.method || 'cash', customerId: p.customerId, customerPaymentId: payId, description: p.note || '' } }] : []),
  ];
}
export const addCustomerPayment = (user, p) => commit(user, paymentOps(user, p));

export async function addExpense(user, e) { return commit(user, [{ col: 'expenses', data: e }]); }
/** Pay an expense. source 'account' -> cash movement. source 'partner' -> partner ledger entry only (expense stays single). */
export async function payExpense(user, expense, payments, p, loanCtx = {}) {
  const v = validateExpensePayment(expense, payments, p.amount);
  if (!v.ok) throw new Error(`المبلغ يتجاوز المتبقي (${v.outstanding})`);
  const isPartnerCat = !!PARTNER_EXPENSE_CATS[expense.category];
  if (isPartnerCat && p.source !== 'account') throw new Error('هذا النوع يُدفع من صندوق المزرعة');
  if (isPartnerCat && !expense.partnerAccountId) throw new Error('اربط هذا المصروف بشريك أولاً (زر «ربط مصروفات الشركاء بحساباتهم»)');
  const payId = newId('expensePayments');
  const ops = [{ col: 'expensePayments', id: payId, data: { expenseId: expense.id, date: p.date, amount: p.amount, currency: expense.currency, source: p.source, accountId: p.accountId || null, partnerId: p.partnerId || null } }];
  if (p.source === 'account') ops.push({ col: 'cashTransactions', data: { date: p.date, type: 'expense_payment', direction: 'out', amount: p.amount, currency: expense.currency, accountId: p.accountId, expenseId: expense.id, expensePaymentId: payId, supplierId: expense.supplierId || null, description: expense.description || '' } });
  if (p.source === 'partner') ops.push({ col: 'partnerCapitalTransactions', data: partnerFundedExpenseEntry(expense, { id: payId, partnerId: p.partnerId, date: p.date, amount: p.amount }) });
  if (isPartnerCat) ops.push(...partnerEntriesForPayment({ expense, partnerId: expense.partnerAccountId, payId, date: p.date, amount: Number(p.amount), loans: loanCtx.loans || [], repayments: loanCtx.repayments || [] }));
  return commit(user, ops);
}
export const reimbursePartner = (user, p) => commit(user, [
  { col: 'partnerCapitalTransactions', data: { partnerId: p.partnerId, date: p.date, type: 'reimbursement', amount: p.amount, currency: p.currency } },
  { col: 'cashTransactions', data: { date: p.date, type: 'partner_reimbursement', direction: 'out', amount: p.amount, currency: p.currency, accountId: p.accountId, partnerId: p.partnerId } },
]);
/** Capital / withdrawal / loan disbursement / repayment — all distinct ledger types, each with its linked cash movement. */
export async function partnerMovement(user, m) {
  const map = { capital_contribution: ['capital_contribution', 'in'], additional_capital: ['capital_contribution', 'in'], withdrawal: ['partner_withdrawal', 'out'], profit_distribution: ['profit_distribution', 'out'] };
  const [cashType, dir] = map[m.type];
  const lid = newId('partnerCapitalTransactions');
  return commit(user, [
    { col: 'partnerCapitalTransactions', id: lid, data: { partnerId: m.partnerId, date: m.date, type: m.type, amount: m.amount, currency: m.currency, note: m.note || '', settlementId: m.settlementId || null } },
    { col: 'cashTransactions', data: { date: m.date, type: cashType, direction: dir, amount: m.amount, currency: m.currency, accountId: m.accountId, partnerId: m.partnerId, ledgerEntryId: lid } },
  ]);
}
export async function createLoan(user, l) {
  const loanId = newId('partnerLoans');
  return commit(user, [
    { col: 'partnerLoans', id: loanId, data: { ...l, adjustments: [], status: 'active' } },
    { col: 'partnerCapitalTransactions', data: { partnerId: l.partnerId, date: l.disbursementDate, type: 'loan_given', amount: l.principal, currency: l.currency, loanId } },
    { col: 'cashTransactions', data: { date: l.disbursementDate, type: 'loan_received', direction: 'in', amount: l.principal, currency: l.currency, accountId: l.accountId, partnerId: l.partnerId, loanId } },
  ]);
}
export async function repayLoan(user, loan, r) {
  const ops = [{ col: 'partnerLoanRepayments', data: { loanId: loan.id, partnerId: loan.partnerId, date: r.date, principalAmount: r.principalAmount || 0, interestAmount: r.interestAmount || 0, currency: loan.currency, accountId: r.accountId } }];
  const total = (r.principalAmount || 0) + (r.interestAmount || 0);
  if (r.principalAmount) ops.push({ col: 'partnerCapitalTransactions', data: { partnerId: loan.partnerId, date: r.date, type: 'loan_principal_repayment', amount: r.principalAmount, currency: loan.currency, loanId: loan.id } });
  if (r.interestAmount) ops.push({ col: 'partnerCapitalTransactions', data: { partnerId: loan.partnerId, date: r.date, type: 'interest_paid', amount: r.interestAmount, currency: loan.currency, loanId: loan.id } });
  ops.push({ col: 'cashTransactions', data: { date: r.date, type: 'loan_repayment', direction: 'out', amount: total, currency: loan.currency, accountId: r.accountId, partnerId: loan.partnerId, loanId: loan.id } });
  return commit(user, ops);
}
export const transferCash = (user, t) => { const id = newId('cashTransactions'); return commit(user, makeTransfer({ ...t, id }).map(({ id: _i, ...data }) => ({ col: 'cashTransactions', data }))); };
export const addOtherIncome = (user, t) => commit(user, [{ col: 'cashTransactions', data: { ...t, type: 'other_income', direction: 'in' } }]);

/** Finalising a settlement writes allocation entries to partner ledgers. It creates NO cash movement. */
export async function finalizeSettlement(user, s, partners, existing = []) {
  if (!s.from || !s.to || s.from > s.to) throw new Error('الفترة غير صحيحة: تاريخ البداية يجب ألا يتجاوز النهاية');
  const clash = existing.find((x) => !x.voided && x.status !== 'voided' && (x.currency || 'SYP') === s.currency && !(s.to < x.from || s.from > x.to));
  if (clash) throw new Error(`هذه الفترة تتداخل مع تسوية معتمدة سابقاً (${clash.from} ← ${clash.to}). اعتماد تسويتين لنفس الأيام يكرّر توزيع الأرباح. ابدأ من اليوم التالي لآخر تسوية أو ألغِ السابقة.`);
  const alloc = allocateProfit(s.netProfit, partners);
  const id = newId('settlements');
  return commit(user, [
    { col: 'settlements', id, data: { ...s, allocations: alloc, status: 'finalized', approvedBy: user.uid, approvedAt: today() }, action: 'finalize' },
    ...alloc.map((a) => ({ col: 'partnerCapitalTransactions', data: { partnerId: a.partnerId, date: s.to, type: 'profit_allocation', amount: a.amount, currency: s.currency, settlementId: id } })),
  ]);
}
export function recordAnimalEvent(user, ev, cash, ledger) {
  const evId = newId('animalEvents');
  return commit(user, [{ col: 'animalEvents', id: evId, data: ev }, ...(cash ? [{ col: 'cashTransactions', data: cash }] : []), ...(ledger ? [{ col: 'partnerCapitalTransactions', data: { ...ledger, eventId: evId } }] : [])]);
}

/** كيف دُفع ثمن شراء الحيوان؟
 *  partner (الافتراضي): دفعه شريك من ماله ← يُسجَّل في حسابه «ثمن حيوان دفعه الشريك» (مستحق له، يزيد تلقائياً مع كل شراء) ولا تتحرك نقود الصندوق.
 *  account: خرج من صندوق المزرعة ← حركة صندوق «شراء حيوان». */
export function animalPurchasePayment({ from, partnerId, accountId, cost, date, currency, tag, animalId }) {
  const amount = Number(cost || 0); if (!(amount > 0)) return { cash: null, ledger: null, extra: {} };
  if (from === 'account') {
    if (!accountId) throw new Error('اختر الصندوق الذي دُفع منه ثمن الشراء');
    return { cash: { date, type: 'animal_purchase', direction: 'out', amount, currency, accountId, animalId, description: `شراء ${tag}` }, ledger: null, extra: {} };
  }
  if (!partnerId) throw new Error('اختر الشريك الذي دفع ثمن الشراء');
  return { cash: null, ledger: { partnerId, date, type: 'animal_purchase_paid', amount, currency, animalId, note: `شراء ${tag}` }, extra: { paidFrom: 'partner', payerPartnerId: partnerId } };
}

/** Animal sale: sale event + cash receipt into the chosen cashbox, one atomic batch (same cashbox as milk payments). */
export async function sellAnimal(user, s) {
  const price = Number(s.price);
  if (!(price > 0)) throw new Error('أدخل سعر البيع');
  if (!s.accountId) throw new Error('اختر الصندوق');
  const cost = Number(s.animal.acquisitionCost || 0);
  return commit(user, [
    { col: 'animalEvents', data: { animalId: s.animal.id, tag: s.animal.tag, type: 'sale', date: s.date, value: price, currency: s.currency, buyerName: s.buyerName || '', costBasis: cost, result: Math.round((price - cost) * 100) / 100, notes: s.notes || '' } },
    { col: 'cashTransactions', data: { date: s.date, type: 'animal_sale', direction: 'in', amount: price, currency: s.currency, accountId: s.accountId, animalId: s.animal.id, description: `بيع ${s.animal.tag}${s.buyerName ? ' - ' + s.buyerName : ''}` } },
  ]);
}

/** Expense + (optional) payment in ONE atomic batch. Expense is recorded once; payment goes to a cashbox OR to a partner's ledger. */
export async function addExpenseWithPayment(user, e, p = {}) {
  const id = newId('expenses');
  const isPartnerCat = !!PARTNER_EXPENSE_CATS[e.category];
  if (isPartnerCat && !e.partnerAccountId) throw new Error('اختر الشريك الذي يُقيَّد في حسابه (سحب / سلفة / سداد قرض)');
  const ops = [{ col: 'expenses', id, data: e }];
  if (p.payNow && p.payNow !== 'no') {
    const amount = p.payNow === 'full' ? Number(e.amount) : Number(p.paidAmount);
    if (!(amount > 0) || amount > Number(e.amount)) throw new Error('مبلغ الدفع يجب أن يكون أكبر من صفر ولا يتجاوز قيمة المصروف');
    const source = p.source || 'account';
    if (isPartnerCat && source !== 'account') throw new Error('هذا النوع يُدفع من صندوق المزرعة (يُقيَّد في حساب الشريك تلقائياً)');
    if (source === 'account' && !p.accountId) throw new Error('اختر الصندوق');
    if (source === 'partner' && !p.partnerId) throw new Error('اختر الشريك');
    const pdate = p.payDate || e.date; // تاريخ الدفع الفعلي (افتراضياً = تاريخ المصروف)
    const payId = newId('expensePayments');
    ops.push({ col: 'expensePayments', id: payId, data: { expenseId: id, date: pdate, amount, currency: e.currency, source, accountId: source === 'account' ? p.accountId : null, partnerId: source === 'partner' ? p.partnerId : null } });
    if (source === 'account') ops.push({ col: 'cashTransactions', data: { date: pdate, type: 'expense_payment', direction: 'out', amount, currency: e.currency, accountId: p.accountId, expenseId: id, expensePaymentId: payId, description: e.description || '' } });
    else ops.push({ col: 'partnerCapitalTransactions', data: partnerFundedExpenseEntry({ ...e, id }, { id: payId, partnerId: p.partnerId, date: pdate, amount }) });
    if (isPartnerCat) ops.push(...partnerEntriesForPayment({ expense: { ...e, id }, partnerId: e.partnerAccountId, payId, date: pdate, amount, loans: p.loans || [], repayments: p.repayments || [] }));
  }
  return commit(user, ops);
}

// ───────────── تعديل / إلغاء الدفعات (مع مزامنة حركة الصندوق المرتبطة) ─────────────
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const voidData = (reason) => ({ voided: true, voidReason: reason || '', voidedAt: serverTimestamp() });

/** أثر دفعة مصروف «يخص شريكاً» (سحب / سلفة أخذها / سداد أصل قرض) في حسابه:
 *  سحب ← قيد «سحب» · سلفة ← قيد «سلفة أخذها الشريك» · سداد قرض ← يُوزَّع على قروضه الأقدم فالأحدث (يُنقص أصل القرض) + قيد «سداد أصل القرض».
 *  لا يُنشئ حركة صندوق (حركة الدفع نفسها هي التي أخرجت المال). */
export function partnerEntriesForPayment({ expense, partnerId, payId, date, amount, loans = [], repayments = [] }) {
  const type = PARTNER_EXPENSE_CATS[expense.category]; if (!type) return [];
  if (!partnerId) throw new Error('اختر الشريك الذي يُقيَّد في حسابه');
  const currency = expense.currency || 'SYP';
  const base = { partnerId, date, currency, expenseId: expense.id, expensePaymentId: payId, note: expense.description || '' };
  if (type !== 'loan_principal_repayment') return [{ col: 'partnerCapitalTransactions', data: { ...base, type, amount: Number(amount) } }];
  const { parts, unallocated } = allocateToLoans(partnerId, loans, repayments, amount, currency);
  if (!parts.length) throw new Error('لا توجد سلفة (قرض) قائمة لهذا الشريك لسداد أصلها');
  if (unallocated > 0.005) throw new Error(`المبلغ أكبر من السلف القائمة لهذا الشريك (المتبقي ${r2(Number(amount) - unallocated)})`);
  return parts.flatMap(({ loan, principal }) => [
    { col: 'partnerLoanRepayments', data: { loanId: loan.id, partnerId, date, principalAmount: principal, interestAmount: 0, currency, expenseId: expense.id, expensePaymentId: payId } },
    { col: 'partnerCapitalTransactions', data: { ...base, type, amount: principal, loanId: loan.id } },
  ]);
}

/** دفعة عميل: تعديل التاريخ/المبلغ/الطريقة/الملاحظة — وحركة الصندوق المرتبطة تتحدّث معها. */
export async function updateCustomerPayment(user, pay, cashTxs, d) {
  const amount = Number(d.amount);
  if (!(amount > 0)) throw new Error('أدخل مبلغاً أكبر من صفر');
  const accountId = d.accountId || pay.accountId || null; const method = d.method || 'cash'; const note = d.note || '';
  const ops = [{ col: 'customerPayments', id: pay.id, merge: true, data: { date: d.date, amount, method, note, accountId } }];
  const linked = cashTxs.filter((t) => t.customerPaymentId === pay.id && !t.voided);
  if (linked.length) linked.forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: { date: d.date, amount, method, accountId, description: note } }));
  else if (accountId) { const refund = pay.type === 'refund'; ops.push({ col: 'cashTransactions', data: { date: d.date, type: refund ? 'customer_refund' : 'customer_payment', direction: refund ? 'out' : 'in', amount, currency: pay.currency, accountId, method, customerId: pay.customerId, customerPaymentId: pay.id, description: note } }); }
  return commit(user, ops, 'update');
}
/** إلغاء دفعة عميل (تبقى في سجل التدقيق) + إلغاء حركة الصندوق المرتبطة. */
export async function voidCustomerPayment(user, pay, cashTxs, reason) {
  const ops = [{ col: 'customerPayments', id: pay.id, merge: true, data: voidData(reason), action: 'void' }];
  cashTxs.filter((t) => t.customerPaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  return commit(user, ops, 'void');
}
/** تعديل مصروف. التاريخ: الدفعات اللي بنفس تاريخه تتبعه. المبلغ: لو المصروف مدفوع بالكامل بدفعة واحدة، الدفعة (وحركة الصندوق/دفتر الشريك) تتبع المبلغ الجديد. */
export async function updateExpenseSynced(user, expense, data, { pays = [], cash = [], ledger = [], reps = [] } = {}) {
  const ops = [{ col: 'expenses', id: expense.id, merge: true, data }];
  const mine = pays.filter((p) => p.expenseId === expense.id && !p.voided);
  const dateChanged = !!data.date && data.date !== expense.date;
  const oldAmt = Number(expense.amount); const newAmt = data.amount !== undefined ? Number(data.amount) : oldAmt;
  const paid = r2(mine.reduce((a, p) => a + Number(p.amount || 0), 0));
  const amountChanged = newAmt !== oldAmt;
  const syncSingle = amountChanged && mine.length === 1 && Math.abs(paid - oldAmt) < 0.005; // مدفوع كاملاً بدفعة واحدة
  if (amountChanged && !syncSingle && paid > newAmt + 1e-9) throw new Error(`المبلغ الجديد (${r2(newAmt)}) أقل من المدفوع فعلاً (${paid}). عدّل أو ألغِ الدفعات أولاً من أيقونة «الدفعات».`);
  for (const p of mine) {
    const followDate = dateChanged && p.date === expense.date;
    const patch = {}; if (followDate) patch.date = data.date; if (syncSingle) patch.amount = newAmt;
    if (Object.keys(patch).length) ops.push({ col: 'expensePayments', id: p.id, merge: true, data: patch });
    for (const t of cash.filter((t) => t.expensePaymentId === p.id && !t.voided)) {
      const cp = { ...patch }; if (data.description !== undefined && data.description !== expense.description) cp.description = data.description;
      if (Object.keys(cp).length) ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: cp });
    }
    const linkedLed = ledger.filter((t) => t.expensePaymentId === p.id && !t.voided);
    if (syncSingle && linkedLed.length > 1) throw new Error('هذا المصروف موزّع على أكثر من قرض: لتغيير مبلغه ألغِ الدفعة وأعد تسجيلها.');
    if (Object.keys(patch).length) for (const t of linkedLed) ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: patch });
    if (Object.keys(patch).length) for (const t of reps.filter((t) => t.expensePaymentId === p.id && !t.voided)) ops.push({ col: 'partnerLoanRepayments', id: t.id, merge: true, data: { ...(patch.date ? { date: patch.date } : {}), ...(patch.amount !== undefined ? { principalAmount: patch.amount } : {}) } });
  }
  return commit(user, ops, 'update');
}
/** تعديل دفعة مصروف (التاريخ/المبلغ) مع حركة الصندوق أو قيد الشريك المرتبط. */
export async function updateExpensePayment(user, expense, allPays, pay, links, d) {
  const amount = Number(d.amount);
  if (!(amount > 0)) throw new Error('أدخل مبلغاً أكبر من صفر');
  const others = allPays.filter((p) => p.expenseId === expense.id && !p.voided && p.id !== pay.id).reduce((a, p) => a + Number(p.amount || 0), 0);
  if (amount + others > Number(expense.amount) + 1e-9) throw new Error(`المبلغ يتجاوز قيمة المصروف (الحد الأقصى ${r2(Number(expense.amount) - others)})`);
  const linkedLed = (links.ledger || []).filter((t) => t.expensePaymentId === pay.id && !t.voided); const linkedReps = (links.reps || []).filter((t) => t.expensePaymentId === pay.id && !t.voided);
  if (Number(pay.amount) !== amount && (linkedLed.length > 1 || linkedReps.length > 1)) throw new Error('هذه الدفعة موزّعة على أكثر من قرض: لتغيير مبلغها ألغِها وأعد تسجيلها.');
  // كل بيانات الدفعة قابلة للتعديل: التاريخ، المبلغ، الصندوق (للدفع من الصندوق)، الشريك (للدفع من شريك)، الملاحظة
  const payPatch = { date: d.date, amount, ...(d.accountId && pay.source !== 'partner' ? { accountId: d.accountId } : {}), ...(d.partnerId && pay.source === 'partner' ? { partnerId: d.partnerId } : {}), ...(d.note !== undefined ? { note: d.note } : {}) };
  const ops = [{ col: 'expensePayments', id: pay.id, merge: true, data: payPatch }];
  (links.cash || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: { date: d.date, amount, ...(d.accountId ? { accountId: d.accountId } : {}), ...(d.note ? { description: d.note } : {}) } }));
  linkedLed.forEach((t) => ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: { date: d.date, amount, ...(d.partnerId && pay.source === 'partner' ? { partnerId: d.partnerId } : {}) } }));
  linkedReps.forEach((t) => ops.push({ col: 'partnerLoanRepayments', id: t.id, merge: true, data: { date: d.date, principalAmount: amount } }));
  return commit(user, ops, 'update');
}
export async function voidExpensePayment(user, pay, links, reason) {
  const ops = [{ col: 'expensePayments', id: pay.id, merge: true, data: voidData(reason), action: 'void' }];
  (links.cash || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  (links.ledger || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  (links.reps || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'partnerLoanRepayments', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  return commit(user, ops, 'void');
}

// ───────────── تسليمات الحليب: تعديل / إلغاء ─────────────
export async function updateDelivery(user, agreement, deliveries, del, d) {
  const qty = Number(d.qty);
  if (!(qty > 0)) throw new Error('أدخل كمية أكبر من صفر');
  const others = deliveries.filter((x) => x.agreementId === agreement.id && !x.voided && x.id !== del.id).reduce((a, x) => a + Number(x.qty || 0), 0);
  if (qty + others > Number(agreement.agreedQty) + 1e-9) throw new Error(`الكمية تتجاوز المتبقي (الحد الأقصى ${r2(Number(agreement.agreedQty) - others)} لتر)`);
  const price = Number(d.pricePerLiter) > 0 ? Number(d.pricePerLiter) : Number(agreement.pricePerLiter);
  return commit(user, [{ col: 'milkDeliveries', id: del.id, merge: true, data: { date: d.date, qty, pricePerLiter: price, notes: d.notes || '' } }], 'update');
}
export const voidDelivery = (user, del, reason) => commit(user, [{ col: 'milkDeliveries', id: del.id, merge: true, data: voidData(reason), action: 'void' }], 'void');

// ───────────── إلغاء متسلسل: إلغاء سجل يلغي كل ما يتبعه (حتى لا يبقى أثره في الصندوق أو الأرباح) ─────────────
export async function voidExpenseCascade(user, expense, { pays = [], cash = [], ledger = [], reps = [] } = {}, reason) {
  const ops = [{ col: 'expenses', id: expense.id, merge: true, data: voidData(reason), action: 'void' }];
  for (const p of pays.filter((p) => p.expenseId === expense.id && !p.voided)) {
    ops.push({ col: 'expensePayments', id: p.id, merge: true, data: voidData(reason), action: 'void' });
    cash.filter((t) => t.expensePaymentId === p.id && !t.voided).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
    ledger.filter((t) => t.expensePaymentId === p.id && !t.voided).forEach((t) => ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
    reps.filter((t) => t.expensePaymentId === p.id && !t.voided).forEach((t) => ops.push({ col: 'partnerLoanRepayments', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  }
  return commit(user, ops, 'void');
}
const animalCash = (cash, animalId, tag, evs) => cash.filter((t) => !t.voided && ['animal_purchase', 'animal_sale'].includes(t.type)
  && (t.animalId === animalId || (!t.animalId && t.description?.startsWith(t.type === 'animal_purchase' ? `شراء ${tag}` : `بيع ${tag}`) && evs.some((e) => e.date === t.date))));
/** إلغاء حيوان: الحيوان + كل أحداثه + حركات الصندوق الخاصة بشرائه/بيعه. */
export async function voidAnimalCascade(user, animal, { events = [], cash = [], ledger = [] } = {}, reason) {
  const evs = events.filter((e) => e.animalId === animal.id && !e.voided);
  const ops = [{ col: 'animals', id: animal.id, merge: true, data: voidData(reason), action: 'void' }];
  evs.forEach((e) => ops.push({ col: 'animalEvents', id: e.id, merge: true, data: voidData(reason), action: 'void' }));
  animalCash(cash, animal.id, animal.tag, evs).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  ledger.filter((e) => e.animalId === animal.id && ['capital_contribution', 'animal_purchase_paid'].includes(e.type) && !e.voided).forEach((e) => ops.push({ col: 'partnerCapitalTransactions', id: e.id, merge: true, data: voidData(reason), action: 'void' }));
  return commit(user, ops, 'void');
}
/** إلغاء حدث (بيع/شراء/نفوق...) مع حركة الصندوق المرتبطة به. */
export async function voidAnimalEventCascade(user, ev, { cash = [], ledger = [] } = {}, reason) {
  const ops = [{ col: 'animalEvents', id: ev.id, merge: true, data: voidData(reason), action: 'void' }]; const seen = new Set();
  const v = (col, id) => { if (!seen.has(col + id)) { seen.add(col + id); ops.push({ col, id, merge: true, data: voidData(reason), action: 'void' }); } };
  const want = ev.type === 'sale' ? 'animal_sale' : ev.type === 'purchase' ? 'animal_purchase' : null;
  if (want) animalCash(cash.filter((t) => t.type === want), ev.animalId, ev.tag, [ev]).filter((t) => t.date === ev.date && Number(t.amount) === Number(ev.value)).slice(0, 1).forEach((t) => v('cashTransactions', t.id));
  // ثمن شراء دفعه شريك: قيده في حسابه يُلغى مع الحدث
  ledger.filter((e) => !e.voided && e.type === 'animal_purchase_paid' && (e.eventId === ev.id || (!e.eventId && e.animalId === ev.animalId && e.date === ev.date && Number(e.amount) === Number(ev.value)))).slice(0, 1).forEach((e) => v('partnerCapitalTransactions', e.id));
  if (ev.type === 'purchase') ledger.filter((e) => e.animalId === ev.animalId && e.type === 'capital_contribution' && !e.voided && e.date === ev.date && Number(e.amount) === Number(ev.value)).slice(0, 1).forEach((e) => v('partnerCapitalTransactions', e.id));
  // تبادل: فرق نقدي/قيد شريك مرتبط بنفس التبادل
  if (ev.exchangeId) { cash.filter((t) => !t.voided && t.exchangeId === ev.exchangeId).forEach((t) => v('cashTransactions', t.id)); ledger.filter((e) => !e.voided && e.exchangeId === ev.exchangeId).forEach((e) => v('partnerCapitalTransactions', e.id)); }
  return commit(user, ops, 'void');
}
/** إلغاء تسوية معتمدة (فقط لو لا توجد توزيعات نقدية مرتبطة بها). */
export async function voidSettlement(user, st, ledger = [], reason) {
  if (ledger.some((e) => e.type === 'profit_distribution' && e.settlementId === st.id && !e.voided)) throw new Error('توجد توزيعات نقدية مرتبطة بهذه التسوية — ألغِها أولاً.');
  const ops = [{ col: 'settlements', id: st.id, merge: true, data: voidData(reason), action: 'void' }];
  ledger.filter((e) => e.type === 'profit_allocation' && e.settlementId === st.id && !e.voided).forEach((e) => ops.push({ col: 'partnerCapitalTransactions', id: e.id, merge: true, data: voidData(reason), action: 'void' }));
  return commit(user, ops, 'void');
}
/** إلغاء توزيع نقدي: قيد الشريك + حركة الصندوق. */
export async function voidDistribution(user, entry, cash = [], reason) {
  const t = cash.find((x) => !x.voided && x.type === 'profit_distribution' && (x.ledgerEntryId === entry.id || (!x.ledgerEntryId && x.partnerId === entry.partnerId && x.date === entry.date && Number(x.amount) === Number(entry.amount) && x.currency === entry.currency)));
  const ops = [{ col: 'partnerCapitalTransactions', id: entry.id, merge: true, data: voidData(reason), action: 'void' }];
  if (t) ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' });
  return commit(user, ops, 'void');
}

/** ربط مشتريات الحيوانات المسجّلة بحساب شريك: يُقيَّد ثمن كل حيوان في حسابه (مستحق له)، وتُلغى حركة الصندوق الخاصة بالشراء (إن وُجدت) وأي قيد رأس مال قديم.
 *  الشراء الذي كان «من رأس مال» يُنقل إلى حساب نفس الشريك الذي اختير له. */
export async function linkPurchasesToPartner(user, animals, { events = [], cash = [], ledger = [] } = {}, partnerId) {
  const byId = Object.fromEntries(animals.filter((a) => !a.voided).map((a) => [a.id, a]));
  const evs = events.filter((e) => !e.voided && e.type === 'purchase' && Number(e.value) > 0 && byId[e.animalId] && e.paidFrom !== 'partner');
  if (!evs.length) throw new Error('لا توجد مشتريات حيوانات غير مرتبطة بحساب شريك');
  const ops = []; const done = new Set();
  const voidOnce = (col, id) => { if (done.has(col + id)) return; done.add(col + id); ops.push({ col, id, merge: true, data: voidData('نُقل الشراء إلى حساب شريك'), action: 'void' }); };
  for (const ev of evs) {
    const pid = ev.paidFrom === 'capital' && ev.capitalPartnerId ? ev.capitalPartnerId : partnerId;
    if (!pid) throw new Error('اختر الشريك');
    ops.push({ col: 'animalEvents', id: ev.id, merge: true, data: { paidFrom: 'partner', payerPartnerId: pid } });
    animalCash(cash.filter((t) => t.type === 'animal_purchase'), ev.animalId, ev.tag, [ev]).filter((t) => t.date === ev.date && Number(t.amount) === Number(ev.value)).slice(0, 1).forEach((t) => voidOnce('cashTransactions', t.id));
    ledger.filter((e) => e.animalId === ev.animalId && e.type === 'capital_contribution' && !e.voided).forEach((e) => voidOnce('partnerCapitalTransactions', e.id));
    if (!ledger.some((e) => !e.voided && e.type === 'animal_purchase_paid' && e.eventId === ev.id)) ops.push({ col: 'partnerCapitalTransactions', data: { partnerId: pid, date: ev.date, type: 'animal_purchase_paid', amount: Number(ev.value), currency: ev.currency || 'SYP', animalId: ev.animalId, eventId: ev.id, note: `شراء ${ev.tag}` } });
  }
  for (let i = 0; i < ops.length; i += 150) await commit(user, ops.slice(i, i + 150), 'update');
  return evs.length;
}
export const linkPurchasesToCapital = linkPurchasesToPartner;
/** إلغاء قيود «رأس المال الابتدائي» (لم يعد مستخدماً: الحساب يُبنى من القروض وأثمان الحيوانات). */
export async function voidInitialCapital(user, ledger = [], reason = 'إلغاء رأس المال الابتدائي (غير مستخدم)') {
  const list = ledger.filter((e) => e.type === 'capital_contribution' && e.opening && !e.animalId && !e.voided);
  if (!list.length) throw new Error('لا توجد قيود رأس مال ابتدائي');
  await commit(user, list.map((e) => ({ col: 'partnerCapitalTransactions', id: e.id, merge: true, data: voidData(reason), action: 'void' })), 'void');
  return list.length;
}
/** سداد لشريك من الصندوق: سلف أولاً (الأقدم فالأحدث) ثم ثمن البقر — أو حسب الاختيار. يرفض لو رصيد الصندوق لا يكفي. */
export async function repayPartner(user, partner, { ledger = [], loans = [], repayments = [], cash = [] } = {}, { date, amount, accountId, order = 'loans_first', currency = 'SYP' }) {
  if (!accountId) throw new Error('اختر الصندوق الذي يُسدَّد منه');
  const debt = partnerDebt(partner.id, ledger, currency);
  const plan = planPartnerRepayment({ loans: debt.loans, purchases: debt.purchases, other: debt.other, amount, order });
  const avail = cashBalances(cash.filter((t) => !t.voided))[`${accountId}|${currency}`] || 0;
  if (Number(amount) > avail + 0.005) throw new Error(`رصيد الصندوق لا يكفي (المتاح ${Math.round(avail * 100) / 100})`);
  const ops = [];
  if (plan.toLoans > 0) {
    const { parts, unallocated } = allocateToLoans(partner.id, loans, repayments, plan.toLoans, currency);
    if (unallocated > 0.005) throw new Error('لا توجد قروض نشطة تكفي لهذا الجزء من السداد');
    for (const { loan, principal } of parts) {
      ops.push({ col: 'partnerLoanRepayments', data: { loanId: loan.id, partnerId: partner.id, date, principalAmount: principal, interestAmount: 0, currency, accountId } });
      ops.push({ col: 'partnerCapitalTransactions', data: { partnerId: partner.id, date, type: 'loan_principal_repayment', amount: principal, currency, loanId: loan.id } });
      ops.push({ col: 'cashTransactions', data: { date, type: 'loan_repayment', direction: 'out', amount: principal, currency, accountId, partnerId: partner.id, loanId: loan.id } });
    }
  }
  if (plan.toPurchases > 0) {
    const lid = newId('partnerCapitalTransactions');
    ops.push({ col: 'partnerCapitalTransactions', id: lid, data: { partnerId: partner.id, date, type: 'animal_purchase_repaid', amount: plan.toPurchases, currency, note: 'سداد ثمن حيوانات' } });
    ops.push({ col: 'cashTransactions', data: { date, type: 'animal_purchase_repayment', direction: 'out', amount: plan.toPurchases, currency, accountId, partnerId: partner.id, ledgerEntryId: lid, description: 'سداد ثمن بقر للشريك' } });
  }
  if (plan.toOther > 0) {
    const lid = newId('partnerCapitalTransactions');
    ops.push({ col: 'partnerCapitalTransactions', id: lid, data: { partnerId: partner.id, date, type: 'reimbursement', amount: plan.toOther, currency, note: 'سداد مصروفات/مبالغ دفعها الشريك' } });
    ops.push({ col: 'cashTransactions', data: { date, type: 'partner_reimbursement', direction: 'out', amount: plan.toOther, currency, accountId, partnerId: partner.id, ledgerEntryId: lid, description: 'سداد مصروفات/مبالغ للشريك' } });
  }
  await commit(user, ops);
  return plan;
}
/** إلغاء حركات صندوق محدّدة (مثلاً حركة شراء حيوان مسجّلة مرتين). */
export async function voidCashTransactions(user, txs, reason) {
  const ops = txs.map((t) => ({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  for (let i = 0; i < ops.length; i += 150) await commit(user, ops.slice(i, i + 150), 'void');
  return ops.length;
}

// ───────────── فئات مخصّصة ─────────────
const catField = (kind) => (kind === 'animal' ? 'customAnimalCats' : 'customExpenseCats');
/** يضيف فئة جديدة ويرجع معرّفها (لو الاسم موجود مسبقاً يرجع معرّف الموجود دون تكرار). */
export async function addCustomCategory(user, kind, label, current = []) {
  const clean = String(label || '').trim(); if (!clean) throw new Error('اكتب اسم الفئة الجديدة');
  const hit = (kind === 'animal' ? allAnimalCategories() : allExpenseCategories()).find(([, l]) => String(l).trim() === clean);
  if (hit) return hit[0];
  const id = `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
  await commit(user, [{ col: 'settings', id: 'counters', merge: true, data: { [catField(kind)]: [...current, { id, label: clean }] } }], 'update');
  return id;
}
/** يحفظ قائمة الفئات المخصّصة كاملة (إعادة تسمية / حذف). */
export const saveCustomCategories = (user, kind, list) => commit(user, [{ col: 'settings', id: 'counters', merge: true, data: { [catField(kind)]: list } }], 'update');

/** تحويل فروق تبادل سبق دفعها من الصندوق إلى حساب شريك يحدّده المستخدم لكل فرق: تُلغى حركة الصندوق ويُقيَّد الفرق «ثمن حيوان دفعه الشريك» في حسابه. */
export async function switchExchangeDiffToPartner(user, items, { events = [], ledger = [] } = {}) {
  if (!items.length) throw new Error('لا توجد فروق للتحويل');
  const groups = [];
  for (const { tx, partnerId } of items) {
    if (!partnerId) throw new Error('اختر الشريك لكل فرق');
    if (tx.type !== 'animal_exchange_payment' || tx.voided) continue;
    if (tx.exchangeId && ledger.some((e) => !e.voided && e.type === 'animal_purchase_paid' && e.exchangeId === tx.exchangeId)) continue; // محوَّل من قبل
    const inEv = events.find((e) => !e.voided && e.exchangeId === tx.exchangeId && e.type === 'exchange_in');
    groups.push([
      { col: 'cashTransactions', id: tx.id, merge: true, data: voidData('فرق تبادل نُقل إلى حساب شريك'), action: 'void' },
      { col: 'partnerCapitalTransactions', data: { partnerId, date: tx.date, type: 'animal_purchase_paid', amount: Number(tx.amount), currency: tx.currency || 'SYP', animalId: inEv?.animalId || null, exchangeId: tx.exchangeId || null, note: tx.description || 'فرق تبادل' } },
      ...(inEv ? [{ col: 'animalEvents', id: inEv.id, merge: true, data: { diffPaidBy: partnerId } }] : []),
    ]);
  }
  if (!groups.length) throw new Error('لا يوجد ما يُحوَّل (ربما حُوِّل من قبل)');
  for (let i = 0; i < groups.length; i += 50) await commit(user, groups.slice(i, i + 50).flat(), 'update');
  return groups.length;
}

/** ربط مصروفات قديمة (سحب شريك / سلف شريك / سداد أصل قرض) بحسابات الشركاء: يُقيَّد أثر كل دفعة موجودة في حساب الشريك الذي تختاره. */
export async function linkExpensesToPartners(user, items, { pays = [], ledger = [], loans = [], repayments = [] } = {}) {
  const groups = []; const reps = [...repayments];
  for (const { expense, partnerId } of items) {
    if (!PARTNER_EXPENSE_CATS[expense.category] || expense.voided || expense.partnerAccountId) continue;
    if (!partnerId) throw new Error('اختر الشريك لكل مصروف');
    if (ledger.some((e) => !e.voided && e.expenseId === expense.id && Object.values(PARTNER_EXPENSE_CATS).includes(e.type))) continue;
    const ops = [{ col: 'expenses', id: expense.id, merge: true, data: { partnerAccountId: partnerId } }];
    for (const pay of pays.filter((p) => p.expenseId === expense.id && !p.voided && (p.source || 'account') === 'account').sort((a, b) => a.date.localeCompare(b.date))) {
      const e = partnerEntriesForPayment({ expense, partnerId, payId: pay.id, date: pay.date, amount: pay.amount, loans, repayments: reps });
      e.filter((x) => x.col === 'partnerLoanRepayments').forEach((x) => reps.push({ ...x.data, id: `tmp-${reps.length}` })); // يحسب التوزيع التالي بعد هذا
      ops.push(...e);
    }
    groups.push(ops);
  }
  if (!groups.length) throw new Error('لا يوجد ما يُربط (ربما رُبط من قبل)');
  for (let i = 0; i < groups.length; i += 40) await commit(user, groups.slice(i, i + 40).flat(), 'update');
  return groups.length;
}

// ───────────── كشف حساب الشريك: تعديل / حذف أي بند مع مزامنة ما يرتبط به ─────────────
const nn = (x) => Number(x) || 0;
const findRep = (entry, reps) => reps.find((r) => !r.voided && !r.expensePaymentId && r.loanId === entry.loanId && r.date === entry.date && nn(entry.type === 'interest_paid' ? r.interestAmount : r.principalAmount) === nn(entry.amount));
/** تعديل بند في كشف حساب شريك (التاريخ / المبلغ / الملاحظة / الصندوق) — وتتحدّث معه الحركات المرتبطة (صندوق، قرض، سداد، سعر حيوان، دفعة مصروف). */
export async function updateLedgerEntry(user, entry, ctx = {}, d = {}) {
  const amount = Number(d.amount); if (!(amount > 0)) throw new Error('أدخل مبلغاً أكبر من صفر');
  const { cash = [], loans = [], reps = [], events = [], animals = [], pays = [], expenses = [], ledger = [] } = ctx;
  const date = d.date || entry.date; const note = d.note !== undefined ? d.note : (entry.note || '');
  if (entry.type === 'profit_allocation') throw new Error('هذا القيد ناتج عن تسوية أرباح: لا يُعدَّل هنا. ألغِ التسوية من «تسويات وتوزيع الأرباح» وأعد اعتمادها.');
  if (entry.expensePaymentId) { // أصله دفعة مصروف: نعدّلها من مصدرها فتتزامن كل الحركات
    const pay = pays.find((p) => p.id === entry.expensePaymentId); const exp = pay && expenses.find((e) => e.id === pay.expenseId);
    if (!pay || !exp) throw new Error('الدفعة الأصلية للمصروف غير موجودة');
    return updateExpensePayment(user, exp, pays, pay, { cash, ledger, reps }, { date, amount, accountId: d.accountId, note: d.note });
  }
  const ops = [{ col: 'partnerCapitalTransactions', id: entry.id, merge: true, data: { date, amount, note } }];
  cash.filter((t) => !t.voided && t.ledgerEntryId === entry.id).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: { date, amount, ...(d.accountId ? { accountId: d.accountId } : {}), ...(note ? { description: note } : {}) } }));
  if (entry.type === 'loan_given' && entry.loanId) {
    const repaid = reps.filter((r) => !r.voided && r.loanId === entry.loanId).reduce((s, r) => s + nn(r.principalAmount), 0);
    if (amount + 1e-9 < repaid) throw new Error(`مبلغ القرض أقل مما سُدِّد منه (${r2(repaid)})`);
    ops.push({ col: 'partnerLoans', id: entry.loanId, merge: true, data: { principal: amount, disbursementDate: date } });
    cash.filter((t) => !t.voided && t.loanId === entry.loanId && t.type === 'loan_received').forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: { date, amount, ...(d.accountId ? { accountId: d.accountId } : {}) } }));
  } else if (['loan_principal_repayment', 'interest_paid'].includes(entry.type) && entry.loanId) {
    const rep = findRep(entry, reps);
    if (rep) {
      const isInt = entry.type === 'interest_paid'; const loan = loans.find((l) => l.id === entry.loanId);
      if (!isInt && loan) { const others = reps.filter((r) => !r.voided && r.loanId === loan.id && r.id !== rep.id).reduce((s, r) => s + nn(r.principalAmount), 0); if (others + amount > nn(loan.principal) + 0.005) throw new Error(`السداد يتجاوز أصل القرض (المتاح ${r2(nn(loan.principal) - others)})`); }
      const total = isInt ? nn(rep.principalAmount) + amount : amount + nn(rep.interestAmount);
      ops.push({ col: 'partnerLoanRepayments', id: rep.id, merge: true, data: { date, ...(isInt ? { interestAmount: amount } : { principalAmount: amount }) } });
      cash.filter((t) => !t.voided && t.loanId === entry.loanId && t.type === 'loan_repayment' && t.date === entry.date && nn(t.amount) === nn(rep.principalAmount) + nn(rep.interestAmount)).slice(0, 1).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: { date, amount: total, ...(d.accountId ? { accountId: d.accountId } : {}) } }));
    }
  } else if (entry.type === 'animal_purchase_paid') {
    const ev = events.find((e) => e.id === entry.eventId) || events.find((e) => !e.voided && e.type === 'purchase' && e.animalId === entry.animalId && e.date === entry.date && nn(e.value) === nn(entry.amount));
    if (ev) { ops.push({ col: 'animalEvents', id: ev.id, merge: true, data: { value: amount, date } }); const an = animals.find((a) => a.id === ev.animalId); if (an && ev.type === 'purchase') ops.push({ col: 'animals', id: an.id, merge: true, data: { acquisitionCost: amount, ...(an.acquisitionDate === entry.date ? { acquisitionDate: date } : {}) } }); }
  }
  return commit(user, ops, 'update');
}
/** حذف (إلغاء) بند من كشف حساب الشريك مع كل ما يرتبط به. يبقى في سجل التدقيق. */
export async function voidLedgerEntry(user, entry, ctx = {}, reason) {
  const { cash = [], loans = [], reps = [], events = [], pays = [], ledger = [] } = ctx; const V = (col, id) => ({ col, id, merge: true, data: voidData(reason), action: 'void' });
  if (entry.type === 'profit_allocation') throw new Error('قيد ناتج عن تسوية أرباح: ألغِ التسوية من صفحة التسويات.');
  if (entry.expensePaymentId) { const pay = pays.find((p) => p.id === entry.expensePaymentId); if (!pay) throw new Error('الدفعة الأصلية غير موجودة'); return voidExpensePayment(user, pay, { cash, ledger, reps }, reason); }
  const ops = [V('partnerCapitalTransactions', entry.id)]; const seen = new Set([entry.id]);
  cash.filter((t) => !t.voided && t.ledgerEntryId === entry.id).forEach((t) => ops.push(V('cashTransactions', t.id)));
  if (entry.type === 'loan_given' && entry.loanId) {
    if (reps.some((r) => !r.voided && r.loanId === entry.loanId)) throw new Error('لهذا القرض سدادات: ألغِ سداداته أولاً.');
    ops.push(V('partnerLoans', entry.loanId)); cash.filter((t) => !t.voided && t.loanId === entry.loanId && t.type === 'loan_received').forEach((t) => ops.push(V('cashTransactions', t.id)));
  } else if (['loan_principal_repayment', 'interest_paid'].includes(entry.type) && entry.loanId) {
    const rep = findRep(entry, reps);
    if (rep) {
      ops.push(V('partnerLoanRepayments', rep.id));
      cash.filter((t) => !t.voided && t.loanId === entry.loanId && t.type === 'loan_repayment' && t.date === entry.date && nn(t.amount) === nn(rep.principalAmount) + nn(rep.interestAmount)).slice(0, 1).forEach((t) => ops.push(V('cashTransactions', t.id)));
      const sib = ledger.find((e) => !e.voided && !seen.has(e.id) && e.loanId === entry.loanId && e.date === entry.date && ((entry.type === 'interest_paid' && e.type === 'loan_principal_repayment' && nn(e.amount) === nn(rep.principalAmount)) || (entry.type !== 'interest_paid' && e.type === 'interest_paid' && nn(e.amount) === nn(rep.interestAmount))));
      if (sib) ops.push(V('partnerCapitalTransactions', sib.id));
    }
  } else if (entry.type === 'animal_purchase_paid') {
    const ev = events.find((e) => e.id === entry.eventId); if (ev) ops.push({ col: 'animalEvents', id: ev.id, merge: true, data: { paidFrom: null, payerPartnerId: null } });
  }
  return commit(user, ops, 'void');
}

/** يطبّق إصلاحاً قادماً من فحص السلامة: عمليات إلغاء (void) أو دمج (merge) أو إنشاء. */
export async function applyFixOps(user, ops, reason = 'تصحيح تلقائي من فحص سلامة البيانات') {
  const list = ops.map((o) => (o.void ? { col: o.col, id: o.id, merge: true, data: voidData(reason), action: 'void' } : o));
  for (let i = 0; i < list.length; i += 150) await commit(user, list.slice(i, i + 150), 'update');
  return list.length;
}
