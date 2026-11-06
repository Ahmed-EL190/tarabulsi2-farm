import { useMemo, useState } from 'react';
import { FileText, BookOpen, Info, Landmark, HandCoins, Pencil, Ban } from 'lucide-react';
import CrudPage, { FormModal } from '../components/CrudPage';
import ExportButtons from '../components/ExportButtons';
import AnimalSale from '../components/AnimalSale';
import ExchangeModal from '../components/ExchangeModal';
import { Card, Stat, Table, Badge, Modal, Empty, PageHeader, Avatar, money, fmt, today } from '../components/ui';
import { useCol, useSettings, useCustomLists, createAnimal, saveRecord, commit, newId } from '../data/db';
import { recordAnimalEvent, partnerMovement, voidAnimalCascade, voidAnimalEventCascade, animalPurchasePayment, linkPurchasesToPartner, voidInitialCapital, repayPartner, switchExchangeDiffToPartner, voidCashTransactions, addCustomCategory, updateLedgerEntry, voidLedgerEntry } from '../data/ops';
import { useAuth } from '../data/auth';
import { customerPosition, customerStatement, partnerLedger, herdState, animalExchange, validateNewAnimal, animalProfile, partnerDebt, cashBalances, round2, LEDGER_TYPES } from '../lib/finance';
import { CURRENCIES, LEDGER_AR, allAnimalCategories, animalCatLabel, NEW_CAT } from '../lib/constants';
const animalOpt = (r) => `${r.tag}${r.name ? ' - ' + r.name : ''}`;

const cur = { name: 'currency', label: 'العملة', type: 'select', options: CURRENCIES, required: true, default: 'SYP' };
const acct = { name: 'accountId', label: 'الصندوق / الحساب', type: 'rel', col: 'cashAccounts' };

// ───────── إنتاج الحليب
const SHIFTS = [['morning', 'صباحاً'], ['evening', 'مساءً'], ['all', 'على مدار اليوم (إجمالي)']];
const SHIFT_TONE = { morning: 'amber', evening: 'blue', all: 'green' };
export function Production() {
  const { user } = useAuth(); const prodRows = useCol('milkProduction').rows; const animalRows = useCol('animals').rows; const [both, setBoth] = useState(false);
  const shiftAr = (k) => (SHIFTS.find(([x]) => x === k) || [])[1] || k;
  // لا نخلط «صباح/مساء» مع «إجمالي اليوم» في نفس اليوم كي لا يتكرر الإنتاج، ولا نكرّر نفس الوردية لنفس البقرة/المجموعة
  const check = (d, prod, selfId) => {
    const same = prod.filter((p) => !p.voided && p.date === d.date && p.id !== selfId);
    if (same.some((p) => (p.shift === 'all') !== (d.shift === 'all'))) throw new Error('هذا اليوم مسجّل فيه إنتاج بنظام مختلف: إمّا «صباحاً/مساءً» أو «على مدار اليوم». لا تخلط الاثنين في نفس اليوم حتى لا يتكرر الإنتاج.');
    const scope = (x) => `${x.animalId || ''}|${x.group || ''}`;
    if (same.some((p) => p.shift === d.shift && scope(p) === scope(d))) throw new Error(`يوجد تسجيل «${shiftAr(d.shift)}» لنفس اليوم ونفس البقرة/المجموعة. عدّله بدل تكراره.`);
  };
  const tagOf = (id) => animalRows.find((a) => a.id === id)?.tag || '';
  /** صباح + مساء في إدخال واحد: يُنشئ سجلين (لكل وردية كميتها). */
  const addBoth = async (d) => {
    const m = Number(d.morning || 0), e = Number(d.evening || 0);
    if (!(m > 0) && !(e > 0)) throw new Error('أدخل كمية الصباح أو المساء (أو الاثنين)');
    const ops = [];
    for (const [shift, liters] of [['morning', m], ['evening', e]]) {
      if (!(liters > 0)) continue;
      const rec = { date: d.date, shift, animalId: d.animalId || '', group: d.group || '', liters, notes: d.notes || '', animalTag: tagOf(d.animalId), recordedBy: user.name || user.email };
      check(rec, prodRows); ops.push({ col: 'milkProduction', data: rec });
    }
    await commit(user, ops);
  };
  return (<>
    <CrudPage title="إنتاج الحليب" subtitle="3 اختيارات: صباحاً · مساءً · على مدار اليوم — أو أدخل الصباح والمساء معاً مرة واحدة" col="milkProduction" searchKeys={['date', 'group', 'notes']}
      extraHeader={<button className="btn btn-primary" onClick={() => setBoth(true)}>إدخال صباح + مساء معاً</button>}
      filters={[{ key: 'shift', label: 'الوردية', options: SHIFTS, allLabel: 'الكل' }]}
      fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'shift', label: 'الوردية', type: 'select', required: true, options: SHIFTS, default: 'morning' },
        { name: 'animalId', label: 'البقرة (اختياري — لإنتاج كل بقرة)', type: 'rel', col: 'animals', optLabel: animalOpt }, { name: 'group', label: 'المجموعة (إن لم تُحدَّد بقرة)', type: 'text' }, { name: 'liters', label: 'الكمية (لتر)', type: 'number', required: true, positive: true }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      useCtx={() => ({ animals: useCol('animals').rows, prod: useCol('milkProduction').rows })}
      create={(u, d, { animals, prod }) => { check(d, prod); return saveRecord(u, 'milkProduction', { ...d, animalTag: animals.find((a) => a.id === d.animalId)?.tag || '', recordedBy: u.name || u.email }); }}
      update={(u, d, edit, { animals, prod }) => { check(d, prod, edit.id); return saveRecord(u, 'milkProduction', { ...d, animalTag: animals.find((a) => a.id === d.animalId)?.tag || '' }, edit.id); }}
      summary={(rows) => { const sum = (f) => rows.filter(f).reduce((a, r) => a + Number(r.liters), 0); const m = today().slice(0, 7); const td = (r) => r.date === today();
        return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-5"><Stat label="إنتاج اليوم (الإجمالي)" value={`${fmt(sum(td))} لتر`} tone="green" /><Stat label="صباحاً اليوم" value={fmt(sum((r) => td(r) && r.shift === 'morning'))} tone="amber" /><Stat label="مساءً اليوم" value={fmt(sum((r) => td(r) && r.shift === 'evening'))} tone="blue" /><Stat label="على مدار اليوم" value={fmt(sum((r) => td(r) && r.shift === 'all'))} /><Stat label="إنتاج الشهر" value={`${fmt(sum((r) => r.date.startsWith(m)))} لتر`} /></div>; }}
      cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'shift', label: 'الوردية', render: (r) => <Badge tone={SHIFT_TONE[r.shift] || 'gray'}>{shiftAr(r.shift)}</Badge> }, { key: 'group', label: 'البقرة/المجموعة', render: (r) => r.animalTag || r.group || '—' }, { key: 'liters', label: 'اللترات', render: (r) => <b className="num">{fmt(r.liters)}</b> }, { key: 'recordedBy', label: 'سجّله' }, { key: 'notes', label: 'ملاحظات' }]} />
    {both && <FormModal open onClose={() => setBoth(false)} title="إدخال إنتاج اليوم: صباح + مساء" submitLabel="حفظ الاثنين"
      fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'morning', label: 'كمية الصباح (لتر)', type: 'number', min: 0 }, { name: 'evening', label: 'كمية المساء (لتر)', type: 'number', min: 0 },
        { name: 'animalId', label: 'البقرة (اختياري)', type: 'rel', col: 'animals', optLabel: animalOpt }, { name: 'group', label: 'المجموعة (إن لم تُحدَّد بقرة)', type: 'text' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      defaults={{ date: today(), morning: '', evening: '' }} onSubmit={addBoth} />}
  </>);
}

