import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Pencil, Ban } from 'lucide-react';
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
export function FieldInput({ f, register, errors, setValue, getValues }) {
  const reg = register(f.name);
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
export default function CrudPage({ title, subtitle, col, fields, cols, defaults = {}, searchKeys = [], create, useCtx, summary, rowActions, emptyHint, filter, noEdit, extraHeader, createOnlyFields = [], noAdd, update }) {
  const { user, can } = useAuth();
  const { rows, loading } = useCol(col);
  const ctx = useCtx ? useCtx() : {};
  const [q, setQ] = useState(''); const [edit, setEdit] = useState(null); const [open, setOpen] = useState(false);
  const shown = useMemo(() => rows.filter((r) => !r.voided && (!filter || filter(r)) && (!q || searchKeys.some((k) => String(r[k] ?? '').toLowerCase().includes(q.toLowerCase()))))
    .sort((a, b) => String(b.date || b.createdAt?.seconds || '').localeCompare(String(a.date || a.createdAt?.seconds || ''))), [rows, q, filter, searchKeys]);
  const columns = [...cols(ctx, rows), { key: '_a', label: '', render: (r) => (
    <div className="flex gap-1">
      {rowActions?.(r, ctx)}
      {can('update') && !noEdit && <button className="rounded p-1.5 hover:bg-slate-100" title="تعديل" onClick={() => { setEdit(r); setOpen(true); }}><Pencil size={15} /></button>}
      {can('voidFinancial') && <button className="rounded p-1.5 text-rose-600 hover:bg-rose-50" title="إلغاء السجل (يبقى في سجل التدقيق)" onClick={async () => { const why = prompt('سبب الإلغاء؟'); if (why) await voidRecord(user, col, r.id, why); }}><Ban size={15} /></button>}
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
        <div className="mb-3 max-w-xs">{searchKeys.length > 0 && <SearchBox value={q} onChange={setQ} />}</div>
        {loading ? <div className="p-6 text-center text-slate-400">جارٍ التحميل…</div> :
          <Table columns={columns} rows={shown} empty={<Empty title="لا توجد سجلات بعد" hint={emptyHint || 'ابدأ بإضافة أول سجل حقيقي.'}>{can('create') && !noAdd && <button className="btn btn-primary mt-2" onClick={() => { setEdit(null); setOpen(true); }}><Plus size={16} />إضافة أول سجل</button>}</Empty>} />}
      </Card>
      <FormModal open={open && !(noAdd && !edit)} onClose={() => setOpen(false)} title={edit ? 'تعديل' : 'إضافة'} fields={formFields}
        defaults={edit ? Object.fromEntries(formFields.map((f) => [f.name, edit[f.name] ?? ''])) : Object.fromEntries(formFields.map((f) => [f.name, defaults[f.name] ?? (f.type === 'date' ? today() : f.default ?? '')]))}
        onSubmit={onSubmit} />
    </div>
  );
}
