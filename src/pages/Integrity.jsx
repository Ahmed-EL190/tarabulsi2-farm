import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Card, PageHeader, Stat, Table, Badge, fmt } from '../components/ui';
import { FormModal } from '../components/CrudPage';
import { useCol, useStoreStatus, saveRecord } from '../data/db';
import { useAuth } from '../data/auth';
import { applyFixOps, linkExpensesToPartners, saveExpenseEdit, updateDelivery, updateCustomerPayment, updateCashMovement, postAnimalSaleCash, setPurchaseSource, voidAnimalEventCascade, updateLedgerEntry, voidLedgerEntry } from '../data/ops';
import { auditData } from '../lib/integrity';
import { allExpenseCategories, PARTNER_EXPENSE_CATS, METHODS } from '../lib/constants';

const ACCT = { name: 'accountId', label: 'الصندوق / الحساب', type: 'rel', col: 'cashAccounts', required: true };
const SHIFTS = [['morning', 'صباحاً'], ['evening', 'مساءً'], ['all', 'على مدار اليوم (إجمالي)']];

/** نافذة تصحيح مباشرة للسجل المعيب (بدون الخروج من صفحة الفحص). تُغلق بعد الحفظ وتتحدّث نتيجة الفحص تلقائياً. */
function Resolver({ r, D, user, onClose }) {
  const by = (arr, id) => (arr || []).find((x) => x.id === id);
  const num = (name, label, extra = {}) => ({ name, label, type: 'number', required: true, positive: true, ...extra });
  if (r.kind === 'expense-partner') {
    const e = by(D.expenses, r.id); const guess = D.partners.find((p) => e.workerName && (p.name.includes(e.workerName) || e.workerName.includes(p.name)))?.id || '';
    return <FormModal open onClose={onClose} title={`ربط «${e.description}» (${e.amount}) بحساب شريك`} submitLabel="ربط وقيد في الحساب" fields={[{ name: 'partnerId', label: 'الشريك الذي يُقيَّد في حسابه', type: 'rel', col: 'partners', required: true }]} defaults={{ partnerId: guess }}
      onSubmit={(d) => linkExpensesToPartners(user, [{ expense: e, partnerId: d.partnerId }], { pays: D.expensePays, ledger: D.ledger, loans: D.loans, repayments: D.loanReps })} />;
  }
  if (r.kind === 'expense-edit') {
    const e = by(D.expenses, r.id);
    return <FormModal open onClose={onClose} title="تعديل المصروف" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'category', label: 'الفئة', type: 'select', required: true, options: allExpenseCategories() }, { name: 'description', label: 'الوصف', type: 'text', required: true }, num('amount', 'المبلغ'), { name: 'partnerAccountId', label: 'الشريك (يُقيَّد في حسابه)', type: 'rel', col: 'partners', showIf: (v) => !!PARTNER_EXPENSE_CATS[v.category] }]}
      defaults={{ date: e.date, category: e.category, description: e.description || '', amount: e.amount, partnerAccountId: e.partnerAccountId || '' }}
      onSubmit={(d) => saveExpenseEdit(user, e, { ...d, amount: Number(d.amount) }, { pays: D.expensePays, cash: D.cash, ledger: D.ledger, loans: D.loans, reps: D.loanReps })} />;
  }
  if (r.kind === 'delivery-edit') {
    const del = by(D.deliveries, r.id); const ag = by(D.agreements, del.agreementId);
    return <FormModal open onClose={onClose} title="تعديل تسليم حليب" fields={[{ name: 'date', label: 'تاريخ التسليم', type: 'date', required: true }, num('qty', `الكمية (لتر) — المتفق عليه ${ag?.agreedQty ?? ''}`), { name: 'pricePerLiter', label: 'سعر اللتر (فارغ = سعر الاتفاق)', type: 'number', min: 0 }, { name: 'notes', label: 'ملاحظات', type: 'text' }]}
      defaults={{ date: del.date, qty: del.qty, pricePerLiter: del.pricePerLiter ?? '', notes: del.notes || '' }} onSubmit={(d) => updateDelivery(user, ag, D.deliveries, del, d)} />;
  }
  if (r.kind === 'custpay-edit') {
    const p = by(D.custPays, r.id);
    return <FormModal open onClose={onClose} title="تعديل دفعة عميل" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, num('amount', 'المبلغ'), ACCT, { name: 'method', label: 'طريقة الدفع', type: 'select', options: METHODS, default: 'cash' }, { name: 'note', label: 'ملاحظة', type: 'text' }]}
      defaults={{ date: p.date, amount: p.amount, accountId: p.accountId || '', method: p.method || 'cash', note: p.note || '' }} onSubmit={(d) => updateCustomerPayment(user, p, D.cash, d)} />;
  }
  if (r.kind === 'cash-edit') {
    const t = by(D.cash, r.id);
    return <FormModal open onClose={onClose} title="تعديل حركة الصندوق" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, num('amount', 'المبلغ'), ACCT, { name: 'description', label: 'البيان', type: 'text' }]}
      defaults={{ date: t.date, amount: t.amount, accountId: t.accountId || '', description: t.description || '' }}
      onSubmit={(d) => updateCashMovement(user, t, { ...d, note: d.description }, { custPays: D.custPays, expPays: D.expensePays, expenses: D.expenses, ledger: D.ledger, cash: D.cash, loans: D.loans, reps: D.loanReps, events: D.events, animals: D.animals })} />;
  }
  if (r.kind === 'sale-cash') {
    const ev = by(D.events, r.id);
    return <FormModal open onClose={onClose} title={`إدخال ثمن بيع ${ev.tag || ''} (${ev.value}) في الصندوق`} submitLabel="تسجيل في الصندوق" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, ACCT]} defaults={{ date: ev.date, accountId: '' }} onSubmit={(d) => postAnimalSaleCash(user, ev, d)} />;
  }
  if (r.kind === 'purchase-source') {
    const ev = by(D.events, r.id); const animal = by(D.animals, ev.animalId);
    return <FormModal open onClose={onClose} title={`مصدر دفع شراء ${ev.tag || ''} (${ev.value})`} fields={[{ name: 'payFrom', label: 'مَن دفع؟', type: 'select', required: true, options: [['partner', 'شريك — يُسجَّل المبلغ في حسابه'], ['account', 'من صندوق المزرعة']], default: 'partner' }, { name: 'payPartnerId', label: 'الشريك', type: 'rel', col: 'partners', showIf: (v) => (v.payFrom || 'partner') === 'partner' }, { ...ACCT, required: false, showIf: (v) => v.payFrom === 'account' }]}
      defaults={{ payFrom: 'partner', payPartnerId: ev.payerPartnerId || '', accountId: '' }} onSubmit={(d) => setPurchaseSource(user, ev, animal, { from: d.payFrom || 'partner', partnerId: d.payPartnerId, accountId: d.accountId, ctx: { cash: D.cash, ledger: D.ledger } })} />;
  }
  if (r.kind === 'production-edit') {
    const rec = by(D.production, r.id);
    return <FormModal open onClose={onClose} title="تعديل سجل إنتاج الحليب" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'shift', label: 'الوردية', type: 'select', required: true, options: SHIFTS }, num('liters', 'الكمية (لتر)'), { name: 'group', label: 'المجموعة', type: 'text' }, { name: 'notes', label: 'ملاحظات', type: 'text' }]}
      defaults={{ date: rec.date, shift: rec.shift, liters: rec.liters, group: rec.group || '', notes: rec.notes || '' }} onSubmit={(d) => saveRecord(user, 'milkProduction', { ...d, liters: Number(d.liters) }, rec.id)} />;
  }
  if (r.kind === 'ledger-edit') {
    const le = by(D.ledger, r.id); const lctx = { ledger: D.ledger, cash: D.cash, loans: D.loans, reps: D.loanReps, events: D.events, animals: D.animals, pays: D.expensePays, expenses: D.expenses };
    return <FormModal open onClose={onClose} title={`قيد في حساب ${D.partners.find((x) => x.id === le.partnerId)?.name || 'الشريك'}`} fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, num('amount', 'المبلغ'), { name: 'note', label: 'البيان', type: 'text' }]}
      defaults={{ date: le.date, amount: le.amount, note: le.note || '' }} onSubmit={(d) => updateLedgerEntry(user, le, lctx, d)} />;
  }
  if (r.kind === 'partner-edit') {
    const pt = by(D.partners, r.id);
    return <FormModal open onClose={onClose} title={`نسب ${pt.name}`} fields={[{ name: 'ownershipPct', label: 'نسبة الملكية %', type: 'number', min: 0, required: true }, { name: 'profitSharePct', label: 'نسبة الأرباح %', type: 'number', min: 0, required: true }]}
      defaults={{ ownershipPct: pt.ownershipPct, profitSharePct: pt.profitSharePct }} onSubmit={(d) => saveRecord(user, 'partners', { ownershipPct: Number(d.ownershipPct), profitSharePct: Number(d.profitSharePct) }, pt.id)} />;
  }
  return null;
}

