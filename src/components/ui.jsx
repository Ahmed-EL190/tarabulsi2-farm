import { X, Inbox, Search } from 'lucide-react';
import { useEffect, Children } from 'react';

export const fmt = (v, d = 2) => new Intl.NumberFormat('en-US', { maximumFractionDigits: d }).format(Number(v) || 0);
export const money = (v, cur = 'SYP') => `${fmt(v)} ${cur === 'SYP' ? 'ل.س' : cur === 'USD' ? '$' : cur}`;
export const today = () => new Date().toISOString().slice(0, 10);
export const CUR_LABEL = { SYP: 'ل.س', USD: '$' };

export function Card({ title, icon: Icon, action, children, className = '' }) {
  return (
    <section className={`rounded-2xl border border-slate-100 bg-white p-3 shadow-card sm:p-4 ${className}`}>
      {(title || action) && (
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="flex min-w-0 items-center gap-2 text-sm font-extrabold text-slate-800 sm:text-base">{Icon && <Icon size={18} className="text-brand" />}{title}</h3>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
const TONES = { green: 'bg-emerald-50 text-emerald-600', blue: 'bg-sky-50 text-sky-600', amber: 'bg-amber-50 text-amber-600', red: 'bg-rose-50 text-rose-600', purple: 'bg-violet-50 text-violet-600' };
export function Stat({ label, value, sub, icon: Icon, tone = 'green', className = '' }) {
  return (
    <div className={`min-w-0 rounded-2xl border border-slate-100 bg-white p-3 shadow-card sm:p-4 ${className}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 text-xs font-bold leading-snug text-slate-500 sm:text-sm">{label}</span>
        {Icon && <span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full sm:h-10 sm:w-10 ${TONES[tone]}`}><Icon size={18} /></span>}
      </div>
      <div className="mt-2 break-words text-xl font-extrabold text-slate-900 sm:text-2xl">{value}</div>
      {sub && <div className="mt-1 text-xs text-slate-500">{sub}</div>}
    </div>
  );
}
const BADGE = { green: 'bg-emerald-50 text-emerald-700', amber: 'bg-amber-50 text-amber-700', red: 'bg-rose-50 text-rose-700', blue: 'bg-sky-50 text-sky-700', gray: 'bg-slate-100 text-slate-600' };
export const Badge = ({ tone = 'gray', children }) => <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGE[tone]}`}>{children}</span>;

export function Empty({ title = 'لا توجد بيانات بعد', hint, children }) {
  return (
    <div className="grid place-items-center gap-2 px-4 py-10 text-center text-slate-500">
      <Inbox size={36} className="text-slate-300" />
      <div className="font-bold text-slate-600">{title}</div>
      {hint && <div className="text-sm">{hint}</div>}
      {children}
    </div>
  );
}
export function PageHeader({ title, subtitle, children }) {
  return (
    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
      <div className="min-w-0"><h1 className="text-xl font-extrabold text-slate-900 sm:text-2xl">{title}</h1>{subtitle && <p className="text-xs text-slate-500 sm:text-sm">{subtitle}</p>}</div>
      <div className="flex flex-wrap gap-2 [&>.btn]:flex-1 sm:[&>.btn]:flex-none">{children}</div>
    </div>
  );
}
export function Modal({ open, onClose, title, children, wide }) {
  useEffect(() => { const f = (e) => e.key === 'Escape' && onClose(); if (open) window.addEventListener('keydown', f); return () => window.removeEventListener('keydown', f); }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center sm:p-3" onMouseDown={onClose}>
      <div className={`max-h-[92dvh] w-full overflow-x-hidden overflow-y-auto overscroll-contain rounded-t-2xl bg-white p-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-2xl sm:rounded-2xl sm:p-5 ${wide ? 'sm:max-w-3xl' : 'sm:max-w-lg'}`} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sticky -top-4 z-10 mb-3 flex items-center justify-between gap-2 bg-white pb-2 sm:static sm:mb-4 sm:pb-0"><h2 className="min-w-0 text-base font-extrabold sm:text-lg">{title}</h2><button className="shrink-0 rounded-lg p-2 hover:bg-slate-100" onClick={onClose} aria-label="إغلاق"><X size={20} /></button></div>
        {children}
      </div>
    </div>
  );
}
export function SearchBox({ value, onChange, placeholder = 'بحث...' }) {
  return <div className="relative"><Search size={16} className="pointer-events-none absolute right-3 top-2.5 text-slate-400" /><input className="input pr-9" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} /></div>;
}
/** Simple table. columns: [{key,label,render?,align?}]
 * Desktop (md+): normal table. Mobile: each row becomes a card (label : value) so nothing needs sideways scrolling. */
const hasContent = (n) => n !== undefined && n !== null && n !== '' && n !== false;
export function Table({ columns, rows, empty, footer, onRow }) {
  if (!rows.length) return empty || <Empty />;
  const cols = columns.filter((c) => (c.label !== '' || c.key === '_a') && !c.hideMobile);
  const allVis = columns.filter((c) => c.label !== '' || c.key === '_a');
  const footCells = footer && footer.props ? Children.toArray(footer.props.children) : [];
  return (
    <>
      {/* ---- mobile cards ---- */}
      <div className="space-y-2.5 md:hidden">
        {rows.map((r, i) => (
          <div key={r.id || i} onClick={onRow ? () => onRow(r) : undefined} className={`rounded-xl border border-slate-100 bg-slate-50/50 p-3 ${onRow ? 'cursor-pointer active:bg-slate-100' : ''}`}>
            {cols.filter((c) => c.key !== '_a').map((c) => (
              <div key={c.key} className="flex items-start justify-between gap-3 border-b border-slate-100 py-1.5 text-sm last:border-0">
                <span className="shrink-0 text-xs font-bold text-slate-500">{c.label}</span>
                <span className="min-w-0 break-words text-left font-medium text-slate-800" dir="auto">{c.render ? c.render(r) : r[c.key] ?? '—'}</span>
              </div>
            ))}
            {cols.find((c) => c.key === '_a') && <div className="mt-1 flex justify-end border-t border-slate-100 pt-2" onClick={(e) => e.stopPropagation()}>{cols.find((c) => c.key === '_a').render(r)}</div>}
          </div>
        ))}
        {footCells.length > 0 && (
          <div className="rounded-xl border-2 border-slate-200 bg-slate-100 p-3 text-sm font-extrabold">
            {(() => { let ci = 0; const vis = allVis.filter((c) => c.key !== '_a'); return footCells.map((td, i) => {
              const content = td.props?.children; const label = vis[ci]?.label; ci += Number(td.props?.colSpan) || 1;
              if (i === 0) return <div key={i} className="mb-1 text-base">{content}</div>;
              if (!hasContent(content)) return null;
              return <div key={i} className="flex items-center justify-between gap-3 py-1"><span className="text-xs font-bold text-slate-500">{label}</span><span>{content}</span></div>;
            }); })()}
          </div>
        )}
      </div>
      {/* ---- desktop table ---- */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[600px] text-sm">
          <thead><tr className="bg-slate-50 text-slate-500">{columns.map((c) => <th key={c.key} className="px-3 py-2.5 text-right font-bold">{c.label}</th>)}</tr></thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.id || i} onClick={onRow ? () => onRow(r) : undefined} className={`border-t border-slate-100 ${onRow ? 'cursor-pointer hover:bg-slate-50' : ''}`}>
                {columns.map((c) => <td key={c.key} className="px-3 py-2.5">{c.render ? c.render(r) : r[c.key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
          {footer && <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-extrabold">{footer}</tfoot>}
        </table>
      </div>
    </>
  );
}
export function Field({ label, error, children }) {
  return <label className="block"><span className="mb-1 block text-sm font-bold text-slate-600">{label}</span>{children}{error && <span className="mt-1 block text-xs text-red-600">{error}</span>}</label>;
}
export function Toast({ msg, tone = 'red' }) { return msg ? <div className={`mb-3 rounded-lg px-3 py-2 text-sm font-bold ${tone === 'red' ? 'bg-red-50 text-red-700' : 'bg-emerald-50 text-emerald-700'}`}>{msg}</div> : null; }
export function CowLogo({ size = 44 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" fill="none" aria-label="شعار المزرعة">
      <circle cx="32" cy="32" r="30" stroke="#7fe0b3" strokeWidth="2" />
      <path d="M14 22c-4-2-6 2-3 5 2 2 5 1 6 0M50 22c4-2 6 2 3 5-2 2-5 1-6 0" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
      <path d="M20 18c3-4 21-4 24 0l3 12c1 8-6 17-15 17s-16-9-15-17z" fill="#fff" />
      <ellipse cx="32" cy="40" rx="9" ry="7" fill="#7fe0b3" /><circle cx="29" cy="40" r="1.4" fill="#0f3a28" /><circle cx="35" cy="40" r="1.4" fill="#0f3a28" />
      <circle cx="25" cy="29" r="2" fill="#0f3a28" /><circle cx="39" cy="29" r="2" fill="#0f3a28" />
      <path d="M21 17c-1-4-4-6-6-6M43 17c1-4 4-6 6-6" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}
