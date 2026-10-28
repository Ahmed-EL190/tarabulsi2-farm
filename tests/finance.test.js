import { describe, it, expect } from 'vitest';
import * as F from '../src/lib/finance.js';
import { can } from '../src/lib/permissions.js';

const ag = (o = {}) => ({ id: 'A1', customerId: 'C1', date: '2026-01-01', agreedQty: 1000, pricePerLiter: 10, currency: 'SYP', ...o });
const dl = (id, date, qty) => ({ id, agreementId: 'A1', date, qty });
const pay = (id, date, amount, o = {}) => ({ id, agreementId: 'A1', customerId: 'C1', date, amount, ...o });

describe('milk agreements', () => {
  it('1 full payment + immediate delivery', () => {
    const p = F.agreementPosition(ag({ agreedQty: 100 }), [dl('d1', '2026-01-01', 100)], [pay('p1', '2026-01-01', 1000)]);
    expect(p.receivable).toBe(0); expect(p.unappliedCredit).toBe(0); expect(p.paymentStatus).toBe('paid'); expect(p.status).toBe('fulfilled');
  });
  it('2 partial payment leaves receivable', () => {
    const p = F.agreementPosition(ag(), [dl('d1', '2026-01-01', 100)], [pay('p1', '2026-01-01', 400)]);
    expect(p.receivable).toBe(600); expect(p.paymentStatus).toBe('partial');
  });
  it('3 advance before delivery is credit, not revenue', () => {
    const p = F.agreementPosition(ag(), [], [pay('p1', '2026-01-01', 3000)]);
    expect(p.deliveredValue).toBe(0); expect(p.unappliedCredit).toBe(3000); expect(p.paymentStatus).toBe('advance');
    const pl = F.profitAndLoss({ agreements: [ag()], deliveries: [] });
    expect(pl.revenue).toBe(0);
  });
  it('4 delivery days after advance consumes credit', () => {
    const p = F.agreementPosition(ag(), [dl('d1', '2026-01-08', 200)], [pay('p1', '2026-01-01', 3000)]);
    expect(p.unappliedCredit).toBe(1000); expect(p.receivable).toBe(0); expect(p.remainingQty).toBe(800);
  });
  it('5 multiple deliveries, remaining quantity', () => {
    const p = F.agreementPosition(ag(), [dl('d1', '2026-01-02', 300), dl('d2', '2026-01-05', 250)], []);
    expect(p.deliveredQty).toBe(550); expect(p.remainingQty).toBe(450); expect(p.deliveredValue).toBe(5500); expect(p.status).toBe('in_progress');
  });
  it('6 multiple payments allocate FIFO', () => {
    const p = F.agreementPosition(ag(), [dl('d1', '2026-01-02', 100), dl('d2', '2026-01-03', 100)], [pay('p1', '2026-01-02', 1000), pay('p2', '2026-01-04', 500)]);
    expect(p.allocations.map((a) => a.paid)).toEqual([1000, 500]); expect(p.receivable).toBe(500);
  });
  it('7 excess advance stays as credit; refund reduces it', () => {
    let p = F.agreementPosition(ag(), [dl('d1', '2026-01-02', 100)], [pay('p1', '2026-01-01', 5000)]);
    expect(p.unappliedCredit).toBe(4000);
    p = F.agreementPosition(ag(), [dl('d1', '2026-01-02', 100)], [pay('p1', '2026-01-01', 5000), pay('r1', '2026-01-03', 1500, { type: 'refund' })]);
    expect(p.unappliedCredit).toBe(2500);
  });
  it('8 unpaid delivery', () => {
    const p = F.agreementPosition(ag(), [dl('d1', '2026-01-02', 100)], []);
    expect(p.receivable).toBe(1000); expect(p.paymentStatus).toBe('unpaid');
  });
  it('rejects over-delivery', () => {
    expect(F.validateDelivery(ag(), [dl('d1', '2026-01-02', 900)], 200).ok).toBe(false);
    expect(F.validateDelivery(ag(), [dl('d1', '2026-01-02', 900)], 100).ok).toBe(true);
  });
  it('customer with several agreements + unlinked payment', () => {
    const a2 = ag({ id: 'A2', date: '2026-02-01' });
    const ds = [dl('d1', '2026-01-02', 100), { id: 'd2', agreementId: 'A2', date: '2026-02-02', qty: 100 }];
    const cp = F.customerPosition('C1', { agreements: [ag(), a2], deliveries: ds, payments: [{ id: 'g', customerId: 'C1', date: '2026-02-03', amount: 1500 }] });
    expect(cp.receivable).toBe(500); expect(cp.unappliedCredit).toBe(0);
  });
  it('statement opening/closing balance', () => {
    const s = F.customerStatement('C1', { agreements: [ag()], deliveries: [dl('d1', '2026-01-02', 100), dl('d2', '2026-02-02', 100)], payments: [pay('p1', '2026-01-10', 400)], from: '2026-02-01', to: '2026-02-28' });
    expect(s.opening).toBe(600); expect(s.closing).toBe(1600);
  });
});

