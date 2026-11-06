import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls = [];
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => 'ID-' + c) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
beforeEach(() => { calls.length = 0; });
const ids = (ops) => ops.map((o) => `${o.col}:${o.id || 'new'}`);

describe('تعديل بند في كشف حساب الشريك — كل البيانات وتتزامن الحركات المرتبطة', () => {
  it('سحب/توزيع/سداد (له حركة صندوق مرتبطة): القيد + الصندوق (تاريخ/مبلغ/حساب/بيان)', async () => {
    const entry = { id: 'L1', partnerId: 'w', type: 'withdrawal', amount: 100, date: 'd1', note: '' };
    await O.updateLedgerEntry({}, entry, { cash: [{ id: 'c1', ledgerEntryId: 'L1' }, { id: 'c2', ledgerEntryId: 'OTHER' }] }, { date: 'd2', amount: '150', accountId: 'cb2', note: 'ملاحظة' });
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L1', 'cashTransactions:c1']);
    expect(calls[0].ops[0].data).toEqual({ date: 'd2', amount: 150, note: 'ملاحظة' }); expect(calls[0].ops[1].data).toMatchObject({ date: 'd2', amount: 150, accountId: 'cb2', description: 'ملاحظة' });
  });
  it('قرض أعطاه الشريك: يتحدّث القرض نفسه + حركة الصندوق، ويرفض مبلغاً أقل مما سُدِّد', async () => {
    const entry = { id: 'L1', partnerId: 'w', type: 'loan_given', amount: 1000, date: 'd1', loanId: 'LN' };
    const ctx = { cash: [{ id: 'c1', loanId: 'LN', type: 'loan_received' }], reps: [{ id: 'r1', loanId: 'LN', principalAmount: 300 }] };
    await O.updateLedgerEntry({}, entry, ctx, { date: 'd0', amount: 1200 });
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L1', 'partnerLoans:LN', 'cashTransactions:c1']); expect(calls[0].ops[1].data).toEqual({ principal: 1200, disbursementDate: 'd0' });
    await expect(O.updateLedgerEntry({}, entry, ctx, { date: 'd0', amount: 200 })).rejects.toThrow(/أقل مما سُدِّد/);
  });
  it('سداد أصل قرض: يتحدّث السداد وحركة الصندوق (أصل + فائدة)، ويرفض تجاوز أصل القرض', async () => {
    const entry = { id: 'L9', partnerId: 'w', type: 'loan_principal_repayment', amount: 300, date: 'd1', loanId: 'LN' };
    const ctx = { loans: [{ id: 'LN', principal: 1000 }], reps: [{ id: 'r1', loanId: 'LN', date: 'd1', principalAmount: 300, interestAmount: 20 }, { id: 'r2', loanId: 'LN', date: 'd5', principalAmount: 600, interestAmount: 0 }], cash: [{ id: 'c1', loanId: 'LN', type: 'loan_repayment', date: 'd1', amount: 320 }] };
    await O.updateLedgerEntry({}, entry, ctx, { date: 'd1', amount: 400 });
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L9', 'partnerLoanRepayments:r1', 'cashTransactions:c1']); expect(calls[0].ops[2].data.amount).toBe(420);
    await expect(O.updateLedgerEntry({}, entry, ctx, { date: 'd1', amount: 500 })).rejects.toThrow(/يتجاوز أصل القرض/);
  });
  it('ثمن حيوان دفعه الشريك: يتحدّث سعر الحدث وتكلفة الحيوان', async () => {
    const entry = { id: 'L2', partnerId: 'w', type: 'animal_purchase_paid', amount: 5000, date: 'd1', eventId: 'ev1', animalId: 'A1' };
    await O.updateLedgerEntry({}, entry, { events: [{ id: 'ev1', type: 'purchase', animalId: 'A1' }], animals: [{ id: 'A1', acquisitionDate: 'd1' }] }, { date: 'd2', amount: 5500 });
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L2', 'animalEvents:ev1', 'animals:A1']); expect(calls[0].ops[2].data).toEqual({ acquisitionCost: 5500, acquisitionDate: 'd2' });
  });
  it('قيد أصله دفعة مصروف: يُعدَّل من الدفعة فتتزامن كل الحركات', async () => {
    const entry = { id: 'L3', partnerId: 'w', type: 'withdrawal', amount: 100, date: 'd1', expensePaymentId: 'P1' };
    await O.updateLedgerEntry({}, entry, { pays: [{ id: 'P1', expenseId: 'E1', amount: 100, date: 'd1', source: 'account' }], expenses: [{ id: 'E1', amount: 100 }], cash: [{ id: 'c1', expensePaymentId: 'P1' }], ledger: [entry] }, { date: 'd2', amount: 100, accountId: 'cb', note: 'x' });
    expect(ids(calls[0].ops)).toEqual(['expensePayments:P1', 'cashTransactions:c1', 'partnerCapitalTransactions:L3']); expect(calls[0].ops[0].data).toMatchObject({ date: 'd2', accountId: 'cb', note: 'x' });
  });
  it('تخصيص أرباح من تسوية لا يُعدَّل ولا يُحذف من هنا؛ والمبلغ لازم موجب', async () => {
    const e = { id: 'L4', type: 'profit_allocation', amount: 1, settlementId: 'S' };
    await expect(O.updateLedgerEntry({}, e, {}, { amount: 5 })).rejects.toThrow(/تسوية/); await expect(O.voidLedgerEntry({}, e, {}, 'x')).rejects.toThrow(/تسوية/);
    await expect(O.updateLedgerEntry({}, { id: 'L5', type: 'withdrawal' }, {}, { amount: 0 })).rejects.toThrow(/أكبر من صفر/);
  });
});
describe('حذف بند من كشف الشريك — يُلغى معه ما يرتبط به', () => {
  it('سحب: القيد + حركة الصندوق', async () => { await O.voidLedgerEntry({}, { id: 'L1', type: 'withdrawal' }, { cash: [{ id: 'c1', ledgerEntryId: 'L1' }] }, 'r'); expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L1', 'cashTransactions:c1']); });
  it('قرض: يُلغى القرض وحركته، ويُرفض لو له سدادات', async () => {
    const e = { id: 'L1', type: 'loan_given', loanId: 'LN' };
    await expect(O.voidLedgerEntry({}, e, { reps: [{ loanId: 'LN' }] }, 'r')).rejects.toThrow(/سدادات/);
    await O.voidLedgerEntry({}, e, { cash: [{ id: 'c1', loanId: 'LN', type: 'loan_received' }], reps: [] }, 'r'); expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L1', 'partnerLoans:LN', 'cashTransactions:c1']);
  });
  it('سداد أصل + فائدة: يُلغى السداد وحركة الصندوق وقيد الفائدة المرتبط به', async () => {
    const e = { id: 'L9', type: 'loan_principal_repayment', loanId: 'LN', amount: 300, date: 'd1' };
    await O.voidLedgerEntry({}, e, { reps: [{ id: 'r1', loanId: 'LN', date: 'd1', principalAmount: 300, interestAmount: 20 }], cash: [{ id: 'c1', loanId: 'LN', type: 'loan_repayment', date: 'd1', amount: 320 }], ledger: [e, { id: 'L10', type: 'interest_paid', loanId: 'LN', date: 'd1', amount: 20 }] }, 'r');
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L9', 'partnerLoanRepayments:r1', 'cashTransactions:c1', 'partnerCapitalTransactions:L10']);
  });
  it('ثمن حيوان: يُلغى القيد ويُفرَّغ مصدر الدفع من الحدث', async () => {
    await O.voidLedgerEntry({}, { id: 'L2', type: 'animal_purchase_paid', eventId: 'ev1' }, { events: [{ id: 'ev1' }] }, 'r');
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L2', 'animalEvents:ev1']); expect(calls[0].ops[1].data).toEqual({ paidFrom: null, payerPartnerId: null });
  });
  it('قيد أصله دفعة مصروف: تُلغى الدفعة بكل ما يتبعها', async () => {
    const e = { id: 'L3', type: 'withdrawal', expensePaymentId: 'P1' };
    await O.voidLedgerEntry({}, e, { pays: [{ id: 'P1' }], cash: [{ id: 'c1', expensePaymentId: 'P1' }], ledger: [e] }, 'r'); expect(ids(calls[0].ops)).toEqual(['expensePayments:P1', 'cashTransactions:c1', 'partnerCapitalTransactions:L3']);
  });
});
describe('تعديل دفعة مصروف بكل بياناتها', () => {
  const e = { id: 'E', amount: 1000 };
  it('دفع من الصندوق: التاريخ + المبلغ + الصندوق + الملاحظة', async () => {
    const p = { id: 'P', expenseId: 'E', amount: 500, date: 'd', source: 'account', accountId: 'a1' };
    await O.updateExpensePayment({}, e, [p], p, { cash: [{ id: 'c', expensePaymentId: 'P' }] }, { date: 'd2', amount: 600, accountId: 'a2', note: 'بيان' });
    expect(calls[0].ops[0].data).toEqual({ date: 'd2', amount: 600, accountId: 'a2', note: 'بيان' }); expect(calls[0].ops[1].data).toEqual({ date: 'd2', amount: 600, accountId: 'a2', description: 'بيان' });
  });
  it('دفع من شريك: تغيير الشريك يتبعه قيده في حسابه', async () => {
    const p = { id: 'P', expenseId: 'E', amount: 500, date: 'd', source: 'partner', partnerId: 'w' };
    await O.updateExpensePayment({}, e, [p], p, { ledger: [{ id: 'L', expensePaymentId: 'P' }] }, { date: 'd', amount: 500, partnerId: 'm' });
    expect(calls[0].ops[0].data.partnerId).toBe('m'); expect(calls[0].ops[1].data.partnerId).toBe('m');
  });
});
