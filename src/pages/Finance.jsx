import { useMemo, useState } from 'react';
import { ArrowLeftRight, Wallet, HandCoins, ListChecks, Pencil, Ban } from 'lucide-react';
import CrudPage, { FormModal } from '../components/CrudPage';
import ExportButtons from '../components/ExportButtons';
import { Card, Table, Badge, Empty, PageHeader, Stat, Modal, money, fmt, today } from '../components/ui';
import { useCol, useSettings, saveRecord, commit } from '../data/db';
import { payExpense, addExpenseWithPayment, updateExpenseSynced, updateExpensePayment, voidExpensePayment, transferCash, addOtherIncome, createLoan, repayLoan, finalizeSettlement, partnerMovement } from '../data/ops';
import { useAuth } from '../data/auth';
import { cashBalances, cashFlowSummary, expensePosition, loanPosition, partnerLedger, profitAndLoss, allocateProfit, validateShares, customerPosition, round2, sumByCurrency } from '../lib/finance';
import { CURRENCIES, METHODS, EXPENSE_CATEGORIES, catLabel, CASH_AR } from '../lib/constants';

const cur = { name: 'currency', label: 'العملة', type: 'select', options: CURRENCIES, required: true, default: 'SYP' };
const acct = { name: 'accountId', label: 'الصندوق / الحساب', type: 'rel', col: 'cashAccounts' };

