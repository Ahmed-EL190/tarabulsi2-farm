import { NavLink, Outlet } from 'react-router-dom';
import { useState } from 'react';
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
  const { farmName } = useSettings();
  const side = (
    <aside className="flex h-full w-72 flex-col bg-gradient-to-b from-forest-900 to-forest-950 text-white">
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
    <div className="flex h-full" dir="rtl">
      <div className="hidden lg:block">{side}</div>
      {open && <div className="fixed inset-0 z-40 flex lg:hidden"><div className="h-full">{side}</div><div className="flex-1 bg-black/40" onClick={() => setOpen(false)} /></div>}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-100 bg-white px-4 py-3">
          <button className="rounded-lg p-2 hover:bg-slate-100 lg:hidden" onClick={() => setOpen(true)} aria-label="القائمة"><Menu /></button>
          <div className="hidden lg:block" />
          <div className="flex items-center gap-4">
            <button className="relative rounded-full p-2 hover:bg-slate-100" aria-label="الإشعارات"><Bell size={20} /></button>
            <div className="hidden items-center gap-1 rounded-lg border px-3 py-1.5 text-sm sm:flex"><Globe size={16} />العربية</div>
            <div className="flex items-center gap-2"><UserCircle2 size={34} className="text-forest-800" /><div className="text-sm leading-tight"><div className="font-bold">{user?.name}</div><div className="text-xs text-slate-500">{ROLE_AR[user?.role]}</div></div></div>
            <button onClick={logout} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100" title="تسجيل الخروج"><LogOut size={18} /></button>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-4 lg:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
