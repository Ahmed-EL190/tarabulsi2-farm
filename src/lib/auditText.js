// تحويل سطور سجل التدقيق الخام إلى «عمليات» بجمل عربية مفهومة.
import { LEDGER_AR, CASH_AR, catLabel } from './constants';

export const ACTION_AR = { create: 'إضافة', update: 'تعديل', void: 'إلغاء', delete: 'حذف', finalize: 'اعتماد' };
export const ACTION_TONE = { create: 'green', update: 'blue', void: 'red', delete: 'red', finalize: 'amber' };
/** المجموعة ← [اسم السجل بالعربية، المجال] */
export const COL = {
  expenses: ['مصروف', 'المصروفات'], expensePayments: ['دفعة مصروف', 'المصروفات'],
  cashTransactions: ['حركة صندوق', 'الصندوق'], cashAccounts: ['حساب صندوق', 'الصندوق'],
  customers: ['عميل / مورّد', 'العملاء والمبيعات'], customerPayments: ['دفعة عميل', 'العملاء والمبيعات'], milkSales: ['اتفاقية حليب', 'العملاء والمبيعات'], milkDeliveries: ['تسليم حليب', 'العملاء والمبيعات'], milkProduction: ['إنتاج حليب', 'العملاء والمبيعات'],
  animals: ['حيوان', 'المواشي'], animalEvents: ['حدث حيوان', 'المواشي'], calfLogs: ['سجل تسمين', 'المواشي'],
  partners: ['شريك', 'الشركاء'], partnerCapitalTransactions: ['قيد في دفتر شريك', 'الشركاء'], partnerLoans: ['سلفة شريك', 'الشركاء'], partnerLoanRepayments: ['سداد سلفة', 'الشركاء'],
  settlements: ['تسوية أرباح', 'الأرباح'], cashCounts: ['جرد صندوق', 'الصندوق'],
  stockItems: ['صنف مخزون', 'المخزون'], stockMovements: ['حركة مخزون', 'المخزون'],
  users: ['مستخدم', 'النظام'], settings: ['إعدادات الموقع', 'النظام'],
};
export const AREAS = ['المصروفات', 'الصندوق', 'العملاء والمبيعات', 'المواشي', 'الشركاء', 'الأرباح', 'المخزون', 'النظام'];
const PRIORITY = ['settlements', 'calfLogs', 'expenses', 'animalEvents', 'animals', 'customerPayments', 'milkDeliveries', 'partnerLoans', 'partnerLoanRepayments', 'partnerCapitalTransactions', 'cashTransactions', 'stockMovements', 'expensePayments'];
const EVT = { purchase: 'شراء', sale: 'بيع', birth: 'ولادة', death: 'نفوق', exchange_in: 'وارد بتبادل', exchange_out: 'خارج بتبادل', transfer_out: 'نقل خارج المزرعة', opening: 'رصيد افتتاحي' };
const CALF = { arrival_weight: 'وزن عند الوصول', weight: 'وزن', feed: 'علف', milk: 'حليب', other: 'بند آخر' };
const FIELD = { amount: 'المبلغ', date: 'التاريخ', description: 'الوصف', qty: 'الكمية', unit: 'الوحدة', tag: 'الرقم', name: 'الاسم', notes: 'ملاحظات', currency: 'العملة', value: 'القيمة', supplierName: 'المورّد', principal: 'مبلغ السلفة', phone: 'الهاتف', email: 'البريد', ownershipPct: 'نسبة الملكية %', profitSharePct: 'نسبة الأرباح %', acquisitionCost: 'سعر الشراء', breed: 'السلالة', birthDate: 'تاريخ الميلاد', from: 'من', to: 'إلى', netProfit: 'صافي الربح', pricePerLiter: 'سعر اللتر', voidReason: 'سبب الإلغاء', item: 'الصنف', itemName: 'الصنف', stockQty: 'كمية المخزون', farmName: 'اسم المزرعة', lockedThrough: 'الفترات مقفلة حتى', lockNote: 'سبب القفل', countedAmount: 'المبلغ الفعلي', systemBalance: 'رصيد النظام', difference: 'الفرق', capitalClosedFrom: 'إغلاق رأس المال من', stockCostingMode: 'طريقة حساب العلف', morning: 'صباحاً', evening: 'مساءً', dueDate: 'الاستحقاق', disbursementDate: 'تاريخ السلفة' };
const SKIP = new Set(['voided', 'voidedAt', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'updatedAt', 'eventId', 'exchangeId', 'ledgerEntryId', 'animalId', 'calfId', 'itemId', 'expenseId', 'calfLogId', 'agreementId', 'stockItemName', 'paidFrom', 'payerPartnerId', 'payers']);

