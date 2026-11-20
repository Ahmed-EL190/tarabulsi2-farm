// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import React from 'react';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
const DATA = { things: [{ id: '1', name: 'بقرة 1', amount: 5, kind: 'b', motherId: 'm1', date: '2026-01-01', notes: 'ملاحظة قديمة' }, { id: 'm1', name: 'الأم', amount: 0, kind: 'a', date: '2026-01-01' }] };
vi.mock('../src/data/db', () => ({ useCol: (c) => ({ rows: DATA[c] || [], loading: false }), saveRecord: vi.fn(async () => {}), voidRecord: vi.fn(), useSettings: () => ({}) }));
vi.mock('../src/data/auth', () => ({ useAuth: () => ({ user: { uid: 'u' }, can: () => true }) }));
const CrudPage = (await import('../src/components/CrudPage.jsx')).default;
const fields = [{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', min: 0 }, { name: 'kind', label: 'النوع', type: 'select', options: [['a', 'أ'], ['b', 'ب']], required: true },
  { name: 'motherId', label: 'الأم', type: 'rel', col: 'things' }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }];
describe('نافذة التعديل تعرض بيانات السجل', () => {
  it('تفتح مملوءة بالقيم المحفوظة', async () => {
    render(React.createElement(CrudPage, { title: 'x', col: 'things', fields, cols: () => [{ key: 'name', label: 'الاسم' }], defaults: {} }));
    fireEvent.click(screen.getAllByTitle('تعديل')[0]);
    await waitFor(() => expect(screen.getByDisplayValue('بقرة 1')).toBeTruthy());
    expect(screen.getByDisplayValue('5')).toBeTruthy(); expect(screen.getByDisplayValue('ملاحظة قديمة')).toBeTruthy();
    const sels = [...document.querySelectorAll('select')].map((s) => s.value); console.log('SELECT VALUES', sels);
    expect(sels).toContain('b'); expect(sels).toContain('m1');
    expect(document.querySelector('input[type=date]').value).toBe('2026-01-01');
    cleanup();
  });
  it('تعرض لوحة البيانات الحالية والحقول الثابتة للقراءة فقط', async () => {
    render(React.createElement(CrudPage, { title: 'x', col: 'things', fields, cols: () => [{ key: 'name', label: 'الاسم' }], defaults: {}, createOnlyFields: ['kind'], editIntro: (r) => React.createElement('div', null, `لوحة: ${r.name}`) }));
    fireEvent.click(screen.getAllByTitle('تعديل')[0]);
    await waitFor(() => expect(screen.getByText('لوحة: بقرة 1')).toBeTruthy());
    expect(document.body.textContent).toContain('بيانات ثابتة لا تُعدَّل'); expect(document.body.textContent).toContain('النوع: ب');
    cleanup();
  });
});
