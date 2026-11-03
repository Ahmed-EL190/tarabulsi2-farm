import { describe, it, expect, vi, beforeEach } from 'vitest';
const listeners = []; let unsubs = 0;
vi.mock('../src/lib/firebase', () => ({ db: {} }));
vi.mock('firebase/firestore', () => ({
  collection: (_d, name) => ({ name }), doc: vi.fn(), writeBatch: vi.fn(), runTransaction: vi.fn(), serverTimestamp: vi.fn(), query: vi.fn(), orderBy: vi.fn(), limit: vi.fn(),
  onSnapshot: (ref, _opts, cb) => { listeners.push({ name: ref.name, cb }); return () => { unsubs++; }; },
}));
const { _store, resetStore } = await import('../src/data/db.js');
const snap = (docs, changes, fromCache = false) => ({ docs: docs.map((d) => ({ id: d.id, data: () => { const { id, ...r } = d; return r; } })), docChanges: () => (changes || []).map((c) => ({ type: c.type, doc: { id: c.doc.id, data: () => { const { id, ...r } = c.doc; return r; } } })), metadata: { fromCache } });
beforeEach(() => { resetStore(); listeners.length = 0; unsubs = 0; });
describe('shared collection store', () => {
  it('subscribes once per collection no matter how many components ask', () => {
    _store.ensure('animals'); _store.ensure('animals'); _store.ensure('animals'); _store.ensure('partners');
    expect(listeners.map((l) => l.name)).toEqual(['animals', 'partners']);
  });
  it('first snapshot: rows sorted by id, loading flips to false', () => {
    const c = _store.ensure('animals'); expect(c.snap.loading).toBe(true);
    listeners[0].cb(snap([{ id: 'b', x: 1 }, { id: 'a', x: 2 }])); expect(c.snap.loading).toBe(false); expect(c.snap.rows.map((r) => r.id)).toEqual(['a', 'b']);
  });
  it('incremental changes keep unchanged row objects stable (cheap re-render)', () => {
    const c = _store.ensure('animals'); listeners[0].cb(snap([{ id: 'a', x: 1 }, { id: 'b', x: 2 }]));
    const before = Object.fromEntries(c.snap.rows.map((r) => [r.id, r])); const arr = c.snap.rows;
    listeners[0].cb(snap([], [{ type: 'modified', doc: { id: 'b', x: 99 } }, { type: 'added', doc: { id: 'c', x: 3 } }]));
    expect(c.snap.rows).not.toBe(arr); expect(c.snap.rows.find((r) => r.id === 'a')).toBe(before.a); expect(c.snap.rows.find((r) => r.id === 'b').x).toBe(99); expect(c.snap.rows.map((r) => r.id)).toEqual(['a', 'b', 'c']);
    listeners[0].cb(snap([], [{ type: 'removed', doc: { id: 'a' } }])); expect(c.snap.rows.map((r) => r.id)).toEqual(['b', 'c']);
  });
  it('metadata-only callbacks do not rebuild rows; syncing flag follows fromCache', () => {
    const c = _store.ensure('animals'); listeners[0].cb(snap([{ id: 'a' }], null, true)); const arr = c.snap.rows;
    expect(_store.status()).toEqual({ loading: 0, syncing: true });
    listeners[0].cb(snap([{ id: 'a' }], [], false)); expect(c.snap.rows).toBe(arr); expect(_store.status()).toEqual({ loading: 0, syncing: false });
  });
  it('loading counter reflects collections that have not arrived yet', async () => {
    _store.ensure('a'); _store.ensure('b'); await Promise.resolve(); expect(_store.status().loading).toBe(2); listeners[0].cb(snap([])); expect(_store.status().loading).toBe(1);
  });
  it('resetStore closes every listener (login/logout)', () => { _store.ensure('a'); _store.ensure('b'); resetStore(); expect(unsubs).toBe(2); _store.ensure('a'); expect(listeners.length).toBe(3); });

});
