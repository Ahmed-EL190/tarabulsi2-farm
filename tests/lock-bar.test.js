// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
const saveRecord = vi.fn(async () => {}); let SETTINGS = {}; let ROLE = 'admin';
vi.mock('../src/data/db', () => ({ useCol: () => ({ rows: [], loading: false }), useSettings: () => SETTINGS, useCustomLists: () => ({}), saveRecord: (...a) => saveRecord(...a), commit: vi.fn(), voidRecord: vi.fn(), newId: vi.fn(), nextNumber: vi.fn() }));
vi.mock('../src/data/auth', () => ({ useAuth: () => ({ user: { uid: 'u', role: ROLE }, can: (a) => ROLE === 'admin' || a === 'create' }) }));
vi.mock('firebase/firestore', () => ({ serverTimestamp: () => 'TS', writeBatch: vi.fn() }));
vi.mock('../src/lib/firebase', () => ({ db: {} }));
const { Settlements } = await import('../src/pages/Finance.jsx');
beforeEach(() => { saveRecord.mockClear(); SETTINGS = {}; ROLE = 'admin'; });
describe('شريط قفل الفترات في التسويات', () => {
  it('بلا قفل: رسالة توضيحية، والمدير يقفل بتاريخ وسبب', async () => {
    render(React.createElement(Settlements));
    expect(document.body.textContent).toContain('لا توجد فترة مقفلة بعد');
    fireEvent.click(screen.getByText('تعديل القفل'));
    fireEvent.change(document.querySelector('input[type="date"]'), { target: { value: '2026-10-31' } });
    fireEvent.change(document.querySelector('input[type="text"]'), { target: { value: 'إقفال أكتوبر' } });
    fireEvent.click(screen.getByText('حفظ')); await waitFor(() => expect(saveRecord).toHaveBeenCalled());
    expect(saveRecord.mock.calls[0].slice(1)).toEqual(['settings', { lockedThrough: '2026-10-31', lockNote: 'إقفال أكتوبر' }, 'main']);
    cleanup();
  });
  it('مع قفل: تظهر الفترة المقفلة، ولغير المدير لا يوجد زر تعديل', () => {
    SETTINGS = { lockedThrough: '2026-10-31' }; ROLE = 'accountant';
    render(React.createElement(Settlements));
    expect(document.body.textContent).toContain('2026-10-31'); expect(document.body.textContent).toContain('مقفلة بعد اعتماد التسوية');
    expect(screen.queryByText('تعديل القفل')).toBeNull(); cleanup();
  });
});