describe('partner loans, capital, expenses', () => {
  const loan = { id: 'L1', partnerId: 'P1', principal: 10000, disbursementDate: '2026-01-01', interestRate: 0, adjustments: [] };
  it('9/10 disbursement and partial principal repayments', () => {
    const r = [{ loanId: 'L1', date: '2026-02-01', principalAmount: 3000, interestAmount: 0 }, { loanId: 'L1', date: '2026-03-01', principalAmount: 2000, interestAmount: 0 }];
    const p = F.loanPosition(loan, r, '2026-04-01');
    expect(p.outstandingPrincipal).toBe(5000); expect(p.principalRepaid).toBe(5000);
  });
  it('11 interest payments never reduce principal', () => {
    const l = { ...loan, interestRate: 10 };
    const p = F.loanPosition(l, [{ loanId: 'L1', date: '2026-07-01', principalAmount: 0, interestAmount: 400 }], '2027-01-01');
    expect(p.outstandingPrincipal).toBe(10000); expect(p.interestAccrued).toBe(1000); expect(p.interestDue).toBe(600);
  });
  it('principal adjustments are authorised additions', () => {
    const p = F.loanPosition({ ...loan, adjustments: [{ date: '2026-02-01', amount: 500 }] }, [], '2026-03-01');
    expect(p.outstandingPrincipal).toBe(10500);
  });
  it('12/13 partner-funded expense recorded once, linked to ledger', () => {
    const e = { id: 'E1', date: '2026-01-05', amount: 800, currency: 'SYP', category: 'feed' };
    const pm = { id: 'X1', partnerId: 'P1', date: '2026-01-05', amount: 800 };
    const entry = F.partnerFundedExpenseEntry(e, pm);
    expect(entry.type).toBe('expense_paid_personally'); expect(entry.expenseId).toBe('E1');
    const pl = F.profitAndLoss({ expenses: [e] });
    expect(pl.operatingExpenses).toBe(800); // not 1600
    expect(F.validateExpensePayment(e, [{ expenseId: 'E1', amount: 800 }], 1).ok).toBe(false); // no double-pay
    expect(F.expensePosition(e, [{ expenseId: 'E1', amount: 300 }]).status).toBe('partial');
  });
  it('loan repayments / withdrawals excluded from operating expenses', () => {
    const ex = [{ id: 1, date: '2026-01-01', amount: 100, currency: 'SYP', category: 'feed' }, { id: 2, date: '2026-01-01', amount: 999, currency: 'SYP', category: 'loan_principal' }, { id: 3, date: '2026-01-01', amount: 50, currency: 'SYP', category: 'partner_withdrawal' }];
    expect(F.profitAndLoss({ expenses: ex }).operatingExpenses).toBe(100);
  });
  it('14 capital vs loan are separate ledger types', () => {
    const e = [{ partnerId: 'P1', date: '2026-01-01', type: 'capital_contribution', amount: 1000, currency: 'SYP' }, { partnerId: 'P1', date: '2026-01-02', type: 'loan_given', amount: 500, currency: 'SYP' }, { partnerId: 'P1', date: '2026-01-03', type: 'loan_principal_repayment', amount: 200, currency: 'SYP' }];
    const l = F.partnerLedger('P1', e);
    expect(l.totals.capital_contribution).toBe(1000); expect(l.totals.loan_given).toBe(500); expect(l.closing).toBe(1300);
  });
  it('15 allocation differs from cash distribution', () => {
    const ps = [{ id: 'P1', profitSharePct: 50 }, { id: 'P2', profitSharePct: 50 }];
    const alloc = F.allocateProfit(1000, ps);
    const entries = alloc.map((a) => ({ partnerId: a.partnerId, date: '2026-12-31', type: 'profit_allocation', amount: a.amount, currency: 'SYP' }));
    expect(F.partnerLedger('P1', entries).closing).toBe(500);
    expect(F.cashBalances([])).toEqual({}); // allocation created no cash movement
    entries.push({ partnerId: 'P1', date: '2027-01-02', type: 'profit_distribution', amount: 200, currency: 'SYP' });
    expect(F.partnerLedger('P1', entries).closing).toBe(300);
  });
  it('allocation sums exactly and validates 100%', () => {
    const a = F.allocateProfit(100, [{ id: 'a', profitSharePct: 33.33 }, { id: 'b', profitSharePct: 33.33 }, { id: 'c', profitSharePct: 33.34 }]);
    expect(a.reduce((s, x) => s + x.amount, 0)).toBe(100);
    expect(() => F.allocateProfit(100, [{ id: 'a', profitSharePct: 60 }])).toThrow();
  });
});

