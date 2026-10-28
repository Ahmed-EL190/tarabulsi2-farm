import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import { doc, onSnapshot, writeBatch, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { can } from '../lib/permissions';

const Ctx = createContext(null);
export const useAuth = () => useContext(Ctx);

export function AuthProvider({ children }) {
  const [fbUser, setFbUser] = useState(undefined);
  const [profile, setProfile] = useState(undefined);
  useEffect(() => onAuthStateChanged(auth, (u) => { setFbUser(u); if (!u) setProfile(null); }), []);
  useEffect(() => {
    if (!fbUser) return;
    return onSnapshot(doc(db, 'users', fbUser.uid), (s) => setProfile(s.exists() ? s.data() : null), () => setProfile(null));
  }, [fbUser]);
  const loading = fbUser === undefined || (fbUser && profile === undefined);
  const user = fbUser && profile ? { uid: fbUser.uid, email: fbUser.email, name: profile.name, role: profile.role, active: profile.active !== false } : null;
  const value = {
    user, fbUser, loading, hasProfile: !!profile,
    can: (a) => !!user && user.active && can(user.role, a),
    login: (email, pw) => signInWithEmailAndPassword(auth, email, pw),
    logout: () => signOut(auth),
    /** First-run bootstrap: creates the first admin. Firestore rules allow this ONLY while settings/bootstrap does not exist. */
    bootstrapAdmin: async (name, email, pw) => {
      const cred = await createUserWithEmailAndPassword(auth, email, pw);
      const b = writeBatch(db);
      b.set(doc(db, 'settings', 'bootstrap'), { at: serverTimestamp(), by: cred.user.uid });
      b.set(doc(db, 'users', cred.user.uid), { name, email, role: 'admin', active: true, createdAt: serverTimestamp() });
      await b.commit();
    },
  };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
