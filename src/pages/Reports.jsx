import { useMemo, useState } from 'react';
import { Card, Table, Empty, PageHeader, fmt } from '../components/ui';
import ExportButtons from '../components/ExportButtons';
import { useCol, useSettings } from '../data/db';
import * as F from '../lib/finance';
import { CURRENCIES, catLabel, CASH_AR, LEDGER_AR, AG_STATUS_AR, EXPENSE_CATEGORIES, SALE_KIND_AR, ANIMAL_CATEGORIES } from '../lib/constants';

const M = 'money', N = 'number', D = 'date';
const sum = (rows, k) => F.round2(rows.reduce((a, r) => a + (Number(r[k]) || 0), 0));
const weekKey = (d) => { const x = new Date(d); const day = (x.getDay() + 6) % 7; x.setDate(x.getDate() - day); return x.toISOString().slice(0, 10); };
const gkey = (g, d) => (g === 'day' ? d : g === 'week' ? weekKey(d) : g === 'month' ? d.slice(0, 7) : d.slice(0, 4));

function useData() {
  const names = ['milkProduction', 'milkSales', 'milkDeliveries', 'customerPayments', 'customers', 'expenses', 'expensePayments', 'cashTransactions', 'cashAccounts', 'partners', 'partnerCapitalTransactions', 'partnerLoans', 'partnerLoanRepayments', 'settlements', 'animals', 'animalEvents'];
  const d = {}; for (const n of names) d[n] = useCol(n).rows.filter((r) => !r.voided); return d;
}

