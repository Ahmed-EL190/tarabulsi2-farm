import { useMemo, useState } from 'react';
import { FileText, BookOpen, Info } from 'lucide-react';
import CrudPage, { FormModal } from '../components/CrudPage';
import ExportButtons from '../components/ExportButtons';
import AnimalSale from '../components/AnimalSale';
import { Card, Stat, Table, Badge, Modal, Empty, PageHeader, money, fmt, today } from '../components/ui';
import { useCol, useSettings, createAnimal, saveRecord, commit, newId } from '../data/db';
import { recordAnimalEvent, partnerMovement } from '../data/ops';
import { useAuth } from '../data/auth';
import { customerPosition, customerStatement, partnerLedger, herdState, animalExchange, validateNewAnimal, animalProfile, round2, LEDGER_TYPES } from '../lib/finance';
import { CURRENCIES, LEDGER_AR, ANIMAL_CATEGORIES } from '../lib/constants';
const CAT_AR = Object.fromEntries(ANIMAL_CATEGORIES);
const animalOpt = (r) => `${r.tag}${r.name ? ' - ' + r.name : ''}`;

const cur = { name: 'currency', label: 'العملة', type: 'select', options: CURRENCIES, required: true, default: 'SYP' };
const acct = { name: 'accountId', label: 'الصندوق / الحساب', type: 'rel', col: 'cashAccounts' };

// ───────── إنتاج الحليب
export function Production() {
  return <CrudPage title="إنتاج الحليب" subtitle="تسجيل الإنتاج اليومي حسب الوردية" col="milkProduction" searchKeys={['date', 'group', 'notes']}
    fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'shift', label: 'الوردية', type: 'select', required: true, options: [['morning', 'صباحاً'], ['evening', 'مساءً']], default: 'morning' },
      { name: 'animalId', label: 'البقرة (اختياري — لإنتاج كل بقرة)', type: 'rel', col: 'animals', optLabel: animalOpt }, { name: 'group', label: 'المجموعة (إن لم تُحدَّد بقرة)', type: 'text' }, { name: 'liters', label: 'الكمية (لتر)', type: 'number', required: true, positive: true }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
    useCtx={() => ({ animals: useCol('animals').rows })}
    create={(u, d, { animals }) => saveRecord(u, 'milkProduction', { ...d, animalTag: animals.find((a) => a.id === d.animalId)?.tag || '', recordedBy: u.name || u.email })}
    summary={(rows) => { const sum = (f) => rows.filter(f).reduce((a, r) => a + Number(r.liters), 0); const m = today().slice(0, 7);
      return <div className="grid gap-3 sm:grid-cols-4"><Stat label="إنتاج اليوم" value={`${fmt(sum((r) => r.date === today()))} لتر`} /><Stat label="صباحاً اليوم" value={fmt(sum((r) => r.date === today() && r.shift === 'morning'))} /><Stat label="مساءً اليوم" value={fmt(sum((r) => r.date === today() && r.shift === 'evening'))} /><Stat label="إنتاج الشهر" value={`${fmt(sum((r) => r.date.startsWith(m)))} لتر`} /></div>; }}
    cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'shift', label: 'الوردية', render: (r) => <Badge tone={r.shift === 'morning' ? 'amber' : 'blue'}>{r.shift === 'morning' ? 'صباحاً' : 'مساءً'}</Badge> }, { key: 'group', label: 'البقرة/المجموعة', render: (r) => r.animalTag || r.group || '—' }, { key: 'liters', label: 'اللترات', render: (r) => <b className="num">{fmt(r.liters)}</b> }, { key: 'recordedBy', label: 'سجّله' }, { key: 'notes', label: 'ملاحظات' }]} />;
}

