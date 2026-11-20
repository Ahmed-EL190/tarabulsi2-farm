import { describe, it, expect } from 'vitest';
import { allocateProfitByThirds, partnerInvestment, effectiveProfitShares, operatingExpenses, profitGroupOf } from '../src/lib/finance.js';

const P = [
  { id: 'w', name: 'أبو وليد', ownershipPct: 50, profitSharePct: 0 },
  { id: 'a', name: 'عمار', ownershipPct: 50, profitSharePct: 0 },
  { id: 'g', name: 'أبو غفير', ownershipPct: 0, profitSharePct: 50 },
  { id: 's', name: 'سعيد', ownershipPct: 0, profitSharePct: 50 },
];
const sum = (r) => Math.round(r.allocations.reduce((x, a) => x + a.amount, 0) * 100) / 100;
const amt = (r, id) => r.allocations.find((a) => a.partnerId === id).amount;

describe('رأس المال تلقائياً', () => {
  const ledger = [
    { partnerId: 'w', type: 'animal_purchase_paid', amount: 6000, currency: 'SYP', date: '2026-01-01', animalId: 'A1' },
    { partnerId: 'a', type: 'animal_purchase_paid', amount: 2000, currency: 'SYP', date: '2026-01-02', animalId: 'A2' },
    { partnerId: 'a', type: 'expense_paid_personally', amount: 2000, currency: 'SYP', date: '2026-01-03', expenseId: 'E1' },
    { partnerId: 'a', type: 'expense_paid_personally', amount: 999, currency: 'SYP', date: '2026-01-03', expenseId: 'E2' }, // علف: ليس رأس مال
    { partnerId: 'w', type: 'animal_purchase_paid', amount: 500, currency: 'SYP', date: '2026-01-04', animalId: 'GONE' }, // حيوان ملغى
    { partnerId: 'w', type: 'animal_purchase_paid', amount: 700, currency: 'SYP', date: '2026-03-01', animalId: 'A3' }, // بعد تاريخ القطع
  ];
  const expenses = [{ id: 'E1', category: 'equipment' }, { id: 'E2', category: 'feed' }];
  const animals = [{ id: 'GONE', voided: true }];
  it('بقر + معدات فقط، يتجاهل الملغى والمصروفات العادية', () => {
    expect(partnerInvestment('w', { ledger, expenses, animals }, { to: '2026-02-01' })).toEqual({ cows: 6000, equipment: 0, total: 6000 });
    expect(partnerInvestment('a', { ledger, expenses, animals }, { to: '2026-02-01' })).toEqual({ cows: 2000, equipment: 2000, total: 4000 });
  });
  it('المعدات ليست مصروف تشغيل', () => {
    const ex = [{ id: 1, date: 'd', amount: 100, currency: 'SYP', category: 'feed' }, { id: 2, date: 'd', amount: 900, currency: 'SYP', category: 'equipment' }];
    expect(operatingExpenses(ex).length).toBe(1);
  });
});

