import { describe, it, expect } from 'vitest';
import { auditData } from '../src/lib/integrity.js';

// بيانات سليمة ومترابطة بالكامل: لازم لا تُنتج أي مشكلة
const healthy = () => ({
  accounts: [{ id: 'cb', name: 'الصندوق' }], partners: [{ id: 'w', name: 'أبو وليد', ownershipPct: 100, profitSharePct: 100, status: 'active' }],
  agreements: [{ id: 'AG1', number: 'AG-1', customerId: 'c1', agreedQty: 1000, pricePerLiter: 7000, currency: 'SYP' }],
  deliveries: [{ id: 'D1', agreementId: 'AG1', qty: 600, date: '2026-05-01' }],
  custPays: [{ id: 'CP1', agreementId: 'AG1', customerId: 'c1', amount: 3000000, currency: 'SYP', date: '2026-05-02', accountId: 'cb', type: 'payment' }],
  expenses: [{ id: 'E1', category: 'feed', description: 'علف', amount: 500, currency: 'SYP', date: '2026-05-03' }, { id: 'E2', category: 'partner_withdrawal', description: 'سحب', amount: 100, currency: 'SYP', date: '2026-05-04', partnerAccountId: 'w' }],
  expensePays: [{ id: 'P1', expenseId: 'E1', amount: 500, currency: 'SYP', date: '2026-05-03', source: 'account', accountId: 'cb' }, { id: 'P2', expenseId: 'E2', amount: 100, currency: 'SYP', date: '2026-05-04', source: 'account', accountId: 'cb' }],
  animals: [{ id: 'A1', tag: 'C1', acquisitionCost: 9000, currency: 'SYP' }], events: [{ id: 'EV1', animalId: 'A1', tag: 'C1', type: 'purchase', value: 9000, currency: 'SYP', date: '2026-04-01', paidFrom: 'partner', payerPartnerId: 'w' }],
  loans: [{ id: 'LN', partnerId: 'w', principal: 1000, currency: 'SYP', disbursementDate: '2026-01-01' }], loanReps: [{ id: 'R1', loanId: 'LN', principalAmount: 200, interestAmount: 0, date: '2026-03-01' }],
  ledger: [{ id: 'L1', partnerId: 'w', type: 'animal_purchase_paid', amount: 9000, currency: 'SYP', date: '2026-04-01', eventId: 'EV1', animalId: 'A1' }, { id: 'L2', partnerId: 'w', type: 'loan_given', amount: 1000, currency: 'SYP', date: '2026-01-01', loanId: 'LN' },
    { id: 'L3', partnerId: 'w', type: 'loan_principal_repayment', amount: 200, currency: 'SYP', date: '2026-03-01', loanId: 'LN' }, { id: 'L4', partnerId: 'w', type: 'withdrawal', amount: 100, currency: 'SYP', date: '2026-05-04', expenseId: 'E2', expensePaymentId: 'P2' }],
  cash: [{ id: 'C0', type: 'capital_contribution', direction: 'in', amount: 99999999, currency: 'SYP', date: '2026-01-01', accountId: 'cb' },
    { id: 'C1', type: 'customer_payment', direction: 'in', amount: 3000000, currency: 'SYP', date: '2026-05-02', accountId: 'cb', customerPaymentId: 'CP1' },
    { id: 'C2', type: 'expense_payment', direction: 'out', amount: 500, currency: 'SYP', date: '2026-05-03', accountId: 'cb', expensePaymentId: 'P1', expenseId: 'E1' }, { id: 'C3', type: 'expense_payment', direction: 'out', amount: 100, currency: 'SYP', date: '2026-05-04', accountId: 'cb', expensePaymentId: 'P2', expenseId: 'E2' },
    { id: 'C4', type: 'loan_received', direction: 'in', amount: 1000, currency: 'SYP', date: '2026-01-01', accountId: 'cb', loanId: 'LN' }, { id: 'C5', type: 'loan_repayment', direction: 'out', amount: 200, currency: 'SYP', date: '2026-03-01', accountId: 'cb', loanId: 'LN' }],
  settlements: [], production: [{ id: 'PR1', date: '2026-05-01', shift: 'morning', liters: 10 }, { id: 'PR2', date: '2026-05-01', shift: 'evening', liters: 12 }],
});
const find = (r, id) => r.checks.find((c) => c.id === id);
const bad = (r) => r.checks.filter((c) => c.items.length).map((c) => c.id);

