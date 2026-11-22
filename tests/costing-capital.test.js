import { describe, it, expect } from 'vitest';
import { profitAndLoss, animalPLInputs, animalResultInfo, capitalOf, stockCosting, allocateProfitByThirds } from '../src/lib/finance.js';

describe('نفوق الحيوان يدخل الأرباح', () => {
  const animals = [{ id: 'a', acquisitionCost: 5000, currency: 'SYP' }, { id: 'b' }, { id: 'c', acquisitionCost: 100, voided: true }];
  const ev = [{ animalId: 'a', type: 'death', date: '2026-03-01' }, { animalId: 'b', type: 'death', date: '2026-03-02' }, { animalId: 'c', type: 'death', date: '2026-03-03' }, { animalId: 'a', type: 'death', date: '2026-03-04', voided: true }];
  it('خسارة بسعر الشراء فقط لمن له سعر، دون المولود والملغى', () => {
    const ap = animalPLInputs(ev, animals); expect(ap.deathLosses).toEqual([{ date: '2026-03-01', currency: 'SYP', amount: -5000 }]);
    const pl = profitAndLoss({ ...ap, from: '2026-01-01', to: '2026-12-31' }); expect(pl.deathLoss).toBe(-5000); expect(pl.netProfit).toBe(-5000);
  });
  it('بيانات الحيوان النافق: نتيجة سالبة بسعر شرائه', () => { expect(animalResultInfo(animals[0], ev)).toMatchObject({ kind: 'death', result: -5000 }); });
  it('الخسارة تتقاسمها الأثلاث على الجميع', () => {
    const P = [{ id: 'w', ownershipPct: 50, profitSharePct: 0 }, { id: 'a', ownershipPct: 50, profitSharePct: 0 }, { id: 'g', ownershipPct: 0, profitSharePct: 50 }, { id: 's', ownershipPct: 0, profitSharePct: 50 }];
    const r = allocateProfitByThirds(-900, P, { w: 6000, a: 4000 }); expect(r.allocations.find((x) => x.partnerId === 'g').amount).toBe(-150); expect(r.allocations.find((x) => x.partnerId === 'w').amount).toBe(-360);
  });
});

describe('رأس المال مرجَّح بالأيام', () => {
  const led = [{ partnerId: 'w', type: 'animal_purchase_paid', amount: 1000, date: '2026-01-01', currency: 'SYP' }, { partnerId: 'a', type: 'animal_purchase_paid', amount: 1000, date: '2026-01-30', currency: 'SYP' }];
  it('من دخل آخر الفترة يأخذ وزناً صغيراً', () => {
    const o = { from: '2026-01-01', to: '2026-01-30' };
    expect(capitalOf('w', { ledger: led }, o).total).toBe(1000); expect(capitalOf('a', { ledger: led }, o).total).toBeCloseTo(1000 / 30, 1);
  });
  it('قيد قبل الفترة وزنه كامل، وبعد نهايتها لا يُحسب', () => {
    expect(capitalOf('w', { ledger: led }, { from: '2026-02-01', to: '2026-02-28' }).total).toBe(1000);
    expect(capitalOf('a', { ledger: led }, { from: '2026-01-01', to: '2026-01-15' }).total).toBe(0);
  });
});

describe('العلف يُحسب عند الاستهلاك', () => {
  const exps = [{ id: 'E1', amount: 1000, currency: 'SYP', category: 'feed', date: '2026-01-01' }, { id: 'E2', amount: 2400, currency: 'SYP', category: 'feed', date: '2026-02-01' }];
  const mv = [{ itemId: 'I', type: 'in', qty: 100, date: '2026-01-01', expenseId: 'E1' }, { itemId: 'I', type: 'out', qty: 50, date: '2026-01-10' },
    { itemId: 'I', type: 'in', qty: 50, date: '2026-02-01', expenseId: 'E2' }, { itemId: 'I', type: 'out', qty: 60, date: '2026-02-10' }];
  it('متوسط مرجّح: 50×10 = 500 ثم (500+2400)/100×60 = 1740', () => {
    const r = stockCosting(exps, mv); expect([...r.linked].sort()).toEqual(['E1', 'E2']);
    expect(r.consumption.map((x) => x.amount)).toEqual([500, 1740]); expect(r.valuation.I.qty).toBe(40); expect(r.valuation.I.cost.SYP).toBe(1160);
  });
  it('الأرباح: المشتريات المرتبطة خارج المصروف، والمستهلك داخل', () => {
    const r = stockCosting(exps, mv);
    const pl = profitAndLoss({ expenses: exps.filter((e) => !r.linked.has(e.id)), stockConsumption: r.consumption, from: '2026-01-01', to: '2026-01-31' });
    expect(pl.stockConsumption).toBe(500); expect(pl.totalExpenses).toBe(500); expect(pl.netProfit).toBe(-500);
  });
  it('صادر أكبر من الرصيد لا يُنتج تكلفة سالبة، والملغى يُتجاهل', () => {
    const r = stockCosting(exps, [...mv, { itemId: 'I', type: 'out', qty: 999, date: '2026-03-01' }, { itemId: 'I', type: 'out', qty: 5, date: '2026-03-02', voided: true }]);
    expect(r.valuation.I.qty).toBe(0); expect(r.consumption.every((x) => x.amount > 0)).toBe(true);
  });
});