// ───────── العملاء
function StatementModal({ customer, onClose }) {
  const { user } = useAuth(); const s = useSettings();
  const ags = useCol('milkSales').rows, dls = useCol('milkDeliveries').rows, pays = useCol('customerPayments').rows;
  const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const st = useMemo(() => customerStatement(customer.id, { agreements: ags, deliveries: dls, payments: pays, from, to, openingBalance: Number(customer.openingBalance || 0) }), [customer, ags, dls, pays, from, to]);
  const KIND = { delivery: 'تسليم', payment: 'دفعة', refund: 'استرداد' };
  const rows = [{ date: from || '—', kindAr: 'رصيد افتتاحي', debit: 0, credit: 0, balance: st.opening }, ...st.rows.map((r) => ({ ...r, kindAr: KIND[r.kind] }))];
  const report = { farm: s.farmName, title: `كشف حساب العميل - ${customer.name}`, from, to, currency: 'SYP', columns: [{ key: 'date', label: 'التاريخ', type: 'date' }, { key: 'kindAr', label: 'البيان' }, { key: 'qty', label: 'الكمية (لتر)', type: 'number' }, { key: 'debit', label: 'مدين (مبيعات)', type: 'money' }, { key: 'credit', label: 'دائن (مدفوعات)', type: 'money' }, { key: 'balance', label: 'الرصيد', type: 'money' }],
    rows, totals: { debit: st.totalDebit, credit: st.totalCredit }, summary: [{ label: 'الرصيد الافتتاحي', value: st.opening }, { label: 'الرصيد الختامي (سالب = رصيد دائن للعميل)', value: st.closing }] };
  return (
    <Modal open onClose={onClose} title={report.title} wide>
      <div className="mb-3 flex flex-wrap items-end gap-2"><input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} /><ExportButtons report={report} /></div>
      <Table columns={report.columns.map((c) => ({ ...c, render: c.type === 'money' ? (r) => <span className="num">{fmt(r[c.key])}</span> : undefined }))} rows={rows}
        footer={<tr><td className="px-3 py-2" colSpan={3}>الإجمالي</td><td className="px-3 py-2 num">{fmt(st.totalDebit)}</td><td className="px-3 py-2 num">{fmt(st.totalCredit)}</td><td className="px-3 py-2 num">{fmt(st.closing)}</td></tr>} />
    </Modal>
  );
}
export function Customers() {
  const [stm, setStm] = useState(null);
  const ctx = () => ({ ags: useCol('milkSales').rows, dls: useCol('milkDeliveries').rows, pays: useCol('customerPayments').rows });
  return (<>
    <CrudPage title="العملاء والديون المدينة" subtitle="سجل العملاء والذمم والدفعات المقدمة" col="customers" searchKeys={['name', 'phone']} useCtx={ctx}
      fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف', type: 'text' }, { name: 'address', label: 'العنوان', type: 'text' }, { name: 'status', label: 'الحالة', type: 'select', options: [['active', 'نشط'], ['inactive', 'غير نشط']], required: true, default: 'active' }, { name: 'openingBalance', label: 'رصيد افتتاحي مدين (ل.س) — اختياري', type: 'number' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      cols={({ ags, dls, pays }) => [{ key: 'name', label: 'العميل' }, { key: 'phone', label: 'الهاتف' }, { key: 'status', label: 'الحالة', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> },
        { key: 'rec', label: 'الذمم المدينة', render: (r) => { const p = customerPosition(r.id, { agreements: ags, deliveries: dls, payments: pays }); const v = round2(p.receivable + Number(r.openingBalance || 0)); return <b className={`num ${v > 0 ? 'text-rose-600' : ''}`}>{fmt(v)}</b>; } },
        { key: 'cr', label: 'دفعات مقدمة غير مطبّقة', render: (r) => <b className="num text-emerald-700">{fmt(customerPosition(r.id, { agreements: ags, deliveries: dls, payments: pays }).unappliedCredit)}</b> }]}
      rowActions={(r) => <button className="rounded p-1.5 hover:bg-slate-100" title="كشف حساب" onClick={() => setStm(r)}><FileText size={15} /></button>} />
    {stm && <StatementModal customer={stm} onClose={() => setStm(null)} />}
  </>);
}

