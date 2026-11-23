import { describe, it, expect } from 'vitest';
import fs from 'node:fs'; import path from 'node:path';
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
describe('أعمدة الأزرار تظهر على الموبايل', () => {
  it('كل عمود بلا عنوان يجب أن يكون مفتاحه _a، وإلا يختفي من بطاقات الموبايل', () => {
    const bad = [];
    for (const f of walk('src').filter((x) => /\.jsx?$/.test(x))) {
      fs.readFileSync(f, 'utf8').split('\n').forEach((l, i) => { for (const m of l.matchAll(/\{ key: '([^']+)', label: ''/g)) if (m[1] !== '_a') bad.push(`${f}:${i + 1} (${m[1]})`); });
    }
    expect(bad).toEqual([]);
  });
});
