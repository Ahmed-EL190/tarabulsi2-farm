import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, AlertTriangle, XCircle } from 'lucide-react';
import { Card, PageHeader, Stat, Table, Badge, fmt } from '../components/ui';
import { useCol, useStoreStatus } from '../data/db';
import { useAuth } from '../data/auth';
import { applyFixOps } from '../data/ops';
import { auditData } from '../lib/integrity';

const AREAS = ['الصندوق', 'المصروفات', 'المبيعات والحليب', 'المواشي', 'الشركاء والقروض', 'التسويات', 'عام'];

function CheckCard({ c, user, can }) {
  const [open, setOpen] = useState(false); const [msg, setMsg] = useState(''); const [busy, setBusy] = useState(false);
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
        <ul className="mt-2 space-y-1 pr-6 text-xs leading-relaxed text-slate-700">{shown.map((it, i) => <li key={i} className="list-disc">{it.text}{it.link && <Link className="mr-2 font-bold text-brand" to={it.link}>فتح</Link>}</li>)}</ul>
        <div className="mt-2 flex flex-wrap items-center gap-2 pr-6">
          {c.items.length > 5 && <button className="text-xs font-bold text-brand" onClick={() => setOpen(!open)}>{open ? 'إخفاء' : `عرض الكل (${c.items.length})`}</button>}
          {c.fix && can('voidFinancial') && <button className="btn btn-primary !px-3 !py-1.5 text-xs" disabled={busy} onClick={fix}>{c.fix.label} ({c.fix.ops.length})</button>}
          {c.link && !c.items.some((i) => i.link) && <Link className="btn btn-ghost !px-3 !py-1.5 text-xs" to={c.link}>الذهاب للصفحة</Link>}
          {msg && <span className="text-xs font-bold text-slate-600">{msg}</span>}
        </div>
      </>}
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
      <div className="space-y-2.5">{[...list].sort((a, b) => (b.items.length > 0) - (a.items.length > 0) || (a.level === 'error' ? -1 : 1) - (b.level === 'error' ? -1 : 1)).map((c) => <CheckCard key={c.id} c={c} user={user} can={can} />)}</div>
    </div>
  );
}
