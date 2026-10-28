import { lazy } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './data/auth';
import { firebaseConfigured } from './lib/firebase';
import Layout from './components/Layout';
import Login from './pages/Login';

// كل صفحة تُحمَّل عند فتحها فقط (التحميل الأول أخف بكثير على الموبايل)
const page = (loader, name) => lazy(() => loader().then((m) => ({ default: name ? m[name] : m.default })));
const Dashboard = page(() => import('./pages/Dashboard'));
const MilkSales = page(() => import('./pages/MilkSales'));
const Reports = page(() => import('./pages/Reports'));
const Cash = page(() => import('./pages/Finance'), 'Cash');
const Expenses = page(() => import('./pages/Finance'), 'Expenses');
const Loans = page(() => import('./pages/Finance'), 'Loans');
const Settlements = page(() => import('./pages/Finance'), 'Settlements');
const Production = page(() => import('./pages/modules'), 'Production');
const Customers = page(() => import('./pages/modules'), 'Customers');
const Partners = page(() => import('./pages/modules'), 'Partners');
const Animals = page(() => import('./pages/modules'), 'Animals');
const AnimalEvents = page(() => import('./pages/modules'), 'AnimalEvents');
const Exchange = page(() => import('./pages/modules'), 'Exchange');
const Inventory = page(() => import('./pages/modules'), 'Inventory');
const Users = page(() => import('./pages/Admin'), 'Users');
const Settings = page(() => import('./pages/Admin'), 'Settings');
const Audit = page(() => import('./pages/Admin'), 'Audit');

function Gate() {
  const { user, loading } = useAuth();
  if (loading) return <div className="grid h-full place-items-center text-slate-500">جارٍ التحميل…</div>;
  if (!user) return <Login />;
  if (!user.active) return <div className="grid h-full place-items-center text-slate-600">حسابك موقوف. تواصل مع المدير.</div>;
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<Dashboard />} />
        <Route path="production" element={<Production />} />
        <Route path="milk-sales" element={<MilkSales />} />
        <Route path="customers" element={<Customers />} />
        <Route path="cash" element={<Cash />} />
        <Route path="expenses" element={<Expenses />} />
        <Route path="partners" element={<Partners />} />
        <Route path="loans" element={<Loans />} />
        <Route path="settlements" element={<Settlements />} />
        <Route path="animals" element={<Animals />} />
        <Route path="animal-events" element={<AnimalEvents />} />
        <Route path="exchange" element={<Exchange />} />
        <Route path="inventory" element={<Inventory />} />
        <Route path="reports" element={<Reports />} />
        <Route path="users" element={<Users />} />
        <Route path="settings" element={<Settings />} />
        <Route path="audit" element={<Audit />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
export default function App() {
  if (!firebaseConfigured) return (
    <div dir="rtl" className="grid h-full place-items-center p-6"><div className="max-w-md rounded-2xl bg-white p-6 text-center shadow-card"><h1 className="mb-2 text-xl font-extrabold">إعداد Firebase مطلوب</h1><p className="text-sm text-slate-600">انسخ <code>.env.example</code> إلى <code>.env</code> وأدخل مفاتيح مشروع Firebase، ثم أعد تشغيل <code>npm run dev</code>. التفاصيل في README.md.</p></div></div>
  );
  return <AuthProvider><Gate /></AuthProvider>;
}