// ───────── الصندوق والحسابات
export function Cash() {
  const { user, can } = useAuth();
  const [tab, setTab] = useState('bal'); const [m, setM] = useState(null);
  const accounts = useCol('cashAccounts').rows.filter((a) => !a.voided); const txs = useCol('cashTransactions').rows.filter((t) => !t.voided);
  const bal = cashBalances(txs); const [from, setFrom] = useState(''); const [to, setTo] = useState(''); const [c, setC] = useState('SYP'); const s = useSettings();
  const flow = cashFlowSummary(txs, { from, to, currency: c });
  const shown = txs.filter((t) => (!from || t.date >= from) && (!to || t.date <= to)).sort((a, b) => b.date.localeCompare(a.date));
  const acctName = (id) => accounts.find((a) => a.id === id)?.name || '—';
  const report = { farm: s.farmName, title: 'دفتر الصندوق', from, to, currency: c, columns: [{ key: 'date', label: 'التاريخ', type: 'date' }, { key: 'typeAr', label: 'النوع' }, { key: 'acct', label: 'الحساب' }, { key: 'description', label: 'البيان' }, { key: 'cur', label: 'العملة' }, { key: 'inAmt', label: 'وارد', type: 'money' }, { key: 'outAmt', label: 'صادر', type: 'money' }],
    rows: shown.filter((t) => t.currency === c).map((t) => ({ ...t, typeAr: CASH_AR[t.type] || t.type, acct: acctName(t.accountId), cur: t.currency, inAmt: t.direction === 'in' ? Number(t.amount) : 0, outAmt: t.direction === 'out' ? Number(t.amount) : 0 })) };
  report.totals = { inAmt: round2(report.rows.reduce((a, r) => a + r.inAmt, 0)), outAmt: round2(report.rows.reduce((a, r) => a + r.outAmt, 0)) };
  return (
    <div>
      <PageHeader title="الصندوق والحسابات" subtitle="كل عملة وكل حساب برصيد منفصل — التحويلات الداخلية ليست دخلاً ولا مصروفاً">
        {can('create') && <><button className="btn btn-ghost" onClick={() => setM('transfer')}><ArrowLeftRight size={16} />تحويل بين حسابين</button><button className="btn btn-primary" onClick={() => setM('income')}>إيراد آخر</button></>}
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2 [&>.btn]:flex-1 sm:[&>.btn]:flex-none">{[['bal', 'الأرصدة'], ['tx', 'الحركات'], ['acc', 'الحسابات']].map(([k, l]) => <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'bal' && (accounts.length === 0 ? <Card><Empty title="لا توجد صناديق أو حسابات" hint="أنشئ أول صندوق وأدخل رصيده الافتتاحي من تبويب الحسابات." /></Card> :
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{accounts.flatMap((a) => { const keys = Object.keys(bal).filter((k) => k.startsWith(a.id + '|')); return (keys.length ? keys : [`${a.id}|SYP`]).map((k) => <Stat key={k} label={`${a.name} (${k.split('|')[1]})`} value={money(bal[k] || 0, k.split('|')[1])} icon={Wallet} />); })}</div>)}
      {tab === 'tx' && <Card>
        <div className="mb-3 flex flex-wrap items-end gap-2"><select className="input w-full sm:w-24" value={c} onChange={(e) => setC(e.target.value)}>{CURRENCIES.map(([v]) => <option key={v}>{v}</option>)}</select><input type="date" className="input w-full sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-full sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} /><ExportButtons report={report} /></div>
        <div className="mb-3 grid gap-2 sm:grid-cols-3"><Stat label={`إجمالي الوارد ${c}`} value={fmt(flow.totalIn)} tone="green" /><Stat label={`إجمالي الصادر ${c}`} value={fmt(flow.totalOut)} tone="red" /><Stat label="الصافي" value={fmt(flow.net)} /></div>
        <Table rows={report.rows} empty={<Empty title="لا توجد حركات" />} columns={report.columns.map((x) => ({ ...x, render: x.type === 'money' ? (r) => <span className="num">{r[x.key] ? fmt(r[x.key]) : '—'}</span> : undefined }))} /></Card>}
      {tab === 'acc' && <CrudPage title="الحسابات" col="cashAccounts" searchKeys={['name']} fields={[{ name: 'name', label: 'اسم الصندوق / الحساب', type: 'text', required: true }, { name: 'kind', label: 'النوع', type: 'select', required: true, options: [['cash', 'صندوق نقدي'], ['bank', 'حساب بنكي']], default: 'cash' }, { name: 'openingBalance', label: 'رصيد افتتاحي (اختياري)', type: 'number', min: 0 }, { name: 'openingCurrency', label: 'عملة الرصيد الافتتاحي', type: 'select', options: CURRENCIES, default: 'SYP' }, { name: 'openingDate', label: 'تاريخ الرصيد الافتتاحي', type: 'date' }]}
        create={async (u, d) => { const { openingBalance, openingCurrency, openingDate, ...rest } = d; const [id] = await commit(u, [{ col: 'cashAccounts', data: rest }]);
          if (Number(openingBalance) > 0) await commit(u, [{ col: 'cashTransactions', data: { date: openingDate || today(), type: 'opening_balance', direction: 'in', amount: Number(openingBalance), currency: openingCurrency || 'SYP', accountId: id, description: 'رصيد افتتاحي' } }]); }}
        cols={() => [{ key: 'name', label: 'الاسم' }, { key: 'kind', label: 'النوع', render: (r) => (r.kind === 'bank' ? 'بنك' : 'صندوق') }]} />}
      <FormModal open={m === 'transfer'} onClose={() => setM(null)} title="تحويل بين حسابين" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'fromAccountId', label: 'من', type: 'rel', col: 'cashAccounts', required: true }, { name: 'toAccountId', label: 'إلى', type: 'rel', col: 'cashAccounts', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, cur, { name: 'description', label: 'البيان', type: 'text' }]}
        defaults={{ date: today(), currency: 'SYP' }} onSubmit={(d) => { if (d.fromAccountId === d.toAccountId) throw new Error('اختر حسابين مختلفين'); return transferCash(user, d); }} />
      <FormModal open={m === 'income'} onClose={() => setM(null)} title="إيراد آخر" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { ...acct, required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, cur, { name: 'description', label: 'البيان', type: 'text', required: true }]}
        defaults={{ date: today(), currency: 'SYP' }} onSubmit={(d) => addOtherIncome(user, d)} />
    </div>
  );
}

