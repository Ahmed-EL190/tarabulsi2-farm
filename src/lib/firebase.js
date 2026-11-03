import { initializeApp, getApps } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

const cfg = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};
export const firebaseConfigured = Boolean(cfg.apiKey && cfg.projectId);
export const app = firebaseConfigured ? (getApps()[0] || initializeApp(cfg)) : null;
export const auth = app ? getAuth(app) : null;

/** قاعدة البيانات مع تخزين محلي دائم (IndexedDB): فتح الموقع في المرات التالية شبه فوري (البيانات المخزّنة أولاً ثم التحديث من الخادم).
 *  و«الكشف التلقائي للـ long-polling» يُسرّع الاتصال على الشبكات الضعيفة أو التي تحجب WebSocket. */
function makeDb() {
  if (!app) return null;
  try { return initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }), experimentalAutoDetectLongPolling: true }); }
  catch { return getFirestore(app); }
}
export const db = makeDb();
export const firebaseOptions = cfg;