describe('فحص سلامة البيانات', () => {
  it('بيانات سليمة ومترابطة ← صفر مشاكل وكل المطابقات ✓', () => {
    const r = auditData(healthy()); expect(bad(r)).toEqual([]); expect(r.summary.reconBad).toBe(0); expect(r.reconciliation.length).toBeGreaterThan(5);
  });
  it('دفعة مصروف بلا حركة صندوق ← خطأ + إصلاح بإنشاء الحركة', () => {
    const d = healthy(); d.cash = d.cash.filter((t) => t.id !== 'C2'); const r = auditData(d);
    expect(bad(r)).toContain('expPayNoCash'); expect(find(r, 'expPayNoCash').fix.ops[0].data).toMatchObject({ type: 'expense_payment', amount: 500, accountId: 'cb', expensePaymentId: 'P1' }); expect(r.summary.reconBad).toBeGreaterThan(0);
  });
  it('مبلغ الصندوق يخالف الدفعة ← خطأ + إصلاح بالمطابقة', () => {
    const d = healthy(); d.cash.find((t) => t.id === 'C2').amount = 450; const r = auditData(d);
    expect(find(r, 'expPayCashMismatch').items.length).toBe(1); expect(find(r, 'expPayCashMismatch').fix.ops[0]).toMatchObject({ id: 'C2', merge: true, data: { amount: 500 } });
  });
  it('مصروف ملغى وحركته في الصندوق باقية (المشكلة اللي حصلت) ← حركة يتيمة + إصلاح بالإلغاء', () => {
    const d = healthy(); d.expenses.find((e) => e.id === 'E1').voided = true; d.expensePays.find((p) => p.id === 'P1').voided = true; const r = auditData(d);
    expect(find(r, 'orphanCash').items.length).toBe(1); expect(find(r, 'orphanCash').fix.ops).toEqual([{ col: 'cashTransactions', id: 'C2', void: true }]);
  });
  it('دفعة عميل بلا حركة صندوق، أو بلا صندوق أصلاً', () => {
    let d = healthy(); d.cash = d.cash.filter((t) => t.id !== 'C1'); expect(bad(auditData(d))).toContain('custPayNoCash');
    d = healthy(); d.custPays[0].accountId = ''; d.cash = d.cash.filter((t) => t.id !== 'C1'); const r = auditData(d); expect(bad(r)).toContain('custPayNoAccount'); expect(bad(r)).not.toContain('custPayNoCash');
  });
  it('تكرار حركة الصندوق لنفس الدفعة ← إصلاح بإلغاء الزائدة', () => {
    const d = healthy(); d.cash.push({ ...d.cash.find((t) => t.id === 'C2'), id: 'C2b' }); const r = auditData(d);
    expect(find(r, 'dupCash').fix.ops).toEqual([{ col: 'cashTransactions', id: 'C2b', void: true }]);
  });
  it('شراء حيوان على حساب شريك ومن الصندوق معاً (حالة الـ 41.5 مليون) ← خطأ + إصلاح', () => {
    const d = healthy(); d.cash.push({ id: 'CX', type: 'animal_purchase', direction: 'out', amount: 9000, currency: 'SYP', date: '2026-04-01', accountId: 'cb', animalId: 'A1' }); const r = auditData(d);
    expect(find(r, 'purchaseTwice').items.length).toBe(1); expect(find(r, 'purchaseTwice').fix.ops).toEqual([{ col: 'cashTransactions', id: 'CX', void: true }]);
  });
  it('شراء بلا مصدر دفع، وشراء على شريك بلا قيد في حسابه', () => {
    let d = healthy(); d.events[0].paidFrom = undefined; d.ledger = d.ledger.filter((l) => l.id !== 'L1'); expect(bad(auditData(d))).toContain('purchaseNoSource');
    d = healthy(); d.ledger = d.ledger.filter((l) => l.id !== 'L1'); const r = auditData(d); expect(find(r, 'purchaseNoLedger').fix.ops[0].data).toMatchObject({ partnerId: 'w', type: 'animal_purchase_paid', amount: 9000, eventId: 'EV1' });
  });
  it('سحب شريك مسجّل مصروفاً بلا قيد في حسابه', () => {
    const d = healthy(); d.ledger = d.ledger.filter((l) => l.id !== 'L4'); expect(bad(auditData(d))).toContain('partnerCatUnlinked');
  });
  it('قرض بلا قيد/حركة، وسداد لا يطابق، وتجاوز الأصل', () => {
    let d = healthy(); d.ledger = d.ledger.filter((l) => l.id !== 'L2'); d.cash = d.cash.filter((t) => t.id !== 'C4'); expect(find(auditData(d), 'loanLinks').items.length).toBe(2);
    d = healthy(); d.ledger = d.ledger.filter((l) => l.id !== 'L3'); expect(bad(auditData(d))).toContain('loanRepMismatch');
    d = healthy(); d.loanReps[0].principalAmount = 1500; d.ledger.find((l) => l.id === 'L3').amount = 1500; expect(find(auditData(d), 'loanRepMismatch').items.some((i) => i.text.includes('أكبر من أصل'))).toBe(true);
  });
  it('تسليم أكبر من المتفق، وتسليمات لاتفاقية ملغاة', () => {
    let d = healthy(); d.deliveries[0].qty = 1200; expect(bad(auditData(d))).toContain('overDelivered');
    d = healthy(); d.agreements[0].voided = true; expect(find(auditData(d), 'childrenOfVoidedAgreement').fix.ops.map((o) => o.col).sort()).toEqual(['customerPayments', 'milkDeliveries']);
  });
  it('إنتاج حليب: خلط «على مدار اليوم» مع صباح/مساء، وتكرار نفس الوردية', () => {
    let d = healthy(); d.production.push({ id: 'PR3', date: '2026-05-01', shift: 'all', liters: 22 }); expect(bad(auditData(d))).toContain('productionConflict');
    d = healthy(); d.production.push({ id: 'PR4', date: '2026-05-01', shift: 'morning', liters: 5 }); expect(find(auditData(d), 'productionConflict').items.length).toBe(1);
  });
  it('نسب الشركاء لا تساوي 100، وبيع حيوان مرتين', () => {
    let d = healthy(); d.partners[0].profitSharePct = 80; expect(bad(auditData(d))).toContain('shares');
    d = healthy(); d.events.push({ id: 'S1', animalId: 'A1', tag: 'C1', type: 'sale', value: 1, date: '2026-06-01' }, { id: 'S2', animalId: 'A1', tag: 'C1', type: 'sale', value: 1, date: '2026-06-02' }); expect(bad(auditData(d))).toContain('removeWhenInactive');
  });
  it('تسويات متداخلة، وتوزيع أكبر من الحصة، وحصة لا تطابق القيد', () => {
    const d = healthy(); d.settlements = [{ id: 'S1', from: '2026-01-01', to: '2026-06-30', currency: 'SYP', netProfit: 1000, allocations: [{ partnerId: 'w', amount: 1000 }] }, { id: 'S2', from: '2026-06-01', to: '2026-12-31', currency: 'SYP', netProfit: 0, allocations: [] }];
    d.ledger.push({ id: 'AL', partnerId: 'w', type: 'profit_allocation', amount: 900, currency: 'SYP', date: 'd', settlementId: 'S1' }, { id: 'DI', partnerId: 'w', type: 'profit_distribution', amount: 1200, currency: 'SYP', date: 'd', settlementId: 'S1' });
    const r = auditData(d); expect(bad(r)).toEqual(expect.arrayContaining(['settlementOverlap', 'settlementAlloc', 'distributionExceeds']));
  });
  it('تاريخ مستقبلي ومبلغ غير موجب ومصروف بفئة غير معروفة وصندوق بالسالب', () => {
    const d = healthy(); d.expenses.push({ id: 'E9', category: 'zzz', description: 'x', amount: 5, currency: 'SYP', date: '2999-01-01' }); d.cash.push({ id: 'CZ', type: 'other_income', direction: 'in', amount: 0, currency: 'SYP', date: '2026-05-01', accountId: 'cb' });
    d.cash.push({ id: 'CY', type: 'partner_withdrawal', direction: 'out', amount: 1e12, currency: 'SYP', date: '2026-05-01', accountId: 'cb' });
    expect(bad(auditData(d))).toEqual(expect.arrayContaining(['futureDates', 'nonPositive', 'unknownCategory', 'negCash']));
  });
});