// ───────── المصروفات
/** دفعات مصروف واحد: تعديل تاريخ/مبلغ أو إلغاء — حركة الصندوق ترافق التعديل تلقائياً. */
function ExpensePaymentsModal({ expense, onClose }) {
  const { user, can } = useAuth();
  const pays = useCol('expensePayments').rows; const cash = useCol('cashTransactions').rows; const ledger = useCol('partnerCapitalTransactions').rows;
  const accounts = useCol('cashAccounts').rows; const partners = useCol('partners').rows;
  const [ed, setEd] = useState(null);
  const mine = pays.filter((p) => p.expenseId === expense.id && !p.voided).sort((a, b) => a.date.localeCompare(b.date));
  const pos = expensePosition(expense, pays); const links = { cash, ledger };
  return (
    <Modal open onClose={onClose} title={`دفعات: ${expense.description}`} wide>
      <div className="mb-3 grid grid-cols-3 gap-2"><Stat label="المستحق" value={<span className="text-base">{fmt(expense.amount)}</span>} /><Stat label="المدفوع" value={<span className="text-base">{fmt(pos.paid)}</span>} tone="green" /><Stat label="المتبقي" value={<span className="text-base">{fmt(pos.outstanding)}</span>} tone="red" /></div>
      <div className="mb-2 rounded-lg bg-slate-50 p-2 text-xs text-slate-600">تاريخ المصروف: <b>{expense.date}</b> — تاريخ الدفع هو اللي بيظهر في «الصندوق والحسابات». عدّل تاريخ الدفعة هنا لو اتدفعت في يوم تاني.</div>
      <Table rows={mine} empty={<Empty title="لا توجد دفعات" hint="المصروف غير مدفوع بعد." />} columns={[
        { key: 'date', label: 'تاريخ الدفع' }, { key: 'amount', label: 'المبلغ', render: (p) => <b className="num">{fmt(p.amount)}</b> },
        { key: 'src', label: 'المصدر', render: (p) => (p.source === 'partner' ? `الشريك: ${partners.find((x) => x.id === p.partnerId)?.name || '—'}` : `الصندوق: ${accounts.find((x) => x.id === p.accountId)?.name || '—'}`) },
        { key: '_a', label: '', render: (p) => <div className="flex gap-1">
          {can('update') && <button className="rounded p-1.5 hover:bg-slate-100" title="تعديل" onClick={() => setEd(p)}><Pencil size={15} /></button>}
          {can('voidFinancial') && <button className="rounded p-1.5 text-rose-600 hover:bg-rose-50" title="إلغاء الدفعة" onClick={async () => { const why = prompt('سبب إلغاء الدفعة؟'); if (why) await voidExpensePayment(user, p, links, why); }}><Ban size={15} /></button>}</div> }]} />
      {ed && <FormModal open onClose={() => setEd(null)} title="تعديل دفعة مصروف" fields={[{ name: 'date', label: 'تاريخ الدفع', type: 'date', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }]}
        defaults={{ date: ed.date, amount: ed.amount }} onSubmit={(d) => updateExpensePayment(user, expense, pays, ed, links, d)} />}
    </Modal>
  );
}

