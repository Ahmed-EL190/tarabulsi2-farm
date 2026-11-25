import { describe, it, expect } from 'vitest';
import { parseSummary, describeRecord, buildOperations, changedFields } from '../src/lib/auditText.js';
const ctx = { partner: (id) => ({ p1: 'أبو وليد' })[id] || '', account: (id) => ({ a1: 'الصندوق الرئيسي' })[id] || '', customer: (id) => ({ c1: 'عميل الحليب' })[id] || '' };
const T = (s) => ({ toDate: () => new Date(s * 1000), seconds: s });

describe('سجل التدقيق مفهوم', () => {
  it('يقرأ JSON كاملاً ومقطوعاً', () => {
    expect(parseSummary('{"a":1,"tag":"A14"}')).toEqual({ a: 1, tag: 'A14' });
    expect(parseSummary('{"calfId":"a14","tag":"A14","date":"2026-11-23","qty":20,"itemName":"علف')).toMatchObject({ tag: 'A14', date: '2026-11-23', qty: 20 });
    expect(parseSummary('A14')).toEqual({ _text: 'A14' });
  });
  it('جمل عربية للسجلات المختلفة', () => {
    expect(describeRecord('calfLogs', { type: 'feed', qty: 20, unit: 'كغ', tag: 'A14' })).toBe('علف — 20 كغ — للعجل A14');
    expect(describeRecord('expenses', { description: 'علف', amount: 1000000, currency: 'SYP', category: 'feed' })).toBe('علف — 1,000,000 SYP');
    expect(describeRecord('partnerCapitalTransactions', { type: 'animal_purchase_paid', amount: 500, currency: 'SYP', partnerId: 'p1' }, ctx)).toContain('أبو وليد');
    expect(describeRecord('stockMovements', { type: 'out', qty: 20, itemName: 'علف مركز' })).toBe('صادر — 20 علف مركز');
    expect(describeRecord('cashTransactions', { type: 'customer_payment', amount: 3000000, currency: 'SYP', accountId: 'a1' }, ctx)).toContain('الصندوق الرئيسي');
    expect(describeRecord('expenses', {}, ctx, 'NdneXBCZXPIScxZYu78w')).toBe('(رقم السجل NdneXB…)');
  });
  it('الإلغاء يُفهم من سطر الإضافة الأقدم لنفس السجل، ويُجمّع ما حصل في لحظة واحدة', () => {
    const rows = [ // الأحدث أولاً
      { id: '4', at: T(200), uid: 'u', userName: 'أحمد', action: 'void', collection: 'stockMovements', docId: 'S1', summary: '{"voided":true,"voidReason":"خطأ في الكمية"}' },
      { id: '3', at: T(200), uid: 'u', userName: 'أحمد', action: 'void', collection: 'calfLogs', docId: 'L1', summary: '{"voided":true,"voidReason":"خطأ في الكمية"}' },
      { id: '2', at: T(100), uid: 'u', userName: 'أحمد', action: 'create', collection: 'stockMovements', docId: 'S1', summary: '{"itemId":"i","itemName":"علف مركز","type":"out","qty":20,"date":"2026-11-23"}' },
      { id: '1', at: T(100), uid: 'u', userName: 'أحمد', action: 'create', collection: 'calfLogs', docId: 'L1', summary: '{"calfId":"a14","tag":"A14","type":"feed","qty":20,"unit":"كغ","date":"2026-11-23"}' },
    ];
    const ops = buildOperations(rows, ctx);
    expect(ops).toHaveLength(2);
    expect(ops[0]).toMatchObject({ action: 'void', title: 'إلغاء سجل تسمين: علف — 20 كغ — للعجل A14', reason: 'خطأ في الكمية' });
    expect(ops[0].subs[0].text).toBe('إلغاء حركة مخزون: صادر — 20 علف مركز');
    expect(ops[1].title).toBe('إضافة سجل تسمين: علف — 20 كغ — للعجل A14'); expect(ops[1].action).toBe('create');
  });
  it('حقول التعديل بالعربية دون الحقول التقنية', () => {
    const f = changedFields({ amount: 500, partnerId: 'p1', voided: true, createdAt: 1, eventId: 'x', notes: 'ملاحظة' }, ctx);
    expect(f).toEqual([['المبلغ', '500'], ['الشريك', 'أبو وليد'], ['ملاحظات', 'ملاحظة']]);
  });
});
