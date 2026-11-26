import { describe, it, expect } from 'vitest';
import { periodProfit, profitAndLoss, animalPLInputs, stockCosting } from '../src/lib/finance.js';
const d = {
  agreements: [{ id: 'A', customerId: 'c', pricePerLiter: 5000, currency: 'SYP' }],
  deliveries: [{ id: 'D', agreementId: 'A', date: '2026-11-05', qty: 1000 }],
  expenses: [{ id: 'E1', date: '2026-11-01', amount: 1000000, currency: 'SYP', category: 'feed' }, { id: 'E2', date: '2026-11-02', amount: 600000, currency: 'SYP', category: 'wages' }],
  cash: [{ type: 'other_income', date: '2026-11-03', amount: 100000, currency: 'SYP' }],
  events: [{ animalId: 'x', type: 'death', date: '2026-11-10' }],
  animals: [{ id: 'x', acquisitionCost: 1000000, currency: 'SYP' }],
  stockMovements: [{ itemId: 'I', type: 'in', qty: 100, date: '2026-11-01', expenseId: 'E1' }, { itemId: 'I', type: 'out', qty: 40, date: '2026-11-06' }],
};
describe('معاينة ربح الشهر = نفس معادلة التسوية', () => {
  const o = { from: '2026-11-01', to: '2026-11-30', currency: 'SYP' };
  it('حليب 5,000,000 + دخل آخر 100,000 − أجور 600,000 − علف مستهلك 400,000 − نفوق 1,000,000', () => {
    const r = periodProfit(d, o);
    expect(r).toMatchObject({ milkRevenue: 5000000, otherIncome: 100000, stockConsumption: 400000, deathLoss: -1000000, netProfit: 3100000, unconsumed: 600000 });
  });
  it('يطابق تركيب التسوية اليدوي تماماً', () => {
    const ap = animalPLInputs(d.events, d.animals); const c = stockCosting(d.expenses, d.stockMovements);
    const manual = profitAndLoss({ agreements: d.agreements, deliveries: d.deliveries, expenses: d.expenses.filter((e) => !c.linked.has(e.id)), otherIncome: d.cash, animalSales: ap.animalSales, animalPurchases: [], exchangeResults: ap.exchangeResults, deathLosses: ap.deathLosses, stockConsumption: c.consumption, ...o, animalPurchaseAsExpense: false });
    expect(periodProfit(d, o).netProfit).toBe(manual.netProfit);
  });
  it('خيار «عند الشراء» يُدخل العلف كله، والفترة خارج الشهر لا تُحتسب', () => {
    expect(periodProfit(d, { ...o, stockCostingMode: 'purchase' }).netProfit).toBe(5000000 + 100000 - 1000000 - 600000 - 1000000);
    expect(periodProfit(d, { from: '2026-10-01', to: '2026-10-31', currency: 'SYP' }).netProfit).toBe(0);
  });
});
