import { Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './data/auth';
import { firebaseConfigured } from './lib/firebase';
import Layout from './components/Layout';
import Login from './pages/Login';
import Dashboard from './pages/Dashboard';
import MilkSales from './pages/MilkSales';
import Reports from './pages/Reports';
import { Cash, Expenses, Loans, Settlements } from './pages/Finance';
import { Production, Customers, Partners, Animals, AnimalEvents, Exchange, Inventory } from './pages/modules';
import { Users, Settings, Audit } from './pages/Admin';

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
