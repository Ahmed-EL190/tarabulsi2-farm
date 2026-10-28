import { useMemo, useState } from 'react';
import { Modal, Toast, Field, fmt, today } from './ui';
import AnimalPicker from './AnimalPicker';
import { useCol } from '../data/db';
import { sellAnimal } from '../data/ops';
import { useAuth } from '../data/auth';
import { herdState, animalProfile, round2 } from '../lib/finance';
import { CURRENCIES, ANIMAL_CATEGORIES } from '../lib/constants';

const CAT = Object.fromEntries(ANIMAL_CATEGORIES);
const SRC = { purchase: 'شراء', birth: 'مولود بالمزرعة', opening: 'رصيد افتتاحي' };

/** Pick an animal by tag/name -> details -> sell. Cash goes to the same cashbox as milk payments. */
export default function AnimalSale({ onClose, preselectId = null }) {
  const { user, can } = useAuth();
  const animals = useCol('animals').rows.filter((a) => !a.voided);
  const events = useCol('animalEvents').rows; const production = useCol('milkProduction').rows; const expenses = useCol('expenses').rows;
  const accounts = useCol('cashAccounts').rows.filter((a) => !a.voided);
  const herd = useMemo(() => herdState(events), [events]);
  const [selId, setSelId] = useState(preselectId);
  const [f, setF] = useState({ date: today(), price: '', currency: 'SYP', accountId: '', buyerName: '', notes: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const animal = animals.find((a) => a.id === selId);
  const active = !!animal && !!herd[animal.id]?.active;
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
  const calving = prof?.daysToCalving == null ? '' : prof.daysToCalving >= 0 ? `بعد ${prof.daysToCalving} يوم (${prof.expectedBirthDate})` : `متأخرة ${-prof.daysToCalving} يوم`;
  const details = animal ? [
    ['الرقم', animal.tag], ['الاسم', animal.name], ['الفئة', CAT[animal.category]], ['الجنس', animal.sex === 'F' ? 'أنثى' : animal.sex === 'M' ? 'ذكر' : ''], ['السلالة', animal.breed],
    ['المصدر', SRC[animal.origin]], ['جهة الشراء', animal.sellerName], ['تاريخ الشراء', animal.acquisitionDate], ['سعر الشراء', animal.acquisitionCost ? `${fmt(animal.acquisitionCost)} ${animal.currency || ''}` : ''],
    ['العمر (شهر)', prof.ageMonths], ['الحمل', { yes: 'حامل', no: 'غير حامل', na: 'لا ينطبق' }[animal.pregnant]], ['موعد الولادة', calving], ['حليب عند الشراء (لتر/يوم)', animal.milkAtPurchase], ['الحالة', status],
    ['إجمالي الحليب (لتر)', fmt(prof.milkTotal)], ['أيام الإنتاج', prof.milkDays], ['متوسط اليوم (لتر)', fmt(prof.milkAvg)], ['تكلفة العلاج', fmt(prof.treatmentCost)],
  ] : [];
  return (
    <Modal open onClose={onClose} title="بيع حيوان" wide>
      <Toast msg={err} />
      <div className="mb-3"><AnimalPicker animals={animals} value={selId} onChange={setSelId} filter={(a) => herd[a.id]?.active} autoFocus={!preselectId} /></div>
      {animal && (<>
        <div className="mb-3 grid grid-cols-2 gap-x-3 gap-y-2 rounded-xl bg-slate-50 p-3 text-sm sm:grid-cols-3 lg:grid-cols-4">
          {details.map(([l, v]) => <div key={l} className="min-w-0"><div className="text-xs text-slate-500">{l}</div><div className="break-words font-bold">{v === undefined || v === null || v === '' ? '—' : v}</div></div>)}
        </div>
        {!active ? <div className="rounded-lg bg-amber-50 p-3 text-sm font-bold text-amber-800">هذا الحيوان خارج القطيع النشط ولا يمكن بيعه.</div> : (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="تاريخ البيع *"><input type="date" className="input" dir="ltr" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
            <Field label="سعر البيع *"><input type="number" inputMode="decimal" className="input" dir="ltr" value={f.price} onChange={(e) => set('price', e.target.value)} /></Field>
            <Field label="العملة"><select className="input" value={f.currency} onChange={(e) => set('currency', e.target.value)}>{CURRENCIES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></Field>
            <Field label="الصندوق المستلِم *"><select className="input" value={accountId} onChange={(e) => set('accountId', e.target.value)}><option value="">— اختر —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
            <Field label="المشتري"><input className="input" value={f.buyerName} onChange={(e) => set('buyerName', e.target.value)} /></Field>
            <Field label="ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field>
            {price > 0 && <div className={`rounded-lg p-3 text-sm font-bold sm:col-span-2 ${price - cost >= 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-rose-50 text-rose-700'}`}>نتيجة البيع (سعر البيع − سعر الشراء): {fmt(round2(price - cost))} {f.currency} — {price - cost >= 0 ? 'ربح' : 'خسارة'}</div>}
            <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end"><button className="btn btn-ghost w-full sm:w-auto" onClick={onClose}>إلغاء</button><button className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={submit}>تأكيد البيع</button></div>
          </div>
        )}
      </>)}
    </Modal>
  );
}
