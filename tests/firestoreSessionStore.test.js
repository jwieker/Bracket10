import { FirestoreStore } from '../src/middleware/firestoreSessionStore.js';

// Builds a fake Firestore dataset whose `.collection(kind).doc(sid)` returns a
// doc handle with mockable get/set/delete. Returned `inspect` lets each test
// assert which collection + sid path was used.
function mockDataset({ docData, docExists = true, getError, setError, deleteError } = {}) {
  const docFns = {
    get: vi.fn().mockImplementation(() =>
      getError ? Promise.reject(getError) : Promise.resolve({
        exists: docExists,
        data: () => docData,
      })
    ),
    set: vi.fn().mockImplementation((payload) =>
      setError ? Promise.reject(setError) : Promise.resolve(payload)
    ),
    delete: vi.fn().mockImplementation(() =>
      deleteError ? Promise.reject(deleteError) : Promise.resolve()
    ),
  };
  const doc = vi.fn().mockReturnValue(docFns);
  const collection = vi.fn().mockReturnValue({ doc });
  return { dataset: { collection }, collection, doc, docFns };
}

// Promisifies the callback-based store API so tests can use async/await
// instead of the deprecated `done(err)` pattern.
const pget = (store, sid) =>
  new Promise((resolve) => store.get(sid, (err, val) => resolve([err, val])));
const pset = (store, sid, sess) =>
  new Promise((resolve) => store.set(sid, sess, (err) => resolve(err)));
const pdestroy = (store, sid) =>
  new Promise((resolve) => store.destroy(sid, (err) => resolve(err)));

describe('FirestoreStore constructor', () => {
  test('uses default kind "express-sessions" when not provided', () => {
    const { dataset, collection } = mockDataset();
    new FirestoreStore({ dataset });
    expect(collection).toHaveBeenCalledWith('express-sessions');
  });

  test('honors a custom kind', () => {
    const { dataset, collection } = mockDataset();
    new FirestoreStore({ dataset, kind: 'my-sessions' });
    expect(collection).toHaveBeenCalledWith('my-sessions');
  });
});

describe('FirestoreStore.get', () => {
  test('returns the stored session when the doc exists and is not expired', async () => {
    const session = { cookie: {}, user: 'alex' };
    const { dataset, doc } = mockDataset({
      docData: { session, expires: Date.now() + 60_000 },
    });
    const store = new FirestoreStore({ dataset });

    const [err, result] = await pget(store, 'sid-1');
    expect(err).toBeNull();
    expect(result).toEqual(session);
    expect(doc).toHaveBeenCalledWith('sid-1');
  });

  test('returns null when the doc does not exist', async () => {
    const { dataset } = mockDataset({ docExists: false });
    const store = new FirestoreStore({ dataset });

    const [err, result] = await pget(store, 'missing');
    expect(err).toBeNull();
    expect(result).toBeNull();
  });

  test('returns null when the session is past its expires timestamp', async () => {
    const { dataset } = mockDataset({
      docData: { session: { user: 'old' }, expires: Date.now() - 1000 },
    });
    const store = new FirestoreStore({ dataset });

    const [err, result] = await pget(store, 'expired-sid');
    expect(err).toBeNull();
    expect(result).toBeNull();
  });

  test('propagates errors from Firestore .get() to the callback', async () => {
    const boom = new Error('firestore down');
    const { dataset } = mockDataset({ getError: boom });
    const store = new FirestoreStore({ dataset });

    const [err] = await pget(store, 'sid');
    expect(err).toBe(boom);
  });
});

describe('FirestoreStore.set', () => {
  test('serializes the session via JSON round-trip and writes session + expires', async () => {
    const { dataset, docFns } = mockDataset();
    const store = new FirestoreStore({ dataset });
    const cookieExpires = new Date(Date.now() + 7 * 24 * 3600 * 1000);
    const session = {
      cookie: { expires: cookieExpires },
      user: 'alex',
    };

    const err = await pset(store, 'sid-2', session);
    expect(err).toBeNull();
    const payload = docFns.set.mock.calls[0][0];
    expect(payload.session).toEqual(JSON.parse(JSON.stringify(session)));
    expect(payload.expires).toBe(cookieExpires.getTime());
  });

  test('defaults expires to ~24 hours from now when cookie.expires is absent', async () => {
    const { dataset, docFns } = mockDataset();
    const store = new FirestoreStore({ dataset });
    const before = Date.now();

    const err = await pset(store, 'sid-3', { cookie: {}, user: 'x' });
    expect(err).toBeNull();
    const payload = docFns.set.mock.calls[0][0];
    // 86400000 ms = 24h; allow a small window for test execution time
    expect(payload.expires).toBeGreaterThanOrEqual(before + 86400000 - 100);
    expect(payload.expires).toBeLessThanOrEqual(Date.now() + 86400000);
  });

  test('strips non-serializable session fields via JSON round-trip', async () => {
    const { dataset, docFns } = mockDataset();
    const store = new FirestoreStore({ dataset });
    const sess = { cookie: {}, fn: () => 'noop', user: 'alex' };

    await pset(store, 'sid', sess);
    const payload = docFns.set.mock.calls[0][0];
    expect(payload.session.fn).toBeUndefined();
    expect(payload.session.user).toBe('alex');
  });

  test('propagates errors from Firestore .set() to the callback', async () => {
    const boom = new Error('write rejected');
    const { dataset } = mockDataset({ setError: boom });
    const store = new FirestoreStore({ dataset });

    const err = await pset(store, 'sid', { cookie: {} });
    expect(err).toBe(boom);
  });
});

describe('FirestoreStore.destroy', () => {
  test('deletes the session doc and signals success with no error', async () => {
    const { dataset, doc, docFns } = mockDataset();
    const store = new FirestoreStore({ dataset });

    const err = await pdestroy(store, 'sid-4');
    expect(err).toBeNull();
    expect(doc).toHaveBeenCalledWith('sid-4');
    expect(docFns.delete).toHaveBeenCalled();
  });

  test('propagates errors from Firestore .delete() to the callback', async () => {
    const boom = new Error('delete failed');
    const { dataset } = mockDataset({ deleteError: boom });
    const store = new FirestoreStore({ dataset });

    const err = await pdestroy(store, 'sid');
    expect(err).toBe(boom);
  });
});
