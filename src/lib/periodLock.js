// قفل الفترات: بعد اعتماد تسوية تُقفل فترتها فلا يُضاف أو يُعدَّل أو يُلغى فيها سجل (إلا بفتحها من مدير النظام).
export const isLocked = (date, lockedThrough) => !!lockedThrough && !!date && String(date).slice(0, 10) <= String(lockedThrough).slice(0, 10);
export const laterDate = (a, b) => (!a ? b || '' : !b ? a : String(a) >= String(b) ? a : b);
const DATE_FIELDS = ['date', 'disbursementDate'];
// سجلات غير مالية أو مرجعية: لا تُقفل (الإنتاج، بيانات التسمين، الحسابات والأشخاص، الجرد، الإعدادات…)
const EXEMPT = new Set(['settings', 'users', 'auditLogs', 'settlements', 'cashAccounts', 'partners', 'customers', 'stockItems', 'animals', 'milkProduction', 'calfLogs', 'cashCounts']);
export const LOCK_MSG = (d) => `الفترة حتى ${d} مقفلة بعد اعتماد التسوية: لا يمكن إضافة أو تعديل أو إلغاء سجل بتاريخ داخلها. اطلب من مدير النظام فتح الفترة.`;
/** يفحص عمليات كتابة (قبل تنفيذها). getExisting(col,id) يعيد السجل الحالي إن كان محملاً. → رسالة عربية أو null */
export function lockViolation(ops = [], lockedThrough, getExisting = () => null) {
  if (!lockedThrough) return null;
  for (const o of ops) {
    if (EXEMPT.has(o.col)) continue;
    const ex = o.id ? getExisting(o.col, o.id) : null; const dates = [];
    for (const f of DATE_FIELDS) { if (ex?.[f]) dates.push(ex[f]); if (o.data?.[f]) dates.push(o.data[f]); }
    if (dates.some((d) => isLocked(d, lockedThrough))) return LOCK_MSG(lockedThrough);
  }
  return null;
}
