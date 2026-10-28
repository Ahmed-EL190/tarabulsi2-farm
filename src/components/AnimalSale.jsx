import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { Modal, Toast, Field, fmt, today } from './ui';
import { useCol } from '../data/db';
import { sellAnimal } from '../data/ops';
import { useAuth } from '../data/auth';
import { herdState, animalProfile, round2 } from '../lib/finance';
import { CURRENCIES, ANIMAL_CATEGORIES } from '../lib/constants';

const CAT = Object.fromEntries(ANIMAL_CATEGORIES);
const SRC = { purchase: 'شراء', birth: 'مولود بالمزرعة', opening: 'رصيد افتتاحي' };

/** Search an animal by tag or name -> details card -> sell. Money goes to the same cashbox as milk payments. */
export default function AnimalSale({ onClose, preselectId = null }) {
  const { user, can } = useAuth();
  const animals = useCol('animals').rows.filter((a) => !a.voided);
  const events = useCol('animalEvents').rows; const production = useCol('milkProduction').rows; const expenses = useCol('expenses').rows;
  const accounts = useCol('cashAccounts').rows.filter((a) => !a.voided);
  const herd = useMemo(() => herdState(events), [events]);
  const [q, setQ] = useState(''); const [selId, setSelId] = useState(preselectId);
  const [f, setF] = useState({ date: today(), price: '', currency: 'SYP', accountId: '', buyerName: '', notes: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const animal = animals.find((a) => a.id === selId);
  const active = !!animal && !!herd[animal.id]?.active;
  const matches = useMemo(() => (q.trim() ? animals.filter((a) => herd[a.id]?.active && `${a.tag} ${a.name || ''}`.toLowerCase().includes(q.trim().toLowerCase())).slice(0, 8) : []), [q, animals, herd]);
  const prof = animal ? animalProfile(animal, { events, production, expenses }) : null;
  const accountId = f.accountId || (accounts.length === 1 ? accounts[0].id : '');
  const price = Number(f.price) || 0; const cost = Number(animal?.acquisitionCost) || 0;
  const set = (k, v) => setF({ ...f, [k]: v });
  const submit = async () => {
    setErr('');
    if (!can('create')) return setErr('ليس لديك صلاحية');
    if (!active) return setErr('الحيوان غير موجود ضمن القطيع النشط');
    setBusy(true);
    try { await sellAnimal(user, { animal, ...f, accountId }); onClose(); } catch (e) { setErr(e.message || 'تعذّر الحفظ'); }
    setBusy(false);
  };
  const status = !animal ? '' : herd[animal.id]?.active ? (animal.healthStatus === 'sick' ? 'مريض' : 'نشط') : ({ sale: 'مباع', death: 'نافق', transfer_out: 'منقول', exchange_out: 'مبادَل' }[herd[animal.id]?.last] || 'خارج القطيع');
  const details = animal ? [
    ['الرقم', animal.tag], ['الاسم', animal.name], ['الفئة', CAT[animal.category]], ['الجنس', animal.sex === 'F' ? 'أنثى' : animal.sex === 'M' ? 'ذكر' : ''], ['السلالة', animal.breed],
    ['المصدر', SRC[animal.origin]], ['جهة الشراء', animal.sellerName], ['تاريخ الشراء', animal.acquisitionDate], ['سعر الشراء', animal.acquisitionCost ? `${fmt(animal.acquisitionCost)} ${animal.currency || ''}` : ''],
    ['العمر (شهر)', prof.ageMonths], ['حامل عند الشراء', { yes: 'نعم', no: 'لا', na: 'لا ينطبق' }[animal.pregnant]], ['الحالة', status],
    ['إجمالي الحليب (لتر)', fmt(prof.milkTotal)], ['أيام الإنتاج', prof.milkDays], ['متوسط اليوم (لتر)', fmt(prof.milkAvg)], ['تكلفة العلاج', fmt(prof.treatmentCost)],
  ] : [];
  return (
    <Modal open onClose={onClose} title="بيع حيوان" wide>
      <Toast msg={err} />
      <div className="relative mb-3">
        <Search size={16} className="pointer-events-none absolute right-3 top-3 text-slate-400" />
        <input className="input pr-9" autoFocus={!preselectId} placeholder="اكتب رقم الحيوان أو اسمه…" value={q} onChange={(e) => { setQ(e.target.value); setSelId(null); }} />
        {matches.length > 0 && !animal && (
          <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-lg border bg-white shadow-lg">
            {matches.map((a) => <button key={a.id} type="button" className="block w-full px-3 py-2 text-right text-sm hover:bg-emerald-50" onClick={() => { setSelId(a.id); setQ(`${a.tag}${a.name ? ' - ' + a.name : ''}`); }}><b>{a.tag}</b> {a.name} <span className="text-xs text-slate-500">{CAT[a.category] || ''} {a.breed || ''}</span></button>)}
          </div>
        )}
        {q.trim() && !animal && matches.length === 0 && <div className="mt-1 text-xs text-slate-500">لا يوجد حيوان نشط بهذا الرقم/الاسم</div>}
      </div>
      {animal && (<>
        <div className="mb-3 grid grid-cols-2 gap-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-4">
          {details.map(([l, v]) => <div key={l}><div className="text-xs text-slate-500">{l}</div><div className="font-bold">{v === undefined || v === null || v === '' ? '—' : v}</div></div>)}
        </div>
        {!active ? <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">هذا الحيوان خارج القطيع النشط ولا يمكن بيعه.</div> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تاريخ البيع *"><input type="date" className="input" dir="ltr" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="سعر البيع *"><input type="number" className="input" dir="ltr" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="العملة"><select className="input" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="الصندوق المستلِم *"><select className="input" value={accountId} onChange={(e) => set('accountId', e.target.value)}><option value="">— اختر —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="المشتري"><input className="input" value={f.buyerName} onChange={(e) => set('buyerName', e.target.value)} /></Field>
            <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            {price > 0 && <div className={`sm:col-span-2 rounded-lg p-3 text-sm font-bold ${price - cost >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>نتيجة البيع (سعر البيع − سعر الشراء): {fmt(round2(price - cost))} {f.currency} {price - cost >= 0 ? 'ربح' : 'خسارة'}</div>}
            <div className="flex justify-end gap-2 sm:col-span-2"><button className="btn btn-ghost" onClick={onClose}>إلغاء</button><button className="btn btn-primary" disabled={busy} onClick={submit}>تأكيد البيع</button></div>
          </div>
        )}
      </>)}
    </Modal>
  );
}
