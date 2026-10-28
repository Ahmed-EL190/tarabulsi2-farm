import { Link } from 'react-router-dom';
import { useMemo } from 'react';
import { Users, Milk, ShoppingCart, Wallet, Receipt, PawPrint, Droplets, UserPlus, FileText, Plus } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, PieChart, Pie, Cell, BarChart, Bar, Legend } from 'recharts';
import { Card, Stat, Empty, Table, Badge, fmt, money, today } from '../components/ui';
import { useCol, useSettings } from '../data/db';
import { catLabel } from '../lib/constants';
import { herdState, cashBalances, sumByCurrency, partnerLedger, operatingExpenses, round2 } from '../lib/finance';

const COLORS = ['#2f7bd9', '#8b6fd6', '#f2a23a', '#4caf6a', '#ef5b5b', '#14b8a6'];
const CAT_AR = { feed: 'أعلاف', vet: 'أدوية وبيطري', maintenance: 'صيانة', labor: 'عمالة', fuel: 'وقود', other: 'أخرى' };

export default function Dashboard() {
  const s = useSettings();
  const prod = useCol('milkProduction').rows.filter((r) => !r.voided);
  const ags = useCol('milkSales').rows; const dls = useCol('milkDeliveries').rows;
  const custs = useCol('customers').rows; const exps = useCol('expenses').rows;
  const cash = useCol('cashTransactions').rows; const partners = useCol('partners').rows.filter((p) => !p.voided);
  const ledger = useCol('partnerCapitalTransactions').rows; const events = useCol('animalEvents').rows;
  const accounts = useCol('cashAccounts').rows;
  const t = today();
  const d = useMemo(() => {
    const days = [...Array(7)].map((_, i) => { const x = new Date(); x.setDate(x.getDate() - 6 + i); return x.toISOString().slice(0, 10); });
    const trend = days.map((day) => ({ day: day.slice(5), morning: prod.filter((p) => p.date === day && p.shift === 'morning').reduce((a, p) => a + Number(p.liters), 0), evening: prod.filter((p) => p.date === day && p.shift === 'evening').reduce((a, p) => a + Number(p.liters), 0) }));
    const priceOf = (x) => Number(x.pricePerLiter ?? ags.find((a) => a.id === x.agreementId)?.pricePerLiter ?? 0);
    const live = dls.filter((x) => !x.voided);
    const byCust = {}; live.forEach((x) => { const c = custs.find((c) => c.id === x.customerId)?.name || '—'; byCust[c] = (byCust[c] || 0) + Number(x.qty) * priceOf(x); });
    const sales = Object.entries(byCust).map(([name, value]) => ({ name, value: round2(value) })).sort((a, b) => b.value - a.value).slice(0, 5);
    const milkSales = round2(live.filter((x) => (x.currency || 'SYP') === 'SYP').reduce((a, x) => a + Number(x.qty) * priceOf(x), 0));
    const animalSales = round2(events.filter((e) => e.type === 'sale' && !e.voided && (e.currency || 'SYP') === 'SYP').reduce((a, e) => a + Number(e.value || 0), 0));
    const salesTotal = round2(milkSales + animalSales);
    const cat = {}; operatingExpenses(exps, { currency: 'SYP' }).forEach((e) => { cat[e.category] = (cat[e.category] || 0) + Number(e.amount); });
    const expCat = Object.entries(cat).map(([k, v]) => ({ name: catLabel(k), value: v }));
    const todayLiters = prod.filter((p) => p.date === t);
    const bal = cashBalances(cash);
    const byCur = {}; Object.entries(bal).forEach(([k, v]) => { const c = k.split('|')[1]; byCur[c] = round2((byCur[c] || 0) + v); });
    return { trend, sales, salesTotal, expCat, bal: byCur,
      morning: todayLiters.filter((p) => p.shift === 'morning').reduce((a, p) => a + Number(p.liters), 0), evening: todayLiters.filter((p) => p.shift === 'evening').reduce((a, p) => a + Number(p.liters), 0),
      expToday: sumByCurrency(exps.filter((e) => !e.voided && e.date === t), (e) => e.amount),
      herd: Object.values(herdState(events)).filter((x) => x.active).length,
      pBal: partners.map((p) => ({ ...p, bal: partnerLedger(p.id, ledger, { currency: 'SYP' }).closing })),
      capital: partners.reduce((a, p) => a + Number(p.initialCapital || 0), 0), recent: [...cash].filter((c) => !c.voided).sort((a, b) => b.date.localeCompare(a.date)).slice(0, 5) };
  }, [prod, ags, dls, custs, exps, cash, partners, ledger, events, t]);
  const cashLine = Object.keys(d.bal).length ? Object.entries(d.bal).map(([c, v]) => money(v, c)).join('  |  ') : money(0);
  const hasProd = d.trend.some((x) => x.morning || x.evening);
  const long = new Date().toLocaleDateString('ar-SY', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  const quick = [['/milk-sales', 'تسجيل مبيعات الحليب', ShoppingCart], ['/expenses', 'إضافة مصروف', Receipt], ['/partners', 'تسجيل شريك جديد', UserPlus], ['/animals', 'إضافة حيوان', PawPrint], ['/reports', 'عرض التقارير', FileText]];
  return (
    <div className="space-y-5">
      <div className="relative overflow-hidden rounded-2xl bg-forest-900 bg-cover bg-center p-6 text-white shadow-card" style={{ backgroundImage: "linear-gradient(90deg,rgba(11,42,29,.88),rgba(11,42,29,.35)),url('/banner.jpg')" }}>
        <div className="text-sm text-emerald-200">مرحباً بك في</div>
        <h2 className="text-3xl font-extrabold">{s.farmName}</h2>
        <p className="mt-1 text-sm text-emerald-50/90">إدارة متكاملة لإنتاج الحليب وتربية الماشية</p>
        <div className="mt-4 inline-block rounded-xl border border-white/25 bg-black/25 px-4 py-2 text-sm">{long}</div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-6">
        <Stat label="شركاء المزرعة" value={partners.length} sub={`رأس المال: ${money(d.capital)}`} icon={Users} />
        <Stat label="المصروفات اليوم" value={Object.keys(d.expToday).length ? Object.entries(d.expToday).map(([c, v]) => money(v, c)).join(' | ') : money(0)} icon={Receipt} tone="red" />
        <Stat label="الرصيد النقدي" value={<span className="text-lg">{cashLine}</span>} sub="لكل عملة على حدة" icon={Wallet} tone="amber" />
        <Stat label="إجمالي المبيعات (حليب + حيوانات)" value={money(d.salesTotal)} sub="الحليب عند التسليم + بيع الحيوانات" icon={ShoppingCart} tone="purple" />
        <Stat label="إنتاج الحليب اليوم" value={`${fmt(d.morning + d.evening)} لتر`} sub={`الصباح ${fmt(d.morning)} · المساء ${fmt(d.evening)}`} icon={Droplets} tone="green" />
        <Stat label="عدد الأبقار النشطة" value={d.herd} icon={PawPrint} tone="blue" />
      </div>
      <div className="grid gap-4 xl:grid-cols-3">
        <Card title="إنتاج الحليب (آخر 7 أيام)" icon={Milk}>
          {!hasProd ? <Empty title="لا يوجد إنتاج مسجّل" hint="سجّل أول إنتاج ليظهر الرسم البياني."><Link className="btn btn-primary" to="/production"><Plus size={14} />تسجيل إنتاج</Link></Empty> :
            <div className="h-60" dir="ltr"><ResponsiveContainer><AreaChart data={d.trend}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="day" /><YAxis /><Tooltip /><Legend />
              <Area dataKey="morning" name="الصباح" stroke="#2f7bd9" fill="#2f7bd933" /><Area dataKey="evening" name="المساء" stroke="#4caf6a" fill="#4caf6a33" /></AreaChart></ResponsiveContainer></div>}
        </Card>
        <Card title="توزيع المبيعات حسب العملاء">
          {!d.sales.length ? <Empty title="لا توجد عمليات تسليم" hint="ستظهر المبيعات بعد تسجيل أول تسليم." /> :
            <div className="h-60" dir="ltr"><ResponsiveContainer><PieChart><Pie data={d.sales} dataKey="value" nameKey="name" innerRadius={55} outerRadius={85}>{d.sales.map((_, i) => <Cell key={i} fill={COLORS[i % 6]} />)}</Pie><Tooltip /><Legend /></PieChart></ResponsiveContainer></div>}
        </Card>
        <Card title="المصروفات حسب الفئات">
          {!d.expCat.length ? <Empty title="لا توجد مصروفات" hint="أضف أول مصروف." /> :
            <div className="h-60" dir="ltr"><ResponsiveContainer><BarChart data={d.expCat}><CartesianGrid vertical={false} strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis /><Tooltip /><Bar dataKey="value" name="المبلغ" fill="#10a36a" radius={[6, 6, 0, 0]} /></BarChart></ResponsiveContainer></div>}
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2">
        <Card title="أحدث المعاملات" action={<Link to="/cash" className="text-sm font-bold text-brand">عرض الكل</Link>}>
          <Table rows={d.recent} empty={<Empty title="لا توجد معاملات" hint="ستظهر حركات الصندوق هنا." />} columns={[
            { key: 'date', label: 'التاريخ' }, { key: 'type', label: 'النوع', render: (r) => <Badge tone={r.direction === 'in' ? 'green' : 'red'}>{r.type}</Badge> },
            { key: 'description', label: 'الوصف' }, { key: 'amount', label: 'المبلغ', render: (r) => <span className="num font-bold">{money(r.amount, r.currency)}</span> }]} />
        </Card>
        <Card title="أرصدة الشركاء (ل.س)" action={<Link to="/partners" className="text-sm font-bold text-brand">عرض الكل</Link>}>
          <Table rows={d.pBal} empty={<Empty title="لا يوجد شركاء" hint="سجّل الشركاء أولاً."><Link className="btn btn-primary" to="/partners">إضافة شريك</Link></Empty>} columns={[
            { key: 'name', label: 'الشريك' }, { key: 'bal', label: 'الرصيد (مستحق للشريك)', render: (r) => <span className="num font-bold">{money(r.bal)}</span> }]} />
        </Card>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {quick.map(([to, label, Icon]) => <Link key={to} to={to} className="flex items-center justify-between rounded-xl border border-emerald-100 bg-emerald-50/60 px-4 py-3 text-sm font-bold text-forest-800 hover:bg-emerald-100">{label}<Icon size={20} /></Link>)}
      </div>
    </div>
  );
}
