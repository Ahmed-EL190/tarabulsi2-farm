import { useState, useMemo } from 'react';
import { initializeApp, deleteApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { Card, Table, Badge, Empty, PageHeader, Toast, Field } from '../components/ui';
import { FormModal } from '../components/CrudPage';
import { db, firebaseOptions } from '../lib/firebase';
import { useCol, useAudit, useSettings, useCustomLists, saveRecord } from '../data/db';
import { addCustomCategory, saveCustomCategories } from '../data/ops';
import { useAuth } from '../data/auth';
import { ROLES } from '../lib/permissions';
import { normNum } from '../lib/num';
import { CURRENCIES, EXPENSE_CATEGORIES, ANIMAL_CATEGORIES } from '../lib/constants';
import { buildOperations, ACTION_AR, ACTION_TONE, AREAS } from '../lib/auditText';
import { MONTHS_AR } from '../lib/finance';
import { Pencil, Trash2 } from 'lucide-react';

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
        { key: 'role', label: 'الدور', render: (u) => <select className="input w-full sm:w-40" value={u.role} disabled={u.id === user.uid} onChange={(e) => setField(u, { role: e.target.value })}>{ROLES.map((r) => <option key={r} value={r}>{ROLE_AR[r]}</option>)}</select> },
        { key: 'active', label: 'الحالة', render: (u) => <button disabled={u.id === user.uid} onClick={() => setField(u, { active: u.active === false })}><Badge tone={u.active === false ? 'red' : 'green'}>{u.active === false ? 'موقوف' : 'نشط'}</Badge></button> }]} /></Card>
      <FormModal open={open} onClose={() => setOpen(false)} title="مستخدم جديد" fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'email', label: 'البريد الإلكتروني', type: 'text', required: true }, { name: 'password', label: 'كلمة مرور مؤقتة (6+ أحرف)', type: 'text', required: true }, { name: 'role', label: 'الدور', type: 'select', required: true, options: ROLES.map((r) => [r, ROLE_AR[r]]), default: 'viewer' }]} defaults={{ role: 'viewer' }} onSubmit={create} />
    </div>
  );
}