describe('cash, currencies', () => {
  it('16 currencies never mixed', () => {
    const s = F.sumByCurrency([{ amount: 100, currency: 'SYP' }, { amount: 5, currency: 'USD' }, { amount: 50, currency: 'SYP' }]);
    expect(s).toEqual({ SYP: 150, USD: 5 });
    expect(() => F.convert(5, 'USD', 'SYP', {})).toThrow();
    expect(F.convert(5, 'USD', 'SYP', { 'USD->SYP': 13000 })).toBe(65000);
  });
  it('17 transfers are not income or expense', () => {
    const t = F.makeTransfer({ id: 'T', date: '2026-01-01', fromAccountId: 'cash', toAccountId: 'bank', amount: 500, currency: 'SYP' });
    const base = [{ id: 'o', date: '2026-01-01', type: 'opening_balance', accountId: 'cash', amount: 1000, currency: 'SYP' }];
    const b = F.cashBalances([...base, ...t]);
    expect(b['cash|SYP']).toBe(500); expect(b['bank|SYP']).toBe(500);
    const cf = F.cashFlowSummary(t); expect(cf.totalIn).toBe(0); expect(cf.totalOut).toBe(0);
  });
  it('balances are per account and currency', () => {
    const b = F.cashBalances([{ accountId: 'c', currency: 'SYP', type: 'customer_payment', amount: 10 }, { accountId: 'c', currency: 'USD', type: 'customer_payment', amount: 1 }, { accountId: 'c', currency: 'SYP', type: 'expense_payment', amount: 4 }]);
    expect(b).toEqual({ 'c|SYP': 6, 'c|USD': 1 });
  });
});

describe('animals', () => {
  it('18 purchase, birth, death, sale, exchange', () => {
    const ev = [{ animalId: 'A1', type: 'purchase', date: '2026-01-01' }, { animalId: 'A2', type: 'birth', date: '2026-01-02' }, { animalId: 'A3', type: 'purchase', date: '2026-01-03' }, { animalId: 'A2', type: 'death', date: '2026-02-01' }, { animalId: 'A3', type: 'sale', date: '2026-02-02' }];
    expect(F.activeHerdCount(ev)).toBe(1);
    const x = F.animalExchange({ date: '2026-03-01', oldAnimalId: 'A1', newAnimalId: 'A4', oldValue: 100, newValue: 150, currency: 'SYP' });
    expect(x.cashDifference).toBe(50); expect(x.cash[0].direction).toBe('out');
    expect(F.activeHerdCount([...ev, ...x.events])).toBe(1);
  });
  it('duplicate tag prevented', () => {
    expect(F.validateNewAnimal('a001 ', [{ tag: 'A001' }]).ok).toBe(false);
    expect(F.validateNewAnimal('A002', [{ tag: 'A001' }]).ok).toBe(true);
  });
});

