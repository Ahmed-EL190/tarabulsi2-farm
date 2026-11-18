import { useMemo, useState } from 'react';
import { Modal, Toast, Field, fmt, today } from './ui';
import AnimalPicker from './AnimalPicker';
import { lightNum, numOf } from '../lib/num';
import { useCol, useCustomLists, createAnimal, commit, newId } from '../data/db';
import { recordAnimalEvent } from '../data/ops';
import { useAuth } from '../data/auth';
import { herdState, animalExchange, validateNewAnimal, round2 } from '../lib/finance';
import { CURRENCIES, allAnimalCategories } from '../lib/constants';

/** Exchange (animal for animal + cash difference) or transfer out. The incoming animal is searched by tag/name (already registered)
 *  or created here as a new animal. */
export default function ExchangeModal({ onClose }) {
  const { user } = useAuth(); useCustomLists();
  const animals = useCol('animals').rows.filter((a) => !a.voided); const events = useCol('animalEvents').rows; const accounts = useCol('cashAccounts').rows.filter((a) => !a.voided);
  const partners = useCol('partners').rows.filter((p) => !p.voided); const defaultPayer = partners.find((p) => /وليد/.test(p.name || ''))?.id || (partners.length === 1 ? partners[0].id : '');
  const herd = useMemo(() => herdState(events, animals), [events, animals]); // eslint-disable-line
  const [f, setF] = useState({ kind: 'exchange', date: today(), outs: [{ id: null, value: '' }], mode: 'new', inId: null, newValue: '', currency: 'SYP', accountId: '', payFrom: 'partner', payerId: '', notes: '',
    tag: '', name: '', category: 'cow', sex: 'F', breed: '', birthDate: '', milkAtPurchase: '', pregnant: 'na', daysToBirth: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const set = (k, v) => setF((x) => ({ ...x, [k]: v }));
  // الحيوانات الخارجة: أي عدد (3 مقابل واحد مثلاً)، لكلٍّ قيمته المتفق عليها
  const setOut = (i, patch) => setF((x) => ({ ...x, outs: x.outs.map((o, k) => (k === i ? { ...o, ...patch } : o)) }));
  const addOut = () => setF((x) => ({ ...x, outs: [...x.outs, { id: null, value: '' }] }));
  const delOut = (i) => setF((x) => ({ ...x, outs: x.outs.length > 1 ? x.outs.filter((_, k) => k !== i) : x.outs }));
  const outRows = f.outs.map((o) => ({ ...o, a: animals.find((a) => a.id === o.id) }));
  const outTags = outRows.filter((o) => o.a).map((o) => o.a.tag).join('، ');
  const accountId = f.accountId || (accounts.length === 1 ? accounts[0].id : ''); const payerId = f.payerId || defaultPayer;
  // اختيار حيوان مسجّل مسبقاً يملأ قيمته (سعر شرائه) تلقائياً
  const pickIn = (v) => setF((x) => { const a = animals.find((y) => y.id === v); return { ...x, inId: v, newValue: x.newValue || (a && Number(a.acquisitionCost) > 0 ? String(a.acquisitionCost) : x.newValue) }; });
  const inAnimal = f.mode === 'existing' ? animals.find((a) => a.id === f.inId) : null;
  const oldV = round2(f.outs.reduce((t, o) => t + (numOf(o.value) || 0), 0)), newV = numOf(f.newValue) || 0; const diff = round2(newV - oldV);
  const submit = async () => {
    setErr(''); setBusy(true);
    try {
      const chosen = outRows.filter((o) => o.id);
      if (!chosen.length || chosen.length !== outRows.length) throw new Error('اختر كل الحيوانات الخارجة (أو احذف الصف الفارغ)');
      if (new Set(chosen.map((o) => o.id)).size !== chosen.length) throw new Error('حيوان خارج مكرر');
      for (const o of chosen) if (!herd[o.id]?.active) throw new Error(`الحيوان ${o.a?.tag || ''} غير موجود ضمن القطيع النشط`);
      if (f.kind === 'transfer') { await commit(user, chosen.map((o) => ({ col: 'animalEvents', data: { animalId: o.a.id, tag: o.a.tag, type: 'transfer_out', date: f.date, notes: f.notes } })), 'create'); return onClose(); }
      let inId = f.inId, inTag;
      if (f.mode === 'existing') { const a = animals.find((x) => x.id === inId); if (!a) throw new Error('اختر الحيوان الوارد'); if (f.outs.some((o) => o.id === a.id)) throw new Error('الحيوان الوارد هو نفسه أحد الخارجين'); inTag = a.tag; }
      else {
        const ok = validateNewAnimal(f.tag, animals); if (!ok.ok) throw new Error(ok.reason === 'duplicate' ? 'رقم الحيوان الوارد مسجّل مسبقاً — اختره من "مسجّل مسبقاً"' : 'أدخل رقم الحيوان الوارد');
        inTag = f.tag.trim();
      }
      const x = animalExchange({ date: f.date, oldAnimalId: f.outs[0].id, newAnimalId: inId || 'pending', oldValue: oldV, newValue: newV, currency: f.currency });
      const byPartner = x.cashDifference > 0 && f.payFrom === 'partner'; // نحن ندفع فرقاً: يدفعه شريك (يُسجَّل في حسابه) أو يخرج من الصندوق
      if (byPartner && !payerId) throw new Error('اختر الشريك الذي دفع فرق التبادل');
      if (x.cash.length && !byPartner && !accountId) throw new Error('يوجد فرق نقدي: اختر الصندوق');
      if (f.mode === 'new') inId = await createAnimal(user, { tag: inTag, name: f.name, category: f.category, sex: f.sex, breed: f.breed, birthDate: f.birthDate, milkAtPurchase: f.milkAtPurchase, pregnant: f.sex === 'F' ? f.pregnant : 'na', daysToBirth: f.daysToBirth, acquisitionDate: f.date, acquisitionCost: newV, currency: f.currency, origin: 'purchase', healthStatus: 'healthy', viaExchange: true });
      const exId = newId('animalEvents');
      const note = `فرق تبادل ${outTags} ↔ ${inTag}`;
      await commit(user, [
        ...outRows.map((o) => ({ col: 'animalEvents', data: { animalId: o.a.id, tag: o.a.tag, type: 'exchange_out', date: f.date, value: numOf(o.value) || 0, currency: f.currency, exchangeId: exId, counterpartTag: inTag, notes: f.notes } })),
        { col: 'animalEvents', data: { animalId: inId, tag: inTag, type: 'exchange_in', date: f.date, value: newV, currency: f.currency, exchangeId: exId, counterpartTag: outTags, ...(byPartner ? { diffPaidBy: payerId } : {}) } },
        ...(byPartner ? [{ col: 'partnerCapitalTransactions', data: { partnerId: payerId, date: f.date, type: 'animal_purchase_paid', amount: x.cashDifference, currency: f.currency, animalId: inId, exchangeId: exId, note } }] : x.cash.map((c) => ({ col: 'cashTransactions', data: { ...c, accountId, exchangeId: exId, description: note } }))),
      ]);
      onClose();
    } catch (e) { setErr(String(e.message).startsWith('DUPLICATE_TAG') ? `رقم الحيوان مسجّل مسبقاً لحيوان قائم${e.message.split(':')[1] ? ` (${e.message.split(':')[1]})` : ''}` : e.message || 'تعذّر الحفظ'); }
    setBusy(false);
  };
  const Sel = ({ k, opts }) => <select className="input" value={f[k]} onChange={(e) => set(k, e.target.value)}>{opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  return (
    <Modal open onClose={onClose} title="تبادل / نقل حيوان" wide>
      <Toast msg={err} />
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="العملية"><Sel k="kind" opts={[['exchange', 'تبادل (حيوان مقابل حيوان)'], ['transfer', 'نقل خارج المزرعة']]} /></Field>
        <Field label="التاريخ"><input type="date" dir="ltr" className="input" value={f.date} onChange={(e) => set('date', e.target.value)} /></Field>
        <div className="space-y-2 sm:col-span-2">
          <div className="text-xs font-bold text-slate-600">الحيوانات الخارجة * <span className="font-normal text-slate-400">(حيوان أو أكثر — مثلاً 3 مقابل حيوان واحد)</span></div>
          {outRows.map((o, i) => (<div key={i} className="grid grid-cols-1 gap-2 rounded-lg border border-slate-200 p-2 sm:grid-cols-[1fr_11rem_auto] sm:items-start">
            <div><AnimalPicker animals={animals} value={o.id} onChange={(v) => setOut(i, { id: v })} filter={(a) => herd[a.id]?.active && !f.outs.some((x, k) => k !== i && x.id === a.id)} />
              {f.kind === 'exchange' && o.a && numOf(o.value) > 0 && Number(o.a.acquisitionCost) > 0 && <p className="mt-1 text-xs text-slate-500">نتيجته: <b>{fmt(round2((numOf(o.value) || 0) - Number(o.a.acquisitionCost)))}</b> (سعر شرائه {fmt(o.a.acquisitionCost)})</p>}</div>
            {f.kind === 'exchange' ? <input type="text" inputMode="decimal" dir="ltr" className="input" placeholder="قيمته المتفق عليها" value={o.value} onChange={(e) => setOut(i, { value: lightNum(e.target.value) })} /> : <span />}
            {f.outs.length > 1 ? <button type="button" className="btn btn-ghost !px-2.5 !py-1.5 text-xs text-rose-600" onClick={() => delOut(i)}>حذف</button> : <span />}</div>))}
          <button type="button" className="btn btn-ghost !py-1.5 text-xs" onClick={addOut}>+ إضافة حيوان خارج آخر</button>
        </div>
        {f.kind === 'exchange' && (<>
          <Field label="إجمالي قيمة الخارجين"><div className="input bg-slate-50 font-bold num">{fmt(oldV)}</div></Field>
          <Field label="العملة"><Sel k="currency" opts={CURRENCIES} /></Field>
          <div className="sm:col-span-2"><Field label="الحيوان الوارد"><Sel k="mode" opts={[['new', 'حيوان جديد — سجّل بياناته هنا في نفس الكارت'], ['existing', 'مسجّل مسبقاً (ابحث بالرقم أو الاسم)']]} /></Field></div>
          {f.mode === 'existing' ? (
            <div className="sm:col-span-2"><AnimalPicker animals={animals} value={f.inId} onChange={pickIn} filter={(a) => a.id !== f.outId} placeholder="اكتب رقم الحيوان الوارد أو اسمه…" />
              {inAnimal && <p className="mt-1 text-xs text-slate-600">سعر الحيوان الوارد المسجّل: <b>{fmt(inAnimal.acquisitionCost)}</b> {inAnimal.currency || ''} — مُلئت قيمته تلقائياً.</p>}
              <p className="mt-1 text-xs text-amber-700">إن كنت سجّلت شراءه ودُفع ثمنه من قبل، فاجعل فرق القيمة صفراً حتى لا يتكرر الدفع. الأسهل: اختر «حيوان جديد» وسجّله هنا في نفس الكارت.</p></div>
          ) : (<>
            <Field label="رقم الوارد *"><input className="input" value={f.tag} onChange={(e) => set('tag', e.target.value)} /></Field>
            <Field label="الاسم"><input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} /></Field>
            <Field label="الفئة"><Sel k="category" opts={allAnimalCategories()} /></Field>
            <Field label="الجنس"><Sel k="sex" opts={[['F', 'أنثى'], ['M', 'ذكر']]} /></Field>
            <Field label="السلالة"><input className="input" value={f.breed} onChange={(e) => set('breed', e.target.value)} /></Field>
            <Field label="تاريخ الميلاد"><input type="date" dir="ltr" className="input" value={f.birthDate} onChange={(e) => set('birthDate', e.target.value)} /></Field>
            {f.sex === 'F' && (<>
              <Field label="الحليب عند الشراء (لتر/يوم)"><input type="text" inputMode="decimal" dir="ltr" className="input" value={f.milkAtPurchase} onChange={(e) => set('milkAtPurchase', lightNum(e.target.value))} /></Field>
              <Field label="الحمل"><Sel k="pregnant" opts={[['na', 'لا ينطبق'], ['no', 'غير حامل'], ['yes', 'حامل']]} /></Field>
              {f.pregnant === 'yes' && <Field label="أيام متبقية على الولادة"><input type="text" inputMode="numeric" dir="ltr" className="input" value={f.daysToBirth} onChange={(e) => set('daysToBirth', lightNum(e.target.value))} /></Field>}
            </>)}
          </>)}
          <Field label="قيمة الحيوان الوارد المتفق عليها"><input type="text" inputMode="decimal" dir="ltr" className="input" value={f.newValue} onChange={(e) => set('newValue', lightNum(e.target.value))} /></Field>
          {diff > 0 && <Field label="من يدفع فرق التبادل؟"><Sel k="payFrom" opts={[['partner', 'شريك يدفع من ماله (يُسجَّل في حسابه)'], ['account', 'من صندوق المزرعة']]} /></Field>}
          {diff > 0 && f.payFrom === 'partner' && <Field label="الشريك الذي دفع الفرق"><select className="input" value={payerId} onChange={(ev) => set('payerId', ev.target.value)}><option value="">— اختر —</option>{partners.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field>}
          {(diff < 0 || (diff > 0 && f.payFrom === 'account')) && <Field label={diff < 0 ? 'الصندوق (لاستلام الفرق)' : 'الصندوق (لدفع الفرق)'}><select className="input" value={accountId} onChange={(ev) => set('accountId', ev.target.value)}><option value="">— اختر —</option>{accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}</select></Field>}
          {(oldV > 0 || newV > 0) && <div className={`rounded-lg p-3 text-sm font-bold sm:col-span-2 ${diff === 0 ? 'bg-slate-50' : diff > 0 ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700'}`}>{diff === 0 ? 'لا يوجد فرق نقدي' : diff > 0 ? `ندفع فرقاً: ${fmt(diff)} ${f.currency}` : `نستلم فرقاً: ${fmt(-diff)} ${f.currency}`}</div>}
        </>)}
        <div className="sm:col-span-2"><Field label="الطرف الآخر / ملاحظات"><input className="input" value={f.notes} onChange={(e) => set('notes', e.target.value)} /></Field></div>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end"><button className="btn btn-ghost w-full sm:w-auto" onClick={onClose}>إلغاء</button><button className="btn btn-primary w-full sm:w-auto" disabled={busy} onClick={submit}>حفظ</button></div>
      </div>
    </Modal>
  );
}