// ───────── العملاء
function StatementModal({ customer, onClose }) {
  const s = useSettings();
  const ags = useCol('milkSales').rows, dls = useCol('milkDeliveries').rows, pays = useCol('customerPayments').rows;
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [cur2, setCur2] = useState('SYP');
  const inCur = (x) => (x.currency || 'SYP') === cur2;
  const st = useMemo(() => customerStatement(customer.id, { agreements: ags.filter(inCur), deliveries: dls, payments: pays.filter(inCur), from, to, openingBalance: cur2 === 'SYP' ? Number(customer.openingBalance || 0) : 0 }), [customer, ags, dls, pays, from, to, cur2]); // eslint-disable-line
  // الرصيد: موجب = العميل عليه لنا (مدين) · سالب = للعميل رصيد عندنا (دائن)
  const side = (b) => (b > 0.004 ? `عليه ${fmt(b)}` : b < -0.004 ? `له ${fmt(-b)}` : 'متزن');
  const tone = (b) => (b > 0.004 ? 'text-rose-600' : b < -0.004 ? 'text-sky-700' : 'text-slate-500');
  const agNo = (id) => ags.find((a) => a.id === id)?.number || '';
  const describe = (r) => {
    if (r.kind === 'delivery') return `تسليم ${fmt(r.qty)} لتر${agNo(r.ref) ? ' — ' + agNo(r.ref) : ''}`;
    const p = pays.find((x) => x.id === r.ref); const no = agNo(p?.agreementId);
    return `${r.kind === 'refund' ? 'استرداد للعميل' : 'دفعة من العميل'}${no ? ' — ' + no : ''}${p?.note ? ' (' + p.note + ')' : ''}`;
  };
  const rows = [{ id: 'open', date: from || '—', desc: 'رصيد افتتاحي', qty: '', price: '', debit: 0, credit: 0, balance: st.opening }, ...st.rows.map((r, i) => ({ id: i, date: r.date, desc: describe(r), qty: r.kind === 'delivery' ? r.qty : '', price: r.kind === 'delivery' && r.qty ? round2(r.debit / r.qty) : '', debit: r.debit, credit: r.credit, balance: r.balance }))]
    .map((r) => ({ ...r, balLabel: side(r.balance) }));
  const closingTxt = st.closing > 0.004 ? `العميل عليه لنا ${money(st.closing, cur2)}` : st.closing < -0.004 ? `للعميل عندنا ${money(-st.closing, cur2)} (رصيد دائن)` : `الحساب متزن بالـ${cur2 === 'USD' ? 'دولار' : 'ليرة'} — لا يوجد رصيد`;
  const report = { farm: s.farmName, title: `كشف حساب العميل - ${customer.name} (${cur2})`, from, to, currency: cur2, columns: [{ key: 'date', label: 'التاريخ', type: 'date' }, { key: 'desc', label: 'البيان' }, { key: 'qty', label: 'الكمية (لتر)', type: 'number' }, { key: 'price', label: 'سعر اللتر', type: 'money' }, { key: 'debit', label: 'مدين (عليه — مبيعات)', type: 'money' }, { key: 'credit', label: 'دائن (له — مدفوعات)', type: 'money' }, { key: 'balance', label: 'الرصيد', type: 'money' }, { key: 'balLabel', label: 'عليه / له' }],
    rows, totals: { debit: st.totalDebit, credit: st.totalCredit }, summary: [{ label: 'الرصيد الافتتاحي', value: st.opening }, { label: 'الرصيد الختامي (موجب = العميل عليه لنا، سالب = له عندنا)', value: st.closing }, { label: 'الخلاصة', value: closingTxt }] };
  const ui = [{ key: 'date', label: 'التاريخ' }, { key: 'desc', label: 'البيان' }, { key: 'qty', label: 'الكمية (لتر)', render: (r) => (r.qty === '' ? '—' : <span className="num">{fmt(r.qty)}</span>) }, { key: 'price', label: 'سعر اللتر', render: (r) => (r.price === '' ? '—' : <span className="num">{fmt(r.price)}</span>) },
    { key: 'debit', label: 'مدين (عليه)', render: (r) => (r.debit ? <span className="num font-bold text-rose-600">{fmt(r.debit)}</span> : '—') }, { key: 'credit', label: 'دائن (له)', render: (r) => (r.credit ? <span className="num font-bold text-emerald-700">{fmt(r.credit)}</span> : '—') },
    { key: 'balance', label: 'الرصيد', render: (r) => <b className={`${tone(r.balance)}`} dir="rtl">{r.balLabel}</b> }];
  return (
    <Modal open onClose={onClose} title={report.title} wide>
      <div className={`mb-3 rounded-xl p-3 text-center text-base font-extrabold sm:text-lg ${st.closing > 0.004 ? 'bg-rose-50 text-rose-700' : st.closing < -0.004 ? 'bg-sky-50 text-sky-700' : 'bg-slate-50 text-slate-600'}`}>{closingTxt}</div>
      <div className="mb-3 grid grid-cols-3 gap-2"><Stat label="رصيد افتتاحي" value={<span className="text-base">{fmt(st.opening)}</span>} /><Stat label="مدين (مبيعات)" value={<span className="text-base">{fmt(st.totalDebit)}</span>} tone="red" /><Stat label="دائن (مدفوعات)" value={<span className="text-base">{fmt(st.totalCredit)}</span>} tone="green" /></div>
      <div className="mb-1 text-xs text-slate-500"><b className="text-rose-600">عليه</b> = العميل مدين لنا · <b className="text-sky-700">له</b> = رصيد للعميل عندنا (دفعات زائدة / مقدّمة)</div>
      <div className="mb-3 mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end"><label className="col-span-2 block sm:col-span-1"><span className="mb-1 block text-xs font-bold text-slate-500">العملة</span><select className="input sm:w-32" value={cur2} onChange={(e) => setCur2(e.target.value)}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">من تاريخ</span><input type="date" dir="ltr" className="input sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">إلى تاريخ</span><input type="date" dir="ltr" className="input sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label><div className="col-span-2"><ExportButtons report={report} /></div></div>
      <Table columns={ui} rows={rows}
        footer={<tr><td className="px-3 py-2" colSpan={4}>الإجمالي</td><td className="px-3 py-2 num">{fmt(st.totalDebit)}</td><td className="px-3 py-2 num">{fmt(st.totalCredit)}</td><td className={`px-3 py-2 font-extrabold ${tone(st.closing)}`}>{side(st.closing)}</td></tr>} />
    </Modal>
  );
}
export function Customers() {
  const [stm, setStm] = useState(null);
  const ctx = () => ({ ags: useCol('milkSales').rows, dls: useCol('milkDeliveries').rows, pays: useCol('customerPayments').rows });
  return (<>
    <CrudPage title="العملاء والديون المدينة" subtitle="سجل العملاء والذمم والدفعات المقدمة" col="customers" searchKeys={['name', 'phone']} useCtx={ctx}
      fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف', type: 'text' }, { name: 'address', label: 'العنوان', type: 'text' }, { name: 'status', label: 'الحالة', type: 'select', options: [['active', 'نشط'], ['inactive', 'غير نشط']], required: true, default: 'active' }, { name: 'openingBalance', label: 'رصيد افتتاحي مدين (ل.س) — اختياري', type: 'number' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      cols={({ ags, dls, pays }) => {
        // كل عملة على حدة — لا نجمع ليرة مع دولار أبداً
        const per = (r) => CURRENCIES.map(([c]) => { const p = customerPosition(r.id, { agreements: ags.filter((a) => (a.currency || 'SYP') === c), deliveries: dls, payments: pays.filter((x) => (x.currency || 'SYP') === c) }); return { c, rec: round2(p.receivable + (c === 'SYP' ? Number(r.openingBalance || 0) : 0)), cr: p.unappliedCredit }; });
        const show = (r, k, cls) => { const items = per(r).filter((x) => x[k] !== 0); return items.length ? <div className="space-y-0.5">{items.map((x) => <div key={x.c} className={`num font-bold ${cls(x[k])}`}>{money(x[k], x.c)}</div>)}</div> : <b className="num text-slate-400">0</b>; };
        return [{ key: 'name', label: 'العميل' }, { key: 'phone', label: 'الهاتف' }, { key: 'status', label: 'الحالة', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> },
          { key: 'rec', label: 'الذمم المدينة (عليه)', render: (r) => show(r, 'rec', (v) => (v > 0 ? 'text-rose-600' : 'text-sky-700')) },
          { key: 'cr', label: 'دفعات مقدمة غير مطبّقة (له)', render: (r) => show(r, 'cr', () => 'text-emerald-700') }];
      }}
      rowActions={(r) => <button className="rounded p-1.5 hover:bg-slate-100" title="كشف حساب" onClick={() => setStm(r)}><FileText size={15} /></button>} />
    {stm && <StatementModal customer={stm} onClose={() => setStm(null)} />}
  </>);
}

