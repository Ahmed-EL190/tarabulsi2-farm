import { Link } from 'react-router-dom';
import { useMemo, useState } from 'react';
import { Users, Milk, ShoppingCart, Wallet, Receipt, PawPrint, Droplets, UserPlus, FileText, Plus, CalendarDays } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import { Card, Stat, Empty, Table, Badge, fmt, money, today } from '../components/ui';
import { useCol, useSettings } from '../data/db';
import { catLabel } from '../lib/constants';
import { herdState, cashBalances, sumByCurrency, partnerLedger, operatingExpenses, round2 } from '../lib/finance';

const COLORS = ['#2f7bd9', '#8b6fd6', '#f2a23a', '#4caf6a', '#ef5b5b', '#14b8a6'];

// ───────── Period filter ─────────
const PRESETS = [['all', 'كل الأيام'], ['today', 'اليوم'], ['7', 'آخر 7 أيام'], ['30', 'آخر 30 يوم'], ['month', 'هذا الشهر'], ['custom', 'تحديد الأيام']];
const addDays = (iso, n) => { const x = new Date(`${iso}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000) + 1;

function PeriodFilter({ preset, setPreset, cFrom, setCFrom, cTo, setCTo, label }) {
  return (
    <Card>
      <div className="flex items-center gap-2 text-sm font-extrabold text-slate-700"><CalendarDays size={18} className="text-brand" />عرض بيانات:<span className="min-w-0 truncate font-bold text-brand">{label}</span></div>
      <div className="mt-3 flex flex-wrap gap-2">
        {PRESETS.map(([k, l]) => <button key={k} type="button" onClick={() => setPreset(k)} className={`btn !px-3 !py-1.5 ${preset === k ? 'btn-primary' : 'btn-ghost'}`}>{l}</button>)}
      </div>
      {preset === 'custom' && (
        <div className="mt-3 grid grid-cols-2 gap-2 sm:max-w-md">
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">من يوم</span><input type="date" dir="ltr" className="input" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)} /></label>
          <label className="block"><span className="mb-1 block text-xs font-bold text-slate-500">إلى يوم</span><input type="date" dir="ltr" className="input" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)} /></label>
          <div className="col-span-2 text-xs text-slate-500">لعرض يوم واحد اختر نفس التاريخ في الخانتين.</div>
        </div>
      )}
    </Card>
  );
}

export default function Dashboard() {
  const s = useSettings();
  const prodAll = useCol('milkProduction').rows.filter((r) => !r.voided);
  const ags = useCol('milkSales').rows; const dls = useCol('milkDeliveries').rows;
  const custs = useCol('customers').rows; const exps = useCol('expenses').rows;
  const cash = useCol('cashTransactions').rows; const partners = useCol('partners').rows.filter((p) => !p.voided);
  const ledger = useCol('partnerCapitalTransactions').rows; const events = useCol('animalEvents').rows;
  const t = today();

  // الافتراضي: كل الأيام
  const [preset, setPreset] = useState('all');
  const [cFrom, setCFrom] = useState(''); const [cTo, setCTo] = useState('');
  const [from, to] = useMemo(() => {
    if (preset === 'today') return [t, t];
    if (preset === '7') return [addDays(t, -6), t];
    if (preset === '30') return [addDays(t, -29), t];
    if (preset === 'month') return [`${t.slice(0, 7)}-01`, t];
    if (preset === 'custom') return [cFrom, cTo];
    return ['', ''];
  }, [preset, cFrom, cTo, t]);
  const inR = (date) => !!date && (!from || date >= from) && (!to || date <= to);
  const periodLabel = preset === 'all' ? 'كل الأيام' : preset === 'today' ? 'اليوم' : from && to ? (from === to ? from : `${from} ← ${to}`) : from ? `من ${from}` : to ? `حتى ${to}` : 'كل الأيام';
  const isAll = !from && !to;

  const d = useMemo(() => {
    const prod = prodAll.filter((p) => inR(p.date));
    // ── trend: daily when the span is short, monthly when long ──
    const dates = prodAll.map((p) => p.date).filter(Boolean).sort();
    const spanFrom = from || dates[0] || t; const spanTo = to || (dates.length && dates[dates.length - 1] > t ? dates[dates.length - 1] : t);
    const monthly = daysBetween(spanFrom, spanTo) > 45;
    const keys = []; if (monthly) { let y = +spanFrom.slice(0, 4), m = +spanFrom.slice(5, 7); const ey = +spanTo.slice(0, 4), em = +spanTo.slice(5, 7); while (y < ey || (y === ey && m <= em)) { keys.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++; } } } else { for (let i = 0; i < daysBetween(spanFrom, spanTo); i++) keys.push(addDays(spanFrom, i)); }
    const kOf = (date) => (monthly ? date.slice(0, 7) : date);
    const tm = Object.fromEntries(keys.map((k) => [k, { day: monthly ? k : k.slice(5), morning: 0, evening: 0 }]));
    prod.forEach((p) => { const b = tm[kOf(p.date)]; if (b && (p.shift === 'morning' || p.shift === 'evening')) b[p.shift] += Number(p.liters) || 0; });
    const trend = keys.map((k) => tm[k]);

    const priceOf = (x) => Number(x.pricePerLiter ?? ags.find((a) => a.id === x.agreementId)?.pricePerLiter ?? 0);
    const live = dls.filter((x) => !x.voided && inR(x.date));
    const byCust = {}; live.forEach((x) => { const c = custs.find((c) => c.id === x.customerId)?.name || '—'; byCust[c] = (byCust[c] || 0) + Number(x.qty) * priceOf(x); });
    const sales = Object.entries(byCust).map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value).slice(0, 5);
    const milkSales = round2(live.filter((x) => (x.currency || 'SYP') === 'SYP').reduce((a, x) => a + Number(x.qty) * priceOf(x), 0));
    const animalSales = round2(events.filter((e) => e.type === 'sale' && !e.voided && inR(e.date) && (e.currency || 'SYP') === 'SYP').reduce((a, e) => a + Number(e.value || 0), 0));
    const salesTotal = round2(milkSales + animalSales);
    const cat = {}; operatingExpenses(exps, { currency: 'SYP', from: from || undefined, to: to || undefined }).forEach((e) => { cat[e.category] = (cat[e.category] || 0) + Number(e.amount); });
    const expCat = Object.entries(cat).map(([k, v]) => ({ name: catLabel(k), value: v }));
    const bal = cashBalances(cash);
    const byCur = {}; Object.entries(bal).forEach(([k, v]) => { const c = k.split('|')[1]; byCur[c] = round2((byCur[c] || 0) + v); });
    const sh = (n) => prod.filter((p) => p.shift === n).reduce((a, p) => a + Number(p.liters || 0), 0);
    return { trend, monthly, sales, salesTotal, expCat, bal: byCur, morning: sh('morning'), evening: sh('evening'),
      expPeriod: sumByCurrency(operatingExpenses(exps, { from: from || undefined, to: to || undefined }), (e) => e.amount),
      herd: Object.values(herdState(events)).filter((x) => x.active).length,
      pBal: partners.map((p) => ({ ...p, bal: partnerLedger(p.id, ledger, { currency: 'SYP' }).closing })),
      capital: partners.reduce((a, p) => a + Number(p.initialCapital || 0), 0),
      recent: [...cash].filter((c) => !c.voided && inR(c.date)).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) };
  }, [prodAll, ags, dls, custs, exps, cash, partners, ledger, events, t, from, to]); // eslint-disable-line
  const cashLine = Object.keys(d.bal).length ? Object.entries(d.bal).map(([c, v]) => money(v, c)).join('  |  ') : money(0);
  const hasProd = d.trend.some((x) => x.morning || x.evening);
  const long = new Date().toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const quick = [['/milk-sales', 'تسجيل مبيعات الحليب', ShoppingCart], ['/expenses', 'إضافة مصروف', Receipt], ['/partners', 'تسجيل شريك جديد', UserPlus], ['/animals', 'إضافة حيوان', PawPrint], ['/reports', 'عرض التقارير', FileText]];
  const sfx = isAll ? '' : ` (${preset === 'today' ? 'اليوم' : 'الفترة'})`;
  return (
    <div className="space-y-4 sm:space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-forest-900 bg-cover bg-center p-4 text-white shadow-card sm:p-6" style={{ backgroundImage: "linear-gradient(90deg,rgba(11,42,29,.88),rgba(11,42,29,.35)),url('/banner.jpg')" }}>
        <div className="text-xs text-emerald-200 sm:text-sm">مرحباً بك في</div>
        <h2 className="text-2xl font-extrabold sm:text-3xl">{s.farmName}</h2>
        <p className="mt-1 text-xs text-emerald-50/90 sm:text-sm">إدارة متكاملة لإنتاج الحليب وتربية الماشية</p>
        <div className="mt-3 inline-block rounded-xl border border-white/25 bg-black/25 px-3 py-1.5 text-xs sm:mt-4 sm:px-4 sm:py-2 sm:text-sm">{long}</div>
      </div>

      <PeriodFilter preset={preset} setPreset={setPreset} cFrom={cFrom} setCFrom={setCFrom} cTo={cTo} setCTo={setCTo} label={periodLabel} />

      <div className="grid grid-cols-2 gap-2.5 sm:gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="شركاء المزرعة" value={partners.length} sub={`رأس المال: ${money(d.capital)}`} icon={Users} />
        <Stat label={`المصروفات${sfx}`} value={<span className="text-base sm:text-xl">{Object.keys(d.expPeriod).length ? Object.entries(d.expPeriod).map(([c, v]) => money(v, c)).join(' | ') : money(0)}</span>} sub="تشغيلية — بدون سلف الشركاء وسداد القروض" icon={Receipt} tone="red" />
        <Stat className="col-span-2 md:col-span-1" label="الرصيد النقدي (الحالي)" value={<span className="text-base sm:text-lg">{cashLine}</span>} sub="لكل عملة على حدة" icon={Wallet} tone="amber" />
        <Stat className="col-span-2 md:col-span-1" label={`إجمالي المبيعات${sfx}`} value={money(d.salesTotal)} sub="الحليب عند التسليم + بيع الحيوانات" icon={ShoppingCart} tone="purple" />
        <Stat label={isAll ? 'إجمالي إنتاج الحليب' : `إنتاج الحليب${sfx}`} value={`${fmt(d.morning + d.evening)} لتر`} sub={`الصباح ${fmt(d.morning)} · المساء ${fmt(d.evening)}`} icon={Droplets} tone="green" />
        <Stat label="عدد الأبقار النشطة" value={d.herd} icon={PawPrint} tone="blue" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <Card title={`إنتاج الحليب (${isAll ? 'كل الأيام' : periodLabel})${d.monthly ? ' — شهرياً' : ''}`} icon={Milk}>
          {!hasProd ? <Empty title="لا يوجد إنتاج مسجّل" hint={isAll ? 'سجّل أول إنتاج ليظهر الرسم البياني.' : 'لا يوجد إنتاج في هذه الفترة.'}><Link className="btn btn-primary" to="/production"><Plus size={14} />تسجيل إنتاج</Link></Empty> :
            <div className="h-52 sm:h-60" dir="ltr"><ResponsiveContainer><AreaChart data={d.trend} margin={{ left: -18, right: 6, top: 4 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" tick={{ fontSize: 11 }} interval="preserveStartEnd" minTickGap={18} /><YAxis tick={{ fontSize: 11 }} width={44} /><Tooltip /><Legend />
              <Area dataKey="morning" name="الصباح" stroke="#2f7bd9" fill="#2f7bd933" /><Area dataKey="evening" name="المساء" stroke="#4caf6a" fill="#4caf6a33" /></AreaChart></ResponsiveContainer></div>}
        </Card>
        <Card title="توزيع المبيعات حسب العملاء">
          {!d.sales.length ? <Empty title="لا توجد عمليات تسليم" hint={isAll ? 'ستظهر المبيعات بعد تسجيل أول تسليم.' : 'لا توجد تسليمات في هذه الفترة.'} /> :
            <div className="h-56 sm:h-60" dir="ltr"><ResponsiveContainer><PieChart><Pie data={d.sales} dataKey="value" nameKey="name" innerRadius={45} outerRadius={72}>{d.sales.map((_, i) => <Cell key={i} fill={COLORS[i % 6]} />)}</Pie><Tooltip /><Legend wrapperStyle={{ fontSize: 12 }} /></PieChart></ResponsiveContainer></div>}
        </Card>
        <Card title="المصروفات حسب الفئات">
          {!d.expCat.length ? <Empty title="لا توجد مصروفات" hint={isAll ? 'أضف أول مصروف.' : 'لا توجد مصروفات في هذه الفترة.'} /> :
            <div className="h-52 sm:h-60" dir="ltr"><ResponsiveContainer><BarChart data={d.expCat} margin={{ left: -10, right: 6, top: 4 }}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} /><YAxis tick={{ fontSize: 11 }} width={48} /><Tooltip /><Bar dataKey="value" name="المبلغ" fill="#10a36a" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        </Card>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="أحدث المعاملات" action={<Link to="/cash" className="text-sm font-bold text-brand">عرض الكل</Link>}>
          <Table rows={d.recent} empty={<Empty title="لا توجد معاملات" hint={isAll ? 'ستظهر حركات الصندوق هنا.' : 'لا توجد معاملات في هذه الفترة.'} />} columns={[
            { key: 'date', label: 'التاريخ' }, { key: 'type', label: 'النوع', render: (r) => <Badge tone={r.direction === 'in' ? 'green' : 'red'}>{r.type}</Badge> },
            { key: 'description', label: 'الوصف' }, { key: 'amount', label: 'المبلغ', render: (r) => <span className="num font-bold">{money(r.amount, r.currency)}</span> }]} />
        </Card>
        <Card title="أرصدة الشركاء (ل.س)" action={<Link to="/partners" className="text-sm font-bold text-brand">عرض الكل</Link>}>
          <Table rows={d.pBal} empty={<Empty title="لا يوجد شركاء" hint="سجّل الشركاء أولاً."><Link className="btn btn-primary" to="/partners">إضافة شريك</Link></Empty>} columns={[
            { key: 'name', label: 'الشريك' }, { key: 'bal', label: 'الرصيد (مستحق للشريك)', render: (r) => <span className="num font-bold">{money(r.bal)}</span> }]} />
        </Card>
      </div>

      <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 sm:gap-3 xl:grid-cols-5">
        {quick.map(([to, label, Icon]) => <Link key={to} to={to} className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm font-bold text-forest-800 hover:bg-emerald-100">{label}<Icon size={20} /></Link>)}
      </div>
    </div>
  );
}
