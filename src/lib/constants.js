export const CURRENCIES = [['SYP', 'ليرة سورية (SYP)'], ['USD', 'دولار (USD)']];
export const METHODS = [['cash', 'نقداً'], ['bank', 'تحويل بنكي'], ['other', 'أخرى']];
export const EXPENSE_CATEGORIES = [['feed', 'علف'], ['vet', 'دواء وعلاج'], ['labor', 'أجور عمال'], ['worker_advance', 'سلف عمال'], ['partner_advance', 'مبلغ أخذه شريك من المزرعة كسلفة (غير تشغيلي)'], ['transport', 'نقل'], ['maintenance', 'صيانة'], ['utilities', 'ماء وكهرباء'], ['fuel', 'وقود'], ['equipment', 'معدات (رأس مال — غير تشغيلي)'], ['other', 'أخرى'], ['loan_principal', 'سداد سلفة لشريك (غير تشغيلي)'], ['partner_withdrawal', 'سحب شريك (غير تشغيلي)']];
// ── قوائم مخصّصة يضيفها المستخدم من الموقع (تُحفظ في Firestore وتُحقن هنا عبر useCustomLists) ──
let _custom = { expense: [], animal: [] };
export const setCustomLists = (l = {}) => { _custom = { expense: l.expense || [], animal: l.animal || [] }; };
const mergeCats = (base, custom) => [...base, ...custom.filter((x) => x && x.id && x.label && !base.some(([k]) => k === x.id)).map((x) => [x.id, x.label])];
export const allExpenseCategories = () => mergeCats(EXPENSE_CATEGORIES, _custom.expense);
export const catLabel = (k) => Object.fromEntries(allExpenseCategories())[k] || k;
export const LEDGER_AR = { opening_balance: 'رصيد افتتاحي', animal_loss_charge: 'خسارة تبادل حيوانات (على الشريك)', animal_gain_credit: 'ربح تبادل حيوانات (للشريك)', capital_contribution: 'مساهمة رأس مال', additional_capital: 'رأس مال إضافي', loan_given: 'سلفة من الشريك للمزرعة', loan_principal_repayment: 'سداد سلفة', interest_accrued: 'فائدة مستحقة (قديم)', interest_paid: 'فائدة مدفوعة (قديم)', expense_paid_personally: 'مصروف دفعه الشريك', reimbursement: 'تعويض للشريك', withdrawal: 'سحب مصرّح', profit_allocation: 'تخصيص أرباح', profit_distribution: 'توزيع أرباح نقدي', adjustment: 'تسوية', animal_purchase_paid: 'ثمن حيوان دفعه الشريك', partner_advance: 'سلفة أخذها الشريك من المزرعة', animal_purchase_repaid: 'سداد ثمن حيوان للشريك' };
export const CASH_AR = { customer_payment: 'دفعة عميل', customer_refund: 'استرداد لعميل', expense_payment: 'دفع مصروف', other_income: 'إيراد آخر', loan_received: 'سلفة من شريك', loan_repayment: 'سداد سلفة', capital_contribution: 'رأس مال', partner_withdrawal: 'سحب شريك', profit_distribution: 'توزيع أرباح', partner_reimbursement: 'تعويض شريك', transfer_in: 'تحويل وارد', transfer_out: 'تحويل صادر', opening_balance: 'رصيد افتتاحي', cash_count_adjustment: 'تسوية فرق جرد', animal_sale: 'بيع حيوان', animal_purchase: 'شراء حيوان', animal_exchange_payment: 'فرق تبادل (دفع)', animal_exchange_receipt: 'فرق تبادل (قبض)', animal_purchase_repayment: 'سداد ثمن بقر لشريك' };
export const PAY_STATUS_AR = { unpaid: 'غير مدفوع', partial: 'مدفوع جزئياً', paid: 'مدفوع', advance: 'دفعة مقدمة', paid_with_credit: 'مدفوع مع رصيد دائن' };
export const AG_STATUS_AR = { open: 'مفتوح', in_progress: 'قيد التسليم', fulfilled: 'مكتمل', cancelled: 'ملغى' };
export const ANIMAL_CATEGORIES = [['cow', 'بقرة'], ['bull', 'ثور تلقيح'], ['heifer_calf', 'عجل/عجلة كبيرة']];
export const SALE_KIND_AR = { milk: 'حليب', animal: 'حيوان', other: 'أخرى' };
export const allAnimalCategories = () => mergeCats(ANIMAL_CATEGORIES, _custom.animal);
export const animalCatLabel = (k) => Object.fromEntries(allAnimalCategories())[k] || '';
/** خيار «فئة جديدة» يظهر آخر القائمة؛ عند اختياره يُطلب اسم الفئة وتُنشأ تلقائياً. */
export const NEW_CAT = ['__new__', '➕ فئة جديدة…'];
/** فئات المصروف التي تخص حساب شريك: عند تسجيلها يُقيَّد أثرها تلقائياً في حسابه (مفتاح الفئة ← نوع قيد الشريك). */
export const PARTNER_EXPENSE_CATS = { partner_withdrawal: 'withdrawal', partner_advance: 'partner_advance', loan_principal: 'loan_principal_repayment' };