// ───────── الشركاء
function LedgerModal({ partner, onClose }) {
  const { user, can } = useAuth(); const s = useSettings();
  const entries = useCol('partnerCapitalTransactions').rows; const animals = useCol('animals').rows;
  const cashAll = useCol('cashTransactions').rows; const loansAll = useCol('partnerLoans').rows; const repsAll = useCol('partnerLoanRepayments').rows; const evAll = useCol('animalEvents').rows; const payAll = useCol('expensePayments').rows; const expAll = useCol('expenses').rows;
  const [edE, setEdE] = useState(null); const [err, setErr] = useState('');
  const lctx = { ledger: entries, cash: cashAll, loans: loansAll, reps: repsAll, events: evAll, animals, pays: payAll, expenses: expAll };
  const hasCash = (e) => !!e.expensePaymentId || cashAll.some((x) => !x.voided && (x.ledgerEntryId === e.id || (e.type === 'loan_given' && x.loanId === e.loanId && x.type === 'loan_received')));
  const dbt = partnerDebt(partner.id, entries);
  const [c, setC] = useState('SYP'); const [type, setType] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [mv, setMv] = useState(false);
  const L = partnerLedger(partner.id, type ? entries.filter((e) => e.type === type) : entries, { currency: c, from, to });
  const tagOf = (id) => animals.find((a) => a.id === id)?.tag;
  const rows = L.rows.map((r) => ({ ...r, typeAr: LEDGER_AR[r.type] || r.type, what: [LEDGER_AR[r.type] || r.type, r.animalId && tagOf(r.animalId) ? `(${tagOf(r.animalId)})` : '', r.note || r.description || ''].filter(Boolean).join(' — '), credit: r.delta > 0 ? r.delta : 0, debit: r.delta < 0 ? -r.delta : 0 }));
  const report = { farm: s.farmName, title: `كشف حساب الشريك - ${partner.name}`, from, to, currency: c, columns: [{ key: 'date', label: 'التاريخ', type: 'date' }, { key: 'what', label: 'البيان' }, { key: 'credit', label: 'له (يزيد مستحقه)', type: 'money' }, { key: 'debit', label: 'عليه (سداد / سحب)', type: 'money' }, { key: 'balance', label: 'الرصيد', type: 'money' }], rows,
    totals: { credit: round2(rows.reduce((a, r) => a + r.credit, 0)), debit: round2(rows.reduce((a, r) => a + r.debit, 0)) }, summary: [{ label: 'سلف مستحقة', value: dbt.loans }, { label: 'ثمن حيوانات مستحق', value: dbt.purchases }, { label: 'مصروفات/مبالغ دفعها', value: dbt.other }, { label: 'سحوبات وسلف أخذها', value: dbt.withdrawals + dbt.advances }, { label: 'الرصيد الختامي', value: L.closing }] };
  return (
    <Modal open onClose={onClose} title={report.title} wide>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select className="input w-full sm:w-28" value={c} onChange={(e) => setC(e.target.value)}>{CURRENCIES.map(([v]) => <option key={v}>{v}</option>)}</select>
        <select className="input w-full sm:w-44" value={type} onChange={(e) => setType(e.target.value)}><option value="">كل الأنواع</option>{LEDGER_TYPES.filter((t) => t !== 'opening_balance').map((t) => <option key={t} value={t}>{LEDGER_AR[t]}</option>)}</select>
        <input type="date" className="input w-full sm:w-36" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-full sm:w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        <ExportButtons report={report} />{can('create') && <button className="btn btn-primary" onClick={() => setMv(true)}>تسجيل حركة</button>}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="سلف مستحقة" value={<span className="text-base">{fmt(dbt.loans)}</span>} tone="amber" /><Stat label="ثمن بقر مستحق" value={<span className="text-base">{fmt(dbt.purchases)}</span>} tone="amber" /><Stat label="مصروفات/مبالغ دفعها" value={<span className="text-base">{fmt(dbt.other)}</span>} tone="amber" />
        <Stat label="إجمالي المستحق له" value={<span className="text-base">{fmt(dbt.total)}</span>} tone="red" /><Stat label="سحوبات وسلف أخذها" value={<span className="text-base">{fmt(dbt.withdrawals + dbt.advances)}</span>} /><Stat label="توزيعات أرباح استلمها" value={<span className="text-base">{fmt(dbt.distributions)}</span>} /></div>
      <Table columns={[{ key: 'date', label: 'التاريخ' }, { key: 'what', label: 'البيان' }, { key: 'credit', label: 'له', render: (r) => (r.credit ? <span className="num font-bold text-emerald-700">{fmt(r.credit)}</span> : '—') }, { key: 'debit', label: 'عليه', render: (r) => (r.debit ? <span className="num font-bold text-rose-600">{fmt(r.debit)}</span> : '—') }, { key: 'balance', label: 'الرصيد', render: (r) => <b className="num">{fmt(r.balance)}</b> },
        { key: '_a', label: '', render: (r) => (r.type === 'profit_allocation' ? <span className="text-xs text-slate-400" title="ألغِ التسوية من صفحة التسويات">من التسويات</span> : <div className="flex gap-1">
          {can('update') && <button className="rounded p-1.5 hover:bg-slate-100" title="تعديل البند" onClick={() => { setErr(''); setEdE(r); }}><Pencil size={15} /></button>}
          {can('voidFinancial') && <button className="rounded p-1.5 text-rose-600 hover:bg-rose-50" title="حذف البند" onClick={async () => { const why = prompt('سبب حذف هذا البند؟ (يُلغى معه ما يرتبط به)'); if (!why) return; try { await voidLedgerEntry(user, r, lctx, why); } catch (e) { alert(e.message); } }}><Ban size={15} /></button>}</div>) }]} rows={rows} empty={<Empty title="لا توجد حركات" />}
        footer={<tr><td colSpan={2} className="px-3 py-2">الإجمالي</td><td className="px-3 py-2 num">{fmt(report.totals.credit)}</td><td className="px-3 py-2 num">{fmt(report.totals.debit)}</td><td className="px-3 py-2 num">{fmt(L.closing)}</td></tr>} />
      <div className="mt-3 text-xs text-slate-500"><b>له</b> = يزيد مستحق الشريك على المزرعة (قرض، ثمن حيوان دفعه، مصروف دفعه، مبلغ زائد، حصة أرباح). <b>عليه</b> = ما سُدِّد له أو سحبه أو وُزِّع عليه. الرصيد الموجب = مستحق للشريك.</div>
      {edE && <FormModal open onClose={() => setEdE(null)} title={`تعديل بند: ${LEDGER_AR[edE.type] || edE.type}`} fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, ...(hasCash(edE) ? [{ ...acct, label: 'الصندوق (للحركة النقدية المرتبطة)' }] : []), { name: 'note', label: 'البيان / ملاحظة', type: 'text' }]}
        defaults={{ date: edE.date, amount: edE.amount, accountId: cashAll.find((x) => !x.voided && x.ledgerEntryId === edE.id)?.accountId || '', note: edE.note || '' }} onSubmit={(d) => updateLedgerEntry(user, edE, lctx, d)} />}
      <FormModal open={mv} onClose={() => setMv(false)} title="حركة شريك (مع قيد الصندوق المرتبط)" submitLabel="تسجيل"
        fields={[{ name: 'type', label: 'النوع', type: 'select', required: true, options: [['additional_capital', 'دفع مبلغاً زائداً للمزرعة (يدخل الصندوق ويُقيَّد له)'], ['withdrawal', 'سحب (يخرج من الصندوق)'], ['profit_distribution', 'توزيع أرباح نقدي']] }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, cur, { ...acct, required: true }, { name: 'note', label: 'ملاحظة', type: 'text' }]}
        defaults={{ type: 'additional_capital', date: today(), amount: '', currency: 'SYP', accountId: '', note: '' }} onSubmit={(d) => partnerMovement(user, { ...d, partnerId: partner.id })} />
    </Modal>
  );
}

