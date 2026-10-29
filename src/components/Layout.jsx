import { NavLink, Outlet } from 'react-router-dom';
import { useState, useEffect, Suspense } from 'react';
import { Download, Share } from 'lucide-react';
import { Home, Milk, ShoppingCart, Users, Landmark, Receipt, UserRoundCog, HandCoins, Scale, PawPrint, Baby, ArrowLeftRight, Wheat, FileText, ShieldCheck, Settings, History, Bell, Menu, Globe, UserCircle2, LogOut } from 'lucide-react';
import { CowLogo } from './ui';
import { useAuth } from '../data/auth';
import { useSettings } from '../data/db';

export const NAV = [
  ['/', 'الرئيسية', Home], ['/production', 'إنتاج الحليب', Milk], ['/milk-sales', 'مبيعات الحليب', ShoppingCart],
  ['/customers', 'العملاء والديون المدينة', Users], ['/cash', 'الصندوق والحسابات', Landmark], ['/expenses', 'المصروفات', Receipt],
  ['/partners', 'الشركاء', UserRoundCog], ['/loans', 'قروض وتمويل الشركاء', HandCoins], ['/settlements', 'تسويات وتوزيع الأرباح', Scale],
  ['/animals', 'المواشي والعجول', PawPrint], ['/animal-events', 'المواليد والوفيات والمشتريات', Baby], ['/exchange', 'تبادل ونقل المواشي', ArrowLeftRight],
  ['/inventory', 'الأعلاف والمخزون', Wheat], ['/reports', 'التقارير', FileText], ['/users', 'المستخدمون والصلاحيات', ShieldCheck],
  ['/settings', 'الإعدادات', Settings], ['/audit', 'سجل التدقيق', History],
];
const ROLE_AR = { admin: 'مدير النظام', accountant: 'محاسب', data_entry: 'مدخل بيانات', viewer: 'مشاهد' };

export default function Layout() {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  useEffect(() => { document.body.style.overflow = open ? 'hidden' : ''; return () => { document.body.style.overflow = ''; }; }, [open]);
  const { farmName } = useSettings();
  const side = (
    <aside className="flex h-full w-[82vw] max-w-72 flex-col lg:w-72 bg-gradient-to-b from-forest-900 to-forest-950 text-white">
      <div className="flex items-center gap-3 px-5 py-5"><CowLogo /><div><div className="text-lg font-extrabold leading-tight">{farmName}</div><div className="text-xs text-emerald-300">إنتاج الحليب … جودة … استدامة</div></div></div>
      <nav className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {NAV.map(([to, label, Icon]) => (
          <NavLink key={to} to={to} end={to === '/'} onClick={() => setOpen(false)}
            className={({ isActive }) => `flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${isActive ? 'border-r-4 border-brand bg-white/15 text-white' : 'text-emerald-50/80 hover:bg-white/10'}`}>
            <Icon size={19} />{label}
          </NavLink>
        ))}
      </nav>
      <div className="m-4 rounded-xl border border-white/20 p-4 text-center text-sm text-emerald-100">معاً نحو مزرعة أكثر إنتاجية</div>
    </aside>
  );
  return (
    <div className="flex h-dvh overflow-hidden" dir="rtl">
      <div className="hidden lg:block">{side}</div>
      {open && <div className="fixed inset-0 z-40 flex lg:hidden"><div className="h-full shadow-2xl">{side}</div><div className="flex-1 bg-black/40" onClick={() => setOpen(false)} /></div>}
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <header className="flex items-center justify-between gap-2 border-b border-slate-100 bg-white px-3 py-2.5 pt-[max(0.625rem,env(safe-area-inset-top))] sm:px-4 sm:py-3">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة"><Menu /></button>
          <div className="min-w-0 flex-1 truncate text-sm font-extrabold text-forest-800 lg:hidden">{farmName}</div><div className="hidden lg:block" />
          <div className="flex min-w-0 items-center gap-1.5 sm:gap-4"><InstallButton />
            <button className="relative rounded-full p-2 hover:bg-slate-100" aria-label="الإشعارات"><Bell size={20} /></button>
            <div className="hidden items-center gap-1 rounded-lg border px-3 py-1.5 text-sm sm:flex"><Globe size={16} />العربية</div>
            <div className="flex min-w-0 items-center gap-2"><UserCircle2 size={32} className="shrink-0 text-forest-800" /><div className="min-w-0 text-sm leading-tight"><div className="max-w-[110px] truncate font-bold sm:max-w-none">{user?.name}</div><div className="text-xs text-slate-500">{ROLE_AR[user?.role]}</div></div></div>
            <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="تسجيل الخروج"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-4 lg:p-6"><Suspense fallback={<div className="grid place-items-center py-20 text-slate-400">جارٍ التحميل…</div>}><Outlet /></Suspense></main>
      </div>
    </div>
  );
}

/** زر "تثبيت التطبيق": أندرويد/كروم يثبّت بضغطة، والآيفون يعرض خطوات الإضافة للشاشة الرئيسية. */
function InstallButton() {
  const [ev, setEv] = useState(null); const [help, setHelp] = useState(false);
  const standalone = typeof window !== 'undefined' && (window.matchMedia?.('(display-mode: standalone)').matches || window.navigator.standalone);
  const ios = typeof navigator !== 'undefined' && /iphone|ipad|ipod/i.test(navigator.userAgent);
  useEffect(() => { const h = (e) => { e.preventDefault(); setEv(e); }; window.addEventListener('beforeinstallprompt', h); window.addEventListener('appinstalled', () => setEv(null)); return () => window.removeEventListener('beforeinstallprompt', h); }, []);
  if (standalone || (!ev && !ios)) return null;
  return (<>
    <button className="btn btn-ghost !px-2.5 !py-1.5 text-xs" onClick={async () => { if (ev) { ev.prompt(); await ev.userChoice; setEv(null); } else setHelp(true); }}><Download size={15} /><span className="hidden sm:inline">تثبيت التطبيق</span><span className="sm:hidden">تثبيت</span></button>
    {help && <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 sm:items-center" onClick={() => setHelp(false)}><div className="w-full max-w-sm rounded-t-2xl bg-white p-5 text-sm sm:rounded-2xl" onClick={(e) => e.stopPropagation()}>
      <div className="mb-2 text-base font-extrabold">تثبيت التطبيق على الآيفون</div>
      <ol className="list-decimal space-y-2 pr-5 leading-relaxed"><li>افتح الموقع من متصفح <b>Safari</b>.</li><li>اضغط زر المشاركة <Share size={14} className="inline" /> في أسفل الشاشة.</li><li>اختر <b>«إضافة إلى الشاشة الرئيسية»</b> ثم <b>إضافة</b>.</li></ol>
      <button className="btn btn-primary mt-4 w-full" onClick={() => setHelp(false)}>تمام</button></div></div>}
  </>);
}