describe('reconciliation, empty db, permissions', () => {
  it('19 monthly P&L reconciles with components', () => {
    const pl = F.profitAndLoss({ agreements: [ag()], deliveries: [dl('d1', '2026-03-05', 100)], expenses: [{ id: 'e', date: '2026-03-06', amount: 300, currency: 'SYP', category: 'feed' }],
      otherIncome: [{ date: '2026-03-07', amount: 50, currency: 'SYP' }], animalSales: [{ date: '2026-03-08', amount: 700, currency: 'SYP' }], from: '2026-03-01', to: '2026-03-31' });
    expect(pl.revenue).toBe(1750); expect(pl.netProfit).toBe(1450);
  });
  it('20 empty database yields zeros', () => {
    const pl = F.profitAndLoss({}); expect(pl.netProfit).toBe(0);
    expect(F.activeHerdCount([])).toBe(0); expect(F.cashBalances([])).toEqual({});
    expect(F.customerPosition('x', {}).receivable).toBe(0);
  });
  it('21 role permissions', () => {
    expect(can('viewer', 'create')).toBe(false); expect(can('data_entry', 'update')).toBe(false);
    expect(can('accountant', 'finalizeSettlement')).toBe(false); expect(can('admin', 'manageUsers')).toBe(true);
    expect(can('nobody', 'read')).toBe(false);
  });
});

describe('all sales + animal profile', () => {
  it('unified sales ledger: milk + animal + other, per currency', () => {
    const rows = F.salesLedger({
      agreements: [ag()], deliveries: [dl('d1', '2026-03-01', 100)],
      animalEvents: [{ id: 'e1', type: 'sale', animalId: 'X', tag: 'A001', date: '2026-03-02', value: 5000, currency: 'SYP' }, { id: 'e2', type: 'sale', animalId: 'Y', date: '2026-03-02', value: 10, currency: 'USD' }, { id: 'e3', type: 'purchase', date: '2026-03-02', value: 999, currency: 'SYP' }],
      cashTransactions: [{ id: 't1', type: 'other_income', date: '2026-03-03', amount: 300, currency: 'SYP' }, { id: 't2', type: 'customer_payment', date: '2026-03-03', amount: 700, currency: 'SYP' }],
    });
    expect(rows.map((r) => r.kind)).toEqual(['milk', 'animal', 'animal', 'other']); // purchases and payments are not sales
    const t = F.salesTotals(rows);
    expect(t.total).toEqual({ SYP: 6300, USD: 10 }); expect(t.byKind.milk).toEqual({ SYP: 1000 });
    expect(F.salesLedger({ animalEvents: [{ id: 'e1', type: 'sale', date: '2026-03-02', value: 5, currency: 'SYP' }] }, { from: '2026-04-01' })).toEqual([]);
  });
  it('animal profile: age, milk per cow, treatment cost, sale result', () => {
    const a = { id: 'A1', tag: 'A001', acquisitionCost: 20000, acquisitionDate: '2026-01-01', ageAtPurchaseMonths: 24 };
    const p = F.animalProfile(a, {
      events: [{ animalId: 'A1', type: 'sale', date: '2026-07-01', value: 26000 }],
      production: [{ animalId: 'A1', date: '2026-02-01', liters: 10 }, { animalId: 'A1', date: '2026-02-02', liters: 20 }, { group: 'A001', date: '2026-02-03', liters: 30 }, { animalId: 'B', date: '2026-02-01', liters: 99 }],
      expenses: [{ animalId: 'A1', category: 'vet', amount: 500 }, { animalId: 'A1', category: 'feed', amount: 900 }],
    });
    expect(p.milkTotal).toBe(60); expect(p.milkDays).toBe(3); expect(p.milkAvg).toBe(20);
    expect(p.treatmentCost).toBe(500); expect(p.saleResult).toBe(6000); expect(p.ageMonths).toBe(24 + 5);
  });
});