export default function Reports() {
  const s = useSettings(); const d = useData();
  const todayIso = F.todayISO();
  const [kind, setKind] = useState('farm'); const [mode, setMode] = useState('range');
  const [rFrom, setRFrom] = useState(`${new Date().getFullYear()}-01-01`); const [rTo, setRTo] = useState(todayIso);
  const [day, setDay] = useState(todayIso); const [month, setMonth] = useState(todayIso.slice(0, 7)); const [year, setYear] = useState(String(new Date().getFullYear()));
  // Period filter: a specific day, a whole month, a whole year, or a custom range. All reports use from/to.
  const lastDay = (ym) => { const [y, m] = ym.split('-').map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, '0')}`; };
  const [from, to] = mode === 'day' ? [day, day] : mode === 'month' ? [`${month}-01`, lastDay(month)] : mode === 'year' ? [`${year}-01-01`, `${year}-12-31`] : [rFrom, rTo];
  const [c, setC] = useState('SYP'); const [g, setG] = useState('month'); const [partner, setPartner] = useState(''); const [customer, setCustomer] = useState(''); const [cat, setCat] = useState(''); const [saleType, setSaleType] = useState('');
  const inR = (x) => (!from || x >= from) && (!to || x <= to);
  const cust = (id) => d.customers.find((x) => x.id === id)?.name || '—'; const part = (id) => d.partners.find((x) => x.id === id)?.name || '—';
  const price = (x) => Number(x.pricePerLiter ?? d.milkSales.find((a) => a.id === x.agreementId)?.pricePerLiter ?? 0);
  const agCur = (x) => d.milkSales.find((a) => a.id === x.agreementId)?.currency || 'SYP';

  const catalog = useMemo(() => {
    const dels = d.milkDeliveries.filter((x) => inR(x.date) && agCur(x) === c && (!customer || x.customerId === customer));
    const exps = F.operatingExpenses(d.expenses, { from, to, currency: c }).filter((e) => !cat || e.category === cat);
    const cashTx = d.cashTransactions.filter((t) => inR(t.date) && t.currency === c);
    const ap = F.animalPLInputs(d.animalEvents, d.animals, s.animalPurchaseAsExpense !== false);
    const pl = F.profitAndLoss({ agreements: d.milkSales, deliveries: d.milkDeliveries, expenses: d.expenses, otherIncome: d.cashTransactions.filter((t) => t.type === 'other_income'), animalSales: ap.animalSales, animalPurchases: ap.animalPurchases, from, to, currency: c, animalPurchaseAsExpense: s.animalPurchaseAsExpense !== false });
    const custPos = d.customers.filter((x) => !customer || x.id === customer).map((x) => ({ id: x.id, name: x.name, ...F.customerPosition(x.id, { agreements: d.milkSales.filter((a) => (a.currency || 'SYP') === c), deliveries: d.milkDeliveries, payments: d.customerPayments.filter((p) => (p.currency || 'SYP') === c) }) }));
    const parts = d.partners.filter((p) => !partner || p.id === partner);
    const L = (p, o = {}) => F.partnerLedger(p.id, d.partnerCapitalTransactions, { currency: c, from, to, ...o });
    const grouped = (rows, key, cols) => { const m = {}; rows.forEach((r) => { const k = gkey(g, r.date); (m[k] ||= { period: k, ...Object.fromEntries(cols.map((x) => [x, 0])) }); cols.forEach((x) => { m[k][x] += Number(r[x]) || 0; }); }); return Object.values(m).sort((a, b) => a.period.localeCompare(b.period)); };
    const R = {};
    R.farm = { title: 'تقرير المزرعة (يومي / شهري / سنوي)', columns: [{ key: 'period', label: 'الفترة' }, { key: 'liters', label: 'إنتاج (لتر)', type: N }, { key: 'delQty', label: 'مسلّم (لتر)', type: N }, { key: 'rev', label: 'الإيراد (تسليمات + حيوانات + أخرى)', type: M }, { key: 'exp', label: 'مصروفات', type: M }, { key: 'net', label: 'صافي', type: M }],
      rows: (() => { const ks = new Set(); const P = d.milkProduction.filter((x) => inR(x.date)); const m = {}; const add = (date, f, v) => { const k = gkey(g, date); (m[k] ||= { period: k, liters: 0, delQty: 0, rev: 0, exp: 0 })[f] += v; };
        P.forEach((x) => add(x.date, 'liters', Number(x.liters))); dels.forEach((x) => { add(x.date, 'delQty', Number(x.qty)); add(x.date, 'rev', Number(x.qty) * price(x)); }); exps.forEach((e) => add(e.date, 'exp', Number(e.amount)));
        F.salesLedger({ animalEvents: d.animalEvents, cashTransactions: d.cashTransactions }, { from, to, currency: c }).forEach((r) => add(r.date, 'rev', r.amount)); return Object.values(m).map((r) => ({ ...r, rev: F.round2(r.rev), net: F.round2(r.rev - r.exp) })).sort((a, b) => a.period.localeCompare(b.period)); })(), sumKeys: ['liters', 'delQty', 'rev', 'exp', 'net'] };
    R.production = { title: 'تقرير إنتاج الحليب', columns: [{ key: 'period', label: 'الفترة' }, { key: 'morning', label: 'صباحاً', type: N }, { key: 'evening', label: 'مساءً', type: N }, { key: 'total', label: 'المجموع', type: N }],
      rows: grouped(d.milkProduction.filter((x) => inR(x.date)).map((x) => ({ date: x.date, morning: x.shift === 'morning' ? Number(x.liters) : 0, evening: x.shift === 'evening' ? Number(x.liters) : 0, total: Number(x.liters) })), 'date', ['morning', 'evening', 'total']), sumKeys: ['morning', 'evening', 'total'] };
    const allSales = F.salesLedger({ deliveries: d.milkDeliveries, agreements: d.milkSales, animalEvents: d.animalEvents, cashTransactions: d.cashTransactions, customers: d.customers }, { from, to, currency: c })
      .filter((r) => (!saleType || r.kind === saleType) && (!customer || r.party === cust(customer)));
    const stot = F.salesTotals(allSales);
    R.sales = { title: 'تقرير المبيعات (حليب + حيوانات + أخرى)', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'kindAr', label: 'نوع البيع' }, { key: 'ref', label: 'المرجع' }, { key: 'party', label: 'العميل / المشتري' }, { key: 'description', label: 'البيان' }, { key: 'qty', label: 'الكمية', type: N }, { key: 'price', label: 'سعر اللتر', type: M }, { key: 'amount', label: 'المبلغ', type: M }],
      rows: allSales.map((r) => ({ ...r, kindAr: SALE_KIND_AR[r.kind], price: r.kind === 'milk' && r.qty ? F.round2(r.amount / r.qty) : '' })), sumKeys: ['amount'],
      summary: [{ label: 'مبيعات الحليب', value: stot.byKind.milk[c] || 0 }, { label: 'مبيعات الحيوانات', value: stot.byKind.animal[c] || 0 }, { label: 'إيرادات أخرى', value: stot.byKind.other[c] || 0 }, { label: 'إجمالي المبيعات', value: stot.total[c] || 0 }] };
    R.payments = { title: 'تقرير دفعات العملاء', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'cust', label: 'العميل' }, { key: 'kind', label: 'النوع' }, { key: 'amount', label: 'المبلغ', type: M }],
      rows: d.customerPayments.filter((x) => inR(x.date) && x.currency === c && (!customer || x.customerId === customer)).map((x) => ({ date: x.date, cust: cust(x.customerId), kind: x.type === 'refund' ? 'استرداد' : x.kind === 'advance' ? 'دفعة مقدمة' : 'دفعة', amount: x.type === 'refund' ? -Number(x.amount) : Number(x.amount) })).sort((a, b) => a.date.localeCompare(b.date)), sumKeys: ['amount'] };
    R.credits = { title: 'الدفعات المقدمة وأرصدة العملاء الدائنة', columns: [{ key: 'name', label: 'العميل' }, { key: 'unappliedCredit', label: 'رصيد دائن', type: M }], rows: custPos.filter((x) => x.unappliedCredit > 0), sumKeys: ['unappliedCredit'] };
    R.receivables = { title: 'الذمم المدينة المستحقة', columns: [{ key: 'name', label: 'العميل' }, { key: 'deliveredValue', label: 'قيمة المسلّم', type: M }, { key: 'receivable', label: 'المستحق', type: M }], rows: custPos.filter((x) => x.receivable > 0), sumKeys: ['deliveredValue', 'receivable'] };
    R.cashbook = { title: 'دفتر الصندوق', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'typeAr', label: 'النوع' }, { key: 'acct', label: 'الحساب' }, { key: 'description', label: 'البيان' }, { key: 'inAmt', label: 'وارد', type: M }, { key: 'outAmt', label: 'صادر', type: M }],
      rows: cashTx.sort((a, b) => a.date.localeCompare(b.date)).map((t) => ({ ...t, typeAr: CASH_AR[t.type] || t.type, acct: d.cashAccounts.find((a) => a.id === t.accountId)?.name, inAmt: t.direction === 'in' ? Number(t.amount) : 0, outAmt: t.direction === 'out' ? Number(t.amount) : 0 })), sumKeys: ['inAmt', 'outAmt'] };
    const cf = F.cashFlowSummary(d.cashTransactions, { from, to, currency: c });
    R.receipts = { title: 'المقبوضات والمدفوعات النقدية (حسب النوع، بدون التحويلات)', columns: [{ key: 'kind', label: 'الاتجاه' }, { key: 'typeAr', label: 'النوع' }, { key: 'amount', label: 'المبلغ', type: M }], rows: [...Object.entries(cf.inflow).map(([k, v]) => ({ kind: 'وارد', typeAr: CASH_AR[k] || k, amount: v })), ...Object.entries(cf.outflow).map(([k, v]) => ({ kind: 'صادر', typeAr: CASH_AR[k] || k, amount: v }))], summary: [{ label: 'إجمالي الوارد', value: cf.totalIn }, { label: 'إجمالي الصادر', value: cf.totalOut }, { label: 'الصافي', value: cf.net }] };
    R.cashflow = { title: 'التدفق النقدي', columns: [{ key: 'item', label: 'البند' }, { key: 'amount', label: 'المبلغ', type: M }], rows: [{ item: 'إجمالي الوارد', amount: cf.totalIn }, { item: 'إجمالي الصادر', amount: -cf.totalOut }], totals: { amount: cf.net }, summary: [{ label: 'صافي التدفق', value: cf.net }] };
    R.expenseDetails = { title: 'تفاصيل المصروفات (يومياً)', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'catAr', label: 'الفئة' }, { key: 'description', label: 'الوصف' }, { key: 'supplierName', label: 'المورّد' }, { key: 'amount', label: 'المستحق', type: M }, { key: 'paid', label: 'المدفوع', type: M }, { key: 'out', label: 'المتبقي', type: M }],
      rows: exps.slice().sort((a, b) => a.date.localeCompare(b.date)).map((e) => { const p = F.expensePosition(e, d.expensePayments); return { ...e, catAr: catLabel(e.category), amount: Number(e.amount), paid: p.paid, out: p.outstanding }; }), sumKeys: ['amount', 'paid', 'out'] };
    const byCat = {}; exps.forEach((e) => { byCat[e.category] = (byCat[e.category] || 0) + Number(e.amount); });
    R.expenses = { title: 'المصروفات حسب الفئة', columns: [{ key: 'cat', label: 'الفئة' }, { key: 'amount', label: 'المبلغ', type: M }], rows: Object.entries(byCat).map(([k, v]) => ({ cat: catLabel(k), amount: F.round2(v) })), sumKeys: ['amount'] };
    R.partners = { title: 'كشوف حسابات الشركاء (موحّد)', columns: [{ key: 'name', label: 'الشريك' }, { key: 'cap', label: 'رأس مال', type: M }, { key: 'loan', label: 'قروض', type: M }, { key: 'wd', label: 'سحوبات', type: M }, { key: 'dist', label: 'توزيعات', type: M }, { key: 'closing', label: 'الرصيد الختامي', type: M }],
      rows: parts.map((p) => { const l = L(p, { from: '', to }); const t = L(p).totals; return { name: p.name, cap: (t.capital_contribution || 0) + (t.additional_capital || 0), loan: t.loan_given || 0, wd: t.withdrawal || 0, dist: t.profit_distribution || 0, closing: l.closing }; }), sumKeys: ['cap', 'loan', 'wd', 'dist', 'closing'] };
    R.capital = { title: 'تقرير رأس مال الشركاء', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'name', label: 'الشريك' }, { key: 'typeAr', label: 'النوع' }, { key: 'amount', label: 'المبلغ', type: M }], rows: d.partnerCapitalTransactions.filter((e) => inR(e.date) && e.currency === c && (!partner || e.partnerId === partner) && ['capital_contribution', 'additional_capital'].includes(e.type)).map((e) => ({ date: e.date, name: part(e.partnerId), typeAr: LEDGER_AR[e.type], amount: Number(e.amount) })), sumKeys: ['amount'] };
    R.loans = { title: 'قروض الشركاء والسداد', columns: [{ key: 'name', label: 'الشريك' }, { key: 'principal', label: 'الأصل', type: M }, { key: 'repaid', label: 'مسدّد من الأصل', type: M }, { key: 'rem', label: 'المتبقي', type: M }, { key: 'int', label: 'فائدة مستحقة', type: M }],
      rows: d.partnerLoans.filter((l) => l.currency === c && (!partner || l.partnerId === partner)).map((l) => { const p = F.loanPosition(l, d.partnerLoanRepayments, to); return { name: part(l.partnerId), principal: Number(l.principal), repaid: p.principalRepaid, rem: p.outstandingPrincipal, int: p.interestDue }; }), sumKeys: ['principal', 'repaid', 'rem', 'int'] };
    R.pfe = { title: 'المصروفات المدفوعة من الشركاء', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'name', label: 'الشريك' }, { key: 'desc', label: 'المصروف' }, { key: 'amount', label: 'المبلغ', type: M }], rows: d.partnerCapitalTransactions.filter((e) => e.type === 'expense_paid_personally' && inR(e.date) && e.currency === c && (!partner || e.partnerId === partner)).map((e) => ({ date: e.date, name: part(e.partnerId), desc: d.expenses.find((x) => x.id === e.expenseId)?.description, amount: Number(e.amount) })), sumKeys: ['amount'] };
    R.settlements = { title: 'التسويات وتوزيع الأرباح', columns: [{ key: 'from', label: 'من' }, { key: 'to', label: 'إلى' }, { key: 'netProfit', label: 'صافي الربح', type: M }], rows: d.settlements.filter((x) => x.currency === c), sumKeys: ['netProfit'] };
    R.animals = { title: 'جرد المواشي (كشيت الحيوانات)', columns: [{ key: 'tag', label: 'الرقم' }, { key: 'name', label: 'الاسم' }, { key: 'cat', label: 'الفئة' }, { key: 'sex', label: 'الجنس' }, { key: 'breed', label: 'السلالة' }, { key: 'src', label: 'المصدر' }, { key: 'seller', label: 'جهة الشراء' }, { key: 'acq', label: 'تاريخ الشراء', type: D }, { key: 'cost', label: 'سعر الشراء', type: M }, { key: 'age', label: 'العمر (شهر)', type: N }, { key: 'status', label: 'الحالة' }, { key: 'milk', label: 'إجمالي الحليب', type: N }, { key: 'avg', label: 'متوسط اليوم', type: N }, { key: 'treat', label: 'تكلفة العلاج', type: M }, { key: 'sp', label: 'سعر البيع', type: M }, { key: 'res', label: 'ربح/خسارة البيع', type: M }],
      rows: (() => { const hs = F.herdState(d.animalEvents, d.animals); const CA = Object.fromEntries(ANIMAL_CATEGORIES); return d.animals.filter((a) => (a.currency || 'SYP') === c).map((a) => { const p = F.animalProfile(a, { events: d.animalEvents, production: d.milkProduction, expenses: d.expenses }, to); const st = hs[a.id]; return { tag: a.tag, name: a.name, cat: CA[a.category] || '', sex: a.sex === 'F' ? 'أنثى' : 'ذكر', breed: a.breed, src: { purchase: 'شراء', birth: 'مولود بالمزرعة', opening: 'افتتاحي' }[a.origin] || '', seller: a.sellerName, acq: a.acquisitionDate, cost: Number(a.acquisitionCost || 0), age: p.ageMonths ?? '', status: st?.active ? (a.healthStatus === 'sick' ? 'مريض' : 'نشط') : st ? { sale: 'مباع', death: 'نافق', transfer_out: 'منقول', exchange_out: 'مبادَل' }[st.last] || 'خرج' : '—', milk: p.milkTotal, avg: p.milkAvg, treat: p.treatmentCost, sp: p.salePrice ?? '', res: p.saleResult ?? '' }; }); })(),
      sumKeys: ['cost', 'milk', 'treat', 'sp', 'res'], summary: [{ label: 'القطيع النشط الحالي', value: F.activeHerdCount(d.animalEvents) }] };
    R.animalMoves = { title: 'حركة المواشي', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'tag', label: 'الحيوان' }, { key: 'type', label: 'الحدث' }, { key: 'value', label: 'القيمة', type: M }], rows: d.animalEvents.filter((e) => inR(e.date)).sort((a, b) => a.date.localeCompare(b.date)), summary: [{ label: 'القطيع النشط الحالي', value: F.activeHerdCount(d.animalEvents) }] };
    R.payables = { title: 'الذمم الدائنة (مصروفات غير مسددة)', columns: [{ key: 'date', label: 'التاريخ', type: D }, { key: 'description', label: 'المصروف' }, { key: 'supplierName', label: 'المورّد' }, { key: 'outstanding', label: 'المتبقي', type: M }], rows: d.expenses.filter((e) => e.currency === c && e.date <= to).map((e) => ({ ...e, outstanding: F.expensePosition(e, d.expensePayments).outstanding })).filter((e) => e.outstanding > 0), sumKeys: ['outstanding'] };
    R.pl = { title: 'الأرباح والخسائر', columns: [{ key: 'item', label: 'البند' }, { key: 'amount', label: 'المبلغ', type: M }], rows: [{ item: 'إيراد الحليب (التسليمات)', amount: pl.milkRevenue }, { item: 'إيرادات أخرى', amount: pl.otherIncome }, { item: 'مبيعات الحيوانات', amount: pl.animalSales }, { item: 'مصروفات التشغيل', amount: -pl.operatingExpenses }, { item: 'مشتريات الحيوانات (حسب الإعداد)', amount: -pl.animalPurchases }], totals: { amount: pl.netProfit }, summary: [{ label: 'صافي الربح / الخسارة', value: pl.netProfit }] };
    return R;

  }, [d, from, to, c, g, partner, customer, cat, saleType, s.animalPurchaseAsExpense]);

  const def = catalog[kind];
  const rows = def.rows;
  const totals = def.totals || (def.sumKeys ? Object.fromEntries(def.sumKeys.map((k) => [k, sum(rows, k)])) : undefined);
  const report = { farm: s.farmName, title: def.title, from, to, currency: c, columns: def.columns, rows, totals, summary: def.summary };
  const LIST = [['farm', 'تقرير المزرعة'], ['production', 'إنتاج الحليب'], ['sales', 'كل المبيعات (حليب + حيوانات + أخرى)'], ['payments', 'دفعات العملاء'], ['credits', 'دفعات مقدمة / أرصدة دائنة'], ['receivables', 'ذمم مدينة'], ['cashbook', 'دفتر الصندوق'], ['receipts', 'مقبوضات ومدفوعات'], ['expenseDetails', 'تفاصيل المصروفات (يومياً)'], ['expenses', 'مصروفات حسب الفئة'], ['partners', 'حسابات الشركاء'], ['capital', 'رأس مال الشركاء'], ['loans', 'قروض الشركاء'], ['pfe', 'مصروفات مدفوعة من شركاء'], ['settlements', 'تسويات وتوزيعات'], ['animals', 'جرد المواشي'], ['animalMoves', 'حركة المواشي'], ['payables', 'ذمم دائنة'], ['pl', 'أرباح وخسائر'], ['cashflow', 'تدفق نقدي']];
  return (
    <div>
      <PageHeader title="التقارير"><ExportButtons report={report} /></PageHeader>
      <Card className="mb-4"><div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-8">
        <select className="input col-span-2 sm:col-span-3 xl:col-span-2" value={kind} onChange={(e) => setKind(e.target.value)}>{LIST.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}><option value="range">فترة مخصصة</option><option value="day">يوم محدد</option><option value="month">شهر محدد</option><option value="year">سنة محددة</option></select>
        {mode === 'range' && <><input type="date" className="input" value={rFrom} onChange={(e) => setRFrom(e.target.value)} /><input type="date" className="input" value={rTo} onChange={(e) => setRTo(e.target.value)} /></>}
        {mode === 'day' && <input type="date" className="input col-span-1 sm:col-span-2" value={day} onChange={(e) => setDay(e.target.value)} />}
        {mode === 'month' && <input type="month" className="input col-span-1 sm:col-span-2" value={month} onChange={(e) => setMonth(e.target.value)} />}
        {mode === 'year' && <input type="number" min="2000" max="2100" className="input col-span-1 sm:col-span-2" value={year} onChange={(e) => setYear(e.target.value)} />}
        <select className="input" value={c} onChange={(e) => setC(e.target.value)}>{CURRENCIES.map(([v]) => <option key={v}>{v}</option>)}</select>
        <select className="input" value={g} onChange={(e) => setG(e.target.value)}><option value="day">يومي</option><option value="week">أسبوعي</option><option value="month">شهري</option><option value="year">سنوي</option></select>
        <select className="input" value={partner} onChange={(e) => setPartner(e.target.value)}><option value="">كل الشركاء</option>{d.partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="input" value={customer} onChange={(e) => setCustomer(e.target.value)}><option value="">كل العملاء</option>{d.customers.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
        <select className="input" value={cat} onChange={(e) => setCat(e.target.value)}><option value="">كل الفئات</option>{EXPENSE_CATEGORIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
        <select className="input" value={saleType} onChange={(e) => setSaleType(e.target.value)}><option value="">كل أنواع البيع</option>{Object.entries(SALE_KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      </div></Card>
      <Card title={def.title}>
        <div className="mb-2 text-xs text-slate-500">{s.farmName} · {from} → {to} · العملة: {c} · أُنشئ: {new Date().toLocaleString('en-GB')}</div>
        <Table rows={rows.map((r, i) => ({ id: i, ...r }))} empty={<Empty title="لا توجد بيانات في هذه الفترة" hint="سجّل معاملات حقيقية لتظهر في التقرير." />}
          columns={def.columns.map((x) => ({ ...x, render: x.type === M || x.type === N ? (r) => (r[x.key] === '' ? '—' : <span className="num">{fmt(r[x.key])}</span>) : undefined }))}
          footer={totals && <tr>{def.columns.map((x, i) => <td key={x.key} className="px-3 py-2">{i === 0 ? 'الإجمالي' : totals[x.key] !== undefined ? <span className="num">{fmt(totals[x.key])}</span> : ''}</td>)}</tr>} />
        {def.summary && <div className="mt-3 space-y-1 text-sm font-bold">{def.summary.map((x) => <div key={x.label}>{x.label}: <span className="num">{fmt(x.value)}</span></div>)}</div>}
      </Card>
    </div>
  );
}
