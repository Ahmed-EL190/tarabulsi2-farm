import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls = []; let n = 0;
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => `${c}#${++n}`) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js'); const F = await import('../src/lib/finance.js');
beforeEach(() => { calls.length = 0; n = 0; });
const log = (x = {}) => ({ calfId: 'c1', tag: 'C1', date: '2026-05-01', type: 'feed', qty: 20, unit: 'كغ', item: 'مركّز', stockItemId: 'I1', ...x });

describe('علف التسمين يخصم من المخزون تلقائياً', () => {
  it('سجل علف مرتبط بصنف ← حركة صادر بنفس الكمية والتاريخ', async () => {
    await O.saveCalfLog({}, log(), { itemName: 'علف مركّز' });
    const [lg, mv] = calls[0].ops; expect(lg).toMatchObject({ col: 'calfLogs', id: 'calfLogs#1', data: { stockItemId: 'I1', stockItemName: 'علف مركّز' } });
    expect(mv).toMatchObject({ col: 'stockMovements', data: { itemId: 'I1', type: 'out', qty: 20, date: '2026-05-01', calfLogId: 'calfLogs#1' } });
  });
  it('بلا صنف أو نوع غير علف: لا حركة مخزون', async () => {
    await O.saveCalfLog({}, log({ stockItemId: '' }), {}); expect(calls[0].ops.map((o) => o.col)).toEqual(['calfLogs']);
    await O.saveCalfLog({}, log({ type: 'milk', stockItemId: 'I1' }), {}); expect(calls[1].ops.map((o) => o.col)).toEqual(['calfLogs']);
  });
  it('تعديل الكمية يحدّث الحركة نفسها، وفكّ الصنف يلغيها، وربط سجل قديم ينشئ حركة', async () => {
    const stock = [{ id: 'M1', calfLogId: 'L1', itemId: 'I1', qty: 20 }];
    await O.saveCalfLog({}, log({ qty: 35 }), { existing: { id: 'L1' }, stock, itemName: 'علف' });
    expect(calls[0].ops[1]).toMatchObject({ col: 'stockMovements', id: 'M1', data: { qty: 35, type: 'out' } });
    await O.saveCalfLog({}, log({ stockItemId: '' }), { existing: { id: 'L1' }, stock });
    expect(calls[1].ops[1]).toMatchObject({ id: 'M1', action: 'void' });
    await O.saveCalfLog({}, log(), { existing: { id: 'L2' }, stock, itemName: 'علف' });
    expect(calls[2].ops[1]).toMatchObject({ col: 'stockMovements', data: { calfLogId: 'L2' } }); expect(calls[2].ops[1].id).toBeUndefined();
  });
  it('إلغاء السجل يرجّع الكمية للمخزون (يلغي حركة الصادر)', async () => {
    await O.voidCalfLog({}, { id: 'L1' }, { stock: [{ id: 'M1', calfLogId: 'L1' }, { id: 'M2', calfLogId: 'L9' }, { id: 'M3', calfLogId: 'L1', voided: true }] }, 'x');
    expect(calls[0].ops.map((o) => `${o.col}:${o.id}`)).toEqual(['calfLogs:L1', 'stockMovements:M1']);
  });
  it('كمية علف بوحدة «كيس» لا تُجمع مع الكيلوغرامات، وتظهر باسمها', () => {
    const logs = [{ calfId: 'c', date: '2026-05-01', type: 'feed', qty: 10, unit: 'كغ', item: 'تبن' }, { calfId: 'c', date: '2026-05-02', type: 'feed', qty: 2, unit: 'كيس', item: 'مركّز' }];
    const r = F.calfFattening('c', logs); expect(r.feed).toBe(10); expect(r.feedByItem).toEqual({ 'تبن': 10, 'مركّز (كيس)': 2 });
  });
  it('الصادر يدخل تكلفة الأرباح بالمتوسط المرجّح', () => {
    const exps = [{ id: 'E1', amount: 1000, currency: 'SYP', date: '2026-05-01' }];
    const mv = [{ itemId: 'I1', type: 'in', qty: 100, date: '2026-05-01', expenseId: 'E1' }, { itemId: 'I1', type: 'out', qty: 20, date: '2026-05-02', calfLogId: 'L1' }];
    expect(F.stockCosting(exps, mv).consumption.map((x) => x.amount)).toEqual([200]);
  });
});
