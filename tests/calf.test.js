import { describe, it, expect } from 'vitest';
import { calfFattening } from '../src/lib/finance.js';
const L = [
  { calfId: 'c1', date: '2026-01-10', type: 'arrival_weight', qty: 40 },
  { calfId: 'c1', date: '2026-02-09', type: 'weight', qty: 70 },
  { calfId: 'c1', date: '2026-06-10', type: 'weight', qty: 160 },
  { calfId: 'c1', date: '2026-01-20', type: 'feed', qty: 2, item: 'مركّز' },
  { calfId: 'c1', date: '2026-03-01', type: 'feed', qty: 30, item: 'مركّز' },
  { calfId: 'c1', date: '2026-03-02', type: 'feed', qty: 10, item: 'تبن' },
  { calfId: 'c1', date: '2026-01-15', type: 'milk', qty: 5 }, { calfId: 'c1', date: '2026-01-16', type: 'milk', qty: 6.5 },
  { calfId: 'c1', date: '2026-02-01', type: 'other', qty: 3, item: 'فيتامين', unit: 'جرعة' },
  { calfId: 'c1', date: '2026-02-02', type: 'milk', qty: 99, voided: true },
  { calfId: 'c2', date: '2026-01-10', type: 'milk', qty: 100 },
];
describe('تسمين العجول', () => {
  it('كل الفترة: وزن وعلف وحليب وبنود أخرى', () => {
    const r = calfFattening('c1', L);
    expect(r).toMatchObject({ startWeight: 40, endWeight: 160, gain: 120, days: 151, feed: 42, milk: 11.5 });
    expect(r.feedByItem).toEqual({ 'مركّز': 32, 'تبن': 10 }); expect(r.other).toEqual({ 'فيتامين (جرعة)': 3 });
    expect(r.dailyGain).toBe(0.79); expect(r.feedPerKgGain).toBe(0.35);
  });
  it('فترة محددة: يجمع الاستهلاك فيها فقط، والوزن حتى نهايتها', () => {
    const r = calfFattening('c1', L, { from: '2026-02-01', to: '2026-03-31' });
    expect(r).toMatchObject({ startWeight: 40, endWeight: 70, gain: 30, feed: 40, milk: 0 });
  });
  it('بلا أوزان: لا زيادة ولا خطأ، ولا يخلط عجلاً بآخر', () => {
    const r = calfFattening('c2', L); expect(r).toMatchObject({ startWeight: null, gain: null, dailyGain: null, milk: 100, feed: 0 });
  });
});