describe('توزيع الأرباح بالأثلاث', () => {
  it('ربح 900: 300 لأبو غفير وسعيد، و600 لأبو وليد وعمار بنسبة رأس المال (60/40)', () => {
    const r = allocateProfitByThirds(900, P, { w: 6000, a: 4000 });
    expect(amt(r, 'g')).toBe(150); expect(amt(r, 's')).toBe(150);
    expect(amt(r, 'w')).toBe(360); expect(amt(r, 'a')).toBe(240);
    expect(r.breakdown).toMatchObject({ sideThird: 300, ownersThird: 300, farmThird: 300, ownersBasis: 'capital' });
    expect(sum(r)).toBe(900);
  });
  it('المجموع يطابق الربح دائماً حتى مع القروش والخسارة', () => {
    for (const np of [100, 1000.01, -250.5, 0, 7]) expect(sum(allocateProfitByThirds(np, P, { w: 3333, a: 6667 }))).toBe(np);
  });
  it('بدون رأس مال: يرجع لنسبة الملكية ثم للتساوي', () => {
    expect(allocateProfitByThirds(900, P, {}).breakdown.ownersBasis).toBe('ownership');
    const eq = allocateProfitByThirds(900, P.map((p) => ({ ...p, ownershipPct: 0, profitGroup: p.id === 'g' || p.id === 's' ? 'side' : 'owners' })), {});
    expect(eq.breakdown.ownersBasis).toBe('equal'); expect(amt(eq, 'w')).toBe(300);
  });
  it('نسبة داخلية غير متساوية لشريكي الربح فقط', () => {
    const r = allocateProfitByThirds(900, [P[0], P[1], { ...P[2], profitSharePct: 75 }, { ...P[3], profitSharePct: 25 }], { w: 1, a: 1 });
    expect(amt(r, 'g')).toBe(225); expect(amt(r, 's')).toBe(75);
  });
  it('بدون شركاء ربح فقط: الملاك يأخذون الكل؛ وبدون ملاك: خطأ', () => {
    expect(sum(allocateProfitByThirds(900, [P[0], P[1]], { w: 1, a: 1 }))).toBe(900);
    expect(() => allocateProfitByThirds(900, [P[2], P[3]], {})).toThrow();
  });
  it('النسب الفعلية من إجمالي الأرباح', () => {
    const e = effectiveProfitShares(P, { w: 6000, a: 4000 });
    expect(e).toEqual({ w: 40, a: 26.67, g: 16.67, s: 16.67 });
  });
  it('تحديد المجموعة تلقائياً أو يدوياً', () => {
    expect(profitGroupOf({ ownershipPct: 50 })).toBe('owners'); expect(profitGroupOf({ ownershipPct: 0 })).toBe('side');
    expect(profitGroupOf({ ownershipPct: 0, profitGroup: 'owners' })).toBe('owners');
  });
});

describe('سجل «المزرعة» لا يأخذ من ثلث شركاء الربح فقط', () => {
  const withFarm = [...P, { id: 'f', name: 'المزرعة', ownershipPct: 0, profitSharePct: 33.33 }];
  it('يُتعرَّف عليه بالاسم أو بالاختيار، ويُستبعد من التوزيع', () => {
    expect(profitGroupOf({ name: 'المزرعة', ownershipPct: 0 })).toBe('farm'); expect(profitGroupOf({ name: 'x', profitGroup: 'farm' })).toBe('farm');
    const r = allocateProfitByThirds(900, withFarm, { w: 6000, a: 4000 });
    expect(r.allocations.find((a) => a.partnerId === 'f')).toBeUndefined();
    expect(amt(r, 'g')).toBe(150); expect(amt(r, 's')).toBe(150); expect(amt(r, 'w')).toBe(360); expect(amt(r, 'a')).toBe(240); expect(sum(r)).toBe(900);
  });
  it('نفس أرقام لقطة الشاشة: أبو وليد 489.5م وعمار 83م وأبو غفير وسعيد بالتساوي', () => {
    const e = effectiveProfitShares(withFarm, { w: 489500000, a: 83000000 });
    expect(e).toEqual({ w: 57, a: 9.67, g: 16.67, s: 16.67 });
  });
});

describe('المزرعة المحفوظة صراحةً كشريك ربح فقط', () => {
  it('الاسم يتغلّب: تبقى «مزرعة» ولا تدخل ثلث أبو غفير وسعيد', () => {
    const ps = [...P, { id: 'f', name: 'المزرعة', ownershipPct: 0, profitSharePct: 50, profitGroup: 'side' }];
    expect(profitGroupOf(ps[4])).toBe('farm');
    const r = allocateProfitByThirds(900, ps.map((p) => (p.id === 'g' || p.id === 's' ? { ...p, profitSharePct: 25 } : p)), { w: 6000, a: 4000 });
    expect(amt(r, 'g')).toBe(150); expect(amt(r, 's')).toBe(150); expect(r.allocations.some((a) => a.partnerId === 'f')).toBe(false);
  });
  it('الاختيار الصريح «ملكية» لا يُلغى بالاسم', () => { expect(profitGroupOf({ name: 'المزرعة', profitGroup: 'owners' })).toBe('owners'); });
});