const AREAS = ['الصندوق', 'المصروفات', 'المبيعات والحليب', 'المواشي', 'الشركاء والقروض', 'التسويات', 'عام'];

function CheckCard({ c, user, can, D }) {
  const [open, setOpen] = useState(false); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false); const [res, setRes] = useState(null);
  const act = async (r) => { if (r.kind !== 'event-void') return setRes(r); const ev = D.events.find((x) => x.id === r.id); const why = prompt('سبب إلغاء هذا الحدث؟ (يُلغى معه ما يرتبط به)'); if (why) { try { await voidAnimalEventCascade(user, ev, { cash: D.cash, ledger: D.ledger }, why); } catch (e) { alert(e.message); } } return undefined; };
  const bad = c.items.length > 0; const tone = !bad ? 'green' : c.level === 'error' ? 'red' : 'amber';
  const shown = open ? c.items : c.items.slice(0, 5);
  const fix = async () => { if (!confirm(`${c.fix.label} (${c.fix.ops.length} عملية)؟ تبقى كلها في سجل التدقيق.`)) return; setBusy(true); setMsg(''); try { const k = await applyFixOps(user, c.fix.ops); setMsg(`تم: ${k} عملية`); } catch (e) { setMsg(e.message); } setBusy(false); };
  return (
    <div className={`rounded-xl border p-3 ${!bad ? 'border-slate-100 bg-white' : c.level === 'error' ? 'border-red-200 bg-red-50/40' : 'border-amber-200 bg-amber-50/40'}`}>
      <div className="flex items-start gap-2">
        {!bad ? <CheckCircle2 size={18} className="mt-0.5 shrink-0 text-emerald-600" /> : c.level === 'error' ? <XCircle size={18} className="mt-0.5 shrink-0 text-red-600" /> : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-amber-600" />}
        <div className="min-w-0 flex-1"><div className="text-sm font-bold text-slate-800">{c.title}</div>{bad && c.hint && <div className="mt-0.5 text-xs text-slate-500">{c.hint}</div>}</div>
        <Badge tone={tone}>{bad ? c.items.length : 'سليم'}</Badge>
      </div>
      {bad && <>
        <ul className="mt-2 space-y-1 pr-6 text-xs leading-relaxed text-slate-700">{shown.map((it, i) => <li key={i} className="list-disc">{it.text}{it.resolve && can('update') && <button className="btn btn-primary mr-2 !px-2.5 !py-0.5 text-[11px]" onClick={() => act(it.resolve)}>{it.resolve.kind === 'event-void' ? 'إلغاء الحدث' : 'تصحيح الآن'}</button>}{it.resolve?.kind === 'ledger-edit' && can('voidFinancial') && <button className="btn btn-danger mr-1 !px-2.5 !py-0.5 text-[11px]" onClick={async () => { const why = prompt('سبب حذف هذا القيد؟'); if (why) { try { await voidLedgerEntry(user, D.ledger.find((x) => x.id === it.resolve.id), { ledger: D.ledger, cash: D.cash, loans: D.loans, reps: D.loanReps, events: D.events, animals: D.animals, pays: D.expensePays, expenses: D.expenses }, why); } catch (e) { alert(e.message); } } }}>حذف القيد</button>}{it.link && <Link className="mr-2 font-bold text-brand" to={it.link}>فتح</Link>}</li>)}</ul>
        <div className="mt-2 flex flex-wrap items-center gap-2 pr-6">
          {c.items.length > 5 && <button className="text-xs font-bold text-brand" onClick={() => setOpen(!open)}>{open ? 'إخفاء' : `عرض الكل (${c.items.length})`}</button>}
          {c.fix && can('voidFinancial') && <button className="btn btn-primary !px-3 !py-1.5 text-xs" disabled={busy} onClick={fix}>{c.fix.label} ({c.fix.ops.length})</button>}
          {c.link && !c.items.some((i) => i.link) && <Link className="btn btn-ghost !px-3 !py-1.5 text-xs" to={c.link}>الذهاب للصفحة</Link>}
          {msg && <span className="text-xs font-bold text-slate-600">{msg}</span>}
        </div>
      </>}
      {res && <Resolver r={res} D={D} user={user} onClose={() => setRes(null)} />}
    </div>
  );
}

