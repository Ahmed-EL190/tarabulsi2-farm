import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls = []; let n = 0;
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => `${c}#${++n}`) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
beforeEach(() => { calls.length = 0; n = 0; });
const ids = (ops) => ops.map((o) => `${o.col}:${o.id || 'new'}`);

describe('سحب/سلفة شريك كمصروف يتقيّد فوراً حتى لو تُرك «غير مدفوع»', () => {
  const e = (extra = {}) => ({ id: 'E1', category: 'partner_withdrawal', amount: 500, currency: 'SYP', date: 'd', description: 'سحب', partnerAccountId: 'w', ...extra });
  it('payNow=no يتحوّل لدفع كامل من الصندوق + قيد في حساب الشريك', async () => {
    await O.addExpenseWithPayment({}, e(), { payNow: 'no', accountId: 'cb' });
    expect(calls[0].ops.map((o) => o.col)).toEqual(['expenses', 'expensePayments', 'cashTransactions', 'partnerCapitalTransactions']); expect(calls[0].ops[3].data).toMatchObject({ partnerId: 'w', type: 'withdrawal', amount: 500 });
  });
  it('بدون payNow أصلاً نفس النتيجة؛ وبلا صندوق رسالة واضحة', async () => {
    await O.addExpenseWithPayment({}, e(), { accountId: 'cb' }); expect(calls[0].ops.length).toBe(4);
    await expect(O.addExpenseWithPayment({}, e(), { payNow: 'no' })).rejects.toThrow(/اختر الصندوق/);
  });
  it('مصروف عادي غير مدفوع يبقى غير مدفوع (لا يتأثر)', async () => {
    await O.addExpenseWithPayment({}, { id: 'E', category: 'feed', amount: 5, currency: 'SYP', date: 'd' }, { payNow: 'no' }); expect(calls[0].ops.map((o) => o.col)).toEqual(['expenses']);
  });
});
describe('تعديل مصروف قائم (saveExpenseEdit)', () => {
  const pays = [{ id: 'P1', expenseId: 'E1', amount: 500, date: 'd', source: 'account' }];
  it('تحويل مصروف عادي إلى «سحب شريك» وتعيين الشريك: يُقيَّد أثر دفعاته الموجودة', async () => {
    const e = { id: 'E1', category: 'misc', amount: 500, currency: 'SYP', date: 'd', description: 'x' };
    await O.saveExpenseEdit({}, e, { category: 'partner_withdrawal', partnerAccountId: 'w', description: 'x', amount: 500, date: 'd' }, { pays, cash: [], ledger: [], loans: [], reps: [] });
    const all = calls.flatMap((c) => c.ops); expect(all.find((o) => o.col === 'expenses').data).toMatchObject({ category: 'partner_withdrawal', partnerAccountId: 'w' });
    expect(all.find((o) => o.col === 'partnerCapitalTransactions').data).toMatchObject({ partnerId: 'w', type: 'withdrawal', amount: 500, expenseId: 'E1', expensePaymentId: 'P1' });
  });
  it('فئة شريك بلا شريك ← خطأ', async () => { await expect(O.saveExpenseEdit({}, { id: 'E1', category: 'misc', amount: 1 }, { category: 'partner_advance' }, {})).rejects.toThrow(/اختر الشريك/); });
  it('تغيير الشريك ينقل القيود وسدادات القروض لحسابه الجديد', async () => {
    const e = { id: 'E1', category: 'loan_principal', amount: 300, partnerAccountId: 'w', date: 'd', currency: 'SYP' };
    await O.saveExpenseEdit({}, e, { category: 'loan_principal', partnerAccountId: 'm', amount: 300, date: 'd' }, { pays: [], cash: [], ledger: [{ id: 'L1', expenseId: 'E1', type: 'loan_principal_repayment' }, { id: 'L2', expenseId: 'OTHER', type: 'withdrawal' }], reps: [{ id: 'R1', expenseId: 'E1' }] });
    const moved = calls.flatMap((c) => c.ops).filter((o) => o.data?.partnerId === 'm'); expect(ids(moved)).toEqual(['partnerCapitalTransactions:L1', 'partnerLoanRepayments:R1']);
  });
  it('مصروف عادي بلا فئة شريك لا يلمس حسابات الشركاء', async () => {
    await O.saveExpenseEdit({}, { id: 'E1', category: 'feed', amount: 5, date: 'd' }, { category: 'feed', amount: 6, date: 'd' }, { pays: [], cash: [], ledger: [], reps: [] }); expect(calls.flatMap((c) => c.ops).map((o) => o.col)).toEqual(['expenses']);
  });
});
describe('تصحيحات مباشرة من فحص السلامة', () => {
  it('updateCashMovement: حركة بلا أصل تُعدَّل مباشرة (تاريخ/مبلغ/صندوق/بيان) وترفض مبلغاً غير موجب', async () => {
    await O.updateCashMovement({}, { id: 'c1', type: 'other_income', amount: 0, date: 'd', accountId: 'a' }, { date: 'd2', amount: 50, accountId: 'b', description: 'x' }, {});
    expect(calls[0].ops[0]).toMatchObject({ col: 'cashTransactions', id: 'c1', data: { date: 'd2', amount: 50, accountId: 'b', description: 'x' } });
    await expect(O.updateCashMovement({}, { id: 'c1' }, { date: 'd', amount: 0 }, {})).rejects.toThrow(/أكبر من صفر/);
  });
  it('updateCashMovement: حركة أصلها دفعة مصروف تتزامن عبر الدفعة', async () => {
    const t = { id: 'c1', expensePaymentId: 'P1', expenseId: 'E1' };
    await O.updateCashMovement({}, t, { date: 'd2', amount: 100, accountId: 'b' }, { expPays: [{ id: 'P1', expenseId: 'E1', amount: 90, date: 'd', source: 'account' }], expenses: [{ id: 'E1', amount: 500 }], cash: [t], ledger: [], reps: [] });
    expect(ids(calls[0].ops)).toEqual(['expensePayments:P1', 'cashTransactions:c1']);
  });
  it('postAnimalSaleCash ينشئ حركة بيع واردة للصندوق', async () => {
    await O.postAnimalSaleCash({}, { animalId: 'A', tag: 'T', value: 900, currency: 'SYP', date: 'd' }, { accountId: 'cb' });
    expect(calls[0].ops[0].data).toMatchObject({ type: 'animal_sale', direction: 'in', amount: 900, accountId: 'cb', animalId: 'A' }); await expect(O.postAnimalSaleCash({}, { value: 1 }, {})).rejects.toThrow(/اختر الصندوق/);
  });
  it('setPurchaseSource: من الصندوق (حركة خارجة + علامة) أو على شريك (قيد في حسابه)', async () => {
    const ev = { id: 'EV', type: 'purchase', animalId: 'A', tag: 'T', value: 700, currency: 'SYP', date: 'd' };
    await O.setPurchaseSource({}, ev, { id: 'A', tag: 'T' }, { from: 'account', accountId: 'cb' });
    expect(calls[0].ops.map((o) => o.col)).toEqual(['cashTransactions', 'animalEvents']); expect(calls[0].ops[0].data).toMatchObject({ type: 'animal_purchase', direction: 'out', amount: 700 });
    calls.length = 0; await O.setPurchaseSource({}, ev, { id: 'A', tag: 'T' }, { from: 'partner', partnerId: 'w', ctx: { cash: [], ledger: [] } });
    expect(calls[0].ops.some((o) => o.data?.type === 'animal_purchase_paid' && o.data.partnerId === 'w')).toBe(true);
    await expect(O.setPurchaseSource({}, ev, { id: 'A' }, { from: 'partner' })).rejects.toThrow(/اختر الشريك/);
  });
});