export function Expenses() {
  const { user } = useAuth(); const [pay, setPay] = useState(null); const [pm, setPm] = useState(null);
  const ctx = () => ({ pays: useCol('expensePayments').rows, cash: useCol('cashTransactions').rows, ledger: useCol('partnerCapitalTransactions').rows });
  return (<>
    <CrudPage title="المصروفات" subtitle="المصروف المستحق ≠ المدفوع. الدفع من حساب أو من شريك (دون تكرار المصروف)" col="expenses" searchKeys={['description', 'supplierName', 'category']} useCtx={ctx} defaults={{ payDate: '' }}
      fields={[{ name: 'date', label: 'تاريخ المصروف / الفاتورة', type: 'date', required: true }, { name: 'category', label: 'الفئة', type: 'select', required: true, options: EXPENSE_CATEGORIES, default: 'feed' }, { name: 'description', label: 'الوصف', type: 'text', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, cur, { name: 'supplierName', label: 'المورّد / المستلم', type: 'text' }, { name: 'animalId', label: 'رقم الحيوان (للعلاج، اختياري)', type: 'rel', col: 'animals', optLabel: (r) => r.tag + (r.name ? ' - ' + r.name : '') }, { name: 'workerName', label: 'اسم العامل / الشريك (للسلف)', type: 'text' }, { name: 'activity', label: 'النشاط المرتبط', type: 'text' }, { name: 'notes', label: 'ملاحظات', type: 'textarea' },
        { name: 'payNow', label: 'الدفع', type: 'select', required: true, default: 'no', options: [['no', 'غير مدفوع (آجل) — يُدفع لاحقاً'], ['full', 'مدفوع بالكامل الآن'], ['partial', 'مدفوع جزئياً الآن']] },
        { name: 'paidAmount', label: 'المبلغ المدفوع (للدفع الجزئي فقط)', type: 'number', min: 0 },
        { name: 'payDate', label: 'تاريخ الدفع الفعلي (اتركه فارغاً = نفس تاريخ المصروف)', type: 'date' },
        { name: 'source', label: 'مصدر الدفع (عند الدفع الآن)', type: 'select', default: 'account', options: [['account', 'من صندوق/حساب المزرعة'], ['partner', 'دفعه شريك من ماله']] },
        { ...acct, label: 'الصندوق (عند الدفع من المزرعة)' }, { name: 'partnerId', label: 'الشريك (إن دفع الشريك)', type: 'rel', col: 'partners' }]}
      createOnlyFields={['payNow', 'paidAmount', 'payDate', 'source', 'accountId', 'partnerId']}
      create={async (u, d) => { const { payNow, paidAmount, payDate, source, accountId, partnerId, ...exp } = d; await addExpenseWithPayment(u, exp, { payNow, paidAmount, payDate, source, accountId, partnerId }); }}
      update={(u, d, e, c) => updateExpenseSynced(u, e, d, c)}
      cols={({ pays }) => [{ key: 'date', label: 'التاريخ' }, { key: 'category', label: 'الفئة', render: (r) => catLabel(r.category) }, { key: 'description', label: 'الوصف' }, { key: 'supplierName', label: 'المورّد' }, { key: 'amount', label: 'المستحق', render: (r) => <span className="num">{money(r.amount, r.currency)}</span> },
        { key: 'paid', label: 'المدفوع', render: (r) => <span className="num">{fmt(expensePosition(r, pays).paid)}</span> }, { key: 'out', label: 'المتبقي', render: (r) => <b className="num">{fmt(expensePosition(r, pays).outstanding)}</b> },
        { key: 'st', label: 'الحالة', render: (r) => { const s = expensePosition(r, pays).status; return <Badge tone={s === 'paid' ? 'green' : s === 'partial' ? 'amber' : 'red'}>{{ paid: 'مدفوع', partial: 'جزئي', unpaid: 'غير مدفوع', overpaid: 'زائد' }[s]}</Badge>; } }]}
      rowActions={(r, { pays }) => <>
        {expensePosition(r, pays).outstanding > 0 && <button className="rounded p-1.5 hover:bg-slate-100" title="تسجيل دفعة" onClick={() => setPay({ e: r, pays })}><HandCoins size={15} /></button>}
        {expensePosition(r, pays).paid > 0 && <button className="rounded p-1.5 hover:bg-slate-100" title="الدفعات (تعديل التاريخ / إلغاء)" onClick={() => setPm(r)}><ListChecks size={15} /></button>}</>} />
    {pm && <ExpensePaymentsModal expense={pm} onClose={() => setPm(null)} />}
    {pay && <FormModal open onClose={() => setPay(null)} title={`دفع مصروف: ${pay.e.description}`} submitLabel="تسجيل الدفع" defaults={{ date: today(), source: 'account', amount: expensePosition(pay.e, pay.pays).outstanding }}
      fields={[{ name: 'date', label: 'تاريخ الدفع', type: 'date', required: true }, { name: 'amount', label: `المبلغ (المتبقي ${fmt(expensePosition(pay.e, pay.pays).outstanding)})`, type: 'number', required: true, positive: true }, { name: 'source', label: 'مصدر الدفع', type: 'select', required: true, options: [['account', 'من صندوق/حساب المزرعة'], ['partner', 'دفعه شريك من ماله الشخصي']] }, acct, { name: 'partnerId', label: 'الشريك (إن دفع الشريك)', type: 'rel', col: 'partners' }]}
      onSubmit={(d) => { if (d.source === 'account' && !d.accountId) throw new Error('اختر الصندوق'); if (d.source === 'partner' && !d.partnerId) throw new Error('اختر الشريك'); return payExpense(user, pay.e, pay.pays, d); }} />}
  </>);
}

// ───────── قروض وتمويل الشركاء
export function Loans() {
  const { user, can } = useAuth(); const [rep, setRep] = useState(null); const [open, setOpen] = useState(false);
  const loans = useCol('partnerLoans').rows.filter((l) => !l.voided); const reps = useCol('partnerLoanRepayments').rows; const partners = useCol('partners').rows; const led = useCol('partnerCapitalTransactions').rows;
  const name = (id) => partners.find((p) => p.id === id)?.name || '—';
  const rows = loans.map((l) => ({ ...l, pos: loanPosition(l, reps) }));
  const summary = partners.filter((p) => !p.voided).map((p) => { const t = partnerLedger(p.id, led, { currency: 'SYP' }).totals; const ls = rows.filter((l) => l.partnerId === p.id && l.currency === 'SYP');
    return { id: p.id, name: p.name, borrowed: round2(ls.reduce((a, l) => a + Number(l.principal), 0)), repaid: round2(ls.reduce((a, l) => a + l.pos.principalRepaid, 0)), rem: round2(ls.reduce((a, l) => a + l.pos.outstandingPrincipal, 0)), int: round2(ls.reduce((a, l) => a + l.pos.interestDue, 0)), cap: round2((t.capital_contribution || 0) + (t.additional_capital || 0)), reimb: t.reimbursement || 0, wd: t.withdrawal || 0, dist: t.profit_distribution || 0 }; });
  return (
    <div>
      <PageHeader title="قروض وتمويل الشركاء" subtitle="القرض ≠ رأس المال ≠ مصروف مدفوع من الشريك. أصل القرض لا يُحتسب إيراداً، وسداده لا يُحتسب مصروفاً.">{can('create') && <button className="btn btn-primary" onClick={() => setOpen(true)}>قرض جديد</button>}</PageHeader>
      <Card title="القروض"><Table rows={rows} empty={<Empty title="لا توجد قروض" hint="سجّل قرضاً من شريك ليظهر هنا." />} columns={[{ key: 'p', label: 'الشريك', render: (r) => name(r.partnerId) }, { key: 'disbursementDate', label: 'الصرف' }, { key: 'principal', label: 'الأصل', render: (r) => <span className="num">{money(r.principal, r.currency)}</span> }, { key: 'rate', label: 'الفائدة %', render: (r) => r.interestRate || 0 }, { key: 'rp', label: 'المسدّد من الأصل', render: (r) => <span className="num">{fmt(r.pos.principalRepaid)}</span> }, { key: 'op', label: 'الأصل المتبقي', render: (r) => <b className="num">{fmt(r.pos.outstandingPrincipal)}</b> }, { key: 'id', label: 'فائدة مستحقة', render: (r) => <span className="num">{fmt(r.pos.interestDue)}</span> }, { key: 'maturityDate', label: 'الاستحقاق' }, { key: 'st', label: 'الحالة', render: (r) => <Badge tone={r.pos.status === 'closed' ? 'gray' : 'green'}>{r.pos.status === 'closed' ? 'مغلق' : 'نشط'}</Badge> },
        { key: 'a', label: '', render: (r) => can('create') && r.pos.status === 'active' && <button className="btn btn-ghost py-1" onClick={() => setRep(r)}>سداد</button> }]} /></Card>
      <Card title="ملخص تمويل الشركاء (ل.س)" className="mt-4"><Table rows={summary} empty={<Empty title="لا يوجد شركاء" />} columns={[{ key: 'name', label: 'الشريك' }, ...[['borrowed', 'إجمالي المقترض'], ['repaid', 'أصل مسدّد'], ['rem', 'أصل متبقٍ'], ['int', 'فائدة مستحقة'], ['cap', 'رأس مال'], ['reimb', 'تعويضات'], ['wd', 'سحوبات'], ['dist', 'توزيعات']].map(([k, l]) => ({ key: k, label: l, render: (r) => <span className="num">{fmt(r[k])}</span> }))]} /></Card>
      <FormModal open={open} onClose={() => setOpen(false)} title="قرض شريك جديد" fields={[{ name: 'partnerId', label: 'الشريك', type: 'rel', col: 'partners', required: true }, { name: 'agreementDate', label: 'تاريخ الاتفاق', type: 'date', required: true }, { name: 'disbursementDate', label: 'تاريخ الصرف', type: 'date', required: true }, { name: 'principal', label: 'الأصل', type: 'number', required: true, positive: true }, cur, { name: 'interestRate', label: 'الفائدة السنوية % (0 = بلا فائدة)', type: 'number', min: 0 }, { name: 'maturityDate', label: 'تاريخ الاستحقاق', type: 'date' }, { name: 'schedule', label: 'جدول السداد', type: 'textarea' }, { ...acct, label: 'الحساب المُستلِم للمبلغ', required: true }]}
        defaults={{ agreementDate: today(), disbursementDate: today(), currency: 'SYP', interestRate: 0 }} onSubmit={(d) => createLoan(user, { ...d, interestRate: Number(d.interestRate || 0) })} />
      {rep && <FormModal open onClose={() => setRep(null)} title="سداد قرض" fields={[{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'principalAmount', label: `سداد من الأصل (المتبقي ${fmt(rep.pos.outstandingPrincipal)})`, type: 'number', min: 0 }, { name: 'interestAmount', label: `سداد فائدة (المستحق ${fmt(rep.pos.interestDue)})`, type: 'number', min: 0 }, { ...acct, label: 'المدفوع من حساب', required: true }]}
        defaults={{ date: today(), principalAmount: 0, interestAmount: 0 }} onSubmit={(d) => { const p = Number(d.principalAmount || 0), i = Number(d.interestAmount || 0); if (p + i <= 0) throw new Error('أدخل مبلغاً'); if (p > rep.pos.outstandingPrincipal) throw new Error('سداد الأصل أكبر من المتبقي'); return repayLoan(user, rep, { date: d.date, principalAmount: p, interestAmount: i, accountId: d.accountId }); }} />}
    </div>
  );
}

// ───────── التسويات
export function Settlements() {
  const { user, can } = useAuth(); const s = useSettings();
  const [from, setFrom] = useState(`${new Date().getFullYear()}-01-01`); const [to, setTo] = useState(today()); const [c, setC] = useState('SYP'); const [err, setErr] = useState(''); const [dist, setDist] = useState(null);
  const partners = useCol('partners').rows.filter((p) => !p.voided && p.status !== 'inactive'); const led = useCol('partnerCapitalTransactions').rows; const hist = useCol('settlements').rows;
  const ags = useCol('milkSales').rows, dls = useCol('milkDeliveries').rows, exps = useCol('expenses').rows, epays = useCol('expensePayments').rows, pays = useCol('customerPayments').rows, custs = useCol('customers').rows;
  const cash = useCol('cashTransactions').rows, events = useCol('animalEvents').rows, loans = useCol('partnerLoans').rows, reps = useCol('partnerLoanRepayments').rows;
  const calc = useMemo(() => {
    const otherIncome = cash.filter((t) => t.type === 'other_income' && !t.voided), animalSales = events.filter((e) => e.type === 'sale' && !e.voided), animalPurchases = events.filter((e) => e.type === 'purchase' && !e.voided && Number(e.value) > 0);
    const pl = profitAndLoss({ agreements: ags, deliveries: dls, expenses: exps, otherIncome: otherIncome.map((t) => ({ ...t })), animalSales: animalSales.map((e) => ({ date: e.date, amount: e.value, currency: e.currency })), animalPurchases: animalPurchases.map((e) => ({ date: e.date, amount: e.value, currency: e.currency })), from, to, currency: c, animalPurchaseAsExpense: s.animalPurchaseAsExpense });
    const recv = round2(custs.reduce((a, cu) => a + customerPosition(cu.id, { agreements: ags.filter((x) => x.currency === c), deliveries: dls, payments: pays }).receivable, 0));
    const payable = round2(exps.filter((e) => !e.voided && e.currency === c && e.date <= to).reduce((a, e) => a + expensePosition(e, epays).outstanding, 0));
    const loanBal = round2(loans.filter((l) => !l.voided && l.currency === c).reduce((a, l) => a + loanPosition(l, reps, to).outstandingPrincipal, 0));
    const shares = validateShares(partners); const prevDist = round2(led.filter((e) => e.type === 'profit_distribution' && e.currency === c && !e.voided && e.date <= to).reduce((a, e) => a + Number(e.amount), 0));
    const capital = round2(led.filter((e) => ['capital_contribution', 'additional_capital'].includes(e.type) && e.currency === c && !e.voided && e.date <= to).reduce((a, e) => a + Number(e.amount), 0));
    let alloc = null; try { if (shares.ok && partners.length) alloc = allocateProfit(pl.netProfit, partners); } catch { alloc = null; }
    return { pl, recv, payable, loanBal, shares, prevDist, capital, alloc };
  }, [ags, dls, exps, epays, pays, custs, cash, events, loans, reps, led, partners, from, to, c, s.animalPurchaseAsExpense]);
  const name = (id) => partners.find((p) => p.id === id)?.name || '—';
  const finalize = async () => { setErr(''); try { if (!confirm('تأكيد اعتماد التسوية؟ سيتم قيد تخصيص الأرباح في دفاتر الشركاء (بدون أي حركة نقدية).')) return; await finalizeSettlement(user, { from, to, currency: c, ...calc.pl, receivables: calc.recv, payables: calc.payable, loanBalances: calc.loanBal, capital: calc.capital, previousDistributions: calc.prevDist }, partners); } catch (e) { setErr(e.message); } };
  const rows = [['الإيراد المعترف به (التسليمات + أخرى)', calc.pl.revenue], ['مصروفات التشغيل', calc.pl.totalExpenses], ['صافي الربح / الخسارة', calc.pl.netProfit], ['ذمم العملاء', calc.recv], ['ذمم الموردين (مصروفات غير مسددة)', calc.payable], ['أرصدة قروض الشركاء (أصل)', calc.loanBal], ['مساهمات رأس المال', calc.capital], ['توزيعات سابقة', calc.prevDist]];
  return (
    <div>
      <PageHeader title="تسويات وتوزيع الأرباح" subtitle="التخصيص (قيد محاسبي) منفصل عن التوزيع النقدي الفعلي" />
      <Card title="احتساب مقترح من السجلات الفعلية">
        <div className="mb-3 flex flex-wrap gap-2"><input type="date" className="input w-full sm:w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-full sm:w-40" value={to} onChange={(e) => setTo(e.target.value)} /><select className="input w-full sm:w-24" value={c} onChange={(e) => setC(e.target.value)}>{CURRENCIES.map(([v]) => <option key={v}>{v}</option>)}</select></div>
        <Table rows={rows.map(([l, v], i) => ({ id: i, l, v }))} columns={[{ key: 'l', label: 'البند' }, { key: 'v', label: `المبلغ (${c})`, render: (r) => <b className="num">{fmt(r.v)}</b> }]} />
        {!calc.shares.ok && <div className="mt-3 rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">مجموع نسب الأرباح {calc.shares.total}% — يجب أن يساوي 100% قبل التوزيع النسبي (عدّلها من صفحة الشركاء).</div>}
        {calc.alloc && <><h4 className="mb-1 mt-4 font-bold">التخصيص المقترح</h4><Table rows={calc.alloc.map((a) => ({ id: a.partnerId, ...a }))} columns={[{ key: 'n', label: 'الشريك', render: (r) => name(r.partnerId) }, { key: 'amount', label: 'الحصة', render: (r) => <b className="num">{fmt(r.amount)}</b> }]} /></>}
        {err && <div className="mt-2 text-sm font-bold text-red-600">{err}</div>}
        <div className="mt-4">{can('finalizeSettlement') ? <button className="btn btn-primary" disabled={!calc.alloc} onClick={finalize}>اعتماد التسوية (مدير النظام)</button> : <span className="text-sm text-slate-500">اعتماد التسوية متاح لمدير النظام فقط.</span>}</div>
      </Card>
      <Card title="سجل التسويات" className="mt-4"><Table rows={[...hist].sort((a, b) => (b.to || '').localeCompare(a.to || ''))} empty={<Empty title="لا توجد تسويات معتمدة" />} columns={[{ key: 'from', label: 'من' }, { key: 'to', label: 'إلى' }, { key: 'currency', label: 'العملة' }, { key: 'netProfit', label: 'صافي الربح', render: (r) => <span className="num">{fmt(r.netProfit)}</span> }, { key: 'al', label: 'التخصيصات', render: (r) => (r.allocations || []).map((a) => `${name(a.partnerId)}: ${fmt(a.amount)}`).join(' | ') },
        { key: 'd', label: '', render: (r) => can('create') && <button className="btn btn-ghost py-1" onClick={() => setDist(r)}>توزيع نقدي</button> }]} /></Card>
      {dist && <FormModal open onClose={() => setDist(null)} title="توزيع نقدي فعلي لشريك (منفصل عن التخصيص)" fields={[{ name: 'partnerId', label: 'الشريك', type: 'rel', col: 'partners', required: true }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, { ...acct, required: true }]} defaults={{ date: today() }}
        onSubmit={(d) => { const bal = partnerLedger(d.partnerId, led, { currency: dist.currency }).closing; if (d.amount > bal) throw new Error(`المبلغ أكبر من المستحق للشريك (${fmt(bal)})`); return partnerMovement(user, { ...d, type: 'profit_distribution', currency: dist.currency, settlementId: dist.id }); }} />}
    </div>
  );
}
