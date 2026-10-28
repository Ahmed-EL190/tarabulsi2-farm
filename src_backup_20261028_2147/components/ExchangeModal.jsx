import { useMemo, useState } from 'react';
import { Modal, Toast, Field, fmt, today } from './ui';
import AnimalPicker from './AnimalPicker';
import { useCol, createAnimal, commit, newId } from '../data/db';
import { recordAnimalEvent } from '../data/ops';
import { useAuth } from '../data/auth';
import { herdState, animalExchange, validateNewAnimal, round2 } from '../lib/finance';
import { CURRENCIES, ANIMAL_CATEGORIES } from '../lib/constants';

/** Exchange (animal for animal + cash difference) or transfer out. The incoming animal is searched by tag/name (already registered)
 *  or created here as a new animal. */
export default function ExchangeModal({ onClose }) {
  const { user } = useAuth();
  const animals = useCol('animals').rows.filter((a) => !a.voided); const events = useCol('animalEvents').rows; const accounts = useCol('cashAccounts').rows.filter((a) => !a.voided);
  const herd = useMemo(() => herdState(events), [events]);
  const [f, setF] = useState({ kind: 'exchange', date: today(), outId: null, oldValue: '', mode: 'existing', inId: null, newValue: '', currency: 'SYP', accountId: '', notes: '',
    tag: '', name: '', category: 'cow', sex: 'F', breed: '', birthDate: '', milkAtPurchase: '', pregnant: 'na', daysToBirth: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  const out = animals.find((a) => a.id === f.outId);
  const accountId = f.accountId || (accounts.length === 1 ? accounts[0].id : '');
  const oldV = Number(f.oldValue) || 0, newV = Number(f.newValue) || 0; const diff = round2(newV - oldV);
  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      if (!out) throw new Error('اختر الحيوان الخارج');
      if (!herd[out.id]?.active) throw new Error('الحيوان الخارج غير موجود ضمن القطيع النشط');
      if (f.kind === 'transfer') { await recordAnimalEvent(user, { animalId: out.id, tag: out.tag, type: 'transfer_out', date: f.date, notes: f.notes }); return onClose(); }
      let inId = f.inId, inTag;
      if (f.mode === 'existing') { const a = animals.find((x) => x.id === inId); if (!a) throw new Error('اختر الحيوان الوارد'); if (a.id === out.id) throw new Error('الحيوان الوارد هو نفسه الخارج'); inTag = a.tag; }
      else {
        const ok = validateNewAnimal(f.tag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان الوارد مسجّل مسبقاً — اختره من "مسجّل مسبقاً"' : 'أدخل رقم الحيوان الوارد');
        inTag = f.tag.trim();
      }
      const x = animalExchange({ date: f.date, oldAnimalId: out.id, newAnimalId: inId || 'pending', oldValue: oldV, newValue: newV, currency: f.currency });
      if (x.cash.length && !accountId) throw new Error('يوجد فرق نقدي: اختر الصندوق');
      if (f.mode === 'new') inId = await createAnimal(user, { tag: inTag, name: f.name, category: f.category, sex: f.sex, breed: f.breed, birthDate: f.birthDate, milkAtPurchase: f.milkAtPurchase, pregnant: f.sex === 'F' ? f.pregnant : 'na', daysToBirth: f.daysToBirth, acquisitionDate: f.date, acquisitionCost: newV, currency: f.currency, origin: 'purchase', healthStatus: 'healthy', viaExchange: true });
      const exId = newId('animalEvents');
      await commit(user, [
        { col: 'animalEvents', data: { animalId: out.id, tag: out.tag, type: 'exchange_out', date: f.date, value: oldV, currency: f.currency, exchangeId: exId, counterpartTag: inTag, notes: f.notes } },
        { col: 'animalEvents', data: { animalId: inId, tag: inTag, type: 'exchange_in', date: f.date, value: newV, currency: f.currency, exchangeId: exId, counterpartTag: out.tag } },
        ...x.cash.map((c) => ({ col: 'cashTransactions', data: { ...c, accountId, exchangeId: exId, description: `فرق تبادل ${out.tag} ↔ ${inTag}` } })),
      ]);
      onClose();
    } catch (e) { setErr(e.message || 'تعذّر الحفظ'); }
    setBusy(false);
  };
  const Sel = ({ k, opts }) => <select className="input" value={f[k]} onChange={(e) => set(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  return (
    <Modal open onClose={onClose} title="تبادل / نقل حيوان" wide>
      <Toast msg={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="العملية"><Sel k="kind" opts={[['exchange', 'تبادل (حيوان مقابل حيوان)'], ['transfer', 'نقل خارج المزرعة']]} /></Field>
        <Field label="التاريخ"><input type="date" dir="ltr" className="input" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <div className="sm:col-span-2"><Field label="الحيوان الخارج (اكتب الرقم أو الاسم) *"><AnimalPicker animals={animals} value={f.outId} onChange={(v) => set('outId', v)} filter={(a) => herd[a.id]?.active} /></Field></div>
        {f.kind === 'exchange' && (<>
          <Field label="قيمة الحيوان الخارج المتفق عليها"><input type="number" inputMode="decimal" dir="ltr" className="input" value={f.oldValue} onChange={(e) => set('oldValue', e.target.value)} /></Field>
          <Field label="العملة"><Sel k="currency" opts={CURRENCIES} /></Field>
          <div className="sm:col-span-2"><Field label="الحيوان الوارد"><Sel k="mode" opts={[['existing', 'مسجّل مسبقاً (ابحث بالرقم أو الاسم)'], ['new', 'حيوان جديد (سجّله هنا)']]} /></Field></div>
          {f.mode === 'existing' ? (
            <div className="sm:col-span-2"><AnimalPicker animals={animals} value={f.inId} onChange={(v) => set('inId', v)} filter={(a) => a.id !== f.outId} placeholder="اكتب رقم الحيوان الوارد أو اسمه…" />
              <p className="mt-1 text-xs text-amber-700">إن كنت سجّلت شراءه بدفع من الصندوق، فلا تدفع فرق التبادل مرة ثانية: اجعل فرق القيمة صفراً أو عدّل القيم كي لا يتكرر الدفع.</p></div>
          ) : (<>
            <Field label="رقم الوارد *"><input className="input" value={f.tag} onChange={(e) => set('tag', e.target.value)} /></Field>
            <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="الفئة"><Sel k="category" opts={ANIMAL_CATEGORIES} /></Field>
            <Field label="الجنس"><Sel k="sex" opts={[['F', 'أنثى'], ['M', 'ذكر']]} /></Field>
            <Field label="السلالة"><input className="input" value={f.breed} onChange={(e) => set('breed', e.target.value)} /></Field>
            <Field label="تاريخ الميلاد"><input type="date" dir="ltr" className="input" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
            {f.sex === 'F' && (<>
              <Field label="الحليب عند الشراء (لتر/يوم)"><input type="number" dir="ltr" className="input" value={f.milkAtPurchase} onChange={(e) => set('milkAtPurchase', e.target.value)} /></Field>
              <Field label="الحمل"><Sel k="pregnant" opts={[['na', 'لا ينطبق'], ['no', 'غير حامل'], ['yes', 'حامل']]} /></Field>
              {f.pregnant === 'yes' && <Field label="أيام متبقية على الولادة"><input type="number" dir="ltr" className="input" value={f.daysToBirth} onChange={(e) => set('daysToBirth', e.target.value)} /></Field>}
            </>)}
          </>)}
          <Field label="قيمة الحيوان الوارد المتفق عليها"><input type="number" inputMode="decimal" dir="ltr" className="input" value={f.newValue} onChange={(e) => set('newValue', e.target.value)} /></Field>
          <Field label="الصندوق (للفرق النقدي)"><select className="input" value={accountId} onChange={(e) => set('accountId', e.target.value)}><option value="">— اختر —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>
          {(oldV > 0 || newV > 0) && <div className={`rounded-lg p-3 text-sm font-bold sm:col-span-2 ${diff === 0 ? 'bg-slate-50' : diff > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{diff === 0 ? 'لا يوجد فرق نقدي' : diff > 0 ? `ندفع فرقاً: ${fmt(diff)} ${f.currency}` : `نستلم فرقاً: ${fmt(-diff)} ${f.currency}`}{out && oldV > 0 && Number(out.acquisitionCost) > 0 ? ` — نتيجة الحيوان الخارج: ${fmt(round2(oldV - Number(out.acquisitionCost)))}` : ''}</div>}
        </>)}
        <div className="sm:col-span-2"><Field label="الطرف الآخر / ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end"><button className="btn btn-ghost w-full sm:w-auto" onClick={onClose}>إلغاء</button><button className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={submit}>حفظ</button></div>
      </div>
    </Modal>
  );
}
