import { useMemo, useState } from 'react';
import { Plus, Truck, Banknote, Undo2, Zap } from 'lucide-react';
import { Card, Table, Badge, Modal, Empty, PageHeader, Stat, SearchBox, fmt, money, today } from '../components/ui';
import { FormModal } from '../components/CrudPage';
import { useCol, commit, nextNumber, newId } from '../data/db';
import { createAgreement, addDelivery, addCustomerPayment } from '../data/ops';
import { useAuth } from '../data/auth';
import { agreementPosition, sumByCurrency, round2, salesLedger, salesTotals } from '../lib/finance';
import { CURRENCIES, METHODS, PAY_STATUS_AR, AG_STATUS_AR, SALE_KIND_AR } from '../lib/constants';

const cur = { name: 'currency', label: 'العملة', type: 'select', options: CURRENCIES, required: true, default: 'SYP' };
const acct = { name: 'accountId', label: 'الصندوق (لتسجيل القبض)', type: 'rel', col: 'cashAccounts' };
const method = { name: 'method', label: 'طريقة الدفع', type: 'select', options: METHODS, default: 'cash' };
const PAY_TONE = { unpaid: 'red', partial: 'amber', paid: 'green', advance: 'blue', paid_with_credit: 'green' };

const agFields = [
  { name: 'customerId', label: 'العميل', type: 'rel', col: 'customers', required: true },
  { name: 'date', label: 'تاريخ الاتفاق', type: 'date', required: true },
  { name: 'agreedQty', label: 'الكمية المتفق عليها (لتر)', type: 'number', required: true, positive: true },
  { name: 'pricePerLiter', label: 'سعر اللتر', type: 'number', required: true, positive: true }, cur,
  { name: 'advance', label: 'دفعة مقدمة مستلمة (اختياري)', type: 'number', min: 0 }, acct, method,
  { name: 'schedule', label: 'جدول التسليم المخطط (سطر لكل موعد: التاريخ - الكمية)', type: 'textarea' },
  { name: 'notes', label: 'ملاحظات', type: 'textarea' },
];