describe('فروق التبادل لا تُحسب خطأً كعدم تطابق (الحالة اللي ظهرت في الصورة)', () => {
  const withExchange = () => {
    const d = healthy();
    d.events.push({ id: 'XO', animalId: 'A9', tag: 'OLD', type: 'exchange_out', value: 800, currency: 'SYP', date: '2026-06-01', exchangeId: 'X1' }, { id: 'XI', animalId: 'A1', tag: 'C1', type: 'exchange_in', value: 1000, currency: 'SYP', date: '2026-06-01', exchangeId: 'X1', diffPaidBy: 'w' });
    d.animals.push({ id: 'A9', tag: 'OLD' });
    d.ledger.push({ id: 'LX', partnerId: 'w', type: 'animal_purchase_paid', amount: 200, currency: 'SYP', date: '2026-06-01', exchangeId: 'X1', animalId: 'A1', note: 'فرق تبادل OLD ↔ C1' });
    return d;
  };
  it('قيد فرق تبادل (200) لا يسبب فرقاً في مطابقة الشراء، ويُطابَق مع (وارد − خارج)', () => {
    const r = auditData(withExchange()); expect(r.summary.reconBad).toBe(0); expect(bad(r)).not.toContain('unmatchedPayable');
    const ex = r.reconciliation.find((x) => x.label.includes('فروق تبادل')); expect(ex).toMatchObject({ a: 200, b: 200, ok: true });
  });
  it('فرق تبادل قيده يخالف (وارد − خارج) ← عدم تطابق حقيقي', () => {
    const d = withExchange(); d.ledger.find((l) => l.id === 'LX').amount = 450; const r = auditData(d); expect(r.reconciliation.find((x) => x.label.includes('فروق تبادل')).ok).toBe(false);
  });
  it('قيد ثمن حيوان بلا شراء مقابل (25 مليون مثلاً) ← يظهر في القائمة مع زرار تعديل/حذف', () => {
    const d = healthy(); d.ledger.push({ id: 'LZ', partnerId: 'w', type: 'animal_purchase_paid', amount: 25000000, currency: 'SYP', date: '2026-07-01', animalId: 'A1', note: 'شراء' });
    const r = auditData(d); const c = find(r, 'unmatchedPayable'); expect(c.items.length).toBe(1); expect(c.items[0].resolve).toEqual({ kind: 'ledger-edit', id: 'LZ' }); expect(r.summary.reconBad).toBeGreaterThan(0);
  });
  it('قيد فرق تبادل لتبادل ملغى ← قيد يتيم مع إصلاح بالإلغاء', () => {
    const d = withExchange(); d.events.forEach((e) => { if (e.exchangeId) e.voided = true; }); const r = auditData(d);
    expect(find(r, 'orphanPayable').fix.ops).toEqual([{ col: 'partnerCapitalTransactions', id: 'LX', void: true }]);
  });
});
