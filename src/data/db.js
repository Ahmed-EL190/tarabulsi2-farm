import { useEffect, useState } from 'react';
import { collection, doc, onSnapshot, writeBatch, runTransaction, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';

/** Live collection hook. Returns { rows, loading }. Rows include id. */
export function useCol(name) {
  const [state, set] = useState({ rows: [], loading: true });
  useEffect(() => {
    if (!db) return;
    return onSnapshot(collection(db, name), (s) => set({ rows: s.docs.map((d) => ({ id: d.id, ...d.data() })), loading: false }), () => set({ rows: [], loading: false }));
  }, [name]);
  return state;
}
export function useAudit(max = 300) {
  const [rows, set] = useState([]);
  useEffect(() => {
    if (!db) return;
    return onSnapshot(query(collection(db, 'auditLogs'), orderBy('at', 'desc'), limit(max)), (s) => set(s.docs.map((d) => ({ id: d.id, ...d.data() }))));
  }, [max]);
  return rows;
}
export function useSettings() {
  const { rows } = useCol('settings');
  const s = rows.find((r) => r.id === 'main') || {};
  return { farmName: 'مزرعة آل الطرابلسي', currencies: ['SYP', 'USD'], baseCurrency: 'SYP', animalPurchaseAsExpense: true, ...s };
}

export const newId = (col) => doc(collection(db, col)).id;
const stamp = (user, extra = {}) => ({ ...extra, updatedAt: serverTimestamp(), updatedBy: user?.uid || null });
function audit(batch, user, action, col, id, data) {
  batch.set(doc(collection(db, 'auditLogs')), { at: serverTimestamp(), uid: user?.uid || null, userName: user?.name || user?.email || '', action, collection: col, docId: id, summary: JSON.stringify(data || {}).slice(0, 900) });
}

/** Write several docs atomically, with one audit entry each. ops: [{col,id?,data,merge?}] */
export async function commit(user, ops, action = 'create') {
  const b = writeBatch(db);
  const ids = [];
  for (const o of ops) {
    const id = o.id || newId(o.col);
    const base = o.id && o.merge ? stamp(user) : stamp(user, { createdAt: serverTimestamp(), createdBy: user?.uid || null });
    b.set(doc(db, o.col, id), { ...base, ...o.data }, { merge: !!o.merge });
    audit(b, user, o.action || action, o.col, id, o.data);
    ids.push(id);
  }
  await b.commit();
  return ids;
}
export const saveRecord = (user, col, data, id) => commit(user, [{ col, id, data, merge: !!id }], id ? 'update' : 'create').then((x) => x[0]);
/** Financial records are never hard-deleted by non-admins: they are voided (kept for audit). */
export const voidRecord = (user, col, id, reason = '') => commit(user, [{ col, id, merge: true, data: { voided: true, voidReason: reason, voidedAt: serverTimestamp() }, action: 'void' }]);
export async function deleteRecord(user, col, id) {
  const b = writeBatch(db); b.delete(doc(db, col, id)); audit(b, user, 'delete', col, id, {}); await b.commit();
}
/** Sequential human numbers (agreement numbers etc.) via a transaction on settings/counters. */
export async function nextNumber(key, prefix) {
  const ref = doc(db, 'settings', 'counters');
  const n = await runTransaction(db, async (tx) => {
    const s = await tx.get(ref); const cur = (s.exists() ? s.data()[key] : 0) || 0;
    tx.set(ref, { [key]: cur + 1 }, { merge: true }); return cur + 1;
  });
  return `${prefix}-${String(n).padStart(5, '0')}`;
}
/** Unique animal tag: document id = normalised tag, created in a transaction (prevents duplicates even under races). */
export async function createAnimal(user, data) {
  const tag = String(data.tag).trim();
  const id = tag.toLowerCase().replace(/[\s/\\'"]/g, '_');
  const ref = doc(db, 'animals', id);
  await runTransaction(db, async (tx) => {
    if ((await tx.get(ref)).exists()) throw new Error('DUPLICATE_TAG');
    tx.set(ref, { ...data, tag, createdAt: serverTimestamp(), createdBy: user?.uid || null });
    tx.set(doc(collection(db, 'auditLogs')), { at: serverTimestamp(), uid: user?.uid, userName: user?.name || user?.email || '', action: 'create', collection: 'animals', docId: id, summary: tag });
  });
  return id;
}
