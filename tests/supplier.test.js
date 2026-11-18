import { describe, it, expect } from 'vitest';
import { customerStatement, supplierPayable } from '../src/lib/finance.js';
const base = { agreements: [], deliveries: [], payments: [] };
const E = [{ id: 'E1', supplierId: 'c1', amount: 1000, currency: 'SYP', date: '2026-05-01', description: 'علف' }, { id: 'E2', supplierId: 'c1', amount: 500, currency: 'SYP', date: '2026-05-10', description: 'تبن' }, { id: 'E3', supplierId: 'c2', amount: 99, currency: 'SYP', date: '2026-05-02' }, { id: 'E4', supplierId: 'c1', amount: 77, currency: 'SYP', date: '2026-05-03', voided: true }];
const EP = [{ id: 'P1', expenseId: 'E1', date: '2026-05-05', amount: 400 }, { id: 'P2', expenseId: 'E1', date: '2026-05-06', amount: 100, voided: true }];
describe('المورّد من قائمة العملاء', () => {
  it('الكشف: فواتير شرائنا منه ← له علينا، وما دفعناه ← عليه، والصافي سالب = له عندنا', () => {
    const st = customerStatement('c1', { ...base, expenses: E, expensePayments: EP });
    expect(st.rows.map((r) => r.kind)).toEqual(['purchase', 'supplier_payment', 'purchase']);
    expect(st.totalCredit).toBe(1500); expect(st.totalDebit).toBe(400); expect(st.closing).toBe(-1100);
  });
  it('رصيده كعميل حليب يُجمَع مع المشتريات في كشف واحد', () => {
    const st = customerStatement('c1', { agreements: [{ id: 'A', customerId: 'c1', pricePerLiter: 10, agreedQty: 500 }], deliveries: [{ id: 'D', agreementId: 'A', date: '2026-05-02', qty: 100 }], payments: [], expenses: E, expensePayments: EP });
    expect(st.closing).toBe(-100); // باع لنا بـ1500 وأخذ منا حليباً بـ1000 ودفعنا 400
  });
  it('ما علينا له بعملة واحدة، دون الملغى', () => {
    expect(supplierPayable('c1', E, EP, 'SYP')).toBe(1100); expect(supplierPayable('c1', E, EP, 'USD')).toBe(0); expect(supplierPayable('c2', E, EP)).toBe(99);
  });
  it('الكشف القديم بلا مصروفات لا يتغير', () => { expect(customerStatement('c1', base).closing).toBe(0); });
});
