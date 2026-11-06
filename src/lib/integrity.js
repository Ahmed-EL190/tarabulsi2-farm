// فحص سلامة البيانات: يراجع ارتباط كل شيء ببعضه (مصروفات ↔ صندوق ↔ شركاء ↔ مبيعات ↔ مواشي ↔ قروض ↔ تسويات)
// ويرجع قائمة فحوص؛ كل فحص له بنود المشكلة وإصلاح تلقائي (إن كان آمناً). دالة نقية بلا اتصال بقاعدة البيانات.
import { findOrphanCash, expensePosition, loanPosition, validateShares, cashBalances, partnerFundedExpenseEntry, round2, todayISO } from './finance';
import { PARTNER_EXPENSE_CATS, allExpenseCategories, CASH_AR } from './constants';

const n = (x) => Number(x) || 0;
const live = (a = []) => a.filter((x) => !x.voided);
const eq = (a, b) => Math.abs(n(a) - n(b)) < 0.005;
const V = (col, id) => ({ col, id, void: true });
const REMOVE = new Set(['sale', 'death', 'transfer_out', 'exchange_out']);
const ADD = new Set(['purchase', 'birth', 'exchange_in', 'transfer_in', 'opening']);

export function auditData(D = {}) {
  const cashAll = D.cash || []; const cash = live(cashAll); const accounts = D.accounts || []; const expenses = D.expenses || []; const expensePays = D.expensePays || [];
  const custPays = D.custPays || []; const agreements = D.agreements || []; const deliveries = D.deliveries || []; const partners = D.partners || []; const ledger = D.ledger || [];
  const loans = D.loans || []; const loanReps = D.loanReps || []; const settlements = D.settlements || []; const animals = D.animals || []; const events = D.events || []; const production = D.production || [];
  const EXP = Object.fromEntries(expenses.map((e) => [e.id, e])); const AN = Object.fromEntries(animals.map((a) => [a.id, a])); const AG = Object.fromEntries(agreements.map((a) => [a.id, a]));
  const PAY = Object.fromEntries(expensePays.map((p) => [p.id, p])); const PARTNER = Object.fromEntries(partners.map((p) => [p.id, p]));
  const ledLive = live(ledger); const evLive = live(events); const today = todayISO();
  const checks = [];
  const add = (id, area, level, title, items, extra = {}) => checks.push({ id, area, level, title, items, ...extra });
  const tx = (t) => `${t.date} — ${CASH_AR[t.type] || t.type} — ${t.amount} ${t.currency || ''}`;

  // ═══════════ الصندوق ═══════════
  const orph = findOrphanCash({ cash: cashAll, expensePays, expenses, custPays, animals, ledger, events });
  add('orphanCash', 'الصندوق', 'error', 'حركات صندوق أصلها ملغى أو محذوف (تظهر في الكشف والـ PDF)', orph.map((o) => ({ text: `${tx(o.tx)} — ${o.reason}` })), { hint: 'إلغاؤها يصحّح الرصيد ويشيلها من الكشف.', fix: orph.length ? { label: 'إلغاء هذه الحركات', ops: orph.map((o) => V('cashTransactions', o.tx.id)) } : null });

  const liveExpPays = live(expensePays).filter((p) => EXP[p.expenseId] && !EXP[p.expenseId].voided);
  const cashBy = (key, id) => cash.filter((t) => t[key] === id);
  const noCash = [], mism = [], dup = [];
  for (const p of liveExpPays) {
    if (p.source === 'partner') continue; const ts = cashBy('expensePaymentId', p.id);
    if (!ts.length) { if (p.accountId) noCash.push({ p, text: `${p.date} — دفعة ${p.amount} للمصروف «${EXP[p.expenseId].description}» بلا حركة صندوق`, op: { col: 'cashTransactions', data: { date: p.date, type: 'expense_payment', direction: 'out', amount: n(p.amount), currency: p.currency || EXP[p.expenseId].currency, accountId: p.accountId, expenseId: p.expenseId, expensePaymentId: p.id, description: EXP[p.expenseId].description || '' } } }); else noCash.push({ p, text: `${p.date} — دفعة ${p.amount} للمصروف «${EXP[p.expenseId].description}» بلا صندوق ولا حركة` }); }
    else if (ts.length > 1) dup.push({ text: `دفعة مصروف «${EXP[p.expenseId].description}» (${p.amount}) لها ${ts.length} حركات صندوق`, ops: ts.slice(1).map((t) => V('cashTransactions', t.id)) });
    else if (!eq(ts[0].amount, p.amount) || ts[0].date !== p.date) mism.push({ text: `دفعة «${EXP[p.expenseId].description}»: الدفعة ${p.amount} (${p.date}) ≠ الصندوق ${ts[0].amount} (${ts[0].date})`, op: { col: 'cashTransactions', id: ts[0].id, merge: true, data: { amount: n(p.amount), date: p.date } } });
  }
  add('expPayNoCash', 'الصندوق', 'error', 'دفعات مصروفات من الصندوق بلا حركة صندوق مقابلة', noCash.map((x) => ({ text: x.text })), { hint: 'المصروف مسجّل مدفوعاً لكن الفلوس لم تخرج من الصندوق.', fix: noCash.some((x) => x.op) ? { label: 'إنشاء حركات الصندوق الناقصة', ops: noCash.filter((x) => x.op).map((x) => x.op) } : null });
  add('expPayCashMismatch', 'الصندوق', 'error', 'دفعة مصروف مبلغها أو تاريخها يختلف عن حركة الصندوق', mism.map((x) => ({ text: x.text })), { fix: mism.length ? { label: 'مطابقة الصندوق على الدفعة', ops: mism.map((x) => x.op) } : null });

  const custNo = [], custNoAcc = [], custMism = [];
  for (const p of live(custPays)) {
    const ts = cashBy('customerPaymentId', p.id);
    if (!p.accountId) { custNoAcc.push({ text: `${p.date} — ${p.type === 'refund' ? 'استرداد' : 'دفعة'} ${p.amount} ${p.currency || ''} بلا صندوق (لا تؤثر في النقد)` }); continue; }
    if (!ts.length) custNo.push({ text: `${p.date} — ${p.type === 'refund' ? 'استرداد' : 'دفعة عميل'} ${p.amount} ${p.currency || ''} بلا حركة صندوق`, op: { col: 'cashTransactions', data: { date: p.date, type: p.type === 'refund' ? 'customer_refund' : 'customer_payment', direction: p.type === 'refund' ? 'out' : 'in', amount: n(p.amount), currency: p.currency, accountId: p.accountId, method: p.method || 'cash', customerId: p.customerId, customerPaymentId: p.id, description: p.note || '' } } });
    else if (ts.length > 1) dup.push({ text: `دفعة عميل (${p.amount}) لها ${ts.length} حركات صندوق`, ops: ts.slice(1).map((t) => V('cashTransactions', t.id)) });
    else if (!eq(ts[0].amount, p.amount) || ts[0].date !== p.date) custMism.push({ text: `دفعة عميل: ${p.amount} (${p.date}) ≠ الصندوق ${ts[0].amount} (${ts[0].date})`, op: { col: 'cashTransactions', id: ts[0].id, merge: true, data: { amount: n(p.amount), date: p.date } } });
  }
  add('custPayNoCash', 'الصندوق', 'error', 'دفعات عملاء بلا حركة صندوق مقابلة', custNo.map((x) => ({ text: x.text })), { fix: custNo.length ? { label: 'إنشاء حركات الصندوق الناقصة', ops: custNo.map((x) => x.op) } : null });
  add('custPayNoAccount', 'الصندوق', 'warn', 'دفعات عملاء مسجّلة بدون صندوق (لا تدخل رصيد الصندوق)', custNoAcc, { hint: 'لو فلوسها دخلت الصندوق فعلاً، عدّل الدفعة من تفاصيل الاتفاقية واختر الصندوق.' });
  add('custPayCashMismatch', 'الصندوق', 'error', 'دفعة عميل مبلغها أو تاريخها يختلف عن حركة الصندوق', custMism.map((x) => ({ text: x.text })), { fix: custMism.length ? { label: 'مطابقة الصندوق على الدفعة', ops: custMism.map((x) => x.op) } : null });
  add('dupCash', 'الصندوق', 'error', 'دفعة لها أكثر من حركة صندوق (تكرار يُنقص/يزيد الرصيد)', dup.map((x) => ({ text: x.text })), { fix: dup.length ? { label: 'إلغاء الحركات المكرّرة', ops: dup.flatMap((x) => x.ops) } : null });
  const bal = cashBalances(cash); const accName = (id) => accounts.find((a) => a.id === id)?.name || id;
  add('negCash', 'الصندوق', 'warn', 'صندوق/حساب رصيده بالسالب', Object.entries(bal).filter(([, v]) => v < -0.005).map(([k, v]) => ({ text: `${accName(k.split('|')[0])} (${k.split('|')[1]}): ${round2(v)}` })), { hint: 'خرج منه أكثر مما دخله: راجع الحركات أو أودِع المبلغ الناقص.' });
  add('badAccount', 'الصندوق', 'warn', 'حركات صندوق على حساب غير موجود أو ملغى', cash.filter((t) => !accounts.some((a) => a.id === t.accountId && !a.voided)).map((t) => ({ text: tx(t) })));

  // ═══════════ المصروفات ═══════════
  add('overpaid', 'المصروفات', 'error', 'مصروفات المدفوع منها أكبر من قيمتها', live(expenses).filter((e) => expensePosition(e, expensePays).paid > n(e.amount) + 0.005).map((e) => ({ text: `${e.date} — ${e.description}: المستحق ${e.amount} والمدفوع ${expensePosition(e, expensePays).paid}` })));
  const pNoLed = live(expensePays).filter((p) => p.source === 'partner' && EXP[p.expenseId] && !EXP[p.expenseId].voided && !ledLive.some((l) => l.expensePaymentId === p.id));
  add('partnerPayNoLedger', 'المصروفات', 'error', 'مصروفات دفعها شريك بلا قيد في حسابه', pNoLed.map((p) => ({ text: `${p.date} — ${p.amount} للمصروف «${EXP[p.expenseId].description}» (الشريك: ${PARTNER[p.partnerId]?.name || '؟'})` })), { fix: pNoLed.length ? { label: 'قيد المبالغ في حسابات الشركاء', ops: pNoLed.filter((p) => p.partnerId).map((p) => ({ col: 'partnerCapitalTransactions', data: partnerFundedExpenseEntry(EXP[p.expenseId], p) })) } : null });
  const unlinked = live(expenses).filter((e) => PARTNER_EXPENSE_CATS[e.category] && live(expensePays).some((p) => p.expenseId === e.id) && !ledLive.some((l) => l.expenseId === e.id && Object.values(PARTNER_EXPENSE_CATS).includes(l.type)));
  add('partnerCatUnlinked', 'المصروفات', 'error', 'سحب/سلفة/سداد قرض مسجّل كمصروف ولم يُقيَّد في حساب شريك', unlinked.map((e) => ({ text: `${e.date} — ${e.description} (${e.amount})`, link: '/expenses' })), { hint: 'من المصروفات: زر «ربط مصروفات الشركاء بحساباتهم».', link: '/expenses' });
  const dead = ledLive.filter((l) => l.expensePaymentId && (!PAY[l.expensePaymentId] || PAY[l.expensePaymentId].voided || !EXP[PAY[l.expensePaymentId].expenseId] || EXP[PAY[l.expensePaymentId].expenseId].voided));
  const deadReps = live(loanReps).filter((r) => r.expensePaymentId && (!PAY[r.expensePaymentId] || PAY[r.expensePaymentId].voided));
  add('orphanLedgerExpense', 'المصروفات', 'error', 'قيود شركاء/سدادات قروض أصلها دفعة مصروف ملغاة', [...dead.map((l) => ({ text: `${l.date} — ${l.type} ${l.amount} (${PARTNER[l.partnerId]?.name || '؟'})` })), ...deadReps.map((r) => ({ text: `${r.date} — سداد قرض ${r.principalAmount}` }))], { fix: dead.length + deadReps.length ? { label: 'إلغاؤها', ops: [...dead.map((l) => V('partnerCapitalTransactions', l.id)), ...deadReps.map((r) => V('partnerLoanRepayments', r.id))] } : null });
  const known = new Set(allExpenseCategories().map(([k]) => k));
  add('unknownCategory', 'المصروفات', 'warn', 'مصروفات بفئة غير معروفة', live(expenses).filter((e) => !known.has(e.category)).map((e) => ({ text: `${e.date} — ${e.description}: الفئة «${e.category}»` })), { hint: 'قد تكون فئة مخصّصة حُذفت. غيّر فئة المصروف.' });

  // ═══════════ المبيعات والحليب ═══════════
  const delByAg = {}; live(deliveries).forEach((d) => { delByAg[d.agreementId] = (delByAg[d.agreementId] || 0) + n(d.qty); });
  add('overDelivered', 'المبيعات والحليب', 'error', 'اتفاقيات التسليم فيها أكبر من الكمية المتفق عليها', live(agreements).filter((a) => (delByAg[a.id] || 0) > n(a.agreedQty) + 0.005).map((a) => ({ text: `${a.number || a.id}: متفق ${a.agreedQty} لتر — مسلَّم ${round2(delByAg[a.id])}`, link: '/milk-sales' })));
  const kids = [...live(deliveries).filter((d) => !AG[d.agreementId] || AG[d.agreementId].voided).map((d) => ({ text: `تسليم ${d.qty} لتر بتاريخ ${d.date} لاتفاقية ملغاة/محذوفة`, op: V('milkDeliveries', d.id) })), ...live(custPays).filter((p) => p.agreementId && (!AG[p.agreementId] || AG[p.agreementId].voided)).map((p) => ({ text: `دفعة ${p.amount} بتاريخ ${p.date} لاتفاقية ملغاة/محذوفة`, op: V('customerPayments', p.id) }))];
  add('childrenOfVoidedAgreement', 'المبيعات والحليب', 'error', 'تسليمات/دفعات تابعة لاتفاقية ملغاة ما زالت تُحسب', kids.map((k) => ({ text: k.text })), { fix: kids.length ? { label: 'إلغاؤها', ops: kids.map((k) => k.op) } : null });
  add('paymentAgreementMismatch', 'المبيعات والحليب', 'warn', 'دفعة عميل عملتها أو عميلها يخالف الاتفاقية المرتبطة بها', live(custPays).filter((p) => p.agreementId && AG[p.agreementId] && ((AG[p.agreementId].currency || 'SYP') !== (p.currency || 'SYP') || (AG[p.agreementId].customerId !== p.customerId))).map((p) => ({ text: `${p.date} — ${p.amount} ${p.currency || ''} على ${AG[p.agreementId].number || ''}`, link: '/milk-sales' })));
  const sales = evLive.filter((e) => e.type === 'sale' && n(e.value) > 0 && AN[e.animalId] && !AN[e.animalId].voided);
  const saleCash = (e) => cash.find((t) => t.type === 'animal_sale' && t.animalId === e.animalId && eq(t.amount, e.value));
  add('saleNoCash', 'المبيعات والحليب', 'warn', 'بيع حيوان بلا حركة صندوق (الفلوس لم تدخل الصندوق)', sales.filter((e) => !saleCash(e)).map((e) => ({ text: `${e.date} — بيع ${e.tag || ''} بـ ${e.value} ${e.currency || ''}`, link: '/animals' })));
  const prodDays = {}; live(production).forEach((p) => { (prodDays[p.date] = prodDays[p.date] || []).push(p); });
  const prodBad = []; Object.entries(prodDays).forEach(([d, rows]) => { if (rows.some((r) => r.shift === 'all') && rows.some((r) => r.shift !== 'all')) prodBad.push({ text: `${d}: خلط بين «على مدار اليوم» و«صباح/مساء» (الإنتاج يتكرر)`, link: '/production' }); const seen = {}; rows.forEach((r) => { const k = `${r.shift}|${r.animalId || ''}|${r.group || ''}`; if (seen[k]) prodBad.push({ text: `${d}: «${r.shift}» مسجّلة مرتين لنفس البقرة/المجموعة`, link: '/production' }); seen[k] = 1; }); });
  add('productionConflict', 'المبيعات والحليب', 'error', 'إنتاج حليب مكرّر أو متعارض في نفس اليوم', prodBad);

  // ═══════════ المواشي ═══════════
  const purchases = evLive.filter((e) => e.type === 'purchase' && n(e.value) > 0 && AN[e.animalId] && !AN[e.animalId].voided);
  const cashFor = (e) => cash.filter((t) => t.type === 'animal_purchase' && (t.animalId === e.animalId || (!t.animalId && AN[e.animalId] && t.description === `شراء ${AN[e.animalId].tag}`)));
  const ledFor = (e) => ledLive.filter((l) => l.type === 'animal_purchase_paid' && (l.eventId === e.id || (!l.eventId && l.animalId === e.animalId && l.date === e.date && eq(l.amount, e.value))));
  const both = [], none = [], noLed = [];
  for (const e of purchases) {
    const cs = cashFor(e), ls = ledFor(e); const viaPartner = e.paidFrom === 'partner' || e.paidFrom === 'capital';
    if ((viaPartner || ls.length) && cs.length) both.push({ text: `${e.date} — شراء ${e.tag || ''} (${e.value}) على حساب شريك ومن الصندوق معاً`, ops: cs.map((t) => V('cashTransactions', t.id)) });
    else if (!viaPartner && !ls.length && !cs.length) none.push({ text: `${e.date} — شراء ${e.tag || ''} (${e.value}) بلا مصدر دفع`, link: '/animals' });
    if (e.paidFrom === 'partner' && !ls.length && e.payerPartnerId) noLed.push({ text: `${e.date} — شراء ${e.tag || ''} (${e.value}) مسجّل على شريك بلا قيد في حسابه`, op: { col: 'partnerCapitalTransactions', data: { partnerId: e.payerPartnerId, date: e.date, type: 'animal_purchase_paid', amount: n(e.value), currency: e.currency || 'SYP', animalId: e.animalId, eventId: e.id, note: `شراء ${e.tag || ''}` } } });
  }
  add('purchaseTwice', 'المواشي', 'error', 'شراء حيوان مسجّل مرتين (على حساب شريك ومن الصندوق)', both.map((x) => ({ text: x.text })), { fix: both.length ? { label: 'إلغاء حركات الصندوق المكرّرة (يبقى على حساب الشريك)', ops: both.flatMap((x) => x.ops) } : null });
  add('purchaseNoSource', 'المواشي', 'warn', 'شراء حيوان بلا مصدر دفع (لا صندوق ولا شريك)', none.map((x) => ({ text: x.text, link: x.link })), { hint: 'من المواشي: «ربط المشتريات بحساب شريك» أو «تدقيق المشتريات».', link: '/animals' });
  add('purchaseNoLedger', 'المواشي', 'error', 'شراء مسجّل على شريك لكن بلا قيد في حسابه', noLed.map((x) => ({ text: x.text })), { fix: noLed.length ? { label: 'قيد المبالغ في حسابات الشركاء', ops: noLed.map((x) => x.op) } : null });
  const evBad = evLive.filter((e) => !AN[e.animalId] || AN[e.animalId].voided);
  add('eventsOfVoidedAnimal', 'المواشي', 'error', 'أحداث (شراء/بيع/...) لحيوان ملغى أو محذوف', evBad.map((e) => ({ text: `${e.date} — ${e.type} ${e.tag || ''} ${e.value || ''}` })), { fix: evBad.length ? { label: 'إلغاء هذه الأحداث', ops: evBad.map((e) => V('animalEvents', e.id)) } : null });
  const bad = []; const byAnimal = {}; evLive.filter((e) => AN[e.animalId] && !AN[e.animalId].voided).forEach((e) => { (byAnimal[e.animalId] = byAnimal[e.animalId] || []).push(e); });
  Object.entries(byAnimal).forEach(([id, evs]) => { let active = false; evs.sort((a, b) => a.date.localeCompare(b.date) || (ADD.has(b.type) ? 1 : 0) - (ADD.has(a.type) ? 1 : 0)).forEach((e) => { if (ADD.has(e.type)) active = true; else if (REMOVE.has(e.type)) { if (!active) bad.push({ text: `${AN[id].tag}: ${e.type} بتاريخ ${e.date} وهو غير موجود في القطيع`, link: '/animals' }); active = false; } }); });
  add('removeWhenInactive', 'المواشي', 'warn', 'بيع/نفوق/نقل لحيوان ليس في القطيع (بيع مرتين أو بلا شراء)', bad);
  add('purchasePrice', 'المواشي', 'warn', 'سعر الشراء في الحدث يخالف تكلفة الحيوان', purchases.filter((e) => n(AN[e.animalId].acquisitionCost) > 0 && !eq(AN[e.animalId].acquisitionCost, e.value)).map((e) => ({ text: `${e.tag || AN[e.animalId].tag}: الحدث ${e.value} ≠ تكلفة الحيوان ${AN[e.animalId].acquisitionCost}`, link: '/animals' })));
  const exOut = evLive.filter((e) => e.type === 'exchange_out' && e.exchangeId), exIn = evLive.filter((e) => e.type === 'exchange_in' && e.exchangeId);
  add('exchangePairs', 'المواشي', 'warn', 'تبادل ناقص (حيوان خارج بلا وارد أو العكس)', [...exOut.filter((o) => !exIn.some((i) => i.exchangeId === o.exchangeId)).map((o) => ({ text: `${o.date} — خرج ${o.tag || ''} بلا حيوان وارد` })), ...exIn.filter((i) => !exOut.some((o) => o.exchangeId === i.exchangeId)).map((i) => ({ text: `${i.date} — دخل ${i.tag || ''} بلا حيوان خارج` }))]);
  const payDead = ledLive.filter((l) => l.type === 'animal_purchase_paid' && ((l.eventId && (!events.find((e) => e.id === l.eventId) || events.find((e) => e.id === l.eventId).voided)) || (l.animalId && (!AN[l.animalId] || AN[l.animalId].voided))));
  add('orphanPayable', 'المواشي', 'error', 'ثمن حيوان مقيَّد في حساب شريك لكن شراؤه ملغى', payDead.map((l) => ({ text: `${l.date} — ${l.amount} (${PARTNER[l.partnerId]?.name || '؟'}) ${l.note || ''}` })), { fix: payDead.length ? { label: 'إلغاء هذه القيود', ops: payDead.map((l) => V('partnerCapitalTransactions', l.id)) } : null });

  // ═══════════ الشركاء والقروض ═══════════
  const act = live(partners).filter((p) => p.status !== 'inactive'); const so = validateShares(act, 'ownershipPct'), sp = validateShares(act, 'profitSharePct');
  add('shares', 'الشركاء والقروض', 'warn', 'مجموع نسب الملكية أو الأرباح لا يساوي 100%', [...(so.ok ? [] : [{ text: `نسب الملكية = ${so.total}%`, link: '/partners' }]), ...(sp.ok ? [] : [{ text: `نسب الأرباح = ${sp.total}% (لا يمكن اعتماد تسوية)`, link: '/partners' }])]);
  const loanBad = [];
  for (const l of live(loans)) {
    const hasL = ledLive.some((e) => e.type === 'loan_given' && e.loanId === l.id), hasC = cash.some((t) => t.type === 'loan_received' && t.loanId === l.id);
    if (!hasL) loanBad.push({ text: `قرض ${l.principal} (${PARTNER[l.partnerId]?.name || '؟'}) بلا قيد في حساب الشريك`, link: '/loans' }); if (!hasC) loanBad.push({ text: `قرض ${l.principal} (${PARTNER[l.partnerId]?.name || '؟'}) بلا حركة دخول للصندوق`, link: '/loans' });
    const led = ledLive.filter((e) => e.type === 'loan_given' && e.loanId === l.id).reduce((s, e) => s + n(e.amount), 0); if (hasL && !eq(led, l.principal)) loanBad.push({ text: `قرض ${l.principal}: قيد الشريك ${led}`, link: '/loans' });
  }
  add('loanLinks', 'الشركاء والقروض', 'error', 'قروض شركاء غير مرتبطة بحساب الشريك أو بالصندوق', loanBad);
  const repBad = [];
  for (const l of live(loans)) {
    const reps = live(loanReps).filter((r) => r.loanId === l.id); const sumR = reps.reduce((s, r) => s + n(r.principalAmount), 0); const sumL = ledLive.filter((e) => e.type === 'loan_principal_repayment' && e.loanId === l.id).reduce((s, e) => s + n(e.amount), 0);
    if (!eq(sumR, sumL)) repBad.push({ text: `قرض ${l.principal} (${PARTNER[l.partnerId]?.name || '؟'}): سدادات القرض ${round2(sumR)} ≠ قيود الشريك ${round2(sumL)}`, link: '/loans' });
    if (loanPosition(l, loanReps).outstandingPrincipal < -0.005) repBad.push({ text: `قرض ${l.principal}: المسدَّد أكبر من أصل القرض`, link: '/loans' });
  }
  add('loanRepMismatch', 'الشركاء والقروض', 'error', 'سدادات القروض لا تطابق قيود حساب الشريك (أو تتجاوز الأصل)', repBad);
  add('ledgerNoPartner', 'الشركاء والقروض', 'error', 'قيود حسابات لشريك محذوف أو ملغى', ledLive.filter((l) => !PARTNER[l.partnerId] || PARTNER[l.partnerId].voided).map((l) => ({ text: `${l.date} — ${l.type} ${l.amount}` })));

  // ═══════════ التسويات ═══════════
  const st = live(settlements); const stBad = [], allocBad = [], distBad = [];
  st.forEach((a, i) => st.slice(i + 1).forEach((b) => { if ((a.currency || 'SYP') === (b.currency || 'SYP') && !(a.to < b.from || a.from > b.to)) stBad.push({ text: `تسويتان متداخلتان: ${a.from}→${a.to} و ${b.from}→${b.to} (توزيع مكرّر لنفس الأيام)`, link: '/settlements' }); }));
  for (const s of st) {
    for (const a of s.allocations || []) {
      const got = ledLive.filter((e) => e.type === 'profit_allocation' && e.settlementId === s.id && e.partnerId === a.partnerId).reduce((x, e) => x + n(e.amount), 0);
      if (!eq(got, a.amount)) allocBad.push({ text: `تسوية ${s.from}→${s.to}: حصة ${PARTNER[a.partnerId]?.name || '؟'} ${a.amount} ≠ قيدها في حسابه ${round2(got)}`, link: '/settlements' });
      const dist = ledLive.filter((e) => e.type === 'profit_distribution' && e.settlementId === s.id && e.partnerId === a.partnerId).reduce((x, e) => x + n(e.amount), 0);
      if (dist > n(a.amount) + 0.005) distBad.push({ text: `تسوية ${s.from}→${s.to}: وُزِّع على ${PARTNER[a.partnerId]?.name || '؟'} ${round2(dist)} من حصة ${a.amount}`, link: '/settlements' });
    }
    if ((s.allocations || []).length && !eq((s.allocations || []).reduce((x, a) => x + n(a.amount), 0), s.netProfit)) allocBad.push({ text: `تسوية ${s.from}→${s.to}: مجموع الحصص ≠ صافي الربح`, link: '/settlements' });
  }
  add('settlementOverlap', 'التسويات', 'error', 'تسويات معتمدة متداخلة', stBad);
  add('settlementAlloc', 'التسويات', 'error', 'حصص التسوية لا تطابق قيود الشركاء', allocBad);
  add('distributionExceeds', 'التسويات', 'error', 'توزيع نقدي أكبر من حصة الشريك في التسوية', distBad);

  // ═══════════ عام ═══════════
  const horizon = new Date(`${today}T00:00:00Z`); horizon.setUTCDate(horizon.getUTCDate() + 2); const limit = horizon.toISOString().slice(0, 10);
  const future = [...cash.filter((t) => t.date > limit).map((t) => ({ text: `صندوق: ${tx(t)}` })), ...live(expenses).filter((e) => e.date > limit).map((e) => ({ text: `مصروف: ${e.date} — ${e.description}` })), ...live(deliveries).filter((d) => d.date > limit).map((d) => ({ text: `تسليم حليب: ${d.date} — ${d.qty} لتر` }))];
  add('futureDates', 'عام', 'warn', 'حركات بتاريخ في المستقبل (غالباً خطأ في السنة/اليوم)', future);
  const nonPos = [...cash.filter((t) => !(n(t.amount) > 0)).map((t) => ({ text: `صندوق: ${tx(t)}` })), ...live(expenses).filter((e) => !(n(e.amount) > 0)).map((e) => ({ text: `مصروف بمبلغ غير موجب: ${e.description}` })), ...live(custPays).filter((p) => !(n(p.amount) > 0)).map((p) => ({ text: `دفعة عميل بمبلغ غير موجب: ${p.date}` })), ...live(deliveries).filter((d) => !(n(d.qty) > 0)).map((d) => ({ text: `تسليم بكمية غير موجبة: ${d.date}` }))];
  add('nonPositive', 'عام', 'error', 'مبالغ أو كميات صفر/سالبة', nonPos);

  // ═══════════ مطابقة الأرقام (لازم تتساوى) ═══════════
  const recon = []; const cur = (x) => x.currency || 'SYP';
  const row = (label, grp, a, b, c) => { const cc = c || 'SYP'; recon.push({ label, currency: cc, a: round2(a), b: round2(b), diff: round2(a - b), ok: eq(a, b) }); };
  for (const c of ['SYP', 'USD']) {
    const sumC = (arr, f) => arr.filter((x) => cur(x) === c).reduce((s, x) => s + n(f(x)), 0);
    const present = [cash, live(expenses), live(custPays), evLive, ledLive].some((arr) => arr.some((x) => cur(x) === c)); if (!present) continue;
    row(`مدفوعات المصروفات من الصندوق ↔ حركات «دفع مصروف» (${c})`, 0, sumC(liveExpPays.filter((p) => p.source !== 'partner'), (p) => p.amount), sumC(cash.filter((t) => t.type === 'expense_payment'), (t) => t.amount), c);
    row(`دفعات العملاء الصافية ↔ حركات الصندوق (${c})`, 0, sumC(live(custPays).filter((p) => p.accountId), (p) => (p.type === 'refund' ? -1 : 1) * n(p.amount)), sumC(cash.filter((t) => ['customer_payment', 'customer_refund'].includes(t.type)), (t) => (t.type === 'customer_refund' ? -1 : 1) * n(t.amount)), c);
    row(`بيع الحيوانات (أحداث) ↔ حركات «بيع حيوان» (${c})`, 0, sumC(sales, (e) => e.value), sumC(cash.filter((t) => t.type === 'animal_sale'), (t) => t.amount), c);
    row(`مشتريات الحيوانات المدفوعة من الصندوق ↔ حركات «شراء حيوان» (${c})`, 0, sumC(purchases.filter((e) => e.paidFrom !== 'partner' && e.paidFrom !== 'capital'), (e) => e.value), sumC(cash.filter((t) => t.type === 'animal_purchase'), (t) => t.amount), c);
    row(`ثمن حيوانات دفعها الشركاء (أحداث) ↔ قيود حساباتهم (${c})`, 0, sumC(purchases.filter((e) => e.paidFrom === 'partner'), (e) => e.value), sumC(ledLive.filter((l) => l.type === 'animal_purchase_paid'), (l) => l.amount), c);
    row(`أصل قروض الشركاء ↔ قيود حساباتهم (${c})`, 0, sumC(live(loans), (l) => l.principal), sumC(ledLive.filter((l) => l.type === 'loan_given'), (l) => l.amount), c);
    row(`أصل قروض الشركاء ↔ حركات دخول الصندوق (${c})`, 0, sumC(live(loans), (l) => l.principal), sumC(cash.filter((t) => t.type === 'loan_received'), (t) => t.amount), c);
    row(`سدادات أصل القروض ↔ قيود حسابات الشركاء (${c})`, 0, sumC(live(loanReps), (r) => r.principalAmount), sumC(ledLive.filter((l) => l.type === 'loan_principal_repayment'), (l) => l.amount), c);
  }
  const errors = checks.filter((c) => c.items.length && c.level === 'error').length, warns = checks.filter((c) => c.items.length && c.level === 'warn').length;
  return { checks, reconciliation: recon, summary: { errors, warnings: warns, ok: checks.filter((c) => !c.items.length).length, total: checks.length, reconBad: recon.filter((r) => !r.ok).length } };
}
