import { useState } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Card, Table, Badge, Empty, PageHeader, Toast, Field } from '../components/ui';
import { FormModal } from '../components/CrudPage';
import { db, firebaseOptions } from '../lib/firebase';
import { useCol, useAudit, useSettings, saveRecord } from '../data/db';
import { useAuth } from '../data/auth';
import { ROLES } from '../lib/permissions';
import { CURRENCIES } from '../lib/constants';

const ROLE_AR = { admin: 'مدير', accountant: 'محاسب', data_entry: 'مدخل بيانات', viewer: 'مشاهد' };

export function Users() {
  const { user, can } = useAuth(); const users = useCol('users').rows; const [open, setOpen] = useState(false); const [msg, setMsg] = useState('');
  if (!can('manageUsers')) return <Card><Empty title="غير مصرّح" hint="إدارة المستخدمين لمدير النظام فقط." /></Card>;
  const setField = (u, data) => setDoc(doc(db, 'users', u.id), data, { merge: true }).catch(() => {});
  // A secondary Firebase app creates the Auth account so the admin's own session is not replaced.
  const create = async (d) => {
    const sec = initializeApp(firebaseOptions, `sec-${Date.now()}`);
    try { const cred = await createUserWithEmailAndPassword(getAuth(sec), d.email, d.password); await signOut(getAuth(sec));
      await setDoc(doc(db, 'users', cred.user.uid), { name: d.name, email: d.email, role: d.role, active: true, createdAt: serverTimestamp() }); setMsg('تم إنشاء المستخدم'); }
    finally { await deleteApp(sec); }
  };
  return (
    <div>
      <PageHeader title="المستخدمون والصلاحيات" subtitle="الصلاحيات تُفرض في قواعد Firestore وليس في الواجهة فقط"><button className="btn btn-primary" onClick={() => setOpen(true)}>مستخدم جديد</button></PageHeader>
      <Toast msg={msg} tone="green" />
      <Card><Table rows={users} empty={<Empty title="لا يوجد مستخدمون" />} columns={[{ key: 'name', label: 'الاسم' }, { key: 'email', label: 'البريد' },
        { key: 'role', label: 'الدور', render: (u) => <select className="input w-40" value={u.role} disabled={u.id === user.uid} onChange={(e) => setField(u, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select> },
        { key: 'active', label: 'الحالة', render: (u) => <button disabled={u.id === user.uid} onClick={() => setField(u, { active: u.active === false })}><Badge tone={u.active === false ? 'red' : 'green'}>{u.active === false ? 'موقوف' : 'نشط'}</Badge></button> }]} /></Card>
      <FormModal open={open} onClose={() => setOpen(false)} title="مستخدم جديد" fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'email', label: 'البريد الإلكتروني', type: 'text', required: true }, { name: 'password', label: 'كلمة مرور مؤقتة (6+ أحرف)', type: 'text', required: true }, { name: 'role', label: 'الدور', type: 'select', required: true, options: ROLES.map((r) => [r, ROLE_AR[r]]), default: 'viewer' }]} defaults={{ role: 'viewer' }} onSubmit={create} />
    </div>
  );
}

export function Settings() {
  const { user, can } = useAuth(); const s = useSettings(); const [f, setF] = useState(null); const [ok, setOk] = useState('');
  const v = f || s; const set = (k, x) => setF({ ...v, [k]: x });
  const rates = v.rates || {};
  const save = async () => { await saveRecord(user, 'settings', { farmName: v.farmName, baseCurrency: v.baseCurrency, animalPurchaseAsExpense: !!v.animalPurchaseAsExpense, rates, updatedBy: user.uid }, 'main'); setOk('تم الحفظ'); };
  return (
    <div>
      <PageHeader title="الإعدادات" />
      <Toast msg={ok} tone="green" />
      <Card title="إعدادات المزرعة">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المزرعة"><input className="input" value={v.farmName} onChange={(e) => set('farmName', e.target.value)} /></Field>
          <Field label="العملة الأساسية"><select className="input" value={v.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}>{CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></Field>
          <Field label="سعر الصرف USD → SYP (للتحويل الصريح فقط — لا تُجمع العملات تلقائياً)"><input className="input" type="number" dir="ltr" value={rates['USD->SYP'] || ''} onChange={(e) => set('rates', { ...rates, 'USD->SYP': Number(e.target.value) })} /></Field>
          <label className="flex items-center gap-2 pt-6 text-sm font-bold"><input type="checkbox" checked={!!v.animalPurchaseAsExpense} onChange={(e) => set('animalPurchaseAsExpense', e.target.checked)} />احتساب شراء الحيوانات كمصروف في الأرباح (كما في ملف Excel الأصلي)</label>
        </div>
        {can('manageUsers') ? <button className="btn btn-primary mt-4" onClick={save}>حفظ</button> : <p className="mt-3 text-sm text-slate-500">التعديل لمدير النظام فقط.</p>}
      </Card>
      <Card title="الأرصدة الافتتاحية" className="mt-4"><ul className="list-disc space-y-1 pr-5 text-sm text-slate-600"><li>الصناديق: عند إنشاء الحساب أدخل رصيده الافتتاحي (يُسجَّل كحركة «رصيد افتتاحي» لا تُحتسب إيراداً).</li><li>العملاء: حقل «رصيد افتتاحي مدين» في بطاقة العميل.</li><li>الشركاء: رأس المال الابتدائي عند إنشاء الشريك، أو حركة «رصيد افتتاحي» في دفتره.</li><li>المواشي: أضف الحيوان بمصدر «رصيد افتتاحي».</li></ul></Card>
    </div>
  );
}

export function Audit() {
  const rows = useAudit(); const { can } = useAuth();
  const [q, setQ] = useState('');
  const shown = rows.filter((r) => !q || JSON.stringify(r).includes(q));
  return (
    <div>
      <PageHeader title="سجل التدقيق" subtitle="كل إنشاء وتعديل وإلغاء مسجّل ولا يمكن تعديله" />
      <Card><input className="input mb-3 max-w-xs" placeholder="بحث" value={q} onChange={(e) => setQ(e.target.value)} />
        <Table rows={shown} empty={<Empty title="لا توجد أحداث" />} columns={[{ key: 'at', label: 'الوقت', render: (r) => (r.at?.toDate ? r.at.toDate().toLocaleString('en-GB') : '…') }, { key: 'userName', label: 'المستخدم' }, { key: 'action', label: 'الإجراء' }, { key: 'collection', label: 'المجموعة' }, { key: 'docId', label: 'المعرّف' }, { key: 'summary', label: 'التفاصيل', render: (r) => <span className="line-clamp-1 max-w-xs text-xs text-slate-500">{r.summary}</span> }]} /></Card>
    </div>
  );
}