// ───────── الشركاء
function LedgerModal({ partner, onClose }) {
  const { user, can } = useAuth(); const s = useSettings();
  const entries = useCol('partnerCapitalTransactions').rows;
  const [c, setC] = useState('SYP'); const [type, setType] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [mv, setMv] = useState(false);
  const L = partnerLedger(partner.id, type ? entries.filter((e) => e.type === type) : entries, { currency: c, from, to });
  const rows = L.rows.map((r) => ({ ...r, typeAr: LEDGER_AR[r.type] }));
  const report = { farm: s.farmName, title: `كشف حساب الشريك - ${partner.name}`, from, to, currency: c, columns: [{ key: 'date', label: 'التاريخ', type: 'date' }, { key: 'typeAr', label: 'النوع' }, { key: 'amount', label: 'المبلغ', type: 'money' }, { key: 'delta', label: 'الأثر (+ مستحق للشريك)', type: 'money' }, { key: 'balance', label: 'الرصيد', type: 'money' }], rows, totals: { delta: round2(rows.reduce((a, r) => a + r.delta, 0)) }, summary: [{ label: 'الرصيد الختامي', value: L.closing }] };
  return (
    <Modal open onClose={onClose} title={report.title} wide>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select className="input w-28" value={c} onChange={(e) => setC(e.target.value)}>{CURRENCIES.map(([v]) => <option key={v}>{v}</option>)}</select>
        <select className="input w-44" value={type} onChange={(e) => setType(e.target.value)}><option value="">كل الأنواع</option>{LEDGER_TYPES.map((t) => <option key={t} value={t}>{LEDGER_AR[t]}</option>)}</select>
        <input type="date" className="input w-36" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        <ExportButtons report={report} />{can('create') && <button className="btn btn-primary" onClick={() => setMv(true)}>تسجيل حركة</button>}
      </div>
      <Table columns={report.columns.map((x) => ({ ...x, render: x.type === 'money' ? (r) => <span className="num">{fmt(r[x.key])}</span> : undefined }))} rows={rows} empty={<Empty title="لا توجد حركات" />} />
      <div className="mt-3 text-sm font-bold">الرصيد الختامي ({c}): <span className="num">{fmt(L.closing)}</span> <span className="text-xs font-normal text-slate-500">(موجب = مستحق للشريك على المزرعة)</span></div>
      <FormModal open={mv} onClose={() => setMv(false)} title="حركة شريك (مع قيد الصندوق المرتبط)" submitLabel="تسجيل"
        fields={[{ name: 'type', label: 'النوع', type: 'select', required: true, options: [['capital_contribution', 'مساهمة رأس مال'], ['additional_capital', 'رأس مال إضافي'], ['withdrawal', 'سحب مصرّح'], ['profit_distribution', 'توزيع أرباح نقدي']] }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, cur, { ...acct, required: true }, { name: 'note', label: 'ملاحظة', type: 'text' }]}
        defaults={{ type: 'capital_contribution', date: today(), amount: '', currency: 'SYP', accountId: '', note: '' }} onSubmit={(d) => partnerMovement(user, { ...d, partnerId: partner.id })} />
    </Modal>
  );
}
export function Partners() {
  const [led, setLed] = useState(null);
  return (<>
    <CrudPage title="الشركاء" subtitle="الشركاء ونسب الملكية والأرباح — تُخزَّن النسبتان بشكل منفصل" col="partners" searchKeys={['name', 'phone']}
      fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف / التواصل', type: 'text' }, { name: 'initialCapital', label: 'رأس المال الابتدائي (ل.س)', type: 'number', min: 0 }, { name: 'ownershipPct', label: 'نسبة الملكية %', type: 'number', min: 0, required: true }, { name: 'profitSharePct', label: 'نسبة الأرباح %', type: 'number', min: 0, required: true }, { name: 'joinDate', label: 'تاريخ الانضمام', type: 'date' }, { name: 'status', label: 'الحالة', type: 'select', options: [['active', 'نشط'], ['inactive', 'غير نشط']], required: true, default: 'active' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      create={async (u, d) => { const id = await saveRecord(u, 'partners', d); if (Number(d.initialCapital) > 0) await commit(u, [{ col: 'partnerCapitalTransactions', data: { partnerId: id, date: d.joinDate || today(), type: 'capital_contribution', amount: Number(d.initialCapital), currency: 'SYP', opening: true } }]); }}
      summary={(rows) => { const o = round2(rows.reduce((a, p) => a + Number(p.ownershipPct || 0), 0)), pr = round2(rows.reduce((a, p) => a + Number(p.profitSharePct || 0), 0));
        return rows.length ? <div className="grid gap-3 sm:grid-cols-3"><Stat label="مجموع نسب الملكية" value={`${o}%`} tone={o === 100 ? 'green' : 'amber'} /><Stat label="مجموع نسب الأرباح" value={`${pr}%`} sub={pr === 100 ? 'جاهز للتوزيع النسبي' : 'يجب أن يساوي 100% قبل التسوية'} tone={pr === 100 ? 'green' : 'red'} /><Stat label="رأس المال الابتدائي" value={money(rows.reduce((a, p) => a + Number(p.initialCapital || 0), 0))} /></div> : null; }}
      cols={() => [{ key: 'name', label: 'الشريك' }, { key: 'phone', label: 'التواصل' }, { key: 'initialCapital', label: 'رأس المال', render: (r) => <span className="num">{fmt(r.initialCapital)}</span> }, { key: 'ownershipPct', label: 'الملكية', render: (r) => `${r.ownershipPct}%` }, { key: 'profitSharePct', label: 'الأرباح', render: (r) => `${r.profitSharePct}%` }, { key: 'status', label: 'الحالة', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> }]}
      rowActions={(r) => <button className="rounded p-1.5 hover:bg-slate-100" title="دفتر الشريك" onClick={() => setLed(r)}><BookOpen size={15} /></button>} />
    {led && <LedgerModal partner={led} onClose={() => setLed(null)} />}
  </>);
}