/** summary قد يكون JSON مقطوعاً (أول 900 حرف): نقرأه كاملاً أو نستخرج منه الأزواج البسيطة. */
export function parseSummary(s) {
  if (!s) return {};
  try { const o = JSON.parse(s); return o && typeof o === 'object' ? o : { _text: String(o) }; } catch { /* مقطوع */ }
  const out = {}; const re = /"([A-Za-z0-9_]+)":("(?:[^"\\]|\\.)*"|-?\d+(?:\.\d+)?|true|false|null)/g; let m;
  while ((m = re.exec(s))) { try { out[m[1]] = JSON.parse(m[2]); } catch { /* تجاهل */ } }
  if (!Object.keys(out).length && !/^[{\[]/.test(s)) out._text = s;
  return out;
}
const num = (v) => Number(v).toLocaleString('en-US', { maximumFractionDigits: 2 });
const money = (v, c) => (v === undefined || v === null || v === '' || Number.isNaN(Number(v)) ? '' : `${num(v)}${c ? ` ${c}` : ''}`);
const hasT = (o) => o && o.seconds !== undefined;
export const atDate = (r) => (r?.at?.toDate ? r.at.toDate() : hasT(r?.at) ? new Date(r.at.seconds * 1000) : null);

/** وصف مختصر للسجل بجملة عربية. ctx = { partner(id), account(id), customer(id) } */
export function describeRecord(col, rec = {}, ctx = {}, docId = '') {
  const p = (id) => (id && ctx.partner ? ctx.partner(id) : '');
  const parts = (() => {
    switch (col) {
      case 'expenses': return [rec.description || (rec.category ? catLabel(rec.category) : ''), money(rec.amount, rec.currency), rec.supplierName && `المورّد ${rec.supplierName}`];
      case 'expensePayments': return ['دفعة', money(rec.amount, rec.currency)];
      case 'cashTransactions': return [CASH_AR[rec.type] || '', money(rec.amount, rec.currency), rec.accountId && ctx.account ? `(${ctx.account(rec.accountId)})` : '', rec.description];
      case 'cashAccounts': return [rec.name, rec.openingBalance !== undefined ? `رصيد افتتاحي ${money(rec.openingBalance, rec.currency)}` : ''];
      case 'partnerCapitalTransactions': return [LEDGER_AR[rec.type] || '', money(rec.amount, rec.currency), p(rec.partnerId) && `— ${p(rec.partnerId)}`];
      case 'partners': return [rec.name];
      case 'partnerLoans': return ['سلفة', money(rec.principal, rec.currency), p(rec.partnerId) && `— ${p(rec.partnerId)}`];
      case 'partnerLoanRepayments': return ['سداد', money(rec.principalAmount ?? rec.amount, rec.currency)];
      case 'customers': return [rec.name];
      case 'customerPayments': return [money(rec.amount, rec.currency), rec.customerId && ctx.customer ? `من ${ctx.customer(rec.customerId)}` : ''];
      case 'milkSales': return [rec.customerId && ctx.customer ? ctx.customer(rec.customerId) : '', rec.pricePerLiter ? `سعر اللتر ${num(rec.pricePerLiter)}` : ''];
      case 'milkDeliveries': return [rec.qty ? `${num(rec.qty)} لتر` : '', rec.date];
      case 'milkProduction': return [rec.date, rec.morning ? `صباحاً ${rec.morning}` : '', rec.evening ? `مساءً ${rec.evening}` : ''];
      case 'animals': return [rec.tag && `رقم ${rec.tag}`, rec.name];
      case 'animalEvents': return [EVT[rec.type] || '', rec.tag && `الحيوان ${rec.tag}`, money(rec.value, rec.currency)];
      case 'calfLogs': return [CALF[rec.type] || '', rec.qty ? `${num(rec.qty)} ${rec.unit || ''}`.trim() : '', rec.tag && `للعجل ${rec.tag}`];
      case 'stockItems': return [rec.name];
      case 'stockMovements': return [rec.type === 'in' ? 'وارد' : rec.type === 'out' ? 'صادر' : '', `${rec.qty !== undefined ? num(rec.qty) : ''} ${rec.itemName || ''}`.trim()];
      case 'cashCounts': return ['جرد', rec.countedAmount !== undefined ? `الفعلي ${money(rec.countedAmount, rec.currency)}` : '', rec.difference !== undefined ? `الفرق ${money(rec.difference, rec.currency)}` : '', rec.accountId && ctx.account ? `(${ctx.account(rec.accountId)})` : ''];
      case 'settlements': return [rec.from && rec.to ? `من ${rec.from} إلى ${rec.to}` : '', rec.netProfit !== undefined ? `صافي الربح ${money(rec.netProfit, rec.currency)}` : ''];
      case 'users': return [rec.name || rec.email, rec.role];
      case 'settings': return rec.lockedThrough !== undefined ? [rec.lockedThrough ? `قفل الفترات حتى ${rec.lockedThrough}` : 'فتح كل الفترات', rec.lockNote] : [];
      default: return [];
    }
  })();
  const s = parts.filter(Boolean).join(' — ');
  return s || (docId ? `(رقم السجل ${String(docId).slice(0, 6)}…)` : '');
}

/** ما كُتب في السجل: [[عنوان الحقل، القيمة]] بالعربية، دون الحقول التقنية. */
export function changedFields(rec = {}, ctx = {}) {
  const out = [];
  for (const [k, v] of Object.entries(rec)) {
    if (SKIP.has(k) || v === '' || v === null || v === undefined || typeof v === 'object') continue;
    if (k === 'partnerId') out.push(['الشريك', ctx.partner?.(v) || '']);
    else if (k === 'accountId') out.push(['الصندوق', ctx.account?.(v) || '']);
    else if (k === 'customerId') out.push(['العميل', ctx.customer?.(v) || '']);
    else if (k === 'category') out.push(['الفئة', catLabel(v) || v]);
    else if (k === 'type') out.push(['النوع', LEDGER_AR[v] || CASH_AR[v] || EVT[v] || CALF[v] || v]);
    else if (FIELD[k]) out.push([FIELD[k], typeof v === 'number' ? num(v) : String(v)]);
  }
  return out.filter(([, v]) => v !== '');
}

const dayKey = (d) => (d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}` : '');
/** يجمّع سطور السجل (الأحدث أولاً) في عمليات: كل ما سُجّل في لحظة واحدة من مستخدم واحد = عملية واحدة. */
export function buildOperations(rows = [], ctx = {}) {
  const recs = {};
  for (const r of [...rows].reverse()) { const k = `${r.collection}/${r.docId}`; recs[k] = { ...(recs[k] || {}), ...parseSummary(r.summary) }; }
  const groups = new Map();
  for (const r of rows) {
    const d = atDate(r); const g = `${r.uid || r.userName}|${d ? Math.floor(d.getTime() / 1000) : r.id}`;
    if (!groups.has(g)) groups.set(g, { id: g, at: d, user: r.userName || '—', entries: [] });
    groups.get(g).entries.push(r);
  }
  return [...groups.values()].map((g) => {
    const idx = (e) => { const i = PRIORITY.indexOf(e.collection); return i < 0 ? 99 : i; };
    const sorted = [...g.entries].sort((a, b) => idx(a) - idx(b));
    const main = sorted[0]; const act = (e) => ACTION_AR[e.action] || e.action;
    const line = (e) => { const rec = recs[`${e.collection}/${e.docId}`] || {}; const nm = COL[e.collection]?.[0] || e.collection; const d = describeRecord(e.collection, rec, ctx, e.docId); return `${act(e)} ${nm}${d ? `: ${d}` : ''}`; };
    const mainRec = recs[`${main.collection}/${main.docId}`] || {};
    const reason = g.entries.map((e) => parseSummary(e.summary).voidReason).find((x) => x && x !== '-' && x !== '.');
    return { ...g, day: dayKey(g.at), action: main.action, areas: [...new Set(g.entries.map((e) => COL[e.collection]?.[1] || 'النظام'))], title: line(main), reason: reason || '',
      subs: sorted.slice(1).map((e) => ({ text: line(e), action: e.action })), fields: main.action === 'void' ? [] : changedFields(parseSummary(main.summary), ctx), mainRec };
  });
}