export function Partners() {
  const { user, can } = useAuth(); const [led, setLed] = useState(null); const [pay, setPay] = useState(null);
  return (<>
    <CrudPage title="الشركاء" subtitle="حساب كل شريك = سلف أعطاها للمزرعة + ثمن حيوانات دفعها من ماله. يزيد تلقائياً مع كل قرض/شراء، وتُسدَّد له من الصندوق (السلف أولاً)." col="partners" searchKeys={['name', 'phone']}
      useCtx={() => ({ led: useCol('partnerCapitalTransactions').rows, loans: useCol('partnerLoans').rows, reps: useCol('partnerLoanRepayments').rows, cash: useCol('cashTransactions').rows })}
      extraHeader={<ResetCapital />}
      fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف / التواصل', type: 'text' }, { name: 'ownershipPct', label: 'نسبة الملكية %', type: 'number', min: 0, required: true }, { name: 'profitSharePct', label: 'نسبة الأرباح %', type: 'number', min: 0, required: true }, { name: 'joinDate', label: 'تاريخ الانضمام', type: 'date' }, { name: 'status', label: 'الحالة', type: 'select', options: [['active', 'نشط'], ['inactive', 'غير نشط']], required: true, default: 'active' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      summary={(rows, ctx) => { const o = round2(rows.reduce((a, p) => a + Number(p.ownershipPct || 0), 0)), pr = round2(rows.reduce((a, p) => a + Number(p.profitSharePct || 0), 0));
        const debts = rows.map((p) => partnerDebt(p.id, ctx.led)); const S = (k) => round2(debts.reduce((a, x) => a + x[k], 0));
        return rows.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"><Stat label="مجموع نسب الملكية" value={`${o}%`} tone={o === 100 ? 'green' : 'amber'} /><Stat label="مجموع نسب الأرباح" value={`${pr}%`} tone={pr === 100 ? 'green' : 'red'} />
          <Stat label="سلف مستحقة للشركاء" value={<span className="text-base sm:text-xl">{money(S('loans'))}</span>} tone="amber" /><Stat label="ثمن حيوانات مستحق" value={<span className="text-base sm:text-xl">{money(S('purchases'))}</span>} tone="amber" /><Stat label="مصروفات/مبالغ دفعوها" value={<span className="text-base sm:text-xl">{money(S('other'))}</span>} tone="amber" /><Stat label="إجمالي المستحق للشركاء" value={<span className="text-base sm:text-xl">{money(S('total'))}</span>} tone="red" /></div> : null; }}
      cols={(ctx) => [{ key: 'name', label: 'الشريك' }, { key: 'phone', label: 'التواصل', hideMobile: true },
        { key: 'ln', label: 'سلف مستحقة', render: (r) => <span className="num">{fmt(partnerDebt(r.id, ctx.led).loans)}</span> },
        { key: 'pu', label: 'ثمن بقر مستحق', render: (r) => <span className="num">{fmt(partnerDebt(r.id, ctx.led).purchases)}</span> },
        { key: 'ot', label: 'مصروفات/مبالغ دفعها', render: (r) => <span className="num">{fmt(partnerDebt(r.id, ctx.led).other)}</span> },
        { key: 'wd', label: 'سحوبات وسلف أخذها', render: (r) => { const x = partnerDebt(r.id, ctx.led); return <span className="num">{fmt(x.withdrawals + x.advances)}</span>; } },
        { key: 'tt', label: 'إجمالي المستحق له', render: (r) => <b className="num text-rose-600">{fmt(partnerDebt(r.id, ctx.led).total)}</b> },
        { key: 'ownershipPct', label: 'الملكية', render: (r) => `${r.ownershipPct}%` }, { key: 'profitSharePct', label: 'الأرباح', render: (r) => `${r.profitSharePct}%` }, { key: 'status', label: 'الحالة', hideMobile: true, render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> }]}
      rowActions={(r, ctx) => <>
        <button className="rounded p-1.5 hover:bg-slate-100" title="دفتر الشريك" onClick={() => setLed(r)}><BookOpen size={15} /></button>
        {can('create') && partnerDebt(r.id, ctx.led).total > 0 && <button className="rounded p-1.5 text-emerald-700 hover:bg-emerald-50" title="سداد للشريك من الصندوق" onClick={() => setPay({ p: r, ctx })}><HandCoins size={15} /></button>}</>} />
    {led && <LedgerModal partner={led} onClose={() => setLed(null)} />}
    {pay && (() => { const dbt = partnerDebt(pay.p.id, pay.ctx.led); return <FormModal open onClose={() => setPay(null)} title={`سداد لـ ${pay.p.name}`} submitLabel="تسجيل السداد"
      fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: `المبلغ (سلف ${fmt(dbt.loans)} + ثمن بقر ${fmt(dbt.purchases)} + مصروفات/مبالغ ${fmt(dbt.other)} = ${fmt(dbt.total)})`, type: 'number', required: true, positive: true }, { name: 'accountId', label: 'الصندوق الذي يُسدَّد منه (يجب أن يكفي رصيده)', type: 'rel', col: 'cashAccounts', required: true },
        { name: 'order', label: 'ترتيب السداد', type: 'select', required: true, default: 'loans_first', options: [['loans_first', 'السلف أولاً ثم ثمن البقر ثم المصروفات (الأولوية للسلف)'], ['purchases_first', 'ثمن البقر أولاً ثم السلف'], ['loans_only', 'السلف فقط'], ['purchases_only', 'ثمن البقر فقط'], ['other_only', 'المصروفات/المبالغ فقط']] }]}
      defaults={{ date: today(), order: 'loans_first' }} onSubmit={(d) => repayPartner(user, pay.p, { ledger: pay.ctx.led, loans: pay.ctx.loans, repayments: pay.ctx.reps, cash: pay.ctx.cash }, { date: d.date, amount: Number(d.amount), accountId: d.accountId, order: d.order })} />; })()}
  </>);
}
/** زر يظهر فقط لو في قيود «رأس مال ابتدائي» قديمة: الحساب صار يُبنى من القروض وأثمان الحيوانات فلا حاجة لها. */
function ResetCapital() {
  const { user, can } = useAuth(); const led = useCol('partnerCapitalTransactions').rows; const [err, setErr] = useState('');
  const n = led.filter((e) => e.type === 'capital_contribution' && e.opening && !e.animalId && !e.voided).length;
  if (!n || !can('voidFinancial')) return null;
  return <button className="btn btn-ghost" title="رأس المال الابتدائي لم يعد جزءاً من حساب الشريك" onClick={async () => { setErr(''); if (!confirm(`إلغاء ${n} قيد رأس مال ابتدائي من حسابات الشركاء؟ (يبقى في سجل التدقيق)`)) return; try { await voidInitialCapital(user, led); } catch (e) { alert(e.message); } }}>إلغاء رأس المال الابتدائي ({n})</button>;
}