// ───────── المواشي
const animalCtx = () => ({ events: useCol('animalEvents').rows, animals: useCol('animals').rows, production: useCol('milkProduction').rows, expenses: useCol('expenses').rows });
export function Animals() {
  const [sale, setSale] = useState(null); // null | true | animalId
  return (<>
    <CrudPage title="المواشي والعجول" subtitle="سجل الحيوانات — رقم الحيوان فريد. اضغط أيقونة التفاصيل لعرض بيانات الحيوان وبيعه" col="animals" searchKeys={['tag', 'name', 'breed']} useCtx={animalCtx}
      extraHeader={<button className="btn btn-ghost" onClick={() => setSale(true)}>بيع حيوان</button>}
      fields={[{ name: 'tag', label: 'رقم الحيوان (Tag)', type: 'text', required: true }, { name: 'name', label: 'الاسم', type: 'text' }, { name: 'category', label: 'الفئة', type: 'select', required: true, options: ANIMAL_CATEGORIES, default: 'cow' }, { name: 'sex', label: 'الجنس', type: 'select', required: true, options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'breed', label: 'السلالة', type: 'text' },
        { name: 'origin', label: 'المصدر', type: 'select', required: true, options: [['purchase', 'شراء'], ['birth', 'مولود بالمزرعة'], ['opening', 'رصيد افتتاحي (موجود مسبقاً)']] }, { name: 'sellerName', label: 'جهة الشراء (البائع/السوق)', type: 'text' },
        { name: 'birthDate', label: 'تاريخ الميلاد', type: 'date' }, { name: 'ageAtPurchaseMonths', label: 'العمر عند الشراء (شهر)', type: 'number', min: 0 }, { name: 'acquisitionDate', label: 'تاريخ الشراء / الاقتناء', type: 'date', required: true },
        { name: 'acquisitionCost', label: 'سعر الشراء', type: 'number', min: 0 }, cur, { ...acct, label: 'ممول الشراء من (الصندوق)' }, { name: 'pregnant', label: 'حامل عند الشراء؟', type: 'select', options: [['yes', 'نعم'], ['no', 'لا'], ['na', 'لا ينطبق']] },
        { name: 'healthStatus', label: 'الحالة الصحية', type: 'select', options: [['healthy', 'سليم'], ['sick', 'مريض']], default: 'healthy' }, { name: 'motherId', label: 'الأم', type: 'rel', col: 'animals', optLabel: animalOpt }, { name: 'fatherId', label: 'الأب', type: 'rel', col: 'animals', optLabel: animalOpt }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      create={async (u, d, { animals }) => {
        const ok = validateNewAnimal(d.tag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'رقم الحيوان مطلوب');
        const { origin, accountId, ...rest } = d; const id = await createAnimal(u, { ...rest, origin, healthStatus: d.healthStatus || 'healthy' });
        await recordAnimalEvent(u, { animalId: id, tag: d.tag, type: origin, date: d.acquisitionDate, value: d.acquisitionCost || 0, currency: d.currency }, origin === 'purchase' && accountId && d.acquisitionCost ? { date: d.acquisitionDate, type: 'animal_purchase', direction: 'out', amount: Number(d.acquisitionCost), currency: d.currency, accountId, description: `شراء ${d.tag}` } : null); }}
      summary={(rows, { events }) => { const h = herdState(events); return <div className="grid gap-3 sm:grid-cols-4"><Stat label="القطيع النشط" value={Object.values(h).filter((x) => x.active).length} /><Stat label="مريض" value={rows.filter((r) => h[r.id]?.active && r.healthStatus === 'sick').length} tone="red" /><Stat label="إجمالي السجلات" value={rows.length} /><Stat label="خرجت من القطيع" value={Object.values(h).filter((x) => !x.active).length} /></div>; }}
      cols={(ctx) => { const h = herdState(ctx.events); return [{ key: 'tag', label: 'الرقم' }, { key: 'name', label: 'الاسم' }, { key: 'category', label: 'الفئة', render: (r) => CAT_AR[r.category] || '—' }, { key: 'sex', label: 'الجنس', render: (r) => (r.sex === 'F' ? 'أنثى' : 'ذكر') }, { key: 'breed', label: 'السلالة' }, { key: 'acquisitionDate', label: 'الشراء' },
        { key: 'cost', label: 'سعر الشراء', render: (r) => <span className="num">{r.acquisitionCost ? fmt(r.acquisitionCost) : '—'}</span> }, { key: 'age', label: 'العمر (شهر)', render: (r) => animalProfile(r, ctx).ageMonths ?? '—' },
        { key: 'milk', label: 'حليب (لتر)', render: (r) => { const p = animalProfile(r, ctx); return p.milkTotal ? <span className="num">{fmt(p.milkTotal)} <span className="text-xs text-slate-400">({fmt(p.milkAvg)}/يوم)</span></span> : '—'; } },
        { key: 'st', label: 'الحالة', render: (r) => { const s = h[r.id]; const t = s?.active ? (r.healthStatus === 'sick' ? 'مريض' : 'نشط') : s ? { sale: 'مباع', death: 'نافق', transfer_out: 'منقول', exchange_out: 'مبادَل' }[s.last] || 'خرج' : 'بلا حدث'; return <Badge tone={t === 'نشط' ? 'green' : t === 'مريض' ? 'red' : s ? 'gray' : 'amber'}>{t}</Badge>; } }]; }}
      rowActions={(r, { events }) => <button className="rounded p-1.5 hover:bg-slate-100" title="تفاصيل وبيع" onClick={() => setSale(r.id)}><Info size={15} /></button>} />
    {sale && <AnimalSale preselectId={sale === true ? null : sale} onClose={() => setSale(null)} />}
  </>);
}
const evTypes = [['birth', 'ولادة'], ['purchase', 'شراء'], ['death', 'نفوق']]; // sale = dedicated dialog (search by name/tag)
const EVT_AR = { birth: 'ولادة', purchase: 'شراء', death: 'نفوق', sale: 'بيع', opening: 'افتتاحي', exchange_in: 'تبادل (وارد)', exchange_out: 'تبادل (صادر)', transfer_out: 'نقل' };
const animalLabel = (r) => `${r.tag}${r.name ? ' - ' + r.name : ''}`;
export function AnimalEvents() {
  const [sale, setSale] = useState(false);
  return (<><CrudPage extraHeader={<button className="btn btn-ghost" onClick={() => setSale(true)}>بيع حيوان</button>} title="المواليد والوفيات والمشتريات" subtitle="كل حدث يحدّث القطيع النشط ويُنشئ القيد المالي المرتبط" col="animalEvents" noEdit useCtx={animalCtx} searchKeys={['tag', 'type']} filter={(r) => !String(r.type).startsWith('exchange') && r.type !== 'transfer_out' && r.type !== 'opening'}
    fields={[{ name: 'type', label: 'نوع الحدث', type: 'select', options: evTypes, required: true, default: 'birth' }, { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'animalId', label: 'الحيوان (للنفوق/البيع)', type: 'rel', col: 'animals', optLabel: animalLabel }, { name: 'newTag', label: 'رقم الحيوان الجديد (للولادة/الشراء)', type: 'text' }, { name: 'newName', label: 'الاسم', type: 'text' }, { name: 'breed', label: 'السلالة', type: 'text' }, { name: 'sex', label: 'الجنس', type: 'select', options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'motherId', label: 'الأم (للولادة)', type: 'rel', col: 'animals', optLabel: animalLabel }, { name: 'fatherId', label: 'الأب (للولادة)', type: 'rel', col: 'animals', optLabel: animalLabel },
      { name: 'value', label: 'القيمة (شراء/بيع)', type: 'number', min: 0 }, cur, { ...acct }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
    create={async (u, d, { animals, events }) => {
      const h = herdState(events); let animalId = d.animalId, tag = animals.find((a) => a.id === animalId)?.tag;
      if (d.type === 'birth' || d.type === 'purchase') {
        const ok = validateNewAnimal(d.newTag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'أدخل رقم الحيوان الجديد');
        animalId = await createAnimal(u, { tag: d.newTag, name: d.newName || '', breed: d.breed || '', sex: d.sex || 'F', acquisitionDate: d.date, acquisitionCost: d.type === 'purchase' ? Number(d.value || 0) : 0, currency: d.currency, motherId: d.motherId || '', fatherId: d.fatherId || '', category: d.type === 'birth' ? 'heifer_calf' : 'cow', origin: d.type === 'birth' ? 'birth' : 'purchase', healthStatus: 'healthy', birthDate: d.type === 'birth' ? d.date : '' }); tag = d.newTag;
      } else { if (!animalId) throw new Error('اختر الحيوان'); if (!h[animalId]?.active) throw new Error('هذا الحيوان غير موجود ضمن القطيع النشط'); }
      const v = Number(d.value || 0); if ((d.type === 'sale' || d.type === 'purchase') && v > 0 && !d.accountId) throw new Error('اختر الصندوق لتسجيل الحركة النقدية');
      const cash = v > 0 && d.type === 'purchase' ? { date: d.date, type: 'animal_purchase', direction: 'out', amount: v, currency: d.currency, accountId: d.accountId, description: `شراء ${tag}` } : v > 0 && d.type === 'sale' ? { date: d.date, type: 'animal_sale', direction: 'in', amount: v, currency: d.currency, accountId: d.accountId, description: `بيع ${tag}` } : null;
      await recordAnimalEvent(u, { animalId, tag, type: d.type, date: d.date, value: v, currency: d.currency, motherId: d.motherId || '', notes: d.notes || '' }, cash); }}
    cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'الحدث', render: (r) => <Badge tone={r.type === 'death' ? 'red' : r.type === 'birth' ? 'green' : 'blue'}>{EVT_AR[r.type]}</Badge> }, { key: 'tag', label: 'الحيوان' }, { key: 'value', label: 'القيمة', render: (r) => (r.value ? <span className="num">{fmt(r.value)} {r.currency}</span> : '—') }, { key: 'notes', label: 'ملاحظات' }]} />
    {sale && <AnimalSale onClose={() => setSale(false)} />}</>);
}
export function Exchange() {
  return <CrudPage title="تبادل ونقل المواشي" subtitle="التبادل: حيوان مقابل حيوان مع فرق نقدي — النقل: خروج حيوان إلى جهة أخرى" col="animalEvents" noEdit useCtx={animalCtx} searchKeys={['tag']} filter={(r) => String(r.type).startsWith('exchange') || r.type === 'transfer_out'}
    fields={[{ name: 'kind', label: 'العملية', type: 'select', required: true, options: [['exchange', 'تبادل'], ['transfer', 'نقل خارج المزرعة']], default: 'exchange' }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'animalId', label: 'الحيوان الخارج', type: 'rel', col: 'animals', required: true, optLabel: animalLabel }, { name: 'oldValue', label: 'قيمة الحيوان الخارج المتفق عليها', type: 'number', min: 0 },
      { name: 'newTag', label: 'رقم الحيوان الوارد (للتبادل)', type: 'text' }, { name: 'newBreed', label: 'سلالة الوارد', type: 'text' }, { name: 'newSex', label: 'جنس الوارد', type: 'select', options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'newValue', label: 'قيمة الحيوان الوارد المتفق عليها', type: 'number', min: 0 }, cur, { ...acct }, { name: 'notes', label: 'الطرف الآخر / ملاحظات', type: 'text' }]}
    create={async (u, d, { animals, events }) => {
      const h = herdState(events); if (!h[d.animalId]?.active) throw new Error('الحيوان غير موجود ضمن القطيع النشط'); const tag = animals.find((a) => a.id === d.animalId)?.tag;
      if (d.kind === 'transfer') return recordAnimalEvent(u, { animalId: d.animalId, tag, type: 'transfer_out', date: d.date, notes: d.notes || '' });
      const ok = validateNewAnimal(d.newTag, animals); if (!ok.ok) throw new Error('رقم الحيوان الوارد مفقود أو مكرر');
      const x = animalExchange({ date: d.date, oldAnimalId: d.animalId, newAnimalId: 'pending', oldValue: Number(d.oldValue || 0), newValue: Number(d.newValue || 0), currency: d.currency });
      if (x.cash.length && !d.accountId) throw new Error('يوجد فرق نقدي: اختر الصندوق');
      const newId_ = await createAnimal(u, { tag: d.newTag, breed: d.newBreed || '', sex: d.newSex || 'F', acquisitionDate: d.date, acquisitionCost: Number(d.newValue || 0), currency: d.currency, viaExchange: true });
      const exId = newId('animalEvents');
      await commit(u, [{ col: 'animalEvents', data: { animalId: d.animalId, tag, type: 'exchange_out', date: d.date, value: Number(d.oldValue || 0), currency: d.currency, exchangeId: exId, counterpartTag: d.newTag, notes: d.notes || '' } },
        { col: 'animalEvents', data: { animalId: newId_, tag: d.newTag, type: 'exchange_in', date: d.date, value: Number(d.newValue || 0), currency: d.currency, exchangeId: exId, counterpartTag: tag } },
        ...x.cash.map((c) => ({ col: 'cashTransactions', data: { ...c, accountId: d.accountId, exchangeId: exId, description: `فرق تبادل ${tag} ↔ ${d.newTag}` } }))]); }}
    cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'العملية', render: (r) => EVT_AR[r.type] }, { key: 'tag', label: 'الحيوان' }, { key: 'counterpartTag', label: 'المقابل' }, { key: 'value', label: 'القيمة المتفق عليها', render: (r) => (r.value ? <span className="num">{fmt(r.value)} {r.currency}</span> : '—') }, { key: 'notes', label: 'ملاحظات' }]} />;
}

