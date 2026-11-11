// تطبيع الأرقام المكتوبة بلوحة مفاتيح عربية أو بفاصلة عشرية مختلفة: «٥٠٠٫٥» و«1,000» و«12,5» ← أرقام غربية صحيحة.
// مهم للأيفون: حقول type=number لا تقبل الأرقام العربية/الفاصلة المحلية فتُرجع قيمة فارغة ويفشل الحفظ بصمت.
const EAST = '٠١٢٣٤٥٦٧٨٩', PERS = '۰۱۲۳۴۵۶۷۸۹';
/** خفيف أثناء الكتابة: يحوّل الأرقام العربية والفاصلة العربية فقط (لا يلمس الفاصلة العادية). */
export const lightNum = (v) => String(v ?? '').replace(/[٠-٩]/g, (d) => EAST.indexOf(d)).replace(/[۰-۹]/g, (d) => PERS.indexOf(d)).replace(/\u066B/g, '.');
/** كامل عند الحفظ/الحساب: يزيل الفواصل والمسافات (آلاف) ويفهم «12,5» كعشري. */
export function normNum(v) {
  if (v === null || v === undefined) return v;
  let s = lightNum(v).trim().replace(/[\u066C\u202F\u00A0\s]/g, '').replace(/\u060C/g, ',');
  s = /^-?\d+,\d{1,2}$/.test(s) ? s.replace(',', '.') : s.replace(/,/g, '');
  return s;
}
export const numOf = (v) => Number(normNum(v));
