import { describe, it, expect } from 'vitest';
import { animalPLInputs, herdState, profitAndLoss, todayISO } from '../src/lib/finance.js';

describe('animalPLInputs', () => {
  const animals = [{ id: 'a1', acquisitionCost: 1000 }, { id: 'a2', acquisitionCost: 500, viaExchange: true }, { id: 'a3', acquisitionCost: 700 }, { id: 'v', voided: true }];
  const ev = [
    { animalId: 'a1', type: 'purchase', date: '2026-01-01', value: 1000, currency: 'SYP' },
    { animalId: 'a1', type: 'sale', date: '2026-02-01', value: 1500, costBasis: 1000, currency: 'SYP' },
    { animalId: 'a3', type: 'exchange_out', date: '2026-03-01', value: 800, currency: 'SYP' },
    { animalId: 'a2', type: 'exchange_in', date: '2026-03-01', value: 900, currency: 'SYP' },
    { animalId: 'a1', type: 'exchange_in', date: '2026-03-02', value: 400, currency: 'SYP' }, // مسجّل سابقاً: لا يُحسب شراء
    { animalId: 'v', type: 'purchase', date: '2026-03-01', value: 9999, currency: 'SYP' }, // حيوان ملغى
    { animalId: 'a1', type: 'purchase', date: '2026-03-01', value: 50, currency: 'SYP', voided: true },
  ];
  it('expense mode: sales full price, purchases + new exchange_in', () => {
    const r = animalPLInputs(ev, animals, true);
    expect(r.animalSales.map((x) => x.amount)).toEqual([1500, 800]);
    expect(r.animalPurchases.map((x) => x.amount)).toEqual([1000, 900]);
  });
  it('capitalised mode: only gain/loss on sale, no purchases', () => {
    const r = animalPLInputs(ev, animals, false);
    expect(r.animalSales.map((x) => x.amount)).toEqual([500, 100]);
    expect(r.animalPurchases).toEqual([]);
  });
  it('exchange affects profit by -(cash diff) in expense mode', () => {
    const r = animalPLInputs(ev.filter((e) => ['a3', 'a2'].includes(e.animalId)), animals, true);
    const pl = profitAndLoss({ ...r, from: '2026-01-01', to: '2026-12-31' });
    expect(pl.netProfit).toBe(800 - 900);
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