function Detail({ ag, pos, deliveries, payments, onClose }) {
  const { user, can } = useAuth();
  const [form, setForm] = useState(null); const [err, setErr] = useState('');
  const myD = deliveries.filter((d) => d.agreementId === ag.id && !d.voided).sort((a, b) => a.date.localeCompare(b.date));
  const myP = payments.filter((p) => p.agreementId === ag.id && !p.voided).sort((a, b) => a.date.localeCompare(b.date));
  const alloc = Object.fromEntries(pos.allocations.map((a) => [a.deliveryId, a]));
  const forms = {
    delivery: { title: 'تسجيل تسليم', fields: [{ name: 'date', label: 'تاريخ التسليم', type: 'date', required: true }, { name: 'qty', label: `الكمية (المتبقي ${fmt(pos.remainingQty)})`, type: 'number', required: true, positive: true }, { name: 'pricePerLiter', label: 'سعر اللتر (فارغ = سعر الاتفاق)', type: 'number', min: 0 }, { name: 'notes', label: 'ملاحظات', type: 'text' }],
      submit: (d) => addDelivery(user, ag, deliveries, { ...d, pricePerLiter: d.pricePerLiter || undefined }) },
    payment: { title: 'تسجيل دفعة', fields: [{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: 'المبلغ', type: 'number', required: true, positive: true }, { ...acct, required: true }, method, { name: 'note', label: 'ملاحظة', type: 'text' }],
      submit: (d) => addCustomerPayment(user, { ...d, agreementId: ag.id, customerId: ag.customerId, currency: ag.currency }) },
    refund: { title: 'استرداد رصيد دائن للعميل', fields: [{ name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'amount', label: `المبلغ (الرصيد الدائن ${fmt(pos.unappliedCredit)})`, type: 'number', required: true, positive: true }, { ...acct, label: 'الصندوق المدفوع منه', required: true }, { name: 'note', label: 'ملاحظة', type: 'text' }],
      submit: (d) => { if (d.amount > pos.unappliedCredit) throw new Error('المبلغ أكبر من الرصيد الدائن غير المطبّق'); return addCustomerPayment(user, { ...d, type: 'refund', agreementId: ag.id, customerId: ag.customerId, currency: ag.currency }); } },
  };
  const f = form && forms[form];
  return (
    <Modal open onClose={onClose} title={`اتفاقية ${ag.number}`} wide>
      <div className="mb-3 grid gap-2 sm:grid-cols-4">
        <Stat label="المتبقي للتسليم" value={`${fmt(pos.remainingQty)} لتر`} sub={`من ${fmt(pos.agreedQty)}`} />
        <Stat label="قيمة المسلّم" value={money(pos.deliveredValue, ag.currency)} />
        <Stat label="الذمم المدينة" value={money(pos.receivable, ag.currency)} tone="red" />
        <Stat label="رصيد دائن (دفعات مقدمة)" value={money(pos.unappliedCredit, ag.currency)} tone="blue" />
      </div>
      <div className="mb-3 flex flex-wrap gap-2">
        {can('create') && <><button className="btn btn-primary" disabled={pos.remainingQty <= 0} onClick={() => setForm('delivery')}><Truck size={16} />تسليم</button><button className="btn btn-ghost" onClick={() => setForm('payment')}><Banknote size={16} />دفعة</button>{pos.unappliedCredit > 0 && <button className="btn btn-ghost" onClick={() => setForm('refund')}><Undo2 size={16} />استرداد</button>}</>}
        <Badge tone={PAY_TONE[pos.paymentStatus]}>{PAY_STATUS_AR[pos.paymentStatus]}</Badge><Badge tone="gray">{AG_STATUS_AR[pos.status]}</Badge>
      </div>
      {ag.schedule && <div className="mb-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm"><b>الجدول المخطط:</b>{'\n'}{ag.schedule}</div>}
      <h4 className="mb-1 font-bold">التسليمات (الدفعات تُوزَّع الأقدم أولاً)</h4>
      <Table rows={myD} empty={<Empty title="لا توجد تسليمات" />} columns={[{ key: 'date', label: 'التاريخ' }, { key: 'qty', label: 'الكمية', render: (d) => <span className="num">{fmt(d.qty)}</span> }, { key: 'v', label: 'القيمة', render: (d) => <span className="num">{fmt(alloc[d.id]?.value)}</span> }, { key: 'p', label: 'المسدّد', render: (d) => <span className="num">{fmt(alloc[d.id]?.paid)}</span> }, { key: 'due', label: 'المتبقي', render: (d) => <b className="num">{fmt(alloc[d.id]?.due)}</b> }]} />
      <h4 className="mb-1 mt-4 font-bold">الدفعات والاستردادات</h4>
      <Table rows={myP} empty={<Empty title="لا توجد دفعات" />} columns={[{ key: 'date', label: 'التاريخ' }, { key: 'type', label: 'النوع', render: (p) => (p.type === 'refund' ? <Badge tone="amber">استرداد</Badge> : p.kind === 'advance' ? <Badge tone="blue">دفعة مقدمة</Badge> : <Badge tone="green">دفعة</Badge>) }, { key: 'amount', label: 'المبلغ', render: (p) => <span className="num">{fmt(p.amount)}</span> }, { key: 'method', label: 'الطريقة' }, { key: 'note', label: 'ملاحظة' }]} />
      {f && <FormModal open onClose={() => setForm(null)} title={f.title} fields={f.fields} defaults={{ date: today(), method: 'cash' }} onSubmit={f.submit} />}
    </Modal>
  );
}


