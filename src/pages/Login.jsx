import { useState } from 'react';
import { CowLogo, Toast } from '../components/ui';
import { useAuth } from '../data/auth';

export default function Login() {
  const { login, bootstrapAdmin, fbUser, hasProfile, logout } = useAuth();
  const [mode, setMode] = useState('login');
  const [f, setF] = useState({ name: '', email: '', pw: '' });
  const [err, setErr] = useState(''); const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(''); setBusy(true);
    try { mode === 'login' ? await login(f.email, f.pw) : await bootstrapAdmin(f.name, f.email, f.pw); }
    catch (x) { setErr(mode === 'setup' ? 'تعذّر الإعداد الأول: ربما تم إنشاء مدير مسبقاً. اطلب من المدير إنشاء حسابك.' : 'بيانات الدخول غير صحيحة'); }
    setBusy(false);
  };
  return (
    <div className="grid min-h-full place-items-center overflow-y-auto bg-gradient-to-br from-forest-950 to-forest-800 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]" dir="rtl">
      <form onSubmit={submit} className="w-full max-w-sm space-y-3 rounded-2xl bg-white p-6 shadow-2xl">
        <div className="flex flex-col items-center gap-1 rounded-xl bg-forest-900 p-4 text-white"><CowLogo size={56} /><div className="text-xl font-extrabold">مزرعة آل الطرابلسي</div></div>
        {fbUser && !hasProfile && <Toast msg="حسابك غير مفعّل بعد. اطلب من المدير تفعيل صلاحياتك." />}
        <Toast msg={err} />
        {mode === 'setup' && <input className="input" placeholder="الاسم" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required />}
        <input className="input" type="email" dir="ltr" placeholder="البريد الإلكتروني" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} required />
        <input className="input" type="password" dir="ltr" placeholder="كلمة المرور" minLength={6} value={f.pw} onChange={(e) => setF({ ...f, pw: e.target.value })} required />
        <button className="btn btn-primary w-full" disabled={busy}>{mode === 'login' ? 'تسجيل الدخول' : 'إنشاء المدير الأول'}</button>
        <button type="button" className="w-full text-xs text-slate-500 underline" onClick={() => setMode(mode === 'login' ? 'setup' : 'login')}>{mode === 'login' ? 'أول تشغيل؟ إعداد المدير الأول' : 'العودة لتسجيل الدخول'}</button>
        {fbUser && <button type="button" className="w-full text-xs text-slate-500 underline" onClick={logout}>تسجيل الخروج</button>}
      </form>
    </div>
  );
}
