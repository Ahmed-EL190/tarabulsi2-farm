import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Ban, Camera, X as XIcon } from 'lucide-react';
import { compressImage } from '../lib/image';
import { Card, Table, Modal, Field, PageHeader, SearchBox, Empty, Toast, today } from './ui';
import { useCol, saveRecord, voidRecord } from '../data/db';
import { useAuth } from '../data/auth';

export function buildSchema(fields) {
  const shape = {};
  for (const f of fields) {
    let s;
    if (f.type === 'number') s = z.coerce.number({ invalid_type_error: 'أدخل رقماً' }).refine((v) => f.min === undefined || v >= f.min, f.min === 0 ? 'يجب ألا يكون سالباً' : `الحد الأدنى ${f.min}`).refine((v) => !f.positive || v > 0, 'يجب أن تكون القيمة أكبر من صفر');
    else s = z.string();
    if (f.type !== 'number' && f.required) s = s.min(1, 'مطلوب');
    if (f.type === 'number' && !f.required) s = z.preprocess((v) => (v === '' || v == null ? undefined : v), s.optional());
    if (f.type !== 'number' && !f.required) s = s.optional();
    shape[f.name] = s;
  }
  return z.object(shape);
}

function RelSelect({ f, reg, setValue, getValues }) {
  const { rows } = useCol(f.col);
  // One cashbox for everything: if there is a single account it is pre-selected.
  useEffect(() => { if (f.col === 'cashAccounts' && setValue) { const o = rows.filter((r) => !r.voided); if (o.length === 1 && !getValues(f.name)) setValue(f.name, o[0].id); } }, [rows]); // eslint-disable-line
  return (
    <select className="input" {...reg}><option value="">— اختر —</option>
      {rows.filter((r) => !r.voided && (!f.where || f.where(r))).map((r) => <option key={r.id} value={r.id}>{(f.optLabel ? f.optLabel(r) : r.name) || r.id}</option>)}
    </select>
  );
}
/** حقل صورة: التقاط من الكاميرا أو اختيار من المعرض، مع ضغط تلقائي. */
function ImageField({ f, register, setValue, getValues }) {
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState(''); const [local, setLocal] = useState(undefined);
  const v = local !== undefined ? local : getValues(f.name);
  const pick = async (e) => { const file = e.target.files?.[0]; e.target.value = ''; if (!file) return; setBusy(true); setMsg('');
    try { const url = await compressImage(file); setValue(f.name, url, { shouldDirty: true }); setLocal(url); } catch (x) { setMsg(x.message || 'تعذّر معالجة الصورة'); } setBusy(false); };
  return (
    <div>
      <input type="hidden" {...register(f.name)} />
      <div className="mb-1 text-xs font-bold text-slate-600">{f.label}</div>
      <div className="flex items-center gap-3">
        {v ? <img src={v} alt="" className="h-20 w-20 rounded-xl border object-cover" /> : <div className="grid h-20 w-20 place-items-center rounded-xl border border-dashed text-slate-300"><Camera size={26} /></div>}
        <div className="flex flex-col gap-2">
          <label className="btn btn-ghost cursor-pointer !py-1.5 text-xs"><Camera size={15} />{busy ? 'جارٍ المعالجة…' : v ? 'تغيير الصورة' : 'التقاط / اختيار صورة'}<input type="file" accept="image/*" className="hidden" onChange={pick} disabled={busy} /></label>
          {v && <button type="button" className="btn btn-danger !py-1.5 text-xs" onClick={() => { setValue(f.name, '', { shouldDirty: true }); setLocal(''); }}><XIcon size={14} />حذف الصورة</button>}
        </div>
      </div>
      {msg && <div className="mt-1 text-xs font-bold text-red-600">{msg}</div>}
    </div>
  );
}
export function FieldInput({ f, register, errors, setValue, getValues }) {
  const reg = register(f.name);
  if (f.type === 'image') return <ImageField f={f} register={register} setValue={setValue} getValues={getValues} />;
  let input;
  if (f.type === 'select') input = <select className="input" {...reg}>{!f.required && <option value="">—</option>}{f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>;
  else if (f.type === 'rel') input = <RelSelect f={f} reg={reg} setValue={setValue} getValues={getValues} />;
  else if (f.type === 'textarea') input = <textarea className="input" rows={2} {...reg} />;
  else input = <input className="input" type={f.type === 'number' ? 'number' : f.type === 'date' ? 'date' : 'text'} step="any" dir={f.type === 'number' || f.type === 'date' ? 'ltr' : undefined} {...reg} />;
  return <Field label={f.label + (f.required ? ' *' : '')} error={errors[f.name]?.message}>{input}</Field>;
}

/** Reusable form modal. Used by CrudPage and by custom pages. */
export function FormModal({ open, onClose, title, fields, defaults, onSubmit, submitLabel = 'حفظ' }) {
  const schema = useMemo(() => buildSchema(fields), [fields]);
  const { register, handleSubmit, setValue, getValues, watch, formState: { errors, isSubmitting }, reset } = useForm({ resolver: zodResolver(schema), values: defaults });
  const vals = watch(); const shown = fields.filter((f) => !f.showIf || f.showIf(vals));
  const [err, setErr] = useState('');
  const go = handleSubmit(async (d) => {
    setErr('');
    try { await onSubmit(d); reset(); onClose(); } catch (e) { setErr(e.message === 'DUPLICATE_TAG' ? 'رقم الحيوان مسجّل مسبقاً' : e.message || 'تعذّر الحفظ'); }
  });
  return (
    <Modal open={open} onClose={onClose} title={title} wide={fields.length > 6}>
      <form onSubmit={go} className="space-y-3">
        <Toast msg={err} />
        <div className="grid gap-3 sm:grid-cols-2">{shown.map((f) => <div key={f.name} className={f.type === 'textarea' ? 'sm:col-span-2' : ''}><FieldInput f={f} register={register} errors={errors} setValue={setValue} getValues={getValues} /></div>)}</div>
        <div className="flex justify-end gap-2 pt-2"><button type="button" className="btn btn-ghost" onClick={onClose}>إلغاء</button><button className="btn btn-primary" disabled={isSubmitting}>{submitLabel}</button></div>
      </form>
    </Modal>
  );
}

/** Config-driven list + add/edit/void page.
 * props: title, subtitle, col, fields, cols(ctx)=>[], defaults, searchKeys, create(user,data), useCtx(), summary(rows,ctx), actions(row,ctx), emptyHint, filter(row) */
export default function CrudPage({ title, subtitle, col, fields, cols, defaults = {}, searchKeys = [], create, useCtx, summary, rowActions, emptyHint, filter, noEdit, extraHeader, createOnlyFields = [], noAdd, update, onVoid, filters = [] }) {
  const { user, can } = useAuth();
  const { rows, loading } = useCol(col);
  const ctx = useCtx ? useCtx() : {};
  const [q, setQ] = useState(''); const [edit, setEdit] = useState(null); const [open, setOpen] = useState(false); const [fv, setFv] = useState({});
  const shown = useMemo(() => rows.filter((r) => !r.voided && (!filter || filter(r)) && filters.every((x) => !fv[x.key] || (x.test ? x.test(r, fv[x.key], ctx) : String(r[x.key] ?? '') === fv[x.key])) && (!q || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase()))))
    .sort((a, b) => String(b.date || b.createdAt?.seconds || '').localeCompare(String(a.date || a.createdAt?.seconds || ''))), [rows, q, filter, searchKeys, fv, ctx]); // eslint-disable-line
  const columns = [...cols(ctx, rows), { key: '_a', label: '', render: (r) => (
    <div className="flex gap-1">
      {rowActions?.(r, ctx)}
      {can('update') && !noEdit && <button className="rounded p-1.5 hover:bg-slate-100" title="تعديل" onClick={() => { setEdit(r); setOpen(true); }}><Pencil size={15} /></button>}
      {can('voidFinancial') && <button className="rounded p-1.5 text-rose-600 hover:bg-rose-50" title="إلغاء السجل (يبقى في سجل التدقيق)" onClick={async () => { const why = prompt('سبب الإلغاء؟'); if (why) { if (onVoid) await onVoid(user, r, ctx, why); else await voidRecord(user, col, r.id, why); } }}><Ban size={15} /></button>}
    </div>) }];
  const formFields = edit ? fields.filter((f) => !createOnlyFields.includes(f.name)) : fields;
  const onSubmit = async (d) => { const clean = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined)); edit ? (update ? await update(user, clean, edit, ctx) : await saveRecord(user, col, clean, edit.id)) : create ? await create(user, clean, ctx) : await saveRecord(user, col, clean); };
  return (
    <div>
      <PageHeader title={title} subtitle={subtitle}>
        {extraHeader}
        {can('create') && !noAdd && <button className="btn btn-primary" onClick={() => { setEdit(null); setOpen(true); }}><Plus size={16} />إضافة</button>}
      </PageHeader>
      {summary && summary(shown, ctx)}
      <Card className="mt-4">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
          {searchKeys.length > 0 && <div className="sm:w-64"><SearchBox value={q} onChange={setQ} /></div>}
          {filters.map((x) => <label key={x.key} className="block sm:w-48"><span className="mb-1 block text-xs font-bold text-slate-500">{x.label}</span><select className="input" value={fv[x.key] || ''} onChange={(e) => setFv({ ...fv, [x.key]: e.target.value })}><option value="">{x.allLabel || 'الكل'}</option>{x.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>)}
          {Object.values(fv).some(Boolean) && <button type="button" className="btn btn-ghost !py-2 text-xs" onClick={() => setFv({})}>مسح الفلاتر</button>}
        </div>
        {loading ? <div className="p-6 text-center text-slate-400">جارٍ التحميل…</div> :
          <Table columns={columns} rows={shown} empty={<Empty title="لا توجد سجلات بعد" hint={emptyHint || 'ابدأ بإضافة أول سجل حقيقي.'}>{can('create') && !noAdd && <button className="btn btn-primary mt-2" onClick={() => { setEdit(null); setOpen(true); }}><Plus size={16} />إضافة أول سجل</button>}</Empty>} />}
      </Card>
      <FormModal open={open && !(noAdd && !edit)} onClose={() => setOpen(false)} title={edit ? 'تعديل' : 'إضافة'} fields={formFields}
        defaults={edit ? Object.fromEntries(formFields.map((f) => [f.name, edit[f.name] ?? ''])) : Object.fromEntries(formFields.map((f) => [f.name, defaults[f.name] ?? (f.type === 'date' ? today() : f.default ?? '')]))}
        onSubmit={onSubmit} />
    </div>
  );
}