// ───────── الأعلاف والمخزون
export function Inventory() {
  const [tab, setTab] = useState('mov');
  const items = useCol('stockItems').rows.filter((i) => !i.voided); const mv = useCol('stockMovements').rows.filter((m) => !m.voided);
  const level = (id) => round2(mv.filter((m) => m.itemId === id).reduce((a, m) => a + (m.type === 'in' ? 1 : -1) * Number(m.qty), 0));
  return (<div>
    <div className="mb-3 flex gap-2"><button className={`btn ${tab === 'mov' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('mov')}>الحركات</button><button className={`btn ${tab === 'items' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('items')}>الأصناف</button></div>
    {items.length > 0 && <div className="mb-4 grid gap-3 sm:grid-cols-4">{items.map((i) => { const l = level(i.id); return <Stat key={i.id} label={i.name} value={`${fmt(l)} ${i.unit || ''}`} sub={Number(i.minLevel) && l < Number(i.minLevel) ? '⚠ أقل من حد التنبيه' : undefined} tone={Number(i.minLevel) && l < Number(i.minLevel) ? 'red' : 'green'} />; })}</div>}
    {tab === 'items' ? <CrudPage title="أصناف المخزون" col="stockItems" searchKeys={['name']} fields={[{ name: 'name', label: 'الصنف', type: 'text', required: true }, { name: 'unit', label: 'الوحدة (كغ، كيس…)', type: 'text', required: true }, { name: 'minLevel', label: 'حد التنبيه', type: 'number', min: 0 }]} cols={() => [{ key: 'name', label: 'الصنف' }, { key: 'unit', label: 'الوحدة' }, { key: 'minLevel', label: 'حد التنبيه' }]} />
      : <CrudPage title="الأعلاف والمخزون" subtitle="حركات الوارد والصادر" col="stockMovements" searchKeys={['itemName']} fields={[{ name: 'itemId', label: 'الصنف', type: 'rel', col: 'stockItems', required: true }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'type', label: 'النوع', type: 'select', required: true, options: [['in', 'وارد'], ['out', 'صادر / استهلاك']] }, { name: 'qty', label: 'الكمية', type: 'number', required: true, positive: true }, { name: 'notes', label: 'ملاحظات', type: 'text' }]}
        create={async (u, d) => { if (d.type === 'out' && d.qty > level(d.itemId)) throw new Error('الكمية أكبر من الرصيد المتوفر'); await saveRecord(u, 'stockMovements', { ...d, itemName: items.find((i) => i.id === d.itemId)?.name }); }}
        cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'itemName', label: 'الصنف' }, { key: 'type', label: 'النوع', render: (r) => <Badge tone={r.type === 'in' ? 'green' : 'amber'}>{r.type === 'in' ? 'وارد' : 'صادر'}</Badge> }, { key: 'qty', label: 'الكمية', render: (r) => <span className="num">{fmt(r.qty)}</span> }, { key: 'notes', label: 'ملاحظات' }]} />}
  </div>);
}
