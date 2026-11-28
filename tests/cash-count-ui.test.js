// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
const DATA = {
  cashAccounts: [{ id: 'a1', name: 'الصندوق الرئيسي' }],
  cashTransactions: [{ id: 't1', accountId: 'a1', currency: 'SYP', amount: 1000, direction: 'in', type: 'opening_balance', date: '2026-01-01' }],
  cashCounts: [],
};
const saveRecord = vi.fn(async () => {}); const commit = vi.fn(async () => []);
let ROLE = 'admin';
vi.mock('../src/data/db', () => ({ useCol: (c) => ({ rows: DATA[c] || [], loading: false }), useSettings: () => ({}), useCustomLists: () => ({}), saveRecord: (...a) => saveRecord(...a), commit: (...a) => commit(...a), voidRecord: vi.fn(), newId: vi.fn(), nextNumber: vi.fn() }));
vi.mock('../src/data/auth', () => ({ useAuth: () => ({ user: { uid: 'u', name: 'أحمد', role: ROLE }, can: (a) => (ROLE === 'admin' ? true : a === 'create') }) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS', writeBatch: vi.fn() }));
vi.mock('../src/lib/firebase', () => ({ db: {} }));
const { Cash } = await import('../src/pages/Finance.jsx');
beforeEach(() => { saveRecord.mockClear(); commit.mockClear(); ROLE = 'admin'; });

describe('جرد الصندوق (واجهة)', () => {
  it('يعرض الرصيد، ويحسب العجز، ويحفظ الجرد', async () => {
    render(React.createElement(Cash));
    fireEvent.click(screen.getByText('جرد الصندوق'));
    expect(document.body.textContent).toContain('لم يُجرَد بعد');
    fireEvent.click(screen.getByText('جرد الآن'));
    const input = document.querySelector('input[inputmode="decimal"]'); fireEvent.change(input, { target: { value: '900' } });
    await waitFor(() => expect(document.body.textContent).toContain('عجز في الصندوق: 100'));
    fireEvent.click(screen.getByText('حفظ الجرد'));
    await waitFor(() => expect(saveRecord).toHaveBeenCalled());
    expect(saveRecord.mock.calls[0][1]).toBe('cashCounts'); expect(saveRecord.mock.calls[0][2]).toMatchObject({ accountId: 'a1', countedAmount: 900, systemBalance: 1000, difference: -100, adjusted: false });
    cleanup();
  });
  it('مدير النظام يسوّي الفرق: حفظ الجرد وحركة الصندوق في عملية واحدة', async () => {
    render(React.createElement(Cash));
    fireEvent.click(screen.getByText('جرد الصندوق')); fireEvent.click(screen.getByText('جرد الآن'));
    fireEvent.change(document.querySelector('input[inputmode="decimal"]'), { target: { value: '1050' } });
    await waitFor(() => expect(document.body.textContent).toContain('زيادة في الصندوق: 50'));
    fireEvent.click(document.querySelector('input[type="checkbox"]')); fireEvent.click(screen.getByText('حفظ الجرد'));
    await waitFor(() => expect(commit).toHaveBeenCalled());
    const ops = commit.mock.calls[0][1]; expect(ops.map((o) => o.col)).toEqual(['cashCounts', 'cashTransactions']);
    expect(ops[0].data).toMatchObject({ difference: 50, adjusted: true }); expect(ops[1].data).toMatchObject({ type: 'cash_count_adjustment', direction: 'in', amount: 50, accountId: 'a1' });
    cleanup();
  });
  it('غير المدير لا يرى خيار التسوية، ويُرفض جرد بلا مبلغ', async () => {
    ROLE = 'data_entry'; render(React.createElement(Cash));
    fireEvent.click(screen.getByText('جرد الصندوق')); fireEvent.click(screen.getByText('جرد الآن'));
    fireEvent.click(screen.getByText('حفظ الجرد')); await waitFor(() => expect(document.body.textContent).toContain('أدخل المبلغ الفعلي'));
    fireEvent.change(document.querySelector('input[inputmode="decimal"]'), { target: { value: '800' } });
    await waitFor(() => expect(document.body.textContent).toContain('تسويته بحركة صندوق لمدير النظام')); expect(document.querySelector('input[type="checkbox"]')).toBeNull();
    cleanup();
  });
});
