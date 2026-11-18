import { describe, it, expect } from 'vitest';
import { animalExchangeInfo } from '../src/lib/finance.js';
const A = { id: 'N', tag: 'N1', currency: 'SYP' };
const ev = [
  { id: '1', type: 'exchange_out', animalId: 'a', tag: 'A1', value: 3000, exchangeId: 'X' },
  { id: '2', type: 'exchange_out', animalId: 'b', tag: 'B1', value: 2000, exchangeId: 'X' },
  { id: '3', type: 'exchange_out', animalId: 'c', tag: 'C1', value: 1000, exchangeId: 'X' },
  { id: '4', type: 'exchange_in', animalId: 'N', tag: 'N1', value: 9000, exchangeId: 'X', currency: 'SYP', date: '2026-06-01' },
  { id: '5', type: 'exchange_out', animalId: 'z', tag: 'Z', value: 500, exchangeId: 'Y' },
];
describe('بيانات التبادل في كارت الحيوان', () => {
  it('3 حيوانات مقابل واحد: الفرق ومن دفعه (شريك)', () => {
    const r = animalExchangeInfo(A, { events: ev, ledger: [{ type: 'animal_purchase_paid', exchangeId: 'X', partnerId: 'P1', amount: 3000 }] });
    expect(r).toMatchObject({ inValue: 9000, outValue: 6000, diff: 3000, paidBy: 'partner', partnerId: 'P1' }); expect(r.outs.map((o) => o.tag)).toEqual(['A1', 'B1', 'C1']);
  });
  it('الفرق من الصندوق، أو محدد بعلامة الحدث، أو غير محدد', () => {
    expect(animalExchangeInfo(A, { events: ev, cash: [{ type: 'animal_exchange_payment', exchangeId: 'X', accountId: 'K' }] })).toMatchObject({ paidBy: 'account', accountId: 'K' });
    expect(animalExchangeInfo(A, { events: ev.map((e) => (e.id === '4' ? { ...e, diffPaidBy: 'P2' } : e)) })).toMatchObject({ paidBy: 'partner', partnerId: 'P2' });
    expect(animalExchangeInfo(A, { events: ev }).paidBy).toBe('none');
  });
  it('فرق صفر أو استلام فرق، وحيوان لم يدخل بتبادل → null، ويتجاهل الملغى', () => {
    const eq = ev.map((e) => (e.id === '4' ? { ...e, value: 6000 } : e)); expect(animalExchangeInfo(A, { events: eq })).toMatchObject({ diff: 0, paidBy: 'none' });
    const rec = ev.map((e) => (e.id === '4' ? { ...e, value: 5000 } : e));
    expect(animalExchangeInfo(A, { events: rec, cash: [{ type: 'animal_exchange_receipt', exchangeId: 'X', accountId: 'K' }] })).toMatchObject({ diff: -1000, paidBy: 'account' });
    expect(animalExchangeInfo({ id: 'Q' }, { events: ev })).toBeNull();
    expect(animalExchangeInfo(A, { events: ev.map((e) => (e.id === '1' ? { ...e, voided: true } : e)), ledger: [{ type: 'animal_purchase_paid', exchangeId: 'X', partnerId: 'P1', voided: true }] })).toMatchObject({ outValue: 3000, diff: 6000, paidBy: 'none' });
  });
});
