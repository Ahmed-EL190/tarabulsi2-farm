import { useState } from 'react';
import { Search, X } from 'lucide-react';

/** Type a tag or name -> matching animals appear inline (no floating menu, so it never gets clipped on phones). */
export default function AnimalPicker({ animals, value, onChange, filter = () => true, placeholder = 'اكتب رقم الحيوان أو اسمه…', autoFocus = false }) {
  const [q, setQ] = useState('');
  const sel = animals.find((a) => a.id === value);
  if (sel) return (
    <div className="flex items-center justify-between rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm">
      <span><b>{sel.tag}</b> {sel.name} <span className="text-xs text-slate-500">{sel.breed || ''}</span></span>
      <button type="button" className="rounded p-1 hover:bg-white" onClick={() => { onChange(null); setQ(''); }} aria-label="تغيير"><X size={14} /></button>
    </div>
  );
  const t = q.trim().toLowerCase();
  const list = t ? animals.filter((a) => filter(a) && `${a.tag} ${a.name || ''}`.toLowerCase().includes(t)).slice(0, 6) : [];
  return (
    <div>
      <div className="relative"><Search size={16} className="pointer-events-none absolute right-3 top-2.5 text-slate-400" /><input className="input pr-9" autoFocus={autoFocus} placeholder={placeholder} value={q} onChange={(e) => setQ(e.target.value)} /></div>
      {list.length > 0 && <div className="mt-1 overflow-hidden rounded-lg border bg-white">{list.map((a) => <button key={a.id} type="button" className="block w-full border-b px-3 py-2 text-right text-sm last:border-0 hover:bg-emerald-50" onClick={() => onChange(a.id)}><b>{a.tag}</b> {a.name} <span className="text-xs text-slate-500">{a.breed || ''}</span></button>)}</div>}
      {t && list.length === 0 && <div className="mt-1 text-xs text-slate-500">لا يوجد حيوان مطابق</div>}
    </div>
  );
}