// ───────── المواشي
const animalCtx = () => ({ events: useCol('animalEvents').rows, animals: useCol('animals').rows, production: useCol('milkProduction').rows, expenses: useCol('expenses').rows, cash: useCol('cashTransactions').rows, ledger: useCol('partnerCapitalTransactions').rows });
// الشريك الافتراضي لدفع المشتريات: من اسمه «وليد» (أبو وليد)، أو الشريك الوحيد إن وُجد واحد فقط
const useDefaultPayer = () => { const ps = useCol('partners').rows.filter((p) => !p.voided); return ps.find((p) => /وليد/.test(p.name || ''))?.id || (ps.length === 1 ? ps[0].id : ''); };
const payShow = (v) => v.origin === 'purchase' || (v.origin === undefined && v.withCalf === 'yes' && Number(v.calfCost) > 0);
const checkCalf = (d, motherTag, animals) => {
  const c = validateNewAnimal(d.calfTag, animals); if (!c.ok) throw new Error(c.reason === 'duplicate' ? 'رقم الصغير مسجّل مسبقاً' : 'أدخل رقم الصغير');
  if (String(d.calfTag).trim().toLowerCase() === String(motherTag).trim().toLowerCase()) throw new Error('رقم الصغير يجب أن يختلف عن رقم الأم');
};
/** تسجيل صغير لأمّ (جديدة أو موجودة): الحيوان + حدث الولادة/الشراء + حركة الصندوق إن كان له سعر. */
async function addCalf(u, motherId, mother, d, { origin, date, currency, pay }) {
  const tag = String(d.calfTag).trim(); const cost = Number(d.calfCost || 0);
  const cid = await createAnimal(u, { motherTag: mother.tag, tag, name: d.calfName || '', category: d.calfCategory || 'heifer_calf', sex: d.calfSex || 'F', breed: d.calfBreed || mother.breed || '', origin, sellerName: mother.sellerName || '', birthDate: d.calfBirthDate || '', acquisitionDate: date, acquisitionCost: cost, currency, healthStatus: d.calfHealth || 'healthy', motherId, pregnant: 'na', withMother: true, photo: d.calfPhoto || '' });
  const p = origin === 'purchase' ? animalPurchasePayment({ ...pay, cost, date, currency, tag, animalId: cid }) : { cash: null, ledger: null, extra: {} };
  await recordAnimalEvent(u, { animalId: cid, tag, type: origin, date, value: cost, currency, motherId, ...p.extra }, p.cash, p.ledger);
}
/** تدقيق مشتريات الحيوانات: لكل شراء — هل هو من رأس المال؟ هل له حركة في الصندوق؟ ويكشف الشراء المسجّل مرتين (رأس مال + صندوق). */
function PurchaseAudit({ payer, onClose }) {
  const { user, can } = useAuth();
  const animals = useCol('animals').rows.filter((a) => !a.voided); const events = useCol('animalEvents').rows; const cash = useCol('cashTransactions').rows; const ledger = useCol('partnerCapitalTransactions').rows; const partners = useCol('partners').rows.filter((p) => !p.voided);
  const [pid, setPid] = useState(payer || ''); const [err, setErr] = useState('');
  const cashFor = (a) => cash.filter((t) => !t.voided && t.type === 'animal_purchase' && (t.animalId === a.id || (!t.animalId && t.description === `شراء ${a.tag}`)));
  const rows = events.filter((e) => !e.voided && e.type === 'purchase' && Number(e.value) > 0).map((e) => { const a = animals.find((x) => x.id === e.animalId); if (!a) return null;
    const cs = cashFor(a); const cashAmt = round2(cs.reduce((s, t) => s + Number(t.amount || 0), 0)); const cap = ['partner', 'capital'].includes(e.paidFrom);
    return { id: e.id, ev: e, a, cs, tag: a.tag, date: e.date, value: Number(e.value), cap, cashAmt, st: cap && cashAmt > 0 ? 'both' : cap ? 'capital' : cashAmt > 0 ? 'cash' : 'none' }; }).filter(Boolean).sort((x, y) => x.date.localeCompare(y.date));
  const sum = (f) => round2(rows.filter(f).reduce((s, r) => s + r.value, 0));
  const both = rows.filter((r) => r.st === 'both'); const ST = { both: ['مسجّل مرتين', 'red'], capital: ['من حساب شريك', 'green'], cash: ['من الصندوق', 'amber'], none: ['بلا مصدر دفع', 'gray'] };
  const run = async (fn) => { setErr(''); try { await fn(); } catch (e) { setErr(e.message); } };
  return (
    <Modal open onClose={onClose} title="تدقيق مشتريات الحيوانات" wide>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4"><Stat label="إجمالي المشتريات" value={<span className="text-base">{fmt(sum(() => true))}</span>} /><Stat label="من حساب شريك" value={<span className="text-base">{fmt(sum((r) => r.cap))}</span>} tone="green" /><Stat label="من الصندوق فقط" value={<span className="text-base">{fmt(sum((r) => r.st === 'cash'))}</span>} tone="amber" /><Stat label="مسجّل مرتين" value={<span className="text-base">{fmt(sum((r) => r.st === 'both'))}</span>} tone="red" /></div>
      {both.length > 0 && <div className="mb-3 rounded-lg bg-red-50 p-3 text-sm font-bold text-red-700">{both.length} عملية شراء مسجّلة على حساب شريك <u>ومن الصندوق معاً</u> — لذلك رصيد الصندوق ناقص بنفس المبلغ. احذف حركة الصندوق المكرّرة (الشراء يبقى على حساب الشريك).</div>}
      {err && <div className="mb-2 text-sm font-bold text-red-600">{err}</div>}
      <div className="mb-3 flex flex-wrap items-end gap-2">
        {rows.some((r) => !r.cap) && <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">الشريك (للربط بحسابه)</span><select className="input sm:w-48" value={pid} onChange={(e) => setPid(e.target.value)}><option value="">— اختر —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>}
        {both.length > 0 && can('voidFinancial') && <button className="btn btn-danger" onClick={() => run(async () => { if (!confirm(`إلغاء ${both.reduce((n, r) => n + r.cs.length, 0)} حركة شراء من الصندوق (الشراء يبقى من رأس المال)؟`)) return; await voidCashTransactions(user, both.flatMap((r) => r.cs), 'شراء مسجّل مرتين: يبقى على حساب الشريك'); })}>إلغاء كل المكرّر من الصندوق ({both.length})</button>}
      </div>
      <Table rows={rows} empty={<Empty title="لا توجد مشتريات حيوانات" />} columns={[{ key: 'date', label: 'التاريخ' }, { key: 'tag', label: 'الحيوان' }, { key: 'value', label: 'السعر', render: (r) => <b className="num">{fmt(r.value)}</b> }, { key: 'cashAmt', label: 'في الصندوق', render: (r) => (r.cashAmt ? <span className="num">{fmt(r.cashAmt)}</span> : '—') },
        { key: 'st', label: 'المصدر', render: (r) => <Badge tone={ST[r.st][1]}>{ST[r.st][0]}</Badge> },
        { key: '_a', label: '', render: (r) => <div className="flex flex-wrap gap-1">
          {r.st === 'both' && can('voidFinancial') && <button className="btn btn-danger !px-2.5 !py-1 text-xs" onClick={() => run(() => voidCashTransactions(user, r.cs, 'شراء مسجّل مرتين: يبقى على حساب الشريك'))}>احذف من الصندوق</button>}
          {(r.st === 'cash' || r.st === 'none') && can('update') && <button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => run(async () => { if (!pid) throw new Error('اختر الشريك أولاً'); await linkPurchasesToPartner(user, [r.a], { events: [r.ev], cash, ledger }, pid); })}>اربطه بحساب الشريك</button>}</div> }]} />
    </Modal>
  );
}
/** يربط كل مشتريات الحيوانات السابقة بحساب شريك (يُقيَّد ثمنها في حسابه مستحقاً له)، ويرفعها من الصندوق لو كانت مسجّلة منه، وينقل ما كان «من رأس مال» لحساب نفس الشريك. */
function LinkCapitalPurchases({ payer }) {
  const { user, can } = useAuth(); const animals = useCol('animals').rows.filter((a) => !a.voided); const events = useCol('animalEvents').rows; const cash = useCol('cashTransactions').rows; const ledger = useCol('partnerCapitalTransactions').rows; const [open, setOpen] = useState(false);
  const pending = events.filter((e) => !e.voided && e.type === 'purchase' && Number(e.value) > 0 && e.paidFrom !== 'partner' && animals.some((a) => a.id === e.animalId));
  if (!pending.length || !can('update')) return null;
  const total = pending.reduce((a, e) => a + Number(e.value), 0);
  return (<><button className="btn btn-ghost" onClick={() => setOpen(true)}><Landmark size={16} />ربط المشتريات بحساب شريك ({pending.length})</button>
    {open && <FormModal open onClose={() => setOpen(false)} title={`ربط ${pending.length} عملية شراء (${fmt(total)}) بحساب شريك`} submitLabel="ربط الكل" fields={[{ name: 'partnerId', label: 'الشريك الذي دفع (يُسجَّل المبلغ في حسابه)', type: 'rel', col: 'partners', required: true }]} defaults={{ partnerId: payer }}
      onSubmit={(d) => linkPurchasesToPartner(user, animals, { events, cash, ledger }, d.partnerId)} />}</>);
}
export function Animals() {
  const [sale, setSale] = useState(null); // null | true | animalId
  const [view, setView] = useState(null); // صورة مكبّرة
  const payer = useDefaultPayer(); const [audit, setAudit] = useState(false); const lists = useCustomLists();
  const calfF = (o) => ({ showIf: (v) => v.withCalf === 'yes', ...o });
  const fields = [
    { name: 'tag', label: 'رقم الحيوان (Tag)', type: 'text', required: true }, { name: 'name', label: 'الاسم', type: 'text' }, { name: 'photo', label: 'صورة الحيوان', type: 'image' },
    { name: 'category', label: 'الفئة', type: 'select', required: true, options: [...allAnimalCategories(), NEW_CAT], default: 'cow' }, { name: 'newCategory', label: 'اسم الفئة الجديدة', type: 'text', showIf: (v) => v.category === '__new__' }, { name: 'sex', label: 'الجنس', type: 'select', required: true, options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'breed', label: 'السلالة', type: 'text' },
    { name: 'origin', label: 'المصدر', type: 'select', required: true, options: [['purchase', 'شراء'], ['birth', 'مولود بالمزرعة'], ['opening', 'رصيد افتتاحي (موجود مسبقاً)']] },
    { name: 'sellerName', label: 'جهة الشراء (البائع/السوق)', type: 'text', showIf: (v) => v.origin === 'purchase' },
    { name: 'birthDate', label: 'تاريخ الميلاد', type: 'date' }, { name: 'ageAtPurchaseMonths', label: 'العمر عند الشراء (شهر) — إن لم يُعرف تاريخ الميلاد', type: 'number', min: 0 },
    { name: 'acquisitionDate', label: 'تاريخ الشراء / الاقتناء', type: 'date', required: true }, { name: 'acquisitionCost', label: 'سعر الشراء', type: 'number', min: 0 }, cur,
    { name: 'payFrom', label: 'مصدر دفع ثمن الشراء', type: 'select', options: [['partner', 'شريك دفع ثمنها أو اشتريناها منه — يُسجَّل المبلغ في حسابه ويُسدَّد له لاحقاً'], ['account', 'من صندوق المزرعة']], default: 'partner', showIf: payShow },
    { name: 'payPartnerId', label: 'الشريك (الدافع أو البائع) — يذهب المبلغ لحسابه', type: 'rel', col: 'partners', showIf: (v) => payShow(v) && (v.payFrom || 'partner') === 'partner' },
    { ...acct, label: 'الصندوق الذي دُفع منه', showIf: (v) => payShow(v) && v.payFrom === 'account' },
    { name: 'milkAtPurchase', label: 'كمية الحليب التي تعطيها عند الشراء (لتر/يوم)', type: 'number', min: 0, showIf: (v) => v.sex === 'F' },
    { name: 'pregnant', label: 'حامل عند الشراء؟', type: 'select', options: [['na', 'لا ينطبق'], ['no', 'لا'], ['yes', 'نعم']], showIf: (v) => v.sex === 'F' },
    { name: 'daysToBirth', label: 'عدد الأيام المتبقية على الولادة (من تاريخ الشراء)', type: 'number', min: 0, showIf: (v) => v.sex === 'F' && v.pregnant === 'yes' },
    { name: 'healthStatus', label: 'الحالة الصحية', type: 'select', options: [['healthy', 'سليم'], ['sick', 'مريض']], default: 'healthy' },
    { name: 'motherId', label: 'الأم', type: 'rel', col: 'animals', optLabel: animalOpt }, { name: 'fatherId', label: 'الأب', type: 'rel', col: 'animals', optLabel: animalOpt },
    { name: 'withCalf', label: 'هل معها عجل / عجلة صغيرة؟ (تقدر تضيفه لاحقاً من التعديل)', type: 'select', options: [['no', 'لا'], ['yes', 'نعم — سجّل الصغير']], default: 'no' },
    calfF({ name: 'calfTag', label: 'رقم الصغير *', type: 'text' }), calfF({ name: 'calfName', label: 'اسم الصغير', type: 'text' }),
    calfF({ name: 'calfCategory', label: 'فئة الصغير', type: 'select', options: [...allAnimalCategories(), NEW_CAT], default: 'heifer_calf' }), calfF({ name: 'calfNewCategory', label: 'اسم فئة الصغير الجديدة', type: 'text', showIf: (v) => v.withCalf === 'yes' && v.calfCategory === '__new__' }), calfF({ name: 'calfSex', label: 'جنس الصغير', type: 'select', options: [['F', 'أنثى'], ['M', 'ذكر']], default: 'F' }),
    calfF({ name: 'calfBreed', label: 'سلالة الصغير (فارغ = سلالة الأم)', type: 'text' }), calfF({ name: 'calfBirthDate', label: 'تاريخ ولادة الصغير', type: 'date' }),
    calfF({ name: 'calfCost', label: 'سعر الصغير (0 أو فارغ إن كان ضمن سعر الأم)', type: 'number', min: 0 }), calfF({ name: 'calfHealth', label: 'الحالة الصحية للصغير', type: 'select', options: [['healthy', 'سليم'], ['sick', 'مريض']], default: 'healthy' }), calfF({ name: 'calfPhoto', label: 'صورة الصغير', type: 'image' }),
    { name: 'notes', label: 'ملاحظات', type: 'textarea' }];
  return (<>
    <CrudPage title="المواشي والعجول" subtitle="رقم الحيوان فريد. اضغط أيقونة التفاصيل لعرض بيانات الحيوان وبيعه" col="animals" searchKeys={['tag', 'name', 'breed']} useCtx={animalCtx}
      extraHeader={<><LinkCapitalPurchases payer={payer} /><button className="btn btn-ghost" onClick={() => setAudit(true)}>تدقيق المشتريات</button><button className="btn btn-ghost" onClick={() => setSale(true)}>بيع حيوان</button></>}
      fields={fields} defaults={{ payFrom: 'partner', payPartnerId: payer }} createOnlyFields={['origin']} onVoid={(u, r, ctx, why) => voidAnimalCascade(u, r, ctx, why)}
      create={async (u, d, { animals }) => {
        const ok = validateNewAnimal(d.tag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'رقم الحيوان مطلوب');
        const calf = d.withCalf === 'yes'; if (calf) checkCalf(d, d.tag, animals);
        let { origin, accountId, payFrom, payPartnerId, withCalf, calfTag, calfName, calfCategory, calfSex, calfBreed, calfBirthDate, calfCost, calfHealth, calfPhoto, newCategory, calfNewCategory, ...rest } = d;
        if (rest.category === '__new__') rest.category = await addCustomCategory(u, 'animal', newCategory, lists.animal);
        if (calf && calfCategory === '__new__') calfCategory = await addCustomCategory(u, 'animal', calfNewCategory, lists.animal);
        const pay = { from: payFrom || 'partner', partnerId: payPartnerId, accountId };
        if (origin === 'purchase') { animalPurchasePayment({ ...pay, cost: d.acquisitionCost, date: d.acquisitionDate, currency: d.currency, tag: d.tag }); if (calf) animalPurchasePayment({ ...pay, cost: calfCost, date: d.acquisitionDate, currency: d.currency, tag: calfTag }); } // تحقّق قبل الحفظ
        const id = await createAnimal(u, { ...rest, origin, pregnant: d.sex === 'F' ? d.pregnant || 'na' : 'na', healthStatus: d.healthStatus || 'healthy' });
        const mp = origin === 'purchase' ? animalPurchasePayment({ ...pay, cost: d.acquisitionCost, date: d.acquisitionDate, currency: d.currency, tag: d.tag, animalId: id }) : { cash: null, ledger: null, extra: {} };
        await recordAnimalEvent(u, { animalId: id, tag: d.tag, type: origin, date: d.acquisitionDate, value: d.acquisitionCost || 0, currency: d.currency, ...mp.extra }, mp.cash, mp.ledger);
        if (calf) await addCalf(u, id, { ...rest, id }, { ...d, calfCategory }, { origin, date: d.acquisitionDate, currency: d.currency, pay });
      }}
      update={async (u, d, edit, { animals }) => {
        let { withCalf, calfTag, calfName, calfCategory, calfSex, calfBreed, calfBirthDate, calfCost, calfHealth, calfPhoto, payFrom, payPartnerId, accountId, newCategory, calfNewCategory, ...rest } = d;
        if (String(rest.tag || '').trim().toLowerCase() !== String(edit.tag).trim().toLowerCase()) { const ok = validateNewAnimal(rest.tag, animals.filter((a) => a.id !== edit.id)); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'رقم الحيوان مطلوب'); }
        const calf = withCalf === 'yes'; if (calf) checkCalf(d, rest.tag, animals);
        const cost = Number(calfCost || 0); const cdate = calfBirthDate || today(); const cur2 = edit.currency || d.currency || 'SYP';
        const pay = { from: payFrom || 'partner', partnerId: payPartnerId, accountId };
        if (calf && cost > 0) animalPurchasePayment({ ...pay, cost, date: cdate, currency: cur2, tag: calfTag }); // تحقّق قبل الحفظ
        if (rest.category === '__new__') rest.category = await addCustomCategory(u, 'animal', newCategory, lists.animal);
        if (calf && calfCategory === '__new__') calfCategory = await addCustomCategory(u, 'animal', calfNewCategory, lists.animal);
        await saveRecord(u, 'animals', rest, edit.id);
        // إضافة صغير لحيوان موجود: مولود بالمزرعة (أو مشترى لو أدخلت له سعراً)
        if (calf) await addCalf(u, edit.id, { ...edit, ...rest }, { ...d, calfCategory }, { origin: cost > 0 ? 'purchase' : 'birth', date: cdate, currency: cur2, pay });
      }}
      summary={(rows, ctx) => { const h = herdState(ctx.events, ctx.animals); const soon = rows.filter((r) => h[r.id]?.active && (animalProfile(r, ctx).daysToCalving ?? 999) <= 30 && animalProfile(r, ctx).daysToCalving !== null).length;
        return <div className="grid grid-cols-2 gap-3 sm:grid-cols-5"><Stat label="القطيع النشط" value={Object.values(h).filter((x) => x.active).length} /><Stat label="مريض" value={rows.filter((r) => h[r.id]?.active && r.healthStatus === 'sick').length} tone="red" /><Stat label="ولادات خلال 30 يوم" value={soon} tone="amber" /><Stat label="إجمالي السجلات" value={rows.length} /><Stat label="خرجت من القطيع" value={Object.values(h).filter((x) => !x.active).length} /></div>; }}
      cols={(ctx) => { const h = herdState(ctx.events, ctx.animals); return [{ key: 'photo', label: 'الصورة', render: (r) => <Avatar src={r.photo} size={44} alt={r.tag} onClick={r.photo ? () => setView(r) : undefined} /> }, { key: 'tag', label: 'الرقم' }, { key: 'name', label: 'الاسم' },
        { key: 'fam', label: 'الأم / الصغار', render: (r) => { const mom = ctx.animals.find((a) => a.id === r.motherId); const kids = ctx.animals.filter((a) => !a.voided && a.motherId === r.id); return mom || kids.length ? <div className="text-xs leading-relaxed">{mom && <div>أمها: <b>{mom.tag}</b>{mom.name ? ` (${mom.name})` : ''}</div>}{kids.length > 0 && <div>معها صغير: <b>{kids.map((k) => k.tag).join('، ')}</b></div>}</div> : (r.motherTag ? <span className="text-xs">أمها: <b>{r.motherTag}</b></span> : '—'); } },
        { key: 'category', label: 'الفئة', render: (r) => animalCatLabel(r.category) || '—' }, { key: 'sex', label: 'الجنس', hideMobile: true, render: (r) => (r.sex === 'F' ? 'أنثى' : 'ذكر') }, { key: 'breed', label: 'السلالة', hideMobile: true }, { key: 'acquisitionDate', label: 'الشراء', hideMobile: true },
        { key: 'cost', label: 'سعر الشراء', render: (r) => <span className="num">{r.acquisitionCost ? fmt(r.acquisitionCost) : '—'}</span> }, { key: 'age', label: 'العمر (شهر)', render: (r) => animalProfile(r, ctx).ageMonths ?? '—' },
        { key: 'mp', label: 'حليب عند الشراء', hideMobile: true, render: (r) => (r.milkAtPurchase ? <span className="num">{fmt(r.milkAtPurchase)} لتر/يوم</span> : '—') },
        { key: 'milk', label: 'حليب فعلي', render: (r) => { const p = animalProfile(r, ctx); return p.milkTotal ? <span className="num">{fmt(p.milkTotal)} <span className="text-xs text-slate-400">({fmt(p.milkAvg)}/يوم)</span></span> : '—'; } },
        { key: 'calv', label: 'الولادة', render: (r) => { const dd = animalProfile(r, ctx).daysToCalving; return dd === null ? '—' : <Badge tone={dd < 0 ? 'red' : dd <= 30 ? 'amber' : 'blue'}>{dd >= 0 ? `بعد ${dd} يوم` : `متأخرة ${-dd} يوم`}</Badge>; } },
        { key: 'st', label: 'الحالة', render: (r) => { const s = h[r.id]; const t = s?.active ? (r.healthStatus === 'sick' ? 'مريض' : 'نشط') : s ? { sale: 'مباع', death: 'نافق', transfer_out: 'منقول', exchange_out: 'مبادَل' }[s.last] || 'خرج' : 'بلا حدث'; return <Badge tone={t === 'نشط' ? 'green' : t === 'مريض' ? 'red' : s ? 'gray' : 'amber'}>{t}</Badge>; } }]; }}
      rowActions={(r) => <button className="rounded p-1.5 hover:bg-slate-100" title="تفاصيل وبيع" onClick={() => setSale(r.id)}><Info size={15} /></button>} />
    {audit && <PurchaseAudit payer={payer} onClose={() => setAudit(false)} />}
    {sale && <AnimalSale preselectId={sale === true ? null : sale} onClose={() => setSale(null)} />}
    {view && <Modal open onClose={() => setView(null)} title={`${view.tag} ${view.name || ''}`}><img src={view.photo} alt={view.tag} className="mx-auto max-h-[70dvh] w-full rounded-xl object-contain" /></Modal>}
  </>);
}
const evTypes = [['birth', 'ولادة'], ['death', 'نفوق']]; // الشراء والبيع من صفحة «المواشي والعجول» فقط (مكان واحد لتفادي التكرار)
const EVT_AR = { birth: 'ولادة', purchase: 'شراء', death: 'نفوق', sale: 'بيع', opening: 'افتتاحي', exchange_in: 'تبادل (وارد)', exchange_out: 'تبادل (صادر)', transfer_out: 'نقل' };
const animalLabel = (r) => `${r.tag}${r.name ? ' - ' + r.name : ''}`;
export function AnimalEvents() {
  const [sale, setSale] = useState(false); const payer = useDefaultPayer();
  return (<><CrudPage title="المواليد والوفيات" subtitle="تسجيل ولادة ونفوق فقط. للشراء والبيع استخدم «المواشي والعجول» — والجدول هنا يعرض سجل كل الأحداث للاطلاع" col="animalEvents" noEdit useCtx={animalCtx} defaults={{ payFrom: 'partner', payPartnerId: payer }} searchKeys={['tag', 'type']} onVoid={(u, r, ctx, why) => voidAnimalEventCascade(u, r, ctx, why)} filter={(r) => !String(r.type).startsWith('exchange') && r.type !== 'transfer_out' && r.type !== 'opening'}
    fields={[{ name: 'type', label: 'نوع الحدث', type: 'select', options: evTypes, required: true, default: 'birth' }, { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'animalId', label: 'الحيوان (للنفوق/البيع)', type: 'rel', col: 'animals', optLabel: animalLabel }, { name: 'newTag', label: 'رقم الحيوان الجديد (للولادة/الشراء)', type: 'text' }, { name: 'newName', label: 'الاسم', type: 'text' }, { name: 'breed', label: 'السلالة', type: 'text' }, { name: 'sex', label: 'الجنس', type: 'select', options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'motherId', label: 'الأم (للولادة)', type: 'rel', col: 'animals', optLabel: animalLabel }, { name: 'fatherId', label: 'الأب (للولادة)', type: 'rel', col: 'animals', optLabel: animalLabel },
      { name: 'value', label: 'القيمة (شراء/بيع)', type: 'number', min: 0 }, cur,
      { name: 'payFrom', label: 'مصدر دفع ثمن الشراء', type: 'select', options: [['partner', 'دفعه شريك — يُسجَّل في حسابه'], ['account', 'من صندوق المزرعة']], default: 'partner', showIf: (v) => v.type === 'purchase' },
      { name: 'payPartnerId', label: 'الشريك الذي دفع', type: 'rel', col: 'partners', showIf: (v) => v.type === 'purchase' && (v.payFrom || 'partner') === 'partner' },
      { ...acct, showIf: (v) => v.type === 'sale' || (v.type === 'purchase' && v.payFrom === 'account') }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
    create={async (u, d, { animals, events }) => {
      const v0 = Number(d.value || 0); if (d.type === 'sale' && v0 > 0 && !d.accountId) throw new Error('اختر الصندوق لتسجيل الحركة النقدية');
      if (d.type === 'purchase') animalPurchasePayment({ from: d.payFrom || 'partner', partnerId: d.payPartnerId, accountId: d.accountId, cost: v0, date: d.date, currency: d.currency, tag: d.newTag }); // تحقّق قبل الحفظ
      const h = herdState(events, animals); let animalId = d.animalId, tag = animals.find((a) => a.id === animalId)?.tag;
      if (d.type === 'birth' || d.type === 'purchase') {
        const ok = validateNewAnimal(d.newTag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'أدخل رقم الحيوان الجديد');
        animalId = await createAnimal(u, { tag: d.newTag, name: d.newName || '', breed: d.breed || '', sex: d.sex || 'F', acquisitionDate: d.date, acquisitionCost: d.type === 'purchase' ? Number(d.value || 0) : 0, currency: d.currency, motherId: d.motherId || '', fatherId: d.fatherId || '', category: d.type === 'birth' ? 'heifer_calf' : 'cow', origin: d.type === 'birth' ? 'birth' : 'purchase', healthStatus: 'healthy', birthDate: d.type === 'birth' ? d.date : '' }); tag = d.newTag;
      } else { if (!animalId) throw new Error('اختر الحيوان'); if (!h[animalId]?.active) throw new Error('هذا الحيوان غير موجود ضمن القطيع النشط'); }
      const v = v0; const pp = d.type === 'purchase' ? animalPurchasePayment({ from: d.payFrom || 'partner', partnerId: d.payPartnerId, accountId: d.accountId, cost: v, date: d.date, currency: d.currency, tag, animalId }) : { cash: null, ledger: null, extra: {} };
      const cash = pp.cash || (v > 0 && d.type === 'sale' ? { date: d.date, type: 'animal_sale', direction: 'in', amount: v, currency: d.currency, accountId: d.accountId, animalId, description: `بيع ${tag}` } : null);
      await recordAnimalEvent(u, { animalId, tag, type: d.type, date: d.date, value: v, currency: d.currency, motherId: d.motherId || '', notes: d.notes || '', ...pp.extra }, cash, pp.ledger); }}
    cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'الحدث', render: (r) => <Badge tone={r.type === 'death' ? 'red' : r.type === 'birth' ? 'green' : 'blue'}>{EVT_AR[r.type]}</Badge> }, { key: 'tag', label: 'الحيوان' }, { key: 'value', label: 'القيمة', render: (r) => (r.value ? <span className="num">{fmt(r.value)} {r.currency}</span> : '—') }, { key: 'notes', label: 'ملاحظات' }]} />
    {sale && <AnimalSale onClose={() => setSale(false)} />}</>);
}
/** فروق تبادل قديمة دُفعت من الصندوق ← تُنقل إلى حساب شريك (تختار الشريك لكل فرق أو للكل). */
function ExchangeDiffConvert() {
  const { user, can } = useAuth(); const cash = useCol('cashTransactions').rows; const events = useCol('animalEvents').rows; const ledger = useCol('partnerCapitalTransactions').rows; const partners = useCol('partners').rows.filter((p) => !p.voided);
  const payer = useDefaultPayer(); const [open, setOpen] = useState(false); const [sel, setSel] = useState({}); const [all, setAll] = useState(''); const [err, setErr] = useState('');
  const pending = cash.filter((t) => !t.voided && t.type === 'animal_exchange_payment' && !(t.exchangeId && ledger.some((e) => !e.voided && e.type === 'animal_purchase_paid' && e.exchangeId === t.exchangeId))).sort((a, b) => a.date.localeCompare(b.date));
  if (!pending.length || !can('update')) return null;
  const who = (t) => sel[t.id] || all || payer || '';
  const run = async (items) => { setErr(''); try { await switchExchangeDiffToPartner(user, items, { events, ledger }); } catch (e) { setErr(e.message); } };
  const total = round2(pending.reduce((a, t) => a + Number(t.amount), 0));
  return (<><button className="btn btn-ghost" onClick={() => setOpen(true)}><Landmark size={16} />نقل فروق التبادل لحساب شريك ({pending.length})</button>
    {open && <Modal open onClose={() => setOpen(false)} title={`فروق تبادل مدفوعة من الصندوق (${fmt(total)})`} wide>
      <p className="mb-2 text-xs text-slate-500">اختر الشريك الذي دفع كل فرق، فيُقيَّد في حسابه (مستحق له) ويُرفع من الصندوق.</p>
      {err && <div className="mb-2 text-sm font-bold text-red-600">{err}</div>}
      <div className="mb-3 flex flex-wrap items-end gap-2"><label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">شريك للكل</span><select className="input sm:w-48" value={all || payer} onChange={(e) => { setAll(e.target.value); setSel({}); }}><option value="">— اختر —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
        <button className="btn btn-primary" onClick={() => { if (confirm(`نقل ${pending.length} فرق إلى حساب الشريك المختار؟`)) run(pending.map((t) => ({ tx: t, partnerId: who(t) }))); }}>تحويل الكل</button></div>
      <Table rows={pending} columns={[{ key: 'date', label: 'التاريخ' }, { key: 'description', label: 'البيان' }, { key: 'amount', label: 'الفرق', render: (r) => <b className="num">{money(r.amount, r.currency)}</b> },
        { key: 'p', label: 'الشريك', render: (r) => <select className="input !py-1" value={who(r)} onChange={(e) => setSel({ ...sel, [r.id]: e.target.value })}><option value="">— اختر —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select> },
        { key: '_a', label: '', render: (r) => <button className="btn btn-ghost !px-2.5 !py-1 text-xs" onClick={() => run([{ tx: r, partnerId: who(r) }])}>تحويل</button> }]} />
    </Modal>}</>);
}
export function Exchange() {
  const [open, setOpen] = useState(false);
  return (<>
    <CrudPage title="تبادل ونقل المواشي" subtitle="التبادل: حيوان مقابل حيوان مع فرق نقدي — النقل: خروج حيوان إلى جهة أخرى" col="animalEvents" noAdd noEdit fields={[]} useCtx={animalCtx} searchKeys={['tag']} filter={(r) => String(r.type).startsWith('exchange') || r.type === 'transfer_out'}
      extraHeader={<><ExchangeDiffConvert /><button className="btn btn-primary" onClick={() => setOpen(true)}>تبادل / نقل جديد</button></>}
      cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'العملية', render: (r) => EVT_AR[r.type] }, { key: 'tag', label: 'الحيوان' }, { key: 'counterpartTag', label: 'المقابل' }, { key: 'value', label: 'القيمة المتفق عليها', render: (r) => (r.value ? <span className="num">{fmt(r.value)} {r.currency}</span> : '—') }, { key: 'notes', label: 'ملاحظات' }]} />
    {open && <ExchangeModal onClose={() => setOpen(false)} />}
  </>);
}

