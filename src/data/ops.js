// Multi-record financial operations. Each is ONE atomic batch so related records can never get out of sync.
import { serverTimestamp } from 'firebase/firestore';
import { commit, nextNumber, newId } from './db';
import { validateDelivery, validateExpensePayment, partnerFundedExpenseEntry, makeTransfer, allocateProfit } from '../lib/finance';

const today = () => new Date().toISOString().slice(0, 10);

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
export async function payExpense(user, expense, payments, p) {
  const v = validateExpensePayment(expense, payments, p.amount);
  if (!v.ok) throw new Error(`المبلغ يتجاوز المتبقي (${v.outstanding})`);
  const payId = newId('expensePayments');
  const ops = [{ col: 'expensePayments', id: payId, data: { expenseId: expense.id, date: p.date, amount: p.amount, currency: expense.currency, source: p.source, accountId: p.accountId || null, partnerId: p.partnerId || null } }];
  if (p.source === 'account') ops.push({ col: 'cashTransactions', data: { date: p.date, type: 'expense_payment', direction: 'out', amount: p.amount, currency: expense.currency, accountId: p.accountId, expenseId: expense.id, expensePaymentId: payId, supplierId: expense.supplierId || null, description: expense.description || '' } });
  if (p.source === 'partner') ops.push({ col: 'partnerCapitalTransactions', data: partnerFundedExpenseEntry(expense, { id: payId, partnerId: p.partnerId, date: p.date, amount: p.amount }) });
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
  return commit(user, [
    { col: 'partnerCapitalTransactions', data: { partnerId: m.partnerId, date: m.date, type: m.type, amount: m.amount, currency: m.currency, note: m.note || '', settlementId: m.settlementId || null } },
    { col: 'cashTransactions', data: { date: m.date, type: cashType, direction: dir, amount: m.amount, currency: m.currency, accountId: m.accountId, partnerId: m.partnerId } },
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
export async function finalizeSettlement(user, s, partners) {
  const alloc = allocateProfit(s.netProfit, partners);
  const id = newId('settlements');
  return commit(user, [
    { col: 'settlements', id, data: { ...s, allocations: alloc, status: 'finalized', approvedBy: user.uid, approvedAt: today() }, action: 'finalize' },
    ...alloc.map((a) => ({ col: 'partnerCapitalTransactions', data: { partnerId: a.partnerId, date: s.to, type: 'profit_allocation', amount: a.amount, currency: s.currency, settlementId: id } })),
  ]);
}
export const recordAnimalEvent = (user, ev, cash) => commit(user, [{ col: 'animalEvents', data: ev }, ...(cash ? [{ col: 'cashTransactions', data: cash }] : [])]);

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
  const ops = [{ col: 'expenses', id, data: e }];
  if (p.payNow && p.payNow !== 'no') {
    const amount = p.payNow === 'full' ? Number(e.amount) : Number(p.paidAmount);
    if (!(amount > 0) || amount > Number(e.amount)) throw new Error('مبلغ الدفع يجب أن يكون أكبر من صفر ولا يتجاوز قيمة المصروف');
    const source = p.source || 'account';
    if (source === 'account' && !p.accountId) throw new Error('اختر الصندوق');
    if (source === 'partner' && !p.partnerId) throw new Error('اختر الشريك');
    const pdate = p.payDate || e.date; // تاريخ الدفع الفعلي (افتراضياً = تاريخ المصروف)
    const payId = newId('expensePayments');
    ops.push({ col: 'expensePayments', id: payId, data: { expenseId: id, date: pdate, amount, currency: e.currency, source, accountId: source === 'account' ? p.accountId : null, partnerId: source === 'partner' ? p.partnerId : null } });
    if (source === 'account') ops.push({ col: 'cashTransactions', data: { date: pdate, type: 'expense_payment', direction: 'out', amount, currency: e.currency, accountId: p.accountId, expenseId: id, expensePaymentId: payId, description: e.description || '' } });
    else ops.push({ col: 'partnerCapitalTransactions', data: partnerFundedExpenseEntry({ ...e, id }, { id: payId, partnerId: p.partnerId, date: pdate, amount }) });
  }
  return commit(user, ops);
}

// ───────────── تعديل / إلغاء الدفعات (مع مزامنة حركة الصندوق المرتبطة) ─────────────
const r2 = (x) => Math.round((Number(x) || 0) * 100) / 100;
const voidData = (reason) => ({ voided: true, voidReason: reason || '', voidedAt: serverTimestamp() });

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
/** تعديل مصروف. لو تغيّر تاريخه تتبعه الدفعات التي كانت بنفس تاريخه (حركة الصندوق ودفتر الشريك أيضاً). */
export async function updateExpenseSynced(user, expense, data, { pays = [], cash = [], ledger = [] } = {}) {
  const ops = [{ col: 'expenses', id: expense.id, merge: true, data }];
  const mine = pays.filter((p) => p.expenseId === expense.id && !p.voided);
  const dateChanged = data.date && data.date !== expense.date;
  for (const p of mine) {
    const follow = dateChanged && p.date === expense.date;
    if (follow) ops.push({ col: 'expensePayments', id: p.id, merge: true, data: { date: data.date } });
    for (const t of cash.filter((t) => t.expensePaymentId === p.id && !t.voided)) {
      const patch = {}; if (follow) patch.date = data.date; if (data.description !== undefined && data.description !== expense.description) patch.description = data.description;
      if (Object.keys(patch).length) ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: patch });
    }
    if (follow) for (const t of ledger.filter((t) => t.expensePaymentId === p.id && !t.voided)) ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: { date: data.date } });
  }
  return commit(user, ops, 'update');
}
/** تعديل دفعة مصروف (التاريخ/المبلغ) مع حركة الصندوق أو قيد الشريك المرتبط. */
export async function updateExpensePayment(user, expense, allPays, pay, links, d) {
  const amount = Number(d.amount);
  if (!(amount > 0)) throw new Error('أدخل مبلغاً أكبر من صفر');
  const others = allPays.filter((p) => p.expenseId === expense.id && !p.voided && p.id !== pay.id).reduce((a, p) => a + Number(p.amount || 0), 0);
  if (amount + others > Number(expense.amount) + 1e-9) throw new Error(`المبلغ يتجاوز قيمة المصروف (الحد الأقصى ${r2(Number(expense.amount) - others)})`);
  const ops = [{ col: 'expensePayments', id: pay.id, merge: true, data: { date: d.date, amount } }];
  (links.cash || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: { date: d.date, amount } }));
  (links.ledger || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: { date: d.date, amount } }));
  return commit(user, ops, 'update');
}
export async function voidExpensePayment(user, pay, links, reason) {
  const ops = [{ col: 'expensePayments', id: pay.id, merge: true, data: voidData(reason), action: 'void' }];
  (links.cash || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'cashTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  (links.ledger || []).filter((t) => t.expensePaymentId === pay.id && !t.voided).forEach((t) => ops.push({ col: 'partnerCapitalTransactions', id: t.id, merge: true, data: voidData(reason), action: 'void' }));
  return commit(user, ops, 'void');
}
