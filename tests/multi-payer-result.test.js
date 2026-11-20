import { describe, it, expect, vi, beforeEach } from 'vitest';
const calls = []; let n = 0;
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => `${c}#${++n}`) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
const F = await import('../src/lib/finance.js');
beforeEach(() => { calls.length = 0; n = 0; });

describe('شراء حيوان اشتراه أكثر من شريك', () => {
  const base = { from: 'partners', cost: 1000, date: '2026-05-01', currency: 'SYP', tag: 'C1', animalId: 'A' };
  it('قيد لكل شريك بمبلغه، والمجموع = السعر', () => {
    const r = O.animalPurchasePayment({ ...base, splits: [{ partnerId: 'w', amount: 600 }, { partnerId: 'a', amount: 400 }] });
    expect(r.ledger.map((l) => [l.partnerId, l.amount, l.type])).toEqual([['w', 600, 'animal_purchase_paid'], ['a', 400, 'animal_purchase_paid']]);
    expect(r.cash).toBeNull(); expect(r.extra.paidFrom).toBe('partner');
  });
  it('أخطاء: مجموع لا يساوي السعر / شريك واحد / شريك مكرر', () => {
    expect(() => O.animalPurchasePayment({ ...base, splits: [{ partnerId: 'w', amount: 600 }, { partnerId: 'a', amount: 300 }] })).toThrow(/لا يساوي/);
    expect(() => O.animalPurchasePayment({ ...base, splits: [{ partnerId: 'w', amount: 1000 }] })).toThrow(/شريكين/);
    expect(() => O.animalPurchasePayment({ ...base, splits: [{ partnerId: 'w', amount: 500 }, { partnerId: 'w', amount: 500 }] })).toThrow(/مكرر/);
  });
  it('الصغير يأخذ نفس نسب الأم (proportional) ومجموعه مطابق', () => {
    const r = O.animalPurchasePayment({ ...base, cost: 100, proportional: true, splits: [{ partnerId: 'w', amount: 600 }, { partnerId: 'a', amount: 400 }] });
    expect(r.ledger.map((l) => l.amount)).toEqual([60, 40]);
  });
  it('recordAnimalEvent يكتب كل القيود بنفس eventId، والإلغاء يلغيها كلها', async () => {
    const r = O.animalPurchasePayment({ ...base, splits: [{ partnerId: 'w', amount: 600 }, { partnerId: 'a', amount: 400 }] });
    await O.recordAnimalEvent({}, { animalId: 'A', type: 'purchase', value: 1000 }, r.cash, r.ledger);
    const ops = calls[0].ops; const led = ops.filter((o) => o.col === 'partnerCapitalTransactions'); expect(led).toHaveLength(2); expect(led.every((o) => o.data.eventId === 'animalEvents#1')).toBe(true);
    await O.voidAnimalEventCascade({}, { id: 'EV', animalId: 'A', type: 'purchase', date: '2026-05-01', value: 1000 }, { ledger: [{ id: 'L1', type: 'animal_purchase_paid', eventId: 'EV' }, { id: 'L2', type: 'animal_purchase_paid', eventId: 'EV' }, { id: 'L3', type: 'animal_purchase_paid', eventId: 'OTHER' }] }, 'x');
    expect(calls[1].ops.filter((o) => o.col === 'partnerCapitalTransactions').map((o) => o.id)).toEqual(['L1', 'L2']);
  });
  it('purchaseSource يُظهر كل الشركاء، وتدخل المبالغ في رأس مال كل واحد', () => {
    const ev = [{ id: 'EV', animalId: 'A', type: 'purchase', value: 1000, date: '2026-05-01' }];
    const ledger = [{ id: 'L1', type: 'animal_purchase_paid', partnerId: 'w', amount: 600, eventId: 'EV', animalId: 'A', date: '2026-05-01', currency: 'SYP' }, { id: 'L2', type: 'animal_purchase_paid', partnerId: 'a', amount: 400, eventId: 'EV', animalId: 'A', date: '2026-05-01', currency: 'SYP' }];
    const s = F.purchaseSource({ id: 'A', tag: 'C1' }, { events: ev, ledger }); expect(s.multi).toBe(true); expect(s.partners).toEqual([{ partnerId: 'w', amount: 600 }, { partnerId: 'a', amount: 400 }]);
    expect(F.partnerInvestment('w', { ledger }).cows).toBe(600); expect(F.partnerInvestment('a', { ledger }).cows).toBe(400);
  });
});