// ───────── الأعلاف والمخزون
export function Inventory() {
  const [tab, setTab] = useState('mov');
  const items = useCol('stockItems').rows.filter((i) => !i.voided); const mv = useCol('stockMovements').rows.filter((m) => !m.voided);
  const level = (id) => round2(mv.filter((m) => m.itemId === id).reduce((a, m) => a + (m.type === 'in' ? 1 : -1) * Number(m.qty), 0));
  return (<div>
    <div className="mb-3 flex flex-wrap gap-2"><button className={`btn ${tab === 'mov' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('mov')}>الحركات</button><button className={`btn ${tab === 'items' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('items')}>الأصناف</button></div>
    {items.length > 0 && <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">{items.map((i) => { const l = level(i.id); return <Stat key={i.id} label={i.name} value={`${fmt(l)} ${i.unit || ''}`} sub={Number(i.minLevel) && l < Number(i.minLevel) ? '⚠ أقل من حد التنبيه' : undefined} tone={Number(i.minLevel) && l < Number(i.minLevel) ? 'red' : 'green'} />; })}</div>}
    {tab === 'items' ? <CrudPage title="أصناف المخزون" col="stockItems" searchKeys={['name']} fields={[{ name: 'name', label: 'الصنف', type: 'text', required: true }, { name: 'unit', label: 'الوحدة (كغ، كيس…)', type: 'text', required: true }, { name: 'minLevel', label: 'حد التنبيه', type: 'number', min: 0 }]} cols={() => [{ key: 'name', label: 'الصنف' }, { key: 'unit', label: 'الوحدة' }, { key: 'minLevel', label: 'حد التنبيه' }]} />
      : <CrudPage title="الأعلاف والمخزون" subtitle="حركات الوارد والصادر" col="stockMovements" searchKeys={['itemName']} fields={[{ name: 'itemId', label: 'الصنف', type: 'rel', col: 'stockItems', required: true }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'type', label: 'النوع', type: 'select', required: true, options: [['in', 'وارد'], ['out', 'صادر / استهلاك']] }, { name: 'qty', label: 'الكمية', type: 'number', required: true, positive: true }, { name: 'notes', label: 'ملاحظات', type: 'text' }]}
        create={async (u, d) => { if (d.type === 'out' && d.qty > level(d.itemId)) throw new Error('الكمية أكبر من الرصيد المتوفر'); await saveRecord(u, 'stockMovements', { ...d, itemName: items.find((i) => i.id === d.itemId)?.name }); }}
        cols={() => [{ key: 'date', label: 'التاريخ' }, { key: 'itemName', label: 'الصنف' }, { key: 'type', label: 'النوع', render: (r) => <Badge tone={r.type === 'in' ? 'green' : 'amber'}>{r.type === 'in' ? 'وارد' : 'صادر'}</Badge> }, { key: 'qty', label: 'الكمية', render: (r) => <span className="num">{fmt(r.qty)}</span> }, { key: 'notes', label: 'ملاحظات' }]} />}
  </div>);
}
