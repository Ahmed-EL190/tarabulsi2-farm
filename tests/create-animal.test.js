import { describe, it, expect, vi, beforeEach } from 'vitest';
const store = new Map();
vi.mock('../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => {
  let n = 0;
  return {
    collection: (_d, name) => ({ __col: name }), serverTimestamp: () => 'TS', onSnapshot: vi.fn(), writeBatch: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
    doc: (a, b, c) => (a && a.__col ? { key: `${a.__col}/auto${++n}` } : { key: `${b}/${c}` }),
    runTransaction: async (_db, fn) => fn({ get: async (ref) => ({ exists: () => store.has(ref.key), data: () => store.get(ref.key) }), set: (ref, data) => { store.set(ref.key, data); } }),
  };
});
const { createAnimal } = await import('../src/data/db.js');
const F = await import('../src/lib/finance.js');
beforeEach(() => store.clear());

describe('إعادة استخدام رقم حيوان محذوف (الخطأ: «الحيوان موجود» رغم أنه ممسوح)', () => {
  it('رقم جديد ← معرّف عادي', async () => { expect(await createAnimal({ uid: 'u' }, { tag: 'A 7' })).toBe('a_7'); expect(store.get('animals/a_7').tag).toBe('A 7'); });
  it('رقم لحيوان ملغى ← حيوان جديد بمعرّف جديد، والقديم يبقى كما هو بتاريخه', async () => {
    store.set('animals/c1', { tag: 'C1', voided: true, name: 'القديمة' });
    const id = await createAnimal({ uid: 'u' }, { tag: 'C1', name: 'الجديدة' });
    expect(id).toBe('c1__2'); expect(store.get('animals/c1')).toMatchObject({ voided: true, name: 'القديمة' }); expect(store.get('animals/c1__2')).toMatchObject({ tag: 'C1', name: 'الجديدة' });
  });
  it('ملغاة أكثر من مرة ← يأخذ أول معرّف فاضي', async () => {
    store.set('animals/c1', { tag: 'C1', voided: true }); store.set('animals/c1__2', { tag: 'C1', voided: true });
    expect(await createAnimal({}, { tag: 'c1' })).toBe('c1__3');
  });
  it('رقم لحيوان قائم (غير ملغى) ← يُرفض ويذكر الرقم', async () => {
    store.set('animals/c1', { tag: 'C1' }); await expect(createAnimal({}, { tag: 'C1' })).rejects.toThrow('DUPLICATE_TAG:C1');
    store.set('animals/c1__2', { tag: 'C1' }); store.set('animals/c2', { tag: 'C2', voided: true });
    await expect(createAnimal({}, { tag: ' c1 ' })).rejects.toThrow(/DUPLICATE_TAG/);
  });
  it('حيوان قائم له نفس الرقم بعد ملغى قبله ← يُرفض (لا يُنشأ ثالث)', async () => {
    store.set('animals/c1', { tag: 'C1', voided: true }); store.set('animals/c1__2', { tag: 'C1' }); await expect(createAnimal({}, { tag: 'C1' })).rejects.toThrow(/DUPLICATE_TAG/);
  });
});
describe('validateNewAnimal بنفس تحويل المعرّف', () => {
  it('«A 1» و«A_1» و«a/1» نفس المعرّف ← مكرّر (كان يمرّ ثم يفشل الحفظ)', () => {
    expect(F.validateNewAnimal('A 1', [{ tag: 'A_1' }]).ok).toBe(false); expect(F.validateNewAnimal('a/1', [{ tag: 'A_1' }]).ok).toBe(false);
  });
  it('الملغى لا يمنع، والفارغ يُرفض، والمختلف يمرّ', () => {
    expect(F.validateNewAnimal('A1', [{ tag: 'A1', voided: true }]).ok).toBe(true); expect(F.validateNewAnimal('  ', []).reason).toBe('missing'); expect(F.validateNewAnimal('A2', [{ tag: 'A1' }]).ok).toBe(true);
  });
});
