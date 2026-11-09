import { setCustomLists } from '../lib/constants';
import { animalIdFromTag } from '../lib/finance';
import { useEffect, useState, useCallback, useSyncExternalStore } from 'react';
import { collection, doc, onSnapshot, writeBatch, runTransaction, serverTimestamp, query, orderBy, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';

// ───────────── مخزن بيانات مشترك ─────────────
// كل جدول يُشترك فيه مرة واحدة فقط لكل الجلسة (بدل اشتراك لكل مكوّن/صفحة)، ويبقى الاشتراك حيّاً 10 دقائق بعد مغادرة الصفحة،
// ويُحدَّث فقط ما تغيّر (docChanges) فتبقى مراجع السجلات ثابتة. مع التخزين المحلي الدائم يصبح فتح الصفحات فورياً.
const EMPTY = Object.freeze([]);
const store = new Map();
const statusSubs = new Set(); let statusSnap = { loading: 0, syncing: false };
const calcStatus = () => {
  let loading = 0, syncing = false;
  for (const c of store.values()) { if (c.snap.loading) loading++; else if (c.fromCache) syncing = true; }
  if (loading !== statusSnap.loading || syncing !== statusSnap.syncing) { statusSnap = { loading, syncing }; statusSubs.forEach((f) => f()); }
};
function ensure(name) {
  let c = store.get(name); if (c) return c;
  c = { map: new Map(), snap: { rows: EMPTY, loading: !!db }, subs: new Set(), unsub: null, timer: null, fromCache: false, first: true };
  store.set(name, c); queueMicrotask(calcStatus); // لا نُخطر المكوّنات أثناء الرسم
  if (!db) return c;
  const sorted = () => Array.from(c.map.values()).sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));
  c.unsub = onSnapshot(collection(db, name), { includeMetadataChanges: true }, (s) => {
    let changed = false;
    if (c.first) { s.docs.forEach((d) => c.map.set(d.id, { id: d.id, ...d.data() })); changed = true; }
    else s.docChanges().forEach((ch) => { changed = true; if (ch.type === 'removed') c.map.delete(ch.doc.id); else c.map.set(ch.doc.id, { id: ch.doc.id, ...ch.doc.data() }); });
    const fc = s.metadata.fromCache; const fcChanged = fc !== c.fromCache; c.fromCache = fc;
    if (changed) { c.first = false; c.snap = { rows: sorted(), loading: false }; }
    if (changed || fcChanged) { c.subs.forEach((f) => f()); calcStatus(); }
  }, () => { c.first = false; c.snap = { rows: EMPTY, loading: false }; c.subs.forEach((f) => f()); calcStatus(); });
  return c;
}
export const _store = { ensure, status: () => statusSnap }; // للاختبارات
/** Live collection hook. Returns { rows, loading }. Rows include id. (مشترك بين كل المكوّنات) */
export function useCol(name) {
  const c = ensure(name);
  const subscribe = useCallback((cb) => {
    c.subs.add(cb); clearTimeout(c.timer);
    return () => { c.subs.delete(cb); if (!c.subs.size) c.timer = setTimeout(() => { if (!c.subs.size) { c.unsub?.(); if (store.get(name) === c) store.delete(name); calcStatus(); } }, 10 * 60 * 1000); };
  }, [c, name]);
  return useSyncExternalStore(subscribe, () => c.snap, () => c.snap);
}
/** يُستدعى عند تسجيل الدخول/الخروج: يغلق كل الاشتراكات لتبدأ من جديد بصلاحيات المستخدم الجديد. */
export function resetStore() { for (const c of store.values()) { clearTimeout(c.timer); c.unsub?.(); } store.clear(); statusSnap = { loading: 0, syncing: false }; statusSubs.forEach((f) => f()); }
/** حالة التحميل العامة: عدد الجداول التي لم تصل بعد، وهل البيانات المعروضة من التخزين المحلي بانتظار تأكيد الخادم. */
export function useStoreStatus() { return useSyncExternalStore((cb) => { statusSubs.add(cb); return () => statusSubs.delete(cb); }, () => statusSnap, () => statusSnap); }
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

/** القوائم المخصّصة (فئات مصروفات/حيوانات) — تُخزَّن في settings/counters (يكتبها كل من يملك صلاحية الإضافة). */
export function useCustomLists() {
  const { rows } = useCol('settings'); const c = rows.find((r) => r.id === 'counters') || {};
  const lists = { expense: c.customExpenseCats || [], animal: c.customAnimalCats || [] };
  setCustomLists(lists); return lists;
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
  const base = animalIdFromTag(tag);
  let id = base;
  await runTransaction(db, async (tx) => {
    // رقم محذوف (ملغى) سابقاً يمكن إعادة استخدامه: يأخذ الحيوان الجديد معرّفاً جديداً ويبقى القديم في السجل بتاريخه
    id = null;
    for (let i = 1; i <= 30 && !id; i++) {
      const cand = i === 1 ? base : `${base}__${i}`; const snap = await tx.get(doc(db, 'animals', cand));
      if (!snap.exists()) id = cand; else if (!snap.data().voided) throw new Error(`DUPLICATE_TAG:${snap.data().tag || tag}`);
    }
    if (!id) throw new Error('تعذّر إنشاء معرّف للحيوان');
    tx.set(doc(db, 'animals', id), { ...data, tag, createdAt: serverTimestamp(), createdBy: user?.uid || null });
    tx.set(doc(collection(db, 'auditLogs')), { at: serverTimestamp(), uid: user?.uid, userName: user?.name || user?.email || '', action: 'create', collection: 'animals', docId: id, summary: tag });
  });
  return id;
}