export default function Integrity() {
  const { user, can } = useAuth(); const st = useStoreStatus();
  const D = {
    cash: useCol('cashTransactions').rows, accounts: useCol('cashAccounts').rows, expenses: useCol('expenses').rows, expensePays: useCol('expensePayments').rows, custPays: useCol('customerPayments').rows,
    agreements: useCol('milkSales').rows, deliveries: useCol('milkDeliveries').rows, partners: useCol('partners').rows, ledger: useCol('partnerCapitalTransactions').rows, loans: useCol('partnerLoans').rows,
    loanReps: useCol('partnerLoanRepayments').rows, settlements: useCol('settlements').rows, animals: useCol('animals').rows, events: useCol('animalEvents').rows, production: useCol('milkProduction').rows,
  };
  const deps = Object.values(D);
  const r = useMemo(() => auditData(D), deps);
  const [area, setArea] = useState('');
  const S = r.summary; const loading = st.loading > 0;
  const list = r.checks.filter((c) => (!area || c.area === area));
  const problems = (a) => r.checks.filter((c) => c.area === a && c.items.length).length;
  return (
    <div>
      <PageHeader title="فحص سلامة البيانات" subtitle="يراجع ارتباط المصروفات والمبيعات والصندوق والشركاء والمواشي والقروض والتسويات ببعضها، ويعرّفك بأي حاجة مش مظبوطة" />
      {loading && <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm font-bold text-amber-800">جارٍ تحميل البيانات… نتيجة الفحص ستكتمل بعد التحميل.</div>}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="أخطاء" value={S.errors} tone={S.errors ? 'red' : 'green'} icon={XCircle} /><Stat label="تحذيرات" value={S.warnings} tone={S.warnings ? 'amber' : 'green'} icon={AlertTriangle} />
        <Stat label="فحوص سليمة" value={`${S.ok} / ${S.total}`} tone="green" icon={CheckCircle2} /><Stat label="أرقام غير متطابقة" value={S.reconBad} tone={S.reconBad ? 'red' : 'green'} />
      </div>
      {!loading && !S.errors && !S.warnings && !S.reconBad && <div className="mb-4 rounded-xl bg-emerald-50 p-4 text-center text-sm font-extrabold text-emerald-800">كل الفحوص سليمة: المصروفات والمبيعات والصندوق والشركاء والمواشي مترابطة ومتطابقة.</div>}
      <Card title="مطابقة الأرقام (لازم تتساوى)" className="mb-4">
        <Table rows={r.reconciliation.map((x, i) => ({ id: i, ...x }))} empty={<div className="py-4 text-center text-sm text-slate-400">لا توجد بيانات للمطابقة بعد</div>}
          columns={[{ key: 'label', label: 'البند' }, { key: 'a', label: 'الأول', render: (x) => <span className="num">{fmt(x.a)}</span> }, { key: 'b', label: 'المقابل', render: (x) => <span className="num">{fmt(x.b)}</span> }, { key: 'diff', label: 'الفرق', render: (x) => <b className={`num ${x.ok ? 'text-emerald-700' : 'text-rose-600'}`}>{x.ok ? '✓ متطابق' : fmt(x.diff)}</b> }]} />
      </Card>
      <div className="mb-3 flex flex-wrap gap-2">
        <button className={`btn !px-3 !py-1.5 ${!area ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setArea('')}>الكل</button>
        {AREAS.map((a) => <button key={a} className={`btn !px-3 !py-1.5 ${area === a ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setArea(a)}>{a}{problems(a) > 0 && <span className="rounded-full bg-red-600 px-1.5 text-[10px] text-white">{problems(a)}</span>}</button>)}
      </div>
      <div className="space-y-2.5">{[...list].sort((a, b) => (b.items.length > 0) - (a.items.length > 0) || (a.level === 'error' ? -1 : 1) - (b.level === 'error' ? -1 : 1)).map((c) => <CheckCard key={c.id} c={c} user={user} can={can} D={D} />)}</div>
    </div>
  );
}
