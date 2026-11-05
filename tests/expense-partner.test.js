import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls = []; let n = 0;
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => `${c}#${++n}`) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
const F = await import('../src/lib/finance.js');
beforeEach(() => { calls.length = 0; n = 0; });
const loans = [{ id: 'L1', partnerId: 'w', principal: 300, currency: 'SYP', disbursementDate: '2026-01-01' }, { id: 'L2', partnerId: 'w', principal: 500, currency: 'SYP', disbursementDate: '2026-03-01' }];
const exp = (category, extra = {}) => ({ id: 'E1', category, amount: 1000, currency: 'SYP', date: '2026-05-01', description: 'بيان', partnerAccountId: 'w', ...extra });

describe('سحب / سلفة شريك كمصروف ← حسابه', () => {
  it('سحب شريك: قيد "withdrawal" في حسابه + حركة الصندوق (مصروف) — بدون قيد مكرر للصندوق', async () => {
    await O.addExpenseWithPayment({}, exp('partner_withdrawal'), { payNow: 'full', source: 'account', accountId: 'cb' });
    const ops = calls[0].ops; expect(ops.map((o) => o.col)).toEqual(['expenses', 'expensePayments', 'cashTransactions', 'partnerCapitalTransactions']);
    expect(ops[3].data).toMatchObject({ partnerId: 'w', type: 'withdrawal', amount: 1000, expenseId: 'expenses#1', expensePaymentId: 'expensePayments#2' });
  });
  it('سلفة شريك: قيد "partner_advance" وتنقص مستحقه', async () => {
    await O.addExpenseWithPayment({}, exp('partner_advance', { amount: 400 }), { payNow: 'full', source: 'account', accountId: 'cb' });
    expect(calls[0].ops[3].data).toMatchObject({ type: 'partner_advance', amount: 400 });
    const led = [{ partnerId: 'w', type: 'loan_given', amount: 1000, currency: 'SYP', date: 'd' }, { partnerId: 'w', type: 'partner_advance', amount: 400, currency: 'SYP', date: 'd' }];
    expect(F.partnerDebt('w', led)).toMatchObject({ loans: 1000, other: -400, total: 600, advances: 400 });
  });
  it('سداد أصل قرض: يوزَّع على قروضه الأقدم فالأحدث، يُنقص أصل القرض ويُقيَّد في حسابه', async () => {
    await O.addExpenseWithPayment({}, exp('loan_principal', { amount: 600 }), { payNow: 'full', source: 'account', accountId: 'cb', loans, repayments: [] });
    const ops = calls[0].ops; const reps = ops.filter((o) => o.col === 'partnerLoanRepayments'); const led = ops.filter((o) => o.col === 'partnerCapitalTransactions');
    expect(reps.map((o) => [o.data.loanId, o.data.principalAmount])).toEqual([['L1', 300], ['L2', 300]]);
    expect(led.map((o) => [o.data.type, o.data.amount, o.data.loanId])).toEqual([['loan_principal_repayment', 300, 'L1'], ['loan_principal_repayment', 300, 'L2']]);
    const allReps = reps.map((o) => o.data); expect(F.loanPosition(loans[0], allReps).outstandingPrincipal).toBe(0); expect(F.loanPosition(loans[1], allReps).outstandingPrincipal).toBe(200);
    expect(F.partnerDebt('w', [{ partnerId: 'w', type: 'loan_given', amount: 800, currency: 'SYP' }, ...led.map((o) => o.data)]).loans).toBe(200);
  });
  it('سداد قرض أكبر من السلف القائمة أو بلا قرض ← خطأ واضح', async () => {
    await expect(O.addExpenseWithPayment({}, exp('loan_principal', { amount: 900 }), { payNow: 'full', source: 'account', accountId: 'cb', loans, repayments: [] })).rejects.toThrow(/أكبر من السلف/);
    await expect(O.addExpenseWithPayment({}, exp('loan_principal'), { payNow: 'full', source: 'account', accountId: 'cb', loans: [], repayments: [] })).rejects.toThrow(/لا توجد سلفة/);
  });
  it('لازم شريك، ولازم الدفع من الصندوق', async () => {
    await expect(O.addExpenseWithPayment({}, exp('partner_withdrawal', { partnerAccountId: '' }), { payNow: 'full', source: 'account', accountId: 'cb' })).rejects.toThrow(/اختر الشريك/);
    await expect(O.addExpenseWithPayment({}, exp('partner_withdrawal'), { payNow: 'full', source: 'partner', partnerId: 'w' })).rejects.toThrow(/صندوق/);
  });
  it('مصروف عادي (علف) لا يلمس حساب أي شريك', async () => {
    await O.addExpenseWithPayment({}, { id: 'E', category: 'feed', amount: 50, currency: 'SYP', date: 'd' }, { payNow: 'full', source: 'account', accountId: 'cb' });
    expect(calls[0].ops.map((o) => o.col)).toEqual(['expenses', 'expensePayments', 'cashTransactions']);
  });
  it('الدفع الآجل لاحقاً (payExpense) يُقيَّد أيضاً؛ ومصروف قديم بلا شريك يُرفض حتى يُربط', async () => {
    await O.payExpense({}, exp('partner_withdrawal'), [], { amount: 250, date: 'd', source: 'account', accountId: 'cb' });
    expect(calls[0].ops.at(-1).data).toMatchObject({ type: 'withdrawal', amount: 250 });
    await expect(O.payExpense({}, exp('partner_withdrawal', { partnerAccountId: '' }), [], { amount: 250, date: 'd', source: 'account', accountId: 'cb' })).rejects.toThrow(/اربط/);
  });
});
describe('إلغاء/تعديل يتبع الحساب', () => {
  const links = { ledger: [{ id: 'led1', expensePaymentId: 'P1' }, { id: 'led2', expensePaymentId: 'P1' }], reps: [{ id: 'r1', expensePaymentId: 'P1' }, { id: 'r2', expensePaymentId: 'P1' }, { id: 'rx', expensePaymentId: 'P9' }], cash: [{ id: 'c1', expensePaymentId: 'P1' }] };
  it('إلغاء الدفعة يلغي القيود وسدادات القرض والصندوق', async () => {
    await O.voidExpensePayment({}, { id: 'P1' }, links, 'x'); expect(calls[0].ops.map((o) => o.col + ':' + o.id)).toEqual(['expensePayments:P1', 'cashTransactions:c1', 'partnerCapitalTransactions:led1', 'partnerCapitalTransactions:led2', 'partnerLoanRepayments:r1', 'partnerLoanRepayments:r2']);
  });
  it('إلغاء المصروف كله يلغي كل ما يتبعه', async () => {
    await O.voidExpenseCascade({}, { id: 'E1' }, { pays: [{ id: 'P1', expenseId: 'E1' }], cash: links.cash, ledger: links.ledger, reps: links.reps }, 'x');
    expect(calls[0].ops.filter((o) => o.col === 'partnerLoanRepayments').length).toBe(2);
  });
  it('تعديل مبلغ دفعة موزّعة على أكثر من قرض مرفوض، وتعديل التاريخ مسموح', async () => {
    const e = { id: 'E1', amount: 1000 }; const pay = { id: 'P1', expenseId: 'E1', amount: 600, date: 'd' };
    await expect(O.updateExpensePayment({}, e, [pay], pay, links, { date: 'd2', amount: 500 })).rejects.toThrow(/أكثر من قرض/);
    await O.updateExpensePayment({}, e, [pay], pay, links, { date: 'd2', amount: 600 }); expect(calls[0].ops.filter((o) => o.data.date === 'd2').length).toBe(6);
  });
});
describe('ربط المصروفات القديمة بحسابات الشركاء', () => {
  const pays = [{ id: 'p1', expenseId: 'E1', amount: 300, date: '2026-05-01', source: 'account' }, { id: 'p2', expenseId: 'E2', amount: 400, date: '2026-05-02', source: 'account' }];
  it('سحب + سداد قرض: يربط الدفعات الموجودة ويحسب التوزيع بالتتابع', async () => {
    const items = [{ expense: exp('partner_withdrawal', { id: 'E1', amount: 300, partnerAccountId: undefined }), partnerId: 'w' }, { expense: exp('loan_principal', { id: 'E2', amount: 400, partnerAccountId: undefined }), partnerId: 'w' }];
    const k = await O.linkExpensesToPartners({}, items, { pays, ledger: [], loans, repayments: [] });
    expect(k).toBe(2); const ops = calls[0].ops;
    expect(ops.filter((o) => o.col === 'expenses').map((o) => o.data.partnerAccountId)).toEqual(['w', 'w']);
    expect(ops.filter((o) => o.col === 'partnerLoanRepayments').map((o) => [o.data.loanId, o.data.principalAmount])).toEqual([['L1', 300], ['L2', 100]]);
  });
  it('لا يكرر ما رُبط، ويرفض بلا شريك', async () => {
    const e = exp('partner_withdrawal', { id: 'E1', partnerAccountId: undefined });
    await expect(O.linkExpensesToPartners({}, [{ expense: e, partnerId: 'w' }], { pays, ledger: [{ expenseId: 'E1', type: 'withdrawal' }], loans: [], repayments: [] })).rejects.toThrow(/لا يوجد ما يُربط/);
    await expect(O.linkExpensesToPartners({}, [{ expense: e, partnerId: '' }], { pays, ledger: [], loans: [], repayments: [] })).rejects.toThrow(/اختر الشريك/);
  });
});
