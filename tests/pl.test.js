import { describe, it, expect } from 'vitest';
import { animalPLInputs, herdState, profitAndLoss, todayISO } from '../src/lib/finance.js';

describe('animalPLInputs (سياسة الأرباح الجديدة)', () => {
  const animals = [{ id: 'a1', acquisitionCost: 1000 }, { id: 'a3', acquisitionCost: 700 }, { id: 'v', voided: true }];
  const ev = [
    { animalId: 'a1', type: 'purchase', date: '2026-01-01', value: 1000, currency: 'SYP' },
    { animalId: 'a1', type: 'sale', date: '2026-02-01', value: 1500, costBasis: 1000, currency: 'SYP' },
    { animalId: 'a3', type: 'exchange_out', date: '2026-03-01', value: 800, currency: 'SYP' },
    { animalId: 'a3', type: 'exchange_in', date: '2026-03-01', value: 900, currency: 'SYP' },
    { animalId: 'v', type: 'sale', date: '2026-03-01', value: 9999, currency: 'SYP' },
    { animalId: 'a1', type: 'sale', date: '2026-03-01', value: 50, currency: 'SYP', voided: true },
  ];
  it('الشراء لا يدخل أبداً، والبيع يدخل بسعر البيع كاملاً، والتبادل خارج الأرباح، والملغي مُتجاهَل', () => {
    const r = animalPLInputs(ev, animals);
    expect(r.animalPurchases).toEqual([]); expect(r.animalSales.map((x) => x.amount)).toEqual([1500]);
  });
  it('صافي الربح = كل المبيعات − كل المصروفات التشغيلية (بدون شراء الحيوانات)', () => {
    const r = animalPLInputs(ev, animals);
    const pl = profitAndLoss({ ...r, expenses: [{ id: 'e', date: '2026-02-02', category: 'feed', amount: 300, currency: 'SYP' }], from: '2026-01-01', to: '2026-12-31' });
    expect(pl.animalSales).toBe(1500); expect(pl.animalPurchases).toBe(0); expect(pl.netProfit).toBe(1200);
  });
});
describe('herdState', () => {
  it('same-day purchase then sale -> not active', () => {
    const s = herdState([{ animalId: 'x', type: 'sale', date: '2026-01-01' }, { animalId: 'x', type: 'purchase', date: '2026-01-01' }]);
    expect(s.x.active).toBe(false);
  });
  it('voided animals are excluded when animals list is passed', () => {
    const s = herdState([{ animalId: 'x', type: 'purchase', date: '2026-01-01' }], [{ id: 'x', voided: true }]);
    expect(s.x).toBeUndefined();
  });
});
describe('todayISO', () => { it('is yyyy-mm-dd', () => { expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/); }); });
