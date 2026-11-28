import { describe, it, expect, vi, beforeEach } from 'vitest';
import { isLocked, laterDate, lockViolation } from '../src/lib/periodLock.js';
import { countDiff, countAdjustmentTx, cashBalances } from '../src/lib/finance.js';
const calls = []; let n = 0;
vi.mock('../src/data/db', () => ({ commit: vi.fn(async (u, ops, a) => { calls.push({ ops, a }); return []; }), nextNumber: vi.fn(), newId: vi.fn((c) => `${c}#${++n}`) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS' }));
const O = await import('../src/data/ops.js');
beforeEach(() => { calls.length = 0; n = 0; });

describe('قفل الفترات', () => {
  it('التاريخ داخل الفترة المقفلة (يشمل يوم القفل نفسه)', () => {
    expect(isLocked('2026-10-31', '2026-10-31')).toBe(true); expect(isLocked('2026-11-01', '2026-10-31')).toBe(false); expect(isLocked('2026-05-01', '')).toBe(false);
  });
  it('أحدث تاريخ', () => { expect(laterDate('2026-10-31', '2026-09-30')).toBe('2026-10-31'); expect(laterDate('', '2026-09-30')).toBe('2026-09-30'); expect(laterDate('2026-09-30', undefined)).toBe('2026-09-30'); });
  it('إضافة سجل بتاريخ مقفل مرفوضة، وبتاريخ بعده مسموحة', () => {
    expect(lockViolation([{ col: 'expenses', data: { date: '2026-10-15' } }], '2026-10-31')).toMatch(/مقفلة/);
    expect(lockViolation([{ col: 'expenses', data: { date: '2026-11-02' } }], '2026-10-31')).toBeNull();
  });
  it('إلغاء/تعديل سجل قديم يُفحص بتاريخه المخزَّن (لا يحمل الإلغاء تاريخاً)', () => {
    const get = (col, id) => (col === 'expenses' && id === 'E1' ? { date: '2026-10-05' } : null);
    expect(lockViolation([{ col: 'expenses', id: 'E1', merge: true, data: { voided: true } }], '2026-10-31', get)).toMatch(/مقفلة/);
    expect(lockViolation([{ col: 'expenses', id: 'E2', merge: true, data: { voided: true } }], '2026-10-31', get)).toBeNull(); // غير محمّل: لا يُحجب
  });
  it('نقل سجل من فترة مفتوحة إلى مقفلة (تعديل التاريخ) مرفوض أيضاً', () => {
    const get = () => ({ date: '2026-11-10' });
    expect(lockViolation([{ col: 'cashTransactions', id: 'T', merge: true, data: { date: '2026-10-01' } }], '2026-10-31', get)).toMatch(/مقفلة/);
  });
  it('سجلات غير مالية لا تُقفل: إنتاج الحليب، التسمين، الحسابات، الجرد، الإعدادات', () => {
    for (const col of ['milkProduction', 'calfLogs', 'cashAccounts', 'cashCounts', 'settings', 'partners', 'animals']) expect(lockViolation([{ col, data: { date: '2026-01-01' } }], '2026-10-31')).toBeNull();
  });
  it('قيد السلفة بتاريخ disbursementDate يُفحص أيضاً', () => { expect(lockViolation([{ col: 'partnerLoans', data: { disbursementDate: '2026-02-01' } }], '2026-10-31')).toMatch(/مقفلة/); });
  it('لا قفل = لا فحص', () => { expect(lockViolation([{ col: 'expenses', data: { date: '2020-01-01' } }], '')).toBeNull(); });
});

describe('اعتماد التسوية يقفل الفترة تلقائياً', () => {
  const s = { from: '2026-10-01', to: '2026-10-31', currency: 'SYP', netProfit: 100 };
  it('يضيف تحديث settings/main بتاريخ نهاية التسوية، ولا يُرجِع القفل للخلف', async () => {
    await O.finalizeSettlement({}, s, [{ id: 'w', name: 'و', ownershipPct: 100 }], [], [{ partnerId: 'w', amount: 100 }], '');
    const lock = calls[0].ops.find((o) => o.col === 'settings'); expect(lock).toMatchObject({ id: 'main', merge: true, data: { lockedThrough: '2026-10-31' } });
    await O.finalizeSettlement({}, { ...s, from: '2026-05-01', to: '2026-05-31' }, [{ id: 'w', name: 'و', ownershipPct: 100 }], [], [{ partnerId: 'w', amount: 100 }], '2026-10-31');
    expect(calls[1].ops.find((o) => o.col === 'settings').data.lockedThrough).toBe('2026-10-31');
  });
});

describe('جرد الصندوق', () => {
  it('الفرق = الفعلي − النظام', () => { expect(countDiff(900, 1000)).toBe(-100); expect(countDiff(1050.5, 1000)).toBe(50.5); expect(countDiff(1000, 1000)).toBe(0); });
  it('حركة التسوية: عجز ← خارج، زيادة ← داخل، فيتساوى رصيد النظام مع الفعلي', () => {
    const base = [{ accountId: 'a', currency: 'SYP', direction: 'in', amount: 1000, type: 'opening_balance' }];
    const lost = countAdjustmentTx({ accountId: 'a', currency: 'SYP', diff: -100, date: '2026-11-01' }); expect(lost).toMatchObject({ direction: 'out', amount: 100, type: 'cash_count_adjustment' });
    expect(cashBalances([...base, lost])['a|SYP']).toBe(900);
    const gain = countAdjustmentTx({ accountId: 'a', currency: 'SYP', diff: 50, date: '2026-11-01' }); expect(gain.direction).toBe('in'); expect(cashBalances([...base, gain])['a|SYP']).toBe(1050);
  });
});
