// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
const T = (s) => ({ toDate: () => new Date(s * 1000), seconds: s });
const ROWS = [
  { id: '4', at: T(1795000200), uid: 'u', userName: 'Ahmed', action: 'void', collection: 'stockMovements', docId: 'S1', summary: '{"voided":true,"voidReason":"خطأ"}' },
  { id: '3', at: T(1795000200), uid: 'u', userName: 'Ahmed', action: 'void', collection: 'calfLogs', docId: 'L1', summary: '{"voided":true,"voidReason":"خطأ"}' },
  { id: '2', at: T(1795000100), uid: 'u', userName: 'Ahmed', action: 'create', collection: 'stockMovements', docId: 'S1', summary: '{"itemName":"علف مركز","type":"out","qty":20}' },
  { id: '1', at: T(1795000100), uid: 'u', userName: 'Ahmed', action: 'create', collection: 'calfLogs', docId: 'L1', summary: '{"tag":"A14","type":"feed","qty":20,"unit":"كغ"}' },
];
vi.mock('../src/data/db', () => ({ useAudit: () => ROWS, useCol: () => ({ rows: [], loading: false }), useSettings: () => ({}), useCustomLists: () => ({}), saveRecord: vi.fn() }));
vi.mock('../src/data/auth', () => ({ useAuth: () => ({ user: { uid: 'u' }, can: () => true }) }));
vi.mock('../src/lib/firebase', () => ({ db: {}, firebaseOptions: {} }));
vi.mock('firebase/app', () => ({ initializeApp: vi.fn(), deleteApp: vi.fn() }));
vi.mock('firebase/auth', () => ({ getAuth: vi.fn(), createUserWithEmailAndPassword: vi.fn(), signOut: vi.fn() }));
vi.mock('firebase/firestore', () => ({ doc: vi.fn(), setDoc: vi.fn(), serverTimestamp: vi.fn() }));
vi.mock('../src/data/ops', () => ({ addCustomCategory: vi.fn(), saveCustomCategories: vi.fn() }));
const { Audit } = await import('../src/pages/Admin.jsx');
describe('صفحة سجل التدقيق', () => {
  it('تعرض عمليتين بالعربية، وتفتح التفاصيل، وتفلتر بالإجراء', () => {
    render(React.createElement(Audit));
    expect(document.body.textContent).toContain('إلغاء سجل تسمين: علف — 20 كغ — للعجل A14');
    expect(document.body.textContent).toContain('إضافة سجل تسمين');
    expect(document.body.textContent).toContain('السبب: خطأ');
    fireEvent.click(screen.getAllByText(/التفاصيل/)[0]);
    expect(document.body.textContent).toContain('إلغاء حركة مخزون: صادر — 20 علف مركز');
    fireEvent.change(document.querySelectorAll('select')[2], { target: { value: 'create' } });
    expect(document.body.textContent).not.toContain('إلغاء سجل تسمين');
    cleanup();
  });
});