describe('نتيجة التبادل: خسارة/ربح على المزرعة أو الشركاء', () => {
  const partners = [{ id: 'w', name: 'و', ownershipPct: 50, profitSharePct: 0 }, { id: 'a', name: 'ع', ownershipPct: 50, profitSharePct: 0 }, { id: 'g', name: 'غ', ownershipPct: 0, profitSharePct: 100 }];
  const led = [{ partnerId: 'w', type: 'animal_purchase_paid', amount: 6000, date: '2026-01-01', currency: 'SYP' }, { partnerId: 'a', type: 'animal_purchase_paid', amount: 4000, date: '2026-01-01', currency: 'SYP' }];
  it('على الشركاء: تُقسَّم على الملاك بنسبة رأس المال (60/40) ولا تمسّ شريك الربح فقط', () => {
    const r = F.splitAmongOwners(-1000, partners, { ledger: led }, { to: '2026-02-01' });
    expect(r).toEqual([{ partnerId: 'w', amount: -600 }, { partnerId: 'a', amount: -400 }]);
    expect(F.splitAmongOwners(333.33, partners, { ledger: led }).reduce((t, x) => t + x.amount, 0)).toBeCloseTo(333.33, 2);
  });
  it('على المزرعة: تدخل صافي الربح (خسارة سالبة / ربح موجب) ويُتجاهل ما على الشركاء والملغى', () => {
    const ev = [{ animalId: 'x', type: 'exchange_out', date: '2026-03-01', currency: 'SYP', value: 900, result: -100, resultBearer: 'farm' }, { animalId: 'y', type: 'exchange_out', date: '2026-03-02', currency: 'SYP', value: 1200, result: 200, resultBearer: 'farm' },
      { animalId: 'z', type: 'exchange_out', date: '2026-03-03', currency: 'SYP', value: 500, result: -300, resultBearer: 'partners' }, { animalId: 'v', type: 'exchange_out', date: '2026-03-04', currency: 'SYP', result: -999, resultBearer: 'farm', voided: true }];
    const ap = F.animalPLInputs(ev, []); expect(ap.exchangeResults.map((x) => x.amount)).toEqual([-100, 200]);
    const pl = F.profitAndLoss({ ...ap, from: '2026-01-01', to: '2026-12-31', expenses: [{ id: 'e', date: '2026-03-05', category: 'feed', amount: 50, currency: 'SYP' }] });
    expect(pl.exchangeResult).toBe(100); expect(pl.netProfit).toBe(50);
  });
  it('خسارة الشريك تنقص ما تستحقه له المزرعة، وربحه يزيده', () => {
    const d = F.partnerDebt('w', [{ partnerId: 'w', type: 'additional_capital', amount: 1000, currency: 'SYP' }, { partnerId: 'w', type: 'animal_loss_charge', amount: 600, currency: 'SYP' }, { partnerId: 'w', type: 'animal_gain_credit', amount: 100, currency: 'SYP' }]);
    expect(d.other).toBe(500); expect(F.partnerLedger('w', [{ partnerId: 'w', type: 'animal_loss_charge', amount: 600, date: 'd', currency: 'SYP' }]).closing).toBe(-600);
  });
  it('animalResultInfo: بيع وتبادل وبلا سعر شراء', () => {
    const a = { id: 'a', acquisitionCost: 1000, currency: 'SYP' };
    expect(F.animalResultInfo(a, [{ animalId: 'a', type: 'sale', value: 1300 }])).toMatchObject({ kind: 'sale', result: 300 });
    expect(F.animalResultInfo(a, [{ animalId: 'a', type: 'exchange_out', value: 700, result: -300, resultBearer: 'partners' }])).toMatchObject({ kind: 'exchange', result: -300, bearer: 'partners', partnerIds: [] });
    expect(F.animalResultInfo({ id: 'b' }, [{ animalId: 'b', type: 'sale', value: 5 }])).toBeNull();
  });
});

