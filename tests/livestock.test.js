import { describe, it, expect, vi, beforeEach } from 'vitest';
import { netCustomerBalance, customerStatement, customerPosition, herdValue, purchaseSource, todayISO } from '../src/lib/finance.js';
const calls = [];
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => 'ID-' + c) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
beforeEach(() => { calls.length = 0; });

describe('ذمم العملاء في التسويات = كشف حساب العميل (الحالة: 58,900 بدل 55,900)', () => {
  // اتفاقية على 1000 لتر × 100 = 100,000 قيمة؛ العميل له دفعة مقدمة 3,000 على اتفاقية أخرى لم يُسلَّم منها شيء
  const ag = (extra = {}) => ({ id: 'A1', customerId: 'C1', agreedQty: 1000, pricePerLiter: 100, currency: 'SYP', date: '2026-01-01', ...extra });
  const dl = (id, qty, agr = 'A1') => ({ id, agreementId: agr, date: '2026-01-05', qty });
  const data = { agreements: [ag(), ag({ id: 'A2' })], deliveries: [dl('d1', 589)], payments: [{ id: 'p1', agreementId: 'A1', customerId: 'C1', date: '2026-01-06', amount: 0, currency: 'SYP' }, { id: 'p2', agreementId: 'A2', customerId: 'C1', date: '2026-01-07', amount: 3000, currency: 'SYP' }] };
  it('المستحق 58,900 والدفعة المقدمة 3,000 ← الصافي 55,900 مثل الكشف', () => {
    const p = customerPosition('C1', data); expect(p.receivable).toBe(58900); expect(p.unappliedCredit).toBe(3000);
    expect(netCustomerBalance('C1', data)).toBe(55900); expect(customerStatement('C1', { ...data }).closing).toBe(55900);
  });
  it('الصافي يطابق الكشف دائماً (مع رصيد افتتاحي)', () => {
    expect(netCustomerBalance('C1', data, 1000)).toBe(customerStatement('C1', { ...data, openingBalance: 1000 }).closing);
  });
  it('عميل رصيده له علينا ← سالب', () => { expect(netCustomerBalance('C1', { agreements: [ag()], deliveries: [], payments: [{ id: 'p', agreementId: 'A1', customerId: 'C1', date: '2026-01-02', amount: 700, currency: 'SYP' }] })).toBe(-700); });
});
describe('قيمة القطيع الحالية', () => {
  const animals = [{ id: 'a', tag: 'A', category: 'cow', acquisitionCost: 1000, currency: 'SYP' }, { id: 'b', tag: 'B', category: 'cow', acquisitionCost: 500, currency: 'SYP' }, { id: 'c', tag: 'C', category: 'calf', acquisitionCost: 0, currency: 'SYP' }, { id: 'd', tag: 'D', category: 'cow', acquisitionCost: 700, currency: 'SYP' }, { id: 'e', tag: 'E', category: 'cow', acquisitionCost: 9999, currency: 'SYP', voided: true }, { id: 'u', tag: 'U', category: 'cow', acquisitionCost: 80, currency: 'USD' }];
  const ev = (animalId, type, date = '2026-01-01') => ({ animalId, type, date });
  const events = [ev('a', 'purchase'), ev('b', 'purchase'), ev('b', 'sale', '2026-02-01'), ev('c', 'birth'), ev('d', 'purchase'), ev('d', 'death', '2026-03-01'), ev('e', 'purchase'), ev('u', 'purchase')];
  it('يحسب الموجود فقط (المباع/النافق/الملغى خارج)، لكل عملة وفئة', () => {
    const v = herdValue(animals, events); expect(v.count).toBe(3); expect(v.byCurrency).toEqual({ SYP: 1000, USD: 80 });
    expect(v.byCategory.find((x) => x.category === 'cow' && x.currency === 'SYP')).toMatchObject({ count: 1, cost: 1000 }); expect(v.byCategory.find((x) => x.category === 'calf')).toMatchObject({ count: 1, cost: 0 });
  });
});
describe('من دفع ثمن شراء الحيوان', () => {
  const animal = { id: 'A1', tag: 'C1', acquisitionCost: 5000, acquisitionDate: '2026-04-01' }; const ev = { id: 'EV', animalId: 'A1', type: 'purchase', value: 5000, date: '2026-04-01', currency: 'SYP' };
  it('قيد حساب شريك ← شريك', () => { expect(purchaseSource(animal, { events: [ev], ledger: [{ id: 'L', type: 'animal_purchase_paid', partnerId: 'w', eventId: 'EV' }] })).toMatchObject({ from: 'partner', partnerId: 'w', amount: 5000 }); });
  it('حركة صندوق ← الصندوق', () => { expect(purchaseSource(animal, { events: [ev], cash: [{ id: 'C', type: 'animal_purchase', accountId: 'cb', animalId: 'A1' }] })).toMatchObject({ from: 'account', accountId: 'cb' }); });
  it('قيد فرق تبادل لا يُحسب مصدر شراء، وبدون مصدر ← none', () => {
    expect(purchaseSource(animal, { events: [ev], ledger: [{ id: 'L', type: 'animal_purchase_paid', partnerId: 'w', exchangeId: 'X', animalId: 'A1' }] }).from).toBe('none'); expect(purchaseSource(animal, { events: [ev] }).from).toBe('none');
  });
});
describe('تغيير من دفع ثمن الحيوان', () => {
  const animal = { id: 'A1', tag: 'C1' }; const ev = { id: 'EV', animalId: 'A1', type: 'purchase', value: 5000, date: 'd', currency: 'SYP' };
  const ids = (ops) => ops.map((o) => `${o.col}:${o.id || 'new'}`);
  it('من شريك لشريك آخر: يُلغى القيد القديم ويُنشأ قيد للجديد', async () => {
    await O.changePurchasePayer({}, animal, { events: [ev], ledger: [{ id: 'L1', type: 'animal_purchase_paid', partnerId: 'w', eventId: 'EV' }] }, { from: 'partner', partnerId: 'm' });
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L1', 'partnerCapitalTransactions:new', 'animalEvents:EV']); expect(calls[0].ops[1].data).toMatchObject({ partnerId: 'm', amount: 5000, eventId: 'EV' }); expect(calls[0].ops[2].data).toEqual({ paidFrom: 'partner', payerPartnerId: 'm' });
  });
  it('من شريك للصندوق: يُلغى القيد وتُنشأ حركة صندوق خارجة', async () => {
    await O.changePurchasePayer({}, animal, { events: [ev], ledger: [{ id: 'L1', type: 'animal_purchase_paid', partnerId: 'w', eventId: 'EV' }] }, { from: 'account', accountId: 'cb' });
    expect(ids(calls[0].ops)).toEqual(['partnerCapitalTransactions:L1', 'cashTransactions:new', 'animalEvents:EV']); expect(calls[0].ops[1].data).toMatchObject({ type: 'animal_purchase', direction: 'out', amount: 5000, accountId: 'cb' });
  });
  it('من الصندوق لشريك، وبدون تغيير لا يكتب شيئاً، وبلا اختيار يرفض', async () => {
    await O.changePurchasePayer({}, animal, { events: [ev], cash: [{ id: 'C1', type: 'animal_purchase', animalId: 'A1', accountId: 'cb' }] }, { from: 'partner', partnerId: 'w' });
    expect(ids(calls[0].ops)).toEqual(['cashTransactions:C1', 'partnerCapitalTransactions:new', 'animalEvents:EV']);
    calls.length = 0; expect(await O.changePurchasePayer({}, animal, { events: [ev], ledger: [{ id: 'L1', type: 'animal_purchase_paid', partnerId: 'w', eventId: 'EV' }] }, { from: 'partner', partnerId: 'w' })).toBe(0); expect(calls.length).toBe(0);
    await expect(O.changePurchasePayer({}, animal, { events: [ev] }, { from: 'partner' })).rejects.toThrow(/اختر الشريك/); await expect(O.changePurchasePayer({}, animal, { events: [] }, { from: 'account', accountId: 'a' })).rejects.toThrow(/لا يوجد شراء/);
  });
});
describe('تاريخ اليوم بصيغة ثابتة (لا يعتمد على locale الجهاز: مهم للأيفون)', () => {
  it('YYYY-MM-DD دائماً', () => { expect(todayISO()).toMatch(/^\d{4}-\d{2}-\d{2}$/); });
});
