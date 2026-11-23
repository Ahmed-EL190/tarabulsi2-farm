import { describe, it, expect } from 'vitest';
import { stockCosting, calfCost } from '../src/lib/finance.js';

const exp = [{ id: 'E1', amount: 1000, currency: 'SYP' }];
const mv = [
  { id: 'M1', itemId: 'I1', date: '2026-05-01', type: 'in', qty: 100, expenseId: 'E1' },
  { id: 'M2', itemId: 'I1', date: '2026-05-10', type: 'out', qty: 20, calfLogId: 'L1' },
  { id: 'M3', itemId: 'I1', date: '2026-05-11', type: 'out', qty: 30, calfLogId: 'L2' },
];
const logs = [
  { id: 'L1', calfId: 'c1', date: '2026-05-10', type: 'feed', qty: 20, stockItemId: 'I1' },
  { id: 'L2', calfId: 'c2', date: '2026-05-11', type: 'feed', qty: 30, stockItemId: 'I1' },
  { id: 'L3', calfId: 'c1', date: '2026-05-12', type: 'other', qty: 1, item: 'لقاح', cost: 150, currency: 'SYP' },
  { id: 'L4', calfId: 'c1', date: '2026-05-13', type: 'feed', qty: 5, item: 'تبن', cost: 40, currency: 'SYP' },
  { id: 'L5', calfId: 'c1', date: '2026-05-14', type: 'other', qty: 1, item: 'مكمّل', cost: 2, currency: 'USD' },
  { id: 'L6', calfId: 'c1', date: '2026-05-15', type: 'other', qty: 1, item: 'ملغى', cost: 999, currency: 'SYP', voided: true },
];

describe('تكلفة العجل', () => {
  const { consumption } = stockCosting(exp, mv);
  it('علف المخزون بالمتوسط المرجّح + دواء + علف خارج المخزون، كل عملة لوحدها', () => {
    const c = calfCost('c1', logs, consumption);
    expect(c.feed).toEqual({ SYP: 240 });       // 200 مخزون (20 كغ × 10) + 40 تبن
    expect(c.other).toEqual({ SYP: 150, USD: 2 });
    expect(c.total).toEqual({ SYP: 390, USD: 2 });
  });
  it('كل عجل بتكلفته فقط، والسجل الملغى لا يُحسب', () => {
    expect(calfCost('c2', logs, consumption).total).toEqual({ SYP: 300 }); // 30 كغ × 10
  });
  it('الفترة تحدد ما يُحسب', () => {
    expect(calfCost('c1', logs, consumption, { from: '2026-05-12', to: '2026-05-13' }).total).toEqual({ SYP: 190 });
  });
});