describe('الفرق المستلَم يعود لدافع ثمن الحيوان الخارج', () => {
  const ev = (id, payer) => [{ id: `E${id}`, animalId: id, type: 'purchase', value: 1000, date: '2026-01-01' }];
  const led = (id, pid, amt, evId) => ({ id: `L${id}${pid}`, type: 'animal_purchase_paid', partnerId: pid, amount: amt, eventId: evId, animalId: id, date: '2026-01-01', currency: 'SYP' });
  it('بقرة دفعها أبو وليد: كل الفرق له', () => {
    const r = F.splitReceivedDiff(500, [{ animal: { id: 'A', tag: 'A' }, weight: 1000 }], { events: ev('A'), ledger: [led('A', 'w', 1000, 'EA')] });
    expect(r).toEqual({ partners: [{ partnerId: 'w', amount: 500 }], farm: 0 });
  });
  it('بقرتان بدافعين مختلفين: بنسبة سعر كل بقرة؛ وبقرة من الصندوق: حصتها للصندوق', () => {
    const events = [...ev('A'), ...ev('B'), ...ev('C')]; const ledger = [led('A', 'w', 1000, 'EA'), led('B', 'a', 1000, 'EB')];
    const r = F.splitReceivedDiff(900, [{ animal: { id: 'A', tag: 'A' }, weight: 2000 }, { animal: { id: 'B', tag: 'B' }, weight: 1000 }, { animal: { id: 'C', tag: 'C' }, weight: 1000 }], { events, ledger });
    expect(r.partners).toEqual([{ partnerId: 'w', amount: 450 }, { partnerId: 'a', amount: 225 }]); expect(r.farm).toBe(225);
  });
  it('بقرة اشتراها شريكان معاً: يتقاسمان بنسبة ما دفع كل واحد', () => {
    const r = F.splitReceivedDiff(1000, [{ animal: { id: 'A', tag: 'A' }, weight: 1000 }], { events: ev('A'), ledger: [led('A', 'w', 600, 'EA'), led('A', 'a', 400, 'EA')] });
    expect(r.partners).toEqual([{ partnerId: 'w', amount: 600 }, { partnerId: 'a', amount: 400 }]);
  });
  it('بلا دافع مسجَّل: كله للصندوق. ويُظهر كارت الوارد إلى من ذهب الفرق', () => {
    expect(F.splitReceivedDiff(100, [{ animal: { id: 'Z', tag: 'Z' }, weight: 5 }], { events: [], ledger: [] })).toEqual({ partners: [], farm: 100 });
    const info = F.animalExchangeInfo({ id: 'N' }, { events: [{ type: 'exchange_out', animalId: 'a', tag: 'a', value: 1500, exchangeId: 'X' }, { type: 'exchange_in', animalId: 'N', value: 1000, exchangeId: 'X', date: 'd' }], ledger: [{ type: 'animal_purchase_repaid', exchangeId: 'X', partnerId: 'w', amount: 500 }] });
    expect(info).toMatchObject({ diff: -500, paidBy: 'partner', partnerId: 'w', partners: [{ partnerId: 'w', amount: 500 }] });
  });
});

describe('الخسارة تتقسم على الجميع (بيع وتبادل)', () => {
  it('بيع بخسارة: تدخل صافي الأرباح بالسالب؛ والمولود بلا سعر شراء بسعره كاملاً', () => {
    const animals = [{ id: 'a', acquisitionCost: 5000 }, { id: 'b' }];
    const ev = [{ animalId: 'a', type: 'sale', date: '2026-02-01', value: 4000, currency: 'SYP' }, { animalId: 'b', type: 'sale', date: '2026-02-02', value: 700, currency: 'SYP' }];
    const ap = F.animalPLInputs(ev, animals); expect(ap.animalSales.map((x) => x.amount)).toEqual([-1000, 700]);
    expect(F.profitAndLoss({ ...ap, from: '2026-01-01', to: '2026-12-31' }).netProfit).toBe(-300);
  });
  it('التبادل القديم بلا «على من» يُعامَل على المزرعة (الجميع)، وما على شريك محدد يبقى عليه', () => {
    const ev = [{ animalId: 'x', type: 'exchange_out', date: '2026-03-01', result: -100 }, { animalId: 'y', type: 'exchange_out', date: '2026-03-01', result: -50, resultBearer: 'partners' }];
    expect(F.animalPLInputs(ev, []).exchangeResults.map((x) => x.amount)).toEqual([-100]);
  });
  it('فرق التبادل بشريكين: كلاهما يظهر في بيانات الحيوان الوارد', () => {
    const info = F.animalExchangeInfo({ id: 'N' }, { events: [{ type: 'exchange_out', animalId: 'a', tag: 'a', value: 1000, exchangeId: 'X' }, { type: 'exchange_in', animalId: 'N', value: 1500, exchangeId: 'X', date: 'd' }],
      ledger: [{ type: 'animal_purchase_paid', exchangeId: 'X', partnerId: 'w', amount: 300 }, { type: 'animal_purchase_paid', exchangeId: 'X', partnerId: 'a', amount: 200 }] });
    expect(info).toMatchObject({ diff: 500, paidBy: 'partner', partners: [{ partnerId: 'w', amount: 300 }, { partnerId: 'a', amount: 200 }] });
  });
});
