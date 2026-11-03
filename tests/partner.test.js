import { describe, it, expect } from 'vitest';
import { partnerDebt, planPartnerRepayment, allocateToLoans, findOrphanCash, partnerLedger } from '../src/lib/finance.js';
const L = (partnerId, type, amount, extra = {}) => ({ partnerId, type, amount, currency: 'SYP', date: '2026-01-01', ...extra });
describe('partnerDebt — كل ما على المزرعة للشريك', () => {
  const led = [L('w', 'loan_given', 1000), L('w', 'loan_principal_repayment', 300), L('w', 'animal_purchase_paid', 5000), L('w', 'animal_purchase_paid', 2000), L('w', 'animal_purchase_repaid', 500),
    L('w', 'expense_paid_personally', 400), L('w', 'additional_capital', 100), L('w', 'reimbursement', 50), L('w', 'withdrawal', 70), L('w', 'profit_distribution', 20),
    L('w', 'animal_purchase_paid', 9, { voided: true }), L('x', 'loan_given', 7), L('w', 'animal_purchase_paid', 8, { currency: 'USD' })];
  it('ثلاثة أبواب + إجمالي، مع تجاهل الملغي/عملة أخرى/شريك آخر', () => {
    expect(partnerDebt('w', led)).toMatchObject({ loans: 700, purchases: 6500, other: 450, total: 7650, withdrawals: 70, distributions: 20 });
  });
  it('رأس المال الابتدائي القديم لا يدخل الحساب (لا في الدين ولا في الدفتر)', () => {
    const withOpening = [...led, L('w', 'capital_contribution', 473000000, { opening: true }), L('w', 'capital_contribution', 999, { animalId: 'A1' })];
    expect(partnerDebt('w', withOpening).total).toBe(7650); expect(partnerLedger('w', withOpening).closing).toBe(partnerLedger('w', led).closing);
  });
  it('كل شراء/قرض يزيد رصيد الشريك تلقائياً في دفتره', () => { expect(partnerLedger('w', [L('w', 'animal_purchase_paid', 100), L('w', 'animal_purchase_repaid', 30)]).closing).toBe(70); });
});
describe('planPartnerRepayment — الأولوية للسلف', () => {
  it('سلف ثم بقر ثم مصروفات', () => {
    expect(planPartnerRepayment({ loans: 700, purchases: 6500, other: 450, amount: 1000 })).toEqual({ toLoans: 700, toPurchases: 300, toOther: 0 });
    expect(planPartnerRepayment({ loans: 700, purchases: 100, other: 450, amount: 1000 })).toEqual({ toLoans: 700, toPurchases: 100, toOther: 200 });
  });
  it('مبلغ أصغر من السلف = كله للسلف', () => { expect(planPartnerRepayment({ loans: 700, purchases: 6500, amount: 400 })).toEqual({ toLoans: 400, toPurchases: 0, toOther: 0 }); });
  it('خيارات: بقر أولاً / باب واحد', () => {
    expect(planPartnerRepayment({ loans: 700, purchases: 600, amount: 1000, order: 'purchases_first' })).toEqual({ toLoans: 400, toPurchases: 600, toOther: 0 });
    expect(planPartnerRepayment({ loans: 700, purchases: 600, amount: 500, order: 'purchases_only' })).toEqual({ toLoans: 0, toPurchases: 500, toOther: 0 });
    expect(planPartnerRepayment({ loans: 0, purchases: 0, other: 90, amount: 90, order: 'other_only' })).toEqual({ toLoans: 0, toPurchases: 0, toOther: 90 });
    expect(() => planPartnerRepayment({ loans: 700, purchases: 600, amount: 800, order: 'purchases_only' })).toThrow(/أكبر/);
  });
  it('يرفض أكبر من المستحق أو صفر', () => { expect(() => planPartnerRepayment({ loans: 1, purchases: 1, amount: 5 })).toThrow(/أكبر/); expect(() => planPartnerRepayment({ loans: 1, purchases: 1, amount: 0 })).toThrow(); });
});
describe('allocateToLoans', () => {
  const loans = [{ id: 'l2', partnerId: 'w', principal: 500, currency: 'SYP', disbursementDate: '2026-03-01' }, { id: 'l1', partnerId: 'w', principal: 300, currency: 'SYP', disbursementDate: '2026-01-01' }, { id: 'lx', partnerId: 'z', principal: 99, currency: 'SYP', disbursementDate: '2026-01-01' }];
  it('الأقدم أولاً ثم الذي يليه', () => { const r = allocateToLoans('w', loans, [], 600); expect(r.parts.map((p) => [p.loan.id, p.principal])).toEqual([['l1', 300], ['l2', 300]]); expect(r.unallocated).toBe(0); });
  it('يراعي ما سُدِّد سابقاً', () => { expect(allocateToLoans('w', loans, [{ loanId: 'l1', principalAmount: 300, date: '2026-02-01' }], 100).parts.map((p) => p.loan.id)).toEqual(['l2']); });
});
describe('findOrphanCash — حركات صندوق أصلها ملغى', () => {
  it('يكشف اليتيم ويتجاهل السليم والملغي', () => {
    const r = findOrphanCash({
      cash: [{ id: 'c1', expensePaymentId: 'p1' }, { id: 'c2', expensePaymentId: 'p2' }, { id: 'c3', customerPaymentId: 'cp1' }, { id: 'c4', type: 'animal_purchase', animalId: 'A' }, { id: 'c5', type: 'animal_purchase', animalId: 'B' }, { id: 'c6', ledgerEntryId: 'L1' }, { id: 'c7', voided: true, expensePaymentId: 'p1' }, { id: 'c8', exchangeId: 'X' }],
      expensePays: [{ id: 'p1', expenseId: 'e1', voided: true }, { id: 'p2', expenseId: 'e2' }], expenses: [{ id: 'e1' }, { id: 'e2', voided: true }], custPays: [{ id: 'cp1', voided: true }],
      animals: [{ id: 'A', voided: true }, { id: 'B' }], ledger: [{ id: 'L1', voided: true }], events: [{ exchangeId: 'X', voided: true }] });
    expect(r.map((x) => x.tx.id)).toEqual(['c1', 'c2', 'c3', 'c4', 'c6', 'c8']);
  });
});