/** قسم لإدارة فئات قائمة واحدة: عرض الأساسية، وإضافة/إعادة تسمية/حذف الفئات المخصّصة. */
function CatSection({ kind, title, hint, base, custom, usedCount, user, canEdit }) {
  const [label, setLabel] = useState(''); const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const run = async (fn) => { setErr(''); setBusy(true); try { await fn(); } catch (e) { setErr(e.message); } setBusy(false); };
  return (
    <div className="rounded-xl border border-slate-100 p-3">
      <div className="mb-1 text-sm font-extrabold text-slate-800">{title}</div>
      <div className="mb-2 text-xs text-slate-500">{hint}</div>
      <div className="mb-3 flex flex-wrap gap-1.5">{base.map(([k, l]) => <span key={k} className="rounded-full bg-slate-100 px-2.5 py-1 text-xs text-slate-600">{l}</span>)}</div>
      {custom.length > 0 && <ul className="mb-3 divide-y divide-slate-100 rounded-lg border border-slate-100">{custom.map((c) => (
        <li key={c.id} className="flex items-center justify-between gap-2 px-3 py-2 text-sm"><span className="min-w-0 break-words font-bold">{c.label}<span className="mr-2 text-xs font-normal text-slate-400">({usedCount(c.id)} سجل)</span></span>
          {canEdit && <span className="flex shrink-0 gap-1">
            <button className="rounded p-1.5 hover:bg-slate-100" title="إعادة تسمية" onClick={() => { const n = prompt('الاسم الجديد للفئة', c.label); if (n && n.trim() && n.trim() !== c.label) run(() => saveCustomCategories(user, kind, custom.map((x) => (x.id === c.id ? { ...x, label: n.trim() } : x)))); }}><Pencil size={15} /></button>
            <button className="rounded p-1.5 text-rose-600 hover:bg-rose-50" title="حذف" onClick={() => run(async () => { const n = usedCount(c.id); if (n > 0) throw new Error(`لا يمكن حذف «${c.label}»: مستخدمة في ${n} سجل. غيّر فئة هذه السجلات أولاً.`); if (confirm(`حذف الفئة «${c.label}»؟`)) await saveCustomCategories(user, kind, custom.filter((x) => x.id !== c.id)); })}><Trash2 size={15} /></button></span>}
        </li>))}</ul>}
      {canEdit && <div className="flex gap-2"><input className="input" placeholder="اسم فئة جديدة" value={label} onChange={(e) => setLabel(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') e.preventDefault(); }} />
        <button className="btn btn-primary shrink-0" disabled={busy || !label.trim()} onClick={() => run(async () => { await addCustomCategory(user, kind, label, custom); setLabel(''); })}>إضافة</button></div>}
      {err && <div className="mt-2 text-sm font-bold text-red-600">{err}</div>}
    </div>
  );
}
function ListsManager() {
  const { user, can } = useAuth(); const lists = useCustomLists(); const exps = useCol('expenses').rows.filter((e) => !e.voided); const animals = useCol('animals').rows.filter((x) => !x.voided);
  return (
    <Card title="إدارة القوائم (فئات إضافية)" className="mt-4">
      <p className="mb-3 text-xs text-slate-500">أضف فئات جديدة تظهر مباشرة في القوائم المنسدلة. يمكنك أيضاً إضافتها من نفس الفورم بالاختيار «➕ فئة جديدة…».</p>
      <div className="grid gap-3 lg:grid-cols-2">
        <CatSection kind="expense" title="فئات المصروفات" hint="الفئات المضافة تُحتسب كمصروف تشغيلي في الأرباح." base={EXPENSE_CATEGORIES} custom={lists.expense} usedCount={(id) => exps.filter((e) => e.category === id).length} user={user} canEdit={can('create')} />
        <CatSection kind="animal" title="فئات الحيوانات" hint="تظهر عند إضافة/تعديل الحيوان وفي التقارير." base={ANIMAL_CATEGORIES} custom={lists.animal} usedCount={(id) => animals.filter((x) => x.category === id).length} user={user} canEdit={can('create')} />
      </div>
    </Card>
  );
}
export function Settings() {
  const { user, can } = useAuth(); const s = useSettings(); const [f, setF] = useState(null); const [ok, setOk] = useState('');
  const v = f || s; const set = (k, x) => setF({ ...v, [k]: x });
  const rates = v.rates || {};
  const save = async () => { await saveRecord(user, 'settings', { farmName: v.farmName, baseCurrency: v.baseCurrency, rates, stockCostingMode: v.stockCostingMode || 'consumption', updatedBy: user.uid }, 'main'); setOk('تم الحفظ'); };
  return (
    <div>
      <PageHeader title="الإعدادات" />
      <Toast msg={ok} tone="green" />
      <Card title="إعدادات المزرعة">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="اسم المزرعة"><input className="input" value={v.farmName} onChange={(e) => set('farmName', e.target.value)} /></Field>
          <Field label="العملة الأساسية"><select className="input" value={v.baseCurrency} onChange={(e) => set('baseCurrency', e.target.value)}>{CURRENCIES.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></Field>
          <Field label="سعر الصرف USD → SYP (للتحويل الصريح فقط — لا تُجمع العملات تلقائياً)"><input className="input" type="text" inputMode="decimal" dir="ltr" value={rates['USD->SYP'] || ''} onChange={(e) => set('rates', { ...rates, 'USD->SYP': Number(normNum(e.target.value)) || 0 })} /></Field>
          <Field label="طريقة حساب تكلفة العلف والمخزون في الأرباح"><select className="input" value={v.stockCostingMode || 'consumption'} onChange={(e) => set('stockCostingMode', e.target.value)}><option value="consumption">عند الاستهلاك (موصى به — المشتريات المرتبطة بصنف مخزون لا تدخل الأرباح إلا عند صرفها)</option><option value="purchase">عند الشراء (كل مصروف يدخل فور تسجيله)</option></select></Field>
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-600 sm:col-span-2"><b>سياسة صافي الربح:</b> إيراد الحليب + ربح/خسارة بيع الحيوانات (سعر البيع − سعر الشراء) + إيرادات أخرى − المصروفات التشغيلية − خسارة نفوق الحيوانات ± نتيجة التبادل. شراء الحيوانات والمعدات رأس مال لا يدخل الأرباح. العلف المرتبط بالمخزون يدخل بتكلفة ما استُهلك منه.</div>
        </div>
        {can('manageUsers') ? <button className="btn btn-primary mt-4" onClick={save}>حفظ</button> : <p className="mt-3 text-sm text-slate-500">التعديل لمدير النظام فقط.</p>}
      </Card>
      <Card title="الأرصدة الافتتاحية" className="mt-4"><ul className="list-disc space-y-1 pr-5 text-sm text-slate-600"><li>الصناديق: عند إنشاء الحساب أدخل رصيده الافتتاحي (يُسجَّل كحركة «رصيد افتتاحي» لا تُحتسب إيراداً).</li><li>العملاء: حقل «رصيد افتتاحي مدين» في بطاقة العميل.</li><li>الشركاء: رأس المال الابتدائي عند إنشاء الشريك، أو حركة «رصيد افتتاحي» في دفتره.</li><li>المواشي: أضف الحيوان بمصدر «رصيد افتتاحي».</li></ul></Card>
      <ListsManager />
    </div>
  );
}

export function Audit() {
  const [max, setMax] = useState(300); const rows = useAudit(max);
  const partners = useCol('partners').rows, accounts = useCol('cashAccounts').rows, customers = useCol('customers').rows;
  const [q, setQ] = useState(''); const [user, setUser] = useState(''); const [area, setArea] = useState(''); const [act, setAct] = useState(''); const [open, setOpen] = useState({});
  const ctx = useMemo(() => ({ partner: (id) => partners.find((x) => x.id === id)?.name || '', account: (id) => accounts.find((x) => x.id === id)?.name || '', customer: (id) => customers.find((x) => x.id === id)?.name || '' }), [partners, accounts, customers]);
  const ops = useMemo(() => buildOperations(rows, ctx), [rows, ctx]);
  const users = [...new Set(ops.map((o) => o.user))].filter(Boolean);
  const shown = ops.filter((o) => (!user || o.user === user) && (!area || o.areas.includes(area)) && (!act || o.action === act) && (!q || [o.title, o.reason, o.user, ...o.subs.map((x) => x.text)].join(' ').includes(q.trim())));
  const days = []; shown.forEach((o) => { let g = days[days.length - 1]; if (!g || g.day !== o.day) { g = { day: o.day, at: o.at, list: [] }; days.push(g); } g.list.push(o); });
  const dayLabel = (d) => { if (!d) return '—'; const t = new Date(); const key = (x) => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`; const y = new Date(t); y.setDate(t.getDate() - 1);
    const base = `${new Intl.DateTimeFormat('ar', { weekday: 'long' }).format(d)} ${d.getDate()} ${MONTHS_AR[d.getMonth()]} ${d.getFullYear()}`; return key(d) === key(t) ? `اليوم — ${base}` : key(d) === key(y) ? `أمس — ${base}` : base; };
  const time = (d) => (d ? d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : '');
  return (
    <div>
      <PageHeader title="سجل التدقيق" subtitle="من سجّل أو عدّل أو ألغى ماذا ومتى — لا يمكن تعديله أو حذفه" />
      <Card>
        <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
          <input className="input col-span-2 sm:w-64" placeholder="بحث (رقم بقرة، اسم، مبلغ…)" value={q} onChange={(e) => setQ(e.target.value)} />
          <select className="input sm:w-44" value={user} onChange={(e) => setUser(e.target.value)}><option value="">كل المستخدمين</option>{users.map((u) => <option key={u} value={u}>{u}</option>)}</select>
          <select className="input sm:w-44" value={area} onChange={(e) => setArea(e.target.value)}><option value="">كل المجالات</option>{AREAS.map((a) => <option key={a} value={a}>{a}</option>)}</select>
          <select className="input col-span-2 sm:col-span-1 sm:w-40" value={act} onChange={(e) => setAct(e.target.value)}><option value="">كل الإجراءات</option>{['create', 'update', 'void', 'delete', 'finalize'].map((a) => <option key={a} value={a}>{ACTION_AR[a]}</option>)}</select>
        </div>
        <div className="mb-3 text-xs text-slate-500">{shown.length} عملية (من آخر {rows.length} سطراً في السجل). كل «عملية» قد تضم عدة سجلات حدثت معاً، مثل مصروف وحركة مخزونه.</div>
        {!days.length && <Empty title="لا توجد أحداث مطابقة" />}
        <div className="space-y-5">{days.map((g) => (<div key={g.day}>
          <div className="mb-2 text-sm font-extrabold text-slate-700">{dayLabel(g.at)}</div>
          <div className="space-y-2">{g.list.map((o) => { const isOpen = !!open[o.id]; const hasMore = o.subs.length > 0 || o.fields.length > 0;
            return (<div key={o.id} className="rounded-xl border border-slate-200 bg-white p-3">
              <div className="flex flex-wrap items-center gap-2"><Badge tone={ACTION_TONE[o.action] || 'gray'}>{ACTION_AR[o.action] || o.action}</Badge><span className="num text-xs text-slate-500">{time(o.at)}</span><span className="text-xs font-bold text-slate-600">{o.user}</span>
                <span className="ms-auto flex flex-wrap gap-1">{o.areas.map((a) => <span key={a} className="rounded bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-500">{a}</span>)}</span></div>
              <div className="mt-1.5 text-sm font-bold text-slate-900">{o.title}</div>
              {o.reason && <div className="mt-0.5 text-xs text-rose-700">السبب: {o.reason}</div>}
              {hasMore && <button type="button" className="mt-1.5 text-xs font-bold text-emerald-700" onClick={() => setOpen((x) => ({ ...x, [o.id]: !isOpen }))}>{isOpen ? 'إخفاء التفاصيل' : `التفاصيل${o.subs.length ? ` (${o.subs.length} سجل مرتبط)` : ''}`}</button>}
              {isOpen && <div className="mt-2 space-y-1.5 rounded-lg bg-slate-50 p-2.5 text-xs text-slate-700">
                {o.subs.map((x, i) => <div key={i}>• {x.text}</div>)}
                {o.fields.length > 0 && <div className="grid grid-cols-1 gap-x-4 sm:grid-cols-2">{o.fields.map(([k, v]) => <div key={k} className="flex justify-between gap-2 border-b border-slate-200 py-0.5"><span className="text-slate-500">{k}</span><span className="font-medium">{v}</span></div>)}</div>}
              </div>}
            </div>); })}</div>
        </div>))}</div>
        {rows.length >= max && max < 1500 && <div className="mt-4 text-center"><button className="btn btn-ghost" onClick={() => setMax((m) => m + 300)}>عرض أقدم</button></div>}
      </Card>
    </div>
  );
}
