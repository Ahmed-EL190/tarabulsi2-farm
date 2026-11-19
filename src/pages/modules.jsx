import { useMemo, useState, useRef } from 'react';
import { FileText, BookOpen, Info, Landmark, HandCoins, Pencil, Ban } from 'lucide-react';
import CrudPage, { FormModal } from '../components/CrudPage';
import ExportButtons from '../components/ExportButtons';
import AnimalSale from '../components/AnimalSale';
import ExchangeModal from '../components/ExchangeModal';
import { Card, Stat, Table, Badge, Modal, Empty, PageHeader, Avatar, money, fmt, today } from '../components/ui';
import { useCol, useSettings, useCustomLists, createAnimal, saveRecord, commit, newId } from '../data/db';
import { recordAnimalEvent, partnerMovement, voidAnimalCascade, voidAnimalEventCascade, voidExchange, animalPurchasePayment, linkPurchasesToPartner, voidInitialCapital, repayPartner, switchExchangeDiffToPartner, voidCashTransactions, addCustomCategory, updateLedgerEntry, voidLedgerEntry, changePurchasePayer, changePurchasePrice } from '../data/ops';
import { useAuth } from '../data/auth';
import { customerPosition, customerStatement, partnerLedger, herdState, animalExchange, validateNewAnimal, animalProfile, partnerDebt, cashBalances, herdValue, purchaseSource, round2, LEDGER_TYPES, partnerInvestment, effectiveProfitShares, profitGroupOf, calfFattening, monthsBetween, supplierPayable, animalExchangeInfo, animalResultInfo, monthLabel } from '../lib/finance';
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
  const ags = useCol('milkSales').rows, dls = useCol('milkDeliveries').rows, pays = useCol('customerPayments').rows, exps = useCol('expenses').rows, epays = useCol('expensePayments').rows;
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [cur2, setCur2] = useState('SYP');
  const inCur = (x) => (x.currency || 'SYP') === cur2;
  const st = useMemo(() => customerStatement(customer.id, { agreements: ags.filter(inCur), deliveries: dls, payments: pays.filter(inCur), expenses: exps.filter(inCur), expensePayments: epays, from, to, openingBalance: cur2 === 'SYP' ? Number(customer.openingBalance || 0) : 0 }), [customer, ags, dls, pays, exps, epays, from, to, cur2]); // eslint-disable-line
  // الرصيد: موجب = العميل عليه لنا (مدين) · سالب = للعميل رصيد عندنا (دائن)
  const side = (b) => (b > 0.004 ? `عليه ${fmt(b)}` : b < -0.004 ? `له ${fmt(-b)}` : 'متزن');
  const tone = (b) => (b > 0.004 ? 'text-rose-600' : b < -0.004 ? 'text-sky-700' : 'text-slate-500');
  const agNo = (id) => ags.find((a) => a.id === id)?.number || '';
  const describe = (r) => {
    if (r.kind === 'purchase') { const e = exps.find((x) => x.id === r.ref); return `مشتريات منه (فاتورة): ${e?.description || ''}`; }
    if (r.kind === 'supplier_payment') { const e = exps.find((x) => x.id === r.expenseId); return `دفعنا له: ${e?.description || ''}`; }
    if (r.kind === 'delivery') return `تسليم ${fmt(r.qty)} لتر${agNo(r.ref) ? ' — ' + agNo(r.ref) : ''}`;
    const p = pays.find((x) => x.id === r.ref); const no = agNo(p?.agreementId);
    return `${r.kind === 'refund' ? 'استرداد للعميل' : 'دفعة من العميل'}${no ? ' — ' + no : ''}${p?.note ? ' (' + p.note + ')' : ''}`;
  };
  const rows = [{ id: 'open', date: from || '—', desc: 'رصيد افتتاحي', qty: '', price: '', debit: 0, credit: 0, balance: st.opening }, ...st.rows.map((r, i) => ({ id: i, date: r.date, desc: describe(r), qty: r.kind === 'delivery' ? r.qty : '', price: r.kind === 'delivery' && r.qty ? round2(r.debit / r.qty) : '', debit: r.debit, credit: r.credit, balance: r.balance }))]
    .map((r) => ({ ...r, balLabel: side(r.balance) }));
  const closingTxt = st.closing > 0.004 ? `العميل عليه لنا ${money(st.closing, cur2)}` : st.closing < -0.004 ? `للعميل عندنا ${money(-st.closing, cur2)} (رصيد دائن)` : `الحساب متزن بالـ${cur2 === 'USD' ? 'دولار' : 'ليرة'} — لا يوجد رصيد`;
  const report = { farm: s.farmName, title: `كشف حساب العميل - ${customer.name} (${cur2})`, from, to, currency: cur2, columns: [{ key: 'date', label: 'التاريخ', type: 'date' }, { key: 'desc', label: 'البيان' }, { key: 'qty', label: 'الكمية (لتر)', type: 'number' }, { key: 'price', label: 'سعر اللتر', type: 'money' }, { key: 'debit', label: 'مدين (عليه — مبيعات / ما دفعناه له)', type: 'money' }, { key: 'credit', label: 'دائن (له — مدفوعات / فواتير مشترياتنا منه)', type: 'money' }, { key: 'balance', label: 'الرصيد', type: 'money' }, { key: 'balLabel', label: 'عليه / له' }],
    rows, totals: { debit: st.totalDebit, credit: st.totalCredit }, summary: [{ label: 'الرصيد الافتتاحي', value: st.opening }, { label: 'الرصيد الختامي (موجب = العميل عليه لنا، سالب = له عندنا)', value: st.closing }, { label: 'الخلاصة', value: closingTxt }] };
  const ui = [{ key: 'date', label: 'التاريخ' }, { key: 'desc', label: 'البيان' }, { key: 'qty', label: 'الكمية (لتر)', render: (r) => (r.qty === '' ? '—' : <span className="num">{fmt(r.qty)}</span>) }, { key: 'price', label: 'سعر اللتر', render: (r) => (r.price === '' ? '—' : <span className="num">{fmt(r.price)}</span>) },
    { key: 'debit', label: 'مدين (عليه)', render: (r) => (r.debit ? <span className="num font-bold text-rose-600">{fmt(r.debit)}</span> : '—') }, { key: 'credit', label: 'دائن (له)', render: (r) => (r.credit ? <span className="num font-bold text-emerald-700">{fmt(r.credit)}</span> : '—') },
    { key: 'balance', label: 'الرصيد', render: (r) => <b className={`${tone(r.balance)}`} dir="rtl">{r.balLabel}</b> }];
  return (
    <Modal open onClose={onClose} title={report.title} wide>
      <div className={`mb-3 rounded-xl p-3 text-center text-base font-extrabold sm:text-lg ${st.closing > 0.004 ? 'bg-rose-50 text-rose-700' : st.closing < -0.004 ? 'bg-sky-50 text-sky-700' : 'bg-slate-50 text-slate-600'}`}>{closingTxt}</div>
      <div className="mb-3 grid grid-cols-3 gap-2"><Stat label="رصيد افتتاحي" value={<span className="text-base">{fmt(st.opening)}</span>} /><Stat label="مدين (عليه)" value={<span className="text-base">{fmt(st.totalDebit)}</span>} tone="red" /><Stat label="دائن (له)" value={<span className="text-base">{fmt(st.totalCredit)}</span>} tone="green" /></div>
      <div className="mb-1 text-xs text-slate-500"><b className="text-rose-600">عليه</b> = العميل مدين لنا · <b className="text-sky-700">له</b> = رصيد له عندنا (دفعات مقدّمة، أو علف/مشتريات أخذناها منه ولم ندفعها)</div>
      <div className="mb-3 mt-2 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end"><label className="col-span-2 block sm:col-span-1"><span className="mb-1 block text-xs font-bold text-slate-500">العملة</span><select className="input sm:w-32" value={cur2} onChange={(e) => setCur2(e.target.value)}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label><label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">من تاريخ</span><input type="date" dir="ltr" className="input sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label><label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">إلى تاريخ</span><input type="date" dir="ltr" className="input sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label><div className="col-span-2"><ExportButtons report={report} /></div></div>
      <Table columns={ui} rows={rows}
        footer={<tr><td className="px-3 py-2" colSpan={4}>الإجمالي</td><td className="px-3 py-2 num">{fmt(st.totalDebit)}</td><td className="px-3 py-2 num">{fmt(st.totalCredit)}</td><td className={`px-3 py-2 font-extrabold ${tone(st.closing)}`}>{side(st.closing)}</td></tr>} />
    </Modal>
  );
}
export function Customers() {
  const [stm, setStm] = useState(null);
  const ctx = () => ({ ags: useCol('milkSales').rows, dls: useCol('milkDeliveries').rows, pays: useCol('customerPayments').rows, exps: useCol('expenses').rows, epays: useCol('expensePayments').rows });
  return (<>
    <CrudPage title="العملاء والديون المدينة" subtitle="سجل العملاء والذمم والدفعات المقدمة" col="customers" searchKeys={['name', 'phone']} useCtx={ctx}
      fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف', type: 'text' }, { name: 'address', label: 'العنوان', type: 'text' }, { name: 'status', label: 'الحالة', type: 'select', options: [['active', 'نشط'], ['inactive', 'غير نشط']], required: true, default: 'active' }, { name: 'openingBalance', label: 'رصيد افتتاحي مدين (ل.س) — اختياري', type: 'number' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      cols={({ ags, dls, pays, exps, epays }) => {
        // كل عملة على حدة — لا نجمع ليرة مع دولار أبداً
        const per = (r) => CURRENCIES.map(([c]) => { const p = customerPosition(r.id, { agreements: ags.filter((a) => (a.currency || 'SYP') === c), deliveries: dls, payments: pays.filter((x) => (x.currency || 'SYP') === c) }); return { c, rec: round2(p.receivable + (c === 'SYP' ? Number(r.openingBalance || 0) : 0)), cr: p.unappliedCredit }; });
        const show = (r, k, cls) => { const items = per(r).filter((x) => x[k] !== 0); return items.length ? <div className="space-y-0.5">{items.map((x) => <div key={x.c} className={`num font-bold ${cls(x[k])}`}>{money(x[k], x.c)}</div>)}</div> : <b className="num text-slate-400">0</b>; };
        return [{ key: 'name', label: 'العميل' }, { key: 'phone', label: 'الهاتف' }, { key: 'status', label: 'الحالة', render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> },
          { key: 'rec', label: 'الذمم المدينة (عليه)', render: (r) => show(r, 'rec', (v) => (v > 0 ? 'text-rose-600' : 'text-sky-700')) },
          { key: 'cr', label: 'دفعات مقدمة غير مطبّقة (له)', render: (r) => show(r, 'cr', () => 'text-emerald-700') },
          { key: 'sp', label: 'مشتريات منه لم ندفعها (له علينا)', render: (r) => { const it = CURRENCIES.map(([c]) => [c, supplierPayable(r.id, exps, epays, c)]).filter(([, v]) => v > 0); return it.length ? <div className="space-y-0.5">{it.map(([c, v]) => <div key={c} className="num font-bold text-amber-700">{money(v, c)}</div>)}</div> : <b className="num text-slate-400">0</b>; } }];
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
    totals: { credit: round2(rows.reduce((a, r) => a + r.credit, 0)), debit: round2(rows.reduce((a, r) => a + r.debit, 0)) }, summary: [{ label: 'سلف مستحقة', value: dbt.loans }, { label: 'ثمن بقر وفروق تبادل مستحقة', value: dbt.purchases }, { label: 'مصروفات/مبالغ دفعها', value: dbt.other }, { label: 'سحوبات وسلف أخذها', value: dbt.withdrawals + dbt.advances }, { label: 'الرصيد الختامي', value: L.closing }] };
  return (
    <Modal open onClose={onClose} title={report.title} wide>
      <div className="mb-3 flex flex-wrap items-end gap-2">
        <select className="input w-full sm:w-28" value={c} onChange={(e) => setC(e.target.value)}>{CURRENCIES.map(([v]) => <option key={v}>{v}</option>)}</select>
        <select className="input w-full sm:w-44" value={type} onChange={(e) => setType(e.target.value)}><option value="">كل الأنواع</option>{LEDGER_TYPES.filter((t) => t !== 'opening_balance').map((t) => <option key={t} value={t}>{LEDGER_AR[t]}</option>)}</select>
        <input type="date" className="input w-full sm:w-36" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-full sm:w-36" value={to} onChange={(e) => setTo(e.target.value)} />
        <ExportButtons report={report} />{can('create') && <button className="btn btn-primary" onClick={() => setMv(true)}>تسجيل حركة</button>}
      </div>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="سلف مستحقة" value={<span className="text-base">{fmt(dbt.loans)}</span>} tone="amber" /><Stat label="ثمن بقر وفروق تبادل مستحقة" value={<span className="text-base">{fmt(dbt.purchases)}</span>} tone="amber" /><Stat label="مصروفات/مبالغ دفعها" value={<span className="text-base">{fmt(dbt.other)}</span>} tone="amber" />
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
    <CrudPage title="الشركاء" subtitle="رأس مال الشريك (بقر + معدات) يُحسب تلقائياً مما يدفعه من ماله، وعليه تُقسَّم الأرباح: ثلث لشركاء الربح فقط، وثلث لشركاء الملكية، وثلث المزرعة لشركاء الملكية أيضاً." col="partners" searchKeys={['name', 'phone']}
      useCtx={() => ({ led: useCol('partnerCapitalTransactions').rows, loans: useCol('partnerLoans').rows, reps: useCol('partnerLoanRepayments').rows, cash: useCol('cashTransactions').rows, exps: useCol('expenses').rows, animals: useCol('animals').rows, partners: useCol('partners').rows })}
      extraHeader={<ResetCapital />}
      fields={[{ name: 'name', label: 'الاسم', type: 'text', required: true }, { name: 'phone', label: 'الهاتف / التواصل', type: 'text' }, { name: 'profitGroup', label: 'مجموعة الأرباح', type: 'select', options: [['', 'تلقائي (من له نسبة ملكية = شريك ملكية)'], ['owners', 'شريك ملكية — يدفع رأس المال (أبو وليد / عمار)'], ['side', 'شريك ربح فقط — ثلث الأرباح (أبو غفير / سعيد)']] }, { name: 'ownershipPct', label: 'نسبة الملكية % (احتياطية — الفعلية تُحسب من رأس المال)', type: 'number', min: 0, required: true }, { name: 'profitSharePct', label: 'نسبته داخل ثلث مجموعته % (لشريك الربح فقط؛ 50 و50 بين أبو غفير وسعيد)', type: 'number', min: 0, required: true }, { name: 'joinDate', label: 'تاريخ الانضمام', type: 'date' }, { name: 'status', label: 'الحالة', type: 'select', options: [['active', 'نشط'], ['inactive', 'غير نشط']], required: true, default: 'active' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      summary={(rows, ctx) => { const act = rows.filter((p) => !p.voided && p.status !== 'inactive'); const inv = Object.fromEntries(act.map((p) => [p.id, partnerInvestment(p.id, { ledger: ctx.led, expenses: ctx.exps, animals: ctx.animals })]));
        const owners = act.filter((p) => profitGroupOf(p) === 'owners'); const capAll = round2(owners.reduce((a, p) => a + inv[p.id].total, 0)); const eqAll = round2(owners.reduce((a, p) => a + inv[p.id].equipment, 0));
        const debts = rows.map((p) => partnerDebt(p.id, ctx.led)); const S = (k) => round2(debts.reduce((a, x) => a + x[k], 0));
        return rows.length ? <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"><Stat label="رأس مال المشروع (بقر + معدات)" value={<span className="text-base sm:text-xl">{money(capAll)}</span>} tone={owners.length ? 'green' : 'red'} /><Stat label="منها معدات" value={<span className="text-base sm:text-xl">{money(eqAll)}</span>} />
          <Stat label="سلف مستحقة للشركاء" value={<span className="text-base sm:text-xl">{money(S('loans'))}</span>} tone="amber" /><Stat label="ثمن بقر وفروق تبادل مستحقة" value={<span className="text-base sm:text-xl">{money(S('purchases'))}</span>} tone="amber" /><Stat label="مصروفات/مبالغ دفعوها" value={<span className="text-base sm:text-xl">{money(S('other'))}</span>} tone="amber" /><Stat label="إجمالي المستحق للشركاء" value={<span className="text-base sm:text-xl">{money(S('total'))}</span>} tone="red" /></div> : null; }}
      cols={(ctx) => [{ key: 'name', label: 'الشريك' }, { key: 'phone', label: 'التواصل', hideMobile: true },
        { key: 'ln', label: 'سلف مستحقة', render: (r) => <span className="num">{fmt(partnerDebt(r.id, ctx.led).loans)}</span> },
        { key: 'pu', label: 'ثمن بقر وفروق تبادل مستحقة', render: (r) => <span className="num">{fmt(partnerDebt(r.id, ctx.led).purchases)}</span> },
        { key: 'ot', label: 'مصروفات/مبالغ دفعها', render: (r) => <span className="num">{fmt(partnerDebt(r.id, ctx.led).other)}</span> },
        { key: 'wd', label: 'سحوبات وسلف أخذها', render: (r) => { const x = partnerDebt(r.id, ctx.led); return <span className="num">{fmt(x.withdrawals + x.advances)}</span>; } },
        { key: 'tt', label: 'إجمالي المستحق له', render: (r) => <b className="num text-rose-600">{fmt(partnerDebt(r.id, ctx.led).total)}</b> },
        { key: 'cap', label: 'رأس ماله (بقر + معدات)', render: (r) => (profitGroupOf(r) === 'owners' ? <span className="num">{fmt(partnerInvestment(r.id, { ledger: ctx.led, expenses: ctx.exps, animals: ctx.animals }).total)}</span> : '—') },
        { key: 'share', label: 'حصته من الأرباح', render: (r) => { const act = (ctx.partners || []).filter((p) => !p.voided && p.status !== 'inactive'); const cap = Object.fromEntries(act.map((p) => [p.id, partnerInvestment(p.id, { ledger: ctx.led, expenses: ctx.exps, animals: ctx.animals }).total])); const v = effectiveProfitShares(act, cap)[r.id]; return <b className="num">{v === undefined ? '—' : `${v}%`}</b>; } },
        { key: 'status', label: 'الحالة', hideMobile: true, render: (r) => <Badge tone={r.status === 'active' ? 'green' : 'gray'}>{r.status === 'active' ? 'نشط' : 'غير نشط'}</Badge> }]}
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
const animalCtx = () => ({ events: useCol('animalEvents').rows, animals: useCol('animals').rows, production: useCol('milkProduction').rows, expenses: useCol('expenses').rows, cash: useCol('cashTransactions').rows, ledger: useCol('partnerCapitalTransactions').rows, partners: useCol('partners').rows, accounts: useCol('cashAccounts').rows });
// الشريك الافتراضي لدفع المشتريات: من اسمه «وليد» (أبو وليد)، أو الشريك الوحيد إن وُجد واحد فقط
const useDefaultPayer = () => { const ps = useCol('partners').rows.filter((p) => !p.voided); return ps.find((p) => /وليد/.test(p.name || ''))?.id || (ps.length === 1 ? ps[0].id : ''); };
const payShow = (v) => v.origin === 'purchase' || v.hasPurchase === 'yes' || (v.origin === undefined && v.withCalf === 'yes' && Number(v.calfCost) > 0);
const checkCalf = (d, motherTag, animals) => {
  const c = validateNewAnimal(d.calfTag, animals); if (!c.ok) throw new Error(c.reason === 'duplicate' ? 'رقم الصغير مسجّل مسبقاً' : 'أدخل رقم الصغير');
  if (String(d.calfTag).trim().toLowerCase() === String(motherTag).trim().toLowerCase()) throw new Error('رقم الصغير يجب أن يختلف عن رقم الأم');
};
/** تسجيل صغير لأمّ (جديدة أو موجودة): الحيوان + حدث الولادة/الشراء + حركة الصندوق إن كان له سعر. */
async function addCalf(u, motherId, mother, d, { origin, date, currency, pay }) {
  const tag = String(d.calfTag).trim(); const cost = Number(d.calfCost || 0);
  const cid = await createAnimal(u, { motherTag: mother.tag, tag, name: d.calfName || '', category: d.calfCategory || 'heifer_calf', sex: d.calfSex || 'F', breed: d.calfBreed || mother.breed || '', origin, sellerName: mother.sellerName || '', birthDate: d.calfBirthDate || '', acquisitionDate: date, acquisitionCost: cost, currency, healthStatus: d.calfHealth || 'healthy', motherId, pregnant: 'na', withMother: true, photo: d.calfPhoto || '' });
  const p = origin === 'purchase' ? animalPurchasePayment({ ...pay, proportional: true, cost, date, currency, tag, animalId: cid }) : { cash: null, ledger: null, extra: {} };
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

const EV_AR = { purchase: 'شراء', birth: 'ولادة', death: 'نفوق', sale: 'بيع', exchange_in: 'تبادل (دخول)', exchange_out: 'تبادل (خروج)', opening: 'رصيد افتتاحي', transfer_out: 'نقل (خروج)', transfer_in: 'نقل (دخول)' };
/** بطاقة الحيوان: كل بياناته في مكان واحد (الاقتناء ومن دفع، الأم والصغار، الأحداث، المالية) مع تغيير من دفع. */
function AnimalCard({ animal, onClose, onEdit, onSell }) {
  const { user, can } = useAuth();
  const animals = useCol('animals').rows, events = useCol('animalEvents').rows, ledger = useCol('partnerCapitalTransactions').rows, cash = useCol('cashTransactions').rows, partners = useCol('partners').rows, accounts = useCol('cashAccounts').rows;
  const [chg, setChg] = useState(false);
  const a = animals.find((x) => x.id === animal.id) || animal; const h = herdState(events, animals)[a.id]; const src = purchaseSource(a, { events, ledger, cash });
  const mom = animals.find((x) => x.id === a.motherId); const kids = animals.filter((x) => !x.voided && x.motherId === a.id);
  const myEv = events.filter((e) => !e.voided && e.animalId === a.id).sort((x, y) => y.date.localeCompare(x.date)); const sale = myEv.find((e) => e.type === 'sale'); const cost = Number(a.acquisitionCost) || 0;
  const pName = (id) => partners.find((p) => p.id === id)?.name || '—'; const aName = (id) => accounts.find((x) => x.id === id)?.name || '—';
  const ex = animalExchangeInfo(a, { events, ledger, cash }); // حيوان دخل بتبادل: الفرق ومن دفعه
  const exDiffTxt = !ex ? '' : ex.diff > 0 ? `دفعنا ${fmt(ex.diff)} ${ex.currency}` : ex.diff < 0 ? `استلمنا ${fmt(-ex.diff)} ${ex.currency}` : 'لا يوجد فرق';
  const exPayer = !ex || ex.diff === 0 ? '' : ex.paidBy === 'partner' ? (ex.diff < 0 ? `الفرق المستلَم عاد لدافع ثمن الحيوان الخارج: ${(ex.partners || []).map((q) => `${pName(q.partnerId)} (${fmt(q.amount)})`).join(' + ')} — خُصم من ثمن بقره المستحق له` : `الشريك: ${pName(ex.partnerId)} (سُجّل الفرق في حسابه)`) : ex.paidBy === 'account' ? `${ex.diff > 0 ? 'من' : 'إلى'} الصندوق: ${aName(ex.accountId)}` : 'غير محدد';
  const payer = ex ? '' : src.multi ? `الشركاء: ${src.partners.map((q) => `${pName(q.partnerId)} (${fmt(q.amount)})`).join(' + ')}` : src.from === 'partner' ? `الشريك: ${pName(src.partnerId)}` : src.from === 'account' ? `الصندوق: ${aName(src.accountId)}` : (a.origin === 'purchase' ? 'غير محدد (اضغط تغيير)' : '—');
  const status = h?.active ? (a.healthStatus === 'sick' ? 'مريض' : 'في القطيع') : h ? ({ sale: 'مباع', death: 'نافق', exchange_out: 'مبادَل', transfer_out: 'منقول' }[h.last] || 'خرج') : '—';
  const info = [['الفئة', animalCatLabel(a.category)], ['الجنس', a.sex === 'F' ? 'أنثى' : 'ذكر'], ['السلالة', a.breed], ['تاريخ الميلاد', a.birthDate], ['المصدر', a.viaExchange ? 'تبادل' : { purchase: 'شراء', birth: 'مولود بالمزرعة', opening: 'رصيد افتتاحي' }[a.origin]], ['جهة الشراء / البائع', a.sellerName], ['تاريخ الاقتناء', a.acquisitionDate], ['سعر الشراء', cost ? `${fmt(cost)} ${a.currency || ''}` : ''], ['مين دفع ثمنها', payer], ...(ex ? [['خرج مقابله', ex.outs.map((o) => `${o.tag}${o.value ? ` (${fmt(o.value)})` : ''}`).join('، ')], ['قيمة الوارد في التبادل', `${fmt(ex.inValue)} ${ex.currency}`], ['فرق التبادل', exDiffTxt], [ex.diff < 0 ? 'من استلم الفرق' : 'مين دفع الفرق', exPayer]] : []), ['الأم', mom ? `${mom.tag}${mom.name ? ' — ' + mom.name : ''}` : (a.motherTag || '')], ['الصغار (معها)', kids.map((k) => `${k.tag}${k.name ? ' — ' + k.name : ''}`).join('، ')], ['الحمل', { yes: 'حامل', no: 'غير حامل' }[a.pregnant]], ['حليب عند الشراء', a.milkAtPurchase ? `${a.milkAtPurchase} لتر/يوم` : ''], ['ملاحظات', a.notes]].filter(([, v]) => v);
  return (
    <Modal open onClose={onClose} title={`${a.tag}${a.name ? ' — ' + a.name : ''}`} wide>
      <div className="mb-3 flex flex-wrap items-center gap-3">{a.photo ? <img src={a.photo} alt={a.tag} className="h-24 w-24 rounded-xl border object-cover" /> : <Avatar size={64} />}
        <div className="flex flex-wrap gap-2"><Badge tone={h?.active ? 'green' : 'gray'}>{status}</Badge>
          {can('update') && <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onEdit(a)}>تعديل كل البيانات</button>}{h?.active && <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => onSell(a)}>بيع</button>}
          {can('update') && src.event && !src.multi && Number(src.event.value) > 0 && <button className="btn btn-ghost !py-1.5 text-xs" onClick={() => setChg(true)}>تغيير من دفع</button>}</div></div>
      <div className="mb-3 grid grid-cols-1 gap-x-4 gap-y-1 sm:grid-cols-2">{info.map(([k, v]) => <div key={k} className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-sm"><span className="shrink-0 text-xs font-bold text-slate-500">{k}</span><span className="min-w-0 break-words font-medium">{v}</span></div>)}</div>
      {sale && <div className="mb-3 rounded-lg bg-slate-50 p-2 text-sm">بيع بـ <b>{fmt(sale.value)}</b> {sale.currency || ''} بتاريخ {sale.date}{cost ? <> — {Number(sale.value) - cost >= 0 ? 'ربح' : 'خسارة'} <b className={Number(sale.value) - cost >= 0 ? 'text-emerald-700' : 'text-rose-600'}>{fmt(Math.abs(Number(sale.value) - cost))}</b></> : null}</div>}
      {(() => { const r = animalResultInfo(a, events); if (!r || r.kind !== 'exchange') return null; const loss = r.result < 0; return <div className={`mb-3 rounded-lg p-2 text-sm ${loss ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>تبادل بقيمة <b>{fmt(r.value)}</b> {r.currency} مقابل سعر شرائه {fmt(r.cost)} — {r.result === 0 ? 'بلا ربح ولا خسارة' : <>{loss ? 'خسارة' : 'ربح'} <b>{fmt(Math.abs(r.result))}</b>{r.bearer ? ` — ${loss ? 'على' : 'لصالح'} ${r.bearer === 'farm' ? 'المزرعة' : (r.partnerIds.map((id) => pName(id)).join(' و') || 'الشركاء')}` : ''}</>}</div>; })()}
      <div className="mb-1 text-sm font-extrabold">الأحداث</div>
      <Table rows={myEv} empty={<Empty title="لا توجد أحداث" />} columns={[{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'الحدث', render: (r) => EV_AR[r.type] || r.type }, { key: 'value', label: 'القيمة', render: (r) => (Number(r.value) ? <span className="num">{fmt(r.value)}</span> : '—') }, { key: 'notes', label: 'ملاحظات', hideMobile: true }]} />
      {chg && <FormModal open onClose={() => setChg(false)} title={`من دفع ثمن ${a.tag}؟ (${fmt(src.amount)})`} submitLabel="حفظ التغيير"
        fields={[{ name: 'payFrom', label: 'الدافع', type: 'select', required: true, options: [['partner', 'شريك — يُسجَّل المبلغ في حسابه'], ['account', 'من صندوق المزرعة']] }, { name: 'payPartnerId', label: 'الشريك', type: 'rel', col: 'partners', showIf: (v) => v.payFrom === 'partner' }, { ...acct, showIf: (v) => v.payFrom === 'account' }]}
        defaults={{ payFrom: src.from === 'account' ? 'account' : 'partner', payPartnerId: src.partnerId || '', accountId: src.accountId || '' }} onSubmit={(d) => changePurchasePayer(user, a, { events, ledger, cash }, { from: d.payFrom, partnerId: d.payPartnerId, accountId: d.accountId })} />}
    </Modal>
  );
}
/** قيمة القطيع الحالية بتكلفة الشراء (الموجود فعلاً فقط) حسب الفئة والعملة. */
function HerdValue() {
  const s = useSettings(); const animals = useCol('animals').rows, events = useCol('animalEvents').rows, ledger = useCol('partnerCapitalTransactions').rows, cash = useCol('cashTransactions').rows, partners = useCol('partners').rows, accounts = useCol('cashAccounts').rows;
  const hv = herdValue(animals, events);
  const payerOf = (a) => { const x = purchaseSource(a, { events, ledger, cash }); if (x.multi) return x.partners.map((q) => partners.find((p) => p.id === q.partnerId)?.name || '—').join(' + '); return x.from === 'partner' ? (partners.find((p) => p.id === x.partnerId)?.name || '—') : x.from === 'account' ? `الصندوق: ${accounts.find((c) => c.id === x.accountId)?.name || ''}` : '—'; };
  const rows = [...hv.rows].sort((x, y) => String(x.category).localeCompare(String(y.category)) || Number(y.acquisitionCost || 0) - Number(x.acquisitionCost || 0)).map((a) => ({ id: a.id, tag: a.tag, name: a.name || '', cat: animalCatLabel(a.category), acq: a.acquisitionDate, cost: Number(a.acquisitionCost || 0), currency: a.currency || 'SYP', payer: payerOf(a) }));
  const report = { farm: s.farmName, title: 'قيمة القطيع الحالية (بتكلفة الشراء)', currency: 'SYP', columns: [{ key: 'tag', label: 'الرقم' }, { key: 'name', label: 'الاسم' }, { key: 'cat', label: 'الفئة' }, { key: 'acq', label: 'تاريخ الاقتناء', type: 'date' }, { key: 'payer', label: 'مين دفع' }, { key: 'cost', label: 'التكلفة', type: 'money' }], rows: rows.filter((r) => r.currency === 'SYP'), totals: { cost: hv.byCurrency.SYP || 0 }, summary: [{ label: 'عدد الحيوانات', value: hv.count }, ...Object.entries(hv.byCurrency).map(([c, v]) => ({ label: `إجمالي التكلفة (${c})`, value: v }))] };
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="عدد الحيوانات الموجودة" value={hv.count} tone="blue" />{Object.entries(hv.byCurrency).map(([c, v]) => <Stat key={c} label={`قيمة القطيع بالتكلفة (${c})`} value={<span className="text-base sm:text-xl">{money(v, c)}</span>} tone="green" />)}</div>
      <Card title="حسب الفئة" action={<ExportButtons report={report} />}><Table rows={hv.byCategory.map((x, i) => ({ id: i, ...x }))} empty={<Empty title="لا توجد حيوانات" />} columns={[{ key: 'category', label: 'الفئة', render: (r) => animalCatLabel(r.category) || r.category }, { key: 'count', label: 'العدد' }, { key: 'cost', label: 'التكلفة', render: (r) => <b className="num">{money(r.cost, r.currency)}</b> }]} /></Card>
      <Card title="كل الحيوانات الموجودة"><Table rows={rows} columns={[{ key: 'tag', label: 'الرقم' }, { key: 'name', label: 'الاسم', hideMobile: true }, { key: 'cat', label: 'الفئة' }, { key: 'payer', label: 'مين دفع' }, { key: 'cost', label: 'التكلفة', render: (r) => <b className="num">{money(r.cost, r.currency)}</b> }]} /></Card>
      <p className="text-xs text-slate-500">القيمة بتكلفة الشراء (لا سعر السوق): المولود بالمزرعة تكلفته صفر. الحيوانات المباعة أو النافقة أو المبادَلة أو الملغاة لا تدخل.</p>
    </div>
  );
}
/** صفحة «المواشي»: كل ما يخص القطيع في مكان واحد بتبويبات (القطيع، المواليد والوفيات، التبادل، قيمة القطيع). */
export function Livestock({ initial = 'herd' }) {
  const [tab, setTab] = useState(initial);
  const animals = useCol('animals').rows; const events = useCol('animalEvents').rows; const logs = useCol('calfLogs').rows;
  const herd = herdState(events, animals);
  const live = (e) => !e.voided && !animals.find((a) => a.id === e.animalId)?.voided;
  const tabs = [
    ['herd', 'القطيع', 'كل الحيوانات: شراء، بيع، تفاصيل', Object.values(herd).filter((x) => x.active).length],
    ['events', 'المواليد والوفيات', 'سجل الولادات والنفوق فقط', events.filter((e) => live(e) && (e.type === 'birth' || e.type === 'death')).length],
    ['exchange', 'تبادل ونقل', 'كل عملية بتفاصيل بقراتها وفرقها', new Set(events.filter((e) => live(e) && e.exchangeId).map((e) => e.exchangeId)).size + events.filter((e) => live(e) && e.type === 'transfer_out').length],
    ['value', 'قيمة القطيع', 'التقييم بالتكلفة ومن دفع', null],
    ['fatten', 'تسمين العجول', 'الوزن والعلف والحليب لكل عجل', new Set(logs.filter((l) => !l.voided).map((l) => l.calfId)).size],
  ];
  const cur = tabs.find((t) => t[0] === tab);
  return (<div><div className="mb-1 flex gap-1 overflow-x-auto border-b border-slate-200 pb-0">{tabs.map(([k, l, , c]) => <button key={k} className={`-mb-px flex shrink-0 items-center gap-1.5 rounded-t-lg border-b-2 px-3.5 py-2 text-sm font-bold transition ${tab === k ? 'border-emerald-600 bg-emerald-50 text-emerald-800' : 'border-transparent text-slate-500 hover:bg-slate-50'}`} onClick={() => setTab(k)}>{l}{c !== null && c > 0 && <span className={`rounded-full px-1.5 text-[11px] ${tab === k ? 'bg-emerald-600 text-white' : 'bg-slate-200 text-slate-600'}`}>{c}</span>}</button>)}</div>
    <p className="mb-4 mt-1.5 text-xs text-slate-500">{cur?.[2]}</p>
    {tab === 'herd' && <Animals />}{tab === 'events' && <AnimalEvents />}{tab === 'exchange' && <Exchange />}{tab === 'value' && <HerdValue />}{tab === 'fatten' && <CalfFattening />}</div>);
}
export function Animals() {
  const [sale, setSale] = useState(null); // null | true | animalId
  const [view, setView] = useState(null); // صورة مكبّرة
  const [card, setCard] = useState(null); const editRef = useRef(null);
  const payer = useDefaultPayer(); const [audit, setAudit] = useState(false); const lists = useCustomLists();
  const [vw, setVw] = useState('data'); // عرض الجدول: بيانات الحيوان / المالية
  const calfF = (o) => ({ showIf: (v) => v.withCalf === 'yes', ...o });
  const fields = [
    { name: 'tag', label: 'رقم الحيوان (Tag)', type: 'text', required: true }, { name: 'name', label: 'الاسم', type: 'text' }, { name: 'photo', label: 'صورة الحيوان', type: 'image' },
    { name: 'category', label: 'الفئة', type: 'select', required: true, options: [...allAnimalCategories(), NEW_CAT], default: 'cow' }, { name: 'newCategory', label: 'اسم الفئة الجديدة', type: 'text', showIf: (v) => v.category === '__new__' }, { name: 'sex', label: 'الجنس', type: 'select', required: true, options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'breed', label: 'السلالة', type: 'text' },
    { name: 'origin', label: 'المصدر', type: 'select', required: true, options: [['purchase', 'شراء'], ['birth', 'مولود بالمزرعة'], ['opening', 'رصيد افتتاحي (موجود مسبقاً)']] },
    { name: 'sellerName', label: 'جهة الشراء (البائع/السوق)', type: 'text', showIf: (v) => v.origin === 'purchase' },
    { name: 'birthDate', label: 'تاريخ الميلاد', type: 'date' }, { name: 'ageAtPurchaseMonths', label: 'العمر عند الشراء (شهر) — إن لم يُعرف تاريخ الميلاد', type: 'number', min: 0 },
    { name: 'acquisitionDate', label: 'تاريخ الشراء / الاقتناء', type: 'date', required: true }, { name: 'acquisitionCost', label: 'سعر الشراء', type: 'number', min: 0 }, cur,
    { name: 'payFrom', label: 'مصدر دفع ثمن الشراء', type: 'select', options: [['partner', 'شريك دفع ثمنها أو اشتريناها منه — يُسجَّل المبلغ في حسابه ويُسدَّد له لاحقاً'], ['partners', 'شريكان أو أكثر اشتروها معاً — لكل شريك مبلغ يُقيَّد في حسابه'], ['account', 'من صندوق المزرعة']], default: 'partner', showIf: payShow },
    { name: 'payPartnerId', label: 'الشريك (الدافع أو البائع) — يذهب المبلغ لحسابه', type: 'rel', col: 'partners', showIf: (v) => payShow(v) && ['partner', 'partners'].includes(v.payFrom || 'partner') },
    { name: 'payAmount1', label: 'المبلغ الذي دفعه هذا الشريك', type: 'number', min: 0, showIf: (v) => payShow(v) && v.payFrom === 'partners' },
    { name: 'payPartner2Id', label: 'الشريك الثاني', type: 'rel', col: 'partners', showIf: (v) => payShow(v) && v.payFrom === 'partners' }, { name: 'payAmount2', label: 'المبلغ الذي دفعه الشريك الثاني', type: 'number', min: 0, showIf: (v) => payShow(v) && v.payFrom === 'partners' },
    { name: 'payPartner3Id', label: 'شريك ثالث (اختياري)', type: 'rel', col: 'partners', showIf: (v) => payShow(v) && v.payFrom === 'partners' }, { name: 'payAmount3', label: 'مبلغ الشريك الثالث', type: 'number', min: 0, showIf: (v) => payShow(v) && v.payFrom === 'partners' },
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
      filters={[{ key: '_st', label: 'الحالة', allLabel: 'كل الحالات', options: [['active', 'في القطيع'], ['sick', 'مريض'], ['out', 'خرج من القطيع']], test: (r, v, ctx) => { const s = herdState(ctx.events, ctx.animals)[r.id]; return v === 'active' ? !!s?.active : v === 'sick' ? !!s?.active && r.healthStatus === 'sick' : !s?.active; } }, { key: 'category', label: 'الفئة', allLabel: 'كل الفئات', options: allAnimalCategories() }, { key: 'sex', label: 'الجنس', allLabel: 'الكل', options: [['F', 'إناث'], ['M', 'ذكور']] }]}
      extraHeader={<><div className="inline-flex overflow-hidden rounded-lg border border-slate-200 bg-white text-sm font-bold">{[['data', 'بيانات الحيوان'], ['fin', 'المالية']].map(([k, l]) => <button key={k} type="button" className={`px-3 py-2 ${vw === k ? 'bg-emerald-600 text-white' : 'text-slate-600 hover:bg-slate-50'}`} onClick={() => setVw(k)}>{l}</button>)}</div><LinkCapitalPurchases payer={payer} /><button className="btn btn-ghost" onClick={() => setAudit(true)}>تدقيق المشتريات</button><button className="btn btn-ghost" onClick={() => setSale(true)}>بيع حيوان</button></>}
      fields={fields} defaults={{ payFrom: 'partner', payPartnerId: payer }} createOnlyFields={['origin']} onRowClick={(r) => setCard(r)} openEditRef={editRef}
      editDefaults={(rec, ctx) => { const s = purchaseSource(rec, { events: ctx.events, ledger: ctx.ledger, cash: ctx.cash }); return s.event && Number(s.event.value) > 0 ? { hasPurchase: 'yes', payFrom: s.from === 'account' ? 'account' : 'partner', payPartnerId: s.partnerId || '', accountId: s.accountId || '' } : {}; }} onVoid={(u, r, ctx, why) => voidAnimalCascade(u, r, ctx, why)}
      create={async (u, d, { animals }) => {
        const ok = validateNewAnimal(d.tag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'رقم الحيوان مطلوب');
        const calf = d.withCalf === 'yes'; if (calf) checkCalf(d, d.tag, animals);
        let { origin, accountId, payFrom, payPartnerId, payAmount1, payPartner2Id, payAmount2, payPartner3Id, payAmount3, withCalf, calfTag, calfName, calfCategory, calfSex, calfBreed, calfBirthDate, calfCost, calfHealth, calfPhoto, newCategory, calfNewCategory, ...rest } = d;
        if (rest.category === '__new__') rest.category = await addCustomCategory(u, 'animal', newCategory, lists.animal);
        if (calf && calfCategory === '__new__') calfCategory = await addCustomCategory(u, 'animal', calfNewCategory, lists.animal);
        const splits = payFrom === 'partners' ? [[payPartnerId, payAmount1], [payPartner2Id, payAmount2], [payPartner3Id, payAmount3]].filter(([pp, aa]) => pp || Number(aa) > 0).map(([pp, aa]) => ({ partnerId: pp, amount: Number(aa) })) : undefined;
        const pay = { from: payFrom || 'partner', partnerId: payPartnerId, accountId, splits };
        if (origin === 'purchase') { animalPurchasePayment({ ...pay, cost: d.acquisitionCost, date: d.acquisitionDate, currency: d.currency, tag: d.tag }); if (calf) animalPurchasePayment({ ...pay, proportional: true, cost: calfCost, date: d.acquisitionDate, currency: d.currency, tag: calfTag }); } // تحقّق قبل الحفظ
        const id = await createAnimal(u, { ...rest, origin, pregnant: d.sex === 'F' ? d.pregnant || 'na' : 'na', healthStatus: d.healthStatus || 'healthy' });
        const mp = origin === 'purchase' ? animalPurchasePayment({ ...pay, cost: d.acquisitionCost, date: d.acquisitionDate, currency: d.currency, tag: d.tag, animalId: id }) : { cash: null, ledger: null, extra: {} };
        await recordAnimalEvent(u, { animalId: id, tag: d.tag, type: origin, date: d.acquisitionDate, value: d.acquisitionCost || 0, currency: d.currency, ...mp.extra }, mp.cash, mp.ledger);
        if (calf) await addCalf(u, id, { ...rest, id }, { ...d, calfCategory }, { origin, date: d.acquisitionDate, currency: d.currency, pay });
      }}
      update={async (u, d, edit, ctx) => {
        const { animals } = ctx;
        let { withCalf, calfTag, calfName, calfCategory, calfSex, calfBreed, calfBirthDate, calfCost, calfHealth, calfPhoto, payFrom, payPartnerId, payAmount1, payPartner2Id, payAmount2, payPartner3Id, payAmount3, accountId, newCategory, calfNewCategory, ...rest } = d;
        if (String(rest.tag || '').trim().toLowerCase() !== String(edit.tag).trim().toLowerCase()) { const ok = validateNewAnimal(rest.tag, animals.filter((a) => a.id !== edit.id)); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان مسجّل مسبقاً' : 'رقم الحيوان مطلوب'); }
        const calf = withCalf === 'yes'; if (calf) checkCalf(d, rest.tag, animals);
        const cost = Number(calfCost || 0); const cdate = calfBirthDate || today(); const cur2 = edit.currency || d.currency || 'SYP';
        const pay = { from: payFrom || 'partner', partnerId: payPartnerId, accountId };
        if (calf && cost > 0) animalPurchasePayment({ ...pay, cost, date: cdate, currency: cur2, tag: calfTag }); // تحقّق قبل الحفظ
        if (rest.category === '__new__') rest.category = await addCustomCategory(u, 'animal', newCategory, lists.animal);
        if (calf && calfCategory === '__new__') calfCategory = await addCustomCategory(u, 'animal', calfNewCategory, lists.animal);
        await saveRecord(u, 'animals', rest, edit.id);
        // سعر الشراء ومن دفع: يتزامنان مع حدث الشراء وقيد الشريك/حركة الصندوق
        const pctx = { events: ctx.events, ledger: ctx.ledger, cash: ctx.cash }; const srcNow = purchaseSource(edit, pctx); const newCost = Number(rest.acquisitionCost || 0);
        if (srcNow.event && newCost !== Number(srcNow.event.value)) { await changePurchasePrice(u, edit, pctx, newCost); pctx.events = pctx.events.map((e) => (e.id === srcNow.event.id ? { ...e, value: newCost } : e)); }
        if (payFrom && srcNow.event && !(calf && cost > 0)) await changePurchasePayer(u, { ...edit, ...rest }, pctx, { from: payFrom, partnerId: payPartnerId, accountId });
        // إضافة صغير لحيوان موجود: مولود بالمزرعة (أو مشترى لو أدخلت له سعراً)
        if (calf) await addCalf(u, edit.id, { ...edit, ...rest }, { ...d, calfCategory }, { origin: cost > 0 ? 'purchase' : 'birth', date: cdate, currency: cur2, pay });
      }}
      summary={(rows, ctx) => { const h = herdState(ctx.events, ctx.animals); const soon = rows.filter((r) => h[r.id]?.active && (animalProfile(r, ctx).daysToCalving ?? 999) <= 30 && animalProfile(r, ctx).daysToCalving !== null).length;
        return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6"><Stat label="القطيع النشط" value={Object.values(h).filter((x) => x.active).length} /><Stat label="مريض" value={rows.filter((r) => h[r.id]?.active && r.healthStatus === 'sick').length} tone="red" /><Stat label="ولادات خلال 30 يوم" value={soon} tone="amber" /><Stat label="إجمالي السجلات" value={rows.length} /><Stat label="خرجت من القطيع" value={Object.values(h).filter((x) => !x.active).length} /><Stat label="قيمة القطيع (بالتكلفة)" value={<span className="text-base sm:text-xl">{money(herdValue(ctx.animals, ctx.events).byCurrency.SYP || 0)}</span>} tone="green" />{(() => { const rs = rows.filter((r) => !r.voided).map((r) => animalResultInfo(r, ctx.events)).filter((x) => x && x.currency === 'SYP'); const net = round2(rs.reduce((t, x) => t + x.result, 0)); const gain = round2(rs.filter((x) => x.result > 0).reduce((t, x) => t + x.result, 0)), loss = round2(rs.filter((x) => x.result < 0).reduce((t, x) => t - x.result, 0)); return <Stat label={`نتيجة البيع والتبادل (ربح ${fmt(gain)} / خسارة ${fmt(loss)})`} value={<span className="text-base sm:text-xl">{money(net)}</span>} tone={net >= 0 ? 'green' : 'red'} />; })()}</div>; }}
      cols={(ctx) => { const h = herdState(ctx.events, ctx.animals); const all = [{ key: 'photo', label: 'الصورة', render: (r) => <Avatar src={r.photo} size={44} alt={r.tag} onClick={r.photo ? () => setView(r) : undefined} /> }, { key: 'tag', label: 'الرقم' }, { key: 'name', label: 'الاسم' },
        { key: 'payer', label: 'مين دفع', render: (r) => { const ex = animalExchangeInfo(r, ctx); if (ex) return ex.diff === 0 ? <Badge tone="gray">تبادل بلا فرق</Badge> : ex.paidBy === 'partner' ? <Badge tone="blue">{ctx.partners.find((p) => p.id === ex.partnerId)?.name || 'شريك'} <span className="num">(فرق {fmt(Math.abs(ex.diff))})</span></Badge> : ex.paidBy === 'account' ? <Badge tone="amber">الصندوق <span className="num">(فرق {fmt(Math.abs(ex.diff))})</span></Badge> : <Badge tone="gray">تبادل — الفرق غير محدد</Badge>; const s = purchaseSource(r, { events: ctx.events, ledger: ctx.ledger, cash: ctx.cash }); if (s.multi) return <Badge tone="blue">{s.partners.map((q) => `${ctx.partners.find((p) => p.id === q.partnerId)?.name || 'شريك'} ${fmt(q.amount)}`).join(' + ')}</Badge>; if (s.from === 'partner') return <Badge tone="blue">{ctx.partners.find((p) => p.id === s.partnerId)?.name || 'شريك'}</Badge>; if (s.from === 'account') return <Badge tone="amber">الصندوق</Badge>; return r.origin === 'purchase' ? <Badge tone="gray">غير محدد</Badge> : '—'; } },
        { key: 'fam', label: 'الأم / الصغار', render: (r) => { const mom = ctx.animals.find((a) => a.id === r.motherId); const kids = ctx.animals.filter((a) => !a.voided && a.motherId === r.id); return mom || kids.length ? <div className="text-xs leading-relaxed">{mom && <div>أمها: <b>{mom.tag}</b>{mom.name ? ` (${mom.name})` : ''}</div>}{kids.length > 0 && <div>معها صغير: <b>{kids.map((k) => k.tag).join('، ')}</b></div>}</div> : (r.motherTag ? <span className="text-xs">أمها: <b>{r.motherTag}</b></span> : '—'); } },
        { key: 'category', label: 'الفئة', render: (r) => animalCatLabel(r.category) || '—' }, { key: 'sex', label: 'الجنس', hideMobile: true, render: (r) => (r.sex === 'F' ? 'أنثى' : 'ذكر') }, { key: 'breed', label: 'السلالة', hideMobile: true }, { key: 'acquisitionDate', label: 'الشراء', hideMobile: true },
        { key: 'cost', label: 'سعر الشراء', render: (r) => <span className="num">{r.acquisitionCost ? fmt(r.acquisitionCost) : '—'}</span> }, { key: 'age', label: 'العمر (شهر)', render: (r) => animalProfile(r, ctx).ageMonths ?? '—' },
        { key: 'mp', label: 'حليب عند الشراء', hideMobile: true, render: (r) => (r.milkAtPurchase ? <span className="num">{fmt(r.milkAtPurchase)} لتر/يوم</span> : '—') },
        { key: 'milk', label: 'حليب فعلي', render: (r) => { const p = animalProfile(r, ctx); return p.milkTotal ? <span className="num">{fmt(p.milkTotal)} <span className="text-xs text-slate-400">({fmt(p.milkAvg)}/يوم)</span></span> : '—'; } },
        { key: 'calv', label: 'الولادة', render: (r) => { const dd = animalProfile(r, ctx).daysToCalving; return dd === null ? '—' : <Badge tone={dd < 0 ? 'red' : dd <= 30 ? 'amber' : 'blue'}>{dd >= 0 ? `بعد ${dd} يوم` : `متأخرة ${-dd} يوم`}</Badge>; } },
        { key: 'res', label: 'ربح / خسارة', render: (r) => { const x = animalResultInfo(r, ctx.events); if (!x) return '—'; return <div><Badge tone={x.result > 0 ? 'green' : x.result < 0 ? 'red' : 'gray'}><span className="num">{x.result > 0 ? '+' : x.result < 0 ? '−' : ''}{fmt(Math.abs(x.result))}</span></Badge><div className="text-[11px] text-slate-400">{x.kind === 'sale' ? 'بيع' : 'تبادل'}{x.bearer ? ` — ${x.bearer === 'farm' ? 'على المزرعة' : (x.partnerIds.map((id) => ctx.partners.find((p) => p.id === id)?.name).filter(Boolean).join(' و') || 'على الشركاء')}` : ''}</div></div>; } },
        { key: 'st', label: 'الحالة', render: (r) => { const s = h[r.id]; const t = s?.active ? (r.healthStatus === 'sick' ? 'مريض' : 'نشط') : s ? { sale: 'مباع', death: 'نافق', transfer_out: 'منقول', exchange_out: 'مبادَل' }[s.last] || 'خرج' : 'بلا حدث'; return <Badge tone={t === 'نشط' ? 'green' : t === 'مريض' ? 'red' : s ? 'gray' : 'amber'}>{t}</Badge>; } }];
        const keys = vw === 'fin' ? ['photo', 'tag', 'name', 'category', 'acquisitionDate', 'cost', 'payer', 'res', 'st'] : ['photo', 'tag', 'name', 'category', 'sex', 'breed', 'age', 'fam', 'mp', 'milk', 'calv', 'st'];
        return keys.map((k) => all.find((c) => c.key === k)).filter(Boolean); }}
      rowActions={(r) => <button className="rounded p-1.5 hover:bg-slate-100" title="تفاصيل وبيع" onClick={() => setSale(r.id)}><Info size={15} /></button>} />
    {audit && <PurchaseAudit payer={payer} onClose={() => setAudit(false)} />}
    {sale && <AnimalSale preselectId={sale === true ? null : sale} onClose={() => setSale(null)} />}
    {card && <AnimalCard animal={card} onClose={() => setCard(null)} onEdit={(a) => { setCard(null); editRef.current?.(a); }} onSell={(a) => { setCard(null); setSale(a.id); }} />}
    {view && <Modal open onClose={() => setView(null)} title={`${view.tag} ${view.name || ''}`}><img src={view.photo} alt={view.tag} className="mx-auto max-h-[70dvh] w-full rounded-xl object-contain" /></Modal>}
  </>);
}
const evTypes = [['birth', 'ولادة'], ['death', 'نفوق']]; // الشراء والبيع من صفحة «المواشي والعجول» فقط (مكان واحد لتفادي التكرار)
const EVT_AR = { birth: 'ولادة', purchase: 'شراء', death: 'نفوق', sale: 'بيع', opening: 'افتتاحي', exchange_in: 'تبادل (وارد)', exchange_out: 'تبادل (صادر)', transfer_out: 'نقل' };
const animalLabel = (r) => `${r.tag}${r.name ? ' - ' + r.name : ''}`;
export function AnimalEvents() {
  const [sale, setSale] = useState(false); const payer = useDefaultPayer();
  const evRows = useCol('animalEvents').rows.filter((r) => !r.voided && (r.type === 'birth' || r.type === 'death'));
  const herdNow = herdState(useCol('animalEvents').rows, useCol('animals').rows); const alive = (r) => herdNow[r.id]?.active; // القائمة تعرض الحيوانات الموجودة في القطيع فقط (لا المباعة/النافقة/الملغاة)
  return (<><CrudPage title="المواليد والوفيات" subtitle="الولادات والنفوق فقط. الشراء والبيع من تبويب «القطيع»، والتبادل والنقل من «تبادل ونقل»" col="animalEvents" noEdit useCtx={animalCtx} defaults={{ payFrom: 'partner', payPartnerId: payer }} searchKeys={['tag', 'type']} onVoid={(u, r, ctx, why) => voidAnimalEventCascade(u, r, ctx, why)} filter={(r) => r.type === 'birth' || r.type === 'death'}
    filters={[{ key: 'type', label: 'الحدث', allLabel: 'الولادة والنفوق', options: evTypes }, { key: '_y', label: 'السنة', allLabel: 'كل السنوات', options: [...new Set(evRows.map((r) => String(r.date || '').slice(0, 4)).filter(Boolean))].sort().reverse().map((y) => [y, y]), test: (r, v) => String(r.date || '').startsWith(v) }]}
    summary={(rows) => { const y = String(new Date().getFullYear()); const b = rows.filter((r) => r.type === 'birth'), d = rows.filter((r) => r.type === 'death'); const cnt = (a) => a.filter((r) => String(r.date || '').startsWith(y)).length; return <div className="grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="إجمالي الولادات" value={b.length} /><Stat label="إجمالي النفوق" value={d.length} tone="red" /><Stat label={`ولادات ${y}`} value={cnt(b)} /><Stat label={`نفوق ${y}`} value={cnt(d)} tone="red" /></div>; }}
    fields={[{ name: 'type', label: 'نوع الحدث', type: 'select', options: evTypes, required: true, default: 'birth' }, { name: 'date', label: 'التاريخ', type: 'date', required: true },
      { name: 'animalId', label: 'الحيوان (للنفوق)', type: 'rel', col: 'animals', optLabel: animalLabel, where: alive }, { name: 'newTag', label: 'رقم الحيوان الجديد (للولادة/الشراء)', type: 'text' }, { name: 'newName', label: 'الاسم', type: 'text' }, { name: 'breed', label: 'السلالة', type: 'text' }, { name: 'sex', label: 'الجنس', type: 'select', options: [['F', 'أنثى'], ['M', 'ذكر']] }, { name: 'motherId', label: 'الأم (للولادة)', type: 'rel', col: 'animals', optLabel: animalLabel, where: alive }, { name: 'fatherId', label: 'الأب (للولادة)', type: 'rel', col: 'animals', optLabel: animalLabel },
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
    cols={(ctx) => [{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'الحدث', render: (r) => <Badge tone={r.type === 'death' ? 'red' : 'green'}>{EVT_AR[r.type]}</Badge> }, { key: 'tag', label: 'الحيوان', render: (r) => <b>{r.tag}</b> },
      { key: 'det', label: 'التفاصيل', render: (r) => { const a = ctx.animals.find((x) => x.id === r.animalId); const mom = ctx.animals.find((x) => x.id === r.motherId); return r.type === 'birth' ? <span className="text-xs">{a?.sex ? (a.sex === 'F' ? 'أنثى' : 'ذكر') : ''}{mom ? ` · أمه/ـا: ${mom.tag}` : ''}{a?.name ? ` · ${a.name}` : ''}</span> : <span className="text-xs">{a?.category ? animalCatLabel(a.category) : ''}{a?.name ? ` · ${a.name}` : ''}</span>; } },
      { key: 'notes', label: 'ملاحظات' }]} />
    {sale && <AnimalSale onClose={() => setSale(false)} />}</>);
}
// ───────── تسمين العجول
const CALF_TYPES = [['arrival_weight', 'وزن عند الوصول / الميلاد (جاء مع أمه)'], ['weight', 'وزن دوري'], ['feed', 'علف مستهلك'], ['milk', 'حليب مستهلك'], ['other', 'بند آخر (دواء، مكمّل، …)']];
const CALF_AR = { arrival_weight: 'وزن الوصول', weight: 'وزن دوري', feed: 'علف', milk: 'حليب', other: 'بند آخر' };
const CALF_UNIT = { arrival_weight: 'كغ', weight: 'كغ', feed: 'كغ', milk: 'لتر' };
const objText = (o) => Object.entries(o || {}).map(([k, v]) => `${k}: ${fmt(v)}`).join('، ');
/** عجول تسمين: وزن عند الوصول + أوزان دورية + علف وحليب وبنود أخرى لكل عجل، مع ملخص استهلاك لأي فترة (مثلاً بعد 5 أشهر). */
export function CalfFattening() {
  const s = useSettings(); const animals = useCol('animals').rows; const events = useCol('animalEvents').rows; const logs = useCol('calfLogs').rows.filter((l) => !l.voided);
  const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [calfId, setCalfId] = useState('');
  const herd = herdState(events, animals);
  const isCalf = (a) => !!herd[a.id]?.active && (a.category === 'heifer_calf' || !!a.motherId || (!!a.birthDate && monthsBetween(a.birthDate, today()) <= 12));
  const ids = [...new Set(logs.map((l) => l.calfId))].filter((id) => animals.some((a) => a.id === id && !a.voided) && (!calfId || id === calfId));
  const tagOf = (id) => { const a = animals.find((x) => x.id === id); return a ? animalLabel(a) : '—'; };
  const sum = ids.map((id) => ({ id, name: tagOf(id), ...calfFattening(id, logs, { from, to }) })).sort((a, b) => a.name.localeCompare(b.name));
  const report = { farm: s.farmName, title: `ملخص تسمين العجول${from || to ? ` (${from || '…'} ← ${to || '…'})` : ''}`, columns: [{ key: 'name', label: 'العجل' }, { key: 'startWeight', label: 'وزن البداية (كغ)' }, { key: 'endWeight', label: 'آخر وزن (كغ)' }, { key: 'gain', label: 'الزيادة (كغ)' }, { key: 'dailyGain', label: 'الزيادة اليومية (كغ)' }, { key: 'feed', label: 'العلف (كغ)' }, { key: 'milk', label: 'الحليب (لتر)' }, { key: 'otherTxt', label: 'بنود أخرى' }], rows: sum.map((r) => ({ ...r, otherTxt: objText(r.other) })) };
  const unit = (t) => CALF_UNIT[t] || '';
  const norm = (d, a) => ({ calfId: d.calfId, tag: a?.tag || '', date: d.date, type: d.type, qty: Number(d.qty), unit: unit(d.type) || String(d.unit || '').trim(), item: ['feed', 'other'].includes(d.type) ? String(d.item || '').trim() : '', notes: d.notes || '' });
  const check = (d) => { if (!d.calfId) throw new Error('اختر العجل'); if (!(Number(d.qty) > 0)) throw new Error('أدخل رقماً أكبر من صفر'); if (d.type === 'other' && !String(d.item || '').trim()) throw new Error('اكتب اسم البند'); };
  const inView = (r) => (!calfId || r.calfId === calfId) && (!from || r.date >= from) && (!to || r.date <= to);
  return (<div className="space-y-4">
    <Card title="ملخص استهلاك العجول" action={<ExportButtons report={report} />}>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-end">
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">من</span><input type="date" dir="ltr" className="input sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
        <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">إلى</span><input type="date" dir="ltr" className="input sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} /></label>
        <label className="col-span-2 block sm:col-span-1"><span className="mb-1 block text-xs font-bold text-slate-500">العجل</span><select className="input sm:w-56" value={calfId} onChange={(e) => setCalfId(e.target.value)}><option value="">كل العجول</option>{[...new Set(logs.map((l) => l.calfId))].map((id) => <option key={id} value={id}>{tagOf(id)}</option>)}</select></label>
        {(from || to || calfId) && <button type="button" className="btn btn-ghost !py-2 text-xs" onClick={() => { setFrom(''); setTo(''); setCalfId(''); }}>مسح</button>}
      </div>
      <Table rows={sum} empty={<Empty title="لا توجد بيانات تسمين بعد" hint="سجّل وزن العجل عند وصوله ثم العلف والحليب من «إضافة» أسفل." />} columns={[
        { key: 'name', label: 'العجل', render: (r) => <b>{r.name}</b> },
        { key: 'sw', label: 'وزن البداية', render: (r) => (r.startWeight === null ? '—' : <span className="num">{fmt(r.startWeight)} كغ</span>) },
        { key: 'ew', label: 'آخر وزن', render: (r) => (r.endWeight === null ? '—' : <span className="num">{fmt(r.endWeight)} كغ</span>) },
        { key: 'gain', label: 'الزيادة', render: (r) => (r.gain === null ? '—' : <b className={`num ${r.gain >= 0 ? 'text-emerald-700' : 'text-rose-600'}`}>{fmt(r.gain)} كغ{r.dailyGain !== null ? ` (${fmt(r.dailyGain)}/يوم)` : ''}</b>) },
        { key: 'feed', label: 'العلف المستهلك', render: (r) => <div><b className="num">{fmt(r.feed)} كغ</b>{Object.keys(r.feedByItem).length > 1 && <div className="text-xs text-slate-500">{objText(r.feedByItem)}</div>}</div> },
        { key: 'milk', label: 'الحليب المستهلك', render: (r) => <b className="num">{fmt(r.milk)} لتر</b> },
        { key: 'fc', label: 'كغ علف لكل كغ زيادة', hideMobile: true, render: (r) => (r.feedPerKgGain === null ? '—' : <span className="num">{fmt(r.feedPerKgGain)}</span>) },
        { key: 'oth', label: 'بنود أخرى', hideMobile: true, render: (r) => objText(r.other) || '—' }]} />
      <p className="mt-2 text-xs text-slate-500">الاستهلاك يُجمَع ضمن الفترة المختارة (فارغة = من البداية). الزيادة = آخر وزن − وزن البداية.</p>
    </Card>
    <CrudPage title="سجل تسمين العجول" subtitle="وزن العجل عند وصوله مع أمه، ثم كل علف وحليب وبند آخر يستهلكه — لتعرف بعد أشهر كم كلّفك" col="calfLogs" searchKeys={['tag', 'item', 'notes']} filter={inView}
      useCtx={() => ({ animals: useCol('animals').rows })} defaults={{ type: 'feed' }}
      fields={[{ name: 'calfId', label: 'العجل', type: 'rel', col: 'animals', optLabel: animalLabel, where: isCalf, required: true },
        { name: 'date', label: 'التاريخ', type: 'date', required: true },
        { name: 'type', label: 'النوع', type: 'select', required: true, options: CALF_TYPES, default: 'feed' },
        { name: 'qty', label: 'الكمية / الوزن (كغ للوزن والعلف، لتر للحليب)', type: 'number', min: 0, required: true, positive: true },
        { name: 'item', label: 'نوع العلف (اختياري) / اسم البند الآخر (مطلوب)', type: 'text', showIf: (v) => v.type === 'feed' || v.type === 'other' },
        { name: 'unit', label: 'وحدة البند الآخر (كغ، جرعة، …)', type: 'text', showIf: (v) => v.type === 'other' },
        { name: 'notes', label: 'ملاحظات', type: 'textarea' }]}
      create={async (u, d, { animals: an }) => { check(d); return saveRecord(u, 'calfLogs', norm(d, an.find((a) => a.id === d.calfId))); }}
      update={async (u, d, rec, { animals: an }) => { check(d); return saveRecord(u, 'calfLogs', norm(d, an.find((a) => a.id === d.calfId)), rec.id); }}
      cols={(ctx) => [{ key: 'date', label: 'التاريخ' }, { key: 'c', label: 'العجل', render: (r) => animalLabel(ctx.animals.find((a) => a.id === r.calfId) || { tag: r.tag || '—' }) },
        { key: 'type', label: 'النوع', render: (r) => <Badge tone={r.type === 'feed' ? 'amber' : r.type === 'milk' ? 'blue' : r.type === 'other' ? 'gray' : 'green'}>{CALF_AR[r.type] || r.type}</Badge> },
        { key: 'item', label: 'البند', hideMobile: true, render: (r) => r.item || '—' }, { key: 'qty', label: 'الكمية', render: (r) => <b className="num">{fmt(r.qty)} {r.unit || ''}</b> }, { key: 'notes', label: 'ملاحظات', hideMobile: true }]} />
  </div>);
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
  const { user, can } = useAuth();
  const [open, setOpen] = useState(false); const [q, setQ] = useState(''); const [yr, setYr] = useState('');
  const animals = useCol('animals').rows; const events = useCol('animalEvents').rows; const ledger = useCol('partnerCapitalTransactions').rows; const cash = useCol('cashTransactions').rows; const partners = useCol('partners').rows; const accounts = useCol('cashAccounts').rows;
  const pName = (id) => partners.find((p) => p.id === id)?.name || 'شريك'; const aName = (id) => accounts.find((a) => a.id === id)?.name || 'الصندوق';
  const animalOf = (id) => animals.find((a) => a.id === id);
  // تجميع الأحداث في عمليات: كل تبادل (خارج واحد أو أكثر + الوارد) بطاقة واحدة، وكل نقل بطاقة
  const groups = []; const map = new Map();
  for (const e of events.filter((x) => !x.voided && !animalOf(x.animalId)?.voided && (String(x.type).startsWith('exchange') || x.type === 'transfer_out'))) {
    if (e.type === 'transfer_out') { groups.push({ kind: 'transfer', id: e.id, date: e.date, outs: [e], ins: [], evs: [e] }); continue; }
    const k = e.exchangeId || `legacy:${e.id}`; let g = map.get(k); if (!g) { g = { kind: 'exchange', id: k, date: e.date, outs: [], ins: [], evs: [] }; map.set(k, g); groups.push(g); }
    g.evs.push(e); (e.type === 'exchange_out' ? g.outs : g.ins).push(e);
  }
  for (const g of groups) {
    g.outRows = g.outs.map((e) => { const a = animalOf(e.animalId); const cost = Number(e.costBasis) || Number(a?.acquisitionCost) || 0; const value = Number(e.value) || 0; return { id: e.id, tag: e.tag, animal: a, cost, value, result: e.result !== undefined && e.result !== null ? Number(e.result) : (g.kind === 'exchange' && cost > 0 ? round2(value - cost) : null), bearer: e.resultBearer || null, partnerIds: e.resultPartnerIds || [], currency: e.currency || 'SYP' }; });
    const inEv = g.ins[0]; g.inEv = inEv; g.inAnimal = inEv ? animalOf(inEv.animalId) || { id: inEv.animalId, tag: inEv.tag } : null;
    g.info = g.inAnimal ? animalExchangeInfo(g.inAnimal, { events, ledger, cash }) : null;
    g.currency = g.info?.currency || g.outRows[0]?.currency || 'SYP';
    g.resultTotal = g.outRows.some((r) => r.result !== null) ? round2(g.outRows.reduce((t, r) => t + (r.result || 0), 0)) : null;
    g.resultBearer = g.outRows.find((r) => r.bearer)?.bearer || null; g.resultPartners = [...new Set(g.outRows.flatMap((r) => r.partnerIds))];
  }
  groups.sort((a, b) => String(b.date).localeCompare(String(a.date)));
  const years = [...new Set(groups.map((g) => String(g.date || '').slice(0, 4)).filter(Boolean))].sort().reverse();
  const shown = groups.filter((g) => (!yr || String(g.date || '').startsWith(yr)) && (!q || [g.outRows.map((r) => r.tag).join(' '), g.inEv?.tag, g.evs[0]?.notes].join(' ').includes(q.trim())));
  // ملخص (بالليرة السورية)
  const ex = shown.filter((g) => g.kind === 'exchange' && g.currency === 'SYP' && g.info);
  const paid = round2(ex.filter((g) => g.info.diff > 0).reduce((t, g) => t + g.info.diff, 0)), got = round2(ex.filter((g) => g.info.diff < 0).reduce((t, g) => t - g.info.diff, 0));
  const resFarm = round2(ex.filter((g) => g.resultTotal && g.resultBearer === 'farm').reduce((t, g) => t + g.resultTotal, 0)), resPart = round2(ex.filter((g) => g.resultTotal && g.resultBearer === 'partners').reduce((t, g) => t + g.resultTotal, 0));
  const diffTone = (d) => (d === 0 ? 'bg-slate-50 text-slate-700' : d > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700');
  const payerText = (g) => { const i = g.info; if (!i || i.diff === 0) return ''; if (i.diff > 0) return i.paidBy === 'partner' ? `دفعه الشريك ${pName(i.partnerId)} — سُجّل في حسابه` : i.paidBy === 'account' ? `دُفع من صندوق: ${aName(i.accountId)}` : 'لم يُحدَّد من دفعه';
    const ps = (i.partners || []).map((q2) => `${pName(q2.partnerId)} (${fmt(q2.amount)})`).join(' + ');
    return i.paidBy === 'partner' ? `عاد لدافع ثمن البقرة الخارجة: ${ps}${i.accountId ? ` — والباقي لصندوق ${aName(i.accountId)}` : ''}` : i.paidBy === 'account' ? `استلمه صندوق: ${aName(i.accountId)}` : 'لم يُحدَّد من استلمه'; };
  const doVoid = async (g) => { const why = prompt(g.kind === 'transfer' ? 'سبب الإلغاء؟' : 'سبب إلغاء التبادل كاملاً (الخارج والوارد والفرق وقيود الشركاء)؟'); if (why) await voidExchange(user, g.evs, { cash, ledger }, why); };
  return (<>
    <PageHeader title="تبادل ونقل المواشي" subtitle="كل عملية في بطاقة: البقرات الخارجة وسعر شراء كل واحدة وقيمتها، والوارد، والفرق ومن دفعه أو استلمه، والربح أو الخسارة"><ExchangeDiffConvert /><button className="btn btn-primary" onClick={() => setOpen(true)}>تبادل / نقل جديد</button></PageHeader>
    {groups.length > 0 && <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="عدد العمليات" value={shown.length} /><Stat label="فروق دفعناها" value={<span className="text-base sm:text-xl">{money(paid)}</span>} tone="red" /><Stat label="فروق استلمناها" value={<span className="text-base sm:text-xl">{money(got)}</span>} tone="green" /><Stat label={`ربح/خسارة التبادل (مزرعة ${fmt(resFarm)} · شركاء ${fmt(resPart)})`} value={<span className="text-base sm:text-xl">{money(round2(resFarm + resPart))}</span>} tone={resFarm + resPart >= 0 ? 'green' : 'red'} /></div>}
    {groups.length > 0 && <div className="mb-3 flex flex-wrap items-end gap-2"><label className="block sm:w-64"><span className="mb-1 block text-xs font-bold text-slate-500">بحث برقم الحيوان</span><input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="رقم البقرة…" /></label><label className="block sm:w-40"><span className="mb-1 block text-xs font-bold text-slate-500">السنة</span><select className="input" value={yr} onChange={(e) => setYr(e.target.value)}><option value="">كل السنوات</option>{years.map((y) => <option key={y} value={y}>{y}</option>)}</select></label></div>}
    {!groups.length && <Empty title="لا توجد عمليات تبادل أو نقل بعد" hint="اضغط «تبادل / نقل جديد»." />}
    <div className="space-y-3">{shown.map((g) => {
      const outTags = g.outRows.map((r) => r.tag).join('، ');
      return (<div key={g.id} className="rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-4 py-2.5">
          <Badge tone={g.kind === 'transfer' ? 'gray' : 'blue'}>{g.kind === 'transfer' ? 'نقل' : 'تبادل'}</Badge><b className="num">{g.date}</b>
          <span className="text-sm text-slate-600">{g.kind === 'transfer' ? `${outTags} ← خارج المزرعة` : `${g.outRows.length > 1 ? `${g.outRows.length} حيوانات (${outTags})` : outTags} ⇄ ${g.inEv?.tag || '—'}`}</span>
          {can('voidFinancial') && <button className="ms-auto rounded p-1.5 text-rose-600 hover:bg-rose-50" title={g.kind === 'transfer' ? 'إلغاء النقل' : 'إلغاء التبادل كاملاً'} onClick={() => doVoid(g)}><Ban size={15} /></button>}
        </div>
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <div><div className="mb-1 text-xs font-bold text-slate-500">{g.kind === 'transfer' ? 'الحيوان المنقول' : `الخارج من عندنا (${g.outRows.length})`}</div>
            <Table rows={g.outRows} columns={g.kind === 'transfer'
              ? [{ key: 'tag', label: 'الحيوان', render: (r) => <b>{r.tag}</b> }, { key: 'c', label: 'الفئة', render: (r) => (r.animal?.category ? animalCatLabel(r.animal.category) : '—') }, { key: 'k', label: 'سعر شرائه', render: (r) => (r.cost ? <span className="num">{fmt(r.cost)}</span> : '—') }]
              : [{ key: 'tag', label: 'الحيوان', render: (r) => <b>{r.tag}</b> }, { key: 'cost', label: 'سعر شرائه', render: (r) => (r.cost ? <span className="num">{fmt(r.cost)}</span> : '—') }, { key: 'value', label: 'قيمته بالتبادل', render: (r) => <span className="num">{fmt(r.value)}</span> },
                { key: 'res', label: 'النتيجة', render: (r) => (r.result === null ? '—' : <Badge tone={r.result > 0 ? 'green' : r.result < 0 ? 'red' : 'gray'}><span className="num">{r.result > 0 ? '+' : r.result < 0 ? '−' : ''}{fmt(Math.abs(r.result))}</span></Badge>) }]} /></div>
          {g.kind === 'exchange' && <div className="space-y-2">
            <div className="text-xs font-bold text-slate-500">الوارد إلينا</div>
            <div className="rounded-lg border border-slate-200 p-3 text-sm"><b>{g.inEv?.tag || '—'}</b>{g.inAnimal?.name ? ` · ${g.inAnimal.name}` : ''}{g.inAnimal?.category ? ` · ${animalCatLabel(g.inAnimal.category)}` : ''}<div className="text-xs text-slate-500">قيمته بالتبادل: <b className="num">{fmt(g.inEv?.value || 0)}</b> {g.currency}</div></div>
            {g.info && <div className={`rounded-lg p-3 text-sm ${diffTone(g.info.diff)}`}><div className="font-bold">{g.info.diff === 0 ? 'لا يوجد فرق نقدي' : g.info.diff > 0 ? `دفعنا فرقاً: ${fmt(g.info.diff)} ${g.currency}` : `استلمنا فرقاً: ${fmt(-g.info.diff)} ${g.currency}`}</div>{payerText(g) && <div className="mt-0.5 text-xs">{payerText(g)}</div>}<div className="mt-0.5 text-[11px] opacity-70">إجمالي قيمة الخارج {fmt(g.info.outValue)} ↔ قيمة الوارد {fmt(g.info.inValue)}</div></div>}
            {g.resultTotal !== null && g.resultTotal !== 0 && <div className={`rounded-lg p-3 text-sm font-bold ${g.resultTotal < 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{g.resultTotal < 0 ? 'خسارة' : 'ربح'} التبادل: {fmt(Math.abs(g.resultTotal))} {g.currency}{g.resultBearer ? ` — ${g.resultTotal < 0 ? 'على' : 'لصالح'} ${g.resultBearer === 'farm' ? 'المزرعة' : (g.resultPartners.map(pName).join(' و') || 'الشركاء')}` : ''}</div>}
          </div>}
        </div>
        {g.evs[0]?.notes && <div className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">ملاحظات: {g.evs[0].notes}</div>}
      </div>);
    })}</div>
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
