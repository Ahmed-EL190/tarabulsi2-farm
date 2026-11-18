import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls = []; let n = 0;
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => `${c}#${++n}`) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
beforeEach(() => { calls.length = 0; n = 0; });
const exp = (x = {}) => ({ category: 'feed', amount: 1000, currency: 'SYP', date: '2026-05-01', description: 'علف أبقار', ...x });

describe('شراء علف ← زيادة المخزون تلقائياً', () => {
  it('مصروف مع صنف وكمية ← حركة وارد مرتبطة بالمصروف في نفس الدفعة', async () => {
    await O.addExpenseWithPayment({}, exp({ stockItemId: 'I1', stockQty: 500 }), { payNow: 'no', stockItemName: 'علف مركّز' });
    const ops = calls[0].ops; expect(ops.map((o) => o.col)).toEqual(['expenses', 'stockMovements']);
    expect(ops[1].data).toMatchObject({ itemId: 'I1', itemName: 'علف مركّز', type: 'in', qty: 500, expenseId: 'expenses#1', date: '2026-05-01' });
  });
  it('بدون صنف: لا حركة مخزون. صنف بلا كمية (أو العكس): خطأ', async () => {
    await O.addExpenseWithPayment({}, exp(), { payNow: 'no' }); expect(calls[0].ops.map((o) => o.col)).toEqual(['expenses']);
    await expect(O.addExpenseWithPayment({}, exp({ stockItemId: 'I1' }), {})).rejects.toThrow(/الكمية/);
    await expect(O.addExpenseWithPayment({}, exp({ stockQty: 5 }), {})).rejects.toThrow(/صنف/);
  });
  it('إلغاء المصروف يلغي الكمية المضافة', async () => {
    await O.voidExpenseCascade({}, { id: 'E1' }, { stock: [{ id: 'M1', expenseId: 'E1' }, { id: 'M2', expenseId: 'E2' }, { id: 'M3', expenseId: 'E1', voided: true }] }, 'x');
    const v = calls[0].ops.filter((o) => o.col === 'stockMovements'); expect(v.map((o) => o.id)).toEqual(['M1']);
  });
  it('تعديل: تغيير الكمية يحدّث الحركة، وإفراغ الصنف يلغيها، وإضافة صنف لمصروف قديم تنشئ حركة', async () => {
    const e = { id: 'E1', category: 'feed', amount: 1000, date: '2026-05-01', description: 'علف', stockItemId: 'I1', stockQty: 500 };
    const stock = [{ id: 'M1', expenseId: 'E1', itemId: 'I1', qty: 500 }];
    await O.saveExpenseEdit({}, e, { stockItemId: 'I1', stockQty: 800 }, { stock, stockNames: { I1: 'علف' } });
    expect(calls.at(-1).ops[0]).toMatchObject({ col: 'stockMovements', id: 'M1', data: { qty: 800, itemId: 'I1' } });
    await O.saveExpenseEdit({}, e, { stockItemId: '' }, { stock });
    expect(calls.at(-1).ops[0]).toMatchObject({ col: 'stockMovements', id: 'M1', action: 'void' });
    await O.saveExpenseEdit({}, { id: 'E2', category: 'feed', amount: 5, date: 'd' }, { stockItemId: 'I2', stockQty: 20 }, { stock: [], stockNames: { I2: 'تبن' } });
    expect(calls.at(-1).ops[0]).toMatchObject({ col: 'stockMovements', data: { itemId: 'I2', qty: 20, type: 'in', expenseId: 'E2' } });
  });
});