function AllSales() {
  const dls = useCol('milkDeliveries').rows, ags = useCol('milkSales').rows, evs = useCol('animalEvents').rows, txs = useCol('cashTransactions').rows, custs = useCol('customers').rows;
  const [kind, setKind] = useState(''); const [from, setFrom] = useState(''); const [to, setTo] = useState('');
  const all = useMemo(() => salesLedger({ deliveries: dls, agreements: ags, animalEvents: evs, cashTransactions: txs, customers: custs }, { from, to }), [dls, ags, evs, txs, custs, from, to]);
  const rows = all.filter((r) => !kind || r.kind === kind); const t = salesTotals(rows);
  const show = (o) => (Object.keys(o).length ? Object.entries(o).map(([c, v]) => money(v, c)).join(' | ') : money(0));
  return (<>
    <div className="mb-4 grid gap-3 sm:grid-cols-4">
      <Stat label="إجمالي المبيعات" value={<span className="text-lg">{show(t.total)}</span>} tone="green" />
      <Stat label="مبيعات الحليب" value={<span className="text-lg">{show(t.byKind.milk)}</span>} tone="blue" />
      <Stat label="مبيعات الحيوانات" value={<span className="text-lg">{show(t.byKind.animal)}</span>} tone="amber" />
      <Stat label="إيرادات أخرى" value={<span className="text-lg">{show(t.byKind.other)}</span>} tone="purple" />
    </div>
    <Card><div className="mb-3 flex flex-wrap gap-2"><select className="input w-40" value={kind} onChange={(e) => setKind(e.target.value)}><option value="">كل الأنواع</option>{Object.entries(SALE_KIND_AR).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select><input type="date" className="input w-40" value={from} onChange={(e) => setFrom(e.target.value)} /><input type="date" className="input w-40" value={to} onChange={(e) => setTo(e.target.value)} /></div>
      <Table rows={rows} empty={<Empty title="لا توجد مبيعات" hint="تظهر هنا مبيعات الحليب (عند التسليم) وبيع الحيوانات والإيرادات الأخرى." />}
        columns={[{ key: 'date', label: 'التاريخ' }, { key: 'kind', label: 'النوع', render: (r) => <Badge tone={r.kind === 'milk' ? 'blue' : r.kind === 'animal' ? 'amber' : 'gray'}>{SALE_KIND_AR[r.kind]}</Badge> }, { key: 'ref', label: 'المرجع' }, { key: 'party', label: 'العميل / المشتري' }, { key: 'description', label: 'البيان' }, { key: 'qty', label: 'الكمية', render: (r) => (r.qty ? <span className="num">{fmt(r.qty)} {r.kind === 'milk' ? 'لتر' : 'رأس'}</span> : '—') }, { key: 'amount', label: 'المبلغ', render: (r) => <b className="num">{money(r.amount, r.currency)}</b> }]} /></Card>
  </>);
}

export default function MilkSales() {
  const { user, can } = useAuth();
  const ags = useCol('milkSales').rows.filter((a) => !a.voided); const dls = useCol('milkDeliveries').rows; const pays = useCol('customerPayments').rows;
  const custs = useCol('customers').rows;
  const [tab, setTab] = useState('ag'); const [q, setQ] = useState(''); const [open, setOpen] = useState(false); const [quick, setQuick] = useState(false); const [sel, setSel] = useState(null);
  const rows = useMemo(() => ags.map((a) => ({ ...a, customer: custs.find((c) => c.id === a.customerId)?.name || '—', pos: agreementPosition(a, dls, pays) }))
    .filter((r) => !q || `${r.number} ${r.customer}`.toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.date.localeCompare(a.date)), [ags, dls, pays, custs, q]);
  const tot = (k) => sumByCurrency(rows, (r) => r.pos[k] && r.currency ? r.pos[k] : 0);
  const sel2 = sel && rows.find((r) => r.id === sel);
  const show = (o) => Object.keys(o).length ? Object.entries(o).map(([c, v]) => money(v, c)).join(' | ') : money(0);
  // Quick sale = scenario A, one atomic batch: agreement + delivery + payment.
  const doQuick = async (d) => {
    if (Number(d.paid) > 0 && !d.accountId) throw new Error('اختر الصندوق لتسجيل المبلغ المدفوع');
    const number = await nextNumber('agreement', 'AG'); const id = newId('milkSales');
    const ops = [{ col: 'milkSales', id, data: { customerId: d.customerId, date: d.date, agreedQty: d.qty, pricePerLiter: d.pricePerLiter, currency: d.currency, number, status: 'open', notes: 'بيع فوري' } },
      { col: 'milkDeliveries', data: { agreementId: id, customerId: d.customerId, date: d.date, qty: d.qty, pricePerLiter: d.pricePerLiter, currency: d.currency } }];
    await commit(user, ops);
    if (Number(d.paid) > 0) await addCustomerPayment(user, { agreementId: id, customerId: d.customerId, date: d.date, amount: Number(d.paid), currency: d.currency, accountId: d.accountId, method: d.method });
  };
  return (
    <div>
      <PageHeader title="مبيعات الحليب" subtitle="اتفاقيات البيع، التسليمات، الدفعات المقدمة والمؤجلة — الإيراد يُحتسب عند التسليم">
        {can('create') && <><button className="btn btn-ghost" onClick={() => setQuick(true)}><Zap size={16} />بيع فوري</button><button className="btn btn-primary" onClick={() => setOpen(true)}><Plus size={16} />اتفاقية جديدة</button></>}
      </PageHeader>
      <div className="mb-3 flex gap-2">{[['ag', 'اتفاقيات الحليب'], ['all', 'كل المبيعات (حليب + حيوانات + أخرى)']].map(([k, l]) => <button key={k} className={`btn ${tab === k ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab(k)}>{l}</button>)}</div>
      {tab === 'all' && <AllSales />}
      {tab === 'ag' && (<>
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Stat label="قيمة المسلّم (إيراد معترف به)" value={<span className="text-lg">{show(sumByCurrency(rows, (r) => r.pos.deliveredValue))}</span>} tone="purple" />
        <Stat label="الذمم المدينة" value={<span className="text-lg">{show(sumByCurrency(rows, (r) => r.pos.receivable))}</span>} tone="red" />
        <Stat label="دفعات مقدمة (التزام للعملاء)" value={<span className="text-lg">{show(sumByCurrency(rows, (r) => r.pos.unappliedCredit))}</span>} tone="blue" />
      </div>
      <Card><div className="mb-3 max-w-xs"><SearchBox value={q} onChange={setQ} placeholder="رقم الاتفاقية أو العميل" /></div>
        <Table rows={rows} onRow={(r) => setSel(r.id)} empty={<Empty title="لا توجد اتفاقيات بعد" hint="أنشئ أول اتفاقية بيع (أضف العملاء أولاً من صفحة العملاء).">{can('create') && <button className="btn btn-primary mt-2" onClick={() => setOpen(true)}>اتفاقية جديدة</button>}</Empty>}
          columns={[{ key: 'number', label: 'الرقم', render: (r) => <b>{r.number}</b> }, { key: 'customer', label: 'العميل' }, { key: 'date', label: 'التاريخ' }, { key: 'agreed', label: 'متفق / مسلّم / متبقٍ (لتر)', render: (r) => <span className="num">{fmt(r.pos.agreedQty)} / {fmt(r.pos.deliveredQty)} / {fmt(r.pos.remainingQty)}</span> },
            { key: 'dv', label: 'قيمة المسلّم', render: (r) => <span className="num">{money(r.pos.deliveredValue, r.currency)}</span> }, { key: 'rc', label: 'مقبوض', render: (r) => <span className="num">{money(r.pos.netReceived, r.currency)}</span> }, { key: 'ar', label: 'ذمم', render: (r) => <b className={`num ${r.pos.receivable ? 'text-rose-600' : ''}`}>{money(r.pos.receivable, r.currency)}</b> }, { key: 'cr', label: 'رصيد دائن', render: (r) => <span className="num text-sky-700">{money(r.pos.unappliedCredit, r.currency)}</span> },
            { key: 'st', label: 'الحالة', render: (r) => <div className="flex gap-1"><Badge tone="gray">{AG_STATUS_AR[r.pos.status]}</Badge><Badge tone={PAY_TONE[r.pos.paymentStatus]}>{PAY_STATUS_AR[r.pos.paymentStatus]}</Badge></div> }]} /></Card></>)}
      <FormModal open={open} onClose={() => setOpen(false)} title="اتفاقية بيع جديدة" fields={agFields} defaults={{ date: today(), currency: 'SYP', method: 'cash', advance: '' }}
        onSubmit={async (d) => { if (Number(d.advance) > 0 && !d.accountId) throw new Error('اختر الصندوق لتسجيل الدفعة المقدمة'); await createAgreement(user, { ...d, advance: Number(d.advance || 0) }); }} />
      <FormModal open={quick} onClose={() => setQuick(false)} title="بيع فوري (تسليم + دفع كامل أو جزئي)" onSubmit={doQuick}
        fields={[{ name: 'customerId', label: 'العميل', type: 'rel', col: 'customers', required: true }, { name: 'date', label: 'التاريخ', type: 'date', required: true }, { name: 'qty', label: 'الكمية (لتر)', type: 'number', required: true, positive: true }, { name: 'pricePerLiter', label: 'سعر اللتر', type: 'number', required: true, positive: true }, cur, { name: 'paid', label: 'المبلغ المدفوع الآن (0 = آجل)', type: 'number', min: 0 }, acct, method]}
        defaults={{ date: today(), currency: 'SYP', paid: '', method: 'cash' }} />
      {sel2 && <Detail ag={sel2} pos={sel2.pos} deliveries={dls} payments={pays} onClose={() => setSel(null)} />}
    </div>
  );
}
