import { describe, it, expect } from 'vitest';
import { normNum, lightNum, numOf } from '../src/lib/num.js';
describe('تطبيع الأرقام (أيفون / لوحة مفاتيح عربية)', () => {
  it('أرقام عربية وفارسية', () => { expect(normNum('٥٠٠٠')).toBe('5000'); expect(normNum('۱۲۳')).toBe('123'); expect(numOf('٧٠٠٠٠٠٠')).toBe(7000000); });
  it('فاصلة عشرية عربية وفاصل آلاف', () => { expect(normNum('٥٠٠٫٥')).toBe('500.5'); expect(normNum('١٬٠٠٠٬٠٠٠')).toBe('1000000'); });
  it('فاصلة غربية: آلاف أو عشري حسب الشكل', () => { expect(normNum('1,000')).toBe('1000'); expect(normNum('1,000,000')).toBe('1000000'); expect(normNum('12,5')).toBe('12.5'); expect(normNum('0,75')).toBe('0.75'); });
  it('مسافات وسالب وعادي وفارغ', () => { expect(normNum(' 7 000 ')).toBe('7000'); expect(normNum('-15.5')).toBe('-15.5'); expect(normNum('')).toBe(''); expect(normNum(null)).toBe(null); expect(normNum(42)).toBe('42'); });
  it('lightNum يحوّل الأرقام فقط ولا يلمس الفاصلة أثناء الكتابة', () => { expect(lightNum('١٢,')).toBe('12,'); expect(lightNum('٣٫٢')).toBe('3.2'); });
});
